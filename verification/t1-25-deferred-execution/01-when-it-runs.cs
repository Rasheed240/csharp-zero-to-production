// 01-when-it-runs.cs — when the work in a LINQ query actually happens, and in
// what order the operators run. Every claim printed here is observed, not asserted:
// the lambdas log each time they are called.
// .NET 10.0.400. Run: dotnet run 01-when-it-runs.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- defining a query runs nothing ---");
        var log = new List<string>();
        var source = new[] { 1, 2, 3, 4 };

        var q = source
            .Where(n => { log.Add($"where({n})"); return n % 2 == 0; })
            .Select(n => { log.Add($"select({n})"); return n * 10; });

        Console.WriteLine($"  after defining the query, lambdas called: {log.Count}");

        var results = q.ToList();
        Console.WriteLine($"  after ToList(), lambdas called       : {log.Count}");
        Console.WriteLine($"  results                              : {string.Join(", ", results)}");

        Console.WriteLine();
        Console.WriteLine("--- the order shows the pipeline pulls ONE element at a time ---");
        Console.WriteLine($"  {string.Join(" ", log)}");
        Console.WriteLine("  Not 'all the wheres, then all the selects'. Each element is");
        Console.WriteLine("  pulled through the whole chain before the next one starts.");

        Console.WriteLine();
        Console.WriteLine("--- a query reads its source at ENUMERATION time ---");
        var list = new List<int> { 1, 2, 3 };
        var live = list.Select(n => n * 100);
        Console.WriteLine($"  before adding : {string.Join(", ", live)}");
        list.Add(4);
        Console.WriteLine($"  after adding  : {string.Join(", ", live)}");
        Console.WriteLine("  The query was defined before 4 existed and still saw it.");

        var snapshot = list.Select(n => n * 100).ToList();
        list.Add(5);
        Console.WriteLine($"  ToList snapshot after another Add : {string.Join(", ", snapshot)}");
        Console.WriteLine("  ToList ran once and kept the answer. It cannot see the 5.");

        Console.WriteLine();
        Console.WriteLine("--- mutating the source DURING enumeration throws ---");
        try
        {
            foreach (var n in list.Where(n => n > 0))
            {
                if (n == 1) list.Add(99);
            }
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  InvalidOperationException: {ex.Message}");
        }
        Console.WriteLine("  The deferred query holds an enumerator over the live list,");
        Console.WriteLine("  so the collection-modified check fires the same as in foreach.");

        Console.WriteLine();
        Console.WriteLine("--- Take stops the source early: the pipeline is pull-driven ---");
        var pulled = 0;
        IEnumerable<int> Counting()
        {
            for (var i = 1; i <= 1_000_000; i++) { pulled++; yield return i; }
        }
        var firstThree = Counting().Where(n => n % 2 == 0).Take(3).ToList();
        Console.WriteLine($"  results        : {string.Join(", ", firstThree)}");
        Console.WriteLine($"  source elements pulled : {pulled} (of 1,000,000 available)");
        Console.WriteLine("  Nothing asked for the rest, so nothing produced them.");

        Console.WriteLine();
        Console.WriteLine("--- but OrderBy has to see everything before it yields anything ---");
        pulled = 0;
        var sortedFirst = Counting().OrderBy(n => -n).Take(3).ToList();
        Console.WriteLine($"  results        : {string.Join(", ", sortedFirst)}");
        Console.WriteLine($"  source elements pulled : {pulled}");
        Console.WriteLine("  OrderBy is deferred but not streaming: it buffers the entire");
        Console.WriteLine("  source into an array before it can produce a first element.");
        Console.WriteLine("  Same for GroupBy, Distinct's dedup set, Reverse and ToLookup.");
    }
}
