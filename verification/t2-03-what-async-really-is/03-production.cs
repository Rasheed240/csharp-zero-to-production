// 03-production.cs — a Ledger endpoint under load, three ways, showing what
// async actually buys: not latency for one request, but capacity for many.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Api;

public sealed record Invoice(string Number, decimal AmountMinor);

/// <summary>Three downstream calls a settlement endpoint makes per request.</summary>
public sealed class Downstreams
{
    public const int DbMs = 25;
    public const int GatewayMs = 60;
    public const int AuditMs = 15;

    public void ReadInvoiceSync(string _) => Thread.Sleep(DbMs);
    public void AuthoriseSync(string _) => Thread.Sleep(GatewayMs);
    public void WriteAuditSync(string _) => Thread.Sleep(AuditMs);

    public Task ReadInvoiceAsync(string _, CancellationToken ct = default) => Task.Delay(DbMs, ct);
    public Task AuthoriseAsync(string _, CancellationToken ct = default) => Task.Delay(GatewayMs, ct);
    public Task WriteAuditAsync(string _, CancellationToken ct = default) => Task.Delay(AuditMs, ct);
}

class Program
{
    static readonly Downstreams Down = new();
    const int Ideal = Downstreams.DbMs + Downstreams.GatewayMs + Downstreams.AuditMs;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        Console.WriteLine($"one request = {Downstreams.DbMs} + {Downstreams.GatewayMs} + " +
                          $"{Downstreams.AuditMs} = {Ideal} ms of waiting, ~0 ms of CPU");
        Console.WriteLine();
        Console.WriteLine("A single request cannot go faster than 100 ms either way. What");
        Console.WriteLine("changes with load is how many can be in flight at once.");
        Console.WriteLine();
        Console.WriteLine("  concurrent   sync: total  p99  OS threads      async: total  p99  OS threads");

        foreach (var concurrency in new[] { 1, 8, 50, 200 })
        {
            var s = Measure(concurrency, sync: true);
            var a = Measure(concurrency, sync: false);
            Console.WriteLine($"  {concurrency,10}   {s.total,10:N0} {s.p99,6:N0} {s.threads,10}      " +
                              $"{a.total,10:N0} {a.p99,6:N0} {a.threads,10}");
        }

        Console.WriteLine();
        Console.WriteLine("--- reading it ---");
        Console.WriteLine();
        Console.WriteLine("  At concurrency 1 they are the same. Async did not make the");
        Console.WriteLine("  request faster and never will: the 100 ms is the downstream's,");
        Console.WriteLine("  not yours.");
        Console.WriteLine();
        Console.WriteLine("  At 200 the sync version takes 25x longer in TOTAL — and note");
        Console.WriteLine("  what the thread count did NOT do. It did not climb to 200. The");
        Console.WriteLine("  pool refused, at the injection rate measured in t2-02, so the");
        Console.WriteLine("  requests QUEUED instead. Sync does not consume 200 threads here;");
        Console.WriteLine("  it consumes 18 and makes everyone else wait.");
        Console.WriteLine();
        Console.WriteLine("  NOW LOOK AT THE p99 COLUMN. It says 125 ms for the sync run that");
        Console.WriteLine("  took 2.6 seconds. That is not a bug in the measurement — it is the");
        Console.WriteLine("  measurement most services actually take. The stopwatch starts when");
        Console.WriteLine("  the work item begins RUNNING, after it has been dequeued, so the");
        Console.WriteLine("  queueing time is invisible to it.");
        Console.WriteLine();
        Console.WriteLine("  A latency metric that starts inside the handler will report a");
        Console.WriteLine("  perfectly healthy service while requests wait seconds to reach");
        Console.WriteLine("  that handler. If your p99 looks fine and your users disagree,");
        Console.WriteLine("  check where the clock starts.");
        Console.WriteLine();
        Console.WriteLine("  THAT is the trade. Async buys capacity, not speed. A team that");
        Console.WriteLine("  measures it with one request concludes it does nothing, and a");
        Console.WriteLine("  team that measures under load concludes it is essential. Both");
        Console.WriteLine("  measured correctly.");

        Console.WriteLine();
        Console.WriteLine("--- and the sequential-await trap, in the same endpoint ---");
        var seq = TimeOne(() => HandleAsync("INV-1").GetAwaiter().GetResult());
        var par = TimeOne(() => HandleAsyncOverlapped("INV-1").GetAwaiter().GetResult());
        Console.WriteLine($"  three awaits in sequence          : {seq,6:N0} ms");
        Console.WriteLine($"  audit started before authorise    : {par,6:N0} ms");
        Console.WriteLine("  Being async does not overlap anything by itself. These two");
        Console.WriteLine("  methods are both fully async; only one of them is concurrent.");
        Console.WriteLine("  (The read must finish first — it produces the invoice. The audit");
        Console.WriteLine("  write does not depend on the authorisation, so it can overlap.)");
    }

    static void HandleSync(string number)
    {
        Down.ReadInvoiceSync(number);
        Down.AuthoriseSync(number);
        Down.WriteAuditSync(number);
    }

    static async Task HandleAsync(string number)
    {
        await Down.ReadInvoiceAsync(number).ConfigureAwait(false);
        await Down.AuthoriseAsync(number).ConfigureAwait(false);
        await Down.WriteAuditAsync(number).ConfigureAwait(false);
    }

    static async Task HandleAsyncOverlapped(string number)
    {
        await Down.ReadInvoiceAsync(number).ConfigureAwait(false);
        var authorise = Down.AuthoriseAsync(number);
        var audit = Down.WriteAuditAsync(number);
        await Task.WhenAll(authorise, audit).ConfigureAwait(false);
    }

    static (double total, double p99, int threads) Measure(int concurrency, bool sync)
    {
        Thread.Sleep(600);
        var proc = Process.GetCurrentProcess();
        proc.Refresh();
        var startThreads = proc.Threads.Count;
        var peak = startThreads;
        using var sampler = new Timer(_ =>
        {
            var p = Process.GetCurrentProcess();
            p.Refresh();
            if (p.Threads.Count > peak) peak = p.Threads.Count;
        }, null, 0, 5);

        var latencies = new double[concurrency];
        var sw = Stopwatch.StartNew();

        if (sync)
        {
            var done = new CountdownEvent(concurrency);
            for (var i = 0; i < concurrency; i++)
            {
                var n = i;
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    var w = Stopwatch.StartNew();
                    HandleSync($"INV-{n}");
                    latencies[n] = w.Elapsed.TotalMilliseconds;
                    done.Signal();
                });
            }
            done.Wait();
        }
        else
        {
            Task.WhenAll(Enumerable.Range(0, concurrency).Select(async n =>
            {
                var w = Stopwatch.StartNew();
                await HandleAsync($"INV-{n}").ConfigureAwait(false);
                latencies[n] = w.Elapsed.TotalMilliseconds;
            })).GetAwaiter().GetResult();
        }

        sw.Stop();
        Array.Sort(latencies);
        var p99 = latencies[(int)Math.Min(latencies.Length - 1, latencies.Length * 0.99)];
        // Absolute peak, not a delta. The pool keeps threads between runs, so a
        // delta credits a later run with threads an earlier one created. The
        // baseline here is ~15 runtime threads.
        return (sw.Elapsed.TotalMilliseconds, p99, peak);
    }

    static double TimeOne(Action a)
    {
        a();
        var sw = Stopwatch.StartNew();
        a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }
}
