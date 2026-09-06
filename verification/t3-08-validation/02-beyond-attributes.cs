// 02-beyond-attributes.cs — Rules that span two fields, rules that need a
// service, and the rules that do not belong at the edge at all.
//
// Run:  dotnet run 02-beyond-attributes.cs -c Release
//
// EXACT vs RATIO: every status code and error key here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddValidation();
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<ICurrencyCatalogue, CurrencyCatalogue>();

var app = builder.Build();
app.UseStatusCodePages();

app.MapPost("/transfers", (CreateTransfer body) => Results.Ok(new { body.AmountMinor }));

app.MapPost("/domain", (CreateTransfer body, ICurrencyCatalogue currencies) =>
{
    // A rule that needs a service, and a rule about the world rather than
    // about the request. Neither belongs in an attribute.
    if (!currencies.IsEnabled(body.Currency))
    {
        return Results.UnprocessableEntity(new
        {
            error = "currency not enabled for this account",
            currency = body.Currency
        });
    }

    return Results.Ok(new { body.AmountMinor });
});

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

await CrossField(http);
await CustomAttribute(http);
await NeedsAService(http);
Layering();

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task CrossField(HttpClient http)
{
    Console.WriteLine("1. A rule that spans two fields");
    Console.WriteLine();
    Console.WriteLine("   'A scheduled transfer must have a date; an immediate one must not.'");
    Console.WriteLine("   No single property can express that.");
    Console.WriteLine();

    Console.WriteLine("   body                              status   errors");
    Console.WriteLine("   ----                              ------   ------");

    foreach ((string label, string json) in new[]
    {
        ("immediate, no date", """{"amountMinor":100,"currency":"GBP","scheduled":false}"""),
        ("immediate WITH a date", """{"amountMinor":100,"currency":"GBP","scheduled":false,"scheduledFor":"2026-10-01T00:00:00Z"}"""),
        ("scheduled, no date", """{"amountMinor":100,"currency":"GBP","scheduled":true}"""),
        ("scheduled with a date", """{"amountMinor":100,"currency":"GBP","scheduled":true,"scheduledFor":"2026-10-01T00:00:00Z"}""")
    })
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync("/transfers", content);
        Console.WriteLine($"   {label,-32}  {(int)response.StatusCode,6}   {await Keys(response)}");
    }

    Console.WriteLine();
    Console.WriteLine("   IValidatableObject is the hook. One method on the type, run after");
    Console.WriteLine("   the per-property attributes have passed:");
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
    Console.WriteLine("     - NAME THE MEMBER in the ValidationResult. Without it the error is");
    Console.WriteLine("       filed under an empty key and a client cannot attach it to a");
    Console.WriteLine("       field. That is the difference between a form that highlights the");
    Console.WriteLine("       date box and one that shows a banner.");
    Console.WriteLine();
    Console.WriteLine("     - IT RUNS AFTER the property attributes, and only if they passed.");
    Console.WriteLine("       So a cross-field rule can assume the individual values are");
    Console.WriteLine("       well-formed, and a client fixing one error may then see a second");
    Console.WriteLine("       one it could not have been told about first.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task CustomAttribute(HttpClient http)
{
    Console.WriteLine("2. A rule you want on several types");
    Console.WriteLine();

    Console.WriteLine("   currency   status   errors");
    Console.WriteLine("   --------   ------   ------");

    foreach (string currency in new[] { "GBP", "gbp", "POUNDS", "12" })
    {
        string json = $$"""{"amountMinor":100,"currency":"{{currency}}","scheduled":false}""";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync("/transfers", content);
        Console.WriteLine($"   {currency,-8}   {(int)response.StatusCode,6}   {await Keys(response)}");
    }

    Console.WriteLine();
    Console.WriteLine("   A ValidationAttribute subclass, reusable anywhere:");
    Console.WriteLine();
    Console.WriteLine("     public sealed class CurrencyCodeAttribute : ValidationAttribute");
    Console.WriteLine("     {");
    Console.WriteLine("         protected override ValidationResult? IsValid(");
    Console.WriteLine("             object? value, ValidationContext context) { ... }");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   Note the second row. 'gbp' is rejected because the rule checks for");
    Console.WriteLine("   uppercase - which is a DECISION, not an obvious truth. An API that");
    Console.WriteLine("   accepts lowercase and normalises it is also defensible.");
    Console.WriteLine();
    Console.WriteLine("   The choice matters because it is the difference between a client");
    Console.WriteLine("   getting a 400 and a client getting what it meant. Prefer being");
    Console.WriteLine("   strict about SHAPE and forgiving about FORM: three letters is a");
    Console.WriteLine("   shape, uppercase is a form.");
    Console.WriteLine();
    Console.WriteLine("   Two rules for a custom attribute:");
    Console.WriteLine();
    Console.WriteLine("     - IT MUST BE PURE AND FAST. It runs on every request, and the");
    Console.WriteLine("       ValidationContext gives it access to the service provider - which");
    Console.WriteLine("       is a trap, not a feature. See section 3.");
    Console.WriteLine();
    Console.WriteLine("     - RETURN ValidationResult.Success FOR null unless the rule is");
    Console.WriteLine("       about presence. Combining [Required] with a format rule is how");
    Console.WriteLine("       you get one error rather than two for an absent value.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task NeedsAService(HttpClient http)
{
    Console.WriteLine("3. A rule that needs to look something up");
    Console.WriteLine();

    Console.WriteLine("   endpoint     currency   status   response");
    Console.WriteLine("   --------     --------   ------   --------");

    foreach ((string path, string currency) in new[]
    {
        ("/transfers", "USD"), ("/domain", "GBP"), ("/domain", "USD")
    })
    {
        string json = $$"""{"amountMinor":100,"currency":"{{currency}}","scheduled":false}""";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync(path, content);
        string body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   {path,-12} {currency,-10} {(int)response.StatusCode,6}   " +
            $"{(body.Length > 64 ? body[..64] + "..." : body)}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIRST ROW PASSES VALIDATION. USD is three uppercase letters, so");
    Console.WriteLine("   every attribute is satisfied. Whether this account may send USD is a");
    Console.WriteLine("   question about the world, and no attribute can answer it.");
    Console.WriteLine();
    Console.WriteLine("   ValidationContext exposes GetService, so it is POSSIBLE to inject a");
    Console.WriteLine("   lookup into an attribute. Three reasons not to:");
    Console.WriteLine();
    Console.WriteLine("     - THE STATUS CODE IS WRONG. A failing attribute produces 400,");
    Console.WriteLine("       meaning 'malformed'. 'GBP only for this account' is 422 -");
    Console.WriteLine("       well-formed and unacceptable.");
    Console.WriteLine();
    Console.WriteLine("     - IT HIDES I/O IN A DECLARATION. An attribute looks free. One that");
    Console.WriteLine("       queries a database runs before authentication, on every request,");
    Console.WriteLine("       including ones that were going to be rejected anyway.");
    Console.WriteLine();
    Console.WriteLine("     - IT IS UNTESTABLE WITHOUT A CONTAINER, which is most of the value");
    Console.WriteLine("       of attributes gone.");
    Console.WriteLine();
    Console.WriteLine("   And the reason underneath all three: THE ANSWER CAN CHANGE BETWEEN");
    Console.WriteLine("   THE CHECK AND THE ACTION. A currency enabled when the attribute ran");
    Console.WriteLine("   may be disabled by the time the transfer is written, so the check has");
    Console.WriteLine("   to happen where the decision is - which is not at the edge.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Layering()
{
    Console.WriteLine("4. Where each kind of rule belongs");
    Console.WriteLine();
    Console.WriteLine("   layer            answers                     failure   can it be");
    Console.WriteLine("                                                          skipped?");
    Console.WriteLine("   -----            -------                     -------   ---------");
    Console.WriteLine("   binding          can a value of this type    400       no");
    Console.WriteLine("                    be produced at all?");
    Console.WriteLine();
    Console.WriteLine("   input validation is this value well-formed   400       yes - a");
    Console.WriteLine("                    and in range?                         forgotten");
    Console.WriteLine("                                                          attribute");
    Console.WriteLine();
    Console.WriteLine("   domain rules     is this action allowed      422       yes - a");
    Console.WriteLine("                    given the current state?              path that");
    Console.WriteLine("                                                          skips it");
    Console.WriteLine();
    Console.WriteLine("   database         is the stored data          an error  NO");
    Console.WriteLine("   constraints      internally consistent?");
    Console.WriteLine();
    Console.WriteLine("   THE LAST COLUMN IS THE ARGUMENT FOR HAVING ALL FOUR. Each layer");
    Console.WriteLine("   above the last is something a change can silently remove - a port to");
    Console.WriteLine("   a different framework, a new endpoint that forgets the filter, a");
    Console.WriteLine("   background job that writes directly.");
    Console.WriteLine();
    Console.WriteLine("   The one that cannot be skipped is the one furthest from the caller");
    Console.WriteLine("   and least able to explain itself. That is the trade, and it is why");
    Console.WriteLine("   'the database will catch it' and 'we validate at the edge' are both");
    Console.WriteLine("   wrong on their own.");
    Console.WriteLine();
    Console.WriteLine("   WHAT GOES WHERE, concretely:");
    Console.WriteLine();
    Console.WriteLine("     amount is a number              binding");
    Console.WriteLine("     amount is between 1 and 1m      input validation");
    Console.WriteLine("     currency is three letters       input validation");
    Console.WriteLine("     scheduled implies a date        input validation, cross-field");
    Console.WriteLine("     currency enabled for account    domain rule");
    Console.WriteLine("     account has sufficient balance  domain rule");
    Console.WriteLine("     amount_minor > 0                database constraint");
    Console.WriteLine("     currency is a known code        database foreign key");
    Console.WriteLine();
    Console.WriteLine("   The line between rows two and five is the one people move around,");
    Console.WriteLine("   and the test is whether the rule depends on ANYTHING OUTSIDE THE");
    Console.WriteLine("   REQUEST. 'Between 1 and a million' does not. 'Enabled for this");
    Console.WriteLine("   account' does, so it cannot be an attribute however convenient that");
    Console.WriteLine("   would be.");
}

// ---------------------------------------------------------------------------
static async Task<string> Keys(HttpResponseMessage response)
{
    if (response.IsSuccessStatusCode)
    {
        return "(none - accepted)";
    }

    using JsonDocument document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

    if (!document.RootElement.TryGetProperty("errors", out JsonElement errors))
    {
        return "(no errors object)";
    }

    return string.Join(", ", errors.EnumerateObject()
        .Select(p => p.Name.Length == 0 ? "(unnamed)" : p.Name));
}

// ---------------------------------------------------------------------------
public sealed class CreateTransfer : IValidatableObject
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [CurrencyCode]
    public string Currency { get; set; } = "";

    public bool Scheduled { get; set; }

    public DateTimeOffset? ScheduledFor { get; set; }

    // Runs AFTER every property attribute has passed.
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Scheduled && ScheduledFor is null)
        {
            yield return new ValidationResult(
                "a scheduled transfer needs a date",
                [nameof(ScheduledFor)]);
        }

        if (!Scheduled && ScheduledFor is not null)
        {
            yield return new ValidationResult(
                "an immediate transfer must not carry a date",
                [nameof(ScheduledFor)]);
        }
    }
}

public sealed class CurrencyCodeAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context)
    {
        // Presence is [Required]'s job. Returning success for null here is what
        // gives one error rather than two for an absent value.
        if (value is null)
        {
            return ValidationResult.Success;
        }

        string code = value as string ?? string.Empty;

        bool wellFormed = code.Length == 3 && code.All(char.IsAsciiLetterUpper);

        return wellFormed
            ? ValidationResult.Success
            : new ValidationResult(
                "currency must be a three-letter uppercase code",
                [context.MemberName ?? nameof(CreateTransfer.Currency)]);
    }
}

public interface ICurrencyCatalogue
{
    bool IsEnabled(string currency);
}

public sealed class CurrencyCatalogue : ICurrencyCatalogue
{
    // Stands in for a lookup that can change between requests.
    public bool IsEnabled(string currency) => currency == "GBP";
}
