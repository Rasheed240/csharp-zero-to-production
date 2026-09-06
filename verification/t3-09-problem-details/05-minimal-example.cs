// 05-minimal-example.cs — The whole error contract for one small API: every
// failure the service can produce, in one shape, with nothing leaked.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and field name here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Diagnostics;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;

var records = new ConcurrentQueue<string>();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Logging.AddProvider(new CapturingLoggerProvider(records));
builder.Logging.SetMinimumLevel(LogLevel.Error);

// ---------------------------------------------------------------------------
// THE ERROR CONTRACT. Four registrations and two middleware lines, and after
// this no endpoint in the file has to think about any of it.

builder.Services.AddProblemDetails(options =>
    options.CustomizeProblemDetails = context =>
    {
        // Added to every document the service produces, including the ones the
        // framework produces on its own.
        context.ProblemDetails.Instance =
            $"{context.HttpContext.Request.Method} {context.HttpContext.Request.Path}";

        context.ProblemDetails.Extensions["service"] = "ledger-api";
    });

// Order is priority order. The catch-all must be last, because it answers
// everything.
builder.Services.AddExceptionHandler<DomainExceptionHandler>();
builder.Services.AddExceptionHandler<CatchAllExceptionHandler>();

builder.Services.AddSingleton<IPayments, Payments>();

var app = builder.Build();

// FIRST, before anything that could throw. Only what it wraps can be reported.
app.UseExceptionHandler();

// The other half: an error status that has no body gets one.
app.UseStatusCodePages();

// ---------------------------------------------------------------------------
// The endpoints. None of them mentions an error shape, a trace id, or a log.

app.MapGet("/v1/payments/{id}", (string id, IPayments payments) =>
{
    Payment? payment = payments.Find(id);

    return payment is null
        ? Results.Problem(
            type: "https://ledger.example/problems/payment-not-found",
            title: "Payment not found",
            statusCode: 404)
        : Results.Ok(payment);
});

app.MapPost("/v1/payments/{id}/capture", (string id, IPayments payments) =>
{
    // The service throws what it means. It does not know it is behind HTTP.
    payments.Capture(id);

    return Results.Ok(new { id, status = "captured" });
});

app.MapPost("/v1/refunds", (RefundRequest body) =>
{
    // A rule decidable from the request alone: 400, and specific about what
    // the caller sent rather than about what we hold.
    if (body.AmountMinor <= 0)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["amountMinor"] = ["must be greater than zero"]
        });
    }

    return Results.Accepted($"/v1/refunds/{body.PaymentId}");
});

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("One API, every failure it can produce");
Console.WriteLine();

await Show(http, HttpMethod.Get, "/v1/payments/PAY-1", null, "found");
await Show(http, HttpMethod.Get, "/v1/payments/PAY-404", null, "no such payment");
await Show(http, HttpMethod.Post, "/v1/payments/PAY-1/capture", null, "already captured");
await Show(http, HttpMethod.Post, "/v1/payments/PAY-2/capture", null, "gateway failure");
await Show(http, HttpMethod.Post, "/v1/refunds", """{"paymentId":"PAY-1","amountMinor":0}""",
    "invalid amount");
await Show(http, HttpMethod.Post, "/v1/refunds", "not json at all", "malformed body");
await Show(http, HttpMethod.Get, "/v1/nothing-here", null, "no such route");
await Show(http, HttpMethod.Delete, "/v1/payments/PAY-1", null, "method not allowed");

Console.WriteLine("What reached the log:");
Console.WriteLine();

foreach (string record in records)
{
    Console.WriteLine($"   {record}");
}

