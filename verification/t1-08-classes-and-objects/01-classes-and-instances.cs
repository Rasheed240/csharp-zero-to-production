// Demo 1 — one class, many objects. Each has its own state; the class itself
// holds only what is declared static.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("1. one blueprint, three independent objects");
Invoice a = new Invoice("INV-1", 100m);
Invoice b = new Invoice("INV-2", 250m);
Invoice c = new Invoice("INV-3", 75m);

a.AddLine(10m);
a.AddLine(15m);
b.AddLine(5m);

Console.WriteLine($"   a: {a}");
Console.WriteLine($"   b: {b}");
Console.WriteLine($"   c: {c}");
Console.WriteLine();

Console.WriteLine("2. static state belongs to the CLASS, not to any object");
Console.WriteLine($"   Invoice.Created = {Invoice.Created}   (three objects made it 3)");
Console.WriteLine();

Console.WriteLine("3. two objects with identical contents are still two objects");
Invoice d = new Invoice("INV-1", 100m);
Console.WriteLine($"   a.Reference == d.Reference : {a.Reference == d.Reference}");
Console.WriteLine($"   a == d                     : {a == d}");
Console.WriteLine($"   ReferenceEquals(a, d)      : {ReferenceEquals(a, d)}");
Console.WriteLine("   Reference types are compared by identity unless you say otherwise.");
Console.WriteLine();

Console.WriteLine("4. constructor chaining with this(...)");
Invoice defaulted = new Invoice("INV-4");
Console.WriteLine($"   new Invoice(\"INV-4\") -> {defaulted}");
Console.WriteLine();

Console.WriteLine("5. an object initialiser sets properties AFTER the constructor");
Invoice noted = new Invoice("INV-5", 30m) { Note = "urgent" };
Console.WriteLine($"   {noted}  note={noted.Note}");
Console.WriteLine();

Console.WriteLine("6. required members must be set, and the compiler enforces it");
Customer customer = new Customer { Name = "Acme Ltd", CountryCode = "GB" };
Console.WriteLine($"   {customer.Name} ({customer.CountryCode})");
Console.WriteLine("   Omitting either is CS9035 at compile time, not a run-time null.");
Console.WriteLine();

Console.WriteLine("7. calling a method on null");
Invoice? missing = null;
try
{
    Console.WriteLine(missing!.Reference);
}
catch (NullReferenceException ex)
{
    Console.WriteLine($"   {ex.GetType().Name}: {ex.Message}");
}

sealed class Invoice
{
    // Static: one copy for the whole class, shared by every object.
    private static int _created;

    // Instance fields: one copy per object.
    private readonly List<decimal> _lines = new List<decimal>();

    // The primary constructor other constructors chain to.
    public Invoice(string reference, decimal openingAmount)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reference);

        Reference = reference;
        OpeningAmount = openingAmount;
        _created++;
    }

    // Chains to the one above rather than duplicating its logic.
    public Invoice(string reference) : this(reference, 0m)
    {
    }

    public static int Created => _created;

    public string Reference { get; }
    public decimal OpeningAmount { get; }
    public string? Note { get; set; }

    public decimal Total
    {
        get
        {
            decimal total = OpeningAmount;
            foreach (decimal line in _lines)
            {
                total += line;
            }
            return total;
        }
    }

    public void AddLine(decimal amount) => _lines.Add(amount);

    public override string ToString() =>
        $"{Reference} total={Total.ToString("0.00", CultureInfo.InvariantCulture)} lines={_lines.Count}";
}

sealed class Customer
{
    public required string Name { get; init; }
    public required string CountryCode { get; init; }
}
