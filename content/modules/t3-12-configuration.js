CSPREP.module({
  id: "t3-12-configuration",
  minutes: 55,
  updated: "2026-09-04",
  summary: "A deployment manifest sets Gateway_BaseUrl with one underscore instead of two, the application keeps its committed default, and the failure arrives eleven days later when somebody turns off the old endpoint. Providers and their order, the environment-variable naming that differs between Windows and Linux, binding that ignores everything it does not recognise, and the measured finding that a later source overrides an array element by element and cannot shorten it.",
  terms: ["configuration", "provider", "key", "section", "precedence", "appsettings.json",
    "environment variables", "double underscore", "binding", "IConfiguration", "GetValue",
    "Get<T>", "Bind", "reloadOnChange", "GetDebugView", "user secrets"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger moves its payment gateway to a new endpoint. The base URL lives in configuration, so this
  is a deployment change rather than a code change — which is the entire reason it is in configuration.
  The manifest sets it:</p>

  <pre data-lang="yaml" data-title="the deployment manifest"><code>env:
  - name: Gateway_BaseUrl
    value: https://gw-v2.internal:8443</code></pre>

  <p>The change is reviewed, merged and rolled out. Payments keep working, because the old endpoint has
  not been switched off yet.</p>

  <p>Eleven days later the old endpoint is switched off, and every payment in the estate fails at
  once.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   variable set in the manifest   application resolves BaseUrl to
   ----------------------------   -------------------------------
   Gateway_BaseUrl                https://gw-v1.internal:8443
   Gateway__BaseUrl               https://gw-v2.internal:8443</code></pre>

  <p><strong>One underscore.</strong> A single underscore is part of the key name; a double underscore
  is the separator between levels. The manifest defined a top-level key called
  <code>Gateway_BaseUrl</code> that nothing reads, and the application went on using the committed
  default.</p>

  <p>Nothing anywhere was wrong in a way any check could see. The variable was set, and
  <code>printenv</code> showed it. The manifest was reviewed and the value in it was correct. The
  application started and passed every health check. Payments worked, because the old endpoint still
  answered.</p>

  <p><strong>The failure was scheduled for whenever somebody else turned off the old endpoint</strong>,
  which is the worst possible separation between cause and effect.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every value, key, provider name and outcome in this module was produced by running the programs
    shown, on .NET 10, and pasted in unedited.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What configuration actually is</h2>

  <p class="define"><span class="define__term">Configuration</span> Values your application reads at
  startup that are not compiled into it — a connection string, a timeout, a base URL, a feature
  switch. The point of them being configuration is that they can differ between environments without
  the code differing.</p>

  <p class="define"><span class="define__term">Provider</span> One source of those values: a JSON file,
  the process's environment variables, the command line, a secret store. Each provider produces a set
  of key/value pairs.</p>

  <p class="define"><span class="define__term">Optional provider</span> One registered with
  <code>optional: true</code>, meaning the application starts normally if the source is missing. The
  opposite — <code>optional: false</code> — makes an absent source a startup failure.</p>

  <p class="define"><span class="define__term">User secrets</span> A JSON file stored outside the
  repository, in your own user profile, added to configuration in Development only. It exists so that a
  developer can have real credentials locally without any chance of committing them.</p>

  <p class="define"><span class="define__term">Key</span> The name of one value. Keys are flat strings
  and use a colon to separate levels: <code>Gateway:BaseUrl</code> is the <code>BaseUrl</code> key
  inside the <code>Gateway</code> section.</p>

  <p class="define"><span class="define__term">Section</span> A prefix of a key. It looks like an object
  because JSON files nest, but it is only a naming convention over a flat dictionary.</p>

  <p class="define"><span class="define__term">Secret</span> A configuration value that grants access
  to something — an API key, a connection string with a password, a signing key. The distinguishing
  property is not sensitivity in the abstract but that possession of it is sufficient to act.</p>

  <p class="define"><span class="define__term">Environment name</span> A string the host reads from
  <code>ASPNETCORE_ENVIRONMENT</code>, conventionally <em>Development</em>, <em>Staging</em> or
  <em>Production</em>. It selects which <code>appsettings.{Name}.json</code> file is loaded, and whether
  a few Development-only behaviours are switched on. It is a string, not an enum: an unrecognised value
  is not an error, it matches no file.</p>

  <p class="define"><span class="define__term">Flattening</span> Turning nested structure into flat
  keys. The JSON <code>{"Gateway":{"BaseUrl":"x"}}</code> becomes the single key
  <code>Gateway:BaseUrl</code>, and an array becomes keys named by index.</p>

  <p class="define"><span class="define__term">Precedence</span> Which source's value survives when
  more than one defines the same key. Here it is positional and nothing else: last added, first
  served.</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — One setting, four sources, and the rule that decides which
// value the application actually gets.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every value here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

// A directory this program writes its own configuration files into, so the
// example is self-contained and leaves nothing behind.
string root = Directory.CreateTempSubdirectory("cfg-smallest").FullName;

File.WriteAllText(Path.Combine(root, "appsettings.json"), """
{
  "Gateway": {
    "BaseUrl": "https://gw.example/v1",
    "TimeoutSeconds": 30
  }
}
""");

File.WriteAllText(Path.Combine(root, "appsettings.Production.json"), """
{
  "Gateway": {
    "TimeoutSeconds": 5
  }
}
""");

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    EnvironmentName = "Production",
    ContentRootPath = root
});

builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// A fourth source, added last, standing in for what a container platform sets.
builder.Configuration.AddInMemoryCollection(new Dictionary&lt;string, string?&gt;
{
    ["Gateway:BaseUrl"] = "https://gw.internal:8443"
});

Console.WriteLine("One setting, asked for by name:");
Console.WriteLine();
Console.WriteLine($"   Gateway:BaseUrl          {builder.Configuration["Gateway:BaseUrl"]}");
Console.WriteLine($"   Gateway:TimeoutSeconds   {builder.Configuration["Gateway:TimeoutSeconds"]}");
Console.WriteLine();
Console.WriteLine("   Where each value came from:");
Console.WriteLine();
Console.WriteLine("     appsettings.json              BaseUrl = https://gw.example/v1");
Console.WriteLine("                                   TimeoutSeconds = 30");
Console.WriteLine("     appsettings.Production.json   TimeoutSeconds = 5");
Console.WriteLine("     the in-memory source          BaseUrl = https://gw.internal:8443");
Console.WriteLine();
Console.WriteLine("   THE RULE IS ONE SENTENCE: THE LAST SOURCE THAT HAS A KEY WINS.");
Console.WriteLine();
Console.WriteLine("   Configuration is not a file. It is a LIST OF SOURCES read in order and");
Console.WriteLine("   flattened into one dictionary of string keys and string values, where a");
Console.WriteLine("   later source overwrites an earlier one for the keys it happens to have.");
Console.WriteLine();
Console.WriteLine("   Nothing merges at the object level. TimeoutSeconds survived from the base");
Console.WriteLine("   file not because the two Gateway objects were combined, but because the");
Console.WriteLine("   key 'Gateway:TimeoutSeconds' appears in one source and the key");
Console.WriteLine("   'Gateway:BaseUrl' in another.");
Console.WriteLine();

var app = builder.Build();

app.MapGet("/config", (IConfiguration configuration) =&gt; Results.Ok(new
{
    baseUrl = configuration["Gateway:BaseUrl"],
    timeout = configuration.GetValue&lt;int&gt;("Gateway:TimeoutSeconds")
}));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine($"   the same values inside the app   {await http.GetStringAsync("/config")}");

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   The colon separates levels. 'Gateway:BaseUrl' is the BaseUrl key inside");
Console.WriteLine("   the Gateway section, and the nesting in the JSON file is a convenience");
Console.WriteLine("   for writing it - the configuration system itself is flat.");

Directory.Delete(root, recursive: true);</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   Gateway:BaseUrl          https://gw.internal:8443
   Gateway:TimeoutSeconds   5

   Where each value came from:

     appsettings.json              BaseUrl = https://gw.example/v1
                                   TimeoutSeconds = 30
     appsettings.Production.json   TimeoutSeconds = 5
     the in-memory source          BaseUrl = https://gw.internal:8443</code></pre>

  <p><strong>The rule is one sentence: the last source that has a key wins.</strong></p>

  <p>Configuration is not a file. It is a list of sources, read in order and flattened into one
  dictionary of string keys and string values, where a later source overwrites an earlier one for the
  keys it happens to have.</p>

  <p>Nothing merges at the object level. <code>TimeoutSeconds</code> survived from the base file not
  because two <code>Gateway</code> objects were combined, but because the key
  <code>Gateway:TimeoutSeconds</code> appears in one source and <code>Gateway:BaseUrl</code> in
  another. That distinction is invisible until it matters, and then it matters a great deal — see
  arrays, below.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>Configuration works like a stack of transparencies on an overhead projector. The bottom sheet has
  the defaults; each sheet above overwrites the parts of the picture it covers; you read whatever is
  visible from above.</p>

  <p><strong>This is an analogy and it misleads about the unit of overwriting.</strong> A transparency
  covers an area. A configuration source covers individual keys, and knows nothing about the shapes
  they form. An upper sheet that draws one item of a three-item list does not replace the list — it
  replaces the first item and leaves the other two showing.</p>
</section>

<section id="providers">
  <h2>The default chain, and the order it is in</h2>

  <pre data-lang="console" data-title="01-providers-and-precedence.cs output"><code>   in the order they are read, first to last:

    1. Memory
    2. EnvironmentVariables     prefix ASPNETCORE_
    3. EnvironmentVariables     prefix DOTNET_
    4. CommandLine
    5. Memory
    6. Json                     appsettings.json
    7. Json                     appsettings.Production.json
    8. Json                     01-providers-and-precedence.settings.json
    9. Json                     01-providers-and-precedence.settings.Production.json
   10. EnvironmentVariables     (no prefix)
   11. CommandLine
   12. Chained</code></pre>

  <p>Two entries there are not in a normal application: the pair named after the <code>.cs</code> file
  are added because this ran as a file-based app. Note also what is <em>absent</em> — there is no
  user-secrets provider, because this ran as Production and secrets are added in Development only.</p>

  <p>Read the list as a priority order, lowest first. The shape of it, ignoring the entries that only
  matter to the host:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Source</th><th>Where it lives</th><th>Beats</th></tr></thead>
      <tbody>
        <tr><td><code>appsettings.json</code></td><td>Committed — the defaults</td><td>nothing</td></tr>
        <tr><td><code>appsettings.{Environment}.json</code></td><td>Committed — the per-environment bits</td>
            <td>the base file</td></tr>
        <tr><td>User secrets</td><td>Your machine, Development only, never committed</td>
            <td>both files</td></tr>
        <tr><td>Environment variables</td><td>What the platform sets</td><td>all files</td></tr>
        <tr><td>Command line arguments</td><td>What you type</td><td>everything</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>That order is a design, and it reads outward from the repository:</strong> the further a
  value is from source control, the more authority it has. Committed defaults lose to the machine,
  which loses to the operator.</p>

  <pre data-lang="console" data-title="01-providers-and-precedence.cs output"><code>   present in                                       resolves to
   ----------                                       -----------
   appsettings.json only                            base
   + appsettings.Production.json                    env-file
   + an environment variable                        environment-variable
   + a command line argument                        command-line
   environment variable, no env file                environment-variable</code></pre>

  <p>The last row matters for deployment: an environment variable wins whether or not an environment
  file exists, so a platform can override any committed value without the repository knowing that
  environment exists.</p>

  <h3>The name an environment variable must have</h3>

  <pre data-lang="console" data-title="01-providers-and-precedence.cs output"><code>   variable name              resolves Gateway:BaseUrl to
   -------------              ---------------------------
   Gateway__BaseUrl           set-via-Gateway__BaseUrl
   Gateway:BaseUrl            set-via-Gateway:BaseUrl
   GATEWAY__BASEURL           set-via-GATEWAY__BASEURL
   Gateway_BaseUrl            (from json)</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Double underscore is the separator, and it is the only spelling to use.</strong> A colon
    works on Windows and is not a legal character in an environment variable name on Linux, so a
    compose file or Kubernetes manifest that uses one is silently ignored there. Case does not
    matter.</p>
    <p>The fourth row is the one that costs people an afternoon. A single underscore is not a
    separator — it is part of the key name. <code>Gateway_BaseUrl</code> defines a top-level key called
    <code>Gateway_BaseUrl</code>, which nothing reads, and nothing warns. The application starts with
    the committed default while the operator looks at a variable that is definitely set.</p>
  </div>

  <h3>Case, and what absence does</h3>

  <pre data-lang="console" data-title="01-providers-and-precedence.cs output"><code>   how it is asked for                        what comes back
   -------------------                        ---------------
   ["Gateway:TimeoutSeconds"]                  30
   ["gateway:timeoutseconds"]                  30
   ["GATEWAY:TIMEOUTSECONDS"]                  30
   ["Gateway:Timeout"] (misspelt)              (null)
   GetValue&lt;int&gt;("Gateway:Timeout")            0
   GetValue&lt;int&gt;("Gateway:Timeout", 30)        30
   GetValue&lt;int&gt;("Gateway:TimeoutSeconds")     30
   GetValue&lt;int&gt;("Gateway:Retries")            InvalidOperationException</code></pre>

  <p>Two behaviours that pull in opposite directions. <strong>A key that is present and unparseable
  throws</strong> — the good case: the value is wrong, you are told, and the application fails.
  <strong>A key that is absent returns <code>default(T)</code> in silence</strong> —
  <code>GetValue&lt;int&gt;</code> on a misspelt key returns 0. Not null, not an error: zero, which is a
  perfectly good timeout, retry count or page size as far as the rest of your code can tell.</p>

  <p><strong>The asymmetry is the whole problem: a wrong value is loud and a missing value is silent,
  and a typo produces the silent one.</strong></p>
</section>

<section id="binding">
  <h2>Binding, and what it ignores</h2>

  <p class="define"><span class="define__term">Binding</span> Copying configuration values into the
  properties of a class, matching property names to keys case-insensitively and converting each string
  to the property's type.</p>

  <p class="define"><span class="define__term">Options class</span> A plain class with settable
  properties, written to hold one section's values. It has no base class and no attributes — it is an
  ordinary type, which is what makes the rest of your code testable without configuration.</p>

  <p class="define"><span class="define__term">Default value</span> What a property holds when nothing
  set it. For a class with no initialiser that is <code>default(T)</code>: zero for a number, false for
  a bool, null for a reference. None of these is distinguishable from a value somebody chose.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-binding.cs — three ways to read one section"><code>string? byKey = configuration["Gateway:BaseUrl"];
int byValue = configuration.GetValue&lt;int&gt;("Gateway:TimeoutSeconds");
GatewayOptions? bound = configuration.GetSection("Gateway").Get&lt;GatewayOptions&gt;();</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - keys as strings, everywhere"><code>public sealed class PaymentService(IConfiguration configuration)
{
    public async Task&lt;string&gt; CaptureAsync(string id)
    {
        // Three chances to misspell a key, in one method, with no compiler
        // and no test able to see any of them. And every class that does this
        // is a class you cannot construct in a test without configuration.
        var client = new HttpClient
        {
            BaseAddress = new Uri(configuration["Gateway:BaseUrl"]!),
            Timeout = TimeSpan.FromSeconds(configuration.GetValue&lt;int&gt;("Gateway:TimeoutSeconds"))
        };

        client.DefaultRequestHeaders.Add("X-Api-Key", configuration["Gateway:ApiKey"]);

        return await client.GetStringAsync($"/capture/{id}");
    }
}</code></pre>

  <p>The third is the one to use: the key names appear once, in the class, rather than at every place
  that reads them; the types are declared, so a value that will not convert fails at binding rather than
  at a call site; and the rest of your code takes <code>GatewayOptions</code> and never sees
  <code>IConfiguration</code>, which makes it testable without configuration at all.</p>

  <pre data-lang="console" data-title="02-binding.cs output"><code>   configuration says                    bound object
   ------------------                    ------------
   everything present                    BaseUrl=https://a, Timeout=5, Attempts=3, Enabled=True
   TimeoutSeconds absent                 BaseUrl=https://a, Timeout=0, Attempts=3, Enabled=True
   TimeoutSecond (misspelt)              BaseUrl=https://a, Timeout=0, Attempts=3, Enabled=True
   an extra key                          BaseUrl=https://a, Timeout=5, Attempts=3, Enabled=True
   no Gateway section at all             (null)</code></pre>

  <p><strong>Every row succeeded.</strong> Nothing threw, nothing was logged, and three of the five
  produced an object that is wrong or absent.</p>

  <ul>
    <li><strong>A key with no property is ignored.</strong> The extra key was set by somebody who
    believed it did something. It does nothing, and the file looks exactly as intended.</li>
    <li><strong>A property with no key keeps whatever the class initialised it to</strong>, which for an
    <code>int</code> with no initialiser is zero. A timeout of 0 and a retry count of 0 are both
    valid-looking numbers.</li>
  </ul>

  <p>A missing section is the one case where the three binding APIs disagree, which is worth measuring
  rather than assuming:</p>

  <pre data-lang="console" data-title="02-binding.cs output"><code>   Get&lt;GatewayOptions&gt;()        null
   Bind(existing instance)      BaseUrl=https://default, Timeout=30, Attempts=0, Enabled=False
   Configure + IOptions.Value   BaseUrl=, Timeout=0, Attempts=0, Enabled=False</code></pre>

  <p><code>Get</code> returns null. <code>Bind</code> leaves the instance alone, so whatever you
  constructed it with survives. <code>Configure</code> gives you a fresh object of type defaults. Only
  the middle one is safe, and only because the caller supplied defaults first; the third is the one
  applications actually use, and it makes "the section is missing" indistinguishable from "the section
  says zero".</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - Get returns null for a missing section"><code>// If the Gateway section is absent, this is a NullReferenceException at the
// first property access - somewhere far from the configuration that caused it.
GatewayOptions options = configuration.GetSection("Gateway").Get&lt;GatewayOptions&gt;()!;

var client = new HttpClient { BaseAddress = new Uri(options.BaseUrl) };</code></pre>

  <p>Binding is a <strong>best-effort match, not a contract</strong>. It reports nothing because from
  its point of view nothing went wrong.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-binding.cs — one partial defence"><code>configuration.GetSection("Gateway").Get&lt;GatewayOptions&gt;(
    options =&gt; options.ErrorOnUnknownConfiguration = true);</code></pre>

  <pre data-lang="console" data-title="02-binding.cs output"><code>InvalidOperationException: 'ErrorOnUnknownConfiguration' was set on the provided
