// 01-connection-lifecycle.cs — A connection is not a session. What survives a
// reconnect, what does not, and what the client sees while it is gone.
//
// Run:  dotnet run 01-connection-lifecycle.cs -c Release
//
// EXACT vs RATIO: the counts, ids and states are deterministic. The timings are
// machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.SignalR.Client@10.0.0

using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

Console.WriteLine("What a connection is, and what a reconnect costs");
Console.WriteLine();

await Transports();
await WhatAReconnectLoses();
await WhileItIsGone();
await Disconnects();

// ---------------------------------------------------------------------------
static async Task Transports()
{
    Console.WriteLine("1. Three ways the same connection can be carried");
    Console.WriteLine();
    Console.WriteLine("   SignalR is not a protocol on the wire - it is a protocol over one of");
    Console.WriteLine("   three transports, negotiated at connect time.");
    Console.WriteLine();

    var (app, address) = await StartHub();

    Console.WriteLine("   transport                    connected   round trip works");
    Console.WriteLine("   ---------                    ---------   ----------------");

    foreach ((string label, HttpTransportType transport) in new[]
    {
        ("WebSockets", HttpTransportType.WebSockets),
        ("ServerSentEvents", HttpTransportType.ServerSentEvents),
        ("LongPolling", HttpTransportType.LongPolling)
    })
    {
        var connection = new HubConnectionBuilder()
            .WithUrl($"{address}/hubs/payments", options => options.Transports = transport)
            .Build();

        string result;

        try
        {
            await connection.StartAsync();
            string echo = await connection.InvokeAsync<string>("Echo", "hello");

            result = $"{connection.State,-11} {echo == "hello"}";
        }
        catch (Exception exception)
        {
            result = exception.GetType().Name;
        }

        Console.WriteLine($"   {label,-28} {result}");

        await connection.DisposeAsync();
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ALL THREE WORK AND THEY ARE NOT EQUIVALENT:");
    Console.WriteLine();
    Console.WriteLine("     WEBSOCKETS is a real two-way connection. One TCP connection, frames");
    Console.WriteLine("     in both directions, low overhead per message. This is what you want");
    Console.WriteLine("     and what you get unless something in the path refuses it.");
    Console.WriteLine();
    Console.WriteLine("     SERVER-SENT EVENTS is one-way. The server can push; the client sends");
    Console.WriteLine("     by making ordinary HTTP requests on a second channel. It works");
    Console.WriteLine("     through proxies that block WebSockets.");
    Console.WriteLine();
    Console.WriteLine("     LONG POLLING is a request that the server holds open until it has");
    Console.WriteLine("     something to say, repeated forever. It works everywhere and costs the");
    Console.WriteLine("     most - a request per message in one direction, and a connection held");
    Console.WriteLine("     per client either way.");
    Console.WriteLine();
    Console.WriteLine("   THE CLIENT NEGOTIATES AND FALLS BACK AUTOMATICALLY, which is the point");
    Console.WriteLine("   of the abstraction and also why performance can differ enormously");
    Console.WriteLine("   between environments that look identical. A corporate proxy that");
    Console.WriteLine("   strips the Upgrade header silently demotes every client behind it to");
    Console.WriteLine("   long polling, and nothing in your code or logs says so.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS WORTH KNOWING BEFORE YOU CAPACITY-PLAN: 'ten thousand");
    Console.WriteLine("   concurrent connections' costs one thing on WebSockets and something");
    Console.WriteLine("   quite different if a third of them are long polling. LOG THE");
    Console.WriteLine("   NEGOTIATED TRANSPORT so you know which system you are running.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatAReconnectLoses()
{
    Console.WriteLine("2. What a reconnect keeps and what it loses");
    Console.WriteLine();
    Console.WriteLine("   The client goes away and comes back - a network blip, a laptop lid, a");
    Console.WriteLine("   rolling deployment. From the server's side all three look identical.");
    Console.WriteLine();

    var (app, address) = await StartHub();

    var connection = new HubConnectionBuilder()
        .WithUrl($"{address}/hubs/payments")
        .Build();

    var received = new List<string>();

    connection.On<string>("Update", message =>
    {
        lock (received)
        {
            received.Add(message);
        }
    });

    await connection.StartAsync();

    string firstId = connection.ConnectionId!;

    // Join a group, which is the state people expect to survive.
    await connection.InvokeAsync("JoinGroup", "merchant-42");

    int membersBefore = PaymentsHub.GroupMembers("merchant-42");

    // Gone, and back. StopAsync and StartAsync are what the automatic
    // reconnect does underneath, without the timing being at the mercy of a
    // retry schedule.
    await connection.StopAsync();
    await Task.Delay(200);
    await connection.StartAsync();

    string secondId = connection.ConnectionId!;

    await Task.Delay(200);

    int membersAfter = PaymentsHub.GroupMembers("merchant-42");

    // Does a broadcast to the group still reach it?
    IHubContext<PaymentsHub> hub = app.Services.GetRequiredService<IHubContext<PaymentsHub>>();

    await hub.Clients.Group("merchant-42").SendAsync("Update", "to the group");
    await hub.Clients.All.SendAsync("Update", "to everyone");

    await Task.Delay(300);

    Console.WriteLine($"   connection id before   {firstId}");
    Console.WriteLine($"   connection id after    {secondId}");
    Console.WriteLine($"   the same id            {firstId == secondId}");
    Console.WriteLine();
    Console.WriteLine($"   group members before   {membersBefore}");
    Console.WriteLine($"   group members after    {membersAfter}");
    Console.WriteLine();
    Console.WriteLine($"   messages received      {received.Count} ({string.Join(", ", received)})");

    await connection.DisposeAsync();
    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE CLIENT CAME BACK AS SOMEBODY ELSE. A new connection id, and no");
    Console.WriteLine("   longer in the group it had joined - so the broadcast to the group did");
    Console.WriteLine("   not reach it and the broadcast to everyone did.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE SINGLE MOST IMPORTANT FACT ABOUT SIGNALR: A CONNECTION IS");
    Console.WriteLine("   NOT A SESSION. It is a transport-level thing with server-side state");
    Console.WriteLine("   attached, and when the transport goes away so does the state. Automatic");
    Console.WriteLine("   reconnect restores the TRANSPORT, not the CONTEXT.");
    Console.WriteLine();
    Console.WriteLine("   WHICH MEANS EVERY PIECE OF PER-CONNECTION STATE HAS TO BE REBUILDABLE:");
    Console.WriteLine();
    Console.WriteLine("     GROUP MEMBERSHIP. Rejoin in OnConnectedAsync, from something durable");
    Console.WriteLine("     - the user's identity, a query string, a first message from the");
    Console.WriteLine("     client saying what it cares about.");
    Console.WriteLine();
    Console.WriteLine("     ANYTHING KEYED ON CONNECTION ID. A dictionary from connection id to");
    Console.WriteLine("     'what this client is watching' is correct, has to be repopulated on");
    Console.WriteLine("     reconnect, and leaks if the old entry is never removed.");
    Console.WriteLine();
    Console.WriteLine("     AND THE CLIENT'S IDEA OF WHERE IT GOT TO. The server sent nothing");
    Console.WriteLine("     while the client was away and does not know what it missed.");
    Console.WriteLine();
    Console.WriteLine("   ONE OPTION WORTH KNOWING ABOUT: STATEFUL RECONNECT, enabled with");
    Console.WriteLine("   WithStatefulReconnect() on both sides, keeps the connection id and");
    Console.WriteLine("   buffers a small number of messages across a brief drop. It narrows the");
    Console.WriteLine("   window and does not remove it - the buffer is bounded and a long");
    Console.WriteLine("   outage still ends the connection for good. IT IS AN OPTIMISATION, NOT A");
    Console.WriteLine("   REASON TO SKIP THE REJOIN LOGIC.");
    Console.WriteLine();
    Console.WriteLine("   AND ONE MEASUREMENT DETAIL WORTH REPEATING: Context.Abort() ON THE");
    Console.WriteLine("   SERVER DOES NOT TRIGGER THE CLIENT'S AUTOMATIC RECONNECT. The client");
    Console.WriteLine("   treats a server-initiated close as deliberate and stays disconnected.");
    Console.WriteLine("   If you are testing reconnect behaviour, kill the transport - stop the");
    Console.WriteLine("   server, or drop the network - rather than aborting politely.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhileItIsGone()
{
    Console.WriteLine("3. What happens to messages sent while a client is away");
    Console.WriteLine();

    var (app, address) = await StartHub();

    var connection = new HubConnectionBuilder()
        .WithUrl($"{address}/hubs/payments")
        .Build();

    var received = new List<string>();

    connection.On<string>("Update", message =>
    {
        lock (received)
        {
            received.Add(message);
        }
    });

    await connection.StartAsync();

    IHubContext<PaymentsHub> hub = app.Services.GetRequiredService<IHubContext<PaymentsHub>>();

    await hub.Clients.All.SendAsync("Update", "before");
    await Task.Delay(200);

    // Away.
    await connection.StopAsync();

    await hub.Clients.All.SendAsync("Update", "during-1");
    await hub.Clients.All.SendAsync("Update", "during-2");
    await Task.Delay(200);

    // Back.
    await connection.StartAsync();
    await Task.Delay(200);

    await hub.Clients.All.SendAsync("Update", "after");
    await Task.Delay(300);

    Console.WriteLine($"   sent      before, during-1, during-2, after");
    Console.WriteLine($"   received  {string.Join(", ", received)}");
    Console.WriteLine();
    Console.WriteLine($"   messages lost   {4 - received.Count}");

    await connection.DisposeAsync();
    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE MESSAGES SENT WHILE IT WAS AWAY ARE GONE. Not delayed, not queued -");
    Console.WriteLine("   gone. There was no connection to write them to and nothing stores them.");
    Console.WriteLine();
    Console.WriteLine("   SIGNALR IS FIRE-AND-FORGET AND THAT IS A DESIGN DECISION, NOT AN");
    Console.WriteLine("   OVERSIGHT. A hub is a transport for things that are only interesting");
    Console.WriteLine("   now: a price tick, a typing indicator, a progress percentage. Storing");
    Console.WriteLine("   and replaying those would be worse than dropping them.");
    Console.WriteLine();
    Console.WriteLine("   SO THE RULE IS: NEVER LET A HUB MESSAGE BE THE ONLY RECORD OF");
    Console.WriteLine("   SOMETHING. If a payment being captured matters, the capture is written");
    Console.WriteLine("   to the database and the hub message is a HINT that something changed.");
    Console.WriteLine("   A client that missed the hint can ask.");
    Console.WriteLine();
    Console.WriteLine("   WHICH GIVES THE RECONNECT PATTERN THAT ACTUALLY WORKS:");
    Console.WriteLine();
    Console.WriteLine("     connection.Reconnected += async connectionId =>");
    Console.WriteLine("     {");
    Console.WriteLine("         await connection.InvokeAsync(\"Resubscribe\", merchantId);");
    Console.WriteLine("         await RefetchCurrentStateOverHttpAsync();");
    Console.WriteLine("     };");
    Console.WriteLine();
    Console.WriteLine("   Rejoin the groups, then RE-READ THE TRUTH over an ordinary request. The");
    Console.WriteLine("   hub tells you when to look; it is not where the answer lives.");
    Console.WriteLine();
    Console.WriteLine("   AND NOTICE HOW SMALL THE WINDOW WAS. Two messages, sent inside a gap of");
    Console.WriteLine("   a few hundred milliseconds. In production that gap is a deployment, a");
    Console.WriteLine("   wifi handover, a phone locking - seconds to minutes, and every message");
    Console.WriteLine("   in it is lost silently, per client, with nothing on any dashboard.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Disconnects()
{
    Console.WriteLine("4. Why OnDisconnectedAsync is not a 'user left' event");
    Console.WriteLine();

    var (app, address) = await StartHub();

    PaymentsHub.Reset();

    // One user, two browser tabs - which is two connections.
    var tabOne = new HubConnectionBuilder().WithUrl($"{address}/hubs/payments").Build();
    var tabTwo = new HubConnectionBuilder().WithUrl($"{address}/hubs/payments").Build();

    await tabOne.StartAsync();
    await tabTwo.StartAsync();

    await Task.Delay(150);

    Console.WriteLine($"   one user, two tabs open        {PaymentsHub.Connected} connections");

    await tabOne.DisposeAsync();
    await Task.Delay(300);

    Console.WriteLine($"   after closing one tab          {PaymentsHub.Disconnected} disconnections, " +
        $"{PaymentsHub.Connected - PaymentsHub.Disconnected} still open");

    await tabTwo.DisposeAsync();
    await Task.Delay(300);

    Console.WriteLine($"   after closing the other        {PaymentsHub.Disconnected} disconnections, " +
        $"{PaymentsHub.Connected - PaymentsHub.Disconnected} still open");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ONE USER PRODUCED TWO CONNECTIONS AND TWO DISCONNECTIONS. If");
    Console.WriteLine("   OnDisconnectedAsync sets the user offline, closing one tab marks a user");
    Console.WriteLine("   offline who is still looking at the other one.");
    Console.WriteLine();
    Console.WriteLine("   A CONNECTION IS A TAB, NOT A PERSON. Presence - 'is this user online' -");
    Console.WriteLine("   needs a COUNT of that user's connections, incremented on connect and");
    Console.WriteLine("   decremented on disconnect, with offline meaning zero.");
    Console.WriteLine();
    Console.WriteLine("   AND THE EXCEPTION ARGUMENT IS LESS USEFUL THAN IT LOOKS. A null");
    Console.WriteLine("   exception means a clean close and a non-null one means an error, but");
    Console.WriteLine("   'the user closed the tab', 'the user's wifi dropped' and 'we are");
    Console.WriteLine("   shutting down' are not reliably distinguishable. DO NOT BUILD");
    Console.WriteLine("   BEHAVIOUR ON WHY A CONNECTION ENDED - only on the fact that it did.");
    Console.WriteLine();
    Console.WriteLine("   ONE MORE THING THAT SURPRISES PEOPLE: OnDisconnectedAsync MAY NOT RUN");
    Console.WriteLine("   AT ALL. A client whose machine loses power sends nothing; the server");
    Console.WriteLine("   finds out when its keepalive times out, which is fifteen seconds later");
    Console.WriteLine("   by default - or never, if the server itself is killed first. Any");
    Console.WriteLine("   cleanup that MUST happen needs a timeout on the other side too.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<(WebApplication App, string Address)> StartHub()
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSignalR();

    var app = builder.Build();
    app.MapHub<PaymentsHub>("/hubs/payments");

    await app.StartAsync();

    return (app, app.Urls.First());
}

// ---------------------------------------------------------------------------
public sealed class PaymentsHub : Hub
{
    static readonly Dictionary<string, HashSet<string>> Groups = [];

    public static int Connected;

    public static int Disconnected;

    public static void Reset()
    {
        Connected = 0;
        Disconnected = 0;

        lock (Groups)
        {
            Groups.Clear();
        }
    }

    public static int GroupMembers(string group)
    {
        lock (Groups)
        {
            return Groups.TryGetValue(group, out HashSet<string>? members) ? members.Count : 0;
        }
    }

    public override Task OnConnectedAsync()
    {
        Interlocked.Increment(ref Connected);

        return base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        Interlocked.Increment(ref Disconnected);

        // The framework removes the connection from its groups. This shadow
        // record has to be maintained by hand, and forgetting to is a leak.
        lock (Groups)
        {
            foreach (HashSet<string> members in Groups.Values)
            {
                members.Remove(Context.ConnectionId);
            }
        }

        return base.OnDisconnectedAsync(exception);
    }

    public string Echo(string message) => message;

    public async Task JoinGroup(string group)
    {
        await Groups_AddAsync(group);

        lock (Groups)
        {
            if (!Groups.TryGetValue(group, out HashSet<string>? members))
            {
                members = [];
                Groups[group] = members;
            }

            members.Add(Context.ConnectionId);
        }
    }

    // Named to avoid colliding with the static shadow dictionary above.
    Task Groups_AddAsync(string group) =>
        base.Groups.AddToGroupAsync(Context.ConnectionId, group);

    // Ends this connection from the server side, which is what a network blip
    // or a rolling deployment looks like to a client.
    public void DropMe() => Context.Abort();
}
