// 05-connections.cs — Keep-alive, and what HTTP/2 changes about the connection
// underneath your requests.
//
// Run:  dotnet run 05-connections.cs -c Release
//
// EXACT vs RATIO: connection COUNTS are exact and deterministic - the server
// counts real accepted sockets. Times are ratios and vary between runs.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true

using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.Server.Kestrel.Core;

var builder = WebApplication.CreateBuilder();
builder.Logging.ClearProviders();

builder.WebHost.ConfigureKestrel(options =>
{
    // Two endpoints: one HTTP/1.1, one HTTP/2 without TLS (prior knowledge).
    //
    // Listen(IPAddress.Loopback, 0) rather than ListenLocalhost(0): the
    // localhost helper binds both IPv4 and IPv6 and refuses a dynamic port,
    // because it cannot guarantee the OS picks the same one for both.
    options.Listen(IPAddress.Loopback, 0, listen => listen.Protocols = HttpProtocols.Http1);
    options.Listen(IPAddress.Loopback, 0, listen => listen.Protocols = HttpProtocols.Http2);
});

var app = builder.Build();

// Kestrel gives every accepted connection an id. Echoing it lets the client
// count how many distinct sockets served its requests, which is the only
// honest way to demonstrate keep-alive.
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Connection-Id"] = context.Connection.Id;
    await next();
});

app.MapGet("/quick", () => "ok");

app.MapGet("/slow", async () =>
{
    await Task.Delay(100);
    return "done";
});

await app.StartAsync();

var addresses = app.Urls.ToArray();
string http1 = addresses[0];
string http2 = addresses[1];

Console.WriteLine($"HTTP/1.1 endpoint : {http1}");
Console.WriteLine($"HTTP/2   endpoint : {http2}");
Console.WriteLine();

