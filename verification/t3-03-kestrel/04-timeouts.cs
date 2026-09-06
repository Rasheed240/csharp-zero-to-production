// 04-timeouts.cs — The four timeouts that decide how long a client may hold a
// connection without doing anything useful with it.
//
// Run:  dotnet run 04-timeouts.cs -c Release
//
// EXACT vs RATIO: the OUTCOMES - closed, served, aborted - are exact. Elapsed
// milliseconds are machine-specific, but each is compared against a timeout of
// hundreds of milliseconds, so the comparisons hold.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

TheDefaults();
await HeadersTimeout();
await KeepAliveTimeout();
await SlowBody();
Slowloris();

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

    Console.WriteLine("   setting                   default        stops");
    Console.WriteLine("   -------                   -------        -----");
    Console.WriteLine($"   KeepAliveTimeout          {limits.KeepAliveTimeout.TotalSeconds,6} s        an idle connection being held open");
    Console.WriteLine($"   RequestHeadersTimeout     {limits.RequestHeadersTimeout.TotalSeconds,6} s        headers dribbled in slowly");

    MinDataRate? requestRate = limits.MinRequestBodyDataRate;
    MinDataRate? responseRate = limits.MinResponseDataRate;

    Console.WriteLine($"   MinRequestBodyDataRate    {Describe(requestRate),-14} a body sent too slowly");
    Console.WriteLine($"   MinResponseDataRate       {Describe(responseRate),-14} a response read too slowly");
    Console.WriteLine();
    Console.WriteLine("   The first two are DEADLINES: a fixed amount of time, after which");
    Console.WriteLine("   the connection is closed regardless of progress.");
    Console.WriteLine();
    Console.WriteLine("   The last two are RATES, and the distinction matters. A deadline on a");
    Console.WriteLine("   body would break every legitimate large upload over a slow link. A");
    Console.WriteLine("   rate says 'keep making progress at some minimum speed', so a 2 GB");
    Console.WriteLine("   upload over a slow connection is fine and a 2 KB upload dribbled out");
    Console.WriteLine("   one byte at a time is not.");
    Console.WriteLine();
    Console.WriteLine("   240 bytes per second is a deliberately low bar - roughly a 2,400 bps");
    Console.WriteLine("   modem. It is not there to enforce quality of service; it is there to");
    Console.WriteLine("   catch a client that is not really sending anything.");
    Console.WriteLine();
    Console.WriteLine("   The GRACE PERIOD is why the rate does not fire on a slow start: the");
    Console.WriteLine("   rate is not enforced until it has elapsed, which covers TLS");
    Console.WriteLine("   handshakes, TCP slow start and a client that pauses to think.");
    Console.WriteLine();

    app.StopAsync().GetAwaiter().GetResult();

    static string Describe(MinDataRate? rate) => rate is null
        ? "none"
        : $"{rate.BytesPerSecond} B/s, {rate.GracePeriod.TotalSeconds}s grace";
}

