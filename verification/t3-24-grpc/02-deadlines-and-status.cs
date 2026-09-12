// 02-deadlines-and-status.cs — Deadlines travel with the call, status codes are
// the error channel, and interceptors are where cross-cutting concerns go.
//
// Run:  dotnet run 02-deadlines-and-status.cs -c Release
//
// EXACT vs RATIO: the status codes and counts are deterministic. The timings
// are machine-specific; the claims are which rows are fast and which are slow.

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
builder.WebHost.ConfigureKestrel(o =>
    o.ConfigureEndpointDefaults(e => e.Protocols = HttpProtocols.Http2));
builder.Logging.ClearProviders();

builder.Services.AddGrpc(options => options.Interceptors.Add<ServerLogInterceptor>());

var app = builder.Build();
app.MapGrpcService<Payments>();

await app.StartAsync();

using var channel = GrpcChannel.ForAddress(app.Urls.First());

Console.WriteLine("Deadlines, status codes, and interceptors");
Console.WriteLine();

await Deadlines(channel);
await WhatTheServerSees(channel);
await StatusCodes(channel);
await Interceptors(channel);

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Deadlines(GrpcChannel channel)
{
    Console.WriteLine("1. A deadline is part of the call, not a client-side timer");
    Console.WriteLine();

    CallInvoker invoker = channel.CreateCallInvoker();

    Console.WriteLine("   deadline   server takes   client waited   outcome");
    Console.WriteLine("   --------   ------------   -------------   -------");

    // The deadline is an absolute moment, so it has to be computed when the
    // call is made rather than when the list is built - a list built up front
    // would have deadlines that expired while earlier rows were running.
    foreach ((string label, int? budgetMs) in new (string, int?)[]
    {
        ("none", null),
        ("500 ms", 500),
        ("100 ms", 100)
    })
    {
        var clock = Stopwatch.StartNew();
        string outcome;

        try
        {
            var options = budgetMs is null
                ? new CallOptions()
                : new CallOptions(deadline: DateTime.UtcNow.AddMilliseconds(budgetMs.Value));

            SlowResponse response = await invoker.AsyncUnaryCall(
                Contract.Slow, null, options, new SlowRequest(300));

            outcome = $"OK, server worked {response.WorkedMs} ms";
        }
        catch (RpcException exception)
        {
            outcome = $"{exception.StatusCode}";
        }

        Console.WriteLine($"   {label,-10} {"300 ms",-14} {clock.Elapsed.TotalMilliseconds,10:0} ms   {outcome}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE 100 ms DEADLINE FAILED BEFORE THE SERVER HAD FINISHED, and the");
    Console.WriteLine("   500 ms one did not. The client did not wait for the server and then");
    Console.WriteLine("   give up - the call was cancelled, on both sides. (The wall-clock");
    Console.WriteLine("   figures include channel setup on the first call, which is why the");
    Console.WriteLine("   numbers are a little above the budgets.)");
    Console.WriteLine();
    Console.WriteLine("   AND THE DEADLINE IS SENT TO THE SERVER, in a header, as part of the");
    Console.WriteLine("   request. That is the difference between a gRPC deadline and an HTTP");
    Console.WriteLine("   client timeout, and it is worth being precise about:");
    Console.WriteLine();
    Console.WriteLine("     AN HTTP TIMEOUT IS A DECISION THE CALLER MAKES ALONE. The server");
    Console.WriteLine("     never learns about it and carries on working on a response nobody");
    Console.WriteLine("     will read.");
    Console.WriteLine();
    Console.WriteLine("     A gRPC DEADLINE IS TOLD TO THE SERVER, which can see how long it has");
    Console.WriteLine("     left, cancel its own work, and pass a shortened deadline to whatever");
    Console.WriteLine("     it calls next. The whole chain gets to know.");
    Console.WriteLine();
    Console.WriteLine("   THAT PROPAGATION IS THE SINGLE BEST THING ABOUT gRPC FOR SERVICE-TO-");
    Console.WriteLine("   SERVICE CALLS, and it is switched off by default, because the default");
    Console.WriteLine("   deadline is none at all.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatTheServerSees(GrpcChannel channel)
{
    Console.WriteLine("2. What the server does with the deadline it was given");
    Console.WriteLine();

    CallInvoker invoker = channel.CreateCallInvoker();

    Console.WriteLine("   the handler                       client saw          server kept working for");
    Console.WriteLine("   -----------                       ----------          -----------------------");

    foreach ((string label, bool honours) in
        new[] { ("ignores context.CancellationToken", false), ("honours it", true) })
    {
        Payments.Reset();

        var clock = Stopwatch.StartNew();
        string outcome;

        try
        {
            await invoker.AsyncUnaryCall(
                Contract.Slow,
                null,
                new CallOptions(deadline: DateTime.UtcNow.AddMilliseconds(100)),
                new SlowRequest(400, HonourCancellation: honours));

            outcome = "OK";
        }
        catch (RpcException exception)
        {
            outcome = $"{exception.StatusCode} at {clock.Elapsed.TotalMilliseconds:0} ms";
        }

        // Long enough for the abandoned handler to finish if it is going to.
        await Task.Delay(600);

        Console.WriteLine($"   {label,-33} {outcome,-19} {Payments.LastWorkedMs} ms");
    }

    Console.WriteLine();
    Console.WriteLine("   BOTH CLIENTS GAVE UP AT 100 ms. One server stopped at 100 and the other");
    Console.WriteLine("   worked for the full 400, producing a response that was thrown away by");
    Console.WriteLine("   the framework because there was nothing left to send it to.");
    Console.WriteLine();
    Console.WriteLine("   THE DEADLINE ARRIVES AS context.CancellationToken, AND IT IS");
    Console.WriteLine("   COOPERATIVE. gRPC cancels a token; your handler decides whether to");
    Console.WriteLine("   look. Work that never observes it runs to completion, and the only");
    Console.WriteLine("   thing the deadline achieved was to stop the client waiting.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS FINE FOR ONE CALL AND IS NOT FINE UNDER LOAD. If callers are");
    Console.WriteLine("   giving up at 100 ms and retrying, and the server is doing 400 ms of");
    Console.WriteLine("   work per attempt regardless, then every retry adds work while removing");
    Console.WriteLine("   nothing - and the server gets slower exactly as the retries increase.");
    Console.WriteLine("   THAT IS THE INCIDENT IN THE NEXT FILE.");
    Console.WriteLine();
    Console.WriteLine("   SO: PASS context.CancellationToken INTO EVERYTHING - the database call,");
    Console.WriteLine("   the HTTP call, the next gRPC call. It is the same rule as the stopping");
    Console.WriteLine("   token in a background worker, and it is the same failure when it is");
    Console.WriteLine("   forgotten.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task StatusCodes(GrpcChannel channel)
{
    Console.WriteLine("3. How an error becomes a status code");
    Console.WriteLine();

    CallInvoker invoker = channel.CreateCallInvoker();

    Console.WriteLine("   what the handler did                     client saw           detail");
    Console.WriteLine("   --------------------                     ----------           ------");

    foreach ((string label, string mode) in new[]
    {
        ("returned normally", "ok"),
        ("threw RpcException(NotFound)", "notfound"),
        ("threw ArgumentException", "argument"),
        ("threw OperationCanceledException", "cancelled")
    })
    {
        string status;
        string detail;

        try
        {
            await invoker.AsyncUnaryCall(
                Contract.Fail, null, new CallOptions(), new FailRequest(mode));

            status = "OK";
            detail = "";
        }
        catch (RpcException exception)
        {
            status = exception.StatusCode.ToString();
            detail = exception.Status.Detail.Length > 30
                ? exception.Status.Detail[..30] + "..."
                : exception.Status.Detail;
        }

        Console.WriteLine($"   {label,-40} {status,-20} {detail}");
    }

    Console.WriteLine();
    Console.WriteLine("   ONLY RpcException CARRIES ITS MEANING ACROSS. Everything else becomes");
    Console.WriteLine("   Unknown, with a detail string that is whatever the exception's message");
    Console.WriteLine("   happened to be.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS TWO PROBLEMS IN ONE:");
    Console.WriteLine();
    Console.WriteLine("     THE CALLER CANNOT DISTINGUISH ANYTHING. 'Unknown' covers a validation");
    Console.WriteLine("     failure, a bug, a full disk and a null reference. A caller deciding");
    Console.WriteLine("     whether to retry has nothing to decide on - and retrying a validation");
    Console.WriteLine("     failure is pointless while retrying a transient fault is correct.");
    Console.WriteLine();
    Console.WriteLine("     AND THE DETAIL STRING IS AN EXCEPTION MESSAGE, which is written for");
    Console.WriteLine("     an operator with a stack trace and now crosses a service boundary.");
    Console.WriteLine("     It is the same leak as an unhandled exception rendering into an HTTP");
    Console.WriteLine("     response body.");
    Console.WriteLine();
    Console.WriteLine("   SO MAP DELIBERATELY, AT THE EDGE OF THE SERVICE. The gRPC status codes");
    Console.WriteLine("   worth knowing map closely onto HTTP ones:");
    Console.WriteLine();
    Console.WriteLine("     InvalidArgument     400   the request is malformed");
    Console.WriteLine("     NotFound            404   the thing does not exist");
    Console.WriteLine("     AlreadyExists       409   it does, and you asked to create it");
    Console.WriteLine("     PermissionDenied    403   authenticated, not allowed");
    Console.WriteLine("     Unauthenticated     401   not authenticated");
    Console.WriteLine("     FailedPrecondition  422   valid, but not now");
    Console.WriteLine("     ResourceExhausted   429   rate limited or out of quota");
    Console.WriteLine("     Unavailable         503   try again, probably later");
    Console.WriteLine("     DeadlineExceeded    504   ran out of time");
    Console.WriteLine("     Internal            500   our bug");
    Console.WriteLine();
    Console.WriteLine("   THE DISTINCTION THAT MATTERS MOST TO A CALLER IS Unavailable AGAINST");
    Console.WriteLine("   Internal. The first says 'the same request may work in a moment' and is");
    Console.WriteLine("   safe to retry; the second says 'this failed because of us and will fail");
    Console.WriteLine("   again'. Sending Unknown for both means every caller either retries");
    Console.WriteLine("   everything or retries nothing.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Interceptors(GrpcChannel channel)
{
    Console.WriteLine("4. Interceptors, on both sides");
    Console.WriteLine();

    ClientLogInterceptor.Calls.Clear();
    ServerLogInterceptor.Calls.Clear();

    CallInvoker invoker = channel.Intercept(new ClientLogInterceptor());

    await invoker.AsyncUnaryCall(Contract.Slow, null, new CallOptions(), new SlowRequest(10));

    try
    {
        await invoker.AsyncUnaryCall(
            Contract.Fail, null, new CallOptions(), new FailRequest("notfound"));
    }
    catch (RpcException)
    {
    }

    await Task.Delay(200);

    Console.WriteLine("   client interceptor saw:");

    foreach (string entry in ClientLogInterceptor.Calls)
    {
        Console.WriteLine($"     {entry}");
    }

    Console.WriteLine();
    Console.WriteLine("   server interceptor saw:");

    foreach (string entry in ServerLogInterceptor.Calls)
    {
        Console.WriteLine($"     {entry}");
    }

    Console.WriteLine();
    Console.WriteLine("   AN INTERCEPTOR IS MIDDLEWARE FOR gRPC CALLS, and the two sides do");
    Console.WriteLine("   different jobs:");
    Console.WriteLine();
    Console.WriteLine("     ON THE SERVER, it is where authentication, logging, metrics and");
    Console.WriteLine("     exception mapping belong - the same list as ASP.NET Core middleware,");
    Console.WriteLine("     and for the same reason: it is the one place that sees every call.");
    Console.WriteLine("     Mapping domain exceptions to status codes in a server interceptor is");
    Console.WriteLine("     the fix for section 3, applied once rather than in every handler.");
    Console.WriteLine();
    Console.WriteLine("     ON THE CLIENT, it is where you put the things every outgoing call");
    Console.WriteLine("     needs: a correlation id header, a default deadline, retry policy,");
    Console.WriteLine("     and the metrics that tell you what your dependencies are doing.");
    Console.WriteLine();
    Console.WriteLine("   THE CLIENT-SIDE DEFAULT DEADLINE IS THE ONE TO WRITE FIRST. Section 1");
    Console.WriteLine("   showed the default is no deadline; an interceptor that adds one to");
    Console.WriteLine("   every call without one turns 'somebody forgot' from a hung thread into");
    Console.WriteLine("   a DeadlineExceeded, everywhere, in about ten lines.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
public record SlowRequest(int WorkMs, bool HonourCancellation = true);

public record SlowResponse(int WorkedMs);

public record FailRequest(string Mode);

// ---------------------------------------------------------------------------
public static class Contract
{
    public static Marshaller<T> Json<T>() => Marshallers.Create(
        value => JsonSerializer.SerializeToUtf8Bytes(value),
        bytes => JsonSerializer.Deserialize<T>(bytes)!);

    const string Service = "ledger.Payments";

    public static readonly Method<SlowRequest, SlowResponse> Slow =
        new(MethodType.Unary, Service, "Slow", Json<SlowRequest>(), Json<SlowResponse>());

    public static readonly Method<FailRequest, SlowResponse> Fail =
        new(MethodType.Unary, Service, "Fail", Json<FailRequest>(), Json<SlowResponse>());

    public static void BindService(ServiceBinderBase binder, PaymentsBase? service)
    {
        binder.AddMethod(Slow, service is null
            ? null
            : new UnaryServerMethod<SlowRequest, SlowResponse>(service.Slow));

        binder.AddMethod(Fail, service is null
            ? null
            : new UnaryServerMethod<FailRequest, SlowResponse>(service.Fail));
    }
}

// ---------------------------------------------------------------------------
[BindServiceMethod(typeof(Contract), nameof(Contract.BindService))]
public abstract class PaymentsBase
{
    public virtual Task<SlowResponse> Slow(SlowRequest request, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));

    public virtual Task<SlowResponse> Fail(FailRequest request, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));
}

// ---------------------------------------------------------------------------
public sealed class Payments : PaymentsBase
{
    public static int LastWorkedMs;

    public static void Reset() => LastWorkedMs = 0;

    public override async Task<SlowResponse> Slow(SlowRequest request, ServerCallContext context)
    {
        var clock = Stopwatch.StartNew();

        try
        {
            // The deadline arrives as context.CancellationToken. Passing it on
            // is what makes the deadline mean anything to this handler.
            await Task.Delay(request.WorkMs,
                request.HonourCancellation ? context.CancellationToken : CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
        }

        LastWorkedMs = (int)clock.Elapsed.TotalMilliseconds;

        return new SlowResponse(LastWorkedMs);
    }

    public override Task<SlowResponse> Fail(FailRequest request, ServerCallContext context) =>
        request.Mode switch
        {
            "notfound" => throw new RpcException(new Status(
                StatusCode.NotFound, "No payment with that id.")),

            "argument" => throw new ArgumentException(
                "amountMinor must be positive (Parameter 'amountMinor')"),

            "cancelled" => throw new OperationCanceledException("gave up"),

            _ => Task.FromResult(new SlowResponse(0))
        };
}

// ---------------------------------------------------------------------------
public sealed class ClientLogInterceptor : Interceptor
{
    public static readonly List<string> Calls = [];

    public override AsyncUnaryCall<TResponse> AsyncUnaryCall<TRequest, TResponse>(
        TRequest request,
        ClientInterceptorContext<TRequest, TResponse> context,
        AsyncUnaryCallContinuation<TRequest, TResponse> continuation)
    {
        lock (Calls)
        {
            Calls.Add($"calling {context.Method.FullName}");
        }

        AsyncUnaryCall<TResponse> call = continuation(request, context);

        return new AsyncUnaryCall<TResponse>(
            HandleResponse(call.ResponseAsync, context.Method.FullName),
            call.ResponseHeadersAsync,
            call.GetStatus,
            call.GetTrailers,
            call.Dispose);
    }

    static async Task<TResponse> HandleResponse<TResponse>(Task<TResponse> inner, string method)
    {
        try
        {
            TResponse response = await inner;

            lock (Calls)
            {
                Calls.Add($"  {method} returned OK");
            }

            return response;
        }
        catch (RpcException exception)
        {
            lock (Calls)
            {
                Calls.Add($"  {method} returned {exception.StatusCode}");
            }

            throw;
        }
    }
}

// ---------------------------------------------------------------------------
public sealed class ServerLogInterceptor : Interceptor
{
    public static readonly List<string> Calls = [];

    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request,
        ServerCallContext context,
        UnaryServerMethod<TRequest, TResponse> continuation)
    {
        try
        {
            TResponse response = await continuation(request, context);

            lock (Calls)
            {
                Calls.Add($"{context.Method} -> OK");
            }

            return response;
        }
        catch (RpcException exception)
        {
            lock (Calls)
            {
                Calls.Add($"{context.Method} -> {exception.StatusCode}");
            }

            throw;
        }
    }
}
