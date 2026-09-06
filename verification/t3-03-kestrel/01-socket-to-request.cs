// 01-socket-to-request.cs — The path from an accepted socket to an HttpContext,
// observed at every step rather than described.
//
// Run:  dotnet run 01-socket-to-request.cs -c Release
//
// EXACT vs RATIO: connection and request COUNTS are exact - Kestrel gives every
// accepted connection an id and this file counts real sockets. No timings are
// claimed.

#:sdk Microsoft.NET.Sdk.Web

using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Connections;
using Microsoft.AspNetCore.Http.Features;

var connectionsAccepted = 0;
var requestsServed = 0;

var builder = WebApplication.CreateBuilder();
builder.Logging.ClearProviders();

builder.WebHost.ConfigureKestrel(options =>
{
    options.Listen(IPAddress.Loopback, 0, listen =>
    {
        // CONNECTION middleware, not request middleware. This runs once per
        // accepted socket, before a single byte has been parsed - there is no
        // HttpContext here because there is no request yet.
        listen.Use(async (ConnectionContext connection, Func<Task> next) =>
        {
            Interlocked.Increment(ref connectionsAccepted);
            await next();
        });
    });
});

var app = builder.Build();

// REQUEST middleware. This runs once per request, and several requests may
// share one connection.
app.Use(async (context, next) =>
{
    Interlocked.Increment(ref requestsServed);
    context.Response.Headers["X-Connection-Id"] = context.Connection.Id;
    await next();
});

app.MapGet("/", (HttpContext context) =>
{
    var connection = context.Connection;
    return string.Join("\n",
        $"connection id   : {connection.Id}",
        $"remote endpoint : {connection.RemoteIpAddress}:{connection.RemotePort}",
        $"local endpoint  : {connection.LocalIpAddress}:{connection.LocalPort}",
        $"protocol        : {context.Request.Protocol}",
        $"scheme          : {context.Request.Scheme}");
});

app.MapGet("/features", (HttpContext context) =>
{
    var lines = new List<string>();
    foreach (var feature in context.Features)
    {
        lines.Add(feature.Key.Name);
    }

    lines.Sort();
    return string.Join("\n", lines);
});

await app.StartAsync();
string baseUrl = app.Urls.First();
var uri = new Uri(baseUrl);

