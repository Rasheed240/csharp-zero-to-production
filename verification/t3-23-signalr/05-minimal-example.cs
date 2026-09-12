// 05-minimal-example.cs — One hub with every decision made: a typed client
// contract, groups restored on connect, presence counted rather than assumed,
// bounded work, and a push that is a hint rather than a record.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.SignalR.Client@10.0.0

using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

builder.Services.AddSingleton<Presence>();
builder.Services.AddSingleton<PaymentStore>();

// DECISION 1: a user id provider, so Clients.User works. In a real service
// this comes from the authenticated identity rather than the query string.
builder.Services.AddSingleton<IUserIdProvider, QueryStringUserIdProvider>();

builder.Services.AddSignalR(options =>
{
    // DECISION 2: the message size limit is left at its default and stated.
    // Anything larger is an HTTP request, not a hub message.
    options.MaximumReceiveMessageSize = 32 * 1024;

    // One invocation at a time per client: ordering is preserved and one
    // client cannot occupy unbounded server capacity.
    options.MaximumParallelInvocationsPerClient = 1;
});

var app = builder.Build();

app.MapHub<PaymentsHub>("/hubs/payments");

// DECISION 3: the truth is available over HTTP. The hub says when to look.
app.MapGet("/v1/merchants/{merchantId}/payments", (string merchantId, PaymentStore store) =>
    Results.Ok(store.For(merchantId)));

await app.StartAsync();

string address = app.Urls.First();
var store = app.Services.GetRequiredService<PaymentStore>();
var presence = app.Services.GetRequiredService<Presence>();

Console.WriteLine("One hub, every decision made");
Console.WriteLine();

// Two tabs for one user, both watching the same merchant.
var tabs = new List<(HubConnection Connection, List<string> Received)>();

for (int i = 0; i < 2; i++)
{
    var received = new List<string>();
    var connection = new HubConnectionBuilder()
        .WithUrl($"{address}/hubs/payments?user=u-7&merchant=merchant-42")
        .Build();

    connection.On<string, string>("PaymentChanged", (id, status) =>
    {
        lock (received)
        {
            received.Add($"{id}:{status}");
        }
    });

    await connection.StartAsync();

    tabs.Add((connection, received));
}

await Task.Delay(300);

Console.WriteLine($"   one user, two tabs        {presence.ConnectionsFor("u-7")} connections, " +
    $"online: {presence.IsOnline("u-7")}");

// A payment is captured. The record is written first; the push is a hint.
IHubContext<PaymentsHub, IPaymentsClient> hub =
    app.Services.GetRequiredService<IHubContext<PaymentsHub, IPaymentsClient>>();

store.Record("merchant-42", "PAY-001", "captured");
await hub.Clients.Group("merchant-42").PaymentChanged("PAY-001", "captured");

await Task.Delay(300);

Console.WriteLine($"   after one capture         tab 1 got {tabs[0].Received.Count}, " +
    $"tab 2 got {tabs[1].Received.Count}");

// One tab goes away and comes back - a deploy, a lid, a wifi handover - and
// something is pushed while it is gone.
await tabs[0].Connection.StopAsync();

store.Record("merchant-42", "PAY-002", "captured");
await hub.Clients.Group("merchant-42").PaymentChanged("PAY-002", "captured");

await Task.Delay(200);
await tabs[0].Connection.StartAsync();
await Task.Delay(300);

Console.WriteLine($"   after a push while away   tab 1 got {tabs[0].Received.Count}, " +
    $"tab 2 got {tabs[1].Received.Count}");

// The client's half of the fix: on reconnect, re-read the truth.
using var http = new HttpClient { BaseAddress = new Uri(address) };
string current = await http.GetStringAsync("/v1/merchants/merchant-42/payments");

Console.WriteLine($"   what a refetch returns    {current}");

// And a push after the reconnect reaches it again, because the hub rejoined
// the group without being asked.
store.Record("merchant-42", "PAY-003", "captured");
await hub.Clients.Group("merchant-42").PaymentChanged("PAY-003", "captured");
await Task.Delay(300);

Console.WriteLine($"   after a push once back    tab 1 got {tabs[0].Received.Count}, " +
    $"tab 2 got {tabs[1].Received.Count}");

// Presence: closing one tab does not take the user offline.
await tabs[0].Connection.DisposeAsync();
await Task.Delay(300);

Console.WriteLine();
Console.WriteLine($"   after closing one tab     {presence.ConnectionsFor("u-7")} connections, " +
    $"online: {presence.IsOnline("u-7")}");

await tabs[1].Connection.DisposeAsync();
await Task.Delay(300);

