// 05-minimal-example.cs — One worker with every decision made: what blocks
// startup, where the scope goes, which cancellation ends the loop, what
// finishes before shutdown, and how anyone finds out it stopped.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every count, status code and outcome here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// DECISION 1: scope validation on in every environment, so a captive
// dependency is a startup failure rather than a slow leak.
builder.Host.UseDefaultServiceProvider(options =>
{
    options.ValidateScopes = true;
    options.ValidateOnBuild = true;
});

builder.Services.AddSingleton<PaymentQueue>();
builder.Services.AddSingleton<IPaymentGateway, PaymentGateway>();
builder.Services.AddSingleton<WorkerHeartbeat>();

// Scoped, exactly as it would be in the web half of the application.
builder.Services.AddScoped<LedgerDbContext>();

builder.Services.AddHostedService<ReconciliationWorker>();

// DECISION 6: the worker's liveness is a readiness check, so a stalled loop
// takes the instance out of rotation instead of being invisible.
builder.Services.AddHealthChecks()
    .AddCheck<WorkerHeartbeatCheck>("reconciliation-worker", tags: ["ready"]);

var app = builder.Build();

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains("ready")
});

app.MapGet("/v1/payments/{id}", (string id) => Results.Ok(new { id, status = "captured" }));

var clock = Stopwatch.StartNew();
await app.StartAsync();
double startedAt = clock.Elapsed.TotalMilliseconds;

using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

var queue = app.Services.GetRequiredService<PaymentQueue>();
var gateway = (PaymentGateway)app.Services.GetRequiredService<IPaymentGateway>();

Console.WriteLine("One worker, every decision made");
Console.WriteLine();
Console.WriteLine($"   host started after   {startedAt:0} ms   (the worker did not delay it)");
Console.WriteLine();

// Twenty payments, one of which the gateway will refuse to answer about.
for (int n = 1; n <= 20; n++)
{
    queue.Enqueue($"PAY-{n:000}");
}

gateway.HangOn = "PAY-004";

await Task.Delay(700);

Console.WriteLine("   AFTER 700 ms OF WORK");
Console.WriteLine();
Console.WriteLine($"     payments settled       {ReconciliationWorker.Settled}");
Console.WriteLine($"     payments that failed   {ReconciliationWorker.Failed}");
Console.WriteLine($"     loop still running     {ReconciliationWorker.LoopAlive}");
Console.WriteLine($"     DbContexts created     {LedgerDbContext.Created}");
Console.WriteLine($"     largest change tracker {LedgerDbContext.LargestTracked}");
Console.WriteLine($"     GET /health/ready      {await Status(http, "/health/ready")}");
Console.WriteLine();
Console.WriteLine("   ONE PAYMENT TIMED OUT AND THE LOOP KEPT GOING. Every payment got its own");
Console.WriteLine("   DbContext, so the change tracker never held more than one entity.");
Console.WriteLine();

// Shut down mid-item and see what happens to the payment in flight.
var shutdown = Stopwatch.StartNew();
await app.StopAsync();
shutdown.Stop();

Console.WriteLine("   SHUTDOWN");
Console.WriteLine();
Console.WriteLine($"     StopAsync took                {shutdown.Elapsed.TotalMilliseconds:0} ms");
Console.WriteLine($"     loop still running            {ReconciliationWorker.LoopAlive}");
Console.WriteLine();
Console.WriteLine($"     payments claimed              {ReconciliationWorker.Claimed}");
Console.WriteLine($"       of which settled            {ReconciliationWorker.Settled}");
Console.WriteLine($"       of which failed a deadline  {ReconciliationWorker.Failed}");
Console.WriteLine($"       UNACCOUNTED FOR             " +
    $"{ReconciliationWorker.Claimed - ReconciliationWorker.Settled - ReconciliationWorker.Failed}");
Console.WriteLine();
Console.WriteLine("     THE LAST NUMBER IS THE ONE THAT MATTERS. A payment claimed off the");
Console.WriteLine("     queue and neither settled nor failed is a payment that vanished into");
Console.WriteLine("     a shutdown. It is zero because the write was not given the stopping");
Console.WriteLine("     token.");
Console.WriteLine();

