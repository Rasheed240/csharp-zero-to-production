// 01-no-thread.cs — the one claim this module exists to establish: an operation
// awaiting I/O occupies NO thread. Everything else about async follows from it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-no-thread.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int Operations = 1_000;
    const int WaitMs = 200;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        Console.WriteLine($"{Operations:N0} concurrent operations, each waiting {WaitMs} ms.");
        Console.WriteLine();

        Console.WriteLine("--- 1,000 operations, one thread each ---");
        var blocking = MeasureThreads(() =>
        {
            var threads = new Thread[Operations];
            for (var i = 0; i < Operations; i++)
            {
                threads[i] = new Thread(() => Thread.Sleep(WaitMs)) { IsBackground = true };
                threads[i].Start();
            }
            foreach (var t in threads) t.Join();
        });
        Console.WriteLine($"  elapsed          : {blocking.ms,7:N0} ms");
        Console.WriteLine($"  OS threads peak  : {blocking.peakOs}");
        Console.WriteLine($"  memory delta     : {blocking.memoryKb:N0} KB");

        Console.WriteLine();
        Console.WriteLine("--- the same 1,000 operations, awaited ---");
        var asyncRun = MeasureThreads(() =>
        {
            Task.WhenAll(Enumerable.Range(0, Operations).Select(_ => Task.Delay(WaitMs)))
                .GetAwaiter().GetResult();
        });
        Console.WriteLine($"  elapsed          : {asyncRun.ms,7:N0} ms");
        Console.WriteLine($"  OS threads peak  : {asyncRun.peakOs}");
        Console.WriteLine($"  memory delta     : {asyncRun.memoryKb:N0} KB");

        Console.WriteLine();
        Console.WriteLine("--- side by side ---");
        Console.WriteLine($"  elapsed   : {blocking.ms:N0} ms  vs  {asyncRun.ms:N0} ms");
        Console.WriteLine($"  threads   : {blocking.peakOs}  vs  {asyncRun.peakOs}   " +
                          $"({blocking.peakOs - asyncRun.peakOs} fewer)");
        Console.WriteLine($"  memory    : {blocking.memoryKb:N0} KB  vs  {asyncRun.memoryKb:N0} KB");
        Console.WriteLine();
        Console.WriteLine("  Same work, same wall-clock outcome, and one of them did not need");
        Console.WriteLine("  a thousand threads. THAT is what async buys. It is not speed.");

        Console.WriteLine();
        Console.WriteLine("--- where is the thread during an await? ---");
        Console.WriteLine("  Nowhere. There is no thread. The operation is a registration:");
        Console.WriteLine("  the OS is told 'when this completes, run this continuation', and");
        Console.WriteLine("  the calling thread returns to the pool to do other work.");
        Console.WriteLine();
        DemonstrateThreadHopping().GetAwaiter().GetResult();

        Console.WriteLine();
        Console.WriteLine("--- proof that the pool is free during the wait ---");
        Console.WriteLine("  While 1,000 operations are awaiting, queue CPU work and see how");
        Console.WriteLine("  quickly it runs. If the awaits held threads, it would wait.");
        Console.WriteLine();
        var pending = Task.WhenAll(Enumerable.Range(0, Operations).Select(_ => Task.Delay(WaitMs)));
        Thread.Sleep(30);
        var sw = Stopwatch.StartNew();
        var cpuDone = Task.Run(() => Burn(20_000_000));
        cpuDone.Wait();
        sw.Stop();
        Console.WriteLine($"  CPU work started and finished in {sw.Elapsed.TotalMilliseconds:N0} ms");
        Console.WriteLine($"  while {Operations:N0} operations were mid-await");
        Console.WriteLine($"  pool threads at that moment : {ThreadPool.ThreadCount}");
        pending.GetAwaiter().GetResult();
        Console.WriteLine("  It did not queue behind them, because they were not there.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static async Task DemonstrateThreadHopping()
    {
        Console.WriteLine($"  before any await : thread {Environment.CurrentManagedThreadId}, " +
                          $"pool={Thread.CurrentThread.IsThreadPoolThread}");
        await Task.Delay(50).ConfigureAwait(false);
        Console.WriteLine($"  after 1st await  : thread {Environment.CurrentManagedThreadId}, " +
                          $"pool={Thread.CurrentThread.IsThreadPoolThread}");
        await Task.Delay(50).ConfigureAwait(false);
        Console.WriteLine($"  after 2nd await  : thread {Environment.CurrentManagedThreadId}, " +
                          $"pool={Thread.CurrentThread.IsThreadPoolThread}");
        Console.WriteLine("  The thread can change at every await. A method is not tied to");
        Console.WriteLine("  one thread, which is why thread-affine state does not survive");
        Console.WriteLine("  an await and why locks cannot be held across one.");
    }

    static long _sink;

    static void Burn(long n)
    {
        long acc = 0;
        for (long i = 0; i < n; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }

    static (double ms, int peakOs, long memoryKb) MeasureThreads(Action run)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        Thread.Sleep(300);

        var proc = Process.GetCurrentProcess();
        proc.Refresh();
        var startOs = proc.Threads.Count;
        var startMem = proc.WorkingSet64;
        var peak = startOs;

        using var sampler = new Timer(_ =>
        {
            var p = Process.GetCurrentProcess();
            p.Refresh();
            if (p.Threads.Count > peak) peak = p.Threads.Count;
        }, null, 0, 5);

        var sw = Stopwatch.StartNew();
        run();
        sw.Stop();

        proc.Refresh();
        return (sw.Elapsed.TotalMilliseconds, peak, (proc.WorkingSet64 - startMem) / 1024);
    }
}
