// 05-minimal-example.cs — An API that can evolve: two versions, an additive
// change that needed neither, telemetry that says who is on what, and a
// retirement path that is rehearsable.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;

var usage = new ConcurrentDictionary<string, int>();

// The retirement stage, which in a real service is a feature flag rather than
// a variable - so that the brown-out and the retirement are one code path.
var stage = Stage.Deprecated;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseStatusCodePages();

// ---------------------------------------------------------------------------
// TELEMETRY FIRST, because every decision about retiring a version depends on
// it and it has to have been running for months by then.
app.Use(async (context, next) =>
{
    await next(context);

    string version = context.Request.Path.StartsWithSegments("/v1") ? "v1"
        : context.Request.Path.StartsWithSegments("/v2") ? "v2"
        : "unversioned";

    string client = context.Request.Headers["X-Client-Id"].ToString() is { Length: > 0 } id
        ? id
        : "(unidentified)";

    usage.AddOrUpdate($"{version,-12} {client}", 1, (_, count) => count + 1);
});

// ---------------------------------------------------------------------------
// v1: deprecated, still working, and saying so in a way a machine can read.
RouteGroupBuilder v1 = app.MapGroup("/v1");

v1.AddEndpointFilter(async (context, next) =>
{
    HttpResponse response = context.HttpContext.Response;

    response.Headers["Deprecation"] = "Wed, 01 Jan 2026 00:00:00 GMT";
    response.Headers["Sunset"] = "Wed, 01 Jul 2026 00:00:00 GMT";
    response.Headers["Link"] =
        "<https://docs.ledger.example/v2/migration>; rel=\"deprecation\"; type=\"text/html\"";

    if (stage != Stage.Deprecated)
    {
        return Results.Problem(
            title: "This API version has been retired",
            detail: "Use /v2/payments. See https://docs.ledger.example/v2/migration",
            statusCode: 410);
    }

    return await next(context);
});

v1.MapGet("/payments/{id}", (string id) => Results.Ok(new
{
    id,
    amount = 500.00m,
    currency = "GBP"
}));

// ---------------------------------------------------------------------------
// v2: the current version. The breaking change - amount in minor units - is the
// only reason this version exists.
RouteGroupBuilder v2 = app.MapGroup("/v2");

v2.MapGet("/payments/{id}", (string id) => Results.Ok(new
{
    id,
    amountMinor = 50_000L,
    currency = "GBP",
    // ADDITIVE, and shipped into v2 without a v3. A client that has never
    // heard of this field ignores it.
    status = "captured",
    settledAt = "2026-01-15T09:14:00Z"
}));

// An unversioned request is rejected rather than guessed at.
app.MapGet("/payments/{id}", (string id) => Results.Problem(
    title: "An api version is required",
    detail: "Use /v1/payments or /v2/payments. /v1 is deprecated; see the Link header.",
    statusCode: 400));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("1. Two versions, and an additive change that needed neither");
Console.WriteLine();

await Show(http, "acme-corp", "/v1/payments/PAY-1");
await Show(http, "acme-corp", "/v2/payments/PAY-1");
await Show(http, null, "/v2/payments/PAY-1");
await Show(http, null, "/payments/PAY-1");

Console.WriteLine("   THE v2 RESPONSE GAINED TWO FIELDS AND STAYED v2. Adding to a response is");
Console.WriteLine("   safe, so 'we added settledAt' is a release note rather than a version.");
Console.WriteLine();
Console.WriteLine("   THE UNVERSIONED REQUEST IS A 400, not a guess. Defaulting to the latest");
Console.WriteLine("   would silently opt every forgetful caller into the next breaking change;");
Console.WriteLine("   defaulting to the oldest would keep v1 alive forever.");
Console.WriteLine();

Console.WriteLine("2. Who is on what");
Console.WriteLine();
Console.WriteLine("   version      client                requests");
Console.WriteLine("   -------      ------                --------");

foreach ((string key, int count) in usage.OrderBy(pair => pair.Key))
{
    Console.WriteLine($"   {key,-34}  {count,6}");
}

Console.WriteLine();
Console.WriteLine("   Eight lines of middleware, and the retirement decision stops being a");
Console.WriteLine("   date on a calendar and becomes a condition on a number.");
Console.WriteLine();

Console.WriteLine("3. The retirement, rehearsed");
Console.WriteLine();
Console.WriteLine("   stage                     GET /v1   Sunset   what the caller is told");
Console.WriteLine("   -----                     -------   ------   -----------------------");

