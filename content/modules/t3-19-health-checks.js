CSPREP.module({
  id: "t3-19-health-checks",
  minutes: 55,
  updated: "2026-09-06",
  summary: "A forty-second database failover became a nineteen-minute outage, and every step after the first was Ledger's own infrastructure following the instructions it was given. Liveness, readiness and startup measured as three questions with three consequences; six real instances probed by a real prober loop, killed and restarted, with the run that never recovers next to the run that recovers by itself; a configured timeout that does nothing because the check ignores its token; and the shutdown ordering that decides whether a deploy drops requests.",
  terms: ["liveness", "readiness", "startup probe", "health check", "HealthStatus", "Degraded",
    "tags and predicates", "ResultStatusCodes", "failure threshold", "probe interval",
    "correlated failure", "restart loop", "graceful shutdown", "connection draining",
    "cooperative cancellation"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>At 03:12 a database fails over to its replica. It is unreachable for forty seconds — a routine,
  tested event. The service is down for nineteen minutes, and everything after the first minute is done
  by the team's own infrastructure, correctly, following the instructions it was given.</p>

  <p>The instructions were these:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - and it had run untouched for two years"><code>builder.Services.AddHealthChecks()
    .AddCheck("database", () =&gt; CheckDatabase())
    .AddCheck("gateway", () =&gt; CheckGateway());

var app = builder.Build();

app.MapHealthChecks("/health");</code></pre>

  <p>Plus a deployment manifest that points both probes at the same endpoint, because there is one
  endpoint and two fields that want a URL:</p>

  <pre data-lang="text" data-bad="true" data-title="Wrong - and this file is where the incident lives"><code>livenessProbe:
  httpGet:
    path: /health
    port: 8080
  periodSeconds: 5
  failureThreshold: 2

readinessProbe:
  httpGet:
    path: /health
    port: 8080
  periodSeconds: 5
  failureThreshold: 2</code></pre>

  <p>Six real instances, a real prober loop with a failure threshold, and a database that goes away for
  four rounds and comes back:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   round   database   instances up   serving traffic   killed this round
   -----   --------   ------------   ---------------   -----------------
       1   up                    6                 6   -
       2   up                    6                 6   -
       3   DOWN                  6                 0   -
       4   DOWN                  6                 0   6
       5   DOWN                  6                 0   -
       6   DOWN                  6                 0   6
       7   up                    6                 0   -
       8   up                    6                 0   6
      ...
      14   up                    6                 0   6

   restarts over the run          36
   instances serving at the end   0 of 6</code></pre>

  <p>The database came back at round 7 and the fleet did not. Changing exactly one thing — the URL the
  liveness probe reads — produces this instead:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   round   database   instances up   serving traffic   killed this round
   -----   --------   ------------   ---------------   -----------------
       3   DOWN                  6                 0   -
       6   DOWN                  6                 0   -
       7   up                    6                 6   -
      14   up                    6                 6   -

   restarts over the run          0
   instances serving at the end   6 of 6</code></pre>

  <div class="callout callout--note">
    <h4>The bug is not in the C#</h4>
    <p>The endpoints are identical in both runs. What differs is a field in a deployment manifest. That
    is the shape of most health check failures: the code is reasonable, the configuration decides what
    it means, and no code review looks at both.</p>
  </div>
</section>

<section id="three-questions">
  <h2>Three questions, not one</h2>

  <p class="define"><span class="define__term">Liveness</span> "Is this process working, or is it
  wedged?" Asked by the orchestrator. The answer "no" means <em>kill it and start another</em> — that
  is the entire consequence.</p>

  <p class="define"><span class="define__term">Readiness</span> "Should this instance receive traffic
  right now?" Asked by the load balancer. The answer "no" means <em>stop sending requests, and keep
  asking</em>. Nothing is killed.</p>

  <p class="define"><span class="define__term">Startup probe</span> "Has it finished starting?" Asked
  once, at the beginning. Its job is to hold off the other two while a slow start completes.</p>

  <p class="define"><span class="define__term">Failure threshold</span> How many consecutive failed
  probes a prober requires before acting. Combined with the probe interval, it decides how long
  anything takes to take effect.</p>

  <p class="define"><span class="define__term">Probe</span> A request a prober makes to a health
  endpoint. Three independent systems typically probe the same service — the orchestrator, the load
  balancer and the monitoring stack — none of them aware of the others.</p>

  <p class="define"><span class="define__term"><code>HealthCheckResult</code></span> What one check
  returns: a status plus an optional description and data. Built with
  <code>HealthCheckResult.Healthy()</code>, <code>.Degraded()</code> or <code>.Unhealthy()</code>.</p>

  <p class="define"><span class="define__term"><code>Predicate</code></span> The filter on a mapped
  health endpoint deciding which registered checks it runs. An endpoint with no predicate runs
  everything.</p>

  <p class="define"><span class="define__term">Correlated failure</span> Many instances failing at the
  same moment for the same external reason. It is what makes an automated response dangerous: the
  reaction that is safe for one instance is applied to all of them at once.</p>

  <p>The consequence is what makes them different, and it is the only thing that matters when deciding
  what goes in each. A liveness failure destroys a process. A readiness failure moves traffic. One of
  those is reversible in a second and the other costs a warm connection pool and a loaded cache.</p>

  <p>In ASP.NET Core, one set of registrations serves all three, filtered by tag:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>builder.Services.AddHealthChecks()

    // LIVE: depends on nothing outside this process, because the only
    // consequence of failing is a restart, and a restart cannot fix anything
    // outside this process.
    .AddCheck("process", () =&gt; HealthCheckResult.Healthy(), tags: ["live"])

    // STARTUP: has the warm-up finished? Holds off the other two while a slow
    // start completes, so a cold cache is never mistaken for a wedged process.
    .AddCheck("warm-up", () =&gt; lifecycle.Warm
        ? HealthCheckResult.Healthy("Reference data loaded.")
        : HealthCheckResult.Unhealthy("Loading reference data."), tags: ["startup"])

    // READY: can this instance serve a request? Everything a request needs,
    // including the warm-up - not everything that happens to be external.
    .AddCheck("shutting-down", () =&gt; lifecycle.ShuttingDown
        ? HealthCheckResult.Unhealthy("Draining.")
        : HealthCheckResult.Healthy(), tags: ["ready"])

    .AddCheck("warm-up-ready", () =&gt; lifecycle.Warm
        ? HealthCheckResult.Healthy()
        : HealthCheckResult.Unhealthy("Loading reference data."), tags: ["ready"])

    .AddAsyncCheck("database", () =&gt; cache.GetAsync("database",
        token =&gt; database.PingAsync(token)), tags: ["ready"],
        timeout: TimeSpan.FromMilliseconds(500))

    .AddAsyncCheck("payments-gateway", () =&gt; cache.GetAsync("gateway",
        token =&gt; gateway.PingAsync(token)), tags: ["ready"],
        timeout: TimeSpan.FromMilliseconds(500))

    // DEGRADED, NOT UNHEALTHY: search being down makes the service worse, not
    // unusable. Taking the instance out of rotation for it would be a bigger
    // outage than the one it is reacting to.
    .AddAsyncCheck("search-index", async () =&gt;
    {
        HealthCheckResult result = await cache.GetAsync("search", token =&gt; searchIndex.PingAsync(token));

        return result.Status == HealthStatus.Healthy
            ? result
            : HealthCheckResult.Degraded("Search unavailable; browse and payments unaffected.");
    }, tags: ["ready"], timeout: TimeSpan.FromMilliseconds(500));

var app = builder.Build();

// Three endpoints, three predicates, no endpoint without one.
app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = r =&gt; r.Tags.Contains("live")
});

app.MapHealthChecks("/health/startup", new HealthCheckOptions
{
    Predicate = r =&gt; r.Tags.Contains("startup")
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = r =&gt; r.Tags.Contains("ready")
});</code></pre>

  <pre data-lang="console" data-title="01-three-questions.cs output"><code>   database   /health/live   /health/ready   /health (all checks)
   --------   ------------   -------------   --------------------
   up         200 Healthy    200 Healthy     200 Healthy
   DOWN       200 Healthy    503 Unhealthy   503 Unhealthy</code></pre>

  <p>Read the bottom row as three instructions to three different systems. <code>/health/live</code>
  says the process is fine — do not kill it. <code>/health/ready</code> says do not send it traffic.
  And <code>/health</code> says whatever it says to whoever asked, which if that is the liveness probe
  means <em>kill a healthy process because a shared database is down</em>.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - every dependency here is a way to have your processes killed"><code>app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    // A liveness endpoint that runs every registered check, including
    // the ones that reach the database and the payment gateway.
    Predicate = _ =&gt; true
});</code></pre>

  <div class="callout callout--why">
    <h4>The rule that falls out of it</h4>
    <p>A liveness check must never touch anything outside the process. Not the database, not a queue,
    not another service, not DNS. <strong>If the answer can be "no" for a reason that restarting will
    not fix, it does not belong in liveness.</strong></p>
  </div>

  <h3>An analogy, and where it stops working</h3>

  <p>Liveness is a doctor checking for a pulse; readiness is a receptionist asking whether you can see
  patients this afternoon. Both are about the same person and only one of them can have you removed
  from the building.</p>

  <p>Where it stops is that the doctor here is automated, has no judgement, and acts on every instance
  simultaneously. A human presented with "all twenty patients have no pulse at the same instant" would
  question the stethoscope. An orchestrator has no way to; each instance is evaluated alone, so
  "everything is broken" is indistinguishable from "this one is broken".</p>
