// 03-production.cs — Ledger's rate cache, the exact shape ValueTask was designed
// for, with the decision made on measurements rather than on reputation. Plus
// TaskCompletionSource wrapping a callback API, which is the other half of what
// Task is actually for.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Rates;

public sealed record Rate(string Currency, decimal PerGbp);

/// <summary>A rate cache. Hits are in-memory; misses go to a remote service.</summary>
public sealed class RateCache
{
    private readonly ConcurrentDictionary<string, Rate> _cache = new();
    private readonly int _missMs;

    public RateCache(int missMs) => _missMs = missMs;

    public void Seed(params string[] currencies)
    {
        foreach (var c in currencies) _cache[c] = new Rate(c, 1.17m);
    }

    public int Count => _cache.Count;

    /// <summary>Task version: allocates on every call, hit or miss.</summary>
    public async Task<Rate> GetTaskAsync(string currency, CancellationToken ct = default)
    {
        if (_cache.TryGetValue(currency, out var hit)) return hit;
        await Task.Delay(_missMs, ct).ConfigureAwait(false);
        var fetched = new Rate(currency, 1.00m);
        _cache[currency] = fetched;
        return fetched;
    }

    /// <summary>ValueTask version: allocates nothing on the hit path.</summary>
    public ValueTask<Rate> GetValueTaskAsync(string currency, CancellationToken ct = default)
    {
        if (_cache.TryGetValue(currency, out var hit)) return new ValueTask<Rate>(hit);
        return new ValueTask<Rate>(FetchAsync(currency, ct));

        async Task<Rate> FetchAsync(string c, CancellationToken token)
        {
            await Task.Delay(_missMs, token).ConfigureAwait(false);
            var fetched = new Rate(c, 1.00m);
            _cache[c] = fetched;
            return fetched;
        }
    }
}

/// <summary>A callback-based API, of the kind TaskCompletionSource exists to wrap.</summary>
public sealed class LegacyGateway
{
    public void Authorise(string reference, Action<string> onSuccess, Action<Exception> onError)
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            Thread.Sleep(30);
            if (reference.StartsWith("BAD", StringComparison.Ordinal))
                onError(new InvalidOperationException($"declined: {reference}"));
            else
                onSuccess("AUTH-" + reference);
        });
    }
}

public static class LegacyGatewayExtensions
{
    /// <summary>Turns the callback API into an awaitable one. No thread is held.</summary>
    public static Task<string> AuthoriseAsync(this LegacyGateway gateway, string reference,
                                              CancellationToken ct = default)
    {
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var registration = ct.Register(() => tcs.TrySetCanceled(ct));

        gateway.Authorise(reference,
            result => { registration.Dispose(); tcs.TrySetResult(result); },
            error => { registration.Dispose(); tcs.TrySetException(error); });

        return tcs.Task;
    }
}

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== the decision: what is the hit rate? ===");
        Console.WriteLine();
        Console.WriteLine("  hit rate   Task bytes/call   ValueTask bytes/call   saving");

        foreach (var hitRate in new[] { 100, 99, 90, 50, 0 })
        {
            var cache = new RateCache(missMs: 1);
            var currencies = BuildWorkload(hitRate, cache);

            var taskBytes = AllocPerCall(currencies, c =>
                _sink += cache.GetTaskAsync(c).GetAwaiter().GetResult().PerGbp > 0 ? 1 : 0);

            var cache2 = new RateCache(missMs: 1);
            var currencies2 = BuildWorkload(hitRate, cache2);
            var valueBytes = AllocPerCall(currencies2, c =>
                _sink += cache2.GetValueTaskAsync(c).GetAwaiter().GetResult().PerGbp > 0 ? 1 : 0);

            Console.WriteLine($"  {hitRate,7}%   {taskBytes,15}   {valueBytes,20}   " +
                              $"{(taskBytes == 0 ? 0 : 100 - valueBytes * 100 / Math.Max(taskBytes, 1)),5}%");
        }

        Console.WriteLine();
        Console.WriteLine("  The saving is large at high hit rates and decays to nothing at 0%.");
        Console.WriteLine("  (In 02-valuetask.cs, where every call suspends, it goes further and");
        Console.WriteLine("  turns NEGATIVE: 128 bytes against Task's 112.)");
        Console.WriteLine("  ValueTask is a bet on the synchronous path, and if you cannot");
        Console.WriteLine("  say what your hit rate is, you cannot say whether it pays.");

        Console.WriteLine();
        Console.WriteLine("=== wrapping a callback API with TaskCompletionSource ===");
        var gateway = new LegacyGateway();

        var ok = gateway.AuthoriseAsync("P-1").GetAwaiter().GetResult();
        Console.WriteLine($"  success  : {ok}");

        try
        {
            gateway.AuthoriseAsync("BAD-2").GetAwaiter().GetResult();
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  failure  : {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine("  The exception arrived at the AWAIT, not at the callback. That");
            Console.WriteLine("  is what TaskCompletionSource buys: ordinary error handling.");
        }

        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            try
            {
                gateway.AuthoriseAsync("P-3", cts.Token).GetAwaiter().GetResult();
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine("  cancelled: OperationCanceledException");
            }
        }

        Console.WriteLine();
        Console.WriteLine("  Note RunContinuationsAsynchronously in the constructor. Without it,");
        Console.WriteLine("  the continuation runs INLINE on whichever thread called SetResult —");
        Console.WriteLine("  here, the gateway's own callback thread. A slow continuation would");
        Console.WriteLine("  then block the gateway's internals, and a deadlock is possible if");
        Console.WriteLine("  that thread holds a lock the continuation needs.");
        Console.WriteLine("  It is the single most commonly omitted argument in .NET.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static string[] BuildWorkload(int hitRatePercent, RateCache cache)
    {
        cache.Seed("GBP");
        var workload = new string[100];
        for (var i = 0; i < 100; i++)
            workload[i] = i < hitRatePercent ? "GBP" : $"X{i:D3}";
        return workload;
    }

    static long AllocPerCall(string[] workload, Action<string> call)
    {
        foreach (var c in workload) call(c);          // warm up and populate misses
        GC.Collect();
        GC.WaitForPendingFinalizers();

        var fresh = new string[workload.Length];
        for (var i = 0; i < workload.Length; i++)
            fresh[i] = workload[i] == "GBP" ? "GBP" : $"Y{i:D3}";

        var before = GC.GetAllocatedBytesForCurrentThread();
        foreach (var c in fresh) call(c);
        var after = GC.GetAllocatedBytesForCurrentThread();
        return (after - before) / fresh.Length;
    }
}
