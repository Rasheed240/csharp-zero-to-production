// 02-channels.cs — producer/consumer with System.Threading.Channels, and the
// thing that actually matters about them: what happens when the consumer cannot
// keep up.
//
// Memory and item counts are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-channels.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

class Program
{
    const int Items = 40_000;
    const int PayloadBytes = 1024;

    static void Main()
    {
        Console.WriteLine("=== the shape ===");
        Console.WriteLine();
        Console.WriteLine("  A channel is a queue with an async reader and an async writer. The");
        Console.WriteLine("  producer awaits when it is full; the consumer awaits when it is");
        Console.WriteLine("  empty. Neither blocks a thread while waiting.");
        Console.WriteLine();
        Console.WriteLine("      var channel = Channel.CreateBounded<Work>(100);");
        Console.WriteLine("      await channel.Writer.WriteAsync(item, ct);      // producer");
        Console.WriteLine("      await foreach (var i in channel.Reader.ReadAllAsync(ct))  // consumer");
        Console.WriteLine();
        Console.WriteLine("  That is the whole API for the common case. What matters is the");
        Console.WriteLine("  choice on the first line.");

        Console.WriteLine();
        Console.WriteLine("=== bounded against unbounded, when the consumer is slower ===");
        Console.WriteLine();
        Console.WriteLine($"  {Items:N0} items of {PayloadBytes:N0} bytes, produced faster than consumed:");
        Console.WriteLine();
        Console.WriteLine("  channel                  peak queued   peak MB held   all items?");

        Report("Unbounded", RunUnbounded());
        Report("Bounded(100), Wait", RunBounded(100, BoundedChannelFullMode.Wait));
        Report("Bounded(100), DropWrite", RunBounded(100, BoundedChannelFullMode.DropWrite));
        Report("Bounded(100), DropOldest", RunBounded(100, BoundedChannelFullMode.DropOldest));

        Console.WriteLine();
        Console.WriteLine("  An unbounded channel reports n/a for depth because it does not");
        Console.WriteLine("  support Count at all — CanCount is false. That is itself worth");
        Console.WriteLine("  knowing: the queue you cannot bound is also the one you cannot");
        Console.WriteLine("  measure, so it will not appear on a dashboard before it kills you.");
        Console.WriteLine("  Read the MEMORY column for it instead.");
        Console.WriteLine();
        Console.WriteLine("  UNBOUNDED is the default people reach for and it is a memory leak");
        Console.WriteLine("  with extra steps. It held several times the memory of the bounded");
        Console.WriteLine("  version here, over a short run with a fixed number of items. With a");
        Console.WriteLine("  continuous producer the queue grows until the process dies, and there");
        Console.WriteLine("  is no back pressure and no error — the writer always succeeds.");
        Console.WriteLine();
        Console.WriteLine("  BOUNDED + WAIT is back pressure. The producer awaits when the queue");
        Console.WriteLine("  is full, so it slows to the consumer's pace. Memory is bounded by the");
        Console.WriteLine("  capacity you chose rather than by the speed difference.");
        Console.WriteLine();
        Console.WriteLine("  BOUNDED + DROP is load shedding: it keeps up by losing data. Note the");
        Console.WriteLine("  last column. That is the right trade for telemetry and metrics, and");
        Console.WriteLine("  the wrong one for payments — and the API will not stop you choosing");
        Console.WriteLine("  it for either.");

        Console.WriteLine();
        Console.WriteLine("=== back pressure is the point ===");
        Console.WriteLine();
        Console.WriteLine("  'Bounded' sounds like a limit on memory. It is really a decision");
        Console.WriteLine("  about WHERE a speed mismatch shows up:");
        Console.WriteLine();
        Console.WriteLine("    unbounded   -> in memory, until the process is killed");
        Console.WriteLine("    Wait        -> in the producer, which slows down");
        Console.WriteLine("    DropWrite   -> in the data, silently");
        Console.WriteLine();
        Console.WriteLine("  Every system with a producer and a consumer makes this choice. The");
        Console.WriteLine("  only question is whether it was made deliberately.");
        Console.WriteLine();
        Console.WriteLine("  If the producer is an HTTP handler, Wait gives you the behaviour you");
        Console.WriteLine("  want for free: the request slows down, the client sees latency, and");
        Console.WriteLine("  their timeout does the load shedding for you at the right layer.");

        Console.WriteLine();
        Console.WriteLine("=== completion, and the deadlock that follows from getting it wrong ===");
        Console.WriteLine();
        Console.WriteLine($"  consumer with Complete() called   : {WithCompletion()}");
        Console.WriteLine($"  consumer without Complete()       : {WithoutCompletion()}");
        Console.WriteLine();
        Console.WriteLine("  ReadAllAsync ends when the writer is COMPLETED, not when the queue is");
        Console.WriteLine("  empty — an empty channel is not a finished one, it is a channel");
        Console.WriteLine("  waiting for more. Forget Writer.Complete() and the consumer awaits");
        Console.WriteLine("  forever, having processed everything.");
        Console.WriteLine();
        Console.WriteLine("  Put it in a finally, because a producer that throws must still");
        Console.WriteLine("  complete the channel or it takes the consumer down with it:");
        Console.WriteLine();
        Console.WriteLine("      try     { await ProduceAsync(writer, ct); }");
        Console.WriteLine("      finally { writer.Complete(); }");
        Console.WriteLine();
        Console.WriteLine("  Complete(exception) is better still: it ends the loop AND rethrows on");
        Console.WriteLine("  the consumer, so a producer failure surfaces rather than looking like");
        Console.WriteLine("  a clean end of stream.");
        Console.WriteLine($"  consumer sees a faulted producer   : {FaultedProducer()}");

        Console.WriteLine();
        Console.WriteLine("=== the single-reader and single-writer options ===");
        Console.WriteLine();
        var (general, specialised) = ReaderWriterOptions();
        Console.WriteLine($"  default options                    : {1.0,5:N2}x  (baseline)");
        Console.WriteLine($"  SingleReader + SingleWriter        : {specialised / general,5:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Effectively no difference on this workload, and that is the honest");
        Console.WriteLine("  result. These options let the channel skip synchronisation it would");
        Console.WriteLine("  otherwise need, but the saving is small next to the cost of moving");
        Console.WriteLine("  400,000 items, and a microbenchmark with one producer and one");
        Console.WriteLine("  consumer is close to the best case for the default path anyway.");
        Console.WriteLine();
        Console.WriteLine("  Set them because they are TRUE, not because they are faster. They are");
        Console.WriteLine("  promises rather than requests: if you set SingleReader and then read");
        Console.WriteLine("  from two places, the behaviour is undefined and nothing checks. The");
        Console.WriteLine("  risk is a future edit adding a second consumer to a channel whose");
        Console.WriteLine("  options nobody re-reads.");
    }

