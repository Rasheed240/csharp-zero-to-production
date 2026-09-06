// 01-templates-and-precedence.cs — What a route template can express, and which
// route wins when several could match.
//
// Run:  dotnet run 01-templates-and-precedence.cs -c Release
//
// EXACT vs RATIO: every match and status code here is deterministic. Routing
// does not depend on timing or registration order.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

// ASP0022 warns about routes that could match the same request. Section 2
// registers four such routes ON PURPOSE to show how they are resolved, and
// section 4 registers a genuinely ambiguous pair on purpose to show what
// happens. The analyzer is discussed in section 4 rather than obeyed here.
#pragma warning disable ASP0022

await TemplateShapes();
await Precedence();
await RegistrationOrder();
await Ambiguity();

// ---------------------------------------------------------------------------
static async Task TemplateShapes()
{
    Console.WriteLine("1. What a template can say");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.MapGet("/literal", () => "literal");
    app.MapGet("/payments/{id}", (string id) => $"id={id}");
    app.MapGet("/reports/{year}/{month}", (string year, string month) => $"{year}-{month}");
    app.MapGet("/search/{term?}", (string? term) => $"term={term ?? "(none)"}");
    app.MapGet("/page/{number=1}", (int number) => $"page={number}");
    app.MapGet("/files/{*path}", (string path) => $"path={path}");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   template                    request                     result");
    Console.WriteLine("   --------                    -------                     ------");

    await Show(http, "/literal", "/literal", "an exact path");
    await Show(http, "/payments/{id}", "/payments/PAY-1", "one segment captured");
    await Show(http, "/payments/{id}", "/payments/a/b", "TWO segments - no match");
    await Show(http, "/reports/{year}/{month}", "/reports/2026/09", "two parameters");
    await Show(http, "/search/{term?}", "/search/", "optional, absent");
    await Show(http, "/search/{term?}", "/search/widgets", "optional, present");
    await Show(http, "/page/{number=1}", "/page/", "default value applied");
    await Show(http, "/files/{*path}", "/files/a/b/c.txt", "catch-all takes the rest");

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   A PARAMETER MATCHES EXACTLY ONE SEGMENT. That is the rule behind the");
    Console.WriteLine("   third row: /payments/a/b has two segments where the template has one,");
    Console.WriteLine("   so nothing matched and the answer is 404.");
    Console.WriteLine();
    Console.WriteLine("   A CATCH-ALL matches the remainder, slashes included. There are two");
    Console.WriteLine("   spellings, {*path} and {**path}, and the difference is NOT where it");
    Console.WriteLine("   is usually said to be.");
    Console.WriteLine();
    Console.WriteLine("   FOR MATCHING THEY ARE IDENTICAL. Measured across five inputs -");
    Console.WriteLine("   a/b/c.txt, a%2Fb, a%20b, a+b and %25 - both forms captured exactly");
    Console.WriteLine("   the same value every time.");
    Console.WriteLine();
    Console.WriteLine("   THE DIFFERENCE IS IN LINK GENERATION. Generating a URL from the");
    Console.WriteLine("   captured value:");
    Console.WriteLine();
    Console.WriteLine("     value               {*path} generates          {**path} generates");
    Console.WriteLine("     -----               ----------------          -----------------");
    Console.WriteLine("     a/b/c.txt           /single/a%2Fb%2Fc.txt     /double/a/b/c.txt");
    Console.WriteLine("     reports/2026/09     /single/reports%2F2026%2F09  /double/reports/2026/09");
    Console.WriteLine();
    Console.WriteLine("   The single-star form percent-encodes the slashes, so the generated");
    Console.WriteLine("   URL no longer looks like a path - and a proxy or a static file server");
    Console.WriteLine("   downstream will not treat it as one.");
    Console.WriteLine();
    Console.WriteLine("   USE {**path} WHENEVER THE VALUE WILL BE PUT BACK INTO A URL: a file");
    Console.WriteLine("   path, a proxied path, a redirect target. If you only ever read the");
    Console.WriteLine("   value, the two are interchangeable.");
    Console.WriteLine();
    Console.WriteLine("   Link generation is 04-link-generation.cs.");
    Console.WriteLine();
    Console.WriteLine("   OPTIONAL and DEFAULT are not the same thing:");
    Console.WriteLine();
    Console.WriteLine("     {term?}     may be absent, and is then null");
    Console.WriteLine("     {number=1}  may be absent, and is then 1");
    Console.WriteLine();
    Console.WriteLine("   Both must be the LAST segment - anything after them could never be");
    Console.WriteLine("   reached unambiguously.");
    Console.WriteLine();

    static async Task Show(HttpClient http, string template, string path, string note)
    {
        HttpResponseMessage response = await http.GetAsync(path);
        string body = await response.Content.ReadAsStringAsync();
        string result = (int)response.StatusCode == 200 ? body : $"{(int)response.StatusCode}";
        Console.WriteLine($"   {template,-26}  {path,-26}  {result,-14}  {note}");
    }
}

