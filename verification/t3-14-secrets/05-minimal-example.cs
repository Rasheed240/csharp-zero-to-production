// 05-minimal-example.cs — One service handling one credential correctly, from
// where it comes from to what happens when it is rotated.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every outcome here is deterministic. Every credential in this
// file is invented and grants access to nothing.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using System.ComponentModel.DataAnnotations;

Console.WriteLine("1. It starts only if the credential is there");
Console.WriteLine();
Console.WriteLine("   environment   credential from        startup");
Console.WriteLine("   -----------   ---------------        -------");

await RunAsync("Development", supplied: true);
await RunAsync("Production", supplied: true);
await RunAsync("Production", supplied: false);

Console.WriteLine();
Console.WriteLine("2. What it says about the credential it is using");
Console.WriteLine();

await DiagnosticsAsync();

Console.WriteLine();
Console.WriteLine("3. What it never says");
Console.WriteLine();

Leaks();

Console.WriteLine();
Console.WriteLine("THE CHECKLIST THIS FILE IS BUILT FROM");
Console.WriteLine();
Console.WriteLine("   No committed file contains a credential, in any environment. The key");
Console.WriteLine("     NAME is committed; the value never is");
Console.WriteLine();
Console.WriteLine("   Development reads user secrets; deployed environments read environment");
Console.WriteLine("     variables or a secret store. Both arrive as the same configuration");
Console.WriteLine("     keys, so no code knows which");
Console.WriteLine();
Console.WriteLine("   A secret provider is registered where it exists and NOT registered where");
Console.WriteLine("     it does not - never optional:true on a store the service needs");
Console.WriteLine();
Console.WriteLine("   Required credentials are validated at startup, so a missing one is a");
Console.WriteLine("     failed deployment rather than every request failing");
Console.WriteLine();
Console.WriteLine("   The options type holding a secret overrides ToString to redact, so it");
Console.WriteLine("     cannot leak through an interpolation nobody has written yet");
Console.WriteLine();
Console.WriteLine("   Any configuration dump redacts on context.Path, not context.Key, and is");
Console.WriteLine("     filtered to the sections this application owns");
Console.WriteLine();
Console.WriteLine("   The credential goes in a HEADER, never a URL, so it cannot reach an");
Console.WriteLine("     access log, a proxy log or an exception message");
Console.WriteLine();
Console.WriteLine("   A diagnostics endpoint reports the FINGERPRINT of the key in use, so a");
Console.WriteLine("     rotation can be verified across the fleet before the old key is revoked");
Console.WriteLine();
Console.WriteLine("WHAT MAKES IT HOLD");
Console.WriteLine();
Console.WriteLine("   Two of those items are the load-bearing ones, and neither is about");
Console.WriteLine("   secrecy in the abstract.");
Console.WriteLine();
Console.WriteLine("   THE FIRST IS THE ABSENCE. Because no committed file has ever held a");
Console.WriteLine("   value, there is no habit of putting one there, no template with a");
Console.WriteLine("   placeholder somebody will fill in, and nothing for a scanner to find.");
Console.WriteLine("   A secret that was never in the repository cannot be leaked by it.");
Console.WriteLine();
Console.WriteLine("   THE SECOND IS THE FINGERPRINT. It is the only thing here that helps");
Console.WriteLine("   during an incident, because the question at 14:00 during a rotation is");
Console.WriteLine("   not 'what is the secret' but 'which one is this instance using' - and");
Console.WriteLine("   that question has a safe answer that a script can check.");

// ---------------------------------------------------------------------------
static async Task RunAsync(string environment, bool supplied)
{
    (WebApplication? app, string outcome) = await TryStartAsync(environment, supplied, "sk-live-1111");

    string from = environment == "Development" ? "user secrets" : "the platform";

    Console.WriteLine($"   {environment,-11}   {(supplied ? from : "nothing"),-21}  {outcome}");

    if (app is not null)
    {
        await app.StopAsync();
        await app.DisposeAsync();
    }
}

