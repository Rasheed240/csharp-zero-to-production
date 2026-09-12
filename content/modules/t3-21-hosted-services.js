CSPREP.module({
  id: "t3-21-hosted-services",
  minutes: 55,
  updated: "2026-09-06",
  summary: "A reconciliation worker stopped on the 3rd and nobody noticed for nineteen days, because one timed-out gateway call raised the same exception type as shutdown and a catch outside the loop treated it as one. Measured: which of a constructor, StartAsync and ExecuteAsync actually delay your web server (two do, and not the two people expect); a captive DbContext that development refuses to start and production accepts; a change tracker growing to 2,000 entities against a flat 1; Task.Delay drifting 221 ms where PeriodicTimer drifts 14; and a payment claimed off a queue that vanished because its write was given the stopping token.",
  terms: ["IHostedService", "BackgroundService", "IHostedLifecycleService", "ExecuteAsync",
    "stopping token", "ShutdownTimeout", "BackgroundServiceExceptionBehavior", "captive dependency",
    "IServiceScopeFactory", "service scope", "PeriodicTimer", "timer drift", "heartbeat",
    "graceful shutdown", "at-least-once delivery"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Some work has no request attached to it. Reconciling yesterday's payments against the gateway's
  settlement file, retrying failed webhooks, expiring abandoned baskets, sweeping temporary files — none
  of it is triggered by somebody calling your API, and all of it has to happen anyway.</p>

  <p>ASP.NET Core's answer is a background worker that lives inside the same process as the web
  application. Here is one, as it is usually first written:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - and it ran in production for a year"><code>protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    try
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            Payment payment = await queue.TakeAsync(stoppingToken);
            await ReconcileAsync(payment, stoppingToken);
        }
    }
    catch (OperationCanceledException)
    {
        // shutting down
    }
}</code></pre>

  <p>On the 3rd of the month, one call to the gateway took longer than its deadline. Nineteen days
  later Finance asked why the reconciliation figures had not moved.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   scenario                      items processed   loop still running   host alive
   --------                      ---------------   ------------------   ----------
   gateway healthy                            14   True                 alive
   one gateway call times out                  3   False                alive</code></pre>

  <p>The process was alive the whole time. Every HTTP endpoint answered. Both health checks returned
  200. CPU and memory were flat and low — which reads as good news. There were no exceptions in the
  logs, because nothing had failed: the worker was asked to do something, concluded it was being shut
  down, and stopped politely.</p>

  <div class="callout callout--note">
    <h4>Nothing in that snippet is unusual</h4>
    <p>It checks its stopping token. It handles cancellation. It passes the token down. Every one of
    those is the advice you will be given, and the arrangement of them is what makes the worker
    disappear. This module is about the decisions hiding inside a shape that looks like it has already
    made them.</p>
  </div>
</section>

<section id="what-a-worker-is">
  <h2>What a hosted service is</h2>

  <p class="define"><span class="define__term">Host</span> The object that owns your application's
  lifetime. It builds the dependency injection container, starts everything that needs starting, blocks
  until told to stop, and then stops everything in reverse. In a web application the web server itself
  is one of the things it starts.</p>

  <p class="define"><span class="define__term"><code>IHostedService</code></span> The interface the host
  starts and stops. Two methods, <code>StartAsync</code> and <code>StopAsync</code>, and the host
  <em>awaits both</em>.</p>

  <p class="define"><span class="define__term"><code>BackgroundService</code></span> A base class
  implementing <code>IHostedService</code> for the common case: one long-running task. You override
  <code>ExecuteAsync</code>, which is handed a token that is cancelled when the application is stopping.</p>

  <p class="define"><span class="define__term">Stopping token</span> The <code>CancellationToken</code>
  passed to <code>ExecuteAsync</code>. It is cancelled when shutdown begins, and observing it is how a
  worker learns to finish.</p>

  <p class="define"><span class="define__term">Singleton</span> A service the container creates once and
  reuses for the life of the process. Every hosted service is one.</p>

  <p class="define"><span class="define__term">Thread pool</span> A set of threads .NET keeps ready for
  short pieces of work, so that starting work does not mean creating a thread.
  <code>ExecuteAsync</code> is handed to it.</p>

  <p class="define"><span class="define__term"><code>ApplicationStopping</code></span> A token on
  <code>IHostApplicationLifetime</code> that is cancelled when a shutdown is requested. It is how
  anything in the process learns that the host is going away.</p>

  <p class="define"><span class="define__term"><code>ShutdownTimeout</code></span> How long the host
  waits for hosted services to stop before abandoning them. Thirty seconds by default.</p>

  <p class="define"><span class="define__term"><code>BackgroundServiceExceptionBehavior</code></span>
  What the host does when <code>ExecuteAsync</code> <em>throws</em>: <code>StopHost</code> (the default)
  or <code>Ignore</code>. It has no bearing on a worker that returns.</p>

  <pre data-lang="csharp" data-net="10" data-title="The whole registration"><code>var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHostedService&lt;ReconciliationWorker&gt;();

var app = builder.Build();

app.MapGet("/v1/payments/{id}", (string id) =&gt; Results.Ok(new { id }));

