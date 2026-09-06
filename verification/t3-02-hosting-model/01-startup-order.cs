// 01-startup-order.cs — The exact order a WebApplication starts, measured by
// printing from every phase rather than by reading documentation.
//
// Run:  dotnet run 01-startup-order.cs -c Release
//
// EXACT vs RATIO: the ORDER is deterministic and is the whole point. The one
// timing that appears (section 4) is a gap of hundreds of milliseconds against
// a 400 ms delay, so its SIGN is reliable even though its value is not.

#:sdk Microsoft.NET.Sdk.Web

using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.DependencyInjection;

var log = new List<string>();
var clock = Stopwatch.StartNew();
void Note(string phase) => log.Add(phase);

// Pick a free port up front. Kestrel's dynamic port is not knowable until the
// server has started, and section 4 needs to poll the port BEFORE that.
int port;
{
    var probe = new TcpListener(IPAddress.Loopback, 0);
    probe.Start();
    port = ((IPEndPoint)probe.LocalEndpoint).Port;
    probe.Stop();
}

// ---------------------------------------------------------------------------
// PHASE 1: the builder. Nothing is running yet. This creates the three things
// the application is made of - configuration, logging, and a service
// COLLECTION, which is a list of registrations rather than a container.
// ---------------------------------------------------------------------------
Note("1. CreateBuilder() returns");
var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
builder.Logging.ClearProviders();

// ---------------------------------------------------------------------------
// PHASE 2: registration. Adding to a list. No instance of anything is created
// here - not even a singleton.
// ---------------------------------------------------------------------------
Note("2. registering services");
builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddSingleton<GatewayConnection>();
builder.Services.AddScoped<RequestContext>();
builder.Services.AddSingleton(log);
builder.Services.AddSingleton(clock);

// TWO hosted services, so start and stop order can be measured rather than
// asserted. Registration order is First, then Second.
builder.Services.AddHostedService<FirstHostedService>();
builder.Services.AddHostedService<SecondHostedService>();
builder.Services.AddHostedService<SlowBackgroundService>();

// ---------------------------------------------------------------------------
// PHASE 3: Build(). The registrations are frozen and a CONTAINER is created
// from them. This is the dividing line the rest of the file is about.
// ---------------------------------------------------------------------------
Note("3. Build() called");
var app = builder.Build();
Note("4. Build() returned");

// ---------------------------------------------------------------------------
// PHASE 4: the pipeline. Middleware runs in REGISTRATION order on the way in
// and reverse order on the way out. Still nothing is listening.
// ---------------------------------------------------------------------------
app.Use(async (context, next) =>
{
    context.Items["order"] = "outer-in";
    await next();

    // The unwind order is recorded in a static rather than written to a
    // response header, because by the time this line runs the response has
    // already started and its headers are gone. Setting one here throws and
    // truncates the body mid-stream - which is the failure mode described in
    // the HTTP module, reproduced by accident while writing this file.
    Unwind.Order = (string?)context.Items["order"];
});

app.Use(async (context, next) =>
{
    context.Items["order"] += " inner-in";
    await next();
    context.Items["order"] += " inner-out";
});

app.MapGet("/", (RequestContext ctx, IClock c, HttpContext http) =>
    $"{http.Items["order"]} | scoped id {ctx.Id} | {c.Name}");

app.Lifetime.ApplicationStarted.Register(() => Note("7. ApplicationStarted fired"));
app.Lifetime.ApplicationStopping.Register(() => Note("9. ApplicationStopping fired"));
app.Lifetime.ApplicationStopped.Register(() => Note("11. ApplicationStopped fired"));

// Start polling the port BEFORE the host starts, so the first moment it
// accepts a connection can be compared against the hosted services.
var firstAccepted = new TaskCompletionSource<long>();
_ = Task.Run(async () =>
{
    while (!firstAccepted.Task.IsCompleted)
    {
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(IPAddress.Loopback, port);
            firstAccepted.TrySetResult(clock.ElapsedMilliseconds);
            return;
        }
        catch (SocketException)
        {
            await Task.Delay(10);
        }
    }
});

// ---------------------------------------------------------------------------
// PHASE 5: StartAsync. NOW things run: hosted services start, and the server
// begins accepting connections.
// ---------------------------------------------------------------------------
Note("5. StartAsync() called");
await app.StartAsync();
Note("8. StartAsync() returned");

await Report(app, log);
AfterBuildIsFrozen(builder);
await ScopePerRequest(app);
await AcceptingTraffic(firstAccepted, clock);
await ShutdownOrder(app, log);

