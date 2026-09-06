// 03-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-exercises.cs -c Release
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
        Console.WriteLine("===== Exercise 1: will Parallel.For help? =====");
        Console.WriteLine();
        Console.WriteLine("  Three loops over 200,000 items. Predict which get faster.");
        Console.WriteLine();
        Console.WriteLine("  body                       sequential   parallel   speed-up");
        Compare("i => sum += i", 0);
        Compare("20 hash combines", 20);
        Compare("2,000 hash combines", 2_000);
        Console.WriteLine();
        Console.WriteLine("  Only the third is worth parallelising. The first is SLOWER in");
        Console.WriteLine("  parallel: the per-item delegate call and the partitioning cost more");
        Console.WriteLine("  than an addition. Parallelism has a fixed overhead that the work per");
        Console.WriteLine("  item must exceed before anything is gained.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: find the bug =====");
        Console.WriteLine();
        Console.WriteLine("      var results = new List<int>();");
        Console.WriteLine("      Parallel.For(0, 10_000, i => results.Add(i));");
        Console.WriteLine();
        for (var run = 0; run < 3; run++)
            Console.WriteLine($"    run {run + 1}: {UnsafeList()}");
        Console.WriteLine();
        Console.WriteLine("  List<T> is not thread-safe. Add() increments a count and writes an");
        Console.WriteLine("  array slot non-atomically, so concurrent calls overwrite each other.");
        Console.WriteLine("  Roughly half the items were lost, and the count differed every run.");
        Console.WriteLine();
        Console.WriteLine("  Losing items is only the outcome that happened HERE. The same code");
        Console.WriteLine("  can also throw IndexOutOfRangeException from inside the resize, or");
        Console.WriteLine("  leave null entries, depending on where a thread is interrupted.");
        Console.WriteLine("  Which one you get depends on timing, so a test that passes proves");
        Console.WriteLine("  nothing about the next run.");
        Console.WriteLine();
        Console.WriteLine("  Three fixes, and they are not equivalent:");
        Console.WriteLine($"    lock around Add           : {LockedList()}");
        Console.WriteLine($"    ConcurrentBag<T>          : {BagList()}");
        Console.WriteLine($"    PLINQ .Select().ToArray() : {PlinqList()}");
        Console.WriteLine();
        Console.WriteLine("  Prefer the third. Locking serialises the very thing you parallelised;");
        Console.WriteLine("  a concurrent collection is better but still coordinates per item.");
        Console.WriteLine("  Producing a result rather than mutating shared state avoids the");
        Console.WriteLine("  problem instead of managing it.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: is the total correct? =====");
        Console.WriteLine();
        var values = Enumerable.Range(1, 100_000).Select(i => (decimal)i / 7m).ToArray();
        var seq = values.Aggregate(0m, (a, b) => a + b);
        var racy = RacySum(values);
        var local = LocalSum(values);
        var plinq = values.AsParallel().Sum();
        Console.WriteLine($"    sequential      : {seq,22:N6}");
        Console.WriteLine($"    racy parallel   : {racy,22:N6}   {(racy == seq ? "equal" : "WRONG")}");
        Console.WriteLine($"    local state     : {local,22:N6}   {(local == seq ? "equal" : "differs")}");
        Console.WriteLine($"    PLINQ Sum()     : {plinq,22:N6}   {(plinq == seq ? "equal" : "differs")}");
        Console.WriteLine($"    local  - seq    : {(local - seq).ToString("G29"),22}");
        Console.WriteLine($"    PLINQ  - seq    : {(plinq - seq).ToString("G29"),22}");
        Console.WriteLine();
        Console.WriteLine("  Two different things are happening and they must not be confused.");
        Console.WriteLine();
        Console.WriteLine("  The RACY version is a bug: updates are lost and the answer can be");
        Console.WriteLine("  wrong by any amount.");
        Console.WriteLine();
        Console.WriteLine("  The correct parallel versions may still differ from sequential in the");
        Console.WriteLine("  final digits, because they ADD IN A DIFFERENT ORDER and decimal");
        Console.WriteLine("  addition is not associative at the limits of the type's precision.");
        Console.WriteLine("  That is not a bug; it is arithmetic.");
        Console.WriteLine();
        Console.WriteLine("  Consequence for testing: asserting parallel == sequential is wrong,");
        Console.WriteLine("  because it fails on correct code. Assert a tolerance that is tight");
        Console.WriteLine("  enough to catch a lost update and loose enough to allow reordering.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: CPU or I/O? =====");
        Console.WriteLine();
        Console.WriteLine("  100 operations that wait 10 ms each:");
        var s1 = Time(() => { for (var i = 0; i < 100; i++) Thread.Sleep(10); });
        var s2 = Time(() => Parallel.For(0, 100, _ => Thread.Sleep(10)));
        var s3 = Time(() => Task.WhenAll(Enumerable.Range(0, 100).Select(_ => Task.Delay(10)))
                              .GetAwaiter().GetResult());
        Console.WriteLine($"    sequential blocking : {s1,7:N0} ms");
        Console.WriteLine($"    Parallel.For        : {s2,7:N0} ms   ({s1 / s2:N1}x)");
        Console.WriteLine($"    Task.WhenAll        : {s3,7:N0} ms   ({s1 / s3:N1}x)");
        Console.WriteLine();
        Console.WriteLine("  Parallel.For does speed it up, and is still wrong. Its speed-up comes");
        Console.WriteLine("  from occupying one thread per operation, which is thread pool");
        Console.WriteLine("  starvation by another name (t2-02). Task.WhenAll is faster and");
        Console.WriteLine("  occupies no threads while waiting.");
        Console.WriteLine();
        Console.WriteLine("  Parallel and PLINQ for CPU. async and WhenAll for I/O. The failure");
        Console.WriteLine("  mode of getting this backwards is not slowness — it is consuming a");
        Console.WriteLine("  shared resource the rest of the process needs.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: exceptions =====");
        Console.WriteLine();
        Console.WriteLine($"    Parallel.For, 3 of 100 throw : {ParallelExceptions()}");
        Console.WriteLine($"    PLINQ, 3 of 100 throw        : {PlinqExceptions()}");
        Console.WriteLine();
        Console.WriteLine("  Both wrap failures in AggregateException, because several items can");
        Console.WriteLine("  fail at once and there is no single (the) exception. Here all three");
        Console.WriteLine("  failures were collected, because all three had already started by");
        Console.WriteLine("  the time the first one threw.");
        Console.WriteLine();
        Console.WriteLine("  That count is NOT guaranteed. Once an item throws, the loop stops");
        Console.WriteLine("  handing out new work, so a failing item that had not yet started");
        Console.WriteLine("  never runs and never appears. Do not write code that depends on");
        Console.WriteLine("  receiving every failure.");
        Console.WriteLine();
        Console.WriteLine("  Practical consequences:");
        Console.WriteLine("    - catch AggregateException and inspect InnerExceptions, or call");
        Console.WriteLine("      Flatten() first if the bodies themselves aggregate");
        Console.WriteLine("    - the work is PARTIALLY DONE and you cannot tell which parts from");
        Console.WriteLine("      the exception alone; design for idempotency or record progress");
        Console.WriteLine("    - a single catch (Exception) around the loop will not see the");
        Console.WriteLine("      original exception type, which breaks type-based handling");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // --- Exercise 1 -----------------------------------------------------------
    static void Compare(string label, int spin)
    {
        var seq = Time(() => { long t = 0; for (var i = 0; i < 200_000; i++) { Spin(spin); t += i; } _sink += t; });
        var par = Time(() =>
        {
            long t = 0;
            Parallel.For(0, 200_000, () => 0L, (i, _, local) => { Spin(spin); return local + i; },
                         local => Interlocked.Add(ref t, local));
            _sink += t;
        });
        Console.WriteLine($"  {label,-26} {seq,10:N0}   {par,8:N0}   {seq / par,8:N2}x");
    }

    // --- Exercise 2 -----------------------------------------------------------
    static string UnsafeList()
    {
        try
        {
            var results = new List<int>();
            Parallel.For(0, 10_000, i => results.Add(i));
            return results.Count == 10_000
                ? $"{results.Count} items (correct this time, by luck)"
                : $"{results.Count} of 10,000 items — LOST {10_000 - results.Count}";
        }
        catch (AggregateException ex)
        {
            return $"threw {ex.InnerExceptions[0].GetType().Name}";
        }
    }

    static string LockedList()
    {
        var results = new List<int>();
        var gate = new object();
        Parallel.For(0, 10_000, i => { lock (gate) { results.Add(i); } });
        return $"{results.Count} items";
    }

    static string BagList()
    {
        var bag = new ConcurrentBag<int>();
        Parallel.For(0, 10_000, i => bag.Add(i));
        return $"{bag.Count} items";
    }

    static string PlinqList()
    {
        var arr = Enumerable.Range(0, 10_000).AsParallel().Select(i => i).ToArray();
        return $"{arr.Length} items";
    }

    // --- Exercise 3 -----------------------------------------------------------
    static decimal RacySum(decimal[] values)
    {
        decimal total = 0;
        Parallel.ForEach(values, v => { total += v; });
        return total;
    }

    static decimal LocalSum(decimal[] values)
    {
        decimal total = 0;
        var gate = new object();
        Parallel.ForEach(values, () => 0m, (v, _, local) => local + v,
                         local => { lock (gate) { total += local; } });
        return total;
    }

    // --- Exercise 5 -----------------------------------------------------------
    static string ParallelExceptions()
    {
        try
        {
            Parallel.For(0, 100, i =>
            {
                if (i is 10 or 50 or 90) throw new InvalidOperationException($"item {i}");
                Spin(200);
            });
            return "did not throw";
        }
        catch (AggregateException ex)
        {
            return $"AggregateException with {ex.InnerExceptions.Count} inner exception(s)";
        }
    }

    static string PlinqExceptions()
    {
        try
        {
            var _ = Enumerable.Range(0, 100).AsParallel().Select(i =>
            {
                if (i is 10 or 50 or 90) throw new InvalidOperationException($"item {i}");
                Spin(200);
                return i;
            }).ToArray();
            return "did not throw";
        }
        catch (AggregateException ex)
        {
            return $"AggregateException with {ex.InnerExceptions.Count} inner exception(s)";
        }
    }

    // --- helpers --------------------------------------------------------------
    static void Spin(int n)
    {
        var h = 0;
        for (var i = 0; i < n; i++) h = HashCode.Combine(h, i);
        if (h == int.MinValue) _sink++;
    }

    static double Time(Action a)
    {
        a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var sw = Stopwatch.StartNew();
        a();
        return sw.Elapsed.TotalMilliseconds;
    }
}
