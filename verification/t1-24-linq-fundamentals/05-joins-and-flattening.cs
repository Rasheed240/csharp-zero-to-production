// 05-joins-and-flattening.cs — the three clauses that have no simple method-syntax
// shorthand: multiple `from` (SelectMany), `join ... into` (group join), and the
// left-outer-join idiom built from a group join plus DefaultIfEmpty.
// .NET 10.0.400. Run: dotnet run 05-joins-and-flattening.cs

using System;
using System.Collections.Generic;
using System.Linq;

record Customer(int Id, string Name);
record Order(string Ref, int CustomerId, decimal Amount);

class Program
{
    static readonly Customer[] Customers =
    {
        new(1, "Ada"), new(2, "Grace"), new(3, "Linus")   // Linus has no orders
    };

    static readonly Order[] Orders =
    {
        new("O-1", 1, 120m), new("O-2", 1, 300m),
        new("O-3", 2, 450m), new("O-4", 9,  80m)          // customer 9 does not exist
    };

    static void Main()
    {
        Console.WriteLine("--- multiple `from` clauses flatten: this is SelectMany ---");

        var pairsQuery = from c in Customers
                         from o in Orders
                         where o.CustomerId == c.Id
                         select $"{c.Name}/{o.Ref}";

        var pairsMethod = Customers
            .SelectMany(c => Orders, (c, o) => new { c, o })
            .Where(x => x.o.CustomerId == x.c.Id)
            .Select(x => $"{x.c.Name}/{x.o.Ref}");

        Console.WriteLine($"  query  : {string.Join(", ", pairsQuery)}");
        Console.WriteLine($"  method : {string.Join(", ", pairsMethod)}");
        Console.WriteLine($"  equal  : {pairsQuery.SequenceEqual(pairsMethod)}");
        Console.WriteLine("  Two `from` clauses produce every pair, then Where discards");
        Console.WriteLine("  the ones that do not match. That is a cross join filtered");
        Console.WriteLine($"  after the fact: {Customers.Length} x {Orders.Length} = " +
                          $"{Customers.Length * Orders.Length} pairs considered.");

        var joinPairs = from c in Customers
                        join o in Orders on c.Id equals o.CustomerId
                        select $"{c.Name}/{o.Ref}";
        Console.WriteLine($"  join   : {string.Join(", ", joinPairs)}");
        Console.WriteLine("  `join` produces the same rows by building a lookup on the");
        Console.WriteLine("  key first, so it does not consider every pair.");

        Console.WriteLine();
        Console.WriteLine("--- `into` continues a query with a new range variable ---");

        var totals = from o in Orders
                     group o by o.CustomerId into g
                     where g.Count() > 1
                     select $"customer {g.Key}: {g.Count()} orders, {g.Sum(x => x.Amount):0.00}";
        Console.WriteLine($"  group..into : {string.Join(" | ", totals)}");
        Console.WriteLine("  Without `into`, `group by` must end the query. `into g`");
        Console.WriteLine("  makes g the new range variable so more clauses can follow.");

        Console.WriteLine();
        Console.WriteLine("--- `join ... into` is a GROUP join, not the same as `join` ---");

        var grouped = from c in Customers
                      join o in Orders on c.Id equals o.CustomerId into cOrders
                      select $"{c.Name}={cOrders.Count()}";
        Console.WriteLine($"  group join : {string.Join(", ", grouped)}");
        Console.WriteLine("  Every customer appears exactly once, with a (possibly empty)");
        Console.WriteLine("  sequence of matches. Linus is present with 0.");

        var inner = from c in Customers
                    join o in Orders on c.Id equals o.CustomerId
                    select c.Name;
        Console.WriteLine($"  plain join : {string.Join(", ", inner)}");
        Console.WriteLine("  Linus is absent entirely, and Ada appears twice: one row");
        Console.WriteLine("  per match. That is the difference the `into` makes.");

        Console.WriteLine();
        Console.WriteLine("--- left outer join = group join + DefaultIfEmpty ---");

        var leftOuter = from c in Customers
                        join o in Orders on c.Id equals o.CustomerId into cOrders
                        from o in cOrders.DefaultIfEmpty()
                        select $"{c.Name}/{o?.Ref ?? "(none)"}";
        Console.WriteLine($"  left outer : {string.Join(", ", leftOuter)}");
        Console.WriteLine("  DefaultIfEmpty yields default(T) for an empty group, so a");
        Console.WriteLine("  customer with no orders still produces one row — and o is");
        Console.WriteLine("  null there, which is why the projection must handle it.");

        Console.WriteLine();
        Console.WriteLine("--- what neither join finds ---");
        var orphan = Orders.Where(o => !Customers.Any(c => c.Id == o.CustomerId));
        Console.WriteLine($"  orders with no customer : {string.Join(", ", orphan.Select(o => o.Ref))}");
        Console.WriteLine("  A left join keyed on the customer side cannot show these.");
        Console.WriteLine("  Neither can an inner join. Rows dropped by a join are");
        Console.WriteLine("  invisible unless you look for them deliberately.");
    }
}
