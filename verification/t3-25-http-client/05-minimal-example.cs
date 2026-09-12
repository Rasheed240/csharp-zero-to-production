// 05-minimal-example.cs — One typed client with every decision made: the
// factory owns the handler, the connection is recycled, every call has a
// budget the caller can shorten, all three outcomes are modelled, and the
// retry stops when the budget does.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: the outcomes and counts are deterministic. The timings are
// machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// DECISION 1: a typed client, registered with the factory. Nothing in the
// application ever writes 'new HttpClient()'.
builder.Services.AddHttpClient<PricingClient>(client =>
{
    // DECISION 2: a backstop, not a budget. The per-call budget is a token.
    client.Timeout = TimeSpan.FromSeconds(5);
})
// DECISION 3: connections are recycled, so a failover is noticed. Set here
// as well as through the handler lifetime, because it survives a client
// that somebody captures.
.ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(2),
    ConnectTimeout = TimeSpan.FromSeconds(2)
});

var app = builder.Build();

// The dependency, with the three things a dependency does.
app.MapGet("/v1/prices/{id}", async (string id, CancellationToken token) =>
{
    if (id == "SKU-SLOW")
    {
        await Task.Delay(3000, token);
    }

    return id switch
    {
        "SKU-404" => Results.NotFound(),
        "SKU-BOOM" => Results.Problem("The pricing database is unavailable.", statusCode: 500),
        _ => Results.Ok(new Price(id, 4999))
    };
});

await app.StartAsync();

PricingClient.BaseAddress = app.Urls.First();

Console.WriteLine("One typed client, every decision made");
Console.WriteLine();
Console.WriteLine("   what was asked for                 outcome                          took");
Console.WriteLine("   ------------------                 -------                          ----");

foreach ((string label, string id) in new[]
{
    ("an ordinary price", "SKU-001"),
    ("one that does not exist", "SKU-404"),
    ("one the database is broken for", "SKU-BOOM"),
    ("one that will not answer in time", "SKU-SLOW")
})
{
    using IServiceScope scope = app.Services.CreateScope();

    // DECISION 4: the client is resolved where it is used, never held.
    var pricing = scope.ServiceProvider.GetRequiredService<PricingClient>();

    var clock = Stopwatch.StartNew();

    // DECISION 5: the caller's token goes in. In a request handler this is
    // HttpContext.RequestAborted, so a user who leaves stops the work.
    PriceResult result = await pricing.GetPriceAsync(id, CancellationToken.None);

    string outcome = result switch
    {
        PriceResult.Found found => $"found, {found.Price.AmountMinor}",
        PriceResult.Missing => "missing",
        PriceResult.Failed failed => $"failed: {failed.Reason}",
        _ => "unreachable"
    };

    Console.WriteLine($"   {label,-34} {outcome,-32} {clock.Elapsed.TotalMilliseconds,4:0} ms");
}

Console.WriteLine();
Console.WriteLine($"   the reason the dependency gave, kept   \"{PricingClient.LastReason}\"");
Console.WriteLine($"   attempts made on the slow call         {PricingClient.LastAttempts}");
Console.WriteLine($"   calls that outran their budget         {PricingClient.BudgetExceeded}");

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   EVERY DECISION, AND WHY:");
Console.WriteLine();
Console.WriteLine("     THE FACTORY OWNS THE HANDLER. A client per call opens a connection per");
Console.WriteLine("     call and a socket per connection, and the ports do not come back for");
Console.WriteLine("     four minutes. A client that lives forever never resolves the name");
Console.WriteLine("     again. The factory is the arrangement that avoids both.");
Console.WriteLine();
Console.WriteLine("     THE CONNECTION IS RECYCLED EVERY TWO MINUTES. That is what makes a");
Console.WriteLine("     failover, a scale-out or a redeploy visible to this service. It costs");
Console.WriteLine("     one handshake every two minutes.");
Console.WriteLine();
Console.WriteLine("     HttpClient.Timeout IS A BACKSTOP AND THE BUDGET IS A TOKEN. A token");
Console.WriteLine("     covers a streamed body read, which Timeout does not; it can be shortened");
Console.WriteLine("     by a caller who has less time than we assumed; and it is the only one of");
Console.WriteLine("     the two that a retry loop can consult.");
Console.WriteLine();
Console.WriteLine("     ALL THREE OUTCOMES ARE MODELLED. Found, missing, and failed - because a");
Console.WriteLine("     call can succeed, fail with an answer, or fail without one, and code");
Console.WriteLine("     that models two of those gets the third wrong silently. Notice that");
Console.WriteLine("     'missing' is not a failure: a 404 is an answer.");
Console.WriteLine();
Console.WriteLine("     THE FAILURE REASON IS READ BEFORE IT IS THROWN AWAY. The dependency");
Console.WriteLine("     said why. EnsureSuccessStatusCode would have discarded it.");
Console.WriteLine();
Console.WriteLine("     THE RETRY STOPS WHEN THE BUDGET DOES. Three attempts at 400 ms is 1.2");
Console.WriteLine("     seconds, which is not what a caller with an 800 ms budget agreed to.");
Console.WriteLine("     The loop checks the budget, so the attempt count is a maximum rather");
Console.WriteLine("     than a schedule.");
Console.WriteLine();
Console.WriteLine("   WHAT THIS STILL DOES NOT DECIDE:");
Console.WriteLine();
Console.WriteLine("     THE BUDGET ITSELF. 800 ms is a number in this file. In a real system it");
Console.WriteLine("     comes from what the person waiting will tolerate, and each hop spends a");
Console.WriteLine("     share of it.");
Console.WriteLine();
Console.WriteLine("     WHETHER TO RETRY AT ALL. Retries help with a dropped packet or a");
Console.WriteLine("     restarting instance. Against a dependency that is slow because it is");
Console.WriteLine("     overloaded they multiply the load at the worst moment - and a retry of a");
Console.WriteLine("     non-idempotent call is a second charge, not a second attempt.");
Console.WriteLine();
Console.WriteLine("     AND WHAT HAPPENS AFTER REPEATED FAILURE. A circuit breaker, a fallback");
Console.WriteLine("     price, a queued order, or a refusal - all of them policy, none of them");
Console.WriteLine("     HttpClient's business. In a real service the retry loop below would be");
Console.WriteLine("     AddStandardResilienceHandler from Microsoft.Extensions.Http.Resilience,");
Console.WriteLine("     which brings a breaker, a bounded concurrency limit and a per-attempt");
Console.WriteLine("     timeout. It is written by hand here so nothing is hidden.");

