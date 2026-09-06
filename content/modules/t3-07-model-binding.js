CSPREP.module({
  id: "t3-07-model-binding",
  minutes: 55,
  updated: "2026-09-03",
  summary: "Ledger's mobile client moves to a JSON library configured for snake_case, and amountMinor becomes amount_minor. Every request still returns 201. Request rate, error rate and latency are unchanged for four days, while about 1,400 payments are recorded as zero pounds. Measured here: parameters fail loudly - an unparseable query value is a 400 whatever the parameter type - and body properties fail silently, because ignoring unknown members is what lets a client add a field without breaking an older server.",
  terms: ["model binding", "binding source", "FromRoute", "FromQuery", "FromHeader", "FromBody",
    "FromServices", "FromForm", "inference", "TryParse", "IParsable", "BindAsync", "AsParameters",
    "required member", "UnmappedMemberHandling", "case-insensitive matching", "default value"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger's mobile client ships a release. Part of it is a move to a different JSON library,
  configured with a snake_case naming policy — a tidy-up nobody thought was a contract change.</p>

  <p>The field that was <code>amountMinor</code> is now <code>amount_minor</code>.</p>

  <p>Every request still returns 201. The client still shows a success screen. Request rate, error rate
  and latency are all unchanged, <strong>because nothing failed</strong>. Support notices four days
  later: a merchant's dashboard is full of payments of GBP 0.00.</p>

  <pre data-lang="console" data-title="03-production.cs"><code>   version                            201   400   zero-value rows
   -------                            ---   ---   ---------------
   v1  a plain settable class          4     0                 3
   v2  plus [Range(1, ...)]            1     3                 0
   v3  required members                1     3                 0
   v4  unknown members disallowed      1     3                 0</code></pre>

  <p>The renamed property matched nothing on the type, so it was <strong>ignored</strong> and the
  property kept its default of zero. The JSON was valid, the body deserialised, and the handler ran
  normally.</p>

  <p>This module is about the step where that happened: <strong>model binding</strong>. Where each
  handler parameter comes from, and which failures are loud and which are silent.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every status code and bound value in this module was produced by running the programs shown and
    pasted in unedited. Binding does not depend on timing, so all of it is deterministic.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What binding is</h2>

  <p class="define"><span class="define__term">Model binding</span> Filling a handler's parameters from
  the incoming request. The framework looks at each parameter's name and type, decides where the value
  should come from, and produces it.</p>

  <p class="define"><span class="define__term">Binding source</span> The place a value is taken from —
  the route, the query string, a header, the body, a form, or the dependency container.</p>

  <p class="define"><span class="define__term">Inference</span> The framework choosing a source without
  being told. Most sources are inferred, which is why most handlers have no attributes on them.</p>

  <p class="define"><span class="define__term">Deserialisation</span> Turning the JSON body into an
  object. It is a separate step from binding the other parameters, and — as this module measures — it
  fails in a completely different way.</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — Where each parameter came from, without a single attribute.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddSingleton&lt;IClock, SystemClock&gt;();

var app = builder.Build();

// Four parameters, four different sources, and nothing says so. The framework
// infers each one from its NAME and its TYPE.
app.MapPost("/payments/{id}", (
    string id,          // matches a route parameter -&gt; from the ROUTE
    int retries,        // no route match, simple type -&gt; from the QUERY
    CreatePayment body, // complex type -&gt; from the BODY
    IClock clock)       // registered in the container -&gt; from SERVICES
    =&gt; new
    {
        id,
        retries,
        amount = body.AmountMinor,
        clock = clock.Name
    });

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

using var content = new StringContent("""{"amountMinor": 123450}""",
    System.Text.Encoding.UTF8, "application/json");

Console.WriteLine("POST /payments/PAY-1?retries=2  body {\"amountMinor\": 123450}");
Console.WriteLine();
Console.WriteLine($"  -&gt; {await (await http.PostAsync("/payments/PAY-1?retries=2", content))
    .Content.ReadAsStringAsync()}");
Console.WriteLine();
Console.WriteLine("Four sources, no attributes. The rules are:");
Console.WriteLine();
Console.WriteLine("  a name matching a route parameter   the route");
Console.WriteLine("  a simple type otherwise             the query string");
Console.WriteLine("  a complex type                      the body, as JSON");
Console.WriteLine("  a type registered in the container  services");
Console.WriteLine();
Console.WriteLine("Everything else in this module is what happens when a rule");
Console.WriteLine("applies and you did not expect it to.");

await app.StopAsync();

// ---------------------------------------------------------------------------
public sealed class CreatePayment
{
    public long AmountMinor { get; set; }
}

public interface IClock
{
    string Name { get; }
}

public sealed class SystemClock : IClock
{
    public string Name =&gt; "SystemClock";
}</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>POST /payments/PAY-1?retries=2  body {"amountMinor": 123450}

  -&gt; {"id":"PAY-1","retries":2,"amount":123450,"clock":"SystemClock"}</code></pre>

  <p class="define"><span class="define__term">Simple type</span> A type the framework can build from a
  single string: <code>int</code>, <code>string</code>, <code>Guid</code>, <code>DateTime</code>, an
  enum, or anything with a <code>TryParse</code>. Simple types bind from the route or the query.</p>

  <p class="define"><span class="define__term">Complex type</span> Anything else - a class or record
  with properties. Complex types bind from the body, unless marked <code>[AsParameters]</code>.</p>

  <p class="define"><span class="define__term">Default value</span> What a property holds when nothing
  assigns it: 0 for a number, <code>null</code> for a reference, <code>false</code> for a bool,
  <code>0001-01-01</code> for a date. Every silent failure in this module ends with one of these.</p>

  <p class="define"><span class="define__term">Handler parameter</span> One argument of the method or
  lambda that handles the request. Binding fills each one independently, from a source chosen per
  parameter - so one handler can read from four places at once.</p>

  <p>Four sources, no attributes. The rules are:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>The parameter</th><th>Comes from</th></tr></thead>
      <tbody>
        <tr><td>Has a name matching a route parameter</td><td>The route</td></tr>
        <tr><td>Is a simple type otherwise</td><td>The query string</td></tr>
        <tr><td>Is a complex type</td><td>The body, as JSON</td></tr>
        <tr><td>Is a type registered in the container</td><td>Services</td></tr>
      </tbody>
    </table>
  </div>

  <h3>An analogy, and where it stops working</h3>

  <p>Binding is like a form-filling clerk. Handed a stack of paperwork, they copy each value into the
  right box on your form: the reference number from the top of the letter, the amount from the enclosed
  slip, the date from the postmark. They work from the labels on your form, not from the paperwork's own
  structure.</p>

  <p><strong>This is an analogy and it breaks in exactly the place this module is about.</strong> A
  clerk who could not find the amount would leave a note or hand the file back. Binding does that for
  <em>parameters</em> and does not do it for <em>body properties</em> — an unmatched property is skipped
  in silence, and the box keeps whatever was already printed in it.</p>
</section>

<section id="loud-and-silent">
  <h2>Which failures are loud</h2>

  <p>Three declarations of the same query parameter, against four kinds of input:</p>

  <pre data-lang="console" data-title="04-exercises.cs"><code>   declaration      ?page=2   ?page=abc   absent    ?page=-5
   -----------      -------   ---------   ------    --------
   int page         2         400         400       -5
   int? page        2         400         null      -5
   int page = 1     2         400         1         -5</code></pre>

  <p><strong>Binding distinguishes absent from unparseable</strong>, and that is the opposite of what is
  usually assumed:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Input</th><th>Result</th></tr></thead>
      <tbody>
        <tr><td>Absent</td><td><code>null</code>, the default, or a 400 — whichever your declaration chose</td></tr>
        <tr><td>Present but unparseable</td><td><strong>400 in all three</strong>, whatever the parameter type</td></tr>
      </tbody>
    </table>
  </div>

  <p>So making a query parameter nullable or giving it a default handles <em>absence</em> only. It does
  not swallow malformed input. <code>int? page</code> means "the caller may omit this"; a null there is
  always a deliberate absence.</p>

  <p><strong>Read the last column though.</strong> <code>?page=-5</code> binds cleanly to −5 in every
  version, because −5 <em>is</em> an int. Binding asks whether a value of the type can be produced,
  never whether the value makes sense.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>Binding is not validation.</strong> A page number of −5, an amount of 0, a date in 1900 —
    all bind perfectly and all need a separate check.</p>
    <p>This is worth holding on to because the two get conflated constantly: both reject bad input with a
    400, and only one of them has any opinion about what the value means.</p>
  </div>

  <p class="define"><span class="define__term">Required parameter</span> One with no default and no
  <code>?</code>. If a value cannot be produced the request is rejected before the handler runs.</p>

  <h3>The body is different</h3>

  <pre data-lang="console" data-title="01-silent-failures.cs"><code>   body                    status   what the handler received
   ----                    ------   -------------------------
   everything correct         200   {"amount":123450,"currency":"GBP","reference":"R1"}
   AMOUNTMINOR (case)         200   {"amount":123450,"currency":"GBP","reference":"R1"}
   amount_minor (snake)       200   {"amount":0,"currency":"GBP","reference":"R1"}
   amountMinr (typo)          200   {"amount":0,"currency":"GBP","reference":"R1"}
   an extra property          200   {"amount":123450,"currency":"GBP","reference":"R1"}
   nothing at all             200   {"amount":0,"currency":null,"reference":null}</code></pre>

  <p><strong>Every one of them is a 200.</strong> Four of the six lost data, and the handler cannot tell
  which. Three separate rules are at work:</p>

  <ul>
    <li><strong>Property matching is case-insensitive by default.</strong> <code>AMOUNTMINOR</code>
    bound correctly. Convenient, and it means casing inconsistencies between clients never surface.</li>
    <li><strong>An unmatched property is ignored.</strong> <code>amount_minor</code> and
    <code>amountMinr</code> both left the property at 0, and the extra field was discarded.</li>
    <li><strong>A missing property is also a default.</strong> The empty object produced a payment of 0
    in a currency of null.</li>
  </ul>

  <h3>The asymmetry, and why it exists</h3>

  <pre data-lang="console" data-title="01-silent-failures.cs"><code>   what went wrong                              result
   ---------------                              ------
   required query value missing or unparseable  400   LOUD
   body missing, parameter not nullable         400   LOUD
   body is not valid JSON                       400   LOUD
   wrong content type                           415   LOUD
   route value fails a constraint               404   loud-ish
   optional query value unparseable             400   LOUD
   optional query value ABSENT                  200   by design
   query value present, negative or absurd      200   SILENT
   JSON property misspelled                     200   SILENT
   JSON property omitted                        200   SILENT
   extra JSON property sent                     200   SILENT</code></pre>

  <p><strong>Parameters fail loudly; body properties fail silently.</strong> The asymmetry has a
  cause.</p>

  <p>A parameter is a single value with a declared type, so failing to produce it is unambiguous. A body
  is a document being mapped onto an object, and <strong>JSON deserialisation is permissive by
  design</strong> — unknown members are ignored so that a client adding a field does not break an older
  server.</p>

  <p>That permissiveness is a genuine feature for forward compatibility, and it is the reason a
  misspelling costs you a zero rather than an error.</p>

  <p>And note the row that is silent for neither reason: a value that parses and is absurd. Nothing
  about binding has an opinion on that.</p>

  <p>One detail from that table repays a second look. <strong>Case-insensitive matching is forgiving
  about exactly one thing</strong>, and the boundary is not where people assume: <code>AMOUNTMINOR</code>
  binds and <code>amount_minor</code> does not. Casing varies between languages and serialisers as a
  matter of style; separators change when somebody switches a naming policy. So the forgiveness covers
  the difference that rarely breaks and stops precisely at the one that does.</p>

  <p>If you want to accept a different convention deliberately, name it rather than relying on the
  matcher — <code>[JsonPropertyName("amount_minor")]</code> on the property, or a naming policy on the
  serialiser options. Both are visible in the code; a silent zero is not.</p>
</section>

<section id="sources">
  <h2>The sources, and overriding the inference</h2>

  <pre data-lang="csharp" data-net="10" data-title="02-sources-and-custom.cs"><code>app.MapPost("/explicit/{id}", (
    [FromRoute] string id,
    [FromQuery] int page,
    [FromHeader(Name = "X-Tenant")] string tenant,
    [FromBody] CreatePayment body,
    [FromServices] IClock clock) =&gt; Results.Ok(new
    {
        id, page, tenant, amount = body.AmountMinor, clock = clock.Name
    }));</code></pre>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Attribute</th><th>Reads from</th><th>Inferred without it?</th></tr></thead>
      <tbody>
        <tr><td><code>[FromRoute]</code></td><td>A route parameter of that name</td><td>Yes, if the name matches</td></tr>
        <tr><td><code>[FromQuery]</code></td><td>The query string</td><td>Yes, for simple types</td></tr>
        <tr><td><code>[FromHeader]</code></td><td>A request header</td><td><strong>No — always needed</strong></td></tr>
        <tr><td><code>[FromBody]</code></td><td>The request body, as JSON</td><td>Yes, for complex types</td></tr>
        <tr><td><code>[FromServices]</code></td><td>The DI container</td><td>Yes, if registered</td></tr>
        <tr><td><code>[FromForm]</code></td><td>A form field</td><td><strong>Only in a form post</strong></td></tr>
      </tbody>
    </table>
  </div>

  <p>Four of the six are inferred. Write the attribute anyway in two cases: for
  <code>[FromHeader]</code> and <code>[FromForm]</code>, which are never inferred; and anywhere the
  inference would be <em>wrong</em>. A parameter named <code>id</code> in a route that also has an
  <code>{id}</code> always comes from the route — <code>[FromQuery]</code> is the only way to say
  otherwise.</p>

  <p><strong>Only one parameter may come from the body.</strong> The body is a stream read once, so two
  complex parameters is an error at startup rather than a puzzle at runtime.</p>

  <p class="define"><span class="define__term">Content type</span> The <code>Content-Type</code> header
  declaring what the body is. A body without <code>application/json</code> produces a
  <strong>415</strong>, not a 400 — the framework will not guess.</p>

  <h3>Arrays</h3>

  <pre data-lang="console" data-title="02-sources-and-custom.cs"><code>   ?ids=1&amp;ids=2&amp;ids=3&amp;tags=a&amp;tags=b    200  {"ids":[1,2,3],"tags":["a","b"],"idCount":3}
   ?ids=1,2,3&amp;tags=a                   400
   ?tags=a                             200  {"ids":[],"tags":["a"],"idCount":0}</code></pre>

  <p><strong>Repeating the key is the syntax.</strong> <code>?ids=1,2,3</code> gives one value that
  happens to contain commas, and for an <code>int[]</code> that is a 400. If your clients send
  comma-separated lists you need a custom binder or a string parameter you split yourself.</p>

  <p><strong>An absent array is empty, not null</strong> — which removes any way to distinguish "sent
  nothing" from "sent an empty list", and matters if the two mean different things in your API.</p>
</section>

<section id="custom">
  <h2>Binding a type of your own</h2>

  <pre data-lang="console" data-title="02-sources-and-custom.cs"><code>   /parsed/GBP:123450                      200  {"parsed":"GBP:123450","fallback":null}
   /parsed/GBP:123450?fallback=USD:99      200  {"parsed":"GBP:123450","fallback":"USD:99"}
   /parsed/nonsense                        400

   X-Tenant: acme                          200  {"tenant":"acme"}
   no header                               400</code></pre>

  <p>Two hooks, and the choice between them is about where the value comes from.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-sources-and-custom.cs — TryParse"><code>public readonly record struct Money(string Currency, long AmountMinor)
{
    public static bool TryParse(string? value, IFormatProvider? provider, out Money result)
    {
        result = default;

        if (value is null)
        {
            return false;
        }

        int separator = value.IndexOf(':');
        if (separator &lt;= 0 || separator == value.Length - 1)
        {
            return false;
        }

        if (!long.TryParse(value.AsSpan(separator + 1), NumberStyles.Integer,
            CultureInfo.InvariantCulture, out long amount))
        {
            return false;
        }

        result = new Money(value[..separator], amount);
        return true;
    }

    public override string ToString() =&gt; $"{Currency}:{AmountMinor}";
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-sources-and-custom.cs — BindAsync"><code>public sealed record Tenant(string Id)
{
    public static ValueTask&lt;Tenant?&gt; BindAsync(HttpContext context,
        ParameterInfo parameter)
    {
        string? id = context.Request.Headers["X-Tenant"].FirstOrDefault();

        return ValueTask.FromResult(string.IsNullOrEmpty(id) ? null : new Tenant(id));
    }
}</code></pre>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Hook</th><th>Use when</th></tr></thead>
      <tbody>
        <tr><td><code>TryParse</code></td><td>The type is a value with a string form — money, a strongly-typed id, a date range. It also gives you the same parsing everywhere else in your code</td></tr>
        <tr><td><code>BindAsync</code></td><td>The value comes from somewhere other than one string — a tenant from a header, a cursor from several query parameters, the current user as a domain type</td></tr>
      </tbody>
    </table>
  </div>

  <p>Neither needs registration or an attribute. A <code>TryParse</code> returning false produces a
  400.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong><code>BindAsync</code> wins if both exist.</strong> Adding one to a type that already had
    <code>TryParse</code> silently changes how route parameters of that type are bound.</p>
    <p>And <strong>returning <code>null</code> from <code>BindAsync</code> means "no value"</strong>: a
    non-nullable parameter becomes a 400, a nullable one silently becomes null. If the absence is an
    error, throw <code>BadHttpRequestException</code> with a message rather than returning null into a
    nullable parameter and hoping the handler checks.</p>
  </div>

  <p>The wider point: <strong>both hooks move parsing out of the handler.</strong> A handler taking
  <code>Money</code> cannot be handed an unparseable string, so the check exists once instead of at the
  top of every method.</p>

  <p class="define"><span class="define__term">required member</span> A C# property marked
  <code>required</code>. The JSON deserialiser refuses a document that omits it, which turns a missing
  field from a silent default into a rejection.</p>

  <h3>[AsParameters]</h3>

  <pre data-lang="csharp" data-net="10" data-title="02-sources-and-custom.cs"><code>app.MapGet("/grouped/{id}", ([AsParameters] PaymentQuery query) =&gt; Results.Ok(new
{
    query.Id, query.Page, query.Tenant, clock = query.Clock.Name
}));

public readonly record struct PaymentQuery(
    string Id,
    int Page,
    [FromHeader(Name = "X-Tenant")] string Tenant,
    IClock Clock);</code></pre>

  <p>Each member is bound by the ordinary rules, as if it had been a parameter of the handler: id from
  the route, page from the query, tenant from the header because it says so, clock from services.</p>

  <p><strong>This is not body binding</strong>, and that is the mistake to avoid — it looks like a
  request object and it is a bundle of separate parameters. A complex type <em>without</em>
  <code>[AsParameters]</code> comes from the body; the same type <em>with</em> it comes from several
  places and never the body.</p>

  <p>It is worth reaching for when a handler has grown to eight parameters, and it has a second benefit:
  filters read arguments by position, so a handler with one parameter is a handler whose filters cannot
  be broken by reordering.</p>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>Back to the renamed field. Four requests — one from the old client, three from the new one — against
  four versions of the request type:</p>

  <pre data-lang="console" data-title="03-production.cs"><code>   version                            201   400   zero-value rows
   -------                            ---   ---   ---------------
   v1  a plain settable class          4     0                 3
   v2  plus [Range(1, ...)]            1     3                 0
   v3  required members                1     3                 0
   v4  unknown members disallowed      1     3                 0</code></pre>

  <p><strong>v2 adds one attribute and the incident stops.</strong> <code>[Range(1, 1_000_000)]</code>
  turns a zero into a 400 — and that is the general shape of why validation catches this class of bug:
  <strong>the default value of a missing field is usually invalid.</strong> An amount of 0, a name of
  null, a date of <code>0001-01-01</code>. Requiring the value to be sensible incidentally catches the
  value never having arrived.</p>

  <p><strong>v3 uses <code>required</code> members</strong>, so the deserialiser itself refuses a body
  that omits the property. Stronger than validation in one specific way: it catches a missing field even
  when the default <em>would</em> have been valid — a boolean that should have been true, a count where
  0 is a legitimate answer.</p>

  <p><strong>v4 rejects unknown properties.</strong> It is the only one that stops the wrong data
  existing at all rather than catching it downstream.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><code>UnmappedMemberHandling.Disallow</code> <strong>tells the client nothing</strong>:</p>
    <pre data-lang="console" data-title="Measured"><code>strict=False -&gt; 200  {"amountMinor":0}
strict=True  -&gt; 400  (empty)</code></pre>
    <p>The server knows exactly which property it could not map and does not say so. The detail is in
    the exception, which means it is in your logs and not in the response.</p>
    <p>If you turn this on, add <code>AddProblemDetails</code> and an exception handler as well, or you
    have traded a silent wrong answer for an unexplained rejection.</p>
  </div>

  <h3>The whole contract in one file</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — One endpoint whose binding cannot silently produce a
// wrong value, with every decision on show.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and bound value here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// A rejection should be a document naming the field, not a bare status code.
// Both lines are needed, as measured in the previous module.
builder.Services.AddProblemDetails();
builder.Services.AddSingleton&lt;IClock, SystemClock&gt;();

var app = builder.Build();
app.UseStatusCodePages();

// Validation on the GROUP, so an endpoint added later inherits it.
var payments = app.MapGroup("/v1/payments")
    .AddEndpointFilter(ValidationFilter.Validate);

// The body is one required, validated type. Every other value is a parameter
// bound by the ordinary rules, with [FromHeader] written out because it is the
// one source that is never inferred.
payments.MapPost("/", (
    CreatePaymentRequest body,
    [FromHeader(Name = "X-Tenant")] string tenant,
    IClock clock) =&gt; Results.Created("/v1/payments/PAY-1", new
    {
        amount = body.AmountMinor,
        currency = body.Currency,
        tenant,
        at = clock.Name
    }));

// A domain type as a parameter: the handler cannot be handed an unparseable
// string, because TryParse rejected it before the handler was reached.
payments.MapGet("/quote/{amount}", (Money amount) =&gt;
    Results.Ok(new { currency = amount.Currency, minor = amount.AmountMinor }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("Binding that cannot silently produce a wrong value");
Console.WriteLine();
Console.WriteLine("   request                              status   response");
Console.WriteLine("   -------                              ------   --------");

await Post(http, """{"amountMinor":123450,"currency":"GBP"}""", "acme", "valid");
await Post(http, """{"amount_minor":123450,"currency":"GBP"}""", "acme", "field renamed");
await Post(http, """{"amountMinor":0,"currency":"GBP"}""", "acme", "amount of zero");
await Post(http, """{"amountMinor":123450}""", "acme", "currency missing");
await Post(http, """{"amountMinor":123450,"currency":"GBP"}""", null, "no tenant header");
await Post(http, "", "acme", "empty body");

await Get(http, "/v1/payments/quote/GBP:5000", "a parseable Money");
await Get(http, "/v1/payments/quote/nonsense", "an unparseable Money");

Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - required members, so a partial body never becomes an object of");
Console.WriteLine("       defaults - and a RENAMED field is caught, because the correctly");
Console.WriteLine("       named one is then missing");
Console.WriteLine("     - validation attributes for the VALUES, because required only says");
Console.WriteLine("       the field arrived and says nothing about an amount of -5");
Console.WriteLine("     - the validation filter on the GROUP, not the endpoint");
Console.WriteLine("     - [FromHeader] written out, because it is the one source that is");
Console.WriteLine("       never inferred");
Console.WriteLine("     - a domain type with TryParse, so parsing happens once at the edge");
Console.WriteLine("       rather than at the top of every handler");
Console.WriteLine("     - AddProblemDetails and UseStatusCodePages, so every rejection is a");
Console.WriteLine("       document rather than a bare code");
Console.WriteLine();
Console.WriteLine("   NOT USED HERE: UnmappedMemberHandling.Disallow. required members");
Console.WriteLine("   already catch the renamed field, because the correctly named property");
Console.WriteLine("   is then absent - so disallowing unknown members would add only the");
Console.WriteLine("   ability to name the offender, and would break any client that ever");
Console.WriteLine("   sends an extra field.");
Console.WriteLine();
Console.WriteLine("   Turn it on for an internal API with known clients and a strong");
Console.WriteLine("   preference for strictness; leave it off for a public one, where a");
Console.WriteLine("   client adding a field should not be a breaking change.");
Console.WriteLine();
Console.WriteLine("   And the monitoring that catches what none of this does: an alert on");
Console.WriteLine("   the AVERAGE PAYMENT AMOUNT. A binding failure produces valid requests");
Console.WriteLine("   carrying wrong data, so error rate and latency stay flat throughout.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Post(HttpClient http, string json, string? tenant, string note)
{
    using var content = new StringContent(json, Encoding.UTF8, "application/json");
    using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/payments")
    {
        Content = content
    };

    if (tenant is not null)
    {
        request.Headers.TryAddWithoutValidation("X-Tenant", tenant);
    }

    using HttpResponseMessage response = await http.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();

    Console.WriteLine($"   POST {note,-31}{(int)response.StatusCode,6}   {Trim(body)}");
}

static async Task Get(HttpClient http, string path, string note)
{
    using HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();

    Console.WriteLine($"   GET  {note,-31}{(int)response.StatusCode,6}   {Trim(body)}");
}

static string Trim(string body) =&gt;
    body.Length == 0 ? "(empty)" : body.Length &gt; 62 ? body[..62] + "..." : body;

// ---------------------------------------------------------------------------
public sealed class CreatePaymentRequest
{
    [Range(1, 1_000_000)]
    public required long AmountMinor { get; set; }

    [StringLength(3, MinimumLength = 3)]
    public required string Currency { get; set; }
}

public interface IClock
{
    string Name { get; }
}

public sealed class SystemClock : IClock
{
    public string Name =&gt; "SystemClock";
}

public readonly record struct Money(string Currency, long AmountMinor)
{
    public static bool TryParse(string? value, IFormatProvider? provider, out Money result)
    {
        result = default;

        if (value is null)
        {
            return false;
        }

        int separator = value.IndexOf(':');
        if (separator &lt;= 0 || separator == value.Length - 1)
        {
            return false;
        }

        if (!long.TryParse(value.AsSpan(separator + 1), NumberStyles.Integer,
            CultureInfo.InvariantCulture, out long amount))
        {
            return false;
        }

        result = new Money(value[..separator], amount);
        return true;
    }
}

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

            if (Validator.TryValidateObject(argument, validationContext, errors, true))
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

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   request                              status   response
   -------                              ------   --------
   POST valid                             201   {"amount":123450,"currency":"GBP","tenant":"acme",...
   POST field renamed                     400   {"type":"...","title":"Bad Request"...
   POST amount of zero                    400   {"type":"...","title":"One or more validation errors"...
   POST currency missing                  400   {"type":"...","title":"Bad Request"...
   POST no tenant header                  400   {"type":"...","title":"Bad Request"...
   POST empty body                        400   {"type":"...","title":"Bad Request"...
   GET  a parseable Money                 200   {"currency":"GBP","minor":5000}
   GET  an unparseable Money              400   {"type":"...","title":"Bad Request"...</code></pre>

  <p>Note that <code>UnmappedMemberHandling.Disallow</code> is <em>not</em> used there and the renamed
  field is still a 400. <code>required</code> members already catch it, because the correctly named
  property is then missing — so disallowing unknown members would add only the ability to name the
  offender, at the cost of forward compatibility for every client that ever sends an extra field.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger takes about 400 payments an hour, and roughly a third come from the mobile client. Over
    four days that is <strong>about 1,400 payments recorded as zero</strong>.</p>
    <p>Every one returned 201. Every one appeared in the client's history. None of them moved any money,
    and the merchants they belonged to were owed amounts nobody recorded. Reconstructing them meant
    asking the client team for their outbound logs, because <strong>the server had no record of what had
    been sent</strong> — it had recorded what it managed to bind.</p>
    <p>And the monitoring point, which is the transferable one: <strong>error rate, latency and
    throughput were all normal for four days. The average payment amount was not.</strong></p>
    <p>A binding failure produces <em>valid requests carrying wrong data</em>, so it is invisible to
    every signal that measures whether requests succeeded. The only monitoring that sees it is
    monitoring that knows what the numbers should look like.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>A request type of settable properties with no constraints</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - every default is silently acceptable"><code>public sealed class CreatePayment
{
    public long AmountMinor { get; set; }

    public string? Currency { get; set; }
}</code></pre>

  <p>Symptom: 200s carrying zeros. Cause: an unmatched or missing property leaves the default. Fix:
  <code>required</code> members plus validation attributes.</p>

  <h3>Making a parameter nullable to be safe</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - now an empty body is legal"><code>app.MapPost("/payments", (CreatePayment? body) =&gt; ...);</code></pre>

  <p>Symptom: a <code>NullReferenceException</code> on a request that should have been rejected at the
  door. Cause: a nullable body parameter is optional. Fix: leave it non-nullable — a missing body is
  then a 400.</p>

  <h3>Two complex parameters</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the body is read once"><code>app.MapPost("/payments", (CreatePayment payment, PaymentMetadata metadata) =&gt;
    Results.Ok(new { payment.AmountMinor, metadata.Source }));</code></pre>

  <p>Symptom: the application fails to start. Cause: the body is a stream read once, so only one
  parameter can come from it. Fix: one request type, or <code>[AsParameters]</code> for the values that
  are not really body content.</p>

  <h3>Expecting a comma-separated list to bind</h3>

  <pre data-lang="text" data-bad="true" data-title="Wrong - one value containing commas"><code>GET /payments?ids=1,2,3</code></pre>

  <pre data-lang="text" data-title="Right - three values"><code>GET /payments?ids=1&amp;ids=2&amp;ids=3</code></pre>

  <p>Symptom: <code>?ids=1,2,3</code> is a 400 for an <code>int[]</code>. Cause: repeating the key is
  the syntax; commas produce one value. Fix: repeat the key, or take a string and split it.</p>

  <h3>Adding BindAsync to a type that had TryParse</h3>

  <p>Symptom: a route parameter of that type stops working, with no error. Cause:
  <code>BindAsync</code> wins, and it does not read route values unless you write that. Fix: read the
  route value inside <code>BindAsync</code>, or keep the two types separate.</p>

  <h3>Returning null from BindAsync for an error</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the caller learns nothing"><code>public static ValueTask&lt;Tenant?&gt; BindAsync(HttpContext context, ParameterInfo parameter)
{
    string? id = context.Request.Headers["X-Tenant"].FirstOrDefault();

    return ValueTask.FromResult(string.IsNullOrEmpty(id) ? null : new Tenant(id));
}</code></pre>

  <p>Symptom: a bare 400, or a silent null in a nullable parameter. Fix: throw
  <code>BadHttpRequestException</code> with a message when the absence is genuinely an error.</p>

  <h3>Treating [AsParameters] as a request body</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - binds from everywhere except the body"><code>app.MapPost("/payments", ([AsParameters] CreatePayment body) =&gt;
    Results.Ok(new { body.AmountMinor }));</code></pre>

  <p>Symptom: the JSON body is ignored entirely. Cause: <code>[AsParameters]</code> binds each member
  from route, query, header or services — never from the body. Fix: use a plain complex parameter for
  body content.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>Binding bugs produce <strong>successful responses with wrong values</strong>, so the diagnostic is
    never in the error logs. Ask the application what it actually bound:</p>
    <pre data-lang="csharp" data-net="10" data-title="One endpoint that settles it"><code>app.MapPost("/echo", (CreatePayment body, HttpContext context) =&gt;
    Results.Ok(new
    {
        bound = body,
        rawBody = context.Items["raw"],
        query = context.Request.Query.ToDictionary(q =&gt; q.Key, q =&gt; q.Value.ToString())
    }));</code></pre>
    <p>Comparing what arrived with what bound settles it in one request. A property that is zero in
    <code>bound</code> and present in <code>rawBody</code> is a name mismatch — nothing else looks like
    that.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Look at</th><th>What you are looking for</th></tr></thead>
      <tbody>
        <tr>
          <td>200s carrying zeros or nulls</td>
          <td>The property names in the raw body</td>
          <td>A name that does not match the type — casing is forgiving, everything else is not</td>
        </tr>
        <tr>
          <td>A field works from one client and not another</td>
          <td>That client's serialiser naming policy</td>
          <td>snake_case, or a renamed property. Matching is case-insensitive but not separator-insensitive</td>
        </tr>
        <tr>
          <td>400 on a query value that looks fine</td>
          <td>The parameter's type</td>
          <td>An overflow, or a format the type will not parse</td>
        </tr>
        <tr>
          <td>A parameter is always null</td>
          <td>Whether its source is inferred</td>
          <td>A header without <code>[FromHeader]</code> — never inferred</td>
        </tr>
        <tr>
          <td>The body is ignored</td>
          <td>Whether the parameter has <code>[AsParameters]</code></td>
          <td>It binds from everywhere except the body</td>
        </tr>
        <tr>
          <td>415 rather than 400</td>
          <td>The request's <code>Content-Type</code></td>
          <td>A body without <code>application/json</code>. The framework will not guess</td>
        </tr>
        <tr>
          <td>An array is empty when values were sent</td>
          <td>The query string syntax</td>
          <td>Commas rather than a repeated key</td>
        </tr>
        <tr>
          <td>Average of a business quantity has shifted</td>
          <td>Recent client releases</td>
          <td>A renamed field. This is the alert that catches it; error rate will not</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"If the JSON is wrong, I will get a 400."</em></p>
    <p>Only if it is not valid JSON, or a <code>required</code> member is missing. A property whose name
    does not match is <strong>ignored</strong> — the body deserialises, the handler runs, and the value
    is the default.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Making a parameter nullable makes it forgiving of bad input."</em></p>
    <p>It makes it forgiving of <em>absent</em> input. <code>?page=abc</code> is a 400 for
    <code>int</code>, <code>int?</code> and <code>int page = 1</code> alike — measured.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Binding validates the input."</em></p>
    <p>It asks whether a value of the declared type can be produced. <code>?page=-5</code> and an amount
    of 0 both bind perfectly. Whether the value makes sense is a separate question.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Case-insensitive matching means my API is forgiving about field names."</em></p>
    <p>Only about casing. <code>AMOUNTMINOR</code> binds; <code>amount_minor</code> does not. The
    forgiveness stops exactly where separators begin, which is where most naming-policy changes
    land.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"I should turn on UnmappedMemberHandling.Disallow everywhere."</em></p>
    <p>It gives up forward compatibility — a client adding a field becomes a breaking change — and it
    returns a bare 400 with no body, so the caller is told less than before. Reasonable for an internal
    API with known clients; a poor default for a public one.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"[AsParameters] is how you bind a request object."</em></p>
    <p>It is the opposite: each member binds from route, query, header or services, and never from the
    body. A plain complex parameter is the one that reads the body.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <p>Binding is the boundary between "what a stranger sent" and "the values your code operates on", and
  it is permissive on purpose.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Decision</th><th>Cost to get right</th><th>Cost of getting it wrong</th></tr></thead>
      <tbody>
        <tr><td><code>required</code> members on request types</td><td>One keyword per property</td><td>~1,400 payments recorded as zero over four days</td></tr>
        <tr><td>Validation attributes for the values</td><td>One attribute per property</td><td>An amount of −5 binds perfectly and reaches the database</td></tr>
        <tr><td>Non-nullable body parameter</td><td>Removing a <code>?</code></td><td>A null-reference exception on a request that should have been a 400</td></tr>
        <tr><td><code>TryParse</code> on a domain type</td><td>One static method</td><td>Parsing repeated at the top of every handler, and forgotten in one</td></tr>
        <tr><td>An alert on a business quantity</td><td>One dashboard panel</td><td>Four days, because every technical signal stayed flat</td></tr>
      </tbody>
    </table>
  </div>

  <p>Two things generalise beyond ASP.NET Core.</p>

  <p><strong>Permissive deserialisation is a deliberate trade, not an oversight.</strong> Ignoring
  unknown members is what allows a client and a server to be deployed independently — and the price is
  that a rename looks exactly like a field that was never sent. You can buy strictness back, and what
  you pay is the independence.</p>

  <p><strong>A failure that produces valid output is invisible to every health signal you have.</strong>
  Error rate, latency and throughput all measure whether requests <em>succeeded</em>. A binding failure
  succeeds. The only thing that catches it is a check on what the values mean — which is why the most
  valuable monitoring in this module is an alert on an average amount, not on an error count.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>No attributes. Where does each parameter come from?</p>
    <pre data-lang="csharp" data-net="10" data-title="Four parameters, no attributes"><code>app.MapPost("/payments/{id}", (
    string id, int retries, CreatePayment body, IClock clock) =&gt;
    Results.Ok(new { id, retries, amount = body.AmountMinor, clock = clock.Name }));</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   -&gt; {"id":"PAY-1","retries":2,"amount":123450,"clock":"SystemClock"}

   parameter    source     because
   ---------    ------     -------
   id           route      its name matches a route parameter
   retries      query      a simple type with no route match
   body         body       a complex type, read as JSON
   clock        services   the type is registered in the container</code></pre>
        <p>Only two sources are never inferred: <code>[FromHeader]</code> and <code>[FromForm]</code>.
        Everything else follows from the name and the type.</p>
        <p>Two rules worth carrying:</p>
        <ul>
          <li><strong>The route wins</strong> over the query for a matching name. A parameter called
          <code>id</code>, in a route with <code>{id}</code>, always comes from the route —
          <code>[FromQuery]</code> is the only way to say otherwise.</li>
          <li><strong>Only one parameter may come from the body</strong>, because the body is a stream
          read once. Two complex parameters is an error at startup.</li>
        </ul>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Three ways of declaring the same query parameter. What does each do with <code>?page=abc</code>,
    and with <code>page</code> absent?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   declaration      ?page=2   ?page=abc   absent    ?page=-5
   -----------      -------   ---------   ------    --------
   int page         2         400         400       -5
   int? page        2         400         null      -5
   int page = 1     2         400         1         -5</code></pre>
        <p><strong>Binding distinguishes absent from unparseable</strong>, and it is the opposite of what
        is usually assumed:</p>
        <ul>
          <li><strong>Absent</strong> — null, the default, or a 400. Your choice.</li>
          <li><strong>Present but unparseable</strong> — a 400 in <em>all three</em>.</li>
        </ul>
        <p>Making a parameter nullable or giving it a default handles absence only. It does not swallow
        malformed input.</p>
        <p><strong>Read the last column though.</strong> <code>?page=-5</code> binds cleanly to −5 in
        every version, because −5 <em>is</em> an int. <strong>Binding is not validation</strong> — a page
        number of −5, an amount of 0, a date in 1900 all bind perfectly and all need a separate
        check.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>A client renames one JSON field. What happens, and what are the four defences?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   request type                     201   400   zero rows
   ------------                     ---   ---   ---------
   plain settable class              4     0           3
   plus [Range(1, ...)]              1     3           0
   required members                  1     3           0
   unknown members disallowed        1     3           0</code></pre>
        <p><strong>The first row is the incident:</strong> three 201s carrying zero. The renamed property
        matched nothing on the type, so it was ignored and the property kept its default. Nothing records
        that a property was skipped — the JSON was valid, the body deserialised, the handler ran
        normally.</p>
        <ol>
          <li><strong>Validation.</strong> Cheapest, and it catches this whenever the default is
          <em>invalid</em> — which is most of the time. An amount of 0, a name of null, a date of
          <code>0001-01-01</code>. Requiring the value to be sensible incidentally catches it never
          having arrived.</li>
          <li><strong><code>required</code> members.</strong> Catches a missing field even when its
          default <em>would</em> have been valid — a bool that should be true, a count where 0 is
          legitimate. Costs nothing at runtime.</li>
          <li><strong>Rejecting unknown properties.</strong> Stops the wrong data existing at all. Two
          costs: it breaks any client that sends an extra field, and it returns a <strong>bare 400 with
          no body</strong> — the server knows which property it could not map and does not say. Pair it
          with an exception handler.</li>
          <li><strong>A contract test</strong>, or one generated OpenAPI document. The only defence that
          catches the change <em>before</em> it ships — and the only one needing agreement from another
          team.</li>
        </ol>
        <p>Ignoring unknown members is deliberate in JSON: it is what lets a client add a field without
        breaking an older server. Turning it off buys strictness and gives up forward compatibility.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>You want <code>Money</code> and <code>Tenant</code> as handler parameters instead of strings.
    Which hook for each, and why?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   request                        status   result
   -------                        ------   ------
   GET /money/GBP:1234              200   {"parsed":"GBP:1234"}
   GET /money/nonsense              400
   GET /tenant (X-Tenant: acme)     200   {"tenant":"acme"}
   GET /tenant (no header)          400</code></pre>
        <p><strong><code>Money</code> → <code>TryParse</code>.</strong> It is a value with a string form,
        so it belongs in one route or query segment. Returning false produces a 400, and the same method
        parses the value everywhere else in your code.</p>
        <p><strong><code>Tenant</code> → <code>BindAsync</code>.</strong> It comes from a header, not
        from a URL segment, so it needs the whole request.</p>
        <p>Two things to know:</p>
        <ul>
          <li><strong><code>BindAsync</code> wins if both exist.</strong> Adding one to a type that
          already had <code>TryParse</code> silently changes how route parameters of that type
          bind.</li>
          <li><strong>Returning <code>null</code> means "no value".</strong> A non-nullable parameter
          becomes a 400; a nullable one silently becomes null. If absence is an error, throw
          <code>BadHttpRequestException</code> with a message.</li>
        </ul>
        <p>The wider point: <strong>both hooks move parsing out of the handler.</strong> A handler taking
        <code>Money</code> cannot be handed an unparseable string, so the check exists once instead of at
        the top of every method.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Design the binding for <code>POST /v1/payments</code> so that no malformed or partial request can
    reach the handler, and a caller who gets it wrong is told what was wrong.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   body                  status   response
   ----                  ------   --------
   everything correct       201   {"amount":123450}
   field renamed            400   {"type":"...","title":"Bad Requ...
   amount of zero           400   {"type":"...","title":"One or m...
   currency missing         400   {"type":"...","title":"Bad Requ...
   empty object             400   {"type":"...","title":"Bad Requ...</code></pre>
        <ol>
          <li><strong><code>required</code> members on the request type.</strong> The deserialiser
          refuses a body that omits them, so a partial request never becomes an object of defaults.</li>
          <li><strong>Validation attributes for the values.</strong> <code>required</code> says it
          arrived; <code>[Range]</code> says it makes sense. Both are needed — a required amount of −5
          arrives perfectly well.</li>
          <li><strong>The validation filter on the group</strong>, not the endpoint, so an endpoint added
          next month inherits it.</li>
          <li><strong><code>AddProblemDetails</code> plus <code>UseStatusCodePages</code></strong>, so a
          rejection is a document naming the field rather than a bare status code.</li>
        </ol>
        <p><strong>What is deliberately not here: <code>UnmappedMemberHandling.Disallow</code>.</strong>
        Look at the "field renamed" row — it is a 400 without it. <code>required</code> members already
        catch the rename, because the correctly named property is then missing. Disallowing unknown
        members would add only the ability to name the offender, and would cost forward compatibility for
        every client that ever sends an extra field.</p>
        <p>Turn it on for an internal API with known clients; leave it off for a public one, where a
        client adding a field should not be a breaking change.</p>
        <p><strong>And the monitoring that would have caught the incident:</strong> an alert on average
        payment amount, not on error rate. A binding failure produces valid requests carrying wrong data,
        so it is invisible to every signal that measures whether requests succeeded.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Where does an unattributed complex-type parameter come from?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The body, as JSON — unless it has <code>[AsParameters]</code>, in
        which case each member binds separately and never from the body.</p></div></details></li>

    <li><p>Which two binding sources are never inferred?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>[FromHeader]</code> and <code>[FromForm]</code>. Route,
        query, body and services are all inferred.</p></div></details></li>

    <li><p><code>?page=abc</code> against <code>int? page</code>. What happens?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A 400. Nullable handles <em>absence</em>, not malformed input —
        binding distinguishes the two.</p></div></details></li>

    <li><p><code>?page=-5</code> against <code>int page</code>. What happens?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It binds to −5. Binding asks whether a value of the type can be
        produced, never whether it makes sense.</p></div></details></li>

    <li><p>A JSON body sends <code>amount_minor</code> and the type has <code>AmountMinor</code>. What
    does the handler receive?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A 200 and a value of 0. Matching is case-insensitive but not
        separator-insensitive, so the property is unmatched, ignored, and left at its
        default.</p></div></details></li>

    <li><p>Why are unknown JSON members ignored by default?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Forward compatibility — it lets a client add a field without
        breaking an older server. The price is that a rename is indistinguishable from a field that was
        never sent.</p></div></details></li>

    <li><p>What does <code>UnmappedMemberHandling.Disallow</code> return to the caller?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A bare 400 with an <strong>empty body</strong>. The detail is in the
        server-side exception, so pair it with an exception handler or the caller learns
        less than before.</p></div></details></li>

    <li><p>When do you use <code>TryParse</code> and when <code>BindAsync</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>TryParse</code> for a value with a string form, in one route
        or query segment. <code>BindAsync</code> when the value comes from the wider request — a header,
        several parameters, the user. <code>BindAsync</code> wins if both
        exist.</p></div></details></li>

    <li><p>How do you send an array in a query string?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Repeat the key: <code>?ids=1&amp;ids=2&amp;ids=3</code>. A
        comma-separated list is one value, and for an <code>int[]</code> that is a 400. An absent array
        binds to empty, not null.</p></div></details></li>

    <li><p>Which monitoring signal catches a binding failure?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>One that measures what the values <em>mean</em> — an average amount,
        a count of zero-value records. Error rate, latency and throughput all stay flat, because the
        requests succeeded.</p></div></details></li>
  </ol>
</section>
`
});
