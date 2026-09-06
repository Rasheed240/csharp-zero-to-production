// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// read out of a generated document rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every value shown is read out of a generated document and is
// deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.OpenApi@10.0.10
#:package Microsoft.OpenApi@2.11.0

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.OpenApi;

await One();
await Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static async Task One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the partner who sent 47");
    Console.WriteLine();
    Console.WriteLine("   A payments API takes a status filter typed as an enum. A partner's");
    Console.WriteLine("   integration sends 47 and gets a 400 they say is undocumented. The team");
    Console.WriteLine("   insists the enum is right there in the schema.");
    Console.WriteLine();
    Console.WriteLine("   Who is right?");
    Console.WriteLine();

    JsonDocument document = await Document(app =>
    {
        app.MapPost("/plain", (PlainFilter filter) => filter);
        app.MapPost("/converted", (ConvertedFilter filter) => filter);
    });

    JsonElement schemas = document.RootElement.GetProperty("components").GetProperty("schemas");

    Console.WriteLine("   the enum on the request type              published as");
    Console.WriteLine("   ----------------------------              ------------");
    Console.WriteLine($"   enum Status {{ Pending, Captured, Failed }}  " +
        $"{Describe(schemas, schemas.GetProperty("PlainFilter"), "status")}");
    Console.WriteLine($"   the same, + JsonStringEnumConverter        " +
        $"{Describe(schemas, schemas.GetProperty("ConvertedFilter"), "status")}");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE PARTNER IS RIGHT. The first schema says 'integer' and");
    Console.WriteLine("   stops. Not which integers - there is no enum list at all. A caller");
    Console.WriteLine("   reading that document is told to send a number, and 47 is a number.");
    Console.WriteLine();
    Console.WriteLine("   THE DOCUMENT IS NOT AT FAULT EITHER. An int-backed enum genuinely is an");
    Console.WriteLine("   undocumented integer on the wire; the generator did not lose the");
    Console.WriteLine("   information, the serialisation choice never put it there. The team is");
    Console.WriteLine("   reading the C# and believing they are reading the contract.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS A SERIALISATION DECISION, NOT A DOCUMENTATION ONE: send");
    Console.WriteLine("   string enum values, and the names appear in the schema as the complete");
    Console.WriteLine("   list of what is allowed. Configure it once globally rather than per");
    Console.WriteLine("   type:");
    Console.WriteLine();
    Console.WriteLine("     builder.Services.ConfigureHttpJsonOptions(o =>");
    Console.WriteLine("         o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));");
    Console.WriteLine();
    Console.WriteLine("   AND THE WIDER LESSON: NUMERIC ENUM VALUES ARE A BAD API CONTRACT quite");
    Console.WriteLine("   apart from the document. Insert a member in the middle of that enum and");
    Console.WriteLine("   every existing caller's numbers now mean something else, with no error");
    Console.WriteLine("   anywhere. Names do not have that failure mode.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the question mark that broke a client");
    Console.WriteLine();
    Console.WriteLine("   A developer silences a nullable warning by adding '?' to a handler");
    Console.WriteLine("   parameter. Tests pass, review passes, it ships. A week later a partner");
    Console.WriteLine("   regenerates their client and their build breaks.");
    Console.WriteLine();
    Console.WriteLine("   What changed, and why did nothing at the API end notice?");
    Console.WriteLine();

    JsonDocument before = await Document(app =>
        app.MapGet("/v1/payments", (string tenant, int page) => Results.Ok()));

    JsonDocument after = await Document(app =>
        app.MapGet("/v1/payments", (string tenant, int? page) => Results.Ok()));

    Console.WriteLine("   parameter   before        after");
    Console.WriteLine("   ---------   ------        -----");

    foreach (string name in new[] { "tenant", "page" })
    {
        Console.WriteLine($"   {name,-11} {Parameter(before, name),-13} {Parameter(after, name)}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: 'page' WENT FROM REQUIRED TO OPTIONAL IN THE PUBLISHED");
    Console.WriteLine("   CONTRACT. C# nullability is where the framework gets that fact, so a");
    Console.WriteLine("   change made to satisfy the compiler changed the API's documentation.");
    Console.WriteLine();
    Console.WriteLine("   NOTHING NOTICED BECAUSE NOTHING WAS WATCHING. No test reads the");
    Console.WriteLine("   document, the diff of a '?' is one character, and the reviewer saw a");
    Console.WriteLine("   nullability fix rather than a contract change.");
    Console.WriteLine();
    Console.WriteLine("   THE DIRECTION IS WORTH THINKING THROUGH, because required-to-optional");
    Console.WriteLine("   is the SAFE direction for a request parameter - you are demanding less.");
    Console.WriteLine("   The partner's build broke because their generator emitted 'page' as an");
    Console.WriteLine("   optional argument and the call site was written positionally. THE");
    Console.WriteLine("   RUNTIME CONTRACT DID NOT BREAK; THEIR GENERATED CODE DID.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS ITS OWN LESSON. Once you publish a document that people");
    Console.WriteLine("   generate code from, the SHAPE of the document is part of your contract,");
    Console.WriteLine("   not only the behaviour it describes. Changes that are semantically");
    Console.WriteLine("   harmless can still be source-breaking downstream.");
    Console.WriteLine();
    Console.WriteLine("   THE PRACTICE THAT CATCHES IT: commit the generated document and diff");
    Console.WriteLine("   it in review. That '?' becomes a visible line saying");
    Console.WriteLine("   'required: true' -> 'required: false' next to the code that caused it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the money that stopped adding up");
    Console.WriteLine();
    Console.WriteLine("   Amounts are C# decimals. A partner reconciling against the API reports");
    Console.WriteLine("   totals off by fractions of a penny across large batches. The API's own");
    Console.WriteLine("   totals are exact.");
    Console.WriteLine();
    Console.WriteLine("   The JSON on the wire is correct in both cases. Where does the error");
    Console.WriteLine("   come from?");
    Console.WriteLine();

    JsonDocument document = await Document(app => app.MapPost("/amounts", (Amounts a) => a));

    JsonElement schema = document.RootElement.GetProperty("components")
        .GetProperty("schemas").GetProperty("Amounts");

    Console.WriteLine("   C# property                 published as");
    Console.WriteLine("   -----------                 ------------");
    Console.WriteLine($"   decimal AsDecimal           {Type(schema, "asDecimal")}");
    Console.WriteLine($"   double AsDouble             {Type(schema, "asDouble")}");
    Console.WriteLine($"   long AsMinorUnits           {Type(schema, "asMinorUnits")}");

    // What that instruction costs a client that follows it.
    decimal exact = 0.1m + 0.2m;
    double asDouble = 0.1 + 0.2;

    Console.WriteLine();
    Console.WriteLine("   AND WHAT A CLIENT THAT FOLLOWS THE DOCUMENT COMPUTES:");
    Console.WriteLine();
    Console.WriteLine($"     0.1 + 0.2 in decimal   {exact}");
    Console.WriteLine($"     0.1 + 0.2 in double    {asDouble:R}");
    Console.WriteLine($"     equal                  {(double)exact == asDouble}");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE DOCUMENT TELLS THE CLIENT TO USE A DOUBLE. JSON Schema has");
    Console.WriteLine("   no decimal type, so a C# decimal is published as 'number, format");
    Console.WriteLine("   double' and every generator faithfully emits a binary floating point");
    Console.WriteLine("   field. THE PRECISION YOU CHOSE decimal FOR DOES NOT SURVIVE THE");
    Console.WriteLine("   DOCUMENT.");
    Console.WriteLine();
    Console.WriteLine("   THE WIRE FORMAT IS FINE. The JSON number is exact text. The loss");
    Console.WriteLine("   happens on the client, after parsing, in a type the document told it to");
    Console.WriteLine("   use - which is why the API's own totals are right and nobody at the API");
    Console.WriteLine("   end can reproduce it.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS INTEGER MINOR UNITS. 4999 pence is an int64 in every");
    Console.WriteLine("   language, in the document, and on the wire, with no format that can");
    Console.WriteLine("   round it. Money in an API contract should not be a fractional type at");
    Console.WriteLine("   all - and the document is what forces the issue, because it is where");
    Console.WriteLine("   the C# type stops protecting you.");
    Console.WriteLine();
    Console.WriteLine("   IF YOU CANNOT CHANGE THE FIELD: publish it as a STRING with a pattern,");
    Console.WriteLine("   which is what several payment APIs do. Ugly, unambiguous, and it");
    Console.WriteLine("   survives every generator.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - the transformer that fixed one thing");
    Console.WriteLine();
    Console.WriteLine("   A team hits the nullable-and-required problem: their document requires");
    Console.WriteLine("   a key whose value may be null. They add a schema transformer that drops");
    Console.WriteLine("   nullable properties from every 'required' list. It works.");
    Console.WriteLine();
    Console.WriteLine("   Two months later, a partner's client stops sending a field the API");
    Console.WriteLine("   needs, and the API starts returning 400s the partner says are");
    Console.WriteLine("   undocumented.");
    Console.WriteLine();
    Console.WriteLine("   The transformer is four lines and does exactly what it says. What went");
    Console.WriteLine("   wrong?");
    Console.WriteLine();

    JsonDocument without = await Document(
        app => app.MapPost("/v1/refunds", (RefundRequest r) => Results.Ok()));

    JsonDocument with = await Document(
        app => app.MapPost("/v1/refunds", (RefundRequest r) => Results.Ok()),
        options => options.AddSchemaTransformer((schema, context, token) =>
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
        }));

    Console.WriteLine("   RefundRequest                          required, without   required, with");
    Console.WriteLine("   -------------                          -----------------   --------------");

    foreach ((string property, string declared) in new[]
    {
        ("paymentId", "string"),
        ("amountMinor", "long"),
        ("reason", "string?"),
        ("idempotencyKey", "string?  <- the API needs this")
    })
    {
        Console.WriteLine($"   {declared,-38} {IsRequired(without, property),-19} {IsRequired(with, property)}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE TRANSFORMER IS CORRECT AND THE PREMISE IS WRONG. It");
    Console.WriteLine("   encodes 'nullable implies optional', and idempotencyKey is a property");
    Console.WriteLine("   that is nullable in C# - because the record has to be constructible");
    Console.WriteLine("   without it - and mandatory in the API, because the handler rejects a");
    Console.WriteLine("   request that omits it.");
    Console.WriteLine();
    Console.WriteLine("   THOSE TWO FACTS WERE ALWAYS IN DISAGREEMENT. The transformer did not");
    Console.WriteLine("   create the problem; it published it. Before the transformer the");
    Console.WriteLine("   document accidentally said the right thing about idempotencyKey while");
    Console.WriteLine("   saying the wrong thing about reason.");
    Console.WriteLine();
    Console.WriteLine("   WHY IT TOOK TWO MONTHS: existing clients kept sending the field,");
    Console.WriteLine("   because they were written against the older document. Only a client");
    Console.WriteLine("   REGENERATED after the change stopped sending it. A document change");
    Console.WriteLine("   takes effect when somebody regenerates, which may be any time between");
    Console.WriteLine("   immediately and never - so the blast radius of a document edit arrives");
    Console.WriteLine("   spread out over months, uncorrelated with your deployment.");
    Console.WriteLine();
    Console.WriteLine("   THE LESSON ABOUT TRANSFORMERS: A SCHEMA TRANSFORMER IS A RULE APPLIED");
    Console.WriteLine("   TO CODE THAT HAS NOT BEEN WRITTEN YET, BY PEOPLE WHO DO NOT KNOW IT");
    Console.WriteLine("   EXISTS. This one was written to fix two known types and silently");
    Console.WriteLine("   governed every type added afterwards.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS AT THE TYPE, NOT IN THE TRANSFORMER: mark idempotencyKey");
    Console.WriteLine("   with [Required], or better, make it a non-nullable parameter so C# and");
    Console.WriteLine("   the API agree. WHEN A GLOBAL RULE PRODUCES A WRONG ANSWER FOR ONE TYPE,");
    Console.WriteLine("   THE TYPE IS USUALLY THE THING THAT IS WRONG - the rule found it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<JsonDocument> Document(Action<WebApplication> configure,
    Action<Microsoft.AspNetCore.OpenApi.OpenApiOptions>? options = null)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    if (options is null)
    {
        builder.Services.AddOpenApi();
    }
    else
    {
        builder.Services.AddOpenApi(options);
    }

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
static string Describe(JsonElement schemas, JsonElement owner, string property)
{
    JsonElement schema = owner.GetProperty("properties").GetProperty(property);

    if (schema.TryGetProperty("$ref", out JsonElement reference))
    {
        schema = schemas.GetProperty(reference.GetString()!.Split('/').Last());
    }

    string type = schema.TryGetProperty("type", out JsonElement t) ? t.ToString() : "no type";

    return schema.TryGetProperty("enum", out JsonElement values)
        ? $"{type} enum [{string.Join(",", values.EnumerateArray().Select(v => v.ToString()))}]"
        : $"{type}, no enum list";
}

// ---------------------------------------------------------------------------
static string Parameter(JsonDocument document, string name)
{
    JsonElement parameter = document.RootElement.GetProperty("paths")
        .GetProperty("/v1/payments").GetProperty("get").GetProperty("parameters")
        .EnumerateArray().First(p => p.GetProperty("name").GetString() == name);

    return parameter.TryGetProperty("required", out JsonElement r) && r.GetBoolean()
        ? "required" : "optional";
}

// ---------------------------------------------------------------------------
static string Type(JsonElement schema, string property)
{
    JsonElement p = schema.GetProperty("properties").GetProperty(property);

    string type = p.TryGetProperty("type", out JsonElement t)
        ? t.ValueKind == JsonValueKind.Array
            ? string.Join("|", t.EnumerateArray().Select(e => e.GetString()))
            : t.GetString()!
        : "?";

    return p.TryGetProperty("format", out JsonElement f) ? $"{type}, format {f.GetString()}" : type;
}

// ---------------------------------------------------------------------------
static string IsRequired(JsonDocument document, string property)
{
    JsonElement schema = document.RootElement.GetProperty("components")
        .GetProperty("schemas").GetProperty("RefundRequest");

    bool required = schema.TryGetProperty("required", out JsonElement r)
        && r.EnumerateArray().Any(e => e.GetString() == property);

    return required ? "required" : "OPTIONAL";
}

// ---------------------------------------------------------------------------
enum Status { Pending, Captured, Failed }

[JsonConverter(typeof(JsonStringEnumConverter<StringStatus>))]
enum StringStatus { Pending, Captured, Failed }

record PlainFilter(Status Status);

record ConvertedFilter(StringStatus Status);

record Amounts(decimal AsDecimal, double AsDouble, long AsMinorUnits);

record RefundRequest(string PaymentId, long AmountMinor, string? Reason, string? IdempotencyKey);