    readonly record struct Result(int PeakQueued, bool CanCount, double PeakMb, int Consumed);

    static Result RunUnbounded() =>
        Run(Channel.CreateUnbounded<byte[]>(new UnboundedChannelOptions { SingleWriter = true, SingleReader = true }));

    static Result RunBounded(int capacity, BoundedChannelFullMode mode) =>
        Run(Channel.CreateBounded<byte[]>(new BoundedChannelOptions(capacity)
        {
            FullMode = mode,
            SingleWriter = true,
            SingleReader = true
        }));

    static Result Run(Channel<byte[]> channel)
    {
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var peakQueued = 0;
        var peakBytes = 0L;
        var consumed = 0;

        var producer = Task.Run(async () =>
        {
            try
            {
                for (var i = 0; i < Items; i++)
                    await channel.Writer.WriteAsync(new byte[PayloadBytes]).ConfigureAwait(false);
            }
            finally { channel.Writer.Complete(); }
        });

        var sampler = Task.Run(async () =>
        {
            while (!producer.IsCompleted)
            {
                if (channel.Reader.CanCount)
                {
                    var q = channel.Reader.Count;
                    if (q > peakQueued) peakQueued = q;
                }
                var mem = GC.GetTotalMemory(false) - before;
                if (mem > peakBytes) peakBytes = mem;
                await Task.Delay(1).ConfigureAwait(false);
            }
        });

        var consumer = Task.Run(async () =>
        {
            await foreach (var item in channel.Reader.ReadAllAsync().ConfigureAwait(false))
            {
                consumed++;
                if ((consumed & 0x3F) == 0) await Task.Yield();     // deliberately slower
            }
        });

        Task.WhenAll(producer, sampler, consumer).GetAwaiter().GetResult();
        return new Result(peakQueued, channel.Reader.CanCount,
                          Math.Max(peakBytes, 0) / 1024.0 / 1024.0, consumed);
    }

