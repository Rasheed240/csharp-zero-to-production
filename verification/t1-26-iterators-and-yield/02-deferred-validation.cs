// 02-deferred-validation.cs — the single most common iterator bug: argument
// validation that never runs at the call site, because the whole method body
// is deferred. Plus the standard two-method fix.
// .NET 10.0.400. Run: dotnet run 02-deferred-validation.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    // WRONG: the throw is inside the iterator body, so it is deferred with it.
    static IEnumerable<string> BrokenBatches(IReadOnlyList<string> source, int size)
    {
        if (size <= 0)
            throw new ArgumentOutOfRangeException(nameof(size), "size must be positive");

        for (var i = 0; i < source.Count; i += size)
            yield return string.Join("+", source.Skip(i).Take(size));
    }

    // RIGHT: a normal method validates and returns; a private iterator does the work.
    static IEnumerable<string> Batches(IReadOnlyList<string> source, int size)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (size <= 0)
            throw new ArgumentOutOfRangeException(nameof(size), "size must be positive");
        return Iterate(source, size);

        static IEnumerable<string> Iterate(IReadOnlyList<string> source, int size)
        {
            for (var i = 0; i < source.Count; i += size)
                yield return string.Join("+", source.Skip(i).Take(size));
        }
    }

    static void Main()
    {
        var data = new[] { "a", "b", "c", "d", "e" };

        Console.WriteLine("--- the broken version: calling it with a bad argument ---");
        try
        {
            var q = BrokenBatches(data, 0);
            Console.WriteLine("  the call returned WITHOUT throwing");
            Console.WriteLine($"  returned type : {q.GetType().Name}");
        }
        catch (ArgumentOutOfRangeException)
        {
            Console.WriteLine("  threw at the call site");
        }

        Console.WriteLine();
        Console.WriteLine("--- it throws later, wherever the caller enumerates ---");
        var broken = BrokenBatches(data, 0);
        try
        {
            foreach (var b in broken) Console.WriteLine(b);
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"  caught in the foreach: {ex.ParamName} — {ex.Message.Split('(')[0].Trim()}");
        }
        Console.WriteLine("  The stack trace points at MoveNext, not at the caller who");
        Console.WriteLine("  passed the bad value. The two can be far apart.");

        Console.WriteLine();
        Console.WriteLine("--- the fixed version throws where the mistake was made ---");
        try
        {
            var q = Batches(data, 0);
            Console.WriteLine("  the call returned without throwing (wrong)");
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"  threw at the call site: {ex.ParamName}");
        }

        Console.WriteLine();
        Console.WriteLine("--- and still streams when the arguments are valid ---");
        foreach (var b in Batches(data, 2)) Console.WriteLine($"  {b}");

        Console.WriteLine();
        Console.WriteLine("--- the same shape catches a null source immediately ---");
        try
        {
            _ = Batches(null!, 2);
        }
        catch (ArgumentNullException ex)
        {
            Console.WriteLine($"  ArgumentNullException at the call site: {ex.ParamName}");
        }
        var lateNull = BrokenBatches(null!, 2);
        Console.WriteLine("  the broken version returned an object for a null source;");
        try
        {
            foreach (var b in lateNull) { }
        }
        catch (NullReferenceException)
        {
            Console.WriteLine("  enumerating it threw NullReferenceException — the worst");
            Console.WriteLine("  possible message, from the worst possible place.");
        }
    }
}
