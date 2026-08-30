// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400, Release. Run: dotnet run 05-exercises.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1: shape of the growth =====");
        Console.WriteLine($"  {"n",8} {"List.Contains",16} {"HashSet.Contains",18} {"ratio",10}");
        foreach (int n in new[] { 1_000, 10_000, 100_000 })
        {
            var list = Enumerable.Range(0, n).ToList();
            var set = new HashSet<int>(list);
            // Probe across the WHOLE collection with a prime stride. Using i % n
            // would only touch the first 20,000 values once n exceeds that, so the
            // scan would find them early and the growth would not show.
            double l = Bench(() => { int f = 0; for (int i = 0; i < 20_000; i++) if (list.Contains((i * 7919) % n)) f++; return f; });
            double h = Bench(() => { int f = 0; for (int i = 0; i < 20_000; i++) if (set.Contains((i * 7919) % n)) f++; return f; });
            Console.WriteLine($"  {n,8:N0} {l,16:F1} {h,18:F1} {l / h,9:F0}x");
        }

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: Insert(0) vs Add =====");
        foreach (int n in new[] { 10_000, 20_000, 40_000 })
        {
            double add = Bench(() => { var l = new List<int>(n); for (int i = 0; i < n; i++) l.Add(i); return l.Count; });
            double ins = Bench(() => { var l = new List<int>(n); for (int i = 0; i < n; i++) l.Insert(0, i); return l.Count; });
            double q = Bench(() => { var s = new Stack<int>(n); for (int i = 0; i < n; i++) s.Push(i); return s.Count; });
            Console.WriteLine($"  n={n,6:N0}   Add {add,7:F1} ms   Insert(0) {ins,8:F1} ms   Push {q,7:F1} ms");
        }

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: memory per element =====");
        Report("List<int>", 100_000, n => { var c = new List<int>(n); for (int i = 0; i < n; i++) c.Add(i); return c; });
        Report("HashSet<int>", 100_000, n => { var c = new HashSet<int>(n); for (int i = 0; i < n; i++) c.Add(i); return c; });
        Report("Dictionary<int,int>", 100_000, n => { var c = new Dictionary<int, int>(n); for (int i = 0; i < n; i++) c[i] = i; return c; });
        Report("SortedDictionary<int,int>", 100_000, n => { var c = new SortedDictionary<int, int>(); for (int i = 0; i < n; i++) c[i] = i; return c; });
        Report("LinkedList<int>", 100_000, n => { var c = new LinkedList<int>(); for (int i = 0; i < n; i++) c.AddLast(i); return c; });

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: enumeration order is not insertion order =====");
        var d = new Dictionary<string, int>();
        foreach (var w in new[] { "pear", "fig", "banana", "apple", "kiwi" }) d[w] = w.Length;
        Console.WriteLine($"  after inserts   : {string.Join(", ", d.Keys)}");
        d.Remove("banana");
        d["cherry"] = 6;
        Console.WriteLine($"  after remove+add: {string.Join(", ", d.Keys)}");
        d.Remove("pear");
        d["damson"] = 6;
        d["elderberry"] = 10;
        Console.WriteLine($"  after more edits: {string.Join(", ", d.Keys)}");
    }

    static double Bench(Func<int> body)
    {
        body();
        double best = double.MaxValue;
        for (int r = 0; r < 3; r++)
        {
            var sw = Stopwatch.StartNew();
            int v = body();
            sw.Stop();
            if (v == 0) throw new Exception();
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        return best;
    }

    static void Report(string label, int n, Func<int, object> build)
    {
        build(n);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        long before = GC.GetTotalAllocatedBytes(precise: true);
        var held = build(n);
        long bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
        GC.KeepAlive(held);
        Console.WriteLine($"  {label,-28} {bytes,12:N0} bytes   {(double)bytes / n,6:F1} per element");
    }
}
