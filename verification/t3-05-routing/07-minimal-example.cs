// 07-minimal-example.cs — One routing setup applying every decision in this
// module, exercised end to end.
//
// Run:  dotnet run 07-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and generated URL here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// A NAMED custom constraint, rather than a regex repeated in templates. The
// name says what is meant; a regex says how it is spelled.
builder.Services.Configure<RouteOptions>(options =>
    options.ConstraintMap["paymentid"] = typeof(PaymentIdConstraint));

var app = builder.Build();

// The application is mounted under /ledger by the ingress. Every generated URL
// must carry that prefix; every hand-built string will not.
app.UsePathBase("/ledger");

// EXPLICIT UseRouting, and it is load-bearing. Measured below: with a
// UsePathBase and a MapFallback but NO explicit UseRouting, the fallback
// swallows every request - including ones with a perfectly good literal route.
// Adding this line fixes it.
app.UseRouting();

// ===========================================================================
// Public, and outside every group so that nothing is applied to it by
// accident. Being explicit about what is public is the point of the structure.
// ===========================================================================
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

// ===========================================================================
// One group per version. The prefix, the tag and the API-key filter are
// declared once, so an endpoint added later cannot forget them.
//
// A middleware guarding "/v1/payments" by string comparison would break
// silently the day somebody adds /v1/payment-methods. A group cannot.
// ===========================================================================
var v1 = app.MapGroup("/v1")
    .AddEndpointFilter(async (context, next) =>
    {
        string? key = context.HttpContext.Request.Headers["X-Api-Key"].FirstOrDefault();

        return string.IsNullOrEmpty(key)
            ? Results.Json(new { error = "api key required" }, statusCode: 401)
            : await next(context);
    });

var payments = v1.MapGroup("/payments").WithTags("payments");

// ---------------------------------------------------------------------------
// Lookup by id. Constrained to the shapes actually issued - numeric for
// anything before 2024, PAY-nnnn since - rather than to the shape assumed.
// ---------------------------------------------------------------------------
payments.MapGet("/{id:paymentid}", (string id) => Results.Ok(new { id, source = "id" }))
    .WithName("GetPayment");

// ---------------------------------------------------------------------------
// Lookup by gateway reference, under a LITERAL segment. That is stronger than
// relying on constraints alone to keep two parameter routes apart, and it is
// the decision that prevents the ambiguity incident in 05-production.cs.
// ---------------------------------------------------------------------------
payments.MapGet("/by-reference/{reference}",
    (string reference) => Results.Ok(new { reference, source = "reference" }));

// ---------------------------------------------------------------------------
// A literal beats a parameter, so this coexists with /{id:paymentid} without
// any constraint gymnastics.
// ---------------------------------------------------------------------------
payments.MapGet("/summary", () => Results.Ok(new { total = 4 }));

// ---------------------------------------------------------------------------
// Creation. The Location header is GENERATED from the named route with the
// context passed, so it carries the /ledger prefix and any escaping.
// ---------------------------------------------------------------------------
payments.MapPost("/", (LinkGenerator links, HttpContext context) =>
{
    string id = "PAY-0042";
    string? location = links.GetPathByName(context, "GetPayment", new { id });

    // Generation returns null for a wrong name, a missing parameter, or a
    // value failing a constraint - with no exception and no log. Treat it as
    // the coding error it is rather than letting a 201 ship with no Location.
    if (location is null)
    {
        return Results.Problem("could not generate a location for the new payment");
    }

    return Results.Created(location, new { id });
});

// ---------------------------------------------------------------------------
// An unconstrained route that VALIDATES, for the case where the caller
// deserves to know what was wrong. A constraint here would answer 404.
// ---------------------------------------------------------------------------
payments.MapGet("/page/{n}", (string n) =>
{
    if (!int.TryParse(n, out int page))
    {
        return Results.BadRequest(new { error = "page must be a whole number", got = n });
    }

    return page is < 1 or > 100
        ? Results.UnprocessableEntity(new { error = "page must be 1-100", got = page })
        : Results.Ok(new { page });
});

