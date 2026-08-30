// 07-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 07-exercises.cs

using System;
using System.Collections.Generic;
using System.Linq;

// ===== Exercise 1 ==========================================================
interface IGreeter
{
    string Name { get; }
    string Greet() => $"Hello, {Name}";
}

sealed class Quiet : IGreeter { public string Name => "Quiet"; }

sealed class Loud : IGreeter
{
    public string Name => "Loud";
    public string Greet() => $"HELLO, {Name.ToUpperInvariant()}!";
}

// ===== Exercise 2 ==========================================================
interface IMetres { double Value { get; } }
interface IFeet { double Value { get; } }

sealed class Distance : IMetres, IFeet
{
    private readonly double _metres;
    public Distance(double metres) => _metres = metres;

    double IMetres.Value => _metres;
    double IFeet.Value => _metres * 3.28084;

    public double Value => _metres;      // the class's own, unambiguous member
}

// ===== Exercise 4 ==========================================================
public interface IRepository<T>
{
    T? Find(string id);
    void Save(T item);
    // Added in v2 WITH a default, so existing implementors keep compiling.
    IReadOnlyList<T> FindMany(IEnumerable<string> ids)
        => ids.Select(Find).OfType<T>().ToArray();
}

public sealed record Customer(string Id, string Name);

public sealed class InMemoryCustomers : IRepository<Customer>
{
    private readonly Dictionary<string, Customer> _byId = new();
    public Customer? Find(string id) => _byId.GetValueOrDefault(id);
    public void Save(Customer item) => _byId[item.Id] = item;
}

public sealed class CountingCustomers : IRepository<Customer>
{
    private readonly Dictionary<string, Customer> _byId = new();
    public int FindManyCalls { get; private set; }

    public Customer? Find(string id) => _byId.GetValueOrDefault(id);
    public void Save(Customer item) => _byId[item.Id] = item;

    // Overrides the default with one round trip instead of N.
    public IReadOnlyList<Customer> FindMany(IEnumerable<string> ids)
    {
        FindManyCalls++;
        return ids.Where(_byId.ContainsKey).Select(id => _byId[id]).ToArray();
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1 =====");
        IGreeter[] gs = { new Quiet(), new Loud() };
        foreach (var g in gs) Console.WriteLine($"  via IGreeter : {g.Greet()}");
        Console.WriteLine($"  new Loud().Greet()  : {new Loud().Greet()}");
        Console.WriteLine("  new Quiet().Greet() : does not compile (CS1061)");
        Console.WriteLine($"  typeof(Quiet).GetMethod(\"Greet\") is null : {typeof(Quiet).GetMethod("Greet") is null}");
        Console.WriteLine($"  typeof(Loud).GetMethod(\"Greet\")  is null : {typeof(Loud).GetMethod("Greet") is null}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2 =====");
        var d = new Distance(100);
        Console.WriteLine($"  d.Value            = {d.Value}");
        Console.WriteLine($"  ((IMetres)d).Value = {((IMetres)d).Value}");
        Console.WriteLine($"  ((IFeet)d).Value   = {((IFeet)d).Value:F2}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4 =====");
        var mem = new InMemoryCustomers();
        mem.Save(new Customer("C-1", "Ada"));
        mem.Save(new Customer("C-2", "Grace"));
        IRepository<Customer> repo = mem;
        var found = repo.FindMany(new[] { "C-1", "C-2", "C-3" });
        Console.WriteLine($"  InMemoryCustomers (uses the default): {found.Count} found -> " +
                          $"{string.Join(", ", found.Select(c => c.Name))}");

        var counting = new CountingCustomers();
        counting.Save(new Customer("C-1", "Ada"));
        counting.Save(new Customer("C-2", "Grace"));
        IRepository<Customer> repo2 = counting;
        var found2 = repo2.FindMany(new[] { "C-1", "C-2", "C-3" });
        Console.WriteLine($"  CountingCustomers (own version)     : {found2.Count} found, " +
                          $"FindManyCalls={counting.FindManyCalls}");
        Console.WriteLine($"  through the class directly          : " +
                          $"{counting.FindMany(new[] { "C-1" }).Count} found, " +
                          $"FindManyCalls={counting.FindManyCalls}");
    }
}
