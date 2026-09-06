CSPREP.module({
  id: "t3-18-openapi",
  minutes: 55,
  updated: "2026-09-06",
  summary: "Two lines generate a document describing your API, and the first thing it does is get both endpoints wrong - because it reads signatures, and a handler returning IResult has nothing in its signature to read. What the generator can and cannot infer, measured property by property; why a response type can be absent from the document entirely; the partner whose generated client failed on one call in nine while every Ledger dashboard stayed clean; and the ranking that decides which facts about an API survive: the compiler holds a return type, the validator holds an attribute, and nobody at all holds a description.",
  terms: ["OpenAPI", "JSON Schema", "operationId", "TypedResults", "Results<T, ...>", "Produces",
    "ProducesProblem", "document transformer", "operation transformer", "schema transformer",
    "required vs nullable", "components/schemas", "$ref", "contract test", "client generation"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Two lines turn an ASP.NET Core application into one that publishes a machine-readable description
  of itself:</p>

  <pre data-lang="csharp" data-net="10" data-title="The whole of the setup, as a complete program"><code>var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();

var app = builder.Build();

app.MapOpenApi();
app.MapGet("/v1/payments/{id}", (string id) =&gt; Results.Ok());

app.Run();</code></pre>

  <p>The document appears at <code>/openapi/v1.json</code>, tooling reads it, and a partner generates a
  client from it. Here are two ordinary endpoints and what the generated document says about them:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - and it is what everyone writes first"><code>app.MapGet("/v1/payments/{id}", (string id) =&gt;
    id == "PAY-001"
        ? Results.Ok(new Payment("PAY-001", "captured", 4999, "GBP", null))
        : Results.NotFound());

app.MapPost("/v1/payments", (CreatePayment request) =&gt;
    Results.Created($"/v1/payments/PAY-002",
        new Payment("PAY-002", "pending", request.AmountMinor, request.Currency, null)));</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   endpoint                  documented responses   what the code returns
   --------                  --------------------   ---------------------
   GET  /v1/payments/{id}    200 no body            200 Payment, 404
   POST /v1/payments         200 no body            201 Payment, Location header

   types in components/schemas   CreatePayment</code></pre>

  <p>The document is wrong about both endpoints, and the last line is the worst of it. The
  <code>Payment</code> type — the thing both endpoints return, the entire point of the API — <strong>is
  not in the document at all</strong>. Not described badly: absent. A client generated from this has no
  class for it.</p>

  <p>The cause is the same in every case: the generator reads the method <em>signature</em>, and a
  signature that returns <code>IResult</code> contains no status code and no body type.
  <code>CreatePayment</code> made it in only because it is a parameter, and parameters are in the
  signature.</p>

  <div class="callout callout--note">
    <h4>The generator is not lying to you</h4>
    <p>It is reporting what it can see, accurately. A generated document is <em>a description of what
    the framework can observe about your code</em>, which is a smaller thing than a description of your
    API. Everything in this module is about the gap between those two, and every technique in it is a
    way of telling the generator something it had no way to work out.</p>
  </div>
</section>

<section id="what-a-document-is">
  <h2>What the document is</h2>

  <p class="define"><span class="define__term">OpenAPI</span> A specification for describing an HTTP
  API in a machine-readable document: its paths, the parameters each takes, the status codes it
  returns, and the shape of every request and response body.</p>

  <p class="define"><span class="define__term">JSON Schema</span> The sub-language OpenAPI uses to
  describe the shape of a body. It has its own vocabulary — <code>type</code>, <code>required</code>,
  <code>minLength</code>, <code>pattern</code> — and that vocabulary is what a C# type has to be
  translated into.</p>

  <p class="define"><span class="define__term">Components</span> A section of the document holding
  reusable schemas, referenced from elsewhere by <code>$ref</code>. Your DTOs end up here, named after
  the C# type.</p>

  <p class="define"><span class="define__term">operationId</span> A unique name for one operation.
  Client generators turn it into a method name, which makes it part of your public contract rather than
  a label.</p>

  <p class="define"><span class="define__term"><code>$ref</code></span> A pointer from one place in the
  document to another, almost always into <code>components/schemas</code>. It is why a type used by
  twenty endpoints is described once.</p>

  <p class="define"><span class="define__term">format</span> A JSON Schema annotation narrowing a type
  — <code>uuid</code>, <code>date-time</code>, <code>int64</code>, <code>uri</code>. It is
  <em>advisory</em>: many validators ignore it, and generators use it to pick a language type.</p>

  <p class="define"><span class="define__term"><code>AddOpenApi</code></span> Registers the document
  generator and its options. <span class="define__term"><code>MapOpenApi</code></span> maps the
  endpoint that serves the generated document, by default at
  <code>/openapi/{documentName}.json</code>.</p>

  <p class="define"><span class="define__term">Client generation</span> Running a tool over the
  document to produce compilable client code in some language. It is what turns a document from
  reference material into something people build against — and what makes its mistakes expensive.</p>

  <p class="define"><span class="define__term">Contract test</span> A test that checks real responses
  against the document the build serves, rather than against the server's own types. The only thing
  that ever verifies the unenforced half of a document.</p>

  <p>A trimmed document for one endpoint, so the shape is concrete:</p>

  <pre data-lang="json" data-title="What /openapi/v1.json contains"><code>{
  "openapi": "3.1.1",
  "info": { "title": "Ledger Payments API", "version": "1.0.0" },
  "paths": {
    "/v1/payments/{id}": {
      "get": {
        "operationId": "GetPayment",
        "summary": "Fetch one payment by its Ledger id.",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": {
            "content": {
              "application/json": { "schema": { "$ref": "#/components/schemas/PaymentView" } }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "PaymentView": {
        "type": "object",
        "required": ["id", "status", "amountMinor"],
        "properties": {
          "id": { "type": "string" },
          "status": { "$ref": "#/components/schemas/PaymentStatus" },
          "amountMinor": { "type": ["integer", "string"], "format": "int64" }
        }
      }
    }
  }
}</code></pre>

  <h3>An analogy, and where it stops working</h3>

  <p>A generated document is like a type signature extracted from an implementation. It tells you what
  goes in and what comes out, and it is correct as far as it goes.</p>

  <p>Where it stops is where every type signature stops. A signature cannot tell you that a 201 means
  the payment was accepted rather than that the money moved, that "pending" is not a final state, or
  that retrying without an idempotency key charges the customer twice. Those are the facts callers most
  need, and no generator will ever produce them, in any language. <strong>A perfectly generated
  document with empty descriptions is a type definition, not documentation.</strong></p>
</section>

<section id="what-it-can-know">
  <h2>What the generator can and cannot work out</h2>

  <p>The boundary is the useful thing to learn, because everything on the far side of it is work you
  have to do by hand. Start with the return type, since that is where the document is most often
  wrong.</p>

  <pre data-lang="console" data-title="01-what-it-can-know.cs output"><code>   how the handler is written                  documented as
   --------------------------                  -------------
   returns IResult                             200 (no body)
   returns Payment                             200 Payment
   returns TypedResults.Ok                     200 Payment
   Results&lt;Ok&lt;Payment&gt;, NotFound&gt;              200 Payment, 404 (no body)
   IResult + .Produces&lt;Payment&gt;()              200 Payment, 404 (no body)</code></pre>

  <p class="define"><span class="define__term">TypedResults</span> The same API as <code>Results</code>
  — <code>TypedResults.Ok(payment)</code>, <code>TypedResults.NotFound()</code> — returning a type that
  names the status code and the body (<code>Ok&lt;Payment&gt;</code>) instead of the opaque
  <code>IResult</code>.</p>

  <p>The first row is the default and the worst, and it is worth seeing the two side by side because
  the difference is four characters:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the document learns nothing from this"><code>app.MapGet("/v1/payments/{id}", (string id) =&gt;
    Load(id) is { } payment ? Results.Ok(payment) : Results.NotFound());</code></pre>

  <p>Changing <code>Results</code> to <code>TypedResults</code> is a search-and-replace that fixes the
  document for free. Writing the union as the declared return type goes further:</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - the signature states every outcome"><code>app.MapGet("/v1/payments/{id}", Results&lt;Ok&lt;PaymentView&gt;, NotFound&lt;ProblemDetails&gt;&gt; (string id) =&gt;
    table.FirstOrDefault(p =&gt; p.Id == id) is { } payment
        ? TypedResults.Ok(payment)
        : TypedResults.NotFound(new ProblemDetails("Payment not found", $"No payment '{id}'.", 404)));</code></pre>

  <div class="callout callout--why">
    <h4>This is the only technique in the module the compiler enforces</h4>
    <p>Add a third outcome to that handler and it does not build until the union changes. The document
    cannot fall behind the code, because the drift would not compile. Everything else — every
    <code>.Produces</code>, every description, every transformer — is a claim nobody checks.</p>
  </div>

  <p>And the technique to be most careful with is the one that looks most like documentation:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a claim the compiler cannot check"><code>app.MapGet("/v1/payments/{id}", (string id) =&gt; Results.Ok(Load(id)))
   .Produces&lt;Payment&gt;(StatusCodes.Status200OK)
   .Produces(StatusCodes.Status404NotFound);</code></pre>

  <p>That produces a correct-looking document today. Nothing connects it to what the handler does, so
  it stays correct-looking after the handler changes — which is the incident below.</p>

  <h3>Parameters, which it gets right</h3>

  <pre data-lang="console" data-title="01-what-it-can-know.cs output"><code>   parameter        in         required   schema
   ---------        --         --------   ------
   tenant           path       True       string
   query            query      False      string
   page             query      True       integer|string (int32)
   X-Request-Id     header     False      string
   sort             query      False      string</code></pre>

  <p>This is the part the generator is good at, and the reason is worth naming: <em>parameter binding
  is already decided by the same rules</em>. The framework must know where <code>tenant</code> comes
  from in order to bind it, so documenting it costs nothing extra.</p>

  <p>Note that <code>page</code> is required and <code>query</code> is not. An <code>int</code> cannot
  be absent; a <code>string?</code> can. C# nullability decided a fact about your HTTP contract without
  anybody writing it down — which is the generator working, and also a trap: adding <code>?</code> to
  silence a compiler warning changes the published contract.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a nullability fix that edits your published contract"><code>// Was: (string tenant, int page)
app.MapGet("/v1/payments", (string tenant, int? page) =&gt; Results.Ok());</code></pre>

  <h3>Types, where three rows are surprising</h3>

  <pre data-lang="console" data-title="01-what-it-can-know.cs output"><code>   C# declaration                       documented as
   --------------                       -------------
   string                               string
   string?                              null|string
   int                                  integer|string (int32)
   long                                 integer|string (int64)
   decimal                              number|string (double)
   double                               number|string (double)
   bool                                 boolean
   Guid                                 string (uuid)
   DateTime                             string (date-time)
   DateOnly                             string (date)
   TimeSpan                             string
   List&lt;string&gt;                         array of string
   Dictionary&lt;string, int&gt;              object to integer|string (int32)
   Status (enum)                        Status = integer
   Currency ([JsonConverter])           Currency = enum [GBP,USD,EUR]
   object                               {} (anything)</code></pre>

  <ul>
    <li><strong>Every number is "number or string".</strong> Not only the 64-bit ones — an
    <code>int</code> gets it too, because System.Text.Json will read a number from a quoted string. It
    is accurate, and it means a generated TypeScript client types every numeric property as
    <code>number | string</code>.</li>
    <li><strong><code>decimal</code> is published as a double.</strong> There is no decimal in JSON
    Schema, so a money amount declared as <code>decimal</code> reaches every generated client as binary
    floating point. The precision you chose <code>decimal</code> for does not survive the
    document.</li>
    <li><strong>The plain enum publishes <code>integer</code> and nothing else.</strong> Not the names,
    not the numbers, not even which integers are legal. The one carrying
    <code>JsonStringEnumConverter</code> publishes its names as a complete enum list.</li>
  </ul>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - three contract defects in four lines"><code>record Payment(
    decimal Amount,        // published as a double; precision does not survive
    Status Status,         // published as "integer", with no list of legal values
    object Metadata);      // published as {} - anything at all

enum Status { Pending, Captured, Failed }</code></pre>

  <div class="callout callout--note">
    <h4>The document describes the wire, not the CLR</h4>
    <p>That last pair looks like a generator inconsistency and is the opposite. An int-backed enum
    genuinely <em>is</em> an undocumented integer on the wire. The generator did not lose the
    information — your serialisation choice never put it there. Which is why the fix is a serialiser
    setting, not a documentation one.</p>
  </div>

  <h3>Validation attributes, half of which arrive</h3>

  <pre data-lang="console" data-title="01-what-it-can-know.cs output"><code>   attribute                                         reached the schema as
   ---------                                         ---------------------
   [Required, StringLength(20, MinimumLength = 3)]   minLength=3, maxLength=20
   [Range(1, 1000000)]                               pattern=^-?(?:0|[1-9]\d*)$, minimum=1, maximum=1000000
   [RegularExpression("^[A-Z]{3}$")]                 pattern=^[A-Z]{3}$
   [EmailAddress]                                    NOTHING
   [Url]                                             format=uri
   [MaxLength(500)]                                  maxLength=500
   [Description("...")]                              description=The reference t...
   = "GBP" (property initialiser)                    NOTHING</code></pre>

  <p><code>[Url]</code> and <code>[EmailAddress]</code> are the instructive pair: the same kind of
  attribute doing the same kind of job, and one arrived while the other became nothing at all. So an
  email field is published as an unconstrained string while your API rejects most of them.</p>

  <p>Do not learn the list — learn to check. Which attributes translate is a property of the version
  you are on, and the test is to fetch your own document and read the property.</p>

  <p>What never arrives is anything you wrote yourself: a custom <code>ValidationAttribute</code>, an
  <code>IValidatableObject</code>, a rule enforced in the handler, a constraint spanning two fields.
  None has a JSON Schema equivalent, so callers meet those as 400s. <strong>Schema generation can
  publish the rules that were already expressed in a vocabulary it shares.</strong> Every rule you
  invented lives only in your code and your prose.</p>
</section>

<section id="required-vs-nullable">
  <h2>Required and nullable, which are not opposites</h2>

  <p>The single most common disagreement between a generated document and the API a team believes it
  has. From the record in the opening example:</p>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>     property         documented as                      declared in C# as
     ---------------- ---------------------------------- -----------------
     id               string                             string
     status           string                             string
     amountMinor      integer or string (int64) + pattern long
     currency         string                             string
     failureReason    null or string                     string?

     required properties   id, status, amountMinor, currency, failureReason</code></pre>

  <p><code>failureReason</code> is both nullable and required, and that is not a contradiction. In JSON
  Schema the two words answer different questions:</p>

  <ul>
    <li><strong><code>required</code></strong> — must the <em>key</em> be present in the object?</li>
    <li><strong>nullable</strong> — may its <em>value</em> be null?</li>
  </ul>

  <p>So the document demands <code>{"failureReason": null}</code> and refuses an object that omits the
  key. That is exactly what a C# record says — the constructor takes five arguments and one of them may
  be null — and it is almost never what an API means.</p>

  <p>It is invisible until somebody generates a strict client from the document, which is the incident
  below.</p>
</section>

<section id="shaping">
  <h2>Shaping the document</h2>

  <p class="define"><span class="define__term">Document transformer</span> A callback that runs over
  the finished document before it is served, used for facts about the API as a whole.</p>

  <p class="define"><span class="define__term">Operation transformer</span> The same, per operation —
  used to add something true of every endpoint, like a common header.</p>

  <p class="define"><span class="define__term">Schema transformer</span> The same, per schema — used
  for a systematic correction to how types map.</p>

  <p class="define"><span class="define__term"><code>.Produces&lt;T&gt;()</code></span> Adds a
  documented response to an endpoint's metadata. A declaration about what the handler returns, checked
  by nothing. <span class="define__term"><code>.ProducesProblem(status)</code></span> is the same for a
  <code>ProblemDetails</code> error response.</p>

  <p class="define"><span class="define__term"><code>.WithSummary</code> /
  <code>.WithDescription</code></span> A one-line label and a prose explanation for one operation.
  The summary appears in a list of endpoints; the description is where semantics live.</p>

  <p>The <code>required</code>/nullable problem is a good example of a correction that belongs in a
  transformer, because it is mechanical and applies to every type you will ever write:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>    // DECISION 3: one mechanical, always-correct correction. A property whose
    // value may be null is not a property whose key must be present.
    options.AddSchemaTransformer((schema, context, cancellationToken) =&gt;
    {
        if (schema.Required is { Count: &gt; 0 } &amp;&amp; schema.Properties is { Count: &gt; 0 })
        {
            foreach (string name in schema.Required.ToList())
            {
                if (schema.Properties.TryGetValue(name, out IOpenApiSchema? property)
                    &amp;&amp; property is OpenApiSchema { Type: { } type }
                    &amp;&amp; type.HasFlag(JsonSchemaType.Null))
                {
                    schema.Required.Remove(name);
                }
            }
        }

        return Task.CompletedTask;
    });</code></pre>

  <pre data-lang="console" data-title="02-shaping-the-document.cs output"><code>   info.title     Ledger Payments API
   info.contact   payments@example.com
   parameters     id (path), X-Correlation-Id (header)
   required       id, status, amountMinor</code></pre>

  <p>The header appeared on an endpoint that never mentioned it, and <code>failureReason</code> is no
  longer required even though nothing about the record changed. Both corrections were made once and
  apply everywhere, including to endpoints written next year.</p>

  <div class="callout callout--warn">
    <h4>Which is the argument for transformers and the warning about them</h4>
    <p>A schema transformer is a rule applied to code that has not been written yet, by people who will
    not know it exists. Keep them few, keep them mechanical, and prefer a rule that is plainly right
    in every case over one that happens to fix today's problem. Exercise 4 is what happens when that
    advice is ignored.</p>
  </div>

  <h3>Metadata: the things no type can say</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>app.MapPost("/v1/payments", Results&lt;Created&lt;PaymentView&gt;, ValidationProblem&gt; (
        CreatePayment request) =&gt;
    {
        var created = new PaymentView($"PAY-{table.Count + 1:000}", PaymentStatus.Pending,
            request.AmountMinor, request.Currency, null, DateTime.UtcNow);

        table.Add(created);

        return TypedResults.Created($"/v1/payments/{created.Id}", created);
    })
    .WithName("CreatePayment")
    .WithSummary("Take a payment.")
    .WithDescription(
        "Returns 201 with the payment in 'pending' status. The money has NOT moved "
        + "when this returns - poll the Location URL until the status is terminal. "
        + "Send an Idempotency-Key header; without one, a retried request takes the "
        + "money twice.")
    .WithTags("Payments")
    .ProducesProblem(StatusCodes.Status409Conflict)
    .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };</code></pre>

  <pre data-lang="console" data-title="02-shaping-the-document.cs output"><code>   operationId   CreateRefund
   summary       Refund part or all of a captured payment.
   tags          Refunds
   responses     201 Refund, 400 HttpValidationProblemDetails, 409 ProblemDetails, 422 ProblemDetails

   description:

     Refunds are asynchronous. A 201 means the refund was accepted, not
     that the money has moved; poll the returned resource until its
     status leaves 'pending'. Refunding more than the captured amount
     returns 422.</code></pre>

  <p>Read that description again. It says that a 201 does not mean the money moved, that the caller
  must poll, and what over-refunding does. None of that is derivable from any type, in any language, by
  any generator. It is the part only a person can write, and it is the field most often left empty.</p>

  <p><code>WithName</code> sets <code>operationId</code>, which is not cosmetic: client generators turn
  it into a method name, so leaving it to be derived means your callers' code changes when you rename a
  route. Set it deliberately and treat it as part of the contract.</p>

  <h3>Which tool for which gap</h3>

  <p>In the order to reach for them:</p>

  <table>
    <thead>
      <tr><th>Reach for</th><th>For</th><th>Enforced by</th></tr>
    </thead>
    <tbody>
      <tr><td><code>Results&lt;Ok&lt;T&gt;, ...&gt;</code></td><td>Status codes and response bodies</td><td><strong>The compiler</strong></td></tr>
      <tr><td>Parameter types</td><td>Where a value comes from, whether it is required</td><td>Model binding</td></tr>
      <tr><td><code>[Range]</code>, <code>[StringLength]</code></td><td>Constraints JSON Schema has words for</td><td>The validator</td></tr>
      <tr><td><code>.WithSummary</code> / <code>.WithDescription</code></td><td>Semantics, ordering, what a status code <em>means</em></td><td>Nobody</td></tr>
      <tr><td><code>.ProducesProblem</code></td><td>Failure outcomes not in the signature</td><td>Nobody</td></tr>
      <tr><td>Operation transformer</td><td>Something true of every endpoint</td><td>Nobody</td></tr>
      <tr><td>Schema transformer</td><td>A systematic correction to type mapping</td><td>Nobody</td></tr>
      <tr><td>Document transformer</td><td>Title, contact, servers, security</td><td>Nobody</td></tr>
    </tbody>
  </table>

  <p>Read that third column as the whole point. The further down the table a fact lives, the more likely
  it is to be false in a year — and every fact about your API should live as far up it as it can go.</p>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <p>One endpoint with every decision placed as high up that table as it goes: outcomes in the
  signature, constraints in attributes that also validate, an enum converter so the wire and the
  document agree, and meaning in a description because nothing else can hold it.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>app.MapGet("/v1/payments/{id}", Results&lt;Ok&lt;PaymentView&gt;, NotFound&lt;ProblemDetails&gt;&gt; (
        [Description("The payment's Ledger id, as returned by POST /v1/payments.")] string id) =&gt;
    {
        return table.FirstOrDefault(p =&gt; p.Id == id) is { } payment
            ? TypedResults.Ok(payment)
            : TypedResults.NotFound(new ProblemDetails(
                "Payment not found", $"No payment with id '{id}'.", 404));
    })
    .WithName("GetPayment")
    .WithSummary("Fetch one payment by its Ledger id.")
    .WithDescription(
        "A payment reaches a terminal status (captured or failed) within seconds of "
        + "creation, but not before this call can return. Treat 'pending' as "
        + "non-final and poll; do not assume a payment that is pending now will "
        + "still be pending on the next call.")
    .WithTags("Payments");</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>