BinderOptions, but the following p...</code></pre>

  <p>That catches the extra key and says nothing about the missing one, which is the more damaging of
  the two. The other partial defence is to give every property a sensible default in the class, which
  turns silent breakage into silent-but-harmless. <strong>The real answer is validation at startup</strong>,
  which is the next module.</p>
</section>

<section id="arrays">
  <h2>Arrays, which do not behave like the rest of it</h2>

  <p class="define"><span class="define__term">Allow-list</span> A list of the things permitted, with
  everything else refused. Its security value comes entirely from being complete and short, which is why
  an entry appearing in it by accident is a defect rather than an inconvenience.</p>

  <p>A base file lists three allowed origins. An environment file lists one, intending to replace
  them:</p>

  <pre data-lang="console" data-title="02-binding.cs output"><code>   base file      a.example, b.example, c.example
   override file  only-this-one.example

   the application gets   https://only-this-one.example, https://b.example, https://c.example

   the raw keys, which explain it:

     Cors:AllowedOrigins:0   https://only-this-one.example
     Cors:AllowedOrigins:1   https://b.example
     Cors:AllowedOrigins:2   https://c.example</code></pre>

  <p><strong>An array is not a value.</strong> It is a set of keys named 0, 1, 2 — and the later source
  only has a key named 0. So it overwrote element 0 and left elements 1 and 2 in place.</p>

  <p>The result is a list that was never written down anywhere: one entry from the override and two from
  the base. For an allow-list that is a security defect — two origins nobody intended to permit in this
  environment are permitted, and the file that was supposed to restrict them reads correctly.</p>

  <p>The obvious attempt to fix it does not work either:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - nulls do not shorten a list"><code>// In appsettings.Production.json, trying to remove elements 1 and 2:
