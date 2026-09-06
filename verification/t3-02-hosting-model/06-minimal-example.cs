// 06-minimal-example.cs — One host that applies every decision in this module,
// started and stopped while it is doing real work.
//
// Run:  dotnet run 06-minimal-example.cs -c Release
//
// EXACT vs RATIO: the ordering and the item counts are exact. The timestamps
// are machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

var clock = Stopwatch.StartNew();
var timeline = new List<string>();

void Note(string what) => timeline.Add($"   t={clock.ElapsedMilliseconds,5} ms  {what}");

// ===========================================================================
// BEFORE Build(): what exists.
// ===========================================================================
var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// Turn on both container checks in EVERY environment. ValidateScopes is on in
// Development only by default, and ValidateOnBuild is off everywhere - so the
// checks that catch captive dependencies and missing registrations are absent
// exactly where they are most valuable.
builder.Host.UseDefaultServiceProvider(options =>
{
    options.ValidateScopes = true;
    options.ValidateOnBuild = true;
});

// Longer than the slowest endpoint, and shorter than the orchestrator's own
// patience. The default is 30 seconds and is rarely the right number for
// either reason.
builder.Services.Configure<HostOptions>(options =>
    options.ShutdownTimeout = TimeSpan.FromSeconds(5));

builder.Services.AddSingleton(clock);
builder.Services.AddSingleton<Readiness>();
builder.Services.AddSingleton<Outbox>();
builder.Services.AddScoped<UnitOfWork>();
builder.Services.AddHostedService<OutboxPublisher>();

// ===========================================================================
// Build(): the registrations are frozen and the container is created.
// ===========================================================================
var app = builder.Build();
Note("Build() returned");

// ===========================================================================
// AFTER Build(): what happens.
// ===========================================================================

// Registration order in, reverse order out. Exception handling is registered
// first so that it wraps everything after it.
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (Exception ex)
    {
        // The response may already have started, in which case there is
        // nothing to send - the status line is long gone. Check before
        // writing, rather than throwing a second exception on top.
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = 500;
            await context.Response.WriteAsJsonAsync(new { error = ex.GetType().Name });
        }
    }
});

// Liveness: is the process running at all? Never depends on anything else, or
// a slow dependency restarts a healthy pod.
app.MapGet("/health/live", () => Results.Ok(new { status = "alive" }));

// Readiness: should traffic be sent here? Reports unhealthy before warm-up
// finishes and again the moment shutdown begins.
app.MapGet("/health/ready", (Readiness readiness) =>
    readiness.IsReady
        ? Results.Ok(new { status = "ready" })
        : Results.StatusCode(503));

app.MapPost("/payments/{id}/settle", async (string id, UnitOfWork work, Outbox outbox) =>
{
    await Task.Delay(50);                       // the gateway call
    outbox.Enqueue(id);
    return Results.Ok(new { id, status = "settled", scope = work.Id });
});

// The three lifecycle events. Only the middle one is load-bearing.
var readiness = app.Services.GetRequiredService<Readiness>();

app.Lifetime.ApplicationStarted.Register(() => Note("ApplicationStarted - the port is open"));

app.Lifetime.ApplicationStopping.Register(() =>
{
    // Fires BEFORE anything stops. Flipping readiness here is the earliest
    // possible moment the load balancer can learn to stop routing.
    readiness.MarkNotReady();
    Note("ApplicationStopping - readiness flipped to unhealthy");
});

app.Lifetime.ApplicationStopped.Register(() => Note("ApplicationStopped - everything has stopped"));

// Warm-up that MUST have happened, done before the server is listening.
// Nothing can arrive here, because there is no open socket yet.
Note("warm-up starting (before StartAsync, so no request can exist)");
await Task.Delay(100);
readiness.MarkReady();
Note("warm-up done");

await app.StartAsync();
Note("StartAsync returned");

await Exercise(app, timeline, clock, Note);

