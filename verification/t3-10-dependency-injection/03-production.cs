// 03-production.cs — What the composition root of a real service looks like:
// grouped registrations, settings that are not services, wrapped
// implementations, and a test that the whole thing can actually be built.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every type name, count and status code here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

await Grouping();
await SettingsNotServices();
await Decorating();
await ProvingItBuilds();

// ---------------------------------------------------------------------------
static async Task Grouping()
{
    Console.WriteLine("1. A composition root that is still readable at forty services");
    Console.WriteLine();
    Console.WriteLine("   Program.cs stays a list of capabilities rather than a list of types:");
    Console.WriteLine();
    Console.WriteLine("     builder.Services");
    Console.WriteLine("         .AddLedgerCore()");
    Console.WriteLine("         .AddPaymentGateway(builder.Configuration)");
    Console.WriteLine("         .AddReceipts();");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Gateway:BaseUrl"] = "https://gw.internal:8443",
        ["Gateway:TimeoutSeconds"] = "5",
        ["Gateway:MaxAttempts"] = "3"
    });

    builder.Services
        .AddLedgerCore()
        .AddPaymentGateway(builder.Configuration)
        .AddReceipts();

    var app = builder.Build();

    app.MapPost("/v1/payments/{id}/capture", (string id, SettlementRun run) =>
        Results.Ok(new { result = run.Settle(id, 50_000) }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    using HttpResponseMessage response =
        await http.PostAsync("/v1/payments/PAY-1/capture", content: null);

    Console.WriteLine($"   POST /v1/payments/PAY-1/capture  {(int)response.StatusCode}");
    Console.WriteLine($"     {await response.Content.ReadAsStringAsync()}");

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   EXTENSION METHODS ON IServiceCollection ARE THE CONVENTION, and they");
    Console.WriteLine("   are worth understanding as a trade rather than a rule.");
    Console.WriteLine();
    Console.WriteLine("   WHAT YOU GAIN: the root reads as intent, a feature's registrations");
    Console.WriteLine("   live next to the feature, and deleting a feature is deleting one line");
    Console.WriteLine("   and one folder.");
    Console.WriteLine();
    Console.WriteLine("   WHAT YOU LOSE: the root no longer tells you what is registered. The");
    Console.WriteLine("   thing the composition root exists to make visible has been moved");
    Console.WriteLine("   somewhere else, one level at a time.");
    Console.WriteLine();
    Console.WriteLine("   The rule that keeps the gain and limits the loss: A REGISTRATION");
    Console.WriteLine("   EXTENSION METHOD MAY CALL OTHER REGISTRATIONS, AND MUST NOT DO");
    Console.WriteLine("   ANYTHING ELSE. No reading files, no opening connections, no");
    Console.WriteLine("   BuildServiceProvider to look something up. If it does work rather");
    Console.WriteLine("   than describing work, that work happens in an order nobody chose.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task SettingsNotServices()
{
    Console.WriteLine("2. Settings are not services");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Gateway:BaseUrl"] = "https://gw.internal:8443",
        ["Gateway:TimeoutSeconds"] = "5",
        ["Gateway:MaxAttempts"] = "3"
    });

    // One binding, and the settings arrive as a typed object rather than as
    // three loose values that any other class could also ask for.
    builder.Services.Configure<GatewayOptions>(builder.Configuration.GetSection("Gateway"));
    builder.Services.AddSingleton<ConfiguredGateway>();

    var app = builder.Build();
    var gateway = app.Services.GetRequiredService<ConfiguredGateway>();

    Console.WriteLine($"   base url        {gateway.Options.BaseUrl}");
    Console.WriteLine($"   timeout         {gateway.Options.TimeoutSeconds}s");
    Console.WriteLine($"   max attempts    {gateway.Options.MaxAttempts}");
    Console.WriteLine();
    Console.WriteLine("   The class asks for IOptions<GatewayOptions> and gets exactly its own");
    Console.WriteLine("   settings. Compare the alternative, which is what people write first:");
    Console.WriteLine();
    Console.WriteLine("     builder.Services.AddSingleton(\"https://gw.internal:8443\");");
    Console.WriteLine();
    Console.WriteLine("   That registers a string. EVERY class asking for a string now gets the");
    Console.WriteLine("   gateway's base URL, and the second setting you register that way");
    Console.WriteLine("   silently replaces the first - the last-registration-wins rule, applied");
    Console.WriteLine("   to a type you do not own.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL FORM: REGISTER TYPES YOU DEFINED. Registering string, int,");
    Console.WriteLine("   TimeSpan or bool puts a value in a namespace shared with the whole");
    Console.WriteLine("   framework.");
    Console.WriteLine();
    Console.WriteLine("   IOptions ALSO GIVES YOU A SEAM FOR TESTS, without configuration:");
    Console.WriteLine();

    var direct = new ConfiguredGateway(Options.Create(new GatewayOptions
    {
        BaseUrl = "https://localhost",
        TimeoutSeconds = 1,
        MaxAttempts = 1
    }));

    Console.WriteLine($"     constructed by hand   {direct.Options.BaseUrl}, {direct.Options.MaxAttempts} attempt(s)");
    Console.WriteLine();

    await app.DisposeAsync();
}

// ---------------------------------------------------------------------------
static async Task Decorating()
{
    Console.WriteLine("3. Wrapping an implementation without changing it");
    Console.WriteLine();
    Console.WriteLine("   The gateway works. It should now also log every capture, and nothing");
    Console.WriteLine("   about the gateway should change.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var log = new List<string>();
    builder.Services.AddSingleton(log);
    builder.Services.AddSingleton<IClock, SystemClock>();
    builder.Services.AddSingleton<IHttpAdapter, HttpAdapter>();

    // The inner implementation, registered as itself rather than as the
    // interface, so that asking for the interface cannot reach it directly.
    builder.Services.AddSingleton<CardGateway>();

    // The interface resolves to the wrapper, which is handed the inner one.
    // A factory registration is how you express "build this from that".
    builder.Services.AddSingleton<IPaymentGateway>(provider =>
        new LoggingGateway(
            provider.GetRequiredService<CardGateway>(),
            provider.GetRequiredService<List<string>>()));

    builder.Services.AddSingleton<ILedger, Ledger>();
    builder.Services.AddSingleton<SettlementRun>();

    var app = builder.Build();
    var run = app.Services.GetRequiredService<SettlementRun>();

    run.Settle("PAY-1", 50_000);
    run.Settle("PAY-2", 12_500);

    Console.WriteLine($"   what SettlementRun received   {app.Services.GetRequiredService<IPaymentGateway>().GetType().Name}");
    Console.WriteLine();
    Console.WriteLine("   log entries:");

    foreach (string entry in log)
    {
        Console.WriteLine($"     {entry}");
    }

    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   NEITHER CardGateway NOR SettlementRun KNOWS THIS HAPPENED. One depends");
    Console.WriteLine("   on the interface and one implements it; the composition root put a");
    Console.WriteLine("   third object between them.");
    Console.WriteLine();
    Console.WriteLine("   This is the decorator pattern, and dependency injection is what makes");
    Console.WriteLine("   it a configuration change rather than an edit. Retries, caching,");
    Console.WriteLine("   metrics, circuit breaking and audit logging are all this shape.");
    Console.WriteLine();
    Console.WriteLine("   THE COST IS REAL AND WORTH STATING. A stack trace now has a layer in");
    Console.WriteLine("   it that is not in any call site, and 'go to implementation' lands on");
    Console.WriteLine("   the wrong class. Two decorators on one interface is usually one too");
    Console.WriteLine("   many for anybody debugging at 03:00.");
    Console.WriteLine();
    Console.WriteLine("   Note the registration shape, because it is the general answer to");
    Console.WriteLine("   'the container cannot build this one':");
    Console.WriteLine();
    Console.WriteLine("     AddSingleton<IThing>(provider => new Thing(provider.GetRequiredService<Other>()));");
    Console.WriteLine();
    Console.WriteLine("   A FACTORY REGISTRATION IS AN ESCAPE HATCH, and it is the right one.");
    Console.WriteLine("   The lambda runs inside the container, so what it builds is still");
    Console.WriteLine("   managed by the container - unlike a new in a constructor.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ProvingItBuilds()
{
    Console.WriteLine("4. The test that pays for itself");
    Console.WriteLine();
    Console.WriteLine("   A missing registration is a runtime failure on the endpoint that");
    Console.WriteLine("   needed it. This test moves it to the build.");
    Console.WriteLine();

    foreach ((string label, bool completeWiring) in new[]
    {
        ("every service registered", true),
        ("one registration removed", false)
    })
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Production"
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddLedgerCore();

        if (completeWiring)
        {
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Gateway:BaseUrl"] = "https://gw.internal:8443"
            });

            builder.Services.AddPaymentGateway(builder.Configuration);
        }

        builder.Services.AddReceipts();

        // The whole test. Ask the container to construct everything it has been
        // told about, now, instead of when a request arrives.
        builder.Host.UseDefaultServiceProvider(options =>
        {
            options.ValidateOnBuild = true;
            options.ValidateScopes = true;
        });

        string outcome;

        try
        {
            WebApplication app = builder.Build();
            await app.DisposeAsync();
            outcome = "built";
        }
        catch (Exception exception)
        {
            string message = exception.InnerException?.Message ?? exception.Message;

            outcome = $"{exception.GetType().Name}: " +
                $"{(message.Length > 96 ? message[..96] + "..." : message)}";
        }

        Console.WriteLine($"   {label,-26}  {outcome}");
    }

    Console.WriteLine();
    Console.WriteLine("   TWO LINES IN THE COMPOSITION ROOT, and every missing registration in");
    Console.WriteLine("   the application becomes a process that will not start.");
    Console.WriteLine();
    Console.WriteLine("   The reason to want that is the shape of the alternative failure. An");
    Console.WriteLine("   unregistered service used by one rarely-called endpoint survives every");
    Console.WriteLine("   test, every code review and every smoke check, and fails on the first");
    Console.WriteLine("   real request that needs it - which for a refund path or a reconciliation");
    Console.WriteLine("   job might be days after the deployment that broke it.");
    Console.WriteLine();
    Console.WriteLine("   WHAT IT STILL DOES NOT CATCH. The same missing registration, moved");
    Console.WriteLine("   inside a factory lambda:");
    Console.WriteLine();

    {
        var factoryBuilder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Production"
        });

        factoryBuilder.WebHost.UseUrls("http://127.0.0.1:0");
        factoryBuilder.Logging.ClearProviders();

        // IHttpAdapter is never registered, and the lambda asks for it.
        factoryBuilder.Services.AddSingleton<IPaymentGateway>(provider =>
            new CardGateway(provider.GetRequiredService<IHttpAdapter>()));

        factoryBuilder.Host.UseDefaultServiceProvider(options =>
        {
            options.ValidateOnBuild = true;
            options.ValidateScopes = true;
        });

        string atBuild;
        string atResolve = "-";

        try
        {
            WebApplication factoryApp = factoryBuilder.Build();
            atBuild = "built without complaint";

            try
            {
                factoryApp.Services.GetRequiredService<IPaymentGateway>();
                atResolve = "resolved";
            }
            catch (Exception exception)
            {
                atResolve = $"{exception.GetType().Name}: {FirstLine(exception.Message)}";
            }

            await factoryApp.DisposeAsync();
        }
        catch (Exception exception)
        {
            atBuild = $"Build() threw {exception.GetType().Name}";
        }

        Console.WriteLine($"     at build     {atBuild}");
        Console.WriteLine($"     at resolve   {atResolve}");
    }

    Console.WriteLine();
    Console.WriteLine("   VALIDATION READS CONSTRUCTORS, NOT CODE. A factory lambda is invoked,");
    Console.WriteLine("   never inspected, so everything it resolves is invisible to the check.");
    Console.WriteLine("   The escape hatch from section 3 is also a hole in section 4, and that");
    Console.WriteLine("   is a reason to use factory registrations deliberately rather than as a");
    Console.WriteLine("   first resort.");
    Console.WriteLine();
    Console.WriteLine("   The rest of the hole:");
    Console.WriteLine();
    Console.WriteLine("     - anything resolved from an IServiceProvider at runtime, for the");
    Console.WriteLine("       same reason;");
    Console.WriteLine("     - registering the wrong implementation, which is a correct graph");
    Console.WriteLine("       with the wrong contents.");
    Console.WriteLine();
    Console.WriteLine("   That last one is what an integration test covers, and it is the reason");
    Console.WriteLine("   validation supplements tests rather than replacing them.");
}

