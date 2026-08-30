// 05-production.cs — a Ledger invoice lookup written the way a service should be:
// nullability expressed in the signatures, checked at the boundary, and never
// asserted with '!' where the compiler could have been told the truth instead.
// .NET 10.0.400. Run: dotnet run 05-production.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Linq;

namespace Ledger.Invoicing;

public readonly record struct Money(decimal Amount, string Currency)
{
    public override string ToString() =>
        Amount.ToString("N2", CultureInfo.InvariantCulture) + " " + Currency;
}

/// <summary>
/// Every property says what it means. Number and Amount are always present;
/// PurchaseOrder genuinely may be absent, and the type says so once, here,
/// instead of at every call site.
/// </summary>
public sealed class Invoice
{
    public required string Number { get; init; }
    public required string CustomerId { get; init; }
    public required Money Amount { get; init; }
    public string? PurchaseOrder { get; init; }
    public DateOnly? SettledOn { get; init; }
}

public interface IInvoiceStore
{
    /// <summary>Null means "no invoice with that number", which is not an error.</summary>
    Invoice? Find(string number);

    /// <summary>Throws when absent. Use where absence is a bug.</summary>
    Invoice Get(string number);

    bool TryFind(string number, [NotNullWhen(true)] out Invoice? invoice);
}

public sealed class InMemoryInvoiceStore : IInvoiceStore
{
    private readonly Dictionary<string, Invoice> _byNumber;

    public InMemoryInvoiceStore(IEnumerable<Invoice> invoices)
    {
        ArgumentNullException.ThrowIfNull(invoices);
        _byNumber = invoices.ToDictionary(i => i.Number, StringComparer.Ordinal);
    }

    public Invoice? Find(string number)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(number);
        return _byNumber.TryGetValue(number, out var invoice) ? invoice : null;
    }

    public Invoice Get(string number)
        => Find(number) ?? throw new KeyNotFoundException($"No invoice numbered '{number}'.");

    public bool TryFind(string number, [NotNullWhen(true)] out Invoice? invoice)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(number);
        return _byNumber.TryGetValue(number, out invoice);
    }
}

public sealed class InvoiceFormatter
{
    private readonly IInvoiceStore _store;

    public InvoiceFormatter(IInvoiceStore store)
    {
        ArgumentNullException.ThrowIfNull(store);
        _store = store;
    }

    /// <summary>The null flows through, and the signature says so.</summary>
    [return: NotNullIfNotNull(nameof(number))]
    public string? Describe(string? number)
    {
        if (number is null) return null;

        if (!_store.TryFind(number, out var invoice))
            return $"{number}: not found";

        // No '!' and no null check: [NotNullWhen(true)] proved invoice is not null.
        var po = invoice.PurchaseOrder is { Length: > 0 } p ? $" PO {p}" : "";
        var settled = invoice.SettledOn is { } d ? $" settled {d:yyyy-MM-dd}" : " unsettled";
        return $"{invoice.Number}: {invoice.Amount}{po}{settled}";
    }
}

class Program
{
    static void Main()
    {
        var store = new InMemoryInvoiceStore(new[]
        {
            new Invoice
            {
                Number = "INV-1", CustomerId = "CUST-1",
                Amount = new Money(1200m, "GBP"), PurchaseOrder = "PO-88",
                SettledOn = new DateOnly(2026, 8, 1)
            },
            new Invoice
            {
                Number = "INV-2", CustomerId = "CUST-2",
                Amount = new Money(340.50m, "EUR")
            }
        });

        var formatter = new InvoiceFormatter(store);

        Console.WriteLine("--- describing invoices ---");
        foreach (var number in new[] { "INV-1", "INV-2", "INV-404" })
            Console.WriteLine($"  {formatter.Describe(number)}");

        Console.WriteLine();
        Console.WriteLine("--- null in, null out, and the compiler knows ---");
        Console.WriteLine($"  Describe(null) : {formatter.Describe(null) ?? "(null)"}");
        var described = formatter.Describe("INV-1");
        // No warning on .Length: [NotNullIfNotNull] proved it from a non-null argument.
        Console.WriteLine($"  Describe(\"INV-1\").Length : {described.Length}");

        Console.WriteLine();
        Console.WriteLine("--- Find vs Get: absence as a value, or as an error ---");
        var maybe = store.Find("INV-404");
        Console.WriteLine($"  Find(\"INV-404\")  : {maybe?.Number ?? "(null)"}");
        try
        {
            store.Get("INV-404");
        }
        catch (KeyNotFoundException ex)
        {
            Console.WriteLine($"  Get(\"INV-404\")   : {ex.GetType().Name} — {ex.Message}");
        }
        Console.WriteLine("  Two methods, two beliefs about the data. Neither is a default.");

        Console.WriteLine();
        Console.WriteLine("--- 'required' makes the constructor-time hole a compile error ---");
        Console.WriteLine("  Omitting Number from an object initialiser is CS9035:");
        Console.WriteLine("    'Required member Invoice.Number must be set in the object");
        Console.WriteLine("    initializer or attribute constructor.'");
        Console.WriteLine("  That is an ERROR, not a warning — the only part of nullable");
        Console.WriteLine("  reference types that the compiler will refuse to build.");

        Console.WriteLine();
        Console.WriteLine("--- the boundary check is what actually protects the invariant ---");
        try
        {
            store.Find("   ");
        }
        catch (ArgumentException ex)
        {
            Console.WriteLine($"  Find(\"   \") : {ex.GetType().Name}, ParamName={ex.ParamName}");
        }
        try
        {
            _ = new InvoiceFormatter(null!);
        }
        catch (ArgumentNullException ex)
        {
            Console.WriteLine($"  new InvoiceFormatter(null!) : ArgumentNullException, ParamName={ex.ParamName}");
        }
        Console.WriteLine("  A caller compiled without nullable enabled, or one using '!',");
        Console.WriteLine("  gets a named exception here rather than a NullReferenceException");
        Console.WriteLine("  three frames deeper.");

        Console.WriteLine();
        Console.WriteLine("--- how many '!' operators are in this file? ---");
        Console.WriteLine("  Two, both in the demo code above, both deliberately passing");
        Console.WriteLine("  null to prove a guard fires. None in the production types.");
        Console.WriteLine("  That is the target: '!' appears in tests and at boundaries you");
        Console.WriteLine("  are deliberately violating, and nowhere else.");
    }
}
