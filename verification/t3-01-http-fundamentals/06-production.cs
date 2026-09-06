// 06-production.cs — Ledger's duplicate charges, and the four HTTP decisions
// that caused and then fixed them.
//
// The incident: 1.4% of payments were charged twice over a weekend. No
// exception was logged, no alert fired, and the API returned 200 every time.
// Nothing in the code was wrong in the sense of throwing.
//
// Run:  dotnet run 06-production.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic and reproduces on every
// run. The charge counts are what the server actually did.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Net;
using System.Net.Http.Json;

var chargesV1 = new List<Charge>();
var chargesV2 = new List<Charge>();
var idempotencyKeys = new Dictionary<string, StoredResult>();
var chargesV3 = new List<Charge>();
var idempotencyKeysV3 = new System.Collections.Concurrent.ConcurrentDictionary<string, StoredResult>();
int gatewayCalls = 0;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// ---------------------------------------------------------------------------
// THE ORIGINAL. Four separate mistakes, none of which throws.
// ---------------------------------------------------------------------------
app.MapPost("/v1/payments", async (PaymentRequest request) =>
{
    // Mistake 1: the gateway call is slow enough to hit the client's timeout.
    await Task.Delay(60);
    gatewayCalls++;

    chargesV1.Add(new Charge($"CHG-{chargesV1.Count + 1:D4}", request.AmountMinor));

    // Mistake 2: 200 OK for a creation, with no Location header, so the client
    // has no identity to check against on a retry.
    // Mistake 3: the failure path (not shown) also returns 200 with an error
    // in the body, so no layer can tell success from failure.
    return Results.Ok(new { success = true, chargeId = chargesV1[^1].Id });
});

// ---------------------------------------------------------------------------
// THE FIX. The same handler, with the four decisions made deliberately.
// ---------------------------------------------------------------------------
app.MapPost("/v2/payments", async (PaymentRequest request, HttpRequest http) =>
{
    // Fix 1: an idempotency key makes a non-idempotent method safe to retry.
    string? key = http.Headers["Idempotency-Key"].FirstOrDefault();
    if (string.IsNullOrWhiteSpace(key))
    {
        // 400, because the request is malformed - a required header is absent.
        return Results.BadRequest(new { error = "Idempotency-Key header is required" });
    }

    // Fix 2: a repeat of a key returns the FIRST result rather than acting
    // again. This is what makes the endpoint safe for a client to retry.
    if (idempotencyKeys.TryGetValue(key, out StoredResult? stored))
    {
        return Results.Created($"/v2/payments/{stored.ChargeId}",
            new { chargeId = stored.ChargeId, replayed = true });
    }

    await Task.Delay(60);
    gatewayCalls++;

    var charge = new Charge($"CHG-{chargesV2.Count + 1:D4}", request.AmountMinor);
    chargesV2.Add(charge);
    idempotencyKeys[key] = new StoredResult(charge.Id);

    // Fix 3: 201 Created with a Location header, so the client has an identity.
    // Fix 4: the status LINE carries the outcome, not a field in the body.
    return Results.Created($"/v2/payments/{charge.Id}",
        new { chargeId = charge.Id, replayed = false });
});

// ---------------------------------------------------------------------------
// THE FIX, CORRECTED. v2 records the key AFTER the gateway call, so two
// attempts already in flight both miss it. v3 RESERVES the key first.
// ---------------------------------------------------------------------------
app.MapPost("/v3/payments", async (PaymentRequest request, HttpRequest http) =>
{
    string? key = http.Headers["Idempotency-Key"].FirstOrDefault();
    if (string.IsNullOrWhiteSpace(key))
    {
        return Results.BadRequest(new { error = "Idempotency-Key header is required" });
    }

    // Reserve the key BEFORE the slow work, atomically. TryAdd is the whole
    // fix: exactly one caller gets true, so exactly one calls the gateway.
    // In a real service this is a unique constraint on an insert.
    var reservation = new StoredResult(ChargeId: null);
    if (!idempotencyKeysV3.TryAdd(key, reservation))
    {
        // Somebody else owns this key. Either they finished - return their
        // result - or they are still working, and the honest answer is 409
        // so the client retries rather than being told a lie.
        StoredResult existing = idempotencyKeysV3[key];
        return existing.ChargeId is null
            ? Results.Conflict(new { error = "a request with this key is in progress" })
            : Results.Created($"/v3/payments/{existing.ChargeId}",
                new { chargeId = existing.ChargeId, replayed = true });
    }

    await Task.Delay(60);
    gatewayCalls++;

    var charge = new Charge($"CHG-{chargesV3.Count + 1:D4}", request.AmountMinor);
    chargesV3.Add(charge);
    idempotencyKeysV3[key] = new StoredResult(charge.Id);

    return Results.Created($"/v3/payments/{charge.Id}",
        new { chargeId = charge.Id, replayed = false });
});