foreach (Stage current in new[] { Stage.Deprecated, Stage.BrownOut, Stage.Retired })
{
    stage = current;

    using HttpResponseMessage response = await http.GetAsync("/v1/payments/PAY-1");
    string body = await response.Content.ReadAsStringAsync();

    string told = body.Contains("retired", StringComparison.Ordinal)
        ? "retired, and where to go instead"
        : "the payment, plus a Sunset date";

    Console.WriteLine($"   {Describe(current),-24}  {(int)response.StatusCode,7}   " +
        $"{(response.Headers.Contains("Sunset") ? "yes" : "no"),-6}   {told}");
}

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   THE BROWN-OUT AND THE RETIREMENT ARE THE SAME CODE PATH. That is what");
Console.WriteLine("   makes the rehearsal worth doing: it exercises exactly what the real");
Console.WriteLine("   thing will do, two hours at a time, while it is still reversible.");
Console.WriteLine();

Console.WriteLine("THE CHECKLIST THIS FILE IS BUILT FROM");
Console.WriteLine();
Console.WriteLine("   Version in the URL path, so it is visible in every access log, dashboard");
Console.WriteLine("     and support ticket without anybody adding anything");
Console.WriteLine();
Console.WriteLine("   A new version ONLY for a breaking change. Additive changes ship into the");
Console.WriteLine("     current version, because a client that has never heard of a field");
Console.WriteLine("     ignores it");
Console.WriteLine();
Console.WriteLine("   An unversioned request is REJECTED with a message naming the options -");
Console.WriteLine("     not defaulted to the latest, which opts forgetful callers into every");
Console.WriteLine("     future break");
Console.WriteLine();
Console.WriteLine("   Deprecation, Sunset and Link headers on every old-version response, from");
Console.WriteLine("     the day the replacement ships - not from the day retirement is planned");
Console.WriteLine();
Console.WriteLine("   Usage counted per version AND per caller, from the same day, because the");
Console.WriteLine("     set of callers is not the set of registered accounts");
Console.WriteLine();
Console.WriteLine("   Retirement returns 410 with a body saying where to go, not 404");
Console.WriteLine();
Console.WriteLine("   The brown-out and the retirement are one flag over one code path, so the");
Console.WriteLine("     rehearsal tests the real thing");
Console.WriteLine();
Console.WriteLine("WHAT MAKES IT HOLD");
Console.WriteLine();
Console.WriteLine("   Almost none of this is about versioning. It is about the two facts that");
Console.WriteLine("   make versioning expensive.");
Console.WriteLine();
Console.WriteLine("   THE FIRST IS THAT YOU DO NOT KNOW WHO CALLS YOU. Announcements go to");
Console.WriteLine("   people and requests come from processes, and there is no reliable mapping");
Console.WriteLine("   between them - which is why the telemetry and the Sunset header both");
Console.WriteLine("   exist, reaching different halves of the same problem.");
Console.WriteLine();
Console.WriteLine("   THE SECOND IS THAT CREATING A VERSION IS AN AFTERNOON AND REMOVING ONE IS");
Console.WriteLine("   A PROJECT WITH OTHER PEOPLE'S CALENDARS IN IT. Everything above is in");
Console.WriteLine("   service of the same conclusion:");
Console.WriteLine();
Console.WriteLine("     THE CHEAPEST VERSION IS THE ONE YOU DID NOT HAVE TO CREATE. Before");
Console.WriteLine("     adding v3, check whether the change can be additive - a new field");
Console.WriteLine("     alongside the old one, populated in both, with the old one documented");
Console.WriteLine("     as deprecated and removed when the telemetry says nobody reads it.");
Console.WriteLine();
Console.WriteLine("   A redundant field for two years is cheaper than a version by an enormous");
Console.WriteLine("   margin, and the margin is measured in other teams' time rather than");
Console.WriteLine("   yours.");

// ---------------------------------------------------------------------------
static async Task Show(HttpClient http, string? client, string path)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);

    if (client is not null)
    {
        request.Headers.Add("X-Client-Id", client);
    }

    using HttpResponseMessage response = await http.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();

    Console.WriteLine($"   {path,-22}  {client ?? "(no client id)",-16}  {(int)response.StatusCode}");
    Console.WriteLine($"     {(body.Length > 96 ? body[..96] + "..." : body)}");

    if (response.Headers.Contains("Sunset"))
    {
        Console.WriteLine($"     Sunset: {string.Join(", ", response.Headers.GetValues("Sunset"))}");
    }

    Console.WriteLine();
}

static string Describe(Stage stage) => stage switch
{
    Stage.Deprecated => "deprecated, working",
    Stage.BrownOut => "brown-out, two hours",
    _ => "retired"
};

enum Stage { Deprecated, BrownOut, Retired }
