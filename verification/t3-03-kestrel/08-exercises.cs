// 08-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 08-exercises.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Server.Kestrel.Core;

await Exercise1();
await Exercise2();
await Exercise3();
await Exercise4();
await Exercise5();
Exercise6();

// ---------------------------------------------------------------------------
// 1. EASY — match the limit to the status code.
// ---------------------------------------------------------------------------
static async Task Exercise1()
{
    Console.WriteLine("Exercise 1: which status code does each limit produce?");
    Console.WriteLine();
    Console.WriteLine("     a. a 50 MB body against MaxRequestBodySize");
    Console.WriteLine("     b. 200 headers against MaxRequestHeaderCount");
    Console.WriteLine("     c. a 10 KB URL against MaxRequestLineSize");
    Console.WriteLine("     d. 64 KB of header text against MaxRequestHeadersTotalSize");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Limits.MaxRequestBodySize = 512;
        options.Limits.MaxRequestHeadersTotalSize = 1024;
        options.Limits.MaxRequestHeaderCount = 10;
        options.Limits.MaxRequestLineSize = 128;
        options.Listen(IPAddress.Loopback, 0);
    });

    var app = builder.Build();
    app.MapGet("/", () => "ok");
    app.MapPost("/upload", async (HttpRequest r) =>
    {
        using var reader = new StreamReader(r.Body);
        return Results.Ok(new { n = (await reader.ReadToEndAsync()).Length });
    });

    await app.StartAsync();
    var uri = new Uri(app.Urls.First());

    int body = await PostAsync(uri, "/upload", 4000);
    int count = await RawAsync(uri, Headers(50));
    int line = await RawAsync(uri, LongQuery(1000));
    int total = await RawAsync(uri, BigHeader(4000));

    await app.StopAsync();

    Console.WriteLine("   limit crossed             status   name");
    Console.WriteLine("   -------------             ------   ----");
    Console.WriteLine($"   a. body too large         {body,6}   Content Too Large");
    Console.WriteLine($"   b. too many headers       {count,6}   Request Header Fields Too Large");
    Console.WriteLine($"   c. request line too long  {line,6}   URI Too Long");
    Console.WriteLine($"   d. headers too large      {total,6}   Request Header Fields Too Large");
    Console.WriteLine();
    Console.WriteLine("   Three codes for four limits: the two HEADER limits share 431, so a");
    Console.WriteLine("   client receiving one cannot tell whether it sent too many headers or");
    Console.WriteLine("   headers that were too big.");
    Console.WriteLine();
    Console.WriteLine("   All four are 4xx, which is the right assignment of blame - the");
    Console.WriteLine("   caller must change something and retrying unchanged will not help.");
    Console.WriteLine("   A 500 here would page you for somebody else's oversized request.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. EASY — what happens to the clients over the connection limit.
// ---------------------------------------------------------------------------
static async Task Exercise2()
{
    Console.WriteLine("Exercise 2: MaxConcurrentConnections is 2 and 5 clients connect.");
    Console.WriteLine("            What happens to the other three - queued, or refused?");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Limits.MaxConcurrentConnections = 2;
        options.Listen(IPAddress.Loopback, 0);
    });

    var app = builder.Build();
    app.MapGet("/slow", async () => { await Task.Delay(300); return "done"; });
    await app.StartAsync();
    string baseUrl = app.Urls.First();

    var sw = Stopwatch.StartNew();
    var results = new System.Collections.Concurrent.ConcurrentQueue<(long At, bool Ok)>();

    await Task.WhenAll(Enumerable.Range(0, 5).Select(async _ =>
    {
        try
        {
            using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };
            using var request = new HttpRequestMessage(HttpMethod.Get, "/slow");
            request.Headers.ConnectionClose = true;
            using HttpResponseMessage response = await http.SendAsync(request);
            await response.Content.ReadAsStringAsync();
            results.Enqueue((sw.ElapsedMilliseconds, true));
        }
        catch (HttpRequestException)
        {
            results.Enqueue((sw.ElapsedMilliseconds, false));
        }
    }));

    await app.StopAsync();

    int ok = results.Count(r => r.Ok);
    int failed = results.Count - ok;
    long firstFailure = results.Where(r => !r.Ok).Select(r => r.At).DefaultIfEmpty(-1).Min();
    long lastSuccess = results.Where(r => r.Ok).Select(r => r.At).DefaultIfEmpty(-1).Max();

    Console.WriteLine($"   succeeded              : {ok}");
    Console.WriteLine($"   failed                 : {failed}");
    Console.WriteLine($"   first failure at       : {firstFailure} ms");
    Console.WriteLine($"   last success at        : {lastSuccess} ms (the endpoint takes 300 ms)");
    Console.WriteLine();
    Console.WriteLine("   REFUSED, NOT QUEUED - and refused immediately, long before the");
    Console.WriteLine("   successful requests finished.");
    Console.WriteLine();
    Console.WriteLine("   Kestrel accepts the connection, sees it is over the limit, and");
    Console.WriteLine("   closes it before reading a byte. There is no request, so there is");
    Console.WriteLine("   no status code - the client sees a dropped connection.");
    Console.WriteLine();
    Console.WriteLine("   Two consequences worth carrying:");
    Console.WriteLine();
    Console.WriteLine("     - IT IS INVISIBLE IN REQUEST METRICS. No request was parsed, so");
    Console.WriteLine("       nothing hit your middleware or your access log. Kestrel logs a");
    Console.WriteLine("       warning and publishes kestrel.rejected_connections; neither is");
    Console.WriteLine("       where anyone looks first.");
    Console.WriteLine();
    Console.WriteLine("     - THE CLIENT CANNOT TELL IT FROM A CRASH. If you want load");
    Console.WriteLine("       shedding a client can reason about, do it in middleware with 503");
    Console.WriteLine("       and Retry-After. That costs a parsed request, which is the whole");
    Console.WriteLine("       trade: this limit is cheap because it acts before parsing, and");
    Console.WriteLine("       uninformative for the same reason.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — an upload endpoint that fails above 30 MB.
// ---------------------------------------------------------------------------
static async Task Exercise3()
{
    Console.WriteLine("Exercise 3: /documents rejects files over 30 MB with a 413.");
    Console.WriteLine("            Statements up to 200 MB must be accepted. Three fixes are");
    Console.WriteLine("            proposed. Which do you ship?");
    Console.WriteLine();
    Console.WriteLine("     a. options.Limits.MaxRequestBodySize = 200 * 1024 * 1024;");
    Console.WriteLine("     b. options.Limits.MaxRequestBodySize = null;");
    Console.WriteLine("     c. endpoint metadata raising the limit on /documents only");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Limits.MaxRequestBodySize = 1024;
        options.Listen(IPAddress.Loopback, 0);
    });

    var app = builder.Build();

    app.MapPost("/login", async (HttpRequest r) =>
    {
        using var reader = new StreamReader(r.Body);
        return Results.Ok(new { n = (await reader.ReadToEndAsync()).Length });
    });

    app.MapPost("/documents", async (HttpRequest r) =>
    {
        using var reader = new StreamReader(r.Body);
        return Results.Ok(new { n = (await reader.ReadToEndAsync()).Length });
    }).WithMetadata(new SizeLimit(1024 * 1024));

    await app.StartAsync();
    var uri = new Uri(app.Urls.First());

    int documents = await PostAsync(uri, "/documents", 4000);
    int login = await PostAsync(uri, "/login", 4000);

    await app.StopAsync();

    Console.WriteLine("   with option (c), a 4,000-byte body against a 1,024-byte server limit:");
    Console.WriteLine();
    Console.WriteLine($"     POST /documents (raised)   : {documents}");
    Console.WriteLine($"     POST /login     (not)      : {login}");
    Console.WriteLine();
    Console.WriteLine("   SHIP (c). The other two raise the limit for every endpoint in the");
    Console.WriteLine("   application, including the ones an unauthenticated stranger can");
    Console.WriteLine("   reach.");
    Console.WriteLine();
    Console.WriteLine("   Concretely, with (a): /login will read 200 MB from anyone who sends");
    Console.WriteLine("   it. Ten concurrent requests doing that is 2 GB of buffering for");
    Console.WriteLine("   nothing, from clients that never authenticate. (b) removes the");
    Console.WriteLine("   ceiling entirely and lets one caller decide how much memory your");
    Console.WriteLine("   process uses.");
    Console.WriteLine();
    Console.WriteLine("   Two details that finish the answer:");
    Console.WriteLine();
    Console.WriteLine("     - PREFER METADATA TO THE FEATURE. Setting");
    Console.WriteLine("       IHttpMaxRequestBodySizeFeature.MaxRequestBodySize inside the");
    Console.WriteLine("       handler works, but the feature is READ-ONLY once anything has");
    Console.WriteLine("       started reading the body - so a filter or a model-bound");
    Console.WriteLine("       parameter that touched it first silently defeats you.");
    Console.WriteLine();
    Console.WriteLine("     - RAISING THE LIMIT IS NOT THE WHOLE DESIGN. A 200 MB body is");
    Console.WriteLine("       buffered or streamed somewhere. Stream it to storage rather than");
    Console.WriteLine("       reading it into memory, and set the limit to the largest file");
    Console.WriteLine("       you actually support rather than a round number above it.");
    Console.WriteLine();
    Console.WriteLine("   And check what is in front of you: a proxy has its own body limit,");
    Console.WriteLine("   often 1 MB by default in nginx. Raising Kestrel's changes nothing if");
    Console.WriteLine("   the request never reaches it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — which settings defend against slowloris.
// ---------------------------------------------------------------------------
static async Task Exercise4()
{
    Console.WriteLine("Exercise 4: an attacker opens connections and sends a header byte every");
    Console.WriteLine("            few seconds, never finishing a request. Which settings stop");
    Console.WriteLine("            it, and which does nothing?");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(1);
        options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(2);
        options.Listen(IPAddress.Loopback, 0);
    });

    var app = builder.Build();
    app.MapGet("/", () => "ok");
    await app.StartAsync();
    var uri = new Uri(app.Urls.First());

    using var client = new TcpClient();
    await client.ConnectAsync(uri.Host, uri.Port);
    await using NetworkStream stream = client.GetStream();
    await stream.WriteAsync(Encoding.ASCII.GetBytes("GET / HTTP/1.1\r\nHost: x\r\nX-A: a"));

    var sw = Stopwatch.StartNew();
    var buffer = new byte[1024];
    int read = await stream.ReadAsync(buffer);
    sw.Stop();

    string response = read == 0
        ? "connection closed"
        : Encoding.ASCII.GetString(buffer, 0, read).Split("\r\n")[0];

    await app.StopAsync();

    Console.WriteLine($"   RequestHeadersTimeout 1 s, KeepAliveTimeout 2 min");
    Console.WriteLine($"   partial headers held open -> {response} after {sw.ElapsedMilliseconds} ms");
    Console.WriteLine();
    Console.WriteLine("   setting                    defends?   why");
    Console.WriteLine("   -------                    --------   ---");
    Console.WriteLine("   RequestHeadersTimeout      YES        caps the whole header phase");
    Console.WriteLine("   MinRequestBodyDataRate     YES        catches a dribbled body");
    Console.WriteLine("   MinResponseDataRate        YES        catches a slow reader");
    Console.WriteLine("   KeepAliveTimeout           NO         the attacker is not idle");
    Console.WriteLine("   MaxConcurrentConnections   partly     caps the count, at a cost");
    Console.WriteLine();
    Console.WriteLine("   THE KEEP-ALIVE TIMEOUT IS THE TRAP. It measures time between");
    Console.WriteLine("   REQUESTS on an idle connection. A slowloris connection is never");
    Console.WriteLine("   idle - it is mid-request, making a byte of progress now and then -");
    Console.WriteLine("   so a two-minute keep-alive never fires and lowering it to seconds");
    Console.WriteLine("   would hurt legitimate clients while doing nothing to the attack.");
    Console.WriteLine();
    Console.WriteLine("   MaxConcurrentConnections bounds the damage rather than stopping it,");
    Console.WriteLine("   and the cost is that legitimate clients are refused alongside the");
    Console.WriteLine("   attacker once the ceiling is reached.");
    Console.WriteLine();
    Console.WriteLine("   All four defences are ON BY DEFAULT. The realistic risk is not");
    Console.WriteLine("   forgetting to enable them - it is switching one off to fix a");
    Console.WriteLine("   legitimate slow client, globally, and never putting it back.");
    Console.WriteLine();
    Console.WriteLine("   And the honest limit: these bound what ONE connection can waste.");
    Console.WriteLine("   Ten thousand connections each behaving legally is a volume problem,");
    Console.WriteLine("   and volume is handled in front of you.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 5. HARD — rate limiting stops working behind an ingress.
// ---------------------------------------------------------------------------
static async Task Exercise5()
{
    Console.WriteLine("Exercise 5: after moving behind an ingress, every request appears to");
    Console.WriteLine("            come from one address. Diagnose it, fix it, and say how you");
    Console.WriteLine("            would know the fix is correct.");
    Console.WriteLine();

    (int distinctBroken, bool spoofBroken) = await MeasureAsync(configure: null);

    (int distinctSloppy, bool spoofSloppy) = await MeasureAsync(app =>
    {
        var options = NewOptions();
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        options.ForwardLimit = null;
        app.UseForwardedHeaders(options);
    });

    (int distinctCorrect, bool spoofCorrect) = await MeasureAsync(app =>
    {
        var options = NewOptions();
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Add(IPAddress.Loopback);
        options.ForwardLimit = 1;
        app.UseForwardedHeaders(options);
    });

    Console.WriteLine("   configuration                        distinct clients   allow-list spoofable");
    Console.WriteLine("   -------------                        ----------------   --------------------");
    Console.WriteLine($"   no middleware                        {distinctBroken,16}   {(spoofBroken ? "YES" : "no"),20}");
    Console.WriteLine($"   cleared sets, no ForwardLimit        {distinctSloppy,16}   {(spoofSloppy ? "YES" : "no"),20}");
    Console.WriteLine($"   ingress trusted, ForwardLimit 1      {distinctCorrect,16}   {(spoofCorrect ? "YES" : "no"),20}");
    Console.WriteLine();
    Console.WriteLine("   THE DIAGNOSIS. Your application is not talking to clients any more.");
    Console.WriteLine("   RemoteIpAddress is the ingress, correctly, and every client shares");
    Console.WriteLine("   one rate-limit bucket. Confirm it by logging RemoteIpAddress on one");
    Console.WriteLine("   endpoint: if an hour of traffic has one address, that is your proxy.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX, in four parts:");
    Console.WriteLine();
    Console.WriteLine("     1. UseForwardedHeaders, registered FIRST - before authentication,");
    Console.WriteLine("        HTTPS redirection, rate limiting and logging, all of which read");
    Console.WriteLine("        the address or the scheme.");
    Console.WriteLine();
    Console.WriteLine("     2. Clear the defaults AND ADD the ingress. Clearing alone means");
    Console.WriteLine("        trusting EVERY sender - the middle row above - which is the");
    Console.WriteLine("        opposite of how it reads.");
    Console.WriteLine();
    Console.WriteLine("     3. ForwardLimit = the number of proxies you run, normally 1. Each");
    Console.WriteLine("        proxy APPENDS the address it saw, so N entries from the right");
    Console.WriteLine("        are the ones your own proxies wrote. Anything further left came");
    Console.WriteLine("        from outside.");
    Console.WriteLine();
    Console.WriteLine("     4. Check the ingress actually sends the headers. nginx needs");
    Console.WriteLine("        proxy_set_header X-Forwarded-Proto $scheme explicitly.");
    Console.WriteLine();
    Console.WriteLine("   HOW YOU KNOW IT IS RIGHT. Two checks, and the second is the one");
    Console.WriteLine("   people miss, because it is the difference between the last two rows:");
    Console.WriteLine();
    Console.WriteLine("     curl https://api.ledger.example/whoami");
    Console.WriteLine("       -> should report YOUR address, not the ingress");
    Console.WriteLine();
    Console.WriteLine("     curl -H 'X-Forwarded-For: 10.0.0.5' https://api.ledger.example/admin");
    Console.WriteLine("       -> must NOT be 200");
    Console.WriteLine();
    Console.WriteLine("   The first check passes in both of the last two rows. Only the second");
    Console.WriteLine("   distinguishes a correct configuration from one that fixed rate");
    Console.WriteLine("   limiting by making every IP-based decision forgeable.");
    Console.WriteLine();
    Console.WriteLine("   This middleware fails SILENTLY in both directions - it ignores");
    Console.WriteLine("   headers without a warning and trusts everyone without a warning - so");
    Console.WriteLine("   neither state is visible without asking.");
    Console.WriteLine();

    static ForwardedHeadersOptions NewOptions() => new()
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
    };
}

