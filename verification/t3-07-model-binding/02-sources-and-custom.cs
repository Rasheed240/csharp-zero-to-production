// 02-sources-and-custom.cs — Every source a parameter can come from, how to
// override the inference, and the two hooks for binding your own types.
//
// Run:  dotnet run 02-sources-and-custom.cs -c Release
//
// EXACT vs RATIO: every bound value and status code here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddSingleton<IClock, SystemClock>();

var app = builder.Build();

// Every source, named explicitly.
app.MapPost("/explicit/{id}", (
    [FromRoute] string id,
    [FromQuery] int page,
    [FromHeader(Name = "X-Tenant")] string tenant,
    [FromBody] CreatePayment body,
    [FromServices] IClock clock) => Results.Ok(new
    {
        id, page, tenant, amount = body.AmountMinor, clock = clock.Name
    }));

// Arrays and lists come from repeated query values.
app.MapGet("/array", (int[] ids, string[] tags) =>
    Results.Ok(new { ids, tags, idCount = ids.Length }));

// A type with a static TryParse binds from a ROUTE or QUERY value.
app.MapGet("/parsed/{money}", (Money money, Money? fallback) =>
    Results.Ok(new { parsed = money.ToString(), fallback = fallback?.ToString() }));

// A type with a static BindAsync binds from the whole request.
app.MapGet("/bound", (Tenant tenant) => Results.Ok(new { tenant = tenant.Id }));

// [AsParameters] flattens a struct or record of parameters, each bound by its
// own rules.
app.MapGet("/grouped/{id}", ([AsParameters] PaymentQuery query) => Results.Ok(new
{
    query.Id, query.Page, query.Tenant, clock = query.Clock.Name
}));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

