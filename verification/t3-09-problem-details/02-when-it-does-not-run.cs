// 02-when-it-does-not-run.cs — Four ways a correctly written exception handler
// produces nothing, and how to tell which one you are looking at.
//
// Run:  dotnet run 02-when-it-does-not-run.cs -c Release
//
// EXACT vs RATIO: every status code and body here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;
using System.Diagnostics;

await Ordering();
await ResponseAlreadyStarted();
await TwoDifferentMiddlewares();
await StillLogged();
Summary();

// ---------------------------------------------------------------------------
static async Task Ordering()
{
    Console.WriteLine("1. A middleware that throws before the handler is added");
    Console.WriteLine();
    Console.WriteLine("   UseExceptionHandler catches what is thrown DOWNSTREAM of it, because");
    Console.WriteLine("   downstream is the only thing it calls. A middleware registered before");
    Console.WriteLine("   it is upstream, and is not in its try block at all.");
    Console.WriteLine();

    Console.WriteLine("   thrower registered      status   content type                body");
    Console.WriteLine("   ------------------      ------   ------------                ----");

    foreach (bool throwerFirst in new[] { true, false })
    {
        Result result = await ProbeAsync(app => { }, throwerFirst);

        Console.WriteLine($"   {(throwerFirst ? "before the handler" : "after the handler"),-22}  " +
            $"{result.Status,6}   {result.ContentType,-26}  {result.Body}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIRST ROW IS THE EMPTY 500 AGAIN, and the handler is registered,");
    Console.WriteLine("   correct, and never reached. This is the single most common way an");
    Console.WriteLine("   error contract is right in code and absent in production.");
    Console.WriteLine();
    Console.WriteLine("   The consequence: UseExceptionHandler BELONGS AS EARLY AS POSSIBLE,");
    Console.WriteLine("   before authentication, before routing, before anything of your own.");
    Console.WriteLine("   Only what it wraps can be reported.");
    Console.WriteLine();
    Console.WriteLine("   The exception that is hardest to catch this way is the one thrown by");
    Console.WriteLine("   the middleware you added last week to read a header, because it went");
    Console.WriteLine("   at the top of the file where the other setup lines are.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ResponseAlreadyStarted()
{
    Console.WriteLine("2. A response that has already started");
    Console.WriteLine();
    Console.WriteLine("   The endpoint writes the first half of a large document, the bytes go");
    Console.WriteLine("   to the socket, and then it throws.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();
    builder.Services.AddExceptionHandler<CatchAll>();

    var app = builder.Build();
    app.UseExceptionHandler();

    app.MapGet("/streamed", async (HttpContext context) =>
    {
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync("""{"items":[{"id":1},{"id":2}""");
        await context.Response.Body.FlushAsync();

        // The database connection drops on page three.
        throw new InvalidOperationException("connection reset while reading page 3");
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    // Read the headers first, then the body separately - the two halves of
    // this response have different fates and lumping them together hides it.
    using HttpResponseMessage response =
        await http.GetAsync("/streamed", HttpCompletionOption.ResponseHeadersRead);

    int status = (int)response.StatusCode;
    string contentType = response.Content.Headers.ContentType?.MediaType ?? "(none)";
    bool chunked = response.Headers.TransferEncodingChunked == true;

    var received = new MemoryStream();
    string readOutcome;

    try
    {
        await using Stream stream = await response.Content.ReadAsStreamAsync();
        await stream.CopyToAsync(received);
        readOutcome = "completed";
    }
    catch (Exception exception)
    {
        readOutcome = $"threw {exception.GetType().Name}";
    }

    await app.StopAsync();

    Console.WriteLine($"   status line seen by the client   {status}");
    Console.WriteLine($"   content type                     {contentType}");
    Console.WriteLine($"   chunked                          {chunked}");
    Console.WriteLine($"   bytes received before the fault  {received.Length}");
    Console.WriteLine($"   partial body                     {System.Text.Encoding.UTF8.GetString(received.ToArray())}");
    Console.WriteLine($"   the body read                    {readOutcome}");
    Console.WriteLine();
    Console.WriteLine("   THE STATUS LINE SAYS 200 AND ALWAYS WILL. The handler does run - it");
    Console.WriteLine("   is invoked and it sees the exception - and it can change nothing: the");
    Console.WriteLine("   status and headers were on the wire before the exception existed, and");
    Console.WriteLine("   bytes cannot be unsent, so there is nowhere to put a 500.");
    Console.WriteLine();
    Console.WriteLine("   What the server can still do is refuse to finish. The response was");
    Console.WriteLine("   chunked - no Content-Length, because the length was not known when the");
    Console.WriteLine("   headers went out - and Kestrel abandons the connection without writing");
    Console.WriteLine("   the terminating chunk. A correct client notices and throws, which is");
    Console.WriteLine("   the only signal available.");
    Console.WriteLine();
    Console.WriteLine("   THAT SIGNAL IS EASY TO LOSE. A client that catches broadly around the");
    Console.WriteLine("   read, a proxy that buffers and forwards what it got, or code that");
    Console.WriteLine("   deserialises from an already-filled buffer will present the truncated");
    Console.WriteLine("   document as a successful 200 - and if the truncation lands on a valid");
    Console.WriteLine("   boundary, as a plausible one.");
    Console.WriteLine();
    Console.WriteLine("   This is the same rule as HasStarted from the pipeline module, arriving");
    Console.WriteLine("   at the worst possible moment. It is worth stating in its strongest");
    Console.WriteLine("   form: ONCE THE FIRST BYTE IS SENT, NO ERROR HANDLING CAN CHANGE THE");
    Console.WriteLine("   ANSWER. Everything that can fail must fail before that byte.");
    Console.WriteLine();
    Console.WriteLine("   What it looks like in production: a client reporting intermittent JSON");
    Console.WriteLine("   parse errors on an endpoint your dashboards show as 100% successful,");
    Console.WriteLine("   because 200 is what you recorded.");
    Console.WriteLine();
    Console.WriteLine("   The defences, in order of preference:");
    Console.WriteLine();
    Console.WriteLine("     - do the fallible work FIRST, then serialise - materialise the page");
    Console.WriteLine("       before writing any of it;");
    Console.WriteLine("     - for genuinely streamed responses, accept that a mid-stream failure");
    Console.WriteLine("       is a truncated stream, and make the FORMAT say so - a terminating");
    Console.WriteLine("       record the client must see, or chunked framing the client checks;");
    Console.WriteLine("     - alert on the mismatch rather than the status: log the exception");
    Console.WriteLine("       and count 'exceptions after response start' as its own metric,");
    Console.WriteLine("       because no status code will ever carry it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TwoDifferentMiddlewares()
{
    Console.WriteLine("3. Exception handler and status code pages are not the same thing");
    Console.WriteLine();
    Console.WriteLine("   They are constantly confused, they are both needed, and each is silent");
    Console.WriteLine("   about what the other covers.");
    Console.WriteLine();

    Console.WriteLine("   registered                   thrown 500     returned 403   no route");
    Console.WriteLine("   ----------                   ----------     ------------   --------");

    foreach ((string label, bool handler, bool pages) in new[]
    {
        ("neither", false, false),
        ("UseExceptionHandler only", true, false),
        ("UseStatusCodePages only", false, true),
        ("both", true, true)
    })
    {
        (string thrown, string returned, string missing) = await ThreeWaysAsync(handler, pages);
        Console.WriteLine($"   {label,-27}  {thrown,-13}  {returned,-13}  {missing}");
    }

    Console.WriteLine();
    Console.WriteLine("   Read the columns rather than the rows:");
    Console.WriteLine();
    Console.WriteLine("     UseExceptionHandler   runs when something THREW. It is the only one");
    Console.WriteLine("                           of the two that ever sees an exception.");
    Console.WriteLine();
    Console.WriteLine("     UseStatusCodePages    runs when the response has an error STATUS and");
    Console.WriteLine("                           NO BODY. It never sees an exception, and it");
    Console.WriteLine("                           covers the 404 from routing and every bare");
    Console.WriteLine("                           status a handler returns.");
    Console.WriteLine();
    Console.WriteLine("   Neither is a superset of the other, which is why an app with only the");
    Console.WriteLine("   first still returns empty 404s and an app with only the second still");
    Console.WriteLine("   returns empty 500s. SHIP BOTH.");
    Console.WriteLine();
    Console.WriteLine("   A body that already exists is left alone by both, so a handler that");
    Console.WriteLine("   returns its own 400 document keeps it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task StillLogged()
{
    Console.WriteLine("4. What reaches the log when the caller is told nothing");
    Console.WriteLine();
    Console.WriteLine("   Returning a bare traceId is only defensible if the detail is somewhere.");
    Console.WriteLine("   Predicted: the framework logs every unhandled exception at Error, so it");
    Console.WriteLine("   is, automatically.");
    Console.WriteLine();
    Console.WriteLine("   Measured, the same throwing endpoint under three configurations:");
    Console.WriteLine();
    Console.WriteLine("   configuration                      caller gets   exception in the log?");
    Console.WriteLine("   -------------                      -----------   ---------------------");

    foreach ((string label, LogCase kind) in new[]
    {
        ("no exception handler", LogCase.None),
        ("handler, does not log", LogCase.Silent),
        ("handler, logs the exception", LogCase.Logging)
    })
    {
        Logged logged = await LoggedAsync(kind);

        Console.WriteLine($"   {label,-33}  {logged.Caller,-11}   " +
            $"{(logged.Records.Count == 0 ? "no" : "YES")}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE PREDICTION WAS WRONG. An IExceptionHandler that returns true has");
    Console.WriteLine("   taken responsibility for the exception, and the framework takes it at");
    Console.WriteLine("   its word: nothing is logged. The Error entry Kestrel writes in row one");
    Console.WriteLine("   is exactly what row two removes.");
    Console.WriteLine();
    Console.WriteLine("   what each configuration left in the log:");
    Console.WriteLine();

    foreach ((string label, LogCase kind) in new[]
    {
        ("no exception handler", LogCase.None),
        ("handler, does not log", LogCase.Silent),
        ("handler, logs the exception", LogCase.Logging)
    })
    {
        Logged logged = await LoggedAsync(kind);
        Console.WriteLine($"     {label}");

        if (logged.Records.Count == 0)
        {
            Console.WriteLine("       (nothing above Information - the request finished with a 500");
            Console.WriteLine("        and no record of why)");
        }

        foreach (string record in logged.Records)
        {
            Console.WriteLine($"       {record}");
        }

        Console.WriteLine();
    }

    Console.WriteLine("   THIS IS THE TRAP OF THE WHOLE MODULE. You add an exception handler to");
    Console.WriteLine("   stop leaking stack traces, the error responses get better, and you have");
    Console.WriteLine("   silently stopped recording why anything failed. The next incident");
    Console.WriteLine("   presents as a rise in 500s with no exception anywhere to explain them.");
    Console.WriteLine();
    Console.WriteLine("   AN EXCEPTION HANDLER MUST LOG. It is not optional and nothing else will");
    Console.WriteLine("   do it for you. Inject ILogger, log at Error with the exception object -");
    Console.WriteLine("   not its message - so the stack is kept, and include the same id the");
    Console.WriteLine("   caller was given.");
    Console.WriteLine();
    Console.WriteLine("   The rule generalises past this API: WHEREVER YOU HANDLE AN EXCEPTION IN");
    Console.WriteLine("   ORDER TO RETURN SOMETHING TIDY, YOU HAVE BECOME THE ONLY PLACE THAT");
    Console.WriteLine("   KNOWS IT HAPPENED.");
    Console.WriteLine();

    // Which id is which, measured rather than assumed.
    (string trace, string identifier, string body) = await IdentifiersAsync(logging: true);
    (string _, string _, string quiet) = await IdentifiersAsync(logging: false);

    Console.WriteLine("   ONE MORE THING WORTH KNOWING ABOUT traceId. Two different values can");
    Console.WriteLine("   end up in that field:");
    Console.WriteLine();
    Console.WriteLine($"     Activity.Current?.Id        {trace}");
    Console.WriteLine($"     HttpContext.TraceIdentifier {identifier}");
    Console.WriteLine();
    Console.WriteLine("   and the document gets the first if there is one, the second otherwise:");
    Console.WriteLine();
    Console.WriteLine($"     with a logging provider     {body}");
    Console.WriteLine($"     with logging cleared        {quiet}");
    Console.WriteLine();
    Console.WriteLine("   The first is the W3C trace id, shared by every service the request");
    Console.WriteLine("   touches. The second is Kestrel's connection id and request number, and");
    Console.WriteLine("   it means nothing outside this process.");
    Console.WriteLine();
    Console.WriteLine("   The practical consequence: THE ID IN THE RESPONSE IS NOT ALWAYS THE ID");
    Console.WriteLine("   IN YOUR CODE. A handler that logs context.TraceIdentifier while the");
    Console.WriteLine("   document carries the activity id gives the customer a string that");
    Console.WriteLine("   matches nothing in your log store - the failure this whole field exists");
    Console.WriteLine("   to prevent, reintroduced by hand.");
    Console.WriteLine();
    Console.WriteLine("   VERIFY IT THE ONLY WAY THAT SETTLES IT. Take a traceId out of a real");
    Console.WriteLine("   error response, search your logs for that exact string, and confirm you");
    Console.WriteLine("   land on the exception.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Summary()
{
    Console.WriteLine("5. Which silence is which");
    Console.WriteLine();
    Console.WriteLine("   You have an endpoint returning something other than your error");
    Console.WriteLine("   document. Four causes, and each has a distinguishing symptom:");
    Console.WriteLine();
    Console.WriteLine("   symptom                              cause");
    Console.WriteLine("   -------                              -----");
    Console.WriteLine("   500, empty body, no content type     nothing handled it: the handler");
    Console.WriteLine("                                        is missing, or is registered");
    Console.WriteLine("                                        after the middleware that threw");
    Console.WriteLine();
    Console.WriteLine("   200, truncated or invalid body       the response had started; no");
    Console.WriteLine("                                        handler could have run");
    Console.WriteLine();
    Console.WriteLine("   404 or 403, empty body               not an exception at all -");
    Console.WriteLine("                                        UseStatusCodePages is missing");
    Console.WriteLine();
    Console.WriteLine("   a full stack trace in the body       the developer exception page is");
    Console.WriteLine("                                        on: check ASPNETCORE_ENVIRONMENT");
    Console.WriteLine("                                        in that environment");
    Console.WriteLine();
    Console.WriteLine("   The order to check them in is the order of that table, because it runs");
    Console.WriteLine("   from cheapest to hardest to see: the first two are visible in one curl");
    Console.WriteLine("   with -i, and the last is visible in one deployment lookup.");
}

// ---------------------------------------------------------------------------
static async Task<Result> ProbeAsync(Action<WebApplication> extra, bool throwerFirst)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();
    builder.Services.AddExceptionHandler<CatchAll>();

    var app = builder.Build();

    if (throwerFirst)
    {
        app.Use(Throwing);
        app.UseExceptionHandler();
    }
    else
    {
        app.UseExceptionHandler();
        app.Use(Throwing);
    }

    extra(app);
    app.MapGet("/never", () => "unreachable");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    using HttpResponseMessage response = await http.GetAsync("/never");
    string body = await response.Content.ReadAsStringAsync();
    await app.StopAsync();

    return new Result(
        (int)response.StatusCode,
        response.Content.Headers.ContentType?.MediaType ?? "(none)",
        body.Length == 0 ? "(empty)" : (body.Length > 44 ? body[..44] + "..." : body));

    // Stands in for the header-reading middleware that was fine until a caller
    // sent a header it did not expect.
    static Task Throwing(HttpContext context, RequestDelegate next) =>
        throw new FormatException("malformed X-Tenant header");
}

// ---------------------------------------------------------------------------
static async Task<(string Thrown, string Returned, string Missing)> ThreeWaysAsync(
    bool handler, bool pages)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();

    if (handler)
    {
        builder.Services.AddExceptionHandler<CatchAll>();
    }

    var app = builder.Build();

    if (handler)
    {
        app.UseExceptionHandler();
    }

    if (pages)
    {
        app.UseStatusCodePages();
    }

    app.MapGet("/throws", void () => throw new InvalidOperationException("boom"));
    app.MapGet("/forbidden", () => Results.StatusCode(403));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    string thrown = await DescribeAsync(http, "/throws");
    string returned = await DescribeAsync(http, "/forbidden");
    string missing = await DescribeAsync(http, "/no-such-path");

    await app.StopAsync();
    return (thrown, returned, missing);

    static async Task<string> DescribeAsync(HttpClient http, string path)
    {
        using HttpResponseMessage response = await http.GetAsync(path);
        string body = await response.Content.ReadAsStringAsync();

        return $"{(int)response.StatusCode} {(body.Length == 0 ? "empty" : "document")}";
    }
}

// ---------------------------------------------------------------------------
static async Task<Logged> LoggedAsync(LogCase kind)
{
    var records = new ConcurrentQueue<string>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Logging.AddProvider(new CapturingLoggerProvider(records));
    builder.Logging.SetMinimumLevel(LogLevel.Warning);
    builder.Services.AddProblemDetails();

    switch (kind)
    {
        case LogCase.Silent:
            builder.Services.AddExceptionHandler<CatchAll>();
            break;
        case LogCase.Logging:
            builder.Services.AddExceptionHandler<LoggingCatchAll>();
            break;
    }

    var app = builder.Build();

    if (kind != LogCase.None)
    {
        app.UseExceptionHandler();
    }

    app.MapGet("/boom", void () => throw new InvalidOperationException("gateway timed out"));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    using HttpResponseMessage response = await http.GetAsync("/boom");
    string body = await response.Content.ReadAsStringAsync();
    await app.StopAsync();

    return new Logged(
        $"{(int)response.StatusCode} {(body.Length == 0 ? "empty" : "document")}",
        [.. records]);
}

// ---------------------------------------------------------------------------
static async Task<(string Trace, string Identifier, string Body)> IdentifiersAsync(bool logging)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    if (logging)
    {
        // Any provider at all is enough: hosting starts an Activity for the
        // request once something is listening.
        builder.Logging.AddProvider(new CapturingLoggerProvider(new ConcurrentQueue<string>()));
    }

    builder.Services.AddProblemDetails();

    var app = builder.Build();

    string trace = "(none)";
    string identifier = "(none)";

    app.MapGet("/ids", (HttpContext context) =>
    {
        trace = Activity.Current?.Id ?? "(no activity)";
        identifier = context.TraceIdentifier;

        return Results.Problem(title: "An unexpected error occurred", statusCode: 500);
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    using HttpResponseMessage response = await http.GetAsync("/ids");
    string body = await response.Content.ReadAsStringAsync();
    await app.StopAsync();

    int index = body.IndexOf("\"traceId\":", StringComparison.Ordinal);
    string field = index < 0 ? "(no traceId)" : body[index..].TrimEnd('}');

    return (trace, identifier, field);
}

// ---------------------------------------------------------------------------
record Result(int Status, string ContentType, string Body);

enum LogCase { None, Silent, Logging }

record Logged(string Caller, List<string> Records);

public sealed class CatchAll(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        context.Response.StatusCode = 500;

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = { Title = "An unexpected error occurred", Status = 500 }
        });
    }
}

// The same catch-all, with the one line that section 4 shows is not optional.
public sealed class LoggingCatchAll(IProblemDetailsService problemDetails,
    ILogger<LoggingCatchAll> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        // The exception OBJECT, not its message - that is what keeps the stack.
        // The id is the one the caller is about to be given.
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

// A logger provider that keeps what was written, so section 4 can show it.
public sealed class CapturingLoggerProvider(ConcurrentQueue<string> records) : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new Capturing(categoryName, records);

    public void Dispose() { }

    private sealed class Capturing(string category, ConcurrentQueue<string> records) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Warning;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
            Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
            {
                return;
            }

            string message = formatter(state, exception);
            string shortCategory = category[(category.LastIndexOf('.') + 1)..];

            records.Enqueue($"{logLevel}: {shortCategory}: {message}");

            if (exception is not null)
            {
                records.Enqueue($"       {exception.GetType().Name}: {exception.Message}");

                string firstFrame = (exception.StackTrace ?? "")
                    .Split('\n')
                    .FirstOrDefault(line => line.Contains("at ", StringComparison.Ordinal))
                    ?.Trim() ?? "(no stack)";

                records.Enqueue($"       {firstFrame}");
            }
        }
    }
}
