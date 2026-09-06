// 01-captive-dependencies.cs — What happens when a long-lived service holds a
// short-lived one, and why the check that catches it is off where it matters.
//
// Run:  dotnet run 01-captive-dependencies.cs -c Release
//
// EXACT vs RATIO: every count and exception name here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;

// This file compares provider configurations, so it builds them directly.
#pragma warning disable ASP0000

await WhatActuallyHappens();
await WhoCatchesIt();
await TransientIsWorse();
Rules();

// ---------------------------------------------------------------------------
static async Task WhatActuallyHappens()
{
    Console.WriteLine("1. A singleton that holds a scoped service");
    Console.WriteLine();
    Console.WriteLine("   TenantCache is a singleton. It takes an ITenantContext, which is");
    Console.WriteLine("   scoped - one per request, carrying who is asking.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddHttpContextAccessor();
    builder.Services.AddScoped<ITenantContext, TenantContext>();
    builder.Services.AddSingleton<TenantCache>();

    var app = builder.Build();

    app.MapGet("/whoami", (ITenantContext tenant, TenantCache cache) => Results.Ok(new
    {
        requestSees = $"{tenant.TenantId} (instance {tenant.InstanceId})",
        cacheSees = $"{cache.CurrentTenant} (instance {cache.InstanceId})"
    }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   request                    status and body");
    Console.WriteLine("   -------                    ---------------");

    foreach (string tenant in new[] { "acme", "globex", "initech" })
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/whoami");
        request.Headers.Add("X-Tenant", tenant);

        using HttpResponseMessage response = await http.SendAsync(request);
        string body = await response.Content.ReadAsStringAsync();

        // Printed rather than deserialised, so a failing request cannot be
        // mistaken for an interesting result.
        Console.WriteLine($"   X-Tenant: {tenant,-16}   {(int)response.StatusCode}  {body}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine($"   TenantContext instances created: {TenantContext.Created}");
    Console.WriteLine();
    Console.WriteLine("   THE CACHE IS STILL LOOKING AT THE FIRST REQUEST'S TENANT, and it will");
    Console.WriteLine("   be for as long as the process runs.");
    Console.WriteLine();
    Console.WriteLine("   READ THE INSTANCE NUMBERS, because they say something the words do");
    Console.WriteLine("   not. Request 1 used instance 1. The cache holds instance 2 - a");
    Console.WriteLine("   SEPARATE object, created for the singleton and never seen by any");
    Console.WriteLine("   request.");
    Console.WriteLine();
    Console.WriteLine("   The mechanism: a singleton is built once and lives in the ROOT");
    Console.WriteLine("   provider, so its constructor arguments are resolved from the root");
    Console.WriteLine("   rather than from a request scope. The scoped registration is honoured");
    Console.WriteLine("   in the only way it can be - one instance per scope, and the root is a");
    Console.WriteLine("   scope that never ends.");
    Console.WriteLine();
    Console.WriteLine("   It read 'acme' because it was constructed during the first request, so");
    Console.WriteLine("   the ambient HttpContext at that moment was that request's. The value");
    Console.WriteLine("   is not merely stale; it is an accident of which request arrived first.");
    Console.WriteLine();
    Console.WriteLine("   THE SCOPED SERVICE HAS BEEN PROMOTED TO A SINGLETON BY THE THING THAT");
    Console.WriteLine("   HOLDS IT. Its registration still says scoped. Nothing about it changed");
    Console.WriteLine("   except who kept a reference.");
    Console.WriteLine();
    Console.WriteLine("   That is a CAPTIVE DEPENDENCY: a service captured by something longer");
    Console.WriteLine("   lived than itself.");
    Console.WriteLine();
    Console.WriteLine("   Notice what it is NOT. Nothing threw, nothing was logged, the");
    Console.WriteLine("   endpoint returned 200, and the request's own view of the tenant was");
    Console.WriteLine("   correct every time. Only the cache was wrong, and only about data it");
    Console.WriteLine("   was never asked to print.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhoCatchesIt()
{
    Console.WriteLine("2. What catches it, and where that check is switched on");
    Console.WriteLine();

    Console.WriteLine("   configuration                        outcome");
    Console.WriteLine("   -------------                        -------");

    foreach ((string label, string environment, bool explicitValidation) in new[]
    {
        ("Development, defaults", "Development", false),
        ("Production, defaults", "Production", false),
        ("Production, validation asked for", "Production", true)
    })
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = environment
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<ITenantContext, TenantContext>();
        builder.Services.AddSingleton<TenantCache>();

        if (explicitValidation)
        {
            builder.Host.UseDefaultServiceProvider(options =>
            {
                options.ValidateOnBuild = true;
                options.ValidateScopes = true;
            });
        }

        string outcome;
        string? detail = null;

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

            outcome = $"{exception.GetType().Name}";
            detail = message;
        }

        Console.WriteLine($"   {label,-34}   {outcome}");

        if (detail is not null)
        {
            Console.WriteLine($"   {"",-34}   {detail}");
        }
    }

    Console.WriteLine();
    Console.WriteLine("   ValidateScopes IS THE CHECK, and it does two things: it refuses to");
    Console.WriteLine("   resolve a scoped service from the root provider, and - with");
    Console.WriteLine("   ValidateOnBuild - it walks every registration at startup looking for");
    Console.WriteLine("   exactly this shape.");
    Console.WriteLine();
    Console.WriteLine("   THE DEFAULTS ARE THE WRONG WAY ROUND, in the same way as the previous");
    Console.WriteLine("   module's ValidateOnBuild: on in Development, off in Production. The");
    Console.WriteLine("   configuration that catches a captive dependency at startup is absent");
    Console.WriteLine("   from the environment where a captive dependency causes an incident.");
    Console.WriteLine();
    Console.WriteLine("   Read the second row again, because it is the entire problem: the");
    Console.WriteLine("   application STARTS, serves traffic, passes health checks, and holds a");
    Console.WriteLine("   stale tenant forever.");
    Console.WriteLine();
    Console.WriteLine("   The message the first row produces is exact and worth memorising:");
    Console.WriteLine();
    Console.WriteLine("     Cannot consume scoped service 'ITenantContext' from");
    Console.WriteLine("     singleton 'TenantCache'.");
    Console.WriteLine();
    Console.WriteLine("   If you have ever seen that at startup, the container just prevented a");
    Console.WriteLine("   bug that would otherwise have been silent.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TransientIsWorse()
{
    Console.WriteLine("3. Transient inside a singleton, which is the case people miss");
    Console.WriteLine();
    Console.WriteLine("   ValidateScopes says nothing about a transient service held by a");
    Console.WriteLine("   singleton, because there is nothing invalid about it.");
    Console.WriteLine();
    Console.WriteLine("   The same transient registration, held by two different consumers.");
    Console.WriteLine("   Only the consumer's lifetime differs:");
    Console.WriteLine();

    foreach (bool issuerIsSingleton in new[] { true, false })
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

        builder.Services.AddTransient<IReferenceGenerator, ReferenceGenerator>();

        if (issuerIsSingleton)
        {
            builder.Services.AddSingleton<ReceiptIssuer>();
        }
        else
        {
            builder.Services.AddScoped<ReceiptIssuer>();
        }

        var app = builder.Build();
        app.MapGet("/receipt", (ReceiptIssuer issuer) => Results.Ok(new { reference = issuer.Issue() }));

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        int before = ReferenceGenerator.Created;
        var issued = new List<string>();

        for (int request = 1; request <= 3; request++)
        {
            using HttpResponseMessage response = await http.GetAsync("/receipt");
            issued.Add((await response.Content.ReadAsStringAsync()).Replace("{\"reference\":\"", "")
                .Replace("\"}", ""));
        }

        await app.StopAsync();

        Console.WriteLine($"   ReceiptIssuer is {(issuerIsSingleton ? "SINGLETON" : "SCOPED"),-10}   " +
            $"startup: built   generators created: {ReferenceGenerator.Created - before}");
        Console.WriteLine($"   {"",-27}   three requests issued: {string.Join(", ", issued)}");
        Console.WriteLine();
    }

    Console.WriteLine("   THE REGISTRATION OF IReferenceGenerator IS IDENTICAL IN BOTH, and the");
    Console.WriteLine("   behaviour is not. One generator when a singleton holds it, three when");
    Console.WriteLine("   a scoped service does.");
    Console.WriteLine();
    Console.WriteLine("   'Transient' does not mean short-lived. IT MEANS A NEW ONE PER RESOLVE.");
    Console.WriteLine("   If something resolves it once and holds it forever, that instance");
    Console.WriteLine("   lives forever - so the lifetime you get is the holder's, not the");
    Console.WriteLine("   one you wrote.");
    Console.WriteLine();
    Console.WriteLine("   NOTICE THAT NEITHER ROW IS 'THE BUG'. Which one is wrong depends");
    Console.WriteLine("   entirely on what the generator is for:");
    Console.WriteLine();
    Console.WriteLine("     - if references must be unique across the process, the singleton row");
    Console.WriteLine("       is correct and the scoped row issues REF-001 three times;");
    Console.WriteLine();
    Console.WriteLine("     - if the generator carries per-request state, the scoped row is");
    Console.WriteLine("       correct and the singleton row leaks one request's state into the");
    Console.WriteLine("       next.");
    Console.WriteLine();
    Console.WriteLine("   You cannot tell which you have from the registration, and the");
    Console.WriteLine("   container cannot either. THAT is why transient-in-singleton is");
    Console.WriteLine("   unchecked: it crosses no scope boundary, so there is nothing for");
    Console.WriteLine("   ValidateScopes to object to.");
    Console.WriteLine();
    Console.WriteLine("   The practical consequence: a transient registration tells you how");
    Console.WriteLine("   often the container CREATES one. To know how long one LIVES, look at");
    Console.WriteLine("   what holds it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Rules()
{
    Console.WriteLine("4. The rules, stated as consequences rather than definitions");
    Console.WriteLine();
    Console.WriteLine("   1. A SERVICE LIVES AS LONG AS THE LONGEST-LIVED THING HOLDING IT.");
    Console.WriteLine("      Its registered lifetime is a ceiling on how often it is created,");
    Console.WriteLine("      not a floor under how long it survives.");
    Console.WriteLine();
    Console.WriteLine("   2. A SINGLETON MAY ONLY DEPEND ON SINGLETONS. Anything else it holds");
    Console.WriteLine("      has been promoted to singleton, whatever its registration says.");
    Console.WriteLine();
    Console.WriteLine("   3. A SCOPED SERVICE MAY DEPEND ON SCOPED OR SINGLETON. Depending on a");
    Console.WriteLine("      transient is fine and means one instance per scope.");
    Console.WriteLine();
    Console.WriteLine("   4. A TRANSIENT MAY DEPEND ON ANYTHING, and gains nothing from it.");
    Console.WriteLine();
    Console.WriteLine("   The direction is the whole rule: DEPENDENCIES MUST LIVE AT LEAST AS");
    Console.WriteLine("   LONG AS THE THINGS THAT HOLD THEM.");
    Console.WriteLine();
    Console.WriteLine("   WHAT TO REGISTER AS WHAT, when you have no other information:");
    Console.WriteLine();
    Console.WriteLine("     scoped      anything carrying per-request state or a unit of work -");
    Console.WriteLine("                 a database context, the current user, a transaction, a");
    Console.WriteLine("                 request-scoped correlation id");
    Console.WriteLine();
    Console.WriteLine("     singleton   anything stateless and expensive to build, or state");
    Console.WriteLine("                 that is genuinely application-wide - a cache, a client");
    Console.WriteLine("                 with a connection pool, parsed configuration");
    Console.WriteLine();
    Console.WriteLine("     transient   small stateless things where you would rather not think");
    Console.WriteLine("                 about it, and anything that must not be shared");
    Console.WriteLine();
    Console.WriteLine("   SCOPED IS THE RIGHT DEFAULT FOR APPLICATION SERVICES. It is the only");
    Console.WriteLine("   one of the three that cannot silently outlive a request, because the");
    Console.WriteLine("   container will refuse - if validation is on.");
    Console.WriteLine();
    Console.WriteLine("   AND SINGLETON IS THE ONE TO JUSTIFY. Every singleton is shared mutable");
    Console.WriteLine("   state until proven otherwise, which makes it both a lifetime question");
    Console.WriteLine("   and a thread-safety one.");
}

// ---------------------------------------------------------------------------
public interface ITenantContext
{
    string TenantId { get; }

    int InstanceId { get; }
}

// Scoped: one per request, reading the header that request arrived with.
public sealed class TenantContext : ITenantContext
{
    private static int _created;

    public TenantContext(IHttpContextAccessor accessor)
    {
        Interlocked.Increment(ref _created);

        InstanceId = Volatile.Read(ref _created);

        TenantId = accessor.HttpContext?.Request.Headers["X-Tenant"].ToString() is { Length: > 0 } tenant
            ? tenant
            : "(none)";
    }

    public static int Created => Volatile.Read(ref _created);

    public string TenantId { get; }

    public int InstanceId { get; }
}

// Singleton. Its constructor argument is resolved once, in whichever scope
// happens to be active when the first request needs it.
public sealed class TenantCache(ITenantContext tenant)
{
    public string CurrentTenant => tenant.TenantId;

    public int InstanceId => tenant.InstanceId;
}

public interface IReferenceGenerator
{
    string Next();
}

// Transient by registration. Each instance counts from 1, so a shared instance
// is visible in the output as references that do not restart.
public sealed class ReferenceGenerator : IReferenceGenerator
{
    private static int _created;
    private int _issued;

    public ReferenceGenerator() => Interlocked.Increment(ref _created);

    public static int Created => Volatile.Read(ref _created);

    public string Next() => $"REF-{++_issued:000}";
}

public sealed class ReceiptIssuer(IReferenceGenerator generator)
{
    public string Issue() => generator.Next();
}
