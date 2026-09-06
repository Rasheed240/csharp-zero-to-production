CSPREP.module({
  id: "t3-03-kestrel",
  minutes: 55,
  updated: "2026-09-03",
  summary: "Ledger moves behind an ingress and its rate limiter starts throttling innocent merchants, because every request now appears to come from one address. The fix restores rate limiting and makes the admin IP allow-list forgeable with a single header. Measured here: clearing KnownProxies and KnownIPNetworks - which reads as trust nobody - makes the middleware trust EVERYONE; MaxConcurrentConnections refuses rather than queues, in 22 ms and invisibly; and every Kestrel timeout fires on a one-second heartbeat, so a 200 ms setting is really two seconds.",
  terms: ["Kestrel", "socket", "connection middleware", "feature collection", "MaxConcurrentConnections",
    "MaxRequestBodySize", "MaxRequestHeadersTotalSize", "MaxRequestLineSize", "MaxRequestHeaderCount",
    "KeepAliveTimeout", "RequestHeadersTimeout", "MinDataRate", "grace period", "slowloris",
    "heartbeat", "TLS", "ALPN", "self-signed certificate", "TLS termination", "reverse proxy",
    "ingress", "X-Forwarded-For", "ForwardLimit", "KnownProxies", "KnownIPNetworks"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger's public API rate-limits by client address: 100 requests per minute per IP. It also
  restricts <code>/admin</code> to the office network by the same address. Both worked for two years.</p>

  <p>The service moves to Kubernetes behind an ingress controller. Within an hour, merchants doing ten
  requests a minute are getting 429s, and the audit log shows every action in the system performed by
  <code>10.42.0.7</code> — which is nobody.</p>

  <p>Nothing was deployed except the platform change. The application code is identical and still
  passes every test.</p>

  <p>Somebody adds the forwarded-headers middleware. Rate limiting starts working again, the tickets
  stop, and the incident is closed. <strong>It also made the admin allow-list forgeable with one
  header.</strong> Here are four configurations of that middleware, measured:</p>

  <pre data-lang="console" data-title="07-production.cs"><code>   configuration                           distinct   throttled   admin
                                            clients     wrongly   spoofed
   -------------                           --------   ---------   -------
   no forwarded headers                           1           2        no
   headers on, wrong proxy trusted                1           2        no
   headers on, cleared + no ForwardLimit          6           0       YES
   headers on, the ingress trusted                6           0        no</code></pre>

  <p>Row two is the fix that changes nothing — the middleware is configured, and it silently ignores
  every header. Row three is the fix that works and opens a hole.</p>

  <p>None of those rows differs by a line of application code. They differ in <strong>the layer between
  the socket and your pipeline</strong>: the web server. This module is about that layer — what it
  does before your code runs, what it limits, and what it can and cannot know about the client.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every default, status code, count and outcome in this module was produced by running the
    programs shown and pasted in unedited. Where a number is machine-specific it is labelled; the
    status codes and counts are deterministic.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What Kestrel is</h2>

  <p class="define"><span class="define__term">Web server</span> The component that owns the network
  socket, reads bytes off it, turns them into a request your code can use, and writes the response
  back. It is the thing between the operating system and your handler.</p>

  <p class="define"><span class="define__term">Kestrel</span> The web server built into ASP.NET Core.
  It runs <em>inside</em> your process — it is not a separate program you install, and there is no
  configuration file. Everything it does is set in C# before <code>Build()</code>.</p>

  <p class="define"><span class="define__term">Socket</span> A two-way stream of bytes between two
  programs over a network. It has no notion of messages or boundaries. Any structure you see on top of
  it was put there by a protocol.</p>

  <p class="define"><span class="define__term">Port</span> A number from 1 to 65535 identifying which
  program on a machine a connection is meant for. Port 0 is special: it asks the operating system to
  pick any free port, which is what every example in this module does.</p>

  <p class="define"><span class="define__term">TCP</span> The protocol underneath HTTP that turns an
  unreliable network into an ordered, reliable stream of bytes. A TCP <em>connection</em> is
  established by a three-way exchange before any data moves, which is why opening one costs a round
  trip.</p>

  <p class="define"><span class="define__term">File descriptor</span> The operating system's handle for
  an open thing — a socket, a file, a pipe. Each process has a limited number, and running out is a
  hard failure that affects everything the process is doing at once.</p>

  <p class="define"><span class="define__term">Request line</span> The first line of an HTTP request:
  method, target and version, as in <code>GET /payments?id=7 HTTP/1.1</code>. The query string is part
  of it, which is why a long filter can make it too long.</p>

  <p>The path a request takes:</p>

  <pre class="diagram"><code>the operating system
  accepts a TCP connection on a listening socket
      |
KESTREL
  connection middleware   once per SOCKET
  TLS handshake           if HTTPS - picks the HTTP version too
  protocol parsing        HTTP/1.1 text, or HTTP/2 binary frames
  request line + headers  into an HttpRequest
      |
YOUR PIPELINE
  request middleware      once per REQUEST
  routing, then endpoint</code></pre>

  <p><strong>Everything Kestrel limits, it limits before your code runs</strong> — because by the time
  your code runs, the resource has already been spent. A 30 MB header cannot be rejected by your
  handler; it has to be buffered before it can be parsed, and buffering it is the damage.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>Kestrel is like the front desk of a building. It decides who gets through the door, how long
  someone may stand in the lobby without stating their business, and how large a parcel it will accept
  — all before anyone upstairs hears about the visitor. The people upstairs do the actual work and
  never see the ones who were turned away.</p>

  <p><strong>This is an analogy and it misleads in one important way.</strong> A front desk can see who
  walked in. Kestrel, in most production deployments, cannot: something else received the real
  connection and is relaying it. Everything Kestrel knows about "the client" is then a claim made by
  that relay, and the last third of this module is about when you may believe it.</p>
</section>

<section id="minimal-example">
  <h2>Minimal example</h2>

  <p>The smallest program that configures Kestrel and shows the configuration taking effect:</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — The smallest program that configures Kestrel and shows the
// configuration taking effect.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web

using System.Net;

var builder = WebApplication.CreateBuilder();
builder.Logging.ClearProviders();

// Everything Kestrel does is configured here, before Build(). This is the
// server itself - not your pipeline, not your endpoints.
builder.WebHost.ConfigureKestrel(options =&gt;
{
    // A request body larger than this is rejected before your code sees it.
    options.Limits.MaxRequestBodySize = 100;

    // Port 0 asks the operating system for any free port.
    options.Listen(IPAddress.Loopback, 0);
});

var app = builder.Build();

app.MapPost("/", async (HttpRequest request) =&gt;
{
    using var reader = new StreamReader(request.Body);
    string body = await reader.ReadToEndAsync();
    return $"the handler received {body.Length} bytes";
});

await app.StartAsync();
Console.WriteLine($"listening on {app.Urls.First()}");
Console.WriteLine();

using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

foreach (int size in new[] { 50, 500 })
{
    using var content = new StringContent(new string('x', size));
    using HttpResponseMessage response = await http.PostAsync("/", content);

    Console.WriteLine($"POST a {size}-byte body -&gt; {(int)response.StatusCode} " +
        $"{await response.Content.ReadAsStringAsync()}");
}

Console.WriteLine();
Console.WriteLine("The second request never reached the handler. Kestrel rejected it");
Console.WriteLine("while reading the body, and 413 means Content Too Large.");

await app.StopAsync();</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>listening on http://127.0.0.1:56162

POST a 50-byte body -&gt; 200 the handler received 50 bytes
POST a 500-byte body -&gt; 413

The second request never reached the handler. Kestrel rejected it
while reading the body, and 413 means Content Too Large.</code></pre>

  <p>Two things worth noticing. <code>ConfigureKestrel</code> is called on <code>builder.WebHost</code>
  — <strong>before <code>Build()</code></strong>, because it describes what exists rather than what
  happens. And the second request produced a status code that no line of your code chose.</p>
</section>

<section id="connections">
  <h2>Connections are not requests</h2>

  <p>Kestrel's connection limits and your request metrics count different things, and confusing them is
  the beginning of several bad afternoons.</p>

  <pre data-lang="console" data-title="01-socket-to-request.cs"><code>   6 requests, sent two ways:

   mode                sockets accepted   requests served
   ----                ----------------   ---------------
   keep-alive                         1                 6
   Connection: close                  6                 6</code></pre>

  <p>A service doing 10,000 requests per second over reused connections may hold only a few hundred
  sockets. The same load from clients that reconnect every time holds 10,000. <strong>"We handle 10k
  rps" says nothing about whether you will hit a connection limit</strong> — the two are related only
  by client behaviour, which you do not control.</p>

  <h3>What the limit actually does</h3>

  <p><code>MaxConcurrentConnections</code> defaults to <code>null</code>, meaning no limit. Set it to
  2 and open five connections to a 300 ms endpoint:</p>

  <pre data-lang="console" data-title="02-connection-limits.cs"><code>   client   finished at   outcome
   ------   -----------   -------
        2         96 ms   FAILED (SocketException)
        5         96 ms   FAILED (SocketException)
        3         96 ms   FAILED (SocketException)
        4        446 ms   200 OK
        1        446 ms   200 OK

   sockets seen by connection middleware : 2
   peak concurrent connections           : 2</code></pre>

  <p><strong>The excess connections were closed, not queued</strong> — and closed immediately, at 96 ms
  against the 446 ms the successful requests took. Kestrel accepts the connection, sees it is over the
  limit, and closes it before reading a byte.</p>

  <p>Note the first counter: the connection middleware registered on the endpoint saw <em>two</em>
  sockets, not five. The limit is applied before your connection middleware runs, so you cannot observe
  or override a rejection from there.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>A rejection here is <strong>invisible in your request metrics</strong>. No request was parsed,
    so nothing incremented a request counter, nothing hit your middleware, and nothing appears in your
    access log. Your dashboard shows a healthy service dropping traffic.</p>
    <p>It is not entirely invisible — Kestrel logs a warning per rejection and publishes
    <code>kestrel.rejected_connections</code> — but neither is where anyone looks first.</p>
    <p>And the client cannot tell a rejection from a crash. Both are a dropped connection with no
    status code. If you want load shedding a client can reason about, do it in middleware with 503 and
    <code>Retry-After</code>. That costs you a parsed request, which is the whole trade: this limit is
    cheap because it acts before parsing, and uninformative for the same reason.</p>
  </div>

  <h3>Whether to set it at all</h3>

  <p><strong>The honest default is: do not.</strong> Kestrel is usually behind something that already
  bounds connections, and a wrong limit here makes a healthy server refuse work. Set it when each
  connection holds an expensive per-connection resource, or when you are directly exposed with nothing
  in front.</p>

  <p>Be clear about what it is not. It is <em>not</em> a rate limit — one connection can send thousands
  of requests, and ten thousand requests on one HTTP/2 connection are one connection. Three different
  limits on three different things:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Bound on</th><th>Controlled by</th></tr></thead>
      <tbody>
        <tr><td>Connections</td><td><code>MaxConcurrentConnections</code>, and the operating system</td></tr>
        <tr><td>Requests</td><td>Rate limiting middleware</td></tr>
        <tr><td>Work in flight</td><td>The thread pool, and your own semaphores</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="request-limits">
  <h2>Size limits, and the status code each one produces</h2>

  <pre data-lang="console" data-title="03-request-limits.cs"><code>   limit                        default
   -----                        -------
   MaxRequestBodySize           30,000,000 bytes (28 MB)
   MaxRequestHeadersTotalSize   32,768 bytes
   MaxRequestHeaderCount        100
   MaxRequestLineSize           8,192 bytes
   MaxRequestBufferSize         1,048,576 bytes
   MaxResponseBufferSize        65,536 bytes</code></pre>

  <p>Every one exists for the same reason: <strong>without it, a stranger decides how much memory your
  process allocates.</strong> Headers must be buffered before they can be parsed, so an unbounded
  header is an unbounded allocation requested by anyone who can reach your port.</p>

  <p>Crossing each one, with the limits shrunk so a test can reach them:</p>

  <pre data-lang="console" data-title="03-request-limits.cs"><code>   what was sent                          status   meaning
   -------------                          ------   -------
   body of 1,000 bytes (limit 1,024)         200   accepted
   body of 4,000 bytes                       413   413 Content Too Large
   headers totalling ~1 KB (limit 2 KB)      200   accepted
   headers totalling ~4 KB                   431   431 Request Header Fields Too Large
   10 headers (limit 20)                     200   accepted
   40 headers                                431   431 Request Header Fields Too Large
   200-byte request line (limit 256)         200   accepted
   2,000-byte request line                   414   414 URI Too Long</code></pre>

  <p>Four limits, three status codes — the header count and the header size share 431, so a client
  receiving one cannot tell which it crossed. All are 4xx, which is the right assignment of blame: the
  caller must change something, and retrying unchanged will not help.</p>

  <p>The practical case for a 414 is not an attack. It is a <code>GET</code> with a list of ids in the
  query string, which works in testing with three ids and fails in production with three hundred. The
  fix is to make it a <code>POST</code> with the filter in the body, not to raise the limit.</p>

  <h3>Raising the limit for one endpoint</h3>

  <pre data-lang="console" data-title="03-request-limits.cs"><code>   endpoint            4,000-byte body   note
   --------            ---------------   ----
   /small                          413   server limit of 1,024 applies
   /large                          200   raised via the feature
   /large-attribute                200   raised via endpoint metadata</code></pre>

  <p><strong>Raise the limit on the endpoint that needs it, not on the server.</strong> A global 200 MB
  limit because one upload endpoint needs it means every other endpoint — including unauthenticated
  ones — will also read 200 MB from anyone who sends it.</p>

  <p>The metadata form is the one to reach for. It is visible on the endpoint rather than buried in a
  handler, and it is applied before your code runs:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-request-limits.cs"><code>app.MapPost("/documents", Handler)
   .WithMetadata(new SizeLimit(8 * 1024 * 1024));

sealed class SizeLimit : IRequestSizeLimitMetadata
{
    public SizeLimit(long maxRequestBodySize) =&gt; MaxRequestBodySize = maxRequestBodySize;

    public long? MaxRequestBodySize { get; }
}</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>The imperative form has a trap. <code>IHttpMaxRequestBodySizeFeature</code> becomes
    <strong>read-only once anything has started reading the body</strong>:</p>
    <pre data-lang="csharp" data-net="10" data-title="The imperative form"><code>var feature = context.Features.Get&lt;IHttpMaxRequestBodySizeFeature&gt;();
if (feature is { IsReadOnly: false })
{
    feature.MaxRequestBodySize = 1024 * 1024;
}</code></pre>
    <p>So a filter, a model-bound parameter, or a middleware that touched the body first will silently
    defeat it — the <code>if</code> is false and nothing happens. That is why the metadata form is
    better: it applies before any of them.</p>
  </div>

  <h3>Where the exception surfaces</h3>

  <pre data-lang="console" data-title="03-request-limits.cs"><code>   status returned to the client : 413
   what the handler saw          : BadHttpRequestException: Request body too large.
                                   The max request body size is 1024 bytes. (StatusCode 413)</code></pre>

  <p><strong>The limit is enforced where the body is read, not where the request arrives.</strong>
  Kestrel throws when a read crosses the limit. Three consequences:</p>

  <ol>
    <li><strong>Your handler is already running.</strong> Anything you did before reading the body has
    already happened.</li>
    <li><strong>A catch-all will swallow it.</strong> <code>BadHttpRequestException</code> carries the
    status code that should be returned; catching <code>Exception</code> and returning 500 turns a
    correct 413 into a server error and moves the blame from the caller to you.</li>
    <li><strong>A declared <code>Content-Length</code> is checked early; a chunked body is not.</strong>
    A client that streams is rejected partway through, after you have already received everything up
    to the limit — so the limit bounds your memory, not the client's bandwidth.</li>
  </ol>
</section>

<section id="timeouts">
  <h2>Timeouts, and the attack they exist for</h2>

  <p class="define"><span class="define__term">Slowloris</span> An attack that costs almost nothing to
  run: open many connections, send a partial request on each, and keep them barely alive. No bandwidth,
  no CPU, no payload. The server holds every connection open waiting for a request that never
  completes.</p>

  <pre data-lang="console" data-title="04-timeouts.cs"><code>   setting                   default        stops
   -------                   -------        -----
   KeepAliveTimeout             130 s        an idle connection being held open
   RequestHeadersTimeout         30 s        headers dribbled in slowly
   MinRequestBodyDataRate    240 B/s, 5s grace  a body sent too slowly
   MinResponseDataRate       240 B/s, 5s grace  a response read too slowly</code></pre>

  <p>The first two are <strong>deadlines</strong>: a fixed amount of time, after which the connection is
  closed regardless of progress. The last two are <strong>rates</strong>, and the distinction matters.
  A deadline on a body would break every legitimate large upload over a slow link; a rate says "keep
  making progress at some minimum speed", so a 2 GB upload over a slow connection is fine and a 2 KB
  upload dribbled out one byte at a time is not.</p>

  <p class="define"><span class="define__term">Grace period</span> The time before a rate starts being
  enforced. It covers TLS handshakes, TCP slow start, and a client that pauses to think.</p>

  <p class="define"><span class="define__term">Heartbeat</span> A single timer inside Kestrel that
  ticks roughly once a second and checks every connection's deadlines. One timer for the whole server
  rather than one per connection — which is why the timeouts in this section are coarse.</p>

  <h3>Headers that never arrive</h3>

  <p>A request with its terminating blank line withheld — exactly what a slowloris client sends — at
  four configured timeouts:</p>

  <pre data-lang="console" data-title="04-timeouts.cs"><code>   configured   fired at   overshoot   response
   ----------   --------   ---------   --------
       200 ms    2009 ms     1809 ms   HTTP/1.1 408 Request Timeout
      1000 ms    2015 ms     1015 ms   HTTP/1.1 408 Request Timeout
      2000 ms    3036 ms     1036 ms   HTTP/1.1 408 Request Timeout
      4000 ms    5053 ms     1053 ms   HTTP/1.1 408 Request Timeout</code></pre>

  <p>Two things in that table are worth more than the timeout itself.</p>

  <p><strong>Kestrel sends 408 Request Timeout.</strong> It does not silently drop the connection, which
  is what most write-ups imply when they say the connection is closed. The client gets a real status
  line and can tell a timeout from a network failure.</p>

  <p><strong>The overshoot is about a second and does not shrink.</strong> These timeouts are checked by
  a <em>heartbeat</em> that runs roughly once a second, not by a timer per connection. So the practical
  floor is about two seconds whatever you configure, a sub-second value buys nothing over one second,
  and above that you get your value plus up to a heartbeat.</p>

  <p>That is a sensible design — a timer per connection would be a timer per connection — but it means
  these are <strong>coarse controls</strong>. If you are tuning to a few hundred milliseconds here, you
  are using the wrong tool.</p>

  <p>The same granularity shows up as a validation rule: <code>MinDataRate</code> rejects a grace period
  of one second or less with an <code>ArgumentOutOfRangeException</code>. A grace period finer than the
  clock that checks it would be a lie.</p>

  <h3>A body sent one byte at a time</h3>

  <pre data-lang="console" data-title="04-timeouts.cs"><code>   declared body size            : 2,000 bytes
   client's actual rate          : ~100 B/s
   MinRequestBodyDataRate        : 1,000 B/s after 1,500 ms of grace
   bytes sent before it stopped  : 131
   outcome                       : aborted by the server (SocketException)
   what the handler saw          : BadHttpRequestException: Reading the request body timed
                                   out due to data arriving too slowly. See MinRequestBodyDataRate.</code></pre>

  <p>The two sides see different things. <strong>The client</strong> gets no status code at all — the
  connection is aborted, indistinguishable from a network failure. <strong>The server</strong> gets a
  <code>BadHttpRequestException</code> naming the setting, thrown from the read inside your handler.
  That is the debugging hook, and the reason a catch-all around body reading is a bad idea.</p>

  <h3>What defends against what</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Setting</th><th>Defends?</th><th>Why</th></tr></thead>
      <tbody>
        <tr><td><code>RequestHeadersTimeout</code></td><td><strong>Yes</strong></td><td>Caps the whole header phase</td></tr>
        <tr><td><code>MinRequestBodyDataRate</code></td><td><strong>Yes</strong></td><td>Catches a dribbled body</td></tr>
        <tr><td><code>MinResponseDataRate</code></td><td><strong>Yes</strong></td><td>Catches a slow reader — a slowloris pointed the other way</td></tr>
        <tr><td><code>KeepAliveTimeout</code></td><td><strong>No</strong></td><td>The attacker is never idle — it is mid-request, making a byte of progress now and then</td></tr>
        <tr><td><code>MaxConcurrentConnections</code></td><td>Partly</td><td>Caps the count, at the cost of refusing legitimate clients too</td></tr>
      </tbody>
    </table>
  </div>

  <p>The keep-alive timeout is the trap. It measures time between <em>requests</em> on an idle
  connection, so lowering it to seconds would hurt legitimate clients while doing nothing to the
  attack.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>All four defences are on by default.</strong> The realistic risk is not forgetting to
    enable them — it is switching one off to fix a bug and never putting it back:</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="The line that removes the defence"><code>options.Limits.MinRequestBodyDataRate = null;</code></pre>
    <p>That line usually appears because one legitimate slow upload was being aborted. It fixes the
    symptom and removes the defence for every endpoint at once.</p>
    <p>Concretely: a slowloris client holding 10,000 connections costs the attacker a single machine and
    almost no bandwidth. With the defences on, each connection is closed after about 30 seconds and the
    attacker must re-establish all 10,000 continuously — which is a bandwidth cost and a visible traffic
    pattern. With that one line, each connection is free to hold forever, and 10,000 sockets against a
    process holding a few kilobytes of buffer each is enough to exhaust a container's file descriptors
    without ever appearing in a request metric.</p>
    <p>Raise the grace period instead, or clear the rate for the one endpoint that needs it through
    <code>IHttpMinRequestBodyDataRateFeature</code>, and the other endpoints stay protected.</p>
    <p>The honest limit of all of it: these bound what <em>one connection</em> can waste. They do nothing
    about ten thousand connections each behaving legally. Volume is somebody else's job.</p>
  </div>
</section>

<section id="tls">
  <h2>TLS, and where it terminates</h2>

  <p>Kestrel can serve HTTPS. Given a certificate, the handshake result is exposed as a connection
  feature:</p>

  <pre data-lang="console" data-title="05-tls.cs"><code>   scheme          : https
   IsHttps         : True
   protocol        : Tls13
   cipher suite    : TLS_AES_256_GCM_SHA384
   HTTP version    : HTTP/1.1</code></pre>

  <p><strong><code>IsHttps</code> is true because of the connection, not because of anything in the
  request text.</strong> A request arriving on a plain HTTP connection cannot make itself look secure by
  adding a header — which is exactly the problem in the next section.</p>

  <p>None of that was configured. Kestrel negotiated the protocol version and cipher suite with the
  client, and the sane default is to leave it alone: the operating system's policy is maintained by
  people whose job it is, and pinning a cipher list in application code freezes it at the day you wrote
  it.</p>

  <p class="define"><span class="define__term">TLS</span> Transport Layer Security: the encryption
  layer that makes HTTP into HTTPS. It does two jobs, and they are separable — it encrypts the
  conversation, and it authenticates the server. Encryption without authentication is worth very
  little, which is the point of the warning below.</p>

  <p class="define"><span class="define__term">Certificate</span> A file stating "this name belongs to
  the holder of this key", signed by somebody. A <em>self-signed</em> certificate is signed by itself,
  so it proves nothing to anyone who has not been told to trust it specifically.</p>

  <p class="define"><span class="define__term">Trust store</span> The list of certificate authorities a
  client is willing to believe. It lives in the operating system, or the browser, and it is the reason
  a certificate from a public authority works without any configuration.</p>

  <h3>How the HTTP version is chosen</h3>

  <p class="define"><span class="define__term">ALPN</span> Application-Layer Protocol Negotiation, an
  extension to the TLS handshake. The client sends the list of protocols it speaks, the server picks
  one, and it is settled before the first HTTP byte.</p>

  <pre data-lang="console" data-title="05-tls.cs"><code>   client asks for     negotiated
   ---------------     ----------
   HTTP/1.1 exactly    HTTP/1.1
   HTTP/2 exactly      HTTP/2
   HTTP/2 or lower     HTTP/2</code></pre>

  <p>This is why HTTP/2 in practice means HTTPS. Over plain HTTP there is no handshake to negotiate in,
  so both ends must be told in advance — "prior knowledge" — which works between services you control
  and not on the open internet.</p>

  <p>The practical consequence: an endpoint set to HTTP/2 only, without TLS, is reachable only by
  clients configured for prior knowledge. A browser will not reach it, and neither will a health checker
  speaking HTTP/1.1 — which is the usual way a gRPC service ends up marked unhealthy while working
  perfectly.</p>

  <h3>Trust</h3>

  <pre data-lang="console" data-title="05-tls.cs"><code>   validating client : HttpRequestException: The remote certificate is invalid because of
                       errors in the certificate chain: UntrustedRoot
   trusting client   : ok</code></pre>

  <p>The failure is on the <em>client</em>. Kestrel served the certificate it was given; the client
  refused it because nothing in its trust store vouches for it. "The certificate is invalid" reads like
  a server problem and is almost always a question about what the client trusts. In development the
  answer is <code>dotnet dev-certs https --trust</code>.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>The way this is usually "fixed" in code:</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Never ship this"><code>handler.ServerCertificateCustomValidationCallback =
    (message, cert, chain, errors) =&gt; true;</code></pre>
    <p>That accepts <strong>any certificate from any server</strong>, which removes the entire point of
    TLS. Encryption without authentication means you have a private conversation with someone who may
    not be who you think — a machine-in-the-middle attack with the door held open.</p>
    <p>If you find that line in a service, it was almost certainly added to make a test pass and never
    removed. The verification file for this module needs an equivalent, and compares the thumbprint
    against the certificate it created rather than returning a bare <code>true</code>.</p>
  </div>

  <h3>Where TLS actually ends</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Model</th><th>Shape</th><th>Trade</th></tr></thead>
      <tbody>
        <tr><td><strong>Edge termination</strong></td><td>client →TLS→ ingress →plain→ Kestrel</td><td>The common one. The proxy holds the certificate and handles renewal; your process never sees one</td></tr>
        <tr><td>End-to-end</td><td>client →TLS→ proxy →TLS→ Kestrel</td><td>Encrypted on every hop, at the cost of a certificate and a renewal story per service. Usually a service mesh, not each application</td></tr>
        <tr><td>Direct</td><td>client →TLS→ Kestrel</td><td>Supported and uncommon. You own renewal, and nothing in front absorbs volume</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>Edge termination is why the next section exists.</strong> If TLS ended at the proxy then on
  your connection <code>Request.IsHttps</code> is false, <code>Request.Scheme</code> is
  <code>http</code>, and <code>RemoteIpAddress</code> is the proxy. All three are correct statements
  about your connection and the wrong answer about the client.</p>
</section>

<section id="behind-a-proxy">
  <h2>Behind a proxy</h2>

  <p class="define"><span class="define__term">Reverse proxy</span> A server that receives requests on
  behalf of yours and forwards them on. A load balancer, an ingress controller, a CDN, or nginx.</p>

  <p class="define"><span class="define__term"><code>X-Forwarded-For</code></span> A header carrying the
  addresses a request passed through. <strong>Each proxy appends the address it saw</strong>, so the
  rightmost entry was written by your own proxy and everything further left came from further away.</p>

  <p class="define"><span class="define__term">Ingress</span> The reverse proxy at the edge of a
  Kubernetes cluster. It receives every request from outside and forwards it to whichever pod should
  handle it, so it is the address your application sees instead of the client's.</p>

  <p class="define"><span class="define__term">Rate limiting</span> Refusing requests from a caller that
  has made too many in some window. It needs a key to count against, and that key is usually the client
  address — which is why everything in this section decides whether rate limiting works.</p>

  <p>With the headers arriving and no middleware to act on them:</p>

  <pre data-lang="console" data-title="06-reverse-proxy.cs"><code>     Connection.RemoteIpAddress : 127.0.0.1
     Request.Scheme             : http
     Request.Host               : 127.0.0.1:49989</code></pre>

  <p>What that breaks, in the order people discover it: every request comes from one address, so
  IP rate limiting limits the proxy and audit logs record the proxy; redirect-to-HTTPS loops forever
  because you see <code>http</code> and the proxy keeps forwarding plain; generated URLs come out as
  <code>http://localhost:5000/…</code>; and cookies marked <code>Secure</code> are dropped.</p>

  <p><code>UseForwardedHeaders</code> fixes all of that by <strong>rewriting the request</strong> —
  <code>RemoteIpAddress</code> and <code>Scheme</code> themselves report the client, so code that never
  heard of a proxy is correct without changing. Register it <strong>first</strong>, before anything that
  reads the scheme or the address, and know that it consumes the headers it applies (moving them to
  <code>X-Original-For</code> and so on) so nothing downstream applies them twice.</p>

  <h3>The line that decides whether any of it works</h3>

  <p>Four configurations, the same request, from <code>127.0.0.1</code>:</p>

  <pre data-lang="console" data-title="06-reverse-proxy.cs"><code>   trusted set                              RemoteIpAddress   Scheme   headers
   -----------                              ---------------   ------   -------
   defaults (loopback only)                 203.0.113.7       https    APPLIED
   BOTH SETS CLEARED                        203.0.113.7       https    APPLIED
   one foreign proxy, 10.9.9.9              127.0.0.1         http     ignored
   loopback trusted explicitly              203.0.113.7       https    APPLIED</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Read the second row twice.</strong> Clearing both trusted sets — which reads like
    <em>trust nobody</em> — made the middleware trust <em>everybody</em>.</p>
    <p>The middleware checks the sender against the trusted sets only when there is something in them.
    Empty means unrestricted, not empty. So these two lines, alone, let any client on earth set its own
    IP address and scheme:</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="This trusts everyone"><code>options.KnownProxies.Clear();      // start from nothing
options.KnownIPNetworks.Clear();   // and now trust nobody</code></pre>
    <p><strong>If you clear, you must add.</strong></p>
  </div>

  <p>Row three is what a rejection looks like: the headers ignored and the connection's own values kept,
  because the request did not come from <code>10.9.9.9</code>. Note what it does <em>not</em> produce —
  no error, no warning, no log line at the default level. <strong>This middleware fails silently in both
  directions:</strong> it ignores headers without telling you, and it trusts everyone without telling
  you.</p>

  <p>The defaults trust <strong>loopback only</strong> — <code>127.0.0.1</code> and <code>::1</code>.
  That is correct for a proxy running beside you on the same host and wrong for almost every container
  deployment, where the ingress is another pod with a different address. A service that works on a
  developer's machine and silently stops working in the cluster is the <em>expected</em> outcome of
  leaving this alone.</p>

  <h3>Why the trusted set exists</h3>

  <p>With every address trusted and <code>ForwardLimit</code> removed, a client sending its own chain:</p>

  <pre data-lang="console" data-title="06-reverse-proxy.cs"><code>     X-Forwarded-For: 203.0.113.7, 198.51.100.99, 10.0.0.1

     RemoteIpAddress : 203.0.113.7
     Scheme          : https</code></pre>

  <p><strong>The client chose its own IP address.</strong> Nothing verified it, because nothing can:
  <code>X-Forwarded-For</code> is a header, and a header is whatever the sender typed. The only thing
  that makes it trustworthy is knowing a proxy you control wrote it, and the only way to know that is to
  check who the connection came from.</p>

  <p>An attacker against a service that trusts it blindly gets: rate limits bypassed with a new spoofed
  address per request; IP allow-lists defeated; audit logs poisoned; and any authorisation decision that
  reads the address or the scheme made on a lie.</p>

  <p><code>ForwardLimit</code> is the other half of the defence. It defaults to <strong>1</strong>: take
  one entry from the <em>right-hand</em> end, because that is the one your immediate proxy added. Raise
  it to exactly the number of proxies you run, and no higher.</p>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>Back to the opening incident. Six requests arrive through the ingress: five different customers
  with one request each, and one attacker claiming an office address. The rate limit is 3 per address so
  the test crosses it, and <code>/admin</code> is restricted to <code>10.0.0.0/24</code>.</p>

  <p>The attacker sends a forged <code>X-Forwarded-For</code>, and the ingress appends the address it
  actually saw — so what reaches the application is
  <code>10.0.0.5, 203.0.113.99</code>: forgery on the left, the ingress's observation on the right.</p>

  <pre data-lang="console" data-title="07-production.cs"><code>   configuration                           distinct   throttled   admin
                                            clients     wrongly   spoofed
   -------------                           --------   ---------   -------
   no forwarded headers                           1           2        no
   headers on, wrong proxy trusted                1           2        no
   headers on, cleared + no ForwardLimit          6           0       YES
   headers on, the ingress trusted                6           0        no</code></pre>

  <p><strong>Row 1 is the incident.</strong> One distinct client, so the customers share a bucket and
  are throttled for traffic they did not send. The admin check is safe only by accident — the attacker's
  claimed address is ignored along with everybody else's.</p>

  <p><strong>Row 2 is the fix that changes nothing.</strong> <code>UseForwardedHeaders</code> is called
  and configured, and the trusted address is the <em>previous</em> load balancer rather than the new
  ingress. No error, no warning; the headers are ignored exactly as in row 1. This is a state a team can
  sit in for weeks, because the code review shows the middleware being configured.</p>

  <p><strong>Row 3 is the fix that works and opens a hole.</strong> Two changes combined: clearing both
  sets trusts every sender rather than none, and removing <code>ForwardLimit</code> walks the chain to
  its leftmost entry — the end the client controls. The tell is that the incident <em>closed</em>: rate
  limiting worked, the tickets stopped, and nothing indicated that an IP allow-list had become a value
  anyone could type.</p>

  <p><strong>Row 4 is correct on both counts.</strong> The ingress is named explicitly and
  <code>ForwardLimit</code> is 1, so exactly one entry is taken from the right — the one the trusted
  proxy wrote. The attacker's invented entry sits to the left and is never read.</p>

  <h3>The whole contract in one file</h3>

  <pre data-lang="csharp" data-net="10" data-title="09-minimal-example.cs"><code>// 09-minimal-example.cs — One Kestrel configured the way a service behind an
// ingress should be, with every decision exercised.
//
// Run:  dotnet run 09-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and outcome here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Net;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Server.Kestrel.Core;

var builder = WebApplication.CreateBuilder();
builder.Logging.ClearProviders();

builder.WebHost.ConfigureKestrel(options =&gt;
{
    // --- limits on what one client may ask of the parser -------------------
    //
    // Lower than the 30,000,000-byte default. The global limit is the size of
    // an ordinary request; the one endpoint that needs more raises it for
    // itself, so an unauthenticated caller cannot make the server read 30 MB.
    options.Limits.MaxRequestBodySize = 64 * 1024;

    // The defaults - 32 KB, 100 headers, an 8 KB request line - are sensible.
    // They are set explicitly here because a limit nobody chose is a limit
    // nobody will think about when a request starts failing.
    options.Limits.MaxRequestHeadersTotalSize = 32 * 1024;
    options.Limits.MaxRequestHeaderCount = 100;
    options.Limits.MaxRequestLineSize = 8 * 1024;

    // --- limits on how long a client may take ------------------------------
    //
    // All four are on by default and all four are the slowloris defence.
    // They are restated rather than changed: the failure mode here is
    // switching one off for a slow client and never putting it back.
    options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(30);
    options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(130);
    options.Limits.MinRequestBodyDataRate =
        new MinDataRate(bytesPerSecond: 240, gracePeriod: TimeSpan.FromSeconds(5));
    options.Limits.MinResponseDataRate =
        new MinDataRate(bytesPerSecond: 240, gracePeriod: TimeSpan.FromSeconds(5));

    // Not set: MaxConcurrentConnections. There is an ingress in front that
    // bounds connections already, and a wrong value here drops clients with
    // no status code and nothing in the access log. Set it only when you are
    // the front door.

    // --- what to listen on -------------------------------------------------
    //
    // Plain HTTP: the ingress terminates TLS and reaches us over the cluster
    // network. Listen rather than ListenLocalhost, which refuses port 0 and
    // would bind only loopback.
    options.Listen(IPAddress.Loopback, 0, listen =&gt;
    {
        listen.Protocols = HttpProtocols.Http1AndHttp2;
    });
});

var app = builder.Build();

// FIRST in the pipeline, before anything reads the address or the scheme -
// authentication, rate limiting, redirection and logging all do.
var forwarded = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,

    // One proxy, so one entry from the RIGHT of the chain: the entry our own
    // ingress appended. Anything to the left of it came from outside and is
    // whatever the sender typed.
    ForwardLimit = 1
};

// Clear THEN add. Clearing alone leaves both sets empty, and an empty trusted
// set means trust EVERY sender - the opposite of how it reads.
forwarded.KnownProxies.Clear();
forwarded.KnownIPNetworks.Clear();
forwarded.KnownProxies.Add(IPAddress.Loopback);      // the ingress, in this test

app.UseForwardedHeaders(forwarded);

// --- endpoints --------------------------------------------------------------
app.MapGet("/whoami", (HttpContext context) =&gt; Results.Ok(new
{
    client = context.Connection.RemoteIpAddress?.ToString(),
    scheme = context.Request.Scheme,
    protocol = context.Request.Protocol
}));

app.MapGet("/admin", (HttpContext context) =&gt;
    context.Connection.RemoteIpAddress?.ToString()
        .StartsWith("10.0.0.", StringComparison.Ordinal) == true
        ? Results.Ok(new { area = "admin" })
        : Results.StatusCode(403));

app.MapPost("/payments", async (HttpRequest request) =&gt;
{
    using var reader = new StreamReader(request.Body);
    return Results.Ok(new { received = (await reader.ReadToEndAsync()).Length });
});

// The one endpoint that genuinely needs a large body, raised for itself only.
app.MapPost("/documents", async (HttpRequest request) =&gt;
{
    using var reader = new StreamReader(request.Body);
    return Results.Ok(new { received = (await reader.ReadToEndAsync()).Length });
}).WithMetadata(new SizeLimit(8 * 1024 * 1024));

await app.StartAsync();
var uri = new Uri(app.Urls.First());
using var http = new HttpClient { BaseAddress = uri };

Console.WriteLine("A Kestrel configured for life behind an ingress");
Console.WriteLine();
Console.WriteLine("   what was sent                                status   what it shows");
Console.WriteLine("   -------------                                ------   -------------");

// The client address and scheme come from the proxy's headers.
(int whoamiStatus, string whoamiBody) = await GetAsync(http, "/whoami", "203.0.113.7");
Console.WriteLine($"   GET /whoami through the ingress                {whoamiStatus,3}   the CLIENT address, not the proxy");

// A forged left-hand entry is never read, because ForwardLimit is 1.
int spoofed = await StatusAsync(http, "/admin", "10.0.0.5, 203.0.113.99");
Console.WriteLine($"   GET /admin with a forged X-Forwarded-For        {spoofed,3}   forgery ignored");

// The genuine office address, as the ingress would report it.
int allowed = await StatusAsync(http, "/admin", "10.0.0.5");
Console.WriteLine($"   GET /admin from the real office address        {allowed,3}   allow-list works");

// Body limits: the ordinary endpoint, then the one that raised its own.
int small = await PostAsync(http, "/payments", 1_000);
int tooBig = await PostAsync(http, "/payments", 200_000);
int document = await PostAsync(http, "/documents", 200_000);

Console.WriteLine($"   POST /payments, 1 KB                           {small,3}   under the 64 KB limit");
Console.WriteLine($"   POST /payments, 200 KB                         {tooBig,3}   413, the global limit holds");
Console.WriteLine($"   POST /documents, 200 KB                        {document,3}   raised for this endpoint only");

Console.WriteLine();
Console.WriteLine($"   /whoami returned: {whoamiBody}");
Console.WriteLine();
Console.WriteLine("   Every one of those outcomes is a configuration decision, and none of");
Console.WriteLine("   them is in the endpoint code. The handlers do not know there is a");
Console.WriteLine("   proxy, a body limit or a timeout.");
Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - UseForwardedHeaders registered FIRST, before anything reads the");
Console.WriteLine("       address or the scheme");
Console.WriteLine("     - trusted sets CLEARED AND THEN ADDED TO - clearing alone trusts");
Console.WriteLine("       everyone");
Console.WriteLine("     - ForwardLimit set to the number of proxies actually in front");
Console.WriteLine("     - a global body limit sized for ordinary requests, raised per");
Console.WriteLine("       endpoint where a real upload needs it");
Console.WriteLine("     - header and request-line limits stated explicitly, so they are");
Console.WriteLine("       chosen rather than inherited");
Console.WriteLine("     - the four slowloris defences left ON");
Console.WriteLine("     - MaxConcurrentConnections deliberately NOT set, because something");
Console.WriteLine("       in front already bounds connections");
Console.WriteLine("     - TLS left to the ingress, so certificate renewal is not this");
Console.WriteLine("       process's problem");
Console.WriteLine();
Console.WriteLine("   The two lines to check after any infrastructure change, because both");
Console.WriteLine("   failure modes of the forwarded-headers middleware are silent:");
Console.WriteLine();
Console.WriteLine("     curl https://api.ledger.example/whoami");
Console.WriteLine("       -&gt; must report YOUR address, not the ingress");
Console.WriteLine();
Console.WriteLine("     curl -H 'X-Forwarded-For: 10.0.0.5' https://api.ledger.example/admin");
Console.WriteLine("       -&gt; must NOT be 200");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task&lt;(int Status, string Body)&gt; GetAsync(HttpClient http, string path,
    string forwardedFor)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    request.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedFor);
    request.Headers.TryAddWithoutValidation("X-Forwarded-Proto", "https");

    using HttpResponseMessage response = await http.SendAsync(request);
    return ((int)response.StatusCode, await response.Content.ReadAsStringAsync());
}