// ---------------------------------------------------------------------------
static async Task<(int Distinct, bool Spoofable)> MeasureAsync(Action<WebApplication>? configure)
{
    var seen = new HashSet<string>();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));

    var app = builder.Build();
    configure?.Invoke(app);

    app.MapGet("/whoami", (HttpContext c) =>
    {
        lock (seen)
        {
            seen.Add(c.Connection.RemoteIpAddress?.ToString() ?? "unknown");
        }

        return "ok";
    });

    app.MapGet("/admin", (HttpContext c) =>
        c.Connection.RemoteIpAddress?.ToString().StartsWith("10.0.0.", StringComparison.Ordinal) == true
            ? Results.Ok("admin")
            : Results.StatusCode(403));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    for (int i = 1; i <= 4; i++)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/whoami");
        request.Headers.TryAddWithoutValidation("X-Forwarded-For", $"203.0.113.{i}");
        (await http.SendAsync(request)).Dispose();
    }

    // The forged entry on the left, the ingress's observation on the right.
    using var attack = new HttpRequestMessage(HttpMethod.Get, "/admin");
    attack.Headers.TryAddWithoutValidation("X-Forwarded-For", "10.0.0.5, 203.0.113.99");
    using HttpResponseMessage adminResponse = await http.SendAsync(attack);

    await app.StopAsync();
    return (seen.Count, (int)adminResponse.StatusCode == 200);
}

