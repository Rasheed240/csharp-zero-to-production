// 02-linking-and-timeouts.cs — combining a caller's token with your own timeout,
// telling afterwards WHICH one fired, and the leak that linked sources cause when
// nobody disposes them.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-linking-and-timeouts.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        Console.WriteLine("=== 1. one operation, two reasons to stop ===");
        Console.WriteLine();
        Console.WriteLine("  Almost every real call has both: the caller may give up, AND you");
        Console.WriteLine("  have a deadline of your own. CreateLinkedTokenSource combines them");
        Console.WriteLine("  into one token that is cancelled when EITHER fires.");
        Console.WriteLine();
        Console.WriteLine("  scenario                      outcome                    ms");

        RunScenario("caller cancels at 60 ms", callerCancelMs: 60, timeoutMs: 500, workMs: 1000);
        RunScenario("timeout fires at 100 ms", callerCancelMs: -1, timeoutMs: 100, workMs: 1000);
        RunScenario("work finishes first", callerCancelMs: -1, timeoutMs: 500, workMs: 60);

        Console.WriteLine();
        Console.WriteLine("  Note the outcome column. All three are distinguished, and that is");
        Console.WriteLine("  the point: 'cancelled' and 'timed out' need different handling.");
        Console.WriteLine("  A caller cancellation is not an error and must not be retried — the");
        Console.WriteLine("  caller has gone. A timeout IS a failure of your dependency, should");
        Console.WriteLine("  be logged, may be retried, and belongs in your error budget.");

        Console.WriteLine();
        Console.WriteLine("=== 2. how to tell them apart ===");
        Console.WriteLine();
        Console.WriteLine("  The linked token is a THIRD token. Comparing the exception against");
        Console.WriteLine("  it tells you nothing, because it is cancelled in both cases. You");
        Console.WriteLine("  have to ask the ORIGINAL sources which one fired:");
        Console.WriteLine();
        Console.WriteLine("      catch (OperationCanceledException) when (caller.IsCancellationRequested)");
        Console.WriteLine("          -> the caller gave up");
        Console.WriteLine("      catch (OperationCanceledException)");
        Console.WriteLine("          -> our own timeout fired");
        Console.WriteLine();
        Console.WriteLine("  Order matters: check the caller FIRST. If both fired, the caller");
        Console.WriteLine("  going away is the more useful explanation, and it is the one that");
        Console.WriteLine("  should not page anyone.");

        Console.WriteLine();
        Console.WriteLine("=== 3. CancelAfter on a source you already own ===");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            cts.CancelAfter(80);
            var sw = Stopwatch.StartNew();
            try
            {
                Task.Delay(1000, cts.Token).GetAwaiter().GetResult();
                Console.WriteLine("  completed (unexpected)");
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine($"  CancelAfter(80) fired at : {sw.Elapsed.TotalMilliseconds:N0} ms");
            }
        }
        Console.WriteLine("  CancelAfter is a timer on the source. It is the shortest way to");
        Console.WriteLine("  express a deadline, and there is also a constructor overload:");
        Console.WriteLine("      new CancellationTokenSource(TimeSpan.FromSeconds(5))");

        Console.WriteLine();
        Console.WriteLine("=== 4. the leak: linked sources are IDisposable for a reason ===");
        Console.WriteLine();
        Console.WriteLine("  A linked source REGISTERS a callback on each token it links. If you");
        Console.WriteLine("  do not dispose it, that registration stays on the parent token for");
        Console.WriteLine("  as long as the PARENT lives — not as long as the child lives.");
        Console.WriteLine();
        Console.WriteLine("  10,000 linked sources created against one long-lived parent token:");
        Console.WriteLine();
        Console.WriteLine("  variant                        KB retained by the parent");
        Console.WriteLine($"  not disposed                   {MeasureLinkedLeak(dispose: false),10:N0}");
        Console.WriteLine($"  disposed                       {MeasureLinkedLeak(dispose: true),10:N0}");
        Console.WriteLine();
        Console.WriteLine("  This is the classic slow leak in a long-running service: a token");
        Console.WriteLine("  that lives for the process lifetime — an application-stopping token,");
        Console.WriteLine("  a connection-scoped token — accumulating one registration per");
        Console.WriteLine("  request, forever. Memory climbs with total requests served rather");
        Console.WriteLine("  than with concurrency, which is a very distinctive shape on a graph.");
        Console.WriteLine();
        Console.WriteLine("      // Wrong: leaks a registration on ct for the life of ct.");
        Console.WriteLine("      var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);");
        Console.WriteLine();
        Console.WriteLine("      // Right:");
        Console.WriteLine("      using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);");
        Console.WriteLine();
        Console.WriteLine("  The same applies to token.Register(...): the returned registration");
        Console.WriteLine("  must be disposed, and it is the return value people discard.");

        Console.WriteLine();
        Console.WriteLine("=== 5. CancellationToken.None and default ===");
        Console.WriteLine();
        Console.WriteLine($"  default(CancellationToken) == CancellationToken.None : " +
                          $"{default(CancellationToken) == CancellationToken.None}");
        Console.WriteLine($"  CanBeCanceled on None                               : " +
                          $"{CancellationToken.None.CanBeCanceled}");
        Console.WriteLine();
        Console.WriteLine("  They are EQUAL. Anyone who tells you otherwise is wrong, and the");
        Console.WriteLine("  first line above is the check. The difference is one of INTENT.");
        Console.WriteLine("  CancellationToken.None at a call site says 'this genuinely cannot");
        Console.WriteLine("  be cancelled and I decided that'. A defaulted parameter usually");
        Console.WriteLine("  means nobody thought about it. Reviewers can act on the first.");
        Console.WriteLine();
        Console.WriteLine("  CanBeCanceled is worth knowing for a different reason: it is false");
        Console.WriteLine("  for None, so a library can skip registering callbacks entirely when");
        Console.WriteLine("  it sees a token that can never fire.");
    }

    static void RunScenario(string label, int callerCancelMs, int timeoutMs, int workMs)
    {
        using var caller = new CancellationTokenSource();
        if (callerCancelMs > 0) caller.CancelAfter(callerCancelMs);

        var sw = Stopwatch.StartNew();
        string outcome;
        try
        {
            DoWorkAsync(workMs, TimeSpan.FromMilliseconds(timeoutMs), caller.Token)
                .GetAwaiter().GetResult();
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

        Console.WriteLine($"  {label,-28}  {outcome,-24} {sw.Elapsed.TotalMilliseconds,5:N0}");
    }

    /// <summary>
    /// The standard shape: link the caller's token with a deadline of our own,
    /// pass the LINKED token down, and dispose it when done.
    /// </summary>
    static async Task DoWorkAsync(int workMs, TimeSpan timeout, CancellationToken ct)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(timeout);
        await Task.Delay(workMs, linked.Token).ConfigureAwait(false);
    }

    static long MeasureLinkedLeak(bool dispose)
    {
        var parent = new CancellationTokenSource();          // stands in for a long-lived token

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var before = GC.GetTotalMemory(forceFullCollection: true);

        // Nothing here holds a reference to the linked sources: they go out of
        // scope immediately, exactly as they would in a request handler. If they
        // survive the collection below, it is the PARENT token retaining them
        // through its registration list, which is the whole point.
        // An earlier version of this measurement kept them in a List and was
        // therefore measuring the List rather than the leak.
        CreateAndDrop(parent.Token, dispose);

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var after = GC.GetTotalMemory(forceFullCollection: true);

        GC.KeepAlive(parent);
        parent.Dispose();
        return (after - before) / 1024;
    }

    [System.Runtime.CompilerServices.MethodImpl(
        System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    static void CreateAndDrop(CancellationToken parent, bool dispose)
    {
        for (var i = 0; i < 10_000; i++)
        {
            var linked = CancellationTokenSource.CreateLinkedTokenSource(parent);
            if (dispose) linked.Dispose();
            // else: dropped on the floor, unreferenced by anything we own
        }
    }
}
