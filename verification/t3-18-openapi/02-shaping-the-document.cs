// 02-shaping-the-document.cs — Telling the generator the things it could not
// work out, in the order you should reach for them.
//
// Run:  dotnet run 02-shaping-the-document.cs -c Release
//
// EXACT vs RATIO: every value shown is read out of the generated document and
// is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.OpenApi@10.0.10
#:package Microsoft.OpenApi@2.11.0

using System.Text.Json;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

Console.WriteLine("Shaping the document");
Console.WriteLine();

await TheTypeSystemFirst();
await ThenMetadata();
await ThenTransformers();
await WhereEachBelongs();

// ---------------------------------------------------------------------------
static async Task TheTypeSystemFirst()
{
    Console.WriteLine("1. The cheapest fix is a change of return type");
    Console.WriteLine();
    Console.WriteLine("   Before reaching for any OpenAPI API at all, look at what the handler");
    Console.WriteLine("   says it returns. Two endpoints, same behaviour, different signatures:");
    Console.WriteLine();

    JsonDocument document = await Document(app =>
    {
        app.MapGet("/before/{id}", (string id) =>
            id == "PAY-001"
                ? Results.Ok(new Payment("PAY-001", "captured", 4999, "GBP"))
                : Results.NotFound());

        app.MapGet("/after/{id}", Results<Ok<Payment>, NotFound<ProblemDetails>> (string id) =>
            id == "PAY-001"
                ? TypedResults.Ok(new Payment("PAY-001", "captured", 4999, "GBP"))
                : TypedResults.NotFound(new ProblemDetails("Not found", "No such payment.")));
    });

    Console.WriteLine("   endpoint   documented outcomes");
    Console.WriteLine("   --------   -------------------");
    Console.WriteLine($"   /before    {Outcomes(document, "/before/{id}")}");
    Console.WriteLine($"   /after     {Outcomes(document, "/after/{id}")}");

    Console.WriteLine();
    Console.WriteLine("   NOTHING OPENAPI-SPECIFIC WAS ADDED. The second endpoint's signature");
    Console.WriteLine("   states its outcomes, so the document states them.");
    Console.WriteLine();
    Console.WriteLine("   AND THE SIGNATURE IS ENFORCED. Add a third outcome to that handler and");
    Console.WriteLine("   it does not compile until the union changes, so the document cannot");
    Console.WriteLine("   fall behind the code. NO OTHER TECHNIQUE IN THIS FILE HAS THAT");
    Console.WriteLine("   PROPERTY - everything below is a claim nobody checks.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS WHY IT COMES FIRST. Reach for metadata only for what the type");
    Console.WriteLine("   system genuinely cannot express.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ThenMetadata()
{
    Console.WriteLine("2. Metadata: the things a type cannot say");
    Console.WriteLine();

    JsonDocument document = await Document(app =>
    {
        app.MapPost("/v1/refunds", Results<Created<Refund>, ValidationProblem> (RefundRequest request) =>
                TypedResults.Created($"/v1/refunds/RF-1", new Refund("RF-1", request.PaymentId, request.AmountMinor)))
            .WithName("CreateRefund")
            .WithSummary("Refund part or all of a captured payment.")
            .WithDescription(
                "Refunds are asynchronous. A 201 means the refund was accepted, not that "
                + "the money has moved; poll the returned resource until its status leaves "
                + "'pending'. Refunding more than the captured amount returns 422.")
            .WithTags("Refunds")
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
    });

    JsonElement operation = document.RootElement
        .GetProperty("paths").GetProperty("/v1/refunds").GetProperty("post");

    Console.WriteLine($"   operationId   {Text(operation, "operationId")}");
    Console.WriteLine($"   summary       {Text(operation, "summary")}");
    Console.WriteLine($"   tags          {(operation.TryGetProperty("tags", out JsonElement tags) ? string.Join(", ", tags.EnumerateArray().Select(t => t.GetString())) : "-")}");
    Console.WriteLine($"   responses     {Outcomes(document, "/v1/refunds", "post")}");
    Console.WriteLine();
    Console.WriteLine("   description:");
    Console.WriteLine();

    foreach (string line in Wrap(Text(operation, "description"), 66))
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE DESCRIPTION IS THE MOST VALUABLE FIELD IN THE DOCUMENT AND THE ONE");
    Console.WriteLine("   MOST OFTEN LEFT EMPTY. Read what it says: that a 201 does not mean the");
    Console.WriteLine("   money moved, that the caller must poll, and what over-refunding does.");
    Console.WriteLine("   NONE OF THAT IS DERIVABLE FROM ANY TYPE, in any language, by any");
    Console.WriteLine("   generator. It is the part only a person can write, which is why a");
    Console.WriteLine("   perfectly generated document with no descriptions is still a bad one.");
    Console.WriteLine();
    Console.WriteLine("   WithName SETS operationId, WHICH IS NOT COSMETIC. Client generators");
    Console.WriteLine("   turn it into the method name, so leaving it to be derived means your");
    Console.WriteLine("   callers' code changes when you rename a route. SET IT DELIBERATELY AND");
    Console.WriteLine("   TREAT IT AS PART OF THE CONTRACT.");
    Console.WriteLine();
    Console.WriteLine("   AND ProducesProblem IS HOW ERRORS GET DOCUMENTED. A 409 and a 422 that");
    Console.WriteLine("   no signature mentions are still real outcomes; without these lines the");
    Console.WriteLine("   document promises they cannot happen.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ThenTransformers()
{
    Console.WriteLine("3. Transformers: changing the document itself");
    Console.WriteLine();
    Console.WriteLine("   Metadata is per-endpoint. Some facts are about the whole API, and some");
    Console.WriteLine("   corrections need to apply to every schema at once. Transformers run");
    Console.WriteLine("   over the finished document before it is served.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddOpenApi(options =>
    {
        // DOCUMENT transformer: facts about the API as a whole.
        options.AddDocumentTransformer((document, context, cancellationToken) =>
        {
            document.Info = new OpenApiInfo
            {
                Title = "Ledger Payments API",
                Version = "1.0.0",
                Description = "Payments, refunds and settlement for Ledger.",
                Contact = new OpenApiContact { Name = "Payments team", Email = "payments@example.com" }
            };

            return Task.CompletedTask;
        });

        // OPERATION transformer: something true of every endpoint.
        options.AddOperationTransformer((operation, context, cancellationToken) =>
        {
            operation.Parameters ??= [];
            operation.Parameters.Add(new OpenApiParameter
            {
                Name = "X-Correlation-Id",
                In = ParameterLocation.Header,
                Required = false,
                Description = "Echoed back on the response and included in our logs.",
                Schema = new OpenApiSchema { Type = JsonSchemaType.String }
            });

            return Task.CompletedTask;
        });

        // SCHEMA transformer: a correction applied wherever the shape occurs.
        options.AddSchemaTransformer((schema, context, cancellationToken) =>
        {
            // The nullable-and-required problem from 00-smallest.cs, fixed once
            // for every type rather than annotated one property at a time.
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

    app.MapGet("/v1/payments/{id}", (string id) =>
        new PaymentWithNullable("PAY-001", "captured", 4999, null));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    using JsonDocument document = JsonDocument.Parse(
        await http.GetStringAsync("/openapi/v1.json"));

    await app.StopAsync();
    await app.DisposeAsync();

    JsonElement info = document.RootElement.GetProperty("info");

    Console.WriteLine($"   info.title     {Text(info, "title")}");
    Console.WriteLine($"   info.contact   {Text(info.GetProperty("contact"), "email")}");

    JsonElement parameters = document.RootElement.GetProperty("paths")
        .GetProperty("/v1/payments/{id}").GetProperty("get").GetProperty("parameters");

    Console.WriteLine($"   parameters     {string.Join(", ", parameters.EnumerateArray()
        .Select(p => $"{p.GetProperty("name").GetString()} ({p.GetProperty("in").GetString()})"))}");

    JsonElement schema = document.RootElement.GetProperty("components")
        .GetProperty("schemas").GetProperty("PaymentWithNullable");

    Console.WriteLine($"   required       {string.Join(", ", schema.GetProperty("required")
        .EnumerateArray().Select(e => e.GetString()))}");

    Console.WriteLine();
    Console.WriteLine("   THE HEADER APPEARED ON AN ENDPOINT THAT NEVER MENTIONED IT, and");
    Console.WriteLine("   failureReason IS NO LONGER REQUIRED even though nothing about the");
    Console.WriteLine("   record changed. Both corrections were made once and apply everywhere,");
    Console.WriteLine("   including to endpoints written next year.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE ARGUMENT FOR TRANSFORMERS AND ALSO THE WARNING ABOUT THEM.");
    Console.WriteLine("   A schema transformer is a rule applied to code that has not been");
    Console.WriteLine("   written yet, by someone who will not know it exists. Keep them few,");
    Console.WriteLine("   keep them mechanical, and prefer a rule that is obviously right in all");
    Console.WriteLine("   cases - 'a nullable property is not required' - over a rule that");
    Console.WriteLine("   happens to fix today's problem.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhereEachBelongs()
{
    Console.WriteLine("4. Which tool for which gap");
    Console.WriteLine();
    Console.WriteLine("   In the order to reach for them, because each is cheaper and safer than");
    Console.WriteLine("   the one below it:");
    Console.WriteLine();
    Console.WriteLine("     THE RETURN TYPE        Status codes and response bodies.");
    Console.WriteLine("     Results<Ok<T>, ...>    THE ONLY ONE THE COMPILER ENFORCES. If the");
    Console.WriteLine("                            type can say it, say it there.");
    Console.WriteLine();
    Console.WriteLine("     THE PARAMETER TYPES    Where a value comes from, and whether it is");
    Console.WriteLine("                            required. Already decided by binding.");
    Console.WriteLine();
    Console.WriteLine("     ATTRIBUTES ON THE      Lengths, ranges, patterns - the constraints");
    Console.WriteLine("     REQUEST TYPE           JSON Schema has words for. These also");
    Console.WriteLine("                            actually validate, so they cannot drift.");
    Console.WriteLine();
    Console.WriteLine("     .WithSummary /         Everything a person needs and no type can");
    Console.WriteLine("     .WithDescription       hold: semantics, ordering, what a status");
    Console.WriteLine("                            code MEANS, what the caller should do next.");
    Console.WriteLine();
    Console.WriteLine("     .ProducesProblem       Failure outcomes not in the signature.");
    Console.WriteLine();
    Console.WriteLine("     OPERATION TRANSFORMER  Something true of every endpoint, applied");
    Console.WriteLine("                            once - a common header, a security scheme.");
    Console.WriteLine();
    Console.WriteLine("     SCHEMA TRANSFORMER     A systematic correction to how types map.");
    Console.WriteLine("                            Powerful and invisible; use sparingly.");
    Console.WriteLine();
    Console.WriteLine("     DOCUMENT TRANSFORMER   Facts about the API as a whole: title,");
    Console.WriteLine("                            contact, servers, top-level security.");
    Console.WriteLine();
    Console.WriteLine("   THE PATTERN IN THAT LIST IS WORTH SAYING OUT LOUD: THE HIGHER ENTRIES");
    Console.WriteLine("   ARE ENFORCED BY SOMETHING AND THE LOWER ONES ARE NOT. A return type is");
    Console.WriteLine("   checked by the compiler. A [Range] is checked by the validator. A");
    Console.WriteLine("   .WithDescription is checked by nobody, and a transformer is checked by");
    Console.WriteLine("   nobody twice over. THE FURTHER DOWN THE LIST A FACT LIVES, THE MORE");
    Console.WriteLine("   LIKELY IT IS TO BE FALSE IN A YEAR - which is what the next file is");
    Console.WriteLine("   about.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<JsonDocument> Document(Action<WebApplication> configure)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddOpenApi();

    var app = builder.Build();
    app.MapOpenApi();

    configure(app);

    await app.StartAsync();

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    string json = await http.GetStringAsync("/openapi/v1.json");

    await app.StopAsync();
    await app.DisposeAsync();

    return JsonDocument.Parse(json);
}

// ---------------------------------------------------------------------------
static string Outcomes(JsonDocument document, string path, string method = "get")
{
    JsonElement responses = document.RootElement
        .GetProperty("paths").GetProperty(path).GetProperty(method).GetProperty("responses");

    return string.Join(", ", responses.EnumerateObject().Select(r =>
    {
        if (!r.Value.TryGetProperty("content", out JsonElement content))
        {
            return $"{r.Name} (no body)";
        }

        JsonElement schema = content.EnumerateObject().First().Value.GetProperty("schema");

        return schema.TryGetProperty("$ref", out JsonElement reference)
            ? $"{r.Name} {reference.GetString()!.Split('/').Last()}"
            : $"{r.Name} (untyped)";
    }));
}

// ---------------------------------------------------------------------------
static string Text(JsonElement element, string name) =>
    element.TryGetProperty(name, out JsonElement value) ? value.GetString() ?? "-" : "-";

// ---------------------------------------------------------------------------
static List<string> Wrap(string text, int width)
{
    var lines = new List<string>();
    var current = "";

    foreach (string word in text.Split(' '))
    {
        if (current.Length + word.Length + 1 > width)
        {
            lines.Add(current);
            current = word;
        }
        else
        {
            current = current.Length == 0 ? word : $"{current} {word}";
        }
    }

    if (current.Length > 0)
    {
        lines.Add(current);
    }

    return lines;
}

// ---------------------------------------------------------------------------
record Payment(string Id, string Status, long AmountMinor, string Currency);

record PaymentWithNullable(string Id, string Status, long AmountMinor, string? FailureReason);

record ProblemDetails(string Title, string Detail);

record RefundRequest(string PaymentId, long AmountMinor);

record Refund(string Id, string PaymentId, long AmountMinor);
