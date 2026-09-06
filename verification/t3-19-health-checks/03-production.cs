// 03-production.cs — The health check that took down the cluster.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: the instances, probes and restarts below are real - six
// ASP.NET Core applications, probed over HTTP by a real prober loop, restarted
// when they fail. The database is a model with a stated connection limit, and
// the wall-clock scale is compressed. What the run demonstrates is the SHAPE:
// which configuration recovers when the dependency does, and which does not.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

Console.WriteLine("An incident: 'the database blipped and the fleet did not come back'");
Console.WriteLine();

TheIncident();
await TheRun(livenessTouchesDatabase: true);
await TheRun(livenessTouchesDatabase: false);
WhatToWatch();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. What was seen");
    Console.WriteLine();
    Console.WriteLine("   Ledger runs twenty instances behind a load balancer, all talking to");
    Console.WriteLine("   one database. The health endpoint was written on the first day and had");
    Console.WriteLine("   never been touched:");
    Console.WriteLine();
    Console.WriteLine("     builder.Services.AddHealthChecks()");
    Console.WriteLine("         .AddCheck(\"database\", ...)");
    Console.WriteLine("         .AddCheck(\"gateway\", ...);");
    Console.WriteLine();
    Console.WriteLine("     app.MapHealthChecks(\"/health\");");
    Console.WriteLine();
    Console.WriteLine("   The deployment manifest points BOTH the liveness probe AND the");
    Console.WriteLine("   readiness probe at /health, because there is one endpoint and two");
    Console.WriteLine("   fields that want a URL.");
    Console.WriteLine();
    Console.WriteLine("     03:12   The database fails over to its replica. It is unreachable");
    Console.WriteLine("             for about forty seconds. This is a routine, tested event.");
    Console.WriteLine();
    Console.WriteLine("     03:12   Every instance's /health starts returning 503.");
    Console.WriteLine();
    Console.WriteLine("     03:13   The orchestrator's liveness probe reaches its failure");
    Console.WriteLine("             threshold ON EVERY INSTANCE AT THE SAME TIME, because every");
    Console.WriteLine("             instance is failing for the same reason at the same moment.");
    Console.WriteLine("             It kills all twenty.");
    Console.WriteLine();
    Console.WriteLine("     03:13   Twenty containers start. Each opens a connection pool,");
    Console.WriteLine("             loads reference data, and warms a cache.");
    Console.WriteLine();
    Console.WriteLine("     03:14   The database finishes failing over - into twenty cold");
    Console.WriteLine("             instances all connecting at once. It exhausts its connection");
    Console.WriteLine("             limit. Instances fail their probes and are killed again.");
    Console.WriteLine();
    Console.WriteLine("     03:31   Someone scales the deployment to two, waits, and scales back");
    Console.WriteLine("             up slowly. Recovery is manual.");
    Console.WriteLine();
    Console.WriteLine("   THE DATABASE WAS DOWN FOR FORTY SECONDS. THE SERVICE WAS DOWN FOR");
    Console.WriteLine("   NINETEEN MINUTES. Everything after 03:13 was done by Ledger's own");
    Console.WriteLine("   infrastructure, correctly, following the instructions it was given.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheRun(bool livenessTouchesDatabase)
{
    Console.WriteLine(livenessTouchesDatabase
        ? "2. The run, with liveness pointed at /health"
        : "3. The same run, with liveness pointed at a process-only check");
    Console.WriteLine();

    // The shared dependency. It goes away for a while and comes back, and it
    // can only serve so many connections at once.
    var database = new Database(connectionLimit: 4);

    var fleet = new List<Instance>();

    for (int i = 0; i < 6; i++)
    {
        fleet.Add(await Instance.StartAsync($"instance-{i + 1}", database, cold: false));
    }

    Console.WriteLine("   round   database   instances up   serving traffic   killed this round");
    Console.WriteLine("   -----   --------   ------------   ---------------   -----------------");

    int totalRestarts = 0;

    for (int round = 1; round <= 14; round++)
    {
        // The database is unreachable for rounds 3 to 6 - the failover.
        database.Reachable = round is < 3 or > 6;

        int killed = 0;
        int ready = 0;

        foreach (Instance instance in fleet.ToList())
        {
            // The prober asks the endpoint the manifest points it at.
            bool liveness = await instance.ProbeAsync(
                livenessTouchesDatabase ? "/health" : "/health/live");

            bool readiness = await instance.ProbeAsync("/health");

            if (readiness)
            {
                ready++;
            }

            if (liveness)
            {
                instance.ConsecutiveLivenessFailures = 0;
            }
            else if (++instance.ConsecutiveLivenessFailures >= 2)
            {
                // Threshold reached: kill it and start a replacement, which
                // is cold and takes connections to warm up.
                await instance.StopAsync();
                fleet.Remove(instance);
                fleet.Add(await Instance.StartAsync(instance.Name, database, cold: true));

                killed++;
                totalRestarts++;
            }
        }

        // Cold instances hold connections while they warm up.
        database.ConnectionsInUse = fleet.Count(i => i.IsCold);

        foreach (Instance instance in fleet)
        {
            instance.Tick();
        }

        Console.WriteLine($"   {round,5}   {(database.Reachable ? "up" : "DOWN"),-8}   " +
            $"{fleet.Count,12}   {ready,15}   {(killed == 0 ? "-" : killed.ToString()),-17}");
    }

    int finallyServing = 0;

    foreach (Instance instance in fleet)
    {
        if (await instance.ProbeAsync("/health"))
        {
            finallyServing++;
        }
    }

    foreach (Instance instance in fleet)
    {
        await instance.StopAsync();
    }

    Console.WriteLine();
    Console.WriteLine($"   restarts over the run          {totalRestarts}");
    Console.WriteLine($"   instances serving at the end   {finallyServing} of 6");
    Console.WriteLine();

    if (livenessTouchesDatabase)
    {
        Console.WriteLine("   THE DATABASE WAS AWAY FOR FOUR ROUNDS AND THE FLEET NEVER CAME");
        Console.WriteLine("   BACK. Read down the 'killed' column: six kills every other round,");
        Console.WriteLine("   for eight rounds AFTER the database recovered, and nothing serving");
        Console.WriteLine("   traffic at the end.");
        Console.WriteLine();
        Console.WriteLine("   TWO SEPARATE MECHANISMS ARE RUNNING, AND THE SECOND IS THE ONE THAT");
        Console.WriteLine("   MAKES IT PERMANENT.");
        Console.WriteLine();
        Console.WriteLine("     FIRST: THE FAILURE IS CORRELATED. Every instance depends on the");
        Console.WriteLine("     same database, so every instance fails on the same round. Nothing");
        Console.WriteLine("     is staggered and nothing is left running - the orchestrator has");
        Console.WriteLine("     no healthy instance to compare against, so 'all of them are");
        Console.WriteLine("     broken' looks the same as 'this one is broken'.");
        Console.WriteLine();
        Console.WriteLine("     SECOND, AND THIS IS THE TRAP: A REPLACEMENT TAKES THREE ROUNDS TO");
        Console.WriteLine("     WARM UP AND THE KILL THRESHOLD IS TWO. A fresh instance fails the");
        Console.WriteLine("     combined check twice while it is loading, hits the threshold, and");
        Console.WriteLine("     is killed before it can ever pass. ITS REPLACEMENT THEN DOES THE");
        Console.WriteLine("     SAME THING. That loop does not need the database to be down; it");
        Console.WriteLine("     only needed the database to be down ONCE, to knock the warm");
        Console.WriteLine("     instances over.");
        Console.WriteLine();
        Console.WriteLine("   THAT SECOND MECHANISM IS EXACTLY WHAT A STARTUP PROBE PREVENTS, and");
        Console.WriteLine("   the absence of one is why forty seconds became nineteen minutes. A");
        Console.WriteLine("   startup probe suspends liveness until the instance has warmed up");
        Console.WriteLine("   once, so a slow start can never be mistaken for a wedged process.");
        Console.WriteLine();
        Console.WriteLine("   AND THE CONNECTION LIMIT IS THE THIRD AMPLIFIER, which this run has");
        Console.WriteLine("   with six instances and the real incident had with twenty: cold");
        Console.WriteLine("   instances hold connections while warming, so the restarts make the");
        Console.WriteLine("   database less able to answer the checks that trigger the restarts.");
        Console.WriteLine("   EVERY RESTART INCREASES THE LOAD THAT CAUSES THE NEXT ONE, which is");
        Console.WriteLine("   the definition of a loop that needs a human to stop it.");
        Console.WriteLine();
    }
    else
    {
        Console.WriteLine("   NOTHING WAS KILLED AND THE FLEET RECOVERED ON ITS OWN. Readiness");
        Console.WriteLine("   went to zero while the database was away - which is correct, and is");
        Console.WriteLine("   what stops traffic reaching an instance that cannot serve it - and");
        Console.WriteLine("   came back the round after the database did.");
        Console.WriteLine();
        Console.WriteLine("   THE PROCESSES WERE NEVER WRONG. They were waiting for a dependency,");
        Console.WriteLine("   which is a thing a correct process does. Restarting them would have");
        Console.WriteLine("   discarded warm connection pools and loaded caches, in exchange for");
        Console.WriteLine("   nothing.");
        Console.WriteLine();
        Console.WriteLine("   THE DIFFERENCE BETWEEN SECTIONS 2 AND 3 IS ONE URL IN A DEPLOYMENT");
        Console.WriteLine("   MANIFEST. Not a code change, not an architecture change - a field");
        Console.WriteLine("   that pointed at /health and now points at /health/live.");
        Console.WriteLine();
    }
}

// ---------------------------------------------------------------------------
static void WhatToWatch()
{
    Console.WriteLine("4. What to check, and what to watch");
    Console.WriteLine();
    Console.WriteLine("   THE ONE-QUESTION AUDIT, WHICH TAKES A MINUTE: for every check on your");
    Console.WriteLine("   liveness endpoint, ask WOULD RESTARTING THIS PROCESS FIX IT? A database");
    Console.WriteLine("   that is down: no. A queue that is unreachable: no. DNS: no. A deadlock");
    Console.WriteLine("   in your own code, an exhausted thread pool, a wedged background loop:");
    Console.WriteLine("   yes, and those are the only things liveness is for.");
    Console.WriteLine();
    Console.WriteLine("   READ THE DEPLOYMENT MANIFEST, NOT THE CODE. This bug does not exist in");
    Console.WriteLine("   C#. The endpoints in section 3 are correct in both runs; only the URL");
    Console.WriteLine("   the probe points at differs. A code review will never find it.");
    Console.WriteLine();
    Console.WriteLine("   ALERT ON RESTARTS, NOT ONLY ON ERRORS. A restart count that rises");
    Console.WriteLine("   across the whole fleet at once is this failure and almost nothing");
    Console.WriteLine("   else. It is the earliest unambiguous signal, and most teams do not");
    Console.WriteLine("   graph it.");
    Console.WriteLine();
    Console.WriteLine("   ALERT ON CORRELATED READINESS. One instance unready is a bad instance.");
    Console.WriteLine("   Every instance unready at the same second is a shared dependency, and");
    Console.WriteLine("   the two want completely different responses from a human.");
    Console.WriteLine();
    Console.WriteLine("   AND TEST THE FAILOVER WITH THE PROBES ATTACHED. Ledger had tested the");
    Console.WriteLine("   database failover. They had tested it against a service that was not");
    Console.WriteLine("   being probed by an orchestrator with a kill threshold. THE DEPENDENCY");
    Console.WriteLine("   FAILURE WAS HANDLED CORRECTLY; THE REACTION TO IT WAS NEVER TESTED.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// The shared dependency: reachable or not, with a limit on how many
// connections it can serve at once.
sealed class Database(int connectionLimit)
{
    public bool Reachable { get; set; } = true;

    public int ConnectionsInUse { get; set; }

    public bool CanServe => Reachable && ConnectionsInUse <= connectionLimit;
}

// ---------------------------------------------------------------------------
// One real ASP.NET Core application, with the two endpoints the module argues
// for. Cold for a few rounds after starting, during which it holds a
// connection.
sealed class Instance
{
    WebApplication app = null!;
    HttpClient http = null!;
    int roundsUntilWarm;

    public string Name { get; private init; } = "";

    public int ConsecutiveLivenessFailures { get; set; }

    public bool IsCold => roundsUntilWarm > 0;

    public static async Task<Instance> StartAsync(string name, Database database, bool cold)
    {
        // A replacement container has to open a connection pool and warm a
        // cache before it can serve. An already-running instance has not.
        var instance = new Instance { Name = name, roundsUntilWarm = cold ? 3 : 0 };

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        builder.Services.AddHealthChecks()
            // Depends on nothing outside this process.
            .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])

            // Depends on the shared database, and on this instance having
            // finished warming up.
            .AddCheck("database", () => database.CanServe && !instance.IsCold
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("Cannot serve."), tags: ["ready"]);

        instance.app = builder.Build();

        instance.app.MapHealthChecks("/health/live", new HealthCheckOptions
        {
            Predicate = r => r.Tags.Contains("live")
        });

        // The endpoint that runs everything - what the incident pointed both
        // probes at.
        instance.app.MapHealthChecks("/health");

        await instance.app.StartAsync();

        instance.http = new HttpClient { BaseAddress = new Uri(instance.app.Urls.First()) };

        return instance;
    }

    public async Task<bool> ProbeAsync(string path)
    {
        using HttpResponseMessage response = await http.GetAsync(path);

        return response.IsSuccessStatusCode;
    }

    public void Tick()
    {
        if (roundsUntilWarm > 0)
        {
            roundsUntilWarm--;
        }
    }

    public async Task StopAsync()
    {
        http.Dispose();
        await app.StopAsync();
        await app.DisposeAsync();
    }
}
