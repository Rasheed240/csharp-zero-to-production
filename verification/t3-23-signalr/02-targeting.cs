// 02-targeting.cs — Who a message goes to, where that routing lives, and the
// string names that nothing checks.
//
// Run:  dotnet run 02-targeting.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.SignalR.Client@10.0.0

using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

Console.WriteLine("Deciding who gets the message");
Console.WriteLine();

await WhoGetsIt();
await WhereGroupsLive();
await TheStringNames();

// ---------------------------------------------------------------------------
static async Task WhoGetsIt()
{
    Console.WriteLine("1. The targeting options, with three clients watching");
    Console.WriteLine();

    var (app, address) = await StartHub();

    // Three clients. Two of them care about merchant-42.
    var clients = new List<(string Name, HubConnection Connection, List<string> Received)>();

    foreach (string name in new[] { "alice", "bob", "carol" })
    {
        var received = new List<string>();
        var connection = new HubConnectionBuilder().WithUrl($"{address}/hubs/payments").Build();

        connection.On<string>("Update", message =>
        {
            lock (received)
            {
                received.Add(message);
            }
        });

        await connection.StartAsync();

        clients.Add((name, connection, received));
    }

    await clients[0].Connection.InvokeAsync("JoinGroup", "merchant-42");
    await clients[1].Connection.InvokeAsync("JoinGroup", "merchant-42");

    await Task.Delay(200);

    IHubContext<PaymentsHub> hub = app.Services.GetRequiredService<IHubContext<PaymentsHub>>();

    string aliceId = clients[0].Connection.ConnectionId!;

    await hub.Clients.All.SendAsync("Update", "All");
    await hub.Clients.Group("merchant-42").SendAsync("Update", "Group");
    await hub.Clients.Client(aliceId).SendAsync("Update", "Client(alice)");
    await hub.Clients.AllExcept(aliceId).SendAsync("Update", "AllExcept(alice)");
    await hub.Clients.GroupExcept("merchant-42", aliceId).SendAsync("Update", "GroupExcept(alice)");
    await hub.Clients.User("alice").SendAsync("Update", "User(alice)");

    await Task.Delay(400);

    Console.WriteLine("   client   in merchant-42   received");
    Console.WriteLine("   ------   --------------   --------");

    foreach ((string name, _, List<string> received) in clients)
    {
        bool inGroup = name is "alice" or "bob";

        Console.WriteLine($"   {name,-8} {(inGroup ? "yes" : "no"),-16} {string.Join(", ", received)}");
    }

    foreach ((_, HubConnection connection, _) in clients)
    {
        await connection.DisposeAsync();
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE FIRST FIVE BEHAVED AS THEIR NAMES SUGGEST. The sixth did not reach");
    Console.WriteLine("   anybody.");
    Console.WriteLine();
    Console.WriteLine("   Clients.User(\"alice\") TARGETS AN AUTHENTICATED IDENTITY, not a name you");
    Console.WriteLine("   made up. With no authentication configured there are no user");
    Console.WriteLine("   identifiers, so the set of connections matching 'alice' is empty - and");
    Console.WriteLine("   SENDING TO AN EMPTY SET IS NOT AN ERROR. It succeeds, silently, and");
    Console.WriteLine("   reaches nobody.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS TRUE OF EVERY TARGETING CALL. A misspelled group name, a");
    Console.WriteLine("   connection id that has since reconnected, a user who is not online: all");
    Console.WriteLine("   of them are a successful send to zero recipients. THERE IS NO DELIVERY");
    Console.WriteLine("   RECEIPT AND NO ERROR, which is why 'the notification did not arrive' is");
    Console.WriteLine("   such a hard ticket to work.");
    Console.WriteLine();
    Console.WriteLine("   WHEN TO USE WHICH:");
    Console.WriteLine();
    Console.WriteLine("     Clients.All          Rarely what you want in a multi-tenant system.");
    Console.WriteLine("                          It is every connected client of every customer.");
    Console.WriteLine();
    Console.WriteLine("     Clients.Group        The workhorse. A group is a routing key -");
    Console.WriteLine("                          a merchant, a document, a chat room.");
    Console.WriteLine();
    Console.WriteLine("     Clients.User         The right tool for 'tell this person', because");
    Console.WriteLine("                          it reaches all their tabs and devices at once");
    Console.WriteLine("                          and survives their reconnects. Needs auth.");
    Console.WriteLine();
    Console.WriteLine("     Clients.Client       For replying to one specific connection. Valid");
    Console.WriteLine("                          only until that connection drops, so storing a");
    Console.WriteLine("                          connection id for later is usually a bug.");
    Console.WriteLine();
    Console.WriteLine("     Clients.Caller       Inside a hub method, the one that called it.");
    Console.WriteLine("     Clients.Others       Everyone except the caller - the shape almost");
    Console.WriteLine("                          every chat and collaboration feature wants.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhereGroupsLive()
{
    Console.WriteLine("2. Where a group actually lives");
    Console.WriteLine();
    Console.WriteLine("   'Add this connection to merchant-42' sounds like a database write. It");
    Console.WriteLine("   is a dictionary entry in one process.");
    Console.WriteLine();

    var (app, address) = await StartHub();

    var connection = new HubConnectionBuilder().WithUrl($"{address}/hubs/payments").Build();
    await connection.StartAsync();

    await connection.InvokeAsync("JoinGroup", "merchant-42");
    await Task.Delay(150);

    Console.WriteLine($"   members of merchant-42, as this server sees it   " +
        $"{PaymentsHub.GroupMembers("merchant-42")}");

    // What the framework will actually deliver to, which is the number that
    // matters: a send to the group, counted at the client.
    var received = new List<string>();
    connection.On<string>("Update", m => received.Add(m));

    IHubContext<PaymentsHub> hub = app.Services.GetRequiredService<IHubContext<PaymentsHub>>();

    await hub.Clients.Group("merchant-42").SendAsync("Update", "to the group");
    await hub.Clients.Group("merchant-99").SendAsync("Update", "to a group nobody joined");
    await Task.Delay(300);

    Console.WriteLine($"   messages the client actually received           {received.Count}");
    Console.WriteLine($"   sending to a group with no members             succeeded, reached nobody");

    await connection.DisposeAsync();
    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THERE IS NO SHARED GROUP REGISTRY. A group is a mapping from a name to");
    Console.WriteLine("   a set of connection ids, held by the process those connections are");
    Console.WriteLine("   attached to - which is the only process that could write to them");
    Console.WriteLine("   anyway.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS OBVIOUSLY CORRECT AND IT IS THE ROOT OF THE MODULE'S INCIDENT.");
    Console.WriteLine("   A connection lives on exactly one server. A group therefore lives on");
    Console.WriteLine("   whichever servers happen to hold its members. AND A SERVER CANNOT SEND");
    Console.WriteLine("   TO A CONNECTION IT DOES NOT HOLD - there is no socket to write to.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS WHY THE MOMENT YOU RUN A SECOND REPLICA, EVERY BROADCAST");
    Console.WriteLine("   BECOMES PARTIAL unless something carries messages between the servers.");
    Console.WriteLine("   That something is a backplane, and it is the subject of the next file.");
    Console.WriteLine();
    Console.WriteLine("   ONE MORE CONSEQUENCE WORTH SPELLING OUT: GROUP MEMBERSHIP IS NOT");
    Console.WriteLine("   QUERYABLE. There is no API for 'who is in merchant-42' or 'which groups");
    Console.WriteLine("   is this connection in'. If you need to know, you keep your own record");
    Console.WriteLine("   alongside - and then you own keeping it correct across disconnects,");
    Console.WriteLine("   reconnects and server restarts, which is harder than it sounds and is a");
    Console.WriteLine("   very common source of slow memory leaks.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheStringNames()
{
    Console.WriteLine("3. The method names nothing checks");
    Console.WriteLine();

    var (app, address) = await StartHub();

    var connection = new HubConnectionBuilder().WithUrl($"{address}/hubs/payments").Build();

    var correct = new List<string>();
    var misspelled = new List<string>();

    connection.On<string>("Update", m => correct.Add(m));
    connection.On<string>("Updated", m => misspelled.Add(m));

    await connection.StartAsync();

    IHubContext<PaymentsHub> hub = app.Services.GetRequiredService<IHubContext<PaymentsHub>>();

    await hub.Clients.All.SendAsync("Update", "spelled the way the client expects");
    await Task.Delay(200);

    int afterCorrect = correct.Count;

    await hub.Clients.All.SendAsync("Updat", "one letter short");
    await Task.Delay(200);

    int afterMisspelled = correct.Count;

    // And the same in the other direction.
    string invokeResult;

    try
    {
        invokeResult = await connection.InvokeAsync<string>("Ecko", "hello");
    }
    catch (Exception exception)
    {
        invokeResult = $"{exception.GetType().Name}";
    }

    Console.WriteLine($"   server sent \"Update\", client listens for \"Update\"   " +
        $"handler ran {afterCorrect} time");
    Console.WriteLine($"   server sent \"Updat\", client listens for \"Update\"    " +
        $"handler ran {afterMisspelled} time still - no error anywhere");
    Console.WriteLine($"   client invoked \"Ecko\", hub has \"Echo\"              " +
        $"{invokeResult}");

    await connection.DisposeAsync();
    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE TWO DIRECTIONS FAIL DIFFERENTLY, AND ONLY ONE OF THEM TELLS YOU.");
    Console.WriteLine();
    Console.WriteLine("     SERVER TO CLIENT IS SILENT. The server writes a message naming a");
    Console.WriteLine("     method the client has no handler for; the client ignores it. No");
    Console.WriteLine("     error on either side, and the feature simply does not work.");
    Console.WriteLine();
    Console.WriteLine("     CLIENT TO SERVER THROWS, because the client is waiting for a reply");
    Console.WriteLine("     and the server reports that the method does not exist. That is only");
    Console.WriteLine("     true for InvokeAsync - SendAsync does not wait, so it is silent too.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX FOR HALF OF IT IS A STRONGLY TYPED HUB, and it costs one");
    Console.WriteLine("   interface:");
    Console.WriteLine();
    Console.WriteLine("     public interface IPaymentsClient");
    Console.WriteLine("     {");
    Console.WriteLine("         Task Update(string message);");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("     public sealed class PaymentsHub : Hub<IPaymentsClient>");
    Console.WriteLine("     {");
    Console.WriteLine("         public Task Notify() => Clients.All.Update(\"...\");");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   Now the server side is a compile error rather than silence, and");
    Console.WriteLine("   renaming the method updates every call site. THE CLIENT SIDE IS STILL A");
    Console.WriteLine("   STRING unless the client is also C# and shares the interface - which in");
    Console.WriteLine("   a browser it is not.");
    Console.WriteLine();
    Console.WriteLine("   SO THE HONEST POSITION IS: THE HUB IS A NETWORK BOUNDARY WITH A METHOD");
    Console.WriteLine("   CALL'S SYNTAX. It looks like a call and it is a message with a name in");
    Console.WriteLine("   it, and every rule about versioning a message format applies - which is");
    Console.WriteLine("   the same trap as a queued job naming a method that has been renamed.");
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
    static readonly Dictionary<string, HashSet<string>> Membership = [];

    public static int GroupMembers(string group)
    {
        lock (Membership)
        {
            return Membership.TryGetValue(group, out HashSet<string>? members) ? members.Count : 0;
        }
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        lock (Membership)
        {
            foreach (HashSet<string> members in Membership.Values)
            {
                members.Remove(Context.ConnectionId);
            }
        }

        return base.OnDisconnectedAsync(exception);
    }

    public string Echo(string message) => message;

    public async Task JoinGroup(string group)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, group);

        lock (Membership)
        {
            if (!Membership.TryGetValue(group, out HashSet<string>? members))
            {
                members = [];
                Membership[group] = members;
            }

            members.Add(Context.ConnectionId);
        }
    }
}
