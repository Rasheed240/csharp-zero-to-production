// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400, Release. Run: dotnet run 05-exercises.cs -c Release

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;

class Program
{
    static int _calls;

    static IEnumerable<int> Tracked(IEnumerable<int> source) =>
        source.Where(x => { _calls++; return x % 3 == 0; });

    static IEnumerable<int> Pure(IEnumerable<int> source)
    {
        foreach (var x in source) yield return x;
    }

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: which interface has what =====");
        var types = new (string Name, object V)[]
        {
            ("int[]", new int[3]),
            ("List<int>", new List<int>()),
            ("HashSet<int>", new HashSet<int>()),
            ("Queue<int>", new Queue<int>()),
            ("ReadOnlyCollection<int>", new ReadOnlyCollection<int>(new List<int>())),
            ("LINQ Where(...)", Enumerable.Range(0, 3).Where(x => x > 0))
        };
        Console.WriteLine($"  {"type",-24} {"IROColl",8} {"IROList",8} {"IColl",6} {"IList",6}");
        foreach (var (name, v) in types)
        {
            string M(Type open) => v.GetType().GetInterfaces()
                .Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == open) ? "yes" : "-";
            Console.WriteLine($"  {name,-24} {M(typeof(IReadOnlyCollection<>)),8} " +
                              $"{M(typeof(IReadOnlyList<>)),8} {M(typeof(ICollection<>)),6} " +
                              $"{M(typeof(IList<>)),6}");
        }

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: how many times does the predicate run? =====");
        var source = Enumerable.Range(0, 12).ToList();

        _calls = 0;
        var q = Tracked(source);
        Console.WriteLine($"  after building the query        : {_calls}");
        Console.WriteLine($"  q.Any()                         : {q.Any()}, calls now {_calls}");
        _calls = 0;
        Console.WriteLine($"  q.Count()                       : {q.Count()}, calls {_calls}");
        _calls = 0;
        Console.WriteLine($"  q.Count() + q.First() + ToList(): " +
                          $"{q.Count()}/{q.First()}/{q.ToList().Count}, calls {_calls}");
        _calls = 0;
        var mat = Tracked(source).ToList();
        int a = mat.Count; int b = mat.First(); int c = mat.ToList().Count;
        Console.WriteLine($"  materialised first              : {a}/{b}/{c}, calls {_calls}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: what the declared type costs LINQ =====");
        var big = Enumerable.Range(0, 1_000_000).ToList();
        IEnumerable<int> asList = big;
        Bench("Count() on IEnumerable holding a List (x2000)",
            () => { long t = 0; for (int i = 0; i < 2000; i++) t += asList.Count(); return t; });
        Bench("Count() on a pure IEnumerable (x3)",
            () => { long t = 0; for (int i = 0; i < 3; i++) t += Pure(big).Count(); return t; });
        Bench("ToList() from a List (x20)",
            () => { long t = 0; for (int i = 0; i < 20; i++) t += asList.ToList().Count; return t; });
        Bench("ToList() from a pure IEnumerable (x20)",
            () => { long t = 0; for (int i = 0; i < 20; i++) t += Pure(big).ToList().Count; return t; });

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: can the caller mutate what you returned? =====");
        var inner = new List<int> { 1, 2, 3 };

        IEnumerable<int> asEnum = inner;
        IReadOnlyList<int> asRo = inner;
        IReadOnlyList<int> wrapped = new ReadOnlyCollection<int>(inner);

        Console.WriteLine($"  IEnumerable   -> is IList? {asEnum is IList<int>}");
        Console.WriteLine($"  IReadOnlyList -> is IList? {asRo is IList<int>}");
        Console.WriteLine($"  ReadOnlyColl  -> is IList? {wrapped is IList<int>}");

        if (asRo is IList<int> w1) { w1.Add(4); Console.WriteLine($"  mutated through IReadOnlyList: inner is now {inner.Count} items"); }
        try { ((IList<int>)wrapped).Add(5); }
        catch (NotSupportedException) { Console.WriteLine("  mutating the wrapper threw NotSupportedException"); }
        inner.Add(6);
        Console.WriteLine($"  but the wrapper is a live view: it now reports {wrapped.Count} items");
    }

    static void Bench(string label, Func<long> body)
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
            if (v == 0) throw new Exception();
            bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-46} {best,7:F1} ms  {bytes,12:N0} bytes");
    }
}
