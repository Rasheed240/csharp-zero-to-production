// 03-production.cs — Ledger adds line items to invoices. The validation filter
// was not changed, and it stopped covering half the request.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every status code and count here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;

TheIncident();
await ThreeVersions();
WhatToTake();

// The requests a real client sends once line items exist.
static (string Label, string Json)[] Requests() =>
[
    ("valid",
        """{"reference":"INV-1","lines":[{"description":"consulting","amountMinor":50000}]}"""),
    ("negative line",
        """{"reference":"INV-2","lines":[{"description":"discount","amountMinor":-2500}]}"""),
    ("line with no description",
        """{"reference":"INV-3","lines":[{"description":"","amountMinor":1000}]}"""),
    ("second line bad",
        """{"reference":"INV-4","lines":[{"description":"a","amountMinor":100},{"description":"b","amountMinor":0}]}"""),
    ("bad reference, good lines",
        """{"reference":"","lines":[{"description":"a","amountMinor":100}]}""")
];

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   Ledger's invoice API has validated its requests since it was written.");
    Console.WriteLine("   An endpoint filter runs Validator.TryValidateObject over every");
    Console.WriteLine("   argument and returns a ValidationProblem when anything fails. It has");
    Console.WriteLine("   worked for two years and there are tests for it.");
    Console.WriteLine();
    Console.WriteLine("   A new release adds LINE ITEMS. CreateInvoice grows a");
    Console.WriteLine("   List<InvoiceLine>, and InvoiceLine carries its own attributes -");
    Console.WriteLine("   a required description, an amount in range - written by somebody who");
    Console.WriteLine("   assumed they would be enforced the way every other attribute in the");
    Console.WriteLine("   codebase is.");
    Console.WriteLine();
    Console.WriteLine("   Nothing about the filter changed, because nothing about the filter");
    Console.WriteLine("   looked like it needed to.");
    Console.WriteLine();
    Console.WriteLine("   Three weeks later, finance asks why some invoices total less than");
    Console.WriteLine("   the sum of their lines.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ThreeVersions()
{
    Console.WriteLine("2. Three versions, the same five requests");
    Console.WriteLine();

    Result before = await RunAsync("v1  the filter, flat request type", Version.FlatType);
    Result after = await RunAsync("v2  the filter, lines added", Version.NestedType);
    Result fixed_ = await RunAsync("v3  built-in validation, lines", Version.BuiltIn);

    Console.WriteLine("   version                             accepted   rejected   bad rows");
    Console.WriteLine("   -------                             --------   --------   --------");
    foreach (Result r in new[] { before, after, fixed_ })
    {
        Console.WriteLine($"   {r.Label,-33}   {r.Accepted,8}   {r.Rejected,8}   {r.BadRows,8}");
    }

    Console.WriteLine();
    Console.WriteLine("   V1 IS THE OLD WORLD. The flat type has no lines, so the four");
    Console.WriteLine("   line-level bodies have nothing to fail on - and the one with a bad");
    Console.WriteLine("   REFERENCE is caught. One rejection out of five, and correct.");
    Console.WriteLine();
    Console.WriteLine("   V2 IS THE INCIDENT, AND LOOK AT THE FIRST TWO COLUMNS. They are");
    Console.WriteLine("   IDENTICAL to v1: four accepted, one rejected. From outside, the");
    Console.WriteLine("   validation behaved exactly as it always had.");
    Console.WriteLine();
    Console.WriteLine("   The only column that moved is the last one. Three of those four");
    Console.WriteLine("   accepted invoices carry a line that violates a rule the type states,");
    Console.WriteLine("   including one with a NEGATIVE amount - which is where the missing");
    Console.WriteLine("   money went.");
    Console.WriteLine();
    Console.WriteLine("   That is what made it so hard to notice. The filter was demonstrably");
    Console.WriteLine("   working: it rejected the bad reference, that day and every day. It");
    Console.WriteLine("   had stopped covering the half of the request that was new, and");
    Console.WriteLine("   nothing about its observable behaviour changed.");
    Console.WriteLine();
    Console.WriteLine("   V3 REPLACES THE FILTER with builder.Services.AddValidation(). All");
    Console.WriteLine("   four bad bodies rejected, with error keys naming the exact line:");
    Console.WriteLine("   Lines[0].AmountMinor, Lines[1].AmountMinor.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<Result> RunAsync(string label, Version version)
{
    var ledger = new List<CreateInvoice>();
    var flatLedger = new List<FlatInvoice>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();
    builder.Services.AddSingleton(ledger);
    builder.Services.AddSingleton(flatLedger);

    if (version == Version.BuiltIn)
    {
        builder.Services.AddValidation();
    }

    var app = builder.Build();
    app.UseStatusCodePages();

    if (version == Version.BuiltIn)
    {
        app.MapPost("/invoices", (CreateInvoice body, List<CreateInvoice> store) =>
        {
            store.Add(body);
            return Results.Ok(new { body.Reference });
        });
    }
    else
    {
        // The hand-rolled filter, unchanged between v1 and v2.
        var group = app.MapGroup("/").AddEndpointFilter(async (context, next) =>
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

        if (version == Version.FlatType)
        {
            group.MapPost("/invoices", (FlatInvoice body, List<FlatInvoice> store) =>
            {
                store.Add(body);
                return Results.Ok(new { body.Reference });
            });
        }
        else
        {
            group.MapPost("/invoices", (CreateInvoice body, List<CreateInvoice> store) =>
            {
                store.Add(body);
                return Results.Ok(new { body.Reference });
            });
        }
    }

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    int accepted = 0;
    int rejected = 0;

    foreach ((string _, string json) in Requests())
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync("/invoices", content);

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

    int badRows = version == Version.FlatType
        ? 0
        : ledger.Count(i => i.Lines.Any(l => l.AmountMinor < 1 || l.Description.Length == 0));

    return new Result(label, accepted, rejected, badRows);
}

// ---------------------------------------------------------------------------
static void WhatToTake()
{
    Console.WriteLine("3. What to take from this");
    Console.WriteLine();
    Console.WriteLine("   NOBODY MADE A MISTAKE. The filter was correct when written and is");
    Console.WriteLine("   still correct for what it does. The attributes on InvoiceLine are");
    Console.WriteLine("   correct. The tests written for the filter still pass, because they");
    Console.WriteLine("   were written against the flat request type that existed then.");
    Console.WriteLine();
    Console.WriteLine("   WHAT CHANGED IS THE SHAPE OF THE DATA, and the coverage of a tool");
    Console.WriteLine("   that had never been asked whether it handled that shape.");
    Console.WriteLine();
    Console.WriteLine("   THE NUMBERS. Ledger issues about 300 invoices a day, and roughly one");
    Console.WriteLine("   in fifty carried a line the rules should have rejected - a discount");
    Console.WriteLine("   entered as a negative amount rather than through the credit-note");
    Console.WriteLine("   flow, most often. Over three weeks that is about 125 invoices whose");
    Console.WriteLine("   total does not match the sum of their lines.");
    Console.WriteLine();
    Console.WriteLine("   Correcting them meant reissuing each one, because an invoice that has");
    Console.WriteLine("   been sent cannot be edited. The engineering fix was two lines.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL LESSON, which is the reason this incident is in this");
    Console.WriteLine("   module rather than a footnote: A VALIDATION MECHANISM HAS A REACH,");
    Console.WriteLine("   AND ITS REACH IS NOT VISIBLE AT THE PLACE YOU USE IT.");
    Console.WriteLine();
    Console.WriteLine("   The filter looks like it validates 'the request'. It validates one");
    Console.WriteLine("   object. Every attribute you write inside a nested type looks exactly");
    Console.WriteLine("   like one that will be enforced, and there is nothing in the type, the");
    Console.WriteLine("   filter or the endpoint to say otherwise.");
    Console.WriteLine();
    Console.WriteLine("   HOW TO CATCH IT:");
    Console.WriteLine();
    Console.WriteLine("   1. ONE TEST PER LEVEL OF NESTING. Send a body that is valid at the");
    Console.WriteLine("      top and invalid underneath, and assert 400. If your request types");
    Console.WriteLine("      have a nested object or a collection and that test does not exist,");
    Console.WriteLine("      you do not know whether those rules run.");
    Console.WriteLine();
    Console.WriteLine("   2. WRITE THAT TEST WHEN THE NESTING IS ADDED, not when the filter is");
    Console.WriteLine("      written. The filter's own tests cannot cover a shape that did not");
    Console.WriteLine("      exist yet, which is precisely why they kept passing.");
    Console.WriteLine();
    Console.WriteLine("   3. A DATABASE CHECK CONSTRAINT on the line amount. It would have");
    Console.WriteLine("      rejected every one of the 125, and it is the only layer here that");
    Console.WriteLine("      a change to the request type cannot silently bypass.");
    Console.WriteLine();
    Console.WriteLine("   And the reporting check that would have found it in a day rather");
    Console.WriteLine("   than three weeks: ASSERT THAT THE INVOICE TOTAL EQUALS THE SUM OF ITS");
    Console.WriteLine("   LINES. Every request succeeded, so no technical signal moved - the");
    Console.WriteLine("   only thing that was wrong was an arithmetic relationship in the data.");
}

// ---------------------------------------------------------------------------
enum Version
{
    FlatType,
    NestedType,
    BuiltIn
}

record Result(string Label, int Accepted, int Rejected, int BadRows);

// The request type as it was: flat, and validated correctly by the filter.
// Only a reference - there were no line items yet.
public sealed class FlatInvoice
{
    [Required]
    [MinLength(1)]
    public string Reference { get; set; } = "";
}

// The request type after line items were added.
public sealed class CreateInvoice
{
    [Required]
    [MinLength(1)]
    public string Reference { get; set; } = "";

    public List<InvoiceLine> Lines { get; set; } = [];
}

public sealed class InvoiceLine
{
    [Required]
    [MinLength(1)]
    public string Description { get; set; } = "";

    [Range(1, 10_000_000)]
    public long AmountMinor { get; set; }
}
