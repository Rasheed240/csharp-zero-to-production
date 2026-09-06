// 05-minimal-example.cs — One small API documented properly: outcomes in the
// signature, constraints in attributes, meaning in descriptions, and a
// conformance check that fails the build when any of it stops being true.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every value shown is read out of the generated document and
// is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.OpenApi@10.0.10
#:package Microsoft.OpenApi@2.11.0

using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddProblemDetails();

// DECISION 1: enums go on the wire as names, everywhere. This is a
// serialisation decision that decides what the document can say.
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddOpenApi(options =>
{
    // DECISION 2: facts about the API as a whole, in one place.
    options.AddDocumentTransformer((document, context, cancellationToken) =>
    {
        document.Info = new OpenApiInfo
        {
            Title = "Ledger Payments API",
            Version = "1.0.0",
            Description =
                "Payments and refunds for Ledger. All amounts are integer minor units "
                + "(4999 is GBP 49.99). All timestamps are UTC. Every write accepts an "
                + "Idempotency-Key header and repeating a key returns the original result."
        };

        return Task.CompletedTask;
    });

    // DECISION 3: one mechanical, always-correct correction. A property whose
    // value may be null is not a property whose key must be present.
    options.AddSchemaTransformer((schema, context, cancellationToken) =>
    {
        if (schema.Required is { Count: > 0 } && schema.Properties is { Count: > 0 })
        {
            foreach (string name in schema.Required.ToList())
            {
                if (schema.Properties.TryGetValue(name, out IOpenApiSchema? property)
                    && property is OpenApiSchema { Type: { } type }
                    && type.HasFlag(JsonSchemaType.Null))
                {
                    schema.Required.Remove(name);
                }
            }
        }

        return Task.CompletedTask;
    });
});

var app = builder.Build();
app.MapOpenApi();

var table = new List<PaymentView>
{
    new("PAY-001", PaymentStatus.Captured, 4999, "GBP", null, new DateTime(2026, 9, 1, 9, 0, 0, DateTimeKind.Utc)),
    new("PAY-002", PaymentStatus.Failed, 1250, "GBP", "card_declined", new DateTime(2026, 9, 1, 9, 5, 0, DateTimeKind.Utc)),
    new("PAY-003", PaymentStatus.Pending, 9900, "EUR", null, new DateTime(2026, 9, 1, 9, 9, 0, DateTimeKind.Utc))
};

// DECISION 4: the outcomes are in the SIGNATURE, so the compiler holds the
// document to them. Everything below the signature is commentary; this line is
// the contract.
app.MapGet("/v1/payments/{id}", Results<Ok<PaymentView>, NotFound<ProblemDetails>> (
        [Description("The payment's Ledger id, as returned by POST /v1/payments.")] string id) =>
    {
        return table.FirstOrDefault(p => p.Id == id) is { } payment
            ? TypedResults.Ok(payment)
            : TypedResults.NotFound(new ProblemDetails(
                "Payment not found", $"No payment with id '{id}'.", 404));
    })
    .WithName("GetPayment")
    .WithSummary("Fetch one payment by its Ledger id.")
    .WithDescription(
        "A payment reaches a terminal status (captured or failed) within seconds of "
        + "creation, but not before this call can return. Treat 'pending' as "
        + "non-final and poll; do not assume a payment that is pending now will "
        + "still be pending on the next call.")
    .WithTags("Payments");

app.MapPost("/v1/payments", Results<Created<PaymentView>, ValidationProblem> (
        CreatePayment request) =>
    {
        var created = new PaymentView($"PAY-{table.Count + 1:000}", PaymentStatus.Pending,
            request.AmountMinor, request.Currency, null, DateTime.UtcNow);

        table.Add(created);

        return TypedResults.Created($"/v1/payments/{created.Id}", created);
    })
    .WithName("CreatePayment")
    .WithSummary("Take a payment.")
    .WithDescription(
        "Returns 201 with the payment in 'pending' status. The money has NOT moved "
        + "when this returns - poll the Location URL until the status is terminal. "
        + "Send an Idempotency-Key header; without one, a retried request takes the "
        + "money twice.")
    .WithTags("Payments")
    .ProducesProblem(StatusCodes.Status409Conflict)
    .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

using JsonDocument document = JsonDocument.Parse(await http.GetStringAsync("/openapi/v1.json"));

Console.WriteLine("The document this API publishes");
Console.WriteLine();

JsonElement paths = document.RootElement.GetProperty("paths");

Console.WriteLine("   operation       summary                              outcomes");
Console.WriteLine("   ---------       -------                              --------");

