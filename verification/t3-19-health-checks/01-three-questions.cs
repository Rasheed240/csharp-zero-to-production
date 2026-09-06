// 01-three-questions.cs — Liveness, readiness and startup are three different
// questions, and answering them with one endpoint is how outages spread.
//
// Run:  dotnet run 01-three-questions.cs -c Release
//
// EXACT vs RATIO: every status code and body here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Net;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

Console.WriteLine("Three questions, three endpoints");
Console.WriteLine();

await WhatEachProbeMeans();
await WhenADependencyFails();
await TheDegradedTrap();
await Startup();

// ---------------------------------------------------------------------------
static async Task WhatEachProbeMeans()
{
    Console.WriteLine("1. The three questions and who asks them");
    Console.WriteLine();
    Console.WriteLine("     LIVENESS    'Is this process working, or is it wedged?'");
    Console.WriteLine("                 Asked by the orchestrator. THE ANSWER 'no' MEANS KILL IT");
    Console.WriteLine("                 AND START ANOTHER. That is the entire consequence, and it");
    Console.WriteLine("                 is why the answer must depend on nothing but this");
    Console.WriteLine("                 process.");
    Console.WriteLine();
    Console.WriteLine("     READINESS   'Should this instance receive traffic right now?'");
    Console.WriteLine("                 Asked by the load balancer and the orchestrator. THE");
    Console.WriteLine("                 ANSWER 'no' MEANS STOP SENDING REQUESTS, and keep asking.");
    Console.WriteLine("                 Nothing is killed and nothing is lost.");
    Console.WriteLine();
    Console.WriteLine("     STARTUP     'Has it finished starting yet?'");
    Console.WriteLine("                 Asked once, at the beginning. Its job is to HOLD OFF THE");
    Console.WriteLine("                 OTHER TWO while a slow start completes, so that a cold");
    Console.WriteLine("                 cache is not mistaken for a wedged process.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // Tags are what let one registration serve three endpoints.
    builder.Services.AddHealthChecks()
        .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
        .AddCheck("warmed-up", () => HealthCheckResult.Healthy(), tags: ["startup"])
        .AddCheck("database", () => HealthCheckResult.Healthy(), tags: ["ready"])
        .AddCheck("gateway", () => HealthCheckResult.Healthy(), tags: ["ready"]);

    var app = builder.Build();

    // Each endpoint runs only the checks it is entitled to run.
    app.MapHealthChecks("/health/live", new HealthCheckOptions
    {
        Predicate = registration => registration.Tags.Contains("live")
    });

    app.MapHealthChecks("/health/ready", new HealthCheckOptions
    {
        Predicate = registration => registration.Tags.Contains("ready")
    });

    app.MapHealthChecks("/health/startup", new HealthCheckOptions
    {
        Predicate = registration => registration.Tags.Contains("startup")
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   endpoint            runs which checks");
    Console.WriteLine("   --------            -----------------");
    Console.WriteLine("   /health/live        self");
    Console.WriteLine("   /health/ready       database, gateway");
    Console.WriteLine("   /health/startup     warmed-up");
    Console.WriteLine();
    Console.WriteLine("   all three, with everything working:");
    Console.WriteLine();

    foreach (string path in new[] { "/health/live", "/health/ready", "/health/startup" })
    {
        using HttpResponseMessage response = await http.GetAsync(path);

        Console.WriteLine($"   {path,-20} {(int)response.StatusCode} " +
            $"{await response.Content.ReadAsStringAsync()}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE Predicate IS THE WHOLE MECHANISM. One set of registrations, three");
    Console.WriteLine("   endpoints, each filtered by tag. A check with no tags runs on any");
    Console.WriteLine("   endpoint whose predicate lets it through - so an untagged check added");
    Console.WriteLine("   later can quietly join your liveness probe.");
    Console.WriteLine();
    Console.WriteLine("   TAG EVERY CHECK. An untagged check is a check whose blast radius is");
    Console.WriteLine("   decided by whoever writes the next predicate.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhenADependencyFails()
{
    Console.WriteLine("2. What each probe does when a dependency goes away");
    Console.WriteLine();

    bool databaseUp = true;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddHealthChecks()
        .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
        .AddCheck("database", () => databaseUp
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy("Connection refused."), tags: ["ready"]);

    var app = builder.Build();

    app.MapHealthChecks("/health/live", new HealthCheckOptions
    {
        Predicate = r => r.Tags.Contains("live")
    });

    app.MapHealthChecks("/health/ready", new HealthCheckOptions
    {
        Predicate = r => r.Tags.Contains("ready")
    });

    // The endpoint people actually write, which runs everything.
    app.MapHealthChecks("/health");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   database   /health/live   /health/ready   /health (all checks)");
    Console.WriteLine("   --------   ------------   -------------   --------------------");

    foreach (bool up in new[] { true, false })
    {
        databaseUp = up;

        Console.WriteLine($"   {(up ? "up" : "DOWN"),-10} {await Status(http, "/health/live"),-14} " +
            $"{await Status(http, "/health/ready"),-15} {await Status(http, "/health")}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   READ THE BOTTOM ROW AS THREE DIFFERENT INSTRUCTIONS TO THREE DIFFERENT");
    Console.WriteLine("   SYSTEMS, because that is what it is:");
    Console.WriteLine();
    Console.WriteLine("     /health/live SAYS 200. The process is fine - do not kill it. It is");
    Console.WriteLine("     waiting for a database that will come back, and restarting it will");
    Console.WriteLine("     not bring the database back any sooner.");
    Console.WriteLine();
    Console.WriteLine("     /health/ready SAYS 503. Do not send this instance traffic. It cannot");
    Console.WriteLine("     serve requests, so stop giving it any, and keep asking.");
    Console.WriteLine();
    Console.WriteLine("     /health SAYS 503 TO WHOEVER ASKED. If that is the liveness probe,");
    Console.WriteLine("     you have just told the orchestrator to kill a healthy process");
    Console.WriteLine("     because a shared database is down.");
    Console.WriteLine();
    Console.WriteLine("   NOW MULTIPLY THAT BY YOUR INSTANCE COUNT. Every instance shares that");
    Console.WriteLine("   database, so every instance fails its liveness probe at the same time,");
    Console.WriteLine("   so every instance is killed at the same time. The database recovers");
    Console.WriteLine("   thirty seconds later and finds nothing running, and the fleet is now");
    Console.WriteLine("   cold-starting into a database that is being hammered by reconnecting");
    Console.WriteLine("   instances. THAT IS THE HEALTH CHECK THAT TOOK DOWN THE CLUSTER, and it");
    Console.WriteLine("   is one wrong predicate.");
    Console.WriteLine();
    Console.WriteLine("   THE RULE THAT FALLS OUT OF IT: A LIVENESS CHECK MUST NEVER TOUCH");
    Console.WriteLine("   ANYTHING OUTSIDE THE PROCESS. Not the database, not a queue, not");
    Console.WriteLine("   another service, not DNS. If the answer can be 'no' for a reason that");
    Console.WriteLine("   restarting will not fix, it does not belong in liveness.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheDegradedTrap()
{
    Console.WriteLine("3. Degraded, and the status code it produces");
    Console.WriteLine();
    Console.WriteLine("   There are three health statuses, not two. The third one is useful and");
    Console.WriteLine("   its default HTTP mapping surprises people.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddHealthChecks()
        .AddCheck("healthy-one", () => HealthCheckResult.Healthy("Fine."), tags: ["h"])
        .AddCheck("degraded-one", () => HealthCheckResult.Degraded("Slow, but working."), tags: ["d"])
        .AddCheck("unhealthy-one", () => HealthCheckResult.Unhealthy("Gone."), tags: ["u"]);

    var app = builder.Build();

    app.MapHealthChecks("/h", new HealthCheckOptions { Predicate = r => r.Tags.Contains("h") });
    app.MapHealthChecks("/d", new HealthCheckOptions { Predicate = r => r.Tags.Contains("d") });
    app.MapHealthChecks("/u", new HealthCheckOptions { Predicate = r => r.Tags.Contains("u") });

    // The same degraded check, told to answer 503 instead.
    app.MapHealthChecks("/d-strict", new HealthCheckOptions
    {
        Predicate = r => r.Tags.Contains("d"),
        ResultStatusCodes =
        {
            [HealthStatus.Healthy] = StatusCodes.Status200OK,
            [HealthStatus.Degraded] = StatusCodes.Status503ServiceUnavailable,
            [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable
        }
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   check result   endpoint     status   body");
    Console.WriteLine("   ------------   --------     ------   ----");
    Console.WriteLine($"   Healthy        /h           {await Status(http, "/h")}");
    Console.WriteLine($"   Degraded       /d           {await Status(http, "/d")}");
    Console.WriteLine($"   Unhealthy      /u           {await Status(http, "/u")}");
    Console.WriteLine($"   Degraded       /d-strict    {await Status(http, "/d-strict")}");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   DEGRADED RETURNS 200 BY DEFAULT. A load balancer sees 200 and keeps");
    Console.WriteLine("   sending traffic, which is exactly right: degraded means 'working, but");
    Console.WriteLine("   not well', and taking the instance out of rotation for that is usually");
    Console.WriteLine("   worse than leaving it in.");
    Console.WriteLine();
    Console.WriteLine("   WHICH MAKES DEGRADED A SIGNAL FOR HUMANS, NOT FOR ROUTING. Use it when");
    Console.WriteLine("   you want the fact recorded and alerted on without changing where");
    Console.WriteLine("   traffic goes - a cache that is cold, a replica that is lagging, a");
    Console.WriteLine("   non-essential dependency that is slow.");
    Console.WriteLine();
    Console.WriteLine("   AND IF YOU DO WANT IT TO SHED TRAFFIC, SAY SO. ResultStatusCodes is");
    Console.WriteLine("   the whole change, and it is per-endpoint - which is right, because");
    Console.WriteLine("   'degraded' may mean 'keep serving' to a load balancer and 'do not");
    Console.WriteLine("   promote this deployment' to a release pipeline.");
    Console.WriteLine();
    Console.WriteLine("   THE AGGREGATION RULE IS WORTH KNOWING: THE WORST RESULT WINS. One");
    Console.WriteLine("   unhealthy check among twenty healthy ones makes the endpoint");
    Console.WriteLine("   unhealthy, and one degraded among twenty healthy makes it degraded.");
    Console.WriteLine("   Which means EVERY CHECK YOU ADD TO READINESS IS A NEW WAY TO TAKE THE");
    Console.WriteLine("   INSTANCE OUT OF ROTATION.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Startup()
{
    Console.WriteLine("4. The startup probe, and the problem it solves");
    Console.WriteLine();
    Console.WriteLine("   A service that takes ninety seconds to warm a cache is not wedged. It");
    Console.WriteLine("   is starting. Without a startup probe you have to choose between two");
    Console.WriteLine("   bad options: a liveness timeout long enough to cover the slow start -");
    Console.WriteLine("   which means a genuinely wedged process takes ninety seconds to be");
    Console.WriteLine("   noticed - or a short one that kills the service before it finishes,");
    Console.WriteLine("   forever.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // Stands in for the warm-up: ready after a few hundred milliseconds.
    var startedAt = DateTime.UtcNow;
    TimeSpan warmUp = TimeSpan.FromMilliseconds(300);

    builder.Services.AddHealthChecks()
        .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
        .AddCheck("warm", () => DateTime.UtcNow - startedAt > warmUp
            ? HealthCheckResult.Healthy("Cache loaded.")
            : HealthCheckResult.Unhealthy("Still loading the cache."), tags: ["startup"]);

    var app = builder.Build();

    app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = r => r.Tags.Contains("live") });
    app.MapHealthChecks("/health/startup", new HealthCheckOptions { Predicate = r => r.Tags.Contains("startup") });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   time since start   /health/startup   /health/live");
    Console.WriteLine("   ----------------   ---------------   ------------");

    foreach (int wait in new[] { 0, 150, 200, 200 })
    {
        if (wait > 0)
        {
            await Task.Delay(wait);
        }

        Console.WriteLine($"   {(DateTime.UtcNow - startedAt).TotalMilliseconds,13:0} ms   " +
            $"{await Status(http, "/health/startup"),-17} {await Status(http, "/health/live")}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   LIVENESS WAS HEALTHY THROUGHOUT and startup was not. That is the");
    Console.WriteLine("   division of labour: the process is fine from the first millisecond,");
    Console.WriteLine("   and it is not ready to be judged by the other probes until the startup");
    Console.WriteLine("   one passes.");
    Console.WriteLine();
    Console.WriteLine("   THE ORCHESTRATOR IS WHAT MAKES IT USEFUL. In Kubernetes a startup");
    Console.WriteLine("   probe SUSPENDS the liveness and readiness probes until it succeeds");
    Console.WriteLine("   once, and it gets its own generous timeout. So you can have a ninety");
    Console.WriteLine("   second allowance for starting AND a five second liveness timeout");
    Console.WriteLine("   afterwards - which is the combination neither probe can give you");
    Console.WriteLine("   alone.");
    Console.WriteLine();
    Console.WriteLine("   IF YOU HAVE NO STARTUP PROBE, YOU HAVE MADE THE CHOICE ANYWAY, by");
    Console.WriteLine("   whatever initialDelaySeconds somebody guessed. A deployment that");
    Console.WriteLine("   'sometimes needs restarting a couple of times to come up' is usually");
    Console.WriteLine("   this, and it is usually described as flakiness rather than as a probe");
    Console.WriteLine("   killing a service that was going to work.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<string> Status(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();

    return $"{(int)response.StatusCode} {body}";
}
