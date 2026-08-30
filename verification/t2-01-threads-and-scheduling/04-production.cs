// 04-production.cs — the incident shape this module exists to explain, run at
// small scale: a Ledger settlement worker that gives each item its own thread,
// and what happens to it as volume grows.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Settlement;

public sealed record Instruction(string Reference, decimal AmountMinor);

/// <summary>
/// Stands in for the gateway call each instruction makes: mostly waiting, with
/// a little work to do with the answer.
/// </summary>
public static class Gateway
{
    public const int LatencyMs = 80;

    public static void Submit(Instruction _)
    {
        Thread.Sleep(LatencyMs);          // the network round trip
        Burn(2_000_000);                  // parsing and validating the response
    }

    public static async Task SubmitAsync(Instruction _, CancellationToken ct = default)
    {
        await Task.Delay(LatencyMs, ct);
        Burn(2_000_000);
    }

    private static long _sink;
    private static void Burn(long n)
    {
        long acc = 0;
        for (long i = 0; i < n; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}, " +
                          $"simulated gateway latency: {Gateway.LatencyMs} ms");
        Console.WriteLine();
        Console.WriteLine("Each instruction is ~80 ms of WAITING plus a little CPU.");
        Console.WriteLine("Three implementations, identical work, growing batch size.");
        Console.WriteLine();
        Console.WriteLine("  batch   thread-per-item        bounded pool          async");
        Console.WriteLine("            ms   peak threads      ms   peak threads     ms   peak threads");

        foreach (var batch in new[] { 8, 32, 128, 512 })
        {
            var items = Build(batch);

            var (tpiMs, tpiThreads) = ThreadPerItem(items);
            var (bpMs, bpThreads) = BoundedPool(items, Environment.ProcessorCount * 4);
            var (asMs, asThreads) = AsyncAll(items);

            Console.WriteLine($"  {batch,5}   {tpiMs,7:N0}   {tpiThreads,12}   {bpMs,5:N0}   {bpThreads,12}   " +
                              $"{asMs,5:N0}   {asThreads,12}");
        }

        Console.WriteLine();
        Console.WriteLine("--- what the table says ---");
        Console.WriteLine("  thread-per-item is FASTEST at small batches and its thread count");
        Console.WriteLine("  tracks the batch exactly. At 512 it is holding hundreds of");
        Console.WriteLine("  threads to do 512 x 80 ms of waiting, and each one reserves");
        Console.WriteLine("  1 MB of stack address space.");
        Console.WriteLine();
        Console.WriteLine("  The bounded pool holds a fixed number of threads regardless of");
        Console.WriteLine("  batch size, and pays for it in elapsed time: it can only have");
        Console.WriteLine("  that many round trips in flight.");
        Console.WriteLine();
        Console.WriteLine("  async matches thread-per-item's elapsed time with a thread count");
        Console.WriteLine("  that barely moves — because a task awaiting I/O occupies no");
        Console.WriteLine("  thread at all. That is t2-03.");
        Console.WriteLine();
        Console.WriteLine("--- the failure this module is about ---");
        Console.WriteLine("  Nothing above crashed. Thread-per-item looked GOOD at batch 8,");
        Console.WriteLine("  which is the batch size it was tested with. The design fails on");
        Console.WriteLine("  a Tuesday when a backlog arrives and the batch is 50,000:");
        Console.WriteLine("    - 50,000 x 1 MB reserved = 50 GB of address space");
        Console.WriteLine("    - the OS scheduler juggling 50,000 runnable-ish threads");
        Console.WriteLine("    - and, measured in 02-cost-of-threads.cs, the same work took");
        Console.WriteLine("      LONGER on 4,096 threads than on 4");
        Console.WriteLine("  The symptom is not 'we ran out of threads'. It is latency");
        Console.WriteLine("  climbing with no change in CPU or in the code.");
    }

    static List<Instruction> Build(int n)
    {
        var list = new List<Instruction>(n);
        for (var i = 1; i <= n; i++)
            list.Add(new Instruction($"P-{i:D6}", (i % 900 + 100) * 100));
        return list;
    }

    static int OsThreads()
    {
        var p = Process.GetCurrentProcess();
        p.Refresh();
        return p.Threads.Count;
    }

    /// <summary>One OS thread per instruction. Simple, and unbounded.</summary>
    static (double ms, int peakThreads) ThreadPerItem(List<Instruction> items)
    {
        var peak = 0;
        var threads = new Thread[items.Count];
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            threads[i] = new Thread(() => Gateway.Submit(item)) { IsBackground = true };
            threads[i].Start();
        }
        Thread.Sleep(30);
        peak = OsThreads();
        foreach (var t in threads) t.Join();
        sw.Stop();
        return (sw.Elapsed.TotalMilliseconds, peak);
    }

    /// <summary>A fixed number of threads draining a queue. Bounded, and slower.</summary>
    static (double ms, int peakThreads) BoundedPool(List<Instruction> items, int workers)
    {
        var peak = 0;
        var queue = new Queue<Instruction>(items);
        var threads = new Thread[workers];
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < workers; i++)
        {
            threads[i] = new Thread(() =>
            {
                while (true)
                {
                    Instruction next;
                    lock (queue)
                    {
                        if (queue.Count == 0) return;
                        next = queue.Dequeue();
                    }
                    Gateway.Submit(next);
                }
            })
            { IsBackground = true };
            threads[i].Start();
        }
        Thread.Sleep(30);
        peak = OsThreads();
        foreach (var t in threads) t.Join();
        sw.Stop();
        return (sw.Elapsed.TotalMilliseconds, peak);
    }

    /// <summary>No thread per item at all.</summary>
    static (double ms, int peakThreads) AsyncAll(List<Instruction> items)
    {
        var peak = 0;
        var sw = Stopwatch.StartNew();
        using (new Timer(_ => { var n = OsThreads(); if (n > peak) peak = n; }, null, 0, 10))
        {
            Task.WhenAll(items.ConvertAll(i => Gateway.SubmitAsync(i))).GetAwaiter().GetResult();
        }
        sw.Stop();
        return (sw.Elapsed.TotalMilliseconds, peak);
    }
}
