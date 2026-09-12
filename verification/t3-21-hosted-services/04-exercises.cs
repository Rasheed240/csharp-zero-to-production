// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: the counts and outcomes are deterministic. The millisecond
// figures are machine-specific; the claims are the gaps between the rows.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;

await One();
await Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static async Task One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the deployment that got slower");
    Console.WriteLine();
    Console.WriteLine("   A team adds a worker that warms a pricing cache before it starts");
    Console.WriteLine("   looping. Deployments now take 90 seconds longer, and during that time");
    Console.WriteLine("   the new instance answers nothing - not even its health checks. The");
    Console.WriteLine("   rolling deploy takes a replica out and waits.");
    Console.WriteLine();
    Console.WriteLine("   The cache warm-up is genuinely needed. Where should it go?");
    Console.WriteLine();

    Console.WriteLine("   where the warm-up runs                     host start   worker useful from");
    Console.WriteLine("   ----------------------                     ----------   ------------------");

    (string Label, Func<IServiceCollection, IServiceCollection> Register)[] options =
    [
        ("IHostedService.StartAsync", s => s.AddHostedService<WarmInStart>()),
        ("first lines of ExecuteAsync", s => s.AddHostedService<WarmInExecute>())
    ];

    foreach ((string label, var register) in options)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        register(builder.Services);

        var app = builder.Build();
        app.MapGet("/health/ready", () => "ready");

        WarmInStart.WarmAt = 0;
        WarmInExecute.WarmAt = 0;

        var clock = Stopwatch.StartNew();
        WarmInStart.Clock = clock;
        WarmInExecute.Clock = clock;

        await app.StartAsync();
        double started = clock.Elapsed.TotalMilliseconds;

        await Task.Delay(500);

        double warm = Math.Max(WarmInStart.WarmAt, WarmInExecute.WarmAt);

        Console.WriteLine($"   {label,-42} {started,7:0} ms   {warm,15:0} ms");

        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: BOTH FINISH WARMING AT ROUGHLY THE SAME MOMENT, and only one");
    Console.WriteLine("   of them holds the application hostage while it happens.");
    Console.WriteLine();
    Console.WriteLine("   THE HOST AWAITS StartAsync, so warm-up there is downtime: the port is");
    Console.WriteLine("   not open, the health endpoint does not answer, and an orchestrator");
    Console.WriteLine("   doing a rolling deploy sits and waits for each replica in turn.");
    Console.WriteLine("   ExecuteAsync is not awaited, so the same work happens alongside a");
    Console.WriteLine("   running web server.");
    Console.WriteLine();
    Console.WriteLine("   WHICH DOES NOT MEAN 'ALWAYS USE ExecuteAsync'. The real question is");
    Console.WriteLine("   WHAT SHOULD HAPPEN TO A REQUEST THAT ARRIVES WHILE THE CACHE IS COLD,");
    Console.WriteLine("   and there are three defensible answers:");
    Console.WriteLine();
    Console.WriteLine("     IF IT MUST NOT BE SERVED, warm in StartAsync and accept the startup");
    Console.WriteLine("     cost. You have chosen correctness over availability, deliberately.");
    Console.WriteLine();
    Console.WriteLine("     IF IT CAN BE SERVED SLOWLY, warm in ExecuteAsync and have the cache");
    Console.WriteLine("     fall through to the database until it is populated.");
    Console.WriteLine();
    Console.WriteLine("     IF IT SHOULD WAIT, warm in ExecuteAsync and gate READINESS on the");
    Console.WriteLine("     cache being warm. The process starts instantly, the health endpoint");
    Console.WriteLine("     answers 503 until it is ready, and no traffic is routed to it - which");
    Console.WriteLine("     is the same outcome as the first option without the blackout.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD IS USUALLY RIGHT, and it is the one nobody reaches for,");
    Console.WriteLine("   because 'block startup' looks like the direct expression of 'must be");
    Console.WriteLine("   warm before traffic'.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the deploy that takes thirty seconds to finish");
    Console.WriteLine();
    Console.WriteLine("   Every deployment hangs for exactly thirty seconds after the new");
    Console.WriteLine("   version is up, then completes. Nothing is logged during the wait. The");
    Console.WriteLine("   number is suspiciously round.");
    Console.WriteLine();

    Console.WriteLine("   worker's loop                          StopAsync took   work in progress");
    Console.WriteLine("   -------------                          --------------   ----------------");

    foreach ((string label, bool honours) in
        new[] { ("ignores the stopping token", false), ("honours the stopping token", true) })
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        // Shortened from the 30 second default so this file finishes.
        builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(3));

        StubbornWorker.Honour = honours;
        StubbornWorker.Abandoned = false;

        builder.Services.AddHostedService<StubbornWorker>();

        var app = builder.Build();

        await app.StartAsync();
        await Task.Delay(200);

        var clock = Stopwatch.StartNew();
        await app.StopAsync();
        clock.Stop();

        Console.WriteLine($"   {label,-38} {clock.Elapsed.TotalMilliseconds,11:0} ms   " +
            $"{(StubbornWorker.Abandoned ? "ABANDONED mid-item" : "finished cleanly")}");

        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE ROUND NUMBER IS HostOptions.ShutdownTimeout, WHICH DEFAULTS");
    Console.WriteLine("   TO THIRTY SECONDS. (It is three seconds here so this file finishes.)");
    Console.WriteLine("   The host asks every hosted service to stop, waits for them, and gives");
    Console.WriteLine("   up after the timeout.");
    Console.WriteLine();
    Console.WriteLine("   A LOOP THAT NEVER CHECKS ITS STOPPING TOKEN NEVER STOPS, so the host");
    Console.WriteLine("   waits the full timeout every single time and then abandons the worker");
    Console.WriteLine("   wherever it happens to be - mid-item, mid-write, mid-transaction.");
    Console.WriteLine();
    Console.WriteLine("   THE COST IS NOT THE THIRTY SECONDS. It is that shutdown stops being a");
    Console.WriteLine("   controlled event: work in progress is not finished and not rolled");
    Console.WriteLine("   back, it is simply cut off, and whether that is safe depends entirely");
    Console.WriteLine("   on what the worker was doing at the time.");
    Console.WriteLine();
    Console.WriteLine("   TWO PLACES TO CHECK THE TOKEN, AND YOU NEED BOTH:");
    Console.WriteLine();
    Console.WriteLine("     THE LOOP CONDITION - while (!stoppingToken.IsCancellationRequested)");
    Console.WriteLine("     - which decides whether to start ANOTHER item.");
    Console.WriteLine();
    Console.WriteLine("     EVERY await INSIDE IT - pass the token to Task.Delay, to the HTTP");
    Console.WriteLine("     call, to SaveChangesAsync - which decides how quickly the CURRENT");
    Console.WriteLine("     item gives up. A loop that only checks the condition still waits for");
    Console.WriteLine("     the current iteration, and if that iteration is a sixty-second poll");
    Console.WriteLine("     you are back to the timeout.");
    Console.WriteLine();
    Console.WriteLine("   AND IF YOU GENUINELY NEED LONGER THAN THE TIMEOUT, RAISE IT rather than");
    Console.WriteLine("   letting it expire - but read exercise 4 first, because the interesting");
    Console.WriteLine("   question is not how long shutdown takes.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the hourly job that drifts");
    Console.WriteLine();
    Console.WriteLine("   A job is meant to run at the top of every hour. Over a week it slides");
    Console.WriteLine("   later and later; by Friday it fires around twenty past. The delay in");
    Console.WriteLine("   the loop is exactly one hour.");
    Console.WriteLine();
    Console.WriteLine("   (Scaled down here: a 100 ms period and 40 ms of work.)");
    Console.WriteLine();

    Console.WriteLine("   loop style                  fires at (ms from start)              drift");
    Console.WriteLine("   ----------                  ------------------------              -----");

    // Task.Delay after the work: the period becomes period + work.
    var delayFires = new List<double>();
    var clock = Stopwatch.StartNew();

    for (int i = 0; i < 5; i++)
    {
        delayFires.Add(clock.Elapsed.TotalMilliseconds);
        await Task.Delay(40);
        await Task.Delay(100);
    }

    Console.WriteLine($"   await Task.Delay(period)    {Format(delayFires),-37} {Drift(delayFires, 100),5:0} ms");

    // PeriodicTimer: the period is measured tick to tick.
    var timerFires = new List<double>();
    clock.Restart();

    using (var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(100)))
    {
        for (int i = 0; i < 5; i++)
        {
            timerFires.Add(clock.Elapsed.TotalMilliseconds);
            await Task.Delay(40);
            await timer.WaitForNextTickAsync();
        }
    }

    Console.WriteLine($"   PeriodicTimer               {Format(timerFires),-37} {Drift(timerFires, 100),5:0} ms");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: await Task.Delay(period) DOES NOT MEAN 'EVERY period'. It");
    Console.WriteLine("   means 'wait period AFTER THE WORK FINISHES', so each cycle is period");
    Console.WriteLine("   plus however long the work took, and the error accumulates. Forty");
    Console.WriteLine("   milliseconds of work on a hundred millisecond period is a 40% slide,");
    Console.WriteLine("   every cycle, forever.");
    Console.WriteLine();
    Console.WriteLine("   At the real scale: an hourly job doing twenty minutes of work runs");
    Console.WriteLine("   every eighty minutes, so it loses a run every three cycles - and 'the");
    Console.WriteLine("   job did not run at 3pm' is a much harder bug to see than 'the job");
    Console.WriteLine("   failed'.");
    Console.WriteLine();
    Console.WriteLine("   PeriodicTimer MEASURES TICK TO TICK, so the work happens inside the");
    Console.WriteLine("   period rather than before it. As long as the work is shorter than the");
    Console.WriteLine("   period, the schedule holds.");
    Console.WriteLine();
    Console.WriteLine("   AND WHEN THE WORK IS LONGER THAN THE PERIOD, PeriodicTimer DOES NOT");
    Console.WriteLine("   QUEUE UP MISSED TICKS - the next WaitForNextTickAsync returns");
    Console.WriteLine("   immediately, once, and you carry on. That is the right behaviour and it");
    Console.WriteLine("   is worth knowing: it degrades to 'run continuously', not to 'run four");
    Console.WriteLine("   times in a row to catch up'.");
    Console.WriteLine();
    Console.WriteLine("   NEITHER OF THESE IS A SCHEDULE. Both drift when the process restarts,");
    Console.WriteLine("   both run on every replica, and neither knows what 'the top of the hour'");
    Console.WriteLine("   is. IF THE REQUIREMENT IS A WALL-CLOCK TIME, compute the delay to the");
    Console.WriteLine("   next occurrence from the clock rather than counting intervals - or use");
    Console.WriteLine("   something that owns scheduling as a concern.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - the payments that vanished during a deploy");
    Console.WriteLine();
    Console.WriteLine("   A worker takes a payment off a queue, calls the gateway, and marks it");
    Console.WriteLine("   settled. It honours its stopping token everywhere, shuts down in");
    Console.WriteLine("   milliseconds, and passes every review.");
    Console.WriteLine();
    Console.WriteLine("   After each deploy, a handful of payments are neither settled nor on");
    Console.WriteLine("   the queue. Where did they go?");
    Console.WriteLine();

    Console.WriteLine("   what the token is passed to        settled   back on queue   LOST");
    Console.WriteLine("   ---------------------------        -------   -------------   ----");

    foreach ((string label, bool tokenIntoWork) in
        new[] { ("everything, including the write", true), ("only the wait for the next item", false) })
    {
        var ledger = new Ledger();

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddSingleton(ledger);
        builder.Services.AddSingleton(new WorkerOptions { TokenIntoWork = tokenIntoWork });
        builder.Services.AddHostedService<SettlementWorker>();

        var app = builder.Build();

        await app.StartAsync();

        // Stop in the middle of an item.
        await Task.Delay(130);
        await app.StopAsync();
        await app.DisposeAsync();

        Console.WriteLine($"   {label,-34} {ledger.Settled,7}   {ledger.Returned,13}   {ledger.Lost,4}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE PAYMENT WAS TAKEN OFF THE QUEUE, AND THE WRITE THAT WOULD");
    Console.WriteLine("   HAVE RECORDED IT WAS CANCELLED BY SHUTDOWN. It is not on the queue,");
    Console.WriteLine("   because it was taken. It is not settled, because the write never");
    Console.WriteLine("   happened. Nothing threw, nothing logged, and nothing is left to");
    Console.WriteLine("   retry.");
    Console.WriteLine();
    Console.WriteLine("   THE CAUSE IS THE ADVICE FROM EXERCISE 2, APPLIED TOO EVENLY.");
    Console.WriteLine("   'Pass the cancellation token to everything' is right for waiting and");
    Console.WriteLine("   wrong for committing. A token passed to a write says 'abandon this");
    Console.WriteLine("   halfway through if we are stopping', and halfway through a write is");
    Console.WriteLine("   the one place you do not want to be.");
    Console.WriteLine();
    Console.WriteLine("   SO A LOOP HAS TWO REGIONS AND THEY WANT OPPOSITE THINGS:");
    Console.WriteLine();
    Console.WriteLine("     THE WAIT - blocking for the next item, sleeping between polls.");
    Console.WriteLine("     Cancel this instantly. It is where shutdown should land, and a");
    Console.WriteLine("     worker that spends most of its time here shuts down fast.");
    Console.WriteLine();
    Console.WriteLine("     THE UNIT OF WORK - once an item is claimed, up to the point it is");
    Console.WriteLine("     durably recorded. FINISH THIS. Give it its own deadline if you like,");
    Console.WriteLine("     but do not tie it to shutdown, and make sure the shutdown timeout is");
    Console.WriteLine("     long enough to let one item complete.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS WHY THE SECOND ROW LOSES NOTHING. Same shutdown, same timing,");
    Console.WriteLine("   and the in-flight item is allowed to finish.");
    Console.WriteLine();
    Console.WriteLine("   AND THE DEEPER FIX IS TO NOT NEED THE COOPERATION AT ALL. If the item");
    Console.WriteLine("   is only removed from the queue once it has been processed - a peek-lock");
    Console.WriteLine("   with a visibility timeout, a transaction that spans the read and the");
    Console.WriteLine("   write - then a process that dies mid-item loses nothing, because the");
    Console.WriteLine("   item comes back on its own.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS THE REAL LESSON: GRACEFUL SHUTDOWN IS A NICETY AND AT-LEAST-");
    Console.WriteLine("   ONCE DELIVERY IS A GUARANTEE. Shutdown handling makes the common case");
    Console.WriteLine("   tidy. It cannot help you when the process is killed, the machine is");
    Console.WriteLine("   lost, or the timeout expires - and those all happen, so the queue has");
    Console.WriteLine("   to be the thing that makes the work safe.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static string Format(List<double> fires) =>
    string.Join("  ", fires.Select(f => $"{f,4:0}"));

// ---------------------------------------------------------------------------
// How far the last firing is from where a perfect schedule would have put it.
static double Drift(List<double> fires, double period) =>
    fires[^1] - (fires.Count - 1) * period;

// ---------------------------------------------------------------------------
sealed class WarmInStart : IHostedService
{
    public static Stopwatch Clock = null!;

    public static double WarmAt;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await Task.Delay(300, cancellationToken);

        WarmAt = Clock.Elapsed.TotalMilliseconds;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

// ---------------------------------------------------------------------------
sealed class WarmInExecute : BackgroundService
{
    public static Stopwatch Clock = null!;

    public static double WarmAt;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(300, stoppingToken);

        WarmAt = Clock.Elapsed.TotalMilliseconds;

        await Task.Delay(Timeout.Infinite, stoppingToken);
    }
}

// ---------------------------------------------------------------------------
// A loop that can be told whether to look at its stopping token.
sealed class StubbornWorker : BackgroundService
{
    public static bool Honour;

    public static bool Abandoned;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (true)
        {
            if (Honour && stoppingToken.IsCancellationRequested)
            {
                return;
            }

            Abandoned = true;

            // The token is only passed when the worker is honouring it, which
            // is what makes the difference measurable.
            try
            {
                await Task.Delay(50, Honour ? stoppingToken : CancellationToken.None);
            }
            catch (OperationCanceledException)
            {
                Abandoned = false;

                return;
            }

            Abandoned = false;
        }
    }
}

// ---------------------------------------------------------------------------
sealed class WorkerOptions
{
    public bool TokenIntoWork { get; init; }
}

// ---------------------------------------------------------------------------
// Counts what happened to every payment the worker claimed.
sealed class Ledger
{
    int claimed;

    public int Settled;

    public int Returned;

    public int Lost => claimed - Settled - Returned;

    public int Claim() => Interlocked.Increment(ref claimed);
}

// ---------------------------------------------------------------------------
// Takes an item, calls the gateway, records the result. The only question is
// which token the recording step is given.
sealed class SettlementWorker(Ledger ledger, WorkerOptions options) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            // The wait for the next item: always cancellable.
            try
            {
                await Task.Delay(20, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            ledger.Claim();

            // The unit of work. Cancelling here is what loses the payment.
            CancellationToken workToken = options.TokenIntoWork
                ? stoppingToken
                : CancellationToken.None;

            try
            {
                await Task.Delay(60, workToken);

                Interlocked.Increment(ref ledger.Settled);
            }
            catch (OperationCanceledException)
            {
                // Nothing puts it back. It is simply gone.
                return;
            }
        }
    }
}
