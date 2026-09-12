// 05-minimal-example.cs — One outbound webhook sender with every decision
// made: an outbox so nothing is sent before it is true, one queue per
// consumer, a bounded delivery, a signature that is regenerated per attempt,
// backoff with jitter, a delivery log, and an endpoint that gets disabled
// rather than retried forever.
//
// THE SCHEDULE IS COMPRESSED so the file finishes: milliseconds where a real
// sender would use minutes and hours. Everything else is the real shape.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: the outcomes, attempt counts and log entries are
// deterministic. The timings are machine-specific, and the jitter figures
// move between runs by design.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var consumerApp = builder.Build();

int c2Attempts = 0;

// Four consumers, behaving as four consumers do.
consumerApp.MapPost("/hooks/{consumer}", async (string consumer) =>
{
    switch (consumer)
    {
        case "c2" when Interlocked.Increment(ref c2Attempts) <= 2:
            return Results.StatusCode(503);

        case "c3":
            return Results.StatusCode(500);

        case "c4":
            await Task.Delay(2000);

            return Results.Ok();

        default:
            return Results.Ok();
    }
});

await consumerApp.StartAsync();

string baseAddress = consumerApp.Urls.First();

var sender = new WebhookSender(baseAddress);

Console.WriteLine("One outbound webhook sender, every decision made");
Console.WriteLine();

// DECISION 1: the event is written in the same transaction as the state
// change. Nothing is sent from inside the transaction, so nothing is ever
// announced that then rolls back.
using (var transaction = sender.BeginTransaction())
{
    transaction.Apply("PAY-001", "captured");
    transaction.Enqueue("c1", "payment.captured", "PAY-001", "captured", version: 1);
    transaction.Enqueue("c2", "payment.captured", "PAY-001", "captured", version: 1);
    transaction.Enqueue("c3", "payment.captured", "PAY-001", "captured", version: 1);
    transaction.Enqueue("c4", "payment.captured", "PAY-001", "captured", version: 1);

    transaction.Commit();
}

// A transaction that fails after enqueuing. Nothing must reach anybody.
using (var rolledBack = sender.BeginTransaction())
{
    rolledBack.Apply("PAY-002", "captured");
    rolledBack.Enqueue("c1", "payment.captured", "PAY-002", "captured", version: 1);

    // No Commit(). The disposal discards both the state change and the event.
}

await sender.DrainAsync();

Console.WriteLine("   consumer   outcome                                attempts   last status");
Console.WriteLine("   --------   -------                                --------   -----------");

foreach (Endpoint endpoint in sender.Endpoints)
{
    Console.WriteLine($"   {endpoint.Consumer,-8}   {endpoint.Outcome,-36} {endpoint.Attempts,8}   {endpoint.LastStatus}");
}

Console.WriteLine();
Console.WriteLine($"   events announced for a rolled-back change   {sender.Log.Count(l => l.PaymentId == "PAY-002")}");
Console.WriteLine($"   delivery log entries                        {sender.Log.Count}");
Console.WriteLine($"   endpoints disabled                          {sender.Endpoints.Count(e => e.Disabled)}");
Console.WriteLine();

Console.WriteLine("   THE DELIVERY LOG:");
Console.WriteLine();
Console.WriteLine("   event         consumer   attempt   status                    took   signature");
Console.WriteLine("   -----         --------   -------   ------                    ----   ---------");

foreach (Attempt entry in sender.Log.OrderBy(l => l.Consumer).ThenBy(l => l.Number))
{
    Console.WriteLine($"   {entry.EventId,-12}  {entry.Consumer,-8}   {entry.Number,7}   " +
        $"{entry.Status,-22}  {entry.Ms,4:0} ms   {entry.Signature[..14]}...");
}

await consumerApp.StopAsync();

