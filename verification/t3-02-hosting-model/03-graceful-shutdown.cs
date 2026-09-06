// 03-graceful-shutdown.cs — What "graceful" actually means, what it costs when
// it is not, and the two ways an application refuses to shut down.
//
// Run:  dotnet run 03-graceful-shutdown.cs -c Release
//
// EXACT vs RATIO: the outcomes - completed, refused, abandoned - are exact.
// The milliseconds are machine-specific, but they are compared against delays
// of hundreds of milliseconds, so the comparisons hold.

#:sdk Microsoft.NET.Sdk.Web

using System.Diagnostics;
using Microsoft.Extensions.Options;

await InFlightRequestsAreDrained();
await NewRequestsAreRefused();
await TheShutdownTimeout();
await AWorkerThatIgnoresTheToken();
Signals();

// ---------------------------------------------------------------------------
static async Task InFlightRequestsAreDrained()
{
    Console.WriteLine("1. A request already running when shutdown begins");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var app = builder.Build();

    app.MapGet("/slow", async () =>
    {
        await Task.Delay(500);
        return "finished";
    });

    await app.StartAsync();

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    var sw = Stopwatch.StartNew();

    // Start the request, give it time to reach the handler, then stop the host
    // while it is still running.
    Task<HttpResponseMessage> inFlight = http.GetAsync("/slow");
    await Task.Delay(100);

    Console.WriteLine($"   t={sw.ElapsedMilliseconds,4} ms  request is in the handler, StopAsync() called");
    Task stopping = app.StopAsync();

    HttpResponseMessage response = await inFlight;
    string body = await response.Content.ReadAsStringAsync();
    long requestDone = sw.ElapsedMilliseconds;

    await stopping;
    long stopDone = sw.ElapsedMilliseconds;

    Console.WriteLine($"   t={requestDone,4} ms  the request completed: {(int)response.StatusCode} {body}");
    Console.WriteLine($"   t={stopDone,4} ms  StopAsync() returned");
    Console.WriteLine();
    Console.WriteLine("   THE REQUEST FINISHED NORMALLY, and shutdown waited for it. That is");
    Console.WriteLine("   what graceful means, and it is the whole feature:");
    Console.WriteLine();
    Console.WriteLine("     1. stop accepting new connections");
    Console.WriteLine("     2. let in-flight requests finish");
    Console.WriteLine("     3. stop hosted services, in reverse registration order");
    Console.WriteLine("     4. dispose the container");
    Console.WriteLine();
    Console.WriteLine("   Without step 2, every request in flight at deploy time returns a");
    Console.WriteLine("   connection error. On a rolling deploy of ten pods that is ten");
    Console.WriteLine("   bursts of failures per release, and they are invisible in your");
    Console.WriteLine("   own logs because the process died before it could write one.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task NewRequestsAreRefused()
{
    Console.WriteLine("2. Requests that arrive after shutdown begins");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var app = builder.Build();
    app.MapGet("/slow", async () => { await Task.Delay(400); return "finished"; });
    app.MapGet("/quick", () => "ok");

    await app.StartAsync();
    string baseUrl = app.Urls.First();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    Task<HttpResponseMessage> inFlight = http.GetAsync("/slow");
    await Task.Delay(100);

    Task stopping = app.StopAsync();
    await Task.Delay(50);

    // A brand new connection, after the listener has closed.
    string arrivingLate;
    try
    {
        using var fresh = new HttpClient { BaseAddress = new Uri(baseUrl) };
        HttpResponseMessage late = await fresh.GetAsync("/quick");
        arrivingLate = $"{(int)late.StatusCode} {late.StatusCode}";
    }
    catch (HttpRequestException ex)
    {
        arrivingLate = $"{ex.GetType().Name}: {ex.Message}";
    }

    HttpResponseMessage inFlightResponse = await inFlight;
    await stopping;

    Console.WriteLine($"   the request already running : {(int)inFlightResponse.StatusCode} " +
        $"{await inFlightResponse.Content.ReadAsStringAsync()}");
    Console.WriteLine($"   a NEW request 50 ms later   : {arrivingLate}");
    Console.WriteLine();
    Console.WriteLine("   The listening socket closes immediately; only work already accepted");
    Console.WriteLine("   is allowed to finish. A new connection is REFUSED at the TCP level,");
    Console.WriteLine("   not answered with a status code - there is no server left to");
    Console.WriteLine("   produce one.");
    Console.WriteLine();
    Console.WriteLine("   This is the detail that makes deploys drop traffic even with");
    Console.WriteLine("   graceful shutdown working perfectly. The sequence during a rolling");
    Console.WriteLine("   deploy is:");
    Console.WriteLine();
    Console.WriteLine("     1. the orchestrator sends SIGTERM to the pod");
    Console.WriteLine("     2. the pod stops accepting connections IMMEDIATELY");
    Console.WriteLine("     3. the load balancer notices, some seconds later");
    Console.WriteLine("     4. between 2 and 3 it is still routing traffic to a closed port");
    Console.WriteLine();
    Console.WriteLine("   Everything in that window is a connection error. The application is");
    Console.WriteLine("   behaving correctly and the requests still fail.");
    Console.WriteLine();
    Console.WriteLine("   The fix is on the deployment side, not in your code: a preStop hook");
    Console.WriteLine("   that sleeps for longer than the load balancer takes to notice, so");
    Console.WriteLine("   the pod keeps serving while it is being taken out of rotation. Five");
    Console.WriteLine("   to fifteen seconds is typical, and it must be LONGER than the");
    Console.WriteLine("   readiness probe interval multiplied by its failure threshold.");
    Console.WriteLine();
    Console.WriteLine("   The other half is to make the readiness probe report unhealthy as");
    Console.WriteLine("   soon as ApplicationStopping fires, so the load balancer learns about");
    Console.WriteLine("   it at the earliest possible moment rather than by a failed check.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheShutdownTimeout()
{
    Console.WriteLine("3. When draining takes longer than the timeout");
    Console.WriteLine();

    Console.WriteLine("   The same 3000 ms handler, interrupted at three different timeouts:");
    Console.WriteLine();
    Console.WriteLine("   ShutdownTimeout   StopAsync took   difference   the in-flight request");
    Console.WriteLine("   ---------------   --------------   ----------   ---------------------");

    foreach (int timeoutMs in new[] { 200, 800, 1500 })
    {
        (long took, string result) = await MeasureShutdownAsync(timeoutMs);
        Console.WriteLine($"   {timeoutMs,13} ms   {took,11} ms   {took - timeoutMs,8} ms   {result}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE DIFFERENCE IS A CONSTANT, not a proportion. Shutdown costs the");
    Console.WriteLine("   timeout you configured PLUS about a second of connection teardown");
    Console.WriteLine("   that no setting in this file controls.");
    Console.WriteLine();
    Console.WriteLine("   That matters when you are budgeting against an orchestrator that");
    Console.WriteLine("   will SIGKILL you: the number to compare against its patience is not");
    Console.WriteLine("   ShutdownTimeout, it is ShutdownTimeout plus that overhead. Measure");
    Console.WriteLine("   it on your own runtime rather than trusting the figure here.");
    Console.WriteLine();

    Console.WriteLine("   Every one of those requests was dropped mid-flight. The client sees");
    Console.WriteLine("   a broken connection rather than a status code, which is the same");
    Console.WriteLine("   thing it would have seen from an ungraceful kill - the difference is");
    Console.WriteLine("   only that the requests which fit inside the timeout survived.");
    Console.WriteLine();
    Console.WriteLine("   THE DEFAULT IS 30 SECONDS, and it is a deadline rather than a");
    Console.WriteLine("   target: shutdown returns as soon as everything has finished, so a");
    Console.WriteLine("   generous value costs nothing on a healthy shutdown.");
    Console.WriteLine();
    Console.WriteLine("   What it must be measured against is your SLOWEST endpoint, not your");
    Console.WriteLine("   average one. A report endpoint that legitimately takes 45 seconds is");
    Console.WriteLine("   killed on every single deploy, by a default nobody chose.");
    Console.WriteLine();
    Console.WriteLine("   And it interacts with the orchestrator's own patience:");
    Console.WriteLine();
    Console.WriteLine("     Kubernetes terminationGracePeriodSeconds   default 30 s");
    Console.WriteLine("     .NET ShutdownTimeout                       default 30 s");
    Console.WriteLine();
    Console.WriteLine("   Those being equal is a trap. When the orchestrator's period expires");
    Console.WriteLine("   it sends SIGKILL, which cannot be caught or delayed. If .NET is");
    Console.WriteLine("   still inside its own 30 seconds, it is killed mid-drain and the");
    Console.WriteLine("   graceful shutdown you configured never completes.");
    Console.WriteLine();
    Console.WriteLine("   Set the application's timeout SHORTER than the orchestrator's, with");
    Console.WriteLine("   room for the preStop hook as well:");
    Console.WriteLine();
    Console.WriteLine("     terminationGracePeriodSeconds  =  preStop sleep");
    Console.WriteLine("                                    +  ShutdownTimeout");
    Console.WriteLine("                                    +  a margin");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// One shutdown, measured: start a host whose handler needs 3000 ms, get a
// request into that handler, then stop with the given timeout.
static async Task<(long, string)> MeasureShutdownAsync(int timeoutMs)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // The default is 30 seconds. Shortened here so the failure is observable
    // in a program you are willing to wait for.
    builder.Services.Configure<HostOptions>(options =>
        options.ShutdownTimeout = TimeSpan.FromMilliseconds(timeoutMs));

    var app = builder.Build();
    app.MapGet("/very-slow", async () => { await Task.Delay(3000); return "finished"; });

    await app.StartAsync();

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    Task<HttpResponseMessage> inFlight = http.GetAsync("/very-slow");
    await Task.Delay(100);

    var sw = Stopwatch.StartNew();
    await app.StopAsync();
    long took = sw.ElapsedMilliseconds;

    string outcome;
    try
    {
        HttpResponseMessage response = await inFlight;
        outcome = $"completed {(int)response.StatusCode}";
    }
    catch (HttpRequestException ex)
    {
        outcome = $"ABANDONED ({ex.InnerException?.GetType().Name ?? ex.GetType().Name})";
    }

    return (took, outcome);
}

// ---------------------------------------------------------------------------
static async Task AWorkerThatIgnoresTheToken()
{
    Console.WriteLine("4. The background service that will not stop");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.Configure<HostOptions>(options =>
        options.ShutdownTimeout = TimeSpan.FromMilliseconds(500));
    builder.Services.AddHostedService<StubbornWorker>();

    var app = builder.Build();
    await app.StartAsync();
    await Task.Delay(100);

    var sw = Stopwatch.StartNew();
    await app.StopAsync();
    long ignoring = sw.ElapsedMilliseconds;

    // The same thing, honouring the token.
    var builder2 = WebApplication.CreateBuilder();
    builder2.WebHost.UseUrls("http://127.0.0.1:0");
    builder2.Logging.ClearProviders();
    builder2.Services.Configure<HostOptions>(options =>
        options.ShutdownTimeout = TimeSpan.FromMilliseconds(500));
    builder2.Services.AddHostedService<CooperativeWorker>();

    var app2 = builder2.Build();
    await app2.StartAsync();
    await Task.Delay(100);

    sw.Restart();
    await app2.StopAsync();
    long cooperating = sw.ElapsedMilliseconds;

    Console.WriteLine("   worker                        StopAsync took   loop iterations after stop");
    Console.WriteLine("   ------                        --------------   --------------------------");
    Console.WriteLine($"   ignores the stopping token    {ignoring,11} ms   {StubbornWorker.IterationsAfterStop,26}");
    Console.WriteLine($"   honours the stopping token    {cooperating,11} ms   {CooperativeWorker.IterationsAfterStop,26}");
    Console.WriteLine();
    Console.WriteLine("   The stubborn worker cost the full ShutdownTimeout and was then");
    Console.WriteLine("   abandoned. The cooperative one returned in single-digit");
    Console.WriteLine("   milliseconds.");
    Console.WriteLine();
    Console.WriteLine("   Notice what is ABSENT here: the extra second from section 3. There");
    Console.WriteLine("   are no open connections in this test, which is good evidence that");
    Console.WriteLine("   the constant overhead there was connection teardown rather than");
    Console.WriteLine("   anything to do with the timeout itself.");
    Console.WriteLine();
    Console.WriteLine("   The stoppingToken passed to ExecuteAsync is the ONLY notice a");
    Console.WriteLine("   background service gets. Ignoring it means:");
    Console.WriteLine();
    Console.WriteLine("     - every shutdown takes the full timeout, so every deploy is");
    Console.WriteLine("       slower by that amount, multiplied by the number of pods");
    Console.WriteLine("     - the work is abandoned at an arbitrary point anyway, which is");
    Console.WriteLine("       worse than stopping at a boundary you chose");
    Console.WriteLine("     - a message pulled from a queue but not acknowledged is");
    Console.WriteLine("       redelivered, so the work is done twice");
    Console.WriteLine();
    Console.WriteLine("   Honouring it means two things, and the second is the one people");
    Console.WriteLine("   miss:");
    Console.WriteLine();
    Console.WriteLine("     1. pass it to every await inside the loop");
    Console.WriteLine("     2. check it between UNITS OF WORK, and finish the unit you are in");
    Console.WriteLine();
    Console.WriteLine("   Cancelling halfway through writing a batch to the database is a");
    Console.WriteLine("   correctness problem, not a tidy shutdown. Stop at a point where the");
    Console.WriteLine("   state is consistent.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Signals()
{
    Console.WriteLine("5. What actually triggers all of this");
    Console.WriteLine();
    Console.WriteLine("   signal / event          caught?   result");
    Console.WriteLine("   --------------          -------   ------");
    Console.WriteLine("   SIGTERM                 yes       graceful shutdown begins");
    Console.WriteLine("   SIGINT (Ctrl+C)         yes       graceful shutdown begins");
    Console.WriteLine("   SIGKILL (kill -9)       NO        process ends immediately");
    Console.WriteLine("   container OOM kill      NO        process ends immediately");
    Console.WriteLine("   IHostApplicationLifetime.StopApplication()   -   graceful, from code");
    Console.WriteLine();
    Console.WriteLine("   The host installs handlers for SIGTERM and SIGINT and turns them");
    Console.WriteLine("   into the same sequence StopAsync() runs above. That is why every");
    Console.WriteLine("   measurement in this file used StopAsync directly: it is the same");
    Console.WriteLine("   path a real deploy takes.");
    Console.WriteLine();
    Console.WriteLine("   The two that cannot be caught are the reason none of this replaces");
    Console.WriteLine("   idempotent, restartable work. A pod killed for exceeding its memory");
    Console.WriteLine("   limit gets no notice at all, and no amount of shutdown handling");
    Console.WriteLine("   protects the work it was doing.");
    Console.WriteLine();
    Console.WriteLine("   The three lifecycle events, and what each is good for:");
    Console.WriteLine();
    Console.WriteLine("     ApplicationStarted    startup finished, the server is listening.");
    Console.WriteLine("                           Useful for logging the real bound port.");
    Console.WriteLine();
    Console.WriteLine("     ApplicationStopping   shutdown has BEGUN and nothing has stopped");
    Console.WriteLine("                           yet. This is the one that matters: flip");
    Console.WriteLine("                           readiness to unhealthy here.");
    Console.WriteLine();
    Console.WriteLine("     ApplicationStopped    everything has stopped. Too late to affect");
    Console.WriteLine("                           anything; useful only for a final log line.");
    Console.WriteLine();
    Console.WriteLine("   A shutdown that a human has to think about is a shutdown that will");
    Console.WriteLine("   be wrong under pressure. The whole sequence should be configuration");
    Console.WriteLine("   plus a stoppingToken that is actually honoured.");
}

// ---------------------------------------------------------------------------
sealed class StubbornWorker : BackgroundService
{
    public static int IterationsAfterStop;

    private static bool _stopping;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        stoppingToken.Register(() => _stopping = true);

        while (true)
        {
            // The token is never checked and never passed to the delay. This
            // loop has no way of learning that shutdown started.
            await Task.Delay(50, CancellationToken.None);

            if (_stopping)
            {
                Interlocked.Increment(ref IterationsAfterStop);
            }
        }
    }
}

sealed class CooperativeWorker : BackgroundService
{
    public static int IterationsAfterStop;

    private static bool _stopping;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        stoppingToken.Register(() => _stopping = true);

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(50, stoppingToken);

                if (_stopping)
                {
                    Interlocked.Increment(ref IterationsAfterStop);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected: the delay was cancelled by shutdown. Returning here is
            // how a background service signals that it has finished.
        }
    }
}