app.Run();</code></pre>

  <p>One process now does two jobs. That is the whole appeal — no second deployment, no second
  container, the same configuration and the same connection pool — and it is also the source of every
  problem below, because the two jobs have different needs and only one of them has a framework
  looking after it.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>A web request is a customer at a counter: they arrive, they are served, they leave, and the desk
  is cleared for the next one. A background worker is the person in the back room who was there before
  the shop opened and will be there after it closes.</p>

  <p>The analogy holds for the shape and fails on the thing that matters: <strong>clearing the desk
  between customers is automatic and clearing it in the back room is not.</strong> Every convenience
  the request pipeline provides for free — a fresh scope, a disposed <code>DbContext</code>, an
  exception that surfaces as a 500 somebody can see — exists because a request begins and ends. A
  worker has no request, so none of it happens unless you write it.</p>
</section>

<section id="what-blocks-startup">
  <h2>What delays your web server</h2>

  <p>Four workers, each spending 500 ms getting ready, written four ways. Two of them cost you
  availability and two do not:</p>

  <pre data-lang="console" data-title="01-lifetime-and-ordering.cs output"><code>   where the 500 ms is spent                        host start took
   ------------------------                        ---------------
   nothing (baseline)                                   33 ms
   IHostedService.StartAsync: await Task.Delay         513 ms
   the worker's CONSTRUCTOR                            511 ms
   BackgroundService: Thread.Sleep before an await       1 ms
   BackgroundService: await Task.Delay                   1 ms</code></pre>

  <ul>
    <li><strong><code>StartAsync</code> is awaited by the host.</strong> That is its contract. Anything
    slow in there is time your application is not listening on a port — sometimes exactly what you
    want, and always worth being a decision.</li>
    <li><strong>The constructor blocks too</strong>, and this one catches people. A hosted service is
    resolved from the container during startup, so work in its constructor happens on the startup path
    no matter which base class you chose. The base class cannot protect you from your own
    constructor.</li>
    <li><strong>Synchronous work inside <code>ExecuteAsync</code> does not block</strong>, which is the
    surprise.</li>
  </ul>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the base class cannot save you from this"><code>sealed class ReconciliationWorker : BackgroundService
{
    readonly Dictionary&lt;string, decimal&gt; _rates;

    public ReconciliationWorker(IConfiguration configuration)
    {
        // Runs during startup, on the startup path, before the port opens.
        _rates = LoadExchangeRatesFromDisk(configuration["RatesPath"]!);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) =&gt;
        await Task.Delay(Timeout.Infinite, stoppingToken);

    static Dictionary&lt;string, decimal&gt; LoadExchangeRatesFromDisk(string path)
    {
        Thread.Sleep(500);

        return new Dictionary&lt;string, decimal&gt; { ["GBP"] = 1m };
    }
}</code></pre>

  <pre data-lang="console" data-title="01-lifetime-and-ordering.cs output"><code>     ExecuteAsync was entered at          1 ms   on thread 13
     StartAsync returned at               1 ms   on thread 6
     the 500 ms of sleeping ended at    505 ms</code></pre>

  <p>Different threads, and the host finished starting while the worker was still asleep.
  <code>ExecuteAsync</code> is handed to the thread pool, so a <code>BackgroundService</code> cannot
  delay startup with work inside <code>ExecuteAsync</code> at all.</p>

  <div class="callout callout--gotcha">
    <h4>This changed in .NET 8 and you will meet the old workaround</h4>
    <p>On .NET 6 and 7, <code>ExecuteAsync</code> ran synchronously up to its first
    <code>await</code>, <em>on the startup path</em>, and blocking work there was a well-known way to
    stall a service for minutes. .NET 8 moved it to the thread pool. If you find
    <code>await Task.Yield();</code> as the first line of somebody's <code>ExecuteAsync</code>, that is
    the workaround for the old behaviour, and on .NET 10 it is doing nothing.</p>
  </div>

  <p>The general rule is worth more than the table: <strong>what delays startup is "is the host
  awaiting this", not "is this async".</strong> A constructor is awaited in effect,
  <code>StartAsync</code> is awaited by contract, and <code>ExecuteAsync</code> is not awaited at all.</p>

  <h3>Order, and the hooks either side</h3>

  <pre data-lang="console" data-title="01-lifetime-and-ordering.cs output"><code>   start   First
   start   Second
   start   Third
   stop    Third
   stop    Second
   stop    First</code></pre>

  <p>Started in registration order, stopped in reverse. That is a real guarantee and the one ordering
  primitive you get — but it is invisible: nothing at the registration site says the order matters, and
  a later reordering compiles, starts, and fails somewhere else. Both
  <code>ServicesStartConcurrently</code> and <code>ServicesStopConcurrently</code> default to false, so
  a slow <code>StartAsync</code> also delays every service after it.</p>

  <p class="define"><span class="define__term"><code>IHostedLifecycleService</code></span> Adds
  <code>StartingAsync</code>/<code>StartedAsync</code> and
  <code>StoppingAsync</code>/<code>StoppedAsync</code> either side of the older pair.</p>

  <pre data-lang="console" data-title="01-lifetime-and-ordering.cs output"><code>   StartingAsync   before anything has started
   StartAsync      my turn in the registration order
   StartedAsync    everything is up
   StoppingAsync   before anything has stopped
   StopAsync       my turn in reverse order
   StoppedAsync    everything is down</code></pre>

  <p>The one that solves a real problem is <code>StartedAsync</code>. In <code>StartAsync</code> you
  cannot assume the rest of the application is up, because services after you in the list have not
  started. In <code>StartedAsync</code> you can — so anything of the form "once we are fully up,
  begin…" belongs there rather than in a constructor or behind a delay.</p>
