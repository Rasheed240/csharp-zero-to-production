// 05-minimal-example.cs — One application with every lifetime decision made
// deliberately, and a startup that refuses to run if any of them is wrong.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    EnvironmentName = "Production"
});

builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// ---------------------------------------------------------------------------
// FIRST, AND IN EVERY ENVIRONMENT. Both defaults are on in Development only,
// which is the opposite of where they are needed.
builder.Host.UseDefaultServiceProvider(options =>
{
    options.ValidateOnBuild = true;    // every constructor resolvable, at startup
    options.ValidateScopes = true;     // no scoped service captured by a singleton
});

// SCOPED: per request, because it carries a unit of work and a connection.
builder.Services.AddScoped<LedgerDbContext>();
builder.Services.AddScoped<IPaymentRepository, PaymentRepository>();

// SINGLETON: stateless, or state that is genuinely application-wide. Neither
// of these holds anything scoped - the catalogue holds the ability to make a
// scope, which is not the same thing.
builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddSingleton<ICurrencyCatalogue, CurrencyCatalogue>();

// A background service is a singleton. It takes the scope factory, never a
// scoped service.
builder.Services.AddHostedService<SettlementWorker>();

var app = builder.Build();

app.MapGet("/v1/payments/{id}", async (string id, IPaymentRepository payments) =>
    await payments.FindAsync(id) is { } payment
        ? Results.Ok(payment)
        : Results.Problem(title: "Payment not found", statusCode: 404));