</section>

<section id="degraded">
  <h2>Degraded, and the status code it produces</h2>

  <p class="define"><span class="define__term">HealthStatus</span> The three possible results of a
  check: <code>Healthy</code>, <code>Degraded</code>, <code>Unhealthy</code>. Aggregation takes the
  worst — one unhealthy check among twenty makes the endpoint unhealthy.</p>

  <pre data-lang="console" data-title="01-three-questions.cs output"><code>   check result   endpoint     status   body
   ------------   --------     ------   ----
   Healthy        /h           200 Healthy
   Degraded       /d           200 Degraded
   Unhealthy      /u           503 Unhealthy
   Degraded       /d-strict    503 Degraded</code></pre>

  <p><strong>Degraded returns 200 by default.</strong> A load balancer sees 200 and keeps sending
  traffic, which is right: degraded means "working, but not well", and removing the instance for that
  is usually worse than leaving it in.</p>

  <p>Which makes degraded a signal for humans rather than for routing — a cache that is cold, a replica
  that is lagging, a non-essential dependency that is slow. If you want it to shed traffic, say so
  explicitly:</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - when degraded should mean something else here"><code>app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = r =&gt; r.Tags.Contains("ready"),
    ResultStatusCodes =
    {
        [HealthStatus.Healthy] = StatusCodes.Status200OK,
        [HealthStatus.Degraded] = StatusCodes.Status503ServiceUnavailable,
        [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable
    }
});</code></pre>

  <p>It is per-endpoint, which is right: "degraded" may mean "keep serving" to a load balancer and "do
  not promote this deployment" to a release pipeline.</p>

  <div class="callout callout--gotcha">
    <h4>Every check you add to readiness is a new way to lose the instance</h4>
    <p>The worst result wins. A readiness endpoint with twelve checks has twelve independent ways to
    take the instance out of rotation, and each was added by somebody who was thinking about
    observability rather than about routing.</p>
  </div>
