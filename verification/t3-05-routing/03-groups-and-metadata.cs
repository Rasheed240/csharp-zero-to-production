// 03-groups-and-metadata.cs — Route groups, endpoint metadata, and where an
// endpoint filter sits relative to middleware.
//
// Run:  dotnet run 03-groups-and-metadata.cs -c Release
//
// EXACT vs RATIO: every path, ordering and status code here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;

await Groups();
await Metadata();
await FilterOrder();
await Nesting();

// ---------------------------------------------------------------------------
static async Task Groups()
{
    Console.WriteLine("1. A group is a prefix plus everything applied to it");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    var payments = app.MapGroup("/v1/payments")
        .WithTags("payments")
        .AddEndpointFilter(async (context, next) =>
        {
            // Applied once, runs for every endpoint in the group.
            string? key = context.HttpContext.Request.Headers["X-Api-Key"].FirstOrDefault();

            if (string.IsNullOrEmpty(key))
            {
                return Results.Json(new { error = "api key required" }, statusCode: 401);
            }

            return await next(context);
        });

    payments.MapGet("/", () => "list");
    payments.MapGet("/{id}", (string id) => $"get {id}");
    payments.MapPost("/", () => Results.Created("/v1/payments/PAY-1", new { id = "PAY-1" }));

    // Outside the group: no prefix, no filter.
    app.MapGet("/health", () => "healthy");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request                     with key   without key");
    Console.WriteLine("   -------                     --------   -----------");

    foreach (string path in new[] { "/v1/payments", "/v1/payments/PAY-9", "/health" })
    {
        int with = await StatusAsync(http, path, withKey: true);
        int without = await StatusAsync(http, path, withKey: false);
        Console.WriteLine($"   GET {path,-24}{with,6}   {without,11}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   The three payment endpoints share a prefix and a filter, declared");
    Console.WriteLine("   once. /health is outside the group and unaffected.");
    Console.WriteLine();
    Console.WriteLine("   MapGroup gives you three things at once:");
    Console.WriteLine();
    Console.WriteLine("     - A PATH PREFIX, so the routes inside are written relative to it.");
    Console.WriteLine("       Unlike app.Map, this does NOT move anything into PathBase - the");
    Console.WriteLine("       full path is still the full path, and link generation produces");
    Console.WriteLine("       the complete URL.");
    Console.WriteLine();
    Console.WriteLine("     - SHARED METADATA - tags, names, response types, authorisation");
    Console.WriteLine("       policies - applied to every endpoint in the group.");
    Console.WriteLine();
    Console.WriteLine("     - SHARED FILTERS, which run for every endpoint in the group and");
    Console.WriteLine("       nowhere else.");
    Console.WriteLine();
    Console.WriteLine("   The value is that the cross-cutting concern is declared where the");
    Console.WriteLine("   routes are, rather than as a path check inside a middleware. A");
    Console.WriteLine("   middleware guarding '/v1/payments' by string comparison breaks");
    Console.WriteLine("   silently the day somebody adds /v1/payment-methods; a group cannot.");
    Console.WriteLine();

    static async Task<int> StatusAsync(HttpClient http, string path, bool withKey)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (withKey)
        {
            request.Headers.TryAddWithoutValidation("X-Api-Key", "k");
        }

        using HttpResponseMessage response = await http.SendAsync(request);
        return (int)response.StatusCode;
    }
}

