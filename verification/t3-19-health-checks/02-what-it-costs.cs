// 02-what-it-costs.cs — A health check runs forever, on every instance, and
// tells whoever asks whatever it knows.
//
// Run:  dotnet run 02-what-it-costs.cs -c Release
//
// EXACT vs RATIO: the counts and response bodies are exact. The timings are
// machine-specific; the claims are the gaps between rows.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

Console.WriteLine("What a health check costs, and what it tells people");
Console.WriteLine();

await TheArithmetic();
await WhenACheckHangs();
await Caching();
await WhatItReveals();

// ---------------------------------------------------------------------------
static async Task TheArithmetic()
{
    Console.WriteLine("1. The arithmetic nobody does");
    Console.WriteLine();
    Console.WriteLine("   A readiness check that queries the database looks like one query. It");
    Console.WriteLine("   is one query per probe, per probe type, per instance, forever.");
    Console.WriteLine();

    int queries = 0;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddHealthChecks()
        .AddCheck("database", () =>
        {
            Interlocked.Increment(ref queries);

            return HealthCheckResult.Healthy();
        }, tags: ["ready"]);

    var app = builder.Build();
    app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = r => r.Tags.Contains("ready") });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    // Ten probes, as one instance would receive in fifty seconds at a five
    // second interval.
    for (int i = 0; i < 10; i++)
    {
        await http.GetAsync("/health/ready");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine($"   10 probes produced {queries} database queries.");
    Console.WriteLine();
    Console.WriteLine("   SCALED UP, WITH ORDINARY NUMBERS:");
    Console.WriteLine();
    Console.WriteLine("   instances   probe every   probers   queries per day from health checks");
    Console.WriteLine("   ---------   -----------   -------   ---------------------------------");

    foreach ((int instances, int seconds, int probers, string note) in new[]
    {
        (3, 10, 1, "small service, one prober"),
        (20, 5, 1, "one prober"),
        (20, 5, 3, "orchestrator + load balancer + monitoring"),
        (60, 2, 3, "large fleet, aggressive intervals")
    })
    {
        long perDay = (long)instances * probers * (86_400 / seconds);

        Console.WriteLine($"   {instances,9}   {seconds,9} s   {probers,7}   {perDay,12:n0}   {note}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE THIRD ROW IS THE ORDINARY CASE and it is over a million queries a");
    Console.WriteLine("   day that no user asked for. THE MULTIPLIER PEOPLE FORGET IS 'probers'.");
    Console.WriteLine("   The orchestrator probes, the load balancer probes, and the monitoring");
    Console.WriteLine("   system probes - three independent systems, none of which knows about");
    Console.WriteLine("   the others.");
    Console.WriteLine();
    Console.WriteLine("   AND THE COST LANDS WHERE YOU CAN LEAST AFFORD IT. The load these");
    Console.WriteLine("   checks generate is highest exactly when the dependency is struggling,");
    Console.WriteLine("   because a struggling dependency makes checks slower and probes keep");
    Console.WriteLine("   arriving at the same rate. A HEALTH CHECK IS A LOAD SOURCE THAT DOES");
    Console.WriteLine("   NOT BACK OFF.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS THE ARGUMENT FOR A CHEAP CHECK: 'SELECT 1' rather than a real");
    Console.WriteLine("   query, a connection from the pool rather than a new one, and nothing");
    Console.WriteLine("   at all in liveness.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhenACheckHangs()
{
    Console.WriteLine("2. A check with no timeout");
    Console.WriteLine();
    Console.WriteLine("   The failure mode people prepare for is a check that returns Unhealthy.");
    Console.WriteLine("   The one that actually happens is a check that does not return.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddHealthChecks()
        // No timeout at all: it waits for as long as the dependency takes.
        .AddAsyncCheck("unbounded", async () =>
        {
            await Task.Delay(2000);

            return HealthCheckResult.Healthy();
        }, tags: ["unbounded"])

        // A timeout is configured - and the work ignores the token it is
        // given, which is what almost every hand-written check does.
        .AddAsyncCheck("timeout-ignored", async () =>
        {
            await Task.Delay(2000);

            return HealthCheckResult.Healthy();
        }, tags: ["ignored"], timeout: TimeSpan.FromMilliseconds(250))

        // The same timeout, with the token passed through to the work.
        .AddCheck<TokenHonouringCheck>("timeout-honoured", tags: ["honoured"],
            failureStatus: HealthStatus.Unhealthy, timeout: TimeSpan.FromMilliseconds(250))

        // And the version that does not rely on the framework at all.
        .AddAsyncCheck("own-timeout", async () =>
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(250));
                await Task.Delay(2000, cts.Token);

                return HealthCheckResult.Healthy();
            }
            catch (OperationCanceledException)
            {
                return HealthCheckResult.Unhealthy("Dependency did not answer within 250 ms.");
            }
        }, tags: ["own"]);

    var app = builder.Build();

    app.MapHealthChecks("/unbounded", new HealthCheckOptions { Predicate = r => r.Tags.Contains("unbounded") });
    app.MapHealthChecks("/ignored", new HealthCheckOptions { Predicate = r => r.Tags.Contains("ignored") });
    app.MapHealthChecks("/honoured", new HealthCheckOptions { Predicate = r => r.Tags.Contains("honoured") });
    app.MapHealthChecks("/own", new HealthCheckOptions { Predicate = r => r.Tags.Contains("own") });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   how the check is written                   probe took   status   result");
    Console.WriteLine("   ------------------------                   ----------   ------   ------");

    foreach ((string path, string how) in new[]
    {
        ("/unbounded", "no timeout at all"),
        ("/ignored", "timeout: set, token ignored"),
        ("/honoured", "timeout: set, token passed through"),
        ("/own", "its own CancellationTokenSource")
    })
    {
        var clock = Stopwatch.StartNew();

        using HttpResponseMessage response = await http.GetAsync(path);
        string body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   {how,-42} {clock.Elapsed.TotalMilliseconds,7:0} ms   " +
            $"{(int)response.StatusCode}      {body}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE SECOND ROW IS THE FINDING. A timeout WAS configured on that check");
    Console.WriteLine("   and the probe still took two seconds. THE FRAMEWORK'S TIMEOUT IS");
    Console.WriteLine("   COOPERATIVE: it cancels a CancellationToken and hands it to your");
    Console.WriteLine("   check. Work that never looks at the token runs to completion, and the");
    Console.WriteLine("   timeout you configured does nothing at all.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS NOT A DEFECT, IT IS HOW CANCELLATION WORKS EVERYWHERE IN .NET,");
    Console.WriteLine("   and it is worth stating plainly because a configured-but-ineffective");
    Console.WriteLine("   timeout is worse than no timeout: somebody read that line in review");
    Console.WriteLine("   and concluded the check was bounded.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD AND FOURTH ROWS BOTH WORK, and the difference is who owns");
    Console.WriteLine("   the deadline:");
    Console.WriteLine();
    Console.WriteLine("     PASSING THE TOKEN THROUGH lets the framework's timeout apply. Every");
    Console.WriteLine("     I/O method in .NET takes a CancellationToken; the check's job is to");
    Console.WriteLine("     forward the one it was given rather than dropping it.");
    Console.WriteLine();
    Console.WriteLine("     ITS OWN CancellationTokenSource works regardless of how the check is");
    Console.WriteLine("     registered, and it can return a MESSAGE saying what timed out rather");
    Console.WriteLine("     than a bare cancellation.");
    Console.WriteLine();
    Console.WriteLine("   AND THE FIRST ROW IS WHAT UNBOUNDED ACTUALLY COSTS, which is more than");
    Console.WriteLine("   the two seconds it shows:");
    Console.WriteLine();
    Console.WriteLine("     THE PROBER HAS ITS OWN TIMEOUT and will give up. A probe that times");
    Console.WriteLine("     out counts as a FAILURE, so an unbounded check does not report");
    Console.WriteLine("     'slow' - it reports 'unhealthy', with nothing anywhere saying why.");
    Console.WriteLine();
    Console.WriteLine("     THE REQUEST IS STILL RUNNING ON YOUR SERVER after the prober gives");
    Console.WriteLine("     up. Probes keep arriving on schedule, so a check taking longer than");
    Console.WriteLine("     the probe interval accumulates concurrent executions - each holding");
    Console.WriteLine("     a connection to the dependency that is already struggling.");
    Console.WriteLine();
    Console.WriteLine("   SO: BOUND EVERY CHECK THAT TOUCHES ANYTHING, well under the prober's");
    Console.WriteLine("   timeout, AND VERIFY THE BOUND ACTUALLY BINDS. The four rows above are");
    Console.WriteLine("   the test - if a slow dependency does not make your probe return");
    Console.WriteLine("   quickly, your timeout is decoration.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Caching()
{
    Console.WriteLine("3. Answering from a cached result");
    Console.WriteLine();
    Console.WriteLine("   Three probers asking every five seconds do not each need a fresh");
    Console.WriteLine("   answer. A result computed once and served for a few seconds is as");
    Console.WriteLine("   truthful and costs a fraction as much.");
    Console.WriteLine();

    int uncachedQueries = 0;
    int cachedQueries = 0;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var cache = new CachedResult(TimeSpan.FromSeconds(3));

    builder.Services.AddHealthChecks()
        .AddCheck("uncached", () =>
        {
            Interlocked.Increment(ref uncachedQueries);

            return HealthCheckResult.Healthy();
        }, tags: ["uncached"])

        .AddAsyncCheck("cached", () => cache.GetAsync(() =>
        {
            Interlocked.Increment(ref cachedQueries);

            return Task.FromResult(HealthCheckResult.Healthy());
        }), tags: ["cached"]);

    var app = builder.Build();

    app.MapHealthChecks("/uncached", new HealthCheckOptions { Predicate = r => r.Tags.Contains("uncached") });
    app.MapHealthChecks("/cached", new HealthCheckOptions { Predicate = r => r.Tags.Contains("cached") });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    // Thirty probes arriving close together, as three probers would produce.
    for (int i = 0; i < 30; i++)
    {
        await http.GetAsync("/uncached");
        await http.GetAsync("/cached");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine("   endpoint     probes   times the dependency was actually asked");
    Console.WriteLine("   --------     ------   ---------------------------------------");
    Console.WriteLine($"   /uncached    {30,6}   {uncachedQueries}");
    Console.WriteLine($"   /cached      {30,6}   {cachedQueries}");

    Console.WriteLine();
    Console.WriteLine("   THIRTY PROBES, ONE QUERY. The answers are identical and one of them");
    Console.WriteLine("   costs a thirtieth as much.");
    Console.WriteLine();
    Console.WriteLine("   THE COST IS STALENESS, AND IT IS SMALLER THAN IT LOOKS. A cache");
    Console.WriteLine("   window shorter than the probe interval means every prober still gets a");
    Console.WriteLine("   fresh answer; a window a little longer means at most one extra probe");
    Console.WriteLine("   sees the old one. Set it against how quickly you need to react, not");
    Console.WriteLine("   against how quickly you can compute.");
    Console.WriteLine();
    Console.WriteLine("   AND THERE IS A SECOND BENEFIT THAT MATTERS MORE UNDER FAILURE: THE");
    Console.WriteLine("   CACHE BOUNDS CONCURRENCY. Without it, a check that becomes slow gets");
    Console.WriteLine("   executed by every arriving probe at once. With it, one execution is in");
    Console.WriteLine("   flight and everyone else waits for the same answer - so the load on a");
    Console.WriteLine("   struggling dependency stops growing exactly when it needs to.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatItReveals()
{
    Console.WriteLine("4. What the endpoint tells whoever asks");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddHealthChecks()
        .AddCheck("sql-primary", () => HealthCheckResult.Unhealthy(
            "A network-related or instance-specific error occurred while establishing a "
            + "connection to SQL Server: ledger-prod-01.internal,1433 (user: ledger_app)"))
        .AddCheck("payments-gateway", () => HealthCheckResult.Degraded(
            "https://gateway.internal.example.com/v3 responded in 4200 ms"));

    var app = builder.Build();

    // The default.
    app.MapHealthChecks("/health");

    // The one people add when they want to see which check failed.
    app.MapHealthChecks("/health/detail", new HealthCheckOptions
    {
        ResponseWriter = async (context, report) =>
        {
            context.Response.ContentType = "application/json";

            await context.Response.WriteAsync(JsonSerializer.Serialize(new
            {
                status = report.Status.ToString(),
                checks = report.Entries.Select(e => new
                {
                    name = e.Key,
                    status = e.Value.Status.ToString(),
                    description = e.Value.Description
                })
            }));
        }
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   GET /health");
    Console.WriteLine($"     {await Body(http, "/health")}");
    Console.WriteLine();
    Console.WriteLine("   GET /health/detail");

    string detail = await Body(http, "/health/detail");

    using JsonDocument document = JsonDocument.Parse(detail);

    Console.WriteLine($"     {JsonSerializer.Serialize(document, new JsonSerializerOptions { WriteIndented = true }).Replace("\n", "\n     ")}");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE DETAILED RESPONSE NAMES YOUR INTERNAL HOSTNAME, YOUR DATABASE");
    Console.WriteLine("   PORT, YOUR APPLICATION'S SQL USERNAME AND YOUR PAYMENT GATEWAY'S");
    Console.WriteLine("   INTERNAL URL - and it does it on an endpoint that is almost always");
    Console.WriteLine("   unauthenticated, because the prober cannot authenticate.");
    Console.WriteLine();
    Console.WriteLine("   NOBODY DECIDED TO PUBLISH THAT. The descriptions come from exception");
    Console.WriteLine("   messages, and exception messages are written to help an operator with");
    Console.WriteLine("   a debugger, not to be served to the internet.");
    Console.WriteLine();
    Console.WriteLine("   THE ONE-WORD DEFAULT IS THE RIGHT DEFAULT, and the way to get detail");
    Console.WriteLine("   without publishing it is to separate the two audiences:");
    Console.WriteLine();
    Console.WriteLine("     THE PROBE gets the plain endpoint. Status code, one word, no");
    Console.WriteLine("     detail. A prober reads the status code and ignores the body anyway.");
    Console.WriteLine();
    Console.WriteLine("     THE OPERATOR gets the detail from LOGS AND METRICS, which are");
    Console.WriteLine("     already authenticated and already where they are looking. Emit one");
    Console.WriteLine("     log line per failed check and one gauge per check, and the detailed");
    Console.WriteLine("     endpoint stops being necessary.");
    Console.WriteLine();
    Console.WriteLine("     IF YOU STILL WANT IT, bind it to a separate internal port or require");
    Console.WriteLine("     authorisation. Both are one line, and both make it a decision.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// Reads the body regardless of status code - a health endpoint answering 503 is
// the normal case here, not an error.
static async Task<string> Body(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.GetAsync(path);

    return await response.Content.ReadAsStringAsync();
}

// ---------------------------------------------------------------------------
// Serves one computed result for a window, and lets only one computation run
// at a time. The second property matters more than the first under failure.
sealed class CachedResult(TimeSpan window)
{
    readonly SemaphoreSlim gate = new(1, 1);

    HealthCheckResult result;
    DateTime computedAt = DateTime.MinValue;

    public async Task<HealthCheckResult> GetAsync(Func<Task<HealthCheckResult>> compute)
    {
        if (DateTime.UtcNow - computedAt < window)
        {
            return result;
        }

        await gate.WaitAsync();

        try
        {
            // Checked again inside the gate: whoever was waiting gets the
            // answer the first caller computed rather than computing it again.
            if (DateTime.UtcNow - computedAt < window)
            {
                return result;
            }

            result = await compute();
            computedAt = DateTime.UtcNow;

            return result;
        }
        finally
        {
            gate.Release();
        }
    }
}

// ---------------------------------------------------------------------------
// A check registered as a type, so that it receives the HealthCheckContext and
// the CancellationToken the framework's timeout cancels - and passes the token
// on to the work, which is the part that makes the timeout real.
sealed class TokenHonouringCheck : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await Task.Delay(2000, cancellationToken);

            return HealthCheckResult.Healthy();
        }
        catch (OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy("Timed out.");
        }
    }
}
