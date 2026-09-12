// 04-exercises.cs — Four situations from real tickets. Every answer is
// measured here rather than asserted.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every verdict, status and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

const string Secret = "whsec_2f8a1c0e5b9d4a6f";

var reached = new ConcurrentBag<string>();

// ---------------------------------------------------------------------------
// One server standing in for three things: a customer's webhook endpoint, an
// internal admin service that should never be reachable from here, and a
// public URL that redirects to it.
var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

builder.Services.AddHttpClient();

var app = builder.Build();

app.MapPost("/hooks/customer", async (HttpRequest request) =>
{
    using var reader = new StreamReader(request.Body);

    string body = await reader.ReadToEndAsync();
    long timestamp = long.Parse(request.Headers["x-ledger-timestamp"]!);
    string signature = request.Headers["x-ledger-signature"]!;

    long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    if (Math.Abs(now - timestamp) > 300)
    {
        return Results.StatusCode(401);
    }

    bool valid = CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(signature),
        Encoding.UTF8.GetBytes(Sign(Secret, timestamp, body)));

    return valid ? Results.Ok() : Results.StatusCode(401);
});

// An internal service. No authentication, because it is not on the internet.
app.MapPost("/internal/admin/keys", () =>
{
    reached.Add("internal-admin");

    return Results.Ok(new { rotated = true });
});

// A URL that looks like a customer's and redirects inward.
app.MapPost("/hooks/redirector", (HttpContext context) =>
    Results.Redirect($"{context.Request.Scheme}://{context.Request.Host}/internal/admin/keys", permanent: false, preserveMethod: true));

// The consumer for exercise 3: it applies whatever it is told, in the order
// it is told.
var customerState = new ConcurrentDictionary<string, (string Status, int Version)>();

app.MapPost("/hooks/state", async (HttpRequest request) =>
{
    using var reader = new StreamReader(request.Body);

    StateEvent update = JsonSerializer.Deserialize<StateEvent>(await reader.ReadToEndAsync())!;

    bool guarded = request.Headers.ContainsKey("x-guarded");

    customerState.AddOrUpdate(
        update.PaymentId,
        _ => (update.Status, update.Version),
        (_, existing) => guarded && existing.Version >= update.Version
            ? existing
            : (update.Status, update.Version));

    return Results.Ok();
});

// The consumer for exercise 4: it calls us back to read the record.
var ledger = new ConcurrentDictionary<string, string>();

app.MapGet("/v1/payments/{id}", (string id) =>
    ledger.TryGetValue(id, out string? status)
        ? Results.Ok(new { id, status })
        : Results.NotFound());

app.MapPost("/hooks/reads-back", async (HttpRequest request, IHttpClientFactory factory) =>
{
    using var reader = new StreamReader(request.Body);

    StateEvent update = JsonSerializer.Deserialize<StateEvent>(await reader.ReadToEndAsync())!;

    HttpClient client = factory.CreateClient();

    HttpResponseMessage lookup = await client.GetAsync(
        $"{request.Scheme}://{request.Host}/v1/payments/{update.PaymentId}");

    reached.Add($"read-back:{(int)lookup.StatusCode}");

    return Results.Ok();
});

await app.StartAsync();

string baseAddress = app.Urls.First();

Console.WriteLine("Four situations from real tickets");
Console.WriteLine();

await Exercise1();
await Exercise2();
await Exercise3();
await Exercise4();

await app.StopAsync();

