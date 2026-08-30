// 05-production-rules.cs — polymorphism where it earns its place, and the
// dispatch cost put in proportion to the work the calls actually do.
// .NET 10.0.400, Release. Run: dotnet run 05-production-rules.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

public sealed record Order(string Id, decimal Total, string Country, int ItemCount, bool IsFirstOrder);

public sealed record RuleResult(string Rule, bool Passed, string? Reason = null);

public abstract class OrderRule
{
    public abstract string Name { get; }
    protected abstract bool Check(Order order, out string? reason);

    // Non-virtual: every rule is evaluated the same way and cannot skip the
    // bookkeeping. The template-method shape from the previous module.
    public RuleResult Evaluate(Order order)
    {
        try
        {
            bool ok = Check(order, out var reason);
            return new RuleResult(Name, ok, ok ? null : reason);
        }
        catch (Exception ex)
        {
            return new RuleResult(Name, false, $"rule threw {ex.GetType().Name}");
        }
    }
}

public sealed class MinimumTotalRule : OrderRule
{
    private readonly decimal _minimum;
    public MinimumTotalRule(decimal minimum) => _minimum = minimum;
    public override string Name => "minimum-total";
    protected override bool Check(Order o, out string? reason)
    {
        reason = o.Total < _minimum ? $"total {o.Total:0.00} below {_minimum:0.00}" : null;
        return reason is null;
    }
}

public sealed class ShippableCountryRule : OrderRule
{
    private static readonly HashSet<string> Allowed = new(StringComparer.OrdinalIgnoreCase)
        { "GB", "IE", "FR", "DE" };
    public override string Name => "shippable-country";
    protected override bool Check(Order o, out string? reason)
    {
        reason = Allowed.Contains(o.Country) ? null : $"cannot ship to {o.Country}";
        return reason is null;
    }
}

public sealed class FirstOrderLimitRule : OrderRule
{
    public override string Name => "first-order-limit";
    protected override bool Check(Order o, out string? reason)
    {
        reason = o.IsFirstOrder && o.Total > 500m ? "first order over 500.00" : null;
        return reason is null;
    }
}

public sealed class ItemCountRule : OrderRule
{
    public override string Name => "item-count";
    protected override bool Check(Order o, out string? reason)
    {
        reason = o.ItemCount is < 1 or > 100 ? $"item count {o.ItemCount} out of range" : null;
        return reason is null;
    }
}

public sealed class OrderValidator
{
    private readonly IReadOnlyList<OrderRule> _rules;
    public OrderValidator(IEnumerable<OrderRule> rules) => _rules = rules.ToArray();

    public IReadOnlyList<RuleResult> Validate(Order order)
        => _rules.Select(r => r.Evaluate(order)).ToArray();
}

class Program
{
    static void Main()
    {
        var validator = new OrderValidator(new OrderRule[]
        {
            new MinimumTotalRule(10m),
            new ShippableCountryRule(),
            new FirstOrderLimitRule(),
            new ItemCountRule()
        });

        var orders = new[]
        {
            new Order("A-1", 250m, "GB", 3, false),
            new Order("A-2", 5m, "GB", 1, false),
            new Order("A-3", 900m, "US", 2, true)
        };

        foreach (var o in orders)
        {
            var results = validator.Validate(o);
            var failed = results.Where(r => !r.Passed).ToArray();
            Console.WriteLine($"{o.Id}: {(failed.Length == 0 ? "accepted" : "rejected")}");
            foreach (var f in failed) Console.WriteLine($"    {f.Rule}: {f.Reason}");
        }

        Console.WriteLine();
        Console.WriteLine("--- what the dispatch actually costs here ---");
        var order = orders[0];
        const int Iterations = 1_000_000;

        validator.Validate(order);
        double best = double.MaxValue;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            for (int i = 0; i < Iterations; i++) validator.Validate(order);
            sw.Stop();
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }

        double perValidation = best * 1_000_000 / Iterations;   // nanoseconds
        Console.WriteLine($"  {Iterations:N0} validations, 4 rules each = {Iterations * 4L:N0} virtual calls");
        Console.WriteLine($"  best total   : {best:F1} ms");
        Console.WriteLine($"  per order    : {perValidation:F0} ns");
        Console.WriteLine($"  per rule     : {perValidation / 4:F0} ns");
        Console.WriteLine();
        Console.WriteLine("  Measured dispatch overhead from 02-dispatch-cost.cs is about");
        Console.WriteLine("  3 ns per polymorphic virtual call on this machine, so roughly");
        Console.WriteLine($"  {4 * 3.0 / perValidation:P1} of the time above is dispatch. The rest is the");
        Console.WriteLine("  allocation, the LINQ, and the work the rules actually do.");
    }
}
