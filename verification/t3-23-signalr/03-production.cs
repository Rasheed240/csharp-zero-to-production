// 03-production.cs — The feature that worked until it was scaled.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.SignalR.Client@10.0.0

using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

Console.WriteLine("An incident: 'the dashboard only updates sometimes'");
Console.WriteLine();

TheIncident();
await OneServer();
await TwoServers();
await WithABackplane();
WhatToWatch();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. What was seen");
    Console.WriteLine();
    Console.WriteLine("   Ledger's merchant dashboard shows payments arriving live. A payment is");
    Console.WriteLine("   captured, the API pushes an update over SignalR, the row appears. It");
    Console.WriteLine("   was built in a week and it worked perfectly for four months.");
    Console.WriteLine();
    Console.WriteLine("     Tue 11:00   The API is scaled from one instance to three, because");
    Console.WriteLine("                 traffic has grown. A routine change, made by somebody");
    Console.WriteLine("                 who had never heard of the dashboard.");
    Console.WriteLine();
    Console.WriteLine("     Tue 14:30   First support ticket: 'payments take a few minutes to");
    Console.WriteLine("                 appear'. Reproduced by nobody.");
    Console.WriteLine();
    Console.WriteLine("     Wed 09:00   More tickets. A pattern emerges and then falls apart: it");
    Console.WriteLine("                 works for some merchants and not others, and for the");
    Console.WriteLine("                 same merchant it works after a refresh, sometimes.");
    Console.WriteLine();
    Console.WriteLine("     Wed 11:20   An engineer keeps two browser tabs open on the same");
    Console.WriteLine("                 merchant. One updates and the other does not.");
    Console.WriteLine();
    Console.WriteLine("   NOTHING IS FAILING. No errors, no exceptions, no failed requests. The");
    Console.WriteLine("   dashboard connects, stays connected, and receives fewer messages than");
    Console.WriteLine("   were sent - which is a category of bug most monitoring has no way to");
    Console.WriteLine("   see at all.");
    Console.WriteLine();
    Console.WriteLine("   AND 'REFRESHING SOMETIMES FIXES IT' IS THE CLUE, though it takes the");
    Console.WriteLine("   rest of this file to say why.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task OneServer()
{
    Console.WriteLine("2. One server, which is where the feature was built and tested");
    Console.WriteLine();

    var (app, address) = await StartServer("server-1");

    // Six dashboards, all watching merchant-42.
    var dashboards = await ConnectDashboards(address, 6, "merchant-42");

    // A payment is captured. The API pushes.
    IHubContext<DashboardHub> hub = app.Services.GetRequiredService<IHubContext<DashboardHub>>();
    await hub.Clients.Group("merchant-42").SendAsync("PaymentCaptured", "PAY-001");

    await Task.Delay(400);

    Console.WriteLine($"   dashboards connected        {dashboards.Count}");
    Console.WriteLine($"   dashboards that updated     {dashboards.Count(d => d.Received.Count > 0)}");

    foreach (Dashboard dashboard in dashboards)
    {
        await dashboard.Connection.DisposeAsync();
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ALL SIX. On one server this feature is correct, and it is correct for");
    Console.WriteLine("   a reason that does not survive: every connection is held by the same");
    Console.WriteLine("   process that is doing the sending.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TwoServers()
{
    Console.WriteLine("3. The same code on two servers");
    Console.WriteLine();
    Console.WriteLine("   A load balancer put some dashboards on one instance and some on the");
    Console.WriteLine("   other. Nothing else changed.");
    Console.WriteLine();

    var (first, firstAddress) = await StartServer("server-1");
    var (second, secondAddress) = await StartServer("server-2");

    List<Dashboard> onFirst = await ConnectDashboards(firstAddress, 3, "merchant-42");
    List<Dashboard> onSecond = await ConnectDashboards(secondAddress, 3, "merchant-42");

    // The payment happens to be processed by server 1, so server 1 sends.
    IHubContext<DashboardHub> hub = first.Services.GetRequiredService<IHubContext<DashboardHub>>();
    await hub.Clients.Group("merchant-42").SendAsync("PaymentCaptured", "PAY-001");

    await Task.Delay(400);

    Console.WriteLine("   where the dashboard is   dashboards   updated");
    Console.WriteLine("   ----------------------   ----------   -------");
    Console.WriteLine($"   server 1 (which sent)    {onFirst.Count,10}   {onFirst.Count(d => d.Received.Count > 0)}");
    Console.WriteLine($"   server 2                 {onSecond.Count,10}   {onSecond.Count(d => d.Received.Count > 0)}");

    foreach (Dashboard dashboard in onFirst.Concat(onSecond))
    {
        await dashboard.Connection.DisposeAsync();
    }

    await first.StopAsync();
    await first.DisposeAsync();
    await second.StopAsync();
    await second.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   HALF THE DASHBOARDS NEVER HEARD. Server 1 sent to every connection in");
    Console.WriteLine("   merchant-42 that server 1 holds, which is the only thing it could");
    Console.WriteLine("   possibly do - a server cannot write to a socket it does not have.");
    Console.WriteLine();
    Console.WriteLine("   AND NOW EVERY SYMPTOM IN THE TICKETS MAKES SENSE:");
    Console.WriteLine();
    Console.WriteLine("     'IT WORKS FOR SOME MERCHANTS.' It works when the server that");
    Console.WriteLine("     processed the payment is also the server holding that merchant's");
    Console.WriteLine("     dashboard. With three instances that is roughly one time in three.");
    Console.WriteLine();
    Console.WriteLine("     'ONE TAB UPDATES AND THE OTHER DOES NOT.' Two tabs are two");
    Console.WriteLine("     connections, load-balanced independently, so they land on different");
    Console.WriteLine("     instances.");
    Console.WriteLine();
    Console.WriteLine("     'REFRESHING SOMETIMES FIXES IT.' A refresh is a new connection and a");
    Console.WriteLine("     fresh roll of the dice.");
    Console.WriteLine();
    Console.WriteLine("     'IT WORKED FOR FOUR MONTHS.' There was one instance. Every");
    Console.WriteLine("     connection and every send were in the same process, so the bug was");
    Console.WriteLine("     structurally impossible.");
    Console.WriteLine();
    Console.WriteLine("   THE FEATURE WAS NEVER CORRECT. It had a hidden precondition - one");
    Console.WriteLine("   instance - that nothing recorded, no test asserted, and no reviewer");
    Console.WriteLine("   knew about. The change that broke it was a replica count, made by");
    Console.WriteLine("   somebody who had no reason to think it was related.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WithABackplane()
{
    Console.WriteLine("4. The fix, and what it actually does");
    Console.WriteLine();
    Console.WriteLine("   A backplane is a shared bus every server publishes to and subscribes");
    Console.WriteLine("   from. Redis and Azure SignalR Service are the usual ones. The");
    Console.WriteLine("   mechanism is small enough to build here, which is the best way to see");
    Console.WriteLine("   what it is and is not doing.");
    Console.WriteLine();

    var bus = new Backplane();

    var (first, firstAddress) = await StartServer("server-1", bus);
    var (second, secondAddress) = await StartServer("server-2", bus);

    List<Dashboard> onFirst = await ConnectDashboards(firstAddress, 3, "merchant-42");
    List<Dashboard> onSecond = await ConnectDashboards(secondAddress, 3, "merchant-42");

    // The same send, from the same server as before.
    await bus.PublishAsync("merchant-42", "PaymentCaptured", "PAY-001");

    await Task.Delay(500);

    Console.WriteLine("   where the dashboard is   dashboards   updated");
    Console.WriteLine("   ----------------------   ----------   -------");
    Console.WriteLine($"   server 1 (which sent)    {onFirst.Count,10}   {onFirst.Count(d => d.Received.Count > 0)}");
    Console.WriteLine($"   server 2                 {onSecond.Count,10}   {onSecond.Count(d => d.Received.Count > 0)}");
    Console.WriteLine();
    Console.WriteLine($"   servers that received the published message   {bus.Deliveries}");

    foreach (Dashboard dashboard in onFirst.Concat(onSecond))
    {
        await dashboard.Connection.DisposeAsync();
    }

    await first.StopAsync();
    await first.DisposeAsync();
    await second.StopAsync();
    await second.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ALL SIX, AND THE MECHANISM IS EXACTLY WHAT IT LOOKS LIKE. The send goes");
    Console.WriteLine("   to the bus; every server receives it; each one delivers to whichever");
    Console.WriteLine("   members of that group it happens to hold. NO SERVER LEARNS ANYTHING");
    Console.WriteLine("   ABOUT ANY OTHER SERVER'S CONNECTIONS - it is a fan-out of the MESSAGE,");
    Console.WriteLine("   not a shared registry of connections.");
    Console.WriteLine();
    Console.WriteLine("   IN PRODUCTION THIS IS ONE LINE, and the one line is the whole fix:");
    Console.WriteLine();
    Console.WriteLine("     builder.Services.AddSignalR().AddStackExchangeRedis(connectionString);");
    Console.WriteLine();
    Console.WriteLine("   WHAT A BACKPLANE COSTS IS WORTH KNOWING BEFORE YOU ADD IT:");
    Console.WriteLine();
    Console.WriteLine("     EVERY MESSAGE GOES TO EVERY SERVER, whether or not that server holds");
    Console.WriteLine("     anybody in the group. With twenty instances, a message to a group of");
    Console.WriteLine("     one is twenty deliveries and nineteen of them are discarded. The bus");
    Console.WriteLine("     is a broadcast, and broadcast traffic grows with the instance count.");
    Console.WriteLine();
    Console.WriteLine("     IT IS A NEW HARD DEPENDENCY. If Redis is unreachable, cross-server");
    Console.WriteLine("     delivery stops - and it stops in exactly the silent, partial way");
    Console.WriteLine("     this incident describes.");
    Console.WriteLine();
    Console.WriteLine("     IT ADDS LATENCY, one network hop on every message.");
    Console.WriteLine();
    Console.WriteLine("     AND IT DOES NOT MAKE DELIVERY RELIABLE. A client that is disconnected");
    Console.WriteLine("     when the message passes still misses it. The backplane fixes 'the");
    Console.WriteLine("     wrong server sent it'; it does nothing about 'nobody was listening'.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS WHY THE OTHER HALF OF THE FIX IS THE CLIENT'S: on connect and");
    Console.WriteLine("   on every reconnect, RE-READ THE CURRENT STATE over an ordinary request.");
    Console.WriteLine("   The hub tells you when to look. It is not where the answer lives, and a");
    Console.WriteLine("   dashboard that only ever learns from pushes is a dashboard that is");
    Console.WriteLine("   wrong after its first missed message.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatToWatch()
{
    Console.WriteLine("5. What would have caught it");
    Console.WriteLine();
    Console.WriteLine("   MESSAGES SENT AGAINST MESSAGES DELIVERED. The hub knows how many");
    Console.WriteLine("   connections a send resolved to. If your code sends one update per");
    Console.WriteLine("   captured payment and the delivery count is a third of the connected");
    Console.WriteLine("   dashboards, that ratio is the bug, visible without a single ticket.");
    Console.WriteLine();
    Console.WriteLine("   CONNECTED CLIENTS PER INSTANCE. Three instances with a third of the");
    Console.WriteLine("   connections each is the normal picture, and it is also the picture that");
    Console.WriteLine("   makes this failure certain. Seeing that number reminds you the");
    Console.WriteLine("   connections are split.");
    Console.WriteLine();
    Console.WriteLine("   A SYNTHETIC END-TO-END CHECK. Connect a client, cause an event, assert");
    Console.WriteLine("   it arrived, on a timer, in production. It is the only test that");
    Console.WriteLine("   exercises the whole path - and, crucially, IT MUST RUN AGAINST MORE");
    Console.WriteLine("   THAN ONE INSTANCE or it reproduces the same false confidence the");
    Console.WriteLine("   original test suite had.");
    Console.WriteLine();
    Console.WriteLine("   THE BACKPLANE'S OWN HEALTH, as a dependency check. Redis being");
    Console.WriteLine("   unreachable degrades this feature silently and partially, which is the");
    Console.WriteLine("   worst way for anything to degrade.");
    Console.WriteLine();
    Console.WriteLine("   AND THE REVIEW QUESTION THAT WOULD HAVE CAUGHT IT ON DAY ONE: DOES THIS");
    Console.WriteLine("   WORK WITH TWO INSTANCES? It applies to anything holding state in");
    Console.WriteLine("   process memory - SignalR groups, in-memory caches, in-memory rate");
    Console.WriteLine("   limits, a background loop, a static dictionary. All of them are correct");
    Console.WriteLine("   on one instance and quietly wrong on two, and the change that exposes");
    Console.WriteLine("   them is a replica count rather than a deployment of your code.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<(WebApplication App, string Address)> StartServer(string name, Backplane? bus = null)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSignalR();

    var app = builder.Build();
    app.MapHub<DashboardHub>("/hubs/dashboard");

    await app.StartAsync();

    // A server subscribed to the bus delivers anything published on it to
    // whichever members of the group it holds.
    bus?.Subscribe(async (group, method, argument) =>
    {
        IHubContext<DashboardHub> hub = app.Services.GetRequiredService<IHubContext<DashboardHub>>();

        await hub.Clients.Group(group).SendAsync(method, argument);
    });

    return (app, app.Urls.First());
}

// ---------------------------------------------------------------------------
static async Task<List<Dashboard>> ConnectDashboards(string address, int count, string group)
{
    var dashboards = new List<Dashboard>();

    for (int i = 0; i < count; i++)
    {
        var received = new List<string>();
        var connection = new HubConnectionBuilder().WithUrl($"{address}/hubs/dashboard").Build();

        connection.On<string>("PaymentCaptured", id =>
        {
            lock (received)
            {
                received.Add(id);
            }
        });

        await connection.StartAsync();
        await connection.InvokeAsync("Watch", group);

        dashboards.Add(new Dashboard(connection, received));
    }

    await Task.Delay(200);

    return dashboards;
}

// ---------------------------------------------------------------------------
record Dashboard(HubConnection Connection, List<string> Received);

// ---------------------------------------------------------------------------
// Stands in for Redis or Azure SignalR Service. A publish reaches every
// subscriber; each subscriber delivers to whatever it holds.
public sealed class Backplane
{
    readonly List<Func<string, string, string, Task>> subscribers = [];

    public int Deliveries;

    public void Subscribe(Func<string, string, string, Task> handler)
    {
        lock (subscribers)
        {
            subscribers.Add(handler);
        }
    }

    public async Task PublishAsync(string group, string method, string argument)
    {
        Func<string, string, string, Task>[] snapshot;

        lock (subscribers)
        {
            snapshot = [.. subscribers];
        }

        foreach (Func<string, string, string, Task> handler in snapshot)
        {
            Interlocked.Increment(ref Deliveries);

            await handler(group, method, argument);
        }
    }
}

// ---------------------------------------------------------------------------
public sealed class DashboardHub : Hub
{
    public Task Watch(string group) => Groups.AddToGroupAsync(Context.ConnectionId, group);
}