// ---------------------------------------------------------------------------
// The first line of an exception message, shortened. Framework messages run to
// several lines and only the first is useful in a table.
static string FirstLine(string message)
{
    string first = message.ReplaceLineEndings(" ");

    return first.Length > 96 ? first[..96] + "..." : first;
}

// ---------------------------------------------------------------------------
// Registration extension methods: they describe work, and do none.
public static class LedgerRegistrations
{
    public static IServiceCollection AddLedgerCore(this IServiceCollection services)
    {
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<ILedger, Ledger>();

        return services;
    }

    public static IServiceCollection AddPaymentGateway(
        this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<GatewayOptions>(configuration.GetSection("Gateway"));
        services.AddSingleton<IHttpAdapter, HttpAdapter>();
        services.AddSingleton<IPaymentGateway, CardGateway>();

        return services;
    }

    public static IServiceCollection AddReceipts(this IServiceCollection services)
    {
        services.AddSingleton<SettlementRun>();

        return services;
    }
}

// ---------------------------------------------------------------------------
public sealed class GatewayOptions
{
    public string BaseUrl { get; set; } = "";

    public int TimeoutSeconds { get; set; } = 30;

    public int MaxAttempts { get; set; } = 1;
}

public sealed class ConfiguredGateway(IOptions<GatewayOptions> options)
{
    // Value is the bound object. The class never sees IConfiguration.
    public GatewayOptions Options { get; } = options.Value;
}

