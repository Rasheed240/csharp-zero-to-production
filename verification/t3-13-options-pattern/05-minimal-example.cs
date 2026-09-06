// 05-minimal-example.cs — Every settings decision in one application: bound
// once, validated at startup, and each consumer taking the interface that
// matches how often the value may change.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every value and outcome here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Options;
using System.ComponentModel.DataAnnotations;

string root = Directory.CreateTempSubdirectory("opt-example").FullName;

File.WriteAllText(Path.Combine(root, "appsettings.json"), """
{
  "Gateway": {
    "BaseUrl": "https://gw.internal:8443",
    "TimeoutSeconds": 5,
    "MaxAttempts": 3,
    "OverallBudgetSeconds": 30
  },
  "Features": {
    "NewSettlement": true
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

builder.Host.UseDefaultServiceProvider(options =>
{
    options.ValidateOnBuild = true;
    options.ValidateScopes = true;
});

// ---------------------------------------------------------------------------
// SETTINGS THAT DO NOT CHANGE WHILE THE PROCESS RUNS. Validated at startup, so
// a broken environment is a failed deployment.
builder.Services.AddOptions<GatewayOptions>()
    .Bind(builder.Configuration.GetSection("Gateway"))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services.AddSingleton<IValidateOptions<GatewayOptions>, GatewayValidator>();

// SETTINGS THAT ARE MEANT TO CHANGE. A kill switch is only useful if it can be
// pulled without a restart, so this one is read through a monitor.
builder.Services.AddOptions<FeatureOptions>()
    .Bind(builder.Configuration.GetSection("Features"))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services.AddSingleton<PaymentGateway>();
builder.Services.AddSingleton<SettlementRouter>();

var app = builder.Build();

app.MapGet("/capture/{id}", (string id, PaymentGateway gateway) =>
    Results.Ok(new { request = gateway.Describe(id) }));

app.MapGet("/route", (SettlementRouter router) => Results.Text(router.Route()));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("1. It started, which means every setting passed validation");
Console.WriteLine();
Console.WriteLine($"   GET /capture/PAY-1   {await http.GetStringAsync("/capture/PAY-1")}");
Console.WriteLine($"   GET /route           {await http.GetStringAsync("/route")}");
Console.WriteLine();

Console.WriteLine("2. The flag changes without a restart, and the timeout does not");
Console.WriteLine();

File.WriteAllText(Path.Combine(root, "appsettings.json"), """
{
  "Gateway": {
    "BaseUrl": "https://gw.internal:8443",
    "TimeoutSeconds": 45,
    "MaxAttempts": 3,
    "OverallBudgetSeconds": 30
  },
  "Features": {
    "NewSettlement": false
  }
}
""");

var monitor = app.Services.GetRequiredService<IOptionsMonitor<FeatureOptions>>();

for (int attempt = 0; attempt < 150 && monitor.CurrentValue.NewSettlement; attempt++)
{
    await Task.Delay(20);
}

Console.WriteLine($"   GET /capture/PAY-1   {await http.GetStringAsync("/capture/PAY-1")}");
Console.WriteLine($"   GET /route           {await http.GetStringAsync("/route")}");
Console.WriteLine();
Console.WriteLine("   THE FLAG MOVED AND THE TIMEOUT DID NOT, and both are correct.");
Console.WriteLine();
Console.WriteLine("   PaymentGateway takes IOptions, so it holds the values it was built with.");
Console.WriteLine("   That is deliberate: a timeout changing under a request in flight would");
Console.WriteLine("   make two calls in the same deployment behave differently for reasons no");
Console.WriteLine("   log records.");
Console.WriteLine();
Console.WriteLine("   SettlementRouter takes IOptionsMonitor and reads CurrentValue at the");
Console.WriteLine("   point of use, so the kill switch works. Note what it does NOT do, which");
Console.WriteLine("   is copy CurrentValue into a field - that is the production incident, and");
Console.WriteLine("   it turns this class back into the one above while still reading as though");
Console.WriteLine("   it does not.");
Console.WriteLine();
Console.WriteLine("   THE NEW TIMEOUT OF 45s WOULD HAVE FAILED VALIDATION had the process been");
Console.WriteLine("   restarted, because 45 x 3 exceeds the 30s budget. It is live in the file");
Console.WriteLine("   and unread, which is the honest cost of IOptions: validation runs at");
Console.WriteLine("   startup, so a file edited afterwards is neither applied nor checked.");
Console.WriteLine();

await app.StopAsync();
await app.DisposeAsync();

Console.WriteLine("3. What a broken environment does instead");
Console.WriteLine();
Console.WriteLine("   settings                              startup");
Console.WriteLine("   --------                              -------");

foreach ((string label, string url, string timeout, string attempts) in new[]
{
    ("everything valid", "https://gw.internal:8443", "5", "3"),
    ("BaseUrl absent", "", "5", "3"),
    ("plain http in Production", "http://gw.internal:8443", "5", "3"),
    ("retry budget too large", "https://gw.internal:8443", "20", "3")
})
{
    Console.WriteLine($"   {label,-36}  {await StartupAsync(url, timeout, attempts)}");
}

Directory.Delete(root, recursive: true);

Console.WriteLine();
Console.WriteLine("THE CHECKLIST THIS FILE IS BUILT FROM");
Console.WriteLine();
Console.WriteLine("   One options class per section, bound ONCE with AddOptions().Bind(), so");
Console.WriteLine("     the key names appear in exactly one place");
Console.WriteLine();
Console.WriteLine("   ValidateDataAnnotations for per-property rules, an IValidateOptions class");
Console.WriteLine("     for rules that span properties or need a service");
Console.WriteLine();
Console.WriteLine("   ValidateOnStart on every options type, without exception - validation is");
Console.WriteLine("     lazy otherwise, and lands on a request rather than a deployment");
Console.WriteLine();
Console.WriteLine("   Required settings have NO default, so an absent one is empty or zero and");
Console.WriteLine("     the attribute catches it");
Console.WriteLine();
Console.WriteLine("   IOptions everywhere by default. IOptionsMonitor only where the value is");
Console.WriteLine("     meant to change while the process runs, and IOptionsSnapshot only in");
Console.WriteLine("     scoped code that needs per-request freshness");
Console.WriteLine();
Console.WriteLine("   CurrentValue is read at the point of use and NEVER copied into a field");
Console.WriteLine();
Console.WriteLine("   Nothing takes IConfiguration - every consumer takes the options class,");
Console.WriteLine("     which is what makes each of them constructible in a test with new");
Console.WriteLine();
Console.WriteLine("WHAT MAKES IT HOLD");
Console.WriteLine();
Console.WriteLine("   The options class stops being a bag of settings and becomes THE");
Console.WriteLine("   SPECIFICATION OF A VALID ENVIRONMENT. Somebody deploying to a new region");
Console.WriteLine("   reads one file to know what they must supply, and gets the complete list");
Console.WriteLine("   of what they got wrong on the first attempt rather than one item at a");
Console.WriteLine("   time.");
Console.WriteLine();
Console.WriteLine("   Everything else in the checklist is in service of two properties: a");
Console.WriteLine("   WRONG environment cannot start, and a class that reads settings can be");
Console.WriteLine("   constructed without any.");

// ---------------------------------------------------------------------------
static async Task<string> StartupAsync(string url, string timeout, string attempts)
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Gateway:BaseUrl"] = url,
        ["Gateway:TimeoutSeconds"] = timeout,
        ["Gateway:MaxAttempts"] = attempts,
        ["Gateway:OverallBudgetSeconds"] = "30"
    });

    builder.Services.AddOptions<GatewayOptions>()
        .Bind(builder.Configuration.GetSection("Gateway"))
        .ValidateDataAnnotations()
        .ValidateOnStart();

    builder.Services.AddSingleton<IValidateOptions<GatewayOptions>, GatewayValidator>();

    WebApplication app = builder.Build();

    try
    {
        await app.StartAsync();
        await app.StopAsync();

        return "started";
    }
    catch (OptionsValidationException exception)
    {
        return $"REFUSED: {string.Join(" | ", exception.Failures.Select(Shorten))}";
    }
    finally
    {
        await app.DisposeAsync();
    }

    static string Shorten(string failure)
    {
        int marker = failure.IndexOf("with the error:", StringComparison.Ordinal);

        return marker >= 0 ? failure[(marker + 16)..].Trim('\'', '.', ' ') : failure;
    }
}

// ---------------------------------------------------------------------------
public sealed class GatewayOptions
{
    // No default: an absent value must be caught, and Required rejects the
    // empty string this initialises to.
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

public sealed class FeatureOptions
{
    public bool NewSettlement { get; set; }
}

// Rules that span properties, or need a service. Reports every failure.
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
            failures.Add("BaseUrl must be https outside Development");
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}

// ---------------------------------------------------------------------------
// Settings that must not change under a running request. IOptions says so.
public sealed class PaymentGateway(IOptions<GatewayOptions> options)
{
    private readonly GatewayOptions _options = options.Value;

    public string Describe(string paymentId) =>
        $"POST {_options.BaseUrl}/capture/{paymentId} " +
        $"(timeout {_options.TimeoutSeconds}s, up to {_options.MaxAttempts} attempts)";
}

// A kill switch, which is only useful if it can be pulled without a restart.
public sealed class SettlementRouter(IOptionsMonitor<FeatureOptions> features)
{
    // Read at the point of use. NOT copied into a field - that is the whole
    // production incident in this module.
    public string Route() => features.CurrentValue.NewSettlement ? "new" : "old";
}
