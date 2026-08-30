// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 04-exercises.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct Sale(string Rep, string Region, decimal Amount);

class Program
{
    static readonly Sale[] Sales =
    {
        new("ada",   "eu", 120m), new("grace", "eu", 300m),
        new("ada",   "us", 450m), new("linus", "eu",  80m),
        new("grace", "us", 900m), new("ada",   "eu", 220m)
    };

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: the two syntaxes =====");
        var q = from s in Sales where s.Amount > 100m orderby s.Amount select s.Rep;
        var m = Sales.Where(s => s.Amount > 100m).OrderBy(s => s.Amount).Select(s => s.Rep);
        Console.WriteLine($"  query  : {string.Join(", ", q)}");
        Console.WriteLine($"  method : {string.Join(", ", m)}");
        Console.WriteLine($"  equal  : {q.SequenceEqual(m)}");
        Console.WriteLine($"  types  : {q.GetType().Name} / {m.GetType().Name}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: what 'let' lowers to =====");
        var withLet = from s in Sales
                      let vat = s.Amount * 0.20m
                      where vat > 50m
                      select $"{s.Rep}:{vat:0.00}";
        var asMethods = Sales
            .Select(s => new { s, vat = s.Amount * 0.20m })
            .Where(x => x.vat > 50m)
            .Select(x => $"{x.s.Rep}:{x.vat:0.00}");
        Console.WriteLine($"  query  : {string.Join(", ", withLet)}");
        Console.WriteLine($"  method : {string.Join(", ", asMethods)}");
        Console.WriteLine($"  equal  : {withLet.SequenceEqual(asMethods)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: First vs Single vs *OrDefault =====");
        Try("First(eu)", () => Sales.First(s => s.Region == "eu").Rep);
        Try("Single(eu)", () => Sales.Single(s => s.Region == "eu").Rep);
        Try("First(amount>9999)", () => Sales.First(s => s.Amount > 9999m).Rep);
        Try("FirstOrDefault(>9999)", () => Sales.FirstOrDefault(s => s.Amount > 9999m).Rep ?? "(null Rep)");
        Try("Single(amount==900)", () => Sales.Single(s => s.Amount == 900m).Rep);
        Try("SingleOrDefault(>9999)", () => Sales.SingleOrDefault(s => s.Amount > 9999m).Rep ?? "(null Rep)");

        Console.WriteLine();
        Console.WriteLine("  Note FirstOrDefault on a STRUCT sequence returns default(Sale),");
        Console.WriteLine("  whose Rep is null — not a null Sale. That is the default-value");
        Console.WriteLine("  trap from the structs module arriving through LINQ.");
        var d = Sales.FirstOrDefault(s => s.Amount > 9999m);
        Console.WriteLine($"  default(Sale) == returned : {d == default}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: grouping with a composite key =====");
        var grouped = Sales
            .GroupBy(s => new { s.Rep, s.Region })
            .OrderBy(g => g.Key.Rep).ThenBy(g => g.Key.Region)
            .Select(g => $"{g.Key.Rep}/{g.Key.Region}={g.Sum(x => x.Amount):0}");
        Console.WriteLine($"  {string.Join(" | ", grouped)}");

        var k1 = new { Rep = "ada", Region = "eu" };
        var k2 = new { Rep = "ada", Region = "eu" };
        Console.WriteLine($"  two identical anonymous keys are equal : {k1.Equals(k2)}");
        Console.WriteLine($"  and hash the same                      : {k1.GetHashCode() == k2.GetHashCode()}");
    }

    static void Try(string label, Func<string> f)
    {
        try { Console.WriteLine($"  {label,-24} {f()}"); }
        catch (InvalidOperationException ex)
        { Console.WriteLine($"  {label,-24} {ex.GetType().Name}: {ex.Message}"); }
    }
}
