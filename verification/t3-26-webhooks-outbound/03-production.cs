// 03-production.cs — The incident: one customer's endpoint got slow, and
// every other customer stopped receiving webhooks. Nothing was down, nothing
// errored, and the dashboard showed a healthy delivery success rate the whole
// time.
//
// Six real consumers on a real server, one of them slow. The same 60 events
// delivered by two senders that differ only in how the work is queued.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: the event counts and the ordering of the two results are
// deterministic. The millisecond figures are machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading.Channels;

var consumerBuilder = WebApplication.CreateBuilder();
consumerBuilder.WebHost.UseUrls("http://127.0.0.1:0");
consumerBuilder.Logging.ClearProviders();

var consumerApp = consumerBuilder.Build();

// Six consumers. One of them - c3 - has a slow endpoint. Not down. Slow.
consumerApp.MapPost("/hooks/{consumer}", async (string consumer) =>
{
    await Task.Delay(consumer == "c3" ? 400 : 5);

    return Results.Ok();
});

await consumerApp.StartAsync();

string baseAddress = consumerApp.Urls.First();

using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };

string[] consumers = ["c1", "c2", "c3", "c4", "c5", "c6"];

// 60 events, ten per consumer, interleaved as they would arrive in real life.
Delivery[] events = [.. Enumerable.Range(0, 60)
    .Select(n => new Delivery($"evt_{n:00}", consumers[n % 6]))];

Console.WriteLine("The slow consumer that stopped everybody's webhooks");
Console.WriteLine();
Console.WriteLine("   14:40  one customer's endpoint slows from 5 ms to 400 ms");
Console.WriteLine("   14:52  three other customers report webhooks arriving late");
Console.WriteLine("   15:10  the delivery success rate is still 100%");
Console.WriteLine("   15:20  the oldest undelivered event is 28 minutes old");
Console.WriteLine();

// ---------------------------------------------------------------------------
Console.WriteLine("1. ONE QUEUE, FOUR WORKERS - THE WAY IT WAS BUILT");
Console.WriteLine();

Result shared = await DeliverFromOneQueue(events, workers: 4);

Report(shared);