</section>

<section id="scopes">
  <h2>Scopes, and the state that never gets thrown away</h2>

  <p class="define"><span class="define__term">Scope</span> A container-managed lifetime boundary.
  Services registered as <em>scoped</em> are created once per scope and disposed when it ends. A web
  request creates one automatically; nothing creates one for a worker.</p>

  <p class="define"><span class="define__term"><code>IServiceScopeFactory</code></span> The singleton
  service that creates scopes on demand. Safe for a singleton to hold, unlike anything it produces.</p>

  <p class="define"><span class="define__term">Captive dependency</span> A short-lived object held by a
  long-lived one. A hosted service is a <em>singleton</em> — one instance for the life of the process —
  so anything scoped taken in its constructor is resolved once and kept forever.</p>

  <p class="define"><span class="define__term"><code>ValidateScopes</code></span> A container setting
  that throws when a singleton resolves a scoped service. On in the Development environment, off
  everywhere else.</p>

  <p>The obvious thing is to ask for the database in the constructor, the way every other class does:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - and production will accept it"><code>sealed class ReconciliationWorker(LedgerDbContext database) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            // The same DbContext instance, for as long as this process lives.
            await database.SaveChangesAsync(stoppingToken);
            await Task.Delay(1000, stoppingToken);
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="02-scope-and-state.cs output"><code>   environment   ValidateScopes   what happened at Build()
   -----------   --------------   ------------------------
   Development   True             InvalidOperationException
   Production    False            started; worker used 1 DbContext over 6 iterations</code></pre>

  <p>The development build refused to start and the production build did not. That difference is the
  single most useful safety net the container has, switched off exactly where the consequences are
  worst — and turning it on is one line:</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - a bad deployment instead of a bad week"><code>builder.Host.UseDefaultServiceProvider(options =&gt;
{
    options.ValidateScopes = true;
    options.ValidateOnBuild = true;
});</code></pre>

  <p>What it costs to get this wrong is not abstract:</p>

  <pre data-lang="console" data-title="02-scope-and-state.cs output"><code>   after N iterations   entities tracked, one scope   entities tracked, scope per item
   ------------------   --------------------------   -------------------------------
                    1                            1                                 1
                  100                          100                                 1
                 1000                         1000                                 1
                 2000                         2000                                 1</code></pre>

  <p>A straight line against a flat one. And it is not really about <code>DbContext</code> — it is
  about anything that remembers. A scoped cache, a unit-of-work buffer, an audit list, a logger with
  accumulated context: <strong>all of them were written assuming something would throw them away,</strong>
  and in a request something does.</p>

  <p class="define"><span class="define__term">Change tracker</span> The list an ORM keeps of every
  entity it has loaded, so it can work out what to write. It is emptied when the context is disposed —
  which, for a captive context, is never.</p>

  <h3>Where the scope boundary goes</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>    async Task ReconcileAsync(string paymentId, CancellationToken stoppingToken)
    {
        Interlocked.Increment(ref Claimed);

        // A scope per payment. The factory is safe to hold; what it produces
        // is not.
        using IServiceScope scope = scopeFactory.CreateScope();
        var database = scope.ServiceProvider.GetRequiredService&lt;LedgerDbContext&gt;();

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
}</code></pre>

  <pre data-lang="console" data-title="02-scope-and-state.cs output"><code>   scope per...   contexts created   items sharing a context   one item fails
   ------------   ----------------   -----------------------   --------------
   whole run                     1                        12   everything after it
   batch                         3                         4   the rest of its batch
   item                         12                         1   only itself</code></pre>

  <p>There is no universally right answer and there is a right question: <strong>what is one unit of
  work?</strong> A scope is the boundary at which state is thrown away, so it should match the boundary
  at which a failure should stop mattering. Per item is the default; per batch is right when the batch
  is genuinely one transaction; per run is almost never right, because a run that lasts days is a scope
  that lasts days.</p>

  <div class="callout callout--gotcha">
    <h4>The mistake that looks like the fix</h4>
    <p>Creating the scope once, <em>outside</em> the loop. It uses <code>IServiceScopeFactory</code>, it
    disposes properly, it passes review — and it has every problem of the captive dependency, rebuilt
    by hand.</p>
  </div>

  <h3>How many copies are running</h3>

  <pre data-lang="console" data-title="02-scope-and-state.cs output"><code>   how it was registered twice                    loops actually running
   ---------------------------                    ----------------------
   AddHostedService&lt;CountingWorker&gt;() twice       1
   AddSingleton&lt;IHostedService, CountingWorker&gt;() 2
   two different worker types                     2</code></pre>

  <p><code>AddHostedService</code> deduplicates and <code>AddSingleton</code> does not — the opposite of
  what most people expect in both directions. <code>AddHostedService&lt;T&gt;()</code> is implemented
  with <code>TryAddEnumerable</code>, so calling it twice from two extension methods is harmless.
  <code>AddSingleton&lt;IHostedService, T&gt;()</code> appends, and gives you two loops; the symptom is
  every job running twice, which looks like a scheduling bug and is a registration one.</p>

  <p>None of which helps with the version that matters: <strong>one instance per process is not one
  instance per system.</strong> Three replicas are three loops, concurrently, against one database.
  Nothing in the hosting model prevents that or can.</p>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <p>One worker with every decision made explicitly:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// The worker. Nothing in the constructor but the dependencies it will need,
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
    }</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   host started after   31 ms   (the worker did not delay it)

   AFTER 700 ms OF WORK

     payments settled       18
     payments that failed   1
     loop still running     True
     DbContexts created     20
     largest change tracker 1
     GET /health/ready      200 Healthy

   SHUTDOWN

     StopAsync took                22 ms
     loop still running            False

     payments claimed              20
       of which settled            19
       of which failed a deadline  1
       UNACCOUNTED FOR             0</code></pre>

  <p>One payment timed out and the loop kept going. Every payment got its own <code>DbContext</code>, so
  the change tracker never held more than one entity. Shutdown took 22 ms rather than a timeout, and
  nothing was lost in it.</p>

  <div class="callout callout--why">
    <h4>The last number is the one that matters</h4>
    <p>A payment claimed off the queue and neither settled nor failed is a payment that vanished into a
    shutdown — no error, no log, nothing left to retry. It is zero here because the write was not given
    the stopping token, which is the subject of exercise 4.</p>
  </div>

  <p>And the two decisions that sit above this file, because the hosting model cannot make them: it runs
  once per process rather than once per system, and an at-least-once queue is what makes a process being
  <em>killed</em> — as opposed to asked to stop — survivable.</p>