// ---------------------------------------------------------------------------
static async Task HeadersTimeout()
{
    Console.WriteLine("2. Headers that never arrive");
    Console.WriteLine();
    Console.WriteLine("   A request with its terminating blank line withheld - which is");
    Console.WriteLine("   exactly what a slowloris client sends - at four configured timeouts:");
    Console.WriteLine();
    Console.WriteLine("   configured   fired at   overshoot   response");
    Console.WriteLine("   ----------   --------   ---------   --------");

    foreach (int ms in new[] { 200, 1000, 2000, 4000 })
    {
        (long firedAt, string outcome) = await MeasureHeadersTimeoutAsync(ms);
        Console.WriteLine($"   {ms,7} ms   {firedAt,5} ms   {firedAt - ms,6} ms   {outcome}");
    }

    Console.WriteLine();
    Console.WriteLine("   Two things in that table are worth more than the timeout itself.");
    Console.WriteLine();
    Console.WriteLine("   FIRST, KESTREL SENDS 408 REQUEST TIMEOUT. It does not silently drop");
    Console.WriteLine("   the connection, which is what the first draft of this file predicted");
    Console.WriteLine("   and what most write-ups imply when they say the connection is closed.");
    Console.WriteLine("   The client gets a real status line and can tell a timeout apart from a");
    Console.WriteLine("   network failure.");
    Console.WriteLine();
    Console.WriteLine("   SECOND, THE OVERSHOOT IS ABOUT A SECOND AND DOES NOT SHRINK. These");
    Console.WriteLine("   timeouts are checked by a HEARTBEAT that runs roughly once a second,");
    Console.WriteLine("   not by a timer per connection. So:");
    Console.WriteLine();
    Console.WriteLine("     - the practical floor is about two seconds, whatever you configure");
    Console.WriteLine("     - a sub-second value buys you nothing over one second");
    Console.WriteLine("     - above that, expect your value plus up to a heartbeat");
    Console.WriteLine();
    Console.WriteLine("   That is a sensible design - a timer per connection would be a timer");
    Console.WriteLine("   per connection - but it means these are COARSE controls. If you are");
    Console.WriteLine("   trying to tune a timeout to a few hundred milliseconds here, you are");
    Console.WriteLine("   using the wrong tool.");
    Console.WriteLine();
    Console.WriteLine("   This is the single most important limit in this file. Without it,");
    Console.WriteLine("   holding a connection open costs an attacker one socket and no");
    Console.WriteLine("   bandwidth at all - they send a header byte occasionally and your");
    Console.WriteLine("   server waits politely forever.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<(long FiredAt, string Outcome)> MeasureHeadersTimeoutAsync(int timeoutMs)
{
    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options =>
    {
        // 30 seconds by default. Shortened so the test finishes.
        options.Limits.RequestHeadersTimeout = TimeSpan.FromMilliseconds(timeoutMs);
        options.Listen(IPAddress.Loopback, 0);
    });

    var app = builder.Build();
    app.MapGet("/", () => "ok");
    await app.StartAsync();
    var uri = new Uri(app.Urls.First());

    var sw = Stopwatch.StartNew();
    string outcome = await SendAsync(uri, "GET / HTTP/1.1\\r\\nHost: localhost\\r\\nX-Padding: a");
    sw.Stop();

    await app.StopAsync();
    return (sw.ElapsedMilliseconds, outcome);
}

// ---------------------------------------------------------------------------
static async Task KeepAliveTimeout()
{
    Console.WriteLine("3. An idle connection after a completed request");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options =>
    {
        // 130 seconds by default.
        options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(2);
        options.Listen(IPAddress.Loopback, 0);
    });

    var app = builder.Build();
    app.MapGet("/", () => "ok");
    await app.StartAsync();
    var uri = new Uri(app.Urls.First());

    using var client = new TcpClient();
    await client.ConnectAsync(uri.Host, uri.Port);
    await using NetworkStream stream = client.GetStream();

    // One complete request, keeping the connection alive.
    await stream.WriteAsync(Encoding.ASCII.GetBytes(
        "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"));

    var buffer = new byte[4096];
    int firstRead = await stream.ReadAsync(buffer);

    // Now do nothing. Kestrel should close the connection.
    var sw = Stopwatch.StartNew();
    int secondRead = await stream.ReadAsync(buffer);
    sw.Stop();

    Console.WriteLine($"   bytes of the first response   : {firstRead}");
    Console.WriteLine($"   KeepAliveTimeout              : 2,000 ms");
    Console.WriteLine($"   next read returned            : {secondRead} bytes after {sw.ElapsedMilliseconds} ms");
    Console.WriteLine();
    Console.WriteLine("   A read of 0 bytes means the other end closed the connection. The");
    Console.WriteLine("   server waited the keep-alive timeout for a second request and then");
    Console.WriteLine("   reclaimed the socket.");
    Console.WriteLine();
    Console.WriteLine("   The extra second over the configured value is the same heartbeat");
    Console.WriteLine("   measured in section 2. Every timeout in this file is checked on it.");
    Console.WriteLine();
    Console.WriteLine("   Note the difference from a headers timeout: NO 408 HERE. The");
    Console.WriteLine("   previous request completed correctly and there is no pending request");
    Console.WriteLine("   to answer, so the connection is closed without one. A client that had");
    Console.WriteLine("   started sending a new request at that moment sees a reset instead,");
    Console.WriteLine("   which is the race behind the occasional unexplained connection error");
    Console.WriteLine("   on a pooled client.");
    Console.WriteLine();
    Console.WriteLine("   130 seconds is a long default, and it is long on purpose: keeping a");
    Console.WriteLine("   connection open is far cheaper than repeating a TCP and TLS");
    Console.WriteLine("   handshake, so the server would rather hold an idle socket than make");
    Console.WriteLine("   a returning client pay for a new one.");
    Console.WriteLine();
    Console.WriteLine("   Lowering it is a memory-versus-latency trade, and usually the wrong");
    Console.WriteLine("   lever. If idle connections are consuming you, the question is");
    Console.WriteLine("   normally why there are so many clients holding them, not how fast");
    Console.WriteLine("   you can hang up.");
    Console.WriteLine();
    Console.WriteLine("   One thing it is NOT: a defence against slowloris. An attacker who");
    Console.WriteLine("   sends a byte occasionally is not idle, so this timer never fires.");
    Console.WriteLine("   The headers timeout and the data rates are what stop that.");
    Console.WriteLine();

    await app.StopAsync();
}

