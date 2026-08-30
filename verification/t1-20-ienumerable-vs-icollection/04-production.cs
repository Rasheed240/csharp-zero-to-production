// 04-production.cs — choosing return types and parameter types deliberately,
// and what each choice tells the caller.
// .NET 10.0.400. Run: dotnet run 04-production.cs

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

public readonly record struct Order(string Id, string Status, decimal Amount);

public sealed class OrderBook
{
    private readonly List<Order> _orders = new();
    private readonly ReadOnlyCollection<Order> _view;

    public OrderBook() => _view = new ReadOnlyCollection<Order>(_orders);

    public void Add(Order order) => _orders.Add(order);

    // RETURN TYPE 1: a materialised, counted, indexable snapshot the caller
    // cannot modify. Costs nothing per call — the wrapper is built once.
    public IReadOnlyList<Order> All => _view;

    // RETURN TYPE 2: deferred, because the caller may only want the first few.
    // Documented as such, because the name cannot say it.
    public IEnumerable<Order> WhereStatus(string status) =>
        _orders.Where(o => string.Equals(o.Status, status, StringComparison.Ordinal));

    // RETURN TYPE 3: materialised, because the caller almost certainly wants
    // all of it and would otherwise re-run the query per pass.
    public IReadOnlyList<Order> TopBy(Func<Order, decimal> key, int take) =>
        _orders.OrderByDescending(key).Take(take).ToArray();

    // PARAMETER TYPE: IEnumerable, because this only reads forward once.
    public int AddRange(IEnumerable<Order> orders)
    {
        int before = _orders.Count;
        // If the caller handed us something with a known size, use it.
        if (orders is ICollection<Order> collection)
            _orders.Capacity = Math.Max(_orders.Capacity, _orders.Count + collection.Count);
        foreach (var o in orders) _orders.Add(o);
        return _orders.Count - before;
    }
}

class Program
{
    static void Main()
    {
        var book = new OrderBook();
        int added = book.AddRange(new[]
        {
            new Order("O-1", "open", 120.00m),
            new Order("O-2", "shipped", 45.50m),
            new Order("O-3", "open", 800.00m),
            new Order("O-4", "cancelled", 12.00m),
            new Order("O-5", "open", 300.00m)
        });
        Console.WriteLine($"added {added}, book now has {book.All.Count}");

        Console.WriteLine();
        Console.WriteLine("--- All: counted, indexable, and not writable through the interface ---");
        Console.WriteLine($"  Count       : {book.All.Count}");
        Console.WriteLine($"  All[0]      : {book.All[0]}");
        Console.WriteLine($"  is IList?   : {book.All is IList<Order>}  (yes — but Add throws)");
        try { ((IList<Order>)book.All).Add(default); }
        catch (NotSupportedException) { Console.WriteLine("  Add through IList: NotSupportedException"); }

        Console.WriteLine();
        Console.WriteLine("--- WhereStatus: deferred, so it sees later changes ---");
        var open = book.WhereStatus("open");
        Console.WriteLine($"  open now         : {open.Count()}");
        book.Add(new Order("O-6", "open", 5.00m));
        Console.WriteLine($"  after adding one : {open.Count()}   (same query object)");
        Console.WriteLine("  That is useful when intended and a bug when not, which is why the");
        Console.WriteLine("  return type says IEnumerable rather than IReadOnlyList.");

        Console.WriteLine();
        Console.WriteLine("--- TopBy: materialised, so it is a stable answer ---");
        var top = book.TopBy(o => o.Amount, 3);
        Console.WriteLine($"  top 3 by amount  : {string.Join(", ", top.Select(o => o.Id))}");
        book.Add(new Order("O-7", "open", 9999.00m));
        Console.WriteLine($"  after adding a bigger one: {string.Join(", ", top.Select(o => o.Id))}");
        Console.WriteLine("  Unchanged — it is a snapshot, which is what a report wants.");

        Console.WriteLine();
        Console.WriteLine("--- the parameter type let AddRange pre-size ---");
        var book2 = new OrderBook();
        var array = Enumerable.Range(0, 1000).Select(i => new Order($"X-{i}", "open", i)).ToArray();
        Console.WriteLine($"  AddRange(array)  : added {book2.AddRange(array)}");
        var lazy = Enumerable.Range(0, 1000).Select(i => new Order($"Y-{i}", "open", i));
        Console.WriteLine($"  AddRange(lazy)   : added {book2.AddRange(lazy)}");
        Console.WriteLine("  Both work. The first could pre-size because an array is an");
        Console.WriteLine("  ICollection; the second could not, and grew as it went.");
    }
}
