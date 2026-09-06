// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every status code and outcome here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Text.Json;
using System.Text.Json.Serialization;

One();
Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static void One()
{
    Console.WriteLine("EXERCISE 1 (easy) - four changes, which need a version");
    Console.WriteLine();
    Console.WriteLine("   For each change, say whether a client compiled against the old");
    Console.WriteLine("   contract keeps working:");
    Console.WriteLine();
    Console.WriteLine("     a. the response gains a 'settledAt' field");
    Console.WriteLine("     b. the response's 'amount' is renamed to 'amountMinor'");
    Console.WriteLine("     c. the request gains an optional 'reference' field");
    Console.WriteLine("     d. the request's 'reference' becomes required");
    Console.WriteLine();

    Console.WriteLine("   change                            old client                needs a version");
    Console.WriteLine("   ------                            ----------                ---------------");

    Response("a. a field added",
        """{"id":"PAY-1","amount":50000,"currency":"GBP","settledAt":"2026-01-01"}""");

    Response("b. a field renamed",
        """{"id":"PAY-1","amountMinor":50000,"currency":"GBP"}""");

    Request<RequestWithOptional>("c. optional field added",
        """{"paymentId":"PAY-1","amount":50000}""");

    Request<RequestWithRequired>("d. that field made required",
        """{"paymentId":"PAY-1","amount":50000}""");

    Console.WriteLine();
    Console.WriteLine("   ANSWERS: (a) and (c) are safe, (b) and (d) are breaking.");
    Console.WriteLine();
    Console.WriteLine("   (a) A NEW RESPONSE FIELD IS IGNORED by a client that has never heard");
    Console.WriteLine("   of it. This is the change people version for most often and need to");
    Console.WriteLine("   least.");
    Console.WriteLine();
    Console.WriteLine("   (b) A RENAME IS A REMOVAL AND AN ADDITION. The old field is gone, so");
    Console.WriteLine("   the client's property takes its default - and note the outcome column:");
    Console.WriteLine("   it did not throw. It read an amount of 0 and carried on.");
    Console.WriteLine();
    Console.WriteLine("   (c) AN OPTIONAL REQUEST FIELD costs the old client nothing, because it");
    Console.WriteLine("   simply does not send it.");
    Console.WriteLine();
    Console.WriteLine("   (d) A REQUIRED REQUEST FIELD is breaking, and it is the row that");
    Console.WriteLine("   catches people, because on the server it looks exactly as additive as");
    Console.WriteLine("   (a). The direction is what matters: YOU MAY ALWAYS GIVE MORE, AND");
    Console.WriteLine("   NEVER DEMAND MORE.");
    Console.WriteLine();

    static void Response(string label, string json)
    {
        string outcome;
        bool breaks;

        try
        {
            var payment = JsonSerializer.Deserialize<PaymentV1>(json, Options());

            outcome = $"{payment!.Id}, amount {payment.Amount}";
            breaks = payment.Amount == 0;
        }
        catch (Exception exception)
        {
            outcome = exception.GetType().Name;
            breaks = true;
        }

        Console.WriteLine($"   {label,-32}  {outcome,-24}  {(breaks ? "YES" : "no")}");
    }

    static void Request<T>(string label, string json)
    {
        string outcome;
        bool breaks;

        try
        {
            JsonSerializer.Deserialize<T>(json, Options());
            outcome = "accepted";
            breaks = false;
        }
        catch (Exception exception)
        {
            outcome = $"REJECTED: {exception.GetType().Name}";
            breaks = true;
        }

        Console.WriteLine($"   {label,-32}  {outcome,-24}  {(breaks ? "YES" : "no")}");
    }
}

