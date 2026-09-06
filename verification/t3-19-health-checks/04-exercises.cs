// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every status code and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

await One();
await Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static async Task One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the endpoint that is always healthy");
    Console.WriteLine();
    Console.WriteLine("   A service returns 500 on every request because its database is");
    Console.WriteLine("   unreachable. /health returns 200 Healthy throughout. The load balancer");
    Console.WriteLine("   keeps sending it traffic and the dashboard shows a healthy service.");
    Console.WriteLine();
    Console.WriteLine("   The health check code is two lines and looks correct. What is wrong?");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddHealthChecks();

    var app = builder.Build();
    app.MapHealthChecks("/health");
    app.MapGet("/work", () => Results.Problem("Database unreachable.", statusCode: 500));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request      status   body");
    Console.WriteLine("   -------      ------   ----");
    Console.WriteLine($"   GET /health  {await Status(http, "/health")}");
    Console.WriteLine($"   GET /work    {await Status(http, "/work")}");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: AddHealthChecks() WITH NO ARGUMENTS REGISTERS NO CHECKS. The");
    Console.WriteLine("   endpoint reports the aggregate of an empty set, and the aggregate of");
    Console.WriteLine("   nothing is Healthy. It is not broken - it is answering a question");
    Console.WriteLine("   nobody meant to ask.");
    Console.WriteLine();
    Console.WriteLine("   WHAT IT DOES PROVE is that a request reached this process, was routed,");
    Console.WriteLine("   and produced a response. That is a real fact and it is exactly the");
    Console.WriteLine("   question a LIVENESS probe asks - so this endpoint is a perfectly good");
    Console.WriteLine("   liveness check that has been pointed at a load balancer.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS NOT 'ADD A DATABASE CHECK TO /health'. It is to decide which");
    Console.WriteLine("   question this endpoint answers, and then have a second endpoint for the");
    Console.WriteLine("   other question. Putting the database check on the endpoint the");
    Console.WriteLine("   orchestrator's liveness probe reads is the incident in 03-production.");
    Console.WriteLine();
    Console.WriteLine("   THE SMELL TO REMEMBER: A HEALTH CHECK THAT HAS NEVER FAILED HAS NEVER");
    Console.WriteLine("   BEEN TESTED. If you cannot say when it last returned 503, you do not");
    Console.WriteLine("   know that it can.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the check that joined the wrong probe");
    Console.WriteLine();
    Console.WriteLine("   A team splits liveness and readiness properly, with tags and");
    Console.WriteLine("   predicates. Six months later someone adds a check for a new");
    Console.WriteLine("   dependency. A week after that, a blip in that dependency restarts");
    Console.WriteLine("   the whole fleet.");
    Console.WriteLine();
    Console.WriteLine("   The predicates were not changed. What happened?");
    Console.WriteLine();

    bool newDependencyUp = true;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddHealthChecks()
        .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
        .AddCheck("database", () => HealthCheckResult.Healthy(), tags: ["ready"])

        // Added later. No tags, because the person adding it copied the line
        // above without noticing what the third argument was for.
        .AddCheck("search-index", () => newDependencyUp
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy("Search cluster unreachable."));

    var app = builder.Build();

    // The predicates, unchanged.
    app.MapHealthChecks("/health/live", new HealthCheckOptions
    {
        Predicate = r => r.Tags.Contains("live")
    });

    app.MapHealthChecks("/health/ready", new HealthCheckOptions
    {
        Predicate = r => r.Tags.Contains("ready")
    });

    // And the default endpoint, which most teams also leave mapped.
    app.MapHealthChecks("/health");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   search index   /health/live   /health/ready   /health");
    Console.WriteLine("   ------------   ------------   -------------   -------");

    foreach (bool up in new[] { true, false })
    {
        newDependencyUp = up;

        Console.WriteLine($"   {(up ? "up" : "DOWN"),-14} {await Status(http, "/health/live"),-14} " +
            $"{await Status(http, "/health/ready"),-15} {await Status(http, "/health")}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE PREDICATES DID EXACTLY WHAT THEY SAY, AND THE NEW CHECK IS");
    Console.WriteLine("   ON NEITHER OF THEM. It has no tags, so it matches neither predicate -");
    Console.WriteLine("   which means the readiness endpoint does NOT know about the dependency,");
    Console.WriteLine("   and the untagged default endpoint does.");
    Console.WriteLine();
    Console.WriteLine("   SO THE RESTART CAME FROM /health, which is still mapped, and which");
    Console.WriteLine("   something is still probing - a monitoring system, an old load balancer");
    Console.WriteLine("   rule, or the liveness probe on a deployment nobody updated when the");
    Console.WriteLine("   split was introduced.");
    Console.WriteLine();
    Console.WriteLine("   TWO SEPARATE LESSONS COME OUT OF THIS ONE:");
    Console.WriteLine();
    Console.WriteLine("     AN UNTAGGED CHECK IS NOT 'ON EVERY ENDPOINT' - it is on every");
    Console.WriteLine("     endpoint whose predicate happens to admit it, which is the ones with");
    Console.WriteLine("     no predicate. That is the opposite of what the person adding it");
    Console.WriteLine("     expected, in both directions at once: missing where they wanted it,");
    Console.WriteLine("     present where they did not.");
    Console.WriteLine();
    Console.WriteLine("     AN UNUSED ENDPOINT THAT IS STILL MAPPED IS STILL LOAD-BEARING. The");
    Console.WriteLine("     team believed /health was legacy. Something was reading it. Deleting");
    Console.WriteLine("     the mapping would have turned a silent misconfiguration into an");
    Console.WriteLine("     immediate 404 that somebody would have chased.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS A CONVENTION, NOT A CODE CHANGE: EVERY CHECK IS TAGGED, and");
    Console.WriteLine("   there is no endpoint without a predicate. Then adding a check without");
    Console.WriteLine("   deciding where it belongs puts it nowhere, which is visible, rather");
    Console.WriteLine("   than somewhere unexpected, which is not.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the first thirty seconds after a deploy");
    Console.WriteLine();
    Console.WriteLine("   Every deploy produces a burst of 500s that clears on its own within");
    Console.WriteLine("   half a minute. The team has learned to deploy at night and describes");
    Console.WriteLine("   it as 'the usual deploy noise'.");
    Console.WriteLine();
    Console.WriteLine("   Readiness is configured and passing. Where do the errors come from?");
    Console.WriteLine();

    // A cache that takes a moment to load, and a handler that needs it.
    var cache = new WarmingCache();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddHealthChecks()
        // Checks the database, which is up from the first millisecond.
        .AddCheck("database", () => HealthCheckResult.Healthy(), tags: ["ready"])

        // The check that is missing, shown alongside for the contrast.
        .AddCheck("cache-warm", () => cache.Loaded
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy("Reference data still loading."), tags: ["complete"]);

    var app = builder.Build();

    app.MapHealthChecks("/ready-as-configured", new HealthCheckOptions
    {
        Predicate = r => r.Tags.Contains("ready")
    });

    app.MapHealthChecks("/ready-complete", new HealthCheckOptions
    {
        Predicate = r => r.Tags.Contains("ready") || r.Tags.Contains("complete")
    });

    app.MapGet("/work", () => cache.Loaded
        ? Results.Ok(new { result = "ok" })
        : Results.Problem("Reference data not loaded.", statusCode: 500));

    // The cache finishes loading after a short delay.
    _ = Task.Run(async () =>
    {
        await Task.Delay(400);
        cache.Loaded = true;
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   after start   /ready-as-configured   /ready-complete   GET /work");
    Console.WriteLine("   -----------   --------------------   ---------------   ---------");

    var started = DateTime.UtcNow;

    foreach (int wait in new[] { 0, 200, 300, 200 })
    {
        if (wait > 0)
        {
            await Task.Delay(wait);
        }

        Console.WriteLine($"   {(DateTime.UtcNow - started).TotalMilliseconds,9:0} ms   " +
            $"{await Status(http, "/ready-as-configured"),-22} " +
            $"{await Status(http, "/ready-complete"),-17} {await Status(http, "/work")}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: READINESS PASSES BEFORE THE SERVICE CAN ACTUALLY SERVE. The");
    Console.WriteLine("   check verifies the database, which was never the slow part. The slow");
    Console.WriteLine("   part is the reference data the handlers need, and nothing checks it -");
    Console.WriteLine("   so the load balancer is told to send traffic to an instance that will");
    Console.WriteLine("   500 on every request for the next few hundred milliseconds.");
    Console.WriteLine();
    Console.WriteLine("   THE RULE THIS BREAKS: READINESS MUST COVER EVERYTHING A REQUEST NEEDS,");
    Console.WriteLine("   NOT EVERYTHING THAT IS EXTERNAL. The instinct is to check dependencies,");
    Console.WriteLine("   because dependencies are what fail. But readiness is not asking 'are my");
    Console.WriteLine("   dependencies up' - it is asking 'CAN I SERVE A REQUEST', and an");
    Console.WriteLine("   unloaded cache makes the answer no just as surely as a dead database.");
    Console.WriteLine();
    Console.WriteLine("   THE TEST THAT FINDS THESE: FOR EACH CHECK, NAME A REQUEST THAT WOULD");
    Console.WriteLine("   FAIL IF IT FAILED. Then go the other way - for each way a request can");
    Console.WriteLine("   fail, name the check that covers it. The second direction is the one");
    Console.WriteLine("   nobody does, and it is where the gaps are.");
    Console.WriteLine();
    Console.WriteLine("   AND 'THE USUAL DEPLOY NOISE' IS WORTH TREATING AS A SMELL IN ITSELF. A");
    Console.WriteLine("   recurring error burst that clears on its own has a mechanism, and a");
    Console.WriteLine("   team that has named it rather than found it has stopped looking.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - the errors at the other end of the deploy");
    Console.WriteLine();
    Console.WriteLine("   A different service, correctly configured for startup. It still");
    Console.WriteLine("   produces a small burst of failed requests on every deploy - but this");
    Console.WriteLine("   time the failures are connection resets rather than 500s, and they");
    Console.WriteLine("   happen as instances are being REMOVED.");
    Console.WriteLine();
    Console.WriteLine("   The service handles SIGTERM and drains in-flight requests correctly.");
    Console.WriteLine("   Where do the resets come from?");
    Console.WriteLine();

    var state = new ShutdownState();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddHealthChecks()
        .AddCheck("ready", () => state.ShuttingDown
            ? HealthCheckResult.Unhealthy("Shutting down.")
            : HealthCheckResult.Healthy(), tags: ["ready"]);

    var app = builder.Build();
    app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = r => r.Tags.Contains("ready") });
    app.MapGet("/work", () => Results.Ok(new { result = "ok" }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   moment                              /health/ready   GET /work");
    Console.WriteLine("   ------                              -------------   ---------");
    Console.WriteLine($"   steady state                        " +
        $"{await Status(http, "/health/ready"),-15} {await Status(http, "/work")}");

    // SIGTERM arrives. The service starts failing readiness immediately, and
    // keeps serving.
    state.ShuttingDown = true;

    Console.WriteLine($"   SIGTERM received, still serving     " +
        $"{await Status(http, "/health/ready"),-15} {await Status(http, "/work")}");

    Console.WriteLine();
    Console.WriteLine("   AND THE TIMELINE THAT DECIDES WHETHER ANY REQUESTS ARE LOST:");
    Console.WriteLine();
    Console.WriteLine("   without a shutdown delay:");
    Console.WriteLine("     t+0.0s   SIGTERM. Readiness starts failing. Process begins stopping.");
    Console.WriteLine("     t+0.1s   Process has stopped accepting connections.");
    Console.WriteLine("     t+2.0s   Load balancer's next probe fails.");
    Console.WriteLine("     t+4.0s   Load balancer reaches its failure threshold and stops");
    Console.WriteLine("              routing here.");
    Console.WriteLine();
    Console.WriteLine("              EVERY REQUEST SENT BETWEEN t+0.1 AND t+4.0 HITS A SOCKET");
    Console.WriteLine("              THAT IS NO LONGER LISTENING. That is the reset burst, and");
    Console.WriteLine("              it is FOUR SECONDS WIDE per instance, per deploy.");
    Console.WriteLine();
    Console.WriteLine("   with a shutdown delay:");
    Console.WriteLine("     t+0.0s   SIGTERM. Readiness starts failing. Process KEEPS SERVING.");
    Console.WriteLine("     t+2.0s   Load balancer's next probe fails.");
    Console.WriteLine("     t+4.0s   Load balancer stops routing here. No new requests arrive.");
    Console.WriteLine("     t+8.0s   Delay elapses. In-flight requests have finished. Stop.");
    Console.WriteLine();
    Console.WriteLine("              NOTHING IS LOST, because the process outlived the routing");
    Console.WriteLine("              decision that was still sending it traffic.");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: DRAINING IN-FLIGHT REQUESTS IS THE SECOND HALF OF THE PROBLEM");
    Console.WriteLine("   AND THE TEAM ONLY SOLVED THAT ONE. Graceful shutdown finishes the");
    Console.WriteLine("   requests you have ALREADY ACCEPTED. It does nothing about the requests");
    Console.WriteLine("   still being SENT to you, because the load balancer has not noticed yet");
    Console.WriteLine("   - and it cannot notice faster than its probe interval times its failure");
    Console.WriteLine("   threshold.");
    Console.WriteLine();
    Console.WriteLine("   SO THE SHUTDOWN SEQUENCE HAS AN ORDER, and every step is needed:");
    Console.WriteLine();
    Console.WriteLine("     1. FAIL READINESS IMMEDIATELY on SIGTERM. This is the signal to the");
    Console.WriteLine("        load balancer, and it is the only one it will act on.");
    Console.WriteLine();
    Console.WriteLine("     2. KEEP SERVING for longer than the load balancer takes to notice.");
    Console.WriteLine("        Probe interval times failure threshold, plus a margin. This is a");
    Console.WriteLine("        NUMBER YOU HAVE TO LOOK UP, not one you can guess.");
    Console.WriteLine();
    Console.WriteLine("     3. THEN stop accepting and drain what is in flight.");
    Console.WriteLine();
    Console.WriteLine("     4. AND MAKE SURE THE ORCHESTRATOR'S GRACE PERIOD IS LONGER THAN ALL");
    Console.WriteLine("        OF THAT, or it will send SIGKILL in the middle of step 3 and you");
    Console.WriteLine("        are back where you started.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL SHAPE, WHICH IS WORTH MORE THAN THE RECIPE: A HEALTH CHECK");
    Console.WriteLine("   IS AN ASYNCHRONOUS MESSAGE TO A SYSTEM THAT POLLS. Everything it tells");
    Console.WriteLine("   anyone arrives late, by up to one probe interval times one threshold.");
    Console.WriteLine("   Every design that assumes a status change takes effect immediately is");
    Console.WriteLine("   wrong by that amount, and at shutdown that error is measured in dropped");
    Console.WriteLine("   requests.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<string> Status(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();

    return $"{(int)response.StatusCode} {(body.Length > 20 ? body[..20] : body)}";
}

// ---------------------------------------------------------------------------
sealed class WarmingCache
{
    public volatile bool Loaded;
}

// ---------------------------------------------------------------------------
sealed class ShutdownState
{
    public volatile bool ShuttingDown;
}
