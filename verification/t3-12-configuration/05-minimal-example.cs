// 05-minimal-example.cs — Configuration for a service that runs in three
// environments: nothing duplicated, nothing secret committed, and a missing
// required value stops the process.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every value and outcome here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Configuration;

Console.WriteLine("One configuration design, three environments, and one deployment mistake");
Console.WriteLine();
Console.WriteLine("   environment   BaseUrl                           Timeout   ApiKey   outcome");
Console.WriteLine("   -----------   -------                           -------   ------   -------");

await RunAsync("Development", platformUrl: null, platformKey: null);
await RunAsync("Staging", "https://gw-staging.internal:8443", "staging-key");
await RunAsync("Production", "https://gw.internal:8443", "prod-key");
await RunAsync("Production", platformUrl: null, platformKey: "prod-key");

Console.WriteLine();
Console.WriteLine("   The last row is the production incident, caught at startup instead of");
Console.WriteLine("   eleven days later.");
Console.WriteLine();

Console.WriteLine("THE FILES");
Console.WriteLine();
Console.WriteLine("   appsettings.json                  committed, and true everywhere");
Console.WriteLine("     Gateway:TimeoutSeconds  5       a safe production default");
Console.WriteLine("     Gateway:MaxAttempts     3");
Console.WriteLine("     NO BaseUrl, NO ApiKey           deliberately absent");
Console.WriteLine();
Console.WriteLine("   appsettings.Development.json      committed, and only true locally");
Console.WriteLine("     Gateway:BaseUrl         https://localhost:9443");
Console.WriteLine("     Gateway:TimeoutSeconds  30      long enough to step through a debugger");
Console.WriteLine();
Console.WriteLine("   user secrets                      Development only, never committed");
Console.WriteLine("     Gateway:ApiKey");
Console.WriteLine();
Console.WriteLine("   environment variables             set by the platform, deployed");
Console.WriteLine("     Gateway__BaseUrl                DOUBLE underscore");
Console.WriteLine("     Gateway__ApiKey                 from the secret store");
Console.WriteLine();

Console.WriteLine("THE CHECKLIST THIS FILE IS BUILT FROM");
Console.WriteLine();
Console.WriteLine("   A value with a correct default goes in appsettings.json. A value with NO");
Console.WriteLine("     correct default goes in no committed file at all, so a missing one has");
Console.WriteLine("     nothing to fall back to");
Console.WriteLine();
Console.WriteLine("   Every environment override is the smallest possible diff against the");
Console.WriteLine("     base - Development changes two keys and inherits the rest");
Console.WriteLine();
Console.WriteLine("   No secret is in any committed file, in any environment, ever");
Console.WriteLine();
Console.WriteLine("   Environment variables use DOUBLE underscores, because a single one is a");
Console.WriteLine("     key name and a colon is not legal on Linux");
Console.WriteLine();
Console.WriteLine("   Lists are defined in exactly one file, because a later source overrides");
Console.WriteLine("     an array element by element and cannot shorten it");
Console.WriteLine();
Console.WriteLine("   Configuration is bound to a class ONCE, at startup, and the rest of the");
Console.WriteLine("     application takes that class - nothing else sees IConfiguration");
Console.WriteLine();
Console.WriteLine("   Required values are checked at startup and the process refuses to run");
Console.WriteLine("     without them");
Console.WriteLine();
Console.WriteLine("   The resolved values are logged at startup, with secrets redacted and the");
Console.WriteLine("     source of each named - filtered to the sections this application owns");
Console.WriteLine();

Console.WriteLine("WHAT MAKES IT HOLD");
Console.WriteLine();
Console.WriteLine("   Configuration fails silently by design: an unrecognised key is not an");
Console.WriteLine("   error, a missing key is not an error, and a value from the wrong source");
Console.WriteLine("   looks exactly like a value from the right one.");
Console.WriteLine();
Console.WriteLine("   Two of the items above are the ones that convert that silence into");
Console.WriteLine("   noise, and they are worth more than the rest combined: REFUSE TO START");
Console.WriteLine("   WITHOUT A REQUIRED VALUE, and LOG WHAT WAS ACTUALLY RESOLVED. The first");
Console.WriteLine("   catches the value nobody set; the second answers the only question that");
Console.WriteLine("   matters during an incident, which is not 'what did we configure' but");
Console.WriteLine("   'what does the application think'.");

// ---------------------------------------------------------------------------
static async Task RunAsync(string environment, string? platformUrl, string? platformKey)
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
    var external = new Dictionary<string, string?>();

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
    var options = builder.Configuration.GetSection("Gateway").Get<GatewayOptions>()
        ?? new GatewayOptions();

    // The check that turns a missing required value into a failed deployment.
    string? missing = Missing(options);

    if (missing is not null)
    {
        Console.WriteLine($"   {environment,-11}   {"(none)",-32}   {options.TimeoutSeconds,7}   " +
            $"{(string.IsNullOrEmpty(options.ApiKey) ? "no" : "yes"),-6}   REFUSED: {missing}");

        Directory.Delete(root, recursive: true);
        return;
    }

    builder.Services.AddSingleton(options);

    var app = builder.Build();

    app.MapGet("/v1/config", (GatewayOptions gateway) => Results.Ok(new
    {
        gateway.BaseUrl,
        gateway.TimeoutSeconds,
        gateway.MaxAttempts,
        apiKey = "***"
    }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    using HttpResponseMessage response = await http.GetAsync("/v1/config");
    bool ok = response.IsSuccessStatusCode;

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine($"   {environment,-11}   {options.BaseUrl,-32}   {options.TimeoutSeconds,7}   " +
        $"{(string.IsNullOrEmpty(options.ApiKey) ? "no" : "yes"),-6}   " +
        $"{(ok ? "started and serving" : "started, endpoint failed")}");

    Directory.Delete(root, recursive: true);

    // Required means required: no default, and no starting without it.
    static string? Missing(GatewayOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.BaseUrl))
        {
            return "Gateway:BaseUrl is required";
        }

        return string.IsNullOrWhiteSpace(options.ApiKey) ? "Gateway:ApiKey is required" : null;
    }
}

// ---------------------------------------------------------------------------
public sealed class GatewayOptions
{
    // No default. A missing value must be caught, not papered over.
    public string BaseUrl { get; set; } = "";

    // A default that is correct in production, overridden only where it is not.
    public int TimeoutSeconds { get; set; } = 5;

    public int MaxAttempts { get; set; } = 3;

    // No default, and never printed.
    public string ApiKey { get; set; } = "";
}