app.MapGet("/v2/payments/{id}", (string id) =>
{
    Charge? charge = chargesV2.FirstOrDefault(c => c.Id == id);
    return charge is null ? Results.NotFound() : Results.Ok(charge);
});

await app.StartAsync();
string baseUrl = app.Urls.First();

await TheIncident(baseUrl, chargesV1);
await TheFix(baseUrl, chargesV2, idempotencyKeys, chargesV3);
await KeyDesign(baseUrl, chargesV2, idempotencyKeys);
Verdict();

Console.WriteLine();
Console.WriteLine($"   (the gateway was called {gatewayCalls} times in total across this run)");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task TheIncident(string baseUrl, List<Charge> charges)
{
    Console.WriteLine("1. The incident, reproduced");
    Console.WriteLine();

    charges.Clear();

    // A client with a 40 ms timeout calling a handler that takes 60 ms, with
    // two retries. This is an ordinary resilience policy.
    using var http = new HttpClient
    {
        BaseAddress = new Uri(baseUrl),
        Timeout = TimeSpan.FromMilliseconds(40)
    };

    int attempts = 0;
    int timeouts = 0;

    for (int attempt = 1; attempt <= 3; attempt++)
    {
        attempts++;
        try
        {
            HttpResponseMessage response = await http.PostAsJsonAsync("/v1/payments",
                new PaymentRequest(123_450));

            Console.WriteLine($"   attempt {attempt}: {(int)response.StatusCode}");
            break;
        }
        catch (TaskCanceledException)
        {
            timeouts++;
            Console.WriteLine($"   attempt {attempt}: TIMED OUT after 40 ms");
        }
    }

    // Let the in-flight work finish before counting.
    await Task.Delay(300);

    Console.WriteLine();
    Console.WriteLine($"   client attempts   : {attempts}");
    Console.WriteLine($"   client timeouts   : {timeouts}");
    Console.WriteLine($"   charges created   : {charges.Count}");
    Console.WriteLine();
    Console.WriteLine("   The customer was charged once per attempt. From the client's side");
    Console.WriteLine("   every attempt failed; from the server's side every attempt");
    Console.WriteLine("   succeeded. Both are correct, and that is the whole problem.");
    Console.WriteLine();
    Console.WriteLine("   A TIMEOUT TELLS YOU NOTHING about whether the server acted. The");
    Console.WriteLine("   request may have been lost outbound, processed and lost on the way");
    Console.WriteLine("   back, or still be running when you gave up.");
    Console.WriteLine();
    Console.WriteLine("   Four decisions made this possible, and none of them threw:");
    Console.WriteLine();
    Console.WriteLine("     1. POST is not idempotent, and the endpoint offered no way to");
    Console.WriteLine("        make a retry safe.");
    Console.WriteLine("     2. 200 OK rather than 201 Created with a Location, so the client");
    Console.WriteLine("        had no identity to check before retrying.");
    Console.WriteLine("     3. Failures were also 200, with the outcome in the body, so no");
    Console.WriteLine("        retry policy or dashboard could see them.");
    Console.WriteLine("     4. The client timeout was shorter than the handler's own work,");
    Console.WriteLine("        which guarantees the race rather than merely allowing it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheFix(string baseUrl, List<Charge> chargesV2, Dictionary<string, StoredResult> keysV2,
    List<Charge> chargesV3)
{
    Console.WriteLine("2. The same three attempts against the fixed endpoint");
    Console.WriteLine();

    chargesV2.Clear();
    keysV2.Clear();
    chargesV3.Clear();

    int v2 = await AttemptAsync(baseUrl, "/v2/payments");
    int v3 = await AttemptAsync(baseUrl, "/v3/payments");

    Console.WriteLine();
    Console.WriteLine($"   v1, no key                         : 3 charges");
    Console.WriteLine($"   v2, key recorded AFTER the work    : {chargesV2.Count} charge{(chargesV2.Count == 1 ? "" : "s")}");
    Console.WriteLine($"   v3, key reserved BEFORE the work   : {chargesV3.Count} charge{(chargesV3.Count == 1 ? "" : "s")}");
    Console.WriteLine();
    Console.WriteLine("   Read the middle row carefully, because it is the interesting one");
    Console.WriteLine("   and it is not what the first draft of this file predicted.");
    Console.WriteLine();
    Console.WriteLine("   v2 has an idempotency key, checks it, stores it, and returns the");
    Console.WriteLine("   first result on a replay. It still charged TWICE.");
    Console.WriteLine();
    Console.WriteLine("   The reason is the order of two lines. v2 records the key AFTER the");
    Console.WriteLine("   60 ms gateway call, so:");
    Console.WriteLine();
    Console.WriteLine("     t=0    attempt 1 arrives, finds no key, starts the gateway call");
    Console.WriteLine("     t=40   attempt 1 times out client-side and attempt 2 is sent");
    Console.WriteLine("     t=40   attempt 2 arrives, finds NO KEY YET, starts a second call");
    Console.WriteLine("     t=60   attempt 1 finishes and records the key");
    Console.WriteLine("     t=80   attempt 3 arrives, finds the key, replays correctly");
    Console.WriteLine();
    Console.WriteLine("   The check and the write are a CHECK-THEN-ACT race with a 60 ms");
    Console.WriteLine("   window in the middle. An idempotency key that is written after the");
    Console.WriteLine("   work only protects against retries that arrive after it completes -");
    Console.WriteLine("   which is precisely the retries you were not worried about.");
    Console.WriteLine();
    Console.WriteLine("   v3 reserves the key FIRST, atomically, before doing anything:");
    Console.WriteLine();
    Console.WriteLine("     if (!keys.TryAdd(key, reserved)) { ...somebody else owns it... }");
    Console.WriteLine();
    Console.WriteLine("   Exactly one caller gets true, so exactly one calls the gateway. The");
    Console.WriteLine("   losers either replay a finished result or get 409 while it is still");
    Console.WriteLine("   running. One charge from three attempts.");
    Console.WriteLine();
    Console.WriteLine("   In a real service TryAdd is a UNIQUE CONSTRAINT on an insert, and");
    Console.WriteLine("   the reservation and the charge belong in one transaction. The");
    Console.WriteLine("   principle is the same: claim the key before doing the work, not");
    Console.WriteLine("   after.");
    Console.WriteLine();
    Console.WriteLine("   A 409 for an in-flight duplicate is deliberate. The alternatives");
    Console.WriteLine("   are worse: waiting for the first attempt holds a connection open,");
    Console.WriteLine("   and returning success before the gateway has answered is a lie.");
    Console.WriteLine();

    static async Task<int> AttemptAsync(string baseUrl, string path)
    {
        using var http = new HttpClient
        {
            BaseAddress = new Uri(baseUrl),
            Timeout = TimeSpan.FromMilliseconds(40)
        };

        // Generated ONCE for the logical operation, not per attempt.
        string idempotencyKey = Guid.NewGuid().ToString();
        int completed = 0;

        Console.WriteLine($"   {path}");

        for (int attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, path)
                {
                    Content = JsonContent.Create(new PaymentRequest(123_450))
                };

                request.Headers.Add("Idempotency-Key", idempotencyKey);

                HttpResponseMessage response = await http.SendAsync(request);
                string body = await response.Content.ReadAsStringAsync();

                Console.WriteLine($"     attempt {attempt}: {(int)response.StatusCode} {body}");
                completed++;
                break;
            }
            catch (TaskCanceledException)
            {
                Console.WriteLine($"     attempt {attempt}: TIMED OUT after 40 ms");
            }
        }

        // Let any in-flight server work finish before the caller counts.
        await Task.Delay(300);
        return completed;
    }
}

