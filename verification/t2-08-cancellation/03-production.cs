// 03-production.cs — Ledger's statement export: a token that was accepted at the
// top and dropped one layer down, and what that costs when clients give up.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Statements;

public sealed record Statement(string AccountId, int PageCount);

/// <summary>Stands in for the reporting database. Each page costs real work.</summary>
public sealed class StatementStore
{
    private int _pagesRendered;
    public int PagesRendered => Volatile.Read(ref _pagesRendered);
    public void Reset() => Volatile.Write(ref _pagesRendered, 0);

    public async Task<string> RenderPageAsync(int page, CancellationToken ct = default)
    {
        await Task.Delay(20, ct).ConfigureAwait(false);
        Interlocked.Increment(ref _pagesRendered);
        return $"page-{page}";
    }
}

/// <summary>
/// THE BUG. The endpoint accepts a token and passes it to the FIRST call, then
/// drops it. Everything after that runs to completion regardless.
/// </summary>
public sealed class ExportServiceV1
{
    private readonly StatementStore _store;
    public ExportServiceV1(StatementStore store) => _store = store;

    public async Task<int> ExportAsync(Statement statement, CancellationToken ct = default)
    {
        var pages = new List<string>();
        for (var i = 0; i < statement.PageCount; i++)
        {
            // The token is not passed. Nothing here can ever stop early.
            pages.Add(await _store.RenderPageAsync(i).ConfigureAwait(false));
        }
        return pages.Count;
    }
}

/// <summary>THE FIX. The token reaches every awaited call and every loop iteration.</summary>
public sealed class ExportServiceV2
{
    private readonly StatementStore _store;
    public ExportServiceV2(StatementStore store) => _store = store;

    public async Task<int> ExportAsync(Statement statement, CancellationToken ct = default)
    {
        var pages = new List<string>();
        for (var i = 0; i < statement.PageCount; i++)
        {
            ct.ThrowIfCancellationRequested();
            pages.Add(await _store.RenderPageAsync(i, ct).ConfigureAwait(false));
        }
        return pages.Count;
    }
}

class Program
{
    const int Requests = 60;
    const int PagesPerStatement = 50;
    const int ClientGivesUpAfterMs = 120;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger's statement export renders 50 pages per account. The endpoint");
        Console.WriteLine("  takes a CancellationToken, as every ASP.NET Core action does:");
        Console.WriteLine();
        Console.WriteLine("      public async Task<IActionResult> Export(string id, CancellationToken ct)");
        Console.WriteLine("          => Ok(await _export.ExportAsync(statement, ct));");
        Console.WriteLine();
        Console.WriteLine("  That token is ASP.NET Core's HttpContext.RequestAborted. It fires");
        Console.WriteLine("  when the client disconnects — closes the tab, loses signal, or hits");
        Console.WriteLine("  a gateway timeout upstream of you.");
        Console.WriteLine();
        Console.WriteLine("  The endpoint passed it correctly. One layer down, a loop did not.");
        Console.WriteLine();
        Console.WriteLine($"  {Requests} clients request an export and give up after {ClientGivesUpAfterMs} ms:");
        Console.WriteLine();
        Console.WriteLine("  version                     pages rendered   of possible   total ms");

        var store = new StatementStore();
        Report("token dropped in the loop", Measure(store,
            (svc, s, ct) => new ExportServiceV1(store).ExportAsync(s, ct)));
        Report("token threaded through", Measure(store,
            (svc, s, ct) => new ExportServiceV2(store).ExportAsync(s, ct)));

        Console.WriteLine();
        Console.WriteLine("  The first version rendered every page anyway, because the only thing");
        Console.WriteLine("  that could have stopped it was a parameter accepted at the top of the");
        Console.WriteLine("  call and never used again. The second stopped within one page of the");
        Console.WriteLine("  client giving up.");
        Console.WriteLine();
        Console.WriteLine("  Every client had gone in BOTH runs, so every page rendered in either");
        Console.WriteLine("  column was wasted. The column says how much work was done before");
        Console.WriteLine("  stopping: 100% against 8%. That gap is capacity you paid for and");
        Console.WriteLine("  spent producing output with no recipient —");
        Console.WriteLine("  and it is spent at exactly the moment you can least afford it,");
        Console.WriteLine("  because clients give up when you are ALREADY slow.");

        Console.WriteLine();
        Console.WriteLine("=== the feedback loop this creates ===");
        Console.WriteLine();
        Console.WriteLine("  1. Something makes the service slow. Latency rises.");
        Console.WriteLine("  2. Clients hit their timeouts and disconnect.");
        Console.WriteLine("  3. Their work keeps running, because the token went nowhere.");
        Console.WriteLine("  4. That work competes with the retries those clients now send.");
        Console.WriteLine("  5. Latency rises further. Go to 2.");
        Console.WriteLine();
        Console.WriteLine("  This is why an outage that should have been a brief slowdown becomes");
        Console.WriteLine("  a sustained one that does not recover until traffic is shed. A");
        Console.WriteLine("  correctly threaded token breaks the loop at step 3: abandoned work");
        Console.WriteLine("  stops, and capacity is returned in time to serve the retries.");

