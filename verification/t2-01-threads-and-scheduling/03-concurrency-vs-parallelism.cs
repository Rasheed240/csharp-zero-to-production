// 03-concurrency-vs-parallelism.cs — the distinction the rest of this track
// depends on, measured rather than defined. Same thread count, two kinds of
// work, opposite results.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-concurrency-vs-parallelism.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;
    const int Items = 32;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}, work items: {Items}");
        Console.WriteLine();

        Console.WriteLine("=== CPU-BOUND work: threads buy PARALLELISM, up to the core count ===");
        Console.WriteLine();
        Console.WriteLine("  threads   elapsed ms   vs 1 thread");
        double cpuBaseline = 0;
        foreach (var n in new[] { 1, 2, 4, 8, 16, 32 })
        {
            var ms = RunCpuBound(n);
            if (n == 1) cpuBaseline = ms;
            Console.WriteLine($"  {n,7}   {ms,10:N0}   {cpuBaseline / ms,10:N2}x");
        }
        Console.WriteLine();
        Console.WriteLine("  It stops improving because the CPU is the limit. Adding threads");
        Console.WriteLine("  cannot create cores. The row-to-row wobble past 8 is scheduler");
        Console.WriteLine("  noise and share-claiming, not parallelism — run it twice and the");
        Console.WriteLine("  ordering of the last three rows changes. What does not change is");
        Console.WriteLine("  that none of them come close to 8x.");

        Console.WriteLine();
        Console.WriteLine("=== I/O-BOUND work: threads buy CONCURRENCY, and it scales far past ===");
        Console.WriteLine();
        Console.WriteLine("  threads   elapsed ms   vs 1 thread");
        double ioBaseline = 0;
        foreach (var n in new[] { 1, 2, 4, 8, 16, 32 })
        {
            var ms = RunIoBound(n);
            if (n == 1) ioBaseline = ms;
            Console.WriteLine($"  {n,7}   {ms,10:N0}   {ioBaseline / ms,10:N2}x");
        }
        Console.WriteLine();
        Console.WriteLine($"  {Items} items x 100 ms of WAITING. One thread takes {Items} x 100 ms;");
        Console.WriteLine($"  {Items} threads take about 100 ms — and the speedup went far past");
        Console.WriteLine($"  {Environment.ProcessorCount} cores, because none of those threads needed a core.");
        Console.WriteLine("  They were blocked, and the OS does not schedule a blocked thread.");

        Console.WriteLine();
        Console.WriteLine("=== the same I/O work with NO extra threads at all ===");
        var blockingMs = RunIoBound(Items);
        var threadsDuringBlocking = _peakDuringBlocking;

        var threadsBefore = OsThreads();
        var peak = threadsBefore;
        using (var sampler = new Timer(_ => { var n = OsThreads(); if (n > peak) peak = n; },
                                       null, 0, 5))
        {
            var sw2 = Stopwatch.StartNew();
            RunIoAsync().GetAwaiter().GetResult();
            sw2.Stop();
            Console.WriteLine($"  blocking, {Items} threads : {blockingMs,6:N0} ms, " +
                              $"OS threads peaked at {threadsDuringBlocking}");
            Console.WriteLine($"  async,    {Items} tasks   : {sw2.Elapsed.TotalMilliseconds,6:N0} ms, " +
                              $"OS threads peaked at {peak}");
        }
        Console.WriteLine($"  threads saved : {threadsDuringBlocking - peak}");
        Console.WriteLine("  Same elapsed time, without the threads.");
        Console.WriteLine("  That is the whole argument for async, and t2-03 is about the");
        Console.WriteLine("  mechanism. The point here is only that CONCURRENCY and");
        Console.WriteLine("  PARALLELISM are different things:");
        Console.WriteLine("    parallelism  = doing several things at the same INSTANT");
        Console.WriteLine("                   (needs cores; capped by them)");
        Console.WriteLine("    concurrency  = having several things IN PROGRESS at once");
        Console.WriteLine("                   (needs no cores at all if they are waiting)");

        Console.WriteLine();
        Console.WriteLine("=== proof that blocked threads are not running ===");
        var burnStart = Stopwatch.StartNew();
        Burn(120_000_000);
        burnStart.Stop();
        var soloBurn = burnStart.Elapsed.TotalMilliseconds;

        var blockers = new Thread[64];
        var gate = new ManualResetEventSlim(false);
        for (var i = 0; i < blockers.Length; i++)
        {
            blockers[i] = new Thread(() => gate.Wait()) { IsBackground = true };
            blockers[i].Start();
        }
        Thread.Sleep(200);
        burnStart.Restart();
        Burn(120_000_000);
        burnStart.Stop();
        gate.Set();
        foreach (var t in blockers) t.Join();

        Console.WriteLine($"  CPU work alone                    : {soloBurn:N0} ms");
        Console.WriteLine($"  same work, 64 BLOCKED threads too : {burnStart.Elapsed.TotalMilliseconds:N0} ms");
        Console.WriteLine($"  slowdown                          : {burnStart.Elapsed.TotalMilliseconds / soloBurn:N2}x");
        Console.WriteLine("  Near 1.0x. A thread waiting on a lock, a socket or a sleep");
        Console.WriteLine("  costs memory, not CPU. Compare that with 64 threads all");
        Console.WriteLine("  RUNNING, in 02-cost-of-threads.cs, which cost plenty.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static double RunCpuBound(int threadCount)
    {
        var perThread = Items / threadCount;
        var work = new Thread[threadCount];
        var start = new ManualResetEventSlim(false);
        for (var i = 0; i < threadCount; i++)
        {
            work[i] = new Thread(() =>
            {
                start.Wait();
                for (var k = 0; k < perThread; k++) Burn(8_000_000);
            })
            { IsBackground = true };
            work[i].Start();
        }
        var sw = Stopwatch.StartNew();
        start.Set();
        foreach (var t in work) t.Join();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static int _peakDuringBlocking;

    static int OsThreads()
    {
        var p = Process.GetCurrentProcess();
        p.Refresh();
        return p.Threads.Count;
    }

    static double RunIoBound(int threadCount)
    {
        var perThread = Items / threadCount;
        var work = new Thread[threadCount];
        var start = new ManualResetEventSlim(false);
        for (var i = 0; i < threadCount; i++)
        {
            work[i] = new Thread(() =>
            {
                start.Wait();
                // Thread.Sleep stands in for a blocking network or disk call:
                // the thread is alive, holding its stack, and not runnable.
                for (var k = 0; k < perThread; k++) Thread.Sleep(100);
            })
            { IsBackground = true };
            work[i].Start();
        }
        var sw = Stopwatch.StartNew();
        start.Set();
        Thread.Sleep(20);
        var n = OsThreads();
        if (n > _peakDuringBlocking) _peakDuringBlocking = n;
        foreach (var t in work) t.Join();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static async Task RunIoAsync()
    {
        var tasks = new Task[Items];
        for (var i = 0; i < Items; i++) tasks[i] = Task.Delay(100);
        await Task.WhenAll(tasks);
    }

    static void Burn(long iterations)
    {
        long acc = 0;
        for (long i = 0; i < iterations; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }
}
