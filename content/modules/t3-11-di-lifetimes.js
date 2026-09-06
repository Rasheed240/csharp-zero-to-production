CSPREP.module({
  id: "t3-11-di-lifetimes",
  minutes: 55,
  updated: "2026-09-04",
  summary: "A two-character diff - AddScoped to AddSingleton on a currency cache - shared one database context across every request in the process. Measured across five concurrency levels: zero failures at one request at a time, 194 of 200 at two. The three lifetimes, captive dependencies and why the check that catches them is on in Development and off in Production, scopes in background services, and the transient disposable that leaves ten thousand live objects on the container's tracking list.",
  terms: ["lifetime", "singleton", "scoped", "transient", "scope", "root provider",
    "captive dependency", "ValidateScopes", "IServiceScopeFactory", "IServiceScope",
    "unit of work", "DbContext", "BackgroundService", "disposable tracking"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger's currency lookup was slow. Every request hit the database for a table of about forty rows
  that changes twice a year. The fix was obvious and correct — cache it in a singleton:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs — the whole change"><code>-  builder.Services.AddScoped&lt;CurrencyCatalogue&gt;();
+  builder.Services.AddSingleton&lt;CurrencyCatalogue&gt;();</code></pre>

  <p>One word. The class was not touched, and there is nothing wrong with it:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>public sealed class CurrencyCatalogue(LedgerDbContext db)
{
    public Task&lt;decimal&gt; RateAsync(string code) =&gt; db.QueryRateAsync(code);
}</code></pre>

  <p>The pull request was two characters of diff. Two people reviewed it, and both were right that
  caching a rarely-changing table in a singleton is the correct design.</p>

  <p>What it did, measured — 200 requests at five levels of concurrency, with the catalogue registered
  each way:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   concurrent   scoped: contexts / failed   singleton: contexts / failed
   ----------   -------------------------   ---------------------------
            1           200 / 0                       1 / 0
            2           200 / 0                       1 / 194
            4           200 / 0                       1 / 197
            8           200 / 0                       1 / 198
           32           200 / 0                       1 / 198</code></pre>

  <p><strong>Read the first row before any other.</strong> At concurrency 1 the singleton version fails
  nothing: one context, 200 requests, zero errors. A developer machine, an integration test, a staging
  environment with one person clicking — all of them are that first row. The bug is not merely hard to
  reproduce there; it is <em>absent</em> there.</p>

  <p>The failure rate then climbs with concurrency, because the defect is two requests overlapping
  inside one database context. More traffic means more overlap, which is why it presented as a capacity
  problem and drew every hypothesis towards the database.</p>

  <p>The application started. It built, bound its port, passed its health check and served traffic.
  Nothing in <code>CurrencyCatalogue.cs</code> is wrong, nothing in the context is wrong, nothing in the
  endpoint is wrong. <strong>The defect exists only in the relationship between two registrations</strong>,
  which is not a place anybody thinks to look.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every count, exception message and startup outcome in this module was produced by running the
    programs shown, on .NET 10, and pasted in unedited. The database context in these files is a
    stand-in written for them — Entity Framework Core is not available offline — modelling the one
    property the incident turns on: a context serves one operation at a time and throws when a second
    overlaps.</p>
  </div>
</section>

<section id="plain-language">
  <h2>The three lifetimes</h2>

  <p class="define"><span class="define__term">Lifetime</span> How often the container creates a new
  instance of a registered service, and therefore how long each instance lasts. It is a property of the
  registration, not of the class.</p>

  <p class="define"><span class="define__term">Scope</span> A boundary the container creates, inside
  which a scoped service is built once. When the scope is disposed, everything disposable it created is
  disposed with it.</p>

  <p class="define"><span class="define__term">Instance</span> One object in memory. Two variables
  holding the same instance see each other's changes; two variables holding different instances of the
  same class do not.</p>

  <p class="define"><span class="define__term">Singleton</span> Registered so the container creates one
  instance and hands the same one to everybody, for the life of the application.</p>

  <p class="define"><span class="define__term">Scoped</span> Registered so the container creates one
  instance per scope, and hands that same one to everything resolved within it.</p>

  <p class="define"><span class="define__term">Transient</span> Registered so the container creates a
  new instance every time anything asks for one.</p>

  <p class="define"><span class="define__term">Root provider</span> The container itself, before any
  scope is created. In an ASP.NET Core application it is <code>app.Services</code>. It is not a scope,
  and it is never disposed until the process ends.</p>

  <p class="define"><span class="define__term">Thread-safe</span> Safe to use from more than one thread
  at the same time. Most objects are not, and most of the time it does not matter because only one
  thread has one. A singleton is used by every request at once, so for a singleton it always
  matters.</p>

  <p>One class, registered three times under three interfaces. Two requests, two resolves of each
  inside each request:</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — The three lifetimes, counted. Two requests, two resolves
// inside each, and one number per lifetime that says what it means.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The same class, registered three times under three interfaces. The only
// difference between them is the word in the method name.
builder.Services.AddSingleton&lt;ISingletonCounter, Counter&gt;();
builder.Services.AddScoped&lt;IScopedCounter, Counter&gt;();
builder.Services.AddTransient&lt;ITransientCounter, Counter&gt;();

var app = builder.Build();

app.MapGet("/ids", (
    ISingletonCounter singletonA, ISingletonCounter singletonB,
    IScopedCounter scopedA, IScopedCounter scopedB,
    ITransientCounter transientA, ITransientCounter transientB) =&gt;
    Results.Ok(new
    {
        singleton = new[] { singletonA.Id, singletonB.Id },
        scoped = new[] { scopedA.Id, scopedB.Id },
        transient = new[] { transientA.Id, transientB.Id }
    }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("Two requests, two resolves of each lifetime inside each request");
Console.WriteLine();

for (int request = 1; request &lt;= 2; request++)
{
    Console.WriteLine($"   request {request}   {await http.GetStringAsync("/ids")}");
}

await app.StopAsync();

Console.WriteLine();
Console.WriteLine($"   instances of Counter created in total: {Counter.Created}");
Console.WriteLine();
Console.WriteLine("   Read the numbers rather than the words:");
Console.WriteLine();
Console.WriteLine("     SINGLETON   the same id in both slots and in both requests.");
Console.WriteLine("                 One instance for the life of the application.");
Console.WriteLine();
Console.WriteLine("     SCOPED      the same id in both slots, a different id in the second");
Console.WriteLine("                 request. One instance per scope, and in a web application");
Console.WriteLine("                 a scope is a request.");
Console.WriteLine();
Console.WriteLine("     TRANSIENT   a different id in every slot. A new instance every time");
Console.WriteLine("                 anybody asks, including twice in one request.");
Console.WriteLine();
Console.WriteLine("   Two requests produced 1 singleton, 2 scoped and 4 transient instances,");
Console.WriteLine("   which is 7 - and that is the whole of the mechanism.");
Console.WriteLine();
Console.WriteLine("   THE PART THAT CAUSES BUGS IS NOT THE MECHANISM. It is that a lifetime");
Console.WriteLine("   is a property of the REGISTRATION, and what actually happens depends on");
Console.WriteLine("   what holds a reference to what. That is the rest of this module.");

// ---------------------------------------------------------------------------
public interface ISingletonCounter
{
    int Id { get; }
}

public interface IScopedCounter
{
    int Id { get; }
}

public interface ITransientCounter
{
    int Id { get; }
}

// One class, three registrations. It records how many of itself exist so the
// numbers above are not an inference.
public sealed class Counter : ISingletonCounter, IScopedCounter, ITransientCounter
{
    private static int _created;

    public Counter() =&gt; Id = Interlocked.Increment(ref _created);

    public static int Created =&gt; Volatile.Read(ref _created);

    public int Id { get; }
}</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   request 1   {"singleton":[1,1],"scoped":[2,2],"transient":[3,4]}
   request 2   {"singleton":[1,1],"scoped":[5,5],"transient":[6,7]}

   instances of Counter created in total: 7</code></pre>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Lifetime</th><th>What the numbers show</th><th>Means</th></tr></thead>
      <tbody>
        <tr><td><code>AddSingleton</code></td><td>The same id in both slots and both requests</td>
            <td>One instance for the life of the application</td></tr>
        <tr><td><code>AddScoped</code></td><td>The same id within a request, a different one in the next</td>
            <td>One instance per scope — and in a web application a scope is a request</td></tr>
        <tr><td><code>AddTransient</code></td><td>A different id in every slot</td>
            <td>A new instance every time anybody asks</td></tr>
      </tbody>
    </table>
  </div>

  <p>Two requests produced 1 singleton, 2 scoped and 4 transient instances. That is the entire
  mechanism, and it takes about a minute to learn.</p>

  <p><strong>The part that causes bugs is not the mechanism.</strong> It is that a lifetime is a
  property of the registration, while what actually happens depends on what holds a reference to what.
  That gap is the rest of this module.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>Lifetimes are like library lending rules. A reference book stays in the building and everyone
  shares it; a lending copy goes out for three weeks; a printout is yours to keep. The rule says how
  long you may have it.</p>

  <p><strong>This is an analogy and it misleads in exactly the way this module is about.</strong> A
  library can enforce its rule, because it can ask for the book back. A container cannot: once it has
  handed you an object, how long that object lives is decided entirely by whether you keep hold of it.
  The registration is a statement of intent about creation, not a guarantee about lifespan.</p>
</section>

<section id="captive-dependencies">
  <h2>What happens when a long-lived service holds a short-lived one</h2>

  <p class="define"><span class="define__term">Captive dependency</span> A service captured by something
  longer-lived than itself, so that it survives far beyond the lifetime its registration describes.</p>

  <p><code>TenantCache</code> is a singleton and takes a scoped <code>ITenantContext</code>, which
  carries the tenant the current request is for:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a singleton holding per-request state"><code>public sealed class TenantCache(ITenantContext tenant)
{
    public string CurrentTenant =&gt; tenant.TenantId;
}

builder.Services.AddScoped&lt;ITenantContext, TenantContext&gt;();
builder.Services.AddSingleton&lt;TenantCache&gt;();</code></pre>

  <p>The scoped service is ordinary: it reads the header the current request arrived with, and records
  which instance it is so the output below can be read rather than inferred.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-captive-dependencies.cs"><code>public sealed class TenantContext : ITenantContext
{
    private static int _created;

    public TenantContext(IHttpContextAccessor accessor)
    {
        Interlocked.Increment(ref _created);
        InstanceId = Volatile.Read(ref _created);

        TenantId = accessor.HttpContext?.Request.Headers["X-Tenant"].ToString() is { Length: &gt; 0 } tenant
            ? tenant
            : "(none)";
    }

    public string TenantId { get; }

    public int InstanceId { get; }
}</code></pre>

  <pre data-lang="console" data-title="01-captive-dependencies.cs output"><code>   X-Tenant: acme        200  {"requestSees":"acme (instance 1)","cacheSees":"acme (instance 2)"}
   X-Tenant: globex      200  {"requestSees":"globex (instance 3)","cacheSees":"acme (instance 2)"}
   X-Tenant: initech     200  {"requestSees":"initech (instance 4)","cacheSees":"acme (instance 2)"}</code></pre>

  <p>The cache is still looking at the first request's tenant, and will be for as long as the process
  runs.</p>

  <p><strong>Read the instance numbers, because they say something the description does not.</strong>
  Request 1 used instance 1; the cache holds instance 2 — a <em>separate</em> object, created for the
  singleton and never seen by any request.</p>

  <p>The mechanism: a singleton is built once and lives in the root provider, so its constructor
  arguments are resolved from the root rather than from a request scope. The scoped registration is
  honoured in the only way it can be — one instance per scope, and the root is a scope that never ends.
  It read <code>acme</code> because it was constructed during the first request, so the ambient
  <code>HttpContext</code> at that moment was that request's. <strong>The value is not merely stale; it
  is an accident of which request arrived first.</strong></p>

  <p>Notice what this is not. Nothing threw, nothing was logged, every response was a 200, and each
  request's own view of the tenant was correct. Only the cache was wrong, about data it was never asked
  to print.</p>

  <h3>What catches it, and where that check is switched on</h3>

  <p class="define"><span class="define__term">ValidateScopes</span> A container option that refuses to
  resolve a scoped service from the root provider and — with <code>ValidateOnBuild</code> — walks every
  registration at startup looking for exactly this shape.</p>

  <pre data-lang="console" data-title="01-captive-dependencies.cs output"><code>   Development, defaults              AggregateException
                                      Cannot consume scoped service 'ITenantContext' from
                                      singleton 'TenantCache'.
   Production, defaults               built without complaint
   Production, validation asked for   AggregateException
                                      Cannot consume scoped service 'ITenantContext' from
                                      singleton 'TenantCache'.</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>The defaults are the wrong way round, in the same way as the previous module's
    <code>ValidateOnBuild</code>: on in Development, off in Production. The check that catches a
    captive dependency at startup is absent from the environment where a captive dependency causes an
    incident.</p>
    <p>Read the second row again, because it is the entire problem: the application starts, serves
    traffic, passes health checks, and holds a stale tenant forever.</p>
  </div>

  <pre data-lang="csharp" data-net="10" data-title="the two lines, in every environment"><code>builder.Host.UseDefaultServiceProvider(options =&gt;
{
    options.ValidateOnBuild = true;
    options.ValidateScopes = true;
});</code></pre>

  <h3>The case the check cannot see</h3>

  <p>The same transient registration, held by two different consumers. Only the consumer's lifetime
  differs, and both start without complaint under full validation:</p>

  <pre data-lang="csharp" data-net="10" data-title="01-captive-dependencies.cs"><code>// Transient by registration. Each instance counts from 1, so a shared instance
// is visible in the output as references that do not restart.
public sealed class ReferenceGenerator : IReferenceGenerator
{
    private int _issued;

    public string Next() =&gt; $"REF-{++_issued:000}";
}

public sealed class ReceiptIssuer(IReferenceGenerator generator)
{
    public string Issue() =&gt; generator.Next();
}

// The only thing that differs between the two runs below.
builder.Services.AddTransient&lt;IReferenceGenerator, ReferenceGenerator&gt;();
builder.Services.AddSingleton&lt;ReceiptIssuer&gt;();   // or AddScoped</code></pre>

  <pre data-lang="console" data-title="01-captive-dependencies.cs output"><code>   ReceiptIssuer is SINGLETON    startup: built   generators created: 1
                                 three requests issued: REF-001, REF-002, REF-003

   ReceiptIssuer is SCOPED       startup: built   generators created: 3
                                 three requests issued: REF-001, REF-001, REF-001</code></pre>

  <p>The registration of the generator is identical in both, and the behaviour is not. <strong>"Transient"
  does not mean short-lived; it means a new one per resolve.</strong> If something resolves it once and
  holds it forever, that instance lives forever — so the lifetime you get is the holder's, not the one
  you wrote.</p>

  <p>Notice that neither row is "the bug". Which one is wrong depends entirely on what the generator is
  for: if references must be unique across the process, the singleton row is correct and the scoped row
  issues <code>REF-001</code> three times; if the generator carries per-request state, the scoped row is
  correct and the singleton row leaks one request's state into the next.</p>

  <p>You cannot tell which you have from the registration, and the container cannot either. That is why
  transient-in-singleton is unchecked: it crosses no scope boundary, so there is nothing for
  <code>ValidateScopes</code> to object to.</p>

  <h3>The rules, as consequences rather than definitions</h3>

  <ol>
    <li><strong>A service lives as long as the longest-lived thing holding it.</strong> Its registered
    lifetime is a ceiling on how often it is created, not a floor under how long it survives.</li>
    <li><strong>A singleton may only depend on singletons.</strong> Anything else it holds has been
    promoted to singleton, whatever its registration says.</li>
    <li>A scoped service may depend on scoped or singleton. Depending on a transient is fine and means
    one instance per scope.</li>
    <li>A transient may depend on anything, and gains nothing from it.</li>
  </ol>

  <p>The direction is the whole rule: <strong>dependencies must live at least as long as the things
  that hold them.</strong></p>
</section>

<section id="choosing">
  <h2>Choosing a lifetime</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Lifetime</th><th>For</th><th>Because</th></tr></thead>
      <tbody>
        <tr><td>Scoped</td>
            <td>Anything carrying per-request state or a unit of work — a database context, the current
            user, a transaction, a request-scoped correlation id</td>
            <td>It is the only one of the three that cannot silently outlive a request, because the
            container will refuse — if validation is on</td></tr>
        <tr><td>Singleton</td>
            <td>Anything stateless and expensive to build, or state that is genuinely application-wide —
            a cache, a client with a connection pool, parsed configuration</td>
            <td>Every singleton is shared mutable state until proven otherwise, which makes it a
            thread-safety question as much as a lifetime one</td></tr>
        <tr><td>Transient</td>
            <td>Small stateless things where you would rather not think about it, and anything that must
            not be shared</td>
            <td>It creates the most garbage and prevents the fewest bugs; it is the default when nothing
            about the choice matters</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>Scoped is the right default for application services, and singleton is the one to
  justify.</strong> Before making something a singleton, list what it holds. If any of it is scoped, or
  mutable, or not thread-safe, you are not making a caching decision — you are making a concurrency
  one.</p>
</section>

<section id="scopes">
  <h2>Where scopes come from</h2>

  <p>"Scoped means per request" is a description of what ASP.NET Core does, not a definition. What it
  does is create a scope when a request arrives and dispose it when the response completes.</p>

  <pre data-lang="console" data-title="02-scopes-and-workers.cs output"><code>   two requests            {"id":1}, {"id":2}
   from app.Services       Cannot resolve scoped service 'IUnitOfWork' from root provider.
   inside a manual scope   id 3 and id 3, same instance: True
   disposed with the scope 3 of 3 created</code></pre>

  <p>Three things that settles:</p>

  <ul>
    <li>a request is one scope, so a scoped service is per request only because a request is what
    creates a scope;</li>
    <li><strong>the root provider is not a scope</strong> — <code>app.Services</code> is the root, and
    with validation on it refuses scoped services outright;</li>
    <li>a scope you create yourself is a real scope: one instance inside it, and <em>disposed</em> when
    the scope is.</li>
  </ul>

  <p>That last point matters most. <strong>The scope owns what it created</strong>: disposing it
  disposes every disposable scoped or transient service resolved through it. A database context closes
  its connection there, and nowhere else.</p>

  <h3>Code that has no request</h3>

  <p class="define"><span class="define__term">Hosted service</span> A class the host starts when the
  application starts and stops when it shuts down, for work that is not driven by a request — polling a
  queue, running a schedule, warming a cache. <code>BackgroundService</code> is the base class for one
  with a long-running loop.</p>

  <p>A hosted service is registered as a singleton, which means one instance for the life of the
  application. It has no request, so it has no scope.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a singleton holding a unit of work"><code>public sealed class CapturingWorker(IUnitOfWork work) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _ = work.Id;

        return Task.CompletedTask;
    }
}</code></pre>

  <pre data-lang="console" data-title="02-scopes-and-workers.cs output"><code>   worker takes                      startup
   ------------                      -------
   IUnitOfWork directly              Error while validating the service descriptor
                                     'ServiceType: IHostedService...'
   IServiceScopeFactory              built without complaint</code></pre>

  <p>The first row failing at startup is the good outcome. Without validation it would start, and the
  worker would hold one unit of work — one database context, one transaction, one change tracker — for
  as long as the process runs.</p>

  <p class="define"><span class="define__term">Connection pool</span> A set of open database
  connections the driver keeps and reuses, because opening one is expensive and borrowing one is not.
  It is why creating a context per request costs far less than it appears to.</p>

  <p class="define"><span class="define__term">IServiceScopeFactory</span> A singleton service whose
  only job is to create scopes. Because it is a singleton, a singleton may hold it.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-scopes-and-workers.cs — the shape"><code>public sealed class ScopingWorker(IServiceScopeFactory scopeFactory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using IServiceScope scope = scopeFactory.CreateScope();
            var work = scope.ServiceProvider.GetRequiredService&lt;IUnitOfWork&gt;();

            work.Track(work.Id);

            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }
}</code></pre>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>That is service location, which the previous module called an anti-pattern. This is the exception
    named there: code with no ambient scope has to create one, and creating one means resolving from it.
    <code>IServiceScopeFactory</code> is the one piece of container plumbing that belongs in application
    code, in the two places that have no request — background services, and a singleton that needs
    per-request work done.</p>
  </div>

  <h3>How wide is the scope</h3>

  <p>The worker has a scope. The question nobody asks is how wide:</p>

  <pre data-lang="console" data-title="02-scopes-and-workers.cs output"><code>   arrangement                 units created   units disposed   items in one unit
   -----------                 -------------   --------------   -----------------
   one scope for the whole run              1                1   5
   one scope per item                       5                5   0</code></pre>

  <p>One scope for the run means one unit of work accumulating every item — five here; in a real worker,
  every row processed since the process started. With a database context that is the failure people
  describe as "the worker slowly gets slower and then falls over":</p>

  <p class="define"><span class="define__term">Change tracker</span> The part of a database context
  that remembers every entity it has loaded or created, so it can work out what to write. It grows with
  everything the context has ever touched, which is why a context's lifetime and a unit of work's
  lifetime have to be the same thing.</p>

  <ul>
    <li>the change tracker holds every entity it has ever loaded, so it grows without limit and every
    save gets slower;</li>
    <li>one failed operation leaves the context in a broken state that every later operation
    inherits;</li>
    <li>a connection is held open for the life of the loop rather than the life of an item.</li>
  </ul>

  <p><strong>A scope is a unit of work.</strong> In a web application the framework picks the unit and
  it is the request. In a worker you pick, and the right answer is almost always one message, one item,
  one iteration — never the whole loop.</p>
</section>

<section id="the-leak">
  <h2>The leak the container creates for you</h2>

  <p>A transient disposable, resolved ten thousand times, from the root provider and from a scope that
  is disposed:</p>

  <pre data-lang="console" data-title="02-scopes-and-workers.cs output"><code>   resolved from        created   disposed   still held by the container
   -------------        -------   --------   --------------------------
   the root provider      10000          0   10000
   a disposed scope       10000      10000   0</code></pre>

  <p>The container tracks every disposable it creates, because it is the only thing that can dispose
  them. That tracking is a list, and the list belongs to the scope that did the resolving. Resolve a
  transient disposable from the root and it goes on the <em>root's</em> list, which is released when the
  application shuts down.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>This is a real production leak and it does not look like one. Every object involved is
    short-lived by design, the code that creates them is correct, and memory grows in a straight line
    until the process is restarted. A memory dump shows tens of thousands of live instances of a class
    whose whole purpose is to be temporary, all reachable from the container — which reads as a framework bug
    rather than an application one.</p>
    <p>How it gets into a codebase: something resolves from <code>app.Services</code>, or from an
    <code>IServiceProvider</code> injected into a singleton, instead of from a scope. With
    <code>ValidateScopes</code> on, the scoped case is refused — but a <em>transient</em> disposable
    resolved from the root is allowed, because there is nothing invalid about it.</p>
    <p>The defences, in order: resolve inside a scope you own and dispose it; avoid registering
    disposables as transient at all, since scoped is almost always what was meant and is bounded by the
    request; and if a transient disposable is genuinely right, construct it yourself so the container is
    never asked to track it.</p>
  </div>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>The design the incident needed: a catalogue loaded once, shared by every request, refreshed
  periodically from the database, and holding no scoped service. Three attempts, under 100 concurrent
  requests, with validation on:</p>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   design                          startup   contexts   requests   failed
   ------                          -------   --------   --------   ------
   1. holds the context            REFUSED          0          0        0
   2. holds IServiceProvider       started          0        100      100
   3. holds IServiceScopeFactory   started        100        100        0</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - starts, then fails at every lookup"><code>public sealed class ProviderHoldingCatalogue(IServiceProvider services) : ICatalogue
{
    public Task&lt;decimal&gt; RateAsync(string code) =&gt;
        services.GetRequiredService&lt;RateContext&gt;().QueryAsync(code);
}</code></pre>

  <p>Attempt 2 is worth sitting with. It <em>starts</em> — validation walks constructors and cannot see
  a runtime lookup — and then fails at the moment it looks up, because a provider injected into a
  singleton is the root and the root refuses scoped services. <strong>It converted a startup failure
  into a runtime one while looking like a fix.</strong> With validation off it would have done something
  worse: succeeded, and put a context on the root's tracking list that is never disposed.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs — the shape that works"><code>public sealed class ScopingCatalogue(IServiceScopeFactory scopeFactory) : ICatalogue
{
    public async Task&lt;decimal&gt; RateAsync(string code)
    {
        using IServiceScope scope = scopeFactory.CreateScope();

        return await scope.ServiceProvider.GetRequiredService&lt;RateContext&gt;().QueryAsync(code);
    }
}</code></pre>

  <p><strong>A singleton may not hold a scoped service. It may hold the ability to create a scope.</strong>
  The difference is that the singleton no longer has a lifetime problem to solve — it borrows a scope,
  uses it, and gives it back, exactly as a request does.</p>

  <h3>The whole application</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    EnvironmentName = "Production"
});

builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// ---------------------------------------------------------------------------
// FIRST, AND IN EVERY ENVIRONMENT. Both defaults are on in Development only,
// which is the opposite of where they are needed.
builder.Host.UseDefaultServiceProvider(options =&gt;
{
    options.ValidateOnBuild = true;    // every constructor resolvable, at startup
    options.ValidateScopes = true;     // no scoped service captured by a singleton
});

// SCOPED: per request, because it carries a unit of work and a connection.
builder.Services.AddScoped&lt;LedgerDbContext&gt;();
builder.Services.AddScoped&lt;IPaymentRepository, PaymentRepository&gt;();

// SINGLETON: stateless, or state that is genuinely application-wide. Neither
// of these holds anything scoped - the catalogue holds the ability to make a
// scope, which is not the same thing.
builder.Services.AddSingleton&lt;IClock, SystemClock&gt;();
builder.Services.AddSingleton&lt;ICurrencyCatalogue, CurrencyCatalogue&gt;();

// A background service is a singleton. It takes the scope factory, never a
// scoped service.
builder.Services.AddHostedService&lt;SettlementWorker&gt;();

var app = builder.Build();

app.MapGet("/v1/payments/{id}", async (string id, IPaymentRepository payments) =&gt;
    await payments.FindAsync(id) is { } payment
        ? Results.Ok(payment)
        : Results.Problem(title: "Payment not found", statusCode: 404));

