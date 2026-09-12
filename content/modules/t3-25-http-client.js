CSPREP.module({
  id: "t3-25-http-client",
  minutes: 55,
  updated: "2026-09-08",
  summary: "Checkout started failing every outbound call - including calls to a service it used twice a minute - while both services it called were perfectly healthy. The cause was one line: an HttpClient created per call. Measured: 50 calls opening 50 connections against 1, a machine's port budget exhausted by one caller and taken from everybody, a client that never resolved a name again after a failover, and a timeout that stopped applying the moment the response headers arrived.",
  terms: ["HttpClient", "HttpMessageHandler", "SocketsHttpHandler", "connection pool", "ephemeral port",
    "TIME_WAIT", "IHttpClientFactory", "handler lifetime", "PooledConnectionLifetime", "typed client",
    "named client", "delegating handler", "HttpCompletionOption", "ConnectTimeout", "budget"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A service that calls another service over HTTP needs a client. .NET has had one for over a decade,
  it is called <code>HttpClient</code>, and using it the way its shape suggests will take your service
  down.</p>

  <p>At 16:02 Ledger's checkout started failing outbound calls. Pricing was checked and was healthy: no
  errors, normal latency. At 16:06 the audit service — called about twice a minute — started failing
  too. Restarting checkout fixed it for roughly ten minutes, then it came back.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   SocketException: Only one usage of each socket address (protocol/network
   address/port) is normally permitted.</code></pre>

  <p>Nothing was wrong with either service being called. The caller had run out of sockets.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   pricing calls attempted            300
   pricing calls that failed          105
   audit calls attempted              10
   audit calls that failed            2
   peak ports held                    200 of 200
   took                               934 ms</code></pre>

  <p>The same workload, with one line changed:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   pricing calls that failed          0
   audit calls that failed            0
   peak ports held                    4 of 200
   took                               162 ms</code></pre>

  <div class="callout callout--note">
    <h4>The line was <code>using var client = new HttpClient()</code></h4>
    <p>Which is the shape every disposable object in .NET is written with, in a class that implements
    <code>IDisposable</code>, and it is wrong here in a way nothing warns you about.</p>
  </div>
</section>

<section id="what-it-is">
  <h2>What <code>HttpClient</code> actually is</h2>

  <p class="define"><span class="define__term">HttpClient</span> A thin object holding a base address, a
  default timeout and default headers. It does not open connections and it does not own a pool — it
  delegates to a handler.</p>

  <p class="define"><span class="define__term">HttpMessageHandler</span> The thing that actually sends a
  request. Handlers chain: a delegating handler wraps another handler, ending at a primary handler that
  does the network work.</p>

  <p class="define"><span class="define__term">SocketsHttpHandler</span> The primary handler on modern
  .NET. It holds the connection pool, the DNS results, and the settings that matter most in this module
  — <code>PooledConnectionLifetime</code> and <code>ConnectTimeout</code>.</p>

  <p class="define"><span class="define__term">Connection pool</span> A set of open TCP connections kept
  by one handler, reused across requests to the same host. Not shared between handlers.</p>

  <p>That last point is the whole of the incident. <strong>The expensive resource belongs to the
  handler, not to the client</strong>, and the client is what looks disposable.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>An <code>HttpClient</code> is a phone handset and the handler is the line. Picking up a different
  handset costs nothing; installing a new line each time you make a call costs a great deal, and the old
  line stays reserved for a while after you hang up.</p>

  <p>Where the analogy stops is that the lines are not yours. They come from a pool the whole machine
  shares, so a service that installs a line per call eventually takes the last one — and then every
  other program on that machine, calling services it has no connection to yours with, fails too.</p>

  <h3>And a call has three outcomes, not two</h3>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   what was asked for        status               did it throw?
   ------------------        ------               -------------
   a payment that exists     200 OK               no
   one that does not         404 NotFound         no
   one the ledger fails on   500 InternalServerError no</code></pre>

  <p>Nothing threw. <code>HttpClient</code> treats 404 and 500 as answers, because they are: the request
  was sent, a server replied, and the reply says no. An exception is for a request that could not be
  answered at all.</p>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   AND WHEN THERE IS NOTHING TO TALK TO:
     exception    TaskCanceledException
     inner        TimeoutException
     status       none - there was no response
     failed after 636 ms</code></pre>

  <p>So the three outcomes are <strong>succeeded</strong>, <strong>failed with an answer</strong> (a
  status code, and usually a body saying why), and <strong>failed without one</strong> (an exception,
  with <code>StatusCode</code> null). Code that models two of those gets the third wrong silently, and
  the exercises open with an example that cost 1,400 orders.</p>

  <div class="callout callout--gotcha">
    <h4>The closed port did not refuse the connection</h4>
    <p>That measurement was against a port whose server had been stopped. A refusal is supposed to be
    immediate; here the attempt was dropped and the only thing that ended it was
    <code>ConnectTimeout</code>. <strong>"The address is wrong" can present as a slow service rather
    than a broken one</strong>, which is why <code>ConnectTimeout</code> exists separately from the
    overall timeout.</p>
  </div>
</section>

<section id="lifetime">
  <h2>The lifetime problem, in both directions</h2>

  <pre data-lang="console" data-title="01-lifetime-and-connections.cs output"><code>   how the client is managed         connections the server saw      took
   -------------------------         --------------------------      ----
   a new HttpClient every call                               50    545 ms
   one HttpClient, reused                                     1     32 ms</code></pre>

  <p>The server counted those, so it is not an inference. Each new <code>HttpClient</code> brings its own
  handler and therefore its own pool, so it cannot reuse anything, and disposing it throws the connection
  away.</p>

  <p class="define"><span class="define__term">Ephemeral port</span> The local port number an outbound
  connection uses. The operating system hands them out from a fixed range — on Windows, 49152 to 65535,
  so 16,384 of them for the whole machine.</p>

  <p class="define"><span class="define__term">TIME_WAIT</span> The state a closed connection sits in
  before its port can be reused, so that late packets from the old connection are not delivered to a new
  one. On Windows it lasts about four minutes.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   Windows hands out ports 49152-65535 by default:      16,384
   TIME_WAIT holds each one for:                     240 seconds
   So the sustainable rate of NEW connections is:
                              16,384 / 240  =  68 per second</code></pre>

  <p>A service handling 100 requests a second, each making one outbound call with a fresh client, needs
  100 ports a second. It exhausts the range in under three minutes and cannot recover while the load
  continues, because ports come back at 68 a second and it is spending 100.</p>

  <div class="callout callout--why">
    <h4>Which explains the two confusing symptoms</h4>
    <p><strong>The audit service failed</strong> because ports are a machine resource. Whoever exhausts
    them takes them from every other caller on that machine, so the errors name services that have
    nothing to do with the problem.</p>
    <p><strong>Restarting helped for ten minutes</strong> because a restart does not return the ports —
    <code>TIME_WAIT</code> is kernel state and outlives the process. It returns an empty connection pool,
    which buys exactly as long as it takes to fill again.</p>
  </div>

  <h3>So share one client — and meet the other failure</h3>

  <pre data-lang="console" data-title="01-lifetime-and-connections.cs output"><code>   PooledConnectionLifetime    six calls over 1.2 s opened
   ------------------------    ---------------------------
   infinite (the default)                                1
   300 ms                                                3</code></pre>

  <p>One connection, held for as long as the client exists. Efficient, and it means a static client never
  notices that anything has changed. Two servers and a name that fails over from one to the other:</p>

  <pre data-lang="console" data-title="01-lifetime-and-connections.cs output"><code>   PooledConnectionLifetime infinite (the default)
     name lookups            1
     reached                 blue blue blue blue blue blue blue blue
     after the failover      blue blue blue blue

   PooledConnectionLifetime 300 ms
     name lookups            4
     reached                 blue blue blue blue green green green green
     after the failover      green green green green</code></pre>

  <p>One lookup. Every call after the failover went to a server the name no longer points at. Nothing was
  cached wrongly and no TTL was ignored — <strong>the client never had a reason to ask, because the
  connection it already had was still open.</strong></p>

  <div class="callout callout--gotcha">
    <h4>This is why the fix is a connection lifetime, not a DNS setting</h4>
    <p>Nothing in the resolver can help a client that is not resolving. And it is why "restarting the pod
    fixes it" is the classic symptom: a restart is the only event that reliably forces a new connection,
    so the pods that were restarted recover and the ones that were not stay broken.</p>
  </div>

  <p>Both failures come from the same fact stated two ways. A connection is expensive to create and
  expensive to keep, and the right answer is neither "one per call" nor "one forever" but
  <strong>reuse, with an expiry</strong>.</p>

  <pre data-lang="csharp" data-net="10" data-title="The whole fix, if you are wiring a client by hand"><code>var handler = new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(2),
    ConnectTimeout = TimeSpan.FromSeconds(2)
};

// One of these for the life of the application.
var client = new HttpClient(handler);</code></pre>
</section>

<section id="the-factory">
  <h2><code>IHttpClientFactory</code>, and what it actually pools</h2>

  <p class="define"><span class="define__term">IHttpClientFactory</span> A registered service that hands
  out <code>HttpClient</code> instances over handlers it manages and reuses.</p>

  <p class="define"><span class="define__term">Handler lifetime</span> How long the factory keeps using
  one handler chain before building a new one. The default is two minutes.</p>

  <pre data-lang="console" data-title="02-factory-and-typed-clients.cs output"><code>   distinct HttpClient objects created   20
   connections the server saw            1</code></pre>

  <p><strong>The factory does not pool <code>HttpClient</code>.</strong> It pools the handler underneath,
  which is where the connection pool lives, so twenty clients over one handler cost nothing and share one
  connection.</p>

  <p>Every one of those twenty was disposed, and the connection survived — the client does not own the
  handler. That is deliberate: it means <code>using var client = factory.CreateClient()</code> is
  correct, which is the shape people write out of habit.</p>

  <pre data-lang="console" data-title="02-factory-and-typed-clients.cs output"><code>   handler lifetime            eight calls over 3.2 s opened
   ----------------            -----------------------------
   1 s                                                     3
   infinite                                                1</code></pre>

  <p>Rotating the handler is the factory's answer to the DNS problem: a new handler means a new
  connection, and a new connection means the name is resolved again. Two minutes rather than never.</p>

  <h3>The advice about capturing a client is out of date</h3>

  <p>Nearly everything written about <code>IHttpClientFactory</code> says that holding a client in a
  field defeats it — the handler is frozen and you are back to a stale connection. This module was
  written expecting to measure exactly that:</p>

  <pre data-lang="console" data-title="02-factory-and-typed-clients.cs output"><code>   how the client is obtained                  eight calls over 3.2 s opened
   --------------------------                  -----------------------------
   factory.CreateClient() per call                                         3
   factory.CreateClient() once, then held                                  3</code></pre>

  <p>Identical. The reason is visible by reflecting on the handler the factory built:</p>

  <pre data-lang="console" data-title="02-factory-and-typed-clients.cs output"><code>   named client        handler lifetime   PooledConnectionLifetime on it
   ------------        ----------------   ------------------------------
   pricing             1 s                00:00:01
   pricing-static      infinite           -00:00:00.0010000</code></pre>

  <p><strong>The factory copies the handler lifetime onto the connection pool.</strong> So the connection
  expires on schedule whether or not anybody ever asks for a new client, and the DNS problem is solved
  even for a captured one. (The infinite row prints as a negative timespan because that is how
  <code>Timeout.InfiniteTimeSpan</code> renders: minus one millisecond.)</p>

  <p>What capturing still breaks is everything else in the chain:</p>

  <pre data-lang="console" data-title="02-factory-and-typed-clients.cs output"><code>   how the client is obtained                  handler chains built
   --------------------------                  --------------------
   factory.CreateClient() per call                                3
   factory.CreateClient() once, then held                         1</code></pre>

  <p class="define"><span class="define__term">Delegating handler</span> A handler that wraps another
  one — the client-side equivalent of middleware. Where authentication, logging, retries and headers
  belong.</p>

  <pre data-lang="csharp" data-net="10" data-title="Where cross-cutting concerns belong on the client side"><code>public sealed class AuthHandler(ITokenSource tokens) : DelegatingHandler
{
    protected override async Task&lt;HttpResponseMessage&gt; SendAsync(
        HttpRequestMessage request,
        CancellationToken token)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer", await tokens.GetAsync(token));

        HttpResponseMessage response = await base.SendAsync(request, token);

        // One place that knows what a 401 means for this dependency, rather
        // than every call site guessing.
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            tokens.Invalidate();
        }

        return response;
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Registered onto the chain, in order"><code>builder.Services.AddTransient&lt;AuthHandler&gt;();

builder.Services.AddHttpClient&lt;PricingClient&gt;()
    .AddHttpMessageHandler&lt;AuthHandler&gt;();</code></pre>

  <p>Those handlers are built once and never again. Anything they hold is held for the life of the
  process: a cached token, a snapshot of options, a circuit breaker's state, a service resolved from the
  scope the factory created for that chain. And the expired chain is never disposed, because the factory
  only disposes one after the client holding it has been collected — a captured client pins its chain,
  and the scope behind it, forever.</p>

  <div class="callout callout--why">
    <h4>The rule survives, with a different reason behind it</h4>
    <p>Create the client where you use it. Not because the connection would go stale — it will not — but
    because everything you configured around the connection would.</p>
  </div>
</section>

<section id="typed-clients">
  <h2>Named and typed clients</h2>

  <p class="define"><span class="define__term">Named client</span> A configuration registered under a
  string and fetched with <code>factory.CreateClient("name")</code>.</p>

  <p class="define"><span class="define__term">Typed client</span> A class that takes an
  <code>HttpClient</code> in its constructor. The factory builds both, so the calling code never sees a
  handler, a base address or a name.</p>

  <pre data-lang="csharp" data-net="10" data-title="Three registrations, one mechanism"><code>// Plain: enables the factory, nothing configured.
builder.Services.AddHttpClient();

// Named: fetched with factory.CreateClient("pricing").
builder.Services.AddHttpClient("pricing", client =&gt;
    client.BaseAddress = new Uri("https://pricing.internal"));

// Typed: injected as PricingClient, which is the one to reach for.
builder.Services.AddHttpClient&lt;PricingClient&gt;(client =&gt;
    client.BaseAddress = new Uri("https://pricing.internal"));</code></pre>

  <p>A typed client is worth preferring for a reason that has nothing to do with connections: it puts the
  URL shapes, the status handling and the deserialisation in one class, so the rest of the application
  calls a method rather than building a request. The base address is set once instead of at every call
  site, and it is testable without a server.</p>

  <pre data-lang="csharp" data-net="10" data-title="The class itself is ordinary"><code>public sealed class PricingClient(HttpClient http)
{
    public async Task&lt;Price?&gt; GetPriceAsync(string id, CancellationToken token)
    {
        HttpResponseMessage response = await http.GetAsync($"/v1/prices/{id}", token);

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync&lt;Price&gt;(token);
    }
}</code></pre>

  <p>The registration is also where resilience goes, and in a real service it is one line rather than a
  hand-written retry loop:</p>

  <pre data-lang="csharp" data-net="10" data-title="What a production registration usually looks like"><code>builder.Services.AddHttpClient&lt;PricingClient&gt;(client =&gt;
{
    client.BaseAddress = new Uri("https://pricing.internal");

    // A backstop against a hang, not a budget. The budget is a token.
    client.Timeout = TimeSpan.FromSeconds(5);
})
.ConfigurePrimaryHttpMessageHandler(() =&gt; new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(2),
    ConnectTimeout = TimeSpan.FromSeconds(2)
})
// From Microsoft.Extensions.Http.Resilience: a per-attempt timeout, a retry
// with backoff and jitter, a circuit breaker and a concurrency limit, as one
// delegating handler.
.AddStandardResilienceHandler();</code></pre>

  <p class="define"><span class="define__term">Circuit breaker</span> A component that stops calling a
  dependency at all after enough consecutive failures, failing immediately for a while before letting a
  trial call through. It exists so that a failing dependency costs one fast failure rather than one
  timeout per request.</p>

  <p class="define"><span class="define__term">Backoff</span> Waiting longer before each successive
  retry, usually with a random component (<em>jitter</em>) so that every caller does not retry in step and
  arrive together.</p>

  <pre data-lang="console" data-title="02-factory-and-typed-clients.cs output"><code>   two resolutions of PricingClient are the same object   False</code></pre>

  <p><code>AddHttpClient&lt;T&gt;</code> registers <code>T</code> as <strong>transient</strong> — a
  fresh instance every time, each with a fresh <code>HttpClient</code> over the current handler chain.
  Which means injecting one into a singleton captures it for the life of the application.</p>

  <div class="callout callout--gotcha">
    <h4>And there is no compiler help for that one</h4>
    <p>Injecting a <em>scoped</em> service into a singleton throws at startup with scope validation on.
    Injecting a transient into a singleton is legal, silent, and permanent. The measurement above says
    the connection still recycles, so the symptom is not a stale address — it is a handler chain, and
    everything in it, that never changes again.</p>
  </div>
</section>

<section id="timeouts">
  <h2>Timeouts, of which there are four</h2>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>     HttpClient.Timeout                 00:01:40
     an error status throws             no
     connections are recycled after     never (PooledConnectionLifetime is infinite)</code></pre>

  <p>100 seconds is not a timeout, it is a backstop. No user waits 100 seconds, and a service holding a
  request for 100 seconds has held a thread, a connection and a scope for 100 seconds.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Setting</th><th>Bounds</th><th>Default</th></tr>
      </thead>
      <tbody>
        <tr><td><code>ConnectTimeout</code></td><td>Opening the TCP connection</td><td>Infinite</td></tr>
        <tr><td><code>HttpClient.Timeout</code></td><td>The whole request — with a caveat below</td><td>100 s</td></tr>
        <tr><td>A <code>CancellationToken</code></td><td>Everything, including a streamed body read</td><td>None</td></tr>
        <tr><td>Your own budget</td><td>The whole operation, retries included</td><td>None</td></tr>
      </tbody>
    </table>
  </div>

  <p>All four, set in the two places they belong:</p>

  <pre data-lang="csharp" data-net="10" data-title="Two on the registration, two at the call site"><code>// On the registration: the connect timeout and the backstop.
builder.Services.AddHttpClient&lt;PricingClient&gt;(client =&gt;
    client.Timeout = TimeSpan.FromSeconds(5))
.ConfigurePrimaryHttpMessageHandler(() =&gt; new SocketsHttpHandler
{
    ConnectTimeout = TimeSpan.FromSeconds(2),
    PooledConnectionLifetime = TimeSpan.FromMinutes(2)
});

// At the call site: the budget for the operation, and the caller's token.
using var operation = CancellationTokenSource.CreateLinkedTokenSource(callerToken);
operation.CancelAfter(TimeSpan.FromMilliseconds(800));</code></pre>

  <div class="callout callout--why">
    <h4>Why the budget cannot live on the registration</h4>
    <p><code>HttpClient.Timeout</code> is one number for every call the client makes, and it is set
    before any caller exists. A budget belongs to the operation: the caller knows how long it has, a
    retry loop needs to consult it, and a caller who has less time than you assumed can shorten it. Only
    a token can carry that.</p>
  </div>

  <h3>The caveat, which is the module's sharpest measurement</h3>

  <p class="define"><span class="define__term">HttpCompletionOption</span> Whether
  <code>SendAsync</code> returns once the whole response is buffered
  (<code>ResponseContentRead</code>, the default) or as soon as the headers arrive
  (<code>ResponseHeadersRead</code>).</p>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the response is read              outcome                     after
   ------------------------              -------                     -----
   ResponseContentRead (the default)     TaskCanceledException          708 ms
   ResponseHeadersRead                   headers at    3 ms, body read     3101 ms
   ResponseHeadersRead + a token         TaskCanceledException          705 ms</code></pre>

  <p>The timeout was 700 ms in all three rows. In the middle one the body read took 3,101 ms and nothing
  fired. <strong><code>HttpClient.Timeout</code> stops applying once the headers have arrived</strong>,
  if you asked for <code>ResponseHeadersRead</code> — the call has returned, and the read that follows is
  outside its reach.</p>

  <p>A <code>CancellationToken</code> does cover it, which is a good reason to pass one even when a
  timeout is set.</p>

  <h3>And a per-attempt timeout is not a budget</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the retries are bounded          attempts made        total time
   ---------------------------          -------------        ----------
   per-attempt timeout only                         3         1157 ms
   one budget for the whole operation               2          506 ms</code></pre>

  <p>Three attempts at 300 ms with 100 ms between them is 1,157 ms for a call with a 500 ms budget — so
  the timeout meant to protect the page more than doubled what the page can be made to wait. The second
  row is the same retry loop with one linked token bounding the whole operation, stopping mid-sequence
  when the budget is gone.</p>

  <pre data-lang="csharp" data-net="10" data-title="Two timeouts, nested"><code>// The budget for the whole operation, and the caller's token, together.
// Whichever ends first ends the call.
using var operation = CancellationTokenSource.CreateLinkedTokenSource(callerToken);
operation.CancelAfter(TimeSpan.FromMilliseconds(800));

for (int attempt = 1; attempt &lt;= 3; attempt++)
{
    // Each attempt gets its own shorter deadline, inside the budget.
    using var perAttempt = CancellationTokenSource.CreateLinkedTokenSource(operation.Token);
    perAttempt.CancelAfter(TimeSpan.FromMilliseconds(400));

    try
    {
        return await http.GetAsync($"/v1/prices/{id}", perAttempt.Token);
    }
    catch (OperationCanceledException) when (operation.IsCancellationRequested)
    {
        // The budget is gone, not merely this attempt. Stop here.
        throw;
    }
    catch (OperationCanceledException)
    {
        // This attempt ran out of time; the budget has not. Try again.
    }
}</code></pre>

  <h3>Telling a timeout from a cancellation</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   what actually happened     exception                  inner
   ----------------------     ---------                  -----
   our timeout elapsed        TaskCanceledException      TimeoutException
   the caller cancelled       TaskCanceledException      TaskCanceledException</code></pre>

  <p>Both are <code>TaskCanceledException</code> and both have an inner exception, so the test is not
  whether one exists — it is specifically <code>TimeoutException</code>:</p>

  <pre data-lang="csharp" data-net="10" data-title="The one clause that separates them"><code>catch (TaskCanceledException exception)
    when (exception.InnerException is TimeoutException)
{
    // The dependency ran out of time. This belongs on a dashboard.
}
catch (OperationCanceledException) when (callerToken.IsCancellationRequested)
{
    // The caller gave up. Nobody is waiting; drop it quietly and do not retry.
}</code></pre>

  <p>These need opposite handling. Treating both as errors makes a browser refresh look like an outage;
  treating both as normal hides a real one.</p>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   what was asked for                 outcome                          took
   ------------------                 -------                          ----
   an ordinary price                  found, 4999                       382 ms
   one that does not exist            missing                             6 ms
   one the database is broken for     failed: three attempts failed     215 ms
   one that will not answer in time   failed: the budget ran out        806 ms

   the reason the dependency gave, kept   "The pricing database is unavailable."
   attempts made on the slow call         2
   calls that outran their budget         1</code></pre>

  <p>The registration is where most of the decisions live:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// DECISION 1: a typed client, registered with the factory. Nothing in the
// application ever writes 'new HttpClient()'.
builder.Services.AddHttpClient&lt;PricingClient&gt;(client =&gt;
{
    // DECISION 2: a backstop, not a budget. The per-call budget is a token.
    client.Timeout = TimeSpan.FromSeconds(5);
})
// DECISION 3: connections are recycled, so a failover is noticed. Set here
// as well as through the handler lifetime, because it survives a client
// that somebody captures.
.ConfigurePrimaryHttpMessageHandler(() =&gt; new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(2),
    ConnectTimeout = TimeSpan.FromSeconds(2)
});</code></pre>

  <p>And the client models all three outcomes in its return type, so a caller cannot forget one:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// Three outcomes, in the type, so a caller cannot forget one.
