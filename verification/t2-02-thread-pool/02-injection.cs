// 02-injection.cs — what the pool does when every thread is busy and more work
// arrives. This is the behaviour that turns a blocking call into an outage, and
// the rate is measured here rather than quoted from a blog post.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-injection.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

class Program
{
    static void Main()
    {
        ThreadPool.GetMinThreads(out var minWorker, out _);
        Console.WriteLine($"processors: {Environment.ProcessorCount}, pool min worker threads: {minWorker}");
        Console.WriteLine();

        Console.WriteLine("--- occupy every pool thread, then queue much more work ---");
        Console.WriteLine("  Each work item blocks for 10 seconds. Nothing is deadlocked;");
        Console.WriteLine("  the threads are merely not available. Watch how fast the pool");
        Console.WriteLine("  decides to add more.");
        Console.WriteLine();

        var release = new ManualResetEventSlim(false);
        var started = 0;
        const int Queued = 60;

        var sw = Stopwatch.StartNew();
        var firstSeen = new double[Queued + 1];

        for (var i = 0; i < Queued; i++)
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                var n = Interlocked.Increment(ref started);
                if (n <= Queued) firstSeen[n] = sw.Elapsed.TotalMilliseconds;
                release.Wait();
            });
        }

        Console.WriteLine("  item   started at (ms)   gap since previous");
        var previous = 0.0;
        var reported = 0;
        while (reported < 24)
        {
            Thread.Sleep(25);
            var now = Volatile.Read(ref started);
            while (reported < now && reported < 24)
            {
                reported++;
                var at = firstSeen[reported];
                Console.WriteLine($"  {reported,4}   {at,14:N0}   {(reported == 1 ? 0 : at - previous),18:N0}");
                previous = at;
            }
            if (sw.Elapsed.TotalSeconds > 20) break;
        }

        Console.WriteLine();
        Console.WriteLine($"  after {sw.Elapsed.TotalSeconds:N1}s : {Volatile.Read(ref started)} of {Queued} " +
                          $"items have started, ThreadCount = {ThreadPool.ThreadCount}, " +
                          $"pending = {ThreadPool.PendingWorkItemCount}");

        release.Set();
        Thread.Sleep(500);
        Console.WriteLine($"  after releasing  : {Volatile.Read(ref started)} started, " +
                          $"ThreadCount = {ThreadPool.ThreadCount}");

        Console.WriteLine();
        Console.WriteLine("--- what that table means ---");
        Console.WriteLine("  The first items start immediately: those threads already existed,");
        Console.WriteLine("  up to the minimum. After that the pool adds threads GRADUALLY.");
        Console.WriteLine("  It is not being unhelpful — it is assuming the work is CPU-bound,");
        Console.WriteLine("  in which case adding threads past the core count makes things");
        Console.WriteLine("  worse, exactly as t2-01 measured at 4,096 threads.");
        Console.WriteLine();
        Console.WriteLine("  The pool watches throughput and adds a thread only when doing so");
        Console.WriteLine("  recently improved it. That algorithm is called hill climbing, and");
        Console.WriteLine("  it is right for CPU work and catastrophic for blocked work: a");
        Console.WriteLine("  blocked thread produces no throughput, so the signal that would");
        Console.WriteLine("  justify adding threads never appears.");
        Console.WriteLine();
        Console.WriteLine("  Read the gap column again. THAT is the latency a request waits");
        Console.WriteLine("  when the pool is starved, and it is why the symptom is a service");
        Console.WriteLine("  that is slow rather than one that is broken.");

        Console.WriteLine();
        Console.WriteLine("--- SetMinThreads changes the no-hesitation number ---");
        Console.WriteLine("  Raising the minimum makes the pool create that many threads");
        Console.WriteLine("  immediately, skipping the climb. Measured in 03-starvation.cs.");
        Console.WriteLine("  It treats the symptom: the threads are still blocked, they are");
        Console.WriteLine("  blocked in greater numbers. The cure is not blocking.");
    }
}
