// 03-allocation-and-cost.cs — what a LINQ pipeline allocates and what it costs
// against the equivalent loop. Allocation from GC.GetAllocatedBytesForCurrentThread,
// time from Stopwatch with a warm-up pass. Release build.
// .NET 10.0.400. Run: dotnet run 03-allocation-and-cost.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

record Reading(int SensorId, double Value);

class Program
{
    const int N = 200_000;
    const int Reps = 200;

    static Reading[] _data = Array.Empty<Reading>();
    static double _sink;   // a double field, so storing a result never boxes

    static void Main()
    {
        var rng = new Random(20260830);
        _data = Enumerable.Range(0, N)
            .Select(i => new Reading(i % 50, rng.NextDouble() * 100))
            .ToArray();

        Console.WriteLine($"data: {N:N0} readings, {Reps} repetitions per measurement");
        Console.WriteLine();

        Console.WriteLine("--- allocation for ONE pass ---");
        Console.WriteLine($"  linq pipeline (Where+Select+Sum) : {AllocOnce(LinqSum),6} bytes");
        Console.WriteLine($"  foreach loop, same result        : {AllocOnce(LoopSum),6} bytes");
        Console.WriteLine($"  linq over an array via IEnumerable: {AllocOnce(LinqSumBoxed),6} bytes");
        Console.WriteLine("  The pipeline allocates a small fixed number of iterator objects,");
        Console.WriteLine("  not one per element. It does not scale with N.");

        Console.WriteLine();
        Console.WriteLine("--- allocation that DOES scale with N ---");
        Console.WriteLine($"  Select to an anonymous type, then Sum : {AllocOnce(LinqProjectSum):N0} bytes");
        Console.WriteLine($"  ToList() of {N:N0} readings           : {AllocOnce(LinqToList):N0} bytes");
        Console.WriteLine("  A projection to a reference type allocates per element, and");
        Console.WriteLine("  ToList allocates the backing array plus its growth doublings.");

        Console.WriteLine();
        Console.WriteLine("--- time for the same answer ---");
        var linqBoxed = Time(LinqSumBoxed);
        var linq = Time(LinqSum);
        var loop = Time(LoopSum);
        Console.WriteLine($"  foreach loop                     : {loop,7:0.00} ms/pass");
        Console.WriteLine($"  linq on the array                : {linq,7:0.00} ms/pass  ({linq / loop:0.0}x)");
        Console.WriteLine($"  linq through IEnumerable<Reading> : {linqBoxed,7:0.00} ms/pass  ({linqBoxed / loop:0.0}x)");
        Console.WriteLine($"  per element: loop {loop * 1e6 / N:0.0} ns, linq {linq * 1e6 / N:0.0} ns");

        Console.WriteLine();
        Console.WriteLine("--- where the difference comes from ---");
        Console.WriteLine("  Every element crosses two delegate calls (the Where predicate");
        Console.WriteLine("  and the Select projection) plus two interface MoveNext calls.");
        Console.WriteLine("  The loop has none of those: the JIT inlines the body and");
        Console.WriteLine("  iterates the array with a bounds-checked index.");

        Console.WriteLine();
        Console.WriteLine("--- and where it does NOT matter ---");
        var small = _data.Take(100).ToArray();
        var swS = Stopwatch.StartNew();
        double acc = 0;
        for (var r = 0; r < Reps; r++)
            acc += small.Where(x => x.SensorId == 7).Select(x => x.Value).Sum();
        swS.Stop();
        Console.WriteLine($"  the same pipeline over 100 elements: " +
                          $"{swS.Elapsed.TotalMilliseconds / Reps * 1000:0.0} us/pass");
        Console.WriteLine("  On a hundred elements the whole pipeline is under a few");
        Console.WriteLine("  microseconds. The cost is real and it is also usually irrelevant.");
        Console.WriteLine($"  (checksum {acc:0}, printed so the loop cannot be optimised away)");
    }

    static double LinqSum() =>
        _data.Where(x => x.SensorId == 7).Select(x => x.Value).Sum();

    static double LinqSumBoxed()
    {
        IEnumerable<Reading> seq = _data;
        return seq.Where(x => x.SensorId == 7).Select(x => x.Value).Sum();
    }

    static double LoopSum()
    {
        double total = 0;
        foreach (var x in _data)
            if (x.SensorId == 7) total += x.Value;
        return total;
    }

    static double LinqProjectSum() =>
        _data.Select(x => new { x.SensorId, Doubled = x.Value * 2 }).Sum(x => x.Doubled);

    static double LinqToList() => _data.Where(x => x.Value > 0).ToList().Count;

    static long AllocOnce(Func<double> f)
    {
        f();                                   // warm up: JIT, and any first-call caches
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        var r = f();
        var after = GC.GetAllocatedBytesForCurrentThread();
        _sink = r;
        return after - before;
    }

    static double Time(Func<double> f)
    {
        for (var i = 0; i < 20; i++) f();       // warm up
        var sw = Stopwatch.StartNew();
        double acc = 0;
        for (var r = 0; r < Reps; r++) acc += f();
        sw.Stop();
        _sink = acc;
        return sw.Elapsed.TotalMilliseconds / Reps;
    }
}