// ---------------------------------------------------------------------------
// The response type. One shape for one status code, and a nullable field that
// is genuinely optional rather than a second record in disguise.
record PaymentView(
    string Id,
    PaymentStatus Status,
    long AmountMinor,
    string Currency,
    string? FailureCode,
    DateTime CreatedAt);

// ---------------------------------------------------------------------------
// The request type. Every constraint here is enforced by the validator AND
// published in the schema, which is why neither can drift from the other.
record CreatePayment(
    [property: Range(1, 10_000_00)]
    [property: Description("Amount in minor units. 4999 is GBP 49.99.")]
    long AmountMinor,

    [property: RegularExpression("^[A-Z]{3}$")]
    [property: Description("ISO 4217 currency code, uppercase.")]
    string Currency,

    [property: StringLength(64, MinimumLength = 8)]
    [property: Description("Your reference for this payment. Returned on every response.")]
    string Reference);

// ---------------------------------------------------------------------------
record ProblemDetails(string Title, string Detail, int Status);</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   operation       summary                              outcomes
   ---------       -------                              --------
   GetPayment      Fetch one payment by its Ledger id.  200 PaymentView, 404 ProblemDetails
   CreatePayment   Take a payment.                      201 PaymentView, 400 HttpValidationProblemDetails, 409 ProblemDetails, 422 ProblemDetails

     property         required   constraints
     ---------------- ---------- -----------
     amountMinor      yes        minimum=1, maximum=1000000, description=Amount in minor units...
     currency         yes        pattern=^[A-Z]{3}$, description=ISO 4217 currency cod...
     reference        yes        minLength=8, maxLength=64, description=Your reference for th...

     property         required   type
     ---------------- ---------- ----
     id               yes        string
     status           yes        PaymentStatus [Pending,Captured,Failed]
     amountMinor      yes        integer|string (int64)
     currency         yes        string
     failureCode      no         null|string
     createdAt        yes        string (date-time)</code></pre>

  <p>Every constraint in the request schema is enforced by the validator, so the document and the
  behaviour cannot disagree. The enum publishes its complete set of values. And
  <code>failureCode</code> is optional rather than required-and-nullable, because the transformer
  corrected it.</p>

  <div class="callout callout--why">
    <h4>What is still not documented, because nothing can infer it</h4>
    <p>Rate limits. Which errors are retryable. How long "pending" lasts. What happens to a payment
    nobody polls. Those go in the descriptions or they go nowhere.</p>
  </div>
