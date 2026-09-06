CSPREP.module({
  id: "t3-06-minimal-vs-controllers",
  minutes: 55,
  updated: "2026-09-03",
  summary: "Ledger ports one controller to a minimal API for performance. The request type is untouched, its validation attributes are untouched, every line of the diff is a correct translation - and the endpoint goes from rejecting 4 of 5 bad requests to accepting all 5. Nothing was deleted, because there was never any validation code to delete: [ApiController] was doing it. The honest comparison is not about speed or testability, it is about which defaults you can see.",
  terms: ["minimal API", "controller", "ApiController", "convention", "endpoint filter",
    "IEndpointFilter", "IAsyncActionFilter", "action filter", "short-circuit", "typed results",
    "TypedResults", "Results<T1,T2>", "ProblemDetails", "ValidationProblemDetails",
    "binding source inference", "AddValidation", "UseStatusCodePages"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p><code>POST /payments</code> has been a controller action for three years. The request type carries
  data annotations — a range on the amount, a length on the currency code — and they have been enforced
  since the day they were written.</p>

  <p>A performance review flags MVC's overhead on the hot path. One engineer ports the endpoint to a
  minimal API. The diff is small and reads well: the <code>[HttpPost]</code> attribute becomes
  <code>app.MapPost</code>, the action body becomes a lambda body, and the request type and its
  attributes are untouched.</p>

  <p><strong>Nothing about validation appears in the diff, because nothing about validation appeared in
  the controller either.</strong> It was <code>[ApiController]</code>.</p>

  <pre data-lang="console" data-title="03-production.cs"><code>   version                              accepted   rejected   bad rows
   -------                              --------   --------   --------
   v1  the original controller                 1          4          0
   v2  ported, as written                      5          0          4
   v3  ported, validating by hand              1          4          0
   v4  ported, validating in a filter          1          4          0</code></pre>

  <p>Of five requests, one is valid. The ported endpoint accepts all five, and within a day the ledger
  contains payments with negative amounts and a currency code of <code>POUNDS</code>.</p>

  <p>This module is the comparison that incident is really about. Not speed, and not testability —
  <strong>which defaults you can see</strong>.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every status code, count and ordering in this module was produced by running the programs shown
    and pasted in unedited. Both styles run side by side in one application throughout, so every
    comparison is like for like.</p>
  </div>
</section>

<section id="plain-language">
  <h2>The two styles</h2>

  <p class="define"><span class="define__term">Controller</span> A class whose public methods are
  endpoints. The framework finds it by reflection at startup, matches requests to methods, and supplies
  their arguments. It has existed since ASP.NET MVC in 2009.</p>

  <p class="define"><span class="define__term">Action</span> One method on a controller — the handler
  for one endpoint.</p>

  <p class="define"><span class="define__term">Minimal API</span> A route and a delegate, registered
  directly on the application. There is no class, no attribute and no reflection over your types.
  Introduced in .NET 6.</p>

  <p class="define"><span class="define__term">Convention</span> Behaviour the framework applies
  because of what your code <em>is</em>, rather than because of anything it says. Controllers have many;
  minimal APIs have almost none. That single sentence is the module.</p>

  <p class="define"><span class="define__term">Data annotation</span> An attribute placed on a property
  stating a rule about its value — <code>[Required]</code>, <code>[Range]</code>,
  <code>[StringLength]</code>. The attribute records the rule; it does not enforce it. Something has to
  read it, and which style you are in decides whether anything does.</p>

  <p class="define"><span class="define__term">Model binding</span> Filling a handler's parameters from
  the request — from the route, the query string, a header, or the body. Both styles do it; they infer
  the source differently.</p>

  <p class="define"><span class="define__term">Filter</span> Code that wraps one endpoint's execution,
  after model binding and before the handler. Both styles have them, with different interfaces.</p>

  <p class="define"><span class="define__term">ProblemDetails</span> A standard JSON shape for an error
  response, defined by RFC 9457 — a type, a title, a status, and whatever else you add. It gets a module
  of its own later; here it matters only as the thing one style produces by default and the other does
  not.</p>

  <p>The same endpoint, both ways, in one program:</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — The same endpoint written both ways, in one program.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// Controllers have to be turned on. Minimal APIs do not - they are part of
// WebApplication itself.
builder.Services.AddControllers();

var app = builder.Build();

// MINIMAL API: a route and a delegate, in one expression.
app.MapGet("/minimal/payments/{id}", (string id) =&gt; new PaymentDto(id, 123450));

// CONTROLLERS: discovered by reflection from the class below.
app.MapControllers();

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

foreach (string path in new[] { "/minimal/payments/PAY-1", "/mvc/payments/PAY-1" })
{
    Console.WriteLine($"GET {path,-28} -&gt; {await http.GetStringAsync(path)}");
}

Console.WriteLine();
Console.WriteLine("Identical responses. Everything in this module is about what");
Console.WriteLine("SURROUNDS those two lines, not about what they return.");

await app.StopAsync();

// ---------------------------------------------------------------------------
public record PaymentDto(string Id, long AmountMinor);

[ApiController]
[Route("mvc/payments")]
public sealed class PaymentsController : ControllerBase
{
    [HttpGet("{id}")]
    public PaymentDto Get(string id) =&gt; new(id, 123450);
}</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>GET /minimal/payments/PAY-1      -&gt; {"id":"PAY-1","amountMinor":123450}
GET /mvc/payments/PAY-1          -&gt; {"id":"PAY-1","amountMinor":123450}</code></pre>

  <p>Identical responses. <strong>Everything in this module is about what surrounds those two lines,
  not about what they return.</strong></p>

  <h3>An analogy, and where it stops working</h3>

  <p>Controllers are a serviced office: the furniture, the phones and the cleaning are arranged before
  you arrive, and they are arranged the way the building decided. Minimal APIs are an empty unit with
  power and water. You fit it out, and it contains exactly what you put there.</p>

  <p><strong>This is an analogy and it misleads in one way that matters.</strong> Walking into an empty
  unit, you can <em>see</em> that there are no chairs. Moving from a serviced office to an empty unit,
  what you notice missing is whatever you happened to look for — and the thing this module's incident
  turns on is precisely the fitting nobody thought to check, because in the old building it had always
  been there.</p>
</section>

<section id="conventions">
  <h2>What [ApiController] does that a minimal API does not</h2>

  <p>The same request type, the same attributes, the same invalid body, sent to both:</p>

  <pre data-lang="csharp" data-net="10" data-title="01-conventions.cs — the shared type"><code>public sealed class CreatePayment
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public string Currency { get; set; } = "";
}</code></pre>

  <pre data-lang="console" data-title="01-conventions.cs"><code>   POST {"amountMinor": -5, "currency": "POUNDS"}

   /minimal/payments    200
                        {"received":-5,"currency":"POUNDS"}

   /mvc/payments        400
                        {"type":"https://tools.ietf.org/html/rfc9110#section-15.5.1",
                         "title":"One or more validation errors occurred."...</code></pre>

  <p><strong>The minimal endpoint accepted it.</strong> The attributes are on the type, the values
  violate them, and nothing checked. A negative payment of an invented currency reached the handler.</p>

  <p>The two handlers, side by side, so it is clear that neither contains a validation call:</p>

  <pre data-lang="csharp" data-net="10" data-title="01-conventions.cs — both handlers"><code>// MINIMAL
app.MapPost("/minimal/payments", (CreatePayment body) =&gt;
    Results.Ok(new { received = body.AmountMinor, currency = body.Currency }));

// CONTROLLER
[ApiController]
[Route("mvc")]
public sealed class PaymentsController : ControllerBase
{
    [HttpPost("payments")]
    public IActionResult Create(CreatePayment body) =&gt;
        Ok(new { received = body.AmountMinor, currency = body.Currency });
}</code></pre>

  <p>The controller rejected it with 400 and a <code>ValidationProblemDetails</code> body naming both
  fields — and <strong>no line of the controller does that</strong>.</p>

  <p class="define"><span class="define__term">Endpoint filter</span> The minimal-API filter type:
  <code>IEndpointFilter</code>, one method, wrapping the handler. It receives the bound arguments and
  can replace the result.</p>

  <h3>The five behaviours in one attribute</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Behaviour</th><th>Effect</th></tr></thead>
      <tbody>
        <tr><td><strong>Automatic 400 on validation failure</strong></td><td>Data annotations are checked before the action runs, and a <code>ValidationProblemDetails</code> body is returned</td></tr>
        <tr><td>Binding source inference</td><td>Complex types from the body, simple types from route or query, <code>IFormFile</code> from a form</td></tr>
        <tr><td><code>ProblemDetails</code> for error status codes</td><td>A 404 or 500 comes back as a document rather than an empty body</td></tr>
        <tr><td>Attribute routing required</td><td>Conventional routes do not apply; every action states its own route</td></tr>
        <tr><td><code>multipart/form-data</code> inference</td><td>For <code>IFormFile</code> parameters</td></tr>
      </tbody>
    </table>
  </div>

  <p>Malformed JSON shows the second row of that table in action:</p>

  <pre data-lang="console" data-title="01-conventions.cs"><code>   /minimal/payments    400  (empty body)
   /mvc/payments        400  {"type":"...","title":"One or more validation errors..."</code></pre>

  <p>Both reject it; the <em>shape</em> of the rejection differs. That matters for a caller writing
  error handling once — if half your endpoints answer with a structured document and half answer with
  an empty body, every client has to handle both.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>builder.Services.AddProblemDetails()</code> is the usual answer, and <strong>on its own it
    is not enough</strong>. It registers the service that <em>writes</em> the document; a result like
    <code>TypedResults.NotFound()</code> writes no body at all, so nothing invokes it.</p>
    <pre data-lang="console" data-title="Measured"><code>UseStatusCodePages=False -&gt; 404 ct=              body=(empty)
UseStatusCodePages=True  -&gt; 404 ct=application/problem+json
                                 body={"type":"...","title":"Not Found","status":404,
                                       "traceId":"0HNO9RJ0L793R:00000001"}</code></pre>
    <p><code>app.UseStatusCodePages()</code> is what fills a bodyless error response in. You need
    both.</p>
  </div>

  <p><strong>The point is not that one style is better.</strong> It is that controllers come with a set
  of decisions already made and minimal APIs come with none — and both positions are defensible.
  Conventions you did not choose are conventions you cannot see; conventions you must opt into are
  conventions somebody will forget.</p>

  <p>An API where validation runs on nineteen endpoints and not the twentieth is worse than either
  consistent choice. <strong>Whichever style you pick, make the cross-cutting behaviour explicit and
  apply it in one place</strong> — a route group for minimal APIs, a base controller or a convention
  for MVC. The failure mode in both styles is per-endpoint drift, not the style itself.</p>
</section>

<section id="filters">
  <h2>Filters</h2>

  <p>A group filter and an endpoint filter, and their MVC equivalents, on the same request:</p>

  <pre data-lang="console" data-title="02-filters-and-testability.cs"><code>   MINIMAL API
     minimal: group filter IN
     minimal: endpoint filter IN (id=PAY-1)
     minimal: the handler
     minimal: endpoint filter OUT (result is Ok&#96;1)
     minimal: group filter OUT

   CONTROLLER
     mvc: guard filter IN
     mvc: action filter IN (id=PAY-1)
     mvc: the action
     mvc: action filter OUT (result is OkObjectResult)
     mvc: guard filter OUT</code></pre>

  <p>Both nest identically — outermost registered runs first in, last out. The differences are in the
  interface, the model, and what they can see.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th></th><th>Minimal API</th><th>Controller</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>Interface</strong></td>
          <td><code>IEndpointFilter</code> — one method</td>
          <td><code>IActionFilter</code>/<code>IAsyncActionFilter</code>, plus resource, result, exception and authorisation filters — five types, each with a fixed position</td>
        </tr>
        <tr>
          <td><strong>Model</strong></td>
          <td>One wrapper, composed</td>
          <td>Five named stages you slot into</td>
        </tr>
        <tr>
          <td><strong>Arguments</strong></td>
          <td><code>GetArgument&lt;T&gt;(0)</code> — by position</td>
          <td><code>ActionArguments["id"]</code> — by name</td>
        </tr>
        <tr>
          <td><strong>Short-circuit</strong></td>
          <td><code>return Results.BadRequest(...)</code></td>
          <td><code>context.Result = new BadRequestObjectResult(...)</code></td>
        </tr>
      </tbody>
    </table>
  </div>

  <p>The MVC model is more powerful — an exception filter genuinely cannot be expressed as a plain
  wrapper — and it is more to hold in your head.</p>

  <p><strong>Neither argument-access mechanism is safe.</strong> The minimal one breaks silently when
  somebody reorders the handler's parameters; MVC's breaks silently when somebody renames one. Both are
  string-or-integer indexed access into somebody else's signature.</p>

  <pre data-lang="console" data-title="02-filters-and-testability.cs"><code>   request                          status   body
   -------                          ------   ----
   /minimal/work/PAY-1                 200   {"id":"PAY-1","style":"minimal"}
   /minimal/work/BAD                   400   {"error":"id rejected by filter"}
   /mvc/work/PAY-1                     200   {"id":"PAY-1","style":"controller"}
   /mvc/work/BAD                       400   {"error":"id rejected by filter"}</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>The controller short-circuit is the one to watch. <strong>Setting <code>context.Result</code> and
    then <em>also</em> calling <code>next()</code> runs the action anyway and discards your
    result.</strong></p>
    <p>The minimal form cannot express that mistake, because returning a value is the only way to
    produce one.</p>
  </div>
</section>

<section id="testability">
  <h2>Testability: the claim, and what is true</h2>

  <p class="define"><span class="define__term">Unit test</span> A test that calls one piece of code
  directly, with fakes for its collaborators, and no framework running.</p>

  <p class="define"><span class="define__term">Integration test</span> A test that starts the
  application and sends a real request through the whole pipeline. Slower, and the only kind that
  exercises routing, binding, filters and serialisation.</p>

  <p>The claim usually made is that controllers are testable and minimal APIs are not. <strong>That is
  true of one way of writing minimal APIs and false of the others.</strong></p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Not reachable from a test"><code>app.MapGet("/payments/{id}", (string id, IPaymentStore store) =&gt;
    store.Find(id) is { } p ? Results.Ok(p) : Results.NotFound());</code></pre>

  <p>There is no name to call. The only way to exercise it is to start a host and send a request.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs — an ordinary method"><code>app.MapGet("/payments/{id}", PaymentEndpoints.Get);

public static class PaymentEndpoints
{
    // The response set is in the signature: the compiler checks it and OpenAPI
    // reads it without any attribute.
    public static Results&lt;Ok&lt;Payment&gt;, NotFound&gt; Get(string id, IPaymentStore store) =&gt;
        store.Find(id) is { } payment
            ? TypedResults.Ok(payment)
            : TypedResults.NotFound();
}</code></pre>

  <pre data-lang="console" data-title="04-exercises.cs"><code>   called directly, with no host running:

     PaymentEndpoints.Get("PAY-1", store)   Ok&#96;1
     PaymentEndpoints.Get("PAY-9", store)   NotFound
     controller.Find("PAY-1", store)        OkObjectResult

     and the payload, without serialising: Payment { Id = PAY-1, AmountMinor = 123450 }</code></pre>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Handler shape</th><th>Unit-testable?</th><th>What you must arrange</th></tr></thead>
      <tbody>
        <tr><td>Minimal lambda</td><td><strong>No</strong></td><td>A whole host</td></tr>
        <tr><td>Minimal named method</td><td>Yes</td><td>Nothing</td></tr>
        <tr><td>Controller action</td><td>Yes</td><td><code>ControllerBase</code> brings <code>HttpContext</code>, <code>ModelState</code>, <code>User</code> and <code>Url</code> — an action touching any of them needs them populated</td></tr>
      </tbody>
    </table>
  </div>

  <p>Extracting the method is one line and it removes the only real difference. That most minimal-API
  code in the wild does not do it is a fact about habits rather than about the style.</p>

  <p><strong>Note the return type.</strong> <code>Results&lt;Ok&lt;Payment&gt;, NotFound&gt;</code>
  states the two possible responses in the signature, so the compiler checks the set, OpenAPI reads them
  without attributes, and a test asserts on a type. Controllers have no equivalent —
  <code>IActionResult</code> says nothing, and <code>[ProducesResponseType]</code> is a separate claim
  nobody verifies against the code.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The caveat applies to both styles equally: <strong>a unit test of a handler tests no routing, no
    model binding, no filters, no validation and no serialisation.</strong></p>
    <p>Every bug measured in this module lives <em>outside</em> the handler. The tests that catch them
    are integration tests either way, which makes the testability argument a much smaller reason to
    prefer one style than it is usually made out to be.</p>
  </div>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p class="define"><span class="define__term">Route group</span> A set of endpoints sharing a prefix
  and anything applied to it — filters, metadata, authorisation. The unit at which cross-cutting
  behaviour is declared once rather than per endpoint.</p>

  <p>Back to the port. Five requests — one valid, four not — against four versions:</p>

  <pre data-lang="console" data-title="03-production.cs"><code>   version                              accepted   rejected   bad rows
   -------                              --------   --------   --------
   v1  the original controller                 1          4          0
   v2  ported, as written                      5          0          4
   v3  ported, validating by hand              1          4          0
   v4  ported, validating in a filter          1          4          0</code></pre>

  <p><strong>v2 accepts all five.</strong> The attributes are still on the type; nothing reads them.
  Four bad rows in the ledger, and every response was a 200 that the client had no reason to
  question.</p>

  <p>The shape of this is worth naming: <strong>a default was removed by a change that did not mention
  it.</strong> Nobody deleted a validation call, because there was never a validation call to delete.</p>

  <p><strong>v3 validates by hand</strong> in the handler. It works, and it is the version that gets
  written under pressure — which means the next endpoint gets a slightly different version of the same
  four lines, and the one after that forgets one of them.</p>

  <p><strong>v4 validates in an endpoint filter applied to the whole group.</strong> Same outcome,
  declared once, and an endpoint added later cannot miss it:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>public static class ValidationFilter
{
    public static async ValueTask&lt;object?&gt; Validate(EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        foreach (object? argument in context.Arguments)
        {
            if (argument is null)
            {
                continue;
            }

            var validationContext = new ValidationContext(argument);
            var errors = new List&lt;ValidationResult&gt;();

            if (Validator.TryValidateObject(argument, validationContext, errors,
                validateAllProperties: true))
            {
                continue;
            }

            return Results.ValidationProblem(errors.ToDictionary(
                error =&gt; error.MemberNames.FirstOrDefault() ?? "request",
                error =&gt; new[] { error.ErrorMessage ?? "invalid" }));
        }

        return await next(context);
    }
}</code></pre>

  <p>And the .NET 10 built-in, which does the same job:</p>

  <pre data-lang="csharp" data-net="10" data-title="The framework version"><code>builder.Services.AddValidation();

var payments = app.MapGroup("/v1/payments").WithValidation();

payments.MapPost("/", PaymentEndpoints.Create);</code></pre>

  <p>In .NET 10 the framework ships this — <code>builder.Services.AddValidation()</code> plus
  <code>.WithValidation()</code> on the group does what the filter above does by hand. It is written out
  because the mechanism is worth seeing once, and because the same filter is where anything the built-in
  does not cover would go.</p>

  <h3>The whole contract in one file</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — A minimal API with every convention [ApiController]
// would have supplied made explicit, and every handler an extracted method.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and body shape here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;
using Microsoft.AspNetCore.Http.HttpResults;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The error envelope. Without this a minimal endpoint returns a bare status
// code where a controller would return a ProblemDetails document, so a client
// would have to handle two shapes.
builder.Services.AddProblemDetails();

builder.Services.AddSingleton&lt;IPaymentStore, InMemoryStore&gt;();

var app = builder.Build();

// AddProblemDetails() on its own is not enough. It registers the SERVICE that
// writes the document; a result like TypedResults.NotFound() writes no body at
// all, so nothing invokes it. UseStatusCodePages() is what fills a bodyless
// error response in. Measured: without it a 404 has an empty body and no
// content type; with it, application/problem+json carrying a traceId.
app.UseStatusCodePages();

// ===========================================================================
// One group carrying everything that would otherwise be per-endpoint. An
// endpoint added later inherits all of it and cannot forget any of it - which
// is the whole reason to write it here rather than in each handler.
// ===========================================================================
var payments = app.MapGroup("/v1/payments")
    .WithTags("payments")
    .AddEndpointFilter(ValidationFilter.Validate);

payments.MapGet("/{id}", PaymentEndpoints.Get);
payments.MapPost("/", PaymentEndpoints.Create);

app.MapGet("/health", () =&gt; Results.Ok(new { status = "healthy" }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("A minimal API with the conventions written down");
Console.WriteLine();
Console.WriteLine("   request                                    status   body");
Console.WriteLine("   -------                                    ------   ----");

await ShowGet(http, "/health", "public");
await ShowPost(http, """{"amountMinor": 123450, "currency": "GBP"}""", "valid");
await ShowPost(http, """{"amountMinor": -5, "currency": "GBP"}""", "negative amount");
await ShowPost(http, """{"amountMinor": 100, "currency": "POUNDS"}""", "invented currency");
await ShowGet(http, "/v1/payments/PAY-0001", "found");
await ShowGet(http, "/v1/payments/PAY-9999", "not found");

Console.WriteLine();
Console.WriteLine("   Both handlers are ordinary static methods, so a test calls them with a");
Console.WriteLine("   fake store and no host at all:");
Console.WriteLine();

var store = new InMemoryStore();
store.Save(new Payment("PAY-0001", 123450, "GBP"));

Results&lt;Ok&lt;Payment&gt;, NotFound&gt; direct = PaymentEndpoints.Get("PAY-0001", store);
Results&lt;Ok&lt;Payment&gt;, NotFound&gt; absent = PaymentEndpoints.Get("PAY-9999", store);

Console.WriteLine($"     PaymentEndpoints.Get(\"PAY-0001\", store)  -&gt; {direct.Result.GetType().Name}");
Console.WriteLine($"     PaymentEndpoints.Get(\"PAY-9999\", store)  -&gt; {absent.Result.GetType().Name}");

if (direct.Result is Ok&lt;Payment&gt; ok)
{
    Console.WriteLine($"     and the value, unserialised             -&gt; {ok.Value}");
}

Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - AddProblemDetails() AND UseStatusCodePages(), so errors have the");
Console.WriteLine("       same shape a controller would have produced - the first alone");
Console.WriteLine("       leaves a bodyless 404 bodyless");
Console.WriteLine("     - validation applied to the GROUP, so it cannot be forgotten by an");
Console.WriteLine("       endpoint added next month");
Console.WriteLine("     - every handler an extracted static method, so it is callable from a");
Console.WriteLine("       test with no host");
Console.WriteLine("     - typed results, so the response set is in the signature where the");
Console.WriteLine("       compiler checks it and OpenAPI can read it");
Console.WriteLine("     - /health outside the group, so nothing applies to it by accident");
Console.WriteLine();
Console.WriteLine("   Each of those replaces something [ApiController] would have done");
Console.WriteLine("   invisibly. That is the trade this module is about: the behaviour is");
Console.WriteLine("   the same either way, and here it is legible and per-group rather than");
Console.WriteLine("   implicit and per-attribute.");
Console.WriteLine();
Console.WriteLine("   In .NET 10 the validation filter can be replaced by the built-in:");
Console.WriteLine();
Console.WriteLine("     builder.Services.AddValidation();");
Console.WriteLine("     var payments = app.MapGroup(\"/v1/payments\").WithValidation();");
Console.WriteLine();
Console.WriteLine("   The hand-written one is kept here because the mechanism is worth seeing");
Console.WriteLine("   once, and because it is where anything the built-in does not cover");
Console.WriteLine("   would go.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task ShowGet(HttpClient http, string path, string note)
{
    using HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();
    Console.WriteLine($"   GET {path,-38}{(int)response.StatusCode,6}   {Trim(body)}");
    Console.WriteLine($"   {"",-42}         {note}");
}

static async Task ShowPost(HttpClient http, string json, string note)
{
    using var content = new StringContent(json, Encoding.UTF8, "application/json");
    using HttpResponseMessage response = await http.PostAsync("/v1/payments", content);
    string body = await response.Content.ReadAsStringAsync();
    Console.WriteLine($"   POST /v1/payments {note,-24}{(int)response.StatusCode,6}   {Trim(body)}");
}

static string Trim(string body) =&gt;
    body.Length == 0 ? "(empty)" : body.Length &gt; 76 ? body[..76] + "..." : body;

// ---------------------------------------------------------------------------
public record Payment(string Id, long AmountMinor, string Currency);

public sealed class CreatePayment
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public string Currency { get; set; } = "";
}

public interface IPaymentStore
{
    Payment? Find(string id);

    void Save(Payment payment);

    int Count { get; }
}

public sealed class InMemoryStore : IPaymentStore
{
    private readonly Dictionary&lt;string, Payment&gt; _payments = new();

    public int Count =&gt; _payments.Count;

    public Payment? Find(string id) =&gt; _payments.GetValueOrDefault(id);

    public void Save(Payment payment) =&gt; _payments[payment.Id] = payment;
}

// ---------------------------------------------------------------------------
// The handlers, as named methods. Nothing here knows about HTTP beyond the
// result type, so a test constructs a store and calls them.
public static class PaymentEndpoints
{
    public static Results&lt;Ok&lt;Payment&gt;, NotFound&gt; Get(string id, IPaymentStore store) =&gt;
        store.Find(id) is { } payment
            ? TypedResults.Ok(payment)
            : TypedResults.NotFound();

    public static Results&lt;Created&lt;Payment&gt;, ValidationProblem&gt; Create(
        CreatePayment body, IPaymentStore store)
    {
        var payment = new Payment($"PAY-{store.Count + 1:D4}", body.AmountMinor, body.Currency);
        store.Save(payment);
        return TypedResults.Created($"/v1/payments/{payment.Id}", payment);
    }
}

// ---------------------------------------------------------------------------
// What [ApiController] would have done invisibly, written down once and
// applied to a group.
public static class ValidationFilter
{
    public static async ValueTask&lt;object?&gt; Validate(EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        foreach (object? argument in context.Arguments)
        {
            if (argument is null)
            {
                continue;
            }

            var validationContext = new ValidationContext(argument);
            var errors = new List&lt;ValidationResult&gt;();

            if (Validator.TryValidateObject(argument, validationContext, errors,
                validateAllProperties: true))
            {
                continue;
            }

            return Results.ValidationProblem(errors.ToDictionary(
                error =&gt; error.MemberNames.FirstOrDefault() ?? "request",
                error =&gt; new[] { error.ErrorMessage ?? "invalid" }));
        }

        return await next(context);
    }
}</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   request                                    status   body
   -------                                    ------   ----
   GET /health                                  200   {"status":"healthy"}
   POST /v1/payments valid                      201   {"id":"PAY-0001","amountMinor":123450,...
   POST /v1/payments negative amount            400   {"type":"...","title":"One or...
   POST /v1/payments invented currency          400   {"type":"...","title":"One or...
   GET /v1/payments/PAY-0001                    200   {"id":"PAY-0001","amountMinor":123450,...
   GET /v1/payments/PAY-9999                    404   {"type":"...","title":"Not Fo...</code></pre>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger takes about 400 payments an hour. If a tenth of requests carry a validation error — a
    client bug, a bad form, a retried stale request — that is roughly 40 an hour, or <strong>about 960
    bad rows in the day before somebody noticed</strong>.</p>
    <p>Each one has to be found and reversed. Negative amounts are findable with a query. A currency
    code of <code>POUNDS</code> is findable. <strong>A valid-looking amount that failed a business rule
    nobody encoded as an annotation is not findable at all.</strong></p>
    <p>Three controls would each have caught it, in increasing order of value:</p>
    <ol>
      <li><strong>A test per request type that posts an invalid body and asserts 400.</strong> Three
      lines, fails on the port, and the only item here that would have caught it on the day.</li>
      <li><strong>Validation applied to a group rather than an endpoint</strong>, so that "does this
      endpoint validate?" has one answer for the whole group.</li>
      <li><strong>A database constraint</strong> — <code>amount_minor &gt; 0</code> and a currency
      foreign key would have rejected all four rows regardless of which framework was in front.</li>
    </ol>
    <p>The third is the one people skip because the first two feel like enough. This incident is the
    argument that they are not: both of the first two are things a change can silently remove, and a
    <code>CHECK</code> constraint is not.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Porting a controller and losing its conventions</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a correct translation that loses validation"><code>// was: [HttpPost("payments")] public IActionResult Create(CreatePayment body)
app.MapPost("/payments", (CreatePayment body, IPaymentStore store) =&gt;
{
    store.Save(body);
    return Results.Ok(new { accepted = body.AmountMinor });
});</code></pre>

  <p>Symptom: invalid requests start succeeding, silently. Cause: <code>[ApiController]</code> was
  validating and has no representation in the ported code. Fix: a validation filter on the group, or
  <code>AddValidation()</code>.</p>

  <h3>Validation added per endpoint</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the twentieth endpoint will forget"><code>app.MapPost("/payments", (CreatePayment body) =&gt;
{
    if (body.AmountMinor &lt; 1)
    {
        return Results.BadRequest(new { error = "amount must be positive" });
    }

    return Results.Ok(body);
});

app.MapPost("/refunds", (CreateRefund body) =&gt;
{
    // The same four lines again, slightly different - or missing entirely,
    // which is what happened here.
    return Results.Ok(body);
});</code></pre>

  <p>Symptom: nineteen endpoints validate and the twentieth does not. Cause: the check lives in each
  handler, so a new endpoint starts without it. Fix: apply it to the group.</p>

  <h3>A handler written as a lambda</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - nothing to call from a test"><code>app.MapGet("/payments/{id}", (string id, IPaymentStore store) =&gt;
    store.Find(id) is { } p ? Results.Ok(p) : Results.NotFound());</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right - one line moved"><code>app.MapGet("/payments/{id}", PaymentEndpoints.Get);</code></pre>

  <p>Symptom: no unit test exists, and adding one means starting a host. Cause: there is no name to
  call. Fix: extract a named static method — one line.</p>

  <h3>A controller filter that sets Result and calls next anyway</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong"><code>context.Result = new BadRequestObjectResult(new { error = "rejected" });
await next();   // runs the action anyway and discards the result above</code></pre>

  <p>Symptom: a filter appears to do nothing. Fix: <code>return</code> without calling <code>next</code>.
  The minimal-API form cannot express this mistake.</p>

  <h3>A filter reading arguments by position</h3>

  <p>Symptom: a filter starts reading the wrong value after somebody reorders the handler's parameters.
  Cause: <code>GetArgument&lt;T&gt;(0)</code> is not checked at compile time. Fix: none that is
  satisfying — keep filters that read arguments close to the handler they wrap, and prefer filters that
  read the <code>HttpContext</code> instead where possible.</p>

  <h3>AddProblemDetails without UseStatusCodePages</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - half the job"><code>builder.Services.AddProblemDetails();
// and nothing else</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right"><code>builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseStatusCodePages();</code></pre>

  <p>Symptom: 400s have a document body and 404s have an empty one. Cause: the service writes documents
  but nothing invokes it for a result that wrote no body. Fix: add
  <code>app.UseStatusCodePages()</code>.</p>

  <h3>Mixed error shapes across styles</h3>

  <p>Symptom: clients need two error-handling paths in one API. Cause: controllers produce
  <code>ProblemDetails</code> and minimal endpoints produce bare status codes. Fix:
  <code>AddProblemDetails()</code> plus <code>UseStatusCodePages()</code>, so both produce the same
  envelope.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>Almost every difference between the two styles shows up as <strong>a request that should have
    been rejected and was not</strong>, or <strong>a response body that is a different shape from the
    one next to it</strong>. Both are invisible from inside a handler, so the diagnostic is always the
    same: send a deliberately bad request and look at the whole response.</p>
    <pre data-lang="bash" data-title="The three-line check"><code>curl -i -X POST https://api.ledger.example/v1/payments \
  -H "Content-Type: application/json" \
  -d '{"amountMinor": -1, "currency": "XXXX"}'</code></pre>
    <p>A 200 means nothing is validating. A 400 with an empty body means validation is running and the
    error envelope is not configured. A 400 with a <code>problem+json</code> document means both are
    right.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Look at</th><th>What you are looking for</th></tr></thead>
      <tbody>
        <tr>
          <td>Invalid data reaching the database</td>
          <td>Whether the endpoint is minimal or a controller</td>
          <td>A minimal endpoint with annotations on its request type and nothing reading them</td>
        </tr>
        <tr>
          <td>Some endpoints validate and some do not</td>
          <td>Whether validation is on the group or in each handler</td>
          <td>A handler that predates the filter, or one registered outside the group</td>
        </tr>
        <tr>
          <td>Two error shapes in one API</td>
          <td><code>AddProblemDetails</code> and <code>UseStatusCodePages</code></td>
          <td>One present without the other, or neither</td>
        </tr>
        <tr>
          <td>A 404 with an empty body</td>
          <td><code>UseStatusCodePages</code></td>
          <td>Missing. <code>AddProblemDetails</code> alone does not fill a bodyless response</td>
        </tr>
        <tr>
          <td>A filter reads the wrong argument</td>
          <td>The handler's parameter order</td>
          <td>Somebody reordered parameters and <code>GetArgument&lt;T&gt;(0)</code> now points elsewhere</td>
        </tr>
        <tr>
          <td>A controller filter appears to do nothing</td>
          <td>Whether it sets <code>Result</code> and still calls <code>next()</code></td>
          <td>The action ran and replaced the result</td>
        </tr>
        <tr>
          <td>A JSON body binds to an all-default object</td>
          <td>Whether the controller has <code>[ApiController]</code></td>
          <td>Without it, a complex parameter is inferred from the <em>form</em>, not the body — so JSON binds to nothing and nothing errors</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Data annotations validate the request. They are on the type."</em></p>
    <p>Something has to read them. <code>[ApiController]</code> does; a minimal API does not, until you
    add a filter or <code>AddValidation()</code>. Measured: the same type, the same attributes, 400 in
    one style and 200 in the other.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Minimal APIs are not testable."</em></p>
    <p>A minimal <em>lambda</em> is not. A named static method is an ordinary method that a test calls
    with fakes and no host at all — and its typed result gives you the payload without serialising.
    Extracting the method is one line.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Controllers are testable, so unit tests cover the endpoint."</em></p>
    <p>A unit test of a handler tests no routing, binding, filters, validation or serialisation — which
    is where every bug in this module lives. That argument cuts against both styles equally.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Porting to minimal APIs is a mechanical translation."</em></p>
    <p>It is, and that is the problem. Every line of the port measured above is correct; what was lost
    has no representation in either file. Any migration loses whatever the old framework did by default
    and the new one does not.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"I should pick one style and rewrite everything in it."</em></p>
    <p>Both run side by side in one application — this module's first file does exactly that. A port
    buys nothing a customer can see, and it costs what section 6 measured.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"AddProblemDetails() gives every response a consistent error body."</em></p>
    <p>It registers the writer. A result that writes no body — <code>TypedResults.NotFound()</code> —
    still produces an empty one until <code>UseStatusCodePages()</code> is added.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <p>The choice between the two styles is smaller than the arguments about it. What is not small is
  <strong>whether the cross-cutting behaviour of your API is written down somewhere a person can
  read</strong>.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Decision</th><th>Cost to get right</th><th>Cost of getting it wrong</th></tr></thead>
      <tbody>
        <tr><td>Validation applied to a group</td><td>One filter, one line per group</td><td>~960 invalid rows in a day, from a diff that read correctly</td></tr>
        <tr><td>Handlers as named methods</td><td>One line each</td><td>No unit test is possible without a host</td></tr>
        <tr><td><code>AddProblemDetails</code> + <code>UseStatusCodePages</code></td><td>Two lines</td><td>Clients handle two error shapes in one API</td></tr>
        <tr><td>Typed results</td><td>A return type</td><td>The response set is undocumented and unchecked</td></tr>
        <tr><td>A database constraint behind all of it</td><td>One <code>CHECK</code></td><td>The only defence a framework change cannot silently remove</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>The recommendation, stated plainly:</strong> for a new API, minimal APIs — with the
  cross-cutting behaviour on route groups and every handler an extracted named method. The behaviour is
  visible, the response set is in the signature where the compiler checks it, there is one filter
  concept instead of five, and it is where the framework is investing.</p>

  <p><strong>If forty controllers already exist, keep them.</strong> That is the boring answer and it is
  the right one. Write new endpoints minimally, leave the forty alone, and port one only when you are
  already rewriting it for a reason of its own. The one thing worth doing across both is making the
  error envelope identical, so a client sees one contract regardless of which style answered.</p>

  <p>And the general lesson, which outlives this comparison: <strong>a framework's defaults are part of
  your system's behaviour, and they are the part that does not appear in your code.</strong> When you
  change frameworks, change hosting models, or upgrade a major version, the risk is never the code you
  can see in the diff.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>The same request type with the same attributes, the same invalid body, sent to a minimal endpoint
    and to a controller. What does each return?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   /minimal   200  {"got":-5}
   /mvc       400  {"type":"...","title":"One or more validati...</code></pre>
        <p><strong>The minimal endpoint accepts it.</strong> The attributes are on the type, the values
        violate them, and nothing reads them.</p>
        <p>The controller rejects it with 400 and a <code>ValidationProblemDetails</code> body — and no
        line of the controller does that. <code>[ApiController]</code> does, along with four other
        behaviours: binding source inference, <code>ProblemDetails</code> for error codes, required
        attribute routing, and multipart inference for <code>IFormFile</code>.</p>
        <p>This is a difference in <em>defaults</em>, not in what is possible. .NET 10 ships
        <code>builder.Services.AddValidation()</code> for minimal APIs — but you have to ask, and a team
        arriving from controllers does not know to.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>A group filter and an endpoint filter. In what order do they run, and what can each see?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>     group IN
     endpoint IN (arg 0 = PAY-1)
     handler
     endpoint OUT (result = Ok&#96;1)
     group OUT</code></pre>
        <p>The group filter is <em>outside</em> the endpoint filter — they nest exactly like middleware,
        outermost registered first in and last out.</p>
        <p>Each sees the <strong>bound arguments</strong> and the <strong>result</strong>. That is the
        difference from middleware, which sees neither: middleware runs before binding and receives an
        <code>HttpContext</code>; a filter runs after binding and receives the values.</p>
        <p>The access is <em>by position</em> — <code>GetArgument&lt;string&gt;(0)</code> — which is not
        checked at compile time and breaks silently when somebody reorders the handler's parameters.
        MVC's equivalent is keyed by name and breaks on a rename. Neither is safe.</p>
        <p>To short-circuit, <strong>return</strong> a result instead of calling <code>next</code>. In a
        controller filter you set <code>context.Result</code> instead — and setting it and then calling
        <code>next()</code> anyway runs the action and discards your result, a mistake the minimal form
        cannot express.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>"Controllers are testable and minimal APIs are not." Is that true?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   called directly, with no host running:

     PaymentEndpoints.Get("PAY-1", store)   Ok&#96;1
     PaymentEndpoints.Get("PAY-9", store)   NotFound
     controller.Find("PAY-1", store)        OkObjectResult

     and the payload, without serialising: Payment { Id = PAY-1, AmountMinor = 123450 }</code></pre>
        <p><strong>True of one way of writing minimal APIs and false of the others.</strong></p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Shape</th><th>Testable?</th><th>Arrange</th></tr></thead>
            <tbody>
              <tr><td>A lambda</td><td>No — there is no name to call</td><td>A whole host</td></tr>
              <tr><td>A named method</td><td>Yes</td><td>Nothing</td></tr>
              <tr><td>A controller action</td><td>Yes</td><td><code>ControllerBase</code>'s <code>HttpContext</code>, <code>ModelState</code>, <code>User</code>, <code>Url</code> — if the action touches them</td></tr>
            </tbody>
          </table>
        </div>
        <p>Extracting the method is one line and removes the only real difference.</p>
        <p><strong>Note the return type.</strong> <code>Results&lt;Ok&lt;Payment&gt;, NotFound&gt;</code>
        states the possible responses in the signature, so the compiler checks the set, OpenAPI gets
        them without attributes, and a test asserts on a type. Controllers have no equivalent.</p>
        <p><strong>And the caveat for both:</strong> a unit test of a handler tests no routing, binding,
        filters, validation or serialisation. Every bug in this module lives outside the handler, so the
        tests that catch them are integration tests either way.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>An endpoint is ported from a controller to a minimal API. The request type and its attributes are
    untouched. What breaks, and what would have caught it?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   version                          accepted   rejected
   -------                          --------   --------
   controller                              1          4
   ported, as written                      5          0
   ported, validated in a filter           1          4</code></pre>
        <p>Of the five, one is valid. <strong>The ported version accepts all five.</strong></p>
        <p>The port was not wrong — every line is a correct translation. What was lost is not in either
        file: it is a behaviour <code>[ApiController]</code> contributed, with no representation in the
        code being ported. <strong>A default was removed by a change that did not mention it.</strong>
        The diff cannot show it, and a review of the diff cannot catch it.</p>
        <p><strong>What would have caught it,</strong> in increasing order of value:</p>
        <ol>
          <li>A test that posts an invalid body and asserts 400. Three lines, fails on the port, and the
          only item here that would have caught it on the day.</li>
          <li>Validation applied to a group rather than per endpoint, so that "does this endpoint
          validate?" has one answer for the whole group. In .NET 10 that is <code>AddValidation()</code>
          plus <code>WithValidation()</code>.</li>
          <li>A database constraint — <code>amount_minor &gt; 0</code>, a currency foreign key. It would
          have rejected all four regardless of framework.</li>
        </ol>
        <p>The third is the one people skip because the first two feel like enough. Both of the first two
        are things a change can silently remove; a <code>CHECK</code> constraint is not.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>You are starting a new payments API. Pick a style and defend it. Then say what you would do if the
    team had already written forty controllers.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Minimal APIs</strong>, with the cross-cutting behaviour applied to route groups, and
        every handler an extracted named method rather than a lambda.</p>
        <p>The defence, in the order the reasons actually matter:</p>
        <ol>
          <li><strong>The behaviour is visible.</strong> Everything <code>[ApiController]</code> does
          invisibly — validation, <code>ProblemDetails</code>, binding inference — is a line you wrote
          and can read. The incident in this module is entirely about a behaviour nobody could see.</li>
          <li><strong>Typed results.</strong>
          <code>Results&lt;Ok&lt;T&gt;, NotFound, ValidationProblem&gt;</code> puts the response set in
          the signature, where the compiler checks it and OpenAPI reads it.</li>
          <li><strong>One filter concept instead of five</strong>, and no base class to inherit or
          arrange in a test.</li>
          <li><strong>It is where the framework is going</strong> — validation in .NET 10, OpenAPI, and
          the AOT-friendly request-delegate generator all arrived for minimal APIs first.</li>
        </ol>
        <p><strong>The honest costs:</strong></p>
        <ul>
          <li>You must remember what controllers do for you. If nobody on the team has read this module,
          controllers are safer.</li>
          <li>Organising sixty endpoints across files is a convention you have to invent. Controllers
          give you one for free, and a class per resource is a genuinely good default.</li>
          <li>Some things are still MVC-only or MVC-first: model binders, output formatters, views, and
          anything a library ships as an <code>IActionFilter</code>.</li>
        </ul>
        <p><strong>If forty controllers already exist: keep them.</strong> A port buys nothing a customer
        can see, and this module measured what it costs. Both styles run side by side in one application
        — write new endpoints minimally, leave the forty alone, and port one only when you are already
        rewriting it for a reason of its own.</p>
        <p>The one thing worth doing across both: make the error envelope the same.
        <code>AddProblemDetails()</code> and <code>UseStatusCodePages()</code> give minimal endpoints the
        shape <code>[ApiController]</code> already produces, so a client sees one contract regardless of
        which style answered.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Do data annotations on a request type validate anything in a minimal API?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. Something has to read them. <code>[ApiController]</code> does;
        a minimal API does not until you add a filter or <code>AddValidation()</code>.</p></div></details></li>

    <li><p>Name three of the five behaviours <code>[ApiController]</code> turns on.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Automatic 400 on validation failure; binding source inference;
        <code>ProblemDetails</code> for error status codes; required attribute routing; multipart
        inference for <code>IFormFile</code>.</p></div></details></li>

    <li><p>Where does an endpoint filter run relative to middleware, and what can it see that middleware
    cannot?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Inside the endpoint, after every middleware. It sees the
        <em>bound arguments</em> and the <em>result</em>; middleware runs before binding and sees
        neither.</p></div></details></li>

    <li><p>How does a filter reject a request in each style?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Minimal: <code>return</code> a result instead of calling
        <code>next</code>. Controller: set <code>context.Result</code> and do <em>not</em> call
        <code>next()</code> — calling it anyway runs the action and discards your
        result.</p></div></details></li>

    <li><p>Which minimal-API handler shapes can be unit-tested without a host?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A named method — an ordinary method you call with fakes. A lambda
        cannot, because there is no name to call.</p></div></details></li>

    <li><p>What does <code>Results&lt;Ok&lt;T&gt;, NotFound&gt;</code> buy over
    <code>IResult</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The response set is in the signature: the compiler checks it,
        OpenAPI reads it without attributes, and a test asserts on a type rather than on a serialised
        body.</p></div></details></li>

    <li><p>Why is <code>AddProblemDetails()</code> not enough on its own?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It registers the writer. A result that writes no body — a bare
        404 — still produces an empty one until <code>app.UseStatusCodePages()</code> is
        added.</p></div></details></li>

    <li><p>What is the general lesson from the port that lost validation?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A default was removed by a change that did not mention it. Any
        migration loses whatever the old framework did by default and the new one does not — and the
        diff cannot show it.</p></div></details></li>

    <li><p>What does a unit test of a handler <em>not</em> cover, in either style?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Routing, model binding, filters, validation and serialisation —
        which is where every bug in this module lives.</p></div></details></li>

    <li><p>You inherit forty controllers and prefer minimal APIs. What do you do?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Keep them. Write new endpoints minimally, port only when rewriting
        for another reason, and make the error envelope identical across both so clients see one
        contract.</p></div></details></li>
  </ol>
</section>
`
});
