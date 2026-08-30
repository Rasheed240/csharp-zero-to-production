// 06-production.cs — a key type built to the contract, and the test that
// proves it. .NET 10.0.400. Run: dotnet run 06-production.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

// A cache key. Every decision here is one rule from this module.
public readonly record struct QuoteKey : IEquatable<QuoteKey>
{
    public string Product { get; }
    public string Currency { get; }
    public int Quantity { get; }
    private readonly string _options;      // pre-joined: value-comparable

    public QuoteKey(string product, string currency, int quantity, IEnumerable<string> options)
    {
        Product = product ?? throw new ArgumentNullException(nameof(product));
        Currency = currency ?? throw new ArgumentNullException(nameof(currency));
        Quantity = quantity;
        // Sorted so that option order does not change the key.
        _options = string.Join('|', options.OrderBy(o => o, StringComparer.Ordinal));
    }

    public IReadOnlyList<string> Options =>
        _options.Length == 0 ? Array.Empty<string>() : _options.Split('|');

    public bool Equals(QuoteKey other) =>
        Quantity == other.Quantity
        && string.Equals(Product, other.Product, StringComparison.Ordinal)
        && string.Equals(Currency, other.Currency, StringComparison.OrdinalIgnoreCase)
        && string.Equals(_options, other._options, StringComparison.Ordinal);

    // Must agree with Equals: Currency is compared case-insensitively, so it
    // must be HASHED case-insensitively too.
    public override int GetHashCode() => HashCode.Combine(
        Product.GetHashCode(StringComparison.Ordinal),
        Currency.GetHashCode(StringComparison.OrdinalIgnoreCase),
        Quantity,
        _options.GetHashCode(StringComparison.Ordinal));

    public override string ToString() =>
        $"{Product}/{Currency}/{Quantity}[{_options}]";
}

public sealed class QuoteCache
{
    private readonly Dictionary<QuoteKey, decimal> _entries = new();
    private readonly Func<QuoteKey, decimal> _compute;
    public int Computations { get; private set; }
    public int Hits { get; private set; }

    public QuoteCache(Func<QuoteKey, decimal> compute) => _compute = compute;

    public decimal Get(QuoteKey key)
    {
        if (_entries.TryGetValue(key, out var cached)) { Hits++; return cached; }
        Computations++;
        var value = _compute(key);
        _entries[key] = value;
        return value;
    }

    public int Count => _entries.Count;
}

class Program
{
    static void Main()
    {
        var cache = new QuoteCache(k => k.Quantity * 9.99m);

        var k1 = new QuoteKey("WIDGET", "GBP", 3, new[] { "express", "gift" });
        var k2 = new QuoteKey("WIDGET", "GBP", 3, new[] { "gift", "express" });   // reordered
        var k3 = new QuoteKey("WIDGET", "gbp", 3, new[] { "express", "gift" });   // lower case
        var k4 = new QuoteKey("WIDGET", "USD", 3, new[] { "express", "gift" });

        Console.WriteLine("--- the equality test every key type should have ---");
        Console.WriteLine($"  k1 == k2 (options reordered)  : {k1 == k2}");
        Console.WriteLine($"  hash codes match              : {k1.GetHashCode() == k2.GetHashCode()}");
        Console.WriteLine($"  k1 == k3 (currency case)      : {k1 == k3}");
        Console.WriteLine($"  hash codes match              : {k1.GetHashCode() == k3.GetHashCode()}");
        Console.WriteLine($"  k1 == k4 (different currency) : {k1 == k4}");

        Console.WriteLine();
        Console.WriteLine("--- the cache actually caches ---");
        foreach (var k in new[] { k1, k2, k3, k1, k4 })
            Console.WriteLine($"  Get({k}) = {cache.Get(k)}");
        Console.WriteLine($"  computations {cache.Computations}, hits {cache.Hits}, " +
                          $"entries {cache.Count}");

        Console.WriteLine();
        Console.WriteLine("--- hash distribution over 50,000 realistic keys ---");
        var buckets = new Dictionary<int, int>();
        var distinct = new HashSet<QuoteKey>();
        var products = new[] { "WIDGET", "GIZMO", "BOLT", "NUT", "WASHER" };
        var currencies = new[] { "GBP", "USD", "EUR" };
        for (int i = 0; i < 50_000; i++)
        {
            var key = new QuoteKey(products[i % 5], currencies[i % 3], i % 100,
                                   new[] { $"opt{i % 7}" });
            distinct.Add(key);
            int bucket = key.GetHashCode() & 1023;
            buckets[bucket] = buckets.GetValueOrDefault(bucket) + 1;
        }
        Console.WriteLine($"  distinct keys generated : {distinct.Count:N0}");
        Console.WriteLine($"  buckets used (of 1024)  : {buckets.Count}");
        Console.WriteLine($"  largest bucket          : {buckets.Values.Max()}");
        Console.WriteLine($"  mean per used bucket    : {buckets.Values.Average():F1}");
        Console.WriteLine("  Even spread means lookups stay O(1). One huge bucket would be the");
        Console.WriteLine("  signature of a poor GetHashCode.");
    }
}
