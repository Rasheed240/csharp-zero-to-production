// 03-production.cs — Ledger's tax-rules cache: a singleton whose constructor did
// I/O, and the change that took the p99 from 2,439 ms to 211 ms and the remote
// call count from 150 to 1. Then the race the obvious rewrite still has.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Tax;

public sealed record TaxRule(string Region, decimal Rate);

/// <summary>Stands in for the remote rules service.</summary>
public static class RulesService
{
    private static int _calls;
    public static int Calls => Volatile.Read(ref _calls);
    public static void Reset() => Volatile.Write(ref _calls, 0);

    public static async Task<IReadOnlyList<TaxRule>> FetchAsync(CancellationToken ct = default)
    {
        Interlocked.Increment(ref _calls);
        await Task.Delay(200, ct).ConfigureAwait(false);
        return new[] { new TaxRule("GB", 0.20m), new TaxRule("IE", 0.23m) };
    }
}

/// <summary>
/// THE BUG. Registered as a DI singleton. The constructor cannot be async, so
/// somebody blocked in it. It worked for two years because it ran once at
/// startup, when nothing else was competing for the pool.
/// </summary>
public sealed class TaxRulesCacheV1
{
    private readonly IReadOnlyList<TaxRule> _rules;

    public TaxRulesCacheV1()
    {
        _rules = RulesService.FetchAsync().GetAwaiter().GetResult();   // blocks
    }

    public decimal RateFor(string region) =>
        _rules.FirstOrDefault(r => r.Region == region)?.Rate ?? 0m;
}

/// <summary>
/// THE FIX. Nothing blocks. The value is produced once, lazily, by an async
/// method, and every caller awaits the same Task.
/// </summary>
public sealed class TaxRulesCacheV2
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IReadOnlyList<TaxRule>? _rules;

    public async ValueTask<decimal> RateForAsync(string region, CancellationToken ct = default)
    {
        var rules = _rules ?? await LoadAsync(ct).ConfigureAwait(false);
        return rules.FirstOrDefault(r => r.Region == region)?.Rate ?? 0m;
    }

    private async Task<IReadOnlyList<TaxRule>> LoadAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            // Re-check inside the gate: another caller may have loaded it while
            // this one was waiting. Without this the fetch runs once per waiter.
            return _rules ??= await RulesService.FetchAsync(ct).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }
}

/// <summary>
/// A NAIVE version, kept to measure what it does wrong. No gate, so N concurrent
/// first callers all miss the null check and all fetch.
/// </summary>
public sealed class TaxRulesCacheNaive
{
    private IReadOnlyList<TaxRule>? _rules;

    public async ValueTask<decimal> RateForAsync(string region, CancellationToken ct = default)
    {
        _rules ??= await RulesService.FetchAsync(ct).ConfigureAwait(false);
        return _rules.FirstOrDefault(r => r.Region == region)?.Rate ?? 0m;
    }
}

/// <summary>
/// The general form: an async Lazy. Task caching gives you once-only semantics
/// for free, because a Task is a value and awaiting it twice does not re-run it.
/// </summary>
public sealed class AsyncLazy<T>
{
    private readonly Lazy<Task<T>> _lazy;

    public AsyncLazy(Func<Task<T>> factory) =>
        _lazy = new Lazy<Task<T>>(factory, LazyThreadSafetyMode.ExecutionAndPublication);

    public Task<T> Value => _lazy.Value;
    public bool IsStarted => _lazy.IsValueCreated;
}

class Program
{
    const int Concurrent = 150;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger's tax rules live in a DI singleton. A constructor cannot be");
        Console.WriteLine("  async, so two years ago someone wrote this and it was reviewed and");
        Console.WriteLine("  merged:");
        Console.WriteLine();
        Console.WriteLine("      public TaxRulesCache()");
        Console.WriteLine("      {");
        Console.WriteLine("          _rules = RulesService.FetchAsync().GetAwaiter().GetResult();");
        Console.WriteLine("      }");
        Console.WriteLine();
        Console.WriteLine("  It ran once, at startup, before traffic arrived. It was invisible.");
        Console.WriteLine();
        Console.WriteLine("  Then the service was changed from Singleton to Scoped during an");
        Console.WriteLine("  unrelated refactor — a one-word diff — and the constructor started");
        Console.WriteLine("  running once PER REQUEST.");
        Console.WriteLine();

        Console.WriteLine("  lifetime / version                     total ms   p99 ms   fetches");
        Report("Scoped, blocking constructor", MeasureBlocking());
        Report("Scoped, async cache (the fix)", MeasureFixed());

        Console.WriteLine();
        Console.WriteLine("  The blocking version does not merely add latency: it holds one pool");
        Console.WriteLine("  thread per in-flight request for the whole 200 ms fetch. The pool");
        Console.WriteLine("  injects replacements at roughly one per 500 ms, so arriving requests");
        Console.WriteLine("  queue behind thread creation rather than behind the work.");
        Console.WriteLine();
        Console.WriteLine("  Note the fetch count too. Blocking per request means one remote call");
        Console.WriteLine("  per request against a service that expected one per process.");