static async Task&lt;int&gt; StatusAsync(HttpClient http, string path, string forwardedFor)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    request.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedFor);

    using HttpResponseMessage response = await http.SendAsync(request);
    return (int)response.StatusCode;
}

static async Task&lt;int&gt; PostAsync(HttpClient http, string path, int bytes)
{
    using var content = new StringContent(new string('x', bytes));

    try
    {
        using HttpResponseMessage response = await http.PostAsync(path, content);
        return (int)response.StatusCode;
    }
    catch (HttpRequestException)
    {
        return -1;
    }
}

// ---------------------------------------------------------------------------
sealed class SizeLimit : IRequestSizeLimitMetadata
{
    public SizeLimit(long maxRequestBodySize) =&gt; MaxRequestBodySize = maxRequestBodySize;

    public long? MaxRequestBodySize { get; }
}</code></pre>

  <pre data-lang="console" data-title="09-minimal-example.cs output"><code>   what was sent                                status   what it shows
   -------------                                ------   -------------
   GET /whoami through the ingress                200   the CLIENT address, not the proxy
   GET /admin with a forged X-Forwarded-For        403   forgery ignored
   GET /admin from the real office address        200   allow-list works
   POST /payments, 1 KB                           200   under the 64 KB limit
   POST /payments, 200 KB                         413   413, the global limit holds
   POST /documents, 200 KB                        200   raised for this endpoint only

   /whoami returned: {"client":"203.0.113.7","scheme":"https","protocol":"HTTP/1.1"}</code></pre>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger runs 400 requests an hour across roughly 80 merchants, with a limit of 100 per minute per
    address.</p>
    <p><strong>Sharing one bucket</strong> caps the whole platform at 100 requests per minute rather
    than 100 per merchant. At peak that is every merchant seeing intermittent 429s on payment
    submission — each one a customer at a checkout seeing a failure, and a merchant deciding whether
    Ledger is reliable.</p>
    <p><strong>The row-3 window</strong> — rate limiting fixed, allow-list spoofable — lasted from the
    fix to the next security review. Anyone who could reach the ingress could reach <code>/admin</code>
    with one header. Nothing in the logs distinguishes that state from row 4, because both look like a
    working service.</p>
    <p>The cost of catching it was one command:</p>
    <pre data-lang="bash" data-title="The one-line check"><code>curl -H "X-Forwarded-For: 10.0.0.5" https://api.ledger.example/admin</code></pre>
    <p>A 200 there is the whole incident, visible in one line.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Clearing the trusted sets without adding to them</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - this trusts everyone"><code>options.KnownProxies.Clear();
