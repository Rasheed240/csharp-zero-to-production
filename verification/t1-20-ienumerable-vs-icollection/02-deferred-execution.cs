// 02-deferred-execution.cs — returning IEnumerable<T> returns a RECIPE, not a
// result. The work happens when someone iterates, once per iteration.
// .NET 10.0.400. Run: dotnet run 02-deferred-execution.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static int _calls;

    static IEnumerable<int> Expensive(IEnumerable<int> source) =>
        source.Where(x => { _calls++; return x % 2 == 0; });

    // A lazy sequence with a side effect and a failure late in the run.
    static IEnumerable<string> ReadLines()
    {
        Console.WriteLine("    [opening the file]");
        yield return "row-1";
        yield return "row-2";
        Console.WriteLine("    [reading past the end]");
        throw new InvalidOperationException("truncated file");
    }

    static void Main()
    {
        var source = Enumerable.Range(0, 10).ToList();

        Console.WriteLine("--- 1. nothing runs until you iterate ---");
        _calls = 0;
        var query = Expensive(source);
        Console.WriteLine($"  after building the query, predicate calls: {_calls}");
        var first = query.ToList();
        Console.WriteLine($"  after one ToList,          predicate calls: {_calls}");

        Console.WriteLine();
        Console.WriteLine("--- 2. iterating twice does the work twice ---");
        _calls = 0;
        var q2 = Expensive(source);
        int count = q2.Count();
        int sum = q2.Sum();
        var list = q2.ToList();
        Console.WriteLine($"  Count() + Sum() + ToList() -> predicate calls: {_calls}");
        Console.WriteLine($"  (count={count}, sum={sum}, list has {list.Count})");
        Console.WriteLine("  Three passes over the same query, three full evaluations.");

        _calls = 0;
        var materialised = Expensive(source).ToList();
        int c2 = materialised.Count;
        int s2 = materialised.Sum();
        Console.WriteLine($"  materialising first        -> predicate calls: {_calls}");

        Console.WriteLine();
        Console.WriteLine("--- 3. the sequence sees changes made after it was built ---");
        var live = new List<int> { 1, 2, 3 };
        var lazy = live.Where(x => x > 1);
        var eager = live.Where(x => x > 1).ToList();
        live.Add(99);
        Console.WriteLine($"  lazy  after adding 99: {string.Join(", ", lazy)}");
        Console.WriteLine($"  eager after adding 99: {string.Join(", ", eager)}");

        Console.WriteLine();
        Console.WriteLine("--- 4. side effects and failures happen at iteration ---");
        Console.WriteLine("  calling ReadLines():");
        var lines = ReadLines();
        Console.WriteLine("  ...returned. Nothing has happened yet.");
        Console.WriteLine("  now iterating:");
        try
        {
            foreach (var line in lines) Console.WriteLine($"    got {line}");
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"    threw {ex.GetType().Name}: {ex.Message}");
        }
        Console.WriteLine("  The exception surfaced inside the foreach, not at the call.");

        Console.WriteLine();
        Console.WriteLine("--- 5. modifying while enumerating ---");
        var items = new List<int> { 1, 2, 3 };
        try
        {
            foreach (var i in items) if (i == 2) items.Remove(i);
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  removing during foreach: {ex.GetType().Name}");
            Console.WriteLine($"    {ex.Message}");
        }
    }
}
