// 03-production.cs — Ledger's webhook dispatcher. An unbounded queue and an
// unthrottled fan-out, and what each did on the day a partner got slow.
//
// Peaks and counts are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace Ledger.Webhooks;

public sealed record WebhookEvent(long Id, string Url, byte[] Payload);

/// <summary>Stands in for a partner endpoint. Latency is configurable.</summary>
public sealed class PartnerEndpoint
{
    private int _inFlight;
    private int _peak;
    public int Peak => Volatile.Read(ref _peak);
    public int DelayMs { get; set; } = 5;

    public async Task PostAsync(WebhookEvent e, CancellationToken ct = default)
    {
        var now = Interlocked.Increment(ref _inFlight);
        var peak = Volatile.Read(ref _peak);
        while (now > peak && Interlocked.CompareExchange(ref _peak, now, peak) != peak)
            peak = Volatile.Read(ref _peak);
        try { await Task.Delay(DelayMs, ct).ConfigureAwait(false); }
        finally { Interlocked.Decrement(ref _inFlight); }
    }
}

class Program
{
    const int Events = 3_000;
    const int PayloadBytes = 4 * 1024;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger posts a webhook to a partner for every settled payment. The");
        Console.WriteLine("  dispatcher was written the obvious way: an unbounded queue, and a");
        Console.WriteLine("  background loop that fans everything out with Task.WhenAll.");
        Console.WriteLine();
        Console.WriteLine("      _queue = Channel.CreateUnbounded<WebhookEvent>();");
        Console.WriteLine("      await Task.WhenAll(batch.Select(e => _http.PostAsync(e)));");
        Console.WriteLine();
        Console.WriteLine("  It ran for eighteen months. Then a partner's endpoint went from 5 ms");
        Console.WriteLine("  to 400 ms — not down, just slow — and Ledger fell over instead.");
        Console.WriteLine();
        Console.WriteLine("  design                              peak concurrent   peak MB   delivered");

        var slow = new PartnerEndpoint { DelayMs = 40 };
        Report("unbounded queue + WhenAll", RunUnboundedFanout(slow));
        Report("unbounded queue + semaphore(8)", RunUnboundedThrottled(slow));
        Report("bounded(500) + semaphore(8)", RunBoundedThrottled(slow));

        Console.WriteLine();
        Console.WriteLine("  Two separate defects, and fixing either alone leaves the other.");
        Console.WriteLine();
        Console.WriteLine("  THE FAN-OUT. Task.WhenAll starts every request at once, so a slow");
        Console.WriteLine("  partner is hit with the entire batch simultaneously. Ledger became a");
        Console.WriteLine("  load generator pointed at a service that was already struggling, and");
        Console.WriteLine("  the connection pool, the sockets and the memory for those requests");
        Console.WriteLine("  were all consumed at once.");
        Console.WriteLine();
        Console.WriteLine("  THE QUEUE. Unbounded means the producer never waits. Payments kept");
        Console.WriteLine("  settling and kept enqueueing while delivery slowed, so the backlog");
        Console.WriteLine("  grew without limit. The pod was eventually OOM-killed, which lost");
        Console.WriteLine("  every queued webhook — a durability failure caused by a memory bug.");

        Console.WriteLine();
        Console.WriteLine("=== the fix is two lines, and one decision ===");
        Console.WriteLine();
        Console.WriteLine("      _queue = Channel.CreateBounded<WebhookEvent>(new BoundedChannelOptions(500)");
        Console.WriteLine("      {");
        Console.WriteLine("          FullMode = BoundedChannelFullMode.Wait,");
        Console.WriteLine("      });");
        Console.WriteLine();
        Console.WriteLine("      await Parallel.ForEachAsync(batch,");
        Console.WriteLine("          new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },");
        Console.WriteLine("          (e, token) => _http.PostAsync(e, token));");
        Console.WriteLine();
        Console.WriteLine("  The decision is FullMode, and it is a business decision wearing an");
        Console.WriteLine("  API's clothes:");
        Console.WriteLine();
        Console.WriteLine("    Wait        the settlement path slows down. Back pressure reaches");
        Console.WriteLine("                the caller, which is usually where it belongs.");
        Console.WriteLine("    DropWrite   webhooks are silently lost, and settlement stays fast.");
        Console.WriteLine("    DropOldest  the same, preferring recent events.");
        Console.WriteLine();
        Console.WriteLine("  For webhooks about money, Wait — and if the queue stays full, that is");
        Console.WriteLine("  a signal to alert on rather than a reason to widen the queue.");