options.KnownIPNetworks.Clear();
app.UseForwardedHeaders(options);</code></pre>

  <p>Symptom: none, until somebody forges a header. Cause: an empty trusted set means unrestricted. Fix:
  clear, then add the proxy.</p>

  <h3>Trusting the wrong proxy address</h3>

  <p>Symptom: <code>UseForwardedHeaders</code> is configured and does nothing at all. Cause: the trusted
  address is a previous load balancer, or the defaults' loopback in a cluster where the ingress is
  another pod. Fix: set it to the real address, and verify with a request through the real proxy — this
  never logs.</p>

  <h3>Raising the body limit globally for one endpoint</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>options.Limits.MaxRequestBodySize = 200 * 1024 * 1024;</code></pre>

  <p>Symptom: memory pressure from endpoints that never needed it. Cause: the limit applies to every
  endpoint, including unauthenticated ones. Fix: endpoint metadata on the endpoint that needs it.</p>

  <h3>Turning off a data rate to fix a slow client</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>options.Limits.MinRequestBodyDataRate = null;</code></pre>

  <p>Symptom: none, until a slowloris. Cause: a global fix for a per-endpoint problem. Fix: raise the
  grace period, or clear the rate for that one endpoint through its feature.</p>

  <h3>Catching everything around a body read</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>try
{
    using var reader = new StreamReader(request.Body);
    return Results.Ok(await reader.ReadToEndAsync());
}
catch (Exception)
{
    return Results.StatusCode(500);
}</code></pre>

  <p>Symptom: 500s on requests that were correctly rejected as too large or too slow. Cause:
  <code>BadHttpRequestException</code> carries the right status code and it was discarded. Fix: let it
  propagate, or catch it specifically and use its <code>StatusCode</code>.</p>

  <h3>Setting a sub-second timeout</h3>

  <p>Symptom: a timeout configured at 200 ms fires at about 2 seconds. Cause: the one-second heartbeat.
  Fix: accept that these are coarse, or move the control somewhere with finer resolution.</p>

  <h3>Assuming a connection limit queues</h3>

  <p>Symptom: clients report intermittent connection errors with nothing in the access log. Cause:
  <code>MaxConcurrentConnections</code> refuses immediately rather than queueing, and a refusal is never
  a request. Fix: check <code>kestrel.rejected_connections</code>, and consider whether the limit should
  exist at all.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>Kestrel-layer problems have one thing in common: <strong>they are invisible in request
    metrics</strong>, because the request was rejected before it became a request. So the first question
    is always whether your application ever saw it.</p>
    <p>Add one endpoint that reports what the server thinks it knows, and look at it through the real
    infrastructure:</p>
    <pre data-lang="csharp" data-net="10" data-title="Three lines worth having"><code>app.MapGet("/whoami", (HttpContext context) =&gt; Results.Ok(new
{
    client = context.Connection.RemoteIpAddress?.ToString(),
    scheme = context.Request.Scheme,
    protocol = context.Request.Protocol
}));</code></pre>
    <p>That is three lines and it settles most of this module's failure modes in one request.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Look at</th><th>What you are looking for</th></tr></thead>
      <tbody>
        <tr>
          <td>Every request has the same client address</td>
          <td><code>/whoami</code> through the real proxy</td>
          <td>The proxy's address. Forwarded headers are off, or the proxy is not trusted.</td>
        </tr>
        <tr>
          <td>An IP allow-list can be bypassed</td>
          <td><code>curl -H "X-Forwarded-For: &lt;allowed&gt;"</code></td>
          <td>A 200. Trusted sets cleared without adding, or <code>ForwardLimit</code> too high.</td>
        </tr>
        <tr>
          <td>Infinite redirect to HTTPS</td>
          <td><code>Request.Scheme</code> in the pipeline</td>
          <td><code>http</code> behind a TLS-terminating proxy. <code>X-Forwarded-Proto</code> is not being applied.</td>
        </tr>
        <tr>
          <td>Uploads fail above a size, no exception logged</td>
          <td>The status code — 413</td>
          <td><code>MaxRequestBodySize</code>. Check the proxy's own limit too; nginx defaults to 1 MB.</td>
        </tr>
        <tr>
          <td>431 on some clients only</td>
          <td>Header count and total size</td>
          <td>A large cookie or a long <code>Authorization</code> header. Both limits report 431.</td>
        </tr>
        <tr>
          <td>414 appears as customer data grows</td>
          <td>The query string length</td>
          <td>A filter or id list in a <code>GET</code>. Make it a <code>POST</code>.</td>
        </tr>
        <tr>
          <td>Connection errors, nothing in the access log</td>
          <td><code>kestrel.rejected_connections</code>, and Kestrel's own warnings</td>
          <td>A connection limit refusing before parsing. Nothing else will show it.</td>
        </tr>
        <tr>
          <td>Large uploads abort part-way</td>
          <td>The handler's exception</td>
          <td><code>BadHttpRequestException</code> naming <code>MinRequestBodyDataRate</code>.</td>
        </tr>
        <tr>
          <td>gRPC or HTTP/2 client cannot connect</td>
          <td>The endpoint's <code>Protocols</code> and whether TLS is on</td>
          <td>HTTP/2 without TLS needs prior knowledge. A health checker speaking HTTP/1.1 will fail against an HTTP/2-only endpoint.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h3>The two checks after any infrastructure change</h3>

  <pre data-lang="bash" data-title="After any infrastructure change"><code>curl https://api.ledger.example/whoami
