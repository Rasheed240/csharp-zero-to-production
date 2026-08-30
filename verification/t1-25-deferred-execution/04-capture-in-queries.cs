// 04-capture-in-queries.cs — what a deferred query captures, and the three ways
// that combination bites: a variable changed after the query is built, a query
// built in a loop, and a query outliving the resource it reads from.
// .NET 10.0.400. Run: dotnet run 04-capture-in-queries.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static void Main()
    {
        var source = new[] { 1, 2, 3, 4, 5, 6 };

        Console.WriteLine("--- a query captures the VARIABLE, not its value ---");
        var threshold = 3;
        var q = source.Where(n => n > threshold);
        Console.WriteLine($"  threshold = 3 : {string.Join(", ", q)}");
        threshold = 5;
        Console.WriteLine($"  threshold = 5 : {string.Join(", ", q)}");
        Console.WriteLine("  Same query variable, different answers. The lambda holds a");
        Console.WriteLine("  reference to the closure field, and it is read at enumeration.");

        Console.WriteLine();
        Console.WriteLine("--- the same thing, materialised ---");
        threshold = 3;
        var fixedResult = source.Where(n => n > threshold).ToList();
        threshold = 5;
        Console.WriteLine($"  after ToList and threshold = 5 : {string.Join(", ", fixedResult)}");
        Console.WriteLine("  ToList ran the predicate while threshold was still 3.");

        Console.WriteLine();
        Console.WriteLine("--- queries built in a loop: the foreach variable is per-iteration ---");
        var perIteration = new List<IEnumerable<int>>();
        foreach (var limit in new[] { 2, 4, 6 })
            perIteration.Add(source.Where(n => n < limit));
        Console.WriteLine("  built with foreach:");
        foreach (var built in perIteration)
            Console.WriteLine($"    {string.Join(", ", built)}");
        Console.WriteLine("  Three different answers: since C# 5 each foreach iteration");
        Console.WriteLine("  gets a fresh variable, so each query captured its own.");

        Console.WriteLine();
        Console.WriteLine("--- a for loop shares ONE variable across all iterations ---");
        var shared = new List<IEnumerable<int>>();
        for (var limit = 2; limit <= 6; limit += 2)
            shared.Add(source.Where(n => n < limit));
        Console.WriteLine("  built with for:");
        foreach (var built in shared)
            Console.WriteLine($"    {string.Join(", ", built)}");
        Console.WriteLine("  All three identical, and all three use the value the loop");
        Console.WriteLine("  variable ended on (8), because there is one variable.");

        Console.WriteLine();
        Console.WriteLine("  the fix is a per-iteration copy:");
        var copied = new List<IEnumerable<int>>();
        for (var limit = 2; limit <= 6; limit += 2)
        {
            var local = limit;
            copied.Add(source.Where(n => n < local));
        }
        foreach (var built in copied)
            Console.WriteLine($"    {string.Join(", ", built)}");

        Console.WriteLine();
        Console.WriteLine("--- a deferred query that outlives its source ---");
        IEnumerable<string> leaked;
        using (var reader = new FakeReader())
        {
            leaked = reader.Lines().Select(l => l.ToUpperInvariant());
            Console.WriteLine($"  inside the using : {string.Join(", ", leaked)}");
        }
        try
        {
            Console.WriteLine($"  after the using  : {string.Join(", ", leaked)}");
        }
        catch (ObjectDisposedException ex)
        {
            Console.WriteLine($"  after the using  : ObjectDisposedException ({ex.ObjectName})");
        }
        Console.WriteLine("  Returning a deferred query from a method that owns a resource");
        Console.WriteLine("  hands the caller something that cannot work. ToList() before");
        Console.WriteLine("  the using block closes is the fix.");

        Console.WriteLine();
        Console.WriteLine("--- the query does not have to be enumerated at all ---");
        var ran = false;
        var never = source.Select(n => { ran = true; return n; });
        Console.WriteLine($"  query built, ran = {ran}");
        Console.WriteLine("  A query nobody enumerates does nothing. That is the same");
        Console.WriteLine("  reason a Select used purely for its side effects is a bug:");
        Console.WriteLine("  it looks like a loop and executes like a definition.");
    }
}

sealed class FakeReader : IDisposable
{
    private bool _disposed;
    public void Dispose() => _disposed = true;

    public IEnumerable<string> Lines()
    {
        foreach (var line in new[] { "alpha", "beta" })
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            yield return line;
        }
    }
}
