// 03-production.cs — a reporting query written in both syntaxes, with the
// choice made on readability rather than habit.
// .NET 10.0.400. Run: dotnet run 03-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct Order(string Id, string CustomerId, string Region,
                                    decimal Amount, DateOnly Placed);
public readonly record struct Customer(string Id, string Name, string Tier);

class Program
{
    static readonly Customer[] Customers =
    {
        new("C-1", "Ada",   "gold"),
        new("C-2", "Grace", "silver"),
        new("C-3", "Linus", "gold"),
        new("C-4", "Edsger","bronze")
    };

    static readonly Order[] Orders =
    {
        new("O-1", "C-1", "eu", 120.00m, new(2026, 1, 15)),
        new("O-2", "C-2", "eu", 450.00m, new(2026, 2, 3)),
        new("O-3", "C-1", "us", 800.00m, new(2026, 2, 20)),
        new("O-4", "C-3", "eu",  95.00m, new(2026, 3, 1)),
        new("O-5", "C-1", "eu", 300.00m, new(2026, 3, 12)),
        new("O-6", "C-2", "us", 950.00m, new(2026, 3, 28)),
        new("O-7", "C-4", "eu",  20.00m, new(2026, 4, 2))
    };

    static void Main()
    {
        Console.WriteLine("--- a multi-source report: query syntax reads better ---");
        var report =
            from o in Orders
            join c in Customers on o.CustomerId equals c.Id
            where o.Amount >= 100m && c.Tier != "bronze"
            let withVat = o.Amount * 1.20m
            group new { c.Name, withVat } by c.Name into byCustomer
            let total = byCustomer.Sum(x => x.withVat)
            orderby total descending
            select new { Customer = byCustomer.Key, Orders = byCustomer.Count(), Total = total };

        foreach (var row in report)
            Console.WriteLine($"  {row.Customer,-8} orders={row.Orders} total={row.Total:0.00}");

        Console.WriteLine();
        Console.WriteLine("--- the same thing in method syntax ---");
        var reportMethods = Orders
            .Join(Customers, o => o.CustomerId, c => c.Id, (o, c) => new { o, c })
            .Where(x => x.o.Amount >= 100m && x.c.Tier != "bronze")
            .Select(x => new { x.c.Name, withVat = x.o.Amount * 1.20m })
            .GroupBy(x => x.Name)
            .Select(g => new { Customer = g.Key, Orders = g.Count(), Total = g.Sum(x => x.withVat) })
            .OrderByDescending(x => x.Total);

        foreach (var row in reportMethods)
            Console.WriteLine($"  {row.Customer,-8} orders={row.Orders} total={row.Total:0.00}");

        Console.WriteLine();
        Console.WriteLine($"  identical: {report.SequenceEqual(reportMethods)}");
        Console.WriteLine("  The join and the two 'let' bindings are what make query syntax");
        Console.WriteLine("  clearer here: the method version needs anonymous types to carry");
        Console.WriteLine("  values forward, which the compiler writes for you in the first.");

        Console.WriteLine();
        Console.WriteLine("--- a single-operation query: method syntax reads better ---");
        Console.WriteLine($"  total for March : " +
            $"{Orders.Where(o => o.Placed.Month == 3).Sum(o => o.Amount):0.00}");
        Console.WriteLine($"  as a query      : " +
            $"{(from o in Orders where o.Placed.Month == 3 select o.Amount).Sum():0.00}");
        Console.WriteLine("  The query form needs parentheses and a trailing method call, which");
        Console.WriteLine("  is a signal that the expression wanted to be method syntax.");

        Console.WriteLine();
        Console.WriteLine("--- grouping with a composite key ---");
        var byRegionMonth =
            from o in Orders
            group o by new { o.Region, o.Placed.Month } into g
            orderby g.Key.Region, g.Key.Month
            select $"{g.Key.Region}/{g.Key.Month}: {g.Sum(x => x.Amount):0}";
        Console.WriteLine($"  {string.Join(" | ", byRegionMonth)}");
        Console.WriteLine("  An anonymous type as a key works because records and anonymous");
        Console.WriteLine("  types have value equality — the rule from the equality module.");
    }
}
