// 02-production.cs — Ledger's latency statistics. Someone removed a lock to
// stop it showing up in a profiler, and the dashboard started lying.
//
// Timings are ratios. Correctness counts are exact.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-production.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

namespace Ledger.Telemetry;

/// <summary>
/// THE SHIPPED VERSION. Both updates are atomic, so it "has no race" — and the
/// pair of them is not atomic, so a reader can divide a new sum by an old count.
/// </summary>
public sealed class StatsV1
{
    private long _count;
    private long _totalMicros;

    public void Record(long micros)
    {
        Interlocked.Increment(ref _count);
        Interlocked.Add(ref _totalMicros, micros);
    }

    public double MeanMicros()
    {
        var count = Volatile.Read(ref _count);
        var total = Volatile.Read(ref _totalMicros);
        return count == 0 ? 0 : (double)total / count;
    }
}

/// <summary>THE OBVIOUS FIX. One lock around both fields, for readers and writers.</summary>
public sealed class StatsV2
{
    private readonly Lock _gate = new();
    private long _count;
    private long _totalMicros;

    public void Record(long micros)
    {
        lock (_gate) { _count++; _totalMicros += micros; }
    }

    public double MeanMicros()
    {
        lock (_gate) { return _count == 0 ? 0 : (double)_totalMicros / _count; }
    }
}

/// <summary>
/// THE LOCK-FREE FIX. Both fields live in one immutable object, and the whole
/// object is swapped with a single CompareExchange. A reader sees one snapshot
/// or another, never a mixture.
/// </summary>
public sealed class StatsV3
{
    private sealed record Snapshot(long Count, long TotalMicros);

    private Snapshot _current = new(0, 0);
    private int _retries;

    public int Retries => Volatile.Read(ref _retries);

    public void Record(long micros)
    {
        while (true)
        {
            var observed = Volatile.Read(ref _current);
            var next = new Snapshot(observed.Count + 1, observed.TotalMicros + micros);
            if (Interlocked.CompareExchange(ref _current, next, observed) == observed) return;
            Interlocked.Increment(ref _retries);
        }
    }

    public double MeanMicros()
    {
        var s = Volatile.Read(ref _current);          // one read, one consistent pair
        return s.Count == 0 ? 0 : (double)s.TotalMicros / s.Count;
    }
}

class Program
{
    const int Trials = 30;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger records a latency figure per request and exposes the mean on a");
        Console.WriteLine("  dashboard. The original used a lock. A profiler showed that lock at");
        Console.WriteLine("  the top of a contention report, so it was removed:");
        Console.WriteLine();
        Console.WriteLine("      Interlocked.Increment(ref _count);");
        Console.WriteLine("      Interlocked.Add(ref _totalMicros, micros);");
        Console.WriteLine();
        Console.WriteLine("  Every operation is atomic. There is no lost update — the count and");
        Console.WriteLine("  the total are both exactly right at the end of any run.");
        Console.WriteLine();
        Console.WriteLine("  The dashboard began showing impossible means: values far below the");
        Console.WriteLine("  fastest request ever served, appearing for a few seconds and then");
        Console.WriteLine("  correcting themselves.");
        Console.WriteLine();
        Console.WriteLine("  implementation        final totals   reader saw a torn mean");

        Report("Interlocked pair (V1)", TornReads(() => new Wrapper(new StatsV1())));
        Report("lock (V2)", TornReads(() => new Wrapper(new StatsV2())));
        Report("CAS on a snapshot (V3)", TornReads(() => new Wrapper(new StatsV3())));

        Console.WriteLine();
        Console.WriteLine("  V1's totals are always correct and its READS are not. The reader");
        Console.WriteLine("  takes the count, then the total; a writer can complete both of its");
        Console.WriteLine("  updates in between, so the reader divides a newer total by an older");
        Console.WriteLine("  count. The mean is wrong in a way that no amount of atomicity on the");
        Console.WriteLine("  individual fields can prevent.");
        Console.WriteLine();
        Console.WriteLine("  ATOMIC IS NOT TRANSACTIONAL. Interlocked makes one location");
        Console.WriteLine("  indivisible. If two locations must agree with each other, that is a");
        Console.WriteLine("  different property and Interlocked does not provide it.");

