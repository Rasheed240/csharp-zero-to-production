// 02-retries-and-ordering.cs — What "we retry failed deliveries" actually
// commits you to: a schedule, a herd, duplicates, and events arriving in an
// order nobody sent them in.
//
// Run:  dotnet run 02-retries-and-ordering.cs -c Release
//
// EXACT vs RATIO: the counts are deterministic. The jitter figures move
// between runs because jitter is random - the SHAPE is the claim.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Diagnostics;

Console.WriteLine("What retrying commits you to");
Console.WriteLine();

// ---------------------------------------------------------------------------
Console.WriteLine("1. THE SCHEDULE");
Console.WriteLine();
Console.WriteLine("   attempt   delay before it   elapsed since the event");
Console.WriteLine("   -------   ---------------   -----------------------");

TimeSpan elapsed = TimeSpan.Zero;

for (int attempt = 1; attempt <= 14; attempt++)
{
    TimeSpan delay = Backoff(attempt);

    elapsed += delay;

    Console.WriteLine($"   {attempt,7}   {Describe(delay),15}   {Describe(elapsed),23}");
}

Console.WriteLine();
Console.WriteLine("   FOURTEEN ATTEMPTS OVER ROUGHLY A DAY, which is the shape every webhook");
Console.WriteLine("   provider converges on. The early attempts are close together because most");
Console.WriteLine("   failures are a restart or a blip; the late ones are far apart because a");
Console.WriteLine("   consumer that has been down for an hour will not be up in ninety seconds.");
Console.WriteLine();
Console.WriteLine("   THE CAP MATTERS AS MUCH AS THE GROWTH. Uncapped doubling reaches days");
Console.WriteLine("   between attempts, and a consumer that comes back cannot tell whether it");
Console.WriteLine("   is being retried or forgotten.");
Console.WriteLine();
Console.WriteLine("   AND THE END OF THE SCHEDULE IS A PRODUCT DECISION, NOT A TECHNICAL ONE.");
Console.WriteLine("   After the last attempt the event is either dropped, parked for manual");
Console.WriteLine("   replay, or the endpoint is disabled - and the consumer has to be told");
Console.WriteLine("   which, because from their side all three look identical: silence.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("2. WHY THE DELAY NEEDS JITTER");
Console.WriteLine();
Console.WriteLine("   100 consumers behind one platform. It restarts, every delivery in flight");
Console.WriteLine("   fails at the same moment, and every one of them is retried.");
Console.WriteLine();

var random = new Random(20260908);

foreach ((string label, bool jitter) in new[] { ("fixed backoff", false), ("with jitter", true) })
{
    var buckets = new int[40];

    for (int consumer = 0; consumer < 100; consumer++)
    {
        double delayMs = 1000;

        if (jitter)
        {
            // Full jitter: anywhere in [0, delay).
            delayMs = random.NextDouble() * 1000;
        }

        buckets[(int)(delayMs / 50)]++;
    }

    Console.WriteLine($"   {label}");
    Console.WriteLine($"     busiest 50 ms window   {buckets.Max()} of 100 retries");
    Console.WriteLine($"     windows used           {buckets.Count(b => b > 0)} of 20");
    Console.WriteLine();
}

Console.WriteLine("   WITHOUT JITTER THE RETRY IS A SECOND OUTAGE. Every consumer failed at the");
Console.WriteLine("   same instant, so every retry is scheduled for the same instant - and the");
Console.WriteLine("   platform that was struggling gets the whole day's backlog in one 50 ms");
Console.WriteLine("   window, fails again, and re-synchronises the herd for the next round.");
Console.WriteLine();
Console.WriteLine("   JITTER IS NOT A REFINEMENT. It is the difference between a retry policy");
Console.WriteLine("   that helps a recovering consumer and one that prevents it recovering.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("3. AT-LEAST-ONCE MEANS DUPLICATES, AND THEY ARE NOT RARE");
Console.WriteLine();

var applied = new ConcurrentBag<string>();
var seen = new ConcurrentDictionary<string, byte>();
int attemptsSeen = 0;

var consumerBuilder = WebApplication.CreateBuilder();
consumerBuilder.WebHost.UseUrls("http://127.0.0.1:0");
consumerBuilder.Logging.ClearProviders();

var consumerApp = consumerBuilder.Build();

// A consumer that does the work and then fails to answer - a timeout, a
// dropped connection, a load balancer that gave up. The work happened; the
// acknowledgement did not.
consumerApp.MapPost("/hooks/naive", async (HttpRequest request) =>
{
    Interlocked.Increment(ref attemptsSeen);

    string id = request.Headers["x-ledger-event-id"]!;

    applied.Add(id);

    if (attemptsSeen <= 2)
    {
        // The acknowledgement is lost on the way back.
        await Task.Delay(600);
    }

    return Results.Ok();
});

// The same consumer, with one dictionary.
consumerApp.MapPost("/hooks/idempotent", async (HttpRequest request) =>
{
    string id = request.Headers["x-ledger-event-id"]!;

    if (seen.TryAdd(id, 0))
    {
        applied.Add("guarded:" + id);
    }

    if (seen.Count <= 1 && applied.Count(a => a.StartsWith("guarded")) <= 2)
    {
        await Task.Delay(600);
    }

    return Results.Ok();
});

var received = new ConcurrentQueue<int>();

consumerApp.MapPost("/hooks/ordered", async (HttpRequest request) =>
{
    int sequence = int.Parse(request.Headers["x-ledger-sequence"]!);

    // The third event is slow, exactly as one unlucky delivery would be.
    if (sequence == 3)
    {
        await Task.Delay(200);
    }

    received.Enqueue(sequence);

    return Results.Ok();
});

await consumerApp.StartAsync();

string baseAddress = consumerApp.Urls.First();

using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(250) };

// Deliver one event, retrying on timeout, exactly as a real sender would.
for (int attempt = 1; attempt <= 3; attempt++)
{
    var message = new HttpRequestMessage(HttpMethod.Post, $"{baseAddress}/hooks/naive");
    message.Headers.Add("x-ledger-event-id", "evt_01HQ8");

    try
    {
        HttpResponseMessage response = await http.SendAsync(message);

        if (response.IsSuccessStatusCode)
        {
            break;
        }
    }
    catch (TaskCanceledException)
    {
        // Timed out. We do not know whether it was processed.
    }
}

Console.WriteLine($"   one event, delivered with retries on timeout");
Console.WriteLine($"     delivery attempts the consumer saw     {attemptsSeen}");
Console.WriteLine($"     times the consumer applied it          {applied.Count}");
Console.WriteLine();

applied.Clear();
attemptsSeen = 0;

for (int attempt = 1; attempt <= 3; attempt++)
{
    var message = new HttpRequestMessage(HttpMethod.Post, $"{baseAddress}/hooks/idempotent");
    message.Headers.Add("x-ledger-event-id", "evt_01HQ8");

    try
    {
        HttpResponseMessage response = await http.SendAsync(message);

        if (response.IsSuccessStatusCode)
        {
            break;
        }
    }
    catch (TaskCanceledException)
    {
    }
}

Console.WriteLine($"   the same event, consumer keyed on the event id");
Console.WriteLine($"     times the consumer applied it          {applied.Count}");
Console.WriteLine();
Console.WriteLine("   THE SENDER DID NOTHING WRONG. A timeout does not say whether the work");
Console.WriteLine("   happened - the request may have been received, processed and");
Console.WriteLine("   acknowledged into a connection that had already gone. THE ONLY SAFE");
Console.WriteLine("   ASSUMPTION IS THAT IT DID, and the only safe action is to retry anyway.");
Console.WriteLine();
Console.WriteLine("   SO EVERY EVENT NEEDS A STABLE ID THAT SURVIVES RETRIES, and the consumer");
Console.WriteLine("   needs to key on it. That is a contract obligation on both sides: we");
Console.WriteLine("   promise the id does not change between attempts, they promise to look at");
Console.WriteLine("   it.");
Console.WriteLine();
Console.WriteLine("   AND IT HAS TO BE DOCUMENTED, because 'at least once' is not what most");
Console.WriteLine("   people assume when they read 'we send you a webhook'.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("4. AND RETRIES DESTROY ORDERING");
Console.WriteLine();

using var ordering = new HttpClient();

var parallel = new List<Task>();

for (int sequence = 1; sequence <= 8; sequence++)
{
    int captured = sequence;

    parallel.Add(Task.Run(async () =>
    {
        var message = new HttpRequestMessage(HttpMethod.Post, $"{baseAddress}/hooks/ordered");
        message.Headers.Add("x-ledger-sequence", captured.ToString());

        await ordering.SendAsync(message);
    }));
}

await Task.WhenAll(parallel);

int[] parallelOrder = [.. received];

received.Clear();

for (int sequence = 1; sequence <= 8; sequence++)
{
    var message = new HttpRequestMessage(HttpMethod.Post, $"{baseAddress}/hooks/ordered");
    message.Headers.Add("x-ledger-sequence", sequence.ToString());

    await ordering.SendAsync(message);
}

int[] serialOrder = [.. received];

Console.WriteLine($"   sent                    {string.Join(" ", Enumerable.Range(1, 8))}");
Console.WriteLine($"   received, in parallel   {string.Join(" ", parallelOrder)}");
Console.WriteLine($"   received, one at a time {string.Join(" ", serialOrder)}");
Console.WriteLine();
Console.WriteLine($"   out-of-order pairs, parallel      {Inversions(parallelOrder)}");
Console.WriteLine($"   out-of-order pairs, serialised    {Inversions(serialOrder)}");
Console.WriteLine();
Console.WriteLine("   PARALLEL DELIVERY IS FAST AND UNORDERED. One slow delivery is enough to");
Console.WriteLine("   let everything behind it overtake, and a RETRY makes it far worse: a");
Console.WriteLine("   delivery retried after thirty seconds arrives after thirty seconds of");
Console.WriteLine("   later events.");
Console.WriteLine();
Console.WriteLine("   SO 'payment.refunded' CAN ARRIVE BEFORE 'payment.captured', and a consumer");
Console.WriteLine("   that applies events in the order they arrive will hold the wrong state");
Console.WriteLine("   permanently - not for a moment, permanently, because nothing will ever");
Console.WriteLine("   send them again.");
Console.WriteLine();
Console.WriteLine("   THERE ARE ONLY THREE HONEST ANSWERS:");
Console.WriteLine();
Console.WriteLine("     SEND A VERSION OR A TIMESTAMP AND LET THE CONSUMER DISCARD STALE ONES.");
Console.WriteLine("     Cheap, keeps the parallelism, and puts the work on the consumer.");
Console.WriteLine();
Console.WriteLine("     SERIALISE PER SUBJECT - one in flight at a time per payment, not per");
Console.WriteLine("     consumer. Preserves the order that matters without turning the whole");
Console.WriteLine("     queue into a single file.");
Console.WriteLine();
Console.WriteLine("     OR SEND THE STATE, NOT THE TRANSITION. An event carrying the current");
Console.WriteLine("     status and a version is safe to apply out of order, because the newest");
Console.WriteLine("     one wins. This is the design that makes the whole problem go away, and");
Console.WriteLine("     it is a choice about the PAYLOAD, made before anything is built.");

await consumerApp.StopAsync();

// ---------------------------------------------------------------------------
static TimeSpan Backoff(int attempt)
{
    // Doubling from 10 seconds, capped at 6 hours.
    double seconds = Math.Min(10 * Math.Pow(2, attempt - 1), 6 * 60 * 60);

    return TimeSpan.FromSeconds(seconds);
}

static string Describe(TimeSpan span) => span.TotalSeconds < 60
    ? $"{span.TotalSeconds:0} s"
    : span.TotalHours < 1
        ? $"{span.TotalMinutes:0} min"
        : $"{span.TotalHours:0.0} h";

static int Inversions(int[] values)
{
    int count = 0;

    for (int i = 0; i < values.Length; i++)
    {
        for (int j = i + 1; j < values.Length; j++)
        {
            if (values[i] > values[j])
            {
                count++;
            }
        }
    }

    return count;
}
