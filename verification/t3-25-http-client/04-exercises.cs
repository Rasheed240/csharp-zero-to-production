// 04-exercises.cs — Four situations from real tickets. Every answer is
// measured here rather than asserted.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: the exception types, status codes and counts are
// deterministic. The timings are machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

app.MapGet("/v1/prices/{id}", (string id) =>
    Results.Ok(new { id, amountMinor = 4999 }));

// The failure the exercises use: a well-behaved 500 with a ProblemDetails body.
app.MapGet("/v1/prices-broken/{id}", () =>
    Results.Problem("The pricing database is unavailable.", statusCode: 500));

app.MapGet("/v1/slow", async (int ms, CancellationToken token) =>
{
    await Task.Delay(ms, token);

    return Results.Ok(new { id = "SKU-001", amountMinor = 4999 });
});

// Headers immediately, then a body written one chunk at a time.
app.MapGet("/v1/dribble", async (HttpResponse response, CancellationToken token) =>
{
    response.ContentType = "text/plain";

    await response.Body.FlushAsync(token);

    for (int chunk = 0; chunk < 10; chunk++)
    {
        await response.WriteAsync("x", token);
        await response.Body.FlushAsync(token);

        await Task.Delay(300, token);
    }
});

await app.StartAsync();

string baseAddress = app.Urls.First();

Console.WriteLine("Four situations from real tickets");
Console.WriteLine();

await Exercise1();
await Exercise2();
await Exercise3();
await Exercise4();

await app.StopAsync();

