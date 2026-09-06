// 01-what-it-can-know.cs — Everything the generator infers, and the boundary
// where inference stops. The boundary is the useful part.
//
// Run:  dotnet run 01-what-it-can-know.cs -c Release
//
// EXACT vs RATIO: every cell in every table here is read out of the generated
// document and is deterministic.

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
using Microsoft.AspNetCore.Mvc;

Console.WriteLine("What the generator can work out, and where it stops");
Console.WriteLine();

await ReturnTypes();
await ParameterSources();
await TypeMapping();
await Constraints();

// ---------------------------------------------------------------------------
static async Task ReturnTypes()
{
    Console.WriteLine("1. How you write the return type decides what gets documented");
    Console.WriteLine();

    JsonDocument document = await Document(app =>
    {
        // Each of these is the same endpoint, written five ways.
        app.MapGet("/a-iresult", () => Results.Ok(new Payment("P", "captured", 1, "GBP", null)));

        app.MapGet("/b-typed", () => new Payment("P", "captured", 1, "GBP", null));

        app.MapGet("/c-typedresults", () =>
            TypedResults.Ok(new Payment("P", "captured", 1, "GBP", null)));

        app.MapGet("/d-results-union", Results<Ok<Payment>, NotFound> () =>
            TypedResults.Ok(new Payment("P", "captured", 1, "GBP", null)));

        app.MapGet("/e-produces", () => Results.Ok(new Payment("P", "captured", 1, "GBP", null)))
            .Produces<Payment>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound);
    });

    Console.WriteLine("   how the handler is written                  documented as");
    Console.WriteLine("   --------------------------                  -------------");

    (string Path, string How)[] endpoints =
    [
        ("/a-iresult", "returns IResult"),
        ("/b-typed", "returns Payment"),
        ("/c-typedresults", "returns TypedResults.Ok"),
        ("/d-results-union", "Results<Ok<Payment>, NotFound>"),
        ("/e-produces", "IResult + .Produces<Payment>()")
    ];

    foreach ((string path, string how) in endpoints)
    {
        Console.WriteLine($"   {how,-42}  {DescribeResponses(document, path)}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIRST ROW IS THE DEFAULT AND THE WORST. Results.Ok(...) returns");
    Console.WriteLine("   IResult, and IResult is one type no matter what you put in it. The");
    Console.WriteLine("   generator reads the SIGNATURE, so there is nothing there to read.");
    Console.WriteLine();
    Console.WriteLine("   TypedResults IS THE FIX MOST PEOPLE HAVE NOT HEARD OF. It is the same");
    Console.WriteLine("   API as Results, returning a type that names the status code and the");
    Console.WriteLine("   body: TypedResults.Ok(payment) is Ok<Payment>, not IResult. Changing");
    Console.WriteLine("   Results to TypedResults is a search and replace that fixes the");
    Console.WriteLine("   document for free.");
    Console.WriteLine();
    Console.WriteLine("   AND Results<Ok<Payment>, NotFound> DOCUMENTS THE FAILURE TOO. Writing");
    Console.WriteLine("   the union as the return type tells the generator every outcome, and -");
    Console.WriteLine("   the part that matters more - tells the COMPILER, which will reject a");
    Console.WriteLine("   handler that returns anything else. THE DOCUMENT AND THE CODE CANNOT");
    Console.WriteLine("   DRIFT, because the drift would not compile.");
    Console.WriteLine();
    Console.WriteLine("   .Produces<T>() STILL WORKS AND IS A DECLARATION, NOT A CONSTRAINT.");
    Console.WriteLine("   Nothing checks it. It is the right tool when the handler genuinely");
    Console.WriteLine("   cannot express its outcomes in its type, and the wrong one whenever the");
    Console.WriteLine("   type could say it - because a .Produces that stops being true produces");
    Console.WriteLine("   no error anywhere.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ParameterSources()
{
    Console.WriteLine("2. Where the generator thinks each parameter comes from");
    Console.WriteLine();

    JsonDocument document = await Document(app =>
    {
        app.MapGet("/search/{tenant}", (
            string tenant,
            string? query,
            int page,
            [FromHeader(Name = "X-Request-Id")] string? requestId,
            [FromQuery(Name = "sort")] string? sortField) => Results.Ok());
    });

    JsonElement parameters = document.RootElement
        .GetProperty("paths").GetProperty("/search/{tenant}")
        .GetProperty("get").GetProperty("parameters");

    Console.WriteLine("   parameter        in         required   schema");
    Console.WriteLine("   ---------        --         --------   ------");

    foreach (JsonElement parameter in parameters.EnumerateArray())
    {
        string name = parameter.GetProperty("name").GetString()!;
        string location = parameter.GetProperty("in").GetString()!;
        bool required = parameter.TryGetProperty("required", out JsonElement r) && r.GetBoolean();

        Console.WriteLine($"   {name,-16} {location,-10} {required,-10} " +
            $"{Summarise(parameter.GetProperty("schema"))}");
    }

    Console.WriteLine();
    Console.WriteLine("   THIS IS THE PART THE GENERATOR IS GOOD AT, and the reason is worth");
    Console.WriteLine("   naming: PARAMETER BINDING IS ALREADY DECIDED BY THE SAME RULES. The");
    Console.WriteLine("   framework must know where 'tenant' comes from in order to bind it, so");
    Console.WriteLine("   documenting it costs nothing extra.");
    Console.WriteLine();
    Console.WriteLine("   NOTE 'page' IS REQUIRED AND 'query' IS NOT. An int cannot be absent, a");
    Console.WriteLine("   string? can - so C# nullability decided a fact about your HTTP contract");
    Console.WriteLine("   without anybody writing it down. THAT IS THE GENERATOR WORKING AND IT");
    Console.WriteLine("   IS ALSO A TRAP: adding '?' to a parameter to silence a warning changes");
    Console.WriteLine("   the published contract.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TypeMapping()
{
    Console.WriteLine("3. How C# types become JSON Schema");
    Console.WriteLine();

    JsonDocument document = await Document(app => app.MapPost("/t", (Kitchen k) => k));

    JsonElement schema = document.RootElement
        .GetProperty("components").GetProperty("schemas").GetProperty("Kitchen");

    (string Property, string Csharp)[] rows =
    [
        ("aString", "string"),
        ("aNullableString", "string?"),
        ("anInt", "int"),
        ("aNullableInt", "int?"),
        ("aLong", "long"),
        ("aDecimal", "decimal"),
        ("aDouble", "double"),
        ("aBool", "bool"),
        ("aGuid", "Guid"),
        ("aDate", "DateTime"),
        ("aDateOnly", "DateOnly"),
        ("aTimeSpan", "TimeSpan"),
        ("aUri", "Uri"),
        ("aList", "List<string>"),
        ("aDictionary", "Dictionary<string, int>"),
        ("anIntEnum", "Status (enum)"),
        ("aStringEnum", "Currency ([JsonConverter])"),
        ("anObject", "object")
    ];

    Console.WriteLine("   C# declaration                       documented as");
    Console.WriteLine("   --------------                       -------------");

    foreach ((string property, string csharp) in rows)
    {
        string documented = schema.GetProperty("properties").TryGetProperty(property, out JsonElement p)
            ? Resolve(p, document)
            : "ABSENT";

        Console.WriteLine($"   {csharp,-36} {documented}");
    }

    Console.WriteLine();
    Console.WriteLine("   FOUR ROWS THERE ARE WORTH STOPPING ON.");
    Console.WriteLine();
    Console.WriteLine("     EVERY NUMBER IS 'NUMBER OR STRING'. Not only the 64-bit ones - an");
    Console.WriteLine("     int32 gets it too. System.Text.Json will read a number from a quoted");
    Console.WriteLine("     string, so the schema documents both forms, and the pattern on the");
    Console.WriteLine("     integer types constrains what the quoted form may contain. It is");
    Console.WriteLine("     accurate. It also means a generated TypeScript client types every");
    Console.WriteLine("     numeric property as 'number | string', which client authors reliably");
    Console.WriteLine("     read as a bug in your API.");
    Console.WriteLine();
    Console.WriteLine("     decimal DOCUMENTS AS A DOUBLE. There is no decimal in JSON Schema, so");
    Console.WriteLine("     a money amount declared as decimal is published as a binary floating");
    Console.WriteLine("     point number, and a generated client will deserialise it into one.");
    Console.WriteLine("     THE PRECISION YOU CHOSE decimal FOR DOES NOT SURVIVE THE DOCUMENT.");
    Console.WriteLine("     This is the strongest argument for integer minor units in an API");
    Console.WriteLine("     contract: 4999 pence is an int64 everywhere and 49.99 is not.");
    Console.WriteLine();
    Console.WriteLine("     THE TWO ENUMS BEHAVE COMPLETELY DIFFERENTLY, and only the serialiser");
    Console.WriteLine("     decides which. The one carrying JsonStringEnumConverter publishes");
    Console.WriteLine("     its NAMES as an enum list, which is a complete description of the");
    Console.WriteLine("     allowed values.");
    Console.WriteLine();
    Console.WriteLine("     THE PLAIN ENUM PUBLISHES 'integer' AND NOTHING ELSE. Not the names,");
    Console.WriteLine("     not the numbers, NOT EVEN THE LIST OF WHICH INTEGERS ARE LEGAL. A");
    Console.WriteLine("     caller reading that document is told to send a number, with no way");
    Console.WriteLine("     to know that only 0, 1 and 2 exist or what any of them mean, and a");
    Console.WriteLine("     generated client will happily send 47.");
    Console.WriteLine();
    Console.WriteLine("     THE DOCUMENT IS DESCRIBING THE WIRE HONESTLY IN BOTH CASES, which is");
    Console.WriteLine("     the point: an int-valued enum genuinely IS an undocumented integer");
    Console.WriteLine("     on the wire. The generator did not lose information - your");
    Console.WriteLine("     serialisation choice never put it there.");
    Console.WriteLine();
    Console.WriteLine("     object DOCUMENTS AS NOTHING AT ALL - an empty schema, which in JSON");
    Console.WriteLine("     Schema means 'anything'. That is accurate and useless. An object or");
    Console.WriteLine("     JsonElement property in a response is an undocumentable hole, and the");
    Console.WriteLine("     only fix is to stop having one.");
    Console.WriteLine();
    Console.WriteLine("   TimeSpan IS THE ONE TO CHECK IN YOUR OWN CODE: a bare string, with no");
    Console.WriteLine("   format and nothing telling a caller what shape it takes. If you put");
    Console.WriteLine("   durations in an API, use ISO-8601 strings and a converter you chose.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Constraints()
{
    Console.WriteLine("4. Whether validation attributes reach the document");
    Console.WriteLine();
    Console.WriteLine("   The rules are already written down in attributes. The question is");
    Console.WriteLine("   whether the document repeats them, or whether a caller has to discover");
    Console.WriteLine("   them by being rejected.");
    Console.WriteLine();

    JsonDocument document = await Document(app => app.MapPost("/c", (Constrained c) => c));

    JsonElement schema = document.RootElement
        .GetProperty("components").GetProperty("schemas").GetProperty("Constrained");

    (string Property, string Attribute)[] rows =
    [
        ("reference", "[Required, StringLength(20, MinimumLength = 3)]"),
        ("amountMinor", "[Range(1, 1000000)]"),
        ("currency", "[RegularExpression(\"^[A-Z]{3}$\")]"),
        ("email", "[EmailAddress]"),
        ("website", "[Url]"),
        ("note", "[MaxLength(500)]"),
        ("described", "[Description(\"...\")]"),
        ("defaulted", "= \"GBP\" (property initialiser)")
    ];

    Console.WriteLine("   attribute                                         reached the schema as");
    Console.WriteLine("   ---------                                         ---------------------");

    foreach ((string property, string attribute) in rows)
    {
        string documented = schema.GetProperty("properties").TryGetProperty(property, out JsonElement p)
            ? ConstraintsOf(p)
            : "ABSENT";

        Console.WriteLine($"   {attribute,-49} {documented}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE ONES THAT ARRIVED ARE THE ONES JSON SCHEMA HAS A WORD FOR. Length,");
    Console.WriteLine("   range and pattern are schema vocabulary, so they translate directly.");
    Console.WriteLine();
    Console.WriteLine("   [Url] AND [EmailAddress] ARE THE INSTRUCTIVE PAIR. They are the same");
    Console.WriteLine("   kind of attribute, doing the same kind of job, and ONE OF THEM MADE IT");
    Console.WriteLine("   AND ONE DID NOT. [Url] became format=uri; [EmailAddress] became");
    Console.WriteLine("   nothing at all, so an email field is published as an unconstrained");
    Console.WriteLine("   string while your API rejects most of them.");
    Console.WriteLine();
    Console.WriteLine("   DO NOT LEARN THE LIST - LEARN TO CHECK. Which attributes translate is");
    Console.WriteLine("   a property of the version you are on, and the two-line test is to fetch");
    Console.WriteLine("   your own document and read the property. Anything you assumed made it");
    Console.WriteLine("   and did not is a rule your callers can only discover by being rejected.");
    Console.WriteLine();
    Console.WriteLine("   AND THE DEFAULT VALUE DID NOT ARRIVE EITHER. A property initialiser is");
    Console.WriteLine("   C# syntax with no runtime trace, so 'defaults to GBP' - a real part of");
    Console.WriteLine("   your contract - is invisible. If a default matters to callers, it goes");
    Console.WriteLine("   in a description or a schema transformer, because nothing will infer");
    Console.WriteLine("   it.");
    Console.WriteLine();
    Console.WriteLine("   WHAT DOES NOT ARRIVE IS ANYTHING YOU WROTE YOURSELF. A custom");
    Console.WriteLine("   ValidationAttribute, an IValidatableObject, a rule enforced in the");
    Console.WriteLine("   handler, a constraint that depends on two fields at once - none of");
    Console.WriteLine("   those has a JSON Schema equivalent, so none of them can be generated,");
    Console.WriteLine("   and callers meet them as 400s.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE HONEST BOUNDARY OF ALL SCHEMA GENERATION: IT CAN PUBLISH");
    Console.WriteLine("   THE RULES THAT WERE ALREADY EXPRESSED IN A VOCABULARY IT SHARES. Every");
    Console.WriteLine("   rule you invented lives only in your code and your prose, which is why");
    Console.WriteLine("   the description fields in a document are not decoration.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// Builds an app, maps whatever the caller wants, and returns its document.
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
static string DescribeResponses(JsonDocument document, string path)
{
    JsonElement responses = document.RootElement
        .GetProperty("paths").GetProperty(path).GetProperty("get").GetProperty("responses");

    return string.Join(", ", responses.EnumerateObject().Select(r =>
        r.Value.TryGetProperty("content", out JsonElement content)
            ? $"{r.Name} {Reference(content)}"
            : $"{r.Name} (no body)"));
}

// ---------------------------------------------------------------------------
static string Reference(JsonElement content)
{
    JsonElement schema = content.EnumerateObject().First().Value.GetProperty("schema");

    return schema.TryGetProperty("$ref", out JsonElement reference)
        ? reference.GetString()!.Split('/').Last()
        : Summarise(schema);
}

// ---------------------------------------------------------------------------
// Follows a $ref back to components/schemas so the table shows what the type
// actually became rather than only its name.
static string Resolve(JsonElement schema, JsonDocument document)
{
    if (!schema.TryGetProperty("$ref", out JsonElement reference))
    {
        return Summarise(schema);
    }

    string name = reference.GetString()!.Split('/').Last();
    JsonElement target = document.RootElement
        .GetProperty("components").GetProperty("schemas").GetProperty(name);

    return $"{name} = {Summarise(target)}";
}

// ---------------------------------------------------------------------------
static string Summarise(JsonElement schema)
{
    if (schema.TryGetProperty("$ref", out JsonElement reference))
    {
        return reference.GetString()!.Split('/').Last();
    }

    if (!schema.TryGetProperty("type", out JsonElement type))
    {
        if (schema.TryGetProperty("enum", out JsonElement bare))
        {
            return "enum [" + string.Join(",", bare.EnumerateArray().Select(v => v.ToString())) + "]";
        }

        return schema.EnumerateObject().Any() ? "{ " + Names(schema) + " }" : "{} (anything)";
    }

    string name = type.ValueKind == JsonValueKind.Array
        ? string.Join("|", type.EnumerateArray().Select(e => e.GetString()))
        : type.GetString()!;

    if (schema.TryGetProperty("format", out JsonElement format))
    {
        name += $" ({format.GetString()})";
    }

    if (schema.TryGetProperty("enum", out JsonElement values))
    {
        name += " enum [" + string.Join(",", values.EnumerateArray().Select(v => v.ToString())) + "]";
    }

    if (schema.TryGetProperty("items", out JsonElement items))
    {
        name += " of " + Summarise(items);
    }

    if (schema.TryGetProperty("additionalProperties", out JsonElement additional)
        && additional.ValueKind == JsonValueKind.Object)
    {
        name += " to " + Summarise(additional);
    }

    return name;
}

// ---------------------------------------------------------------------------
static string ConstraintsOf(JsonElement schema)
{
    string[] keywords =
    [
        "minLength", "maxLength", "pattern", "minimum", "maximum",
        "exclusiveMinimum", "exclusiveMaximum", "format", "default", "description"
    ];

    string[] found = [.. keywords
        .Where(k => schema.TryGetProperty(k, out _))
        .Select(k => $"{k}={Trim(schema.GetProperty(k).ToString())}")];

    return found.Length == 0 ? "NOTHING" : string.Join(", ", found);
}

// ---------------------------------------------------------------------------
static string Trim(string value) => value.Length > 18 ? value[..15] + "..." : value;

// ---------------------------------------------------------------------------
static string Names(JsonElement schema) =>
    string.Join(",", schema.EnumerateObject().Select(p => p.Name));

// ---------------------------------------------------------------------------
record Payment(string Id, string Status, long AmountMinor, string Currency, string? FailureReason);

// ---------------------------------------------------------------------------
class Kitchen
{
    public string AString { get; set; } = "";
    public string? ANullableString { get; set; }
    public int AnInt { get; set; }
    public int? ANullableInt { get; set; }
    public long ALong { get; set; }
    public decimal ADecimal { get; set; }
    public double ADouble { get; set; }
    public bool ABool { get; set; }
    public Guid AGuid { get; set; }
    public DateTime ADate { get; set; }
    public DateOnly ADateOnly { get; set; }
    public TimeSpan ATimeSpan { get; set; }
    public Uri? AUri { get; set; }
    public List<string> AList { get; set; } = [];
    public Dictionary<string, int> ADictionary { get; set; } = [];
    public Status AnIntEnum { get; set; }
    public Currency AStringEnum { get; set; }
    public object? AnObject { get; set; }
}

enum Status { Pending, Captured, Failed }

[JsonConverter(typeof(JsonStringEnumConverter<Currency>))]
enum Currency { GBP, USD, EUR }

// ---------------------------------------------------------------------------
class Constrained
{
    [Required, StringLength(20, MinimumLength = 3)]
    public string Reference { get; set; } = "";

    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [RegularExpression("^[A-Z]{3}$")]
    public string Currency { get; set; } = "";

    [EmailAddress]
    public string? Email { get; set; }

    [Url]
    public string? Website { get; set; }

    [MaxLength(500)]
    public string? Note { get; set; }

    [Description("The reference the payment gateway gave us.")]
    public string? Described { get; set; }

    public string Defaulted { get; set; } = "GBP";
}
