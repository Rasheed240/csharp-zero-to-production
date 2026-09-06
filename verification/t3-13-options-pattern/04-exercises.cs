// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every value and outcome here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Options;
using System.ComponentModel.DataAnnotations;

await One();
await Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static async Task One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the validation that validated nothing");
    Console.WriteLine();
    Console.WriteLine("   An options class has [Required] and [Range] on every property, and");
    Console.WriteLine("   ValidateDataAnnotations is called. A deployment with a missing base");
    Console.WriteLine("   URL starts normally and serves traffic for two hours before anybody");
    Console.WriteLine("   hits the endpoint that uses it.");
    Console.WriteLine();
    Console.WriteLine("   What is missing, and where did the failure land instead?");
    Console.WriteLine();

    Console.WriteLine("   registration                     startup   the request that needed it");
    Console.WriteLine("   ------------                     -------   --------------------------");

    foreach (bool onStart in new[] { false, true })
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Production"
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Gateway:TimeoutSeconds"] = "5"
        });

        OptionsBuilder<GatewayOptions> options = builder.Services.AddOptions<GatewayOptions>()
            .Bind(builder.Configuration.GetSection("Gateway"))
            .ValidateDataAnnotations();

        if (onStart)
        {
            options.ValidateOnStart();
        }

        WebApplication app = builder.Build();

        app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
        app.MapGet("/capture", (IOptions<GatewayOptions> gateway) =>
            Results.Ok(new { url = gateway.Value.BaseUrl }));

        string label = onStart ? "+ ValidateOnStart" : "ValidateDataAnnotations only";

        try
        {
            await app.StartAsync();
        }
        catch (OptionsValidationException)
        {
            await app.DisposeAsync();
            Console.WriteLine($"   {label,-31}  REFUSED   -");
            continue;
        }

        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        using HttpResponseMessage health = await http.GetAsync("/health");
        using HttpResponseMessage capture = await http.GetAsync("/capture");

        Console.WriteLine($"   {label,-31}  started   /health {(int)health.StatusCode}, " +
            $"/capture {(int)capture.StatusCode}");

        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: ValidateOnStart. Options validation is LAZY - the rules run");
    Console.WriteLine("   the first time something reads .Value, not when the application");
    Console.WriteLine("   starts. Declaring the attributes and calling");
    Console.WriteLine("   ValidateDataAnnotations sets the checks up; nothing runs them until");
    Console.WriteLine("   somebody asks for the value.");
    Console.WriteLine();
    Console.WriteLine("   So the failure landed on a request, two hours after the deployment");
    Console.WriteLine("   that caused it - and note the health check in the first row, which");
    Console.WriteLine("   returned 200 the whole time, because it does not read the options.");
    Console.WriteLine();
    Console.WriteLine("   ONE METHOD CALL MOVES IT. ValidateOnStart runs every registered");
    Console.WriteLine("   validation during startup, so a broken environment is a deployment");
    Console.WriteLine("   that rolls back rather than an incident with a two-hour fuse.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the snapshot that never moved");
    Console.WriteLine();
    Console.WriteLine("   A rate limit is read through IOptionsSnapshot so it can be adjusted");
    Console.WriteLine("   without a restart. It is injected into a singleton. In Development");
    Console.WriteLine("   this refuses to start; somebody adds a line to make it start, and in");
    Console.WriteLine("   production the limit never changes.");
    Console.WriteLine();
    Console.WriteLine("   What line did they add, what happened, and what should it have been?");
    Console.WriteLine();

    Console.WriteLine("   configuration                              startup");
    Console.WriteLine("   -------------                              -------");

    foreach ((string label, bool validateScopes) in new[]
    {
        ("singleton takes IOptionsSnapshot, checked", true),
        ("singleton takes IOptionsSnapshot, unchecked", false)
    })
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Production"
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        builder.Host.UseDefaultServiceProvider(o =>
        {
            o.ValidateOnBuild = validateScopes;
            o.ValidateScopes = validateScopes;
        });

        builder.Services.AddOptions<GatewayOptions>()
            .Bind(builder.Configuration.GetSection("Gateway"));

        builder.Services.AddSingleton<SnapshotHolder>();

        string outcome;

        try
        {
            WebApplication app = builder.Build();
            outcome = "built without complaint";
            await app.DisposeAsync();
        }
        catch (Exception exception)
        {
            string message = (exception.InnerException?.Message ?? exception.Message)
                .ReplaceLineEndings(" ");

            int marker = message.IndexOf("Cannot consume", StringComparison.Ordinal);

            outcome = marker >= 0 ? "REFUSED: " + message[marker..] : "REFUSED";
        }

        Console.WriteLine($"   {label,-41}  {outcome}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: they turned off scope validation, or moved to an environment");
    Console.WriteLine("   where it is off by default - which Production is.");
    Console.WriteLine();
    Console.WriteLine("   IOptionsSnapshot is SCOPED, because 'once per scope' is what it means.");
    Console.WriteLine("   A singleton holding one captures the snapshot taken during whichever");
    Console.WriteLine("   request built the singleton, and holds it forever. The rate limit is");
    Console.WriteLine("   frozen at the value it had when the first request arrived.");
    Console.WriteLine();
    Console.WriteLine("   THE STARTUP ERROR WAS THE CORRECT ANSWER, and silencing it converted a");
    Console.WriteLine("   failed startup into a feature that quietly does not work.");
    Console.WriteLine();
    Console.WriteLine("   WHAT IT SHOULD HAVE BEEN: IOptionsMonitor, which is a singleton and");
    Console.WriteLine("   may be held by one - reading CurrentValue at the point of use, not");
    Console.WriteLine("   copying it into a field.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium) - one class, two gateways");
    Console.WriteLine();
    Console.WriteLine("   Ledger adds a bank transfer gateway alongside the card one. Same");
    Console.WriteLine("   settings shape, different values, and both are needed at once.");
    Console.WriteLine();
    Console.WriteLine("   Show it with named options, and say when you would not use them.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Gateways:card:BaseUrl"] = "https://cards.internal:8443",
        ["Gateways:card:TimeoutSeconds"] = "5",
        ["Gateways:bank:BaseUrl"] = "https://bank.internal:8443",
        ["Gateways:bank:TimeoutSeconds"] = "45"
    });

    // Each name gets its own binding and its own validation.
    foreach (string name in new[] { "card", "bank" })
    {
        builder.Services.AddOptions<GatewayOptions>(name)
            .Bind(builder.Configuration.GetSection($"Gateways:{name}"))
            .ValidateDataAnnotations()
            .ValidateOnStart();
    }

    var app = builder.Build();

    app.MapGet("/gateways", (IOptionsMonitor<GatewayOptions> gateways) => Results.Ok(new
    {
        card = $"{gateways.Get("card").BaseUrl} @ {gateways.Get("card").TimeoutSeconds}s",
        bank = $"{gateways.Get("bank").BaseUrl} @ {gateways.Get("bank").TimeoutSeconds}s",
        typo = $"{gateways.Get("cards").BaseUrl} @ {gateways.Get("cards").TimeoutSeconds}s"
    }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine($"   {await http.GetStringAsync("/gateways")}");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: AddOptions<T>(name) once per name, and Get(name) to read.");
    Console.WriteLine("   Each name is bound and validated separately, so a broken bank section");
    Console.WriteLine("   fails startup without the card one having to care.");
    Console.WriteLine();
    Console.WriteLine("   READ THE THIRD FIELD. 'cards' is a typo, it was never registered, and");
    Console.WriteLine("   it comes back as an object of class defaults rather than an error -");
    Console.WriteLine("   the same silence that a missing configuration section produces.");
    Console.WriteLine();
    Console.WriteLine("   ValidateOnStart DOES NOT HELP THERE EITHER: it validates the names");
    Console.WriteLine("   that were registered, and 'cards' is not one of them, so there is");
    Console.WriteLine("   nothing for it to check.");
    Console.WriteLine();
    Console.WriteLine("   WHEN NOT TO USE NAMED OPTIONS: when the set is fixed and known at");
    Console.WriteLine("   compile time. Two classes - CardGatewayOptions and BankGatewayOptions -");
    Console.WriteLine("   cost a few more lines and buy real things: the compiler keeps them");
    Console.WriteLine("   apart, a typo is a build error rather than a defaulted object, and");
    Console.WriteLine("   each can grow properties the other does not have.");
    Console.WriteLine();
    Console.WriteLine("   USE NAMES WHEN THE SET IS OPEN - configured rather than coded, a third");
    Console.WriteLine("   gateway next quarter without a code change.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - a rule the attributes cannot state");
    Console.WriteLine();
    Console.WriteLine("   The gateway settings must satisfy three rules:");
    Console.WriteLine();
    Console.WriteLine("     - the retry budget must fit inside the overall timeout;");
    Console.WriteLine("     - the base URL must be https in every environment except");
    Console.WriteLine("       Development;");
    Console.WriteLine("     - all failures must be reported at once, not one at a time.");
    Console.WriteLine();
    Console.WriteLine("   Implement it and show it failing.");
    Console.WriteLine();

    Console.WriteLine("   environment   settings                            startup");
    Console.WriteLine("   -----------   --------                            -------");

    foreach ((string environment, string url, string timeout, string attempts, string budget) in new[]
    {
        ("Production", "https://gw.internal:8443", "5", "3", "30"),
        ("Production", "http://gw.internal:8443", "5", "3", "30"),
        ("Development", "http://localhost:9443", "5", "3", "30"),
        ("Production", "https://gw.internal:8443", "20", "3", "30"),
        ("Production", "http://gw.internal:8443", "20", "3", "30")
    })
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = environment
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Gateway:BaseUrl"] = url,
            ["Gateway:TimeoutSeconds"] = timeout,
            ["Gateway:MaxAttempts"] = attempts,
            ["Gateway:OverallBudgetSeconds"] = budget
        });

        builder.Services.AddOptions<GatewayOptions>()
            .Bind(builder.Configuration.GetSection("Gateway"))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        // An IValidateOptions implementation, resolved from the container, so
        // it can depend on services - here, the environment.
        builder.Services.AddSingleton<IValidateOptions<GatewayOptions>, GatewayValidator>();

        WebApplication app = builder.Build();

        string outcome;

        try
        {
            await app.StartAsync();
            await app.StopAsync();
            outcome = "started";
        }
        catch (OptionsValidationException exception)
        {
            outcome = $"REFUSED: {string.Join(" | ", exception.Failures.Select(Shorten))}";
        }
        finally
        {
            await app.DisposeAsync();
        }

        Console.WriteLine($"   {environment,-11}   {$"{url}, {timeout}s x {attempts}",-34}  {outcome}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: IValidateOptions<T>, registered in the container so it can take");
    Console.WriteLine("   dependencies:");
    Console.WriteLine();
    Console.WriteLine("     public sealed class GatewayValidator(IHostEnvironment environment)");
    Console.WriteLine("         : IValidateOptions<GatewayOptions>");
    Console.WriteLine("     {");
    Console.WriteLine("         public ValidateOptionsResult Validate(string? name, GatewayOptions o)");
    Console.WriteLine("         {");
    Console.WriteLine("             var failures = new List<string>();");
    Console.WriteLine("             ... add every failure, then ...");
    Console.WriteLine("             return failures.Count == 0");
    Console.WriteLine("                 ? ValidateOptionsResult.Success");
    Console.WriteLine("                 : ValidateOptionsResult.Fail(failures);");
    Console.WriteLine("         }");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   THE LAST ROW IS THE POINT: two rules broken, both reported. A chain of");
    Console.WriteLine("   .Validate(...) calls stops at the first failure, so somebody fixing a");
    Console.WriteLine("   manifest would fix one thing, redeploy, and be told about the next.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD ROW IS THE REASON THIS IS A CLASS RATHER THAN A LAMBDA. The");
    Console.WriteLine("   https rule depends on the environment, which is a service - so the");
    Console.WriteLine("   validator has to be something the container can build. A lambda in");
    Console.WriteLine("   Program.cs could close over it, and then the rule lives in the");
    Console.WriteLine("   composition root rather than next to the thing it describes.");
    Console.WriteLine();
    Console.WriteLine("   WHAT THIS BUYS, stated plainly: the options class plus its validator");
    Console.WriteLine("   become the SPECIFICATION OF A VALID ENVIRONMENT. Somebody deploying to");
    Console.WriteLine("   a new region reads one file to know what they must provide, and gets");
    Console.WriteLine("   the complete list of what they got wrong on the first attempt.");

    static string Shorten(string failure)
    {
        int marker = failure.IndexOf("with the error:", StringComparison.Ordinal);

        return marker >= 0 ? failure[(marker + 16)..].Trim('\'', '.', ' ') : failure;
    }
}