public abstract record PriceResult
{
    public sealed record Found(Price Price) : PriceResult;

    public sealed record Missing : PriceResult;

    public sealed record Failed(string Reason) : PriceResult;
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>                if (response.StatusCode == HttpStatusCode.NotFound)
                {
                    // An answer, not a failure, and never worth retrying.
                    return new PriceResult.Missing();
                }

                if (response.IsSuccessStatusCode)
                {
                    Price? price = await response.Content.ReadFromJsonAsync&lt;Price&gt;(perAttempt.Token);

                    return price is null
                        ? new PriceResult.Failed("the response body was empty")
                        : new PriceResult.Found(price);
                }

                // Read the reason before deciding anything. This is the line
                // EnsureSuccessStatusCode would have skipped.
                string body = await response.Content.ReadAsStringAsync(perAttempt.Token);

                LastReason = Summarise(body);

                if (!IsRetryable(response.StatusCode))
                {
                    return new PriceResult.Failed($"{(int)response.StatusCode}, {LastReason}");
                }</code></pre>

  <p>Note that <em>missing</em> is not a failure — a 404 is an answer, and it is never worth retrying.
  Note too that the failure body is read before anything is decided: the dependency said why, and
  <code>EnsureSuccessStatusCode</code> would have thrown that away.</p>

