// 01-lifetime-and-connections.cs — What an HttpClient's lifetime does to the
// connections underneath it, in both directions: a client per call opens a
// connection per call, and a client that lives forever keeps a connection
// forever.
//
// The server counts distinct connections itself, so these are not inferred
// from the client side.
//
// Run:  dotnet run 01-lifetime-and-connections.cs -c Release
//
// EXACT vs RATIO: the connection counts are deterministic. The timings are
// machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

var connectionIds = new ConcurrentDictionary<string, byte>();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

app.Use(async (context, next) =>
{
    connectionIds.TryAdd(context.Connection.Id, 0);

    await next();
});

app.MapGet("/v1/payments/{id}", (string id) => Results.Ok(new { id, status = "captured" }));

await app.StartAsync();

string baseAddress = app.Urls.First();

Console.WriteLine("What the client's lifetime does to the connection");
Console.WriteLine();

// ---------------------------------------------------------------------------
Console.WriteLine("1. FIFTY CALLS, TWO WAYS");
Console.WriteLine();

connectionIds.Clear();

var clock = Stopwatch.StartNew();

for (int n = 0; n < 50; n++)
{
    using var perCall = new HttpClient();

    await perCall.GetAsync($"{baseAddress}/v1/payments/PAY-{n:000}");
}

double perCallMs = clock.Elapsed.TotalMilliseconds;
int perCallConnections = connectionIds.Count;

connectionIds.Clear();

using var shared = new HttpClient();

clock.Restart();

for (int n = 0; n < 50; n++)
{
    await shared.GetAsync($"{baseAddress}/v1/payments/PAY-{n:000}");
}

double sharedMs = clock.Elapsed.TotalMilliseconds;
int sharedConnections = connectionIds.Count;

Console.WriteLine("   how the client is managed         connections the server saw      took");
Console.WriteLine("   -------------------------         --------------------------      ----");
Console.WriteLine($"   a new HttpClient every call       {perCallConnections,26}   {perCallMs,4:0} ms");
Console.WriteLine($"   one HttpClient, reused            {sharedConnections,26}   {sharedMs,4:0} ms");
Console.WriteLine();
Console.WriteLine("   THE SERVER COUNTED THOSE, so this is not an inference. Each new HttpClient");
Console.WriteLine("   brings its own connection pool, so it cannot reuse anything, and disposing");
Console.WriteLine("   it throws the connection away.");
Console.WriteLine();
Console.WriteLine("   AND THE DISCARDED SOCKET DOES NOT COME BACK IMMEDIATELY. A closed TCP");
Console.WriteLine("   connection sits in TIME_WAIT for around four minutes, holding its local");
Console.WriteLine("   port. Windows hands out roughly 16,384 dynamic ports, so a service doing");
Console.WriteLine("   this at 100 calls a second consumes 24,000 ports in four minutes - and");
Console.WriteLine("   then every outbound call fails, including calls to services that were");
Console.WriteLine("   never involved.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("2. AND THE FIX FOR THAT HAS ITS OWN FAILURE");
Console.WriteLine();

connectionIds.Clear();

using var forever = new HttpClient(new SocketsHttpHandler
{
    // The default.
    PooledConnectionLifetime = Timeout.InfiniteTimeSpan
});

for (int round = 0; round < 6; round++)
{
    await forever.GetAsync($"{baseAddress}/v1/payments/PAY-001");

    await Task.Delay(200);
}

int foreverConnections = connectionIds.Count;

connectionIds.Clear();

using var recycled = new HttpClient(new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMilliseconds(300)
});

for (int round = 0; round < 6; round++)
{
    await recycled.GetAsync($"{baseAddress}/v1/payments/PAY-001");

    await Task.Delay(200);
}

int recycledConnections = connectionIds.Count;

