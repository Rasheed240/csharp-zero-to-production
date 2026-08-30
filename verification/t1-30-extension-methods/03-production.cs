// 03-production.cs — extension methods that earn their place in Ledger, and the
// two shapes that do not. The distinction is testable, not stylistic.
// .NET 10.0.400. Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;

namespace Ledger.Invoicing;

public readonly record struct Money(decimal Amount, string Currency)
{
    public override string ToString() =>
        Amount.ToString("N2", CultureInfo.InvariantCulture) + " " + Currency;
}

public sealed record Invoice(string Number, string CustomerId, Money Amount, DateOnly Issued,
                             DateOnly? SettledOn);

/// <summary>
/// GOOD: extends an interface we do not own, with an operation that belongs to
/// the caller's domain rather than to IEnumerable. One implementation covers
/// every sequence type, present and future.
/// </summary>
public static class InvoiceQueries
{
    public static IEnumerable<Invoice> Outstanding(this IEnumerable<Invoice> invoices)
        => invoices.Where(i => i.SettledOn is null);

    public static IEnumerable<Invoice> OverdueOn(this IEnumerable<Invoice> invoices,
                                                DateOnly asOf, int termDays = 30)
        => invoices.Outstanding().Where(i => i.Issued.AddDays(termDays) < asOf);

    public static Money TotalIn(this IEnumerable<Invoice> invoices, string currency)
    {
        ArgumentNullException.ThrowIfNull(invoices);
        var total = invoices.Where(i => i.Amount.Currency == currency).Sum(i => i.Amount.Amount);
        return new Money(total, currency);
    }
}

/// <summary>
/// GOOD: a C# 14 extension block adding a static factory and a property to a
/// type declared elsewhere. Neither was expressible with the 'this' syntax.
/// </summary>
public static class MoneyExtensions
{
    extension(Money money)
    {
        public bool IsZero => money.Amount == 0m;
        public Money Negated => money with { Amount = -money.Amount };
    }

    extension(Money)
    {
        public static Money ZeroGbp => new(0m, "GBP");
        public static Money Parse(string text)
        {
            var parts = text.Split(' ');
            return new Money(decimal.Parse(parts[0], CultureInfo.InvariantCulture), parts[1]);
        }
    }
}

/// <summary>
/// BAD: this belongs on Invoice. It uses only the type's own data, the type is
/// ours to change, and putting it here means callers must find the right using.
/// </summary>
public static class BadExtensions
{
    public static bool IsSettled(this Invoice invoice) => invoice.SettledOn is not null;
}

