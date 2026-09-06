// 01-throttling.cs — the async-safe way to limit concurrency, and the three
// mistakes that make a limiter not limit.
//
// Concurrency observations are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-throttling.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static int _inFlight;
    static int _peak;

    static void Main()
    {
        Console.WriteLine("=== the problem WhenAll does not solve ===");
        Console.WriteLine();
        Console.WriteLine("  Task.WhenAll starts everything at once. For 5 calls that is what you");
        Console.WriteLine("  want; for 500 against a service that allows 10, it is a denial of");
        Console.WriteLine("  service you wrote yourself.");
        Console.WriteLine();
        Console.WriteLine("  200 operations against a dependency, measured by peak concurrency:");
        Console.WriteLine();
        Console.WriteLine("  approach                            peak in flight   completed");

        Report("Task.WhenAll, unbounded", RunUnbounded());
        Report("SemaphoreSlim(10)", RunSemaphore(10));
        Report("Parallel.ForEachAsync(dop: 10)", RunParallelForEachAsync(10));

        Console.WriteLine();
        Console.WriteLine("  The peak column is the whole point, and it is exact rather than a");
        Console.WriteLine("  timing: it counts how many operations were simultaneously inside the");
        Console.WriteLine("  dependency. Unbounded means every one of them at once.");

        Console.WriteLine();
        Console.WriteLine("=== why a lock cannot do this ===");
        Console.WriteLine();
        Console.WriteLine("  A monitor is owned by a THREAD, so it cannot be held across an await");
        Console.WriteLine("  (t2-12, CS1996). SemaphoreSlim counts PERMITS and has no owner, so a");
        Console.WriteLine("  permit taken on one thread can be released on another — which is");
        Console.WriteLine("  exactly what happens when a continuation resumes elsewhere.");
        Console.WriteLine();
        Console.WriteLine("      await _gate.WaitAsync(ct);");
        Console.WriteLine("      try     { await DoWorkAsync(ct); }");
        Console.WriteLine("      finally { _gate.Release(); }");
        Console.WriteLine();
        Console.WriteLine("  That is the async equivalent of lock, and the try/finally is not");
        Console.WriteLine("  optional — see mistake 1 below.");

        Console.WriteLine();
        Console.WriteLine("=== the three mistakes ===");
        Console.WriteLine();
        Console.WriteLine("  MISTAKE 1: no try/finally. One exception and the permit is gone");
        Console.WriteLine("  forever. Permits do not come back on their own.");
        Console.WriteLine();
        var leaked = PermitLeak();
        Console.WriteLine($"    started with 3 permits, 3 operations threw -> {leaked} permits left");
        Console.WriteLine("    the next caller waits forever on a semaphore nobody will release");

        Console.WriteLine();
        Console.WriteLine("  MISTAKE 2: Wait() instead of WaitAsync(). It compiles. It blocks a");
        Console.WriteLine("  pool thread for the whole queue (t2-07).");
        Console.WriteLine();
        var (asyncMs, blockingMs) = WaitVsWaitAsync();
        Console.WriteLine($"    WaitAsync : {1.0,5:N2}x   (baseline)");
        Console.WriteLine($"    Wait      : {blockingMs / asyncMs,5:N2}x");
        Console.WriteLine("    Same limit, same work. The blocking version holds one pool thread");
        Console.WriteLine("    per WAITER, not per worker — so 200 queued callers occupy 200");
        Console.WriteLine("    threads doing nothing.");

        Console.WriteLine();
        Console.WriteLine("  MISTAKE 3: releasing more than you took. SemaphoreSlim will let you");
        Console.WriteLine("  raise the count above the initial value, silently widening the limit");
        Console.WriteLine("  you thought you had set:");
        Console.WriteLine();
        Console.WriteLine($"    {OverRelease()}");
        Console.WriteLine();
        Console.WriteLine("  Pass maxCount to the constructor and it throws instead:");
        Console.WriteLine($"    {OverReleaseGuarded()}");
        Console.WriteLine();
        Console.WriteLine("  new SemaphoreSlim(10) has NO maximum. new SemaphoreSlim(10, 10) does.");
        Console.WriteLine("  The second form turns a silent limit failure into an exception at the");
        Console.WriteLine("  point of the bug, which is worth the extra argument every time.");

        Console.WriteLine();
        Console.WriteLine("=== it is not reentrant, and lock is ===");
        Console.WriteLine();
        Console.WriteLine($"  nested Wait on the same SemaphoreSlim(1,1) : {NestedSemaphore()}");
        Console.WriteLine();
        Console.WriteLine("  A monitor counts recursion for the owning thread, so nesting works");
        Console.WriteLine("  (t2-12). A semaphore counts permits and has no idea who holds them,");
        Console.WriteLine("  so a thread waiting for a permit it already holds waits forever.");
        Console.WriteLine();
        Console.WriteLine("  This is the most common way a SemaphoreSlim deadlocks, and it usually");
        Console.WriteLine("  arrives by refactoring: a guarded method starts calling another");
        Console.WriteLine("  guarded method, and neither author sees the other.");
    }

    static async Task<string> WorkAsync(CancellationToken ct = default)
    {
        var now = Interlocked.Increment(ref _inFlight);
        var peak = Volatile.Read(ref _peak);
        while (now > peak && Interlocked.CompareExchange(ref _peak, now, peak) != peak)
            peak = Volatile.Read(ref _peak);
        try
        {
            await Task.Delay(20, ct).ConfigureAwait(false);
            return "ok";
        }
        finally { Interlocked.Decrement(ref _inFlight); }
    }

    readonly record struct Result(int Peak, int Completed);

    static Result RunUnbounded()
    {
        Reset();
        var done = Task.WhenAll(Enumerable.Range(0, 200).Select(_ => WorkAsync()));
        done.GetAwaiter().GetResult();
        return new Result(Volatile.Read(ref _peak), done.Result.Length);
    }

    static Result RunSemaphore(int limit)
    {
        Reset();
        using var gate = new SemaphoreSlim(limit, limit);
        var completed = 0;

        Task.WhenAll(Enumerable.Range(0, 200).Select(async _ =>
        {
            await gate.WaitAsync().ConfigureAwait(false);
            try
            {
                await WorkAsync().ConfigureAwait(false);
                Interlocked.Increment(ref completed);
            }
            finally { gate.Release(); }
        })).GetAwaiter().GetResult();

        return new Result(Volatile.Read(ref _peak), completed);
    }

    static Result RunParallelForEachAsync(int dop)
    {
        Reset();
        var completed = 0;
        Parallel.ForEachAsync(
            Enumerable.Range(0, 200),
            new ParallelOptions { MaxDegreeOfParallelism = dop },
            async (i, ct) =>
            {
                await WorkAsync(ct).ConfigureAwait(false);
                Interlocked.Increment(ref completed);
            }).GetAwaiter().GetResult();
        return new Result(Volatile.Read(ref _peak), completed);
    }

    static void Reset()
    {
        Thread.Sleep(80);
        Volatile.Write(ref _inFlight, 0);
        Volatile.Write(ref _peak, 0);
    }

    static void Report(string label, Result r) =>
        Console.WriteLine($"  {label,-34} {r.Peak,14}   {r.Completed,9}");

    // --- mistake 1 ------------------------------------------------------------
    static int PermitLeak()
    {
        var gate = new SemaphoreSlim(3, 3);
        for (var i = 0; i < 3; i++)
        {
            try
            {
                gate.Wait();
                throw new InvalidOperationException("the operation failed");
                // no finally: the permit is never returned
            }
            catch (InvalidOperationException) { }
        }
        return gate.CurrentCount;
    }

    // --- mistake 2 ------------------------------------------------------------
    static (double asyncMs, double blockingMs) WaitVsWaitAsync()
    {
        var a = TimeQueue(useAsync: true);
        var b = TimeQueue(useAsync: false);
        return (a, b);
    }

    static double TimeQueue(bool useAsync)
    {
        Thread.Sleep(120);
        using var gate = new SemaphoreSlim(4, 4);
        var sw = Stopwatch.StartNew();

        Task.WhenAll(Enumerable.Range(0, 120).Select(_ => Task.Run(async () =>
        {
            if (useAsync) await gate.WaitAsync().ConfigureAwait(false);
            else gate.Wait();
            try { await Task.Delay(15).ConfigureAwait(false); }
            finally { gate.Release(); }
        }))).GetAwaiter().GetResult();

        return sw.Elapsed.TotalMilliseconds;
    }

    // --- mistake 3 ------------------------------------------------------------
    static string OverRelease()
    {
        var gate = new SemaphoreSlim(2);           // no maximum
        gate.Release();
        gate.Release();
        return $"SemaphoreSlim(2) after two stray Releases: CurrentCount = {gate.CurrentCount}";
    }

    static string OverReleaseGuarded()
    {
        var gate = new SemaphoreSlim(2, 2);        // maximum of 2
        try
        {
            gate.Release();
            return "no exception (unexpected)";
        }
        catch (SemaphoreFullException)
        {
            return "SemaphoreSlim(2, 2) threw SemaphoreFullException on the stray Release";
        }
    }

    // --- reentrancy -----------------------------------------------------------
    static string NestedSemaphore()
    {
        var gate = new SemaphoreSlim(1, 1);
        gate.Wait();
        var second = gate.Wait(TimeSpan.FromMilliseconds(200));
        if (second) { gate.Release(); gate.Release(); return "entered twice (unexpected)"; }
        gate.Release();
        return "DEADLOCKED on the second Wait (timed out at 200 ms)";
    }
}
