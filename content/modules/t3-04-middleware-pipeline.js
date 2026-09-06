CSPREP.module({
  id: "t3-04-middleware-pipeline",
  minutes: 55,
  updated: "2026-09-03",
  summary: "Ledger adds a twenty-line response cache to a slow endpoint, p99 drops from 800 ms to single digits, and four days later one merchant receives another's payment totals. The cache is correct - its POSITION is not, and an anonymous caller with no credentials gets a real statement because a short-circuit above authentication removes authentication from the request. Also measured: MapWhen never rejoins the pipeline and says nothing about it, a convention-based middleware is constructed exactly once, and a header set after next() throws because the response has already started.",
  terms: ["middleware", "pipeline", "Use", "Run", "Map", "MapWhen", "UseWhen", "short-circuit",
    "terminal middleware", "RequestDelegate", "convention-based middleware", "IMiddleware",
    "PathBase", "HasStarted", "OnStarting", "OnCompleted", "response buffering", "branch"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p><code>GET /statement</code> is slow. It aggregates a month of payments and takes about 800 ms, and
  merchants poll it, so it sits at the top of the latency dashboard.</p>

  <p>Somebody adds a small in-memory response cache: key on the path, store the body, serve it for
  sixty seconds. p99 drops from 800 ms to single digits. Twenty lines, and it works.</p>

  <p>Four days later a merchant opens a support ticket containing another merchant's payment
  totals.</p>

  <p><strong>Nothing in the cache is wrong.</strong> It stores what it is given and returns it for the
  same key. Here are four arrangements of the identical caching code:</p>

  <pre data-lang="console" data-title="05-production.cs"><code>   arrangement                              the second caller saw       leak?
   -----------                              ---------------------       -----
   cache BEFORE auth, keyed on path         statement for merchant-a    YES
   cache AFTER auth, keyed on path          statement for merchant-a    YES
   cache AFTER auth, keyed on path + user   statement for merchant-b    no
   cache BEFORE auth, anonymous caller      statement for merchant-a    YES</code></pre>

  <p>Read the last row twice. A caller with <em>no credentials at all</em> received a real merchant's
  statement — and the authentication middleware never ran to object, because the cache answered first
  and stopped the request there.</p>

  <p>This module is about the structure those rows differ in: <strong>the pipeline</strong>. What runs,
  in what order, what each piece can see, and what it means to stop a request part-way through.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every ordering, status code and count in this module was produced by running the programs shown
    and pasted in unedited. The orderings are deterministic and are the point.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What a pipeline is</h2>

  <p class="define"><span class="define__term">Middleware</span> A piece of code that sits in the path
  of every request. It receives the request, may do something, and may pass it along to the next piece.
  Logging, authentication, compression and exception handling are all middleware.</p>

  <p class="define"><span class="define__term">Pipeline</span> The chain of middleware a request passes
  through on its way to your endpoint and back out again.</p>

  <p class="define"><span class="define__term">RequestDelegate</span> The type of "the rest of the
  pipeline": a function that takes an <code>HttpContext</code> and returns a <code>Task</code>. Every
  middleware is handed one, and calling it is what passes the request onward.</p>

  <p class="define"><span class="define__term">HttpContext</span> One object holding everything about
  one request and its response — the path, the headers, the body streams, the authenticated user, and a
  dictionary for anything you want to attach. It is created per request and passed to every middleware
  in turn.</p>

  <p class="define"><span class="define__term">HttpContext.Items</span> A dictionary on that context,
  scoped to the single request. It is where one middleware leaves something for a later one to find,
  and it is the correct home for per-request state — unlike a field on the middleware itself.</p>

  <p class="define"><span class="define__term">Endpoint</span> The thing that finally handles the
  request: a minimal-API lambda, or a controller action. It runs at the end of the pipeline, and it is
  reached through middleware rather than instead of it.</p>

  <p>The crucial property, and the one that explains everything else in this module:</p>

  <pre data-lang="console" data-title="00-smallest.cs"><code>what ran, in order:
   A: on the way in
   B: on the way in
   the endpoint
   B: on the way out
   A: on the way out</code></pre>

  <p><strong>The pipeline is nested, not sequential.</strong> A does not run and then finish; A calls B,
  which calls the endpoint, and then control unwinds back out through B to A. Each middleware
  <em>wraps</em> everything registered after it.</p>

  <pre class="diagram"><code>A ┌─────────────────────────────┐
  │ B ┌───────────────────────┐ │
  │   │  the endpoint         │ │
  │   └───────────────────────┘ │
  └─────────────────────────────┘

  in:   A → B → endpoint
  out:  endpoint → B → A</code></pre>

  <h3>An analogy, and where it stops working</h3>

  <p>A pipeline is like a series of security desks in a building lobby, each one wrapping the next. A
  visitor passes each desk on the way in and again on the way out. A desk can wave them through, send
  them back, or add a sticker to their badge — and it can only affect the desks <em>behind</em> it,
  never the ones it already walked past.</p>

  <p><strong>This is an analogy and it breaks in one specific way.</strong> A visitor leaving the
  building can be stopped and sent back. A response cannot: by the time it is passing back out through
  the middleware, the status line and headers may already be on the wire and unchangeable. That
  asymmetry — you can decide anything on the way in and almost nothing on the way out — is the subject
  of a whole section below.</p>
</section>

<section id="minimal-example">
  <h2>Minimal example</h2>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — The smallest pipeline that shows a request going in and
// coming back out.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web

var log = new List&lt;string&gt;();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// Each Use adds one link to a chain. The lambda receives the context and a
// delegate that runs everything registered AFTER it.
app.Use(async (context, next) =&gt;
{
    log.Add("A: on the way in");
    await next();                   // hand control to the rest of the pipeline
    log.Add("A: on the way out");
});

app.Use(async (context, next) =&gt;
{
    log.Add("B: on the way in");
    await next();
    log.Add("B: on the way out");
});

app.MapGet("/", () =&gt;
{
    log.Add("the endpoint");
    return "ok";
});

await app.StartAsync();

using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
string body = await http.GetStringAsync("/");

Console.WriteLine($"the response body: {body}");
Console.WriteLine();
Console.WriteLine("what ran, in order:");
foreach (string line in log)
{
    Console.WriteLine($"   {line}");
}

Console.WriteLine();
Console.WriteLine("A wraps B, and B wraps the endpoint. The first registered");
Console.WriteLine("middleware sees the request FIRST and the response LAST.");
Console.WriteLine();
Console.WriteLine("That is the whole model: the pipeline is nested, not sequential.");

await app.StopAsync();</code></pre>

  <p>Two middleware, one endpoint, and the log shows the nesting. <code>next</code> is not "go to the
  next line" — it is "run everything registered after me, and come back here when it is done".</p>
</section>

<section id="use-run-shortcircuit">
  <h2>Use, Run, and stopping a request</h2>

  <pre data-lang="console" data-title="01-order-and-shortcircuit.cs"><code>   response body : from Run

   what ran:
     Use A in
     Use B in
     Run (terminal)
     Use B out
     Use A out</code></pre>

  <p>A fourth middleware was registered after the <code>Run</code> and never appeared: 5 log lines for
  4 registered components. That is what <em>terminal</em> means:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th></th><th>Signature</th><th>Behaviour</th></tr></thead>
      <tbody>
        <tr><td><code>Use</code></td><td><code>(context, next)</code></td><td>May call <code>next</code>, or not</td></tr>
        <tr><td><code>Run</code></td><td><code>(context)</code></td><td>There is no <code>next</code>, so the pipeline ends here</td></tr>
      </tbody>
    </table>
  </div>

  <p><code>Run</code> is shorthand rather than a different mechanism — a <code>Use</code> that ignores
  its next delegate. The value is that it says so at the registration site. Anything registered after
  it is dead code, and <strong>nothing warns you</strong>.</p>

  <h3>Short-circuiting</h3>

  <pre data-lang="console" data-title="01-order-and-shortcircuit.cs"><code>   without the header : 401 api key required
   with the header    : 200 the data
   endpoint reached   : 1 of 2 requests

   what ran:
     outer in  (/data)
     gate: no key, short-circuiting
     outer out (/data) status 401
     outer in  (/data)
     gate: key present, continuing
     outer out (/data) status 200</code></pre>

  <p><strong>Not calling <code>next</code> is the mechanism.</strong> There is no special API for
  rejecting a request — you write the response and return. Authentication failures, rate limits, CORS
  preflight responses and caches all work exactly this way.</p>

  <p>Notice the <em>outer</em> middleware still ran its exit half on both requests. Short-circuiting
  stops everything registered <em>after</em> you; it does not unwind what is already on the stack.
  That is precisely what makes logging and exception handling work when an inner middleware rejects a
  request.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>Do not call <code>next</code> after writing a response.</strong> Deciding to reject and
    then continuing anyway means two pieces of code write to one response — the second either throws or
    corrupts the first.</p>
    <p>The shape to watch for is a middleware that writes an error body and then falls through to
    <code>await next()</code> instead of returning.</p>
  </div>
</section>

<section id="ordering">
  <h2>Ordering is behaviour</h2>

  <p>The same two components, in two orders. A middleware that throws, and an exception handler:</p>

  <pre data-lang="console" data-title="01-order-and-shortcircuit.cs"><code>   handler position       status   body
   ----------------       ------   ----
   BEFORE the thrower        500   handled: InvalidOperationException
   AFTER the thrower         500   (empty)</code></pre>

  <p>Same code, opposite outcomes — one arrangement returns a 27-byte explanation, the other returns 0
  bytes. In the second the handler is registered <em>inside</em> the thrower, so the exception passes it
  on the way out rather than going through it. Nothing catches it.</p>

  <p><strong>That is the shape of every ordering bug in a pipeline:</strong> the component runs, does
  its job correctly, and is in the wrong place to matter.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The first draft of that experiment used an <em>endpoint</em> that throws, moving the handler
    above and below the <code>MapGet</code> call. Both arrangements caught it, which looked like the
    rule failing.</p>
    <p>It is not. <strong><code>MapGet</code> does not insert anything into the pipeline at the point
    you call it.</strong> It registers a route in a table; the middleware that executes the matched
    endpoint is appended automatically at the very <em>end</em>, after everything you registered with
    <code>Use</code>.</p>
    <p>So the position of a <code>Map</code> call relative to your <code>Use</code> calls changes
    nothing — your middleware always wraps the endpoint. Only the order of the <code>Use</code> calls
    among themselves matters, and reading a startup file top to bottom does not tell you that.</p>
  </div>

  <p class="define"><span class="define__term">Routing</span> The step that matches the request path
  against a table of routes and decides which endpoint should run, attaching it to the context. Nothing
  before this point knows which endpoint will handle the request.</p>

  <p class="define"><span class="define__term">Authentication</span> Working out <em>who</em> the caller
  is, from a token or a cookie, and putting the answer on the context. It rejects nobody.</p>

  <p class="define"><span class="define__term">Authorisation</span> Deciding whether that caller is
  allowed to reach <em>this</em> endpoint. It needs both an identity and an endpoint, which is why its
  position is forced.</p>

  <p class="define"><span class="define__term">CORS preflight</span> A browser's <code>OPTIONS</code>
  request, sent before a cross-origin call, asking whether the real request is permitted. It carries no
  credentials, which is why it must not be handled by anything that rejects unauthenticated
  requests.</p>

  <h3>The standard order, and the reason for each position</h3>

  <p>Every rule below is the same rule — a middleware can only affect what it wraps — applied to a
  different pair.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>#</th><th>Middleware</th><th>Why there</th></tr></thead>
      <tbody>
        <tr><td>1</td><td><code>UseExceptionHandler</code></td><td>Outermost: it can only catch what it wraps</td></tr>
        <tr><td>2</td><td><code>UseForwardedHeaders</code></td><td>Before anything that reads the scheme or client address — which is everything below</td></tr>
        <tr><td>3</td><td><code>UseHsts</code>, <code>UseHttpsRedirection</code></td><td>Needs the real scheme from step 2, or it redirects forever behind a proxy</td></tr>
        <tr><td>4</td><td><code>UseStaticFiles</code></td><td>Short-circuits on a hit, so a file never pays for routing or auth. Only safe if the files are <em>public</em></td></tr>
        <tr><td>5</td><td><code>UseRouting</code></td><td>Selects the endpoint. Nothing above knows which endpoint will run</td></tr>
        <tr><td>6</td><td><code>UseCors</code></td><td>After routing to read per-endpoint policy; before auth because preflight carries no credentials</td></tr>
        <tr><td>7</td><td><code>UseAuthentication</code></td><td>Establishes <em>who</em>. Sets <code>context.User</code>; rejects nobody</td></tr>
        <tr><td>8</td><td><code>UseAuthorization</code></td><td>Decides whether that caller may reach <em>this</em> endpoint. Needs both 5 and 7</td></tr>
        <tr><td>9</td><td>Your own middleware</td><td></td></tr>
        <tr><td>10</td><td>The endpoint</td><td>Appended automatically, always last</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>Authentication and authorisation are two steps, and the split is not ceremony.</strong>
  Authentication answers "who is this"; authorisation answers "may they do this". The second needs the
  endpoint, so routing must sit between them.</p>

  <p>Putting <code>UseAuthorization</code> before <code>UseRouting</code> is the classic bug — there is
  no endpoint yet, so there is no <code>[Authorize]</code> metadata to enforce and every protected
  endpoint becomes public. <strong>ASP.NET Core now throws at startup rather than letting that
  ship</strong>, which makes it one of the few ordering mistakes the framework catches. Every other
  position in that table is enforced by nothing.</p>
</section>

<section id="writing">
  <h2>Writing a middleware</h2>

  <p>Three forms, all doing the same thing:</p>

  <pre data-lang="csharp" data-net="10" data-title="02-writing-middleware.cs"><code>// FORM 1: an inline lambda. No type, no registration.
app.Use(async (context, next) =&gt;
{
    context.Response.Headers["X-Form-1"] = "inline";
    await next();
});

// FORM 2: a convention-based class. Not an interface - the framework finds
// Invoke or InvokeAsync by reflection at startup.
app.UseMiddleware&lt;ConventionMiddleware&gt;();

// FORM 3: IMiddleware, resolved from the container per request.
app.UseMiddleware&lt;FactoryMiddleware&gt;();</code></pre>

  <p>The convention-based form is the one most code uses and the one most people cannot describe
  precisely. <strong>It is not an interface.</strong> The requirements are:</p>

  <ul>
    <li>The constructor takes <code>RequestDelegate</code> as its first argument.</li>
    <li>There is a method called <code>Invoke</code> or <code>InvokeAsync</code>.</li>
    <li>That method returns <code>Task</code> and takes <code>HttpContext</code> first.</li>
  </ul>

  <p>None of that is checked by the compiler. A wrong name or signature is an exception at
  <em>startup</em>, not a build error.</p>

  <p class="define"><span class="define__term">Singleton</span> One instance for the whole life of the
  application, shared by every request at once. The word matters here because the most common middleware
  form is one whether or not you meant it to be.</p>

  <h3>How many times each is constructed</h3>

  <pre data-lang="console" data-title="02-writing-middleware.cs"><code>   form                       constructed   for 5 requests
   ----                       -----------   --------------
   convention-based class               1   once, at startup
   IMiddleware (scoped)                 5   once per request</code></pre>

  <p><strong>The convention-based class is effectively a singleton.</strong> 1 construction against 5
  requests, and it would still be 1 against 5 million — it is built when the pipeline is built, and the
  same instance serves every request for the life of the application. Two consequences, both about
  state:</p>

  <ul>
    <li><strong>Any field you set is shared by every concurrent request.</strong> A field holding "the
    current user" or "the request id" is a race, not a variable. Per-request state belongs in locals
    inside <code>Invoke</code>, or on <code>HttpContext.Items</code>.</li>
    <li><strong>Anything injected into the constructor lives as long as the application</strong>,
    whatever lifetime it was registered with.</li>
  </ul>

  <h3>The dependency that will not inject</h3>

  <pre data-lang="console" data-title="02-writing-middleware.cs"><code>   scoped service in the CONSTRUCTOR : STARTUP FAILED - Cannot resolve scoped
                                       service 'RequestScoped' from root provider.
   scoped service in INVOKE          : started, and a request returned: scoped id 1</code></pre>

  <p>A scoped service in the constructor would be captured for the life of the application — one
  instance shared by every request, which is the opposite of what scoped promised. In a real service
  that scoped service is a <code>DbContext</code>, and <code>DbContext</code> is not thread-safe.</p>

  <p><strong>The fix is to take it as a parameter of <code>Invoke</code>:</strong></p>

  <pre data-lang="csharp" data-net="10" data-title="02-writing-middleware.cs"><code>public sealed class AuditMiddleware
{
    private readonly RequestDelegate _next;

    // The constructor is for things that live as long as the APPLICATION.
    public AuditMiddleware(RequestDelegate next) =&gt; _next = next;

    // Invoke runs per request, and its extra parameters are resolved from
    // that REQUEST'S scope.
    public async Task InvokeAsync(HttpContext context, LedgerDbContext db)
    {
        await _next(context);
    }
}</code></pre>

  <p>Two details finish the picture. <strong>It fails at startup</strong>, not on the first request,
  because that is when the middleware is constructed — one of the few pipeline mistakes that cannot
  reach production quietly. And <strong>it only fails for scoped services</strong>: a
  <em>transient</em> service in the constructor is accepted silently and then lives forever, which is
  the same bug with no error message.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Form</th><th>Use when</th></tr></thead>
      <tbody>
        <tr><td>Inline lambda</td><td>Short and used once. Past about ten lines it stops being readable in a startup file, and it cannot be unit-tested without starting a host</td></tr>
        <tr><td>Convention class</td><td>The default for anything reusable. Built once, so no per-request allocation and singletons resolved once</td></tr>
        <tr><td><code>IMiddleware</code></td><td>When you want the lifetime explicit and the signature checked by the compiler rather than by reflection at startup</td></tr>
      </tbody>
    </table>
  </div>

  <p>Whichever form, wrap the registration in an extension method. That is not decoration: it gives the
  middleware a name at the call site, so a startup file reads as a sequence of decisions rather than a
  list of type arguments — and ordering is the thing you will be reading that file to check.</p>
</section>

<section id="branching">
  <h2>Branching, and which branches come back</h2>

  <pre data-lang="console" data-title="03-branching.cs"><code>   path        branch used   what ran
   ----        -----------   --------
   /map/x      Map           before -&gt; Map branch
   /mapwhen    MapWhen       before -&gt; MapWhen branch
   /usewhen    UseWhen       before -&gt; UseWhen branch -&gt; after
   /plain      (none)        before -&gt; after</code></pre>

  <p><strong>The difference is the last column.</strong> <code>UseWhen</code>'s branch ran and then came
  back to the main pipeline. <code>Map</code> and <code>MapWhen</code> did not — their branches are
  terminal.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Construct</th><th>Matches</th><th>Rejoins?</th></tr></thead>
      <tbody>
        <tr><td><code>Map(path, branch)</code></td><td>A path prefix</td><td><strong>No</strong> — terminal</td></tr>
        <tr><td><code>MapWhen(predicate, branch)</code></td><td>Any predicate</td><td><strong>No</strong> — terminal</td></tr>
        <tr><td><code>UseWhen(predicate, branch)</code></td><td>Any predicate</td><td><strong>Yes</strong></td></tr>
      </tbody>
    </table>
  </div>

  <p>That single distinction decides which one you want, and it is not visible in the names. Use
  <code>UseWhen</code> when the branch <em>adds</em> something for some requests and the request should
  carry on. Use <code>Map</code> or <code>MapWhen</code> when the branch <em>is</em> the whole handling
  — a health endpoint, a metrics endpoint, a mounted sub-application.</p>

  <p>Choosing <code>MapWhen</code> where you meant <code>UseWhen</code> is a quiet failure: the branch
  works, and everything that was supposed to happen afterwards silently does not.</p>

  <h3>What Map does to the path</h3>

  <pre data-lang="console" data-title="03-branching.cs"><code>   GET /admin/users/42    through Map     -&gt; PathBase='/admin' Path='/users/42'
   GET /reports/monthly/7 through UseWhen -&gt; PathBase=''       Path='/reports/monthly/7'</code></pre>

  <p class="define"><span class="define__term">PathBase</span> The part of the path that has already
  been consumed — by a <code>Map</code> branch, or by the application being hosted under a sub-path.
  Everything inside sees <code>Path</code> as if it were at the root.</p>

  <p><strong><code>Map</code> strips the matched prefix and moves it to <code>PathBase</code>.</strong>
  That is what makes it useful for mounting a self-contained sub-application: the code inside does not
  need to know where it was mounted. It also confuses people in two directions — routes inside the
  branch must <em>not</em> repeat the prefix, and link generation uses <code>PathBase</code> so
  hand-built URLs lose it.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>A branch predicate runs on <strong>every</strong> request, so keep it cheap — a property check,
    not a database lookup.</p>
    <p>And it is evaluated <em>where it is registered</em>, so it can only see what earlier middleware
    has set. A <code>UseWhen</code> branching on <code>context.User</code> must come after
    <code>UseAuthentication</code>, or the user is always anonymous and the branch never fires. That is
    the ordering rule again, failing the same silent way.</p>
  </div>
</section>

<section id="response-lifecycle">
  <h2>What you can and cannot do on the way out</h2>

  <pre data-lang="console" data-title="04-response-lifecycle.cs"><code>   status                          : 200
   body                            : a body written by the endpoint
   Response.HasStarted after next  : True
   setting a header then           : InvalidOperationException: Headers are read-only,
                                     response has already started.
   X-Too-Late reached the client   : False</code></pre>

  <p><strong>The response had already started.</strong> Headers and the status line go on the wire
  before the body, so once the endpoint wrote anything they are gone — and the assignment throws.</p>

  <p>This is the mistake that looks most reasonable in review. "Add a header after the response is
  produced" is a sentence that makes sense and describes something impossible.</p>

  <p class="define"><span class="define__term">HasStarted</span> The status line and headers have been
  sent. Nothing about them can change after this. (<code>Completed</code> is later still — the whole
  response has been written.)</p>

  <h3>OnStarting: the last moment before the headers go</h3>

  <pre data-lang="csharp" data-net="10" data-title="04-response-lifecycle.cs"><code>app.Use(async (context, next) =&gt;
{
    var sw = Stopwatch.StartNew();

    // Registered on the way IN, runs at the last moment before the status
    // line and headers are written.
    context.Response.OnStarting(() =&gt;
    {
        context.Response.Headers["X-Elapsed-Ms"] = sw.ElapsedMilliseconds.ToString();
        context.Response.Headers["X-Status-Seen"] = context.Response.StatusCode.ToString();
        return Task.CompletedTask;
    });

    await next();
});</code></pre>

  <pre data-lang="console" data-title="04-response-lifecycle.cs"><code>   path       status   X-Elapsed-Ms   X-Status-Seen
   ----       ------   ------------   -------------
   /ok           200              1             200
   /missing      404              1             404</code></pre>

  <p>The callback saw the <em>final</em> status code — 404 for the second — and was still able to add
  headers. It runs after the decision and before the wire. Three rules:</p>

  <ul>
    <li><strong>Register it on the way in</strong>, before calling <code>next</code>. Afterwards is too
    late for the same reason.</li>
    <li><strong>It may never run.</strong> If nothing is ever written — a client disconnects, the
    request is aborted — there are no headers to send. Do not put cleanup there; <code>OnCompleted</code>
    is for that.</li>
    <li><strong>Keep it cheap and non-throwing.</strong> It runs on the hot path of every response, at a
    point where the response can no longer become a 500.</li>
  </ul>

  <p class="define"><span class="define__term">Response body stream</span> The stream your response is
  written to. It can be replaced, which is how buffering middleware works — and replacing something on
  the context means you own putting it back.</p>

  <h3>An exception after the response started</h3>

  <pre data-lang="console" data-title="04-response-lifecycle.cs"><code>   /early  status 500, body 'handled cleanly'
   /late   status 200, 4096 body bytes
           the client read a complete-looking body
           HasStarted when the handler caught it: True</code></pre>

  <p><strong>The second one cannot be turned into a 500.</strong> The status line went out saying 200
  before the exception existed. What the client gets depends on the framing: with a
  <code>Content-Length</code> it is a short read; with chunked encoding the terminating chunk never
  arrives, so a careful client sees a protocol error and a careless one sees a truncated body with a
  success status.</p>

  <p>That last case is the dangerous one. In the measurement above the client read 4,096 bytes and
  reported a complete response with status 200 — a client parsing JSON would get a syntax error and
  might retry, and a client reading a CSV would silently process half the rows and report success.</p>

  <p><strong>The fix is not in the exception handler.</strong> It is to do the work that can fail
  <em>before</em> writing anything — fetch and validate first, then write. For a genuinely streamed
  response, accept that a mid-stream failure is a truncated response and make the client able to detect
  it: a length prefix, a terminating record, a checksum.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>There is one more option, worth knowing precisely because it is usually the wrong answer:
    <strong>buffer the response</strong>. Replace <code>Response.Body</code> with a
    <code>MemoryStream</code>, let the endpoint write into it, inspect or rewrite it, then copy it to
    the real body.</p>
    <p>That makes all of the above go away, and it costs the whole response held in memory per
    concurrent request, no streaming at all, and a memory limit where an unbounded response used to be.
    Response caching and compression middleware do exactly this and are worth the cost because they buy
    something large. A middleware that buffers every response to add one header is paying that price for
    something <code>OnStarting</code> does for free.</p>
  </div>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>If you do replace <code>Response.Body</code>, <strong>restore it in a <code>finally</code></strong>.
    This was a real bug in the first draft of this module's example: the cache restored the body after
    <code>next()</code> returned, so when an endpoint threw, the restore was skipped, the exception
    handler wrote its 500 into the discarded buffer, and the client received <strong>status 500 with an
    empty body</strong>.</p>
    <p>Any middleware that replaces something on the context must put it back in a <code>finally</code>.
    The exception path is the one nobody tests.</p>
  </div>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>Back to the cache. Merchant A asks for its statement and populates the cache; then a second caller
  asks. Four arrangements of the identical caching code:</p>

  <pre data-lang="console" data-title="05-production.cs"><code>   arrangement                              the second caller saw       leak?
   -----------                              ---------------------       -----
   cache BEFORE auth, keyed on path         statement for merchant-a    YES
   cache AFTER auth, keyed on path          statement for merchant-a    YES
   cache AFTER auth, keyed on path + user   statement for merchant-b    no
   cache BEFORE auth, anonymous caller      statement for merchant-a    YES

   times the endpoint actually ran:
     cache before auth              : 1
     cache after auth, path key     : 1
     cache after auth, path+user key: 2</code></pre>

  <p><strong>Row 1 is the incident.</strong> The cache ran before authentication, so it had no idea who
  was asking — there was no user yet to key on.</p>

  <p><strong>Row 4 is the same arrangement with an anonymous caller, and it is worse.</strong> The
  request never reached authentication at all, because the cache short-circuited first. A caller with
  no credentials received a real merchant's statement.</p>

  <p>That is the part worth sitting with. <strong>A short-circuiting middleware before authentication
  does not merely get the answer wrong — it removes authentication from the request.</strong> Every
  check registered after it is skipped, silently, on exactly the requests it serves.</p>

  <p><strong>Row 2 fixes the ordering and is still wrong.</strong> Authentication runs first now, so an
  anonymous caller is rejected — but the cache key is the path, which is identical for every merchant.
  Position and key are two separate decisions, and fixing one does not fix the other.</p>

  <p><strong>Row 3 is correct</strong>, and the endpoint ran 2 times rather than 1. That is the honest
  cost: a per-user cache cannot be shared, so across 80 merchants the hit rate falls by roughly a factor
  of 80 and the endpoint runs 80 times a minute instead of once. That is what correctness costs
  here.</p>

  <h3>The whole contract in one file</h3>

  <pre data-lang="csharp" data-net="10" data-title="07-minimal-example.cs"><code>// 07-minimal-example.cs — One correctly ordered pipeline, with every position
// justified and every decision exercised.
//
// Run:  dotnet run 07-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code, header and ordering here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

var order = new ConcurrentQueue&lt;string&gt;();
var cache = new ConcurrentDictionary&lt;string, string&gt;();
int endpointCalls = 0;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// ===========================================================================
// 1. EXCEPTION HANDLING - outermost, because it can only catch what it wraps.
// ===========================================================================
app.Use(async (context, next) =&gt;
{
    order.Enqueue("1 exception handler");

    try
    {
        await next();
    }
    catch (Exception ex)
    {
        // HasStarted must be checked. If the endpoint already wrote a body,
        // the status line went out long ago and there is nothing to change.
        if (context.Response.HasStarted)
        {
            return;
        }

        context.Response.StatusCode = 500;
        await context.Response.WriteAsJsonAsync(new { error = ex.GetType().Name });
    }
});

// ===========================================================================
// 2. FORWARDED HEADERS - before anything that reads the scheme or address.
// ===========================================================================
var forwarded = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1
};

// Clear THEN add. Clearing alone leaves both sets empty, and an empty trusted
// set means trust EVERY sender.
forwarded.KnownProxies.Clear();
forwarded.KnownIPNetworks.Clear();
forwarded.KnownProxies.Add(IPAddress.Loopback);

app.UseForwardedHeaders(forwarded);

// ===========================================================================
// 3. TIMING - registered early so it measures everything below it. The header
//    is added with OnStarting, because by the time next() returns the
//    response has usually started and headers are read-only.
// ===========================================================================
app.Use(async (context, next) =&gt;
{
    order.Enqueue("3 timing");
    var sw = Stopwatch.StartNew();

    context.Response.OnStarting(() =&gt;
    {
        context.Response.Headers["X-Elapsed-Ms"] = sw.ElapsedMilliseconds.ToString();
        return Task.CompletedTask;
    });

    await next();
});

// ===========================================================================
// 4. AUTHENTICATION - establishes WHO. Rejects nobody by itself; in a real
//    application this is UseAuthentication and reads a token.
// ===========================================================================
app.Use(async (context, next) =&gt;
{
    order.Enqueue("4 authentication");
    context.Items["merchant"] = context.Request.Headers["X-Merchant"].FirstOrDefault();
    await next();
});

// ===========================================================================
// 5. AUTHORISATION - decides whether THIS caller may proceed. After
//    authentication, because it needs the identity.
// ===========================================================================
app.Use(async (context, next) =&gt;
{
    order.Enqueue("5 authorisation");

    if (context.Request.Path.StartsWithSegments("/health"))
    {
        await next();               // health is deliberately public
        return;
    }

    if (context.Items["merchant"] is not string merchant || merchant.Length == 0)
    {
        context.Response.StatusCode = 401;
        await context.Response.WriteAsJsonAsync(new { error = "authentication required" });
        return;                     // short-circuit
    }

    await next();
});

// ===========================================================================
// 6. RESPONSE CACHE - AFTER authorisation, because it short-circuits. Placing
//    it above would skip both checks for every cache hit. Keyed on identity as
//    well as path, or one merchant receives another's response.
// ===========================================================================
app.Use(async (context, next) =&gt;
{
    order.Enqueue("6 cache");

    if (context.Request.Method != "GET")
    {
        await next();
        return;
    }

    string key = $"{context.Request.Path}|{context.Items["merchant"]}";

    if (cache.TryGetValue(key, out string? hit))
    {
        context.Response.Headers["X-Cache"] = "HIT";
        await context.Response.WriteAsync(hit);
        return;
    }

    Stream original = context.Response.Body;
    using var buffer = new MemoryStream();
    context.Response.Body = buffer;

    string body;
    try
    {
        await next();
    }
    finally
    {
        // MUST be restored in a finally. Without it, an exception thrown below
        // leaves Response.Body pointing at this buffer, so an exception handler
        // higher up writes its 500 into a MemoryStream nobody reads and the
        // client receives an empty body.
        buffer.Position = 0;
        body = await new StreamReader(buffer).ReadToEndAsync();
        context.Response.Body = original;
    }

    if (context.Response.StatusCode == 200)
    {
        cache[key] = body;
    }

    context.Response.Headers["X-Cache"] = "MISS";
    await context.Response.WriteAsync(body);
});

// ===========================================================================
// 7. A BRANCH that adds something for some requests and rejoins. UseWhen, not
//    MapWhen - MapWhen is terminal and the endpoint would never be reached.
// ===========================================================================
app.UseWhen(
    context =&gt; context.Request.Headers.ContainsKey("X-Internal"),
    branch =&gt; branch.Use(async (context, next) =&gt;
    {
        order.Enqueue("7 internal branch");
        context.Response.OnStarting(() =&gt;
        {
            context.Response.Headers["X-Internal-Diagnostics"] = "on";
            return Task.CompletedTask;
        });

        await next();
    }));

// ===========================================================================
// The endpoints. Note these are reached LAST regardless of where the Map calls
// appear in this file - the endpoint middleware is appended automatically at
// the end of the pipeline.
// ===========================================================================
app.MapGet("/health", () =&gt; Results.Ok(new { status = "healthy" }));

app.MapGet("/statement", (HttpContext context) =&gt;
{
    order.Enqueue("8 endpoint");
    Interlocked.Increment(ref endpointCalls);
    return Results.Ok(new { statement = $"for {context.Items["merchant"]}" });
});

app.MapGet("/boom", void () =&gt; throw new InvalidOperationException("gateway unreachable"));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("A correctly ordered pipeline, exercised");
Console.WriteLine();
Console.WriteLine("   request                                  status   what it shows");
Console.WriteLine("   -------                                  ------   -------------");

order.Clear();
(int healthStatus, _, _) = await SendAsync(http, "/health", null);
Console.WriteLine($"   GET /health, no credentials                 {healthStatus,3}   public by design");

(int anonStatus, _, _) = await SendAsync(http, "/statement", null);
Console.WriteLine($"   GET /statement, no credentials              {anonStatus,3}   401, the cache did not hide it");

(int aStatus, string aBody, string aCache) = await SendAsync(http, "/statement", "merchant-a");
Console.WriteLine($"   GET /statement as merchant-a                {aStatus,3}   {aCache}, {aBody}");

(int a2Status, string a2Body, string a2Cache) = await SendAsync(http, "/statement", "merchant-a");
Console.WriteLine($"   GET /statement as merchant-a again          {a2Status,3}   {a2Cache}, {a2Body}");

(int bStatus, string bBody, string bCache) = await SendAsync(http, "/statement", "merchant-b");
Console.WriteLine($"   GET /statement as merchant-b                {bStatus,3}   {bCache}, {bBody}");

(int boomStatus, string boomBody, _) = await SendAsync(http, "/boom", "merchant-a");
Console.WriteLine($"   GET /boom as merchant-a                     {boomStatus,3}   {boomBody}");

Console.WriteLine();
Console.WriteLine($"   the endpoint ran {endpointCalls} times for 3 authenticated statement requests");
Console.WriteLine();

// One clean request, to print the pipeline order.
order.Clear();
await SendAsync(http, "/statement", "merchant-c", internalCaller: true);

Console.WriteLine("   the order for one internal, authenticated request:");
Console.WriteLine();
foreach (string step in order)
{
    Console.WriteLine($"     {step}");
}

Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - exception handling FIRST, and it checks HasStarted before writing");
Console.WriteLine("     - forwarded headers before anything reads the scheme or the address");
Console.WriteLine("     - response headers added with OnStarting, never after next()");
Console.WriteLine("     - authentication before authorisation, because one needs the other");
Console.WriteLine("     - anything that SHORT-CIRCUITS placed after both, or it removes them");
Console.WriteLine("     - the cache keyed on identity as well as path");
Console.WriteLine("     - UseWhen for a branch that must rejoin; MapWhen would end the request");
Console.WriteLine("     - no per-request state in middleware fields");
Console.WriteLine("     - Response.Body restored in a FINALLY by the buffering cache");
Console.WriteLine();
Console.WriteLine("   That last one was a real bug in the first draft of this file. The");
Console.WriteLine("   cache swapped Response.Body for a MemoryStream and restored it after");
Console.WriteLine("   next() returned - so when /boom threw, the restore was skipped, the");
Console.WriteLine("   exception handler wrote its 500 into the discarded buffer, and the");
Console.WriteLine("   client received status 500 with an EMPTY body.");
Console.WriteLine();
Console.WriteLine("   Any middleware that replaces something on the context must put it back");
Console.WriteLine("   in a finally. The exception path is the one nobody tests.");
Console.WriteLine();
Console.WriteLine("   The one ordering mistake the framework catches for you is");
Console.WriteLine("   UseAuthorization before UseRouting, which throws at startup. Every");
Console.WriteLine("   other position above is enforced by nothing but this file.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task&lt;(int Status, string Body, string Cache)&gt; SendAsync(HttpClient http,
    string path, string? merchant, bool internalCaller = false)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);

    if (merchant is not null)
    {
        request.Headers.TryAddWithoutValidation("X-Merchant", merchant);
    }

    if (internalCaller)
    {
        request.Headers.TryAddWithoutValidation("X-Internal", "1");
    }

    using HttpResponseMessage response = await http.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();
    string cache = response.Headers.TryGetValues("X-Cache", out var values)
        ? values.First()
        : "-";

    return ((int)response.StatusCode, body, cache);
}</code></pre>

  <pre data-lang="console" data-title="07-minimal-example.cs output"><code>   request                                  status   what it shows
   -------                                  ------   -------------
   GET /health, no credentials                 200   public by design
   GET /statement, no credentials              401   401, the cache did not hide it
   GET /statement as merchant-a                200   MISS, {"statement":"for merchant-a"}
   GET /statement as merchant-a again          200   HIT, {"statement":"for merchant-a"}
   GET /statement as merchant-b                200   MISS, {"statement":"for merchant-b"}
   GET /boom as merchant-a                     500   {"error":"InvalidOperationException"}

   the endpoint ran 2 times for 3 authenticated statement requests

   the order for one internal, authenticated request:

     1 exception handler
     3 timing
     4 authentication
     5 authorisation
     6 cache
     7 internal branch
     8 endpoint</code></pre>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger serves 80 merchants, and the statement endpoint is polled roughly once a minute each —
    about 4,800 requests an hour.</p>
    <p>With a 60-second cache and the broken key, every request in each minute after the first returns
    whichever merchant asked first. That is <strong>roughly 4,720 responses an hour delivered to the
    wrong merchant</strong>, each containing payment totals. It ran for four days before one merchant
    read carefully enough to notice — around 450,000 wrong responses.</p>
    <p>The latency dashboard looked excellent throughout, which is exactly why nobody was looking. p99
    went from 800 ms to single digits and stayed there; the change did what it was asked to do.</p>
    <p>The cost of catching it was one test, and it needs the real pipeline because the bug is entirely
    in the pipeline: <strong>request the same path as two different users and assert the second response
    does not contain the first user's data</strong>. Then repeat with no credentials and assert a 401 —
    that second assertion is the one that catches a short-circuit sitting above authentication, and it
    is three lines.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>A short-circuiting middleware above authentication</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>app.UseResponseCaching();     // short-circuits on a hit
