// 05-production.cs — Ledger adds a response cache to fix a latency problem and
// starts serving one merchant's statement to another. The cache is correct; its
// position in the pipeline is not.
//
// Run:  dotnet run 05-production.cs -c Release
//
// EXACT vs RATIO: every response body and leak count here is exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;

TheIncident();
await FourArrangements();
WhatToTake();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   GET /statement is slow - it aggregates a month of payments and takes");
    Console.WriteLine("   about 800 ms. Merchants poll it, so it is the top entry in the");
    Console.WriteLine("   latency dashboard.");
    Console.WriteLine();
    Console.WriteLine("   Someone adds a small in-memory response cache middleware: key on the");
    Console.WriteLine("   path, store the body, serve it for sixty seconds. p99 drops from");
    Console.WriteLine("   800 ms to single digits. The change is twenty lines and it works.");
    Console.WriteLine();
    Console.WriteLine("   Four days later a merchant opens a support ticket containing another");
    Console.WriteLine("   merchant's payment totals.");
    Console.WriteLine();
    Console.WriteLine("   Nothing in the cache is wrong. It stores what it was given and");
    Console.WriteLine("   returns it for the same key. The defect is entirely in WHERE it sits");
    Console.WriteLine("   relative to authentication, and what it uses as a key.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task FourArrangements()
{
    Console.WriteLine("2. Four arrangements of the same three components");
    Console.WriteLine();

    Result before = await RunAsync("cache BEFORE auth, keyed on path",
        cacheFirst: true, keyIncludesUser: false);

    Result after = await RunAsync("cache AFTER auth, keyed on path",
        cacheFirst: false, keyIncludesUser: false);

    Result keyed = await RunAsync("cache AFTER auth, keyed on path + user",
        cacheFirst: false, keyIncludesUser: true);

    Result unauth = await RunAsync("cache BEFORE auth, anonymous caller",
        cacheFirst: true, keyIncludesUser: false, anonymousProbe: true);

    Console.WriteLine("   arrangement                              the second caller saw       leak?");
    Console.WriteLine("   -----------                              ---------------------       -----");
    Console.WriteLine($"   {before.Label,-38}   {before.SecondCallerSaw,-25}   {(before.Leaked ? "YES" : "no")}");
    Console.WriteLine($"   {after.Label,-38}   {after.SecondCallerSaw,-25}   {(after.Leaked ? "YES" : "no")}");
    Console.WriteLine($"   {keyed.Label,-38}   {keyed.SecondCallerSaw,-25}   {(keyed.Leaked ? "YES" : "no")}");
    Console.WriteLine($"   {unauth.Label,-38}   {unauth.SecondCallerSaw,-25}   {(unauth.Leaked ? "YES" : "no")}");
    Console.WriteLine();
    Console.WriteLine($"   times the endpoint actually ran, per arrangement:");
    Console.WriteLine($"     cache before auth              : {before.EndpointCalls}");
    Console.WriteLine($"     cache after auth, path key     : {after.EndpointCalls}");
    Console.WriteLine($"     cache after auth, path+user key: {keyed.EndpointCalls}");
    Console.WriteLine();
    Console.WriteLine("   ROW 1 IS THE INCIDENT. Merchant B asked for its own statement and");
    Console.WriteLine("   received merchant A's. The cache ran before authentication, so it");
    Console.WriteLine("   had no idea who was asking - there was no user yet to key on.");
    Console.WriteLine();
    Console.WriteLine("   ROW 4 is the same arrangement with an ANONYMOUS caller, and it is");
    Console.WriteLine("   worse. The request never reached authentication at all, because the");
    Console.WriteLine("   cache short-circuited first. A caller with no credentials received a");
    Console.WriteLine("   real merchant's statement, and the authentication middleware never");
    Console.WriteLine("   ran to object.");
    Console.WriteLine();
    Console.WriteLine("   That is the part worth sitting with. A SHORT-CIRCUITING MIDDLEWARE");
    Console.WriteLine("   BEFORE AUTHENTICATION DOES NOT MERELY GET THE ANSWER WRONG - IT");
    Console.WriteLine("   REMOVES AUTHENTICATION FROM THE REQUEST. Every check registered");
    Console.WriteLine("   after it is skipped, silently, on exactly the requests it serves.");
    Console.WriteLine();
    Console.WriteLine("   ROW 2 fixes the ordering and is STILL WRONG. Authentication now runs");
    Console.WriteLine("   first, so the caller is identified and rejected if anonymous - but");
    Console.WriteLine("   the cache key is the path, which is the same for every merchant. The");
    Console.WriteLine("   endpoint ran once and both callers got that one answer.");
    Console.WriteLine();
    Console.WriteLine("   Position and key are two separate decisions, and fixing one does not");
    Console.WriteLine("   fix the other.");
    Console.WriteLine();
    Console.WriteLine("   ROW 3 is correct: after authentication, and keyed on the identity as");
    Console.WriteLine("   well as the path. The endpoint ran twice, which is the honest cost -");
    Console.WriteLine("   a per-user cache has a lower hit rate than a shared one, and that is");
    Console.WriteLine("   what correctness costs here.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<Result> RunAsync(string label, bool cacheFirst, bool keyIncludesUser,
    bool anonymousProbe = false)
{
    var cache = new ConcurrentDictionary<string, string>();
    int endpointCalls = 0;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    // Stands in for UseAuthentication + UseAuthorization: identify the caller
    // from a header, reject anyone without one.
    void AddAuth(WebApplication a) => a.Use(async (context, next) =>
    {
        string? merchant = context.Request.Headers["X-Merchant"].FirstOrDefault();

        if (string.IsNullOrEmpty(merchant))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsync("unauthenticated");
            return;
        }

        context.Items["merchant"] = merchant;
        await next();
    });

    // A response cache. Nothing about it is wrong - it stores what it is given
    // and returns it for the same key.
    void AddCache(WebApplication a) => a.Use(async (context, next) =>
    {
        string key = keyIncludesUser
            ? $"{context.Request.Path}|{context.Items["merchant"]}"
            : context.Request.Path.ToString();

        if (cache.TryGetValue(key, out string? hit))
        {
            context.Response.Headers["X-Cache"] = "HIT";
            await context.Response.WriteAsync(hit);
            return;                      // short-circuit
        }

        // Buffer the response so it can be stored. See 04-response-lifecycle.cs
        // for what this costs and why caching middleware accepts the cost.
        Stream original = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;

        string body;
        try
        {
            await next();
        }
        finally
        {
            // MUST be restored in a finally. Without it, an exception thrown below
            // leaves Response.Body pointing at this buffer, so an exception handler
            // higher up writes its 500 into a MemoryStream nobody reads and the
            // client receives an empty body.
            buffer.Position = 0;
            body = await new StreamReader(buffer).ReadToEndAsync();
            context.Response.Body = original;
        }

        if (context.Response.StatusCode == 200)
        {
            cache[key] = body;
        }

        context.Response.Headers["X-Cache"] = "MISS";
        await context.Response.WriteAsync(body);
    });

    if (cacheFirst)
    {
        AddCache(app);
        AddAuth(app);
    }
    else
    {
        AddAuth(app);
        AddCache(app);
    }

    app.MapGet("/statement", (HttpContext context) =>
    {
        Interlocked.Increment(ref endpointCalls);
        return $"statement for {context.Items["merchant"]}";
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    // Merchant A asks first and populates the cache.
    await SendAsync(http, "merchant-a");

    // Then the second caller.
    string second = anonymousProbe
        ? await SendAsync(http, null)
        : await SendAsync(http, "merchant-b");

    await app.StopAsync();

    bool leaked = second.Contains("merchant-a", StringComparison.Ordinal);
    return new Result(label, second, leaked, endpointCalls);

    static async Task<string> SendAsync(HttpClient http, string? merchant)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/statement");
        if (merchant is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Merchant", merchant);
        }

        using HttpResponseMessage response = await http.SendAsync(request);
        string body = await response.Content.ReadAsStringAsync();
        return (int)response.StatusCode == 200 ? body : $"{(int)response.StatusCode}";
    }
}

// ---------------------------------------------------------------------------
static void WhatToTake()
{
    Console.WriteLine("3. What to take from this");
    Console.WriteLine();
    Console.WriteLine("   THE CACHE WAS NEVER BROKEN. All four rows run the identical caching");
    Console.WriteLine("   code. What changed was its position and its key.");
    Console.WriteLine();
    Console.WriteLine("   Three rules generalise past caching:");
    Console.WriteLine();
    Console.WriteLine("   1. ANYTHING THAT CAN SHORT-CIRCUIT MUST SIT AFTER AUTHENTICATION AND");
    Console.WriteLine("      AUTHORISATION, unless it is deliberately public. A short circuit");
    Console.WriteLine("      skips everything registered after it, so placing one above your");
    Console.WriteLine("      security checks removes them for those requests.");
    Console.WriteLine();
    Console.WriteLine("      That covers caches, rate limiters that return early, static file");
    Console.WriteLine("      handlers, and any 'fast path' somebody adds for performance.");
    Console.WriteLine();
    Console.WriteLine("   2. A CACHE KEY MUST INCLUDE EVERYTHING THE RESPONSE VARIES BY. Path,");
    Console.WriteLine("      query string, identity, tenant, language, and any request header");
    Console.WriteLine("      that changes the answer. Anything you leave out is a way for one");
    Console.WriteLine("      caller to receive another's response.");
    Console.WriteLine();
    Console.WriteLine("      This is the same rule as the Vary header in HTTP, applied to your");
    Console.WriteLine("      own cache rather than somebody else's.");
    Console.WriteLine();
    Console.WriteLine("   3. A MIDDLEWARE CAN ONLY USE WHAT EARLIER MIDDLEWARE HAS ESTABLISHED.");
    Console.WriteLine("      The cache could not key on the user before authentication because");
    Console.WriteLine("      there was no user yet. Not because it was written badly - because");
    Console.WriteLine("      the information did not exist at that point in the pipeline.");
    Console.WriteLine();
    Console.WriteLine("   THE NUMBERS. Ledger serves 80 merchants and the statement endpoint is");
    Console.WriteLine("   polled roughly once a minute each, so about 4,800 requests an hour.");
    Console.WriteLine("   With a 60-second cache and the broken key, every request in each");
    Console.WriteLine("   minute after the first returns whichever merchant asked first -");
    Console.WriteLine("   roughly 4,720 responses an hour delivered to the wrong merchant,");
    Console.WriteLine("   each one containing payment totals.");
    Console.WriteLine();
    Console.WriteLine("   It was reported after four days by one merchant who read carefully.");
    Console.WriteLine("   The latency dashboard looked excellent throughout, which is why");
    Console.WriteLine("   nobody was looking.");
    Console.WriteLine();
    Console.WriteLine("   HOW TO CATCH IT. One test, and it is not a unit test - it needs the");
    Console.WriteLine("   real pipeline, because the bug is entirely in the pipeline:");
    Console.WriteLine();
    Console.WriteLine("     request the same path as two different users, in that order, and");
    Console.WriteLine("     assert the second response does not contain the first user's data");
    Console.WriteLine();
    Console.WriteLine("   Then repeat it with no credentials at all and assert a 401. That");
    Console.WriteLine("   second assertion is the one that catches a short-circuit sitting");
    Console.WriteLine("   above authentication, and it is three lines.");
}

// ---------------------------------------------------------------------------
record Result(string Label, string SecondCallerSaw, bool Leaked, int EndpointCalls);
