// 04-leaking-state.cs — a private field is not private if you hand out a
// reference to the object it points at.
// .NET 10.0.400. Run: dotnet run -c Release 04-leaking-state.cs

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;

class LeakyOrder
{
    private readonly List<string> _lines = new();
    public decimal Total { get; private set; }

    public void AddLine(string sku, decimal price)
    {
        _lines.Add(sku);
        Total += price;
    }

    // Looks like a read-only view. Is not.
    public List<string> Lines => _lines;
}

class HalfLeakyOrder
{
    private readonly List<string> _lines = new();
    public decimal Total { get; private set; }

    public void AddLine(string sku, decimal price)
    {
        _lines.Add(sku);
        Total += price;
    }

    // The static type blocks Add. The runtime type does not.
    public IReadOnlyList<string> Lines => _lines;
}

class SealedOrder
{
    private readonly List<string> _lines = new();
    public decimal Total { get; private set; }

    public void AddLine(string sku, decimal price)
    {
        _lines.Add(sku);
        Total += price;
    }

    // A wrapper the caller cannot unwrap into the original list.
    public IReadOnlyList<string> Lines => new ReadOnlyCollection<string>(_lines);
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. returning the List directly ---");
        var leaky = new LeakyOrder();
        leaky.AddLine("WIDGET-1", 10m);
        leaky.Lines.Add("FREE-PONY");          // no compiler complaint at all
        leaky.Lines.Clear();
        Console.WriteLine($"lines: {leaky.Lines.Count}, Total still: {leaky.Total}");

        Console.WriteLine();
        Console.WriteLine("--- 2. returning IReadOnlyList (the usual advice) ---");
        var half = new HalfLeakyOrder();
        half.AddLine("WIDGET-1", 10m);
        // half.Lines.Add(...) does not compile. But:
        if (half.Lines is List<string> unwrapped)
        {
            unwrapped.Add("FREE-PONY");
            Console.WriteLine("cast back to List<string> and mutated it");
        }
        Console.WriteLine($"lines: {half.Lines.Count}, Total still: {half.Total}");

        Console.WriteLine();
        Console.WriteLine("--- 3. ReadOnlyCollection wrapper ---");
        var safe = new SealedOrder();
        safe.AddLine("WIDGET-1", 10m);
        Console.WriteLine($"is it a List<string>?  {safe.Lines is List<string>}");
        try
        {
            ((IList<string>)safe.Lines).Add("FREE-PONY");
        }
        catch (NotSupportedException ex)
        {
            Console.WriteLine($"forcing it through IList threw {ex.GetType().Name}");
        }
        Console.WriteLine($"lines: {safe.Lines.Count}, Total: {safe.Total}");

        Console.WriteLine();
        Console.WriteLine("--- but a wrapper is a VIEW, not a snapshot ---");
        var view = safe.Lines;
        safe.AddLine("WIDGET-2", 5m);
        Console.WriteLine($"the view taken before the add now reports {view.Count} lines");

        Console.WriteLine();
        Console.WriteLine("--- what each defence costs, 1,000-item list, 200,000 reads ---");
        var source = Enumerable.Range(0, 1000).Select(i => $"SKU-{i}").ToList();
        Measure("return the list itself", () => (IReadOnlyList<string>)source);
        Measure("new ReadOnlyCollection", () => new ReadOnlyCollection<string>(source));
        Measure("ToArray (real copy)", () => source.ToArray());
    }

    static void Measure(string label, Func<IReadOnlyList<string>> get)
    {
        for (int i = 0; i < 10_000; i++) get();      // warm up and tier up

        double best = double.MaxValue, worst = 0;
        for (int round = 0; round < 5; round++)
        {
            var sw = Stopwatch.StartNew();
            int n = 0;
            for (int i = 0; i < 200_000; i++) n += get().Count;
            sw.Stop();
            if (n != 200_000_000) throw new Exception("wrong count");
            double ms = sw.Elapsed.TotalMilliseconds;
            if (ms < best) best = ms;
            if (ms > worst) worst = ms;
        }
        Console.WriteLine($"  {label,-24} best {best,7:F1} ms   worst {worst,7:F1} ms");
    }
}
