// 04-response-lifecycle.cs — Why a middleware cannot always change the
// response on the way out, and the two APIs that exist because of it.
//
// Run:  dotnet run 04-response-lifecycle.cs -c Release
//
// EXACT vs RATIO: every status code, header presence and exception type here is
// deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

await SettingHeadersOnTheWayOut();
await OnStarting();
await ExceptionAfterTheResponseStarted();
Rules();

// ---------------------------------------------------------------------------
static async Task SettingHeadersOnTheWayOut()
{
    Console.WriteLine("1. Setting a header after next()");
    Console.WriteLine();

    string? caught = null;
    bool hasStartedAfterNext = false;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.Use(async (context, next) =>
    {
        await next();

        hasStartedAfterNext = context.Response.HasStarted;

        try
        {
            context.Response.Headers["X-Too-Late"] = "1";
        }
        catch (Exception ex)
        {
            caught = $"{ex.GetType().Name}: {ex.Message}";
        }
    });

    app.MapGet("/", () => "a body written by the endpoint");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    HttpResponseMessage response = await http.GetAsync("/");
    string body = await response.Content.ReadAsStringAsync();
    await app.StopAsync();

    Console.WriteLine($"   status                          : {(int)response.StatusCode}");
    Console.WriteLine($"   body                            : {body}");
    Console.WriteLine($"   Response.HasStarted after next  : {hasStartedAfterNext}");
    Console.WriteLine($"   setting a header then           : {caught ?? "no exception"}");
    Console.WriteLine($"   X-Too-Late reached the client   : {response.Headers.Contains("X-Too-Late")}");
    Console.WriteLine();
    Console.WriteLine("   THE RESPONSE HAD ALREADY STARTED. Headers and the status line go on");
    Console.WriteLine("   the wire before the body, so once the endpoint wrote anything they");
    Console.WriteLine("   are gone - and the assignment throws.");
    Console.WriteLine();
    Console.WriteLine("   This is the mistake that looks most reasonable in review. 'Add a");
    Console.WriteLine("   header after the response is produced' is a sentence that makes");
    Console.WriteLine("   sense and describes something impossible.");
    Console.WriteLine();
    Console.WriteLine("   Two properties are worth separating:");
    Console.WriteLine();
    Console.WriteLine("     HasStarted   the status line and headers have been sent. Nothing");
    Console.WriteLine("                  about them can change after this.");
    Console.WriteLine();
    Console.WriteLine("     Completed    the whole response has been written. Later still.");
    Console.WriteLine();
    Console.WriteLine("   Anything on the way OUT that wants to touch the response must check");
    Console.WriteLine("   HasStarted first, or use the callback in section 2.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task OnStarting()
{
    Console.WriteLine("2. OnStarting: the last moment before the headers go");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.Use(async (context, next) =>
    {
        var started = System.Diagnostics.Stopwatch.StartNew();

        // Registered on the way IN, runs at the last moment before the status
        // line and headers are written - after the endpoint has decided what
        // the response is, and before anything is on the wire.
        context.Response.OnStarting(() =>
        {
            context.Response.Headers["X-Elapsed-Ms"] =
                started.ElapsedMilliseconds.ToString();
            context.Response.Headers["X-Status-Seen"] =
                context.Response.StatusCode.ToString();
            return Task.CompletedTask;
        });

        await next();
    });

    app.MapGet("/ok", () => "fine");
    app.MapGet("/missing", () => Results.NotFound());

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    HttpResponseMessage ok = await http.GetAsync("/ok");
    HttpResponseMessage missing = await http.GetAsync("/missing");

    await app.StopAsync();

    Console.WriteLine("   path       status   X-Elapsed-Ms   X-Status-Seen");
    Console.WriteLine("   ----       ------   ------------   -------------");
    Console.WriteLine($"   /ok        {(int)ok.StatusCode,6}   {Header(ok, "X-Elapsed-Ms"),12}   {Header(ok, "X-Status-Seen"),13}");
    Console.WriteLine($"   /missing   {(int)missing.StatusCode,6}   {Header(missing, "X-Elapsed-Ms"),12}   {Header(missing, "X-Status-Seen"),13}");
    Console.WriteLine();
    Console.WriteLine("   The callback saw the FINAL status code - 404 for the second - and");
    Console.WriteLine("   was still able to add headers. That is the whole point: it runs");
    Console.WriteLine("   after the decision and before the wire.");
    Console.WriteLine();
    Console.WriteLine("   Three rules about it:");
    Console.WriteLine();
    Console.WriteLine("     - REGISTER IT ON THE WAY IN, before calling next. Registering it");
    Console.WriteLine("       after next is too late for the same reason section 1 was.");
    Console.WriteLine();
    Console.WriteLine("     - IT MAY NOT RUN. If nothing ever writes a response - a client");
    Console.WriteLine("       disconnects, the request is aborted - the headers are never");
    Console.WriteLine("       sent and the callback never fires. Do not put cleanup there.");
    Console.WriteLine();
    Console.WriteLine("     - KEEP IT CHEAP AND NON-THROWING. It runs on the hot path of every");
    Console.WriteLine("       response, and an exception from it happens at the worst possible");
    Console.WriteLine("       moment - the response is committed and cannot become a 500.");
    Console.WriteLine();
    Console.WriteLine("   There is a sibling, OnCompleted, which runs after the whole response");
    Console.WriteLine("   has been written. That one is for cleanup and timing, and it is too");
    Console.WriteLine("   late to change anything the client sees.");
    Console.WriteLine();

    static string Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? values.First() : "(absent)";
}

// ---------------------------------------------------------------------------
static async Task ExceptionAfterTheResponseStarted()
{
    Console.WriteLine("3. An exception after the response has started");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    bool hadStarted = false;

    // The standard exception handler, outermost.
    app.Use(async (context, next) =>
    {
        try
        {
            await next();
        }
        catch (Exception)
        {
            hadStarted = context.Response.HasStarted;

            if (!context.Response.HasStarted)
            {
                context.Response.StatusCode = 500;
                await context.Response.WriteAsync("handled cleanly");
            }

            // If the response HAS started there is nothing to do. The status
            // line said 200 several kilobytes ago.
        }
    });

    // Fails before writing anything.
    app.MapGet("/early", void () => throw new InvalidOperationException("before any output"));

    // Fails halfway through streaming.
    app.MapGet("/late", async (HttpContext context) =>
    {
        context.Response.ContentType = "text/plain";
        await context.Response.WriteAsync(new string('x', 4096));
        await context.Response.Body.FlushAsync();
        throw new InvalidOperationException("halfway through the body");
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    HttpResponseMessage early = await http.GetAsync("/early");
    string earlyBody = await early.Content.ReadAsStringAsync();

    string lateResult;
    int lateStatus;
    long lateBytes;
    try
    {
        HttpResponseMessage late = await http.GetAsync("/late");
        lateStatus = (int)late.StatusCode;
        byte[] bytes = await late.Content.ReadAsByteArrayAsync();
        lateBytes = bytes.Length;
        lateResult = "the client read a complete-looking body";
    }
    catch (HttpRequestException ex)
    {
        lateStatus = -1;
        lateBytes = -1;
        lateResult = $"the client threw: {ex.InnerException?.GetType().Name ?? ex.GetType().Name}";
    }

    await app.StopAsync();

    Console.WriteLine($"   /early  status {(int)early.StatusCode}, body '{earlyBody}'");
    Console.WriteLine($"   /late   status {lateStatus}, {lateBytes} body bytes");
    Console.WriteLine($"           {lateResult}");
    Console.WriteLine($"           HasStarted when the handler caught it: {hadStarted}");
    Console.WriteLine();
    Console.WriteLine("   THE SECOND ONE CANNOT BE TURNED INTO A 500. The status line went out");
    Console.WriteLine("   saying 200 before the exception existed, and there is no way to");
    Console.WriteLine("   recall it.");
    Console.WriteLine();
    Console.WriteLine("   What the client gets depends on the framing. With a Content-Length");
    Console.WriteLine("   it is a short read; with chunked encoding the terminating chunk");
    Console.WriteLine("   never arrives, so a careful client sees a protocol error and a");
    Console.WriteLine("   careless one sees a truncated body with a success status.");
    Console.WriteLine();
    Console.WriteLine("   That last case is the dangerous one. A client parsing JSON gets a");
    Console.WriteLine("   syntax error and might retry; a client reading a CSV silently");
    Console.WriteLine("   processes half the rows and reports success.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS NOT IN THE EXCEPTION HANDLER. It is to do the work that");
    Console.WriteLine("   can fail BEFORE writing anything:");
    Console.WriteLine();
    Console.WriteLine("     - fetch and validate first, then write");
    Console.WriteLine("     - for a genuinely streamed response, accept that a mid-stream");
    Console.WriteLine("       failure is a truncated response and make the client able to");
    Console.WriteLine("       detect it - a length prefix, a terminating record, a checksum");
    Console.WriteLine();
    Console.WriteLine("   And log it. ASP.NET Core writes 'The response has already started'");
    Console.WriteLine("   when this happens, which is the only signal you will get.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Rules()
{
    Console.WriteLine("4. The rules this produces");
    Console.WriteLine();
    Console.WriteLine("   1. ANYTHING THAT SETS A STATUS CODE OR HEADER MUST RUN BEFORE THE");
    Console.WriteLine("      RESPONSE STARTS. On the way in, or in an OnStarting callback.");
    Console.WriteLine();
    Console.WriteLine("   2. ON THE WAY OUT YOU MAY ONLY OBSERVE. Reading the status code to");
    Console.WriteLine("      log it is fine. Changing it is not, and will throw.");
    Console.WriteLine();
    Console.WriteLine("   3. CHECK HasStarted BEFORE WRITING, in any code that might run after");
    Console.WriteLine("      something else has responded. Exception handlers especially.");
    Console.WriteLine();
    Console.WriteLine("   4. DO THE WORK THAT CAN FAIL BEFORE WRITING ANYTHING.");
    Console.WriteLine();
    Console.WriteLine("   There is one more option, and it is worth knowing precisely because");
    Console.WriteLine("   it is usually the wrong answer: BUFFER THE RESPONSE. Replace");
    Console.WriteLine("   Response.Body with a MemoryStream, let the endpoint write into it,");
    Console.WriteLine("   inspect or rewrite it, then copy it to the real body.");
    Console.WriteLine();
    Console.WriteLine("   That makes everything above go away, and it costs:");
    Console.WriteLine();
    Console.WriteLine("     - the whole response held in memory, per concurrent request");
    Console.WriteLine("     - no streaming, so time-to-first-byte becomes time-to-last-byte");
    Console.WriteLine("     - a large or unbounded response becomes a memory limit");
    Console.WriteLine();
    Console.WriteLine("   Response caching and compression middleware do exactly this, and");
    Console.WriteLine("   they are worth the cost because they buy something large. A");
    Console.WriteLine("   middleware that buffers every response so it can add one header is");
    Console.WriteLine("   paying that price for something OnStarting does for free.");
}