await Sources(http);
await Arrays(http);
await CustomTypes(http);
await AsParametersDemo(http);

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Sources(HttpClient http)
{
    Console.WriteLine("1. The five sources, named explicitly");
    Console.WriteLine();

    using var content = new StringContent("""{"amountMinor":123450}""",
        Encoding.UTF8, "application/json");
    using var request = new HttpRequestMessage(HttpMethod.Post, "/explicit/PAY-1?page=3")
    {
        Content = content
    };
    request.Headers.TryAddWithoutValidation("X-Tenant", "acme");

    using HttpResponseMessage response = await http.SendAsync(request);

    Console.WriteLine($"   -> {await response.Content.ReadAsStringAsync()}");
    Console.WriteLine();
    Console.WriteLine("   attribute        reads from                     inferred without it?");
    Console.WriteLine("   ---------        ----------                     --------------------");
    Console.WriteLine("   [FromRoute]      a route parameter of that name yes, if the name matches");
    Console.WriteLine("   [FromQuery]      the query string               yes, for simple types");
    Console.WriteLine("   [FromHeader]     a request header               NO - always needed");
    Console.WriteLine("   [FromBody]       the request body, as JSON      yes, for complex types");
    Console.WriteLine("   [FromServices]   the DI container               yes, if registered");
    Console.WriteLine("   [FromForm]       a form field                   only in a form post");
    Console.WriteLine();
    Console.WriteLine("   FOUR OF THE SIX ARE INFERRED, and the attributes are worth writing");
    Console.WriteLine("   anyway in two cases:");
    Console.WriteLine();
    Console.WriteLine("     - [FromHeader] and [FromForm], which are never inferred.");
    Console.WriteLine();
    Console.WriteLine("     - Anywhere the inference would be WRONG or merely surprising. A");
    Console.WriteLine("       parameter named 'id' that should come from the query, in a route");
    Console.WriteLine("       that also has an {id}, is the classic case: the route wins, and");
    Console.WriteLine("       [FromQuery] is the only way to say otherwise.");
    Console.WriteLine();
    Console.WriteLine("   ONLY ONE PARAMETER MAY COME FROM THE BODY. The body is a stream and");
    Console.WriteLine("   it is read once, so two complex parameters is an error at startup");
    Console.WriteLine("   rather than a puzzle at runtime.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Arrays(HttpClient http)
{
    Console.WriteLine("2. Arrays from the query string");
    Console.WriteLine();

    foreach (string query in new[]
    {
        "?ids=1&ids=2&ids=3&tags=a&tags=b",
        "?ids=1,2,3&tags=a",
        "?tags=a"
    })
    {
        using HttpResponseMessage response = await http.GetAsync($"/array{query}");
        Console.WriteLine($"   {query,-34}  {(int)response.StatusCode}  " +
            $"{await response.Content.ReadAsStringAsync()}");
    }

    Console.WriteLine();
    Console.WriteLine("   REPEATING THE KEY IS THE SYNTAX. ?ids=1&ids=2&ids=3 gives three");
    Console.WriteLine("   values; ?ids=1,2,3 gives ONE value that happens to contain commas,");
    Console.WriteLine("   and for an int[] that is a 400 because '1,2,3' is not an integer.");
    Console.WriteLine();
    Console.WriteLine("   That trips people up because comma-separated lists are common in");
    Console.WriteLine("   other frameworks and in URLs generally. If your clients send them,");
    Console.WriteLine("   you need a custom binder - section 3 - or a string parameter you");
    Console.WriteLine("   split yourself.");
    Console.WriteLine();
    Console.WriteLine("   AN ABSENT ARRAY IS EMPTY, NOT NULL. The third row bound ids to a");
    Console.WriteLine("   zero-length array. That is usually convenient and it removes any");
    Console.WriteLine("   way to distinguish 'sent nothing' from 'sent an empty list' - which");
    Console.WriteLine("   matters if the two mean different things in your API.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task CustomTypes(HttpClient http)
{
    Console.WriteLine("3. Binding a type of your own");
    Console.WriteLine();

    Console.WriteLine("   TryParse - for a value in a route or query segment:");
    Console.WriteLine();

    foreach (string path in new[]
    {
        "/parsed/GBP:123450", "/parsed/GBP:123450?fallback=USD:99", "/parsed/nonsense"
    })
    {
        using HttpResponseMessage response = await http.GetAsync(path);
        Console.WriteLine($"   {path,-38}  {(int)response.StatusCode}  " +
            $"{await response.Content.ReadAsStringAsync()}");
    }

    Console.WriteLine();
    Console.WriteLine("     public static bool TryParse(string? value, IFormatProvider? provider,");
    Console.WriteLine("         out Money result)");
    Console.WriteLine();
    Console.WriteLine("   A static TryParse with that shape is all it takes - no registration,");
    Console.WriteLine("   no attribute. Returning false produces a 400.");
    Console.WriteLine();
    Console.WriteLine("   BindAsync - for a value assembled from the whole request:");
    Console.WriteLine();

    foreach (string header in new[] { "acme", "" })
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/bound");
        if (header.Length > 0)
        {
            request.Headers.TryAddWithoutValidation("X-Tenant", header);
        }

        using HttpResponseMessage response = await http.SendAsync(request);
        string label = header.Length > 0 ? $"X-Tenant: {header}" : "no header";
        Console.WriteLine($"   {label,-38}  {(int)response.StatusCode}  " +
            $"{await response.Content.ReadAsStringAsync()}");
    }

    Console.WriteLine();
    Console.WriteLine("     public static ValueTask<Tenant?> BindAsync(HttpContext context,");
    Console.WriteLine("         ParameterInfo parameter)");
    Console.WriteLine();
    Console.WriteLine("   BindAsync sees the whole HttpContext, so it can read headers, the");
    Console.WriteLine("   user, the connection - anything. It is the hook for a parameter that");
    Console.WriteLine("   is not really a value from the URL at all.");
    Console.WriteLine();
    Console.WriteLine("   WHICH TO USE:");
    Console.WriteLine();
    Console.WriteLine("     TryParse    the type is a value with a string form. Money, a");
    Console.WriteLine("                 strongly-typed id, a date range. Also gives you the");
    Console.WriteLine("                 same parsing everywhere else in your code.");
    Console.WriteLine();
    Console.WriteLine("     BindAsync   the value comes from somewhere other than one string.");
    Console.WriteLine("                 A tenant from a header, a cursor from several query");
    Console.WriteLine("                 parameters, the current user as a domain type.");
    Console.WriteLine();
    Console.WriteLine("   BindAsync WINS IF BOTH EXIST. That is worth knowing before you add a");
    Console.WriteLine("   BindAsync to a type that already had TryParse and wonder why the");
    Console.WriteLine("   route parameter stopped working.");
    Console.WriteLine();
    Console.WriteLine("   AND A CAUTION ABOUT RETURNING null FROM BindAsync. It is treated as");
    Console.WriteLine("   'no value', so a non-nullable parameter becomes a 400 and a nullable");
    Console.WriteLine("   one silently becomes null. If the absence is an error, prefer");
    Console.WriteLine("   throwing BadHttpRequestException with a message over returning null");
    Console.WriteLine("   into a nullable parameter and hoping the handler checks.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task AsParametersDemo(HttpClient http)
{
    Console.WriteLine("4. [AsParameters]: many parameters as one type");
    Console.WriteLine();

    using var request = new HttpRequestMessage(HttpMethod.Get, "/grouped/PAY-1?page=4");
    request.Headers.TryAddWithoutValidation("X-Tenant", "acme");

    using HttpResponseMessage response = await http.SendAsync(request);
    Console.WriteLine($"   GET /grouped/PAY-1?page=4 with X-Tenant: acme");
    Console.WriteLine($"   -> {await response.Content.ReadAsStringAsync()}");
    Console.WriteLine();
    Console.WriteLine("     public readonly record struct PaymentQuery(");
    Console.WriteLine("         string Id,");
    Console.WriteLine("         int Page,");
    Console.WriteLine("         [FromHeader(Name = \"X-Tenant\")] string Tenant,");
    Console.WriteLine("         IClock Clock);");
    Console.WriteLine();
    Console.WriteLine("   EACH MEMBER IS BOUND BY THE ORDINARY RULES, as if it had been a");
    Console.WriteLine("   parameter of the handler. Id from the route, Page from the query,");
    Console.WriteLine("   Tenant from the header because it says so, Clock from services.");
    Console.WriteLine();
    Console.WriteLine("   THIS IS NOT BODY BINDING. That is the mistake to avoid: it looks");
    Console.WriteLine("   like a request object and it is a bundle of separate parameters. A");
    Console.WriteLine("   complex type WITHOUT [AsParameters] comes from the body; the same");
    Console.WriteLine("   type WITH it comes from six places and never the body.");
    Console.WriteLine();
    Console.WriteLine("   What it is for:");
    Console.WriteLine();
    Console.WriteLine("     - A handler with eight parameters becomes a handler with one, and");
    Console.WriteLine("       the eight are named in a type you can reuse across endpoints.");
    Console.WriteLine();
    Console.WriteLine("     - Filters read arguments BY POSITION, so a handler with one");
    Console.WriteLine("       parameter is a handler whose filters cannot be broken by");
    Console.WriteLine("       reordering.");
    Console.WriteLine();
    Console.WriteLine("     - It is testable in the same way an extracted handler is: build");
    Console.WriteLine("       the struct and call the method.");
    Console.WriteLine();
    Console.WriteLine("   The cost is one more indirection between the URL and the value, and");
    Console.WriteLine("   a type whose members are bound from five different places with");
    Console.WriteLine("   nothing in the type saying so unless you write the attributes.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
public sealed class CreatePayment
{
    public long AmountMinor { get; set; }
}

public interface IClock
{
    string Name { get; }
}

public sealed class SystemClock : IClock
{
    public string Name => "SystemClock";
}

// A value type with a string form: TryParse is the hook.
public readonly record struct Money(string Currency, long AmountMinor)
{
    public static bool TryParse(string? value, IFormatProvider? provider, out Money result)
    {
        result = default;

        if (value is null)
        {
            return false;
        }

        int separator = value.IndexOf(':');
        if (separator <= 0 || separator == value.Length - 1)
        {
            return false;
        }

        if (!long.TryParse(value.AsSpan(separator + 1), NumberStyles.Integer,
            CultureInfo.InvariantCulture, out long amount))
        {
            return false;
        }

        result = new Money(value[..separator], amount);
        return true;
    }

    public override string ToString() => $"{Currency}:{AmountMinor}";
}

// A value assembled from the request: BindAsync is the hook.
public sealed record Tenant(string Id)
{
    public static ValueTask<Tenant?> BindAsync(HttpContext context,
        System.Reflection.ParameterInfo parameter)
    {
        string? id = context.Request.Headers["X-Tenant"].FirstOrDefault();

        return ValueTask.FromResult(string.IsNullOrEmpty(id) ? null : new Tenant(id));
    }
}

// Each member bound by the ordinary rules, as if it were a handler parameter.
public readonly record struct PaymentQuery(
    string Id,
    int Page,
    [FromHeader(Name = "X-Tenant")] string Tenant,
    IClock Clock);