</section>

<section id="where-work-lives">
  <h2>Whether the work belongs in this process at all</h2>

  <p class="define"><span class="define__term">At-least-once delivery</span> A guarantee that an item
  will be processed one or more times, never zero. It is what makes a worker survivable when the
  process is <em>killed</em> rather than asked to stop.</p>

  <p class="define"><span class="define__term">Leader election</span> A mechanism by which several
  identical instances agree that exactly one of them should do a job. Nothing in the hosting model
  provides it.</p>

  <p><code>AddHostedService</code> is one line, which makes it the path of least resistance for work
  that should not be there. Three questions decide, and none of them is about syntax.</p>

  <h3>Does it scale with your web traffic?</h3>

  <p>A worker in the API process is replicated with the API process. If you run three replicas for HTTP
  load, you get three copies of the worker — which is correct for a queue consumer and wrong for
  anything that must happen once.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - this runs once per replica, at the same instant"><code>protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    using var timer = new PeriodicTimer(TimeSpan.FromHours(24));

    while (await timer.WaitForNextTickAsync(stoppingToken))
    {
        // Twenty replicas send twenty copies of every invoice.
        await SendMonthlyInvoicesAsync(stoppingToken);
    }
}</code></pre>

  <p>The rule that falls out of it: <strong>work that is safe to duplicate belongs in the API process;
  work that must happen exactly once does not</strong> — unless you add leader election, at which point
  you have written a scheduler and should ask whether you meant to.</p>

  <h3>Does it compete for the same resources as your requests?</h3>

  <p>The worker shares a thread pool, a connection pool and a memory budget with every request the
  process is serving. A reconciliation job that opens twenty database connections is twenty connections
  your API cannot have, during the exact window when the job is running.</p>

  <p>That is fine at small scale and it is a genuine coupling. A separate worker process costs another
  deployment and buys independent scaling, independent failure, and a resource budget nobody has to
  share.</p>

  <h3>What happens when the process is killed?</h3>

  <p>Everything in this module concerns a <em>graceful</em> stop — SIGTERM, a token, a timeout. None of
  it applies to a process that is killed outright, and processes are killed outright: an out-of-memory
  condition, a node failure, a grace period that expired.</p>

  <div class="callout callout--why">
    <h4>Which is why the queue matters more than the shutdown handling</h4>
    <p>If an item leaves the queue only once it has been processed — a peek-lock with a visibility
    timeout, or a transaction spanning the read and the write — a killed process loses nothing, because
    the item reappears on its own. If the worker removes the item first, no amount of careful shutdown
    code protects you, because the failure you cannot handle is the one where your code does not run.</p>
  </div>

  <p>Which gives a short decision procedure. <strong>Duplicate-safe, small, and tied to this service's
  data</strong> — put it in the process. <strong>Must happen once</strong> — it needs leader election or
  a scheduler, wherever it lives. <strong>Heavy, or independently scaled</strong> — its own process.
  <strong>Must not be lost</strong> — the durability has to come from the queue, and the worker is only
  the thing that reads it.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>A catch around the loop instead of inside it</h3>

  <p>The opening incident. <code>ReconcileAsync</code> gives its HTTP call a deadline by linking a
  timeout to the stopping token — correct, and what every module on cancellation tells you to do. When
  that deadline fires, the call throws <code>OperationCanceledException</code>.</p>

  <p><strong>And that exception is indistinguishable, by type, from shutdown.</strong> The catch was
  written to swallow the one the stopping token raises; it swallows every other one too, and returning
  from <code>ExecuteAsync</code> is how a <code>BackgroundService</code> says "I am finished".</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - the when clause is the whole fix"><code>catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
{
    break;   // genuinely shutting down
}
catch (OperationCanceledException)
{
    // A deadline on one item. Log it and take the next one.
    logger.LogWarning("Reconciling {PaymentId} timed out", paymentId);
}</code></pre>

  <p>The framework did exactly what it should. <code>BackgroundServiceExceptionBehavior</code> never
  came into it — <code>StopHost</code> and <code>Ignore</code> both concern a worker that
  <em>threw</em>, and this one returned.</p>

  <h3>Expecting "StopHost" to stop the host</h3>

  <pre data-lang="console" data-title="01-lifetime-and-ordering.cs output"><code>   behaviour   worker died   ApplicationStopping fired   still serving after
   ---------   -----------   -------------------------   -------------------
   StopHost    True          True                        alive
   Ignore      True          False                       alive</code></pre>

  <p>Under both settings the application was still answering requests. <code>StopHost</code> does not
  kill the process — it calls <code>StopApplication()</code>, which <em>requests</em> a shutdown by
  firing the <code>ApplicationStopping</code> token, and something has to act on that request.
  <code>app.Run()</code> listens; <code>await app.StartAsync()</code> does not.</p>

  <div class="callout callout--warn">
    <h4>Which means a worker that dies on every run can pass an integration test suite</h4>
    <p>Test hosts, <code>WebApplicationFactory</code> and any code that calls
    <code>StartAsync</code> directly are all in that shape: the host keeps serving, and the assertions
    are about HTTP.</p>
  </div>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the loop condition is checked once per hour"><code>while (!stoppingToken.IsCancellationRequested)
{
    await ReconcileAsync();

    // No token. Shutdown waits up to an hour, then abandons the worker.
    await Task.Delay(TimeSpan.FromHours(1));
}</code></pre>

  <h3>A loop that ignores its stopping token</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   worker's loop                          StopAsync took   work in progress
   -------------                          --------------   ----------------
   ignores the stopping token                    3004 ms   ABANDONED mid-item
   honours the stopping token                       1 ms   finished cleanly</code></pre>

  <p>Shortened from the 30-second default here. The cost is not the wait: it is that shutdown stops
  being a controlled event, and work in progress is cut off rather than finished or rolled back.</p>

  <h3>Passing the stopping token to the write as well as the wait</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   what the token is passed to        settled   back on queue   LOST
   ---------------------------        -------   -------------   ----
   everything, including the write          1               0      1
   only the wait for the next item          2               0      0</code></pre>

  <p>"Pass the cancellation token to everything" is right for waiting and wrong for committing.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the payment is gone if shutdown lands here"><code>Payment payment = await queue.TakeAsync(stoppingToken);

