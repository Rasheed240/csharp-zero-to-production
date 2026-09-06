// 02-constraints.cs — What a constraint is for, what it is not for, and why the
// difference shows up as 404 instead of 400.
//
// Run:  dotnet run 02-constraints.cs -c Release
//
// EXACT vs RATIO: every status code and match here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Routing;

await TheBuiltIns();
await NotValidation();
await Disambiguation();
await CustomConstraint();

// ---------------------------------------------------------------------------
static async Task TheBuiltIns()
{
    Console.WriteLine("1. The constraints worth knowing");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.MapGet("/int/{v:int}", (int v) => $"int {v}");
    app.MapGet("/guid/{v:guid}", (Guid v) => $"guid {v}");
    app.MapGet("/bool/{v:bool}", (bool v) => $"bool {v}");
    app.MapGet("/alpha/{v:alpha}", (string v) => $"alpha {v}");
    app.MapGet("/minlen/{v:minlength(3)}", (string v) => $"minlength {v}");
    app.MapGet("/range/{v:int:range(1,100)}", (int v) => $"range {v}");
    app.MapGet("/regex/{v:regex(^PAY-\\d{{4}}$)}", (string v) => $"regex {v}");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   constraint              request                matches?");
    Console.WriteLine("   ----------              -------                --------");

    await Show(http, "{v:int}", "/int/42");
    await Show(http, "{v:int}", "/int/4.2");
    await Show(http, "{v:guid}", "/guid/8a1f0c2e-9d3b-4f77-b0a1-5e6c7d8e9f01");
    await Show(http, "{v:bool}", "/bool/true");
    await Show(http, "{v:alpha}", "/alpha/widgets");
    await Show(http, "{v:alpha}", "/alpha/widget9");
    await Show(http, "{v:minlength(3)}", "/minlen/ab");
    await Show(http, "{v:minlength(3)}", "/minlen/abc");
    await Show(http, "{v:int:range(1,100)}", "/range/50");
    await Show(http, "{v:int:range(1,100)}", "/range/500");
    await Show(http, "{v:regex(...)}", "/regex/PAY-0001");
    await Show(http, "{v:regex(...)}", "/regex/PAY-1");

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   Constraints CHAIN with colons, and all of them must pass:");
    Console.WriteLine();
    Console.WriteLine("     {v:int:range(1,100)}   an integer, AND between 1 and 100");
    Console.WriteLine();
    Console.WriteLine("   The full set is larger than this - datetime, decimal, long, double,");
    Console.WriteLine("   maxlength, length, min, max, required - and they all behave the same");
    Console.WriteLine("   way, which is the subject of section 2.");
    Console.WriteLine();

    static async Task Show(HttpClient http, string constraint, string path)
    {
        HttpResponseMessage response = await http.GetAsync(path);
        string result = (int)response.StatusCode == 200
            ? $"yes  ({await response.Content.ReadAsStringAsync()})"
            : $"NO   ({(int)response.StatusCode})";

        Console.WriteLine($"   {constraint,-22}  {path,-21}  {result}");
    }
}