app.MapGet("/v1/rates/{code}", async (string code, ICurrencyCatalogue catalogue) =&gt;
    Results.Ok(new { code, rate = await catalogue.RateAsync(code) }));</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   100 concurrent callers, 200 requests (100 payments, 100 rates)
   failed                                  0

   LedgerDbContext created during the run  101
     one per payment request                100
     one for the catalogue's single load       1

   CurrencyCatalogue instances             1
   catalogue loads from the database       1

   contexts created in total, including the worker's   102
   contexts disposed when their scopes ended           102</code></pre>

  <p>One catalogue, one load, and a context per unit of work — every one of them disposed. The cache is
  shared and the unit of work is not, which is the whole design in one line.</p>

  <p>One thing the working design still owes you: the cached value is shared mutable state, so the
  refresh and the readers must agree. Here that is a single reference assignment, which is atomic —
  readers see the old dictionary or the new one, never a half-built one. <strong>Solving the lifetime
  does not solve the concurrency.</strong></p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Changing a lifetime without looking at what the class holds</h3>

  <p>The incident. A two-character diff, reviewed and approved, that shared one database context across
  every request in the process. Nothing in any of the three files involved is wrong on its own.</p>

  <p><strong>Changing a lifetime is a change to every dependency that class holds.</strong> That
  sentence, said once in a review, would have caught it.</p>

  <h3>A singleton that captures per-request identity</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the flag freezes at the first request"><code>public sealed class PricingEngine(IFlagReader flags)   // singleton
{
    public bool NewPricing =&gt; flags.NewPricing;        // IFlagReader is scoped
}</code></pre>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   header off  -&gt; {"endpointSees":false,"engineSees":false}
   header on   -&gt; {"endpointSees":true,"engineSees":false}
   header off  -&gt; {"endpointSees":false,"engineSees":false}</code></pre>

  <p>The endpoint sees the flag change and the engine never does. The fix is not "make the engine
  scoped", although that works: a singleton should ask for per-request data at the moment it needs it —
  as a method parameter, or through a scope it creates — rather than holding a reference to the thing
  that provides it.</p>

  <h3>Injecting IServiceProvider to work around a lifetime error</h3>

  <p>Measured above as attempt 2: it silences the startup error and moves the failure to runtime, or
  with validation off, converts it into a slow memory leak. <strong>If the container refuses to build
  your graph, the graph is the problem.</strong></p>

  <h3>A scope that spans a whole loop</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - one unit of work for every message"><code>using IServiceScope scope = scopeFactory.CreateScope();