// ---------------------------------------------------------------------------
static async Task Metadata()
{
    Console.WriteLine("2. What metadata is, and who reads it");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    // A middleware placed AFTER routing can see which endpoint was selected
    // and everything attached to it. Before routing there is no endpoint.
    app.Use(async (context, next) =>
    {
        var endpoint = context.GetEndpoint();

        if (endpoint is not null)
        {
            var names = endpoint.Metadata
                .Select(m => m.GetType().Name)
                .Where(n => !n.StartsWith("<", StringComparison.Ordinal))
                .Distinct()
                .Order()
                .ToArray();

            context.Items["endpoint"] = endpoint.DisplayName ?? "(unnamed)";
            context.Items["metadata"] = string.Join(", ", names);
        }

        await next();
    });

    app.MapGet("/tagged", (HttpContext c) => string.Join("\n",
            $"endpoint : {c.Items["endpoint"]}",
            $"metadata : {c.Items["metadata"]}"))
        .WithName("TaggedEndpoint")
        .WithTags("reporting")
        .WithSummary("An endpoint carrying metadata");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    string body = await http.GetStringAsync("/tagged");
    await app.StopAsync();

    foreach (string line in body.Split('\n'))
    {
        Console.WriteLine($"   {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   METADATA IS AN UNTYPED BAG OF OBJECTS ATTACHED TO AN ENDPOINT, and");
    Console.WriteLine("   anything downstream can look for what it understands.");
    Console.WriteLine();
    Console.WriteLine("   That is the mechanism behind a surprising amount of the framework:");
    Console.WriteLine();
    Console.WriteLine("     RequireAuthorization()  attaches an authorisation policy, which");
    Console.WriteLine("                             UseAuthorization looks for");
    Console.WriteLine("     WithName(...)           attaches a name, which link generation");
    Console.WriteLine("                             looks for");
    Console.WriteLine("     WithTags(...)           attaches tags, which OpenAPI looks for");
    Console.WriteLine("     [Authorize], [Produces] the attribute equivalents on controllers");
    Console.WriteLine();
    Console.WriteLine("   The pattern is worth recognising because it explains the ordering");
    Console.WriteLine("   rule from the middleware module: AUTHORISATION MUST COME AFTER");
    Console.WriteLine("   ROUTING because routing is what puts the endpoint - and therefore");
    Console.WriteLine("   the policy - on the context. Before routing there is nothing to");
    Console.WriteLine("   read.");
    Console.WriteLine();
    Console.WriteLine("   You can attach your own, and read it in your own middleware:");
    Console.WriteLine();
    Console.WriteLine("     app.MapGet(\"/reports\", Handler).WithMetadata(new AuditRequired());");
    Console.WriteLine();
    Console.WriteLine("     var required = context.GetEndpoint()?.Metadata");
    Console.WriteLine("         .GetMetadata<AuditRequired>();");
    Console.WriteLine();
    Console.WriteLine("   That is a better shape than checking paths in middleware, for the");
    Console.WriteLine("   same reason a group is: the decision lives with the endpoint and");
    Console.WriteLine("   cannot drift away from it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task FilterOrder()
{
    Console.WriteLine("3. Where an endpoint filter runs");
    Console.WriteLine();

    var order = new ConcurrentQueue<string>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.Use(async (context, next) =>
    {
        order.Enqueue("middleware BEFORE routing");
        await next();
        order.Enqueue("middleware BEFORE routing (out)");
    });

    app.UseRouting();

    app.Use(async (context, next) =>
    {
        order.Enqueue($"middleware AFTER routing (endpoint: {context.GetEndpoint() is not null})");
        await next();
    });

    var group = app.MapGroup("/x")
        .AddEndpointFilter(async (context, next) =>
        {
            order.Enqueue("group filter");
            return await next(context);
        });

    group.MapGet("/y", () =>
        {
            order.Enqueue("the endpoint");
            return "ok";
        })
        .AddEndpointFilter(async (context, next) =>
        {
            order.Enqueue("endpoint filter");
            return await next(context);
        });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    await http.GetStringAsync("/x/y");
    await app.StopAsync();

    foreach (string step in order)
    {
        Console.WriteLine($"     {step}");
    }

    Console.WriteLine();
    Console.WriteLine("   FILTERS RUN INSIDE THE ENDPOINT, NOT IN THE PIPELINE. They are the");
    Console.WriteLine("   innermost layer, after every middleware has already run.");
    Console.WriteLine();
    Console.WriteLine("   That is the difference between a filter and a middleware, and it");
    Console.WriteLine("   decides which to reach for:");
    Console.WriteLine();
    Console.WriteLine("     MIDDLEWARE   runs for every request that reaches it, whether or");
    Console.WriteLine("                  not any endpoint matched. It sees the raw request and");
    Console.WriteLine("                  it can short-circuit before routing happens.");
    Console.WriteLine();
    Console.WriteLine("     FILTER       runs only when THIS endpoint was selected. It sees");
    Console.WriteLine("                  the bound arguments, and it can inspect or replace");
    Console.WriteLine("                  the result the handler returned.");
    Console.WriteLine();
    Console.WriteLine("   So validation of a bound parameter, per-endpoint auditing and");
    Console.WriteLine("   result-shaping belong in a filter. Anything that must run for");
    Console.WriteLine("   unmatched requests too - logging, exception handling, forwarded");
    Console.WriteLine("   headers - has to be middleware.");
    Console.WriteLine();
    Console.WriteLine("   Note the order among filters: the GROUP filter ran before the");
    Console.WriteLine("   ENDPOINT filter. They nest the same way middleware does, outermost");
    Console.WriteLine("   first, with the group being outside the endpoint.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Nesting()
{
    Console.WriteLine("4. Nested groups");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    var v1 = app.MapGroup("/v1")
        .AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers["X-Version"] = "1";
            return await next(context);
        });

    var payments = v1.MapGroup("/payments")
        .AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers["X-Area"] = "payments";
            return await next(context);
        });

    payments.MapGet("/{id}", (string id) => $"payment {id}");
    v1.MapGet("/health", () => "healthy");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request                 status   X-Version   X-Area");
    Console.WriteLine("   -------                 ------   ---------   ------");

    foreach (string path in new[] { "/v1/payments/PAY-1", "/v1/health" })
    {
        HttpResponseMessage response = await http.GetAsync(path);
        Console.WriteLine($"   GET {path,-19}{(int)response.StatusCode,6}   " +
            $"{Header(response, "X-Version"),9}   {Header(response, "X-Area")}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   Groups nest, and both the prefix and the filters accumulate. The");
    Console.WriteLine("   payment endpoint is at /v1/payments/{id} and carries both headers;");
    Console.WriteLine("   the health endpoint is inside /v1 only and carries one.");
    Console.WriteLine();
    Console.WriteLine("   This is the shape most API versioning takes, and it is worth");
    Console.WriteLine("   preferring over the alternatives for one reason: THE STRUCTURE IS IN");
    Console.WriteLine("   THE CODE RATHER THAN IN A CONVENTION. A group cannot be");
    Console.WriteLine("   accidentally missed the way a path prefix in a middleware string");
    Console.WriteLine("   comparison can.");
    Console.WriteLine();
    Console.WriteLine("   One caution. Everything applied to a group applies to EVERY endpoint");
    Console.WriteLine("   in it, including ones added later by somebody who did not read the");
    Console.WriteLine("   group declaration. That is the point when the group requires");
    Console.WriteLine("   authorisation, and a hazard when it applies something surprising -");
    Console.WriteLine("   a response cache, a rate limit, a body size limit.");
    Console.WriteLine();
    Console.WriteLine("   Keep what a group applies boring and predictable, and put anything");
    Console.WriteLine("   unusual on the individual endpoint that needs it.");

    static string Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? values.First() : "-";
}