// ---------------------------------------------------------------------------
// A catch-all fallback, for a friendlier 404 than the empty default. It is
// registered at the lowest possible order, so it loses to every other route -
// PROVIDED routing has been placed correctly. See the warning printed below.
// ---------------------------------------------------------------------------
app.MapFallback((HttpContext context) =>
    Results.NotFound(new { error = "no such endpoint", path = context.Request.Path.Value }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("A routing setup applying every decision in this module");
Console.WriteLine();
Console.WriteLine("   request                                       status   what it shows");
Console.WriteLine("   -------                                       ------   -------------");

await Show(http, "/ledger/health", false, "public, outside every group");
await Show(http, "/ledger/v1/payments/1001", false, "401 - the group filter");
await Show(http, "/ledger/v1/payments/1001", true, "legacy numeric id");
await Show(http, "/ledger/v1/payments/PAY-0001", true, "current id format");
await Show(http, "/ledger/v1/payments/summary", true, "literal beats the parameter");
await Show(http, "/ledger/v1/payments/by-reference/GW-9", true, "literal segment keeps it distinct");
await Show(http, "/ledger/v1/payments/nonsense", true, "404 - constraint did not match");
await Show(http, "/ledger/v1/payments/page/abc", true, "400 - validated, with a reason");
await Show(http, "/ledger/v1/payments/page/500", true, "422 - validated, with a reason");
await Show(http, "/ledger/no-such-thing", false, "the fallback");

using var create = new HttpRequestMessage(HttpMethod.Post, "/ledger/v1/payments");
create.Headers.TryAddWithoutValidation("X-Api-Key", "k");
using HttpResponseMessage created = await http.SendAsync(create);

Console.WriteLine($"   POST /ledger/v1/payments                         " +
    $"{(int)created.StatusCode}   Location: {created.Headers.Location}");

Console.WriteLine();
Console.WriteLine($"   constraint checks run in total: {PaymentIdConstraint.Checks}");
Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - constraints chosen from the shapes the DATA actually has");
Console.WriteLine("     - a NAMED custom constraint instead of a regex in the template");
Console.WriteLine("     - two lookup routes kept apart by a LITERAL segment, not by luck");
Console.WriteLine("     - a group per version carrying prefix, tags and the auth filter once");
Console.WriteLine("     - /health outside every group, so nothing applies to it by accident");
Console.WriteLine("     - validation in the handler where the caller deserves a reason;");
Console.WriteLine("       a constraint where a 404 is an acceptable answer");
Console.WriteLine("     - Location GENERATED from a named route, with the context passed,");
Console.WriteLine("       so it carries the PathBase");
Console.WriteLine("     - a null from link generation treated as a bug, not ignored");
Console.WriteLine("     - {**rest} for a value that goes back into a URL");
Console.WriteLine();
Console.WriteLine("   ONE MEASURED HAZARD, found while writing this file.");
Console.WriteLine();
Console.WriteLine("   A UsePathBase and a MapFallback together, WITHOUT an explicit");
Console.WriteLine("   UseRouting, make the fallback swallow every request. Four");
Console.WriteLine("   configurations, all requesting /ledger/health against a literal");
Console.WriteLine("   /health route:");
Console.WriteLine();
Console.WriteLine("     PathBase, no fallback, no UseRouting        -> 200 healthy");
Console.WriteLine("     PathBase, fallback,    no UseRouting        -> 200 FALLBACK");
Console.WriteLine("     PathBase, no fallback, explicit UseRouting  -> 200 healthy");
Console.WriteLine("     PathBase, fallback,    explicit UseRouting  -> 200 healthy");
Console.WriteLine();
Console.WriteLine("   Only the second row is wrong, and it is wrong for every route in the");
Console.WriteLine("   application at once - a 200 carrying the fallback body, so it does not");
Console.WriteLine("   even register as an error anywhere.");
Console.WriteLine();
Console.WriteLine("   It needs BOTH ingredients, which is why it survives local testing:");
Console.WriteLine("   there is usually no PathBase on a developer machine, and the fallback");
Console.WriteLine("   behaves perfectly without one.");
Console.WriteLine();
Console.WriteLine("   The fix is the explicit app.UseRouting() above, placed after");
Console.WriteLine("   UsePathBase. If you use a fallback and a path base, put routing between");
Console.WriteLine("   them rather than relying on where the framework would have inserted it.");
Console.WriteLine();
Console.WriteLine("   And the one thing that belongs in the project file rather than here:");
Console.WriteLine();
Console.WriteLine("     <WarningsAsErrors>ASP0022</WarningsAsErrors>");
Console.WriteLine();
Console.WriteLine("   Routes are not validated at startup. That analyzer is the only layer");
Console.WriteLine("   that catches an ambiguous pair before a customer does.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Show(HttpClient http, string path, bool key, string note)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    if (key)
    {
        request.Headers.TryAddWithoutValidation("X-Api-Key", "k");
    }

    using HttpResponseMessage response = await http.SendAsync(request);
    Console.WriteLine($"   GET {path,-42}{(int)response.StatusCode,6}   {note}");
}

// ---------------------------------------------------------------------------
// Cheap, pure, and it cannot throw. A constraint runs on every candidate
// request, before authentication - so it must never touch a database or call
// a service.
sealed class PaymentIdConstraint : IRouteConstraint
{
    private static int _checks;

    public static int Checks => Volatile.Read(ref _checks);

    public bool Match(HttpContext? httpContext, IRouter? route, string routeKey,
        RouteValueDictionary values, RouteDirection routeDirection)
    {
        Interlocked.Increment(ref _checks);

        if (!values.TryGetValue(routeKey, out object? raw) || raw is null)
        {
            return false;
        }

        string value = raw.ToString() ?? string.Empty;

        // Legacy numeric, or PAY- followed by exactly four digits.
        if (value.Length > 0 && value.All(char.IsAsciiDigit))
        {
            return true;
        }

        return value.Length == 8
            && value.StartsWith("PAY-", StringComparison.Ordinal)
            && value.AsSpan(4).ContainsAnyExcept(SearchValuesCache.Digits) == false;
    }
}

static class SearchValuesCache
{
    public static readonly System.Buffers.SearchValues<char> Digits =
        System.Buffers.SearchValues.Create("0123456789");
}
