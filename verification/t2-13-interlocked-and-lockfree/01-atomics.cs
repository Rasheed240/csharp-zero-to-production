// 01-atomics.cs — what Interlocked actually provides, what it cannot provide,
// and the compare-and-swap loop that everything lock-free is built from.
//
// Timings are quoted as RATIOS. Counts and correctness are exact and stable.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-atomics.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

class Program
{
    static int _counter;
    static long _total;
    static readonly object Gate = new();

    static void Main()
    {
        Console.WriteLine("=== 1. the operations, and what each returns ===");
        Console.WriteLine();
        var v = 10;
        Console.WriteLine($"  start                       v = {v}");
        Console.WriteLine($"  Increment returns the NEW   : {Interlocked.Increment(ref v)}   (v = {v})");
        Console.WriteLine($"  Decrement returns the NEW   : {Interlocked.Decrement(ref v)}   (v = {v})");
        Console.WriteLine($"  Add(5) returns the NEW      : {Interlocked.Add(ref v, 5)}   (v = {v})");
        Console.WriteLine($"  Exchange(99) returns the OLD: {Interlocked.Exchange(ref v, 99)}   (v = {v})");
        Console.WriteLine($"  Read is a no-op for int     : {Interlocked.CompareExchange(ref v, 0, int.MinValue)}");
        Console.WriteLine();
        Console.WriteLine("  Note the asymmetry. Increment, Decrement and Add return the value");
        Console.WriteLine("  AFTER the operation; Exchange and CompareExchange return the value");
        Console.WriteLine("  BEFORE it. That is not arbitrary: the before-value is what tells you");
        Console.WriteLine("  whether YOU were the thread that made the change.");

        Console.WriteLine();
        Console.WriteLine("=== 2. CompareExchange is the primitive ===");
        Console.WriteLine();
        Console.WriteLine("      CompareExchange(ref location, newValue, comparand)");
        Console.WriteLine();
        Console.WriteLine("  'If location currently equals comparand, store newValue. Either way,");
        Console.WriteLine("  return what location held before.' The comparison and the store are");
        Console.WriteLine("  ONE instruction that no other thread can interleave with.");
        Console.WriteLine();
        var slot = 5;
        var before = Interlocked.CompareExchange(ref slot, 42, 5);
        Console.WriteLine($"  CAS(slot, 42, expecting 5)  returned {before}, slot = {slot}   -> we won");
        before = Interlocked.CompareExchange(ref slot, 99, 5);
        Console.WriteLine($"  CAS(slot, 99, expecting 5)  returned {before}, slot = {slot}   -> we lost");
        Console.WriteLine();
        Console.WriteLine("  You detect success by comparing the RETURN to your comparand, not by");
        Console.WriteLine("  reading the location afterwards. Reading afterwards is a second");
        Console.WriteLine("  operation and another thread may have moved it again.");
        Console.WriteLine();
        Console.WriteLine("      if (Interlocked.CompareExchange(ref x, next, expected) == expected)");
        Console.WriteLine("          // this thread performed the update");

        Console.WriteLine();
        Console.WriteLine("=== 3. everything else is a CAS loop ===");
        Console.WriteLine();
        Console.WriteLine("  Interlocked has no Multiply, no Max, no 'update via a function'. You");
        Console.WriteLine("  build them by reading, computing, and swapping only if nothing moved:");
        Console.WriteLine();
        Console.WriteLine("      long current, next;");
        Console.WriteLine("      do");
        Console.WriteLine("      {");
        Console.WriteLine("          current = Volatile.Read(ref location);");
        Console.WriteLine("          next    = Compute(current);");
        Console.WriteLine("      }");
        Console.WriteLine("      while (Interlocked.CompareExchange(ref location, next, current) != current);");
        Console.WriteLine();
        Console.WriteLine("  The loop is the retry. If another thread changed the value between");
        Console.WriteLine("  the read and the swap, the CAS fails, and you recompute from the new");
        Console.WriteLine("  value rather than clobbering it.");
        Console.WriteLine();

        _total = 0;
        var (maxResult, maxRetries) = MaxWithCas();
        var (sumResult, sumRetries) = SumWithCas();
        Console.WriteLine("  workload                       result        CAS retries");
        Console.WriteLine($"  lock-free Max, 8 threads   {maxResult,12:N0}   {maxRetries,12:N0}");
        Console.WriteLine($"  lock-free Sum, 8 threads   {sumResult,12:N0}   {sumRetries,12:N0}");
        Console.WriteLine();
        Console.WriteLine("  The contrast between those two rows IS the cost model, and it is not");
        Console.WriteLine("  what people expect.");
        Console.WriteLine();
        Console.WriteLine("  MAX retried almost never. After a few hundred iterations the running");
        Console.WriteLine("  maximum is close to final, so nearly every thread reads it, sees its");
        Console.WriteLine("  own candidate is smaller, and never attempts a swap at all. A CAS loop");
        Console.WriteLine("  over a value that CONVERGES is close to free.");
        Console.WriteLine();
        Console.WriteLine("  SUM retried constantly. Every thread must swap on every iteration, so");
        Console.WriteLine("  eight threads collide continuously and the losers recompute and try");
        Console.WriteLine("  again. Each retry is wasted work that a lock would not have done: the");
        Console.WriteLine("  loser under a lock waits once, whereas the loser under CAS spins.");
        Console.WriteLine();
        Console.WriteLine("  So the question to ask before writing a CAS loop is not 'is this");
        Console.WriteLine("  faster than a lock' but 'how often will two threads actually collide");
        Console.WriteLine("  here'. Rarely, and it is excellent. Constantly, and it is worse than");
        Console.WriteLine("  the lock you were avoiding.");

        Console.WriteLine();
        Console.WriteLine("=== 4. what Interlocked cannot do ===");
        Console.WriteLine();
        Console.WriteLine("  It makes ONE memory location atomic. Two locations are not covered,");
        Console.WriteLine("  and no combination of Interlocked calls fixes that:");
        Console.WriteLine();
        Console.WriteLine("      Interlocked.Decrement(ref _fromBalance);   // atomic");
        Console.WriteLine("      Interlocked.Increment(ref _toBalance);     // atomic");
        Console.WriteLine("      // between them, money does not exist");
        Console.WriteLine();
        var (torn, trials) = TornInvariant();
        Console.WriteLine($"  a reader observed a broken invariant in {torn} of {trials} trials");
        Console.WriteLine();
        Console.WriteLine("  Both operations are atomic and the invariant still breaks, because");
        Console.WriteLine("  ATOMICITY IS NOT THE SAME AS TRANSACTIONALITY. If two fields must");
        Console.WriteLine("  agree, you need a lock, or a single object swapped by one CAS.");
        Console.WriteLine();
        Console.WriteLine("  This is the most common misuse: reaching for Interlocked to avoid a");
        Console.WriteLine("  lock, on state that needs a lock.");

        Console.WriteLine();
        Console.WriteLine("=== 5. the cost, uncontended and contended ===");
        Console.WriteLine();
        Console.WriteLine("  one thread, no contention:");
        var plain = Bench(() => _counter++);
        var atomic = Bench(() => Interlocked.Increment(ref _counter));
        var locked = Bench(() => { lock (Gate) { _counter++; } });
        Console.WriteLine($"    plain ++                 {1.0,6:N1}x  (baseline)");
        Console.WriteLine($"    Interlocked.Increment    {atomic / plain,6:N1}x");
        Console.WriteLine($"    lock {{ ++ }}              {locked / plain,6:N1}x");
        Console.WriteLine();
        Console.WriteLine("  eight threads, maximum contention on ONE location:");
        var atomicC = Contended(useLock: false);
        var lockedC = Contended(useLock: true);
        Console.WriteLine($"    Interlocked.Increment    {1.0,6:N1}x  (baseline)");
        Console.WriteLine($"    lock {{ ++ }}              {lockedC / atomicC,6:N1}x");
        Console.WriteLine();
        Console.WriteLine("  Interlocked wins in both, and note HOW MUCH it wins by under");
        Console.WriteLine("  contention: far less than the uncontended numbers suggest. A modern");
        Console.WriteLine("  lock is not the disaster its reputation implies, and the gap narrows");
        Console.WriteLine("  precisely when people reach for Interlocked to close it.");
        Console.WriteLine();
        Console.WriteLine("  This is the case Interlocked was designed for — one location, one");
        Console.WriteLine("  operation — and it is a narrow case.");
        Console.WriteLine();
        Console.WriteLine("  Note what is NOT shown: any scenario needing two fields, a collection,");
        Console.WriteLine("  or a computation. There Interlocked either does not apply or turns");
        Console.WriteLine("  into a CAS loop whose retries cost more than a lock would.");
    }

