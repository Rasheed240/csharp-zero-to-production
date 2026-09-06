// 06-reverse-proxy.cs — What your application knows about the client when
// something else terminated the connection, and the configuration that decides
// whether it may believe what it is told.
//
// Run:  dotnet run 06-reverse-proxy.cs -c Release
//
// EXACT vs RATIO: every address, scheme and outcome here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

await WithoutTheMiddleware();
await WithTheMiddleware();
await WhoIsTrusted();
await Spoofing();
Deployment();

// ---------------------------------------------------------------------------
static async Task WithoutTheMiddleware()
{
    Console.WriteLine("1. What your application sees behind a proxy");
    Console.WriteLine();

    (string remote, string scheme, string host, string forwardedFor) =
        await AskAsync(configure: null);

    Console.WriteLine("   A request carrying the headers a proxy would add:");
    Console.WriteLine();
    Console.WriteLine("     X-Forwarded-For:   203.0.113.7");
    Console.WriteLine("     X-Forwarded-Proto: https");
    Console.WriteLine("     X-Forwarded-Host:  api.ledger.example");
    Console.WriteLine();
    Console.WriteLine("   with NO forwarded-headers middleware registered:");
    Console.WriteLine();
    Console.WriteLine($"     Connection.RemoteIpAddress : {remote}");
    Console.WriteLine($"     Request.Scheme             : {scheme}");
    Console.WriteLine($"     Request.Host               : {host}");
    Console.WriteLine($"     the header is still there  : {forwardedFor}");
    Console.WriteLine();
    Console.WriteLine("   The headers arrived and were ignored. Every one of those three");
    Console.WriteLine("   values is a TRUE statement about your connection and the WRONG");
    Console.WriteLine("   answer about the client.");
    Console.WriteLine();
    Console.WriteLine("   What that breaks, in the order people usually discover it:");
    Console.WriteLine();
    Console.WriteLine("     - EVERY REQUEST COMES FROM ONE ADDRESS. Rate limiting by IP");
    Console.WriteLine("       limits the proxy, so one abusive client throttles everybody.");
    Console.WriteLine("       Audit logs record the proxy for every action anyone takes.");
    Console.WriteLine();
    Console.WriteLine("     - REDIRECT-TO-HTTPS LOOPS FOREVER. Your code sees scheme 'http',");
    Console.WriteLine("       redirects to https, the proxy terminates TLS and forwards plain");
    Console.WriteLine("       http again, and you redirect again.");
    Console.WriteLine();
    Console.WriteLine("     - GENERATED URLS ARE WRONG. A Location header or a link built");
    Console.WriteLine("       from the request comes out as http://localhost:5000/... which");
    Console.WriteLine("       is unreachable from outside.");
    Console.WriteLine();
    Console.WriteLine("     - COOKIES MARKED Secure ARE DROPPED, because the framework");
    Console.WriteLine("       believes the connection is not secure.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WithTheMiddleware()
{
    Console.WriteLine("2. Turning the headers on");
    Console.WriteLine();

    (string remote, string scheme, string host, string _ignored) = await AskAsync(app =>
    {
        app.UseForwardedHeaders(new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor
                | ForwardedHeaders.XForwardedProto
                | ForwardedHeaders.XForwardedHost,

            // The client in this file connects from 127.0.0.1, so it has to be
            // trusted for the headers to be honoured at all. Section 3 is
            // about exactly this line.
            KnownProxies = { IPAddress.Loopback }
        });
    });

    Console.WriteLine($"     Connection.RemoteIpAddress : {remote}");
    Console.WriteLine($"     Request.Scheme             : {scheme}");
    Console.WriteLine($"     Request.Host               : {host}");
    Console.WriteLine();
    Console.WriteLine("   The middleware REWRITES the request from the headers. It does not");
    Console.WriteLine("   add a new place to look - RemoteIpAddress and Scheme themselves now");
    Console.WriteLine("   report the client, so code that never heard of a proxy is correct");
    Console.WriteLine("   without changing.");
    Console.WriteLine();
    Console.WriteLine("   Two rules about where it goes:");
    Console.WriteLine();
    Console.WriteLine("     - REGISTER IT FIRST, before anything that reads the scheme or the");
    Console.WriteLine("       address. Authentication, HTTPS redirection, rate limiting and");
    Console.WriteLine("       logging all do. Middleware registered before it sees the");
    Console.WriteLine("       un-rewritten values.");
    Console.WriteLine();
    Console.WriteLine("     - IT CONSUMES THE HEADERS. Each one it applies is removed and the");
    Console.WriteLine("       original value moved to X-Original-For, X-Original-Proto and so");
    Console.WriteLine("       on, so nothing downstream can apply them twice.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhoIsTrusted()
{
    Console.WriteLine("3. The line that decides whether any of it works");
    Console.WriteLine();
    Console.WriteLine("   Four configurations, the same request, from 127.0.0.1:");
    Console.WriteLine();
    var defaults = await AskAsync(app => app.UseForwardedHeaders(Options(o => { })));
    var cleared = await AskAsync(app => app.UseForwardedHeaders(Options(o =>
    {
        o.KnownProxies.Clear();
        o.KnownIPNetworks.Clear();
    })));
    var foreign = await AskAsync(app => app.UseForwardedHeaders(Options(o =>
    {
        o.KnownProxies.Clear();
        o.KnownIPNetworks.Clear();
        o.KnownProxies.Add(IPAddress.Parse("10.9.9.9"));
    })));
    var trusted = await AskAsync(app => app.UseForwardedHeaders(Options(o =>
    {
        o.KnownProxies.Clear();
        o.KnownIPNetworks.Clear();
        o.KnownProxies.Add(IPAddress.Loopback);
    })));

    Console.WriteLine("   trusted set                              RemoteIpAddress   Scheme   headers");
    Console.WriteLine("   -----------                              ---------------   ------   -------");
    Console.WriteLine($"   defaults (loopback only)                 {defaults.Remote,-15}   {defaults.Scheme,-6}   {Applied(defaults)}");
    Console.WriteLine($"   BOTH SETS CLEARED                        {cleared.Remote,-15}   {cleared.Scheme,-6}   {Applied(cleared)}");
    Console.WriteLine($"   one foreign proxy, 10.9.9.9              {foreign.Remote,-15}   {foreign.Scheme,-6}   {Applied(foreign)}");
    Console.WriteLine($"   loopback trusted explicitly              {trusted.Remote,-15}   {trusted.Scheme,-6}   {Applied(trusted)}");
    Console.WriteLine();
    Console.WriteLine("   READ THE SECOND ROW TWICE. Clearing both trusted sets - which reads");
    Console.WriteLine("   like TRUST NOBODY - made the middleware trust EVERYBODY.");
    Console.WriteLine();
    Console.WriteLine("   The middleware checks the sender against the trusted sets only when");
    Console.WriteLine("   there is something in them. Empty means unrestricted, not empty.");
    Console.WriteLine();
    Console.WriteLine("   That is the single most dangerous line in this module, because it is");
    Console.WriteLine("   what a careful person writes while trying to be careful:");
    Console.WriteLine();
    Console.WriteLine("     options.KnownProxies.Clear();      // start from nothing");
    Console.WriteLine("     options.KnownIPNetworks.Clear();   // and now trust nobody");
    Console.WriteLine();
    Console.WriteLine("   Those two lines, alone, mean any client on earth can set its own IP");
    Console.WriteLine("   address and scheme. If you clear, you must ADD.");
    Console.WriteLine();
    Console.WriteLine("   The third row is what a rejection actually looks like: the headers");
    Console.WriteLine("   were ignored and the connection's own values kept, because the");
    Console.WriteLine("   request did not come from 10.9.9.9.");
    Console.WriteLine();
    Console.WriteLine("   And notice what row three does NOT produce: no error, no warning, no");
    Console.WriteLine("   log line at the default level. This middleware fails silently in both");
    Console.WriteLine("   directions - it ignores headers without telling you, and it trusts");
    Console.WriteLine("   everyone without telling you.");
    Console.WriteLine();
    Console.WriteLine("   The defaults trust LOOPBACK ONLY - 127.0.0.1 and ::1. That is correct");
    Console.WriteLine("   for a proxy running beside you on the same host, and wrong for almost");
    Console.WriteLine("   every container deployment, where the ingress is another pod with a");
    Console.WriteLine("   different address. A service that works on a developer's machine and");
    Console.WriteLine("   silently stops working in the cluster is the expected outcome of");
    Console.WriteLine("   leaving this alone.");
    Console.WriteLine();
    Console.WriteLine("   Set it explicitly, to the narrowest thing that is true:");
    Console.WriteLine();
    Console.WriteLine("     options.KnownProxies.Clear();");
    Console.WriteLine("     options.KnownIPNetworks.Clear();");
    Console.WriteLine("     options.KnownIPNetworks.Add(");
    Console.WriteLine("         new IPNetwork(IPAddress.Parse(\"10.0.0.0\"), 8));");
    Console.WriteLine();
    Console.WriteLine("   Clear THEN add, and never one without the other.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static ForwardedHeadersOptions Options(Action<ForwardedHeadersOptions> tweak)
{
    var options = new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
    };

    tweak(options);
    return options;
}

static string Applied((string Remote, string Scheme, string Host, string ForwardedFor) r) =>
    r.Remote == "203.0.113.7" ? "APPLIED" : "ignored";

// ---------------------------------------------------------------------------
static async Task Spoofing()
{
    Console.WriteLine("4. Why the trusted set exists");
    Console.WriteLine();

    // Trusting everything, which is what people reach for when the middleware
    // appears to do nothing.
    var result = await AskAsync(app =>
    {
        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            ForwardLimit = null
        };
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        options.KnownIPNetworks.Add(new System.Net.IPNetwork(IPAddress.Any, 0));   // everyone
        app.UseForwardedHeaders(options);
    }, forwardedFor: "203.0.113.7, 198.51.100.99, 10.0.0.1");

    string remote = result.Remote;
    string scheme = result.Scheme;

    Console.WriteLine("   With every address trusted and ForwardLimit removed, a client");
    Console.WriteLine("   sending its own X-Forwarded-For chain:");
    Console.WriteLine();
    Console.WriteLine("     X-Forwarded-For: 203.0.113.7, 198.51.100.99, 10.0.0.1");
    Console.WriteLine();
    Console.WriteLine($"     RemoteIpAddress : {remote}");
    Console.WriteLine($"     Scheme          : {scheme}");
    Console.WriteLine();
    Console.WriteLine("   THE CLIENT CHOSE ITS OWN IP ADDRESS. Nothing verified it, because");
    Console.WriteLine("   nothing can: X-Forwarded-For is a header, and a header is whatever");
    Console.WriteLine("   the sender typed.");
    Console.WriteLine();
    Console.WriteLine("   The only thing that makes it trustworthy is knowing that a proxy you");
    Console.WriteLine("   control wrote it, and the only way to know that is to check who the");
    Console.WriteLine("   connection came from. That is the entire purpose of KnownProxies.");
    Console.WriteLine();
    Console.WriteLine("   What an attacker gets from a service that trusts it blindly:");
    Console.WriteLine();
    Console.WriteLine("     - RATE LIMITS BYPASSED. A new spoofed address per request means");
    Console.WriteLine("       every request is a first request.");
    Console.WriteLine();
    Console.WriteLine("     - IP ALLOW-LISTS DEFEATED. 'Admin endpoints are restricted to the");
    Console.WriteLine("       office network' becomes a header anyone can send.");
    Console.WriteLine();
    Console.WriteLine("     - AUDIT LOGS POISONED, with actions attributed to whichever");
    Console.WriteLine("       address the attacker chose.");
    Console.WriteLine();
    Console.WriteLine("     - SECURITY DECISIONS MADE ON A LIE, wherever scheme or address");
    Console.WriteLine("       feeds authorisation.");
    Console.WriteLine();
    Console.WriteLine("   ForwardLimit is the other half of the defence. It defaults to 1:");
    Console.WriteLine("   take ONE entry from the right-hand end of the chain, because that");
    Console.WriteLine("   is the one your immediate proxy added and everything to the left of");
    Console.WriteLine("   it was written by somebody further away. Raise it to exactly the");
    Console.WriteLine("   number of proxies you actually run, and no higher.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Deployment()
{
    Console.WriteLine("5. The checklist for running behind a proxy");
    Console.WriteLine();
    Console.WriteLine("   1. REGISTER UseForwardedHeaders FIRST, before authentication,");
    Console.WriteLine("      HTTPS redirection, rate limiting and logging.");
    Console.WriteLine();
    Console.WriteLine("   2. CLEAR THE DEFAULTS AND THEN ADD the narrowest range that is");
    Console.WriteLine("      true. Clearing without adding means trusting EVERY sender, which");
    Console.WriteLine("      is measured in section 3 and is the opposite of what it reads");
    Console.WriteLine("      like. Loopback-only defaults are wrong in a cluster.");
    Console.WriteLine();
    Console.WriteLine("   3. SET ForwardLimit to the number of proxies you run.");
    Console.WriteLine();
    Console.WriteLine("   4. MAKE SURE THE PROXY ACTUALLY SENDS THEM. nginx needs");
    Console.WriteLine("      proxy_set_header X-Forwarded-Proto $scheme; it does not add it by");
    Console.WriteLine("      itself. Half of the 'the middleware does not work' cases are a");
    Console.WriteLine("      header that was never sent.");
    Console.WriteLine();
    Console.WriteLine("   5. VERIFY IT AFTER DEPLOYING. Log RemoteIpAddress and Scheme on one");
    Console.WriteLine("      endpoint and look at a real request through the real proxy. This");
    Console.WriteLine("      fails silently, so it will not tell you.");
    Console.WriteLine();
    Console.WriteLine("   A note on the standard header. RFC 7239 defines a single Forwarded");
    Console.WriteLine("   header carrying for, proto, host and by. It is the specified way to");
    Console.WriteLine("   do this and it lost: X-Forwarded-* predates it, everything emits");
    Console.WriteLine("   those, and ASP.NET Core's middleware handles the X- forms. Use them,");
    Console.WriteLine("   and know that the tidier header exists if a proxy sends it.");
    Console.WriteLine();
    Console.WriteLine("   And the deeper point, which outlives this middleware: THE CONNECTION");
    Console.WriteLine("   IS THE ONLY THING YOU KNOW. Everything else is something a stranger");
    Console.WriteLine("   typed. Forwarded headers work by converting a fact about the");
    Console.WriteLine("   connection - who it came from - into permission to believe a claim.");
    Console.WriteLine("   Every header-based trust decision has that shape, and every one of");
    Console.WriteLine("   them fails the same way when the fact is not checked.");
}

// ---------------------------------------------------------------------------
// One request through a fresh app, with proxy headers attached.
static async Task<(string Remote, string Scheme, string Host, string ForwardedFor)> AskAsync(
    Action<WebApplication>? configure,
    string forwardedFor = "203.0.113.7")
{
    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));

    var app = builder.Build();
    configure?.Invoke(app);

    app.MapGet("/", (HttpContext context) => string.Join('|',
        context.Connection.RemoteIpAddress?.ToString() ?? "(none)",
        context.Request.Scheme,
        context.Request.Host.ToString(),
        context.Request.Headers["X-Forwarded-For"].ToString() is { Length: > 0 } value
            ? value
            : "(consumed by the middleware)"));

    await app.StartAsync();

    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    using var request = new HttpRequestMessage(HttpMethod.Get, "/");
    request.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedFor);
    request.Headers.TryAddWithoutValidation("X-Forwarded-Proto", "https");
    request.Headers.TryAddWithoutValidation("X-Forwarded-Host", "api.ledger.example");

    using HttpResponseMessage response = await http.SendAsync(request);
    string[] parts = (await response.Content.ReadAsStringAsync()).Split('|');

    await app.StopAsync();

    return (parts[0], parts[1], parts[2], parts[3]);
}
