// 07-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 07-exercises.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Net;
using System.Net.Http.Json;
using System.Text;

var orders = new Dictionary<string, Order>();
var reservations = new System.Collections.Concurrent.ConcurrentDictionary<string, string?>();
int sideEffects = 0;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

app.MapGet("/orders/{id}", (string id) =>
    orders.TryGetValue(id, out Order? o) ? Results.Ok(o) : Results.NotFound());

app.MapPost("/orders", (OrderRequest r) =>
{
    string id = $"ORD-{orders.Count + 1:D4}";
    orders[id] = new Order(id, r.Total, "placed");
    return Results.Created($"/orders/{id}", orders[id]);
});

app.MapPut("/orders/{id}", (string id, OrderRequest r) =>
{
    bool existed = orders.ContainsKey(id);
    orders[id] = new Order(id, r.Total, "placed");
    return existed ? Results.NoContent() : Results.Created($"/orders/{id}", orders[id]);
});

app.MapDelete("/orders/{id}", (string id) =>
{
    orders.Remove(id);
    return Results.NoContent();
});

// Deliberately wrong, for exercise 2.
app.MapGet("/orders/{id}/refund", (string id) =>
{
    sideEffects++;
    return Results.Ok(new { refunded = id });
});

// Deliberately wrong, for exercise 3.
app.MapPost("/orders/validate", (OrderRequest r) =>
    r.Total <= 0
        ? Results.Ok(new { success = false, error = "total must be positive" })
        : Results.Ok(new { success = true }));

app.MapGet("/orders/{id}/etag", (string id, HttpRequest request, HttpResponse response) =>
{
    if (!orders.TryGetValue(id, out Order? order))
    {
        return Results.NotFound();
    }

    string tag = $"\"{order.Status}-{order.Total}\"";
    response.Headers.ETag = tag;

    return request.Headers.IfNoneMatch.ToString() == tag
        ? Results.StatusCode(304)
        : Results.Ok(order);
});

await app.StartAsync();
string baseUrl = app.Urls.First();

await Exercise1(baseUrl, orders);
await Exercise2(baseUrl, orders, () => sideEffects);
await Exercise3(baseUrl);
await Exercise4(baseUrl, orders);
await Exercise5(baseUrl, orders, reservations);
Exercise6();

await app.StopAsync();

