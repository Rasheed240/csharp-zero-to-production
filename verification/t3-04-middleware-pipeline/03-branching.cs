// 03-branching.cs — Map, MapWhen and UseWhen: which of them rejoin the main
// pipeline, and what Map does to the request path.
//
// Run:  dotnet run 03-branching.cs -c Release
//
// EXACT vs RATIO: the ORDER, the paths and the status codes are deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

await Rejoining();
await WhatMapDoesToThePath();
await Choosing();

// ---------------------------------------------------------------------------
static async Task Rejoining()
{
    Console.WriteLine("1. Which branches come back");
    Console.WriteLine();

    Console.WriteLine("   path        branch used   what ran");
    Console.WriteLine("   ----        -----------   --------");

    foreach (string path in new[] { "/map/x", "/mapwhen", "/usewhen", "/plain" })
    {
        string ran = await RunAsync(path);
        string which = path switch
        {
            "/map/x" => "Map",
            "/mapwhen" => "MapWhen",
            "/usewhen" => "UseWhen",
            _ => "(none)"
        };

        Console.WriteLine($"   {path,-10}  {which,-11}   {ran}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE DIFFERENCE IS THE LAST COLUMN. UseWhen's branch ran and then");
    Console.WriteLine("   CAME BACK to the main pipeline. Map and MapWhen did not - their");
    Console.WriteLine("   branches are terminal, and 'after' never runs.");
    Console.WriteLine();
    Console.WriteLine("     Map(path, branch)          matches a path PREFIX. Terminal.");
    Console.WriteLine("     MapWhen(predicate, branch) matches any predicate. Terminal.");
    Console.WriteLine("     UseWhen(predicate, branch) matches any predicate. REJOINS.");
    Console.WriteLine();
    Console.WriteLine("   That single distinction decides which one you want, and it is not");
    Console.WriteLine("   visible in the names:");
    Console.WriteLine();
    Console.WriteLine("     - USE UseWhen when the branch ADDS something for some requests -");
    Console.WriteLine("       extra logging, a header, authentication for one path prefix -");
    Console.WriteLine("       and the request should carry on as normal afterwards.");
    Console.WriteLine();
    Console.WriteLine("     - USE Map or MapWhen when the branch IS the whole handling for");
    Console.WriteLine("       those requests - a health endpoint, a metrics endpoint, a");
    Console.WriteLine("       separate sub-application.");
    Console.WriteLine();
    Console.WriteLine("   Choosing MapWhen where you meant UseWhen is a quiet failure: the");
    Console.WriteLine("   branch works, and everything that was supposed to happen afterwards");
    Console.WriteLine("   silently does not. No error, no warning - the request ends");
    Console.WriteLine("   earlier than you expected.");
    Console.WriteLine();

    static async Task<string> RunAsync(string path)
    {
        var log = new List<string>();

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();

        app.Use(async (context, next) =>
        {
            log.Add("before");
            await next();
        });

        app.Map("/map", branch => branch.Run(async context =>
        {
            log.Add("Map branch");
            await context.Response.WriteAsync("map");
        }));

        app.MapWhen(
            context => context.Request.Path.StartsWithSegments("/mapwhen"),
            branch => branch.Run(async context =>
            {
                log.Add("MapWhen branch");
                await context.Response.WriteAsync("mapwhen");
            }));

        app.UseWhen(
            context => context.Request.Path.StartsWithSegments("/usewhen"),
            branch => branch.Use(async (context, next) =>
            {
                log.Add("UseWhen branch");
                await next();
            }));

        app.Use(async (context, next) =>
        {
            log.Add("after");
            await next();
        });

        app.MapGet("/{**rest}", () => "endpoint");

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        await http.GetAsync(path);
        await app.StopAsync();

        return string.Join(" -> ", log);
    }
}

// ---------------------------------------------------------------------------
static async Task WhatMapDoesToThePath()
{
    Console.WriteLine("2. What Map does to the request path");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.Map("/admin", branch => branch.Run(async context =>
    {
        await context.Response.WriteAsync(
            $"PathBase='{context.Request.PathBase}' Path='{context.Request.Path}'");
    }));

    app.UseWhen(
        context => context.Request.Path.StartsWithSegments("/reports"),
        branch => branch.Run(async context =>
        {
            await context.Response.WriteAsync(
                $"PathBase='{context.Request.PathBase}' Path='{context.Request.Path}'");
        }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    string mapped = await http.GetStringAsync("/admin/users/42");
    string whenned = await http.GetStringAsync("/reports/monthly/7");

    await app.StopAsync();

    Console.WriteLine($"   GET /admin/users/42   through Map      -> {mapped}");
    Console.WriteLine($"   GET /reports/monthly/7 through UseWhen -> {whenned}");
    Console.WriteLine();
    Console.WriteLine("   MAP STRIPS THE MATCHED PREFIX FROM Path AND MOVES IT TO PathBase.");
    Console.WriteLine("   UseWhen leaves the path alone.");
    Console.WriteLine();
    Console.WriteLine("   That is deliberate and it is what makes Map useful for mounting a");
    Console.WriteLine("   self-contained sub-application: everything inside the branch sees");
    Console.WriteLine("   paths as if it were at the root, so it does not need to know where");
    Console.WriteLine("   it was mounted.");
    Console.WriteLine();
    Console.WriteLine("   It is also a source of confusion, in two directions:");
    Console.WriteLine();
    Console.WriteLine("     - ROUTES INSIDE THE BRANCH MUST NOT REPEAT THE PREFIX. Inside");
    Console.WriteLine("       Map(\"/admin\"), the route is \"/users/{id}\" and not");
    Console.WriteLine("       \"/admin/users/{id}\", which would need /admin/admin/users/42.");
    Console.WriteLine();
    Console.WriteLine("     - LINK GENERATION USES PathBase, so generated URLs come out");
    Console.WriteLine("       correctly with the prefix. Code that builds URLs by hand from");
    Console.WriteLine("       Request.Path alone loses it.");
    Console.WriteLine();
    Console.WriteLine("   PathBase exists for the same reason at the deployment level: an");
    Console.WriteLine("   application hosted at https://example.com/ledger/ has PathBase");
    Console.WriteLine("   '/ledger' and its routes are written as if it were at the root.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Choosing()
{
    Console.WriteLine("3. A branch that changes what the rest of the pipeline sees");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    // Detailed timing headers, but only for internal callers. Everything else
    // continues down the same pipeline untouched.
    app.UseWhen(
        context => context.Request.Headers.ContainsKey("X-Internal"),
        branch => branch.Use(async (context, next) =>
        {
            var started = DateTime.UtcNow;
            context.Response.OnStarting(() =>
            {
                context.Response.Headers["X-Elapsed-Ms"] =
                    (DateTime.UtcNow - started).TotalMilliseconds.ToString("F0");
                return Task.CompletedTask;
            });

            await next();
        }));

    app.MapGet("/payments", () => "the payments");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    HttpResponseMessage external = await http.GetAsync("/payments");

    using var request = new HttpRequestMessage(HttpMethod.Get, "/payments");
    request.Headers.TryAddWithoutValidation("X-Internal", "1");
    HttpResponseMessage internalCall = await http.SendAsync(request);

    await app.StopAsync();

    Console.WriteLine($"   external caller : {(int)external.StatusCode}, " +
        $"X-Elapsed-Ms present: {external.Headers.Contains("X-Elapsed-Ms")}");
    Console.WriteLine($"   internal caller : {(int)internalCall.StatusCode}, " +
        $"X-Elapsed-Ms present: {internalCall.Headers.Contains("X-Elapsed-Ms")}");
    Console.WriteLine();
    Console.WriteLine("   Both requests reached the same endpoint and got the same body. The");
    Console.WriteLine("   branch added something for one of them and then got out of the way.");
    Console.WriteLine();
    Console.WriteLine("   Note OnStarting rather than setting the header after next(). By the");
    Console.WriteLine("   time next() returns, the endpoint has usually started writing and");
    Console.WriteLine("   the headers are already on the wire. OnStarting registers a callback");
    Console.WriteLine("   that runs at the last moment before they go, which is the only");
    Console.WriteLine("   reliable place to add a response header from outside.");
    Console.WriteLine();
    Console.WriteLine("   Two more things worth knowing about branches:");
    Console.WriteLine();
    Console.WriteLine("     - THE PREDICATE RUNS ON EVERY REQUEST, so keep it cheap. It is a");
    Console.WriteLine("       property check, not a database lookup.");
    Console.WriteLine();
    Console.WriteLine("     - THE PREDICATE IS EVALUATED WHERE IT IS REGISTERED, so it can");
    Console.WriteLine("       only see what earlier middleware has set. A UseWhen branching on");
    Console.WriteLine("       context.User must come after UseAuthentication, or the user is");
    Console.WriteLine("       always anonymous and the branch never fires.");
    Console.WriteLine();
    Console.WriteLine("   That last one is the ordering rule from 01 in a different costume,");
    Console.WriteLine("   and it fails the same silent way: the branch never runs.");
}
