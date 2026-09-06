// 07-minimal-example.cs — One correctly ordered pipeline, with every position
// justified and every decision exercised.
//
// Run:  dotnet run 07-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code, header and ordering here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

var order = new ConcurrentQueue<string>();
var cache = new ConcurrentDictionary<string, string>();
int endpointCalls = 0;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// ===========================================================================
// 1. EXCEPTION HANDLING - outermost, because it can only catch what it wraps.
// ===========================================================================
app.Use(async (context, next) =>
{
    order.Enqueue("1 exception handler");

    try
    {
        await next();
    }
    catch (Exception ex)
    {
        // HasStarted must be checked. If the endpoint already wrote a body,
        // the status line went out long ago and there is nothing to change.
        if (context.Response.HasStarted)
        {
            return;
        }

        context.Response.StatusCode = 500;
        await context.Response.WriteAsJsonAsync(new { error = ex.GetType().Name });
    }
});

// ===========================================================================
// 2. FORWARDED HEADERS - before anything that reads the scheme or address.
// ===========================================================================
var forwarded = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1
};

// Clear THEN add. Clearing alone leaves both sets empty, and an empty trusted
// set means trust EVERY sender.
forwarded.KnownProxies.Clear();
forwarded.KnownIPNetworks.Clear();
forwarded.KnownProxies.Add(IPAddress.Loopback);

app.UseForwardedHeaders(forwarded);

// ===========================================================================
// 3. TIMING - registered early so it measures everything below it. The header
//    is added with OnStarting, because by the time next() returns the
//    response has usually started and headers are read-only.
// ===========================================================================
app.Use(async (context, next) =>
{
    order.Enqueue("3 timing");
    var sw = Stopwatch.StartNew();

    context.Response.OnStarting(() =>
    {
        context.Response.Headers["X-Elapsed-Ms"] = sw.ElapsedMilliseconds.ToString();
        return Task.CompletedTask;
    });

    await next();
});

// ===========================================================================
// 4. AUTHENTICATION - establishes WHO. Rejects nobody by itself; in a real
//    application this is UseAuthentication and reads a token.
// ===========================================================================
app.Use(async (context, next) =>
{
    order.Enqueue("4 authentication");
    context.Items["merchant"] = context.Request.Headers["X-Merchant"].FirstOrDefault();
    await next();
});

// ===========================================================================
// 5. AUTHORISATION - decides whether THIS caller may proceed. After
//    authentication, because it needs the identity.
// ===========================================================================
app.Use(async (context, next) =>
{
    order.Enqueue("5 authorisation");

    if (context.Request.Path.StartsWithSegments("/health"))
    {
        await next();               // health is deliberately public
        return;
    }

    if (context.Items["merchant"] is not string merchant || merchant.Length == 0)
    {
        context.Response.StatusCode = 401;
        await context.Response.WriteAsJsonAsync(new { error = "authentication required" });
        return;                     // short-circuit
    }

    await next();
});

// ===========================================================================
// 6. RESPONSE CACHE - AFTER authorisation, because it short-circuits. Placing
//    it above would skip both checks for every cache hit. Keyed on identity as
//    well as path, or one merchant receives another's response.
// ===========================================================================
app.Use(async (context, next) =>
{
    order.Enqueue("6 cache");

    if (context.Request.Method != "GET")
    {
        await next();
        return;
    }

    string key = $"{context.Request.Path}|{context.Items["merchant"]}";

    if (cache.TryGetValue(key, out string? hit))
    {
        context.Response.Headers["X-Cache"] = "HIT";
        await context.Response.WriteAsync(hit);
        return;
    }

    Stream original = context.Response.Body;
    using var buffer = new MemoryStream();
    context.Response.Body = buffer;

    string body;
    try
    {
        await next();
    }
    finally
    {
        // MUST be restored in a finally. Without it, an exception thrown below
        // leaves Response.Body pointing at this buffer, so an exception handler
        // higher up writes its 500 into a MemoryStream nobody reads and the
        // client receives an empty body.
        buffer.Position = 0;
        body = await new StreamReader(buffer).ReadToEndAsync();
        context.Response.Body = original;
    }

    if (context.Response.StatusCode == 200)
    {
        cache[key] = body;
    }

    context.Response.Headers["X-Cache"] = "MISS";
    await context.Response.WriteAsync(body);
});

// ===========================================================================
// 7. A BRANCH that adds something for some requests and rejoins. UseWhen, not
//    MapWhen - MapWhen is terminal and the endpoint would never be reached.
// ===========================================================================
app.UseWhen(
    context => context.Request.Headers.ContainsKey("X-Internal"),
    branch => branch.Use(async (context, next) =>
    {
        order.Enqueue("7 internal branch");
        context.Response.OnStarting(() =>
        {
            context.Response.Headers["X-Internal-Diagnostics"] = "on";
            return Task.CompletedTask;
        });

        await next();
    }));

