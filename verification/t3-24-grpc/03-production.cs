// 03-production.cs — The retry storm that a missing deadline made possible.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: the counts are deterministic. The timings are
// machine-specific; the claims are the ratios between the runs.

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

Console.WriteLine("An incident: 'the pricing service is down and we cannot tell why'");
Console.WriteLine();

TheIncident();
await NoDeadline();
await DeadlineIgnored();
await DeadlineHonoured();
WhatToWatch();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. What was seen");
    Console.WriteLine();
    Console.WriteLine("   Ledger's checkout calls a pricing service over gRPC. Pricing calls a");
    Console.WriteLine("   currency service. All three had been stable for a year.");
    Console.WriteLine();
    Console.WriteLine("     16:02   The currency service starts responding slowly - a database");
    Console.WriteLine("             index was dropped by a migration. Not down: slow, at about");
    Console.WriteLine("             two seconds instead of twenty milliseconds.");
    Console.WriteLine();
    Console.WriteLine("     16:04   Pricing's latency rises to match. Checkout's rises to match");
    Console.WriteLine("             that. Everything is slow and nothing has failed.");
    Console.WriteLine();
    Console.WriteLine("     16:07   Checkout's callers start timing out at their own five-second");
    Console.WriteLine("             HTTP timeout and retrying. Request volume into checkout");
    Console.WriteLine("             doubles, then triples.");
    Console.WriteLine();
    Console.WriteLine("     16:09   Pricing runs out of threads. Checkout runs out of threads.");
    Console.WriteLine("             Both are now failing every request, including the ones that");
    Console.WriteLine("             never needed currency at all.");
    Console.WriteLine();
    Console.WriteLine("     16:31   The index is rebuilt. Currency recovers in seconds. Pricing");
    Console.WriteLine("             and checkout do not - they are still working through a");
    Console.WriteLine("             backlog of abandoned calls. Recovery needs a restart of");
    Console.WriteLine("             both.");
    Console.WriteLine();
    Console.WriteLine("   ONE SLOW DEPENDENCY TOOK DOWN TWO SERVICES THAT MOSTLY DO NOT USE IT,");
    Console.WriteLine("   and outlived the fault by twenty minutes. Nothing in any of the three");
    Console.WriteLine("   services was doing anything wrong except waiting.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task NoDeadline()
{
    Console.WriteLine("2. What 'no deadline' means when a dependency is slow");
    Console.WriteLine();

    var (app, address) = await StartCurrency(slowMs: 2000);
    using var channel = GrpcChannel.ForAddress(address);
    CallInvoker invoker = channel.CreateCallInvoker();

    // Twenty callers, as a burst of traffic would produce.
    var clock = Stopwatch.StartNew();

    Task<PriceResponse>[] calls = [.. Enumerable.Range(0, 20).Select(_ =>
        InvokeAsync(invoker, new CallOptions()))];

    // How long before any of them gives up? None of them will.
    await Task.Delay(700);

    int completed = calls.Count(c => c.IsCompleted);

    Console.WriteLine($"   callers                       20");
    Console.WriteLine($"   dependency takes              2000 ms");
    Console.WriteLine($"   after 700 ms, completed       {completed}");
    Console.WriteLine($"   after 700 ms, still waiting   {20 - completed}");

    await Task.WhenAll(calls);

    Console.WriteLine($"   all finished after            {clock.Elapsed.TotalMilliseconds:0} ms");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   TWENTY CALLS HELD FOR TWO SECONDS EACH, and every one of them is a");
    Console.WriteLine("   thread, a connection and a request-scoped object graph on the calling");
    Console.WriteLine("   service, doing nothing.");
    Console.WriteLine();
    Console.WriteLine("   new CallOptions() MEANS NO DEADLINE, and that is the default in every");
    Console.WriteLine("   gRPC client in every language. It is a defensible default for a library");
    Console.WriteLine("   - it cannot know what your budget is - and it is the wrong value for");
    Console.WriteLine("   every call you will ever write.");
    Console.WriteLine();
    Console.WriteLine("   WHAT MAKES IT AN OUTAGE RATHER THAN A SLOWDOWN IS THE ARITHMETIC. A");
    Console.WriteLine("   service handling 200 requests a second, each holding a slot for 20 ms,");
    Console.WriteLine("   needs about 4 concurrent slots. At 2 seconds per call it needs 400. It");
    Console.WriteLine("   does not have 400, so it queues, so latency rises further, so callers");
    Console.WriteLine("   time out and retry, so the arrival rate goes up.");
    Console.WriteLine();
    Console.WriteLine("   THAT LOOP IS THE INCIDENT. The dependency was slow; the ABSENCE OF A");
    Console.WriteLine("   DEADLINE is what turned slow into unbounded, and unbounded is what");
    Console.WriteLine("   exhausts a service.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task DeadlineIgnored()
{
    Console.WriteLine("3. A deadline the server does not honour");
    Console.WriteLine();
    Console.WriteLine("   The obvious fix is a deadline on the call. It is half the fix, and the");
    Console.WriteLine("   missing half is on the other side.");
    Console.WriteLine();

    var (app, address) = await StartCurrency(slowMs: 2000, honourCancellation: false);
    using var channel = GrpcChannel.ForAddress(address);
    CallInvoker invoker = channel.CreateCallInvoker();

    Currency.Reset();

    var clock = Stopwatch.StartNew();

    Task[] calls = [.. Enumerable.Range(0, 20).Select(async _ =>
    {
        try
        {
            await InvokeAsync(invoker,
                new CallOptions(deadline: DateTime.UtcNow.AddMilliseconds(200)));
        }
        catch (RpcException)
        {
        }
    })];

    await Task.WhenAll(calls);

    double clientFreedAt = clock.Elapsed.TotalMilliseconds;

    // Wait for the abandoned server work to drain.
    await Task.Delay(2500);

    Console.WriteLine($"   callers freed after           {clientFreedAt:0} ms");
    Console.WriteLine($"   calls the server started      {Currency.Started}");
    Console.WriteLine($"   calls the server ran to the end {Currency.Completed}");
    Console.WriteLine($"   server work done for nobody     {Currency.Completed} of {Currency.Started}");
    Console.WriteLine($"   total server work               {Currency.TotalWorkMs} ms");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE CALLERS WERE FREED IN 200 ms AND THE SERVER DID EVERY SECOND OF THE");
    Console.WriteLine("   WORK ANYWAY. The deadline protected the caller and did nothing for the");
    Console.WriteLine("   service that was already struggling.");
    Console.WriteLine();
    Console.WriteLine("   AND NOW THE RETRY MAKES IT WORSE RATHER THAN BETTER. A caller that");
    Console.WriteLine("   gives up at 200 ms and retries produces a second call while the first");
    Console.WriteLine("   is still running. At two seconds per unit of work and a 200 ms");
    Console.WriteLine("   deadline, a single caller retrying can have TEN CONCURRENT UNITS OF");
    Console.WriteLine("   WORK on the server, none of which anybody is waiting for.");
    Console.WriteLine();
    Console.WriteLine("   THIS IS THE STEP PEOPLE MISS. 'We added timeouts' feels like the fix");
    Console.WriteLine("   and, on its own, it converts a service that is slow into a service that");
    Console.WriteLine("   is slow AND doing several times more work than it is being asked for.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task DeadlineHonoured()
{
    Console.WriteLine("4. The whole fix");
    Console.WriteLine();

    var (app, address) = await StartCurrency(slowMs: 2000, honourCancellation: true);
    using var channel = GrpcChannel.ForAddress(address);
    CallInvoker invoker = channel.CreateCallInvoker();

    Currency.Reset();

    var clock = Stopwatch.StartNew();

    Task[] calls = [.. Enumerable.Range(0, 20).Select(async _ =>
    {
        try
        {
            await InvokeAsync(invoker,
                new CallOptions(deadline: DateTime.UtcNow.AddMilliseconds(200)));
        }
        catch (RpcException)
        {
        }
    })];

    await Task.WhenAll(calls);

    double freed = clock.Elapsed.TotalMilliseconds;

    await Task.Delay(2500);

    Console.WriteLine($"   callers freed after             {freed:0} ms");
    Console.WriteLine($"   calls the server started        {Currency.Started}");
    Console.WriteLine($"   calls the server ran to the end {Currency.Completed}");
    Console.WriteLine($"   total server work               {Currency.TotalWorkMs} ms");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE SERVER STOPPED WHEN THE CALLERS DID. Compare the total work with");
    Console.WriteLine("   the previous section: the same twenty calls, the same deadline, and a");
    Console.WriteLine("   fraction of the work, because the handler observed the token gRPC");
    Console.WriteLine("   cancelled for it.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX HAS THREE PARTS AND ALL THREE ARE NECESSARY:");
    Console.WriteLine();
    Console.WriteLine("     A DEADLINE ON EVERY CALL. Best set once, in a client interceptor, so");
    Console.WriteLine("     that a call somebody wrote without thinking about it still has one.");
    Console.WriteLine();
    Console.WriteLine("     context.CancellationToken PASSED INTO EVERYTHING the handler does -");
    Console.WriteLine("     the database query, the HTTP call, the next gRPC call. This is what");
    Console.WriteLine("     turns the deadline from a client-side timer into a budget the whole");
    Console.WriteLine("     chain respects.");
    Console.WriteLine();
    Console.WriteLine("     AND A SHORTER DEADLINE AT EACH HOP. If checkout gives pricing 800 ms,");
    Console.WriteLine("     pricing must give currency less than that - it needs time to do its");
    Console.WriteLine("     own work and to answer. gRPC propagates the deadline automatically,");
    Console.WriteLine("     so a handler that passes context.CancellationToken on is already");
    Console.WriteLine("     bounded by its caller's budget; setting an explicitly shorter one is");
    Console.WriteLine("     how you leave room to return a useful failure rather than being cut");
    Console.WriteLine("     off mid-sentence.");
    Console.WriteLine();
    Console.WriteLine("   AND THE DEADLINE SHOULD COME FROM THE TOP. The person waiting is a");
    Console.WriteLine("   customer looking at a checkout page, and their patience - two seconds,");
    Console.WriteLine("   say - is the only budget that means anything. Every service in the");
    Console.WriteLine("   chain is spending a share of it, and a service that does not know its");
    Console.WriteLine("   budget will always spend more than it has.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatToWatch()
{
    Console.WriteLine("5. What to watch");
    Console.WriteLine();
    Console.WriteLine("   CALLS WITH NO DEADLINE, AS A COUNT. A client interceptor can see");
    Console.WriteLine("   whether options.Deadline is null and count it. Anything above zero is a");
    Console.WriteLine("   call that can hang forever, and the number should be a build failure");
    Console.WriteLine("   rather than a graph.");
    Console.WriteLine();
    Console.WriteLine("   DeadlineExceeded AS ITS OWN SERIES, separate from other failures. It");
    Console.WriteLine("   means something different from Unavailable or Internal: your budget was");
    Console.WriteLine("   too small or their service was too slow, and it is the earliest signal");
    Console.WriteLine("   that a dependency is drifting.");
    Console.WriteLine();
    Console.WriteLine("   SERVER WORK THAT OUTLIVED ITS CALLER. Compare handler duration against");
    Console.WriteLine("   the deadline the request carried. Work continuing past a cancelled");
    Console.WriteLine("   deadline is the section 3 failure, and it is invisible in every");
    Console.WriteLine("   ordinary latency metric because those only count calls somebody was");
    Console.WriteLine("   waiting for.");
    Console.WriteLine();
    Console.WriteLine("   CONCURRENT IN-FLIGHT CALLS PER DEPENDENCY. This is the number that");
    Console.WriteLine("   actually predicts exhaustion, and it rises before latency does. A");
    Console.WriteLine("   bulkhead - a hard cap on concurrent calls to one dependency - turns");
    Console.WriteLine("   'the whole service is out of threads' into 'calls to currency are being");
    Console.WriteLine("   rejected', which is a much better outage.");
    Console.WriteLine();
    Console.WriteLine("   AND THE REVIEW QUESTION: WHAT IS THIS CALL'S BUDGET, AND WHO SET IT? If");
    Console.WriteLine("   the answer is 'there isn't one', the call can hang for as long as the");
    Console.WriteLine("   slowest thing downstream of it - which is not a number anybody in your");
    Console.WriteLine("   organisation controls.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<PriceResponse> InvokeAsync(CallInvoker invoker, CallOptions options) =>
    await invoker.AsyncUnaryCall(Contract.Convert, null, options, new PriceRequest(4999, "USD"));

// ---------------------------------------------------------------------------
static async Task<(WebApplication App, string Address)> StartCurrency(
    int slowMs, bool honourCancellation = true)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.WebHost.ConfigureKestrel(o =>
        o.ConfigureEndpointDefaults(e => e.Protocols = HttpProtocols.Http2));
    builder.Logging.ClearProviders();
    builder.Services.AddGrpc();
    builder.Services.AddSingleton(new CurrencyOptions(slowMs, honourCancellation));

    var app = builder.Build();
    app.MapGrpcService<Currency>();

    await app.StartAsync();

    return (app, app.Urls.First());
}

// ---------------------------------------------------------------------------
public record PriceRequest(long AmountMinor, string Currency);

public record PriceResponse(long AmountMinor);

public record CurrencyOptions(int SlowMs, bool HonourCancellation);

// ---------------------------------------------------------------------------
public static class Contract
{
    public static Marshaller<T> Json<T>() => Marshallers.Create(
        value => JsonSerializer.SerializeToUtf8Bytes(value),
        bytes => JsonSerializer.Deserialize<T>(bytes)!);

    public static readonly Method<PriceRequest, PriceResponse> Convert =
        new(MethodType.Unary, "ledger.Currency", "Convert",
            Json<PriceRequest>(), Json<PriceResponse>());

    public static void BindService(ServiceBinderBase binder, CurrencyBase? service) =>
        binder.AddMethod(Convert, service is null
            ? null
            : new UnaryServerMethod<PriceRequest, PriceResponse>(service.Convert));
}

// ---------------------------------------------------------------------------
[BindServiceMethod(typeof(Contract), nameof(Contract.BindService))]
public abstract class CurrencyBase
{
    public virtual Task<PriceResponse> Convert(PriceRequest request, ServerCallContext context) =>
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));
}

// ---------------------------------------------------------------------------
public sealed class Currency(CurrencyOptions options) : CurrencyBase
{
    public static int Started;

    public static int Completed;

    public static int TotalWorkMs;

    public static void Reset()
    {
        Started = 0;
        Completed = 0;
        TotalWorkMs = 0;
    }

    public override async Task<PriceResponse> Convert(
        PriceRequest request, ServerCallContext context)
    {
        Interlocked.Increment(ref Started);

        var clock = Stopwatch.StartNew();

        try
        {
            await Task.Delay(options.SlowMs, options.HonourCancellation
                ? context.CancellationToken
                : CancellationToken.None);

            Interlocked.Increment(ref Completed);
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            Interlocked.Add(ref TotalWorkMs, (int)clock.Elapsed.TotalMilliseconds);
        }

        return new PriceResponse(request.AmountMinor);
    }
}