Console.WriteLine($"   after closing both        {presence.ConnectionsFor("u-7")} connections, " +
    $"online: {presence.IsOnline("u-7")}");

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   EVERY DECISION, AND WHY:");
Console.WriteLine();
Console.WriteLine("     THE CLIENT CONTRACT IS AN INTERFACE. Hub<IPaymentsClient> means");
Console.WriteLine("     Clients.Group(...).PaymentChanged(...) is a compile-time call rather");
Console.WriteLine("     than a string, so renaming it updates every call site and misspelling");
Console.WriteLine("     it does not build. The browser side is still a string - that half");
Console.WriteLine("     cannot be fixed from C# - but the half that can be is.");
Console.WriteLine();
Console.WriteLine("     GROUPS ARE RESTORED IN OnConnectedAsync, from the query string. Look at");
Console.WriteLine("     the last push: tab 1 had reconnected as a completely different");
Console.WriteLine("     connection and still received it, because the server put it back in the");
Console.WriteLine("     group without being asked. A client that forgets to resubscribe is not");
Console.WriteLine("     a client that stops working.");
Console.WriteLine();
Console.WriteLine("     THE PUSH IS A HINT AND THE STORE IS THE RECORD. PAY-002 was pushed");
Console.WriteLine("     while tab 1 was away and tab 1 never received it - that message is gone");
Console.WriteLine("     forever. The refetch returned BOTH payments, including the one tab 1");
Console.WriteLine("     missed, because the truth was written before the hint was sent. That is");
Console.WriteLine("     how a client recovers from a gap it cannot even detect.");
Console.WriteLine();
Console.WriteLine("     PRESENCE IS A COUNT, NOT A FLAG. One user with two tabs is two");
Console.WriteLine("     connections; closing one leaves them online. Setting a user offline in");
Console.WriteLine("     OnDisconnectedAsync would have marked them away while they were looking");
Console.WriteLine("     at the other tab.");
Console.WriteLine();
Console.WriteLine("     ONE INVOCATION AT A TIME, AND A 32 KB CEILING. Both are the defaults and");
Console.WriteLine("     both are written down, because a default nobody chose is a decision");
Console.WriteLine("     nobody made. Anything bigger or slower than those limits belongs in an");
Console.WriteLine("     HTTP request or a background job, with the hub used to say it is done.");
Console.WriteLine();
Console.WriteLine("   WHAT THIS STILL NEEDS BEFORE A SECOND REPLICA:");
Console.WriteLine();
Console.WriteLine("     A BACKPLANE. Everything above is correct on one instance and partially");
Console.WriteLine("     correct on two, because a server can only write to connections it");
Console.WriteLine("     holds. AddStackExchangeRedis is one line and it is not optional the");
Console.WriteLine("     moment the replica count is greater than one.");
Console.WriteLine();
Console.WriteLine("     AND THE PRESENCE COUNT IS PER PROCESS TOO. A user with a tab on each of");
Console.WriteLine("     two instances is counted as one connection on each, and neither knows");
Console.WriteLine("     about the other. Presence that has to be right across a fleet is a");
Console.WriteLine("     shared store, not a dictionary - which is the same lesson as the groups,");
Console.WriteLine("     arriving a second time.");

// ---------------------------------------------------------------------------
// The client contract, as an interface rather than a set of strings.
public interface IPaymentsClient
{
    Task PaymentChanged(string paymentId, string status);
}

// ---------------------------------------------------------------------------
public sealed class PaymentsHub(Presence presence) : Hub<IPaymentsClient>
{
    public override async Task OnConnectedAsync()
    {
        IQueryCollection? query = Context.GetHttpContext()?.Request.Query;

        // Restore the subscription from something the connection carries, so a
        // reconnect does not depend on the client remembering to resubscribe.
        if (query?["merchant"].ToString() is { Length: > 0 } merchant)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, merchant);
        }

        if (Context.UserIdentifier is { Length: > 0 } user)
        {
            presence.Connected(user);
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.UserIdentifier is { Length: > 0 } user)
        {
            presence.Disconnected(user);
        }

        await base.OnDisconnectedAsync(exception);
    }

    // Still available for subscriptions only the client knows about.
    public Task Watch(string merchantId) =>
        Groups.AddToGroupAsync(Context.ConnectionId, merchantId);
}

// ---------------------------------------------------------------------------
// Presence is a count per user, because a connection is a tab rather than a
// person.
public sealed class Presence
{
    readonly ConcurrentDictionary<string, int> connections = new();

    public void Connected(string userId) =>
        connections.AddOrUpdate(userId, 1, (_, count) => count + 1);

    public void Disconnected(string userId) =>
        connections.AddOrUpdate(userId, 0, (_, count) => Math.Max(0, count - 1));

    public int ConnectionsFor(string userId) =>
        connections.TryGetValue(userId, out int count) ? count : 0;

    public bool IsOnline(string userId) => ConnectionsFor(userId) > 0;
}

// ---------------------------------------------------------------------------
// The record. Written before the hint is pushed, and readable over HTTP by any
// client that missed one.
public sealed class PaymentStore
{
    readonly ConcurrentDictionary<string, List<string>> byMerchant = new();

    public void Record(string merchantId, string paymentId, string status)
    {
        List<string> payments = byMerchant.GetOrAdd(merchantId, _ => []);

        lock (payments)
        {
            payments.Add($"{paymentId}:{status}");
        }
    }

    public string[] For(string merchantId)
    {
        if (!byMerchant.TryGetValue(merchantId, out List<string>? payments))
        {
            return [];
        }

        lock (payments)
        {
            return [.. payments];
        }
    }
}

// ---------------------------------------------------------------------------
// Stands in for deriving the user id from an authenticated identity.
public sealed class QueryStringUserIdProvider : IUserIdProvider
{
    public string? GetUserId(HubConnectionContext connection) =>
        connection.GetHttpContext()?.Request.Query["user"].ToString() is { Length: > 0 } user
            ? user
            : null;
}
