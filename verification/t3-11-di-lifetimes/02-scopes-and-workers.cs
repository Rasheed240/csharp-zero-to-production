// 02-scopes-and-workers.cs — Where scopes come from, what happens to code that
// runs outside a request, and the leak the container creates on your behalf.
//
// Run:  dotnet run 02-scopes-and-workers.cs -c Release
//
// EXACT vs RATIO: every count and exception message here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;

#pragma warning disable ASP0000

await WhereScopesComeFrom();
await TheWorkerProblem();
await ScopePerUnitOfWork();
await TheDisposableLeak();

// ---------------------------------------------------------------------------
static async Task WhereScopesComeFrom()
{
    Console.WriteLine("1. A scope is a thing somebody creates");
    Console.WriteLine();
    Console.WriteLine("   'Scoped means per request' is a description of what ASP.NET Core does,");
    Console.WriteLine("   not a definition. What it actually does is create a scope when a");
    Console.WriteLine("   request arrives and dispose it when the response completes.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Host.UseDefaultServiceProvider(options =>
    {
        options.ValidateOnBuild = true;
        options.ValidateScopes = true;
    });

    builder.Services.AddScoped<IUnitOfWork, UnitOfWork>();

    var app = builder.Build();
    app.MapGet("/work", (IUnitOfWork work) => Results.Ok(new { id = work.Id }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine($"   two requests            {await http.GetStringAsync("/work")}, " +
        $"{await http.GetStringAsync("/work")}");

    // The root provider is not a scope. Asking it for a scoped service is the
    // mistake ValidateScopes exists to prevent.
    Console.WriteLine($"   from app.Services       {Describe(() => app.Services.GetRequiredService<IUnitOfWork>())}");

    // A scope created by hand behaves exactly like a request's.
    using (IServiceScope scope = app.Services.CreateScope())
    {
        var first = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
        var second = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

        Console.WriteLine($"   inside a manual scope   id {first.Id} and id {second.Id}, same instance: " +
            $"{ReferenceEquals(first, second)}");
    }

    Console.WriteLine($"   disposed with the scope {UnitOfWork.Disposed} of {UnitOfWork.Created} created");

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   THREE THINGS THE OUTPUT SETTLES:");
    Console.WriteLine();
    Console.WriteLine("     - a request is one scope, so a scoped service is per request only");
    Console.WriteLine("       because a request is what creates a scope;");
    Console.WriteLine();
    Console.WriteLine("     - THE ROOT PROVIDER IS NOT A SCOPE. app.Services is the root, and");
    Console.WriteLine("       with validation on it refuses scoped services outright;");
    Console.WriteLine();
    Console.WriteLine("     - a scope you create yourself is a real scope: one instance inside");
    Console.WriteLine("       it, and DISPOSED when the scope is.");
    Console.WriteLine();
    Console.WriteLine("   That last point is the one that matters most. THE SCOPE OWNS WHAT IT");
    Console.WriteLine("   CREATED: disposing it disposes every IDisposable scoped or transient");
    Console.WriteLine("   service resolved through it. A database context closes its connection");
    Console.WriteLine("   there, and nowhere else.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheWorkerProblem()
{
    Console.WriteLine("2. Background services are singletons");
    Console.WriteLine();
    Console.WriteLine("   A BackgroundService is registered as a hosted service, which means one");
    Console.WriteLine("   instance for the life of the application. It has no request, so it has");
    Console.WriteLine("   no scope.");
    Console.WriteLine();

    Console.WriteLine("   worker takes                      startup");
    Console.WriteLine("   ------------                      -------");

    foreach ((string label, bool injectScoped) in new[]
    {
        ("IUnitOfWork directly", true),
        ("IServiceScopeFactory", false)
    })
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Production"
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        builder.Host.UseDefaultServiceProvider(options =>
        {
            options.ValidateOnBuild = true;
            options.ValidateScopes = true;
        });

        builder.Services.AddScoped<IUnitOfWork, UnitOfWork>();

        if (injectScoped)
        {
            builder.Services.AddHostedService<CapturingWorker>();
        }
        else
        {
            builder.Services.AddHostedService<ScopingWorker>();
        }

        string outcome;

        try
        {
            WebApplication built = builder.Build();
            outcome = "built without complaint";
            await built.DisposeAsync();
        }
        catch (Exception exception)
        {
            string message = (exception.InnerException?.Message ?? exception.Message)
                .ReplaceLineEndings(" ");

            outcome = message.Length > 100 ? message[..100] + "..." : message;
        }

        Console.WriteLine($"   {label,-32}  {outcome}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIRST ROW FAILS AT STARTUP, and that is the good outcome - it is");
    Console.WriteLine("   the same captive-dependency check from the previous file, catching the");
    Console.WriteLine("   same mistake in the place people meet it most often.");
    Console.WriteLine();
    Console.WriteLine("   Without validation it would start, and the worker would hold one unit");
    Console.WriteLine("   of work - one database context, one transaction, one change tracker -");
    Console.WriteLine("   for as long as the process runs.");
    Console.WriteLine();
    Console.WriteLine("   IServiceScopeFactory IS THE ANSWER, and it is a singleton, so a");
    Console.WriteLine("   singleton may hold it. It is the one piece of container plumbing that");
    Console.WriteLine("   belongs in application code:");
    Console.WriteLine();
    Console.WriteLine("     using IServiceScope scope = _scopeFactory.CreateScope();");
    Console.WriteLine("     var work = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();");
    Console.WriteLine();
    Console.WriteLine("   This is service location, and the previous module called that an");
    Console.WriteLine("   anti-pattern. It is the exception named there: code with no ambient");
    Console.WriteLine("   scope has to create one, and creating one means resolving from it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ScopePerUnitOfWork()
{
    Console.WriteLine("3. One scope for the loop, or one scope per item");
    Console.WriteLine();
    Console.WriteLine("   The worker has a scope. The question nobody asks is how wide it is.");
    Console.WriteLine();

    Console.WriteLine("   arrangement                 units created   units disposed   items in one unit");
    Console.WriteLine("   -----------                 -------------   --------------   -----------------");

    foreach ((string label, bool scopePerItem) in new[]
    {
        ("one scope for the whole run", false),
        ("one scope per item", true)
    })
    {
        var services = new ServiceCollection();
        services.AddScoped<IUnitOfWork, UnitOfWork>();

        using ServiceProvider provider = services.BuildServiceProvider(
            new ServiceProviderOptions { ValidateScopes = true });

        int before = UnitOfWork.Created;
        int disposedBefore = UnitOfWork.Disposed;
        int live;

        if (scopePerItem)
        {
            for (int item = 0; item < 5; item++)
            {
                using IServiceScope scope = provider.CreateScope();
                var work = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
                work.Track(item);
            }

            live = 0;
        }
        else
        {
            using IServiceScope scope = provider.CreateScope();
            var work = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

            for (int item = 0; item < 5; item++)
            {
                work.Track(item);
            }

            live = work.Tracked;
        }

        Console.WriteLine($"   {label,-27}  {UnitOfWork.Created - before,13}   " +
            $"{UnitOfWork.Disposed - disposedBefore,14}   {live}");
    }

    Console.WriteLine();
    Console.WriteLine("   ONE SCOPE FOR THE RUN MEANS ONE UNIT OF WORK ACCUMULATING EVERY ITEM.");
    Console.WriteLine("   Five here; in a real worker, every row processed since the process");
    Console.WriteLine("   started.");
    Console.WriteLine();
    Console.WriteLine("   With a database context that is the failure people describe as 'the");
    Console.WriteLine("   worker slowly gets slower and then falls over':");
    Console.WriteLine();
    Console.WriteLine("     - the change tracker holds every entity it has ever loaded, so it");
    Console.WriteLine("       grows without limit and every save gets slower;");
    Console.WriteLine();
    Console.WriteLine("     - one failed operation leaves the context in a broken state that");
    Console.WriteLine("       every later operation inherits;");
    Console.WriteLine();
    Console.WriteLine("     - a connection is held open for the life of the loop rather than");
    Console.WriteLine("       for the life of an item.");
    Console.WriteLine();
    Console.WriteLine("   THE RULE: A SCOPE IS A UNIT OF WORK. In a web application the framework");
    Console.WriteLine("   picks the unit for you and it is the request. In a worker you pick, and");
    Console.WriteLine("   the right answer is almost always one message, one item, one iteration -");
    Console.WriteLine("   never the whole loop.");
    Console.WriteLine();
    Console.WriteLine("   Note the second column. Disposal is what makes the boundary real: the");
    Console.WriteLine("   per-item arrangement released each unit as it finished, and the");
    Console.WriteLine("   single-scope one released nothing until the run ended.");
    Console.WriteLine();

    await Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static async Task TheDisposableLeak()
{
    Console.WriteLine("4. The leak the container creates for you");
    Console.WriteLine();
    Console.WriteLine("   A transient IDisposable, resolved ten thousand times, from the root");
    Console.WriteLine("   provider and from a scope that is disposed:");
    Console.WriteLine();

    Console.WriteLine("   resolved from        created   disposed   still held by the container");
    Console.WriteLine("   -------------        -------   --------   --------------------------");

    // From the root provider. Nothing disposes the root until the process ends.
    {
        var services = new ServiceCollection();
        services.AddTransient<Handle>();

        // ValidateScopes off, because with it on the root provider is the only
        // thing that can resolve a transient at all - and that is the point.
        using ServiceProvider provider = services.BuildServiceProvider();

        int before = Handle.Created;
        int disposedBefore = Handle.Disposed;

        for (int i = 0; i < 10_000; i++)
        {
            provider.GetRequiredService<Handle>();
        }

        Console.WriteLine($"   {"the root provider",-19}  {Handle.Created - before,7}   " +
            $"{Handle.Disposed - disposedBefore,8}   {Handle.Created - before - (Handle.Disposed - disposedBefore)}");
    }

    // From a scope, which is disposed at the end of the block.
    {
        var services = new ServiceCollection();
        services.AddTransient<Handle>();

        using ServiceProvider provider = services.BuildServiceProvider();

        int before = Handle.Created;
        int disposedBefore = Handle.Disposed;

        using (IServiceScope scope = provider.CreateScope())
        {
            for (int i = 0; i < 10_000; i++)
            {
                scope.ServiceProvider.GetRequiredService<Handle>();
            }
        }

        Console.WriteLine($"   {"a disposed scope",-19}  {Handle.Created - before,7}   " +
            $"{Handle.Disposed - disposedBefore,8}   {Handle.Created - before - (Handle.Disposed - disposedBefore)}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE CONTAINER TRACKS EVERY IDisposable IT CREATES, because it is the");
    Console.WriteLine("   only thing that can dispose them. That tracking is a list, and the");
    Console.WriteLine("   list belongs to the scope that did the resolving.");
    Console.WriteLine();
    Console.WriteLine("   Resolve a transient disposable from the root and it goes on the ROOT'S");
    Console.WriteLine("   list, which is released when the application shuts down. Ten thousand");
    Console.WriteLine("   of them are ten thousand live objects that nothing will collect.");
    Console.WriteLine();
    Console.WriteLine("   THIS IS A REAL PRODUCTION LEAK and it does not look like one. Every");
    Console.WriteLine("   object involved is short-lived by design, the code that creates them");
    Console.WriteLine("   is correct, and memory grows in a straight line until the process is");
    Console.WriteLine("   restarted.");
    Console.WriteLine();
    Console.WriteLine("   HOW IT GETS INTO A CODEBASE: something resolves from app.Services, or");
    Console.WriteLine("   from an IServiceProvider injected into a singleton, instead of from a");
    Console.WriteLine("   scope. With ValidateScopes on, the scoped case is refused - but a");
    Console.WriteLine("   TRANSIENT disposable resolved from the root is allowed, because there");
    Console.WriteLine("   is nothing invalid about it.");
    Console.WriteLine();
    Console.WriteLine("   THE DEFENCES, in order:");
    Console.WriteLine();
    Console.WriteLine("     1. Resolve inside a scope you own, and dispose it.");
    Console.WriteLine("     2. Avoid registering disposables as transient at all - scoped is");
    Console.WriteLine("        almost always what was meant, and it is bounded by the request.");
    Console.WriteLine("     3. If a transient disposable is genuinely right, own it: construct");
    Console.WriteLine("        it from a factory and dispose it yourself, so the container is");
    Console.WriteLine("        never asked to track it.");

    await Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static string Describe(Func<object> action)
{
    try
    {
        return $"built {action().GetType().Name}";
    }
    catch (Exception exception)
    {
        string message = exception.Message.ReplaceLineEndings(" ");

        return message.Length > 88 ? message[..88] + "..." : message;
    }
}

// ---------------------------------------------------------------------------
public interface IUnitOfWork
{
    int Id { get; }

    int Tracked { get; }

    void Track(int item);
}

// Stands in for a database context: per-unit-of-work state, accumulating, and
// disposable. The real one adds a connection and a change tracker.
public sealed class UnitOfWork : IUnitOfWork, IDisposable
{
    private static int _created;
    private static int _disposed;
    private readonly List<int> _tracked = [];

    public UnitOfWork() => Id = Interlocked.Increment(ref _created);

    public static int Created => Volatile.Read(ref _created);

    public static int Disposed => Volatile.Read(ref _disposed);

    public int Id { get; }

    public int Tracked => _tracked.Count;

    public void Track(int item) => _tracked.Add(item);

    public void Dispose() => Interlocked.Increment(ref _disposed);
}

// Takes a scoped service directly. A hosted service is a singleton, so this is
// a captive dependency and startup validation says so.
public sealed class CapturingWorker(IUnitOfWork work) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _ = work.Id;

        return Task.CompletedTask;
    }
}

// Takes the scope factory, which is a singleton, and creates a scope per unit
// of work.
public sealed class ScopingWorker(IServiceScopeFactory scopeFactory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using IServiceScope scope = scopeFactory.CreateScope();
            var work = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

            work.Track(work.Id);

            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }
}

// A disposable with no state worth having - the point is only that the
// container has to keep hold of it.
public sealed class Handle : IDisposable
{
    private static int _created;
    private static int _disposed;

    public Handle() => Interlocked.Increment(ref _created);

    public static int Created => Volatile.Read(ref _created);

    public static int Disposed => Volatile.Read(ref _disposed);

    public void Dispose() => Interlocked.Increment(ref _disposed);
}
