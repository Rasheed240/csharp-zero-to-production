// 04-production.cs — Ledger's deploy incident: every release loses settlement
// notifications and drops live requests, and nothing is wrong with the code
// that does the work.
//
// Run:  dotnet run 04-production.cs -c Release
//
// EXACT vs RATIO: the item counts are exact - each version is given the same
// number of work items and the survivors are counted. Timings are incidental.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Diagnostics;

await TheIncident();
await ThreeVersionsOfTheWorker();
await RequestsDuringTheDeploy();
Checklist();

// ---------------------------------------------------------------------------
static Task TheIncident()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   Ledger deploys twelve times a week. After every deploy, support gets");
    Console.WriteLine("   a handful of tickets: a payment settled, the money moved, and the");
    Console.WriteLine("   customer never got the notification.");
    Console.WriteLine();
    Console.WriteLine("   It is never the same payment twice, it is always within a minute of");
    Console.WriteLine("   a release, and it cannot be reproduced on demand. The notification");
    Console.WriteLine("   service has no errors in its logs for those payments - it has no");
    Console.WriteLine("   entries for them at all.");
    Console.WriteLine();
    Console.WriteLine("   The design is an OUTBOX. Settling a payment writes a row; a");
    Console.WriteLine("   BackgroundService polls for unsent rows, batches them, and posts the");
    Console.WriteLine("   batch to the notification service. Batching is what made it fast");
    Console.WriteLine("   enough, and it is what loses the messages.");
    Console.WriteLine();
    Console.WriteLine("   The worker holds a batch IN MEMORY between the read and the send. A");
    Console.WriteLine("   deploy ends the process while a batch is in that gap, and the batch");
    Console.WriteLine("   goes with it. Nothing logs an error, because nothing failed - the");
    Console.WriteLine("   process was told to stop and it stopped.");
    Console.WriteLine();
    return Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static async Task ThreeVersionsOfTheWorker()
{
    Console.WriteLine("2. Three versions of the same worker, shut down mid-batch");
    Console.WriteLine();

    var v1 = await RunAsync(WorkerKind.IgnoresToken);
    var v2 = await RunAsync(WorkerKind.HonoursToken);
    var v3 = await RunAsync(WorkerKind.HonoursTokenAndDrains);

    Console.WriteLine("   version                             taken   sent   LOST   shutdown");
    Console.WriteLine("   -------                             -----   ----   ----   --------");
    Console.WriteLine($"   v1 ignores the stopping token      {v1.Taken,6} {v1.Sent,6} {v1.Lost,6}   {v1.Ms,5} ms");
    Console.WriteLine($"   v2 honours it, drops its batch     {v2.Taken,6} {v2.Sent,6} {v2.Lost,6}   {v2.Ms,5} ms");
    Console.WriteLine($"   v3 honours it, flushes on stop     {v3.Taken,6} {v3.Sent,6} {v3.Lost,6}   {v3.Ms,5} ms");
    Console.WriteLine();
    Console.WriteLine("   All three run the identical send logic. The difference is entirely");
    Console.WriteLine("   in how they respond to being asked to stop.");
    Console.WriteLine();
    Console.WriteLine("   V1 IGNORES THE TOKEN. Look at the TAKEN column: it kept pulling");
    Console.WriteLine("   work for the whole shutdown window, roughly two and a half times as");
    Console.WriteLine("   much as the others, and it still lost a batch at the end. It costs");
    Console.WriteLine("   the full ShutdownTimeout and buys nothing with it.");
    Console.WriteLine();
    Console.WriteLine("   Worth being precise about why: v1 is not stopped, it is ABANDONED.");
    Console.WriteLine("   The host gives up waiting and carries on without it, so no code");
    Console.WriteLine("   after its loop ever runs - no flush, no logging, no cleanup. That is");
    Console.WriteLine("   why the loss here has to be measured as taken-minus-sent rather than");
    Console.WriteLine("   counted by the worker itself.");
    Console.WriteLine();
    Console.WriteLine("   V2 HONOURS THE TOKEN and stops promptly - and still loses the batch");
    Console.WriteLine("   in its hand. This is the version that passes review. Somebody added");
    Console.WriteLine("   the cancellation token, the deploy got faster, and the tickets kept");
    Console.WriteLine("   arriving.");
    Console.WriteLine();
    Console.WriteLine("   V3 HONOURS THE TOKEN AND FLUSHES WHAT IT IS HOLDING before it");
    Console.WriteLine("   returns. Nothing is lost, and it still stops promptly.");
    Console.WriteLine();
    Console.WriteLine("   The distinction v2 misses is the one worth carrying:");
    Console.WriteLine();
    Console.WriteLine("     STOP TAKING NEW WORK   immediately, on the token");
    Console.WriteLine("     FINISH THE WORK YOU");
    Console.WriteLine("     HAVE ALREADY TAKEN     before you return");
    Console.WriteLine();
    Console.WriteLine("   Cancellation means the first. It does not mean the second, and a");
    Console.WriteLine("   token passed to every await gives you the first only.");
    Console.WriteLine();
    Console.WriteLine("   The structural fix underneath all three: the outbox row should not");
    Console.WriteLine("   be marked sent until the send succeeds. Then a lost batch is");
    Console.WriteLine("   redelivered on the next start rather than lost, and the worker's");
    Console.WriteLine("   shutdown behaviour becomes a latency question instead of a");
    Console.WriteLine("   correctness one. Graceful shutdown reduces the damage; durable");
    Console.WriteLine("   state is what removes it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<(int Taken, int Sent, int Lost, long Ms)> RunAsync(WorkerKind kind)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.Configure<HostOptions>(o =>
        o.ShutdownTimeout = TimeSpan.FromMilliseconds(400));

    var outbox = new Outbox();
    builder.Services.AddSingleton(outbox);
    builder.Services.AddSingleton(new WorkerConfig(kind));
    builder.Services.AddHostedService<OutboxPublisher>();

    var app = builder.Build();
    await app.StartAsync();

    // Let it get into a steady state: some sent, some batched, some pending.
    await Task.Delay(250);

    var sw = Stopwatch.StartNew();
    await app.StopAsync();
    long ms = sw.ElapsedMilliseconds;

    return (outbox.Taken, outbox.Sent.Count, outbox.Lost, ms);
}

