// 01-nesting.cs — The hand-rolled validation filter every codebase writes, and
// the objects it silently does not check.
//
// Run:  dotnet run 01-nesting.cs -c Release
//
// EXACT vs RATIO: every status code and error key here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;
using System.Text.Json;

await DirectCall();
await ThroughAFilter();
await Recursing();
WhatItMeans();

// The four bodies: one bad at each level, and one good.
static (string Label, string Json)[] Bodies() =>
[
    ("top-level field bad", """{"reference":"","payer":{"email":"a@b.c"},"lines":[{"amountMinor":100}]}"""),
    ("NESTED object bad", """{"reference":"R1","payer":{"email":"not-an-email"},"lines":[{"amountMinor":100}]}"""),
    ("COLLECTION item bad", """{"reference":"R1","payer":{"email":"a@b.c"},"lines":[{"amountMinor":-5}]}"""),
    ("all valid", """{"reference":"R1","payer":{"email":"a@b.c"},"lines":[{"amountMinor":100}]}""")
];

// ---------------------------------------------------------------------------
static Task DirectCall()
{
    Console.WriteLine("1. Validator.TryValidateObject, called directly");
    Console.WriteLine();

    var request = new CreateInvoice
    {
        Reference = "R1",
        Payer = new Payer { Email = "not-an-email" },
        Lines = [new InvoiceLine { AmountMinor = -5 }]
    };

    var context = new ValidationContext(request);
    var errors = new List<ValidationResult>();
    bool valid = Validator.TryValidateObject(request, context, errors,
        validateAllProperties: true);

    Console.WriteLine("   an object with a bad nested email AND a bad collection item:");
    Console.WriteLine();
    Console.WriteLine($"     TryValidateObject returned : {valid}");
    Console.WriteLine($"     errors found               : {errors.Count}");

    foreach (ValidationResult error in errors)
    {
        Console.WriteLine($"       {string.Join(",", error.MemberNames)}: {error.ErrorMessage}");
    }

    Console.WriteLine();
    Console.WriteLine("   IT RETURNED true AND FOUND NOTHING. Both violations are real, both");
    Console.WriteLine("   are on properties carrying attributes, and neither was seen.");
    Console.WriteLine();
    Console.WriteLine("   VALIDATOR.TRYVALIDATEOBJECT DOES NOT RECURSE. It checks the");
    Console.WriteLine("   attributes on the object you hand it, and it treats a property whose");
    Console.WriteLine("   type is another class as a single value to be checked against that");
    Console.WriteLine("   PROPERTY'S attributes - not as an object with attributes of its own.");
    Console.WriteLine();
    Console.WriteLine("   The name of the parameter makes this worse: validateAllProperties");
    Console.WriteLine("   means 'check every property of THIS object', not 'check everything");
    Console.WriteLine("   reachable'. Setting it to true is necessary and it is not what it");
    Console.WriteLine("   sounds like.");
    Console.WriteLine();

    return Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static async Task ThroughAFilter()
{
    Console.WriteLine("2. The same thing as an endpoint filter");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();

    var app = builder.Build();
    app.UseStatusCodePages();

    // The filter that appears in a great deal of code, including earlier
    // modules of this track.
    app.MapGroup("/hand-rolled").AddEndpointFilter(async (context, next) =>
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
    }).MapPost("/invoices", (CreateInvoice body) => Results.Ok(new { body.Reference }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   body                    status   errors reported");
    Console.WriteLine("   ----                    ------   ---------------");

    foreach ((string label, string json) in Bodies())
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync("/hand-rolled/invoices", content);
        Console.WriteLine($"   {label,-22}  {(int)response.StatusCode,6}   " +
            $"{await Keys(response)}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   TWO OF THE THREE BAD BODIES WERE ACCEPTED. The filter runs, it is");
    Console.WriteLine("   correct as far as it goes, and it checks exactly one level.");
    Console.WriteLine();
    Console.WriteLine("   This matters more than a limitation in one helper, because that");
    Console.WriteLine("   filter is what almost everyone writes. It appears in blog posts, in");
    Console.WriteLine("   framework samples, and in the two preceding modules of this track -");
    Console.WriteLine("   where it was used to demonstrate a different point and carries this");
    Console.WriteLine("   limitation unremarked.");
    Console.WriteLine();
    Console.WriteLine("   A request type of scalars is validated correctly by it. The moment");
    Console.WriteLine("   somebody adds a nested address, a list of line items or a set of");
    Console.WriteLine("   options, half the rules quietly stop running.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Recursing()
{
    Console.WriteLine("3. The built-in validation");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddValidation();
    builder.Services.AddProblemDetails();

    var app = builder.Build();
    app.UseStatusCodePages();
    app.MapPost("/invoices", (CreateInvoice body) => Results.Ok(new { body.Reference }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   body                    status   errors reported");
    Console.WriteLine("   ----                    ------   ---------------");

    foreach ((string label, string json) in Bodies())
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync("/invoices", content);
        Console.WriteLine($"   {label,-22}  {(int)response.StatusCode,6}   {await Keys(response)}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   ALL THREE BAD BODIES REJECTED, and look at the error KEYS:");
    Console.WriteLine();
    Console.WriteLine("     Payer.Email      the path into the nested object");
    Console.WriteLine("     Lines[0].AmountMinor   the index of the offending item");
    Console.WriteLine();
    Console.WriteLine("   builder.Services.AddValidation() walks the whole object graph and");
    Console.WriteLine("   reports a path to each violation, so a client can point at the field");
    Console.WriteLine("   that was wrong rather than at the request.");
    Console.WriteLine();
    Console.WriteLine("   It is a source generator rather than reflection, which is why it can");
    Console.WriteLine("   do this without the AOT and trimming problems that walking a graph");
    Console.WriteLine("   by reflection would bring. That also means it only sees types it can");
    Console.WriteLine("   see at compile time - a validated type behind an interface or built");
    Console.WriteLine("   dynamically is outside what it generates for.");
    Console.WriteLine();
    Console.WriteLine("   Two lines to turn on, applied per endpoint or per group:");
    Console.WriteLine();
    Console.WriteLine("     builder.Services.AddValidation();");
    Console.WriteLine("     var group = app.MapGroup(\"/v1\").WithValidation();");
    Console.WriteLine();
    Console.WriteLine("   Without .WithValidation() on the group or endpoint it applies to");
    Console.WriteLine("   every endpoint by default, which is usually what you want and is");
    Console.WriteLine("   worth knowing before you wonder why an endpoint is validating.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatItMeans()
{
    Console.WriteLine("4. What to do about it");
    Console.WriteLine();
    Console.WriteLine("   IF YOU ARE ON .NET 10: use AddValidation(). It recurses, it reports");
    Console.WriteLine("   paths, and it is two lines.");
    Console.WriteLine();
    Console.WriteLine("   IF YOU ARE NOT, or you have a hand-rolled filter already, you have");
    Console.WriteLine("   three options and they are not equal:");
    Console.WriteLine();
    Console.WriteLine("   1. WALK THE GRAPH YOURSELF. Recurse into properties whose type is");
    Console.WriteLine("      not a primitive, and into the items of anything enumerable,");
    Console.WriteLine("      building the path as you go. It is thirty lines and it is easy to");
    Console.WriteLine("      get wrong - cycles, indexers, dictionaries, structs.");
    Console.WriteLine();
    Console.WriteLine("   2. USE A LIBRARY THAT ALREADY DOES. FluentValidation is the common");
    Console.WriteLine("      answer, and its RuleForEach and SetValidator handle exactly this");
    Console.WriteLine("      case. It is a package reference, which is why it is described");
    Console.WriteLine("      here rather than measured - this project runs offline.");
    Console.WriteLine();
    Console.WriteLine("   3. FLATTEN THE REQUEST TYPE so there is nothing to recurse into.");
    Console.WriteLine("      This sounds like avoidance and is sometimes the right answer: a");
    Console.WriteLine("      request type is a wire contract, not a domain model, and a flat");
    Console.WriteLine("      one is easier to version and to document as well as to validate.");
    Console.WriteLine();
    Console.WriteLine("   WHAT NOT TO DO: assume it works because the tests pass. A test");
    Console.WriteLine("   suite written alongside the filter will use the request types that");
    Console.WriteLine("   existed then - which were probably flat.");
    Console.WriteLine();
    Console.WriteLine("   THE TEST THAT CATCHES IT is one line per level of nesting: send a");
    Console.WriteLine("   body that is valid at the top and invalid underneath, and assert a");
    Console.WriteLine("   400. If your request types have a nested object or a collection and");
    Console.WriteLine("   you have never written that test, run it now.");
}

// ---------------------------------------------------------------------------
static async Task<string> Keys(HttpResponseMessage response)
{
    if (response.IsSuccessStatusCode)
    {
        return "(none - ACCEPTED)";
    }

    string body = await response.Content.ReadAsStringAsync();

    using JsonDocument document = JsonDocument.Parse(body);

    if (!document.RootElement.TryGetProperty("errors", out JsonElement errors))
    {
        return "(no errors object)";
    }

    return string.Join(", ", errors.EnumerateObject().Select(p => p.Name));
}

// ---------------------------------------------------------------------------
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