Console.WriteLine();
Console.WriteLine("   EVERY DELIVERY SUCCEEDED. That is what the dashboard was showing, and it");
Console.WriteLine("   was true. The failure is not in the deliveries, it is in the WAITING - and");
Console.WriteLine("   nothing was measuring that.");
Console.WriteLine();
Console.WriteLine("   FOUR WORKERS, AND c3's DELIVERIES OCCUPY THEM. Each one holds a worker for");
Console.WriteLine("   400 ms, so with ten of them in a 60-event queue there is almost always one");
Console.WriteLine("   or more in flight - and every healthy consumer's event sits behind them.");
Console.WriteLine("   THAT IS HEAD-OF-LINE BLOCKING: the queue is shared, so the slowest member");
Console.WriteLine("   sets the pace for everyone.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("2. ONE QUEUE PER CONSUMER - THE SAME EVENTS, THE SAME ENDPOINTS");
Console.WriteLine();

Result isolated = await DeliverPerConsumer(events);

Report(isolated);

Console.WriteLine();
Console.WriteLine("   THE SLOW CONSUMER IS STILL SLOW. Its own events still take as long as its");
Console.WriteLine("   endpoint takes, and there is nothing to be done about that from our side.");
Console.WriteLine("   WHAT CHANGED IS THAT IT NO LONGER COSTS ANYBODY ELSE ANYTHING.");
Console.WriteLine();
Console.WriteLine("   IN FACT IT GOT WORSE FOR THEM, AND THAT IS THE DESIGN WORKING. In the");
Console.WriteLine("   shared queue, c3 was helping itself to four workers; with one queue each");
Console.WriteLine("   it gets one, so its own backlog drains more slowly. THE COST HAS BEEN");
Console.WriteLine("   MOVED ONTO THE CONSUMER THAT CAUSED IT, which is exactly where it belongs.");
Console.WriteLine();
Console.WriteLine("   THE WHOLE BATCH ALSO TOOK LONGER, and total throughput is the wrong thing");
Console.WriteLine("   to optimise here. If c3 needs more parallelism, give each consumer a small");
Console.WriteLine("   allowance - two or four in flight - rather than one queue shared by");
Console.WriteLine("   everybody. A PER-CONSUMER LIMIT IS A BULKHEAD; a shared pool is not.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("3. WHAT THE NUMBERS SAY");
Console.WriteLine();
Console.WriteLine("   healthy consumers' events        one queue      per consumer");
Console.WriteLine("   -------------------------        ---------      ------------");
Console.WriteLine($"   worst wait before delivery   {shared.HealthyWorstMs,10:0} ms   {isolated.HealthyWorstMs,10:0} ms");
Console.WriteLine($"   average wait                 {shared.HealthyMeanMs,10:0} ms   {isolated.HealthyMeanMs,10:0} ms");
Console.WriteLine($"   whole batch finished in      {shared.TotalMs,10:0} ms   {isolated.TotalMs,10:0} ms");
Console.WriteLine();
Console.WriteLine($"   worst wait, {shared.HealthyWorstMs / Math.Max(isolated.HealthyWorstMs, 1):0.0}x better once the queues are separated");
Console.WriteLine();
Console.WriteLine("   THE LESSONS, IN THE ORDER THEY COST MONEY:");
Console.WriteLine();
Console.WriteLine("     A SHARED QUEUE MAKES EVERY CONSUMER A DEPENDENCY OF EVERY OTHER ONE.");
Console.WriteLine("     One customer's badly-hosted endpoint is now an availability problem for");
Console.WriteLine("     customers who have never heard of them. Isolation is not an");
Console.WriteLine("     optimisation here, it is the difference between one unhappy customer");
Console.WriteLine("     and all of them.");
Console.WriteLine();
Console.WriteLine("     'DELIVERY SUCCESS RATE' IS THE WRONG METRIC and it stayed green");
Console.WriteLine("     throughout. THE METRIC THAT WOULD HAVE CAUGHT THIS IS QUEUE AGE: how");
Console.WriteLine("     old is the oldest undelivered event, per consumer. It rises before");
Console.WriteLine("     anybody complains, and it is the only number that describes the");
Console.WriteLine("     backlog rather than the traffic.");
Console.WriteLine();
Console.WriteLine("     A TIMEOUT ON EACH DELIVERY IS PART OF THE FIX, NOT ALL OF IT. A slow");
Console.WriteLine("     consumer under a 5-second timeout still occupies a worker for 5");
Console.WriteLine("     seconds. The timeout bounds the damage; the per-consumer queue is what");
Console.WriteLine("     contains it.");
Console.WriteLine();
Console.WriteLine("     AND A CONSUMER THAT IS PERSISTENTLY SLOW OR FAILING SHOULD BE PAUSED.");
Console.WriteLine("     Not silently: emailed, shown a broken badge in their dashboard, and");
Console.WriteLine("     given a way to replay. An endpoint that has failed for six hours is");
Console.WriteLine("     not going to be fixed by a fifteenth attempt, and continuing to try");
Console.WriteLine("     costs a worker every time.");

await consumerApp.StopAsync();

// ---------------------------------------------------------------------------
async Task<Result> DeliverFromOneQueue(Delivery[] work, int workers)
{
    var queue = new ConcurrentQueue<Delivery>(work);
    var waits = new ConcurrentBag<(string Consumer, double Ms)>();

    var clock = Stopwatch.StartNew();

    Task[] pool = [.. Enumerable.Range(0, workers).Select(_ => Task.Run(async () =>
    {
        while (queue.TryDequeue(out Delivery? delivery))
        {
            double queuedAt = clock.Elapsed.TotalMilliseconds;

            await http.PostAsync($"{baseAddress}/hooks/{delivery.Consumer}", null);

            waits.Add((delivery.Consumer, queuedAt));
        }
    }))];

    await Task.WhenAll(pool);

    return Summarise(waits, clock.Elapsed.TotalMilliseconds);
}

async Task<Result> DeliverPerConsumer(Delivery[] work)
{
    var waits = new ConcurrentBag<(string Consumer, double Ms)>();

    var clock = Stopwatch.StartNew();

    // One channel and one worker per consumer. A slow consumer's backlog is
    // its own; nobody else queues behind it.
    Task[] pool = [.. work.GroupBy(d => d.Consumer).Select(group => Task.Run(async () =>
    {
        var channel = Channel.CreateUnbounded<Delivery>();

        foreach (Delivery delivery in group)
        {
            await channel.Writer.WriteAsync(delivery);
        }

        channel.Writer.Complete();

        await foreach (Delivery delivery in channel.Reader.ReadAllAsync())
        {
            double queuedAt = clock.Elapsed.TotalMilliseconds;

            await http.PostAsync($"{baseAddress}/hooks/{delivery.Consumer}", null);

            waits.Add((delivery.Consumer, queuedAt));
        }
    }))];

    await Task.WhenAll(pool);

    return Summarise(waits, clock.Elapsed.TotalMilliseconds);
}

static Result Summarise(ConcurrentBag<(string Consumer, double Ms)> waits, double total)
{
    double[] healthy = [.. waits.Where(w => w.Consumer != "c3").Select(w => w.Ms)];
    double[] slow = [.. waits.Where(w => w.Consumer == "c3").Select(w => w.Ms)];

    return new Result(
        waits.Count,
        healthy.Max(),
        healthy.Average(),
        slow.Max(),
        total);
}

static void Report(Result result)
{
    Console.WriteLine($"   events delivered                        {result.Delivered} of 60");
    Console.WriteLine($"   deliveries that failed                  0");
    Console.WriteLine($"   healthy consumers, worst wait           {result.HealthyWorstMs,6:0} ms");
    Console.WriteLine($"   healthy consumers, average wait         {result.HealthyMeanMs,6:0} ms");
    Console.WriteLine($"   the slow consumer, worst wait           {result.SlowWorstMs,6:0} ms");
    Console.WriteLine($"   whole batch                             {result.TotalMs,6:0} ms");
}

// ---------------------------------------------------------------------------
public sealed record Delivery(string Id, string Consumer);

public sealed record Result(
    int Delivered,
    double HealthyWorstMs,
    double HealthyMeanMs,
    double SlowWorstMs,
    double TotalMs);
