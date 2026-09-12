// 02-factory-and-typed-clients.cs — What IHttpClientFactory actually does,
// which is not "pool HttpClient instances", and the one way to defeat it.
//
// The server counts distinct connections, so every claim here is measured on
// the far side of the socket.
//
// Run:  dotnet run 02-factory-and-typed-clients.cs -c Release
//
// EXACT vs RATIO: every connection count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Reflection;

var connectionIds = new ConcurrentDictionary<string, byte>();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// A named client, with the handler rotated far faster than the two-minute
// default so a file can show it happening.
builder.Services.AddHttpClient("pricing", client =>
    client.Timeout = TimeSpan.FromSeconds(5))
    .SetHandlerLifetime(TimeSpan.FromSeconds(1));

// A named client whose handler is never rotated, for comparison.
builder.Services.AddHttpClient("pricing-static")
    .SetHandlerLifetime(Timeout.InfiniteTimeSpan);

// A typed client: the same machinery, with the HttpClient injected into a
// class instead of fetched by name.
builder.Services.AddHttpClient<PricingClient>(client =>
    client.Timeout = TimeSpan.FromSeconds(5))
    .SetHandlerLifetime(TimeSpan.FromSeconds(1));

builder.Services.AddHttpClient("counted")
    .SetHandlerLifetime(TimeSpan.FromSeconds(1))
    .AddHttpMessageHandler(() => new CountingHandler());

builder.Services.AddHttpClient("counted-held")
    .SetHandlerLifetime(TimeSpan.FromSeconds(1))
    .AddHttpMessageHandler(() => new CountingHandler());

var app = builder.Build();

app.Use(async (context, next) =>
{
    connectionIds.TryAdd(context.Connection.Id, 0);

    await next();
});

app.MapGet("/v1/payments/{id}", (string id) => Results.Ok(new { id, status = "captured" }));

await app.StartAsync();

string baseAddress = app.Urls.First();
PricingClient.BaseAddress = baseAddress;

var factory = app.Services.GetRequiredService<IHttpClientFactory>();

Console.WriteLine("What IHttpClientFactory actually does");
Console.WriteLine();

// ---------------------------------------------------------------------------
Console.WriteLine("1. A NEW HttpClient EVERY TIME, AND ONE CONNECTION");
Console.WriteLine();

connectionIds.Clear();

var instances = new HashSet<int>();

for (int n = 0; n < 20; n++)
{
    // A brand new HttpClient object, deliberately.
    HttpClient client = factory.CreateClient("pricing-static");

    instances.Add(System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(client));

    await client.GetAsync($"{baseAddress}/v1/payments/PAY-001");

    // Disposing it is allowed and does nothing to the connection.
    client.Dispose();
}

