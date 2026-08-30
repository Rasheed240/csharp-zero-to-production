// 09-production-order.cs — the same ideas applied to one realistic type.
// Every rule this class states is enforced rather than documented.
// .NET 10.0.400. Run: dotnet run 09-production-order.cs

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

public enum OrderStatus { Draft, Placed, Dispatched, Cancelled }

public sealed class OrderLine
{
    public string Sku { get; }
    public int Quantity { get; }
    public decimal UnitPrice { get; }
    public decimal LineTotal { get; }

    internal OrderLine(string sku, int quantity, decimal unitPrice)
    {
        Sku = sku;
        Quantity = quantity;
        UnitPrice = unitPrice;
        LineTotal = quantity * unitPrice;
    }
}

public sealed class Order
{
    // The storage. Nothing outside this class can reach either one.
    private readonly List<OrderLine> _lines = new();
    private readonly ReadOnlyCollection<OrderLine> _linesView;

    public Guid Id { get; }
    public OrderStatus Status { get; private set; } = OrderStatus.Draft;
    public DateOnly? DispatchedOn { get; private set; }

    // Stored, not computed: reading it cannot fail and cannot be slow.
    public decimal Total { get; private set; }

    // Built once in the constructor, so returning it allocates nothing.
    public IReadOnlyList<OrderLine> Lines => _linesView;

    // Visible to the test project only, via InternalsVisibleTo.
    internal int MutationCount { get; private set; }

    public Order(Guid id)
    {
        Id = id;
        _linesView = new ReadOnlyCollection<OrderLine>(_lines);
    }

    public void AddLine(string sku, int quantity, decimal unitPrice)
    {
        RequireStatus(OrderStatus.Draft, "add a line to");

        if (string.IsNullOrWhiteSpace(sku))
            throw new ArgumentException("SKU is required.", nameof(sku));
        if (quantity < 1)
            throw new ArgumentOutOfRangeException(nameof(quantity), quantity, "Must be at least 1.");
        if (unitPrice < 0m)
            throw new ArgumentOutOfRangeException(nameof(unitPrice), unitPrice, "Cannot be negative.");

        var line = new OrderLine(sku, quantity, unitPrice);
        _lines.Add(line);
        Total += line.LineTotal;      // Total and _lines change together, always
        MutationCount++;
    }

    public void RemoveLine(string sku)
    {
        RequireStatus(OrderStatus.Draft, "remove a line from");

        var line = _lines.FirstOrDefault(l => l.Sku == sku)
            ?? throw new InvalidOperationException($"No line with SKU '{sku}'.");

        _lines.Remove(line);
        Total -= line.LineTotal;
        MutationCount++;
    }

    public void Place()
    {
        RequireStatus(OrderStatus.Draft, "place");
        if (_lines.Count == 0)
            throw new InvalidOperationException("Cannot place an order with no lines.");

        Status = OrderStatus.Placed;
        MutationCount++;
    }

    public void Dispatch(DateOnly on)
    {
        RequireStatus(OrderStatus.Placed, "dispatch");
        Status = OrderStatus.Dispatched;
        DispatchedOn = on;            // set together, so the invariant cannot be half-true
        MutationCount++;
    }

    private void RequireStatus(OrderStatus required, string verb)
    {
        if (Status != required)
            throw new InvalidOperationException(
                $"Cannot {verb} an order with status {Status}; it must be {required}.");
    }

    // The invariant, written as code so a test can assert it.
    internal bool InvariantsHold() =>
        Total == _lines.Sum(l => l.LineTotal)
        && (Status != OrderStatus.Dispatched || DispatchedOn is not null)
        && (Status == OrderStatus.Draft || _lines.Count > 0);
}

class Program
{
    static void Main()
    {
        var order = new Order(Guid.Parse("11111111-2222-3333-4444-555555555555"));
        order.AddLine("WIDGET-1", 3, 9.99m);
        order.AddLine("GIZMO-2", 1, 24.50m);

        Console.WriteLine($"status {order.Status}, {order.Lines.Count} lines, total {order.Total}");
        Console.WriteLine($"invariants hold: {order.InvariantsHold()}");

        Show("mutate the returned collection", () =>
            ((IList<OrderLine>)order.Lines).Add(null!));

        Show("dispatch before placing", () => order.Dispatch(new DateOnly(2026, 8, 30)));

        order.Place();
        Console.WriteLine($"placed: status {order.Status}");

        Show("add a line after placing", () => order.AddLine("LATE-3", 1, 5m));

        order.Dispatch(new DateOnly(2026, 8, 30));
        Console.WriteLine($"dispatched on {order.DispatchedOn}");
        Console.WriteLine($"invariants hold: {order.InvariantsHold()}");

        Show("remove a line after dispatch", () => order.RemoveLine("GIZMO-2"));

        Console.WriteLine($"final: {order.Lines.Count} lines, total {order.Total}, " +
                          $"{order.MutationCount} mutations");
    }

    static void Show(string what, Action action)
    {
        try
        {
            action();
            Console.WriteLine($"  {what}: SUCCEEDED (it should not have)");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  {what}: {ex.GetType().Name}");
        }
    }
}
