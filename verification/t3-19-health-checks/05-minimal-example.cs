// 05-minimal-example.cs — One service with all three probes decided
// deliberately: what each answers, what it costs, what it reveals, and what it
// does at shutdown.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The things the service depends on, and its own state.
var database = new Dependency("database");
var gateway = new Dependency("payments-gateway");
var searchIndex = new Dependency("search-index");
var lifecycle = new Lifecycle();

// One shared cache for the expensive checks. Probers arrive from three
// directions; they do not each need their own round trip.
var cache = new CachedChecks(TimeSpan.FromSeconds(3));

builder.Services.AddHealthChecks()

    // LIVE: depends on nothing outside this process, because the only
    // consequence of failing is a restart, and a restart cannot fix anything
    // outside this process.
    .AddCheck("process", () => HealthCheckResult.Healthy(), tags: ["live"])

    // STARTUP: has the warm-up finished? Holds off the other two while a slow
    // start completes, so a cold cache is never mistaken for a wedged process.
    .AddCheck("warm-up", () => lifecycle.Warm
        ? HealthCheckResult.Healthy("Reference data loaded.")
        : HealthCheckResult.Unhealthy("Loading reference data."), tags: ["startup"])

    // READY: can this instance serve a request? Everything a request needs,
    // including the warm-up - not everything that happens to be external.
    .AddCheck("shutting-down", () => lifecycle.ShuttingDown
        ? HealthCheckResult.Unhealthy("Draining.")
        : HealthCheckResult.Healthy(), tags: ["ready"])

    .AddCheck("warm-up-ready", () => lifecycle.Warm
        ? HealthCheckResult.Healthy()
        : HealthCheckResult.Unhealthy("Loading reference data."), tags: ["ready"])

    .AddAsyncCheck("database", () => cache.GetAsync("database",
        token => database.PingAsync(token)), tags: ["ready"],
        timeout: TimeSpan.FromMilliseconds(500))

    .AddAsyncCheck("payments-gateway", () => cache.GetAsync("gateway",
        token => gateway.PingAsync(token)), tags: ["ready"],
        timeout: TimeSpan.FromMilliseconds(500))

    // DEGRADED, NOT UNHEALTHY: search being down makes the service worse, not
    // unusable. Taking the instance out of rotation for it would be a bigger
    // outage than the one it is reacting to.
    .AddAsyncCheck("search-index", async () =>
    {
        HealthCheckResult result = await cache.GetAsync("search", token => searchIndex.PingAsync(token));

        return result.Status == HealthStatus.Healthy
            ? result
            : HealthCheckResult.Degraded("Search unavailable; browse and payments unaffected.");
    }, tags: ["ready"], timeout: TimeSpan.FromMilliseconds(500));

var app = builder.Build();

// Three endpoints, three predicates, no endpoint without one.
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = r => r.Tags.Contains("live")
});

app.MapHealthChecks("/health/startup", new HealthCheckOptions
{
    Predicate = r => r.Tags.Contains("startup")
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = r => r.Tags.Contains("ready")
});

