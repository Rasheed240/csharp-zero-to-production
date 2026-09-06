// 04-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 04-exercises.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;
using System.Text.Json;

await Exercise1();
await Exercise2();
await Exercise3();
await Exercise4();
Exercise5();

// ---------------------------------------------------------------------------
// 1. EASY — do the attributes run?
// ---------------------------------------------------------------------------
static async Task Exercise1()
{
    Console.WriteLine("Exercise 1: this type has attributes and the endpoint accepts a");
    Console.WriteLine("            negative amount. What is missing?");
    Console.WriteLine();

    Console.WriteLine("   configuration                    -5 accepted?");
    Console.WriteLine("   -------------                    ------------");
    Console.WriteLine($"   nothing registered               {await RunAsync(validation: false)}");
    Console.WriteLine($"   builder.Services.AddValidation() {await RunAsync(validation: true)}");
    Console.WriteLine();
    Console.WriteLine("   THE ATTRIBUTES ARE INERT UNTIL SOMETHING READS THEM. An attribute is");
    Console.WriteLine("   metadata - a fact recorded about a property - and recording a rule is");
    Console.WriteLine("   not enforcing it.");
    Console.WriteLine();
    Console.WriteLine("   In a controller with [ApiController] the reader is built in. In a");
    Console.WriteLine("   minimal API you register it: one line, and .NET 10 ships it.");
    Console.WriteLine();
    Console.WriteLine("   That difference in DEFAULTS is the whole of the previous module's");
    Console.WriteLine("   incident, and it is worth carrying as a habit: after writing a");
    Console.WriteLine("   validation attribute, send one request that violates it.");
    Console.WriteLine();

    static async Task<string> RunAsync(bool validation)
    {
        WebApplication app = await BuildAsync(validation, a =>
            a.MapPost("/p", (SimpleRequest body) => Results.Ok(new { body.AmountMinor })));

        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        using var content = new StringContent("""{"amountMinor":-5}""",
            Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync("/p", content);
        await app.StopAsync();

        return response.IsSuccessStatusCode
            ? $"YES - {(int)response.StatusCode}"
            : $"no  - {(int)response.StatusCode}";
    }
}

// ---------------------------------------------------------------------------
// 2. EASY — nested and collection rules.
// ---------------------------------------------------------------------------
static async Task Exercise2()
{
    Console.WriteLine("Exercise 2: the hand-rolled filter below has been in the codebase for");
    Console.WriteLine("            two years. Someone adds a nested object and a list. Which");
    Console.WriteLine("            rules still run?");
    Console.WriteLine();
    Console.WriteLine("     Validator.TryValidateObject(argument, ctx, errors,");
    Console.WriteLine("         validateAllProperties: true)");
    Console.WriteLine();

    Console.WriteLine("   body                    hand-rolled   AddValidation()");
    Console.WriteLine("   ----                    -----------   ---------------");

    foreach ((string label, string json) in Bodies())
    {
        string handRolled = await CheckAsync(json, builtIn: false);
        string builtIn = await CheckAsync(json, builtIn: true);
        Console.WriteLine($"   {label,-22}  {handRolled,-11}   {builtIn}");
    }

    Console.WriteLine();
    Console.WriteLine("   ONLY THE TOP LEVEL. Validator.TryValidateObject checks the");
    Console.WriteLine("   attributes on the object handed to it and treats a property whose");
    Console.WriteLine("   type is another class as a single value.");
    Console.WriteLine();
    Console.WriteLine("   The parameter name makes this worse. validateAllProperties means");
    Console.WriteLine("   'every property of THIS object', not 'everything reachable' - so it");
    Console.WriteLine("   is necessary and it is not what it sounds like.");
    Console.WriteLine();
    Console.WriteLine("   AddValidation() walks the graph and names the path:");
    Console.WriteLine();
    Console.WriteLine("     Payer.Email             the route into the nested object");
    Console.WriteLine("     Lines[0].AmountMinor    the index of the offending item");
    Console.WriteLine();
    Console.WriteLine("   It is a source generator rather than reflection, which is how it");
    Console.WriteLine("   does this without breaking trimming and AOT - and which means it");
    Console.WriteLine("   only covers types it can see at compile time.");
    Console.WriteLine();
    Console.WriteLine("   IF YOU CANNOT USE IT: walk the graph yourself (thirty fiddly lines -");
    Console.WriteLine("   cycles, dictionaries, structs), use FluentValidation, or FLATTEN THE");
    Console.WriteLine("   REQUEST TYPE. The third is not avoidance: a request type is a wire");
    Console.WriteLine("   contract rather than a domain model, and a flat one is easier to");
    Console.WriteLine("   version and document as well as to validate.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — a rule two fields must agree on.
// ---------------------------------------------------------------------------
static async Task Exercise3()
{
    Console.WriteLine("Exercise 3: 'a scheduled transfer must have a date; an immediate one");
    Console.WriteLine("            must not.' Where does that rule go?");
    Console.WriteLine();

    WebApplication app = await BuildAsync(validation: true, a =>
        a.MapPost("/t", (CreateTransfer body) => Results.Ok(new { body.AmountMinor })));

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   body                              status   errors");
    Console.WriteLine("   ----                              ------   ------");

    foreach ((string label, string json) in new[]
    {
        ("immediate, no date", """{"amountMinor":100,"scheduled":false}"""),
        ("immediate WITH a date", """{"amountMinor":100,"scheduled":false,"scheduledFor":"2026-10-01T00:00:00Z"}"""),
        ("scheduled, no date", """{"amountMinor":100,"scheduled":true}"""),
        ("scheduled with a date", """{"amountMinor":100,"scheduled":true,"scheduledFor":"2026-10-01T00:00:00Z"}""")
    })
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync("/t", content);
        Console.WriteLine($"   {label,-32}  {(int)response.StatusCode,6}   {await Keys(response)}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   IValidatableObject. No single property can express a rule about two,");
    Console.WriteLine("   so the type implements one method:");
    Console.WriteLine();
    Console.WriteLine("     public IEnumerable<ValidationResult> Validate(ValidationContext ctx)");
    Console.WriteLine("     {");
    Console.WriteLine("         if (Scheduled && ScheduledFor is null)");
    Console.WriteLine("         {");
    Console.WriteLine("             yield return new ValidationResult(");
    Console.WriteLine("                 \"a scheduled transfer needs a date\",");
    Console.WriteLine("                 [nameof(ScheduledFor)]);");
    Console.WriteLine("         }");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   Two details worth getting right:");
    Console.WriteLine();
    Console.WriteLine("     - NAME THE MEMBER. Without it the error is filed under an empty");
    Console.WriteLine("       key and a client cannot attach it to a field - the difference");
    Console.WriteLine("       between highlighting the date box and showing a banner.");
    Console.WriteLine();
    Console.WriteLine("     - IT RUNS AFTER the property attributes, and only if they passed.");
    Console.WriteLine("       So it can assume the values are well-formed, and a client fixing");
    Console.WriteLine("       one error may then see a second it could not have been told");
    Console.WriteLine("       about first.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — a rule that needs a lookup.
// ---------------------------------------------------------------------------
static async Task Exercise4()
{
    Console.WriteLine("Exercise 4: 'this account may only send GBP.' Someone proposes a");
    Console.WriteLine("            [CurrencyEnabled] attribute that resolves a service from");
    Console.WriteLine("            ValidationContext. Argue for or against.");
    Console.WriteLine();

    WebApplication app = await BuildAsync(validation: true, a =>
    {
        a.MapPost("/edge", (CreateTransfer body) => Results.Ok(new { body.AmountMinor }));

        a.MapPost("/domain", (CreateTransfer body) =>
            body.Currency == "GBP"
                ? Results.Ok(new { body.AmountMinor })
                : Results.UnprocessableEntity(new
                {
                    error = "currency not enabled for this account",
                    currency = body.Currency
                }));
    });

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   endpoint   currency   status   meaning");
    Console.WriteLine("   --------   --------   ------   -------");

    foreach ((string path, string currency, string meaning) in new[]
    {
        ("/edge", "POUNDS", "malformed - a 400 is right"),
        ("/edge", "USD", "well-formed; the edge has no opinion"),
        ("/domain", "USD", "well-formed and not allowed - 422")
    })
    {
        string json = $$"""{"amountMinor":100,"currency":"{{currency}}","scheduled":false}""";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync(path, content);
        Console.WriteLine($"   {path,-10} {currency,-10} {(int)response.StatusCode,6}   {meaning}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   AGAINST, on three grounds:");
    Console.WriteLine();
    Console.WriteLine("   1. THE STATUS CODE IS WRONG. A failing attribute produces 400, which");
    Console.WriteLine("      means malformed. 'USD is not enabled for this account' is 422 -");
    Console.WriteLine("      well-formed and unacceptable. The distinction tells a client");
    Console.WriteLine("      whether fixing the request could ever help.");
    Console.WriteLine();
    Console.WriteLine("   2. IT HIDES I/O IN A DECLARATION. An attribute looks free. One that");
    Console.WriteLine("      queries a database runs before authentication, on every request,");
    Console.WriteLine("      including ones that were going to be rejected anyway.");
    Console.WriteLine();
    Console.WriteLine("   3. THE ANSWER CAN CHANGE BETWEEN THE CHECK AND THE ACTION. A");
    Console.WriteLine("      currency enabled when the attribute ran may be disabled by the");
    Console.WriteLine("      time the transfer is written, so the check has to happen where the");
    Console.WriteLine("      decision is - which is not at the edge.");
    Console.WriteLine();
    Console.WriteLine("   THE TEST FOR WHERE A RULE BELONGS: does it depend on anything");
    Console.WriteLine("   OUTSIDE THE REQUEST? 'Between 1 and a million' does not, so it is an");
    Console.WriteLine("   attribute. 'Enabled for this account' does, so it cannot be - however");
    Console.WriteLine("   convenient that would be.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 5. HARD — the layering.
// ---------------------------------------------------------------------------
static void Exercise5()
{
    Console.WriteLine("Exercise 5: place each rule in a layer, and say which layers a future");
    Console.WriteLine("            change could silently remove.");
    Console.WriteLine();
    Console.WriteLine("     a. amount is a number");
    Console.WriteLine("     b. amount is between 1 and 1,000,000");
    Console.WriteLine("     c. currency is three uppercase letters");
    Console.WriteLine("     d. a scheduled transfer has a date");
    Console.WriteLine("     e. currency is enabled for this account");
    Console.WriteLine("     f. the account has sufficient balance");
    Console.WriteLine("     g. no stored payment may have a non-positive amount");
    Console.WriteLine();
    Console.WriteLine("   layer                 rules   failure   can a change remove it?");
    Console.WriteLine("   -----                 -----   -------   -----------------------");
    Console.WriteLine("   binding               a       400       no");
    Console.WriteLine("   input validation      b c d   400       YES - a forgotten attribute,");
    Console.WriteLine("                                           a nested type, a port");
    Console.WriteLine("   domain rules          e f     422       YES - a path that skips it,");
    Console.WriteLine("                                           a background job");
    Console.WriteLine("   database constraint   g       error     NO");
    Console.WriteLine();
    Console.WriteLine("   THE LAST COLUMN IS THE ARGUMENT FOR HAVING ALL FOUR. Every layer");
    Console.WriteLine("   above the last is something a change can silently remove - and this");
    Console.WriteLine("   module and the previous one are two measured examples of exactly");
    Console.WriteLine("   that happening.");
    Console.WriteLine();
    Console.WriteLine("   The one that cannot be removed is the one furthest from the caller");
    Console.WriteLine("   and least able to explain itself. That is the trade, and it is why");
    Console.WriteLine("   'the database will catch it' and 'we validate at the edge' are both");
    Console.WriteLine("   wrong on their own:");
    Console.WriteLine();
    Console.WriteLine("     - Edge validation alone gives good messages and no guarantee.");
    Console.WriteLine("     - Constraints alone give a guarantee and a 500 with a violation");
    Console.WriteLine("       nobody can act on.");
    Console.WriteLine();
    Console.WriteLine("   THE DIVIDING LINE between b/c/d and e/f is the one people move, and");
    Console.WriteLine("   the test is whether the rule depends on anything outside the request.");
    Console.WriteLine("   Rules b, c and d can be decided by reading the request alone. Rules e");
    Console.WriteLine("   and f cannot, so they belong where the state is - and they get 422");
    Console.WriteLine("   rather than 400, because the request was fine.");
    Console.WriteLine();
    Console.WriteLine("   AND ONE RULE THAT LOOKS LIKE VALIDATION AND IS NOT: rule f is a race.");
    Console.WriteLine("   Checking a balance and then debiting it are two operations, and the");
    Console.WriteLine("   balance can change in between. That check has to be part of the write");
    Console.WriteLine("   - a conditional update, a transaction, a constraint - not a question");
    Console.WriteLine("   asked beforehand. Validating it at the edge is not merely misplaced;");
    Console.WriteLine("   it is a check that cannot be correct where it stands.");
}


// ---------------------------------------------------------------------------
// THE ONLY AddValidation() CALL SITE IN THIS PROGRAM.
//
// Measured while writing this file: the .NET 10 validation source generator
// works from a single call site and silently does nothing when a program
// contains several. One site, executed conditionally, behaves correctly - so
// every app in this file is built here.
static async Task<WebApplication> BuildAsync(bool validation, Action<WebApplication> map)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();

    if (validation)
    {
        builder.Services.AddValidation();
    }

    var app = builder.Build();
    app.UseStatusCodePages();
    map(app);

    await app.StartAsync();
    return app;
}

// ---------------------------------------------------------------------------
static (string Label, string Json)[] Bodies() =>
[
    ("top-level bad", """{"reference":"","payer":{"email":"a@b.c"},"lines":[{"amountMinor":100}]}"""),
    ("NESTED bad", """{"reference":"R1","payer":{"email":"nope"},"lines":[{"amountMinor":100}]}"""),
    ("COLLECTION bad", """{"reference":"R1","payer":{"email":"a@b.c"},"lines":[{"amountMinor":-5}]}"""),
    ("all valid", """{"reference":"R1","payer":{"email":"a@b.c"},"lines":[{"amountMinor":100}]}""")
];

static async Task<string> CheckAsync(string json, bool builtIn)
{
    WebApplication app = await BuildAsync(builtIn, a =>
    {
        if (builtIn)
        {
            a.MapPost("/i", (CreateInvoice body) => Results.Ok(new { body.Reference }));
            return;
        }

        a.MapGroup("/").AddEndpointFilter(async (context, next) =>
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
        }).MapPost("/i", (CreateInvoice body) => Results.Ok(new { body.Reference }));
    });

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    using var content = new StringContent(json, Encoding.UTF8, "application/json");
    using HttpResponseMessage response = await http.PostAsync("/i", content);
    string keys = await Keys(response);
    await app.StopAsync();

    return response.IsSuccessStatusCode ? "ACCEPTED" : keys;
}

static async Task<string> Keys(HttpResponseMessage response)
{
    if (response.IsSuccessStatusCode)
    {
        return "(accepted)";
    }

    using JsonDocument document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

    if (!document.RootElement.TryGetProperty("errors", out JsonElement errors))
    {
        return $"{(int)response.StatusCode}";
    }

    return string.Join(", ", errors.EnumerateObject()
        .Select(p => p.Name.Length == 0 ? "(unnamed)" : p.Name));
}

// ---------------------------------------------------------------------------
public sealed class SimpleRequest
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }
}

public sealed class CreateInvoice
{
    [Required]
    [MinLength(1)]
    public string Reference { get; set; } = "";

    public Payer? Payer { get; set; }

    public List<InvoiceLine> Lines { get; set; } = [];
}

public sealed class Payer
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = "";
}

public sealed class InvoiceLine
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }
}

public sealed class CreateTransfer : IValidatableObject
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [RegularExpression("^[A-Z]{3}$")]
    public string Currency { get; set; } = "GBP";

    public bool Scheduled { get; set; }

    public DateTimeOffset? ScheduledFor { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Scheduled && ScheduledFor is null)
        {
            yield return new ValidationResult(
                "a scheduled transfer needs a date", [nameof(ScheduledFor)]);
        }

        if (!Scheduled && ScheduledFor is not null)
        {
            yield return new ValidationResult(
                "an immediate transfer must not carry a date", [nameof(ScheduledFor)]);
        }
    }
}
