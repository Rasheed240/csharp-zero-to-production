// 02-valuetask.cs — what ValueTask saves, when it saves nothing, and the four
// rules that make it dangerous. The allocation numbers are the whole argument.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-valuetask.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static readonly Dictionary<string, decimal> Cache = new()
    {
        ["GBP"] = 1.00m, ["EUR"] = 1.17m, ["USD"] = 1.27m
    };

    static long _sink;

    static void Main()
    {
        Console.WriteLine("--- the shape ValueTask exists for: a cache that usually hits ---");
        Console.WriteLine();
        Console.WriteLine("  A lookup that finds the value in memory has nothing to await, but");
        Console.WriteLine("  its signature must stay awaitable because sometimes it misses.");
        Console.WriteLine();

        const int N = 1_000_000;

        var taskAlloc = AllocPerCall(() => { _sink += GetRateTask("GBP").GetAwaiter().GetResult() > 0 ? 1 : 0; });
        var valueAlloc = AllocPerCall(() => { _sink += GetRateValueTask("GBP").GetAwaiter().GetResult() > 0 ? 1 : 0; });
        var syncAlloc = AllocPerCall(() => { _sink += GetRateSync("GBP") > 0 ? 1 : 0; });

        Console.WriteLine("  ALL CACHE HITS (nothing suspends):");
        Console.WriteLine($"    plain synchronous method   : {syncAlloc,5} bytes/call");
        Console.WriteLine($"    Task<decimal>              : {taskAlloc,5} bytes/call");
        Console.WriteLine($"    ValueTask<decimal>         : {valueAlloc,5} bytes/call");
        Console.WriteLine();
        Console.WriteLine($"  At {N:N0} calls/second that is " +
                          $"{taskAlloc * (long)N / 1024 / 1024:N0} MB/s of garbage against " +
                          $"{valueAlloc * (long)N / 1024 / 1024:N0} MB/s.");

        Console.WriteLine();
        Console.WriteLine("--- and when it actually suspends, the saving disappears ---");
        var taskMiss = AllocPerCall(() => { _sink += GetRateTask("JPY").GetAwaiter().GetResult() > 0 ? 1 : 0; });
        var valueMiss = AllocPerCall(() => { _sink += GetRateValueTask("JPY").GetAwaiter().GetResult() > 0 ? 1 : 0; });
        Console.WriteLine("  ALL CACHE MISSES (every call awaits):");
        Console.WriteLine($"    Task<decimal>              : {taskMiss,5} bytes/call");
        Console.WriteLine($"    ValueTask<decimal>         : {valueMiss,5} bytes/call");
        Console.WriteLine("  A ValueTask that has to suspend allocates the state machine anyway,");
        Console.WriteLine("  and boxes itself on top. It is WORSE than Task on this path.");
        Console.WriteLine("  The whole bet is that the synchronous path dominates.");

        Console.WriteLine();
        Console.WriteLine("--- speed, not only allocation ---");
        var tTask = Time(() => { for (var i = 0; i < 200_000; i++) _sink += GetRateTask("GBP").GetAwaiter().GetResult() > 0 ? 1 : 0; });
        var tValue = Time(() => { for (var i = 0; i < 200_000; i++) _sink += GetRateValueTask("GBP").GetAwaiter().GetResult() > 0 ? 1 : 0; });
        Console.WriteLine($"  200,000 cache hits via Task      : {tTask,6:N0} ms");
        Console.WriteLine($"  200,000 cache hits via ValueTask : {tValue,6:N0} ms  ({tTask / tValue:N2}x)");

        Console.WriteLine();
        Console.WriteLine("=== the rules, demonstrated ===");

        Console.WriteLine();
        Console.WriteLine("--- rule 1: await it ONCE ---");
        var vt = GetRateValueTask("JPY");
        var first = vt.GetAwaiter().GetResult();
        Console.WriteLine($"  first await  : {first}");
        try
        {
            var second = vt.GetAwaiter().GetResult();
            Console.WriteLine($"  second await : {second}  (happened to work — see below)");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  second await : {ex.GetType().Name}");
        }
        Console.WriteLine("  A ValueTask backed by a POOLED IValueTaskSource may have been");
        Console.WriteLine("  recycled and now represent a different operation. Whether it");
        Console.WriteLine("  throws, returns a stale value, or returns someone else's value");
        Console.WriteLine("  depends on the implementation — which is exactly why the rule is");
        Console.WriteLine("  'once', not 'once unless it seems fine'.");

        Console.WriteLine();
        Console.WriteLine("--- rule 2: do not block on it ---");
        Console.WriteLine("  ValueTask has no .Wait(), and .Result on an incomplete one is");
        Console.WriteLine("  undefined rather than blocking. To block safely you must convert:");
        var converted = GetRateValueTask("JPY").AsTask();
        Console.WriteLine($"  AsTask().Result : {converted.Result}");
        Console.WriteLine("  AsTask() allocates the Task you were avoiding — correct, and it");
        Console.WriteLine("  means blocking on a ValueTask costs more than using Task would.");

        Console.WriteLine();
        Console.WriteLine("--- rule 3: do not await it concurrently ---");
        Console.WriteLine("  Two threads awaiting one ValueTask is a data race on the backing");
        Console.WriteLine("  source. Task supports this; ValueTask does not. If you need to");
        Console.WriteLine("  hand the same pending operation to several consumers, use Task.");

        Console.WriteLine();
        Console.WriteLine("--- rule 4: store the RESULT, never the ValueTask ---");
        Console.WriteLine("  A field of type ValueTask<T> outlives the safe window by design.");
        Console.WriteLine("  Await it immediately and keep the value, or call AsTask().");

        Console.WriteLine();
        Console.WriteLine("--- Task supports everything ValueTask forbids ---");
        var shared = GetRateTask("JPY");
        var a = shared.GetAwaiter().GetResult();
        var b = shared.GetAwaiter().GetResult();
        var c = shared.Result;
        Console.WriteLine($"  awaited three times : {a}, {b}, {c}  — all fine");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static decimal GetRateSync(string currency)
        => Cache.TryGetValue(currency, out var rate) ? rate : 0.5m;

    static async Task<decimal> GetRateTask(string currency)
    {
        if (Cache.TryGetValue(currency, out var rate)) return rate;
        await Task.Yield();                     // stands in for a real lookup
        return 0.5m;
    }

    static async ValueTask<decimal> GetRateValueTask(string currency)
    {
        if (Cache.TryGetValue(currency, out var rate)) return rate;
        await Task.Yield();
        return 0.5m;
    }

    static long AllocPerCall(Action a)
    {
        for (var i = 0; i < 1_000; i++) a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        const int Reps = 10_000;
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i < Reps; i++) a();
        var after = GC.GetAllocatedBytesForCurrentThread();
        return (after - before) / Reps;
    }

    static double Time(Action a)
    {
        a();
        var sw = Stopwatch.StartNew();
        a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }
}
