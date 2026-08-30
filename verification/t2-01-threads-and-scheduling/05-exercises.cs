// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-exercises.cs -c Release
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
        Console.WriteLine("===== Exercise 1: which one scales past the core count? =====");
        // The TOTAL work is fixed and split across the threads. Giving every
        // thread the same amount would measure "more work takes longer", which
        // is what an earlier version of this file did.
        const long CpuTotal = 120_000_000;
        const int IoTotalSleeps = 16;
        Console.WriteLine("  threads    CPU-bound      I/O-bound");
        double cpuBase = 0, ioBase = 0;
        foreach (var n in new[] { 1, 4, 16 })
        {
            var cpuPer = CpuTotal / n;
            var ioPer = IoTotalSleeps / n;
            var cpu = Time(() => Run(n, () => Burn(cpuPer)));
            var io = Time(() => Run(n, () => { for (var k = 0; k < ioPer; k++) Thread.Sleep(100); }));
            if (n == 1) { cpuBase = cpu; ioBase = io; }
            Console.WriteLine($"  {n,7}   {cpuBase / cpu,7:N2}x      {ioBase / io,7:N2}x");
        }
        Console.WriteLine("  CPU-bound saturates. I/O-bound scales linearly, because a");
        Console.WriteLine("  sleeping thread is not competing for a core.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: why is it not 8x on 8 processors? =====");
        var one = Time(() => Run(1, () => Burn(60_000_000)));
        var eight = Time(() => Run(8, () => Burn(60_000_000 / 8)));
        Console.WriteLine($"  1 thread  : {one,7:N0} ms");
        Console.WriteLine($"  8 threads : {eight,7:N0} ms");
        Console.WriteLine($"  speedup   : {one / eight,7:N2}x on {Environment.ProcessorCount} logical processors");
        Console.WriteLine("  Logical != physical. 8 logical is usually 4 cores with SMT, and");
        Console.WriteLine("  two threads on one core share its execution units.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: foreground vs background =====");
        var fg = new Thread(() => Thread.Sleep(300)) { IsBackground = false };
        var bg = new Thread(() => Thread.Sleep(300)) { IsBackground = true };
        Console.WriteLine($"  new Thread(...) default IsBackground : " +
                          $"{new Thread(() => { }).IsBackground}");
        Console.WriteLine($"  a thread-pool thread IsBackground    : {PoolThreadIsBackground()}");
        Console.WriteLine($"  Task.Run thread IsBackground         : " +
                          $"{Task.Run(() => Thread.CurrentThread.IsBackground).Result}");
        fg.Start(); bg.Start(); fg.Join(); bg.Join();
        Console.WriteLine("  A foreground thread keeps the process alive after Main returns;");
        Console.WriteLine("  a background one does not. Pool threads are always background,");
        Console.WriteLine("  which is why Task.Run work can be cut off at shutdown.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: sizing for a mixed workload =====");
        // 90% waiting, 10% CPU — a typical service request.
        const int Requests = 64;
        Console.WriteLine($"  {Requests} requests, each 90 ms waiting + 10 ms of CPU");
        Console.WriteLine();
        Console.WriteLine("  workers   elapsed ms   throughput/s");
        foreach (var workers in new[] { 4, 8, 16, 32, 64 })
        {
            var ms = Time(() =>
            {
                var per = Requests / workers;
                Run(workers, () =>
                {
                    for (var i = 0; i < per; i++) { Thread.Sleep(90); Burn(9_000_000); }
                });
            });
            Console.WriteLine($"  {workers,7}   {ms,10:N0}   {Requests / (ms / 1000),12:N0}");
        }
        Console.WriteLine();
        Console.WriteLine("  The best worker count is far above the core count, because most");
        Console.WriteLine("  of each request is waiting — but it is NOT unbounded: past the");
        Console.WriteLine("  point where the CPU slice saturates, more workers add nothing.");
        Console.WriteLine("  The ratio of wait to work is what sets the number, and it is");
        Console.WriteLine("  why a single 'threads = cores' rule is wrong for a web service.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static bool PoolThreadIsBackground()
    {
        var result = false;
        using var done = new ManualResetEventSlim(false);
        ThreadPool.QueueUserWorkItem(_ =>
        {
            result = Thread.CurrentThread.IsBackground;
            done.Set();
        });
        done.Wait();
        return result;
    }

    static void Run(int threadCount, Action body)
    {
        var threads = new Thread[threadCount];
        var start = new ManualResetEventSlim(false);
        for (var i = 0; i < threadCount; i++)
        {
            threads[i] = new Thread(() => { start.Wait(); body(); }) { IsBackground = true };
            threads[i].Start();
        }
        start.Set();
        foreach (var t in threads) t.Join();
    }

    static double Time(Action a)
    {
        var sw = Stopwatch.StartNew();
        a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static void Burn(long iterations)
    {
        long acc = 0;
        for (long i = 0; i < iterations; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }
}
