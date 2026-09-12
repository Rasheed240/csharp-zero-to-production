// 03-production.cs — The incident: the sender's dashboard said our endpoint
// was failing, our logs said every request succeeded, and we had processed
// three times as many events as we were sent.
//
// Twenty events, a real sender with a real timeout, and a receiver that does
// its work before it answers.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: the counts are deterministic. The millisecond figures are
// machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using System.Threading.Channels;

int deliveriesReceived = 0;
int chargesApplied = 0;

var work = Channel.CreateUnbounded<string>();
var durable = new List<string>();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// The way it was written: verify, then do the work, then answer.
app.MapPost("/hooks/slow", async (HttpRequest request) =>
{
    Interlocked.Increment(ref deliveriesReceived);

    // The work. A few database round trips and a call to another service -
    // nothing pathological, and far more than a webhook budget allows.
    await Task.Delay(900);

    Interlocked.Increment(ref chargesApplied);

    return Results.Ok();
});

// The same receiver, answering as soon as the event is safely recorded.
app.MapPost("/hooks/fast", async (HttpRequest request) =>
{
    Interlocked.Increment(ref deliveriesReceived);

    string id = request.Headers["x-ledger-event-id"]!;

    // DURABLE FIRST. The 202 is a promise, and this is what makes it one.
    lock (durable)
    {
        if (durable.Contains(id))
        {
            // Already recorded. Acknowledging again is correct and cheap.
            return Results.Accepted();
        }

        durable.Add(id);
    }

    await work.Writer.WriteAsync(id);

    return Results.Accepted();
});

await app.StartAsync();

string baseAddress = app.Urls.First();

// The worker that does what the fast endpoint promised.
var workerDone = new TaskCompletionSource();

_ = Task.Run(async () =>
{
    await foreach (string id in work.Reader.ReadAllAsync())
    {
        await Task.Delay(900);

        Interlocked.Increment(ref chargesApplied);

        if (chargesApplied == 20)
        {
            workerDone.SetResult();
        }
    }
});

Console.WriteLine("The receiver that did its work before answering");
Console.WriteLine();
Console.WriteLine("   09:15  our partner reports our webhook endpoint is failing");
Console.WriteLine("   09:20  our logs show every request returning 200");
Console.WriteLine("   09:40  a customer reports being charged three times");
Console.WriteLine("   09:55  we have processed 60 events. They sent 20.");
Console.WriteLine();

// ---------------------------------------------------------------------------
Console.WriteLine("1. TWENTY EVENTS, THE WAY IT WAS BUILT");
Console.WriteLine();

Result slow = await SendAll("/hooks/slow", expectAsyncWork: false);

Report(slow);