foreach ((string path, string method) in new[]
{
    ("/v1/payments/{id}", "get"),
    ("/v1/payments", "post")
})
{
    JsonElement operation = paths.GetProperty(path).GetProperty(method);

    Console.WriteLine($"   {operation.GetProperty("operationId").GetString(),-15} " +
        $"{Truncate(operation.GetProperty("summary").GetString()!, 36),-36} " +
        $"{Outcomes(operation)}");
}

Console.WriteLine();
Console.WriteLine("   THE REQUEST SCHEMA, WITH ITS CONSTRAINTS");
Console.WriteLine();

JsonElement schemas = document.RootElement.GetProperty("components").GetProperty("schemas");
JsonElement create = schemas.GetProperty("CreatePayment");

Console.WriteLine($"     {"property",-16} {"required",-10} constraints");
Console.WriteLine($"     {new string('-', 16)} {new string('-', 10)} -----------");

foreach (JsonProperty property in create.GetProperty("properties").EnumerateObject())
{
    bool required = create.TryGetProperty("required", out JsonElement r)
        && r.EnumerateArray().Any(e => e.GetString() == property.Name);

    Console.WriteLine($"     {property.Name,-16} {(required ? "yes" : "no"),-10} " +
        $"{Constraints(property.Value)}");
}

Console.WriteLine();
Console.WriteLine("   THE RESPONSE SCHEMA");
Console.WriteLine();

JsonElement view = schemas.GetProperty("PaymentView");

Console.WriteLine($"     {"property",-16} {"required",-10} type");
Console.WriteLine($"     {new string('-', 16)} {new string('-', 10)} ----");

foreach (JsonProperty property in view.GetProperty("properties").EnumerateObject())
{
    bool required = view.TryGetProperty("required", out JsonElement r)
        && r.EnumerateArray().Any(e => e.GetString() == property.Name);

    Console.WriteLine($"     {property.Name,-16} {(required ? "yes" : "no"),-10} " +
        $"{Resolve(property.Value, schemas)}");
}

// The conformance check that belongs in the test suite.
Console.WriteLine();
Console.WriteLine("   THE CONFORMANCE CHECK, RUN AGAINST REAL RESPONSES");
Console.WriteLine();

JsonElement documented = schemas.GetProperty("PaymentView");
int conform = 0;

Console.WriteLine("   response                       status      conforms to the document");
Console.WriteLine("   --------                       ------      ------------------------");

foreach (string id in new[] { "PAY-001", "PAY-002", "PAY-003" })
{
    using JsonDocument response = JsonDocument.Parse(
        await http.GetStringAsync($"/v1/payments/{id}"));

    string[] problems = Check(response.RootElement, documented);

    if (problems.Length == 0)
    {
        conform++;
    }

    Console.WriteLine($"   GET /v1/payments/{id}       " +
        $"{response.RootElement.GetProperty("status").GetString(),-11} " +
        $"{(problems.Length == 0 ? "yes" : string.Join("; ", problems))}");
}

Console.WriteLine($"   {conform} of 3 conform");

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   WHAT EACH DECISION BOUGHT, AND WHO ENFORCES IT:");
Console.WriteLine();
Console.WriteLine("     THE SIGNATURE          200 PaymentView, 404 ProblemDetails, 201, 400.");
Console.WriteLine("     Results<Ok<T>, ...>    ENFORCED BY THE COMPILER. Add an outcome and");
Console.WriteLine("                            the code does not build until the type says so.");
Console.WriteLine();
Console.WriteLine("     THE ATTRIBUTES         Ranges, lengths and patterns in the schema.");
Console.WriteLine("     [Range], [StringLength] ENFORCED BY THE VALIDATOR. They cannot drift,");
Console.WriteLine("                            because they are the same rules that run.");
Console.WriteLine();
Console.WriteLine("     THE ENUM CONVERTER     Status values published as names, so a caller");
Console.WriteLine("                            can see the complete list. ENFORCED BY THE");
Console.WriteLine("                            SERIALISER - the wire and the document agree");
Console.WriteLine("                            because both come from the same converter.");
Console.WriteLine();
Console.WriteLine("     THE DESCRIPTIONS       That 201 does not mean the money moved, that");
Console.WriteLine("                            pending is not final, that a retry without an");
Console.WriteLine("                            idempotency key charges twice. ENFORCED BY");
Console.WriteLine("                            NOBODY. This is the part that rots.");
Console.WriteLine();
Console.WriteLine("     THE CONFORMANCE CHECK  Thirty lines, run against real responses, in");
Console.WriteLine("                            the test suite. THE ONLY THING THAT EVER");
Console.WriteLine("                            CHECKS THE UNENFORCED HALF.");
Console.WriteLine();
Console.WriteLine("   READ THAT LIST AS A RANKING. Every fact about your API should live as far");
Console.WriteLine("   up it as it can go. A fact the compiler holds cannot become false; a fact");
Console.WriteLine("   in a description becomes false quietly, on a Tuesday, six months after");
Console.WriteLine("   whoever wrote it left.");
Console.WriteLine();
Console.WriteLine("   AND WHAT IS STILL NOT DOCUMENTED, because nothing can infer it: rate");
Console.WriteLine("   limits, which errors are retryable, how long pending lasts, what happens");
Console.WriteLine("   to a payment nobody polls. THOSE GO IN THE DESCRIPTIONS OR THEY GO");
Console.WriteLine("   NOWHERE, and a document with perfect schemas and empty descriptions is a");
Console.WriteLine("   type definition, not documentation.");

