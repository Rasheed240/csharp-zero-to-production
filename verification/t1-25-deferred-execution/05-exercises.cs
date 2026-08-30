// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 05-exercises.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Program
{
    static int _predicateCalls;
    static int _projectionCalls;
    static double _sink;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: what does each line print? =====");
        var numbers = new List<int> { 1, 2, 3 };
        var doubled = numbers.Select(n => n * 2);
        var snapshot = numbers.Select(n => n * 2).ToList();
        numbers.Add(4);
        Console.WriteLine($"  doubled  : {string.Join(", ", doubled)}");
        Console.WriteLine($"  snapshot : {string.Join(", ", snapshot)}");
        numbers.Clear();
        Console.WriteLine($"  doubled after Clear()  : [{string.Join(", ", doubled)}]");
        Console.WriteLine($"  snapshot after Clear() : {string.Join(", ", snapshot)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: how many times does the predicate run? =====");
        var source = Enumerable.Range(1, 100).ToArray();
        _predicateCalls = 0;
        Summarise(source.Where(Even));
        Console.WriteLine($"  predicate calls : {_predicateCalls}");
        _predicateCalls = 0;
        Summarise(source.Where(Even).ToList());
        Console.WriteLine($"  with ToList()   : {_predicateCalls}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: the query that outlives its source =====");
        try
        {
            foreach (var name in BrokenNames()) Console.WriteLine($"    {name}");
        }
        catch (ObjectDisposedException)
        {
            Console.WriteLine("    ObjectDisposedException on the first MoveNext");
        }
        Console.WriteLine("  fixed version:");
        foreach (var name in FixedNames()) Console.WriteLine($"    {name}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4a: operator ORDER changes how much work happens =====");
        var readings = Enumerable.Range(0, 100_000).ToArray();

        _predicateCalls = _projectionCalls = 0;
        _sink = readings.Where(n => { _predicateCalls++; return n % 1000 == 0; })
                        .Select(n => { _projectionCalls++; return (double)n; })
                        .Sum();
        Console.WriteLine($"  Where then Select : predicate {_predicateCalls:N0}, projection {_projectionCalls:N0}");

        _predicateCalls = _projectionCalls = 0;
        _sink = readings.Select(n => { _projectionCalls++; return (double)n; })
                        .Where(n => { _predicateCalls++; return n % 1000 == 0; })
                        .Sum();
        Console.WriteLine($"  Select then Where : predicate {_predicateCalls:N0}, projection {_projectionCalls:N0}");
        Console.WriteLine("  Same answer, 100x more projections in the second.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4b: is the loop worth writing? =====");
        var data = Enumerable.Range(0, 500_000).Select(i => (double)(i % 997)).ToArray();

        var linq = Time(() => data.Where(v => v > 500).Select(v => v * 1.5).Sum());
        var loop = Time(() =>
        {
            double total = 0;
            foreach (var v in data) if (v > 500) total += v * 1.5;
            return total;
        });
        Console.WriteLine($"  linq : {linq:0.00} ms/pass");
        Console.WriteLine($"  loop : {loop:0.00} ms/pass  ({linq / loop:0.0}x faster)");
        Console.WriteLine($"  saved per pass : {linq - loop:0.00} ms");
        Console.WriteLine($"  at 10 calls/second that is {(linq - loop) * 10:0.0} ms/second of CPU;");
        Console.WriteLine($"  at 10 calls/day it is {(linq - loop) * 10:0.0} ms/day.");
    }

    static bool Even(int n) { _predicateCalls++; return n % 2 == 0; }

    static void Summarise(IEnumerable<int> items)
    {
        Console.WriteLine($"  count={items.Count()} sum={items.Sum()} first={items.First()}");
    }

    static IEnumerable<string> BrokenNames()
    {
        using var store = new FakeStore();
        return store.Names().Select(n => n.ToUpperInvariant());   // deferred; store is gone
    }

    static IEnumerable<string> FixedNames()
    {
        using var store = new FakeStore();
        return store.Names().Select(n => n.ToUpperInvariant()).ToList();
    }

    static double Time(Func<double> f)
    {
        for (var i = 0; i < 10; i++) f();
        var sw = Stopwatch.StartNew();
        double acc = 0;
        for (var r = 0; r < 100; r++) acc += f();
        sw.Stop();
        _sink = acc;
        return sw.Elapsed.TotalMilliseconds / 100;
    }
}

sealed class FakeStore : IDisposable
{
    private bool _disposed;
    public void Dispose() => _disposed = true;

    public IEnumerable<string> Names()
    {
        foreach (var n in new[] { "ada", "grace" })
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            yield return n;
        }
    }
}