// ---------------------------------------------------------------------------
static async Task NotValidation()
{
    Console.WriteLine("2. A constraint is not validation");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    // Constrained: a non-integer does not match, so nothing handles it.
    app.MapGet("/constrained/{id:int:range(1,100)}", (int id) => $"page {id}");

    // Unconstrained, validating in the handler.
    app.MapGet("/validated/{id}", (string id) =>
    {
        if (!int.TryParse(id, out int number))
        {
            return Results.BadRequest(new { error = "id must be a whole number", got = id });
        }

        if (number is < 1 or > 100)
        {
            return Results.UnprocessableEntity(new
            {
                error = "id must be between 1 and 100",
                got = number
            });
        }

        return Results.Ok(new { page = number });
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
    Console.WriteLine("   THE CONSTRAINED ROUTE RETURNS 404 FOR BOTH BAD INPUTS. Not 400, not");
    Console.WriteLine("   422, and with no body explaining anything.");
    Console.WriteLine();
    Console.WriteLine("   That is correct behaviour, and it follows from what a constraint");
    Console.WriteLine("   IS. Constraints run during route MATCHING, before any handler is");
    Console.WriteLine("   chosen. A value that fails one means this route does not match, and");
    Console.WriteLine("   if nothing else matches either the answer is 'no such resource'.");
    Console.WriteLine();
    Console.WriteLine("   The caller is told nothing about why. From outside, /constrained/abc");
    Console.WriteLine("   and /a-path-that-was-never-registered are indistinguishable.");
    Console.WriteLine();
    Console.WriteLine("   SO THE RULE IS:");
    Console.WriteLine();
    Console.WriteLine("     USE A CONSTRAINT to disambiguate routes, or to keep clearly");
    Console.WriteLine("     malformed requests away from your handler cheaply. The caller gets");
    Console.WriteLine("     a 404 and that is an acceptable answer.");
    Console.WriteLine();
    Console.WriteLine("     VALIDATE IN THE HANDLER when the caller deserves to know what was");
    Console.WriteLine("     wrong. That is where you can return 400 for malformed and 422 for");
    Console.WriteLine("     unacceptable, with a body naming the field.");
    Console.WriteLine();
    Console.WriteLine("   The two are not alternatives. A range constraint is a reasonable");
    Console.WriteLine("   guard AND a bad error message, so a public API usually wants the");
    Console.WriteLine("   type constraint for matching and the range check in the handler for");
    Console.WriteLine("   the message.");
    Console.WriteLine();
    Console.WriteLine("   The failure mode to recognise: A CLIENT REPORTS 404 FOR A RESOURCE");
    Console.WriteLine("   THAT EXISTS. The usual cause is a constraint rejecting the value -");
    Console.WriteLine("   an id that is a GUID where the route says :int, an id long enough to");
    Console.WriteLine("   overflow :int, a date in the wrong format.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Disambiguation()
{
    Console.WriteLine("3. What constraints are genuinely good at");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    // Two routes that would be ambiguous without the constraints. With them,
    // they are different shapes and both can coexist.
    app.MapGet("/orders/{id:int}", (int id) => $"by numeric id {id}");
    app.MapGet("/orders/{reference:regex(^ORD-\\d{{4}}$)}", (string reference) =>
        $"by reference {reference}");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request              matched");
    Console.WriteLine("   -------              -------");

    foreach (string path in new[] { "/orders/42", "/orders/ORD-0007", "/orders/nonsense" })
    {
        HttpResponseMessage response = await http.GetAsync(path);
        string body = await response.Content.ReadAsStringAsync();
        Console.WriteLine($"   {path,-18}   " +
            $"{((int)response.StatusCode == 200 ? body : $"{(int)response.StatusCode}")}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   Without the constraints these two templates have identical shape -");
    Console.WriteLine("   literal, parameter - and every request to /orders/anything would");
    Console.WriteLine("   throw AmbiguousMatchException. The constraints make them different");
    Console.WriteLine("   routes, and the third request matches neither.");
    Console.WriteLine();
    Console.WriteLine("   THIS IS THE CASE CONSTRAINTS EXIST FOR. Two ways of addressing the");
    Console.WriteLine("   same kind of resource, told apart by the shape of the identifier.");
    Console.WriteLine();
    Console.WriteLine("   Two cautions about regex constraints specifically:");
    Console.WriteLine();
    Console.WriteLine("     - THEY RUN ON EVERY REQUEST that reaches this segment, including");
    Console.WriteLine("       requests that will not match. A pathological pattern is a");
    Console.WriteLine("       denial-of-service vector against your own router.");
    Console.WriteLine();
    Console.WriteLine("     - THEY ARE HARD TO READ IN A TEMPLATE, and the escaping is");
    Console.WriteLine("       awkward - braces must be doubled, because braces already mean");
    Console.WriteLine("       something to the route parser. A named custom constraint is");
    Console.WriteLine("       usually clearer, which is section 4.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task CustomConstraint()
{
    Console.WriteLine("4. A constraint of your own");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // Registering it gives it a NAME usable in any template.
    builder.Services.Configure<RouteOptions>(options =>
        options.ConstraintMap["paymentid"] = typeof(PaymentIdConstraint));

    var app = builder.Build();
    app.MapGet("/payments/{id:paymentid}", (string id) => $"payment {id}");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request                    status   checks run so far");
    Console.WriteLine("   -------                    ------   -----------------");

    foreach (string path in new[]
    {
        "/payments/PAY-0001", "/payments/PAY-1", "/payments/INV-0001"
    })
    {
        HttpResponseMessage response = await http.GetAsync(path);
        Console.WriteLine($"   {path,-24}   {(int)response.StatusCode,6}   {PaymentIdConstraint.Checks}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   The whole interface is one method:");
    Console.WriteLine();
    Console.WriteLine("     public sealed class PaymentIdConstraint : IRouteConstraint");
    Console.WriteLine("     {");
    Console.WriteLine("         public bool Match(HttpContext? httpContext, IRouter? route,");
    Console.WriteLine("             string routeKey, RouteValueDictionary values,");
    Console.WriteLine("             RouteDirection routeDirection)");
    Console.WriteLine("         {");
    Console.WriteLine("             // return true to match, false to not match");
    Console.WriteLine("         }");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   Three rules for anything you write here, and the first is the one");
    Console.WriteLine("   that gets broken:");
    Console.WriteLine();
    Console.WriteLine("   1. IT MUST BE CHEAP AND PURE. It runs on every candidate request,");
    Console.WriteLine("      before authentication, before anything. NEVER touch a database or");
    Console.WriteLine("      call a service from a constraint - 'does this order exist?' is a");
    Console.WriteLine("      handler's question, not a router's, and putting it here means an");
    Console.WriteLine("      unauthenticated stranger can make you query.");
    Console.WriteLine();
    Console.WriteLine("   2. IT MUST NOT THROW. A constraint that throws turns every request");
    Console.WriteLine("      to that shape into a 500, including ones that were never going to");
    Console.WriteLine("      match.");
    Console.WriteLine();
    Console.WriteLine("   3. IT RUNS FOR GENERATION TOO. routeDirection tells you which; a");
    Console.WriteLine("      constraint that is asymmetric will silently break link generation");
    Console.WriteLine("      while matching perfectly.");
    Console.WriteLine();
    Console.WriteLine("   The reason to prefer this over a regex in the template is that it");
    Console.WriteLine("   has a NAME. '{id:paymentid}' says what is meant; a regex says how it");
    Console.WriteLine("   is spelled, in a place where nobody can test it.");
}

// ---------------------------------------------------------------------------
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

        // PAY- followed by exactly four digits. Cheap, allocation-free, and it
        // cannot throw.
        return value.Length == 8
            && value.StartsWith("PAY-", StringComparison.Ordinal)
            && char.IsAsciiDigit(value[4])
            && char.IsAsciiDigit(value[5])
            && char.IsAsciiDigit(value[6])
            && char.IsAsciiDigit(value[7]);
    }
}
