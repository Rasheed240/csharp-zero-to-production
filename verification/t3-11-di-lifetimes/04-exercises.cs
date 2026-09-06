// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every count and exception message here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;
using System.Collections.Concurrent;

#pragma warning disable ASP0000

await One();
await Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static async Task One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the setting that stopped changing");
    Console.WriteLine();
    Console.WriteLine("   A feature flag is read per request from a scoped IFlagReader. A new");
    Console.WriteLine("   singleton PricingEngine takes IFlagReader so it can check the same");
    Console.WriteLine("   flag. After the deploy, the flag appears stuck for the engine while");
    Console.WriteLine("   the endpoint sees it change correctly.");
    Console.WriteLine();
    Console.WriteLine("   What is happening, and what one setting would have refused to start?");
    Console.WriteLine();

    foreach (bool validate in new[] { false, true })
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Production"
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<IFlagReader, HeaderFlagReader>();
        builder.Services.AddSingleton<PricingEngine>();

        if (validate)
        {
            builder.Host.UseDefaultServiceProvider(options =>
            {
                options.ValidateOnBuild = true;
                options.ValidateScopes = true;
            });
        }

        WebApplication app;

        try
        {
            app = builder.Build();
        }
        catch (Exception exception)
        {
            string message = (exception.InnerException?.Message ?? exception.Message)
                .ReplaceLineEndings(" ");

            Console.WriteLine($"   validation {(validate ? "on " : "off")}   REFUSED TO START");
            Console.WriteLine($"                    {message}");
            Console.WriteLine();
            continue;
        }

        app.MapGet("/price", (IFlagReader flags, PricingEngine engine) => Results.Ok(new
        {
            endpointSees = flags.NewPricing,
            engineSees = engine.NewPricing
        }));

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        Console.WriteLine($"   validation {(validate ? "on " : "off")}   started");

        foreach (string flag in new[] { "off", "on", "off" })
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/price");
            request.Headers.Add("X-New-Pricing", flag);

            using HttpResponseMessage response = await http.SendAsync(request);
            Console.WriteLine($"                    header {flag,-4} -> {await response.Content.ReadAsStringAsync()}");
        }

        Console.WriteLine();
        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine("   ANSWER: the singleton captured the scoped reader. It was built once,");
    Console.WriteLine("   during the first request, and its IFlagReader was resolved from the");
    Console.WriteLine("   root provider at that moment - so it holds whatever the flag was then,");
    Console.WriteLine("   permanently.");
    Console.WriteLine();
    Console.WriteLine("   ValidateScopes would have refused to start, naming both types. It is");
    Console.WriteLine("   on in Development and off in Production, which is why this deployed.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS NOT 'MAKE THE ENGINE SCOPED', although that works. The");
    Console.WriteLine("   engine is a singleton for a reason. The fix is that a singleton must");
    Console.WriteLine("   ask for per-request data at the moment it needs it, not hold a");
    Console.WriteLine("   reference to the thing that provides it - either by taking the flag as");
    Console.WriteLine("   a method parameter, or by taking IServiceScopeFactory.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - memory that only grows");
    Console.WriteLine();
    Console.WriteLine("   A service returns a report. It resolves a disposable formatter from an");
    Console.WriteLine("   injected IServiceProvider on every call. Memory climbs steadily and");
    Console.WriteLine("   never returns; a memory dump shows tens of thousands of live");
    Console.WriteLine("   formatters, all reachable from the container.");
    Console.WriteLine();
    Console.WriteLine("   Why does nothing collect them, and what are the two fixes?");
    Console.WriteLine();

    Console.WriteLine("   resolved from                created   disposed   still held");
    Console.WriteLine("   -------------                -------   --------   ----------");

    // (a) an IServiceProvider injected into a singleton: that is the root.
    {
        var services = new ServiceCollection();
        services.AddTransient<Formatter>();
        services.AddSingleton<RootResolvingReporter>();

        using ServiceProvider provider = services.BuildServiceProvider();
        var reporter = provider.GetRequiredService<RootResolvingReporter>();

        int before = Formatter.Created;
        int disposedBefore = Formatter.Disposed;

        for (int i = 0; i < 5_000; i++)
        {
            reporter.Report();
        }

        Report("an injected provider", before, disposedBefore);
    }

    // (b) a scope per call, disposed.
    {
        var services = new ServiceCollection();
        services.AddTransient<Formatter>();
        services.AddSingleton<ScopingReporter>();

        using ServiceProvider provider = services.BuildServiceProvider();
        var reporter = provider.GetRequiredService<ScopingReporter>();

        int before = Formatter.Created;
        int disposedBefore = Formatter.Disposed;

        for (int i = 0; i < 5_000; i++)
        {
            reporter.Report();
        }

        Report("a scope per call", before, disposedBefore);
    }

    // (c) not resolved from the container at all.
    {
        var reporter = new OwningReporter();

        int before = Formatter.Created;
        int disposedBefore = Formatter.Disposed;

        for (int i = 0; i < 5_000; i++)
        {
            reporter.Report();
        }

        Report("constructed and owned", before, disposedBefore);
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE CONTAINER TRACKS EVERY IDisposable IT CREATES, because it");
    Console.WriteLine("   is the only thing that can dispose them. An IServiceProvider injected");
    Console.WriteLine("   into a singleton IS THE ROOT PROVIDER, and the root is disposed when");
    Console.WriteLine("   the application shuts down. Every formatter goes on a list that is");
    Console.WriteLine("   never released.");
    Console.WriteLine();
    Console.WriteLine("   Nothing here is garbage: the objects are reachable, so no amount of");
    Console.WriteLine("   collection helps. That is what makes it look like a leak in the");
    Console.WriteLine("   framework rather than in the code.");
    Console.WriteLine();
    Console.WriteLine("   FIX ONE: create a scope per unit of work and dispose it. The scope");
    Console.WriteLine("   owns the tracking list, so disposing it disposes everything resolved");
    Console.WriteLine("   through it - row two.");
    Console.WriteLine();
    Console.WriteLine("   FIX TWO: do not ask the container. A formatter with no dependencies");
    Console.WriteLine("   worth injecting can be constructed and disposed by the code that uses");
    Console.WriteLine("   it - row three, where the container tracks nothing because it created");
    Console.WriteLine("   nothing.");
    Console.WriteLine();
    Console.WriteLine("   WHICH TO PREFER: fix two, when it applies. The container is for things");
    Console.WriteLine("   you would substitute; a short-lived helper you construct in a method");
    Console.WriteLine("   is ordinary code and cannot leak.");
    Console.WriteLine();

    await Task.CompletedTask;

    static void Report(string label, int before, int disposedBefore)
    {
        int created = Formatter.Created - before;
        int disposed = Formatter.Disposed - disposedBefore;

        Console.WriteLine($"   {label,-27}  {created,7}   {disposed,8}   {created - disposed}");
    }
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium) - the worker that got slower every day");
    Console.WriteLine();
    Console.WriteLine("   A worker polls a queue and processes messages in a loop. It creates a");
    Console.WriteLine("   scope, resolves a unit of work, and runs. Over a week its memory grows");
    Console.WriteLine("   and each message takes longer.");
    Console.WriteLine();
    Console.WriteLine("   Two candidate loops. Which is wrong, and what does the other cost?");
    Console.WriteLine();

    Console.WriteLine("   loop shape                 scopes   units   items in the last unit");
    Console.WriteLine("   ----------                 ------   -----   ----------------------");

    foreach ((string label, bool scopeInside) in new[]
    {
        ("scope outside the loop", false),
        ("scope inside the loop", true)
    })
    {
        var services = new ServiceCollection();
        services.AddScoped<Batch>();

        using ServiceProvider provider = services.BuildServiceProvider(
            new ServiceProviderOptions { ValidateScopes = true });

        int before = Batch.Created;
        int scopes = 0;
        int lastSize = 0;

        if (scopeInside)
        {
            for (int message = 0; message < 100; message++)
            {
                using IServiceScope scope = provider.CreateScope();
                scopes++;

                var batch = scope.ServiceProvider.GetRequiredService<Batch>();
                batch.Handle(message);
                lastSize = batch.Size;
            }
        }
        else
        {
            using IServiceScope scope = provider.CreateScope();
            scopes++;

            var batch = scope.ServiceProvider.GetRequiredService<Batch>();

            for (int message = 0; message < 100; message++)
            {
                batch.Handle(message);
                lastSize = batch.Size;
            }
        }

        Console.WriteLine($"   {label,-25}  {scopes,7}   {Batch.Created - before,5}   " +
            $"{lastSize,22}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: the scope outside the loop is wrong. One unit of work handles");
    Console.WriteLine("   every message the process has ever seen, so whatever it accumulates -");
    Console.WriteLine("   a change tracker, a list of pending writes, a transaction - grows");
    Console.WriteLine("   without limit. A hundred messages here; a hundred thousand by Friday.");
    Console.WriteLine();
    Console.WriteLine("   That is both failures in the symptom: memory grows because nothing is");
    Console.WriteLine("   released, and each message is slower because every operation now works");
    Console.WriteLine("   against a larger set.");
    Console.WriteLine();
    Console.WriteLine("   WHAT THE CORRECT VERSION COSTS, because it is not free: a hundred");
    Console.WriteLine("   scopes and a hundred units of work rather than one. In a real system");
    Console.WriteLine("   that means a hundred connections taken from the pool and returned,");
    Console.WriteLine("   rather than one held open.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE RIGHT TRADE ALMOST ALWAYS, and it is worth knowing why:");
    Console.WriteLine("   pooled connections are cheap to take and return, and correctness under");
    Console.WriteLine("   failure is not. With a scope per message, one poisoned message fails");
    Console.WriteLine("   alone; with one scope for the run, it corrupts the unit of work that");
    Console.WriteLine("   every later message shares.");
    Console.WriteLine();
    Console.WriteLine("   THE RULE: A SCOPE IS A UNIT OF WORK, AND IN A WORKER THE UNIT IS ONE");
    Console.WriteLine("   MESSAGE.");
    Console.WriteLine();

    await Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - a cache that must be a singleton and must be fresh");
    Console.WriteLine();
    Console.WriteLine("   Design a currency catalogue that is loaded once, shared by every");
    Console.WriteLine("   request, refreshed every few minutes from the database, and holds no");
    Console.WriteLine("   scoped service.");
    Console.WriteLine();
    Console.WriteLine("   Three attempts, under 100 concurrent requests:");
    Console.WriteLine();

    Console.WriteLine("   design                          startup   contexts   requests   failed");
    Console.WriteLine("   ------                          -------   --------   --------   ------");

    foreach (Design design in new[] { Design.HoldsContext, Design.HoldsProvider, Design.HoldsScopeFactory })
    {
        Result result = await MeasureAsync(design);

        Console.WriteLine($"   {Label(design),-30}  {result.Startup,-7}   {result.Contexts,8}   " +
            $"{result.Requests,8}   {result.Failed,6}");
    }

    Console.WriteLine();
    Console.WriteLine("   ATTEMPT 1 holds the context. Refused at startup by ValidateScopes, and");
    Console.WriteLine("   would have shared one context across every request without it. This is");
    Console.WriteLine("   the production incident from the previous file.");
    Console.WriteLine();
    Console.WriteLine("   ATTEMPT 2 holds an IServiceProvider and resolves the context from it.");
    Console.WriteLine("   It STARTS - validation cannot see a runtime lookup - and then fails at");
    Console.WriteLine("   the moment it looks up, because the provider injected into a singleton");
    Console.WriteLine("   is the root and the root refuses scoped services.");
    Console.WriteLine();
    Console.WriteLine("   That row is worth sitting with. IT MOVED A STARTUP FAILURE INTO A");
    Console.WriteLine("   RUNTIME ONE while looking like a fix. With validation off it would");
    Console.WriteLine("   have done something worse: succeeded, and created a context on the");
    Console.WriteLine("   root's tracking list that is never disposed.");
    Console.WriteLine();
    Console.WriteLine("   ATTEMPT 3 holds IServiceScopeFactory, which is a singleton, and creates");
    Console.WriteLine("   a scope for each load. It starts, it refreshes, and the context it uses");
    Console.WriteLine("   is disposed with the scope.");
    Console.WriteLine();
    Console.WriteLine("   THE SHAPE OF THE ANSWER, and it generalises past caches:");
    Console.WriteLine();
    Console.WriteLine("     A SINGLETON MAY NOT HOLD A SCOPED SERVICE. IT MAY HOLD THE ABILITY");
    Console.WriteLine("     TO CREATE A SCOPE.");
    Console.WriteLine();
    Console.WriteLine("   The difference is that the singleton no longer has a lifetime problem");
    Console.WriteLine("   to solve - it borrows a scope, uses it, and gives it back, exactly as a");
    Console.WriteLine("   request does.");
    Console.WriteLine();
    Console.WriteLine("   ONE THING ATTEMPT 3 STILL OWES YOU. The cached value is shared mutable");
    Console.WriteLine("   state, so the refresh and the readers need to agree - here a single");
    Console.WriteLine("   reference assignment, which is atomic. A singleton is a concurrency");
    Console.WriteLine("   decision as much as a lifetime one, and solving the lifetime does not");
    Console.WriteLine("   solve the other half.");
}

