// 03-production.cs — The worker that stopped three weeks ago.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every count, state and status code here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

Console.WriteLine("An incident: 'the queue has been growing since the 3rd'");
Console.WriteLine();

TheIncident();
await WhatKilledTheLoop();
await WhyNothingNoticed();
await TheFix();
WhatToWatch();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. What was seen");
    Console.WriteLine();
    Console.WriteLine("   Ledger reconciles payments against the gateway's settlement feed. A");
    Console.WriteLine("   BackgroundService takes items off a queue, calls the gateway, and");
    Console.WriteLine("   writes the result. It had run for a year.");
    Console.WriteLine();
    Console.WriteLine("     Mon 09:40   Finance reports that reconciliation figures have not");
    Console.WriteLine("                 moved since the 3rd. That was nineteen days ago.");
    Console.WriteLine();
    Console.WriteLine("     Mon 09:55   The queue has 412,000 items on it. It normally has");
    Console.WriteLine("                 fewer than fifty.");
    Console.WriteLine();
    Console.WriteLine("     Mon 10:10   The service is healthy. Uptime nineteen days. Every HTTP");
    Console.WriteLine("                 endpoint responds. /health/live and /health/ready are");
    Console.WriteLine("                 both 200. CPU and memory are flat and low.");
    Console.WriteLine();
    Console.WriteLine("     Mon 10:20   No exceptions in the logs. No restarts. No deployment on");
    Console.WriteLine("                 the 3rd. Nothing in any dashboard changed that day.");
    Console.WriteLine();
    Console.WriteLine("     Mon 11:05   Somebody adds a log line to the loop, deploys, and");
    Console.WriteLine("                 watches. It never prints.");
    Console.WriteLine();
    Console.WriteLine("   THE PROCESS WAS ALIVE AND THE LOOP INSIDE IT WAS NOT. Nineteen days of");
    Console.WriteLine("   a service reporting perfect health while doing none of the work it");
    Console.WriteLine("   exists to do. THE FLAT CPU GRAPH WAS THE EVIDENCE and it reads as good");
    Console.WriteLine("   news.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatKilledTheLoop()
{
    Console.WriteLine("2. The eleven lines that stopped it");
    Console.WriteLine();
    Console.WriteLine("   The worker, as written. Nothing about it is unusual and it passed");
    Console.WriteLine("   review a year ago.");
    Console.WriteLine();
    Console.WriteLine("     protected override async Task ExecuteAsync(CancellationToken stoppingToken)");
    Console.WriteLine("     {");
    Console.WriteLine("         try");
    Console.WriteLine("         {");
    Console.WriteLine("             while (!stoppingToken.IsCancellationRequested)");
    Console.WriteLine("             {");
    Console.WriteLine("                 Payment payment = await queue.TakeAsync(stoppingToken);");
    Console.WriteLine("                 await ReconcileAsync(payment, stoppingToken);");
    Console.WriteLine("             }");
    Console.WriteLine("         }");
    Console.WriteLine("         catch (OperationCanceledException)");
    Console.WriteLine("         {");
    Console.WriteLine("             // shutting down");
    Console.WriteLine("         }");
    Console.WriteLine("     }");
    Console.WriteLine();

    (bool GatewayTimesOutOnce, string Label)[] runs =
    [
        (false, "gateway healthy"),
        (true, "one gateway call times out")
    ];

    Console.WriteLine("   scenario                      items processed   loop still running   host alive");
    Console.WriteLine("   --------                      ---------------   ------------------   ----------");

    foreach ((bool timeout, string label) in runs)
    {
        // A fresh queue and gateway per run, so the second run is not
        // affected by the first one having already used up the timeout.
        var queue = new Queue(items: 12);
        var gateway = new Gateway { TimeOutOnce = timeout };

        FragileWorker.Processed = 0;
        FragileWorker.LoopAlive = false;

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddSingleton(queue);
        builder.Services.AddSingleton(gateway);
        builder.Services.AddHostedService<FragileWorker>();

        var app = builder.Build();
        app.MapGet("/", () => "alive");

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        await Task.Delay(600);

        string alive;

        try
        {
            alive = await http.GetStringAsync("/");
        }
        catch (Exception exception)
        {
            alive = exception.GetType().Name;
        }

        Console.WriteLine($"   {label,-29} {FragileWorker.Processed,15}   {FragileWorker.LoopAlive,-18}   {alive}");

        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   ONE TIMED-OUT GATEWAY CALL ENDED THE LOOP PERMANENTLY, and the host");
    Console.WriteLine("   carried on serving as though nothing had happened.");
    Console.WriteLine();
    Console.WriteLine("   THE MECHANISM IS THE catch. ReconcileAsync gives its HTTP call a");
    Console.WriteLine("   deadline by linking a timeout to the stopping token - which is correct,");
    Console.WriteLine("   and is what every module on cancellation tells you to do. When that");
    Console.WriteLine("   deadline fires, the call throws OperationCanceledException.");
    Console.WriteLine();
    Console.WriteLine("   AND THAT EXCEPTION IS INDISTINGUISHABLE, BY TYPE, FROM SHUTDOWN. The");
    Console.WriteLine("   catch was written to swallow the one the stopping token raises. It");
    Console.WriteLine("   swallows every other one too, including the per-item timeout, and");
    Console.WriteLine("   returning from ExecuteAsync is how a BackgroundService says 'I am");
    Console.WriteLine("   finished'.");
    Console.WriteLine();
    Console.WriteLine("   THE FRAMEWORK THEN DID EXACTLY WHAT IT SHOULD: a worker that completes");
    Console.WriteLine("   without faulting has finished its job, so there is nothing to report.");
    Console.WriteLine("   BackgroundServiceExceptionBehavior never came into it - StopHost and");
    Console.WriteLine("   Ignore both concern a worker that THREW, and this one returned.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS WHY THE LOGS WERE CLEAN. There was no error. The worker was");
    Console.WriteLine("   asked to do something, decided it was being shut down, and stopped");
    Console.WriteLine("   politely.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhyNothingNoticed()
{
    Console.WriteLine("3. Why nineteen days of monitoring saw nothing");
    Console.WriteLine();

    var queue = new Queue(items: 12);
    var gateway = new Gateway { TimeOutOnce = true };

    FragileWorker.Processed = 0;
    FragileWorker.LoopAlive = false;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton(queue);
    builder.Services.AddSingleton(gateway);
    builder.Services.AddHostedService<FragileWorker>();

    // The health checks Ledger had, which are the ones most services have.
    builder.Services.AddHealthChecks()
        .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
        .AddCheck("database", () => HealthCheckResult.Healthy(), tags: ["ready"]);

    var app = builder.Build();

    app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = r => r.Tags.Contains("live") });
    app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = r => r.Tags.Contains("ready") });
    app.MapGet("/v1/payments/{id}", (string id) => Results.Ok(new { id }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    await Task.Delay(600);

    Console.WriteLine("   what was checked           result");
    Console.WriteLine("   ----------------           ------");
    Console.WriteLine($"   GET /health/live           {await Status(http, "/health/live")}");
    Console.WriteLine($"   GET /health/ready          {await Status(http, "/health/ready")}");
    Console.WriteLine($"   GET /v1/payments/PAY-001   {await Status(http, "/v1/payments/PAY-001")}");
    Console.WriteLine($"   process alive              True");
    Console.WriteLine($"   unhandled exceptions       0");
    Console.WriteLine($"   restarts                   0");
    Console.WriteLine();
    Console.WriteLine($"   items processed            {FragileWorker.Processed} of 12");
    Console.WriteLine($"   loop still running         {FragileWorker.LoopAlive}");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   EVERY SIGNAL SAYS HEALTHY AND THE ONE THAT MATTERS IS AT THE BOTTOM OF");
    Console.WriteLine("   THE LIST, WHERE NOTHING WAS LOOKING.");
    Console.WriteLine();
    Console.WriteLine("   THE READINESS CHECK IS THE INSTRUCTIVE ONE. It checks the database,");
    Console.WriteLine("   because that is what readiness checks check. The database was fine. The");
    Console.WriteLine("   check answers 'can this instance serve an HTTP request', and the");
    Console.WriteLine("   instance could - it simply was not doing the other thing it exists");
    Console.WriteLine("   for.");
    Console.WriteLine();
    Console.WriteLine("   A HEALTH CHECK ONLY COVERS WHAT SOMEBODY THOUGHT TO PUT IN IT. In a");
    Console.WriteLine("   service that is half web application and half worker, health checks");
    Console.WriteLine("   written by the web half describe the web half.");
    Console.WriteLine();
    Console.WriteLine("   AND THE QUEUE DEPTH WAS BEING GRAPHED. Nobody alerted on it, because");
    Console.WriteLine("   for a year it had never been above fifty, and a metric that has never");
    Console.WriteLine("   moved does not get a threshold. THE ALERT THAT WOULD HAVE CAUGHT THIS");
    Console.WriteLine("   IS THE ONE NOBODY WRITES, because writing it means imagining the");
    Console.WriteLine("   failure first.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheFix()
{
    Console.WriteLine("4. Three changes, and what each one buys");
    Console.WriteLine();

    var queue = new Queue(items: 12);
    var gateway = new Gateway { TimeOutOnce = true };

    ResilientWorker.Processed = 0;
    ResilientWorker.LoopAlive = false;
    ResilientWorker.ItemFailures = 0;
    ResilientWorker.LastBeat = DateTime.UtcNow;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton(queue);
    builder.Services.AddSingleton(gateway);
    builder.Services.AddHostedService<ResilientWorker>();

    // CHANGE THREE: the worker reports its own liveness.
    builder.Services.AddHealthChecks()
        .AddCheck("reconciliation-worker", () =>
            DateTime.UtcNow - ResilientWorker.LastBeat < TimeSpan.FromMilliseconds(400)
                ? HealthCheckResult.Healthy($"Last beat {DateTime.UtcNow - ResilientWorker.LastBeat:s\\.fff}s ago.")
                : HealthCheckResult.Unhealthy(
                    $"No heartbeat for {DateTime.UtcNow - ResilientWorker.LastBeat:s\\.fff}s."),
            tags: ["ready"]);

    var app = builder.Build();
    app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = r => r.Tags.Contains("ready") });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    await Task.Delay(600);

    Console.WriteLine("   after the same timed-out gateway call:");
    Console.WriteLine();
    Console.WriteLine($"     items processed        {ResilientWorker.Processed} of 12");
    Console.WriteLine($"     items that failed      {ResilientWorker.ItemFailures}");
    Console.WriteLine($"     loop still running     {ResilientWorker.LoopAlive}");
    Console.WriteLine($"     GET /health/ready      {await Status(http, "/health/ready")}");

    // And what the health check says once the loop really does stop.
    await app.StopAsync();
    await Task.Delay(500);

    var builder2 = WebApplication.CreateBuilder();
    builder2.WebHost.UseUrls("http://127.0.0.1:0");
    builder2.Logging.ClearProviders();
    builder2.Services.AddHealthChecks()
        .AddCheck("reconciliation-worker", () =>
            DateTime.UtcNow - ResilientWorker.LastBeat < TimeSpan.FromMilliseconds(400)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("No heartbeat."), tags: ["ready"]);

    var app2 = builder2.Build();
    app2.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = r => r.Tags.Contains("ready") });

    await app2.StartAsync();
    using var http2 = new HttpClient { BaseAddress = new Uri(app2.Urls.First()) };

    Console.WriteLine($"     ...and with the loop stopped, /health/ready is " +
        $"{await Status(http2, "/health/ready")}");

    await app2.StopAsync();
    await app2.DisposeAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   CHANGE ONE: CATCH PER ITEM, NOT AROUND THE LOOP. The try goes INSIDE");
    Console.WriteLine("   the while, so one bad item costs one item. This is the change that");
    Console.WriteLine("   fixes the bug, and it is worth stating as a rule: A LOOP THAT MUST");
    Console.WriteLine("   KEEP RUNNING NEEDS ITS ERROR HANDLING INSIDE IT.");
    Console.WriteLine();
    Console.WriteLine("   CHANGE TWO: DISTINGUISH YOUR CANCELLATION FROM ANY OTHER. Cancellation");
    Console.WriteLine("   has one exception type for every possible cause, so the type tells you");
    Console.WriteLine("   nothing. The token does:");
    Console.WriteLine();
    Console.WriteLine("     catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)");
    Console.WriteLine("     {");
    Console.WriteLine("         break;   // genuinely shutting down");
    Console.WriteLine("     }");
    Console.WriteLine("     catch (OperationCanceledException)");
    Console.WriteLine("     {");
    Console.WriteLine("         // a timeout on one item. Log it and take the next one.");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   THE when CLAUSE IS THE WHOLE FIX and it is easy to leave out, because");
    Console.WriteLine("   the version without it is correct on the only path anybody tests.");
    Console.WriteLine();
    Console.WriteLine("   CHANGE THREE: THE WORKER REPORTS ITS OWN LIVENESS. A timestamp updated");
    Console.WriteLine("   every iteration, and a readiness check that fails when it goes stale.");
    Console.WriteLine("   Look at the last line: with the loop stopped, readiness goes 503.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE CHANGE THAT WOULD HAVE TURNED NINETEEN DAYS INTO A PAGE.");
    Console.WriteLine("   Changes one and two fix this bug; change three catches the NEXT one,");
    Console.WriteLine("   whatever it turns out to be, including the ones that are not");
    Console.WriteLine("   cancellation and not exceptions at all - a deadlock, a queue read that");
    Console.WriteLine("   blocks forever, a dependency that never answers.");
    Console.WriteLine();
    Console.WriteLine("   ONE CAUTION ON THE HEARTBEAT: PUT IT ON READINESS, NOT LIVENESS. A");
    Console.WriteLine("   stalled worker is not a wedged process, and restarting the instance");
    Console.WriteLine("   throws away the web traffic it is serving perfectly well. Readiness");
    Console.WriteLine("   takes it out of rotation and pages a human, which is the response this");
    Console.WriteLine("   deserves.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatToWatch()
{
    Console.WriteLine("5. What to watch, in order of what it would have saved");
    Console.WriteLine();
    Console.WriteLine("   A HEARTBEAT PER WORKER, SURFACED AS A HEALTH CHECK. Every background");
    Console.WriteLine("   loop updates a timestamp; a check fails when the newest is older than");
    Console.WriteLine("   a few times the expected interval. Ten lines, and it converts every");
    Console.WriteLine("   silent stall in this module into a 503.");
    Console.WriteLine();
    Console.WriteLine("   THE RATE OF WORK, NOT THE HEALTH OF THE WORKER. Items processed per");
    Console.WriteLine("   minute, alerted on when it hits zero during hours it should not be");
    Console.WriteLine("   zero. A worker can be alive and looping and still doing nothing.");
    Console.WriteLine();
    Console.WriteLine("   QUEUE DEPTH AND OLDEST ITEM AGE. Depth alone is ambiguous - a big");
    Console.WriteLine("   queue may be a busy morning. AGE IS NOT: an item that has been waiting");
    Console.WriteLine("   an hour is a fact about your system regardless of volume.");
    Console.WriteLine();
    Console.WriteLine("   ANY WORKER THAT HAS RETURNED FROM ExecuteAsync. The host knows; you");
    Console.WriteLine("   are not told. If a worker is meant to run until shutdown, its task");
    Console.WriteLine("   completing before shutdown is an error, and one line at the end of");
    Console.WriteLine("   ExecuteAsync can say so.");
    Console.WriteLine();
    Console.WriteLine("   AND THE REVIEW QUESTION THAT WOULD HAVE CAUGHT IT ON THE DAY: FOR EVERY");
    Console.WriteLine("   catch IN A LOOP THAT MUST NOT STOP, WHAT ELSE THROWS THIS? An");
    Console.WriteLine("   OperationCanceledException handler that assumes shutdown is the");
    Console.WriteLine("   commonest example, and the general form - a catch that assumes one");
    Console.WriteLine("   cause for an exception with many - is worth looking for everywhere.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<string> Status(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.GetAsync(path);

    return $"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}";
}

// ---------------------------------------------------------------------------
// The worker as deployed. The catch is outside the loop.
sealed class FragileWorker(Queue queue, Gateway gateway) : BackgroundService
{
    public static int Processed;

    public static bool LoopAlive;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        LoopAlive = true;

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                int payment = await queue.TakeAsync(stoppingToken);

                // A deadline for one item, linked to shutdown. Correct, and it
                // raises the same exception type shutdown does.
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                deadline.CancelAfter(TimeSpan.FromMilliseconds(80));

                await gateway.ReconcileAsync(payment, deadline.Token);

                Interlocked.Increment(ref Processed);
            }
        }
        catch (OperationCanceledException)
        {
            // Assumed to mean shutdown. It does not.
        }

        LoopAlive = false;
    }
}