</section>

<section id="what-it-costs">
  <h2>What a health check costs</h2>

  <p class="define"><span class="define__term">Probe interval</span> How often a prober asks.</p>

  <p class="define"><span class="define__term">Cooperative cancellation</span> The .NET convention that
  a timeout signals a <code>CancellationToken</code> and the work decides whether to notice. Work that
  never observes the token is not cancelled by it.</p>

  <p class="define"><span class="define__term"><code>AddCheck</code> /
  <code>AddAsyncCheck</code></span> Register a check as a delegate; <code>AddCheck&lt;T&gt;</code>
  registers a class implementing <code>IHealthCheck</code>, which is how a check receives the
  <code>CancellationToken</code> the framework's timeout cancels.</p>

  <pre data-lang="console" data-title="02-what-it-costs.cs output"><code>   instances   probe every   probers   queries per day from health checks
   ---------   -----------   -------   ---------------------------------
           3          10 s         1         25,920   small service, one prober
          20           5 s         1        345,600   one prober
          20           5 s         3      1,036,800   orchestrator + load balancer + monitoring
          60           2 s         3      7,776,000   large fleet, aggressive intervals</code></pre>

  <p>The third row is the ordinary case: over a million queries a day that no user asked for. And the
  cost lands where you can least afford it — a struggling dependency makes checks slower while probes
  keep arriving at the same rate. <strong>A health check is a load source that does not back off.</strong></p>

  <h3>Timeouts, and the one that does nothing</h3>

  <pre data-lang="console" data-title="02-what-it-costs.cs output"><code>   how the check is written                   probe took   status   result
   ------------------------                   ----------   ------   ------
   no timeout at all                             2047 ms   200      Healthy
   timeout: set, token ignored                   2022 ms   200      Healthy
   timeout: set, token passed through             264 ms   503      Unhealthy
   its own CancellationTokenSource                260 ms   503      Unhealthy</code></pre>

  <p>The second row is the finding. A timeout <em>was</em> configured on that check and the probe still
  took two seconds, because the framework's timeout is cooperative: it cancels a
  <code>CancellationToken</code> and hands it to your check. Work that never looks at the token runs to
  completion.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the timeout is decoration"><code>.AddAsyncCheck("dependency", async () =&gt;
{
    // No token, so the configured timeout below can never take effect.
    await dependency.PingAsync();

    return HealthCheckResult.Healthy();
}, tags: ["ready"], timeout: TimeSpan.FromMilliseconds(250));</code></pre>

  <p>The version that works forwards the token it was given:</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - the token reaches the work, so the timeout binds"><code>sealed class DatabaseCheck(IDatabase database) : IHealthCheck
{
    public async Task&lt;HealthCheckResult&gt; CheckHealthAsync(HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await database.PingAsync(cancellationToken);

            return HealthCheckResult.Healthy();
        }
        catch (OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy("Did not answer in time.");
        }
    }
}</code></pre>

  <div class="callout callout--warn">
    <h4>A configured-but-ineffective timeout is worse than none</h4>
    <p>Somebody read that line in review and concluded the check was bounded. It is not, and the way to
    find out is to make the dependency slow and watch whether the probe returns quickly.</p>
  </div>

  <p>What unbounded actually costs is more than the seconds it shows. The prober has its own timeout
  and will give up — and <em>a probe that times out counts as a failure</em>, so an unbounded check
  does not report "slow", it reports "unhealthy" with nothing anywhere saying why. Meanwhile the
  request is still running on your server, and probes keep arriving on schedule, so a check slower than
  the probe interval accumulates concurrent executions against the dependency that is already
  struggling.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a real query, on every probe, from every instance"><code>.AddAsyncCheck("database", async () =&gt;
{
    // A representative query, so the check is 'meaningful'. It is also
    // several hundred thousand executions a day that no user asked for.
    List&lt;Payment&gt; recent = await repository.GetRecentPaymentsAsync(100);

    return recent.Count &gt; 0
        ? HealthCheckResult.Healthy()
        : HealthCheckResult.Unhealthy("No recent payments.");
}, tags: ["ready"]);</code></pre>

  <p>That check is also wrong in a second way worth naming: it reports unhealthy on a quiet night. A
  check should verify that the dependency <em>answers</em>, not that the data says something.</p>

  <h3>Caching, which fixes both problems</h3>

  <pre data-lang="console" data-title="02-what-it-costs.cs output"><code>   endpoint     probes   times the dependency was actually asked
   --------     ------   ---------------------------------------
   /uncached        30   30
   /cached          30   1</code></pre>

  <p>The implementation is short, and the second lock is the part that matters:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// Serves one computed result per key for a window, and lets only one
