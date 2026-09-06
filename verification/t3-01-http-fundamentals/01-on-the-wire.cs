// 01-on-the-wire.cs — What an HTTP request and response actually look like as
// bytes, read off a real socket talking to a real Kestrel.
//
// Run:  dotnet run 01-on-the-wire.cs -c Release
//
// This starts a genuine ASP.NET Core server on the loopback address, on a port
// the operating system chooses, and then talks to it with a raw TcpClient so
// nothing is hidden by HttpClient.
//
// EXACT vs RATIO: every byte shown here is deterministic apart from the Date
// header and the port number.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true

using System.Net.Sockets;
using System.Text;

var builder = WebApplication.CreateBuilder();

// Port 0 means "any free port" - the OS picks one and tells us. Using a fixed
// port in a sample is how two programs collide on a build agent.
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

app.MapGet("/hello", () => "hi");
app.MapGet("/fixed", () => Results.Text("a fixed length body", "text/plain"));
app.MapPost("/echo", (HttpRequest request) => Results.Text($"you sent {request.ContentLength} bytes"));

await app.StartAsync();

int port = new Uri(app.Urls.First()).Port;
Console.WriteLine($"Kestrel listening on 127.0.0.1:{port}");
Console.WriteLine();

TheRequest();
await TheResponse(port);
await BodyFraming(port);
await WhatIsRequired(port);

await app.StopAsync();

