// 06-yielding.cs — the four ways to stop using a core, and what each one
// actually does. These are the primitives every lock, pool and await is built
// from, and choosing wrongly is how a "wait" burns a core.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 06-yielding.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

class Program
{
    static long _sink;
    static volatile bool _flag;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        Console.WriteLine();

        Console.WriteLine("--- how long does each 'do nothing' actually take? ---");
        Console.WriteLine();
        Console.WriteLine("  call                       per call");
        Report("Thread.Sleep(0)", () => Thread.Sleep(0), 200_000);
        Report("Thread.Yield()", () => Thread.Yield(), 200_000);
        Report("Thread.Sleep(1)", () => Thread.Sleep(1), 300);
        Report("Task.Delay(1).Wait()", () => System.Threading.Tasks.Task.Delay(1).Wait(), 300);
        Console.WriteLine();
        Console.WriteLine("  Sleep(0) and Yield() return almost immediately: they offer the");
        Console.WriteLine("  rest of the time slice back and are usually handed it straight");
        Console.WriteLine("  away. Sleep(1) is not 1 ms — it is 'at least 1 ms', rounded up");
        Console.WriteLine("  to the OS timer resolution, which on Windows is ~15.6 ms unless");
        Console.WriteLine("  something has raised it.");

        Console.WriteLine();
        Console.WriteLine("--- spinning vs blocking, while another thread does real work ---");
        var solo = Measure(() => Burn(150_000_000));
        Console.WriteLine($"  CPU work alone                       : {solo,7:N0} ms");

        // 8 threads spinning on a flag: runnable, and eating cores.
        _flag = false;
        var spinners = Start(8, () => { while (!_flag) { } });
        var withSpinners = Measure(() => Burn(150_000_000));
        _flag = true;
        Join(spinners);
        Console.WriteLine($"  ...with 8 threads SPIN-waiting        : {withSpinners,7:N0} ms " +
                          $"({withSpinners / solo:N2}x)");

        // 8 threads blocked on an event: not runnable, and free.
        var gate = new ManualResetEventSlim(false);
        var blockers = Start(8, () => gate.Wait());
        var withBlockers = Measure(() => Burn(150_000_000));
        gate.Set();
        Join(blockers);
        Console.WriteLine($"  ...with 8 threads BLOCKED             : {withBlockers,7:N0} ms " +
                          $"({withBlockers / solo:N2}x)");
        Console.WriteLine();
        Console.WriteLine("  Both sets of threads are 'waiting' in the everyday sense. Only");
        Console.WriteLine("  one of them is waiting in the scheduler's sense. A spin-wait is");
        Console.WriteLine("  a thread saying 'I am ready to run' several million times a");
        Console.WriteLine("  second, and the OS believes it.");

        Console.WriteLine();
        Console.WriteLine("--- SpinWait does the right thing automatically ---");
        _flag = false;
        var smart = Start(8, () =>
        {
            var spin = new SpinWait();
            while (!_flag) spin.SpinOnce();
        });
        var withSpinWait = Measure(() => Burn(150_000_000));
        _flag = true;
        Join(smart);
        Console.WriteLine($"  ...with 8 threads using SpinWait      : {withSpinWait,7:N0} ms " +
                          $"({withSpinWait / solo:N2}x)");
        Console.WriteLine("  SpinWait spins briefly — worth it if the wait is nanoseconds —");
        Console.WriteLine("  then yields, then sleeps. It is the primitive to reach for when");
        Console.WriteLine("  you genuinely do not know how long the wait will be.");

        Console.WriteLine();
        Console.WriteLine("--- thread priority is not a scheduling guarantee ---");
        _flag = false;
        long lowCount = 0, highCount = 0;
        var low = new Thread(() => { long n = 0; while (!_flag) n++; lowCount = n; })
        { IsBackground = true, Priority = ThreadPriority.Lowest };
        var high = new Thread(() => { long n = 0; while (!_flag) n++; highCount = n; })
        { IsBackground = true, Priority = ThreadPriority.Highest };
        low.Start(); high.Start();
        Thread.Sleep(300);
        _flag = true;
        low.Join(); high.Join();
        Interlocked.Add(ref _sink, lowCount + highCount);
        Console.WriteLine("  Two spinning threads, Lowest and Highest priority, 300 ms:");
        Console.WriteLine($"    Lowest  iterations : {lowCount,15:N0}");
        Console.WriteLine($"    Highest iterations : {highCount,15:N0}");
        Console.WriteLine($"    ratio              : {(double)highCount / lowCount,15:N2}x");
        Console.WriteLine("  Priority is a HINT to the OS scheduler, applied within a");
        Console.WriteLine("  process and subject to the OS's own anti-starvation boosting.");
        Console.WriteLine("  It does not partition CPU, and raising it is almost never the");
        Console.WriteLine("  fix for a latency problem — it moves the problem to whatever");
        Console.WriteLine("  you just starved.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static void Report(string name, Action a, int iterations)
    {
        for (var i = 0; i < Math.Min(iterations, 100); i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < iterations; i++) a();
        sw.Stop();
        var us = sw.Elapsed.TotalMilliseconds * 1_000 / iterations;
        Console.WriteLine($"  {name,-26} {us,8:N2} us");
    }

    static Thread[] Start(int n, Action body)
    {
        var ts = new Thread[n];
        for (var i = 0; i < n; i++)
        {
            ts[i] = new Thread(() => body()) { IsBackground = true };
            ts[i].Start();
        }
        Thread.Sleep(50);
        return ts;
    }

    static void Join(Thread[] ts) { foreach (var t in ts) t.Join(); }

    static double Measure(Action a)
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
