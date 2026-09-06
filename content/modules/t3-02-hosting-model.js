CSPREP.module({
  id: "t3-02-hosting-model",
  minutes: 55,
  updated: "2026-09-02",
  summary: "Ledger loses settlement notifications on every deploy and nothing in the sending code is wrong. Measured here: a worker that ignores the stopping token takes 2.5x as much work as it can finish and loses a batch anyway; one that honours it stops in 2 ms and still loses the batch in its hand; only one that finishes the work it has already taken loses nothing. Plus the ordering most people get backwards - your hosted services start BEFORE Kestrel opens the port, so a slow StartAsync means the port never opens at all.",
  terms: ["host", "WebApplication", "WebApplicationBuilder", "service collection",
    "service provider", "container", "registration", "Build", "pipeline", "middleware",
    "scope", "singleton", "scoped", "transient", "ValidateScopes", "ValidateOnBuild",
    "IHostedService", "BackgroundService", "IHostApplicationLifetime", "ApplicationStopping",
    "graceful shutdown", "ShutdownTimeout", "SIGTERM", "preStop hook", "liveness", "readiness"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger deploys twelve times a week. After every release, support gets a handful of tickets with
  the same shape: a payment settled, the money moved, and the customer never received the
  notification.</p>

  <p>It is never the same payment twice. It is always within a minute of a release. It cannot be
  reproduced on demand. The notification service has no errors in its logs for those payments — it has
  no entries for them at all.</p>

  <p>The code that sends notifications is fine. Nobody can find a bug in it because there is not one.
  What is wrong is <strong>what happens to that code when the process is asked to stop</strong>, and
  that is not written anywhere in the notification logic. It is a property of the host.</p>

  <p>Here are three versions of the same worker, given the same work and shut down at the same moment.
  The send logic is byte-for-byte identical in all three:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   version                             taken   sent   LOST   shutdown
   -------                             -----   ----   ----   --------
   v1 ignores the stopping token         110    105      5     415 ms
   v2 honours it, drops its batch         40     35      5       2 ms
   v3 honours it, flushes on stop         45     45      0       0 ms</code></pre>

  <p>The middle row is the one that survives code review. Somebody noticed the missing cancellation
  token, added it, the deploys got two hundred times faster — and the tickets kept arriving.</p>

  <p>This module is about the layer those differences live in: <strong>the host</strong>. What runs
  when, in what order, and what happens to all of it when the process is told to stop.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every ordering, count and timestamp in this module was produced by running the programs shown
    and pasted in unedited. Where a number is machine-specific it is labelled as such; the orderings
    are deterministic and are the point.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What a host is</h2>

  <p class="define"><span class="define__term">Process</span> One running program, as the operating
  system sees it. It has its own memory, and when it ends everything in that memory is gone. A deploy
  ends one process and starts another.</p>

  <p class="define"><span class="define__term">Host</span> The object that owns everything long-lived
  in your process: configuration, logging, the dependency container, background work, and the web
  server itself. It starts them in a defined order, keeps them running, and stops them in a defined
  order.</p>

  <p>You have written a host already, whether or not you called it that. This is the whole thing:</p>

  <pre data-lang="csharp" data-net="10" data-title="The shape every ASP.NET Core program has"><code>var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton&lt;IPaymentGateway, StripeGateway&gt;();

var app = builder.Build();

app.MapGet("/payments/{id}", (string id) =&gt; Results.Ok(new { id }));

app.Run();</code></pre>

  <p>Four lines of structure. Almost every hosting bug comes from not knowing what happens between
  them.</p>

  <h3>The vocabulary</h3>

  <p class="define"><span class="define__term">Dependency injection</span> Giving an object the things
  it needs through its constructor, rather than having it create them. A class that takes an
  <code>IPaymentGateway</code> parameter does not know or care which implementation it gets.</p>

  <p class="define"><span class="define__term">Service collection</span> A <em>list of
  registrations</em> — "when something asks for <code>IPaymentGateway</code>, give it a
  <code>StripeGateway</code>". It is a list, nothing more. <code>builder.Services</code> is one.</p>

  <p class="define"><span class="define__term">Service provider, or container</span> The object built
  <em>from</em> that list, which actually constructs things when asked. It is created by
  <code>Build()</code>.</p>

  <p class="define"><span class="define__term">Middleware</span> A piece of code that sits in the path
  of every request, does something, and passes the request along. Logging, authentication and
  exception handling are all middleware.</p>

  <p class="define"><span class="define__term">Pipeline</span> The chain of middleware a request
  passes through on its way to your endpoint and back. <code>app.Use(...)</code> adds to it.</p>

  <p class="define"><span class="define__term">Hosted service</span> Something the host starts when
  the application starts and stops when it stops, independently of any request. A queue consumer, a
  timer, a cache refresher.</p>

  <p class="define"><span class="define__term">Cancellation token</span> A small object passed into a
  long-running operation that can be signalled to say "stop". The operation has to check it; nothing
  forces it to, which is why ignoring one is possible at all.</p>

  <p class="define"><span class="define__term">Orchestrator</span> The system that decides which of
  your processes run on which machines, and starts and stops them — Kubernetes is the common one. It
  is what sends the signal that begins a shutdown.</p>

  <p class="define"><span class="define__term">Load balancer</span> The thing in front of your
  processes that decides which one each incoming request goes to. It learns that a process has gone
  away by asking it, or by failing to reach it, and either way it learns late.</p>

  <p class="define"><span class="define__term">Probe</span> A request the orchestrator makes to your
  process on a schedule to ask how it is. A <strong>liveness</strong> probe asks "is this process
  broken?", and a failure restarts it. A <strong>readiness</strong> probe asks "should traffic be sent
  here?", and a failure removes it from rotation without restarting it. They are different questions
  with different remedies, and confusing them causes outages.</p>

  <h3>The analogy, and where it breaks</h3>

  <p>A host is like a theatre's stage manager. Before the doors open they check that the lights work,
  the cast is present and the props are set. Then the doors open and the show runs. At the end they
  bring the curtain down in a fixed order — actors off, lights down, doors locked — rather than
  cutting the power.</p>

  <p><strong>This is an analogy and it misleads in one specific way.</strong> A stage manager can hold
  the doors until everything is ready. Your host can too, but the thing controlling whether traffic
  arrives is not the host — it is a load balancer somewhere else that has its own opinion about
  whether you are ready, and it finds out late in both directions. Half the failures in this module
  come from that gap.</p>
</section>

<section id="minimal-example">
  <h2>Minimal example: the five phases</h2>

  <p>Nothing above needs to be taken on trust. This program prints from each phase, so the order is
  observed rather than assumed.</p>

  <pre data-lang="csharp" data-net="10" data-title="00-the-smallest-host.cs"><code>// 00-the-smallest-host.cs — The whole hosting model in five lines, with a
// print from each phase so the order is visible rather than assumed.
//
// Run:  dotnet run 00-the-smallest-host.cs -c Release

#:sdk Microsoft.NET.Sdk.Web

// 1. The BUILDER. Configuration, logging and a list of service registrations.
//    Nothing is running and nothing has been constructed.
var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
Console.WriteLine("1. builder created - nothing is running yet");

// 2. REGISTRATION. Adding to that list. Still nothing constructed.
builder.Services.AddSingleton&lt;Greeter&gt;();
Console.WriteLine("2. Greeter registered - but not constructed");

// 3. BUILD. The registrations are frozen and the container is created.
var app = builder.Build();
Console.WriteLine("3. Build() done - the container exists, the server does not");

// 4. THE PIPELINE. What happens to a request. Still nothing is listening.
app.MapGet("/", (Greeter greeter) =&gt; greeter.Greet());
Console.WriteLine("4. endpoint mapped - still not listening");

// 5. START. Now the server listens. In a real program this is app.Run(),
//    which starts and then blocks until shutdown; StartAsync is the same
//    thing without the blocking, so the rest of this file can run.
await app.StartAsync();
Console.WriteLine($"5. listening on {app.Urls.First()}");

using var http = new HttpClient();
Console.WriteLine($"   a request returns: {await http.GetStringAsync(app.Urls.First())}");

await app.StopAsync();
Console.WriteLine("6. stopped");

sealed class Greeter
{
    public Greeter() =&gt; Console.WriteLine("   (Greeter constructed - on first use, during the request)");

    public string Greet() =&gt; "hello";
}</code></pre>

  <pre data-lang="console" data-title="00-the-smallest-host.cs output"><code>1. builder created - nothing is running yet
2. Greeter registered - but not constructed
3. Build() done - the container exists, the server does not
4. endpoint mapped - still not listening
5. listening on http://127.0.0.1:54346
   (Greeter constructed - on first use, during the request)
   a request returns: hello
6. stopped</code></pre>

  <p>The line worth noticing is the one in brackets. <strong><code>AddSingleton</code> did not create a
  <code>Greeter</code></strong> — it recorded how to create one. The constructor ran during the first
  request that needed it, four phases later.</p>

  <p>That is true of every registration. Nothing in the container is constructed until something asks
  for it, which is why a broken constructor can pass startup cleanly and fail on a request hours
  later.</p>
</section>

<section id="startup-order">
  <h2>The order things actually happen</h2>

  <p>The same experiment with hosted services and lifecycle events added:</p>

  <pre data-lang="console" data-title="01-startup-order.cs"><code>1. CreateBuilder() returns
2. registering services
3. Build() called
4. Build() returned
5. StartAsync() called
   (FirstHostedService.StartAsync began - sleeping 400 ms)
6. FirstHostedService.StartAsync finished
   (SecondHostedService.StartAsync ran - after First finished)
7. ApplicationStarted fired
8. StartAsync() returned
   (GatewayConnection #1 constructed - on first resolution, not at registration)
9. ApplicationStopping fired
   (SecondHostedService.StopAsync ran - FIRST to stop)
10. FirstHostedService.StopAsync ran (second to stop)
11. ApplicationStopped fired</code></pre>

  <p>Three rules are visible there, and each one causes a different class of bug.</p>

  <h3>1. Build() is a one-way door</h3>

  <pre data-lang="console" data-title="01-startup-order.cs"><code>   adding a service after Build():
     InvalidOperationException: The service collection cannot be modified because it is read-only.</code></pre>

  <p>The service <em>collection</em> is a mutable list. The service <em>provider</em> built from it is
  not, and cannot be: it caches singletons, precompiles constructor calls, and validates the graph.
  Allowing a late registration would mean some code had already resolved the old answer.</p>

  <p>So a startup file has two halves, and they are not decoration:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Half</th><th>Describes</th><th>Looks like</th></tr></thead>
      <tbody>
        <tr><td>Before <code>Build()</code></td><td><strong>What exists</strong></td><td><code>builder.Services.AddX</code>, <code>builder.Configuration</code>, <code>builder.Logging</code></td></tr>
        <tr><td>After <code>Build()</code></td><td><strong>What happens</strong></td><td><code>app.UseX</code>, <code>app.MapX</code>, <code>app.Run()</code></td></tr>
      </tbody>
    </table>
  </div>

  <p>A practical tell: if an extension method takes <code>this IServiceCollection</code> it belongs
  before <code>Build()</code>; if it takes <code>this IApplicationBuilder</code> or
  <code>this WebApplication</code> it belongs after. <code>AddX</code> before, <code>UseX</code> after,
  with very few exceptions.</p>

  <h3>2. Hosted services start in registration order and stop in reverse</h3>

  <p>First started before Second and stopped after it. That is the same rule as nested
  <code>using</code> blocks, and for the same reason: whatever started last may depend on what started
  first, so it must go first.</p>

  <h3>3. Middleware runs in registration order in, reverse order out</h3>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   app.Use(A);  app.Use(B);  app.Use(C);  app.MapGet("/", handler);

   A in -&gt; B in -&gt; C in -&gt; handler -&gt; C out -&gt; B out -&gt; A out</code></pre>

  <p>Each middleware <em>wraps</em> everything registered after it, which is why the pipeline is nested
  rather than sequential. Three consequences decide most real ordering questions:</p>

  <ul>
    <li><strong>Exception handling goes first.</strong> It can only catch what it wraps.</li>
    <li><strong>Authorisation goes after routing.</strong> It needs to know which endpoint was matched
    before it can decide whether the caller may reach it; before routing there is no endpoint yet.</li>
    <li><strong>Anything writing response headers must run before the response starts.</strong> A
    middleware setting a header after <code>await next()</code> is usually too late — use
    <code>HttpResponse.OnStarting</code>.</li>
  </ul>

  <p>A middleware that does not call <code>next()</code> <em>short-circuits</em>: nothing after it
  runs. That is how a rate limiter or an authentication failure returns without touching your
  endpoint.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>That third bullet was found the hard way while writing this module. A middleware in
    <code>01-startup-order.cs</code> set a response header after <code>await next()</code> to report
    the unwind order. It threw, truncated the body mid-stream, and the client got
    <code>The response ended prematurely</code>.</p>
    <p>The status line and headers go on the wire before the body, so once the handler has started
    writing they are already gone. This is the same failure that turns a mid-stream exception into a
    truncated 200 rather than a 500.</p>
  </div>
</section>

<section id="scopes">
  <h2>One scope per request</h2>

  <p class="define"><span class="define__term">Scope</span> A boundary the container uses to decide how
  long an object lives. ASP.NET Core creates exactly one scope per request and disposes it when the
  response is finished.</p>

  <p class="define"><span class="define__term">Singleton, scoped, transient</span> The three
  <em>lifetimes</em> a registration can have: one instance for the whole application, one per scope,
  or a new one every time it is asked for. The lifetime is chosen at registration and decides how many
  of a thing exist at once.</p>

  <p>The three lifetimes, counted — two of each resolved per request, so "per scope" is
  distinguishable from "per resolution":</p>

  <pre data-lang="console" data-title="02-services-and-scopes.cs"><code>   request   singleton   scoped   transient
   -------   ---------   ------   ---------
         1         1,1      1,1         1,2
         2         1,1      2,2         3,4
         3         1,1      3,3         5,6</code></pre>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Lifetime</th><th>One instance per</th><th>Use for</th></tr></thead>
      <tbody>
        <tr><td><code>AddSingleton</code></td><td>The whole application</td><td>Stateless and expensive to build — an HTTP client, a cache, a configuration object</td></tr>
        <tr><td><code>AddScoped</code></td><td>Scope, so per request</td><td>Per-request state and database connections. <code>DbContext</code> is the standard case</td></tr>
        <tr><td><code>AddTransient</code></td><td>Resolution</td><td>Rarely. It surprises people, because a transient resolved by a singleton lives as long as the singleton</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>"Per request" is not a lifetime the container knows about.</strong> The container knows
  about scopes; the host is what creates one per request. That distinction matters the moment you are
  outside a request — in a background service, a startup task or a console command — where there is no
  ambient scope at all.</p>

  <h3>The two checks that are off when you need them</h3>

  <p>A singleton that depends on a scoped service captures it: the singleton is built once and keeps
  whatever it was given, so one instance is shared by every request. Measured with validation
  disabled:</p>

  <pre data-lang="console" data-title="02-services-and-scopes.cs"><code>   ValidateScopes = false
     scoped ids seen across 3 scopes : 1, 1, 1
     ScopedService instances created : 1</code></pre>

  <p>One instance, three scopes, no error. With validation on, both this and resolving a scoped service
  from the root provider are caught:</p>

  <pre data-lang="console" data-title="02-services-and-scopes.cs"><code>   with ValidateScopes = true:

     singleton depending on scoped
       InvalidOperationException: Cannot consume scoped service 'ScopedService' from singleton 'CapturingSingleton'.

     scoped resolved from the root provider
       InvalidOperationException: Cannot resolve scoped service 'ScopedService' from root provider.</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>The defaults are the trap:</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Option</th><th>Development</th><th>Production</th></tr></thead>
        <tbody>
          <tr><td><code>ValidateScopes</code></td><td>on</td><td><strong>off</strong></td></tr>
          <tr><td><code>ValidateOnBuild</code></td><td>off</td><td>off</td></tr>
        </tbody>
      </table>
    </div>
    <p><strong>The check that finds captive dependencies is disabled in the environment where the bug
    costs something.</strong> A service that runs correctly on your machine can share one
    <code>DbContext</code> across every concurrent request in production — and <code>DbContext</code>
    is not thread-safe, so the symptom is <code>A second operation was started on this context
    instance before a previous operation completed</code>, intermittently, under load, from a stack
    trace pointing at whichever request lost the race.</p>
    <p>Turn both on everywhere:</p>
    <pre data-lang="csharp" data-net="10" data-title="Turn both on, everywhere"><code>builder.Host.UseDefaultServiceProvider(options =&gt;
{
    options.ValidateScopes = true;
    options.ValidateOnBuild = true;
});</code></pre>
    <p><code>ValidateOnBuild</code> is the more valuable of the two: it walks every registration at
    startup and fails immediately on anything it cannot construct. Without it, a missing registration
    is discovered by the first request that needs it — possibly a rarely used endpoint, found in
    production, hours after a deploy that looked successful. The cost is a slower startup proportional
    to the number of registrations, which is a good trade for a crash that happens before the load
    balancer sends you anything.</p>
  </div>

  <p>Lifetimes have a module of their own later in this track — <a href="#/m/t3-11-di-lifetimes">DI
  Lifetimes and the Bugs They Cause</a>. What matters here is the host's part: it creates the scope,
  and it owns the validation switches.</p>
</section>

<section id="hosted-services">
  <h2>When does the server actually start listening?</h2>

  <p>This is the ordering most people have backwards, and it is worth measuring rather than assuming. A
  hosted service that sleeps for 400 ms in <code>StartAsync</code>, a
  <code>BackgroundService</code> that sleeps for 400 ms in <code>ExecuteAsync</code>, and a poller
  watching the port from before the host started:</p>

  <pre data-lang="console" data-title="01-startup-order.cs"><code>   event                                              at
   -----                                              --
   FirstHostedService.StartAsync began            130 ms
   FirstHostedService.StartAsync returned         537 ms   (it slept 400 ms)
   SlowBackgroundService.ExecuteAsync began       539 ms
   the port first accepted a connection          631 ms
   SlowBackgroundService.ExecuteAsync ended       954 ms   (it also slept 400 ms)</code></pre>

  <p><strong>The server did not listen until the hosted service had finished starting.</strong> The
  port opened after <code>StartAsync</code> returned, not before.</p>

  <p>The reason is registration order. <code>WebApplicationBuilder</code> adds the web host service
  that owns Kestrel while <code>Build()</code> runs, which puts it <em>after</em> everything you
  registered — and hosted services start in registration order.</p>

  <p>Two consequences, pointing in opposite directions:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th></th><th>Consequence</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>Good</strong></td>
          <td>Warm-up in <code>IHostedService.StartAsync</code> is safe from early traffic. Nothing can arrive, because there is no open socket to arrive on. A cache load or a migration completes before the first request exists.</td>
        </tr>
        <tr>
          <td><strong>Bad</strong></td>
          <td>A slow <code>StartAsync</code> delays the port opening, and one that never returns means the port <em>never</em> opens. The process is alive and healthy by any process-level check, and refusing connections. A TCP readiness probe sees a closed port and the orchestrator restarts the pod — forever, with nothing in the logs.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h3>BackgroundService is the exception</h3>

  <p>Look at the table again: <code>ExecuteAsync</code> began <em>before</em> the port opened and
  finished <em>after</em> it. It held nothing up.</p>

  <p>That is because <code>BackgroundService.StartAsync</code> calls <code>ExecuteAsync</code> and
  returns at its first incomplete <code>await</code>, without waiting for it to finish.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Where the work goes</th><th>Does startup wait?</th><th>Use for</th></tr></thead>
      <tbody>
        <tr><td>Before <code>app.Run()</code>, in <code>Program.cs</code></td><td>Yes</td><td>Migrations; anything that must have happened</td></tr>
        <tr><td><code>IHostedService.StartAsync</code></td><td><strong>Yes</strong></td><td>Required warm-up, when it is fast</td></tr>
        <tr><td><code>BackgroundService.ExecuteAsync</code></td><td><strong>No</strong></td><td>Queue consumers, timers, anything that must not delay serving</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The good half of that ordering holds for this host layout. Anything that registers a hosted
    service differently — or a future change to where the web host service is added — reverses it.</p>
    <p>If your warm-up genuinely must not be raced, a health check that reports unhealthy until it is
    done does not depend on ordering at all. That is the version worth reaching for when the warm-up is
    slow, because it also stops the port sitting closed while an orchestrator loses patience.</p>
  </div>
</section>

<section id="graceful-shutdown">
  <h2>Graceful shutdown</h2>

  <p class="define"><span class="define__term">Graceful shutdown</span> Stopping in a defined order —
  refuse new work, finish what is in progress, stop background work, release resources — rather than
  ending the process where it stands.</p>

  <p class="define"><span class="define__term">SIGTERM</span> The signal an orchestrator sends to ask a
  process to stop. It can be caught, which is what makes any of this possible.
  <strong><code>SIGKILL</code> cannot be</strong>, and neither can an out-of-memory kill.</p>

  <p>A request already running when shutdown begins:</p>

  <pre data-lang="console" data-title="03-graceful-shutdown.cs"><code>   t= 104 ms  request is in the handler, StopAsync() called
   t= 611 ms  the request completed: 200 finished
   t= 613 ms  StopAsync() returned</code></pre>

  <p>The request finished normally and shutdown waited for it. That is the whole feature, in four
  steps:</p>

  <ol>
    <li>Stop accepting new connections.</li>
    <li>Let in-flight requests finish.</li>
    <li>Stop hosted services, in reverse registration order.</li>
    <li>Dispose the container.</li>
  </ol>

  <h3>Step 1 is also the problem</h3>

  <pre data-lang="console" data-title="03-graceful-shutdown.cs"><code>   the request already running : 200 finished
   a NEW request 50 ms later   : HttpRequestException: No connection could be made because
                                 the target machine actively refused it.</code></pre>

  <p>The listening socket closes <em>immediately</em>. Only work already accepted is allowed to finish.
  A new connection is refused at the TCP level — there is no server left to answer with a status
  code.</p>

  <p>This is why deploys drop traffic even when graceful shutdown is working perfectly:</p>

  <pre class="diagram"><code>1. the orchestrator sends SIGTERM to the pod
2. the pod stops accepting connections IMMEDIATELY
3. the load balancer notices, some seconds later
4. between 2 and 3 it is still routing traffic to a closed port</code></pre>

  <p>Everything in that window is a connection error, and the application is behaving correctly
  throughout. <strong>The fix is on the deployment side, not in your code:</strong></p>

  <ul>
    <li class="define-inline"></li>    <li>A <strong>preStop hook</strong> that sleeps for longer than the load balancer takes to notice,
    so the pod keeps serving normally while it is removed from rotation. Five to fifteen seconds is
    typical, and it must exceed the readiness probe interval multiplied by its failure threshold.</li>
    <li>A <strong>readiness probe that flips on <code>ApplicationStopping</code></strong>, so the load
    balancer is told rather than left to discover it.</li>
  </ul>

  <p>Note the ordering those imply: <em>the pod must report unready before it stops accepting
  connections</em>. Buying the time in which those two facts differ is the entire purpose of the
  preStop sleep.</p>

  <h3>The shutdown timeout</h3>

  <p>The same 3000 ms handler, interrupted at three different timeouts:</p>

  <pre data-lang="console" data-title="03-graceful-shutdown.cs"><code>   ShutdownTimeout   StopAsync took   difference   the in-flight request
   ---------------   --------------   ----------   ---------------------
             200 ms          1217 ms       1017 ms   ABANDONED (IOException)
             800 ms          1813 ms       1013 ms   ABANDONED (IOException)
            1500 ms          2513 ms       1013 ms   ABANDONED (IOException)</code></pre>

  <p><strong>The difference is a constant, not a proportion.</strong> Shutdown costs the timeout you
  configured plus about a second of connection teardown that no setting here controls. (Section 4 of
  the same file shuts down with no open connections and shows no such overhead, which is good evidence
  that teardown is what it is.)</p>

  <p>The requests that do not fit are dropped mid-flight. The client sees a broken connection rather
  than a status code — the same thing it would have seen from an ungraceful kill.</p>

  <p><strong>The default is 30 seconds, and it is a deadline rather than a target:</strong> shutdown
  returns as soon as everything has finished, so a generous value costs nothing on a healthy shutdown.
  What it must be measured against is your <em>slowest</em> endpoint, not your average one. A report
  endpoint that legitimately takes 45 seconds is killed on every single deploy, by a default nobody
  chose.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Two defaults collide:</p>
    <pre data-lang="text" data-title="Two defaults that collide"><code>Kubernetes terminationGracePeriodSeconds   default 30 s
.NET ShutdownTimeout                      default 30 s</code></pre>
    <p>When the orchestrator's period expires it sends <code>SIGKILL</code>, which cannot be caught or
    delayed. If .NET is still inside its own 30 seconds it is killed mid-drain, and the graceful
    shutdown you configured never completes.</p>
    <p>The constraint to satisfy:</p>
    <pre data-lang="text" data-title="The constraint to satisfy"><code>preStop sleep + ShutdownTimeout + teardown  &lt;  terminationGracePeriodSeconds</code></pre>
    <p>The out-of-the-box configuration violates it the moment you add a preStop hook.</p>
  </div>

  <h3>The background service that will not stop</h3>

  <pre data-lang="console" data-title="03-graceful-shutdown.cs"><code>   worker                        StopAsync took   loop iterations after stop
   ------                        --------------   --------------------------
   ignores the stopping token            511 ms                           10
   honours the stopping token              3 ms                            0</code></pre>

  <p>The stubborn worker cost the full <code>ShutdownTimeout</code> and was then abandoned. The
  <code>stoppingToken</code> passed to <code>ExecuteAsync</code> is the only notice a background
  service gets. Ignoring it means every shutdown takes the full timeout — multiplied by the number of
  pods, on every deploy — and the work is abandoned at an arbitrary point anyway, which is worse than
  stopping at a boundary you chose.</p>

  <h3>What triggers all of this</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Signal or event</th><th>Caught?</th><th>Result</th></tr></thead>
      <tbody>
        <tr><td><code>SIGTERM</code></td><td>yes</td><td>Graceful shutdown begins</td></tr>
        <tr><td><code>SIGINT</code> (Ctrl+C)</td><td>yes</td><td>Graceful shutdown begins</td></tr>
        <tr><td><code>SIGKILL</code> (<code>kill -9</code>)</td><td><strong>no</strong></td><td>Process ends immediately</td></tr>
        <tr><td>Container OOM kill</td><td><strong>no</strong></td><td>Process ends immediately</td></tr>
        <tr><td><code>IHostApplicationLifetime.StopApplication()</code></td><td>—</td><td>Graceful, from your own code</td></tr>
      </tbody>
    </table>
  </div>

  <p>The two that cannot be caught are why none of this replaces idempotent, restartable work. A pod
  killed for exceeding its memory limit gets no notice at all.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Lifecycle event</th><th>Fires when</th><th>Good for</th></tr></thead>
      <tbody>
        <tr><td><code>ApplicationStarted</code></td><td>Startup finished, the server is listening</td><td>Logging the real bound port</td></tr>
        <tr><td><strong><code>ApplicationStopping</code></strong></td><td>Shutdown has <em>begun</em>; nothing has stopped yet</td><td><strong>Flipping readiness to unhealthy.</strong> This is the load-bearing one</td></tr>
        <tr><td><code>ApplicationStopped</code></td><td>Everything has stopped</td><td>A final log line, and nothing else</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>Back to the incident. Ledger's outbox publisher reads unsent rows, batches them, and posts the
  batch. It holds that batch <em>in memory</em> between the read and the send, and a deploy ends the
  process while a batch is in that gap.</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   version                             taken   sent   LOST   shutdown
   -------                             -----   ----   ----   --------
   v1 ignores the stopping token         110    105      5     415 ms
   v2 honours it, drops its batch         40     35      5       2 ms
   v3 honours it, flushes on stop         45     45      0       0 ms</code></pre>

  <p><strong>v1 ignores the token.</strong> Look at the taken column: it kept pulling work for the whole
  shutdown window, roughly two and a half times as much as the others, and still lost a batch at the
  end. It is not stopped, it is <em>abandoned</em> — the host gives up waiting and carries on without
  it, so no code after its loop ever runs. No flush, no logging, no cleanup.</p>

  <p><strong>v2 honours the token</strong> and stops in 2 ms — and still loses the batch in its hand.
  This is the version that passes review.</p>

  <p><strong>v3 honours the token and finishes what it had already taken</strong> before returning.
  Nothing lost, and still prompt.</p>

  <p>The distinction v2 misses is the one worth carrying:</p>

  <pre class="diagram"><code>STOP TAKING NEW WORK        immediately, on the token
FINISH THE WORK YOU HAVE
ALREADY TAKEN               before you return</code></pre>

  <p><strong>Cancellation means the first. It does not mean the second</strong>, and a token passed
  dutifully to every <code>await</code> gives you the first only.</p>

  <p>And the other half of the incident, measured on the request path:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   requests inside a handler when shutdown began : 20
     completed on the server : 20
     answered the client     : 20
     failed                  : 0

   10 requests arriving 50 ms AFTER shutdown began
     completed normally : 0
     connection refused : 10</code></pre>

  <p>The application did everything right and still failed ten requests. In-flight work drained
  cleanly; anything that <em>arrived</em> after the listener closed had nowhere to land.</p>

  <h3>The whole contract in one file</h3>

  <p>Every decision in this module applied to one host, started and stopped while it is doing real
  work:</p>

  <pre data-lang="csharp" data-net="10" data-title="06-minimal-example.cs"><code>// 06-minimal-example.cs — One host that applies every decision in this module,
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
var timeline = new List&lt;string&gt;();

void Note(string what) =&gt; timeline.Add($"   t={clock.ElapsedMilliseconds,5} ms  {what}");

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
builder.Host.UseDefaultServiceProvider(options =&gt;
{
    options.ValidateScopes = true;
    options.ValidateOnBuild = true;
});

// Longer than the slowest endpoint, and shorter than the orchestrator's own
// patience. The default is 30 seconds and is rarely the right number for
// either reason.
builder.Services.Configure&lt;HostOptions&gt;(options =&gt;
    options.ShutdownTimeout = TimeSpan.FromSeconds(5));

builder.Services.AddSingleton(clock);
builder.Services.AddSingleton&lt;Readiness&gt;();
builder.Services.AddSingleton&lt;Outbox&gt;();
builder.Services.AddScoped&lt;UnitOfWork&gt;();
builder.Services.AddHostedService&lt;OutboxPublisher&gt;();

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
app.Use(async (context, next) =&gt;
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
app.MapGet("/health/live", () =&gt; Results.Ok(new { status = "alive" }));

// Readiness: should traffic be sent here? Reports unhealthy before warm-up
// finishes and again the moment shutdown begins.
app.MapGet("/health/ready", (Readiness readiness) =&gt;
    readiness.IsReady
        ? Results.Ok(new { status = "ready" })
        : Results.StatusCode(503));

app.MapPost("/payments/{id}/settle", async (string id, UnitOfWork work, Outbox outbox) =&gt;
{
    await Task.Delay(50);                       // the gateway call
    outbox.Enqueue(id);
    return Results.Ok(new { id, status = "settled", scope = work.Id });
});

// The three lifecycle events. Only the middle one is load-bearing.
var readiness = app.Services.GetRequiredService&lt;Readiness&gt;();

app.Lifetime.ApplicationStarted.Register(() =&gt; Note("ApplicationStarted - the port is open"));

app.Lifetime.ApplicationStopping.Register(() =&gt;
{
    // Fires BEFORE anything stops. Flipping readiness here is the earliest
    // possible moment the load balancer can learn to stop routing.
    readiness.MarkNotReady();
    Note("ApplicationStopping - readiness flipped to unhealthy");
});

app.Lifetime.ApplicationStopped.Register(() =&gt; Note("ApplicationStopped - everything has stopped"));

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
static async Task Exercise(WebApplication app, List&lt;string&gt; timeline, Stopwatch clock,
    Action&lt;string&gt; note)
{
    string baseUrl = app.Urls.First();
    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };
    var outbox = app.Services.GetRequiredService&lt;Outbox&gt;();

    Console.WriteLine("A correctly hosted service, started and stopped under load");
    Console.WriteLine();

    HttpResponseMessage live = await http.GetAsync("/health/live");
    HttpResponseMessage ready = await http.GetAsync("/health/ready");

    Console.WriteLine($"   /health/live  -&gt; {(int)live.StatusCode}");
    Console.WriteLine($"   /health/ready -&gt; {(int)ready.StatusCode}");
    Console.WriteLine();

    // Ten settlements in flight, then a deploy.
    Task&lt;HttpResponseMessage&gt;[] inFlight = Enumerable.Range(0, 10)
        .Select(i =&gt; http.PostAsync($"/payments/PAY-{i:D4}/settle", null))
        .ToArray();

    await Task.Delay(20);
    note("SIGTERM equivalent: StopAsync() called with 10 requests in flight");
    Task stopping = app.StopAsync();

    int settled = 0;
    foreach (Task&lt;HttpResponseMessage&gt; task in inFlight)
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

    public bool IsReady =&gt; _ready;

    public void MarkReady() =&gt; _ready = true;

    public void MarkNotReady() =&gt; _ready = false;
}

sealed class UnitOfWork
{
    private static int _created;

    public UnitOfWork() =&gt; Id = Interlocked.Increment(ref _created);

    public int Id { get; }
}

sealed class Outbox
{
    private readonly System.Collections.Concurrent.ConcurrentQueue&lt;string&gt; _pending = new();

    private int _enqueued;
    private int _published;

    // Interlocked, not ++. Enqueue is called from concurrent request handlers
    // and Publish from the worker; a plain increment loses updates, which
    // showed up here as a NEGATIVE lost count.
    public int Enqueued =&gt; Volatile.Read(ref _enqueued);

    public int Published =&gt; Volatile.Read(ref _published);

    public void Enqueue(string id)
    {
        _pending.Enqueue(id);
        Interlocked.Increment(ref _enqueued);
    }

    public List&lt;string&gt; Take(int max)
    {
        var batch = new List&lt;string&gt;();
        while (batch.Count &lt; max &amp;&amp; _pending.TryDequeue(out string? id))
        {
            batch.Add(id);
        }

        return batch;
    }

    public void Publish(IReadOnlyCollection&lt;string&gt; batch) =&gt;
        Interlocked.Add(ref _published, batch.Count);
}

sealed class OutboxPublisher : BackgroundService
{
    private readonly Outbox _outbox;

    private List&lt;string&gt; _inHand = new();

    public OutboxPublisher(Outbox outbox) =&gt; _outbox = outbox;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                _inHand = _outbox.Take(5);

                if (_inHand.Count &gt; 0)
                {
                    await Task.Delay(10, stoppingToken);    // the publish call
                    _outbox.Publish(_inHand);
                    _inHand = new List&lt;string&gt;();
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
        if (_inHand.Count &gt; 0)
        {
            _outbox.Publish(_inHand);
            _inHand = new List&lt;string&gt;();
        }

        List&lt;string&gt; remaining = _outbox.Take(int.MaxValue);
        if (remaining.Count &gt; 0)
        {
            _outbox.Publish(remaining);
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="06-minimal-example.cs output"><code>   /health/live  -&gt; 200
   /health/ready -&gt; 200

   Timeline

   t=  112 ms  Build() returned
   t=  118 ms  warm-up starting (before StartAsync, so no request can exist)
   t=  231 ms  warm-up done
   t=  264 ms  ApplicationStarted - the port is open
   t=  264 ms  StartAsync returned
   t=  459 ms  SIGTERM equivalent: StopAsync() called with 10 requests in flight
   t=  460 ms  ApplicationStopping - readiness flipped to unhealthy
   t=  514 ms  ApplicationStopped - everything has stopped
   t=  515 ms  StopAsync returned

   settlements accepted        : 10
   settlements answered 2xx    : 10
   outbox items enqueued       : 10
   outbox items published      : 10
   outbox items LOST           : 0</code></pre>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger runs ten pods, deploys twelve times a week, and handles 400 requests per hour.</p>
    <p><strong>The lost notifications.</strong> The publisher batches five at a time and loses one
    batch per pod per deploy. That is 5 × 10 × 12 = <strong>600 missed settlement notifications a
    week</strong>, each one a customer whose money moved without being told. They surface as support
    tickets days later, and each is manually reconciled against the gateway's records.</p>
    <p><strong>The refused requests.</strong> A five-second window per pod between SIGTERM and the load
    balancer noticing gives 0.11 req/s × 5 s × 10 pods × 12 deploys ≈ <strong>67 failed requests a
    week</strong>. Small enough to look like noise on a dashboard, and every one is a payment attempt
    that returned a connection error. At ten times the traffic it is 670 a week and somebody
    notices.</p>
    <p><strong>The deploy time.</strong> A worker ignoring its token costs the full
    <code>ShutdownTimeout</code> — 30 seconds by default — per pod. Ten pods rolled one at a time turns
    a deploy that should take under a minute into five, which is enough to make people deploy less
    often, which is its own much larger cost.</p>
    <p>Every fix is a line or two of hosting configuration, and none of them can be applied
    retroactively to notifications that were already lost.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>A background service that ignores its token</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    while (true)
    {
        List&lt;Notification&gt; batch = await _outbox.TakeAsync(5);
        await _notifier.SendAsync(batch);
        await Task.Delay(1000);
    }
}</code></pre>

  <p>Symptom: every deploy takes the full <code>ShutdownTimeout</code>, and work is lost anyway. Cause:
  the token is never checked and never passed to an <code>await</code>, so the loop cannot learn that
  shutdown started. Fix: check it, pass it, and flush what is in hand before returning.</p>

  <h3>Cancellation without draining</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Also wrong - this is v2"><code>while (!stoppingToken.IsCancellationRequested)
{
    _inHand = await _outbox.TakeAsync(5, stoppingToken);
    await _notifier.SendAsync(_inHand, stoppingToken);   // cancelled here, batch lost
    _inHand = [];
}</code></pre>

  <p>Symptom: fast deploys, and the same lost work. Cause: the send was cancelled along with everything
  else. Fix: on the way out, finish <code>_inHand</code> without the token — it is already cancelled,
  and the point is to complete rather than to abort.</p>

  <h3>A singleton capturing a scoped service</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>public sealed class OutboxPublisher : BackgroundService
{
    private readonly LedgerDbContext _db;

    public OutboxPublisher(LedgerDbContext db) =&gt; _db = db;
}</code></pre>

  <p>Symptom: with validation on, the application will not start; with it off,
  <code>A second operation was started on this context instance</code> under load. Cause: a
  <code>BackgroundService</code> is a singleton, and <code>DbContext</code> is scoped. Fix: inject
  <code>IServiceScopeFactory</code> and create a scope per unit of work, <em>inside</em> the loop.</p>

  <h3>Registering services after Build()</h3>

  <p>Symptom: <code>The service collection cannot be modified because it is read-only.</code> Cause: an
  extension method that took <code>app</code> when it needed <code>builder</code>, or a test
  customising the container too late. Fix: move it above <code>Build()</code>.</p>

  <h3>Warm-up in the wrong place</h3>

  <p>Symptom: either the port sits closed long enough for a startup probe to restart the pod, or
  traffic arrives before the cache is loaded. Cause: <code>IHostedService.StartAsync</code> blocks the
  port from opening; <code>BackgroundService.ExecuteAsync</code> does not block anything. Measured:</p>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   placement                    warm-up done   port open   served early?
   ---------                    ------------   ---------   -------------
   b. IHostedService.StartAsync        307 ms      309 ms              no
   c. BackgroundService                316 ms        4 ms             YES</code></pre>

  <h3>A liveness probe that checks dependencies</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>app.MapGet("/health/live", async (LedgerDbContext db) =&gt;
    await db.Database.CanConnectAsync() ? Results.Ok() : Results.StatusCode(503));</code></pre>

  <p>Symptom: the database has a bad minute and every pod in the cluster is restarted at once, turning
  a brief dependency blip into a full outage. Cause: liveness answers "is this process broken?" and a
  restart is its remedy — restarting cannot fix somebody else's database. Fix: liveness depends on
  nothing; dependency checks belong in readiness.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>Hosting bugs are ordering bugs, and ordering is invisible in a stack trace. The first move is
    always to <strong>make the order observable</strong>: register callbacks on the lifecycle events
    and log from each phase, exactly as <code>01-startup-order.cs</code> does.</p>
    <pre data-lang="csharp" data-net="10" data-title="Three lines every service should have"><code>app.Lifetime.ApplicationStarted.Register(() =&gt; logger.LogInformation("started"));
app.Lifetime.ApplicationStopping.Register(() =&gt; logger.LogInformation("stopping"));
app.Lifetime.ApplicationStopped.Register(() =&gt; logger.LogInformation("stopped"));</code></pre>
    <p>Those three lines belong in every service. They cost nothing and they turn "the deploy did
    something strange" into a timeline.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Look at</th><th>What you are looking for</th></tr></thead>
      <tbody>
        <tr>
          <td>Work lost on every deploy, no errors logged</td>
          <td>Whether anything is held in memory between read and write</td>
          <td>A batch, a buffer, an unacknowledged message. Nothing logs an error because nothing failed — the process was told to stop and it did.</td>
        </tr>
        <tr>
          <td>Deploys take exactly 30 seconds per pod</td>
          <td>The time between <code>stopping</code> and <code>stopped</code> in your logs</td>
          <td>A hosted service not returning. Exactly <code>ShutdownTimeout</code> is the signature — a round number means a timeout, not work.</td>
        </tr>
        <tr>
          <td>Pod restarts in a loop, no application logs</td>
          <td>Whether the port ever opens</td>
          <td>A hanging <code>IHostedService.StartAsync</code>. The process is alive and never listens, so a TCP probe fails and the orchestrator restarts it before it can log anything useful.</td>
        </tr>
        <tr>
          <td>Connection errors during deploys, clean shutdown logs</td>
          <td>The gap between SIGTERM and the load balancer removing the pod</td>
          <td>Requests arriving after the listener closed. Your logs will not show them at all — there was no server to log them. Look at the load balancer's metrics, not yours.</td>
        </tr>
        <tr>
          <td><code>A second operation was started on this context</code></td>
          <td>Every singleton's constructor parameters</td>
          <td>A captive scoped dependency. Turn on <code>ValidateScopes</code> and restart — it will name the pair.</td>
        </tr>
        <tr>
          <td>Works locally, fails in production only</td>
          <td><code>ValidateScopes</code> and <code>ValidateOnBuild</code></td>
          <td>Scope validation is on in Development and off in Production. Turn both on everywhere and the difference disappears.</td>
        </tr>
        <tr>
          <td>Missing service found by one rare endpoint</td>
          <td><code>ValidateOnBuild</code></td>
          <td>It was never registered. With validation on this is a startup crash instead of a 500 hours later.</td>
        </tr>
        <tr>
          <td><code>The response has already started</code></td>
          <td>Middleware writing after <code>await next()</code></td>
          <td>Headers or a status code set once the body is on the wire. Use <code>OnStarting</code>, or check <code>Response.HasStarted</code> first.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h3>The 30-second tell</h3>

  <p>It is worth knowing one signature by heart. If the interval between your <code>stopping</code> and
  <code>stopped</code> log lines is a round number that matches <code>ShutdownTimeout</code> exactly,
  <strong>something is being abandoned rather than stopping</strong>. Work never takes exactly 30.000
  seconds; timeouts do.</p>

  <p>Narrow it by registering hosted services one at a time, or by logging on entry and exit of every
  <code>StopAsync</code>. The one with an entry and no exit is the culprit.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Passing the cancellation token everywhere makes shutdown correct."</em></p>
    <p>It makes shutdown <em>fast</em>. v2 in the measurement above does exactly this and still loses a
    batch on every deploy. Cancellation means stop taking new work; finishing the work you have already
    taken is a separate thing you must write.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Kestrel starts first, so my warm-up races incoming requests."</em></p>
    <p>Measured above: the port opened at 631 ms, after a hosted service that finished at 537 ms. The
    web host service is registered during <code>Build()</code>, which puts it last. The real risk runs
    the other way — a slow <code>StartAsync</code> keeps the port closed, and a hanging one keeps it
    closed forever.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"AddSingleton creates the object at startup."</em></p>
    <p>It records how to create one. The constructor runs on first resolution — which for a service
    only used by one endpoint may be hours after the deploy. <code>ValidateOnBuild</code> is what turns
    that into a startup failure instead.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Graceful shutdown means deploys do not drop requests."</em></p>
    <p>It means requests already <em>accepted</em> are not dropped. The listening socket closes
    immediately, and the load balancer keeps routing to it for seconds afterwards. Ten refused requests
    out of thirty in the measurement above, with a perfectly behaved application. The fix is a preStop
    hook and a readiness probe, neither of which is in your code.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"ShutdownTimeout is how long shutdown takes."</em></p>
    <p>It is a deadline, not a target — a healthy shutdown returns as soon as it is done. And the
    measured cost was consistently the timeout <em>plus about a second</em> of connection teardown, so
    it is not even the whole deadline. Budget against the orchestrator using the total.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Liveness and readiness are two names for the same health check."</em></p>
    <p>They answer different questions and have different remedies. Liveness: is this process broken,
    and would restarting it help? Readiness: should traffic be sent here right now? Putting a database
    check in liveness means a dependency blip restarts every pod you own — a brief degradation turned
    into an outage by a health check.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Turning on ValidateOnBuild is a micro-optimisation not worth the startup cost."</em></p>
    <p>It converts a class of runtime 500s into a startup crash. A crash before the load balancer routes
    to you costs nothing; a 500 on a rarely used endpoint costs an incident. The startup cost is
    proportional to your registration count and is measured in milliseconds.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <p>Every decision in this module is configuration or a few lines, and every one of them is invisible
  until a deploy or an incident makes it visible.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Decision</th><th>Cost to get right</th><th>Cost of getting it wrong</th></tr></thead>
      <tbody>
        <tr><td>Worker drains what it has taken</td><td>Three lines after the loop</td><td>~600 lost settlement notifications a week at Ledger's rate</td></tr>
        <tr><td>Worker honours the stopping token</td><td>One <code>while</code> condition</td><td>30 s added to every pod's shutdown, so 5 minutes per deploy across ten pods</td></tr>
        <tr><td><code>ValidateScopes</code> + <code>ValidateOnBuild</code> on</td><td>Four lines</td><td>A shared <code>DbContext</code> in production that works perfectly on your machine</td></tr>
        <tr><td>Readiness flips on <code>ApplicationStopping</code></td><td>One callback</td><td>Seconds of refused connections per pod, per deploy</td></tr>
        <tr><td>preStop hook longer than LB detection</td><td>One YAML block</td><td>~67 failed payment attempts a week, dismissed as dashboard noise</td></tr>
        <tr><td>Liveness depends on nothing</td><td>Removing a parameter</td><td>A database blip restarting every pod simultaneously</td></tr>
        <tr><td><code>ShutdownTimeout</code> set deliberately</td><td>One line</td><td>A 45-second report endpoint killed on every deploy</td></tr>
      </tbody>
    </table>
  </div>

  <p>The pattern worth extracting: <strong>none of these is a bug in the code that does the
  work.</strong> The notification sender, the settlement handler and the report generator are all
  correct in every failing version above. What differs is the contract between that code and the
  process it lives in.</p>

  <p>And one limit that no amount of this removes. <code>SIGKILL</code>, an out-of-memory kill and a
  machine losing power all give no notice whatsoever. Graceful shutdown reduces how often you need work
  to be idempotent and restartable; <strong>durable state is what removes the need</strong>. In the
  incident above, the structural fix is that an outbox row is not marked sent until the send succeeds —
  then a lost batch is redelivered on the next start, and the worker's shutdown behaviour becomes a
  latency question instead of a correctness one.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Which of these go before <code>Build()</code>, and which after?</p>
    <pre data-lang="csharp" data-net="10" data-title="Sort these"><code>a. builder.Services.AddSingleton&lt;IClock, SystemClock&gt;();
b. app.UseAuthentication();
c. builder.Configuration.AddJsonFile("extra.json");
d. app.MapGet("/health", () =&gt; "ok");
e. builder.Logging.AddConsole();
f. app.Run();</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Before: a, c, e. After: b, d, f.</strong></p>
        <pre data-lang="console" data-title="05-exercises.cs"><code>   BEFORE Build()  a, c, e   they describe WHAT EXISTS
   AFTER Build()   b, d, f   they describe WHAT HAPPENS

   registering after Build(): The service collection cannot be modified
                              because it is read-only.</code></pre>
        <p>The rule is not a convention. <code>Build()</code> creates the container from the
        registrations and freezes the list, because a provider that has already handed out singletons
        cannot honestly accept a new registration for something it has already resolved.</p>
        <p>Configuration and logging belong to the builder for the same reason: they are read while the
        container is being built, so adding a source afterwards would come too late to affect anything
        that read it.</p>
        <p>A practical tell: an extension method taking <code>this IServiceCollection</code> is a
        before-Build call; one taking <code>this IApplicationBuilder</code> or
        <code>this WebApplication</code> is an after-Build call. <code>AddX</code> before,
        <code>UseX</code> after, with very few exceptions.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>In what order do these see the request and the response?</p>
    <pre data-lang="csharp" data-net="10" data-title="The pipeline"><code>app.Use(A);  app.Use(B);  app.Use(C);  app.MapGet("/", handler);</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="05-exercises.cs"><code>   A in -&gt; B in -&gt; C in -&gt; handler -&gt; C out -&gt; B out -&gt; A out</code></pre>
        <p>Registration order on the way in, reverse order on the way out. Each middleware
        <em>wraps</em> everything registered after it, which is why the pipeline is nested rather than
        sequential.</p>
        <p>Three consequences that decide real ordering:</p>
        <ul>
          <li><strong>Exception handling goes first.</strong> It can only catch what it wraps.</li>
          <li><strong>Authorisation goes after routing.</strong> It needs the matched endpoint before
          it can decide; before routing there is no endpoint yet.</li>
          <li><strong>Response headers must be written before the response starts.</strong> Setting one
          after <code>await next()</code> is usually too late — use
          <code>HttpResponse.OnStarting</code>.</li>
        </ul>
        <p>A middleware that does not call <code>next()</code> short-circuits: nothing after it runs.
        That is how a rate limiter or an authentication failure returns without touching the
        endpoint.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>This background service will not start. Why, and what is the fix?</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>public sealed class Publisher : BackgroundService
{
    private readonly LedgerDbContext _db;

    public Publisher(LedgerDbContext db) =&gt; _db = db;
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="05-exercises.cs"><code>   Cannot consume scoped service 'LedgerDbContext' from singleton 'BadPublisher'.</code></pre>
        <p>A <code>BackgroundService</code> is registered as a <strong>singleton</strong> — created once,
        living as long as the application. A <code>DbContext</code> is <strong>scoped</strong>. A
        singleton cannot depend on a scoped service, because it would hold one forever and hand the
        same instance to every unit of work.</p>
        <p>The fix is a scope factory and a scope per unit of work:</p>
        <pre data-lang="csharp" data-net="10" data-title="Right"><code>public Publisher(IServiceScopeFactory scopeFactory) =&gt; _scopeFactory = scopeFactory;

protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    while (!stoppingToken.IsCancellationRequested)
    {
        using IServiceScope scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService&lt;LedgerDbContext&gt;();

        List&lt;Notification&gt; batch = await db.Outbox
            .Where(row =&gt; !row.Sent)
            .Take(50)
            .ToListAsync(stoppingToken);

        foreach (Notification row in batch)
        {
            await _notifier.SendAsync(row, stoppingToken);
            row.Sent = true;
        }

        await db.SaveChangesAsync(stoppingToken);
        await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
    }
}</code></pre>
        <p>Two details that are wrong more often than the main point:</p>
        <ul>
          <li><strong>The scope goes inside the loop.</strong> One scope around the loop is the same bug
          in a different shape: a single <code>DbContext</code> accumulating every tracked entity the
          worker ever sees, getting slower on every iteration.</li>
          <li><strong>It only throws if scope validation is on</strong> — the default in Development and
          not in Production. This failure can be absent locally and present in the environment that
          matters.</li>
        </ul>
        <p>Prefer <code>IServiceScopeFactory</code> over <code>IServiceProvider</code>: both work, but
        the factory states the intent and cannot be used to resolve a scoped service by accident.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>Graceful shutdown is working — you can see in-flight requests completing in the logs — and
    deploys still produce a burst of connection errors. Why, and what do you change?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="05-exercises.cs"><code>   already in the handler : 200 done
   arriving 40 ms later   : connection refused</code></pre>
        <p>Graceful shutdown drains what it has <em>accepted</em>. It closes the listening socket
        immediately, so anything arriving afterwards is refused at the TCP level — there is no server
        left to answer with a status code.</p>
        <p>The window is between the moment the process receives SIGTERM and the moment the load
        balancer stops routing to it, and the load balancer is always the slower of the two.</p>
        <p>Two changes, neither in the application code:</p>
        <ol>
          <li><strong>A preStop hook</strong> that sleeps longer than the load balancer takes to notice.
          The pod keeps serving normally while it is removed from rotation. Five to fifteen seconds is
          typical, and it must exceed probe interval × failure threshold.</li>
          <li><strong>A readiness probe that flips on <code>ApplicationStopping</code></strong>, so the
          load balancer is told rather than left to discover it by a failed check.</li>
        </ol>
        <p>Note the ordering these imply: the pod must report unready <em>before</em> it stops accepting
        connections. Buying the time in which those two facts differ is the entire purpose of the
        preStop sleep.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>A cache takes 3 seconds to load and every request needs it. Which of these can serve a request
    before the cache is ready, and which would you actually ship?</p>
    <pre data-lang="text" data-title="Three candidate places"><code>a. in Program.cs, after Build() and before Run()
b. in IHostedService.StartAsync
c. in BackgroundService.ExecuteAsync</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Only (c) can serve early.</strong> Measured:</p>
        <pre data-lang="console" data-title="05-exercises.cs"><code>   placement                    warm-up done   port open   served early?
   ---------                    ------------   ---------   -------------
   b. IHostedService.StartAsync        307 ms      309 ms              no
   c. BackgroundService                316 ms        4 ms             YES</code></pre>
        <p>(a) and (b) are safe for the same reason: the server is not listening yet, so no request can
        exist. (c) is not — <code>ExecuteAsync</code> does not hold up startup, so the port opens while
        the cache is still loading.</p>
        <p><strong>But "safe" is not "correct", and the costs of (a) and (b) are the interesting
        part:</strong></p>
        <ul>
          <li><strong>The port does not open for 3 seconds.</strong> A TCP startup probe sees a closed
          port and, with a short threshold, restarts the pod before it can ever finish loading. That is
          a crash loop caused by a warm-up that works.</li>
          <li><strong>A failure there is fatal.</strong> An exception in <code>StartAsync</code> stops
          the host. That is usually what you want — refusing to start beats serving wrong answers — but
          it must be a deliberate choice.</li>
          <li><strong>Three seconds is added to every deploy</strong>, per pod.</li>
        </ul>
        <p><strong>What to ship:</strong> warm up in a <code>BackgroundService</code> <em>and</em> report
        unhealthy from a readiness check until it is done. The port opens immediately so probes are
        satisfied, no traffic is routed until the cache is ready, and it removes the dependency on
        hosted-service ordering entirely.</p>
        <p>Use (a) or (b) when the work is fast and must have happened — database migrations are the
        standard example. Use the health-check approach when it is slow.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Set the shutdown budget for a service where the slowest endpoint legitimately takes 20 s, the
    load balancer takes up to 6 s to stop routing, a background worker finishes its batch within 2 s,
    and connection teardown adds about 1 s. Give preStop sleep, <code>ShutdownTimeout</code>, and
    <code>terminationGracePeriodSeconds</code>.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Setting</th><th>Value</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>preStop sleep</td><td><strong>10 s</strong></td><td>Must exceed the 6 s the load balancer needs, with margin. The pod serves normally throughout.</td></tr>
              <tr><td><code>ShutdownTimeout</code></td><td><strong>25 s</strong></td><td>Must exceed the slowest endpoint (20 s), not the average. The worker's 2 s fits inside.</td></tr>
              <tr><td><code>terminationGracePeriodSeconds</code></td><td><strong>40 s</strong></td><td>10 + 25 + 1 = 36, rounded up for margin.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>The ordering constraint is the point:</strong></p>
        <pre data-lang="text" data-title="The ordering constraint"><code>preStop + ShutdownTimeout + teardown  &lt;  terminationGracePeriodSeconds</code></pre>
        <p>If it is violated, SIGKILL arrives mid-drain and every in-flight request dies — the graceful
        shutdown you configured never gets to finish. Both defaults are 30 s, so the out-of-the-box
        configuration violates it the moment you add a preStop hook.</p>
        <p>Two follow-ups worth stating:</p>
        <ul>
          <li><strong>The 20-second endpoint is the real problem.</strong> It forces a 40-second grace
          period, which makes every deploy and every scale-down slow. Moving reports to a job queue
          would let the whole budget drop to about 15 s.</li>
          <li><strong>None of this survives SIGKILL.</strong> An out-of-memory kill or a lost machine
          gives no notice at all. The budget reduces how often you need work to be idempotent and
          restartable; it never removes the need.</li>
        </ul>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is the difference between the service <em>collection</em> and the service
    <em>provider</em>, and what does <code>Build()</code> do?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The collection is a mutable list of registrations. The provider is
        the container built from it, which constructs things on demand. <code>Build()</code> creates the
        provider and freezes the list — registering afterwards throws.</p></div></details></li>

    <li><p>When does <code>AddSingleton&lt;T&gt;()</code> construct a <code>T</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>On first resolution, not at registration and not at startup. Which
        is why <code>ValidateOnBuild</code> is worth turning on: it forces the check at startup
        instead.</p></div></details></li>

    <li><p>In what order does middleware see the request and the response?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Registration order in, reverse order out. Each one wraps everything
        registered after it, so exception handling goes first and authorisation goes after
        routing.</p></div></details></li>

    <li><p>Do your hosted services start before or after Kestrel opens its port?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Before. The web host service is registered during
        <code>Build()</code>, which puts it last, and hosted services start in registration order. So a
        slow <code>StartAsync</code> delays the port opening, and one that hangs means it never
        opens.</p></div></details></li>

    <li><p>How does <code>BackgroundService.ExecuteAsync</code> differ from
    <code>IHostedService.StartAsync</code> at startup?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Startup waits for <code>StartAsync</code> to return. It does
        <em>not</em> wait for <code>ExecuteAsync</code> — <code>BackgroundService.StartAsync</code>
        returns at the first incomplete await inside it.</p></div></details></li>

    <li><p>In what order do hosted services stop?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Reverse registration order, like nested <code>using</code> blocks —
        whatever started last may depend on what started first.</p></div></details></li>

    <li><p>Which lifecycle event should flip a readiness probe to unhealthy, and why that one?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>ApplicationStopping</code>. It fires before anything has
        actually stopped, so it is the earliest moment the load balancer can learn to stop routing.
        <code>ApplicationStopped</code> is too late to be useful for anything but a log
        line.</p></div></details></li>

    <li><p>A worker passes its <code>stoppingToken</code> to every <code>await</code>. Is its shutdown
    correct?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Not necessarily. That makes it stop <em>promptly</em>, and it will
        still abandon whatever it was holding when cancellation arrived — measured at 5 lost items per
        shutdown. Cancellation means stop taking new work; finishing the work already taken is a
        separate step you write yourself.</p></div></details></li>

    <li><p>Graceful shutdown is working. Why do deploys still return connection errors?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The listening socket closes immediately, and the load balancer keeps
        routing to it for seconds afterwards. Requests arriving in that window are refused at the TCP
        level. The fix is a preStop hook plus a readiness probe that flips on
        <code>ApplicationStopping</code>.</p></div></details></li>

    <li><p>Why must <code>ShutdownTimeout</code> be shorter than
    <code>terminationGracePeriodSeconds</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Because when the grace period expires the orchestrator sends
        <code>SIGKILL</code>, which cannot be caught. If .NET is still draining, everything in flight
        dies. Budget preStop + <code>ShutdownTimeout</code> + about a second of teardown, and keep the
        total under the grace period. Both defaults are 30 s.</p></div></details></li>

    <li><p>Why should a liveness probe never check the database?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Liveness asks "is this process broken?", and its remedy is a
        restart. Restarting cannot fix somebody else's database, so a dependency blip would restart every
        pod at once — turning a brief degradation into an outage. Dependency checks belong in
        readiness.</p></div></details></li>

    <li><p>Which two container validation options are off in Production by default, and what do they
    catch?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>ValidateScopes</code> (on in Development, off in Production)
        catches captive dependencies and scoped resolution from the root provider.
        <code>ValidateOnBuild</code> (off everywhere) fails at startup on anything that cannot be
        constructed. Turn both on in every environment.</p></div></details></li>
  </ol>
</section>
`
});
