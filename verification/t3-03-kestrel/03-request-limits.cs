// 03-request-limits.cs — The four size limits, their defaults, and the exact
// status code each one produces when a client crosses it.
//
// Run:  dotnet run 03-request-limits.cs -c Release
//
// EXACT vs RATIO: every default, byte count and status code here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

TheDefaults();
await CrossingEachOne();
await PerEndpointOverride();
await ReadingTheBodyYourself();

// ---------------------------------------------------------------------------
static void TheDefaults()
{
    Console.WriteLine("1. The defaults, read from the running server");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.UseUrls("http://127.0.0.1:0");

    var app = builder.Build();
    KestrelServerLimits limits = app.Services
        .GetRequiredService<IOptions<KestrelServerOptions>>().Value.Limits;

    string bodySize = limits.MaxRequestBodySize is { } body
        ? $"{body:N0} bytes ({body / 1024 / 1024} MB)"
        : "null (no limit)";

    Console.WriteLine("   limit                        default");
    Console.WriteLine("   -----                        -------");
    Console.WriteLine($"   MaxRequestBodySize           {bodySize}");
    Console.WriteLine($"   MaxRequestHeadersTotalSize   {limits.MaxRequestHeadersTotalSize:N0} bytes");
    Console.WriteLine($"   MaxRequestHeaderCount        {limits.MaxRequestHeaderCount:N0}");
    Console.WriteLine($"   MaxRequestLineSize           {limits.MaxRequestLineSize:N0} bytes");
    Console.WriteLine($"   MaxRequestBufferSize         {limits.MaxRequestBufferSize:N0} bytes");
    Console.WriteLine($"   MaxResponseBufferSize        {limits.MaxResponseBufferSize:N0} bytes");
    Console.WriteLine();
    Console.WriteLine("   Every one of these exists for the same reason: WITHOUT IT, A");
    Console.WriteLine("   STRANGER DECIDES HOW MUCH MEMORY YOUR PROCESS ALLOCATES. Headers");
    Console.WriteLine("   have to be buffered before they can be parsed, so an unbounded");
    Console.WriteLine("   header is an unbounded allocation, requested by anyone who can");
    Console.WriteLine("   reach your port.");
    Console.WriteLine();
    Console.WriteLine("   The 30,000,000-byte body default is the one people meet first, usually as a");
    Console.WriteLine("   file upload that works for small files and fails for large ones.");
    Console.WriteLine();
    Console.WriteLine("   The last two are BUFFER sizes rather than limits on the client, and");
    Console.WriteLine("   they are back-pressure knobs: how much unread body Kestrel will");
    Console.WriteLine("   hold while your handler is slow to read it. Leave them alone unless");
    Console.WriteLine("   you have measured a reason.");
    Console.WriteLine();

    app.StopAsync().GetAwaiter().GetResult();
}

// ---------------------------------------------------------------------------
static async Task CrossingEachOne()
{
    Console.WriteLine("2. Crossing each limit, and what the client gets back");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();

    builder.WebHost.ConfigureKestrel(options =>
    {
        // Shrunk from the defaults so a test can cross them without sending
        // megabytes. The behaviour is identical at any size.
        options.Limits.MaxRequestBodySize = 1024;
        options.Limits.MaxRequestHeadersTotalSize = 2048;
        options.Limits.MaxRequestHeaderCount = 20;
        options.Limits.MaxRequestLineSize = 256;
        options.Listen(IPAddress.Loopback, 0);
    });

    var app = builder.Build();
    app.MapGet("/", () => "ok");
    app.MapPost("/upload", async (HttpRequest request) =>
    {
        using var reader = new StreamReader(request.Body);
        string body = await reader.ReadToEndAsync();
        return Results.Ok(new { received = body.Length });
    });

    await app.StartAsync();
    var uri = new Uri(app.Urls.First());

    Console.WriteLine("   what was sent                          status   meaning");
    Console.WriteLine("   -------------                          ------   -------");

    // Body: within, then over.
    Console.WriteLine($"   body of 1,000 bytes (limit 1,024)      {await PostBodyAsync(uri, 1000),6}   accepted");
    Console.WriteLine($"   body of 4,000 bytes                    {await PostBodyAsync(uri, 4000),6}   413 Content Too Large");

    // Header total size.
    Console.WriteLine($"   headers totalling ~1 KB (limit 2 KB)   {await RawAsync(uri, HeaderPadding(900)),6}   accepted");
    Console.WriteLine($"   headers totalling ~4 KB                {await RawAsync(uri, HeaderPadding(4000)),6}   431 Request Header Fields Too Large");

    // Header count.
    Console.WriteLine($"   10 headers (limit 20)                  {await RawAsync(uri, ManyHeaders(10)),6}   accepted");
    Console.WriteLine($"   40 headers                             {await RawAsync(uri, ManyHeaders(40)),6}   431 Request Header Fields Too Large");

    // Request line.
    Console.WriteLine($"   200-byte request line (limit 256)      {await RawAsync(uri, LongPath(150)),6}   accepted");
    Console.WriteLine($"   2,000-byte request line                {await RawAsync(uri, LongPath(1900)),6}   414 URI Too Long");

    Console.WriteLine();
    Console.WriteLine("   Four limits, four DIFFERENT status codes, and that is deliberate:");
    Console.WriteLine("   each one tells the client which part of its request to shrink.");
    Console.WriteLine();
    Console.WriteLine("     413   the BODY is too large");
    Console.WriteLine("     431   the HEADERS are too large, or too many of them");
    Console.WriteLine("     414   the URL is too long");
    Console.WriteLine();
    Console.WriteLine("   Note that the header count and the header size produce the SAME");
    Console.WriteLine("   code. A client that gets a 431 has to work out which of the two it");
    Console.WriteLine("   crossed, and the response body will not tell it.");
    Console.WriteLine();
    Console.WriteLine("   The practical case for the 414 is not an attack. It is a GET with a");
    Console.WriteLine("   long filter or a list of ids in the query string, which grows past");
    Console.WriteLine("   the limit as a customer's data grows. It works in testing with");
    Console.WriteLine("   three ids and fails in production with three hundred - and the fix");
    Console.WriteLine("   is to make it a POST with the filter in the body, not to raise the");
    Console.WriteLine("   limit.");
    Console.WriteLine();

    await app.StopAsync();
}