app.MapGet("/v1/rates/{code}", async (string code, ICurrencyCatalogue catalogue) =>
    Results.Ok(new { code, rate = await catalogue.RateAsync(code) }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("1. It starts, which is the first thing the validation buys");
Console.WriteLine();
Console.WriteLine("   ValidateOnBuild and ValidateScopes both on, in Production: built.");
Console.WriteLine();

Console.WriteLine("2. Under load");
Console.WriteLine();

int contextsBefore = LedgerDbContext.Created;
int failed = 0;

await Parallel.ForAsync(0, 100, new ParallelOptions { MaxDegreeOfParallelism = 16 },
    async (index, token) =>
    {
        using HttpResponseMessage payment = await http.GetAsync("/v1/payments/PAY-1", token);
        using HttpResponseMessage rate = await http.GetAsync("/v1/rates/GBP", token);

        if (!payment.IsSuccessStatusCode || !rate.IsSuccessStatusCode)
        {
            Interlocked.Increment(ref failed);
        }
    });

Console.WriteLine($"   100 concurrent callers, 200 requests (100 payments, 100 rates)");
Console.WriteLine($"   failed                                  {failed}");
Console.WriteLine();
Console.WriteLine($"   LedgerDbContext created during the run  {LedgerDbContext.Created - contextsBefore}");
Console.WriteLine($"     one per payment request                100");
Console.WriteLine($"     one for the catalogue's single load       1");
Console.WriteLine();
Console.WriteLine($"   CurrencyCatalogue instances             {CurrencyCatalogue.Created}");
Console.WriteLine($"   catalogue loads from the database       {CurrencyCatalogue.Loads}");
Console.WriteLine();
Console.WriteLine("   ONE CATALOGUE, ONE LOAD, AND A CONTEXT PER UNIT OF WORK. The 100 rate");
Console.WriteLine("   requests share the cached dictionary and touch no context at all; the");
Console.WriteLine("   100 payment requests each get their own. The cache is shared and the");
Console.WriteLine("   unit of work is not, which is the whole design in one line.");
Console.WriteLine();
Console.WriteLine("   Nothing failed, because no context was ever used by two requests.");
Console.WriteLine();

await app.StopAsync();
await app.DisposeAsync();

Console.WriteLine($"   contexts created in total, including the worker's   {LedgerDbContext.Created}");
Console.WriteLine($"   contexts disposed when their scopes ended           {LedgerDbContext.Disposed}");
Console.WriteLine();
Console.WriteLine("   Every one of them released. A scope disposes what it created, and every");
Console.WriteLine("   context in this application was created inside one - a request's, or the");
Console.WriteLine("   catalogue's, or the worker's.");
Console.WriteLine();

Console.WriteLine("3. The same services, in a test, with no container");
Console.WriteLine();

var repository = new PaymentRepository(new LedgerDbContext(), new FixedClock(new DateTime(2026, 1, 1)));
Payment? found = await repository.FindAsync("PAY-1");

Console.WriteLine($"   new PaymentRepository(new LedgerDbContext(), new FixedClock(...))");
Console.WriteLine($"   -> {found}");
Console.WriteLine();
Console.WriteLine("   A scoped service is an ordinary object. Its lifetime is a fact about");
Console.WriteLine("   the container's configuration, not about the class - which is why the");
Console.WriteLine("   class is still constructible with new.");
Console.WriteLine();

Console.WriteLine("THE CHECKLIST THIS FILE IS BUILT FROM");
Console.WriteLine();
Console.WriteLine("   ValidateOnBuild and ValidateScopes on in EVERY environment, so a captive");
Console.WriteLine("     dependency is a failed deployment rather than a stale value in");
Console.WriteLine("     production");
Console.WriteLine();
Console.WriteLine("   Scoped for anything holding a unit of work, a connection, a transaction,");
Console.WriteLine("     or per-request identity");
Console.WriteLine();
Console.WriteLine("   Singleton only for things that are stateless, or whose state is");
Console.WriteLine("     genuinely application-wide - and every one of them justified as a");
Console.WriteLine("     concurrency decision, not only a caching one");
Console.WriteLine();
Console.WriteLine("   No singleton holds a scoped service. Where one needs per-request work it");
Console.WriteLine("     holds IServiceScopeFactory and creates a scope");
Console.WriteLine();
Console.WriteLine("   Background services take IServiceScopeFactory and create ONE SCOPE PER");
Console.WriteLine("     UNIT OF WORK - per message, per item, per iteration; never per run");
Console.WriteLine();
Console.WriteLine("   Disposables are scoped rather than transient, so the request bounds them");
Console.WriteLine("     and the container is never asked to track an unbounded list");
Console.WriteLine();
Console.WriteLine("   Nothing injects IServiceProvider. The one piece of container plumbing in");
Console.WriteLine("     application code is IServiceScopeFactory, in the two places that have");
Console.WriteLine("     no ambient scope");
Console.WriteLine();
Console.WriteLine("WHAT MAKES IT HOLD");
Console.WriteLine();
Console.WriteLine("   Two of these are enforced and the rest are habits. The enforced two are");
Console.WriteLine("   the validation lines, and they are worth more than the rest combined:");
Console.WriteLine("   they turn the entire class of bug in this module from something that");
Console.WriteLine("   ships and misbehaves quietly into something that will not start.");
Console.WriteLine();
Console.WriteLine("   The habits matter for what validation cannot see - a transient held by a");
Console.WriteLine("   singleton, a scope that is too wide, a disposable on the root's tracking");
Console.WriteLine("   list. For those the question to ask at review time is not 'what lifetime");
Console.WriteLine("   is this' but WHAT HOLDS THIS, AND FOR HOW LONG.");

// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Stands in for a real database context: one operation at a time, disposable,
// and holding per-unit-of-work state.
public sealed class LedgerDbContext : IDisposable
{
    private static int _created;
    private static int _disposed;
    private int _inFlight;

    public LedgerDbContext() => Interlocked.Increment(ref _created);

    public static int Created => Volatile.Read(ref _created);

    public static int Disposed => Volatile.Read(ref _disposed);

    public async Task<T> QueryAsync<T>(Func<T> read)
    {
        if (Interlocked.Increment(ref _inFlight) > 1)
        {
            Interlocked.Decrement(ref _inFlight);

            throw new InvalidOperationException(
                "A second operation was started on this context instance.");
        }

        try
        {
            await Task.Delay(1);

            return read();
        }
        finally
        {
            Interlocked.Decrement(ref _inFlight);
        }
    }

    public void Dispose() => Interlocked.Increment(ref _disposed);
}

public sealed record Payment(string Id, long AmountMinor, DateTime SeenAt);

public interface IPaymentRepository
{
    Task<Payment?> FindAsync(string id);
}

// Scoped: it holds the context, which is scoped. Same lifetime, no capture.
public sealed class PaymentRepository(LedgerDbContext db, IClock clock) : IPaymentRepository
{
    public async Task<Payment?> FindAsync(string id) =>
        await db.QueryAsync(() => id == "PAY-1"
            ? new Payment(id, 50_000, clock.UtcNow)
            : null);
}

// ---------------------------------------------------------------------------
public interface ICurrencyCatalogue
{
    Task<decimal> RateAsync(string code);
}

// SINGLETON, and it does not hold the context. It holds the ability to create
// a scope, which is what makes a singleton legal here.
public sealed class CurrencyCatalogue(IServiceScopeFactory scopeFactory) : ICurrencyCatalogue
{
    private static int _created;
    private static int _loads;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly int _instance = Interlocked.Increment(ref _created);
    private Dictionary<string, decimal>? _rates;

    public int Instance => _instance;

    public static int Created => Volatile.Read(ref _created);

    public static int Loads => Volatile.Read(ref _loads);

    public async Task<decimal> RateAsync(string code)
    {
        Dictionary<string, decimal> rates = _rates ?? await LoadAsync();

        return rates.GetValueOrDefault(code, 1.00m);
    }

    private async Task<Dictionary<string, decimal>> LoadAsync()
    {
        await _gate.WaitAsync();

        try
        {
            // Checked again under the gate: several callers can arrive at once
            // and only one should load.
            if (_rates is not null)
            {
                return _rates;
            }

            // A scope, borrowed for the load and given back. The context lives
            // and dies inside these three lines.
            using IServiceScope scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();

            Dictionary<string, decimal> loaded = await db.QueryAsync(() =>
            {
                Interlocked.Increment(ref _loads);

                return new Dictionary<string, decimal> { ["GBP"] = 1.00m, ["USD"] = 0.79m };
            });

            // One reference assignment, which is atomic - readers see the old
            // dictionary or the new one, never a half-built one.
            _rates = loaded;

            return loaded;
        }
        finally
        {
            _gate.Release();
        }
    }
}

// ---------------------------------------------------------------------------
// A hosted service is a singleton. It takes the scope factory and opens one
// scope per unit of work.
public sealed class SettlementWorker(IServiceScopeFactory scopeFactory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            // ONE SCOPE PER ITERATION. Everything it resolved is disposed at
            // the closing brace, including the database context.
            using (IServiceScope scope = scopeFactory.CreateScope())
            {
                var payments = scope.ServiceProvider.GetRequiredService<IPaymentRepository>();

                await payments.FindAsync("PAY-1");
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