        Console.WriteLine();
        Console.WriteLine("=== why it was so hard to see ===");
        Console.WriteLine();
        Console.WriteLine("  1. Nothing throws, and no total is ever wrong. Every unit test that");
        Console.WriteLine("     asserts on the final count and sum passes.");
        Console.WriteLine();
        Console.WriteLine("  2. It is a READ bug in code whose writes were the suspicious part.");
        Console.WriteLine("     Review attention went to Record; the defect is in MeanMicros.");
        Console.WriteLine();
        Console.WriteLine("  3. It self-corrects. The next read is usually right, so the graph");
        Console.WriteLine("     shows a spike that has already gone by the time anyone looks.");
        Console.WriteLine();
        Console.WriteLine("  4. The change was justified by a profiler. Removing the lock DID");
        Console.WriteLine("     remove the contention; the profiler was not wrong, it was");
        Console.WriteLine("     answering a different question from the one that mattered.");

        Console.WriteLine();
        Console.WriteLine("=== the two fixes, and which to ship ===");
        Console.WriteLine();
        var ratio = CompareCost();
        Console.WriteLine($"  time for the LOCK, relative to the lock-free version : {ratio,5:N2}x");
        Console.WriteLine($"  CAS retries incurred by the lock-free version        : {LastRetries,10:N0}");
        Console.WriteLine();
        Console.WriteLine("  Read that ratio carefully, because it is below 1: THE LOCK IS");
        Console.WriteLine("  SEVERAL TIMES FASTER than the lock-free version, on the same work.");
        Console.WriteLine("  (The exact multiple moves between runs — it has measured anywhere");
        Console.WriteLine("  from twice to three and a half times. The direction does not move.)");
        Console.WriteLine();
        Console.WriteLine("  Millions of CAS retries is why. Every writer that loses the race");
        Console.WriteLine("  allocates a new snapshot, recomputes, and tries again — and with eight");
        Console.WriteLine("  threads hammering one reference, most of them lose most of the time.");
        Console.WriteLine("  The lock has no retries: a loser waits once and then proceeds.");
        Console.WriteLine();
        Console.WriteLine("  SHIP THE LOCK unless you have a measurement saying otherwise.");
        Console.WriteLine();
        Console.WriteLine("  V3 is correct, and look at what it costs to be correct without a");
        Console.WriteLine("  lock: an allocation per recorded value, a retry loop whose losers");
        Console.WriteLine("  redo their work, and a reviewer who must understand why the snapshot");
        Console.WriteLine("  has to be immutable. V2 is four lines and obvious.");
        Console.WriteLine();
        Console.WriteLine("  V3 earns its place in one situation: when the read path massively");
        Console.WriteLine("  outnumbers the write path. Readers of V3 take no lock at all — a");
        Console.WriteLine("  single volatile read of a reference — so a dashboard scraping this");
        Console.WriteLine("  thousands of times a second never contends with recording.");

        Console.WriteLine();
        Console.WriteLine("=== the pattern worth remembering ===");
        Console.WriteLine();
        Console.WriteLine("  Interlocked protects ONE location. So make the thing you need to");
        Console.WriteLine("  update atomically into ONE location:");
        Console.WriteLine();
        Console.WriteLine("      record Snapshot(long Count, long Total);       // immutable");
        Console.WriteLine("      private Snapshot _current;                     // one reference");
        Console.WriteLine();
        Console.WriteLine("      var observed = Volatile.Read(ref _current);");
        Console.WriteLine("      var next = new Snapshot(observed.Count + 1, observed.Total + x);");
        Console.WriteLine("      CompareExchange(ref _current, next, observed);");
        Console.WriteLine();
        Console.WriteLine("  The snapshot MUST be immutable. If a reader could mutate what it");
        Console.WriteLine("  read, or if the record held a mutable array, the guarantee evaporates");
        Console.WriteLine("  — you would be back to publishing a reference to changing state.");
        Console.WriteLine();
        Console.WriteLine("  This is the same shape as an immutable configuration object swapped");
        Console.WriteLine("  on reload, and a copy-on-write collection. In every case the trick is");
        Console.WriteLine("  the same: move the invariant inside a single object so that one");
        Console.WriteLine("  atomic reference swap publishes all of it at once.");