// ---------------------------------------------------------------------------
static async Task DiagnosticsAsync()
{
    (WebApplication? app, string _) = await TryStartAsync("Production", supplied: true, "sk-live-1111");

    using var http = new HttpClient { BaseAddress = new Uri(app!.Urls.First()) };

    Console.WriteLine($"   GET /internal/credential   {await http.GetStringAsync("/internal/credential")}");

    await app.StopAsync();
    await app.DisposeAsync();

    // The same service with the rotated key, to show the fingerprint moving.
    (WebApplication? rotated, string _) = await TryStartAsync("Production", supplied: true, "sk-live-2222");

    using var http2 = new HttpClient { BaseAddress = new Uri(rotated!.Urls.First()) };

    Console.WriteLine($"   after rotation             {await http2.GetStringAsync("/internal/credential")}");

    await rotated.StopAsync();
    await rotated.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE FINGERPRINT CHANGED AND THE VALUE WAS NEVER SHOWN. That is enough");
    Console.WriteLine("   to answer the only question a rotation asks - is this instance on the");
    Console.WriteLine("   new key - and it is safe to expose to anything that can already reach");
    Console.WriteLine("   the service's internal endpoints.");
    Console.WriteLine();
    Console.WriteLine("   A hash of a secret is not a secret, provided the secret has enough");
    Console.WriteLine("   entropy that it cannot be guessed and checked. For a machine-generated");
    Console.WriteLine("   API key that holds. For a short human-chosen password it does not, and");
    Console.WriteLine("   the fingerprint would be as good as the value.");
}

// ---------------------------------------------------------------------------
static void Leaks()
{
    var options = new GatewayOptions
    {
        BaseUrl = "https://gw.internal:8443",
        ApiKey = "sk-live-1111"
    };

    IConfigurationRoot configuration = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Gateway:BaseUrl"] = "https://gw.internal:8443",
            ["Gateway:ApiKey"] = "sk-live-1111",
            ["ConnectionStrings:Ledger"] = "Server=db;Password=hunter2"
        })
        .Build();

    string dump = configuration.GetDebugView(context =>
        Sensitive(context.Path) ? "***" : context.Value ?? "");

    Console.WriteLine("   what it prints                          contains the secret");
    Console.WriteLine("   --------------                          -------------------");
    Console.WriteLine($"   the options object interpolated         {Mark($"{options}")}");
    Console.WriteLine($"   the startup configuration dump          {Mark(dump)}");
    Console.WriteLine($"   the credential diagnostics endpoint     {Mark(Fingerprint(options.ApiKey))}");
    Console.WriteLine();
    Console.WriteLine($"   the options object prints as   {options}");

    static string Mark(string text) =>
        text.Contains("sk-live-1111", StringComparison.Ordinal)
        || text.Contains("hunter2", StringComparison.Ordinal) ? "YES" : "no";
}

// ---------------------------------------------------------------------------
static async Task<(WebApplication? App, string Outcome)> TryStartAsync(
    string environment, bool supplied, string key)
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = environment
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // Committed, and true everywhere. The key NAME is here; the value is not.
    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Gateway:BaseUrl"] = "https://gw.internal:8443"
    });

    // Stands in for the two sources that never appear in a committed file:
    // AddUserSecrets<Program>() in Development, and the platform's environment
    // variables or secret store when deployed. Both produce the same key.
    if (supplied)
    {
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Gateway:ApiKey"] = key
        });
    }

    builder.Services.AddOptions<GatewayOptions>()
        .Bind(builder.Configuration.GetSection("Gateway"))
        .ValidateDataAnnotations()
        .ValidateOnStart();

    WebApplication app = builder.Build();

    app.MapGet("/internal/credential", (IOptions<GatewayOptions> gateway) => Results.Ok(new
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
}

// ---------------------------------------------------------------------------
static bool Sensitive(string path) =>
    path.Contains("key", StringComparison.OrdinalIgnoreCase)
    || path.Contains("secret", StringComparison.OrdinalIgnoreCase)
    || path.Contains("password", StringComparison.OrdinalIgnoreCase)
    || path.Contains("token", StringComparison.OrdinalIgnoreCase)
    || path.Contains("connectionstring", StringComparison.OrdinalIgnoreCase);

// A prefix and a hash: enough to tell two credentials apart, not enough to use
// one. The prefix is the non-secret part of the format.
static string Fingerprint(string secret)
{
    if (string.IsNullOrEmpty(secret))
    {
        return "(none)";
    }

    byte[] hash = System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes(secret));

    return $"sk-live-...{Convert.ToHexString(hash)[..8].ToLowerInvariant()}";
}

static string Shorten(string failure)
{
    int marker = failure.IndexOf("with the error:", StringComparison.Ordinal);

    return marker >= 0 ? failure[(marker + 16)..].Trim('\'', '.', ' ') : failure;
}

// ---------------------------------------------------------------------------
public sealed class GatewayOptions
{
    [Required]
    [Url]
    public string BaseUrl { get; set; } = "";

    // No default, so an absent credential is an empty string and Required
    // rejects it at startup.
    [Required]
    public string ApiKey { get; set; } = "";

    // The one override that makes this type safe to interpolate into any
    // message anybody writes later.
    public override string ToString() => $"BaseUrl={BaseUrl}, ApiKey=***";
}
