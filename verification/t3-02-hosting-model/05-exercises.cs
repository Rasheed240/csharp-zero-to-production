// 05-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 05-exercises.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

#pragma warning disable ASP0000    // BuildServiceProvider: see 02-services-and-scopes.cs

await Exercise1();
await Exercise2();
await Exercise3();
await Exercise4();
await Exercise5();
Exercise6();

// ---------------------------------------------------------------------------
// 1. EASY — before Build() or after?
// ---------------------------------------------------------------------------
static async Task Exercise1()
{
    Console.WriteLine("Exercise 1: which of these go before Build(), and which after?");
    Console.WriteLine();
    Console.WriteLine("     a. builder.Services.AddSingleton<IClock, SystemClock>();");
    Console.WriteLine("     b. app.UseAuthentication();");
    Console.WriteLine("     c. builder.Configuration.AddJsonFile(\"extra.json\");");
    Console.WriteLine("     d. app.MapGet(\"/health\", () => \"ok\");");
    Console.WriteLine("     e. builder.Logging.AddConsole();");
    Console.WriteLine("     f. app.Run();");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();
    app.MapGet("/", () => "ok");
    await app.StartAsync();

    // The mechanical test: what happens if you get it wrong.
    string late;
    try
    {
        builder.Services.AddSingleton<object>(new object());
        late = "allowed";
    }
    catch (InvalidOperationException ex)
    {
        late = ex.Message;
    }

    await app.StopAsync();

    Console.WriteLine("   BEFORE Build()  a, c, e   they describe WHAT EXISTS");
    Console.WriteLine("   AFTER Build()   b, d, f   they describe WHAT HAPPENS");
    Console.WriteLine();
    Console.WriteLine($"   registering after Build(): {late}");
    Console.WriteLine();
    Console.WriteLine("   The rule is not a convention. Build() creates the container from");
    Console.WriteLine("   the registrations and freezes the list, because a provider that");
    Console.WriteLine("   has already handed out singletons cannot honestly accept a new");
    Console.WriteLine("   registration for something it has already resolved.");
    Console.WriteLine();
    Console.WriteLine("   Configuration and logging belong to the builder for the same");
    Console.WriteLine("   reason: they are read while the container is being built, so");
    Console.WriteLine("   adding a source afterwards would come too late to affect anything");
    Console.WriteLine("   that read it.");
    Console.WriteLine();
    Console.WriteLine("   A practical tell: if an extension method takes 'this");
    Console.WriteLine("   IServiceCollection' it is a before-Build call; if it takes 'this");
    Console.WriteLine("   IApplicationBuilder' or 'this WebApplication' it is an after-Build");
    Console.WriteLine("   call. AddX before, UseX after, with very few exceptions.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. EASY — middleware order.
// ---------------------------------------------------------------------------
static async Task Exercise2()
{
    Console.WriteLine("Exercise 2: in what order do these see the request and the response?");
    Console.WriteLine();
    Console.WriteLine("     app.Use(A);  app.Use(B);  app.Use(C);  app.MapGet(\"/\", handler);");
    Console.WriteLine();

    var order = new List<string>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.Use(async (ctx, next) => { order.Add("A in"); await next(); order.Add("A out"); });
    app.Use(async (ctx, next) => { order.Add("B in"); await next(); order.Add("B out"); });
    app.Use(async (ctx, next) => { order.Add("C in"); await next(); order.Add("C out"); });
    app.MapGet("/", () => { order.Add("handler"); return "ok"; });

    await app.StartAsync();
    using (var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) })
    {
        await http.GetStringAsync("/");
    }

    await app.StopAsync();

    Console.WriteLine($"   {string.Join(" -> ", order)}");
    Console.WriteLine();
    Console.WriteLine("   Registration order on the way IN, reverse order on the way OUT.");
    Console.WriteLine("   Each middleware wraps everything registered after it, which is why");
    Console.WriteLine("   the pipeline is nested rather than sequential.");
    Console.WriteLine();
    Console.WriteLine("   Three consequences that decide real ordering:");
    Console.WriteLine();
    Console.WriteLine("     - EXCEPTION HANDLING GOES FIRST. It can only catch what it wraps,");
    Console.WriteLine("       and it wraps everything registered after it.");
    Console.WriteLine();
    Console.WriteLine("     - AUTHORISATION GOES AFTER ROUTING. It needs to know which");
    Console.WriteLine("       endpoint was matched before it can decide whether the caller");
    Console.WriteLine("       may reach it. Before routing there is no endpoint yet.");
    Console.WriteLine();
    Console.WriteLine("     - ANYTHING WRITING RESPONSE HEADERS MUST RUN BEFORE THE RESPONSE");
    Console.WriteLine("       STARTS. A middleware setting a header after await next() is");
    Console.WriteLine("       usually too late, because the handler has already begun");
    Console.WriteLine("       writing. Use HttpResponse.OnStarting for that.");
    Console.WriteLine();
    Console.WriteLine("   A middleware that does not call next() SHORT-CIRCUITS: nothing");
    Console.WriteLine("   after it runs, and the response is whatever it wrote. That is how");
    Console.WriteLine("   a rate limiter or an auth failure returns without touching the");
    Console.WriteLine("   endpoint.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — a background service that needs a scoped dependency.
// ---------------------------------------------------------------------------
static async Task Exercise3()
{
    Console.WriteLine("Exercise 3: this background service will not start. Why?");
    Console.WriteLine();
    Console.WriteLine("     public sealed class Publisher : BackgroundService");
    Console.WriteLine("     {");
    Console.WriteLine("         private readonly LedgerDbContext _db;");
    Console.WriteLine("         public Publisher(LedgerDbContext db) => _db = db;");
    Console.WriteLine("         ...");
    Console.WriteLine("     }");
    Console.WriteLine();

    var services = new ServiceCollection();
    services.AddSingleton<BadPublisher>();
    services.AddScoped<LedgerDbContext>();

    ServiceProvider provider = services.BuildServiceProvider(
        new ServiceProviderOptions { ValidateScopes = true });

    string result;
    try
    {
        using IServiceScope scope = provider.CreateScope();
        scope.ServiceProvider.GetRequiredService<BadPublisher>();
        result = "no error";
    }
    catch (InvalidOperationException ex)
    {
        result = ex.Message;
    }

    provider.Dispose();

    Console.WriteLine($"   {result}");
    Console.WriteLine();
    Console.WriteLine("   A BackgroundService is registered as a SINGLETON - it is created");
    Console.WriteLine("   once and lives as long as the application. A DbContext is SCOPED.");
    Console.WriteLine("   A singleton cannot depend on a scoped service, because it would");
    Console.WriteLine("   hold one forever and hand the same instance to every unit of work.");
    Console.WriteLine();
    Console.WriteLine("   The fix is to take a scope factory and create a scope per unit of");
    Console.WriteLine("   work:");
    Console.WriteLine();
    Console.WriteLine("     public Publisher(IServiceScopeFactory scopeFactory)");
    Console.WriteLine("         => _scopeFactory = scopeFactory;");
    Console.WriteLine();
    Console.WriteLine("     while (!stoppingToken.IsCancellationRequested)");
    Console.WriteLine("     {");
    Console.WriteLine("         using IServiceScope scope = _scopeFactory.CreateScope();");
    Console.WriteLine("         var db = scope.ServiceProvider");
    Console.WriteLine("             .GetRequiredService<LedgerDbContext>();");
    Console.WriteLine("         // ... one batch ...");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   Two details that are wrong more often than the main point:");
    Console.WriteLine();
    Console.WriteLine("     - THE SCOPE GOES INSIDE THE LOOP. One scope around the loop is");
    Console.WriteLine("       the same bug in a different shape: a single DbContext that");
    Console.WriteLine("       accumulates every tracked entity the worker ever sees, getting");
    Console.WriteLine("       slower on every iteration.");
    Console.WriteLine();
    Console.WriteLine("     - IT ONLY THROWS IF SCOPE VALIDATION IS ON. That is the default");
    Console.WriteLine("       in Development and NOT in Production, so this failure can be");
    Console.WriteLine("       absent locally and present in the environment that matters.");
    Console.WriteLine("       Turn ValidateScopes and ValidateOnBuild on everywhere.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — deploys drop requests despite graceful shutdown.
// ---------------------------------------------------------------------------
static async Task Exercise4()
{
    Console.WriteLine("Exercise 4: graceful shutdown works, and deploys still drop requests.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();
    app.MapGet("/work", async () => { await Task.Delay(250); return "done"; });

    await app.StartAsync();
    string baseUrl = app.Urls.First();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };
    Task<HttpResponseMessage> inFlight = http.GetAsync("/work");
    await Task.Delay(80);

    Task stopping = app.StopAsync();
    await Task.Delay(40);

    string arriving;
    try
    {
        using var fresh = new HttpClient { BaseAddress = new Uri(baseUrl) };
        HttpResponseMessage late = await fresh.GetAsync("/work");
        arriving = $"{(int)late.StatusCode}";
    }
    catch (HttpRequestException)
    {
        arriving = "connection refused";
    }

    HttpResponseMessage settled = await inFlight;
    await stopping;

    Console.WriteLine($"   already in the handler : {(int)settled.StatusCode} {await settled.Content.ReadAsStringAsync()}");
    Console.WriteLine($"   arriving 40 ms later   : {arriving}");
    Console.WriteLine();
    Console.WriteLine("   Graceful shutdown drains what it has ACCEPTED. It closes the");
    Console.WriteLine("   listening socket immediately, so anything arriving afterwards is");
    Console.WriteLine("   refused at the TCP level - there is no server left to answer with");
    Console.WriteLine("   a status code.");
    Console.WriteLine();
    Console.WriteLine("   The window is between the moment the process gets SIGTERM and the");
    Console.WriteLine("   moment the load balancer stops routing to it, and the load");
    Console.WriteLine("   balancer is always the slower of the two.");
    Console.WriteLine();
    Console.WriteLine("   Two changes, neither of them in the application code:");
    Console.WriteLine();
    Console.WriteLine("     1. A PRESTOP HOOK that sleeps longer than the load balancer");
    Console.WriteLine("        takes to notice. The pod keeps serving normally while it is");
    Console.WriteLine("        removed from rotation. Five to fifteen seconds is typical,");
    Console.WriteLine("        and it must exceed probe interval x failure threshold.");
    Console.WriteLine();
    Console.WriteLine("     2. A READINESS PROBE THAT FLIPS ON ApplicationStopping, so the");
    Console.WriteLine("        load balancer is told rather than left to discover it.");
    Console.WriteLine();
    Console.WriteLine("   Note the ordering these imply: the pod must report unready BEFORE");
    Console.WriteLine("   it stops accepting connections. That is the whole purpose of the");
    Console.WriteLine("   preStop sleep - it buys the time in which those two facts differ.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 5. HARD — where to put warm-up.
// ---------------------------------------------------------------------------
static async Task Exercise5()
{
    Console.WriteLine("Exercise 5: a cache takes 3 seconds to load and every request needs it.");
    Console.WriteLine();
    Console.WriteLine("   Three candidate places. Which of them can serve a request before");
    Console.WriteLine("   the cache is ready?");
    Console.WriteLine();
    Console.WriteLine("     a. in Program.cs, after Build() and before Run()");
    Console.WriteLine("     b. in IHostedService.StartAsync");
    Console.WriteLine("     c. in BackgroundService.ExecuteAsync");
    Console.WriteLine();

    (bool servedEarlyB, long portB, long doneB) = await MeasureAsync(useBackgroundService: false);
    (bool servedEarlyC, long portC, long doneC) = await MeasureAsync(useBackgroundService: true);

    Console.WriteLine("   placement                    warm-up done   port open   served early?");
    Console.WriteLine("   ---------                    ------------   ---------   -------------");
    Console.WriteLine($"   b. IHostedService.StartAsync {doneB,10} ms {portB,8} ms   {(servedEarlyB ? "YES" : "no"),13}");
    Console.WriteLine($"   c. BackgroundService        {doneC,10} ms {portC,8} ms   {(servedEarlyC ? "YES" : "no"),13}");
    Console.WriteLine();
    Console.WriteLine("   (a) and (b) are both safe, for the same reason: the server is not");
    Console.WriteLine("   listening yet, so no request can exist. (c) is not - ExecuteAsync");
    Console.WriteLine("   does not hold up startup, so the port opens while the cache is");
    Console.WriteLine("   still loading.");
    Console.WriteLine();
    Console.WriteLine("   So (c) is the wrong answer to the question as asked. But the");
    Console.WriteLine("   interesting part is what (a) and (b) cost, because 'safe' is not");
    Console.WriteLine("   the same as 'correct':");
    Console.WriteLine();
    Console.WriteLine("     - THE PORT DOES NOT OPEN FOR 3 SECONDS. A TCP-based startup probe");
    Console.WriteLine("       sees a closed port and, if its threshold is short, restarts the");
    Console.WriteLine("       pod before it can ever finish loading. That is a crash loop");
    Console.WriteLine("       caused by a warm-up that works.");
    Console.WriteLine();
    Console.WriteLine("     - A FAILURE THERE IS FATAL. An exception in StartAsync stops the");
    Console.WriteLine("       host. That is usually what you want - refusing to start beats");
    Console.WriteLine("       serving wrong answers - but it must be a deliberate choice.");
    Console.WriteLine();
    Console.WriteLine("     - THREE SECONDS IS ADDED TO EVERY DEPLOY, per pod.");
    Console.WriteLine();
    Console.WriteLine("   The answer that scales: warm up in a BackgroundService AND report");
    Console.WriteLine("   unhealthy from a readiness check until it is done. The port opens");
    Console.WriteLine("   immediately so probes are satisfied, and no traffic is routed until");
    Console.WriteLine("   the cache is ready. It costs a health check and removes the");
    Console.WriteLine("   dependency on hosted-service ordering entirely.");
    Console.WriteLine();
    Console.WriteLine("   Use (a) or (b) when the work is fast and MUST have happened -");
    Console.WriteLine("   database migrations are the standard example. Use the health-check");
    Console.WriteLine("   approach when it is slow.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<(bool ServedEarly, long PortOpen, long WarmupDone)> MeasureAsync(
    bool useBackgroundService)
{
    var clock = Stopwatch.StartNew();
    Warmup.Reset(clock);

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton(clock);

    if (useBackgroundService)
    {
        builder.Services.AddHostedService<WarmupBackground>();
    }
    else
    {
        builder.Services.AddHostedService<WarmupHosted>();
    }

    var app = builder.Build();
    app.MapGet("/", () => Warmup.Ready ? "ready" : "NOT READY");

    await app.StartAsync();
    long portOpen = clock.ElapsedMilliseconds;

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    string body = await http.GetStringAsync("/");
    bool servedEarly = body == "NOT READY";

    while (!Warmup.Ready)
    {
        await Task.Delay(20);
    }

    long done = Warmup.DoneAt;
    await app.StopAsync();

    return (servedEarly, portOpen, done);
}

// ---------------------------------------------------------------------------
// 6. HARD — the shutdown budget.
// ---------------------------------------------------------------------------
static void Exercise6()
{
    Console.WriteLine("Exercise 6: set the shutdown budget for this service.");
    Console.WriteLine();
    Console.WriteLine("   Given:");
    Console.WriteLine("     - the slowest endpoint legitimately takes 20 s (a report)");
    Console.WriteLine("     - the load balancer takes up to 6 s to stop routing");
    Console.WriteLine("     - a background worker finishes its batch within 2 s");
    Console.WriteLine("     - connection teardown adds about 1 s (measured in");
    Console.WriteLine("       03-graceful-shutdown.cs)");
    Console.WriteLine();
    Console.WriteLine("   Work out preStop sleep, ShutdownTimeout, and");
    Console.WriteLine("   terminationGracePeriodSeconds.");
    Console.WriteLine();
    Console.WriteLine("   ANSWER");
    Console.WriteLine();
    Console.WriteLine("   preStop sleep = 10 s");
    Console.WriteLine("     Must exceed the 6 s the load balancer needs, with margin. During");
    Console.WriteLine("     this the pod is serving normally and being drained of new work.");
    Console.WriteLine();
    Console.WriteLine("   ShutdownTimeout = 25 s");
    Console.WriteLine("     Must exceed the slowest endpoint (20 s), not the average. The");
    Console.WriteLine("     worker's 2 s fits inside this. It is a DEADLINE, not a target -");
    Console.WriteLine("     a healthy shutdown returns as soon as it is finished, so being");
    Console.WriteLine("     generous costs nothing when nothing is slow.");
    Console.WriteLine();
    Console.WriteLine("   terminationGracePeriodSeconds = 40 s");
    Console.WriteLine("     10 preStop + 25 timeout + 1 teardown = 36, rounded up for margin.");
    Console.WriteLine();
    Console.WriteLine("   THE ORDERING CONSTRAINT IS THE POINT:");
    Console.WriteLine();
    Console.WriteLine("     preStop + ShutdownTimeout + teardown  <  terminationGracePeriod");
    Console.WriteLine();
    Console.WriteLine("   If that inequality is violated, SIGKILL arrives mid-drain and every");
    Console.WriteLine("   in-flight request dies - the graceful shutdown you configured never");
    Console.WriteLine("   gets to finish. Both defaults are 30 s, so the out-of-the-box");
    Console.WriteLine("   configuration violates it the moment you add a preStop hook.");
    Console.WriteLine();
    Console.WriteLine("   Two follow-ups worth stating:");
    Console.WriteLine();
    Console.WriteLine("     - A 20-SECOND ENDPOINT IS THE REAL PROBLEM. It forces a 40-second");
    Console.WriteLine("       grace period, which makes every deploy and every scale-down");
    Console.WriteLine("       slow. Moving reports to a job queue would let the whole budget");
    Console.WriteLine("       drop to about 15 s.");
    Console.WriteLine();
    Console.WriteLine("     - NONE OF THIS SURVIVES SIGKILL. An out-of-memory kill or a lost");
    Console.WriteLine("       machine gives no notice at all. The budget reduces how often");
    Console.WriteLine("       you need work to be idempotent and restartable; it never");
    Console.WriteLine("       removes the need.");
}

// ---------------------------------------------------------------------------
sealed class LedgerDbContext
{
}

sealed class BadPublisher
{
    public BadPublisher(LedgerDbContext db) => Db = db;

    public LedgerDbContext Db { get; }
}

static class Warmup
{
    private static Stopwatch? _clock;

    public static bool Ready { get; private set; }

    public static long DoneAt { get; private set; }

    public static void Reset(Stopwatch clock)
    {
        _clock = clock;
        Ready = false;
        DoneAt = 0;
    }

    public static async Task LoadAsync(CancellationToken cancellationToken)
    {
        // Shortened from 3 seconds so the file finishes in reasonable time.
        // The ordering is what matters, not the duration.
        await Task.Delay(300, cancellationToken);
        DoneAt = _clock!.ElapsedMilliseconds;
        Ready = true;
    }
}

sealed class WarmupHosted : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken) => Warmup.LoadAsync(cancellationToken);

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

sealed class WarmupBackground : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Warmup.LoadAsync(stoppingToken);
}
