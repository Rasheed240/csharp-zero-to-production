// 02-granularity.cs — how much a lock protects decides how much it costs. One
// global lock, striped locks, and per-key locks over identical work.
//
// A NOTE ON WHAT IS QUOTED. Absolute milliseconds here vary run to run by 20% or
// more and are not worth memorising. Every claim in this file is stated as a
// RATIO against the single-lock baseline, plus Monitor.LockContentionCount,
// which counts the times a thread actually had to wait rather than how long it
// took. That count is the stable number.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-granularity.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int Threads = 8;
    const int OpsPerThread = 200_000;
    const int Buckets = 4_096;

    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== the workload ===");
        Console.WriteLine();
        Console.WriteLine($"  {Threads} threads x {OpsPerThread:N0} operations against {Buckets:N0}");
        Console.WriteLine("  independent counters. No two threads need the same counter most of");
        Console.WriteLine("  the time, so almost all of the contention is manufactured by the");
        Console.WriteLine("  locking scheme rather than required by the data.");
        Console.WriteLine();
        Console.WriteLine("  scheme                       relative time   contentions   correct?");

        var baseline = Run("one global lock", new GlobalLock());
        Report("one global lock", baseline, baseline);
        Report("16 striped locks", Run("16 striped locks", new StripedLock(16)), baseline);
        Report("256 striped locks", Run("256 striped locks", new StripedLock(256)), baseline);
        Report("one lock per bucket", Run("one lock per bucket", new PerBucketLock(Buckets)), baseline);
        Report("Interlocked, no lock", Run("Interlocked, no lock", new InterlockedCounters()), baseline);

        Console.WriteLine();
        Console.WriteLine("=== reading this ===");
        Console.WriteLine();
        Console.WriteLine("  CONTENTIONS is the column that explains the others. It is");
        Console.WriteLine("  Monitor.LockContentionCount: the number of times a thread arrived at");
        Console.WriteLine("  a held monitor and had to wait. It is a count, not a duration, so it");
        Console.WriteLine("  is stable across runs in a way the timings are not.");
        Console.WriteLine();
        Console.WriteLine("  ONE GLOBAL LOCK serialises everything. Eight threads take turns, so");
        Console.WriteLine("  the parallelism you paid for is spent waiting. This is the shape that");
        Console.WriteLine("  makes people conclude that locks are slow — the lock is not slow, the");
        Console.WriteLine("  design is serial.");
        Console.WriteLine();
        Console.WriteLine("  STRIPING maps many keys onto a small fixed set of locks by hash. It");
        Console.WriteLine("  removes most contention for a bounded, predictable amount of memory,");
        Console.WriteLine("  and it is what ConcurrentDictionary did before .NET Core 3.0.");
        Console.WriteLine();
        Console.WriteLine("  ONE LOCK PER BUCKET removes almost all remaining contention and costs");
        Console.WriteLine("  one object per bucket. At 4,096 buckets that is cheap; at ten million");
        Console.WriteLine("  keys it is not, and striping is the answer.");
        Console.WriteLine();
        Console.WriteLine("  INTERLOCKED needs no lock object at all for a counter. It is the");
        Console.WriteLine("  fastest row and the least general: it works because incrementing an");
        Console.WriteLine("  int is one of the few operations the hardware makes atomic. Anything");
        Console.WriteLine("  needing two fields updated together goes back to a lock (t2-13).");

        Console.WriteLine();
        Console.WriteLine("=== the shape of the trade-off ===");
        Console.WriteLine();
        Console.WriteLine("  granularity      contention   memory        risk");
        Console.WriteLine("  one lock         highest      one object    none - trivially correct");
        Console.WriteLine("  striped          low          fixed, small  two keys can share a lock");
        Console.WriteLine("  per key          lowest       one per key   unbounded; ordering bugs");
        Console.WriteLine();
        Console.WriteLine("  Finer is not automatically better. Every extra lock is another thing");
        Console.WriteLine("  that can be taken in the wrong order, which is the deadlock in");
        Console.WriteLine("  03-deadlock.cs — and a design with ONE lock cannot deadlock against");
        Console.WriteLine("  itself at all.");
        Console.WriteLine();
        Console.WriteLine("  The order to try things in:");
        Console.WriteLine("    1. one lock, until a profiler shows contention");
        Console.WriteLine("    2. stripe it, which is usually enough");
        Console.WriteLine("    3. per-key locks only with a documented ordering rule");
        Console.WriteLine("    4. lock-free only with a benchmark proving it was worth it");

        Console.WriteLine();
        Console.WriteLine("=== holding a lock for longer than you need ===");
        Console.WriteLine();
        Console.WriteLine("  The same total work, with an expensive pure computation done inside");
        Console.WriteLine("  the lock and then outside it:");
        Console.WriteLine();
        var inside = TimeScope(insideLock: true);
        var outside = TimeScope(insideLock: false);
        Console.WriteLine($"  computed inside the lock  : {inside / outside,5:N2}x the time of doing it outside");
        Console.WriteLine();
        Console.WriteLine("  Nothing about the computation needs protecting — it reads no shared");
        Console.WriteLine("  state. Moving it out shortens the critical section, and the critical");
        Console.WriteLine("  section is the only part that serialises.");
        Console.WriteLine();
        Console.WriteLine("  This is the highest-value lock optimisation and it costs nothing:");
        Console.WriteLine("  compute into locals, then take the lock only to publish the result.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    interface ICounters
    {
        void Increment(int key);
        long Total { get; }
    }

    sealed class GlobalLock : ICounters
    {
        private readonly object _gate = new();
        private readonly long[] _counts = new long[Buckets];
        public void Increment(int key) { lock (_gate) { _counts[key]++; } }
        public long Total { get { long t = 0; foreach (var c in _counts) t += c; return t; } }
    }

    sealed class StripedLock : ICounters
    {
        private readonly object[] _gates;
        private readonly long[] _counts = new long[Buckets];
        public StripedLock(int stripes)
        {
            _gates = new object[stripes];
            for (var i = 0; i < stripes; i++) _gates[i] = new object();
        }
        public void Increment(int key)
        {
            // & (length - 1) works because the stripe count is a power of two.
            lock (_gates[key & (_gates.Length - 1)]) { _counts[key]++; }
        }
        public long Total { get { long t = 0; foreach (var c in _counts) t += c; return t; } }
    }

    sealed class PerBucketLock : ICounters
    {
        private readonly object[] _gates;
        private readonly long[] _counts;
        public PerBucketLock(int buckets)
        {
            _gates = new object[buckets];
            _counts = new long[buckets];
            for (var i = 0; i < buckets; i++) _gates[i] = new object();
        }
        public void Increment(int key) { lock (_gates[key]) { _counts[key]++; } }
        public long Total { get { long t = 0; foreach (var c in _counts) t += c; return t; } }
    }

    sealed class InterlockedCounters : ICounters
    {
        private readonly long[] _counts = new long[Buckets];
        public void Increment(int key) => Interlocked.Increment(ref _counts[key]);
        public long Total { get { long t = 0; foreach (var c in _counts) t += c; return t; } }
    }

    readonly record struct Result(double Ms, long Contentions, bool Correct);

    static Result Run(string _, ICounters counters)
    {
        Thread.Sleep(120);
        var beforeContentions = Monitor.LockContentionCount;
        var sw = Stopwatch.StartNew();

        var threads = new Thread[Threads];
        var ready = new ManualResetEventSlim(false);
        for (var t = 0; t < Threads; t++)
        {
            var seed = t * 7919;
            threads[t] = new Thread(() =>
            {
                ready.Wait();
                var k = seed;
                for (var i = 0; i < OpsPerThread; i++)
                {
                    k = (k * 1103515245 + 12345) & int.MaxValue;   // cheap spread
                    counters.Increment(k % Buckets);
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();

        var expected = (long)Threads * OpsPerThread;
        return new Result(sw.Elapsed.TotalMilliseconds,
                          Monitor.LockContentionCount - beforeContentions,
                          counters.Total == expected);
    }

    static void Report(string label, Result r, Result baseline) =>
        Console.WriteLine($"  {label,-28} {r.Ms / baseline.Ms,13:N2}x   {r.Contentions,11:N0}   " +
                          $"{(r.Correct ? "yes" : "NO")}");

    static double TimeScope(bool insideLock)
    {
        var gate = new object();
        long total = 0;
        var threads = new Thread[Threads];
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();

        for (var t = 0; t < Threads; t++)
        {
            threads[t] = new Thread(() =>
            {
                ready.Wait();
                for (var i = 0; i < 4_000; i++)
                {
                    if (insideLock)
                    {
                        lock (gate) { total += Expensive(i); }
                    }
                    else
                    {
                        var v = Expensive(i);            // no shared state read
                        lock (gate) { total += v; }
                    }
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();
        _sink += total;
        return sw.Elapsed.TotalMilliseconds;
    }

    static long Expensive(int seed)
    {
        var h = seed;
        for (var i = 0; i < 400; i++) h = HashCode.Combine(h, i);
        return h & 0xFF;
    }
}