# must report YOUR address, not the ingress

curl -H "X-Forwarded-For: 10.0.0.5" https://api.ledger.example/admin
# must NOT be 200</code></pre>

  <p>The first passes in both row 3 and row 4 of the production table. <strong>Only the second
  distinguishes a correct configuration from one that fixed rate limiting by making every IP-based
  decision forgeable.</strong></p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Clearing KnownProxies and KnownIPNetworks means trusting nobody."</em></p>
    <p>It means trusting everybody. Measured above: with both sets empty the middleware skips the sender
    check entirely and applies whatever headers arrive. If you clear, you must add.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"MaxConcurrentConnections queues the connections it cannot serve."</em></p>
    <p>It closes them, immediately, before reading a byte — 96 ms against the 446 ms the accepted
    requests took. And it does it before your connection middleware runs, so you cannot see it from
    application code.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"A timeout of 200 milliseconds gives me a 200-millisecond timeout."</em></p>
    <p>Every Kestrel timeout is checked on a roughly one-second heartbeat, so the practical floor is
    about two seconds and anything above it costs your value plus up to a heartbeat. The same
    granularity is why <code>MinDataRate</code> refuses a grace period of one second or less.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Kestrel needs a reverse proxy in front of it for security."</em></p>
    <p>Kestrel ships with the slowloris defences on and is supported as an edge server. A proxy is worth
    having for TLS management, caching, static content, volume absorption and holding connections during
    a deploy — which are real reasons, and none of them is "Kestrel is unsafe".</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Lowering KeepAliveTimeout protects against slowloris."</em></p>
    <p>It does nothing. A slowloris connection is never idle — it is mid-request, making a byte of
    progress now and then, so the keep-alive timer never starts. <code>RequestHeadersTimeout</code> and
    the data rates are what stop it, and they are already on.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"A 413 means I should raise MaxRequestBodySize."</em></p>
    <p>Sometimes. First check the proxy in front, which has its own limit — nginx defaults to 1 MB, so
    raising Kestrel's changes nothing if the request never arrives. Then raise it on the endpoint that
    needs it rather than globally, and ask whether a 200 MB body should be streamed to storage rather
    than read into memory at all.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Setting the request body size feature in my handler is equivalent to the metadata."</em></p>
    <p>Only if nothing has read the body yet. <code>IsReadOnly</code> becomes true once a read starts, so
    a filter or a model-bound parameter that touched the body first makes the assignment a no-op — with
    no error.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <p>Every setting in this module is a decision about what a stranger is allowed to make your process
  do, taken before your code has any say.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Decision</th><th>Cost to get right</th><th>Cost of getting it wrong</th></tr></thead>
      <tbody>
        <tr><td>Trusted proxy set: clear <em>and add</em></td><td>One line</td><td>Every IP-based decision in the service becomes a value anyone can type</td></tr>
        <tr><td><code>ForwardLimit</code> = proxies you run</td><td>One line</td><td>The forged left-hand end of the chain is read instead of your proxy's entry</td></tr>
        <tr><td>Body limit per endpoint, not global</td><td>One <code>WithMetadata</code></td><td>Unauthenticated endpoints read 200 MB from anyone who sends it</td></tr>
        <tr><td>Data rates left on</td><td>Nothing</td><td>10,000 slowloris connections held indefinitely for almost no attacker cost</td></tr>
        <tr><td>Not setting a connection limit you do not need</td><td>Nothing</td><td>Clients dropped with no status code and nothing in the access log</td></tr>
        <tr><td>Letting the ingress terminate TLS</td><td>Nothing</td><td>Certificate renewal becomes your outage on a date nobody is watching</td></tr>
      </tbody>
    </table>
  </div>

  <p>The pattern running through all of them: <strong>this layer fails quietly.</strong> A rejected
  connection is not a request, so it is not in your request metrics. An ignored forwarded header is not
  an error, so it is not in your logs. A spoofable allow-list looks exactly like a working one. Every
  failure mode in this module is invisible from the place you would normally look.</p>

  <p>Which makes the deeper rule worth stating on its own, because it outlives this middleware and this
  server: <strong>the connection is the only thing you know.</strong> Everything else — the address, the
  scheme, the host, the size a client claims to be sending — is something a stranger typed. Forwarded
  headers work by converting a fact about the connection into permission to believe a claim. Every
  header-based trust decision has that shape, and every one of them fails the same way when the fact is
  not checked.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Which status code does each limit produce?</p>
    <pre data-lang="text" data-title="Match these"><code>a. a 50 MB body against MaxRequestBodySize
