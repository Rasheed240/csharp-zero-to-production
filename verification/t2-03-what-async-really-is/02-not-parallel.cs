// 02-not-parallel.cs — async is not parallelism, and applying it to CPU-bound
// work buys nothing. Both halves measured, because "async makes it faster" is
// the most expensive misunderstanding in this track.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-not-parallel.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        Console.WriteLine();

        Console.WriteLine("=== 1. an async method with no await runs entirely synchronously ===");
        var sw = Stopwatch.StartNew();
        var t = NoAwaitAsync();
        var elapsedBeforeAwait = sw.Elapsed.TotalMilliseconds;
        t.GetAwaiter().GetResult();
        sw.Stop();
        Console.WriteLine($"  time for the CALL to return   : {elapsedBeforeAwait:N0} ms");
        Console.WriteLine($"  total                         : {sw.Elapsed.TotalMilliseconds:N0} ms");
        Console.WriteLine($"  task already completed on return : {t.IsCompleted}");
        Console.WriteLine("  The word 'async' started nothing. The body ran on the calling");
        Console.WriteLine("  thread, to completion, before the method returned.");

        Console.WriteLine();
        Console.WriteLine("=== 2. awaiting sequentially is not concurrent ===");
        var sequential = Time(() => ThreeSequential().GetAwaiter().GetResult());
        var concurrent = Time(() => ThreeConcurrent().GetAwaiter().GetResult());
        Console.WriteLine($"  three 200 ms operations, awaited one after another : {sequential,6:N0} ms");
        Console.WriteLine($"  three 200 ms operations, started then awaited      : {concurrent,6:N0} ms");
        Console.WriteLine("  'await' does not mean 'in parallel'. It means 'stop here until");
        Console.WriteLine("  this finishes, without holding a thread'. Concurrency comes from");
        Console.WriteLine("  STARTING several before awaiting any.");

        Console.WriteLine();
        Console.WriteLine("=== 3. async over CPU-bound work buys nothing ===");
        const long Work = 200_000_000;
        var direct = Time(() => Burn(Work));
        var wrapped = Time(() => Task.Run(() => Burn(Work)).GetAwaiter().GetResult());
        var awaited = Time(() => CpuAsync(Work).GetAwaiter().GetResult());
        Console.WriteLine($"  called directly            : {direct,6:N0} ms");
        Console.WriteLine($"  wrapped in Task.Run        : {wrapped,6:N0} ms  ({wrapped / direct:N2}x)");
        Console.WriteLine($"  in an async method         : {awaited,6:N0} ms  ({awaited / direct:N2}x)");
        Console.WriteLine("  Not identical — SLOWER. There is no I/O to overlap with, so async");
        Console.WriteLine("  has nothing to hide, and what is left is its overhead: a task");
        Console.WriteLine("  object, a state machine, and for Task.Run a hop to another thread");
        Console.WriteLine("  and back. Task.Run moved the work; it did not make it smaller.");
        Console.WriteLine("  The exact multiplier is noisy run to run, but the direction is not:");
        Console.WriteLine("  wrapping CPU work in async never makes it faster.");

        Console.WriteLine();
        Console.WriteLine("=== 4. what DOES make CPU-bound work faster is parallelism ===");
        var parallel = Time(() =>
        {
            Parallel.For(0, Environment.ProcessorCount, _ => Burn(Work / Environment.ProcessorCount));
        });
        Console.WriteLine($"  split across {Environment.ProcessorCount} cores : {parallel,6:N0} ms  " +
                          $"({direct / parallel:N2}x faster than one core)");
        Console.WriteLine("  Different tool, different problem. Parallelism divides CPU work");
        Console.WriteLine("  across cores. Async avoids holding a thread while WAITING.");
        Console.WriteLine("  Confusing them is why 'we made it async and it got slower' is a");
        Console.WriteLine("  sentence people say.");

        Console.WriteLine();
        Console.WriteLine("=== 5. and async over CPU work on a server is actively harmful ===");
        Console.WriteLine("  Task.Run on a request path takes a pool thread to do CPU work,");
        Console.WriteLine("  while the request's own thread waits for it. Two threads are now");
        Console.WriteLine("  involved where one was needed, and the pool is the resource under");
        Console.WriteLine("  pressure. Measured:");
        var poolCost = Time(() =>
        {
            Task.WhenAll(Enumerable.Range(0, 64)
                .Select(_ => Task.Run(() => Burn(Work / 64)))).GetAwaiter().GetResult();
        });
        var straight = Time(() =>
        {
            for (var i = 0; i < 64; i++) Burn(Work / 64);
        });
        Console.WriteLine($"    64 chunks via Task.Run : {poolCost,6:N0} ms");
        Console.WriteLine($"    the same, in a loop    : {straight,6:N0} ms");
        Console.WriteLine("  Task.Run wins here because this process has spare cores. On a");
        Console.WriteLine("  server already using them all for other requests, it does not.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static async Task NoAwaitAsync()
    {
        Burn(100_000_000);
        await Task.CompletedTask;      // completes synchronously: no suspension
    }

    static async Task ThreeSequential()
    {
        await Task.Delay(200).ConfigureAwait(false);
        await Task.Delay(200).ConfigureAwait(false);
        await Task.Delay(200).ConfigureAwait(false);
    }

    static async Task ThreeConcurrent()
    {
        var a = Task.Delay(200);
        var b = Task.Delay(200);
        var c = Task.Delay(200);
        await Task.WhenAll(a, b, c).ConfigureAwait(false);
    }

    static async Task CpuAsync(long work)
    {
        Burn(work);
        await Task.CompletedTask;
    }

    static void Burn(long n)
    {
        long acc = 0;
        for (long i = 0; i < n; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }

    static double Time(Action a)
    {
        a();
        var sw = Stopwatch.StartNew();
        a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }
}
