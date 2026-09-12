CSPREP.module({
  id: "t3-23-signalr",
  minutes: 55,
  updated: "2026-09-07",
  summary: "A live dashboard worked perfectly for four months and then started updating for roughly one merchant in three - because somebody scaled the API from one instance to three, and a server can only write to connections it holds. Measured: six of six dashboards updated on one server against three of six on two; a reconnect returning as a different connection with none of its groups; two messages lost in a 200 ms gap with nothing recorded anywhere; a 32 KB message that terminates the connection rather than failing the call; and four parallel hub invocations from one client taking 848 ms because the default is one at a time.",
  terms: ["hub", "hub connection", "transport", "WebSockets", "long polling", "connection id",
    "group", "backplane", "scale-out", "IUserIdProvider", "strongly typed hub",
    "OnConnectedAsync", "presence", "MaximumReceiveMessageSize", "fire and forget"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Some things the client needs to know about happen on the server, and the client has no way to know
  when to ask. A payment settles, a colleague edits the document, a background job finishes. Polling for
  them is a request every few seconds from every client, almost all of which return "nothing yet".</p>

  <p>SignalR is a persistent connection over which the server can speak first. Ledger's merchant
  dashboard used it to show payments arriving live. It was built in a week and worked perfectly for four
  months.</p>

  <p>On the Tuesday, somebody scaled the API from one instance to three — a routine change, made by
  somebody who had never heard of the dashboard. By Wednesday, support had a pile of tickets saying
  payments took minutes to appear, for some merchants, sometimes, and that refreshing sometimes fixed
  it.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   where the dashboard is   dashboards   updated
   ----------------------   ----------   -------
   server 1 (which sent)             3   3
   server 2                          3   0</code></pre>

  <p>Nothing was failing. No errors, no exceptions, no failed requests. The dashboards connected, stayed
  connected, and received fewer messages than were sent.</p>

  <div class="callout callout--note">
    <h4>The feature was never correct</h4>
    <p>It had a hidden precondition — one instance — that nothing recorded, no test asserted, and no
    reviewer knew about. On one server every connection and every send are in the same process, so the
    bug was structurally impossible. The change that exposed it was a replica count.</p>
  </div>
</section>

<section id="what-a-hub-is">
  <h2>What a hub is</h2>

  <p class="define"><span class="define__term">Hub</span> A class whose methods clients can call by
  name, and through which the server can call methods on clients by name. The unit of a real-time
  API.</p>

  <p class="define"><span class="define__term">Connection</span> One client's persistent link to one
  server, identified by a connection id that the server assigns.</p>

  <p class="define"><span class="define__term">Transport</span> How the connection is actually carried:
  WebSockets, Server-Sent Events, or long polling. Negotiated at connect time.</p>

  <p class="define"><span class="define__term">WebSockets</span> A protocol that upgrades an HTTP
  connection into a two-way channel where either end can send a message at any time.</p>

  <p class="define"><span class="define__term">Long polling</span> A request the server holds open until
  it has something to say, answered and immediately repeated. It emulates a push over plain
  request/response and costs the most of the three.</p>

  <p class="define"><span class="define__term">Presence</span> Whether a given user is currently
  connected. Not a property of a connection, because one user can hold several.</p>

  <p class="define"><span class="define__term">Group</span> A named set of connection ids, used as a
  routing key so the server can address "everybody watching merchant-42" without tracking them
  itself.</p>

  <p class="define"><span class="define__term">Backplane</span> A shared bus that carries hub messages
  between servers, so a send from one instance reaches connections held by another.</p>

  <p class="define"><span class="define__term">Hub method</span> A public method on your hub class,
  callable by name from a client. Its name is part of a wire contract, not a private detail.</p>

  <p class="define"><span class="define__term">Client method</span> A handler the client registers by
  name, which the server calls. The other half of the same contract, and the half nothing checks.</p>

  <p class="define"><span class="define__term"><code>IHubContext</code></span> The way code outside a
  hub — a controller, a background worker, a job — sends to clients. A hub instance itself exists only
  for the duration of one invocation.</p>

  <p class="define"><span class="define__term"><code>IUserIdProvider</code></span> The service that maps
  a connection to a user identifier, which is what makes <code>Clients.User</code> resolve to anything
  at all.</p>

  <p class="define"><span class="define__term">Fire and forget</span> Sent without acknowledgement,
  storage or retry. If nobody is listening when a hub message passes, it is gone.</p>

  <pre data-lang="csharp" data-net="10" data-title="The whole server side"><code>var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();

var app = builder.Build();

app.MapHub&lt;PaymentsHub&gt;("/hubs/payments");

app.Run();

public sealed class PaymentsHub : Hub
{
    // Callable from a client by the name "Watch".
    public Task Watch(string merchantId) =&gt;
        Groups.AddToGroupAsync(Context.ConnectionId, merchantId);
}</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   before connecting   state Disconnected
   after connecting    state Connected, id TLG69zjEzypYO7NBYBFDvg

   client called Watch("PAY-001")   server returned "watching PAY-001"
   server pushed twice, unprompted   client received 2: PAY-001 -&gt; captured; PAY-001 -&gt; settled

   connections the hub has seen      1 connected, 0 disconnected
   after the client disposes         1 connected, 1 disconnected</code></pre>

  <p>Four things there are already different from a request. <strong>The server speaks first</strong> —
  nothing asked for those two messages. <strong>There is state on the server per client</strong>, in one
  server's memory. <strong>The connection has a lifecycle you have to handle.</strong> And
  <strong>the method names are strings on both sides</strong>, matched at runtime.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>A hub is a telephone line rather than a letterbox. A request is a letter: it arrives, it is
  answered, the exchange is over. A hub connection is an open line — either end can speak, and the line
  itself is a thing that exists, costs something to hold, and can drop.</p>

  <p>Where it stops is that a telephone line has one party at each end and a hub has one at the client
  end and <em>one specific server process</em> at the other. When you have three servers, a client is on
  a line to exactly one of them, and the other two cannot reach it at all. That single fact is the
  incident above and most of this module.</p>
</section>

<section id="transports">
  <h2>How the connection is carried</h2>

  <pre data-lang="console" data-title="01-connection-lifecycle.cs output"><code>   transport                    connected   round trip works
   ---------                    ---------   ----------------
   WebSockets                   Connected   True
   ServerSentEvents             Connected   True
   LongPolling                  Connected   True</code></pre>

  <p>All three work and they are not equivalent. <strong>WebSockets</strong> is a real two-way
  connection — one TCP connection, frames both ways, low overhead per message.
  <strong>Server-Sent Events</strong> is one-way; the client sends over ordinary HTTP on a second
  channel. <strong>Long polling</strong> is a request the server holds open until it has something to
  say, repeated forever: it works everywhere and costs the most.</p>

  <div class="callout callout--gotcha">
    <h4>The fallback is automatic, which is the point and also the trap</h4>
    <p>A corporate proxy that strips the <code>Upgrade</code> header silently demotes every client
    behind it to long polling, and nothing in your code or logs says so. "Ten thousand concurrent
    connections" costs one thing on WebSockets and something quite different if a third of them are
    polling. <strong>Log the negotiated transport</strong> so you know which system you are
    running.</p>
  </div>
</section>

<section id="lifecycle">
  <h2>A connection is not a session</h2>

  <p>The client goes away and comes back — a network blip, a laptop lid, a rolling deployment. From the
  server's side all three look identical:</p>

  <pre data-lang="console" data-title="01-connection-lifecycle.cs output"><code>   connection id before   4UwtpQ4JR8wEl2yAem28jA
   connection id after    dY__gdI1nZTX3wWFGMgT9w
   the same id            False

   group members before   1
   group members after    0

   messages received      1 (to everyone)</code></pre>

  <p>The client came back as somebody else. A new connection id, no longer in the group it had joined —
  so the broadcast to the group did not reach it and the broadcast to everyone did.</p>

  <p><strong>Automatic reconnect restores the transport, not the context.</strong> Which means every
  piece of per-connection state has to be rebuildable: group membership, anything keyed on connection
  id, and the client's own idea of where it got to.</p>

  <h3>And what was sent while it was away is gone</h3>

  <pre data-lang="console" data-title="01-connection-lifecycle.cs output"><code>   sent      before, during-1, during-2, after
   received  before, after

   messages lost   2</code></pre>

  <p>Not delayed, not queued — gone. There was no connection to write them to and nothing stores
  them.</p>

  <div class="callout callout--why">
    <h4>Which gives the rule the rest of the module depends on</h4>
    <p><strong>Never let a hub message be the only record of something.</strong> If a payment being
    captured matters, the capture is written to the database and the hub message is a <em>hint</em> that
    something changed. A client that missed the hint can ask.</p>
  </div>

  <pre data-lang="csharp" data-net="10" data-title="Right - rejoin, then re-read the truth"><code>connection.Reconnected += async connectionId =&gt;
{
    await connection.InvokeAsync("Watch", merchantId);
    await RefetchCurrentStateOverHttpAsync();
};</code></pre>

  <p>And the window is small. Two messages, sent inside a gap of a few hundred milliseconds. In
  production that gap is a deployment or a wifi handover — seconds to minutes, and every message in it
  is lost silently, per client, with nothing on any dashboard.</p>

  <h3>A connection is a tab, not a person</h3>

  <pre data-lang="console" data-title="01-connection-lifecycle.cs output"><code>   one user, two tabs open        2 connections
   after closing one tab          1 disconnections, 1 still open
   after closing the other        2 disconnections, 0 still open</code></pre>

  <p>If <code>OnDisconnectedAsync</code> sets the user offline, closing one tab marks a user offline who
  is still looking at the other one. Presence needs a <em>count</em> of that user's connections, with
  offline meaning zero.</p>

  <p>And <code>OnDisconnectedAsync</code> may not run at all: a client whose machine loses power sends
  nothing, and the server finds out when its keepalive times out — or never, if the server is killed
  first. Any cleanup that <em>must</em> happen needs a timeout on the other side too.</p>
</section>

<section id="targeting">
  <h2>Who the message goes to</h2>

  <pre data-lang="console" data-title="02-targeting.cs output"><code>   client   in merchant-42   received
   ------   --------------   --------
   alice    yes              All, Group, Client(alice)
   bob      yes              All, Group, AllExcept(alice), GroupExcept(alice)
   carol    no               All, AllExcept(alice)</code></pre>

  <p>Five of the six sends behaved as their names suggest. The sixth —
  <code>Clients.User("alice")</code> — reached nobody, because <code>User</code> targets an
  authenticated identity rather than a name you made up, and with no authentication configured no
  connection has one.</p>

  <div class="callout callout--warn">
    <h4>Sending to an empty set is not an error</h4>
    <p>A misspelled group name, a connection id that has since reconnected, a user who is offline: all
    of them are a <em>successful</em> send to zero recipients. There is no delivery receipt and no
    error, which is why "the notification did not arrive" is such a hard ticket to work.</p>
    <p>The habit that helps: when a real-time feature does not work, <strong>prove the recipient set is
    not empty first</strong>. Send to <code>Clients.All</code> and see whether anything arrives.</p>
  </div>

  <p><code>Clients.Group</code> is the workhorse — a group is a routing key. <code>Clients.User</code>
  is the right tool for "tell this person", because it reaches all their tabs and survives their
  reconnects. <code>Clients.Client</code> is valid only until that connection drops, so storing a
  connection id for later is usually a bug.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a connection id kept past the life of the connection"><code>// Stored when the user opens the page, used minutes later. By then the
// client may have reconnected, and this id addresses nobody.
_watchers[merchantId] = Context.ConnectionId;

// Elsewhere, minutes later, in a background worker:
await _hub.Clients.Client(_watchers[merchantId]).SendAsync("Update", payment);</code></pre>

  <h3>Where a group actually lives</h3>

  <p>"Add this connection to merchant-42" sounds like a database write. It is a dictionary entry in one
  process — which is correct, because that process holds the only socket that could be written
  to.</p>

  <p>Two consequences follow. <strong>Group membership is not queryable</strong>: there is no API for
  "who is in merchant-42". And the moment you run a second replica, <strong>every broadcast becomes
  partial</strong> unless something carries messages between the servers.</p>

  <h3>The method names nothing checks</h3>

  <pre data-lang="console" data-title="02-targeting.cs output"><code>   server sent "Update", client listens for "Update"   handler ran 1 time
   server sent "Updat", client listens for "Update"    handler ran 1 time still - no error anywhere
   client invoked "Ecko", hub has "Echo"               HubException</code></pre>

  <p>The two directions fail differently and only one tells you. Server-to-client is silent; the client
  ignores a message naming a method it has no handler for. Client-to-server throws — but only for
  <code>InvokeAsync</code>, which waits for a reply. <code>SendAsync</code> is silent too.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// ---------------------------------------------------------------------------
// The client contract, as an interface rather than a set of strings.
public interface IPaymentsClient
{
    Task PaymentChanged(string paymentId, string status);</code></pre>

  <p>A strongly typed hub makes the server side a compile error rather than silence. The client side is
  still a string unless the client is also C#, which in a browser it is not — so the honest position is
  that <strong>a hub is a network boundary with a method call's syntax</strong>, and every rule about
  versioning a message format applies.</p>
</section>

<section id="scale-out">
  <h2>Scale-out, and what a backplane does</h2>

  <p>The incident, measured three ways. One server:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   dashboards connected        6
   dashboards that updated     6</code></pre>

  <p>Two servers, the same code:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   where the dashboard is   dashboards   updated
   ----------------------   ----------   -------
   server 1 (which sent)             3   3
   server 2                          3   0</code></pre>

  <p>And with a backplane, which is one line in production:</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - and not optional above one replica"><code>builder.Services.AddSignalR()
    .AddStackExchangeRedis(builder.Configuration.GetConnectionString("Redis")!);</code></pre>

  <pre data-lang="console" data-title="03-production.cs output"><code>   where the dashboard is   dashboards   updated
   ----------------------   ----------   -------
   server 1 (which sent)             3   3
   server 2                          3   3

   servers that received the published message   2</code></pre>

  <p>The stand-in used to measure it is small enough to read, and shows there is nothing clever
  happening — a publish reaches every subscriber, and each subscriber delivers to whatever it holds:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// ---------------------------------------------------------------------------
// Stands in for Redis or Azure SignalR Service. A publish reaches every
// subscriber; each subscriber delivers to whatever it holds.
public sealed class Backplane
{
    readonly List&lt;Func&lt;string, string, string, Task&gt;&gt; subscribers = [];

    public int Deliveries;

    public void Subscribe(Func&lt;string, string, string, Task&gt; handler)
    {
        lock (subscribers)
        {
            subscribers.Add(handler);
        }
    }

    public async Task PublishAsync(string group, string method, string argument)
    {
        Func&lt;string, string, string, Task&gt;[] snapshot;

        lock (subscribers)
        {
            snapshot = [.. subscribers];
        }

        foreach (Func&lt;string, string, string, Task&gt; handler in snapshot)
        {
            Interlocked.Increment(ref Deliveries);

            await handler(group, method, argument);
        }
    }
}</code></pre>

  <p>The mechanism is exactly what it looks like: the send goes to the bus, every server receives it,
  and each delivers to whichever members of that group it happens to hold. <strong>No server learns
  anything about any other server's connections</strong> — it is a fan-out of the message, not a shared
  registry.</p>

  <p>Every symptom in the tickets now makes sense. It works when the server that processed the payment
  also holds that dashboard — with three instances, one time in three. Two tabs are two connections,
  load-balanced independently. A refresh is a fresh roll of the dice.</p>

  <div class="callout callout--warn">
    <h4>What a backplane costs, before you add one</h4>
    <p>Every message goes to every server, whether or not it holds anybody in the group — with twenty
    instances, a message to a group of one is twenty deliveries and nineteen discards. It is a new hard
    dependency, and when it is unreachable delivery degrades in exactly the silent, partial way this
    incident describes. It adds a network hop per message. <strong>And it does not make delivery
    reliable</strong>: a client that is disconnected when the message passes still misses it.</p>
  </div>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>
// ---------------------------------------------------------------------------
public sealed class PaymentsHub(Presence presence) : Hub&lt;IPaymentsClient&gt;
{
    public override async Task OnConnectedAsync()
    {
        IQueryCollection? query = Context.GetHttpContext()?.Request.Query;

        // Restore the subscription from something the connection carries, so a
        // reconnect does not depend on the client remembering to resubscribe.
        if (query?["merchant"].ToString() is { Length: &gt; 0 } merchant)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, merchant);
        }

        if (Context.UserIdentifier is { Length: &gt; 0 } user)
        {
            presence.Connected(user);
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.UserIdentifier is { Length: &gt; 0 } user)
        {
            presence.Disconnected(user);
        }

        await base.OnDisconnectedAsync(exception);
    }

    // Still available for subscriptions only the client knows about.
    public Task Watch(string merchantId) =&gt;
        Groups.AddToGroupAsync(Context.ConnectionId, merchantId);
}</code></pre>

  <p>Presence, which is the piece most often written as a flag:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// ---------------------------------------------------------------------------
// Presence is a count per user, because a connection is a tab rather than a
// person.
public sealed class Presence
{
    readonly ConcurrentDictionary&lt;string, int&gt; connections = new();

    public void Connected(string userId) =&gt;
        connections.AddOrUpdate(userId, 1, (_, count) =&gt; count + 1);

    public void Disconnected(string userId) =&gt;
        connections.AddOrUpdate(userId, 0, (_, count) =&gt; Math.Max(0, count - 1));

    public int ConnectionsFor(string userId) =&gt;
        connections.TryGetValue(userId, out int count) ? count : 0;

    public bool IsOnline(string userId) =&gt; ConnectionsFor(userId) &gt; 0;
}</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   one user, two tabs        2 connections, online: True
   after one capture         tab 1 got 1, tab 2 got 1
   after a push while away   tab 1 got 1, tab 2 got 2
   what a refetch returns    ["PAY-001:captured","PAY-002:captured"]
   after a push once back    tab 1 got 2, tab 2 got 3

   after closing one tab     1 connections, online: True
   after closing both        0 connections, online: False</code></pre>

  <ul>
    <li><strong>Groups are restored in <code>OnConnectedAsync</code></strong>, from the query string.
    Tab 1 reconnected as a completely different connection and still received the last push, because the
    server put it back in the group without being asked.</li>
    <li><strong>The push is a hint and the store is the record.</strong> PAY-002 was pushed while tab 1
    was away and is gone forever — the refetch returned it anyway, because the truth was written before
    the hint was sent.</li>
    <li><strong>Presence is a count.</strong> Closing one of two tabs leaves the user online.</li>
  </ul>

  <div class="callout callout--gotcha">
    <h4>And the presence count is per process too</h4>
    <p>A user with a tab on each of two instances is counted as one connection on each, and neither
    knows about the other. Presence that has to be right across a fleet is a shared store, not a
    dictionary — the same lesson as the groups, arriving a second time.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Running more than one instance without a backplane</h3>

  <p>The incident. Correct on one instance and quietly wrong on two, exposed by a replica count rather
  than a deployment of your code.</p>

  <h3>Assuming a reconnect restores the subscription</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   hub                                  updates after the client reconnects
   ---                                  ----------------------------------
   waits to be told again               0 of 1
   rejoins groups in OnConnectedAsync   1 of 1</code></pre>

  <p>"Connected" and "subscribed" are different states and only one of them is visible. The green
  indicator is telling the truth and answering a question nobody asked.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the group is gone and nothing says so"><code>public override async Task OnConnectedAsync()
{
    // Nothing restores the groups this connection's predecessor was in.
    await base.OnConnectedAsync();
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the push is the only record, so a missed message is lost data"><code>public async Task CapturePaymentAsync(string paymentId)
{
    await gateway.CaptureAsync(paymentId);

    // Nothing is written down. A dashboard that was reconnecting at this
    // moment will never learn that this payment was captured.
    await hub.Clients.Group(merchantId).SendAsync("PaymentCaptured", paymentId);
}</code></pre>

  <h3>Treating a hub message as a durable record</h3>

  <p>Measured above: two messages lost in a 200 ms gap, with nothing recorded anywhere. SignalR is
  fire-and-forget by design — a hub is a transport for things that are only interesting now.</p>

  <h3>Setting a user offline in <code>OnDisconnectedAsync</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - closing one tab marks a user away who is still watching"><code>public override async Task OnDisconnectedAsync(Exception? exception)
{
    await presence.SetOfflineAsync(Context.UserIdentifier!);

    await base.OnDisconnectedAsync(exception);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - correct on one instance, partial on two, and silent about it"><code>// No backplane. Every send reaches only the connections this process
// holds, which is 1/N of them for N replicas.
builder.Services.AddSignalR();</code></pre>

  <h3>Using <code>Clients.User</code> without an identity</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the connection identifies itself   User("u-7") reached
   ------------------------------------   -------------------
   no identity configured                 0 of 1
   with an IUserIdProvider                1 of 1</code></pre>

  <h3>Doing slow work in a hub method</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   MaximumParallelInvocationsPerClient   four 200 ms calls took
   -----------------------------------   ----------------------
                                     1                  848 ms
                                     4                  217 ms</code></pre>

  <p>The default is one invocation per client at a time. That is deliberate — it bounds what one client
  can occupy and it preserves ordering — so the fix is usually not the setting but moving the work out
  of the hub.</p>

  <h3>Large messages</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   message size   outcome
   ------------   -------
           8 KB   accepted, server saw 8 KB
          31 KB   accepted, server saw 31 KB
          64 KB   HubException, connection is Disconnected
         256 KB   HubException, connection is Disconnected</code></pre>

  <p>A message over <code>MaximumReceiveMessageSize</code> does not fail the invocation — it terminates
  the connection, because there is no way to send half a message.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a hub method holding a worker for two hundred milliseconds"><code>public async Task&lt;Report&gt; BuildReport(string merchantId)
{
    // One invocation per client at a time by default, so this client's
    // other messages queue behind it - and the work is lost entirely if
    // the client disconnects halfway.
    return await reports.BuildAsync(merchantId);
}</code></pre>

  <h3>Storing a connection id for later</h3>

  <p>It is valid until that connection drops, which may be seconds. Anything that needs to reach a
  person rather than a socket wants <code>Clients.User</code>.</p>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <ol>
    <li><strong>Prove the recipient set is not empty.</strong> Send to <code>Clients.All</code>. If that
    arrives, the problem is targeting rather than the connection, and you have halved the search.</li>
    <li><strong>Ask how many instances are running.</strong> If it is more than one and there is no
    backplane, stop here — you have found it. If a symptom is "works about one time in N", N is
    usually your replica count.</li>
    <li><strong>Check whether the client is subscribed, not only connected.</strong> They are different
    states and only one is visible from the client.</li>
    <li><strong>Compare the method name on both sides, character by character.</strong> Server-to-client
    mismatches are completely silent.</li>
    <li><strong>For a client that disconnects repeatedly under load, look at message size.</strong> A
    payload over the limit kills the connection, and an automatic retry of the same payload kills it
    again — a loop that looks like a network problem.</li>
    <li><strong>Log the negotiated transport at connect.</strong> One line, and it distinguishes "our
    real-time system" from "our real-time system, except behind that customer's proxy".</li>
  </ol>

  <div class="callout callout--debug">
    <h4>Four things to watch</h4>
    <ul>
      <li><strong>Messages sent against connections delivered to.</strong> The ratio is the scale-out
      bug, visible without a single ticket.</li>
      <li><strong>Connected clients per instance.</strong> Seeing the split reminds you the connections
      are split.</li>
      <li><strong>A synthetic end-to-end check</strong> — connect, cause an event, assert it arrived,
      on a timer, in production. It must run against more than one instance or it reproduces the same
      false confidence the original tests had.</li>
      <li><strong>The backplane's own health</strong>, as a dependency check. Redis being unreachable
      degrades this feature silently and partially.</li>
    </ul>
  </div>

  <p>And the review question that would have caught it on day one: <strong>does this work with two
  instances?</strong> It applies to anything holding state in process memory — groups, in-memory
  caches, in-memory rate limits, a static dictionary.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"SignalR delivers messages reliably"</h4>
    <p>It is fire-and-forget. A client that is disconnected when a message passes misses it, permanently
    and silently. Measured: two messages lost in a 200 ms gap.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A backplane makes delivery reliable"</h4>
    <p>It fixes "the wrong server sent it". It does nothing about "nobody was listening".</p>
  </div>

  <div class="callout callout--myth">
    <h4>"The reconnect puts everything back"</h4>
    <p>It restores the transport. The connection id is new and the groups are empty.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A send that returns without throwing was delivered"</h4>
    <p>It resolved to a set of connections, possibly empty. There is no receipt.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"One connection is one user"</h4>
    <p>One connection is one tab. Presence is a count.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"It works in staging, so it works"</h4>
    <p>Staging is usually one instance. The bug in this module is structurally impossible there.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Hub methods are only method calls"</h4>
    <p>They are messages with a name in them, matched at runtime, across a version boundary. Renaming
    one is a breaking change to a wire contract.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A real-time feature is the first thing in your service that cannot be stateless</h4>
    <p>Every other part of an HTTP application is deliberately indifferent to which instance handles a
    request — that is what makes scaling a replica count rather than a project. A hub connection is
    pinned to one process, holds state there, and is unreachable from anywhere else. <strong>Adding
    SignalR is the moment a stateless service stops being one</strong>, and the cost is paid the first
    time somebody scales it.</p>
  </div>

  <p>The second reason is that this failure mode is invisible to conventional monitoring. Error rates,
  latency percentiles and status codes all describe requests. A message that reached three of six
  dashboards produces no error on either side — the send succeeded, the connection is healthy, and the
  only evidence is a user saying the number on their screen is wrong.</p>

  <p>The third is the discipline it forces, which is worth more than the feature. Because a hub message
  can always be lost, the record has to exist somewhere else and the client has to be able to recover by
  asking. <strong>A design where the push is a hint and the truth is fetchable is strictly more robust
  than one where the push is the truth</strong> — and it is the same shape as an event notification, a
  cache invalidation, or a webhook.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A service notifies one user with
    <code>Clients.User(userId).SendAsync(...)</code>. It never arrives. The user is definitely
    connected, the code definitely runs, and nothing throws.</p>
    <p>Why?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the connection identifies itself   User("u-7") reached
   ------------------------------------   -------------------
   no identity configured                 0 of 1
   with an IUserIdProvider                1 of 1</code></pre>
        <p><code>Clients.User</code> targets an identity the hub can see. Without authentication — or an
        <code>IUserIdProvider</code> deriving one from something else — no connection has a user id, so
        the set of matching connections is empty.</p>
        <p>And sending to an empty set is not an error. The call succeeds, there is no recipient count,
        and nothing appears in a log. The feature does not work, which is the hardest kind of
        failure to chase because there is no evidence of it anywhere on the server.</p>
        <p>The same is true of every targeting call: a misspelled group name, a stale connection id, a
        user who is offline. Which suggests a habit: when a real-time feature does not work,
        <strong>prove the recipient set is not empty first</strong> by sending to
        <code>Clients.All</code>.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>Every deployment, a proportion of dashboards go quiet. They are connected — the indicator is
    green — and they never receive another update until the page is refreshed.</p>
    <p>What is happening, and where does the fix belong?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   hub                                  updates after the client reconnects
   ---                                  ----------------------------------
   waits to be told again               0 of 1
   rejoins groups in OnConnectedAsync   1 of 1</code></pre>
        <p>The reconnect restored the connection and not the group. A new connection has a new id and
        belongs to nothing; the client thinks it is still watching because from its side nothing
        changed. "Connected" and "subscribed" are different states and only one of them is visible.</p>
        <p>There are two places to put the fix and you want the first. <strong>On the server</strong>,
        in <code>OnConnectedAsync</code>, from something the connection carries — a claim, a query
        string, a route value. It works for every client, including ones written by somebody else, and
        it cannot be forgotten by a client author. <strong>On the client</strong>, in the
        <code>Reconnected</code> handler, is necessary only when the client alone knows what it wants —
        a filter the user changed, a document they opened.</p>
        <p>And while you are there: the rejoin is also where you re-read the state, because the client
        missed everything sent while it was away.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>A hub method calls a slow report service. A client fires four of them at once, expecting them to
    overlap. They take four times as long as one, and the same client's other messages stall behind
    them.</p>
    <p>Why, and what is the right fix?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   MaximumParallelInvocationsPerClient   four 200 ms calls took
   -----------------------------------   ----------------------
                                     1                  848 ms
                                     4                  217 ms</code></pre>
        <p>The default is one. A hub processes one invocation per client at a time, so four calls from
        one connection run one after another.</p>
        <p>The default is deliberate and it is protecting you from something real: with unbounded
        parallelism, one client can occupy as many threads as it likes by sending as fast as it can, and
        the messages a hub receives are under the client's control rather than yours. It also gives you
        <strong>ordering</strong> — messages from a client are handled in the order sent, which a
        surprising amount of code assumes without saying so. Raise the limit and any hub method whose
        correctness depended on that is now racy.</p>
        <p>So the fix is usually not the setting. It is to stop doing slow work in a hub method: a hub
        is a message dispatcher, and a two-hundred-millisecond report belongs in a job with the hub used
        to say when it is ready. That also survives the client disconnecting halfway, which a long hub
        invocation does not.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>A client sends a batch of edits as one message. Small batches work. Large ones disconnect the
    client, with no error the client can usefully report and no exception on the server.</p>
    <p>What is the limit, why is the symptom a disconnect, and what should change?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   message size   outcome
   ------------   -------
           8 KB   accepted, server saw 8 KB
          31 KB   accepted, server saw 31 KB
          64 KB   HubException, connection is Disconnected
         256 KB   HubException, connection is Disconnected</code></pre>
        <p><code>HubOptions.MaximumReceiveMessageSize</code> defaults to 32 KB, and a message over it
        does not fail the invocation — it terminates the connection, because there is no way to send
        half a message. Which is why the symptom is "the client disconnects" rather than "the call
        failed", and why an automatic retry of the same batch produces a loop that looks like a network
        problem.</p>
        <p>Raising the limit is one line and usually the wrong fix: it is a limit on a message held in
        memory, per client, on a connection whose timing the client controls. A megabyte across ten
        thousand connections is a megabyte times however many decide to send at once.</p>
        <p>Better, in order: <strong>send less</strong> — smaller messages are lower latency and fail in
        smaller pieces; <strong>stream it</strong>, which bounds memory per message; or <strong>do not
        use the hub</strong> — POST the batch and use the hub to say it is done. A real-time channel is
        for small, frequent, time-sensitive messages, and a large upload is none of those.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Why did the dashboard work for four months and then break when nothing about it changed?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It had a hidden precondition of one instance. A server can only
        write to connections it holds, so with three instances a send reaches roughly a third of the
        clients. The change was a replica count.</p></div>
      </details></li>

    <li><p>What does a backplane do, and what does it not do?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It fans the message out to every server, each of which delivers to
        whichever group members it holds. It does not share a connection registry, and it does not make
        delivery reliable — a disconnected client still misses the message.</p></div>
      </details></li>

    <li><p>What survives a reconnect and what does not?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The transport survives. The connection id is new and the group
        memberships are gone, so a broadcast to a group the client had joined no longer reaches it.</p></div>
      </details></li>

    <li><p>What happens to messages sent while a client is disconnected?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>They are dropped — not queued, not delayed. Which is why a hub
        message must never be the only record of something.</p></div>
      </details></li>

    <li><p>Why is <code>OnDisconnectedAsync</code> a bad place to mark a user offline?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A connection is a tab, not a person. One user with two tabs
        produces two connections, so closing one marks offline a user who is still watching. Presence
        needs a count.</p></div>
      </details></li>

    <li><p>What happens when you send to a group nobody has joined?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The call succeeds and reaches nobody. There is no error and no
        delivery receipt for any targeting call.</p></div>
      </details></li>

    <li><p>Which direction of a mismatched method name is silent, and which throws?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Server-to-client is silent — the client ignores a message it has no
        handler for. Client-to-server throws, but only for <code>InvokeAsync</code>;
        <code>SendAsync</code> is silent too.</p></div>
      </details></li>

    <li><p>Why does a 64 KB hub message disconnect the client rather than failing the call?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It exceeds <code>MaximumReceiveMessageSize</code>, which defaults
        to 32 KB. There is no way to send half a message, so terminating the connection is the only
        available response.</p></div>
      </details></li>

    <li><p>What is <code>MaximumParallelInvocationsPerClient</code>'s default, and what does it buy?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>One. It bounds what a single client can occupy and it preserves
        the order of that client's messages — which a lot of code assumes without saying so.</p></div>
      </details></li>

    <li><p>Why can a corporate proxy change your capacity planning without changing your code?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Stripping the <code>Upgrade</code> header demotes those clients to
        long polling, which costs far more per client. Nothing logs it unless you log the negotiated
        transport.</p></div>
      </details></li>

    <li><p>Where should a group be rejoined after a reconnect, and why there?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>On the server, in <code>OnConnectedAsync</code>, from something the
        connection carries. It works for every client and cannot be forgotten by a client author.</p></div>
      </details></li>

    <li><p>State the design rule this module keeps returning to.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The push is a hint; the record lives somewhere durable and is
        fetchable over an ordinary request. A client that missed a message can recover by asking.</p></div>
      </details></li>
  </ol>
</section>
`
});
