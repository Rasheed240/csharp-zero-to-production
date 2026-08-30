// 03-iteration-and-order.cs — what each collection guarantees about order, and
// what iterating one costs.
// .NET 10.0.400, Release. Run: dotnet run 03-iteration-and-order.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Program
{
    const int N = 200_000;

    static (double ms, long bytes) Measure(Func<long> body)
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
        return (best, bytes);
    }

    static void Show(string label, (double ms, long bytes) r) =>
        Console.WriteLine($"  {label,-32} {r.ms,7:F1} ms   {r.bytes,8:N0} bytes/pass");

    static void Main()
    {
        var source = Enumerable.Range(0, N).ToArray();
        var list = source.ToList();
        var set = new HashSet<int>(source);
        var dict = source.ToDictionary(x => x, x => x);
        var sortedDict = new SortedDictionary<int, int>(dict);
        var linked = new LinkedList<int>(source);

        Console.WriteLine($"--- iterating {N:N0} elements ---");
        Show("array (for loop)", Measure(() =>
        { long t = 0; for (int i = 0; i < source.Length; i++) t += source[i]; return t; }));
        Show("List (for loop)", Measure(() =>
        { long t = 0; for (int i = 0; i < list.Count; i++) t += list[i]; return t; }));
        Show("List (foreach)", Measure(() =>
        { long t = 0; foreach (var v in list) t += v; return t; }));
        Show("HashSet (foreach)", Measure(() =>
        { long t = 0; foreach (var v in set) t += v; return t; }));
        Show("Dictionary (foreach)", Measure(() =>
        { long t = 0; foreach (var kv in dict) t += kv.Value; return t; }));
        Show("SortedDictionary (foreach)", Measure(() =>
        { long t = 0; foreach (var kv in sortedDict) t += kv.Value; return t; }));
        Show("LinkedList (foreach)", Measure(() =>
        { long t = 0; foreach (var v in linked) t += v; return t; }));

        Console.WriteLine();
        Console.WriteLine("--- what each guarantees about ORDER ---");
        var words = new[] { "pear", "fig", "banana", "apple", "kiwi" };

        Console.WriteLine($"  List            : {string.Join(", ", new List<string>(words))}");
        Console.WriteLine($"  Queue (FIFO)    : {string.Join(", ", new Queue<string>(words))}");
        Console.WriteLine($"  Stack (LIFO)    : {string.Join(", ", new Stack<string>(words))}");
        Console.WriteLine($"  SortedSet       : {string.Join(", ", new SortedSet<string>(words))}");
        Console.WriteLine($"  HashSet         : {string.Join(", ", new HashSet<string>(words))}");
        Console.WriteLine("  HashSet order is an accident of hashing and capacity. It is stable");
        Console.WriteLine("  within one run and must never be relied on.");

        Console.WriteLine();
        Console.WriteLine("--- Dictionary order is also not a guarantee ---");
        var d = new Dictionary<string, int>();
        foreach (var w in words) d[w] = w.Length;
        Console.WriteLine($"  insertion order : {string.Join(", ", words)}");
        Console.WriteLine($"  enumerated      : {string.Join(", ", d.Keys)}");
        d.Remove("banana");
        d["cherry"] = 6;
        Console.WriteLine($"  after remove+add: {string.Join(", ", d.Keys)}");
        Console.WriteLine("  The new key reused the removed key's slot. Enumeration order");
        Console.WriteLine("  reflects internal layout, not insertion, and changes as you edit.");
    }
}
