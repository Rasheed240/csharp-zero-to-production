CSPREP.module({
  id: "t3-24-grpc",
  minutes: 55,
  updated: "2026-09-07",
  summary: "A dropped database index made one service slow, and two services that barely use it ran out of threads and stayed down for twenty minutes after the fault was fixed - because a gRPC call has no deadline by default and an unbounded wait is what exhausts a service. Measured: 40,052 ms of server work done for nobody against 4,777 ms once the handler observed its token; every call type including the bidirectional interleaving; a renamed field silently becoming zero; and an endpoint configured for 'HTTP/1.1 and 2' refusing every gRPC call because cleartext has no ALPN to negotiate in.",
  terms: ["gRPC", "Protocol Buffers", "marshaller", "unary", "server streaming", "client streaming",
    "bidirectional streaming", "deadline", "deadline propagation", "status code", "RpcException",
    "interceptor", "channel", "HTTP/2", "field number"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Services call other services. Over JSON and HTTP that means agreeing on a URL shape, hand-writing a
  client, and hoping both sides understand the same fields — which the previous modules have shown is a
  contract nobody checks. gRPC starts from the opposite end: define the messages and the methods in a
  schema, generate both sides from it, and get a typed call.</p>

  <p>Ledger's checkout calls a pricing service over gRPC, which calls a currency service. At 16:02 a
  migration dropped an index and currency went from twenty milliseconds to two seconds. Not down —
  slow.</p>

  <p>By 16:09 both pricing and checkout had run out of threads and were failing every request, including
  the ones that never touch currency. The index was rebuilt at 16:31 and currency recovered in seconds;
  the other two needed restarting.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   callers                       20
   dependency takes              2000 ms
   after 700 ms, completed       0
   after 700 ms, still waiting   20
   all finished after            2641 ms</code></pre>

  <div class="callout callout--note">
    <h4>Nothing there was doing anything wrong except waiting</h4>
    <p><code>new CallOptions()</code> means no deadline, and that is the default in every gRPC client in
    every language. A defensible default for a library, which cannot know your budget — and the wrong
    value for every call you will ever write.</p>
  </div>
</section>

<section id="what-grpc-is">
  <h2>What gRPC is, without the code generator</h2>

  <p class="define"><span class="define__term">gRPC</span> A remote procedure call framework: you
  declare methods and message types, and both sides get generated code that makes a network call look
  like a method call.</p>

  <p class="define"><span class="define__term">Protocol Buffers</span> The schema language and binary
  format gRPC uses by default. A <code>.proto</code> file defines the messages and the service, and a
  compiler generates the client and server code from it.</p>

  <p class="define"><span class="define__term">Marshaller</span> A pair of functions — object to bytes,
  bytes to object. Protobuf is the usual one; nothing about gRPC requires it.</p>

  <p class="define"><span class="define__term">Channel</span> A long-lived connection to a server, over
  which many calls are multiplexed. Not a per-call object.</p>

  <p class="define"><span class="define__term">Trailer</span> An HTTP/2 header sent <em>after</em> the
  response body. gRPC puts the status code in one, because a streaming call has written its body long
  before it knows how it ended.</p>

  <p>A real service starts from a schema file, which both sides compile:</p>

  <pre data-lang="text" data-title="payments.proto - what the code generator reads"><code>syntax = "proto3";

package ledger;

service Payments {
  rpc Get (GetPaymentRequest) returns (GetPaymentResponse);
}

message GetPaymentRequest {
  string id = 1;
}

message GetPaymentResponse {
  string id = 1;
  string status = 2;
  int64 amount_minor = 3;
}</code></pre>

  <p>Two things in there matter more than they look. <code>ledger.Payments</code> plus the method name
  becomes the HTTP/2 path, so a service moved to another package is a different service as far as every
  caller is concerned. And <strong>the numbers are the wire format</strong> — the names exist for you,
  not for the network, which is a trap this module comes back to.</p>

  <p>The generated code is what most people never look at, and everything surprising about gRPC is
  visible in it. Written by hand, the whole contract is about twenty lines:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// ---------------------------------------------------------------------------
public static class Contract
{
    public static Marshaller&lt;T&gt; Json&lt;T&gt;() =&gt; Marshallers.Create(
        value =&gt; JsonSerializer.SerializeToUtf8Bytes(value),
        bytes =&gt; JsonSerializer.Deserialize&lt;T&gt;(bytes)!);

    public static readonly Method&lt;GetRequest, GetResponse&gt; Get =
        new(MethodType.Unary, "ledger.Payments", "Get", Json&lt;GetRequest&gt;(), Json&lt;GetResponse&gt;());

    public static void BindService(ServiceBinderBase binder, PaymentsBase? service) =&gt;
        binder.AddMethod(Get, service is null
            ? null
            : new UnaryServerMethod&lt;GetRequest, GetResponse&gt;(service.Get));
}

// ---------------------------------------------------------------------------
[BindServiceMethod(typeof(Contract), nameof(Contract.BindService))]
public abstract class PaymentsBase
{
    public virtual Task&lt;GetResponse&gt; Get(GetRequest request, ServerCallContext context) =&gt;
        throw new RpcException(new Status(StatusCode.Unimplemented, ""));
}</code></pre>

  <p>A method is a full name, a kind, and two marshallers. The full name becomes the HTTP/2 path —
  <code>/ledger.Payments/Get</code>. The binder is called once with a null service to discover the
  methods and again per instance to attach handlers, which is why the generated code has that null
  check.</p>

  <p>The handler is an override on the generated base class. It takes the request and a
  <code>ServerCallContext</code>, which carries the metadata, the peer, and — the piece the rest of this
  module is about — the caller's cancellation token:</p>

  <pre data-lang="csharp" data-net="10" data-title="The handler, which is an override on the generated base"><code>public sealed class Payments(PaymentRepository repository) : PaymentsBase
{
    public override async Task&lt;GetResponse&gt; Get(GetRequest request, ServerCallContext context)
    {
        if (string.IsNullOrEmpty(request.Id))
        {
            throw new RpcException(new Status(StatusCode.InvalidArgument, "Id is required."));
        }

        Payment? payment = await repository.FindAsync(request.Id, context.CancellationToken);

        if (payment is null)
        {
            throw new RpcException(new Status(
                StatusCode.NotFound, $"No payment with id '{request.Id}'."));
        }

        return new GetResponse(payment.Id, payment.Status);
    }
}</code></pre>

  <p>Wiring it up is three lines, one of which is the line that costs people an afternoon:</p>

  <pre data-lang="csharp" data-net="10" data-title="Wiring, and the line that costs people an afternoon"><code>var builder = WebApplication.CreateBuilder();

// Over cleartext there is no TLS handshake to negotiate the protocol in, so an
// endpoint that is not told to speak HTTP/2 answers HTTP/1.1 and refuses every
// gRPC call before any handler runs.
builder.WebHost.ConfigureKestrel(options =&gt;
    options.ConfigureEndpointDefaults(endpoint =&gt;
        endpoint.Protocols = HttpProtocols.Http2));

builder.Services.AddGrpc();

var app = builder.Build();
app.MapGrpcService&lt;Payments&gt;();

await app.RunAsync();</code></pre>

  <p>And the caller holds a channel, not a request object:</p>

  <pre data-lang="csharp" data-net="10" data-title="The caller - one channel, many calls"><code>using var channel = GrpcChannel.ForAddress("https://pricing.internal");
var client = new Payments.PaymentsClient(channel);

GetResponse response = await client.GetAsync(new GetRequest { Id = "PAY-001" });</code></pre>

  <p>That last call compiles, runs, and is the single most dangerous line in the module — for a reason
  that is nowhere on its face. It has no deadline.</p>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   request    GetPaymentRequest { Id = "PAY-001" }
   response   GetPaymentResponse { Id = PAY-001, Status = captured, AmountMinor = 4999 }

   AND WHEN THE SERVER REFUSES:

   Id = "PAY-001 "   OK   captured
   Id = "PAY-404 "   NotFound   "No payment with id 'PAY-404'."
   Id = "        "   InvalidArgument   "Id is required."</code></pre>

  <div class="callout callout--note">
    <h4>About the code in this module</h4>
    <p>Real gRPC uses Protocol Buffers and the <code>.proto</code> compiler writes that contract for
    you. The verification files use JSON as the marshaller instead, so the whole contract fits in one
    file with no build step. Everything else — the HTTP/2 framing, the status codes, the deadlines, the
    four call types — is exactly the real thing.</p>
  </div>

  <h3>An analogy, and where it stops working</h3>

  <p>gRPC is a typed telephone extension between two offices. You dial a number that means a specific
  person, you speak a language you have both agreed in advance, and the call is either connected or it
  is not.</p>

  <p>Where it stops is that a telephone call ends when either party hangs up. A gRPC call, by default,
  <em>has no time limit at all</em> — the caller waits until the callee speaks, however long that takes.
  The whole of this module's incident is what happens when a large number of calls are all waiting for
  somebody who has become slow.</p>
</section>

<section id="call-types">
  <h2>The four call types</h2>

  <p class="define"><span class="define__term">Unary</span> One request, one response. What most methods
  are, and the only shape with a straightforward REST equivalent.</p>

  <p class="define"><span class="define__term">Server streaming</span> One request, many responses. A
  large result set, a subscription, or progress on a long operation.</p>

  <p class="define"><span class="define__term">Client streaming</span> Many requests, one response. An
  upload in pieces, acknowledged once at the end.</p>

  <p class="define"><span class="define__term">Bidirectional streaming</span> Both directions at once,
  with no pairing between them. A socket with types.</p>

  <pre data-lang="console" data-title="01-four-call-types.cs output"><code>   responses received      5
   first arrived after     18 ms
   last arrived after      277 ms</code></pre>

  <p>The first result arrived long before the last one. That is the point of server streaming: the
  caller starts work on item one while the server is still producing item five, and neither side ever
  holds the whole set.</p>

  <p>The handler writes instead of returning, and the token belongs in the enumeration as much as
  anywhere else:</p>

  <pre data-lang="csharp" data-net="10" data-title="Server streaming, from the handler side"><code>public override async Task List(
    ListRequest request,
    IServerStreamWriter&lt;GetResponse&gt; responses,
    ServerCallContext context)
{
    await foreach (Payment payment in
        repository.StreamAsync(request.MerchantId, context.CancellationToken))
    {
        await responses.WriteAsync(new GetResponse(payment.Id, payment.Status));
    }
}</code></pre>

  <p>And the caller reads until the stream ends. The call is disposable, and disposing it before the end
  is how a caller says "I have enough" — which the server learns as a cancellation:</p>

  <pre data-lang="csharp" data-net="10" data-title="Server streaming, from the caller side"><code>using AsyncServerStreamingCall&lt;GetResponse&gt; call = client.List(
    new ListRequest { MerchantId = "M-1" },
    new CallOptions(deadline: DateTime.UtcNow.AddSeconds(30)));

await foreach (GetResponse response in call.ResponseStream.ReadAllAsync(token))
{
    Handle(response);
}</code></pre>

  <p>Note the deadline on a stream that may legitimately run for thirty seconds. A deadline is not a
  latency target; it is the point past which nobody is waiting any more, and a subscription needs one as
  much as a lookup does.</p>

  <pre data-lang="console" data-title="01-four-call-types.cs output"><code>     sent     PAY-001
     received PAY-001
     sent     PAY-002
     received PAY-002
     sent     PAY-003
     received PAY-003</code></pre>

  <p>In the bidirectional case the responses arrived <em>between</em> the requests. The two streams are
  independent — there is no request/response pairing at all.</p>

  <p>Which makes the commonest bidirectional bug a shape problem rather than an API problem:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - deadlocks against a server that batches"><code>foreach (GetRequest request in requests)
{
    await call.RequestStream.WriteAsync(request);

    // The server is waiting for more input before it answers, and this loop is
    // waiting for an answer before it sends more. Neither side is at fault and
    // neither side moves.
    await call.ResponseStream.MoveNext(token);
}</code></pre>

  <p>The two streams are independent, so the code has to be too — read on one path, write on another,
  and join at the end:</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - the reader runs alongside the writer"><code>Task reader = Task.Run(async () =&gt;
{
    await foreach (GetResponse response in call.ResponseStream.ReadAllAsync(token))
    {
        Handle(response);
    }
});

foreach (GetRequest request in requests)
{
    await call.RequestStream.WriteAsync(request);
}

// Tells the server there is no more input. Without it, a server reading to the
// end of the request stream waits forever.
await call.RequestStream.CompleteAsync();

await reader;</code></pre>

  <div class="callout callout--gotcha">
    <h4>Forgetting <code>CompleteAsync</code> looks identical to a hang</h4>
    <p>The client has sent everything and is waiting for a response; the server is still reading the
    request stream, because nobody told it the input ended. Both processes are healthy, both are
    waiting, and the only symptom is a call that never returns — which, with no deadline, means
    forever.</p>
  </div>

  <p>A stream is also a held connection. A thousand subscribers is a thousand open HTTP/2 streams and a
  thousand handlers sitting in an await — cheaper than a thousand polling clients, not free, and a
  different capacity question from "requests per second".</p>

  <p>Bidirectional streaming invites comparison with SignalR rather than REST. gRPC is typed and
  contract-first; SignalR is browser-friendly, has transport fallback, and has groups and a backplane.
  <strong>Bidirectional gRPC for service-to-service, SignalR for browsers</strong> — a browser cannot
  speak gRPC without gRPC-Web and a translating proxy.</p>
</section>

<section id="deadlines">
  <h2>Deadlines, which are the thing gRPC does best and does not do by default</h2>

  <p class="define"><span class="define__term">Deadline</span> An absolute moment by which the call must
  finish, sent to the server as part of the request.</p>

  <pre data-lang="console" data-title="02-deadlines-and-status.cs output"><code>   deadline   server takes   client waited   outcome
   --------   ------------   -------------   -------
   none       300 ms                705 ms   OK, server worked 307 ms
   500 ms     300 ms                329 ms   OK, server worked 306 ms
   100 ms     300 ms                194 ms   DeadlineExceeded</code></pre>

  <p>The distinction from an HTTP client timeout is worth being precise about. <strong>An HTTP timeout
  is a decision the caller makes alone</strong> — the server never learns about it and carries on
  producing a response nobody will read. <strong>A gRPC deadline is told to the server</strong>, which
  can see how long it has left, cancel its own work, and pass a shortened deadline to whatever it calls
  next.</p>

  <p>That propagation is the single best thing about gRPC for service-to-service calls, and it is
  switched off by default because the default deadline is none at all. Setting one is a call option:</p>

  <pre data-lang="csharp" data-net="10" data-title="Setting a deadline on a call"><code>GetResponse response = await client.GetAsync(
    new GetRequest { Id = paymentId },
    new CallOptions(deadline: DateTime.UtcNow.AddMilliseconds(400)));</code></pre>

  <p>It is an absolute moment, not a duration, and that is deliberate: a moment survives being passed
  along. A service that received a deadline 300 ms from now and needs 50 ms of its own gives the next
  hop a deadline 250 ms from now, and the whole chain shares one budget rather than each hop starting a
  fresh timer.</p>

  <p>Which also means a clock difference between machines is a deadline difference. Skew of a few
  milliseconds is noise; a host whose clock has drifted by a minute will either time out instantly or
  never — a rare failure, and an unrecognisable one when it happens.</p>

  <h3>And the server has to be listening</h3>

  <pre data-lang="console" data-title="02-deadlines-and-status.cs output"><code>   the handler                       client saw          server kept working for
   -----------                       ----------          -----------------------
   ignores context.CancellationToken DeadlineExceeded at 171 ms 413 ms
   honours it                        DeadlineExceeded at 128 ms 123 ms</code></pre>

  <p>The deadline arrives as <code>context.CancellationToken</code>, and it is cooperative: gRPC cancels
  a token and your handler decides whether to look. The two versions differ by one argument:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the caller is freed and the work continues"><code>public override async Task&lt;GetResponse&gt; Get(GetRequest request, ServerCallContext context)
{
    // No token. The caller gave up 200 ms ago; this query has another 1.8
    // seconds to run, and it will run every one of them, holding a connection
    // and a thread for a response nobody will read.
    Payment payment = await repository.FindAsync(request.Id);

    return new GetResponse(payment.Id, payment.Status);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right - the caller's deadline is the handler's deadline"><code>public override async Task&lt;GetResponse&gt; Get(GetRequest request, ServerCallContext context)
{
    Payment payment = await repository.FindAsync(request.Id, context.CancellationToken);

    return new GetResponse(payment.Id, payment.Status);
}</code></pre>

  <p>So <strong>pass <code>context.CancellationToken</code> into everything</strong> — the database call,
  the HTTP call, the next gRPC call. It is the same rule as the stopping token in a background worker,
  and the same failure when forgotten.</p>

  <p>There is a second use for it that is worth knowing about, because it does not look like
  cancellation: <code>context.CancellationToken</code> is also how a handler discovers that a
  <em>streaming</em> client has gone away. Same token, same cooperative rule, and a leak rather than
  wasted work when it is ignored.</p>
</section>

<section id="status-codes">
  <h2>Status codes are the error channel</h2>

  <p class="define"><span class="define__term">Status code</span> One of about sixteen fixed values that
  every gRPC call ends with, sent in a trailer. There is no equivalent of inventing your own — the set
  is the same in every language.</p>

  <p class="define"><span class="define__term">Interceptor</span> A piece of code that wraps every call,
  on the client or the server. The gRPC equivalent of middleware, and the right place for anything that
  must be true of all calls rather than remembered at each one.</p>

  <pre data-lang="console" data-title="02-deadlines-and-status.cs output"><code>   what the handler did                     client saw           detail
   --------------------                     ----------           ------
   returned normally                        OK
   threw RpcException(NotFound)             NotFound             No payment with that id.
   threw ArgumentException                  Unknown              Exception was thrown by handle...
   threw OperationCanceledException         Unknown              Exception was thrown by handle...</code></pre>

  <p>Only <code>RpcException</code> carries its meaning across. Everything else becomes
  <code>Unknown</code>, with whatever the exception's message happened to be as the detail.</p>

  <div class="callout callout--warn">
    <h4>Which is two problems in one</h4>
    <p>The caller cannot distinguish a validation failure from a bug from a full disk, so a caller
    deciding whether to retry has nothing to decide on. And the detail string is an exception message —
    written for an operator with a stack trace — now crossing a service boundary.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Status</th><th>Roughly</th><th>Means</th></tr>
      </thead>
      <tbody>
        <tr><td><code>InvalidArgument</code></td><td>400</td><td>The request is malformed</td></tr>
        <tr><td><code>NotFound</code></td><td>404</td><td>The thing does not exist</td></tr>
        <tr><td><code>AlreadyExists</code></td><td>409</td><td>It does, and you asked to create it</td></tr>
        <tr><td><code>PermissionDenied</code></td><td>403</td><td>Authenticated, not allowed</td></tr>
        <tr><td><code>Unauthenticated</code></td><td>401</td><td>Not authenticated</td></tr>
        <tr><td><code>FailedPrecondition</code></td><td>422</td><td>Valid, but not now</td></tr>
        <tr><td><code>ResourceExhausted</code></td><td>429</td><td>Rate limited or out of quota</td></tr>
        <tr><td><code>Unavailable</code></td><td>503</td><td>Try again, probably later</td></tr>
        <tr><td><code>DeadlineExceeded</code></td><td>504</td><td>Ran out of time</td></tr>
        <tr><td><code>Internal</code></td><td>500</td><td>Our bug</td></tr>
      </tbody>
    </table>
  </div>

  <p>The distinction that matters most to a caller is <code>Unavailable</code> against
  <code>Internal</code>: the first says "the same request may work in a moment" and is safe to retry,
  the second says "this failed because of us and will fail again". Sending <code>Unknown</code> for both
  means every caller either retries everything or retries nothing.</p>

  <p>Map deliberately, once, in a server interceptor:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// One place where a domain exception becomes a status code, and where an
// unrecognised exception becomes a fixed message rather than its own text.
public sealed class StatusMappingInterceptor : Interceptor
{
    public override async Task&lt;TResponse&gt; UnaryServerHandler&lt;TRequest, TResponse&gt;(
        TRequest request,
        ServerCallContext context,
        UnaryServerMethod&lt;TRequest, TResponse&gt; continuation)
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
}</code></pre>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   what was asked for                 status              took
   ------------------                 ------              ----
   an ordinary payment                OK (captured)         243 ms
   one that does not exist            NotFound               12 ms
   a malformed request                InvalidArgument         1 ms
   one the database is slow about     DeadlineExceeded      446 ms
   one that hits a bug                Internal                3 ms

   server work abandoned when a caller gave up   1 of 1
   detail strings that leaked an exception message   0</code></pre>

  <p>The client-side interceptor is the piece worth copying, because it makes the default safe rather
  than relying on every call site to remember:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// Fills in a deadline for any call that does not already have one, so a
// forgotten deadline is bounded rather than infinite.
public sealed class DefaultDeadlineInterceptor(TimeSpan budget) : Interceptor
{
    public override AsyncUnaryCall&lt;TResponse&gt; AsyncUnaryCall&lt;TRequest, TResponse&gt;(
        TRequest request,
        ClientInterceptorContext&lt;TRequest, TResponse&gt; context,
        AsyncUnaryCallContinuation&lt;TRequest, TResponse&gt; continuation)
    {
        if (context.Options.Deadline is not null)
        {
            return continuation(request, context);
        }

        var withDeadline = new ClientInterceptorContext&lt;TRequest, TResponse&gt;(
            context.Method,
            context.Host,
            context.Options.WithDeadline(DateTime.UtcNow.Add(budget)));

        return continuation(request, withDeadline);
    }
}</code></pre>

  <p>It only fills in a deadline when the call has none, so a caller with a tighter budget keeps it.</p>

  <div class="callout callout--why">
    <h4>The budget comes from the top</h4>
    <p>400 ms is a number in a file. In a real system it comes from what the person waiting will
    tolerate — a customer looking at a checkout page — and each hop spends a share of it. A service that
    does not know its budget will always spend more than it has.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>No deadline</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - waits as long as the slowest thing downstream"><code>// new CallOptions() means no deadline. The call is bounded by nothing.
GetResponse response = await client.GetAsync(
    new GetRequest { Id = paymentId }, new CallOptions());</code></pre>

  <p>What makes it an outage rather than a slowdown is arithmetic. A service handling 200 requests a
  second at 20 ms each needs about 4 concurrent slots; at 2 seconds per call it needs 400. It does not
  have 400, so it queues, so latency rises, so callers time out and retry, so the arrival rate goes
  up.</p>

  <h3>A deadline the server does not honour</h3>

  <pre data-lang="console" data-title="03-production.cs output"><code>   deadline ignored by the handler:
   callers freed after             276 ms
   calls the server ran to the end 20 of 20
   total server work               40052 ms

   deadline honoured:
   callers freed after             244 ms
   calls the server ran to the end 0
   total server work               4777 ms</code></pre>

  <p>Eight times the work, for nobody. And now retries make it worse rather than better: a caller giving
  up at 200 ms and retrying against a two-second unit of work can have ten concurrent units in flight,
  none of which anybody is waiting for.</p>

  <div class="callout callout--gotcha">
    <h4>"We added timeouts" is half a fix</h4>
    <p>On its own it converts a service that is slow into a service that is slow <em>and</em> doing
    several times more work than it is being asked for.</p>
  </div>

  <h3>Letting exceptions become <code>Unknown</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the caller gets Unknown and a connection string"><code>public override async Task&lt;GetResponse&gt; Get(GetRequest request, ServerCallContext context)
{
    // Any exception from here becomes Unknown, with this message as the
    // detail, sent to whoever called.
    Payment payment = await repository.GetAsync(request.Id);

    return new GetResponse { Status = payment.Status };
}</code></pre>

  <h3>A channel per call</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the channel is managed        50 calls took
   --------------------------        -------------
   a new channel every call                  61 ms
   one channel, reused                       20 ms</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a new connection for every call"><code>public async Task&lt;string&gt; GetStatusAsync(string paymentId)
{
    // A TCP connection, an HTTP/2 negotiation and a TLS handshake, per call -
    // and a socket left in TIME_WAIT afterwards.
    using var channel = GrpcChannel.ForAddress("https://pricing.internal");
    var client = new Payments.PaymentsClient(channel);

    GetResponse response = await client.GetAsync(new GetRequest { Id = paymentId });

    return response.Status;
}</code></pre>

  <p>A channel is a connection: creating one opens a TCP connection, negotiates HTTP/2 and, over TLS,
  performs a handshake. Doing that per call also discards the multiplexing that made HTTP/2 worth
  adopting — one connection is meant to carry many concurrent streams.</p>

  <h3>Renumbering or renaming fields</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   what the client parses            Id          Amount   Status
   ----------------------            --          ------   ------
   the old message                   PAY-001     4999     captured
   the new message, renamed field    PAY-001     0        captured</code></pre>

  <p>Protobuf identifies fields by <em>number</em>, so renaming is free and renumbering is catastrophic
  — and renumbering looks like a tidy-up. Reordering fields in a <code>.proto</code> to group them
  nicely silently reassigns every value.</p>

  <p>Deleting a field has the same problem one release later, when somebody reuses its number for
  something unrelated and old clients read the new value as the old field. Which is what
  <code>reserved</code> is for:</p>

  <pre data-lang="text" data-title="payments.proto - deleting a field safely"><code>message GetPaymentResponse {
  // Field 3 held amount_minor. Never use the number or the name again.
  reserved 3;
  reserved "amount_minor";

  string id = 1;
  string status = 2;
  int64 amount_in_minor_units = 4;
}</code></pre>

  <h3>Assuming "HTTP/1.1 and 2" means both</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   endpoint speaks   gRPC call        an ordinary GET
   ---------------   ---------        ---------------
   HTTP/1.1 only     Internal         ok
   HTTP/2 only       OK               HttpRequestException
   HTTP/1.1 and 2    Internal         ok</code></pre>

  <p class="define"><span class="define__term">ALPN</span> Application-Layer Protocol Negotiation: an
  extension to the TLS handshake in which client and server agree which protocol to speak. It is how
  HTTP/2 gets chosen, and it exists only inside TLS.</p>

  <p>So over HTTPS, ALPN settles it during the handshake and a dual-protocol endpoint works. Over
  cleartext there is no handshake to negotiate in, so the endpoint has to guess, and it guesses
  HTTP/1.1. <strong>Over cleartext, say HTTP/2 explicitly</strong> — "it works in production but not in
  the compose file" is usually exactly this difference.</p>

  <h3>A streaming handler that ignores its token</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - nothing here asks whether anyone is listening"><code>public override async Task Subscribe(
    SubscribeRequest request,
    IServerStreamWriter&lt;PaymentEvent&gt; responses,
    ServerCallContext context)
{
    while (true)
    {
        // Blocks until something happens - which, for a quiet merchant, can be
        // hours. Nothing in this loop can notice a client that has gone.
        PaymentEvent next = await queue.ReadAsync();

        await responses.WriteAsync(next);
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right - the token is in the condition and in the wait"><code>while (!context.CancellationToken.IsCancellationRequested)
{
    PaymentEvent next = await queue.ReadAsync(context.CancellationToken);

    await responses.WriteAsync(next);
}</code></pre>

  <p>A handler that writes often discovers a disconnection on its next write, which is why the bug never
  shows up in testing. A real subscription mostly <em>waits</em>, and a client that crashes sends no
  cancellation — combine the two and nothing is left to notice.</p>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <ol>
    <li><strong>Is it HTTP/2 end to end?</strong> Not "does the service support HTTP/2" — every hop,
    including the TLS terminator, the load balancer and the mesh sidecar that nobody on your team
    configured. A gRPC failure that leaves every REST endpoint working is almost always this.</li>
    <li><strong>Read the status code before the message.</strong> <code>Unavailable</code> is a
    connection problem, <code>Unimplemented</code> is a name mismatch, <code>Internal</code> is
    theirs, <code>Unknown</code> means somebody forgot to map an exception.</li>
    <li><strong>For a slow cascade, look for calls with no deadline.</strong> A client interceptor can
    count them — anything above zero is a call that can hang forever.</li>
    <li><strong>Compare handler duration against the deadline the request carried.</strong> Work
    continuing past a cancelled deadline is invisible in ordinary latency metrics, because those only
    count calls somebody was waiting for.</li>
    <li><strong>For values that are silently zero, compare field numbers, not names.</strong> The wire
    carries numbers; the names are a local convenience.</li>
  </ol>

  <div class="callout callout--debug">
    <h4>Four things to watch</h4>
    <ul>
      <li><strong>Calls with no deadline, as a count.</strong> This should be a build failure rather
      than a graph.</li>
      <li><strong><code>DeadlineExceeded</code> as its own series</strong>, separate from other
      failures. It is the earliest signal that a dependency is drifting.</li>
      <li><strong>Server work that outlived its caller.</strong> The section-3 failure, and invisible
      everywhere else.</li>
      <li><strong>Concurrent in-flight calls per dependency.</strong> This predicts exhaustion, and it
      rises before latency does.</li>
    </ul>
  </div>

  <p class="define"><span class="define__term">Bulkhead</span> A hard cap on how many calls to one
  dependency may be in flight at once, with the rest rejected rather than queued. Named after a ship's
  compartments: the point is that flooding one does not sink the vessel.</p>

  <p>That last one is the cheapest structural fix in this module. A cap of, say, thirty concurrent calls
  to the currency service turns "checkout is out of threads and everything is down" into "calls to
  currency are being rejected", which is a smaller, more legible, more survivable outage — and one where
  the pages point at the service that actually broke.</p>

  <p>And the review question: <strong>what is this call's budget, and who set it?</strong> If the answer
  is "there isn't one", the call can hang for as long as the slowest thing downstream — which is not a
  number anybody in your organisation controls.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"gRPC has sensible timeouts"</h4>
    <p>The default is no deadline, in every client in every language.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A deadline protects the server"</h4>
    <p>It protects the caller. It protects the server only if the handler observes
    <code>context.CancellationToken</code> — measured at eight times the work when it does not.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"gRPC falls back to HTTP/1.1"</h4>
    <p>There is nothing to fall back to. It needs multiplexed streams and trailers, and HTTP/1.1 has
    neither.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Renaming a field is a breaking change"</h4>
    <p>In protobuf it is free — the name is never on the wire. <em>Renumbering</em> is the catastrophic
    one, and it looks like tidying up.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A channel is like an HttpRequestMessage"</h4>
    <p>It is like an <code>HttpClient</code>, or more precisely a connection: long-lived, shared,
    thread-safe.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"gRPC is faster, so it is better"</h4>
    <p>Binary encoding and HTTP/2 help, and the margin is usually smaller than the arguments about it.
    The real advantages are the typed contract and deadline propagation.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"We should use gRPC for our public API"</h4>
    <p>It needs HTTP/2 end to end, cannot be called from a browser without a translating proxy, and
    cannot be explored with curl. Excellent between services you control; a poor front door.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>An unbounded wait is how one slow service becomes several dead ones</h4>
    <p>Every waiting call holds a thread, a connection and a request-scoped object graph. A dependency
    going from 20 ms to 2 seconds multiplies the concurrency a caller needs by a hundred, and no service
    is provisioned for a hundred times its normal concurrency. The dependency was slow; <strong>the
    absence of a deadline is what turned slow into unbounded</strong>, and unbounded is what
    exhausts.</p>
  </div>

  <p>The second reason is that gRPC gives you the one tool that makes this tractable, and gives it to
  you switched off. A deadline that propagates means the whole chain shares one budget: checkout gives
  pricing 800 ms, pricing gives currency less, and every hop knows how long it has. Almost nothing else
  in ordinary service-to-service work offers that — an HTTP timeout is a private decision the callee
  never learns about.</p>

  <p class="define"><span class="define__term">gRPC-Web</span> A variant that a browser can speak,
  because it does not require trailers or full HTTP/2 control. It needs a proxy in front of the service
  to translate, and it does not support client or bidirectional streaming.</p>

  <p>That constraint is worth holding on to when someone proposes gRPC as the public API. The browser
  cannot call it directly; the answer is a translating proxy, half the call types, and a contract
  nobody outside your organisation can explore with curl.</p>

  <p>The third is the contract discipline. A <code>.proto</code> file is a schema that exists
  independently of both implementations, versioned, reviewable, and enforced by a compiler on both
  sides. That is a genuinely different position from an OpenAPI document generated after the fact — and
  it comes with its own trap, because the wire format is field numbers rather than names, and nothing
  about a tidy-up commit looks like a breaking change.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A gRPC service works from a test client on a developer machine. From the staging cluster every
    call fails immediately, before the handler runs. The service is definitely up — an HTTP health check
    answers fine.</p>
    <p>What is different?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   endpoint speaks   gRPC call        an ordinary GET
   ---------------   ---------        ---------------
   HTTP/1.1 only     Internal         ok
   HTTP/2 only       OK               HttpRequestException
   HTTP/1.1 and 2    Internal         ok</code></pre>
        <p>gRPC requires HTTP/2 and will not degrade — it needs multiplexed streams for the streaming
        call types and trailers for the status code.</p>
        <p>The third row is the one worth stopping on, because it is the configuration most people reach
        for and it did <em>not</em> work. Protocol negotiation lives in TLS: over HTTPS, ALPN settles it
        during the handshake, and over cleartext there is no handshake to negotiate in, so a
        dual-protocol endpoint guesses HTTP/1.1. <strong>Over cleartext, say HTTP/2 explicitly.</strong></p>
        <p>And the middle row shows the cost of saying it: an HTTP/2-only endpoint refuses the ordinary
        GET, which is why the health check kept working and proved nothing.</p>
        <p>What actually differs between a laptop and a cluster is everything in the middle — TLS
        termination that speaks HTTP/2 outward and HTTP/1.1 to your service, an older load balancer, a
        mesh sidecar. Each can break gRPC while leaving every REST endpoint working.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A service adds a field to a response message and renames another. The client is deployed a week
    later. Between the two deployments, some values silently become zero.</p>
    <p>Why, and what are the rules that prevent it?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   what the client parses            Id          Amount   Status
   ----------------------            --          ------   ------
   the old message                   PAY-001     4999     captured
   the new message, renamed field    PAY-001     0        captured</code></pre>
        <p>The client looked for a field that no longer exists, found nothing, and used the default. The
        <em>added</em> field was ignored harmlessly, which is the half people expect.</p>
        <p>With real protobuf the same rule applies with a different key, because fields are identified
        by <strong>number</strong>. So renaming a field is free — the name is never on the wire.
        Changing a field's number is catastrophic and looks like a tidy-up. Reusing the number of a
        deleted field is the same bug, later, which is why <code>.proto</code> has
        <code>reserved</code>.</p>
        <p>The deeper point is the same as for a queued job or a hub method: the message is a contract
        with a version skew. During any rolling deploy, old clients read new messages and new clients
        read old ones — both directions have to work, and "we deployed them together" is not something a
        distributed system lets you have.</p>
        <p><strong>Add fields, never renumber, never reuse a number, and reserve what you delete.</strong></p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>A service creates a <code>GrpcChannel</code> inside each request handler, uses it, and disposes
    it. Under load, latency rises and the machine accumulates connections in <code>TIME_WAIT</code>.</p>
    <p>What is wrong, and what is the right lifetime?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the channel is managed        50 calls took
   --------------------------        -------------
   a new channel every call                  61 ms
   one channel, reused                       20 ms</code></pre>
        <p>A channel is a connection, not a request object. Creating one opens a TCP connection,
        negotiates HTTP/2 and, over TLS, performs a handshake; disposing it closes all of that. Doing it
        per call pays that cost every time and leaves a socket in <code>TIME_WAIT</code>.</p>
        <p>It also throws away what HTTP/2 is for. One connection carries many concurrent streams, so a
        shared channel handles parallel calls on one socket — the multiplexing that made HTTP/2 worth
        adopting, discarded by creating a connection per call.</p>
        <pre data-lang="csharp" data-net="10" data-title="Right - registered once, with handler lifetime managed"><code>builder.Services.AddGrpcClient&lt;Payments.PaymentsClient&gt;(options =&gt;
    options.Address = new Uri("https://pricing.internal"));</code></pre>
        <p>This is the same mistake as <code>new HttpClient()</code> in a handler, with the same two
        symptoms: socket exhaustion under load, and a stale endpoint after a DNS change if you
        over-correct into one static connection that lives forever.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>A server-streaming subscription works in testing. In production the service accumulates memory
    and threads over hours, and restarting it fixes the problem for a while.</p>
    <p>Why does testing not show it?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   the handler                        client gone after   handler stopped after
   -----------                        -----------------   ---------------------
   ignores context.CancellationToken              43 ms   35 ms
   honours it                                     15 ms   11 ms</code></pre>
        <p>Both stopped, and they stopped for different reasons — which is the exercise. The handler
        that observes the token <em>was told</em>: disposing the call sends a cancellation and the loop
        exits at its next check. The other one found out by trying to write, because a write to a dead
        stream throws.</p>
        <p>Which is why the bug is invisible in testing: a test subscription produces as fast as it can,
        so the write-failure path fires almost at once and the missing token check costs nothing
        observable.</p>
        <p>Two things break that safety net in production, and neither is measured above — this is
        reasoning rather than measurement. <strong>A real subscription mostly waits</strong>, blocking
        on a queue read or an event, so it will not attempt a write and will not discover anything until
        something happens. And <strong>a client that vanishes sends no cancellation</strong> — a crashed
        process or a severed network sends nothing, and the server learns only when TCP gives up.</p>
        <p>Combine the two and nothing is left to notice. A long-lived stream needs the token observed
        in the loop condition, a maximum lifetime so clients reconnect periodically, and a cap on
        concurrent streams.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is a gRPC deadline, and how does it differ from an HTTP client timeout?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>An absolute moment sent to the server as part of the request. An
        HTTP timeout is private to the caller; a gRPC deadline is told to the callee, which can cancel
        its own work and pass a shortened deadline onward.</p></div>
      </details></li>

    <li><p>What is the default deadline?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>None, in every gRPC client in every language. A call with
        <code>new CallOptions()</code> waits as long as the slowest thing downstream of it.</p></div>
      </details></li>

    <li><p>A deadline is set and the server does the full work anyway. Why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The deadline arrives as <code>context.CancellationToken</code> and
        cancellation is cooperative. A handler that does not pass it into its own work runs to
        completion — measured at eight times the total server work.</p></div>
      </details></li>

    <li><p>Why does a slow dependency exhaust a caller rather than merely slowing it?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Concurrency needed is throughput times latency. Twenty milliseconds
        to two seconds multiplies the required concurrent slots by a hundred, which no service is
        provisioned for — so it queues, latency rises further, and callers retry.</p></div>
      </details></li>

    <li><p>Which exception type carries its meaning to the caller, and what happens to the rest?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>RpcException</code>. Everything else becomes
        <code>Unknown</code>, with the exception's own message as the detail — which both hides the
        cause and leaks internal text across a service boundary.</p></div>
      </details></li>

    <li><p>Which two status codes must a caller be able to distinguish, and why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>Unavailable</code> and <code>Internal</code>. The first is
        safe to retry, the second will fail again. Sending <code>Unknown</code> for both means every
        caller either retries everything or nothing.</p></div>
      </details></li>

    <li><p>Name the four call types and what each is for.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Unary — one and one, most methods. Server streaming — large result
        sets, subscriptions, progress. Client streaming — an upload in pieces acknowledged once.
        Bidirectional — a typed socket, for service-to-service.</p></div>
      </details></li>

    <li><p>What breaks a bidirectional call that reads and writes on the same sequential path?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Deadlock against a server that batches: it is not answering yet and
        you are not sending. The read has to run concurrently with the write.</p></div>
      </details></li>

    <li><p>In protobuf, which is safe — renaming a field or renumbering it?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Renaming is free, because the name is never on the wire.
        Renumbering silently reassigns every value, and it looks like a tidy-up.</p></div>
      </details></li>

    <li><p>Why does an endpoint configured for "HTTP/1.1 and 2" refuse gRPC over cleartext?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Protocol negotiation happens in the TLS handshake via ALPN. Without
        TLS there is nothing to negotiate in, so a dual-protocol endpoint guesses HTTP/1.1.</p></div>
      </details></li>

    <li><p>What is the correct lifetime of a <code>GrpcChannel</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Long-lived and shared. It is a connection, and it is thread-safe;
        creating one per call pays for a TCP setup each time and discards HTTP/2 multiplexing.</p></div>
      </details></li>

    <li><p>When is gRPC the wrong choice?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>As a public front door. It needs HTTP/2 end to end, browsers cannot
        call it without a translating proxy, and it cannot be explored with curl.</p></div>
      </details></li>
  </ol>
</section>
`
});