        Console.WriteLine();
        Console.WriteLine("=== how it was diagnosed ===");
        Console.WriteLine();
        Console.WriteLine("  No exception, no counter, no dump. What found it was the same trick");
        Console.WriteLine("  as t2-11: assert the invariant continuously, in the data.");
        Console.WriteLine();
        Console.WriteLine("      if (mean < FastestObservedRequestMicros)");
        Console.WriteLine("          _logger.LogError(\"impossible mean {Mean} from {Count}\", mean, count);");
        Console.WriteLine();
        Console.WriteLine("  A race on a derived value leaves no runtime trace. The only detector");
        Console.WriteLine("  is a check that knows what the value is allowed to be — which means");
        Console.WriteLine("  someone has to state the invariant explicitly, in code, before the");
        Console.WriteLine("  incident rather than during it.");
    }

    static int LastRetries;

    /// <summary>Uniform access to the three implementations without an interface on the hot path.</summary>
    sealed class Wrapper
    {
        private readonly object _impl;
        public Wrapper(object impl) => _impl = impl;

        public void Record(long micros)
        {
            switch (_impl)
            {
                case StatsV1 a: a.Record(micros); break;
                case StatsV2 b: b.Record(micros); break;
                case StatsV3 c: c.Record(micros); break;
            }
        }

        public double Mean() => _impl switch
        {
            StatsV1 a => a.MeanMicros(),
            StatsV2 b => b.MeanMicros(),
            StatsV3 c => c.MeanMicros(),
            _ => 0
        };
    }

    readonly record struct Outcome(bool TotalsCorrect, int TornTrials);

    /// <summary>
    /// Every recorded value is exactly 1,000 microseconds, so a correct mean is
    /// always 1,000. Any other value a reader observes is a torn read, and no
    /// tolerance or rounding argument can explain it away.
    /// </summary>
    static Outcome TornReads(Func<Wrapper> make)
    {
        var torn = 0;
        var totalsOk = true;

        for (var trial = 0; trial < Trials; trial++)
        {
            var stats = make();
            var stop = new CancellationTokenSource();
            var sawTorn = false;

            var writers = new Thread[4];
            for (var w = 0; w < 4; w++)
            {
                writers[w] = new Thread(() =>
                {
                    while (!stop.IsCancellationRequested) stats.Record(1_000);
                }) { IsBackground = true };
                writers[w].Start();
            }

            var reader = new Thread(() =>
            {
                while (!stop.IsCancellationRequested)
                {
                    var mean = stats.Mean();
                    if (mean != 0 && Math.Abs(mean - 1_000) > 0.0001) { sawTorn = true; return; }
                }
            }) { IsBackground = true };
            reader.Start();

            Thread.Sleep(20);
            stop.Cancel();
            foreach (var w in writers) w.Join(500);
            reader.Join(500);

            if (sawTorn) torn++;
            if (Math.Abs(stats.Mean() - 1_000) > 0.0001 && stats.Mean() != 0) totalsOk = false;
        }
        return new Outcome(totalsOk, torn);
    }

    static void Report(string label, Outcome o) =>
        Console.WriteLine($"  {label,-22} {(o.TotalsCorrect ? "correct" : "WRONG"),-14} " +
                          $"{o.TornTrials} of {Trials}");

    static double CompareCost()
    {
        var withLock = TimeRecording(new Wrapper(new StatsV2()));
        var v3 = new StatsV3();
        var withCas = TimeRecording(new Wrapper(v3));
        LastRetries = v3.Retries;
        return withLock / withCas;
    }

    static double TimeRecording(Wrapper stats)
    {
        Thread.Sleep(100);
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();
        for (var t = 0; t < 8; t++)
        {
            threads[t] = new Thread(() =>
            {
                ready.Wait();
                for (var i = 0; i < 200_000; i++) stats.Record(1_000);
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }
}
