// 06-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 06-exercises.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;

await Exercise1();
await Exercise2();
await Exercise3();
await Exercise4();
await Exercise5();
Exercise6();

// ---------------------------------------------------------------------------
// 1. EASY — the order of a three-middleware pipeline.
// ---------------------------------------------------------------------------
static async Task Exercise1()
{
    Console.WriteLine("Exercise 1: in what order do these run, and what does the client get?");
    Console.WriteLine();
    Console.WriteLine("     app.Use(A);  app.Use(B);  app.Run(C);  app.Use(D);");
    Console.WriteLine();

    var log = new List<string>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    app.Use(async (c, next) => { log.Add("A in"); await next(); log.Add("A out"); });
    app.Use(async (c, next) => { log.Add("B in"); await next(); log.Add("B out"); });
    app.Run(async c => { log.Add("C (terminal)"); await c.Response.WriteAsync("from C"); });
    app.Use(async (c, next) => { log.Add("D in"); await next(); log.Add("D out"); });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    string body = await http.GetStringAsync("/");
    await app.StopAsync();

    Console.WriteLine($"   what ran   : {string.Join(" -> ", log)}");
    Console.WriteLine($"   client got : {body}");
    Console.WriteLine();
    Console.WriteLine("   D NEVER RAN. Run is terminal - it takes no next delegate, so there");
    Console.WriteLine("   is no way to reach anything registered after it. Nothing warns you;");
    Console.WriteLine("   the middleware is dead code.");
    Console.WriteLine();
    Console.WriteLine("   The rest is the nesting rule: registration order on the way in,");
    Console.WriteLine("   reverse order on the way out. A wraps B wraps C.");
    Console.WriteLine();
    Console.WriteLine("   Worth knowing: in a normal application the endpoint middleware is");
    Console.WriteLine("   the terminal step, appended automatically at the END of whatever you");
    Console.WriteLine("   registered. So the position of your Map calls relative to your Use");
    Console.WriteLine("   calls changes nothing - only the order of the Use calls matters.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. EASY — which branch rejoins.
// ---------------------------------------------------------------------------
static async Task Exercise2()
{
    Console.WriteLine("Exercise 2: you want to add a header for requests under /internal and");
    Console.WriteLine("            have them continue to the normal endpoints. Map, MapWhen or");
    Console.WriteLine("            UseWhen?");
    Console.WriteLine();

    Console.WriteLine("   construct   what ran for /internal/data");
    Console.WriteLine("   ---------   -------------------------");
    Console.WriteLine($"   Map         {await RunAsync("map")}");
    Console.WriteLine($"   MapWhen     {await RunAsync("mapwhen")}");
    Console.WriteLine($"   UseWhen     {await RunAsync("usewhen")}");
    Console.WriteLine();
    Console.WriteLine("   USEWHEN. It is the only one of the three whose branch REJOINS the");
    Console.WriteLine("   main pipeline - Map and MapWhen are terminal, so the endpoint is");
    Console.WriteLine("   never reached.");
    Console.WriteLine();
    Console.WriteLine("     Map(path, branch)          path PREFIX. Terminal. Also strips the");
    Console.WriteLine("                                prefix from Path into PathBase.");
    Console.WriteLine("     MapWhen(predicate, branch) any predicate. Terminal.");
    Console.WriteLine("     UseWhen(predicate, branch) any predicate. Rejoins.");
    Console.WriteLine();
    Console.WriteLine("   Picking MapWhen here is a quiet failure: the header gets added and");
    Console.WriteLine("   the request never reaches its endpoint. No error, no warning - the");
    Console.WriteLine("   response is a 404 or an empty 200 depending on what the branch did.");
    Console.WriteLine();

    static async Task<string> RunAsync(string kind)
    {
        var log = new List<string>();

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();

        void Branch(IApplicationBuilder b) => b.Use(async (c, next) =>
        {
            log.Add("branch");
            c.Response.Headers["X-Internal"] = "1";
            await next();
        });

        switch (kind)
        {
            case "map":
                app.Map("/internal", Branch);
                break;
            case "mapwhen":
                app.MapWhen(c => c.Request.Path.StartsWithSegments("/internal"), Branch);
                break;
            default:
                app.UseWhen(c => c.Request.Path.StartsWithSegments("/internal"), Branch);
                break;
        }

        app.MapGet("/internal/data", () => { log.Add("endpoint"); return "data"; });

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        await http.GetAsync("/internal/data");
        await app.StopAsync();

        return log.Count == 0 ? "(nothing)" : string.Join(" -> ", log);
    }
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — a header set after next().
// ---------------------------------------------------------------------------
static async Task Exercise3()
{
    Console.WriteLine("Exercise 3: this middleware is supposed to add a timing header and the");
    Console.WriteLine("            header never appears. Why, and what is the fix?");
    Console.WriteLine();
    Console.WriteLine("     app.Use(async (context, next) =>");
    Console.WriteLine("     {");
    Console.WriteLine("         var sw = Stopwatch.StartNew();");
    Console.WriteLine("         await next();");
    Console.WriteLine("         context.Response.Headers[\"X-Elapsed-Ms\"] =");
    Console.WriteLine("             sw.ElapsedMilliseconds.ToString();");
    Console.WriteLine("     });");
    Console.WriteLine();

    string? broken = null;
    bool startedAfterNext = false;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    // The fix, on the way in.
    app.Use(async (context, next) =>
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        context.Response.OnStarting(() =>
        {
            context.Response.Headers["X-Fixed"] = sw.ElapsedMilliseconds.ToString();
            return Task.CompletedTask;
        });

        await next();
    });

    // The broken version, on the way out.
    app.Use(async (context, next) =>
    {
        await next();
        startedAfterNext = context.Response.HasStarted;

        try
        {
            context.Response.Headers["X-Broken"] = "1";
        }
        catch (Exception ex)
        {
            broken = ex.GetType().Name;
        }
    });

    app.MapGet("/", () => "a body");

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    HttpResponseMessage response = await http.GetAsync("/");
    await app.StopAsync();

    Console.WriteLine($"   HasStarted after next()   : {startedAfterNext}");
    Console.WriteLine($"   setting the header threw  : {broken ?? "no"}");
    Console.WriteLine($"   X-Broken reached client   : {response.Headers.Contains("X-Broken")}");
    Console.WriteLine($"   X-Fixed reached client    : {response.Headers.Contains("X-Fixed")}");
    Console.WriteLine();
    Console.WriteLine("   THE RESPONSE HAD ALREADY STARTED. The status line and headers go on");
    Console.WriteLine("   the wire before the body, so by the time next() returns the endpoint");
    Console.WriteLine("   has usually written something and the headers are gone.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS OnStarting, registered on the way IN. It runs at the last");
    Console.WriteLine("   moment before the headers are sent - after the endpoint has decided");
    Console.WriteLine("   what the response is, and before anything reaches the client. It can");
    Console.WriteLine("   see the final status code and still add headers.");
    Console.WriteLine();
    Console.WriteLine("   Three things to know about it:");
    Console.WriteLine();
    Console.WriteLine("     - Register it BEFORE calling next. Afterwards is too late for the");
    Console.WriteLine("       same reason the original code was.");
    Console.WriteLine("     - It may never run - if the client disconnects and nothing is");
    Console.WriteLine("       written, there are no headers to send. Do not put cleanup there;");
    Console.WriteLine("       OnCompleted is for that.");
    Console.WriteLine("     - Keep it cheap and non-throwing. It runs on every response, at a");
    Console.WriteLine("       point where the response can no longer become a 500.");
    Console.WriteLine();
    Console.WriteLine("   On the way OUT you may only OBSERVE. Reading the status code to log");
    Console.WriteLine("   it is fine; changing anything is not.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — a scoped service in a middleware.
// ---------------------------------------------------------------------------
static async Task Exercise4()
{
    Console.WriteLine("Exercise 4: this middleware will not start. Why, and where does the");
    Console.WriteLine("            dependency belong?");
    Console.WriteLine();
    Console.WriteLine("     public sealed class AuditMiddleware");
    Console.WriteLine("     {");
    Console.WriteLine("         public AuditMiddleware(RequestDelegate next, LedgerDbContext db)");
    Console.WriteLine("     }");
    Console.WriteLine();

    Console.WriteLine($"   constructor injection : {await TryAsync(constructor: true)}");
    Console.WriteLine($"   Invoke parameter      : {await TryAsync(constructor: false)}");
    Console.WriteLine();
    Console.WriteLine("   A CONVENTION-BASED MIDDLEWARE IS BUILT ONCE, when the pipeline is");
    Console.WriteLine("   built, and the same instance serves every request forever. So a");
    Console.WriteLine("   scoped service in its constructor would be captured for the life of");
    Console.WriteLine("   the application - one DbContext shared by every concurrent request,");
    Console.WriteLine("   which is not thread-safe and is the opposite of what scoped means.");
    Console.WriteLine();
    Console.WriteLine("   THE DEPENDENCY BELONGS ON Invoke:");
    Console.WriteLine();
    Console.WriteLine("     public async Task InvokeAsync(HttpContext context, LedgerDbContext db)");
    Console.WriteLine();
    Console.WriteLine("   Invoke runs per request, and its extra parameters are resolved from");
    Console.WriteLine("   that request's scope. The split is the design: the constructor is for");
    Console.WriteLine("   things that live as long as the application, Invoke for things that");
    Console.WriteLine("   live as long as the request.");
    Console.WriteLine();
    Console.WriteLine("   Two further points:");
    Console.WriteLine();
    Console.WriteLine("     - IT FAILS AT STARTUP, not on the first request, because that is");
    Console.WriteLine("       when the middleware is constructed. One of the few pipeline");
    Console.WriteLine("       mistakes that cannot reach production quietly.");
    Console.WriteLine();
    Console.WriteLine("     - IT ONLY FAILS FOR SCOPED SERVICES. A TRANSIENT service in the");
    Console.WriteLine("       constructor is accepted silently and then lives forever - the");
    Console.WriteLine("       same bug with no error message.");
    Console.WriteLine();
    Console.WriteLine("   Any per-request state also belongs in locals or HttpContext.Items,");
    Console.WriteLine("   never in a field: fields on a singleton are shared by every");
    Console.WriteLine("   concurrent request.");
    Console.WriteLine();

    static async Task<string> TryAsync(bool constructor)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Host.UseDefaultServiceProvider(o => o.ValidateScopes = true);
        builder.Services.AddScoped<Scoped>();

        var app = builder.Build();

        if (constructor)
        {
            app.UseMiddleware<CapturingMiddleware>();
        }
        else
        {
            app.UseMiddleware<CorrectMiddleware>();
        }

        app.MapGet("/", (HttpContext c) => $"scoped id {c.Items["id"]}");

        try
        {
            await app.StartAsync();
        }
        catch (InvalidOperationException ex)
        {
            return $"STARTUP FAILED - {ex.Message}";
        }

        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        string body = await http.GetStringAsync("/");
        await app.StopAsync();
        return $"started, request returned: {body}";
    }
}

// ---------------------------------------------------------------------------
// 5. HARD — the cache that leaked.
// ---------------------------------------------------------------------------
static async Task Exercise5()
{
    Console.WriteLine("Exercise 5: a response cache was added to a slow endpoint. Merchants");
    Console.WriteLine("            start seeing each other's data. The cache code is correct.");
    Console.WriteLine("            What is wrong, and what are the TWO fixes?");
    Console.WriteLine();

    Console.WriteLine("   arrangement                              second caller saw          leak?");
    Console.WriteLine("   -----------                              -----------------          -----");

    foreach ((string label, bool cacheFirst, bool keyed, bool anon) in new[]
    {
        ("cache BEFORE auth, path key", true, false, false),
        ("cache BEFORE auth, ANONYMOUS caller", true, false, true),
        ("cache AFTER auth, path key", false, false, false),
        ("cache AFTER auth, path + user key", false, true, false)
    })
    {
        (string saw, bool leaked) = await MeasureAsync(cacheFirst, keyed, anon);
        Console.WriteLine($"   {label,-38}   {saw,-24}   {(leaked ? "YES" : "no")}");
    }

    Console.WriteLine();
    Console.WriteLine("   TWO SEPARATE DEFECTS, and fixing either one alone leaves a leak.");
    Console.WriteLine();
    Console.WriteLine("   1. POSITION. The cache sits before authentication, so it has no user");
    Console.WriteLine("      to key on - and worse, when it hits it SHORT-CIRCUITS, which skips");
    Console.WriteLine("      authentication entirely. Row 2 is the proof: an anonymous caller");
    Console.WriteLine("      with no credentials received a real merchant's statement, and the");
    Console.WriteLine("      authentication middleware never ran to object.");
    Console.WriteLine();
    Console.WriteLine("      A SHORT-CIRCUITING MIDDLEWARE ABOVE AUTHENTICATION DOES NOT MERELY");
    Console.WriteLine("      GET THE ANSWER WRONG - IT REMOVES AUTHENTICATION FROM THE REQUEST.");
    Console.WriteLine();
    Console.WriteLine("   2. THE KEY. Row 3 has the ordering right and still leaks, because the");
    Console.WriteLine("      key is the path and the path is identical for every merchant.");
    Console.WriteLine();
    Console.WriteLine("   Row 4 fixes both. The cost is a lower hit rate - a per-user cache");
    Console.WriteLine("   cannot be shared - which is what correctness costs here.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL RULES:");
    Console.WriteLine();
    Console.WriteLine("     - Anything that can short-circuit goes AFTER authentication and");
    Console.WriteLine("       authorisation, unless it is deliberately public. That covers");
    Console.WriteLine("       caches, early-returning rate limiters, static file handlers, and");
    Console.WriteLine("       any fast path added for performance.");
    Console.WriteLine();
    Console.WriteLine("     - A cache key must include everything the response varies by:");
    Console.WriteLine("       path, query, identity, tenant, language. Anything left out is a");
    Console.WriteLine("       way for one caller to receive another's response. It is the Vary");
    Console.WriteLine("       header rule applied to your own cache.");
    Console.WriteLine();
    Console.WriteLine("     - A middleware can only use what earlier middleware established.");
    Console.WriteLine("       The cache could not key on the user before authentication because");
    Console.WriteLine("       there was no user yet.");
    Console.WriteLine();
    Console.WriteLine("   THE TEST that catches it needs the real pipeline, because the bug is");
    Console.WriteLine("   entirely in the pipeline: request the same path as two different");
    Console.WriteLine("   users and assert the second response does not contain the first");
    Console.WriteLine("   user's data - then repeat with no credentials and assert a 401.");
    Console.WriteLine();

    static async Task<(string Saw, bool Leaked)> MeasureAsync(bool cacheFirst, bool keyed,
        bool anonymous)
    {
        var cache = new ConcurrentDictionary<string, string>();

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();

        void AddAuth(WebApplication a) => a.Use(async (c, next) =>
        {
            string? merchant = c.Request.Headers["X-Merchant"].FirstOrDefault();
            if (string.IsNullOrEmpty(merchant))
            {
                c.Response.StatusCode = 401;
                await c.Response.WriteAsync("unauthenticated");
                return;
            }

            c.Items["merchant"] = merchant;
            await next();
        });

        void AddCache(WebApplication a) => a.Use(async (c, next) =>
        {
            string key = keyed ? $"{c.Request.Path}|{c.Items["merchant"]}" : c.Request.Path.ToString();

            if (cache.TryGetValue(key, out string? hit))
            {
                await c.Response.WriteAsync(hit);
                return;
            }

            Stream original = c.Response.Body;
            using var buffer = new MemoryStream();
            c.Response.Body = buffer;
            await next();

            buffer.Position = 0;
            string body = await new StreamReader(buffer).ReadToEndAsync();
            c.Response.Body = original;

            if (c.Response.StatusCode == 200)
            {
                cache[key] = body;
            }

            await c.Response.WriteAsync(body);
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

        app.MapGet("/statement", (HttpContext c) => $"statement for {c.Items["merchant"]}");

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        await SendAsync(http, "merchant-a");
        string second = await SendAsync(http, anonymous ? null : "merchant-b");

        await app.StopAsync();
        return (second, second.Contains("merchant-a", StringComparison.Ordinal));

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
}

// ---------------------------------------------------------------------------
// 6. HARD — order this pipeline.
// ---------------------------------------------------------------------------
static void Exercise6()
{
    Console.WriteLine("Exercise 6: order these, and justify every position.");
    Console.WriteLine();
    Console.WriteLine("     UseAuthorization      UseStaticFiles       UseRouting");
    Console.WriteLine("     UseExceptionHandler   UseAuthentication    UseCors");
    Console.WriteLine("     UseForwardedHeaders   UseHttpsRedirection  a response cache");
    Console.WriteLine();
    Console.WriteLine("   THE ORDER");
    Console.WriteLine();
    Console.WriteLine("   1. UseExceptionHandler     It can only catch what it WRAPS, so");
    Console.WriteLine("                              anything above it throws past it.");
    Console.WriteLine();
    Console.WriteLine("   2. UseForwardedHeaders     Everything below reads the scheme or the");
    Console.WriteLine("                              client address, and until this runs both");
    Console.WriteLine("                              describe the proxy rather than the client.");
    Console.WriteLine();
    Console.WriteLine("   3. UseHttpsRedirection     Needs the real scheme from step 2, or it");
    Console.WriteLine("                              redirects forever behind a TLS-terminating");
    Console.WriteLine("                              proxy.");
    Console.WriteLine();
    Console.WriteLine("   4. UseStaticFiles          Short-circuits on a hit, so a static file");
    Console.WriteLine("                              never pays for routing or authentication.");
    Console.WriteLine("                              Only safe here because the files are");
    Console.WriteLine("                              PUBLIC - see the caveat below.");
    Console.WriteLine();
    Console.WriteLine("   5. UseRouting              Selects the endpoint and puts it on the");
    Console.WriteLine("                              context. Nothing above knows which");
    Console.WriteLine("                              endpoint will run.");
    Console.WriteLine();
    Console.WriteLine("   6. UseCors                 After routing so it can read per-endpoint");
    Console.WriteLine("                              policy; before authentication because a");
    Console.WriteLine("                              preflight request carries no credentials");
    Console.WriteLine("                              and must not be rejected for lacking them.");
    Console.WriteLine();
    Console.WriteLine("   7. UseAuthentication       Establishes WHO the caller is. Sets");
    Console.WriteLine("                              context.User; rejects nobody.");
    Console.WriteLine();
    Console.WriteLine("   8. UseAuthorization        Decides whether that caller may reach THIS");
    Console.WriteLine("                              endpoint. Needs the user from 7 and the");
    Console.WriteLine("                              endpoint from 5, so it cannot move above");
    Console.WriteLine("                              either.");
    Console.WriteLine();
    Console.WriteLine("   9. the response cache      After authorisation, because it");
    Console.WriteLine("                              short-circuits and would otherwise skip");
    Console.WriteLine("                              both checks - and it needs the identity");
    Console.WriteLine("                              for its key.");
    Console.WriteLine();
    Console.WriteLine("   THE TWO THAT ARE WORTH ARGUING ABOUT");
    Console.WriteLine();
    Console.WriteLine("   STATIC FILES AT 4 is a performance choice that assumes the files are");
    Console.WriteLine("   public. If anything under wwwroot should be restricted, this");
    Console.WriteLine("   ordering serves it to anyone - the same short-circuit-above-auth bug");
    Console.WriteLine("   as the cache in exercise 5. Move it below authorisation, or do not");
    Console.WriteLine("   put private files there.");
    Console.WriteLine();
    Console.WriteLine("   THE CACHE AT 9 gives up the latency win for unauthenticated public");
    Console.WriteLine("   endpoints, which could safely be cached earlier. If you want both,");
    Console.WriteLine("   run two caches in two positions with different keys - and be");
    Console.WriteLine("   deliberate about which endpoints each one serves.");
    Console.WriteLine();
    Console.WriteLine("   The framework checks exactly ONE of these for you: UseAuthorization");
    Console.WriteLine("   before UseRouting throws at startup. Every other ordering mistake in");
    Console.WriteLine("   this list is silent.");
}

// ---------------------------------------------------------------------------
sealed class Scoped
{
    private static int _created;

    public Scoped() => Id = Interlocked.Increment(ref _created);

    public int Id { get; }
}

sealed class CapturingMiddleware
{
    private readonly RequestDelegate _next;

    public CapturingMiddleware(RequestDelegate next, Scoped scoped) => _next = next;

    public Task InvokeAsync(HttpContext context) => _next(context);
}

sealed class CorrectMiddleware
{
    private readonly RequestDelegate _next;

    public CorrectMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, Scoped scoped)
    {
        context.Items["id"] = scoped.Id;
        await _next(context);
    }
}
