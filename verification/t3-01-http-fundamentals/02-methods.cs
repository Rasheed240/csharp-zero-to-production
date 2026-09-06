// 02-methods.cs — Safe, idempotent, cacheable: three different properties that
// get conflated, demonstrated by repeating requests against a stateful server.
//
// Run:  dotnet run 02-methods.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic. The server holds real
// state and the repeat counts are what the state ends up as.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Net;
using System.Net.Http.Json;

var payments = new Dictionary<string, Payment>();
var audit = new List<string>();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// GET - safe: it must not change anything.
app.MapGet("/payments/{id}", (string id) =>
{
    audit.Add($"GET {id}");
    return payments.TryGetValue(id, out Payment? p) ? Results.Ok(p) : Results.NotFound();
});

// POST - neither safe nor idempotent. Each call creates a NEW resource.
app.MapPost("/payments", (PaymentRequest request) =>
{
    string id = $"PAY-{payments.Count + 1:D4}";
    payments[id] = new Payment(id, request.AmountMinor, "settled");
    audit.Add($"POST -> {id}");
    return Results.Created($"/payments/{id}", payments[id]);
});

// PUT - idempotent: the caller supplies the identity, so repeating it lands
// on the same resource with the same content.
app.MapPut("/payments/{id}", (string id, PaymentRequest request) =>
{
    bool existed = payments.ContainsKey(id);
    payments[id] = new Payment(id, request.AmountMinor, "settled");
    audit.Add($"PUT {id}");
    return existed ? Results.NoContent() : Results.Created($"/payments/{id}", payments[id]);
});

// DELETE - idempotent: after the first call the resource is gone, and it
// stays gone.
app.MapDelete("/payments/{id}", (string id) =>
{
    bool removed = payments.Remove(id);
    audit.Add($"DELETE {id} (removed: {removed})");
    return Results.NoContent();
});

// A GET that changes state. Legal HTTP, and a bug.
app.MapGet("/payments/{id}/cancel", (string id) =>
{
    if (!payments.TryGetValue(id, out Payment? p))
    {
        return Results.NotFound();
    }

    payments[id] = p with { Status = "cancelled" };
    audit.Add($"GET-cancel {id}");
    return Results.Ok(payments[id]);
});

await app.StartAsync();
string baseUrl = app.Urls.First();

using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

await TheThreeProperties();
await RepeatPost(http, payments);
await RepeatPut(http, payments);
await RepeatDelete(http, payments);
await UnsafeGet(http, payments);
Summary();

await app.StopAsync();

