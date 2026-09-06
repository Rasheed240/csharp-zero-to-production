// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;
    static int _pages;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: does cancelling stop it? =====");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            var sw = Stopwatch.StartNew();
            var t = Task.Run(() => { var e = Stopwatch.StartNew();
                                     while (e.ElapsedMilliseconds < 300) _sink++; });
            cts.Cancel();
            t.GetAwaiter().GetResult();
            Console.WriteLine($"  cancelled at ~0 ms, work ended at {sw.Elapsed.TotalMilliseconds:N0} ms");
        }
        Console.WriteLine("  No. Cancel() sets a flag and runs callbacks. Work that never looks");
        Console.WriteLine("  at the token runs to completion. Cancellation is COOPERATIVE, and");
        Console.WriteLine("  there is no API in .NET that forcibly stops running code.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: which exception, and is it an error? =====");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            Console.WriteLine($"  ThrowIfCancellationRequested -> {Caught(() => cts.Token.ThrowIfCancellationRequested())}");
            Console.WriteLine($"  Task.Delay(1000, token)      -> {Caught(() => Task.Delay(1000, cts.Token).GetAwaiter().GetResult())}");
        }
        Console.WriteLine();
        Console.WriteLine("  TaskCanceledException derives from OperationCanceledException, so");
        Console.WriteLine("  catch the BASE type — catching only TaskCanceledException misses");
        Console.WriteLine("  direct token throws.");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            var t = Task.Run(() => cts.Token.ThrowIfCancellationRequested(), cts.Token);
            try { t.GetAwaiter().GetResult(); } catch (OperationCanceledException) { }
            Console.WriteLine($"  task status {t.Status}, IsFaulted={t.IsFaulted}");
        }
        Console.WriteLine("  Canceled is its own terminal state, NOT Faulted. A cancelled request");
        Console.WriteLine("  is not an error; logging it as one puts every abandoned browser tab");
        Console.WriteLine("  into your error budget.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: caller cancellation or timeout? =====");
        Console.WriteLine();
        Console.WriteLine("  scenario                      outcome");
        Which("caller cancels at 50 ms", callerMs: 50, timeoutMs: 400);
        Which("timeout at 80 ms", callerMs: -1, timeoutMs: 80);
        Console.WriteLine();
        Console.WriteLine("  The LINKED token is cancelled in both cases, so testing it tells you");
        Console.WriteLine("  nothing. You must ask the original source:");
        Console.WriteLine();
        Console.WriteLine("      catch (OperationCanceledException) when (caller.IsCancellationRequested)");
        Console.WriteLine("          -> caller gave up: not an error, do not retry");
        Console.WriteLine("      catch (OperationCanceledException)");
        Console.WriteLine("          -> our timeout fired: a real failure, log it, maybe retry");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: find the bug =====");
        Console.WriteLine();
        Console.WriteLine("  This method accepts a token and is still uncancellable. Why?");
        Console.WriteLine();
        Console.WriteLine("      for (var i = 0; i < pages; i++)");
        Console.WriteLine("          results.Add(await RenderAsync(i));    // no ct");
        Console.WriteLine();
        Volatile.Write(ref _pages, 0);
        RunUntilCancelled(dropped: true);
        var dropped = Volatile.Read(ref _pages);
        Volatile.Write(ref _pages, 0);
        RunUntilCancelled(dropped: false);
        var threaded = Volatile.Read(ref _pages);
        Console.WriteLine($"  token dropped   : {dropped,3} of 30 pages rendered after cancellation");
        Console.WriteLine($"  token threaded  : {threaded,3} of 30 pages rendered after cancellation");
        Console.WriteLine();
        Console.WriteLine("  The parameter exists and is never used. CA2016 catches exactly this");
        Console.WriteLine("  ('Forward the CancellationToken parameter to methods that take one')");
        Console.WriteLine("  and it is the single highest-value analyser rule in this module.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: the leak =====");
        Console.WriteLine();
        Console.WriteLine("  10,000 linked sources against one long-lived parent token:");
        Console.WriteLine($"    not disposed : {Leak(false),7:N0} KB retained");
        Console.WriteLine($"    disposed     : {Leak(true),7:N0} KB retained");
        Console.WriteLine();
        Console.WriteLine("  CreateLinkedTokenSource registers a callback on each parent token.");
        Console.WriteLine("  The registration lives as long as the PARENT, not the child. Against");
        Console.WriteLine("  a process-lifetime token that is an unbounded leak.");
        Console.WriteLine();
        Console.WriteLine("  Its signature: memory grows with total requests served, never falls,");
        Console.WriteLine("  and is unaffected by load dropping to zero. A restart hides it.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static string Caught(Action a)
    {
        try { a(); return "did not throw"; }
        catch (Exception ex) { return ex.GetType().Name; }
    }

    static void Which(string label, int callerMs, int timeoutMs)
    {
        using var caller = new CancellationTokenSource();
        if (callerMs > 0) caller.CancelAfter(callerMs);
        string outcome;
        try
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(caller.Token);
            linked.CancelAfter(timeoutMs);
            Task.Delay(2000, linked.Token).GetAwaiter().GetResult();
            outcome = "completed";
        }
        catch (OperationCanceledException) when (caller.IsCancellationRequested)
        {
            outcome = "cancelled by caller";
        }
        catch (OperationCanceledException)
        {
            outcome = "timed out";
        }
        Console.WriteLine($"  {label,-28}  {outcome}");
    }

    static void RunUntilCancelled(bool dropped)
    {
        using var cts = new CancellationTokenSource();
        cts.CancelAfter(60);
        try
        {
            (dropped ? ExportDroppedAsync(30, cts.Token) : ExportThreadedAsync(30, cts.Token))
                .GetAwaiter().GetResult();
        }
        catch (OperationCanceledException) { }
    }

    static async Task ExportDroppedAsync(int pages, CancellationToken ct)
    {
        for (var i = 0; i < pages; i++)
        {
            await Task.Delay(20).ConfigureAwait(false);       // token not passed
            Interlocked.Increment(ref _pages);
        }
    }

    static async Task ExportThreadedAsync(int pages, CancellationToken ct)
    {
        for (var i = 0; i < pages; i++)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Delay(20, ct).ConfigureAwait(false);
            Interlocked.Increment(ref _pages);
        }
    }

    static long Leak(bool dispose)
    {
        var parent = new CancellationTokenSource();
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        Create(parent.Token, dispose);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var after = GC.GetTotalMemory(true);
        GC.KeepAlive(parent);
        parent.Dispose();
        return (after - before) / 1024;
    }

    [System.Runtime.CompilerServices.MethodImpl(
        System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    static void Create(CancellationToken parent, bool dispose)
    {
        for (var i = 0; i < 10_000; i++)
        {
            var linked = CancellationTokenSource.CreateLinkedTokenSource(parent);
            if (dispose) linked.Dispose();
        }
    }
}
