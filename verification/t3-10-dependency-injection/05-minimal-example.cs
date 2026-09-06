// 05-minimal-example.cs — A composition root worth copying: every decision in
// one place, every class testable without it, and a startup that refuses to
// begin if the graph is wrong.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every type name and status code here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    EnvironmentName = "Production"
});

builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
{
    ["Gateway:BaseUrl"] = "https://gw.internal:8443",
    ["Gateway:MaxAttempts"] = "2"
});

// ---------------------------------------------------------------------------
// THE COMPOSITION ROOT. The only part of this program that names a concrete
// type, and the only part that would change to swap one.

// Fail at startup rather than on the request that needed the missing service.
// Off by default outside Development, which is the wrong way round.
builder.Host.UseDefaultServiceProvider(options =>
{
    options.ValidateOnBuild = true;
    options.ValidateScopes = true;
});

builder.Services
    .AddLedgerCore()
    .AddPaymentGateway(builder.Configuration)
    .AddSettlement();

var app = builder.Build();

// ---------------------------------------------------------------------------
// The endpoints ask for what they need. Nothing here knows how any of it is
// built, and nothing here mentions IServiceProvider.

app.MapPost("/v1/payments/{id}/capture", (string id, SettlementRun run) =>
    Results.Ok(new { result = run.Settle(id, 50_000) }));

