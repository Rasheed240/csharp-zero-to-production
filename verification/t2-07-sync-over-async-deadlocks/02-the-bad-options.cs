// 02-the-bad-options.cs — when you genuinely cannot restructure, you are choosing
// between blocking shapes rather than between good and bad. This measures what
// each one actually costs under load, so the choice is made on numbers.
//
// Every option here is worse than restructuring. The point of measuring them is
// that "never block" stops being actionable the moment someone truly cannot, and
// an engineer in that position deserves a ranking rather than a rule.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-the-bad-options.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int Requests = 200;
    const int WorkMs = 50;

    static void Main()
    {
        Console.WriteLine("=== the workload ===");
        Console.WriteLine();
        Console.WriteLine($"  {Requests} concurrent operations, each waiting {WorkMs} ms on I/O.");
        Console.WriteLine("  Perfect behaviour would be about 50 ms total: nothing is CPU-bound");
        Console.WriteLine("  and nothing needs a thread while it waits.");
        Console.WriteLine();
        Console.WriteLine("  option                                  total ms   p99 ms   threads");

        Report("await (the baseline, not blocking)", RunAwait());
        Report(".Result on a pool thread", RunBlocking());
        Report("Task.Run(...).Result", RunTaskRunBlocking());
        Report(".Result with SetMinThreads(200)", RunWithMinThreads());

        Console.WriteLine();
        Console.WriteLine("=== reading this table ===");
        Console.WriteLine();
        Console.WriteLine("  AWAIT is the baseline and it is not a blocking option. It is here so");
        Console.WriteLine("  the others can be read as multiples of what correct code costs.");
        Console.WriteLine();
        Console.WriteLine("  .RESULT is the honest bad option. It holds one pool thread per");
        Console.WriteLine("  in-flight operation, so throughput is capped by how fast the pool");
        Console.WriteLine("  injects threads — roughly one per 500 ms past the minimum.");
        Console.WriteLine();
        Console.WriteLine("  TASK.RUN(...).RESULT is the one people reach for because it avoids");
        Console.WriteLine("  the SynchronizationContext deadlock. It does. It also uses TWO pool");
        Console.WriteLine("  threads per operation instead of one — the blocked caller and the");
        Console.WriteLine("  worker — so on a server it makes starvation strictly worse. It is a");
        Console.WriteLine("  fix for a UI problem, misapplied to a server.");
        Console.WriteLine("  Look at how much worse: it is not marginally worse than .Result,");
        Console.WriteLine("  it is several times worse, because every operation now needs two");
        Console.WriteLine("  threads from a pool that is already the bottleneck.");
        Console.WriteLine();
        Console.WriteLine("  SETMINTHREADS makes the blocking version fast by pre-creating the");
        Console.WriteLine("  threads the pool would have injected slowly. It is the right");
        Console.WriteLine("  emergency lever and the wrong permanent fix: you have bought");
        Console.WriteLine("  throughput with memory and context switches, and the number you");
        Console.WriteLine("  chose is now a hard ceiling nobody will revisit.");

        Console.WriteLine();
        Console.WriteLine("=== the ranking, when you truly cannot restructure ===");
        Console.WriteLine();
        Console.WriteLine("  1. Restructure. Nearly every 'cannot' is a 'have not yet'.");
        Console.WriteLine("  2. Precompute the value before the synchronous boundary.");
        Console.WriteLine("  3. Block with .Result, on a pool thread, with SetMinThreads raised");
        Console.WriteLine("     and a comment saying why and what would remove the need.");
        Console.WriteLine("  4. Task.Run(...).Result — ONLY on a UI thread, where the deadlock");
        Console.WriteLine("     is the failure you are avoiding and thread count is not the");
        Console.WriteLine("     constraint.");
        Console.WriteLine();
        Console.WriteLine("  Option 4 above option 3 on a server is the most common mistake in");
        Console.WriteLine("  this whole area, because the advice was written for desktop apps and");
        Console.WriteLine("  is repeated without its context.");
    }

    static async Task<string> WorkAsync(CancellationToken ct = default)
    {
        await Task.Delay(WorkMs, ct).ConfigureAwait(false);
        return "ok";
    }

    static Result RunAwait()
    {
        return Measure(latencies => Task.WhenAll(Enumerable.Range(0, Requests).Select(async i =>
        {
            var sw = Stopwatch.StartNew();
            await WorkAsync().ConfigureAwait(false);
            latencies[i] = sw.Elapsed.TotalMilliseconds;
        })));
    }

    static Result RunBlocking()
    {
        return Measure(latencies => Task.WhenAll(Enumerable.Range(0, Requests).Select(i =>
            Task.Run(() =>
            {
                var sw = Stopwatch.StartNew();
                WorkAsync().GetAwaiter().GetResult();      // blocks a pool thread
                latencies[i] = sw.Elapsed.TotalMilliseconds;
            }))));
    }

    static Result RunTaskRunBlocking()
    {
        return Measure(latencies => Task.WhenAll(Enumerable.Range(0, Requests).Select(i =>
            Task.Run(() =>
            {
                var sw = Stopwatch.StartNew();
                Task.Run(() => WorkAsync()).GetAwaiter().GetResult();   // TWO pool threads
                latencies[i] = sw.Elapsed.TotalMilliseconds;
            }))));
    }

    static Result RunWithMinThreads()
    {
        ThreadPool.GetMinThreads(out var w, out var io);
        ThreadPool.SetMinThreads(Requests + 8, io);
        try { return RunBlocking(); }
        finally { ThreadPool.SetMinThreads(w, io); }
    }

    readonly record struct Result(double TotalMs, double P99Ms, int ThreadsCreated);

    static Result Measure(Func<double[], Task> run)
    {
        // Let the pool settle so the previous scenario's threads are not counted.
        Thread.Sleep(250);
        var before = Process.GetCurrentProcess().Threads.Count;
        var latencies = new double[Requests];

        var sw = Stopwatch.StartNew();
        run(latencies).GetAwaiter().GetResult();
        sw.Stop();

        var peak = Process.GetCurrentProcess().Threads.Count;
        Array.Sort(latencies);
        return new Result(sw.Elapsed.TotalMilliseconds,
                          latencies[(int)(Requests * 0.99) - 1],
                          Math.Max(0, peak - before));
    }

    static void Report(string label, Result r) =>
        Console.WriteLine($"  {label,-38} {r.TotalMs,8:N0}   {r.P99Ms,6:N0}   {r.ThreadsCreated,7}");
}