b. 200 headers against MaxRequestHeaderCount
c. a 10 KB URL against MaxRequestLineSize
d. 64 KB of header text against MaxRequestHeadersTotalSize</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="08-exercises.cs"><code>   limit crossed             status   name
   -------------             ------   ----
   a. body too large            413   Content Too Large
   b. too many headers          431   Request Header Fields Too Large
   c. request line too long     414   URI Too Long
   d. headers too large         431   Request Header Fields Too Large</code></pre>
        <p><strong>Three codes for four limits.</strong> The two header limits share 431, so a client
        receiving one cannot tell whether it sent too many headers or headers that were too big — and
        the response body will not say.</p>
        <p>All four are 4xx, which is the right assignment of blame: the caller must change something
        and retrying unchanged will not help. A 500 here would page you for somebody else's oversized
        request.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p><code>MaxConcurrentConnections</code> is 2 and five clients connect at once to an endpoint that
    takes 300 ms. What happens to the other three — are they queued, or refused?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="08-exercises.cs"><code>   succeeded              : 2
   failed                 : 3
   first failure at       : 22 ms
   last success at        : 324 ms (the endpoint takes 300 ms)</code></pre>
        <p><strong>Refused, not queued</strong> — and refused immediately, long before the successful
        requests finished. Kestrel accepts the connection, sees it is over the limit, and closes it
        before reading a byte. There is no request, so there is no status code.</p>
        <p>Two consequences worth carrying:</p>
        <ul>
          <li><strong>It is invisible in request metrics.</strong> No request was parsed, so nothing hit
          your middleware or your access log. Kestrel logs a warning and publishes
          <code>kestrel.rejected_connections</code>; neither is where anyone looks first.</li>
          <li><strong>The client cannot tell it from a crash.</strong> If you want load shedding a client
          can reason about, do it in middleware with 503 and <code>Retry-After</code>. That costs a
          parsed request — which is the trade: this limit is cheap because it acts before parsing, and
          uninformative for the same reason.</li>
        </ul>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p><code>/documents</code> rejects files over 30 MB with a 413, and statements up to 200 MB must be
    accepted. Three fixes are proposed — which do you ship?</p>
    <pre data-lang="csharp" data-net="10" data-title="Three proposals"><code>a. options.Limits.MaxRequestBodySize = 200 * 1024 * 1024;