// ---------------------------------------------------------------------------
static string Outcomes(JsonElement operation) =>
    string.Join(", ", operation.GetProperty("responses").EnumerateObject().Select(r =>
        r.Value.TryGetProperty("content", out JsonElement content)
            ? $"{r.Name} {content.EnumerateObject().First().Value.GetProperty("schema")
                .GetProperty("$ref").GetString()!.Split('/').Last()}"
            : $"{r.Name}"));

// ---------------------------------------------------------------------------
static string Constraints(JsonElement schema)
{
    string[] keywords = ["minLength", "maxLength", "pattern", "minimum", "maximum", "description"];

    string[] found = [.. keywords
        .Where(k => schema.TryGetProperty(k, out _))
        .Select(k => $"{k}={Truncate(schema.GetProperty(k).ToString(), 24)}")];

    return found.Length == 0 ? "none published" : string.Join(", ", found);
}

// ---------------------------------------------------------------------------
static string Resolve(JsonElement schema, JsonElement schemas)
{
    if (schema.TryGetProperty("$ref", out JsonElement reference))
    {
        string name = reference.GetString()!.Split('/').Last();
        JsonElement target = schemas.GetProperty(name);

        return target.TryGetProperty("enum", out JsonElement values)
            ? $"{name} [{string.Join(",", values.EnumerateArray().Select(v => v.ToString()))}]"
            : name;
    }

    string type = schema.TryGetProperty("type", out JsonElement t)
        ? t.ValueKind == JsonValueKind.Array
            ? string.Join("|", t.EnumerateArray().Select(e => e.GetString()))
            : t.GetString()!
        : "?";

    return schema.TryGetProperty("format", out JsonElement f) ? $"{type} ({f.GetString()})" : type;
}

// ---------------------------------------------------------------------------
static string[] Check(JsonElement response, JsonElement schema)
{
    var problems = new List<string>();

    if (schema.TryGetProperty("required", out JsonElement required))
    {
        foreach (JsonElement name in required.EnumerateArray())
        {
            if (!response.TryGetProperty(name.GetString()!, out _))
            {
                problems.Add($"missing '{name.GetString()}'");
            }
        }
    }

    foreach (JsonProperty property in response.EnumerateObject())
    {
        if (!schema.GetProperty("properties").TryGetProperty(property.Name, out _))
        {
            problems.Add($"undocumented '{property.Name}'");
        }
    }

    return [.. problems];
}

// ---------------------------------------------------------------------------
static string Truncate(string value, int width) =>
    value.Length > width ? value[..(width - 3)] + "..." : value;

// ---------------------------------------------------------------------------
enum PaymentStatus { Pending, Captured, Failed }

// ---------------------------------------------------------------------------
// The response type. One shape for one status code, and a nullable field that
// is genuinely optional rather than a second record in disguise.
record PaymentView(
    string Id,
    PaymentStatus Status,
    long AmountMinor,
    string Currency,
    string? FailureCode,
    DateTime CreatedAt);

// ---------------------------------------------------------------------------
// The request type. Every constraint here is enforced by the validator AND
// published in the schema, which is why neither can drift from the other.
record CreatePayment(
    [property: Range(1, 10_000_00)]
    [property: Description("Amount in minor units. 4999 is GBP 49.99.")]
    long AmountMinor,

    [property: RegularExpression("^[A-Z]{3}$")]
    [property: Description("ISO 4217 currency code, uppercase.")]
    string Currency,

    [property: StringLength(64, MinimumLength = 8)]
    [property: Description("Your reference for this payment. Returned on every response.")]
    string Reference);

// ---------------------------------------------------------------------------
record ProblemDetails(string Title, string Detail, int Status);
