// 01-order-and-shortcircuit.cs — Use, Run and short-circuiting, and what the
// standard ordering rules are actually protecting.
//
// Run:  dotnet run 01-order-and-shortcircuit.cs -c Release
//
// EXACT vs RATIO: the ORDER and the status codes are deterministic and are the
// whole point. No timings are claimed.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

await UseAndRun();
await ShortCircuiting();
await WhenOrderIsWrong();
StandardOrder();

// ---------------------------------------------------------------------------
static async Task UseAndRun()
{
    Console.WriteLine("1. Use, Run, and what terminal means");
    Console.WriteLine();

    var log = new List<string>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.Use(async (context, next) =>
    {
        log.Add("Use A in");
        await next();
        log.Add("Use A out");
    });

    app.Use(async (context, next) =>
    {
        log.Add("Use B in");
        await next();
        log.Add("Use B out");
    });

    // Run takes no next delegate. It is TERMINAL: nothing after it can run,
    // because there is nothing for it to call.
    app.Run(async context =>
    {
        log.Add("Run (terminal)");
        await context.Response.WriteAsync("from Run");
    });

    // Registered after a Run, so it is unreachable. There is no error and no
    // warning - it is never called at all.
    app.Use(async (context, next) =>
    {
        log.Add("Use C in - THIS SHOULD NEVER APPEAR");
        await next();
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    string body = await http.GetStringAsync("/");
    await app.StopAsync();

    Console.WriteLine($"   response body : {body}");
    Console.WriteLine();
    Console.WriteLine("   what ran:");
    foreach (string line in log)
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   Use C never ran. It is registered after a terminal middleware, so");
    Console.WriteLine("   nothing can reach it - and nothing tells you.");
    Console.WriteLine();
    Console.WriteLine("     Use   takes (context, next). It may call next, or not.");
    Console.WriteLine("     Run   takes (context). There is no next to call, so the pipeline");
    Console.WriteLine("           ends there.");
    Console.WriteLine();
    Console.WriteLine("   Run is shorthand rather than a different mechanism: it is a Use that");
    Console.WriteLine("   ignores its next delegate. The value is that it says so at the");
    Console.WriteLine("   registration site.");
    Console.WriteLine();
    Console.WriteLine("   In a minimal-API application the endpoint middleware is the real");
    Console.WriteLine("   terminal step, added for you at the end. That is why unmatched");
    Console.WriteLine("   paths return 404 rather than hanging: something at the end always");
    Console.WriteLine("   produces a response.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ShortCircuiting()
{
    Console.WriteLine("2. Short-circuiting: not calling next");
    Console.WriteLine();

    var log = new List<string>();
    int endpointCalls = 0;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.Use(async (context, next) =>
    {
        log.Add($"outer in  ({context.Request.Path})");
        await next();
        log.Add($"outer out ({context.Request.Path}) status {context.Response.StatusCode}");
    });

    // A gate. Requests without the header never reach anything below.
    app.Use(async (context, next) =>
    {
        if (!context.Request.Headers.ContainsKey("X-Api-Key"))
        {
            log.Add("gate: no key, short-circuiting");
            context.Response.StatusCode = 401;
            await context.Response.WriteAsync("api key required");
            return;                     // next is NOT called
        }

        log.Add("gate: key present, continuing");
        await next();
    });

    app.MapGet("/data", () =>
    {
        Interlocked.Increment(ref endpointCalls);
        return "the data";
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    HttpResponseMessage without = await http.GetAsync("/data");

    using var withKey = new HttpRequestMessage(HttpMethod.Get, "/data");
    withKey.Headers.TryAddWithoutValidation("X-Api-Key", "k");
    HttpResponseMessage with = await http.SendAsync(withKey);

    await app.StopAsync();

    Console.WriteLine($"   without the header : {(int)without.StatusCode} " +
        $"{await without.Content.ReadAsStringAsync()}");
    Console.WriteLine($"   with the header    : {(int)with.StatusCode} " +
        $"{await with.Content.ReadAsStringAsync()}");
    Console.WriteLine($"   endpoint reached   : {endpointCalls} of 2 requests");
    Console.WriteLine();
    Console.WriteLine("   what ran:");
    foreach (string line in log)
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   NOT CALLING next IS THE MECHANISM. There is no special API for");
    Console.WriteLine("   rejecting a request - you write the response and return. That is how");
    Console.WriteLine("   authentication failures, rate limits, CORS preflight responses and");
    Console.WriteLine("   caches all work.");
    Console.WriteLine();
    Console.WriteLine("   Notice the OUTER middleware still ran its exit half on both");
    Console.WriteLine("   requests. Short-circuiting stops everything registered AFTER you; it");
    Console.WriteLine("   does not unwind what is already on the stack. Anything outside you");
    Console.WriteLine("   still sees the response - which is exactly what makes logging and");
    Console.WriteLine("   exception handling work when an inner middleware rejects a request.");
    Console.WriteLine();
    Console.WriteLine("   The rule that follows: DO NOT CALL next AFTER WRITING A RESPONSE.");
    Console.WriteLine("   Deciding to reject and then continuing anyway means two pieces of");
    Console.WriteLine("   code write to one response, and the second one fails or corrupts");
    Console.WriteLine("   the first.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhenOrderIsWrong()
{
    Console.WriteLine("3. The same two middlewares, two orders");
    Console.WriteLine();
    (int firstStatus, string firstBody) = await MeasureAsync(handlerFirst: true);
    (int secondStatus, string secondBody) = await MeasureAsync(handlerFirst: false);

    Console.WriteLine("   A middleware that throws, and an exception handler:");
    Console.WriteLine();
    Console.WriteLine("   handler position       status   body");
    Console.WriteLine("   ----------------       ------   ----");
    Console.WriteLine($"   BEFORE the thrower     {firstStatus,6}   {firstBody}");
    Console.WriteLine($"   AFTER the thrower      {secondStatus,6}   {secondBody}");
    Console.WriteLine();
    Console.WriteLine("   Same two components, opposite outcomes. A middleware can only observe");
    Console.WriteLine("   or affect what it WRAPS, and it wraps everything registered after it.");
    Console.WriteLine();
    Console.WriteLine("   In the second arrangement the handler is registered inside the thrower,");
    Console.WriteLine("   so the exception passes it on the way OUT rather than going through it.");
    Console.WriteLine("   Nothing catches it and the client gets a bare 500.");
    Console.WriteLine();
    Console.WriteLine("   That is the shape of every ordering bug in a pipeline: the component");
    Console.WriteLine("   runs, does its job correctly, and is in the wrong place to matter.");
    Console.WriteLine();
    Console.WriteLine("   ONE IMPORTANT EXCEPTION, and it is not obvious.");
    Console.WriteLine();
    Console.WriteLine("   The first draft of this file tried to make the same point with an");
    Console.WriteLine("   ENDPOINT that throws, moving the handler above and below the MapGet");
    Console.WriteLine("   call. Both arrangements caught the exception, which looked like the");
    Console.WriteLine("   rule failing.");
    Console.WriteLine();
    Console.WriteLine("   It is not. MapGet DOES NOT INSERT ANYTHING INTO THE PIPELINE AT THE");
    Console.WriteLine("   POINT YOU CALL IT. It registers a route in a table; the middleware that");
    Console.WriteLine("   executes the matched endpoint is appended automatically at the very");
    Console.WriteLine("   END, after everything you registered with Use.");
    Console.WriteLine();
    Console.WriteLine("   So the position of a Map call relative to your Use calls does not");
    Console.WriteLine("   change the pipeline at all - your middleware always wraps the endpoint.");
    Console.WriteLine("   Only the order of the Use calls among themselves matters.");
    Console.WriteLine();
    Console.WriteLine("   Two practical consequences:");
    Console.WriteLine();
    Console.WriteLine("     - A Use registered after every Map still runs BEFORE the endpoint.");
    Console.WriteLine("       Reading a startup file top to bottom does not tell you the order.");
    Console.WriteLine();
    Console.WriteLine("     - UseRouting and UseEndpoints exist to place those two steps");
    Console.WriteLine("       explicitly, which is how you put a middleware BETWEEN routing and");
    Console.WriteLine("       the endpoint - the only position from which you can see which");
    Console.WriteLine("       endpoint was matched and still refuse to run it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<(int, string)> MeasureAsync(bool handlerFirst)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    if (handlerFirst)
    {
        AddHandler(app);
    }

    // A middleware that fails, standing in for anything that can throw.
    app.Use((HttpContext context, Func<Task> next) =>
        throw new InvalidOperationException("gateway unreachable"));

    if (!handlerFirst)
    {
        AddHandler(app);
    }

    app.MapGet("/", () => "never reached");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    HttpResponseMessage response = await http.GetAsync("/");
    string body = await response.Content.ReadAsStringAsync();
    await app.StopAsync();

    return ((int)response.StatusCode, body.Length == 0 ? "(empty)" : body);

    static void AddHandler(WebApplication app) => app.Use(async (context, next) =>
    {
        try
        {
            await next();
        }
        catch (Exception ex)
        {
            if (!context.Response.HasStarted)
            {
                context.Response.StatusCode = 500;
                await context.Response.WriteAsync($"handled: {ex.GetType().Name}");
            }
        }
    });
}

// ---------------------------------------------------------------------------
static void StandardOrder()
{
    Console.WriteLine("4. The standard order, and the reason for each position");
    Console.WriteLine();
    Console.WriteLine("   Every rule below is the same rule - a middleware can only affect");
    Console.WriteLine("   what it wraps - applied to a different pair.");
    Console.WriteLine();
    Console.WriteLine("     1. ExceptionHandler / DeveloperExceptionPage");
    Console.WriteLine("        Outermost, because it can only catch what it wraps. Anything");
    Console.WriteLine("        registered before it throws past it.");
    Console.WriteLine();
    Console.WriteLine("     2. ForwardedHeaders");
    Console.WriteLine("        Before anything that reads the scheme or the client address -");
    Console.WriteLine("        which is HTTPS redirection, authentication, rate limiting and");
    Console.WriteLine("        logging, all of them.");
    Console.WriteLine();
    Console.WriteLine("     3. HSTS and HttpsRedirection");
    Console.WriteLine("        Before real work, so a plain-HTTP request is redirected rather");
    Console.WriteLine("        than served.");
    Console.WriteLine();
    Console.WriteLine("     4. StaticFiles");
    Console.WriteLine("        Before routing. Static files short-circuit, so a hit never pays");
    Console.WriteLine("        for routing, authentication or endpoint execution.");
    Console.WriteLine();
    Console.WriteLine("     5. Routing");
    Console.WriteLine("        Selects the endpoint and puts it on the context. Nothing before");
    Console.WriteLine("        this point knows which endpoint will run.");
    Console.WriteLine();
    Console.WriteLine("     6. CORS");
    Console.WriteLine("        After routing, before authentication. It must answer preflight");
    Console.WriteLine("        requests, which carry no credentials and must not be rejected");
    Console.WriteLine("        for lacking them.");
    Console.WriteLine();
    Console.WriteLine("     7. Authentication");
    Console.WriteLine("        Establishes WHO the caller is. Sets context.User and does not");
    Console.WriteLine("        reject anyone.");
    Console.WriteLine();
    Console.WriteLine("     8. Authorization");
    Console.WriteLine("        Decides whether that caller may reach THIS endpoint. Needs both");
    Console.WriteLine("        the user from step 7 and the endpoint from step 5, which is why");
    Console.WriteLine("        it cannot move above either.");
    Console.WriteLine();
    Console.WriteLine("     9. Your own middleware");
    Console.WriteLine();
    Console.WriteLine("    10. The endpoint");
    Console.WriteLine();
    Console.WriteLine("   Two consequences of that list worth remembering separately:");
    Console.WriteLine();
    Console.WriteLine("   AUTHENTICATION AND AUTHORISATION ARE TWO STEPS, and the split is not");
    Console.WriteLine("   ceremony. Authentication answers 'who is this', authorisation answers");
    Console.WriteLine("   'may they do this'. The second needs the endpoint, so routing must");
    Console.WriteLine("   sit between them.");
    Console.WriteLine();
    Console.WriteLine("   PUTTING UseAuthorization BEFORE UseRouting IS THE CLASSIC BUG. There");
    Console.WriteLine("   is no endpoint yet, so there is no [Authorize] metadata to enforce,");
    Console.WriteLine("   and every protected endpoint becomes public. ASP.NET Core now throws");
    Console.WriteLine("   at startup rather than letting that ship - one of the few ordering");
    Console.WriteLine("   mistakes the framework catches for you.");
    Console.WriteLine();
    Console.WriteLine("   For everything else, ordering is silent. Nothing warns you that a");
    Console.WriteLine("   response-compression middleware registered after the endpoint");
    Console.WriteLine("   compresses nothing.");
}
