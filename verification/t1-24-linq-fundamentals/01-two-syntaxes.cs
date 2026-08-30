// 01-two-syntaxes.cs — query syntax is rewritten into method calls before
// anything else happens. The two forms are the same program.
// .NET 10.0.400. Run: dotnet run 01-two-syntaxes.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct Order(string Id, string Region, decimal Amount, int Year);

class Program
{
    static readonly Order[] Orders =
    {
        new("O-1", "eu-west", 120.00m, 2025),
        new("O-2", "us-east",  45.50m, 2026),
        new("O-3", "eu-west", 800.00m, 2026),
        new("O-4", "ap-south", 12.00m, 2025),
        new("O-5", "eu-west", 300.00m, 2026),
        new("O-6", "us-east", 950.00m, 2026)
    };

    static void Main()
    {
        Console.WriteLine("--- where + orderby + select ---");
        var query =
            from o in Orders
            where o.Amount >= 100m
            orderby o.Amount descending
            select o.Id;

        var method = Orders
            .Where(o => o.Amount >= 100m)
            .OrderByDescending(o => o.Amount)
            .Select(o => o.Id);

        Console.WriteLine($"  query syntax  : {string.Join(", ", query)}");
        Console.WriteLine($"  method syntax : {string.Join(", ", method)}");
        Console.WriteLine($"  identical     : {query.SequenceEqual(method)}");

        Console.WriteLine();
        Console.WriteLine("--- the runtime types are the same too ---");
        Console.WriteLine($"  query  : {query.GetType().Name}");
        Console.WriteLine($"  method : {method.GetType().Name}");

        Console.WriteLine();
        Console.WriteLine("--- 'let' introduces a range variable ---");
        var withLet =
            from o in Orders
            let withVat = o.Amount * 1.20m
            where withVat > 500m
            select $"{o.Id}={withVat:0.00}";

        var withLetAsMethods = Orders
            .Select(o => new { o, withVat = o.Amount * 1.20m })
            .Where(x => x.withVat > 500m)
            .Select(x => $"{x.o.Id}={x.withVat:0.00}");

        Console.WriteLine($"  query  : {string.Join(", ", withLet)}");
        Console.WriteLine($"  method : {string.Join(", ", withLetAsMethods)}");
        Console.WriteLine("  'let' compiles to a Select producing an anonymous type that carries");
        Console.WriteLine("  both the original item and the new value forward.");

        Console.WriteLine();
        Console.WriteLine("--- group by ---");
        var grouped =
            from o in Orders
            group o by o.Region into g
            orderby g.Key
            select $"{g.Key}={g.Count()}";

        var groupedAsMethods = Orders
            .GroupBy(o => o.Region)
            .OrderBy(g => g.Key)
            .Select(g => $"{g.Key}={g.Count()}");

        Console.WriteLine($"  query  : {string.Join(", ", grouped)}");
        Console.WriteLine($"  method : {string.Join(", ", groupedAsMethods)}");

        Console.WriteLine();
        Console.WriteLine("--- join ---");
        var regions = new[]
        {
            ("eu-west", "Europe"), ("us-east", "Americas"), ("ap-south", "Asia")
        };

        var joined =
            from o in Orders
            join r in regions on o.Region equals r.Item1
            where o.Amount > 100m
            select $"{o.Id}:{r.Item2}";

        var joinedAsMethods = Orders
            .Join(regions, o => o.Region, r => r.Item1, (o, r) => new { o, r })
            .Where(x => x.o.Amount > 100m)
            .Select(x => $"{x.o.Id}:{x.r.Item2}");

        Console.WriteLine($"  query  : {string.Join(", ", joined)}");
        Console.WriteLine($"  method : {string.Join(", ", joinedAsMethods)}");

        Console.WriteLine();
        Console.WriteLine("--- what query syntax CANNOT express ---");
        Console.WriteLine($"  Count()        : {Orders.Count(o => o.Amount > 100m)}");
        const string eu = "eu-west";
        Console.WriteLine($"  Any()          : {Orders.Any(o => o.Region == eu)}");
        Console.WriteLine($"  First()        : {Orders.First(o => o.Year == 2026).Id}");
        Console.WriteLine($"  Sum()          : {Orders.Sum(o => o.Amount):0.00}");
        Console.WriteLine($"  Skip/Take      : {string.Join(", ", Orders.Skip(2).Take(2).Select(o => o.Id))}");
        Console.WriteLine($"  Distinct()     : {string.Join(", ", Orders.Select(o => o.Region).Distinct())}");
        Console.WriteLine("  None of these have query-syntax keywords. A query expression that");
        Console.WriteLine("  needs one is wrapped in parentheses and a method call is appended.");

        Console.WriteLine();
        var mixed = (from o in Orders where o.Year == 2026 select o.Amount).Sum();
        Console.WriteLine($"  mixing the two : {mixed:0.00}");
    }
}