        Console.WriteLine();
        Console.WriteLine("=== what back pressure does to the producer ===");
        Console.WriteLine();
        var (fast, slowed) = ProducerPressure();
        Console.WriteLine($"  producer with a fast consumer : {1.0,5:N2}x  (baseline)");
        Console.WriteLine($"  producer with a slow consumer : {slowed / fast,5:N2}x");
        Console.WriteLine();
        Console.WriteLine("  That slowdown IS the feature. The producer is being told, through the");
        Console.WriteLine("  only channel available to it, that the downstream cannot keep up.");
        Console.WriteLine();
        Console.WriteLine("  It is also the objection people raise: 'we cannot slow down the");
        Console.WriteLine("  settlement path'. The honest answer is that you are already slowing");
        Console.WriteLine("  it down — the unbounded version does not avoid the cost, it defers");
        Console.WriteLine("  it into memory and then pays it all at once as an outage.");

        Console.WriteLine();
        Console.WriteLine("=== the shutdown bug this design also had ===");
        Console.WriteLine();
        Console.WriteLine($"  drained on shutdown, with Complete()     : {DrainWithComplete()}");
        Console.WriteLine($"  drained on shutdown, without Complete()  : {DrainWithoutComplete()}");
        Console.WriteLine();
        Console.WriteLine("  ReadAllAsync ends when the WRITER completes, not when the queue");
        Console.WriteLine("  empties. A shutdown path that stops enqueueing and waits for the");
        Console.WriteLine("  consumer will wait forever unless it also calls Complete().");
        Console.WriteLine();
        Console.WriteLine("  In a hosted service that means StopAsync hangs, the host waits out");
        Console.WriteLine("  its shutdown timeout, and the orchestrator sends SIGKILL — losing");
        Console.WriteLine("  exactly the queued work the graceful shutdown existed to protect.");
        Console.WriteLine();
        Console.WriteLine("      public async Task StopAsync(CancellationToken ct)");
        Console.WriteLine("      {");
        Console.WriteLine("          _queue.Writer.Complete();       // let the consumer finish");
        Console.WriteLine("          await _consumerTask.WaitAsync(ct);");
        Console.WriteLine("      }");

