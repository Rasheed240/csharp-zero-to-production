// 05-production.cs — the Ledger incident this module exists to explain, with the
// counters an on-call engineer would actually read, and the three candidate
// fixes measured against each other.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Api;

/// <summary>A gateway client. Async all the way down, as a real HTTP client is.</summary>
public sealed class PaymentGateway
{
    public async Task<string> AuthoriseAsync(string reference, CancellationToken ct = default)
    {
        await Task.Delay(90, ct).ConfigureAwait(false);
        return "AUTH-" + reference;
    }
}

public sealed class RateService
{
    private readonly PaymentGateway _gateway = new();

    /// <summary>THE BUG. A synchronous method blocking on an async call.</summary>
    public string GetRateSync(string reference)
        => _gateway.AuthoriseAsync(reference).GetAwaiter().GetResult();

    public Task<string> GetRateAsync(string reference, CancellationToken ct = default)
        => _gateway.AuthoriseAsync(reference, ct);
}

class Program
{
    const int Concurrency = 150;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        ThreadPool.GetMinThreads(out var minW, out var minIo);
        Console.WriteLine($"pool minimum: {minW} worker threads");
        Console.WriteLine();
        Console.WriteLine($"{Concurrency} concurrent requests, each one gateway call of 90 ms.");
        Console.WriteLine("An ideal server answers all of them in a bit over 90 ms.");
        Console.WriteLine();

        var service = new RateService();

        var bad = Run("blocking", () => Blocking(service));

        ThreadPool.SetMinThreads(Concurrency + 16, minIo);
        var lever = Run("blocking + SetMinThreads", () => Blocking(service));
        ThreadPool.SetMinThreads(minW, minIo);

        var good = Run("async", () => Async(service));

        Console.WriteLine();
        Console.WriteLine("--- side by side ---");
        Console.WriteLine();
        Console.WriteLine("  approach                    p50 ms    p99 ms    max ms   total ms   threads created");
        foreach (var r in new[] { bad, lever, good })
            Console.WriteLine($"  {r.name,-24} {r.p50,8:N0}  {r.p99,8:N0}  {r.max,8:N0}   {r.total,8:N0}   {r.created,15}");

        Console.WriteLine();
        Console.WriteLine("--- what an on-call engineer sees ---");
        Console.WriteLine();
        Console.WriteLine("  The blocking service is not DOWN. It returns correct answers, logs");
        Console.WriteLine("  no errors, and uses almost no CPU. Health checks pass.");
        Console.WriteLine();
        Console.WriteLine("  The symptom is the gap between p50 and p99. The first handful of");
        Console.WriteLine("  requests find a free pool thread and return in about 90 ms. The");
        Console.WriteLine("  rest queue, and wait for the pool to grow at roughly two threads");
        Console.WriteLine("  per second — the cadence measured in 02-injection.cs.");
        Console.WriteLine();
        Console.WriteLine("  SetMinThreads collapses that gap without fixing anything: the");
        Console.WriteLine("  threads are still blocked, there are merely enough of them. It is");
        Console.WriteLine("  the right lever at 3 a.m. and the wrong permanent answer, because");
        Console.WriteLine("  the number is a guess that is wrong at the next traffic level.");
        Console.WriteLine();
        Console.WriteLine("  The async version needs no new threads at all.");
        Console.WriteLine();
        Console.WriteLine("--- the diagnosis, in order ---");
        Console.WriteLine();
        Console.WriteLine("  1. dotnet-counters monitor --process-id <pid> System.Runtime");
        Console.WriteLine("       ThreadPool Thread Count    rising, far past processor count");
        Console.WriteLine("       ThreadPool Queue Length    large, not draining");
        Console.WriteLine("       CPU Usage                  low");
        Console.WriteLine("     Threads up, queue up, CPU down. Nothing else looks like that.");
        Console.WriteLine();
        Console.WriteLine("  2. dotnet-dump collect -p <pid>, then 'clrstack -all'");
        Console.WriteLine("     Dozens of identical stacks ending in GetAwaiter().GetResult(),");
        Console.WriteLine("     .Result or .Wait(). The frame above names the method to fix.");
        Console.WriteLine();
        Console.WriteLine("  3. Fix that method, and every caller above it, up to the entry");
        Console.WriteLine("     point. Async does not work halfway: one blocking frame anywhere");
        Console.WriteLine("     in the chain reintroduces the whole problem.");
    }

    static double[] Blocking(RateService service)
    {
        var latencies = new double[Concurrency];
        var done = new CountdownEvent(Concurrency);
        for (var i = 0; i < Concurrency; i++)
        {
            var n = i;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                var sw = Stopwatch.StartNew();
                service.GetRateSync($"P-{n}");
                sw.Stop();
                latencies[n] = sw.Elapsed.TotalMilliseconds;
                done.Signal();
            });
        }
        done.Wait();
        return latencies;
    }

    static double[] Async(RateService service)
    {
        var latencies = new double[Concurrency];
        var tasks = Enumerable.Range(0, Concurrency).Select(async n =>
        {
            var sw = Stopwatch.StartNew();
            await service.GetRateAsync($"P-{n}").ConfigureAwait(false);
            sw.Stop();
            latencies[n] = sw.Elapsed.TotalMilliseconds;
        });
        Task.WhenAll(tasks).GetAwaiter().GetResult();
        return latencies;
    }

    static (string name, double p50, double p99, double max, double total, int created)
        Run(string name, Func<double[]> run)
    {
        Thread.Sleep(1_000);
        var startThreads = ThreadPool.ThreadCount;
        var peak = startThreads;
        using var sampler = new Timer(_ =>
        {
            var n = ThreadPool.ThreadCount;
            if (n > peak) peak = n;
        }, null, 0, 10);

        var sw = Stopwatch.StartNew();
        var latencies = run();
        sw.Stop();

        Array.Sort(latencies);
        var p50 = latencies[latencies.Length / 2];
        var p99 = latencies[(int)(latencies.Length * 0.99)];
        var max = latencies[^1];

        Console.WriteLine($"=== {name} ===");
        Console.WriteLine($"  elapsed        : {sw.Elapsed.TotalMilliseconds:N0} ms");
        Console.WriteLine($"  per-request    : p50 {p50:N0} ms, p99 {p99:N0} ms, max {max:N0} ms");
        Console.WriteLine($"  threads        : {startThreads} before, {peak} peak " +
                          $"(created: {peak - startThreads})");
        Console.WriteLine($"  queue at end   : {ThreadPool.PendingWorkItemCount}");
        Console.WriteLine();

        return (name, p50, p99, max, sw.Elapsed.TotalMilliseconds, peak - startThreads);
    }
}
