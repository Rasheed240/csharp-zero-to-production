// 03-production.cs — The incident: checkout started failing every outbound
// call, including calls to services it barely uses, and the service it was
// actually hammering was perfectly healthy.
//
// A MODEL, AND SAID SO: the ephemeral port range here is 200 ports with a
// 4-second TIME_WAIT, not Windows' 16,384 ports with a 4-minute one. The
// mechanism is the real one - a connection holds its local port after it
// closes - and the arithmetic for the real numbers is printed at the end.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: the SHAPE is deterministic - the per-call run exhausts the
// pool and the shared run does not. The exact failure counts move by a few
// either way between runs, because ports come back on a timer.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

app.MapGet("/v1/prices/{id}", (string id) => Results.Ok(new { id, amountMinor = 4999 }));
app.MapGet("/v1/audit", () => Results.Ok(new { recorded = true }));

await app.StartAsync();

var target = new IPEndPoint(IPAddress.Loopback, new Uri(app.Urls.First()).Port);

Console.WriteLine("The checkout that ran out of sockets");
Console.WriteLine();
Console.WriteLine("   16:02  checkout starts failing outbound calls");
Console.WriteLine("   16:04  pricing is checked and is healthy: no errors, normal latency");
Console.WriteLine("   16:06  the audit service, called perhaps twice a minute, fails too");
Console.WriteLine("   16:20  checkout is restarted and recovers, for about ten minutes");
Console.WriteLine();
Console.WriteLine("   SocketException: Only one usage of each socket address (protocol/network");
Console.WriteLine("   address/port) is normally permitted.");
Console.WriteLine();

// ---------------------------------------------------------------------------
// The machine's ephemeral ports, modelled. A connection takes one and holds it
// for TIME_WAIT after closing.
var ports = new PortPool(capacity: 200, timeWait: TimeSpan.FromSeconds(4));

SocketsHttpHandler Handler(TimeSpan? pooledLifetime = null) => new()
{
    PooledConnectionLifetime = pooledLifetime ?? Timeout.InfiniteTimeSpan,
    ConnectCallback = async (context, token) =>
    {
        if (!ports.TryRent())
        {
            throw new SocketException((int)SocketError.AddressAlreadyInUse);
        }

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };

        await socket.ConnectAsync(target, token);

        return new PortHoldingStream(socket, ports);
    }
};

Console.WriteLine("1. THE WAY THE CODE WAS WRITTEN");
Console.WriteLine();

(int pricingFailures, int auditFailures, double elapsed, int peak) =
    await RunWorkload(perCallClient: true);

Console.WriteLine($"   pricing calls attempted            300");
Console.WriteLine($"   pricing calls that failed          {pricingFailures}");
Console.WriteLine($"   audit calls attempted              10");
Console.WriteLine($"   audit calls that failed            {auditFailures}");
Console.WriteLine($"   peak ports held                    {peak} of 200");
Console.WriteLine($"   took                               {elapsed:0} ms");
Console.WriteLine();
Console.WriteLine("   THE AUDIT FAILURES ARE THE POINT. Those calls went to a different");
Console.WriteLine("   service, through a different client, at a rate of one every thirty");
Console.WriteLine("   requests - and the ones that needed a new connection while the pool was");
Console.WriteLine("   empty failed anyway, because PORTS ARE A MACHINE RESOURCE, not a");
Console.WriteLine("   per-client one. Whichever caller exhausts them, everything outbound");
Console.WriteLine("   fails - including the calls of whoever is nowhere near the problem.");
Console.WriteLine();
Console.WriteLine("   NOTE THAT NOT ALL OF THEM FAILED. A client with a connection already open");
Console.WriteLine("   keeps working, so the failures are intermittent and land on whichever");
Console.WriteLine("   caller happens to need a new connection. Intermittent failures spread");
Console.WriteLine("   across unrelated dependencies is the signature of this incident.");
Console.WriteLine();
Console.WriteLine("   WHICH IS WHY THE INVESTIGATION WENT WRONG. The errors named the audit");
Console.WriteLine("   service, so the audit service was investigated. It was fine. So was");
Console.WriteLine("   pricing. The only unhealthy thing was the caller.");

ports.Reset();

Console.WriteLine();
Console.WriteLine("2. THE SAME WORKLOAD, ONE CLIENT");
Console.WriteLine();

(int pricingFailures2, int auditFailures2, double elapsed2, int peak2) =
    await RunWorkload(perCallClient: false);

