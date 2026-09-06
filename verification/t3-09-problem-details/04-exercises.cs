// 04-exercises.cs — Four problems, each stated as a symptom, with the fix
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every status code and field name here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Diagnostics;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;

await One();
await Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static async Task One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the contract that is not there");
    Console.WriteLine();
    Console.WriteLine("   Symptom: a service returns a proper problem document when an endpoint");
    Console.WriteLine("   throws, and an empty body for every 404 and 403. The exception handler");
    Console.WriteLine("   is registered and correct.");
    Console.WriteLine();
    Console.WriteLine("   Question: what is missing, and why does it not show up in the tests");
    Console.WriteLine("   that cover the error handling?");
    Console.WriteLine();

    Console.WriteLine("   registered                        throws   403        unmatched route");
    Console.WriteLine("   ----------                        ------   ---        ---------------");

    foreach ((string label, bool pages) in new[] { ("handler only", false), ("handler + pages", true) })
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddProblemDetails();
        builder.Services.AddExceptionHandler<CatchAll>();

        var app = builder.Build();
        app.UseExceptionHandler();

        if (pages)
        {
            app.UseStatusCodePages();
        }

        app.MapGet("/throws", void () => throw new InvalidOperationException("boom"));
        app.MapGet("/forbidden", () => Results.StatusCode(403));

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        string a = await DescribeAsync(http, "/throws");
        string b = await DescribeAsync(http, "/forbidden");
        string c = await DescribeAsync(http, "/nothing-here");

        await app.StopAsync();

        Console.WriteLine($"   {label,-32}  {a,-7}  {b,-9}  {c}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: UseStatusCodePages. The exception handler only ever sees");
    Console.WriteLine("   exceptions, and a 404 from routing is not one - no code ran, so");
    Console.WriteLine("   nothing threw.");
    Console.WriteLine();
    Console.WriteLine("   WHY THE TESTS PASS: a test for error handling is written by making");
    Console.WriteLine("   something fail, and the natural way to make something fail is to throw.");
    Console.WriteLine("   The half of the surface that is never exercised is the half where");
    Console.WriteLine("   nothing goes wrong in your code at all - a route that does not exist,");
    Console.WriteLine("   an authorisation policy that says no, a method that is not allowed.");
    Console.WriteLine();
    Console.WriteLine("   The test that would have caught it asserts on a request to a path");
    Console.WriteLine("   nobody mapped, which feels like testing the framework and is not.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the id that matches nothing");
    Console.WriteLine();
    Console.WriteLine("   Symptom: customers quote the traceId from an error response, support");
    Console.WriteLine("   searches the log store for it, and finds nothing. The handler does log");
    Console.WriteLine("   the exception, and the log entry does contain an id.");
    Console.WriteLine();
    Console.WriteLine("   Question: what is wrong, and what is the one-line fix?");
    Console.WriteLine();

    foreach ((string label, bool useActivity) in new[]
    {
        ("logs context.TraceIdentifier", false),
        ("logs Activity.Current?.Id", true)
    })
    {
        var records = new ConcurrentQueue<string>();

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Logging.AddProvider(new CapturingLoggerProvider(records));
        builder.Logging.SetMinimumLevel(LogLevel.Error);
        builder.Services.AddProblemDetails();
        builder.Services.AddSingleton(new IdChoice(useActivity));
        builder.Services.AddExceptionHandler<ConfigurableHandler>();

        var app = builder.Build();
        app.UseExceptionHandler();
        app.MapGet("/boom", void () => throw new InvalidOperationException("gateway timed out"));

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        using HttpResponseMessage response = await http.GetAsync("/boom");
        string body = await response.Content.ReadAsStringAsync();
        await app.StopAsync();

        string returned = JsonDocument.Parse(body).RootElement
            .GetProperty("traceId").GetString() ?? "";

        records.TryDequeue(out string? logged);
        string inLog = logged ?? "(nothing)";

        Console.WriteLine($"   handler {label}");
        Console.WriteLine($"     returned to the caller   {returned}");
        Console.WriteLine($"     written to the log       {inLog}");
        Console.WriteLine($"     a search for the id      {(inLog.Contains(returned, StringComparison.Ordinal) ? "FINDS IT" : "finds nothing")}");
        Console.WriteLine();
    }

    Console.WriteLine("   ANSWER: the document's traceId is Activity.Current?.Id when there is");
    Console.WriteLine("   an activity, and HttpContext.TraceIdentifier only when there is not.");
    Console.WriteLine("   A handler that logs TraceIdentifier is logging a different string from");
    Console.WriteLine("   the one it returns, and both of them look like ids.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX: log the same expression the document uses -");
    Console.WriteLine("   Activity.Current?.Id ?? context.TraceIdentifier - or put the id into");
    Console.WriteLine("   the document yourself so there is only one source.");
    Console.WriteLine();
    Console.WriteLine("   WHY IT SURVIVES REVIEW: both versions read correctly, both log an id,");
    Console.WriteLine("   and on a developer machine with logging configured the same way as the");
    Console.WriteLine("   test, the difference is two strings that are both present. The failure");
    Console.WriteLine("   only appears when somebody tries to join them.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium) - one shape for four failures");
    Console.WriteLine();
    Console.WriteLine("   Task: an API returns a bad request, a not found, a conflict from a");
    Console.WriteLine("   domain exception, and an unexpected failure. Make all four arrive as");
    Console.WriteLine("   the same kind of document, carrying the request path and a service");
    Console.WriteLine("   name, without editing any endpoint to add those fields.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddProblemDetails(options =>
        options.CustomizeProblemDetails = context =>
        {
            context.ProblemDetails.Instance =
                $"{context.HttpContext.Request.Method} {context.HttpContext.Request.Path}";

            context.ProblemDetails.Extensions["service"] = "ledger-api";
        });

    builder.Services.AddExceptionHandler<DomainHandler>();
    builder.Services.AddExceptionHandler<CatchAll>();

    var app = builder.Build();
    app.UseExceptionHandler();
    app.UseStatusCodePages();

    app.MapPost("/refunds", () => Results.Problem(title: "Refund window has closed", statusCode: 400));
    app.MapGet("/payments/{id}", (string id) => Results.NotFound());
    app.MapPost("/captures", void () => throw new AlreadyCapturedException("PAY-1"));
    app.MapPost("/settlements", void () => throw new InvalidOperationException("ledger closed"));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    foreach ((HttpMethod method, string path) in new[]
    {
        (HttpMethod.Post, "/refunds"),
        (HttpMethod.Get, "/payments/PAY-9"),
        (HttpMethod.Post, "/captures"),
        (HttpMethod.Post, "/settlements")
    })
    {
        using var request = new HttpRequestMessage(method, path);
        using HttpResponseMessage response = await http.SendAsync(request);
        string body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   {(int)response.StatusCode}  {response.Content.Headers.ContentType?.MediaType}");
        Console.WriteLine($"     {body}");
        Console.WriteLine();
    }

    await app.StopAsync();

    Console.WriteLine("   ANSWER: three registrations and one customisation, and no endpoint");
    Console.WriteLine("   knows about any of it.");
    Console.WriteLine();
    Console.WriteLine("     AddProblemDetails(o => o.CustomizeProblemDetails = ...)   the fields");
    Console.WriteLine("     AddExceptionHandler<DomainHandler>()                      the 409");
    Console.WriteLine("     AddExceptionHandler<CatchAll>()                           the 500");
    Console.WriteLine("     UseExceptionHandler() + UseStatusCodePages()              both halves");
    Console.WriteLine();
    Console.WriteLine("   THE POINT OF THE EXERCISE is the phrase 'without editing any endpoint'.");
    Console.WriteLine("   An error contract that each handler has to remember to honour is one");
    Console.WriteLine("   that drifts the first week somebody is in a hurry. A contract enforced");
    Console.WriteLine("   by the composition of the app cannot be forgotten, only removed - and");
    Console.WriteLine("   removing it is a visible change to one file.");
    Console.WriteLine();
    Console.WriteLine("   NOTE THE ORDER OF THE TWO HANDLERS. DomainHandler must come first,");
    Console.WriteLine("   because CatchAll returns true for everything. Registration order is");
    Console.WriteLine("   the priority order, and a catch-all registered first makes every");
    Console.WriteLine("   handler after it dead code.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - the endpoint that reports success while failing");
    Console.WriteLine();
    Console.WriteLine("   Symptom: an export endpoint appears in the dashboards as 100%");
    Console.WriteLine("   successful. The error log contains exceptions from that endpoint every");
    Console.WriteLine("   day. A customer says the file is sometimes cut off.");
    Console.WriteLine();
    Console.WriteLine("   Question: how can the logs and the dashboard disagree, and what would");
    Console.WriteLine("   you change?");
    Console.WriteLine();

    Console.WriteLine("   version                         status   bytes   body read         exception logged");
    Console.WriteLine("   -------                         ------   -----   ---------         ----------------");

    foreach (bool materialiseFirst in new[] { false, true })
    {
        Export export = await ExportAsync(materialiseFirst);

        Console.WriteLine($"   {(materialiseFirst ? "v2, materialise then write" : "v1, write while reading"),-30}  " +
            $"{export.Status,6}   {export.Bytes,5}   {export.ReadOutcome,-16}  {export.Logged}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: v1 writes the first rows to the socket before the failure");
    Console.WriteLine("   happens. The status line went out with the first byte, so it says 200");
    Console.WriteLine("   and can never say anything else.");
    Console.WriteLine();
    Console.WriteLine("   The dashboards are not lying. 200 is genuinely what was sent, and 45");
    Console.WriteLine("   bytes of a truncated file went with it.");
    Console.WriteLine();
    Console.WriteLine("   READ THE LAST COLUMN CAREFULLY, because it is the part that surprises");
    Console.WriteLine("   people: THE HANDLER STILL RAN AND STILL LOGGED. It was invoked, it saw");
    Console.WriteLine("   the exception, and its attempt to write a problem document went");
    Console.WriteLine("   nowhere because the response had started. Nothing failed loudly; the");
    Console.WriteLine("   error simply had no route back to the caller.");
    Console.WriteLine();
    Console.WriteLine("   So the log and the status code are BOTH correct and they disagree.");
    Console.WriteLine("   That is the whole answer to the question: an alert built on status");
    Console.WriteLine("   codes and an alert built on exception counts are measuring different");
    Console.WriteLine("   events, and only here does the difference become visible.");
    Console.WriteLine();
    Console.WriteLine("   THE CHANGES, and they are separate:");
    Console.WriteLine();
    Console.WriteLine("     1. Do the fallible work before writing anything. v2 materialises the");
    Console.WriteLine("        rows first, so a failure is still an error the handler can report");
    Console.WriteLine("        - at the cost of holding the whole export in memory, which is a");
    Console.WriteLine("        real trade and not always the right one.");
    Console.WriteLine();
    Console.WriteLine("     2. If it must stream, make the failure detectable. Count exceptions");
    Console.WriteLine("        thrown after the response started as their own metric, because no");
    Console.WriteLine("        status code will ever carry them, and give the format a");
    Console.WriteLine("        terminator the client checks for.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL LESSON, which is worth more than the endpoint: A METRIC");
    Console.WriteLine("   BUILT ON STATUS CODES CANNOT SEE ANY FAILURE THAT HAPPENS AFTER THE");
    Console.WriteLine("   STATUS CODE IS CHOSEN. Every streaming endpoint, every long download,");
    Console.WriteLine("   and every response written in pieces has this blind spot.");
}