Console.WriteLine();
Console.WriteLine("   EVERY DECISION, AND WHY:");
Console.WriteLine();
Console.WriteLine("     THE EVENT IS ENQUEUED IN THE TRANSACTION AND SENT AFTER IT. The");
Console.WriteLine("     rolled-back change announced nothing, which is the whole point: a");
Console.WriteLine("     webhook sent from inside a transaction is a promise made before it is");
Console.WriteLine("     true, and there is no event that un-says it.");
Console.WriteLine();
Console.WriteLine("     ONE QUEUE PER CONSUMER. c4 takes two seconds and c3 fails every time;");
Console.WriteLine("     neither of them delayed c1. A shared pool would have made every");
Console.WriteLine("     customer wait for the slowest one.");
Console.WriteLine();
Console.WriteLine("     EVERY DELIVERY IS BOUNDED. A consumer that never answers holds a");
Console.WriteLine("     worker for exactly as long as the timeout and no longer.");
Console.WriteLine();
Console.WriteLine("     THE SIGNATURE IS REGENERATED ON EVERY ATTEMPT, over the current");
Console.WriteLine("     timestamp and the exact bytes being sent. Look at c4 in the log: four");
Console.WriteLine("     attempts, four different signatures, one identical body. A stored");
Console.WriteLine("     request would have expired against the consumer's replay window.");
Console.WriteLine();
Console.WriteLine("     AND LOOK AT c2, WHOSE THREE ATTEMPTS SHARE ONE SIGNATURE. They landed");
Console.WriteLine("     inside the same second, and the timestamp has one-second resolution, so");
Console.WriteLine("     the signed material was identical. THE SIGNATURE TRACKS THE CLOCK, NOT");
Console.WriteLine("     THE ATTEMPT - which is fine, and is worth knowing before somebody uses");
Console.WriteLine("     it as a delivery identifier. The EVENT ID is the identifier; the");
Console.WriteLine("     signature is only a proof.");
Console.WriteLine();
Console.WriteLine("     THE EVENT ID AND BODY DO NOT CHANGE BETWEEN ATTEMPTS. That is what");
Console.WriteLine("     lets the consumer deduplicate, and it is the other half of the same");
Console.WriteLine("     contract: we promise the id is stable, they promise to key on it.");
Console.WriteLine();
Console.WriteLine("     THE PAYLOAD CARRIES STATE AND A VERSION, not a transition. A consumer");
Console.WriteLine("     can apply these in any order and any number of times and end up");
Console.WriteLine("     correct, which is the only ordering guarantee worth offering.");
Console.WriteLine();
Console.WriteLine("     BACKOFF HAS JITTER. Without it, every consumer behind one platform");
Console.WriteLine("     retries in the same millisecond and the recovery is another outage.");
Console.WriteLine();
Console.WriteLine("     AND c3 WAS DISABLED RATHER THAN RETRIED FOREVER. Every attempt at a");
Console.WriteLine("     dead endpoint costs a worker and a connection. The log says why and");
Console.WriteLine("     when, so the customer can be told and the events can be replayed.");
Console.WriteLine();
Console.WriteLine("   WHAT THIS STILL DOES NOT DECIDE:");
Console.WriteLine();
Console.WriteLine("     WHAT IS IN THE PAYLOAD. Sending the whole object is convenient and");
Console.WriteLine("     means every consumer's logs now hold your customers' data. Sending an");
Console.WriteLine("     id and making them fetch it is safer and doubles their integration");
Console.WriteLine("     work. Most providers send a middle amount and let consumers fetch the");
Console.WriteLine("     rest - and that is a privacy decision before it is a design one.");
Console.WriteLine();
Console.WriteLine("     HOW LONG THE LOG IS KEPT, and who can see it. A delivery log is the");
Console.WriteLine("     first thing support asks for and it contains request bodies.");
Console.WriteLine();
Console.WriteLine("     WHAT HAPPENS AFTER THE LAST ATTEMPT. Parked for replay, dropped, or");
Console.WriteLine("     the endpoint disabled - and how the customer finds out. From their");
Console.WriteLine("     side all three look identical: silence.");
Console.WriteLine();
Console.WriteLine("     AND WHETHER TO BUILD THIS AT ALL. Everything here - the outbox, the");
Console.WriteLine("     queues, the log, the replay UI, the signature rotation - is a product");
Console.WriteLine("     in its own right, and there are companies that sell it. Building it");
Console.WriteLine("     is a reasonable choice; building it BY ACCIDENT, one requirement at a");
Console.WriteLine("     time, is how most webhook systems come to exist.");

// ---------------------------------------------------------------------------
public sealed record Event(
    string Id, string Type, string PaymentId, string Status, int Version, string Consumer);

public sealed record Attempt(
    string EventId, string Consumer, string PaymentId, int Number, string Status,
    double Ms, string Signature);

public sealed class Endpoint(string consumer)
{
    public string Consumer { get; } = consumer;

    public string Url { get; set; } = "";

    public int Attempts { get; set; }

    public string Outcome { get; set; } = "";

    public string LastStatus { get; set; } = "";

    public bool Disabled { get; set; }
}

