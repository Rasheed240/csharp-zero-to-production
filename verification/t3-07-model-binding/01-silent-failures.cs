// 01-silent-failures.cs — The binding failures that produce a default value
// and no error, and the ones that produce a 400.
//
// Run:  dotnet run 01-silent-failures.cs -c Release
//
// EXACT vs RATIO: every status code and bound value here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

app.MapGet("/required/{id}", (string id, int page) => Results.Ok(new { id, page }));
app.MapGet("/optional/{id}", (string id, int? page) => Results.Ok(new { id, page }));
app.MapGet("/defaulted/{id}", (string id, int page = 1) => Results.Ok(new { id, page }));

app.MapPost("/body", (CreatePayment body) => Results.Ok(new
{
    amount = body.AmountMinor,
    currency = body.Currency,
    reference = body.Reference
}));

app.MapPost("/nullable-body", (CreatePayment? body) => Results.Ok(new
{
    wasNull = body is null,
    amount = body?.AmountMinor
}));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

await QueryValues(http);
await TheTypo(http);
await MissingBody(http);
Rules();

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task QueryValues(HttpClient http)
{
    Console.WriteLine("1. A query value that is missing, or is not a number");
    Console.WriteLine();
    Console.WriteLine("   handler parameter    ?page=2   ?page=abc   page absent");
    Console.WriteLine("   -----------------    -------   ---------   -----------");

    foreach ((string label, string path) in new[]
    {
        ("int page", "/required/PAY-1"),
        ("int? page", "/optional/PAY-1"),
        ("int page = 1", "/defaulted/PAY-1")
    })
    {
        string good = await DescribeAsync(http, $"{path}?page=2");
        string bad = await DescribeAsync(http, $"{path}?page=abc");
        string absent = await DescribeAsync(http, path);

        Console.WriteLine($"   {label,-19}  {good,-9} {bad,-11} {absent}");
    }

    Console.WriteLine();
    Console.WriteLine("   READ THE MIDDLE COLUMN, because it is not what the first draft of");
    Console.WriteLine("   this file predicted. The value abc is a 400 in ALL THREE.");
    Console.WriteLine();
    Console.WriteLine("   BINDING DISTINGUISHES ABSENT FROM UNPARSEABLE, and that is the useful");
    Console.WriteLine("   thing to know here:");
    Console.WriteLine();
    Console.WriteLine("     absent      the nullable parameter gets null, the defaulted one");
    Console.WriteLine("                 gets its default, and the required one is a 400");
    Console.WriteLine("     present but");
    Console.WriteLine("     unparseable a 400 in every case, whatever the parameter type");
    Console.WriteLine();
    Console.WriteLine("   So making a query parameter nullable or giving it a default handles");
    Console.WriteLine("   ABSENCE only. It does not swallow malformed input, which is the");
    Console.WriteLine("   behaviour you want and the opposite of what is often assumed.");
    Console.WriteLine();
    Console.WriteLine("   The distinction matters when you are reading a handler. int? page");
    Console.WriteLine("   means 'the caller may omit this'; it does not mean 'I will cope with");
    Console.WriteLine("   whatever arrives'. A null there is always a deliberate absence.");
    Console.WriteLine();
    Console.WriteLine("   BE PRECISE ABOUT WHAT IS STILL NOT CHECKED. ?page=-5 binds cleanly to");
    Console.WriteLine("   -5, and ?page=99999999999999 is a 400 only because it overflows an");
    Console.WriteLine("   int. Binding asks whether a value of the type can be produced, not");
    Console.WriteLine("   whether the value makes sense - so a negative page number reaches");
    Console.WriteLine("   your handler exactly as a positive one does.");
    Console.WriteLine();
    Console.WriteLine("   The silent failures in this module are all in the BODY, which is");
    Console.WriteLine("   section 2, and they are silent for a different reason.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheTypo(HttpClient http)
{
    Console.WriteLine("2. A JSON body with a misspelled property");
    Console.WriteLine();

    (string Label, string Json)[] bodies =
    [
        ("everything correct", """{"amountMinor":123450,"currency":"GBP","reference":"R1"}"""),
        ("AMOUNTMINOR (case)", """{"AMOUNTMINOR":123450,"currency":"GBP","reference":"R1"}"""),
        ("amount_minor (snake)", """{"amount_minor":123450,"currency":"GBP","reference":"R1"}"""),
        ("amountMinr (typo)", """{"amountMinr":123450,"currency":"GBP","reference":"R1"}"""),
        ("an extra property", """{"amountMinor":123450,"currency":"GBP","reference":"R1","tip":99}"""),
        ("nothing at all", """{}""")
    ];

    Console.WriteLine("   body                    status   what the handler received");
    Console.WriteLine("   ----                    ------   -------------------------");

    foreach ((string label, string json) in bodies)
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync("/body", content);
        string body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   {label,-22}  {(int)response.StatusCode,6}   {body}");
    }

    Console.WriteLine();
    Console.WriteLine("   EVERY ONE OF THEM IS A 200. Four of the six lost data, and the");
    Console.WriteLine("   handler cannot tell which.");
    Console.WriteLine();
    Console.WriteLine("   Three separate rules are at work, and they are worth separating:");
    Console.WriteLine();
    Console.WriteLine("   PROPERTY MATCHING IS CASE-INSENSITIVE BY DEFAULT. AMOUNTMINOR bound");
    Console.WriteLine("   correctly. That is convenient and it means casing bugs never");
    Console.WriteLine("   surface, so a client sending PascalCase and a client sending");
    Console.WriteLine("   camelCase both work and nobody discovers the inconsistency.");
    Console.WriteLine();
    Console.WriteLine("   AN UNMATCHED PROPERTY IS IGNORED. amount_minor and amountMinr both");
    Console.WriteLine("   left the property at its default of 0, and the extra 'tip' was");
    Console.WriteLine("   discarded. Nothing in the response distinguishes 'you sent 0' from");
    Console.WriteLine("   'you misspelled the field'.");
    Console.WriteLine();
    Console.WriteLine("   A MISSING PROPERTY IS ALSO A DEFAULT. The empty object produced a");
    Console.WriteLine("   payment of 0 in a currency of null.");
    Console.WriteLine();
    Console.WriteLine("   THIS IS THE FAILURE THAT REACHES PRODUCTION. A client renames a");
    Console.WriteLine("   field, or a serialiser on the other side changes its casing policy,");
    Console.WriteLine("   and every request keeps returning 200 while carrying zeros.");
    Console.WriteLine();
    Console.WriteLine("   Three defences, in increasing order of strength:");
    Console.WriteLine();
    Console.WriteLine("     1. VALIDATE. [Range(1, ...)] on the amount turns a silently-zero");
    Console.WriteLine("        payment into a 400. This is the cheapest and it catches the");
    Console.WriteLine("        case where the default is out of range - which is most of them.");
    Console.WriteLine();
    Console.WriteLine("     2. USE REQUIRED MEMBERS OR A CONSTRUCTOR. A record with positional");
    Console.WriteLine("        parameters, or a class with 'required' properties, makes the");
    Console.WriteLine("        deserialiser refuse a body that omits them. That is section 3.");
    Console.WriteLine();
    Console.WriteLine("     3. REJECT UNKNOWN PROPERTIES. Setting");
    Console.WriteLine("        UnmappedMemberHandling.Disallow turns 'amountMinr' into a 400");
    Console.WriteLine("        instead of a zero. It is strict, it will break clients that");
    Console.WriteLine("        send extra fields, and it is the only one that catches a");
    Console.WriteLine("        misspelling whose default happens to be valid.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task MissingBody(HttpClient http)
{
    Console.WriteLine("3. No body at all");
    Console.WriteLine();

    Console.WriteLine("   endpoint          empty body   'null'   no content-type");
    Console.WriteLine("   --------          ----------   ------   ---------------");

    foreach (string path in new[] { "/body", "/nullable-body" })
    {
        string empty = await PostRawAsync(http, path, "", "application/json");
        string literalNull = await PostRawAsync(http, path, "null", "application/json");
        string noType = await PostRawAsync(http, path, """{"amountMinor":1}""", null);

        Console.WriteLine($"   {path,-16}  {empty,-11}  {literalNull,-7}  {noType}");
    }

    Console.WriteLine();
    Console.WriteLine("   A NON-NULLABLE BODY PARAMETER IS REQUIRED. An empty body is a 400,");
    Console.WriteLine("   which is the behaviour you want and the one people are surprised by");
    Console.WriteLine("   when they make the parameter nullable to 'be safe'.");
    Console.WriteLine();
    Console.WriteLine("   MAKING IT NULLABLE MAKES IT OPTIONAL. CreatePayment? accepts an");
    Console.WriteLine("   empty body and hands the handler null - so every use of it needs a");
    Console.WriteLine("   null check, and forgetting one is a NullReferenceException on a");
    Console.WriteLine("   request that should have been rejected at the door.");
    Console.WriteLine();
    Console.WriteLine("   THE LITERAL JSON null IS NOT THE SAME AS AN EMPTY BODY. It is valid");
    Console.WriteLine("   JSON that deserialises to null, so it reaches a nullable parameter");
    Console.WriteLine("   as null and is rejected for a non-nullable one.");
    Console.WriteLine();
    Console.WriteLine("   AND THE CONTENT TYPE IS PART OF THE CONTRACT. A body without");
    Console.WriteLine("   application/json is a 415 Unsupported Media Type - the framework");
    Console.WriteLine("   will not guess. That is the correct answer and it is a common");
    Console.WriteLine("   surprise when testing by hand.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Rules()
{
    Console.WriteLine("4. Which failures are loud and which are silent");
    Console.WriteLine();
    Console.WriteLine("   what went wrong                              result");
    Console.WriteLine("   ---------------                              ------");
    Console.WriteLine("   required query value missing or unparseable  400   LOUD");
    Console.WriteLine("   body missing, parameter not nullable         400   LOUD");
    Console.WriteLine("   body is not valid JSON                       400   LOUD");
    Console.WriteLine("   wrong content type                           415   LOUD");
    Console.WriteLine("   route value fails a constraint               404   loud-ish");
    Console.WriteLine("   optional query value unparseable             400   LOUD");
    Console.WriteLine("   defaulted query value unparseable            400   LOUD");
    Console.WriteLine("   optional query value ABSENT                  200   by design");
    Console.WriteLine("   query value present, negative or absurd      200   SILENT");
    Console.WriteLine("   JSON property misspelled                     200   SILENT");
    Console.WriteLine("   JSON property omitted                        200   SILENT");
    Console.WriteLine("   extra JSON property sent                     200   SILENT");
    Console.WriteLine();
    Console.WriteLine("   THE PATTERN IS WORTH STATING BECAUSE IT IS NOT ARBITRARY, AND IT IS");
    Console.WriteLine("   NOT WHERE PEOPLE EXPECT IT:");
    Console.WriteLine();
    Console.WriteLine("     PARAMETERS fail loudly. A query or route value that is present and");
    Console.WriteLine("     will not parse is a 400 whatever the parameter type.");
    Console.WriteLine();
    Console.WriteLine("     BODY PROPERTIES fail silently. A property that does not match is");
    Console.WriteLine("     skipped and left at its default, and nothing records that it");
    Console.WriteLine("     happened.");
    Console.WriteLine();
    Console.WriteLine("   The asymmetry has a cause. A parameter is a single value with a");
    Console.WriteLine("   declared type, so failing to produce it is unambiguous. A body is a");
    Console.WriteLine("   document being mapped onto an object, and JSON deserialisation is");
    Console.WriteLine("   permissive by design - unknown members are ignored so that a client");
    Console.WriteLine("   adding a field does not break an older server.");
    Console.WriteLine();
    Console.WriteLine("   That permissiveness is a genuine feature for forward compatibility");
    Console.WriteLine("   and it is the reason a misspelling costs you a zero rather than an");
    Console.WriteLine("   error.");
    Console.WriteLine();
    Console.WriteLine("   And note the row that is silent for neither reason: a value that");
    Console.WriteLine("   parses and is absurd. ?page=-5 binds to -5 and an amount of 0 binds");
    Console.WriteLine("   to 0. Nothing about binding has an opinion on that.");
    Console.WriteLine();
    Console.WriteLine("   The practical rule: BINDING IS NOT VALIDATION. Binding answers 'can");
    Console.WriteLine("   I produce a value of this type', and the answer is yes far more");
    Console.WriteLine("   often than you want. Whether the value makes sense is a separate");
    Console.WriteLine("   question, asked separately, in the module after this one.");
}

// ---------------------------------------------------------------------------
static async Task<string> DescribeAsync(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.GetAsync(path);

    if (!response.IsSuccessStatusCode)
    {
        return $"{(int)response.StatusCode}";
    }

    using JsonDocument document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    JsonElement page = document.RootElement.GetProperty("page");

    return page.ValueKind == JsonValueKind.Null ? "page=null" : $"page={page}";
}

static async Task<string> PostRawAsync(HttpClient http, string path, string body,
    string? contentType)
{
    using var content = new StringContent(body, Encoding.UTF8);
    content.Headers.ContentType = contentType is null
        ? null
        : new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);

    using HttpResponseMessage response = await http.PostAsync(path, content);
    return $"{(int)response.StatusCode}";
}

// ---------------------------------------------------------------------------
public sealed class CreatePayment
{
    public long AmountMinor { get; set; }

    public string? Currency { get; set; }

    public string? Reference { get; set; }
}
