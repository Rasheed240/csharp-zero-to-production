// 09-minimal-example.cs — One Kestrel configured the way a service behind an
// ingress should be, with every decision exercised.
//
// Run:  dotnet run 09-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and outcome here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Net;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Server.Kestrel.Core;

var builder = WebApplication.CreateBuilder();
builder.Logging.ClearProviders();

builder.WebHost.ConfigureKestrel(options =>
{
    // --- limits on what one client may ask of the parser -------------------
    //
    // Lower than the 30,000,000-byte default. The global limit is the size of
    // an ordinary request; the one endpoint that needs more raises it for
    // itself, so an unauthenticated caller cannot make the server read 30 MB.
    options.Limits.MaxRequestBodySize = 64 * 1024;

    // The defaults - 32 KB, 100 headers, an 8 KB request line - are sensible.
    // They are set explicitly here because a limit nobody chose is a limit
    // nobody will think about when a request starts failing.
    options.Limits.MaxRequestHeadersTotalSize = 32 * 1024;
    options.Limits.MaxRequestHeaderCount = 100;
    options.Limits.MaxRequestLineSize = 8 * 1024;

    // --- limits on how long a client may take ------------------------------
    //
    // All four are on by default and all four are the slowloris defence.
    // They are restated rather than changed: the failure mode here is
    // switching one off for a slow client and never putting it back.
    options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(30);
    options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(130);
    options.Limits.MinRequestBodyDataRate =
        new MinDataRate(bytesPerSecond: 240, gracePeriod: TimeSpan.FromSeconds(5));
    options.Limits.MinResponseDataRate =
        new MinDataRate(bytesPerSecond: 240, gracePeriod: TimeSpan.FromSeconds(5));

    // Not set: MaxConcurrentConnections. There is an ingress in front that
    // bounds connections already, and a wrong value here drops clients with
    // no status code and nothing in the access log. Set it only when you are
    // the front door.

    // --- what to listen on -------------------------------------------------
    //
    // Plain HTTP: the ingress terminates TLS and reaches us over the cluster
    // network. Listen rather than ListenLocalhost, which refuses port 0 and
    // would bind only loopback.
    options.Listen(IPAddress.Loopback, 0, listen =>
    {
        listen.Protocols = HttpProtocols.Http1AndHttp2;
    });
});

var app = builder.Build();

// FIRST in the pipeline, before anything reads the address or the scheme -
// authentication, rate limiting, redirection and logging all do.
var forwarded = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,

    // One proxy, so one entry from the RIGHT of the chain: the entry our own
    // ingress appended. Anything to the left of it came from outside and is
    // whatever the sender typed.
    ForwardLimit = 1
};

// Clear THEN add. Clearing alone leaves both sets empty, and an empty trusted
// set means trust EVERY sender - the opposite of how it reads.
forwarded.KnownProxies.Clear();
forwarded.KnownIPNetworks.Clear();
forwarded.KnownProxies.Add(IPAddress.Loopback);      // the ingress, in this test

app.UseForwardedHeaders(forwarded);

// --- endpoints --------------------------------------------------------------
app.MapGet("/whoami", (HttpContext context) => Results.Ok(new
{
    client = context.Connection.RemoteIpAddress?.ToString(),
    scheme = context.Request.Scheme,
    protocol = context.Request.Protocol
}));

app.MapGet("/admin", (HttpContext context) =>
    context.Connection.RemoteIpAddress?.ToString()
        .StartsWith("10.0.0.", StringComparison.Ordinal) == true
        ? Results.Ok(new { area = "admin" })
        : Results.StatusCode(403));

app.MapPost("/payments", async (HttpRequest request) =>
{
    using var reader = new StreamReader(request.Body);
    return Results.Ok(new { received = (await reader.ReadToEndAsync()).Length });
});

// The one endpoint that genuinely needs a large body, raised for itself only.
app.MapPost("/documents", async (HttpRequest request) =>
{
    using var reader = new StreamReader(request.Body);
    return Results.Ok(new { received = (await reader.ReadToEndAsync()).Length });
}).WithMetadata(new SizeLimit(8 * 1024 * 1024));

await app.StartAsync();
var uri = new Uri(app.Urls.First());
using var http = new HttpClient { BaseAddress = uri };

Console.WriteLine("A Kestrel configured for life behind an ingress");
Console.WriteLine();
Console.WriteLine("   what was sent                                status   what it shows");
Console.WriteLine("   -------------                                ------   -------------");

