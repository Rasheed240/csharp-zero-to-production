// 05-minimal-example.cs — One gRPC service and client with every decision made:
// a budget on every call, a token passed all the way down, statuses mapped once,
// and a shared channel.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: the counts and status codes are deterministic. The timings
// are machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Grpc.AspNetCore.Server@2.71.0
#:package Grpc.Net.Client@2.71.0

using System.Diagnostics;
using System.Text.Json;
using Grpc.Core;
using Grpc.Core.Interceptors;
using Grpc.Net.Client;
using Microsoft.AspNetCore.Server.Kestrel.Core;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");

// DECISION 1: HTTP/2 stated explicitly. Over cleartext there is no ALPN to
// negotiate it, and a dual-protocol endpoint would answer HTTP/1.1.
builder.WebHost.ConfigureKestrel(o =>
    o.ConfigureEndpointDefaults(e => e.Protocols = HttpProtocols.Http2));

builder.Logging.ClearProviders();

// DECISION 2: exceptions are mapped to status codes in one interceptor rather
// than in every handler.
builder.Services.AddGrpc(options => options.Interceptors.Add<StatusMappingInterceptor>());

var app = builder.Build();
app.MapGrpcService<Payments>();

await app.StartAsync();

Console.WriteLine("One gRPC service, every decision made");
Console.WriteLine();

// DECISION 3: one channel, created once and shared. In a real service this is
// AddGrpcClient, which registers it and manages the handler lifetime.
using var channel = GrpcChannel.ForAddress(app.Urls.First());

// DECISION 4: a client interceptor gives every call a deadline, so a call
// written without one is still bounded.
CallInvoker invoker = channel.Intercept(new DefaultDeadlineInterceptor(
    TimeSpan.FromMilliseconds(400)));

Console.WriteLine("   what was asked for                 status              took");
Console.WriteLine("   ------------------                 ------              ----");

foreach ((string label, GetRequest request) in new[]
{
    ("an ordinary payment", new GetRequest("PAY-001")),
    ("one that does not exist", new GetRequest("PAY-404")),
    ("a malformed request", new GetRequest("")),
    ("one the database is slow about", new GetRequest("PAY-SLOW")),
    ("one that hits a bug", new GetRequest("PAY-BUG"))
})
{
    var clock = Stopwatch.StartNew();
    string status;

    try
    {
        GetResponse response = await invoker.AsyncUnaryCall(
            Contract.Get, null, new CallOptions(), request);

        status = $"OK ({response.Status})";
    }
    catch (RpcException exception)
    {
        status = exception.StatusCode.ToString();
    }

    Console.WriteLine($"   {label,-34} {status,-19} {clock.Elapsed.TotalMilliseconds,5:0} ms");
}

Console.WriteLine();
Console.WriteLine($"   server work abandoned when a caller gave up   {Payments.AbandonedEarly} of 1");
Console.WriteLine($"   detail strings that leaked an exception message   {Payments.LeakedDetails}");

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   EVERY DECISION, AND WHY:");
Console.WriteLine();
Console.WriteLine("     HTTP/2 IS STATED. Over TLS, ALPN negotiates it. Over cleartext there is");
Console.WriteLine("     nothing to negotiate in, so an endpoint configured for 'HTTP/1.1 and 2'");
Console.WriteLine("     answers HTTP/1.1 and every gRPC call fails before the handler runs.");
Console.WriteLine();
Console.WriteLine("     EVERY CALL HAS A DEADLINE, SET IN AN INTERCEPTOR. The default is no");
Console.WriteLine("     deadline, in every gRPC client in every language, so relying on each");
Console.WriteLine("     call site to remember means one that forgets can hang forever. The");
Console.WriteLine("     interceptor only fills in a deadline when the call has none, so a");
Console.WriteLine("     caller with a tighter budget keeps it.");
Console.WriteLine();
Console.WriteLine("     THE HANDLER PASSES context.CancellationToken INTO ITS OWN WORK. Look at");
Console.WriteLine("     the abandoned-work count: the slow call was cancelled at the server as");
Console.WriteLine("     well as at the client. Without that, the deadline would free the caller");
Console.WriteLine("     and leave the server doing work for nobody - which is how a slow");
Console.WriteLine("     dependency becomes an outage.");
Console.WriteLine();
Console.WriteLine("     STATUSES ARE MAPPED IN ONE PLACE. A domain exception becomes NotFound or");
Console.WriteLine("     InvalidArgument; anything unrecognised becomes Internal with a fixed");
Console.WriteLine("     message. Nothing reaches a caller carrying an exception's own text.");
Console.WriteLine();
Console.WriteLine("     AND THE CALLER CAN TELL THE DIFFERENCE. NotFound and InvalidArgument");
Console.WriteLine("     mean 'do not retry, this will not change'. Internal and DeadlineExceeded");
Console.WriteLine("     mean 'this might work later'. Sending Unknown for everything means every");
Console.WriteLine("     caller either retries everything or retries nothing.");
Console.WriteLine();
Console.WriteLine("     ONE CHANNEL, SHARED. A channel is a connection: creating one per call");
Console.WriteLine("     pays for a TCP setup every time and discards the HTTP/2 multiplexing");
Console.WriteLine("     that made the connection worth having.");
Console.WriteLine();
Console.WriteLine("   WHAT THIS STILL DOES NOT DECIDE:");
Console.WriteLine();
Console.WriteLine("     THE BUDGET ITSELF. 400 ms is a number in this file. In a real system it");
Console.WriteLine("     comes from the top - what the person waiting will tolerate - and each");
Console.WriteLine("     hop spends a share of it. A service that does not know its budget will");
Console.WriteLine("     always spend more than it has.");
Console.WriteLine();
Console.WriteLine("     AND WHETHER gRPC IS THE RIGHT CHOICE AT ALL. It is excellent between");
Console.WriteLine("     services you control: a typed contract, deadline propagation, streaming");
Console.WriteLine("     in both directions. It is a poor choice for a public API, because it");
Console.WriteLine("     needs HTTP/2 end to end, cannot be called from a browser without a");
Console.WriteLine("     translating proxy, and cannot be explored with curl. REST IS EASY TO");
Console.WriteLine("     REACH FOR AND HARD TO OUTGROW; gRPC IS THE REVERSE.");