["Cors:AllowedOrigins:0"] = "https://only-this-one.example",
["Cors:AllowedOrigins:1"] = null,
["Cors:AllowedOrigins:2"] = null</code></pre>

  <pre data-lang="console" data-title="02-binding.cs output"><code>   origins after nulling 1 and 2   3 entries
     [0]  https://only-this-one.example
     [1]  (null)
     [2]  (null)</code></pre>

  <p>The list is still three long. A null value does not delete a key; it sets that element to null, and
  binding hands you a list containing nulls — worse than the original problem, because now every
  consumer has to cope with them.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>There is no way to shorten an array from a later source. What to do instead, in order:</p>
    <ol>
      <li>Do not override arrays across sources. Define each list once, and let the environment file own
      the whole list if it needs a different one.</li>
      <li>If it must be overridable, use a delimited string and split it — one key, one value, ordinary
      last-wins behaviour.</li>
      <li>Whatever you choose, log the resolved list at startup. For an allow-list that log line is a
      security control, not a diagnostic.</li>
    </ol>
  </div>
</section>

<section id="reloading">
  <h2>Reloading, and what does not reload</h2>

  <pre data-lang="csharp" data-net="10" data-title="02-binding.cs"><code>IConfigurationRoot configuration = new ConfigurationBuilder()
    .AddJsonFile(path, optional: false, reloadOnChange: true)
    .Build();

