// 00-smallest.cs — Two lines produce a document describing your API. Reading it
// carefully is the whole of this module.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every line of the generated document here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.OpenApi@10.0.10
#:package Microsoft.OpenApi@2.11.0

using System.Text.Json;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// Line one.
builder.Services.AddOpenApi();

var app = builder.Build();

// Line two.
app.MapOpenApi();

app.MapGet("/v1/payments/{id}", (string id) =>
    id == "PAY-001"
        ? Results.Ok(new Payment("PAY-001", "captured", 4999, "GBP", null))
        : Results.NotFound());

app.MapPost("/v1/payments", (CreatePayment request) =>
    Results.Created($"/v1/payments/PAY-002",
        new Payment("PAY-002", "pending", request.AmountMinor, request.Currency, null)));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("The document those two lines produced");
Console.WriteLine();

string json = await http.GetStringAsync("/openapi/v1.json");
using JsonDocument document = JsonDocument.Parse(json);

Console.WriteLine($"   {json.Length:n0} bytes at /openapi/v1.json, OpenAPI version " +
    $"{document.RootElement.GetProperty("openapi").GetString()}");
Console.WriteLine();

// What the document says about each endpoint, alongside what the endpoint does.
Console.WriteLine("   THE DOCUMENT'S VIEW OF THE TWO ENDPOINTS");
Console.WriteLine();
Console.WriteLine("   endpoint                  documented responses   what the code returns");
Console.WriteLine("   --------                  --------------------   ---------------------");

JsonElement paths = document.RootElement.GetProperty("paths");

Console.WriteLine($"   GET  /v1/payments/{{id}}    " +
    $"{Responses(paths, "/v1/payments/{id}", "get"),-20}   200 Payment, 404");
Console.WriteLine($"   POST /v1/payments         " +
    $"{Responses(paths, "/v1/payments", "post"),-20}   201 Payment, Location header");

Console.WriteLine();
Console.WriteLine("   THE DOCUMENT IS ALREADY WRONG ABOUT BOTH, and it is worth being precise");
Console.WriteLine("   about how, because it is not lying - it is reporting what it can see.");
Console.WriteLine();
Console.WriteLine("     THE GET returns 404 for an unknown id and the document does not mention");
Console.WriteLine("     404. A client generated from this document has no branch for it.");
Console.WriteLine();
Console.WriteLine("     THE POST returns 201 with a Location header, and the document says 200");
Console.WriteLine("     with no body at all. A generated client will not read the response.");
Console.WriteLine();
Console.WriteLine("   THE CAUSE IS THE SAME IN BOTH CASES: THE HANDLERS RETURN IResult. The");
Console.WriteLine("   generator inspects the method SIGNATURE, and a signature returning IResult");
Console.WriteLine("   says nothing about status codes or bodies. It falls back to '200, and I do");
Console.WriteLine("   not know what is in it'.");
Console.WriteLine();

// Which types made it into the document at all.
JsonElement schemas = document.RootElement.GetProperty("components").GetProperty("schemas");

Console.WriteLine("   WHICH TYPES THE DOCUMENT DESCRIBES");
Console.WriteLine();
Console.WriteLine($"     types in components/schemas   " +
    $"{string.Join(", ", schemas.EnumerateObject().Select(s => s.Name))}");
Console.WriteLine();
Console.WriteLine("   Payment IS NOT IN THE DOCUMENT AT ALL. Not described badly - absent. It");
Console.WriteLine("   is the type both endpoints return, and a client generated from this");
Console.WriteLine("   document has no class for it, because nothing in either signature");
Console.WriteLine("   mentions it. CreatePayment is there only because it is a PARAMETER, and");
Console.WriteLine("   parameters are in the signature.");
Console.WriteLine();

await app.StopAsync();

// The same records, on handlers that return the type rather than IResult.
var second = WebApplication.CreateBuilder();
second.WebHost.UseUrls("http://127.0.0.1:0");
second.Logging.ClearProviders();
second.Services.AddOpenApi();

var typed = second.Build();
typed.MapOpenApi();

typed.MapGet("/v1/payments/{id}", (string id) =>
    new Payment(id, "captured", 4999, "GBP", null));

await typed.StartAsync();
using var typedHttp = new HttpClient { BaseAddress = new Uri(typed.Urls.First()) };

using JsonDocument typedDocument = JsonDocument.Parse(
    await typedHttp.GetStringAsync("/openapi/v1.json"));

Console.WriteLine("   THE SAME RECORD, ON A HANDLER THAT RETURNS Payment RATHER THAN IResult");
Console.WriteLine();