// ---------------------------------------------------------------------------
// 6. HARD — settings for a service with no proxy in front.
// ---------------------------------------------------------------------------
static void Exercise6()
{
    Console.WriteLine("Exercise 6: a service is exposed directly to the internet with no proxy,");
    Console.WriteLine("            no CDN and no load balancer. Which Kestrel settings do you");
    Console.WriteLine("            change from their defaults, and what can Kestrel not do for");
    Console.WriteLine("            you at all?");
    Console.WriteLine();
    Console.WriteLine("   WHAT TO CHANGE");
    Console.WriteLine();
    Console.WriteLine("   1. MaxConcurrentConnections - SET IT. It defaults to no limit, which");
    Console.WriteLine("      is right behind a proxy that already bounds connections and wrong");
    Console.WriteLine("      when you are the front door. Pick a number below the point where");
    Console.WriteLine("      the process runs out of memory or file descriptors, and know that");
    Console.WriteLine("      clients above it get a dropped connection with no explanation.");
    Console.WriteLine();
    Console.WriteLine("   2. MaxRequestBodySize - LOWER IT. 30,000,000 bytes is generous for a");
    Console.WriteLine("      public API. Set the global limit to the largest ordinary request");
    Console.WriteLine("      and raise it per endpoint where a genuine upload needs it.");
    Console.WriteLine();
    Console.WriteLine("   3. The timeouts and data rates - LEAVE THEM ON. They are the");
    Console.WriteLine("      slowloris defence and they are already correct. The risk is");
    Console.WriteLine("      switching one off for a legitimate slow client and forgetting.");
    Console.WriteLine();
    Console.WriteLine("   4. TLS - YOU NOW OWN IT. Certificate provisioning, renewal and");
    Console.WriteLine("      reload without downtime become your problem rather than the");
    Console.WriteLine("      proxy's. An expired certificate is a total outage and it happens");
    Console.WriteLine("      on a date nobody is watching.");
    Console.WriteLine();
    Console.WriteLine("   5. Forwarded headers - DO NOT ENABLE THEM. There is no proxy, so");
    Console.WriteLine("      there is nobody trustworthy to write those headers, and honouring");
    Console.WriteLine("      them would let every client choose its own address.");
    Console.WriteLine();
    Console.WriteLine("   WHAT KESTREL CANNOT DO FOR YOU");
    Console.WriteLine();
    Console.WriteLine("     - VOLUME. Every limit in this module bounds what one connection");
    Console.WriteLine("       can waste. None of them helps against a hundred thousand");
    Console.WriteLine("       connections all behaving legally.");
    Console.WriteLine();
    Console.WriteLine("     - NETWORK-LAYER FLOODS. A SYN flood or a UDP flood never reaches");
    Console.WriteLine("       your process; it fills the queue in front of it.");
    Console.WriteLine();
    Console.WriteLine("     - CACHING AND STATIC CONTENT, which a CDN does far better and");
    Console.WriteLine("       without consuming your connections at all.");
    Console.WriteLine();
    Console.WriteLine("     - ANY OF IT WHILE YOU DEPLOY. One process serving directly means");
    Console.WriteLine("       a restart is an outage; there is nothing in front to hold");
    Console.WriteLine("       connections while you roll.");
    Console.WriteLine();
    Console.WriteLine("   So the honest answer to the exercise is that the settings are the");
    Console.WriteLine("   small part. THE REAL ANSWER IS TO PUT SOMETHING IN FRONT - and if");
    Console.WriteLine("   you genuinely cannot, then the list above is damage limitation");
    Console.WriteLine("   rather than a defence.");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
static async Task<int> PostAsync(Uri uri, string path, int bytes)
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

static string Headers(int count)
{
    var sb = new StringBuilder("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n");
    for (int i = 0; i < count; i++)
    {
        sb.Append($"X-H{i}: v\r\n");
    }

    return sb.Append("\r\n").ToString();
}

static string BigHeader(int size) =>
    new StringBuilder("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nX-Pad: ")
        .Append('p', size).Append("\r\n\r\n").ToString();

static string LongQuery(int size) =>
    new StringBuilder("GET /?q=").Append('a', size)
        .Append(" HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").ToString();

// ---------------------------------------------------------------------------
sealed class SizeLimit : Microsoft.AspNetCore.Http.Metadata.IRequestSizeLimitMetadata
{
    public SizeLimit(long maxRequestBodySize) => MaxRequestBodySize = maxRequestBodySize;

    public long? MaxRequestBodySize { get; }
}
