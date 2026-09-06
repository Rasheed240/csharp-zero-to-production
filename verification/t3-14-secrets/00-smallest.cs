// 00-smallest.cs — The same secret, reaching the same code, from a different
// place in every environment - and never from the repository.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every value here is deterministic. Every credential in this
// module is invented and grants access to nothing.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Options;

Console.WriteLine("One key name, three environments, three sources");
Console.WriteLine();
Console.WriteLine("   environment   where the value came from        the application sees");
Console.WriteLine("   -----------   ------------------------        --------------------");

await RunAsync("Development", Source.UserSecrets);
await RunAsync("Staging", Source.EnvironmentVariable);
await RunAsync("Production", Source.EnvironmentVariable);
await RunAsync("Production", Source.Nothing);

Console.WriteLine();
Console.WriteLine("   THE CODE IS IDENTICAL IN ALL FOUR. Nothing in the application knows or");
Console.WriteLine("   cares which source answered - the key is 'Gateway:ApiKey' every time, and");
Console.WriteLine("   a different provider happens to be the one that has it.");
Console.WriteLine();
Console.WriteLine("   That is the whole design, and it is worth stating as a rule:");
Console.WriteLine();
Console.WriteLine("     A SECRET IS AN ORDINARY CONFIGURATION VALUE THAT COMES FROM AN");
Console.WriteLine("     EXTRAORDINARY PLACE.");
Console.WriteLine();
Console.WriteLine("   The key name is committed. The value never is. Because they arrive");
Console.WriteLine("   through the same mechanism as every other setting, no code has to be");
Console.WriteLine("   written twice, and there is no 'secret handling' layer to get wrong.");
Console.WriteLine();
Console.WriteLine("   READ THE LAST ROW. With no source supplying it, the application does not");
Console.WriteLine("   start. That is the point of the validation from the previous module");
Console.WriteLine("   applied to a secret: a missing credential must be a failed deployment,");
Console.WriteLine("   because the alternative is a service that starts and fails every call.");
Console.WriteLine();
Console.WriteLine("   AND NOTE WHAT IS NOT IN THE OUTPUT. The value itself is never printed,");
Console.WriteLine("   here or anywhere else in this module, which is the subject of the next");
Console.WriteLine("   file.");

// ---------------------------------------------------------------------------
static async Task RunAsync(string environment, Source source)
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = environment
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // Committed, and true everywhere. The key name is here; the value is not.
    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Gateway:BaseUrl"] = "https://gw.internal:8443"
    });

    // Whichever source this environment uses. In a real application these are
    // AddUserSecrets<Program>() and AddEnvironmentVariables(), both of which
    // CreateBuilder already registers - this stands in for them so the file
    // needs no machine setup.
    switch (source)
    {
        case Source.UserSecrets:
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Gateway:ApiKey"] = "sk-dev-0000000000000000"
            });
            break;

        case Source.EnvironmentVariable:
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Gateway:ApiKey"] = $"sk-{environment.ToLowerInvariant()}-1111111111111111"
            });
            break;
    }

    builder.Services.AddOptions<GatewayOptions>()
        .Bind(builder.Configuration.GetSection("Gateway"))
        .Validate(o => !string.IsNullOrWhiteSpace(o.ApiKey), "Gateway:ApiKey is required")
        .ValidateOnStart();

    WebApplication app = builder.Build();

    app.MapGet("/whoami", (IOptions<GatewayOptions> gateway) => Results.Ok(new
    {
        // Never the value. Enough to tell one credential from another.
        key = Fingerprint(gateway.Value.ApiKey)
    }));

    string label = source switch
    {
        Source.UserSecrets => "user secrets",
        Source.EnvironmentVariable => "an environment variable",
        _ => "nothing"
    };

    try
    {
        await app.StartAsync();
    }
    catch (OptionsValidationException exception)
    {
        Console.WriteLine($"   {environment,-11}   {label,-30}  REFUSED: {string.Join("; ", exception.Failures)}");
        await app.DisposeAsync();
        return;
    }

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine($"   {environment,-11}   {label,-30}  {await http.GetStringAsync("/whoami")}");

    await app.StopAsync();
    await app.DisposeAsync();
}

// A fingerprint: enough to tell two credentials apart in a log, not enough to
// use one. The prefix is safe because it is not the secret part.
static string Fingerprint(string secret)
{
    if (string.IsNullOrEmpty(secret))
    {
        return "(none)";
    }

    byte[] hash = System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes(secret));

    string prefix = secret.Length > 7 ? secret[..7] : "";

    return $"{prefix}... sha256:{Convert.ToHexString(hash)[..8].ToLowerInvariant()}";
}

// ---------------------------------------------------------------------------
enum Source { UserSecrets, EnvironmentVariable, Nothing }

public sealed class GatewayOptions
{
    public string BaseUrl { get; set; } = "";

    // No default. A missing credential must be catchable.
    public string ApiKey { get; set; } = "";
}