// ---------------------------------------------------------------------------
static async Task<string> DescribeAsync(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();

    return $"{(int)response.StatusCode} {(body.Length == 0 ? "empty" : "doc")}";
}

// ---------------------------------------------------------------------------
static async Task<Export> ExportAsync(bool materialiseFirst)
{
    var records = new ConcurrentQueue<string>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Logging.AddProvider(new CapturingLoggerProvider(records));
    builder.Logging.SetMinimumLevel(LogLevel.Error);
    builder.Services.AddProblemDetails();
    builder.Services.AddExceptionHandler<CatchAll>();

    var app = builder.Build();
    app.UseExceptionHandler();

    app.MapGet("/export", async (HttpContext context) =>
    {
        if (materialiseFirst)
        {
            // Everything that can fail, before a byte is written.
            var rows = new List<string>();

            await foreach (string row in RowsAsync())
            {
                rows.Add(row);
            }

            context.Response.ContentType = "text/csv";

            foreach (string row in rows)
            {
                await context.Response.WriteAsync(row);
            }

            return;
        }

        context.Response.ContentType = "text/csv";

        await foreach (string row in RowsAsync())
        {
            await context.Response.WriteAsync(row);
            await context.Response.Body.FlushAsync();
        }
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    using HttpResponseMessage response =
        await http.GetAsync("/export", HttpCompletionOption.ResponseHeadersRead);

    int status = (int)response.StatusCode;
    var received = new MemoryStream();
    string outcome;

    try
    {
        await using Stream stream = await response.Content.ReadAsStreamAsync();
        await stream.CopyToAsync(received);
        outcome = "completed";
    }
    catch (Exception exception)
    {
        outcome = exception.GetType().Name;
    }

    await app.StopAsync();

    return new Export(status, received.Length, outcome, records.IsEmpty ? "no" : "YES");

    // Three rows, then the connection to the reporting database drops.
    static async IAsyncEnumerable<string> RowsAsync()
    {
        for (int row = 1; row <= 3; row++)
        {
            await Task.Yield();
            yield return $"{row},settled,1000\n";
        }

        throw new InvalidOperationException("reporting database connection reset");
    }
}

// ---------------------------------------------------------------------------
record Export(int Status, long Bytes, string ReadOutcome, string Logged);

public record IdChoice(bool UseActivity);

public sealed class AlreadyCapturedException(string id)
    : Exception($"payment {id} has already been captured")
{
    public string PaymentId { get; } = id;
}

public sealed class DomainHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        if (exception is not AlreadyCapturedException captured)
        {
            return false;
        }

        context.Response.StatusCode = 409;

        var problem = new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails =
            {
                Type = "https://ledger.example/problems/already-captured",
                Title = "Payment already captured",
                Status = 409
            }
        };

        problem.ProblemDetails.Extensions["paymentId"] = captured.PaymentId;

        return await problemDetails.TryWriteAsync(problem);
    }
}

public sealed class CatchAll(IProblemDetailsService problemDetails,
    ILogger<CatchAll> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        logger.LogError(exception, "Unhandled exception. traceId {TraceId}",
            Activity.Current?.Id ?? context.TraceIdentifier);

        context.Response.StatusCode = 500;

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = { Title = "An unexpected error occurred", Status = 500 }
        });
    }
}

// Logs whichever id it was configured with, so exercise 2 can compare them.
public sealed class ConfigurableHandler(IProblemDetailsService problemDetails,
    ILogger<ConfigurableHandler> logger, IdChoice choice) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        string id = choice.UseActivity
            ? Activity.Current?.Id ?? context.TraceIdentifier
            : context.TraceIdentifier;

        logger.LogError(exception, "Unhandled exception. traceId {TraceId}", id);

        context.Response.StatusCode = 500;

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = { Title = "An unexpected error occurred", Status = 500 }
        });
    }
}

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
            if (IsEnabled(logLevel))
            {
                records.Enqueue(formatter(state, exception));
            }
        }
    }
}