var batch = scope.ServiceProvider.GetRequiredService&lt;Batch&gt;();

foreach (Message message in await queue.ReceiveAsync(stoppingToken))
{
    batch.Handle(message);
}</code></pre>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   loop shape                 scopes   units   items in the last unit
   ----------                 ------   -----   ----------------------
   scope outside the loop           1       1                      100
   scope inside the loop          100     100                        1</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs — the correct shape"><code>while (!stoppingToken.IsCancellationRequested)
{
    // ONE SCOPE PER ITERATION. Everything it resolved is disposed at the
    // closing brace, including the database context.
    using (IServiceScope scope = scopeFactory.CreateScope())
    {
        var payments = scope.ServiceProvider.GetRequiredService&lt;IPaymentRepository&gt;();

        await payments.FindAsync("PAY-1");
    }

    try
    {
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
    }
    catch (OperationCanceledException)
    {
        return;
    }
}</code></pre>

  <p>Both symptoms in the report follow from that one number: memory grows because nothing is released,
  and each message is slower because every operation works against a larger set.</p>

  <p>The correct version is not free — a hundred scopes and a hundred contexts rather than one, which
  in a real system means a hundred connections taken from the pool and returned. That is the right
  trade almost always, because pooled connections are cheap to take and return and correctness under
  failure is not: with a scope per message one poisoned message fails alone, and with one scope for the
  run it corrupts the unit of work every later message shares.</p>

  <h3>Registering a disposable as transient</h3>

  <p>Measured above: 10,000 created, 0 disposed, all still held. Scoped is almost always what was meant,
  because the request bounds it.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
      <tbody>
        <tr><td>A value is correct in the endpoint and stale everywhere else</td>
            <td>A singleton captured a scoped service</td>
            <td>Turn on <code>ValidateScopes</code>; take the value as a parameter or create a
            scope</td></tr>
        <tr><td><code>Cannot consume scoped service 'X' from singleton 'Y'</code></td>
            <td>The check working, at startup</td>
            <td>Fix the graph — do not inject <code>IServiceProvider</code> to silence it</td></tr>
        <tr><td><code>Cannot resolve scoped service 'X' from root provider</code></td>
            <td>Resolving from <code>app.Services</code> or an injected provider</td>
            <td>Create a scope from <code>IServiceScopeFactory</code></td></tr>
        <tr><td>A second operation was started on this context instance</td>
            <td>One context shared by concurrent requests — something above it is a singleton</td>
            <td>Find the singleton in the chain; it is rarely the context's own registration</td></tr>
        <tr><td>Memory grows in a straight line; a dump shows many live short-lived objects</td>
            <td>Transient disposables resolved from the root</td>
            <td>Resolve in a scope and dispose it, or construct and own them</td></tr>
        <tr><td>A worker gets slower and heavier over days</td>
            <td>The scope spans the loop rather than the item</td>
            <td>Move <code>CreateScope</code> inside the loop</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>The fastest diagnosis for the whole class of bug is a counter. Add a static instance count to the
    class you suspect and print it after some traffic:</p>
    <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>public sealed class LedgerDbContext : IDisposable
{
    private static int _created;

    public LedgerDbContext() =&gt; Interlocked.Increment(ref _created);

    public static int Created =&gt; Volatile.Read(ref _created);
}</code></pre>
    <pre data-lang="console" data-title="03-production.cs output"><code>   concurrent   scoped: contexts / failed   singleton: contexts / failed
            8           200 / 0                       1 / 198</code></pre>
    <p>One context for 200 requests, against one per request. That single number identifies the bug and
    distinguishes it from every database-side explanation, in about two minutes.</p>
    <p>Two more things worth knowing. First, <strong>reproduce with concurrency or not at all</strong>:
    at one request at a time the bug does not exist, so a sequential test proves nothing. Second, the
    registrations are enumerable — <code>builder.Services</code> is an
    <code>IEnumerable&lt;ServiceDescriptor&gt;</code>, and each descriptor carries the service type, the
    implementation type and the lifetime, so printing the ones you care about answers "what lifetime is
    this actually registered as" without reading every registration file.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Transient means short-lived."</strong></p>
    <p>It means a new instance per resolve. Measured: the same transient registration produced one
    instance held for the life of the process when a singleton resolved it, and three instances when a
    scoped service did. The lifetime you get is the holder's.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The container will stop me getting lifetimes wrong."</strong></p>
    <p>It will, in Development, for one specific shape — a scoped service consumed by a singleton. In
    Production that check is off by default, and it never covers transient-in-singleton, a scope that
    is too wide, or a disposable tracked by the root.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Singleton is the fast one, so prefer it."</strong></p>
    <p>Singleton avoids allocation and makes every field shared mutable state. The incident in this
    module is one word changed to singleton for a sound performance reason, on a class whose dependency
    was not thread-safe. Every singleton is a concurrency decision.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Injecting IServiceProvider fixes a lifetime error."</strong></p>
    <p>It removes the error message. Measured, it starts and then fails at every lookup with validation
    on, and leaks with it off. The error was telling you the graph is wrong.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"It works locally, so the lifetimes are fine."</strong></p>
    <p>At concurrency 1 the singleton version of the incident failed nothing across 200 requests. A
    single-user environment cannot exhibit this class of bug at all — not rarely, but never.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A background service can take the services it needs directly."</strong></p>
    <p>A hosted service is a singleton, so taking a scoped service is a captive dependency and startup
    validation says so. It takes <code>IServiceScopeFactory</code> and creates one scope per unit of
    work.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Return to the incident, with the numbers. A payments API at roughly 40 requests a second. After
    the deploy, virtually every request that overlapped another failed — measured at 194 to 198 out of
    200 above concurrency 1 — while every request made in isolation succeeded.</p>
    <p>From the outside that reads as an outage that comes and goes with traffic. Retry the failing
    request by hand while the system is quiet and it succeeds, so the first thing anybody does to
    investigate is the one thing guaranteed to hide it.</p>
    <p>Four hypotheses were tried first and all were reasonable: a database problem, because the
    exception names the context; connection pool exhaustion, because it correlates with load; a bad
    database deployment, because the timing matched; a network fault, because it was intermittent. What
    settled it was not a hypothesis but reading the diff of the deployment that started it, which was
    two characters long.</p>
    <p>Two lines of container configuration would have made that deployment fail to start, with a
    message naming both types. The cost of those two lines is a few milliseconds of startup, and the
    cost of not having them was a partial outage and an afternoon.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A feature flag is read per request from a scoped <code>IFlagReader</code>. A new singleton
    <code>PricingEngine</code> takes <code>IFlagReader</code> so it can check the same flag. After the
    deploy the flag appears stuck for the engine, while the endpoint sees it change correctly.</p>
    <p>What is happening, and what one setting would have refused to start?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   validation off   started
                    header off  -&gt; {"endpointSees":false,"engineSees":false}
                    header on   -&gt; {"endpointSees":true,"engineSees":false}
                    header off  -&gt; {"endpointSees":false,"engineSees":false}

   validation on    REFUSED TO START
                    Cannot consume scoped service 'IFlagReader' from
                    singleton 'PricingEngine'.</code></pre>
        <p>The singleton captured the scoped reader. It was built once, during the first request, and its
        <code>IFlagReader</code> was resolved from the root provider at that moment — so it holds
        whatever the flag was then, permanently.</p>
        <p><code>ValidateScopes</code> would have refused to start, naming both types. It is on in
        Development and off in Production, which is why this deployed.</p>
        <p>The fix is not "make the engine scoped", although that works — the engine is a singleton for a
        reason. A singleton must ask for per-request data at the moment it needs it, either as a method
        parameter or through a scope it creates, rather than holding a reference to the thing that
        provides it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A service returns a report. It resolves a disposable formatter from an injected
    <code>IServiceProvider</code> on every call. Memory climbs steadily and never returns; a dump shows
    tens of thousands of live formatters, all reachable from the container.</p>
    <p>Why does nothing collect them, and what are the two fixes?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   resolved from                created   disposed   still held
   -------------                -------   --------   ----------
   an injected provider            5000          0   5000
   a scope per call                5000       5000   0
   constructed and owned           5000       5000   0</code></pre>
        <p>The container tracks every disposable it creates, because it is the only thing that can
        dispose them. An <code>IServiceProvider</code> injected into a singleton <em>is</em> the root
        provider, and the root is disposed when the application shuts down — so every formatter goes on a
        list that is never released.</p>
        <p>Nothing here is garbage: the objects are reachable, so no amount of collection helps. That is
        what makes it look like a framework leak rather than an application one.</p>
        <p><strong>Fix one:</strong> create a scope per unit of work and dispose it. The scope owns the
        tracking list, so disposing it disposes everything resolved through it.</p>
        <p><strong>Fix two:</strong> do not ask the container. A formatter with no dependencies worth
        injecting can be constructed and disposed by the code that uses it, and the container tracks
        nothing because it created nothing.</p>
        <p>Prefer fix two where it applies. The container is for things you would substitute; a
        short-lived helper constructed in a method is ordinary code and cannot leak this way.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A worker polls a queue and processes messages in a loop. It creates a scope, resolves a unit of
    work, and runs. Over a week its memory grows and each message takes longer.</p>
    <p>Two candidate loops — scope outside, scope inside. Which is wrong, and what does the other
    cost?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   loop shape                 scopes   units   items in the last unit
   ----------                 ------   -----   ----------------------
   scope outside the loop           1       1                      100
   scope inside the loop          100     100                        1</code></pre>
        <p>The scope outside the loop is wrong. One unit of work handles every message the process has
        ever seen, so whatever it accumulates — a change tracker, a list of pending writes, a
        transaction — grows without limit. A hundred messages here; a hundred thousand by Friday.</p>
        <p>That is both symptoms: memory grows because nothing is released, and each message is slower
        because every operation works against a larger set.</p>
        <p>What the correct version costs, because it is not free: a hundred scopes and a hundred units of
        work rather than one. In a real system that means a hundred connections taken from the pool and
        returned, rather than one held open.</p>
        <p>That is the right trade almost always. Pooled connections are cheap to take and return, and
        correctness under failure is not: with a scope per message, one poisoned message fails alone;
        with one scope for the run, it corrupts the unit of work every later message shares.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>Design a currency catalogue that is loaded once, shared by every request, refreshed periodically
    from the database, and holds no scoped service. Evaluate three designs: one that holds the context,
    one that holds <code>IServiceProvider</code>, and one that holds
    <code>IServiceScopeFactory</code>.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   design                          startup   contexts   requests   failed
   ------                          -------   --------   --------   ------
   1. holds the context            REFUSED          0          0        0
   2. holds IServiceProvider       started          0        100      100
   3. holds IServiceScopeFactory   started        100        100        0</code></pre>
        <p><strong>Attempt 1</strong> is refused at startup by <code>ValidateScopes</code>, and without
        it would have shared one context across every request — the production incident.</p>
        <p><strong>Attempt 2</strong> starts, because validation walks constructors and cannot see a
        runtime lookup, then fails at the moment it looks up: a provider injected into a singleton is the
        root, and the root refuses scoped services. It converted a startup failure into a runtime one
        while looking like a fix. With validation off it would have succeeded and put a context on the
        root's tracking list forever.</p>
        <p><strong>Attempt 3</strong> holds <code>IServiceScopeFactory</code>, which is a singleton, and
        creates a scope for each load. It starts, it refreshes, and the context is disposed with the
        scope.</p>
        <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs — attempt 3"><code>public sealed class ScopingCatalogue(IServiceScopeFactory scopeFactory) : ICatalogue
{
    public async Task&lt;decimal&gt; RateAsync(string code)
    {
        using IServiceScope scope = scopeFactory.CreateScope();

        return await scope.ServiceProvider.GetRequiredService&lt;RateContext&gt;().QueryAsync(code);
    }
}</code></pre>
        <p>The general shape: <strong>a singleton may not hold a scoped service; it may hold the ability
        to create a scope.</strong></p>
        <p>One thing attempt 3 still owes you: the cached value is shared mutable state, so the refresh
        and the readers must agree — in the full version a single reference assignment, which is atomic.
        A singleton is a concurrency decision as much as a lifetime one, and solving the lifetime does not
        solve the other half.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Two requests, two resolves of each lifetime in each. How many instances of a singleton, a
      scoped and a transient service?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>1, 2 and 4 — seven in total. The singleton is created once, the
        scoped once per request, the transient once per resolve.</p></div>
      </details></li>

    <li><p>What is a captive dependency, and which direction is illegal?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A service held by something longer-lived than itself, so it survives
        beyond its registered lifetime. A dependency must live at least as long as the thing holding it,
        so a singleton may only depend on singletons.</p></div>
      </details></li>

    <li><p>Where is <code>ValidateScopes</code> on by default, and what does it not catch?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>On in Development, off in Production. It catches a scoped service
        consumed by a singleton. It does not catch transient-in-singleton, a scope that is too wide, a
        disposable tracked by the root, or anything resolved at runtime from an
        <code>IServiceProvider</code>.</p></div>
      </details></li>

    <li><p>Why does a background service need <code>IServiceScopeFactory</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A hosted service is a singleton and has no request, so it has no
        scope. Taking a scoped service directly is a captive dependency; the factory is a singleton, so a
        singleton may hold it and create one scope per unit of work.</p></div>
      </details></li>

    <li><p>Why does resolving transient disposables from the root provider leak?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The container tracks every disposable it creates so it can dispose
        them, and the tracking list belongs to the resolving scope. The root's list is released only at
        shutdown, so the objects stay reachable and are never collected.</p></div>
      </details></li>

    <li><p>Why did the production incident not reproduce in staging?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The defect is two requests overlapping inside one shared context. At
        one request at a time it does not occur at all — measured as zero failures in 200 requests at
        concurrency 1.</p></div>
      </details></li>

    <li><p>A class is registered transient and only one instance is ever created. What happened?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Something long-lived resolved it once and kept the reference.
        Transient means a new instance per resolve, not a short life; the lifetime you get is the
        holder's.</p></div>
      </details></li>

    <li><p>How wide should a scope be in a worker, and why not wider?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>One unit of work — one message, item or iteration. A wider scope
        accumulates state without limit and lets one failed item corrupt the unit of work that every
        later item shares.</p></div>
      </details></li>
  </ol>
</section>
`
});