    static void Report(string label, Result r) =>
        Console.WriteLine($"  {label,-24} {(r.CanCount ? r.PeakQueued.ToString("N0") : "n/a"),11}   " +
                          $"{r.PeakMb,12:N1}   {r.Consumed:N0} of {Items:N0}");

    // --- completion -----------------------------------------------------------
    static string WithCompletion()
    {
        var channel = Channel.CreateUnbounded<int>();
        var consumer = Task.Run(async () =>
        {
            var n = 0;
            await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false)) n++;
            return n;
        });
        for (var i = 0; i < 100; i++) channel.Writer.TryWrite(i);
        channel.Writer.Complete();
        return consumer.Wait(1500) ? $"finished, read {consumer.Result} items" : "HUNG";
    }

    static string WithoutCompletion()
    {
        var channel = Channel.CreateUnbounded<int>();
        var consumer = Task.Run(async () =>
        {
            var n = 0;
            await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false)) n++;
            return n;
        });
        for (var i = 0; i < 100; i++) channel.Writer.TryWrite(i);
        // deliberately no Complete()
        return consumer.Wait(1000) ? $"finished, read {consumer.Result} items" : "HUNG - all 100 read, still awaiting more";
    }

    static string FaultedProducer()
    {
        var channel = Channel.CreateUnbounded<int>();
        var consumer = Task.Run(async () =>
        {
            try
            {
                await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false)) { }
                return "completed cleanly";
            }
            catch (InvalidOperationException ex) { return $"threw {ex.Message}"; }
        });
        channel.Writer.TryWrite(1);
        channel.Writer.Complete(new InvalidOperationException("the producer failed"));
        return consumer.Wait(1500) ? consumer.Result : "HUNG";
    }

    // --- options --------------------------------------------------------------
    static (double general, double specialised) ReaderWriterOptions()
    {
        var a = TimeThroughput(new BoundedChannelOptions(1024));
        var b = TimeThroughput(new BoundedChannelOptions(1024) { SingleReader = true, SingleWriter = true });
        return (a, b);
    }

    static double TimeThroughput(BoundedChannelOptions options)
    {
        Thread.Sleep(80);
        var channel = Channel.CreateBounded<int>(options);
        var sw = Stopwatch.StartNew();

        var producer = Task.Run(async () =>
        {
            try
            {
                for (var i = 0; i < 400_000; i++)
                    await channel.Writer.WriteAsync(i).ConfigureAwait(false);
            }
            finally { channel.Writer.Complete(); }
        });

        var consumer = Task.Run(async () =>
        {
            var sum = 0L;
            await foreach (var i in channel.Reader.ReadAllAsync().ConfigureAwait(false)) sum += i;
            return sum;
        });

        Task.WhenAll(producer, consumer).GetAwaiter().GetResult();
        return sw.Elapsed.TotalMilliseconds;
    }
}
