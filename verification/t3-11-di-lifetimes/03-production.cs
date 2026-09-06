// 03-production.cs — The incident: one word in one registration, and a
// database context shared by every request in the process.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: the context counts are exact. The failure counts above
// concurrency 1 depend on how much overlap the machine produces - the exact
// numbers move, the pattern does not: zero at concurrency 1, near-total above
// it.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;
using System.Collections.Concurrent;

await TheChange();
await UnderLoad();
await WhatItLookedLike();
Postmortem();

// ---------------------------------------------------------------------------
static async Task TheChange()
{
    Console.WriteLine("1. The change");
    Console.WriteLine();
    Console.WriteLine("   Ledger's currency lookup was slow. Every request hit the database for");
    Console.WriteLine("   a table of about forty rows that changes twice a year.");
    Console.WriteLine();
    Console.WriteLine("   The fix was obvious and correct: cache it in a singleton.");
    Console.WriteLine();
    Console.WriteLine("     -  builder.Services.AddScoped<CurrencyCatalogue>();");
    Console.WriteLine("     +  builder.Services.AddSingleton<CurrencyCatalogue>();");
    Console.WriteLine();
    Console.WriteLine("   One word. The class was not touched:");
    Console.WriteLine();
    Console.WriteLine("     public sealed class CurrencyCatalogue(LedgerDbContext db)");
    Console.WriteLine();
    Console.WriteLine("   CurrencyCatalogue takes a database context, because it has to load the");
    Console.WriteLine("   table once. LedgerDbContext is registered scoped, as every guide says");
    Console.WriteLine("   it should be.");
    Console.WriteLine();
    Console.WriteLine("   The pull request was two characters of diff. It was reviewed and");
    Console.WriteLine("   approved by two people, and both were right that caching a rarely-");
    Console.WriteLine("   changing table in a singleton is the correct design.");
    Console.WriteLine();
    Console.WriteLine("   THE PROBLEM IS NOT THE CACHE. It is that the singleton now holds a");
    Console.WriteLine("   database context, and a database context is not thread-safe.");
    Console.WriteLine();

    await Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static async Task UnderLoad()
{
    Console.WriteLine("2. What happened, and why nobody saw it before it shipped");
    Console.WriteLine();
    Console.WriteLine("   200 requests through the same endpoint, at five levels of");
    Console.WriteLine("   concurrency, with the catalogue registered each way:");
    Console.WriteLine();

    Console.WriteLine("   concurrent   scoped: contexts / failed   singleton: contexts / failed");
    Console.WriteLine("   ----------   -------------------------   ---------------------------");

    foreach (int concurrency in new[] { 1, 2, 4, 8, 32 })
    {
        Outcome scoped = await RunAsync(asSingleton: false, concurrency);
        Outcome single = await RunAsync(asSingleton: true, concurrency);

        Console.WriteLine($"   {concurrency,10}   {scoped.ContextsCreated,11} / {scoped.Failed,-11}   " +
            $"{single.ContextsCreated,11} / {single.Failed}");
    }

    Console.WriteLine();
    Console.WriteLine("   READ THE FIRST ROW BEFORE ANY OTHER. AT CONCURRENCY 1 THE SINGLETON");
    Console.WriteLine("   VERSION FAILS NOTHING. One context, 200 requests, zero errors.");
    Console.WriteLine();
    Console.WriteLine("   That row is why this reached production. A developer machine, an");
    Console.WriteLine("   integration test, a staging environment with one person clicking - all");
    Console.WriteLine("   of them are the first row. The bug is not merely hard to reproduce");
    Console.WriteLine("   there; it is ABSENT there.");
    Console.WriteLine();
    Console.WriteLine("   The failure rate then climbs with concurrency, because the defect is");
    Console.WriteLine("   two requests overlapping inside one context. More traffic means more");
    Console.WriteLine("   overlap, which is why it presented as a load problem and drew every");
    Console.WriteLine("   hypothesis towards capacity.");
    Console.WriteLine();
    Console.WriteLine("   The contexts column is the diagnosis in one number: ONE CONTEXT FOR");
    Console.WriteLine("   200 REQUESTS against one per request.");
    Console.WriteLine();
    Console.WriteLine("   Note that the application STARTED in every row. It built, bound its");
    Console.WriteLine("   port, passed its health check and served traffic - because");
    Console.WriteLine("   ValidateScopes is off in Production by default, which is the subject");
    Console.WriteLine("   of section 4.");
    Console.WriteLine();
    Console.WriteLine("   THE STAND-IN, STATED PLAINLY. LedgerDbContext here is a class written");
    Console.WriteLine("   for this file, not Entity Framework Core - no package is available");
    Console.WriteLine("   offline. It models the one property that matters: a context permits");
    Console.WriteLine("   one operation at a time and throws when a second starts before the");
    Console.WriteLine("   first finishes.");
    Console.WriteLine();
    Console.WriteLine("   The real message from EF Core is:");
    Console.WriteLine();
    Console.WriteLine("     A second operation was started on this context instance before a");
    Console.WriteLine("     previous operation completed. This is usually caused by different");
    Console.WriteLine("     threads concurrently using the same instance of DbContext.");
    Console.WriteLine();
    Console.WriteLine("   That sentence names the cause and still does not name the CAUSE OF THE");
    Console.WriteLine("   CAUSE, which is a registration in a file nobody was looking at.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatItLookedLike()
{
    Console.WriteLine("3. What it looked like from outside, at four concurrent requests");
    Console.WriteLine();

    Outcome outcome = await RunAsync(asSingleton: true, concurrency: 4);

    Console.WriteLine($"   requests            {outcome.Requests}");
    Console.WriteLine($"   succeeded           {outcome.Requests - outcome.Failed}");
    Console.WriteLine($"   failed              {outcome.Failed}");
    Console.WriteLine($"   failure rate        {100.0 * outcome.Failed / outcome.Requests:0.0}%");
    Console.WriteLine();
    Console.WriteLine("   distinct failures observed:");

    foreach (string message in outcome.Messages.Distinct())
    {
        Console.WriteLine($"     {message}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE SHAPE OF THIS IS WHY IT TOOK SO LONG, and the shape is not what");
    Console.WriteLine("   'intermittent' usually means. It is not a small percentage failing at");
    Console.WriteLine("   random. It is NEARLY EVERYTHING FAILING WHENEVER TWO REQUESTS OVERLAP,");
    Console.WriteLine("   and nothing failing when they do not.");
    Console.WriteLine();
    Console.WriteLine("   From the outside that reads as an outage that comes and goes with");
    Console.WriteLine("   traffic. Retry the failing request by hand while the system is quiet");
    Console.WriteLine("   and it succeeds - so the first thing anybody does to investigate is");
    Console.WriteLine("   the one thing guaranteed to hide it.");
    Console.WriteLine();
    Console.WriteLine("   The first four hypotheses were all reasonable and all wrong:");
    Console.WriteLine();
    Console.WriteLine("     - a database problem, because the exception names the context;");
    Console.WriteLine("     - connection pool exhaustion, because it correlates with load;");
    Console.WriteLine("     - a bad deployment of the database, because the timing matched;");
    Console.WriteLine("     - a networking fault, because it was intermittent.");
    Console.WriteLine();
    Console.WriteLine("   What settled it was not a hypothesis. It was reading the diff of the");
    Console.WriteLine("   deployment that started it, which was two characters long.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Postmortem()
{
    Console.WriteLine("4. What would have prevented it");
    Console.WriteLine();
    Console.WriteLine("   IN ORDER OF HOW EARLY THEY CATCH IT:");
    Console.WriteLine();
    Console.WriteLine("   1. ValidateScopes IN PRODUCTION. The container would have refused to");
    Console.WriteLine("      build, with the exact message:");
    Console.WriteLine();
    Console.WriteLine("        Cannot consume scoped service 'LedgerDbContext' from singleton");
    Console.WriteLine("        'CurrencyCatalogue'.");
    Console.WriteLine();
    Console.WriteLine("      The deployment fails, nothing serves traffic, and the pull request");
    Console.WriteLine("      is reopened. Two lines of configuration:");
    Console.WriteLine();
    Console.WriteLine("        builder.Host.UseDefaultServiceProvider(options =>");
    Console.WriteLine("        {");
    Console.WriteLine("            options.ValidateOnBuild = true;");
    Console.WriteLine("            options.ValidateScopes = true;");
    Console.WriteLine("        });");
    Console.WriteLine();
    Console.WriteLine("   2. A DIFFERENT DESIGN FOR THE CACHE. The singleton did not need a");
    Console.WriteLine("      context; it needed the ability to get one. Taking");
    Console.WriteLine("      IServiceScopeFactory and creating a scope for the load makes the");
    Console.WriteLine("      lifetime question disappear rather than answering it.");
    Console.WriteLine();
    Console.WriteLine("   3. A REVIEW HABIT. 'Changing a lifetime is a change to every");
    Console.WriteLine("      dependency that class holds' is a sentence that, said once in a");
    Console.WriteLine("      review, would have caught this. The diff was two characters and the");
    Console.WriteLine("      blast radius was the whole object graph beneath it.");
    Console.WriteLine();
    Console.WriteLine("   WHAT MAKES THIS CLASS OF BUG DIFFERENT from the ones in earlier");
    Console.WriteLine("   modules: THE FAILURE IS NOT WHERE THE CHANGE IS. Nothing in");
    Console.WriteLine("   CurrencyCatalogue.cs is wrong, nothing in LedgerDbContext.cs is wrong,");
    Console.WriteLine("   and nothing in the endpoint is wrong. The defect exists only in the");
    Console.WriteLine("   relationship between two registrations, which is not a place anybody");
    Console.WriteLine("   thinks to look.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL RULE, worth more than the incident:");
    Console.WriteLine();
    Console.WriteLine("     BEFORE MAKING SOMETHING A SINGLETON, LIST WHAT IT HOLDS. If any of");
    Console.WriteLine("     it is scoped, or mutable, or not thread-safe, you are not making a");
    Console.WriteLine("     caching decision - you are making a concurrency one.");
}

// ---------------------------------------------------------------------------
static async Task<Outcome> RunAsync(bool asSingleton, int concurrency = 32)
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        // Production, which is where the defaults matter.
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Services.AddScoped<LedgerDbContext>();

    if (asSingleton)
    {
        builder.Services.AddSingleton<CurrencyCatalogue>();
    }
    else
    {
        builder.Services.AddScoped<CurrencyCatalogue>();
    }

    string startup = "started";
    WebApplication app;

    try
    {
        app = builder.Build();
    }
    catch (Exception exception)
    {
        return new Outcome($"REFUSED: {exception.GetType().Name}", 0, 0, 0, []);
    }

    var failures = new ConcurrentQueue<string>();
    int contextsBefore = LedgerDbContext.Created;

    app.MapGet("/rates/{code}", async (string code, CurrencyCatalogue catalogue) =>
    {
        try
        {
            return Results.Ok(new { code, rate = await catalogue.RateAsync(code) });
        }
        catch (Exception exception)
        {
            failures.Enqueue(exception.Message);

            return Results.Problem(title: "lookup failed", statusCode: 500);
        }
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    const int Requests = 200;
    int failed = 0;

    await Parallel.ForAsync(0, Requests, new ParallelOptions { MaxDegreeOfParallelism = concurrency },
        async (index, token) =>
        {
            using HttpResponseMessage response = await http.GetAsync($"/rates/GBP", token);

            if (!response.IsSuccessStatusCode)
            {
                Interlocked.Increment(ref failed);
            }
        });

    await app.StopAsync();
    await app.DisposeAsync();

    return new Outcome(startup, LedgerDbContext.Created - contextsBefore, Requests, failed,
        [.. failures]);
}

// ---------------------------------------------------------------------------
record Outcome(string Startup, int ContextsCreated, int Requests, int Failed, List<string> Messages);

// A STAND-IN for a real database context. Entity Framework Core is not
// available offline, so this models the one property the incident turns on: a
// context serves one operation at a time and throws if a second overlaps.
public sealed class LedgerDbContext : IDisposable
{
    private static int _created;
    private int _inFlight;

    public LedgerDbContext() => Interlocked.Increment(ref _created);

    public static int Created => Volatile.Read(ref _created);

    public async Task<decimal> QueryRateAsync(string code)
    {
        if (Interlocked.Increment(ref _inFlight) > 1)
        {
            Interlocked.Decrement(ref _inFlight);

            throw new InvalidOperationException(
                "A second operation was started on this context instance before a previous " +
                "operation completed.");
        }

        try
        {
            // Stands in for the round trip to the database.
            await Task.Delay(2);

            return code == "GBP" ? 1.00m : 0.85m;
        }
        finally
        {
            Interlocked.Decrement(ref _inFlight);
        }
    }

    public void Dispose() { }
}

// Not touched by the change. It takes a context because it has to read a table.
public sealed class CurrencyCatalogue(LedgerDbContext db)
{
    public Task<decimal> RateAsync(string code) => db.QueryRateAsync(code);
}