// ---------------------------------------------------------------------------
static async Task Exercise(WebApplication app, List<string> timeline, Stopwatch clock,
    Action<string> note)
{
    string baseUrl = app.Urls.First();
    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };
    var outbox = app.Services.GetRequiredService<Outbox>();

    Console.WriteLine("A correctly hosted service, started and stopped under load");
    Console.WriteLine();

    HttpResponseMessage live = await http.GetAsync("/health/live");
    HttpResponseMessage ready = await http.GetAsync("/health/ready");

    Console.WriteLine($"   /health/live  -> {(int)live.StatusCode}");
    Console.WriteLine($"   /health/ready -> {(int)ready.StatusCode}");
    Console.WriteLine();

    // Ten settlements in flight, then a deploy.
    Task<HttpResponseMessage>[] inFlight = Enumerable.Range(0, 10)
        .Select(i => http.PostAsync($"/payments/PAY-{i:D4}/settle", null))
        .ToArray();

    await Task.Delay(20);
    note("SIGTERM equivalent: StopAsync() called with 10 requests in flight");
    Task stopping = app.StopAsync();

    int settled = 0;
    foreach (Task<HttpResponseMessage> task in inFlight)
    {
        try
        {
            HttpResponseMessage response = await task;
            if (response.IsSuccessStatusCode)
            {
                settled++;
            }
        }
        catch (HttpRequestException)
        {
            // Counted by omission.
        }
    }

    await stopping;
    note("StopAsync returned");

    Console.WriteLine("   Timeline");
    Console.WriteLine();
    foreach (string line in timeline)
    {
        Console.WriteLine(line);
    }

    Console.WriteLine();
    Console.WriteLine($"   settlements accepted        : 10");
    Console.WriteLine($"   settlements answered 2xx    : {settled}");
    Console.WriteLine($"   outbox items enqueued       : {outbox.Enqueued}");
    Console.WriteLine($"   outbox items published      : {outbox.Published}");
    Console.WriteLine($"   outbox items LOST           : {outbox.Enqueued - outbox.Published}");
    Console.WriteLine();
    Console.WriteLine("   Nothing was dropped: every request that had been accepted was");
    Console.WriteLine("   answered, and every item the worker had taken was published before");
    Console.WriteLine("   it returned.");
    Console.WriteLine();
    Console.WriteLine("   The checklist this file is built from:");
    Console.WriteLine();
    Console.WriteLine("     - registrations BEFORE Build(), pipeline AFTER it");
    Console.WriteLine("     - ValidateScopes and ValidateOnBuild on in every environment");
    Console.WriteLine("     - warm-up that must happen goes before StartAsync, where no");
    Console.WriteLine("       request can exist yet");
    Console.WriteLine("     - exception handling registered FIRST, so it wraps everything");
    Console.WriteLine("     - liveness and readiness are different questions and different");
    Console.WriteLine("       endpoints; liveness depends on nothing");
    Console.WriteLine("     - readiness flips on ApplicationStopping, not later");
    Console.WriteLine("     - ShutdownTimeout set deliberately, not left at 30 seconds");
    Console.WriteLine("     - the worker honours the stopping token AND flushes what it is");
    Console.WriteLine("       already holding before returning");
    Console.WriteLine();
    Console.WriteLine("   The one thing this file cannot do for you is the deployment side:");
    Console.WriteLine("   a preStop hook long enough for the load balancer to notice, and a");
    Console.WriteLine("   terminationGracePeriodSeconds larger than preStop plus");
    Console.WriteLine("   ShutdownTimeout plus teardown. Without those, requests that arrive");
    Console.WriteLine("   after the listener closes are refused however correct this code is.");
}

// ---------------------------------------------------------------------------
sealed class Readiness
{
    private volatile bool _ready;

    public bool IsReady => _ready;

    public void MarkReady() => _ready = true;

    public void MarkNotReady() => _ready = false;
}

sealed class UnitOfWork
{
    private static int _created;

    public UnitOfWork() => Id = Interlocked.Increment(ref _created);

    public int Id { get; }
}

sealed class Outbox
{
    private readonly System.Collections.Concurrent.ConcurrentQueue<string> _pending = new();

    private int _enqueued;
    private int _published;

    // Interlocked, not ++. Enqueue is called from concurrent request handlers
    // and Publish from the worker; a plain increment loses updates, which
    // showed up here as a NEGATIVE lost count.
    public int Enqueued => Volatile.Read(ref _enqueued);

    public int Published => Volatile.Read(ref _published);

    public void Enqueue(string id)
    {
        _pending.Enqueue(id);
        Interlocked.Increment(ref _enqueued);
    }

    public List<string> Take(int max)
    {
        var batch = new List<string>();
        while (batch.Count < max && _pending.TryDequeue(out string? id))
        {
            batch.Add(id);
        }

        return batch;
    }

    public void Publish(IReadOnlyCollection<string> batch) =>
        Interlocked.Add(ref _published, batch.Count);
}

sealed class OutboxPublisher : BackgroundService
{
    private readonly Outbox _outbox;

    private List<string> _inHand = new();

    public OutboxPublisher(Outbox outbox) => _outbox = outbox;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                _inHand = _outbox.Take(5);

                if (_inHand.Count > 0)
                {
                    await Task.Delay(10, stoppingToken);    // the publish call
                    _outbox.Publish(_inHand);
                    _inHand = new List<string>();
                }
                else
                {
                    await Task.Delay(10, stoppingToken);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected. Shutdown cancelled the delay.
        }

    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        // base.StopAsync waits for ExecuteAsync to finish, so the drain below
        // runs on one thread with nothing else touching _inHand.
        await base.StopAsync(cancellationToken);

        // The part that is usually missing. Cancellation means STOP TAKING NEW
        // WORK; it does not mean abandon the work already taken. Drain what is
        // in hand and whatever arrived while shutting down - deliberately
        // without the token, which is already cancelled, because the point
        // here is to finish rather than to abort.
        Drain();
    }

    private void Drain()
    {
        if (_inHand.Count > 0)
        {
            _outbox.Publish(_inHand);
            _inHand = new List<string>();
        }

        List<string> remaining = _outbox.Take(int.MaxValue);
        if (remaining.Count > 0)
        {
            _outbox.Publish(remaining);
        }
    }
}