// ---------------------------------------------------------------------------
static async Task SlowBody()
{
    Console.WriteLine("4. A body sent one byte at a time");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options =>
    {
        // 240 B/s with 5 seconds of grace by default. The rate is raised and
        // the grace shortened so a dribbling client trips it quickly.
        //
        // 1.5 seconds, not less: MinDataRate REJECTS a grace period of one
        // second or under with an ArgumentOutOfRangeException, which is
        // consistent with the one-second heartbeat measured in section 2. A
        // grace period finer than the clock that checks it would be a lie.
        options.Limits.MinRequestBodyDataRate =
            new MinDataRate(bytesPerSecond: 1000, gracePeriod: TimeSpan.FromMilliseconds(1500));
        options.Listen(IPAddress.Loopback, 0);
    });

    string? handlerSaw = null;

    var app = builder.Build();
    app.MapPost("/upload", async (HttpRequest request) =>
    {
        try
        {
            using var reader = new StreamReader(request.Body);
            string body = await reader.ReadToEndAsync();
            return Results.Ok(new { received = body.Length });
        }
        catch (Exception ex)
        {
            handlerSaw = $"{ex.GetType().Name}: {ex.Message}";
            throw;
        }
    });

    await app.StartAsync();
    var uri = new Uri(app.Urls.First());

    using var client = new TcpClient();
    await client.ConnectAsync(uri.Host, uri.Port);
    await using NetworkStream stream = client.GetStream();

    // Announce 2,000 bytes and then send them far too slowly.
    await stream.WriteAsync(Encoding.ASCII.GetBytes(
        "POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2000\r\n" +
        "Content-Type: text/plain\r\nConnection: close\r\n\r\n"));

    var sw = Stopwatch.StartNew();
    int sent = 0;
    string outcome = "still going";

    try
    {
        for (int i = 0; i < 2000; i++)
        {
            await stream.WriteAsync("x"u8.ToArray());
            sent++;
            await Task.Delay(10);       // 100 bytes/second, well under the limit
        }

        outcome = "the whole body was accepted";
    }
    catch (IOException ex)
    {
        outcome = $"aborted by the server ({ex.InnerException?.GetType().Name ?? ex.GetType().Name})";
    }

    sw.Stop();

    Console.WriteLine($"   declared body size            : 2,000 bytes");
    Console.WriteLine($"   client's actual rate          : ~100 B/s");
    Console.WriteLine($"   MinRequestBodyDataRate        : 1,000 B/s after 1,500 ms of grace");
    Console.WriteLine($"   bytes sent before it stopped  : {sent}");
    Console.WriteLine($"   elapsed                       : {sw.ElapsedMilliseconds} ms");
    Console.WriteLine($"   outcome                       : {outcome}");
    Console.WriteLine($"   what the handler saw          : {handlerSaw ?? "(nothing - it never got a complete body)"}");
    Console.WriteLine();
    Console.WriteLine("   The client declared a size it was not delivering fast enough, and");
    Console.WriteLine("   the server hung up partway through.");
    Console.WriteLine();
    Console.WriteLine("   Note where the failure lands, because the two sides see different");
    Console.WriteLine("   things.");
    Console.WriteLine();
    Console.WriteLine("   THE CLIENT gets no status code at all - the connection is aborted,");
    Console.WriteLine("   which is indistinguishable from a network failure. That is the");
    Console.WriteLine("   right trade: a server under this kind of pressure should spend");
    Console.WriteLine("   nothing on explaining itself.");
    Console.WriteLine();
    Console.WriteLine("   THE SERVER gets a BadHttpRequestException naming the setting, thrown");
    Console.WriteLine("   from the read inside your handler. That is the debugging hook, and");
    Console.WriteLine("   it is the reason a catch-all around body reading is a bad idea: it");
    Console.WriteLine("   turns a precise message into a 500 with no cause.");
    Console.WriteLine();
    Console.WriteLine("   The mirror image is MinResponseDataRate, and it defends the case");
    Console.WriteLine("   people forget: a client that requests something large and then");
    Console.WriteLine("   reads it one byte at a time. Your server holds the response, the");
    Console.WriteLine("   buffers and the handler open for as long as the client cares to");
    Console.WriteLine("   take, which is a slowloris pointed the other way.");
    Console.WriteLine();
    Console.WriteLine("   That one has a genuine false-positive risk: a legitimate mobile");
    Console.WriteLine("   client on a bad connection downloading a large file can trip it.");
    Console.WriteLine("   Where that is a real use case, raise the grace period rather than");
    Console.WriteLine("   removing the rate, or turn it off for the specific endpoint using");
    Console.WriteLine("   IHttpMinResponseDataRateFeature.");
    Console.WriteLine();

    await app.StopAsync();
}

