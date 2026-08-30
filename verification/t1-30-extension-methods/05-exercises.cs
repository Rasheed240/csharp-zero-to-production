// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 05-exercises.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1: which method runs? =====");
        var a = new Thing();
        Console.WriteLine($"  thing.Show()        : {a.Show()}");
        Console.WriteLine($"  thing.Show(1)       : {a.Show(1)}");
        Console.WriteLine($"  ThingExt.Show(a)    : {ThingExt.Show(a)}");
        string? nothing = null;
        Console.WriteLine($"  null.SafeLength()   : {nothing.SafeLength()}");
        try
        {
            Console.WriteLine(nothing!.UnsafeLength());
        }
        catch (NullReferenceException)
        {
            Console.WriteLine("  null.UnsafeLength() : NullReferenceException from the BODY");
        }

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: static type, not runtime type =====");
        Base asBase = new Derived();
        Derived asDerived = (Derived)asBase;
        Console.WriteLine($"  declared Base    : {asBase.Name()}");
        Console.WriteLine($"  declared Derived : {asDerived.Name()}");
        Console.WriteLine($"  same object      : {ReferenceEquals(asBase, asDerived)}");
        Console.WriteLine($"  runtime type     : {asBase.GetType().Name}");
        Console.WriteLine("  Compare a VIRTUAL method on the same objects:");
        Console.WriteLine($"    declared Base    : {asBase.Virtual()}");
        Console.WriteLine($"    declared Derived : {asDerived.Virtual()}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: write a null-safe chain helper =====");
        var invoices = new List<Invoice?>
        {
            new Invoice("INV-1", 120m),
            null,
            new Invoice("INV-3", 300m)
        };
        Console.WriteLine($"  total of non-null : {invoices.SumOf(i => i.Amount)}");
        Console.WriteLine($"  on a null list    : {((List<Invoice?>?)null).SumOf(i => i.Amount)}");
        Console.WriteLine($"  on an empty list  : {new List<Invoice?>().SumOf(i => i.Amount)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: which of these should be extensions? =====");
        var invoice = new Invoice("INV-9", 500m);
        Console.WriteLine($"  (a) invoice.IsLarge()          : {invoice.IsLarge()}");
        Console.WriteLine($"  (b) invoices.WithAmountOver(200): " +
                          $"{invoices.OfType<Invoice>().WithAmountOver(200m).Count()}");
        Console.WriteLine($"  (c) \"  x \".Collapse()          : '{"  x ".Collapse()}'");
        Console.WriteLine($"  (d) Invoice.Empty (C# 14 static): {Invoice.Empty}");
        Console.WriteLine();
        Console.WriteLine("  (a) NO  — Invoice is ours; make it a property.");
        Console.WriteLine("  (b) YES — extends IEnumerable<T>, which we do not own.");
        Console.WriteLine("  (c) YES — extends string, which we cannot change.");
        Console.WriteLine("  (d) MAYBE — a static factory on our own type is better as a");
        Console.WriteLine("      real static member; the extension form exists for types");
        Console.WriteLine("      we do not own.");

        Console.WriteLine();
        Console.WriteLine("  and the shadowing risk for (a), demonstrated:");
        Console.WriteLine($"    before Invoice had IsLarge()  : {BadExt.IsLarge(invoice)}");
        Console.WriteLine($"    a version where it does       : {new InvoiceV2("INV-9", 500m).IsLarge()}");
        Console.WriteLine("    Same call syntax, different method, no diagnostic.");
    }
}

class Thing
{
    public string Show() => "[instance, no args]";
    public string Show(int n) => $"[instance, int {n}]";
}

static class ThingExt
{
    public static string Show(this Thing t) => "[extension, no args]";
    public static string Show(this Thing t, string s) => $"[extension, string {s}]";
}

class Base { public virtual string Virtual() => "[virtual: Base]"; }
class Derived : Base { public override string Virtual() => "[virtual: Derived]"; }

record Invoice(string Number, decimal Amount);
record InvoiceV2(string Number, decimal Amount)
{
    public bool IsLarge() => Amount > 1000m;    // a later release added this
}

static class Extensions
{
    public static int SafeLength(this string? s) => s?.Length ?? 0;
    public static int UnsafeLength(this string s) => s.Length;

    public static string Name(this Base b) => "[extension: Base]";
    public static string Name(this Derived d) => "[extension: Derived]";

    public static decimal SumOf<T>(this IEnumerable<T?>? source, Func<T, decimal> selector)
        where T : class
        => source is null ? 0m : source.OfType<T>().Sum(selector);

    public static IEnumerable<Invoice> WithAmountOver(this IEnumerable<Invoice> source, decimal min)
        => source.Where(i => i.Amount > min);

    public static string Collapse(this string s)
        => string.Join(" ", s.Split(' ', StringSplitOptions.RemoveEmptyEntries));

    extension(Invoice)
    {
        public static Invoice Empty => new("", 0m);
    }
}

static class BadExt
{
    public static bool IsLarge(this Invoice i) => i.Amount > 100m;
    public static bool IsLarge(this InvoiceV2 i) => i.Amount > 100m;
}
