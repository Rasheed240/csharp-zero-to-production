// 03-production.cs — The incident: a kill switch that could not be switched,
// because one field cached the thing that was supposed to change.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every value and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Options;

await TheKillSwitch();
await TheThreeVersions();
WhyItPassedReview();
Rules();

// ---------------------------------------------------------------------------
static async Task TheKillSwitch()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   Ledger's new settlement path is behind a flag so it can be turned off");
    Console.WriteLine("   without a deployment. That is the whole reason the flag exists, and");
    Console.WriteLine("   it was tested: flip the value, watch the behaviour change.");
    Console.WriteLine();
    Console.WriteLine("   The class reads it the way the documentation says to, through");
    Console.WriteLine("   IOptionsMonitor, because it is a singleton and needs to see changes:");
    Console.WriteLine();
    Console.WriteLine("     public sealed class SettlementRouter");
    Console.WriteLine("     {");
    Console.WriteLine("         private readonly FeatureOptions _features;");
    Console.WriteLine();
    Console.WriteLine("         public SettlementRouter(IOptionsMonitor<FeatureOptions> monitor)");
    Console.WriteLine("         {");
    Console.WriteLine("             _features = monitor.CurrentValue;");
    Console.WriteLine("         }");
    Console.WriteLine();
    Console.WriteLine("         public string Route() =>");
    Console.WriteLine("             _features.NewSettlement ? \"new\" : \"old\";");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   At 02:40 the new path starts failing. The on-call engineer sets the");
    Console.WriteLine("   flag to false, confirms the change landed, and watches the failures");
    Console.WriteLine("   continue.");
    Console.WriteLine();

    (string before, string after, int changes) = await FlipAsync(Version.CachedInConstructor);

    Console.WriteLine($"   flag true, requests route to    {before}");
    Console.WriteLine($"   flag set to false, requests to  {after}");
    Console.WriteLine($"   change callbacks the monitor fired  {changes}");
    Console.WriteLine();
    Console.WriteLine("   THE CONFIGURATION CHANGED. THE MONITOR NOTICED. THE CLASS DID NOT.");
    Console.WriteLine();
    Console.WriteLine("   One line explains all of it:");
    Console.WriteLine();
    Console.WriteLine("     _features = monitor.CurrentValue;");
    Console.WriteLine();
    Console.WriteLine("   CurrentValue is a property that reads the value NOW. Assigning it to a");
    Console.WriteLine("   field copies that value once, in the constructor, and the field never");
    Console.WriteLine("   changes again. The monitor is still watching; nothing is listening.");
    Console.WriteLine();
    Console.WriteLine("   The class takes the right interface, for the right reason, and uses it");
    Console.WriteLine("   in a way that makes it exactly equivalent to IOptions - while reading,");
    Console.WriteLine("   at every glance, as though it does not.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheThreeVersions()
{
    Console.WriteLine("2. The same class, three ways of holding the value");
    Console.WriteLine();

    Console.WriteLine("   how the class holds it                 before   after   sees the change");
    Console.WriteLine("   ----------------------                 ------   -----   ---------------");

    foreach (Version version in new[]
    {
        Version.CachedInConstructor, Version.ReadEachTime, Version.UpdatedOnChange
    })
    {
        (string before, string after, int _) = await FlipAsync(version);

        Console.WriteLine($"   {Describe(version),-37}  {before,-7}  {after,-6}  " +
            $"{(before != after ? "YES" : "no")}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIX IS TO STOP COPYING. Read CurrentValue at the point of use:");
    Console.WriteLine();
    Console.WriteLine("     public string Route() =>");
    Console.WriteLine("         _monitor.CurrentValue.NewSettlement ? \"new\" : \"old\";");
    Console.WriteLine();
    Console.WriteLine("   It is a property read against a cached object inside the monitor, not");
    Console.WriteLine("   a re-parse of configuration, so reading it per request costs nothing");
    Console.WriteLine("   worth measuring.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD VERSION ALSO WORKS and is the one to reach for when you need");
    Console.WriteLine("   to DO something on a change rather than only read a newer value -");
    Console.WriteLine("   rebuild a client, re-open a connection, log that a flag moved:");
    Console.WriteLine();
    Console.WriteLine("     _subscription = monitor.OnChange(updated => _features = updated);");
    Console.WriteLine();
    Console.WriteLine("   It comes with two obligations the first version does not have. THE");
    Console.WriteLine("   SUBSCRIPTION MUST BE DISPOSED, or it lives forever - which for a");
    Console.WriteLine("   singleton is fine and for anything shorter-lived is a leak. And THE");
    Console.WriteLine("   FIELD IS NOW WRITTEN BY ONE THREAD WHILE OTHERS READ IT, so it must be");
    Console.WriteLine("   a whole-object reference assignment rather than field-by-field");
    Console.WriteLine("   mutation.");
    Console.WriteLine();
    Console.WriteLine("   Prefer the second version. It has neither obligation.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhyItPassedReview()
{
    Console.WriteLine("3. Why nobody caught it");
    Console.WriteLine();
    Console.WriteLine("   THE TEST PASSED, and it was a real test. It constructed a monitor,");
    Console.WriteLine("   built the router, changed the value and asserted the route changed -");
    Console.WriteLine("   except that a test which constructs the router AFTER setting the value");
    Console.WriteLine("   is testing the constructor, not the change.");
    Console.WriteLine();
    Console.WriteLine("   The version of that test which would have failed does one thing");
    Console.WriteLine("   differently:");
    Console.WriteLine();
    Console.WriteLine("     var router = new SettlementRouter(monitor);   // BEFORE the change");
    Console.WriteLine("     Assert.Equal(\"new\", router.Route());");
    Console.WriteLine();
    Console.WriteLine("     source.Set(newSettlement: false);             // then change it");
    Console.WriteLine("     Assert.Equal(\"old\", router.Route());          // this line fails");
    Console.WriteLine();
    Console.WriteLine("   THE REVIEW PASSED because the diff contains IOptionsMonitor, which is");
    Console.WriteLine("   the correct interface, and a reviewer checking 'is this using the");
    Console.WriteLine("   reloadable one' sees that it is.");
    Console.WriteLine();
    Console.WriteLine("   THE STAGING CHECK PASSED because flipping a flag and restarting the");
    Console.WriteLine("   service - which is what you do when you are checking that a flag");
    Console.WriteLine("   works - reads the new value in the constructor.");
    Console.WriteLine();
    Console.WriteLine("   Every one of those is a reasonable check, and the defect survives all");
    Console.WriteLine("   three. What none of them does is the one thing that matters: CHANGE");
    Console.WriteLine("   THE VALUE WITHOUT RESTARTING, AND OBSERVE THE SAME INSTANCE.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Rules()
{
    Console.WriteLine("4. What to take from it");
    Console.WriteLine();
    Console.WriteLine("   1. NEVER COPY CurrentValue INTO A FIELD. If the value should change,");
    Console.WriteLine("      read it where you use it. If it should not change, use IOptions and");
    Console.WriteLine("      say so.");
    Console.WriteLine();
    Console.WriteLine("   2. A CLASS THAT TAKES IOptionsMonitor AND READS IT ONCE IS LYING. It");
    Console.WriteLine("      should take IOptions instead, which is honest and does the same");
    Console.WriteLine("      thing. Making the two versions behave differently is the whole");
    Console.WriteLine("      point of the interfaces being distinct.");
    Console.WriteLine();
    Console.WriteLine("   3. TEST A CHANGE AGAINST AN INSTANCE THAT ALREADY EXISTS. Construct");
    Console.WriteLine("      first, then change, then assert. A test that changes the value");
    Console.WriteLine("      before constructing tests nothing about reloading.");
    Console.WriteLine();
    Console.WriteLine("   4. IF A FLAG IS A KILL SWITCH, EXERCISE IT WITHOUT A RESTART, in an");
    Console.WriteLine("      environment that is not a developer machine, before you rely on it");
    Console.WriteLine("      at 02:40. A kill switch nobody has pulled is a kill switch nobody");
    Console.WriteLine("      knows the state of.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL SHAPE, which is worth more than the specific bug:");
    Console.WriteLine();
    Console.WriteLine("     AN ABSTRACTION THAT PROMISES FRESHNESS IS ONLY AS FRESH AS ITS LAST");
    Console.WriteLine("     READ. The monitor, the snapshot and the reloading configuration");
    Console.WriteLine("     underneath them all work correctly here. The value went stale in the");
    Console.WriteLine("     one place none of them can see: an ordinary field in your own class.");
}

// ---------------------------------------------------------------------------
static async Task<(string Before, string After, int Changes)> FlipAsync(Version version)
{
    string root = Directory.CreateTempSubdirectory("opt-flag").FullName;
    string path = Path.Combine(root, "appsettings.json");

    File.WriteAllText(path, """{ "Features": { "NewSettlement": true } }""");

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production",
        ContentRootPath = root
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddOptions<FeatureOptions>()
        .Bind(builder.Configuration.GetSection("Features"));

    builder.Services.AddSingleton<ChangeCounter>();

    switch (version)
    {
        case Version.CachedInConstructor:
            builder.Services.AddSingleton<IRouter, CachingRouter>();
            break;
        case Version.ReadEachTime:
            builder.Services.AddSingleton<IRouter, ReadingRouter>();
            break;
        default:
            builder.Services.AddSingleton<IRouter, SubscribingRouter>();
            break;
    }

    var app = builder.Build();

    app.MapGet("/route", (IRouter router) => Results.Text(router.Route()));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    // Force the singleton to be built now, as the first request would.
    string before = await http.GetStringAsync("/route");

    File.WriteAllText(path, """{ "Features": { "NewSettlement": false } }""");

    var counter = app.Services.GetRequiredService<ChangeCounter>();
    var monitor = app.Services.GetRequiredService<IOptionsMonitor<FeatureOptions>>();

    // Wait for the monitor itself to see the change, rather than a fixed delay.
    for (int attempt = 0; attempt < 150 && monitor.CurrentValue.NewSettlement; attempt++)
    {
        await Task.Delay(20);
    }

    // And give any registered callbacks a moment to run.
    for (int attempt = 0; attempt < 50 && counter.Count == 0; attempt++)
    {
        await Task.Delay(20);
    }

    string after = await http.GetStringAsync("/route");

    await app.StopAsync();
    await app.DisposeAsync();
    Directory.Delete(root, recursive: true);

    return (before, after, counter.Count);
}

static string Describe(Version version) => version switch
{
    Version.CachedInConstructor => "monitor.CurrentValue into a field",
    Version.ReadEachTime => "monitor.CurrentValue at each read",
    _ => "a field updated by OnChange"
};

// ---------------------------------------------------------------------------
enum Version { CachedInConstructor, ReadEachTime, UpdatedOnChange }

public sealed class FeatureOptions
{
    public bool NewSettlement { get; set; }
}

public sealed class ChangeCounter
{
    private int _count;

    public int Count => Volatile.Read(ref _count);

    public void Increment() => Interlocked.Increment(ref _count);
}

public interface IRouter
{
    string Route();
}

// As written. Takes the reloadable interface and copies the value once.
public sealed class CachingRouter : IRouter
{
    private readonly FeatureOptions _features;

    public CachingRouter(IOptionsMonitor<FeatureOptions> monitor) => _features = monitor.CurrentValue;

    public string Route() => _features.NewSettlement ? "new" : "old";
}

// The fix: read at the point of use.
public sealed class ReadingRouter(IOptionsMonitor<FeatureOptions> monitor) : IRouter
{
    public string Route() => monitor.CurrentValue.NewSettlement ? "new" : "old";
}

// The other fix, for when a change needs work done rather than a value read.
public sealed class SubscribingRouter : IRouter, IDisposable
{
    private readonly IDisposable? _subscription;
    private FeatureOptions _features;

    public SubscribingRouter(IOptionsMonitor<FeatureOptions> monitor, ChangeCounter counter)
    {
        _features = monitor.CurrentValue;

        // A whole-object assignment, so a reader sees the old object or the
        // new one and never a half-updated one.
        _subscription = monitor.OnChange(updated =>
        {
            _features = updated;
            counter.Increment();
        });
    }

    public string Route() => Volatile.Read(ref _features!).NewSettlement ? "new" : "old";

    public void Dispose() => _subscription?.Dispose();
}
