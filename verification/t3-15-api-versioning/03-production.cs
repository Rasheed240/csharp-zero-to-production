// 03-production.cs — The incident: v1 was retired on schedule, after six months
// of notice, and a fifth of the traffic was still on it.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every count and status code here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;

await TheIncident();
await WhatWasMissing();
await Sunsetting();
Rules();

// ---------------------------------------------------------------------------
static async Task TheIncident()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   Ledger shipped v2 of its payments API in January. The plan was");
    Console.WriteLine("   ordinary and well run:");
    Console.WriteLine();
    Console.WriteLine("     - v2 announced in January, with a migration guide;");
    Console.WriteLine("     - six months of notice that v1 would be retired;");
    Console.WriteLine("     - three reminder emails to every registered integrator;");
    Console.WriteLine("     - v1 removed in July, on the announced date.");
    Console.WriteLine();
    Console.WriteLine("   Within a minute of the deployment, a fifth of all payment traffic is");
    Console.WriteLine("   returning 404.");
    Console.WriteLine();

    var traffic = Traffic();

    Console.WriteLine("   who was calling what, on the morning v1 was removed:");
    Console.WriteLine();
    Console.WriteLine("   caller                       version   requests/day   registered   emailed");
    Console.WriteLine("   ------                       -------   ------------   ----------   -------");

    foreach (Caller caller in traffic)
    {
        Console.WriteLine($"   {caller.Name,-27}  {caller.Version,-7}   {caller.PerDay,12:n0}   " +
            $"{(caller.Registered ? "yes" : "NO"),-10}   {(caller.Registered ? "yes" : "no")}");
    }

    Caller[] onV1 = [.. traffic.Where(c => c.Version == "/v1")];

    int all = traffic.Sum(c => c.PerDay);
    int v1Total = onV1.Sum(c => c.PerDay);
    int unreachable = onV1.Where(c => !c.Registered).Sum(c => c.PerDay);

    Console.WriteLine();
    Console.WriteLine($"   all payment traffic              {all,12:n0}");
    Console.WriteLine($"   still on v1                      {v1Total,12:n0}  " +
        $"({100.0 * v1Total / all:0}% of everything)");
    Console.WriteLine($"   of that, from callers nobody     {unreachable,12:n0}  " +
        $"({100.0 * unreachable / v1Total:0}% of v1 traffic)");
    Console.WriteLine($"   could have emailed");
    Console.WriteLine();
    Console.WriteLine("   EVERY STEP OF THE PLAN WAS DONE, AND THE PLAN WAS THE PROBLEM. It");
    Console.WriteLine("   assumed the set of callers was the set of registered integrators, and");
    Console.WriteLine("   those are different sets:");
    Console.WriteLine();
    Console.WriteLine("     - a batch job written by somebody who has left, running from a");
    Console.WriteLine("       server nobody associates with an account;");
    Console.WriteLine();
    Console.WriteLine("     - an internal team who integrated by reading the documentation and");
    Console.WriteLine("       never registered, because they did not need a key to;");
    Console.WriteLine();
    Console.WriteLine("     - a partner whose integration was built by an agency, whose");
    Console.WriteLine("       registered contact address bounces.");
    Console.WriteLine();
    Console.WriteLine("   THE ANNOUNCEMENT WAS SENT TO PEOPLE. THE CALLS COME FROM PROCESSES,");
    Console.WriteLine("   and there is no reliable mapping between the two.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatWasMissing()
{
    Console.WriteLine("2. The number nobody had");
    Console.WriteLine();
    Console.WriteLine("   The question that would have prevented this is one line of telemetry:");
    Console.WriteLine("   HOW MANY REQUESTS PER DAY ARE STILL ON v1, AND FROM WHOM.");
    Console.WriteLine();

    var counts = new ConcurrentDictionary<string, int>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var app = builder.Build();

    // The whole instrumentation. One middleware, two dimensions.
    app.Use(async (context, next) =>
    {
        await next(context);

        string version = context.Request.Path.StartsWithSegments("/v1") ? "v1"
            : context.Request.Path.StartsWithSegments("/v2") ? "v2"
            : "none";

        string client = context.Request.Headers["X-Client-Id"].ToString() is { Length: > 0 } id
            ? id
            : "(unidentified)";

        counts.AddOrUpdate($"{version} {client}", 1, (_, existing) => existing + 1);
    });

    app.MapGroup("/v1").MapGet("/payments/{id}", (string id) =>
        Results.Ok(new { id, amount = 500.00m }));

    app.MapGroup("/v2").MapGet("/payments/{id}", (string id) =>
        Results.Ok(new { id, amountMinor = 50_000L }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    // A morning's traffic, in miniature.
    foreach (Caller caller in Traffic())
    {
        for (int request = 0; request < caller.PerDay / 1_000; request++)
        {
            using var message = new HttpRequestMessage(HttpMethod.Get,
                $"{caller.Version}/payments/PAY-1");

            if (caller.Registered)
            {
                message.Headers.Add("X-Client-Id", caller.Name);
            }

            using HttpResponseMessage response = await http.SendAsync(message);
        }
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine("   version and caller                     requests");
    Console.WriteLine("   ------------------                     --------");

    foreach ((string key, int count) in counts.OrderBy(pair => pair.Key))
    {
        Console.WriteLine($"   {key,-37}  {count,8}");
    }

    Console.WriteLine();
    Console.WriteLine("   THAT TABLE IS THE WHOLE FIX, and it costs eight lines of middleware.");
    Console.WriteLine();
    Console.WriteLine("   With it, the retirement decision stops being a date and becomes a");
    Console.WriteLine("   condition: v1 is removed when v1 traffic is zero, or when the traffic");
    Console.WriteLine("   that remains is understood and accepted.");
    Console.WriteLine();
    Console.WriteLine("   NOTE THE '(unidentified)' ROWS. They are the callers the emails could");
    Console.WriteLine("   never have reached, and they are visible here as a number even though");
    Console.WriteLine("   nobody knows who they are.");
    Console.WriteLine();
    Console.WriteLine("   That distinction is what makes the metric useful rather than merely");
    Console.WriteLine("   interesting: 'v1 traffic is falling' is comforting and says nothing;");
    Console.WriteLine("   'v1 traffic is 10,000 a day and 4,000 of it is from callers we");
    Console.WriteLine("   cannot contact' is a decision.");
    Console.WriteLine();
    Console.WriteLine("   REQUIRE A CLIENT IDENTIFIER. If every caller must send one - a key, a");
    Console.WriteLine("   header, an authenticated identity - the unidentified row disappears");
    Console.WriteLine("   and retirement becomes a conversation with a known list.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Sunsetting()
{
    Console.WriteLine("3. Telling the client, in a way a machine can read");
    Console.WriteLine();
    Console.WriteLine("   Emails reach people. These headers reach the process:");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var app = builder.Build();

    RouteGroupBuilder v1 = app.MapGroup("/v1");

    // Applied to the whole group, so no endpoint can forget.
    v1.AddEndpointFilter(async (context, next) =>
    {
        object? result = await next(context);

        HttpResponse response = context.HttpContext.Response;

        // RFC 8594: when this version stops working.
        response.Headers["Sunset"] = "Wed, 01 Jul 2026 00:00:00 GMT";

        // RFC 9745: that it is deprecated, and since when.
        response.Headers["Deprecation"] = "Wed, 01 Jan 2026 00:00:00 GMT";

        // RFC 8288: where to read about the replacement.
        response.Headers["Link"] =
            "<https://docs.ledger.example/v2/migration>; rel=\"deprecation\"; type=\"text/html\", " +
            "<https://api.ledger.example/v2/payments>; rel=\"successor-version\"";

        return result;
    });

    v1.MapGet("/payments/{id}", (string id) => Results.Ok(new { id, amount = 500.00m }));

    app.MapGroup("/v2").MapGet("/payments/{id}", (string id) =>
        Results.Ok(new { id, amountMinor = 50_000L }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    using HttpResponseMessage response = await http.GetAsync("/v1/payments/PAY-1");

    Console.WriteLine($"   GET /v1/payments/PAY-1   {(int)response.StatusCode}");
    Console.WriteLine();

    foreach ((string name, var values) in response.Headers
        .Where(h => h.Key is "Sunset" or "Deprecation" or "Link"))
    {
        Console.WriteLine($"     {name}: {string.Join(", ", values)}");
    }

    using HttpResponseMessage current = await http.GetAsync("/v2/payments/PAY-1");

    Console.WriteLine();
    Console.WriteLine($"   GET /v2/payments/PAY-1   {(int)current.StatusCode}, " +
        $"{(current.Headers.Contains("Sunset") ? "Sunset present" : "no Sunset header")}");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THREE STANDARD HEADERS, AND NOT ONE OF THEM CHANGES THE RESPONSE. A");
    Console.WriteLine("   client that ignores them is unaffected; one that reads them can log a");
    Console.WriteLine("   warning, fail a build, or raise a ticket - automatically, without");
    Console.WriteLine("   anybody reading an email.");
    Console.WriteLine();
    Console.WriteLine("     Sunset        the date this stops working (RFC 8594)");
    Console.WriteLine("     Deprecation   the date it became deprecated (RFC 9745)");
    Console.WriteLine("     Link          where to read about the replacement (RFC 8288)");
    Console.WriteLine();
    Console.WriteLine("   BE HONEST ABOUT WHAT THIS BUYS. Most clients do not read them, so this");
    Console.WriteLine("   is not a substitute for the telemetry in section 2 - it is the half of");
    Console.WriteLine("   the job that scales to callers you have never heard of, and it costs");
    Console.WriteLine("   one filter on one route group.");
    Console.WriteLine();
    Console.WriteLine("   ADD THE HEADER ON THE DAY YOU SHIP THE REPLACEMENT, not on the day you");
    Console.WriteLine("   plan the removal. The value of a Sunset date six months out is that it");
    Console.WriteLine("   appears in somebody's logs six months out.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Rules()
{
    Console.WriteLine("4. How to retire a version");
    Console.WriteLine();
    Console.WriteLine("   1. COUNT THE TRAFFIC PER VERSION, PER CALLER, FROM THE DAY THE NEW");
    Console.WriteLine("      VERSION SHIPS. Not from the day you decide to retire the old one -");
    Console.WriteLine("      you need the trend, and you need to know which callers exist.");
    Console.WriteLine();
    Console.WriteLine("   2. SEND Sunset AND Deprecation HEADERS on every old-version response,");
    Console.WriteLine("      from the same day. Machines read these; people read emails; you");
    Console.WriteLine("      need both because you can only reach some callers each way.");
    Console.WriteLine();
    Console.WriteLine("   3. CONTACT THE CALLERS YOU CAN IDENTIFY, using the telemetry rather");
    Console.WriteLine("      than the account list - those are different sets and the difference");
    Console.WriteLine("      is the whole incident.");
    Console.WriteLine();
    Console.WriteLine("   4. BROWN OUT BEFORE YOU TURN OFF. Return 410 for a few hours on a");
    Console.WriteLine("      chosen day, then restore v1. Anybody still calling it finds out");
    Console.WriteLine("      while you are watching and while it is reversible, which converts");
    Console.WriteLine("      an outage into a fire drill.");
    Console.WriteLine();
    Console.WriteLine("   5. RETIRE ON A CONDITION, NOT A DATE: when traffic is zero, or when");
    Console.WriteLine("      what remains is understood and somebody has accepted breaking it.");
    Console.WriteLine();
    Console.WriteLine("   6. RETURN 410 Gone, NOT 404. A 404 says the path does not exist and");
    Console.WriteLine("      invites the caller to check for a typo; 410 says it existed and was");
    Console.WriteLine("      removed. With a Link header pointing at the migration guide, the");
    Console.WriteLine("      person debugging it has everything they need in the response.");
    Console.WriteLine();
    Console.WriteLine("   THE UNCOMFORTABLE PART, and it is worth saying plainly: A PUBLIC API");
    Console.WriteLine("   VERSION MAY NEVER FULLY DIE. Some callers will not migrate, ever, and");
    Console.WriteLine("   at some point the decision is to break them deliberately rather than");
    Console.WriteLine("   to keep waiting.");
    Console.WriteLine();
    Console.WriteLine("   That decision is legitimate. What makes it a decision rather than an");
    Console.WriteLine("   accident is knowing the number, knowing who, and choosing the day.");
}

// ---------------------------------------------------------------------------
static Caller[] Traffic() =>
[
    new("acme-corp", "/v1", 4_000, Registered: true),
    new("globex-batch", "/v1", 3_000, Registered: false),
    new("initech-mobile", "/v1", 2_000, Registered: true),
    new("internal-reporting", "/v1", 1_000, Registered: false),
    new("acme-corp", "/v2", 40_000, Registered: true)
];

record Caller(string Name, string Version, int PerDay, bool Registered);
