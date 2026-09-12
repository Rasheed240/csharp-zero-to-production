// 02-scope-and-state.cs — A worker is a singleton with no request around it, so
// everything scoped has to be created by hand.
//
// Run:  dotnet run 02-scope-and-state.cs -c Release
//
// EXACT vs RATIO: every count, instance id and exception type here is
// deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

Console.WriteLine("Scopes, singletons, and the state that leaks between iterations");
Console.WriteLine();

await TheCaptiveDependency();
await WhereTheScopeGoes();
await StateThatSurvives();
await Concurrency();

// ---------------------------------------------------------------------------
static async Task TheCaptiveDependency()
{
    Console.WriteLine("1. The registration that fails in development and works in production");
    Console.WriteLine();
    Console.WriteLine("   A worker needs the database. The obvious thing is to ask for it in the");
    Console.WriteLine("   constructor, the way every other class does.");
    Console.WriteLine();

    string failureMessage = "";

    Console.WriteLine("   environment   ValidateScopes   what happened at Build()");
    Console.WriteLine("   -----------   --------------   ------------------------");

    foreach ((string environment, bool validate) in
        new[] { ("Development", true), ("Production", false) })
    {
        string outcome;

        try
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = environment
            });

            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();

            builder.Services.AddScoped<LedgerDbContext>();
            builder.Services.AddHostedService<CapturingWorker>();

            var app = builder.Build();

            await app.StartAsync();
            await Task.Delay(150);
            await app.StopAsync();
            await app.DisposeAsync();

            outcome = $"started; worker used {CapturingWorker.DistinctContexts} DbContext " +
                $"over {CapturingWorker.Iterations} iterations";
        }
        catch (Exception exception)
        {
            Exception real = exception is AggregateException aggregate
                ? aggregate.Flatten().InnerExceptions[0]
                : exception;

            outcome = $"{real.GetType().Name}";
            failureMessage = real.Message;
        }

        Console.WriteLine($"   {environment,-13} {validate,-16} {outcome}");
    }

    Console.WriteLine();
    Console.WriteLine("   and what the development build said:");
    Console.WriteLine();

    foreach (string line in Wrap(failureMessage, 64))
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE DEVELOPMENT BUILD REFUSED TO START AND THE PRODUCTION BUILD DID");
    Console.WriteLine("   NOT. That difference is not a quirk - it is the single most useful");
    Console.WriteLine("   safety net the container has, and it is switched off exactly where");
    Console.WriteLine("   the consequences are worst.");
    Console.WriteLine();
    Console.WriteLine("   WHAT IT IS PROTECTING YOU FROM is called a CAPTIVE DEPENDENCY: a");
    Console.WriteLine("   short-lived object held by a long-lived one. A hosted service is a");
    Console.WriteLine("   SINGLETON - one instance for the life of the process - so a scoped");
    Console.WriteLine("   DbContext taken in its constructor is resolved once, from the root,");
    Console.WriteLine("   and kept forever.");
    Console.WriteLine();
    Console.WriteLine("   THE PRODUCTION ROW SHOWS THE COST: one DbContext across every");
    Console.WriteLine("   iteration. Which means, over days:");
    Console.WriteLine();
    Console.WriteLine("     ITS CHANGE TRACKER NEVER EMPTIES. Every entity it has ever loaded");
    Console.WriteLine("     stays referenced, so memory grows in a straight line and queries");
    Console.WriteLine("     get slower as the tracker gets bigger. Section 3 measures this.");
    Console.WriteLine();
    Console.WriteLine("     ONE FAILED SAVE POISONS EVERY LATER ONE. A DbContext that has thrown");
    Console.WriteLine("     is not reusable; with one instance there is nothing to throw away.");
    Console.WriteLine();
    Console.WriteLine("     ITS CONNECTION IS HELD OPEN across the whole process lifetime rather");
    Console.WriteLine("     than returned to the pool between units of work.");
    Console.WriteLine();
    Console.WriteLine("   AND TURNING VALIDATION ON IN PRODUCTION IS ONE LINE AND WORTH IT:");
    Console.WriteLine();
    Console.WriteLine("     builder.Host.UseDefaultServiceProvider(o =>");
    Console.WriteLine("     {");
    Console.WriteLine("         o.ValidateScopes = true;");
    Console.WriteLine("         o.ValidateOnBuild = true;");
    Console.WriteLine("     });");
    Console.WriteLine();
    Console.WriteLine("   It turns a silent memory leak into a startup failure. A service that");
    Console.WriteLine("   refuses to start is a bad deployment; a service that leaks is a bad");
    Console.WriteLine("   week.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhereTheScopeGoes()
{
    Console.WriteLine("2. Creating the scope yourself, and where to put the boundary");
    Console.WriteLine();
    Console.WriteLine("   The fix is IServiceScopeFactory: the worker holds the factory, which");
    Console.WriteLine("   is a singleton and safe to capture, and makes a scope when it needs");
    Console.WriteLine("   one. The question is how often.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddScoped<LedgerDbContext>();

    var app = builder.Build();
    await app.StartAsync();

    var factory = app.Services.GetRequiredService<IServiceScopeFactory>();

    // Twelve items arriving in three batches of four.
    int[][] batches = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]];

    Console.WriteLine("   scope per...   contexts created   items sharing a context   one item fails");
    Console.WriteLine("   ------------   ----------------   -----------------------   --------------");

    // A scope for the whole run.
    LedgerDbContext.Created = 0;
    using (IServiceScope scope = factory.CreateScope())
    {
        var context = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();

        foreach (int[] batch in batches)
        {
            foreach (int item in batch)
            {
                context.Track(item);
            }
        }
    }

    Console.WriteLine($"   whole run      {LedgerDbContext.Created,16}   {12,23}   everything after it");

    // A scope per batch.
    LedgerDbContext.Created = 0;
    foreach (int[] batch in batches)
    {
        using IServiceScope scope = factory.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();

        foreach (int item in batch)
        {
            context.Track(item);
        }
    }

    Console.WriteLine($"   batch          {LedgerDbContext.Created,16}   {4,23}   the rest of its batch");

    // A scope per item.
    LedgerDbContext.Created = 0;
    foreach (int[] batch in batches)
    {
        foreach (int item in batch)
        {
            using IServiceScope scope = factory.CreateScope();
            var context = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();

            context.Track(item);
        }
    }

    Console.WriteLine($"   item           {LedgerDbContext.Created,16}   {1,23}   only itself");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THERE IS NO UNIVERSALLY RIGHT ANSWER AND THERE IS A RIGHT QUESTION:");
    Console.WriteLine("   WHAT IS ONE UNIT OF WORK? A scope is the boundary at which state is");
    Console.WriteLine("   thrown away, so it should match the boundary at which a failure should");
    Console.WriteLine("   stop mattering.");
    Console.WriteLine();
    Console.WriteLine("     PER ITEM is the default and the one to reach for. One payment fails,");
    Console.WriteLine("     one scope is discarded, the next payment starts clean. It costs a");
    Console.WriteLine("     scope creation per item, which is cheap.");
    Console.WriteLine();
    Console.WriteLine("     PER BATCH is right when the batch is genuinely one transaction -");
    Console.WriteLine("     when half a batch being applied would be worse than none of it.");
    Console.WriteLine();
    Console.WriteLine("     PER RUN is almost never right for a long-running worker, because a");
    Console.WriteLine("     'run' that lasts days is a scope that lasts days, which is the");
    Console.WriteLine("     captive dependency you were trying to avoid, rebuilt by hand.");
    Console.WriteLine();
    Console.WriteLine("   THE MISTAKE THAT LOOKS LIKE THE FIX is creating the scope ONCE, OUTSIDE");
    Console.WriteLine("   THE LOOP. It uses IServiceScopeFactory, it disposes properly, it passes");
    Console.WriteLine("   review - and it has every problem of the captive dependency, because");
    Console.WriteLine("   the scope's lifetime is now the worker's lifetime.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task StateThatSurvives()
{
    Console.WriteLine("3. What accumulates when the scope never closes");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddScoped<LedgerDbContext>();

    var app = builder.Build();
    await app.StartAsync();

    var factory = app.Services.GetRequiredService<IServiceScopeFactory>();

    Console.WriteLine("   after N iterations   entities tracked, one scope   entities tracked, scope per item");
    Console.WriteLine("   ------------------   --------------------------   -------------------------------");

    using IServiceScope shared = factory.CreateScope();
    var sharedContext = shared.ServiceProvider.GetRequiredService<LedgerDbContext>();

    int perItemPeak = 0;

    for (int iteration = 1; iteration <= 2000; iteration++)
    {
        sharedContext.Track(iteration);

        using (IServiceScope scope = factory.CreateScope())
        {
            var fresh = scope.ServiceProvider.GetRequiredService<LedgerDbContext>();
            fresh.Track(iteration);

            perItemPeak = Math.Max(perItemPeak, fresh.Tracked);
        }

        if (iteration is 1 or 100 or 500 or 1000 or 2000)
        {
            Console.WriteLine($"   {iteration,18}   {sharedContext.Tracked,26}   {perItemPeak,31}");
        }
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE LEFT COLUMN IS A STRAIGHT LINE AND THE RIGHT ONE IS FLAT. That is");
    Console.WriteLine("   the entire argument for a scope per unit of work, and it is not really");
    Console.WriteLine("   about DbContext - it is about anything that remembers.");
    Console.WriteLine();
    Console.WriteLine("   A CHANGE TRACKER IS THE OBVIOUS CASE and there are quieter ones in");
    Console.WriteLine("   every codebase: a scoped cache, a request-correlation id, a unit-of-");
    Console.WriteLine("   work buffer, an audit list, a scoped logger with accumulated context.");
    Console.WriteLine("   ALL OF THEM WERE WRITTEN ASSUMING SOMETHING WOULD THROW THEM AWAY, and");
    Console.WriteLine("   in a web request something does. In a worker, nothing does unless you");
    Console.WriteLine("   write it.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS THE SENTENCE TO REMEMBER: A REQUEST IS A SCOPE THAT ENDS BY");
    Console.WriteLine("   ITSELF. A background worker has no request, so it has no scope, so");
    Console.WriteLine("   nothing ends by itself. Every convenience the request pipeline gave");
    Console.WriteLine("   you for free is now something you do explicitly.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Concurrency()
{
    Console.WriteLine("4. How many copies of your worker are running");
    Console.WriteLine();
    Console.WriteLine("   Two ways of registering the same worker twice, which are not the same");
    Console.WriteLine("   as each other.");
    Console.WriteLine();

    Console.WriteLine("   how it was registered twice                    loops actually running");
    Console.WriteLine("   ---------------------------                    ----------------------");

    Console.WriteLine($"   AddHostedService<CountingWorker>() twice       {await CountLoops(services =>
    {
        services.AddHostedService<CountingWorker>();
        services.AddHostedService<CountingWorker>();
    })}");

    Console.WriteLine($"   AddSingleton<IHostedService, CountingWorker>() {await CountLoops(services =>
    {
        services.AddSingleton<IHostedService, CountingWorker>();
        services.AddSingleton<IHostedService, CountingWorker>();
    })}");

    Console.WriteLine($"   two different worker types                    {await CountLoops(services =>
    {
        services.AddHostedService<CountingWorker>();
        services.AddHostedService<SecondWorker>();
    })}");

    Console.WriteLine();
    Console.WriteLine("   AddHostedService DEDUPLICATES AND AddSingleton DOES NOT, which is the");
    Console.WriteLine("   opposite of what most people expect in both directions.");
    Console.WriteLine();
    Console.WriteLine("   AddHostedService<T>() is implemented with TryAddEnumerable, which");
    Console.WriteLine("   skips a registration whose service type AND implementation type are");
    Console.WriteLine("   already present. So calling it twice from two different extension");
    Console.WriteLine("   methods is harmless - which is a real relief, because that is a very");
    Console.WriteLine("   ordinary thing to do by accident.");
    Console.WriteLine();
    Console.WriteLine("   AddSingleton<IHostedService, T>() APPENDS. It is the older spelling,");
    Console.WriteLine("   it still appears in a lot of code and a lot of answers online, and it");
    Console.WriteLine("   gives you two loops. THE SYMPTOM IS EVERY JOB RUNNING TWICE, which");
    Console.WriteLine("   looks like a scheduling bug and is a registration bug.");
    Console.WriteLine();
    Console.WriteLine("   AND THE DEDUPLICATION IS BY TYPE, NOT BY BEHAVIOUR. Two different");
    Console.WriteLine("   classes doing the same job are two loops, correctly, and no container");
    Console.WriteLine("   can know they overlap.");
    Console.WriteLine();
    Console.WriteLine("   NONE OF WHICH HELPS WITH THE VERSION OF THIS PROBLEM THAT MATTERS.");
    Console.WriteLine("   One instance per process is not one instance per system: scale to");
    Console.WriteLine("   three replicas and the loop runs three times, concurrently, on three");
    Console.WriteLine("   machines, against one database. Nothing in the hosting model prevents");
    Console.WriteLine("   that or can - it is the subject of leader election and distributed");
    Console.WriteLine("   locks, and the first step is knowing that AddHostedService gave you no");
    Console.WriteLine("   protection at all.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// Starts a host with whatever registration is under test and reports how many
// ExecuteAsync loops actually began.
static async Task<int> CountLoops(Action<IServiceCollection> register)
{
    CountingWorker.Started = 0;
    SecondWorker.Started = 0;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    register(builder.Services);

    var app = builder.Build();

    await app.StartAsync();
    await Task.Delay(150);
    await app.StopAsync();
    await app.DisposeAsync();

    return CountingWorker.Started + SecondWorker.Started;
}

// ---------------------------------------------------------------------------
static List<string> Wrap(string text, int width)
{
    var lines = new List<string>();
    var current = "";

    foreach (string word in text.Split(' '))
    {
        if (current.Length + word.Length + 1 > width)
        {
            lines.Add(current);
            current = word;
        }
        else
        {
            current = current.Length == 0 ? word : $"{current} {word}";
        }
    }

    if (current.Length > 0)
    {
        lines.Add(current);
    }

    return lines;
}

// ---------------------------------------------------------------------------
// Stands in for EF Core's DbContext: scoped, and it remembers everything it
// has seen until it is disposed.
sealed class LedgerDbContext : IDisposable
{
    public static int Created;

    readonly List<int> tracked = [];

    public LedgerDbContext() => Interlocked.Increment(ref Created);

    public int Id { get; } = Created;

    public int Tracked => tracked.Count;

    public void Track(int entity) => tracked.Add(entity);

    public void Dispose() => tracked.Clear();
}

// ---------------------------------------------------------------------------
// Takes a scoped service in its constructor, which is the thing under test.
sealed class CapturingWorker(LedgerDbContext context) : BackgroundService
{
    public static int Iterations;

    public static int DistinctContexts;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var seen = new HashSet<int>();
        Iterations = 0;

        while (!stoppingToken.IsCancellationRequested)
        {
            Iterations++;
            seen.Add(context.Id);
            DistinctContexts = seen.Count;

            try
            {
                await Task.Delay(30, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}

// ---------------------------------------------------------------------------
sealed class CountingWorker : BackgroundService
{
    public static int Started;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Interlocked.Increment(ref Started);

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
        }
    }
}

// ---------------------------------------------------------------------------
// A different type doing the same job, to show that deduplication is by type.
sealed class SecondWorker : BackgroundService
{
    public static int Started;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Interlocked.Increment(ref Started);

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
        }
    }
}
