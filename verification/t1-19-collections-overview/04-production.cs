// 04-production.cs — the same feature written twice: once with the collection
// that came to mind, once with the one the access pattern wanted.
// .NET 10.0.400, Release. Run: dotnet run 04-production.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

public readonly record struct Product(string Sku, string Category, decimal Price);

// ---- the version that grew one requirement at a time ---------------------
public sealed class SlowCatalogue
{
    private readonly List<Product> _products = new();
    private readonly List<string> _blockedSkus = new();

    public void Add(Product p) => _products.Add(p);
    public void Block(string sku) => _blockedSkus.Add(sku);

    public Product? Find(string sku) =>
        _products.FirstOrDefault(p => p.Sku == sku) is { Sku: not null } hit ? hit : null;

    public bool IsBlocked(string sku) => _blockedSkus.Contains(sku);

    public IReadOnlyList<Product> InCategory(string category) =>
        _products.Where(p => p.Category == category).ToList();
}

// ---- the version matched to how it is actually used ----------------------
public sealed class FastCatalogue
{
    private readonly Dictionary<string, Product> _bySku;
    private readonly HashSet<string> _blockedSkus;
    private readonly Dictionary<string, List<Product>> _byCategory;

    public FastCatalogue(IEnumerable<Product> products)
    {
        var all = products.ToArray();
        _bySku = new Dictionary<string, Product>(all.Length, StringComparer.Ordinal);
        _byCategory = new Dictionary<string, List<Product>>(StringComparer.Ordinal);
        _blockedSkus = new HashSet<string>(StringComparer.Ordinal);

        foreach (var p in all)
        {
            _bySku[p.Sku] = p;
            if (!_byCategory.TryGetValue(p.Category, out var bucket))
                _byCategory[p.Category] = bucket = new List<Product>();
            bucket.Add(p);
        }
    }

    public void Block(string sku) => _blockedSkus.Add(sku);

    public Product? Find(string sku) =>
        _bySku.TryGetValue(sku, out var p) ? p : null;

    public bool IsBlocked(string sku) => _blockedSkus.Contains(sku);

    public IReadOnlyList<Product> InCategory(string category) =>
        _byCategory.TryGetValue(category, out var bucket)
            ? bucket
            : Array.Empty<Product>();
}

class Program
{
    const int Catalogue = 50_000;
    const int Lookups = 20_000;

    static void Main()
    {
        var categories = new[] { "tools", "garden", "kitchen", "office", "sport" };
        var products = Enumerable.Range(0, Catalogue)
            .Select(i => new Product($"SKU-{i}", categories[i % 5], 1m + i % 90))
            .ToArray();

        var slow = new SlowCatalogue();
        foreach (var p in products) slow.Add(p);
        for (int i = 0; i < 500; i++) slow.Block($"SKU-{i * 7}");

        var fast = new FastCatalogue(products);
        for (int i = 0; i < 500; i++) fast.Block($"SKU-{i * 7}");

        Console.WriteLine($"catalogue of {Catalogue:N0} products, {Lookups:N0} operations each");
        Console.WriteLine();

        Time("SlowCatalogue.Find", () =>
        { int n = 0; for (int i = 0; i < Lookups; i++) if (slow.Find($"SKU-{i}") is not null) n++; return n; });
        Time("FastCatalogue.Find", () =>
        { int n = 0; for (int i = 0; i < Lookups; i++) if (fast.Find($"SKU-{i}") is not null) n++; return n; });

        Console.WriteLine();
        Time("SlowCatalogue.IsBlocked", () =>
        { int n = 0; for (int i = 0; i < Lookups; i++) if (slow.IsBlocked($"SKU-{i}")) n++; return n; });
        Time("FastCatalogue.IsBlocked", () =>
        { int n = 0; for (int i = 0; i < Lookups; i++) if (fast.IsBlocked($"SKU-{i}")) n++; return n; });

        Console.WriteLine();
        Time("SlowCatalogue.InCategory x1000", () =>
        { int n = 0; for (int i = 0; i < 1000; i++) n += slow.InCategory(categories[i % 5]).Count; return n; });
        Time("FastCatalogue.InCategory x1000", () =>
        { int n = 0; for (int i = 0; i < 1000; i++) n += fast.InCategory(categories[i % 5]).Count; return n; });

        Console.WriteLine();
        Console.WriteLine("Same answers, same code shape at the call site. The difference is");
        Console.WriteLine("entirely which collection each field is, chosen from how it is read.");
    }

    static void Time(string label, Func<int> body)
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
            if (v == 0) throw new Exception("nothing found");
            bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-34} {best,8:F1} ms   {bytes,12:N0} bytes");
    }
}
