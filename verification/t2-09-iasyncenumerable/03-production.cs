// 03-production.cs — Ledger's transaction export: the endpoint that worked for
// two years and then killed the pod when one customer got large enough.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Exports;

public sealed record Transaction(long Id, string Reference, decimal Amount, DateOnly Date);

/// <summary>Stands in for the transactions table, which returns rows in pages.</summary>
public sealed class TransactionRepository
{
    private const int PageSize = 1_000;
    private readonly int _total;
    private int _rowsFetched;

    public TransactionRepository(int total) => _total = total;
    public int RowsFetched => Volatile.Read(ref _rowsFetched);
    public void Reset() => Volatile.Write(ref _rowsFetched, 0);

    /// <summary>THE SHIPPED VERSION. Materialises every row before returning.</summary>
    public async Task<List<Transaction>> GetAllAsync(string account, CancellationToken ct = default)
    {
        var all = new List<Transaction>();
        for (var offset = 0; offset < _total; offset += PageSize)
        {
            await Task.Delay(1, ct).ConfigureAwait(false);
            for (var i = 0; i < PageSize && offset + i < _total; i++)
            {
                all.Add(NewRow(offset + i));
                Interlocked.Increment(ref _rowsFetched);
            }
        }
        return all;
    }

    /// <summary>THE FIX. One page in memory at a time, and cancellable throughout.</summary>
    public async IAsyncEnumerable<Transaction> StreamAsync(
        string account, [EnumeratorCancellation] CancellationToken ct = default)
    {
        for (var offset = 0; offset < _total; offset += PageSize)
        {
            await Task.Delay(1, ct).ConfigureAwait(false);
            for (var i = 0; i < PageSize && offset + i < _total; i++)
            {
                Interlocked.Increment(ref _rowsFetched);
                yield return NewRow(offset + i);
            }
        }
    }

