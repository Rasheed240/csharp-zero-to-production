// Demo 4 — Ledger: choosing struct or class for real domain types.

Money subtotal = new Money(120.00m, "GBP");
Money vat = subtotal * 0.20m;
Money total = subtotal + vat;

Console.WriteLine($"subtotal = {subtotal}");
Console.WriteLine($"vat      = {vat}");
Console.WriteLine($"total    = {total}");
Console.WriteLine();

// Value equality: two separately-created Money values are the same value.
Money a = new Money(144.00m, "GBP");
Money b = new Money(144.00m, "GBP");
Console.WriteLine($"a == b                  -> {a == b}");
Console.WriteLine($"ReferenceEquals is N/A  -> Money is a value type, there is no reference");
Console.WriteLine();

// Reference identity: two invoices with identical contents are still two invoices.
Invoice one = new Invoice("INV-1001", "CUST-7");
Invoice two = new Invoice("INV-1001", "CUST-7");
Console.WriteLine($"one == two              -> {one == two}");
Console.WriteLine($"ReferenceEquals(one,two)-> {ReferenceEquals(one, two)}");
Console.WriteLine();

one.AddLine("Consulting, March", new Money(120.00m, "GBP"));
one.AddLine("Hosting, March", new Money(24.00m, "GBP"));

// The names alias and one refer to the SAME invoice on the heap.
Invoice alias = one;
alias.AddLine("Support retainer", new Money(50.00m, "GBP"));

Console.WriteLine($"one.Lines.Count         -> {one.Lines.Count}");
Console.WriteLine($"one.Total               -> {one.Total}");
Console.WriteLine();

try
{
    Money mixed = new Money(10m, "GBP") + new Money(10m, "USD");
    Console.WriteLine(mixed);
}
catch (InvalidOperationException ex)
{
    Console.WriteLine($"mixing currencies       -> {ex.Message}");
}

/// <summary>An amount in a single currency. Immutable, compared by value.</summary>
public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money Zero(string currency) => new Money(0m, currency);

    public static Money operator +(Money left, Money right)
    {
        Require(left, right);
        return new Money(left.Amount + right.Amount, left.Currency);
    }

    public static Money operator -(Money left, Money right)
    {
        Require(left, right);
        return new Money(left.Amount - right.Amount, left.Currency);
    }

    public static Money operator *(Money value, decimal factor) =>
        new Money(decimal.Round(value.Amount * factor, 2, MidpointRounding.ToEven), value.Currency);

    private static void Require(Money left, Money right)
    {
        if (!string.Equals(left.Currency, right.Currency, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Cannot combine {left.Currency} with {right.Currency}.");
        }
    }

    public override string ToString() => $"{Amount:0.00} {Currency}";
}

/// <summary>A specific invoice. Has identity and changes over its lifetime.</summary>
public sealed class Invoice
{
    private readonly List<InvoiceLine> _lines = new List<InvoiceLine>();

    public Invoice(string number, string customerId)
    {
        Number = number;
        CustomerId = customerId;
    }

    public string Number { get; }
    public string CustomerId { get; }
    public IReadOnlyList<InvoiceLine> Lines => _lines;

    public Money Total
    {
        get
        {
            Money running = Money.Zero("GBP");
            foreach (InvoiceLine line in _lines)
            {
                running += line.Amount;
            }
            return running;
        }
    }

    public void AddLine(string description, Money amount) =>
        _lines.Add(new InvoiceLine(description, amount));
}

public readonly record struct InvoiceLine(string Description, Money Amount);
