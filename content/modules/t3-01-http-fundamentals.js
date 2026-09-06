CSPREP.module({
  id: "t3-01-http-fundamentals",
  minutes: 55,
  updated: "2026-09-02",
  summary: "Ledger charged one customer three times for one payment, and every line of the server was correct. POST is not idempotent, the client retried after a timeout, and nothing in the code was wrong - the protocol decision was. Measured here: three attempts producing 3 charges with no key, 2 with a key recorded after the work, and 1 with the key reserved before it. Methods, status codes, headers and connections are the contract every proxy, cache, retry policy and dashboard reads without knowing anything about your domain.",
  terms: ["HTTP", "protocol", "request", "response", "request line", "status line", "header",
    "body", "Content-Length", "Transfer-Encoding", "chunked", "safe", "idempotent", "cacheable",
    "status code", "Location", "content negotiation", "Accept", "quality value", "ETag",
    "conditional request", "If-None-Match", "If-Match", "Cache-Control", "no-cache", "no-store",
    "Vary", "keep-alive", "multiplexing", "head-of-line blocking", "idempotency key"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A Ledger customer is charged £1,234.50 three times for one payment. Support has the screenshots.
  You open the payment service expecting to find a loop, a duplicated call, a missing check.</p>

  <p>There is nothing wrong with the code. The handler runs once per request, creates one charge, and
  returns. It did that three times because it was asked three times.</p>

  <p>The caller is the checkout service. It has a two-second timeout and a retry policy: on a timeout,
  try again, up to three times. The payment gateway was slow that afternoon. Each attempt reached
  Ledger, Ledger called the gateway, the gateway took longer than two seconds, and checkout gave up
  waiting and sent the request again — while the first one was still running.</p>

  <p><strong>Every component behaved exactly as designed and the customer was charged three
  times.</strong> The defect is not in any of them. It is in a decision nobody remembers making: the
  endpoint is a <code>POST</code>, and <code>POST</code> makes no promise about what happens when you
  send it twice.</p>

  <p>Here is the same situation reproduced and measured. Three attempts, one customer, one intended
  payment, against three versions of the endpoint:</p>

  <pre data-lang="console" data-title="06-production.cs"><code>   v1, no key                         : 3 charges
   v2, key recorded AFTER the work    : 2 charges
   v3, key reserved BEFORE the work   : 1 charge</code></pre>

  <p>The middle row is the one worth staring at. Version 2 has an idempotency key, checks it, stores
  it, and replays the first result on a repeat — the fix as it is usually described. It still charged
  twice.</p>

  <p>None of the three differences is a difference in business logic. They are differences in how the
  endpoint uses HTTP. That is what this module is about: <strong>the protocol is a contract that
  proxies, caches, retry policies, circuit breakers and dashboards all act on without knowing anything
  about payments</strong>, and getting it wrong produces incidents whose cause is invisible in the code
  you are reading.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every measurement, status code, header and byte count in this module was produced by running the
    programs shown, against a real server on this machine, and pasted in unedited. The output blocks
    are real rather than illustrative.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What HTTP actually is</h2>

  <p class="define"><span class="define__term">Protocol</span> An agreed format for exchanging
  messages, so that two programs written by people who never met can understand each other. It fixes
  what the bytes mean, not what the programs do with them.</p>

  <p class="define"><span class="define__term">Client and server</span> The client is the program that
  starts the conversation by sending a request. The server is the one that listens and answers. These
  are roles in one exchange, not descriptions of machines: your service is a server to the browser and
  a client to the payment gateway, in the same request.</p>

  <p class="define"><span class="define__term">Socket</span> A two-way stream of bytes between two
  programs, usually over a network. It has no notion of messages or boundaries — it is a pipe. Whatever
  structure you see on top of it, some protocol put there.</p>

  <p class="define"><span class="define__term">Port</span> A number from 1 to 65535 that identifies
  which program on a machine a connection is meant for. One machine has one address and many ports, so
  the port is how the operating system knows whether an arriving connection belongs to your web server
  or your database.</p>

  <p class="define"><span class="define__term">HTTP</span> The protocol the web runs on. A client sends
  a <em>request</em>, the server sends back a <em>response</em>, and both are text in a fixed shape.
  That is the whole idea; everything else is detail about that shape.</p>

  <h3>The shape of a request</h3>

  <p>A request is three parts, in order: a <em>request line</em>, some <em>headers</em>, and an
  optional <em>body</em>, with a blank line between the headers and the body.</p>

  <pre class="diagram"><code>GET /payments/PAY-0001 HTTP/1.1     &lt;- request line: method, target, version
Host: api.ledger.example            &lt;- headers, one per line
Accept: application/json
                                    &lt;- a blank line ends the headers
(body, if any)</code></pre>

  <p class="define"><span class="define__term">Method</span> The verb at the start of the request line
  — <code>GET</code>, <code>POST</code>, <code>PUT</code>, <code>DELETE</code> and a few others. It
  says what kind of operation this is, and it carries promises that the rest of the internet relies on.
  Methods are the subject of the next section.</p>

  <p class="define"><span class="define__term">Target</span> The path being asked for, such as
  <code>/payments/PAY-0001</code>. Combined with the <code>Host</code> header it identifies a
  <em>resource</em>: the thing the request is about.</p>

  <p class="define"><span class="define__term">Header</span> A <code>Name: value</code> line carrying
  information about the request or response rather than the content itself — what format the body is
  in, how long it is, who is asking, how long it may be cached. Headers are where most of HTTP's
  behaviour lives.</p>

  <p class="define"><span class="define__term">Body</span> The content, if there is any. A
  <code>GET</code> usually has none; a <code>POST</code> carries the thing being submitted.</p>

  <h3>The shape of a response</h3>

  <p>A response has the same shape, with a <em>status line</em> in place of the request line.</p>

  <pre class="diagram"><code>HTTP/1.1 201 Created                &lt;- status line: version, code, reason phrase
Location: /payments/PAY-0001        &lt;- headers
Content-Type: application/json
Content-Length: 42

{"chargeId":"PAY-0001","amount":123450}</code></pre>

  <p class="define"><span class="define__term">Status code</span> A three-digit number saying what
  happened. It is the one part of the response that every intermediate program understands, which is
  why choosing it correctly matters far more than it looks.</p>

  <p class="define"><span class="define__term">Reason phrase</span> The human-readable text after the
  code — <code>Created</code>, <code>Not Found</code>. Nothing should ever parse it; it exists for
  people reading a log.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every line above ends with a carriage return followed by a line feed — the two characters
    <code>\\r\\n</code>, not a single newline. That is a fixed part of the protocol, and it is the most
    common reason a hand-written HTTP client hangs: the server is still waiting for the rest of a line
    you thought you had finished.</p>
  </div>

  <h3>An analogy, and where it stops working</h3>

  <p>HTTP is like posting a letter with a printed form on the front. The form has fixed fields — what
  you want, which address, what format you can read — and the letter inside is the content. The post
  office reads only the form. It has no idea what your letter says, and it can still sort it, forward
  it, return it as undeliverable, or refuse to carry it.</p>

  <p><strong>This is an analogy, and it is worth knowing where it breaks.</strong> Two places. First, a
  letter goes one way; an HTTP exchange is always a matched pair, and the response is as structured as
  the request. Second — and this is the part the analogy actively misleads about — the post office does
  not act on your letter. HTTP's intermediaries do: a cache stores your response and serves it to
  somebody else, a retry policy sends your request again, a proxy rejects it. They do all of that
  reading only the form. That is precisely why filling the form in correctly is the subject of this
  module.</p>
</section>

<section id="minimal-example">
  <h2>Minimal example: the bytes on the wire</h2>

  <p>Nothing above needs to be taken on trust. This program starts a real server, then talks to it with
  a raw socket rather than an HTTP client, so the actual bytes are visible.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-on-the-wire.cs"><code>// 01-on-the-wire.cs — What an HTTP request and response actually look like as
// bytes, read off a real socket talking to a real Kestrel.
//
// Run:  dotnet run 01-on-the-wire.cs -c Release
//
// This starts a genuine ASP.NET Core server on the loopback address, on a port
// the operating system chooses, and then talks to it with a raw TcpClient so
// nothing is hidden by HttpClient.
//
// EXACT vs RATIO: every byte shown here is deterministic apart from the Date
// header and the port number.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true

using System.Net.Sockets;
using System.Text;

var builder = WebApplication.CreateBuilder();

// Port 0 means "any free port" - the OS picks one and tells us. Using a fixed
// port in a sample is how two programs collide on a build agent.
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

app.MapGet("/hello", () =&gt; "hi");
app.MapGet("/fixed", () =&gt; Results.Text("a fixed length body", "text/plain"));
app.MapPost("/echo", (HttpRequest request) =&gt; Results.Text($"you sent {request.ContentLength} bytes"));

await app.StartAsync();

int port = new Uri(app.Urls.First()).Port;
Console.WriteLine($"Kestrel listening on 127.0.0.1:{port}");
Console.WriteLine();

TheRequest();
await TheResponse(port);
await BodyFraming(port);
await WhatIsRequired(port);

await app.StopAsync();

// ---------------------------------------------------------------------------
static void TheRequest()
{
    Console.WriteLine("1. What a request is");
    Console.WriteLine();
    Console.WriteLine("   Three parts, separated by carriage-return line-feed pairs:");
    Console.WriteLine();
    Console.WriteLine("     GET /hello HTTP/1.1          &lt;- request line: method, target, version");
    Console.WriteLine("     Host: 127.0.0.1              &lt;- headers, one per line");
    Console.WriteLine("     Connection: close");
    Console.WriteLine("                                  &lt;- a blank line ends the headers");
    Console.WriteLine("     (body, if any)");
    Console.WriteLine();
    Console.WriteLine("   That is the entire protocol for a request. It is text, it is");
    Console.WriteLine("   line-oriented, and the blank line is what tells the server the");
    Console.WriteLine("   headers are finished.");</code></pre>

  <p>The full file is longer — it also demonstrates body framing and the errors the server insists on.
  Its output:</p>

  <pre data-lang="console" data-title="01-on-the-wire.cs output"><code>2. What comes back

   the exact bytes, with line breaks made visible:

     HTTP/1.1 200 OK\\r\\n
     Connection: close\\r\\n
     Content-Type: text/plain; charset=utf-8\\r\\n
     Date: Wed, 02 Sep 2026 15:14:33 GMT\\r\\n
     Server: Kestrel\\r\\n
     Transfer-Encoding: chunked\\r\\n
     \\r\\n
     2\\r\\n
     hi\\r\\n
     0\\r\\n
     \\r\\n
     \\r\\n</code></pre>

  <p>The handler returned the two-character string <code>hi</code>. Four of those six headers were
  added by the server without being asked. The last one is the interesting one.</p>

  <h3>How the receiver knows where the body ends</h3>

  <p>A socket is a stream of bytes with no end marker. If a server sends a body and then waits for the
  next request, the client has to know when to stop reading — otherwise it blocks forever waiting for
  bytes that are not coming. HTTP has exactly three answers.</p>

  <p class="define"><span class="define__term">Content-Length</span> A header giving the body's size in
  bytes. The receiver reads exactly that many and stops. Requires the sender to know the size before it
  starts sending.</p>

  <p class="define"><span class="define__term">Transfer-Encoding: chunked</span> The body is sent as a
  series of chunks, each prefixed with its own length in hexadecimal, ending with a zero-length chunk.
  The sender does not need to know the total in advance.</p>

  <p>In the output above, <code>2</code> is the length of <code>hi</code> in hex, and <code>0</code>
  ends the body. That framing is why the response could start before the total size was known.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Framing</th><th>When it is used</th><th>Cost</th></tr></thead>
      <tbody>
        <tr><td><code>Content-Length</code></td><td>The size is known up front — a file, a serialised object</td><td>Must buffer or measure first</td></tr>
        <tr><td><code>chunked</code></td><td>Streaming, or a generated body of unknown size</td><td>A few bytes per chunk, and no size known to the client</td></tr>
        <tr><td>Connection close</td><td>HTTP/1.0 only</td><td>A dropped connection is indistinguishable from a complete response</td></tr>
      </tbody>
    </table>
  </div>

  <p>The third one is worth understanding rather than using. If the body ends when the socket closes,
  then a network failure halfway through delivers a truncated response that looks complete. A client
  parsing JSON will get a syntax error; a client reading a CSV will silently process half the rows.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>You cannot set a header after the first byte of the body has been sent.</strong> The
    status line and headers go on the wire before the body, so once the response has <em>started</em>
    they are gone.</p>
    <p>This is why an exception thrown halfway through streaming a large response cannot become a 500 —
    the 200 was sent minutes ago. The client receives a truncated body with a success status. ASP.NET
    Core will log <code>The response has already started</code> and there is nothing it can do about
    it.</p>
    <p>The practical consequence: do work that can fail <em>before</em> you start writing the response,
    not during it.</p>
  </div>
</section>

<section id="methods">
  <h2>Methods, and the three promises they make</h2>

  <p>The method is not a label. Each one carries promises that programs you have never seen will act
  on. Three properties matter, and they are commonly confused with each other.</p>

  <p class="define"><span class="define__term">Safe</span> The request does not change server state at
  all. A crawler may call it, a browser may prefetch it, a monitoring probe may hit it every thirty
  seconds — all without asking you.</p>

  <p class="define"><span class="define__term">Idempotent</span> Calling it N times leaves the same
  state as calling it once. It may still <em>change</em> state, but not cumulatively. This is the
  property retry logic depends on.</p>

  <p class="define"><span class="define__term">Cacheable</span> The response may be stored and reused
  for a later identical request, by the client or by anything in between.</p>

  <pre data-lang="console" data-title="02-methods.cs"><code>   method    safe   idempotent   cacheable
   ------    ----   ----------   ---------
   GET       yes    yes          yes
   HEAD      yes    yes          yes
   OPTIONS   yes    yes          no
   PUT       no     yes          no
   DELETE    no     yes          no
   POST      no     NO           rarely
   PATCH     no     NO           no</code></pre>

  <p>Every safe method is idempotent — changing nothing N times is the same as changing nothing once.
  The reverse does not hold: <code>PUT</code> and <code>DELETE</code> change state and are still
  idempotent.</p>

  <p><strong><code>POST</code> and <code>PATCH</code> are the two that are not idempotent, and that is
  the entire reason retry logic is dangerous.</strong> Here is what that means, measured — the same
  request sent three times to each of three endpoints:</p>

  <pre data-lang="console" data-title="02-methods.cs"><code>2. POST repeated three times

   attempt 1: 201 Created, Location: /payments/PAY-0001
   attempt 2: 201 Created, Location: /payments/PAY-0002
   attempt 3: 201 Created, Location: /payments/PAY-0003

   payments now on the server: 3

3. PUT repeated three times

   attempt 1: 201 Created
   attempt 2: 204 NoContent
   attempt 3: 204 NoContent

   payments now on the server: 1

4. DELETE repeated three times

   attempt 1: 204 NoContent
   attempt 2: 204 NoContent
   attempt 3: 204 NoContent

   payments now on the server: 0</code></pre>

  <p>Three payments from three identical <code>POST</code>s — which is exactly what the retry in the
  opening incident did. <strong>This is not a bug in the server.</strong> <code>POST</code> means
  "create a new subordinate resource", and it did that three times, correctly.</p>

  <p>The difference with <code>PUT</code> is that the <em>client</em> chose the identity. The request
  says <code>PUT /payments/PAY-0001</code>, so a second request lands on the resource the first one
  created rather than making another.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Notice the status codes in the <code>PUT</code> run: 201 for the first, 204 for the rest.
    <strong>Idempotent means the resulting state is the same, not that the response is
    identical.</strong></p>
    <p>A retry policy written as <code>if (status == 201) success else fail</code> will treat a
    successful retry as a failure, and then retry again. Check for success as a <em>class</em> — any
    2xx — not for one code.</p>
  </div>

  <h3>What a timeout tells you</h3>

  <p>Nothing. That is the point that makes all of this matter.</p>

  <p>When a request times out, the response did not arrive. There are three reasons for that and the
  client cannot distinguish them: the request never reached the server, the server processed it and
  the response was lost, or the server is still working on it right now. Only the first is safe to
  retry blindly.</p>

  <pre data-lang="console" data-title="02-methods.cs"><code>     GET, HEAD, PUT, DELETE, OPTIONS   safe to retry automatically
     POST, PATCH                       NOT safe to retry, unless the
                                       endpoint was designed for it</code></pre>

  <p>"Designed for it" means an idempotency key, which the production section builds and measures.</p>

  <h3>The safe-method bug</h3>

  <p>Putting a state change behind <code>GET</code> is legal HTTP and it is a bug. Measured:</p>

  <pre data-lang="console" data-title="02-methods.cs"><code>5. A GET that changes state

   before      : settled
   after a GET : cancelled</code></pre>

  <p><code>GET /payments/PAY-0001/cancel</code> works. It also means that every one of these cancels
  payments nobody asked to cancel:</p>

  <ul>
    <li>A browser prefetching links it predicts you might click.</li>
    <li>A crawler following every <code>GET</code> it finds.</li>
    <li>A proxy or CDN caching the response and serving it to somebody else.</li>
    <li>A retry layer repeating it without asking, because <code>GET</code> is safe.</li>
    <li>A link checker running over your own documentation.</li>
    <li>A monitoring probe hitting it every thirty seconds, forever.</li>
  </ul>

  <p><strong>None of those is an attacker.</strong> This is the classic incident in which a crawler
  emptied a database, and it needs nobody's malice — only a link.</p>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Authentication fixes it — only logged-in users can reach that URL."</em></p>
    <p>It does not. Authentication controls <em>who</em> can make the request; it does nothing about
    <em>what</em> makes it on their behalf. A logged-in user's own browser prefetches links, their own
    corporate proxy caches responses, and their own retry policy repeats safe requests. The fix is the
    method: <code>POST /payments/{id}/cancel</code>, or <code>DELETE</code>.</p>
  </div>
</section>

<section id="status-codes">
  <h2>Status codes are instructions, not labels</h2>

  <p>The useful question when choosing a status code is not "what happened?" but <strong>"what do I
  want the caller to do next?"</strong> Read the last column here rather than the numbers:</p>

  <pre data-lang="console" data-title="03-status-codes.cs"><code>   endpoint          status   notable header        client should
   --------          ------   --------------        -------------
   /ok                  200                         use the body
   /created             201   Location: /payments/PAY-0001  follow Location for the new thing
   /no-content          204                         expect no body at all
   /moved               301   Location: /ok         update its stored URL
   /bad-request         400                         fix the request, do not retry
   /unauthorized        401                         authenticate, then retry
   /forbidden           403                         give up; auth will not help
   /not-found           404                         give up, or create it
   /conflict            409                         re-read state and decide
   /unprocessable       422                         fix the DATA, not the syntax
   /rate-limited        429   Retry-After: 30       wait Retry-After, then retry
   /unavailable         503   Retry-After: 5        wait Retry-After, then retry
   /boom                500                         retry with backoff; may be transient</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Look at the <code>notable header</code> column for <code>/unauthorized</code>: it is empty.
    <strong><code>Results.Unauthorized()</code> returns a bare 401 with no
    <code>WWW-Authenticate</code> header</strong>, and the specification requires a 401 to carry one
    saying how to authenticate.</p>
    <p>Most API clients do not care, which is why this survives in a great deal of production code. The
    ones that do care are the generic ones — a browser prompting for credentials, an OAuth client
    library deciding which flow to start, an HTTP client with automatic re-authentication. They see a
    401 with no instructions and have nothing to act on.</p>
    <p>If your API is consumed by anything other than code you wrote, set the header yourself:
    <code>response.Headers.WWWAuthenticate = "Bearer";</code> before returning the 401.</p>
  </div>

  <h3>The five classes, and what they mean for blame</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Class</th><th>Meaning</th><th>Whose fault</th></tr></thead>
      <tbody>
        <tr><td>1xx</td><td>Informational — rare; <code>100 Continue</code>, <code>101 Switching Protocols</code></td><td>—</td></tr>
        <tr><td>2xx</td><td>Success</td><td>—</td></tr>
        <tr><td>3xx</td><td>Redirection — look elsewhere</td><td>—</td></tr>
        <tr><td><strong>4xx</strong></td><td>Client error — the caller must change something</td><td>The caller</td></tr>
        <tr><td><strong>5xx</strong></td><td>Server error — the caller did nothing wrong</td><td>You</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>The 4xx/5xx split is an assignment of blame, and it drives real behaviour.</strong>
  Alerting, error budgets, retry policy and circuit breakers all key off it. Returning 500 for a
  validation failure pages somebody at 3am because a caller sent bad data. Returning 400 for a genuine
  server fault hides an outage: your error rate stays flat while every request fails.</p>

  <p>The pair most often confused: <strong>429 is 4xx</strong> — the client sent too many requests —
  and <strong>503 is 5xx</strong> — the server cannot cope right now. Both should carry
  <code>Retry-After</code>. The difference is whose fault it is, and therefore whether it counts
  against your availability.</p>

  <h3>The four decisions people get wrong</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Choice</th><th>Use the first when</th><th>Use the second when</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>400</strong> or <strong>422</strong></td>
          <td>The request is <em>malformed</em> — broken JSON, a string where a number belongs, a missing required field</td>
          <td>The request <em>parsed</em> and the values are unacceptable — a negative amount, a currency this tenant cannot use</td>
        </tr>
        <tr>
          <td><strong>401</strong> or <strong>403</strong></td>
          <td>You do not know who the caller is. Authenticating may help, and a 401 must carry <code>WWW-Authenticate</code> saying how</td>
          <td>You know who they are and they may not do this. Authenticating again will <em>not</em> help — do not prompt for credentials</td>
        </tr>
        <tr>
          <td><strong>404</strong> or <strong>403</strong></td>
          <td>Returning 404 for "not yours" hides whether the resource exists — the right choice in a multi-tenant system, at the cost of harder debugging</td>
          <td>403 admits it exists. Probing IDs then tells an attacker which ones are real</td>
        </tr>
        <tr>
          <td><strong>409</strong> or <strong>422</strong></td>
          <td>The request is fine and conflicts with <em>current state</em> — cancelling an already-settled payment. Retrying unchanged might succeed later</td>
          <td>The values are wrong regardless of state</td>
        </tr>
      </tbody>
    </table>
  </div>

  <p>Both 400 and 422 mean "do not retry unchanged". The distinction is still worth making, because 422
  tells the caller their <em>code</em> is fine and their <em>data</em> is not, which is a different
  fix by a different person.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The names of 401 and 403 are backwards, which is most of why they are confusing. <strong>401 is
    called <code>Unauthorized</code> and means unauthenticated.</strong> 403 <code>Forbidden</code> is
    the one about authorisation.</p>
  </div>

  <h3>The anti-pattern: 200 with a failure inside</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Do not do this"><code>app.MapGet("/lying", () =&gt; Results.Ok(new { success = false, error = "payment declined" }));</code></pre>

  <pre data-lang="console" data-title="03-status-codes.cs"><code>   status                       : 200
   IsSuccessStatusCode          : True
   body                         : {"success":false,"error":"payment declined"}</code></pre>

  <p>The payment was declined and every layer between you and the caller believes it succeeded:</p>

  <ul>
    <li><code>EnsureSuccessStatusCode()</code> does not throw.</li>
    <li>A retry policy sees success and does not retry.</li>
    <li>A circuit breaker never opens, however often it fails.</li>
    <li>Your own error-rate dashboard reads 0%.</li>
    <li>A proxy or CDN may <em>cache</em> the failure and serve it to others.</li>
  </ul>

  <p>The failure is visible only to code that parses the body and knows to look for a
  <code>success</code> field. That is every caller, forever, and one that forgets treats a declined
  payment as a settled one.</p>

  <p><strong>The status line carries the outcome; the body carries the detail.</strong> The status line
  is the one part of the response that every layer already understands.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>Results.Forbid()</code> is not a way to return 403. Measured:</p>
    <pre data-lang="console" data-title="03-status-codes.cs"><code>   Results.StatusCode(403) -&gt; 403
   Results.Forbid()        -&gt; 500</code></pre>
    <p><code>Forbid()</code> and <code>Challenge()</code> ask the registered <em>authentication
    scheme</em> to handle the rejection — a cookie scheme redirects to a login page, a JWT scheme sets
    a header. With no scheme registered there is no handler to call, and it throws.</p>
    <p>This fails in exactly the environment where it is least expected: a test host, or a minimal
    service that has authorisation logic but has not wired up authentication. Use
    <code>Forbid()</code> when a scheme is configured and you want its behaviour; use
    <code>Results.StatusCode(403)</code> when you want a 403.</p>
  </div>
</section>

<section id="headers">
  <h2>Headers: negotiation, caching, and the ones that cause breaches</h2>

  <h3>Content negotiation</h3>

  <p class="define"><span class="define__term">Content negotiation</span> The client says what formats
  it can accept, in an <code>Accept</code> header; the server picks one and says which it chose, in
  <code>Content-Type</code>. The two headers point in opposite directions: <code>Accept</code> is what
  the client <em>will take</em>, <code>Content-Type</code> is what <em>this body actually is</em>.</p>

  <pre data-lang="console" data-title="04-headers.cs"><code>   Accept sent                                status   Content-Type returned
   -----------                                ------   ---------------------
   application/json                              200   application/json
   application/xml                               200   application/xml
   */*                                           200   application/json
   application/json, application/xml;q=0.9       200   application/xml
   text/csv                                      406   (none)</code></pre>

  <p>The last row is <code>406 Not Acceptable</code>: the client asked for a format the server cannot
  produce. Returning JSON anyway would be a lie the client is not equipped to parse.</p>

  <p class="define"><span class="define__term">Quality value</span> A weight from 0 to 1, written
  <code>;q=0.9</code>, saying how much the client prefers that option. Absent means <code>q=1</code>.</p>

  <p><strong>Row four is the one to learn from.</strong> The client asked for JSON at an implied
  <code>q=1</code> and XML at <code>q=0.9</code> — a clear preference for JSON — and this server
  returned XML. That is not a bug in the test program; it is what most hand-written negotiation does,
  because it checks for XML first and XML is present.</p>

  <p><strong>The server's check order, not the client's stated preference, decides what comes
  back.</strong> If preference order matters to your callers you have to parse and sort by
  <code>q</code> yourself. MVC's formatter selection does this; a chain of <code>Contains</code> checks
  does not.</p>

  <h3>Conditional requests</h3>

  <p class="define"><span class="define__term">ETag</span> An opaque string the server attaches to a
  response, identifying that exact version of that resource. The client sends it back later to ask
  "has this changed?"</p>

  <p class="define"><span class="define__term">Conditional request</span> A request carrying a
  validator — an ETag or a timestamp — that the server checks before deciding whether to send a body.</p>

  <pre data-lang="console" data-title="04-headers.cs"><code>   first request
     status        : 200
     ETag          : "F0F9A0C36BFD8C12"
     Cache-Control : max-age=60, private
     body bytes    : 55

   second request, with If-None-Match
     status        : 304 NotModified
     body bytes    : 0</code></pre>

  <p><code>304 Not Modified</code> means "what you already have is current". No body; the client uses
  its cached copy.</p>

  <p><strong>Be precise about what this saves.</strong> The request still happened: a round trip, a
  connection, and whatever work the server did to decide the ETag still matched. What it saves is the
  <em>body</em>. That is worth a great deal for a large payload and almost nothing for a 55-byte one —
  and it is only a saving at all if computing the ETag is cheaper than producing the body. An ETag
  computed by hashing a body you have already generated saves bandwidth and no server work whatever.</p>

  <p>A cheap ETag comes from something you already have: a version column, a row version, a
  last-modified timestamp.</p>

  <p>The other half of the feature is concurrency control:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Header</th><th>On</th><th>Means</th><th>On failure</th></tr></thead>
      <tbody>
        <tr><td><code>If-None-Match</code></td><td><code>GET</code></td><td>Send it only if it changed</td><td>304, no body</td></tr>
        <tr><td><code>If-Match</code></td><td><code>PUT</code></td><td>Accept only if nobody else changed it since</td><td>412 Precondition Failed</td></tr>
      </tbody>
    </table>
  </div>

  <p><code>If-Match</code> turns a lost update into a 412, which is optimistic concurrency control over
  HTTP for the price of one header.</p>

  <h3>Cache-Control, and who is allowed to keep a copy</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Directive</th><th>Meaning</th></tr></thead>
      <tbody>
        <tr><td><code>no-store</code></td><td>Never write this down anywhere. For anything genuinely secret.</td></tr>
        <tr><td><code>no-cache</code></td><td>You may store it, but revalidate every time before using it. <strong>Not</strong> the same as <code>no-store</code>.</td></tr>
        <tr><td><code>private</code></td><td>Only the end client may cache it. Shared caches — a CDN, a proxy — must not.</td></tr>
        <tr><td><code>public</code></td><td>Any cache may keep it, including shared ones.</td></tr>
        <tr><td><code>max-age=N</code></td><td>Usable without asking for N seconds.</td></tr>
        <tr><td><code>must-revalidate</code></td><td>Once stale, do not serve it; ask first.</td></tr>
      </tbody>
    </table>
  </div>

  <p>The two that get confused are <code>no-cache</code> and <code>no-store</code>, and the names are
  the reason. <strong><code>no-cache</code> still caches</strong> — it revalidates first. If a response
  must never touch a disk, <code>no-store</code> is the one.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>This header, on a per-user response, is a data breach:</p>
    <pre data-lang="text" data-bad="true" data-title="A per-user response"><code>Cache-Control: public, max-age=3600</code></pre>
    <p>A shared cache stores one user's data against the URL and serves it to the next user who asks
    for that URL, for an hour. No authentication check runs, because the request never reaches your
    server.</p>
    <p>Anything varying by identity is <code>private</code> at minimum and <code>no-store</code> if it
    is sensitive.</p>
  </div>

  <p class="define"><span class="define__term">Vary</span> A response header naming the request headers
  the response depends on. It tells a cache which requests may safely be served this stored copy.</p>

  <p>Without <code>Vary: Accept</code>, a cache keyed only on the URL will serve the XML representation
  to a client that asked for JSON. Without <code>Vary: Authorization</code>, it can serve one user's
  response to another even when the response was marked <code>private</code> by a cache that ignores
  it.</p>

  <h3>Rules about headers themselves</h3>

  <pre data-lang="console" data-title="04-headers.cs"><code>   what the server saw:
     X-Tenant: acme
     x-TENANT-Case: MixedValue
     X-Repeated: first, second</code></pre>

  <ul>
    <li><strong>Names are case-insensitive.</strong> <code>x-TENANT-Case</code> and
    <code>X-Tenant-Case</code> are the same header, so never compare a header name with
    <code>==</code>.</li>
    <li><strong>Values are case-sensitive</strong> and are preserved exactly.</li>
    <li><strong>Repeated headers are legal and combine</strong>, comma-separated.</li>
  </ul>

  <p>That last point is why <code>HeaderDictionary</code> values are <code>StringValues</code> rather
  than <code>string</code>: calling <code>.ToString()</code> on a repeated header gives you
  <code>first,second</code>, while indexing <code>[0]</code> gives you only the first.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>If your code reads a header such as <code>X-Forwarded-For</code> or an API key with
    <code>[0]</code>, and a proxy in front of you reads the <em>last</em> one, then a client that sends
    the header twice makes the two of you disagree about its value.</p>
    <p>That disagreement is the whole basis of a class of authentication-bypass and IP-spoofing
    attacks. Decide explicitly which occurrence you trust, and reject requests that send more than one
    where only one makes sense.</p>
  </div>
</section>

<section id="connections">
  <h2>The connection underneath</h2>

  <p class="define"><span class="define__term">Keep-alive</span> Reusing one TCP connection for several
  requests instead of opening a new one each time. In HTTP/1.1 it is the default; the connection stays
  open unless somebody sends <code>Connection: close</code>.</p>

  <pre data-lang="console" data-title="05-connections.cs"><code>   6 sequential requests
   distinct server-side connections used: 1

   the same 6 requests with Connection: close
   distinct server-side connections used: 6</code></pre>

  <p>Opening a connection is not free. A TCP handshake costs one round trip; a TLS handshake costs one
  or two more plus certificate work. On a link with 50 ms of latency that is 100–150 ms before a single
  byte of your request is sent. Reusing the connection pays it once rather than once per request.</p>

  <p>Six requests over six connections is what a client that creates a new <code>HttpClient</code> per
  request produces, and it is the cause of the socket exhaustion that <code>HttpClient</code>'s
  documentation warns about.</p>

  <h3>Multiplexing, and what HTTP/2 changes</h3>

  <p class="define"><span class="define__term">Head-of-line blocking</span> One slow item holding up
  everything queued behind it. In HTTP/1.1 a connection carries one request at a time, so a slow
  response blocks every request behind it on that connection.</p>

  <p class="define"><span class="define__term">Multiplexing</span> Splitting one connection into
  independent streams, each carrying a request and its response, interleaved. HTTP/2's central
  feature.</p>

  <pre data-lang="console" data-title="05-connections.cs"><code>   6 concurrent requests to a 100 ms endpoint, 2 connections allowed

   protocol   negotiated   connections   elapsed
   --------   ----------   -----------   -------
   HTTP/1.1          1.1             2     320 ms
   HTTP/2            2.0             1     115 ms</code></pre>

  <p>HTTP/1.1 needed three rounds over two connections. HTTP/2 sent all six at once over one
  connection, so the whole set took about as long as a single request.</p>

  <p>The connection <em>counts</em> are exact - the server counted real accepted sockets. The
  milliseconds are machine-specific; what transfers is the shape, three rounds against one.</p>

  <p><strong>What HTTP/2 does not solve is head-of-line blocking at the TCP layer.</strong> All those
  streams share one TCP connection, so one lost packet stalls every stream until it is retransmitted.
  That is what HTTP/3 fixes, by running over QUIC on UDP with per-stream delivery.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Version</th><th>What changed</th></tr></thead>
      <tbody>
        <tr><td>HTTP/1.1</td><td>Text on the wire. One request at a time per connection, keep-alive by default, <code>Host</code> required. Still the default for most server-to-server traffic.</td></tr>
        <tr><td>HTTP/2</td><td>Binary framing, multiplexed streams on one connection, header compression (HPACK), server push (now largely abandoned).</td></tr>
        <tr><td>HTTP/3</td><td>The same semantics over QUIC on UDP. Removes TCP head-of-line blocking, and merges the transport and TLS handshakes so a connection starts in one round trip.</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>The semantics did not change.</strong> A <code>GET</code> is still safe and idempotent, a
  404 still means the same thing, and <code>ETag</code> works identically. Every version since 1.1 has
  changed how bytes are framed and delivered, not what they mean.</p>

  <p>That is why this module spends most of its length on methods, status codes and headers: those
  transfer to every version, and the framing is mostly the server's problem rather than yours.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Two practical consequences. HTTP/2 in the wild is almost always over TLS, and the version is
    chosen during the TLS handshake by ALPN; cleartext HTTP/2 needs "prior knowledge" — both ends
    agreeing in advance — which is common between services and rare on the open internet.</p>
    <p>And gRPC requires HTTP/2, which is why a gRPC endpoint behind a proxy that downgrades to
    HTTP/1.1 fails in a way that looks like nothing to do with the proxy.</p>
  </div>
</section>

<section id="production">
  <h2>Realistic production example: the duplicate charge</h2>

  <p>Back to the incident. Ledger charges a customer three times; checkout retried after a two-second
  timeout while Ledger was waiting on a slow gateway.</p>

  <p>The first fix everybody reaches for is an <em>idempotency key</em>.</p>

  <p class="define"><span class="define__term">Idempotency key</span> A unique value the client
  generates for one logical operation and sends with every attempt at it. The server records the key
  with the result, and a repeat of the same key returns the first result instead of acting again. It
  makes a non-idempotent method safe to retry.</p>

  <p>Three versions of the endpoint, the same three attempts against each:</p>

  <pre data-lang="console" data-title="06-production.cs"><code>   /v2/payments
     attempt 1: TIMED OUT after 40 ms
     attempt 2: TIMED OUT after 40 ms
     attempt 3: 201 {"chargeId":"CHG-0001","replayed":true}
   /v3/payments
     attempt 1: TIMED OUT after 40 ms
     attempt 2: 409 {"error":"a request with this key is in progress"}

   v1, no key                         : 3 charges
   v2, key recorded AFTER the work    : 2 charges
   v3, key reserved BEFORE the work   : 1 charge</code></pre>

  <p>Version 2 has the key, checks it, stores it, and replays the first result on a repeat. It still
  charged twice. The reason is the order of two lines: it records the key <em>after</em> the 60 ms
  gateway call.</p>

  <pre class="diagram"><code>t=0    attempt 1 arrives, finds no key, starts the gateway call
t=40   attempt 1 times out client-side and attempt 2 is sent
t=40   attempt 2 arrives, finds NO KEY YET, starts a second call
t=60   attempt 1 finishes and records the key
t=80   attempt 3 arrives, finds the key, replays correctly</code></pre>

  <p>The check and the write are a check-then-act race with a 60 ms window in the middle.
  <strong>An idempotency key that is written after the work only protects against retries that arrive
  after it completes — which is precisely the retries you were not worried about.</strong></p>

  <p>Version 3 reserves the key first, atomically, before doing anything:</p>

  <pre data-lang="csharp" data-net="10" data-title="06-production.cs — /v3/payments"><code>app.MapPost("/v3/payments", async (PaymentRequest request, HttpRequest http) =&gt;
{
    string? key = http.Headers["Idempotency-Key"].FirstOrDefault();
    if (string.IsNullOrWhiteSpace(key))
    {
        return Results.BadRequest(new { error = "Idempotency-Key header is required" });
    }

    // Reserve the key BEFORE the slow work, atomically. TryAdd is the whole
    // fix: exactly one caller gets true, so exactly one calls the gateway.
    // In a real service this is a unique constraint on an insert.
    var reservation = new StoredResult(ChargeId: null);
    if (!idempotencyKeysV3.TryAdd(key, reservation))
    {
        StoredResult existing = idempotencyKeysV3[key];
        return existing.ChargeId is null
            ? Results.Conflict(new { error = "a request with this key is in progress" })
            : Results.Created($"/v3/payments/{existing.ChargeId}",
                new { chargeId = existing.ChargeId, replayed = true });
    }

    await Task.Delay(60);
    gatewayCalls++;

    var charge = new Charge($"CHG-{chargesV3.Count + 1:D4}", request.AmountMinor);
    chargesV3.Add(charge);
    idempotencyKeysV3[key] = new StoredResult(charge.Id);

    return Results.Created($"/v3/payments/{charge.Id}",
        new { chargeId = charge.Id, replayed = false });
});</code></pre>

  <p>Exactly one caller gets <code>true</code> from <code>TryAdd</code>, so exactly one calls the
  gateway. The losers either replay a finished result or receive 409 while it is still running. One
  charge from three attempts.</p>

  <p>The 409 for an in-flight duplicate is deliberate. The alternatives are worse: waiting for the
  first attempt holds a connection open, and returning success before the gateway has answered is a
  lie.</p>

  <h3>Getting the key itself right</h3>

  <pre data-lang="console" data-title="06-production.cs"><code>   a NEW key per attempt      : 3 charges
   ONE key for the operation  : 1 charge
   no key at all              : 400 BadRequest</code></pre>

  <p><strong>The header does not make anything idempotent by existing.</strong> The key must identify
  the <em>operation</em>, so it is generated once by whoever decided to make the payment — not inside
  the retry loop, and not by the HTTP layer. Generating it per attempt reproduces the original bug
  exactly while looking correct in review.</p>

  <p>Three more decisions a real implementation has to make:</p>

  <ul>
    <li><strong>How long to keep keys.</strong> Long enough to outlive any retry a client will make;
    24 hours is a common answer. They are state, and unbounded state is a leak.</li>
    <li><strong>What if the body differs for the same key?</strong> That is a client bug. Store a hash
    of the request with the key and return 422 on a mismatch, rather than silently replaying a result
    for a different request.</li>
    <li><strong>Where the key lives.</strong> A dictionary in memory loses every key when the process
    restarts, which is exactly when a client is most likely to retry. In a real service the reservation
    is a unique constraint on an insert, and the reservation and the charge belong in one
    transaction.</li>
  </ul>

  <h3>The whole contract in one file</h3>

  <p>Every decision in this module, applied to one small API and exercised end to end:</p>

  <pre data-lang="csharp" data-net="10" data-title="08-minimal-example.cs"><code>// 08-minimal-example.cs — One small API that applies every decision in this
// module, and a client that exercises each of them.
//
// Run:  dotnet run 08-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code, header and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Net.Http.Json;

var orders = new ConcurrentDictionary&lt;string, Order&gt;();
var idempotencyKeys = new ConcurrentDictionary&lt;string, string?&gt;();
int nextId = 0;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// --- READ: safe, cacheable, conditional ------------------------------------
app.MapGet("/orders/{id}", (string id, HttpRequest request, HttpResponse response) =&gt;
{
    if (!orders.TryGetValue(id, out Order? order))
    {
        return Results.NotFound();
    }

    // The ETag is built from data we already have. Serialising the order only
    // to hash it would save bandwidth and no server work at all.
    string etag = $"\"{order.Version}\"";
    response.Headers.ETag = etag;

    // An order belongs to one caller, so a SHARED cache must never store it.
    // 'private' is the difference between a cache and a data breach.
    response.Headers.CacheControl = "private, max-age=0, must-revalidate";

    if (request.Headers.IfNoneMatch.ToString() == etag)
    {
        return Results.StatusCode(304);
    }

    return Results.Ok(order);
});

// --- CREATE: unsafe, not idempotent, made retry-safe by a key ---------------
app.MapPost("/orders", async (OrderRequest body, HttpRequest request) =&gt;
{
    if (body.TotalMinor &lt;= 0)
    {
        // 422, not 400: the JSON parsed. The caller's CODE is fine and its
        // DATA is not, which is a different fix.
        return Results.UnprocessableEntity(new { error = "totalMinor must be positive" });
    }

    string? key = request.Headers["Idempotency-Key"].FirstOrDefault();
    if (string.IsNullOrWhiteSpace(key))
    {
        return Results.BadRequest(new { error = "Idempotency-Key header is required" });
    }

    // Reserve the key BEFORE the work, atomically. Checking a dictionary and
    // then writing to it leaves a window wide enough for a retry to fit
    // through - measured at 2 charges from 3 attempts in 06-production.cs.
    if (!idempotencyKeys.TryAdd(key, null))
    {
        string? completed = idempotencyKeys[key];
        return completed is null
            ? Results.Conflict(new { error = "a request with this key is in progress" })
            : Results.Created($"/orders/{completed}", orders[completed]);
    }

    await Task.Delay(20);                       // stands in for real work

    string id = $"ORD-{Interlocked.Increment(ref nextId):D4}";
    var order = new Order(id, body.TotalMinor, "placed", Version: 1);
    orders[id] = order;
    idempotencyKeys[key] = id;

    // 201 with Location: a client whose request timed out now has an identity
    // it can GET, rather than a choice between retrying and giving up.
    return Results.Created($"/orders/{id}", order);
});

// --- REPLACE: idempotent, so a proxy may retry it freely --------------------
app.MapPut("/orders/{id}/status", (string id, StatusRequest body) =&gt;
{
    if (!orders.TryGetValue(id, out Order? order))
    {
        return Results.NotFound();
    }

    if (order.Status == "cancelled")
    {
        // 409, not 422: the request is fine and the STATE forbids it. Retrying
        // unchanged might succeed at another time, which is what distinguishes
        // the two.
        return Results.Conflict(new { error = "a cancelled order cannot change status" });
    }

    orders[id] = order with { Status = body.Status, Version = order.Version + 1 };
    return Results.NoContent();
});

// --- DELETE: idempotent, so repeating it is not an error --------------------
app.MapDelete("/orders/{id}", (string id) =&gt;
{
    orders.TryRemove(id, out _);

    // 204 whether or not it was there. The client asked for the order to be
    // gone and it is gone. Returning 404 on the second attempt would make a
    // successful retry look like a failure.
    return Results.NoContent();
});

await app.StartAsync();
string baseUrl = app.Urls.First();

using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

Console.WriteLine("A small API, exercised end to end");
Console.WriteLine();
Console.WriteLine("   step                                   status   what it shows");
Console.WriteLine("   ----                                   ------   -------------");

// Validation: parsed, but unacceptable.
HttpResponseMessage r = await Post(http, new OrderRequest(-1), key: "K1");
Show("POST an order with a negative total", r, "422, not 400");

// Creation, then two retries of the same operation.
string operationKey = Guid.NewGuid().ToString();

r = await Post(http, new OrderRequest(2500), operationKey);
string location = r.Headers.Location!.ToString();
Show("POST a valid order", r, $"201 + Location {location}");

r = await Post(http, new OrderRequest(2500), operationKey);
Show("POST the SAME operation again", r, "201 replayed, not a second order");

r = await Post(http, new OrderRequest(2500), key: null);
Show("POST with no Idempotency-Key", r, "400, the header is required");

// Reads, conditional and unconditional.
r = await http.GetAsync(location);
string etag = r.Headers.ETag!.ToString();
Show("GET the order", r, $"200, ETag {etag}");

r = await Conditional(http, location, etag);
Show("GET again with If-None-Match", r, "304, no body sent");

// A state change bumps the version, so the validator stops matching.
r = await http.PutAsJsonAsync($"{location}/status", new StatusRequest("shipped"));
Show("PUT the status to shipped", r, "204, no body needed");

r = await Conditional(http, location, etag);
Show("GET with the STALE validator", r, "200, the ETag changed");

// Idempotence of PUT and DELETE, demonstrated rather than asserted.
await http.PutAsJsonAsync($"{location}/status", new StatusRequest("delivered"));
await http.PutAsJsonAsync($"{location}/status", new StatusRequest("delivered"));
r = await http.PutAsJsonAsync($"{location}/status", new StatusRequest("delivered"));
Show("PUT the same status 3 times", r, "204 each time, one final state");

r = await http.DeleteAsync(location);
Show("DELETE the order", r, "204");

r = await http.DeleteAsync(location);
Show("DELETE it again", r, "204, a retry is not an error");

r = await http.GetAsync(location);
Show("GET it now", r, "404");

Console.WriteLine();
Console.WriteLine($"   orders in the store at the end: {orders.Count}");
Console.WriteLine();
Console.WriteLine("   Every one of those decisions is visible to a client that has never");
Console.WriteLine("   read your code. That is the point of the protocol: the status line and");
Console.WriteLine("   the headers tell a proxy, a cache, a retry policy and a dashboard what");
Console.WriteLine("   happened, without any of them knowing what an order is.");
Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - reads on GET, so they can be cached, retried and prefetched safely");
Console.WriteLine("     - writes on POST, PUT or DELETE, chosen by whether repeating is safe");
Console.WriteLine("     - 201 with Location whenever something is created");
Console.WriteLine("     - 422 for bad values, 400 for a malformed request, 409 for state");
Console.WriteLine("     - failures on the STATUS LINE, never a 200 with an error inside");
Console.WriteLine("     - an ETag on anything worth re-reading");
Console.WriteLine("     - Cache-Control: private on anything belonging to one caller");
Console.WriteLine("     - an idempotency key reserved BEFORE the work, not after");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task&lt;HttpResponseMessage&gt; Post(HttpClient http, OrderRequest body, string? key)
{
    using var request = new HttpRequestMessage(HttpMethod.Post, "/orders")
    {
        Content = JsonContent.Create(body)
    };

    if (key is not null)
    {
        request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
    }

    return await http.SendAsync(request);
}

static async Task&lt;HttpResponseMessage&gt; Conditional(HttpClient http, string path, string etag)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    request.Headers.TryAddWithoutValidation("If-None-Match", etag);
    return await http.SendAsync(request);
}

static void Show(string step, HttpResponseMessage response, string note)
{
    Console.WriteLine($"   {step,-36}   {(int)response.StatusCode,6}   {note}");
}

// ---------------------------------------------------------------------------
record OrderRequest(long TotalMinor);

record StatusRequest(string Status);

record Order(string Id, long TotalMinor, string Status, int Version);</code></pre>

  <pre data-lang="console" data-title="08-minimal-example.cs output"><code>   step                                   status   what it shows
   ----                                   ------   -------------
   POST an order with a negative total       422   422, not 400
   POST a valid order                        201   201 + Location /orders/ORD-0001
   POST the SAME operation again             201   201 replayed, not a second order
   POST with no Idempotency-Key              400   400, the header is required
   GET the order                             200   200, ETag "1"
   GET again with If-None-Match              304   304, no body sent
   PUT the status to shipped                 204   204, no body needed
   GET with the STALE validator              200   200, the ETag changed
   PUT the same status 3 times               204   204 each time, one final state
   DELETE the order                          204   204
   DELETE it again                           204   204, a retry is not an error
   GET it now                                404   404

   orders in the store at the end: 0</code></pre>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger takes 400 payments per hour at an average of £1,234. The gateway had a bad afternoon:
    p99 latency went from 180 ms to 2.4 seconds for roughly forty minutes. Checkout's timeout was two
    seconds with three attempts.</p>
    <p>Roughly 270 payments were attempted in that window, and about 60% of them exceeded the timeout
    at least once. With the version-1 endpoint that is <strong>around 160 duplicate charges worth
    approximately £197,000</strong>, every one of which has to be refunded by hand, explained to a
    customer, and reconciled against the gateway's own records. Card-scheme chargeback fees apply to
    the ones customers dispute before you find them.</p>
    <p>The version-3 endpoint produces zero duplicates in the same window. The difference is one
    header and the placement of one <code>TryAdd</code> — and it must be there <em>before</em> the
    incident, because there is no way to un-charge 160 people retroactively.</p>
    <p>The second-order cost is worse than the refunds. A payments service that double-charges under
    load loses the thing it is selling, and the fix ships in a week while the reputation takes a
    year.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>A state change behind GET</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>app.MapGet("/payments/{id}/cancel", (string id) =&gt;
{
    payments[id] = payments[id] with { Status = "cancelled" };
    return Results.Ok();
});</code></pre>

  <p>Symptom: payments cancel themselves. Cause: a crawler, a prefetch, a link checker or a monitoring
  probe. Fix: <code>MapPost</code>.</p>

  <h3>Retrying a POST that was not designed for it</h3>

  <p>Symptom: duplicate records under load, and only under load. Cause: a timeout shorter than the
  server's own work, plus a retry policy that treats all methods alike. Fix: an idempotency key
  reserved before the work — or, at minimum, a retry policy that excludes <code>POST</code> and
  <code>PATCH</code>.</p>

  <h3>Errors reported as 200</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>return Results.Ok(new { success = false, error = "payment declined" });</code></pre>

  <p>Symptom: the dashboard reads a 0% error rate during an outage; retries never fire; the circuit
  breaker never opens. Fix: put the outcome on the status line.</p>

  <h3>A per-user response cached publicly</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>response.Headers.CacheControl = "public, max-age=3600";
return Results.Ok(await db.OrdersFor(currentUserId));</code></pre>

  <p>Symptom: users see each other's data, intermittently, and it never reproduces in staging because
  staging has no CDN. Fix: <code>private, no-store</code> plus <code>Vary: Authorization</code>.</p>

  <h3>Setting a header after the response has started</h3>

  <p>Symptom: <code>The response has already started</code> in the logs, and clients receiving
  truncated bodies with a 200. Cause: an exception thrown while streaming. Fix: do work that can fail
  before writing anything.</p>

  <h3>Reading a repeated header with [0]</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>string tenant = request.Headers["X-Tenant"][0]!;</code></pre>

  <p>Symptom: a request is attributed to the wrong tenant, or an IP allow-list is bypassed. Cause: a
  client sending the header twice while your proxy reads the other occurrence. Fix: decide which one
  you trust, and reject requests carrying more than one.</p>

  <h3>404 where 405 belongs</h3>

  <p>Symptom: a client is told a resource does not exist when the path is right and the method is
  wrong. Cause: hand-written routing that matches on path and method together. ASP.NET Core gets this
  right for you and includes the required <code>Allow</code> header:</p>

  <pre data-lang="console" data-title="01-on-the-wire.cs"><code>   no Host header      -&gt; HTTP/1.1 400 Bad Request
   DELETE /hello       -&gt; HTTP/1.1 405 Method Not Allowed
   GET /nothing-here   -&gt; HTTP/1.1 404 Not Found

     Allow: GET</code></pre>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>Every problem in this module is visible on the wire, which means the first move is always the
    same: <strong>look at the actual request and response, headers included</strong>, rather than at
    your handler.</p>
  </div>

  <h3>The tools, and what each is for</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Tool</th><th>Shows</th><th>Reach for it when</th></tr></thead>
      <tbody>
        <tr><td><code>curl -v</code></td><td>Request and response headers, and the negotiated version</td><td>First, every time</td></tr>
        <tr><td><code>curl -i</code></td><td>Response headers plus body</td><td>You want the body too</td></tr>
        <tr><td>Browser devtools, Network tab</td><td>Everything, including which requests were served from cache</td><td>The problem involves a browser or a CDN</td></tr>
        <tr><td>A raw <code>TcpClient</code></td><td>The literal bytes, framing included</td><td>You suspect the framing itself, or a client library is lying to you</td></tr>
        <tr><td>Server access logs</td><td>Method, path, status, and how many times it arrived</td><td>Deciding whether the client retried</td></tr>
      </tbody>
    </table>
  </div>

  <h3>Symptom to cause</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Look at</th><th>What you are looking for</th></tr></thead>
      <tbody>
        <tr>
          <td>Duplicate records, only under load</td>
          <td>Access logs for the affected resource</td>
          <td>The same operation arriving 2–3 times within one timeout window. If it is there, the client retried and the endpoint was not designed for it.</td>
        </tr>
        <tr>
          <td>Client reports failure, server reports success</td>
          <td>Server-side duration versus the client's timeout</td>
          <td>Duration greater than the timeout. The work completed and the answer arrived too late — which is the duplicate-charge shape.</td>
        </tr>
        <tr>
          <td>Users seeing each other's data</td>
          <td><code>Cache-Control</code> and <code>Vary</code> on the response</td>
          <td><code>public</code> without <code>private</code>, or a missing <code>Vary: Authorization</code>. Check the CDN's own cache-key configuration too.</td>
        </tr>
        <tr>
          <td>Error rate flat during a known outage</td>
          <td>The status codes being returned</td>
          <td>2xx carrying failures in the body. Grep for <code>Results.Ok</code> near an error path.</td>
        </tr>
        <tr>
          <td>Client gets the wrong format</td>
          <td>Sent <code>Accept</code> versus returned <code>Content-Type</code></td>
          <td>The server ignoring <code>q</code> values, or a cache without <code>Vary: Accept</code></td>
        </tr>
        <tr>
          <td>Truncated responses with a 200</td>
          <td>Logs for <code>The response has already started</code></td>
          <td>An exception thrown mid-stream. The status was committed before the failure.</td>
        </tr>
        <tr>
          <td>Client hangs waiting for a response</td>
          <td>The raw bytes</td>
          <td>Missing <code>Content-Length</code> and no chunked framing, or a request whose headers were never terminated by a blank line</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h3>Reading curl output</h3>

  <pre data-lang="bash" data-title="Reproducing it with curl"><code>curl -v -X POST https://api.ledger.example/v3/payments \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 6f1c2a90-3f21-4c1a-9a1b-2d7f9c0e5b44" \\
  -d '{"amountMinor":123450}'</code></pre>

  <pre data-lang="console" data-title="curl -v output"><code>&gt; POST /v3/payments HTTP/1.1
&gt; Host: api.ledger.example
&gt; Idempotency-Key: 6f1c2a90-3f21-4c1a-9a1b-2d7f9c0e5b44
&gt;
&lt; HTTP/1.1 201 Created
&lt; Location: /v3/payments/CHG-0001
&lt; Content-Type: application/json</code></pre>

  <p>Lines starting <code>&gt;</code> were sent, lines starting <code>&lt;</code> were received. Run
  the same command twice: <strong>the second run should return the same
  <code>Location</code></strong>. If it returns a different one, the endpoint is not idempotent
  whatever its documentation says — and that single check is the fastest test there is for the bug in
  this module.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"HTTP is a transport detail. The real work is in the business logic."</em></p>
    <p>The business logic in the opening incident was correct in all three versions. The difference
    between 3 charges and 1 was entirely in the protocol decisions. HTTP is the contract that
    everything between you and your caller acts on, and none of those things can read your business
    logic.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Idempotent means the response is the same every time."</em></p>
    <p>It means the resulting <em>state</em> is the same. A repeated <code>PUT</code> returns 201 then
    204; a repeated <code>DELETE</code> may return 204 then 404. Measured above. Code that treats a
    successful retry as a failure because the code changed is the usual result of this belief.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Adding an Idempotency-Key header makes the endpoint safe to retry."</em></p>
    <p>Version 2 has the header, reads it, stores it, and replays results — and still charged twice.
    The header is a mechanism, not a fix. What makes it work is reserving the key <em>atomically,
    before</em> the work, and generating it once per operation rather than once per attempt.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"no-cache means do not cache."</em></p>
    <p><code>no-cache</code> permits storage and requires revalidation before use.
    <code>no-store</code> is the one that forbids storage. The names are the whole problem.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Returning 200 with an error object is friendlier to clients — they only have to parse one
    shape."</em></p>
    <p>It is friendlier to the one client you are thinking about and hostile to every other consumer of
    the response: retry policies, circuit breakers, dashboards, proxies and caches all read the status
    line and none of them read your envelope. You can have both — a correct status code <em>and</em> a
    structured error body. <code>application/problem+json</code>, defined by RFC 9457, is the
    standard shape for exactly this.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"HTTP/2 makes everything faster, so switching is a free win."</em></p>
    <p>It removes head-of-line blocking at the HTTP layer, which helps when many requests share a
    connection — measured above at roughly 320 ms down to 115 ms for six concurrent calls on one machine. It does nothing for a
    single request, and it makes packet loss <em>worse</em> for multiplexed streams, because they all
    share one TCP connection. It also changes operational behaviour: connection limits, load-balancer
    configuration and proxy support all differ.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"REST means putting the operation in the URL — /api/createOrder, /api/getUser."</em></p>
    <p>The method already says what is happening. <code>POST /api/orders</code> and
    <code>GET /api/users/42</code> carry the same information with fewer words, and — more usefully —
    they let every intermediary know that one is a creation and the other is safely cacheable.
    Verbs-in-paths is the least harmful item on any API review list, and the one most often argued
    about, which is worth noticing about yourself.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <p>Everything in this module is a decision that costs nothing to get right at design time and cannot
  be retrofitted cheaply.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Decision</th><th>Cost to make correctly</th><th>Cost of getting it wrong</th></tr></thead>
      <tbody>
        <tr><td>Cancel behind <code>POST</code>, not <code>GET</code></td><td>One word</td><td>A crawler cancels every payment it can find a link to</td></tr>
        <tr><td>Idempotency key reserved before the work</td><td>One header, one <code>TryAdd</code></td><td>~160 duplicate charges worth ~£197,000 in one bad gateway afternoon</td></tr>
        <tr><td>Failures on the status line</td><td>Nothing</td><td>An outage invisible to every dashboard, retry policy and circuit breaker you own</td></tr>
        <tr><td><code>private</code> on per-user responses</td><td>One header</td><td>A shared cache serving one customer's data to another for an hour</td></tr>
        <tr><td>201 with <code>Location</code></td><td>Nothing</td><td>A client that timed out has no way to check whether its request succeeded</td></tr>
        <tr><td><code>ETag</code> on a polled resource</td><td>A version column you already have</td><td>Full bodies on every poll, forever</td></tr>
      </tbody>
    </table>
  </div>

  <p>Concretely, on the last row: a status page polling one 40 KB resource every second, from 2,000
  clients, is 80 MB per second of body — about 6.9 TB a day. With a conditional <code>GET</code> and a
  99% unchanged rate that becomes roughly 70 TB a month of traffic you no longer pay for or serve, for
  the price of returning a version number you already store.</p>

  <p>And the point underneath all of them: <strong>you are never the only program handling your
  responses.</strong> Between your handler and your caller sit a Kestrel, probably a reverse proxy,
  possibly a CDN, a service mesh, a retry policy, a circuit breaker, and a metrics pipeline. Not one of
  them can read your code. All of them read the method, the status code and the headers, and all of
  them will act on what they find there.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>A proxy sits in front of Ledger and retries any request that times out. Which of these can it
    retry automatically, and why?</p>
    <pre data-lang="text" data-title="Three requests"><code>POST   /orders
PUT    /orders/ORD-0001
DELETE /orders/ORD-0001</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Only the <code>PUT</code> and the <code>DELETE</code>.</strong> Three attempts at
        each, measured:</p>
        <pre data-lang="console" data-title="07-exercises.cs"><code>   request                     3 attempts leave   safe to retry?
   -------                     ----------------   --------------
   POST /orders                         3 orders   NO
   PUT /orders/ORD-0001                 1 orders   yes
   DELETE /orders/ORD-0001              0 orders   yes</code></pre>
        <p><code>POST</code> is the only one that accumulates, because the <em>server</em> chooses the
        identity of what it creates. <code>PUT</code> and <code>DELETE</code> name the resource in the
        request line, so a repeat lands on the same one.</p>
        <p>Note that this is a property of the <em>method contract</em>, not of your implementation. A
        retry layer, a proxy and a service mesh all rely on it without asking you first.</p>
        <p>It is possible to write a <code>PUT</code> that is not idempotent — one that appends rather
        than replaces, say. That is a bug, because everything upstream is entitled to assume
        otherwise.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>What is wrong with this endpoint, and would requiring authentication fix it?</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>app.MapGet("/orders/{id}/refund", (string id) =&gt;
{
    RefundOrder(id);
    return Results.Ok(new { refunded = id });
});</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>It performs a state change on a safe method, and authentication does not fix
        it.</strong></p>
        <pre data-lang="console" data-title="07-exercises.cs"><code>   refunds triggered by two GETs: 2</code></pre>
        <p><code>GET</code> is safe <em>by contract</em> — it must not change state — and everything
        downstream acts on that promise without asking:</p>
        <ul>
          <li>A browser prefetches links it predicts you might click.</li>
          <li>A crawler follows every <code>GET</code> it can find.</li>
          <li>A proxy or CDN may cache and replay it.</li>
          <li>A retry policy repeats it without asking, because <code>GET</code> is safe.</li>
          <li>A link checker in your own documentation will fire it.</li>
          <li>A monitoring probe hitting it every thirty seconds refunds forever.</li>
        </ul>
        <p>None of those is an attacker. Authentication limits <em>who</em> can do it; it does nothing
        about a logged-in user's own browser prefetching the link, their own corporate proxy caching
        the response, or their own client library retrying it.</p>
        <p><strong>The fix is the method:</strong> <code>POST /orders/{id}/refund</code>, or
        <code>DELETE</code>. A refund is also a good candidate for an idempotency key, for the reasons
        in exercise 5.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>Validation is failing constantly in production and the error-rate dashboard reads 0%. The
    endpoint:</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>app.MapPost("/orders/validate", (OrderRequest r) =&gt;
    r.Total &lt;= 0
        ? Results.Ok(new { success = false, error = "total must be positive" })
        : Results.Ok(new { success = true }));</code></pre>
    <p>Why is the dashboard wrong, what else is broken, and what status code belongs here?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="07-exercises.cs"><code>   POST with an invalid total
     status              : 200
     IsSuccessStatusCode : True
     body                : {"success":false,"error":"total must be positive"}

     EnsureSuccessStatusCode threw : False</code></pre>
        <p>The request failed and every layer believes it succeeded:</p>
        <ul>
          <li><code>EnsureSuccessStatusCode</code> does not throw.</li>
          <li>A retry policy sees success and does not retry.</li>
          <li>A circuit breaker never opens, however often it fails.</li>
          <li>The error-rate dashboard reads 0%.</li>
          <li>A proxy may cache the failure and serve it to others.</li>
        </ul>
        <p><strong>The correct status is 422 Unprocessable Content</strong>: the JSON parsed and the
        <em>value</em> is unacceptable. 400 is defensible; anything in the 2xx range is not.</p>
        <p>The general rule this is an instance of: <strong>the status line carries the outcome,
        because it is the one part every layer already understands. The body carries the detail</strong>,
        for the human or the client that wants it. You do not have to choose between them — return 422
        <em>and</em> a structured error body, ideally <code>application/problem+json</code>.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>A dashboard polls <code>GET /orders/ORD-0001</code> once a second. The order changes a few times
    a day. Reduce the traffic without changing the polling interval, and state precisely what your
    change does and does not save.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Add an <code>ETag</code> and honour <code>If-None-Match</code>.</strong> Measured
        across a change to the resource:</p>
        <pre data-lang="console" data-title="07-exercises.cs"><code>   first request, no validator        : 200, 48 body bytes
   second, validator matches          : 304, 0 body bytes
   third, after the order changed     : 200, 49 body bytes</code></pre>
        <pre data-lang="csharp" data-net="10" data-title="07-exercises.cs"><code>app.MapGet("/orders/{id}/etag", (string id, HttpRequest request, HttpResponse response) =&gt;
{
    if (!orders.TryGetValue(id, out Order? order))
    {
        return Results.NotFound();
    }

    string tag = $"\\"{order.Status}-{order.Total}\\"";
    response.Headers.ETag = tag;

    return request.Headers.IfNoneMatch.ToString() == tag
        ? Results.StatusCode(304)
        : Results.Ok(order);
});</code></pre>
        <p><strong>What it saves is the body.</strong> The request still happened: a round trip, a
        connection, and whatever work the server did to compute the ETag. So it is worth a great deal
        for a large payload and almost nothing for a small one — and it is only a saving if the ETag is
        cheaper than the body. Hashing a body you have already generated saves bandwidth and no server
        work at all.</p>
        <p>A cheap ETag comes from something you already have: a version column, a last-modified
        timestamp, a row version. The one above is built from the status and total without serialising
        anything.</p>
        <p>And for a poller specifically, the better answer may be not to poll. Conditional
        <code>GET</code> makes polling cheaper; it does not make it a good design. Server-sent events
        or a WebSocket removes the round trips entirely.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Design <code>POST /orders</code> so that a client with a retry policy can send the same order
    three times and create one order. Name every part of the design and say what each is there for —
    including what happens when two attempts arrive at the same instant.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <ol>
          <li><strong>The client supplies a key</strong>, in an <code>Idempotency-Key</code> header. It
          must identify the <em>operation</em>, so it is generated once by whoever decided to place the
          order — not inside the retry loop. Generating it per attempt is the most common way this is
          got wrong, and it reproduces the original bug while looking right.</li>
          <li><strong>The server reserves the key before doing the work, atomically.</strong> This is
          the part that is usually missing. Recording the key <em>after</em> the work still produced 2
          charges from 3 attempts, because two attempts were in flight before either had written
          anything.</li>
          <li><strong>A loser either replays or gets 409</strong>, depending on whether the winner has
          finished. Returning success before the work completes would be a lie; waiting holds a
          connection open.</li>
          <li><strong>Keys expire.</strong> They are state, and unbounded state is a leak. Long enough
          to outlive any retry a client will make — 24 hours is a common answer.</li>
          <li><strong>A different body with the same key is a client bug.</strong> Store a hash of the
          request alongside the key and return 422 on a mismatch, rather than replaying a result for a
          different request.</li>
        </ol>
        <p>Point 2 is the whole exercise. Five simultaneous attempts with one key:</p>
        <pre data-lang="console" data-title="07-exercises.cs"><code>   5 simultaneous attempts with one key:
     orders created : 1
     rejected       : 4</code></pre>
        <pre data-lang="csharp" data-net="10" data-title="07-exercises.cs"><code>if (reservations.TryAdd(key, null))
{
    await Task.Delay(30);          // the slow work
    Interlocked.Increment(ref created);
    reservations[key] = "ORD-0001";
}
else
{
    Interlocked.Increment(ref conflicts);
}</code></pre>
        <p>Exactly one winner, even with all five arriving at once. <code>TryAdd</code> is a single
        atomic operation, so there is no window between the check and the write for a second caller to
        slip through.</p>
        <p>In a real service that is a <strong>unique constraint on an insert</strong>, and the
        reservation and the order belong in one transaction. A dictionary in memory loses every key
        when the process restarts, which is exactly when a client is most likely to retry.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Review this API. List every problem, most severe first, and rewrite it.</p>
    <pre data-lang="text" data-bad="true" data-title="The API under review"><code>GET  /api/deleteUser?id=42        -&gt; 200 {"ok":true}
POST /api/getUser                 -&gt; 200 {"user":{...}}
POST /api/createOrder             -&gt; 200 {"orderId":"ORD-1"}
GET  /api/orders                  -&gt; 200, Cache-Control: public, max-age=3600</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>Six problems. The order matters as much as the list — the first two are incidents, the last
        is a preference.</p>
        <ol>
          <li><strong><code>GET /api/deleteUser</code> deletes on a safe method.</strong> A crawler, a
          prefetch, a link checker or a monitoring probe deletes users. Measured in exercise 2: two
          <code>GET</code>s, two refunds. Fix: <code>DELETE /api/users/42</code>.</li>
          <li><strong><code>GET /api/orders</code> is cached publicly for an hour.</strong> A per-user
          list marked <code>public</code> means a shared cache serves one user's orders to the next
          person who asks for that URL. This is a data breach caused by one header. Fix:
          <code>Cache-Control: private, no-store</code> and <code>Vary: Authorization</code>.</li>
          <li><strong>Everything returns 200.</strong> Failures are invisible to retry policies,
          circuit breakers and dashboards. Measured in exercise 3. Fix: use the status line.</li>
          <li><strong><code>POST /api/getUser</code> is a read behind an unsafe method.</strong> Not
          dangerous, but it gives up caching, conditional requests and safe retries for nothing. Fix:
          <code>GET /api/users/42</code>.</li>
          <li><strong><code>POST /api/createOrder</code> returns 200 with no <code>Location</code>.</strong>
          A creation should be 201 with <code>Location</code>, so a client that timed out has an
          identity to check before retrying.</li>
          <li><strong>The verbs are in the paths.</strong> The method already says what is happening, so
          the path should name the resource. This is the least important item on the list and the one
          most often argued about, which is worth noticing.</li>
        </ol>
        <p>The rewrite:</p>
        <pre data-lang="text" data-title="The rewrite"><code>DELETE /api/users/42              -&gt; 204
GET    /api/users/42              -&gt; 200, ETag, Cache-Control: private
POST   /api/orders                -&gt; 201, Location, Idempotency-Key required
GET    /api/orders                -&gt; 200, private, no-store, Vary: Authorization</code></pre>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What are the three parts of an HTTP request, and what separates the headers from the
    body?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A request line (method, target, version), then headers one per
        line, then an optional body. A blank line — a bare <code>\\r\\n</code> — ends the headers and
        begins the body.</p></div></details></li>

    <li><p>What is the difference between <em>safe</em> and <em>idempotent</em>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Safe means the request changes no state at all. Idempotent means
        N calls leave the same state as one call — it may still change state, but not cumulatively.
        Every safe method is idempotent; <code>PUT</code> and <code>DELETE</code> are idempotent
        without being safe.</p></div></details></li>

    <li><p>Which two common methods are <em>not</em> idempotent?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>POST</code> and <code>PATCH</code>. That is the whole reason
        blind retries are dangerous.</p></div></details></li>

    <li><p>A request times out. What does that tell you about whether the server acted?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Nothing. The request may never have arrived, may have been
        processed with the response lost, or may still be running.</p></div></details></li>

    <li><p>What are the two ways HTTP tells a receiver where a body ends?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>Content-Length</code>, when the size is known up front, and
        <code>Transfer-Encoding: chunked</code>, when it is not. A third — ending on connection close —
        exists but makes a dropped connection indistinguishable from a complete
        response.</p></div></details></li>

    <li><p>When would you return 422 rather than 400?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>When the request parsed and the <em>values</em> are unacceptable —
        a negative amount, an unsupported currency. 400 is for a malformed request. Both mean "do not
        retry unchanged".</p></div></details></li>

    <li><p>Why is returning <code>200 {"success": false}</code> a problem?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Every layer between you and the caller reads the status line and
        not the body. Retry policies, circuit breakers, dashboards, proxies and caches all treat it as
        a success. The failure is visible only to code that parses the body and remembers to
        look.</p></div></details></li>

    <li><p>What is the difference between <code>no-cache</code> and <code>no-store</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>no-cache</code> permits storage and requires revalidation
        before use. <code>no-store</code> forbids storage entirely.</p></div></details></li>

    <li><p>What does an <code>ETag</code> plus <code>If-None-Match</code> actually save?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The response body. The round trip, the connection and the work of
        computing the ETag all still happen. Worth a lot for large payloads, close to nothing for small
        ones.</p></div></details></li>

    <li><p>An endpoint accepts an <code>Idempotency-Key</code> header, looks it up, and stores it with
    the result once the work finishes. Two retries arrive during the work. What happens?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Both find no key and both do the work. Storing the key after the
        work leaves a check-then-act window exactly as wide as the work itself. Measured: 2 charges
        from 3 attempts. The key has to be reserved atomically <em>before</em> the work
        starts.</p></div></details></li>

    <li><p>What does HTTP/2 fix, and what does it not?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It fixes head-of-line blocking at the HTTP layer, by multiplexing
        many streams over one connection. It does not fix head-of-line blocking at the TCP layer — one
        lost packet still stalls every stream. That is what HTTP/3 addresses, over QUIC. The semantics
        — methods, status codes, headers — are unchanged in both.</p></div></details></li>
  </ol>
</section>
`
});