b. options.Limits.MaxRequestBodySize = null;
c. endpoint metadata raising the limit on /documents only</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Ship (c).</strong> With a 1,024-byte server limit and (c) applied to one endpoint:</p>
        <pre data-lang="console" data-title="08-exercises.cs"><code>     POST /documents (raised)   : 200
     POST /login     (not)      : 413</code></pre>
        <p>The other two raise the limit for every endpoint, including the ones an unauthenticated
        stranger can reach. Concretely with (a): <code>/login</code> will read 200 MB from anyone who
        sends it, and ten concurrent requests doing that is 2 GB of buffering for callers that never
        authenticate. (b) removes the ceiling entirely and lets one caller decide how much memory your
        process uses.</p>
        <p>Two details that finish the answer:</p>
        <ul>
          <li><strong>Prefer metadata to the feature.</strong> Setting
          <code>IHttpMaxRequestBodySizeFeature.MaxRequestBodySize</code> in the handler works, but the
          feature is read-only once anything has started reading the body — so a filter or a model-bound
          parameter that touched it first silently defeats you.</li>
          <li><strong>Raising the limit is not the whole design.</strong> A 200 MB body is buffered or
          streamed somewhere. Stream it to storage rather than reading it into memory, and set the limit
          to the largest file you actually support.</li>
        </ul>
        <p>And check what is in front of you: nginx defaults to a 1 MB body limit. Raising Kestrel's
        changes nothing if the request never reaches it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>An attacker opens many connections and sends a header byte every few seconds, never finishing a
    request. Which settings stop it, and which one does nothing?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="08-exercises.cs"><code>   RequestHeadersTimeout 1 s, KeepAliveTimeout 2 min
   partial headers held open -&gt; HTTP/1.1 408 Request Timeout after 2015 ms

   setting                    defends?   why
   -------                    --------   ---
   RequestHeadersTimeout      YES        caps the whole header phase
   MinRequestBodyDataRate     YES        catches a dribbled body
   MinResponseDataRate        YES        catches a slow reader
   KeepAliveTimeout           NO         the attacker is not idle
   MaxConcurrentConnections   partly     caps the count, at a cost</code></pre>
        <p><strong>The keep-alive timeout is the trap.</strong> It measures time between <em>requests</em>
        on an idle connection. A slowloris connection is never idle — it is mid-request, making a byte
        of progress now and then — so a two-minute keep-alive never fires, and lowering it to seconds
        would hurt legitimate clients while doing nothing to the attack.</p>
        <p><code>MaxConcurrentConnections</code> bounds the damage rather than stopping it, and the cost
        is that legitimate clients are refused alongside the attacker once the ceiling is reached.</p>
        <p>All four defences are on by default. The realistic risk is not forgetting to enable them —
        it is switching one off for a legitimate slow client, globally, and never putting it back.</p>
        <p>And the honest limit: these bound what <em>one connection</em> can waste. Ten thousand
        connections each behaving legally is a volume problem, handled in front of you.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>After moving behind an ingress, every request appears to come from one address. Diagnose it, fix
    it, and say how you would know the fix is correct.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="08-exercises.cs"><code>   configuration                        distinct clients   allow-list spoofable
   -------------                        ----------------   --------------------
   no middleware                                       1                     no
   cleared sets, no ForwardLimit                       4                    YES
   ingress trusted, ForwardLimit 1                     4                     no</code></pre>
        <p><strong>The diagnosis.</strong> Your application is not talking to clients any more.
        <code>RemoteIpAddress</code> is the ingress — correctly — and every client shares one
        rate-limit bucket. Confirm by logging <code>RemoteIpAddress</code> on one endpoint: if an hour
        of traffic has one address, that is your proxy.</p>
        <p><strong>The fix, in four parts:</strong></p>
        <ol>
          <li><code>UseForwardedHeaders</code>, registered <strong>first</strong> — before
          authentication, HTTPS redirection, rate limiting and logging, all of which read the address or
          the scheme.</li>
          <li>Clear the defaults <strong>and add</strong> the ingress. Clearing alone means trusting
          every sender — the middle row above — which is the opposite of how it reads.</li>
          <li><code>ForwardLimit</code> = the number of proxies you run, normally 1. Each proxy
          <em>appends</em> the address it saw, so N entries from the right are the ones your own proxies
          wrote.</li>
          <li>Check the ingress actually sends the headers. nginx needs
          <code>proxy_set_header X-Forwarded-Proto $scheme</code> explicitly.</li>
        </ol>
        <p><strong>How you know it is right</strong> — two checks, and the second is the one people
        miss:</p>
        <pre data-lang="bash" data-title="The two checks"><code>curl https://api.ledger.example/whoami
