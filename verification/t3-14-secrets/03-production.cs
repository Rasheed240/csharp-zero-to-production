// 03-production.cs — The incident: a credential rotated exactly as the runbook
// said, and a fleet that kept presenting the old one.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every outcome and count here is deterministic. Every
// credential in this file is invented and grants access to nothing.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

await TheIncident();
await WhatTheAppDid();
await TheOverlap();
Runbook();

// ---------------------------------------------------------------------------
static async Task TheIncident()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   Ledger's gateway credential is rotated every ninety days. The runbook");
    Console.WriteLine("   is three steps and has worked twice before:");
    Console.WriteLine();
    Console.WriteLine("     1. create the new key with the gateway provider");
    Console.WriteLine("     2. write it into the secret store");
    Console.WriteLine("     3. revoke the old key");
    Console.WriteLine();
    Console.WriteLine("   At 14:00 somebody follows all three. At 14:00 and about four seconds,");
    Console.WriteLine("   every payment in the estate starts failing with 401.");
    Console.WriteLine();
    Console.WriteLine("   The secret store has the new value. Every instance is presenting the");
    Console.WriteLine("   old one.");
    Console.WriteLine();

    var store = new SecretStore { ["Gateway--ApiKey"] = "sk-live-old-0000" };
    var gateway = new GatewayServer("sk-live-old-0000");

    (int before, int after) = await MeasureAsync(store, gateway, Reader.Options, rotate: () =>
    {
        store["Gateway--ApiKey"] = "sk-live-new-1111";
        gateway.Revoke("sk-live-old-0000");
        gateway.Accept("sk-live-new-1111");
    });

    Console.WriteLine("   requests before the rotation   " + before + " of 10 accepted");
    Console.WriteLine("   requests after the rotation    " + after + " of 10 accepted");
    Console.WriteLine();
    Console.WriteLine("   THE STORE WAS UPDATED AND THE PROCESS WAS NOT ASKED AGAIN.");
    Console.WriteLine();
    Console.WriteLine("   A configuration provider loads once, at startup. The vault provider");
    Console.WriteLine("   fetched two secrets when the application began and has not spoken to");
    Console.WriteLine("   the vault since. The value in the process is the value that existed");
    Console.WriteLine("   when the process started, and nothing in the design ever intended");
    Console.WriteLine("   otherwise.");
    Console.WriteLine();
    Console.WriteLine("   THE RUNBOOK IS THE DEFECT, not the code. Step 3 assumes the fleet is");
    Console.WriteLine("   using the new key by the time it runs, and nothing in steps 1 or 2");
    Console.WriteLine("   makes that true.");
    Console.WriteLine();
    Console.WriteLine("   It worked twice before because both earlier rotations happened during");
    Console.WriteLine("   a deployment window, so the processes restarted for unrelated reasons");
    Console.WriteLine("   between step 2 and step 3.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatTheAppDid()
{
    Console.WriteLine("2. Three ways the application could read it");
    Console.WriteLine();

    Console.WriteLine("   how the credential is read              before   after   vault reads");
    Console.WriteLine("   --------------------------              ------   -----   -----------");

    foreach (Reader reader in new[] { Reader.Options, Reader.Monitor, Reader.MonitorWithReload })
    {
        var store = new SecretStore { ["Gateway--ApiKey"] = "sk-live-old-0000" };
        var gateway = new GatewayServer("sk-live-old-0000");

        (int before, int after) = await MeasureAsync(store, gateway, reader, rotate: () =>
        {
            store["Gateway--ApiKey"] = "sk-live-new-1111";
            gateway.Revoke("sk-live-old-0000");
            gateway.Accept("sk-live-new-1111");
        });

        Console.WriteLine($"   {Describe(reader),-38}  {before,4}/10   {after,3}/10   {store.Reads}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIRST TWO ROWS ARE IDENTICAL, and that is the part worth stopping");
    Console.WriteLine("   at. IOptionsMonitor did not help.");
    Console.WriteLine();
    Console.WriteLine("   The monitor re-reads CONFIGURATION. Configuration was not reloaded,");
    Console.WriteLine("   because the provider that holds the secret never fetched again. A");
    Console.WriteLine("   monitor over a provider that does not reload is a monitor over a");
    Console.WriteLine("   constant.");
    Console.WriteLine();
    Console.WriteLine("   That is a genuinely useful thing to have measured, because the options");
    Console.WriteLine("   module makes IOptionsMonitor look like the answer to 'this value can");
    Console.WriteLine("   change'. IT IS THE ANSWER TO 'CONFIGURATION CHANGED AND MY CLASS MUST");
    Console.WriteLine("   NOTICE'. It is not the answer to 'the underlying store changed'.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD ROW WORKS, and the vault read count says why: the provider");
    Console.WriteLine("   was asked again. Something has to call Load - a timer, a webhook, a");
    Console.WriteLine("   platform that rewrites a mounted file - and only then does the rest of");
    Console.WriteLine("   the chain have anything new to see.");
    Console.WriteLine();
    Console.WriteLine("   THE CHAIN IN FULL, because every link has to work:");
    Console.WriteLine();
    Console.WriteLine("     the store changes  ->  the provider reloads  ->  configuration");
    Console.WriteLine("     changes  ->  the monitor fires  ->  your class reads CurrentValue");
    Console.WriteLine();
    Console.WriteLine("   The options module's incident broke the last link. This one breaks the");
    Console.WriteLine("   second, and produces exactly the same symptom.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheOverlap()
{
    Console.WriteLine("3. The fix that does not depend on any of that");
    Console.WriteLine();
    Console.WriteLine("   Reloading is one answer and it has moving parts: a polling interval, a");
    Console.WriteLine("   provider that supports it, a class that reads at the right moment.");
    Console.WriteLine("   Every one of them can be wrong, and the failure is an outage.");
    Console.WriteLine();
    Console.WriteLine("   The other answer changes the runbook instead:");
    Console.WriteLine();
    Console.WriteLine("     1. create the new key");
    Console.WriteLine("     2. write it into the secret store");
    Console.WriteLine("     3. RESTART THE FLEET, or wait for the reload interval to pass");
    Console.WriteLine("     4. verify every instance is presenting the new key");
    Console.WriteLine("     5. only then revoke the old one");
    Console.WriteLine();
    Console.WriteLine("   The measurement, with both keys valid until step 5:");
    Console.WriteLine();

    Console.WriteLine("   runbook                          before   after the store changed");
    Console.WriteLine("   -------                          ------   -----------------------");

    foreach (bool overlap in new[] { false, true })
    {
        var store = new SecretStore { ["Gateway--ApiKey"] = "sk-live-old-0000" };
        var gateway = new GatewayServer("sk-live-old-0000");

        (int during, int after) = await MeasureAsync(store, gateway, Reader.Options, rotate: () =>
        {
            store["Gateway--ApiKey"] = "sk-live-new-1111";
            gateway.Accept("sk-live-new-1111");

            if (!overlap)
            {
                // Revoke immediately: the old key stops working before anything
                // is using the new one.
                gateway.Revoke("sk-live-old-0000");
            }
        });

        Console.WriteLine($"   {(overlap ? "both keys valid (overlap)" : "revoke immediately"),-31}  " +
            $"{during,3}/10   {after,20}/10");
    }

    Console.WriteLine();
    Console.WriteLine("   AN OVERLAPPING VALIDITY WINDOW REMOVES THE RACE ENTIRELY. While both");
    Console.WriteLine("   keys work, it does not matter which one any instance is holding, how");
    Console.WriteLine("   long a reload takes, or whether a single pod failed to restart.");
    Console.WriteLine();
    Console.WriteLine("   THIS IS THE MORE IMPORTANT LESSON OF THE TWO, because it does not");
    Console.WriteLine("   depend on your application at all. Reloading is a property of your");
    Console.WriteLine("   code that can regress with any refactor; an overlap is a property of");
    Console.WriteLine("   the procedure, and it protects a fleet whose code you have not read.");
    Console.WriteLine();
    Console.WriteLine("   WHAT IT REQUIRES FROM THE PROVIDER: the ability to have two credentials");
    Console.WriteLine("   valid at once. Most managed services support this explicitly - two");
    Console.WriteLine("   access keys, a primary and secondary, precisely so that rotation is");
    Console.WriteLine("   not an outage. If a provider does not, that constraint belongs in your");
    Console.WriteLine("   risk assessment rather than in a hopeful runbook.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Runbook()
{
    Console.WriteLine("4. What to take from it");
    Console.WriteLine();
    Console.WriteLine("   1. A SECRET READ AT STARTUP IS A SECRET FIXED FOR THE LIFE OF THE");
    Console.WriteLine("      PROCESS. That is the default and it is a reasonable one - it just");
    Console.WriteLine("      has to be a decision rather than a surprise.");
    Console.WriteLine();
    Console.WriteLine("   2. ROTATE WITH AN OVERLAP. Two valid credentials during the change");
    Console.WriteLine("      makes every timing question irrelevant. Revoke as a separate,");
    Console.WriteLine("      later step, after verifying.");
    Console.WriteLine();
    Console.WriteLine("   3. IF YOU RELY ON RELOADING, TEST THE WHOLE CHAIN. Store, provider,");
    Console.WriteLine("      configuration, monitor, class. Four of the five links are library");
    Console.WriteLine("      code and the fifth is yours, and the symptom of any one failing is");
    Console.WriteLine("      identical.");
    Console.WriteLine();
    Console.WriteLine("   4. LOG A FINGERPRINT OF THE CREDENTIAL IN USE. Not the value - a");
    Console.WriteLine("      prefix and a hash. During this incident that single line answers");
    Console.WriteLine("      'which key is this instance presenting' in seconds, and it is the");
    Console.WriteLine("      only question that mattered.");
    Console.WriteLine();
    Console.WriteLine("   5. MAKE THE FLEET SAY WHAT IT IS USING. A health or diagnostics");
    Console.WriteLine("      endpoint returning the fingerprint turns step 4 of the runbook");
    Console.WriteLine("      into something a script can check across every instance.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL SHAPE, and it is worth more than the incident:");
    Console.WriteLine();
    Console.WriteLine("     ROTATION IS NOT AN OPERATION ON A SECRET. IT IS AN OPERATION ON");
    Console.WriteLine("     EVERY PROCESS THAT HOLDS ONE, and those processes are the part");
    Console.WriteLine("     nobody writes down.");
}

// ---------------------------------------------------------------------------
static async Task<(int Before, int After)> MeasureAsync(
    SecretStore store, GatewayServer gateway, Reader reader, Action rotate)
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Gateway:BaseUrl"] = "https://gw.internal:8443"
    });

    var source = new VaultConfigurationSource(store,
        reloadEvery: reader == Reader.MonitorWithReload ? TimeSpan.FromMilliseconds(50) : null);

    ((IConfigurationBuilder)builder.Configuration).Add(source);

    builder.Services.AddOptions<GatewayOptions>()
        .Bind(builder.Configuration.GetSection("Gateway"));

    builder.Services.AddSingleton(gateway);

    var app = builder.Build();

    app.MapPost("/capture", (
        GatewayServer server,
        IOptions<GatewayOptions> options,
        IOptionsMonitor<GatewayOptions> monitor) =>
    {
        string key = reader == Reader.Options
            ? options.Value.ApiKey
            : monitor.CurrentValue.ApiKey;

        return server.Capture(key)
            ? Results.Ok(new { status = "captured" })
            : Results.StatusCode(401);
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    int before = await CountAcceptedAsync(http);

    rotate();

    // Give a reloading provider time to notice, and wait for the change rather
    // than for a fixed period where possible.
    if (reader == Reader.MonitorWithReload)
    {
        for (int attempt = 0; attempt < 100
            && app.Configuration["Gateway:ApiKey"] != "sk-live-new-1111"; attempt++)
        {
            await Task.Delay(20);
        }
    }

    int after = await CountAcceptedAsync(http);

    await app.StopAsync();
    await app.DisposeAsync();
    source.Stop();

    return (before, after);

    static async Task<int> CountAcceptedAsync(HttpClient http)
    {
        int accepted = 0;

        for (int request = 0; request < 10; request++)
        {
            using HttpResponseMessage response = await http.PostAsync("/capture", null);

            if (response.IsSuccessStatusCode)
            {
                accepted++;
            }
        }

        return accepted;
    }
}

static string Describe(Reader reader) => reader switch
{
    Reader.Options => "IOptions",
    Reader.Monitor => "IOptionsMonitor, provider loads once",
    _ => "IOptionsMonitor, provider reloads"
};

// ---------------------------------------------------------------------------
enum Reader { Options, Monitor, MonitorWithReload }

public sealed class GatewayOptions
{
    public string BaseUrl { get; set; } = "";

    public string ApiKey { get; set; } = "";
}

// Stands in for the gateway provider: it knows which keys are currently valid.
public sealed class GatewayServer(string initialKey)
{
    private readonly HashSet<string> _valid = [initialKey];

    public bool Capture(string key)
    {
        lock (_valid)
        {
            return _valid.Contains(key);
        }
    }

    public void Accept(string key)
    {
        lock (_valid)
        {
            _valid.Add(key);
        }
    }

    public void Revoke(string key)
    {
        lock (_valid)
        {
            _valid.Remove(key);
        }
    }
}

// Stands in for a secret store, counting how often it is actually asked.
public sealed class SecretStore : Dictionary<string, string>
{
    private int _reads;

    public int Reads => Volatile.Read(ref _reads);

    public Dictionary<string, string> Fetch()
    {
        lock (this)
        {
            Interlocked.Increment(ref _reads);

            return new Dictionary<string, string>(this);
        }
    }
}

public sealed class VaultConfigurationSource(SecretStore store, TimeSpan? reloadEvery)
    : IConfigurationSource
{
    private VaultConfigurationProvider? _provider;

    public IConfigurationProvider Build(IConfigurationBuilder builder) =>
        _provider = new VaultConfigurationProvider(store, reloadEvery);

    public void Stop() => _provider?.Dispose();
}

public sealed class VaultConfigurationProvider : ConfigurationProvider, IDisposable
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
            _timer = new Timer(_ => Load(), null, interval, interval);
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

    public void Dispose() => _timer?.Dispose();
}