// Bound once, before the file changes.
GatewayOptions? boundEarly = configuration.GetSection("Gateway").Get&lt;GatewayOptions&gt;();</code></pre>

  <pre data-lang="console" data-title="02-binding.cs output"><code>   before   configuration value   5
            object bound earlier  5

   after    configuration value   30
            object bound earlier  5
            object bound again    30</code></pre>

  <p><strong>The configuration reloaded and the bound object did not</strong>, because they are
  different things. Binding copies values into a new object; nothing connects that object back to the
  source it came from. So <code>reloadOnChange</code> gives you a configuration that updates, and every
  class that took a bound options object keeps the values it was constructed with — which for a
  singleton is the values at startup, forever.</p>

  <p>That gap is exactly what <code>IOptionsSnapshot</code> and <code>IOptionsMonitor</code> exist to
  close, and it is the whole subject of the next module.</p>

  <p>Whether you want reloading at all is a real question, and the honest answer for most services is
  no: a value that changes under a running process is a value that differs between two requests for
  reasons no log records; the containerised deployment model restarts the process to change
  configuration anyway; and a partially-written file can be read mid-write, so a reload can observe a
  state that never existed as a whole. Reloading earns its place for feature flags and log levels —
  things you deliberately want to change without a restart. For a connection string or a timeout, a
  restart is the clearer mechanism.</p>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>Configuration for a service that runs in Development, Staging and Production, where the gateway
  URL differs in all three, the timeout is 30 seconds locally and 5 deployed, the API key must never be
  in the repository, and a missing gateway URL must stop the process rather than fall back:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>static async Task RunAsync(string environment, string? platformUrl, string? platformKey)
{
    string root = Directory.CreateTempSubdirectory("cfg-example").FullName;

    // Committed, and true in every environment. Note what is NOT here.
    File.WriteAllText(Path.Combine(root, "appsettings.json"), """
    {
      "Gateway": {
        "TimeoutSeconds": 5,
        "MaxAttempts": 3
      }
    }
    """);

    // Committed, and true only locally.
    File.WriteAllText(Path.Combine(root, "appsettings.Development.json"), """
    {
      "Gateway": {
        "BaseUrl": "https://localhost:9443",
        "TimeoutSeconds": 30
      }
    }
    """);

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = environment,
        ContentRootPath = root
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // Stands in for two things that never appear in a committed file: user
    // secrets in Development, and the platform's environment variables when
    // deployed. Both arrive as the same configuration keys, so no code below
    // this line knows which it got.
    var external = new Dictionary&lt;string, string?&gt;();

    if (environment == "Development")
    {
        external["Gateway:ApiKey"] = "dev-key-from-user-secrets";
    }

    if (platformUrl is not null)
    {
        external["Gateway:BaseUrl"] = platformUrl;
    }

    if (platformKey is not null)
    {
        external["Gateway:ApiKey"] = platformKey;
    }

    builder.Configuration.AddInMemoryCollection(external);

    // Bound ONCE. Everything downstream takes GatewayOptions, not IConfiguration.
    var options = builder.Configuration.GetSection("Gateway").Get&lt;GatewayOptions&gt;()
        ?? new GatewayOptions();

    // The check that turns a missing required value into a failed deployment.
    string? missing = Missing(options);

    if (missing is not null)
    {
        Console.WriteLine($"   {environment,-11}   {"(none)",-32}   {options.TimeoutSeconds,7}   " +
            $"{(string.IsNullOrEmpty(options.ApiKey) ? "no" : "yes"),-6}   REFUSED: {missing}");

        Directory.Delete(root, recursive: true);
        return;
    }</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   environment   BaseUrl                           Timeout   ApiKey   outcome
   -----------   -------                           -------   ------   -------
   Development   https://localhost:9443                  30   yes      started and serving
   Staging       https://gw-staging.internal:8443         5   yes      started and serving
   Production    https://gw.internal:8443                 5   yes      started and serving
   Production    (none)                                   5   yes      REFUSED: Gateway:BaseUrl is required</code></pre>

  <p>The last row is the incident from the opening, caught at startup instead of eleven days later.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Where</th><th>What is in it</th><th>Why there</th></tr></thead>
      <tbody>
        <tr><td><code>appsettings.json</code></td>
            <td><code>TimeoutSeconds: 5</code>, <code>MaxAttempts: 3</code>. <strong>No BaseUrl, no
            ApiKey.</strong></td>
            <td>Values with a correct production default. The absences are the design.</td></tr>
        <tr><td><code>appsettings.Development.json</code></td>
            <td><code>BaseUrl: localhost</code>, <code>TimeoutSeconds: 30</code></td>
            <td>The smallest possible diff — two keys, everything else inherited.</td></tr>
        <tr><td>User secrets</td><td><code>ApiKey</code></td>
            <td>Development only, on the machine, never committed.</td></tr>
        <tr><td>Environment variables</td><td><code>Gateway__BaseUrl</code>, <code>Gateway__ApiKey</code></td>
            <td>Set by the platform when deployed. Double underscore.</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>The load-bearing decision is the absence.</strong> <code>BaseUrl</code> has no committed
  value at all, so an environment that fails to set it has nothing to fall back to and refuses to start.
  Compare that with the incident, where a committed default existed and worked — which is precisely why
  the mistake survived eleven days. <strong>A default that works is a default that hides a missing
  setting.</strong></p>

  <p>The timeout goes the other way, and the asymmetry is deliberate: 5 seconds is a safe production
  default, so it is committed and only Development overrides it. A setting with a correct default belongs
  in the base file; a setting with no correct default belongs nowhere in the repository.</p>

  <h3>The startup log that would have ended the incident</h3>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs — the diagnostic"><code>// The last provider that has the key is the one that answered.
static string SourceOf(IConfigurationRoot configuration, string key)
{
    foreach (IConfigurationProvider provider in configuration.Providers.Reverse())
    {
        if (provider.TryGet(key, out _))
        {
            return provider.GetType().Name.Replace("ConfigurationProvider", "");
        }
    }

    return "(none)";
}</code></pre>

  <pre data-lang="console" data-title="03-production.cs output"><code>   what the startup log would have said on the day of the deploy:

     Gateway_BaseUrl           https://gw-v2.internal:8443         EnvironmentVariables
     Gateway:ApiKey            ***                                 Memory
     Gateway:BaseUrl           https://gw-v1.internal:8443         Memory

   and with the correct variable name:

     Gateway:ApiKey            ***                                 Memory
     Gateway:BaseUrl           https://gw-v2.internal:8443         EnvironmentVariables</code></pre>

  <p class="define"><span class="define__term">Redaction</span> Replacing a value with a placeholder
  before it is written somewhere it will be kept. A log store is a copy of everything you logged, held
  for months, readable by more people than the running process is — so anything secret must be redacted
  at the point of logging rather than filtered later.</p>

  <p>The orphan key sits in the first listing next to the unchanged one it was meant to replace. Three
  characters of that output — <code>gw-v1</code> — on the day of the deploy, next to a change whose
  whole purpose was to make it say <code>gw-v2</code>, would have ended it.</p>

  <p><strong>Note the provider column</strong>, which is the part worth stealing. Knowing the value is
  half the answer; knowing which source supplied it is the other half, and it turns "the variable is
  being ignored" from a hypothesis into a line of output.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Log your own sections, not everything. The environment variables provider contributes every
    variable the process has, so dumping all of configuration prints several hundred lines of machine
    environment and puts whatever is in it into your log store. <code>GetDebugView()</code> is built in
    and takes a redaction function, but it prints the whole tree — pair it with the same filtering, or
    call it on <code>GetSection("Gateway")</code> rather than the root.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>A single underscore in an environment variable</h3>

  <pre data-lang="yaml" data-bad="true" data-title="Wrong - defines a key nothing reads"><code>env:
  - name: Gateway_BaseUrl
    value: https://gw-v2.internal:8443</code></pre>

  <p>Measured above: the application keeps the committed default. It cannot fail, so it cannot warn.</p>

  <h3>A colon in a Linux environment variable</h3>

  <p><code>Gateway:BaseUrl</code> works on Windows, so it works on the machine of the person who wrote
  it — the strongest possible evidence that it is correct, and exactly the wrong evidence. A colon is
  not a legal character in an environment variable name on Linux, so the variable does not exist
  there.</p>

  <h3>Renaming a key on one side only</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the file says TimeoutInSeconds, the class says TimeoutSeconds"><code>public sealed class GatewayOptions
{
    public string BaseUrl { get; set; } = "";

    // No default, and no matching key after the file was tidied up.
    public int TimeoutSeconds { get; set; }
}</code></pre>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   the file says                bound object
   -------------                ------------
   TimeoutSeconds: 5            BaseUrl=https://a, Timeout=5, Attempts=0
   TimeoutInSeconds: 5          BaseUrl=https://a, Timeout=0, Attempts=0</code></pre>

  <p>Both halves are silent. The property with no key takes zero; the key with no property is ignored.
  A zero timeout is a valid number, so nothing downstream objects either — every layer behaves
  correctly on a value that was never intended to exist.</p>

  <h3>Overriding one element of an array</h3>

  <p>Measured above: production ends up allowing a developer's laptop origin and staging, from a file
  that lists only the production front end.</p>

  <h3>Committing a working default for a per-environment value</h3>

  <p>This is the one that turned a five-minute mistake into an eleven-day one. A default that works
  cannot fail locally, cannot fail in staging, and cannot fail in production until something external
  changes.</p>

  <h3>Registering a secret provider as optional</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - starts with no secrets at all"><code>builder.Configuration.AddJsonFile("secrets.json", optional: true);</code></pre>

  <p>If the file is missing or the store is unreachable, startup succeeds and every secret takes its
  default. <code>optional: true</code> is right for a file that legitimately may not exist, and wrong
  for one your application cannot work without.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Likely cause</th><th>Check</th></tr></thead>
      <tbody>
        <tr><td>A setting you definitely set has no effect</td>
            <td>Single underscore, a colon on Linux, or a misspelt key</td>
            <td>Print the resolved value and its provider</td></tr>
        <tr><td>A numeric setting behaves as 0</td>
            <td>The key is absent or the property is misspelt; binding defaulted it</td>
            <td>Print the bound object, not the configuration</td></tr>
        <tr><td>A list has entries nobody configured here</td>
            <td>An array overridden element by element</td>
            <td>Enumerate <code>GetSection("X").GetChildren()</code></td></tr>
        <tr><td>Works locally, not deployed</td>
            <td>A Development-only source — user secrets, or an environment file that does not exist
            in that environment</td>
            <td>Compare the provider list in both</td></tr>
        <tr><td>A value changes and the application ignores it</td>
            <td>The object was bound at startup and copies do not reload</td>
            <td>The next module</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>Almost every configuration incident is the same question asked wrongly. During the incident above
    the channel asked "did the config change deploy?" and the answer was yes, eleven days ago, and here
    is the variable in the running pod. That answer is true, useless, and closed off the correct line of
    enquiry for two hours.</p>
    <p>The question that matters is not <em>is the variable set</em> but <strong>what value does the
    application have</strong>. Those are different questions, and only an application that logs its
    resolved configuration can answer the second one.</p>
    <p>So: print every key your application owns, its value with secrets redacted, and the provider that
    supplied it — at startup, every start. Then add a read-only endpoint that returns the non-secret
    part of it, so a smoke test can assert on the value rather than on the manifest.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"appsettings.Production.json replaces appsettings.json."</strong></p>
    <p>It overrides the keys it contains and nothing else. The two are flattened into one dictionary,
    key by key, so anything the environment file does not mention keeps the base value.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"An override file replaces a list."</strong></p>
    <p>Measured false, and it is a security problem rather than a tidiness one. An array is keys named
    0, 1, 2; a shorter list in a later source overwrites the elements it has and leaves the rest.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"If a setting is missing, I will get an error."</strong></p>
    <p>You get <code>default(T)</code> in silence. A present-but-unparseable value throws; an absent one
    does not, which means a typo — the commonest mistake — produces the quiet failure.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Environment variables are checked against something."</strong></p>
    <p>Nothing knows which keys your application reads, so nothing can tell you that
    <code>Gateway_BaseUrl</code> is not one of them. Every unrecognised key is indistinguishable from a
    key some other component might want.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Committing a sensible default for every setting is defensive."</strong></p>
    <p>For a value that must differ per environment it is the opposite: it guarantees that a failure to
    configure the environment produces a working application with the wrong behaviour, which is
    undetectable until something external changes.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"reloadOnChange means my application picks up changes."</strong></p>
    <p>It means <code>IConfiguration</code> picks them up. Objects bound from it are copies and keep
    their original values, so a singleton holding bound options keeps the startup values for the life of
    the process.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The incident cost an estate-wide payment outage and about two hours of investigation, from a
    change that was correct in intent, correct in value, reviewed by two people, and wrong by one
    character.</p>
    <p>What makes this class of bug expensive is not its frequency but its shape. A configuration
    mistake produces a <em>working</em> application, so every signal you have says the deployment
    succeeded: the process is up, the health check is green, the traffic is being served. The failure
    arrives later, triggered by something unrelated — an old endpoint switched off, a certificate
    rotated, a dependency that finally enforces a limit — and by then the change that caused it is
    eleven days back in the deployment history.</p>
    <p>The two mitigations in this module cost almost nothing. Nine lines log every resolved value with
    its source, which turns the entire class from invisible into obvious on the day. Two more lines
    refuse to start without a required value, which turns it from an incident into a failed deployment.
    Neither requires anybody to be careful.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A service starts failing every gateway call instantly rather than after five seconds. Nothing in
    the code changed. The file was renamed from <code>TimeoutSeconds</code> to
    <code>TimeoutInSeconds</code> during a tidy-up, and the options class was not.</p>
    <p>What does the application see, and why was there no error?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   the file says                bound object
   -------------                ------------
   TimeoutSeconds: 5            BaseUrl=https://a, Timeout=5, Attempts=0
   TimeoutInSeconds: 5          BaseUrl=https://a, Timeout=0, Attempts=0</code></pre>
        <p><code>TimeoutSeconds</code> has no matching key, so it keeps what the class gave it — and an
        <code>int</code> with no initialiser is 0. <code>TimeoutInSeconds</code> has no matching
        property, so it is ignored.</p>
        <p>Both halves are silent because binding is a best-effort match: from its point of view a key it
        does not recognise and a property nobody set are both ordinary.</p>
        <p>It fails instantly rather than never because a zero timeout is a valid number, so nothing
        downstream objected either.</p>
        <p>The cheapest defence is a default in the class — <code>public int TimeoutSeconds { get; set; }
        = 30;</code> — which converts a broken service into a working one with the wrong timeout. The
        real fix is validation at startup.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A developer sets <code>Gateway:BaseUrl</code> as an environment variable on Windows and it works.
    The same name in the Linux deployment manifest does nothing.</p>
    <p>Explain both halves, and give the name that works in both places.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   variable name        resolves Gateway:BaseUrl to
   -------------        ---------------------------
   Gateway:BaseUrl      https://set.example
   Gateway__BaseUrl     https://set.example
   Gateway_BaseUrl      https://committed-default.example</code></pre>
        <p>The colon form works on Windows, where a colon is a legal character in an environment variable
        name. On Linux it is not, so the variable cannot exist and the manifest sets nothing.</p>
        <p><code>Gateway__BaseUrl</code> is the answer: double underscore is translated to the colon
        separator by the provider, so it works everywhere.</p>
        <p>The third row is the trap this exercise is really about. A single underscore is legal
        everywhere and means nothing to the provider — it defines a top-level key called
        <code>Gateway_BaseUrl</code>. It cannot fail, so it cannot warn.</p>
        <p>What makes this shape of bug expensive is that it works on the machine of the person who wrote
        it, which is the strongest possible evidence that it is correct, and exactly the wrong
        evidence.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium</span></div>
    <p><code>appsettings.json</code> lists three CORS origins for development.
    <code>appsettings.Production.json</code> lists one, the production front end. Production accepts
    requests from all three.</p>
    <p>Why, and what would you change?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   what production actually allows:

     [0]  https://app.ledger.example
     [1]  https://dev.ledger.example
     [2]  https://staging.ledger.example</code></pre>
        <p>An array is stored as keys named 0, 1, 2. The production file has a key named 0 and no others,
        so it overwrote element 0 and left elements 1 and 2 exactly as the base file set them.</p>
        <p>Production is accepting requests from a developer's laptop origin and from staging, and the
        file that was supposed to restrict it reads correctly.</p>
        <p>The same key-by-key merge that makes overrides useful for scalars makes them dangerous for
        lists. Nothing special is happening — arrays are not a unit that configuration knows
        about.</p>
        <p>What to change: move the list out of the base file entirely so each environment owns the whole
        list; or make it one key, a delimited string that later sources replace wholesale. Either way,
        log the resolved list at startup — for an allow-list that log line is a security control.</p>
        <p>And note what does not work: setting elements 1 and 2 to null. That does not shorten the list,
        it puts nulls in it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>Design the configuration for a service that runs in Development, Staging and Production, where
    the gateway URL differs in all three, the timeout is 30 seconds locally and 5 deployed, the API key
    must never be in the repository, and a missing gateway URL must stop the process rather than fall
    back.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   environment   BaseUrl                        Timeout   ApiKey   startup
   -----------   -------                        -------   ------   -------
   Development   https://localhost:9443              30   yes      started
   Staging       https://gw-staging.internal          5   yes      started
   Production    https://gw.internal:8443             5   yes      started
   Production    (none)                               5   yes      REFUSED: Gateway:BaseUrl is required</code></pre>
        <p>Four layers, each answering one requirement:</p>
        <ul>
          <li><code>appsettings.json</code> — <code>TimeoutSeconds: 5</code>,
          <code>MaxAttempts: 3</code>, and <strong>no BaseUrl and no ApiKey</strong>;</li>
          <li><code>appsettings.Development.json</code> — <code>BaseUrl: localhost</code>,
          <code>TimeoutSeconds: 30</code>;</li>
          <li>user secrets, Development only — <code>ApiKey</code>;</li>
          <li>environment variables, deployed — <code>Gateway__BaseUrl</code> and
          <code>Gateway__ApiKey</code>.</li>
        </ul>
        <p><strong>The load-bearing decision is the absence.</strong> <code>BaseUrl</code> has no
        committed value, so an environment that fails to set it has nothing to fall back to and the last
        row refuses to start. Compare that with the incident, where a committed default existed and
        worked — which is precisely why the mistake survived eleven days. A default that works is a
        default that hides a missing setting.</p>
        <p>The timeout goes the other way, deliberately: 5 seconds is a safe production default, so it is
        committed and only Development overrides it. A setting with a correct default belongs in the base
        file; a setting with no correct default belongs nowhere in the repository.</p>
        <p>The secret is never in a committed file — user secrets on a developer machine, the platform's
        store when deployed. Both arrive through the same configuration keys, so no code knows the
        difference.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Two sources both define <code>Gateway:BaseUrl</code>. Which value does the application
      get?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The one from the source added last. Configuration is a list of
        sources flattened into one dictionary, key by key, and the last source that has a key
        wins.</p></div>
      </details></li>

    <li><p>What must an environment variable be called to set <code>Gateway:BaseUrl</code>, and why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>Gateway__BaseUrl</code>. A double underscore is translated to
        the colon separator; a single underscore is part of the key name; a colon is not a legal variable
        name on Linux.</p></div>
      </details></li>

    <li><p>What does <code>GetValue&lt;int&gt;</code> return for a key that does not exist?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>0 — <code>default(int)</code> — with no error. A present but
        unparseable value throws; an absent one is silent.</p></div>
      </details></li>

    <li><p>A base file lists three items and an environment file lists one. What does the application
      get?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Three items: the override's single entry in position 0, and the base
        file's entries in positions 1 and 2. Arrays are keys named 0, 1, 2 and merge element by
        element.</p></div>
      </details></li>

    <li><p>Which settings belong in <code>appsettings.json</code>, and which belong in no committed file
      at all?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A setting with a correct default belongs in the base file. A setting
        that must differ per environment, or that is secret, belongs in no committed file — so a missing
        one has nothing to fall back to.</p></div>
      </details></li>

    <li><p>Why does <code>reloadOnChange</code> not update a bound options object?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Binding copies values into a new object. Nothing connects that copy
        back to the configuration it came from, so it keeps the values it was constructed with.</p></div>
      </details></li>

    <li><p>During an incident, what is the wrong question to ask about a configuration value, and what is
      the right one?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Wrong: "is the variable set?" Right: "what value does the
        application have, and which provider gave it that?" Only the second distinguishes a variable that
        is set from a variable that is read.</p></div>
      </details></li>

    <li><p>Why is dumping the whole of configuration at startup a bad idea?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The environment variables provider contributes every variable the
        process has, so it prints hundreds of lines of machine environment and puts whatever is in them
        into your log store. Filter to the sections your application owns.</p></div>
      </details></li>
  </ol>
</section>
`
});