// ---------------------------------------------------------------------------
static async Task KeyDesign(string baseUrl, List<Charge> charges, Dictionary<string, StoredResult> keys)
{
    Console.WriteLine("3. Getting the key itself right");
    Console.WriteLine();

    charges.Clear();
    keys.Clear();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    // WRONG: a new key per attempt. The server sees three different operations.
    for (int attempt = 1; attempt <= 3; attempt++)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/v2/payments")
        {
            Content = JsonContent.Create(new PaymentRequest(123_450))
        };

        request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        await http.SendAsync(request);
    }

    int withNewKeys = charges.Count;

    charges.Clear();
    keys.Clear();

    // RIGHT: one key for the logical operation, reused across attempts.
    string stableKey = Guid.NewGuid().ToString();
    for (int attempt = 1; attempt <= 3; attempt++)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/v2/payments")
        {
            Content = JsonContent.Create(new PaymentRequest(123_450))
        };

        request.Headers.Add("Idempotency-Key", stableKey);
        await http.SendAsync(request);
    }

    int withStableKey = charges.Count;

    // And a missing key is rejected rather than silently accepted.
    HttpResponseMessage noKey = await http.PostAsJsonAsync("/v2/payments",
        new PaymentRequest(123_450));

    Console.WriteLine($"   a NEW key per attempt      : {withNewKeys} charge{(withNewKeys == 1 ? "" : "s")}");
    Console.WriteLine($"   ONE key for the operation  : {withStableKey} charge{(withStableKey == 1 ? "" : "s")}");
    Console.WriteLine($"   no key at all              : {(int)noKey.StatusCode} {noKey.StatusCode}");
    Console.WriteLine();
    Console.WriteLine("   The header does not make anything idempotent by existing. The key");
    Console.WriteLine("   must identify the OPERATION, so it is generated once by whoever");
    Console.WriteLine("   decides to make the payment - not inside the retry loop, and not");
    Console.WriteLine("   by the HTTP layer.");
    Console.WriteLine();
    Console.WriteLine("   Generating it per attempt is the most common way this is got wrong,");
    Console.WriteLine("   and it produces exactly the original bug while looking correct in");
    Console.WriteLine("   review.");
    Console.WriteLine();
    Console.WriteLine("   Three more decisions a real implementation has to make:");
    Console.WriteLine();
    Console.WriteLine("     - HOW LONG to keep keys. Long enough to outlive any retry a");
    Console.WriteLine("       client will make - 24 hours is a common answer. They are state,");
    Console.WriteLine("       and unbounded state is a leak.");
    Console.WriteLine();
    Console.WriteLine("     - WHAT IF THE BODY DIFFERS for the same key? That is a client bug.");
    Console.WriteLine("       Store a hash of the request with the key and return 422 when it");
    Console.WriteLine("       does not match, rather than silently replaying the wrong result.");
    Console.WriteLine();
    Console.WriteLine("     - WHAT IF TWO ATTEMPTS ARRIVE AT ONCE? The dictionary lookup above");
    Console.WriteLine("       is check-then-act. Under real concurrency it needs the key");
    Console.WriteLine("       inserted atomically - a unique constraint in the database - or");
    Console.WriteLine("       both requests miss the cache and charge.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Verdict()
{
    Console.WriteLine("4. What to take from this");
    Console.WriteLine();
    Console.WriteLine("   Every fix was an HTTP decision rather than a code fix:");
    Console.WriteLine();
    Console.WriteLine("     the method's semantics    POST is not idempotent, so say how to");
    Console.WriteLine("                               retry it safely");
    Console.WriteLine("     the status code           201 and Location give the client an");
    Console.WriteLine("                               identity to check");
    Console.WriteLine("     the status LINE           carries the outcome, so every layer can");
    Console.WriteLine("                               see it");
    Console.WriteLine("     a header                  makes a non-idempotent operation safe");
    Console.WriteLine("                               to repeat");
    Console.WriteLine();
    Console.WriteLine("   And one that is not HTTP at all: the client timeout was shorter");
    Console.WriteLine("   than the server's own work. That converts a rare race into a");
    Console.WriteLine("   guaranteed one, and no amount of protocol correctness fixes it.");
    Console.WriteLine();
    Console.WriteLine("   Timeouts must be set from the downstream's measured p99 upward, not");
    Console.WriteLine("   chosen as a round number - which is the subject of the HttpClient");
    Console.WriteLine("   module later in this track.");
}

// ---------------------------------------------------------------------------
record PaymentRequest(long AmountMinor);

record Charge(string Id, long AmountMinor);

record StoredResult(string? ChargeId);
