// 07-production.cs — Ledger's rate limiter stops working after a move to
// Kubernetes, and the fix that restores it opens the admin endpoint to anyone.
//
// Run:  dotnet run 07-production.cs -c Release
//
// EXACT vs RATIO: every count and every allow/deny outcome here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

TheIncident();
await FourConfigurations();
Timeline();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   Ledger's public API rate-limits by client address: 100 requests per");
    Console.WriteLine("   minute per IP. It also restricts /admin to the office network by");
    Console.WriteLine("   the same address. Both worked for two years on virtual machines.");
    Console.WriteLine();
    Console.WriteLine("   The service moves to Kubernetes behind an ingress controller. Within");
    Console.WriteLine("   an hour:");
    Console.WriteLine();
    Console.WriteLine("     - Customers report 429s they have not earned. A merchant doing");
    Console.WriteLine("       ten requests a minute is throttled.");
    Console.WriteLine();
    Console.WriteLine("     - The audit log shows every action in the system performed by one");
    Console.WriteLine("       address, 10.42.0.7, which is nobody.");
    Console.WriteLine();
    Console.WriteLine("     - Nothing was deployed except the platform change. The application");
    Console.WriteLine("       code is identical, and it still passes every test.");
    Console.WriteLine();
    Console.WriteLine("   The cause is that the application is no longer talking to clients.");
    Console.WriteLine("   It is talking to the ingress, and 10.42.0.7 is the ingress. Every");
    Console.WriteLine("   client in the world now shares one rate-limit bucket.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task FourConfigurations()
{
    Console.WriteLine("2. Four configurations, measured");
    Console.WriteLine();
    Console.WriteLine("   Six requests arrive through the ingress at 10.42.0.7:");
    Console.WriteLine("     - five different customers, one request each");
    Console.WriteLine("     - one attacker claiming to be 10.0.0.5, an office address");
    Console.WriteLine();
    Console.WriteLine("   The rate limit is set to 3 per address so it is crossed in a short");
    Console.WriteLine("   test. /admin is restricted to 10.0.0.0/24.");
    Console.WriteLine();

    Result broken = await RunAsync("no forwarded headers", configure: null);

    Result wrongProxy = await RunAsync("headers on, wrong proxy trusted", app =>
    {
        var options = NewOptions();
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();

        // The address of the OLD load balancer, carried over in config.
        options.KnownProxies.Add(IPAddress.Parse("192.168.1.10"));
        app.UseForwardedHeaders(options);
    });

    Result trustAll = await RunAsync("headers on, cleared + no ForwardLimit", app =>
    {
        var options = NewOptions();

        // Two mistakes together, and both are things people write while
        // trying to get the middleware working.
        //
        // Clearing reads like "trust nobody" and means trust EVERYONE -
        // measured in 06-reverse-proxy.cs.
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();

        // Removing the limit walks the chain to its LEFTMOST entry, which is
        // the end the client controls.
        options.ForwardLimit = null;

        app.UseForwardedHeaders(options);
    });

    Result correct = await RunAsync("headers on, the ingress trusted", app =>
    {
        var options = NewOptions();
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Add(IPAddress.Loopback);   // the ingress, in this test
        options.ForwardLimit = 1;
        app.UseForwardedHeaders(options);
    });

    Console.WriteLine("   configuration                           distinct   throttled   admin");
    Console.WriteLine("                                            clients     wrongly   spoofed");
    Console.WriteLine("   -------------                           --------   ---------   -------");
    Show(broken);
    Show(wrongProxy);
    Show(trustAll);
    Show(correct);

    Console.WriteLine();
    Console.WriteLine("   ROW 1 is the incident. One distinct client, so the five customers");
    Console.WriteLine("   share a single bucket and the ones past the limit are throttled for");
    Console.WriteLine("   traffic they did not send. The admin check is safe only by accident:");
    Console.WriteLine("   the attacker's claimed address is ignored along with everybody");
    Console.WriteLine("   else's.");
    Console.WriteLine();
    Console.WriteLine("   ROW 2 is the fix that changes nothing. UseForwardedHeaders is");
    Console.WriteLine("   called, the option object is configured, and the trusted address is");
    Console.WriteLine("   the previous load balancer rather than the new ingress. There is no");
    Console.WriteLine("   error and no warning - the headers are ignored, exactly as in");
    Console.WriteLine("   row 1.");
    Console.WriteLine();
    Console.WriteLine("   This is the state a team can sit in for weeks. The code review shows");
    Console.WriteLine("   the middleware being configured, so the review passes.");
    Console.WriteLine();
    Console.WriteLine("   ROW 3 is the fix that works and opens a hole. Rate limiting is");
    Console.WriteLine("   correct again - five distinct clients, nobody wrongly throttled -");
    Console.WriteLine("   and the attacker reached /admin.");
    Console.WriteLine();
    Console.WriteLine("   Two changes combined to do that, and each is something written");
    Console.WriteLine("   while trying to make the middleware work:");
    Console.WriteLine();
    Console.WriteLine("     CLEARING BOTH SETS trusts every sender rather than none, so a");
    Console.WriteLine("     request that never passed through the ingress is believed too.");
    Console.WriteLine();
    Console.WriteLine("     REMOVING ForwardLimit walks the chain to its LEFTMOST entry. The");
    Console.WriteLine("     ingress appended the real address on the right; the attacker");
    Console.WriteLine("     supplied the left. Taking the left takes the forgery.");
    Console.WriteLine();
    Console.WriteLine("   The tell is that the incident CLOSED. Rate limiting worked, the");
    Console.WriteLine("   tickets stopped, and nothing indicated that an IP allow-list had");
    Console.WriteLine("   become a value anyone could type.");
    Console.WriteLine();
    Console.WriteLine("   ROW 4 is correct on both counts. The ingress is named explicitly and");
    Console.WriteLine("   ForwardLimit is 1, so exactly one entry is taken from the RIGHT of");
    Console.WriteLine("   the chain - the one the trusted proxy wrote. The attacker's invented");
    Console.WriteLine("   entry sits to the left of it and is never read.");
    Console.WriteLine();
    Console.WriteLine("   That is the whole design of X-Forwarded-For, and it is worth stating");
    Console.WriteLine("   once: EACH PROXY APPENDS THE ADDRESS IT SAW. Reading N entries from");
    Console.WriteLine("   the right means trusting exactly your own N proxies. Reading further");
    Console.WriteLine("   left means trusting whatever arrived from outside.");
    Console.WriteLine();

    static void Show(Result r) => Console.WriteLine(
        $"   {r.Label,-37}   {r.DistinctClients,8}   {r.WronglyThrottled,9}   " +
        $"{(r.AdminSpoofed ? "YES" : "no"),7}");

    static ForwardedHeadersOptions NewOptions() => new()
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
    };
}

