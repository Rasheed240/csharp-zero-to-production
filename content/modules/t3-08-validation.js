CSPREP.module({
  id: "t3-08-validation",
  minutes: 55,
  updated: "2026-09-03",
  summary: "Ledger adds line items to its invoice API. The validation filter is not touched, because nothing about it looks like it needs to be - and it stops covering half the request. Measured: Validator.TryValidateObject does not recurse, so a nested object and a collection of line items are skipped entirely while the filter goes on rejecting bad references every day. Accepted and rejected counts are identical before and after; the only column that moves is the one nobody was watching.",
  terms: ["validation", "data annotation", "ValidationAttribute", "IValidatableObject",
    "Validator.TryValidateObject", "validateAllProperties", "AddValidation", "source generator",
    "cross-field rule", "domain rule", "input validation", "database constraint", "422", "400"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger's invoice API has validated its requests since it was written. An endpoint filter runs
  <code>Validator.TryValidateObject</code> over every argument and returns a validation problem when
  anything fails. It has worked for two years and there are tests for it.</p>

  <p>A new release adds <strong>line items</strong>. <code>CreateInvoice</code> grows a
  <code>List&lt;InvoiceLine&gt;</code>, and <code>InvoiceLine</code> carries its own attributes — a
  required description, an amount in range — written by somebody who assumed they would be enforced the
  way every other attribute in the codebase is.</p>

  <p>Nothing about the filter changed, because nothing about the filter looked like it needed to.</p>

  <pre data-lang="console" data-title="03-production.cs"><code>   version                             accepted   rejected   bad rows
   -------                             --------   --------   --------
   v1  the filter, flat request type          4          1          0
   v2  the filter, lines added                4          1          3
   v3  built-in validation, lines             1          4          0</code></pre>

  <p><strong>Look at the first two columns of v1 and v2. They are identical.</strong> From outside, the
  validation behaved exactly as it always had — four accepted, one rejected, every day.</p>

  <p>The only column that moved is the last one. Three of those four accepted invoices carry a line that
  violates a rule the type states, including one with a negative amount. Three weeks later, finance asks
  why some invoices total less than the sum of their lines.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every status code, error key and count in this module was produced by running the programs shown
    and pasted in unedited.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What validation is, and is not</h2>

  <p class="define"><span class="define__term">Validation</span> Deciding whether the values in a
  request are acceptable. It happens after binding — which asks only whether a value of the declared
  type could be produced — and before your handler acts on them.</p>

  <p class="define"><span class="define__term">Data annotation</span> An attribute on a property stating
  a rule about its value: <code>[Required]</code>, <code>[Range]</code>, <code>[StringLength]</code>,
  <code>[EmailAddress]</code>. <strong>The attribute records the rule. It does not enforce it.</strong></p>

  <p class="define"><span class="define__term">Validator</span> The thing that reads those attributes
  and checks them. In a controller with <code>[ApiController]</code> it is built in; in a minimal API it
  is one registration.</p>

  <p class="define"><span class="define__term">ValidationResult</span> One reported failure: a message,
  and the names of the members it belongs to. The member names are what let a client attach the message
  to a field rather than showing it as a banner.</p>

  <p class="define"><span class="define__term">Object graph</span> The tree of objects reachable from a
  request type — a nested address, a list of line items, and anything they in turn contain. Whether a
  validator walks it is the subject of the next section.</p>

  <p class="define"><span class="define__term">Source generator</span> Code the compiler writes for you
  at build time, from the types it can see. The .NET 10 validator is one, which is why it can walk an
  object graph without the reflection that breaks trimming and ahead-of-time compilation.</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — Attributes on a type, one line to make them run.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// THE ONE LINE. Without it the attributes below are decoration.
builder.Services.AddValidation();
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseStatusCodePages();

app.MapPost("/payments", (CreatePayment body) =&gt;
    Results.Ok(new { accepted = body.AmountMinor }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

foreach (string json in new[]
{
    """{"amountMinor":123450,"currency":"GBP"}""",
    """{"amountMinor":-5,"currency":"POUNDS"}"""
})
{
    using var content = new StringContent(json, Encoding.UTF8, "application/json");
    using HttpResponseMessage response = await http.PostAsync("/payments", content);
    string body = await response.Content.ReadAsStringAsync();

    Console.WriteLine($"POST {json}");
    Console.WriteLine($"  -&gt; {(int)response.StatusCode} {(body.Length &gt; 150 ? body[..150] + "..." : body)}");
    Console.WriteLine();
}

Console.WriteLine("The attributes are on the type. AddValidation() is what reads them.");
Console.WriteLine("Remove that one line and the second request returns 200.");

await app.StopAsync();

// ---------------------------------------------------------------------------
public sealed class CreatePayment
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public string Currency { get; set; } = "";
}</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>POST {"amountMinor":123450,"currency":"GBP"}
  -&gt; 200 {"accepted":123450}

POST {"amountMinor":-5,"currency":"POUNDS"}
  -&gt; 400 {"type":"...","title":"One or more validation errors occurred.",
          "status":400,"errors":{"AmountMinor":["..."]}}</code></pre>

  <p>Remove <code>builder.Services.AddValidation()</code> and the second request returns 200. The
  attributes are on the type either way.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>Validation is like a checklist taped to a form. Each line names a box and says what a good answer
  looks like: this one must be filled in, this one must be a number between 1 and 100. Somebody has to
  actually read the checklist — the tape does nothing.</p>

  <p><strong>This is an analogy and it misleads in the way this module is about.</strong> A person
  working through a checklist and finding an attached continuation sheet would turn it over and check
  that too. The mechanism most codebases use does not: it reads the checklist on the page in front of it,
  and a stapled-on sheet with its own checklist is treated as a single answer.</p>
</section>

<section id="nesting">
  <h2>What the usual filter does not check</h2>

  <p>This filter appears in blog posts, in framework samples, and in the two preceding modules of this
  track:</p>

  <pre data-lang="csharp" data-net="10" data-title="01-nesting.cs — the usual filter"><code>app.MapGroup("/").AddEndpointFilter(async (context, next) =&gt;
{
    foreach (object? argument in context.Arguments)
    {
        if (argument is null)
        {
            continue;
        }

        var validationContext = new ValidationContext(argument);
        var errors = new List&lt;ValidationResult&gt;();

        if (!Validator.TryValidateObject(argument, validationContext, errors, true))
        {
            return Results.ValidationProblem(errors.ToDictionary(
                e =&gt; e.MemberNames.FirstOrDefault() ?? "request",
                e =&gt; new[] { e.ErrorMessage ?? "invalid" }));
        }
    }

    return await next(context);
});</code></pre>

  <p>Called directly on an object with a bad nested email <em>and</em> a bad collection item:</p>

  <pre data-lang="console" data-title="01-nesting.cs"><code>     TryValidateObject returned : True
     errors found               : 0</code></pre>

  <p><strong>It returned <code>true</code> and found nothing.</strong> Both violations are real, both
  are on properties carrying attributes, and neither was seen.</p>

  <pre data-lang="console" data-title="01-nesting.cs"><code>   body                    status   errors reported
   ----                    ------   ---------------
   top-level field bad        400   Reference
   NESTED object bad          200   (none - ACCEPTED)
   COLLECTION item bad        200   (none - ACCEPTED)
   all valid                  200   (none - ACCEPTED)</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong><code>Validator.TryValidateObject</code> does not recurse.</strong> It checks the
    attributes on the object you hand it, and treats a property whose type is another class as a single
    value.</p>
    <p>The parameter name makes this worse: <code>validateAllProperties</code> means "check every
    property of <em>this</em> object", not "check everything reachable". Setting it to <code>true</code>
    is necessary and it is not what it sounds like.</p>
    <p>So a request type of scalars is validated correctly. The moment somebody adds a nested address, a
    list of line items or a set of options, <strong>half the rules quietly stop running</strong> — and
    nothing in the type, the filter or the endpoint says so.</p>
  </div>

  <p class="define"><span class="define__term">Recursion</span> Here, a validator visiting the objects
  <em>inside</em> the object it was given, and the objects inside those. The whole of this module's
  incident is one mechanism that does not do it and one that does.</p>

  <h3>The built-in validation</h3>

  <pre data-lang="console" data-title="01-nesting.cs"><code>   body                    status   errors reported
   ----                    ------   ---------------
   top-level field bad        400   Reference
   NESTED object bad          400   Payer.Email
   COLLECTION item bad        400   Lines[0].AmountMinor
   all valid                  200   (none - ACCEPTED)</code></pre>

  <p>All three rejected, and look at the error <em>keys</em>: <code>Payer.Email</code> is the path into
  the nested object, <code>Lines[0].AmountMinor</code> the index of the offending item. A client can
  point at the field that was wrong rather than at the request.</p>

  <pre data-lang="csharp" data-net="10" data-title="Two lines"><code>builder.Services.AddValidation();

var group = app.MapGroup("/v1").WithValidation();</code></pre>

  <p>It is a <strong>source generator</strong> rather than reflection, which is how it walks a graph
  without the trimming and AOT problems reflection would bring — and which means it only covers types it
  can see at compile time.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Measured while writing this module's verification files: <strong>the generator works from a
    single <code>AddValidation()</code> call site and silently does nothing when a program contains
    several.</strong> One site, executed conditionally, behaves correctly.</p>
    <p>An ordinary application has one call site, so this rarely bites. It bites in test harnesses and
    sample programs that build several hosts — which is exactly where you would go to check that
    validation works.</p>
  </div>

  <p><strong>If you cannot use it</strong>, there are three options and they are not equal: walk the
  graph yourself (thirty lines, and easy to get wrong — cycles, dictionaries, structs); use
  FluentValidation, whose <code>RuleForEach</code> and <code>SetValidator</code> handle exactly this;
  or <strong>flatten the request type</strong> so there is nothing to recurse into. The third sounds
  like avoidance and is often right: a request type is a wire contract rather than a domain model, and a
  flat one is easier to version and document as well as to validate.</p>
</section>

<section id="beyond-attributes">
  <h2>Rules an attribute cannot express</h2>

  <h3>A rule spanning two fields</h3>

  <pre data-lang="console" data-title="02-beyond-attributes.cs"><code>   body                              status   errors
   ----                              ------   ------
   immediate, no date                   200   (none - accepted)
   immediate WITH a date                400   ScheduledFor
   scheduled, no date                   400   ScheduledFor
   scheduled with a date                200   (none - accepted)</code></pre>

  <p class="define"><span class="define__term">IValidatableObject</span> An interface with one method,
  implemented by the request type itself, for rules no single property can express.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-beyond-attributes.cs"><code>public IEnumerable&lt;ValidationResult&gt; Validate(ValidationContext validationContext)
{
    if (Scheduled &amp;&amp; ScheduledFor is null)
    {
        yield return new ValidationResult(
            "a scheduled transfer needs a date",
            [nameof(ScheduledFor)]);
    }

    if (!Scheduled &amp;&amp; ScheduledFor is not null)
    {
        yield return new ValidationResult(
            "an immediate transfer must not carry a date",
            [nameof(ScheduledFor)]);
    }
}</code></pre>

  <p>Two details worth getting right:</p>

  <ul>
    <li><strong>Name the member.</strong> Without it the error is filed under an empty key and a client
    cannot attach it to a field — the difference between highlighting the date box and showing a
    banner.</li>
    <li><strong>It runs after the property attributes</strong>, and only if they passed. So it can
    assume the individual values are well-formed, and a client fixing one error may then see a second it
    could not have been told about first.</li>
  </ul>

  <p class="define"><span class="define__term">Cross-field rule</span> A rule about the relationship
  between two or more values, which no single property can express — "if this is true, that must be
  present".</p>

  <h3>A rule you want on several types</h3>

  <pre data-lang="console" data-title="02-beyond-attributes.cs"><code>   currency   status   errors
   --------   ------   ------
   GBP           200   (none - accepted)
   gbp           400   Currency
   POUNDS        400   Currency
   12            400   Currency</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-beyond-attributes.cs"><code>public sealed class CurrencyCodeAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context)
    {
        // Presence is [Required]'s job. Returning success for null here is what
        // gives one error rather than two for an absent value.
        if (value is null)
        {
            return ValidationResult.Success;
        }

        string code = value as string ?? string.Empty;
        bool wellFormed = code.Length == 3 &amp;&amp; code.All(char.IsAsciiLetterUpper);

        return wellFormed
            ? ValidationResult.Success
            : new ValidationResult(
                "currency must be a three-letter uppercase code",
                [context.MemberName ?? "Currency"]);
    }
}</code></pre>

  <p>A <code>ValidationAttribute</code> subclass is reusable anywhere. Note the second row:
  <code>gbp</code> is rejected because the rule checks for uppercase — which is a <em>decision</em>, not
  an obvious truth. An API that accepts lowercase and normalises it is also defensible.</p>

  <p>Prefer being <strong>strict about shape and forgiving about form</strong>: three letters is a
  shape, uppercase is a form.</p>

  <p>Two rules for a custom attribute: it must be <strong>pure and fast</strong>, because it runs on
  every request; and it should <strong>return success for <code>null</code></strong> unless the rule is
  about presence, so that combining it with <code>[Required]</code> gives one error rather than two.</p>

  <p class="define"><span class="define__term">Custom validation attribute</span> A class deriving from
  <code>ValidationAttribute</code> with one method to override. Reusable across every type that needs
  the rule, and named at the point of use.</p>

  <h3>A rule that needs to look something up</h3>

  <pre data-lang="console" data-title="02-beyond-attributes.cs"><code>   endpoint     currency   status   response
   --------     --------   ------   --------
   /transfers   USD           200   {"amountMinor":100}
   /domain      GBP           200   {"amountMinor":100}
   /domain      USD           422   {"error":"currency not enabled for this account"...</code></pre>

  <p>The first row passes validation: <code>USD</code> is three uppercase letters, so every attribute is
  satisfied. <strong>Whether this account may send USD is a question about the world, and no attribute
  can answer it.</strong></p>

  <p><code>ValidationContext</code> exposes <code>GetService</code>, so it is <em>possible</em> to inject
  a lookup into an attribute. Three reasons not to:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Reason</th><th>Detail</th></tr></thead>
      <tbody>
        <tr><td><strong>The status code is wrong</strong></td><td>A failing attribute produces 400, meaning "malformed". "GBP only for this account" is 422 — well-formed and unacceptable</td></tr>
        <tr><td><strong>It hides I/O in a declaration</strong></td><td>An attribute looks free. One that queries a database runs before authentication, on every request, including ones that were going to be rejected anyway</td></tr>
        <tr><td><strong>The answer can change</strong></td><td>A currency enabled when the attribute ran may be disabled by the time the transfer is written — so the check has to happen where the decision is</td></tr>
      </tbody>
    </table>
  </div>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs — the domain rule, in the handler"><code>app.MapPost("/v1/invoices", (
    CreateInvoice body,
    ICurrencyCatalogue currencies,
    ILedger ledger) =&gt;
{
    // Everything that depends on state outside the request. 422, not 400 -
    // the request was well-formed and is not allowed.
    if (!currencies.IsEnabled(body.Currency))
    {
        return Results.UnprocessableEntity(new
        {
            error = "currency not enabled for this account",
            currency = body.Currency
        });
    }

    // The write itself refuses data that would be inconsistent, whatever
    // reached it.
    if (!ledger.TryRecord(body, out string? violation))
    {
        return Results.UnprocessableEntity(new { error = violation });
    }

    return Results.Created($"/v1/invoices/{body.Reference}", new
    {
        body.Reference,
        total = body.Lines.Sum(line =&gt; line.AmountMinor)
    });
});</code></pre>

  <p><strong>The test for where a rule belongs: does it depend on anything outside the request?</strong>
  "Between 1 and a million" does not, so it is an attribute. "Enabled for this account" does, so it
  cannot be — however convenient that would be.</p>
</section>

<section id="layering">
  <h2>The four layers</h2>

  <p class="define"><span class="define__term">Domain rule</span> A rule that depends on state outside
  the request — an account's settings, a balance, what else exists. It cannot be an attribute, because
  an attribute sees only the request.</p>

  <p class="define"><span class="define__term">Invariant</span> Something that must be true of your
  stored data at all times, regardless of which code path wrote it. A database constraint is how an
  invariant is enforced rather than merely intended.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Layer</th><th>Answers</th><th>Failure</th><th>Can a change remove it?</th></tr></thead>  <div class="table-wrap">
    <table>
      <thead><tr><th>Layer</th><th>Answers</th><th>Failure</th><th>Can a change remove it?</th></tr></thead>
      <tbody>
        <tr><td>Binding</td><td>Can a value of this type be produced at all?</td><td>400</td><td>No</td></tr>
        <tr><td>Input validation</td><td>Is this value well-formed and in range?</td><td>400</td><td><strong>Yes</strong> — a forgotten attribute, a nested type, a port</td></tr>
        <tr><td>Domain rules</td><td>Is this allowed given the current state?</td><td>422</td><td><strong>Yes</strong> — a path that skips it, a background job</td></tr>
        <tr><td>Database constraints</td><td>Is the stored data internally consistent?</td><td>An error</td><td><strong>No</strong></td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>The last column is the argument for having all four.</strong> Every layer above the last is
  something a change can silently remove — and this module and the previous two are three measured
  examples of exactly that happening.</p>

  <p>The one that cannot be removed is the one furthest from the caller and least able to explain
  itself. That is the trade, and it is why "the database will catch it" and "we validate at the edge"
  are both wrong on their own:</p>

  <ul>
    <li>Edge validation alone gives good messages and no guarantee.</li>
    <li>Constraints alone give a guarantee and a 500 with a violation nobody can act on.</li>
  </ul>

  <p>Concretely:</p>

  <pre data-lang="text" data-title="Where each rule goes"><code>amount is a number              binding
amount is between 1 and 1m      input validation
currency is three letters       input validation
scheduled implies a date        input validation, cross-field
currency enabled for account    domain rule
account has sufficient balance  domain rule
amount_minor &gt; 0                database constraint
currency is a known code        database foreign key</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>One of those looks like validation and is not. <strong>"The account has sufficient balance" is a
    race.</strong> Checking a balance and then debiting it are two operations, and the balance can
    change in between.</p>
    <p>That check has to be part of the write — a conditional update, a transaction, a constraint — not
    a question asked beforehand. Validating it at the edge is not merely misplaced; it is a check that
    cannot be correct where it stands.</p>
  </div>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>Back to the invoices. Five requests against three versions:</p>

  <pre data-lang="console" data-title="03-production.cs"><code>   version                             accepted   rejected   bad rows
   -------                             --------   --------   --------
   v1  the filter, flat request type          4          1          0
   v2  the filter, lines added                4          1          3
   v3  built-in validation, lines             1          4          0</code></pre>

  <p><strong>Nobody made a mistake.</strong> The filter was correct when written and is still correct
  for what it does. The attributes on <code>InvoiceLine</code> are correct. The tests written for the
  filter still pass, because they were written against the flat request type that existed then.</p>

  <p>What changed is the <em>shape of the data</em>, and the coverage of a tool that had never been asked
  whether it handled that shape.</p>

  <h3>The whole contract in one file</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — One endpoint with all four layers of checking in
// place, and each one doing only its own job.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and error key here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// LAYER 2: input validation. One line, and it walks nested objects and
// collections - which the hand-rolled Validator.TryValidateObject filter does
// not, as measured in 01-nesting.cs.
builder.Services.AddValidation();

// So that a rejection is a document naming the field rather than a bare code.
builder.Services.AddProblemDetails();

builder.Services.AddSingleton&lt;ICurrencyCatalogue, CurrencyCatalogue&gt;();
builder.Services.AddSingleton&lt;ILedger, Ledger&gt;();

var app = builder.Build();
app.UseStatusCodePages();

app.MapPost("/v1/invoices", (
    CreateInvoice body,
    ICurrencyCatalogue currencies,
    ILedger ledger) =&gt;
{
    // LAYER 3: domain rules. Everything that depends on state outside the
    // request, and therefore cannot be an attribute. 422, not 400 - the
    // request was well-formed and is not allowed.
    if (!currencies.IsEnabled(body.Currency))
    {
        return Results.UnprocessableEntity(new
        {
            error = "currency not enabled for this account",
            currency = body.Currency
        });
    }

    // LAYER 4 stands in for a database constraint: the write itself refuses
    // data that would be internally inconsistent, whatever reached it.
    if (!ledger.TryRecord(body, out string? violation))
    {
        return Results.UnprocessableEntity(new { error = violation });
    }

    return Results.Created($"/v1/invoices/{body.Reference}", new
    {
        body.Reference,
        total = body.Lines.Sum(line =&gt; line.AmountMinor)
    });
});

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("Four layers, each doing only its own job");
Console.WriteLine();
Console.WriteLine("   request                          status   caught by");
Console.WriteLine("   -------                          ------   ---------");

await Post(http, """{"reference":"INV-1","currency":"GBP","lines":[{"description":"work","amountMinor":50000}]}""",
    "valid", "-");

await Post(http, """{"reference":"INV-2","currency":"GBP","lines":[{"description":"work","amountMinor":"lots"}]}""",
    "amount is not a number", "binding");

await Post(http, """{"reference":"","currency":"GBP","lines":[{"description":"work","amountMinor":50000}]}""",
    "reference empty", "input validation");

await Post(http, """{"reference":"INV-4","currency":"GBP","lines":[{"description":"work","amountMinor":-5}]}""",
    "NESTED line negative", "input validation");

await Post(http, """{"reference":"INV-5","currency":"GBP","lines":[]}""",
    "no lines at all", "input validation (cross-field)");

await Post(http, """{"reference":"INV-6","currency":"USD","lines":[{"description":"work","amountMinor":50000}]}""",
    "currency not enabled", "domain rule");

await Post(http, """{"reference":"INV-1","currency":"GBP","lines":[{"description":"work","amountMinor":50000}]}""",
    "duplicate reference", "the write itself");

Console.WriteLine();
Console.WriteLine("   Each row is stopped by exactly one layer, and each layer answers only");
Console.WriteLine("   the question it can answer:");
Console.WriteLine();
Console.WriteLine("     binding             can a value of this type be produced?      400");
Console.WriteLine("     input validation    is the value well-formed and in range?     400");
Console.WriteLine("     domain rules        is this allowed given the current state?   422");
Console.WriteLine("     the write           is the stored data consistent?             422");
Console.WriteLine();
Console.WriteLine("   The 400/422 split is the load-bearing part. 400 says the request is");
Console.WriteLine("   malformed and re-sending it unchanged is pointless. 422 says the");
Console.WriteLine("   request was fine and the answer depends on state - so the same request");
Console.WriteLine("   might succeed later.");
Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - AddValidation(), which walks nested objects and collections");
Console.WriteLine("     - AddProblemDetails and UseStatusCodePages, so an error names a field");
Console.WriteLine("     - attributes for rules decidable from the request alone");
Console.WriteLine("     - IValidatableObject for rules spanning two fields, naming the member");
Console.WriteLine("     - a service lookup in the HANDLER for anything about the world, with");
Console.WriteLine("       422 rather than 400");
Console.WriteLine("     - the write refusing inconsistent data whatever reached it");
Console.WriteLine();
Console.WriteLine("   WHY ALL FOUR. Every layer except the last is something a change can");
Console.WriteLine("   silently remove: a port to another framework, a nested type the filter");
Console.WriteLine("   does not reach, a new endpoint that forgets the group, a background job");
Console.WriteLine("   that writes directly.");
Console.WriteLine();
Console.WriteLine("   The layer that cannot be removed is the one furthest from the caller");
Console.WriteLine("   and least able to explain itself. That is the trade, and it is why");
Console.WriteLine("   'the database will catch it' and 'we validate at the edge' are both");
Console.WriteLine("   wrong on their own.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Post(HttpClient http, string json, string note, string layer)
{
    using var content = new StringContent(json, Encoding.UTF8, "application/json");
    using HttpResponseMessage response = await http.PostAsync("/v1/invoices", content);

    Console.WriteLine($"   {note,-31}  {(int)response.StatusCode,6}   {layer}");
}

// ---------------------------------------------------------------------------
public sealed class CreateInvoice : IValidatableObject
{
    [Required]
    [MinLength(1)]
    public string Reference { get; set; } = "";

    [Required]
    [RegularExpression("^[A-Z]{3}$")]
    public string Currency { get; set; } = "";

    public List&lt;InvoiceLine&gt; Lines { get; set; } = [];

    // A rule about the request as a whole, decidable without any lookup.
    public IEnumerable&lt;ValidationResult&gt; Validate(ValidationContext validationContext)
    {
        if (Lines.Count == 0)
        {
            yield return new ValidationResult(
                "an invoice must have at least one line", [nameof(Lines)]);
        }
    }
}

public sealed class InvoiceLine
{
    [Required]
    [MinLength(1)]
    public string Description { get; set; } = "";

    [Range(1, 10_000_000)]
    public long AmountMinor { get; set; }
}

public interface ICurrencyCatalogue
{
    bool IsEnabled(string currency);
}

public sealed class CurrencyCatalogue : ICurrencyCatalogue
{
    // Stands in for a lookup whose answer can change between requests, which
    // is exactly why it cannot be an attribute.
    public bool IsEnabled(string currency) =&gt; currency == "GBP";
}

public interface ILedger
{
    bool TryRecord(CreateInvoice invoice, out string? violation);
}

// Stands in for the database. It refuses data that would be inconsistent,
// whatever validation did or did not run in front of it.
public sealed class Ledger : ILedger
{
    private readonly HashSet&lt;string&gt; _references = [];

    public bool TryRecord(CreateInvoice invoice, out string? violation)
    {
        if (!_references.Add(invoice.Reference))
        {
            violation = "an invoice with that reference already exists";
            return false;
        }

        if (invoice.Lines.Any(line =&gt; line.AmountMinor &lt; 1))
        {
            violation = "a line amount must be positive";
            return false;
        }

        violation = null;
        return true;
    }
}</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   request                          status   caught by
   -------                          ------   ---------
   valid                               201   -
   amount is not a number              400   binding
   reference empty                     400   input validation
   NESTED line negative                400   input validation
   no lines at all                     400   input validation (cross-field)
   currency not enabled                422   domain rule
   duplicate reference                 422   the write itself</code></pre>

  <p>Each row is stopped by exactly one layer, and the 400/422 split is the load-bearing part: 400 says
  the request is malformed and re-sending it unchanged is pointless; 422 says the request was fine and
  the answer depends on state, so the same request might succeed later.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger issues about 300 invoices a day, and roughly one in fifty carried a line the rules should
    have rejected — a discount entered as a negative amount rather than through the credit-note flow,
    most often. Over three weeks that is <strong>about 125 invoices whose total does not match the sum
    of their lines</strong>.</p>
    <p>Correcting them meant reissuing each one, because an invoice that has been sent cannot be edited.
    The engineering fix was two lines.</p>
    <p><strong>The general lesson:</strong> a validation mechanism has a reach, and its reach is not
    visible at the place you use it. The filter <em>looks</em> like it validates "the request". It
    validates one object. Every attribute written inside a nested type looks exactly like one that will
    be enforced.</p>
    <p>And the check that would have found it in a day rather than three weeks: <strong>assert that the
    invoice total equals the sum of its lines.</strong> Every request succeeded, so no technical signal
    moved — the only thing wrong was an arithmetic relationship in the data.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Attributes with no validator</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the attributes are decoration"><code>// No AddValidation(), no filter, no [ApiController]
app.MapPost("/payments", (CreatePayment body) =&gt;
    Results.Ok(new { accepted = body.AmountMinor }));</code></pre>

  <p>Symptom: invalid values reach the handler and the database. Cause: an attribute records a rule and
  does not enforce it. Fix: <code>builder.Services.AddValidation()</code>.</p>

  <h3>A filter that only sees one level</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the Lines rules never run"><code>public sealed class CreateInvoice
{
    [Required, MinLength(1)]
    public string Reference { get; set; } = "";

    // Every attribute inside InvoiceLine is skipped by
    // Validator.TryValidateObject, and nothing says so.
    public List&lt;InvoiceLine&gt; Lines { get; set; } = [];
}</code></pre>

  <p>Symptom: rules on a nested type or a collection never fire, while top-level rules keep working.
  Cause: <code>Validator.TryValidateObject</code> does not recurse. Fix: the built-in validation, a
  library, or a flatter request type.</p>

  <h3>A cross-field error with no member name</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the client cannot place the error"><code>yield return new ValidationResult("a scheduled transfer needs a date");</code></pre>

  <p>Symptom: an error appears under an empty key and a form cannot highlight the field. Fix: pass the
  member names.</p>

  <h3>A database call inside a validation attribute</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - I/O hidden in a declaration"><code>protected override ValidationResult? IsValid(object? value, ValidationContext context)
{
    var catalogue = context.GetService&lt;ICurrencyCatalogue&gt;();
    return catalogue!.IsEnabled((string)value!)
        ? ValidationResult.Success
        : new ValidationResult("currency not enabled");
}</code></pre>

  <p>Symptom: query load from unauthenticated traffic, a 400 where 422 belongs, and a check whose answer
  can change before the action happens. Fix: put it in the handler.</p>

  <h3>A custom attribute that rejects null</h3>

  <p>Symptom: two errors for one absent value. Cause: the attribute duplicates
  <code>[Required]</code>'s job. Fix: return <code>ValidationResult.Success</code> for
  <code>null</code>.</p>

  <h3>Validating a balance before writing</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the balance can change between these two lines"><code>if (await accounts.GetBalanceAsync(id, token) &lt; body.AmountMinor)
{
    return Results.UnprocessableEntity(new { error = "insufficient funds" });
}

await accounts.DebitAsync(id, body.AmountMinor, token);</code></pre>

  <p>Symptom: overdrafts under concurrency, rarely and unreproducibly. Cause: the balance changed
  between the check and the write. Fix: make the check part of the write.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>Validation failures are silent by construction — a rule that does not run produces a successful
    request. So the diagnostic is never in the logs; it is a deliberately bad request:</p>
    <pre data-lang="bash" data-title="One per level of nesting"><code># top level
curl -i -X POST .../invoices -H "Content-Type: application/json" \
  -d '{"reference":"","lines":[{"description":"a","amountMinor":100}]}'

# nested - valid at the top, invalid underneath
curl -i -X POST .../invoices -H "Content-Type: application/json" \
  -d '{"reference":"R1","lines":[{"description":"a","amountMinor":-5}]}'</code></pre>
    <p>The second request is the whole module. If it returns 200, the rules inside your nested types are
    not running — and no other signal will tell you.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Look at</th><th>What you are looking for</th></tr></thead>
      <tbody>
        <tr>
          <td>Invalid values in the database</td>
          <td>Whether anything reads the attributes</td>
          <td>No <code>AddValidation()</code>, no filter, no <code>[ApiController]</code></td>
        </tr>
        <tr>
          <td>Top-level rules fire, nested ones do not</td>
          <td>The validation mechanism</td>
          <td><code>Validator.TryValidateObject</code>, which does not recurse</td>
        </tr>
        <tr>
          <td>Validation stopped working after a refactor</td>
          <td>The number of <code>AddValidation()</code> call sites</td>
          <td>More than one — the generator does nothing then</td>
        </tr>
        <tr>
          <td>An error with an empty key</td>
          <td>The <code>ValidationResult</code> constructor</td>
          <td>No member names passed</td>
        </tr>
        <tr>
          <td>400 where the request was well-formed</td>
          <td>Whether the rule needs a lookup</td>
          <td>A domain rule implemented as an attribute. It should be 422 in the handler</td>
        </tr>
        <tr>
          <td>Two errors for one missing field</td>
          <td>A custom attribute's null handling</td>
          <td>It rejects null instead of deferring to <code>[Required]</code></td>
        </tr>
        <tr>
          <td>Totals that do not add up</td>
          <td>The relationship, not the error rate</td>
          <td>Every request succeeded — only the data is inconsistent</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"The attributes are on the type, so the rules are enforced."</em></p>
    <p>An attribute is metadata. Something has to read it — and in a minimal API nothing does until you
    register it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"validateAllProperties: true validates everything."</em></p>
    <p>It validates every property of <em>that object</em>. A nested object and a collection of items are
    skipped entirely, and the name is why nobody checks.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"Our validation is tested, so it works."</em></p>
    <p>The tests were written against the request types that existed then. In the incident above they
    kept passing throughout, because the shape they covered had not changed — only the shape they did
    not.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"A validation attribute is the tidiest place for any rule."</em></p>
    <p>Not for a rule that needs a lookup. It produces the wrong status code, hides I/O in a declaration,
    and asks a question whose answer can change before the action happens.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"If we validate at the edge, database constraints are belt and braces."</em></p>
    <p>Edge validation is the layer a change can silently remove — three modules in this track have now
    measured that happening. The constraint is the only one that cannot be bypassed by a new endpoint, a
    background job, or a port.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><em>"400 and 422 are interchangeable."</em></p>
    <p>400 says the request is malformed, so re-sending it unchanged is pointless. 422 says the request
    was fine and the answer depended on state, so it might succeed later. That is a materially different
    instruction to a client with a retry policy.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Decision</th><th>Cost to get right</th><th>Cost of getting it wrong</th></tr></thead>
      <tbody>
        <tr><td>A validator that recurses</td><td>One line</td><td>~125 invoices whose totals do not match their lines</td></tr>
        <tr><td>A test per level of nesting</td><td>One request each</td><td>Three weeks, because every other signal was normal</td></tr>
        <tr><td>Member names on cross-field errors</td><td>One argument</td><td>A form that cannot highlight the field</td></tr>
        <tr><td>Domain rules in the handler</td><td>An <code>if</code></td><td>400 where 422 belongs, and a check that can go stale</td></tr>
        <tr><td>A database constraint behind all of it</td><td>One <code>CHECK</code></td><td>The only layer a framework change cannot remove</td></tr>
      </tbody>
    </table>
  </div>

  <p>Two things generalise beyond validation.</p>

  <p><strong>A mechanism's reach is not visible at the place you use it.</strong> The filter reads as
  "validate the request" and means "validate one object". Every rule written inside a nested type looks
  identical to one that will be enforced. When you adopt a mechanism, the question to ask is not "does
  it work?" — it demonstrably did — but "what is it <em>not</em> looking at?"</p>

  <p><strong>A test suite covers the shapes that existed when it was written.</strong> The filter's tests
  kept passing for three weeks after it stopped covering half the request, and they were not bad tests.
  The new coverage has to be written when the new shape is added, by whoever adds it — which means the
  person who needs to know about this limitation is the one adding a nested type, not the one who wrote
  the validation.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>This type has <code>[Range(1, 1_000_000)]</code> on its amount, and the endpoint accepts −5. What
    is missing?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   configuration                    -5 accepted?
   -------------                    ------------
   nothing registered               YES - 200
   builder.Services.AddValidation() no  - 400</code></pre>
        <p><strong>The attributes are inert until something reads them.</strong> An attribute is
        metadata — a fact recorded about a property — and recording a rule is not enforcing it.</p>
        <p>In a controller with <code>[ApiController]</code> the reader is built in. In a minimal API you
        register it: one line, and .NET 10 ships it.</p>
        <p>That difference in defaults is the whole of the previous module's incident, and it is worth
        carrying as a habit: <strong>after writing a validation attribute, send one request that violates
        it.</strong></p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>A hand-rolled filter using <code>Validator.TryValidateObject</code> has been in the codebase for
    two years. Someone adds a nested object and a list. Which rules still run?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   body                    hand-rolled   AddValidation()
   ----                    -----------   ---------------
   top-level bad           Reference     Reference
   NESTED bad              ACCEPTED      Payer.Email
   COLLECTION bad          ACCEPTED      Lines[0].AmountMinor
   all valid               ACCEPTED      ACCEPTED</code></pre>
        <p><strong>Only the top level.</strong> <code>Validator.TryValidateObject</code> checks the
        attributes on the object handed to it and treats a property whose type is another class as a
        single value.</p>
        <p>The parameter name makes it worse: <code>validateAllProperties</code> means "every property of
        <em>this</em> object", not "everything reachable" — so it is necessary and it is not what it
        sounds like.</p>
        <p><code>AddValidation()</code> walks the graph and names the path — <code>Payer.Email</code>,
        <code>Lines[0].AmountMinor</code>. It is a source generator rather than reflection, which is how
        it does this without breaking trimming and AOT, and which means it only covers types visible at
        compile time.</p>
        <p><strong>If you cannot use it:</strong> walk the graph yourself (thirty fiddly lines — cycles,
        dictionaries, structs), use FluentValidation, or flatten the request type. The third is not
        avoidance: a request type is a wire contract rather than a domain model.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>"A scheduled transfer must have a date; an immediate one must not." Where does that rule go?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   body                              status   errors
   ----                              ------   ------
   immediate, no date                   200   (accepted)
   immediate WITH a date                400   ScheduledFor
   scheduled, no date                   400   ScheduledFor
   scheduled with a date                200   (accepted)</code></pre>
        <p><strong><code>IValidatableObject</code>.</strong> No single property can express a rule about
        two, so the type implements one method.</p>
        <p>Two details worth getting right:</p>
        <ul>
          <li><strong>Name the member.</strong> Without it the error is filed under an empty key and a
          client cannot attach it to a field — the difference between highlighting the date box and
          showing a banner.</li>
          <li><strong>It runs after the property attributes</strong>, and only if they passed. So it can
          assume the values are well-formed, and a client fixing one error may then see a second it could
          not have been told about first.</li>
        </ul>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>"This account may only send GBP." Someone proposes a <code>[CurrencyEnabled]</code> attribute that
    resolves a service from <code>ValidationContext</code>. Argue for or against.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs"><code>   endpoint   currency   status   meaning
   --------   --------   ------   -------
   /edge      POUNDS        400   malformed - a 400 is right
   /edge      USD           200   well-formed; the edge has no opinion
   /domain    USD           422   well-formed and not allowed - 422</code></pre>
        <p><strong>Against</strong>, on three grounds:</p>
        <ol>
          <li><strong>The status code is wrong.</strong> A failing attribute produces 400, which means
          malformed. "USD is not enabled for this account" is 422 — and the distinction tells a client
          whether fixing the request could ever help.</li>
          <li><strong>It hides I/O in a declaration.</strong> An attribute looks free. One that queries a
          database runs before authentication, on every request, including ones that were going to be
          rejected anyway.</li>
          <li><strong>The answer can change between the check and the action.</strong> A currency enabled
          when the attribute ran may be disabled by the time the transfer is written.</li>
        </ol>
        <p><strong>The test for where a rule belongs:</strong> does it depend on anything outside the
        request? "Between 1 and a million" does not, so it is an attribute. "Enabled for this account"
        does, so it cannot be.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Place each rule in a layer, and say which layers a future change could silently remove.</p>
    <pre data-lang="text" data-title="The rules"><code>a. amount is a number
b. amount is between 1 and 1,000,000
c. currency is three uppercase letters
d. a scheduled transfer has a date
e. currency is enabled for this account
f. the account has sufficient balance
g. no stored payment may have a non-positive amount</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Layer</th><th>Rules</th><th>Failure</th><th>Can a change remove it?</th></tr></thead>
            <tbody>
              <tr><td>Binding</td><td>a</td><td>400</td><td>No</td></tr>
              <tr><td>Input validation</td><td>b, c, d</td><td>400</td><td><strong>Yes</strong> — a forgotten attribute, a nested type, a port</td></tr>
              <tr><td>Domain rules</td><td>e, f</td><td>422</td><td><strong>Yes</strong> — a path that skips it, a background job</td></tr>
              <tr><td>Database constraint</td><td>g</td><td>An error</td><td><strong>No</strong></td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>The last column is the argument for having all four.</strong> Every layer above the
        last is something a change can silently remove — and this module and the previous two are three
        measured examples.</p>
        <p>The dividing line between b/c/d and e/f is the one people move, and the test is whether the
        rule depends on anything outside the request. Rules b, c and d can be decided by reading the
        request alone; e and f cannot, so they belong where the state is — and they get 422 rather than
        400, because the request was fine.</p>
        <p><strong>And one rule that looks like validation and is not: f is a race.</strong> Checking a
        balance and then debiting it are two operations, and the balance can change in between. That
        check has to be part of the write — a conditional update, a transaction, a constraint — not a
        question asked beforehand. Validating it at the edge is not merely misplaced; it is a check that
        cannot be correct where it stands.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Do data annotations enforce anything on their own?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. They record a rule. Something has to read them —
        <code>[ApiController]</code> does, a minimal API does not until you register
        <code>AddValidation()</code>.</p></div></details></li>

    <li><p>What does <code>validateAllProperties: true</code> actually cover?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Every property of the object handed to it. Nested objects and
        collection items are not visited at all.</p></div></details></li>

    <li><p>What do the error keys look like when the built-in validation rejects a nested value?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A path: <code>Payer.Email</code>, and
        <code>Lines[0].AmountMinor</code> with the index of the offending item.</p></div></details></li>

    <li><p>Where does a rule about two fields go?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>IValidatableObject</code> on the request type — and name the
        member in the <code>ValidationResult</code>, or the error is filed under an empty
        key.</p></div></details></li>

    <li><p>When does <code>IValidatableObject.Validate</code> run?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>After the property attributes, and only if they passed. So it may
        assume the individual values are well-formed.</p></div></details></li>

    <li><p>Why should a validation attribute not query a database?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It produces 400 where 422 belongs, it hides I/O that runs before
        authentication on every request, and the answer can change between the check and the
        action.</p></div></details></li>

    <li><p>What is the test for whether a rule belongs at the edge?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Whether it depends on anything outside the request. If it does, it
        is a domain rule and belongs where the state is.</p></div></details></li>

    <li><p>What does 422 tell a client that 400 does not?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>That the request was well-formed and the answer depended on state —
        so the same request might succeed later. A 400 means re-sending it unchanged is
        pointless.</p></div></details></li>

    <li><p>Why is "the account has sufficient balance" not a validation rule?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It is a race. The balance can change between the check and the
        write, so the check has to be part of the write.</p></div></details></li>

    <li><p>Why did the incident's tests keep passing?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>They were written against the flat request type that existed then.
        A test suite covers the shapes it was written for — the new coverage has to be added by whoever
        adds the new shape.</p></div></details></li>
  </ol>
</section>
`
});