Console.WriteLine($"   pricing calls that failed          {pricingFailures2}");
Console.WriteLine($"   audit calls that failed            {auditFailures2}");
Console.WriteLine($"   peak ports held                    {peak2} of 200");
Console.WriteLine($"   took                               {elapsed2:0} ms");
Console.WriteLine();
Console.WriteLine("   ONE LINE OF DIFFERENCE. The same 310 calls, the same servers, the same");
Console.WriteLine("   port budget - and the peak went from a full pool to a handful, because a");
Console.WriteLine("   reused connection does not need a new port.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("3. THE ARITHMETIC, WITH THE REAL NUMBERS");
Console.WriteLine();
Console.WriteLine("   Windows hands out ports 49152-65535 by default:      16,384");
Console.WriteLine("   TIME_WAIT holds each one for:                     240 seconds");
Console.WriteLine("   So the sustainable rate of NEW connections is:");
Console.WriteLine("                              16,384 / 240  =  68 per second");
Console.WriteLine();
Console.WriteLine("   A SERVICE HANDLING 100 REQUESTS A SECOND, EACH MAKING ONE OUTBOUND CALL");
Console.WriteLine("   WITH A FRESH HttpClient, NEEDS 100 PORTS A SECOND. It exhausts the range");
Console.WriteLine("   in under three minutes and cannot recover while the load continues,");
Console.WriteLine("   because ports come back at 68 a second and it is spending 100.");
Console.WriteLine();
Console.WriteLine("   THAT IS WHY RESTARTING HELPED FOR TEN MINUTES AND THEN STOPPED HELPING.");
Console.WriteLine("   A restart does not return the ports - TIME_WAIT is kernel state and");
Console.WriteLine("   outlives the process. It returns an empty connection pool, which buys");
Console.WriteLine("   exactly as long as it takes to fill again.");
Console.WriteLine();
Console.WriteLine("   AND NOTE WHAT IS NOT THE FIX. Raising the port range or shortening");
Console.WriteLine("   TIME_WAIT moves the threshold; it does not change the fact that the");
Console.WriteLine("   service needs one port per request forever. Reusing the connection");
Console.WriteLine("   changes the requirement from 100 a second to approximately zero.");

await app.StopAsync();

// ---------------------------------------------------------------------------
async Task<(int, int, double, int)> RunWorkload(bool perCallClient)
{
    var shared = new HttpClient(Handler());
    // The audit client models any client whose connections are recycled - which
    // is every factory client, by default, every two minutes. It therefore has
    // to establish a connection occasionally, and that is all it takes.
    var auditClient = new HttpClient(Handler(TimeSpan.FromMilliseconds(50)));

    int pricingFailed = 0;
    int auditFailed = 0;

    var clock = Stopwatch.StartNew();

    for (int n = 0; n < 300; n++)
    {
        try
        {
            if (perCallClient)
            {
                // The line that caused the incident.
                using var perCall = new HttpClient(Handler());

                await perCall.GetAsync($"http://checkout.internal/v1/prices/SKU-{n:000}");
            }
            else
            {
                await shared.GetAsync($"http://checkout.internal/v1/prices/SKU-{n:000}");
            }
        }
        catch (HttpRequestException)
        {
            Interlocked.Increment(ref pricingFailed);
        }

        // Every thirtieth request, the audit call. A different service, a
        // different client, nothing to do with pricing.
        if (n % 30 == 29)
        {
            try
            {
                await auditClient.GetAsync("http://audit.internal/v1/audit");
            }
            catch (HttpRequestException)
            {
                Interlocked.Increment(ref auditFailed);
            }
        }
    }

    double took = clock.Elapsed.TotalMilliseconds;

    shared.Dispose();
    auditClient.Dispose();

    return (pricingFailed, auditFailed, took, ports.Peak);
}

// ---------------------------------------------------------------------------
// The machine's ephemeral port range, modelled: a fixed number of ports, each
// held for TIME_WAIT after the connection using it closes.
public sealed class PortPool(int capacity, TimeSpan timeWait)
{
    private int held;

    public int Peak { get; private set; }

    public bool TryRent()
    {
        lock (this)
        {
            if (held >= capacity)
            {
                return false;
            }

            held++;

            if (held > Peak)
            {
                Peak = held;
            }

            return true;
        }
    }

    public void Return() => _ = Task.Delay(timeWait).ContinueWith(_ =>
    {
        lock (this)
        {
            held--;
        }
    });

    public void Reset()
    {
        lock (this)
        {
            held = 0;
            Peak = 0;
        }
    }
}

// A connection that gives its port back only after TIME_WAIT, which is the
// whole of the problem.
public sealed class PortHoldingStream(Socket socket, PortPool ports)
    : NetworkStream(socket, ownsSocket: true)
{
    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);

        if (disposing)
        {
            ports.Return();
        }
    }
}