app.MapGet("/v1/payments/{id}", (string id) => Results.Ok(new { id, status = "captured" }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("One service, three probes");
Console.WriteLine();

Console.WriteLine("   scenario                          live           startup        ready");
Console.WriteLine("   --------                          ----           -------        -----");

// 1. Starting up.
Console.WriteLine($"   starting, cache not loaded        {await Row(http)}");

// 2. Warm and healthy.
lifecycle.Warm = true;
cache.Clear();
Console.WriteLine($"   warm, everything up               {await Row(http)}");

// 3. Search index down - degraded, and still taking traffic.
searchIndex.Up = false;
cache.Clear();
Console.WriteLine($"   search index down                 {await Row(http)}");

// 4. Database down - not ready, and not restarted.
searchIndex.Up = true;
database.Up = false;
cache.Clear();
Console.WriteLine($"   database down                     {await Row(http)}");

// 5. Database slow enough to trip the timeout.
database.Up = true;
database.Latency = TimeSpan.FromSeconds(2);
cache.Clear();
Console.WriteLine($"   database very slow                {await Row(http)}");

// 6. Shutting down.
database.Latency = TimeSpan.Zero;
lifecycle.ShuttingDown = true;
cache.Clear();
Console.WriteLine($"   SIGTERM received                  {await Row(http)}");

// The service is still serving while readiness fails, which is the point.
Console.WriteLine();
Console.WriteLine($"   and a real request during shutdown   " +
    $"{(int)(await http.GetAsync("/v1/payments/PAY-001")).StatusCode}");

// What the probers saw, and what it cost.
lifecycle.ShuttingDown = false;
cache.Clear();

int before = database.Pings;

for (int i = 0; i < 30; i++)
{
    await http.GetAsync("/health/ready");
}

Console.WriteLine();
Console.WriteLine($"   30 readiness probes cost {database.Pings - before} database round trips");

Console.WriteLine();
Console.WriteLine("   what each endpoint returns to a prober:");
Console.WriteLine();

foreach (string path in new[] { "/health/live", "/health/startup", "/health/ready" })
{
    using HttpResponseMessage response = await http.GetAsync(path);

    Console.WriteLine($"     {path,-18} {(int)response.StatusCode} " +
        $"{await response.Content.ReadAsStringAsync()}");
}

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   EVERY DECISION IN THAT CONFIGURATION, AND WHY:");
Console.WriteLine();
Console.WriteLine("     LIVENESS TOUCHES NOTHING EXTERNAL. Look at the 'database down' row -");
Console.WriteLine("     live is 200. The process is fine, it is waiting for a dependency, and");
Console.WriteLine("     restarting it would discard a warm connection pool in exchange for");
Console.WriteLine("     nothing. THIS ONE LINE IS THE DIFFERENCE BETWEEN A DEPENDENCY BLIP AND");
Console.WriteLine("     A FLEET-WIDE RESTART LOOP.");
Console.WriteLine();
Console.WriteLine("     STARTUP EXISTS SO LIVENESS CAN BE STRICT. Because the orchestrator");
Console.WriteLine("     suspends the other probes until startup passes once, the warm-up gets a");
Console.WriteLine("     generous allowance AND liveness gets a short timeout afterwards. You");
Console.WriteLine("     cannot have both without it.");
Console.WriteLine();
Console.WriteLine("     READINESS COVERS WHAT A REQUEST NEEDS, not what is external. The");
Console.WriteLine("     warm-up check appears in BOTH startup and ready, because 'has it");
Console.WriteLine("     finished starting' and 'can it serve' are different questions with the");
Console.WriteLine("     same answer here.");
Console.WriteLine();
Console.WriteLine("     SEARCH IS DEGRADED, NOT UNHEALTHY. The service works without it. A");
Console.WriteLine("     check that removes an instance from rotation for a non-essential");
Console.WriteLine("     dependency turns a small outage into a total one.");
Console.WriteLine();
Console.WriteLine("     EVERY EXTERNAL CHECK HAS A TIMEOUT AND HONOURS ITS TOKEN. The 'database");
Console.WriteLine("     very slow' row returns quickly and says so, rather than hanging until");
Console.WriteLine("     the prober gives up and reports a failure with no explanation.");
Console.WriteLine();
Console.WriteLine("     THE EXPENSIVE CHECKS ARE CACHED. Thirty probes, a handful of round");
Console.WriteLine("     trips. The cache also bounds concurrency, so a slow dependency does not");
Console.WriteLine("     accumulate one in-flight check per arriving probe.");
Console.WriteLine();
Console.WriteLine("     READINESS FAILS ON SIGTERM WHILE THE SERVICE KEEPS SERVING. That is the");
Console.WriteLine("     signal the load balancer acts on, and the service has to outlive the");
Console.WriteLine("     time it takes to act - which is a number you look up, not guess.");
Console.WriteLine();
Console.WriteLine("     NO ENDPOINT IS WITHOUT A PREDICATE, and every check is tagged. A check");
Console.WriteLine("     added next year without a tag lands nowhere, which is visible, rather");
Console.WriteLine("     than on the liveness probe, which is not.");
Console.WriteLine();
Console.WriteLine("     AND THE BODIES ARE ONE WORD. The prober reads the status code. Detail");
Console.WriteLine("     goes to logs and metrics, which are already authenticated - not to an");
Console.WriteLine("     unauthenticated endpoint that would publish hostnames and usernames.");
Console.WriteLine();
Console.WriteLine("   THE DEPLOYMENT MANIFEST IS HALF OF THIS CONFIGURATION AND IT IS NOT IN");
Console.WriteLine("   THIS FILE. Three endpoints are worth nothing if the manifest points all");
Console.WriteLine("   three probes at the same one - which is the incident, and which no C#");
Console.WriteLine("   review would catch.");

// ---------------------------------------------------------------------------
static async Task<string> Row(HttpClient http)
{
    string[] results = [.. await Task.WhenAll(
        new[] { "/health/live", "/health/startup", "/health/ready" }
            .Select(async path =>
            {
                using HttpResponseMessage response = await http.GetAsync(path);
                string body = await response.Content.ReadAsStringAsync();

                return $"{(int)response.StatusCode} {body}";
            }))];

    return $"{results[0],-14} {results[1],-14} {results[2]}";
}

// ---------------------------------------------------------------------------
// Stands in for a real dependency: up or down, fast or slow, and it counts how
// many times it was actually asked.
sealed class Dependency(string name)
{
    public bool Up { get; set; } = true;

    public TimeSpan Latency { get; set; }

    public int Pings;

    public async Task<HealthCheckResult> PingAsync(CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref Pings);

        // The token is passed through, which is what makes a configured
        // timeout do anything at all.
        await Task.Delay(Latency, cancellationToken);

        return Up
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy($"{name} is unreachable.");
    }
}

// ---------------------------------------------------------------------------
sealed class Lifecycle
{
    public volatile bool Warm;

    public volatile bool ShuttingDown;
}

// ---------------------------------------------------------------------------
// Serves one computed result per key for a window, and lets only one
// computation per key run at a time. The second property is what stops a slow
// dependency accumulating in-flight checks.
sealed class CachedChecks(TimeSpan window)
{
    readonly Dictionary<string, (HealthCheckResult Result, DateTime At)> entries = [];
    readonly SemaphoreSlim gate = new(1, 1);

    public async Task<HealthCheckResult> GetAsync(string key,
        Func<CancellationToken, Task<HealthCheckResult>> compute)
    {
        lock (entries)
        {
            if (entries.TryGetValue(key, out var entry) && DateTime.UtcNow - entry.At < window)
            {
                return entry.Result;
            }
        }

        await gate.WaitAsync();

        try
        {
            lock (entries)
            {
                if (entries.TryGetValue(key, out var entry) && DateTime.UtcNow - entry.At < window)
                {
                    return entry.Result;
                }
            }

            // The compute gets its own deadline as well, so a dependency that
            // never answers cannot hold the gate indefinitely.
            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(400));

            HealthCheckResult result;

            try
            {
                result = await compute(cts.Token);
            }
            catch (OperationCanceledException)
            {
                result = HealthCheckResult.Unhealthy("Did not answer within 400 ms.");
            }

            lock (entries)
            {
                entries[key] = (result, DateTime.UtcNow);
            }

            return result;
        }
        finally
        {
            gate.Release();
        }
    }

    public void Clear()
    {
        lock (entries)
        {
            entries.Clear();
        }
    }
}
