// 06-queryable-vs-enumerable.cs — the second kind of deferral. IEnumerable<T>
// defers a chain of delegates; IQueryable<T> defers a data structure describing
// the query, which a provider translates. Losing the IQueryable type mid-chain
// silently changes where the work happens.
// AsQueryable over an array warns about trimming and AOT (IL2026/IL3050); that
// is true and irrelevant here, so it is suppressed rather than left to noise.
// .NET 10.0.400. Run: dotnet run 06-queryable-vs-enumerable.cs

#:property NoWarn=IL2026;IL3050

using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;

record Order(string Ref, string Region, decimal Amount);

class Program
{
    static readonly Order[] Data =
    {
        new("O-1", "eu", 120m), new("O-2", "us", 300m),
        new("O-3", "eu", 450m), new("O-4", "eu",  80m)
    };

    static void Main()
    {
        Console.WriteLine("--- the lambda becomes a DELEGATE for IEnumerable ---");
        IEnumerable<Order> asEnumerable = Data;
        var eq = asEnumerable.Where(o => o.Region == "eu");
        Console.WriteLine($"  runtime type : {eq.GetType().Name}");
        Console.WriteLine("  The predicate was compiled to a method and wrapped in a");
        Console.WriteLine("  Func<Order,bool>. Nothing can read it back; it can only be called.");

        Console.WriteLine();
        Console.WriteLine("--- and an EXPRESSION TREE for IQueryable ---");
        IQueryable<Order> asQueryable = Data.AsQueryable();
        var qq = asQueryable.Where(o => o.Region == "eu");
        Console.WriteLine($"  runtime type : {qq.GetType().Name}");
        Console.WriteLine($"  expression   : {qq.Expression}");
        Console.WriteLine("  The same source text became a data structure describing the");
        Console.WriteLine("  query. A provider can read it and emit SQL, or anything else.");

        Console.WriteLine();
        Console.WriteLine("--- the two overloads that make this happen ---");
        Expression<Func<Order, bool>> tree = o => o.Region == "eu";
        Func<Order, bool> del = o => o.Region == "eu";
        Console.WriteLine($"  Expression<Func<Order,bool>> : {tree.Body} (NodeType {tree.Body.NodeType})");
        Console.WriteLine($"  Func<Order,bool>             : {del.Method.Name} — a compiled method");
        Console.WriteLine("  Queryable.Where takes the first. Enumerable.Where takes the");
        Console.WriteLine("  second. Which one you get is decided by the STATIC type of the");
        Console.WriteLine("  source, not by anything visible in the query itself.");

        Console.WriteLine();
        Console.WriteLine("--- losing IQueryable mid-chain: the silent switch ---");
        var stillQueryable = asQueryable.Where(o => o.Region == "eu").Where(o => o.Amount > 100m);
        Console.WriteLine($"  both Where clauses in the tree : {stillQueryable.Expression}");

        IEnumerable<Order> dropped = asQueryable.Where(o => o.Region == "eu");
        var afterDrop = dropped.Where(o => o.Amount > 100m);
        Console.WriteLine($"  after the IEnumerable variable : {afterDrop.GetType().Name}");
        Console.WriteLine("  The second Where is now Enumerable.Where. Against a database");
        Console.WriteLine("  the first clause would run as SQL and the second would run in");
        Console.WriteLine("  memory over everything the first returned.");

        Console.WriteLine();
        Console.WriteLine("--- results are identical, which is the whole problem ---");
        Console.WriteLine($"  fully queryable : {string.Join(", ", stillQueryable.Select(o => o.Ref))}");
        Console.WriteLine($"  split chain     : {string.Join(", ", afterDrop.Select(o => o.Ref))}");
        Console.WriteLine("  Same rows. No warning, no exception, no difference in output.");

        Console.WriteLine();
        Console.WriteLine("--- what CANNOT be translated shows up as an exception, or worse ---");
        var withMethodCall = asQueryable.Where(o => Normalise(o.Region) == "EU");
        Console.WriteLine($"  expression : {withMethodCall.Expression}");
        Console.WriteLine("  The LINQ-to-Objects provider compiles this and runs it.");
        Console.WriteLine("  A SQL provider cannot translate Normalise and will either throw");
        Console.WriteLine("  or fetch every row and filter in memory, depending on version.");
        Console.WriteLine($"  it runs fine here : {string.Join(", ", withMethodCall.Select(o => o.Ref))}");
    }

    static string Normalise(string s) => s.ToUpperInvariant();
}
