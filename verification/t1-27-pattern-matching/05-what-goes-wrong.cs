// 05-what-goes-wrong.cs — the failure modes that survive compilation. Each one
// builds clean and does something other than what it reads like.
// .NET 10.0.400. Run: dotnet run 05-what-goes-wrong.cs

using System;
using System.Collections.Generic;
using System.Linq;

// A type that overloads == to compare by value, and is therefore never null-safe
// to compare with ==.
sealed class Reference
{
    public string Value { get; }
    public Reference(string value) => Value = value;

    public static bool operator ==(Reference? a, Reference? b)
    {
        // Deliberately naive, and extremely common in real code.
        return a!.Value == b!.Value;
    }

    public static bool operator !=(Reference? a, Reference? b) => !(a == b);
    public override bool Equals(object? o) => o is Reference r && r.Value == Value;
    public override int GetHashCode() => Value.GetHashCode();
}

record Money(decimal Amount, string Currency);

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. 'is null' cannot be hijacked. '== null' can ---");
        Reference? r = null;
        Console.WriteLine($"  r is null   : {r is null}");
        try
        {
            Console.WriteLine($"  r == null   : {r == null}");
        }
        catch (NullReferenceException)
        {
            Console.WriteLine("  r == null   : NullReferenceException from the OPERATOR");
        }
        Console.WriteLine("  'is null' compiles to a reference comparison the type cannot");
        Console.WriteLine("  intercept. '== null' calls whatever operator== the type declares.");

        Console.WriteLine();
        Console.WriteLine("--- 2. a type pattern silently drops nulls ---");
        var refs = new List<object?> { "a", null, "b", null, 42 };
        var kept = refs.Count(x => x is string);
        Console.WriteLine($"  {refs.Count} items (2 strings, 2 nulls, 1 int), {kept} match 'is string'");
        Console.WriteLine("  The two nulls did not match and did not raise anything. In a");
        Console.WriteLine("  filter this reads as 'keep the strings' and behaves as");
        Console.WriteLine("  'silently discard the nulls'.");
        var explicitly = refs.Count(x => x is string or null);
        Console.WriteLine($"  'is string or null' matches : {explicitly}");
        Console.WriteLine("  Two nulls silently gone, and an int silently gone. One pattern,");
        Console.WriteLine("  two entirely different reasons for a row to disappear.");

        Console.WriteLine();
        Console.WriteLine("--- 3. 'not null' with && reads backwards to most people ---");
        object? o = null;
        Console.WriteLine($"  o is not null and string   : {o is not null and string}");
        Console.WriteLine($"  o is not (null or string)  : {o is not (null or string)}");
        o = 42;
        Console.WriteLine($"  42 is not null and string  : {o is not null and string}");
        Console.WriteLine($"  42 is not (null or string) : {o is not (null or string)}");
        Console.WriteLine("  'and'/'or' bind tighter than you may expect. Parenthesise.");

        Console.WriteLine();
        Console.WriteLine("--- 4. a property pattern on a null member does not throw ---");
        Money? m = null;
        var nullMatches = m is { Amount: > 0m };
        Console.WriteLine($"  null matched against a property pattern : {nullMatches}");
        Console.WriteLine("  The whole pattern fails rather than dereferencing null. That is");
        Console.WriteLine("  the good news. The bad news is that a FAILED match and a");
        Console.WriteLine("  MISSING value are indistinguishable at the call site.");

        Console.WriteLine();
        Console.WriteLine("--- 5. positional patterns follow POSITION, not name ---");
        var swapped = new Money(0m, "GBP");
        if (swapped is (var a1, var b1))
            Console.WriteLine($"  Money(0, GBP) deconstructs to ({a1}, {b1})");
        Console.WriteLine("  Rename or reorder the record's parameters and every positional");
        Console.WriteLine("  pattern in the codebase keeps compiling with different meaning.");
        Console.WriteLine("  A property pattern { Amount: ..., Currency: ... } breaks loudly.");

        Console.WriteLine();
        Console.WriteLine("--- 6. list patterns need a length and an indexer ---");
        int[] arr = { 1, 2, 3 };
        var list = new List<int> { 1, 2, 3 };
        const string text = "abc";
        Console.WriteLine($"  int[]      is [_,_,_] : {arr is [_, _, _]}");
        Console.WriteLine($"  List<int>  is [_,_,_] : {list is [_, _, _]}");
        Console.WriteLine($"  string     is [_,_,_] : {text is [_, _, _]}");
        Console.WriteLine("  IEnumerable<int> is [_,_,_] does not compile: CS8985, 'List patterns");
        Console.WriteLine("  may not be used for a value of type IEnumerable<int>'. A pattern");
        Console.WriteLine("  cannot enumerate a sequence, so it refuses rather than doing it");
        Console.WriteLine("  behind your back. (see 03-compile-errors.cs.txt)");

        Console.WriteLine();
        Console.WriteLine("--- 7. 'when' guards run for every candidate arm ---");
        var probes = 0;
        bool Expensive(int n) { probes++; return n > 1; }
        foreach (var n in new[] { 0, 1, 2, 3 })
        {
            _ = n switch
            {
                _ when Expensive(n) => "big",
                0 => "zero",
                _ => "small"
            };
        }
        Console.WriteLine($"  guard evaluated {probes} times for 4 inputs");
        Console.WriteLine("  A guard in the FIRST arm runs on every input, including the ones");
        Console.WriteLine("  a cheap later arm would have matched. Order guards last.");

        Console.WriteLine();
        Console.WriteLine("--- 8. matching on strings is ordinal and case-sensitive ---");
        var code = "INSUFFICIENT_FUNDS";
        var matched = code switch
        {
            "insufficient_funds" => "retry",
            _ => "no match"
        };
        Console.WriteLine($"  {code} -> {matched}");
        Console.WriteLine("  There is no way to make a constant pattern case-insensitive.");
        Console.WriteLine("  Normalise before the switch, or use a guard with an explicit");
        Console.WriteLine("  StringComparison.");
        var normalised = code.ToLowerInvariant() switch
        {
            "insufficient_funds" => "retry",
            _ => "no match"
        };
        Console.WriteLine($"  after ToLowerInvariant()             -> {normalised}");
    }
}