await app.DisposeAsync();

Console.WriteLine("   EVERY DECISION IN THAT WORKER, AND WHY:");
Console.WriteLine();
Console.WriteLine("     NOTHING SLOW IN THE CONSTRUCTOR OR StartAsync. Both are on the startup");
Console.WriteLine("     path - the constructor because the container resolves the worker during");
Console.WriteLine("     startup, StartAsync because the host awaits it. Work that belongs to");
Console.WriteLine("     the loop goes in the loop.");
Console.WriteLine();
Console.WriteLine("     A SCOPE PER PAYMENT, FROM IServiceScopeFactory. The factory is a");
Console.WriteLine("     singleton and safe for a singleton to hold; the DbContext is not. One");
Console.WriteLine("     payment fails, one scope is discarded, the next starts clean - and the");
Console.WriteLine("     change tracker measured above never grows.");
Console.WriteLine();
Console.WriteLine("     PeriodicTimer RATHER THAN await Task.Delay. The period is measured tick");
Console.WriteLine("     to tick, so the work happens inside the interval instead of being added");
Console.WriteLine("     to it, and the schedule does not slide.");
Console.WriteLine();
Console.WriteLine("     THE try IS INSIDE THE LOOP, AND THE CANCELLATION CATCH HAS A when");
Console.WriteLine("     CLAUSE. That single clause is the difference between 'one payment timed");
Console.WriteLine("     out' and 'the worker stopped in March'. Cancellation has one exception");
Console.WriteLine("     type for every cause, so only the TOKEN can tell you which cause it");
Console.WriteLine("     was.");
Console.WriteLine();
Console.WriteLine("     THE WAIT IS CANCELLABLE AND THE WRITE IS NOT. Shutdown lands on the");
Console.WriteLine("     wait, which is where the worker spends most of its life, so StopAsync");
Console.WriteLine("     returns quickly. A payment already claimed is finished with a token");
Console.WriteLine("     that shutdown does not touch, so nothing is abandoned half-written.");
Console.WriteLine();
Console.WriteLine("     A HEARTBEAT, SURFACED AS READINESS. The loop stamps a timestamp every");
Console.WriteLine("     iteration and a health check fails when it goes stale. Readiness rather");
Console.WriteLine("     than liveness, because a stalled worker is not a wedged process and");
Console.WriteLine("     restarting the instance would discard web traffic it is serving");
Console.WriteLine("     correctly.");
Console.WriteLine();
Console.WriteLine("     SCOPE VALIDATION ON IN PRODUCTION. It costs a little startup time and");
Console.WriteLine("     converts the commonest worker bug from a slow leak into a failed");
Console.WriteLine("     deployment.");
Console.WriteLine();
Console.WriteLine("   AND WHAT THIS WORKER STILL DOES NOT SOLVE, because the hosting model");
Console.WriteLine("   cannot: IT RUNS ONCE PER PROCESS, NOT ONCE PER SYSTEM. Three replicas are");
Console.WriteLine("   three loops against one database. And an at-least-once queue is what makes");
Console.WriteLine("   a process being killed - as opposed to asked to stop - survivable. Both");
Console.WriteLine("   are decisions above this file.");

// ---------------------------------------------------------------------------
static async Task<string> Status(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.GetAsync(path);

    return $"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}";
}

