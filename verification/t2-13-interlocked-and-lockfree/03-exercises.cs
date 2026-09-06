// 03-exercises.cs — every answer claimed in this module's exercises, run.
// Timings are ratios; counts and correctness are exact.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

class Program
{
    static int _counter;
    static long _a, _b;
    static readonly object Gate = new();

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: what does each call return? =====");
        Console.WriteLine();
        var v = 10;
        Console.WriteLine($"  v = {v}");
        Console.WriteLine($"  Interlocked.Increment(ref v)         -> {Interlocked.Increment(ref v),3}   v = {v}");
        Console.WriteLine($"  Interlocked.Add(ref v, 5)            -> {Interlocked.Add(ref v, 5),3}   v = {v}");
        Console.WriteLine($"  Interlocked.Exchange(ref v, 99)      -> {Interlocked.Exchange(ref v, 99),3}   v = {v}");
        var cas = Interlocked.CompareExchange(ref v, 7, 99);
        Console.WriteLine($"  CompareExchange(ref v, 7, 99)        -> {cas,3}   v = {v}");
        Console.WriteLine();
        Console.WriteLine("  Increment, Decrement and Add return the value AFTER. Exchange and");
        Console.WriteLine("  CompareExchange return the value BEFORE.");
        Console.WriteLine();
        Console.WriteLine("  That asymmetry is deliberate. The before-value is the only thing that");
        Console.WriteLine("  tells you whether YOU were the thread that made the change — which is");
        Console.WriteLine("  the entire basis of every lock-free algorithm.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: write Max without a lock =====");
        Console.WriteLine();
        Console.WriteLine("  Interlocked has no Max. Build one.");
        Console.WriteLine();
        var (max, retries) = LockFreeMax();
        Console.WriteLine($"    result {max:N0}, CAS retries {retries:N0}");
        Console.WriteLine();
        Console.WriteLine("      long current;");
        Console.WriteLine("      do");
        Console.WriteLine("      {");
        Console.WriteLine("          current = Volatile.Read(ref max);");
        Console.WriteLine("          if (candidate <= current) break;      // nothing to do");
        Console.WriteLine("      }");
        Console.WriteLine("      while (CompareExchange(ref max, candidate, current) != current);");
        Console.WriteLine();
        Console.WriteLine("  Two details carry the correctness. The read must be INSIDE the loop —");
        Console.WriteLine("  a retry means someone changed it, so you must re-read rather than");
        Console.WriteLine("  retry with a stale value. And the early break matters as much as the");
        Console.WriteLine("  CAS: it is why the retry count above is what it is.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: predict the retry counts =====");
        Console.WriteLine();
        Console.WriteLine("  Two CAS loops, 8 threads, 20,000 iterations each.");
        Console.WriteLine();
        Console.WriteLine("  workload                     retries");
        Console.WriteLine($"  Max  (value converges)  {retries,12:N0}");
        var (sum, sumRetries) = LockFreeSum();
        Console.WriteLine($"  Sum  (every op swaps)   {sumRetries,12:N0}   (result {sum:N0})");
        Console.WriteLine();
        Console.WriteLine("  Max barely retries: once the running maximum is near its final value,");
        Console.WriteLine("  almost every thread reads it, finds its candidate smaller, and never");
        Console.WriteLine("  attempts a swap.");
        Console.WriteLine();
        Console.WriteLine("  Sum retries more times than there are operations. Every thread must");
        Console.WriteLine("  swap every time, so eight threads collide continuously.");
        Console.WriteLine();
        Console.WriteLine("  The question before writing a CAS loop is therefore not 'is this");
        Console.WriteLine("  faster than a lock' — it is 'how often will two threads collide on");
        Console.WriteLine("  this location'. Rarely: excellent. Constantly: worse than the lock.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: is this thread-safe? =====");
        Console.WriteLine();
        Console.WriteLine("      Interlocked.Increment(ref _count);");
        Console.WriteLine("      Interlocked.Add(ref _total, value);");
        Console.WriteLine("      // reader: _total / _count");
        Console.WriteLine();
        var (torn, trials) = TornPair();
        Console.WriteLine($"    reader observed an impossible value in {torn} of {trials} trials");
        Console.WriteLine();
        Console.WriteLine("  No. Both writes are atomic; the PAIR is not. A reader can take the");
        Console.WriteLine("  count, then the total, with a writer completing both updates in");
        Console.WriteLine("  between — dividing a newer total by an older count.");
        Console.WriteLine();
        Console.WriteLine("  ATOMIC IS NOT TRANSACTIONAL. Interlocked makes one location");
        Console.WriteLine("  indivisible. Two locations agreeing with each other is a different");
        Console.WriteLine("  property that no sequence of Interlocked calls provides.");
        Console.WriteLine();
        Console.WriteLine("  Two fixes: a lock around both, or put both fields in one immutable");
        Console.WriteLine("  object and swap the whole thing with a single CompareExchange.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: which is faster? =====");
        Console.WriteLine();
        Console.WriteLine("  A counter, 8 threads, one shared location:");
        var casMs = Contended(useLock: false);
        var lockMs = Contended(useLock: true);
        Console.WriteLine($"    Interlocked.Increment  {1.0,6:N2}x  (baseline)");
        Console.WriteLine($"    lock {{ ++ }}            {lockMs / casMs,6:N2}x");
        Console.WriteLine();
        Console.WriteLine("  A snapshot object, 8 threads, CAS loop against a lock:");
        var (snapLock, snapCas) = SnapshotCost();
        Console.WriteLine($"    lock                   {1.0,6:N2}x  (baseline)");
        Console.WriteLine($"    CAS on a snapshot      {snapCas / snapLock,6:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Interlocked wins the first and LOSES the second, decisively. The");
        Console.WriteLine("  difference is what a loser does. On a single Increment there is no");
        Console.WriteLine("  loser — the hardware serialises and everyone succeeds. In a CAS loop");
        Console.WriteLine("  the loser allocates, recomputes and tries again, and under contention");
        Console.WriteLine("  most threads lose most of the time.");
        Console.WriteLine();
        Console.WriteLine("  So 'lock-free is faster' is true for exactly one shape: a single");
        Console.WriteLine("  location updated by a single hardware instruction.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: make this correct without a lock =====");
        Console.WriteLine();
        Console.WriteLine("  Two fields that must agree, updated by many threads, read by many:");
        Console.WriteLine();
        Console.WriteLine("      record Snapshot(long Count, long Total);");
        Console.WriteLine("      private Snapshot _current = new(0, 0);");
        Console.WriteLine();
        Console.WriteLine("      var observed = Volatile.Read(ref _current);");
        Console.WriteLine("      var next = new Snapshot(observed.Count + 1, observed.Total + x);");
        Console.WriteLine("      CompareExchange(ref _current, next, observed);   // retry on failure");
        Console.WriteLine();
        var (snapTorn, snapTrials) = SnapshotTorn();
        Console.WriteLine($"    reader observed an impossible value in {snapTorn} of {snapTrials} trials");
        Console.WriteLine();
        Console.WriteLine("  The invariant moves INSIDE one object, so one atomic reference swap");
        Console.WriteLine("  publishes both fields together. A reader takes one volatile read and");
        Console.WriteLine("  sees a consistent pair, with no lock on the read path at all.");
        Console.WriteLine();
        Console.WriteLine("  Three conditions, and all three are load-bearing:");
        Console.WriteLine("    - the snapshot must be IMMUTABLE, or you have published a reference");
        Console.WriteLine("      to state that can still change");
        Console.WriteLine("    - it must hold no mutable field, including arrays");
        Console.WriteLine("    - the writer must re-read inside the retry loop, never reuse the");
        Console.WriteLine("      stale observed value");
        Console.WriteLine();
        Console.WriteLine("  And it is SLOWER than a lock for writes, measured above. Use it when");
        Console.WriteLine("  reads massively outnumber writes, because readers pay nothing.");
    }

    // --- Exercises 2 and 3 ----------------------------------------------------
    static (long, int) LockFreeMax()
    {
        long max = 0;
        var retries = 0;
        Parallel8(seed =>
        {
            var k = seed;
            for (var i = 0; i < 20_000; i++)
            {
                k = (k * 1103515245 + 12345) & int.MaxValue;
                long candidate = k % 1_000_000;
                long current;
                do
                {
                    current = Volatile.Read(ref max);
                    if (candidate <= current) break;
                    if (Interlocked.CompareExchange(ref max, candidate, current) == current) break;
                    Interlocked.Increment(ref retries);
                }
                while (true);
            }
        });
        return (max, retries);
    }

    static (long, int) LockFreeSum()
    {
        long total = 0;
        var retries = 0;
        Parallel8(_ =>
        {
            for (var i = 0; i < 20_000; i++)
            {
                while (true)
                {
                    var current = Volatile.Read(ref total);
                    if (Interlocked.CompareExchange(ref total, current + 1, current) == current) break;
                    Interlocked.Increment(ref retries);
                }
            }
        });
        return (total, retries);
    }

    // --- Exercise 4 -----------------------------------------------------------
    static (int, int) TornPair()
    {
        const int Trials = 20;
        var torn = 0;
        for (var t = 0; t < Trials; t++)
        {
            Volatile.Write(ref _a, 0);
            Volatile.Write(ref _b, 0);
            var stop = new CancellationTokenSource();
            var saw = false;

            var writer = new Thread(() =>
            {
                while (!stop.IsCancellationRequested)
                {
                    Interlocked.Increment(ref _a);
                    Interlocked.Add(ref _b, 1_000);
                }
            }) { IsBackground = true };

            var reader = new Thread(() =>
            {
                while (!stop.IsCancellationRequested)
                {
                    var count = Volatile.Read(ref _a);
                    var total = Volatile.Read(ref _b);
                    if (count > 0 && total / count != 1_000) { saw = true; return; }
                }
            }) { IsBackground = true };

            writer.Start(); reader.Start();
            Thread.Sleep(20);
            stop.Cancel();
            writer.Join(500); reader.Join(500);
            if (saw) torn++;
        }
        return (torn, Trials);
    }

    // --- Exercise 6 -----------------------------------------------------------
    sealed record Snapshot(long Count, long Total);

    static (int, int) SnapshotTorn()
    {
        const int Trials = 20;
        var torn = 0;
        for (var t = 0; t < Trials; t++)
        {
            var current = new Snapshot(0, 0);
            var stop = new CancellationTokenSource();
            var saw = false;

            var writer = new Thread(() =>
            {
                while (!stop.IsCancellationRequested)
                {
                    while (true)
                    {
                        var observed = Volatile.Read(ref current);
                        var next = new Snapshot(observed.Count + 1, observed.Total + 1_000);
                        if (Interlocked.CompareExchange(ref current, next, observed) == observed) break;
                    }
                }
            }) { IsBackground = true };

            var reader = new Thread(() =>
            {
                while (!stop.IsCancellationRequested)
                {
                    var s = Volatile.Read(ref current);
                    if (s.Count > 0 && s.Total / s.Count != 1_000) { saw = true; return; }
                }
            }) { IsBackground = true };

            writer.Start(); reader.Start();
            Thread.Sleep(20);
            stop.Cancel();
            writer.Join(500); reader.Join(500);
            if (saw) torn++;
        }
        return (torn, Trials);
    }

    // --- Exercise 5 -----------------------------------------------------------
    static double Contended(bool useLock)
    {
        Thread.Sleep(80);
        _counter = 0;
        var sw = Stopwatch.StartNew();
        Parallel8(_ =>
        {
            for (var i = 0; i < 300_000; i++)
            {
                if (useLock) { lock (Gate) { _counter++; } }
                else Interlocked.Increment(ref _counter);
            }
        });
        return sw.Elapsed.TotalMilliseconds;
    }

    static (double lockMs, double casMs) SnapshotCost()
    {
        Thread.Sleep(80);
        var gate = new object();
        var count = 0L; var total = 0L;
        var sw = Stopwatch.StartNew();
        Parallel8(_ =>
        {
            for (var i = 0; i < 100_000; i++)
                lock (gate) { count++; total += 1_000; }
        });
        var lockMs = sw.Elapsed.TotalMilliseconds;

        Thread.Sleep(80);
        var current = new Snapshot(0, 0);
        sw = Stopwatch.StartNew();
        Parallel8(_ =>
        {
            for (var i = 0; i < 100_000; i++)
            {
                while (true)
                {
                    var observed = Volatile.Read(ref current);
                    var next = new Snapshot(observed.Count + 1, observed.Total + 1_000);
                    if (Interlocked.CompareExchange(ref current, next, observed) == observed) break;
                }
            }
        });
        return (lockMs, sw.Elapsed.TotalMilliseconds);
    }

    static void Parallel8(Action<int> body)
    {
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        for (var t = 0; t < 8; t++)
        {
            var seed = t * 7919 + 1;
            threads[t] = new Thread(() => { ready.Wait(); body(seed); });
            threads[t].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
    }
}
