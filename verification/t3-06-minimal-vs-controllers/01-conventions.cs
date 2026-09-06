// 01-conventions.cs — What [ApiController] does for you, and what a minimal
// API does not do unless you ask.
//
// Run:  dotnet run 01-conventions.cs -c Release
//
// EXACT vs RATIO: every status code and response body here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddControllers();

var app = builder.Build();

// The same handler, same request type, same validation attributes.
app.MapPost("/minimal/payments", (CreatePayment body) =>
    Results.Ok(new { received = body.AmountMinor, currency = body.Currency }));

app.MapGet("/minimal/bind/{id}", (string id, [FromQuery] int amount,
    [FromHeader(Name = "X-Tenant")] string tenant) => Results.Ok(new { id, amount, tenant }));

app.MapControllers();

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

await Validation(http);
await MalformedJson(http);
await BindingSources(http);
Conventions();

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Validation(HttpClient http)
{
    Console.WriteLine("1. A request that violates the validation attributes");
    Console.WriteLine();
    Console.WriteLine("   The type both endpoints accept:");
    Console.WriteLine();
    Console.WriteLine("     public sealed class CreatePayment");
    Console.WriteLine("     {");
    Console.WriteLine("         [Range(1, 1_000_000)] public long AmountMinor { get; set; }");
    Console.WriteLine("         [Required, StringLength(3, MinimumLength = 3)]");
    Console.WriteLine("         public string Currency { get; set; } = \"\";");
    Console.WriteLine("     }");
    Console.WriteLine();

    const string invalid = """{"amountMinor": -5, "currency": "POUNDS"}""";

    Console.WriteLine("   POST {\"amountMinor\": -5, \"currency\": \"POUNDS\"}");
    Console.WriteLine();

    foreach (string path in new[] { "/minimal/payments", "/mvc/payments" })
    {
        using var content = new StringContent(invalid, System.Text.Encoding.UTF8,
            "application/json");
        using HttpResponseMessage response = await http.PostAsync(path, content);
        string body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   {path,-20} {(int)response.StatusCode}");
        Console.WriteLine($"   {"",-20} {Trim(body)}");
        Console.WriteLine();
    }

    Console.WriteLine("   THE MINIMAL ENDPOINT ACCEPTED IT. The attributes are on the type,");
    Console.WriteLine("   the values violate them, and nothing checked. A negative payment of");
    Console.WriteLine("   an invented currency reached the handler.");
    Console.WriteLine();
    Console.WriteLine("   THE CONTROLLER REJECTED IT with 400 and a ValidationProblemDetails");
    Console.WriteLine("   body naming both fields - and no line of the controller does that.");
    Console.WriteLine("   [ApiController] does.");
    Console.WriteLine();
    Console.WriteLine("   This is the single largest behavioural difference between the two");
    Console.WriteLine("   styles, and it is a difference in DEFAULTS rather than in what is");
    Console.WriteLine("   possible. Minimal APIs can validate - .NET 10 ships");
    Console.WriteLine("   builder.Services.AddValidation() for exactly this - but you have to");
    Console.WriteLine("   ask, and a team moving from controllers will not know to.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task MalformedJson(HttpClient http)
{
    Console.WriteLine("2. A body that is not valid JSON");
    Console.WriteLine();

    foreach (string path in new[] { "/minimal/payments", "/mvc/payments" })
    {
        using var content = new StringContent("{not json at all", System.Text.Encoding.UTF8,
            "application/json");
        using HttpResponseMessage response = await http.PostAsync(path, content);
        string body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   {path,-20} {(int)response.StatusCode}  {Trim(body)}");
    }

    Console.WriteLine();
    Console.WriteLine("   Both reject it, and the SHAPE of the rejection differs. The");
    Console.WriteLine("   controller produces a ProblemDetails document; the minimal endpoint");
    Console.WriteLine("   produces a bare status code.");
    Console.WriteLine();
    Console.WriteLine("   That matters for a caller writing error handling once. If half your");
    Console.WriteLine("   endpoints answer with a structured document and half answer with an");
    Console.WriteLine("   empty body, every client has to handle both.");
    Console.WriteLine();
    Console.WriteLine("   The fix is builder.Services.AddProblemDetails(), which gives minimal");
    Console.WriteLine("   endpoints the same envelope. Again: available, and off by default.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task BindingSources(HttpClient http)
{
    Console.WriteLine("3. Where a parameter comes from");
    Console.WriteLine();

    Console.WriteLine("   GET /both/bind/PAY-1?amount=99 with header X-Tenant: acme");
    Console.WriteLine();

    foreach (string path in new[] { "/minimal/bind/PAY-1", "/mvc/bind/PAY-1" })
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{path}?amount=99");
        request.Headers.TryAddWithoutValidation("X-Tenant", "acme");

        using HttpResponseMessage response = await http.SendAsync(request);
        Console.WriteLine($"   {path,-20} {(int)response.StatusCode}  " +
            $"{Trim(await response.Content.ReadAsStringAsync())}");
    }

    Console.WriteLine();
    Console.WriteLine("   Both bound the same three values, and both needed [FromHeader] to");
    Console.WriteLine("   get the header - the inference rules agree on route and query and");
    Console.WriteLine("   neither guesses headers.");
    Console.WriteLine();
    Console.WriteLine("   Where they differ is what happens with a COMPLEX type:");
    Console.WriteLine();
    Console.WriteLine("     minimal API   a complex parameter is read from the BODY unless");
    Console.WriteLine("                   the type has TryParse or BindAsync");
    Console.WriteLine("     controller    with [ApiController], a complex parameter is");
    Console.WriteLine("                   inferred from the body; without it, from the FORM");
    Console.WriteLine();
    Console.WriteLine("   That last clause is the one that surprises people porting old");
    Console.WriteLine("   controllers: a controller without [ApiController] treats a complex");
    Console.WriteLine("   parameter as form data, so a JSON body binds to an object with every");
    Console.WriteLine("   property at its default and no error anywhere.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Conventions()
{
    Console.WriteLine("4. The full list of what [ApiController] turns on");
    Console.WriteLine();
    Console.WriteLine("   It is one attribute and it changes five behaviours:");
    Console.WriteLine();
    Console.WriteLine("   1. AUTOMATIC 400 ON A VALIDATION FAILURE, with a");
    Console.WriteLine("      ValidationProblemDetails body. Measured in section 1.");
    Console.WriteLine();
    Console.WriteLine("   2. BINDING SOURCE INFERENCE - complex types from the body, simple");
    Console.WriteLine("      types from the route or query, IFormFile from a form.");
    Console.WriteLine();
    Console.WriteLine("   3. PROBLEMDETAILS FOR ERROR STATUS CODES, so a 404 or a 500 comes");
    Console.WriteLine("      back as a document rather than an empty body.");
    Console.WriteLine();
    Console.WriteLine("   4. ATTRIBUTE ROUTING REQUIRED - conventional routes do not apply, so");
    Console.WriteLine("      every action states its own route.");
    Console.WriteLine();
    Console.WriteLine("   5. MULTIPART/FORM-DATA INFERENCE for IFormFile parameters.");
    Console.WriteLine();
    Console.WriteLine("   THE POINT IS NOT THAT ONE STYLE IS BETTER. It is that CONTROLLERS");
    Console.WriteLine("   COME WITH A SET OF DECISIONS ALREADY MADE, and minimal APIs come");
    Console.WriteLine("   with none. Both positions are defensible:");
    Console.WriteLine();
    Console.WriteLine("     - Conventions you did not choose are conventions you cannot see.");
    Console.WriteLine("       A team that has never read this list does not know why a 400");
    Console.WriteLine("       appears, and cannot change it.");
    Console.WriteLine();
    Console.WriteLine("     - Conventions you must opt into are conventions somebody will");
    Console.WriteLine("       forget. An API where validation runs on nineteen endpoints and");
    Console.WriteLine("       not the twentieth is worse than either consistent choice.");
    Console.WriteLine();
    Console.WriteLine("   The practical recommendation, and the rest of this module supports");
    Console.WriteLine("   it: WHICHEVER STYLE YOU PICK, MAKE THE CROSS-CUTTING BEHAVIOUR");
    Console.WriteLine("   EXPLICIT AND APPLY IT IN ONE PLACE - a route group for minimal APIs,");
    Console.WriteLine("   a base controller or a convention for MVC. The failure mode in both");
    Console.WriteLine("   styles is per-endpoint drift, not the style itself.");
}

// ---------------------------------------------------------------------------
static string Trim(string body) =>
    body.Length == 0 ? "(empty body)" : body.Length > 110 ? body[..110] + "..." : body;

// ---------------------------------------------------------------------------
public sealed class CreatePayment
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public string Currency { get; set; } = "";
}

[ApiController]
[Route("mvc")]
public sealed class PaymentsController : ControllerBase
{
    [HttpPost("payments")]
    public IActionResult Create(CreatePayment body) =>
        Ok(new { received = body.AmountMinor, currency = body.Currency });

    [HttpGet("bind/{id}")]
    public IActionResult Bind(string id, [FromQuery] int amount, [FromHeader(Name = "X-Tenant")] string tenant) =>
        Ok(new { id, amount, tenant });
}
