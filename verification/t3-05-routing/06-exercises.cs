// 06-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 06-exercises.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

// Sections 2 and 4 register conflicting routes on purpose, to measure the
// behaviour the module describes.
#pragma warning disable ASP0022

using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

await Exercise1();
await Exercise2();
await Exercise3();
await Exercise4();
await Exercise5();
await Exercise6();

// ---------------------------------------------------------------------------
// 1. EASY — which route wins.
// ---------------------------------------------------------------------------
static async Task Exercise1()
{
    Console.WriteLine("Exercise 1: these four routes are registered in this order. Which one");
    Console.WriteLine("            handles each request?");
    Console.WriteLine();
    Console.WriteLine("     app.MapGet(\"/payments/{*rest}\",   ...);   // catch-all");
    Console.WriteLine("     app.MapGet(\"/payments/{id}\",      ...);   // parameter");
    Console.WriteLine("     app.MapGet(\"/payments/{id:int}\",  ...);   // constrained");
    Console.WriteLine("     app.MapGet(\"/payments/summary\",   ...);   // literal");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

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
    Console.WriteLine("   MORE SPECIFIC WINS, and registration order is irrelevant:");
    Console.WriteLine();
    Console.WriteLine("     1. a literal segment");
    Console.WriteLine("     2. a CONSTRAINED parameter");
    Console.WriteLine("     3. a plain parameter");
    Console.WriteLine("     4. a catch-all");
    Console.WriteLine();
    Console.WriteLine("   Routing is not a list scanned top to bottom. It builds a tree of");
    Console.WriteLine("   templates and picks the most specific match, comparing segment by");
    Console.WriteLine("   segment from the left.");
    Console.WriteLine();
    Console.WriteLine("   Two consequences: you can group routes for readability without");
    Console.WriteLine("   worrying about shadowing, and a catch-all is a SAFE fallback because");
    Console.WriteLine("   it loses to everything.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. EASY — the ambiguous pair.
// ---------------------------------------------------------------------------
static async Task Exercise2()
{
    Console.WriteLine("Exercise 2: two teams add these in different files. What happens, and");
    Console.WriteLine("            when do you find out?");
    Console.WriteLine();
    Console.WriteLine("     app.MapGet(\"/orders/{id}\",        ...);");
    Console.WriteLine("     app.MapGet(\"/orders/{reference}\", ...);");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.MapGet("/orders/{id}", () => "by id");
    app.MapGet("/orders/{reference}", () => "by reference");
    app.MapGet("/health", () => "healthy");

    string startup;
    try
    {
        await app.StartAsync();
        startup = "SUCCEEDED";
    }
    catch (Exception ex)
    {
        startup = ex.GetType().Name;
    }

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    int health = (int)(await http.GetAsync("/health")).StatusCode;
    int order = (int)(await http.GetAsync("/orders/42")).StatusCode;
    await app.StopAsync();

    Console.WriteLine($"   application startup : {startup}");
    Console.WriteLine($"   GET /health         : {health}");
    Console.WriteLine($"   GET /orders/42      : {order}");
    Console.WriteLine();
    Console.WriteLine("   THE PARAMETER NAME IS NOT PART OF THE MATCH. Both templates are");
    Console.WriteLine("   'literal, parameter' - identical shape - so they are the same route");
    Console.WriteLine("   declared twice, and the router cannot choose.");
    Console.WriteLine();
    Console.WriteLine("   You find out at REQUEST TIME. Three layers had a chance:");
    Console.WriteLine();
    Console.WriteLine("     BUILD TIME    ASP0022 warns, naming both routes - but it is a");
    Console.WriteLine("                   WARNING, so the build succeeds and it ships.");
    Console.WriteLine("     STARTUP       nothing. Routes are not validated here.");
    Console.WriteLine("     REQUEST TIME  AmbiguousMatchException as a 500, on the affected");
    Console.WriteLine("                   paths only.");
    Console.WriteLine();
    Console.WriteLine("   So the deploy succeeds, health checks stay green, and a rolling");
    Console.WriteLine("   update replaces every healthy pod with a broken one.");
    Console.WriteLine();
    Console.WriteLine("   Turn ASP0022 into an error. It is the only layer that catches this");
    Console.WriteLine("   before a customer does.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — 404 where 400 was wanted.
// ---------------------------------------------------------------------------
static async Task Exercise3()
{
    Console.WriteLine("Exercise 3: a client reports that /pages/abc returns 404 with an empty");
    Console.WriteLine("            body, and wants to know which field was wrong. The route is");
    Console.WriteLine("            /pages/{n:int:range(1,100)}. What do you tell them, and what");
    Console.WriteLine("            do you change?");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.MapGet("/constrained/{n:int:range(1,100)}", (int n) => Results.Ok(new { page = n }));

    app.MapGet("/validated/{n}", (string n) =>
    {
        if (!int.TryParse(n, out int number))
        {
            return Results.BadRequest(new { error = "page must be a whole number", got = n });
        }

        return number is < 1 or > 100
            ? Results.UnprocessableEntity(new { error = "page must be 1-100", got = number })
            : Results.Ok(new { page = number });
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request                  status   body");
    Console.WriteLine("   -------                  ------   ----");
    foreach (string path in new[]
    {
        "/constrained/50", "/constrained/abc", "/constrained/500",
        "/validated/50", "/validated/abc", "/validated/500"
    })
    {
        HttpResponseMessage response = await http.GetAsync(path);
        string body = await response.Content.ReadAsStringAsync();
        Console.WriteLine($"   {path,-22}   {(int)response.StatusCode,6}   " +
            $"{(body.Length == 0 ? "(empty)" : body)}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   WHAT TO TELL THEM: the 404 is correct, and it is correct because a");
    Console.WriteLine("   CONSTRAINT IS NOT VALIDATION. Constraints run during route MATCHING,");
    Console.WriteLine("   before any handler is chosen. A value that fails one means this route");
    Console.WriteLine("   does not match, and if nothing else matches the answer is 'no such");
    Console.WriteLine("   resource'. From outside, /pages/abc is indistinguishable from a path");
    Console.WriteLine("   that was never registered.");
    Console.WriteLine();
    Console.WriteLine("   WHAT TO CHANGE, if the caller deserves an explanation: take the");
    Console.WriteLine("   parameter unconstrained and validate in the handler, where you can");
    Console.WriteLine("   return 400 for malformed and 422 for out-of-range, with a body.");
    Console.WriteLine();
    Console.WriteLine("   The two are not alternatives, and the usual answer is both: keep the");
    Console.WriteLine("   TYPE constraint for matching and move the RANGE check into the");
    Console.WriteLine("   handler for the message. A range constraint is a reasonable guard and");
    Console.WriteLine("   a poor error message.");
    Console.WriteLine();
    Console.WriteLine("   The failure mode to recognise anywhere: A CLIENT REPORTS 404 FOR A");
    Console.WriteLine("   RESOURCE THAT EXISTS. Usually a constraint rejecting the value - an");
    Console.WriteLine("   id that is a GUID where the route says :int, an id too long for int,");
    Console.WriteLine("   a date in the wrong format.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — the fix that made it worse.
// ---------------------------------------------------------------------------
static async Task Exercise4()
{
    Console.WriteLine("Exercise 4: /payments/{id} and /payments/{reference} are returning 500.");
    Console.WriteLine("            Under pressure, someone constrains the first to :int. Ids in");
    Console.WriteLine("            production are numeric before 2024 and PAY-nnnn since.");
    Console.WriteLine("            What happens, and why is it worse?");
    Console.WriteLine();

    string[] ids = { "1001", "1002", "1003", "1004", "PAY-0001", "PAY-0002", "PAY-0003" };

    Console.WriteLine("   version                        200   404   500");
    Console.WriteLine("   -------                        ---   ---   ---");
    Console.WriteLine($"   ambiguous (the incident)      {await Count(ids, "ambiguous")}");
    Console.WriteLine($"   'fixed' with :int             {await Count(ids, "int")}");
    Console.WriteLine($"   constrained to real shapes    {await Count(ids, "correct")}");
    Console.WriteLine();
    Console.WriteLine("   THE FIX 404s EVERY PAY-nnnn IDENTIFIER - three of these seven, and");
    Console.WriteLine("   in production the majority, because every payment created since 2024");
    Console.WriteLine("   has that shape.");
    Console.WriteLine();
    Console.WriteLine("   IT IS WORSE THAN THE INCIDENT because a 500 is an alert and a 404 is");
    Console.WriteLine("   not. Error-rate dashboards, circuit breakers and pagers all treat 5xx");
    Console.WriteLine("   as a problem and 4xx as the caller's business. The service now looks");
    Console.WriteLine("   healthy while telling customers their payments do not exist.");
    Console.WriteLine();
    Console.WriteLine("   At 400 lookups an hour, the 500s were caught in 18 minutes - about");
    Console.WriteLine("   120 failures. The 404s ran for two days: roughly 13,000 lookups");
    Console.WriteLine("   answered 'no such payment' for payments that exist, with nothing");
    Console.WriteLine("   paging anybody.");
    Console.WriteLine();
    Console.WriteLine("   THE CORRECT FIX constrains each route to the shape it actually");
    Console.WriteLine("   handles, so the two templates differ AND every real identifier still");
    Console.WriteLine("   matches one of them.");
    Console.WriteLine();
    Console.WriteLine("   The rule underneath: CONSTRAIN TO THE SHAPE YOUR DATA HAS, not the");
    Console.WriteLine("   shape you assume. :int was chosen because the ids in the ticket were");
    Console.WriteLine("   numeric, and nobody checked what proportion of live ids were.");
    Console.WriteLine();

    static async Task<string> Count(string[] ids, string version)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();

        switch (version)
        {
            case "ambiguous":
                app.MapGet("/payments/{id}", (string id) => id);
                app.MapGet("/payments/{reference}", (string reference) => reference);
                break;
            case "int":
                app.MapGet("/payments/{id:int}", (int id) => id.ToString());
                app.MapGet("/payments/{reference:regex(^GW-.+$)}", (string r) => r);
                break;
            default:
                app.MapGet("/payments/{id:regex(^(\\d+|PAY-\\d{{4}})$)}", (string id) => id);
                app.MapGet("/payments/{reference:regex(^GW-.+$)}", (string r) => r);
                break;
        }

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        int ok = 0, notFound = 0, error = 0;
        foreach (string id in ids)
        {
            switch ((int)(await http.GetAsync($"/payments/{id}")).StatusCode)
            {
                case 200: ok++; break;
                case 404: notFound++; break;
                default: error++; break;
            }
        }

        await app.StopAsync();
        return $"{ok,4}  {notFound,4}  {error,4}";
    }
}

// ---------------------------------------------------------------------------
// 5. HARD — link generation.
// ---------------------------------------------------------------------------
static async Task Exercise5()
{
    Console.WriteLine("Exercise 5: this Location header is correct locally and 404s in");
    Console.WriteLine("            production, which runs behind an ingress at /ledger.");
    Console.WriteLine("            Diagnose it, fix it, and say what else the fix buys you.");
    Console.WriteLine();
    Console.WriteLine("     return Results.Created($\"/v1/payments/{id}\", payment);");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.UsePathBase("/ledger");
    app.MapGet("/v1/payments/{id}", (string id) => id).WithName("GetPayment");
    app.MapGet("/items/{name}", (string name) => name).WithName("item");

    app.MapGet("/compare", (LinkGenerator links, HttpContext context) => string.Join("\n",
        $"hand-built     : /v1/payments/PAY-1",
        $"with context   : {links.GetPathByName(context, "GetPayment", new { id = "PAY-1" })}",
        $"no context     : {links.GetPathByName("GetPayment", new { id = "PAY-1" })}"));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    string compare = await http.GetStringAsync("/ledger/compare");

    var links = app.Services.GetRequiredService<LinkGenerator>();

    foreach (string line in compare.Split('\n'))
    {
        Console.WriteLine($"   {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   values needing escaping:");
    foreach (string value in new[] { "a b", "a&b", "a/b" })
    {
        Console.WriteLine($"     {value,-5} hand-built /items/{value,-8} generated " +
            $"{links.GetPathByName("item", new { name = value })}");
    }

    Console.WriteLine();
    Console.WriteLine($"   a name that does not exist : " +
        $"{links.GetPathByName("NoSuchRoute", new { }) ?? "null"}");

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   THE DIAGNOSIS: the hand-built string is missing the PathBase. It");
    Console.WriteLine("   works locally, where there is none, and 404s behind the ingress.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX: generate the URL from the route.");
    Console.WriteLine();
    Console.WriteLine("     string? location = links.GetPathByName(context, \"GetPayment\",");
    Console.WriteLine("         new { id });");
    Console.WriteLine("     return Results.Created(location!, payment);");
    Console.WriteLine();
    Console.WriteLine("   PASSING THE CONTEXT is what supplies the PathBase - the context-free");
    Console.WriteLine("   overload produces the same wrong answer as the hand-built string.");
    Console.WriteLine("   Those overloads are for background code, which must be told the");
    Console.WriteLine("   scheme, host and base from configuration because nothing can infer");
    Console.WriteLine("   them.");
    Console.WriteLine();
    Console.WriteLine("   WHAT ELSE IT BUYS:");
    Console.WriteLine();
    Console.WriteLine("     - ESCAPING. Every value in the table above would produce a broken");
    Console.WriteLine("       URL by concatenation, and three of them silently: the ampersand");
    Console.WriteLine("       truncates at a query boundary, the space breaks the request line,");
    Console.WriteLine("       and the slash invents a segment.");
    Console.WriteLine();
    Console.WriteLine("     - ONE PLACE TO CHANGE. Moving /v1 to /v2 updates every Location");
    Console.WriteLine("       header, link and redirect with no other edit.");
    Console.WriteLine();
    Console.WriteLine("     - VALUES THAT ARE NOT ROUTE PARAMETERS become the query string,");
    Console.WriteLine("       so there is no concatenation anywhere.");
    Console.WriteLine();
    Console.WriteLine("   THE COST, and it is real: EVERY FAILURE RETURNS null. A wrong name,");
    Console.WriteLine("   a missing parameter, a value failing a constraint - all null, with no");
    Console.WriteLine("   exception and no log. Passed to Results.Created that is a 201 with no");
    Console.WriteLine("   Location header: a response that looks successful and is missing the");
    Console.WriteLine("   one thing the client needed.");
    Console.WriteLine();
    Console.WriteLine("   Treat null as a bug - throw or log loudly - and add a test that");
    Console.WriteLine("   generates a URL for every named route.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 6. HARD — design the routes.
// ---------------------------------------------------------------------------
static async Task Exercise6()
{
    Console.WriteLine("Exercise 6: design the routes for a versioned payments API.");
    Console.WriteLine();
    Console.WriteLine("   Requirements:");
    Console.WriteLine("     - /v1 and /v2, both live");
    Console.WriteLine("     - every payments endpoint requires an API key; /health does not");
    Console.WriteLine("     - payments are addressable by id (numeric or PAY-nnnn) and by");
    Console.WriteLine("       gateway reference (GW-...)");
    Console.WriteLine("     - creation returns a Location header that is correct behind an");
    Console.WriteLine("       ingress at /ledger");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.UsePathBase("/ledger");

    // Health is outside every group, so nothing applies to it.
    app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

    foreach (string version in new[] { "v1", "v2" })
    {
        var payments = app.MapGroup($"/{version}/payments")
            .WithTags($"payments-{version}")
            .AddEndpointFilter(async (context, next) =>
                string.IsNullOrEmpty(context.HttpContext.Request.Headers["X-Api-Key"].FirstOrDefault())
                    ? Results.Json(new { error = "api key required" }, statusCode: 401)
                    : await next(context));

        payments.MapGet("/{id:regex(^(\\d+|PAY-\\d{{4}})$)}",
            (string id) => Results.Ok(new { id, version }))
            .WithName($"GetPayment-{version}");

        payments.MapGet("/by-reference/{reference:regex(^GW-.+$)}",
            (string reference) => Results.Ok(new { reference, version }));

        payments.MapPost("/", (LinkGenerator links, HttpContext context) =>
        {
            string id = "PAY-0042";
            string? location = links.GetPathByName(context, $"GetPayment-{version}", new { id });
            return Results.Created(location!, new { id, version });
        });
    }

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request                                      status   note");
    Console.WriteLine("   -------                                      ------   ----");

    await Show(http, "GET", "/ledger/health", false, "public");
    await Show(http, "GET", "/ledger/v1/payments/1001", false, "no key");
    await Show(http, "GET", "/ledger/v1/payments/1001", true, "legacy numeric id");
    await Show(http, "GET", "/ledger/v1/payments/PAY-0001", true, "current id format");
    await Show(http, "GET", "/ledger/v2/payments/PAY-0001", true, "same shape under v2");
    await Show(http, "GET", "/ledger/v1/payments/by-reference/GW-abc", true, "gateway reference");
    await Show(http, "GET", "/ledger/v1/payments/nonsense", true, "matches nothing");

    using var create = new HttpRequestMessage(HttpMethod.Post, "/ledger/v1/payments");
    create.Headers.TryAddWithoutValidation("X-Api-Key", "k");
    using HttpResponseMessage created = await http.SendAsync(create);
    Console.WriteLine($"   POST /ledger/v1/payments                        " +
        $"{(int)created.StatusCode}   Location: {created.Headers.Location}");

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   THE DESIGN, and why each part:");
    Console.WriteLine();
    Console.WriteLine("   1. A GROUP PER VERSION carries the prefix, the tag and the API-key");
    Console.WriteLine("      filter. Declared once; an endpoint added later cannot forget it.");
    Console.WriteLine("      A middleware checking the path by string comparison breaks the day");
    Console.WriteLine("      somebody adds /v1/payment-methods.");
    Console.WriteLine();
    Console.WriteLine("   2. /health IS OUTSIDE EVERY GROUP, so nothing applies to it. Being");
    Console.WriteLine("      explicit about what is public is the point of the structure.");
    Console.WriteLine();
    Console.WriteLine("   3. TWO LOOKUP ROUTES WITH DIFFERENT SHAPES. The id route is");
    Console.WriteLine("      constrained to the shapes actually issued; the reference route");
    Console.WriteLine("      sits under a literal segment, which is stronger than relying on");
    Console.WriteLine("      constraints alone to keep them apart.");
    Console.WriteLine();
    Console.WriteLine("      Using a literal here rather than a second bare parameter is the");
    Console.WriteLine("      decision that would have prevented the incident in 05-production.");
    Console.WriteLine();
    Console.WriteLine("   4. NAMED ROUTES AND GENERATED LINKS, so the Location header carries");
    Console.WriteLine("      the /ledger prefix. Note the name includes the version - two");
    Console.WriteLine("      routes cannot share a name, and generation would return null.");
    Console.WriteLine();
    Console.WriteLine("   WHAT THIS DESIGN DOES NOT DO: it does not give a caller sending a");
    Console.WriteLine("   malformed id a useful error. /payments/nonsense is a 404 with no");
    Console.WriteLine("   body. If that matters, take the id unconstrained and validate in the");
    Console.WriteLine("   handler - accepting that the two lookup routes then need the literal");
    Console.WriteLine("   segment to stay distinct, which is why it is there.");
    Console.WriteLine();

    static async Task Show(HttpClient http, string method, string path, bool key, string note)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (key)
        {
            request.Headers.TryAddWithoutValidation("X-Api-Key", "k");
        }

        using HttpResponseMessage response = await http.SendAsync(request);
        Console.WriteLine($"   {method} {path,-40}{(int)response.StatusCode,6}   {note}");
    }
}
