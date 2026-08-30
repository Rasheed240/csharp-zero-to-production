// Demo 3 — calling an overridable method from a constructor runs the derived
// version BEFORE the derived object has finished being built.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("The broken version:");
try
{
    BrokenAuditedInvoice broken = new BrokenAuditedInvoice("INV-1", 144.00m);
    Console.WriteLine($"  built: {broken}");
}
catch (NullReferenceException)
{
    Console.WriteLine("  threw NullReferenceException from inside the constructor");
}
Console.WriteLine();

Console.WriteLine("Why: the base constructor calls an overridden method, and the");
Console.WriteLine("derived field it depends on has not been assigned yet.");
Console.WriteLine();

Console.WriteLine("The fixed version (no overridable call during construction):");
FixedAuditedInvoice good = new FixedAuditedInvoice("INV-1", 144.00m);
Console.WriteLine($"  built: {good}");
Console.WriteLine($"  audit: {good.Describe()}");

// ---------------------------------------------------------------------------

abstract class BrokenInvoiceBase
{
    protected BrokenInvoiceBase(string reference)
    {
        Reference = reference;

        // DANGEROUS: this runs the DERIVED override, before the derived
        // constructor body and before its fields are assigned.
        Console.WriteLine("  base constructor is about to call Describe()");
        Description = Describe();
    }

    public string Reference { get; }
    public string Description { get; }

    protected abstract string Describe();

    public override string ToString() => $"{Reference} [{Description}]";
}

sealed class BrokenAuditedInvoice : BrokenInvoiceBase
{
    private readonly string _auditTag;

    public BrokenAuditedInvoice(string reference, decimal amount)
        : base(reference)
    {
        // Far too late: base(reference) has already called Describe().
        _auditTag = $"audited-{amount}";
    }

    // Called while _auditTag is still null.
    protected override string Describe() => _auditTag.ToUpperInvariant();
}

// ---------------------------------------------------------------------------

abstract class FixedInvoiceBase
{
    protected FixedInvoiceBase(string reference)
    {
        Reference = reference;
        // No overridable call here. The object is simply built.
    }

    public string Reference { get; }

    // Called on demand, after construction is complete.
    public abstract string Describe();

    public override string ToString() => Reference;
}

sealed class FixedAuditedInvoice : FixedInvoiceBase
{
    private readonly string _auditTag;

    public FixedAuditedInvoice(string reference, decimal amount)
        : base(reference)
    {
        _auditTag = $"audited-{amount}";
    }

    public override string Describe() => _auditTag.ToUpperInvariant();
}