// ---------------------------------------------------------------------------
public record Price(string Id, int AmountMinor);

// Three outcomes, in the type, so a caller cannot forget one.
public abstract record PriceResult
{
    public sealed record Found(Price Price) : PriceResult;

    public sealed record Missing : PriceResult;

    public sealed record Failed(string Reason) : PriceResult;
}

// ---------------------------------------------------------------------------
public sealed class PricingClient(HttpClient http)
{
    public static string BaseAddress = "";

    public static string LastReason = "";

    public static int LastAttempts;

    public static int BudgetExceeded;

    private static readonly TimeSpan Budget = TimeSpan.FromMilliseconds(800);

    private static readonly TimeSpan PerAttempt = TimeSpan.FromMilliseconds(400);

    public async Task<PriceResult> GetPriceAsync(string id, CancellationToken callerToken)
    {
        // The budget for the whole operation, and the caller's token, together.
        // Whichever ends first ends the call.
        using var operation = CancellationTokenSource.CreateLinkedTokenSource(callerToken);
        operation.CancelAfter(Budget);

        LastAttempts = 0;

        for (int attempt = 1; attempt <= 3; attempt++)
        {
            LastAttempts = attempt;

            // Each attempt gets its own shorter deadline, inside the budget.
            using var perAttempt = CancellationTokenSource.CreateLinkedTokenSource(operation.Token);
            perAttempt.CancelAfter(PerAttempt);

            try
            {
                HttpResponseMessage response = await http.GetAsync(
                    $"{BaseAddress}/v1/prices/{id}",
                    HttpCompletionOption.ResponseHeadersRead,
                    perAttempt.Token);

                if (response.StatusCode == HttpStatusCode.NotFound)
                {
                    // An answer, not a failure, and never worth retrying.
                    return new PriceResult.Missing();
                }

                if (response.IsSuccessStatusCode)
                {
                    Price? price = await response.Content.ReadFromJsonAsync<Price>(perAttempt.Token);

                    return price is null
                        ? new PriceResult.Failed("the response body was empty")
                        : new PriceResult.Found(price);
                }

                // Read the reason before deciding anything. This is the line
                // EnsureSuccessStatusCode would have skipped.
                string body = await response.Content.ReadAsStringAsync(perAttempt.Token);

                LastReason = Summarise(body);

                if (!IsRetryable(response.StatusCode))
                {
                    return new PriceResult.Failed($"{(int)response.StatusCode}, {LastReason}");
                }
            }
            catch (OperationCanceledException) when (callerToken.IsCancellationRequested)
            {
                // Nobody is waiting. Do not retry, do not log an error.
                throw;
            }
            catch (OperationCanceledException) when (operation.IsCancellationRequested)
            {
                BudgetExceeded++;

                return new PriceResult.Failed("the budget ran out");
            }
            catch (OperationCanceledException)
            {
                // This attempt ran out of time; the budget has not.
            }
            catch (HttpRequestException exception)
            {
                // No response at all: refused, reset, unresolvable.
                LastReason = exception.Message;
            }

            if (attempt < 3)
            {
                try
                {
                    await Task.Delay(TimeSpan.FromMilliseconds(50 * attempt), operation.Token);
                }
                catch (OperationCanceledException) when (!callerToken.IsCancellationRequested)
                {
                    BudgetExceeded++;

                    return new PriceResult.Failed("the budget ran out");
                }
            }
        }

        return new PriceResult.Failed("three attempts failed");
    }

    private static bool IsRetryable(HttpStatusCode status) =>
        status is HttpStatusCode.RequestTimeout
            or HttpStatusCode.TooManyRequests
            or HttpStatusCode.InternalServerError
            or HttpStatusCode.BadGateway
            or HttpStatusCode.ServiceUnavailable
            or HttpStatusCode.GatewayTimeout;

    private static string Summarise(string body)
    {
        // A ProblemDetails document says why in one field. Pull that out rather
        // than logging the whole envelope, and fall back to a truncation when
        // the body is not JSON at all.
        try
        {
            using JsonDocument document = JsonDocument.Parse(body);

            if (document.RootElement.TryGetProperty("detail", out JsonElement detail))
            {
                return detail.GetString() ?? "";
            }
        }
        catch (JsonException)
        {
        }

        string flattened = body.Replace('\n', ' ').Replace('\r', ' ');

        return flattened.Length <= 120 ? flattened : flattened[..120];
    }
}
