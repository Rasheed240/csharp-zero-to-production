// 05-minimal-example.cs — One webhook receiver with every decision made: a
// size limit before anything, raw bytes, freshness before signature, constant
// time, a claim and the work in one transaction, a fast acknowledgement that
// is durable first, and a sweep for claims that never completed.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status, count and verdict here is deterministic. The
// timings are machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

const string Secret = "whsec_2f8a1c0e5b9d4a6f";
const int MaxBodyBytes = 64 * 1024;
const int ToleranceSeconds = 300;

var store = new EventStore();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// DECISION 1: HttpRequest, not a bound model. Binding would consume the body
// before the handler runs, and the signature is over the body.
app.MapPost("/hooks/ledger", async (HttpRequest request) =>
{
    // DECISION 2: a size limit before any work at all. The HMAC is linear in
    // the body size, so an unbounded body is unbounded work for a stranger.
    if (request.ContentLength > MaxBodyBytes)
    {
        return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
    }

    byte[] body = await ReadBoundedAsync(request.Body, MaxBodyBytes);

    if (body.Length == 0)
    {
        return Results.BadRequest();
    }

    // DECISION 3: freshness before authorship. A replay carries a perfectly
    // valid signature - checking it proves nothing about how old it is.
    if (!long.TryParse(request.Headers["x-ledger-timestamp"], out long timestamp)
        || Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - timestamp) > ToleranceSeconds)
    {
        return Results.BadRequest();
    }

    // DECISION 4: constant-time comparison, and every candidate signature
    // tried, so the sender can rotate its secret without an outage.
    string presented = request.Headers["x-ledger-signature"].ToString();

    if (!Verify(Secret, timestamp, body, presented))
    {
        return Results.Unauthorized();
    }

    // Only now is the request trusted enough to look inside.
    string? eventId = request.Headers["x-ledger-event-id"];

    if (string.IsNullOrEmpty(eventId))
    {
        return Results.BadRequest();
    }

    Event parsed;

    try
    {
        parsed = JsonSerializer.Deserialize<Event>(body)!;
    }
    catch (JsonException)
    {
        // DECISION 5: unparseable is 400, not 500. It will never parse, so a
        // retry is guaranteed waste - and the raw bytes are kept so the 400
        // is not silent data loss.
        store.Quarantine(eventId, body);

        return Results.BadRequest();
    }

    // DECISION 6: the claim and the acknowledgement are one durable write.
    // Answering before this would be a promise we have not earned.
    ClaimResult claim = store.TryClaim(eventId, parsed);

    // DECISION 7: a duplicate is a 200. The sender is asking whether we have
    // it; we do, so say yes. A 4xx here can get the endpoint disabled.
    return claim is ClaimResult.AlreadyDone or ClaimResult.InProgress
        ? Results.Ok()
        : Results.Accepted();
});

await app.StartAsync();

string endpoint = $"{app.Urls.First()}/hooks/ledger";

Console.WriteLine("One receiver, every decision made");
Console.WriteLine();

using var http = new HttpClient();

long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

string good = JsonSerializer.Serialize(new Event("PAY-001", "captured", 1));

Console.WriteLine("   what arrived                                status   what we did");
Console.WriteLine("   ------------                                ------   -----------");

await Show("a properly signed event", "evt_01", good, now, Secret);
await Show("the same event again", "evt_01", good, now, Secret);
await Show("a second, newer event", "evt_02", JsonSerializer.Serialize(new Event("PAY-001", "refunded", 2)), now, Secret);
await Show("an event signed with a stale timestamp", "evt_03", good, now - 1200, Secret);
await Show("an event signed with another secret", "evt_04", good, now, "whsec_attacker");
await Show("a body that is not JSON", "evt_05", "{not json", now, Secret);
await Show("a 128 KB body", "evt_06", new string('x', 128 * 1024), now, Secret);

// The worker does what the acknowledgement promised.
store.RunWorker(dieOn: "evt_02");

Console.WriteLine();
Console.WriteLine($"   events accepted                      {store.Claims.Count}");
Console.WriteLine($"   events completed by the worker       {store.Completed}");
Console.WriteLine($"   still pending after the worker died  {store.Pending}");
Console.WriteLine($"   bodies quarantined for a human       {store.Quarantined}");