Console.WriteLine();
Console.WriteLine("   BOTH SIDES ARE TELLING THE TRUTH. Every request we received, we processed");
Console.WriteLine("   and answered 200. Every delivery they made, they gave up on before the");
Console.WriteLine("   answer arrived. NOBODY IS LYING AND NOBODY IS LOOKING AT THE SAME EVENT.");
Console.WriteLine();
Console.WriteLine("   THE SENDER'S TIMEOUT IS NOT NEGOTIABLE AND IT IS NOT PUBLISHED. Most");
Console.WriteLine("   providers allow somewhere between 3 and 30 seconds and do not tell you");
Console.WriteLine("   which. A receiver that takes 900 ms today is inside every budget; the same");
Console.WriteLine("   receiver after one more feature is not, and nothing warns.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("2. THE SAME EVENTS, ANSWERED FIRST AND PROCESSED AFTER");
Console.WriteLine();

Result fast = await SendAll("/hooks/fast", expectAsyncWork: true);

Report(fast);

Console.WriteLine();
Console.WriteLine("   THE WORK STILL TAKES 900 ms. Nothing was optimised - the handler simply");
Console.WriteLine("   stopped holding the sender's connection open while it ran.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("3. WHAT THE NUMBERS SAY");
Console.WriteLine();
Console.WriteLine("                                     work inline    answer first");
Console.WriteLine("                                     -----------    ------------");
Console.WriteLine($"   deliveries the sender made     {slow.Deliveries,15}  {fast.Deliveries,14}");
Console.WriteLine($"   deliveries it recorded failed  {slow.SenderFailures,15}  {fast.SenderFailures,14}");
Console.WriteLine($"   charges we applied             {slow.Charges,15}  {fast.Charges,14}");
Console.WriteLine($"   events actually sent           {20,15}  {20,14}");
Console.WriteLine($"   took                           {slow.Ms,13:0} ms  {fast.Ms,12:0} ms");
Console.WriteLine();
Console.WriteLine("   THE LESSONS, IN THE ORDER THEY COST MONEY:");
Console.WriteLine();
Console.WriteLine("     A WEBHOOK HANDLER IS ON SOMEBODY ELSE'S CLOCK. The budget belongs to the");
Console.WriteLine("     sender, you do not get to see it, and exceeding it does not fail - it");
Console.WriteLine("     RETRIES. Slow does not degrade into slow here; it degrades into");
Console.WriteLine("     duplicate.");
Console.WriteLine();
Console.WriteLine("     ACKNOWLEDGE, THEN WORK. Verify the signature, write the event down");
Console.WriteLine("     somewhere durable, return 200 or 202, and do the work on your own time");
Console.WriteLine("     with your own retries - which you control and can observe.");
Console.WriteLine();
Console.WriteLine("     'DURABLE' IS THE LOAD-BEARING WORD. A 202 says 'I have this'. Answering");
Console.WriteLine("     202 and putting the event in an in-memory queue makes that a lie, and a");
Console.WriteLine("     deploy is enough to expose it - section 4.");
Console.WriteLine();
Console.WriteLine("     AND THE IDEMPOTENCY CHECK IS WHAT MAKES THE FIRST ROW SURVIVABLE. Even");
Console.WriteLine("     with a fast acknowledgement a duplicate can arrive, because the sender");
Console.WriteLine("     may have timed out at exactly the wrong moment. Fast acknowledgement");
Console.WriteLine("     makes duplicates rare; only the id check makes them harmless.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("4. AND THE FAST ACKNOWLEDGEMENT THAT LIES");
Console.WriteLine();

var inMemory = new Queue<string>();
var written = new List<string>();

// Twelve events accepted, four processed, then the process goes away.
for (int n = 0; n < 12; n++)
{
    inMemory.Enqueue($"evt_{n:00}");
}

for (int n = 0; n < 4 && inMemory.Count > 0; n++)
{
    written.Add(inMemory.Dequeue());
}

Console.WriteLine("   a deploy restarts the receiver mid-queue:");
Console.WriteLine();
Console.WriteLine($"     events acknowledged with 202        12");
Console.WriteLine($"     events processed before the restart {written.Count}");
Console.WriteLine($"     events still in the in-memory queue {inMemory.Count}");
Console.WriteLine($"     events that survive the restart     0");
Console.WriteLine($"     events the sender will retry        0  (it has a 202 for all 12)");
Console.WriteLine();
Console.WriteLine("   EIGHT EVENTS GONE, AND NOTHING ANYWHERE RECORDS A PROBLEM. We told the");
Console.WriteLine("   sender we had them, so it will never send them again; we lost them, so");
Console.WriteLine("   they were never processed. THE ACKNOWLEDGEMENT WAS A PROMISE AND WE HAD");
Console.WriteLine("   NOT YET EARNED THE RIGHT TO MAKE IT.");
Console.WriteLine();
Console.WriteLine("   THE ORDER IS THE ENTIRE POINT: WRITE IT DOWN, THEN ACKNOWLEDGE. A row in");
Console.WriteLine("   the same database the work will use, a durable queue, anything that");
Console.WriteLine("   survives the process. An in-memory queue, a fire-and-forget Task, or");
Console.WriteLine("   IHostedService state are all the same bug wearing different clothes.");
Console.WriteLine();
Console.WriteLine("   AND IT IS A ROUTINE DEPLOY THAT EXPOSES IT, not a crash - which means it");
Console.WriteLine("   happens on a Tuesday afternoon, to a small number of events, silently.");

await app.StopAsync();

// ---------------------------------------------------------------------------
async Task<Result> SendAll(string route, bool expectAsyncWork)
{
    deliveriesReceived = 0;
    chargesApplied = 0;

    // A sender with the budget a real one has, and the retries a real one has.
    using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(500) };

    int senderFailures = 0;

    var clock = Stopwatch.StartNew();

    await Task.WhenAll(Enumerable.Range(0, 20).Select(n => Task.Run(async () =>
    {
        for (int attempt = 1; attempt <= 3; attempt++)
        {
            var message = new HttpRequestMessage(HttpMethod.Post, $"{baseAddress}{route}");
            message.Headers.Add("x-ledger-event-id", $"evt_{n:00}");

            try
            {
                HttpResponseMessage response = await http.SendAsync(message);

                if (response.IsSuccessStatusCode)
                {
                    return;
                }
            }
            catch (TaskCanceledException)
            {
                // Timed out. The sender does not know whether it was handled.
            }
        }

        Interlocked.Increment(ref senderFailures);
    })));

    double senderMs = clock.Elapsed.TotalMilliseconds;

    if (expectAsyncWork)
    {
        await workerDone.Task;
    }
    else
    {
        // The sender has given up, and our handlers are still running. Let
        // them finish before counting, or the tally is of work in flight
        // rather than work done.
        while (chargesApplied < deliveriesReceived)
        {
            await Task.Delay(50);
        }
    }

    return new Result(deliveriesReceived, senderFailures, chargesApplied, senderMs);
}

static void Report(Result result)
{
    Console.WriteLine($"   deliveries the receiver saw            {result.Deliveries}");
    Console.WriteLine($"   deliveries the sender recorded failed  {result.SenderFailures} of 20");
    Console.WriteLine($"   charges applied                        {result.Charges}");
    Console.WriteLine($"   events actually sent                   20");
    Console.WriteLine($"   took                                   {result.Ms:0} ms");
}

// ---------------------------------------------------------------------------
public sealed record Result(int Deliveries, int SenderFailures, int Charges, double Ms);
