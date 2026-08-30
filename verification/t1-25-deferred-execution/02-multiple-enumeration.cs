// 02-multiple-enumeration.cs — the cost of enumerating a deferred query more than
// once, measured by counting how many times the work actually happens.
// .NET 10.0.400. Run: dotnet run 02-multiple-enumeration.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Program
{
    static int _calls;

    // Stands in for anything the query cannot see the cost of: a database round
    // trip, a file read, a decode. Here it just burns time so it is measurable.
    static bool ExpensivePredicate(int n)
    {
        _calls++;
        var acc = 0;
        for (var i = 0; i < 2_000; i++) acc += i % 7;
        return acc >= 0 && n % 3 == 0;
    }

    static void Main()
    {
        var source = Enumerable.Range(1, 3_000).ToArray();

        Console.WriteLine("--- one query, three uses: the work happens three times ---");
        _calls = 0;
        var q = source.Where(ExpensivePredicate);

        var sw = Stopwatch.StartNew();
        var count = q.Count();
        var first = q.First();
        var total = q.Sum();
        sw.Stop();

        Console.WriteLine($"  Count={count} First={first} Sum={total}");
        Console.WriteLine($"  predicate calls : {_calls}");
        Console.WriteLine($"  elapsed         : {sw.Elapsed.TotalMilliseconds:0.0} ms");
        Console.WriteLine("  Three uses of one variable. First() stopped early, which is");
        Console.WriteLine("  why the total is not exactly 3 x 3000.");

        Console.WriteLine();
        Console.WriteLine("--- materialise once, use three times ---");
        _calls = 0;
        sw.Restart();
        var materialised = source.Where(ExpensivePredicate).ToList();
        count = materialised.Count;
        first = materialised[0];
        total = materialised.Sum();
        sw.Stop();

        Console.WriteLine($"  Count={count} First={first} Sum={total}");
        Console.WriteLine($"  predicate calls : {_calls}");
        Console.WriteLine($"  elapsed         : {sw.Elapsed.TotalMilliseconds:0.0} ms");
        Console.WriteLine("  Same three answers. One pass over the data.");

        Console.WriteLine();
        Console.WriteLine("--- the same trap hidden behind a method boundary ---");
        _calls = 0;
        Report(source.Where(ExpensivePredicate));
        Console.WriteLine($"  predicate calls : {_calls}");
        Console.WriteLine("  Report() looks like it takes a collection. It takes a recipe,");
        Console.WriteLine("  and it runs that recipe once per parameter use.");

        Console.WriteLine();
        Console.WriteLine("--- Any() vs Count() > 0 on a deferred query ---");
        _calls = 0;
        var anyResult = source.Where(ExpensivePredicate).Any();
        var anyCalls = _calls;
        _calls = 0;
        var countResult = source.Where(ExpensivePredicate).Count() > 0;
        Console.WriteLine($"  Any()       : {anyResult,-5} predicate calls: {anyCalls}");
        Console.WriteLine($"  Count() > 0 : {countResult,-5} predicate calls: {_calls}");
        Console.WriteLine("  Any() stops at the first match. Count() has to see everything.");

        Console.WriteLine();
        Console.WriteLine("--- Count() is not always a full pass ---");
        var asList = source.ToList();
        IEnumerable<int> asSequence = asList;
        sw.Restart();
        for (var i = 0; i < 100_000; i++) _ = asSequence.Count();
        sw.Stop();
        Console.WriteLine($"  Count() on a List<int> seen as IEnumerable<int>, 100k times:");
        Console.WriteLine($"    {sw.Elapsed.TotalMilliseconds:0.0} ms");
        var filtered = asList.Where(n => n > 0);
        sw.Restart();
        for (var i = 0; i < 100_000; i++) _ = filtered.Count();
        sw.Stop();
        Console.WriteLine($"  Count() on the same list with a Where in front, 100k times:");
        Console.WriteLine($"    {sw.Elapsed.TotalMilliseconds:0.0} ms");
        Console.WriteLine("  Count() checks for ICollection<T> and reads .Count in O(1).");
        Console.WriteLine("  One Where in front removes that fast path: it is O(n) again.");
    }

    static void Report(IEnumerable<int> items)
    {
        Console.WriteLine($"  count : {items.Count()}");
        Console.WriteLine($"  sum   : {items.Sum()}");
        Console.WriteLine($"  max   : {items.Max()}");
    }
}
