// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: the counts, status codes and byte sizes are deterministic.
// The timings are machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Grpc.AspNetCore.Server@2.71.0
#:package Grpc.Net.Client@2.71.0

using System.Diagnostics;
using System.Text.Json;
using Grpc.Core;
using Grpc.Net.Client;
using Microsoft.AspNetCore.Server.Kestrel.Core;

await One();
await Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static async Task One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the client that cannot reach the server");
    Console.WriteLine();
    Console.WriteLine("   A gRPC service works from a test client on a developer machine. From");
    Console.WriteLine("   the staging cluster every call fails immediately, before the handler");
    Console.WriteLine("   runs. The service is definitely up - an HTTP health check on the same");
    Console.WriteLine("   port answers fine.");
    Console.WriteLine();

    Console.WriteLine("   endpoint speaks   gRPC call        an ordinary GET");
    Console.WriteLine("   ---------------   ---------        ---------------");

    foreach ((string label, HttpProtocols protocols) in new[]
    {
        ("HTTP/1.1 only", HttpProtocols.Http1),
        ("HTTP/2 only", HttpProtocols.Http2),
        ("HTTP/1.1 and 2", HttpProtocols.Http1AndHttp2)
    })
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.WebHost.ConfigureKestrel(o =>
            o.ConfigureEndpointDefaults(e => e.Protocols = protocols));
        builder.Logging.ClearProviders();
        builder.Services.AddGrpc();

        var app = builder.Build();
        app.MapGrpcService<Payments>();
        app.MapGet("/health", () => "ok");

        await app.StartAsync();

        string grpc;

        try
        {
            using var channel = GrpcChannel.ForAddress(app.Urls.First());

            GetResponse response = await channel.CreateCallInvoker().AsyncUnaryCall(
                Contract.Get, null, new CallOptions(), new GetRequest("PAY-001"));

            grpc = "OK";
        }
        catch (Exception exception)
        {
            grpc = exception is RpcException rpc ? rpc.StatusCode.ToString() : exception.GetType().Name;
        }

        string http;

        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

            http = await client.GetStringAsync("/health");
        }
        catch (Exception exception)
        {
            http = exception.GetType().Name;
        }

        Console.WriteLine($"   {label,-17} {grpc,-16} {http}");

        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: gRPC REQUIRES HTTP/2 AND WILL NOT DEGRADE. It needs multiplexed");
    Console.WriteLine("   streams for the streaming call types and trailers for the status code,");
    Console.WriteLine("   and HTTP/1.1 has neither. There is no fallback, because there is nothing");
    Console.WriteLine("   to fall back to.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD ROW IS THE ONE WORTH STOPPING ON, because it is the");
    Console.WriteLine("   configuration most people reach for and it did NOT work. 'HTTP/1.1 and");
    Console.WriteLine("   2' sounds like 'both', and over cleartext it means 'HTTP/1.1'.");
    Console.WriteLine();
    Console.WriteLine("   THE REASON IS THAT PROTOCOL NEGOTIATION LIVES IN TLS. Over HTTPS, ALPN");
    Console.WriteLine("   lets the client and server agree on HTTP/2 during the handshake. Over");
    Console.WriteLine("   plain HTTP there is no handshake to negotiate in, so a dual-protocol");
    Console.WriteLine("   endpoint has to guess, and it guesses HTTP/1.1.");
    Console.WriteLine();
    Console.WriteLine("   WHICH GIVES A RULE THAT SAVES AN AFTERNOON: OVER CLEARTEXT, SAY HTTP/2");
    Console.WriteLine("   EXPLICITLY. Over TLS you do not have to, and 'it works in production and");
    Console.WriteLine("   not in the docker-compose file' usually comes down to exactly this");
    Console.WriteLine("   difference.");
    Console.WriteLine();
    Console.WriteLine("   AND THE MIDDLE ROW SHOWS THE COST OF SAYING IT: an HTTP/2-only endpoint");
    Console.WriteLine("   refuses the ordinary GET. That is why the health check kept working in");
    Console.WriteLine("   the ticket - it was on a differently-configured port, and it proved");
    Console.WriteLine("   nothing about the one gRPC was using.");
    Console.WriteLine();
    Console.WriteLine("   WHAT ACTUALLY DIFFERS BETWEEN A LAPTOP AND A CLUSTER is everything in");
    Console.WriteLine("   the middle. TLS termination that speaks HTTP/2 to the client and");
    Console.WriteLine("   HTTP/1.1 to your service. An older load balancer. A service mesh");
    Console.WriteLine("   sidecar. Each of them can break gRPC while leaving every REST endpoint");
    Console.WriteLine("   working, which is precisely the ticket.");
    Console.WriteLine();
    Console.WriteLine("   SO THE FIRST QUESTION IS ALWAYS: IS IT HTTP/2 END TO END? Not 'does the");
    Console.WriteLine("   service support HTTP/2' - every hop, including the ones nobody on your");
    Console.WriteLine("   team configured.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the field that was renamed");
    Console.WriteLine();
    Console.WriteLine("   A service adds a field to a response message and renames another. The");
    Console.WriteLine("   client is deployed a week later. Between the two deployments, some");
    Console.WriteLine("   values silently become zero.");
    Console.WriteLine();
    Console.WriteLine("   (Protobuf identifies fields by NUMBER, not by name. This file's JSON");
    Console.WriteLine("   marshaller identifies them by name, so the two failure modes below are");
    Console.WriteLine("   shown side by side.)");
    Console.WriteLine();

    // The old message, as the client still understands it.
    var oldWire = JsonSerializer.SerializeToUtf8Bytes(
        new { Id = "PAY-001", Amount = 4999L, Status = "captured" });

    // The new server: Amount renamed to AmountMinor, and a field added.
    var newWire = JsonSerializer.SerializeToUtf8Bytes(
        new { Id = "PAY-001", AmountMinor = 4999L, Status = "captured", Currency = "GBP" });

    Console.WriteLine("   what the client parses            Id          Amount   Status");
    Console.WriteLine("   ----------------------            --          ------   ------");

    foreach ((string label, byte[] wire) in new[]
    {
        ("the old message", oldWire),
        ("the new message, renamed field", newWire)
    })
    {
        OldClientView parsed = JsonSerializer.Deserialize<OldClientView>(wire)!;

        Console.WriteLine($"   {label,-33} {parsed.Id,-11} {parsed.Amount,-8} {parsed.Status}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE RENAME SILENTLY ZEROED THE AMOUNT. The client looked for a");
    Console.WriteLine("   field that no longer exists, found nothing, and used the default. The");
    Console.WriteLine("   ADDED field was ignored harmlessly, which is the half people expect.");
    Console.WriteLine();
    Console.WriteLine("   WITH REAL PROTOBUF THE SAME RULE APPLIES WITH A DIFFERENT KEY. Fields");
    Console.WriteLine("   are identified by their NUMBER, so:");
    Console.WriteLine();
    Console.WriteLine("     RENAMING A FIELD IS FREE, because the number did not change and the");
    Console.WriteLine("     name is never on the wire. This is the one thing protobuf makes safe");
    Console.WriteLine("     that JSON does not.");
    Console.WriteLine();
    Console.WriteLine("     CHANGING A FIELD'S NUMBER IS CATASTROPHIC and looks like a tidy-up.");
    Console.WriteLine("     Reordering fields in a .proto file to group them nicely, and");
    Console.WriteLine("     renumbering as you go, silently reassigns every value to a different");
    Console.WriteLine("     field.");
    Console.WriteLine();
    Console.WriteLine("     REUSING THE NUMBER OF A DELETED FIELD IS THE SAME BUG, LATER. Which");
    Console.WriteLine("     is why .proto has a 'reserved' keyword: reserved 4, 7; stops anybody");
    Console.WriteLine("     from ever using those numbers again.");
    Console.WriteLine();
    Console.WriteLine("   AND THE DEEPER POINT IS THE SAME AS FOR A QUEUED JOB OR A HUB METHOD:");
    Console.WriteLine("   THE MESSAGE IS A CONTRACT WITH A VERSION SKEW. During any rolling");
    Console.WriteLine("   deploy, old clients read new messages and new clients read old ones.");
    Console.WriteLine("   Both directions have to work, and 'we deployed them together' is not");
    Console.WriteLine("   something a distributed system lets you have.");
    Console.WriteLine();
    Console.WriteLine("   THE RULES THAT FOLLOW: ADD FIELDS, NEVER RENUMBER, NEVER REUSE A");
    Console.WriteLine("   NUMBER, AND RESERVE WHAT YOU DELETE. A new field must be optional in");
    Console.WriteLine("   effect, because every existing client will omit it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the channel created per call");
    Console.WriteLine();
    Console.WriteLine("   A service creates a GrpcChannel inside each request handler, uses it,");
    Console.WriteLine("   and disposes it. Under load, latency rises and the machine accumulates");
    Console.WriteLine("   connections in TIME_WAIT.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.WebHost.ConfigureKestrel(o =>
        o.ConfigureEndpointDefaults(e => e.Protocols = HttpProtocols.Http2));
    builder.Logging.ClearProviders();
    builder.Services.AddGrpc();

    var app = builder.Build();
    app.MapGrpcService<Payments>();
    await app.StartAsync();

    string address = app.Urls.First();

    Console.WriteLine("   how the channel is managed        50 calls took");
    Console.WriteLine("   --------------------------        -------------");

    // A channel per call.
    var perCall = Stopwatch.StartNew();

    for (int i = 0; i < 50; i++)
    {
        using var channel = GrpcChannel.ForAddress(address);

        await channel.CreateCallInvoker().AsyncUnaryCall(
            Contract.Get, null, new CallOptions(), new GetRequest("PAY-001"));
    }

    perCall.Stop();

    Console.WriteLine($"   a new channel every call          {perCall.Elapsed.TotalMilliseconds,10:0} ms");

    // One channel, reused.
    using (var shared = GrpcChannel.ForAddress(address))
    {
        CallInvoker invoker = shared.CreateCallInvoker();
        var reused = Stopwatch.StartNew();

        for (int i = 0; i < 50; i++)
        {
            await invoker.AsyncUnaryCall(
                Contract.Get, null, new CallOptions(), new GetRequest("PAY-001"));
        }

        reused.Stop();

        Console.WriteLine($"   one channel, reused               {reused.Elapsed.TotalMilliseconds,10:0} ms");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: A CHANNEL IS A CONNECTION, NOT A REQUEST OBJECT. Creating one");
    Console.WriteLine("   opens a TCP connection, negotiates HTTP/2 and, over TLS, performs a");
    Console.WriteLine("   handshake. Disposing it closes all of that. Doing it per call pays that");
    Console.WriteLine("   cost every time and leaves a socket in TIME_WAIT afterwards.");
    Console.WriteLine();
    Console.WriteLine("   AND IT THROWS AWAY THE THING HTTP/2 IS FOR. One connection carries many");
    Console.WriteLine("   concurrent streams, so a shared channel handles parallel calls on one");
    Console.WriteLine("   socket - which is exactly the multiplexing that made HTTP/2 worth");
    Console.WriteLine("   adopting, discarded by creating a connection per call.");
    Console.WriteLine();
    Console.WriteLine("   SO A CHANNEL IS LONG-LIVED, SHARED, AND THREAD-SAFE. Register it as a");
    Console.WriteLine("   singleton, or use AddGrpcClient, which does that and adds the");
    Console.WriteLine("   IHttpClientFactory machinery for handler lifetime and DNS refresh:");
    Console.WriteLine();
    Console.WriteLine("     builder.Services.AddGrpcClient<Payments.PaymentsClient>(o =>");
    Console.WriteLine("         o.Address = new Uri(\"https://pricing.internal\"));");
    Console.WriteLine();
    Console.WriteLine("   THIS IS THE SAME MISTAKE AS 'new HttpClient()' IN A HANDLER, and it has");
    Console.WriteLine("   the same two symptoms - socket exhaustion under load, and a stale");
    Console.WriteLine("   endpoint after a DNS change if you over-correct into one static");
    Console.WriteLine("   connection that lives forever.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - the subscription that outlives its client");
    Console.WriteLine();
    Console.WriteLine("   A server-streaming subscription works in testing. In production the");
    Console.WriteLine("   service accumulates memory and threads over hours, and restarting it");
    Console.WriteLine("   fixes the problem for a while.");
    Console.WriteLine();
    Console.WriteLine("   Below, the client reads two messages and then walks away cleanly.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.WebHost.ConfigureKestrel(o =>
        o.ConfigureEndpointDefaults(e => e.Protocols = HttpProtocols.Http2));
    builder.Logging.ClearProviders();
    builder.Services.AddGrpc();

    var app = builder.Build();
    app.MapGrpcService<Payments>();
    await app.StartAsync();

    Console.WriteLine("   the handler                        client gone after   handler stopped after");
    Console.WriteLine("   -----------                        -----------------   ---------------------");

    foreach ((string label, bool honours) in
        new[] { ("ignores context.CancellationToken", false), ("honours it", true) })
    {
        Payments.Reset();

        using var channel = GrpcChannel.ForAddress(app.Urls.First());

        var clock = Stopwatch.StartNew();
        double abandonedAt;

        using (AsyncServerStreamingCall<GetResponse> call =
            channel.CreateCallInvoker().AsyncServerStreamingCall(
                Contract.Subscribe, null, new CallOptions(), new GetRequest(honours ? "honour" : "ignore")))
        {
            // Read two messages, then walk away - the client crashed, or the
            // user closed the page.
            int read = 0;

            await foreach (GetResponse _ in call.ResponseStream.ReadAllAsync())
            {
                if (++read == 2)
                {
                    break;
                }
            }

            abandonedAt = clock.Elapsed.TotalMilliseconds;
        }

        // Give the handler time to notice, if it is going to.
        await Task.Delay(1200);

        string stopped = Payments.SubscribeEndedAtMs > 0
            ? $"{Payments.SubscribeEndedAtMs} ms"
            : "still running";

        Console.WriteLine($"   {label,-34} {abandonedAt,14:0} ms   {stopped}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: BOTH STOPPED, AND THEY STOPPED FOR DIFFERENT REASONS. That");
    Console.WriteLine("   difference is the exercise.");
    Console.WriteLine();
    Console.WriteLine("   THE HANDLER THAT OBSERVES THE TOKEN WAS TOLD. Disposing the call sends");
    Console.WriteLine("   a cancellation, gRPC cancels context.CancellationToken, and the loop");
    Console.WriteLine("   exits at its next check - promptly and deliberately.");
    Console.WriteLine();
    Console.WriteLine("   THE OTHER ONE FOUND OUT BY TRYING TO WRITE. A write to a dead stream");
    Console.WriteLine("   throws, so a handler that writes often discovers the disconnection on");
    Console.WriteLine("   its next write without observing any token. It took longer, and it did");
    Console.WriteLine("   stop.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS WHY THIS BUG IS INVISIBLE IN TESTING. A test subscription");
    Console.WriteLine("   produces as fast as it can, so the write-failure path fires almost at");
    Console.WriteLine("   once and the missing token check costs nothing observable.");
    Console.WriteLine();
    Console.WriteLine("   TWO THINGS BREAK THAT SAFETY NET IN PRODUCTION, AND NEITHER IS");
    Console.WriteLine("   MEASURED HERE - this file cannot simulate them in one process, so take");
    Console.WriteLine("   the following as reasoning rather than as a measurement:");
    Console.WriteLine();
    Console.WriteLine("     A REAL SUBSCRIPTION MOSTLY WAITS. It blocks on a queue read or an");
    Console.WriteLine("     event and writes rarely, so it will not attempt a write - and will");
    Console.WriteLine("     not discover anything - until something happens. A subscription to a");
    Console.WriteLine("     quiet merchant has no reason to touch the stream for hours.");
    Console.WriteLine();
    Console.WriteLine("     AND A CLIENT THAT VANISHES DOES NOT SEND A CANCELLATION. The client");
    Console.WriteLine("     above disposed its call, politely. A crashed process, a severed");
    Console.WriteLine("     network or a laptop lid sends nothing at all, and the server learns");
    Console.WriteLine("     only when TCP eventually gives up - which, with keepalives off, can");
    Console.WriteLine("     be a very long time.");
    Console.WriteLine();
    Console.WriteLine("   COMBINE THE TWO - a handler that rarely writes and a client that");
    Console.WriteLine("   vanished without saying so - and nothing is left to notice. THAT is the");
    Console.WriteLine("   accumulation, and 'restarting fixes it for a while' is the symptom.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS WHY 'RESTARTING FIXES IT FOR A WHILE' IS THE SYMPTOM. Every");
    Console.WriteLine("   abandoned subscription is still there until the process ends.");
    Console.WriteLine();
    Console.WriteLine("   THREE THINGS A LONG-LIVED STREAM NEEDS:");
    Console.WriteLine();
    Console.WriteLine("     THE TOKEN, OBSERVED. Pass context.CancellationToken to every await in");
    Console.WriteLine("     the loop, and check it in the loop condition. A WriteAsync to a dead");
    Console.WriteLine("     stream will eventually throw, but 'eventually' can be a long time if");
    Console.WriteLine("     the loop spends most of it waiting.");
    Console.WriteLine();
    Console.WriteLine("     A MAXIMUM LIFETIME. End the stream after an hour and let the client");
    Console.WriteLine("     reconnect. It bounds every leak you have not thought of, and it");
    Console.WriteLine("     forces clients to have reconnect logic - which they need anyway, and");
    Console.WriteLine("     which is otherwise only exercised during an incident.");
    Console.WriteLine();
    Console.WriteLine("     A CAP ON CONCURRENT STREAMS. Each one is a held connection, a thread");
    Console.WriteLine("     in an await, and whatever it captured. Ten thousand subscribers is a");
    Console.WriteLine("     capacity question that has nothing to do with requests per second.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
public record GetRequest(string Id);

public record GetResponse(string Id, string Status);

public record OldClientView(string Id, long Amount, string Status);

// ---------------------------------------------------------------------------
public static class Contract
{
    public static Marshaller<T> Json<T>() => Marshallers.Create(
        value => JsonSerializer.SerializeToUtf8Bytes(value),
        bytes => JsonSerializer.Deserialize<T>(bytes)!);

    const string Service = "ledger.Payments";

    public static readonly Method<GetRequest, GetResponse> Get =
        new(MethodType.Unary, Service, "Get", Json<GetRequest>(), Json<GetResponse>());

    public static readonly Method<GetRequest, GetResponse> Subscribe =
        new(MethodType.ServerStreaming, Service, "Subscribe", Json<GetRequest>(), Json<GetResponse>());

    public static void BindService(ServiceBinderBase binder, PaymentsBase? service)
    {
        binder.AddMethod(Get, service is null
            ? null
            : new UnaryServerMethod<GetRequest, GetResponse>(service.Get));

        binder.AddMethod(Subscribe, service is null
            ? null
            : new ServerStreamingServerMethod<GetRequest, GetResponse>(service.Subscribe));
    }
}

// ---------------------------------------------------------------------------
[BindServiceMethod(typeof(Contract), nameof(Contract.BindService))]
public abstract class PaymentsBase
{
    public virtual Task<GetResponse> Get(GetRequest request, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));

    public virtual Task Subscribe(GetRequest request,
        IServerStreamWriter<GetResponse> responses, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));
}

// ---------------------------------------------------------------------------
public sealed class Payments : PaymentsBase
{
    public static int SubscribeEndedAtMs;

    public static void Reset() => SubscribeEndedAtMs = 0;

    public override Task<GetResponse> Get(GetRequest request, ServerCallContext context) =>
        Task.FromResult(new GetResponse(request.Id, "captured"));

    public override async Task Subscribe(GetRequest request,
        IServerStreamWriter<GetResponse> responses, ServerCallContext context)
    {
        bool honour = request.Id == "honour";
        var clock = Stopwatch.StartNew();

        try
        {
            // A real subscription spends nearly all its time WAITING for an
            // event and only occasionally writes. The first two writes go out
            // at once so the client has something to read; after that the
            // handler waits, which is where a dead client goes unnoticed.
            for (int n = 1; n <= 20 && !(honour && context.CancellationToken.IsCancellationRequested); n++)
            {
                await responses.WriteAsync(new GetResponse($"PAY-{n:000}", "captured"));

                await Task.Delay(n <= 2 ? 10 : 300,
                    honour ? context.CancellationToken : CancellationToken.None);
            }
        }
        catch (Exception)
        {
            // A write to a dead stream eventually throws - but only when the
            // handler gets round to writing.
        }

        SubscribeEndedAtMs = (int)clock.Elapsed.TotalMilliseconds;
    }
}