Console.WriteLine($"   distinct HttpClient objects created   {instances.Count}");
Console.WriteLine($"   connections the server saw            {connectionIds.Count}");
Console.WriteLine();
Console.WriteLine("   THE FACTORY DOES NOT POOL HttpClient. It pools the HANDLER underneath it,");
Console.WriteLine("   which is where the connection pool lives. An HttpClient is a thin wrapper");
Console.WriteLine("   over a handler, so creating twenty of them over one handler costs nothing");
Console.WriteLine("   and shares one connection.");
Console.WriteLine();
Console.WriteLine("   AND DISPOSING A FACTORY CLIENT IS A NO-OP. Every one of those was disposed");
Console.WriteLine("   and the connection survived, because the client does not own the handler.");
Console.WriteLine("   That is deliberate: it means 'using var client = factory.CreateClient()' is");
Console.WriteLine("   correct, which is the shape people write out of habit.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("2. WHAT THE HANDLER LIFETIME IS FOR");
Console.WriteLine();

connectionIds.Clear();

for (int round = 0; round < 8; round++)
{
    HttpClient client = factory.CreateClient("pricing");

    await client.GetAsync($"{baseAddress}/v1/payments/PAY-001");

    await Task.Delay(400);
}

int rotated = connectionIds.Count;

connectionIds.Clear();

for (int round = 0; round < 8; round++)
{
    HttpClient client = factory.CreateClient("pricing-static");

    await client.GetAsync($"{baseAddress}/v1/payments/PAY-001");

    await Task.Delay(400);
}

int notRotated = connectionIds.Count;

Console.WriteLine("   handler lifetime            eight calls over 3.2 s opened");
Console.WriteLine("   ----------------            ---------------------------");
Console.WriteLine($"   1 s                         {rotated,27}");
Console.WriteLine($"   infinite                    {notRotated,27}");
Console.WriteLine();
Console.WriteLine("   THE DEFAULT IS TWO MINUTES, and this is the whole reason it exists. A");
Console.WriteLine("   rotated handler means a new connection, and a new connection means the");
Console.WriteLine("   name is resolved again - so a failover, a scale-out or a redeploy is");
Console.WriteLine("   noticed within about two minutes instead of never.");
Console.WriteLine();
Console.WriteLine("   IT IS THE SAME OUTCOME AS PooledConnectionLifetime BY A DIFFERENT ROUTE:");
Console.WriteLine("   the factory throws the whole handler away, and SocketsHttpHandler expires");
Console.WriteLine("   individual connections. Setting either one is enough. Setting");
Console.WriteLine("   PooledConnectionLifetime is the finer instrument, because it does not");
Console.WriteLine("   discard a warm pool wholesale.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("3. AND THE ADVICE ABOUT CAPTURING A FACTORY CLIENT IS OUT OF DATE");
Console.WriteLine();

connectionIds.Clear();

// A client resolved once and held in a field - the thing every article about
// IHttpClientFactory warns against.
HttpClient captured = factory.CreateClient("pricing");

for (int round = 0; round < 8; round++)
{
    await captured.GetAsync($"{baseAddress}/v1/payments/PAY-001");

    await Task.Delay(400);
}

int capturedConnections = connectionIds.Count;

Console.WriteLine("   how the client is obtained                  eight calls over 3.2 s opened");
Console.WriteLine("   --------------------------                  -----------------------------");
Console.WriteLine($"   factory.CreateClient() per call             {rotated,29}");
Console.WriteLine($"   factory.CreateClient() once, then held      {capturedConnections,29}");
Console.WriteLine();
Console.WriteLine("   THE CAPTURED CLIENT RECYCLED ITS CONNECTIONS ANYWAY. This file was written");
Console.WriteLine("   expecting the opposite, because 'capturing a factory client freezes its");
Console.WriteLine("   handler and you are back to a stale connection' is what nearly everything");
Console.WriteLine("   written about IHttpClientFactory says. On .NET 10 it is not what happens.");
Console.WriteLine();

// Why: the factory's primary handler is a SocketsHttpHandler whose
// PooledConnectionLifetime it sets to the configured handler lifetime.
Console.WriteLine("   WHY - THE PRIMARY HANDLER THE FACTORY BUILDS:");
Console.WriteLine();
Console.WriteLine("   named client        handler lifetime   PooledConnectionLifetime on it");
Console.WriteLine("   ------------        ----------------   ------------------------------");

foreach ((string name, string lifetime) in new[]
{
    ("pricing", "1 s"),
    ("pricing-static", "infinite")
})
{
    HttpClient probe = factory.CreateClient(name);

    object? handler = typeof(HttpMessageInvoker)
        .GetField("_handler", BindingFlags.NonPublic | BindingFlags.Instance)!
        .GetValue(probe);

    while (handler is DelegatingHandler delegating)
    {
        handler = delegating.InnerHandler;
    }

    var sockets = handler as SocketsHttpHandler;

    Console.WriteLine($"   {name,-18}  {lifetime,-17}  {sockets?.PooledConnectionLifetime.ToString() ?? "n/a"}");
}

Console.WriteLine();
Console.WriteLine("   THE FACTORY COPIES THE HANDLER LIFETIME ONTO THE CONNECTION POOL. So the");
Console.WriteLine("   connection expires on schedule whether or not anybody ever asks for a new");
Console.WriteLine("   client, and the DNS problem is solved even for a captured client. (The");
Console.WriteLine("   infinite row reads as a negative timespan because that is how");
Console.WriteLine("   Timeout.InfiniteTimeSpan prints: minus one millisecond.)");
Console.WriteLine();
Console.WriteLine("   SO WHAT DOES CAPTURING STILL BREAK? THE REST OF THE CHAIN.");
Console.WriteLine();

connectionIds.Clear();
CountingHandler.Constructed = 0;

for (int round = 0; round < 8; round++)
{
    HttpClient client = factory.CreateClient("counted");

    await client.GetAsync($"{baseAddress}/v1/payments/PAY-001");

    await Task.Delay(400);
}

int chainsPerCall = CountingHandler.Constructed;

CountingHandler.Constructed = 0;

HttpClient countedAndHeld = factory.CreateClient("counted-held");

for (int round = 0; round < 8; round++)
{
    await countedAndHeld.GetAsync($"{baseAddress}/v1/payments/PAY-001");

    await Task.Delay(400);
}

int chainsHeld = CountingHandler.Constructed;

Console.WriteLine("   how the client is obtained                  handler chains built");
Console.WriteLine("   --------------------------                  --------------------");
Console.WriteLine($"   factory.CreateClient() per call             {chainsPerCall,20}");
Console.WriteLine($"   factory.CreateClient() once, then held      {chainsHeld,20}");
Console.WriteLine();
Console.WriteLine("   THE DELEGATING HANDLERS ARE BUILT ONCE AND NEVER AGAIN. Anything they hold");
Console.WriteLine("   is held for the life of the process: a cached token, a snapshot of options,");
Console.WriteLine("   a circuit-breaker's state, a service resolved from the scope the factory");
Console.WriteLine("   created for that chain. A rotated chain re-reads all of it; a captured one");
Console.WriteLine("   never does.");
Console.WriteLine();
Console.WriteLine("   AND THE EXPIRED CHAIN IS NEVER DISPOSED, because the factory only disposes");
Console.WriteLine("   a chain once the client holding it has been collected. A captured client");
Console.WriteLine("   pins its chain, and the scope behind it, forever.");
Console.WriteLine();
Console.WriteLine("   SO THE RULE SURVIVES, WITH A DIFFERENT REASON BEHIND IT: create the client");
Console.WriteLine("   where you use it. Not because the connection would go stale - it will not -");
Console.WriteLine("   but because everything you configured around the connection would.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("4. TYPED CLIENTS ARE THE SAME MACHINERY, WITH THE SAME CAVEAT");
Console.WriteLine();

var first = app.Services.GetRequiredService<PricingClient>();
var second = app.Services.GetRequiredService<PricingClient>();

Console.WriteLine($"   two resolutions of PricingClient are the same object   {ReferenceEquals(first, second)}");
Console.WriteLine();
Console.WriteLine("   AddHttpClient<T> REGISTERS T AS TRANSIENT. A fresh instance every time,");
Console.WriteLine("   each with a fresh HttpClient over the current handler chain - which is the");
Console.WriteLine("   same arrangement as CreateClient, with the name and the base address moved");
Console.WriteLine("   into the class where they belong.");

connectionIds.Clear();

for (int round = 0; round < 8; round++)
{
    using IServiceScope scope = app.Services.CreateScope();

    var pricing = scope.ServiceProvider.GetRequiredService<PricingClient>();

    await pricing.GetStatusAsync("PAY-001");

    await Task.Delay(400);
}

int typedConnections = connectionIds.Count;

connectionIds.Clear();

// The trap: a typed client resolved once and kept, which is what happens the
// moment one is injected into a singleton.
var held = app.Services.GetRequiredService<PricingClient>();

for (int round = 0; round < 8; round++)
{
    await held.GetStatusAsync("PAY-001");

    await Task.Delay(400);
}

int heldConnections = connectionIds.Count;

Console.WriteLine();
Console.WriteLine("   how the typed client is obtained            eight calls over 3.2 s opened");
Console.WriteLine("   --------------------------------            -----------------------------");
Console.WriteLine($"   resolved per scope                          {typedConnections,29}");
Console.WriteLine($"   resolved once and kept                      {heldConnections,29}");
Console.WriteLine();
Console.WriteLine("   THE SAME RESULT AS SECTION 3, FOR THE SAME REASON: the connection under a");
Console.WriteLine("   captured typed client still expires on the handler lifetime. Injecting a");
Console.WriteLine("   typed client into a singleton does not produce a stale connection.");
Console.WriteLine();
Console.WriteLine("   IT PRODUCES A FROZEN CHAIN, which is a quieter problem and a real one. The");
Console.WriteLine("   handlers configured around that client are built once and never rebuilt, so");
Console.WriteLine("   an auth handler keeps its token, an options-reading handler keeps its");
Console.WriteLine("   snapshot, and the scope the factory created to build them is never");
Console.WriteLine("   released.");
Console.WriteLine();
Console.WriteLine("   AND THERE IS NO COMPILER HELP FOR IT. Injecting a scoped service into a");
Console.WriteLine("   singleton throws at startup with scope validation on. Injecting a typed");
Console.WriteLine("   client - a transient - into a singleton is legal, silent, and permanent.");

await app.StopAsync();

// ---------------------------------------------------------------------------
// A delegating handler that records how many times the factory built the chain
// it belongs to. Everything a real one would hold - a token, an options
// snapshot, a circuit breaker - has this same lifetime.
public sealed class CountingHandler : DelegatingHandler
{
    public static int Constructed;

    public CountingHandler() => Interlocked.Increment(ref Constructed);
}

// A typed client: an ordinary class that takes an HttpClient. The factory
// builds it, so the class never sees a handler or a base address decision.
public sealed class PricingClient(HttpClient http)
{
    public static string BaseAddress = "";

    public async Task<string> GetStatusAsync(string id)
    {
        HttpResponseMessage response = await http.GetAsync($"{BaseAddress}/v1/payments/{id}");

        response.EnsureSuccessStatusCode();

        return "captured";
    }
}