// ---------------------------------------------------------------------------
async Task Exercise1()
{
    Console.WriteLine("EXERCISE 1 (easy) - the retries that all failed verification");
    Console.WriteLine();
    Console.WriteLine("   A consumer's endpoint was down for twenty minutes. It came back, and");
    Console.WriteLine("   every retry we sent was rejected with 401 - including the ones for");
    Console.WriteLine("   events it had accepted happily the day before.");
    Console.WriteLine();
    Console.WriteLine("   Our signature code has not changed. What is wrong?");
    Console.WriteLine();

    using var http = new HttpClient();

    string body = JsonSerializer.Serialize(new { id = "evt_01HQ8", type = "payment.captured" });

    long signedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 1200;
    long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    Console.WriteLine("   how the retry was sent                    consumer said");
    Console.WriteLine("   ----------------------                    -------------");

    // The stored delivery, replayed exactly as it was first built.
    Console.WriteLine($"   the original request, resent verbatim     " +
        $"{await Post(http, $"{baseAddress}/hooks/customer", body, signedAt, Sign(Secret, signedAt, body))}");

    // The same event, re-signed now.
    Console.WriteLine($"   the same event, re-signed on this attempt " +
        $"{await Post(http, $"{baseAddress}/hooks/customer", body, now, Sign(Secret, now, body))}");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE SIGNATURE IS OVER A TIMESTAMP, AND THE TIMESTAMP EXPIRED.");
    Console.WriteLine("   The consumer enforces a five-minute window - correctly, because that is");
    Console.WriteLine("   what stops a captured delivery being replayed forever. A retry twenty");
    Console.WriteLine("   minutes later is outside it.");
    Console.WriteLine();
    Console.WriteLine("   SO A RETRY IS A NEW REQUEST, NOT A REPLAY OF AN OLD ONE. The event id");
    Console.WriteLine("   and the body stay identical - that is what makes the consumer's");
    Console.WriteLine("   idempotency work - and the TIMESTAMP AND SIGNATURE ARE REGENERATED at");
    Console.WriteLine("   each attempt.");
    Console.WriteLine();
    Console.WriteLine("   THE BUG COMES FROM STORING THE WRONG THING. A delivery record that");
    Console.WriteLine("   holds a fully-built HTTP request is a record with an expiry date on it.");
    Console.WriteLine("   Store the event and the destination; build the request each time.");
    Console.WriteLine();
    Console.WriteLine("   AND IT ONLY APPEARS AFTER A LONG OUTAGE, which is exactly when the");
    Console.WriteLine("   retry machinery matters most. Early retries are inside the window and");
    Console.WriteLine("   pass, so the bug is invisible until the day it is load-bearing.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
async Task Exercise2()
{
    Console.WriteLine("EXERCISE 2 (medium) - the customer who pointed their webhook inward");
    Console.WriteLine();
    Console.WriteLine("   Customers configure their own webhook URL. One of them entered an");
    Console.WriteLine("   address on our own network.");
    Console.WriteLine();
    Console.WriteLine("   What can they reach, and what stops them?");
    Console.WriteLine();

    reached.Clear();

    using var naive = new HttpClient();

    string body = JsonSerializer.Serialize(new { id = "evt_01HQ8" });
    long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    Console.WriteLine("   the URL the customer configured                  what happened");
    Console.WriteLine("   -------------------------------                  -------------");

    // Straight at an internal address.
    string direct = await Post(naive, $"{baseAddress}/internal/admin/keys", body, now, Sign(Secret, now, body));

    Console.WriteLine($"   an internal address, directly                    {direct}");

    // A public-looking URL that redirects inward. HttpClient follows
    // redirects by default.
    string redirected = await Post(naive, $"{baseAddress}/hooks/redirector", body, now, Sign(Secret, now, body));

    Console.WriteLine($"   a public URL that 307s to an internal one        {redirected}");

    Console.WriteLine($"   internal endpoints actually reached              {reached.Count(r => r == "internal-admin")}");

    // The guarded sender.
    using var guarded = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false });

    reached.Clear();

    Console.WriteLine();
    Console.WriteLine("   with a guarded sender:");

    foreach ((string label, string url) in new[]
    {
        ("an internal address, directly", $"{baseAddress}/internal/admin/keys"),
        ("a public URL that 307s to an internal one", $"{baseAddress}/hooks/redirector")
    })
    {
        string outcome = IsAllowed(url)
            ? await Post(guarded, url, body, now, Sign(Secret, now, body))
            : "refused before sending";

        Console.WriteLine($"   {label,-46}   {outcome}");
    }

    Console.WriteLine($"   internal endpoints actually reached              {reached.Count(r => r == "internal-admin")}");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: ANYTHING THE SENDER CAN REACH. This is server-side request");
    Console.WriteLine("   forgery, and a webhook sender is the ideal vehicle for it: the customer");
    Console.WriteLine("   supplies the URL, we make the request from inside the network, and we");
    Console.WriteLine("   do it repeatedly and on a schedule.");
    Console.WriteLine();
    Console.WriteLine("   THE SECOND ROW IS THE ONE PEOPLE MISS. Validating the URL at");
    Console.WriteLine("   registration is not enough, because a public host can answer a redirect");
    Console.WriteLine("   to a private one - and HttpClient follows redirects by default. The");
    Console.WriteLine("   address that was checked is not the address that was called.");
    Console.WriteLine();
    Console.WriteLine("   FOUR THINGS ARE NEEDED, AND THE FIRST TWO ARE NOT OPTIONAL:");
    Console.WriteLine();
    Console.WriteLine("     TURN OFF AUTOMATIC REDIRECTS. A webhook has no reason to follow one.");
    Console.WriteLine();
    Console.WriteLine("     RESOLVE THE HOST AND CHECK THE RESOLVED ADDRESS - not the string -");
    Console.WriteLine("     against loopback, link-local (169.254.169.254 is the cloud metadata");
    Console.WriteLine("     service and it holds credentials), and every private range.");
    Console.WriteLine();
    Console.WriteLine("     REQUIRE HTTPS AND A PUBLIC PORT, so a customer cannot aim at an");
    Console.WriteLine("     internal service on a high port.");
    Console.WriteLine();
    Console.WriteLine("     AND SEND FROM SOMEWHERE THAT CANNOT REACH ANYTHING INTERESTING. An");
    Console.WriteLine("     egress proxy or a network policy makes the whole class of bug");
    Console.WriteLine("     unreachable rather than merely guarded against - which is the only");
    Console.WriteLine("     version that survives somebody refactoring the validation.");
    Console.WriteLine();
    Console.WriteLine("   AND NOTE THAT THE SIGNATURE DID NOT HELP AT ALL. It authenticates us to");
    Console.WriteLine("   the consumer; it says nothing about whether we should be calling this");
    Console.WriteLine("   address.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
async Task Exercise3()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the refund that un-refunded itself");
    Console.WriteLine();
    Console.WriteLine("   A payment was captured, then refunded four seconds later. The consumer");
    Console.WriteLine("   shows it as 'captured'. Both webhooks were delivered and both returned");
    Console.WriteLine("   200.");
    Console.WriteLine();
    Console.WriteLine("   What happened, and what makes it impossible?");
    Console.WriteLine();

    using var http = new HttpClient();

    Console.WriteLine("   consumer                       final state");
    Console.WriteLine("   --------                       -----------");

    foreach (bool guarded in new[] { false, true })
    {
        customerState.Clear();

        // 'captured' was delayed by a retry; 'refunded' went straight
        // through. They arrive in the wrong order.
        foreach (StateEvent update in new[]
        {
            new StateEvent("PAY-001", "refunded", 2),
            new StateEvent("PAY-001", "captured", 1)
        })
        {
            var message = new HttpRequestMessage(HttpMethod.Post, $"{baseAddress}/hooks/state")
            {
                Content = new StringContent(JsonSerializer.Serialize(update), Encoding.UTF8, "application/json")
            };

            if (guarded)
            {
                message.Headers.Add("x-guarded", "1");
            }

            await http.SendAsync(message);
        }

        (string Status, int Version) final = customerState["PAY-001"];

        Console.WriteLine($"   {(guarded ? "checks the version" : "applies what it is told"),-28}   " +
            $"{final.Status} (version {final.Version})");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE EVENTS ARRIVED IN THE WRONG ORDER AND THE CONSUMER APPLIED");
    Console.WriteLine("   THEM IN THE ORDER THEY ARRIVED. 'captured' was retried after a blip;");
    Console.WriteLine("   'refunded' was delivered first time. Both succeeded, so nothing anywhere");
    Console.WriteLine("   records a problem - and the wrong state is PERMANENT, because no");
    Console.WriteLine("   further event is coming.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS IN THE PAYLOAD, AND IT IS THE PRODUCER'S JOB. Every event");
    Console.WriteLine("   carries a monotonic version for its subject, and the consumer discards");
    Console.WriteLine("   anything not newer than what it holds. That is one integer and one");
    Console.WriteLine("   comparison, and it makes out-of-order delivery harmless instead of");
    Console.WriteLine("   catastrophic.");
    Console.WriteLine();
    Console.WriteLine("   NOTICE WHAT IT IS NOT: it is not ordering. We did not make the events");
    Console.WriteLine("   arrive in order - they still arrived backwards. WE MADE ORDER STOP");
    Console.WriteLine("   MATTERING, which is far cheaper than guaranteeing it and does not");
    Console.WriteLine("   collapse when one delivery is retried for six hours.");
    Console.WriteLine();
    Console.WriteLine("   AND IT PUSHES THE DESIGN THE RIGHT WAY. An event that carries the");
    Console.WriteLine("   CURRENT STATE plus a version is safe to apply out of order and safe to");
    Console.WriteLine("   apply twice. An event that carries a TRANSITION - 'add 5 to the");
    Console.WriteLine("   balance' - is safe to do neither. That choice is made once, before");
    Console.WriteLine("   anything is built, and it decides how hard every consumer's life is.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
async Task Exercise4()
{
    Console.WriteLine("EXERCISE 4 (hard) - the webhook that arrived before the payment existed");
    Console.WriteLine();
    Console.WriteLine("   Consumers occasionally call our API on receiving 'payment.captured' and");
    Console.WriteLine("   get a 404 for the payment we just told them about. It happens to maybe");
    Console.WriteLine("   one delivery in five hundred, and never in staging.");
    Console.WriteLine();
    Console.WriteLine("   Where is the race?");
    Console.WriteLine();

    using var http = new HttpClient();

    reached.Clear();
    ledger.Clear();

    Console.WriteLine("   when the event is sent                     consumer's read-back");
    Console.WriteLine("   ----------------------                     --------------------");

    // The way it is usually written: send the webhook inside the handler,
    // before the transaction commits.
    await Send("PAY-001");

    // The commit lands afterwards.
    ledger["PAY-001"] = "captured";

    Console.WriteLine($"   inside the handler, before the commit      {ReadBack()}");

    // The outbox way: the event is written in the same transaction and sent
    // by a separate worker, which by definition runs after the commit.
    ledger["PAY-002"] = "captured";

    await Send("PAY-002");

    Console.WriteLine($"   by a worker, after the commit              {ReadBack()}");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE EVENT WAS SENT BEFORE THE TRANSACTION COMMITTED. The");
    Console.WriteLine("   consumer received it, called back within a few milliseconds, and read a");
    Console.WriteLine("   database that did not yet contain the row.");
    Console.WriteLine();
    Console.WriteLine("   IT IS RARE AND IT IS NOT RANDOM. The window is the gap between the send");
    Console.WriteLine("   and the commit - normally microseconds, occasionally much longer when a");
    Console.WriteLine("   commit waits on a lock or a replica. STAGING NEVER SHOWS IT because");
    Console.WriteLine("   staging consumers are slower to call back than production ones.");
    Console.WriteLine();
    Console.WriteLine("   AND THERE IS A WORSE VERSION OF THE SAME BUG: IF THE TRANSACTION ROLLS");
    Console.WriteLine("   BACK, THE WEBHOOK HAS ALREADY GONE. We have told a customer about a");
    Console.WriteLine("   payment that does not exist and never will, and there is no event to");
    Console.WriteLine("   correct it with.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS THE OUTBOX, and it is the same pattern as a queued job. The");
    Console.WriteLine("   event is INSERTED IN THE SAME TRANSACTION as the state change, so it");
    Console.WriteLine("   commits or rolls back with it. A separate worker reads committed rows");
    Console.WriteLine("   and delivers them - by construction, after the commit.");
    Console.WriteLine();
    Console.WriteLine("   THE COST IS LATENCY, AND IT IS SMALL: the worker polls, so the webhook");
    Console.WriteLine("   goes out milliseconds later than it would have. THE PRICE OF NOT PAYING");
    Console.WriteLine("   IT IS A DUAL WRITE - two systems changed with no transaction across");
    Console.WriteLine("   them - and every dual write eventually disagrees.");
    Console.WriteLine();

    string ReadBack() => reached.FirstOrDefault(r => r.StartsWith("read-back")) ?? "none";

    async Task Send(string paymentId)
    {
        reached.Clear();

        var message = new HttpRequestMessage(HttpMethod.Post, $"{baseAddress}/hooks/reads-back")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new StateEvent(paymentId, "captured", 1)),
                Encoding.UTF8,
                "application/json")
        };

        await http.SendAsync(message);
    }
}

// ---------------------------------------------------------------------------
static async Task<string> Post(HttpClient http, string url, string body, long timestamp, string signature)
{
    var message = new HttpRequestMessage(HttpMethod.Post, url)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json")
    };

    message.Headers.Add("x-ledger-timestamp", timestamp.ToString());
    message.Headers.Add("x-ledger-signature", signature);

    HttpResponseMessage response = await http.SendAsync(message);

    return $"{(int)response.StatusCode} {response.StatusCode}";
}

// The check that has to happen against the RESOLVED address, every time, and
// with redirects turned off.
static bool IsAllowed(string url)
{
    if (!Uri.TryCreate(url, UriKind.Absolute, out Uri? uri))
    {
        return false;
    }

    foreach (IPAddress address in Dns.GetHostAddresses(uri.Host))
    {
        if (IPAddress.IsLoopback(address)
            || address.IsIPv4MappedToIPv6
            || IsPrivate(address))
        {
            return false;
        }
    }

    return true;
}

static bool IsPrivate(IPAddress address)
{
    byte[] bytes = address.GetAddressBytes();

    return bytes.Length == 4
        && (bytes[0] == 10
            || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
            || (bytes[0] == 192 && bytes[1] == 168)
            || (bytes[0] == 169 && bytes[1] == 254));
}

static string Sign(string secret, long timestamp, string body)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));

    return "v1=" + Convert.ToHexStringLower(
        hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{body}")));
}

// ---------------------------------------------------------------------------
public sealed record StateEvent(string PaymentId, string Status, int Version);
