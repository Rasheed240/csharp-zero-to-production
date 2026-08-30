// 05-production.cs — the four things people reach for static to do, and what
// each should be instead.
// .NET 10.0.400. Run: dotnet run 05-production.cs -c Release

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

// ---- 1. genuinely immutable shared data: static readonly is correct -------
static class Currencies
{
    // Frozen at initialisation, never mutated, safe to share.
    public static readonly IReadOnlyDictionary<string, int> MinorUnits =
        new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["GBP"] = 2, ["USD"] = 2, ["EUR"] = 2, ["JPY"] = 0, ["KWD"] = 3
        };

    public static int DecimalsFor(string code) =>
        MinorUnits.TryGetValue(code, out int d) ? d : 2;
}

// ---- 2. expensive one-time setup: Lazy<T>, not a static constructor -------
sealed class RateTable
{
    public static int BuildCount;

    private static readonly Lazy<RateTable> _instance =
        new(() => Build(), LazyThreadSafetyMode.ExecutionAndPublication);

    public static RateTable Instance => _instance.Value;

    private readonly Dictionary<string, decimal> _rates;
    private RateTable(Dictionary<string, decimal> rates) => _rates = rates;

    private static RateTable Build()
    {
        Interlocked.Increment(ref BuildCount);
        Thread.Sleep(100);
        return new RateTable(new Dictionary<string, decimal>
        {
            ["GBP"] = 1.00m, ["USD"] = 1.27m, ["EUR"] = 1.17m
        });
    }

    public decimal Rate(string code) => _rates.TryGetValue(code, out var r) ? r : 0m;
}

// ---- 3. shared MUTABLE state: an injected object, not a static field ------
public interface ICallCounter { void Record(string op); IReadOnlyDictionary<string, int> Snapshot(); }

public sealed class CallCounter : ICallCounter
{
    private readonly ConcurrentDictionary<string, int> _counts = new();
    public void Record(string op) => _counts.AddOrUpdate(op, 1, (_, n) => n + 1);
    public IReadOnlyDictionary<string, int> Snapshot() => new Dictionary<string, int>(_counts);
}

public sealed class PricingService
{
    private readonly ICallCounter _counter;
    public PricingService(ICallCounter counter) => _counter = counter;

    public decimal Price(decimal amount, string currency)
    {
        _counter.Record("price");
        int decimals = Currencies.DecimalsFor(currency);
        return Math.Round(amount * RateTable.Instance.Rate(currency), decimals);
    }
}

// ---- 4. per-operation ambient context: pass it, or use AsyncLocal --------
static class RequestContext
{
    private static readonly AsyncLocal<string?> _tenant = new();
    public static string? Tenant { get => _tenant.Value; set => _tenant.Value = value; }
}

class Program
{
    static async Task Main()
    {
        Console.WriteLine("--- 1. static readonly for immutable shared data ---");
        foreach (var c in new[] { "GBP", "JPY", "KWD", "XXX" })
            Console.WriteLine($"  {c}: {Currencies.DecimalsFor(c)} decimal places");

        Console.WriteLine();
        Console.WriteLine("--- 2. Lazy<T> for expensive setup, under 12 concurrent callers ---");
        var tasks = new Task<decimal>[12];
        for (int i = 0; i < 12; i++) tasks[i] = Task.Run(() => RateTable.Instance.Rate("USD"));
        await Task.WhenAll(tasks);
        Console.WriteLine($"  built {RateTable.BuildCount} time(s); every caller got " +
                          $"{tasks[0].Result}");
        Console.WriteLine("  Same exactly-once guarantee as a static constructor, and the");
        Console.WriteLine("  failure surfaces as an ordinary exception rather than a");
        Console.WriteLine("  TypeInitializationException that poisons every member of the type.");
        Console.WriteLine("  Note this mode still CACHES a failure: see 06-exercises.cs for the");
        Console.WriteLine("  measured difference between the LazyThreadSafetyMode values.");

        Console.WriteLine();
        Console.WriteLine("--- 3. injected shared state: two independent instances ---");
        var counterA = new CallCounter();
        var counterB = new CallCounter();
        var serviceA = new PricingService(counterA);
        var serviceB = new PricingService(counterB);

        Console.WriteLine($"  A: {serviceA.Price(100m, "USD")} USD, {serviceA.Price(100m, "JPY")} JPY");
        Console.WriteLine($"  B: {serviceB.Price(50m, "EUR")} EUR");
        Console.WriteLine($"  counter A: {Describe(counterA.Snapshot())}");
        Console.WriteLine($"  counter B: {Describe(counterB.Snapshot())}");
        Console.WriteLine("  Two tests can run at the same time without sharing a number.");

        Console.WriteLine();
        Console.WriteLine("--- 4. AsyncLocal for per-operation context ---");
        var work = new Task[2];
        var seen = new string?[2];
        for (int i = 0; i < 2; i++)
        {
            int index = i;
            work[i] = Task.Run(async () =>
            {
                RequestContext.Tenant = index == 0 ? "acme" : "globex";
                await Task.Delay(30);
                seen[index] = RequestContext.Tenant;
            });
        }
        await Task.WhenAll(work);
        Console.WriteLine($"  task 0 saw: {seen[0]}");
        Console.WriteLine($"  task 1 saw: {seen[1]}");
        Console.WriteLine("  One name, one value per logical flow, surviving await.");
        Console.WriteLine($"  and on this thread: {RequestContext.Tenant ?? "(null, as it should be)"}");
    }

    static string Describe(IReadOnlyDictionary<string, int> d) =>
        d.Count == 0 ? "(empty)" : string.Join(", ", d.Select(kv => $"{kv.Key}={kv.Value}"));
}