        Console.WriteLine();
        Console.WriteLine("=== the race in the obvious fix ===");
        Console.WriteLine();
        Console.WriteLine("  Removing the blocking call is not enough on its own. The natural");
        Console.WriteLine("  rewrite has a race that only appears under concurrency:");
        Console.WriteLine();
        Console.WriteLine("      _rules ??= await RulesService.FetchAsync(ct);");
        Console.WriteLine();
        Console.WriteLine($"  {Concurrent} concurrent first callers:");

        RulesService.Reset();
        var naive = new TaxRulesCacheNaive();
        RunAll(i => naive.RateForAsync("GB").AsTask());
        Console.WriteLine($"    naive (no gate)      : {RulesService.Calls} fetches");

        RulesService.Reset();
        var gated = new TaxRulesCacheV2();
        RunAll(i => gated.RateForAsync("GB").AsTask());
        Console.WriteLine($"    gated + re-check     : {RulesService.Calls} fetch");

        RulesService.Reset();
        var lazy = new AsyncLazy<IReadOnlyList<TaxRule>>(() => RulesService.FetchAsync());
        RunAll(i => lazy.Value);
        Console.WriteLine($"    AsyncLazy<T>         : {RulesService.Calls} fetch");

        Console.WriteLine();
        Console.WriteLine("  The null check and the assignment are separated by an await. Every");
        Console.WriteLine("  caller that arrives during that window sees null and starts its own");
        Console.WriteLine("  fetch. This is a thundering herd against your dependency, and it");
        Console.WriteLine("  happens at exactly the worst moment: process start, or right after a");
        Console.WriteLine("  cache eviction, when the dependency is already under load.");
        Console.WriteLine();
        Console.WriteLine("  Two correct shapes. The SemaphoreSlim version gates the load and");
        Console.WriteLine("  re-checks inside the gate. The AsyncLazy version is shorter and is");
        Console.WriteLine("  usually what you want: it caches the TASK rather than the value, so");
        Console.WriteLine("  every caller awaits the same operation and it runs once by");
        Console.WriteLine("  construction.");
        Console.WriteLine();
        Console.WriteLine("  Note that AsyncLazy needs no lock of its own. Lazy<T> with");
        Console.WriteLine("  ExecutionAndPublication guarantees the factory runs once, and the");
        Console.WriteLine("  factory returns immediately with a Task — it does not block while");
        Console.WriteLine("  the fetch happens.");

        Console.WriteLine();
        Console.WriteLine("=== how this was found ===");
        Console.WriteLine();
        Console.WriteLine("  The symptom was a p99 that tripled with no deployment of the service");
        Console.WriteLine("  that owned the endpoint. dotnet-counters showed the signature from");
        Console.WriteLine("  t2-02: threadpool-thread-count climbing, threadpool-queue-length");
        Console.WriteLine("  climbing, cpu-usage FLAT. Work is arriving and not being done, and");
        Console.WriteLine("  the CPU is idle — that combination means threads are blocked.");
        Console.WriteLine();
        Console.WriteLine("    dotnet-counters monitor --process-id <pid> System.Runtime");
        Console.WriteLine("    dotnet-dump collect --process-id <pid>");
        Console.WriteLine("    > clrstack -all | findstr /c:GetResult /c:WaitAny /c:ManualReset");
        Console.WriteLine();
        Console.WriteLine("  Forty of the forty-four threads had GetResult on the stack, all in");
        Console.WriteLine("  the same constructor. A blocked pool thread is not subtle once you");
        Console.WriteLine("  know to look for it; the difficulty is that the metric people watch");
        Console.WriteLine("  is CPU, and CPU is the one that looks fine.");
    }

    readonly record struct Result(double TotalMs, double P99Ms, int Fetches);

    static Result MeasureBlocking() => Measure(i =>
        Task.Run(() =>
        {
            var cache = new TaxRulesCacheV1();      // constructor blocks
            return cache.RateFor("GB");
        }));

    static Result MeasureFixed()
    {
        var cache = new TaxRulesCacheV2();          // one instance, as a singleton would be
        return Measure(i => cache.RateForAsync("GB").AsTask());
    }

    static Result Measure(Func<int, Task<decimal>> request)
    {
        Thread.Sleep(250);
        RulesService.Reset();
        var latencies = new double[Concurrent];

        var sw = Stopwatch.StartNew();
        Task.WhenAll(Enumerable.Range(0, Concurrent).Select(async i =>
        {
            var each = Stopwatch.StartNew();
            await request(i).ConfigureAwait(false);
            latencies[i] = each.Elapsed.TotalMilliseconds;
        })).GetAwaiter().GetResult();
        sw.Stop();

        Array.Sort(latencies);
        return new Result(sw.Elapsed.TotalMilliseconds,
                          latencies[(int)(Concurrent * 0.99) - 1],
                          RulesService.Calls);
    }

    static void RunAll(Func<int, Task> request) =>
        Task.WhenAll(Enumerable.Range(0, Concurrent).Select(request)).GetAwaiter().GetResult();

    static void Report(string label, Result r) =>
        Console.WriteLine($"  {label,-36} {r.TotalMs,8:N0}   {r.P99Ms,6:N0}   {r.Fetches,7}");
}