        Console.WriteLine();
        Console.WriteLine("=== why it survived review ===");
        Console.WriteLine();
        Console.WriteLine("  Nothing about the broken version LOOKS broken. It accepts a token,");
        Console.WriteLine("  it has the right signature, it passes the analyser rules that check");
        Console.WriteLine("  for a token parameter. The defect is an absence — an argument not");
        Console.WriteLine("  passed at one call site out of several.");
        Console.WriteLine();
        Console.WriteLine("  There is no test that fails, either, unless somebody wrote one that");
        Console.WriteLine("  cancels mid-flight and asserts the work stopped. Almost nobody does:");
        Console.WriteLine("  a cancellation test looks like a test of the framework rather than");
        Console.WriteLine("  of your code.");
        Console.WriteLine();
        Console.WriteLine("  What DOES catch it, cheaply:");
        Console.WriteLine();
        Console.WriteLine("    CA2016  'Forward the CancellationToken parameter to methods that");
        Console.WriteLine("             take one'. Built into the .NET analysers, off by default");
        Console.WriteLine("             at warning level in some templates. Turn it on and treat");
        Console.WriteLine("             it as an error.");
        Console.WriteLine();
        Console.WriteLine("    A test that cancels halfway and asserts on work done:");
        Console.WriteLine();
        Console.WriteLine("      using var cts = new CancellationTokenSource();");
        Console.WriteLine("      cts.CancelAfter(TimeSpan.FromMilliseconds(50));");
        Console.WriteLine("      await Assert.ThrowsAsync<OperationCanceledException>(");
        Console.WriteLine("          () => service.ExportAsync(statement, cts.Token));");
        Console.WriteLine("      Assert.True(store.PagesRendered < statement.PageCount);");
        Console.WriteLine();
        Console.WriteLine("  The second assertion is the important one. Without it the test");
        Console.WriteLine("  passes on the broken version too, because the exception is thrown by");
        Console.WriteLine("  the FIRST call, which does receive the token.");

        Console.WriteLine();
        Console.WriteLine("=== the second bug in the same service ===");
        Console.WriteLine();
        Console.WriteLine("  A background reconciliation loop linked every job's token to the");
        Console.WriteLine("  host's application-stopping token, and never disposed the link:");
        Console.WriteLine();
        Console.WriteLine("      var linked = CancellationTokenSource.CreateLinkedTokenSource(");
        Console.WriteLine("          _appStopping, jobCts.Token);          // no using");
        Console.WriteLine();
        Console.WriteLine("  _appStopping lives for the life of the process, so every job left a");
        Console.WriteLine("  registration on it permanently.");
        Console.WriteLine();
        Console.WriteLine($"  10,000 jobs, undisposed : {Leak(dispose: false),8:N0} KB retained");
        Console.WriteLine($"  10,000 jobs, disposed   : {Leak(dispose: true),8:N0} KB retained");
        Console.WriteLine();
        Console.WriteLine("  The signature of this leak is distinctive and worth memorising:");
        Console.WriteLine("  memory grows with TOTAL WORK DONE SINCE START rather than with");
        Console.WriteLine("  concurrency, it never falls, and it is unaffected by load dropping");
        Console.WriteLine("  to zero. A restart 'fixes' it, which is why it can survive for");
        Console.WriteLine("  months in a service that deploys weekly.");
    }

    readonly record struct Result(int Pages, int Possible, double TotalMs);

    static Result Measure(StatementStore store,
                          Func<object?, Statement, CancellationToken, Task<int>> export)
    {
        Thread.Sleep(200);
        store.Reset();
        var statement = new Statement("ACC-1", PagesPerStatement);

        var sw = Stopwatch.StartNew();
        Task.WhenAll(Enumerable.Range(0, Requests).Select(async _ =>
        {
            using var client = new CancellationTokenSource();
            client.CancelAfter(ClientGivesUpAfterMs);          // the client gives up
            try { await export(null, statement, client.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) { }
        })).GetAwaiter().GetResult();
        sw.Stop();

        return new Result(store.PagesRendered, Requests * PagesPerStatement,
                          sw.Elapsed.TotalMilliseconds);
    }

    static void Report(string label, Result r)
    {
        var share = 100.0 * r.Pages / r.Possible;
        Console.WriteLine($"  {label,-27} {r.Pages,5:N0} of {r.Possible,5:N0}   {share,10:N0}%   " +
                          $"{r.TotalMs,8:N0}");
    }

    static long Leak(bool dispose)
    {
        var appStopping = new CancellationTokenSource();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var before = GC.GetTotalMemory(forceFullCollection: true);

        CreateJobs(appStopping.Token, dispose);

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var after = GC.GetTotalMemory(forceFullCollection: true);

        GC.KeepAlive(appStopping);
        appStopping.Dispose();
        return (after - before) / 1024;
    }

    [System.Runtime.CompilerServices.MethodImpl(
        System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    static void CreateJobs(CancellationToken appStopping, bool dispose)
    {
        for (var i = 0; i < 10_000; i++)
        {
            var jobCts = new CancellationTokenSource();
            var linked = CancellationTokenSource.CreateLinkedTokenSource(appStopping, jobCts.Token);
            if (dispose) { linked.Dispose(); jobCts.Dispose(); }
        }
    }
}
