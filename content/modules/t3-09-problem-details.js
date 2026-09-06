CSPREP.module({
  id: "t3-09-problem-details",
  minutes: 55,
  updated: "2026-09-04",
  summary: "A partner's client retries an empty 500 and charges a card twice, because a permanent condition was reported as a transient one. RFC 9457 problem documents, exception handlers that translate domain exceptions into the status they mean, and the two findings that surprise people: the developer exception page returns its stack trace as JSON to a client that asks for JSON, and an IExceptionHandler returning true removes the exception from your logs entirely.",
  terms: ["ProblemDetails", "RFC 9457", "problem+json", "error contract", "IExceptionHandler",
    "UseExceptionHandler", "UseStatusCodePages", "CustomizeProblemDetails", "extension member",
    "correlation id", "traceId", "Activity", "TraceIdentifier", "developer exception page",
    "information disclosure", "domain exception", "media type", "instance"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A payments API. A partner integration has been live for a year. At 09:14 the partner's support
  queue starts filling with customers saying their card was charged twice.</p>

  <p>The partner has logs. For every failed attempt their client recorded an HTTP status and a response
  body, and this is the entire contents of that record:</p>

  <pre data-lang="console" data-title="what the partner could see"><code>500  (empty)</code></pre>

  <p>That is the evidence available to the person reporting the problem. The first ninety minutes of the
  incident went into establishing whether the requests had reached the API at all.</p>

  <p>What was happening: a payment that had already been captured was being captured again, the gateway
  client threw, the exception reached the web server, and the caller got an empty 500. A 500 means
  <em>something went wrong on the server</em>, which is the definition of a condition that might succeed
  next time — so the partner's client did the correct thing with a 500 and <strong>retried</strong>.</p>

  <p>Two failures compounded here, and only one of them is about error handling. The double capture was
  possible because the operation was not idempotent. But the second charge happened because a permanent
  condition was reported in a way that was indistinguishable from a transient one.</p>

  <p><strong>The status code is an instruction to a machine.</strong> Returning 500 for something that
  will never succeed does not merely fail to inform; it actively tells every well-behaved client to try
  again.</p>

  <p>This module is about the contract that would have made that response a 409 with a document naming
  the problem, and an identifier that turned the partner's first message into a direct link to the
  exception.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every status code, content type, field name and log line in this module was produced by running
    the programs shown, on .NET 10, and pasted in unedited.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What an error contract is</h2>

  <p class="define"><span class="define__term">Status code</span> The three-digit number on the first
  line of an HTTP response. It tells the caller what category of thing happened: 200 succeeded, 404 not
  found, 409 conflict, 500 server error. It is a small fixed vocabulary, so it can say what kind of
  failure occurred and nothing about the specifics.</p>

  <p class="define"><span class="define__term">Response body</span> The bytes after the headers. For a
  successful request this is the thing you asked for. For a failed one it is whatever the server chose
  to say, which by default is nothing at all.</p>

  <p class="define"><span class="define__term">Error contract</span> The promise your API makes about
  what a failure looks like: which status codes it uses, what shape the body has, which fields are
  always present. A contract is a promise made once and kept by every endpoint — not a decision made
  again at each one.</p>

  <p class="define"><span class="define__term">Problem document</span> A small JSON object describing
  one failure, standardised by <strong>RFC 9457</strong>. It has four defined fields —
  <code>type</code>, <code>title</code>, <code>status</code>, <code>detail</code> — plus
  <code>instance</code>, and permits any additional fields you want.</p>

  <p class="define"><span class="define__term">Media type</span> The label on a response saying what
  format the body is in, sent in the <code>Content-Type</code> header. <code>application/json</code>
  says "this is JSON". <code>application/problem+json</code> says "this is JSON, and specifically it is
  a problem document" — the <code>+json</code> suffix means a client that knows nothing about problem
  documents can still parse it as JSON.</p>

  <p class="define"><span class="define__term">ProblemDetails</span> The .NET class representing a
  problem document, and <code>AddProblemDetails()</code> the one registration that teaches the framework
  to produce them.</p>

  <p>Here is the whole idea in one program. Three ways of failing, and a route that does not exist:</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — The same four failures, with and without an error contract.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The two lines. AddProblemDetails registers the writer; UseStatusCodePages is
// what invokes it for a response that has a status and no body.
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseStatusCodePages();

app.MapGet("/ok", () =&gt; Results.Ok(new { status = "fine" }));
app.MapGet("/missing", () =&gt; Results.NotFound());
app.MapGet("/forbidden", () =&gt; Results.StatusCode(403));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

foreach (string path in new[] { "/ok", "/missing", "/forbidden", "/no-such-route" })
{
    using HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();

    Console.WriteLine($"GET {path,-16} {(int)response.StatusCode}  " +
        $"{response.Content.Headers.ContentType?.MediaType ?? "(no type)"}");
    Console.WriteLine($"    {(body.Length == 0 ? "(empty body)" : body)}");
    Console.WriteLine();
}

Console.WriteLine("Every failure has the same shape, and it is a shape with a name:");
Console.WriteLine("RFC 9457, served as application/problem+json.");
Console.WriteLine();
Console.WriteLine("Remove UseStatusCodePages and all three failures return empty bodies.");

await app.StopAsync();</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>GET /ok              200  application/json
    {"status":"fine"}

GET /missing         404  application/problem+json
    {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"Not Found",
     "status":404,"traceId":"0HNOA1R3BMIRQ:00000002"}

GET /forbidden       403  application/problem+json
    {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.4","title":"Forbidden",
     "status":403,"traceId":"0HNOA1R3BMIRQ:00000003"}

GET /no-such-route   404  application/problem+json
    {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"Not Found",
     "status":404,"traceId":"0HNOA1R3BMIRQ:00000004"}</code></pre>

  <p>Two lines of setup, and every failure the app can produce — including the 404 from a route nobody
  wrote — comes back as the same kind of document with an identifier in it. Remove
  <code>UseStatusCodePages()</code> and all three failures return empty bodies while the success keeps
  working, which is exactly why nobody notices.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>A problem document is like the rejection slip a passport office hands back. The slip has a standard
  layout: a reference number, which office, which category of problem. Anyone who has seen one before
  can read the next one without being told how.</p>

  <p><strong>This is an analogy and it misleads in one specific way.</strong> A passport office writes
  the slip for a human who will read it. Your API writes it for a program that will branch on it, and
  the program cannot read English. That is why <code>type</code> and <code>status</code> matter more
  than the wording of <code>title</code>: they are the fields something can act on.</p>
</section>

<section id="what-leaks">
  <h2>What a failure returns when nobody has decided</h2>

  <p class="define"><span class="define__term">Developer exception page</span> Middleware that catches
  an exception and returns its full detail — message, type, stack trace, source lines — to whoever made
  the request. It exists so you can debug without switching to a terminal.</p>

  <p class="define"><span class="define__term">Information disclosure</span> Returning something the
  caller should not have been able to learn. A stack trace discloses your file paths, your class names,
  your library versions and the shape of your source tree.</p>

  <p>One endpoint that throws, with a message containing a connection string, under three
  configurations. Every request below sends <code>Accept: application/json</code>:</p>

  <pre data-lang="console" data-title="01-what-leaks.cs output"><code>   configuration                    status   content type                bytes
   -------------                    ------   ------------                -----
   Development, developer page         500   application/problem+json      899
   Production, nothing                 500   (none)                          0
   Production, exception handler       500   application/json              148

   what the body contained:

   configuration                    stack   exception   connection   file
                                    trace   type name   string       paths
   -------------                    -----   ---------   ----------   -----
   Development, developer page        YES         YES          YES     YES
   Production, nothing                 no          no           no      no
   Production, exception handler       no          no           no      no</code></pre>

  <p>The developer exception page returns everything: the message, the type name, the stack with file
  paths and line numbers. On your own machine that is exactly what you want. Reachable from outside, it
  is a disclosure of your source tree and — here — of a password.</p>

  <p>Its only guard is the environment name, which is a <strong>string from configuration</strong>:
  <code>ASPNETCORE_ENVIRONMENT</code>. Unset, the host defaults to Production and the page stays off, so
  the failure is never the default. It is a compose file, a Helm values file or a base image that sets
  Development and then gets copied somewhere that is not.</p>

  <p>That makes it a deployment fact rather than a code fact. <strong>Reading the source does not settle
  it; one request against a deployed endpoint that throws does.</strong></p>

  <h3>The page adapts to the caller</h3>

  <p>The prediction before running that program was that the developer page returns an HTML page, so an
  API client asking for JSON would get something harmless. Varying only the <code>Accept</code>
  header:</p>

  <pre data-lang="console" data-title="01-what-leaks.cs output"><code>   Accept                content type                bytes   secret in body
   ------                ------------                -----   --------------
   application/json      application/problem+json      899   YES
   text/html             text/html                   19480   YES
   */*                   application/problem+json      886   YES</code></pre>

  <p><strong>The prediction was wrong, and wrong in the dangerous direction.</strong> The page
  content-negotiates. A browser gets HTML; a client asking for JSON gets a problem document carrying the
  same message, type name and stack.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>"We only serve JSON from this service" is not a mitigation, and neither is "nobody points a
    browser at it". The only thing that keeps the developer exception page off is the environment name,
    and the only way to know its value in a given environment is to ask that environment.</p>
  </div>

  <p>The second row of the first table — Production with nothing configured — is safe rather than good.
  An empty 500 with no content type at all leaks nothing and tells the caller nothing: no identifier, no
  shape to parse, nothing to quote in a support ticket.</p>
</section>

<section id="the-envelope">
  <h2>The document, and the field that is easy to get wrong</h2>

  <p>Two exception handlers write what looks like the same document. The first is the version most
  people write, because it is shorter and the JSON it produces is correct:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - right shape, wrong label"><code>context.Response.StatusCode = 500;

await context.Response.WriteAsJsonAsync(new
{
    type = "https://tools.ietf.org/html/rfc9110#section-15.6.1",
    title = "An unexpected error occurred",
    status = 500,
    traceId = context.TraceIdentifier
}, cancellationToken);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right - the service writes it"><code>context.Response.StatusCode = 500;

return await problemDetails.TryWriteAsync(new ProblemDetailsContext
{
    HttpContext = context,
    ProblemDetails =
    {
        Type = "https://tools.ietf.org/html/rfc9110#section-15.6.1",
        Title = "An unexpected error occurred",
        Status = 500
    }
});</code></pre>

  <p>Measured, the difference is one header:</p>

  <pre data-lang="console" data-title="01-what-leaks.cs output"><code>   WriteAsJsonAsync, anonymous object
     content type   application/json
     body           {"type":"https://tools.ietf.org/html/rfc9110#section-15.6.1",
                     "title":"An unexpected error occurred","status":500,
                     "traceId":"0HNO9TTIAUPKT:00000001"}

   IProblemDetailsService
     content type   application/problem+json
     body           {"type":"https://tools.ietf.org/html/rfc9110#section-15.6.1",
                     "title":"An unexpected error occurred","status":500,
                     "traceId":"0HNO9TTIAUPKU:00000001"}</code></pre>

  <p><strong>The same JSON, a different content type.</strong> <code>WriteAsJsonAsync</code> sends
  <code>application/json</code> because that is what it is for; nothing tells it the object is an error.
  The correct media type is not decoration:</p>

  <ul>
    <li>a client can branch on the content type without inspecting the body, which matters when the
    status alone is ambiguous;</li>
    <li>generated clients and API tooling recognise it and deserialise into an error type rather than
    failing against the success type;</li>
    <li>a gateway or log pipeline can classify a response without parsing it.</li>
  </ul>

  <p>Hand-rolling gets you the right shape with the wrong label, which is worse than being either right
  or visibly different: nothing fails until a consumer that trusts the content type arrives.</p>

  <h3>The fields</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Field</th><th>What it is</th><th>Why it earns its place</th></tr></thead>
      <tbody>
        <tr><td><code>type</code></td><td>A URI naming the <em>kind</em> of problem</td>
            <td>The only field a client can branch on safely. Unlike the status code it can distinguish
            two different 422s. It does not have to resolve to anything.</td></tr>
        <tr><td><code>title</code></td><td>A short human-readable summary</td>
            <td>The same for every occurrence of a type. It is for a person reading a log, not for
            code.</td></tr>
        <tr><td><code>status</code></td><td>The HTTP status, repeated</td>
            <td>So a document that has been logged or forwarded on its own is still complete.</td></tr>
        <tr><td><code>detail</code></td><td>Something specific to this occurrence</td>
            <td>Optional, and the field to think hardest about — see the end of this section.</td></tr>
        <tr><td><code>instance</code></td><td>A URI for this occurrence</td>
            <td>Usually the request path. Almost always omitted, and nearly free to add.</td></tr>
        <tr><td><code>traceId</code></td><td>The correlation identifier</td>
            <td><strong>The field that matters.</strong> Added by .NET automatically.</td></tr>
      </tbody>
    </table>
  </div>

  <p class="define"><span class="define__term">Correlation identifier</span> A string that appears both
  in the response the caller received and in the log entry your server wrote, so that having one lets
  you find the other.</p>

  <p>The traceId is what turns "something went wrong" into a support conversation. The customer quotes
  it, you search your logs for it, and you find the exception that produced it with its full stack —
  which is where a stack belongs.</p>

  <p><strong>The detail goes to your logs, the pointer goes to the client.</strong> Neither party gets
  nothing, and the client gets nothing it should not have.</p>

  <p class="define"><span class="define__term">Extension member</span> Any field you add to a problem
  document beyond the standard ones. RFC 9457 explicitly allows them, which is why a validation error
  list, a retry hint or an order identifier does not need an error format of your own.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>What must never go into a problem document: exception messages, type names, stack traces, SQL,
    connection strings, file paths, internal hostnames, or the value of anything the caller did not send
    you.</p>
    <p>Exception <em>messages</em> are the one people argue about, and the argument loses to a single
    observation: <strong>you do not control what is in them</strong>. A message written by a library, a
    driver or the framework can contain a connection string, a file path or a fragment of somebody's
    data — as the one measured in the previous section does.</p>
  </div>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - returns a message you did not write"><code>catch (Exception exception)
{
    // The message here was produced by a database driver, and on this
    // code path it contains the connection string it failed to open.
    return Results.Problem(
        title: "An unexpected error occurred",
        detail: exception.Message,
        statusCode: 500);
}</code></pre>

  <p>Whether to include <code>detail</code> at all is a genuine judgement rather than a rule. A specific
  message helps a legitimate caller and helps an attacker enumerate. "Payment not found" is safe;
  "payment PAY-1 belongs to another merchant" has told somebody that PAY-1 exists and is not theirs.
  The general form: <strong>a message may describe what the caller did, and should not describe what
  you found</strong>.</p>
</section>

<section id="translating-exceptions">
  <h2>Turning exceptions into answers</h2>

  <p class="define"><span class="define__term">Domain exception</span> An exception type you define that
  says what is wrong in the language of your business — <code>PaymentNotFoundException</code>,
  <code>PaymentAlreadySettledException</code> — and says nothing about HTTP.</p>

  <p class="define"><span class="define__term">IExceptionHandler</span> An interface, .NET 8 and later,
  with one method. Registered handlers are asked in turn until one says it handled the exception.</p>

  <pre data-lang="csharp" data-net="10" data-title="the interface"><code>public ValueTask&lt;bool&gt; TryHandleAsync(
    HttpContext context,
    Exception exception,
    CancellationToken cancellationToken)</code></pre>

  <p>Returning <code>false</code> passes the exception to the next registered handler, so they form a
  chain in registration order. Returning <code>true</code> means this handler has taken responsibility
  for the response.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-what-leaks.cs — the domain handler"><code>public sealed class DomainExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask&lt;bool&gt; TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        (int status, string title, string paymentId) = exception switch
        {
            PaymentNotFoundException payment =&gt;
                (404, "Payment not found", payment.PaymentId),
            PaymentAlreadySettledException payment =&gt;
                (409, "Payment already settled", payment.PaymentId),
            _ =&gt; (0, "", "")
        };

        if (status == 0)
        {
            // Not ours. The next registered handler gets a chance.
            return false;
        }

        context.Response.StatusCode = status;

        var problem = new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails =
            {
                Type = $"https://ledger.example/problems/{title.ToLowerInvariant().Replace(' ', '-')}",
                Title = title,
                Status = status
            }
        };

        // An extension member: a field of our own alongside the standard ones.
        // The caller sent this id, so echoing it back tells them nothing new.
        problem.ProblemDetails.Extensions["paymentId"] = paymentId;

        return await problemDetails.TryWriteAsync(problem);
    }
}</code></pre>

  <pre data-lang="console" data-title="01-what-leaks.cs output"><code>   PaymentNotFoundException  -&gt;  404  application/problem+json
     {"type":"https://ledger.example/problems/payment-not-found","title":"Payment not found",
      "status":404,"paymentId":"PAY-9","traceId":"0HNO9TTS6JKF4:00000001"}

   PaymentAlreadySettledException  -&gt;  409  application/problem+json
     {"type":"https://ledger.example/problems/payment-already-settled",
      "title":"Payment already settled","status":409,"paymentId":"PAY-1",
      "traceId":"0HNO9TTS6JKF4:00000002"}

   InvalidOperationException  -&gt;  500  application/problem+json
     {"type":"https://tools.ietf.org/html/rfc9110#section-15.6.1",
      "title":"An unexpected error occurred","status":500,
      "traceId":"0HNO9TTS6JKF4:00000003"}</code></pre>

  <p>A domain exception becomes the status it means. Anything unrecognised is a 500 with no detail —
  including the one whose message names an internal address.</p>

  <p><strong>The last handler should always return <code>true</code>.</strong> If every handler returns
  <code>false</code> the exception falls through to the default behaviour, which is the empty 500 from
  the table above. A catch-all producing a traceId is worth more than a bare status code.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Translating exceptions at the edge is better than returning status codes from deep code. A
    repository that knows a payment is missing should throw a domain exception, not construct an HTTP
    response: it does not know it is being called over HTTP, and one day — from a background worker, a
    message consumer, a scheduled job — it will not be.</p>
    <p>The handler is the one place in the process that knows the protocol, which is the only place the
    protocol should be mentioned.</p>
  </div>
</section>

<section id="two-middlewares">
  <h2>Two middlewares that are constantly confused</h2>

  <p class="define"><span class="define__term">UseExceptionHandler</span> Middleware that catches an
  exception thrown further down the pipeline and produces a response instead.</p>

  <p class="define"><span class="define__term">UseStatusCodePages</span> Middleware that looks at a
  finished response and, if it has an error status and an empty body, gives it one.</p>

  <p>They are both needed, and each is silent about what the other covers:</p>

  <pre data-lang="console" data-title="02-when-it-does-not-run.cs output"><code>   registered                   thrown 500     returned 403   no route
   ----------                   ----------     ------------   --------
   neither                      500 empty      403 empty      404 empty
   UseExceptionHandler only     500 document   403 empty      404 empty
   UseStatusCodePages only      500 empty      403 document   404 document
   both                         500 document   403 document   404 document</code></pre>

  <p>Read the columns rather than the rows. <code>UseExceptionHandler</code> runs when something
  <em>threw</em>, and it is the only one of the two that ever sees an exception.
  <code>UseStatusCodePages</code> runs when a response has an error <em>status</em> and no body; it
  never sees an exception, and it covers the 404 from routing, the 405 from method matching, and every
  bare status a handler returns.</p>

  <p><strong>Neither is a superset of the other</strong>, which is why an app with only the first still
  returns empty 404s and an app with only the second still returns empty 500s. Ship both. A body that
  already exists is left alone by both, so a handler returning its own document keeps it.</p>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>Nobody designs the following. Each endpoint was written by somebody doing a reasonable thing in the
  idiom in front of them at the time:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs — five endpoints, five habits"><code>// Written in 2023, the first endpoint anybody wrote.
app.MapGet("/v1/payments/{id}", (string id) =&gt; Results.NotFound());

// Written by somebody who wanted the client to see a reason.
app.MapPost("/v1/refunds", () =&gt;
    Results.BadRequest(new { error = "refund window has closed" }));

// Written by somebody who had read the RFC.
app.MapPost("/v1/payouts", () =&gt;
    Results.Problem(title: "Payout account not verified", statusCode: 409));

// Written with the validation helper.
app.MapPost("/v1/invoices", () =&gt; Results.ValidationProblem(
    new Dictionary&lt;string, string[]&gt; { ["currency"] = ["must be a three-letter code"] }));

// Written by somebody who let it throw and trusted the handler.
app.MapPost("/v1/settlements", void () =&gt;
    throw new InvalidOperationException("ledger closed for the period"));</code></pre>

  <pre data-lang="console" data-title="03-production.cs output"><code>   endpoint            status   content type                fields
   --------            ------   ------------                ------
   GET payments           404   (none)                      (no body)
   POST refunds           400   application/json            error
   POST payouts           409   application/problem+json    type title status traceId
   POST invoices          400   application/problem+json    type title status errors traceId
   POST settlements       500   application/problem+json    type title status traceId</code></pre>

  <p>Three content types and four field sets in one API, all of them individually defensible. The cost
  does not land on you. It lands in the client, as code that has to read every one of them:</p>

  <pre data-lang="text" data-title="the client, in whatever language it is written in"><code>if (body has 'error')       message = body.error;
else if (body has 'title')  message = body.title;
else if (body has 'errors') message = flatten(body.errors);
else if (body is empty)     message = statusText(status);</code></pre>

  <p>Every branch of that was written after an incident in which the previous version showed a blank
  error dialog, and it is correct only until somebody adds a sixth endpoint.</p>

  <p>The worst row is not the inconsistent one. It is the 404 with no body, which cannot tell the client
  whether the payment does not exist, the route was wrong, or a proxy answered.</p>

  <h3>One policy instead</h3>

  <p class="define"><span class="define__term">CustomizeProblemDetails</span> A callback run over every
  problem document the framework produces, before it is written. One place to add fields that every
  error should carry.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs — the single policy"><code>builder.Services.AddProblemDetails(options =&gt;
    options.CustomizeProblemDetails = context =&gt;
    {
        // Where the problem happened. Standard, and almost always omitted.
        context.ProblemDetails.Instance =
            $"{context.HttpContext.Request.Method} {context.HttpContext.Request.Path}";

        // An extension member of our own, so support can quote one string.
        context.ProblemDetails.Extensions["service"] = "ledger-api";

        // A type URI for anything that has not got one. The built-in
        // defaults already supply one for every standard status, so this
        // only fills gaps a custom status would leave.
        context.ProblemDetails.Type ??=
            $"https://ledger.example/problems/http-{context.ProblemDetails.Status}";
    });</code></pre>

  <p>The same five endpoints, with one of them changed — the refund endpoint's anonymous object becomes
  <code>Results.Problem</code>:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   endpoint            status   content type                fields
   --------            ------   ------------                ------
   GET payments           404   application/problem+json    type title status instance traceId service
   POST refunds           400   application/problem+json    type title status instance traceId service
   POST payouts           409   application/problem+json    type title status instance traceId service
   POST invoices          400   application/problem+json    type title status instance errors traceId service
   POST settlements       500   application/problem+json    type title status instance traceId service

   one of them in full:

     {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"Not Found",
      "status":404,"instance":"GET /v1/payments/PAY-9",
      "traceId":"0HNOA1NP3OH1T:00000006","service":"ledger-api"}</code></pre>

  <p>One content type, one field set, and the empty 404 is gone. The client's branch collapses to
  reading <code>title</code>, and every response carries an identifier, a route and a service name that
  nobody had to remember to add.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>CustomizeProblemDetails</code> runs for documents produced <em>through</em> the problem
    details service: <code>Results.Problem</code>, <code>Results.ValidationProblem</code>, the status
    code pages, an exception handler calling <code>TryWriteAsync</code>, and the automatic 400 from a
    validating controller.</p>
    <p>It does not run for a hand-written JSON object, because nothing marks that object as an error.
    That is why the refund endpoint had to change, and the reason to route every error through the
    service even when a bare object would have been shorter.</p>
  </div>

  <p><code>ValidationProblemDetails</code> — the shape produced by the validation module's failures — is
  a problem document with an <code>errors</code> member mapping field names to messages. It is not a
  competing format; it is the standard one with an extension member, which is why a single client parser
  reads both.</p>

  <h3>The whole contract in one file</h3>

  <p>Every failure this API can produce, including the ones nobody wrote code for:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>var records = new ConcurrentQueue&lt;string&gt;();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Logging.AddProvider(new CapturingLoggerProvider(records));
builder.Logging.SetMinimumLevel(LogLevel.Error);

// ---------------------------------------------------------------------------
// THE ERROR CONTRACT. Four registrations and two middleware lines, and after
// this no endpoint in the file has to think about any of it.

builder.Services.AddProblemDetails(options =&gt;
    options.CustomizeProblemDetails = context =&gt;
    {
        // Added to every document the service produces, including the ones the
        // framework produces on its own.
        context.ProblemDetails.Instance =
            $"{context.HttpContext.Request.Method} {context.HttpContext.Request.Path}";

        context.ProblemDetails.Extensions["service"] = "ledger-api";
    });

// Order is priority order. The catch-all must be last, because it answers
// everything.
builder.Services.AddExceptionHandler&lt;DomainExceptionHandler&gt;();
builder.Services.AddExceptionHandler&lt;CatchAllExceptionHandler&gt;();

builder.Services.AddSingleton&lt;IPayments, Payments&gt;();

var app = builder.Build();

// FIRST, before anything that could throw. Only what it wraps can be reported.
app.UseExceptionHandler();

// The other half: an error status that has no body gets one.
app.UseStatusCodePages();

// ---------------------------------------------------------------------------
// The endpoints. None of them mentions an error shape, a trace id, or a log.

app.MapGet("/v1/payments/{id}", (string id, IPayments payments) =&gt;
{
    Payment? payment = payments.Find(id);

    return payment is null
        ? Results.Problem(
            type: "https://ledger.example/problems/payment-not-found",
            title: "Payment not found",
            statusCode: 404)
        : Results.Ok(payment);
});

app.MapPost("/v1/payments/{id}/capture", (string id, IPayments payments) =&gt;
{
    // The service throws what it means. It does not know it is behind HTTP.
    payments.Capture(id);

    return Results.Ok(new { id, status = "captured" });
});

app.MapPost("/v1/refunds", (RefundRequest body) =&gt;
{
    // A rule decidable from the request alone: 400, and specific about what
    // the caller sent rather than about what we hold.
    if (body.AmountMinor &lt;= 0)
    {
        return Results.ValidationProblem(new Dictionary&lt;string, string[]&gt;
        {
            ["amountMinor"] = ["must be greater than zero"]
        });
    }

    return Results.Accepted($"/v1/refunds/{body.PaymentId}");
});</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   no such payment     GET /v1/payments/PAY-404
     404  application/problem+json
     {"type":"https://ledger.example/problems/payment-not-found","title":"Payment not found",
      "status":404,"instance":"GET /v1/payments/PAY-404","traceId":"00-4ce1473c...","service":"ledger-api"}

   already captured    POST /v1/payments/PAY-1/capture
     409  application/problem+json
     {"type":"https://ledger.example/problems/payment-already-captured",
      "title":"Payment already captured","status":409,"instance":"POST /v1/payments/PAY-1/capture",
      "paymentId":"PAY-1","traceId":"00-ff8ec3d2...","service":"ledger-api"}

   gateway failure     POST /v1/payments/PAY-2/capture
     500  application/problem+json
     {"type":"https://ledger.example/problems/internal-error",
      "title":"An unexpected error occurred","status":500,
      "instance":"POST /v1/payments/PAY-2/capture","traceId":"00-5a02f137...","service":"ledger-api"}

   invalid amount      POST /v1/refunds
     400  application/problem+json
     {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1",
      "title":"One or more validation errors occurred.","status":400,"instance":"POST /v1/refunds",
      "errors":{"amountMinor":["must be greater than zero"]},"traceId":"00-bb349669...",
      "service":"ledger-api"}

   malformed body      POST /v1/refunds
     400  application/problem+json
     {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1","title":"Bad Request",
      "status":400,"instance":"POST /v1/refunds","traceId":"00-9aa867b2...","service":"ledger-api"}

   no such route       GET /v1/nothing-here
     404  application/problem+json ...

   method not allowed  DELETE /v1/payments/PAY-1
     405  application/problem+json ...</code></pre>

  <p>Eight requests, six failures, one shape. The endpoints do not mention an error format, a trace
  identifier or a log; adding a ninth endpoint tomorrow gets the same treatment without its author
  knowing any of this exists, which is the only kind of consistency that survives a team.</p>

  <p>What reached the error log across all eight requests:</p>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   Unhandled exception. traceId 00-d639c4168105c6243109aa6bd03cc335-392cce8cfef6f448-00
        InvalidOperationException: capture failed: POST https://gw.internal:8443/v2/capture returned 503</code></pre>

  <p>One entry, for the one thing that actually went wrong here. The 404s, the 400s and the 405 are the
  caller being told no, which is the API working.</p>

  <p>The 409 is the interesting omission. It came from an exception, and the handler that translated it
  deliberately does not log: capturing a payment twice is a thing callers do, not a thing that broke.
  <strong>Whether an exception is an error is a decision, and the handler is where it is made.</strong>
  Get it wrong in the safe direction and every duplicate request pages somebody at 03:00; get it wrong
  in the other direction and a real fault is invisible. The test to apply is whether anyone on your side
  could have prevented it.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>The handler registered after the code that throws</h3>

  <p>Symptom: empty 500s in production from a service whose exception handler is present, correct, and
  covered by tests.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the handler cannot see this"><code>var app = builder.Build();

// Added last week, to read a tenant header. It went at the top of the file
// where the other setup lines live.
app.Use(async (context, next) =&gt;
{
    string tenant = context.Request.Headers["X-Tenant"].ToString();
    context.Items["tenant"] = Guid.Parse(tenant);   // throws on malformed input
    await next(context);
});

app.UseExceptionHandler();</code></pre>

  <pre data-lang="console" data-title="02-when-it-does-not-run.cs output"><code>   thrower registered      status   content type                body
   ------------------      ------   ------------                ----
   before the handler         500   (none)                      (empty)
   after the handler          500   application/problem+json    {"type":"https://tools...</code></pre>

  <p><code>UseExceptionHandler</code> catches what is thrown <em>downstream</em> of it, because
  downstream is the only thing it calls. A middleware registered before it is upstream, and is not
  inside its try block at all. <strong>The handler belongs as early as possible</strong> — before
  authentication, before routing, before anything of your own.</p>

  <h3>The response that already started</h3>

  <p>Symptom: an endpoint your dashboards show as fully successful, and a client reporting intermittent
  parse errors or truncated files.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the status is chosen before the work can fail"><code>app.MapGet("/streamed", async (HttpContext context) =&gt;
{
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsync("""{"items":[{"id":1},{"id":2}""");
    await context.Response.Body.FlushAsync();

    // The database connection drops on page three.
    throw new InvalidOperationException("connection reset while reading page 3");
});</code></pre>

  <pre data-lang="console" data-title="02-when-it-does-not-run.cs output"><code>   status line seen by the client   200
   content type                     application/json
   chunked                          True
   bytes received before the fault  27
   partial body                     {"items":[{"id":1},{"id":2}
   the body read                    threw HttpIOException</code></pre>

  <p>The status line says 200 and always will. The handler does run — it is invoked and it sees the
  exception — and it can change nothing, because the status and headers were on the wire before the
  exception existed and bytes cannot be unsent.</p>

  <p>What the server can still do is refuse to finish. The response was chunked, so Kestrel abandons the
  connection without writing the terminating chunk, and a correct client notices and throws. That signal
  is easy to lose: a client catching broadly around the read, a proxy that buffers and forwards what it
  got, or code deserialising from an already-filled buffer will present the truncated document as a
  successful 200 — and if the truncation lands on a valid boundary, as a plausible one.</p>

  <p><strong>Once the first byte is sent, no error handling can change the answer.</strong> Everything
  that can fail must fail before that byte.</p>

  <h3>The handler that stops the logging</h3>

  <p>The prediction here was that the framework logs every unhandled exception at Error, so returning a
  bare traceId costs nothing diagnostically. Measured, with the same throwing endpoint:</p>

  <pre data-lang="console" data-title="02-when-it-does-not-run.cs output"><code>   configuration                      caller gets    exception in the log?
   -------------                      -----------    ---------------------
   no exception handler               500 empty      YES
   handler, does not log              500 document   no
   handler, logs the exception        500 document   YES

     no exception handler
       Error: Kestrel: Connection id "0HNO9U0G9UJBH", Request id "...": An unhandled
              exception was thrown by the application.
              InvalidOperationException: gateway timed out

     handler, does not log
       (nothing above Information - the request finished with a 500
        and no record of why)</code></pre>

  <p><strong>The prediction was wrong.</strong> An <code>IExceptionHandler</code> that returns
  <code>true</code> has taken responsibility for the exception, and the framework takes it at its word.
  The Error entry the server writes in row one is exactly what row two removes.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>This is the trap of the whole module. You add an exception handler to stop leaking stack traces,
    the error responses get better, and you have silently stopped recording why anything failed. The next
    incident presents as a rise in 500s with no exception anywhere to explain them.</p>
    <p>An exception handler must log. Inject <code>ILogger</code>, log at Error with the exception
    <em>object</em> so the stack is kept, and include the same identifier the document carries.</p>
    <p>The rule generalises past this API: wherever you handle an exception in order to return something
    tidy, you have become the only place that knows it happened.</p>
  </div>

  <h3>The identifier that matches nothing</h3>

  <p class="define"><span class="define__term">Activity</span> .NET's representation of a unit of work
  being traced. When distributed tracing is active, each request has one, carrying a
  <strong>W3C trace identifier</strong> shared by every service the request touches.</p>

  <p class="define"><span class="define__term">TraceIdentifier</span> Kestrel's own per-request string,
  of the form <code>connectionId:requestNumber</code>. It means nothing outside this process.</p>

  <p>The <code>traceId</code> in a problem document is <code>Activity.Current?.Id</code> when there is an
  activity and <code>HttpContext.TraceIdentifier</code> when there is not — and whether there is one
  depends on whether anything is listening, which a logging provider is enough to cause:</p>

  <pre data-lang="console" data-title="02-when-it-does-not-run.cs output"><code>     Activity.Current?.Id        00-c64264311561dbc8f26fd4601af6863a-72cc56f9f54c3ec7-00
     HttpContext.TraceIdentifier 0HNO9U0G9UJBK:00000001

     with a logging provider     "traceId":"00-c64264311561dbc8f26fd4601af6863a-72cc56f9f54c3ec7-00"
     with logging cleared        "traceId":"0HNO9U0G9UJBL:00000001"</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - logs a different id from the one it returns"><code>logger.LogError(exception, "Unhandled exception. traceId {TraceId}",
    context.TraceIdentifier);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right - the same expression the document uses"><code>logger.LogError(exception, "Unhandled exception. traceId {TraceId}",
    Activity.Current?.Id ?? context.TraceIdentifier);</code></pre>

  <p>Both versions read correctly and both log an identifier. The failure appears only when somebody
  tries to join them, which is usually a customer on the phone.</p>

  <h3>A 500 for a permanent condition</h3>

  <p>Symptom: duplicated side effects under load, and retry storms during partial outages.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - tells the caller to try again"><code>catch (AlreadyCapturedException)
{
    return Results.StatusCode(500);
}</code></pre>

  <p>5xx means the server failed and the request may succeed later; 4xx means the request was wrong and
  resending it unchanged will not help. Choosing the wrong side of that line is not a documentation
  problem, it is an instruction to every client library's retry policy.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <p>An endpoint returns something other than your error document. There are four causes and each has a
  distinguishing symptom:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
      <tbody>
        <tr><td>500, empty body, no content type</td>
            <td>Nothing handled it: the handler is missing, or is registered after the middleware that
            threw</td>
            <td>Register <code>UseExceptionHandler</code> first in the pipeline</td></tr>
        <tr><td>200 with a truncated or invalid body</td>
            <td>The response had already started; no handler could have changed it</td>
            <td>Do the fallible work before writing anything</td></tr>
        <tr><td>404 or 403 with an empty body</td>
            <td>Not an exception at all — nothing threw</td>
            <td>Add <code>UseStatusCodePages</code></td></tr>
        <tr><td>A stack trace in the body</td>
            <td>The developer exception page is on</td>
            <td>Check <code>ASPNETCORE_ENVIRONMENT</code> in <em>that</em> environment</td></tr>
      </tbody>
    </table>
  </div>

  <p>Check them in that order, because it runs from cheapest to hardest to see: the first two are
  visible in one <code>curl -i</code>, and the last is one deployment lookup.</p>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>What to run against a service you have inherited, in order, each one request:</p>
    <ol>
      <li><code>curl -i</code> a route that does not exist. An empty 404 means
      <code>UseStatusCodePages</code> is missing.</li>
      <li><code>curl -i</code> something that throws. An empty 500 means no handler or a handler
      registered too late; a stack trace means the developer page is on.</li>
      <li>Take the traceId from that response and search the log store. No match means the handler is
      either not logging or logging a different identifier from the one it returned.</li>
      <li>Collect the error bodies from four or five endpoints and compare the field names. Drift is the
      normal state, not the exception.</li>
      <li>Search for <code>StatusCode</code>, <code>BadRequest</code> and <code>NotFound</code> inside
      services and repositories. Each is a protocol decision made where the protocol is not known.</li>
      <li>Search for 500s returned deliberately. Every one is a client being told to retry.</li>
    </ol>
    <p>The highest-value change on most services is the first two together: four lines of setup that
    turn every silent failure into one somebody can quote.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"We return JSON errors, so we have an error contract."</strong></p>
    <p>The measured drift table shows five endpoints returning JSON and four different field sets. A
    contract is a shape every endpoint produces without its author choosing to, which means it lives in
    the composition of the application, not in a convention people remember.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The stack trace only shows in Development, so it is safe."</strong></p>
    <p>Development is a string in configuration, and the failure mode is a copied compose file rather
    than a wrong default. It is also not a browser-only exposure: the developer page content-negotiates
    and returns the same stack as JSON to a client that asks for JSON.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Returning the exception message is fine — it is our own message."</strong></p>
    <p>Some of them are. The rest were written by a database driver, an HTTP client or the framework,
    and can contain a connection string, an internal hostname, a file path or a fragment of another
    request's data. You cannot audit a set that grows with every package upgrade.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A custom error envelope is better because it fits our domain."</strong></p>
    <p>RFC 9457 permits arbitrary extension members, so anything a custom envelope can carry a problem
    document can carry too — while keeping a media type every gateway, client generator and log pipeline
    already recognises. The custom envelope gains nothing and loses that.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The framework logs unhandled exceptions, so my handler does not need to."</strong></p>
    <p>Measured false. A handler returning <code>true</code> suppresses the framework's own Error entry.
    The handler is the last place that sees the exception, which makes it the only place that can record
    it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"500 is the safe default when you are not sure."</strong></p>
    <p>500 is an instruction to retry. For a condition that will never succeed, the safe-looking default
    turns one failing request into as many as the client's retry policy allows — which is how a duplicate
    capture becomes a duplicate charge.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Return to the incident. A payments API handling roughly 40 requests a second, of which a few
    hundred a day hit an already-captured payment during a partner's retry window.</p>
    <p>With an empty 500: each of those becomes a retry, some fraction of the retries lands a second
    capture, and every affected customer is a refund, a chargeback risk and a support conversation. The
    investigation took five hours, of which ninety minutes went into establishing whether the requests
    had arrived, because the only evidence was the string <code>500</code>.</p>
    <p>With the contract in this module: the same condition returns 409 with a type URI, no client
    retries it, no second charge happens, and the partner's first message quotes a traceId that resolves
    directly to the exception. The bug is still there; it is a five-minute bug instead of a five-hour
    one.</p>
    <p>The uncomfortable summary is that the incident was an idempotency bug, and the error contract
    decided how expensive it was.</p>
  </div>

  <p>The second reason is quieter and compounds. Every endpoint that invents its own error shape adds a
  branch to every client, and those branches are written by people who cannot see your code and are
  guessing from one example. Consistency here is not tidiness — it is the difference between a client
  that handles your failures and a client that shows a blank dialog.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A service returns a proper problem document when an endpoint throws, and an empty body for every
    404 and 403. The exception handler is registered and correct, and the tests covering error handling
    all pass.</p>
    <p>What is missing, and why do the tests not catch it?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   registered                        throws   403        unmatched route
   ----------                        ------   ---        ---------------
   handler only                      500 doc  403 empty  404 empty
   handler + pages                   500 doc  403 doc    404 doc</code></pre>
        <p><code>UseStatusCodePages</code> is missing. The exception handler only ever sees exceptions,
        and a 404 from routing is not one — no code ran, so nothing threw.</p>
        <p>The tests pass because a test for error handling is written by making something fail, and the
        natural way to make something fail is to throw. The half of the surface never exercised is the
        half where nothing goes wrong in your code at all: a route that does not exist, an authorisation
        policy that says no, a method that is not allowed.</p>
        <p>The test that would have caught it asserts on a request to a path nobody mapped, which feels
        like testing the framework and is not.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>Customers quote the traceId from an error response, support searches the log store for it, and
    finds nothing. The handler does log the exception, and the log entry does contain an identifier.</p>
    <p>What is wrong, and what is the one-line fix?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   handler logs context.TraceIdentifier
     returned to the caller   00-ace6e25d3b690f460fccd780eccfc2b1-b8c083b75314f445-00
     written to the log       Unhandled exception. traceId 0HNOA1P4JTK1P:00000001
     a search for the id      finds nothing

   handler logs Activity.Current?.Id
     returned to the caller   00-23e5b8711089171a832ad54848ba73dd-8d648d5596109b05-00
     written to the log       Unhandled exception. traceId 00-23e5b871...-8d648d55...-00
     a search for the id      FINDS IT</code></pre>
        <p>The document's <code>traceId</code> is <code>Activity.Current?.Id</code> when there is an
        activity, and <code>HttpContext.TraceIdentifier</code> only when there is not. A handler logging
        <code>TraceIdentifier</code> is logging a different string from the one it returns, and both of
        them look like identifiers.</p>
        <pre data-lang="csharp" data-net="10" data-title="the fix"><code>logger.LogError(exception, "Unhandled exception. traceId {TraceId}",
    Activity.Current?.Id ?? context.TraceIdentifier);</code></pre>
        <p>It survives review because both versions read correctly, both log an identifier, and on a
        developer machine the difference is two strings that are both present. The failure appears only
        when somebody tries to join them.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>An API returns a bad request, a not found, a conflict from a domain exception, and an unexpected
    failure. Make all four arrive as the same kind of document, each carrying the request path and a
    service name — <strong>without editing any endpoint to add those fields</strong>.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs — the whole change"><code>builder.Services.AddProblemDetails(options =&gt;
    options.CustomizeProblemDetails = context =&gt;
    {
        context.ProblemDetails.Instance =
            $"{context.HttpContext.Request.Method} {context.HttpContext.Request.Path}";

        context.ProblemDetails.Extensions["service"] = "ledger-api";
    });

// Order is priority order. The catch-all answers everything, so it is last.
builder.Services.AddExceptionHandler&lt;DomainHandler&gt;();
builder.Services.AddExceptionHandler&lt;CatchAll&gt;();

var app = builder.Build();
app.UseExceptionHandler();
app.UseStatusCodePages();</code></pre>
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   400  application/problem+json
     {"type":"...15.5.1","title":"Refund window has closed","status":400,
      "instance":"POST /refunds","traceId":"...","service":"ledger-api"}

   404  application/problem+json
     {"type":"...15.5.5","title":"Not Found","status":404,
      "instance":"GET /payments/PAY-9","traceId":"...","service":"ledger-api"}

   409  application/problem+json
     {"type":"https://ledger.example/problems/already-captured",
      "title":"Payment already captured","status":409,"instance":"POST /captures",
      "paymentId":"PAY-1","traceId":"...","service":"ledger-api"}

   500  application/problem+json
     {"type":"...15.6.1","title":"An unexpected error occurred","status":500,
      "instance":"POST /settlements","traceId":"...","service":"ledger-api"}</code></pre>
        <p>The point of the exercise is the phrase "without editing any endpoint". An error contract each
        handler has to remember to honour is one that drifts the first week somebody is in a hurry. A
        contract enforced by the composition of the application cannot be forgotten, only removed — and
        removing it is a visible change to one file.</p>
        <p>Note the order of the two handlers. <code>DomainHandler</code> must come first, because
        <code>CatchAll</code> returns <code>true</code> for everything; a catch-all registered first makes
        every handler after it dead code.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>An export endpoint appears in the dashboards as 100% successful. The error log contains exceptions
    from that endpoint every day. A customer says the file is sometimes cut off.</p>
    <p>How can the logs and the dashboard disagree, and what would you change?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   version                         status   bytes   body read         exception logged
   -------                         ------   -----   ---------         ----------------
   v1, write while reading            200      45   HttpIOException   YES
   v2, materialise then write         500     181   completed         YES</code></pre>
        <p>v1 writes the first rows to the socket before the failure happens. The status line went out
        with the first byte, so it says 200 and can never say anything else. The dashboards are not
        lying: 200 is genuinely what was sent, and 45 bytes of a truncated file went with it.</p>
        <p>Read the last column carefully, because it is the part that surprises people:
        <strong>the handler still ran and still logged</strong>. It was invoked, it saw the exception, and
        its attempt to write a problem document went nowhere because the response had started. So the log
        and the status code are both correct and they disagree — an alert built on status codes and an
        alert built on exception counts are measuring different events.</p>
        <p>Two separate changes:</p>
        <ol>
          <li>Do the fallible work before writing anything. v2 materialises the rows first, so a failure
          is still an error the handler can report — at the cost of holding the whole export in memory,
          which is a real trade and not always the right one.</li>
          <li>If it must stream, make the failure detectable: count exceptions thrown after the response
          started as their own metric, and give the format a terminator the client checks for.</li>
        </ol>
        <p>The general lesson is worth more than the endpoint. <strong>A metric built on status codes
        cannot see any failure that happens after the status code is chosen.</strong> Every streaming
        endpoint, every long download and every response written in pieces has this blind spot.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is the media type of a problem document, and why does the suffix matter?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>application/problem+json</code>. The <code>+json</code>
        suffix means a client that knows nothing about problem documents can still parse the body as
        JSON, while one that does can branch on the type without inspecting the body.</p></div>
      </details></li>

    <li><p>Which failures does <code>UseExceptionHandler</code> not cover?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Every failure that did not throw: a 404 from routing, a 405 from
        method matching, an authorisation failure, and any bare status a handler returns. Those need
        <code>UseStatusCodePages</code>.</p></div>
      </details></li>

    <li><p>Where in the pipeline does the exception handler belong, and why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>As early as possible. It catches only what is thrown downstream of
        it, so anything registered before it is outside its reach.</p></div>
      </details></li>

    <li><p>What happens to the framework's own exception logging when your
      <code>IExceptionHandler</code> returns <code>true</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It does not happen. The handler has taken responsibility, so
        nothing is written above Information. Your handler is the only place that can record the
        exception, and it must.</p></div>
      </details></li>

    <li><p>Two values can end up in the <code>traceId</code> field. Which, and which wins?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>Activity.Current?.Id</code> — the W3C trace identifier —
        wins when an activity exists; <code>HttpContext.TraceIdentifier</code>, the connection and
        request number, is the fallback. Log whichever the document carries, not the other one.</p></div>
      </details></li>

    <li><p>Why is returning 500 for an already-captured payment worse than returning nothing?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>5xx tells the client the request may succeed if retried, so a
        well-behaved client retries a permanent condition. 409 says the request will never succeed as
        sent, and stops the retry.</p></div>
      </details></li>

    <li><p>Why can a 200 response contain a truncated body, and what does that do to status-based
      alerting?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The status line is sent with the first byte of the body, so a
        failure after that point cannot change it. Any metric derived from status codes is blind to
        every failure that happens after the status is chosen.</p></div>
      </details></li>

    <li><p>What does <code>CustomizeProblemDetails</code> not reach?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Anything not written through the problem details service — most
        commonly an endpoint returning its own anonymous JSON object, because nothing marks that object
        as an error.</p></div>
      </details></li>
  </ol>
</section>
`
});