await gateway.SettleAsync(payment, stoppingToken);

// A stopping token on the write. Cancel here and the payment is off the
// queue and not recorded anywhere.
await database.SaveChangesAsync(stoppingToken);</code></pre>

  <h3><code>await Task.Delay(period)</code> for a schedule</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   loop style                  fires at (ms from start)              drift
   ----------                  ------------------------              -----
   await Task.Delay(period)       0   154   311   466   621            221 ms
   PeriodicTimer                  0   107   215   307   414             14 ms</code></pre>

  <p><code>Task.Delay(period)</code> means "wait <em>period</em> after the work finishes", so each cycle
  is period plus the work and the error accumulates.</p>

  <h3>Slow work in the constructor</h3>

  <p>Measured above at 511 ms of startup. The base class does not help, because the container resolves
  the worker before any of its methods run.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - one scope for the life of the process"><code>protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    // Uses IServiceScopeFactory, disposes correctly, and is a captive
    // dependency rebuilt by hand: the scope now lives as long as the worker.
    using IServiceScope scope = scopeFactory.CreateScope();
    var database = scope.ServiceProvider.GetRequiredService&lt;LedgerDbContext&gt;();

    while (!stoppingToken.IsCancellationRequested)
    {
        await ReconcileAsync(database, stoppingToken);
        await Task.Delay(1000, stoppingToken);
    }
}</code></pre>

  <h3>Assuming a health check covers the worker</h3>

  <p>In a service that is half web application and half worker, health checks written by the web half
  describe the web half. The incident's readiness check verified the database, and the database was
  fine.</p>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <ol>
    <li><strong>Establish whether the loop is running at all.</strong> Not whether the process is up —
    those are different questions, and the whole incident lives in the gap. A log line per iteration at
    <code>Debug</code>, or a counter you can read, settles it in one deploy.</li>
    <li><strong>If it is not running, ask whether it returned or threw.</strong> A throw leaves an
    <code>Error</code> log from the host. A return leaves nothing at all — and a clean log with a dead
    worker points straight at a <code>catch</code> that swallowed something.</li>
    <li><strong>Check every <code>catch (OperationCanceledException)</code> for a <code>when</code>
    clause.</strong> Without one it cannot distinguish shutdown from a per-item timeout, and it is the
    commonest way for a loop to end silently.</li>
    <li><strong>For a slow start, time the three places separately.</strong> Constructor,
    <code>StartAsync</code>, and the first await of <code>ExecuteAsync</code>. Two of them are on the
    startup path and one is not.</li>
    <li><strong>For a slow shutdown, look for the round number.</strong> Thirty seconds is
    <code>HostOptions.ShutdownTimeout</code>, and hitting it exactly means something never observed its
    token.</li>
    <li><strong>For a memory leak in a worker, count the scopes.</strong> One <code>DbContext</code>
    across many iterations is the captive dependency, and it shows as memory that grows in a straight
    line with no plateau.</li>
  </ol>

  <p>The heartbeat in the first bullet below is the highest-value ten lines in this module, and it is
  two small classes — one the loop writes to, one the health check reads:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// ---------------------------------------------------------------------------
