// 02-services-and-scopes.cs — What the host does with your registrations: one
// scope per request, and the host options that make a bad registration fail at
// startup instead of under load. Lifetimes get their own module later; this
// file is about the HOST's part in them.
//
// Run:  dotnet run 02-services-and-scopes.cs -c Release
//
// EXACT vs RATIO: every count here is exact. Instances are counted by their
// own constructors.

#:sdk Microsoft.NET.Sdk.Web

using Microsoft.Extensions.DependencyInjection;

// ASP0000 warns against BuildServiceProvider in application code, because it
// creates a second copy of every singleton. That is sound advice for a real
// startup file and it is exactly what sections 2, 3 and 4 need: standalone
// containers with different validation options, built side by side.
#pragma warning disable ASP0000

Counters.Reset();

await ThreeLifetimes();
CaptiveDependency();
ScopeValidation();
TransientDisposableLeak();
await InsideABackgroundService();

// ---------------------------------------------------------------------------
static async Task ThreeLifetimes()
{
    Console.WriteLine("1. The three lifetimes, counted");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddSingleton<SingletonService>();
    builder.Services.AddScoped<ScopedService>();
    builder.Services.AddTransient<TransientService>();

    var app = builder.Build();

    // Two of each per request, so "per scope" is distinguishable from
    // "per resolution".
    app.MapGet("/", (SingletonService s1, SingletonService s2,
                     ScopedService c1, ScopedService c2,
                     TransientService t1, TransientService t2) =>
        $"singleton {s1.Id},{s2.Id}  scoped {c1.Id},{c2.Id}  transient {t1.Id},{t2.Id}");

    await app.StartAsync();

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request   singleton   scoped   transient");
    Console.WriteLine("   -------   ---------   ------   ---------");

    for (int i = 1; i <= 3; i++)
    {
        string body = await http.GetStringAsync("/");
        string[] parts = body.Split("  ", StringSplitOptions.RemoveEmptyEntries);
        Console.WriteLine($"   {i,7}   {parts[0].Replace("singleton ", ""),9}   " +
            $"{parts[1].Replace("scoped ", ""),6}   {parts[2].Replace("transient ", ""),9}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   SINGLETON   one instance for the life of the application. The same");
    Console.WriteLine("               id in every column and every row.");
    Console.WriteLine();
    Console.WriteLine("   SCOPED      one instance per scope. ASP.NET Core creates exactly one");
    Console.WriteLine("               scope per request, so the two resolutions inside a");
    Console.WriteLine("               request match each other and differ between requests.");
    Console.WriteLine();
    Console.WriteLine("   TRANSIENT   a new instance every time it is asked for. Two per");
    Console.WriteLine("               request, six across three requests.");
    Console.WriteLine();
    Console.WriteLine("   The default choice is SCOPED for anything holding per-request state");
    Console.WriteLine("   or a database connection, SINGLETON for anything stateless and");
    Console.WriteLine("   expensive to build, and TRANSIENT rarely - it is the one that");
    Console.WriteLine("   surprises people, because a transient resolved by a singleton lives");
    Console.WriteLine("   as long as the singleton.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void CaptiveDependency()
{
    Console.WriteLine("2. The captive dependency");
    Console.WriteLine();
    Console.WriteLine("   A SINGLETON that depends on a SCOPED service. The singleton is built");
    Console.WriteLine("   once and keeps whatever it was given, so the scoped service is");
    Console.WriteLine("   CAPTURED and lives forever - one instance shared by every request,");
    Console.WriteLine("   which is the exact opposite of what 'scoped' promised.");
    Console.WriteLine();

    var services = new ServiceCollection();
    services.AddSingleton<CapturingSingleton>();
    services.AddScoped<ScopedService>();

    // ValidateScopes off - which is what a Production environment does.
    ServiceProvider unvalidated = services.BuildServiceProvider(
        new ServiceProviderOptions { ValidateScopes = false });

    Counters.Reset();

    var ids = new List<int>();
    for (int i = 0; i < 3; i++)
    {
        using IServiceScope scope = unvalidated.CreateScope();
        var captor = scope.ServiceProvider.GetRequiredService<CapturingSingleton>();
        ids.Add(captor.Captured.Id);
    }

    Console.WriteLine($"   ValidateScopes = false");
    Console.WriteLine($"     scoped ids seen across 3 scopes : {string.Join(", ", ids)}");
    Console.WriteLine($"     ScopedService instances created : {Counters.Scoped}");
    Console.WriteLine();
    Console.WriteLine("   One instance, shared by three scopes, and no error. In a real");
    Console.WriteLine("   application that scoped service is usually a DbContext, and this is");
    Console.WriteLine("   how one gets shared across every concurrent request in the process.");
    Console.WriteLine();
    Console.WriteLine("   DbContext is not thread-safe. The symptom is not a clean failure:");
    Console.WriteLine("   it is 'A second operation was started on this context instance");
    Console.WriteLine("   before a previous operation completed', intermittently, under load,");
    Console.WriteLine("   from a stack trace that points at whichever request lost the race.");
    Console.WriteLine();

    unvalidated.Dispose();
}

// ---------------------------------------------------------------------------
static void ScopeValidation()
{
    Console.WriteLine("3. The validation that catches it");
    Console.WriteLine();

    var services = new ServiceCollection();
    services.AddSingleton<CapturingSingleton>();
    services.AddScoped<ScopedService>();

    ServiceProvider validated = services.BuildServiceProvider(
        new ServiceProviderOptions { ValidateScopes = true });

    string captiveResult;
    try
    {
        using IServiceScope scope = validated.CreateScope();
        scope.ServiceProvider.GetRequiredService<CapturingSingleton>();
        captiveResult = "no error - the captive dependency was allowed";
    }
    catch (InvalidOperationException ex)
    {
        captiveResult = $"{ex.GetType().Name}: {Truncate(ex.Message)}";
    }

    string rootResult;
    try
    {
        // Asking the ROOT provider for a scoped service. There is no scope,
        // so the only thing it could do is give it the root's lifetime.
        validated.GetRequiredService<ScopedService>();
        rootResult = "no error - a scoped service came out of the root provider";
    }
    catch (InvalidOperationException ex)
    {
        rootResult = $"{ex.GetType().Name}: {Truncate(ex.Message)}";
    }

    Console.WriteLine("   with ValidateScopes = true:");
    Console.WriteLine();
    Console.WriteLine($"     singleton depending on scoped");
    Console.WriteLine($"       {captiveResult}");
    Console.WriteLine();
    Console.WriteLine($"     scoped resolved from the root provider");
    Console.WriteLine($"       {rootResult}");
    Console.WriteLine();
    Console.WriteLine("   Both are caught, and this is the setting that matters:");
    Console.WriteLine();
    Console.WriteLine("     ValidateScopes    on in DEVELOPMENT, off in PRODUCTION, by default");
    Console.WriteLine("     ValidateOnBuild   off by default in both");
    Console.WriteLine();
    Console.WriteLine("   Read that again, because it is the whole trap. The check that finds");
    Console.WriteLine("   captive dependencies is DISABLED in the environment where the bug");
    Console.WriteLine("   costs something. A service that runs correctly in Development can");
    Console.WriteLine("   share one DbContext across every request in Production.");
    Console.WriteLine();
    Console.WriteLine("   Turn both on everywhere:");
    Console.WriteLine();
    Console.WriteLine("     builder.Host.UseDefaultServiceProvider(options =>");
    Console.WriteLine("     {");
    Console.WriteLine("         options.ValidateScopes = true;");
    Console.WriteLine("         options.ValidateOnBuild = true;");
    Console.WriteLine("     });");
    Console.WriteLine();
    Console.WriteLine("   ValidateOnBuild is the more valuable of the two: it walks every");
    Console.WriteLine("   registration at startup and fails immediately on anything it cannot");
    Console.WriteLine("   construct. Without it, a missing registration is discovered by the");
    Console.WriteLine("   first request that needs it - which may be a rarely used endpoint,");
    Console.WriteLine("   found in production, hours after the deploy looked successful.");
    Console.WriteLine();
    Console.WriteLine("   The cost is a slower startup proportional to the number of");
    Console.WriteLine("   registrations. That is a good trade for a crash that happens before");
    Console.WriteLine("   the load balancer sends you anything.");
    Console.WriteLine();

    validated.Dispose();

    static string Truncate(string message)
    {
        int stop = message.IndexOf(" (Parameter", StringComparison.Ordinal);
        string trimmed = stop > 0 ? message[..stop] : message;
        return trimmed.Length > 150 ? trimmed[..150] + "..." : trimmed;
    }
}

// ---------------------------------------------------------------------------
static void TransientDisposableLeak()
{
    Console.WriteLine("4. Transient disposables held by the root provider");
    Console.WriteLine();

    var services = new ServiceCollection();
    services.AddTransient<DisposableService>();

    ServiceProvider provider = services.BuildServiceProvider(
        new ServiceProviderOptions { ValidateScopes = false });

    Counters.Reset();

    // Resolved from the ROOT, as a background service or a startup task would.
    for (int i = 0; i < 1000; i++)
    {
        provider.GetRequiredService<DisposableService>();
    }

    int rootCreated = Counters.Disposable;
    int rootDisposed = Counters.DisposableDisposed;

    Console.WriteLine($"   1000 transients resolved from the root provider");
    Console.WriteLine($"     created  : {rootCreated}");
    Console.WriteLine($"     disposed : {rootDisposed}");
    Console.WriteLine();

    // The same 1000, each inside its own scope. Counters are NOT reset here -
    // the running totals are what make the final tally add up.
    int beforeScoped = Counters.Disposable;
    int beforeScopedDisposed = Counters.DisposableDisposed;
    for (int i = 0; i < 1000; i++)
    {
        using IServiceScope scope = provider.CreateScope();
        scope.ServiceProvider.GetRequiredService<DisposableService>();
    }

    Console.WriteLine($"   the same 1000, each inside its own scope");
    Console.WriteLine($"     created  : {Counters.Disposable - beforeScoped}");
    Console.WriteLine($"     disposed : {Counters.DisposableDisposed - beforeScopedDisposed}");
    Console.WriteLine();
    Console.WriteLine("   THE CONTAINER DISPOSES WHAT IT CREATED, WHEN ITS SCOPE ENDS. The");
    Console.WriteLine("   root provider's scope ends when the application shuts down, so");
    Console.WriteLine("   every transient disposable resolved from it is held until then.");
    Console.WriteLine();
    Console.WriteLine("   That is an unbounded list of live objects growing for the life of");
    Console.WriteLine("   the process. It looks exactly like a memory leak because it is one,");
    Console.WriteLine("   and a heap dump shows the objects rooted by the ServiceProvider,");
    Console.WriteLine("   which is a confusing place to find them.");
    Console.WriteLine();
    Console.WriteLine("   It does not happen inside a request, because the request scope ends");
    Console.WriteLine("   and takes them with it. It happens in the places where there is no");
    Console.WriteLine("   ambient scope: background services, startup code, timers.");
    Console.WriteLine();
    Console.WriteLine("   Two rules that avoid it:");
    Console.WriteLine();
    Console.WriteLine("     - Do not register something disposable as transient unless you");
    Console.WriteLine("       know who owns the scope it will be resolved in.");
    Console.WriteLine("     - Outside a request, always create a scope for a unit of work and");
    Console.WriteLine("       dispose it. That is section 5.");
    Console.WriteLine();

    int liveBeforeDispose = Counters.Disposable - Counters.DisposableDisposed;
    int disposedBefore = Counters.DisposableDisposed;
    provider.Dispose();

    Console.WriteLine($"   objects still alive before provider.Dispose() : {liveBeforeDispose}");
    Console.WriteLine($"   disposed by provider.Dispose()                : " +
        $"{Counters.DisposableDisposed - disposedBefore}");
    Console.WriteLine();
    Console.WriteLine("   They are released - at shutdown, which is too late to be useful.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task InsideABackgroundService()
{
    Console.WriteLine("5. Getting a scoped service inside a background service");
    Console.WriteLine();
    Console.WriteLine("   A BackgroundService is a SINGLETON. It cannot take a scoped service");
    Console.WriteLine("   in its constructor - that is the captive dependency from section 2,");
    Console.WriteLine("   and with validation on it will not even start.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Host.UseDefaultServiceProvider(options =>
    {
        options.ValidateScopes = true;
        options.ValidateOnBuild = true;
    });

    builder.Services.AddScoped<ScopedService>();
    builder.Services.AddHostedService<Worker>();

    var app = builder.Build();
    await app.StartAsync();

    while (Worker.ScopedIds.Count < 3)
    {
        await Task.Delay(20);
    }

    await app.StopAsync();

    Console.WriteLine($"   three units of work, each in its own scope:");
    Console.WriteLine($"     scoped ids : {string.Join(", ", Worker.ScopedIds)}");
    Console.WriteLine();
    Console.WriteLine("   Different every time, which is what scoped is supposed to mean. The");
    Console.WriteLine("   pattern is one scope per UNIT OF WORK:");
    Console.WriteLine();
    Console.WriteLine("     using (IServiceScope scope = _scopeFactory.CreateScope())");
    Console.WriteLine("     {");
    Console.WriteLine("         var db = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();");
    Console.WriteLine("         // ... one message, one timer tick, one batch ...");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   Take IServiceScopeFactory in the constructor, not IServiceProvider.");
    Console.WriteLine("   Both work; the factory says what you intend and cannot be used to");
    Console.WriteLine("   resolve a scoped service by accident.");
    Console.WriteLine();
    Console.WriteLine("   The scope must be INSIDE the loop, not around it. One scope around");
    Console.WriteLine("   the whole loop is the captive dependency again, wearing a different");
    Console.WriteLine("   hat: one DbContext accumulating every entity the service ever");
    Console.WriteLine("   touched, with change tracking getting slower on every iteration.");
}

// ---------------------------------------------------------------------------
static class Counters
{
    public static int Singleton;
    public static int Scoped;
    public static int Transient;
    public static int Disposable;
    public static int DisposableDisposed;

    public static void Reset()
    {
        Singleton = Scoped = Transient = Disposable = DisposableDisposed = 0;
    }
}

sealed class SingletonService
{
    public SingletonService() => Id = Interlocked.Increment(ref Counters.Singleton);

    public int Id { get; }
}

sealed class ScopedService
{
    public ScopedService() => Id = Interlocked.Increment(ref Counters.Scoped);

    public int Id { get; }
}

sealed class TransientService
{
    public TransientService() => Id = Interlocked.Increment(ref Counters.Transient);

    public int Id { get; }
}

sealed class DisposableService : IDisposable
{
    public DisposableService() => Interlocked.Increment(ref Counters.Disposable);

    public void Dispose() => Interlocked.Increment(ref Counters.DisposableDisposed);
}

sealed class CapturingSingleton
{
    public CapturingSingleton(ScopedService captured) => Captured = captured;

    public ScopedService Captured { get; }
}

sealed class Worker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;

    public static readonly List<int> ScopedIds = new();

    public Worker(IServiceScopeFactory scopeFactory) => _scopeFactory = scopeFactory;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        for (int i = 0; i < 3 && !stoppingToken.IsCancellationRequested; i++)
        {
            // One scope per unit of work, created and disposed inside the loop.
            using IServiceScope scope = _scopeFactory.CreateScope();
            var scoped = scope.ServiceProvider.GetRequiredService<ScopedService>();

            lock (ScopedIds)
            {
                ScopedIds.Add(scoped.Id);
            }

            await Task.Delay(10, stoppingToken);
        }
    }
}