// ---------------------------------------------------------------------------
// The same worker with the three changes.
sealed class ResilientWorker(Queue queue, Gateway gateway) : BackgroundService
{
    public static int Processed;

    public static int ItemFailures;

    public static bool LoopAlive;

    public static DateTime LastBeat = DateTime.UtcNow;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        LoopAlive = true;

        while (!stoppingToken.IsCancellationRequested)
        {
            // CHANGE THREE: proof of life, every iteration, whatever happens.
            LastBeat = DateTime.UtcNow;

            // CHANGE ONE: the try is inside the loop.
            try
            {
                int payment = await queue.TakeAsync(stoppingToken);

                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                deadline.CancelAfter(TimeSpan.FromMilliseconds(80));

                await gateway.ReconcileAsync(payment, deadline.Token);

                Interlocked.Increment(ref Processed);
            }
            // CHANGE TWO: only OUR cancellation ends the loop.
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (OperationCanceledException)
            {
                Interlocked.Increment(ref ItemFailures);
            }
            catch (Exception)
            {
                Interlocked.Increment(ref ItemFailures);
            }
        }

        LoopAlive = false;
    }
}

// ---------------------------------------------------------------------------
// Stands in for the work queue.
sealed class Queue(int items)
{
    int remaining = items;

    public void Reset(int count) => remaining = count;

    public async Task<int> TakeAsync(CancellationToken cancellationToken)
    {
        await Task.Delay(20, cancellationToken);

        int left = Interlocked.Decrement(ref remaining);

        // An empty queue waits rather than ending; a real queue does the same.
        if (left < 0)
        {
            await Task.Delay(20, cancellationToken);

            return 0;
        }

        return left;
    }
}

// ---------------------------------------------------------------------------
// Stands in for the payment gateway. One call takes longer than its deadline.
sealed class Gateway
{
    int calls;

    public bool TimeOutOnce { get; set; }

    public async Task ReconcileAsync(int payment, CancellationToken cancellationToken)
    {
        int call = Interlocked.Increment(ref calls);

        // The fourth call hangs past the 80 ms deadline.
        await Task.Delay(TimeOutOnce && call == 4 ? 400 : 10, cancellationToken);
    }
}
