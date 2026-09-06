// 06-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 06-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        ThreadPool.GetMinThreads(out var minW, out var minIo);
        Console.WriteLine($"processors: {Environment.ProcessorCount}, pool minimum: {minW}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 1: how long until the 20th item starts? =====");
        var release = new ManualResetEventSlim(false);
        var starts = new ConcurrentQueue<double>();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < 20; i++)
            ThreadPool.QueueUserWorkItem(_ => { starts.Enqueue(sw.Elapsed.TotalMilliseconds); release.Wait(); });

        while (starts.Count < 20 && sw.Elapsed.TotalSeconds < 15) Thread.Sleep(20);
        var times = starts.ToArray();
        Array.Sort(times);
        release.Set();
        Thread.Sleep(200);

        Console.WriteLine($"  items started      : {times.Length}");
        Console.WriteLine($"  1st started at     : {times[0]:N0} ms");
        Console.WriteLine($"  8th started at     : {times[Math.Min(7, times.Length - 1)]:N0} ms");
        Console.WriteLine($"  20th started at    : {times[^1]:N0} ms");
        Console.WriteLine($"  average gap after the {minW}th : " +
                          $"{(times[^1] - times[Math.Min(minW - 1, times.Length - 1)]) / Math.Max(1, times.Length - minW):N0} ms");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: which of these starve the pool? =====");
        Console.WriteLine("  (a) Task.Delay(100).Wait()          -> STARVES: blocks a pool thread");
        Console.WriteLine("  (b) await Task.Delay(100)           -> safe: occupies no thread");
        Console.WriteLine("  (c) Thread.Sleep(100) in Task.Run   -> STARVES: blocks a pool thread");
        Console.WriteLine("  (d) CPU work in Task.Run            -> safe: uses the thread as intended");
        Console.WriteLine();
        Console.WriteLine("  measured, 100 concurrent of each:");
        Console.WriteLine("  NOTE: pool state carries over WITHIN one process. 'threads created'");
        Console.WriteLine("  is relative to each run's start, so a later case can show 0 only");
        Console.WriteLine("  because an earlier one already forced those threads into existence.");
        Console.WriteLine("  case                          elapsed ms   threads created");
        Report("(a) .Wait() on a delay", () => RunPool(100, () => Task.Delay(100).Wait()));
        Report("(b) await a delay", () => RunAsync(100, async () => await Task.Delay(100).ConfigureAwait(false)));
        Report("(c) Thread.Sleep in Task.Run", () => RunPool(100, () => Thread.Sleep(100)));
        Report("(d) CPU work in Task.Run", () => RunPool(100, () => Spin(3_000_000)));
        Console.WriteLine();
        Console.WriteLine("  (c) and (d) both occupy a thread for their whole duration. The");
        Console.WriteLine("  difference is that (d) is USING the thread — that is what a pool");
        Console.WriteLine("  thread is for — while (c) is holding one to do nothing.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: where does the work actually run? =====");
        var counts = new ConcurrentDictionary<int, int>();
        var done = new CountdownEvent(1);
        Task.Run(() =>
        {
            var inner = new CountdownEvent(2_000);
            for (var i = 0; i < 2_000; i++)
                ThreadPool.UnsafeQueueUserWorkItem(_ =>
                {
                    counts.AddOrUpdate(Environment.CurrentManagedThreadId, 1, (_, c) => c + 1);
                    Spin(30_000);
                    inner.Signal();
                }, null);
            inner.Wait();
            done.Signal();
        });
        done.Wait();
        var shares = counts.Values.OrderByDescending(v => v).ToArray();
        Console.WriteLine($"  2,000 items queued by ONE pool thread ran on {counts.Count} threads");
        Console.WriteLine($"  top 8 shares : {string.Join(", ", shares.Take(8))}");
        Console.WriteLine($"  busiest thread took {shares[0] * 100.0 / 2000:N0}% of the work");
        Console.WriteLine("  Without work stealing that would be 100%.");
        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: does SetMinThreads fix it?  (runs LAST on purpose) =====");
        Console.WriteLine("  It permanently inflates the pool for this process, so it must run");
        Console.WriteLine("  after every other measurement or it contaminates them. An earlier");
        Console.WriteLine("  ordering put it third and exercise 4 then reported 193 threads.");
        var beforeFix = Timed(() => RunPool(120, () => Task.Delay(100).Wait()));
        ThreadPool.SetMinThreads(200, minIo);
        var afterFix = Timed(() => RunPool(120, () => Task.Delay(100).Wait()));
        var afterMore = Timed(() => RunPool(400, () => Task.Delay(100).Wait()));
        ThreadPool.SetMinThreads(minW, minIo);

        Console.WriteLine($"  120 blocking, default minimum ({minW})  : {beforeFix,7:N0} ms");
        Console.WriteLine($"  120 blocking, SetMinThreads(200)      : {afterFix,7:N0} ms");
        Console.WriteLine($"  400 blocking, SetMinThreads(200)      : {afterMore,7:N0} ms");
        Console.WriteLine("  Raising the minimum fixes the case it was sized for and fails");
        Console.WriteLine("  again as soon as concurrency exceeds it. The number is a guess");
        Console.WriteLine("  about future load, which is why it is a lever and not a fix.");

        Console.WriteLine();
        Console.WriteLine($"  (checksum {_sink})");
    }

    static void Report(string name, Action run)
    {
        Thread.Sleep(800);
        var start = ThreadPool.ThreadCount;
        var peak = start;
        using var t = new Timer(_ => { var n = ThreadPool.ThreadCount; if (n > peak) peak = n; }, null, 0, 10);
        var sw = Stopwatch.StartNew();
        run();
        sw.Stop();
        Console.WriteLine($"  {name,-28} {sw.Elapsed.TotalMilliseconds,10:N0}   {peak - start,15}");
    }

    static double Timed(Action run)
    {
        Thread.Sleep(800);
        var sw = Stopwatch.StartNew();
        run();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static void RunPool(int n, Action body)
    {
        var done = new CountdownEvent(n);
        for (var i = 0; i < n; i++)
            ThreadPool.QueueUserWorkItem(_ => { body(); done.Signal(); });
        done.Wait();
    }

    static void RunAsync(int n, Func<Task> body)
        => Task.WhenAll(Enumerable.Range(0, n).Select(_ => body())).GetAwaiter().GetResult();

    static void Spin(int n)
    {
        long acc = 0;
        for (var i = 0; i < n; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }
}
