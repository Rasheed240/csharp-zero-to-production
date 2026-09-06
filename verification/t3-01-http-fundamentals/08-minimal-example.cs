// 08-minimal-example.cs — One small API that applies every decision in this
// module, and a client that exercises each of them.
//
// Run:  dotnet run 08-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code, header and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Net.Http.Json;

var orders = new ConcurrentDictionary<string, Order>();
var idempotencyKeys = new ConcurrentDictionary<string, string?>();
int nextId = 0;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// --- READ: safe, cacheable, conditional ------------------------------------
app.MapGet("/orders/{id}", (string id, HttpRequest request, HttpResponse response) =>
{
    if (!orders.TryGetValue(id, out Order? order))
    {
        return Results.NotFound();
    }

    // The ETag is built from data we already have. Serialising the order only
    // to hash it would save bandwidth and no server work at all.
    string etag = $"\"{order.Version}\"";
    response.Headers.ETag = etag;

    // An order belongs to one caller, so a SHARED cache must never store it.
    // 'private' is the difference between a cache and a data breach.
    response.Headers.CacheControl = "private, max-age=0, must-revalidate";

    if (request.Headers.IfNoneMatch.ToString() == etag)
    {
        return Results.StatusCode(304);
    }

    return Results.Ok(order);
});

// --- CREATE: unsafe, not idempotent, made retry-safe by a key ---------------
app.MapPost("/orders", async (OrderRequest body, HttpRequest request) =>
{
    if (body.TotalMinor <= 0)
    {
        // 422, not 400: the JSON parsed. The caller's CODE is fine and its
        // DATA is not, which is a different fix.
        return Results.UnprocessableEntity(new { error = "totalMinor must be positive" });
    }

    string? key = request.Headers["Idempotency-Key"].FirstOrDefault();
    if (string.IsNullOrWhiteSpace(key))
    {
        return Results.BadRequest(new { error = "Idempotency-Key header is required" });
    }

    // Reserve the key BEFORE the work, atomically. Checking a dictionary and
    // then writing to it leaves a window wide enough for a retry to fit
    // through - measured at 2 charges from 3 attempts in 06-production.cs.
    if (!idempotencyKeys.TryAdd(key, null))
    {
        string? completed = idempotencyKeys[key];
        return completed is null
            ? Results.Conflict(new { error = "a request with this key is in progress" })
            : Results.Created($"/orders/{completed}", orders[completed]);
    }

    await Task.Delay(20);                       // stands in for real work

    string id = $"ORD-{Interlocked.Increment(ref nextId):D4}";
    var order = new Order(id, body.TotalMinor, "placed", Version: 1);
    orders[id] = order;
    idempotencyKeys[key] = id;

    // 201 with Location: a client whose request timed out now has an identity
    // it can GET, rather than a choice between retrying and giving up.
    return Results.Created($"/orders/{id}", order);
});

// --- REPLACE: idempotent, so a proxy may retry it freely --------------------
app.MapPut("/orders/{id}/status", (string id, StatusRequest body) =>
{
    if (!orders.TryGetValue(id, out Order? order))
    {
        return Results.NotFound();
    }

    if (order.Status == "cancelled")
    {
        // 409, not 422: the request is fine and the STATE forbids it. Retrying
        // unchanged might succeed at another time, which is what distinguishes
        // the two.
        return Results.Conflict(new { error = "a cancelled order cannot change status" });
    }

    orders[id] = order with { Status = body.Status, Version = order.Version + 1 };
    return Results.NoContent();
});

// --- DELETE: idempotent, so repeating it is not an error --------------------
app.MapDelete("/orders/{id}", (string id) =>
{
    orders.TryRemove(id, out _);

    // 204 whether or not it was there. The client asked for the order to be
    // gone and it is gone. Returning 404 on the second attempt would make a
    // successful retry look like a failure.
    return Results.NoContent();
});

await app.StartAsync();
string baseUrl = app.Urls.First();

using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