// ---------------------------------------------------------------------------
static async Task Report(WebApplication app, List<string> log)
{
    Console.WriteLine("1. The order things actually happen");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    string body = await http.GetStringAsync("/");
    string unwound = Unwind.Order ?? "(not recorded)";

    foreach (string line in log)
    {
        Console.WriteLine($"   {line}");
    }

    Console.WriteLine();
    Console.WriteLine($"   on the way in  : {body}");
    Console.WriteLine($"   on the way out : {unwound}");
    Console.WriteLine();
    Console.WriteLine("   Read the numbers rather than the words. Three things follow from");
    Console.WriteLine("   that order and each one causes a different class of bug.");
    Console.WriteLine();
    Console.WriteLine("   (a) NOTHING IS CONSTRUCTED BEFORE Build(). Registration is adding to");
    Console.WriteLine("       a list. AddSingleton does not make a singleton; it records how to");
    Console.WriteLine("       make one later, on first use.");
    Console.WriteLine();
    Console.WriteLine("   (b) HOSTED SERVICES RUN INSIDE StartAsync, between 5 and 8. Whether");
    Console.WriteLine("       they finish before the server accepts traffic is section 4, and");
    Console.WriteLine("       the answer is not the one most people assume.");
    Console.WriteLine();
    Console.WriteLine("   (c) MIDDLEWARE RUNS IN REGISTRATION ORDER IN, REVERSE ORDER OUT. The");
    Console.WriteLine("       two lines above are the same request: the first registered");
    Console.WriteLine("       middleware sees it FIRST going in and LAST coming back.");
    Console.WriteLine();
    Console.WriteLine("       That is why it is a pipeline and not a list of handlers, and why");
    Console.WriteLine("       exception handling goes first (it must wrap everything) while");
    Console.WriteLine("       authorisation goes after routing (it needs to know the endpoint).");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void AfterBuildIsFrozen(WebApplicationBuilder builder)
{
    Console.WriteLine("2. Build() is a one-way door");
    Console.WriteLine();

    string result;
    try
    {
        builder.Services.AddSingleton<IClock, SystemClock>();
        result = "it worked - registration after Build() succeeded";
    }
    catch (InvalidOperationException ex)
    {
        result = $"{ex.GetType().Name}: {ex.Message}";
    }

    Console.WriteLine("   adding a service after Build():");
    Console.WriteLine($"     {result}");
    Console.WriteLine();
    Console.WriteLine("   The service COLLECTION is a mutable list. The service PROVIDER built");
    Console.WriteLine("   from it is not, and cannot be: it caches singletons, precompiles");
    Console.WriteLine("   constructor calls, and validates the graph. Allowing a late");
    Console.WriteLine("   registration would mean some code had already resolved the old");
    Console.WriteLine("   answer.");
    Console.WriteLine();
    Console.WriteLine("   In practice this is the error you hit when you try to register");
    Console.WriteLine("   something from inside a middleware, from an extension method that");
    Console.WriteLine("   took 'app' instead of 'builder', or from a test that customises the");
    Console.WriteLine("   container too late.");
    Console.WriteLine();
    Console.WriteLine("   The two halves of a startup file are not decoration:");
    Console.WriteLine();
    Console.WriteLine("     before Build()   WHAT EXISTS   - builder.Services, builder.Configuration");
    Console.WriteLine("     after Build()    WHAT HAPPENS  - app.Use, app.Map, app.Run");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ScopePerRequest(WebApplication app)
{
    Console.WriteLine("3. One scope per request");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    string a = await http.GetStringAsync("/");
    string b = await http.GetStringAsync("/");

    Console.WriteLine($"   request 1: {a}");
    Console.WriteLine($"   request 2: {b}");
    Console.WriteLine();

    using (IServiceScope scope = app.Services.CreateScope())
    {
        var first = scope.ServiceProvider.GetRequiredService<RequestContext>();
        var second = scope.ServiceProvider.GetRequiredService<RequestContext>();
        Console.WriteLine($"   two resolutions inside one scope : {first.Id} and {second.Id}");
    }

    using (IServiceScope scope = app.Services.CreateScope())
    {
        var third = scope.ServiceProvider.GetRequiredService<RequestContext>();
        Console.WriteLine($"   a resolution in a second scope   : {third.Id}");
    }

    var singletonA = app.Services.GetRequiredService<GatewayConnection>();
    var singletonB = app.Services.GetRequiredService<GatewayConnection>();

    Console.WriteLine($"   the singleton, resolved twice    : {singletonA.Id} and {singletonB.Id}");
    Console.WriteLine();
    Console.WriteLine("   Different ids per request, the same id twice within one scope, one id");
    Console.WriteLine("   forever for the singleton.");
    Console.WriteLine();
    Console.WriteLine("   SCOPED means one instance per scope, and ASP.NET Core creates exactly");
    Console.WriteLine("   one scope per request. That is where 'per request' comes from - it is");
    Console.WriteLine("   not a lifetime the container itself knows about.");
    Console.WriteLine();
    Console.WriteLine("   The distinction matters the moment you resolve something outside a");
    Console.WriteLine("   request: a background service, a startup task, a console command.");
    Console.WriteLine("   There is no ambient scope there, and asking the root provider for a");
    Console.WriteLine("   scoped service fails - which is 02-services-and-scopes.cs.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task AcceptingTraffic(TaskCompletionSource<long> firstAccepted, Stopwatch clock)
{
    Console.WriteLine("4. When does the server actually start accepting traffic?");
    Console.WriteLine();

    long accepted = await firstAccepted.Task;

    // The background service is still running at this point. Wait for it, so
    // the last row of the table is a real measurement rather than a zero.
    while (SlowBackgroundService.EndedAt == 0)
    {
        await Task.Delay(20);
    }

    Console.WriteLine("   event                                              at");
    Console.WriteLine("   -----                                              --");
    Console.WriteLine($"   FirstHostedService.StartAsync began       {FirstHostedService.StartedAt,8} ms");
    Console.WriteLine($"   FirstHostedService.StartAsync returned    {FirstHostedService.EndedAt,8} ms   (it slept 400 ms)");
    Console.WriteLine($"   SlowBackgroundService.ExecuteAsync began  {SlowBackgroundService.StartedAt,8} ms");
    Console.WriteLine($"   the port first accepted a connection     {accepted,8} ms");
    Console.WriteLine($"   SlowBackgroundService.ExecuteAsync ended  {SlowBackgroundService.EndedAt,8} ms   (it also slept 400 ms)");
    Console.WriteLine();
    Console.WriteLine("   THE SERVER DID NOT LISTEN UNTIL THE HOSTED SERVICE HAD FINISHED");
    Console.WriteLine("   STARTING. The port opened after StartAsync returned, not before.");
    Console.WriteLine();
    Console.WriteLine("   This is worth stating plainly because the opposite is widely");
    Console.WriteLine("   repeated. The reason is registration order: WebApplicationBuilder");
    Console.WriteLine("   adds the web host service that owns Kestrel while Build() runs,");
    Console.WriteLine("   which puts it AFTER everything you registered. Hosted services");
    Console.WriteLine("   start in registration order, so yours go first.");
    Console.WriteLine();
    Console.WriteLine("   Two consequences, and they point in opposite directions.");
    Console.WriteLine();
    Console.WriteLine("   THE GOOD ONE: warm-up in IHostedService.StartAsync is safe from");
    Console.WriteLine("   early traffic. Nothing can arrive, because there is no open socket");
    Console.WriteLine("   to arrive on. A cache load or a migration there completes before the");
    Console.WriteLine("   first request exists.");
    Console.WriteLine();
    Console.WriteLine("   THE BAD ONE: a slow StartAsync delays the port opening, and a");
    Console.WriteLine("   StartAsync that never returns means the port NEVER opens. The");
    Console.WriteLine("   process is alive, healthy by any process-level check, and refusing");
    Console.WriteLine("   connections. A TCP readiness probe reports the port closed and the");
    Console.WriteLine("   orchestrator restarts the pod, forever, with nothing in the logs.");
    Console.WriteLine();
    Console.WriteLine("   BackgroundService is the important exception. Look at the table");
    Console.WriteLine("   again: ExecuteAsync began BEFORE the port opened and finished AFTER");
    Console.WriteLine("   it. It did not hold anything up.");
    Console.WriteLine();
    Console.WriteLine("   That is because BackgroundService.StartAsync calls ExecuteAsync and");
    Console.WriteLine("   returns at its first incomplete await, without waiting for it. So:");
    Console.WriteLine();
    Console.WriteLine("     IHostedService.StartAsync      startup WAITS for it to return");
    Console.WriteLine("     BackgroundService.ExecuteAsync startup does NOT wait");
    Console.WriteLine();
    Console.WriteLine("   Pick by whether the work must finish before the first request:");
    Console.WriteLine();
    Console.WriteLine("     must finish first    IHostedService.StartAsync, or code before");
    Console.WriteLine("                          app.Run(). Migrations, required caches.");
    Console.WriteLine("     runs alongside       BackgroundService. Queue consumers, timers,");
    Console.WriteLine("                          anything that should not delay serving.");
    Console.WriteLine();
    Console.WriteLine("   And a caveat on the good news above: it holds for THIS host layout.");
    Console.WriteLine("   Anything that registers a hosted service after Build() - or a host");
    Console.WriteLine("   builder that adds the server earlier - reverses it. If your warm-up");
    Console.WriteLine("   genuinely must not be raced, a health check that reports unhealthy");
    Console.WriteLine("   until it is done does not depend on ordering at all.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ShutdownOrder(WebApplication app, List<string> log)
{
    Console.WriteLine("5. Shutdown order");
    Console.WriteLine();

    await app.StopAsync();

    Console.WriteLine("   The full sequence, start to finish:");
    Console.WriteLine();

    foreach (string line in log)
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   Two orderings are worth committing to memory.");
    Console.WriteLine();
    Console.WriteLine("   HOSTED SERVICES START IN REGISTRATION ORDER AND STOP IN REVERSE.");
    Console.WriteLine("   First started before Second and stopped after it. That is the same");
    Console.WriteLine("   rule as nested using blocks, and for the same reason: whatever");
    Console.WriteLine("   started last may depend on what started first, so it must go first.");
    Console.WriteLine();
    Console.WriteLine("   APPLICATIONSTOPPING FIRES BEFORE ANYTHING STOPS, not after. It is");
    Console.WriteLine("   the signal 'we are going down, begin winding up', and it is what a");
    Console.WriteLine("   readiness probe should watch so the load balancer stops sending new");
    Console.WriteLine("   work while in-flight work finishes. ApplicationStopped fires when it");
    Console.WriteLine("   is all over and is too late to be useful for anything but logging.");
}

// ---------------------------------------------------------------------------
static class Unwind
{
    public static string? Order;
}

interface IClock
{
    string Name { get; }
}

sealed class SystemClock : IClock
{
    public string Name => "SystemClock";
}

sealed class GatewayConnection
{
    private static int _created;

    public GatewayConnection(List<string> log)
    {
        Id = Interlocked.Increment(ref _created);
        log.Add($"   (GatewayConnection #{Id} constructed - on first resolution, not at registration)");
    }

    public int Id { get; }
}

sealed class RequestContext
{
    private static int _created;

    public RequestContext() => Id = Interlocked.Increment(ref _created);

    public int Id { get; }
}

sealed class FirstHostedService : IHostedService
{
    private readonly List<string> _log;
    private readonly Stopwatch _clock;

    public static long StartedAt { get; private set; }

    public static long EndedAt { get; private set; }

    public FirstHostedService(List<string> log, Stopwatch clock)
    {
        _log = log;
        _clock = clock;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        StartedAt = _clock.ElapsedMilliseconds;
        _log.Add("   (FirstHostedService.StartAsync began - sleeping 400 ms)");

        // Stands in for a cache warm-up, a migration, or a connection pool.
        await Task.Delay(400, cancellationToken);

        EndedAt = _clock.ElapsedMilliseconds;
        _log.Add("6. FirstHostedService.StartAsync finished");
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _log.Add("10. FirstHostedService.StopAsync ran (second to stop)");
        return Task.CompletedTask;
    }
}

sealed class SlowBackgroundService : BackgroundService
{
    private readonly Stopwatch _clock;

    public static long StartedAt { get; private set; }

    public static long EndedAt { get; private set; }

    public SlowBackgroundService(Stopwatch clock) => _clock = clock;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        StartedAt = _clock.ElapsedMilliseconds;

        // BackgroundService.StartAsync returns at this await rather than
        // waiting for the method to finish, so startup is not held up.
        await Task.Delay(400, stoppingToken);

        EndedAt = _clock.ElapsedMilliseconds;
    }
}

sealed class SecondHostedService : IHostedService
{
    private readonly List<string> _log;

    public SecondHostedService(List<string> log) => _log = log;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _log.Add("   (SecondHostedService.StartAsync ran - after First finished)");
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _log.Add("   (SecondHostedService.StopAsync ran - FIRST to stop)");
        return Task.CompletedTask;
    }
}