await KeepAlive(http1);
await ConnectionsPerHost(http1);
await Multiplexing(http1, http2);
Versions();

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task KeepAlive(string baseUrl)
{
    Console.WriteLine("1. Keep-alive: one connection, many requests");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    var connectionIds = new List<string>();
    for (int i = 0; i < 6; i++)
    {
        HttpResponseMessage response = await http.GetAsync("/quick");
        connectionIds.Add(response.Headers.GetValues("X-Connection-Id").First());
    }

    Console.WriteLine($"   6 sequential requests");
    Console.WriteLine($"   distinct server-side connections used: {connectionIds.Distinct().Count()}");
    Console.WriteLine();
    Console.WriteLine("   One connection served all six. That is keep-alive, and in HTTP/1.1");
    Console.WriteLine("   it is the DEFAULT - the connection stays open unless somebody says");
    Console.WriteLine("   'Connection: close'.");
    Console.WriteLine();
    Console.WriteLine("   It matters because opening a connection is not free:");
    Console.WriteLine();
    Console.WriteLine("     TCP handshake   one round trip");
    Console.WriteLine("     TLS handshake   one or two more, plus certificate work");
    Console.WriteLine();
    Console.WriteLine("   On a link with 50 ms of latency that is 100-150 ms before a single");
    Console.WriteLine("   byte of your request is sent. Reusing the connection pays it once");
    Console.WriteLine("   instead of once per request.");
    Console.WriteLine();

    // Now force the opposite, so the difference is visible rather than asserted.
    var closedIds = new List<string>();
    for (int i = 0; i < 6; i++)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/quick");
        request.Headers.ConnectionClose = true;

        HttpResponseMessage response = await http.SendAsync(request);
        closedIds.Add(response.Headers.GetValues("X-Connection-Id").First());
    }

    Console.WriteLine($"   the same 6 requests with Connection: close");
    Console.WriteLine($"   distinct server-side connections used: {closedIds.Distinct().Count()}");
    Console.WriteLine();
    Console.WriteLine("   Six requests, six connections. This is what a client that creates a");
    Console.WriteLine("   new HttpClient per request does, and it is the cause of the socket");
    Console.WriteLine("   exhaustion that HttpClient's documentation warns about.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ConnectionsPerHost(string baseUrl)
{
    Console.WriteLine("2. How many connections a client will open");
    Console.WriteLine();

    var handler = new SocketsHttpHandler { MaxConnectionsPerServer = 2 };
    using var http = new HttpClient(handler) { BaseAddress = new Uri(baseUrl) };

    var sw = Stopwatch.StartNew();
    HttpResponseMessage[] responses = await Task.WhenAll(
        Enumerable.Range(0, 6).Select(_ => http.GetAsync("/slow")));
    sw.Stop();

    int distinct = responses
        .Select(r => r.Headers.GetValues("X-Connection-Id").First())
        .Distinct()
        .Count();

    Console.WriteLine($"   6 concurrent requests to a 100 ms endpoint");
    Console.WriteLine($"   MaxConnectionsPerServer : 2");
    Console.WriteLine($"   connections used        : {distinct}");
    Console.WriteLine($"   elapsed                 : {sw.ElapsedMilliseconds} ms");
    Console.WriteLine();
    Console.WriteLine("   Six requests over two connections, at 100 ms each, is three rounds.");
    Console.WriteLine("   The elapsed time reflects that: HTTP/1.1 sends one request at a");
    Console.WriteLine("   time per connection, so concurrency is capped by the pool.");
    Console.WriteLine();
    Console.WriteLine("   That limit is per (scheme, host, port). The .NET default is");
    Console.WriteLine("   effectively unlimited for HTTP/1.1 on modern SocketsHttpHandler,");
    Console.WriteLine("   which is generous - browsers historically used 6.");
    Console.WriteLine();
    Console.WriteLine("   Worth raising deliberately when calling one busy downstream, and");
    Console.WriteLine("   worth LOWERING when you are the one being called and want to bound");
    Console.WriteLine("   what a single client can occupy.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Multiplexing(string http1Url, string http2Url)
{
    Console.WriteLine("3. HTTP/2: many requests on ONE connection at once");
    Console.WriteLine();

    // HTTP/1.1, capped at two connections.
    var handler1 = new SocketsHttpHandler { MaxConnectionsPerServer = 2 };
    using var client1 = new HttpClient(handler1)
    {
        BaseAddress = new Uri(http1Url),
        DefaultRequestVersion = HttpVersion.Version11,
        DefaultVersionPolicy = HttpVersionPolicy.RequestVersionExact
    };

    // HTTP/2 over cleartext, which needs prior knowledge because there is no
    // TLS negotiation to announce the protocol.
    var handler2 = new SocketsHttpHandler { MaxConnectionsPerServer = 2 };
    using var client2 = new HttpClient(handler2)
    {
        BaseAddress = new Uri(http2Url),
        DefaultRequestVersion = HttpVersion.Version20,
        DefaultVersionPolicy = HttpVersionPolicy.RequestVersionExact
    };

    (int conn1, long ms1, string version1) = await MeasureAsync(client1);
    (int conn2, long ms2, string version2) = await MeasureAsync(client2);

    Console.WriteLine("   6 concurrent requests to a 100 ms endpoint, 2 connections allowed");
    Console.WriteLine();
    Console.WriteLine("   protocol   negotiated   connections   elapsed");
    Console.WriteLine("   --------   ----------   -----------   -------");
    Console.WriteLine($"   HTTP/1.1   {version1,10}   {conn1,11}   {ms1,5} ms");
    Console.WriteLine($"   HTTP/2     {version2,10}   {conn2,11}   {ms2,5} ms");
    Console.WriteLine();
    Console.WriteLine("   HTTP/1.1 needed three rounds over two connections. HTTP/2 sent all");
    Console.WriteLine("   six at once over ONE connection, so the whole set took about as");
    Console.WriteLine("   long as a single request.");
    Console.WriteLine();
    Console.WriteLine("   That is MULTIPLEXING: HTTP/2 splits the connection into independent");
    Console.WriteLine("   streams, each carrying one request and response, interleaved.");
    Console.WriteLine();
    Console.WriteLine("   The problem it solves is HEAD-OF-LINE BLOCKING at the HTTP layer.");
    Console.WriteLine("   In HTTP/1.1 a connection carries one request at a time, so a slow");
    Console.WriteLine("   response blocks every request queued behind it on that connection.");
    Console.WriteLine();
    Console.WriteLine("   What HTTP/2 does NOT solve is head-of-line blocking at the TCP");
    Console.WriteLine("   layer: all those streams share one TCP connection, so one lost");
    Console.WriteLine("   packet stalls every stream until it is retransmitted. That is what");
    Console.WriteLine("   HTTP/3 fixes, by running over QUIC on UDP with per-stream delivery.");
    Console.WriteLine();

    static async Task<(int, long, string)> MeasureAsync(HttpClient http)
    {
        // Warm the connection so the handshake is not inside the measurement.
        await http.GetAsync("/quick");

        var sw = Stopwatch.StartNew();
        HttpResponseMessage[] responses = await Task.WhenAll(
            Enumerable.Range(0, 6).Select(_ => http.GetAsync("/slow")));
        sw.Stop();

        int distinct = responses
            .Select(r => r.Headers.GetValues("X-Connection-Id").First())
            .Distinct()
            .Count();

        return (distinct, sw.ElapsedMilliseconds, responses[0].Version.ToString());
    }
}

// ---------------------------------------------------------------------------
static void Versions()
{
    Console.WriteLine("4. What each version actually changed");
    Console.WriteLine();
    Console.WriteLine("   HTTP/1.1   text on the wire. One request at a time per connection,");
    Console.WriteLine("              keep-alive by default, Host required. Still the default");
    Console.WriteLine("              for most server-to-server traffic.");
    Console.WriteLine();
    Console.WriteLine("   HTTP/2     binary framing, multiplexed streams on one connection,");
    Console.WriteLine("              header compression (HPACK), server push (now largely");
    Console.WriteLine("              abandoned). Same semantics - methods, status codes and");
    Console.WriteLine("              headers all mean exactly what they did.");
    Console.WriteLine();
    Console.WriteLine("   HTTP/3     the same semantics again, over QUIC on UDP. Removes TCP");
    Console.WriteLine("              head-of-line blocking, and merges the transport and TLS");
    Console.WriteLine("              handshakes so a connection starts in one round trip.");
    Console.WriteLine();
    Console.WriteLine("   THE SEMANTICS DID NOT CHANGE. A GET is still safe and idempotent, a");
    Console.WriteLine("   404 still means the same thing, and ETag works identically. Every");
    Console.WriteLine("   version since 1.1 has changed how bytes are FRAMED and delivered,");
    Console.WriteLine("   not what they mean.");
    Console.WriteLine();
    Console.WriteLine("   That is why this module spends most of its length on methods,");
    Console.WriteLine("   status codes and headers: those transfer to every version, and the");
    Console.WriteLine("   framing is mostly the server's problem rather than yours.");
    Console.WriteLine();
    Console.WriteLine("   Two practical notes:");
    Console.WriteLine();
    Console.WriteLine("     - HTTP/2 in the wild is almost always over TLS, and the version is");
    Console.WriteLine("       chosen during the TLS handshake by ALPN. The cleartext HTTP/2");
    Console.WriteLine("       used above needs 'prior knowledge' - both ends agreeing in");
    Console.WriteLine("       advance - which is common between services and rare on the open");
    Console.WriteLine("       internet.");
    Console.WriteLine();
    Console.WriteLine("     - gRPC requires HTTP/2, which is why a gRPC endpoint behind a");
    Console.WriteLine("       proxy that downgrades to HTTP/1.1 fails in a confusing way.");
}
