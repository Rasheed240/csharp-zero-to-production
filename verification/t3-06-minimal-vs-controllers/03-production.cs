// 03-production.cs — Ledger ports one controller to a minimal API and starts
// accepting negative payments. Nothing was deleted; a default was.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every status code and count here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

TheIncident();
await FourVersions();
WhatToTake();

// The requests a real client sends, good and bad.
static (string Label, string Json)[] Requests() =>
[
    ("valid", """{"amountMinor": 123450, "currency": "GBP"}"""),
    ("negative amount", """{"amountMinor": -5, "currency": "GBP"}"""),
    ("amount of zero", """{"amountMinor": 0, "currency": "GBP"}"""),
    ("invented currency", """{"amountMinor": 100, "currency": "POUNDS"}"""),
    ("missing currency", """{"amountMinor": 100}""")
];

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   POST /payments has been a controller action for three years. The");
    Console.WriteLine("   request type carries data annotations - a range on the amount, a");
    Console.WriteLine("   length on the currency code - and they have been enforced since the");
    Console.WriteLine("   day they were written.");
    Console.WriteLine();
    Console.WriteLine("   A performance review flags MVC's overhead on the hot path. One");
    Console.WriteLine("   engineer ports the endpoint to a minimal API. The diff is small and");
    Console.WriteLine("   reads well:");
    Console.WriteLine();
    Console.WriteLine("     - the [HttpPost] attribute becomes app.MapPost");
    Console.WriteLine("     - the action body becomes a lambda body");
    Console.WriteLine("     - the request type is untouched");
    Console.WriteLine("     - the validation attributes are untouched");
    Console.WriteLine();
    Console.WriteLine("   Nothing about validation appears in the diff, because nothing about");
    Console.WriteLine("   validation appeared in the controller either. It was [ApiController].");
    Console.WriteLine();
    Console.WriteLine("   Within a day the ledger contains payments with negative amounts and");
    Console.WriteLine("   a currency code of POUNDS.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task FourVersions()
{
    Console.WriteLine("2. Four versions, the same five requests");
    Console.WriteLine();

    Result controller = await RunAsync("v1  the original controller", Version.Controller);
    Result ported = await RunAsync("v2  ported, as written", Version.PortedNaive);
    Result manual = await RunAsync("v3  ported, validating by hand", Version.PortedManual);
    Result filtered = await RunAsync("v4  ported, validating in a filter", Version.PortedFilter);

    Console.WriteLine("   version                              accepted   rejected   bad rows");
    Console.WriteLine("   -------                              --------   --------   --------");
    foreach (Result r in new[] { controller, ported, manual, filtered })
    {
        Console.WriteLine($"   {r.Label,-34}   {r.Accepted,8}   {r.Rejected,8}   {r.BadRows,8}");
    }

    Console.WriteLine();
    Console.WriteLine("   Of the five requests, ONE is valid. Four should be rejected.");
    Console.WriteLine();
    Console.WriteLine("   V1 rejects all four and writes one row. The controller contains no");
    Console.WriteLine("   validation code - [ApiController] checks the annotations and returns");
    Console.WriteLine("   400 with a ValidationProblemDetails body before the action runs.");
    Console.WriteLine();
    Console.WriteLine("   V2 ACCEPTS ALL FIVE. The attributes are still on the type; nothing");
    Console.WriteLine("   reads them. Four bad rows in the ledger, and every response was a");
    Console.WriteLine("   200 that the client had no reason to question.");
    Console.WriteLine();
    Console.WriteLine("   This is the incident, and the shape of it is worth naming: A DEFAULT");
    Console.WriteLine("   WAS REMOVED BY A CHANGE THAT DID NOT MENTION IT. Nobody deleted a");
    Console.WriteLine("   validation call, because there was never a validation call to delete.");
    Console.WriteLine();
    Console.WriteLine("   V3 validates by hand in the handler. It works, and it is the version");
    Console.WriteLine("   that gets written under pressure - which means the next endpoint gets");
    Console.WriteLine("   a slightly different version of the same four lines, and the one");
    Console.WriteLine("   after that forgets one of them.");
    Console.WriteLine();
    Console.WriteLine("   V4 validates in an endpoint filter applied to the whole group. Same");
    Console.WriteLine("   outcome as v1 and v3, declared once, and an endpoint added later");
    Console.WriteLine("   cannot miss it.");
    Console.WriteLine();
    Console.WriteLine("   In .NET 10 the framework ships this: builder.Services.AddValidation()");
    Console.WriteLine("   plus .WithValidation() does what v4 does by hand. V4 is written out");
    Console.WriteLine("   here because the mechanism is worth seeing once - and because the");
    Console.WriteLine("   same filter is where you would add anything the built-in does not");
    Console.WriteLine("   cover.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<Result> RunAsync(string label, Version version)
{
    var ledger = new List<CreatePayment>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddControllers();
    builder.Services.AddSingleton(ledger);

    var app = builder.Build();

    switch (version)
    {
        case Version.Controller:
            app.MapControllers();
            break;

        case Version.PortedNaive:
            // The port, exactly as an engineer would write it from the action.
            app.MapPost("/payments", (CreatePayment body, List<CreatePayment> store) =>
            {
                store.Add(body);
                return Results.Ok(new { accepted = body.AmountMinor });
            });
            break;

        case Version.PortedManual:
            app.MapPost("/payments", (CreatePayment body, List<CreatePayment> store) =>
            {
                var context = new ValidationContext(body);
                var errors = new List<ValidationResult>();

                if (!Validator.TryValidateObject(body, context, errors, validateAllProperties: true))
                {
                    return Results.ValidationProblem(ToDictionary(errors));
                }

                store.Add(body);
                return Results.Ok(new { accepted = body.AmountMinor });
            });
            break;

        default:
            // The same check, applied to a GROUP as a filter, so it cannot be
            // forgotten by an endpoint added later.
            var payments = app.MapGroup("/")
                .AddEndpointFilter(async (context, next) =>
                {
                    foreach (object? argument in context.Arguments)
                    {
                        if (argument is not CreatePayment candidate)
                        {
                            continue;
                        }

                        var validationContext = new ValidationContext(candidate);
                        var errors = new List<ValidationResult>();

                        if (!Validator.TryValidateObject(candidate, validationContext, errors,
                            validateAllProperties: true))
                        {
                            return Results.ValidationProblem(ToDictionary(errors));
                        }
                    }

                    return await next(context);
                });

            payments.MapPost("/payments", (CreatePayment body, List<CreatePayment> store) =>
            {
                store.Add(body);
                return Results.Ok(new { accepted = body.AmountMinor });
            });
            break;
    }

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    int accepted = 0;
    int rejected = 0;

    foreach ((string _, string json) in Requests())
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync("/payments", content);

        if (response.IsSuccessStatusCode)
        {
            accepted++;
        }
        else
        {
            rejected++;
        }
    }

    await app.StopAsync();

    int badRows = ledger.Count(p => p.AmountMinor < 1 || p.Currency.Length != 3);
    return new Result(label, accepted, rejected, badRows);

    static Dictionary<string, string[]> ToDictionary(List<ValidationResult> errors) =>
        errors.ToDictionary(
            e => e.MemberNames.FirstOrDefault() ?? "request",
            e => new[] { e.ErrorMessage ?? "invalid" });
}

// ---------------------------------------------------------------------------
static void WhatToTake()
{
    Console.WriteLine("3. What to take from this");
    Console.WriteLine();
    Console.WriteLine("   THE PORT WAS NOT WRONG. Every line of v2 is a correct translation of");
    Console.WriteLine("   the controller. What was lost is not in either file - it is a");
    Console.WriteLine("   behaviour that [ApiController] contributed and that has no");
    Console.WriteLine("   representation in the code being ported.");
    Console.WriteLine();
    Console.WriteLine("   That generalises past this pair of styles: ANY MIGRATION BETWEEN TWO");
    Console.WriteLine("   FRAMEWORKS LOSES WHATEVER THE OLD ONE DID BY DEFAULT AND THE NEW ONE");
    Console.WriteLine("   DOES NOT. The diff cannot show it, and a code review of the diff");
    Console.WriteLine("   cannot catch it.");
    Console.WriteLine();
    Console.WriteLine("   THE NUMBERS. Ledger takes about 400 payments an hour. If a tenth of");
    Console.WriteLine("   requests carry a validation error - a client bug, a bad form, a");
    Console.WriteLine("   retried stale request - that is roughly 40 an hour, or about 960 in");
    Console.WriteLine("   the day before somebody noticed.");
    Console.WriteLine();
    Console.WriteLine("   Each one is a row that has to be found and reversed. Negative amounts");
    Console.WriteLine("   are findable with a query. A currency code of POUNDS is findable. A");
    Console.WriteLine("   valid-looking amount that failed a business rule nobody encoded as an");
    Console.WriteLine("   annotation is not findable at all.");
    Console.WriteLine();
    Console.WriteLine("   HOW TO CATCH IT. Three things, in increasing order of value:");
    Console.WriteLine();
    Console.WriteLine("   1. A TEST PER REQUEST TYPE THAT SENDS AN INVALID BODY and asserts");
    Console.WriteLine("      400. It is three lines, it fails for v2, and it is the only thing");
    Console.WriteLine("      in this list that would have caught the port on the day.");
    Console.WriteLine();
    Console.WriteLine("   2. VALIDATION APPLIED TO A GROUP RATHER THAN AN ENDPOINT, so that");
    Console.WriteLine("      the question 'does this endpoint validate?' has one answer for");
    Console.WriteLine("      the whole group.");
    Console.WriteLine();
    Console.WriteLine("   3. A DATABASE CONSTRAINT. amount_minor > 0 and a currency foreign");
    Console.WriteLine("      key would have rejected all four bad rows regardless of which");
    Console.WriteLine("      framework was in front. Validation at the edge is a better error");
    Console.WriteLine("      message; the constraint is what makes the data true.");
    Console.WriteLine();
    Console.WriteLine("   The third is the one people skip because the first two feel like");
    Console.WriteLine("   enough. This incident is the argument that they are not: both of the");
    Console.WriteLine("   first two are things a change can silently remove, and a CHECK");
    Console.WriteLine("   constraint is not.");
}

// ---------------------------------------------------------------------------
enum Version
{
    Controller,
    PortedNaive,
    PortedManual,
    PortedFilter
}

record Result(string Label, int Accepted, int Rejected, int BadRows);

public sealed class CreatePayment
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public string Currency { get; set; } = "";
}

[ApiController]
[Route("/")]
public sealed class PaymentsController : ControllerBase
{
    private readonly List<CreatePayment> _ledger;

    public PaymentsController(List<CreatePayment> ledger) => _ledger = ledger;

    // No validation code. [ApiController] does it.
    [HttpPost("payments")]
    public IActionResult Create(CreatePayment body)
    {
        _ledger.Add(body);
        return Ok(new { accepted = body.AmountMinor });
    }
}
