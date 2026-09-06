// 02-writing-middleware.cs — The three ways to write a middleware, and the
// lifetime trap in the most common one.
//
// Run:  dotnet run 02-writing-middleware.cs -c Release
//
// EXACT vs RATIO: every instance count here is exact, taken from constructors.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;

await ThreeForms();
await HowManyTimesConstructed();
await TheCaptiveDependency();
Choosing();

// ---------------------------------------------------------------------------
static async Task ThreeForms()
{
    Console.WriteLine("1. The three forms, all doing the same thing");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // Only the IMiddleware form needs registering in the container.
    builder.Services.AddScoped<FactoryMiddleware>();

    var app = builder.Build();

    // FORM 1: an inline lambda. No type, no registration.
    app.Use(async (context, next) =>
    {
        context.Response.Headers["X-Form-1"] = "inline";
        await next();
    });

    // FORM 2: a convention-based class. Not an interface - the framework finds
    // Invoke or InvokeAsync by reflection at startup.
    app.UseMiddleware<ConventionMiddleware>();

    // FORM 3: IMiddleware, resolved from the container per request.
    app.UseMiddleware<FactoryMiddleware>();

    app.MapGet("/", () => "ok");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    HttpResponseMessage response = await http.GetAsync("/");
    await app.StopAsync();

    Console.WriteLine("   headers set by each form:");
    foreach (string name in new[] { "X-Form-1", "X-Form-2", "X-Form-3" })
    {
        Console.WriteLine($"     {name}: {response.Headers.GetValues(name).First()}");
    }

    Console.WriteLine();
    Console.WriteLine("   All three ran, in registration order, and there is no functional");
    Console.WriteLine("   difference in what they can do. The differences are in how they are");
    Console.WriteLine("   CONSTRUCTED, which is section 2, and that is where the trap is.");
    Console.WriteLine();
    Console.WriteLine("   The convention-based form is the one most code uses and the one");
    Console.WriteLine("   most people cannot describe precisely. It is not an interface:");
    Console.WriteLine();
    Console.WriteLine("     - the constructor must take RequestDelegate as its first argument");
    Console.WriteLine("     - it must have a method called Invoke or InvokeAsync");
    Console.WriteLine("     - that method must return Task and take HttpContext first");
    Console.WriteLine();
    Console.WriteLine("   None of that is checked by the compiler. Getting a name or a");
    Console.WriteLine("   signature wrong is an exception at STARTUP, not a build error.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task HowManyTimesConstructed()
{
    Console.WriteLine("2. How many times each form is constructed");
    Console.WriteLine();

    Counters.Reset();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddScoped<FactoryMiddleware>();

    var app = builder.Build();
    app.UseMiddleware<ConventionMiddleware>();
    app.UseMiddleware<FactoryMiddleware>();
    app.MapGet("/", () => "ok");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    for (int i = 0; i < 5; i++)
    {
        await http.GetStringAsync("/");
    }

    await app.StopAsync();

    Console.WriteLine("   form                       constructed   for 5 requests");
    Console.WriteLine("   ----                       -----------   --------------");
    Console.WriteLine($"   convention-based class     {Counters.Convention,11}   once, at startup");
    Console.WriteLine($"   IMiddleware (scoped)       {Counters.Factory,11}   once per request");
    Console.WriteLine();
    Console.WriteLine("   THE CONVENTION-BASED CLASS IS EFFECTIVELY A SINGLETON. It is built");
    Console.WriteLine("   once when the pipeline is built, and the same instance serves every");
    Console.WriteLine("   request for the life of the application.");
    Console.WriteLine();
    Console.WriteLine("   Two consequences follow, and both are about state:");
    Console.WriteLine();
    Console.WriteLine("     - ANY FIELD YOU SET IS SHARED BY EVERY CONCURRENT REQUEST. A field");
    Console.WriteLine("       holding 'the current user' or 'the request id' is a race, not a");
    Console.WriteLine("       variable. Per-request state belongs in locals inside Invoke, or");
    Console.WriteLine("       on HttpContext.Items.");
    Console.WriteLine();
    Console.WriteLine("     - ANYTHING INJECTED INTO THE CONSTRUCTOR LIVES AS LONG AS THE");
    Console.WriteLine("       APPLICATION, whatever lifetime it was registered with. That is");
    Console.WriteLine("       section 3.");
    Console.WriteLine();
    Console.WriteLine("   The IMiddleware form is resolved from the container on every");
    Console.WriteLine("   request, so its lifetime is whatever you registered - scoped here,");
    Console.WriteLine("   giving five instances for five requests.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheCaptiveDependency()
{
    Console.WriteLine("3. Injecting a scoped service into a middleware");
    Console.WriteLine();

    string constructorResult = await TryAsync(useConstructorInjection: true);
    string invokeResult = await TryAsync(useConstructorInjection: false);

    Console.WriteLine($"   scoped service in the CONSTRUCTOR : {constructorResult}");
    Console.WriteLine($"   scoped service in INVOKE          : {invokeResult}");
    Console.WriteLine();
    Console.WriteLine("   A convention-based middleware is built once, so a scoped service in");
    Console.WriteLine("   its constructor would have to be captured for the life of the");
    Console.WriteLine("   application - one instance shared by every request, which is the");
    Console.WriteLine("   opposite of what scoped promised.");
    Console.WriteLine();
    Console.WriteLine("   The framework refuses rather than allowing it, and the message names");
    Console.WriteLine("   the problem directly.");
    Console.WriteLine();
    Console.WriteLine("   NOTICE WHERE IT FAILS: at STARTUP, not on the first request. A");
    Console.WriteLine("   convention-based middleware is constructed while the pipeline is");
    Console.WriteLine("   being built, which happens inside StartAsync. So this is one of the");
    Console.WriteLine("   few pipeline mistakes that cannot reach production quietly - the");
    Console.WriteLine("   process refuses to start.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS TO TAKE IT AS A PARAMETER OF Invoke:");
    Console.WriteLine();
    Console.WriteLine("     public async Task InvokeAsync(HttpContext context, LedgerDbContext db)");
    Console.WriteLine();
    Console.WriteLine("   Invoke is called per request, and its extra parameters are resolved");
    Console.WriteLine("   from the REQUEST'S scope. That is a feature of this form rather than");
    Console.WriteLine("   a workaround: the constructor is for things that live as long as the");
    Console.WriteLine("   application, and Invoke is for things that live as long as the");
    Console.WriteLine("   request.");
    Console.WriteLine();
    Console.WriteLine("   Note what this does NOT protect you from. Singletons in the");
    Console.WriteLine("   constructor are fine and are the point - an IOptions, a cache, an");
    Console.WriteLine("   ILogger. The refusal only fires for scoped services, and only");
    Console.WriteLine("   because scope validation catches it. A TRANSIENT service in the");
    Console.WriteLine("   constructor is accepted silently and lives forever, which is the");
    Console.WriteLine("   same bug with no error message.");
    Console.WriteLine();

    static async Task<string> TryAsync(bool useConstructorInjection)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Host.UseDefaultServiceProvider(options => options.ValidateScopes = true);
        builder.Services.AddScoped<RequestScoped>();

        var app = builder.Build();

        if (useConstructorInjection)
        {
            app.UseMiddleware<CapturingMiddleware>();
        }
        else
        {
            app.UseMiddleware<CorrectMiddleware>();
        }

        app.MapGet("/", (HttpContext context) => $"scoped id {context.Items["scoped-id"]}");

        // The pipeline is built during StartAsync, and that is where a
        // middleware constructor runs - so this is where it fails.
        string result;
        try
        {
            await app.StartAsync();
        }
        catch (InvalidOperationException ex)
        {
            return $"STARTUP FAILED - {ex.Message}";
        }

        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        result = $"started, and a request returned: {await http.GetStringAsync("/")}";

        await app.StopAsync();
        return result;
    }
}

// ---------------------------------------------------------------------------
static void Choosing()
{
    Console.WriteLine("4. Which form to use");
    Console.WriteLine();
    Console.WriteLine("   INLINE LAMBDA      for something short and used once. A header, a");
    Console.WriteLine("                      guard, a stopwatch. Past about ten lines it stops");
    Console.WriteLine("                      being readable in a startup file, and it cannot");
    Console.WriteLine("                      be unit-tested without starting a host.");
    Console.WriteLine();
    Console.WriteLine("   CONVENTION CLASS   the default for anything reusable. Built once, so");
    Console.WriteLine("                      no per-request allocation, and singletons in the");
    Console.WriteLine("                      constructor are resolved once rather than per");
    Console.WriteLine("                      request. Per-request services go in Invoke.");
    Console.WriteLine();
    Console.WriteLine("   IMiddleware        when you want the LIFETIME to be explicit and");
    Console.WriteLine("                      checked by the compiler rather than by reflection");
    Console.WriteLine("                      at startup. It is an interface, so a wrong");
    Console.WriteLine("                      signature is a build error rather than a startup");
    Console.WriteLine("                      exception.");
    Console.WriteLine();
    Console.WriteLine("   The IMiddleware form costs a container resolution per request and");
    Console.WriteLine("   must be registered, which is the reason it is less common. It is");
    Console.WriteLine("   worth it when the middleware genuinely holds per-request state, or");
    Console.WriteLine("   when a team keeps getting the constructor-versus-Invoke split wrong.");
    Console.WriteLine();
    Console.WriteLine("   Whichever form, wrap the registration in an extension method:");
    Console.WriteLine();
    Console.WriteLine("     public static IApplicationBuilder UseRequestTiming(");
    Console.WriteLine("         this IApplicationBuilder app) =>");
    Console.WriteLine("         app.UseMiddleware<RequestTimingMiddleware>();");
    Console.WriteLine();
    Console.WriteLine("   That is not decoration. It gives the middleware a name at the call");
    Console.WriteLine("   site, so a startup file reads as a sequence of decisions rather than");
    Console.WriteLine("   a list of type arguments - and ordering is the thing you will be");
    Console.WriteLine("   reading that file to check.");
}

// ---------------------------------------------------------------------------
static class Counters
{
    public static int Convention;
    public static int Factory;

    public static void Reset() => Convention = Factory = 0;
}

// FORM 2: convention-based. No interface. The framework looks for a
// constructor taking RequestDelegate and a method called Invoke or InvokeAsync.
sealed class ConventionMiddleware
{
    private readonly RequestDelegate _next;

    public ConventionMiddleware(RequestDelegate next)
    {
        _next = next;
        Interlocked.Increment(ref Counters.Convention);
    }

    public async Task InvokeAsync(HttpContext context)
    {
        context.Response.Headers["X-Form-2"] = "convention";
        await _next(context);
    }
}

// FORM 3: IMiddleware. Resolved from the container per request, so its
// lifetime is whatever it was registered with.
sealed class FactoryMiddleware : IMiddleware
{
    public FactoryMiddleware() => Interlocked.Increment(ref Counters.Factory);

    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        context.Response.Headers["X-Form-3"] = "factory";
        await next(context);
    }
}

sealed class RequestScoped
{
    private static int _created;

    public RequestScoped() => Id = Interlocked.Increment(ref _created);

    public int Id { get; }
}

// WRONG: a scoped service in the constructor of a middleware that is built
// once. It would be captured for the life of the application.
sealed class CapturingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly RequestScoped _scoped;

    public CapturingMiddleware(RequestDelegate next, RequestScoped scoped)
    {
        _next = next;
        _scoped = scoped;
    }

    public Task InvokeAsync(HttpContext context) => _next(context);
}

// RIGHT: the scoped service is a parameter of Invoke, resolved per request.
sealed class CorrectMiddleware
{
    private readonly RequestDelegate _next;

    public CorrectMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, RequestScoped scoped)
    {
        context.Items["scoped-id"] = scoped.Id;
        await _next(context);
    }
}
