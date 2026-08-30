// 05-delegates.cs — when the varying part is a single method, a delegate is
// composition with no type to declare.
// .NET 10.0.400. Run: dotnet run 05-delegates.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

// ---- version A: inheritance ------------------------------------------------
abstract class PricerBase
{
    public decimal Price(decimal list) => Math.Round(Adjust(list), 2);
    protected abstract decimal Adjust(decimal list);
}
sealed class TenPercentOff : PricerBase { protected override decimal Adjust(decimal l) => l * 0.9m; }
sealed class FlatFiveOff : PricerBase { protected override decimal Adjust(decimal l) => l - 5m; }

// ---- version B: an interface -----------------------------------------------
interface IAdjustment { decimal Adjust(decimal list); }
sealed class TenPercent : IAdjustment { public decimal Adjust(decimal l) => l * 0.9m; }
sealed class FlatFive : IAdjustment { public decimal Adjust(decimal l) => l - 5m; }

sealed class InterfacePricer
{
    private readonly IAdjustment _adjustment;
    public InterfacePricer(IAdjustment a) => _adjustment = a;
    public decimal Price(decimal list) => Math.Round(_adjustment.Adjust(list), 2);
}

// ---- version C: a delegate -------------------------------------------------
sealed class DelegatePricer
{
    private readonly Func<decimal, decimal> _adjust;
    public DelegatePricer(Func<decimal, decimal> adjust) => _adjust = adjust;
    public decimal Price(decimal list) => Math.Round(_adjust(list), 2);
}

class Program
{
    const int N = 20_000_000;

    static decimal R1(PricerBase p) { decimal t = 0; for (int i = 0; i < N; i++) t += p.Price(100m); return t; }
    static decimal R2(InterfacePricer p) { decimal t = 0; for (int i = 0; i < N; i++) t += p.Price(100m); return t; }
    static decimal R3(DelegatePricer p) { decimal t = 0; for (int i = 0; i < N; i++) t += p.Price(100m); return t; }

    static void Time(string label, Func<decimal> body)
    {
        body();
        double best = double.MaxValue;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            var v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-28} {best,7:F1} ms   {best * 1e6 / N,5:F2} ns/call");
    }

    static void Main()
    {
        Console.WriteLine("Same result, three ways of varying one step:");
        Console.WriteLine($"  inheritance : {new TenPercentOff().Price(100m)}  {new FlatFiveOff().Price(100m)}");
        Console.WriteLine($"  interface   : {new InterfacePricer(new TenPercent()).Price(100m)}  " +
                          $"{new InterfacePricer(new FlatFive()).Price(100m)}");
        Console.WriteLine($"  delegate    : {new DelegatePricer(l => l * 0.9m).Price(100m)}  " +
                          $"{new DelegatePricer(l => l - 5m).Price(100m)}");

        Console.WriteLine();
        Console.WriteLine("Types declared to express two adjustments:");
        Console.WriteLine("  inheritance : 1 abstract base + 2 subclasses = 3");
        Console.WriteLine("  interface   : 1 interface + 2 implementations + 1 host = 4");
        Console.WriteLine("  delegate    : 1 host, and the adjustments are expressions = 1");

        Console.WriteLine();
        Console.WriteLine("Combining them is also an expression:");
        Func<decimal, decimal> tenThenFive = l => (l * 0.9m) - 5m;
        Console.WriteLine($"  10% then flat 5 off 100 : {new DelegatePricer(tenThenFive).Price(100m)}");
        var pipeline = new List<Func<decimal, decimal>> { l => l * 0.9m, l => l - 5m, l => l * 1.2m };
        Func<decimal, decimal> combined = pipeline.Aggregate<Func<decimal, decimal>,
            Func<decimal, decimal>>(l => l, (acc, f) => l => f(acc(l)));
        Console.WriteLine($"  10% off, 5 off, then 20% VAT : {new DelegatePricer(combined).Price(100m)}");

        Console.WriteLine();
        Console.WriteLine($"Cost, {N:N0} calls, best of 5:");
        Time("inheritance (virtual)", () => R1(new TenPercentOff()));
        Time("interface (composition)", () => R2(new InterfacePricer(new TenPercent())));
        Time("delegate", () => R3(new DelegatePricer(l => l * 0.9m)));
    }
}