        Console.WriteLine();
        Console.WriteLine("=== how it was diagnosed ===");
        Console.WriteLine();
        Console.WriteLine("  The signature is distinctive once you know it, and it is unlike every");
        Console.WriteLine("  other stall in this track:");
        Console.WriteLine();
        Console.WriteLine("    gc-heap-size            climbing steadily, never falling");
        Console.WriteLine("    cpu-usage               low");
        Console.WriteLine("    monitor-lock-contention flat");
        Console.WriteLine("    outbound request rate   HIGH, and rising as latency rises");
        Console.WriteLine();
        Console.WriteLine("  That last line is what identifies it. A service under back pressure");
        Console.WriteLine("  sends FEWER requests as its dependency slows. A service without back");
        Console.WriteLine("  pressure sends MORE, because the fan-out width is set by the backlog");
        Console.WriteLine("  rather than by capacity — so slowness makes it more aggressive.");
        Console.WriteLine();
        Console.WriteLine("  The queue depth is the metric that would have caught it months");
        Console.WriteLine("  earlier, and an unbounded channel cannot report one: CanCount is");
        Console.WriteLine("  false. Choosing a bounded channel is partly choosing to be able to");
        Console.WriteLine("  see the problem.");
    }

    readonly record struct Result(int PeakConcurrent, double PeakMb, int Delivered);

    static IEnumerable<WebhookEvent> MakeEvents() =>
        Enumerable.Range(0, Events).Select(i =>
            new WebhookEvent(i, "https://partner.example/hook", new byte[PayloadBytes]));

    static Result RunUnboundedFanout(PartnerEndpoint partner) =>
        Run(partner, Channel.CreateUnbounded<WebhookEvent>(), throttle: 0);

    static Result RunUnboundedThrottled(PartnerEndpoint partner) =>
        Run(partner, Channel.CreateUnbounded<WebhookEvent>(), throttle: 8);

    static Result RunBoundedThrottled(PartnerEndpoint partner) =>
        Run(partner, Channel.CreateBounded<WebhookEvent>(
            new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.Wait }), throttle: 8);

    static Result Run(PartnerEndpoint partner, Channel<WebhookEvent> queue, int throttle)
    {
        Thread.Sleep(100);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var peakBytes = 0L;
        var delivered = 0;
        var reset = new PartnerEndpoint { DelayMs = partner.DelayMs };

        var producer = Task.Run(async () =>
        {
            try
            {
                foreach (var e in MakeEvents())
                    await queue.Writer.WriteAsync(e).ConfigureAwait(false);
            }
            finally { queue.Writer.Complete(); }
        });

        var sampler = Task.Run(async () =>
        {
            while (!producer.IsCompleted)
            {
                var mem = GC.GetTotalMemory(false) - before;
                if (mem > peakBytes) peakBytes = mem;
                await Task.Delay(2).ConfigureAwait(false);
            }
        });

        var consumer = Task.Run(async () =>
        {
            if (throttle == 0)
            {
                // The shipped shape: read everything, then fan out with no limit.
                var all = new List<WebhookEvent>();
                await foreach (var e in queue.Reader.ReadAllAsync().ConfigureAwait(false)) all.Add(e);
                await Task.WhenAll(all.Select(async e =>
                {
                    await reset.PostAsync(e).ConfigureAwait(false);
                    Interlocked.Increment(ref delivered);
                })).ConfigureAwait(false);
            }
            else
            {
                using var gate = new SemaphoreSlim(throttle, throttle);
                var pending = new List<Task>();
                await foreach (var e in queue.Reader.ReadAllAsync().ConfigureAwait(false))
                {
                    await gate.WaitAsync().ConfigureAwait(false);
                    pending.Add(Task.Run(async () =>
                    {
                        try
                        {
                            await reset.PostAsync(e).ConfigureAwait(false);
                            Interlocked.Increment(ref delivered);
                        }
                        finally { gate.Release(); }
                    }));
                }
                await Task.WhenAll(pending).ConfigureAwait(false);
            }
        });

        Task.WhenAll(producer, sampler, consumer).GetAwaiter().GetResult();
        return new Result(reset.Peak, Math.Max(peakBytes, 0) / 1024.0 / 1024.0, delivered);
    }

    static void Report(string label, Result r) =>
        Console.WriteLine($"  {label,-34} {r.PeakConcurrent,15:N0}   {r.PeakMb,7:N1}   " +
                          $"{r.Delivered:N0} of {Events:N0}");

    static (double fast, double slowed) ProducerPressure()
    {
        return (Produce(consumerDelayUs: 0), Produce(consumerDelayUs: 200));
    }

    static double Produce(int consumerDelayUs)
    {
        Thread.Sleep(80);
        var queue = Channel.CreateBounded<int>(new BoundedChannelOptions(64)
        {
            FullMode = BoundedChannelFullMode.Wait
        });

        var consumer = Task.Run(async () =>
        {
            await foreach (var _ in queue.Reader.ReadAllAsync().ConfigureAwait(false))
                if (consumerDelayUs > 0) await Task.Yield();
        });

        var sw = Stopwatch.StartNew();
        var producer = Task.Run(async () =>
        {
            try
            {
                for (var i = 0; i < 20_000; i++)
                    await queue.Writer.WriteAsync(i).ConfigureAwait(false);
            }
            finally { queue.Writer.Complete(); }
        });

        Task.WhenAll(producer, consumer).GetAwaiter().GetResult();
        return sw.Elapsed.TotalMilliseconds;
    }

    static string DrainWithComplete() => Drain(complete: true);
    static string DrainWithoutComplete() => Drain(complete: false);

    static string Drain(bool complete)
    {
        var queue = Channel.CreateUnbounded<int>();
        var read = 0;
        var consumer = Task.Run(async () =>
        {
            await foreach (var _ in queue.Reader.ReadAllAsync().ConfigureAwait(false))
                Interlocked.Increment(ref read);
        });

        for (var i = 0; i < 50; i++) queue.Writer.TryWrite(i);
        if (complete) queue.Writer.Complete();

        return consumer.Wait(1000)
            ? $"shut down cleanly after {Volatile.Read(ref read)} events"
            : $"HUNG with {Volatile.Read(ref read)} events read and the queue empty";
    }
}
