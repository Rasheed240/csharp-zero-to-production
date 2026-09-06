// 04-link-generation.cs — Building URLs from routes instead of from strings,
// and the three ways hand-built URLs go wrong.
//
// Run:  dotnet run 04-link-generation.cs -c Release
//
// EXACT vs RATIO: every generated URL here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

await Generating();
await Encoding();
await PathBaseAndProxies();
await WhenItReturnsNull();

// ---------------------------------------------------------------------------
static async Task Generating()
{
    Console.WriteLine("1. Generating a URL from a route");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.MapGet("/v1/payments/{id}", (string id) => $"payment {id}")
        .WithName("GetPayment");

    app.MapGet("/v1/reports/{year:int}/{month:int}", (int year, int month) => "report")
        .WithName("GetReport");

    // A creation endpoint that returns a Location header built from the route
    // rather than from a string.
    app.MapPost("/v1/payments", (LinkGenerator links, HttpContext context) =>
    {
        string id = "PAY-0042";
        string? location = links.GetPathByName(context, "GetPayment", new { id });
        return Results.Created(location!, new { id });
    });

    await app.StartAsync();
    var linkGenerator = app.Services.GetRequiredService<LinkGenerator>();

    Console.WriteLine("   call                                                    produces");
    Console.WriteLine("   ----                                                    --------");

    string? payment = linkGenerator.GetPathByName("GetPayment", new { id = "PAY-0001" });
    Console.WriteLine($"   GetPathByName(\"GetPayment\", new {{ id = \"PAY-0001\" }})    {payment}");

    string? report = linkGenerator.GetPathByName("GetReport", new { year = 2026, month = 9 });
    Console.WriteLine($"   GetPathByName(\"GetReport\", new {{ year, month }})         {report}");

    // Extra values that are not route parameters become the query string.
    string? withQuery = linkGenerator.GetPathByName("GetPayment",
        new { id = "PAY-0001", expand = "gateway", page = 2 });
    Console.WriteLine($"   ... plus values that are not route parameters            {withQuery}");

    // An absolute URI needs a scheme and host, from the context or explicitly.
    string? absolute = linkGenerator.GetUriByName("GetPayment",
        new { id = "PAY-0001" },
        scheme: "https",
        host: new HostString("api.ledger.example"));
    Console.WriteLine($"   GetUriByName(..., scheme, host)                          {absolute}");

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    using HttpResponseMessage created = await http.PostAsync("/v1/payments", null);

    Console.WriteLine();
    Console.WriteLine($"   POST /v1/payments -> {(int)created.StatusCode} " +
        $"Location: {created.Headers.Location}");
    Console.WriteLine();

    await app.StopAsync();

    Console.WriteLine("   The route template appears ONCE, in the Map call. Everything else");
    Console.WriteLine("   asks for it by name.");
    Console.WriteLine();
    Console.WriteLine("   That is the whole argument for doing it this way, and it is not");
    Console.WriteLine("   about elegance:");
    Console.WriteLine();
    Console.WriteLine("     - CHANGING THE TEMPLATE CHANGES EVERY GENERATED URL. Moving");
    Console.WriteLine("       /v1/payments/{id} to /v2/payments/{id} updates the Location");
    Console.WriteLine("       header, every link in every response, and every redirect - with");
    Console.WriteLine("       no other edit.");
    Console.WriteLine();
    Console.WriteLine("     - ENCODING IS HANDLED, which section 2 shows is not a small point.");
    Console.WriteLine();
    Console.WriteLine("     - PathBase IS INCLUDED, which section 3 shows is the difference");
    Console.WriteLine("       between working and not working behind a proxy.");
    Console.WriteLine();
    Console.WriteLine("   Note that values which are not route parameters become the query");
    Console.WriteLine("   string automatically, so there is no string concatenation anywhere.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Encoding()
{
    Console.WriteLine("2. Encoding, and the two catch-all forms");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.MapGet("/single/{*path}", (string path) => path).WithName("single");
    app.MapGet("/double/{**path}", (string path) => path).WithName("double");
    app.MapGet("/items/{name}", (string name) => name).WithName("item");

    await app.StartAsync();
    var links = app.Services.GetRequiredService<LinkGenerator>();

    Console.WriteLine("   value                 {*path} generates              {**path} generates");
    Console.WriteLine("   -----                 -----------------              ------------------");

    foreach (string value in new[] { "a/b/c.txt", "reports/2026/09" })
    {
        string? one = links.GetPathByName("single", new { path = value });
        string? two = links.GetPathByName("double", new { path = value });
        Console.WriteLine($"   {value,-20}  {one,-29}  {two}");
    }

    Console.WriteLine();
    Console.WriteLine("   values needing escaping, through a normal parameter:");
    Console.WriteLine();

    foreach (string value in new[] { "a b", "a&b", "a/b", "café" })
    {
        Console.WriteLine($"     {value,-8} -> {links.GetPathByName("item", new { name = value })}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   THE TWO CATCH-ALL FORMS DIFFER ONLY HERE. For MATCHING they are");
    Console.WriteLine("   identical - measured in 01-templates-and-precedence.cs across five");
    Console.WriteLine("   inputs, both captured exactly the same value every time.");
    Console.WriteLine();
    Console.WriteLine("   For GENERATION, {*path} percent-encodes the slashes and {**path}");
    Console.WriteLine("   round-trips them. So a URL generated from the single-star form no");
    Console.WriteLine("   longer looks like a path, and anything downstream that treats it as");
    Console.WriteLine("   one - a proxy, a static file server, a CDN rule - will not.");
    Console.WriteLine();
    Console.WriteLine("   USE {**path} WHENEVER THE VALUE GOES BACK INTO A URL. If you only");
    Console.WriteLine("   ever read it, the two are interchangeable.");
    Console.WriteLine();
    Console.WriteLine("   The escaping table is the argument against string concatenation on");
    Console.WriteLine("   its own. Every one of those values would produce a broken URL from");
    Console.WriteLine("   $\"/items/{name}\", and three of the four would do it silently -");
    Console.WriteLine("   the ampersand truncates the path at a query boundary, the space");
    Console.WriteLine("   breaks the request line, and the slash invents a segment.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task PathBaseAndProxies()
{
    Console.WriteLine("3. Behind a proxy, and under a sub-path");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    // The application is mounted under /ledger, as it would be behind an
    // ingress rewriting paths.
    app.UsePathBase("/ledger");

    app.MapGet("/v1/payments/{id}", (string id) => $"payment {id}").WithName("GetPayment");

    app.MapGet("/build-links", (LinkGenerator links, HttpContext context) => string.Join("\n",
        $"hand-built        : /v1/payments/PAY-1",
        $"GetPathByName     : {links.GetPathByName(context, "GetPayment", new { id = "PAY-1" })}",
        $"without a context : {links.GetPathByName("GetPayment", new { id = "PAY-1" })}",
        $"Request.PathBase  : {context.Request.PathBase}",
        $"Request.Path      : {context.Request.Path}"));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    string body = await http.GetStringAsync("/ledger/build-links");
    await app.StopAsync();

    foreach (string line in body.Split('\n'))
    {
        Console.WriteLine($"   {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE HAND-BUILT URL IS WRONG, and it is wrong in the way that is");
    Console.WriteLine("   hardest to catch: it works perfectly on a developer's machine, where");
    Console.WriteLine("   there is no PathBase, and 404s in the environment that has one.");
    Console.WriteLine();
    Console.WriteLine("   Note the difference between the two generator calls. PASSING THE");
    Console.WriteLine("   HttpContext is what supplies the PathBase - without it the generator");
    Console.WriteLine("   has no idea the application is mounted anywhere.");
    Console.WriteLine();
    Console.WriteLine("   So the rule is: PASS THE CONTEXT WHENEVER YOU HAVE ONE. The");
    Console.WriteLine("   context-free overloads exist for background services and startup");
    Console.WriteLine("   code, where there is no request - and in those places you must also");
    Console.WriteLine("   supply the scheme, host and path base yourself, from configuration,");
    Console.WriteLine("   because nothing can infer them.");
    Console.WriteLine();
    Console.WriteLine("   That is the practical catch with generating absolute URLs in a");
    Console.WriteLine("   background job: an email containing a link cannot ask a request what");
    Console.WriteLine("   the public host is. It has to be configured, and it will be wrong in");
    Console.WriteLine("   exactly one environment until somebody notices.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhenItReturnsNull()
{
    Console.WriteLine("4. When generation fails");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.MapGet("/v1/payments/{id}", (string id) => id).WithName("GetPayment");
    app.MapGet("/v1/reports/{year:int}", (int year) => year.ToString()).WithName("GetReport");

    await app.StartAsync();
    var links = app.Services.GetRequiredService<LinkGenerator>();

    Console.WriteLine("   what was asked for                                result");
    Console.WriteLine("   ------------------                                ------");

    Show("a name that does not exist",
        links.GetPathByName("NoSuchRoute", new { id = "PAY-1" }));

    Show("the right name, a missing parameter",
        links.GetPathByName("GetPayment", new { }));

    Show("the right name, wrong parameter name",
        links.GetPathByName("GetPayment", new { paymentId = "PAY-1" }));

    Show("a value that fails the constraint",
        links.GetPathByName("GetReport", new { year = "not-a-year" }));

    Show("everything correct",
        links.GetPathByName("GetPayment", new { id = "PAY-1" }));

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   EVERY FAILURE RETURNS null. No exception, no log, no indication of");
    Console.WriteLine("   which of the four things went wrong.");
    Console.WriteLine();
    Console.WriteLine("   That matters because of where the null usually ends up:");
    Console.WriteLine();
    Console.WriteLine("     Results.Created(location!, body)");
    Console.WriteLine();
    Console.WriteLine("   A null Location produces a 201 with no Location header, which is a");
    Console.WriteLine("   response that looks successful and is missing the one thing the");
    Console.WriteLine("   client needed. Or it lands in a string interpolation and becomes an");
    Console.WriteLine("   empty segment in a link nobody notices until a customer clicks it.");
    Console.WriteLine();
    Console.WriteLine("   The fourth row is the subtle one: CONSTRAINTS RUN DURING GENERATION");
    Console.WriteLine("   TOO. A value that would not match the route cannot be used to build");
    Console.WriteLine("   a URL for it, which is correct and is why a custom constraint has to");
    Console.WriteLine("   behave the same in both directions.");
    Console.WriteLine();
    Console.WriteLine("   Two defences, and the first is nearly free:");
    Console.WriteLine();
    Console.WriteLine("     - TREAT null AS A BUG. Throw, or log loudly. It means a route name");
    Console.WriteLine("       or a parameter set is wrong, and that is a coding error rather");
    Console.WriteLine("       than a runtime condition.");
    Console.WriteLine();
    Console.WriteLine("     - TEST THE NAMES. A test that generates a URL for every named");
    Console.WriteLine("       route with representative values catches a renamed route, a");
    Console.WriteLine("       changed parameter and a tightened constraint - all of which are");
    Console.WriteLine("       otherwise silent.");
    Console.WriteLine();
    Console.WriteLine("   Route names are strings, and nothing checks them. That is the price");
    Console.WriteLine("   of the indirection, and it is worth paying only because the");
    Console.WriteLine("   alternative - the template repeated in a dozen places - fails more");
    Console.WriteLine("   quietly still.");

    static void Show(string what, string? result) =>
        Console.WriteLine($"   {what,-48}  {result ?? "null"}");
}
