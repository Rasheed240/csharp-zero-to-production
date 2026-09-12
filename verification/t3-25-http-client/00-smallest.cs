// 00-smallest.cs — One HttpClient calling one endpoint, and the three defaults
// that are wrong for a service calling another service.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every status code, exception type and count here is
// deterministic. The timings are machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Net;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

app.MapGet("/v1/payments/{id}", (string id) => id switch
{
    "PAY-001" => Results.Ok(new { id, status = "captured" }),
    "PAY-404" => Results.NotFound(),
    _ => Results.Problem("The ledger is unavailable.", statusCode: 500)
});

await app.StartAsync();

string baseAddress = app.Urls.First();

Console.WriteLine("One HttpClient, one endpoint");
Console.WriteLine();

// The whole client side. One instance, used for every call.
using var http = new HttpClient { BaseAddress = new Uri(baseAddress) };

Console.WriteLine("   what was asked for        status               did it throw?");
Console.WriteLine("   ------------------        ------               -------------");

foreach ((string label, string id) in new[]
{
    ("a payment that exists", "PAY-001"),
    ("one that does not", "PAY-404"),
    ("one the ledger fails on", "PAY-BOOM")
})
{
    HttpResponseMessage response = await http.GetAsync($"/v1/payments/{id}");

    Console.WriteLine($"   {label,-25} {(int)response.StatusCode} {response.StatusCode,-16} no");
}

Console.WriteLine();
Console.WriteLine("   NOTHING THREW. HttpClient treats 404 and 500 as answers, because they are:");
Console.WriteLine("   the request was sent, a server replied, and the reply says no. An exception");
Console.WriteLine("   is for a request that could not be answered at all - a refused connection,");
Console.WriteLine("   a DNS failure, a timeout.");
Console.WriteLine();
Console.WriteLine("   THAT IS THE OPPOSITE OF WHAT MOST CALLING CODE ASSUMES, and it is why");
Console.WriteLine("   'await http.GetFromJsonAsync' with no status check is the single commonest");
Console.WriteLine("   bug in service-to-service code.");
Console.WriteLine();

// EnsureSuccessStatusCode is the opt-in.
try
{
    HttpResponseMessage response = await http.GetAsync("/v1/payments/PAY-BOOM");

    response.EnsureSuccessStatusCode();
}
catch (HttpRequestException exception)
{
    Console.WriteLine("   WITH EnsureSuccessStatusCode():");
    Console.WriteLine($"     exception    {exception.GetType().Name}");
    Console.WriteLine($"     status       {exception.StatusCode}");
    Console.WriteLine($"     message      {exception.Message}");
    Console.WriteLine();
    Console.WriteLine("   NOTE WHAT IS NOT THERE: the response body. EnsureSuccessStatusCode throws");
    Console.WriteLine("   before anybody reads it, so the ProblemDetails the server carefully");
    Console.WriteLine("   produced - the one that says WHY - is discarded. Read the body first if");
    Console.WriteLine("   you want to log anything useful.");
}

Console.WriteLine();

// The three defaults.
Console.WriteLine("   THE THREE DEFAULTS THAT MATTER:");
Console.WriteLine();
Console.WriteLine($"     HttpClient.Timeout                 {http.Timeout}");
Console.WriteLine($"     an error status throws             no");
Console.WriteLine($"     connections are recycled after     never (PooledConnectionLifetime is infinite)");
Console.WriteLine();
Console.WriteLine("   100 SECONDS IS NOT A TIMEOUT, IT IS A BACKSTOP. No user waits 100 seconds,");
Console.WriteLine("   and a service holding a request for 100 seconds has held a thread, a");
Console.WriteLine("   connection and a scope for 100 seconds. Every call in a request path needs");
Console.WriteLine("   a budget measured in hundreds of milliseconds, and it has to be set");
Console.WriteLine("   deliberately because the default will not do it for you.");

// A second server, started and then stopped, so its port is certainly closed
// and certainly ours.
var gone = WebApplication.CreateBuilder();
gone.WebHost.UseUrls("http://127.0.0.1:0");
gone.Logging.ClearProviders();

var goneApp = gone.Build();
await goneApp.StartAsync();

string closedAddress = goneApp.Urls.First();

await goneApp.StopAsync();

// ConnectTimeout is separate from HttpClient.Timeout and bounds only the
// TCP connect. It is the one that matters when an address does not answer.
var refused = new HttpClient(new SocketsHttpHandler
{
    ConnectTimeout = TimeSpan.FromMilliseconds(600)
})
{
    Timeout = TimeSpan.FromSeconds(5)
};

var connectClock = System.Diagnostics.Stopwatch.StartNew();

try
{
    await refused.GetAsync($"{closedAddress}/v1/payments/PAY-001");
}
catch (Exception exception)
{
    Console.WriteLine();
    Console.WriteLine("   AND WHEN THERE IS NOTHING TO TALK TO:");
    Console.WriteLine($"     exception    {exception.GetType().Name}");
    Console.WriteLine($"     inner        {exception.InnerException?.GetType().Name ?? "none"}");
    Console.WriteLine($"     status       {((exception as HttpRequestException)?.StatusCode is null ? "none - there was no response" : (exception as HttpRequestException)!.StatusCode.ToString())}");
    Console.WriteLine($"     failed after {connectClock.Elapsed.TotalMilliseconds:0} ms");
    Console.WriteLine();
    Console.WriteLine("   A TRANSPORT FAILURE IS AN EXCEPTION WITH NO STATUS CODE. That null is the");
    Console.WriteLine("   only thing distinguishing 'the server said no' from 'there was no");
    Console.WriteLine("   server', and it is the distinction a retry policy has to make.");
    Console.WriteLine();
    Console.WriteLine("   AND NOTE HOW LONG IT TOOK. A closed port is supposed to answer with a");
    Console.WriteLine("   refusal immediately. On this machine it did not - the connection attempt");
    Console.WriteLine("   was silently dropped and the only thing that ended it was ConnectTimeout.");
    Console.WriteLine("   A dropped packet looks exactly the same as a busy server, which is why");
    Console.WriteLine("   ConnectTimeout exists as its own setting and why 'the address is wrong'");
    Console.WriteLine("   can present as a slow service rather than a broken one.");
}

await app.StopAsync();
