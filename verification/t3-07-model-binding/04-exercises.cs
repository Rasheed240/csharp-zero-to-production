// 04-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 04-exercises.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;

await Exercise1();
await Exercise2();
await Exercise3();
await Exercise4();
await Exercise5();

// ---------------------------------------------------------------------------
// 1. EASY — where does each parameter come from?
// ---------------------------------------------------------------------------
static async Task Exercise1()
{
    Console.WriteLine("Exercise 1: no attributes. Where does each parameter come from?");
    Console.WriteLine();
    Console.WriteLine("     app.MapPost(\"/payments/{id}\", (");
    Console.WriteLine("         string id, int retries, CreatePayment body, IClock clock) => ...);");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton<IClock, SystemClock>();
    var app = builder.Build();

    app.MapPost("/payments/{id}", (string id, int retries, CreatePayment body, IClock clock) =>
        Results.Ok(new { id, retries, amount = body.AmountMinor, clock = clock.Name }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    using var content = new StringContent("""{"amountMinor":123450}""",
        Encoding.UTF8, "application/json");
    HttpResponseMessage response = await http.PostAsync("/payments/PAY-1?retries=2", content);
    Console.WriteLine($"   -> {await response.Content.ReadAsStringAsync()}");
    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   parameter    source     because");
    Console.WriteLine("   ---------    ------     -------");
    Console.WriteLine("   id           route      its name matches a route parameter");
    Console.WriteLine("   retries      query      a simple type with no route match");
    Console.WriteLine("   body         body       a complex type, read as JSON");
    Console.WriteLine("   clock        services   the type is registered in the container");
    Console.WriteLine();
    Console.WriteLine("   Only two sources are never inferred: [FromHeader] and [FromForm].");
    Console.WriteLine("   Everything else follows from the name and the type.");
    Console.WriteLine();
    Console.WriteLine("   Two rules worth carrying:");
    Console.WriteLine();
    Console.WriteLine("     - THE ROUTE WINS over the query for a matching name. A parameter");
    Console.WriteLine("       called id, in a route with {id}, always comes from the route -");
    Console.WriteLine("       [FromQuery] is the only way to say otherwise.");
    Console.WriteLine();
    Console.WriteLine("     - ONLY ONE PARAMETER MAY COME FROM THE BODY, because the body is a");
    Console.WriteLine("       stream read once. Two complex parameters is an error at startup.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. EASY — nullable, defaulted, required.
// ---------------------------------------------------------------------------
static async Task Exercise2()
{
    Console.WriteLine("Exercise 2: three ways of declaring the same query parameter. What");
    Console.WriteLine("            does each do with ?page=abc, and with page absent?");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.MapGet("/required", (int page) => Results.Ok(new { page }));
    app.MapGet("/optional", (int? page) => Results.Ok(new { page }));
    app.MapGet("/defaulted", (int page = 1) => Results.Ok(new { page }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   declaration      ?page=2   ?page=abc   absent    ?page=-5");
    Console.WriteLine("   -----------      -------   ---------   ------    --------");

    foreach ((string label, string path) in new[]
    {
        ("int page", "/required"), ("int? page", "/optional"), ("int page = 1", "/defaulted")
    })
    {
        string a = await DescribeAsync(http, $"{path}?page=2");
        string b = await DescribeAsync(http, $"{path}?page=abc");
        string c = await DescribeAsync(http, path);
        string d = await DescribeAsync(http, $"{path}?page=-5");
        Console.WriteLine($"   {label,-15}  {a,-9} {b,-11} {c,-9} {d}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   BINDING DISTINGUISHES ABSENT FROM UNPARSEABLE. That is the answer,");
    Console.WriteLine("   and it is the opposite of what is usually assumed:");
    Console.WriteLine();
    Console.WriteLine("     absent                  null, the default, or a 400 - your choice");
    Console.WriteLine("     present, unparseable    a 400 in ALL THREE");
    Console.WriteLine();
    Console.WriteLine("   Making a parameter nullable or giving it a default handles ABSENCE");
    Console.WriteLine("   only. It does not swallow malformed input.");
    Console.WriteLine();
    Console.WriteLine("   READ THE LAST COLUMN THOUGH. ?page=-5 binds cleanly to -5 in every");
    Console.WriteLine("   version, because -5 IS an int. Binding asks whether a value of the");
    Console.WriteLine("   type can be produced, never whether the value makes sense.");
    Console.WriteLine();
    Console.WriteLine("   BINDING IS NOT VALIDATION. A page number of -5, an amount of 0, a");
    Console.WriteLine("   date in 1900 - all bind perfectly and all need a separate check.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — the misspelled property.
// ---------------------------------------------------------------------------
static async Task Exercise3()
{
    Console.WriteLine("Exercise 3: a client renames one JSON field. What happens, and what");
    Console.WriteLine("            are the four defences?");
    Console.WriteLine();

    Console.WriteLine("   request type                     201   400   zero rows");
    Console.WriteLine("   ------------                     ---   ---   ---------");
    Console.WriteLine($"   plain settable class            {await CountAsync(Kind.Loose)}");
    Console.WriteLine($"   plus [Range(1, ...)]            {await CountAsync(Kind.Validated)}");
    Console.WriteLine($"   required members                {await CountAsync(Kind.Required)}");
    Console.WriteLine($"   unknown members disallowed      {await CountAsync(Kind.Strict)}");
    Console.WriteLine();
    Console.WriteLine("   THE FIRST ROW IS THE INCIDENT: three 201s carrying zero. The renamed");
    Console.WriteLine("   property matched nothing on the type, so it was IGNORED and the");
    Console.WriteLine("   property kept its default.");
    Console.WriteLine();
    Console.WriteLine("   Nothing records that a property was skipped. The JSON was valid, the");
    Console.WriteLine("   body deserialised, the handler ran normally.");
    Console.WriteLine();
    Console.WriteLine("   THE FOUR DEFENCES, and what each actually buys:");
    Console.WriteLine();
    Console.WriteLine("   1. VALIDATION. Cheapest, and it catches this whenever the default is");
    Console.WriteLine("      INVALID - which is most of the time. An amount of 0, a name of");
    Console.WriteLine("      null, a date of 0001-01-01. Requiring the value to be sensible");
    Console.WriteLine("      incidentally catches it never having arrived.");
    Console.WriteLine();
    Console.WriteLine("   2. REQUIRED MEMBERS. Catches a missing field even when its default");
    Console.WriteLine("      WOULD have been valid - a bool that should be true, a count where");
    Console.WriteLine("      0 is legitimate. Costs nothing at runtime.");
    Console.WriteLine();
    Console.WriteLine("   3. REJECTING UNKNOWN PROPERTIES. Stops the wrong data existing at");
    Console.WriteLine("      all. Two costs: it breaks any client that sends an extra field,");
    Console.WriteLine("      and it returns a BARE 400 WITH NO BODY - the server knows which");
    Console.WriteLine("      property it could not map and does not say. Pair it with an");
    Console.WriteLine("      exception handler or you have traded a silent wrong answer for an");
    Console.WriteLine("      unexplained rejection.");
    Console.WriteLine();
    Console.WriteLine("   4. A CONTRACT TEST, or one generated OpenAPI document. The only");
    Console.WriteLine("      defence that catches the change BEFORE it ships - and the only one");
    Console.WriteLine("      needing agreement from another team.");
    Console.WriteLine();
    Console.WriteLine("   Ignoring unknown members is deliberate in JSON: it is what lets a");
    Console.WriteLine("   client add a field without breaking an older server. Turning it off");
    Console.WriteLine("   buys strictness and gives up forward compatibility, which suits an");
    Console.WriteLine("   internal API and suits a public one much less.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — binding a domain type.
// ---------------------------------------------------------------------------
static async Task Exercise4()
{
    Console.WriteLine("Exercise 4: you want Money and Tenant as handler parameters instead of");
    Console.WriteLine("            strings. Which hook for each, and why?");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.MapGet("/money/{amount}", (Money amount) => Results.Ok(new { parsed = amount.ToString() }));
    app.MapGet("/tenant", (Tenant tenant) => Results.Ok(new { tenant = tenant.Id }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request                        status   result");
    Console.WriteLine("   -------                        ------   ------");

    foreach (string path in new[] { "/money/GBP:1234", "/money/nonsense" })
    {
        using HttpResponseMessage r = await http.GetAsync(path);
        Console.WriteLine($"   GET {path,-26}{(int)r.StatusCode,6}   " +
            $"{await r.Content.ReadAsStringAsync()}");
    }

    foreach (string? header in new[] { "acme", null })
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/tenant");
        if (header is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Tenant", header);
        }

        using HttpResponseMessage r = await http.SendAsync(request);
        string label = header is null ? "GET /tenant (no header)" : "GET /tenant (X-Tenant: acme)";
        Console.WriteLine($"   {label,-30}{(int)r.StatusCode,6}   " +
            $"{await r.Content.ReadAsStringAsync()}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   MONEY -> TryParse. It is a value with a string form, so it belongs");
    Console.WriteLine("   in one route or query segment:");
    Console.WriteLine();
    Console.WriteLine("     public static bool TryParse(string? value,");
    Console.WriteLine("         IFormatProvider? provider, out Money result)");
    Console.WriteLine();
    Console.WriteLine("   Returning false produces a 400. No registration, no attribute - and");
    Console.WriteLine("   the same method parses the value everywhere else in your code.");
    Console.WriteLine();
    Console.WriteLine("   TENANT -> BindAsync. It comes from a header, not from a URL segment,");
    Console.WriteLine("   so it needs the whole request:");
    Console.WriteLine();
    Console.WriteLine("     public static ValueTask<Tenant?> BindAsync(HttpContext context,");
    Console.WriteLine("         ParameterInfo parameter)");
    Console.WriteLine();
    Console.WriteLine("   Two things to know:");
    Console.WriteLine();
    Console.WriteLine("     - BindAsync WINS IF BOTH EXIST. Adding one to a type that already");
    Console.WriteLine("       had TryParse silently changes how route parameters of that type");
    Console.WriteLine("       are bound.");
    Console.WriteLine();
    Console.WriteLine("     - RETURNING null MEANS 'no value'. A non-nullable parameter becomes");
    Console.WriteLine("       a 400; a nullable one silently becomes null. If absence is an");
    Console.WriteLine("       error, throw BadHttpRequestException with a message rather than");
    Console.WriteLine("       returning null into a nullable parameter and hoping the handler");
    Console.WriteLine("       checks.");
    Console.WriteLine();
    Console.WriteLine("   The wider point: BOTH HOOKS MOVE PARSING OUT OF THE HANDLER. A");
    Console.WriteLine("   handler taking Money cannot be handed an unparseable string, so the");
    Console.WriteLine("   check exists once instead of at the top of every method.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 5. HARD — design the request contract.
// ---------------------------------------------------------------------------
static async Task Exercise5()
{
    Console.WriteLine("Exercise 5: design the binding for POST /v1/payments so that no");
    Console.WriteLine("            malformed or partial request can reach the handler, and a");
    Console.WriteLine("            caller who gets it wrong is told what was wrong.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();
    var app = builder.Build();
    app.UseStatusCodePages();

    var payments = app.MapGroup("/v1/payments").AddEndpointFilter(async (context, next) =>
    {
        foreach (object? argument in context.Arguments)
        {
            if (argument is null)
            {
                continue;
            }

            var validationContext = new ValidationContext(argument);
            var errors = new List<ValidationResult>();

            if (!Validator.TryValidateObject(argument, validationContext, errors, true))
            {
                return Results.ValidationProblem(errors.ToDictionary(
                    e => e.MemberNames.FirstOrDefault() ?? "request",
                    e => new[] { e.ErrorMessage ?? "invalid" }));
            }
        }

        return await next(context);
    });

    payments.MapPost("/", (CreatePaymentRequest body) =>
        Results.Created("/v1/payments/PAY-1", new { amount = body.AmountMinor }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    (string Label, string Json)[] bodies =
    [
        ("everything correct", """{"amountMinor":123450,"currency":"GBP"}"""),
        ("field renamed", """{"amount_minor":123450,"currency":"GBP"}"""),
        ("amount of zero", """{"amountMinor":0,"currency":"GBP"}"""),
        ("currency missing", """{"amountMinor":123450}"""),
        ("empty object", """{}""")
    ];

    Console.WriteLine("   body                  status   response");
    Console.WriteLine("   ----                  ------   --------");

    foreach ((string label, string json) in bodies)
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage r = await http.PostAsync("/v1/payments", content);
        string body = await r.Content.ReadAsStringAsync();
        Console.WriteLine($"   {label,-20}  {(int)r.StatusCode,6}   " +
            $"{(body.Length > 78 ? body[..78] + "..." : body)}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   THE DESIGN, and why each part:");
    Console.WriteLine();
    Console.WriteLine("   1. required MEMBERS ON THE REQUEST TYPE. The deserialiser refuses a");
    Console.WriteLine("      body that omits them, so a partial request never becomes an");
    Console.WriteLine("      object with defaults.");
    Console.WriteLine();
    Console.WriteLine("   2. VALIDATION ATTRIBUTES for the values. required says it arrived;");
    Console.WriteLine("      [Range] says it makes sense. Both are needed - a required amount");
    Console.WriteLine("      of -5 arrives perfectly well.");
    Console.WriteLine();
    Console.WriteLine("   3. THE VALIDATION FILTER ON THE GROUP, not the endpoint, so an");
    Console.WriteLine("      endpoint added next month inherits it.");
    Console.WriteLine();
    Console.WriteLine("   4. AddProblemDetails PLUS UseStatusCodePages, so a rejection is a");
    Console.WriteLine("      document naming the field rather than a bare status code.");
    Console.WriteLine();
    Console.WriteLine("   WHAT IS DELIBERATELY NOT HERE: UnmappedMemberHandling.Disallow.");
    Console.WriteLine();
    Console.WriteLine("   Look at the 'field renamed' row - it is a 400, without it. required");
    Console.WriteLine("   members already catch the rename, because the correctly-named");
    Console.WriteLine("   property is then missing. Disallowing unknown members would add only");
    Console.WriteLine("   the ability to name amount_minor as the offender, and would cost");
    Console.WriteLine("   forward compatibility for every client that ever sends an extra");
    Console.WriteLine("   field.");
    Console.WriteLine();
    Console.WriteLine("   That is the trade to be deliberate about. Turn it on for an internal");
    Console.WriteLine("   API with known clients and a strong preference for strictness; leave");
    Console.WriteLine("   it off for a public one, where a client adding a field should not be");
    Console.WriteLine("   a breaking change.");
    Console.WriteLine();
    Console.WriteLine("   AND THE MONITORING THAT WOULD HAVE CAUGHT THE INCIDENT: an alert on");
    Console.WriteLine("   average payment amount, not on error rate. A binding failure produces");
    Console.WriteLine("   VALID requests carrying WRONG data, so it is invisible to every");
    Console.WriteLine("   signal that measures whether requests succeeded.");
}

// ---------------------------------------------------------------------------
static async Task<string> DescribeAsync(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.GetAsync(path);

    if (!response.IsSuccessStatusCode)
    {
        return $"{(int)response.StatusCode}";
    }

    using JsonDocument document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    JsonElement page = document.RootElement.GetProperty("page");
    return page.ValueKind == JsonValueKind.Null ? "null" : page.ToString();
}

static async Task<string> CountAsync(Kind kind)
{
    var ledger = new List<long>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton(ledger);

    if (kind == Kind.Strict)
    {
        builder.Services.ConfigureHttpJsonOptions(o =>
            o.SerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow);
    }

    var app = builder.Build();

    var group = app.MapGroup("/").AddEndpointFilter(async (context, next) =>
    {
        if (kind == Kind.Loose)
        {
            return await next(context);
        }

        foreach (object? argument in context.Arguments)
        {
            if (argument is null)
            {
                continue;
            }

            var validationContext = new ValidationContext(argument);
            var errors = new List<ValidationResult>();

            if (!Validator.TryValidateObject(argument, validationContext, errors, true))
            {
                return Results.ValidationProblem(errors.ToDictionary(
                    e => e.MemberNames.FirstOrDefault() ?? "request",
                    e => new[] { e.ErrorMessage ?? "invalid" }));
            }
        }

        return await next(context);
    });

    if (kind == Kind.Loose)
    {
        group.MapPost("/p", (LooseRequest b, List<long> s) =>
        {
            s.Add(b.AmountMinor);
            return Results.Created("/p/1", new { b.AmountMinor });
        });
    }
    else if (kind == Kind.Validated)
    {
        group.MapPost("/p", (ValidatedRequest b, List<long> s) =>
        {
            s.Add(b.AmountMinor);
            return Results.Created("/p/1", new { b.AmountMinor });
        });
    }
    else
    {
        group.MapPost("/p", (CreatePaymentRequest b, List<long> s) =>
        {
            s.Add(b.AmountMinor);
            return Results.Created("/p/1", new { b.AmountMinor });
        });
    }

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    int created = 0;
    int rejected = 0;

    foreach (string json in new[]
    {
        """{"amountMinor":123450,"currency":"GBP"}""",
        """{"amount_minor":123450,"currency":"GBP"}""",
        """{"amount_minor":99900,"currency":"GBP"}""",
        """{"amount_minor":250000,"currency":"GBP"}"""
    })
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage r = await http.PostAsync("/p", content);

        if (r.IsSuccessStatusCode)
        {
            created++;
        }
        else
        {
            rejected++;
        }
    }

    await app.StopAsync();
    return $"{created,3}   {rejected,3}   {ledger.Count(a => a == 0),9}";
}

// ---------------------------------------------------------------------------
enum Kind { Loose, Validated, Required, Strict }

public sealed class CreatePayment
{
    public long AmountMinor { get; set; }
}

public sealed class LooseRequest
{
    public long AmountMinor { get; set; }

    public string? Currency { get; set; }
}

public sealed class ValidatedRequest
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public string Currency { get; set; } = "";
}

// required says it arrived; the attributes say it makes sense. Both are needed.
public sealed class CreatePaymentRequest
{
    [Range(1, 1_000_000)]
    public required long AmountMinor { get; set; }

    [StringLength(3, MinimumLength = 3)]
    public required string Currency { get; set; }
}

public interface IClock
{
    string Name { get; }
}

public sealed class SystemClock : IClock
{
    public string Name => "SystemClock";
}

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

public sealed record Tenant(string Id)
{
    public static ValueTask<Tenant?> BindAsync(HttpContext context,
        System.Reflection.ParameterInfo parameter)
    {
        string? id = context.Request.Headers["X-Tenant"].FirstOrDefault();
        return ValueTask.FromResult(string.IsNullOrEmpty(id) ? null : new Tenant(id));
    }
}
