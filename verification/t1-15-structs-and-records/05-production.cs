// 05-production.cs — records and structs used for what each is good at, in one
// small domain.
// .NET 10.0.400. Run: dotnet run 05-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

// A small, immutable value with meaningful equality: readonly record struct.
// 16 bytes, never allocated on the heap, compared by value.
public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money Zero(string currency) => new(0m, currency);

    public Money Add(Money other) => other.Currency == Currency
        ? this with { Amount = Amount + other.Amount }
        : throw new InvalidOperationException($"cannot add {other.Currency} to {Currency}");

    public override string ToString() => $"{Amount:0.00} {Currency}";
}

public readonly record struct Sku(string Value)
{
    // Validation on a positional record goes in the property initialiser.
    // There is no 'primary constructor body' syntax for records.
    public string Value { get; } = string.IsNullOrWhiteSpace(Value)
        ? throw new ArgumentException("SKU is required.", nameof(Value))
        : Value;
}

// A larger immutable value: record class. Reference type, but value equality
// and a 'with' expression for updates.
public sealed record OrderLine(Sku Sku, int Quantity, Money UnitPrice)
{
    public Money LineTotal => UnitPrice with { Amount = UnitPrice.Amount * Quantity };
}

// A record holding a collection needs its own equality, as demonstrated in
// 02-equality-traps.cs. This one is sealed, so Equals need not be virtual.
public sealed record Order(string Id, IReadOnlyList<OrderLine> Lines)
{
    public Money Total => Lines.Count == 0
        ? Money.Zero("GBP")
        : Lines.Select(l => l.LineTotal).Aggregate((a, b) => a.Add(b));

    public bool Equals(Order? other) =>
        other is not null && Id == other.Id && Lines.SequenceEqual(other.Lines);

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(Id);
        foreach (var line in Lines) hash.Add(line);
        return hash.ToHashCode();
    }

    public Order WithLine(OrderLine line) =>
        this with { Lines = Lines.Append(line).ToArray() };
}

class Program
{
    static void Main()
    {
        var order = new Order("O-1", new[]
        {
            new OrderLine(new Sku("WIDGET-1"), 3, new Money(9.99m, "GBP")),
            new OrderLine(new Sku("GIZMO-2"), 1, new Money(24.50m, "GBP"))
        });

        Console.WriteLine($"order {order.Id}, total {order.Total}");
        foreach (var l in order.Lines)
            Console.WriteLine($"  {l.Sku.Value,-10} x{l.Quantity} @ {l.UnitPrice} = {l.LineTotal}");

        Console.WriteLine();
        Console.WriteLine("--- value equality, including the collection ---");
        var same = new Order("O-1", new[]
        {
            new OrderLine(new Sku("WIDGET-1"), 3, new Money(9.99m, "GBP")),
            new OrderLine(new Sku("GIZMO-2"), 1, new Money(24.50m, "GBP"))
        });
        Console.WriteLine($"  order == same          : {order == same}");
        Console.WriteLine($"  hash codes match       : {order.GetHashCode() == same.GetHashCode()}");
        Console.WriteLine("  (only because Order supplies its own Equals and GetHashCode)");

        Console.WriteLine();
        Console.WriteLine("--- 'with' produces a new order, leaving the original alone ---");
        var bigger = order.WithLine(new OrderLine(new Sku("BOLT-3"), 10, new Money(0.45m, "GBP")));
        Console.WriteLine($"  original: {order.Lines.Count} lines, {order.Total}");
        Console.WriteLine($"  bigger  : {bigger.Lines.Count} lines, {bigger.Total}");
        Console.WriteLine($"  original unchanged? {order.Lines.Count == 2}");
        Console.WriteLine("  WithLine copies the array rather than appending in place, so the");
        Console.WriteLine("  shallow-copy trap from 02-equality-traps.cs does not apply here.");

        Console.WriteLine();
        Console.WriteLine("--- validation in a positional record struct ---");
        try
        {
            _ = new Sku("  ");
        }
        catch (ArgumentException ex)
        {
            Console.WriteLine($"  new Sku(\"  \") -> {ex.GetType().Name}: {ex.Message.Split('(')[0].Trim()}");
        }
        Console.WriteLine($"  but default(Sku) bypasses it entirely: Value = " +
                          $"{(default(Sku).Value is null ? "null" : "\"" + default(Sku).Value + "\"")}");
        Console.WriteLine("  Every struct has a zero value that no constructor produced.");

        Console.WriteLine();
        Console.WriteLine("--- currency mismatch is caught ---");
        try
        {
            _ = new Money(1m, "GBP").Add(new Money(1m, "USD"));
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  {ex.Message}");
        }
    }
}
