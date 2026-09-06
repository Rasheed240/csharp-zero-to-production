// 03-starvation.cs — thread-pool starvation, produced deliberately and then
// fixed three ways. This is the single most common serious concurrency incident
// in .NET services, and its symptom is latency rather than an error.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-starvation.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int Requests = 200;
    const int DownstreamMs = 100;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        ThreadPool.GetMinThreads(out var minW, out _);
        Console.WriteLine($"pool min worker threads: {minW}");
        Console.WriteLine();
        Console.WriteLine($"{Requests} concurrent 'requests', each calling a downstream service");
        Console.WriteLine($"that takes {DownstreamMs} ms. Perfect concurrency would be ~{DownstreamMs} ms total.");
        Console.WriteLine();

        // 1. Sync-over-async: the handler blocks a pool thread waiting for a
        //    task that itself needs a pool thread to complete.
        var blocking = Measure("blocking on .Result", () =>
        {
            var done = new CountdownEvent(Requests);
            for (var i = 0; i < Requests; i++)
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    HandleBlocking();
                    done.Signal();
                });
            done.Wait();
        });

        // 2. The same work, awaited.
        var asyncRun = Measure("await, no blocking", () =>
        {
            Task.WhenAll(Enumerable.Range(0, Requests).Select(_ => HandleAsync())).GetAwaiter().GetResult();
        });

        // 3. Blocking again, but with the pool minimum raised out of the way.
        ThreadPool.GetMinThreads(out var oldW, out var oldIo);
        ThreadPool.SetMinThreads(Requests + 16, oldIo);
        var blockingBigPool = Measure($"blocking, SetMinThreads({Requests + 16})", () =>
        {
            var done = new CountdownEvent(Requests);
            for (var i = 0; i < Requests; i++)
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    HandleBlocking();
                    done.Signal();
                });
            done.Wait();
        });
        ThreadPool.SetMinThreads(oldW, oldIo);

        Console.WriteLine();
        Console.WriteLine("--- results ---");
        Console.WriteLine();
        Console.WriteLine("  approach                              elapsed     vs ideal   threads at   peak   created");
        Console.WriteLine("                                                                 start          during run");
        foreach (var r in new[] { blocking, asyncRun, blockingBigPool })
            Console.WriteLine($"  {r.name,-36} {r.ms,8:N0} ms {r.ms / DownstreamMs,10:N1}x " +
                              $"{r.startThreads,11}   {r.peakThreads,5}   {r.peakThreads - r.startThreads,8}");
        Console.WriteLine();
        Console.WriteLine("  The 'created during run' column is the one that matters. The pool");
        Console.WriteLine("  retires idle threads slowly, so a later run INHERITS the threads an");
        Console.WriteLine("  earlier one forced into existence. Reporting raw peaks would credit");
        Console.WriteLine("  the async run with threads the blocking run created.");

        Console.WriteLine();
        Console.WriteLine("--- reading that ---");
        Console.WriteLine();
        Console.WriteLine("  BLOCKING is catastrophically slow, and nothing failed. No");
        Console.WriteLine("  exception, no error log, no metric at a limit. Each request");
        Console.WriteLine("  holds a pool thread for the whole downstream call, so the pool");
        Console.WriteLine("  runs out and the rest queue — and new threads arrive at the");
        Console.WriteLine("  ~500 ms cadence measured in 02-injection.cs.");
        Console.WriteLine();
        Console.WriteLine("  AWAIT is close to ideal on a handful of threads, because an");
        Console.WriteLine("  awaiting request occupies no thread at all while it waits.");
        Console.WriteLine();
        Console.WriteLine("  SetMinThreads makes the blocking version fast again, and it is");
        Console.WriteLine("  a workaround rather than a fix:");
        Console.WriteLine("    - it needs a number you had to guess");
        Console.WriteLine("    - it is wrong the moment concurrency exceeds that number");
        Console.WriteLine("    - the threads are still blocked, merely more of them");
        Console.WriteLine("    - and each one costs the memory t2-01 measured");
        Console.WriteLine("  It is the right EMERGENCY lever and the wrong permanent answer.");

        Console.WriteLine();
        Console.WriteLine("--- the tell, if you are looking at a live process ---");
        Console.WriteLine("  During the blocking run the counters read like this:");
        Console.WriteLine($"    ThreadPool.ThreadCount        climbing slowly, well past {Environment.ProcessorCount}");
        Console.WriteLine("    ThreadPool.PendingWorkItemCount   large and not shrinking");
        Console.WriteLine("    CPU                               low");
        Console.WriteLine("  Threads going up, queue not going down, CPU idle. That exact");
        Console.WriteLine("  combination is starvation and almost nothing else.");
    }

    /// <summary>A downstream call. Async all the way down, as a real client would be.</summary>
    static async Task<int> CallDownstreamAsync()
    {
        await Task.Delay(DownstreamMs).ConfigureAwait(false);
        return 1;
    }

    /// <summary>The bug: a synchronous handler blocking on an async call.</summary>
    static void HandleBlocking() => CallDownstreamAsync().GetAwaiter().GetResult();

    static async Task HandleAsync() => await CallDownstreamAsync().ConfigureAwait(false);

    static (string name, double ms, int startThreads, int peakThreads) Measure(string name, Action run)
    {
        // Let the pool settle between runs so each measurement starts fairly.
        Thread.Sleep(1_000);
        var start = ThreadPool.ThreadCount;
        var peak = start;
        using var sampler = new Timer(_ =>
        {
            var n = ThreadPool.ThreadCount;
            if (n > peak) peak = n;
        }, null, 0, 10);

        var sw = Stopwatch.StartNew();
        run();
        sw.Stop();
        Console.WriteLine($"  {name,-36} done in {sw.Elapsed.TotalMilliseconds:N0} ms");
        return (name, sw.Elapsed.TotalMilliseconds, start, peak);
    }
}