  <div class="callout callout--why">
    <h4>What it still does not decide</h4>
    <p>The budget: 800 ms is a number in a file. In a real system it comes from what the person waiting
    will tolerate, and each hop spends a share of it.</p>
    <p>And whether to retry at all. Retries help with a dropped packet or a restarting instance. Against
    a dependency that is slow because it is overloaded they multiply the load at the worst moment — and a
    retry of a non-idempotent call is a second charge, not a second attempt.</p>
  </div>

  <p>In a real service the hand-written retry loop would be
  <code>AddStandardResilienceHandler</code> from <code>Microsoft.Extensions.Http.Resilience</code>, which
  brings a circuit breaker, a bounded concurrency limit and a per-attempt timeout as one delegating
  handler. It is written out by hand here so that nothing is hidden.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>A client per call</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a connection and a port per call"><code>public async Task&lt;Price?&gt; GetPriceAsync(string id)
{
    // Correct-looking, and the cause of the incident. A new client is a new
    // handler is a new pool, so nothing is ever reused - and the socket this
    // discards holds its port for four minutes.
    using var client = new HttpClient();

    return await client.GetFromJsonAsync&lt;Price&gt;($"https://pricing.internal/v1/prices/{id}");
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right - the client is injected, and the method is the API"><code>public sealed class Checkout(PricingClient pricing)
{
    public async Task&lt;Order&gt; PlaceAsync(string sku, CancellationToken token)
    {
        // No client construction, no base address, no handler decision, and
        // no lifetime to get wrong - the registration made all of those once.
        Price? price = await pricing.GetPriceAsync(sku, token);

        return price is null
            ? throw new UnknownSkuException(sku)
            : new Order(sku, price.AmountMinor);
    }
}</code></pre>

  <h3>One client, forever, with no expiry</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - resolves the name once and never again"><code>// The usual over-correction. It fixes the ports and creates the failover bug:
// PooledConnectionLifetime defaults to infinite, so this connection - and the
// address behind it - outlives every deploy of the service it calls.
private static readonly HttpClient Http = new();</code></pre>

  <h3>Capturing a factory client in a singleton</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the chain is built once and pinned forever"><code>public sealed class PriceCache
{
    private readonly HttpClient http;

    // A singleton constructor. The connection will still recycle - but this
    // handler chain, its auth handler, its options snapshot and the scope
    // behind it are now fixed for the life of the process.
    public PriceCache(IHttpClientFactory factory) =&gt; http = factory.CreateClient("pricing");
}</code></pre>

  <h3>Treating an error status as a result</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the call was written                        what happened
   ------------------------                        -------------
   GetAsync + ReadFromJsonAsync                    returned Price(amountMinor=0)
   GetFromJsonAsync                                threw HttpRequestException
   GetAsync, then check the status                 500, body 181 bytes, kept for the log</code></pre>

  <p class="define"><span class="define__term">ProblemDetails</span> The standard JSON shape for an HTTP
  error — a type, a title, a status and a human-readable detail. Well-behaved services send one with a
  failure, which is exactly what makes the next measurement possible.</p>

  <p>A 500 with a JSON body is still JSON. <code>ReadFromJsonAsync</code> parsed a ProblemDetails
  document into a <code>Price</code> and defaulted every property it did not find. Zero is not a sentinel
  there — it is what an <code>int</code> is when nothing set it.</p>

  <div class="callout callout--gotcha">
    <h4>Two conveniences that are not the same convenience</h4>
    <p><code>GetFromJsonAsync</code> calls <code>EnsureSuccessStatusCode</code> for you.
    <code>GetAsync</code> followed by <code>ReadFromJsonAsync</code> does not. They look
    interchangeable and one of them is silent about failure.</p>
  </div>

  <h3>Throwing the reason away</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the diagnosis is discarded before anyone reads it"><code>HttpResponseMessage response = await http.GetAsync($"/v1/prices/{id}", token);

// Throws before anybody reads the body, so "The pricing database is
// unavailable" - which the other service went to the trouble of sending -
// never reaches a log.
response.EnsureSuccessStatusCode();</code></pre>

  <h3>Retrying everything</h3>

  <p class="define"><span class="define__term">Idempotent</span> Safe to repeat: doing it twice leaves
  the system in the same state as doing it once. <code>GET</code> and <code>DELETE</code> are;
  <code>POST</code> usually is not, unless the server was given a key to recognise the repeat by.</p>

  <p>A 400 or a 404 will not become a different answer. Retrying them spends the budget on a certainty.
  And a retry of a non-idempotent call is a second charge, not a second attempt — which matters most
  precisely when you cannot tell: a call that timed out may have been received, executed and
  acknowledged into a connection nobody was listening on any more.</p>

  <h3>Streaming without a token</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - no timeout applies to this read"><code>// Timeout is set on the client, and it stops applying at this line, because
// the call has already returned.
HttpResponseMessage response = await http.GetAsync(
    url, HttpCompletionOption.ResponseHeadersRead);

// Measured at 3,101 ms against a 700 ms timeout. A partner that dribbles a
// body can hold this open for as long as it likes.
string body = await response.Content.ReadAsStringAsync();</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right - one token covering both halves"><code>using var budget = CancellationTokenSource.CreateLinkedTokenSource(callerToken);
budget.CancelAfter(TimeSpan.FromSeconds(30));

HttpResponseMessage response = await http.GetAsync(
    url, HttpCompletionOption.ResponseHeadersRead, budget.Token);

await using Stream stream = await response.Content.ReadAsStreamAsync(budget.Token);

// The token reaches the read itself, so a partner that stops sending mid-body
// ends this call rather than owning the thread.
await foreach (Report report in
    JsonSerializer.DeserializeAsyncEnumerable&lt;Report&gt;(stream, budget.Token))
{
    Handle(report);
}</code></pre>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <ol>
    <li><strong>Intermittent failures spread across unrelated dependencies means the caller.</strong>
    That is the signature of port exhaustion: whichever call needs a <em>new</em> connection while the
    range is empty fails, so the errors land on whoever happens to be reconnecting rather than on
    whoever caused it.</li>
    <li><strong>Count connections on the server, not clients on the caller.</strong> Every measurement in
    this module came from the far side of the socket, because the client side cannot tell you what it
    reused.</li>
    <li><strong>For "some instances work and some do not", suspect a connection that outlived a
    deploy.</strong> Especially when restarting fixes it — a restart is the only event that reliably
    forces re-resolution.</li>
    <li><strong>Read the inner exception of a <code>TaskCanceledException</code>.</strong> A
    <code>TimeoutException</code> inside means the dependency ran out of time; anything else means
    somebody cancelled.</li>
    <li><strong>For a call that hangs past its timeout, look for
    <code>ResponseHeadersRead</code>.</strong> The timeout stops at the headers, and only a token covers
    the body.</li>
    <li><strong>Compare the whole-operation latency against the per-attempt timeout.</strong> A p99 that
    is a multiple of the timeout is a retry loop with no budget.</li>
  </ol>

  <div class="callout callout--debug">
    <h4>Four things to watch</h4>
    <ul>
      <li><strong>Connections opened per second, per dependency.</strong> This should be near zero in
      steady state. Anything tracking your request rate is a client-per-call bug and a countdown to
      exhaustion.</li>
      <li><strong>Ephemeral ports in use on the host.</strong> The one number that predicts this outage
      rather than reporting it.</li>
      <li><strong>Timeouts as their own series</strong>, separate from other failures, and separate
      again from cancellations. Three different things that all arrive as
      <code>TaskCanceledException</code>.</li>
      <li><strong>Whole-operation latency, not per-attempt.</strong> Retries are invisible in per-call
      metrics and are exactly what a caller experiences.</li>
    </ul>
  </div>

  <p>And the review question: <strong>who owns this <code>HttpClient</code>, and when does its connection
  expire?</strong> If the answer to the first is "this method" or the answer to the second is "never",
  you have one of the two failures in this module.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"<code>HttpClient</code> is <code>IDisposable</code>, so dispose it"</h4>
    <p>It is, and the resource worth disposing lives in the handler. Disposing a per-call client is the
    incident; disposing a factory client is a measured no-op.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A static <code>HttpClient</code> is the fix"</h4>
    <p>It fixes the ports and creates the failover bug. It needs
    <code>PooledConnectionLifetime</code> as well, or the factory, which sets it for you.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"<code>IHttpClientFactory</code> pools <code>HttpClient</code> instances"</h4>
    <p>It pools handlers. Twenty clients over one handler shared one connection.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Capturing a factory client gives you a stale connection"</h4>
    <p>Measured, and it does not: the factory sets <code>PooledConnectionLifetime</code> to the handler
    lifetime, so the connection recycles anyway. What it freezes is the rest of the chain.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"An error status throws"</h4>
    <p>Only if you ask. A 500 is a successful HTTP exchange whose content says no.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"<code>HttpClient.Timeout</code> bounds the request"</h4>
    <p>Not once the headers have arrived under <code>ResponseHeadersRead</code>. 3,101 ms against a
    700 ms timeout.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Retries make a service more reliable"</h4>
    <p>Against a dropped packet, yes. Against an overload they triple the load at the worst possible
    moment, and without a budget they triple the latency your caller agreed to.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Raise the port range and the exhaustion goes away"</h4>
    <p>It moves the threshold. The service still needs one port per request forever; reusing the
    connection changes the requirement to approximately zero.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>The failure is machine-wide, and it names the wrong service</h4>
    <p>Ephemeral ports belong to the host, not to your client, your library or your dependency. A single
    badly-written call path takes them from every other caller in the process — so the alerts fire on the
    audit service, the graphs show the audit service, and the audit service is fine. Two of the ten audit
    calls in the measurement failed, intermittently, which is the hardest possible signal to read.</p>
  </div>

  <p>The second reason is that both failures are invisible in testing. A test suite makes a few hundred
  calls and never approaches the port range; a test environment has one address that never fails over.
  Neither the exhaustion nor the stale connection can appear until there is load or a deploy, which means
  the first time you see either is in production, at the worst moment, with a symptom that points
  somewhere else.</p>

  <p>The third is timeout layering, which is the part that generalises. Almost every outbound call in a
  production system needs three limits and usually has one: a connect timeout so a bad address fails
  fast, a per-attempt timeout so no single try hangs, and a budget for the whole operation that the retry
  loop consults. A service that sets only the middle one has made its worst case worse, because retries
  multiply it — and a service that sets none inherits the 100-second default, which is not a timeout at
  all.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>Pricing was down for six minutes. No exception was logged by checkout, no alert fired, and 1,400
    orders were written with an amount of 0.</p>
    <p>What did the calling code look like?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the call was written                        what happened
   ------------------------                        -------------
   GetAsync + ReadFromJsonAsync                    returned Price(amountMinor=0)
   GetFromJsonAsync                                threw HttpRequestException
   GetAsync, then check the status                 500, body 181 bytes, kept for the log</code></pre>
        <p>The first shape. A 500 with a JSON body is still JSON, so
        <code>ReadFromJsonAsync</code> parsed the ProblemDetails document into a <code>Price</code> and
        filled in defaults for the properties it did not find. Zero is not a sentinel — it is what an
        <code>int</code> is when nothing set it.</p>
        <p>The second shape is safe, and worth knowing precisely: <code>GetFromJsonAsync</code> calls
        <code>EnsureSuccessStatusCode</code> for you. That is a real difference between two methods that
        look like conveniences for the same thing.</p>
        <p>The third is what production code should do, because it can log the reason.
        <code>EnsureSuccessStatusCode</code> throws before anyone reads the body, so "The pricing
        database is unavailable" — which the other service went to the trouble of sending — is discarded
        either way.</p>
        <p>And the general rule: <strong>an HTTP call has three outcomes, not two.</strong> It succeeded,
        it failed with an answer, or it failed without one. Code that models two of those gets the third
        one wrong silently — and this is the shape that writes a zero into a ledger.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A log is full of <code>TaskCanceledException</code> with no other detail. Some are users closing
    the browser mid-checkout, which is normal and should not page anybody. Some are the pricing service
    timing out, which should.</p>
    <p>How do you tell them apart?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   what actually happened     exception                  inner
   ----------------------     ---------                  -----
   our timeout elapsed        TaskCanceledException      TimeoutException
   the caller cancelled       TaskCanceledException      TaskCanceledException</code></pre>
        <p>The inner exception, or the token. Since .NET 5 a timeout produces a
        <code>TaskCanceledException</code> whose <code>InnerException</code> is a
        <code>TimeoutException</code>. Both rows have an inner exception, so the test is not whether one
        exists — it is specifically the <code>TimeoutException</code>.</p>
        <p>Equivalently, ask the token: <code>callerToken.IsCancellationRequested</code> is true when the
        caller gave up and false when the timeout fired.</p>
        <p>Why it matters beyond tidy logs: these two need opposite handling. A cancelled request should
        be dropped quietly — nobody is waiting for the answer, and retrying it wastes work on a
        dependency that may already be struggling. A timeout is a dependency signal and belongs on a
        dashboard. <strong>Treating both as errors makes a browser refresh look like an outage; treating
        both as normal hides a real one.</strong></p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>A team added retries to a flaky dependency: three attempts, 300 ms timeout each. The call is on a
    checkout page with a 500 ms budget. Latency got worse, not better.</p>
    <p>Work out what a single call can now cost, and what the fix is.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the retries are bounded          attempts made        total time
   ---------------------------          -------------        ----------
   per-attempt timeout only                         3         1157 ms
   one budget for the whole operation               2          506 ms</code></pre>
        <p>A per-attempt timeout is not a budget. Three attempts at 300 ms with 100 ms between them is
        over 1,100 ms for a call the page can afford 500 for — so the timeout that was supposed to
        protect the page now more than doubles what the page can be made to wait.</p>
        <p>And the latency got worse for a second reason. Retrying a dependency that is slow
        <em>because it is overloaded</em> triples the load on it at exactly the moment it can least
        afford it. Retries help with a dropped packet or a restarting instance; they make an overload
        worse.</p>
        <p><strong>The fix is two timeouts, not one.</strong> A per-attempt timeout so no single attempt
        hangs, and one budget for the whole operation that the retry loop checks — which is what the
        second row does, stopping mid-sequence at two attempts when the budget was gone.</p>
        <p>And retry only what is worth retrying: a timeout, a 503, a connection failure. A 400 or a 404
        will not become a different answer.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>A service streams a large report from a partner. <code>HttpClient.Timeout</code> is set to 2
    seconds. A request has been running for forty minutes and the thread is still held.</p>
    <p>The timeout is definitely set. Why did nothing fire?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the response is read              outcome                     after
   ------------------------              -------                     -----
   ResponseContentRead (the default)     TaskCanceledException          708 ms
   ResponseHeadersRead                   headers at    3 ms, body read     3101 ms
   ResponseHeadersRead + a token         TaskCanceledException          705 ms</code></pre>
        <p><code>HttpClient.Timeout</code> stops applying once the headers have arrived, if you asked for
        <code>ResponseHeadersRead</code>. The default reads the whole body before returning, so the
        timeout covers everything — and the first row shows it firing at 708 ms. With
        <code>ResponseHeadersRead</code> the call returns in milliseconds and the body is read
        afterwards, outside the timeout's reach: 3,101 ms against a 700 ms setting.</p>
        <p>A partner that sends headers and then dribbles a body holds the read open for as long as it
        likes. Nothing is broken, nothing is hung in the TCP sense, and no timeout applies. Forty minutes
        is not an anomaly — <strong>it is the absence of any limit at all.</strong></p>
        <p>The third row is the fix: pass a <code>CancellationToken</code>. A token applies to the whole
        operation including the body read, which <code>HttpClient.Timeout</code> does not. That is a good
        reason to pass a token even when a timeout is already set.</p>
        <p>And the reason to use <code>ResponseHeadersRead</code> anyway: the default buffers the entire
        body into memory before you see a single byte. A 200 MB report is 200 MB on the large object
        heap. Streaming is right; it moves the responsibility for bounding the read onto you.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Why is <code>using var client = new HttpClient()</code> wrong?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The connection pool belongs to the handler, not the client, so a
        new client can reuse nothing and disposing it discards the connection. Measured at 50
        connections for 50 calls against 1 for a shared client.</p></div>
      </details></li>

    <li><p>Why does exhausting ports break calls to services you barely use?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Ephemeral ports are a machine resource. Whoever exhausts them takes
        them from every other caller on that host, so the failures land on whichever call needed a new
        connection at the wrong moment.</p></div>
      </details></li>

    <li><p>Why did restarting the service help for only ten minutes?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A restart does not return the ports — <code>TIME_WAIT</code> is
        kernel state and outlives the process. It returns an empty pool, which buys as long as it takes
        to fill again.</p></div>
      </details></li>

    <li><p>What breaks if one <code>HttpClient</code> lives forever with default settings?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The name is never resolved again.
        <code>PooledConnectionLifetime</code> defaults to infinite, so the connection — and the address
        behind it — survives every failover and redeploy of the service being called.</p></div>
      </details></li>

    <li><p>What does <code>IHttpClientFactory</code> pool?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Handler chains, not clients. Twenty clients created and disposed
        over one handler shared one connection.</p></div>
      </details></li>

    <li><p>Does capturing a factory client give you a stale connection?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No — measured identical. The factory sets
        <code>PooledConnectionLifetime</code> to the handler lifetime, so connections recycle regardless.
        What is frozen is the handler chain and everything it holds.</p></div>
      </details></li>

    <li><p>What lifetime does <code>AddHttpClient&lt;T&gt;</code> give <code>T</code>, and why does it
      matter?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Transient. Injecting it into a singleton captures it for the life of
        the application, and unlike a scoped service that is legal, silent, and never caught by scope
        validation.</p></div>
      </details></li>

    <li><p>What is the default <code>HttpClient.Timeout</code>, and why is it the wrong number?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>100 seconds. It is a backstop against a hang, not a budget — nobody
        waits that long, and a request held that long holds a thread, a connection and a scope.</p></div>
      </details></li>

    <li><p>When does <code>HttpClient.Timeout</code> stop applying?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Once the headers arrive, if the call used
        <code>ResponseHeadersRead</code>. The body read that follows is unbounded — 3,101 ms against a
        700 ms timeout. Only a <code>CancellationToken</code> covers it.</p></div>
      </details></li>

    <li><p>How do you distinguish a timeout from a caller's cancellation?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The inner exception is a <code>TimeoutException</code>, or
        equivalently the caller's token is not cancelled. Both arrive as
        <code>TaskCanceledException</code>.</p></div>
      </details></li>

    <li><p>Why is a per-attempt timeout not a budget?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Because retries multiply it. Three attempts at 300 ms with backoff
        measured 1,157 ms for a call with a 500 ms budget. The fix is a second, linked token bounding
        the whole operation.</p></div>
      </details></li>

    <li><p>What are the three outcomes of an HTTP call?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Succeeded; failed with an answer (a status code and usually a body
        saying why); failed without one (an exception, with <code>StatusCode</code> null). Code that
        models two of the three gets the missing one wrong silently.</p></div>
      </details></li>
  </ol>
</section>
`
});
