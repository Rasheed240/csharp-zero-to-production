// 00-smallest.cs — One section, one class, one registration, and a service that
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

builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
{
    ["Gateway:BaseUrl"] = "https://gw.internal:8443",
    ["Gateway:TimeoutSeconds"] = "5",
    ["Gateway:MaxAttempts"] = "3"
});

// The whole registration. Bind the Gateway section to GatewayOptions, and make
// it available as IOptions<GatewayOptions>.
builder.Services.AddOptions<GatewayOptions>()
    .Bind(builder.Configuration.GetSection("Gateway"));

builder.Services.AddSingleton<PaymentGateway>();

var app = builder.Build();

app.MapGet("/capture/{id}", (string id, PaymentGateway gateway) =>
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
Console.WriteLine("     - PaymentGateway takes IOptions<GatewayOptions> and has no idea");
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
Console.WriteLine("   IOptions<T> IS A WRAPPER AROUND ONE PROPERTY. Reading .Value gives you");
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
public sealed class PaymentGateway(IOptions<GatewayOptions> options)
{
    private readonly GatewayOptions _options = options.Value;

    public string Capture(string paymentId) =>
        $"POST {_options.BaseUrl}/capture/{paymentId} " +
        $"(timeout {_options.TimeoutSeconds}s, up to {_options.MaxAttempts} attempts)";
}
