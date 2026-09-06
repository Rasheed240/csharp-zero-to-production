// 04-queues.cs — the pool is not one queue. There is a global queue and a local
// queue per worker, and `preferLocal` chooses between them.
//
// A NOTE ON WHAT THIS FILE DOES NOT DO. An earlier version tried to demonstrate
// the local queue's LIFO ordering by queueing ten numbered items and printing
// the order they ran in. It printed "7, 1, 3, 6, 2, 0, 5, 4, 9, 8" — scrambled,
// because eight workers grab items concurrently and the ordering of a single
// queue is not observable from outside. The ordering below is stated as
// documented runtime behaviour, not as something measured here. What IS measured
// is the cost difference and work stealing.
//
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-queues.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        Console.WriteLine();

        Console.WriteLine("--- the structure ---");
        Console.WriteLine("  ONE global queue, shared by every worker, FIFO. Work queued from");
        Console.WriteLine("  a non-pool thread goes here.");
        Console.WriteLine("  ONE local queue per worker, LIFO. Work queued from INSIDE a pool");
        Console.WriteLine("  thread goes to that thread's own queue by default.");
        Console.WriteLine();
        Console.WriteLine("  LIFO looks unfair and is deliberate: work a thread queues is");
        Console.WriteLine("  usually the continuation of what it has this moment done, so the newest");
        Console.WriteLine("  has the warmest cache. Fairness is not the goal; throughput is.");

        Console.WriteLine();
        Console.WriteLine("--- preferLocal, under contention from several threads ---");
        const int PerThread = 100_000;
        var producers = Environment.ProcessorCount;

        var global = TimeProducers(producers, PerThread, preferLocal: false);
        var local = TimeProducers(producers, PerThread, preferLocal: true);

        var total = producers * PerThread;
        Console.WriteLine($"  {producers} producer threads x {PerThread:N0} items = {total:N0} items");
        Console.WriteLine($"    preferLocal: false (global queue) : {global,7:N0} ms " +
                          $"({global * 1_000_000 / total:N0} ns each)");
        Console.WriteLine($"    preferLocal: true  (local queue)  : {local,7:N0} ms " +
                          $"({local * 1_000_000 / total:N0} ns each)");
        Console.WriteLine($"    ratio : {global / local:N2}x");
        Console.WriteLine();
        Console.WriteLine("  The local queue exists to avoid contention on the shared one.");
        Console.WriteLine("  Whether that shows up depends entirely on how contended the");
        Console.WriteLine("  global queue actually is — with a small number of producers it");
        Console.WriteLine("  is close to a wash, and this is a number worth re-measuring on");
        Console.WriteLine("  your own hardware rather than assuming.");

        Console.WriteLine();
        Console.WriteLine("--- work stealing, which IS clearly observable ---");
        var counts = new ConcurrentDictionary<int, int>();
        var finished = new CountdownEvent(1);
        Task.Run(() =>
        {
            // All 4,000 items are queued by ONE pool thread, so they all land in
            // that one thread's local queue. Without stealing, one thread would
            // do all of them.
            var inner = new CountdownEvent(4_000);
            for (var i = 0; i < 4_000; i++)
            {
                ThreadPool.UnsafeQueueUserWorkItem(_ =>
                {
                    counts.AddOrUpdate(Environment.CurrentManagedThreadId, 1, (_, c) => c + 1);
                    Spin(20_000);
                    inner.Signal();
                }, null);
            }
            inner.Wait();
            finished.Signal();
        });
        finished.Wait();

        var shares = new List<int>();
        foreach (var kv in counts) shares.Add(kv.Value);
        shares.Sort((a, b) => b.CompareTo(a));
        Console.WriteLine($"  4,000 items, all queued by ONE pool thread");
        Console.WriteLine($"  ran on {counts.Count} distinct threads");
        Console.WriteLine($"  per-thread shares : {string.Join(", ", shares)}");
        Console.WriteLine();
        Console.WriteLine("  If a local queue were private to its owner, that would read");
        Console.WriteLine("  '4000' and nothing else. The even spread IS the stealing: idle");
        Console.WriteLine("  workers take from the busy worker's queue, from the opposite end,");
        Console.WriteLine("  so the owner keeps its cache-warm newest items and the thief");
        Console.WriteLine("  takes the oldest and coldest.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static double TimeProducers(int producers, int perThread, bool preferLocal)
    {
        Run();                       // warm up
        Thread.Sleep(200);
        var sw = Stopwatch.StartNew();
        Run();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;

        void Run()
        {
            var done = new CountdownEvent(producers * perThread);
            var tasks = new Task[producers];
            for (var p = 0; p < producers; p++)
            {
                tasks[p] = Task.Run(() =>
                {
                    for (var i = 0; i < perThread; i++)
                        ThreadPool.UnsafeQueueUserWorkItem(
                            static s => ((CountdownEvent)s!).Signal(), done, preferLocal);
                });
            }
            Task.WaitAll(tasks);
            done.Wait();
        }
    }

    static void Spin(int n)
    {
        long acc = 0;
        for (var i = 0; i < n; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }
}
