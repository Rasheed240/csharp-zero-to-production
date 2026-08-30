// 01-invariants.cs — what encapsulation actually buys: an object that cannot
// be put into a state its own rules forbid.
// .NET 10.0.400. Run: dotnet run 01-invariants.cs

using System;

// ---- Version A: public fields. No rules can be enforced. -------------------
class OpenBasketLine
{
    public string Sku = "";
    public int Quantity;
    public decimal UnitPrice;

    public decimal Total => Quantity * UnitPrice;
}

// ---- Version B: the same data, with the rules attached to it. --------------
class ClosedBasketLine
{
    private int _quantity;

    public string Sku { get; }
    public decimal UnitPrice { get; }

    public int Quantity
    {
        get => _quantity;
        set
        {
            if (value < 1)
                throw new ArgumentOutOfRangeException(
                    nameof(value), value, "Quantity must be at least 1.");
            if (value > 999)
                throw new ArgumentOutOfRangeException(
                    nameof(value), value, "Quantity must be 999 or fewer.");
            _quantity = value;
        }
    }

    public ClosedBasketLine(string sku, int quantity, decimal unitPrice)
    {
        if (string.IsNullOrWhiteSpace(sku))
            throw new ArgumentException("SKU is required.", nameof(sku));
        if (unitPrice < 0m)
            throw new ArgumentOutOfRangeException(
                nameof(unitPrice), unitPrice, "Unit price cannot be negative.");

        Sku = sku;
        UnitPrice = unitPrice;
        Quantity = quantity;   // goes through the setter, so it is checked too
    }

    public decimal Total => _quantity * UnitPrice;
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- open version: every rule is optional ---");
        var open = new OpenBasketLine { Sku = "WIDGET-1", Quantity = -3, UnitPrice = 9.99m };
        Console.WriteLine($"quantity {open.Quantity}, total {open.Total}");

        open.Quantity = 0;
        open.UnitPrice = -100m;
        Console.WriteLine($"quantity {open.Quantity}, total {open.Total}");

        Console.WriteLine();
        Console.WriteLine("--- closed version: the rules travel with the data ---");
        var closed = new ClosedBasketLine("WIDGET-1", 3, 9.99m);
        Console.WriteLine($"quantity {closed.Quantity}, total {closed.Total}");

        try
        {
            closed.Quantity = -3;
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"rejected: {ex.GetType().Name}: {ex.Message.Split('(')[0].Trim()}");
        }

        try
        {
            var bad = new ClosedBasketLine("WIDGET-1", 3, -100m);
            Console.WriteLine($"constructed: {bad.Total}");
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"rejected at construction: {ex.ParamName}");
        }

        Console.WriteLine($"still valid: quantity {closed.Quantity}, total {closed.Total}");
    }
}
