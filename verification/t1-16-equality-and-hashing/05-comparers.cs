// 05-comparers.cs — == is not Equals, and when neither is the equality you
// want, you supply a comparer instead of changing the type.
// .NET 10.0.400. Run: dotnet run 05-comparers.cs

using System;
using System.Collections.Generic;
using System.Linq;

sealed class Box { public int V; public Box(int v) => V = v; }

sealed record Tag(string Name);

sealed class IgnoreCase : IEqualityComparer<string>
{
    public bool Equals(string? a, string? b) =>
        string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    public int GetHashCode(string s) => s.ToLowerInvariant().GetHashCode();
}

// An INCONSISTENT comparer: it does not define a total order.
sealed class BrokenComparer : IComparer<int>
{
    public int Compare(int a, int b) => (a % 3).CompareTo(b % 3) == 0 ? 1 : (a % 3).CompareTo(b % 3);
}

sealed class ByLength : IComparer<string>
{
    public int Compare(string? a, string? b) =>
        (a?.Length ?? 0).CompareTo(b?.Length ?? 0) is var byLen && byLen != 0
            ? byLen
            : string.CompareOrdinal(a, b);
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- == and Equals do not always agree ---");
        object s1 = new string("hello".ToCharArray());
        object s2 = new string("hello".ToCharArray());
        Console.WriteLine($"  two separately built strings, as object:");
        Console.WriteLine($"    s1 == s2                 : {s1 == s2}    (reference comparison)");
        Console.WriteLine($"    s1.Equals(s2)            : {s1.Equals(s2)}     (string's Equals)");
        Console.WriteLine($"    ReferenceEquals(s1, s2)  : {ReferenceEquals(s1, s2)}");

        string t1 = (string)s1, t2 = (string)s2;
        Console.WriteLine($"  the same two, typed as string:");
        Console.WriteLine($"    t1 == t2                 : {t1 == t2}     (string's == operator)");

        Console.WriteLine();
        Console.WriteLine("  == on a class with no operator is reference comparison:");
        var b1 = new Box(5);
        var b2 = new Box(5);
        Console.WriteLine($"    b1 == b2                 : {b1 == b2}");
        Console.WriteLine($"    b1.Equals(b2)            : {b1.Equals(b2)}");

        Console.WriteLine("  == on a record IS value comparison, because one is generated:");
        Console.WriteLine($"    new Tag(\"x\") == new Tag(\"x\") : {new Tag("x") == new Tag("x")}");

        Console.WriteLine();
        Console.WriteLine("--- a comparer changes equality without changing the type ---");
        var plain = new Dictionary<string, int> { ["Region"] = 1 };
        Console.WriteLine($"  default dictionary, lookup \"region\" : {plain.ContainsKey("region")}");

        var insensitive = new Dictionary<string, int>(new IgnoreCase()) { ["Region"] = 1 };
        Console.WriteLine($"  IgnoreCase comparer, lookup \"region\": {insensitive.ContainsKey("region")}");

        var builtIn = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["Region"] = 1 };
        Console.WriteLine($"  StringComparer.OrdinalIgnoreCase   : {builtIn.ContainsKey("region")}");
        Console.WriteLine("  The built-in one is the right choice: it hashes without allocating");
        Console.WriteLine("  a lowercase copy of every key, which the hand-written one does.");

        Console.WriteLine();
        Console.WriteLine("--- IComparer defines ORDER, not equality ---");
        var words = new[] { "pear", "fig", "banana", "kiwi", "date" };
        var byLength = words.OrderBy(w => w, new ByLength()).ToArray();
        Console.WriteLine($"  sorted by length then ordinal: {string.Join(", ", byLength)}");

        Console.WriteLine();
        Console.WriteLine("--- an inconsistent comparer is detected, sometimes ---");
        var numbers = Enumerable.Range(0, 40).ToArray();
        try
        {
            Array.Sort(numbers, new BrokenComparer());
            Console.WriteLine($"  sort completed: {string.Join(",", numbers.Take(12))} ...");
            Console.WriteLine("  No exception this run — an invalid comparer is not always caught.");
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine($"  inner: {ex.InnerException?.GetType().Name}: {ex.InnerException?.Message}");
        }
    }
}
