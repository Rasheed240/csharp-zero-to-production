// 01-lifetime-and-ordering.cs — When each hook runs, what blocks startup, and
// what "stop the host" actually does.
//
// Run:  dotnet run 01-lifetime-and-ordering.cs -c Release
//
// EXACT vs RATIO: the orderings and the true/false results are deterministic.
// The millisecond figures are machine-specific; the claim in every table is
// which rows are ~0 and which are ~500.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;

Console.WriteLine("Lifetime, ordering, and what blocks what");
Console.WriteLine();

await WhatBlocksStartup();
await Ordering();
await WhatStopHostDoes();
await TheHooks();

// ---------------------------------------------------------------------------
static async Task WhatBlocksStartup()
{
    Console.WriteLine("1. Which of these delays your web server by half a second");
    Console.WriteLine();
    Console.WriteLine("   Four workers, each spending 500 ms getting ready, written four ways.");
    Console.WriteLine("   Two of them are free and two are not, and the split is not the one");
    Console.WriteLine("   most people predict.");
    Console.WriteLine();

    Console.WriteLine("   where the 500 ms is spent                        host start took");
    Console.WriteLine("   ------------------------                        ---------------");

    Console.WriteLine($"   nothing (baseline)                               " +
        $"{await TimeStart(_ => { }),6:0} ms");

    Console.WriteLine($"   IHostedService.StartAsync: await Task.Delay      " +
        $"{await TimeStart(s => s.AddHostedService<AwaitingStarter>()),6:0} ms");

    Console.WriteLine($"   the worker's CONSTRUCTOR                         " +
        $"{await TimeStart(s => s.AddHostedService<SlowConstructor>()),6:0} ms");

    Console.WriteLine($"   BackgroundService: Thread.Sleep before an await  " +
        $"{await TimeStart(s => s.AddHostedService<BlockingWorker>()),6:0} ms");

    Console.WriteLine($"   BackgroundService: await Task.Delay              " +
        $"{await TimeStart(s => s.AddHostedService<AwaitingWorker>()),6:0} ms");

    Console.WriteLine();
    Console.WriteLine("   TWO ROWS BLOCK AND TWO DO NOT. Take them in turn, because the reasons");
    Console.WriteLine("   are different and only one of them is obvious.");
    Console.WriteLine();
    Console.WriteLine("     IHostedService.StartAsync IS AWAITED BY THE HOST. That is its");
    Console.WriteLine("     contract: the host calls it and waits for it. Anything slow in there");
    Console.WriteLine("     is time your application is not listening on a port. That is");
    Console.WriteLine("     sometimes exactly what you want - a cache that must be warm before");
    Console.WriteLine("     the first request - and it should be a decision rather than an");
    Console.WriteLine("     accident.");
    Console.WriteLine();
    Console.WriteLine("     THE CONSTRUCTOR BLOCKS TOO, and this one catches people. A hosted");
    Console.WriteLine("     service is resolved from the container during startup, so work in");
    Console.WriteLine("     its constructor - reading a file, building a lookup table, opening");
    Console.WriteLine("     a connection - happens on the startup path no matter which base");
    Console.WriteLine("     class you chose. THE BASE CLASS CANNOT PROTECT YOU FROM YOUR OWN");
    Console.WriteLine("     CONSTRUCTOR.");
    Console.WriteLine();
    Console.WriteLine("   NOW THE SURPRISE: THE Thread.Sleep ROW DID NOT BLOCK.");
    Console.WriteLine();
    Console.WriteLine("   Synchronous work at the top of ExecuteAsync runs on a THREAD POOL");
    Console.WriteLine("   THREAD, not on the thread starting the host. Instrumented directly:");
    Console.WriteLine();

    // Where the synchronous prefix of ExecuteAsync actually runs.
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddHostedService<ThreadProbe>();

    var probeApp = builder.Build();

    var probeClock = Stopwatch.StartNew();
    ThreadProbe.Clock = probeClock;

    int hostThread = Environment.CurrentManagedThreadId;

    await probeApp.StartAsync();

    double returnedAt = probeClock.Elapsed.TotalMilliseconds;

    // Long enough for the worker's 500 ms of synchronous work to finish.
    await Task.Delay(700);

    Console.WriteLine($"     ExecuteAsync was entered at     {ThreadProbe.EnteredAt,6:0} ms   on thread {ThreadProbe.ExecuteThread}");
    Console.WriteLine($"     StartAsync returned at          {returnedAt,6:0} ms   on thread {hostThread}");
    Console.WriteLine($"     the 500 ms of sleeping ended at {ThreadProbe.PastSleepAt,6:0} ms");

    await probeApp.StopAsync();
    await probeApp.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE THREAD IDS ARE DIFFERENT AND THE HOST FINISHED STARTING WHILE THE");
    Console.WriteLine("   WORKER WAS STILL ASLEEP. ExecuteAsync is handed to the thread pool, so");
    Console.WriteLine("   a BackgroundService cannot delay startup with work inside ExecuteAsync");
    Console.WriteLine("   at all - synchronous or not.");
    Console.WriteLine();
    Console.WriteLine("   THIS IS VERSION-SPECIFIC AND IT CHANGED RECENTLY. On .NET 6 and 7,");
    Console.WriteLine("   ExecuteAsync ran synchronously up to its first await, ON THE STARTUP");
    Console.WriteLine("   PATH, and blocking work there was a well-known way to stall a service");
    Console.WriteLine("   for minutes. .NET 8 moved it to the thread pool. If you find");
    Console.WriteLine("   'await Task.Yield();' as the first line of somebody's ExecuteAsync,");
    Console.WriteLine("   that is the workaround for the old behaviour, and on .NET 10 it is now");
    Console.WriteLine("   doing nothing.");
    Console.WriteLine();
    Console.WriteLine("   AND THE GENERAL LESSON IS BIGGER THAN THE FIX: THE THING THAT DELAYS");
    Console.WriteLine("   STARTUP IS 'IS THE HOST AWAITING THIS', NOT 'IS THIS ASYNC'. A");
    Console.WriteLine("   constructor is awaited in effect. StartAsync is awaited by contract.");
    Console.WriteLine("   ExecuteAsync is not awaited at all. Knowing which of the three you are");
    Console.WriteLine("   writing in tells you whether slowness there costs you availability.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Ordering()
{
    Console.WriteLine("2. The order things start and stop in");
    Console.WriteLine();

    var log = new List<string>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddSingleton(log);
    builder.Services.AddHostedService<Recorder<First>>();
    builder.Services.AddHostedService<Recorder<Second>>();
    builder.Services.AddHostedService<Recorder<Third>>();

    var app = builder.Build();

    await app.StartAsync();
    await Task.Delay(50);
    await app.StopAsync();

    Console.WriteLine("   sequence");
    Console.WriteLine("   --------");

    foreach (string entry in log)
    {
        Console.WriteLine($"   {entry}");
    }

    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   STARTED IN REGISTRATION ORDER, STOPPED IN REVERSE. That is a real");
    Console.WriteLine("   guarantee and it is the one useful ordering primitive you get: if B");
    Console.WriteLine("   depends on A being ready, register A first, and B is torn down before");
    Console.WriteLine("   A is.");
    Console.WriteLine();
    Console.WriteLine("   IT IS ALSO A WEAK TOOL, because it is invisible. Nothing at the");
    Console.WriteLine("   registration site says 'this order matters', and a later reordering -");
    Console.WriteLine("   during a tidy-up, or a merge - compiles, starts, and fails somewhere");
    Console.WriteLine("   else. IF ORDER MATTERS, MAKE IT EXPLICIT: have B wait on something A");
    Console.WriteLine("   signals, rather than on the registration list.");
    Console.WriteLine();
    Console.WriteLine("   AND NOTE THAT THE ORDER IS SEQUENTIAL BY DEFAULT. Both");
    Console.WriteLine("   ServicesStartConcurrently and ServicesStopConcurrently default to");
    Console.WriteLine("   false, so a slow StartAsync delays every service after it. Turning");
    Console.WriteLine("   them on is one line and it discards the ordering guarantee above -");
    Console.WriteLine("   which is the trade, stated plainly.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatStopHostDoes()
{
    Console.WriteLine("3. What happens when a worker throws");
    Console.WriteLine();
    Console.WriteLine("   BackgroundServiceExceptionBehavior defaults to StopHost. The name");
    Console.WriteLine("   suggests the process ends. Here is what it does.");
    Console.WriteLine();

    Console.WriteLine("   behaviour   worker died   ApplicationStopping fired   still serving after");
    Console.WriteLine("   ---------   -----------   -------------------------   -------------------");

    foreach (BackgroundServiceExceptionBehavior behaviour in
        new[] { BackgroundServiceExceptionBehavior.StopHost, BackgroundServiceExceptionBehavior.Ignore })
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.Configure<HostOptions>(o => o.BackgroundServiceExceptionBehavior = behaviour);
        builder.Services.AddHostedService<Thrower>();

        var app = builder.Build();
        app.MapGet("/", () => "alive");

        var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();
        bool stopping = false;
        lifetime.ApplicationStopping.Register(() => stopping = true);

        Thrower.Threw = false;

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        // Well past the throw at 100 ms.
        await Task.Delay(600);

        string serving;

        try
        {
            serving = await http.GetStringAsync("/");
        }
        catch (Exception exception)
        {
            serving = exception.GetType().Name;
        }

        Console.WriteLine($"   {behaviour,-11} {Thrower.Threw,-13} {stopping,-25}   {serving}");

        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   READ THE LAST COLUMN. UNDER BOTH SETTINGS THE APPLICATION WAS STILL");
    Console.WriteLine("   ANSWERING REQUESTS six hundred milliseconds after its worker died.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS NOT A BUG, AND IT IS THE MOST IMPORTANT THING IN THIS FILE.");
    Console.WriteLine("   StopHost does not kill the process - it calls StopApplication(), which");
    Console.WriteLine("   REQUESTS a shutdown by firing the ApplicationStopping token. Something");
    Console.WriteLine("   has to be listening for that request and act on it.");
    Console.WriteLine();
    Console.WriteLine("     app.Run() LISTENS. It blocks until the lifetime says stop, so in a");
    Console.WriteLine("     normal Program.cs the process really does exit.");
    Console.WriteLine();
    Console.WriteLine("     await app.StartAsync() DOES NOT. Control returns to your code, and");
    Console.WriteLine("     nothing is watching the token unless you watch it. Test hosts,");
    Console.WriteLine("     WebApplicationFactory and code like this file are all in that shape.");
    Console.WriteLine();
    Console.WriteLine("   THE CONSEQUENCE FOR TESTS IS WORTH STATING OUTRIGHT: A BACKGROUND");
    Console.WriteLine("   SERVICE THAT DIES ON EVERY RUN CAN PASS AN INTEGRATION TEST SUITE,");
    Console.WriteLine("   because the test host keeps serving and the assertions are about HTTP.");
    Console.WriteLine();
    Console.WriteLine("   AND UNDER Ignore NOTHING FIRED AT ALL. The worker is gone, the host is");
    Console.WriteLine("   healthy by every measure it has, and there is no signal anywhere");
    Console.WriteLine("   except a single log line at Error level. That is the incident in");
    Console.WriteLine("   03-production.cs.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheHooks()
{
    Console.WriteLine("4. Which hook to reach for");
    Console.WriteLine();

    var log = new List<string>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton(log);
    builder.Services.AddHostedService<Lifecycle>();

    var app = builder.Build();

    await app.StartAsync();
    await Task.Delay(50);
    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine("   every hook, in the order it fired");
    Console.WriteLine("   ---------------------------------");

    foreach (string entry in log)
    {
        Console.WriteLine($"   {entry}");
    }

    Console.WriteLine();
    Console.WriteLine("   THREE INTERFACES, AND THE CHOICE IS ABOUT WHEN, NOT ABOUT STYLE:");
    Console.WriteLine();
    Console.WriteLine("     IHostedService     StartAsync and StopAsync. The host AWAITS both.");
    Console.WriteLine("                        Use it for setup that must finish before traffic");
    Console.WriteLine("                        arrives, and for teardown that must finish before");
    Console.WriteLine("                        the process exits.");
    Console.WriteLine();
    Console.WriteLine("     BackgroundService  A base class over IHostedService whose whole job");
    Console.WriteLine("                        is ExecuteAsync - one long-running task, handed a");
    Console.WriteLine("                        stopping token. Use it for loops.");
    Console.WriteLine();
    Console.WriteLine("     IHostedLifecycle-  Adds Starting/Started and Stopping/Stopped either");
    Console.WriteLine("     Service            side of the pair above. Use it when you need to");
    Console.WriteLine("                        act AFTER everything has started, or BEFORE");
    Console.WriteLine("                        anything begins stopping - the two moments the");
    Console.WriteLine("                        older interface cannot express.");
    Console.WriteLine();
    Console.WriteLine("   THE ONE THAT SOLVES A REAL PROBLEM IS StartedAsync. In StartAsync you");
    Console.WriteLine("   cannot assume the rest of the application is up, because it is not -");
    Console.WriteLine("   services after you in the list have not started. In StartedAsync you");
    Console.WriteLine("   can. Anything of the form 'once we are fully up, begin...' belongs");
    Console.WriteLine("   there rather than in a constructor or a delay.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// Builds a host with whatever is registered, and reports how long StartAsync
// took. That number is how long the application was not serving.
static async Task<double> TimeStart(Action<IServiceCollection> configure)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    configure(builder.Services);

    var app = builder.Build();

    var clock = Stopwatch.StartNew();
    await app.StartAsync();
    clock.Stop();

    await app.StopAsync();
    await app.DisposeAsync();

    return clock.Elapsed.TotalMilliseconds;
}

// ---------------------------------------------------------------------------
// The host awaits StartAsync, so this delays everything.
sealed class AwaitingStarter : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken) =>
        await Task.Delay(500, cancellationToken);

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

// ---------------------------------------------------------------------------
// A constructor is resolved during startup, so slow work here does block.
sealed class SlowConstructor : BackgroundService
{
    public SlowConstructor() => Thread.Sleep(500);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) =>
        await Task.Delay(Timeout.Infinite, stoppingToken);
}

// ---------------------------------------------------------------------------
// Synchronous work at the top of ExecuteAsync. On .NET 8 and later this runs
// on the thread pool and does not delay startup; on .NET 6 and 7 it did.
sealed class BlockingWorker : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Thread.Sleep(500);

        await Task.Delay(Timeout.Infinite, stoppingToken);
    }
}

// ---------------------------------------------------------------------------
// The await is reached immediately, so the host is handed control back at once.
sealed class AwaitingWorker : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(500, stoppingToken);
        await Task.Delay(Timeout.Infinite, stoppingToken);
    }
}

// ---------------------------------------------------------------------------
// Records when and where the synchronous prefix of ExecuteAsync runs.
sealed class ThreadProbe : BackgroundService
{
    public static Stopwatch Clock = null!;

    public static int ExecuteThread;

    public static double EnteredAt;

    public static double PastSleepAt;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        EnteredAt = Clock.Elapsed.TotalMilliseconds;
        ExecuteThread = Environment.CurrentManagedThreadId;

        Thread.Sleep(500);

        PastSleepAt = Clock.Elapsed.TotalMilliseconds;

        await Task.Delay(Timeout.Infinite, stoppingToken);
    }
}