class Program
{
    static void Main()
    {
        var asOf = new DateOnly(2026, 8, 30);
        var invoices = new[]
        {
            new Invoice("INV-1", "CUST-1", new Money(1200m, "GBP"), new DateOnly(2026, 6, 1), null),
            new Invoice("INV-2", "CUST-1", new Money(300m, "GBP"), new DateOnly(2026, 8, 20), null),
            new Invoice("INV-3", "CUST-2", new Money(450m, "EUR"), new DateOnly(2026, 5, 1), null),
            new Invoice("INV-4", "CUST-2", new Money(90m, "GBP"), new DateOnly(2026, 7, 1),
                        new DateOnly(2026, 7, 15))
        };

        Console.WriteLine("--- extensions composing with LINQ, because they return sequences ---");
        var overdue = invoices.OverdueOn(asOf).OrderBy(i => i.Issued).ToList();
        foreach (var i in overdue)
            Console.WriteLine($"  {i.Number} {i.Amount} issued {i.Issued:yyyy-MM-dd}");
        Console.WriteLine($"  outstanding GBP total : {invoices.Outstanding().TotalIn("GBP")}");
        Console.WriteLine("  OverdueOn calls Outstanding, which is itself an extension.");
        Console.WriteLine("  They chain because each returns IEnumerable<Invoice> — the same");
        Console.WriteLine("  reason LINQ operators chain.");

        Console.WriteLine();
        Console.WriteLine("--- they work on any sequence, including one that does not exist yet ---");
        IEnumerable<Invoice> asQuery = invoices.Where(i => i.CustomerId == "CUST-1");
        var asList = invoices.ToList();
        var asHashSet = invoices.ToHashSet();
        Console.WriteLine($"  from a LINQ query : {asQuery.Outstanding().Count()}");
        Console.WriteLine($"  from a List       : {asList.Outstanding().Count()}");
        Console.WriteLine($"  from a HashSet    : {asHashSet.Outstanding().Count()}");
        Console.WriteLine("  One implementation. Adding a new collection type to the");
        Console.WriteLine("  codebase requires no change here.");

        Console.WriteLine();
        Console.WriteLine("--- C# 14 extension members on a type declared elsewhere ---");
        var amount = new Money(75m, "GBP");
        Console.WriteLine($"  amount             : {amount}");
        Console.WriteLine($"  amount.IsZero      : {amount.IsZero}");
        Console.WriteLine($"  amount.Negated     : {amount.Negated}");
        Console.WriteLine($"  Money.ZeroGbp      : {Money.ZeroGbp}");
        Console.WriteLine($"  Money.Parse(\"12.50 EUR\") : {Money.Parse("12.50 EUR")}");
        Console.WriteLine("  A static member and two properties, on a record we could have");
        Console.WriteLine("  edited — which is the case where this is a design choice rather");
        Console.WriteLine("  than the only option.");

        Console.WriteLine();
        Console.WriteLine("--- the shape that should NOT be an extension ---");
        Console.WriteLine($"  invoices[3].IsSettled() : {invoices[3].IsSettled()}");
        Console.WriteLine("  IsSettled reads only Invoice's own data, and Invoice is ours.");
        Console.WriteLine("  As an extension it is:");
        Console.WriteLine("    - invisible unless the caller imports Ledger.Invoicing");
        Console.WriteLine("    - absent from IntelliSense on Invoice in any other namespace");
        Console.WriteLine("    - unable to be virtual, overridden, or part of an interface");
        Console.WriteLine("    - silently shadowed the day someone adds Invoice.IsSettled()");
        Console.WriteLine("  As a property on the record it is one line and none of that.");

        Console.WriteLine();
        Console.WriteLine("--- shadowing, demonstrated ---");
        var shadowed = new Shadowed();
        Console.WriteLine($"  before an instance method existed : {ShadowDemo.Label(shadowed)}");
        Console.WriteLine($"  now that one does                 : {shadowed.Label()}");
        Console.WriteLine("  Adding Label() to the class silently changed every call site.");
        Console.WriteLine("  No error, no warning, and the extension is still compiled in.");

        Console.WriteLine();
        Console.WriteLine("--- cost: is an extension call slower than an instance call? ---");
        var settled = invoices[3];
        var viaExtension = Time(() => { _sink += settled.IsSettled() ? 1 : 0; });
        var viaProperty = Time(() => { _sink += settled.SettledOn is not null ? 1 : 0; });
        Console.WriteLine($"  extension method : {viaExtension:0.00} ns/op");
        Console.WriteLine($"  direct property  : {viaProperty:0.00} ns/op");
        Console.WriteLine("  A couple of nanoseconds, and both are dominated by the");
        Console.WriteLine("  delegate call this harness uses to measure them. There is no");
        Console.WriteLine("  DISPATCH cost — an extension is a static call, so there is no");
        Console.WriteLine("  virtual lookup — but it is a call, and the extra argument and");
        Console.WriteLine("  the extra frame are not literally free.");
        Console.WriteLine("  Nothing here is a reason to choose one over the other.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static long _sink;

    static double Time(Action a)
    {
        for (var i = 0; i < 10_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < 1_000_000; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / 1_000_000;   // ms -> ns/op
    }
}

public class Shadowed
{
    // Added in a later release. Every extension call site silently moved here.
    public string Label() => "[instance]";
}

public static class ShadowDemo
{
    public static string Label(this Shadowed s) => "[extension]";
}