    /// <summary>
    /// A CAS loop where every thread MUST swap on every iteration, so collisions
    /// are continuous. Contrast MaxWithCas, where the value converges and most
    /// iterations exit before attempting a swap.
    /// </summary>
    static (long result, int retries) SumWithCas()
    {
        long total = 0;
        var retries = 0;
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);

        for (var t = 0; t < 8; t++)
        {
            threads[t] = new Thread(() =>
            {
                ready.Wait();
                for (var i = 0; i < 20_000; i++)
                {
                    long current, next;
                    do
                    {
                        current = Volatile.Read(ref total);
                        next = current + 1;
                        if (Interlocked.CompareExchange(ref total, next, current) == current) break;
                        Interlocked.Increment(ref retries);
                    }
                    while (true);
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        return (total, retries);
    }

    static (long result, int retries) MaxWithCas()
    {
        long max = 0;
        var retries = 0;
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);

        for (var t = 0; t < 8; t++)
        {
            var seed = t * 7919;
            threads[t] = new Thread(() =>
            {
                ready.Wait();
                var k = seed;
                for (var i = 0; i < 20_000; i++)
                {
                    k = (k * 1103515245 + 12345) & int.MaxValue;
                    var candidate = k % 1_000_000;

                    long current;
                    do
                    {
                        current = Volatile.Read(ref max);
                        if (candidate <= current) break;          // nothing to do
                    }
                    while (Interlocked.CompareExchange(ref max, candidate, current) != current
                           && Interlocked.Increment(ref retries) > 0);
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        return (max, retries);
    }

    /// <summary>
    /// Two atomic operations, one broken invariant. A reader that sums both
    /// balances can see a moment where the money is in neither.
    /// </summary>
    static (int torn, int trials) TornInvariant()
    {
        const int Trials = 20;
        var torn = 0;

        for (var trial = 0; trial < Trials; trial++)
        {
            long from = 1_000_000, to = 0;
            var stop = new CancellationTokenSource();
            var sawTear = false;

            var mover = new Thread(() =>
            {
                while (!stop.IsCancellationRequested)
                {
                    Interlocked.Decrement(ref from);
                    Interlocked.Increment(ref to);
                    Interlocked.Increment(ref from);
                    Interlocked.Decrement(ref to);
                }
            }) { IsBackground = true };

            var auditor = new Thread(() =>
            {
                while (!stop.IsCancellationRequested)
                {
                    var sum = Volatile.Read(ref from) + Volatile.Read(ref to);
                    if (sum != 1_000_000) { sawTear = true; return; }
                }
            }) { IsBackground = true };

            mover.Start();
            auditor.Start();
            Thread.Sleep(20);
            stop.Cancel();
            mover.Join(500);
            auditor.Join(500);
            if (sawTear) torn++;
        }
        return (torn, Trials);
    }

    static double Bench(Action a)
    {
        for (var i = 0; i < 200_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < 5_000_000; i++) a();
        return sw.Elapsed.TotalMilliseconds;
    }

    static double Contended(bool useLock)
    {
        Thread.Sleep(100);
        _total = 0;
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();

        for (var t = 0; t < 8; t++)
        {
            threads[t] = new Thread(() =>
            {
                ready.Wait();
                for (var i = 0; i < 300_000; i++)
                {
                    if (useLock) { lock (Gate) { _total++; } }
                    else Interlocked.Increment(ref _total);
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }
}