// computation per key run at a time. The second property is what stops a slow
// dependency accumulating in-flight checks.
sealed class CachedChecks(TimeSpan window)
{
    readonly Dictionary&lt;string, (HealthCheckResult Result, DateTime At)&gt; entries = [];
    readonly SemaphoreSlim gate = new(1, 1);

    public async Task&lt;HealthCheckResult&gt; GetAsync(string key,
        Func&lt;CancellationToken, Task&lt;HealthCheckResult&gt;&gt; compute)
    {
        lock (entries)
        {
            if (entries.TryGetValue(key, out var entry) &amp;&amp; DateTime.UtcNow - entry.At &lt; window)
            {
                return entry.Result;
            }
        }

        await gate.WaitAsync();

        try
        {
            lock (entries)
            {
                if (entries.TryGetValue(key, out var entry) &amp;&amp; DateTime.UtcNow - entry.At &lt; window)
                {
                    return entry.Result;
                }
            }

            // The compute gets its own deadline as well, so a dependency that
            // never answers cannot hold the gate indefinitely.
            using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(400));

            HealthCheckResult result;

            try
            {
                result = await compute(cts.Token);
            }
            catch (OperationCanceledException)
            {
                result = HealthCheckResult.Unhealthy("Did not answer within 400 ms.");
            }

            lock (entries)
            {
                entries[key] = (result, DateTime.UtcNow);
            }

            return result;
        }
        finally
        {
            gate.Release();
        }
    }</code></pre>

  <p>The staleness is smaller than it looks: a cache window shorter than the probe interval means every
  prober still gets a fresh answer. And there is a second benefit that matters more under failure —
  <strong>the cache bounds concurrency</strong>. One execution is in flight and everyone else waits for
  the same answer, so load on a struggling dependency stops growing exactly when it needs to.</p>
</section>

<section id="what-it-reveals">
  <h2>What the endpoint tells whoever asks</h2>

  <p>The default body is one word. The detailed response people add when they want to see which check
  failed is this:</p>

  <pre data-lang="console" data-title="02-what-it-costs.cs output"><code>   GET /health
     Unhealthy

   GET /health/detail
     {
       "status": "Unhealthy",
       "checks": [
         {
           "name": "sql-primary",
           "status": "Unhealthy",
           "description": "A network-related or instance-specific error occurred while
                           establishing a connection to SQL Server:
                           ledger-prod-01.internal,1433 (user: ledger_app)"
         },
         {
           "name": "payments-gateway",
           "status": "Degraded",
           "description": "https://gateway.internal.example.com/v3 responded in 4200 ms"
         }
       ]
     }</code></pre>

  <p>Internal hostname, database port, the application's SQL username, and the payment gateway's
  internal URL — on an endpoint that is almost always unauthenticated, because the prober cannot
  authenticate.</p>

  <p>Nobody decided to publish that. The descriptions come from exception messages, and exception
  messages are written to help an operator with a debugger.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - publishes an inventory of your infrastructure"><code>app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =&gt;
    {
        context.Response.ContentType = "application/json";

        await context.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            status = report.Status.ToString(),
            checks = report.Entries.Select(e =&gt; new
            {
                name = e.Key,
                status = e.Value.Status.ToString(),

                // Exception messages, written for an operator with a
                // debugger, served to anything that can reach the port.
                description = e.Value.Description,
                exception = e.Value.Exception?.ToString()
            })
        }));
    }
});</code></pre>

  <div class="callout callout--why">
    <h4>Separate the two audiences</h4>
    <p>The <strong>probe</strong> gets the plain endpoint — a status code, one word. A prober reads the
    status code and ignores the body anyway. The <strong>operator</strong> gets detail from logs and
    metrics, which are already authenticated and already where they are looking. Emit one log line per
    failed check and one gauge per check, and the detailed endpoint stops being necessary.</p>
  </div>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <p>One service with every decision made deliberately, exercised through six states:</p>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   scenario                          live           startup        ready
   --------                          ----           -------        -----
   starting, cache not loaded        200 Healthy    503 Unhealthy  503 Unhealthy
   warm, everything up               200 Healthy    200 Healthy    200 Healthy
   search index down                 200 Healthy    200 Healthy    200 Degraded
   database down                     200 Healthy    200 Healthy    503 Unhealthy
   database very slow                200 Healthy    200 Healthy    503 Unhealthy
   SIGTERM received                  200 Healthy    200 Healthy    503 Unhealthy

   and a real request during shutdown   200

   30 readiness probes cost 1 database round trips</code></pre>

  <p>Every row is a decision:</p>

  <ul>
    <li><strong>Liveness is 200 throughout.</strong> The process is fine in all six states. Restarting
    it would discard a warm connection pool in exchange for nothing.</li>
    <li><strong>Search being down is <code>Degraded</code>, and the instance keeps taking
    traffic.</strong> The service works without search. A check that removes an instance for a
    non-essential dependency turns a small outage into a total one.</li>
    <li><strong>A very slow database produces a fast 503</strong>, because the check has a timeout and
    passes its token through.</li>
    <li><strong>Readiness fails on SIGTERM while requests still succeed.</strong> That is the shutdown
    sequence below.</li>
    <li><strong>Thirty probes cost one round trip.</strong></li>
  </ul>

  <div class="callout callout--note">
    <h4>Half of this configuration is not in this file</h4>
    <p>Three endpoints are worth nothing if the manifest points all three probes at the same one. The
    deployment configuration is where this module's failures live, and it is reviewed by different
    people, in a different repository, at a different time.</p>
  </div>