// ===========================================================================
// The endpoints. Note these are reached LAST regardless of where the Map calls
// appear in this file - the endpoint middleware is appended automatically at
// the end of the pipeline.
// ===========================================================================
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

app.MapGet("/statement", (HttpContext context) =>
{
    order.Enqueue("8 endpoint");
    Interlocked.Increment(ref endpointCalls);
    return Results.Ok(new { statement = $"for {context.Items["merchant"]}" });
});

app.MapGet("/boom", void () => throw new InvalidOperationException("gateway unreachable"));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("A correctly ordered pipeline, exercised");
Console.WriteLine();
Console.WriteLine("   request                                  status   what it shows");
Console.WriteLine("   -------                                  ------   -------------");

order.Clear();
(int healthStatus, _, _) = await SendAsync(http, "/health", null);
Console.WriteLine($"   GET /health, no credentials                 {healthStatus,3}   public by design");

(int anonStatus, _, _) = await SendAsync(http, "/statement", null);
Console.WriteLine($"   GET /statement, no credentials              {anonStatus,3}   401, the cache did not hide it");

(int aStatus, string aBody, string aCache) = await SendAsync(http, "/statement", "merchant-a");
Console.WriteLine($"   GET /statement as merchant-a                {aStatus,3}   {aCache}, {aBody}");

(int a2Status, string a2Body, string a2Cache) = await SendAsync(http, "/statement", "merchant-a");
Console.WriteLine($"   GET /statement as merchant-a again          {a2Status,3}   {a2Cache}, {a2Body}");

(int bStatus, string bBody, string bCache) = await SendAsync(http, "/statement", "merchant-b");
Console.WriteLine($"   GET /statement as merchant-b                {bStatus,3}   {bCache}, {bBody}");

(int boomStatus, string boomBody, _) = await SendAsync(http, "/boom", "merchant-a");
Console.WriteLine($"   GET /boom as merchant-a                     {boomStatus,3}   {boomBody}");

Console.WriteLine();
Console.WriteLine($"   the endpoint ran {endpointCalls} times for 3 authenticated statement requests");
Console.WriteLine();

// One clean request, to print the pipeline order.
order.Clear();
await SendAsync(http, "/statement", "merchant-c", internalCaller: true);

Console.WriteLine("   the order for one internal, authenticated request:");
Console.WriteLine();
foreach (string step in order)
{
    Console.WriteLine($"     {step}");
}

Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - exception handling FIRST, and it checks HasStarted before writing");
Console.WriteLine("     - forwarded headers before anything reads the scheme or the address");
Console.WriteLine("     - response headers added with OnStarting, never after next()");
Console.WriteLine("     - authentication before authorisation, because one needs the other");
Console.WriteLine("     - anything that SHORT-CIRCUITS placed after both, or it removes them");
Console.WriteLine("     - the cache keyed on identity as well as path");
Console.WriteLine("     - UseWhen for a branch that must rejoin; MapWhen would end the request");
Console.WriteLine("     - no per-request state in middleware fields");
Console.WriteLine("     - Response.Body restored in a FINALLY by the buffering cache");
Console.WriteLine();
Console.WriteLine("   That last one was a real bug in the first draft of this file. The");
Console.WriteLine("   cache swapped Response.Body for a MemoryStream and restored it after");
Console.WriteLine("   next() returned - so when /boom threw, the restore was skipped, the");
Console.WriteLine("   exception handler wrote its 500 into the discarded buffer, and the");
Console.WriteLine("   client received status 500 with an EMPTY body.");
Console.WriteLine();
Console.WriteLine("   Any middleware that replaces something on the context must put it back");
Console.WriteLine("   in a finally. The exception path is the one nobody tests.");
Console.WriteLine();
Console.WriteLine("   The one ordering mistake the framework catches for you is");
Console.WriteLine("   UseAuthorization before UseRouting, which throws at startup. Every");
Console.WriteLine("   other position above is enforced by nothing but this file.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task<(int Status, string Body, string Cache)> SendAsync(HttpClient http,
    string path, string? merchant, bool internalCaller = false)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);

    if (merchant is not null)
    {
        request.Headers.TryAddWithoutValidation("X-Merchant", merchant);
    }

    if (internalCaller)
    {
        request.Headers.TryAddWithoutValidation("X-Internal", "1");
    }

    using HttpResponseMessage response = await http.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();
    string cache = response.Headers.TryGetValues("X-Cache", out var values)
        ? values.First()
        : "-";

    return ((int)response.StatusCode, body, cache);
}
