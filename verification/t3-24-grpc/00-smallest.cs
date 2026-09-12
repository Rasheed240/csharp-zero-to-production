// 00-smallest.cs — One gRPC call, with every piece the code generator would
// normally hide written out by hand.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every value here is deterministic.
//
// A NOTE ON THE MARSHALLER: real gRPC uses Protocol Buffers, and the .proto
// compiler writes the contract below for you. This file uses JSON as the
// marshaller instead, so that the whole contract is visible in one file with
// no build step. Everything else - the HTTP/2 framing, the status codes, the
// deadlines, the four call types - is exactly the real thing.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Grpc.AspNetCore.Server@2.71.0
#:package Grpc.Net.Client@2.71.0

using System.Text.Json;
using Grpc.Core;
using Grpc.Net.Client;
using Microsoft.AspNetCore.Server.Kestrel.Core;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");

// gRPC requires HTTP/2. Over plain HTTP this has to be said explicitly,
// because without TLS there is no protocol negotiation to do it for you.
builder.WebHost.ConfigureKestrel(o =>
    o.ConfigureEndpointDefaults(e => e.Protocols = HttpProtocols.Http2));

builder.Logging.ClearProviders();
builder.Services.AddGrpc();

var app = builder.Build();
app.MapGrpcService<Payments>();

// An ordinary JSON endpoint on the same server, for comparison. It cannot be
// reached over HTTP/1.1 here because the endpoint only speaks HTTP/2.
app.MapGet("/v1/payments/{id}", (string id) => Results.Ok(new { id, status = "captured" }));

await app.StartAsync();

Console.WriteLine("One gRPC call");
Console.WriteLine();

using var channel = GrpcChannel.ForAddress(app.Urls.First());
CallInvoker invoker = channel.CreateCallInvoker();

GetPaymentResponse response = await invoker.AsyncUnaryCall(
    Contract.Get, host: null, new CallOptions(), new GetPaymentRequest("PAY-001"));

Console.WriteLine($"   request    GetPaymentRequest {{ Id = \"PAY-001\" }}");
Console.WriteLine($"   response   {response}");
Console.WriteLine();

// What happens when the server says no.
Console.WriteLine("   AND WHEN THE SERVER REFUSES:");
Console.WriteLine();

foreach (string id in new[] { "PAY-001", "PAY-404", "" })
{
    string outcome;

    try
    {
        GetPaymentResponse result = await invoker.AsyncUnaryCall(
            Contract.Get, null, new CallOptions(), new GetPaymentRequest(id));

        outcome = $"OK   {result.Status}";
    }
    catch (RpcException exception)
    {
        outcome = $"{exception.StatusCode}   \"{exception.Status.Detail}\"";
    }

    Console.WriteLine($"   Id = \"{id,-8}\"   {outcome}");
}

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   FOUR THINGS THAT LINE OF SETUP HAS ALREADY DECIDED:");
Console.WriteLine();
Console.WriteLine("     1. THE TRANSPORT IS HTTP/2, AND IT IS NOT OPTIONAL. gRPC needs");
Console.WriteLine("        multiplexed streams and trailers, and HTTP/1.1 has neither. Anything");
Console.WriteLine("        between the client and the server that does not speak HTTP/2 end to");
Console.WriteLine("        end - an old load balancer, a proxy that downgrades - breaks it");
Console.WriteLine("        entirely rather than making it slow.");
Console.WriteLine();
Console.WriteLine("     2. THE CONTRACT IS A SEPARATE ARTEFACT FROM THE CODE. Contract.Get");
Console.WriteLine("        below is what a .proto file compiles into: a service name, a method");
Console.WriteLine("        name, and a pair of serialisers. Both sides refer to it, and neither");
Console.WriteLine("        side infers it from the other.");
Console.WriteLine();
Console.WriteLine("     3. ERRORS ARE STATUS CODES, NOT EXCEPTIONS OR BODIES. NotFound above is");
Console.WriteLine("        a value in a trailer, mapped to an RpcException at the client. There");
Console.WriteLine("        is no 404 and no error object in the response - the response is the");
Console.WriteLine("        response type or nothing at all.");
Console.WriteLine();
Console.WriteLine("     4. THE CALL HAS NO DEADLINE. new CallOptions() means 'wait forever',");
Console.WriteLine("        and forever is the default in every gRPC client. That is the subject");
Console.WriteLine("        of this module's incident.");
Console.WriteLine();
Console.WriteLine("   AND ONE THING WORTH SEEING NOW: THE CONTRACT BELOW IS ABOUT TWENTY LINES.");
Console.WriteLine("   In a real project the .proto compiler writes it, which is a convenience");
Console.WriteLine("   and also why most people have never looked at it. Everything gRPC does");
Console.WriteLine("   that surprises them is visible in those twenty lines.");

// ---------------------------------------------------------------------------
public record GetPaymentRequest(string Id);

public record GetPaymentResponse(string Id, string Status, long AmountMinor);

// ---------------------------------------------------------------------------
// This is what protoc generates. Written by hand so that it can be read.
public static class Contract
{
    // A marshaller is a pair of functions: object to bytes, bytes to object.
    // Protobuf is the usual choice; nothing about gRPC requires it.
    public static Marshaller<T> Json<T>() => Marshallers.Create(
        value => JsonSerializer.SerializeToUtf8Bytes(value),
        bytes => JsonSerializer.Deserialize<T>(bytes)!);

    // A method is a full name, a kind, and the two marshallers. The full name
    // becomes the HTTP/2 path: /ledger.Payments/Get
    public static readonly Method<GetPaymentRequest, GetPaymentResponse> Get =
        new(MethodType.Unary, "ledger.Payments", "Get",
            Json<GetPaymentRequest>(), Json<GetPaymentResponse>());

    // The binder is called once with a null service to discover the methods,
    // then again per instance to attach the handlers. The generated code has
    // the same null check.
    public static void BindService(ServiceBinderBase binder, PaymentsBase? service) =>
        binder.AddMethod(Get, service is null
            ? null
            : new UnaryServerMethod<GetPaymentRequest, GetPaymentResponse>(service.Get));
}

// ---------------------------------------------------------------------------
// The generated base class. Your service inherits from it and overrides what
// it implements; anything left alone answers Unimplemented.
[BindServiceMethod(typeof(Contract), nameof(Contract.BindService))]
public abstract class PaymentsBase
{
    public virtual Task<GetPaymentResponse> Get(
        GetPaymentRequest request, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, "Not implemented."));
}

// ---------------------------------------------------------------------------
// The only part you would normally write.
public sealed class Payments : PaymentsBase
{
    public override Task<GetPaymentResponse> Get(
        GetPaymentRequest request, ServerCallContext context)
    {
        if (string.IsNullOrEmpty(request.Id))
        {
            throw new RpcException(new Status(
                StatusCode.InvalidArgument, "Id is required."));
        }

        if (request.Id == "PAY-404")
        {
            throw new RpcException(new Status(
                StatusCode.NotFound, $"No payment with id '{request.Id}'."));
        }

        return Task.FromResult(new GetPaymentResponse(request.Id, "captured", 4999));
    }
}
