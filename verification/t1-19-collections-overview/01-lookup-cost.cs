// 01-lookup-cost.cs — the difference between scanning and hashing, measured at
// several sizes so the SHAPE of the growth is visible rather than asserted.
// .NET 10.0.400, Release. Run: dotnet run 01-lookup-cost.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Program
{
    static double Measure(Func<int, bool> contains, int lookups, int max)
    {
        for (int i = 0; i < 1000; i++) contains(i % max);
        double best = double.MaxValue;
        for (int r = 0; r < 3; r++)
        {
            var sw = Stopwatch.StartNew();
            int found = 0;
            for (int i = 0; i < lookups; i++) if (contains(i % max)) found++;
            sw.Stop();
            if (found == 0) throw new Exception("nothing found");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        return best;
    }

    static void Main()
    {
        Console.WriteLine("Lookup cost by collection size. 100,000 lookups each,");
        Console.WriteLine("best of 3, times in milliseconds.");
        Console.WriteLine();
        Console.WriteLine($"  {"n",8} {"List",12} {"HashSet",12} {"Dictionary",12} " +
                          $"{"SortedSet",12} {"array scan",12}");

        const int Lookups = 100_000;
        foreach (int n in new[] { 10, 100, 1_000, 10_000, 100_000 })
        {
            var list = Enumerable.Range(0, n).ToList();
            var set = new HashSet<int>(list);
            var dict = list.ToDictionary(x => x, x => x);
            var sorted = new SortedSet<int>(list);
            var array = list.ToArray();

            double l = Measure(v => list.Contains(v), Lookups, n);
            double h = Measure(v => set.Contains(v), Lookups, n);
            double d = Measure(v => dict.ContainsKey(v), Lookups, n);
            double s = Measure(v => sorted.Contains(v), Lookups, n);
            double a = Measure(v => Array.IndexOf(array, v) >= 0, Lookups, n);

            Console.WriteLine($"  {n,8:N0} {l,12:F1} {h,12:F1} {d,12:F1} {s,12:F1} {a,12:F1}");
        }

        Console.WriteLine();
        Console.WriteLine("Read the ROWS, not the cells. List and array scan roughly ten times");
        Console.WriteLine("slower for every ten times more data. HashSet and Dictionary barely");
        Console.WriteLine("move. SortedSet grows slowly — it is a tree, so log n comparisons.");
    }
}
