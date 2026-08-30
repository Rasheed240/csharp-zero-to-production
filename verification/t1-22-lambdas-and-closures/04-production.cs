// 04-production.cs — closures in a request-handling path: where they help,
// where they allocate, and how to keep the allocation off the hot loop.
// .NET 10.0.400, Release. Run: dotnet run 04-production.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

public readonly record struct Order(string Id, string Region, decimal Amount, int Items);

public sealed class OrderFilters
{
    // Built ONCE per configuration, not per request. The captures happen here.
    private readonly Func<Order, bool> _predicate;
    public string Description { get; }

    private OrderFilters(Func<Order, bool> predicate, string description)
        => (_predicate, Description) = (predicate, description);

    public static OrderFilters Build(string region, decimal minimum, int maxItems)
    {
        // Three captures, one display class, one delegate — created once.
        Func<Order, bool> p = o =>
            string.Equals(o.Region, region, StringComparison.Ordinal)
            && o.Amount >= minimum
            && o.Items <= maxItems;

        return new OrderFilters(p, $"{region}, >= {minimum:0.00}, <= {maxItems} items");
    }

    public bool Matches(Order order) => _predicate(order);

    public int CountMatching(IReadOnlyList<Order> orders)
    {
        int n = 0;
        for (int i = 0; i < orders.Count; i++) if (_predicate(orders[i])) n++;
        return n;
    }
}

class Program
{
    static void Main()
    {
        var regions = new[] { "eu-west", "us-east", "ap-south" };
        var orders = Enumerable.Range(0, 200_000)
            .Select(i => new Order($"O-{i}", regions[i % 3], i % 500, i % 20))
            .ToArray();

        var filter = OrderFilters.Build("eu-west", 100m, 10);
        Console.WriteLine($"filter: {filter.Description}");
        Console.WriteLine($"matches: {filter.CountMatching(orders):N0} of {orders.Length:N0}");

        Console.WriteLine();
        Console.WriteLine("--- closure built once, used many times ---");
        Measure("prebuilt filter, 20 passes", () =>
        {
            int n = 0;
            for (int pass = 0; pass < 20; pass++) n += filter.CountMatching(orders);
            return n;
        });

        Console.WriteLine();
        Console.WriteLine("--- the same work, rebuilding the closure every pass ---");
        Measure("filter rebuilt each pass, 20 passes", () =>
        {
            int n = 0;
            for (int pass = 0; pass < 20; pass++)
                n += OrderFilters.Build("eu-west", 100m, 10).CountMatching(orders);
            return n;
        });
        Console.WriteLine("  Almost identical — 20 extra closures is nothing against 4,000,000");
        Console.WriteLine("  predicate calls. Building a closure per REQUEST is fine.");

        Console.WriteLine();
        Console.WriteLine("--- but rebuilding it INSIDE the loop is not ---");
        Measure("closure rebuilt per element, 1 pass", () =>
        {
            int n = 0;
            for (int i = 0; i < orders.Length; i++)
            {
                var o = orders[i];
                Func<Order, bool> perElement = x => x.Region == o.Region && x.Amount >= 100m;
                if (perElement(o)) n++;
            }
            return n;
        });
        Console.WriteLine("  One closure per element. This is the shape that shows up in a");
        Console.WriteLine("  memory profile as <>c__DisplayClass at the top of the list.");
    }

    static void Measure(string label, Func<int> body)
    {
        body();
        double best = double.MaxValue;
        long bytes = 0;
        for (int r = 0; r < 3; r++)
        {
            long before = GC.GetTotalAllocatedBytes(precise: true);
            var sw = Stopwatch.StartNew();
            int v = body();
            sw.Stop();
            if (v == 0) throw new Exception("nothing matched");
            bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-40} {best,7:F1} ms   {bytes,12:N0} bytes");
    }
}
