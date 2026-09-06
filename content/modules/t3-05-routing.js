CSPREP.module({
  id: "t3-05-routing",
  minutes: 55,
  updated: "2026-09-03",
  summary: "Two Ledger teams add /payments/{id} and /payments/{reference} in different files. The build succeeds, the deploy is green, health checks pass, and every payment lookup returns 500 - because the parameter name is not part of the match. The three-minute fix constrains one route to :int, which stops the 500s and starts 404-ing every PAY-nnnn identifier: 13,000 lookups over two days answered 'no such payment' with nothing paging anybody, because a 404 is invisible to alerting and a 500 is not.",
  terms: ["route template", "route parameter", "catch-all", "optional parameter", "default value",
    "route precedence", "AmbiguousMatchException", "route constraint", "IRouteConstraint",
    "endpoint metadata", "route group", "MapGroup", "endpoint filter", "link generation",
    "LinkGenerator", "named route", "PathBase", "MapFallback", "ASP0022"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger's payment lookup has been <code>GET /payments/{id}</code> for years. Ids are numeric for
  anything created before 2024 and <code>PAY-nnnn</code> since.</p>

  <p>A second team is building a reconciliation tool and needs lookup by the gateway's own reference.
  They add, in a different file:</p>

  <pre data-lang="csharp" data-net="10" data-title="A new route, in a different file"><code>app.MapGet("/payments/{reference}", LookupByReference);</code></pre>

  <p>It builds. The pull request is approved — the route is new, the path is new to the reader, and
  nothing in the diff touches the existing endpoint. The deploy succeeds and health checks stay
  green.</p>

  <p>Every payment lookup starts returning 500.</p>

  <pre data-lang="console" data-title="05-production.cs"><code>   version                        200   404   500
   -------                        ---   ---   ---
   v1  the original route           7     0     0
   v2  reference lookup added       0     0     7
   v3  'fixed' with :int            4     3     0
   v4  distinct shapes              7     0     0</code></pre>

  <p>Row 3 is the three-minute fix, made under pressure: constrain the original route to
  <code>:int</code> so the two templates differ. The 500s stop. <strong>It also 404s every
  <code>PAY-nnnn</code> identifier</strong> — three of these seven, and in production the majority.</p>

  <p>That second state lasted two days, because <strong>a 500 is an alert and a 404 is not.</strong></p>

  <p>This module is about the layer where all of that happened: <strong>routing</strong>. How a request
  is matched to an endpoint, which route wins, what a constraint actually does, and how to build URLs
  that survive the environment they run in.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every match, status code and generated URL in this module was produced by running the programs
    shown and pasted in unedited. Routing does not depend on timing, so all of it is deterministic.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What routing is</h2>

  <p class="define"><span class="define__term">Route</span> A pairing of a URL pattern with a handler.
  "When a <code>GET</code> arrives for a path shaped like <code>/payments/&lt;something&gt;</code>, run
  this code."</p>

  <p class="define"><span class="define__term">Route template</span> The pattern itself, written as a
  string: <code>/payments/{id}</code>. Segments in braces are parameters; everything else is
  literal.</p>

  <p class="define"><span class="define__term">Segment</span> One piece of a path between slashes.
  <code>/payments/PAY-1</code> has two segments. This matters more than it sounds: a parameter matches
  exactly one segment, never a slash.</p>

  <p class="define"><span class="define__term">Routing</span> The step that compares an incoming path
  against every registered template and decides which endpoint should run.</p>

  <p class="define"><span class="define__term">Endpoint</span> The thing routing selects — a handler
  plus everything attached to it. Attaching things to it is what most of the second half of this module
  is about.</p>

  <p class="define"><span class="define__term">Query string</span> The part of a URL after a
  <code>?</code>. It is <em>not</em> part of route matching at all — routing only ever looks at the
  path, so two requests differing only in their query string always reach the same endpoint.</p>

  <p class="define"><span class="define__term">Route values</span> The dictionary of captured parameter
  values that routing produces. Handler parameters are filled from it by name, which is why the
  parameter in your lambda must match the name in the template.</p>

  <p>The smallest thing worth understanding first:</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>app.MapGet("/payments/{id}", (string id) =&gt; $"looked up payment {id}");
app.MapGet("/invoices/{number:int}", (int number) =&gt; $"invoice number {number}");</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>GET /payments/PAY-0001     -&gt; 200 looked up payment PAY-0001
GET /invoices/42           -&gt; 200 invoice number 42
GET /invoices/abc          -&gt; 404</code></pre>

  <p>The last line is the whole module in miniature. <code>/invoices/abc</code> is
  <strong>404, not 400</strong>. Nothing matched, so as far as the application is concerned that
  resource does not exist.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>Routing is like a postal sorting office reading addresses. Each pattern is a rule about the shape
  of an address — "anything for this street, house number in this range" — and a letter is put into the
  most specific matching pigeonhole. A letter matching no rule goes to dead letters.</p>

  <p><strong>This is an analogy and it misleads in two ways.</strong> First, a sorting office reads
  rules in order and stops at the first match; routing does not — it considers all of them and picks
  the most specific, so moving a rule in the file changes nothing. Second, and more importantly, a
  sorting office can return a letter with "no such house number" written on it. Routing cannot: a
  request that fails a constraint is indistinguishable from a request for a path that was never
  registered. That single limitation causes most of this module's incidents.</p>
</section>

<section id="templates">
  <h2>What a template can express</h2>

  <pre data-lang="console" data-title="01-templates-and-precedence.cs"><code>   template                    request                     result
   --------                    -------                     ------
   /literal                    /literal                    literal         an exact path
   /payments/{id}              /payments/PAY-1             id=PAY-1        one segment captured
   /payments/{id}              /payments/a/b               404             TWO segments - no match
   /reports/{year}/{month}     /reports/2026/09            2026-09         two parameters
   /search/{term?}             /search/                    term=(none)     optional, absent
   /search/{term?}             /search/widgets             term=widgets    optional, present
   /page/{number=1}            /page/                      page=1          default value applied
   /files/{*path}              /files/a/b/c.txt            path=a/b/c.txt  catch-all takes the rest</code></pre>

  <p><strong>A parameter matches exactly one segment.</strong> That is the rule behind the third row:
  <code>/payments/a/b</code> has two segments where the template has one, so nothing matched.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Form</th><th>Means</th><th>Note</th></tr></thead>
      <tbody>
        <tr><td><code>{id}</code></td><td>Required, one segment</td><td></td></tr>
        <tr><td><code>{term?}</code></td><td>Optional; <code>null</code> when absent</td><td>Must be the last segment</td></tr>
        <tr><td><code>{number=1}</code></td><td>Optional; <code>1</code> when absent</td><td>Must be the last segment</td></tr>
        <tr><td><code>{*path}</code></td><td>Catch-all — the rest of the path, slashes included</td><td>See below</td></tr>
        <tr><td><code>{**path}</code></td><td>The same, for matching</td><td>Differs only in link generation</td></tr>
      </tbody>
    </table>
  </div>

  <p>Optional and default are not the same thing, and both must be last — anything after them could
  never be reached unambiguously.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>The difference between <code>{*path}</code> and <code>{**path}</code> is not where it is usually
    said to be. <strong>For matching they are identical</strong> — measured across five inputs
    (<code>a/b/c.txt</code>, <code>a%2Fb</code>, <code>a%20b</code>, <code>a+b</code>,
    <code>%25</code>), both forms captured exactly the same value every time.</p>
    <p>The difference is in <em>generating</em> a URL:</p>
    <pre data-lang="console" data-title="04-link-generation.cs"><code>   value                 {*path} generates              {**path} generates
   -----                 -----------------              ------------------
   a/b/c.txt             /single/a%2Fb%2Fc.txt          /double/a/b/c.txt
   reports/2026/09       /single/reports%2F2026%2F09    /double/reports/2026/09</code></pre>
    <p>The single-star form percent-encodes the slashes, so the generated URL no longer looks like a
    path — and anything downstream that treats it as one will not. <strong>Use <code>{**path}</code>
    whenever the value goes back into a URL.</strong> If you only ever read it, the two are
    interchangeable.</p>
  </div>
</section>

<section id="precedence">
  <h2>Which route wins</h2>

  <p>Four routes, registered from least to most specific:</p>

  <pre data-lang="console" data-title="01-templates-and-precedence.cs"><code>   request                  matched
   -------                  -------
   /payments/summary        literal
   /payments/42             constrained parameter
   /payments/PAY-1          parameter
   /payments/a/b/c          catch-all</code></pre>

  <p><strong>More specific wins</strong>, decided segment by segment from the left:</p>

  <ol>
    <li>A literal segment — <code>/payments/summary</code></li>
    <li>A <strong>constrained</strong> parameter — <code>/payments/{id:int}</code></li>
    <li>A plain parameter — <code>/payments/{id}</code></li>
    <li>A catch-all — <code>/payments/{*rest}</code></li>
  </ol>

  <pre data-lang="console" data-title="01-templates-and-precedence.cs"><code>   literal registered FIRST  : /payments/summary -&gt; literal
   literal registered LAST   : /payments/summary -&gt; literal</code></pre>

  <p><strong>Registration order does not matter.</strong> Routing is not a list scanned top to bottom;
  it builds a tree of templates and picks the most specific match.</p>

  <p>That is worth stating plainly because most routing systems people have used are first-match-wins,
  where moving a route up the file changes behaviour. Here it does not, and code that relies on ordering
  is relying on something that is not true.</p>

  <p>The upside is that you can group routes for readability without worrying about shadowing, and a
  catch-all is a <em>safe</em> fallback because it loses to everything. The cost is that two routes of
  <em>equal</em> specificity have no tie-breaker at all.</p>

  <h3>Two routes of equal specificity</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="These are the same route, twice"><code>app.MapGet("/orders/{id}", (string id) =&gt; $"by id {id}");
app.MapGet("/orders/{reference}", (string reference) =&gt; $"by ref {reference}");</code></pre>

  <pre data-lang="console" data-title="01-templates-and-precedence.cs"><code>   the application            : started with no complaint
   GET /health                : 200 healthy
   GET /orders/42             : 500</code></pre>

  <p><strong>The parameter name is not part of the match.</strong> Both templates are "literal,
  parameter" — identical shape — so they are one route declared twice, and the router cannot choose. The
  exception is <code>AmbiguousMatchException</code>, and it names both routes.</p>

  <p>The usual cause is not two literally identical templates. It is two routes that <em>look</em>
  different and have the same shape, usually added by two people in different files:</p>

  <pre data-lang="text" data-title="Pairs that are one route"><code>/orders/{id}          and   /orders/{reference}
/users/{id}/profile   and   /users/{name}/profile</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Three layers have an opinion about this and only one of them stops you:</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Layer</th><th>What happens</th></tr></thead>
        <tbody>
          <tr><td><strong>Build time</strong></td><td>The <code>ASP0022</code> analyzer <em>warns</em>, naming both routes. It is a warning, so it ships</td></tr>
          <tr><td>Startup</td><td><strong>Nothing.</strong> Routes are not validated when the application starts</td></tr>
          <tr><td>Request time</td><td><code>AmbiguousMatchException</code> as a 500, on the affected paths only</td></tr>
        </tbody>
      </table>
    </div>
    <p>So a broken route deploys successfully, health checks stay green, and a rolling update replaces
    every healthy pod with a broken one — one at a time, with every probe passing.</p>
    <p><strong>Turn <code>ASP0022</code> into an error if you do nothing else from this module:</strong></p>
    <pre data-lang="xml" data-title="The one line to add"><code>&lt;WarningsAsErrors&gt;ASP0022&lt;/WarningsAsErrors&gt;</code></pre>
    <p>One honest caveat: it <em>over-warns</em>. Compiling the verification file produces
    <code>ASP0022</code> for the four precedence routes above as well, and those resolve correctly at
    runtime. The analyzer flags routes that <em>could</em> match the same request without modelling the
    precedence that separates them, so turning it into an error will occasionally reject a pattern that
    works. Suppress those individually, at the line, with a comment.</p>
  </div>
</section>

<section id="constraints">
  <h2>Constraints, and what they are not</h2>

  <p class="define"><span class="define__term">Route constraint</span> A rule attached to a parameter,
  written after a colon, restricting which values that segment may take:
  <code>{id:int}</code>, <code>{code:alpha}</code>, <code>{n:range(1,100)}</code>.</p>

  <pre data-lang="console" data-title="02-constraints.cs"><code>   constraint              request                matches?
   ----------              -------                --------
   {v:int}                 /int/42                yes
   {v:int}                 /int/4.2               NO   (404)
   {v:guid}                /guid/8a1f0c2e-...     yes
   {v:bool}                /bool/true             yes
   {v:alpha}               /alpha/widgets         yes
   {v:alpha}               /alpha/widget9         NO   (404)
   {v:minlength(3)}        /minlen/ab             NO   (404)
   {v:minlength(3)}        /minlen/abc            yes
   {v:int:range(1,100)}    /range/50              yes
   {v:int:range(1,100)}    /range/500             NO   (404)
   {v:regex(^PAY-\\d{4}$)}  /regex/PAY-0001        yes
   {v:regex(^PAY-\\d{4}$)}  /regex/PAY-1           NO   (404)</code></pre>

  <p>Constraints chain with colons and all of them must pass. The full set is larger — <code>datetime</code>,
  <code>decimal</code>, <code>long</code>, <code>double</code>, <code>maxlength</code>, <code>length</code>,
  <code>min</code>, <code>max</code>, <code>required</code> — and every one behaves the same way.</p>

  <p class="define"><span class="define__term">Matching</span> Deciding which endpoint, if any, handles
  a request. It happens before any handler runs, so nothing in it can produce a message — only a match
  or no match.</p>

  <p class="define"><span class="define__term">Validation</span> Deciding whether the values in a
  request are acceptable. It happens inside a handler, which is why it can return a status code and a
  body explaining what was wrong.</p>

  <h3>The 404 that should have been a 400</h3>

  <pre data-lang="console" data-title="02-constraints.cs"><code>   request                  status   body
   -------                  ------   ----
   /constrained/50             200   page 50
   /constrained/abc            404   (empty)
   /constrained/500            404   (empty)
   /validated/50               200   {"page":50}
   /validated/abc              400   {"error":"id must be a whole number","got":"abc"}
   /validated/500              422   {"error":"id must be between 1 and 100","got":500}</code></pre>

  <p><strong>The constrained route returns 404 for both bad inputs.</strong> Not 400, not 422, and with
  no body explaining anything.</p>

  <p>That is correct, and it follows from what a constraint <em>is</em>. Constraints run during route
  <em>matching</em>, before any handler is chosen. A value that fails one means this route does not
  match, and if nothing else matches the answer is "no such resource". From outside,
  <code>/constrained/abc</code> and a path that was never registered are indistinguishable.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Reach for</th><th>When</th></tr></thead>
      <tbody>
        <tr><td>A <strong>constraint</strong></td><td>To disambiguate routes, or to keep clearly malformed requests away from your handler cheaply. A 404 is an acceptable answer</td></tr>
        <tr><td><strong>Validation in the handler</strong></td><td>When the caller deserves to know what was wrong — 400 for malformed, 422 for unacceptable, with a body naming the field</td></tr>
      </tbody>
    </table>
  </div>

  <p>The two are not alternatives, and the usual answer is both: keep the <em>type</em> constraint for
  matching and put the <em>range</em> check in the handler for the message. A range constraint is a
  reasonable guard and a poor error message.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>The failure mode to recognise anywhere: <strong>a client reports 404 for a resource that
    exists.</strong> The usual cause is a constraint rejecting the value — an id that is a GUID where
    the route says <code>:int</code>, an id too long for <code>int</code>, a date in the wrong
    format.</p>
    <p>Nothing in your logs will say "constraint failed". It is a 404 like any other.</p>
  </div>

  <h3>What constraints are genuinely good at</h3>

  <pre data-lang="console" data-title="02-constraints.cs"><code>   request              matched
   -------              -------
   /orders/42           by numeric id 42
   /orders/ORD-0007     by reference ORD-0007
   /orders/nonsense     404</code></pre>

  <p>Without the constraints those two templates have identical shape and every request would throw.
  The constraints make them different routes. <strong>This is the case constraints exist for</strong> —
  two ways of addressing the same kind of resource, told apart by the shape of the identifier.</p>

  <h3>A constraint of your own</h3>

  <pre data-lang="csharp" data-net="10" data-title="02-constraints.cs"><code>sealed class PaymentIdConstraint : IRouteConstraint
{
    public bool Match(HttpContext? httpContext, IRouter? route, string routeKey,
        RouteValueDictionary values, RouteDirection routeDirection)
    {
        if (!values.TryGetValue(routeKey, out object? raw) || raw is null)
        {
            return false;
        }

        string value = raw.ToString() ?? string.Empty;

        // PAY- followed by exactly four digits. Cheap, and it cannot throw.
        return value.Length == 8
            &amp;&amp; value.StartsWith("PAY-", StringComparison.Ordinal)
            &amp;&amp; char.IsAsciiDigit(value[4])
            &amp;&amp; char.IsAsciiDigit(value[5])
            &amp;&amp; char.IsAsciiDigit(value[6])
            &amp;&amp; char.IsAsciiDigit(value[7]);
    }
}

// Registering it gives it a NAME usable in any template.
builder.Services.Configure&lt;RouteOptions&gt;(options =&gt;
    options.ConstraintMap["paymentid"] = typeof(PaymentIdConstraint));</code></pre>

  <p>Three rules, and the first is the one that gets broken:</p>

  <ol>
    <li><strong>It must be cheap and pure.</strong> It runs on every candidate request, before
    authentication, before anything. <strong>Never touch a database or call a service from a
    constraint</strong> — "does this order exist?" is a handler's question, and putting it here means an
    unauthenticated stranger can make you query.</li>
    <li><strong>It must not throw.</strong> A constraint that throws turns every request of that shape
    into a 500, including ones that were never going to match.</li>
    <li><strong>It runs for generation too.</strong> <code>routeDirection</code> tells you which; an
    asymmetric constraint will silently break link generation while matching perfectly.</li>
  </ol>

  <p>The reason to prefer this over a regex in the template is that it has a <em>name</em>.
  <code>{id:paymentid}</code> says what is meant; a regex says how it is spelled, in a place nobody can
  test. Regex constraints also run on every request that reaches the segment, so a pathological pattern
  is a denial-of-service vector against your own router.</p>
</section>

<section id="groups">
  <h2>Groups and metadata</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-groups-and-metadata.cs"><code>var payments = app.MapGroup("/v1/payments")
    .WithTags("payments")
    .AddEndpointFilter(async (context, next) =&gt;
    {
        string? key = context.HttpContext.Request.Headers["X-Api-Key"].FirstOrDefault();

        if (string.IsNullOrEmpty(key))
        {
            return Results.Json(new { error = "api key required" }, statusCode: 401);
        }

        return await next(context);
    });

payments.MapGet("/", () =&gt; "list");
payments.MapGet("/{id}", (string id) =&gt; $"get {id}");
payments.MapPost("/", () =&gt; Results.Created("/v1/payments/PAY-1", new { id = "PAY-1" }));</code></pre>

  <pre data-lang="console" data-title="03-groups-and-metadata.cs"><code>   request                     with key   without key
   -------                     --------   -----------
   GET /v1/payments               200           401
   GET /v1/payments/PAY-9         200           401
   GET /health                    200           200</code></pre>

  <p><code>MapGroup</code> gives three things at once: a <strong>path prefix</strong>, <strong>shared
  metadata</strong>, and <strong>shared filters</strong>. Unlike <code>app.Map</code> it does
  <em>not</em> move anything into <code>PathBase</code> — the full path is still the full path, and link
  generation produces the complete URL.</p>

  <p>The value is that the cross-cutting concern is declared where the routes are. <strong>A middleware
  guarding <code>/v1/payments</code> by string comparison breaks silently the day somebody adds
  <code>/v1/payment-methods</code>; a group cannot.</strong></p>

  <p class="define"><span class="define__term">Endpoint filter</span> Code that wraps a single
  endpoint's execution. It runs after every middleware, sees the bound arguments, and can replace the
  result the handler returned.</p>

  <h3>Metadata is how most of the framework works</h3>

  <p class="define"><span class="define__term">Endpoint metadata</span> An untyped bag of objects
  attached to an endpoint. Anything downstream can look for what it understands.</p>

  <pre data-lang="console" data-title="03-groups-and-metadata.cs"><code>   endpoint : HTTP: GET /tagged
   metadata : EndpointNameMetadata, EndpointSummaryAttribute, HttpMethodMetadata,
              ParameterBindingMetadata, ProducesResponseTypeMetadata,
              RouteDiagnosticsMetadata, RouteNameMetadata, RuntimeMethodInfo,
              TagsAttribute</code></pre>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Call</th><th>Attaches</th><th>Read by</th></tr></thead>
      <tbody>
        <tr><td><code>RequireAuthorization()</code></td><td>An authorisation policy</td><td><code>UseAuthorization</code></td></tr>
        <tr><td><code>WithName(...)</code></td><td>A name</td><td>Link generation</td></tr>
        <tr><td><code>WithTags(...)</code></td><td>Tags</td><td>OpenAPI</td></tr>
        <tr><td><code>WithMetadata(...)</code></td><td>Anything you like</td><td>Your own middleware</td></tr>
      </tbody>
    </table>
  </div>

  <p>Recognising this pattern explains the ordering rule from the middleware module:
  <strong>authorisation must come after routing because routing is what puts the endpoint — and
  therefore the policy — on the context.</strong> Before routing there is nothing to read.</p>

  <p>It also gives a better shape than checking paths in middleware, for the same reason a group does:
  the decision lives with the endpoint and cannot drift away from it.</p>

  <pre data-lang="csharp" data-net="10" data-title="Your own metadata"><code>app.MapGet("/reports", () =&gt; "the report").WithMetadata(new AuditRequired());

// Later, in a middleware placed AFTER routing:
var required = context.GetEndpoint()?.Metadata.GetMetadata&lt;AuditRequired&gt;();
if (required is not null)
{
    logger.LogInformation("audited endpoint reached");
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="The metadata type itself"><code>sealed record AuditRequired;</code></pre>

  <h3>Where a filter runs</h3>

  <pre data-lang="console" data-title="03-groups-and-metadata.cs"><code>     middleware BEFORE routing
     middleware AFTER routing (endpoint: True)
     group filter
     endpoint filter
     the endpoint
     middleware BEFORE routing (out)</code></pre>

  <p><strong>Filters run inside the endpoint, not in the pipeline.</strong> They are the innermost
  layer, after every middleware has already run — and group filters nest outside endpoint filters, the
  same way middleware nests.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th></th><th>Runs</th><th>Sees</th><th>Use for</th></tr></thead>
      <tbody>
        <tr><td><strong>Middleware</strong></td><td>For every request that reaches it, matched or not</td><td>The raw request; can short-circuit before routing</td><td>Logging, exception handling, forwarded headers</td></tr>
        <tr><td><strong>Filter</strong></td><td>Only when <em>this</em> endpoint was selected</td><td>The bound arguments, and the result the handler returned</td><td>Per-endpoint validation, auditing, result shaping</td></tr>
      </tbody>
    </table>
  </div>

  <h3>Nesting</h3>

  <pre data-lang="console" data-title="03-groups-and-metadata.cs"><code>   request                 status   X-Version   X-Area
   -------                 ------   ---------   ------
   GET /v1/payments/PAY-1    200           1   payments
   GET /v1/health            200           1   -</code></pre>

  <p>Groups nest, and both the prefix and the filters accumulate. This is the shape most API versioning
  takes, and it is worth preferring over the alternatives for one reason: <strong>the structure is in
  the code rather than in a convention.</strong></p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Everything applied to a group applies to <strong>every</strong> endpoint in it, including ones
    added later by somebody who did not read the group declaration.</p>
    <p>That is the point when the group requires authorisation, and a hazard when it applies something
    surprising — a response cache, a rate limit, a body size limit. Keep what a group applies boring and
    predictable, and put anything unusual on the individual endpoint that needs it.</p>
  </div>
</section>

<section id="link-generation">
  <h2>Link generation</h2>

  <p class="define"><span class="define__term">Link generation</span> Building a URL from a route and a
  set of values, rather than by assembling a string. <code>LinkGenerator</code> is the service that does
  it, and <code>WithName</code> is how you address a route.</p>

  <p class="define"><span class="define__term">Named route</span> A route given a string name with
  <code>WithName</code>, so that link generation can refer to it. Names must be unique across the
  application — two routes sharing one makes generation fail.</p>

  <p class="define"><span class="define__term">PathBase</span> The prefix of the path that has already
  been consumed before routing sees it, because the application is hosted under a sub-path. Generated
  URLs include it; hand-built strings do not.</p>

  <pre data-lang="console" data-title="04-link-generation.cs"><code>   call                                                    produces
   ----                                                    --------
   GetPathByName("GetPayment", new { id = "PAY-0001" })    /v1/payments/PAY-0001
   GetPathByName("GetReport", new { year, month })         /v1/reports/2026/9
   ... plus values that are not route parameters           /v1/payments/PAY-0001?expand=gateway&amp;page=2
   GetUriByName(..., scheme, host)                         https://api.ledger.example/v1/payments/PAY-0001</code></pre>

  <p>The route template appears <strong>once</strong>, in the <code>Map</code> call. Everything else
  asks for it by name. Values that are not route parameters become the query string automatically, so
  there is no string concatenation anywhere.</p>

  <h3>Three ways a hand-built URL breaks</h3>

  <p><strong>1. Escaping.</strong></p>

  <pre data-lang="console" data-title="04-link-generation.cs"><code>     a b      -&gt; /items/a%20b
     a&amp;b      -&gt; /items/a%26b
     a/b      -&gt; /items/a%2Fb
     café     -&gt; /items/caf%C3%A9</code></pre>

  <p>Every one of those would produce a broken URL from <code>$"/items/{name}"</code>, and three
  silently: the ampersand truncates at a query boundary, the space breaks the request line, and the
  slash invents a segment.</p>

  <p><strong>2. <code>PathBase</code>.</strong></p>

  <pre data-lang="console" data-title="04-link-generation.cs"><code>   hand-built        : /v1/payments/PAY-1
   GetPathByName     : /ledger/v1/payments/PAY-1
   without a context : /v1/payments/PAY-1
   Request.PathBase  : /ledger
   Request.Path      : /build-links</code></pre>

  <p>The hand-built URL is wrong, and wrong in the way that is hardest to catch: <strong>it works
  perfectly on a developer's machine, where there is no <code>PathBase</code>, and 404s in the
  environment that has one.</strong></p>

  <p>Note the third row. <strong>Passing the <code>HttpContext</code> is what supplies the
  <code>PathBase</code></strong> — the context-free overload produces the same wrong answer as the
  string. Those overloads exist for background services, which must be told the scheme, host and base
  from configuration because nothing can infer them. That is the practical catch with an email
  containing a link: it cannot ask a request what the public host is, so it will be wrong in exactly
  one environment until somebody notices.</p>

  <p><strong>3. The template changes.</strong> Moving <code>/v1</code> to <code>/v2</code> updates every
  <code>Location</code> header, link and redirect with no other edit — if they are generated.</p>

  <h3>When generation fails</h3>

  <pre data-lang="console" data-title="04-link-generation.cs"><code>   what was asked for                                result
   ------------------                                ------
   a name that does not exist                        null
   the right name, a missing parameter               null
   the right name, wrong parameter name              null
   a value that fails the constraint                 null
   everything correct                                /v1/payments/PAY-1</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Every failure returns <code>null</code>.</strong> No exception, no log, no indication of
    which of the four things went wrong.</p>
    <p>That matters because of where the null ends up:</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Where the null ends up"><code>return Results.Created(location!, body);</code></pre>
    <p>A null <code>Location</code> produces a <strong>201 with no <code>Location</code> header</strong>
    — a response that looks successful and is missing the one thing the client needed. Or it lands in a
    string interpolation and becomes an empty segment in a link nobody notices until a customer clicks
    it.</p>
    <p><strong>Treat <code>null</code> as a bug</strong> — throw, or log loudly. And add a test that
    generates a URL for every named route with representative values; that catches a renamed route, a
    changed parameter and a tightened constraint, all of which are otherwise silent.</p>
  </div>

  <p>The fourth row is the subtle one: <strong>constraints run during generation too.</strong> A value
  that would not match the route cannot be used to build a URL for it — which is correct, and is why a
  custom constraint has to behave the same in both directions.</p>

  <p>Route names are strings and nothing checks them. That is the price of the indirection, and it is
  worth paying only because the alternative — the template repeated in a dozen places — fails more
  quietly still.</p>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>Back to the incident. Seven real identifiers — four legacy numeric, three <code>PAY-nnnn</code> —
  against four versions of the routing:</p>

  <pre data-lang="console" data-title="05-production.cs"><code>   version                        200   404   500
   -------                        ---   ---   ---
   v1  the original route           7     0     0
   v2  reference lookup added       0     0     7
   v3  'fixed' with :int            4     3     0
   v4  distinct shapes              7     0     0</code></pre>

  <p><strong>v2 is the incident.</strong> Every identifier returns 500, because
  <code>/payments/{id}</code> and <code>/payments/{reference}</code> have identical shape and the router
  cannot choose. Nothing about the second route looks wrong in a diff that does not show the first.</p>

  <p><strong>v3 is the three-minute fix</strong>, and it 404s every <code>PAY-nnnn</code> identifier. A
  constraint decides whether a route <em>matches</em>, so a non-matching id means "no such payment"
  rather than "wrong format".</p>

  <p><strong>The second state is worse than the first</strong>, for one reason: a 500 is an alert and a
  404 is not. Error-rate dashboards, circuit breakers and pagers all treat 5xx as a problem and 4xx as
  the caller's business. The service now looks healthy while telling customers their payments do not
  exist.</p>

  <h3>Why nothing stopped it</h3>

  <pre data-lang="console" data-title="05-production.cs"><code>   application startup       : SUCCEEDED
   GET /health/live          : 200
   GET /health/ready         : 200
   GET /payments/1001        : 500</code></pre>

  <p><strong>The application is broken and every signal says it is fine.</strong> Routes are not
  validated at startup, so a rolling deploy replaces every healthy pod with a broken one, one at a time,
  with every probe passing throughout.</p>

  <h3>The whole contract in one file</h3>

  <pre data-lang="csharp" data-net="10" data-title="07-minimal-example.cs"><code>// 07-minimal-example.cs — One routing setup applying every decision in this
// module, exercised end to end.
//
// Run:  dotnet run 07-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and generated URL here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// A NAMED custom constraint, rather than a regex repeated in templates. The
// name says what is meant; a regex says how it is spelled.
builder.Services.Configure&lt;RouteOptions&gt;(options =&gt;
    options.ConstraintMap["paymentid"] = typeof(PaymentIdConstraint));

var app = builder.Build();

// The application is mounted under /ledger by the ingress. Every generated URL
// must carry that prefix; every hand-built string will not.
app.UsePathBase("/ledger");

// EXPLICIT UseRouting, and it is load-bearing. Measured below: with a
// UsePathBase and a MapFallback but NO explicit UseRouting, the fallback
// swallows every request - including ones with a perfectly good literal route.
// Adding this line fixes it.
app.UseRouting();

// ===========================================================================
// Public, and outside every group so that nothing is applied to it by
// accident. Being explicit about what is public is the point of the structure.
// ===========================================================================
app.MapGet("/health", () =&gt; Results.Ok(new { status = "healthy" }));

// ===========================================================================
// One group per version. The prefix, the tag and the API-key filter are
// declared once, so an endpoint added later cannot forget them.
//
// A middleware guarding "/v1/payments" by string comparison would break
// silently the day somebody adds /v1/payment-methods. A group cannot.
// ===========================================================================
var v1 = app.MapGroup("/v1")
    .AddEndpointFilter(async (context, next) =&gt;
    {
        string? key = context.HttpContext.Request.Headers["X-Api-Key"].FirstOrDefault();

        return string.IsNullOrEmpty(key)
            ? Results.Json(new { error = "api key required" }, statusCode: 401)
            : await next(context);
    });

var payments = v1.MapGroup("/payments").WithTags("payments");

// ---------------------------------------------------------------------------
// Lookup by id. Constrained to the shapes actually issued - numeric for
// anything before 2024, PAY-nnnn since - rather than to the shape assumed.
// ---------------------------------------------------------------------------
payments.MapGet("/{id:paymentid}", (string id) =&gt; Results.Ok(new { id, source = "id" }))
    .WithName("GetPayment");

// ---------------------------------------------------------------------------
// Lookup by gateway reference, under a LITERAL segment. That is stronger than
// relying on constraints alone to keep two parameter routes apart, and it is
// the decision that prevents the ambiguity incident in 05-production.cs.
// ---------------------------------------------------------------------------
payments.MapGet("/by-reference/{reference}",
    (string reference) =&gt; Results.Ok(new { reference, source = "reference" }));

// ---------------------------------------------------------------------------
// A literal beats a parameter, so this coexists with /{id:paymentid} without
// any constraint gymnastics.
// ---------------------------------------------------------------------------
payments.MapGet("/summary", () =&gt; Results.Ok(new { total = 4 }));

// ---------------------------------------------------------------------------
// Creation. The Location header is GENERATED from the named route with the
// context passed, so it carries the /ledger prefix and any escaping.
// ---------------------------------------------------------------------------
payments.MapPost("/", (LinkGenerator links, HttpContext context) =&gt;
{
    string id = "PAY-0042";
    string? location = links.GetPathByName(context, "GetPayment", new { id });

    // Generation returns null for a wrong name, a missing parameter, or a
    // value failing a constraint - with no exception and no log. Treat it as
    // the coding error it is rather than letting a 201 ship with no Location.
    if (location is null)
    {
        return Results.Problem("could not generate a location for the new payment");
    }

    return Results.Created(location, new { id });
});

// ---------------------------------------------------------------------------
// An unconstrained route that VALIDATES, for the case where the caller
// deserves to know what was wrong. A constraint here would answer 404.
// ---------------------------------------------------------------------------
payments.MapGet("/page/{n}", (string n) =&gt;
{
    if (!int.TryParse(n, out int page))
    {
        return Results.BadRequest(new { error = "page must be a whole number", got = n });
    }

    return page is &lt; 1 or &gt; 100
        ? Results.UnprocessableEntity(new { error = "page must be 1-100", got = page })
        : Results.Ok(new { page });
});

// ---------------------------------------------------------------------------
// A catch-all fallback, for a friendlier 404 than the empty default. It is
// registered at the lowest possible order, so it loses to every other route -
// PROVIDED routing has been placed correctly. See the warning printed below.
// ---------------------------------------------------------------------------
app.MapFallback((HttpContext context) =&gt;
    Results.NotFound(new { error = "no such endpoint", path = context.Request.Path.Value }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("A routing setup applying every decision in this module");
Console.WriteLine();
Console.WriteLine("   request                                       status   what it shows");
Console.WriteLine("   -------                                       ------   -------------");

await Show(http, "/ledger/health", false, "public, outside every group");
await Show(http, "/ledger/v1/payments/1001", false, "401 - the group filter");
await Show(http, "/ledger/v1/payments/1001", true, "legacy numeric id");
await Show(http, "/ledger/v1/payments/PAY-0001", true, "current id format");
await Show(http, "/ledger/v1/payments/summary", true, "literal beats the parameter");
await Show(http, "/ledger/v1/payments/by-reference/GW-9", true, "literal segment keeps it distinct");
await Show(http, "/ledger/v1/payments/nonsense", true, "404 - constraint did not match");
await Show(http, "/ledger/v1/payments/page/abc", true, "400 - validated, with a reason");
await Show(http, "/ledger/v1/payments/page/500", true, "422 - validated, with a reason");
await Show(http, "/ledger/no-such-thing", false, "the fallback");

using var create = new HttpRequestMessage(HttpMethod.Post, "/ledger/v1/payments");
create.Headers.TryAddWithoutValidation("X-Api-Key", "k");
using HttpResponseMessage created = await http.SendAsync(create);

Console.WriteLine($"   POST /ledger/v1/payments                         " +
    $"{(int)created.StatusCode}   Location: {created.Headers.Location}");

Console.WriteLine();
Console.WriteLine($"   constraint checks run in total: {PaymentIdConstraint.Checks}");
Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - constraints chosen from the shapes the DATA actually has");
Console.WriteLine("     - a NAMED custom constraint instead of a regex in the template");
Console.WriteLine("     - two lookup routes kept apart by a LITERAL segment, not by luck");
Console.WriteLine("     - a group per version carrying prefix, tags and the auth filter once");
Console.WriteLine("     - /health outside every group, so nothing applies to it by accident");
Console.WriteLine("     - validation in the handler where the caller deserves a reason;");
Console.WriteLine("       a constraint where a 404 is an acceptable answer");
Console.WriteLine("     - Location GENERATED from a named route, with the context passed,");
Console.WriteLine("       so it carries the PathBase");
Console.WriteLine("     - a null from link generation treated as a bug, not ignored");
Console.WriteLine("     - {**rest} for a value that goes back into a URL");
Console.WriteLine();
Console.WriteLine("   ONE MEASURED HAZARD, found while writing this file.");
Console.WriteLine();
Console.WriteLine("   A UsePathBase and a MapFallback together, WITHOUT an explicit");
Console.WriteLine("   UseRouting, make the fallback swallow every request. Four");
Console.WriteLine("   configurations, all requesting /ledger/health against a literal");
Console.WriteLine("   /health route:");
Console.WriteLine();
Console.WriteLine("     PathBase, no fallback, no UseRouting        -&gt; 200 healthy");
Console.WriteLine("     PathBase, fallback,    no UseRouting        -&gt; 200 FALLBACK");
Console.WriteLine("     PathBase, no fallback, explicit UseRouting  -&gt; 200 healthy");
Console.WriteLine("     PathBase, fallback,    explicit UseRouting  -&gt; 200 healthy");
Console.WriteLine();
Console.WriteLine("   Only the second row is wrong, and it is wrong for every route in the");
Console.WriteLine("   application at once - a 200 carrying the fallback body, so it does not");
Console.WriteLine("   even register as an error anywhere.");
Console.WriteLine();
Console.WriteLine("   It needs BOTH ingredients, which is why it survives local testing:");
Console.WriteLine("   there is usually no PathBase on a developer machine, and the fallback");
Console.WriteLine("   behaves perfectly without one.");
Console.WriteLine();
Console.WriteLine("   The fix is the explicit app.UseRouting() above, placed after");
Console.WriteLine("   UsePathBase. If you use a fallback and a path base, put routing between");
Console.WriteLine("   them rather than relying on where the framework would have inserted it.");
Console.WriteLine();
Console.WriteLine("   And the one thing that belongs in the project file rather than here:");
Console.WriteLine();
Console.WriteLine("     &lt;WarningsAsErrors&gt;ASP0022&lt;/WarningsAsErrors&gt;");
Console.WriteLine();
Console.WriteLine("   Routes are not validated at startup. That analyzer is the only layer");
Console.WriteLine("   that catches an ambiguous pair before a customer does.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Show(HttpClient http, string path, bool key, string note)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    if (key)
    {
        request.Headers.TryAddWithoutValidation("X-Api-Key", "k");
    }

    using HttpResponseMessage response = await http.SendAsync(request);
    Console.WriteLine($"   GET {path,-42}{(int)response.StatusCode,6}   {note}");
}

// ---------------------------------------------------------------------------
// Cheap, pure, and it cannot throw. A constraint runs on every candidate
// request, before authentication - so it must never touch a database or call
// a service.
sealed class PaymentIdConstraint : IRouteConstraint
{
    private static int _checks;

    public static int Checks =&gt; Volatile.Read(ref _checks);

    public bool Match(HttpContext? httpContext, IRouter? route, string routeKey,
        RouteValueDictionary values, RouteDirection routeDirection)
    {
        Interlocked.Increment(ref _checks);

        if (!values.TryGetValue(routeKey, out object? raw) || raw is null)
        {
            return false;
        }

        string value = raw.ToString() ?? string.Empty;

        // Legacy numeric, or PAY- followed by exactly four digits.
        if (value.Length &gt; 0 &amp;&amp; value.All(char.IsAsciiDigit))
        {
            return true;
        }

        return value.Length == 8
            &amp;&amp; value.StartsWith("PAY-", StringComparison.Ordinal)
            &amp;&amp; value.AsSpan(4).ContainsAnyExcept(SearchValuesCache.Digits) == false;
    }
}

static class SearchValuesCache
{
    public static readonly System.Buffers.SearchValues&lt;char&gt; Digits =
        System.Buffers.SearchValues.Create("0123456789");
}</code></pre>

  <pre data-lang="console" data-title="07-minimal-example.cs output"><code>   request                                       status   what it shows
   -------                                       ------   -------------
   GET /ledger/health                               200   public, outside every group
   GET /ledger/v1/payments/1001                     401   401 - the group filter
   GET /ledger/v1/payments/1001                     200   legacy numeric id
   GET /ledger/v1/payments/PAY-0001                 200   current id format
   GET /ledger/v1/payments/summary                  200   literal beats the parameter
   GET /ledger/v1/payments/by-reference/GW-9        200   literal segment keeps it distinct
   GET /ledger/v1/payments/nonsense                 404   404 - constraint did not match
   GET /ledger/v1/payments/page/abc                 400   400 - validated, with a reason
   GET /ledger/v1/payments/page/500                 422   422 - validated, with a reason
   GET /ledger/no-such-thing                        404   the fallback
   POST /ledger/v1/payments                         201   Location: /ledger/v1/payments/PAY-0042</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>One hazard found while writing that file. <strong>A <code>UsePathBase</code> and a
    <code>MapFallback</code> together, without an explicit <code>UseRouting</code>, make the fallback
    swallow every request.</strong> Four configurations, all requesting <code>/ledger/health</code>
    against a literal <code>/health</code> route:</p>
    <pre data-lang="console" data-title="Measured"><code>   PathBase, no fallback, no UseRouting        -&gt; 200 healthy
   PathBase, fallback,    no UseRouting        -&gt; 200 FALLBACK
   PathBase, no fallback, explicit UseRouting  -&gt; 200 healthy
   PathBase, fallback,    explicit UseRouting  -&gt; 200 healthy</code></pre>
    <p>Only the second row is wrong, and it is wrong for <em>every</em> route in the application at once
    — as a <strong>200 carrying the fallback body</strong>, so it does not register as an error
    anywhere.</p>
    <p>It needs both ingredients, which is why it survives local testing: there is usually no
    <code>PathBase</code> on a developer machine, and the fallback behaves perfectly without one. The
    fix is an explicit <code>app.UseRouting()</code> placed after <code>UsePathBase</code>.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger handles about 400 payment lookups an hour.</p>
    <p><strong>v2 ran for 18 minutes</strong> before being rolled back: roughly 120 lookups, all 500,
    every one a merchant unable to see a payment. It was caught quickly because 500s page somebody.</p>
    <p><strong>v3 ran for two days.</strong> At roughly 70% of ids being <code>PAY-nnnn</code>, that is
    about <strong>13,000 lookups answered "404, no such payment" for payments that exist</strong> — and
    nothing paged anybody, because a 404 is the caller's problem by convention.</p>
    <p>The fix that stopped the alerts caused a hundred times more damage than the incident, and did it
    quietly. That is worth more than the routing detail.</p>
    <p>Three controls would each have caught it, in increasing order of cost: <code>ASP0022</code> as an
    error (one line in the project file); a test that requests one <em>real</em> identifier of each shape
    the system issues and asserts 200 (fails for both v2 and v3); and an alert on <strong>404
    rate</strong> rather than only 5xx, because a step change in 404s after a deploy is a routing change
    and nothing else in your monitoring will say so.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Two routes with the same shape</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - one route, twice"><code>app.MapGet("/payments/{id}", (string id) =&gt; Lookup(id));
app.MapGet("/payments/{reference}", (string reference) =&gt; LookupByRef(reference));</code></pre>

  <p>Symptom: 500 on the affected paths, deploy green, health checks passing. Cause: the parameter name
  is not part of the match. Fix: a literal segment, or constraints that genuinely differ.</p>

  <h3>A constraint chosen from the wrong sample</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong when ids are not all numeric"><code>app.MapGet("/payments/{id:int}", (int id) =&gt; Lookup(id));</code></pre>

  <p>Symptom: 404 for resources that exist, invisible to alerting. Cause: <code>:int</code> was chosen
  because the ids in the ticket were numeric. Fix: constrain to the shapes your data actually has.</p>

  <h3>A constraint used as validation</h3>

  <p>Symptom: a client asks which field was wrong and there is no answer to give — the response was a
  404 with an empty body. Fix: take the parameter unconstrained and validate in the handler, where 400
  and 422 are available.</p>

  <h3>A hand-built URL</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>return Results.Created($"/v1/payments/{id}", payment);</code></pre>

  <p>Symptom: correct locally, 404 behind an ingress. Cause: the missing <code>PathBase</code>. Fix:
  <code>links.GetPathByName(context, "GetPayment", new { id })</code> — and pass the context.</p>

  <h3>An ignored null from link generation</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>string? location = links.GetPathByName("GetPayment", new { id });
return Results.Created(location!, payment);</code></pre>

  <p>Symptom: a 201 with no <code>Location</code> header. Cause: a wrong name, a missing parameter, or a
  value failing a constraint — all of which return null silently. Fix: treat null as a bug.</p>

  <h3>A database call inside a constraint</h3>

  <p>Symptom: query load from unauthenticated traffic, and 500s on paths that were never going to match.
  Cause: a constraint runs before authentication, on every candidate request, and must not throw. Fix:
  the existence check belongs in the handler.</p>

  <h3>A fallback plus a path base, with no explicit routing</h3>

  <p>Symptom: every route in the application returns the fallback body, as a 200. Cause: measured above
  — it needs both ingredients, so it survives local testing. Fix:
  <code>app.UseRouting()</code> after <code>app.UsePathBase(...)</code>.</p>

  <h3>A single-star catch-all whose value is put back into a URL</h3>

  <p>Symptom: generated links have <code>%2F</code> where slashes should be, and downstream systems stop
  treating the value as a path. Fix: <code>{**path}</code>.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>Routing failures are silent by construction — a 404 carries no reason and an ambiguous match only
    affects some paths. So the first move is to <strong>ask the application which endpoint it
    selected</strong>, from a middleware placed after routing:</p>
    <pre data-lang="csharp" data-net="10" data-title="Ask which endpoint was selected"><code>app.Use(async (context, next) =&gt;
{
    var endpoint = context.GetEndpoint();
    logger.LogInformation("{Path} -&gt; {Endpoint}",
        context.Request.Path, endpoint?.DisplayName ?? "(no match)");
    await next();
});</code></pre>
    <p><code>(no match)</code> tells you routing rejected the path — almost always a constraint or a
    segment count. A named endpoint you did not expect tells you precedence chose differently from your
    mental model.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Look at</th><th>What you are looking for</th></tr></thead>
      <tbody>
        <tr>
          <td>404 for a resource that exists</td>
          <td>Every constraint on the route</td>
          <td>A value that does not fit — a GUID where <code>:int</code> is expected, an id too long for <code>int</code>, a date format</td>
        </tr>
        <tr>
          <td>404 for a path that looks right</td>
          <td>The segment count</td>
          <td>A parameter matching one segment where the value contains a slash</td>
        </tr>
        <tr>
          <td>500 on some paths, deploy green</td>
          <td>The exception type</td>
          <td><code>AmbiguousMatchException</code>. Its message names both routes</td>
        </tr>
        <tr>
          <td>A step change in 404 rate after a deploy</td>
          <td>Route templates changed in that deploy</td>
          <td>A tightened constraint. Nothing else in monitoring will point here</td>
        </tr>
        <tr>
          <td>Every route returns the fallback</td>
          <td><code>UsePathBase</code> and <code>MapFallback</code> together</td>
          <td>A missing explicit <code>UseRouting</code> between them</td>
        </tr>
        <tr>
          <td>201 with no <code>Location</code></td>
          <td>The link generation call</td>
          <td>A null passed through <code>location!</code></td>
        </tr>
        <tr>
          <td>Links correct locally, 404 in production</td>
          <td><code>Request.PathBase</code></td>
          <td>A hand-built URL, or a generator call without the context</td>
        </tr>
        <tr>
          <td>A group's filter not applying to a new endpoint</td>
          <td>Whether it was added to the group or to <code>app</code></td>
          <td>An endpoint registered on the wrong builder</td>
        </tr>
        <tr>
          <td>An endpoint filter never runs</td>
          <td>Whether the endpoint was matched at all</td>
          <td>Filters run only for the selected endpoint — a 404 means no filter ran</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Routes are matched in registration order, so I can put the specific one first."</em></p>
    <p>Registration order is irrelevant — measured above, identical results either way. Routing builds a
    tree and picks the most specific match. Code that relies on ordering is relying on something that is
    not true.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"A constraint validates the input."</em></p>
    <p>It decides whether the route <strong>matches</strong>. A failing value produces a 404 with an
    empty body, indistinguishable from a path that was never registered. Validation lives in the handler,
    where 400 and 422 exist.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"/payments/{id} and /payments/{reference} are different routes — the names are
    different."</em></p>
    <p>The parameter name is not part of the match. They are one route declared twice, and every request
    to that shape is a 500.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Adding a catch-all route is risky — it might shadow everything."</em></p>
    <p>A catch-all is the <em>least</em> specific thing there is, so it loses to every other route. It is
    a safe fallback. The one hazard is the <code>MapFallback</code>-plus-<code>UsePathBase</code>
    interaction measured above, and that is about where routing sits rather than about specificity.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"An ambiguous route would fail at startup, so if it deployed it must be fine."</em></p>
    <p>Nothing validates routes at startup. The build warns (<code>ASP0022</code>), the request fails,
    and startup says nothing at all — so a rolling deploy replaces every healthy pod with a broken
    one.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Building the URL with string interpolation is simpler and does the same thing."</em></p>
    <p>It skips escaping, skips <code>PathBase</code>, and duplicates the template. Three of the four
    escaping cases above break silently, and the <code>PathBase</code> case works on your machine and
    404s in production.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"A route constraint is a good place to check the resource exists."</em></p>
    <p>Constraints run before authentication, on every candidate request, and must not throw. A database
    call there is query load an unauthenticated stranger can generate, and a thrown exception turns
    non-matching requests into 500s. Existence is a handler's question.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <p>Routing decides which code runs, and almost every way it can be wrong is invisible from the place
  you would normally look.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Decision</th><th>Cost to get right</th><th>Cost of getting it wrong</th></tr></thead>
      <tbody>
        <tr><td><code>ASP0022</code> as an error</td><td>One line in the project file</td><td>An ambiguous route deploys green and 500s a fraction of traffic</td></tr>
        <tr><td>A literal segment to separate two lookups</td><td>Six characters</td><td>The same, and it recurs every time someone adds a route</td></tr>
        <tr><td>Constrain to the shapes the data has</td><td>Reading the data first</td><td>~13,000 lookups over two days answered "no such payment", with no alert</td></tr>
        <tr><td>Validate in the handler where a reason is owed</td><td>Four lines</td><td>Callers cannot tell a malformed id from a missing resource</td></tr>
        <tr><td>Generate links, with the context</td><td>One call</td><td>Correct locally, 404 behind an ingress; broken escaping in three cases out of four</td></tr>
        <tr><td>Treat a generation null as a bug</td><td>An <code>if</code></td><td>201 responses with no <code>Location</code> header</td></tr>
        <tr><td>Alert on 404 rate</td><td>One dashboard panel</td><td>Routing regressions outlive 5xx ones by orders of magnitude</td></tr>
      </tbody>
    </table>
  </div>

  <p>Two things generalise past routing.</p>

  <p><strong>A 404 is not a safe default.</strong> It is the correct answer to "nothing matched" and it
  is also, by convention, nobody's emergency. Every alerting system, circuit breaker and error budget
  treats 4xx as the caller's business. So a mistake that produces 404s survives far longer than one that
  produces 500s — which means the honest fix for the opening incident was never "make the 500s stop", it
  was "make the right requests match".</p>

  <p><strong>Constraints and validation answer different questions</strong>, and confusing them shows up
  as a caller who cannot be told what they did wrong. Matching decides <em>which code runs</em>;
  validation decides <em>whether the values are acceptable</em>. Only the second one can produce a
  message, because only the second one has a handler to produce it from.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>These four routes are registered in this order. Which one handles each request?</p>
    <pre data-lang="csharp" data-net="10" data-title="Registered in this order"><code>app.MapGet("/payments/{*rest}",  () =&gt; "catch-all");
app.MapGet("/payments/{id}",     () =&gt; "parameter");
app.MapGet("/payments/{id:int}", () =&gt; "constrained parameter");
app.MapGet("/payments/summary",  () =&gt; "literal");</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   request                  matched
   -------                  -------
   /payments/summary        literal
   /payments/42             constrained parameter
   /payments/PAY-1          parameter
   /payments/a/b/c          catch-all</code></pre>
        <p><strong>More specific wins, and registration order is irrelevant:</strong> a literal segment,
        then a constrained parameter, then a plain parameter, then a catch-all — compared segment by
        segment from the left.</p>
        <p>Routing is not a list scanned top to bottom. It builds a tree of templates and picks the most
        specific match.</p>
        <p>Two consequences: you can group routes for readability without worrying about shadowing, and a
        catch-all is a <em>safe</em> fallback because it loses to everything.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Two teams add these in different files. What happens, and when do you find out?</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="One route, twice"><code>app.MapGet("/orders/{id}",        (string id) =&gt; $"by id {id}");
app.MapGet("/orders/{reference}", (string reference) =&gt; $"by ref {reference}");</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   application startup : SUCCEEDED
   GET /health         : 200
   GET /orders/42      : 500</code></pre>
        <p><strong>The parameter name is not part of the match.</strong> Both templates are "literal,
        parameter" — identical shape — so they are the same route declared twice and the router cannot
        choose.</p>
        <p>You find out at <strong>request time</strong>. Three layers had a chance:</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Layer</th><th>What happens</th></tr></thead>
            <tbody>
              <tr><td>Build time</td><td><code>ASP0022</code> warns, naming both routes — but it is a warning, so the build succeeds and it ships</td></tr>
              <tr><td>Startup</td><td>Nothing. Routes are not validated here</td></tr>
              <tr><td>Request time</td><td><code>AmbiguousMatchException</code> as a 500, on the affected paths only</td></tr>
            </tbody>
          </table>
        </div>
        <p>So the deploy succeeds, health checks stay green, and a rolling update replaces every healthy
        pod with a broken one.</p>
        <p>Turn <code>ASP0022</code> into an error — it is the only layer that catches this before a
        customer does.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>A client reports that <code>/pages/abc</code> returns 404 with an empty body, and wants to know
    which field was wrong. The route is <code>/pages/{n:int:range(1,100)}</code>. What do you tell them,
    and what do you change?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   request                  status   body
   -------                  ------   ----
   /constrained/50             200   {"page":50}
   /constrained/abc            404   (empty)
   /constrained/500            404   (empty)
   /validated/50               200   {"page":50}
   /validated/abc              400   {"error":"page must be a whole number","got":"abc"}
   /validated/500              422   {"error":"page must be 1-100","got":500}</code></pre>
        <p><strong>What to tell them:</strong> the 404 is correct, because a constraint is not validation.
        Constraints run during route <em>matching</em>, before any handler is chosen. A value that fails
        one means this route does not match, and if nothing else matches the answer is "no such
        resource". From outside, <code>/pages/abc</code> is indistinguishable from a path that was never
        registered.</p>
        <p><strong>What to change,</strong> if the caller deserves an explanation: take the parameter
        unconstrained and validate in the handler, where you can return 400 for malformed and 422 for
        out-of-range, with a body.</p>
        <p>The two are not alternatives, and the usual answer is both: keep the <em>type</em> constraint
        for matching and move the <em>range</em> check into the handler for the message. A range
        constraint is a reasonable guard and a poor error message.</p>
        <p>The failure mode to recognise anywhere: <strong>a client reports 404 for a resource that
        exists.</strong> Usually a constraint rejecting the value.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p><code>/payments/{id}</code> and <code>/payments/{reference}</code> are returning 500. Under
    pressure, someone constrains the first to <code>:int</code>. Ids in production are numeric before
    2024 and <code>PAY-nnnn</code> since. What happens, and why is it worse?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   version                        200   404   500
   -------                        ---   ---   ---
   ambiguous (the incident)         0     0     7
   'fixed' with :int                4     3     0
   constrained to real shapes       7     0     0</code></pre>
        <p><strong>The fix 404s every <code>PAY-nnnn</code> identifier</strong> — three of these seven,
        and in production the majority, because every payment created since 2024 has that shape.</p>
        <p><strong>It is worse than the incident because a 500 is an alert and a 404 is not.</strong>
        Error-rate dashboards, circuit breakers and pagers all treat 5xx as a problem and 4xx as the
        caller's business. The service now looks healthy while telling customers their payments do not
        exist.</p>
        <p>At 400 lookups an hour, the 500s were caught in 18 minutes — about 120 failures. The 404s ran
        for two days: roughly 13,000 lookups answered "no such payment" for payments that exist, with
        nothing paging anybody.</p>
        <p><strong>The correct fix</strong> constrains each route to the shape it actually handles, so
        the two templates differ <em>and</em> every real identifier still matches one of them.</p>
        <p>The rule underneath: <strong>constrain to the shape your data has, not the shape you
        assume.</strong> <code>:int</code> was chosen because the ids in the ticket were numeric, and
        nobody checked what proportion of live ids were.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>This <code>Location</code> header is correct locally and 404s in production, which runs behind an
    ingress at <code>/ledger</code>. Diagnose it, fix it, and say what else the fix buys you.</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>return Results.Created($"/v1/payments/{id}", payment);</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   hand-built     : /v1/payments/PAY-1
   with context   : /ledger/v1/payments/PAY-1
   no context     : /v1/payments/PAY-1

   values needing escaping:
     a b   hand-built /items/a b     generated /items/a%20b
     a&amp;b   hand-built /items/a&amp;b     generated /items/a%26b
     a/b   hand-built /items/a/b     generated /items/a%2Fb

   a name that does not exist : null</code></pre>
        <p><strong>The diagnosis:</strong> the hand-built string is missing the <code>PathBase</code>. It
        works locally, where there is none, and 404s behind the ingress.</p>
        <p><strong>The fix:</strong></p>
        <pre data-lang="csharp" data-net="10" data-title="Right"><code>string? location = links.GetPathByName(context, "GetPayment", new { id });
return Results.Created(location!, payment);</code></pre>
        <p><strong>Passing the context is what supplies the <code>PathBase</code></strong> — the
        context-free overload produces the same wrong answer as the string. Those overloads are for
        background code, which must be told the scheme, host and base from configuration because nothing
        can infer them.</p>
        <p><strong>What else it buys:</strong></p>
        <ul>
          <li><strong>Escaping.</strong> Every value in that table would produce a broken URL by
          concatenation, and three of them silently: the ampersand truncates at a query boundary, the
          space breaks the request line, and the slash invents a segment.</li>
          <li><strong>One place to change.</strong> Moving <code>/v1</code> to <code>/v2</code> updates
          every <code>Location</code> header, link and redirect with no other edit.</li>
          <li><strong>Values that are not route parameters</strong> become the query string, so there is
          no concatenation anywhere.</li>
        </ul>
        <p><strong>The cost, and it is real:</strong> every failure returns <code>null</code> — a wrong
        name, a missing parameter, a value failing a constraint — with no exception and no log. Passed to
        <code>Results.Created</code> that is a 201 with no <code>Location</code> header: a response that
        looks successful and is missing the one thing the client needed.</p>
        <p>Treat null as a bug, and add a test that generates a URL for every named route.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Design the routes for a versioned payments API: <code>/v1</code> and <code>/v2</code> both live;
    every payments endpoint requires an API key and <code>/health</code> does not; payments are
    addressable by id (numeric or <code>PAY-nnnn</code>) and by gateway reference (<code>GW-...</code>);
    creation returns a <code>Location</code> header that is correct behind an ingress at
    <code>/ledger</code>.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="06-exercises.cs"><code>   request                                      status   note
   -------                                      ------   ----
   GET /ledger/health                             200   public
   GET /ledger/v1/payments/1001                   401   no key
   GET /ledger/v1/payments/1001                   200   legacy numeric id
   GET /ledger/v1/payments/PAY-0001               200   current id format
   GET /ledger/v2/payments/PAY-0001               200   same shape under v2
   GET /ledger/v1/payments/by-reference/GW-abc    200   gateway reference
   GET /ledger/v1/payments/nonsense               404   matches nothing
   POST /ledger/v1/payments                       201   Location: /ledger/v1/payments/PAY-0042</code></pre>
        <ol>
          <li><strong>A group per version</strong> carries the prefix, the tag and the API-key filter.
          Declared once; an endpoint added later cannot forget it. A middleware checking the path by
          string comparison breaks the day somebody adds <code>/v1/payment-methods</code>.</li>
          <li><strong><code>/health</code> is outside every group</strong>, so nothing applies to it.
          Being explicit about what is public is the point of the structure.</li>
          <li><strong>Two lookup routes with different shapes.</strong> The id route is constrained to
          the shapes actually issued; the reference route sits under a <em>literal</em> segment, which is
          stronger than relying on constraints alone to keep them apart — and it is the decision that
          would have prevented the opening incident.</li>
          <li><strong>Named routes and generated links</strong>, so the <code>Location</code> header
          carries the <code>/ledger</code> prefix. The name includes the version: two routes cannot share
          a name, and generation would return null.</li>
        </ol>
        <p><strong>What this design does not do:</strong> it does not give a caller sending a malformed
        id a useful error. <code>/payments/nonsense</code> is a 404 with no body. If that matters, take
        the id unconstrained and validate in the handler — accepting that the two lookup routes then need
        the literal segment to stay distinct, which is why it is there.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>How many segments does <code>{id}</code> match?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Exactly one, never a slash. <code>/payments/a/b</code> does not
        match <code>/payments/{id}</code>.</p></div></details></li>

    <li><p>Does registration order decide which route wins?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. The most specific match wins, compared segment by segment:
        literal, then constrained parameter, then plain parameter, then catch-all.</p></div></details></li>

    <li><p>Are <code>/orders/{id}</code> and <code>/orders/{reference}</code> different routes?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No — the parameter name is not part of the match. They are one
        route declared twice, and every request to that shape is a 500.</p></div></details></li>

    <li><p>When do you find out about an ambiguous route?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>At <em>request</em> time. The build warns (<code>ASP0022</code>),
        startup says nothing at all, and the request throws
        <code>AmbiguousMatchException</code>.</p></div></details></li>

    <li><p>What status does a failed constraint produce, and why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><strong>404</strong>, with no body. A constraint decides whether the
        route <em>matches</em>; if nothing matches, the resource does not exist as far as the application
        is concerned.</p></div></details></li>

    <li><p>Where does validation belong, and why not in a constraint?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>In the handler, where 400 and 422 and a body naming the field are
        available. A constraint has no handler to produce a message from.</p></div></details></li>

    <li><p>Name two things a route constraint must never do.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Touch a database or call a service — it runs before authentication
        on every candidate request — and throw, which turns non-matching requests into
        500s.</p></div></details></li>

    <li><p>What three things does <code>MapGroup</code> give you?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A path prefix, shared metadata, and shared filters. Unlike
        <code>app.Map</code> it does not move anything into <code>PathBase</code>.</p></div></details></li>

    <li><p>Where does an endpoint filter run relative to middleware?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Inside the endpoint — the innermost layer, after every middleware.
        It runs only when that endpoint was selected, so a 404 means no filter
        ran.</p></div></details></li>

    <li><p>Why does authorisation have to come after routing?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Because routing is what attaches the endpoint — and therefore its
        authorisation policy metadata — to the context. Before routing there is nothing to
        read.</p></div></details></li>

    <li><p>What does link generation return when the route name is wrong?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>null</code>, with no exception and no log — as it does for a
        missing parameter and for a value failing a constraint. Passed to
        <code>Results.Created</code> that is a 201 with no <code>Location</code>
        header.</p></div></details></li>

    <li><p>What supplies the <code>PathBase</code> in a generated URL?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Passing the <code>HttpContext</code> to the generator. Without it
        you get the same wrong answer as a hand-built string — correct locally, 404 behind an
        ingress.</p></div></details></li>

    <li><p>Why is a routing mistake that produces 404s more dangerous than one that produces 500s?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Because 4xx is the caller's business by convention, so nothing
        alerts on it. In the incident above the 500s were caught in 18 minutes and the 404s ran for two
        days.</p></div></details></li>
  </ol>
</section>
`
});
