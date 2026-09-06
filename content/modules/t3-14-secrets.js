CSPREP.module({
  id: "t3-14-secrets",
  minutes: 55,
  updated: "2026-09-04",
  summary: "A gateway credential rotated exactly as the runbook said, and a fleet that kept presenting the old one - because a configuration provider loads once and IOptionsMonitor, measured, does not help. Where secrets come from in each environment, the six ways they escape, and two findings worth the module on their own: a redaction predicate on context.Key silently misses every connection string, and only two of eight common parsers put the value they were given into the exception message.",
  terms: ["secret", "credential", "disclosure", "rotation", "user secrets", "secret store",
    "key vault", "managed identity", "optional provider", "redaction", "fingerprint",
    "GetDebugView", "context.Path", "overlapping validity", "double dash"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger's gateway credential is rotated every ninety days. The runbook is three steps and has
  worked twice before:</p>

  <ol>
    <li>create the new key with the gateway provider;</li>
    <li>write it into the secret store;</li>
    <li>revoke the old key.</li>
  </ol>

  <p>At 14:00 somebody follows all three. At 14:00 and about four seconds, every payment in the estate
  starts failing with 401.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   requests before the rotation   10 of 10 accepted
   requests after the rotation    0 of 10 accepted</code></pre>

  <p>The secret store has the new value. Every instance is presenting the old one.</p>

  <p><strong>The store was updated and the process was not asked again.</strong> A configuration
  provider loads once, at startup: the vault provider fetched its secrets when the application began and
  has not spoken to the vault since. The value in the process is the value that existed when the process
  started, and nothing in the design ever intended otherwise.</p>

  <p><strong>The runbook is the defect, not the code.</strong> Step 3 assumes the fleet is using the new
  key by the time it runs, and nothing in steps 1 or 2 makes that true. It worked twice before because
  both earlier rotations happened during a deployment window, so the processes restarted for unrelated
  reasons between step 2 and step 3.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every value, count and outcome in this module was produced by running the programs shown, on
    .NET 10, and pasted in unedited. Every credential in them is invented and grants access to
    nothing.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What a secret is, and what makes it different</h2>

  <p class="define"><span class="define__term">Secret</span> A configuration value that grants access to
  something — an API key, a connection string containing a password, a signing key, a certificate's
  private half. The distinguishing property is not sensitivity in the abstract but that possession of it
  is sufficient to act.</p>

  <p class="define"><span class="define__term">Disclosure</span> The value reaching somewhere it should
  not: a repository, a log store, an error response, an image layer. Disclosure is not undone by
  deleting the copy, because you cannot know who read it first.</p>

  <p class="define"><span class="define__term">API key</span> A single opaque string that both names and
  authenticates a caller. It is the simplest kind of credential and the least forgiving: there is no
  password to change separately, no expiry to lean on, and anybody holding the string is you.</p>

  <p class="define"><span class="define__term">Connection string</span> One string carrying everything
  needed to reach a database — host, database name, and usually a password. It is a secret that does not
  look like one, because most of it is harmless.</p>

  <p class="define"><span class="define__term">Log store</span> Wherever your log lines end up and stay:
  a search index, a bucket, a managed service. It is readable by more people than the running process is,
  retained for months, and often replicated — which is what makes writing a credential there a
  disclosure rather than a mistake you can tidy up.</p>

  <p class="define"><span class="define__term">Rotation</span> Replacing a credential with a new one and
  invalidating the old. It is the only remedy for disclosure, and the routine practice that makes that
  remedy cheap when you need it.</p>

  <p>The mechanism is the least interesting part, because there is not one:</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>static async Task RunAsync(string environment, Source source)
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = environment
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // Committed, and true everywhere. The key name is here; the value is not.
    builder.Configuration.AddInMemoryCollection(new Dictionary&lt;string, string?&gt;
    {
        ["Gateway:BaseUrl"] = "https://gw.internal:8443"
    });

    // Whichever source this environment uses. In a real application these are
    // AddUserSecrets&lt;Program&gt;() and AddEnvironmentVariables(), both of which
    // CreateBuilder already registers - this stands in for them so the file
    // needs no machine setup.
    switch (source)
    {
        case Source.UserSecrets:
            builder.Configuration.AddInMemoryCollection(new Dictionary&lt;string, string?&gt;
            {
                ["Gateway:ApiKey"] = "sk-dev-0000000000000000"
            });
            break;

        case Source.EnvironmentVariable:
            builder.Configuration.AddInMemoryCollection(new Dictionary&lt;string, string?&gt;
            {
                ["Gateway:ApiKey"] = $"sk-{environment.ToLowerInvariant()}-1111111111111111"
            });
            break;
    }

    builder.Services.AddOptions&lt;GatewayOptions&gt;()
        .Bind(builder.Configuration.GetSection("Gateway"))
        .Validate(o =&gt; !string.IsNullOrWhiteSpace(o.ApiKey), "Gateway:ApiKey is required")
        .ValidateOnStart();

    WebApplication app = builder.Build();

    app.MapGet("/whoami", (IOptions&lt;GatewayOptions&gt; gateway) =&gt; Results.Ok(new
    {
        // Never the value. Enough to tell one credential from another.
        key = Fingerprint(gateway.Value.ApiKey)</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   environment   where the value came from        the application sees
   -----------   ------------------------        --------------------
   Development   user secrets                    {"key":"sk-dev-... sha256:3674e846"}
   Staging       an environment variable         {"key":"sk-stag... sha256:b834ca95"}
   Production    an environment variable         {"key":"sk-prod... sha256:e28f51ec"}
   Production    nothing                         REFUSED: Gateway:ApiKey is required</code></pre>

  <p>The code is identical in all four. The key is <code>Gateway:ApiKey</code> every time, and a
  different provider happens to be the one that has it.</p>

  <p><strong>A secret is an ordinary configuration value that comes from an extraordinary place.</strong>
  The key name is committed; the value never is. Because secrets arrive through the same mechanism as
  every other setting, no code has to be written twice and there is no "secret handling" layer to get
  wrong.</p>

  <p>Read the last row. With no source supplying it, the application does not start — the previous
  module's validation applied to a credential, because the alternative is a service that starts and
  fails every call.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>Handling a secret is like handling a key to a building. You do not photocopy it, you do not leave it
  in a drawer that everybody opens, and when somebody leaves you change the lock rather than asking for
  the key back.</p>

  <p><strong>This is an analogy and it misleads about copying.</strong> A physical key that is lost is
  gone from your hand, so you notice. A credential that leaks is <em>still working perfectly</em> — every
  copy functions, nothing changes, and there is no observable difference between a secret that only you
  have and one that is in a log store a hundred people can read. That is why the practices here are
  preventative rather than reactive: there is nothing to react to.</p>
</section>

<section id="how-they-escape">
  <h2>How they escape</h2>

  <h3>The startup log that helped with the last incident</h3>

  <p>The configuration module's advice was to log the resolved settings at startup with their sources.
  Done without care, this is the most reliable way to put a credential into a log store.</p>

  <pre data-lang="console" data-title="01-how-they-escape.cs output"><code>   GetDebugView() with no redaction:

     ConnectionStrings:
       Ledger=Server=db.internal;Database=ledger;Password=hunter2 (MemoryConfigurationProvider)
     Gateway:
       ApiKey=sk-live-1111111111111111 (MemoryConfigurationProvider)
       BaseUrl=https://gw.internal:8443 (MemoryConfigurationProvider)</code></pre>

  <p>The overload that takes a redaction function exists because this is the expected mistake. Here it
  is, with the obvious predicate:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - redacts on the leaf, not the path"><code>string view = configuration.GetDebugView(context =&gt;
    IsSensitive(context.Key) ? "***" : context.Value ?? "");</code></pre>

  <pre data-lang="console" data-title="01-how-they-escape.cs output"><code>     ConnectionStrings:
       Ledger=Server=db.internal;Database=ledger;Password=hunter2 (MemoryConfigurationProvider)
     Gateway:
       ApiKey=*** (MemoryConfigurationProvider)
       BaseUrl=https://gw.internal:8443 (MemoryConfigurationProvider)</code></pre>

  <p><strong>The connection string is still there</strong>, and the predicate does match the string
  "ConnectionStrings".</p>

  <p><code>context.Key</code> is the leaf, not the path. For the entry whose full path is
  <code>ConnectionStrings:Ledger</code>, <code>Key</code> is <code>Ledger</code> — which contains none of
  the words a sensible predicate looks for.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-how-they-escape.cs — the fix"><code>string view = configuration.GetDebugView(context =&gt;
    IsSensitive(context.Path) ? "***" : context.Value ?? "");</code></pre>

  <pre data-lang="console" data-title="01-how-they-escape.cs output"><code>     ConnectionStrings:
       Ledger=*** (MemoryConfigurationProvider)
     Gateway:
       ApiKey=*** (MemoryConfigurationProvider)
       BaseUrl=https://gw.internal:8443 (MemoryConfigurationProvider)</code></pre>

  <p>The failure above is exactly the shape this module is about: a redaction that was written, reviewed,
  and covers the key whose <em>name</em> ends in a sensitive word while missing the one whose
  <em>section</em> is named for it. Connection strings are the common casualty, because the convention
  puts the dangerous word in the section name and a harmless database name in the leaf.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>A log store is a copy of everything you logged, kept for months and readable by more people than
    the running process is. Anything written there is disclosed to all of them, and deleting it later
    does not undo that — the credential must be rotated instead.</p>
    <p>Also: filter what you dump. The environment variables provider contributes every variable the
    process has, so an unfiltered dump prints hundreds of lines of machine environment into your logs.</p>
  </div>

  <h3>The exception that quotes what it was given</h3>

  <p>A credential is a string, and strings get passed to things that parse them. When parsing fails,
  some of those things put the input into the exception message. Eight ways to fail on a value carrying
  a secret:</p>

  <pre data-lang="console" data-title="01-how-they-escape.cs output"><code>   what was called                   the message contains it   exception
   ---------------                   -----------------------   ---------
   new Uri(malformed)                no                        UriFormatException
   int.Parse(secret)                 YES                       FormatException
   Guid.Parse(secret)                no                        FormatException
   Convert.FromBase64String          no                        FormatException
   DateTime.Parse(secret)            YES                       FormatException
   JsonDocument.Parse                no                        JsonReaderException
   XElement.Parse                    no                        XmlException
   DbConnectionStringBuilder         no                        ArgumentException</code></pre>

  <p><strong>Two out of eight, and there is no principle that predicts which two.</strong> Look at the
  exception column: three rows throw <code>FormatException</code> and only two of those three include
  the value. The type tells you nothing; the behaviour is decided separately inside each parser.</p>

  <p>The lesson is not a list of safe APIs. You cannot audit this — the set of exception messages your
  process can produce includes every library you depend on and every version you will ever upgrade to.
  The defences that do not require the list:</p>

  <ul>
    <li><strong>Never put a credential in a URL.</strong> Put it in a header. A URL reaches access logs,
    proxy logs, browser history and referrer headers without anybody logging anything.</li>
    <li><strong>Validate and parse secrets at startup</strong>, not per request, so a malformed
    credential stops the process once rather than filling request logs.</li>
    <li><strong>Keep the secret in one object and pass that</strong>, not the raw string.</li>
  </ul>

  <h3>The helpful log line</h3>

  <pre data-lang="console" data-title="01-how-they-escape.cs output"><code>     1. Calling gateway with settings { BaseUrl = https://gw.internal:8443,
        ApiKey = sk-live-1111111111111111 }
     2. Calling https://gw.internal:8443/capture?api_key=sk-live-1111111111111111
     3. Calling https://gw.internal:8443/capture with key sk-live... sha256:97658d72</code></pre>

  <p>The first two leak and the third does not, and the difference is not carefulness — it is what was
  passed in. Line 1 is the one people do not expect: logging an options object calls
  <code>ToString</code> on it, and a record or anonymous type prints every property. Structured logging
  makes it worse, because a destructured object lands in the store as searchable fields.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a record prints every property"><code>// The generated ToString includes ApiKey, so any interpolation leaks it.
public sealed record GatewaySettings(string BaseUrl, string ApiKey);

logger.LogInformation("Calling gateway with settings {Options}", settings);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs — the override that fixes it"><code>public sealed class GatewayOptions
{
    [Required]
    [Url]
    public string BaseUrl { get; set; } = "";

    [Required]
    public string ApiKey { get; set; } = "";

    // The one override that makes this type safe to interpolate into any
    // message anybody writes later.
    public override string ToString() =&gt; $"BaseUrl={BaseUrl}, ApiKey=***";
}</code></pre>

  <p>That moves the control from every call site to one declaration — the same move as validating
  options at startup rather than checking values everywhere. It does not cover serialisation, which
  ignores <code>ToString</code>; the honest summary is that no single mechanism covers every path, which
  is the argument for logging specific fields rather than objects.</p>

  <h3>The developer exception page, one more time</h3>

  <pre data-lang="console" data-title="01-how-they-escape.cs output"><code>   environment   status   the secret appears in the response
   -----------   ------   ---------------------------------
   Development      500   YES
   Production       500   no</code></pre>

  <p>The ProblemDetails module's finding, restated because it is a secrets problem as much as an
  error-handling one: the developer exception page returns the exception message, exception messages
  contain whatever a driver put in them, and drivers put connection strings in them. <strong>One
  environment variable set wrongly publishes your database password to anyone who can make a request
  that fails.</strong></p>

</section>

<section id="the-repository">
  <h2>The two no C# program can demonstrate</h2>

  <pre data-lang="json" data-bad="true" data-title="Wrong - appsettings.json is committed"><code>{
  "Gateway": {
    "BaseUrl": "https://gw.internal:8443",
    "ApiKey": "sk-live-1111111111111111"
  },
  "ConnectionStrings": {
    "Ledger": "Server=db.internal;Database=ledger;User Id=app;Password=hunter2"
  }
}</code></pre>

  <p>A credential committed to a repository is disclosed to everybody with read access, and stays
  disclosed after it is deleted, because the commit remains in the history and in every clone anybody has
  taken. <strong>The only fix is rotation</strong>, and rewriting history does not help because the
  clones are already made.</p>

  <p class="define"><span class="define__term">Image layer</span> One step of a container build, stored
  and shipped separately. A file written in an early layer stays in the image even if a later layer
  deletes it, because the deletion is another layer on top rather than an edit.</p>

  <p class="define"><span class="define__term">Secret scanner</span> A tool that searches a commit, or a
  whole history, for strings shaped like credentials. It is the backstop for the case where somebody
  pastes a value into a file that is normally safe.</p>

  <pre data-lang="bash" data-bad="true" data-title="Wrong - the value is in the image metadata"><code># The build argument is recorded in the image history, readable with
# docker history, by anybody who can pull the image.
docker build --build-arg API_KEY=sk-live-1111111111111111 -t ledger-api .

# And this writes it into a layer, where deleting it later does not remove it.
RUN echo "$API_KEY" &gt; /app/key.txt &amp;&amp; ./configure.sh &amp;&amp; rm /app/key.txt</code></pre>

  <p>The same applies to build artefacts: a secret passed as a build argument is recorded in image
  metadata, one echoed by a build step is in the CI log, one written into a layer is in the image even if
  a later layer deletes the file. The rule that covers all of it: <strong>secrets are supplied at run
  time, not build time</strong> — which is also what lets the same image be promoted from staging to
  production rather than rebuilt.</p>
</section>

<section id="sources">
  <h2>Where the value comes from</h2>

  <p class="define"><span class="define__term">Environment variable</span> A name and value the operating
  system gives a process when it starts. Every deployment platform can set them, which is why they are the
  lowest common denominator for supplying a secret to a container.</p>

  <p class="define"><span class="define__term">User secrets</span> A JSON file stored outside the
  repository, in your own user profile, added to configuration in Development only. It exists so a
  developer can hold a real credential locally with no chance of committing one.</p>

  <pre data-lang="xml" data-title="the project file — the id is committed, the values are not"><code>&lt;UserSecretsId&gt;a1b2c3d4-0000-0000-0000-000000000000&lt;/UserSecretsId&gt;</code></pre>

  <pre data-lang="console" data-title="02-sources.cs output"><code>   %APPDATA%\Microsoft\UserSecrets\&lt;UserSecretsId&gt;\secrets.json</code></pre>

  <p>Four things to know. They are <strong>Development only</strong> — the provider is added when the
  environment is Development and not otherwise, so a deployed service never reads them however the file
  got onto the machine. They are <strong>not encrypted</strong>: plain text with file-system permissions
  and nothing else, so they keep secrets out of the repository and do not protect them from anybody on
  the machine. They are per project and per user. And <code>dotnet user-secrets list</code> prints them,
  so they are not a place for anything a developer should not see.</p>

  <h3>A secret store</h3>

  <p>Azure Key Vault, AWS Secrets Manager, HashiCorp Vault and the rest all plug in the same way: as a
  configuration provider that fetches values at startup and presents them as ordinary keys.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-sources.cs — the shape of every vault provider"><code>public sealed class VaultConfigurationProvider(FakeSecretStore store, bool optional)
    : ConfigurationProvider
{
    public override void Load()
    {
        try
        {
            foreach ((string name, string value) in store.Fetch())
            {
                // The store's naming convention translated into configuration's.
                Data[name.Replace("--", ":")] = value;
            }
        }
        catch (Exception) when (optional)
        {
            // Exactly what optional: true means, and it is worth seeing written
            // down: the failure is caught and discarded.
        }
    }
}</code></pre>

  <p>Two details matter more than the provider. <strong>The name mapping:</strong> most stores do not
  allow a colon in a secret name, so the convention is a double dash — <code>Gateway--ApiKey</code>
  becomes <code>Gateway:ApiKey</code>. It is the same problem as the double underscore in environment
  variables, with the same failure mode: a name that is nearly right produces a key nothing reads.</p>

  <p><strong>The fetch happens once, at startup.</strong> A provider is asked to <code>Load</code>, it
  produces a dictionary, and the store is not consulted again. That is why rotation is a separate
  problem.</p>

  <p class="define"><span class="define__term">Managed identity</span> An identity the platform gives the
  running process — an instance role, a workload identity, a mounted token — so that it can authenticate
  to other services without holding a credential anybody typed. It is the bootstrap that makes a secret
  store possible.</p>

  <p class="define"><span class="define__term">Least privilege</span> Granting an identity only the
  access it needs. For a secret store that means read access to the specific secrets one service uses,
  rather than to the vault, so that a compromised service discloses its own credentials and not
  everybody's.</p>

  <p>How the application authenticates to the vault is the question this design must answer and cannot
  answer with a secret. The answer everywhere is an identity supplied by the platform — a managed
  identity, an instance role, a workload identity token mounted into the container. The credential that
  proves who the process is comes from the infrastructure it runs on, and is the one credential that is
  never a string anybody types.</p>

  <h3>The word that lets it fail silently</h3>

  <pre data-lang="console" data-title="02-sources.cs output"><code>   registered as        startup      Gateway:ApiKey resolves to
   -------------        -------      --------------------------
   optional: true       started      (null)
   optional: false      REFUSED      InvalidOperationException: the secret store is unreachable</code></pre>

  <p><code>optional: true</code> means "start without the secrets". The application comes up, binds its
  port, passes its health check, and every call that needs a credential fails — one at a time, as
  requests arrive.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-sources.cs — register it where it exists"><code>if (!builder.Environment.IsDevelopment())
{
    builder.Configuration.AddAzureKeyVault(uri, credential);
}</code></pre>

  <p><strong>A provider that is present must be required.</strong> Deciding whether a source exists
  belongs at registration, where it is visible, not in an argument that turns a failure into a shrug.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Source</th><th>Environment</th><th>Protects against</th></tr></thead>
      <tbody>
        <tr><td>User secrets</td><td>Development</td><td>Committing to the repository</td></tr>
        <tr><td>Environment variables</td><td>Any deployed</td><td>Committing, and image layers</td></tr>
        <tr><td>A secret store</td><td>Any deployed</td>
            <td>Committing, image layers, and anybody with cluster access</td></tr>
      </tbody>
    </table>
  </div>

  <p>Read the third column as a ladder. <strong>Environment variables are visible to anybody who can
  describe the workload</strong>: a Kubernetes secret is base64, which is an encoding and not
  encryption, and <code>kubectl get secret -o yaml</code> shows the values to anybody with the
  permission. A secret store adds three things variables cannot — access that is per-identity and
  audited, a value that can change without redeploying anything, and one place to revoke from rather
  than every manifest carrying a copy.</p>

  <p>When are variables enough? A small service, a small team, and a credential you would rotate by
  editing one manifest. That is a legitimate position worth holding deliberately rather than by default,
  because what it gives up is the audit trail — and you discover you needed that only once.</p>
</section>

<section id="rotation">
  <h2>Rotation</h2>

  <p>The incident again, with three ways the application could have read the credential:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   how the credential is read              before   after   vault reads
   --------------------------              ------   -----   -----------
   IOptions                                  10/10     0/10   1
   IOptionsMonitor, provider loads once      10/10     0/10   1
   IOptionsMonitor, provider reloads         10/10    10/10   2</code></pre>

  <p><strong>The first two rows are identical, and that is the part worth stopping at.</strong>
  <code>IOptionsMonitor</code> did not help.</p>

  <p>The monitor re-reads <em>configuration</em>. Configuration was not reloaded, because the provider
  holding the secret never fetched again. A monitor over a provider that does not reload is a monitor
  over a constant.</p>

  <p>That is worth having measured, because the options module makes <code>IOptionsMonitor</code> look
  like the answer to "this value can change". It is the answer to <em>configuration changed and my class
  must notice</em>. It is not the answer to <em>the underlying store changed</em>.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Every link in this chain has to work, and the symptom of any one failing is identical:</p>
    <p><code>the store changes → the provider reloads → configuration changes → the monitor fires →
    your class reads CurrentValue</code></p>
    <p>The options module's incident broke the last link. This one breaks the second.</p>
  </div>

  <h3>The fix that does not depend on any of that</h3>

  <pre data-lang="console" data-title="03-production.cs output"><code>   runbook                          before   after the store changed
   -------                          ------   -----------------------
   revoke immediately                10/10                      0/10
   both keys valid (overlap)         10/10                     10/10</code></pre>

  <p><strong>An overlapping validity window removes the race entirely.</strong> While both keys work, it
  does not matter which one any instance is holding, how long a reload takes, or whether a single pod
  failed to restart.</p>

  <p>This is the more important of the two lessons, because it does not depend on your application at
  all. Reloading is a property of your code that can regress with any refactor; an overlap is a property
  of the procedure, and it protects a fleet whose code you have not read.</p>

  <p>What a reloading provider looks like, for the case where you do want one — the only difference
  from the earlier one is a timer and the call that tells configuration something moved:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>public sealed class VaultConfigurationProvider : ConfigurationProvider, IDisposable
{
    private readonly SecretStore _store;
    private readonly Timer? _timer;

    public VaultConfigurationProvider(SecretStore store, TimeSpan? reloadEvery)
    {
        _store = store;

        // A provider only refetches if something makes it. A timer is the
        // simplest thing that does; real vault providers take a reload
        // interval and do exactly this.
        if (reloadEvery is { } interval)
        {
            _timer = new Timer(_ =&gt; Load(), null, interval, interval);
        }
    }

    public override void Load()
    {
        foreach ((string name, string value) in _store.Fetch())
        {
            Data[name.Replace("--", ":")] = value;
        }

        // Without this, nothing downstream is told anything changed.
        OnReload();
    }

    public void Dispose() =&gt; _timer?.Dispose();
}</code></pre>

  <p>Note <code>OnReload()</code>. Without it the data is updated and nothing downstream is told, so the
  monitor never fires and the chain breaks at a different link than the one this module opened with.</p>

  <p>What it requires from the provider is the ability to have two credentials valid at once. Most
  managed services support this explicitly — a primary and a secondary key — precisely so that rotation
  is not an outage. If a provider does not, that constraint belongs in your risk assessment rather than
  in a hopeful runbook.</p>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>One service handling one credential correctly, from where it comes from to what happens when it is
  rotated:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>static async Task&lt;(WebApplication? App, string Outcome)&gt; TryStartAsync(
    string environment, bool supplied, string key)
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = environment
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // Committed, and true everywhere. The key NAME is here; the value is not.
    builder.Configuration.AddInMemoryCollection(new Dictionary&lt;string, string?&gt;
    {
        ["Gateway:BaseUrl"] = "https://gw.internal:8443"
    });

    // Stands in for the two sources that never appear in a committed file:
    // AddUserSecrets&lt;Program&gt;() in Development, and the platform's environment
    // variables or secret store when deployed. Both produce the same key.
    if (supplied)
    {
        builder.Configuration.AddInMemoryCollection(new Dictionary&lt;string, string?&gt;
        {
            ["Gateway:ApiKey"] = key
        });
    }

    builder.Services.AddOptions&lt;GatewayOptions&gt;()
        .Bind(builder.Configuration.GetSection("Gateway"))
        .ValidateDataAnnotations()
        .ValidateOnStart();

    WebApplication app = builder.Build();

    app.MapGet("/internal/credential", (IOptions&lt;GatewayOptions&gt; gateway) =&gt; Results.Ok(new
    {
        gateway.Value.BaseUrl,
        apiKey = Fingerprint(gateway.Value.ApiKey)
    }));

    try
    {
        await app.StartAsync();

        return (app, "started");
    }
    catch (OptionsValidationException exception)
    {
        await app.DisposeAsync();

        return (null, $"REFUSED: {string.Join("; ", exception.Failures.Select(Shorten))}");
    }
}</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>1. It starts only if the credential is there

   environment   credential from        startup
   -----------   ---------------        -------
   Development   user secrets           started
   Production    the platform           started
   Production    nothing                REFUSED: The ApiKey field is required

2. What it says about the credential it is using

   GET /internal/credential   {"baseUrl":"https://gw.internal:8443","apiKey":"sk-live-...8be57dc4"}
   after rotation             {"baseUrl":"https://gw.internal:8443","apiKey":"sk-live-...fb79d130"}

3. What it never says

   what it prints                          contains the secret
   --------------                          -------------------
   the options object interpolated         no
   the startup configuration dump          no
   the credential diagnostics endpoint     no</code></pre>

  <p class="define"><span class="define__term">Fingerprint</span> A prefix plus a hash of a credential:
  enough to tell two credentials apart, not enough to use one.</p>

  <p class="define"><span class="define__term">Entropy</span> How much genuine unpredictability a value
  has. It decides whether a hash of that value is safe to publish: a hash of something guessable can be
  reversed by guessing and hashing, and a hash of a 32-character random key cannot.</p>

  <p>The fingerprint changed and the value was never shown. That is enough to answer the only question a
  rotation asks — is this instance on the new key — and it is safe to expose to anything that can already
  reach the service's internal endpoints.</p>

  <p>A hash of a secret is not a secret, <em>provided the secret has enough entropy that it cannot be
  guessed and checked</em>. For a machine-generated API key that holds. For a short human-chosen password
  it does not, and the fingerprint would be as good as the value.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Two of the practices in that file are the load-bearing ones, and neither is about secrecy in the
    abstract.</p>
    <p><strong>The first is the absence.</strong> Because no committed file has ever held a value, there
    is no habit of putting one there, no template with a placeholder somebody will fill in, and nothing
    for a scanner to find. A secret that was never in the repository cannot be leaked by it — and the
    cost of the alternative is not embarrassment but rotation across every system that trusts the
    credential, under time pressure, with no way to know whether it was used.</p>
    <p><strong>The second is the fingerprint.</strong> It is the only thing there that helps during an
    incident, because the question at 14:00 during a rotation is not "what is the secret" but "which one
    is this instance using" — and that question has a safe answer a script can check across sixty
    instances in three regions.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Revoking before the fleet has moved</h3>

  <p>The incident. Measured: 10 of 10 accepted before, 0 of 10 after. The runbook assumed step 3 was
  safe because steps 1 and 2 had happened.</p>

  <h3>Redacting on the leaf instead of the path</h3>

  <p>Measured above: the API key is masked and the connection string is printed in full, by a redaction
  that reads correctly and was tested against the key it happens to cover.</p>

  <h3>Registering a required secret store as optional</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - starts with no secrets at all"><code>builder.Configuration.AddAzureKeyVault(uri, credential, new AzureKeyVaultConfigurationOptions
{
    // If the vault is unreachable, this starts the application anyway.
    ReloadInterval = TimeSpan.FromMinutes(5)
});

// or, for a file-based store:
builder.Configuration.AddJsonFile("secrets.json", optional: true);</code></pre>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   provider          validation   startup    /health   /capture
   --------          ----------   -------    -------   --------
   optional: true    no           started    200       401
   optional: true    yes          REFUSED    -         -
   optional: false   no           REFUSED    -         -  (InvalidOperationException)</code></pre>

  <p>Note the health column: 200 throughout, because a health check that does not touch the credential
  cannot know it is missing. Every deployment signal said the region was fine.</p>

  <h3>Logging an object that holds one</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   what was logged                              leaks
   ---------------                              -----
   the record, interpolated                    YES
   the record, serialised                      YES
   a record with a redacting ToString          no
   the base url and a fingerprint              no</code></pre>

  <h3>Putting a credential in a URL</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the key is now in every log on the path"><code>string url = $"{options.BaseUrl}/capture/{paymentId}?api_key={options.ApiKey}";

using HttpResponseMessage response = await client.GetAsync(url);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right - a header, set once"><code>// Configured once, at startup, on a client the rest of the code reuses.
builder.Services.AddHttpClient("gateway", (provider, client) =&gt;
{
    GatewayOptions options = provider.GetRequiredService&lt;IOptions&lt;GatewayOptions&gt;&gt;().Value;

    client.BaseAddress = new Uri(options.BaseUrl);
    client.DefaultRequestHeaders.Add("X-Api-Key", options.ApiKey);
});</code></pre>

  <p>A query string reaches access logs, proxy logs, browser history and referrer headers with nobody
  logging anything deliberately. A header reaches none of them by default. This is the single change
  that removes the most paths at once.</p>

  <h3>Granting one identity access to every secret</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - one identity, the whole vault"><code>// Every service in the cluster shares one identity with read access to
// everything, because it was simpler to set up. A single compromised service
// now discloses every credential the organisation has.
builder.Configuration.AddAzureKeyVault(
    new Uri("https://ledger-shared.vault.azure.net/"),
    new DefaultAzureCredential());</code></pre>

  <p>The point of a secret store is not the encryption; it is that access is per-identity and audited.
  An identity that can read everything gives up both — there is nothing to audit that distinguishes one
  service from another, and the blast radius of any compromise is the whole vault.</p>

  <h3>Treating a leaked secret as a cleanup problem</h3>

  <p>Deleting the log entry, force-pushing over the commit, or removing the file does not undo
  disclosure — every copy of the credential still works, and you cannot know who read it. <strong>The
  response to disclosure is rotation, and everything else is tidying.</strong></p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Likely cause</th><th>Check</th></tr></thead>
      <tbody>
        <tr><td>401s begin immediately after a rotation</td>
            <td>The fleet still holds the old key; nothing re-read the store</td>
            <td>The fingerprint endpoint, on every instance</td></tr>
        <tr><td>A new region starts healthy and fails every call</td>
            <td>A secret store registered <code>optional: true</code>, or a secret name that does not
            match</td>
            <td>Whether the key resolves at all, and from which provider</td></tr>
        <tr><td>A credential is found in the log store</td>
            <td>An object logged, a URL logged, or a redaction on <code>Key</code></td>
            <td>Search the store for the prefix; then rotate before investigating further</td></tr>
        <tr><td>A secret works locally and not deployed</td>
            <td>User secrets are Development only</td>
            <td>Which providers are registered in that environment</td></tr>
        <tr><td>Rotation works in staging and not production</td>
            <td>Staging restarts often enough to hide the reload problem</td>
            <td>Whether anything actually re-reads the store</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>The fingerprint endpoint is the whole toolkit for this module, and it is a few lines:</p>
    <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>app.MapGet("/internal/credential", (IOptions&lt;GatewayOptions&gt; gateway) =&gt; Results.Ok(new
{
    gateway.Value.BaseUrl,
    apiKey = Fingerprint(gateway.Value.ApiKey)
}));

static string Fingerprint(string secret)
{
    byte[] hash = System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes(secret));

    return $"sk-live-...{Convert.ToHexString(hash)[..8].ToLowerInvariant()}";
}</code></pre>
    <p>It answers "which credential is this instance using" without ever showing one, which is the
    question every rotation and every suspected-leak investigation actually asks.</p>
    <p><strong>And one rule for the moment you find a secret somewhere it should not be: rotate first,
    investigate second.</strong> The investigation tells you how it got there; only the rotation stops
    it being useful to whoever already has it.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The secret is in Kubernetes, so it is encrypted."</strong></p>
    <p>A Kubernetes secret is base64, which is an encoding. Anybody with permission to read secrets in
    that namespace can read the value, and by default it is stored unencrypted at rest in etcd unless
    that was configured separately.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"We removed the commit, so the key is safe."</strong></p>
    <p>Every clone taken before the rewrite still has it, and you cannot know who cloned. Rewriting
    history is tidying; the credential is disclosed until it is rotated.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"IOptionsMonitor means my service picks up a rotated secret."</strong></p>
    <p>Measured false. The monitor re-reads configuration; if the provider holding the secret never
    fetches again, configuration never changes and the monitor has nothing to report.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"User secrets are a secure store."</strong></p>
    <p>They are a plain-text file outside the repository. They solve exactly one problem — a developer
    needing a real credential without committing one — and for that they are the right tool and nothing
    else is needed.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Our redaction covers it, we match on sensitive words."</strong></p>
    <p>Measured false for the commonest case. <code>context.Key</code> is the leaf, so
    <code>ConnectionStrings:Ledger</code> is not matched by any predicate looking at the key alone.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Nobody would put a key in a URL."</strong></p>
    <p>Plenty of third-party APIs require it, and the moment one does, the credential is in every access
    log and proxy log on the path. When you have no choice, treat every URI built from it as sensitive —
    never logged, including in an exception.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The rotation incident was a complete payment outage that began four seconds after a routine
    maintenance task, on a procedure that had worked twice before. Nothing was broken: the store had the
    right value, the application was reading it correctly, and every instance was doing exactly what it
    was built to do.</p>
    <p>The measured fix costs nothing at all. An overlapping validity window is a decision about the
    order of two steps in a runbook, and it makes every timing question — how long a reload takes, which
    instances restarted, whether the monitor fired — irrelevant. That is worth more than any amount of
    care in the application, because it protects services whose code you have not read.</p>
    <p>The other half compounds differently. A credential in a log store is not an incident on the day it
    happens; it is a credential that works, in a place a hundred people can read, for as long as the
    retention policy keeps it. The cost lands later and arbitrarily, and the only response available then
    is the same rotation — under time pressure, with no way to know whether anybody used it.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A team logs its resolved configuration at startup, with a redaction function covering
    <em>key</em>, <em>secret</em>, <em>password</em> and <em>token</em>. A security review finds the
    database password in the log store anyway.</p>
    <p>Why, and what is the one-word fix?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   predicate on context.Key:
     ConnectionStrings:
       Ledger=Server=db.internal;Database=ledger;Password=hunter2
     Gateway:
       ApiKey=***

   predicate on context.Path:
     ConnectionStrings:
       Ledger=***
     Gateway:
       ApiKey=***</code></pre>
        <p><code>Path</code>. <code>context.Key</code> is the leaf of the key, not the whole path — for
        <code>ConnectionStrings:Ledger</code> the leaf is <code>Ledger</code>, which matches none of the
        sensitive words, so the predicate returned false and the value was printed in full.</p>
        <p><code>Gateway:ApiKey</code> was redacted because its leaf happens to be <code>ApiKey</code>.
        The redaction worked on every key anybody tested it with, and the one it missed is the one whose
        <em>section</em> carries the sensitive word.</p>
        <p>The wider lesson: a redaction is a security control, and a security control that has never
        been tested against the thing it is supposed to stop is a comment. Assert on it — one test that
        builds a configuration containing a fake password and asserts the rendered view does not contain
        it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A service is deployed to a new region. It starts, reports healthy, and every gateway call returns
    401. The secret store in that region was never provisioned.</p>
    <p>Why did it start, and what are the two changes that would have stopped it?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   provider          validation   startup    /health   /capture
   --------          ----------   -------    -------   --------
   optional: true    no           started    200       401
   optional: true    yes          REFUSED    -         -
   optional: false   no           REFUSED    -         -  (InvalidOperationException)</code></pre>
        <p>The provider was registered with <code>optional: true</code>, so a store that could not be
        reached produced no keys and no error.</p>
        <p>Read the health column: 200 throughout, because a health check that does not touch the
        credential cannot know it is missing. Every deployment signal said the region was fine.</p>
        <p>Either change alone would have stopped it, at different points. <code>optional: false</code>
        fails when the <em>source</em> is unreachable — the most precise error and the earliest, since
        <code>ConfigurationManager</code> loads a source the moment it is added, so it throws before the
        rest of the application is configured. Validation fails when the <em>value</em> is absent, which
        catches more causes: an unreachable store, a missing secret, a misspelt name.</p>
        <p>Use both. They are one line each, and the second is the general defence — whatever went wrong
        upstream, a required value that is absent stops the process.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A service logs its gateway settings on every call, for support. The options class is a record. The
    API key is in the log store.</p>
    <p>Show three ways of logging the same thing and which of them leak.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   what was logged                              leaks
   ---------------                              -----
   the record, interpolated                    YES
   the record, serialised                      YES
   a record with a redacting ToString          no
   the base url and a fingerprint              no</code></pre>
        <p>The first two leak and neither looks like logging a secret. A record's generated
        <code>ToString</code> prints every property — that is what records are for — so any record
        holding a credential leaks it the moment somebody interpolates it, which is the ordinary way to
        log an object.</p>
        <p>Serialisation is worse, because structured logging encourages it and the result lands in the
        store as searchable fields rather than as text somebody might notice.</p>
        <pre data-lang="csharp" data-net="10" data-title="the row to copy"><code>public override string ToString() =&gt; $"BaseUrl={BaseUrl}, ApiKey=***";</code></pre>
        <p>A type whose <code>ToString</code> redacts cannot leak by accident, in code nobody has written
        yet, in a message nobody has reviewed. It moves the control from every call site to one
        declaration.</p>
        <p>What it does not cover: serialisation ignores <code>ToString</code>. A
        <code>[JsonIgnore]</code> closes that, and the honest summary is that no single mechanism covers
        every path — which is the argument for logging specific fields rather than objects.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>The gateway key must be rotated on a fleet that reads it at startup. Design a procedure that
    cannot cause a single failed payment, and say what each step defends against.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   procedure                        during   after   worst case
   ---------                        ------   -----   ----------
   write, revoke                      0/10     0/10   every request in the gap
   write, restart, revoke             0/10    10/10   every request in the gap
   write, overlap, restart, revoke   10/10    10/10   no failed request</code></pre>
        <ol>
          <li><strong>Create the new key, both valid.</strong> Defends against every timing question at
          once: while both work, it does not matter which one any instance holds.</li>
          <li><strong>Write it to the store.</strong> Defends against a later instance starting with the
          old value.</li>
          <li><strong>Restart the fleet</strong>, or wait out the reload interval. This is what actually
          moves the running processes, and it is the step the original runbook did not have.</li>
          <li><strong>Verify.</strong> Every instance reports the fingerprint of the key it is using;
          check they all report the new one. Defends against the pod that failed to restart — the case
          that turns step 5 into a partial outage.</li>
          <li><strong>Revoke the old key</strong>, as a separate change, after step 4 passes.</li>
        </ol>
        <p>The order is the answer. Every step is reversible until 5, and 5 is the only one that can
        cause an outage — so it goes last, after the check that says it is safe.</p>
        <p>What makes the second row still risky, even though it measures clean here: it depends on the
        restart completing everywhere before the revoke. With one instance that is certain; with sixty
        across three regions it is an assumption, and the overlap is what stops it being one.</p>
        <p>The step people leave out is 4, and it is the cheapest. Without it you are inferring the
        fleet's state from the fact that you asked it to change — the same mistake as reading a manifest
        instead of the application's resolved configuration.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Where does a credential come from in Development, and in a deployed environment?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>User secrets in Development; environment variables or a secret store
        when deployed. Both arrive as the same configuration keys, so no code knows which answered.</p></div>
      </details></li>

    <li><p>Why is <code>context.Key</code> the wrong thing to redact on?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It is the leaf of the key, not the full path. For
        <code>ConnectionStrings:Ledger</code> it is <code>Ledger</code>, which matches no sensitive word.
        Use <code>context.Path</code>.</p></div>
      </details></li>

    <li><p>What does <code>optional: true</code> mean for a secret store provider?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Start without the secrets. The application comes up, passes its
        health check, and fails every call that needs a credential. It is right for a source that may
        legitimately not exist and wrong for one the service cannot work without.</p></div>
      </details></li>

    <li><p>Why did <code>IOptionsMonitor</code> not pick up the rotated secret?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The monitor re-reads configuration, and configuration did not
        change, because the provider holding the secret never fetched again. A configuration provider
        loads once unless something makes it reload.</p></div>
      </details></li>

    <li><p>What is the one change to a rotation runbook that removes every timing question?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>An overlapping validity window — both credentials valid until the
        fleet is verified to be on the new one, with revocation as a separate later step.</p></div>
      </details></li>

    <li><p>Why is a record a dangerous type to hold a secret in?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Its generated <code>ToString</code> prints every property, so any
        interpolation of the object into a log message includes the credential.</p></div>
      </details></li>

    <li><p>You find a credential in a log store. What is the first action?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Rotate it. Deleting the log entry does not undo disclosure — every
        copy still works and you cannot know who read it. Investigate how it got there afterwards.</p></div>
      </details></li>

    <li><p>Why should a credential never go in a URL?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A URL reaches access logs, proxy logs, browser history and referrer
        headers without anybody logging anything deliberately, and can appear in exception messages. A
        header reaches none of those by default.</p></div>
      </details></li>
  </ol>
</section>
`
});
