CSPREP.module({
  id: "t3-13-options-pattern",
  minutes: 55,
  updated: "2026-09-04",
  summary: "A kill switch that could not be switched: the class took IOptionsMonitor for the right reason and assigned CurrentValue to a field in its constructor, so the configuration changed, the monitor noticed, and the class did not. The three options interfaces measured against a file that changes, why IOptionsSnapshot cannot live in a singleton, and the measured finding that ValidateDataAnnotations without ValidateOnStart is a check that runs on a customer's request.",
  terms: ["options pattern", "options class", "IOptions", "IOptionsSnapshot", "IOptionsMonitor",
    "CurrentValue", "OnChange", "named options", "AddOptions", "Bind", "ValidateDataAnnotations",
    "ValidateOnStart", "IValidateOptions", "OptionsValidationException", "Options.Create"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger's new settlement path is behind a flag so it can be turned off without a deployment. That
  is the whole reason the flag exists, and it was tested: flip the value, watch the behaviour change.</p>

  <p>The class reads it the way the documentation says to, through <code>IOptionsMonitor</code>, because
  it is a singleton and needs to see changes:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - and it takes the right interface"><code>public sealed class SettlementRouter
{
    private readonly FeatureOptions _features;

    public SettlementRouter(IOptionsMonitor&lt;FeatureOptions&gt; monitor)
    {
        _features = monitor.CurrentValue;
    }

    public string Route() =&gt; _features.NewSettlement ? "new" : "old";
}</code></pre>

  <p>At 02:40 the new path starts failing. The on-call engineer sets the flag to false, confirms the
  change landed, and watches the failures continue.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   flag true, requests route to    new
   flag set to false, requests to  new
   change callbacks the monitor fired  0</code></pre>

  <p><strong>The configuration changed. The monitor noticed. The class did not.</strong></p>

  <p>One line explains all of it. <code>CurrentValue</code> is a property that reads the value
  <em>now</em>; assigning it to a field copies that value once, in the constructor, and the field never
  changes again. The monitor is still watching, and nothing is listening.</p>

  <p>The class takes the right interface, for the right reason, and uses it in a way that makes it
  exactly equivalent to <code>IOptions</code> — while reading, at every glance, as though it does not.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every value, startup outcome and validation message in this module was produced by running the
    programs shown, on .NET 10, and pasted in unedited.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What the options pattern is</h2>

  <p class="define"><span class="define__term">Options class</span> A plain class with settable
  properties, holding one section's settings. No base class, no attributes required — an ordinary type
  you can construct with <code>new</code>.</p>

  <p class="define"><span class="define__term">The options pattern</span> Binding a configuration
  section to such a class once, registering it, and injecting it into whatever needs those values — so
  no class other than the composition root ever sees <code>IConfiguration</code> or a key name.</p>

  <p class="define"><span class="define__term">Feature flag</span> A setting that switches a piece of
  behaviour on or off without changing code. A <strong>kill switch</strong> is one whose purpose is to
  turn something off during an incident, which means its value has to be readable again after the
  process has started.</p>

  <p class="define"><span class="define__term">Shared mutable state</span> A value more than one thread
  can read while one can write it. Every field on a singleton is this, which is why an options object
  held by one must be replaced whole rather than edited in place.</p>

  <p class="define"><span class="define__term">IOptions&lt;T&gt;</span> A wrapper with one property,
  <code>Value</code>, which is the bound object. The wrapper exists so the container can hand something
  over before the value is needed.</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — One section, one class, one registration, and a service that
// has never heard of configuration.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every value here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

builder.Configuration.AddInMemoryCollection(new Dictionary&lt;string, string?&gt;
{
    ["Gateway:BaseUrl"] = "https://gw.internal:8443",
    ["Gateway:TimeoutSeconds"] = "5",
    ["Gateway:MaxAttempts"] = "3"
});

// The whole registration. Bind the Gateway section to GatewayOptions, and make
// it available as IOptions&lt;GatewayOptions&gt;.
builder.Services.AddOptions&lt;GatewayOptions&gt;()
    .Bind(builder.Configuration.GetSection("Gateway"));

builder.Services.AddSingleton&lt;PaymentGateway&gt;();

var app = builder.Build();

app.MapGet("/capture/{id}", (string id, PaymentGateway gateway) =&gt;
    Results.Ok(new { result = gateway.Capture(id) }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("The options pattern in one file");
Console.WriteLine();
Console.WriteLine($"   GET /capture/PAY-1   {await http.GetStringAsync("/capture/PAY-1")}");
Console.WriteLine();

await app.StopAsync();

Console.WriteLine("   WHAT CHANGED FROM READING CONFIGURATION DIRECTLY:");
Console.WriteLine();
Console.WriteLine("     - the key names appear ONCE, in the Bind call, instead of at every");
Console.WriteLine("       place that reads a value;");
Console.WriteLine();
Console.WriteLine("     - PaymentGateway takes IOptions&lt;GatewayOptions&gt; and has no idea");
Console.WriteLine("       configuration exists - no IConfiguration, no strings, no keys;");
Console.WriteLine();
Console.WriteLine("     - the types are declared in one class, so the shape of the settings is");
Console.WriteLine("       something you can read rather than something you infer from usage.");
Console.WriteLine();

// And the same class, constructed by hand, with no configuration anywhere.
var direct = new PaymentGateway(Options.Create(new GatewayOptions
{
    BaseUrl = "https://localhost:9443",
    TimeoutSeconds = 1,
    MaxAttempts = 1
}));

Console.WriteLine($"   the same class in a test   {direct.Capture("PAY-1")}");
Console.WriteLine();
Console.WriteLine("   Options.Create wraps a plain object in IOptions, so a test supplies");
Console.WriteLine("   settings the same way it supplies any other dependency. THAT is the");
Console.WriteLine("   payoff, and it is the same one as the dependency injection module:");
Console.WriteLine("   the class states what it needs and something else decides what to give");
Console.WriteLine("   it.");
Console.WriteLine();
Console.WriteLine("   IOptions&lt;T&gt; IS A WRAPPER AROUND ONE PROPERTY. Reading .Value gives you");
Console.WriteLine("   the bound object. The wrapper exists so that the container can hand you");
Console.WriteLine("   something before the value is needed - and, as the next file shows,");
Console.WriteLine("   because there are three of these interfaces and they differ in when");
Console.WriteLine("   that value is read.");

// ---------------------------------------------------------------------------
public sealed class GatewayOptions
{
    public string BaseUrl { get; set; } = "";

    public int TimeoutSeconds { get; set; } = 30;

    public int MaxAttempts { get; set; } = 1;
}

// Takes settings, not configuration. Constructible with new.
public sealed class PaymentGateway(IOptions&lt;GatewayOptions&gt; options)
{
    private readonly GatewayOptions _options = options.Value;

    public string Capture(string paymentId) =&gt;
        $"POST {_options.BaseUrl}/capture/{paymentId} " +
        $"(timeout {_options.TimeoutSeconds}s, up to {_options.MaxAttempts} attempts)";
}</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   GET /capture/PAY-1   {"result":"POST https://gw.internal:8443/capture/PAY-1
                         (timeout 5s, up to 3 attempts)"}

   the same class in a test   POST https://localhost:9443/capture/PAY-1
                              (timeout 1s, up to 1 attempts)</code></pre>

  <p>Three things changed from reading configuration directly. The key names appear <strong>once</strong>,
  in the <code>Bind</code> call, rather than at every place that reads a value. <code>PaymentGateway</code>
  takes <code>IOptions&lt;GatewayOptions&gt;</code> and has no idea configuration exists. And the types
  are declared in one class, so the shape of the settings is something you can read rather than infer
  from usage.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - what the options pattern replaces"><code>public sealed class PaymentGateway(IConfiguration configuration)
{
    public string Describe(string paymentId)
    {
        // Three key names in one method, none of them checked by anything, and
        // a class that cannot be constructed in a test without configuration.
        string baseUrl = configuration["Gateway:BaseUrl"]!;
        int timeout = configuration.GetValue&lt;int&gt;("Gateway:TimeoutSeconds");
        int attempts = configuration.GetValue&lt;int&gt;("Gateway:MaxAttempts");

        return $"POST {baseUrl}/capture/{paymentId} (timeout {timeout}s, up to {attempts} attempts)";
    }
}</code></pre>

  <p><code>Options.Create</code> wraps a plain object in <code>IOptions</code>, so a test supplies
  settings the same way it supplies any other dependency. That is the same payoff as the dependency
  injection module: the class states what it needs, and something else decides what to give it.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>Options are like the printed settings card taped inside a machine: the machine reads it once when
  it is switched on, and behaves accordingly. Changing the card does nothing to a machine that is
  already running.</p>

  <p><strong>This is an analogy and it misleads about one of the three interfaces.</strong> Two of them
  behave exactly like that card. The third does not — it is a card the machine re-reads on every
  operation — and the whole of this module's incident is a machine that took the re-readable card and
  photographed it once.</p>
</section>

<section id="three-interfaces">
  <h2>The three interfaces</h2>

  <p class="define"><span class="define__term">IOptionsSnapshot&lt;T&gt;</span> A scoped service whose
  value is read once per scope — so, in a web application, once per request.</p>

  <p class="define"><span class="define__term">IOptionsMonitor&lt;T&gt;</span> A singleton exposing
  <code>CurrentValue</code>, read fresh on every access, plus an <code>OnChange</code> callback when the
  underlying configuration changes.</p>

  <p class="define"><span class="define__term">Snapshot</span> Here, the value as it was at one moment,
  kept for the duration of something. The name is the behaviour: it does not update, and the question is
  only how long the something lasts.</p>

  <p>The same setting read all three ways, across a change to the file underneath:</p>

  <pre data-lang="console" data-title="01-the-three-interfaces.cs output"><code>   the file says 5   {"iOptions":5,"iOptionsSnapshot":5,"iOptionsMonitor":5}
   the file says 30  {"iOptions":5,"iOptionsSnapshot":30,"iOptionsMonitor":30}</code></pre>

  <p>The first column did not move and never will. That is not a bug — for most settings it is what you
  want, because a value that changes under a running request is harder to reason about than one that
  does not.</p>

  <h3>Which one a singleton may hold</h3>

  <pre data-lang="console" data-title="01-the-three-interfaces.cs output"><code>   singleton takes            startup
   ---------------            -------
   IOptions&lt;T&gt;                built without complaint
   IOptionsMonitor&lt;T&gt;         built without complaint
   IOptionsSnapshot&lt;T&gt;        Cannot consume scoped service
                              'IOptionsSnapshot&#96;1[GatewayOptions]' from singleton
                              'HoldsSnapshot'.</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a singleton cannot hold a scoped service"><code>public sealed class RateLimiter(IOptionsSnapshot&lt;LimitOptions&gt; limits)
{
    public int PerMinute =&gt; limits.Value.PerMinute;
}

builder.Services.AddSingleton&lt;RateLimiter&gt;();</code></pre>

  <p><code>IOptionsSnapshot</code> is scoped, because "once per scope" is what it means. A singleton
  holding one is a captive dependency, and the check from the lifetimes module refuses to start.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Without <code>ValidateScopes</code> — which is off in Production by default — that third row
    <em>starts</em>. Every request then gets the snapshot taken during whichever request built the
    singleton: frozen, and looking exactly like <code>IOptions</code> while claiming not to be.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Interface</th><th>Lifetime</th><th>Value read</th><th>Use for</th></tr></thead>
      <tbody>
        <tr><td><code>IOptions&lt;T&gt;</code></td><td>Singleton</td><td>Once, ever</td>
            <td>Almost everything</td></tr>
        <tr><td><code>IOptionsSnapshot&lt;T&gt;</code></td><td>Scoped</td><td>Once per request</td>
            <td>Scoped code needing per-request freshness</td></tr>
        <tr><td><code>IOptionsMonitor&lt;T&gt;</code></td><td>Singleton</td><td>On every access</td>
            <td>Singletons and workers that must see changes</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>Start with <code>IOptions</code> and move only when you have a reason</strong>, and the
  reason is always the same one: this value legitimately changes while the process runs, and the process
  must notice. For most settings that is not true — a container is restarted to change configuration,
  so a reloading options object buys nothing and costs you the guarantee that two requests in the same
  deployment behaved the same way. Where it is genuinely worth it: feature flags, log levels, rate
  limits, circuit breaker thresholds.</p>

  <h3>The question behind the choice</h3>

  <p>Picking between the three is usually presented as a lookup table, and the table is accurate and
  not much help — because the hard part is not knowing what they do but deciding which one a given
  setting deserves. There is one question that settles it:</p>

  <p><strong>Is a value that differs between two requests in the same deployment a bug, or the whole
  point?</strong></p>

  <p>For a timeout, a base URL, a connection string, a page size limit, a retry count — it is a bug.
  Two callers hitting the same version of your service should get the same behaviour, and if they do
  not, every subsequent investigation has to consider "which value was live at the time" as a variable.
  That is a genuine cost, paid on every incident afterwards, in exchange for a convenience you use
  rarely. Those settings take <code>IOptions</code>.</p>

  <p>For a feature flag, a log level, a rate limit you tighten under attack, a circuit breaker
  threshold — differing between requests <em>is</em> the point, because the purpose of the setting is to
  change behaviour while the service runs. Those take <code>IOptionsMonitor</code>.</p>

  <p>That leaves <code>IOptionsSnapshot</code> with a narrow job, and it is worth naming why it exists at
  all rather than treating it as a middle option. It gives one request a <em>consistent</em> view: read
  the same setting three times during one request and get the same answer, even if the file changed
  half-way through. <code>IOptionsMonitor</code> makes no such promise — two reads in one request can
  differ. If a request makes several decisions from one setting and they must agree with each other,
  that consistency is the reason to use a snapshot; otherwise it is the wrong default, because it is
  scoped and therefore unusable in exactly the places that most often need fresh values.</p>

  <p>A useful consequence of that framing: <strong>the interface a class asks for is documentation</strong>.
  A constructor taking <code>IOptions</code> says "these values are fixed for this deployment"; one
  taking <code>IOptionsMonitor</code> says "these can move underneath me and I have thought about it".
  Making that claim and then caching the value, which is the incident this module opens with, is what
  turns the documentation into a lie.</p>

</section>

<section id="named-options">
  <h2>Two of the same thing</h2>

  <p class="define"><span class="define__term">Named options</span> The same options class bound several
  times, each binding tagged with a name, so one application can hold several sets of the same
  settings.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-the-three-interfaces.cs"><code>builder.Services.AddOptions&lt;GatewayOptions&gt;("card")
    .Bind(builder.Configuration.GetSection("Gateways:card"));

builder.Services.AddOptions&lt;GatewayOptions&gt;("bank")
    .Bind(builder.Configuration.GetSection("Gateways:bank"));</code></pre>

  <pre data-lang="console" data-title="01-the-three-interfaces.cs output"><code>{"card":"https://cards.internal:8443 @ 5s",
 "bank":"https://bank.internal:8443 @ 30s",
 "unnamed":"(unset) @ 30s"}</code></pre>

  <p>Named options are the same class bound several times, retrieved with <code>Get(name)</code> rather
  than <code>Value</code>. The third field is the unnamed one, which nobody configured: it comes back as
  an object of class defaults rather than an error — the same silence as an absent configuration
  section, so a typo in a name produces defaults rather than a failure.</p>

  <p><code>IOptions&lt;T&gt;</code> has no <code>Get</code> method at all; it only ever gives you the
  unnamed instance, which is why named options are reached through the other two.</p>

  <p>Use names when the set is open — two gateways today, a third next quarter, configured rather than
  coded. When the set is fixed and known, two separate options classes are clearer: the compiler keeps
  them apart, a typo is a build error rather than a defaulted object, and each can grow properties the
  other does not have.</p>
</section>

<section id="validation">
  <h2>Making a wrong setting stop the process</h2>

  <p class="define"><span class="define__term">Data annotation</span> An attribute on a property
  stating a rule about its value — <code>[Required]</code>, <code>[Range]</code>, <code>[Url]</code>.
  The attribute records the rule; something else has to enforce it.</p>

  <p class="define"><span class="define__term">Lazy validation</span> Rules that run the first time
  somebody asks for the value, rather than when the application starts. It is the default here, and it
  is the whole reason this section exists.</p>

  <p class="define"><span class="define__term">Cross-field rule</span> A rule about the relationship
  between two or more properties, which no single-property attribute can express — "these two multiplied
  must not exceed that third one".</p>

  <p>The Gateway section is missing <code>BaseUrl</code> entirely — the mistake from the configuration
  module, where a renamed key binds to nothing:</p>

  <pre data-lang="console" data-title="02-validation.cs output"><code>   registration                          startup      first request
   ------------                          -------      -------------
   Bind only                             started      200 {"url":"/capture/PAY-1"}
   + ValidateDataAnnotations             started      500 (the request failed)
   + ValidateOnStart                     REFUSED      -
   + a cross-field Validate              REFUSED      -</code></pre>

  <p>The first row is what most services do: it starts, serves traffic, and the gateway call goes to
  <code>/capture/PAY-1</code> with no host.</p>

  <p><strong>The second row is the one that surprises people.</strong> The data annotations are declared
  and <code>ValidateDataAnnotations</code> is called, and the application still starts. Options
  validation is <em>lazy</em> — the rules run the first time something reads <code>.Value</code>, not
  when the application starts — so the failure lands on a request rather than on the deployment.</p>

  <p>That is worse than it looks. A rarely-used endpoint means the process is healthy, the deployment is
  green, and the failure waits for whoever first calls that path.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>ValidateDataAnnotations</code> without <code>ValidateOnStart</code> is a check that runs on
    a customer's request. One method call moves every options failure from first use to startup, which
    turns an incident into a deployment that rolls back.</p>
  </div>

  <pre data-lang="csharp" data-net="10" data-title="02-validation.cs — the registration to copy"><code>builder.Services.AddOptions&lt;GatewayOptions&gt;()
    .Bind(builder.Configuration.GetSection("Gateway"))
    .ValidateDataAnnotations()
    .Validate(o =&gt; o.TimeoutSeconds * o.MaxAttempts &lt;= o.OverallBudgetSeconds,
        "retry budget exceeds the overall timeout")
    .ValidateOnStart();</code></pre>

  <p>Five lines, each doing something the others do not. <code>AddOptions&lt;T&gt;()</code> starts a
  builder rather than registering a bare <code>Configure</code>, which is what makes the rest of the
  chain available. <code>Bind</code> is the only place key names appear.
  <code>ValidateDataAnnotations()</code> turns the attributes on the class into checks — without it they
  are comments. <code>Validate</code> covers rules that span properties.
  <code>ValidateOnStart()</code> runs all of it at startup.</p>

  <pre data-lang="console" data-title="02-validation.cs output"><code>   everything valid      started
   BaseUrl absent        REFUSED: ... 'BaseUrl' with the error: 'The BaseUrl field is required.'
   BaseUrl not a URL     REFUSED: ... 'The BaseUrl field is not a valid fully-qualified http,
                         https, or ftp URL.'
   TimeoutSeconds 0      REFUSED: ... 'The field TimeoutSeconds must be between 1 and 120.'
   MaxAttempts 50        REFUSED: ... 'The field MaxAttempts must be between 1 and 10.'
   two things wrong      REFUSED: ... 'BaseUrl' ... | ... 'TimeoutSeconds' ...</code></pre>

  <p>Every failing rule is reported, not only the first, which matters when somebody is fixing a
  deployment at speed.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a plausible default hides a missing setting"><code>public sealed class GatewayOptions
{
    // A required setting with a working default. An environment that forgets to
    // set it starts, passes validation, and talks to the wrong gateway.
    [Required]
    [Url]
    public string BaseUrl { get; set; } = "https://gw-v1.internal:8443";
}</code></pre>

  <p>Note what <code>[Required]</code> does on a string with an initialiser: the property defaults to
  empty rather than null, and <code>Required</code> rejects an empty string, so it catches the absent
  case. A property defaulting to a <em>plausible</em> value would not — which is the argument for
  leaving required settings with no default.</p>

</section>

<section id="beyond-attributes">
  <h2>Rules an attribute cannot express</h2>

  <pre data-lang="console" data-title="02-validation.cs output"><code>   settings                                  startup
   --------                                  -------
   5s x 3 attempts, 30s budget               started
   5s x 3 attempts, 10s budget               REFUSED: retry budget exceeds the overall timeout
   20s x 2 attempts, 30s budget              REFUSED: retry budget exceeds the overall timeout</code></pre>

  <p class="define"><span class="define__term">IHostEnvironment</span> A service carrying the
  environment name the application was started with, so code can ask whether it is running in
  Development without reading configuration itself.</p>

  <p class="define"><span class="define__term">IValidateOptions&lt;T&gt;</span> An interface with one
  method, registered in the container — so a validation rule can take dependencies, and can report
  several failures at once.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs — a validator that needs a service"><code>public sealed class GatewayValidator(IHostEnvironment environment)
    : IValidateOptions&lt;GatewayOptions&gt;
{
    public ValidateOptionsResult Validate(string? name, GatewayOptions options)
    {
        var failures = new List&lt;string&gt;();

        if (options.TimeoutSeconds * options.MaxAttempts &gt; options.OverallBudgetSeconds)
        {
            failures.Add($"retry budget ({options.TimeoutSeconds}s x {options.MaxAttempts}) " +
                $"exceeds the overall budget of {options.OverallBudgetSeconds}s");
        }

        if (!environment.IsDevelopment()
            &amp;&amp; !options.BaseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            failures.Add("BaseUrl must be https outside Development");
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}</code></pre>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   environment   settings                            startup
   -----------   --------                            -------
   Production    https://gw.internal:8443, 5s x 3    started
   Production    http://gw.internal:8443, 5s x 3     REFUSED: BaseUrl must be https outside
                                                     Development
   Development   http://localhost:9443, 5s x 3       started
   Production    https://gw.internal:8443, 20s x 3   REFUSED: retry budget (20s x 3) exceeds
                                                     the overall budget of 30s
   Production    http://gw.internal:8443, 20s x 3    REFUSED: retry budget ... | BaseUrl must
                                                     be https outside Development</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - reports one failure at a time"><code>builder.Services.AddOptions&lt;GatewayOptions&gt;()
    .Bind(builder.Configuration.GetSection("Gateway"))
    // Each Validate short-circuits the ones after it, so an environment with
    // three problems takes three deployments to fix.
    .Validate(o =&gt; o.TimeoutSeconds * o.MaxAttempts &lt;= o.OverallBudgetSeconds, "budget")
    .Validate(o =&gt; o.BaseUrl.StartsWith("https://"), "https required")
    .Validate(o =&gt; o.MaxAttempts &lt;= 5, "too many attempts")
    .ValidateOnStart();</code></pre>

  <p>The last row is the point: two rules broken, both reported. A chain of <code>.Validate(...)</code>
  calls stops at the first failure, so somebody fixing a manifest would fix one thing, redeploy, and be
  told about the next.</p>

  <p>The third row is the reason this is a class rather than a lambda — the https rule depends on the
  environment, which is a service, so the validator has to be something the container can build.</p>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>One application, every settings decision made deliberately: bound once, validated at startup, and
  each consumer taking the interface that matches how often its value may change.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    EnvironmentName = "Production",
    ContentRootPath = root
});

builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

builder.Host.UseDefaultServiceProvider(options =&gt;
{
    options.ValidateOnBuild = true;
    options.ValidateScopes = true;
});

// ---------------------------------------------------------------------------
// SETTINGS THAT DO NOT CHANGE WHILE THE PROCESS RUNS. Validated at startup, so
// a broken environment is a failed deployment.
builder.Services.AddOptions&lt;GatewayOptions&gt;()
    .Bind(builder.Configuration.GetSection("Gateway"))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services.AddSingleton&lt;IValidateOptions&lt;GatewayOptions&gt;, GatewayValidator&gt;();

// SETTINGS THAT ARE MEANT TO CHANGE. A kill switch is only useful if it can be
// pulled without a restart, so this one is read through a monitor.
builder.Services.AddOptions&lt;FeatureOptions&gt;()
    .Bind(builder.Configuration.GetSection("Features"))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services.AddSingleton&lt;PaymentGateway&gt;();
builder.Services.AddSingleton&lt;SettlementRouter&gt;();

var app = builder.Build();

app.MapGet("/capture/{id}", (string id, PaymentGateway gateway) =&gt;
    Results.Ok(new { request = gateway.Describe(id) }));

app.MapGet("/route", (SettlementRouter router) =&gt; Results.Text(router.Route()));</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs — the two consumers"><code>// Settings that must not change under a running request. IOptions says so.
public sealed class PaymentGateway(IOptions&lt;GatewayOptions&gt; options)
{
    private readonly GatewayOptions _options = options.Value;

    public string Describe(string paymentId) =&gt;
        $"POST {_options.BaseUrl}/capture/{paymentId} " +
        $"(timeout {_options.TimeoutSeconds}s, up to {_options.MaxAttempts} attempts)";
}

// A kill switch, which is only useful if it can be pulled without a restart.
public sealed class SettlementRouter(IOptionsMonitor&lt;FeatureOptions&gt; features)
{
    // Read at the point of use. NOT copied into a field - that is the whole
    // production incident in this module.
    public string Route() =&gt; features.CurrentValue.NewSettlement ? "new" : "old";
}</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>1. It started, which means every setting passed validation

   GET /capture/PAY-1   {"request":"POST https://gw.internal:8443/capture/PAY-1
                         (timeout 5s, up to 3 attempts)"}
   GET /route           new

2. The flag changes without a restart, and the timeout does not

   GET /capture/PAY-1   {"request":"POST https://gw.internal:8443/capture/PAY-1
                         (timeout 5s, up to 3 attempts)"}
   GET /route           old</code></pre>

  <p><strong>The flag moved and the timeout did not, and both are correct.</strong>
  <code>PaymentGateway</code> takes <code>IOptions</code>, so it holds the values it was built with —
  deliberately, because a timeout changing under a request in flight would make two calls in the same
  deployment behave differently for reasons no log records.</p>

  <p>One honest cost, visible in that run: the file's new timeout of 45 seconds would have failed
  validation had the process restarted, because 45 × 3 exceeds the 30-second budget. It is live in the
  file and unread. Validation runs at startup, so a file edited afterwards is neither applied nor
  checked.</p>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   settings                              startup
   --------                              -------
   everything valid                      started
   BaseUrl absent                        REFUSED: The BaseUrl field is required | BaseUrl must
                                         be https outside Development
   plain http in Production              REFUSED: BaseUrl must be https outside Development
   retry budget too large                REFUSED: retry budget (20s x 3) exceeds the overall
                                         budget of 30s</code></pre>

  <p>The options class plus its validator have become <strong>the specification of a valid
  environment</strong>. Somebody deploying to a new region reads one file to know what they must
  supply, and gets the complete list of what they got wrong on the first attempt rather than one item at
  a time.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Copying CurrentValue into a field</h3>

  <p>The incident. Measured across three versions of the same class:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   how the class holds it                 before   after   sees the change
   ----------------------                 ------   -----   ---------------
   monitor.CurrentValue into a field      new      new     no
   monitor.CurrentValue at each read      new      old     YES
   a field updated by OnChange            new      old     YES</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs — the fix"><code>public sealed class ReadingRouter(IOptionsMonitor&lt;FeatureOptions&gt; monitor) : IRouter
{
    public string Route() =&gt; monitor.CurrentValue.NewSettlement ? "new" : "old";
}</code></pre>

  <p><code>CurrentValue</code> is a property read against an object the monitor already holds, not a
  re-parse of configuration, so reading it per request costs nothing worth measuring.</p>

  <p>The third version also works, and is what you want when a change needs <em>work</em> done rather
  than a value read — rebuilding a client, re-opening a connection, logging that a flag moved. It comes
  with two obligations the second does not have: the subscription must be disposed, and the field is now
  written by one thread while others read it, so it must be a whole-object reference assignment rather
  than field-by-field mutation. Prefer the second.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>A class that takes <code>IOptionsMonitor</code> and reads it once is lying. It should take
    <code>IOptions</code> instead, which is honest and does the same thing — making the two versions
    behave differently is the entire point of the interfaces being distinct.</p>
  </div>

  <h3>ValidateDataAnnotations without ValidateOnStart</h3>

  <p>Measured above: the application starts, the health check returns 200 the whole time because it does
  not read the options, and the failure lands on the first request to the endpoint that does.</p>

  <h3>Silencing a scope error instead of fixing it</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   singleton takes IOptionsSnapshot, checked    REFUSED: Cannot consume scoped service
                                                'IOptionsSnapshot&#96;1[GatewayOptions]' from
                                                singleton 'SnapshotHolder'.
   singleton takes IOptionsSnapshot, unchecked  built without complaint</code></pre>

  <p>The startup error was the correct answer. Turning off scope validation — or deploying to Production,
  where it is off by default — converts a failed startup into a rate limit frozen at whatever it was
  when the first request arrived.</p>

  <h3>A typo in a named option</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>{"card":"https://cards.internal:8443 @ 5s","bank":"https://bank.internal:8443 @ 45s",
 "typo":" @ 30s"}</code></pre>

  <p><code>Get("cards")</code> was never registered and returns an object of class defaults.
  <code>ValidateOnStart</code> does not help: it validates the names that were registered, and this is
  not one of them, so there is nothing to check.</p>

  <h3>Registering an OnChange callback per request</h3>

  <pre data-lang="console" data-title="01-the-three-interfaces.cs output"><code>     callbacks registered by 1,000 requests   1000
     after disposing every subscription       0</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a subscription per request, never disposed"><code>public sealed class RequestScopedThing
{
    public RequestScopedThing(IOptionsMonitor&lt;FeatureOptions&gt; monitor)
    {
        // The return value is discarded, so nothing can ever unsubscribe.
        monitor.OnChange(updated =&gt; Recalculate(updated));
    }

    private void Recalculate(FeatureOptions options) { }
}</code></pre>

  <p><code>OnChange</code> returns an <code>IDisposable</code>, and the subscription lives until it is
  disposed. Registered per request and never disposed, it is a growing leak — and every configuration
  change then invokes every callback ever registered. Register once in something that lives as long as
  the application, or read <code>CurrentValue</code>, which needs no subscription.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
      <tbody>
        <tr><td>A flag or setting changes and the application ignores it</td>
            <td><code>CurrentValue</code> copied into a field, or <code>IOptions</code> used where
            freshness was needed</td>
            <td>Read <code>CurrentValue</code> at the point of use</td></tr>
        <tr><td>A broken setting is discovered by a customer, hours after deploying</td>
            <td>Validation is lazy without <code>ValidateOnStart</code></td>
            <td>Add <code>ValidateOnStart()</code> to every options type</td></tr>
        <tr><td><code>Cannot consume scoped service 'IOptionsSnapshot...'</code></td>
            <td>A singleton holding a snapshot</td>
            <td>Use <code>IOptionsMonitor</code>; do not disable the check</td></tr>
        <tr><td>Named options come back as zeros</td>
            <td>A name that was never registered — usually a typo</td>
            <td>Compare against the <code>AddOptions&lt;T&gt;(name)</code> calls</td></tr>
        <tr><td>A property is zero and the file looks right</td>
            <td>The key and the property name disagree; binding is silent</td>
            <td>Add <code>[Range]</code> so zero is rejected at startup</td></tr>
        <tr><td>Memory grows in a service using <code>IOptionsMonitor</code></td>
            <td><code>OnChange</code> subscriptions never disposed</td>
            <td>Register once, in a singleton, and dispose it</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>For anything reload-related, the test that matters has a specific shape, and the one people write
    does not have it:</p>
    <pre data-lang="csharp" data-net="10" data-title="03-production.cs — the test that would have failed"><code>var router = new SettlementRouter(monitor);   // BEFORE the change
Assert.Equal("new", router.Route());

source.Set(newSettlement: false);             // then change it
Assert.Equal("old", router.Route());          // this line fails</code></pre>
    <p>A test that changes the value and then constructs the object is testing the constructor. The same
    applies in a live environment: flipping a flag and restarting the service — which is what people do
    when checking that a flag works — reads the new value in the constructor and proves nothing.</p>
    <p><strong>Change the value without restarting, and observe the same instance.</strong> If a flag is
    a kill switch, exercise it that way in an environment that is not a developer machine, before you
    rely on it at 02:40.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Using IOptionsMonitor means my class sees configuration changes."</strong></p>
    <p>It means it <em>can</em>. Measured: a class that assigns <code>CurrentValue</code> to a field in
    its constructor never sees a change, and reads at every glance as though it does. Taking the
    interface is not the same as using it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Data annotations on an options class validate it."</strong></p>
    <p>They do nothing until <code>ValidateDataAnnotations()</code> is called, and even then they run
    lazily on first read. Without <code>ValidateOnStart()</code> a broken environment starts, passes its
    health check, and fails on a request.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"IOptionsSnapshot is the safe default because it is fresher."</strong></p>
    <p>It is scoped, so a singleton cannot hold it — and where it can be used, per-request freshness
    means two requests in the same deployment can behave differently. <code>IOptions</code> is the
    default; the others are for values that genuinely change.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Reading CurrentValue on every request is expensive."</strong></p>
    <p>It is a property read against an object the monitor already holds, not a re-parse of
    configuration. The cost of copying it into a field is a bug; the cost of not copying it is
    nothing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A missing named option will be caught by validation."</strong></p>
    <p><code>ValidateOnStart</code> validates the names that were registered. A typo is a name nobody
    registered, so there is nothing to validate, and <code>Get</code> returns class defaults.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Injecting IConfiguration is simpler than all this."</strong></p>
    <p>It is shorter and it moves the key names into every class that reads one, makes each of those
    classes untestable without configuration, and removes the one place a rule about the values could
    live. The options pattern exists to buy those three things back.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The kill switch was built for exactly one situation and failed in it. At 02:40 the engineer had
    the right lever, pulled it, confirmed the value had changed, and watched the failures continue — so
    the next twenty minutes went into doubting the deployment pipeline rather than the code, because the
    evidence said the configuration was correct.</p>
    <p>The eventual fix was a restart, which is what the flag existed to avoid. What the flag actually
    bought was a slower incident: the restart happened later than it would have if nobody had believed
    there was a faster option.</p>
    <p>The other half of the module is cheaper still. <code>ValidateOnStart()</code> is one method call
    per options type, and it converts every wrong or missing setting from a runtime failure on somebody
    else's request into a deployment that will not start. Measured above: the same broken configuration
    starts and serves 200s from the health check for as long as nobody calls the affected endpoint.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>An options class has <code>[Required]</code> and <code>[Range]</code> on every property, and
    <code>ValidateDataAnnotations</code> is called. A deployment with a missing base URL starts
    normally and serves traffic for two hours before anybody hits the endpoint that uses it.</p>
    <p>What is missing, and where did the failure land instead?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   registration                     startup   the request that needed it
   ------------                     -------   --------------------------
   ValidateDataAnnotations only     started   /health 200, /capture 500
   + ValidateOnStart                REFUSED   -</code></pre>
        <p><code>ValidateOnStart</code>. Options validation is lazy — the rules run the first time
        something reads <code>.Value</code>, not when the application starts. Declaring the attributes
        and calling <code>ValidateDataAnnotations</code> sets the checks up; nothing runs them until
        somebody asks for the value.</p>
        <p>Note the health check in the first row, which returned 200 the whole time because it does not
        read the options. Every signal said the deployment was fine.</p>
        <p>One method call moves it: <code>ValidateOnStart</code> runs every registered validation during
        startup, so a broken environment is a deployment that rolls back rather than an incident with a
        two-hour fuse.</p>
        <p>It is worth being precise about why the default is lazy, because it is not an oversight.
        Options are resolved through the container, and the container builds things when they are first
        asked for — validating at registration time would mean binding and checking every options type
        in the application whether or not anything uses it, which for a large service with many
        optional features is work nobody asked for. <code>ValidateOnStart</code> is the opt-in that says
        "do it anyway, now".</p>
        <p>The practical rule that follows: put <code>ValidateOnStart()</code> on every options type
        without thinking about it. The cost is a few milliseconds of startup for a process that is about
        to run for weeks, and the thing it buys is that the set of environments in which your
        application can start becomes exactly the set in which it can work.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A rate limit is read through <code>IOptionsSnapshot</code> so it can be adjusted without a
    restart, and injected into a singleton. In Development this refuses to start; somebody adds a line
    to make it start, and in production the limit never changes.</p>
    <p>What line did they add, what happened, and what should it have been?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   singleton takes IOptionsSnapshot, checked    REFUSED: Cannot consume scoped service
                                                'IOptionsSnapshot&#96;1[GatewayOptions]' from
                                                singleton 'SnapshotHolder'.
   singleton takes IOptionsSnapshot, unchecked  built without complaint</code></pre>
        <p>They turned off scope validation — or moved to an environment where it is off by default,
        which Production is.</p>
        <p><code>IOptionsSnapshot</code> is scoped, because "once per scope" is what it means. A singleton
        holding one captures the snapshot taken during whichever request built the singleton and holds it
        forever, so the rate limit is frozen at the value it had when the first request arrived.</p>
        <p>The startup error was the correct answer, and silencing it converted a failed startup into a
        feature that quietly does not work.</p>
        <p>It should have been <code>IOptionsMonitor</code>, which is a singleton and may be held by
        one — reading <code>CurrentValue</code> at the point of use, not copying it into a field.</p>
        <p>There is a second, quieter fix worth knowing about, because it is sometimes the right one:
        make the consumer scoped instead. A rate limiter that genuinely needs per-request settings and
        holds no state between requests can be registered scoped, and then
        <code>IOptionsSnapshot</code> is exactly correct. That is a real design choice rather than a
        workaround — but it is a decision about the limiter's lifetime, not about how it reads
        settings, and it should be made for lifetime reasons.</p>
        <p>The general lesson is the one the error message was already telling you.
        <strong>A startup error about lifetimes is a statement about your object graph, not an
        obstacle in front of it.</strong> Every way of silencing it — disabling the check, injecting a
        provider, deploying to an environment where the check is off — leaves the graph unchanged and
        removes the only thing that was going to tell you.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>Ledger adds a bank transfer gateway alongside the card one: same settings shape, different
    values, both needed at once.</p>
    <p>Show it with named options, and say when you would not use them.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs"><code>foreach (string name in new[] { "card", "bank" })
{
    builder.Services.AddOptions&lt;GatewayOptions&gt;(name)
        .Bind(builder.Configuration.GetSection($"Gateways:{name}"))
        .ValidateDataAnnotations()
        .ValidateOnStart();
}</code></pre>
        <pre data-lang="console" data-title="04-exercises.cs output"><code>{"card":"https://cards.internal:8443 @ 5s","bank":"https://bank.internal:8443 @ 45s",
 "typo":" @ 30s"}</code></pre>
        <p>Each name is bound and validated separately, so a broken bank section fails startup without
        the card one having to care.</p>
        <p>Read the third field. <code>cards</code> is a typo, was never registered, and comes back as an
        object of class defaults rather than an error — the same silence a missing configuration section
        produces. <code>ValidateOnStart</code> does not help either: it validates the names that were
        registered, and this is not one of them.</p>
        <p>When not to use named options: when the set is fixed and known at compile time. Two classes —
        <code>CardGatewayOptions</code> and <code>BankGatewayOptions</code> — cost a few more lines and
        buy real things: the compiler keeps them apart, a typo is a build error rather than a defaulted
        object, and each can grow properties the other does not have.</p>
        <p>Use names when the set is open — a third gateway next quarter without a code change.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>The gateway settings must satisfy three rules: the retry budget must fit inside the overall
    timeout; the base URL must be https in every environment except Development; and all failures must
    be reported at once, not one at a time.</p>
    <p>Implement it and show it failing.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs"><code>public sealed class GatewayValidator(IHostEnvironment environment)
    : IValidateOptions&lt;GatewayOptions&gt;
{
    public ValidateOptionsResult Validate(string? name, GatewayOptions options)
    {
        var failures = new List&lt;string&gt;();

        if (options.TimeoutSeconds * options.MaxAttempts &gt; options.OverallBudgetSeconds)
        {
            failures.Add($"retry budget ({options.TimeoutSeconds}s x {options.MaxAttempts}) " +
                $"exceeds the overall budget of {options.OverallBudgetSeconds}s");
        }

        if (!environment.IsDevelopment()
            &amp;&amp; !options.BaseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            failures.Add("BaseUrl must be https outside Development");
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}

builder.Services.AddSingleton&lt;IValidateOptions&lt;GatewayOptions&gt;, GatewayValidator&gt;();</code></pre>
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   environment   settings                            startup
   -----------   --------                            -------
   Production    https://gw.internal:8443, 5s x 3    started
   Production    http://gw.internal:8443, 5s x 3     REFUSED: BaseUrl must be https outside
                                                     Development
   Development   http://localhost:9443, 5s x 3       started
   Production    https://gw.internal:8443, 20s x 3   REFUSED: retry budget (20s x 3) exceeds
                                                     the overall budget of 30s
   Production    http://gw.internal:8443, 20s x 3    REFUSED: retry budget ... | BaseUrl must
                                                     be https outside Development</code></pre>
        <p>The last row is the point: two rules broken, both reported. A chain of
        <code>.Validate(...)</code> calls stops at the first failure, so somebody fixing a manifest would
        fix one thing, redeploy, and be told about the next.</p>
        <p>The third row is why this is a class rather than a lambda: the https rule depends on the
        environment, which is a service, so the validator has to be something the container can build.
        A lambda in <code>Program.cs</code> could close over it, and then the rule lives in the
        composition root rather than next to the thing it describes.</p>
        <p>What this buys, plainly: the options class plus its validator become the specification of a
        valid environment.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is the difference between <code>IOptions</code>, <code>IOptionsSnapshot</code> and
      <code>IOptionsMonitor</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>When the value is read. <code>IOptions</code> once ever;
        <code>IOptionsSnapshot</code> once per scope, so once per request; <code>IOptionsMonitor</code>
        on every access to <code>CurrentValue</code>. The first and third are singletons; the second is
        scoped.</p></div>
      </details></li>

    <li><p>Why can a singleton not take <code>IOptionsSnapshot</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It is scoped, so holding one is a captive dependency. Scope
        validation refuses it at startup — and where that check is off, the singleton freezes whichever
        request's snapshot built it.</p></div>
      </details></li>

    <li><p>What does <code>ValidateDataAnnotations</code> do without <code>ValidateOnStart</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It registers the checks and runs them lazily, on the first read of
        <code>.Value</code>. The application starts, the health check passes, and the failure lands on
        whichever request first needs those options.</p></div>
      </details></li>

    <li><p>A class takes <code>IOptionsMonitor</code> and never sees a change. What is the most likely
      line?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>_options = monitor.CurrentValue;</code> in the constructor.
        That copies the value once; the fix is to read <code>CurrentValue</code> at the point of
        use.</p></div>
      </details></li>

    <li><p>When would you write an <code>IValidateOptions&lt;T&gt;</code> rather than
      <code>.Validate(...)</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>When the rule needs a dependency from the container, or when you
        want every failure reported at once rather than stopping at the first.</p></div>
      </details></li>

    <li><p>What does <code>Get("typo")</code> return for a name nobody registered?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>An object of class defaults, silently. Validation only covers
        registered names, so there is nothing to fail.</p></div>
      </details></li>

    <li><p>Why should a required setting have no default value in the options class?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>So that an absent value is empty or zero and
        <code>[Required]</code> or <code>[Range]</code> rejects it. A plausible default makes a missing
        setting indistinguishable from a configured one.</p></div>
      </details></li>

    <li><p>What obligation does <code>OnChange</code> carry that <code>CurrentValue</code> does not?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It returns an <code>IDisposable</code> that must be disposed.
        Subscriptions registered per request and never disposed accumulate, and every change then invokes
        every callback ever registered.</p></div>
      </details></li>
  </ol>
</section>
`
});