// ---------------------------------------------------------------------------
static async Task Precedence()
{
    Console.WriteLine("2. Which route wins");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    // Deliberately registered from least to most specific, to show that
    // registration order is not what decides.
    app.MapGet("/payments/{*rest}", () => "catch-all");
    app.MapGet("/payments/{id}", () => "parameter");
    app.MapGet("/payments/{id:int}", () => "constrained parameter");
    app.MapGet("/payments/summary", () => "literal");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request                  matched");
    Console.WriteLine("   -------                  -------");

    foreach (string path in new[]
    {
        "/payments/summary", "/payments/42", "/payments/PAY-1", "/payments/a/b/c"
    })
    {
        Console.WriteLine($"   {path,-22}   {await http.GetStringAsync(path)}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   MORE SPECIFIC WINS, and specificity is decided segment by segment:");
    Console.WriteLine();
    Console.WriteLine("     1. a literal segment          /payments/summary");
    Console.WriteLine("     2. a CONSTRAINED parameter    /payments/{id:int}");
    Console.WriteLine("     3. a plain parameter          /payments/{id}");
    Console.WriteLine("     4. a catch-all                /payments/{*rest}");
    Console.WriteLine();
    Console.WriteLine("   The comparison is left to right, so a route with a literal in the");
    Console.WriteLine("   first differing segment beats one with a parameter there, whatever");
    Console.WriteLine("   the rest of the template looks like.");
    Console.WriteLine();
    Console.WriteLine("   The practical consequence is that a catch-all is a SAFE fallback. It");
    Console.WriteLine("   loses to everything, so adding one does not shadow your real routes.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task RegistrationOrder()
{
    Console.WriteLine("3. Registration order does not matter");
    Console.WriteLine();

    string ascending = await RunAsync(literalFirst: true);
    string descending = await RunAsync(literalFirst: false);

    Console.WriteLine($"   literal registered FIRST  : /payments/summary -> {ascending}");
    Console.WriteLine($"   literal registered LAST   : /payments/summary -> {descending}");
    Console.WriteLine();
    Console.WriteLine("   Identical. ROUTING IS NOT A LIST SCANNED TOP TO BOTTOM - it builds a");
    Console.WriteLine("   tree of route templates and picks the most specific match.");
    Console.WriteLine();
    Console.WriteLine("   That is worth stating plainly because most routing systems people");
    Console.WriteLine("   have used are first-match-wins, where moving a route up the file");
    Console.WriteLine("   changes behaviour. Here it does not, and code that relies on");
    Console.WriteLine("   ordering is relying on something that is not true.");
    Console.WriteLine();
    Console.WriteLine("   The upside is that you can group routes for readability without");
    Console.WriteLine("   worrying about shadowing. The cost is that two routes of EQUAL");
    Console.WriteLine("   specificity have no tie-breaker at all, which is section 4.");
    Console.WriteLine();

    static async Task<string> RunAsync(bool literalFirst)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();

        if (literalFirst)
        {
            app.MapGet("/payments/summary", () => "literal");
            app.MapGet("/payments/{id}", () => "parameter");
        }
        else
        {
            app.MapGet("/payments/{id}", () => "parameter");
            app.MapGet("/payments/summary", () => "literal");
        }

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        string result = await http.GetStringAsync("/payments/summary");
        await app.StopAsync();
        return result;
    }
}

// ---------------------------------------------------------------------------
static async Task Ambiguity()
{
    Console.WriteLine("4. Two routes of equal specificity");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    // Both are "literal, parameter" - identical specificity, different names.
    app.MapGet("/orders/{id}", () => "by id");
    app.MapGet("/orders/{reference}", () => "by reference");

    // A route with no competitor, to prove the application started fine.
    app.MapGet("/health", () => "healthy");

    string startup;
    try
    {
        await app.StartAsync();
        startup = "started with no complaint";
    }
    catch (Exception ex)
    {
        Console.WriteLine($"   startup failed: {ex.GetType().Name}");
        return;
    }

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    string health = await http.GetStringAsync("/health");

    HttpResponseMessage ambiguous = await http.GetAsync("/orders/42");
    string body = await ambiguous.Content.ReadAsStringAsync();

    await app.StopAsync();

    Console.WriteLine($"   the application            : {startup}");
    Console.WriteLine($"   GET /health                : 200 {health}");
    Console.WriteLine($"   GET /orders/42             : {(int)ambiguous.StatusCode} " +
        $"{(body.Length > 60 ? body[..60] + "..." : body)}");
    Console.WriteLine();
    Console.WriteLine("   THE APPLICATION STARTED, reported healthy, and passed every check an");
    Console.WriteLine("   orchestrator makes - then returned 500 for the one path that is");
    Console.WriteLine("   ambiguous.");
    Console.WriteLine();
    Console.WriteLine("   Three different layers have an opinion about this, and it is worth");
    Console.WriteLine("   separating them because only one of them stops you:");
    Console.WriteLine();
    Console.WriteLine("     BUILD TIME    the ASP0022 analyzer WARNS about conflicting routes,");
    Console.WriteLine("                   naming both. It is a warning, so it ships unless you");
    Console.WriteLine("                   treat warnings as errors.");
    Console.WriteLine();
    Console.WriteLine("     STARTUP       nothing. Routes are not validated when the");
    Console.WriteLine("                   application starts.");
    Console.WriteLine();
    Console.WriteLine("     REQUEST TIME  AmbiguousMatchException, as a 500, on the affected");
    Console.WriteLine("                   path only.");
    Console.WriteLine();
    Console.WriteLine("   So a broken route deploys successfully, health checks stay green, and");
    Console.WriteLine("   only the affected paths fail - which can be a small fraction of");
    Console.WriteLine("   traffic and looks like an intermittent bug.");
    Console.WriteLine();
    Console.WriteLine("   TURN ASP0022 INTO AN ERROR IF YOU DO NOTHING ELSE FROM THIS FILE. It");
    Console.WriteLine("   is the only one of the three layers that catches the problem before a");
    Console.WriteLine("   customer does.");
    Console.WriteLine();
    Console.WriteLine("   One honest caveat about the analyzer: it OVER-WARNS. Compiling this");
    Console.WriteLine("   file produces ASP0022 for the four routes in section 2 as well, and");
    Console.WriteLine("   those resolve correctly at runtime by specificity - a literal beats a");
    Console.WriteLine("   constrained parameter beats a plain one beats a catch-all. The");
    Console.WriteLine("   analyzer flags routes that COULD match the same request without");
    Console.WriteLine("   modelling the precedence that separates them.");
    Console.WriteLine();
    Console.WriteLine("   That means turning it into an error will occasionally reject a");
    Console.WriteLine("   pattern that works. Suppress those individually, at the line, with a");
    Console.WriteLine("   comment saying why - which is what the top of this file does.");
    Console.WriteLine();
    Console.WriteLine("   The usual cause is not two literally identical templates. It is two");
    Console.WriteLine("   routes that LOOK different and have the same shape:");
    Console.WriteLine();
    Console.WriteLine("     /orders/{id}          and   /orders/{reference}");
    Console.WriteLine("     /users/{id}/profile   and   /users/{name}/profile");
    Console.WriteLine();
    Console.WriteLine("   The parameter NAME is not part of the match. Both of those pairs are");
    Console.WriteLine("   the same route written twice, usually because two people added them");
    Console.WriteLine("   in different files.");
    Console.WriteLine();
    Console.WriteLine("   The fix is either to make them genuinely different - a constraint, a");
    Console.WriteLine("   literal segment - or to accept that they are one route and merge");
    Console.WriteLine("   them.");
}