await ThePath(baseUrl);
await ConnectionsVersusRequests(baseUrl, () => connectionsAccepted, () => requestsServed);
await WhatKestrelParses(uri);
await Features(baseUrl);

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task ThePath(string baseUrl)
{
    Console.WriteLine("1. What a request passes through");
    Console.WriteLine();
    Console.WriteLine("   Kestrel is the WEB SERVER inside your process. It owns the socket,");
    Console.WriteLine("   turns bytes into an HttpContext, and hands that to your pipeline.");
    Console.WriteLine();
    Console.WriteLine("     the operating system");
    Console.WriteLine("       accepts a TCP connection on a listening socket");
    Console.WriteLine("           |");
    Console.WriteLine("     KESTREL");
    Console.WriteLine("       connection middleware   once per SOCKET");
    Console.WriteLine("       TLS handshake           if HTTPS - picks the HTTP version too");
    Console.WriteLine("       protocol parsing        HTTP/1.1 text, or HTTP/2 binary frames");
    Console.WriteLine("       request line + headers  into an HttpRequest");
    Console.WriteLine("           |");
    Console.WriteLine("     YOUR PIPELINE");
    Console.WriteLine("       request middleware      once per REQUEST");
    Console.WriteLine("       routing, then endpoint");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };
    string body = await http.GetStringAsync("/");

    Console.WriteLine("   What the endpoint can see about its connection:");
    Console.WriteLine();
    foreach (string line in body.Split('\n'))
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   None of that came from the request text. The endpoints, the");
    Console.WriteLine("   protocol and the scheme are properties of the CONNECTION, which");
    Console.WriteLine("   Kestrel knew before it read anything.");
    Console.WriteLine();
    Console.WriteLine("   That distinction is the whole module. Everything Kestrel limits -");
    Console.WriteLine("   connections, header sizes, body sizes, timeouts - it limits before");
    Console.WriteLine("   your code runs, because by the time your code runs the resource has");
    Console.WriteLine("   already been spent.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ConnectionsVersusRequests(string baseUrl, Func<int> connections,
    Func<int> requests)
{
    Console.WriteLine("2. Connections and requests are not the same count");
    Console.WriteLine();

    int connectionsBefore = connections();
    int requestsBefore = requests();

    // One client, keep-alive on: six requests over one connection.
    using (var http = new HttpClient { BaseAddress = new Uri(baseUrl) })
    {
        for (int i = 0; i < 6; i++)
        {
            await http.GetStringAsync("/");
        }
    }

    int keepAliveConnections = connections() - connectionsBefore;
    int keepAliveRequests = requests() - requestsBefore;

    connectionsBefore = connections();
    requestsBefore = requests();

    // The same six with Connection: close.
    using (var http = new HttpClient { BaseAddress = new Uri(baseUrl) })
    {
        for (int i = 0; i < 6; i++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/");
            request.Headers.ConnectionClose = true;
            using HttpResponseMessage response = await http.SendAsync(request);
            await response.Content.ReadAsStringAsync();
        }
    }

    int closedConnections = connections() - connectionsBefore;
    int closedRequests = requests() - requestsBefore;

    Console.WriteLine("   6 requests, sent two ways:");
    Console.WriteLine();
    Console.WriteLine("   mode                sockets accepted   requests served");
    Console.WriteLine("   ----                ----------------   ---------------");
    Console.WriteLine($"   keep-alive          {keepAliveConnections,16}   {keepAliveRequests,15}");
    Console.WriteLine($"   Connection: close   {closedConnections,16}   {closedRequests,15}");
    Console.WriteLine();
    Console.WriteLine("   Kestrel's connection limits count the LEFT column. Your request");
    Console.WriteLine("   metrics count the right one. A service doing 10,000 requests per");
    Console.WriteLine("   second over reused connections may hold only a few hundred sockets,");
    Console.WriteLine("   and the same load from clients that reconnect every time holds");
    Console.WriteLine("   10,000.");
    Console.WriteLine();
    Console.WriteLine("   That is why 'we handle 10k rps' says nothing about whether you will");
    Console.WriteLine("   hit a connection limit. The two numbers are related only by client");
    Console.WriteLine("   behaviour, which you do not control.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatKestrelParses(Uri uri)
{
    Console.WriteLine("3. The bytes Kestrel turns into an HttpRequest");
    Console.WriteLine();

    // A raw socket, so the request is exactly these bytes and nothing else.
    using var client = new TcpClient();
    await client.ConnectAsync(uri.Host, uri.Port);
    await using NetworkStream stream = client.GetStream();

    string request =
        "GET / HTTP/1.1\r\n" +
        $"Host: {uri.Host}:{uri.Port}\r\n" +
        "Connection: close\r\n" +
        "\r\n";

    await stream.WriteAsync(Encoding.ASCII.GetBytes(request));

    using var reader = new StreamReader(stream, Encoding.ASCII);
    string response = await reader.ReadToEndAsync();

    Console.WriteLine("   sent, byte for byte:");
    Console.WriteLine();
    foreach (string line in request.Replace("\r\n", "\\r\\n\n").Split('\n'))
    {
        if (line.Length > 0)
        {
            Console.WriteLine($"     {line}");
        }
    }

    Console.WriteLine();
    Console.WriteLine("   the status line and headers that came back:");
    Console.WriteLine();

    foreach (string line in response.Split("\r\n"))
    {
        if (line.Length == 0)
        {
            break;
        }

        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   Kestrel read that text and produced a request line, a header");
    Console.WriteLine("   collection and a body stream. Every limit in this module is a");
    Console.WriteLine("   bound on that parsing:");
    Console.WriteLine();
    Console.WriteLine("     MaxRequestLineSize          how long 'GET / HTTP/1.1' may be");
    Console.WriteLine("     MaxRequestHeadersTotalSize  how much header text in total");
    Console.WriteLine("     MaxRequestHeaderCount       how many header lines");
    Console.WriteLine("     MaxRequestBodySize          how many body bytes");
    Console.WriteLine();
    Console.WriteLine("   Each has a default, each rejects with a specific status code, and");
    Console.WriteLine("   each exists because the alternative is letting a stranger decide how");
    Console.WriteLine("   much memory your process allocates. That is 03-request-limits.cs.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Features(string baseUrl)
{
    Console.WriteLine("4. How the pipeline learns about the connection");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };
    string body = await http.GetStringAsync("/features");
    string[] features = body.Split('\n');

    Console.WriteLine($"   HttpContext.Features on this request ({features.Length}):");
    Console.WriteLine();
    foreach (string feature in features)
    {
        Console.WriteLine($"     {feature}");
    }

    Console.WriteLine();
    Console.WriteLine("   A FEATURE is a small interface the server implements to expose one");
    Console.WriteLine("   capability. It is how HttpContext stays server-agnostic: the same");
    Console.WriteLine("   pipeline runs on Kestrel, on IIS, and on a test host, and each");
    Console.WriteLine("   provides the features it can.");
    Console.WriteLine();
    Console.WriteLine("   The consequence is that some things are ASKED FOR rather than always");
    Console.WriteLine("   present. Request body size limits, connection lifetime and the HTTP/2");
    Console.WriteLine("   reset feature are all reached this way:");
    Console.WriteLine();
    Console.WriteLine("     var limit = context.Features.Get<IHttpMaxRequestBodySizeFeature>();");
    Console.WriteLine("     if (limit is { IsReadOnly: false })");
    Console.WriteLine("     {");
    Console.WriteLine("         limit.MaxRequestBodySize = 50 * 1024 * 1024;");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   IsReadOnly is the part that bites: the limit can only be changed");
    Console.WriteLine("   BEFORE the body has started being read. After that the feature");
    Console.WriteLine("   refuses, because the decision has already been acted on.");
    Console.WriteLine();
    Console.WriteLine("   A feature that is ABSENT returns null rather than throwing. Code");
    Console.WriteLine("   that assumes a feature exists works on Kestrel and fails on a test");
    Console.WriteLine("   host, which is a confusing way to find out about this design.");
}