Console.WriteLine("   PooledConnectionLifetime    six calls over 1.2 s opened");
Console.WriteLine("   ------------------------    ---------------------------");
Console.WriteLine($"   infinite (the default)      {foreverConnections,27}");
Console.WriteLine($"   300 ms                      {recycledConnections,27}");
Console.WriteLine();
Console.WriteLine("   ONE CONNECTION, HELD FOR AS LONG AS THE CLIENT EXISTS. That is efficient,");
Console.WriteLine("   and it is why a static HttpClient never notices that anything has changed.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("3. WHICH IS THE DNS INCIDENT, REPRODUCED");
Console.WriteLine();
Console.WriteLine("   Two servers, and a name that resolves to the first one and then to the");
Console.WriteLine("   second - a failover, a scale-out, a redeploy behind a load balancer.");
Console.WriteLine();

// Two real servers, each tagging its own answers.
IPEndPoint blue = await StartTagged("blue");
IPEndPoint green = await StartTagged("green");

// The "DNS" answer, which changes halfway through.
IPEndPoint current = blue;
int lookups = 0;

// ConnectCallback replaces resolution and connection entirely, so counting
// calls to it counts exactly the moments a name would be looked up.
SocketsHttpHandler Handler(TimeSpan lifetime) => new()
{
    PooledConnectionLifetime = lifetime,
    ConnectCallback = async (context, token) =>
    {
        Interlocked.Increment(ref lookups);

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };

        await socket.ConnectAsync(current, token);

        return new NetworkStream(socket, ownsSocket: true);
    }
};

foreach ((string label, TimeSpan lifetime) in new[]
{
    ("infinite (the default)", Timeout.InfiniteTimeSpan),
    ("300 ms", TimeSpan.FromMilliseconds(300))
})
{
    current = blue;
    lookups = 0;

    using var client = new HttpClient(Handler(lifetime));

    var reached = new List<string>();

    for (int round = 0; round < 8; round++)
    {
        // The failover happens here, after the fourth call.
        if (round == 4)
        {
            current = green;
        }

        HttpResponseMessage response = await client.GetAsync(
            "http://pricing.internal/v1/payments/PAY-001");

        reached.Add(response.Headers.GetValues("x-served-by").First());

        await Task.Delay(150);
    }

    Console.WriteLine($"   PooledConnectionLifetime {label}");
    Console.WriteLine($"     name lookups            {lookups}");
    Console.WriteLine($"     reached                 {string.Join(" ", reached)}");
    Console.WriteLine($"     after the failover      {string.Join(" ", reached.Skip(4))}");
    Console.WriteLine();
}

Console.WriteLine("   THE DEFAULT CLIENT NEVER LOOKED THE NAME UP AGAIN. One lookup, one");
Console.WriteLine("   connection, and every call after the failover went to a server the name no");
Console.WriteLine("   longer points at. Nothing was cached wrongly and no TTL was ignored - the");
Console.WriteLine("   client simply never had a reason to ask, because the connection it already");
Console.WriteLine("   had was still open.");
Console.WriteLine();
Console.WriteLine("   THAT IS WHY THE FIX IS A CONNECTION LIFETIME AND NOT A DNS SETTING. Nothing");
Console.WriteLine("   in the resolver can help a client that is not resolving.");
Console.WriteLine();
Console.WriteLine("   AND IT IS WHY 'RESTARTING THE POD FIXES IT' IS THE CLASSIC SYMPTOM: a");
Console.WriteLine("   restart is the only event that reliably forces a new connection, so the");
Console.WriteLine("   pods that were restarted recover and the ones that were not stay broken.");

await app.StopAsync();

// ---------------------------------------------------------------------------
async Task<IPEndPoint> StartTagged(string name)
{
    var tagged = WebApplication.CreateBuilder();
    tagged.WebHost.UseUrls("http://127.0.0.1:0");
    tagged.Logging.ClearProviders();

    var taggedApp = tagged.Build();

    taggedApp.MapGet("/v1/payments/{id}", (string id, HttpResponse response) =>
    {
        response.Headers["x-served-by"] = name;

        return Results.Ok(new { id, status = "captured" });
    });

    await taggedApp.StartAsync();

    var uri = new Uri(taggedApp.Urls.First());

    return new IPEndPoint(IPAddress.Loopback, uri.Port);
}
