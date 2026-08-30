// The compiler warns about HalfDone: "CS0659: overrides Object.Equals(object o)
// but does not override Object.GetHashCode()". That warning is the point of
// this file, so it is suppressed here rather than fixed.
#:property NoWarn=CS0659

// 01-the-contract.cs — the hash code contract, and what breaking each half of
// it does to a Dictionary.
// .NET 10.0.400. Run: dotnet run 01-the-contract.cs

using System;
using System.Collections.Generic;

// ---- BROKEN: Equals overridden, GetHashCode not --------------------------
sealed class HalfDone
{
    public string Name { get; }
    public HalfDone(string name) => Name = name;

    public override bool Equals(object? obj) => obj is HalfDone o && o.Name == Name;
    // No GetHashCode override. Inherits object's, which is per-instance.
    public override string ToString() => $"HalfDone({Name})";
}

// ---- BROKEN the other way: constant hash code ----------------------------
sealed class AlwaysSameHash
{
    public string Name { get; }
    public AlwaysSameHash(string name) => Name = name;
    public override bool Equals(object? obj) => obj is AlwaysSameHash o && o.Name == Name;
    public override int GetHashCode() => 1;          // legal, and ruinous
}

// ---- CORRECT -------------------------------------------------------------
sealed class Correct
{
    public string Name { get; }
    public Correct(string name) => Name = name;
    public override bool Equals(object? obj) => obj is Correct o && o.Name == Name;
    public override int GetHashCode() => Name.GetHashCode();
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- Equals says equal, hash codes differ ---");
        var a = new HalfDone("ada");
        var b = new HalfDone("ada");
        Console.WriteLine($"  a.Equals(b)                 : {a.Equals(b)}");
        Console.WriteLine($"  a.GetHashCode() == b's      : {a.GetHashCode() == b.GetHashCode()}");

        var dict = new Dictionary<HalfDone, string> { [a] = "stored under a" };
        Console.WriteLine($"  dict.ContainsKey(a)         : {dict.ContainsKey(a)}");
        Console.WriteLine($"  dict.ContainsKey(b)         : {dict.ContainsKey(b)}");
        Console.WriteLine("  b is equal to a and cannot find a's entry: the lookup goes to a");
        Console.WriteLine("  different bucket and never compares anything.");

        var set = new HashSet<HalfDone> { a, b };
        Console.WriteLine($"  HashSet of two 'equal' items: Count = {set.Count}");

        Console.WriteLine();
        Console.WriteLine("--- the correct version ---");
        var c1 = new Correct("ada");
        var c2 = new Correct("ada");
        var ok = new Dictionary<Correct, string> { [c1] = "stored" };
        Console.WriteLine($"  ContainsKey(c2)             : {ok.ContainsKey(c2)}");
        Console.WriteLine($"  HashSet count for two equal : {new HashSet<Correct> { c1, c2 }.Count}");

        Console.WriteLine();
        Console.WriteLine("--- a constant hash code is legal and turns O(1) into O(n) ---");
        var same = new Dictionary<AlwaysSameHash, int>();
        for (int i = 0; i < 5; i++) same[new AlwaysSameHash($"k{i}")] = i;
        Console.WriteLine($"  entries stored              : {same.Count}");
        Console.WriteLine($"  lookup still correct        : {same.ContainsKey(new AlwaysSameHash("k3"))}");
        Console.WriteLine("  Correct, and every key lands in one bucket, so every lookup");
        Console.WriteLine("  compares against every key. The cost of this is measured in");
        Console.WriteLine("  03-hash-quality.cs.");

        Console.WriteLine();
        Console.WriteLine("The contract, in two lines:");
        Console.WriteLine("  1. If two objects are equal, their hash codes MUST be equal.");
        Console.WriteLine("  2. If two hash codes are equal, the objects MAY or may not be.");
        Console.WriteLine("Rule 1 is a correctness requirement. Rule 2 is why rule 1 is enough.");
    }
}