// ---------------------------------------------------------------------------
static async Task RequestsDuringTheDeploy()
{
    Console.WriteLine("3. The other half: requests in flight when SIGTERM arrives");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    int entered = 0;
    int completed_server = 0;

    var app = builder.Build();
    app.MapPost("/payments/{id}/settle", async (string id) =>
    {
        Interlocked.Increment(ref entered);
        await Task.Delay(300);          // gateway call
        Interlocked.Increment(ref completed_server);
        return Results.Ok(new { id, status = "settled" });
    });

    await app.StartAsync();
    string baseUrl = app.Urls.First();
    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    // Twenty requests in flight, then a deploy.
    Task<HttpResponseMessage>[] inFlight = Enumerable.Range(0, 20)
        .Select(i => http.PostAsync($"/payments/PAY-{i:D4}/settle", null))
        .ToArray();

    // Wait until every one of the twenty is actually inside a handler. Without
    // this the test measures connection setup rather than draining.
    while (Volatile.Read(ref entered) < 20)
    {
        await Task.Delay(10);
    }

    int enteredAtStop = entered;
    Task stopping = app.StopAsync();

    // And ten more that arrive after the listener has closed. These use a
    // SEPARATE client on purpose: connections that are refused disturb the
    // pool they are in, and reusing the first client here made its twenty
    // in-flight requests fail too - a measurement artefact, not a property of
    // the server, which completed all twenty handlers either way.
    using var lateClient = new HttpClient { BaseAddress = new Uri(baseUrl) };
    var arrivingLate = new List<Task<string>>();
    await Task.Delay(50);
    for (int i = 0; i < 10; i++)
    {
        arrivingLate.Add(TryAsync(lateClient, $"/payments/LATE-{i:D4}/settle"));
    }

    int completed = 0;
    int failed = 0;
    foreach (Task<HttpResponseMessage> task in inFlight)
    {
        try
        {
            HttpResponseMessage response = await task;
            if (response.IsSuccessStatusCode)
            {
                completed++;
            }
            else
            {
                failed++;
            }
        }
        catch (HttpRequestException)
        {
            failed++;
        }
    }

    string[] lateResults = await Task.WhenAll(arrivingLate);
    await stopping;

    Console.WriteLine($"   requests inside a handler when shutdown began : {enteredAtStop}");
    Console.WriteLine($"     completed on the server : {completed_server}");
    Console.WriteLine($"     answered the client     : {completed}");
    Console.WriteLine($"     failed                  : {failed}");
    Console.WriteLine();
    Console.WriteLine($"   10 requests arriving 50 ms AFTER shutdown began");
    Console.WriteLine($"     completed normally : {lateResults.Count(r => r == "ok")}");
    Console.WriteLine($"     connection refused : {lateResults.Count(r => r != "ok")}");
    Console.WriteLine();
    Console.WriteLine("   The application did everything right and still failed ten requests.");
    Console.WriteLine("   In-flight work drained cleanly; anything that ARRIVED after the");
    Console.WriteLine("   listener closed had nowhere to land.");
    Console.WriteLine();
    Console.WriteLine("   Those ten are the load balancer's fault and your problem. It takes");
    Console.WriteLine("   seconds to notice a pod is gone, and it keeps routing traffic to a");
    Console.WriteLine("   closed port until it does.");
    Console.WriteLine();
    Console.WriteLine("   With twelve deploys a week across ten pods, at Ledger's 400 requests");
    Console.WriteLine("   per hour, a five-second blind window per pod is roughly:");
    Console.WriteLine();
    Console.WriteLine("     400 req/hour = 0.11 req/second");
    Console.WriteLine("     0.11 x 5 s x 10 pods x 12 deploys = about 67 failed requests a week");
    Console.WriteLine();
    Console.WriteLine("   Small enough to be dismissed as noise on a dashboard, and each one");
    Console.WriteLine("   is a payment attempt that returned a connection error to a customer.");
    Console.WriteLine("   At ten times the traffic it is 670 a week and somebody notices.");
    Console.WriteLine();
    Console.WriteLine("   The fix is not in the application. It is a preStop hook that keeps");
    Console.WriteLine("   the pod serving while it is removed from rotation, plus a readiness");
    Console.WriteLine("   probe that reports unhealthy the moment ApplicationStopping fires.");
    Console.WriteLine();

    static async Task<string> TryAsync(HttpClient http, string path)
    {
        try
        {
            HttpResponseMessage response = await http.PostAsync(path, null);
            return response.IsSuccessStatusCode ? "ok" : $"{(int)response.StatusCode}";
        }
        catch (HttpRequestException)
        {
            return "refused";
        }
    }
}