app.MapGet("/v1/config", (IOptions<GatewayOptions> options) =>
    Results.Ok(new { options.Value.BaseUrl, options.Value.MaxAttempts }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("1. It runs");
Console.WriteLine();

using (HttpResponseMessage response = await http.PostAsync("/v1/payments/PAY-1/capture", null))
{
    Console.WriteLine($"   POST /v1/payments/PAY-1/capture   {(int)response.StatusCode}");
    Console.WriteLine($"     {await response.Content.ReadAsStringAsync()}");
}

Console.WriteLine($"   GET  /v1/config                   {await http.GetStringAsync("/v1/config")}");
Console.WriteLine();

Console.WriteLine("2. What the container actually built");
Console.WriteLine();

Console.WriteLine($"   IPaymentGateway resolves to   {app.Services.GetRequiredService<IPaymentGateway>().GetType().Name}");
Console.WriteLine($"   IClock resolves to            {app.Services.GetRequiredService<IClock>().GetType().Name}");
Console.WriteLine($"   settlement rules injected     {app.Services.GetServices<ISettlementRule>().Count()}");
Console.WriteLine();
Console.WriteLine("   The gateway is a decorator wrapping the real one, and no endpoint,");
Console.WriteLine("   and no class below the root, is aware of that.");
Console.WriteLine();

await app.StopAsync();

Console.WriteLine("3. The same classes, in a test, with no container");
Console.WriteLine();

var run = new SettlementRun(
    new StubGateway(),
    new Ledger(new FixedClock(new DateTime(2026, 1, 1, 9, 0, 0))),
    [new AmountRule(), new CurrencyRule()]);

string first = run.Settle("PAY-1", 50_000);
string second = run.Settle("PAY-1", 50_000);

Console.WriteLine($"   call 1      {first}");
Console.WriteLine($"   call 2      {second}");
Console.WriteLine($"   identical   {first == second}");
Console.WriteLine();
Console.WriteLine("   Three arguments, one new, no ServiceCollection, no configuration and");
Console.WriteLine("   no network. THAT is what the design bought; the container only saved");
Console.WriteLine("   typing.");
Console.WriteLine();

Console.WriteLine("THE CHECKLIST THIS FILE IS BUILT FROM");
Console.WriteLine();
Console.WriteLine("   Every dependency is a constructor parameter, and every class has");
Console.WriteLine("     exactly ONE constructor - so no registration can silently change");
Console.WriteLine("     which one runs");
Console.WriteLine();
Console.WriteLine("   No class takes IServiceProvider. The container is invisible below the");
Console.WriteLine("     composition root");
Console.WriteLine();
Console.WriteLine("   Settings arrive as IOptions<T> of a type this application defined -");
Console.WriteLine("     never as a registered string, int or TimeSpan");
Console.WriteLine();
Console.WriteLine("   Registrations are grouped into extension methods that register and do");
Console.WriteLine("     nothing else");
Console.WriteLine();
Console.WriteLine("   TryAdd for anything a consumer might reasonably want to replace");
Console.WriteLine();
Console.WriteLine("   ValidateOnBuild and ValidateScopes on, in every environment, so a");
Console.WriteLine("     missing registration is a failed deployment rather than an incident");
Console.WriteLine();
Console.WriteLine("   Cross-cutting behaviour is a decorator registered at the root, not a");
Console.WriteLine("     line added to the class that already worked");
Console.WriteLine();
Console.WriteLine("WHAT MAKES IT HOLD");
Console.WriteLine();
Console.WriteLine("   The test in section 3 is the one that keeps this honest. If a class");
Console.WriteLine("   can be constructed with new and a handful of stand-ins, it has stated");
Console.WriteLine("   its dependencies truthfully - and a class that cannot has taken one");
Console.WriteLine("   without saying so.");
Console.WriteLine();
Console.WriteLine("   That check needs no tooling and no discipline about registrations. It");
Console.WriteLine("   is the difference between inversion of control, which is the design,");
Console.WriteLine("   and a container, which is a convenience for doing the wiring.");

// ---------------------------------------------------------------------------
public static class LedgerRegistrations
{
    public static IServiceCollection AddLedgerCore(this IServiceCollection services)
    {
        // TryAdd: an application embedding this could supply its own clock, and
        // it should win whichever order the two lines run in.
        services.TryAddSingleton<IClock, SystemClock>();
        services.AddSingleton<ILedger, Ledger>();

        return services;
    }

    public static IServiceCollection AddPaymentGateway(
        this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<GatewayOptions>(configuration.GetSection("Gateway"));
        services.AddSingleton<IHttpAdapter, HttpAdapter>();

        // The real implementation, registered as itself so that the interface
        // cannot reach it directly.
        services.AddSingleton<CardGateway>();

        // The interface resolves to the decorator, which wraps the real one.
        services.AddSingleton<IPaymentGateway>(provider =>
            new RetryingGateway(
                provider.GetRequiredService<CardGateway>(),
                provider.GetRequiredService<IOptions<GatewayOptions>>()));

        return services;
    }

    public static IServiceCollection AddSettlement(this IServiceCollection services)
    {
        // Several registrations of one interface: SettlementRun receives all of
        // them, in this order, as IEnumerable<ISettlementRule>.
        services.AddSingleton<ISettlementRule, AmountRule>();
        services.AddSingleton<ISettlementRule, CurrencyRule>();
        services.AddSingleton<SettlementRun>();

        return services;
    }
}

// ---------------------------------------------------------------------------
public sealed class GatewayOptions
{
    public string BaseUrl { get; set; } = "";

    public int MaxAttempts { get; set; } = 1;
}

public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public sealed class FixedClock(DateTime fixedTime) : IClock
{
    public DateTime UtcNow => fixedTime;
}

public interface IHttpAdapter
{
    string Post(string path, long amountMinor);
}

public sealed class HttpAdapter(IOptions<GatewayOptions> options) : IHttpAdapter
{
    private readonly string _baseUrl = options.Value.BaseUrl;

    public string Post(string path, long amountMinor) => $"POST {_baseUrl}{path} {amountMinor}";
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

// Cross-cutting behaviour, added by composition rather than by editing the
// class that already worked.
public sealed class RetryingGateway(IPaymentGateway inner, IOptions<GatewayOptions> options)
    : IPaymentGateway
{
    private readonly int _maxAttempts = options.Value.MaxAttempts;

    public string Capture(string paymentId, long amountMinor) =>
        $"{inner.Capture(paymentId, amountMinor)} (up to {_maxAttempts} attempts)";
}

// No network, one predictable answer, for the test in section 3.
public sealed class StubGateway : IPaymentGateway
{
    public string Capture(string paymentId, long amountMinor) => $"captured {paymentId}";
}

public interface ILedger
{
    string Record(string paymentId, long amountMinor);
}

public sealed class Ledger(IClock clock) : ILedger
{
    public string Record(string paymentId, long amountMinor) =>
        $"recorded {paymentId} at {clock.UtcNow:yyyy-MM-dd HH:mm:ss}";
}

public interface ISettlementRule
{
    string Name { get; }
}

public sealed class AmountRule : ISettlementRule
{
    public string Name => "amount";
}

public sealed class CurrencyRule : ISettlementRule
{
    public string Name => "currency";
}

public sealed class SettlementRun(
    IPaymentGateway gateway,
    ILedger ledger,
    IEnumerable<ISettlementRule> rules)
{
    private readonly string _rules = string.Join("+", rules.Select(rule => rule.Name));

    public string Settle(string paymentId, long amountMinor)
    {
        string captured = gateway.Capture(paymentId, amountMinor);

        return $"[{_rules}] {captured} | {ledger.Record(paymentId, amountMinor)}";
    }
}