// ---------------------------------------------------------------------------
static void Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the change that is in no schema");
    Console.WriteLine();
    Console.WriteLine("   A team changes two things and versions neither, because the payload");
    Console.WriteLine("   did not change:");
    Console.WriteLine();
    Console.WriteLine("     - GET /payments/{id} for a payment that does not exist returned 404;");
    Console.WriteLine("       it now returns 200 with an empty body, 'because that is more REST';");
    Console.WriteLine();
    Console.WriteLine("     - GET /payments defaulted to 20 results; it now defaults to 100,");
    Console.WriteLine("       'because clients were paginating too much'.");
    Console.WriteLine();
    Console.WriteLine("   Are these breaking? Show what an existing client does.");
    Console.WriteLine();

    Console.WriteLine("   the client                                before              after");
    Console.WriteLine("   ----------                                ------              -----");

    // A client branching on the status code, as clients do.
    string BeforeStatus(int status) => status == 404 ? "shows 'not found'" : "shows the payment";

    Console.WriteLine($"   {"branches on 404",-40}  {BeforeStatus(404),-18} {BeforeStatus(200)}");

    // A client relying on the default page size.
    int BeforePage(int size) => size;

    Console.WriteLine($"   {"expects one page to be <= 20 rows",-40}  {BeforePage(20),-18} {BeforePage(100)}");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: both are breaking, and neither appears in any schema, any");
    Console.WriteLine("   OpenAPI diff, or any test that checks the shape of a payload.");
    Console.WriteLine();
    Console.WriteLine("   THE STATUS CODE IS PART OF THE CONTRACT. The client above now shows a");
    Console.WriteLine("   payment screen with empty fields instead of 'not found' - which is a");
    Console.WriteLine("   worse failure than an error, because it looks like data.");
    Console.WriteLine();
    Console.WriteLine("   Clients branch on status codes more reliably than on bodies, because");
    Console.WriteLine("   the status is the one part of an HTTP response every library surfaces");
    Console.WriteLine("   the same way.");
    Console.WriteLine();
    Console.WriteLine("   THE DEFAULT IS PART OF THE CONTRACT. A client that omitted the page");
    Console.WriteLine("   size and sized a buffer, a screen or a rate limit around 20 rows now");
    Console.WriteLine("   gets 100. The request did not change; the response did.");
    Console.WriteLine();
    Console.WriteLine("   THE TEST THAT CATCHES BOTH, and every case like them:");
    Console.WriteLine();
    Console.WriteLine("     COULD A CLIENT THAT WORKED YESTERDAY, UNCHANGED, BEHAVE DIFFERENTLY");
    Console.WriteLine("     TODAY?");
    Console.WriteLine();
    Console.WriteLine("   That question covers status codes, defaults, ordering, timing,");
    Console.WriteLine("   pagination limits and error messages - none of which a schema");
    Console.WriteLine("   describes, and all of which clients depend on.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium) - one endpoint changed, the whole API versioned");
    Console.WriteLine();
    Console.WriteLine("   /payments needs a breaking change. /refunds, /invoices and /payouts do");
    Console.WriteLine("   not. With URL versioning, what happens to the other three - and what");
    Console.WriteLine("   are the two ways to avoid it?");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var app = builder.Build();

    // The naive approach: a whole new version namespace, and the three
    // unchanged endpoints duplicated into it.
    RouteGroupBuilder v1 = app.MapGroup("/v1");
    v1.MapGet("/payments/{id}", (string id) => Results.Ok(new { id, amount = 500.00m }));
    v1.MapGet("/refunds/{id}", (string id) => Results.Ok(new { id, state = "pending" }));
    v1.MapGet("/invoices/{id}", (string id) => Results.Ok(new { id, total = 500.00m }));

    RouteGroupBuilder v2 = app.MapGroup("/v2");
    v2.MapGet("/payments/{id}", (string id) => Results.Ok(new { id, amountMinor = 50_000L }));
    v2.MapGet("/refunds/{id}", (string id) => Results.Ok(new { id, state = "pending" }));
    v2.MapGet("/invoices/{id}", (string id) => Results.Ok(new { id, total = 500.00m }));

    // The alternative: only the changed resource moves.
    app.MapGet("/refunds/{id}", (string id) => Results.Ok(new { id, state = "pending" }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   route                    response");
    Console.WriteLine("   -----                    --------");

    foreach (string path in new[]
    {
        "/v1/payments/PAY-1", "/v2/payments/PAY-1",
        "/v1/refunds/REF-1", "/v2/refunds/REF-1", "/refunds/REF-1"
    })
    {
        Console.WriteLine($"   {path,-23}  {await http.GetStringAsync(path)}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: /v1/refunds and /v2/refunds return identical responses, and");
    Console.WriteLine("   every client has to migrate to a v2 that is the same as v1 for");
    Console.WriteLine("   everything except payments.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE REAL COST OF WHOLE-API VERSIONING: a breaking change to one");
    Console.WriteLine("   resource makes work for every client of every resource, and the work");
    Console.WriteLine("   is entirely pointless for most of them.");
    Console.WriteLine();
    Console.WriteLine("   TWO WAYS TO AVOID IT:");
    Console.WriteLine();
    Console.WriteLine("     1. VERSION THE RESOURCE, NOT THE API. /v2/payments alongside");
    Console.WriteLine("        /v1/payments, and /refunds unversioned or left at /v1. It is the");
    Console.WriteLine("        third row above versus the fifth. The cost is that 'what version");
    Console.WriteLine("        is this API' stops having an answer, and every document, client");
    Console.WriteLine("        and support conversation has to be about a specific resource.");
    Console.WriteLine();
    Console.WriteLine("     2. MEDIA TYPE VERSIONING, where the version belongs to the");
    Console.WriteLine("        representation. /payments can be at version 3 while /refunds is at");
    Console.WriteLine("        version 1, with one URL each. This is the case media types are");
    Console.WriteLine("        genuinely for, and it is the only one.");
    Console.WriteLine();
    Console.WriteLine("   AND THE THIRD ANSWER, WHICH IS USUALLY THE RIGHT ONE: DO NOT MAKE THE");
    Console.WriteLine("   BREAKING CHANGE. Add 'amountMinor' next to 'amount', populate both,");
    Console.WriteLine("   document the old one as deprecated, and remove it in two years when");
    Console.WriteLine("   the telemetry says nobody reads it.");
    Console.WriteLine();
    Console.WriteLine("   That costs one redundant field and no version at all - and a redundant");
    Console.WriteLine("   field is cheaper than a version by an enormous margin.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - retire v1 without an outage");
    Console.WriteLine();
    Console.WriteLine("   v1 has been deprecated for six months. Design the retirement so that");
    Console.WriteLine("   no caller is broken without somebody having decided to break it.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var app = builder.Build();

    Stage stage = Stage.Live;

    RouteGroupBuilder v1 = app.MapGroup("/v1");

    v1.AddEndpointFilter(async (context, next) =>
    {
        HttpResponse response = context.HttpContext.Response;

        response.Headers["Sunset"] = "Wed, 01 Jul 2026 00:00:00 GMT";
        response.Headers["Deprecation"] = "Wed, 01 Jan 2026 00:00:00 GMT";
        response.Headers["Link"] =
            "<https://docs.ledger.example/v2/migration>; rel=\"deprecation\"";

        // The brown-out and the retirement are the same code path with a
        // different flag, which is what makes the rehearsal honest.
        if (stage != Stage.Live)
        {
            return Results.Problem(
                title: "This API version has been retired",
                detail: "Use /v2/payments. See https://docs.ledger.example/v2/migration",
                statusCode: 410);
        }

        return await next(context);
    });

    v1.MapGet("/payments/{id}", (string id) => Results.Ok(new { id, amount = 500.00m }));

    app.MapGroup("/v2").MapGet("/payments/{id}", (string id) =>
        Results.Ok(new { id, amountMinor = 50_000L }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   stage                     GET /v1/...   Sunset sent   body");
    Console.WriteLine("   -----                     -----------   -----------   ----");

    foreach (Stage current in new[] { Stage.Live, Stage.BrownOut, Stage.Retired })
    {
        stage = current;

        using HttpResponseMessage response = await http.GetAsync("/v1/payments/PAY-1");
        string body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   {Describe(current),-24}  {(int)response.StatusCode,11}   " +
            $"{(response.Headers.Contains("Sunset") ? "yes" : "no"),-11}   " +
            $"{(body.Length > 60 ? body[..60] + "..." : body)}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: five things, and the order is the design.");
    Console.WriteLine();
    Console.WriteLine("   1. COUNT PER VERSION AND PER CALLER, from the day v2 shipped. Without");
    Console.WriteLine("      this every later step is guesswork.");
    Console.WriteLine();
    Console.WriteLine("   2. SEND Sunset, Deprecation AND Link on every v1 response, also from");
    Console.WriteLine("      the day v2 shipped. A machine-readable warning reaches callers no");
    Console.WriteLine("      email can.");
    Console.WriteLine();
    Console.WriteLine("   3. CONTACT THE CALLERS THE TELEMETRY IDENTIFIES - not the account");
    Console.WriteLine("      list, which is a different set.");
    Console.WriteLine();
    Console.WriteLine("   4. BROWN OUT. Return 410 for two hours on an announced day, then");
    Console.WriteLine("      restore v1. Note the second row above: the brown-out and the");
    Console.WriteLine("      retirement are THE SAME CODE PATH with a different flag, so the");
    Console.WriteLine("      rehearsal tests what the real thing will do.");
    Console.WriteLine();
    Console.WriteLine("      Anybody still calling v1 discovers it while you are watching, while");
    Console.WriteLine("      it is reversible, and while it is a two-hour inconvenience rather");
    Console.WriteLine("      than an outage.");
    Console.WriteLine();
    Console.WriteLine("   5. RETIRE ON A CONDITION, NOT A DATE. When traffic is zero, or when");
    Console.WriteLine("      what remains is understood and somebody has accepted breaking it.");
    Console.WriteLine();
    Console.WriteLine("   410 RATHER THAN 404, and with a body. 404 says the path does not exist");
    Console.WriteLine("   and invites a search for a typo; 410 says it existed and was removed,");
    Console.WriteLine("   and the detail tells whoever is debugging exactly where to go.");
    Console.WriteLine();
    Console.WriteLine("   THE DEEPER POINT is that retirement is the expensive half of");
    Console.WriteLine("   versioning and the half nobody plans for. Creating v2 is an afternoon;");
    Console.WriteLine("   removing v1 is a project with other people's calendars in it, and it");
    Console.WriteLine("   is the reason the cheapest version is the one you did not create.");

    static string Describe(Stage stage) => stage switch
    {
        Stage.Live => "deprecated but working",
        Stage.BrownOut => "brown-out, two hours",
        _ => "retired"
    };
}

// ---------------------------------------------------------------------------
static JsonSerializerOptions Options() => new() { PropertyNameCaseInsensitive = true };

enum Stage { Live, BrownOut, Retired }

// The client's type, compiled against the old contract.
public sealed record PaymentV1(string Id, long Amount, string Currency);

public sealed record RequestWithOptional(string PaymentId, long Amount)
{
    public string? Reference { get; init; }
}

public sealed record RequestWithRequired(string PaymentId, long Amount)
{
    public required string Reference { get; init; }
}
