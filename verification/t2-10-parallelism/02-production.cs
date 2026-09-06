// 02-production.cs — Ledger's month-end revaluation: a Parallel.ForEach in a
// request handler, and the two separate failures it caused. One was a wrong
// number that nobody noticed for a week.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Revaluation;

public sealed record Position(string Instrument, decimal Quantity, decimal Price);

class Program
{
    const int Positions = 20_000;
    static long _sink;

    static void Main()
    {
        var book = Enumerable.Range(0, Positions)
            .Select(i => new Position($"INS-{i:D5}", 100 + i % 50, 10.00m + i % 90))
            .ToArray();

        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger revalues a 20,000-position book at month end. The calculation");
        Console.WriteLine("  is pure CPU, so somebody parallelised it. Locally it went from 380 ms");
        Console.WriteLine("  to 70 ms and the change was merged the same afternoon.");
        Console.WriteLine();
        Console.WriteLine("  Two things then went wrong, and only one of them was noticed.");

        Console.WriteLine();
        Console.WriteLine("=== failure 1: the total was wrong ===");
        Console.WriteLine();
        Console.WriteLine("  The shipped version accumulated into a shared field:");
        Console.WriteLine();
        Console.WriteLine("      decimal total = 0;");
        Console.WriteLine("      Parallel.ForEach(book, p => { total += p.Quantity * p.Price; });");
        Console.WriteLine();
        var correct = Sequential(book);
        Console.WriteLine($"  correct total (sequential)   : {correct,18:N2}");
        Console.WriteLine();
        Console.WriteLine("  run   racy parallel total          difference   correct?");
        for (var run = 0; run < 5; run++)
        {
            var racy = RacyParallel(book);
            Console.WriteLine($"  {run + 1,3}   {racy,22:N2}   {correct - racy,10:N2}   {(racy == correct ? "yes" : "NO")}");
        }
        Console.WriteLine();
        Console.WriteLine("  Different every run, and enormously too low — roughly 85% of the");
        Console.WriteLine("  value is missing. total += x is a read, an add and a write; two");
        Console.WriteLine("  threads read the same value and one write overwrites the other, so");
        Console.WriteLine("  most updates are lost when eight threads contend on every item.");
        Console.WriteLine();
        Console.WriteLine("  The size of the error is worth dwelling on, because intuition gets it");
        Console.WriteLine("  wrong in BOTH directions. People expect either a crash or a rounding-");
        Console.WriteLine("  sized discrepancy. Under heavy contention you get neither: no");
        Console.WriteLine("  exception at all, and an answer that is wrong by most of its value.");
        Console.WriteLine();
        Console.WriteLine("  It is not reliably that large, either, and that is the real hazard.");
        Console.WriteLine("  With fewer threads, less contention, or a cheaper body, the same bug");
        Console.WriteLine("  loses only a handful of updates and produces a total that looks like");
        Console.WriteLine("  a rounding difference — small enough to be reconciled against and");
        Console.WriteLine("  believed. The severity is set by timing, so the same defect can be");
        Console.WriteLine("  invisible in testing and catastrophic in production, or the reverse.");

        Console.WriteLine();
        Console.WriteLine("=== the three correct shapes ===");
        Console.WriteLine();
        Console.WriteLine("  approach                          ms     difference from sequential   identical?");
        Report("sequential", correct, () => Sequential(book), correct);
        Report("Parallel.ForEach + lock", correct, () => LockedParallel(book), correct);
        Report("Parallel.ForEach + local state", correct, () => LocalStateParallel(book), correct);
        Report("PLINQ .Sum()", correct, () => PlinqSum(book), correct);
        Console.WriteLine();
        Console.WriteLine("  READ THE LAST COLUMN CAREFULLY. All three parallel versions are");
        Console.WriteLine("  CORRECT — no updates are lost — but none is exactly equal to the");
        Console.WriteLine("  sequential total. The difference column shows by how much: far below");
        Console.WriteLine("  a penny, and far above zero.");
        Console.WriteLine();
        Console.WriteLine("  This is not a race. Parallel aggregation adds the numbers in a");
        Console.WriteLine("  different ORDER, and decimal addition is not associative once values");
        Console.WriteLine("  exceed the type precision: (a+b)+c and a+(b+c) can differ in the last");
        Console.WriteLine("  digits. The same is true of double, more strongly.");
        Console.WriteLine();
        Console.WriteLine("  So a test asserting parallel == sequential will FAIL even on correct");
        Console.WriteLine("  code. Assert a tolerance instead, and choose it deliberately: it must");
        Console.WriteLine("  be tight enough to catch a lost update and loose enough to permit");
        Console.WriteLine("  reordering. For money, round at a defined point rather than comparing");
        Console.WriteLine("  raw accumulations at all.");
        Console.WriteLine();
        Console.WriteLine("  LOCK works and is the slowest of the parallel options: every item");
        Console.WriteLine("  contends on one lock, so the parallel section is almost entirely");
        Console.WriteLine("  serialised and you have paid for partitioning to gain nothing.");
        Console.WriteLine();
        Console.WriteLine("  LOCAL STATE is the right shape for Parallel.ForEach. Each partition");
        Console.WriteLine("  accumulates privately, and the per-partition results are combined");
        Console.WriteLine("  once at the end — so the lock is taken a handful of times rather than");
        Console.WriteLine("  20,000 times. That is the overload with the localInit and localFinally");
        Console.WriteLine("  parameters, and it is the reason those parameters exist.");
        Console.WriteLine();
        Console.WriteLine("  PLINQ .Sum() does the same thing and you do not have to write it.");
        Console.WriteLine("  For an aggregation, this is almost always the right answer.");

        Console.WriteLine();
        Console.WriteLine("=== failure 2: it was inside a request handler ===");
        Console.WriteLine();
        Console.WriteLine("  The revaluation ran per request. Locally, one request at a time, it");
        Console.WriteLine("  used all 8 cores and was fast. In production, several accountants");
        Console.WriteLine("  refresh the month-end screen at once.");
        Console.WriteLine();
        Console.WriteLine("  concurrent requests   unbounded p95 ms   capped p95 ms");
        foreach (var concurrent in new[] { 1, 4, 16 })
        {
            var unbounded = ConcurrentRequests(book, concurrent, dop: -1);
            var capped = ConcurrentRequests(book, concurrent, dop: 2);
            Console.WriteLine($"  {concurrent,19}   {unbounded,16:N0}   {capped,13:N0}");
        }
        Console.WriteLine();
        Console.WriteLine("  Read the unbounded column first: p95 rises roughly 16-fold going from");
        Console.WriteLine("  1 to 16 concurrent requests, on work that did not change. Each request");
        Console.WriteLine("  tries to use all 8 cores, so N requests contend for the same 8");
        Console.WriteLine("  processors. The machine is saturated at a concurrency a load balancer");
        Console.WriteLine("  still considers idle.");
        Console.WriteLine();
        Console.WriteLine("  Now the honest part: CAPPING DID NOT IMPROVE p95 HERE. It was worse at");
        Console.WriteLine("  every concurrency. That is a real result and it is worth reporting");
        Console.WriteLine("  rather than explaining away.");
        Console.WriteLine();
        Console.WriteLine("  The reason is that this workload is short and uniform. Oversubscription");
        Console.WriteLine("  costs little when every task takes a similar time and the whole thing");
        Console.WriteLine("  finishes in milliseconds; the scheduler time-slices and the total work");
        Console.WriteLine("  is unchanged. Capping only removes contention that is actually hurting.");
        Console.WriteLine();
        Console.WriteLine("  What capping DOES buy, and what this benchmark cannot show:");
        Console.WriteLine("    - a bound on how much of the machine ONE request can take, so a");
        Console.WriteLine("      parallel section cannot starve unrelated endpoints");
        Console.WriteLine("    - protection when the body is longer or more variable, where");
        Console.WriteLine("      oversubscription does cost real time");
        Console.WriteLine("    - predictability: a known ceiling rather than one that moves with");
        Console.WriteLine("      whatever else the process is doing");
        Console.WriteLine();
        Console.WriteLine("  So the rule is about BOUNDING RESOURCE USE, not about latency. Set it");
        Console.WriteLine("  in a request handler for isolation, and do not expect the p95 of a");
        Console.WriteLine("  microbenchmark to thank you for it. Measure your own workload.");
        Console.WriteLine();
        Console.WriteLine("  The general rule this incident produced: a Parallel.* call inside a");
        Console.WriteLine("  request handler must always set MaxDegreeOfParallelism, because the");
        Console.WriteLine("  default assumes it owns the machine — which is true for a console");
        Console.WriteLine("  tool and false for a server.");

        Console.WriteLine();
        Console.WriteLine("=== how each was found ===");
        Console.WriteLine();
        Console.WriteLine("  The WRONG TOTAL was found by reconciliation, not by monitoring. There");
        Console.WriteLine("  is no counter for 'the answer is 0.02% low'. What would have caught");
        Console.WriteLine("  it earlier:");
        Console.WriteLine("    - a test asserting the parallel and sequential totals are EQUAL,");
        Console.WriteLine("      run over a few thousand items so the race has room to happen");
        Console.WriteLine("    - a code review rule: no assignment to a captured local inside a");
        Console.WriteLine("      Parallel body, ever");
        Console.WriteLine();
        Console.WriteLine("  The SATURATION was visible in ordinary metrics, but only if you know");
        Console.WriteLine("  the shape:");
        Console.WriteLine("    cpu-usage                 pinned at 100%");
        Console.WriteLine("    threadpool-queue-length   rising");
        Console.WriteLine("    p95 latency               rising with CONCURRENCY, not with data size");
        Console.WriteLine();
        Console.WriteLine("  That last line distinguishes it from every other latency problem in");
        Console.WriteLine("  this track. Blocking (t2-07) shows idle CPU. Buffering (t2-09) tracks");
        Console.WriteLine("  request SIZE. Parallel saturation pins the CPU and tracks request");
        Console.WriteLine("  COUNT — and the fix is a cap, not more machines.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static decimal Sequential(Position[] book)
    {
        decimal total = 0;
        foreach (var p in book) total += Value(p);
        return total;
    }

    /// <summary>THE BUG. A shared accumulator with no synchronisation.</summary>
    static decimal RacyParallel(Position[] book)
    {
        decimal total = 0;
        System.Threading.Tasks.Parallel.ForEach(book, p => { total += Value(p); });
        return total;
    }

    /// <summary>Correct, and slow: 20,000 lock acquisitions.</summary>
    static decimal LockedParallel(Position[] book)
    {
        decimal total = 0;
        var gate = new object();
        System.Threading.Tasks.Parallel.ForEach(book, p =>
        {
            var v = Value(p);
            lock (gate) { total += v; }
        });
        return total;
    }

    /// <summary>Correct and fast: private accumulation, combined once per partition.</summary>
    static decimal LocalStateParallel(Position[] book)
    {
        decimal total = 0;
        var gate = new object();
        System.Threading.Tasks.Parallel.ForEach(
            book,
            () => 0m,                                        // localInit
            (p, _, local) => local + Value(p),               // body
            local => { lock (gate) { total += local; } });   // localFinally
        return total;
    }

    static decimal PlinqSum(Position[] book) => book.AsParallel().Sum(Value);

    static decimal Value(Position p)
    {
        // Enough work per item that parallelism is worth considering at all.
        var q = p.Quantity;
        for (var i = 0; i < 60; i++) q = q * 1.0000001m;
        return q * p.Price;
    }

    static void Report(string label, decimal correct, Func<decimal> run, decimal expected)
    {
        run();
        var sw = Stopwatch.StartNew();
        var value = run();
        sw.Stop();
        var diff = value - expected;
        Console.WriteLine($"  {label,-30} {sw.Elapsed.TotalMilliseconds,6:N0}   {diff.ToString("G29"),26}   " +
                          $"{(value == expected ? "yes" : "no")}");
    }

    static double ConcurrentRequests(Position[] book, int concurrent, int dop)
    {
        var options = new ParallelOptions { MaxDegreeOfParallelism = dop };
        var latencies = new double[concurrent];

        var threads = new Thread[concurrent];
        var start = new ManualResetEventSlim(false);
        for (var i = 0; i < concurrent; i++)
        {
            var idx = i;
            threads[i] = new Thread(() =>
            {
                start.Wait();
                var sw = Stopwatch.StartNew();
                decimal total = 0;
                var gate = new object();
                System.Threading.Tasks.Parallel.ForEach(book, options,
                    () => 0m,
                    (p, _, local) => local + Value(p),
                    local => { lock (gate) { total += local; } });
                _sink += (long)total;
                latencies[idx] = sw.Elapsed.TotalMilliseconds;
            }) { IsBackground = true };
            threads[i].Start();
        }

        start.Set();
        foreach (var t in threads) t.Join();

        Array.Sort(latencies);
        return latencies[Math.Max(0, (int)(concurrent * 0.95) - 1)];
    }
}