// ---------------------------------------------------------------------------
async Task Exercise1()
{
    Console.WriteLine("EXERCISE 1 (easy) - the outage that was recorded as a price of zero");
    Console.WriteLine();
    Console.WriteLine("   Pricing was down for six minutes. No exception was logged by checkout,");
    Console.WriteLine("   no alert fired, and 1,400 orders were written with an amount of 0.");
    Console.WriteLine();
    Console.WriteLine("   What did the calling code look like?");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseAddress) };

    Console.WriteLine("   how the call was written                        what happened");
    Console.WriteLine("   ------------------------                        -------------");

    // The shape that hides it: fetch, then deserialise, with no status check.
    try
    {
        HttpResponseMessage response = await http.GetAsync("/v1/prices-broken/SKU-001");

        Price? price = await response.Content.ReadFromJsonAsync<Price>();

        Console.WriteLine($"   GetAsync + ReadFromJsonAsync                    " +
            $"returned {(price is null ? "null" : $"Price(amountMinor={price.AmountMinor})")}");
    }
    catch (Exception exception)
    {
        Console.WriteLine($"   GetAsync + ReadFromJsonAsync                    threw {exception.GetType().Name}");
    }

    // The shape that does not.
    try
    {
        Price? price = await http.GetFromJsonAsync<Price>("/v1/prices-broken/SKU-001");

        Console.WriteLine($"   GetFromJsonAsync                                " +
            $"returned {(price is null ? "null" : $"Price(amountMinor={price.AmountMinor})")}");
    }
    catch (Exception exception)
    {
        Console.WriteLine($"   GetFromJsonAsync                                threw {exception.GetType().Name}");
    }

    // And the one that reads the problem before deciding.
    HttpResponseMessage checked_ = await http.GetAsync("/v1/prices-broken/SKU-001");

    string body = await checked_.Content.ReadAsStringAsync();

    Console.WriteLine($"   GetAsync, then check the status                 " +
        $"{(int)checked_.StatusCode}, body {body.Length} bytes, kept for the log");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE FIRST SHAPE. A 500 with a JSON body is still JSON, so");
    Console.WriteLine("   ReadFromJsonAsync parsed the ProblemDetails document into a Price and");
    Console.WriteLine("   filled in defaults for the properties it did not find. Zero is not a");
    Console.WriteLine("   sentinel here - it is what an int is when nothing set it.");
    Console.WriteLine();
    Console.WriteLine("   THE SECOND SHAPE IS SAFE, and worth knowing precisely: GetFromJsonAsync");
    Console.WriteLine("   calls EnsureSuccessStatusCode for you. That is a real difference between");
    Console.WriteLine("   two methods that look like conveniences for the same thing.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD IS WHAT PRODUCTION CODE SHOULD DO, because it can log the");
    Console.WriteLine("   reason. EnsureSuccessStatusCode throws before anyone reads the body, so");
    Console.WriteLine("   'The pricing database is unavailable' - which the other service went to");
    Console.WriteLine("   the trouble of sending - is discarded either way.");
    Console.WriteLine();
    Console.WriteLine("   AND THE GENERAL RULE: AN HTTP CALL HAS THREE OUTCOMES, NOT TWO. It");
    Console.WriteLine("   succeeded, it failed with an answer, or it failed without one. Code");
    Console.WriteLine("   that models two of those gets the third one wrong silently.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
async Task Exercise2()
{
    Console.WriteLine("EXERCISE 2 (medium) - 'A task was canceled'");
    Console.WriteLine();
    Console.WriteLine("   A log is full of TaskCanceledException with no other detail. Some are");
    Console.WriteLine("   users closing the browser mid-checkout, which is normal and should not");
    Console.WriteLine("   page anybody. Some are the pricing service timing out, which should.");
    Console.WriteLine();
    Console.WriteLine("   How do you tell them apart?");
    Console.WriteLine();

    using var http = new HttpClient
    {
        BaseAddress = new Uri(baseAddress),
        Timeout = TimeSpan.FromMilliseconds(300)
    };

    Console.WriteLine("   what actually happened     exception                  inner");
    Console.WriteLine("   ----------------------     ---------                  -----");

    // Our own timeout.
    try
    {
        await http.GetAsync("/v1/slow?ms=2000");
    }
    catch (Exception exception)
    {
        Console.WriteLine($"   our timeout elapsed        {exception.GetType().Name,-26} " +
            $"{exception.InnerException?.GetType().Name ?? "none"}");
    }

    // The caller gave up.
    using var caller = new CancellationTokenSource(150);

    try
    {
        await http.GetAsync("/v1/slow?ms=2000", caller.Token);
    }
    catch (Exception exception)
    {
        Console.WriteLine($"   the caller cancelled       {exception.GetType().Name,-26} " +
            $"{exception.InnerException?.GetType().Name ?? "none"}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE INNER EXCEPTION, OR THE TOKEN. Since .NET 5 a timeout");
    Console.WriteLine("   produces a TaskCanceledException whose InnerException is a");
    Console.WriteLine("   TimeoutException. Both rows have an inner exception, so the test is not");
    Console.WriteLine("   whether one exists - IT IS SPECIFICALLY THE TimeoutException. A genuine");
    Console.WriteLine("   cancellation carries another TaskCanceledException instead.");
    Console.WriteLine();
    Console.WriteLine("   IN CODE THAT MEANS ONE CLAUSE:");
    Console.WriteLine();
    Console.WriteLine("     catch (TaskCanceledException e) when (e.InnerException is TimeoutException)");
    Console.WriteLine();
    Console.WriteLine("   OR, EQUIVALENTLY, ASK THE TOKEN: 'callerToken.IsCancellationRequested'");
    Console.WriteLine("   is true when the caller gave up and false when the timeout fired.");
    Console.WriteLine();
    Console.WriteLine("   WHY IT MATTERS BEYOND TIDY LOGS: these two need opposite handling. A");
    Console.WriteLine("   cancelled request should be dropped quietly - nobody is waiting for the");
    Console.WriteLine("   answer, and retrying it wastes work on a dependency that may already be");
    Console.WriteLine("   struggling. A timeout is a dependency signal, and it belongs on a");
    Console.WriteLine("   dashboard. Treating both as errors makes a browser refresh look like an");
    Console.WriteLine("   outage; treating both as normal hides a real one.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
async Task Exercise3()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the retry that made the timeout meaningless");
    Console.WriteLine();
    Console.WriteLine("   A team added retries to a flaky dependency: three attempts, 300 ms");
    Console.WriteLine("   timeout each. The call is on a checkout page with a 500 ms budget.");
    Console.WriteLine("   Latency got worse, not better.");
    Console.WriteLine();
    Console.WriteLine("   Work out what a single call can now cost.");
    Console.WriteLine();

    using var http = new HttpClient
    {
        BaseAddress = new Uri(baseAddress),
        Timeout = TimeSpan.FromMilliseconds(300)
    };

    // Three attempts with a fixed backoff, which is what a default policy does.
    var clock = Stopwatch.StartNew();
    int attempts = 0;

    for (int attempt = 1; attempt <= 3; attempt++)
    {
        attempts++;

        try
        {
            await http.GetAsync("/v1/slow?ms=2000");

            break;
        }
        catch (TaskCanceledException)
        {
            if (attempt < 3)
            {
                await Task.Delay(100);
            }
        }
    }

    double withRetries = clock.Elapsed.TotalMilliseconds;

    // The same call under one budget for the whole operation.
    using var budget = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));

    clock.Restart();
    int boundedAttempts = 0;

    try
    {
        for (int attempt = 1; attempt <= 3; attempt++)
        {
            boundedAttempts++;

            try
            {
                await http.GetAsync("/v1/slow?ms=2000", budget.Token);

                break;
            }
            catch (TaskCanceledException) when (!budget.Token.IsCancellationRequested)
            {
                await Task.Delay(100, budget.Token);
            }
        }
    }
    catch (OperationCanceledException)
    {
        // The overall budget ran out. This is the correct place to stop.
    }

    double withBudget = clock.Elapsed.TotalMilliseconds;

    Console.WriteLine("   how the retries are bounded          attempts made        total time");
    Console.WriteLine("   ---------------------------          -------------        ----------");
    Console.WriteLine($"   per-attempt timeout only             {attempts,13}      {withRetries,7:0} ms");
    Console.WriteLine($"   one budget for the whole operation   {boundedAttempts,13}      {withBudget,7:0} ms");
    Console.WriteLine();
    Console.WriteLine("   ANSWER: A PER-ATTEMPT TIMEOUT IS NOT A BUDGET. Three attempts at 300 ms");
    Console.WriteLine("   with 100 ms between them is 1,100 ms for a call the page can afford 500");
    Console.WriteLine("   for - so the timeout that was supposed to protect the page now more");
    Console.WriteLine("   than doubles what the page can be made to wait.");
    Console.WriteLine();
    Console.WriteLine("   AND THE LATENCY GOT WORSE FOR A SECOND REASON. Retrying a dependency");
    Console.WriteLine("   that is slow because it is overloaded TRIPLES the load on it at exactly");
    Console.WriteLine("   the moment it can least afford it. Retries help with a dropped packet");
    Console.WriteLine("   or a restarting instance; they make an overload worse.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS TWO TIMEOUTS, NOT ONE. A per-attempt timeout so no single");
    Console.WriteLine("   attempt hangs, and ONE BUDGET FOR THE WHOLE OPERATION that the retry");
    Console.WriteLine("   loop checks - which is what the second row does, stopping mid-sequence");
    Console.WriteLine("   when the budget is gone.");
    Console.WriteLine();
    Console.WriteLine("   AND RETRY ONLY WHAT IS WORTH RETRYING: a timeout, a 503, a connection");
    Console.WriteLine("   failure. Retrying a 400 or a 404 spends the budget on an answer that");
    Console.WriteLine("   will not change.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
async Task Exercise4()
{
    Console.WriteLine("EXERCISE 4 (hard) - the timeout that stopped applying");
    Console.WriteLine();
    Console.WriteLine("   A service streams a large report from a partner. HttpClient.Timeout is");
    Console.WriteLine("   set to 2 seconds. A request has been running for forty minutes and the");
    Console.WriteLine("   thread is still held.");
    Console.WriteLine();
    Console.WriteLine("   The timeout is definitely set. Why did nothing fire?");
    Console.WriteLine();

    using var http = new HttpClient
    {
        BaseAddress = new Uri(baseAddress),
        Timeout = TimeSpan.FromMilliseconds(700)
    };

    Console.WriteLine("   how the response is read              outcome                     after");
    Console.WriteLine("   ------------------------              -------                     -----");

    // The default: the whole response, headers and body, under the timeout.
    var clock = Stopwatch.StartNew();

    try
    {
        HttpResponseMessage response = await http.GetAsync("/v1/dribble");

        await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   ResponseContentRead (the default)     completed" +
            $"                   {clock.Elapsed.TotalMilliseconds,6:0} ms");
    }
    catch (Exception exception)
    {
        Console.WriteLine($"   ResponseContentRead (the default)     {exception.GetType().Name,-27} " +
            $"{clock.Elapsed.TotalMilliseconds,6:0} ms");
    }

    // Streaming: the call returns as soon as the headers arrive.
    clock.Restart();

    HttpResponseMessage streamed = await http.GetAsync(
        "/v1/dribble", HttpCompletionOption.ResponseHeadersRead);

    double headersAt = clock.Elapsed.TotalMilliseconds;

    try
    {
        string body = await streamed.Content.ReadAsStringAsync();

        Console.WriteLine($"   ResponseHeadersRead                   headers at {headersAt,4:0} ms, " +
            $"body read   {clock.Elapsed.TotalMilliseconds,6:0} ms");
    }
    catch (Exception exception)
    {
        Console.WriteLine($"   ResponseHeadersRead                   {exception.GetType().Name,-27} " +
            $"{clock.Elapsed.TotalMilliseconds,6:0} ms");
    }

    // The fix: a token that covers the read, because the client's timeout does not.
    clock.Restart();

    using var readBudget = new CancellationTokenSource(TimeSpan.FromMilliseconds(700));

    try
    {
        HttpResponseMessage bounded = await http.GetAsync(
            "/v1/dribble", HttpCompletionOption.ResponseHeadersRead, readBudget.Token);

        await bounded.Content.ReadAsStringAsync(readBudget.Token);

        Console.WriteLine($"   ResponseHeadersRead + a token         completed" +
            $"                   {clock.Elapsed.TotalMilliseconds,6:0} ms");
    }
    catch (Exception exception)
    {
        Console.WriteLine($"   ResponseHeadersRead + a token         {exception.GetType().Name,-27} " +
            $"{clock.Elapsed.TotalMilliseconds,6:0} ms");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: HttpClient.Timeout STOPS APPLYING ONCE THE HEADERS HAVE");
    Console.WriteLine("   ARRIVED, IF YOU ASKED FOR ResponseHeadersRead. The default reads the");
    Console.WriteLine("   whole body before returning, so the timeout covers everything - and the");
    Console.WriteLine("   first row shows it firing. With ResponseHeadersRead the call returns in");
    Console.WriteLine("   milliseconds and the body is read afterwards, outside the timeout's");
    Console.WriteLine("   reach.");
    Console.WriteLine();
    Console.WriteLine("   A PARTNER THAT SENDS HEADERS AND THEN DRIBBLES A BODY HOLDS THE READ");
    Console.WriteLine("   OPEN FOR AS LONG AS IT LIKES. Nothing is broken, nothing is hung in the");
    Console.WriteLine("   TCP sense, and no timeout applies. Forty minutes is not an anomaly - it");
    Console.WriteLine("   is the absence of any limit at all.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD ROW IS THE FIX: PASS A CancellationToken. A token applies to");
    Console.WriteLine("   the whole operation including the body read, which HttpClient.Timeout");
    Console.WriteLine("   does not. That is a good reason to pass a token even when a timeout is");
    Console.WriteLine("   already set.");
    Console.WriteLine();
    Console.WriteLine("   AND THE REASON TO USE ResponseHeadersRead ANYWAY: the default buffers");
    Console.WriteLine("   the entire body into memory before you see a single byte. A 200 MB");
    Console.WriteLine("   report is 200 MB on the large object heap. Streaming is right; it moves");
    Console.WriteLine("   the responsibility for bounding the read onto you.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
public sealed class Price
{
    public string Id { get; set; } = "";

    public int AmountMinor { get; set; }
}