// ---------------------------------------------------------------------------
static async Task PerEndpointOverride()
{
    Console.WriteLine("3. Raising the limit for one endpoint only");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();

    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Limits.MaxRequestBodySize = 1024;
        options.Listen(IPAddress.Loopback, 0);
    });

    var app = builder.Build();

    app.MapPost("/small", async (HttpRequest request) =>
    {
        using var reader = new StreamReader(request.Body);
        return Results.Ok(new { received = (await reader.ReadToEndAsync()).Length });
    });

    // The per-request override, taken from the feature collection.
    app.MapPost("/large", async (HttpRequest request) =>
    {
        var feature = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false })
        {
            feature.MaxRequestBodySize = 1024 * 1024;
        }

        using var reader = new StreamReader(request.Body);
        return Results.Ok(new { received = (await reader.ReadToEndAsync()).Length });
    });

    // The same thing declaratively. This is the one to reach for.
    app.MapPost("/large-attribute", async (HttpRequest request) =>
    {
        using var reader = new StreamReader(request.Body);
        return Results.Ok(new { received = (await reader.ReadToEndAsync()).Length });
    }).WithMetadata(new SizeLimit(1024 * 1024));

    await app.StartAsync();
    var uri = new Uri(app.Urls.First());

    Console.WriteLine("   endpoint            4,000-byte body   note");
    Console.WriteLine("   --------            ---------------   ----");
    Console.WriteLine($"   /small              {await PostBodyAsync(uri, 4000, "/small"),15}   server limit of 1,024 applies");
    Console.WriteLine($"   /large              {await PostBodyAsync(uri, 4000, "/large"),15}   raised via the feature");
    Console.WriteLine($"   /large-attribute    {await PostBodyAsync(uri, 4000, "/large-attribute"),15}   raised via endpoint metadata");
    Console.WriteLine();
    Console.WriteLine("   RAISE THE LIMIT ON THE ENDPOINT THAT NEEDS IT, NOT ON THE SERVER.");
    Console.WriteLine("   A global 500 MB limit because one upload endpoint needs it means");
    Console.WriteLine("   every other endpoint - including unauthenticated ones - will also");
    Console.WriteLine("   read 500 MB from anyone who sends it.");
    Console.WriteLine();
    Console.WriteLine("   The metadata form is better than the feature form for two reasons:");
    Console.WriteLine("   it is visible on the endpoint rather than buried in the handler,");
    Console.WriteLine("   and it is applied before your code runs so there is no window in");
    Console.WriteLine("   which the wrong limit is in force.");
    Console.WriteLine();
    Console.WriteLine("   IsReadOnly on the feature is the trap in the imperative form. The");
    Console.WriteLine("   limit can only be changed BEFORE anything reads the body. Once a");
    Console.WriteLine("   read has started the feature refuses, because the decision has");
    Console.WriteLine("   already been acted on - so a model-bound parameter, a filter or a");
    Console.WriteLine("   middleware that touched the body first will silently defeat it.");
    Console.WriteLine();

    await app.StopAsync();
}

