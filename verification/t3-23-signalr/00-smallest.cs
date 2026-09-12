// 00-smallest.cs — The smallest hub, a real client connecting to it, and the
// four things that are already different from a request.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every count, state and message here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.AspNetCore.SignalR.Client@10.0.0

using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The whole server side.
builder.Services.AddSignalR();

var app = builder.Build();

app.MapHub<PaymentsHub>("/hubs/payments");

// An ordinary endpoint, for comparison.
app.MapGet("/v1/payments/{id}", (string id) => Results.Ok(new { id, status = "captured" }));

await app.StartAsync();

string baseAddress = app.Urls.First();

Console.WriteLine("The smallest hub");
Console.WriteLine();

// The client side.
var connection = new HubConnectionBuilder()
    .WithUrl($"{baseAddress}/hubs/payments")
    .Build();

var received = new List<string>();

// The server can call this. Nothing asked for it.
connection.On<string, string>("PaymentUpdated", (id, status) =>
{
    lock (received)
    {
        received.Add($"{id} -> {status}");
    }
});

Console.WriteLine($"   before connecting   state {connection.State}");

await connection.StartAsync();

Console.WriteLine($"   after connecting    state {connection.State}, id {connection.ConnectionId}");
Console.WriteLine();

// 1. The client calls the server, and gets a return value.
string ack = await connection.InvokeAsync<string>("Watch", "PAY-001");

Console.WriteLine($"   client called Watch(\"PAY-001\")   server returned \"{ack}\"");

// 2. The server calls the client, whenever it likes.
IHubContext<PaymentsHub> hub = app.Services.GetRequiredService<IHubContext<PaymentsHub>>();

await hub.Clients.All.SendAsync("PaymentUpdated", "PAY-001", "captured");
await hub.Clients.All.SendAsync("PaymentUpdated", "PAY-001", "settled");

await Task.Delay(300);

Console.WriteLine($"   server pushed twice, unprompted   client received {received.Count}: " +
    $"{string.Join("; ", received)}");
Console.WriteLine();

Console.WriteLine($"   connections the hub has seen      {PaymentsHub.Connected} connected, " +
    $"{PaymentsHub.Disconnected} disconnected");

await connection.DisposeAsync();
await Task.Delay(300);

Console.WriteLine($"   after the client disposes         {PaymentsHub.Connected} connected, " +
    $"{PaymentsHub.Disconnected} disconnected");

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   FOUR THINGS THAT ARE ALREADY DIFFERENT FROM A REQUEST:");
Console.WriteLine();
Console.WriteLine("     1. THE SERVER SPEAKS FIRST. Nothing asked for those two messages. A");
Console.WriteLine("        request/response endpoint cannot do that at all - the whole reason");
Console.WriteLine("        this exists is that the interesting event happens on the server and");
Console.WriteLine("        the client has no way to know when to ask.");
Console.WriteLine();
Console.WriteLine("     2. THERE IS STATE ON THE SERVER PER CLIENT. A connection id, a hub");
Console.WriteLine("        instance, whatever groups it has joined. That state lives in ONE");
Console.WriteLine("        SERVER'S MEMORY, which is the fact the rest of this module keeps");
Console.WriteLine("        coming back to.");
Console.WriteLine();
Console.WriteLine("     3. THE CONNECTION HAS A LIFECYCLE YOU HAVE TO HANDLE. It connects, it");
Console.WriteLine("        drops, it may reconnect with a NEW id. A request has none of this");
Console.WriteLine("        because a request is over before you have finished thinking about");
Console.WriteLine("        it.");
Console.WriteLine();
Console.WriteLine("     4. THE HUB METHOD NAMES ARE STRINGS ON BOTH SIDES. \"Watch\" and");
Console.WriteLine("        \"PaymentUpdated\" are matched by name at runtime. Rename either and");
Console.WriteLine("        nothing fails to compile - the call quietly goes nowhere.");
Console.WriteLine();
Console.WriteLine("   THE FOURTH IS THE CHEAPEST TO FIX AND THE EASIEST TO FORGET, and the");
Console.WriteLine("   other three are what the rest of the module is about.");

// ---------------------------------------------------------------------------
// A hub is a class the framework creates per invocation, like a controller.
// Its methods are callable by name from a client.
public sealed class PaymentsHub : Hub
{
    public static int Connected;

    public static int Disconnected;

    public override Task OnConnectedAsync()
    {
        Interlocked.Increment(ref Connected);

        return base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        Interlocked.Increment(ref Disconnected);

        return base.OnDisconnectedAsync(exception);
    }

    // Callable from the client by the name "Watch".
    public string Watch(string paymentId) => $"watching {paymentId}";
}
