// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: the counts and outcomes are deterministic. The timings are
// machine-specific; the claims are the gaps between the rows.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.SignalR.Client@10.0.0

using System.Diagnostics;
using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

await One();
await Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static async Task One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the notification that reaches nobody");
    Console.WriteLine();
    Console.WriteLine("   A service notifies one user: Clients.User(userId).SendAsync(...). It");
    Console.WriteLine("   never arrives. The user is definitely connected, the code definitely");
    Console.WriteLine("   runs, and nothing throws.");
    Console.WriteLine();

    Console.WriteLine("   how the connection identifies itself   User(\"u-7\") reached");
    Console.WriteLine("   ------------------------------------   -------------------");

    foreach (bool withIdentity in new[] { false, true })
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddSignalR();

        // With an identity, a user id provider can map the connection to
        // "u-7". Without one there is nothing to map.
        if (withIdentity)
        {
            builder.Services.AddSingleton<IUserIdProvider, QueryStringUserIdProvider>();
        }

        var app = builder.Build();
        app.MapHub<NotifyHub>("/hubs/notify");

        await app.StartAsync();

        var received = new List<string>();
        var connection = new HubConnectionBuilder()
            .WithUrl($"{app.Urls.First()}/hubs/notify?user=u-7")
            .Build();

        connection.On<string>("Notify", m => received.Add(m));
        await connection.StartAsync();
        await Task.Delay(150);

        IHubContext<NotifyHub> hub = app.Services.GetRequiredService<IHubContext<NotifyHub>>();
        await hub.Clients.User("u-7").SendAsync("Notify", "your payment settled");
        await Task.Delay(300);

        Console.WriteLine($"   {(withIdentity ? "with an IUserIdProvider" : "no identity configured"),-38} " +
            $"{received.Count} of 1");

        await connection.DisposeAsync();
        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: Clients.User TARGETS AN IDENTITY THE HUB CAN SEE, and without");
    Console.WriteLine("   authentication - or an IUserIdProvider that derives one from something");
    Console.WriteLine("   else - no connection has a user id, so the set of matching connections");
    Console.WriteLine("   is empty.");
    Console.WriteLine();
    Console.WriteLine("   AND SENDING TO AN EMPTY SET IS NOT AN ERROR. The call succeeds. There is");
    Console.WriteLine("   no delivery receipt, no recipient count, and nothing in a log. THE");
    Console.WriteLine("   FEATURE JUST DOES NOT WORK, which is the hardest kind of failure to");
    Console.WriteLine("   chase because there is no evidence of it anywhere on the server.");
    Console.WriteLine();
    Console.WriteLine("   THE SAME IS TRUE OF EVERY TARGETING CALL: a misspelled group name, a");
    Console.WriteLine("   stale connection id, a user who is offline. All of them are a");
    Console.WriteLine("   successful send to zero recipients.");
    Console.WriteLine();
    Console.WriteLine("   WHICH SUGGESTS A HABIT WORTH FORMING: WHEN A REAL-TIME FEATURE DOES NOT");
    Console.WriteLine("   WORK, PROVE THE RECIPIENT SET IS NOT EMPTY FIRST. Send to Clients.All");
    Console.WriteLine("   and see whether anything arrives. If it does, the problem is the");
    Console.WriteLine("   targeting rather than the connection, and you have halved the search.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the dashboards that stop updating after a deploy");
    Console.WriteLine();
    Console.WriteLine("   Every deployment, a proportion of dashboards go quiet. They are");
    Console.WriteLine("   connected - the connection indicator is green - and they never receive");
    Console.WriteLine("   another update until the page is refreshed.");
    Console.WriteLine();

    Console.WriteLine("   hub                                  updates after the client reconnects");
    Console.WriteLine("   ---                                  ----------------------------------");

    foreach (bool rejoins in new[] { false, true })
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddSignalR();
        builder.Services.AddSingleton(new HubOptionsHolder { RejoinOnConnect = rejoins });

        var app = builder.Build();
        app.MapHub<DashboardHub>("/hubs/dashboard");

        await app.StartAsync();

        var received = new List<string>();

        // The query string carries what this client cares about, so the hub
        // can restore it without being asked.
        var connection = new HubConnectionBuilder()
            .WithUrl($"{app.Urls.First()}/hubs/dashboard?merchant=merchant-42")
            .Build();

        connection.On<string>("Update", m => received.Add(m));

        await connection.StartAsync();
        await connection.InvokeAsync("Watch", "merchant-42");
        await Task.Delay(150);

        // The deployment: the client goes away and comes back.
        await connection.StopAsync();
        await Task.Delay(150);
        await connection.StartAsync();
        await Task.Delay(200);

        IHubContext<DashboardHub> hub = app.Services.GetRequiredService<IHubContext<DashboardHub>>();
        await hub.Clients.Group("merchant-42").SendAsync("Update", "PAY-001");
        await Task.Delay(300);

        Console.WriteLine($"   {(rejoins ? "rejoins groups in OnConnectedAsync" : "waits to be told again"),-36} " +
            $"{received.Count} of 1");

        await connection.DisposeAsync();
        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE RECONNECT RESTORED THE CONNECTION AND NOT THE GROUP. A new");
    Console.WriteLine("   connection has a new id and belongs to nothing; the client thinks it is");
    Console.WriteLine("   still watching merchant-42 because from its side nothing changed.");
    Console.WriteLine();
    Console.WriteLine("   'CONNECTED' AND 'SUBSCRIBED' ARE DIFFERENT STATES AND ONLY ONE OF THEM");
    Console.WriteLine("   IS VISIBLE. The green indicator is telling the truth and answering a");
    Console.WriteLine("   question nobody asked.");
    Console.WriteLine();
    Console.WriteLine("   THERE ARE TWO PLACES TO PUT THE FIX AND YOU WANT THE FIRST:");
    Console.WriteLine();
    Console.WriteLine("     ON THE SERVER, in OnConnectedAsync, from something the connection");
    Console.WriteLine("     carries with it - a claim, a query string, a route value. It works");
    Console.WriteLine("     for every client, including ones written by somebody else, and it");
    Console.WriteLine("     cannot be forgotten by a client author.");
    Console.WriteLine();
    Console.WriteLine("     ON THE CLIENT, in the Reconnected handler. Necessary when only the");
    Console.WriteLine("     client knows what it wants - a filter the user changed, a document");
    Console.WriteLine("     they opened - and it is one more thing every client must remember to");
    Console.WriteLine("     do.");
    Console.WriteLine();
    Console.WriteLine("   AND WHILE YOU ARE THERE: THE REJOIN IS ALSO WHERE YOU RE-READ THE");
    Console.WriteLine("   STATE. The client missed everything sent while it was away, so");
    Console.WriteLine("   rejoining the group makes it current from now on and leaves it wrong");
    Console.WriteLine("   about the gap.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the hub that serialises everything");
    Console.WriteLine();
    Console.WriteLine("   A hub method calls a slow report service. A client fires four of them");
    Console.WriteLine("   at once, expecting them to overlap. They take four times as long as");
    Console.WriteLine("   one, and the same client's other messages stall behind them.");
    Console.WriteLine();

    Console.WriteLine("   MaximumParallelInvocationsPerClient   four 200 ms calls took");
    Console.WriteLine("   -----------------------------------   ----------------------");

    foreach (int parallel in new[] { 1, 4 })
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddSignalR(options =>
            options.MaximumParallelInvocationsPerClient = parallel);

        var app = builder.Build();
        app.MapHub<SlowHub>("/hubs/slow");

        await app.StartAsync();

        var connection = new HubConnectionBuilder()
            .WithUrl($"{app.Urls.First()}/hubs/slow")
            .Build();

        await connection.StartAsync();

        var clock = Stopwatch.StartNew();

        await Task.WhenAll(Enumerable.Range(0, 4)
            .Select(_ => connection.InvokeAsync<string>("SlowCall")));

        clock.Stop();

        Console.WriteLine($"   {parallel,35}   {clock.Elapsed.TotalMilliseconds,18:0} ms");

        await connection.DisposeAsync();
        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE DEFAULT IS ONE. A hub processes one invocation per client");
    Console.WriteLine("   at a time, so four calls from one connection run one after another.");
    Console.WriteLine("   Raising the limit lets them overlap.");
    Console.WriteLine();
    Console.WriteLine("   THE DEFAULT IS DELIBERATE AND IT IS PROTECTING YOU FROM SOMETHING REAL:");
    Console.WriteLine("   with unbounded parallelism, one client can occupy as many threads as it");
    Console.WriteLine("   likes by sending as fast as it can, and the messages a hub receives are");
    Console.WriteLine("   under the client's control rather than yours.");
    Console.WriteLine();
    Console.WriteLine("   IT ALSO GIVES YOU ORDERING. With one invocation at a time, messages");
    Console.WriteLine("   from a client are handled in the order they were sent - which a");
    Console.WriteLine("   surprising amount of code assumes without saying so. RAISE THE LIMIT");
    Console.WriteLine("   AND YOU HAVE GIVEN THAT UP, and any hub method whose correctness");
    Console.WriteLine("   depended on it is now racy.");
    Console.WriteLine();
    Console.WriteLine("   SO THE FIX IS USUALLY NOT THE SETTING. IT IS TO STOP DOING SLOW WORK IN");
    Console.WriteLine("   A HUB METHOD. A hub is a message dispatcher; a two-hundred-millisecond");
    Console.WriteLine("   report belongs in a job, with the hub used to tell the client when it");
    Console.WriteLine("   is ready. THAT ALSO SURVIVES THE CLIENT DISCONNECTING HALFWAY, which a");
    Console.WriteLine("   long hub invocation does not.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - the message that kills the connection");
    Console.WriteLine();
    Console.WriteLine("   A client sends a batch of edits as one message. Small batches work.");
    Console.WriteLine("   Large ones disconnect the client, with no error the client can");
    Console.WriteLine("   usefully report and no exception on the server.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSignalR();

    var app = builder.Build();
    app.MapHub<SlowHub>("/hubs/slow");

    await app.StartAsync();

    Console.WriteLine("   message size   outcome");
    Console.WriteLine("   ------------   -------");

    foreach (int kilobytes in new[] { 8, 31, 64, 256 })
    {
        var connection = new HubConnectionBuilder()
            .WithUrl($"{app.Urls.First()}/hubs/slow")
            .Build();

        await connection.StartAsync();

        string payload = new('x', kilobytes * 1024);
        string outcome;

        try
        {
            int length = await connection.InvokeAsync<int>("Receive", payload);

            outcome = $"accepted, server saw {length / 1024} KB";
        }
        catch (Exception exception)
        {
            outcome = $"{exception.GetType().Name}, connection is {connection.State}";
        }

        Console.WriteLine($"   {kilobytes,9} KB   {outcome}");

        await connection.DisposeAsync();
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: HubOptions.MaximumReceiveMessageSize DEFAULTS TO 32 KB, and a");
    Console.WriteLine("   message over it does not fail the invocation - IT TERMINATES THE");
    Console.WriteLine("   CONNECTION. There is no way to send half a message, so the only");
    Console.WriteLine("   available response is to stop.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS WHY THE SYMPTOM IS 'THE CLIENT DISCONNECTS' RATHER THAN 'THE");
    Console.WriteLine("   CALL FAILED'. If the client reconnects automatically and retries the");
    Console.WriteLine("   same batch, it disconnects again - a loop that looks like a network");
    Console.WriteLine("   problem and is a size limit.");
    Console.WriteLine();
    Console.WriteLine("   RAISING THE LIMIT IS ONE LINE AND IS USUALLY THE WRONG FIX:");
    Console.WriteLine();
    Console.WriteLine("     builder.Services.AddSignalR(options =>");
    Console.WriteLine("         options.MaximumReceiveMessageSize = 256 * 1024);");
    Console.WriteLine();
    Console.WriteLine("   It is a limit on a message held in memory, per client, on a connection");
    Console.WriteLine("   the client controls the timing of. Raising it to a megabyte with ten");
    Console.WriteLine("   thousand connections is a megabyte times however many of them decide to");
    Console.WriteLine("   send at once.");
    Console.WriteLine();
    Console.WriteLine("   THE BETTER ANSWERS, IN ORDER:");
    Console.WriteLine();
    Console.WriteLine("     SEND LESS. A batch of edits is a batch because somebody batched it.");
    Console.WriteLine("     Smaller messages are also lower latency and fail in smaller pieces.");
    Console.WriteLine();
    Console.WriteLine("     STREAM IT. SignalR supports streaming in both directions, which");
    Console.WriteLine("     bounds memory per message regardless of the total.");
    Console.WriteLine();
    Console.WriteLine("     OR DO NOT USE THE HUB. Large payloads are what HTTP is for: POST the");
    Console.WriteLine("     batch, and use the hub to say it is done. A REAL-TIME CHANNEL IS FOR");
    Console.WriteLine("     SMALL, FREQUENT, TIME-SENSITIVE MESSAGES, and a large upload is none");
    Console.WriteLine("     of those things.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// Derives a user id from the query string, which stands in for deriving it
// from an authenticated identity.
public sealed class QueryStringUserIdProvider : IUserIdProvider
{
    public string? GetUserId(HubConnectionContext connection) =>
        connection.GetHttpContext()?.Request.Query["user"].ToString() is { Length: > 0 } user
            ? user
            : null;
}

// ---------------------------------------------------------------------------
public sealed class NotifyHub : Hub;

// ---------------------------------------------------------------------------
public sealed class HubOptionsHolder
{
    public bool RejoinOnConnect { get; init; }
}

// ---------------------------------------------------------------------------
public sealed class DashboardHub(HubOptionsHolder options) : Hub
{
    public override async Task OnConnectedAsync()
    {
        // The fix: restore the group from something the connection carries,
        // without waiting to be asked.
        if (options.RejoinOnConnect
            && Context.GetHttpContext()?.Request.Query["merchant"].ToString() is { Length: > 0 } merchant)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, merchant);
        }

        await base.OnConnectedAsync();
    }

    public Task Watch(string group) => Groups.AddToGroupAsync(Context.ConnectionId, group);
}

// ---------------------------------------------------------------------------
public sealed class SlowHub : Hub
{
    public async Task<string> SlowCall()
    {
        await Task.Delay(200);

        return "done";
    }

    public int Receive(string payload) => payload.Length;
}

// ---------------------------------------------------------------------------
// Claims are unused here but the type keeps the identity example honest about
// where a user id normally comes from.
file static class Unused
{
    public static string? UserId(ClaimsPrincipal principal) =>
        principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
}
