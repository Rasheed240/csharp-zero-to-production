// 00-smallest.cs — The smallest background worker, and the four things it has
// already decided.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: the counts, states and option values are deterministic. The
// millisecond timings are machine-specific; the claims are the orderings.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using Microsoft.Extensions.Options;

var clock = Stopwatch.StartNew();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The line everybody writes.
builder.Services.AddHostedService<ReconciliationWorker>();

var app = builder.Build();

app.MapGet("/v1/payments/{id}", (string id) => Results.Ok(new { id, status = "captured" }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("The smallest background worker");
Console.WriteLine();
Console.WriteLine($"   the host started after   {clock.Elapsed.TotalMilliseconds:0} ms");
Console.WriteLine($"   the worker had run       {ReconciliationWorker.Iterations} iterations by then");
Console.WriteLine();

// Let it work for a moment while the web app also serves traffic.
await Task.Delay(500);

Console.WriteLine($"   after 500 ms more:");
Console.WriteLine($"     worker iterations      {ReconciliationWorker.Iterations}");
Console.WriteLine($"     a request still works  " +
    $"{(int)(await http.GetAsync("/v1/payments/PAY-001")).StatusCode}");
Console.WriteLine();

// The two settings that decide what happens when things go wrong. Neither was
// chosen by anybody.
HostOptions options = app.Services.GetRequiredService<IOptions<HostOptions>>().Value;

Console.WriteLine("   THE DEFAULTS NOBODY SET");
Console.WriteLine();
Console.WriteLine($"     BackgroundServiceExceptionBehavior   {options.BackgroundServiceExceptionBehavior}");
Console.WriteLine($"     ShutdownTimeout                      {options.ShutdownTimeout}");
Console.WriteLine($"     ServicesStartConcurrently            {options.ServicesStartConcurrently}");
Console.WriteLine($"     ServicesStopConcurrently             {options.ServicesStopConcurrently}");
Console.WriteLine();

// Shutting down, and how long the worker makes it take.
var shutdown = Stopwatch.StartNew();
await app.StopAsync();

Console.WriteLine($"   SHUTDOWN");
Console.WriteLine();
Console.WriteLine($"     StopAsync took           {shutdown.Elapsed.TotalMilliseconds:0} ms");
Console.WriteLine($"     worker saw the stop      {ReconciliationWorker.SawStop}");
Console.WriteLine($"     final iteration count    {ReconciliationWorker.Iterations}");
Console.WriteLine();

Console.WriteLine("   FOUR THINGS THAT WORKER HAS ALREADY DECIDED, none of them deliberately:");
Console.WriteLine();
Console.WriteLine("     1. WHETHER IT DELAYS STARTUP. A hosted service runs inside the host's");
Console.WriteLine("        start sequence, so work done before the first await holds up the");
Console.WriteLine("        whole application - including the web server that has not begun");
Console.WriteLine("        listening yet.");
Console.WriteLine();
Console.WriteLine("     2. WHAT HAPPENS WHEN IT THROWS. The default is StopHost, which sounds");
Console.WriteLine("        decisive and is subtler than it sounds - the next file measures");
Console.WriteLine("        what it actually does.");
Console.WriteLine();
Console.WriteLine("     3. WHERE ITS DEPENDENCIES COME FROM. A hosted service is a SINGLETON.");
Console.WriteLine("        Anything scoped it takes in its constructor is captured for the");
Console.WriteLine("        lifetime of the process.");
Console.WriteLine();
Console.WriteLine("     4. HOW LONG SHUTDOWN TAKES. The loop decides. A worker that ignores");
Console.WriteLine("        its stopping token holds the process open until a thirty-second");
Console.WriteLine("        timeout nobody chose, and is then abandoned mid-work.");
Console.WriteLine();
Console.WriteLine("   NONE OF THOSE IS A BUG IN THE FRAMEWORK. Each is a decision it cannot");
Console.WriteLine("   make for you, defaulted to whatever is least surprising in the simplest");
Console.WriteLine("   case - and the simplest case is not a service that has to stay up.");

// ---------------------------------------------------------------------------
// The worker as it is usually first written: a loop, a delay, and no thought
// about any of the four questions above.
sealed class ReconciliationWorker : BackgroundService
{
    public static int Iterations;

    public static bool SawStop;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            Interlocked.Increment(ref Iterations);

            try
            {
                await Task.Delay(100, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                SawStop = true;

                return;
            }
        }

        SawStop = true;
    }
}