// ---------------------------------------------------------------------------
public sealed class GatewayOptions
{
    [Required]
    [Url]
    public string BaseUrl { get; set; } = "";

    [Range(1, 120)]
    public int TimeoutSeconds { get; set; } = 30;

    [Range(1, 10)]
    public int MaxAttempts { get; set; } = 1;

    [Range(1, 600)]
    public int OverallBudgetSeconds { get; set; } = 60;
}

public sealed class SnapshotHolder(IOptionsSnapshot<GatewayOptions> snapshot)
{
    public int Timeout => snapshot.Value.TimeoutSeconds;
}

// Depends on a service, and reports every failure rather than the first.
public sealed class GatewayValidator(IHostEnvironment environment)
    : IValidateOptions<GatewayOptions>
{
    public ValidateOptionsResult Validate(string? name, GatewayOptions options)
    {
        var failures = new List<string>();

        if (options.TimeoutSeconds * options.MaxAttempts > options.OverallBudgetSeconds)
        {
            failures.Add($"retry budget ({options.TimeoutSeconds}s x {options.MaxAttempts}) " +
                $"exceeds the overall budget of {options.OverallBudgetSeconds}s");
        }

        if (!environment.IsDevelopment()
            && !options.BaseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            failures.Add($"BaseUrl must be https outside Development");
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