Console.WriteLine();
Console.WriteLine("   ONE EXCEPTION, out of eight requests and six failures. The 404s, the");
Console.WriteLine("   400s and the 405 are the caller being told no, which is the API working,");
Console.WriteLine("   and none of them is worth an entry in an error log.");
Console.WriteLine();
Console.WriteLine("   The 409 is the interesting omission. It came from an exception, and the");
Console.WriteLine("   handler that translated it deliberately does not log: capturing a payment");
Console.WriteLine("   twice is a thing callers do, not a thing that went wrong here. WHETHER AN");
Console.WriteLine("   EXCEPTION IS AN ERROR IS A DECISION, and the handler is where it is made.");
Console.WriteLine();
Console.WriteLine("   Get that wrong in the safe direction and every duplicate request pages");
Console.WriteLine("   somebody at 03:00. Get it wrong in the other direction and a real fault");
Console.WriteLine("   is invisible. The test to apply: COULD ANYONE HERE HAVE PREVENTED IT?");
Console.WriteLine();
Console.WriteLine("   The one entry carries the same trace id the caller was given, so the");
Console.WriteLine("   string in a support ticket resolves to the stack trace.");
Console.WriteLine();
Console.WriteLine("THE CHECKLIST THIS FILE IS BUILT FROM");
Console.WriteLine();
Console.WriteLine("   AddProblemDetails, with CustomizeProblemDetails for the fields every");
Console.WriteLine("     document should carry, so no endpoint has to remember them");
Console.WriteLine();
Console.WriteLine("   UseExceptionHandler FIRST in the pipeline, because it can only report");
Console.WriteLine("     what it wraps");
Console.WriteLine();
Console.WriteLine("   UseStatusCodePages as well, because a 404 from routing and a 405 from");
Console.WriteLine("     method matching never threw anything");
Console.WriteLine();
Console.WriteLine("   One handler per family of domain exceptions, translating each to the");
Console.WriteLine("     status it means, returning false for anything it does not know");
Console.WriteLine();
Console.WriteLine("   A catch-all registered LAST that returns true, so nothing falls through");
Console.WriteLine("     to an empty 500");
Console.WriteLine();
Console.WriteLine("   The catch-all logs the exception OBJECT at Error with the same id the");
Console.WriteLine("     document carries - because a handled exception is logged by nobody");
Console.WriteLine("     else - while a handler for an expected condition logs nothing");
Console.WriteLine();
Console.WriteLine("   Nothing from an exception in a response: no message, no type name, no");
Console.WriteLine("     stack, no path, no host");
Console.WriteLine();
Console.WriteLine("WHAT MAKES IT HOLD");
Console.WriteLine();
Console.WriteLine("   Not one of the endpoints above could break the contract if it wanted to");
Console.WriteLine("   by accident. Adding a ninth endpoint tomorrow gets the same shape, the");
Console.WriteLine("   same fields and the same logging without its author knowing any of this");
Console.WriteLine("   exists - which is the only kind of consistency that survives a team.");
Console.WriteLine();
Console.WriteLine("   The one thing that would break it is an endpoint returning its own JSON");
Console.WriteLine("   error object, because nothing marks that as a problem document. That is");
Console.WriteLine("   worth a review rule of its own: ERRORS GO THROUGH Results.Problem OR");
Console.WriteLine("   Results.ValidationProblem, NEVER THROUGH AN ANONYMOUS OBJECT.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Show(HttpClient http, HttpMethod method, string path, string? json, string note)
{
    using var request = new HttpRequestMessage(method, path);

    if (json is not null)
    {
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
    }

    using HttpResponseMessage response = await http.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();

    Console.WriteLine($"   {note,-18}  {method.Method} {path}");
    Console.WriteLine($"     {(int)response.StatusCode}  {response.Content.Headers.ContentType?.MediaType ?? "(none)"}");
    Console.WriteLine($"     {(body.Length == 0 ? "(empty)" : body)}");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
public sealed record Payment(string Id, string Status, long AmountMinor);

public sealed record RefundRequest(string PaymentId, long AmountMinor);

public sealed class PaymentAlreadyCapturedException(string id)
    : Exception($"payment {id} has already been captured")
{
    public string PaymentId { get; } = id;
}

public interface IPayments
{
    Payment? Find(string id);

    void Capture(string id);
}

public sealed class Payments : IPayments
{
    private readonly Dictionary<string, Payment> _payments = new()
    {
        ["PAY-1"] = new Payment("PAY-1", "captured", 50_000),
        ["PAY-2"] = new Payment("PAY-2", "authorised", 12_500)
    };

    public Payment? Find(string id) => _payments.GetValueOrDefault(id);

    public void Capture(string id)
    {
        Payment payment = _payments[id];

        // A domain exception: it says what is wrong in the language of the
        // domain, and says nothing about HTTP.
        if (payment.Status == "captured")
        {
            throw new PaymentAlreadyCapturedException(id);
        }

        // Stands in for the gateway call that fails, with a message that must
        // never be returned to anybody.
        throw new InvalidOperationException(
            "capture failed: POST https://gw.internal:8443/v2/capture returned 503");
    }
}

// ---------------------------------------------------------------------------
// Translates the exceptions this service defines. Returns false for everything
// else, so the next handler gets it.
public sealed class DomainExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        if (exception is not PaymentAlreadyCapturedException captured)
        {
            return false;
        }

        // 409, not 500: the condition is permanent, and a 500 would tell a
        // well-behaved client to retry a capture that already succeeded.
        context.Response.StatusCode = 409;

        var problem = new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails =
            {
                Type = "https://ledger.example/problems/payment-already-captured",
                Title = "Payment already captured",
                Status = 409
            }
        };

        // The caller sent this id, so it tells them nothing they did not know.
        problem.ProblemDetails.Extensions["paymentId"] = captured.PaymentId;

        return await problemDetails.TryWriteAsync(problem);
    }
}

// The last handler. It answers everything, and it is the only place an
// unexpected exception is recorded.
public sealed class CatchAllExceptionHandler(IProblemDetailsService problemDetails,
    ILogger<CatchAllExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        // The exception object, so the stack is kept. The id is the one the
        // document is about to carry.
        logger.LogError(exception, "Unhandled exception. traceId {TraceId}",
            Activity.Current?.Id ?? context.TraceIdentifier);

        context.Response.StatusCode = 500;

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails =
            {
                Type = "https://ledger.example/problems/internal-error",
                Title = "An unexpected error occurred",
                Status = 500
            }
        });
    }
}

// ---------------------------------------------------------------------------
public sealed class CapturingLoggerProvider(ConcurrentQueue<string> records) : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new Capturing(records);

    public void Dispose() { }

    private sealed class Capturing(ConcurrentQueue<string> records) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Error;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
            Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
            {
                return;
            }

            records.Enqueue(formatter(state, exception));

            if (exception is not null)
            {
                records.Enqueue($"     {exception.GetType().Name}: {exception.Message}");
            }
        }
    }
}