// ---------------------------------------------------------------------------
static async Task ReadingTheBodyYourself()
{
    Console.WriteLine("4. Where the exception surfaces");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();

    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Limits.MaxRequestBodySize = 1024;
        options.Listen(IPAddress.Loopback, 0);
    });

    string? caught = null;

    var app = builder.Build();
    app.MapPost("/read", async (HttpRequest request) =>
    {
        try
        {
            using var reader = new StreamReader(request.Body);
            string body = await reader.ReadToEndAsync();
            return Results.Ok(new { received = body.Length });
        }
        catch (Microsoft.AspNetCore.Http.BadHttpRequestException ex)
        {
            caught = $"{ex.GetType().Name}: {ex.Message} (StatusCode {ex.StatusCode})";
            throw;
        }
    });

    await app.StartAsync();
    var uri = new Uri(app.Urls.First());

    int status = await PostBodyAsync(uri, 4000, "/read");

    Console.WriteLine($"   status returned to the client : {status}");
    Console.WriteLine($"   what the handler saw          : {caught ?? "(nothing)"}");
    Console.WriteLine();
    Console.WriteLine("   THE LIMIT IS ENFORCED WHERE THE BODY IS READ, NOT WHERE THE REQUEST");
    Console.WriteLine("   ARRIVES. Kestrel does not count the bytes in advance and reject the");
    Console.WriteLine("   request up front - it throws when a read crosses the limit.");
    Console.WriteLine();
    Console.WriteLine("   Three consequences follow from that, and all three surprise people:");
    Console.WriteLine();
    Console.WriteLine("   1. YOUR HANDLER IS ALREADY RUNNING. The exception is thrown inside");
    Console.WriteLine("      your code, from the read, not before it was called. Anything you");
    Console.WriteLine("      did before reading the body has already happened.");
    Console.WriteLine();
    Console.WriteLine("   2. A CATCH-ALL WILL SWALLOW IT. BadHttpRequestException carries the");
    Console.WriteLine("      status code that should be returned. Code that catches Exception");
    Console.WriteLine("      and returns 500 turns a correct 413 into a server error, and");
    Console.WriteLine("      moves the blame from the caller to you.");
    Console.WriteLine();
    Console.WriteLine("   3. A CONTENT-LENGTH HEADER IS CHECKED EARLY, BUT A CHUNKED BODY IS");
    Console.WriteLine("      NOT. A client that declares its size is rejected before sending;");
    Console.WriteLine("      one that streams is rejected partway through, after you have");
    Console.WriteLine("      already received everything up to the limit.");
    Console.WriteLine();
    Console.WriteLine("   That last point is the one that matters for an upload endpoint: the");
    Console.WriteLine("   limit bounds your MEMORY and your disk, but it does not stop a");
    Console.WriteLine("   client using the bandwidth. Something upstream has to do that.");
    Console.WriteLine();

    await app.StopAsync();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
static async Task<int> PostBodyAsync(Uri uri, int bytes, string path = "/upload")
{
    using var http = new HttpClient { BaseAddress = uri, Timeout = TimeSpan.FromSeconds(10) };
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

// A raw socket, because HttpClient refuses to send some of these.
static async Task<int> RawAsync(Uri uri, string requestText)
{
    using var client = new TcpClient();
    await client.ConnectAsync(uri.Host, uri.Port);
    await using NetworkStream stream = client.GetStream();

    await stream.WriteAsync(Encoding.ASCII.GetBytes(requestText));

    using var reader = new StreamReader(stream, Encoding.ASCII);
    string? statusLine = await reader.ReadLineAsync();

    if (statusLine is null)
    {
        return -1;
    }

    string[] parts = statusLine.Split(' ');
    return parts.Length > 1 && int.TryParse(parts[1], out int code) ? code : -1;
}

static string HeaderPadding(int totalBytes)
{
    var sb = new StringBuilder();
    sb.Append("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n");
    sb.Append("X-Padding: ").Append('p', totalBytes).Append("\r\n");
    sb.Append("\r\n");
    return sb.ToString();
}

static string ManyHeaders(int count)
{
    var sb = new StringBuilder();
    sb.Append("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n");
    for (int i = 0; i < count; i++)
    {
        sb.Append($"X-Header-{i}: v\r\n");
    }

    sb.Append("\r\n");
    return sb.ToString();
}

// A long QUERY STRING rather than a long path, so the short case still routes
// to "/" and returns 200. A long path routes nowhere and returns 404, which
// proves the request line parsed but reads as a failure in the table.
static string LongPath(int queryLength)
{
    var sb = new StringBuilder();
    sb.Append("GET /?q=").Append('a', queryLength).Append(" HTTP/1.1\r\n");
    sb.Append("Host: localhost\r\nConnection: close\r\n\r\n");
    return sb.ToString();
}

// ---------------------------------------------------------------------------
// Endpoint metadata carrying a body size limit. Implementing the interface
// directly avoids pulling in MVC for one attribute, and shows what the
// attribute is underneath.
sealed class SizeLimit : Microsoft.AspNetCore.Http.Metadata.IRequestSizeLimitMetadata
{
    public SizeLimit(long maxRequestBodySize) => MaxRequestBodySize = maxRequestBodySize;

    public long? MaxRequestBodySize { get; }
}