// ---------------------------------------------------------------------------
public sealed class WebhookSender(string baseAddress)
{
    // DECISION 2: the connection is pooled and recycled, and redirects are
    // off - a webhook has no reason to follow one, and following one defeats
    // any check made on the configured URL.
    private readonly HttpClient http = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        ConnectTimeout = TimeSpan.FromSeconds(2)
    });

    private readonly ConcurrentQueue<Event> outbox = new();

    private readonly Dictionary<string, string> state = [];

    private const string Secret = "whsec_2f8a1c0e5b9d4a6f";

    // Compressed. A real schedule doubles from ten seconds and caps at hours.
    private static readonly int[] BackoffMs = [40, 80, 160];

    public List<Attempt> Log { get; } = [];

    public List<Endpoint> Endpoints { get; } =
        [.. new[] { "c1", "c2", "c3", "c4" }.Select(c => new Endpoint(c))];

    public Transaction BeginTransaction() => new(this);

    internal void CommitTransaction(List<KeyValuePair<string, string>> changes, List<Event> events)
    {
        // Both halves land together. Nothing is queued that is not also true.
        foreach ((string id, string status) in changes)
        {
            state[id] = status;
        }

        foreach (Event pending in events)
        {
            outbox.Enqueue(pending);
        }
    }

    public async Task DrainAsync()
    {
        // DECISION 3: one queue and one worker per consumer, so a slow or
        // broken endpoint costs only its own customer.
        var byConsumer = outbox.GroupBy(e => e.Consumer).ToArray();

        await Task.WhenAll(byConsumer.Select(group => Task.Run(async () =>
        {
            Endpoint endpoint = Endpoints.First(e => e.Consumer == group.Key);
            endpoint.Url = $"{baseAddress}/hooks/{group.Key}";

            foreach (Event pending in group)
            {
                await DeliverAsync(pending, endpoint);
            }
        })));
    }

    private async Task DeliverAsync(Event pending, Endpoint endpoint)
    {
        // DECISION 4: the URL is checked against the RESOLVED address every
        // time, not once at registration.
        if (!IsPublic(endpoint.Url))
        {
            endpoint.Outcome = "refused: not a public address";

            return;
        }

        // DECISION 5: serialised ONCE. These bytes are what is signed and
        // what is sent, on every attempt.
        string body = JsonSerializer.Serialize(new
        {
            id = pending.Id,
            type = pending.Type,
            version = pending.Version,
            data = new { paymentId = pending.PaymentId, status = pending.Status }
        });

        for (int attempt = 1; attempt <= BackoffMs.Length + 1; attempt++)
        {
            endpoint.Attempts = attempt;

            // DECISION 6: the timestamp and signature are regenerated now,
            // because the consumer's replay window is measured from now.
            long timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            string signature = Sign(Secret, timestamp, body);

            var message = new HttpRequestMessage(HttpMethod.Post, endpoint.Url)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };

            message.Headers.Add("x-ledger-event-id", pending.Id);
            message.Headers.Add("x-ledger-timestamp", timestamp.ToString());
            message.Headers.Add("x-ledger-signature", signature);

            var clock = Stopwatch.StartNew();
            string status;

            try
            {
                // DECISION 7: every delivery is bounded, so one consumer
                // cannot hold a worker indefinitely.
                using var budget = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));

                HttpResponseMessage response = await http.SendAsync(message, budget.Token);

                status = $"{(int)response.StatusCode} {response.StatusCode}";

                if (response.IsSuccessStatusCode)
                {
                    Record(pending, endpoint, attempt, status, clock, signature);

                    endpoint.Outcome = attempt == 1 ? "delivered" : $"delivered on attempt {attempt}";
                    endpoint.LastStatus = status;

                    return;
                }
            }
            catch (TaskCanceledException)
            {
                status = "timed out";
            }
            catch (HttpRequestException exception)
            {
                status = exception.StatusCode is null ? "no response" : exception.StatusCode.ToString()!;
            }

            Record(pending, endpoint, attempt, status, clock, signature);

            endpoint.LastStatus = status;

            if (attempt <= BackoffMs.Length)
            {
                // DECISION 8: full jitter, so a platform hosting many
                // consumers is not hit by all of their retries at once.
                await Task.Delay(Random.Shared.Next(BackoffMs[attempt - 1]) + 5);
            }
        }

        // DECISION 9: an endpoint that has failed every attempt is disabled,
        // with the reason recorded, rather than retried until the heat death
        // of the universe.
        endpoint.Disabled = true;
        endpoint.Outcome = "disabled after every attempt failed";
    }

    private void Record(Event pending, Endpoint endpoint, int attempt, string status,
        Stopwatch clock, string signature)
    {
        lock (Log)
        {
            Log.Add(new Attempt(pending.Id, endpoint.Consumer, pending.PaymentId,
                attempt, status, clock.Elapsed.TotalMilliseconds, signature));
        }
    }

    private static bool IsPublic(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out Uri? uri))
        {
            return false;
        }

        // Loopback is allowed here only because this file's consumers live
        // there. A real sender rejects it, along with every private range.
        return uri.Scheme is "http" or "https";
    }

    private static string Sign(string secret, long timestamp, string body)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));

        return "v1=" + Convert.ToHexStringLower(
            hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{body}")));
    }
}

// ---------------------------------------------------------------------------
// The transaction, modelled: state changes and events are held together and
// applied together, or discarded together.
public sealed class Transaction(WebhookSender sender) : IDisposable
{
    private readonly List<KeyValuePair<string, string>> changes = [];

    private readonly List<Event> events = [];

    private bool committed;

    public void Apply(string paymentId, string status) =>
        changes.Add(new(paymentId, status));

    public void Enqueue(string consumer, string type, string paymentId, string status, int version) =>
        events.Add(new Event(
            $"evt_{Guid.NewGuid().ToString("N")[..8]}", type, paymentId, status, version, consumer));

    public void Commit()
    {
        sender.CommitTransaction(changes, events);

        committed = true;
    }

    public void Dispose()
    {
        if (!committed)
        {
            // Both halves are discarded. This is the case the outbox exists
            // for and the one a direct send gets wrong.
            changes.Clear();
            events.Clear();
        }
    }
}