// ---------------------------------------------------------------------------
static void Slowloris()
{
    Console.WriteLine("5. What these four defend against, together");
    Console.WriteLine();
    Console.WriteLine("   SLOWLORIS is an attack that costs almost nothing to run: open many");
    Console.WriteLine("   connections, send a partial request on each, and keep them barely");
    Console.WriteLine("   alive. No bandwidth, no CPU, no clever payload. The server holds");
    Console.WriteLine("   every connection open waiting for a request that never completes.");
    Console.WriteLine();
    Console.WriteLine("   Each limit closes one door:");
    Console.WriteLine();
    Console.WriteLine("     partial headers, held open      RequestHeadersTimeout");
    Console.WriteLine("     headers finished, body dribbled MinRequestBodyDataRate");
    Console.WriteLine("     response read one byte at a time MinResponseDataRate");
    Console.WriteLine("     request done, socket held idle  KeepAliveTimeout");
    Console.WriteLine();
    Console.WriteLine("   All four are ON BY DEFAULT, which is worth saying plainly because");
    Console.WriteLine("   the usual advice about this attack is about nginx rather than about");
    Console.WriteLine("   your application server. Kestrel ships defended.");
    Console.WriteLine();
    Console.WriteLine("   The way people undo that is by turning one off to fix a bug:");
    Console.WriteLine();
    Console.WriteLine("     options.Limits.MinRequestBodyDataRate = null;");
    Console.WriteLine();
    Console.WriteLine("   That line usually appears because a legitimate slow upload was being");
    Console.WriteLine("   aborted. It fixes the symptom and removes the defence for every");
    Console.WriteLine("   endpoint at once. Raising the grace period, or clearing the rate for");
    Console.WriteLine("   the single endpoint that needs it, keeps the rest protected:");
    Console.WriteLine();
    Console.WriteLine("     var feature = context.Features");
    Console.WriteLine("         .Get<IHttpMinRequestBodyDataRateFeature>();");
    Console.WriteLine("     if (feature is not null)");
    Console.WriteLine("     {");
    Console.WriteLine("         feature.MinDataRate = null;   // this request only");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   And the honest limit of all of it: these bound what ONE connection");
    Console.WriteLine("   can waste. They do nothing about ten thousand connections each");
    Console.WriteLine("   behaving legally. Volume is somebody else's job - a proxy, a CDN, or");
    Console.WriteLine("   the network in front of you.");
}

// ---------------------------------------------------------------------------
static async Task<string> SendAsync(Uri uri, string requestText)
{
    using var client = new TcpClient();
    await client.ConnectAsync(uri.Host, uri.Port);
    await using NetworkStream stream = client.GetStream();

    await stream.WriteAsync(Encoding.ASCII.GetBytes(requestText));

    var buffer = new byte[4096];
    int read;

    try
    {
        read = await stream.ReadAsync(buffer);
    }
    catch (IOException)
    {
        return "connection reset by the server";
    }

    if (read == 0)
    {
        return "connection closed with no response";
    }

    string response = Encoding.ASCII.GetString(buffer, 0, read);
    return response.Split("\r\n")[0];
}
