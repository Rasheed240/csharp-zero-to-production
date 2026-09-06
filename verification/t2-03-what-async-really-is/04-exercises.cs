// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-exercises.cs -c Release
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
        Console.WriteLine("===== Exercise 1: how long does each version take? =====");
        var a = Time(() => VersionA().GetAwaiter().GetResult());
        var b = Time(() => VersionB().GetAwaiter().GetResult());
        var c = Time(() => VersionC().GetAwaiter().GetResult());
        Console.WriteLine($"  (a) await, await, await                 : {a,6:N0} ms");
        Console.WriteLine($"  (b) start all three, then WhenAll       : {b,6:N0} ms");
        Console.WriteLine($"  (c) start all three, await one by one   : {c,6:N0} ms");
        Console.WriteLine("  (b) and (c) are the same. What creates concurrency is STARTING");
        Console.WriteLine("  the operations, not how you wait for them afterwards.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: where does the thread go? =====");
        TraceThreads().GetAwaiter().GetResult();

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: does async help this method? =====");
        const long Work = 120_000_000;
        var cpuSync = Time(() => Burn(Work));
        var cpuAsync = Time(() => CpuBoundAsync(Work).GetAwaiter().GetResult());
        var ioSync = Time(() => Thread.Sleep(200));
        var ioAsync = Time(() => Task.Delay(200).GetAwaiter().GetResult());
        Console.WriteLine($"  CPU-bound, sync   : {cpuSync,6:N0} ms");
        Console.WriteLine($"  CPU-bound, async  : {cpuAsync,6:N0} ms  ({cpuAsync / cpuSync:N2}x)");
        Console.WriteLine($"  I/O-bound, sync   : {ioSync,6:N0} ms");
        Console.WriteLine($"  I/O-bound, async  : {ioAsync,6:N0} ms  ({ioAsync / ioSync:N2}x)");
        Console.WriteLine();
        Console.WriteLine("  Single-threaded, async makes NEITHER faster. For the I/O case the");
        Console.WriteLine("  benefit is invisible here and appears the moment there is a second");
        Console.WriteLine("  caller — measured below.");

        var syncMany = Time(() =>
        {
            var done = new CountdownEvent(100);
            for (var i = 0; i < 100; i++)
                ThreadPool.QueueUserWorkItem(_ => { Thread.Sleep(200); done.Signal(); });
            done.Wait();
        });
        var asyncMany = Time(() =>
            Task.WhenAll(Enumerable.Range(0, 100).Select(_ => Task.Delay(200))).GetAwaiter().GetResult());
        Console.WriteLine($"  100 concurrent, sync  : {syncMany,6:N0} ms");
        Console.WriteLine($"  100 concurrent, async : {asyncMany,6:N0} ms  " +
                          $"({syncMany / asyncMany:N1}x faster)");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: fix this handler =====");
        var naive = Time(() => NaiveHandler().GetAwaiter().GetResult());
        var fixedUp = Time(() => FixedHandler().GetAwaiter().GetResult());
        Console.WriteLine($"  as written (four sequential awaits) : {naive,6:N0} ms");
        Console.WriteLine($"  with the independent calls overlapped : {fixedUp,6:N0} ms");
        Console.WriteLine($"  saving : {naive - fixedUp:N0} ms ({naive / fixedUp:N2}x)");
        Console.WriteLine("  The customer lookup and the fraud check do not depend on each");
        Console.WriteLine("  other, so they can overlap. The authorisation needs the customer,");
        Console.WriteLine("  so it cannot start earlier. The audit needs the authorisation.");
        Console.WriteLine("  Reading the DEPENDENCIES is the whole exercise; async does not");
        Console.WriteLine("  find them for you.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static async Task VersionA()
    {
        await Task.Delay(150).ConfigureAwait(false);
        await Task.Delay(150).ConfigureAwait(false);
        await Task.Delay(150).ConfigureAwait(false);
    }

    static async Task VersionB()
    {
        var x = Task.Delay(150);
        var y = Task.Delay(150);
        var z = Task.Delay(150);
        await Task.WhenAll(x, y, z).ConfigureAwait(false);
    }

    static async Task VersionC()
    {
        var x = Task.Delay(150);
        var y = Task.Delay(150);
        var z = Task.Delay(150);
        await x.ConfigureAwait(false);
        await y.ConfigureAwait(false);
        await z.ConfigureAwait(false);
    }

    static async Task TraceThreads()
    {
        Console.WriteLine($"  entering            : thread {Environment.CurrentManagedThreadId}, " +
                          $"pool={Thread.CurrentThread.IsThreadPoolThread}");
        var before = Environment.CurrentManagedThreadId;
        await Task.Delay(50).ConfigureAwait(false);
        var after = Environment.CurrentManagedThreadId;
        Console.WriteLine($"  after await         : thread {after}, " +
                          $"pool={Thread.CurrentThread.IsThreadPoolThread}");
        Console.WriteLine($"  same thread?        : {before == after}");
        Console.WriteLine("  During the 50 ms no thread was assigned to this method at all.");
        Console.WriteLine("  It resumed on whichever pool thread was free.");
    }

    static async Task CpuBoundAsync(long work)
    {
        Burn(work);
        await Task.CompletedTask;
    }

    // Four calls: fraud and customer are independent; authorise needs customer;
    // audit needs authorise.
    static async Task NaiveHandler()
    {
        await Task.Delay(40).ConfigureAwait(false);   // customer lookup
        await Task.Delay(40).ConfigureAwait(false);   // fraud check
        await Task.Delay(60).ConfigureAwait(false);   // authorise
        await Task.Delay(20).ConfigureAwait(false);   // audit
    }

    static async Task FixedHandler()
    {
        var customer = Task.Delay(40);
        var fraud = Task.Delay(40);
        await Task.WhenAll(customer, fraud).ConfigureAwait(false);
        await Task.Delay(60).ConfigureAwait(false);   // authorise: needs customer
        await Task.Delay(20).ConfigureAwait(false);   // audit: needs authorise
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
