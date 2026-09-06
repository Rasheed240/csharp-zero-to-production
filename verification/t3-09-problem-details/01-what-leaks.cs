// 01-what-leaks.cs — What an unhandled exception returns to the caller in each
// environment, and what is in it.
//
// Run:  dotnet run 01-what-leaks.cs -c Release
//
// EXACT vs RATIO: every status code, content type and leaked substring here is
// deterministic. Byte counts vary by a few characters with the trace id.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

await ByEnvironment();
await TheDeveloperPageIsNotOnlyHtml();
await TheEnvelope();
await TypedHandlers();
Rules();

// ---------------------------------------------------------------------------
static async Task ByEnvironment()
{
    Console.WriteLine("1. The same exception, three configurations");
    Console.WriteLine();
    Console.WriteLine("   The endpoint throws while talking to the payment gateway, and the");
    Console.WriteLine("   exception message contains the connection string it was using:");
    Console.WriteLine();
    Console.WriteLine("     connect failed: Server=10.0.0.5;Database=ledger;Password=hunter2");
    Console.WriteLine();
    Console.WriteLine("   Every request below is an ordinary API call - Accept: application/json,");
    Console.WriteLine("   no browser involved.");
    Console.WriteLine();

    Console.WriteLine("   configuration                    status   content type                bytes");
    Console.WriteLine("   -------------                    ------   ------------                -----");

    foreach (Setup setup in Setups())
    {
        Leak leak = await MeasureAsync(setup.Environment, setup.DeveloperPage, setup.Handler);
        Console.WriteLine($"   {setup.Label,-30}   {leak.Status,6}   {leak.ContentType,-26}  {leak.Bytes,5}");
    }

    Console.WriteLine();
    Console.WriteLine("   what the body contained:");
    Console.WriteLine();
    Console.WriteLine("   configuration                    stack   exception   connection   file");
    Console.WriteLine("                                    trace   type name   string       paths");
    Console.WriteLine("   -------------                    -----   ---------   ----------   -----");

    foreach (Setup setup in Setups())
    {
        Leak leak = await MeasureAsync(setup.Environment, setup.DeveloperPage, setup.Handler);
        Console.WriteLine($"   {setup.Label,-30}   {Mark(leak.HasStack),5}   {Mark(leak.HasTypeName),9}   " +
            $"{Mark(leak.HasSecret),10}   {Mark(leak.HasPaths),5}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE DEVELOPER EXCEPTION PAGE RETURNS EVERYTHING. The message, the type");
    Console.WriteLine("   name, the stack with file paths and line numbers. That is exactly what");
    Console.WriteLine("   you want on your own machine, and it is a disclosure of your source");
    Console.WriteLine("   tree - and, here, of a password - to anyone who can make the request.");
    Console.WriteLine();
    Console.WriteLine("   Its only guard is the environment name, which is a STRING FROM");
    Console.WriteLine("   CONFIGURATION: ASPNETCORE_ENVIRONMENT. Unset, the host defaults to");
    Console.WriteLine("   Production and the page stays off. The failure is never the default -");
    Console.WriteLine("   it is a compose file, a Helm values file or a base image that sets");
    Console.WriteLine("   Development and then gets copied somewhere that is not.");
    Console.WriteLine();
    Console.WriteLine("   That makes it a deployment fact rather than a code fact, so reading");
    Console.WriteLine("   the source does not settle it. ONE REQUEST AGAINST A DEPLOYED ENDPOINT");
    Console.WriteLine("   THAT THROWS DOES.");
    Console.WriteLine();
    Console.WriteLine("   PRODUCTION WITH NOTHING is the second row, and it is safe rather than");
    Console.WriteLine("   good: an empty 500 with no content type at all leaks nothing and tells");
    Console.WriteLine("   the caller nothing - no correlation id, no shape a client can parse,");
    Console.WriteLine("   nothing to quote in a support ticket.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD ROW is the one to ship. Note its content type, which is the");
    Console.WriteLine("   subject of section 3 and is not what it should be.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheDeveloperPageIsNotOnlyHtml()
{
    Console.WriteLine("2. The developer page adapts to the caller");
    Console.WriteLine();
    Console.WriteLine("   Predicted before running section 1: the developer exception page");
    Console.WriteLine("   returns an HTML page, so an API client sending Accept:");
    Console.WriteLine("   application/json would get something harmless.");
    Console.WriteLine();
    Console.WriteLine("   Measured, the same throwing endpoint, varying only the Accept header:");
    Console.WriteLine();
    Console.WriteLine("   Accept                content type                bytes   secret in body");
    Console.WriteLine("   ------                ------------                -----   --------------");

    foreach (string accept in new[] { "application/json", "text/html", "*/*" })
    {
        Leak leak = await MeasureAsync("Development", developerPage: true, handler: Handler.None,
            accept: accept);

        Console.WriteLine($"   {accept,-20}  {leak.ContentType,-26}  {leak.Bytes,5}   {Mark(leak.HasSecret)}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE PREDICTION WAS WRONG, AND WRONG IN THE DANGEROUS DIRECTION. The");
    Console.WriteLine("   page content-negotiates: a browser gets HTML, and a client asking for");
    Console.WriteLine("   JSON gets a problem+json document carrying the same exception message,");
    Console.WriteLine("   type name and stack.");
    Console.WriteLine();
    Console.WriteLine("   So 'we serve only JSON from this service' is not a mitigation, and");
    Console.WriteLine("   neither is 'nobody points a browser at it'. The only thing that keeps");
    Console.WriteLine("   the page off is the environment name.");
    Console.WriteLine();
    Console.WriteLine("   A useful consequence for debugging: when you WANT the detail on your");
    Console.WriteLine("   own machine, curl gives it to you as JSON without a browser.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheEnvelope()
{
    Console.WriteLine("3. The envelope, and the field that is easy to get wrong");
    Console.WriteLine();
    Console.WriteLine("   Two handlers write what looks like the same document. One builds an");
    Console.WriteLine("   anonymous object and calls WriteAsJsonAsync; the other hands a");
    Console.WriteLine("   ProblemDetails to IProblemDetailsService.");
    Console.WriteLine();

    Leak hand = await MeasureAsync("Production", developerPage: false, handler: Handler.HandRolled);
    Leak service = await MeasureAsync("Production", developerPage: false, handler: Handler.Service);

    Console.WriteLine("   WriteAsJsonAsync, anonymous object");
    Console.WriteLine($"     content type   {hand.ContentType}");
    Console.WriteLine($"     body           {hand.Body}");
    Console.WriteLine();
    Console.WriteLine("   IProblemDetailsService");
    Console.WriteLine($"     content type   {service.ContentType}");
    Console.WriteLine($"     body           {service.Body}");
    Console.WriteLine();
    Console.WriteLine("   SAME JSON, DIFFERENT CONTENT TYPE. WriteAsJsonAsync sends");
    Console.WriteLine("   application/json, because that is what it is for; it has no idea the");
    Console.WriteLine("   object is an error. RFC 9457 says a problem document is");
    Console.WriteLine("   application/problem+json, and that is not decoration:");
    Console.WriteLine();
    Console.WriteLine("     - a client can branch on the content type without inspecting the");
    Console.WriteLine("       body, which matters when the status alone is ambiguous;");
    Console.WriteLine("     - generated clients and API tooling recognise it and deserialise");
    Console.WriteLine("       into an error type rather than failing on the success type;");
    Console.WriteLine("     - a gateway or a log pipeline can classify a response without");
    Console.WriteLine("       parsing its body.");
    Console.WriteLine();
    Console.WriteLine("   Hand-rolling gets you the right shape with the wrong label, which is");
    Console.WriteLine("   worse than being either right or obviously different: nothing fails");
    Console.WriteLine("   until a consumer that trusts the content type arrives.");
    Console.WriteLine();
    Console.WriteLine("   The fields, and why each earns its place:");
    Console.WriteLine();
    Console.WriteLine("     type      a URI naming the KIND of problem. A client can switch on");
    Console.WriteLine("               it, so unlike the status code it can distinguish two");
    Console.WriteLine("               different 422s. It does not have to resolve to anything.");
    Console.WriteLine();
    Console.WriteLine("     title     a short human-readable summary, the same for every");
    Console.WriteLine("               occurrence of this type.");
    Console.WriteLine();
    Console.WriteLine("     status    the HTTP status, repeated in the body so that a document");
    Console.WriteLine("               logged or forwarded on its own is still complete.");
    Console.WriteLine();
    Console.WriteLine("     traceId   the correlation id. THIS IS THE FIELD THAT MATTERS, and");
    Console.WriteLine("               the service adds it for you.");
    Console.WriteLine();
    Console.WriteLine("   The traceId is what turns 'something went wrong' into a support");
    Console.WriteLine("   conversation. The customer quotes it, you search your logs for it, and");
    Console.WriteLine("   you find the exception that produced it with its full stack - which is");
    Console.WriteLine("   where the stack belongs.");
    Console.WriteLine();
    Console.WriteLine("   That is the whole trade: THE DETAIL GOES TO YOUR LOGS, THE POINTER");
    Console.WriteLine("   GOES TO THE CLIENT. Neither party gets nothing, and the client gets");
    Console.WriteLine("   nothing it should not have.");
    Console.WriteLine();
    Console.WriteLine("   RFC 9457 also allows EXTENSION MEMBERS - additional fields of your own");
    Console.WriteLine("   alongside the standard ones. That is where a validation error list");
    Console.WriteLine("   goes, or a retry-after hint, or an order id. Extensions are the");
    Console.WriteLine("   supported way to be specific, so an error envelope of your own design");
    Console.WriteLine("   gains nothing and loses the content type every tool knows.");
    Console.WriteLine();
    Console.WriteLine("   WHAT MUST NEVER GO IN: exception messages, type names, stack traces,");
    Console.WriteLine("   SQL, connection strings, file paths, internal hostnames, or the value");
    Console.WriteLine("   of anything the caller did not send you.");
    Console.WriteLine();
    Console.WriteLine("   Exception MESSAGES are the one people argue about, and the argument");
    Console.WriteLine("   loses to a single observation: YOU DO NOT CONTROL WHAT IS IN THEM. A");
    Console.WriteLine("   message written by a library, a driver or the framework can contain a");
    Console.WriteLine("   connection string, a file path or a fragment of somebody's data - as");
    Console.WriteLine("   the one measured in section 1 does.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TypedHandlers()
{
    Console.WriteLine("4. Different exceptions, different answers");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();

    // IExceptionHandler, .NET 8 and later. Several may be registered; each is
    // asked in turn, in registration order, until one says it handled the
    // exception.
    builder.Services.AddExceptionHandler<DomainExceptionHandler>();
    builder.Services.AddExceptionHandler<FallbackExceptionHandler>();

    var app = builder.Build();
    app.UseExceptionHandler();
    app.UseStatusCodePages();

    app.MapGet("/not-found", void () => throw new PaymentNotFoundException("PAY-9"));
    app.MapGet("/conflict", void () => throw new PaymentAlreadySettledException("PAY-1"));
    app.MapGet("/unknown", void () =>
        throw new InvalidOperationException("gateway unreachable at 10.0.0.5:5432"));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    foreach ((string path, string label) in new[]
    {
        ("/not-found", "PaymentNotFoundException"),
        ("/conflict", "PaymentAlreadySettledException"),
        ("/unknown", "InvalidOperationException")
    })
    {
        using HttpResponseMessage response = await http.GetAsync(path);
        string body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   {label}  ->  {(int)response.StatusCode}  " +
            $"{response.Content.Headers.ContentType?.MediaType}");
        Console.WriteLine($"     {body}");
        Console.WriteLine();
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   A DOMAIN EXCEPTION BECOMES THE STATUS IT MEANS. Not found is 404,");
    Console.WriteLine("   already settled is 409, and anything unrecognised is a 500 with no");
    Console.WriteLine("   detail - including the one whose message names an internal address.");
    Console.WriteLine();
    Console.WriteLine("   The 404 and the 409 carry a paymentId as an extension member. That is");
    Console.WriteLine("   the line to hold: echoing back an id the caller sent tells them");
    Console.WriteLine("   nothing new, and telling them anything they did not already know is a");
    Console.WriteLine("   decision to take deliberately rather than by accident.");
    Console.WriteLine();
    Console.WriteLine("   The shape is one interface:");
    Console.WriteLine();
    Console.WriteLine("     public ValueTask<bool> TryHandleAsync(HttpContext context,");
    Console.WriteLine("         Exception exception, CancellationToken cancellationToken)");
    Console.WriteLine();
    Console.WriteLine("   Returning false passes the exception to the next registered handler,");
    Console.WriteLine("   so they form a chain in registration order. A handler that returns");
    Console.WriteLine("   true has taken responsibility for the response.");
    Console.WriteLine();
    Console.WriteLine("   THE LAST HANDLER SHOULD ALWAYS RETURN true. If every handler returns");
    Console.WriteLine("   false the exception falls through to the default behaviour, which is");
    Console.WriteLine("   the empty 500 from row two of section 1. A catch-all that produces a");
    Console.WriteLine("   traceId is worth more than a bare status code.");
    Console.WriteLine();
    Console.WriteLine("   TRANSLATING EXCEPTIONS BEATS RETURNING STATUS CODES FROM DEEP CODE. A");
    Console.WriteLine("   repository that knows a payment is missing should throw a domain");
    Console.WriteLine("   exception, not construct an HTTP response - it does not know it is");
    Console.WriteLine("   being called over HTTP, and one day it will not be. The handler is the");
    Console.WriteLine("   one place that knows the protocol.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Rules()
{
    Console.WriteLine("5. The rules");
    Console.WriteLine();
    Console.WriteLine("   1. NEVER RETURN AN EXCEPTION MESSAGE TO A CALLER. You do not control");
    Console.WriteLine("      what is in it. Log it with a correlation id and return the id.");
    Console.WriteLine();
    Console.WriteLine("   2. THE DEVELOPER EXCEPTION PAGE IS FOR DEVELOPMENT ONLY, its only");
    Console.WriteLine("      guard is a configuration string, and it leaks to JSON clients as");
    Console.WriteLine("      readily as to browsers. Verify it in each deployed environment");
    Console.WriteLine("      rather than trusting what the source says.");
    Console.WriteLine();
    Console.WriteLine("   3. EVERY ERROR RESPONSE SHOULD HAVE THE SAME SHAPE. A client should");
    Console.WriteLine("      not need one parser for validation failures, one for 404s and one");
    Console.WriteLine("      for 500s.");
    Console.WriteLine();
    Console.WriteLine("   4. ALWAYS INCLUDE A CORRELATION ID. It is the only thing connecting");
    Console.WriteLine("      the caller's experience to your logs, and it costs one field.");
    Console.WriteLine();
    Console.WriteLine("   5. LET THE FRAMEWORK WRITE THE DOCUMENT. IProblemDetailsService gets");
    Console.WriteLine("      the content type and the traceId right; hand-rolled JSON silently");
    Console.WriteLine("      gets the content type wrong.");
    Console.WriteLine();
    Console.WriteLine("   6. USE EXTENSION MEMBERS RATHER THAN A CUSTOM ENVELOPE. RFC 9457");
    Console.WriteLine("      already allows extra fields.");
    Console.WriteLine();
    Console.WriteLine("   7. TRANSLATE DOMAIN EXCEPTIONS AT THE EDGE, in one place, rather than");
    Console.WriteLine("      returning HTTP status codes from code that should not know about");
    Console.WriteLine("      HTTP.");
    Console.WriteLine();
    Console.WriteLine("   AND ONE THING THAT IS NOT A RULE. Whether to include a 'detail' field");
    Console.WriteLine("   at all is a judgement: a specific message helps a legitimate caller");
    Console.WriteLine("   and helps an attacker enumerate. 'Payment not found' is safe;");
    Console.WriteLine("   'payment PAY-1 belongs to another merchant' has told somebody that");
    Console.WriteLine("   PAY-1 exists and is not theirs.");
    Console.WriteLine();
    Console.WriteLine("   The general form of that judgement: A MESSAGE MAY DESCRIBE WHAT THE");
    Console.WriteLine("   CALLER DID, AND SHOULD NOT DESCRIBE WHAT YOU FOUND.");
}

// ---------------------------------------------------------------------------
static async Task<Leak> MeasureAsync(string environment, bool developerPage, Handler handler,
    string accept = "application/json")
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = environment
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();

    switch (handler)
    {
        case Handler.HandRolled:
            builder.Services.AddExceptionHandler<HandRolledExceptionHandler>();
            break;
        case Handler.Service:
            builder.Services.AddExceptionHandler<FallbackExceptionHandler>();
            break;
    }

    var app = builder.Build();

    if (developerPage)
    {
        app.UseDeveloperExceptionPage();
    }
    else if (handler != Handler.None)
    {
        app.UseExceptionHandler();
    }

    app.UseStatusCodePages();

    // The message deliberately contains something that must never be returned.
    app.MapGet("/boom", void () => throw new InvalidOperationException(
        "connect failed: Server=10.0.0.5;Database=ledger;Password=hunter2"));

    await app.StartAsync();

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    using var request = new HttpRequestMessage(HttpMethod.Get, "/boom");
    request.Headers.Add("Accept", accept);

    using HttpResponseMessage response = await http.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();
    await app.StopAsync();

    return new Leak(
        (int)response.StatusCode,
        response.Content.Headers.ContentType?.MediaType ?? "(none)",
        body.Length,
        body.Length == 0 ? "(empty body)" : (body.Length > 150 ? body[..150] + "..." : body),
        body.Contains("at Program", StringComparison.Ordinal)
            || body.Contains("StackTrace", StringComparison.OrdinalIgnoreCase),
        body.Contains("InvalidOperationException", StringComparison.Ordinal),
        body.Contains("hunter2", StringComparison.Ordinal),
        body.Contains(".cs", StringComparison.Ordinal));
}

static string Mark(bool value) => value ? "YES" : "no";

static Setup[] Setups() =>
[
    new("Development, developer page", "Development", true, Handler.None),
    new("Production, nothing", "Production", false, Handler.None),
    new("Production, exception handler", "Production", false, Handler.HandRolled)
];

// ---------------------------------------------------------------------------
enum Handler { None, HandRolled, Service }

record Setup(string Label, string Environment, bool DeveloperPage, Handler Handler);

record Leak(int Status, string ContentType, int Bytes, string Body,
    bool HasStack, bool HasTypeName, bool HasSecret, bool HasPaths);

public sealed class PaymentNotFoundException(string id)
    : Exception($"payment {id} was not found")
{
    public string PaymentId { get; } = id;
}

public sealed class PaymentAlreadySettledException(string id)
    : Exception($"payment {id} is already settled")
{
    public string PaymentId { get; } = id;
}

// Translates domain exceptions into the status each one means.
public sealed class DomainExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        (int status, string title, string paymentId) = exception switch
        {
            PaymentNotFoundException payment =>
                (404, "Payment not found", payment.PaymentId),
            PaymentAlreadySettledException payment =>
                (409, "Payment already settled", payment.PaymentId),
            _ => (0, "", "")
        };

        if (status == 0)
        {
            // Not ours. The next registered handler gets a chance.
            return false;
        }

        context.Response.StatusCode = status;

        var problem = new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails =
            {
                Type = $"https://ledger.example/problems/{title.ToLowerInvariant().Replace(' ', '-')}",
                Title = title,
                Status = status
            }
        };

        // An extension member: a field of our own alongside the standard ones.
        // The caller sent this id, so echoing it back tells them nothing new.
        problem.ProblemDetails.Extensions["paymentId"] = paymentId;

        return await problemDetails.TryWriteAsync(problem);
    }
}

// The catch-all. It returns true, so nothing reaches the default empty 500.
public sealed class FallbackExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        // The exception goes to the log, with the same id the caller is given.
        // Nothing out of it goes into the response.
        context.Response.StatusCode = 500;

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails =
            {
                Type = "https://tools.ietf.org/html/rfc9110#section-15.6.1",
                Title = "An unexpected error occurred",
                Status = 500
            }
        });
    }
}

// The same document, written the way that is one line shorter and one field
// wrong. Section 3 measures the difference.
public sealed class HandRolledExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        context.Response.StatusCode = 500;

        await context.Response.WriteAsJsonAsync(new
        {
            type = "https://tools.ietf.org/html/rfc9110#section-15.6.1",
            title = "An unexpected error occurred",
            status = 500,
            traceId = context.TraceIdentifier
        }, cancellationToken);

        return true;
    }
}