app.UseAuthentication();
app.UseAuthorization();</code></pre>

  <p>Symptom: unauthenticated callers receive real data, intermittently — only when the cache is warm.
  Cause: a cache hit returns before authentication runs. Fix: put anything that can short-circuit
  <em>after</em> both checks, unless it is deliberately public.</p>

  <h3>Setting a header after next()</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>await next();
context.Response.Headers["X-Elapsed-Ms"] = sw.ElapsedMilliseconds.ToString();</code></pre>

  <p>Symptom: the header never appears, and an <code>InvalidOperationException</code> in the logs. Cause:
  the response has already started. Fix: <code>OnStarting</code>, registered before <code>next</code>.</p>

  <h3>MapWhen where UseWhen was meant</h3>

  <p>Symptom: the branch works and the endpoint is never reached — a 404 or an empty 200. Cause:
  <code>Map</code> and <code>MapWhen</code> are terminal. Fix: <code>UseWhen</code>.</p>

  <h3>A scoped service in a middleware constructor</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>public AuditMiddleware(RequestDelegate next, LedgerDbContext db)</code></pre>

  <p>Symptom: the application refuses to start. Cause: the middleware is built once, so the scoped
  service would be captured forever. Fix: take it on <code>Invoke</code> instead.</p>

  <h3>Per-request state in a middleware field</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>private string? _currentUser;   // shared by every concurrent request</code></pre>

  <p>Symptom: users occasionally see each other's data under load, and it never reproduces. Cause: a
  convention-based middleware is a singleton. Fix: locals inside <code>Invoke</code>, or
  <code>HttpContext.Items</code>.</p>

  <h3>Middleware registered after a terminal one</h3>

  <p>Symptom: a middleware never runs and there is no error. Cause: it sits after a <code>Run</code>, or
  inside a <code>Map</code> branch that ends the request. Fix: check where the terminal step is.</p>

  <h3>Replacing Response.Body without a finally</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>context.Response.Body = buffer;
