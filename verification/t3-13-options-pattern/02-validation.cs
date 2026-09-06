// 02-validation.cs — Making a wrong or missing setting stop the process, and
// the one word that decides whether it stops at startup or at 3am.
//
// Run:  dotnet run 02-validation.cs -c Release
//
// EXACT vs RATIO: every outcome and message here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Options;
using System.ComponentModel.DataAnnotations;

await WhenItFails();
await BeyondAttributes();
await CrossField();
Rules();

// ---------------------------------------------------------------------------
static async Task WhenItFails()
{
    Console.WriteLine("1. Four levels of care, on the same broken configuration");
    Console.WriteLine();
    Console.WriteLine("   The Gateway section is missing BaseUrl entirely - the mistake from the");
    Console.WriteLine("   configuration module, where a renamed key binds to nothing.");
    Console.WriteLine();

    Console.WriteLine("   registration                          startup      first request");
    Console.WriteLine("   ------------                          -------      -------------");

    foreach (Level level in new[] { Level.None, Level.Annotations, Level.ValidateOnStart, Level.Custom })
    {
        Outcome outcome = await MeasureAsync(level, includeBaseUrl: false);

        Console.WriteLine($"   {Describe(level),-36}  {outcome.Startup,-11}  {outcome.Request}");
    }

    Console.WriteLine();
    Console.WriteLine("   READ THE FIRST ROW, because it is what most services do. It starts, it");
    Console.WriteLine("   serves traffic, and the gateway call goes to '/capture/PAY-1' with no");
    Console.WriteLine("   host - a request that will fail in whatever way an empty base URL fails");
    Console.WriteLine("   in whatever client you happen to use.");
    Console.WriteLine();
    Console.WriteLine("   THE SECOND ROW IS THE ONE THAT SURPRISES PEOPLE. Data annotations are");
    Console.WriteLine("   declared and ValidateDataAnnotations is called, and the application");
    Console.WriteLine("   still STARTS. Options are validated lazily - the first time something");
    Console.WriteLine("   reads .Value - so the failure lands on a request rather than on the");
    Console.WriteLine("   deployment.");
    Console.WriteLine();
    Console.WriteLine("   That is worse than it looks. A rarely-used endpoint means the process");
    Console.WriteLine("   is healthy, the deployment is green, and the failure waits for whoever");
    Console.WriteLine("   first calls that path.");
    Console.WriteLine();
    Console.WriteLine("   ValidateOnStart IS THE WHOLE DIFFERENCE. One method call moves every");
    Console.WriteLine("   options failure from first use to startup, which turns an incident");
    Console.WriteLine("   into a deployment that rolls back.");
    Console.WriteLine();
    Console.WriteLine("   And the same configuration, corrected:");
    Console.WriteLine();

    Outcome good = await MeasureAsync(Level.Custom, includeBaseUrl: true);

    Console.WriteLine($"   {"BaseUrl present, full validation",-36}  {good.Startup,-11}  {good.Request}");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task BeyondAttributes()
{
    Console.WriteLine("2. What the attributes say, and what they cannot");
    Console.WriteLine();
    Console.WriteLine("   The options class, with its rules on it:");
    Console.WriteLine();
    Console.WriteLine("     [Required, Url]");
    Console.WriteLine("     public string BaseUrl { get; set; } = \"\";");
    Console.WriteLine();
    Console.WriteLine("     [Range(1, 120)]");
    Console.WriteLine("     public int TimeoutSeconds { get; set; } = 30;");
    Console.WriteLine();
    Console.WriteLine("     [Range(1, 10)]");
    Console.WriteLine("     public int MaxAttempts { get; set; } = 1;");
    Console.WriteLine();
    Console.WriteLine("   what each broken value produces at startup:");
    Console.WriteLine();

    foreach ((string label, Dictionary<string, string?> settings) in new[]
    {
        ("everything valid", Settings("https://gw.internal:8443", "5", "3")),
        ("BaseUrl absent", Settings(null, "5", "3")),
        ("BaseUrl not a URL", Settings("gw.internal", "5", "3")),
        ("TimeoutSeconds 0", Settings("https://gw.internal:8443", "0", "3")),
        ("MaxAttempts 50", Settings("https://gw.internal:8443", "5", "50")),
        ("two things wrong", Settings("gw.internal", "0", "3"))
    })
    {
        Console.WriteLine($"   {label,-20}  {await StartupMessageAsync(settings)}");
    }

    Console.WriteLine();
    Console.WriteLine("   EVERY FAILING RULE IS REPORTED, not only the first, which matters when");
    Console.WriteLine("   somebody is fixing a deployment at speed.");
    Console.WriteLine();
    Console.WriteLine("   NOTE WHAT [Required] DOES ON A STRING WITH AN INITIALISER. The property");
    Console.WriteLine("   defaults to empty rather than null, and Required rejects an empty");
    Console.WriteLine("   string, so it catches the absent case. A property defaulting to null");
    Console.WriteLine("   would also be caught; one defaulting to a plausible value would not,");
    Console.WriteLine("   which is the argument for leaving required settings with no default.");
    Console.WriteLine();

    static Dictionary<string, string?> Settings(string? baseUrl, string timeout, string attempts)
    {
        var settings = new Dictionary<string, string?>
        {
            ["Gateway:TimeoutSeconds"] = timeout,
            ["Gateway:MaxAttempts"] = attempts
        };

        if (baseUrl is not null)
        {
            settings["Gateway:BaseUrl"] = baseUrl;
        }

        return settings;
    }
}

// ---------------------------------------------------------------------------
static async Task CrossField()
{
    Console.WriteLine("3. A rule no attribute can express");
    Console.WriteLine();
    Console.WriteLine("   The retry budget must fit inside the request timeout: attempts times");
    Console.WriteLine("   the per-attempt timeout must not exceed the overall one. That is a");
    Console.WriteLine("   relationship between three properties, so no single-property attribute");
    Console.WriteLine("   can state it.");
    Console.WriteLine();

    Console.WriteLine("   settings                                  startup");
    Console.WriteLine("   --------                                  -------");

    foreach ((string label, string timeout, string attempts, string overall) in new[]
    {
        ("5s x 3 attempts, 30s budget", "5", "3", "30"),
        ("5s x 3 attempts, 10s budget", "5", "3", "10"),
        ("20s x 2 attempts, 30s budget", "20", "2", "30")
    })
    {
        var settings = new Dictionary<string, string?>
        {
            ["Gateway:BaseUrl"] = "https://gw.internal:8443",
            ["Gateway:TimeoutSeconds"] = timeout,
            ["Gateway:MaxAttempts"] = attempts,
            ["Gateway:OverallBudgetSeconds"] = overall
        };

        Console.WriteLine($"   {label,-40}  {await StartupMessageAsync(settings, withCustom: true)}");
    }

    Console.WriteLine();
    Console.WriteLine("   Two ways to write that rule, and the difference is where it lives:");
    Console.WriteLine();
    Console.WriteLine("     .Validate(options => ..., \"message\")   inline, one rule, no new type");
    Console.WriteLine();
    Console.WriteLine("     IValidateOptions<T>                    a class, injectable, can");
    Console.WriteLine("                                            depend on other services");
    Console.WriteLine();
    Console.WriteLine("   THE SECOND IS THE ONE THAT SCALES, and the reason is dependencies: an");
    Console.WriteLine("   IValidateOptions implementation is resolved from the container, so a");
    Console.WriteLine("   rule that needs to check something - a directory exists, a certificate");
    Console.WriteLine("   loads, a connection string parses - can take what it needs.");
    Console.WriteLine();
    Console.WriteLine("   IT ALSO REPORTS ALL FAILURES AT ONCE, where a chain of .Validate calls");
    Console.WriteLine("   stops at the first. For configuration that is worth having: somebody");
    Console.WriteLine("   fixing a manifest wants the whole list.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Rules()
{
    Console.WriteLine("4. The registration to copy");
    Console.WriteLine();
    Console.WriteLine("     builder.Services.AddOptions<GatewayOptions>()");
    Console.WriteLine("         .Bind(builder.Configuration.GetSection(\"Gateway\"))");
    Console.WriteLine("         .ValidateDataAnnotations()");
    Console.WriteLine("         .Validate(o => o.TimeoutSeconds * o.MaxAttempts <= o.OverallBudgetSeconds,");
    Console.WriteLine("             \"retry budget exceeds the overall timeout\")");
    Console.WriteLine("         .ValidateOnStart();");
    Console.WriteLine();
    Console.WriteLine("   FIVE LINES, and each one is doing something the others do not:");
    Console.WriteLine();
    Console.WriteLine("     AddOptions<T>()            starts a builder rather than registering");
    Console.WriteLine("                                a bare Configure, which is what makes the");
    Console.WriteLine("                                rest of the chain available");
    Console.WriteLine();
    Console.WriteLine("     Bind(section)              the only place the key names appear");
    Console.WriteLine();
    Console.WriteLine("     ValidateDataAnnotations()  turns the attributes on the class into");
    Console.WriteLine("                                checks - without this they are comments");
    Console.WriteLine();
    Console.WriteLine("     Validate(...)              rules that span properties");
    Console.WriteLine();
    Console.WriteLine("     ValidateOnStart()          runs all of it at startup instead of at");
    Console.WriteLine("                                first use");
    Console.WriteLine();
    Console.WriteLine("   IF YOU REMEMBER ONE THING: ValidateDataAnnotations WITHOUT");
    Console.WriteLine("   ValidateOnStart IS A CHECK THAT RUNS ON A CUSTOMER'S REQUEST.");
    Console.WriteLine();
    Console.WriteLine("   THE OTHER HALF OF THE JOB IS THE OPTIONS CLASS ITSELF:");
    Console.WriteLine();
    Console.WriteLine("     - a required setting has NO DEFAULT, so an absent one is empty or");
    Console.WriteLine("       zero and the attribute catches it;");
    Console.WriteLine();
    Console.WriteLine("     - a setting with a correct default HAS ONE, so an environment that");
    Console.WriteLine("       does not care about it does not have to say anything;");
    Console.WriteLine();
    Console.WriteLine("     - a range is stated even when it seems obvious, because [Range(1,");
    Console.WriteLine("       120)] on a timeout is what turns a mistyped 0 into a failed");
    Console.WriteLine("       deployment rather than an instant-failure endpoint.");
    Console.WriteLine();
    Console.WriteLine("   THE COMBINED EFFECT is that the class becomes the specification of");
    Console.WriteLine("   what a valid environment looks like - readable in one place, enforced");
    Console.WriteLine("   automatically, and impossible to get wrong quietly.");
}

// ---------------------------------------------------------------------------
static async Task<Outcome> MeasureAsync(Level level, bool includeBaseUrl)
{
    var settings = new Dictionary<string, string?>
    {
        ["Gateway:TimeoutSeconds"] = "5",
        ["Gateway:MaxAttempts"] = "3",
        ["Gateway:OverallBudgetSeconds"] = "30"
    };

    if (includeBaseUrl)
    {
        settings["Gateway:BaseUrl"] = "https://gw.internal:8443";
    }

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Configuration.AddInMemoryCollection(settings);

    OptionsBuilder<GatewayOptions> options = builder.Services.AddOptions<GatewayOptions>()
        .Bind(builder.Configuration.GetSection("Gateway"));

    if (level >= Level.Annotations)
    {
        options.ValidateDataAnnotations();
    }

    if (level >= Level.Custom)
    {
        options.Validate(
            o => o.TimeoutSeconds * o.MaxAttempts <= o.OverallBudgetSeconds,
            "retry budget exceeds the overall timeout");
    }

    if (level >= Level.ValidateOnStart)
    {
        options.ValidateOnStart();
    }

    WebApplication app = builder.Build();

    app.MapGet("/capture/{id}", (string id, IOptions<GatewayOptions> gateway) =>
        Results.Ok(new { url = $"{gateway.Value.BaseUrl}/capture/{id}" }));

    try
    {
        await app.StartAsync();
    }
    catch (OptionsValidationException)
    {
        await app.DisposeAsync();

        return new Outcome("REFUSED", "-");
    }

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    string request;

    try
    {
        using HttpResponseMessage response = await http.GetAsync("/capture/PAY-1");

        request = response.IsSuccessStatusCode
            ? $"200 {await response.Content.ReadAsStringAsync()}"
            : $"{(int)response.StatusCode} (the request failed)";
    }
    catch (Exception exception)
    {
        request = exception.GetType().Name;
    }

    await app.StopAsync();
    await app.DisposeAsync();

    return new Outcome("started", request);
}

// ---------------------------------------------------------------------------
static async Task<string> StartupMessageAsync(Dictionary<string, string?> settings,
    bool withCustom = false)
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Configuration.AddInMemoryCollection(settings);

    OptionsBuilder<GatewayOptions> options = builder.Services.AddOptions<GatewayOptions>()
        .Bind(builder.Configuration.GetSection("Gateway"))
        .ValidateDataAnnotations();

    if (withCustom)
    {
        options.Validate(
            o => o.TimeoutSeconds * o.MaxAttempts <= o.OverallBudgetSeconds,
            "retry budget exceeds the overall timeout");
    }

    options.ValidateOnStart();

    WebApplication app = builder.Build();

    try
    {
        await app.StartAsync();
        await app.StopAsync();

        return "started";
    }
    catch (OptionsValidationException exception)
    {
        return $"REFUSED: {string.Join(" | ", exception.Failures)}";
    }
    finally
    {
        await app.DisposeAsync();
    }
}

static string Describe(Level level) => level switch
{
    Level.None => "Bind only",
    Level.Annotations => "+ ValidateDataAnnotations",
    Level.ValidateOnStart => "+ ValidateOnStart",
    _ => "+ a cross-field Validate"
};

// ---------------------------------------------------------------------------
enum Level { None, Annotations, ValidateOnStart, Custom }

record Outcome(string Startup, string Request);

public sealed class GatewayOptions
{
    // No default: absent must be catchable, and Required rejects the empty
    // string this initialises to.
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