// The client address and scheme come from the proxy's headers.
(int whoamiStatus, string whoamiBody) = await GetAsync(http, "/whoami", "203.0.113.7");
Console.WriteLine($"   GET /whoami through the ingress                {whoamiStatus,3}   the CLIENT address, not the proxy");

// A forged left-hand entry is never read, because ForwardLimit is 1.
int spoofed = await StatusAsync(http, "/admin", "10.0.0.5, 203.0.113.99");
Console.WriteLine($"   GET /admin with a forged X-Forwarded-For        {spoofed,3}   forgery ignored");

// The genuine office address, as the ingress would report it.
int allowed = await StatusAsync(http, "/admin", "10.0.0.5");
Console.WriteLine($"   GET /admin from the real office address        {allowed,3}   allow-list works");

// Body limits: the ordinary endpoint, then the one that raised its own.
int small = await PostAsync(http, "/payments", 1_000);
int tooBig = await PostAsync(http, "/payments", 200_000);
int document = await PostAsync(http, "/documents", 200_000);

Console.WriteLine($"   POST /payments, 1 KB                           {small,3}   under the 64 KB limit");
Console.WriteLine($"   POST /payments, 200 KB                         {tooBig,3}   413, the global limit holds");
Console.WriteLine($"   POST /documents, 200 KB                        {document,3}   raised for this endpoint only");

Console.WriteLine();
Console.WriteLine($"   /whoami returned: {whoamiBody}");
Console.WriteLine();
Console.WriteLine("   Every one of those outcomes is a configuration decision, and none of");
Console.WriteLine("   them is in the endpoint code. The handlers do not know there is a");
Console.WriteLine("   proxy, a body limit or a timeout.");
Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - UseForwardedHeaders registered FIRST, before anything reads the");
Console.WriteLine("       address or the scheme");
Console.WriteLine("     - trusted sets CLEARED AND THEN ADDED TO - clearing alone trusts");
Console.WriteLine("       everyone");
Console.WriteLine("     - ForwardLimit set to the number of proxies actually in front");
Console.WriteLine("     - a global body limit sized for ordinary requests, raised per");
Console.WriteLine("       endpoint where a real upload needs it");
Console.WriteLine("     - header and request-line limits stated explicitly, so they are");
Console.WriteLine("       chosen rather than inherited");
Console.WriteLine("     - the four slowloris defences left ON");
Console.WriteLine("     - MaxConcurrentConnections deliberately NOT set, because something");
Console.WriteLine("       in front already bounds connections");
Console.WriteLine("     - TLS left to the ingress, so certificate renewal is not this");
Console.WriteLine("       process's problem");
Console.WriteLine();
Console.WriteLine("   The two lines to check after any infrastructure change, because both");
Console.WriteLine("   failure modes of the forwarded-headers middleware are silent:");
Console.WriteLine();
Console.WriteLine("     curl https://api.ledger.example/whoami");
Console.WriteLine("       -> must report YOUR address, not the ingress");
Console.WriteLine();
Console.WriteLine("     curl -H 'X-Forwarded-For: 10.0.0.5' https://api.ledger.example/admin");
Console.WriteLine("       -> must NOT be 200");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task<(int Status, string Body)> GetAsync(HttpClient http, string path,
    string forwardedFor)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    request.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedFor);
    request.Headers.TryAddWithoutValidation("X-Forwarded-Proto", "https");

    using HttpResponseMessage response = await http.SendAsync(request);
    return ((int)response.StatusCode, await response.Content.ReadAsStringAsync());
}

static async Task<int> StatusAsync(HttpClient http, string path, string forwardedFor)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    request.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedFor);

    using HttpResponseMessage response = await http.SendAsync(request);
    return (int)response.StatusCode;
}

static async Task<int> PostAsync(HttpClient http, string path, int bytes)
{
    using var content = new StringContent(new string('x', bytes));

    try
    {
        using HttpResponseMessage response = await http.PostAsync(path, content);
        return (int)response.StatusCode;
    }
    catch (HttpRequestException)
    {
        return -1;
    }
}

// ---------------------------------------------------------------------------
sealed class SizeLimit : IRequestSizeLimitMetadata
{
    public SizeLimit(long maxRequestBodySize) => MaxRequestBodySize = maxRequestBodySize;

    public long? MaxRequestBodySize { get; }
}