// ---------------------------------------------------------------------------
static void Checklist()
{
    Console.WriteLine("4. What to take from this");
    Console.WriteLine();
    Console.WriteLine("   Every fix was a HOSTING decision. None of them changed a line of the");
    Console.WriteLine("   code that sends a notification or settles a payment.");
    Console.WriteLine();
    Console.WriteLine("     the stopping token      stop taking new work when it fires");
    Console.WriteLine("     the work in hand        finish it before returning from");
    Console.WriteLine("                             ExecuteAsync or StopAsync");
    Console.WriteLine("     ShutdownTimeout         longer than your slowest endpoint, and");
    Console.WriteLine("                             shorter than the orchestrator's patience");
    Console.WriteLine("     ApplicationStopping     flip readiness to unhealthy here");
    Console.WriteLine("     a preStop hook          keep serving while the load balancer");
    Console.WriteLine("                             catches up");
    Console.WriteLine("     durable state           so that losing the process costs latency");
    Console.WriteLine("                             rather than data");
    Console.WriteLine();
    Console.WriteLine("   The last one is the only one that survives a SIGKILL, an out-of-");
    Console.WriteLine("   memory kill, or a machine losing power. The others reduce how often");
    Console.WriteLine("   you need it; none of them replaces it.");
}

// ---------------------------------------------------------------------------
// The enum is a value type, so it is wrapped for registration - AddSingleton
// requires a reference type.
sealed record WorkerConfig(WorkerKind Kind);

enum WorkerKind
{
    IgnoresToken,
    HonoursToken,
    HonoursTokenAndDrains
}

sealed class Outbox
{
    private int _nextId;

    public ConcurrentBag<int> Sent { get; } = new();

    // Every id handed out by Take(). Lost work is what was taken and never
    // sent - the only measure that works for all three versions, because a
    // worker abandoned mid-loop never runs any accounting code of its own.
    public int Taken => _nextId;

    public int Lost => Taken - Sent.Count;

    // Stands in for "SELECT * FROM outbox WHERE sent = 0 LIMIT n".
    public List<int> Take(int count)
    {
        var batch = new List<int>(count);
        for (int i = 0; i < count; i++)
        {
            batch.Add(Interlocked.Increment(ref _nextId));
        }

        return batch;
    }

    public void Send(IEnumerable<int> batch)
    {
        foreach (int id in batch)
        {
            Sent.Add(id);
        }
    }

}

sealed class OutboxPublisher : BackgroundService
{
    private readonly Outbox _outbox;
    private readonly WorkerKind _kind;

    // The batch currently held in memory: read from the outbox, not yet sent.
    // This is the gap the incident lives in.
    private List<int> _inHand = new();

    public OutboxPublisher(Outbox outbox, WorkerConfig config)
    {
        _outbox = outbox;
        _kind = config.Kind;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (true)
            {
                if (_kind != WorkerKind.IgnoresToken && stoppingToken.IsCancellationRequested)
                {
                    break;
                }

                _inHand = _outbox.Take(5);

                // The send is slower than the read, which is why a batch is
                // usually in hand when anything else happens.
                await Task.Delay(30, _kind == WorkerKind.IgnoresToken
                    ? CancellationToken.None
                    : stoppingToken);

                _outbox.Send(_inHand);
                _inHand = new List<int>();
            }
        }
        catch (OperationCanceledException)
        {
            // Shutdown cancelled the delay. Whatever is in hand was read from
            // the outbox and never sent.
        }

        if (_kind == WorkerKind.HonoursTokenAndDrains)
        {
            // The fix: finish the work already taken. Note this deliberately
            // does NOT pass the stopping token - it is already cancelled, and
            // the point is to complete rather than to abort.
            _outbox.Send(_inHand);
            _inHand = new List<int>();
        }

        // The other two versions do nothing here. v2 reaches this point with a
        // batch still in hand; v1 never reaches it at all, because the host
        // abandons its loop when the timeout expires.
    }
}