// ---------------------------------------------------------------------------
static void TheRequest()
{
    Console.WriteLine("1. What a request is");
    Console.WriteLine();
    Console.WriteLine("   Three parts, separated by carriage-return line-feed pairs:");
    Console.WriteLine();
    Console.WriteLine("     GET /hello HTTP/1.1          <- request line: method, target, version");
    Console.WriteLine("     Host: 127.0.0.1              <- headers, one per line");
    Console.WriteLine("     Connection: close");
    Console.WriteLine("                                  <- a blank line ends the headers");
    Console.WriteLine("     (body, if any)");
    Console.WriteLine();
    Console.WriteLine("   That is the entire protocol for a request. It is text, it is");
    Console.WriteLine("   line-oriented, and the blank line is what tells the server the");
    Console.WriteLine("   headers are finished.");
    Console.WriteLine();
    Console.WriteLine("   Host is REQUIRED in HTTP/1.1. One IP address serves many sites, so");
    Console.WriteLine("   the server needs to be told which one you meant. Omitting it is a");
    Console.WriteLine("   400 - demonstrated in section 4.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheResponse(int port)
{
    Console.WriteLine("2. What comes back");
    Console.WriteLine();

    string raw = await RawExchangeAsync(port,
        "GET /hello HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Connection: close\r\n" +
        "\r\n");

    Console.WriteLine("   the exact bytes, with line breaks made visible:");
    Console.WriteLine();
    foreach (string line in raw.Split("\r\n"))
    {
        Console.WriteLine($"     {line}\\r\\n");
    }

    Console.WriteLine();
    Console.WriteLine("   The first line is the STATUS LINE: version, code, reason phrase.");
    Console.WriteLine("   Then headers, then a blank line, then the body.");
    Console.WriteLine();
    Console.WriteLine("   Nothing in the handler asked for Content-Type, Date or Server.");
    Console.WriteLine("   Kestrel adds them. Nothing asked for Transfer-Encoding either -");
    Console.WriteLine("   that is section 3, and it is the interesting one.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task BodyFraming(int port)
{
    Console.WriteLine("3. How the receiver knows where the body ends");
    Console.WriteLine();
    Console.WriteLine("   A socket is a stream of bytes with no end marker. Something has to");
    Console.WriteLine("   say how long the body is, and HTTP has exactly three answers.");
    Console.WriteLine();

    string chunked = await RawExchangeAsync(port,
        "GET /hello HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");

    string fixedLength = await RawExchangeAsync(port,
        "GET /fixed HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");

    Console.WriteLine("   (a) CONTENT-LENGTH - the server knows the size up front");
    Console.WriteLine();
    foreach (string line in HeadersOf(fixedLength))
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine($"     ...body is exactly {ContentLengthOf(fixedLength)} bytes");
    Console.WriteLine();

    Console.WriteLine("   (b) TRANSFER-ENCODING: CHUNKED - the server does not know yet");
    Console.WriteLine();
    foreach (string line in HeadersOf(chunked))
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("     the body, with the chunk framing visible:");
    string body = BodyOf(chunked);
    foreach (string line in body.Split("\r\n"))
    {
        Console.WriteLine($"       {(line.Length == 0 ? "(blank)" : line)}");
    }

    Console.WriteLine();
    Console.WriteLine("     Each chunk is a hexadecimal length, then the bytes, then CRLF.");
    Console.WriteLine("     A zero-length chunk ends the body. Here: 2, then 'hi', then 0.");
    Console.WriteLine();
    Console.WriteLine("   (c) CONNECTION CLOSE - the body ends when the socket does. HTTP/1.0");
    Console.WriteLine("       style, and it means a dropped connection is indistinguishable");
    Console.WriteLine("       from a complete response. Avoid it.");
    Console.WriteLine();
    Console.WriteLine("   Why chunked appeared without being asked for: the handler returned a");
    Console.WriteLine("   string and Kestrel started sending before it knew the total length.");
    Console.WriteLine("   Results.Text with a known string sets Content-Length instead.");
    Console.WriteLine();
    Console.WriteLine("   This matters for one specific production reason: you cannot set a");
    Console.WriteLine("   header after the first byte of the body has gone. Once the response");
    Console.WriteLine("   has STARTED, the status code and headers are already on the wire.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatIsRequired(int port)
{
    Console.WriteLine("4. What the server insists on");
    Console.WriteLine();

    // No Host header: illegal in HTTP/1.1.
    string noHost = await RawExchangeAsync(port,
        "GET /hello HTTP/1.1\r\nConnection: close\r\n\r\n");

    // A method the server has no route for.
    string wrongMethod = await RawExchangeAsync(port,
        "DELETE /hello HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");

    // A path with no route at all.
    string noRoute = await RawExchangeAsync(port,
        "GET /nothing-here HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");

    Console.WriteLine($"   no Host header      -> {StatusOf(noHost)}");
    Console.WriteLine($"   DELETE /hello       -> {StatusOf(wrongMethod)}");
    Console.WriteLine($"   GET /nothing-here   -> {StatusOf(noRoute)}");
    Console.WriteLine();
    Console.WriteLine("   The middle one is worth noticing. The path exists; the METHOD does");
    Console.WriteLine("   not. That is 405, not 404, and a 405 response is required to say");
    Console.WriteLine("   which methods are allowed:");
    Console.WriteLine();

    foreach (string line in HeadersOf(wrongMethod).Where(h => h.StartsWith("Allow", StringComparison.OrdinalIgnoreCase)))
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   ASP.NET Core does that for you when a route matches the path but");
    Console.WriteLine("   not the method. Hand-written routing frequently returns 404 for");
    Console.WriteLine("   this case, which tells the client the resource does not exist when");
    Console.WriteLine("   it does.");
}

// ---------------------------------------------------------------------------
// A raw HTTP exchange: write the request bytes, read until the server closes.
// No HttpClient, so nothing is normalised or hidden.
// ---------------------------------------------------------------------------
static async Task<string> RawExchangeAsync(int port, string request)
{
    using var tcp = new TcpClient();
    await tcp.ConnectAsync("127.0.0.1", port);

    await using NetworkStream stream = tcp.GetStream();
    await stream.WriteAsync(Encoding.ASCII.GetBytes(request));

    using var reader = new StreamReader(stream, Encoding.ASCII);
    return await reader.ReadToEndAsync();
}

static string StatusOf(string raw) => raw.Split("\r\n")[0];

static IEnumerable<string> HeadersOf(string raw) =>
    raw.Split("\r\n\r\n")[0].Split("\r\n");

static string BodyOf(string raw)
{
    int split = raw.IndexOf("\r\n\r\n", StringComparison.Ordinal);
    return split < 0 ? string.Empty : raw[(split + 4)..];
}

static string ContentLengthOf(string raw) =>
    HeadersOf(raw).FirstOrDefault(h => h.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
        ?.Split(':')[1].Trim() ?? "(none)";
