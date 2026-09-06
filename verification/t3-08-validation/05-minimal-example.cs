// 05-minimal-example.cs — One endpoint with all four layers of checking in
// place, and each one doing only its own job.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and error key here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// LAYER 2: input validation. One line, and it walks nested objects and
// collections - which the hand-rolled Validator.TryValidateObject filter does
// not, as measured in 01-nesting.cs.
builder.Services.AddValidation();

// So that a rejection is a document naming the field rather than a bare code.
builder.Services.AddProblemDetails();

builder.Services.AddSingleton<ICurrencyCatalogue, CurrencyCatalogue>();
builder.Services.AddSingleton<ILedger, Ledger>();

var app = builder.Build();
app.UseStatusCodePages();

app.MapPost("/v1/invoices", (
    CreateInvoice body,
    ICurrencyCatalogue currencies,
    ILedger ledger) =>
{
    // LAYER 3: domain rules. Everything that depends on state outside the
    // request, and therefore cannot be an attribute. 422, not 400 - the
    // request was well-formed and is not allowed.
    if (!currencies.IsEnabled(body.Currency))
    {
        return Results.UnprocessableEntity(new
        {
            error = "currency not enabled for this account",
            currency = body.Currency
        });
    }

    // LAYER 4 stands in for a database constraint: the write itself refuses
    // data that would be internally inconsistent, whatever reached it.
    if (!ledger.TryRecord(body, out string? violation))
    {
        return Results.UnprocessableEntity(new { error = violation });
    }

    return Results.Created($"/v1/invoices/{body.Reference}", new
    {
        body.Reference,
        total = body.Lines.Sum(line => line.AmountMinor)
    });
});

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("Four layers, each doing only its own job");
Console.WriteLine();
Console.WriteLine("   request                          status   caught by");
Console.WriteLine("   -------                          ------   ---------");

await Post(http, """{"reference":"INV-1","currency":"GBP","lines":[{"description":"work","amountMinor":50000}]}""",
    "valid", "-");

await Post(http, """{"reference":"INV-2","currency":"GBP","lines":[{"description":"work","amountMinor":"lots"}]}""",
    "amount is not a number", "binding");

await Post(http, """{"reference":"","currency":"GBP","lines":[{"description":"work","amountMinor":50000}]}""",
    "reference empty", "input validation");

await Post(http, """{"reference":"INV-4","currency":"GBP","lines":[{"description":"work","amountMinor":-5}]}""",
    "NESTED line negative", "input validation");

await Post(http, """{"reference":"INV-5","currency":"GBP","lines":[]}""",
    "no lines at all", "input validation (cross-field)");

await Post(http, """{"reference":"INV-6","currency":"USD","lines":[{"description":"work","amountMinor":50000}]}""",
    "currency not enabled", "domain rule");

await Post(http, """{"reference":"INV-1","currency":"GBP","lines":[{"description":"work","amountMinor":50000}]}""",
    "duplicate reference", "the write itself");

Console.WriteLine();
Console.WriteLine("   Each row is stopped by exactly one layer, and each layer answers only");
Console.WriteLine("   the question it can answer:");
Console.WriteLine();
Console.WriteLine("     binding             can a value of this type be produced?      400");
Console.WriteLine("     input validation    is the value well-formed and in range?     400");
Console.WriteLine("     domain rules        is this allowed given the current state?   422");
Console.WriteLine("     the write           is the stored data consistent?             422");
Console.WriteLine();
Console.WriteLine("   The 400/422 split is the load-bearing part. 400 says the request is");
Console.WriteLine("   malformed and re-sending it unchanged is pointless. 422 says the");
Console.WriteLine("   request was fine and the answer depends on state - so the same request");
Console.WriteLine("   might succeed later.");
Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - AddValidation(), which walks nested objects and collections");
Console.WriteLine("     - AddProblemDetails and UseStatusCodePages, so an error names a field");
Console.WriteLine("     - attributes for rules decidable from the request alone");
Console.WriteLine("     - IValidatableObject for rules spanning two fields, naming the member");
Console.WriteLine("     - a service lookup in the HANDLER for anything about the world, with");
Console.WriteLine("       422 rather than 400");
Console.WriteLine("     - the write refusing inconsistent data whatever reached it");
Console.WriteLine();
Console.WriteLine("   WHY ALL FOUR. Every layer except the last is something a change can");
Console.WriteLine("   silently remove: a port to another framework, a nested type the filter");
Console.WriteLine("   does not reach, a new endpoint that forgets the group, a background job");
Console.WriteLine("   that writes directly.");
Console.WriteLine();
Console.WriteLine("   The layer that cannot be removed is the one furthest from the caller");
Console.WriteLine("   and least able to explain itself. That is the trade, and it is why");
Console.WriteLine("   'the database will catch it' and 'we validate at the edge' are both");
Console.WriteLine("   wrong on their own.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Post(HttpClient http, string json, string note, string layer)
{
    using var content = new StringContent(json, Encoding.UTF8, "application/json");
    using HttpResponseMessage response = await http.PostAsync("/v1/invoices", content);

    Console.WriteLine($"   {note,-31}  {(int)response.StatusCode,6}   {layer}");
}

// ---------------------------------------------------------------------------
public sealed class CreateInvoice : IValidatableObject
{
    [Required]
    [MinLength(1)]
    public string Reference { get; set; } = "";

    [Required]
    [RegularExpression("^[A-Z]{3}$")]
    public string Currency { get; set; } = "";

    public List<InvoiceLine> Lines { get; set; } = [];

    // A rule about the request as a whole, decidable without any lookup.
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Lines.Count == 0)
        {
            yield return new ValidationResult(
                "an invoice must have at least one line", [nameof(Lines)]);
        }
    }
}

public sealed class InvoiceLine
{
    [Required]
    [MinLength(1)]
    public string Description { get; set; } = "";

    [Range(1, 10_000_000)]
    public long AmountMinor { get; set; }
}

public interface ICurrencyCatalogue
{
    bool IsEnabled(string currency);
}

public sealed class CurrencyCatalogue : ICurrencyCatalogue
{
    // Stands in for a lookup whose answer can change between requests, which
    // is exactly why it cannot be an attribute.
    public bool IsEnabled(string currency) => currency == "GBP";
}

public interface ILedger
{
    bool TryRecord(CreateInvoice invoice, out string? violation);
}

// Stands in for the database. It refuses data that would be inconsistent,
// whatever validation did or did not run in front of it.
public sealed class Ledger : ILedger
{
    private readonly HashSet<string> _references = [];

    public bool TryRecord(CreateInvoice invoice, out string? violation)
    {
        if (!_references.Add(invoice.Reference))
        {
            violation = "an invoice with that reference already exists";
            return false;
        }

        if (invoice.Lines.Any(line => line.AmountMinor < 1))
        {
            violation = "a line amount must be positive";
            return false;
        }

        violation = null;
        return true;
    }
}