Console.WriteLine("A small API, exercised end to end");
Console.WriteLine();
Console.WriteLine("   step                                   status   what it shows");
Console.WriteLine("   ----                                   ------   -------------");

// Validation: parsed, but unacceptable.
HttpResponseMessage r = await Post(http, new OrderRequest(-1), key: "K1");
Show("POST an order with a negative total", r, "422, not 400");

// Creation, then two retries of the same operation.
string operationKey = Guid.NewGuid().ToString();

r = await Post(http, new OrderRequest(2500), operationKey);
string location = r.Headers.Location!.ToString();
Show("POST a valid order", r, $"201 + Location {location}");

r = await Post(http, new OrderRequest(2500), operationKey);
Show("POST the SAME operation again", r, "201 replayed, not a second order");

r = await Post(http, new OrderRequest(2500), key: null);
Show("POST with no Idempotency-Key", r, "400, the header is required");

// Reads, conditional and unconditional.
r = await http.GetAsync(location);
string etag = r.Headers.ETag!.ToString();
Show("GET the order", r, $"200, ETag {etag}");

r = await Conditional(http, location, etag);
Show("GET again with If-None-Match", r, "304, no body sent");

// A state change bumps the version, so the validator stops matching.
r = await http.PutAsJsonAsync($"{location}/status", new StatusRequest("shipped"));
Show("PUT the status to shipped", r, "204, no body needed");

r = await Conditional(http, location, etag);
Show("GET with the STALE validator", r, "200, the ETag changed");

// Idempotence of PUT and DELETE, demonstrated rather than asserted.
await http.PutAsJsonAsync($"{location}/status", new StatusRequest("delivered"));
await http.PutAsJsonAsync($"{location}/status", new StatusRequest("delivered"));
r = await http.PutAsJsonAsync($"{location}/status", new StatusRequest("delivered"));
Show("PUT the same status 3 times", r, "204 each time, one final state");

r = await http.DeleteAsync(location);
Show("DELETE the order", r, "204");

r = await http.DeleteAsync(location);
Show("DELETE it again", r, "204, a retry is not an error");

r = await http.GetAsync(location);
Show("GET it now", r, "404");

Console.WriteLine();
Console.WriteLine($"   orders in the store at the end: {orders.Count}");
Console.WriteLine();
Console.WriteLine("   Every one of those decisions is visible to a client that has never");
Console.WriteLine("   read your code. That is the point of the protocol: the status line and");
Console.WriteLine("   the headers tell a proxy, a cache, a retry policy and a dashboard what");
Console.WriteLine("   happened, without any of them knowing what an order is.");
Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - reads on GET, so they can be cached, retried and prefetched safely");
Console.WriteLine("     - writes on POST, PUT or DELETE, chosen by whether repeating is safe");
Console.WriteLine("     - 201 with Location whenever something is created");
Console.WriteLine("     - 422 for bad values, 400 for a malformed request, 409 for state");
Console.WriteLine("     - failures on the STATUS LINE, never a 200 with an error inside");
Console.WriteLine("     - an ETag on anything worth re-reading");
Console.WriteLine("     - Cache-Control: private on anything belonging to one caller");
Console.WriteLine("     - an idempotency key reserved BEFORE the work, not after");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task<HttpResponseMessage> Post(HttpClient http, OrderRequest body, string? key)
{
    using var request = new HttpRequestMessage(HttpMethod.Post, "/orders")
    {
        Content = JsonContent.Create(body)
    };

    if (key is not null)
    {
        request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
    }

    return await http.SendAsync(request);
}

static async Task<HttpResponseMessage> Conditional(HttpClient http, string path, string etag)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    request.Headers.TryAddWithoutValidation("If-None-Match", etag);
    return await http.SendAsync(request);
}

static void Show(string step, HttpResponseMessage response, string note)
{
    Console.WriteLine($"   {step,-36}   {(int)response.StatusCode,6}   {note}");
}

// ---------------------------------------------------------------------------
record OrderRequest(long TotalMinor);

record StatusRequest(string Status);

record Order(string Id, long TotalMinor, string Status, int Version);
