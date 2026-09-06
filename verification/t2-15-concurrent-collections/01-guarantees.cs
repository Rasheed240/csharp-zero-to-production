// 01-guarantees.cs — what a concurrent collection actually promises, which is
// narrower than "safe to use from many threads". The composition gap, GetOrAdd
// re-entrancy, and what enumeration gives you.
//
// Counts and correctness are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-guarantees.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        Console.WriteLine("=== 1. what the guarantee actually is ===");
        Console.WriteLine();
        Console.WriteLine("  'Thread-safe' means: EACH METHOD is atomic with respect to the");
        Console.WriteLine("  others. TryAdd either adds or does not. TryRemove either removes or");
        Console.WriteLine("  does not. The collection cannot be corrupted.");
        Console.WriteLine();
        Console.WriteLine("  It does NOT mean any sequence of your calls is atomic. That is a");
        Console.WriteLine("  different property and nothing provides it for you.");
        Console.WriteLine();
        var (composed, trials) = ComposedOperation();
        Console.WriteLine($"  ContainsKey then Add, 8 threads : wrong in {composed} of {trials} trials");
        var (atomic, _) = AtomicOperation();
        Console.WriteLine($"  TryAdd alone                    : wrong in {atomic} of {trials} trials");
        Console.WriteLine();
        Console.WriteLine("  Both use a ConcurrentDictionary. The first composes two atomic calls");
        Console.WriteLine("  and has a gap between them; the second is one call and has none.");
        Console.WriteLine("  The collection is doing its job in both cases.");

        Console.WriteLine();
        Console.WriteLine("=== 2. the atomic operations, and what they return ===");
        Console.WriteLine();
        var d = new ConcurrentDictionary<string, int>();
        Console.WriteLine($"  TryAdd(\"a\", 1)                 -> {d.TryAdd("a", 1)}   (added)");
        Console.WriteLine($"  TryAdd(\"a\", 2)                 -> {d.TryAdd("a", 2)}   (already present)");
        Console.WriteLine($"  GetOrAdd(\"a\", 9)               -> {d.GetOrAdd("a", 9)}      (existing value)");
        Console.WriteLine($"  GetOrAdd(\"b\", 5)               -> {d.GetOrAdd("b", 5)}      (added)");
        Console.WriteLine($"  AddOrUpdate(\"a\", 0, (k,v)=>v+10) -> {d.AddOrUpdate("a", 0, (k, v) => v + 10)}");
        Console.WriteLine($"  TryUpdate(\"a\", 99, comparison 11) -> {d.TryUpdate("a", 99, 11)}");
        Console.WriteLine($"  TryRemove(\"b\", out var removed)  -> {d.TryRemove("b", out var removed)}, value {removed}");
        Console.WriteLine();
        Console.WriteLine("  Every one of those is a single atomic operation. Anything you need");
        Console.WriteLine("  that is not on this list is a composition, and composition is where");
        Console.WriteLine("  the bugs are.");

        Console.WriteLine();
        Console.WriteLine("=== 3. GetOrAdd does not promise the factory runs once ===");
        Console.WriteLine();
        var (factoryCalls, distinctValues) = GetOrAddFactory();
        Console.WriteLine($"  200 threads, one missing key:");
        Console.WriteLine($"    factory invocations : {factoryCalls}");
        Console.WriteLine($"    distinct values seen by callers : {distinctValues}");
        Console.WriteLine();
        Console.WriteLine("  The factory ran more than once and every caller still got the SAME");
        Console.WriteLine("  value. That is exactly the guarantee: one value wins, and the losing");
        Console.WriteLine("  factory results are discarded.");
        Console.WriteLine();
        Console.WriteLine("  Harmless when the factory is pure. A disaster when it is not — a");
        Console.WriteLine("  factory that opens a connection, charges a card or writes a file has");
        Console.WriteLine("  done that work several times, and only one result is kept.");
        Console.WriteLine();
        Console.WriteLine("  The fix is to store a Lazy<T>, so the dictionary races on cheap");
        Console.WriteLine("  objects and Lazy guarantees single execution of the expensive part:");
        Console.WriteLine();
        var lazyCalls = GetOrAddLazy();
        Console.WriteLine($"    with Lazy<T>, factory invocations : {lazyCalls}");

        Console.WriteLine();
        Console.WriteLine("=== 4. Count and enumeration are snapshots, not locks ===");
        Console.WriteLine();
        var (enumerated, changedDuring) = EnumerateWhileWriting();
        Console.WriteLine($"  enumerating a ConcurrentDictionary while 4 threads write:");
        Console.WriteLine($"    threw               : no");
        Console.WriteLine($"    items seen          : {enumerated:N0}");
        Console.WriteLine($"    items added meanwhile: {changedDuring:N0}");
        Console.WriteLine();
        Console.WriteLine("  It does not throw, which is the whole difference from Dictionary");
        Console.WriteLine("  (t2-12 measured 20 of 40 trials throwing there). What you get is a");
        Console.WriteLine("  MOVING VIEW: entries added during enumeration may or may not appear.");
        Console.WriteLine();
        Console.WriteLine("  So enumeration is safe and not consistent. If you need a stable view");
        Console.WriteLine("  — to compute a total, or to serialise the contents — use ToArray(),");
        Console.WriteLine("  which takes an internal snapshot under the collection locks.");
        Console.WriteLine();
        Console.WriteLine("  Count is a separate trap in the same area:");
        Console.WriteLine();
        Console.WriteLine($"    Count against IsEmpty, same dictionary : {CountCost():N2}x");
        Console.WriteLine();
        Console.WriteLine("  Count is not a cheap field. On ConcurrentDictionary it acquires every");
        Console.WriteLine("  internal lock to get an exact answer, so calling it in a hot loop or");
        Console.WriteLine("  a per-request metric is a genuine cost — and IsEmpty is the cheap");
        Console.WriteLine("  alternative when you only need to know whether anything is there.");

        Console.WriteLine();
        Console.WriteLine("=== 5. the collections, and what each is for ===");
        Console.WriteLine();
        Console.WriteLine("  ConcurrentDictionary<K,V>  keyed state. The one you will actually use.");
        Console.WriteLine("  ConcurrentQueue<T>         FIFO. Producer/consumer where order matters.");
        Console.WriteLine("  ConcurrentStack<T>         LIFO. Object pools, work stealing.");
        Console.WriteLine("  ConcurrentBag<T>           unordered, THREAD-AFFINE. See below.");
        Console.WriteLine("  BlockingCollection<T>      a wrapper adding blocking and bounding.");
        Console.WriteLine();
        var (sameMs, stealMs) = BagAffinity();
        Console.WriteLine("  ConcurrentBag, 200,000 items, drained two ways:");
        Console.WriteLine($"    drained by the thread that added them : {1.0,5:N2}x  (baseline)");
        Console.WriteLine($"    drained by a different thread         : {stealMs / sameMs,5:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Both drains return every item — a bag is correct either way. What");
        Console.WriteLine("  differs is the cost, because a bag keeps a per-thread list and");
        Console.WriteLine("  prefers your own. Taking from another thread's list is a STEAL, and");
        Console.WriteLine("  it needs synchronisation that the local path avoids.");
        Console.WriteLine();
        Console.WriteLine("  So a bag is fast when producers are also consumers, and a poor queue");
        Console.WriteLine("  when a dedicated consumer drains what other threads produced — which");
        Console.WriteLine("  is the shape most people reach for it in. Use ConcurrentQueue there.");
        Console.WriteLine();
        Console.WriteLine("  BlockingCollection deserves one note: it is the OLD answer for");
        Console.WriteLine("  producer/consumer, and its Take() BLOCKS a thread. For async code");
        Console.WriteLine("  Channels (t2-14) replace it entirely — same job, no blocked threads,");
        Console.WriteLine("  and a bound you choose.");
    }

    // --- 1 --------------------------------------------------------------------
    static (int wrong, int trials) ComposedOperation() => Race(useAtomic: false);
    static (int wrong, int trials) AtomicOperation() => Race(useAtomic: true);

    static (int wrong, int trials) Race(bool useAtomic)
    {
        const int Trials = 40;
        var wrong = 0;

        for (var t = 0; t < Trials; t++)
        {
            var map = new ConcurrentDictionary<string, int>();
            var adds = 0;
            var ready = new ManualResetEventSlim(false);
            var threads = new Thread[8];

            for (var i = 0; i < 8; i++)
            {
                threads[i] = new Thread(() =>
                {
                    ready.Wait();
                    if (useAtomic)
                    {
                        if (map.TryAdd("key", 1)) Interlocked.Increment(ref adds);
                    }
                    else
                    {
                        if (!map.ContainsKey("key"))          // CHECK
                        {
                            map["key"] = 1;                   // ACT
                            Interlocked.Increment(ref adds);
                        }
                    }
                });
                threads[i].Start();
            }
            ready.Set();
            foreach (var th in threads) th.Join();
            if (adds != 1) wrong++;
        }
        return (wrong, Trials);
    }

    // --- 3 --------------------------------------------------------------------
    static (int calls, int distinct) GetOrAddFactory()
    {
        var map = new ConcurrentDictionary<string, Guid>();
        var calls = 0;
        var seen = new ConcurrentBag<Guid>();
        var ready = new ManualResetEventSlim(false);
        var threads = new Thread[200];

        for (var i = 0; i < 200; i++)
        {
            threads[i] = new Thread(() =>
            {
                ready.Wait();
                var v = map.GetOrAdd("k", _ =>
                {
                    Interlocked.Increment(ref calls);
                    Thread.SpinWait(200);          // widen the window
                    return Guid.NewGuid();
                });
                seen.Add(v);
            });
            threads[i].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
        return (calls, seen.Distinct().Count());
    }

    static int GetOrAddLazy()
    {
        var map = new ConcurrentDictionary<string, Lazy<Guid>>();
        var calls = 0;
        var ready = new ManualResetEventSlim(false);
        var threads = new Thread[200];

        for (var i = 0; i < 200; i++)
        {
            threads[i] = new Thread(() =>
            {
                ready.Wait();
                var lazy = map.GetOrAdd("k", _ => new Lazy<Guid>(() =>
                {
                    Interlocked.Increment(ref calls);
                    Thread.SpinWait(200);
                    return Guid.NewGuid();
                }, LazyThreadSafetyMode.ExecutionAndPublication));
                _ = lazy.Value;
            });
            threads[i].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
        return calls;
    }

    // --- 4 --------------------------------------------------------------------
    static (int enumerated, int added) EnumerateWhileWriting()
    {
        var map = new ConcurrentDictionary<int, int>();
        for (var i = 0; i < 5_000; i++) map[i] = i;

        var stop = new CancellationTokenSource();
        var added = 0;
        var writers = new Thread[4];
        for (var w = 0; w < 4; w++)
        {
            var seed = 100_000 * (w + 1);
            writers[w] = new Thread(() =>
            {
                var k = seed;
                while (!stop.IsCancellationRequested)
                {
                    map[k++] = 1;
                    Interlocked.Increment(ref added);
                }
            }) { IsBackground = true };
            writers[w].Start();
        }

        var seen = 0;
        foreach (var _ in map) { seen++; Thread.SpinWait(50); }

        stop.Cancel();
        foreach (var w in writers) w.Join(500);
        return (seen, Volatile.Read(ref added));
    }

    static double CountCost()
    {
        var map = new ConcurrentDictionary<int, int>();
        for (var i = 0; i < 200_000; i++) map[i] = i;

        var sw = Stopwatch.StartNew();
        long sink = 0;
        for (var i = 0; i < 2_000; i++) sink += map.Count;
        var countMs = sw.Elapsed.TotalMilliseconds;

        sw = Stopwatch.StartNew();
        for (var i = 0; i < 2_000; i++) sink += map.IsEmpty ? 0 : 1;
        var isEmptyMs = sw.Elapsed.TotalMilliseconds;

        GC.KeepAlive(sink);
        return countMs / Math.Max(isEmptyMs, 0.0001);
    }

    // --- 5 --------------------------------------------------------------------
    /// <summary>
    /// Both drains take every item; the difference is what it costs. Draining
    /// from the adding thread reads its own local list. Draining from another
    /// thread steals, which needs synchronisation.
    /// </summary>
    static (double sameMs, double stealMs) BagAffinity()
    {
        const int Items = 200_000;

        // Same thread adds and drains: the local fast path.
        var sw = Stopwatch.StartNew();
        var localCount = 0;
        var local = new Thread(() =>
        {
            var bag = new ConcurrentBag<int>();
            for (var i = 0; i < Items; i++) bag.Add(i);
            while (bag.TryTake(out _)) localCount++;
        });
        local.Start();
        local.Join();
        var sameMs = sw.Elapsed.TotalMilliseconds;

        // One thread adds, another drains: every take is a steal.
        var shared = new ConcurrentBag<int>();
        var filler = new Thread(() => { for (var i = 0; i < Items; i++) shared.Add(i); });
        filler.Start();
        filler.Join();

        sw = Stopwatch.StartNew();
        var stolenCount = 0;
        var drainer = new Thread(() => { while (shared.TryTake(out _)) stolenCount++; });
        drainer.Start();
        drainer.Join();
        var stealMs = sw.Elapsed.TotalMilliseconds;

        if (localCount != Items || stolenCount != Items)
            throw new InvalidOperationException("a drain lost items, which should not happen");

        return (sameMs, stealMs);
    }
}
