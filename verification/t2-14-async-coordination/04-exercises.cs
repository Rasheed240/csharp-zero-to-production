// 04-exercises.cs — every answer claimed in this module's exercises, run.
// Peaks and counts are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

class Program
{
    static int _inFlight, _peak;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: does this limit anything? =====");
        Console.WriteLine();
        Console.WriteLine("      await Task.WhenAll(items.Select(i => CallApiAsync(i)));");
        Console.WriteLine();
        Console.WriteLine("  approach                         peak concurrent");
        Console.WriteLine($"    Task.WhenAll                   {PeakOf(WhenAllAll),15}");
        Console.WriteLine($"    SemaphoreSlim(5)               {PeakOf(() => Throttled(5)),15}");
        Console.WriteLine($"    Parallel.ForEachAsync(dop 5)   {PeakOf(() => ForEachAsync(5)),15}");
        Console.WriteLine();
        Console.WriteLine("  No. WhenAll starts everything at once — it waits for completion, it");
        Console.WriteLine("  does not schedule. For 5 calls that is fine; for 200 against a");
        Console.WriteLine("  partner that allows 10, you have written a denial of service.");
        Console.WriteLine();
        Console.WriteLine("  Prefer Parallel.ForEachAsync when you are fanning out over a");
        Console.WriteLine("  collection: it takes the limit and a CancellationToken directly, and");
        Console.WriteLine("  there is no permit to leak.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: find the bug =====");
        Console.WriteLine();
        Console.WriteLine("      await _gate.WaitAsync(ct);");
        Console.WriteLine("      var result = await CallApiAsync(ct);   // this can throw");
        Console.WriteLine("      _gate.Release();");
        Console.WriteLine();
        Console.WriteLine($"    3 permits, 3 failed operations -> {LeakedPermits()} permits remain");
        Console.WriteLine();
        Console.WriteLine("  A throw skips the Release, and the permit is gone permanently. Three");
        Console.WriteLine("  failures exhaust a semaphore of three, and every later caller waits");
        Console.WriteLine("  forever on a permit nobody will return.");
        Console.WriteLine();
        Console.WriteLine("  The fix is try/finally, and it is the same shape as a lock:");
        Console.WriteLine();
        Console.WriteLine("      await _gate.WaitAsync(ct);");
        Console.WriteLine("      try     { return await CallApiAsync(ct); }");
        Console.WriteLine("      finally { _gate.Release(); }");
        Console.WriteLine();
        Console.WriteLine("  This failure is worse than a deadlock because it is DELAYED. The");
        Console.WriteLine("  service keeps working at a reduced limit until enough failures");
        Console.WriteLine("  accumulate, so the outage arrives long after the deployment that");
        Console.WriteLine("  caused it.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: Wait or WaitAsync? =====");
        Console.WriteLine();
        var (a, b) = WaitComparison();
        Console.WriteLine($"    WaitAsync : {1.0,6:N2}x  (baseline)");
        Console.WriteLine($"    Wait      : {b / a,6:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Both enforce the limit. Wait blocks a pool thread for every WAITER,");
        Console.WriteLine("  not just for every worker — so a limit of 4 with 120 callers holds");
        Console.WriteLine("  116 threads doing nothing (t2-07).");
        Console.WriteLine();
        Console.WriteLine("  There is no async lock keyword in C#. SemaphoreSlim(1,1) with");
        Console.WriteLine("  WaitAsync is the idiom, and it works because a semaphore counts");
        Console.WriteLine("  permits rather than owning threads — so a permit taken before an");
        Console.WriteLine("  await can be released after it, on a different thread.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: bounded or unbounded? =====");
        Console.WriteLine();
        Console.WriteLine("  A producer faster than its consumer, 20,000 items:");
        Console.WriteLine();
        Console.WriteLine("  channel                 peak MB   delivered");
        Console.WriteLine($"    Unbounded             {QueueRun(0, BoundedChannelFullMode.Wait),7:N1}   {LastDelivered:N0}");
        Console.WriteLine($"    Bounded(100) Wait     {QueueRun(100, BoundedChannelFullMode.Wait),7:N1}   {LastDelivered:N0}");
        Console.WriteLine($"    Bounded(100) DropWrite{QueueRun(100, BoundedChannelFullMode.DropWrite),7:N1}   {LastDelivered:N0}");
        Console.WriteLine();
        Console.WriteLine("  Unbounded is not a choice to postpone — it IS a choice, and it says");
        Console.WriteLine("  'absorb any speed mismatch in memory until the process dies'.");
        Console.WriteLine();
        Console.WriteLine("  Bounded makes you decide where the mismatch surfaces:");
        Console.WriteLine("    Wait       in the producer, which slows down (back pressure)");
        Console.WriteLine("    DropWrite  in the data, silently — note the delivered column");
        Console.WriteLine();
        Console.WriteLine("  Wait for anything that matters; Drop for telemetry you would rather");
        Console.WriteLine("  lose than have slow the system down. Choose deliberately, because the");
        Console.WriteLine("  API is equally happy to lose your payments.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: why does the consumer never finish? =====");
        Console.WriteLine();
        Console.WriteLine("      for (var i = 0; i < 100; i++) await writer.WriteAsync(i);");
        Console.WriteLine("      await consumerTask;      // never returns");
        Console.WriteLine();
        Console.WriteLine($"    without Complete() : {Drain(false)}");
        Console.WriteLine($"    with Complete()    : {Drain(true)}");
        Console.WriteLine();
        Console.WriteLine("  ReadAllAsync ends when the WRITER is completed, not when the queue is");
        Console.WriteLine("  empty. An empty channel is not a finished one — it is a channel");
        Console.WriteLine("  waiting for the next item.");
        Console.WriteLine();
        Console.WriteLine("  Put Complete() in a finally, so a producer that throws still releases");
        Console.WriteLine("  the consumer, and prefer Complete(exception) so the failure surfaces");
        Console.WriteLine("  on the consumer instead of looking like a clean end of stream:");
        Console.WriteLine();
        Console.WriteLine($"    Complete(exception) -> consumer {FaultedProducer()}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: which primitive? =====");
        Console.WriteLine();
        Console.WriteLine("  need                                        use");
        Console.WriteLine("  limit concurrent calls to a dependency      SemaphoreSlim / ForEachAsync");
        Console.WriteLine("  mutual exclusion across an await            SemaphoreSlim(1,1)");
        Console.WriteLine("  mutual exclusion, no await inside           lock (cheaper, reentrant)");
        Console.WriteLine("  hand work to a background processor         Channel");
        Console.WriteLine("  fan out CPU work over cores                 Parallel.For (t2-10)");
        Console.WriteLine("  wait for N things to finish                 Task.WhenAll");
        Console.WriteLine("  first of N, cancel the rest                 Task.WhenAny + linked CTS");
        Console.WriteLine();
        Console.WriteLine("  The two that get confused: Task.WhenAll is not a throttle, and");
        Console.WriteLine("  Parallel.For is not for I/O (t2-10 measured 8.5x against 214x).");
        Console.WriteLine();
        Console.WriteLine("  And SemaphoreSlim(1,1) is NOT a drop-in for lock. It is not");
        Console.WriteLine("  reentrant, so a guarded method calling another guarded method");
        Console.WriteLine($"  deadlocks: {NestedSemaphore()}");
    }

    // --- Exercise 1 -----------------------------------------------------------
    static int PeakOf(Action run)
    {
        Thread.Sleep(60);
        Volatile.Write(ref _inFlight, 0);
        Volatile.Write(ref _peak, 0);
        run();
        return Volatile.Read(ref _peak);
    }

    static void WhenAllAll() =>
        Task.WhenAll(Enumerable.Range(0, 100).Select(_ => WorkAsync())).GetAwaiter().GetResult();

    static void Throttled(int limit)
    {
        using var gate = new SemaphoreSlim(limit, limit);
        Task.WhenAll(Enumerable.Range(0, 100).Select(async _ =>
        {
            await gate.WaitAsync().ConfigureAwait(false);
            try { await WorkAsync().ConfigureAwait(false); }
            finally { gate.Release(); }
        })).GetAwaiter().GetResult();
    }

    static void ForEachAsync(int dop) =>
        Parallel.ForEachAsync(Enumerable.Range(0, 100),
            new ParallelOptions { MaxDegreeOfParallelism = dop },
            async (_, ct) => await WorkAsync(ct).ConfigureAwait(false)).GetAwaiter().GetResult();

    static async Task WorkAsync(CancellationToken ct = default)
    {
        var now = Interlocked.Increment(ref _inFlight);
        var peak = Volatile.Read(ref _peak);
        while (now > peak && Interlocked.CompareExchange(ref _peak, now, peak) != peak)
            peak = Volatile.Read(ref _peak);
        try { await Task.Delay(15, ct).ConfigureAwait(false); }
        finally { Interlocked.Decrement(ref _inFlight); }
    }

    // --- Exercise 2 -----------------------------------------------------------
    static int LeakedPermits()
    {
        var gate = new SemaphoreSlim(3, 3);
        for (var i = 0; i < 3; i++)
        {
            try
            {
                gate.Wait();
                throw new InvalidOperationException("failed");
            }
            catch (InvalidOperationException) { }
        }
        return gate.CurrentCount;
    }

    // --- Exercise 3 -----------------------------------------------------------
    static (double, double) WaitComparison() => (Queue(true), Queue(false));

    static double Queue(bool useAsync)
    {
        Thread.Sleep(100);
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

    // --- Exercise 4 -----------------------------------------------------------
    static int LastDelivered;

    static double QueueRun(int capacity, BoundedChannelFullMode mode)
    {
        Thread.Sleep(80);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var peak = 0L;
        var delivered = 0;

        var channel = capacity == 0
            ? Channel.CreateUnbounded<byte[]>()
            : Channel.CreateBounded<byte[]>(new BoundedChannelOptions(capacity) { FullMode = mode });

        var producer = Task.Run(async () =>
        {
            try
            {
                for (var i = 0; i < 20_000; i++)
                    await channel.Writer.WriteAsync(new byte[1024]).ConfigureAwait(false);
            }
            finally { channel.Writer.Complete(); }
        });

        var sampler = Task.Run(async () =>
        {
            while (!producer.IsCompleted)
            {
                var m = GC.GetTotalMemory(false) - before;
                if (m > peak) peak = m;
                await Task.Delay(2).ConfigureAwait(false);
            }
        });

        var consumer = Task.Run(async () =>
        {
            await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false))
            {
                delivered++;
                if ((delivered & 0x1F) == 0) await Task.Yield();
            }
        });

        Task.WhenAll(producer, sampler, consumer).GetAwaiter().GetResult();
        LastDelivered = delivered;
        return Math.Max(peak, 0) / 1024.0 / 1024.0;
    }

    // --- Exercise 5 -----------------------------------------------------------
    static string Drain(bool complete)
    {
        var channel = Channel.CreateUnbounded<int>();
        var read = 0;
        var consumer = Task.Run(async () =>
        {
            await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false))
                Interlocked.Increment(ref read);
        });
        for (var i = 0; i < 100; i++) channel.Writer.TryWrite(i);
        if (complete) channel.Writer.Complete();
        return consumer.Wait(800)
            ? $"finished after {Volatile.Read(ref read)} items"
            : $"HUNG with all {Volatile.Read(ref read)} items read";
    }

    static string FaultedProducer()
    {
        var channel = Channel.CreateUnbounded<int>();
        var consumer = Task.Run(async () =>
        {
            try
            {
                await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false)) { }
                return "completed cleanly";
            }
            catch (InvalidOperationException ex) { return $"threw: {ex.Message}"; }
        });
        channel.Writer.TryWrite(1);
        channel.Writer.Complete(new InvalidOperationException("producer failed"));
        return consumer.Wait(800) ? consumer.Result : "HUNG";
    }

    // --- Exercise 6 -----------------------------------------------------------
    static string NestedSemaphore()
    {
        var gate = new SemaphoreSlim(1, 1);
        gate.Wait();
        var second = gate.Wait(TimeSpan.FromMilliseconds(150));
        if (second) { gate.Release(); gate.Release(); return "entered twice (unexpected)"; }
        gate.Release();
        return "DEADLOCKED on the nested Wait";
    }
}