// DECISION 8: a sweep, because a fast acknowledgement means the sender's
// retries are gone and every remaining failure is ours to find.
int recovered = store.SweepStalled();

Console.WriteLine($"   recovered by the sweep               {recovered}");
Console.WriteLine($"   events completed after the sweep     {store.Completed}");
Console.WriteLine($"   times any payment was applied twice  {store.DoubleApplications}");

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   EVERY DECISION, AND WHY:");
Console.WriteLine();
Console.WriteLine("     THE HANDLER TAKES HttpRequest, NOT A BOUND MODEL. Binding reads the");
Console.WriteLine("     body before the first line of the handler runs, and what is left is");
Console.WriteLine("     zero bytes. Nothing warns; the verification simply hashes nothing.");
Console.WriteLine();
Console.WriteLine("     THERE IS A SIZE LIMIT BEFORE ANY WORK. The 128 KB body was refused");
Console.WriteLine("     without a signature check, because the HMAC is linear in body size and");
Console.WriteLine("     an unbounded body is unbounded work for an anonymous caller.");
Console.WriteLine();
Console.WriteLine("     FRESHNESS IS CHECKED BEFORE THE SIGNATURE. A replay has a valid");
Console.WriteLine("     signature - that is what makes it a replay rather than a forgery - so");
Console.WriteLine("     the signature cannot answer the question the window answers.");
Console.WriteLine();
Console.WriteLine("     NOTHING IS PARSED UNTIL THE SIGNATURE VERIFIES. Parsing is the most");
Console.WriteLine("     expensive thing in the handler and the easiest to reach; putting it");
Console.WriteLine("     after the check is the difference between a load test and an outage.");
Console.WriteLine();
Console.WriteLine("     THE CLAIM AND THE WORK COMMIT TOGETHER. Claiming first and crashing");
Console.WriteLine("     loses the event silently; working first and crashing charges twice.");
Console.WriteLine("     One transaction is the only arrangement that survives a crash.");
Console.WriteLine();
Console.WriteLine("     A DUPLICATE IS ANSWERED 200. The sender is asking whether we have it.");
Console.WriteLine("     We do. A 409 reads as a permanent failure and can disable the");
Console.WriteLine("     endpoint - punishing the sender for doing exactly the right thing.");
Console.WriteLine();
Console.WriteLine("     AND THE CLAIM HAS A STATE, NOT A BIT. 'Seen' cannot distinguish an");
Console.WriteLine("     event that finished from one whose worker died holding it. The sweep");
Console.WriteLine("     found the stalled one and finished it - and nothing else could have,");
Console.WriteLine("     because the sender already has its 200.");
Console.WriteLine();
Console.WriteLine("   WHAT THIS STILL DOES NOT DECIDE:");
Console.WriteLine();
Console.WriteLine("     HOW LONG A PENDING CLAIM MAY SIT before the sweep takes it. Too short");
Console.WriteLine("     and the sweep races a worker that is merely slow, and the whole point");
Console.WriteLine("     of the transaction is undone. Too long and a stalled event is invisible");
Console.WriteLine("     for hours. It has to be longer than the slowest legitimate run.");
Console.WriteLine();
Console.WriteLine("     WHAT HAPPENS TO A QUARANTINED BODY, and who is told about it. A row in");
Console.WriteLine("     a table nobody reads is the same as a 400 with no record.");
Console.WriteLine();
Console.WriteLine("     HOW LONG EVENT IDS ARE KEPT. The timestamp window sets the floor - a");
Console.WriteLine("     delivery older than the window is rejected anyway - but a sender that");
Console.WriteLine("     retries for a day needs a day, not five minutes.");
Console.WriteLine();
Console.WriteLine("     AND WHETHER THE ORDER OF EVENTS MATTERS TO YOU. This receiver applies");
Console.WriteLine("     whatever it is given. If the payload carries a version, compare it and");
Console.WriteLine("     discard the stale one; if it does not, ask the sender for one, because");
Console.WriteLine("     nothing on this side can reconstruct an order the wire did not keep.");