</section>

<section id="serving-it">
  <h2>Serving the document, and who should see it</h2>

  <p><code>MapOpenApi()</code> serves JSON. A person reading JSON is not the point of writing a
  document, so something usually renders it — Swagger UI, Scalar, Redoc — and all of them are a static
  page pointed at your document URL.</p>

  <pre data-lang="csharp" data-net="10" data-title="Serving the document, with the two decisions that matter"><code>var app = builder.Build();

// Available in every environment, because a document that only exists in
// development is a document nobody validates against production behaviour.
app.MapOpenApi();

if (app.Environment.IsDevelopment())
{
    // The rendered UI is a development convenience. In production it is an
    // extra attack surface serving an inventory of your endpoints.
    app.MapScalarApiReference();
}

app.Run();</code></pre>

  <p>Two decisions are hiding in that snippet, and teams routinely get them the wrong way round.</p>

  <h3>The document itself: generate it always, publish it deliberately</h3>

  <p>Guarding <code>MapOpenApi()</code> behind a development check is the common pattern and it is
  usually a mistake: it means the document you test against is generated from a differently-configured
  application than the one that runs. If the document must not be public, keep generating it and
  restrict who can fetch it:</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - generated everywhere, readable by the people who need it"><code>app.MapOpenApi().RequireAuthorization("ApiDocs");</code></pre>

  <p>Better still, write it to a file at build time and publish that. Then the document is a versioned
  artefact you can diff, rather than something that exists only while the service is running.</p>

  <div class="callout callout--warn">
    <h4>An OpenAPI document is a complete inventory of your API</h4>
    <p>Every path, every parameter, every field name, every constraint — including the internal
    endpoints somebody forgot were mapped. That is exactly what it is for, and exactly why publishing
    it unauthenticated is a decision rather than a default. It does not create a vulnerability; it
    removes the effort of finding one.</p>
  </div>

  <h3>The rendered UI: a tool, not a deliverable</h3>

  <p>Swagger UI in production is an interactive client for your API, pre-filled with every endpoint,
  served from your own origin. Sometimes that is exactly what you want — a public developer portal.
  Frequently nobody decided; it was in the template.</p>

  <p>The two questions to answer explicitly: <em>who is this document for</em>, and <em>is the rendered
  page for them or for us?</em> A partner-facing API wants both, published and versioned. An internal
  service wants the document in CI and the UI nowhere.</p>

  <div class="callout callout--note">
    <h4>Swashbuckle, and why this module does not use it</h4>
    <p>For a decade the answer to OpenAPI in .NET was the Swashbuckle package. Since .NET 9 the
    framework generates documents itself, which is what <code>AddOpenApi</code> is, and .NET 10's
    templates use it. Swashbuckle still works and still has features the built-in generator does not.
    Everything in this module — signatures over declarations, the required/nullable distinction,
    contract tests — applies identically to both, because none of it is about the generator.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>The document said it could not happen</h3>

  <p>Ledger publishes a document. A partner generates a client from it, in a language whose generator
  produces strict deserialisers — a missing required property is an exception, not a null. The partner
  reports that roughly one call in nine fails client-side. Ledger's dashboards show 200s throughout,
  p99 unchanged, no exceptions. They cannot reproduce it.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   WHAT THE DOCUMENT PROMISES FOR 200:

     required   id, status, amountMinor, currency, failureReason
     properties id, status, amountMinor, currency, failureReason

   payment    status      conforms   what is missing or wrong
   -------    ------      --------   ------------------------
   PAY-001    captured    yes
   PAY-008    captured    yes
   PAY-009    failed      NO         missing required 'failureReason'; undocumented 'failureCode'</code></pre>

  <p>Only the declined payments break, and they break twice: a declined payment is a different record,
  so it carries a <code>failureCode</code> the document never mentions <em>and</em> omits the
  <code>failureReason</code> the document requires.</p>

  <p>Nobody at Ledger tests with failed payments routinely, and in staging the gateway stub captures
  everything. "One call in nine" is the partner's failure rate and it is also Ledger's decline rate —
  <strong>the bug is proportional to a business metric</strong>, which is why it looked intermittent.</p>

  <p>The line that caused it:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - true when written, unchecked ever after"><code>app.MapGet("/v1/payments/{id}", (string id) =&gt; Results.Ok(Load(id)))
   .Produces&lt;Payment&gt;(StatusCodes.Status200OK);</code></pre>

  <p>Six months after that line was written, a handler started returning <code>FailedPayment</code> for
  declines. Nothing objected. The compiler did not, because the handler returns <code>IResult</code>
  and <code>IResult</code> accepts anything.</p>

  <h3>And the tests passed, for a reason worth internalising</h3>

  <pre data-lang="console" data-title="03-production.cs output"><code>     var payment = await client.GetFromJsonAsync&lt;Payment&gt;("/v1/payments/PAY-009");
     Assert.Equal("failed", payment.Status);

     result   deserialised to a Payment, status 'failed' - THE ASSERTION PASSES</code></pre>

  <p>The response was a <code>FailedPayment</code> and it deserialised cleanly into
  <code>Payment</code>. System.Text.Json ignores the <code>failureCode</code> it does not recognise and
  leaves the <code>failureReason</code> it cannot find as null. <strong>The exact mismatch that throws
  in the partner's strict client is absorbed silently here</strong>, because both sides of that test
  came out of the same assembly.</p>

  <div class="callout callout--gotcha">
    <h4>The whole class of bug, in one sentence</h4>
    <p>Anything in the document that is a <em>claim</em> rather than a <em>consequence</em> — a
    <code>.Produces</code>, a description, a transformer, a hand-written example — is unverified by
    construction, and the tests that look like they cover it do not touch it.</p>
  </div>

  <h3>Two response shapes for one status code</h3>

  <p>The root defect, and the fix was not to correct the <code>.Produces</code> line — that would make
  the document true today and leave it able to lie again tomorrow. One shape per status code, stated in
  the signature:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   version                     responses checked   conform   fail
   -------                     -----------------   -------   ----
   as deployed                                 9         8      1
   fixed                                       9         9      0</code></pre>

  <h3>Leaving the return type as IResult</h3>

  <p>The default, and the reason most generated documents are poor. It costs nothing to fix and nothing
  reminds you to.</p>

  <h3>Int-backed enums on the wire</h3>

  <p>The document publishes "integer" with no list of legal values. Worse than the documentation
  problem: insert a member in the middle of that enum and every existing caller's numbers now mean
  something else, with no error anywhere.</p>

  <h3>decimal for money</h3>

  <p>Published as a double, so every generated client deserialises money into binary floating point.
  Integer minor units survive every generator; <code>decimal</code> does not survive the document.</p>

  <h3>Treating the document as an output rather than an artefact</h3>

  <p>It is generated, so it feels like a build product. It is consumed by third parties who compile
  against it, which makes it a published interface. A renamed property is one line in a diff and a
  broken client in production.</p>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <ol>
    <li><strong>Fetch the document, do not read the code.</strong> Almost every argument about what an
    API promises is settled in thirty seconds by <code>curl</code> against
    <code>/openapi/v1.json</code>. The team's belief about the contract and the published contract are
    different objects.</li>
    <li><strong>Check whether the type is in <code>components/schemas</code> at all.</strong> An absent
    type means no signature mentioned it, which means every handler returning it returns
    <code>IResult</code>.</li>
    <li><strong>Compare a real response against the documented schema, key by key.</strong> Required
    keys present, no undocumented keys. Thirty lines, and it is the check a strict generated client
    performs on the caller's behalf.</li>
    <li><strong>Ask which error responses are exercised in tests.</strong> The failures are where
    documents and reality diverge, because success paths get looked at daily and error paths get looked
    at during incidents.</li>
    <li><strong>For any line in the document, ask what would fail if it became false.</strong> If the
    answer is "nothing", it will be false eventually, and you have already decided how you find out —
    from a partner, or from your build.</li>
  </ol>

  <p>The check in step 3 is the one worth writing down, because it is small enough that there is no
  excuse and it is the only thing that ever verifies the unenforced half of a document. Two helpers:
  one to pull the documented schema for a status code, following the <code>$ref</code>, and one to
  compare a real response against it.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// The documented schema for one status code of one operation, with any $ref
