// 05-production.cs — Ledger adds a second way to look up a payment. The deploy
// is green, health checks pass, and 40% of payment lookups start returning 500.
// The fix then makes a different 30% return 404.
//
// Run:  dotnet run 05-production.cs -c Release
//
// EXACT vs RATIO: every status code and count here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

// The conflicting routes in version 2 are registered deliberately, to measure
// what happens. ASP0022 is the analyzer that warns about them, and it is the
// subject of section 4.
#pragma warning disable ASP0022

TheIncident();
await FourVersions();
await WhyItWasNotCaught();
WhatToTake();

// The identifiers Ledger actually has in production: numeric ids from the
// original system, and the alphanumeric ones issued since 2024.
static string[] RealIds() => new[]
{
    "1001", "1002", "1003", "1004",           // legacy numeric
    "PAY-0001", "PAY-0002", "PAY-0003"        // current format
};

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   Ledger's payment lookup has been GET /payments/{id} for years. Ids");
    Console.WriteLine("   are numeric for anything created before 2024 and PAY-nnnn since.");
    Console.WriteLine();
    Console.WriteLine("   A second team is building a reconciliation tool and needs lookup by");
    Console.WriteLine("   the gateway's own reference. They add, in a different file:");
    Console.WriteLine();
    Console.WriteLine("     app.MapGet(\"/payments/{reference}\", LookupByReference);");
    Console.WriteLine();
    Console.WriteLine("   It builds. The pull request is approved - the route is new, the");
    Console.WriteLine("   path is new to the reader, and nothing in the diff touches the");
    Console.WriteLine("   existing endpoint. The deploy succeeds and health checks stay green.");
    Console.WriteLine();
    Console.WriteLine("   Payment lookups start returning 500.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task FourVersions()
{
    Console.WriteLine("2. Four versions, the same seven real identifiers");
    Console.WriteLine();

    Result v1 = await RunAsync("v1  the original route", Version.Original);
    Result v2 = await RunAsync("v2  reference lookup added", Version.Ambiguous);
    Result v3 = await RunAsync("v3  'fixed' with :int", Version.IntConstrained);
    Result v4 = await RunAsync("v4  distinct shapes", Version.Correct);

    Console.WriteLine("   version                        200   404   500");
    Console.WriteLine("   -------                        ---   ---   ---");
    foreach (Result r in new[] { v1, v2, v3, v4 })
    {
        Console.WriteLine($"   {r.Label,-28}  {r.Ok,4}  {r.NotFound,4}  {r.ServerError,4}");
    }

    Console.WriteLine();
    Console.WriteLine("   V2 IS THE INCIDENT. Every one of the seven identifiers returns 500,");
    Console.WriteLine("   because /payments/{id} and /payments/{reference} have identical");
    Console.WriteLine("   shape - literal, parameter - and the router cannot choose.");
    Console.WriteLine();
    Console.WriteLine("   THE PARAMETER NAME IS NOT PART OF THE MATCH. Those two templates are");
    Console.WriteLine("   the same route written twice, and nothing about the second one looks");
    Console.WriteLine("   wrong in a diff that does not show the first.");
    Console.WriteLine();
    Console.WriteLine("   V3 IS THE THREE-MINUTE FIX, made under pressure: constrain the");
    Console.WriteLine("   original route to :int so the two templates differ. It works, in the");
    Console.WriteLine("   sense that the 500s stop.");
    Console.WriteLine();
    Console.WriteLine("   It also 404s every PAY-nnnn identifier - three of the seven, and in");
    Console.WriteLine("   production the majority, because every payment created since 2024");
    Console.WriteLine("   has that shape. A constraint decides whether a route MATCHES, so a");
    Console.WriteLine("   non-matching id means 'no such payment' rather than 'wrong format'.");
    Console.WriteLine();
    Console.WriteLine("   The second incident is worse than the first for one reason: A 500 IS");
    Console.WriteLine("   AN ALERT AND A 404 IS NOT. Error-rate dashboards, circuit breakers");
    Console.WriteLine("   and on-call pagers all treat 5xx as a problem and 4xx as the");
    Console.WriteLine("   caller's business. The service now looks healthy while telling");
    Console.WriteLine("   customers their payments do not exist.");
    Console.WriteLine();
    Console.WriteLine("   V4 IS CORRECT. Both routes exist, with constraints that describe the");
    Console.WriteLine("   two identifier shapes Ledger actually issues, so they are different");
    Console.WriteLine("   routes and every real id matches one of them.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<Result> RunAsync(string label, Version version)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    switch (version)
    {
        case Version.Original:
            app.MapGet("/payments/{id}", (string id) => $"payment {id}");
            break;

        case Version.Ambiguous:
            app.MapGet("/payments/{id}", (string id) => $"payment {id}");
            app.MapGet("/payments/{reference}", (string reference) => $"by reference {reference}");
            break;

        case Version.IntConstrained:
            app.MapGet("/payments/{id:int}", (int id) => $"payment {id}");
            app.MapGet("/payments/{reference:regex(^GW-.+$)}",
                (string reference) => $"by reference {reference}");
            break;

        default:
            // The two shapes Ledger actually issues, plus the gateway's.
            app.MapGet("/payments/{id:regex(^(\\d+|PAY-\\d{{4}})$)}",
                (string id) => $"payment {id}");
            app.MapGet("/payments/{reference:regex(^GW-.+$)}",
                (string reference) => $"by reference {reference}");
            break;
    }

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    int ok = 0;
    int notFound = 0;
    int serverError = 0;

    foreach (string id in RealIds())
    {
        using HttpResponseMessage response = await http.GetAsync($"/payments/{id}");
        switch ((int)response.StatusCode)
        {
            case 200: ok++; break;
            case 404: notFound++; break;
            default: serverError++; break;
        }
    }

    await app.StopAsync();
    return new Result(label, ok, notFound, serverError);
}

// ---------------------------------------------------------------------------
static async Task WhyItWasNotCaught()
{
    Console.WriteLine("3. Why nothing stopped it");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.MapGet("/payments/{id}", (string id) => $"payment {id}");
    app.MapGet("/payments/{reference}", (string reference) => $"by reference {reference}");
    app.MapGet("/health/live", () => "alive");
    app.MapGet("/health/ready", () => "ready");

    string startup;
    try
    {
        await app.StartAsync();
        startup = "SUCCEEDED";
    }
    catch (Exception ex)
    {
        startup = $"failed: {ex.GetType().Name}";
    }

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    int live = (int)(await http.GetAsync("/health/live")).StatusCode;
    int ready = (int)(await http.GetAsync("/health/ready")).StatusCode;
    HttpResponseMessage broken = await http.GetAsync("/payments/1001");

    await app.StopAsync();

    Console.WriteLine($"   application startup       : {startup}");
    Console.WriteLine($"   GET /health/live          : {live}");
    Console.WriteLine($"   GET /health/ready         : {ready}");
    Console.WriteLine($"   GET /payments/1001        : {(int)broken.StatusCode}");
    Console.WriteLine();
    Console.WriteLine("   THE APPLICATION IS BROKEN AND EVERY SIGNAL SAYS IT IS FINE. Routes");
    Console.WriteLine("   are not validated at startup, so a rolling deploy replaces every");
    Console.WriteLine("   healthy pod with a broken one, one at a time, with every probe");
    Console.WriteLine("   passing throughout.");
    Console.WriteLine();
    Console.WriteLine("   Three layers had a chance and only one of them said anything:");
    Console.WriteLine();
    Console.WriteLine("     BUILD TIME    ASP0022 WARNED, naming both routes. It is a warning,");
    Console.WriteLine("                   so it scrolled past in a build log with a hundred");
    Console.WriteLine("                   other lines and the build succeeded.");
    Console.WriteLine();
    Console.WriteLine("     STARTUP       nothing. Routing is not validated here.");
    Console.WriteLine();
    Console.WriteLine("     REQUEST TIME  AmbiguousMatchException, as a 500, on the affected");
    Console.WriteLine("                   paths only.");
    Console.WriteLine();
    Console.WriteLine("   The one control that would have caught this before a customer did");
    Console.WriteLine("   is one line in the project file:");
    Console.WriteLine();
    Console.WriteLine("     <WarningsAsErrors>ASP0022</WarningsAsErrors>");
    Console.WriteLine();
    Console.WriteLine("   The honest caveat, measured in 01-templates-and-precedence.cs: the");
    Console.WriteLine("   analyzer OVER-WARNS. It flags routes that could match the same");
    Console.WriteLine("   request without modelling the precedence that separates them, so a");
    Console.WriteLine("   literal alongside a parameter is reported even though it resolves");
    Console.WriteLine("   correctly. Turning it into an error means occasionally suppressing");
    Console.WriteLine("   it at a line, with a comment.");
    Console.WriteLine();
    Console.WriteLine("   That is a real cost and it is a small one against a deploy that goes");
    Console.WriteLine("   green while returning 500s.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatToTake()
{
    Console.WriteLine("4. What to take from this");
    Console.WriteLine();
    Console.WriteLine("   THE NUMBERS. Ledger handles about 400 payment lookups an hour.");
    Console.WriteLine();
    Console.WriteLine("     v2 ran for 18 minutes before it was rolled back: roughly 120");
    Console.WriteLine("     lookups, all 500, every one of them a merchant unable to see a");
    Console.WriteLine("     payment. It was noticed quickly because 500s page somebody.");
    Console.WriteLine();
    Console.WriteLine("     v3 ran for two days. At roughly 70% of ids being PAY-nnnn, that");
    Console.WriteLine("     is about 13,000 lookups answered '404, no such payment' for");
    Console.WriteLine("     payments that exist - and nothing paged anybody, because a 404 is");
    Console.WriteLine("     the caller's problem by convention.");
    Console.WriteLine();
    Console.WriteLine("   The fix that stopped the alerts caused a hundred times more damage");
    Console.WriteLine("   than the incident, and did it quietly. That is the lesson worth");
    Console.WriteLine("   more than the routing detail.");
    Console.WriteLine();
    Console.WriteLine("   FOUR RULES");
    Console.WriteLine();
    Console.WriteLine("   1. TWO ROUTES WITH THE SAME SHAPE ARE THE SAME ROUTE. Parameter");
    Console.WriteLine("      names are not part of matching. /payments/{id} and");
    Console.WriteLine("      /payments/{reference} are one route declared twice.");
    Console.WriteLine();
    Console.WriteLine("   2. A CONSTRAINT IS A MATCHING RULE, NOT VALIDATION. Adding one to");
    Console.WriteLine("      break a tie changes which requests reach your handler at all, and");
    Console.WriteLine("      everything it excludes becomes a 404 with no explanation.");
    Console.WriteLine();
    Console.WriteLine("   3. CONSTRAIN TO THE SHAPE YOUR DATA ACTUALLY HAS, not the shape you");
    Console.WriteLine("      assume. :int was chosen because the example ids in the ticket");
    Console.WriteLine("      were numeric. Nobody checked what proportion of live ids were.");
    Console.WriteLine();
    Console.WriteLine("   4. A 404 IS NOT A SAFE DEFAULT. It is invisible to alerting, so a");
    Console.WriteLine("      routing mistake that produces 404s outlives one that produces");
    Console.WriteLine("      500s by orders of magnitude.");
    Console.WriteLine();
    Console.WriteLine("   HOW TO CATCH IT");
    Console.WriteLine();
    Console.WriteLine("     - Turn ASP0022 into an error. It is the only build-time signal.");
    Console.WriteLine();
    Console.WriteLine("     - Write a test that requests one REAL identifier of each shape");
    Console.WriteLine("       your system issues and asserts 200. That single test fails for");
    Console.WriteLine("       v2 and for v3, and it is the cheapest thing in this file.");
    Console.WriteLine();
    Console.WriteLine("     - Alert on 404 RATE, not only on 5xx. A step change in 404s after");
    Console.WriteLine("       a deploy is a routing change, and nothing else in your monitoring");
    Console.WriteLine("       will say so.");
}

// ---------------------------------------------------------------------------
enum Version
{
    Original,
    Ambiguous,
    IntConstrained,
    Correct
}

record Result(string Label, int Ok, int NotFound, int ServerError);