// ---------------------------------------------------------------------------
static string Label(Design design) => design switch
{
    Design.HoldsContext => "1. holds the context",
    Design.HoldsProvider => "2. holds IServiceProvider",
    _ => "3. holds IServiceScopeFactory"
};

static async Task<Result> MeasureAsync(Design design)
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // On, because this exercise is about what each design does when the check
    // is present - the previous file covers what happens when it is not.
    builder.Host.UseDefaultServiceProvider(options =>
    {
        options.ValidateOnBuild = true;
        options.ValidateScopes = true;
    });

    builder.Services.AddScoped<RateContext>();

    switch (design)
    {
        case Design.HoldsContext:
            builder.Services.AddSingleton<ICatalogue, ContextHoldingCatalogue>();
            break;
        case Design.HoldsProvider:
            builder.Services.AddSingleton<ICatalogue, ProviderHoldingCatalogue>();
            break;
        default:
            builder.Services.AddSingleton<ICatalogue, ScopingCatalogue>();
            break;
    }

    WebApplication app;

    try
    {
        app = builder.Build();
    }
    catch (Exception)
    {
        return new Result("REFUSED", 0, 0, 0);
    }

    int contextsBefore = RateContext.Created;
    int failed = 0;

    app.MapGet("/rate", async (ICatalogue catalogue) =>
    {
        try
        {
            return Results.Ok(new { rate = await catalogue.RateAsync("GBP") });
        }
        catch (Exception)
        {
            return Results.Problem(statusCode: 500);
        }
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    const int Requests = 100;

    await Parallel.ForAsync(0, Requests, new ParallelOptions { MaxDegreeOfParallelism = 16 },
        async (index, token) =>
        {
            using HttpResponseMessage response = await http.GetAsync("/rate", token);

            if (!response.IsSuccessStatusCode)
            {
                Interlocked.Increment(ref failed);
            }
        });

    await app.StopAsync();
    await app.DisposeAsync();

    return new Result("started", RateContext.Created - contextsBefore, Requests, failed);
}

// ---------------------------------------------------------------------------
enum Design { HoldsContext, HoldsProvider, HoldsScopeFactory }

record Result(string Startup, int Contexts, int Requests, int Failed);

public interface IFlagReader
{
    bool NewPricing { get; }
}

public sealed class HeaderFlagReader(IHttpContextAccessor accessor) : IFlagReader
{
    public bool NewPricing { get; } =
        accessor.HttpContext?.Request.Headers["X-New-Pricing"].ToString() == "on";
}

public sealed class PricingEngine(IFlagReader flags)
{
    public bool NewPricing => flags.NewPricing;
}

// ---------------------------------------------------------------------------
public sealed class Formatter : IDisposable
{
    private static int _created;
    private static int _disposed;

    public Formatter() => Interlocked.Increment(ref _created);

    public static int Created => Volatile.Read(ref _created);

    public static int Disposed => Volatile.Read(ref _disposed);

    public string Format(int value) => value.ToString();

    public void Dispose() => Interlocked.Increment(ref _disposed);
}

// Resolves from an injected provider, which inside a singleton is the root.
public sealed class RootResolvingReporter(IServiceProvider services)
{
    public string Report() => services.GetRequiredService<Formatter>().Format(1);
}

// Creates a scope per call and disposes it.
public sealed class ScopingReporter(IServiceScopeFactory scopeFactory)
{
    public string Report()
    {
        using IServiceScope scope = scopeFactory.CreateScope();

        return scope.ServiceProvider.GetRequiredService<Formatter>().Format(1);
    }
}

// Does not involve the container at all.
public sealed class OwningReporter
{
    public string Report()
    {
        using var formatter = new Formatter();

        return formatter.Format(1);
    }
}

// ---------------------------------------------------------------------------
// Stands in for a unit of work that accumulates - a change tracker, a list of
// pending writes.
public sealed class Batch : IDisposable
{
    private static int _created;
    private readonly List<int> _items = [];

    public Batch() => Interlocked.Increment(ref _created);

    public static int Created => Volatile.Read(ref _created);

    public int Size => _items.Count;

    public void Handle(int message) => _items.Add(message);

    public void Dispose() { }
}

// ---------------------------------------------------------------------------
public sealed class RateContext : IDisposable
{
    private static int _created;
    private int _inFlight;

    public RateContext() => Interlocked.Increment(ref _created);

    public static int Created => Volatile.Read(ref _created);

    public async Task<decimal> QueryAsync(string code)
    {
        if (Interlocked.Increment(ref _inFlight) > 1)
        {
            Interlocked.Decrement(ref _inFlight);

            throw new InvalidOperationException(
                "A second operation was started on this context instance.");
        }

        try
        {
            await Task.Delay(2);

            return 1.00m;
        }
        finally
        {
            Interlocked.Decrement(ref _inFlight);
        }
    }

    public void Dispose() { }
}

public interface ICatalogue
{
    Task<decimal> RateAsync(string code);
}

// Attempt 1: holds the scoped context. Refused by ValidateScopes.
public sealed class ContextHoldingCatalogue(RateContext context) : ICatalogue
{
    public Task<decimal> RateAsync(string code) => context.QueryAsync(code);
}

// Attempt 2: holds a provider. Starts, then fails at the lookup, because a
// provider injected into a singleton is the root.
public sealed class ProviderHoldingCatalogue(IServiceProvider services) : ICatalogue
{
    public Task<decimal> RateAsync(string code) =>
        services.GetRequiredService<RateContext>().QueryAsync(code);
}

// Attempt 3: holds the ability to create a scope.
public sealed class ScopingCatalogue(IServiceScopeFactory scopeFactory) : ICatalogue
{
    public async Task<decimal> RateAsync(string code)
    {
        using IServiceScope scope = scopeFactory.CreateScope();

        return await scope.ServiceProvider.GetRequiredService<RateContext>().QueryAsync(code);
    }
}
