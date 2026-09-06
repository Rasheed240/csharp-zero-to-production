// 01-when-it-is-read.cs — A flag's value is not a fact, it is a reading taken
// at a moment. How many moments a request contains decides what can go wrong.
//
// Run:  dotnet run 01-when-it-is-read.cs -c Release
//
// EXACT vs RATIO: the counts and consistency results are deterministic. The
// timings are machine-specific; the claim is the ratio between the rows.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Microsoft.FeatureManagement.AspNetCore@4.3.0

using System.Diagnostics;
using Microsoft.FeatureManagement;

Console.WriteLine("When a flag is read");
Console.WriteLine();

await OneRequestTwoAnswers();
await TheSnapshot();
WhatCostsWhat();
FourKinds();
await TheLibrary();

// ---------------------------------------------------------------------------
static async Task OneRequestTwoAnswers()
{
    Console.WriteLine("1. One request, two answers");
    Console.WriteLine();
    Console.WriteLine("   A checkout reads the flag in three places: to pick a pricing rule, to");
    Console.WriteLine("   pick a tax rule, and to decide what to write to the ledger. Nobody");
    Console.WriteLine("   planned that - it grew.");
    Console.WriteLine();

    var flags = new MutableFlags();
    flags.Set("NewCheckout", false);

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton(flags);

    var app = builder.Build();

    // Read at the point of use, three times.
    app.MapPost("/live", async (MutableFlags f) =>
    {
        bool pricing = f.Get("NewCheckout");

        // Something slow happens between the reads - a database call, a
        // gateway round trip. This is where the flag gets flipped.
        await Task.Delay(300);

        bool tax = f.Get("NewCheckout");
        bool ledger = f.Get("NewCheckout");

        return Results.Ok(new
        {
            pricing,
            tax,
            ledger,
            consistent = pricing == tax && tax == ledger
        });
    });

    // Read once, at the start, and passed down.
    app.MapPost("/snapshot", async (MutableFlags f) =>
    {
        bool newCheckout = f.Get("NewCheckout");

        await Task.Delay(300);

        return Results.Ok(new
        {
            pricing = newCheckout,
            tax = newCheckout,
            ledger = newCheckout,
            consistent = true
        });
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   endpoint     requests in flight when the flag was flipped   inconsistent");
    Console.WriteLine("   --------     -------------------------------------------   ------------");

    // One request first, so connections are established and the twenty below
    // reach the handler immediately rather than while the flag is flipping.
    await http.PostAsync("/live", null);

    foreach (string path in new[] { "/live", "/snapshot" })
    {
        flags.Set("NewCheckout", false);

        // Twenty requests in flight; the flag flips while they are running.
        Task<bool>[] requests = [.. Enumerable.Range(0, 20).Select(_ => IsConsistent(http, path))];

        await Task.Delay(100);
        flags.Set("NewCheckout", true);

        bool[] results = await Task.WhenAll(requests);

        Console.WriteLine($"   {path,-12} {results.Length,43}   {results.Count(r => !r)}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   TWENTY REQUESTS TOOK BOTH CODE PATHS AT ONCE. Each one priced the");
    Console.WriteLine("   order under the old rules and taxed it under the new ones, or the");
    Console.WriteLine("   reverse - a combination that was never designed, never tested, and");
    Console.WriteLine("   does not correspond to either version of the feature.");
    Console.WriteLine();
    Console.WriteLine("   THE FLIP IS INSTANTANEOUS AND THE REQUESTS ARE NOT. That is the whole");
    Console.WriteLine("   mechanism, and it applies to every flag system there is: a value that");
    Console.WriteLine("   can change at any moment, read at more than one moment, gives more");
    Console.WriteLine("   than one answer.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS NOT A FASTER FLAG SYSTEM. It is to READ THE FLAG ONCE, AT A");
    Console.WriteLine("   DEFINED POINT, AND PASS THE ANSWER DOWN. A request should decide which");
    Console.WriteLine("   version of the world it is in at the moment it starts, and stay there.");
    Console.WriteLine();
    Console.WriteLine("   AND NOTICE HOW NARROW THE WINDOW IS. The flag was flipped once, during");
    Console.WriteLine("   a three-hundred-millisecond handler. In production a flip lands on");
    Console.WriteLine("   however many requests are in flight - which at a thousand requests a");
    Console.WriteLine("   second is a handful, every time anyone touches a flag. IT IS RARE,");
    Console.WriteLine("   NOT IMPOSSIBLE, and rare failures that corrupt money are the");
    Console.WriteLine("   expensive kind.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheSnapshot()
{
    Console.WriteLine("2. Where the snapshot belongs");
    Console.WriteLine();
    Console.WriteLine("   'Read it once' raises a question: once per what? There are three");
    Console.WriteLine("   answers and they are not interchangeable.");
    Console.WriteLine();

    var flags = new MutableFlags();
    flags.Set("NewCheckout", true);

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton(flags);

    // Per-request: resolved once per scope, so every read in a request agrees
    // and the next request sees the new value.
    builder.Services.AddScoped<RequestFlags>();

    // Per-process: read at startup and never again.
    builder.Services.AddSingleton(new StartupFlags(flags.Get("NewCheckout")));

    var app = builder.Build();

    app.MapGet("/per-call", (MutableFlags f) => f.Get("NewCheckout"));
    app.MapGet("/per-request", (RequestFlags f) => f.NewCheckout);
    app.MapGet("/per-process", (StartupFlags f) => f.NewCheckout);

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   moment                  per-call   per-request   per-process");
    Console.WriteLine("   ------                  --------   -----------   -----------");
    Console.WriteLine($"   flag is on              {await Read(http)}");

    flags.Set("NewCheckout", false);

    Console.WriteLine($"   after flipping it off   {await Read(http)}");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   PER-PROCESS NEVER CHANGED, which is the finding worth stopping on. A");
    Console.WriteLine("   flag captured at startup is not a flag - it is a deployment-time");
    Console.WriteLine("   constant with a flag-shaped API, and turning it off requires a");
    Console.WriteLine("   restart. That is exactly wrong for a kill switch, which exists to be");
    Console.WriteLine("   used during an incident when restarting is the thing you cannot do.");
    Console.WriteLine();
    Console.WriteLine("   SO THE SCOPE IS A DECISION PER FLAG, not a house style:");
    Console.WriteLine();
    Console.WriteLine("     PER REQUEST is the default and the right answer for almost");
    Console.WriteLine("     everything. Consistent within a unit of work, responsive within one");
    Console.WriteLine("     request of a change.");
    Console.WriteLine();
    Console.WriteLine("     PER CALL is right when you WANT the newest value immediately and");
    Console.WriteLine("     there is no unit of work to be consistent within - a long-running");
    Console.WriteLine("     background loop checking a kill switch between items, for instance.");
    Console.WriteLine();
    Console.WriteLine("     PER PROCESS is right when flipping it needs a restart anyway,");
    Console.WriteLine("     because the code reads it once to build something. Say so out loud,");
    Console.WriteLine("     because everyone else will assume it is live.");
    Console.WriteLine();
    Console.WriteLine("   A LONG-RUNNING OPERATION IS THE HARD CASE. A batch job that reads a");
    Console.WriteLine("   flag once at the start may run for an hour under a value somebody");
    Console.WriteLine("   turned off forty minutes ago; one that reads it per item may process");
    Console.WriteLine("   half its batch each way. NEITHER IS WRONG - the question is whether");
    Console.WriteLine("   the batch is one unit of work or many, and that is a question about");
    Console.WriteLine("   the batch.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatCostsWhat()
{
    Console.WriteLine("3. What a flag read costs");
    Console.WriteLine();

    var flags = new MutableFlags();
    flags.Set("NewCheckout", true);

    IConfiguration configuration = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["Features:NewCheckout"] = "true" })
        .Build();

    const int Iterations = 200_000;

    Console.WriteLine("   how the flag is read                         per read");
    Console.WriteLine("   --------------------                         --------");
    Console.WriteLine($"   a bool field                                 {Time(Iterations, () => flags.Cached),8:0.000} us");
    Console.WriteLine($"   a dictionary lookup                          {Time(Iterations, () => flags.Get("NewCheckout")),8:0.000} us");
    Console.WriteLine($"   configuration.GetValue<bool>(\"...\")          {Time(Iterations, () => configuration.GetValue<bool>("Features:NewCheckout")),8:0.000} us");

    Console.WriteLine();
    Console.WriteLine("   THE CONFIGURATION READ IS THE EXPENSIVE ONE and it is the one people");
    Console.WriteLine("   write, because it is the one that appears in the documentation for");
    Console.WriteLine("   configuration. It walks the provider chain and converts a string on");
    Console.WriteLine("   every call.");
    Console.WriteLine();
    Console.WriteLine("   NONE OF THESE NUMBERS MATTER AT ONE READ PER REQUEST. They start to");
    Console.WriteLine("   matter when a flag is read inside a loop over ten thousand rows, which");
    Console.WriteLine("   is what happens when 'read it where you need it' meets a batch job.");
    Console.WriteLine();
    Console.WriteLine("   THE POINT IS NOT THE MICROSECONDS. It is that reading a flag per");
    Console.WriteLine("   request and passing it down is cheaper AND more correct than reading");
    Console.WriteLine("   it at the point of use - so the argument for the snapshot does not");
    Console.WriteLine("   need to trade anything away.");
    Console.WriteLine();
    Console.WriteLine("   AND A REMOTE FLAG SERVICE CHANGES THIS COMPLETELY. A flag whose value");
    Console.WriteLine("   comes from a network call is not a nanosecond decision - it is a");
    Console.WriteLine("   dependency, with a latency, a failure mode and a required default for");
    Console.WriteLine("   when it does not answer. Every such service caches locally and");
    Console.WriteLine("   refreshes in the background for exactly that reason, and the value you");
    Console.WriteLine("   read is a local copy of a remote fact that may be seconds old.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void FourKinds()
{
    Console.WriteLine("4. Four kinds of flag, which are not one thing");
    Console.WriteLine();
    Console.WriteLine("   'Feature flag' names four different tools with different lifetimes,");
    Console.WriteLine("   owners and removal rules. Almost every long-lived flag problem comes");
    Console.WriteLine("   from treating one kind as another.");
    Console.WriteLine();
    Console.WriteLine("   kind          lifetime      who flips it     changes while running?");
    Console.WriteLine("   ----          --------      ------------     ----------------------");
    Console.WriteLine("   release       days-weeks    the team         rarely");
    Console.WriteLine("   experiment    weeks         product/data     no, per user");
    Console.WriteLine("   ops           years         on-call          yes, urgently");
    Console.WriteLine("   permission    forever       the product      per user, constantly");
    Console.WriteLine();
    Console.WriteLine("     A RELEASE TOGGLE hides work in progress so it can be merged before");
    Console.WriteLine("     it is finished. IT IS TEMPORARY BY DEFINITION and its removal is");
    Console.WriteLine("     part of the work, not a follow-up ticket. It exists to be deleted.");
    Console.WriteLine();
    Console.WriteLine("     AN EXPERIMENT TOGGLE splits users between variants to measure a");
    Console.WriteLine("     difference. It MUST be sticky per user - a user who flips between");
    Console.WriteLine("     variants is both a bad experience and a corrupted measurement.");
    Console.WriteLine();
    Console.WriteLine("     AN OPS TOGGLE - a kill switch, a circuit breaker, a degradation");
    Console.WriteLine("     switch - is long-lived ON PURPOSE. It gets flipped at 3am by");
    Console.WriteLine("     somebody who did not write it, so it must be findable, documented,");
    Console.WriteLine("     and live rather than read at startup.");
    Console.WriteLine();
    Console.WriteLine("     A PERMISSION TOGGLE is not a feature flag at all. 'Premium accounts");
    Console.WriteLine("     get advanced reports' is a product rule that will outlive everyone");
    Console.WriteLine("     currently employed, and putting it in a flag system means your");
    Console.WriteLine("     pricing model lives in an operational tool.");
    Console.WriteLine();
    Console.WriteLine("   THE CONFUSION THAT COSTS THE MOST: A RELEASE TOGGLE THAT WAS NEVER");
    Console.WriteLine("   REMOVED BECOMES AN OPS TOGGLE THAT NOBODY DESIGNED. Two years later,");
    Console.WriteLine("   during an incident, somebody finds it and flips it - and the branch it");
    Console.WriteLine("   re-enables has not been compiled against the current database schema");
    Console.WriteLine("   since it was written.");
    Console.WriteLine();
    Console.WriteLine("   ASKING 'WHICH KIND IS THIS' AT THE MOMENT YOU ADD THE FLAG ANSWERS");
    Console.WriteLine("   EVERY OTHER QUESTION: how it is scoped, whether it needs targeting,");
    Console.WriteLine("   who owns it, whether it needs a default for when the flag service is");
    Console.WriteLine("   down, and - the one that matters - when it goes away.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheLibrary()
{
    Console.WriteLine("5. What Microsoft.FeatureManagement gives you");
    Console.WriteLine();
    Console.WriteLine("   Everything above is mechanism. The library provides it, reads flags");
    Console.WriteLine("   from configuration, and adds two things worth having.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // Flags live under a "FeatureManagement" section by convention. A plain
    // boolean is the simple form; a filter list is the general one.
    ((IConfigurationBuilder)builder.Configuration).AddInMemoryCollection(
        new Dictionary<string, string?>
        {
            ["FeatureManagement:NewCheckout"] = "true",
            ["FeatureManagement:NewPricing"] = "false",

            // A percentage rollout, expressed as configuration rather than code.
            ["FeatureManagement:BetaBanner:EnabledFor:0:Name"] = "Percentage",
            ["FeatureManagement:BetaBanner:EnabledFor:0:Parameters:Value"] = "100"
        });

    builder.Services.AddFeatureManagement();

    var app = builder.Build();

    // The evaluation is async, because a real flag provider is a dependency
    // that may have to be asked.
    app.MapGet("/checkout", async (IFeatureManager features) =>
        await features.IsEnabledAsync("NewCheckout") ? "new" : "old");

    app.MapGet("/pricing", async (IFeatureManager features) =>
        await features.IsEnabledAsync("NewPricing") ? "new" : "old");

    app.MapGet("/banner", async (IFeatureManager features) =>
        await features.IsEnabledAsync("BetaBanner") ? "shown" : "hidden");

    // A flag that is not in configuration at all.
    app.MapGet("/missing", async (IFeatureManager features) =>
        await features.IsEnabledAsync("NoSuchFlag") ? "on" : "off");

    // The endpoint filter form: the route does not exist when the flag is off.
    app.MapGet("/pricing-gated", () => "new pricing")
        .AddEndpointFilter(async (context, next) =>
        {
            IFeatureManager features = context.HttpContext.RequestServices
                .GetRequiredService<IFeatureManager>();

            return await features.IsEnabledAsync("NewPricing")
                ? await next(context)
                : Results.NotFound();
        });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   flag                                    result");
    Console.WriteLine("   ----                                    ------");
    Console.WriteLine($"   NewCheckout, configured true            {await Get(http, "/checkout")}");
    Console.WriteLine($"   NewPricing, configured false            {await Get(http, "/pricing")}");
    Console.WriteLine($"   BetaBanner, Percentage filter at 100    {await Get(http, "/banner")}");
    Console.WriteLine($"   NoSuchFlag, absent from configuration   {await Get(http, "/missing")}");
    Console.WriteLine($"   an endpoint gated on a false flag       {await Get(http, "/pricing-gated")}");

    // What all the registered flag names are - the closest thing the library
    // has to a registry.
    var manager = app.Services.GetRequiredService<IFeatureManager>();
    var names = new List<string>();

    await foreach (string name in manager.GetFeatureNamesAsync())
    {
        names.Add(name);
    }

    Console.WriteLine();
    Console.WriteLine($"   flags the library knows about   {string.Join(", ", names)}");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE TWO THINGS WORTH HAVING:");
    Console.WriteLine();
    Console.WriteLine("     FILTERS ARE CONFIGURATION, NOT CODE. A percentage rollout, a time");
    Console.WriteLine("     window, a targeted group - all expressed as data, so changing the");
    Console.WriteLine("     rollout does not touch the application. You can write your own");
    Console.WriteLine("     filter by implementing IFeatureFilter, which is where a real");
    Console.WriteLine("     targeting key would go.");
    Console.WriteLine();
    Console.WriteLine("     GetFeatureNamesAsync ENUMERATES WHAT EXISTS. That is the closest the");
    Console.WriteLine("     library comes to a registry, and it is worth building on - a startup");
    Console.WriteLine("     check that every configured flag appears in your own registry, and");
    Console.WriteLine("     vice versa, catches both a flag nobody documented and a documented");
    Console.WriteLine("     flag nobody configured.");
    Console.WriteLine();
    Console.WriteLine("   AND THE THINGS IT DOES NOT GIVE YOU, WHICH ARE THE ONES THIS MODULE IS");
    Console.WriteLine("   ABOUT:");
    Console.WriteLine();
    Console.WriteLine("     A MISSING FLAG IS FALSE, silently - the same default, and the same");
    Console.WriteLine("     failure mode, as reading a raw configuration key. Look at the");
    Console.WriteLine("     NoSuchFlag row.");
    Console.WriteLine();
    Console.WriteLine("     THE NAMES ARE STILL STRINGS at the call site, so a typo is still a");
    Console.WriteLine("     silent false. A typed accessor over the top of it is still yours to");
    Console.WriteLine("     write.");
    Console.WriteLine();
    Console.WriteLine("     THERE IS NO OWNER, NO REMOVAL DATE AND NO EXPIRY TEST. Nothing in");
    Console.WriteLine("     any flag library will delete a flag for you, and flag debt is the");
    Console.WriteLine("     expensive problem.");
    Console.WriteLine();
    Console.WriteLine("     EVALUATION IS ASYNC, which is the right signature for a provider");
    Console.WriteLine("     that may be remote, and it means a flag check inside a tight");
    Console.WriteLine("     synchronous loop is not something you can retrofit later.");
    Console.WriteLine();
    Console.WriteLine("   SO THE LIBRARY IS WORTH USING AND IT IS NOT THE DECISION. THE DECISIONS");
    Console.WriteLine("   ARE THE ONES ABOVE - which kind of flag this is, what scope it is read");
    Console.WriteLine("   at, what the targeting key is, and when it goes away - and no library");
    Console.WriteLine("   makes any of them for you.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<string> Get(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.GetAsync(path);

    return response.IsSuccessStatusCode
        ? await response.Content.ReadAsStringAsync()
        : $"{(int)response.StatusCode}";
}

// ---------------------------------------------------------------------------
static async Task<bool> IsConsistent(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.PostAsync(path, null);
    string body = await response.Content.ReadAsStringAsync();

    return body.Contains("\"consistent\":true");
}

// ---------------------------------------------------------------------------
static async Task<string> Read(HttpClient http)
{
    string[] values = [.. await Task.WhenAll(
        new[] { "/per-call", "/per-request", "/per-process" }
            .Select(p => http.GetStringAsync(p)))];

    return $"{values[0],-10} {values[1],-13} {values[2]}";
}

// ---------------------------------------------------------------------------
static double Time(int iterations, Func<bool> read)
{
    // Warm up, so the first call's JIT does not land in the measurement.
    for (int i = 0; i < 1000; i++)
    {
        read();
    }

    var clock = Stopwatch.StartNew();
    bool sink = false;

    for (int i = 0; i < iterations; i++)
    {
        sink ^= read();
    }

    clock.Stop();

    // Keep the loop from being optimised away entirely.
    GC.KeepAlive(sink);

    return clock.Elapsed.TotalMilliseconds * 1000 / iterations;
}

// ---------------------------------------------------------------------------
// Stands in for whatever holds flag values - a configuration provider, a
// remote service's local cache. What matters is that it can change under you.
sealed class MutableFlags
{
    readonly Dictionary<string, bool> values = [];

    public bool Cached { get; private set; }

    public bool Get(string name)
    {
        lock (values)
        {
            return values.TryGetValue(name, out bool value) && value;
        }
    }

    public void Set(string name, bool value)
    {
        lock (values)
        {
            values[name] = value;
        }

        Cached = value;
    }
}

// ---------------------------------------------------------------------------
// Resolved once per request scope, so every read within one request agrees.
sealed class RequestFlags(MutableFlags flags)
{
    public bool NewCheckout { get; } = flags.Get("NewCheckout");
}

// ---------------------------------------------------------------------------
// Resolved once per process. Not a flag - a deployment-time constant.
sealed class StartupFlags(bool newCheckout)
{
    public bool NewCheckout { get; } = newCheckout;
}
