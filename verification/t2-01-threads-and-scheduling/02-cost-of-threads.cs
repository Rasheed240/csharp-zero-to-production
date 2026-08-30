// 02-cost-of-threads.cs — the three costs of a thread: creating one, the memory
// it holds, and the context switches it causes. These numbers are why the thread
// pool exists and why "just add threads" stops working.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-cost-of-threads.cs -c Release
#:property Nullable=enable

using System;
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

        Console.WriteLine("--- 1. creating a thread ---");
        const int N = 1_000;

        var sw = Stopwatch.StartNew();
        for (var i = 0; i < N; i++)
        {
            var t = new Thread(static () => { }) { IsBackground = true };
            t.Start();
            t.Join();
        }
        sw.Stop();
        var perThread = sw.Elapsed.TotalMilliseconds * 1_000 / N;
        Console.WriteLine($"  new Thread + Start + Join : {perThread:N1} us each ({N:N0} threads)");

        // Warm the pool so this measures dispatch, not thread injection.
        for (var i = 0; i < 200; i++) ThreadPool.QueueUserWorkItem(static _ => { });
        Thread.Sleep(200);

        sw.Restart();
        for (var i = 0; i < N; i++)
        {
            using var done = new ManualResetEventSlim(false);
            ThreadPool.QueueUserWorkItem(static s => ((ManualResetEventSlim)s!).Set(), done);
            done.Wait();
        }
        sw.Stop();
        var perQueue = sw.Elapsed.TotalMilliseconds * 1_000 / N;
        Console.WriteLine($"  ThreadPool.QueueUserWorkItem : {perQueue:N1} us each");
        Console.WriteLine($"  ratio                        : {perThread / perQueue:N0}x");
        Console.WriteLine("  A pooled thread already exists. That whole difference is");
        Console.WriteLine("  creation and teardown, and it is the reason for the pool.");

        Console.WriteLine();
        Console.WriteLine("--- 2. memory held by idle threads ---");
        var before = GC.GetTotalMemory(true);
        var beforeWorkingSet = Process.GetCurrentProcess().WorkingSet64;

        const int Idle = 500;
        var gate = new ManualResetEventSlim(false);
        var threads = new Thread[Idle];
        for (var i = 0; i < Idle; i++)
        {
            threads[i] = new Thread(() => gate.Wait(), maxStackSize: 0) { IsBackground = true };
            threads[i].Start();
        }
        Thread.Sleep(500);

        var afterWorkingSet = Process.GetCurrentProcess().WorkingSet64;
        var afterManaged = GC.GetTotalMemory(false);
        Console.WriteLine($"  {Idle} idle threads");
        Console.WriteLine($"    managed heap growth : {(afterManaged - before) / 1024:N0} KB " +
                          $"({(afterManaged - before) / Idle:N0} bytes each)");
        Console.WriteLine($"    working set growth  : {(afterWorkingSet - beforeWorkingSet) / 1024:N0} KB " +
                          $"({(afterWorkingSet - beforeWorkingSet) / Idle / 1024:N0} KB each)");
        Console.WriteLine("  The managed object is tiny. The working set is the committed");
        Console.WriteLine("  stack pages plus kernel bookkeeping — far less than the 1 MB");
        Console.WriteLine("  reserved, because untouched stack pages are never committed.");
        gate.Set();
        foreach (var t in threads) t.Join();

        Console.WriteLine();
        Console.WriteLine("--- 3. context switching: same work, more threads ---");
        Console.WriteLine("  Total work is FIXED. Only the number of threads changes.");
        Console.WriteLine();
        Console.WriteLine("  threads   elapsed ms   vs 1 thread   OS threads mid-run");
        const long TotalIterations = 240_000_000;
        double baseline = 0;
        foreach (var threadCount in new[] { 1, 2, 4, 8, 16, 64, 256, 1024, 4096 })
        {
            var per = TotalIterations / threadCount;
            var ts = new Thread[threadCount];
            var start = new ManualResetEventSlim(false);
            for (var i = 0; i < threadCount; i++)
            {
                ts[i] = new Thread(() => { start.Wait(); Burn(per); }) { IsBackground = true };
                ts[i].Start();
            }
            var w = Stopwatch.StartNew();
            start.Set();
            // Sample while the work is actually running, not after Join.
            Thread.Sleep(20);
            var osThreads = OsThreadCount();
            foreach (var t in ts) t.Join();
            w.Stop();
            if (threadCount == 1) baseline = w.Elapsed.TotalMilliseconds;
            Console.WriteLine($"  {threadCount,7}   {w.Elapsed.TotalMilliseconds,10:N0}   " +
                              $"{baseline / w.Elapsed.TotalMilliseconds,10:N2}x   {osThreads,10:N0}");
        }
        Console.WriteLine();
        Console.WriteLine("  Three things in that table are worth more than the headline.");
        Console.WriteLine();
        Console.WriteLine($"  1. Peak speedup is well under {Environment.ProcessorCount}x, on a machine reporting");
        Console.WriteLine($"     {Environment.ProcessorCount} processors. ProcessorCount counts LOGICAL processors;");
        Console.WriteLine("     8 logical is typically 4 physical cores with SMT, and a second");
        Console.WriteLine("     thread on one core shares its execution units rather than");
        Console.WriteLine("     doubling it. Sizing a pool from ProcessorCount assumes a");
        Console.WriteLine("     linearity that does not exist.");
        Console.WriteLine();
        Console.WriteLine("  2. Past the core count it keeps improving slightly, up to about");
        Console.WriteLine("     64 threads. That is not extra parallelism — it is this process");
        Console.WriteLine("     claiming a larger share of the scheduler against everything");
        Console.WriteLine("     else running on the machine. It is real, and it is rude.");
        Console.WriteLine();
        Console.WriteLine("  3. Then it collapses. At 4,096 threads the SAME work takes");
        Console.WriteLine("     longer than it did on 4 threads. Nothing about the work");
        Console.WriteLine("     changed; all of that is scheduling overhead.");
        Console.WriteLine();
        Console.WriteLine("  The OS-thread column is sampled while the work runs, and shows");
        Console.WriteLine("  the process really is holding them. It is NOT a context-switch");
        Console.WriteLine("  count: that needs ETW or an elevated performance counter, so the");
        Console.WriteLine("  switching cost here is inferred from the timings.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // The OS thread count while the work is running. NOT a context-switch count:
    // Windows exposes those through ETW or a performance counter needing
    // elevation, and neither belongs in a file you run with `dotnet run`. The
    // switching is inferred from the timings, not measured here.
    static int OsThreadCount()
    {
        var p = Process.GetCurrentProcess();
        p.Refresh();
        return p.Threads.Count;
    }

    static void Burn(long iterations)
    {
        long acc = 0;
        for (long i = 0; i < iterations; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }
}