</section>

<section id="shutdown">
  <h2>Shutdown, where the ordering matters</h2>

  <p class="define"><span class="define__term">Graceful shutdown</span> Finishing the requests already
  accepted before the process exits. It says nothing about requests still being <em>sent</em> to
  you.</p>

  <p class="define"><span class="define__term">SIGTERM</span> The signal an orchestrator sends to ask a
  process to stop. It is a request; <code>SIGKILL</code>, which arrives when the grace period expires,
  is not.</p>

  <p class="define"><span class="define__term">Grace period</span> How long the orchestrator waits
  between SIGTERM and SIGKILL. Every step of your shutdown sequence has to fit inside it.</p>

  <p class="define"><span class="define__term">Draining</span> Continuing to serve accepted requests
  while refusing to accept new ones, so that nothing in flight is lost.</p>

  <p>A service that drains correctly still drops requests on every deploy, and the timeline says
  why:</p>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   without a shutdown delay:
     t+0.0s   SIGTERM. Readiness starts failing. Process begins stopping.
     t+0.1s   Process has stopped accepting connections.
     t+2.0s   Load balancer's next probe fails.
     t+4.0s   Load balancer reaches its failure threshold and stops routing here.

              EVERY REQUEST SENT BETWEEN t+0.1 AND t+4.0 HITS A SOCKET
              THAT IS NO LONGER LISTENING.

   with a shutdown delay:
     t+0.0s   SIGTERM. Readiness starts failing. Process KEEPS SERVING.
     t+2.0s   Load balancer's next probe fails.
     t+4.0s   Load balancer stops routing here. No new requests arrive.
     t+8.0s   Delay elapses. In-flight requests have finished. Stop.</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - correct draining, and requests are still lost"><code>// The service handles SIGTERM and drains in-flight requests. Nothing
// tells the load balancer to stop sending new ones until its next probe
// fails, by which time the socket is already closed.
app.Lifetime.ApplicationStopping.Register(() =&gt; lifecycle.ShuttingDown = true);

