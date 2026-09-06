// 03-production.cs — One API, five error shapes, and what that costs the people
// calling it. Then the single place that fixes it.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every content type and field name here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Diagnostics;
using System.Text.Json;

await Drift();
await OnePolicy();
Incident();
Checklist();

// ---------------------------------------------------------------------------
static async Task Drift()
{
    Console.WriteLine("1. Five ways the same API says no");
    Console.WriteLine();
    Console.WriteLine("   Nobody designed this. Each endpoint was written by somebody doing a");
    Console.WriteLine("   reasonable thing in the idiom they had in front of them at the time.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();
    builder.Services.AddExceptionHandler<CatchAll>();

    var app = builder.Build();
    app.UseExceptionHandler();

    // No UseStatusCodePages. Nobody left it out on purpose; the exception
    // handler was added during an incident and this half was not.

    // Written in 2023, the first endpoint anybody wrote.
    app.MapGet("/v1/payments/{id}", (string id) => Results.NotFound());

    // Written by somebody who wanted the client to see a reason.
    app.MapPost("/v1/refunds", () =>
        Results.BadRequest(new { error = "refund window has closed" }));

    // Written by somebody who had read the RFC.
    app.MapPost("/v1/payouts", () =>
        Results.Problem(title: "Payout account not verified", statusCode: 409));

    // Written with the validation helper.
    app.MapPost("/v1/invoices", () => Results.ValidationProblem(
        new Dictionary<string, string[]> { ["currency"] = ["must be a three-letter code"] }));

    // Written by somebody who let it throw and trusted the handler.
    app.MapPost("/v1/settlements", void () =>
        throw new InvalidOperationException("ledger closed for the period"));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   endpoint            status   content type                fields");
    Console.WriteLine("   --------            ------   ------------                ------");

    foreach (Call call in Calls())
    {
        Shape shape = await ShapeAsync(http, call);

        Console.WriteLine($"   {call.Label,-18}  {shape.Status,6}   {shape.ContentType,-26}  {shape.Fields}");
    }

    Console.WriteLine();
    Console.WriteLine("   THREE CONTENT TYPES AND FOUR FIELD SETS, in one API, all of them");
    Console.WriteLine("   individually defensible. This is what error handling looks like when");
    Console.WriteLine("   it is a decision made per endpoint rather than once.");
    Console.WriteLine();
    Console.WriteLine("   The cost does not land on you. It lands in the client, as code that");
    Console.WriteLine("   has to read every one of them:");
    Console.WriteLine();
    Console.WriteLine("     if (body has 'error')       message = body.error;");
    Console.WriteLine("     else if (body has 'title')  message = body.title;");
    Console.WriteLine("     else if (body has 'errors') message = flatten(body.errors);");
    Console.WriteLine("     else if (body is empty)     message = statusText(status);");
    Console.WriteLine();
    Console.WriteLine("   Every branch of that was written after an incident in which the");
    Console.WriteLine("   previous version showed a blank error dialog. And it is only correct");
    Console.WriteLine("   until somebody adds a sixth endpoint.");
    Console.WriteLine();
    Console.WriteLine("   NOTICE WHICH ROW IS WORST. It is not the inconsistent one - it is the");
    Console.WriteLine("   404 with no body at all, which cannot tell the client whether the");
    Console.WriteLine("   payment does not exist, the route was wrong, or a proxy answered.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task OnePolicy()
{
    Console.WriteLine("2. The same five endpoints under one policy");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // ONE PLACE. Everything written through the problem details service passes
    // through this, so a field added here appears in every error the API can
    // produce - including the ones the framework produces without being asked.
    builder.Services.AddProblemDetails(options =>
        options.CustomizeProblemDetails = context =>
        {
            // Where the problem happened. Standard, and almost always omitted.
            context.ProblemDetails.Instance =
                $"{context.HttpContext.Request.Method} {context.HttpContext.Request.Path}";

            // An extension member of our own, so support can quote one string.
            context.ProblemDetails.Extensions["service"] = "ledger-api";

            // A type URI for anything that has not got one. The built-in
            // defaults already supply one for every standard status, so this
            // only fills gaps a custom status would leave.
            context.ProblemDetails.Type ??=
                $"https://ledger.example/problems/http-{context.ProblemDetails.Status}";
        });

    builder.Services.AddExceptionHandler<CatchAll>();

    var app = builder.Build();
    app.UseExceptionHandler();
    app.UseStatusCodePages();

    app.MapGet("/v1/payments/{id}", (string id) => Results.NotFound());

    // The one endpoint that has to change: an anonymous object cannot become a
    // problem document, because nothing knows it is one.
    app.MapPost("/v1/refunds", () =>
        Results.Problem(title: "Refund window has closed", statusCode: 400));

    app.MapPost("/v1/payouts", () =>
        Results.Problem(title: "Payout account not verified", statusCode: 409));

    app.MapPost("/v1/invoices", () => Results.ValidationProblem(
        new Dictionary<string, string[]> { ["currency"] = ["must be a three-letter code"] }));

    app.MapPost("/v1/settlements", void () =>
        throw new InvalidOperationException("ledger closed for the period"));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   endpoint            status   content type                fields");
    Console.WriteLine("   --------            ------   ------------                ------");

    foreach (Call call in Calls())
    {
        Shape shape = await ShapeAsync(http, call);

        Console.WriteLine($"   {call.Label,-18}  {shape.Status,6}   {shape.ContentType,-26}  {shape.Fields}");
    }

    Console.WriteLine();
    Console.WriteLine("   one of them in full:");
    Console.WriteLine();

    using HttpResponseMessage sample = await http.GetAsync("/v1/payments/PAY-9");
    Console.WriteLine($"     {await sample.Content.ReadAsStringAsync()}");

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   ONE CONTENT TYPE, ONE FIELD SET, AND THE EMPTY 404 IS GONE. The");
    Console.WriteLine("   client branch collapses to reading title, and every response carries");
    Console.WriteLine("   an id, a route and a service name that nobody had to remember to add.");
    Console.WriteLine();
    Console.WriteLine("   WHAT CustomizeProblemDetails REACHES, and what it does not, is the");
    Console.WriteLine("   part worth internalising. It runs for documents produced THROUGH the");
    Console.WriteLine("   problem details service: Results.Problem, Results.ValidationProblem,");
    Console.WriteLine("   the status code pages, an exception handler that calls TryWriteAsync,");
    Console.WriteLine("   and the automatic 400 from a validating controller.");
    Console.WriteLine();
    Console.WriteLine("   It does NOT run for a hand-written JSON object, because nothing marks");
    Console.WriteLine("   that object as an error. That is the whole reason the refund endpoint");
    Console.WriteLine("   had to change - and the reason to route every error through the");
    Console.WriteLine("   service even when a bare object would have been shorter.");
    Console.WriteLine();
    Console.WriteLine("   ONE FIELD DESERVES ITS OWN NOTE. ValidationProblemDetails is a problem");
    Console.WriteLine("   document with an 'errors' member: a map from field name to messages.");
    Console.WriteLine("   It is not a competing shape, it is the standard one with an extension,");
    Console.WriteLine("   which is why the same client parser reads both.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Incident()
{
    Console.WriteLine("3. The incident");
    Console.WriteLine();
    Console.WriteLine("   A payments API. A partner integration has been live for a year. At");
    Console.WriteLine("   09:14 the partner's support queue starts filling with customers who");
    Console.WriteLine("   say their card was charged twice.");
    Console.WriteLine();
    Console.WriteLine("   WHAT THE PARTNER COULD SEE. Their client had recorded, for each failed");
    Console.WriteLine("   attempt, an HTTP status and a body. The bodies were:");
    Console.WriteLine();
    Console.WriteLine("     500  (empty)");
    Console.WriteLine();
    Console.WriteLine("   That is the entire evidence available to the person reporting the");
    Console.WriteLine("   problem, and it is why the first ninety minutes went into arguing");
    Console.WriteLine("   about whether the requests had reached the API at all.");
    Console.WriteLine();
    Console.WriteLine("   WHAT WAS ACTUALLY HAPPENING. A payment intent that had already been");
    Console.WriteLine("   captured was being captured again; the gateway client threw; the");
    Console.WriteLine("   exception reached Kestrel; the caller got an empty 500 and, following");
    Console.WriteLine("   ordinary retry advice for a 500, RETRIED.");
    Console.WriteLine();
    Console.WriteLine("   Two failures compounded, and only one of them is about errors:");
    Console.WriteLine();
    Console.WriteLine("     - the double capture was possible at all (idempotency, from the HTTP");
    Console.WriteLine("       module - a reserved key would have made the second attempt a");
    Console.WriteLine("       no-op);");
    Console.WriteLine();
    Console.WriteLine("     - the response was a 500 with nothing in it, so a permanent");
    Console.WriteLine("       condition was indistinguishable from a transient one, and the");
    Console.WriteLine("       client did the reasonable thing with a 500.");
    Console.WriteLine();
    Console.WriteLine("   HOW THE ERROR CONTRACT WOULD HAVE CHANGED IT. An AlreadyCapturedException");
    Console.WriteLine("   translated at the edge is a 409 with a type URI. A 409 is not");
    Console.WriteLine("   retryable, so the client stops after one attempt and reports something");
    Console.WriteLine("   the customer can act on. No second charge, and no ninety minutes.");
    Console.WriteLine();
    Console.WriteLine("   THE STATUS CODE IS AN INSTRUCTION TO A MACHINE. Returning 500 for a");
    Console.WriteLine("   condition that will never succeed is not merely uninformative, it");
    Console.WriteLine("   actively tells every well-behaved client to try again.");
    Console.WriteLine();
    Console.WriteLine("   AND THE PART THAT MADE IT LONG. With a traceId in the body, the");
    Console.WriteLine("   partner's first message would have carried an id that resolved");
    Console.WriteLine("   directly to the exception. The investigation would have started at the");
    Console.WriteLine("   stack trace instead of arriving at it.");
    Console.WriteLine();
    Console.WriteLine("   The uncomfortable summary: THE INCIDENT WAS AN IDEMPOTENCY BUG, AND");
    Console.WriteLine("   THE ERROR CONTRACT DECIDED WHETHER IT WAS A FIVE-MINUTE BUG OR A");
    Console.WriteLine("   FIVE-HOUR ONE.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Checklist()
{
    Console.WriteLine("4. What to check on a service you have inherited");
    Console.WriteLine();
    Console.WriteLine("   In order, because each is one request:");
    Console.WriteLine();
    Console.WriteLine("   1. curl -i a route that does not exist. An empty 404 means");
    Console.WriteLine("      UseStatusCodePages is missing.");
    Console.WriteLine();
    Console.WriteLine("   2. curl -i something that throws. An empty 500 means no handler, or a");
    Console.WriteLine("      handler registered after the middleware that threw; a stack trace");
    Console.WriteLine("      means the developer page is on in that environment.");
    Console.WriteLine();
    Console.WriteLine("   3. Take the traceId from that response and search the log store. No");
    Console.WriteLine("      match means either the handler is not logging or it is logging a");
    Console.WriteLine("      different id from the one it returned.");
    Console.WriteLine();
    Console.WriteLine("   4. Collect the error bodies from four or five endpoints and compare");
    Console.WriteLine("      the field names. Drift is the normal state, not the exception.");
    Console.WriteLine();
    Console.WriteLine("   5. Grep for status codes chosen in code that is not the edge -");
    Console.WriteLine("      StatusCode, BadRequest and NotFound inside services and");
    Console.WriteLine("      repositories. Each one is a decision made where the protocol is not");
    Console.WriteLine("      known.");
    Console.WriteLine();
    Console.WriteLine("   6. Look for 500s returned deliberately. Every one is a client being");
    Console.WriteLine("      told to retry something.");
    Console.WriteLine();
    Console.WriteLine("   The single highest-value change on most services is item 1 and item 2");
    Console.WriteLine("   together, because they are four lines of setup and they turn every");
    Console.WriteLine("   silent failure into one somebody can quote.");
}

// ---------------------------------------------------------------------------
static Call[] Calls() =>
[
    new("GET payments", HttpMethod.Get, "/v1/payments/PAY-9"),
    new("POST refunds", HttpMethod.Post, "/v1/refunds"),
    new("POST payouts", HttpMethod.Post, "/v1/payouts"),
    new("POST invoices", HttpMethod.Post, "/v1/invoices"),
    new("POST settlements", HttpMethod.Post, "/v1/settlements")
];

static async Task<Shape> ShapeAsync(HttpClient http, Call call)
{
    using var request = new HttpRequestMessage(call.Method, call.Path);
    using HttpResponseMessage response = await http.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();

    string fields;

    if (body.Length == 0)
    {
        fields = "(no body)";
    }
    else
    {
        using JsonDocument document = JsonDocument.Parse(body);

        fields = string.Join(" ", document.RootElement.EnumerateObject().Select(p => p.Name));
    }

    return new Shape(
        (int)response.StatusCode,
        response.Content.Headers.ContentType?.MediaType ?? "(none)",
        fields);
}

// ---------------------------------------------------------------------------
record Call(string Label, HttpMethod Method, string Path);

record Shape(int Status, string ContentType, string Fields);

public sealed class CatchAll(IProblemDetailsService problemDetails,
    ILogger<CatchAll> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        logger.LogError(exception, "Unhandled exception");
        context.Response.StatusCode = 500;

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = { Title = "An unexpected error occurred", Status = 500 }
        });
    }
}