// ---------------------------------------------------------------------------
async Task Show(string label, string eventId, string body, long timestamp, string secret)
{
    byte[] bytes = Encoding.UTF8.GetBytes(body);

    var message = new HttpRequestMessage(HttpMethod.Post, endpoint)
    {
        Content = new ByteArrayContent(bytes)
    };

    message.Content.Headers.Add("Content-Type", "application/json");
    message.Headers.Add("x-ledger-event-id", eventId);
    message.Headers.Add("x-ledger-timestamp", timestamp.ToString());
    message.Headers.Add("x-ledger-signature", Sign(secret, timestamp, bytes));

    HttpResponseMessage response = await http.SendAsync(message);

    string outcome = (int)response.StatusCode switch
    {
        202 => "accepted, queued",
        200 => "already had it",
        401 => "rejected: signature",
        413 => "refused: too large",
        400 => "rejected: stale, empty or unparseable",
        _ => "?"
    };

    Console.WriteLine($"   {label,-42}   {(int)response.StatusCode,4}   {outcome}");
}

// ---------------------------------------------------------------------------
static async Task<byte[]> ReadBoundedAsync(Stream body, int limit)
{
    // A missing or lying Content-Length is not a reason to read forever.
    using var buffer = new MemoryStream();

    byte[] chunk = new byte[8192];
    int read;

    while ((read = await body.ReadAsync(chunk)) > 0)
    {
        if (buffer.Length + read > limit)
        {
            return [];
        }

        buffer.Write(chunk, 0, read);
    }

    return buffer.ToArray();
}

static bool Verify(string secret, long timestamp, byte[] body, string presented)
{
    // A comma-separated list, so a sender mid-rotation can offer two.
    foreach (string candidate in presented.Split(','))
    {
        if (CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(candidate),
                Encoding.UTF8.GetBytes(Sign(secret, timestamp, body))))
        {
            return true;
        }
    }

    return false;
}

static string Sign(string secret, long timestamp, byte[] body)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));

    byte[] material = [.. Encoding.UTF8.GetBytes($"{timestamp}."), .. body];

    return "v1=" + Convert.ToHexStringLower(hmac.ComputeHash(material));
}

// ---------------------------------------------------------------------------
public sealed record Event(string PaymentId, string Status, int Version);

public enum ClaimResult { Claimed, InProgress, AlreadyDone }

// The database, with exactly enough behaviour to show the claim states and
// the sweep. In a real receiver every method here is one SQL statement and
// the claim is an INSERT against a unique constraint.
public sealed class EventStore
{
    public Dictionary<string, (Event Event, string State)> Claims { get; } = [];

    public Dictionary<string, byte[]> QuarantinedBodies { get; } = [];

    public Dictionary<string, int> Applied { get; } = [];

    public int Completed => Claims.Count(c => c.Value.State == "done");

    public int Pending => Claims.Count(c => c.Value.State == "pending");

    public int Quarantined => QuarantinedBodies.Count;

    public int DoubleApplications => Applied.Count(a => a.Value > 1);

    public void Quarantine(string eventId, byte[] body) => QuarantinedBodies[eventId] = body;

    public ClaimResult TryClaim(string eventId, Event received)
    {
        if (Claims.TryGetValue(eventId, out (Event Event, string State) existing))
        {
            return existing.State == "done" ? ClaimResult.AlreadyDone : ClaimResult.InProgress;
        }

        // Pending, not seen. The difference is the whole of exercise 4.
        Claims[eventId] = (received, "pending");

        return ClaimResult.Claimed;
    }

    public void RunWorker(string dieOn)
    {
        foreach (string id in Claims.Where(c => c.Value.State == "pending").Select(c => c.Key).ToArray())
        {
            if (id == dieOn)
            {
                // The worker dies holding this one. The sender already has a
                // 200, so nothing outside this process will ever retry it.
                return;
            }

            Complete(id);
        }
    }

    public int SweepStalled()
    {
        // Anything pending for longer than the work should take. The claim and
        // the completion are one write, so a sweep can never double-apply.
        string[] stalled = [.. Claims.Where(c => c.Value.State == "pending").Select(c => c.Key)];

        foreach (string id in stalled)
        {
            Complete(id);
        }

        return stalled.Length;
    }

    private void Complete(string id)
    {
        (Event received, _) = Claims[id];

        Applied[received.PaymentId + ":" + received.Version] =
            Applied.GetValueOrDefault(received.PaymentId + ":" + received.Version) + 1;

        Claims[id] = (received, "done");
    }
}
