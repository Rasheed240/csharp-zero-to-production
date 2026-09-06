// 03-production.cs — A client renames one JSON field and Ledger records 1,400
// payments of zero pounds, every one of them a 200.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every status code and stored value here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

TheIncident();
await FourVersions();
WhatToTake();

// What the updated client actually sends: the field renamed, everything else
// identical and correct.
static (string Label, string Json)[] Requests() =>
[
    ("old client", """{"amountMinor":123450,"currency":"GBP"}"""),
    ("new client", """{"amount_minor":123450,"currency":"GBP"}"""),
    ("new client", """{"amount_minor":99900,"currency":"GBP"}"""),
    ("new client", """{"amount_minor":250000,"currency":"GBP"}""")
];

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   Ledger's mobile client ships a release. Part of it is a move to a");
    Console.WriteLine("   different JSON library, configured with a snake_case naming policy -");
    Console.WriteLine("   a tidy-up nobody thought was a contract change.");
    Console.WriteLine();
    Console.WriteLine("   The field that was amountMinor is now amount_minor.");
    Console.WriteLine();
    Console.WriteLine("   Every request still returns 201. The client still shows a success");
    Console.WriteLine("   screen. The server-side request rate, error rate and latency are all");
    Console.WriteLine("   unchanged, because nothing failed.");
    Console.WriteLine();
    Console.WriteLine("   Support notices four days later: a merchant's dashboard is full of");
    Console.WriteLine("   payments of GBP 0.00.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task FourVersions()
{
    Console.WriteLine("2. Four versions, the same four requests");
    Console.WriteLine();

    Result naive = await RunAsync("v1  a plain settable class", Version.Naive);
    Result validated = await RunAsync("v2  plus [Range(1, ...)]", Version.Validated);
    Result required = await RunAsync("v3  required members", Version.Required);
    Result strict = await RunAsync("v4  unknown members disallowed", Version.Strict);

    Console.WriteLine("   version                            201   400   zero-value rows");
    Console.WriteLine("   -------                            ---   ---   ---------------");
    foreach (Result r in new[] { naive, validated, required, strict })
    {
        Console.WriteLine($"   {r.Label,-32}  {r.Created,3}   {r.Rejected,3}   {r.ZeroRows,15}");
    }

    Console.WriteLine();
    Console.WriteLine("   V1 IS THE INCIDENT. Four 201s, three rows of zero. The renamed");
    Console.WriteLine("   property did not match anything on the type, so it was IGNORED and");
    Console.WriteLine("   AmountMinor kept its default of 0.");
    Console.WriteLine();
    Console.WriteLine("   Nothing anywhere records that a property was skipped. The request");
    Console.WriteLine("   was valid JSON, the body deserialised, and the handler ran normally.");
    Console.WriteLine();
    Console.WriteLine("   V2 ADDS ONE ATTRIBUTE and the incident stops. [Range(1, 1_000_000)]");
    Console.WriteLine("   turns a zero into a 400, because zero is outside the range - and");
    Console.WriteLine("   that is the general shape of why validation catches this class of");
    Console.WriteLine("   bug: THE DEFAULT VALUE OF A MISSING FIELD IS USUALLY INVALID.");
    Console.WriteLine();
    Console.WriteLine("   An amount of 0, a name of null, a date of 0001-01-01, an enum of");
    Console.WriteLine("   whatever happens to be 0. Requiring the value to be sensible");
    Console.WriteLine("   incidentally catches the value never having arrived.");
    Console.WriteLine();
    Console.WriteLine("   V3 USES required MEMBERS, so the deserialiser itself refuses a body");
    Console.WriteLine("   that omits the property. This is stronger than validation in one");
    Console.WriteLine("   specific way: it catches a missing field even when the default would");
    Console.WriteLine("   have been VALID - a boolean that should have been true, an optional");
    Console.WriteLine("   count where 0 is a legitimate answer.");
    Console.WriteLine();
    Console.WriteLine("   V4 REJECTS UNKNOWN PROPERTIES. It is the only one that catches the");
    Console.WriteLine("   error itself rather than its consequence - the body never");
    Console.WriteLine("   deserialises at all, so nothing reaches the handler.");
    Console.WriteLine();
    Console.WriteLine("   AND IT TELLS THE CLIENT NOTHING. Measured: the response is a bare");
    Console.WriteLine("   400 with an EMPTY BODY. The server knows exactly which property it");
    Console.WriteLine("   could not map and does not say so.");
    Console.WriteLine();
    Console.WriteLine("     strict=False -> 200  {\"amountMinor\":0}");
    Console.WriteLine("     strict=True  -> 400  (empty)");
    Console.WriteLine();
    Console.WriteLine("   The detail is in the exception on the server side, which means it is");
    Console.WriteLine("   in your logs and not in the response. If you turn this on, add");
    Console.WriteLine("   AddProblemDetails and an exception handler as well, or you have");
    Console.WriteLine("   traded a silent wrong answer for an unexplained rejection.");
    Console.WriteLine();
    Console.WriteLine("   It is also the one with a real cost to clients, which is section 3.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<Result> RunAsync(string label, Version version)
{
    var ledger = new List<long>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton(ledger);

    if (version == Version.Strict)
    {
        builder.Services.ConfigureHttpJsonOptions(options =>
            options.SerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow);
    }

    var app = builder.Build();

    // One validation filter, so v2 and v3 differ only in the request type.
    var group = app.MapGroup("/").AddEndpointFilter(async (context, next) =>
    {
        if (version is Version.Validated or Version.Required or Version.Strict)
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
        }

        return await next(context);
    });

    switch (version)
    {
        case Version.Naive:
            group.MapPost("/payments", (LooseRequest body, List<long> store) =>
            {
                store.Add(body.AmountMinor);
                return Results.Created("/payments/1", new { amount = body.AmountMinor });
            });
            break;

        case Version.Validated:
            group.MapPost("/payments", (ValidatedRequest body, List<long> store) =>
            {
                store.Add(body.AmountMinor);
                return Results.Created("/payments/1", new { amount = body.AmountMinor });
            });
            break;

        default:
            group.MapPost("/payments", (StrictRequest body, List<long> store) =>
            {
                store.Add(body.AmountMinor);
                return Results.Created("/payments/1", new { amount = body.AmountMinor });
            });
            break;
    }

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    int created = 0;
    int rejected = 0;

    foreach ((string _, string json) in Requests())
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync("/payments", content);

        if (response.IsSuccessStatusCode)
        {
            created++;
        }
        else
        {
            rejected++;
        }
    }

    await app.StopAsync();
    return new Result(label, created, rejected, ledger.Count(a => a == 0));
}

// ---------------------------------------------------------------------------
static void WhatToTake()
{
    Console.WriteLine("3. What to take from this");
    Console.WriteLine();
    Console.WriteLine("   THE NUMBERS. Ledger takes about 400 payments an hour, and roughly a");
    Console.WriteLine("   third of them come from the mobile client. Over four days that is");
    Console.WriteLine("   about 1,400 payments recorded as zero.");
    Console.WriteLine();
    Console.WriteLine("   Every one returned 201. Every one appeared in the client's history.");
    Console.WriteLine("   None of them moved any money, and the merchants they belonged to");
    Console.WriteLine("   were owed the amounts nobody recorded.");
    Console.WriteLine();
    Console.WriteLine("   Reconstructing them meant asking the client team for their outbound");
    Console.WriteLine("   logs, because the server had no record of what had been sent - it");
    Console.WriteLine("   had recorded what it managed to bind.");
    Console.WriteLine();
    Console.WriteLine("   THE FOUR DEFENCES, AND WHAT EACH ACTUALLY BUYS:");
    Console.WriteLine();
    Console.WriteLine("   1. VALIDATION. Cheapest, and it catches this whenever the default is");
    Console.WriteLine("      invalid - which is most of the time. Add it first and add it to a");
    Console.WriteLine("      group so nothing can be added later without it.");
    Console.WriteLine();
    Console.WriteLine("   2. REQUIRED MEMBERS. Catches a missing field even when its default");
    Console.WriteLine("      would have been valid. Costs nothing at runtime and changes the");
    Console.WriteLine("      request type from 'a bag of optional properties' into a");
    Console.WriteLine("      contract.");
    Console.WriteLine();
    Console.WriteLine("   3. REJECTING UNKNOWN PROPERTIES. The only one that stops the wrong");
    Console.WriteLine("      data existing at all rather than catching it downstream - and,");
    Console.WriteLine("      measured above, it returns a bare 400 with no body, so pair it");
    Console.WriteLine("      with an exception handler or the caller learns nothing.");
    Console.WriteLine();
    Console.WriteLine("      The cost is real: it breaks any client that sends an");
    Console.WriteLine("      extra field, and clients do that - a debug flag, a field for a");
    Console.WriteLine("      newer version of your API, a serialiser that includes nulls.");
    Console.WriteLine();
    Console.WriteLine("      That permissiveness is deliberate in JSON: ignoring unknown");
    Console.WriteLine("      members is what lets a client add a field without breaking an");
    Console.WriteLine("      older server. Turning it off buys strictness and gives up forward");
    Console.WriteLine("      compatibility, so it suits an internal API with known clients and");
    Console.WriteLine("      suits a public one much less.");
    Console.WriteLine();
    Console.WriteLine("   4. A CONTRACT TEST. The client team runs your request types against");
    Console.WriteLine("      their serialiser, or you both generate from one OpenAPI document.");
    Console.WriteLine("      This is the only defence that catches the change BEFORE it ships,");
    Console.WriteLine("      and it is the one that needs agreement from somebody else.");
    Console.WriteLine();
    Console.WriteLine("   WHAT WOULD HAVE FOUND IT FASTER, once it had shipped: an alert on a");
    Console.WriteLine("   business quantity rather than a technical one. Error rate, latency");
    Console.WriteLine("   and throughput were all normal for four days. THE AVERAGE PAYMENT");
    Console.WriteLine("   AMOUNT WAS NOT.");
    Console.WriteLine();
    Console.WriteLine("   That is the transferable point. A binding failure produces valid");
    Console.WriteLine("   requests carrying wrong data, so it is invisible to every signal");
    Console.WriteLine("   that measures whether requests succeeded. The only monitoring that");
    Console.WriteLine("   sees it is monitoring that knows what the numbers should look like.");
}

// ---------------------------------------------------------------------------
enum Version
{
    Naive,
    Validated,
    Required,
    Strict
}

record Result(string Label, int Created, int Rejected, int ZeroRows);

// v1: every property optional, every default silently acceptable.
public sealed class LooseRequest
{
    public long AmountMinor { get; set; }

    public string? Currency { get; set; }
}

// v2: the same shape, with the value constrained.
public sealed class ValidatedRequest
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public string Currency { get; set; } = "";
}

// v3 and v4: the deserialiser itself refuses a body that omits these.
public sealed class StrictRequest
{
    [Range(1, 1_000_000)]
    public required long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public required string Currency { get; set; }
}