// followed back to components/schemas.
static JsonElement Documented(JsonDocument document, string path, string status)
{
    JsonElement schema = document.RootElement
        .GetProperty("paths").GetProperty(path).GetProperty("get")
        .GetProperty("responses").GetProperty(status)
        .GetProperty("content").EnumerateObject().First().Value
        .GetProperty("schema");

    return schema.TryGetProperty("$ref", out JsonElement reference)
        ? document.RootElement.GetProperty("components").GetProperty("schemas")
            .GetProperty(reference.GetString()!.Split('/').Last())
        : schema;
}

// ---------------------------------------------------------------------------
// A deliberately small conformance check: are the required keys present, and
// is every key in the response one the schema describes. That is enough to
// catch this class of drift, and it is the check a strict generated client
// performs on the caller's behalf.
static string[] Check(JsonElement response, JsonElement schema)
{
    var problems = new List&lt;string&gt;();

    if (schema.TryGetProperty("required", out JsonElement required))
    {
        foreach (JsonElement name in required.EnumerateArray())
        {
            if (!response.TryGetProperty(name.GetString()!, out _))
            {
                problems.Add($"missing required '{name.GetString()}'");
            }
        }
    }

    if (schema.TryGetProperty("properties", out JsonElement properties))
    {
        foreach (JsonProperty property in response.EnumerateObject())
        {
            if (!properties.TryGetProperty(property.Name, out _))
            {
                problems.Add($"undocumented '{property.Name}'");
            }
        }
    }</code></pre>

  <p>That is deliberately not a full JSON Schema validator. It answers two questions — are the required
  keys present, and is every key in the response one the schema describes — and those two catch the
  entire class of drift this module is about, because they are the questions a strict generated client
  asks on the caller's behalf.</p>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   response                       status      conforms to the document
   --------                       ------      ------------------------
   GET /v1/payments/PAY-001       Captured    yes
   GET /v1/payments/PAY-002       Failed      yes
   GET /v1/payments/PAY-003       Pending     yes
   3 of 3 conform</code></pre>

  <p>Drop those two helpers into your test project and every integration test you already have can
  assert conformance as well as behaviour, for one extra line each.</p>

  <div class="callout callout--debug">
    <h4>Four things to put in the build</h4>
    <ul>
      <li><strong>Commit the generated document and diff it on every pull request.</strong> The highest
      value practice here. It turns a change to your public contract into something a reviewer sees,
      next to the code that caused it.</li>
      <li><strong>Validate responses against the document in integration tests.</strong> Every test you
      already have can assert conformance as well as behaviour.</li>
      <li><strong>Fail the build on an undocumented endpoint.</strong> A 200 with no response type is a
      gap somebody will fill with a guess. It is a loop over the document, not a policy.</li>
      <li><strong>Generate a client from your own document and use it in one test.</strong> The only
      way to experience what a caller experiences. Ledger's own SDK was hand-written against the C#
      types and shared every one of the server's assumptions.</li>
    </ul>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"The document is generated, so it is correct"</h4>
    <p>It is generated from what the framework can observe. Everything it cannot observe is either
    absent or a claim you wrote, and the claims are never checked.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"<code>.Produces&lt;T&gt;()</code> makes the endpoint return T"</h4>
    <p>It is a declaration, not a constraint. Nothing verifies it, at compile time or at run time. Use
    it only where the type genuinely cannot express the outcome.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Required and nullable are opposites"</h4>
    <p>In JSON Schema, <code>required</code> is about the key's presence and nullability is about the
    value. A property can be both, and a C# record produces exactly that combination by default.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Adding <code>?</code> to a parameter is a local change"</h4>
    <p>It flips <code>required</code> in your published contract. Measured in exercise 2, along with a
    partner's build breaking on a change that was semantically harmless.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Our integration tests cover the contract"</h4>
    <p>If they deserialise into the server's own types, they confirm that the server agrees with
    itself. The document is not in the test, so the document cannot fail it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Descriptions are documentation polish"</h4>
    <p>They are the only place semantics can live. Every fact a caller needs that is not a type — what
    a status code means, what to do next, what is idempotent — exists in a description or nowhere.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A schema transformer is a safe way to fix the document"</h4>
    <p>It is a rule applied to code that has not been written yet, by people who will not know it
    exists. Exercise 4 measures one that was right for two types and wrong for the third one added
    later.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>The document is the only part of your API most callers ever read</h4>
    <p>Nobody integrating with you reads your handler. They read the document, or they run a generator
    over it and read the types that come out. Whatever it says is what your API is, for practical
    purposes, to everyone outside your team — and if it disagrees with your code, they will discover
    the disagreement in production, in an incident where all your graphs are green.</p>
  </div>

  <p>The second reason is the ranking in the table above, which is not really about OpenAPI at all. It
  is the general question of where a fact lives and what holds it there: a return type is held by the
  compiler, an attribute by the validator, a description by nothing. Once you start asking "what
  enforces this?" about each line of a document, you start asking it about comments, about README files,
  about runbooks, and about every other place a team writes down something true.</p>

  <p>The third is that generating a document changes what you can be careless about. Before you publish
  one, two response shapes for one status code is untidy. Afterwards it is undescribable — the document
  physically cannot express it — and the thing that was untidy becomes a defect with an incident
  attached. <strong>A published contract makes some sloppiness impossible to hide, which is most of its
  value.</strong></p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A payments API takes a status filter typed as an enum. A partner's integration sends
    <code>47</code> and gets a 400 they say is undocumented. The team insists the enum is right there
    in the schema.</p>
    <p>Who is right?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   the enum on the request type              published as
   ----------------------------              ------------
   enum Status { Pending, Captured, Failed }  integer, no enum list
   the same, + JsonStringEnumConverter        no type enum [Pending,Captured,Failed]</code></pre>
        <p>The partner is right. The first schema says "integer" and stops — not which integers, there
        is no enum list at all. A caller reading that document is told to send a number, and 47 is a
        number.</p>
        <p>The document is not at fault either. An int-backed enum genuinely is an undocumented integer
        on the wire; the generator did not lose the information, the serialisation choice never put it
        there. The team is reading the C# and believing they are reading the contract.</p>
        <p>The fix is a serialisation decision, not a documentation one — configure it once
        globally:</p>
        <pre data-lang="csharp" data-net="10" data-title="Right - the wire and the document both get the names"><code>builder.Services.ConfigureHttpJsonOptions(o =&gt;
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));</code></pre>
        <p>And the wider lesson: numeric enum values are a bad API contract quite apart from the
        document. Insert a member in the middle of that enum and every existing caller's numbers now
        mean something else, with no error anywhere. Names do not have that failure mode.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A developer silences a nullable warning by adding <code>?</code> to a handler parameter. Tests
    pass, review passes, it ships. A week later a partner regenerates their client and their build
    breaks.</p>
    <p>What changed, and why did nothing at the API end notice?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   parameter   before        after
   ---------   ------        -----
   tenant      required      required
   page        required      optional</code></pre>
        <p><code>page</code> went from required to optional in the published contract. C# nullability
        is where the framework gets that fact, so a change made to satisfy the compiler changed the
        API's documentation. Nothing noticed because nothing was watching: no test reads the document,
        the diff of a <code>?</code> is one character, and the reviewer saw a nullability fix rather
        than a contract change.</p>
        <p>The direction is worth thinking through, because required-to-optional is the <em>safe</em>
        direction for a request parameter — you are demanding less. The partner's build broke because
        their generator emitted <code>page</code> as an optional argument and the call site was written
        positionally. The runtime contract did not break; their generated code did.</p>
        <p>That is its own lesson. Once you publish a document that people generate code from, the
        <em>shape</em> of the document is part of your contract, not only the behaviour it describes.
        Changes that are semantically harmless can still be source-breaking downstream.</p>
        <p>The practice that catches it: commit the generated document and diff it in review. That
        <code>?</code> becomes a visible line saying <code>required: true</code> →
        <code>required: false</code>, next to the code that caused it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>Amounts are C# <code>decimal</code>s. A partner reconciling against the API reports totals off
    by fractions of a penny across large batches. The API's own totals are exact, and the JSON on the
    wire is correct in both cases.</p>
    <p>Where does the error come from?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   C# property                 published as
   -----------                 ------------
   decimal AsDecimal           number|string, format double
   double AsDouble             number|string, format double
   long AsMinorUnits           integer|string, format int64

     0.1 + 0.2 in decimal   0.3
     0.1 + 0.2 in double    0.30000000000000004
     equal                  False</code></pre>
        <p>The document tells the client to use a double. JSON Schema has no decimal type, so a C#
        <code>decimal</code> is published as "number, format double" and every generator faithfully
        emits a binary floating point field.</p>
        <p>The wire format is fine — the JSON number is exact text. The loss happens on the client,
        after parsing, in a type the document told it to use. Which is why the API's own totals are
        right and nobody at the API end can reproduce it.</p>
        <p>The fix is integer minor units. 4999 pence is an int64 in every language, in the document,
        and on the wire, with no format that can round it. Money in an API contract should not be a
        fractional type at all — and the document is what forces the issue, because it is where the C#
        type stops protecting you.</p>
        <p>If you cannot change the field, publish it as a string with a pattern, which is what several
        payment APIs do. Ugly, unambiguous, and it survives every generator.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>A team hits the nullable-and-required problem and adds a schema transformer that drops nullable
    properties from every <code>required</code> list. It works.</p>
    <p>Two months later, a partner's client stops sending a field the API needs, and the API starts
    returning 400s the partner says are undocumented. The transformer is four lines and does exactly
    what it says. What went wrong?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   RefundRequest                          required, without   required, with
   -------------                          -----------------   --------------
   string                                 required            required
   long                                   required            required
   string?                                required            OPTIONAL
   string?  &lt;- the API needs this         required            OPTIONAL</code></pre>
        <p>The transformer is correct and the premise is wrong. It encodes "nullable implies optional",
        and <code>idempotencyKey</code> is a property that is nullable in C# — because the record has
        to be constructible without it — and mandatory in the API, because the handler rejects a
        request that omits it.</p>
        <p>Those two facts were always in disagreement. The transformer did not create the problem; it
        published it. Before the transformer the document accidentally said the right thing about
        <code>idempotencyKey</code> while saying the wrong thing about <code>reason</code>.</p>
        <p>Why it took two months: existing clients kept sending the field, because they were written
        against the older document. Only a client <em>regenerated</em> after the change stopped sending
        it. A document change takes effect when somebody regenerates, which may be any time between
        immediately and never — so the blast radius of a document edit arrives spread over months,
        uncorrelated with your deployment.</p>
        <p>The fix is at the type, not in the transformer: mark it <code>[Required]</code>, or better,
        make it non-nullable so C# and the API agree. When a global rule produces a wrong answer for
        one type, the type is usually the thing that is wrong — the rule found it.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Why does a handler returning <code>IResult</code> produce a document that mentions no
      response body?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The generator reads the method signature, and
        <code>IResult</code> is one type no matter what you put in it. There is nothing in the
        signature to read.</p></div>
      </details></li>

    <li><p>What does it mean when a type your API returns is absent from
      <code>components/schemas</code> entirely?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>That no signature mentions it. It reaches callers as an
        undescribed body, and a generated client has no class for it at all.</p></div>
      </details></li>

    <li><p>Name the one documentation technique in this module that the compiler enforces.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Declaring the return type as a union such as
        <code>Results&lt;Ok&lt;T&gt;, NotFound&gt;</code>. Add an outcome and the handler does not
        build until the type says so, so the document cannot fall behind the code.</p></div>
      </details></li>

    <li><p>In JSON Schema, what different questions do <code>required</code> and nullability
      answer?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>required</code> asks whether the key must be present;
        nullability asks whether its value may be null. A C# record produces both by default, which
        demands <code>{"x": null}</code> and refuses an object omitting the key.</p></div>
      </details></li>

    <li><p>Why does a plain <code>enum</code> make a worse contract than one with
      <code>JsonStringEnumConverter</code>, in two ways?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The document publishes "integer" with no list of legal values, so
        a caller cannot tell what is allowed. And inserting a member in the middle silently changes
        what every existing caller's numbers mean.</p></div>
      </details></li>

    <li><p>A <code>decimal</code> money field is published how, and why does that matter?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>As "number, format double" — JSON Schema has no decimal. Every
        generated client deserialises money into binary floating point, so the precision you chose
        <code>decimal</code> for does not survive the document.</p></div>
      </details></li>

    <li><p>Why did Ledger's integration tests pass while a partner's generated client failed on the
      same responses?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The tests deserialised into the server's own types, so they could
        only confirm the server agrees with itself. System.Text.Json ignored the unrecognised property
        and left the missing one null. The document was not in the test.</p></div>
      </details></li>

    <li><p>What is the difference between a fact in the document that is a "consequence" and one that
      is a "claim"?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A consequence falls out of something already enforced — a return
        type, a binding rule, a validation attribute — so it cannot drift. A claim (a
        <code>.Produces</code>, a description, a transformer) is checked by nothing and will eventually
        be false.</p></div>
      </details></li>

    <li><p>Why is committing the generated document and diffing it in review worth more than most
      testing here?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It turns a change to your public contract into something a
        reviewer sees, next to the code that caused it, rather than something a partner discovers. A
        renamed property is one line in a diff and a broken client in production.</p></div>
      </details></li>

    <li><p>Adding <code>?</code> to a query parameter has what effect on the published contract?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It flips that parameter from required to optional, because C#
        nullability is where the framework gets that fact.</p></div>
      </details></li>

    <li><p>What kinds of validation rule can never be generated into a schema?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Anything without a JSON Schema equivalent: custom validation
        attributes, <code>IValidatableObject</code>, rules enforced in the handler, and constraints
        spanning two fields. Callers meet those as 400s.</p></div>
      </details></li>

    <li><p>Why is a schema transformer more dangerous than per-endpoint metadata?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It is a rule applied to code that has not been written yet, by
        people who will not know it exists. It governs every type added after it, including the ones
        for which its premise is false.</p></div>
      </details></li>
  </ol>
</section>
`
});