app.Run();</code></pre>

  <p>So the shutdown sequence has an order, and every step is needed: <strong>fail readiness
  immediately</strong> on SIGTERM; <strong>keep serving</strong> for longer than the load balancer
  takes to notice (probe interval × failure threshold, plus a margin — a number you look up, not one
  you guess); <strong>then</strong> stop accepting and drain; and make sure the orchestrator's grace
  period is longer than all of that, or SIGKILL arrives in the middle.</p>

  <div class="callout callout--why">
    <h4>The general shape, which is worth more than the recipe</h4>
    <p>A health check is an asynchronous message to a system that polls. Everything it tells anyone
    arrives late, by up to one probe interval times one failure threshold. Every design that assumes a
    status change takes effect immediately is wrong by that amount — and at shutdown, that error is
    measured in dropped requests.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Liveness that touches a shared dependency</h3>

  <p>The incident. Every instance depends on the same database, so every instance fails on the same
  round; nothing is staggered and nothing is left running. And the response makes it worse — a restart
  is the most expensive thing you can do to a struggling database.</p>

  <p>The measured run adds a second mechanism that makes it permanent: <strong>a replacement takes
  three rounds to warm up and the kill threshold is two</strong>. A fresh instance fails the combined
  check twice while loading, hits the threshold, and is killed before it can ever pass. That loop does
  not need the database to be down — it only needed the database to be down once, to knock the warm
  instances over.</p>

  <div class="callout callout--gotcha">
    <h4>Which is exactly what a startup probe prevents</h4>
    <p>A startup probe suspends liveness until the instance has warmed up once, so a slow start can
    never be mistaken for a wedged process. Its absence is why forty seconds became nineteen
    minutes.</p>
  </div>

  <h3><code>AddHealthChecks()</code> with no checks registered</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   request      status   body
   -------      ------   ----
   GET /health  200 Healthy
   GET /work    500 {"type":"https://too...</code></pre>

  <p>The aggregate of an empty set is healthy. It is not broken; it is answering a question nobody
  meant to ask — and the question it answers, "did a request reach this process and get routed", is a
  perfectly good <em>liveness</em> check that has been pointed at a load balancer.</p>

  <h3>An untagged check added later</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   search index   /health/live   /health/ready   /health
   ------------   ------------   -------------   -------
   up             200 Healthy    200 Healthy     200 Healthy
   DOWN           200 Healthy    200 Healthy     503 Unhealthy</code></pre>

  <p>An untagged check matches neither predicate, so it is <em>missing</em> from readiness where it was
  wanted and <em>present</em> on the untagged default endpoint where it was not. Both directions wrong
  at once.</p>

  <h3>Readiness that checks dependencies rather than capability</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   after start   /ready-as-configured   /ready-complete   GET /work
   -----------   --------------------   ---------------   ---------
           0 ms   200 Healthy            503 Unhealthy     500 {"type":"https://too
         214 ms   200 Healthy            503 Unhealthy     500 {"type":"https://too
         530 ms   200 Healthy            200 Healthy       200 {"result":"ok"}</code></pre>

  <p>The check verifies the database, which was never the slow part. Readiness is not asking "are my
  dependencies up" — it is asking <strong>can I serve a request</strong>, and an unloaded cache makes
  the answer no every bit as surely as a dead database.</p>

  <h3>A detailed body on an unauthenticated endpoint</h3>

  <p>Covered above. Hostnames, ports and usernames, published by exception messages nobody wrote for
  publication.</p>

  <h3>No timeout, or a timeout nothing observes</h3>

  <p>Measured above. The check that ignores its token runs to completion regardless of what the
  registration says.</p>

  <h3>Probing without caching</h3>

  <p>A million queries a day at ordinary fleet sizes, and unbounded concurrency against a dependency
  precisely when it is struggling.</p>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <ol>
    <li><strong>Read the deployment manifest before the code.</strong> Which URL does each probe read?
    This is where the incident lives, and it is not in the C#.</li>
    <li><strong>For every check on liveness, ask: would restarting this process fix it?</strong> A
    database down: no. A queue unreachable: no. DNS: no. A deadlock in your own code, an exhausted
    thread pool, a wedged background loop: yes — and those are the only things liveness is for.</li>
    <li><strong>List which checks each endpoint actually runs.</strong> Enumerate the registrations and
    apply each predicate. Untagged checks and unpredicated endpoints are where the surprises are.</li>
    <li><strong>Make a dependency slow and watch whether the probe returns quickly.</strong> If it does
    not, your timeout is decoration.</li>
    <li><strong>Ask when the endpoint last returned 503.</strong> A health check that has never failed
    has never been tested; if you cannot say when it last failed, you do not know that it can.</li>
  </ol>

  <div class="callout callout--debug">
    <h4>Four things to watch</h4>
    <ul>
      <li><strong>Restart counts, not only error rates.</strong> A restart count that rises across the
      whole fleet at once is this failure and almost nothing else. It is the earliest unambiguous
      signal and most teams do not graph it.</li>
      <li><strong>Correlated readiness.</strong> One instance unready is a bad instance. Every instance
      unready in the same second is a shared dependency, and the two want completely different
      responses from a human.</li>
      <li><strong>Health check duration, as a distribution.</strong> A check drifting toward the probe
      timeout is a restart loop with a date on it.</li>
      <li><strong>Requests that arrive after readiness starts failing.</strong> If that number is not
      zero at deploy time, your shutdown delay is shorter than your load balancer's reaction time.</li>
    </ul>
  </div>

  <p>And test the failover with the probes attached. Ledger had tested the database failover — against
  a service that was not being probed by an orchestrator with a kill threshold. <strong>The dependency
  failure was handled correctly; the reaction to it was never tested.</strong></p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"One health endpoint is enough"</h4>
    <p>Three questions with three consequences. One endpoint means the orchestrator's kill decision and
    the load balancer's routing decision are made from the same number.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A thorough liveness check is a good liveness check"</h4>
    <p>Backwards. Every dependency you add to liveness is a new way for something external to have your
    processes destroyed. The ideal liveness check verifies that the process can serve a request and
    nothing else.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"<code>AddHealthChecks()</code> gives me a health check"</h4>
    <p>It gives you an endpoint. With no registrations it reports the aggregate of an empty set, which
    is healthy, forever.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Degraded takes the instance out of rotation"</h4>
    <p>Degraded returns 200 by default and traffic keeps flowing — which is usually right. If you want
    it to shed traffic, configure <code>ResultStatusCodes</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Setting <code>timeout:</code> bounds the check"</h4>
    <p>Only if the check observes the token it is handed. Measured: a check ignoring its token ran for
    two seconds under a 250 ms timeout.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Graceful shutdown means no requests are dropped"</h4>
    <p>It finishes the requests you have accepted. Requests still being sent to you keep arriving until
    the load balancer notices, which takes probe interval × failure threshold.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"The detailed health endpoint is internal"</h4>
    <p>It is reachable by anything that can reach the port, and probers cannot authenticate, so it is
    usually open. It publishes an inventory of your dependencies with hostnames.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A health check is the only code in your service that can destroy your service</h4>
    <p>Every other endpoint returns a wrong answer when it is wrong. This one instructs your
    infrastructure, and the infrastructure obeys, at fleet scale, faster than a human can intervene.
    A bug here does not degrade the service — it removes it, and then prevents it coming back.</p>
  </div>

  <p>The second reason is that health checks are where correlated failure becomes visible. Most
  resilience thinking is about one thing failing. Health checks fail <em>together</em>, because every
  instance shares the dependency being checked, and any response that is safe for one instance may be
  catastrophic applied to all of them at once. That is a general property of automated remediation and
  this is the cheapest place to learn it.</p>

  <p>The third is that this is the clearest case in the curriculum of a defect that lives between two
  artefacts. The C# is correct. The manifest is correct in isolation. The bug exists only in their
  combination, which is owned by two teams and reviewed in two places. <strong>Knowing which questions
  the code answers and which the configuration answers is most of the skill.</strong></p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A service returns 500 on every request because its database is unreachable. <code>/health</code>
    returns 200 Healthy throughout, the load balancer keeps sending traffic, and the dashboard shows a
    healthy service. The health check code is two lines and looks correct.</p>
    <p>What is wrong?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   request      status   body
   -------      ------   ----
   GET /health  200 Healthy
   GET /work    500 {"type":"https://too...</code></pre>
        <p><code>AddHealthChecks()</code> with no arguments registers no checks. The endpoint reports
        the aggregate of an empty set, and the aggregate of nothing is healthy.</p>
        <p>What it does prove is that a request reached this process, was routed, and produced a
        response — which is exactly the question a liveness probe asks. So this is a perfectly good
        liveness check that has been pointed at a load balancer.</p>
        <p>The fix is not "add a database check to <code>/health</code>". It is to decide which question
        this endpoint answers and add a second endpoint for the other one. Putting the database check on
        the endpoint the liveness probe reads is the incident.</p>
        <p>The smell to remember: <strong>a health check that has never failed has never been
        tested.</strong> If you cannot say when it last returned 503, you do not know that it can.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A team splits liveness and readiness properly, with tags and predicates. Six months later someone
    adds a check for a new dependency. A week after that, a blip in that dependency restarts the whole
    fleet. The predicates were not changed.</p>
    <p>What happened?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   search index   /health/live   /health/ready   /health
   ------------   ------------   -------------   -------
   up             200 Healthy    200 Healthy     200 Healthy
   DOWN           200 Healthy    200 Healthy     503 Unhealthy</code></pre>
        <p>The new check has no tags, so it matches neither predicate — the readiness endpoint does
        <em>not</em> know about the dependency, and the untagged default endpoint does. The restart came
        from <code>/health</code>, still mapped, still being probed by something: a monitoring system,
        an old load balancer rule, or a liveness probe on a deployment nobody updated when the split was
        introduced.</p>
        <p>Two lessons. <strong>An untagged check is not "on every endpoint"</strong> — it is on every
        endpoint whose predicate happens to admit it, which is the ones with no predicate. That is the
        opposite of what the author expected, in both directions at once.</p>
        <p>And <strong>an unused endpoint that is still mapped is still load-bearing.</strong> The team
        believed <code>/health</code> was legacy. Deleting the mapping would have turned a silent
        misconfiguration into an immediate 404 somebody would have chased.</p>
        <p>The fix is a convention rather than a code change: every check is tagged, and no endpoint is
        without a predicate. Then adding a check without deciding where it belongs puts it nowhere,
        which is visible.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>Every deploy produces a burst of 500s that clears on its own within half a minute. The team has
    learned to deploy at night and calls it "the usual deploy noise". Readiness is configured and
    passing.</p>
    <p>Where do the errors come from?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   after start   /ready-as-configured   /ready-complete   GET /work
   -----------   --------------------   ---------------   ---------
           0 ms   200 Healthy            503 Unhealthy     500 {"type":"https://too
         214 ms   200 Healthy            503 Unhealthy     500 {"type":"https://too
         530 ms   200 Healthy            200 Healthy       200 {"result":"ok"}
         748 ms   200 Healthy            200 Healthy       200 {"result":"ok"}</code></pre>
        <p>Readiness passes before the service can serve. The check verifies the database, which was
        never the slow part; the slow part is the reference data the handlers need, and nothing checks
        it. So the load balancer is told to send traffic to an instance that will 500 on every
        request.</p>
        <p>The rule this breaks: <strong>readiness must cover everything a request needs, not everything
        that is external.</strong> The instinct is to check dependencies, because dependencies are what
        fail. But readiness is asking "can I serve a request", and an unloaded cache makes the answer no
        every bit as surely as a dead database.</p>
        <p>The test that finds these: for each check, name a request that would fail if it failed. Then
        go the other way — for each way a request can fail, name the check that covers it. The second
        direction is the one nobody does, and it is where the gaps are.</p>
        <p>And "the usual deploy noise" is a smell in itself. A recurring error burst that clears on its
        own has a mechanism, and a team that has named it rather than found it has stopped looking.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>A different service, correctly configured for startup. It still produces a burst of failed
    requests on every deploy — but the failures are connection resets rather than 500s, and they happen
    as instances are being <em>removed</em>. The service handles SIGTERM and drains in-flight requests
    correctly.</p>
    <p>Where do the resets come from?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   moment                              /health/ready   GET /work
   ------                              -------------   ---------
   steady state                        200 Healthy     200 {"result":"ok"}
   SIGTERM received, still serving     503 Unhealthy   200 {"result":"ok"}</code></pre>
        <p>Draining in-flight requests is the second half of the problem and the team only solved that
        one. Graceful shutdown finishes the requests you have <em>already accepted</em>. It does nothing
        about the requests still being <em>sent</em> to you, because the load balancer has not noticed —
        and it cannot notice faster than its probe interval times its failure threshold.</p>
        <p>So the sequence has an order: fail readiness immediately on SIGTERM; keep serving for longer
        than the load balancer takes to notice; <em>then</em> stop accepting and drain; and make sure
        the orchestrator's grace period is longer than all of it, or SIGKILL arrives mid-drain.</p>
        <p>The general shape is worth more than the recipe: <strong>a health check is an asynchronous
        message to a system that polls.</strong> Everything it tells anyone arrives late, by up to one
        probe interval times one threshold. Every design that assumes a status change takes effect
        immediately is wrong by that amount, and at shutdown that error is measured in dropped
        requests.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is the consequence of a liveness failure, and of a readiness failure?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Liveness: the process is killed and replaced. Readiness: traffic
        stops being routed to it, and the prober keeps asking. One destroys warm state; the other is
        reversible in one probe interval.</p></div>
      </details></li>

    <li><p>State the rule about what may appear in a liveness check, and the question that tests
      it.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Nothing outside the process. The test is "would restarting this
        process fix it?" — a database, a queue, DNS: no. A deadlock, an exhausted thread pool, a wedged
        background loop: yes.</p></div>
      </details></li>

    <li><p>Why does pointing the liveness probe at an endpoint that checks a shared database take down
      a whole fleet rather than one instance?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The failure is correlated — every instance depends on the same
        database, so every instance fails on the same probe. Nothing is staggered, and restarting them
        all is the most expensive thing you can do to a struggling database.</p></div>
      </details></li>

    <li><p>In the measured run, why did the fleet not recover when the database came back?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A replacement takes three rounds to warm up and the kill threshold
        is two, so each fresh instance is killed before it can pass. The loop no longer needs the
        database to be down — which is exactly what a startup probe prevents.</p></div>
      </details></li>

    <li><p>What does <code>AddHealthChecks()</code> with no registrations report, and why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Healthy, forever. It reports the aggregate of an empty set. It is
        a valid liveness check — it proves a request was routed and answered — pointed at the wrong
        prober.</p></div>
      </details></li>

    <li><p>What HTTP status does a <code>Degraded</code> result produce by default, and is that
      right?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>200. Usually right: degraded means working but not well, and
        removing the instance is often worse than leaving it in. Change it per-endpoint with
        <code>ResultStatusCodes</code> when you want it to shed traffic.</p></div>
      </details></li>

    <li><p>Why can a check registered with <code>timeout:</code> still run for two seconds?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The timeout is cooperative — it cancels a token and hands it to
        the check. Work that never observes the token runs to completion, so the configured timeout does
        nothing.</p></div>
      </details></li>

    <li><p>Beyond saving queries, what does caching a health check result buy you under failure?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It bounds concurrency. Without it, a check that becomes slow is
        executed by every arriving probe at once, so load on the struggling dependency grows exactly
        when it must not.</p></div>
      </details></li>

    <li><p>What happens to an untagged check when every endpoint has a predicate?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It runs on no endpoint. That is the desirable failure — visible
        and harmless — compared with landing on an unpredicated default endpoint that something is
        still probing.</p></div>
      </details></li>

    <li><p>Readiness should cover what, exactly?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Everything a request needs, not everything that is external. An
        unloaded cache or an incomplete warm-up makes the answer "cannot serve" every bit as surely as a
        dead database.</p></div>
      </details></li>

    <li><p>Why does a correctly-draining service still drop requests at shutdown?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Draining covers requests already accepted. New requests keep
        arriving until the load balancer notices readiness failing, which takes probe interval ×
        failure threshold. The process must outlive that window.</p></div>
      </details></li>

    <li><p>Why is the detailed health response a security decision rather than a formatting one?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Its descriptions come from exception messages, which carry
        hostnames, ports and usernames — published on an endpoint that is usually unauthenticated,
        because probers cannot authenticate.</p></div>
      </details></li>
  </ol>
</section>
`
});