// ---------------------------------------------------------------------------
// 1. EASY — which of these can a proxy retry automatically?
// ---------------------------------------------------------------------------
static async Task Exercise1(string baseUrl, Dictionary<string, Order> orders)
{
    Console.WriteLine("Exercise 1: which requests can be retried automatically?");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    Console.WriteLine("   request                     3 attempts leave   safe to retry?");
    Console.WriteLine("   -------                     ----------------   --------------");

    orders.Clear();
    for (int i = 0; i < 3; i++)
    {
        await http.PostAsJsonAsync("/orders", new OrderRequest(1000));
    }

    Console.WriteLine($"   POST /orders                {orders.Count,10} orders   NO");

    orders.Clear();
    for (int i = 0; i < 3; i++)
    {
        await http.PutAsJsonAsync("/orders/ORD-0001", new OrderRequest(1000));
    }

    Console.WriteLine($"   PUT /orders/ORD-0001        {orders.Count,10} orders   yes");

    for (int i = 0; i < 3; i++)
    {
        await http.DeleteAsync("/orders/ORD-0001");
    }

    Console.WriteLine($"   DELETE /orders/ORD-0001     {orders.Count,10} orders   yes");

    Console.WriteLine();
    Console.WriteLine("   POST is the only one that accumulates, because the SERVER chooses");
    Console.WriteLine("   the identity. PUT and DELETE name the resource, so a repeat lands");
    Console.WriteLine("   on the same one.");
    Console.WriteLine();
    Console.WriteLine("   That is what idempotent means, and it is a property of the METHOD");
    Console.WriteLine("   contract rather than of your implementation. A retry layer, a");
    Console.WriteLine("   proxy and a service mesh all rely on it without asking you.");
    Console.WriteLine();
    Console.WriteLine("   Note it is possible to write a PUT that is not idempotent - one");
    Console.WriteLine("   that appends rather than replaces, say. That is a bug, because");
    Console.WriteLine("   everything upstream is entitled to assume otherwise.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. EASY — what is wrong with GET /orders/{id}/refund?
// ---------------------------------------------------------------------------
static async Task Exercise2(string baseUrl, Dictionary<string, Order> orders, Func<int> sideEffects)
{
    Console.WriteLine("Exercise 2: what is wrong with GET /orders/{id}/refund?");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    int before = sideEffects();
    await http.GetAsync("/orders/ORD-0001/refund");
    await http.GetAsync("/orders/ORD-0001/refund");

    Console.WriteLine($"   refunds triggered by two GETs: {sideEffects() - before}");
    Console.WriteLine();
    Console.WriteLine("   GET is SAFE by contract - it must not change state - and everything");
    Console.WriteLine("   downstream acts on that promise without asking:");
    Console.WriteLine();
    Console.WriteLine("     - a browser prefetches links it thinks you might click");
    Console.WriteLine("     - a crawler follows every GET it can find");
    Console.WriteLine("     - a proxy or CDN may cache and replay it");
    Console.WriteLine("     - a retry policy repeats it without asking, because GET is safe");
    Console.WriteLine("     - a link checker in your own docs will fire it");
    Console.WriteLine("     - a monitoring probe hitting it every 30 seconds refunds forever");
    Console.WriteLine();
    Console.WriteLine("   None of those is an attacker. This is the classic 'the crawler");
    Console.WriteLine("   deleted the database' incident, and it needs nobody's malice.");
    Console.WriteLine();
    Console.WriteLine("   The fix is the method, not authentication: POST /orders/{id}/refund");
    Console.WriteLine("   or DELETE. Authentication limits WHO can do it; it does not stop a");
    Console.WriteLine("   logged-in user's browser prefetching the link.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — the endpoint that never fails.
// ---------------------------------------------------------------------------
static async Task Exercise3(string baseUrl)
{
    Console.WriteLine("Exercise 3: why does the dashboard show a 0% error rate?");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    HttpResponseMessage bad = await http.PostAsJsonAsync("/orders/validate", new OrderRequest(-5));
    string body = await bad.Content.ReadAsStringAsync();

    Console.WriteLine($"   POST with an invalid total");
    Console.WriteLine($"     status              : {(int)bad.StatusCode}");
    Console.WriteLine($"     IsSuccessStatusCode : {bad.IsSuccessStatusCode}");
    Console.WriteLine($"     body                : {body}");
    Console.WriteLine();

    bool threw = false;
    try
    {
        bad.EnsureSuccessStatusCode();
    }
    catch (HttpRequestException)
    {
        threw = true;
    }

    Console.WriteLine($"     EnsureSuccessStatusCode threw : {threw}");
    Console.WriteLine();
    Console.WriteLine("   The request failed and every layer believes it succeeded:");
    Console.WriteLine();
    Console.WriteLine("     - EnsureSuccessStatusCode does not throw");
    Console.WriteLine("     - a retry policy sees success and does not retry");
    Console.WriteLine("     - a circuit breaker never opens, however often it fails");
    Console.WriteLine("     - the error-rate dashboard reads 0%");
    Console.WriteLine("     - a proxy may cache the failure and serve it to others");
    Console.WriteLine();
    Console.WriteLine("   The correct status is 422 Unprocessable Content: the JSON parsed");
    Console.WriteLine("   and the VALUE is unacceptable. 400 is defensible; anything in the");
    Console.WriteLine("   2xx range is not.");
    Console.WriteLine();
    Console.WriteLine("   The general rule: the status LINE carries the outcome, because it");
    Console.WriteLine("   is the one part every layer already understands. The body carries");
    Console.WriteLine("   the DETAIL, for the human or the client that wants it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — conditional requests.
// ---------------------------------------------------------------------------
static async Task Exercise4(string baseUrl, Dictionary<string, Order> orders)
{
    Console.WriteLine("Exercise 4: a poller asking every second for data that rarely changes");
    Console.WriteLine();

    orders.Clear();
    orders["ORD-0001"] = new Order("ORD-0001", 1000, "placed");

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    HttpResponseMessage first = await http.GetAsync("/orders/ORD-0001/etag");
    string etag = first.Headers.ETag!.ToString();
    long firstBytes = (await first.Content.ReadAsByteArrayAsync()).Length;

    using var conditional = new HttpRequestMessage(HttpMethod.Get, "/orders/ORD-0001/etag");
    conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
    HttpResponseMessage second = await http.SendAsync(conditional);
    long secondBytes = (await second.Content.ReadAsByteArrayAsync()).Length;

    // Now change the resource and repeat with the stale validator.
    orders["ORD-0001"] = orders["ORD-0001"] with { Status = "shipped" };

    using var stale = new HttpRequestMessage(HttpMethod.Get, "/orders/ORD-0001/etag");
    stale.Headers.TryAddWithoutValidation("If-None-Match", etag);
    HttpResponseMessage third = await http.SendAsync(stale);
    long thirdBytes = (await third.Content.ReadAsByteArrayAsync()).Length;

    Console.WriteLine($"   first request, no validator        : {(int)first.StatusCode}, {firstBytes} body bytes");
    Console.WriteLine($"   second, validator matches          : {(int)second.StatusCode}, {secondBytes} body bytes");
    Console.WriteLine($"   third, after the order changed     : {(int)third.StatusCode}, {thirdBytes} body bytes");
    Console.WriteLine();
    Console.WriteLine("   The middle request sent no body. The third did, because the ETag");
    Console.WriteLine("   no longer matched - which is the whole mechanism.");
    Console.WriteLine();
    Console.WriteLine("   Be precise about what this saves. The REQUEST still happened: a");
    Console.WriteLine("   round trip, a connection, and whatever work the server did to");
    Console.WriteLine("   compute the ETag. What it saves is the BODY.");
    Console.WriteLine();
    Console.WriteLine("   So it is worth a lot for a large payload and almost nothing for a");
    Console.WriteLine("   small one - and it is only a saving if the ETag is cheaper than the");
    Console.WriteLine("   body. Hashing a body you already generated saves bandwidth and no");
    Console.WriteLine("   server work at all.");
    Console.WriteLine();
    Console.WriteLine("   A cheap ETag comes from something you already have: a version");
    Console.WriteLine("   column, a last-modified timestamp, a row version. This one is built");
    Console.WriteLine("   from the status and total without serialising anything.");
    Console.WriteLine();
    Console.WriteLine("   And for a poller specifically, the better answer may be not to poll");
    Console.WriteLine("   at all. Conditional GET makes polling cheaper; it does not make it");
    Console.WriteLine("   a good design.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 5. HARD — make a POST safe to retry.
// ---------------------------------------------------------------------------
static async Task Exercise5(string baseUrl, Dictionary<string, Order> orders,
    System.Collections.Concurrent.ConcurrentDictionary<string, string?> reservations)
{
    Console.WriteLine("Exercise 5: making a POST safe for a client to retry");
    Console.WriteLine();
    Console.WriteLine("   The requirement: a client with a retry policy must be able to send");
    Console.WriteLine("   the same order three times and create one order.");
    Console.WriteLine();
    Console.WriteLine("   The design, and why each part is there:");
    Console.WriteLine();
    Console.WriteLine("   1. THE CLIENT SUPPLIES A KEY, in an Idempotency-Key header.");
    Console.WriteLine("      It must identify the OPERATION, so it is generated once by");
    Console.WriteLine("      whoever decided to place the order - not inside the retry loop.");
    Console.WriteLine("      Generating it per attempt is the most common way this is got");
    Console.WriteLine("      wrong, and it reproduces the original bug while looking right.");
    Console.WriteLine();
    Console.WriteLine("   2. THE SERVER RESERVES THE KEY BEFORE DOING THE WORK, atomically.");
    Console.WriteLine("      This is the part that is usually missing. Measured in");
    Console.WriteLine("      06-production.cs: recording the key AFTER the work still");
    Console.WriteLine("      produced 2 charges from 3 attempts, because two attempts were");
    Console.WriteLine("      in flight before either had written anything.");
    Console.WriteLine();
    Console.WriteLine("   3. A LOSER EITHER REPLAYS OR GETS 409, depending on whether the");
    Console.WriteLine("      winner has finished. Returning success before the work completes");
    Console.WriteLine("      would be a lie; waiting holds a connection open.");
    Console.WriteLine();
    Console.WriteLine("   4. KEYS EXPIRE. They are state, and unbounded state is a leak. Long");
    Console.WriteLine("      enough to outlive any retry a client will make - 24 hours is a");
    Console.WriteLine("      common answer.");
    Console.WriteLine();
    Console.WriteLine("   5. A DIFFERENT BODY WITH THE SAME KEY IS A CLIENT BUG. Store a hash");
    Console.WriteLine("      of the request alongside the key and return 422 on a mismatch,");
    Console.WriteLine("      rather than replaying a result for a different request.");
    Console.WriteLine();

    // The reservation logic, exercised concurrently.
    reservations.Clear();
    orders.Clear();

    string key = Guid.NewGuid().ToString();
    int created = 0;
    int conflicts = 0;

    await Task.WhenAll(Enumerable.Range(0, 5).Select(async _ =>
    {
        if (reservations.TryAdd(key, null))
        {
            await Task.Delay(30);          // the slow work
            Interlocked.Increment(ref created);
            reservations[key] = "ORD-0001";
        }
        else
        {
            Interlocked.Increment(ref conflicts);
        }
    }));

    Console.WriteLine($"   5 simultaneous attempts with one key:");
    Console.WriteLine($"     orders created : {created}");
    Console.WriteLine($"     rejected       : {conflicts}");
    Console.WriteLine();
    Console.WriteLine("   Exactly one winner, even with all five arriving at once. TryAdd is");
    Console.WriteLine("   a single atomic operation, so there is no window between the check");
    Console.WriteLine("   and the write for a second caller to slip through.");
    Console.WriteLine();
    Console.WriteLine("   In a real service that is a UNIQUE CONSTRAINT on an insert, and the");
    Console.WriteLine("   reservation and the order belong in one transaction. A dictionary");
    Console.WriteLine("   in memory loses every key when the process restarts, which is");
    Console.WriteLine("   exactly when a client is most likely to retry.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 6. HARD — reviewing an API design.
// ---------------------------------------------------------------------------
static void Exercise6()
{
    Console.WriteLine("Exercise 6: review this API");
    Console.WriteLine();
    Console.WriteLine("     GET  /api/deleteUser?id=42        -> 200 {\"ok\":true}");
    Console.WriteLine("     POST /api/getUser                 -> 200 {\"user\":{...}}");
    Console.WriteLine("     POST /api/createOrder             -> 200 {\"orderId\":\"ORD-1\"}");
    Console.WriteLine("     GET  /api/orders                  -> 200, Cache-Control: public, max-age=3600");
    Console.WriteLine();
    Console.WriteLine("   Six problems, most severe first.");
    Console.WriteLine();
    Console.WriteLine("   1. GET /api/deleteUser DELETES ON A SAFE METHOD.");
    Console.WriteLine("      A crawler, a prefetch, a link checker or a monitoring probe");
    Console.WriteLine("      deletes users. Measured in exercise 2: two GETs, two refunds.");
    Console.WriteLine("      Fix: DELETE /api/users/42.");
    Console.WriteLine();
    Console.WriteLine("   2. GET /api/orders IS CACHED PUBLICLY FOR AN HOUR.");
    Console.WriteLine("      A per-user list with 'public' means a shared cache serves one");
    Console.WriteLine("      user's orders to the next person who asks. This is a data breach");
    Console.WriteLine("      caused by one header.");
    Console.WriteLine("      Fix: Cache-Control: private, no-store, and Vary: Authorization.");
    Console.WriteLine();
    Console.WriteLine("   3. EVERYTHING RETURNS 200.");
    Console.WriteLine("      Failures are invisible to retry policies, circuit breakers and");
    Console.WriteLine("      dashboards. Measured in exercise 3.");
    Console.WriteLine("      Fix: use the status line.");
    Console.WriteLine();
    Console.WriteLine("   4. POST /api/getUser IS A READ BEHIND AN UNSAFE METHOD.");
    Console.WriteLine("      Not dangerous, but it gives up caching, conditional requests and");
    Console.WriteLine("      safe retries for nothing.");
    Console.WriteLine("      Fix: GET /api/users/42.");
    Console.WriteLine();
    Console.WriteLine("   5. POST /api/createOrder RETURNS 200 WITH NO LOCATION.");
    Console.WriteLine("      A creation should be 201 with Location, so a client that timed");
    Console.WriteLine("      out has an identity to check before retrying.");
    Console.WriteLine();
    Console.WriteLine("   6. THE VERBS ARE IN THE PATHS.");
    Console.WriteLine("      createOrder, getUser, deleteUser - the method already says what");
    Console.WriteLine("      is happening, so the path should name the RESOURCE. This is the");
    Console.WriteLine("      least important item on the list and the one most often argued");
    Console.WriteLine("      about, which is worth noticing.");
    Console.WriteLine();
    Console.WriteLine("   The rewrite:");
    Console.WriteLine();
    Console.WriteLine("     DELETE /api/users/42              -> 204");
    Console.WriteLine("     GET    /api/users/42              -> 200, ETag, private");
    Console.WriteLine("     POST   /api/orders                -> 201, Location, Idempotency-Key");
    Console.WriteLine("     GET    /api/orders                -> 200, private, no-store, Vary");
}

// ---------------------------------------------------------------------------
record OrderRequest(long Total);

record Order(string Id, long Total, string Status);
