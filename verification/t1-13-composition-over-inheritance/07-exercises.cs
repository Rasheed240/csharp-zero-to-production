// 07-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 07-exercises.cs

using System;
using System.Collections.Generic;
using System.Linq;

// ===== Exercise 2 ==========================================================
interface ICache { string? Get(string key); }
interface IStatsReporting { int Hits { get; } }

sealed class MemoryCache : ICache, IStatsReporting
{
    private readonly Dictionary<string, string> _d = new() { ["a"] = "1" };
    private int _hits;
    public int Hits => _hits;
    public string? Get(string k) { if (_d.TryGetValue(k, out var v)) { _hits++; return v; } return null; }
}

sealed class TimingCache : ICache
{
    private readonly ICache _inner;
    public TimingCache(ICache inner) => _inner = inner;
    public string? Get(string k) => _inner.Get(k);
}

// ===== Exercise 3 ==========================================================
interface IStep { string Run(string input, IList<string> log); }

sealed class Work : IStep
{
    public string Run(string s, IList<string> log) { log.Add("work"); return s + "!"; }
}

sealed class Audit : IStep
{
    private readonly IStep _inner;
    public Audit(IStep inner) => _inner = inner;
    public string Run(string s, IList<string> log)
    {
        var r = _inner.Run(s, log);
        log.Add($"audit:{r}");
        return r;
    }
}

sealed class Cache : IStep
{
    private readonly IStep _inner;
    private readonly Dictionary<string, string> _seen = new();
    public Cache(IStep inner) => _inner = inner;
    public string Run(string s, IList<string> log)
    {
        if (_seen.TryGetValue(s, out var hit)) { log.Add("cache:hit"); return hit; }
        var r = _inner.Run(s, log);
        _seen[s] = r;
        return r;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1: class counts =====");
        Console.WriteLine("  behaviours | inheritance (2 x 2^n) | composition (2 + n)");
        for (int n = 0; n <= 6; n++)
            Console.WriteLine($"  {n,10} | {2 * (int)Math.Pow(2, n),21} | {2 + n,19}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: what wrapping hides =====");
        ICache bare = new MemoryCache();
        ICache wrapped = new TimingCache(bare);
        Console.WriteLine($"  bare    is IStatsReporting : {bare is IStatsReporting}");
        Console.WriteLine($"  wrapped is IStatsReporting : {wrapped is IStatsReporting}");
        _ = bare.Get("a");
        _ = wrapped.Get("a");
        Console.WriteLine($"  hits recorded on the inner cache : {((IStatsReporting)bare).Hits}");
        Console.WriteLine($"  but a dashboard reading the wrapped one cannot get at that number.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: layer ordering =====");

        var log1 = new List<string>();
        IStep cacheOutside = new Cache(new Audit(new Work()));
        Console.WriteLine("  Cache(Audit(Work)) — cache OUTSIDE audit:");
        Console.WriteLine($"    call 1 -> {cacheOutside.Run("x", log1)}");
        Console.WriteLine($"    call 2 -> {cacheOutside.Run("x", log1)}");
        Console.WriteLine($"    log: {string.Join(" | ", log1)}");

        var log2 = new List<string>();
        IStep auditOutside = new Audit(new Cache(new Work()));
        Console.WriteLine("  Audit(Cache(Work)) — audit OUTSIDE cache:");
        Console.WriteLine($"    call 1 -> {auditOutside.Run("x", log2)}");
        Console.WriteLine($"    call 2 -> {auditOutside.Run("x", log2)}");
        Console.WriteLine($"    log: {string.Join(" | ", log2)}");

        Console.WriteLine();
        Console.WriteLine($"  audit entries, cache outside : {log1.Count(l => l.StartsWith("audit"))}");
        Console.WriteLine($"  audit entries, audit outside : {log2.Count(l => l.StartsWith("audit"))}");
    }
}