public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public interface IHttpAdapter
{
    string Post(string path, long amountMinor);
}

public sealed class HttpAdapter(IClock clock) : IHttpAdapter
{
    public string Post(string path, long amountMinor) =>
        $"POST {path} {amountMinor} at {clock.UtcNow:HH:mm:ss}";
}

public interface IPaymentGateway
{
    string Capture(string paymentId, long amountMinor);
}

public sealed class CardGateway(IHttpAdapter http) : IPaymentGateway
{
    public string Capture(string paymentId, long amountMinor) =>
        http.Post($"/capture/{paymentId}", amountMinor);
}

// The decorator. Same interface, one extra thing done, and it holds the real
// implementation rather than replacing it.
public sealed class LoggingGateway(IPaymentGateway inner, List<string> log) : IPaymentGateway
{
    public string Capture(string paymentId, long amountMinor)
    {
        log.Add($"capture {paymentId} {amountMinor} -> {inner.GetType().Name}");

        return inner.Capture(paymentId, amountMinor);
    }
}

public interface ILedger
{
    string Record(string paymentId, long amountMinor);
}

public sealed class Ledger(IClock clock) : ILedger
{
    public string Record(string paymentId, long amountMinor) =>
        $"recorded {paymentId} at {clock.UtcNow:HH:mm:ss}";
}

public sealed class SettlementRun(IPaymentGateway gateway, ILedger ledger)
{
    public string Settle(string paymentId, long amountMinor)
    {
        string captured = gateway.Capture(paymentId, amountMinor);

        return $"{captured} | {ledger.Record(paymentId, amountMinor)}";
    }
}