    private static Transaction NewRow(int i) =>
        new(i, $"TX-{i:D9}", 10.00m + i % 500, new DateOnly(2026, 1, 1).AddDays(i % 365));
}

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger has a CSV export endpoint. It was written like this, which is");
        Console.WriteLine("  how almost everyone writes it:");
        Console.WriteLine();
        Console.WriteLine("      var rows = await _repo.GetAllAsync(account, ct);");
        Console.WriteLine("      return File(ToCsv(rows), \"text/csv\");");
        Console.WriteLine();
        Console.WriteLine("  It ran for two years. The largest customer had 40,000 transactions");
        Console.WriteLine("  and the endpoint used about 12 MB, which nobody noticed.");
        Console.WriteLine();
        Console.WriteLine("  Then a customer was onboarded with 2 million transactions, and three");
        Console.WriteLine("  of their users clicked Export at the same time.");
        Console.WriteLine();
        Console.WriteLine("  account size    buffered MB   streamed MB   buffered TTFB   streamed TTFB");

        foreach (var size in new[] { 40_000, 400_000, 2_000_000 })
            Compare(size);

        Console.WriteLine();
        Console.WriteLine("  A caveat on the streamed column before reading the rest: it measures");
        Console.WriteLine("  the heap after the run WITHOUT forcing a collection, so it includes");
        Console.WriteLine("  uncollected garbage rather than only retained data. That is why the");
        Console.WriteLine("  first streamed row reads higher than the later ones despite holding");
        Console.WriteLine("  less. The signal is that it does NOT grow with account size, not the");
        Console.WriteLine("  absolute figure.");
        Console.WriteLine();
        Console.WriteLine("  The buffered column is linear in row count, which is the whole problem:");
        Console.WriteLine("  it is not bounded by anything the service controls. The container");
        Console.WriteLine("  limit was 512 MB. Three concurrent exports of the new customer's data");
        Console.WriteLine("  needed more than that between them, so the pod was OOM-killed — which");
        Console.WriteLine("  dropped every OTHER request in flight on that instance too.");
        Console.WriteLine();
        Console.WriteLine("  TTFB is time to first byte. Buffering cannot emit anything until it");
        Console.WriteLine("  has everything, so the client waits the full query time before seeing");
        Console.WriteLine("  a single byte, and a gateway with a 30 s header timeout gives up");
        Console.WriteLine("  before the response starts.");

        Console.WriteLine();
        Console.WriteLine("=== the fix, and what it does not fix ===");
        Console.WriteLine();
        Console.WriteLine("      await foreach (var tx in _repo.StreamAsync(account, ct))");
        Console.WriteLine("          await writer.WriteLineAsync(ToCsvLine(tx));");
        Console.WriteLine();
        Console.WriteLine("  Memory becomes constant: one page, regardless of account size. TTFB");
        Console.WriteLine("  becomes the cost of one page rather than of the whole table.");
        Console.WriteLine();
        Console.WriteLine("  What it does NOT fix, and this matters:");
        Console.WriteLine();
        Console.WriteLine("  1. TOTAL TIME is unchanged. Streaming moves work around; it does not");
        Console.WriteLine("     remove it. A 2 million row export still takes as long as it takes.");
        Console.WriteLine();
        Console.WriteLine("  2. The DATABASE CONNECTION is now held for the whole response, rather");
        Console.WriteLine("     than for the query. If the client is slow, your connection is held");
        Console.WriteLine("     at the client's pace. A buffered read frees the connection early;");
        Console.WriteLine("     a streamed one couples it to network conditions you do not");
        Console.WriteLine("     control. On a pool of 100 connections this is a real limit, and it");
        Console.WriteLine("     is the genuine argument AGAINST streaming.");
        Console.WriteLine();
        Console.WriteLine("  3. You cannot change the status code once you have started writing.");
        Console.WriteLine("     A failure at row 1,900,000 arrives as a truncated 200 response.");
        Console.WriteLine("     Anything that can fail must be checked BEFORE the first yield.");

        Console.WriteLine();
        Console.WriteLine("=== the failure that only appears when streaming ===");
        Console.WriteLine();
        var repo = new TransactionRepository(50_000);
        Console.WriteLine($"  buffered, throws at row 30,000 : {BufferedFailure(repo)}");
        Console.WriteLine($"  streamed, throws at row 30,000 : {StreamedFailure(repo)}");
        Console.WriteLine();
        Console.WriteLine("  The buffered version fails before it writes anything, so the client");
        Console.WriteLine("  gets a clean 500. The streamed version has already sent 200 OK and");
        Console.WriteLine("  30,000 valid rows; all it can do is stop mid-file.");
        Console.WriteLine();
        Console.WriteLine("  The client sees a successful response containing a valid CSV that is");
        Console.WriteLine("  missing 40% of its data, with nothing to indicate truncation. This is");
        Console.WriteLine("  worse than an error, because it will be reconciled against and");
        Console.WriteLine("  believed.");
        Console.WriteLine();
        Console.WriteLine("  Mitigations, in order of how much they actually help:");
        Console.WriteLine("    - Write a trailer row (a checksum, or a row count) and have the");
        Console.WriteLine("      consumer verify it. This is the only one that fully works.");
        Console.WriteLine("    - Use chunked transfer with a documented terminator.");
        Console.WriteLine("    - Validate everything you can before the first yield.");
        Console.WriteLine("    - Log the truncation loudly: your metrics are the only place the");
        Console.WriteLine("      failure exists at all.");

        Console.WriteLine();
        Console.WriteLine("=== how the leak was found ===");
        Console.WriteLine();
        Console.WriteLine("  The pod restarted with no stack trace. Container OOM kills do not");
        Console.WriteLine("  produce one: the kernel stops the process and .NET never runs.");
        Console.WriteLine();
        Console.WriteLine("    kubectl describe pod ledger-api-7d4f    ->  Reason: OOMKilled");
        Console.WriteLine("    dotnet-counters monitor --process-id <pid> System.Runtime");
        Console.WriteLine("      gc-heap-size          spikes to the limit, then the pod dies");
        Console.WriteLine("      gen-2-gc-count        rising sharply immediately before");
        Console.WriteLine("      alloc-rate            very high during a single request");
        Console.WriteLine();
        Console.WriteLine("    dotnet-gcdump collect --process-id <pid>   (during, not after)");
        Console.WriteLine("      -> one List<Transaction> with millions of entries, rooted by a");
        Console.WriteLine("         request handler.");
        Console.WriteLine();
        Console.WriteLine("  The distinguishing signature: memory correlates with REQUEST SIZE");
        Console.WriteLine("  rather than with request COUNT. A leak grows with total requests and");
        Console.WriteLine("  never falls; this spikes on one request and returns to normal. That");
        Console.WriteLine("  difference tells you to look for buffering rather than for a leak,");
        Console.WriteLine("  and it is the fastest way to tell the two apart.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static void Compare(int size)
    {
        var repo = new TransactionRepository(size);

        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var sw = Stopwatch.StartNew();
        var rows = repo.GetAllAsync("ACC-1").GetAwaiter().GetResult();
        var bufferedTtfb = sw.Elapsed.TotalMilliseconds;
        var bufferedMb = (GC.GetTotalMemory(false) - before) / 1024.0 / 1024.0;
        _sink += rows.Count;
        rows = null!;

        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        before = GC.GetTotalMemory(true);
        var streamedTtfb = StreamFirst(repo);
        var streamedMb = (GC.GetTotalMemory(false) - before) / 1024.0 / 1024.0;

        Console.WriteLine($"  {size,12:N0}   {bufferedMb,11:N1}   {streamedMb,11:N1}   " +
                          $"{bufferedTtfb,13:N0}   {streamedTtfb,13:N0}");
    }

    static double StreamFirst(TransactionRepository repo) =>
        StreamFirstCore(repo).GetAwaiter().GetResult();

    static async Task<double> StreamFirstCore(TransactionRepository repo)
    {
        var sw = Stopwatch.StartNew();
        var first = -1.0;
        await foreach (var tx in repo.StreamAsync("ACC-1").ConfigureAwait(false))
        {
            if (first < 0) first = sw.Elapsed.TotalMilliseconds;
            _sink += tx.Id;
        }
        return first;
    }

    static string BufferedFailure(TransactionRepository repo)
    {
        try
        {
            var rows = repo.GetAllAsync("ACC-1").GetAwaiter().GetResult();
            if (rows.Count > 30_000) throw new InvalidOperationException("reader failed at row 30,000");
            return "completed";
        }
        catch (InvalidOperationException)
        {
            return "threw before writing anything -> clean 500";
        }
    }

    static string StreamedFailure(TransactionRepository repo) =>
        StreamedFailureCore(repo).GetAwaiter().GetResult();

    static async Task<string> StreamedFailureCore(TransactionRepository repo)
    {
        var written = 0;
        try
        {
            await foreach (var tx in repo.StreamAsync("ACC-1").ConfigureAwait(false))
            {
                if (written == 30_000) throw new InvalidOperationException("reader failed");
                written++;
                _sink += tx.Id;
            }
            return "completed";
        }
        catch (InvalidOperationException)
        {
            return $"already sent 200 OK and {written:N0} rows -> truncated file";
        }
    }
}