# -&gt; should report YOUR address, not the ingress

curl -H "X-Forwarded-For: 10.0.0.5" https://api.ledger.example/admin
# -&gt; must NOT be 200</code></pre>
        <p>The first check passes in <em>both</em> of the last two rows. Only the second distinguishes a
        correct configuration from one that fixed rate limiting by making every IP-based decision
        forgeable — and this middleware fails silently in both directions, so neither state is visible
        without asking.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>A service is exposed directly to the internet with no proxy, no CDN and no load balancer. Which
    Kestrel settings do you change from their defaults, and what can Kestrel not do for you at all?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>What to change</strong></p>
        <ol>
          <li><strong><code>MaxConcurrentConnections</code> — set it.</strong> It defaults to no limit,
          which is right behind a proxy that already bounds connections and wrong when you are the front
          door. Pick a number below the point where the process runs out of memory or file descriptors,
          and know that clients above it get a dropped connection with no explanation.</li>
          <li><strong><code>MaxRequestBodySize</code> — lower it.</strong> 30,000,000 bytes is generous
          for a public API. Set the global limit to the largest ordinary request and raise it per
          endpoint where a genuine upload needs it.</li>
          <li><strong>The timeouts and data rates — leave them on.</strong> They are the slowloris
          defence and they are already correct.</li>
          <li><strong>TLS — you now own it.</strong> Certificate provisioning, renewal and reload without
          downtime become your problem. An expired certificate is a total outage on a date nobody is
          watching.</li>
          <li><strong>Forwarded headers — do not enable them.</strong> There is no proxy, so there is
          nobody trustworthy to write those headers, and honouring them would let every client choose its
          own address.</li>
        </ol>
        <p><strong>What Kestrel cannot do for you</strong></p>
        <ul>
          <li><strong>Volume.</strong> Every limit in this module bounds what one connection can waste.
          None helps against a hundred thousand connections all behaving legally.</li>
          <li><strong>Network-layer floods.</strong> A SYN flood never reaches your process; it fills the
          queue in front of it.</li>
          <li><strong>Caching and static content</strong>, which a CDN does far better and without
          consuming your connections at all.</li>
          <li><strong>Any of it while you deploy.</strong> One process serving directly means a restart
          is an outage — there is nothing in front to hold connections while you roll.</li>
        </ul>
        <p>So the honest answer is that the settings are the small part. <strong>The real answer is to
        put something in front</strong> — and if you genuinely cannot, the list above is damage
        limitation rather than a defence.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is the difference between what <code>MaxConcurrentConnections</code> counts and what your
    request metrics count?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Sockets versus requests. Six requests over keep-alive are one
        socket; the same six with <code>Connection: close</code> are six. The two are related only by
        client behaviour.</p></div></details></li>

    <li><p>A client connects when <code>MaxConcurrentConnections</code> is already reached. What
    happens?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The connection is accepted and closed immediately, before a byte is
        read. It is not queued, there is no status code, and it never reaches your connection middleware
        or your access log.</p></div></details></li>

    <li><p>Which status codes do the four request size limits produce?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>413 for the body, 414 for the request line, and <strong>431 for
        both</strong> header limits — count and total size share a code.</p></div></details></li>

    <li><p>Where is <code>MaxRequestBodySize</code> enforced, and why does that matter?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>At the read, inside your handler, not before it is called. So your
        handler is already running, and a <code>catch (Exception)</code> around the read turns a correct
        413 into a 500.</p></div></details></li>

    <li><p>You configure <code>RequestHeadersTimeout</code> to 200 ms. When does it fire?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>At about two seconds. Kestrel checks timeouts on a roughly
        one-second heartbeat, so the practical floor is about two seconds and larger values cost your
        value plus up to a heartbeat.</p></div></details></li>

    <li><p>Which timeout does <em>not</em> defend against slowloris?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>KeepAliveTimeout</code>. It measures idle time between
        requests, and a slowloris connection is never idle — it is mid-request making occasional
        progress.</p></div></details></li>

    <li><p>Why does HTTP/2 in practice require TLS?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The version is chosen by ALPN during the TLS handshake. Without
        TLS there is no negotiation, so both ends must be configured for "prior knowledge" in
        advance.</p></div></details></li>

    <li><p>Behind a TLS-terminating proxy, what are <code>Request.IsHttps</code> and
    <code>RemoteIpAddress</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>false</code> and the proxy's address. Both are correct about
        your connection and wrong about the client, which is what
        <code>UseForwardedHeaders</code> exists to repair.</p></div></details></li>

    <li><p>What does clearing <code>KnownProxies</code> and <code>KnownIPNetworks</code> mean?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><strong>Trust everyone.</strong> The middleware only checks the
        sender when the trusted sets are non-empty, so an empty set is unrestricted. If you clear, you
        must add.</p></div></details></li>

    <li><p>Why is <code>ForwardLimit</code> 1 by default, and which end of the chain does it read?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The <strong>right-hand</strong> end. Each proxy appends the address
        it saw, so the rightmost entry is the one your own proxy wrote and everything left of it came
        from further away. Raise it to exactly the number of proxies you run.</p></div></details></li>

    <li><p>Rate limiting starts working after you enable forwarded headers. What is the one check that
    tells you whether you did it safely?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Send a forged <code>X-Forwarded-For</code> matching an allow-listed
        address and confirm you do <em>not</em> get a 200. Rate limiting works in both the safe and the
        unsafe configuration; only the forgery test separates them.</p></div></details></li>

    <li><p>Why are Kestrel-layer failures invisible in application metrics?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Because the request was rejected before it became a request. A
        refused connection was never parsed, so it incremented no counter, hit no middleware and wrote no
        access log line. Kestrel's own logs and its <code>kestrel.*</code> counters are the only place it
        appears.</p></div></details></li>
  </ol>
</section>
`
});
