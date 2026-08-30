// 03-what-the-type-costs.cs — LINQ inspects what it is given. The same call on
// the same data costs different amounts depending on the declared type.
// .NET 10.0.400, Release. Run: dotnet run 03-what-the-type-costs.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Program
{
    const int N = 1_000_000;
    const int Reps = 2_000;

    // A sequence that is genuinely only IEnumerable — LINQ cannot shortcut it.
    static IEnumerable<int> AsPureSequence(IEnumerable<int> source)
    {
        foreach (var item in source) yield return item;
    }

    static void Time(string label, Func<long> body, int reps)
    {
        body();
        double best = double.MaxValue;
        long bytes = 0;
        for (int r = 0; r < 3; r++)
        {
            long before = GC.GetTotalAllocatedBytes(precise: true);
            var sw = Stopwatch.StartNew();
            long v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-40} {best,8:F1} ms   {bytes,10:N0} bytes");
    }

    static void Main()
    {
        var list = Enumerable.Range(0, N).ToList();
        IEnumerable<int> asEnumerable = list;
        IEnumerable<int> pure = AsPureSequence(list);
        ICollection<int> asCollection = list;

        Console.WriteLine($"list of {N:N0} ints, {Reps:N0} repetitions");
        Console.WriteLine();
        Console.WriteLine("--- Count() ---");
        Time("list.Count (the property)", () =>
        { long t = 0; for (int i = 0; i < Reps; i++) t += list.Count; return t; }, Reps);
        Time("Count() on IEnumerable holding a List", () =>
        { long t = 0; for (int i = 0; i < Reps; i++) t += asEnumerable.Count(); return t; }, Reps);
        Time("Count() on ICollection", () =>
        { long t = 0; for (int i = 0; i < Reps; i++) t += asCollection.Count; return t; }, Reps);

        Console.WriteLine();
        Console.WriteLine("--- the same call on a sequence LINQ cannot inspect ---");
        Time("Count() on a pure IEnumerable (x3)", () =>
        { long t = 0; for (int i = 0; i < 3; i++) t += AsPureSequence(list).Count(); return t; }, 3);

        Console.WriteLine();
        Console.WriteLine("--- Contains() ---");
        Time("HashSet.Contains via ICollection (x100k)", () =>
        {
            ICollection<int> set = new HashSet<int>(list);
            long t = 0;
            for (int i = 0; i < 100_000; i++) if (set.Contains(i)) t++;
            return t;
        }, 100_000);
        Time("Enumerable.Contains on the same set (x100k)", () =>
        {
            IEnumerable<int> set = new HashSet<int>(list);
            long t = 0;
            for (int i = 0; i < 100_000; i++) if (set.Contains(i)) t++;
            return t;
        }, 100_000);

        Console.WriteLine();
        Console.WriteLine("--- ToList() on each ---");
        Time("ToList() from a List", () =>
        { long t = 0; for (int i = 0; i < 20; i++) t += asEnumerable.ToList().Count; return t; }, 20);
        Time("ToList() from a pure IEnumerable", () =>
        { long t = 0; for (int i = 0; i < 20; i++) t += AsPureSequence(list).ToList().Count; return t; }, 20);

        Console.WriteLine();
        Console.WriteLine("LINQ type-tests what it receives. Count() checks for ICollection and");
        Console.WriteLine("reads the property; Contains() checks for ICollection and uses its");
        Console.WriteLine("Contains; ToList() checks for a known size and pre-sizes the result.");
        Console.WriteLine("Hand back a plain IEnumerable and every one of those falls back to");
        Console.WriteLine("walking the sequence.");
    }
}
