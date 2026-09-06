CSPREP.module({
  id: "t3-15-api-versioning",
  minutes: 55,
  updated: "2026-09-04",
  summary: "v1 was retired on schedule after six months of notice and three rounds of emails, and a fifth of all payment traffic broke - 40% of it from callers no email could have reached. URL against header against media type, nine changes to a payload measured against a client compiled before any of them, and the finding that decides most of it: adding to a response is safe, adding a required field to a request is not, and two of the commonest breaking changes appear in no schema at all.",
  terms: ["API version", "breaking change", "contract", "URL versioning", "media type versioning",
    "Accept header", "Vary", "Sunset header", "Deprecation header", "Link header", "410 Gone",
    "brown-out", "deprecation", "forward compatibility", "additive change"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger shipped v2 of its payments API in January. The plan was ordinary and well run: v2 announced
  with a migration guide, six months of notice that v1 would be retired, three reminder emails to every
  registered integrator, and v1 removed in July on the announced date.</p>

  <p>Within a minute of the deployment, a fifth of all payment traffic is returning 404.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   caller                       version   requests/day   registered   emailed
   ------                       -------   ------------   ----------   -------
   acme-corp                    /v1              4,000   yes          yes
   globex-batch                 /v1              3,000   NO           no
   initech-mobile               /v1              2,000   yes          yes
   internal-reporting           /v1              1,000   NO           no
   acme-corp                    /v2             40,000   yes          yes

   all payment traffic                    50,000
   still on v1                            10,000  (20% of everything)
   of that, from callers nobody            4,000  (40% of v1 traffic)
   could have emailed</code></pre>

  <p><strong>Every step of the plan was done, and the plan was the problem.</strong> It assumed the set
  of callers was the set of registered integrators, and those are different sets: a batch job written by
  somebody who has left; an internal team who integrated from the documentation and never registered
  because they did not need a key; a partner whose integration was built by an agency and whose
  registered contact address bounces.</p>

  <p><strong>The announcement was sent to people. The calls come from processes</strong>, and there is
  no reliable mapping between the two.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every status code, count and outcome in this module was produced by running the programs shown, on
    .NET 10, and pasted in unedited.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What versioning is for</h2>

  <p class="define"><span class="define__term">Contract</span> Everything a caller can depend on: the
  paths, the request shape, the response shape, the status codes, the defaults for anything omitted. It
  is larger than the schema, which is why several of the changes in this module break clients without
  changing any documented type.</p>

  <p class="define"><span class="define__term">Breaking change</span> A change after which a client that
  worked yesterday, unchanged, behaves differently today. That is the whole definition, and it is more
  reliable than any list.</p>

  <p class="define"><span class="define__term">Version</span> A way for one service to offer two
  contracts at once, so a breaking change can ship before every caller has adopted it.</p>

  <p class="define"><span class="define__term">Additive change</span> One that only gives callers more
  than before — a new response field, a new optional request field, a new endpoint. Additive changes are
  safe by default, which is why most of them do not need a version.</p>

  <p class="define"><span class="define__term">Forward compatibility</span> A client's ability to keep
  working when the server sends something it has never seen. For JSON it is the default — unknown fields
  are ignored — and a client can opt out of it, which is measured later in this module.</p>

  <p class="define"><span class="define__term">Deprecation</span> Announcing that something will be
  removed, while it still works. It is the period during which callers can migrate without breaking, and
  it is worth nothing unless somebody is counting who has.</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — Two versions of one endpoint, and the thing versioning is
// actually for: changing a response without changing it for anybody.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every status code and field name here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// v1, written eighteen months ago. Two clients still use it and one of them is
// a mobile application nobody can force to upgrade.
RouteGroupBuilder v1 = app.MapGroup("/v1");

v1.MapGet("/payments/{id}", (string id) =&gt; Results.Ok(new
{
    id,
    amount = 500.00m,
    currency = "GBP"
}));

// v2. The amount moves to minor units, because 500.00 as a decimal was causing
// rounding arguments with the reconciliation team.
RouteGroupBuilder v2 = app.MapGroup("/v2");

v2.MapGet("/payments/{id}", (string id) =&gt; Results.Ok(new
{
    id,
    amountMinor = 50_000L,
    currency = "GBP",
    status = "captured"
}));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("The same payment, two versions");
Console.WriteLine();
Console.WriteLine($"   GET /v1/payments/PAY-1   {await http.GetStringAsync("/v1/payments/PAY-1")}");
Console.WriteLine($"   GET /v2/payments/PAY-1   {await http.GetStringAsync("/v2/payments/PAY-1")}");
Console.WriteLine();

using HttpResponseMessage unversioned = await http.GetAsync("/payments/PAY-1");

Console.WriteLine($"   GET /payments/PAY-1      {(int)unversioned.StatusCode}");
Console.WriteLine();

await app.StopAsync();

Console.WriteLine("   WHAT VERSIONING IS FOR, in one sentence: MAKING A CHANGE THAT WOULD");
Console.WriteLine("   BREAK AN EXISTING CLIENT, WITHOUT BREAKING IT.");
Console.WriteLine();
Console.WriteLine("   The change here is a breaking one and there is no way to make it not be.");
Console.WriteLine("   'amount' became 'amountMinor', a decimal became an integer, and the units");
Console.WriteLine("   changed by a factor of a hundred. Any client reading 'amount' gets");
Console.WriteLine("   nothing; any client that guesses gets a number a hundred times too");
Console.WriteLine("   large.");
Console.WriteLine();
Console.WriteLine("   Two versions running side by side is what lets that change ship on");
Console.WriteLine("   Tuesday while the mobile application keeps working until its users");
Console.WriteLine("   upgrade, which for some of them is never.");
Console.WriteLine();
Console.WriteLine("   NOTICE THE THIRD LINE. An unversioned path is a 404, because nothing is");
Console.WriteLine("   mapped there - which is a decision, and the next file is about which");
Console.WriteLine("   decision to make.");
Console.WriteLine();
Console.WriteLine("   AND NOTICE WHAT VERSIONING COSTS, because it is not free and the cost is");
Console.WriteLine("   the reason most of this module is about avoiding it:");
Console.WriteLine();
Console.WriteLine("     - two endpoints to maintain, two sets of tests, two shapes to document;");
Console.WriteLine();
Console.WriteLine("     - every bug fix has to be considered for both, and every decision about");
Console.WriteLine("       whether a fix is a fix or a change;");
Console.WriteLine();
Console.WriteLine("     - the old one lives until the last client stops calling it, and you do");
Console.WriteLine("       not control when that is.");
Console.WriteLine();
Console.WriteLine("   THE CHEAPEST VERSION IS THE ONE YOU DID NOT HAVE TO CREATE. Most changes");
Console.WriteLine("   people version for are additive, and additive changes do not need a");
Console.WriteLine("   version at all - which is the subject of the file after next.");</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   GET /v1/payments/PAY-1   {"id":"PAY-1","amount":500.00,"currency":"GBP"}
   GET /v2/payments/PAY-1   {"id":"PAY-1","amountMinor":50000,"currency":"GBP","status":"captured"}

   GET /payments/PAY-1      404</code></pre>

  <p><strong>Versioning is for making a change that would break an existing client, without breaking
  it.</strong> The change here is breaking and there is no way to make it not be: <code>amount</code>
  became <code>amountMinor</code>, a decimal became an integer, and the units changed by a factor of a
  hundred.</p>

  <p>Two versions side by side is what lets that ship on Tuesday while the mobile application keeps
  working until its users upgrade — which for some of them is never.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Versioning is not free, and the cost is the reason most of this module is about avoiding it: two
    endpoints to maintain, two sets of tests, two shapes to document; every bug fix considered for both,
    and every decision about whether a fix is a fix or a change; and the old version lives until the last
    client stops calling it, which is not a date you control.</p>
    <p><strong>The cheapest version is the one you did not have to create.</strong></p>
  </div>

  <h3>An analogy, and where it stops working</h3>

  <p>An API version is like a printed form. Once it is out in the world, people have copies, filing
  systems built around it, and staff trained on where the boxes are. Issuing a new form takes an afternoon;
  withdrawing the old one means finding everybody who has one.</p>

  <p><strong>This is an analogy and it misleads about who is holding the form.</strong> A form is held
  by a person you can write to. An API version is held by a process, running somewhere you may not know
  about, on behalf of somebody who may have left. That is the entire content of this module's incident:
  the withdrawal notice was correct, complete, and sent to the wrong kind of entity.</p>
</section>

<section id="schemes">
  <h2>Where the version goes</h2>

  <pre data-lang="console" data-title="01-three-schemes.cs output"><code>   scheme        the request                                       response
   ------        -----------                                       --------
   URL path      /v2/payments/PAY-1                                {...amountMinor...}
   query string  /payments/PAY-1?api-version=2                     {...amountMinor...}
   custom header /payments/PAY-1  + X-Api-Version: 2               {...amountMinor...}
   media type    /payments/PAY-1  + Accept: ...version=2           {...amountMinor...}</code></pre>

  <p class="define"><span class="define__term">Route group</span> A prefix applied to a set of
  endpoints, so <code>/v1</code> and <code>/v2</code> are two groups rather than a prefix repeated on
  every route. Filters and metadata applied to the group cover every endpoint in it, which is what makes
  a deprecation header impossible to forget.</p>

  <p class="define"><span class="define__term">Media type parameter</span> An extra term on a content
  type, after a semicolon — <code>application/vnd.ledger.payment+json; version=2</code>. It is the
  mechanism behind media-type versioning, and it means the version travels with the representation
  rather than with the address.</p>

  <p class="define"><span class="define__term">Vary</span> A response header naming which request
  headers the response depends on, so a shared cache knows two requests to the same URL are not
  interchangeable.</p>

  <p>All four reached the same handler. The version is a value the server has to find somewhere in the
  request, and every scheme is a different place to put it. That is worth saying plainly, because the
  argument about which is "correct" is long, mostly about REST as a philosophy, and does not affect what
  any of them can do.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Property</th><th>URL path</th><th>Query</th><th>Header</th><th>Media type</th></tr></thead>
      <tbody>
        <tr><td>Pasteable into a browser</td><td>yes</td><td>yes</td><td>no</td><td>no</td></tr>
        <tr><td>Visible in an access log</td><td>yes</td><td>yes</td><td>no</td><td>no</td></tr>
        <tr><td>Cached correctly by default</td><td>yes</td><td>yes</td><td>no</td><td>no</td></tr>
        <tr><td>Version per resource</td><td>no</td><td>no</td><td>no</td><td>yes</td></tr>
        <tr><td>One URL per resource</td><td>no</td><td>yes</td><td>yes</td><td>yes</td></tr>
        <tr><td>Obvious to a first-time caller</td><td>yes</td><td>partly</td><td>no</td><td>no</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Any header-based or media-type scheme puts two different responses behind one URL, so a shared
    cache will serve a v1 response to a v2 request unless you say otherwise:</p>
    <pre data-lang="csharp" data-net="10" data-title="01-three-schemes.cs — the line that is usually missing"><code>context.Response.Headers.Vary = "X-Api-Version, Accept";</code></pre>
    <p>It is one line, so this is not an argument against headers — but it is a correctness requirement
    the URL scheme gets for nothing.</p>
  </div>

  <p><strong>Use the URL path unless you have a specific reason not to.</strong> It is visible
  everywhere — in an access log, a support ticket, a browser address bar, a metrics dashboard grouped by
  route — and "how much traffic is still on v1" is a question you will ask repeatedly. It caches
  correctly without anybody thinking about it. And a developer can try it without reading anything,
  which matters more than it sounds, because the cost of an API is dominated by how many people
  integrate with it and how long each takes.</p>

  <p>The argument against is that a URL should identify a resource, and <code>/v1/payments/PAY-1</code>
  and <code>/v2/payments/PAY-1</code> are the same payment. That is correct, and it is a statement about
  REST rather than about anything that will happen to you.</p>

  <p>Choose otherwise for <strong>media type</strong> when different resources genuinely evolve at
  different rates, or for a <strong>header</strong> when a gateway or client framework already imposes
  one. Essentially never for a query string: it has the URL scheme's drawbacks and looks like a filter
  rather than a contract.</p>

  <p>And whatever you choose, <strong>pick one</strong>. An API that accepts three schemes has three
  code paths, three sets of tests, and a question about what happens when two of them disagree — which
  has no good answer and which somebody will eventually ask by accident.</p>

  <h3>The decision most teams make by accident</h3>

  <pre data-lang="console" data-title="01-three-schemes.cs output"><code>   policy                        response to GET /payments/PAY-1
   ------                        -------------------------------
   default to the latest         200  {"id":"PAY-1","amountMinor":50000,...}
   default to the oldest         200  {"id":"PAY-1","amount":500.00,...}
   reject the request            400  {"type":"...","title":"An api version is required"...}</code></pre>

  <p><strong>Defaulting to the latest is the most common and the worst.</strong> Every caller who forgot
  to specify a version is silently opted in to every future breaking change — so the day you ship v3,
  some client you have never heard of breaks, and the change that broke it was correct.</p>

  <p>Defaulting to the oldest is defensible and has one real cost: v1 never dies, because unversioned
  callers keep arriving and you cannot tell them apart from deliberate ones. Rejecting is the honest
  option, and the only one that makes the version part of the contract rather than a suggestion; its
  cost is paid once, at integration, by a developer reading a 400 that says exactly what to add.</p>

  <p>For a public API with unknown clients, reject. For an internal API where you own every caller,
  latest is fine, because you can grep for the callers before you break them.</p>
</section>

<section id="what-breaks">
  <h2>Which changes actually break a client</h2>

  <p class="define"><span class="define__term">Wire format</span> What actually travels: the JSON text,
  the status code, the headers. It is the only thing a client sees, which is why compatibility is a
  question about the wire rather than about your types.</p>

  <p class="define"><span class="define__term">Tolerant reader</span> A client that ignores what it does
  not recognise. It is the default behaviour of most JSON deserialisers and the assumption every
  "adding a field is safe" claim rests on.</p>

  <p>Nine changes to a response, read by a client compiled before any of them:</p>

  <pre data-lang="csharp" data-net="10" data-title="02-what-breaks.cs — the client's type"><code>public sealed record PaymentV1(string Id, long AmountMinor, string Currency);</code></pre>

  <pre data-lang="console" data-title="02-what-breaks.cs output"><code>   the change                            client sees               breaks
   ----------                            -----------               ------
   nothing changed                       PAY-1, 50000, 'GBP'       no
   a field added                         PAY-1, 50000, 'GBP'       no
   a field removed                       PAY-1, 50000, ''          YES
   a field renamed                       PAY-1, 0, 'GBP'           YES
   number outgrew the client's type      JsonException             YES
   number became a string                JsonException             YES
   scalar became an object               JsonException             YES
   a value became null                   PAY-1, 50000, ''          YES
   a new enum value                      PAY-1, 50000, 'JPY'       no</code></pre>

  <ul>
    <li><strong>Adding is safe.</strong> A field the client has never heard of is ignored by default,
    which is why "we added a field" is not a version.</li>
    <li><strong>Removing is silent and wrong.</strong> The field is absent, so the property takes its
    default — an empty string, or zero. Nothing throws, which makes it worse than the ones that do.</li>
    <li><strong>Renaming is a removal.</strong> It reads like one change and it is two.</li>
    <li><strong>Changing a type throws</strong>, which is the good outcome: the client fails loudly at
    the boundary rather than acting on a wrong value.</li>
  </ul>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a rename, shipped as a tidy-up"><code>// The pull request said "rename for consistency with the rest of the API".
// It is a removal and an addition, and every existing client now reads 0.
public sealed record Payment(
    string Id,
-   long AmountMinor,
+   long MinorAmount,
    string Currency);</code></pre>

  <p>Read the "a field removed" row again, because it is the dangerous one. The client received a
  payment with a currency of empty string and no error anywhere. Whatever it does next — display it,
  store it, compare it — it does with a value nobody sent.</p>

  <p>And the enum row is the one people forget: adding a currency is additive on the server and a new
  value the client's <code>switch</code> has never seen. Whether that breaks depends entirely on how the
  client was written, which means you cannot know.</p>

</section>

<section id="request-changes">
  <h2>The direction that makes it simple</h2>

  <pre data-lang="console" data-title="02-what-breaks.cs output"><code>   the server change                     result
   -----------------                     ------
   a new OPTIONAL field                  accepted: PAY-1 50000 reason=(none)
   a new REQUIRED field                  REJECTED: JsonException
   a field the server dropped            accepted: PAY-1 (amount no longer read)
   tighter validation                    accepted: PAY-1 50000 (within the new limit)</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - additive on the server, breaking for the client"><code>public sealed record RefundRequest(string PaymentId, long AmountMinor)
{
    // Added in the name of better data quality. Every existing caller now
    // gets a 400, because they cannot send a field they have never heard of.
    public required string Reason { get; init; }
}</code></pre>

  <p>Adding a field to a request feels like the same kind of change as adding one to a response, and it
  is the opposite. Say it as a direction and it stops being confusing: <strong>you may always give more,
  and never demand more.</strong></p>

  <p>Tightening validation is the same mistake wearing a different hat — a new maximum, a stricter
  pattern, a shorter length each reject requests that were valid yesterday. The last row above passes
  only because the value happens to satisfy the new rule, and that is the trap: tightened validation
  breaks <em>some</em> callers, so it passes your tests and fails in production for whoever was near the
  boundary.</p>

  <h3>The client that made the safe change unsafe</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - opts out of forward compatibility"><code>var options = new JsonSerializerOptions
{
    // Every future additive change to the API is now an outage on this side.
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
};</code></pre>

  <pre data-lang="console" data-title="02-what-breaks.cs output"><code>   client configuration                  a field is added to the response
   --------------------                  --------------------------------
   default (unknown fields ignored)      accepted: PAY-1, 50000, 'GBP'
   UnmappedMemberHandling.Disallow       REJECTED: JsonException</code></pre>

  <p>The additive change broke a client, and nothing about the server was wrong. As a client author, do
  not do this against an API you do not own — additive changes are the ones nobody announces. As an API
  author, know that some caller has done it anyway: it does not make adding a field wrong, but it makes
  "we announce additive changes too" a cheap kindness.</p>

  <p><strong>A compatibility guarantee is a promise about what you send, and whether it holds depends on
  how the other side reads it.</strong></p>

  <h3>The list worth memorising</h3>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Safe — no version needed</th><th>Breaking — needs a version</th></tr></thead>
      <tbody>
        <tr><td>Adding a field to a response</td><td>Removing or renaming a response field</td></tr>
        <tr><td>Adding an <em>optional</em> request field</td>
            <td>Changing a field's type, including number to string</td></tr>
        <tr><td>Adding a new endpoint</td><td>Changing units, or the meaning of a value</td></tr>
        <tr><td>Relaxing validation</td><td>Adding a <em>required</em> request field</td></tr>
        <tr><td>Making a required request field optional</td><td>Tightening validation</td></tr>
        <tr><td>Adding a value the client treats as opaque</td>
            <td>Changing a status code for an existing condition</td></tr>
        <tr><td></td><td>Changing the default of an omitted parameter</td></tr>
      </tbody>
    </table>
  </div>

  <p>Two rows in that second column are not about the payload at all, and they are the ones most often
  missed. <strong>A status code is part of the contract</strong>: changing a 404 to a 200 with an empty
  body is invisible in any schema and breaks every client that branches on it — and clients branch on
  status codes far more reliably than on bodies. <strong>A default is part of the contract</strong>: if
  page size defaults to 20 and you change it to 50, every caller who omitted it gets different results
  from an identical request.</p>

  <p>The test to apply is more reliable than the list: <strong>could a client that worked yesterday,
  unchanged, behave differently today?</strong> If yes, it is breaking — whatever the change is called
  and however clearly correct it is.</p>
</section>

<section id="retiring">
  <h2>Retiring a version</h2>

  <p class="define"><span class="define__term">Brown-out</span> Deliberately failing a deprecated
  version for a short, announced period, then restoring it — so that callers who have not migrated
  discover it while somebody is watching and the change is reversible.</p>

  <p class="define"><span class="define__term">410 Gone</span> The status for something that existed and
  was deliberately removed, as distinct from 404, which says only that nothing is there now.</p>

  <p>The incident's cause was not the removal but the absence of one number. The whole fix is eight
  lines of middleware:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>app.Use(async (context, next) =&gt;
{
    await next(context);

    string version = context.Request.Path.StartsWithSegments("/v1") ? "v1"
        : context.Request.Path.StartsWithSegments("/v2") ? "v2"
        : "none";

    string client = context.Request.Headers["X-Client-Id"].ToString() is { Length: &gt; 0 } id
        ? id
        : "(unidentified)";

    counts.AddOrUpdate($"{version} {client}", 1, (_, existing) =&gt; existing + 1);
});</code></pre>

  <pre data-lang="console" data-title="03-production.cs output"><code>   version and caller                     requests
   ------------------                     --------
   v1 (unidentified)                             4
   v1 acme-corp                                  4
   v1 initech-mobile                             2
   v2 acme-corp                                 40</code></pre>

  <p>With that table, the retirement decision stops being a date and becomes a condition: v1 is removed
  when v1 traffic is zero, or when what remains is understood and accepted.</p>

  <p>Note the <code>(unidentified)</code> rows. They are the callers the emails could never have
  reached, and they are visible here as a number even though nobody knows who they are. That distinction
  is what makes the metric useful rather than merely interesting: "v1 traffic is falling" is comforting
  and says nothing; "v1 traffic is 10,000 a day and 4,000 of it is from callers we cannot contact" is a
  decision.</p>

  <h3>Telling the client, in a way a machine can read</h3>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs — one filter on the whole group"><code>v1.AddEndpointFilter(async (context, next) =&gt;
{
    object? result = await next(context);

    HttpResponse response = context.HttpContext.Response;

    // RFC 8594: when this version stops working.
    response.Headers["Sunset"] = "Wed, 01 Jul 2026 00:00:00 GMT";

    // RFC 9745: that it is deprecated, and since when.
    response.Headers["Deprecation"] = "Wed, 01 Jan 2026 00:00:00 GMT";

    // RFC 8288: where to read about the replacement.
    response.Headers["Link"] =
        "&lt;https://docs.ledger.example/v2/migration&gt;; rel=\"deprecation\"; type=\"text/html\", " +
        "&lt;https://api.ledger.example/v2/payments&gt;; rel=\"successor-version\"";

    return result;
});</code></pre>

  <pre data-lang="console" data-title="03-production.cs output"><code>   GET /v1/payments/PAY-1   200

     Sunset: Wed, 01 Jul 2026 00:00:00 GMT
     Deprecation: Wed, 01 Jan 2026 00:00:00 GMT
     Link: &lt;https://docs.ledger.example/v2/migration&gt;; rel="deprecation"; ...

   GET /v2/payments/PAY-1   200, no Sunset header</code></pre>

  <p>Three standard headers, and not one of them changes the response. A client that ignores them is
  unaffected; one that reads them can log a warning, fail a build, or raise a ticket — automatically,
  without anybody reading an email.</p>

  <p>Be honest about what this buys: most clients do not read them, so it is not a substitute for the
  telemetry. It is the half of the job that scales to callers you have never heard of, and it costs one
  filter on one route group. <strong>Add it on the day you ship the replacement</strong>, not on the day
  you plan the removal — the value of a Sunset date six months out is that it appears in somebody's logs
  six months out.</p>

  <h3>The procedure</h3>

  <ol>
    <li><strong>Count traffic per version and per caller</strong>, from the day the new version ships —
    you need the trend, and you need to know which callers exist.</li>
    <li><strong>Send Sunset and Deprecation headers</strong> on every old-version response, from the
    same day.</li>
    <li><strong>Contact the callers the telemetry identifies</strong>, not the account list — those are
    different sets, and the difference is the whole incident.</li>
    <li><strong>Brown out before you turn off.</strong> Return 410 for a few hours on an announced day,
    then restore. Anybody still calling finds out while you are watching and while it is reversible.</li>
    <li><strong>Retire on a condition, not a date</strong>: when traffic is zero, or when what remains
    is understood and somebody has accepted breaking it.</li>
  </ol>

  <p>Return <strong>410 Gone, not 404</strong>. A 404 says the path does not exist and invites a search
  for a typo; 410 says it existed and was removed, and with a body pointing at the migration guide the
  person debugging has everything they need in the response.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>A public API version may never fully die. Some callers will not migrate, ever, and at some point
    the decision is to break them deliberately rather than to keep waiting.</p>
    <p>That decision is legitimate. What makes it a decision rather than an accident is knowing the
    number, knowing who, and choosing the day.</p>
  </div>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>An API that can evolve: two versions, an additive change that needed neither, telemetry that says
  who is on what, and a retirement path that is rehearsable.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>
var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseStatusCodePages();

// ---------------------------------------------------------------------------
// TELEMETRY FIRST, because every decision about retiring a version depends on
// it and it has to have been running for months by then.
app.Use(async (context, next) =&gt;
{
    await next(context);

    string version = context.Request.Path.StartsWithSegments("/v1") ? "v1"
        : context.Request.Path.StartsWithSegments("/v2") ? "v2"
        : "unversioned";

    string client = context.Request.Headers["X-Client-Id"].ToString() is { Length: &gt; 0 } id
        ? id
        : "(unidentified)";

    usage.AddOrUpdate($"{version,-12} {client}", 1, (_, count) =&gt; count + 1);
});

// ---------------------------------------------------------------------------
// v1: deprecated, still working, and saying so in a way a machine can read.
RouteGroupBuilder v1 = app.MapGroup("/v1");

v1.AddEndpointFilter(async (context, next) =&gt;
{
    HttpResponse response = context.HttpContext.Response;

    response.Headers["Deprecation"] = "Wed, 01 Jan 2026 00:00:00 GMT";
    response.Headers["Sunset"] = "Wed, 01 Jul 2026 00:00:00 GMT";
    response.Headers["Link"] =
        "&lt;https://docs.ledger.example/v2/migration&gt;; rel=\"deprecation\"; type=\"text/html\"";

    if (stage != Stage.Deprecated)
    {
        return Results.Problem(
            title: "This API version has been retired",
            detail: "Use /v2/payments. See https://docs.ledger.example/v2/migration",
            statusCode: 410);
    }

    return await next(context);
});

v1.MapGet("/payments/{id}", (string id) =&gt; Results.Ok(new
{
    id,
    amount = 500.00m,
    currency = "GBP"
}));

// ---------------------------------------------------------------------------
// v2: the current version. The breaking change - amount in minor units - is the
// only reason this version exists.
RouteGroupBuilder v2 = app.MapGroup("/v2");

v2.MapGet("/payments/{id}", (string id) =&gt; Results.Ok(new
{
    id,
    amountMinor = 50_000L,
    currency = "GBP",
    // ADDITIVE, and shipped into v2 without a v3. A client that has never
    // heard of this field ignores it.
    status = "captured",
    settledAt = "2026-01-15T09:14:00Z"
}));

// An unversioned request is rejected rather than guessed at.
app.MapGet("/payments/{id}", (string id) =&gt; Results.Problem(
    title: "An api version is required",</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>1. Two versions, and an additive change that needed neither

   /v1/payments/PAY-1      acme-corp         200
     {"id":"PAY-1","amount":500.00,"currency":"GBP"}
     Sunset: Wed, 01 Jul 2026 00:00:00 GMT

   /v2/payments/PAY-1      acme-corp         200
     {"id":"PAY-1","amountMinor":50000,"currency":"GBP","status":"captured",...}

   /payments/PAY-1         (no client id)    400
     {"type":"...","title":"An api version is required"...}

2. Who is on what

   version      client                requests
   -------      ------                --------
   unversioned  (unidentified)              1
   v1           acme-corp                   1
   v2           (unidentified)              1
   v2           acme-corp                   1

3. The retirement, rehearsed

   stage                     GET /v1   Sunset   what the caller is told
   -----                     -------   ------   -----------------------
   deprecated, working           200   yes      the payment, plus a Sunset date
   brown-out, two hours          410   yes      retired, and where to go instead
   retired                       410   yes      retired, and where to go instead</code></pre>

  <p>The v2 response gained two fields and stayed v2, because adding to a response is safe — "we added
  <code>settledAt</code>" is a release note rather than a version.</p>

  <p><strong>The brown-out and the retirement are the same code path</strong>, differing by one flag.
  That is what makes the rehearsal worth doing: it exercises exactly what the real thing will do, two
  hours at a time, while it is still reversible.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Almost none of the checklist above is about versioning. It is about the two facts that make
    versioning expensive.</p>
    <p><strong>You do not know who calls you.</strong> Announcements go to people and requests come from
    processes, with no reliable mapping between them — which is why the telemetry and the Sunset header
    both exist, reaching different halves of the same problem. In the incident, 40% of the remaining v1
    traffic came from callers no email could have reached.</p>
    <p><strong>Creating a version is an afternoon and removing one is a project with other people's
    calendars in it.</strong> That asymmetry is why the whole module points at the same conclusion:
    before adding v3, check whether the change can be additive — a new field alongside the old one,
    populated in both, the old one documented as deprecated and removed when the telemetry says nobody
    reads it. A redundant field for two years is cheaper than a version by an enormous margin, and the
    margin is measured in other teams' time rather than yours.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Retiring on a date instead of a condition</h3>

  <p>The incident. Every step of a well-run plan was completed, and a fifth of all traffic broke,
  because the plan reasoned about registered accounts and the traffic came from processes.</p>

  <h3>Versioning for an additive change</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a whole version for a new field"><code>// v2 exists only because a field was added, which no client would have
// noticed. Every caller now has to migrate for nothing.
v2.MapGet("/payments/{id}", (string id) =&gt; Results.Ok(new
{
    id,
    amount = 500.00m,
    currency = "GBP",
    settledAt = "2026-01-15T09:14:00Z"
}));</code></pre>

  <p>Measured above: a client that has never heard of a field ignores it. This is the change people
  version for most often and need to least.</p>

  <h3>Versioning the whole API for one resource</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   /v1/refunds/REF-1        {"id":"REF-1","state":"pending"}
   /v2/refunds/REF-1        {"id":"REF-1","state":"pending"}
   /refunds/REF-1           {"id":"REF-1","state":"pending"}</code></pre>

  <p>Identical responses, and every client has to migrate to a v2 that differs from v1 only in payments.
  A breaking change to one resource makes work for every client of every resource, and the work is
  pointless for most of them.</p>

  <h3>Changing something no schema describes</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   the client                                before              after
   ----------                                ------              -----
   branches on 404                           shows 'not found'  shows the payment
   expects one page to be &lt;= 20 rows         20                 100</code></pre>

  <p>Neither appears in an OpenAPI diff or a payload test. The first shows a payment screen with empty
  fields instead of "not found" — a worse failure than an error, because it looks like data.</p>

  <h3>Defaulting an unversioned request to the latest</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - opts every forgetful caller into the next break"><code>app.MapGet("/payments/{id}", (string id, HttpContext context) =&gt;
{
    int version = ReadVersion(context.Request) ?? LatestVersion;

    return Results.Ok(Render(id, version));
});</code></pre>

  <h3>Adding a version because a field was added</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - two contracts, no breaking change"><code>// v3 exists because somebody added settledAt to the response and assumed
// that was breaking. Measured: a client that has never heard of the field
// ignores it. This version costs every caller a migration for nothing.
RouteGroupBuilder v3 = app.MapGroup("/v3");

v3.MapGet("/payments/{id}", (string id) =&gt; Results.Ok(new
{
    id,
    amountMinor = 50_000L,
    currency = "GBP",
    settledAt = "2026-01-15T09:14:00Z"
}));</code></pre>

  <h3>Retiring with 404</h3>

  <p>A 404 says the path does not exist and sends whoever is debugging to look for a typo. 410 with a
  body says it existed, was removed, and where to go instead — which is the difference between a
  support ticket and a self-service fix.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Likely cause</th><th>Check</th></tr></thead>
      <tbody>
        <tr><td>A client reports wrong values, no errors</td>
            <td>A field was removed or renamed; the client is reading a default</td>
            <td>Diff the response against the version the client was built for</td></tr>
        <tr><td>A client reports 400s after a release</td>
            <td>A required request field added, or validation tightened</td>
            <td>Whether an old-shaped request still succeeds</td></tr>
        <tr><td>A client broke after an additive change</td>
            <td>Strict deserialisation on the client</td>
            <td>Whether they reject unknown fields</td></tr>
        <tr><td>Traffic to a retired version after removal</td>
            <td>Callers who were never on the account list</td>
            <td>Per-version, per-caller counts — before removing, not after</td></tr>
        <tr><td>A cache serves the wrong version</td>
            <td>Header or media-type versioning without <code>Vary</code></td>
            <td>Whether the response carries a <code>Vary</code> header</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>For "did this change break anybody", the test is not a schema diff — it is the old client against
    the new response. That is cheap to write and catches the silent cases a schema tool cannot see:</p>
    <pre data-lang="csharp" data-net="10" data-title="02-what-breaks.cs"><code>// The type the client was compiled with, kept in the test project on purpose.
public sealed record PaymentV1(string Id, long AmountMinor, string Currency);

// The assertion that matters: not that it deserialises, but that no field the
// client needs came back as a default the server never sent.
PaymentV1 payment = JsonSerializer.Deserialize&lt;PaymentV1&gt;(newResponse, options)!;

Assert.NotEqual(0, payment.AmountMinor);
Assert.False(string.IsNullOrEmpty(payment.Currency));</code></pre>
    <p>Deserialising successfully proves nothing — the removed-field row above deserialised fine and
    produced an empty currency. The assertion has to be that the values arrived, not that the parse
    succeeded.</p>
    <p>And for retirement, the only diagnostic that matters is the per-version, per-caller count, which
    has to have been running for months by the time you need it. It cannot be added retrospectively,
    which is why it goes in on the day the new version ships.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Adding a field is a breaking change, so it needs a new version."</strong></p>
    <p>Measured false for responses: an unknown field is ignored by default. It is true for a
    <em>required</em> request field, which is the opposite direction and the source of the confusion.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"If the schema did not change, nothing broke."</strong></p>
    <p>Status codes, defaults for omitted parameters, ordering and pagination limits are all part of the
    contract and appear in no schema. Two of the measured breaking changes in this module are invisible
    to any OpenAPI diff.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"We announced the retirement six months ago."</strong></p>
    <p>Announcements reach people; requests come from processes. In the incident 40% of the remaining v1
    traffic came from callers who were never on the list, and no amount of notice would have reached
    them.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Media-type versioning is the correct way, so we should use it."</strong></p>
    <p>It is more expressive and it earns its place in an API with many resources evolving at different
    rates. Everywhere else it costs a support conversation that starts with "what Accept header did you
    send" in exchange for a philosophical improvement.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Deserialising the new response in the old client proves compatibility."</strong></p>
    <p>The removed-field case deserialises successfully and produces an empty currency. The assertion
    has to be that the values arrived, not that the parse succeeded.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Once v2 ships, v1 is somebody else's problem."</strong></p>
    <p>Creating a version is an afternoon; removing one is a project with other people's calendars in
    it. The retirement is the expensive half, and it is the half nobody plans for.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The incident cost a partial payment outage — 10,000 requests a day, 20% of all traffic — from a
    retirement that had six months of notice and three rounds of emails. Nothing was rushed and nobody
    was careless.</p>
    <p>The fix that would have prevented it is eight lines of middleware, and its value comes entirely
    from having been running since January. It cannot be added on the day you need it, which is the
    argument for adding it on the day the new version ships.</p>
    <p>The larger cost is the one that never appears in an incident report. Every unnecessary version
    doubles the surface of an API for as long as it lives: two shapes to document, two paths through
    every test, and a migration that every client of every resource has to fund whether or not the
    change affected them. Most of those versions existed because somebody added a field and assumed it
    was breaking — measured here, in nine changes, as one of the safest things you can do.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>For each change, does a client compiled against the old contract keep working?</p>
    <ol type="a">
      <li>the response gains a <code>settledAt</code> field;</li>
      <li>the response's <code>amount</code> is renamed to <code>amountMinor</code>;</li>
      <li>the request gains an optional <code>reference</code> field;</li>
      <li>that <code>reference</code> field becomes required.</li>
    </ol>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   change                            old client                needs a version
   ------                            ----------                ---------------
   a. a field added                  PAY-1, amount 50000       no
   b. a field renamed                PAY-1, amount 0           YES
   c. optional field added           accepted                  no
   d. that field made required       REJECTED: JsonException   YES</code></pre>
        <p>(a) and (c) are safe; (b) and (d) are breaking.</p>
        <p>A new response field is ignored by a client that has never heard of it — this is the change
        people version for most often and need to least.</p>
        <p>A rename is a removal and an addition. Note the outcome column: it did not throw. It read an
        amount of 0 and carried on, which is worse than an exception.</p>
        <p>An optional request field costs the old client nothing, because it does not send it. A
        required one is breaking, and it is the row that catches people, because on the server it looks
        exactly as additive as (a). The direction is what matters: <strong>you may always give more, and
        never demand more.</strong></p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A team changes two things and versions neither, because the payload did not change: a missing
    payment now returns 200 with an empty body instead of 404, and the default page size changes from 20
    to 100.</p>
    <p>Are these breaking? Show what an existing client does.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   the client                                before              after
   ----------                                ------              -----
   branches on 404                           shows 'not found'  shows the payment
   expects one page to be &lt;= 20 rows         20                 100</code></pre>
        <p>Both are breaking, and neither appears in any schema, OpenAPI diff, or test that checks the
        shape of a payload.</p>
        <p><strong>The status code is part of the contract.</strong> The client now shows a payment
        screen with empty fields instead of "not found" — a worse failure than an error, because it looks
        like data. Clients branch on status codes more reliably than on bodies, because the status is the
        one part of an HTTP response every library surfaces the same way.</p>
        <p><strong>The default is part of the contract.</strong> A client that omitted the page size and
        sized a buffer, a screen or a rate limit around 20 rows now gets 100. The request did not change;
        the response did.</p>
        <p>The test that catches both, and every case like them: <em>could a client that worked
        yesterday, unchanged, behave differently today?</em> That question covers status codes, defaults,
        ordering, timing, pagination limits and error messages — none of which a schema describes.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium</span></div>
    <p><code>/payments</code> needs a breaking change. <code>/refunds</code>, <code>/invoices</code> and
    <code>/payouts</code> do not. With URL versioning, what happens to the other three — and what are the
    two ways to avoid it?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   /v1/refunds/REF-1        {"id":"REF-1","state":"pending"}
   /v2/refunds/REF-1        {"id":"REF-1","state":"pending"}
   /refunds/REF-1           {"id":"REF-1","state":"pending"}</code></pre>
        <p><code>/v1/refunds</code> and <code>/v2/refunds</code> return identical responses, and every
        client has to migrate to a v2 that is the same as v1 for everything except payments. That is the
        real cost of whole-API versioning: a breaking change to one resource makes work for every client
        of every resource, and the work is pointless for most of them.</p>
        <p><strong>Version the resource, not the API.</strong> <code>/v2/payments</code> alongside
        <code>/v1/payments</code>, with <code>/refunds</code> left where it is. The cost is that "what
        version is this API" stops having an answer, and every document and support conversation has to
        be about a specific resource.</p>
        <p><strong>Or use media-type versioning</strong>, where the version belongs to the representation
        — <code>/payments</code> at version 3 while <code>/refunds</code> is at version 1, with one URL
        each. This is the case media types are genuinely for, and it is the only one.</p>
        <p>And the third answer, which is usually the right one: <strong>do not make the breaking
        change.</strong> Add <code>amountMinor</code> next to <code>amount</code>, populate both, document
        the old one as deprecated, and remove it in two years when the telemetry says nobody reads it. A
        redundant field is cheaper than a version by an enormous margin.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>v1 has been deprecated for six months. Design the retirement so that no caller is broken without
    somebody having decided to break it.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs — one filter, one flag"><code>v1.AddEndpointFilter(async (context, next) =&gt;
{
    HttpResponse response = context.HttpContext.Response;

    response.Headers["Sunset"] = "Wed, 01 Jul 2026 00:00:00 GMT";
    response.Headers["Deprecation"] = "Wed, 01 Jan 2026 00:00:00 GMT";
    response.Headers["Link"] =
        "&lt;https://docs.ledger.example/v2/migration&gt;; rel=\"deprecation\"";

    // The brown-out and the retirement are the same code path with a
    // different flag, which is what makes the rehearsal honest.
    if (stage != Stage.Live)
    {
        return Results.Problem(
            title: "This API version has been retired",
            detail: "Use /v2/payments. See https://docs.ledger.example/v2/migration",
            statusCode: 410);
    }

    return await next(context);
});</code></pre>
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   stage                     GET /v1/...   Sunset sent   body
   -----                     -----------   -----------   ----
   deprecated but working            200   yes           {"id":"PAY-1","amount":500.00}
   brown-out, two hours              410   yes           {"type":"...15.5.11","title":"This API...
   retired                           410   yes           {"type":"...15.5.11","title":"This API...</code></pre>
        <ol>
          <li><strong>Count per version and per caller</strong>, from the day v2 shipped. Without this
          every later step is guesswork.</li>
          <li><strong>Send Sunset, Deprecation and Link</strong> on every v1 response, also from that
          day. A machine-readable warning reaches callers no email can.</li>
          <li><strong>Contact the callers the telemetry identifies</strong> — not the account list, which
          is a different set.</li>
          <li><strong>Brown out.</strong> Return 410 for two hours on an announced day, then restore.
          The brown-out and the retirement are the same code path with a different flag, so the rehearsal
          tests what the real thing will do — and anybody still calling discovers it while you are
          watching and while it is reversible.</li>
          <li><strong>Retire on a condition, not a date.</strong></li>
        </ol>
        <p>410 rather than 404, and with a body: 404 says the path does not exist and invites a search
        for a typo; 410 says it existed and was removed, and the detail tells whoever is debugging exactly
        where to go.</p>
        <p>The deeper point is that retirement is the expensive half of versioning and the half nobody
        plans for. Creating v2 is an afternoon; removing v1 is a project with other people's calendars in
        it — which is the reason the cheapest version is the one you did not create.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is the one-sentence test for whether a change is breaking?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Could a client that worked yesterday, unchanged, behave differently
        today? If yes it is breaking, whatever the change is called.</p></div>
      </details></li>

    <li><p>Why is adding a field to a response safe, and adding a required field to a request not?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A client ignores fields it has never heard of, but it cannot send
        one. You may always give more, and never demand more.</p></div>
      </details></li>

    <li><p>Which versioning scheme should you use by default, and why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The URL path: visible in every access log and dashboard, cached
        correctly without a <code>Vary</code> header, and usable by a developer who has read
        nothing.</p></div>
      </details></li>

    <li><p>What should happen when a request specifies no version?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>For a public API, reject it with a message naming the options.
        Defaulting to the latest opts every forgetful caller into the next breaking change; defaulting to
        the oldest keeps the oldest alive forever.</p></div>
      </details></li>

    <li><p>Name two breaking changes that no schema describes.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Changing a status code for an existing condition, and changing the
        default value of an omitted parameter. Ordering, pagination limits and timing belong on the same
        list.</p></div>
      </details></li>

    <li><p>Why did six months of notice and three emails fail to prevent the incident?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The announcements went to registered accounts, and 40% of the
        remaining v1 traffic came from processes with no account behind them — a batch job, an
        unregistered internal team, an agency-built integration.</p></div>
      </details></li>

    <li><p>What do the Sunset and Deprecation headers do, and what do they not do?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>They tell a machine when a version stops working and that it is
        deprecated, so a client can warn or fail a build automatically. They do not change the response,
        and most clients ignore them — so they supplement per-caller telemetry rather than replacing
        it.</p></div>
      </details></li>

    <li><p>Why retire with 410 rather than 404?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>404 says the path does not exist and sends the caller looking for a
        typo. 410 says it existed and was removed, and with a body naming the replacement it turns a
        support ticket into a self-service fix.</p></div>
      </details></li>
  </ol>
</section>
`
});