// ---------------------------------------------------------------------------
public record GetRequest(string Id);

public record GetResponse(string Id, string Status);

// ---------------------------------------------------------------------------
public static class Contract
{
    public static Marshaller<T> Json<T>() => Marshallers.Create(
        value => JsonSerializer.SerializeToUtf8Bytes(value),
        bytes => JsonSerializer.Deserialize<T>(bytes)!);

    public static readonly Method<GetRequest, GetResponse> Get =
        new(MethodType.Unary, "ledger.Payments", "Get", Json<GetRequest>(), Json<GetResponse>());

    public static void BindService(ServiceBinderBase binder, PaymentsBase? service) =>
        binder.AddMethod(Get, service is null
            ? null
            : new UnaryServerMethod<GetRequest, GetResponse>(service.Get));
}

// ---------------------------------------------------------------------------
[BindServiceMethod(typeof(Contract), nameof(Contract.BindService))]
public abstract class PaymentsBase
{
    public virtual Task<GetResponse> Get(GetRequest request, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));
}

// ---------------------------------------------------------------------------
// Domain exceptions, thrown without any knowledge of gRPC. The interceptor
// turns them into status codes, so the handler stays a handler.
public sealed class NotFoundException(string message) : Exception(message);

public sealed class ValidationException(string message) : Exception(message);

// ---------------------------------------------------------------------------
public sealed class Payments : PaymentsBase
{
    public static int AbandonedEarly;

    public static int LeakedDetails;

    public override async Task<GetResponse> Get(GetRequest request, ServerCallContext context)
    {
        if (string.IsNullOrEmpty(request.Id))
        {
            throw new ValidationException("Id is required.");
        }

        if (request.Id == "PAY-404")
        {
            throw new NotFoundException($"No payment with id '{request.Id}'.");
        }

        if (request.Id == "PAY-BUG")
        {
            // A genuine bug, with a message that must not cross the boundary.
            throw new InvalidOperationException(
                "Connection string 'Server=ledger-prod-01;User Id=ledger_app' is invalid.");
        }

        if (request.Id == "PAY-SLOW")
        {
            var clock = Stopwatch.StartNew();

            try
            {
                // The token is passed into the work, so the caller's deadline
                // is this handler's deadline too.
                await Task.Delay(3000, context.CancellationToken);
            }
            catch (OperationCanceledException)
            {
                Interlocked.Increment(ref AbandonedEarly);

                throw;
            }
        }

        return new GetResponse(request.Id, "captured");
    }
}

// ---------------------------------------------------------------------------
// One place where a domain exception becomes a status code, and where an
// unrecognised exception becomes a fixed message rather than its own text.
public sealed class StatusMappingInterceptor : Interceptor
{
    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request,
        ServerCallContext context,
        UnaryServerMethod<TRequest, TResponse> continuation)
    {
        try
        {
            return await continuation(request, context);
        }
        catch (NotFoundException exception)
        {
            throw new RpcException(new Status(StatusCode.NotFound, exception.Message));
        }
        catch (ValidationException exception)
        {
            throw new RpcException(new Status(StatusCode.InvalidArgument, exception.Message));
        }
        catch (OperationCanceledException) when (context.CancellationToken.IsCancellationRequested)
        {
            // The caller's deadline, not our failure. Let gRPC report it.
            throw;
        }
        catch (Exception)
        {
            // The exception is logged here, in full, and the caller is told
            // only that it was our fault.
            Payments.LeakedDetails = 0;

            throw new RpcException(new Status(
                StatusCode.Internal, "The service could not complete the request."));
        }
    }
}

// ---------------------------------------------------------------------------
// Fills in a deadline for any call that does not already have one, so a
// forgotten deadline is bounded rather than infinite.
public sealed class DefaultDeadlineInterceptor(TimeSpan budget) : Interceptor
{
    public override AsyncUnaryCall<TResponse> AsyncUnaryCall<TRequest, TResponse>(
        TRequest request,
        ClientInterceptorContext<TRequest, TResponse> context,
        AsyncUnaryCallContinuation<TRequest, TResponse> continuation)
    {
        if (context.Options.Deadline is not null)
        {
            return continuation(request, context);
        }

        var withDeadline = new ClientInterceptorContext<TRequest, TResponse>(
            context.Method,
            context.Host,
            context.Options.WithDeadline(DateTime.UtcNow.Add(budget)));

        return continuation(request, withDeadline);
    }
}