// ---------------------------------------------------------------------------
static async Task<Result> RunAsync(string label, Action<WebApplication>? configure)
{
    var seen = new ConcurrentDictionary<string, int>();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));

    var app = builder.Build();
    configure?.Invoke(app);

    // A rate limiter keyed on the client address, of the kind every service
    // has. Three per address so the test crosses it quickly.
    app.Use(async (context, next) =>
    {
        string key = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        int count = seen.AddOrUpdate(key, 1, (_, existing) => existing + 1);

        if (count > 3)
        {
            context.Response.StatusCode = 429;
            await context.Response.WriteAsync("rate limited");
            return;
        }

        await next();
    });

    app.MapGet("/payments", () => "ok");

    // An IP allow-list of the kind every service has.
    app.MapGet("/admin", (HttpContext context) =>
    {
        IPAddress? remote = context.Connection.RemoteIpAddress;
        bool allowed = remote is not null
            && remote.ToString().StartsWith("10.0.0.", StringComparison.Ordinal);

        return allowed ? Results.Ok("admin") : Results.StatusCode(403);
    });

    await app.StartAsync();
    var baseAddress = new Uri(app.Urls.First());

    using var http = new HttpClient { BaseAddress = baseAddress };

    // Five different customers, one request each, all through the ingress.
    // The ingress writes the address it saw, so there is one entry.
    int wronglyThrottled = 0;
    for (int i = 1; i <= 5; i++)
    {
        int status = await SendAsync(http, "/payments", $"203.0.113.{i}");
        if (status == 429)
        {
            wronglyThrottled++;
        }
    }

    // One attacker, sending a forged X-Forwarded-For of its own. A proxy
    // APPENDS the address it actually saw rather than replacing the header,
    // so what reaches the application is:
    //
    //     X-Forwarded-For: 10.0.0.5, 203.0.113.99
    //                      ^ forged   ^ written by the ingress
    //
    // The rightmost entry is the only one a trusted proxy vouches for.
    int adminStatus = await SendAsync(http, "/admin", "10.0.0.5, 203.0.113.99");

    await app.StopAsync();

    return new Result(label, seen.Count, wronglyThrottled, adminStatus == 200);

    static async Task<int> SendAsync(HttpClient http, string path, string forwardedFor)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedFor);
        request.Headers.TryAddWithoutValidation("X-Forwarded-Proto", "https");

        using HttpResponseMessage response = await http.SendAsync(request);
        return (int)response.StatusCode;
    }
}

