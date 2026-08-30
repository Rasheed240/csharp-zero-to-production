// Compile-error probe. This file is EXPECTED NOT TO COMPILE.
// Its purpose is to produce the exact diagnostics quoted in the lesson.

Customer partial = new Customer { Name = "Acme" };   // CountryCode not set
Invoice noArgs = new Invoice();                      // no parameterless constructor
Invoice built = new Invoice("INV-1");
built.Reference = "INV-2";                           // get-only property
Settings.Timeout = TimeSpan.Zero;                    // static get-only property

sealed class Customer
{
    public required string Name { get; init; }
    public required string CountryCode { get; init; }
}

sealed class Invoice
{
    public Invoice(string reference)
    {
        Reference = reference;
        _total = 0m;
    }

    public string Reference { get; }

    private readonly decimal _total;

    public void Recalculate()
    {
        _total = 1m;                                  // readonly outside a constructor
    }
}

static class Settings
{
    public static TimeSpan Timeout { get; } = TimeSpan.FromSeconds(30);
}
