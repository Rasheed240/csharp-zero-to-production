// 01-the-three-interfaces.cs — IOptions, IOptionsSnapshot and IOptionsMonitor
// against a file that changes while the application is running.
//
// Run:  dotnet run 01-the-three-interfaces.cs -c Release
//
// EXACT vs RATIO: every value and lifetime outcome here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Options;
using System.Collections.Concurrent;

await WhoSeesTheChange();
await Lifetimes();
await NamedOptions();
Summary();

// ---------------------------------------------------------------------------
static async Task WhoSeesTheChange()
{
    Console.WriteLine("1. The same setting, read three ways, across a file change");
    Console.WriteLine();

    string root = Directory.CreateTempSubdirectory("opt-three").FullName;
    string path = Path.Combine(root, "appsettings.json");

    File.WriteAllText(path, """{ "Gateway": { "TimeoutSeconds": 5 } }""");

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production",
        ContentRootPath = root
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddOptions<GatewayOptions>()
        .Bind(builder.Configuration.GetSection("Gateway"));

    var app = builder.Build();

    app.MapGet("/values", (
        IOptions<GatewayOptions> options,
        IOptionsSnapshot<GatewayOptions> snapshot,
        IOptionsMonitor<GatewayOptions> monitor) => Results.Ok(new
        {
            iOptions = options.Value.TimeoutSeconds,
            iOptionsSnapshot = snapshot.Value.TimeoutSeconds,
            iOptionsMonitor = monitor.CurrentValue.TimeoutSeconds
        }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine($"   the file says 5   {await http.GetStringAsync("/values")}");

    // Change the file. appsettings.json is registered with reloadOnChange by
    // default, so the configuration itself will pick this up.
    File.WriteAllText(path, """{ "Gateway": { "TimeoutSeconds": 30 } }""");

    // Wait for the change rather than for a fixed time, so this is not a race.
    string body = "";

    for (int attempt = 0; attempt < 150; attempt++)
    {
        body = await http.GetStringAsync("/values");

        if (body.Contains("\"iOptionsMonitor\":30", StringComparison.Ordinal))
        {
            break;
        }

        await Task.Delay(20);
    }

    Console.WriteLine($"   the file says 30  {body}");

    await app.StopAsync();
    await app.DisposeAsync();
    Directory.Delete(root, recursive: true);

    Console.WriteLine();
    Console.WriteLine("   THREE INTERFACES OVER ONE BOUND CLASS, and the only difference is");
    Console.WriteLine("   WHEN the value is read:");
    Console.WriteLine();
    Console.WriteLine("     IOptions           read once, the first time anything asks, and");
    Console.WriteLine("                        cached for the life of the application");
    Console.WriteLine();
    Console.WriteLine("     IOptionsSnapshot   read once per scope, so once per request");
    Console.WriteLine();
    Console.WriteLine("     IOptionsMonitor    read whenever you ask, plus a callback when the");
    Console.WriteLine("                        underlying configuration changes");
    Console.WriteLine();
    Console.WriteLine("   The first column did not move and never will. That is not a bug: for");
    Console.WriteLine("   most settings it is what you want, because a value that changes under");
    Console.WriteLine("   a running request is harder to reason about than one that does not.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Lifetimes()
{
    Console.WriteLine("2. Which one a singleton may hold");
    Console.WriteLine();
    Console.WriteLine("   The three interfaces have different lifetimes, and that decides where");
    Console.WriteLine("   each may be injected.");
    Console.WriteLine();

    Console.WriteLine("   singleton takes            startup");
    Console.WriteLine("   ---------------            -------");

    foreach ((string label, Action<IServiceCollection> register) in new (string, Action<IServiceCollection>)[]
    {
        ("IOptions<T>", services => services.AddSingleton<HoldsOptions>()),
        ("IOptionsMonitor<T>", services => services.AddSingleton<HoldsMonitor>()),
        ("IOptionsSnapshot<T>", services => services.AddSingleton<HoldsSnapshot>())
    })
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Production"
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        builder.Host.UseDefaultServiceProvider(options =>
        {
            options.ValidateOnBuild = true;
            options.ValidateScopes = true;
        });

        builder.Services.AddOptions<GatewayOptions>()
            .Bind(builder.Configuration.GetSection("Gateway"));

        register(builder.Services);

        string outcome;

        try
        {
            WebApplication built = builder.Build();
            outcome = "built without complaint";
            await built.DisposeAsync();
        }
        catch (Exception exception)
        {
            string message = (exception.InnerException?.Message ?? exception.Message)
                .ReplaceLineEndings(" ");

            int marker = message.IndexOf("Cannot consume", StringComparison.Ordinal);

            outcome = marker >= 0 ? message[marker..] : message[..Math.Min(100, message.Length)];
        }

        Console.WriteLine($"   {label,-25}  {outcome}");
    }

    Console.WriteLine();
    Console.WriteLine("   IOptionsSnapshot IS SCOPED, because 'once per scope' is what it means.");
    Console.WriteLine("   So a singleton holding one is a captive dependency, and the same check");
    Console.WriteLine("   from the lifetimes module refuses to start.");
    Console.WriteLine();
    Console.WriteLine("   IOptions and IOptionsMonitor are singletons, so anything may hold");
    Console.WriteLine("   them.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE PRACTICAL RULE, and it is shorter than the theory:");
    Console.WriteLine();
    Console.WriteLine("     in a singleton or a background service   IOptions, or IOptionsMonitor");
    Console.WriteLine("                                              if it must see changes");
    Console.WriteLine();
    Console.WriteLine("     in anything scoped - a handler, a        IOptions unless you need");
    Console.WriteLine("     repository, a request-scoped service     per-request freshness");
    Console.WriteLine();
    Console.WriteLine("   WITHOUT ValidateScopes the third row STARTS, and every request gets");
    Console.WriteLine("   the snapshot taken during whichever request built the singleton -");
    Console.WriteLine("   frozen, and looking exactly like IOptions while claiming not to be.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task NamedOptions()
{
    Console.WriteLine("3. Two of the same thing");
    Console.WriteLine();
    Console.WriteLine("   Ledger talks to two gateways with the same client and different");
    Console.WriteLine("   settings. One options class, two names:");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Gateways:card:BaseUrl"] = "https://cards.internal:8443",
        ["Gateways:card:TimeoutSeconds"] = "5",
        ["Gateways:bank:BaseUrl"] = "https://bank.internal:8443",
        ["Gateways:bank:TimeoutSeconds"] = "30"
    });

    builder.Services.AddOptions<GatewayOptions>("card")
        .Bind(builder.Configuration.GetSection("Gateways:card"));

    builder.Services.AddOptions<GatewayOptions>("bank")
        .Bind(builder.Configuration.GetSection("Gateways:bank"));

    var app = builder.Build();

    app.MapGet("/gateways", (IOptionsSnapshot<GatewayOptions> options) => Results.Ok(new
    {
        card = Describe(options.Get("card")),
        bank = Describe(options.Get("bank")),
        unnamed = Describe(options.Get(Options.DefaultName))
    }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine($"   {await http.GetStringAsync("/gateways")}");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   NAMED OPTIONS ARE THE SAME CLASS BOUND SEVERAL TIMES, each under a");
    Console.WriteLine("   name, retrieved with Get(name) rather than Value.");
    Console.WriteLine();
    Console.WriteLine("   The third field is the unnamed one, which nobody configured. It comes");
    Console.WriteLine("   back as an object of class defaults rather than an error - the same");
    Console.WriteLine("   silence as an absent section in the configuration module, so a typo in");
    Console.WriteLine("   a name produces defaults rather than a failure.");
    Console.WriteLine();
    Console.WriteLine("   IOptions<T> HAS NO Get METHOD AT ALL. It only ever gives you the");
    Console.WriteLine("   unnamed instance, which is why named options are reached through");
    Console.WriteLine("   IOptionsSnapshot or IOptionsMonitor.");
    Console.WriteLine();
    Console.WriteLine("   USE THEM WHEN THE SET IS OPEN - two gateways today, a third next");
    Console.WriteLine("   quarter, configured rather than coded. When the set is fixed and known,");
    Console.WriteLine("   two separate options classes are clearer, because each one's shape can");
    Console.WriteLine("   differ and the compiler keeps them apart.");
    Console.WriteLine();

    static string Describe(GatewayOptions options) =>
        $"{(options.BaseUrl.Length == 0 ? "(unset)" : options.BaseUrl)} @ {options.TimeoutSeconds}s";
}

// ---------------------------------------------------------------------------
static void Summary()
{
    Console.WriteLine("4. Choosing between them");
    Console.WriteLine();
    Console.WriteLine("   interface             lifetime    value read        use for");
    Console.WriteLine("   ---------             --------    ----------        -------");
    Console.WriteLine("   IOptions<T>           singleton   once, ever        almost everything");
    Console.WriteLine("   IOptionsSnapshot<T>   scoped      once per request  values that may change");
    Console.WriteLine("                                                       between requests");
    Console.WriteLine("   IOptionsMonitor<T>    singleton   on every access   singletons and workers");
    Console.WriteLine("                                                       that must see changes");
    Console.WriteLine();
    Console.WriteLine("   START WITH IOptions AND MOVE ONLY WHEN YOU HAVE A REASON. The reason");
    Console.WriteLine("   is always the same one: this value legitimately changes while the");
    Console.WriteLine("   process runs, and the process must notice.");
    Console.WriteLine();
    Console.WriteLine("   For most settings that is not true. A container is restarted to change");
    Console.WriteLine("   configuration, so a reloading options object buys nothing and costs");
    Console.WriteLine("   you the guarantee that two requests in the same deployment behaved the");
    Console.WriteLine("   same way.");
    Console.WriteLine();
    Console.WriteLine("   WHERE IT IS GENUINELY WORTH IT: feature flags, log levels, rate limits,");
    Console.WriteLine("   circuit breaker thresholds - things you want to change during an");
    Console.WriteLine("   incident without a deployment.");
    Console.WriteLine();
    Console.WriteLine("   ONE COST OF IOptionsMonitor THAT IS EASY TO MISS. OnChange returns an");
    Console.WriteLine("   IDisposable, and the subscription lives until you dispose it:");
    Console.WriteLine();

    var monitor = new FakeMonitor();
    var subscriptions = new List<IDisposable>();

    for (int request = 0; request < 1_000; request++)
    {
        // What a scoped service registering a callback per request does.
        subscriptions.Add(monitor.OnChange(_ => { }));
    }

    Console.WriteLine($"     callbacks registered by 1,000 requests   {monitor.Count}");

    foreach (IDisposable subscription in subscriptions)
    {
        subscription.Dispose();
    }

    Console.WriteLine($"     after disposing every subscription       {monitor.Count}");
    Console.WriteLine();
    Console.WriteLine("   A CALLBACK REGISTERED PER REQUEST AND NEVER DISPOSED IS A LEAK, and a");
    Console.WriteLine("   growing one: every change then invokes every callback ever registered.");
    Console.WriteLine();
    Console.WriteLine("   Register OnChange once, in something that lives as long as the");
    Console.WriteLine("   application - or do not register at all and read CurrentValue, which");
    Console.WriteLine("   needs no subscription.");
}

// ---------------------------------------------------------------------------
public sealed class GatewayOptions
{
    public string BaseUrl { get; set; } = "";

    public int TimeoutSeconds { get; set; } = 30;

    public int MaxAttempts { get; set; } = 1;
}

public sealed class HoldsOptions(IOptions<GatewayOptions> options)
{
    public int Timeout => options.Value.TimeoutSeconds;
}

public sealed class HoldsMonitor(IOptionsMonitor<GatewayOptions> monitor)
{
    public int Timeout => monitor.CurrentValue.TimeoutSeconds;
}

public sealed class HoldsSnapshot(IOptionsSnapshot<GatewayOptions> snapshot)
{
    public int Timeout => snapshot.Value.TimeoutSeconds;
}

// A stand-in for the monitor's subscription list, so the count is visible.
public sealed class FakeMonitor
{
    private readonly ConcurrentDictionary<int, Action<GatewayOptions>> _callbacks = new();
    private int _next;

    public int Count => _callbacks.Count;

    public IDisposable OnChange(Action<GatewayOptions> listener)
    {
        int key = Interlocked.Increment(ref _next);
        _callbacks[key] = listener;

        return new Subscription(() => _callbacks.TryRemove(key, out _));
    }

    private sealed class Subscription(Action dispose) : IDisposable
    {
        public void Dispose() => dispose();
    }
}