// ---------------------------------------------------------------------------
static void Timeline()
{
    Console.WriteLine("3. What to take from it");
    Console.WriteLine();
    Console.WriteLine("   THE APPLICATION CODE NEVER CHANGED. Every one of those four rows");
    Console.WriteLine("   runs the identical rate limiter and the identical allow-list. The");
    Console.WriteLine("   difference is four lines of configuration about who is allowed to");
    Console.WriteLine("   tell you where a request came from.");
    Console.WriteLine();
    Console.WriteLine("   Three properties made this expensive, and they generalise past this");
    Console.WriteLine("   middleware:");
    Console.WriteLine();
    Console.WriteLine("   IT FAILED SILENTLY IN BOTH DIRECTIONS. A wrong proxy address ignores");
    Console.WriteLine("   headers without a warning; an empty trusted set accepts everything");
    Console.WriteLine("   without a warning. Neither writes a log line at the default level.");
    Console.WriteLine();
    Console.WriteLine("   THE SAFE-LOOKING SPELLING WAS THE DANGEROUS ONE. Clear-with-no-add");
    Console.WriteLine("   reads as restrictive and is the opposite.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX CLOSED THE VISIBLE SYMPTOM AND OPENED AN INVISIBLE ONE. Rate");
    Console.WriteLine("   limiting is observable - customers complain. A spoofable allow-list");
    Console.WriteLine("   is not observable until somebody uses it.");
    Console.WriteLine();
    Console.WriteLine("   The numbers, at Ledger's scale. 400 requests an hour across roughly");
    Console.WriteLine("   80 merchants, with a limit of 100 per minute per address:");
    Console.WriteLine();
    Console.WriteLine("     - Sharing one bucket, the whole platform is capped at 100 requests");
    Console.WriteLine("       per minute rather than 100 per merchant. At peak that is");
    Console.WriteLine("       every merchant seeing intermittent 429s on payment submission.");
    Console.WriteLine();
    Console.WriteLine("     - Each 429 on a payment is a customer at a checkout seeing a");
    Console.WriteLine("       failure, and a merchant deciding whether Ledger is reliable.");
    Console.WriteLine();
    Console.WriteLine("     - The row-3 window - rate limiting fixed, allow-list spoofable -");
    Console.WriteLine("       lasted from the fix to the next security review. Anyone who");
    Console.WriteLine("       could reach the ingress could reach /admin with one header.");
    Console.WriteLine();
    Console.WriteLine("   HOW TO CATCH IT. Two things, neither expensive:");
    Console.WriteLine();
    Console.WriteLine("   1. LOG RemoteIpAddress ON ONE ENDPOINT AND LOOK AT IT after every");
    Console.WriteLine("      infrastructure change. If every request in an hour has the same");
    Console.WriteLine("      client address, you are looking at your proxy.");
    Console.WriteLine();
    Console.WriteLine("   2. TEST THE ALLOW-LIST FROM OUTSIDE, with a forged header. That test");
    Console.WriteLine("      is three lines and it is the only one that distinguishes row 3");
    Console.WriteLine("      from row 4:");
    Console.WriteLine();
    Console.WriteLine("        curl -H 'X-Forwarded-For: 10.0.0.5' https://api.ledger.example/admin");
    Console.WriteLine();
    Console.WriteLine("      A 200 there is the whole incident, visible in one command.");
    Console.WriteLine();
    Console.WriteLine("   And the rule underneath, worth carrying beyond this middleware: A");
    Console.WriteLine("   SECURITY DECISION MADE ON A HEADER IS A DECISION MADE ON WHATEVER A");
    Console.WriteLine("   STRANGER TYPED, unless you have separately established who sent it.");
    Console.WriteLine("   The connection is the only thing you know without being told.");
}

// ---------------------------------------------------------------------------
record Result(string Label, int DistinctClients, int WronglyThrottled, bool AdminSpoofed);
