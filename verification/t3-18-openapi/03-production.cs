// 03-production.cs — The document said it could not happen.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every conformance count here is computed by checking real
// responses against the served document, and is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.OpenApi@10.0.10
#:package Microsoft.OpenApi@2.11.0

using System.Text.Json;
using Microsoft.AspNetCore.Http.HttpResults;

Console.WriteLine("An incident: 'your API is returning invalid responses'");
Console.WriteLine();

TheIncident();
await WhatTheDocumentPromised();
await WhyNothingCaughtIt();
await TheContractTest();
WhatToWatch();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. What was seen");
    Console.WriteLine();
    Console.WriteLine("   Ledger publishes an OpenAPI document. A partner generated a client from");
    Console.WriteLine("   it, in a language whose generator produces strict deserialisers - a");
    Console.WriteLine("   missing required property is an exception, not a null.");
    Console.WriteLine();
    Console.WriteLine("     Tue 14:20   The partner reports that roughly one call in nine fails");
    Console.WriteLine("                 client-side with a deserialisation error. They send the");
    Console.WriteLine("                 stack trace. It names a property.");
    Console.WriteLine();
    Console.WriteLine("     Tue 14:35   Ledger checks its dashboards. 200s throughout, p99");
    Console.WriteLine("                 unchanged, no exceptions, no 5xx. The graphs are clean");
    Console.WriteLine("                 because from the server's side NOTHING IS WRONG.");
    Console.WriteLine();
    Console.WriteLine("     Tue 15:10   Ledger cannot reproduce it. Their integration tests pass.");
    Console.WriteLine("                 Their own SDK works. Postman works.");
    Console.WriteLine();
    Console.WriteLine("     Tue 16:45   Someone finally compares a real response against the");
    Console.WriteLine("                 published document rather than against the C# type.");
    Console.WriteLine();
    Console.WriteLine("   THE SHAPE TO NOTICE: THE SERVER IS BEHAVING CORRECTLY AND THE DOCUMENT");
    Console.WriteLine("   IS WRONG. Every instinct in an incident points at the running code, and");
    Console.WriteLine("   here the running code is fine. The defect is in an artefact nobody");
    Console.WriteLine("   thinks of as code, that no test exercises, and that a third party is");
    Console.WriteLine("   depending on more literally than anyone at Ledger realised.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatTheDocumentPromised()
{
    Console.WriteLine("2. The document and the responses, side by side");
    Console.WriteLine();

    var app = BrokenApp();
    await app.StartAsync();

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    using JsonDocument document = JsonDocument.Parse(
        await http.GetStringAsync("/openapi/v1.json"));

    JsonElement documented = Documented(document, "/v1/payments/{id}", "200");

    Console.WriteLine("   WHAT THE DOCUMENT PROMISES FOR 200:");
    Console.WriteLine();
    Console.WriteLine($"     required   {Required(documented)}");
    Console.WriteLine($"     properties {Properties(documented)}");
    Console.WriteLine();
    Console.WriteLine("   WHAT NINE REAL RESPONSES CONTAINED:");
    Console.WriteLine();
    Console.WriteLine("   payment    status      conforms   what is missing or wrong");
    Console.WriteLine("   -------    ------      --------   ------------------------");

    int failures = 0;

    for (int n = 1; n <= 9; n++)
    {
        string id = $"PAY-{n:000}";
        string body = await http.GetStringAsync($"/v1/payments/{id}");

        using JsonDocument response = JsonDocument.Parse(body);
        string[] problems = Check(response.RootElement, documented);

        if (problems.Length > 0)
        {
            failures++;
        }

        Console.WriteLine($"   {id,-10} {response.RootElement.GetProperty("status").GetString(),-11} " +
            $"{(problems.Length == 0 ? "yes" : "NO"),-10} {string.Join("; ", problems)}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine($"   {failures} of 9 responses did not match the document Ledger publishes.");
    Console.WriteLine();
    Console.WriteLine("   AND THE PATTERN IS THE REASON IT TOOK SO LONG: ONLY THE FAILED");
    Console.WriteLine("   PAYMENTS BREAK, AND THEY BREAK TWICE. A declined payment is a");
    Console.WriteLine("   different record, so it carries a failureCode the document never");
    Console.WriteLine("   mentions AND omits the failureReason the document requires. A captured");
    Console.WriteLine("   payment matches perfectly, because it is the record the .Produces");
    Console.WriteLine("   names.");
    Console.WriteLine();
    Console.WriteLine("   NOBODY AT LEDGER TESTS WITH FAILED PAYMENTS AS A MATTER OF ROUTINE, and");
    Console.WriteLine("   in staging the gateway is a stub that captures everything. 'One call in");
    Console.WriteLine("   nine' is the partner's failure rate, and it is also Ledger's decline");
    Console.WriteLine("   rate. THE BUG IS PROPORTIONAL TO A BUSINESS METRIC, which is why it");
    Console.WriteLine("   looked intermittent.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhyNothingCaughtIt()
{
    Console.WriteLine("3. Why every existing test passed");
    Console.WriteLine();

    var app = BrokenApp();
    await app.StartAsync();

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    // The test Ledger actually had.
    string json = await http.GetStringAsync("/v1/payments/PAY-009");
    Payment? deserialised = JsonSerializer.Deserialize<Payment>(json,
        new JsonSerializerOptions(JsonSerializerDefaults.Web));

    Console.WriteLine("   THE TEST LEDGER HAD:");
    Console.WriteLine();
    Console.WriteLine("     var payment = await client.GetFromJsonAsync<Payment>(\"/v1/payments/PAY-009\");");
    Console.WriteLine("     Assert.Equal(\"failed\", payment.Status);");
    Console.WriteLine();
    Console.WriteLine($"     result   deserialised to {(deserialised is null ? "null" : "a Payment")}, " +
        $"status '{deserialised?.Status}' - THE ASSERTION PASSES");
    Console.WriteLine();
    Console.WriteLine("   READ THAT RESULT AGAIN. THE RESPONSE WAS A FailedPayment AND IT");
    Console.WriteLine("   DESERIALISED CLEANLY INTO Payment. System.Text.Json ignores the");
    Console.WriteLine("   failureCode it does not recognise and leaves the failureReason it");
    Console.WriteLine("   cannot find as null. The exact mismatch that throws in the partner's");
    Console.WriteLine("   strict client is absorbed silently here.");
    Console.WriteLine();
    Console.WriteLine("   IT PASSES BECAUSE IT DESERIALISES INTO THE SERVER'S OWN TYPE. Both");
    Console.WriteLine("   sides of that test came out of the same assembly, so it can only ever");
    Console.WriteLine("   confirm that the server agrees with itself. THE DOCUMENT IS NOT IN THE");
    Console.WriteLine("   TEST, so the document cannot fail it.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE WHOLE CLASS OF BUG. Anything in the document that is a");
    Console.WriteLine("   CLAIM rather than a CONSEQUENCE - a .Produces, a description, a");
    Console.WriteLine("   transformer, a hand-written example - is unverified by construction,");
    Console.WriteLine("   and the tests that look like they cover it do not touch it.");
    Console.WriteLine();

    // What the endpoint declares, against what it returns.
    using JsonDocument document = JsonDocument.Parse(
        await http.GetStringAsync("/openapi/v1.json"));

    Console.WriteLine("   THE LINE THAT CAUSED IT:");
    Console.WriteLine();
    Console.WriteLine("     app.MapGet(\"/v1/payments/{id}\", (string id) => Results.Ok(Load(id)))");
    Console.WriteLine("        .Produces<Payment>(StatusCodes.Status200OK);");
    Console.WriteLine();
    Console.WriteLine("   .Produces<Payment>() WAS TRUE WHEN IT WAS WRITTEN. Six months later a");
    Console.WriteLine("   handler started returning FailedPayment for declines - a different");
    Console.WriteLine("   record, with a failureCode - and nothing anywhere objected. The");
    Console.WriteLine("   compiler did not, because the handler returns IResult and IResult");
    Console.WriteLine("   accepts anything. The tests did not, for the reason above.");
    Console.WriteLine();
    Console.WriteLine($"   the document still says   200 -> {Reference(document)}");
    Console.WriteLine("   the handler now returns   Payment or FailedPayment, depending");
    Console.WriteLine();

    await app.StopAsync();
    await app.DisposeAsync();
}

// ---------------------------------------------------------------------------
static async Task TheContractTest()
{
    Console.WriteLine("4. The test that would have caught it, and the fix");
    Console.WriteLine();
    Console.WriteLine("   The missing test is one sentence: FETCH THE DOCUMENT THIS BUILD SERVES,");
    Console.WriteLine("   and check real responses against it. Run against both versions:");
    Console.WriteLine();

    Console.WriteLine("   version                     responses checked   conform   fail");
    Console.WriteLine("   -------                     -----------------   -------   ----");

    foreach ((string label, Func<WebApplication> factory) in
        new (string, Func<WebApplication>)[] { ("as deployed", BrokenApp), ("fixed", FixedApp) })
    {
        var app = factory();
        await app.StartAsync();

        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        using JsonDocument document = JsonDocument.Parse(
            await http.GetStringAsync("/openapi/v1.json"));

        JsonElement documented = Documented(document, "/v1/payments/{id}", "200");

        int conform = 0;
        int fail = 0;

        for (int n = 1; n <= 9; n++)
        {
            using JsonDocument response = JsonDocument.Parse(
                await http.GetStringAsync($"/v1/payments/PAY-{n:000}"));

            if (Check(response.RootElement, documented).Length == 0)
            {
                conform++;
            }
            else
            {
                fail++;
            }
        }

        Console.WriteLine($"   {label,-27} {9,17}   {conform,7}   {fail,4}");

        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIX WAS NOT TO CORRECT THE .Produces LINE. That would make the");
    Console.WriteLine("   document true today and leave it able to lie again tomorrow. The fix is");
    Console.WriteLine("   to make the outcome part of the signature, so the compiler holds it:");
    Console.WriteLine();
    Console.WriteLine("     app.MapGet(\"/v1/payments/{id}\",");
    Console.WriteLine("         Results<Ok<PaymentView>, NotFound> (string id) => ...);");
    Console.WriteLine();
    Console.WriteLine("   WITH ONE RESPONSE TYPE COVERING BOTH CASES - a nullable failureCode on");
    Console.WriteLine("   a single PaymentView, rather than two records the handler chooses");
    Console.WriteLine("   between. TWO SHAPES FOR ONE STATUS CODE IS THE ROOT DEFECT; the");
    Console.WriteLine("   document could not describe it because it should not have existed.");
    Console.WriteLine();
    Console.WriteLine("   AND THE CONTRACT TEST STAYS, because the signature fixes only the");
    Console.WriteLine("   things a signature can reach. Descriptions, examples, transformers and");
    Console.WriteLine("   every .ProducesProblem are still claims, and the test is the only thing");
    Console.WriteLine("   that ever checks them.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatToWatch()
{
    Console.WriteLine("5. What to put in the build");
    Console.WriteLine();
    Console.WriteLine("   COMMIT THE GENERATED DOCUMENT AND DIFF IT ON EVERY PULL REQUEST. This");
    Console.WriteLine("   is the single highest-value practice in the module. It turns a change");
    Console.WriteLine("   to your public contract into something a reviewer SEES, next to the");
    Console.WriteLine("   code that caused it, instead of something a partner discovers. A");
    Console.WriteLine("   renamed property is one line in the diff and a broken client in");
    Console.WriteLine("   production.");
    Console.WriteLine();
    Console.WriteLine("   VALIDATE RESPONSES AGAINST THE DOCUMENT IN INTEGRATION TESTS. Section 4");
    Console.WriteLine("   is thirty lines. Every test you already have can assert conformance as");
    Console.WriteLine("   well as behaviour, and the ones covering error paths are the ones that");
    Console.WriteLine("   matter, because those are the responses nobody looks at.");
    Console.WriteLine();
    Console.WriteLine("   FAIL THE BUILD ON AN UNDOCUMENTED ENDPOINT. An endpoint with no");
    Console.WriteLine("   summary, or a 200 with no response type, is a gap somebody will fill");
    Console.WriteLine("   with a guess. It is a loop over the document, not a policy document.");
    Console.WriteLine();
    Console.WriteLine("   GENERATE A CLIENT FROM YOUR OWN DOCUMENT AND USE IT IN ONE TEST. It is");
    Console.WriteLine("   the only way to experience what a caller experiences. Ledger's own SDK");
    Console.WriteLine("   was hand-written against the C# types and so shared every one of the");
    Console.WriteLine("   server's assumptions.");
    Console.WriteLine();
    Console.WriteLine("   AND THE REVIEW QUESTION THAT COSTS NOTHING: FOR ANY LINE IN THE");
    Console.WriteLine("   DOCUMENT, WHAT WOULD FAIL IF IT BECAME FALSE? If the answer is");
    Console.WriteLine("   'nothing', it will be false eventually, and you have just decided how");
    Console.WriteLine("   you find out - from a partner, or from your build.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// The application as deployed: one status code, two response shapes, and a
// .Produces that describes only one of them.
static WebApplication BrokenApp()
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddOpenApi();

    var app = builder.Build();
    app.MapOpenApi();

    app.MapGet("/v1/payments/{id}", (string id) =>
        {
            int n = int.Parse(id.Split('-')[1]);

            // Every ninth payment is declined, and a declined payment is a
            // DIFFERENT RECORD. This is the change that was made six months
            // after the .Produces below was written.
            return n % 9 == 0
                ? Results.Ok<object>(new FailedPayment(id, "failed", 4999, "GBP", "card_declined"))
                : Results.Ok<object>(new Payment(id, "captured", 4999, "GBP", null));
        })
        .Produces<Payment>(StatusCodes.Status200OK);

    return app;
}

// ---------------------------------------------------------------------------
// One shape for one status code, stated in the signature.
static WebApplication FixedApp()
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddOpenApi();

    var app = builder.Build();
    app.MapOpenApi();

    app.MapGet("/v1/payments/{id}", Results<Ok<PaymentView>, NotFound> (string id) =>
    {
        int n = int.Parse(id.Split('-')[1]);

        return TypedResults.Ok(n % 9 == 0
            ? new PaymentView(id, "failed", 4999, "GBP", "card_declined")
            : new PaymentView(id, "captured", 4999, "GBP", null));
    });

    return app;
}

// ---------------------------------------------------------------------------
// The documented schema for one status code of one operation, with any $ref
// followed back to components/schemas.
static JsonElement Documented(JsonDocument document, string path, string status)
{
    JsonElement schema = document.RootElement
        .GetProperty("paths").GetProperty(path).GetProperty("get")
        .GetProperty("responses").GetProperty(status)
        .GetProperty("content").EnumerateObject().First().Value
        .GetProperty("schema");

    return schema.TryGetProperty("$ref", out JsonElement reference)
        ? document.RootElement.GetProperty("components").GetProperty("schemas")
            .GetProperty(reference.GetString()!.Split('/').Last())
        : schema;
}

// ---------------------------------------------------------------------------
// A deliberately small conformance check: are the required keys present, and
// is every key in the response one the schema describes. That is enough to
// catch this class of drift, and it is the check a strict generated client
// performs on the caller's behalf.
static string[] Check(JsonElement response, JsonElement schema)
{
    var problems = new List<string>();

    if (schema.TryGetProperty("required", out JsonElement required))
    {
        foreach (JsonElement name in required.EnumerateArray())
        {
            if (!response.TryGetProperty(name.GetString()!, out _))
            {
                problems.Add($"missing required '{name.GetString()}'");
            }
        }
    }

    if (schema.TryGetProperty("properties", out JsonElement properties))
    {
        foreach (JsonProperty property in response.EnumerateObject())
        {
            if (!properties.TryGetProperty(property.Name, out _))
            {
                problems.Add($"undocumented '{property.Name}'");
            }
        }
    }

    return [.. problems];
}

// ---------------------------------------------------------------------------
static string Required(JsonElement schema) =>
    schema.TryGetProperty("required", out JsonElement r)
        ? string.Join(", ", r.EnumerateArray().Select(e => e.GetString()))
        : "none";

// ---------------------------------------------------------------------------
static string Properties(JsonElement schema) =>
    schema.TryGetProperty("properties", out JsonElement p)
        ? string.Join(", ", p.EnumerateObject().Select(e => e.Name))
        : "none";

// ---------------------------------------------------------------------------
static string Reference(JsonDocument document)
{
    JsonElement schema = document.RootElement
        .GetProperty("paths").GetProperty("/v1/payments/{id}").GetProperty("get")
        .GetProperty("responses").GetProperty("200")
        .GetProperty("content").EnumerateObject().First().Value
        .GetProperty("schema");

    return schema.TryGetProperty("$ref", out JsonElement reference)
        ? reference.GetString()!.Split('/').Last()
        : "an inline schema";
}

// ---------------------------------------------------------------------------
record Payment(string Id, string Status, long AmountMinor, string Currency, string? FailureReason);

record FailedPayment(string Id, string Status, long AmountMinor, string Currency, string FailureCode);

record PaymentView(string Id, string Status, long AmountMinor, string Currency, string? FailureCode);