// One timestamp, written by the loop and read by the health check.
sealed class WorkerHeartbeat
{
    long ticks = DateTime.UtcNow.Ticks;

    public void Beat() =&gt; Interlocked.Exchange(ref ticks, DateTime.UtcNow.Ticks);

    public TimeSpan SinceLastBeat =&gt;
        DateTime.UtcNow - new DateTime(Interlocked.Read(ref ticks), DateTimeKind.Utc);
}

// ---------------------------------------------------------------------------
// Fails readiness when the loop has gone quiet for longer than it should.
sealed class WorkerHeartbeatCheck(WorkerHeartbeat heartbeat) : IHealthCheck
{
    static readonly TimeSpan Tolerance = TimeSpan.FromMilliseconds(300);

    public Task&lt;HealthCheckResult&gt; CheckHealthAsync(HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        TimeSpan since = heartbeat.SinceLastBeat;

        return Task.FromResult(since &lt; Tolerance
            ? HealthCheckResult.Healthy($"Last beat {since.TotalMilliseconds:0} ms ago.")
            : HealthCheckResult.Unhealthy($"No beat for {since.TotalMilliseconds:0} ms."));
    }
}</code></pre>

  <div class="callout callout--debug">
    <h4>Four things to watch</h4>
    <ul>
      <li><strong>A heartbeat per worker, surfaced as a health check.</strong> Every loop updates a
      timestamp; a check fails when the newest is older than a few times the expected interval. Ten
      lines, and it converts every silent stall in this module into a 503.</li>
      <li><strong>The rate of work, not the health of the worker.</strong> Items per minute, alerted on
      when it hits zero during hours it should not be. A worker can be alive, looping, and doing
      nothing.</li>
      <li><strong>Queue depth and oldest-item age.</strong> Depth alone is ambiguous — a big queue may
      be a busy morning. Age is not.</li>
      <li><strong>Any worker that has returned from <code>ExecuteAsync</code> before shutdown.</strong>
      The host knows and does not tell you. One line at the end of the method can.</li>
    </ul>
  </div>

  <p>And the review question that would have caught the incident on the day it shipped: <strong>for
  every <code>catch</code> in a loop that must not stop, what else throws this?</strong></p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"A background service cannot delay startup"</h4>
    <p>Its constructor can, and does — measured at 511 ms. Only work inside <code>ExecuteAsync</code> is
    free, and only since .NET 8.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"<code>StopHost</code> means the process exits"</h4>
    <p>It requests a shutdown. Whether anything happens depends on whether something is waiting on the
    application lifetime — <code>app.Run()</code> is; a test host is not.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"If the worker breaks, I will see an exception"</h4>
    <p>Only if it throws. A worker that <em>returns</em> — because a catch swallowed something — has
    finished its job as far as the framework is concerned, and nothing is logged.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Injecting the DbContext is fine, the container would have told me"</h4>
    <p>It tells you in development and not in production, because <code>ValidateScopes</code> is on in
    one and off in the other. That is the wrong way round for the environment where it matters.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Registering the worker twice runs it twice"</h4>
    <p><code>AddHostedService&lt;T&gt;</code> deduplicates by type. <code>AddSingleton&lt;IHostedService,
    T&gt;</code> does not — and that older spelling is still all over the internet.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Pass the cancellation token to everything"</h4>
    <p>Right for the wait, wrong for the commit. A token on a write says "abandon this halfway through
    if we are stopping", and halfway through a write is where payments vanish.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"<code>await Task.Delay(TimeSpan.FromHours(1))</code> runs it hourly"</h4>
    <p>It runs it every hour <em>plus</em> however long the work takes, and the error accumulates. An
    hourly job doing twenty minutes of work runs every eighty minutes.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Graceful shutdown means no work is lost"</h4>
    <p>It makes the common case tidy. It cannot help when the process is killed, the machine is lost,
    or the timeout expires — so the queue has to be what makes the work safe.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A background worker fails in a way nothing is watching for</h4>
    <p>Every failure mode your monitoring understands belongs to requests: error rates, latency
    percentiles, status codes. A worker that stops produces none of those. In the incident above, a
    service reported perfect health for nineteen days — 412,000 queued items, uptime unbroken, CPU flat
    and low, which is what a graph shows when nothing is happening at all.</p>
  </div>

  <p>The second reason is that a worker inherits none of the request pipeline's safety. A request gets a
  scope that ends, a <code>DbContext</code> that is disposed, an exception that becomes a 500 somebody
  can see, and a timeout that bounds it. A worker gets a token and a loop. <strong>Every one of those
  guarantees is now something you write, and forgetting one produces a bug measured in weeks rather than
  milliseconds.</strong></p>

  <p>The third is that this is the first place in Track 3 where "one process" stops being a useful unit
  of thought. An HTTP handler is naturally safe to run on twenty replicas — that is what makes it a
  handler. A loop that reconciles payments is not, and nothing about <code>AddHostedService</code> hints
  at the difference. The hosting model happily gives you twenty copies of a job that was written on the
  assumption there is one.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A team adds a worker that warms a pricing cache before it starts looping. Deployments now take 90
    seconds longer, and during that time the new instance answers nothing — not even its health checks.
    The rolling deploy takes a replica out and waits.</p>
    <p>The warm-up is genuinely needed. Where should it go?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   where the warm-up runs                     host start   worker useful from
   ----------------------                     ----------   ------------------
   IHostedService.StartAsync                      343 ms               316 ms
   first lines of ExecuteAsync                      9 ms               312 ms</code></pre>
        <p>Both finish warming at roughly the same moment, and only one of them holds the application
        hostage while it happens. The host awaits <code>StartAsync</code>, so warm-up there is downtime:
        the port is not open and an orchestrator doing a rolling deploy sits and waits for each replica
        in turn.</p>
        <p>Which does not mean "always use <code>ExecuteAsync</code>". The real question is <em>what
        should happen to a request that arrives while the cache is cold</em>, and there are three
        defensible answers:</p>
        <ul>
          <li><strong>If it must not be served</strong> — warm in <code>StartAsync</code> and accept the
          startup cost. You have chosen correctness over availability, deliberately.</li>
          <li><strong>If it can be served slowly</strong> — warm in <code>ExecuteAsync</code> and let the
          cache fall through to the database until it is populated.</li>
          <li><strong>If it should wait</strong> — warm in <code>ExecuteAsync</code> and gate
          <em>readiness</em> on the cache being warm. The process starts instantly, health returns 503
          until it is ready, and no traffic is routed to it.</li>
        </ul>
        <p>The third is usually right, and it is the one nobody reaches for, because "block startup"
        looks like the direct expression of "must be warm before traffic".</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>Every deployment hangs for exactly thirty seconds after the new version is up, then completes.
    Nothing is logged during the wait. The number is suspiciously round.</p>
    <p>What is happening, and what does it cost beyond the wait?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   worker's loop                          StopAsync took   work in progress
   -------------                          --------------   ----------------
   ignores the stopping token                    3004 ms   ABANDONED mid-item
   honours the stopping token                       1 ms   finished cleanly</code></pre>
        <p>The round number is <code>HostOptions.ShutdownTimeout</code>, which defaults to thirty
        seconds. (Three seconds in the run above, so the file finishes.) The host asks every hosted
        service to stop, waits, and gives up after the timeout.</p>
        <p>The cost is not the thirty seconds. It is that shutdown stops being a controlled event: work
        in progress is not finished and not rolled back, it is cut off wherever it happens to be.</p>
        <p>There are two places to check the token and you need both. <strong>The loop
        condition</strong> decides whether to start another item. <strong>Every <code>await</code>
        inside it</strong> decides how quickly the current item gives up — a loop that only checks the
        condition still waits for the current iteration, and if that iteration is a sixty-second poll
        you are back at the timeout.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>A job is meant to run at the top of every hour. Over a week it slides later and later; by Friday
    it fires around twenty past. The delay in the loop is exactly one hour.</p>
    <p>Why does it drift, and what fixes it?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   loop style                  fires at (ms from start)              drift
   ----------                  ------------------------              -----
   await Task.Delay(period)       0   154   311   466   621            221 ms
   PeriodicTimer                  0   107   215   307   414             14 ms</code></pre>
        <p>Scaled down to a 100 ms period and 40 ms of work.
        <code>await Task.Delay(period)</code> does not mean "every period" — it means "wait
        <em>period</em> after the work finishes", so each cycle is period plus the work, and the error
        accumulates. At the real scale, an hourly job doing twenty minutes of work runs every eighty
        minutes and loses a run every three cycles.</p>
        <p><code>PeriodicTimer</code> measures tick to tick, so the work happens inside the period
        rather than before it. When the work is longer than the period it does not queue up missed
        ticks — the next <code>WaitForNextTickAsync</code> returns immediately, once. That degrades to
        "run continuously" rather than "run four times to catch up", which is the right failure.</p>
        <p>Neither of these is a schedule. Both drift when the process restarts, both run on every
        replica, and neither knows what "the top of the hour" is. If the requirement is a wall-clock
        time, compute the delay to the next occurrence from the clock rather than counting
        intervals.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>A worker takes a payment off a queue, calls the gateway, and marks it settled. It honours its
    stopping token everywhere, shuts down in milliseconds, and passes every review. After each deploy, a
    handful of payments are neither settled nor on the queue.</p>
    <p>Where did they go?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   what the token is passed to        settled   back on queue   LOST
   ---------------------------        -------   -------------   ----
   everything, including the write          1               0      1
   only the wait for the next item          2               0      0</code></pre>
        <p>The payment was taken off the queue, and the write that would have recorded it was cancelled
        by shutdown. It is not on the queue, because it was taken. It is not settled, because the write
        never happened. Nothing threw and nothing is left to retry.</p>
        <p>The cause is the advice from exercise 2 applied too evenly. A loop has two regions and they
        want opposite things:</p>
        <ul>
          <li><strong>The wait</strong> — blocking for the next item, sleeping between polls. Cancel
          this instantly. It is where shutdown should land, and a worker that spends most of its life
          here shuts down fast.</li>
          <li><strong>The unit of work</strong> — once an item is claimed, up to the point it is durably
          recorded. Finish this. Give it its own deadline if you like, but do not tie it to shutdown,
          and make sure the shutdown timeout allows one item to complete.</li>
        </ul>
        <p>And the deeper fix is to not need the cooperation at all. If the item is only removed from
        the queue once it has been processed — a peek-lock with a visibility timeout, or a transaction
        spanning the read and the write — then a process that dies mid-item loses nothing, because the
        item comes back on its own.</p>
        <p>Which is the real lesson: <strong>graceful shutdown is a nicety and at-least-once delivery is
        a guarantee.</strong> Shutdown handling makes the common case tidy; it cannot help you when the
        process is killed, the machine is lost, or the timeout expires — and those all happen.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Which of a hosted service's constructor, <code>StartAsync</code> and
      <code>ExecuteAsync</code> can delay your web server from listening?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The constructor and <code>StartAsync</code>. The constructor
        because the container resolves the service during startup; <code>StartAsync</code> because the
        host awaits it by contract. <code>ExecuteAsync</code> is handed to the thread pool and is not
        awaited.</p></div>
      </details></li>

    <li><p>Why is <code>await Task.Yield()</code> at the top of an <code>ExecuteAsync</code> a sign of
      older code?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>On .NET 6 and 7, <code>ExecuteAsync</code> ran synchronously up to
        its first await on the startup path, so yielding immediately was the workaround. .NET 8 moved it
        to the thread pool, so on .NET 10 the line does nothing.</p></div>
      </details></li>

    <li><p>What does <code>BackgroundServiceExceptionBehavior.StopHost</code> actually do?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It calls <code>StopApplication()</code>, which fires the
        <code>ApplicationStopping</code> token — a <em>request</em> to shut down. Something must act on
        it. <code>app.Run()</code> does; a test host that called <code>StartAsync</code> does not, so the
        application keeps serving.</p></div>
      </details></li>

    <li><p>A worker stops and there is nothing in the logs. What does that tell you?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>That it <em>returned</em> rather than threw. A throw produces an
        Error log from the host; a return is how a <code>BackgroundService</code> says it has finished,
        so nothing is reported. Look for a <code>catch</code> that swallowed something.</p></div>
      </details></li>

    <li><p>Why can a <code>catch (OperationCanceledException)</code> around a loop end a worker
      permanently?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Cancellation raises one exception type for every cause, so a
        per-item timeout is indistinguishable by type from shutdown. The catch treats it as shutdown and
        returns. A <code>when (stoppingToken.IsCancellationRequested)</code> clause is what
        distinguishes them.</p></div>
      </details></li>

    <li><p>Why does injecting a scoped service into a hosted service fail in development and work in
      production?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>ValidateScopes</code> is on in the Development environment
        and off otherwise. In production the scoped service is resolved once from the root provider and
        held for the process lifetime — a captive dependency.</p></div>
      </details></li>

    <li><p>What is the right question to ask when deciding where a service scope begins and ends?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>What is one unit of work? A scope is the boundary at which state is
        thrown away, so it should match the boundary at which a failure should stop mattering. Per item
        is the default.</p></div>
      </details></li>

    <li><p>What happens if you call <code>AddHostedService&lt;T&gt;()</code> twice for the same
      type?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Nothing — it deduplicates via <code>TryAddEnumerable</code>, so one
        loop runs. <code>AddSingleton&lt;IHostedService, T&gt;()</code> appends instead, and gives you
        two.</p></div>
      </details></li>

    <li><p>Shutdown takes exactly thirty seconds every time. What is that number and what does it
      imply?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>HostOptions.ShutdownTimeout</code>. Hitting it exactly means
        a hosted service never observed its stopping token, so the host waited the full timeout and then
        abandoned it mid-work.</p></div>
      </details></li>

    <li><p>Which parts of a worker's loop should receive the stopping token, and which should not?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The wait should — that is where shutdown should land. The unit of
        work, from claiming an item to durably recording it, should not: cancelling a write mid-flight
        loses the item with no error and nothing to retry.</p></div>
      </details></li>

    <li><p>Why does <code>await Task.Delay(period)</code> drift and <code>PeriodicTimer</code> not?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>Task.Delay</code> waits <em>after</em> the work, so every
        cycle is period plus work and the error accumulates. <code>PeriodicTimer</code> measures tick to
        tick, so the work happens inside the period.</p></div>
      </details></li>

    <li><p>What single addition would have turned nineteen days of silence into a page?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A heartbeat: the loop stamps a timestamp every iteration and a
        readiness check fails when it goes stale. Readiness rather than liveness, because a stalled
        worker is not a wedged process and restarting throws away web traffic being served
        correctly.</p></div>
      </details></li>
  </ol>
</section>
`
});