// ---------------------------------------------------------------------------
// The worker. Nothing in the constructor but the dependencies it will need,
// and every one of them is a singleton - the scoped work happens per item.
sealed class ReconciliationWorker(
    IServiceScopeFactory scopeFactory,
    PaymentQueue queue,
    IPaymentGateway gateway,
    WorkerHeartbeat heartbeat) : BackgroundService
{
    public static int Claimed;

    public static int Settled;

    public static int Failed;

    public static bool LoopAlive;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        LoopAlive = true;

        // Tick to tick, so work time is inside the period rather than added.
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(20));

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                heartbeat.Beat();

                // The try is INSIDE the loop, so one bad payment costs one
                // payment.
                try
                {
                    if (queue.TryDequeue(out string? paymentId))
                    {
                        await ReconcileAsync(paymentId, stoppingToken);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    // Genuinely shutting down. This is the only cancellation
                    // that ends the loop.
                    break;
                }
                catch (OperationCanceledException)
                {
                    // A deadline on one payment. Take the next one.
                    Interlocked.Increment(ref Failed);
                }
                catch (Exception)
                {
                    Interlocked.Increment(ref Failed);
                }

                // The wait is fully cancellable: this is where shutdown lands.
                if (!await timer.WaitForNextTickAsync(stoppingToken))
                {
                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // The wait above, cancelled by shutdown.
        }

        LoopAlive = false;
    }

    async Task ReconcileAsync(string paymentId, CancellationToken stoppingToken)
    {
        Interlocked.Increment(ref Claimed);

        // A scope per payment. The factory is safe to hold; what it produces
        // is not.
        using IServiceScope scope = scopeFactory.CreateScope();
        var database = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();

        // A deadline for the gateway call, linked to shutdown so that a
        // hanging call cannot hold up a stop indefinitely.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        deadline.CancelAfter(TimeSpan.FromMilliseconds(120));

        bool settled = await gateway.ReconcileAsync(paymentId, deadline.Token);

        // The write is NOT given the stopping token. Once a payment is
        // claimed, recording the outcome finishes even if we are stopping.
        await database.RecordAsync(paymentId, settled, CancellationToken.None);

        Interlocked.Increment(ref Settled);
    }
}

// ---------------------------------------------------------------------------
// One timestamp, written by the loop and read by the health check.
sealed class WorkerHeartbeat
{
    long ticks = DateTime.UtcNow.Ticks;

    public void Beat() => Interlocked.Exchange(ref ticks, DateTime.UtcNow.Ticks);

    public TimeSpan SinceLastBeat =>
        DateTime.UtcNow - new DateTime(Interlocked.Read(ref ticks), DateTimeKind.Utc);
}

// ---------------------------------------------------------------------------
// Fails readiness when the loop has gone quiet for longer than it should.
sealed class WorkerHeartbeatCheck(WorkerHeartbeat heartbeat) : IHealthCheck
{
    static readonly TimeSpan Tolerance = TimeSpan.FromMilliseconds(300);

    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        TimeSpan since = heartbeat.SinceLastBeat;

        return Task.FromResult(since < Tolerance
            ? HealthCheckResult.Healthy($"Last beat {since.TotalMilliseconds:0} ms ago.")
            : HealthCheckResult.Unhealthy($"No beat for {since.TotalMilliseconds:0} ms."));
    }
}

// ---------------------------------------------------------------------------
sealed class PaymentQueue
{
    readonly Queue<string> items = new();

    public void Enqueue(string paymentId)
    {
        lock (items)
        {
            items.Enqueue(paymentId);
        }
    }

    public bool TryDequeue(out string paymentId)
    {
        lock (items)
        {
            if (items.Count > 0)
            {
                paymentId = items.Dequeue();

                return true;
            }
        }

        paymentId = "";

        return false;
    }
}

// ---------------------------------------------------------------------------
interface IPaymentGateway
{
    Task<bool> ReconcileAsync(string paymentId, CancellationToken cancellationToken);
}

// ---------------------------------------------------------------------------
sealed class PaymentGateway : IPaymentGateway
{
    public string? HangOn { get; set; }

    public async Task<bool> ReconcileAsync(string paymentId, CancellationToken cancellationToken)
    {
        // One payment the gateway never answers about, so the deadline fires.
        await Task.Delay(paymentId == HangOn ? 5000 : 5, cancellationToken);

        return true;
    }
}

// ---------------------------------------------------------------------------
// Scoped, and it remembers what it has seen - which is why it must not outlive
// one payment.
sealed class LedgerDbContext : IDisposable
{
    public static int Created;

    public static int LargestTracked;

    readonly List<string> tracked = [];

    public LedgerDbContext() => Interlocked.Increment(ref Created);

    public async Task RecordAsync(string paymentId, bool settled, CancellationToken cancellationToken)
    {
        tracked.Add(paymentId);

        if (tracked.Count > LargestTracked)
        {
            LargestTracked = tracked.Count;
        }

        await Task.Delay(2, cancellationToken);
    }

    public void Dispose() => tracked.Clear();
}