await next();
context.Response.Body = original;   // skipped if next() throws</code></pre>

  <p>Symptom: a 500 with an empty body whenever an endpoint throws. Cause: the exception handler wrote
  into the discarded buffer. Fix: restore in a <code>finally</code>.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>Pipeline bugs are ordering bugs, and ordering is invisible in a stack trace. <strong>Make the
    order observable first</strong> — one middleware at the very top that logs entry and exit tells you
    more than reading the startup file, because the file does not show you where the endpoint sits:</p>
    <pre data-lang="csharp" data-net="10" data-title="One middleware worth having"><code>app.Use(async (context, next) =&gt;
{
    logger.LogInformation("IN  {Path}", context.Request.Path);
    await next();
    logger.LogInformation("OUT {Path} {Status}", context.Request.Path,
        context.Response.StatusCode);
});</code></pre>
    <p>If <code>OUT</code> never appears, something below short-circuited and threw, or the request was
    aborted. If <code>OUT</code> appears with a status you did not expect, something below wrote it.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Look at</th><th>What you are looking for</th></tr></thead>
      <tbody>
        <tr>
          <td>A middleware never runs</td>
          <td>What is registered before it</td>
          <td>A terminal <code>Run</code>, or a <code>Map</code>/<code>MapWhen</code> branch that handled the request</td>
        </tr>
        <tr>
          <td>A response header never appears</td>
          <td>Whether it is set after <code>next()</code></td>
          <td><code>HasStarted</code> is already true. Move it to <code>OnStarting</code></td>
        </tr>
        <tr>
          <td>Unauthenticated callers get real data</td>
          <td>Anything that short-circuits above <code>UseAuthentication</code></td>
          <td>A cache, a static file handler, a rate limiter that returns early</td>
        </tr>
        <tr>
          <td>One user sees another's data</td>
          <td>Every cache key, and every middleware field</td>
          <td>A key missing the identity, or per-request state stored on a singleton</td>
        </tr>
        <tr>
          <td>Every protected endpoint is public</td>
          <td><code>UseAuthorization</code> relative to <code>UseRouting</code></td>
          <td>Authorisation above routing. This one throws at startup — the only ordering rule the framework enforces</td>
        </tr>
        <tr>
          <td>A branch never fires</td>
          <td>What its predicate reads, and what runs before it</td>
          <td>A predicate on <code>context.User</code> registered above <code>UseAuthentication</code></td>
        </tr>
        <tr>
          <td>500 with an empty body</td>
          <td>Any middleware that replaces <code>Response.Body</code></td>
          <td>A restore that is not in a <code>finally</code></td>
        </tr>
        <tr>
          <td>Truncated response, status 200</td>
          <td>Logs for <code>The response has already started</code></td>
          <td>An exception thrown mid-stream, after the status line was committed</td>
        </tr>
        <tr>
          <td>Routes inside a <code>Map</code> branch 404</td>
          <td><code>Request.Path</code> and <code>PathBase</code> inside the branch</td>
          <td>The prefix repeated in the route. <code>Map</code> already stripped it</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Middleware runs top to bottom, like statements."</em></p>
    <p>It runs top to bottom on the way <em>in</em> and bottom to top on the way <em>out</em>. Each one
    wraps the rest, so the code after <code>await next()</code> runs after everything below has
    finished. That is why the same two components in two orders give opposite results.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Where I put app.MapGet in the file affects the order."</em></p>
    <p>It does not. <code>Map</code> registers a route in a table; the middleware that executes the
    matched endpoint is appended automatically at the end of the pipeline. A <code>Use</code>
    registered after every <code>Map</code> still runs before the endpoint.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"MapWhen and UseWhen are the same thing with different names."</em></p>
    <p><code>UseWhen</code>'s branch rejoins the main pipeline; <code>MapWhen</code>'s is terminal.
    Measured above. Choosing the wrong one is a silent failure — the branch works and everything
    afterwards silently does not.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"A middleware class is created per request, like a controller."</em></p>
    <p>A convention-based middleware is constructed <strong>once</strong>. Fields on it are shared by
    every concurrent request, and constructor dependencies live as long as the application. Only the
    <code>IMiddleware</code> form is resolved per request.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"I can fix any response in an exception handler."</em></p>
    <p>Only if the response has not started. Once the status line is on the wire it says 200 and cannot
    be recalled — the client gets a truncated body with a success status. Do the work that can fail
    before writing anything.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Putting the cache first is the whole point — it should skip as much work as possible."</em></p>
    <p>It skips your security checks along with the work. The cost of putting it after authorisation is
    a lower hit rate; the cost of putting it before is serving one customer's data to another, and to
    callers with no credentials at all.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <p>Every failure in this module is a correct component in the wrong position, and almost all of them
  are silent.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Decision</th><th>Cost to get right</th><th>Cost of getting it wrong</th></tr></thead>
      <tbody>
        <tr><td>Short-circuiting middleware after auth</td><td>Two lines swapped</td><td>~450,000 responses delivered to the wrong customer over four days</td></tr>
        <tr><td>Cache key includes identity</td><td>One string</td><td>A shared cache is a cross-tenant leak</td></tr>
        <tr><td>Exception handler outermost</td><td>Registration order</td><td>Unhandled exceptions reach the client as bare 500s</td></tr>
        <tr><td><code>OnStarting</code> instead of writing after <code>next()</code></td><td>Four lines</td><td>The header never appears; an exception on every request</td></tr>
        <tr><td>Scoped services on <code>Invoke</code></td><td>A parameter</td><td>Startup failure — or, for transients, a silent leak</td></tr>
        <tr><td><code>Response.Body</code> restored in a <code>finally</code></td><td>A <code>try</code></td><td>Every 500 arrives with an empty body</td></tr>
      </tbody>
    </table>
  </div>

  <p>Two things generalise beyond ASP.NET Core.</p>

  <p><strong>A component can only affect what it wraps.</strong> That single rule generates the whole
  standard ordering — exception handling first because it must catch everything, forwarded headers
  before anything that reads an address, routing before authorisation because authorisation needs to
  know the endpoint. You do not have to memorise the list if you can derive it.</p>

  <p><strong>Short-circuiting is a security decision, not a performance one.</strong> Anything that can
  answer a request early removes everything below it from that request. When you add a fast path — a
  cache, an early-returning rate limiter, a static file handler — you are choosing which checks it is
  allowed to skip, whether or not you thought about it that way.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>In what order do these run, and what does the client receive?</p>
    <pre data-lang="csharp" data-net="10" data-title="The pipeline"><code>app.Use(A);  app.Use(B);  app.Run(C);  app.Use(D);</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   what ran   : A in -&gt; B in -&gt; C (terminal) -&gt; B out -&gt; A out
   client got : from C</code></pre>
        <p><strong>D never ran.</strong> <code>Run</code> is terminal — it takes no <code>next</code>
        delegate, so there is no way to reach anything registered after it. Nothing warns you; the
        middleware is dead code.</p>
        <p>The rest is the nesting rule: registration order on the way in, reverse order on the way out.
        A wraps B wraps C.</p>
        <p>Worth adding: in a normal application the <em>endpoint</em> middleware is the terminal step,
        appended automatically at the end of whatever you registered. So the position of your
        <code>Map</code> calls relative to your <code>Use</code> calls changes nothing — only the order
        of the <code>Use</code> calls matters, and reading the file top to bottom will not tell you
        that.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>You want to add a header for requests under <code>/internal</code> and have them continue to the
    normal endpoints. <code>Map</code>, <code>MapWhen</code> or <code>UseWhen</code>?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   construct   what ran for /internal/data
   ---------   -------------------------
   Map         branch
   MapWhen     branch
   UseWhen     branch -&gt; endpoint</code></pre>
        <p><strong><code>UseWhen</code>.</strong> It is the only one of the three whose branch rejoins
        the main pipeline — <code>Map</code> and <code>MapWhen</code> are terminal, so the endpoint is
        never reached.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Construct</th><th>Matches</th><th>Rejoins?</th></tr></thead>
            <tbody>
              <tr><td><code>Map(path, branch)</code></td><td>A path prefix — and strips it into <code>PathBase</code></td><td>No</td></tr>
              <tr><td><code>MapWhen(predicate, branch)</code></td><td>Any predicate</td><td>No</td></tr>
              <tr><td><code>UseWhen(predicate, branch)</code></td><td>Any predicate</td><td><strong>Yes</strong></td></tr>
            </tbody>
          </table>
        </div>
        <p>Picking <code>MapWhen</code> here is a quiet failure: the header gets added and the request
        never reaches its endpoint. No error, no warning — the response is a 404 or an empty 200
        depending on what the branch did.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>This is supposed to add a timing header and the header never appears. Why, and what is the fix?</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>app.Use(async (context, next) =&gt;
{
    var sw = Stopwatch.StartNew();
    await next();
    context.Response.Headers["X-Elapsed-Ms"] = sw.ElapsedMilliseconds.ToString();
});</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   HasStarted after next()   : True
   setting the header threw  : InvalidOperationException
   X-Broken reached client   : False
   X-Fixed reached client    : True</code></pre>
        <p><strong>The response had already started.</strong> The status line and headers go on the wire
        before the body, so by the time <code>next()</code> returns the endpoint has usually written
        something and the headers are read-only.</p>
        <p><strong>The fix is <code>OnStarting</code>, registered on the way in:</strong></p>
        <pre data-lang="csharp" data-net="10" data-title="Right"><code>app.Use(async (context, next) =&gt;
{
    var sw = Stopwatch.StartNew();

    context.Response.OnStarting(() =&gt;
    {
        context.Response.Headers["X-Elapsed-Ms"] = sw.ElapsedMilliseconds.ToString();
        return Task.CompletedTask;
    });

    await next();
});</code></pre>
        <p>It runs at the last moment before the headers are sent — after the endpoint has decided what
        the response is, and before anything reaches the client. It can see the final status code and
        still add headers.</p>
        <ul>
          <li>Register it <strong>before</strong> calling <code>next</code>.</li>
          <li>It may never run — if the client disconnects and nothing is written, there are no headers
          to send. Cleanup belongs in <code>OnCompleted</code>.</li>
          <li>Keep it cheap and non-throwing: it runs on every response, at a point where the response
          can no longer become a 500.</li>
        </ul>
        <p>On the way <em>out</em> you may only observe. Reading the status code to log it is fine;
        changing anything is not.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>This middleware will not start. Why, and where does the dependency belong?</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>public sealed class AuditMiddleware
{
    public AuditMiddleware(RequestDelegate next, LedgerDbContext db) { }
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   constructor injection : STARTUP FAILED - Cannot resolve scoped service
                           'Scoped' from root provider.
   Invoke parameter      : started, request returned: scoped id 1</code></pre>
        <p><strong>A convention-based middleware is built once</strong>, when the pipeline is built, and
        the same instance serves every request forever. A scoped service in its constructor would be
        captured for the life of the application — one <code>DbContext</code> shared by every concurrent
        request, which is not thread-safe and is the opposite of what scoped means.</p>
        <p><strong>The dependency belongs on <code>Invoke</code>:</strong></p>
        <pre data-lang="csharp" data-net="10" data-title="Right"><code>public async Task InvokeAsync(HttpContext context, LedgerDbContext db)</code></pre>
        <p><code>Invoke</code> runs per request, and its extra parameters are resolved from that
        request's scope. The split is the design: the constructor is for things that live as long as the
        application, <code>Invoke</code> for things that live as long as the request.</p>
        <ul>
          <li><strong>It fails at startup</strong>, not on the first request, because that is when the
          middleware is constructed — one of the few pipeline mistakes that cannot reach production
          quietly.</li>
          <li><strong>It only fails for scoped services.</strong> A <em>transient</em> service in the
          constructor is accepted silently and then lives forever — the same bug with no error
          message.</li>
        </ul>
        <p>Per-request state also belongs in locals or <code>HttpContext.Items</code>, never in a field:
        fields on a singleton are shared by every concurrent request.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>A response cache was added to a slow endpoint. Merchants start seeing each other's data, and the
    caching code is correct. What is wrong, and what are the <em>two</em> fixes?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   arrangement                              second caller saw          leak?
   -----------                              -----------------          -----
   cache BEFORE auth, path key              statement for merchant-a   YES
   cache BEFORE auth, ANONYMOUS caller      statement for merchant-a   YES
   cache AFTER auth, path key               statement for merchant-a   YES
   cache AFTER auth, path + user key        statement for merchant-b   no</code></pre>
        <p><strong>Two separate defects, and fixing either one alone leaves a leak.</strong></p>
        <ol>
          <li><strong>Position.</strong> The cache sits before authentication, so it has no user to key
          on — and worse, when it hits it <em>short-circuits</em>, which skips authentication entirely.
          Row 2 is the proof: an anonymous caller with no credentials received a real merchant's
          statement, and the authentication middleware never ran to object.
          <p>A short-circuiting middleware above authentication does not merely get the answer wrong —
          <strong>it removes authentication from the request</strong>.</p></li>
          <li><strong>The key.</strong> Row 3 has the ordering right and still leaks, because the key is
          the path and the path is identical for every merchant.</li>
        </ol>
        <p>Row 4 fixes both. The cost is a lower hit rate — a per-user cache cannot be shared — which is
        what correctness costs here.</p>
        <p><strong>The general rules:</strong></p>
        <ul>
          <li>Anything that can short-circuit goes <em>after</em> authentication and authorisation,
          unless it is deliberately public. That covers caches, early-returning rate limiters, static
          file handlers, and any fast path added for performance.</li>
          <li>A cache key must include everything the response varies by: path, query, identity, tenant,
          language. Anything left out is a way for one caller to receive another's response. It is the
          <code>Vary</code> header rule applied to your own cache.</li>
          <li>A middleware can only use what earlier middleware established. The cache could not key on
          the user before authentication because there was no user yet.</li>
        </ul>
        <p><strong>The test</strong> needs the real pipeline, because the bug is entirely in the
        pipeline: request the same path as two different users and assert the second response does not
        contain the first user's data — then repeat with no credentials and assert a 401.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Order these, and justify every position.</p>
    <pre data-lang="text" data-title="Unordered"><code>UseAuthorization      UseStaticFiles       UseRouting
UseExceptionHandler   UseAuthentication    UseCors
UseForwardedHeaders   UseHttpsRedirection  a response cache</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Middleware</th><th>Why there</th></tr></thead>
            <tbody>
              <tr><td>1</td><td><code>UseExceptionHandler</code></td><td>It can only catch what it wraps, so anything above it throws past it</td></tr>
              <tr><td>2</td><td><code>UseForwardedHeaders</code></td><td>Everything below reads the scheme or the client address, and until this runs both describe the proxy</td></tr>
              <tr><td>3</td><td><code>UseHttpsRedirection</code></td><td>Needs the real scheme from step 2, or it redirects forever behind a TLS-terminating proxy</td></tr>
              <tr><td>4</td><td><code>UseStaticFiles</code></td><td>Short-circuits on a hit, so a file never pays for routing or auth. Only safe because the files are <em>public</em></td></tr>
              <tr><td>5</td><td><code>UseRouting</code></td><td>Selects the endpoint. Nothing above knows which endpoint will run</td></tr>
              <tr><td>6</td><td><code>UseCors</code></td><td>After routing to read per-endpoint policy; before auth because a preflight carries no credentials and must not be rejected for lacking them</td></tr>
              <tr><td>7</td><td><code>UseAuthentication</code></td><td>Establishes <em>who</em>. Sets <code>context.User</code>; rejects nobody</td></tr>
              <tr><td>8</td><td><code>UseAuthorization</code></td><td>Decides whether that caller may reach <em>this</em> endpoint. Needs 5 and 7, so it cannot move above either</td></tr>
              <tr><td>9</td><td>The response cache</td><td>After authorisation, because it short-circuits and would otherwise skip both checks — and it needs the identity for its key</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>The two worth arguing about:</strong></p>
        <p><strong>Static files at 4</strong> is a performance choice that assumes the files are public.
        If anything under <code>wwwroot</code> should be restricted, this ordering serves it to anyone —
        the same short-circuit-above-auth bug as the cache in exercise 5. Move it below authorisation, or
        do not put private files there.</p>
        <p><strong>The cache at 9</strong> gives up the latency win for unauthenticated public endpoints,
        which could safely be cached earlier. If you want both, run two caches in two positions with
        different keys, and be deliberate about which endpoints each one serves.</p>
        <p>The framework checks exactly <em>one</em> of these for you: <code>UseAuthorization</code>
        before <code>UseRouting</code> throws at startup. Every other ordering mistake in this list is
        silent.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>In what order does middleware see the request and the response?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Registration order on the way in, reverse order on the way out.
        Each one wraps everything registered after it, so the pipeline is nested rather than
        sequential.</p></div></details></li>

    <li><p>What is the difference between <code>Use</code> and <code>Run</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>Use</code> receives a <code>next</code> delegate and may call
        it. <code>Run</code> does not receive one, so it is terminal — anything registered after it is
        unreachable, with no warning.</p></div></details></li>

    <li><p>How do you reject a request from middleware?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Write the response and return without calling <code>next</code>.
        There is no special API — that is what short-circuiting is, and it is how authentication
        failures, rate limits and caches all work.</p></div></details></li>

    <li><p>Does the position of <code>app.MapGet</code> in the file affect the pipeline order?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. <code>Map</code> registers a route in a table; the endpoint
        middleware is appended automatically at the end. Only the order of the <code>Use</code> calls
        among themselves matters.</p></div></details></li>

    <li><p>Which of <code>Map</code>, <code>MapWhen</code> and <code>UseWhen</code> rejoins the main
    pipeline?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Only <code>UseWhen</code>. The other two are terminal.
        <code>Map</code> additionally strips the matched prefix from <code>Path</code> into
        <code>PathBase</code>.</p></div></details></li>

    <li><p>How many times is a convention-based middleware constructed?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Once, when the pipeline is built. It is effectively a singleton, so
        fields are shared by every concurrent request and constructor dependencies live as long as the
        application.</p></div></details></li>

    <li><p>Where does a scoped dependency go in a convention-based middleware, and why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>As a parameter of <code>Invoke</code>, which runs per request and
        resolves from that request's scope. In the constructor it would be captured forever — and the
        application refuses to start rather than allowing it.</p></div></details></li>

    <li><p>Why does setting a response header after <code>await next()</code> usually fail?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The response has already started — the status line and headers went
        on the wire before the body. Use <code>OnStarting</code>, registered before
        <code>next</code>.</p></div></details></li>

    <li><p>An endpoint throws halfway through writing a large response. What does the client get?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A truncated body with a <strong>200</strong>. The status line was
        committed before the exception existed and cannot be recalled. The fix is to do work that can
        fail before writing anything.</p></div></details></li>

    <li><p>Why must anything that short-circuits sit after authentication?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Because short-circuiting skips everything registered after it. A
        cache above authentication does not merely answer from stale data — it removes authentication
        from every request it serves, including ones with no credentials at
        all.</p></div></details></li>

    <li><p>What must a cache key include?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Everything the response varies by — path, query, identity, tenant,
        language. Anything left out is a way for one caller to receive another's response. It is the
        <code>Vary</code> header rule applied to your own cache.</p></div></details></li>

    <li><p>Which ordering mistake does the framework actually catch for you?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>UseAuthorization</code> before <code>UseRouting</code>, which
        throws at startup. Every other ordering mistake in this module is silent.</p></div></details></li>
  </ol>
</section>
`
});
