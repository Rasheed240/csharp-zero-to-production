// 00-smallest.cs — The one-line health check, and the four questions it does
// not answer.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every status code and body here is deterministic. The timings
// are machine-specific; the claim is the gap between the rows.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using Microsoft.Extensions.Diagnostics.HealthChecks;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The line everybody writes.
builder.Services.AddHealthChecks();

var app = builder.Build();

// And the line that goes with it.
app.MapHealthChecks("/health");

// Something that actually serves traffic, so there is a difference between
// "the process is up" and "the service works".
bool databaseReachable = true;

app.MapGet("/v1/payments/{id}", (string id) =>
    databaseReachable
        ? Results.Ok(new { id, status = "captured" })
        : Results.Problem("The database is unreachable.", statusCode: 503));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("The one-line health check");
Console.WriteLine();

Console.WriteLine("   request        status   body");
Console.WriteLine("   -------        ------   ----");
Console.WriteLine($"   GET /health    {await Describe(http, "/health")}");
Console.WriteLine($"   GET a payment  {await Describe(http, "/v1/payments/PAY-001")}");

// Now break the thing the service exists to do.
databaseReachable = false;

Console.WriteLine();
Console.WriteLine("   ...the database goes away...");
Console.WriteLine();
Console.WriteLine($"   GET /health    {await Describe(http, "/health")}");
Console.WriteLine($"   GET a payment  {await Describe(http, "/v1/payments/PAY-001")}");

Console.WriteLine();
Console.WriteLine("   THE HEALTH CHECK STILL SAYS Healthy WHILE EVERY REQUEST FAILS. That is");
Console.WriteLine("   not a bug: AddHealthChecks() with no arguments registers NO CHECKS, so");
Console.WriteLine("   the endpoint reports the aggregate of an empty set, which is healthy.");
Console.WriteLine();
Console.WriteLine("   WHAT IT ACTUALLY PROVES is that a request reached this process and a");
Console.WriteLine("   handler ran. That is worth something - it is exactly the question 'is");
Console.WriteLine("   this process alive' - and it is not the question anyone thinks they are");
Console.WriteLine("   asking when they point a load balancer at it.");
Console.WriteLine();

// What one registered check changes.
var second = WebApplication.CreateBuilder();
second.WebHost.UseUrls("http://127.0.0.1:0");
second.Logging.ClearProviders();

second.Services.AddHealthChecks()
    .AddCheck("database", () => databaseReachable
        ? HealthCheckResult.Healthy("Reachable.")
        : HealthCheckResult.Unhealthy("Cannot reach the database."));

var checked_ = second.Build();
checked_.MapHealthChecks("/health");

await checked_.StartAsync();
using var checkedHttp = new HttpClient { BaseAddress = new Uri(checked_.Urls.First()) };

Console.WriteLine("   WITH ONE CHECK REGISTERED, same broken database:");
Console.WriteLine();
Console.WriteLine($"   GET /health    {await Describe(checkedHttp, "/health")}");

databaseReachable = true;

Console.WriteLine($"   ...and once it comes back    {await Describe(checkedHttp, "/health")}");

// How long the endpoint takes, which turns out to matter a great deal.
var clock = Stopwatch.StartNew();

for (int i = 0; i < 20; i++)
{
    await checkedHttp.GetAsync("/health");
}

double perRequest = clock.Elapsed.TotalMilliseconds / 20;

Console.WriteLine();
Console.WriteLine($"   time per /health request     {perRequest:0.00} ms");

await app.StopAsync();
await checked_.StopAsync();

Console.WriteLine();
Console.WriteLine("   FOUR QUESTIONS THAT ENDPOINT HAS ANSWERED WITHOUT BEING ASKED, and each");
Console.WriteLine("   is a section of this module:");
Console.WriteLine();
Console.WriteLine("     1. WHICH QUESTION IS IT ANSWERING? 'Is the process alive', 'is it ready");
Console.WriteLine("        for traffic' and 'has it finished starting' are three different");
Console.WriteLine("        questions with three different consequences, and this endpoint");
Console.WriteLine("        answers all three with one number.");
Console.WriteLine();
Console.WriteLine("     2. WHO IS ASKING? A load balancer removing an instance and an");
Console.WriteLine("        orchestrator KILLING one need different answers. Giving the second");
Console.WriteLine("        one the first one's answer is how a dependency outage becomes a");
Console.WriteLine("        restart loop.");
Console.WriteLine();
Console.WriteLine("     3. WHAT DOES IT COST? Something is calling this every few seconds,");
Console.WriteLine("        forever, from every instance. A check that queries a database is a");
Console.WriteLine("        query multiplied by your instance count and divided by your probe");
Console.WriteLine("        interval.");
Console.WriteLine();
Console.WriteLine("     4. WHAT DOES IT REVEAL? The default response is one word. The detailed");
Console.WriteLine("        one names your dependencies, their versions and why they failed, on");
Console.WriteLine("        an endpoint that is almost always unauthenticated.");
Console.WriteLine();
Console.WriteLine("   NONE OF THOSE HAS A DEFAULT THAT IS RIGHT FOR EVERY SERVICE, which is why");
Console.WriteLine("   the framework does not pick one - and why an unconfigured health check is");
Console.WriteLine("   a decision nobody made.");

// ---------------------------------------------------------------------------
static async Task<string> Describe(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();

    return $"{(int)response.StatusCode}      {(body.Length > 54 ? body[..54] + "..." : body)}";
}