// ---------------------------------------------------------------------------
sealed class Thrower : BackgroundService
{
    public static bool Threw;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(100, stoppingToken);

        Threw = true;

        throw new InvalidOperationException("the reconciliation worker fell over");
    }
}

// ---------------------------------------------------------------------------
sealed class First;

sealed class Second;

sealed class Third;

// ---------------------------------------------------------------------------
// One recorder per marker type, so three registrations are three distinct
// services rather than three of the same one.
sealed class Recorder<T>(List<string> log) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        log.Add($"start   {typeof(T).Name}");

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        log.Add($"stop    {typeof(T).Name}");

        return Task.CompletedTask;
    }
}

// ---------------------------------------------------------------------------
// Every hook the newer interface offers, in one class.
sealed class Lifecycle(List<string> log) : IHostedLifecycleService
{
    public Task StartingAsync(CancellationToken cancellationToken)
    {
        log.Add("StartingAsync   before anything has started");

        return Task.CompletedTask;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        log.Add("StartAsync      my turn in the registration order");

        return Task.CompletedTask;
    }

    public Task StartedAsync(CancellationToken cancellationToken)
    {
        log.Add("StartedAsync    everything is up");

        return Task.CompletedTask;
    }

    public Task StoppingAsync(CancellationToken cancellationToken)
    {
        log.Add("StoppingAsync   before anything has stopped");

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        log.Add("StopAsync       my turn in reverse order");

        return Task.CompletedTask;
    }

    public Task StoppedAsync(CancellationToken cancellationToken)
    {
        log.Add("StoppedAsync    everything is down");

        return Task.CompletedTask;
    }
}