JsonElement schema = typedDocument.RootElement
    .GetProperty("components").GetProperty("schemas").GetProperty("Payment");

Console.WriteLine($"     {"property",-16} {"documented as",-34} declared in C# as");
Console.WriteLine($"     {new string('-', 16)} {new string('-', 34)} -----------------");

(string Name, string Csharp)[] declared =
[
    ("id", "string"),
    ("status", "string"),
    ("amountMinor", "long"),
    ("currency", "string"),
    ("failureReason", "string?")
];

foreach ((string name, string csharp) in declared)
{
    JsonElement property = schema.GetProperty("properties").GetProperty(name);

    Console.WriteLine($"     {name,-16} {Describe(property),-34} {csharp}");
}

bool hasRequired = schema.TryGetProperty("required", out JsonElement required);

Console.WriteLine();
Console.WriteLine($"     required properties   " +
    $"{(hasRequired ? string.Join(", ", required.EnumerateArray().Select(e => e.GetString())) : "NONE LISTED")}");

await typed.StopAsync();



Console.WriteLine();
Console.WriteLine("   THAT TABLE IS MOSTLY RIGHT, WHICH MAKES THE TWO ODD ROWS WORTH READING.");
Console.WriteLine();
Console.WriteLine("     amountMinor IS 'INTEGER OR STRING'. System.Text.Json will read a");
Console.WriteLine("     number from a quoted string, so the schema documents both forms, with");
Console.WriteLine("     a pattern constraining what the quoted form may contain. This is not");
Console.WriteLine("     special to int64 - every numeric type gets it, as the next file shows.");
Console.WriteLine("     IT IS CORRECT AND IT WILL SURPRISE EVERY CLIENT AUTHOR WHO READS IT,");
Console.WriteLine("     because a generated client types that property as a union.");
Console.WriteLine();
Console.WriteLine("     failureReason IS BOTH NULLABLE AND REQUIRED, and that is not a");
Console.WriteLine("     contradiction. In JSON Schema those two words answer DIFFERENT");
Console.WriteLine("     QUESTIONS:");
Console.WriteLine();
Console.WriteLine("       required    must the KEY be present in the object");
Console.WriteLine("       nullable    may its VALUE be null");
Console.WriteLine();
Console.WriteLine("     So the document is asking for {\"failureReason\": null} and refusing an");
Console.WriteLine("     object that omits the key. That is what a C# record says - the");
Console.WriteLine("     constructor takes five arguments and one of them may be null - and it");
Console.WriteLine("     is almost never what an API means. Most APIs want the key optional.");
Console.WriteLine();
Console.WriteLine("     THIS IS THE MOST COMMON REAL DISAGREEMENT between a generated document");
Console.WriteLine("     and the API a team believes it has, and it is invisible until someone");
Console.WriteLine("     generates a strict client from the document and it rejects your");
Console.WriteLine("     responses.");
Console.WriteLine();
Console.WriteLine("   NONE OF THIS MAKES THE GENERATOR BAD. It makes the generated document a");
Console.WriteLine("   DESCRIPTION OF WHAT THE FRAMEWORK CAN SEE, which is a smaller thing than a");
Console.WriteLine("   description of your API. The gap between the two is where this module");
Console.WriteLine("   lives, and every technique in it is a way of telling the generator");
Console.WriteLine("   something it could not work out.");

// ---------------------------------------------------------------------------
static string Responses(JsonElement paths, string path, string method)
{
    JsonElement responses = paths.GetProperty(path).GetProperty(method).GetProperty("responses");

    return string.Join(", ", responses.EnumerateObject().Select(r =>
    {
        bool hasBody = r.Value.TryGetProperty("content", out _);

        return $"{r.Name}{(hasBody ? " Payment" : " no body")}";
    }));
}

// ---------------------------------------------------------------------------
static string Describe(JsonElement property)
{
    string type = property.TryGetProperty("type", out JsonElement t)
        ? t.ValueKind == JsonValueKind.Array
            ? string.Join(" or ", t.EnumerateArray().Select(e => e.GetString()))
            : t.GetString() ?? "?"
        : "no type";

    string format = property.TryGetProperty("format", out JsonElement f) ? $" ({f.GetString()})" : "";
    string pattern = property.TryGetProperty("pattern", out _) ? " + pattern" : "";

    return type + format + pattern;
}

// ---------------------------------------------------------------------------
record Payment(string Id, string Status, long AmountMinor, string Currency, string? FailureReason);

record CreatePayment(long AmountMinor, string Currency);
