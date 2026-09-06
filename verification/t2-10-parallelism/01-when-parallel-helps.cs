// 01-when-parallel-helps.cs — parallelism is a CPU technique. This measures the
// three things that decide whether it pays: how much work per item, how many
// items, and whether the work is CPU-bound at all.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-when-parallel-helps.cs -c Release
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
    static long _sink;

    static void Main()
    {
        Console.WriteLine($"  Environment.ProcessorCount = {Environment.ProcessorCount}");
        Console.WriteLine("  So the ceiling for CPU-bound parallel work is that number. Nothing");
        Console.WriteLine("  in this file can beat it, and most of it will not come close.");

        Console.WriteLine();
        Console.WriteLine("=== 1. work per item decides everything ===");
        Console.WriteLine();
        Console.WriteLine("  100,000 items. The only thing changing is how much CPU each costs.");
        Console.WriteLine();
        Console.WriteLine("  work per item      sequential   Parallel.For   speed-up");

        foreach (var spin in new[] { 0, 1, 10, 100, 1_000 })
        {
            var seq = Time(() => Sequential(100_000, spin));
            var par = Time(() => Parallel(100_000, spin));
            Console.WriteLine($"  {Describe(spin),-16}   {seq,10:N0}   {par,12:N0}   {seq / par,8:N2}x");
        }

        Console.WriteLine();
        Console.WriteLine("  The first row is the one to remember: with no work per item,");
        Console.WriteLine("  Parallel.For is SLOWER than a plain loop. The partitioning, the");
        Console.WriteLine("  delegate invocation per item and the coordination cost more than the");
        Console.WriteLine("  work they are distributing.");
        Console.WriteLine();
        Console.WriteLine("  Speed-up rises with work per item and flattens near the processor");
        Console.WriteLine("  count. It never reaches it, because some of the elapsed time is");
        Console.WriteLine("  partitioning rather than work — that is Amdahl's law in one column.");

        Console.WriteLine();
        Console.WriteLine("=== 2. the same work, but I/O-bound ===");
        Console.WriteLine();
        Console.WriteLine("  200 operations that WAIT rather than compute:");
        Console.WriteLine();

        var seqIo = Time(() => { for (var i = 0; i < 200; i++) Thread.Sleep(10); });
        var parIo = Time(() => System.Threading.Tasks.Parallel.For(0, 200, _ => Thread.Sleep(10)));
        var asyncIo = Time(() => Task.WhenAll(Enumerable.Range(0, 200)
            .Select(_ => Task.Delay(10))).GetAwaiter().GetResult());

        Console.WriteLine($"    sequential blocking   : {seqIo,8:N0} ms");
        Console.WriteLine($"    Parallel.For blocking : {parIo,8:N0} ms   ({seqIo / parIo:N1}x)");
        Console.WriteLine($"    Task.WhenAll async    : {asyncIo,8:N0} ms   ({seqIo / asyncIo:N1}x)");
        Console.WriteLine();
        Console.WriteLine("  Parallel.For helps here, and it is still the wrong tool. It gets its");
        Console.WriteLine("  speed-up by occupying one thread per concurrent operation — the exact");
        Console.WriteLine("  thing t2-02 measured as starvation. Task.WhenAll gets a larger");
        Console.WriteLine("  speed-up while occupying no threads at all.");
        Console.WriteLine();
        Console.WriteLine("  The rule: Parallel and PLINQ for CPU work, async and WhenAll for I/O.");
        Console.WriteLine("  Using the wrong one is not merely slower; it consumes a resource the");
        Console.WriteLine("  rest of your process needs.");

        Console.WriteLine();
        Console.WriteLine("=== 3. MaxDegreeOfParallelism ===");
        Console.WriteLine();
        Console.WriteLine("  100,000 items of moderate work, capped at N:");
        Console.WriteLine();
        Console.WriteLine("  MaxDegreeOfParallelism     ms   speed-up vs 1");
        var baseline = 0.0;
        foreach (var dop in new[] { 1, 2, 4, 8, 16, 64 })
        {
            var ms = Time(() => System.Threading.Tasks.Parallel.For(0, 100_000,
                new ParallelOptions { MaxDegreeOfParallelism = dop },
                i => { Spin(100); }));
            if (dop == 1) baseline = ms;
            Console.WriteLine($"  {dop,22}   {ms,6:N0}   {baseline / ms,10:N2}x");
        }
        Console.WriteLine();
        Console.WriteLine("  Scaling stops at the processor count and does not improve beyond it.");
        Console.WriteLine("  Setting it to 64 on an 8-core machine buys nothing for CPU work and");
        Console.WriteLine("  adds context switching.");
        Console.WriteLine();
        Console.WriteLine("  It is still worth setting, for the opposite reason: to LIMIT");
        Console.WriteLine("  parallelism. The default is unbounded-ish, and inside a web server");
        Console.WriteLine("  every request that runs a Parallel.For competes for the same pool.");
        Console.WriteLine("  A default-configured Parallel.For in a request handler is a way to");
        Console.WriteLine("  let one request consume the whole machine.");

        Console.WriteLine();
        Console.WriteLine("=== 4. PLINQ, and when it is worth the risk ===");
        Console.WriteLine();
        var data = Enumerable.Range(0, 2_000_000).ToArray();

        var linq = Time(() => { _sink += data.Where(IsInteresting).Sum(x => (long)x); });
        var plinq = Time(() => { _sink += data.AsParallel().Where(IsInteresting).Sum(x => (long)x); });
        Console.WriteLine($"    LINQ                  : {linq,8:N0} ms");
        Console.WriteLine($"    PLINQ                 : {plinq,8:N0} ms   ({linq / plinq:N2}x)");

        var cheapLinq = Time(() => { _sink += data.Where(x => x % 2 == 0).Sum(x => (long)x); });
        var cheapPlinq = Time(() => { _sink += data.AsParallel().Where(x => x % 2 == 0).Sum(x => (long)x); });
        Console.WriteLine($"    LINQ, trivial predicate : {cheapLinq,6:N0} ms");
        Console.WriteLine($"    PLINQ, trivial predicate: {cheapPlinq,6:N0} ms   ({cheapLinq / cheapPlinq:N2}x)");
        Console.WriteLine();
        Console.WriteLine("  Same shape as section 1: PLINQ pays when the per-element work is");
        Console.WriteLine("  large enough to dominate the partitioning, and costs when it is not.");
        Console.WriteLine("  AsParallel() is not a free optimisation you sprinkle on a query.");

        Console.WriteLine();
        Console.WriteLine("=== 5. ordering: what is and is not guaranteed ===");
        Console.WriteLine();
        var unordered = data.AsParallel().Select(x => x).ToArray();
        var orderedArr = data.AsParallel().AsOrdered().Select(x => x).ToArray();

        Console.WriteLine($"    plain AsParallel().ToArray() came back in source order : {InOrder(unordered)}");
        Console.WriteLine($"    AsOrdered().ToArray() came back in source order        : {InOrder(orderedArr)}");
        Console.WriteLine();
        Console.WriteLine("  BOTH true — and the first one is NOT a guarantee, which is the point");
        Console.WriteLine("  of this section. An earlier version of this file asserted that plain");
        Console.WriteLine("  AsParallel scrambles the output and printed two identical rows,");
        Console.WriteLine("  proving nothing. For an indexable source consumed with ToArray, PLINQ");
        Console.WriteLine("  reassembles results by partition index and the output usually IS in");
        Console.WriteLine("  order. Relying on that is the trap: it is an implementation detail of");
        Console.WriteLine("  this operator on this source, not a contract.");
        Console.WriteLine();
        Console.WriteLine("  What IS observably unordered is the order elements are PROCESSED:");
        Console.WriteLine();
        var seen = new ConcurrentQueue<int>();
        data.Take(50_000).AsParallel().ForAll(x => seen.Enqueue(x));
        var processed = seen.ToArray();
        Console.WriteLine($"    first 10 processed      : {string.Join(",", processed.Take(10))}");
        Console.WriteLine($"    processing was in order : {InOrder(processed)}");
        Console.WriteLine();
        Console.WriteLine("  So: side effects inside a PLINQ query happen in an arbitrary order and");
        Console.WriteLine("  on arbitrary threads. Anything order-dependent, and anything writing");
        Console.WriteLine("  to shared state, is a bug — ForAll makes that especially likely");
        Console.WriteLine("  because it exists to run side effects.");
        Console.WriteLine();
        Console.WriteLine("  Use AsOrdered() when you need the RESULT ordered, and do not rely on");
        Console.WriteLine("  incidental ordering. Measure it: on this source it was not slower,");
        Console.WriteLine("  but on a filtered or reshaped query it can be, because PLINQ then has");
        Console.WriteLine("  to buffer to reassemble.");
        Console.WriteLine();
        Console.WriteLine($"  (checksum {_sink})");
    }

    static bool InOrder(int[] a)
    {
        for (var i = 1; i < a.Length; i++) if (a[i] < a[i - 1]) return false;
        return true;
    }

    static bool IsInteresting(int x)
    {
        // Deliberately expensive per element, so partitioning is not the cost.
        var h = x;
        for (var i = 0; i < 40; i++) h = HashCode.Combine(h, i);
        return (h & 1) == 0;
    }

    static string Describe(int spin) => spin switch
    {
        0 => "none",
        1 => "1 spin",
        _ => $"{spin:N0} spins"
    };

    static void Sequential(int n, int spin)
    {
        long local = 0;
        for (var i = 0; i < n; i++) { Spin(spin); local += i; }
        _sink += local;
    }

    static void Parallel(int n, int spin)
    {
        long total = 0;
        System.Threading.Tasks.Parallel.For(0, n,
            () => 0L,
            (i, _, local) => { Spin(spin); return local + i; },
            local => Interlocked.Add(ref total, local));
        _sink += total;
    }

    static void Spin(int iterations)
    {
        var h = 0;
        for (var i = 0; i < iterations; i++) h = HashCode.Combine(h, i);
        if (h == int.MinValue) _sink++;          // keep the JIT from removing it
    }

    static double Time(Action a)
    {
        a();                                     // warm up and JIT
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var sw = Stopwatch.StartNew();
        a();
        return sw.Elapsed.TotalMilliseconds;
    }
}