// ---------------------------------------------------------------------------
static Task TheThreeProperties()
{
    Console.WriteLine("1. Three properties that are not the same thing");
    Console.WriteLine();
    Console.WriteLine("   SAFE       the request does not change server state at all.");
    Console.WriteLine("              A crawler may call it. A browser may prefetch it.");
    Console.WriteLine();
    Console.WriteLine("   IDEMPOTENT calling it N times leaves the same state as calling it");
    Console.WriteLine("              once. It may still CHANGE state, but not cumulatively.");
    Console.WriteLine();
    Console.WriteLine("   CACHEABLE  the response may be stored and reused.");
    Console.WriteLine();
    Console.WriteLine("   method    safe   idempotent   cacheable");
    Console.WriteLine("   ------    ----   ----------   ---------");
    Console.WriteLine("   GET       yes    yes          yes");
    Console.WriteLine("   HEAD      yes    yes          yes");
    Console.WriteLine("   OPTIONS   yes    yes          no");
    Console.WriteLine("   PUT       no     yes          no");
    Console.WriteLine("   DELETE    no     yes          no");
    Console.WriteLine("   POST      no     NO           rarely");
    Console.WriteLine("   PATCH     no     NO           no");
    Console.WriteLine();
    Console.WriteLine("   Every safe method is idempotent - changing nothing N times is the");
    Console.WriteLine("   same as changing nothing once. The reverse is not true: PUT and");
    Console.WriteLine("   DELETE change state and are still idempotent.");
    Console.WriteLine();
    Console.WriteLine("   POST and PATCH are the two that are NOT idempotent, and that is");
    Console.WriteLine("   the entire reason retry logic is dangerous. The rest of this file");
    Console.WriteLine("   measures what that means.");
    Console.WriteLine();
    return Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static async Task RepeatPost(HttpClient http, Dictionary<string, Payment> payments)
{
    Console.WriteLine("2. POST repeated three times");
    Console.WriteLine();

    payments.Clear();

    for (int attempt = 1; attempt <= 3; attempt++)
    {
        HttpResponseMessage response = await http.PostAsJsonAsync("/payments",
            new PaymentRequest(123_450));

        Console.WriteLine($"   attempt {attempt}: {(int)response.StatusCode} {response.StatusCode}, " +
            $"Location: {response.Headers.Location}");
    }

    Console.WriteLine();
    Console.WriteLine($"   payments now on the server: {payments.Count}");
    foreach ((string id, Payment p) in payments)
    {
        Console.WriteLine($"     {id}: {p.AmountMinor} minor units");
    }

    Console.WriteLine();
    Console.WriteLine("   THREE payments. The client sent the same request three times -");
    Console.WriteLine("   which is exactly what a retry does after a timeout - and the");
    Console.WriteLine("   customer has been charged three times.");
    Console.WriteLine();
    Console.WriteLine("   Note this is not a bug in the server. POST means 'create a new");
    Console.WriteLine("   subordinate resource', and it did that three times, correctly.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task RepeatPut(HttpClient http, Dictionary<string, Payment> payments)
{
    Console.WriteLine("3. PUT repeated three times");
    Console.WriteLine();

    payments.Clear();

    for (int attempt = 1; attempt <= 3; attempt++)
    {
        HttpResponseMessage response = await http.PutAsJsonAsync("/payments/PAY-0001",
            new PaymentRequest(123_450));

        Console.WriteLine($"   attempt {attempt}: {(int)response.StatusCode} {response.StatusCode}");
    }

    Console.WriteLine();
    Console.WriteLine($"   payments now on the server: {payments.Count}");
    Console.WriteLine();
    Console.WriteLine("   ONE payment, whatever the number of attempts. The difference is");
    Console.WriteLine("   that the CLIENT chose the identity, so the second request lands on");
    Console.WriteLine("   the resource the first one created.");
    Console.WriteLine();
    Console.WriteLine("   Notice the status codes differ: 201 for the first, 204 for the");
    Console.WriteLine("   rest. Idempotent means the STATE is the same, not that the");
    Console.WriteLine("   response is identical. A retry that only accepts 201 will treat a");
    Console.WriteLine("   successful retry as a failure.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task RepeatDelete(HttpClient http, Dictionary<string, Payment> payments)
{
    Console.WriteLine("4. DELETE repeated three times");
    Console.WriteLine();

    payments.Clear();
    payments["PAY-0001"] = new Payment("PAY-0001", 123_450, "settled");

    for (int attempt = 1; attempt <= 3; attempt++)
    {
        HttpResponseMessage response = await http.DeleteAsync("/payments/PAY-0001");
        Console.WriteLine($"   attempt {attempt}: {(int)response.StatusCode} {response.StatusCode}");
    }

    Console.WriteLine();
    Console.WriteLine($"   payments now on the server: {payments.Count}");
    Console.WriteLine();
    Console.WriteLine("   Gone after the first call, and it stays gone. Idempotent.");
    Console.WriteLine();
    Console.WriteLine("   There is a genuine argument about the second call: 204 (it is");
    Console.WriteLine("   gone, which is what you asked for) or 404 (there is nothing here)?");
    Console.WriteLine();
    Console.WriteLine("   Prefer 204. A client retrying a DELETE after a timeout cannot tell");
    Console.WriteLine("   'my first attempt succeeded' from 'it never existed', and 404 makes");
    Console.WriteLine("   a successful retry look like an error. 404 is defensible when the");
    Console.WriteLine("   distinction genuinely matters to the caller - but decide, and");
    Console.WriteLine("   document it, because clients will retry.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task UnsafeGet(HttpClient http, Dictionary<string, Payment> payments)
{
    Console.WriteLine("5. A GET that changes state");
    Console.WriteLine();

    payments.Clear();
    payments["PAY-0001"] = new Payment("PAY-0001", 123_450, "settled");

    Console.WriteLine($"   before      : {payments["PAY-0001"].Status}");

    await http.GetAsync("/payments/PAY-0001/cancel");

    Console.WriteLine($"   after a GET : {payments["PAY-0001"].Status}");
    Console.WriteLine();
    Console.WriteLine("   GET /payments/PAY-0001/cancel is legal HTTP and it is a bug. The");
    Console.WriteLine("   method promises the request is SAFE, and everything downstream");
    Console.WriteLine("   believes it:");
    Console.WriteLine();
    Console.WriteLine("     - a browser prefetches links it thinks you might click");
    Console.WriteLine("     - a crawler follows every GET it finds");
    Console.WriteLine("     - a proxy or CDN may cache and serve it");
    Console.WriteLine("     - a retry layer repeats it without asking, because GET is safe");
    Console.WriteLine("     - a link checker in your own documentation will fire it");
    Console.WriteLine();
    Console.WriteLine("   Any of those cancels payments nobody asked to cancel. This is not");
    Console.WriteLine("   hypothetical: it is the classic 'the crawler deleted the database'");
    Console.WriteLine("   incident, and it needs no attacker.");
    Console.WriteLine();
    Console.WriteLine("   Cancelling is a state change, so it is POST /payments/{id}/cancel");
    Console.WriteLine("   or DELETE, and never GET.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Summary()
{
    Console.WriteLine("6. What follows for retry logic");
    Console.WriteLine();
    Console.WriteLine("   A timeout tells you NOTHING about whether the server acted. The");
    Console.WriteLine("   request may have been lost on the way out, processed and lost on");
    Console.WriteLine("   the way back, or still be running.");
    Console.WriteLine();
    Console.WriteLine("   So the rule is mechanical:");
    Console.WriteLine();
    Console.WriteLine("     GET, HEAD, PUT, DELETE, OPTIONS   safe to retry automatically");
    Console.WriteLine("     POST, PATCH                       NOT safe to retry, unless the");
    Console.WriteLine("                                       endpoint was designed for it");
    Console.WriteLine();
    Console.WriteLine("   'Designed for it' means an idempotency key: the client sends a");
    Console.WriteLine("   unique value, the server records it with the result, and a repeat");
    Console.WriteLine("   of the same key returns the FIRST result rather than acting again.");
    Console.WriteLine();
    Console.WriteLine("   That is the subject of 06-production.cs, and it is the difference");
    Console.WriteLine("   between the three payments in section 2 and one.");
}

// ---------------------------------------------------------------------------
record PaymentRequest(long AmountMinor);

record Payment(string Id, long AmountMinor, string Status);
