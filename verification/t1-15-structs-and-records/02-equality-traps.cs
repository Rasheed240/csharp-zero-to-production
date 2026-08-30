// 02-equality-traps.cs — record equality is member-by-member, and "member-by-
// member" means each member's OWN Equals. For a collection that is reference
// equality, so two records with identical contents are not equal.
// .NET 10.0.400. Run: dotnet run 02-equality-traps.cs

using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;

public record Order(string Id, List<string> Lines);
public record OrderWithArray(string Id, string[] Lines);
public record OrderImmutable(string Id, ImmutableArray<string> Lines);

// The fix that actually works: compare the collection yourself.
public record OrderFixed(string Id, IReadOnlyList<string> Lines)
{
    // For an unsealed record this must be 'virtual bool Equals(OrderFixed?)'.
    public virtual bool Equals(OrderFixed? other) =>
        other is not null && Id == other.Id && Lines.SequenceEqual(other.Lines);

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(Id);
        foreach (var line in Lines) hash.Add(line);
        return hash.ToHashCode();
    }
}

// ---- record inheritance ---------------------------------------------------
public record Person(string Name);
public record Employee(string Name, string Department) : Person(Name);

// ---- a record used as a dictionary key ------------------------------------
public record struct MutableKey(int Id)
{
    public int Id { get; set; } = Id;      // record struct properties are settable
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. a record holding a List ---");
        var a = new Order("O-1", new List<string> { "widget", "gizmo" });
        var b = new Order("O-1", new List<string> { "widget", "gizmo" });
        Console.WriteLine($"  contents identical? {a.Lines.SequenceEqual(b.Lines)}");
        Console.WriteLine($"  a == b              : {a == b}");
        Console.WriteLine("  The Id matched. The List did not, because List<T>.Equals is");
        Console.WriteLine("  reference equality — two different lists are never equal.");

        var shared = new List<string> { "widget" };
        var c = new Order("O-2", shared);
        var d = new Order("O-2", shared);
        Console.WriteLine($"  two records sharing ONE list: c == d  : {c == d}");

        Console.WriteLine();
        Console.WriteLine("--- arrays behave the same way ---");
        var e = new OrderWithArray("O-3", new[] { "x" });
        var f = new OrderWithArray("O-3", new[] { "x" });
        Console.WriteLine($"  e == f : {e == f}");

        Console.WriteLine();
        Console.WriteLine("--- immutable collections do NOT help ---");
        var g = new OrderImmutable("O-4", ImmutableArray.Create("x", "y"));
        var h = new OrderImmutable("O-4", ImmutableArray.Create("x", "y"));
        Console.WriteLine($"  ImmutableArray: g == h            : {g == h}");
        var sameArray = ImmutableArray.Create("x", "y");
        Console.WriteLine($"  ...but sharing ONE instance       : " +
                          $"{new OrderImmutable("O-4", sameArray) == new OrderImmutable("O-4", sameArray)}");
        Console.WriteLine("  ImmutableArray<T> is a struct wrapping an array, and its Equals");
        Console.WriteLine("  compares that array by REFERENCE. Immutable does not mean");
        Console.WriteLine("  value-equal. No built-in collection type gives a record what");
        Console.WriteLine("  people expect here.");

        Console.WriteLine();
        Console.WriteLine("--- what does work: write Equals and GetHashCode yourself ---");
        var i1 = new OrderFixed("O-7", new[] { "x", "y" });
        var i2 = new OrderFixed("O-7", new[] { "x", "y" });
        Console.WriteLine($"  i1 == i2                          : {i1 == i2}");
        Console.WriteLine($"  hash codes match                  : {i1.GetHashCode() == i2.GetHashCode()}");
        Console.WriteLine("  A record lets you replace the generated Equals; you must then");
        Console.WriteLine("  replace GetHashCode too, or dictionary lookups break.");

        Console.WriteLine();
        Console.WriteLine("--- 2. 'with' is a SHALLOW copy ---");
        var original = new Order("O-5", new List<string> { "widget" });
        var copy = original with { Id = "O-6" };
        Console.WriteLine($"  same List instance? {ReferenceEquals(original.Lines, copy.Lines)}");
        copy.Lines.Add("added via the copy");
        Console.WriteLine($"  original.Lines now : {string.Join(", ", original.Lines)}");
        Console.WriteLine("  Changing the copy changed the original.");

        Console.WriteLine();
        Console.WriteLine("--- 3. record inheritance and EqualityContract ---");
        Person p = new Person("Ada");
        Person emp = new Employee("Ada", "Research");
        Console.WriteLine($"  p.Name == emp.Name : {p.Name == emp.Name}");
        Console.WriteLine($"  p == emp           : {p == emp}");
        Console.WriteLine($"  emp.Equals(p)      : {emp.Equals(p)}");
        Console.WriteLine("  A record compares its EqualityContract (its runtime type) first,");
        Console.WriteLine("  so a base and a derived record are never equal — which is what");
        Console.WriteLine("  makes record equality symmetric.");
        Console.WriteLine($"  emp                : {emp}");

        Console.WriteLine();
        Console.WriteLine("--- 4. a mutable record struct as a dictionary key ---");
        var key = new MutableKey(1);
        var map = new Dictionary<MutableKey, string> { [key] = "first" };
        Console.WriteLine($"  lookup before mutation : {map.ContainsKey(key)}");
        key.Id = 99;
        Console.WriteLine($"  after mutating the local copy, lookup with it : {map.ContainsKey(key)}");
        Console.WriteLine($"  entries still in the dictionary : {map.Count}");
        Console.WriteLine($"  the stored key is still : {map.Keys.First()}");
        Console.WriteLine("  A struct key was COPIED into the dictionary, so mutating the");
        Console.WriteLine("  local did not corrupt it — but the lookup now misses.");
    }
}
