// 01-four-call-types.cs — The four shapes a gRPC method can have, and what each
// one is actually for.
//
// Run:  dotnet run 01-four-call-types.cs -c Release
//
// EXACT vs RATIO: the counts and orderings are deterministic. The timings are
// machine-specific; the claims are the gaps between the rows.

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

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.WebHost.ConfigureKestrel(o =>
    o.ConfigureEndpointDefaults(e => e.Protocols = HttpProtocols.Http2));
builder.Logging.ClearProviders();
builder.Services.AddGrpc();

var app = builder.Build();
app.MapGrpcService<Payments>();

await app.StartAsync();

using var channel = GrpcChannel.ForAddress(app.Urls.First());
CallInvoker invoker = channel.CreateCallInvoker();

Console.WriteLine("The four call types");
Console.WriteLine();

await Unary(invoker);
await ServerStreaming(invoker);
await ClientStreaming(invoker);
await Bidirectional(invoker);

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Unary(CallInvoker invoker)
{
    Console.WriteLine("1. Unary - one request, one response");
    Console.WriteLine();

    GetResponse response = await invoker.AsyncUnaryCall(
        Contract.Get, null, new CallOptions(), new GetRequest("PAY-001"));

    Console.WriteLine($"   sent one request, got   {response}");
    Console.WriteLine();
    Console.WriteLine("   THIS IS THE ONE THAT LOOKS LIKE AN ORDINARY METHOD CALL, and it is");
    Console.WriteLine("   what the great majority of gRPC methods are. If you are choosing");
    Console.WriteLine("   between gRPC and REST, this is the shape you are comparing - the other");
    Console.WriteLine("   three have no straightforward REST equivalent, which is most of the");
    Console.WriteLine("   argument for gRPC when you need them.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ServerStreaming(CallInvoker invoker)
{
    Console.WriteLine("2. Server streaming - one request, many responses");
    Console.WriteLine();

    var clock = Stopwatch.StartNew();
    var arrivals = new List<double>();

    using AsyncServerStreamingCall<GetResponse> call = invoker.AsyncServerStreamingCall(
        Contract.List, null, new CallOptions(), new GetRequest("merchant-42"));

    await foreach (GetResponse payment in call.ResponseStream.ReadAllAsync())
    {
        arrivals.Add(clock.Elapsed.TotalMilliseconds);
    }

    Console.WriteLine($"   responses received      {arrivals.Count}");
    Console.WriteLine($"   first arrived after     {arrivals[0]:0} ms");
    Console.WriteLine($"   last arrived after      {arrivals[^1]:0} ms");
    Console.WriteLine();
    Console.WriteLine("   THE FIRST RESULT ARRIVED LONG BEFORE THE LAST ONE. That is the whole");
    Console.WriteLine("   point: the caller starts working on item one while the server is still");
    Console.WriteLine("   producing item five, and neither side ever holds the whole set.");
    Console.WriteLine();
    Console.WriteLine("   WHICH MAKES IT THE RIGHT SHAPE FOR THREE THINGS:");
    Console.WriteLine();
    Console.WriteLine("     A LARGE RESULT SET, where materialising all of it would cost memory");
    Console.WriteLine("     on both sides and delay the first row until the last one is ready.");
    Console.WriteLine();
    Console.WriteLine("     A SUBSCRIPTION - 'tell me about payments as they happen'. The call");
    Console.WriteLine("     stays open indefinitely and the server writes when it has something.");
    Console.WriteLine();
    Console.WriteLine("     PROGRESS. A long operation that reports as it goes, on the same call");
    Console.WriteLine("     that will eventually produce the result.");
    Console.WriteLine();
    Console.WriteLine("   AND THE THING TO WATCH FOR: A STREAM IS A HELD CONNECTION. A thousand");
    Console.WriteLine("   subscribers is a thousand open HTTP/2 streams and a thousand server-side");
    Console.WriteLine("   handlers sitting in an await. That is cheaper than a thousand polling");
    Console.WriteLine("   clients and it is not free, and it is a different capacity question");
    Console.WriteLine("   from 'requests per second'.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ClientStreaming(CallInvoker invoker)
{
    Console.WriteLine("3. Client streaming - many requests, one response");
    Console.WriteLine();

    using AsyncClientStreamingCall<GetRequest, SummaryResponse> call =
        invoker.AsyncClientStreamingCall(Contract.Import, null, new CallOptions());

    for (int n = 1; n <= 5; n++)
    {
        await call.RequestStream.WriteAsync(new GetRequest($"PAY-{n:000}"));
    }

    // The server does not answer until the client says it has finished.
    await call.RequestStream.CompleteAsync();

    SummaryResponse summary = await call.ResponseAsync;

    Console.WriteLine($"   sent 5 requests, got one response   {summary}");
    Console.WriteLine();
    Console.WriteLine("   THE RESPONSE CAME AFTER CompleteAsync, NOT BEFORE. The server is");
    Console.WriteLine("   reading a stream that has no end until the client says so, so the");
    Console.WriteLine("   single response is by definition the last thing that happens.");
    Console.WriteLine();
    Console.WriteLine("   THIS IS THE LEAST USED OF THE FOUR AND IT HAS ONE CLEAR USE: UPLOADING");
    Console.WriteLine("   SOMETHING LARGE IN PIECES, where you want one acknowledgement at the");
    Console.WriteLine("   end rather than one per piece - a batch import, a file, a stream of");
    Console.WriteLine("   telemetry summarised on arrival.");
    Console.WriteLine();
    Console.WriteLine("   IT IS ALSO A TRAP FOR RETRIES. A unary call can be retried by sending");
    Console.WriteLine("   it again. A client-streaming call that fails halfway has already");
    Console.WriteLine("   delivered some of its messages, and retrying means deciding what the");
    Console.WriteLine("   server should do with the ones it has - which is the same idempotency");
    Console.WriteLine("   question as anywhere else, arriving in a place people do not expect");
    Console.WriteLine("   it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Bidirectional(CallInvoker invoker)
{
    Console.WriteLine("4. Bidirectional - both sides, at once, in any order");
    Console.WriteLine();

    using AsyncDuplexStreamingCall<GetRequest, GetResponse> call =
        invoker.AsyncDuplexStreamingCall(Contract.Watch, null, new CallOptions());

    var log = new List<string>();

    // Read in the background while writing on this thread, which is what
    // 'bidirectional' means and is the only way to use it correctly.
    Task reading = Task.Run(async () =>
    {
        await foreach (GetResponse response in call.ResponseStream.ReadAllAsync())
        {
            lock (log)
            {
                log.Add($"received {response.Id}");
            }
        }
    });

    foreach (string id in new[] { "PAY-001", "PAY-002", "PAY-003" })
    {
        lock (log)
        {
            log.Add($"sent     {id}");
        }

        await call.RequestStream.WriteAsync(new GetRequest(id));
        await Task.Delay(80);
    }

    await call.RequestStream.CompleteAsync();
    await reading;

    Console.WriteLine("   the order things happened:");
    Console.WriteLine();

    foreach (string entry in log)
    {
        Console.WriteLine($"     {entry}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE RESPONSES ARRIVED BETWEEN THE REQUESTS, not after them. The two");
    Console.WriteLine("   streams are independent - there is no request/response pairing at all,");
    Console.WriteLine("   and the server may send zero, one or ten messages for any given");
    Console.WriteLine("   message it receives, or send without receiving anything.");
    Console.WriteLine();
    Console.WriteLine("   WHICH MAKES IT A SOCKET WITH TYPES, and the comparison worth drawing is");
    Console.WriteLine("   with SignalR rather than with REST. The differences are real:");
    Console.WriteLine();
    Console.WriteLine("     gRPC IS TYPED AND CONTRACT-FIRST. The messages are defined in a");
    Console.WriteLine("     schema both sides compile against, rather than named by string.");
    Console.WriteLine();
    Console.WriteLine("     SIGNALR IS BROWSER-FRIENDLY AND HAS A FALLBACK. gRPC needs HTTP/2 end");
    Console.WriteLine("     to end, and browsers cannot speak gRPC directly at all - they need");
    Console.WriteLine("     gRPC-Web and a proxy that translates.");
    Console.WriteLine();
    Console.WriteLine("     SIGNALR HAS GROUPS AND A BACKPLANE. gRPC has one stream between one");
    Console.WriteLine("     client and one server, and any fan-out is yours to build.");
    Console.WriteLine();
    Console.WriteLine("   SO: BIDIRECTIONAL STREAMING FOR SERVICE-TO-SERVICE, SIGNALR FOR");
    Console.WriteLine("   BROWSERS. Using either for the other's job is possible and is work you");
    Console.WriteLine("   did not need to do.");
    Console.WriteLine();
    Console.WriteLine("   AND THE MISTAKE THAT COSTS MOST: WRITING AND READING ON THE SAME");
    Console.WriteLine("   SEQUENTIAL PATH. Write, then await the read, then write again, is a");
    Console.WriteLine("   deadlock waiting for a server that batches - it is not answering yet,");
    Console.WriteLine("   and you are not sending. The read has to be concurrent with the write,");
    Console.WriteLine("   as above.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
public record GetRequest(string Id);

public record GetResponse(string Id, string Status);

public record SummaryResponse(int Count, string First, string Last);

// ---------------------------------------------------------------------------
public static class Contract
{
    public static Marshaller<T> Json<T>() => Marshallers.Create(
        value => JsonSerializer.SerializeToUtf8Bytes(value),
        bytes => JsonSerializer.Deserialize<T>(bytes)!);

    const string Service = "ledger.Payments";

    public static readonly Method<GetRequest, GetResponse> Get =
        new(MethodType.Unary, Service, "Get", Json<GetRequest>(), Json<GetResponse>());

    public static readonly Method<GetRequest, GetResponse> List =
        new(MethodType.ServerStreaming, Service, "List", Json<GetRequest>(), Json<GetResponse>());

    public static readonly Method<GetRequest, SummaryResponse> Import =
        new(MethodType.ClientStreaming, Service, "Import", Json<GetRequest>(), Json<SummaryResponse>());

    public static readonly Method<GetRequest, GetResponse> Watch =
        new(MethodType.DuplexStreaming, Service, "Watch", Json<GetRequest>(), Json<GetResponse>());

    public static void BindService(ServiceBinderBase binder, PaymentsBase? service)
    {
        binder.AddMethod(Get, service is null
            ? null
            : new UnaryServerMethod<GetRequest, GetResponse>(service.Get));

        binder.AddMethod(List, service is null
            ? null
            : new ServerStreamingServerMethod<GetRequest, GetResponse>(service.List));

        binder.AddMethod(Import, service is null
            ? null
            : new ClientStreamingServerMethod<GetRequest, SummaryResponse>(service.Import));

        binder.AddMethod(Watch, service is null
            ? null
            : new DuplexStreamingServerMethod<GetRequest, GetResponse>(service.Watch));
    }
}

// ---------------------------------------------------------------------------
[BindServiceMethod(typeof(Contract), nameof(Contract.BindService))]
public abstract class PaymentsBase
{
    public virtual Task<GetResponse> Get(GetRequest request, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));

    public virtual Task List(GetRequest request,
        IServerStreamWriter<GetResponse> responses, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));

    public virtual Task<SummaryResponse> Import(
        IAsyncStreamReader<GetRequest> requests, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));

    public virtual Task Watch(IAsyncStreamReader<GetRequest> requests,
        IServerStreamWriter<GetResponse> responses, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));
}

// ---------------------------------------------------------------------------
public sealed class Payments : PaymentsBase
{
    public override Task<GetResponse> Get(GetRequest request, ServerCallContext context) =>
        Task.FromResult(new GetResponse(request.Id, "captured"));

    public override async Task List(GetRequest request,
        IServerStreamWriter<GetResponse> responses, ServerCallContext context)
    {
        for (int n = 1; n <= 5; n++)
        {
            // Each write goes out as its own HTTP/2 data frame, immediately.
            await responses.WriteAsync(new GetResponse($"PAY-{n:000}", "captured"));
            await Task.Delay(60, context.CancellationToken);
        }
    }

    public override async Task<SummaryResponse> Import(
        IAsyncStreamReader<GetRequest> requests, ServerCallContext context)
    {
        var ids = new List<string>();

        await foreach (GetRequest request in requests.ReadAllAsync())
        {
            ids.Add(request.Id);
        }

        return new SummaryResponse(ids.Count, ids[0], ids[^1]);
    }

    public override async Task Watch(IAsyncStreamReader<GetRequest> requests,
        IServerStreamWriter<GetResponse> responses, ServerCallContext context)
    {
        // Reading and writing on the same call, with no pairing between them.
        await foreach (GetRequest request in requests.ReadAllAsync())
        {
            await responses.WriteAsync(new GetResponse(request.Id, "captured"));
        }
    }
}
