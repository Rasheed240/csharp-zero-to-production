CSPREP.module({
  id: "t3-10-dependency-injection",
  minutes: 55,
  updated: "2026-09-04",
  summary: "A receipt class reaches DateTime.UtcNow and Random.Shared, and there is no assertion anybody can write about it. Inversion of control from first principles, the composition root, and the container's resolution rules measured rather than assumed: it picks the greediest constructor it can satisfy, the last registration silently wins, and ValidateOnBuild - which turns a missing registration into a failed deployment - is on in Development and off in Production.",
  terms: ["dependency", "dependency injection", "inversion of control", "container",
    "IServiceCollection", "IServiceProvider", "registration", "resolve", "composition root",
    "service location", "TryAdd", "keyed service", "open generic", "factory registration",
    "decorator", "ValidateOnBuild", "IOptions", "constructor injection"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A class that issues receipts. It stamps each one with the time, and it gets the time the way the
  language offers it:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - decides for itself what it talks to"><code>public sealed class UntestableReceipt
{
    public string Issue(string paymentId, long amountMinor)
    {
        string reference = $"REF-{Random.Shared.Next(100_000, 999_999)}";

        return $"{reference} {paymentId} {amountMinor / 100m:0.00} " +
            $"{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}";
    }
}</code></pre>

  <p>Nothing is wrong with any line of it. Now write a test that asserts on what it returns:</p>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   before, call 1   REF-257927 PAY-1 500.00 2026-09-03 23:13:38
   before, call 2   REF-287423 PAY-1 500.00 2026-09-03 23:13:38</code></pre>

  <p>Two calls, the same arguments, different answers. There is no assertion to write, and nothing in
  the signature explains why — <code>Issue(string, long)</code> looks like a function of its
  arguments and is not.</p>

  <p>The reference and the timestamp come from somewhere the caller cannot reach.
  <strong>The class decided, on its own, what it would talk to.</strong> To use a different clock you
  edit the class; to test it you accept that you cannot.</p>

  <p>Scale that up. A settlement run needs a payment gateway, which needs an HTTP adapter, which needs
  a clock. Now every one of those decisions is buried inside the class that made it, the gateway cannot
  be pointed at a sandbox without an edit, and a test of the settlement logic performs a real HTTP
  request.</p>

  <p>This module is about the alternative, which is one sentence long: <strong>a class states what it
  needs, and something else decides what to give it</strong>. Everything else — containers,
  registrations, lifetimes, the word "injection" — is machinery for doing that at scale.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every type name, count, status code and exception message in this module was produced by running
    the programs shown, on .NET 10, and pasted in unedited.</p>
  </div>
</section>

<section id="plain-language">
  <h2>Inversion of control, and the thing people mean by it</h2>

  <p class="define"><span class="define__term">Dependency</span> Anything a class needs in order to do
  its job that it does not compute itself: a gateway, a database, a clock, a file system, a logger.</p>

  <p class="define"><span class="define__term">Inversion of control</span> The design in which a class
  does not choose its own dependencies. Control over that decision is inverted — moved out of the class
  and up to whatever creates it. It is a way of writing classes, not a library.</p>

  <p class="define"><span class="define__term">Dependency injection</span> The specific way of achieving
  that used here: the dependencies are handed in as constructor arguments. "Injection" means nothing
  more than "passed in from outside".</p>

  <p class="define"><span class="define__term">Container</span> An object that knows which concrete type
  to supply for each requested type, and can build an object by supplying its constructor arguments —
  recursively, so it builds their arguments too. In ASP.NET Core it is
  <code>IServiceProvider</code>, configured through <code>IServiceCollection</code>.</p>

  <p class="define"><span class="define__term">Registration</span> One entry in that configuration: "when
  something asks for <code>IClock</code>, give it a <code>SystemClock</code>".</p>

  <p class="define"><span class="define__term">Resolve</span> To ask the container for an instance of a
  type. The container builds it, and everything it needs, from the registrations.</p>

  <p>The same class, written so that it is told:</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>// 00-smallest.cs — The same class written two ways, and the one thing that
// changes: who decides what it talks to.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

Console.WriteLine("1. The version that decides for itself");
Console.WriteLine();

var hardwired = new HardwiredReceiptWriter();
Console.WriteLine($"   {hardwired.Write("INV-1", 125_00)}");

Console.WriteLine();
Console.WriteLine("   To test that line you need a real clock, so the expected value changes");
Console.WriteLine("   every second. To use a different clock you edit the class.");
Console.WriteLine();

Console.WriteLine("2. The version that is told");
Console.WriteLine();

// The dependency is a constructor argument, so the caller chooses it.
var injected = new ReceiptWriter(new SystemClock());
Console.WriteLine($"   with the real clock   {injected.Write("INV-1", 125_00)}");

var tested = new ReceiptWriter(new FixedClock(new DateTime(2026, 1, 1, 9, 0, 0)));
Console.WriteLine($"   with a fixed clock    {tested.Write("INV-1", 125_00)}");

Console.WriteLine();
Console.WriteLine("   The second line is an assertion you can write. Nothing about");
Console.WriteLine("   ReceiptWriter changed between them.");
Console.WriteLine();

Console.WriteLine("3. The same class, wired by the container");
Console.WriteLine();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// Two registrations: what to hand out when somebody asks for each type.
builder.Services.AddSingleton&lt;IClock, SystemClock&gt;();
builder.Services.AddSingleton&lt;ReceiptWriter&gt;();

var app = builder.Build();

// Nobody writes "new ReceiptWriter(new SystemClock())" anywhere. The parameter
// is a request, and the container answers it.
app.MapGet("/receipts/{id}", (string id, ReceiptWriter writer) =&gt;
    Results.Ok(new { receipt = writer.Write(id, 125_00) }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
Console.WriteLine($"   GET /receipts/INV-1   {await http.GetStringAsync("/receipts/INV-1")}");
await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   THE WHOLE IDEA IN ONE SENTENCE: a class states what it needs, and");
Console.WriteLine("   something else decides what to give it.");
Console.WriteLine();
Console.WriteLine("   That 'something else' is one place in the program rather than every");
Console.WriteLine("   place a dependency is used, which is what makes swapping a clock, a");
Console.WriteLine("   gateway or a database a change to one line.");

// ---------------------------------------------------------------------------
public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow =&gt; DateTime.UtcNow;
}

public sealed class FixedClock(DateTime fixedTime) : IClock
{
    public DateTime UtcNow =&gt; fixedTime;
}

// Decides for itself. There is no seam: no caller can change what it talks to.
public sealed class HardwiredReceiptWriter
{
    public string Write(string reference, long amountMinor) =&gt;
        $"{reference} {amountMinor / 100m:0.00} at {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}";
}

// Is told. The dependency is visible in the signature, so the compiler will not
// let you construct one without deciding.
public sealed class ReceiptWriter(IClock clock)
{
    public string Write(string reference, long amountMinor) =&gt;
        $"{reference} {amountMinor / 100m:0.00} at {clock.UtcNow:yyyy-MM-dd HH:mm:ss}";
}</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>2. The version that is told

   with the real clock   INV-1 125.00 at 2026-09-03 23:04:02
   with a fixed clock    INV-1 125.00 at 2026-01-01 09:00:00

3. The same class, wired by the container

   GET /receipts/INV-1   {"receipt":"INV-1 125.00 at 2026-09-03 23:04:02"}</code></pre>

  <p>The second line of section 2 is an assertion you can write, and <code>ReceiptWriter</code> did not
  change between the two. In section 3 nobody writes
  <code>new ReceiptWriter(new SystemClock())</code> anywhere: the endpoint's parameter is a request,
  and the container answers it.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>A class that constructs its own dependencies is like a recipe that begins "go to the shop on the
  corner and buy flour". It works, and it can only ever be made near that shop. Injection is the recipe
  that begins "you will need flour" — it says what it needs and leaves the shopping to whoever is
  cooking.</p>

  <p><strong>This is an analogy and it misleads in one specific way.</strong> A cook holding an
  ingredient list still has to shop, so the work looks like it has merely moved. The real difference is
  that the list is now <em>written down</em>: the recipe's requirements are visible on its first line
  instead of scattered through its steps, which is what lets anybody check them, satisfy them
  differently, or notice one is missing before starting.</p>
</section>

<section id="resolution-rules">
  <h2>What the container actually does</h2>

  <p>Four rules, all of which have consequences people meet as bugs.</p>

  <h3>It picks the greediest constructor it can satisfy</h3>

  <p><code>Gateway</code> has three constructors: one taking nothing, one taking a clock, and one taking
  a clock and a retry policy. Varying only what else is registered:</p>

  <pre data-lang="console" data-title="01-what-the-container-does.cs output"><code>   nothing else registered     -&gt;  Gateway()
   IClock registered           -&gt;  Gateway(IClock)
   IClock and IRetryPolicy     -&gt;  Gateway(IClock, IRetryPolicy)</code></pre>

  <p>The most parameters it can supply wins. <strong>Register one more service and a different
  constructor runs</strong>, with no change to the class and nothing in the output to say so.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Give an injectable class exactly one constructor. Two constructors means the behaviour of your
    class depends on a registration in a different file — a coupling that is invisible from both ends.</p>
    <p>The usual reason for a second one is "for tests", and that is the case where the risk is highest:
    the constructor that never runs in production is the one that starts running when a registration is
    removed.</p>
  </div>

  <h3>The last registration wins, and nothing is lost</h3>

  <pre data-lang="console" data-title="01-what-the-container-does.cs output"><code>   GetRequiredService&lt;IClock&gt;()   FixedClock
   GetServices&lt;IClock&gt;() count    2

   after TryAddSingleton          SystemClock
   registrations                  1</code></pre>

  <p>Registering the same interface twice is legal. A single resolve gets the last one; both are still
  there and both come back if you ask for the collection. No warning, no error — so a second
  <code>AddSingleton</code> inside a library's extension method silently replaces yours when it runs
  later, and silently loses when it runs earlier.</p>

  <p class="define"><span class="define__term">TryAdd</span> Registers only if nothing is registered for
  that service type yet. <code>Add</code> says "this is the one"; <code>TryAdd</code> says "this will do
  if nobody has a better idea".</p>

  <p><strong>Use <code>Add</code> in an application and <code>TryAdd</code> in anything shared.</strong>
  An <code>Add</code> inside a library's registration method asserts that no consumer may override it,
  which is almost never what was meant.</p>

  <h3>Asking for all of them</h3>

  <pre data-lang="csharp" data-net="10" data-title="01-what-the-container-does.cs"><code>services.AddSingleton&lt;IReceiptRule, AmountRule&gt;();
services.AddSingleton&lt;IReceiptRule, CurrencyRule&gt;();
services.AddSingleton&lt;IReceiptRule, ReferenceRule&gt;();

// One parameter, every registration.
public sealed class ReceiptValidator(IEnumerable&lt;IReceiptRule&gt; rules)
{
    public int RuleCount { get; } = rules.Count();

    public string Names { get; } = string.Join(", ", rules.Select(rule =&gt; rule.Name));
}</code></pre>

  <pre data-lang="console" data-title="01-what-the-container-does.cs output"><code>   rules injected   3
   in order         amount, currency, reference</code></pre>

  <p>A constructor parameter of type <code>IEnumerable&lt;T&gt;</code> receives every registration, in
  registration order, with nothing extra required. This is the plug-in shape, and it is why multiple
  registrations are allowed at all: a new rule is one line and no edit to the validator.</p>

  <p>Note that the order <em>is</em> the registration order, which makes it part of your configuration.
  If the order matters — a chain where one rule short-circuits — it is being decided by where the lines
  happen to sit in a file.</p>

  <h3>One registration for every closed generic type</h3>

  <pre data-lang="csharp" data-net="10" data-title="01-what-the-container-does.cs"><code>// No angle-bracket arguments: this registers the shape, not one type.
services.AddSingleton(typeof(IRepository&lt;&gt;), typeof(InMemoryRepository&lt;&gt;));</code></pre>

  <pre data-lang="console" data-title="01-what-the-container-does.cs output"><code>   IRepository&lt;Payment&gt;   InMemoryRepository of Payment
   IRepository&lt;Invoice&gt;   InMemoryRepository of Invoice</code></pre>

  <p>One line, and a repository for a type nobody has written yet resolves. It is also where the
  convenience stops being free: a type that should <em>not</em> have a repository now has one, and the
  mistake shows up as a successful resolve rather than a compile error.</p>

  <h3>Two implementations, both wanted</h3>

  <p class="define"><span class="define__term">Keyed service</span> A registration tagged with a name,
  .NET 8 and later. The key is part of the registration and part of the request.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-what-the-container-does.cs"><code>services.AddKeyedSingleton&lt;IPaymentGateway, CardGateway&gt;("card");
services.AddKeyedSingleton&lt;IPaymentGateway, BankGateway&gt;("bank");

public sealed class Checkout(
    [FromKeyedServices("card")] IPaymentGateway card,
    [FromKeyedServices("bank")] IPaymentGateway bank)
{
    public IPaymentGateway Card { get; } = card;

    public IPaymentGateway Bank { get; } = bank;
}</code></pre>

  <pre data-lang="console" data-title="01-what-the-container-does.cs output"><code>   checkout.Card   CardGateway
   checkout.Bank   BankGateway

   unkeyed resolve of IPaymentGateway   (null - keyed registrations are separate)</code></pre>

  <p>This solves the case the container otherwise cannot: two implementations of one interface, both
  needed, chosen by name rather than by position. Before .NET 8 it was a factory delegate or two
  interfaces that existed only to be different types, and you will find both in older code.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Read the last line of that output. A keyed registration does not answer an unkeyed request — they
    are separate namespaces. Adding a key to an existing registration breaks every consumer that was not
    updated, and breaks it at resolve time rather than at compile time.</p>
  </div>
</section>

<section id="composition-root">
  <h2>Where the wiring goes</h2>

  <p class="define"><span class="define__term">Composition root</span> The single place in a program that
  knows which concrete types exist and how they fit together. Everything else names interfaces and is
  handed instances.</p>

  <p>A settlement run touching five classes, built by hand and built by the container:</p>

  <pre data-lang="csharp" data-net="10" data-title="02-composition-root.cs"><code>// By hand, at the one place that runs it.
IClock clock = new SystemClock();
var run = new SettlementRun(
    new CardGateway(new HttpAdapter(clock)),
    new Ledger(clock));

// By the container, from the same information.
var services = new ServiceCollection();
services.AddSingleton&lt;IClock, SystemClock&gt;();
services.AddSingleton&lt;IHttpAdapter, HttpAdapter&gt;();
services.AddSingleton&lt;IPaymentGateway, CardGateway&gt;();
services.AddSingleton&lt;ILedger, Ledger&gt;();
services.AddSingleton&lt;SettlementRun&gt;();</code></pre>

  <p>Both produce identical output, and at this size the hand-built version is arguably clearer.
  <strong>The container is not the point.</strong> What matters is that in both versions the decisions
  live in one place.</p>

  <p>The container earns its place when the graph gets deep, because it removes the part of hand-wiring
  that actually hurts: constructing the same object in four places, and re-editing every call site when
  a class gains a dependency.</p>

  <p>In an ASP.NET Core application the composition root is <code>Program.cs</code> — specifically,
  everything between <code>CreateBuilder</code> and <code>Build</code>. A registration anywhere else is
  a second root, and two roots is no root.</p>

  <h3>The version that asks the container itself</h3>

  <p class="define"><span class="define__term">Service location</span> Taking an
  <code>IServiceProvider</code> as a dependency and looking services up from it at the point of use,
  instead of declaring them as constructor parameters.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - its constructor tells you nothing"><code>public sealed class LocatingReport(IServiceProvider services)
{
    public string Run()
    {
        var gateway = services.GetRequiredService&lt;IPaymentGateway&gt;();

        return gateway.Capture("PAY-1", 50_000);
    }
}</code></pre>

  <p>With <code>IPaymentGateway</code> deliberately unregistered, and both versions of the class needing
  it:</p>

  <pre data-lang="console" data-title="02-composition-root.cs output"><code>   what happens when a dependency is missing:

     constructor injection   InvalidOperationException: Unable to resolve service for type
                             'IPaymentGateway' while attempting to activate 'InjectedReport'.
     service location        built: LocatingReport

     ... and when it is used  InvalidOperationException: No service for type
                              'IPaymentGateway' has been registered.</code></pre>

  <p><strong>The failure moved.</strong> Constructor injection failed the moment anything tried to build
  the object; service location built happily and failed later, on the code path that needed the missing
  service. That difference is the entire argument against it, and it has three parts:</p>

  <ol>
    <li><strong>The dependencies become invisible.</strong> The constructor says it needs a container,
    which is true of every class and therefore says nothing. Reading the signature no longer tells you
    what the class talks to; you have to read every method.</li>
    <li><strong>Validation cannot see them either.</strong> Startup validation walks constructors, so
    anything located at runtime is invisible to it — the check you turned on covers less than you
    think.</li>
    <li><strong>Testing gets worse.</strong> To test the injected version you pass stand-ins. To test the
    locating version you build a container, which means every test now knows the application's
    registration rules.</li>
  </ol>

  <p>There are places it is legitimate: the composition root itself, which is allowed to know about the
  container because it <em>is</em> the container's configuration; resolving a type known only at runtime,
  behind a factory that is itself injected; and creating a scope for work that outlives a request, which
  is the next module's subject.</p>

  <p>The test to apply: <strong>is the container an implementation detail of this class, or its
  subject?</strong> A factory whose job is to build things by name may hold one. A report that needs a
  gateway may not.</p>

  <h3>The payoff, precisely stated</h3>

  <pre data-lang="csharp" data-net="10" data-title="02-composition-root.cs — the whole test setup"><code>var report = new InjectedReport(
    new FixedClock(new DateTime(2026, 1, 1)),
    new RecordingGateway());</code></pre>

  <pre data-lang="console" data-title="02-composition-root.cs output"><code>   first call    captured PAY-1 at 2026-01-01
   second call   captured PAY-1 at 2026-01-01
   identical     True</code></pre>

  <p>There is no container in those three lines. What produced the testability is that the class states
  its dependencies as parameters, so a caller can supply different ones.</p>

  <p><strong>Inversion of control is the design. A container is one way to do the wiring.</strong>
  Codebases conflate them constantly, and that conflation is why people end up registering things in a
  container in order to test them — which is the opposite of the benefit.</p>

  <p>A useful check on any class you have written: <em>could I construct this in a test with
  <code>new</code> and nothing else?</em> If not, the dependency you cannot supply is one it took
  without saying so.</p>

</section>

<section id="what-to-inject">
  <h2>What to inject, and what not to</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Inject</th><th>Do not inject</th><th>Why</th></tr></thead>
      <tbody>
        <tr><td>Things that talk to the outside world — a gateway, a repository, a clock, a message
            publisher, the file system</td>
            <td>Values and configuration — a connection string, a timeout, a feature flag</td>
            <td>A setting is not a dependency. It belongs in an options type, not its own
            registration.</td></tr>
        <tr><td>Things with more than one implementation — a pricing strategy, a rule set</td>
            <td>Pure functions — a formatter, a parser</td>
            <td>An interface with one implementation, no state and no I/O buys a substitution nobody will
            make.</td></tr>
        <tr><td>Things you need to replace in a test</td>
            <td>Data — a request, an invoice</td>
            <td>Data is an argument to a method, not a constructor parameter.</td></tr>
      </tbody>
    </table>
  </div>

  <p>The question is not whether something <em>could</em> be injected; everything could. It is
  <strong>would I ever want to substitute this, in production or in a test?</strong></p>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <h3>Grouped registrations</h3>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>builder.Services
    .AddLedgerCore()
    .AddPaymentGateway(builder.Configuration)
    .AddReceipts();</code></pre>

  <p>Extension methods on <code>IServiceCollection</code> are the convention, and they are a trade rather
  than a rule. <strong>What you gain:</strong> the root reads as a list of capabilities, a feature's
  registrations live next to the feature, and deleting a feature is deleting one line and one folder.
  <strong>What you lose:</strong> the root no longer tells you what is registered — the thing the
  composition root exists to make visible has been moved elsewhere, one level at a time.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a registration method that does work"><code>public static IServiceCollection AddPaymentGateway(
    this IServiceCollection services, IConfiguration configuration)
{
    // Builds a second container, resolves from it, and throws the result away.
    // Everything registered after this line is invisible to that copy, and every
    // singleton it created is a duplicate of the one the real container will make.
    using ServiceProvider temporary = services.BuildServiceProvider();
    var clock = temporary.GetRequiredService&lt;IClock&gt;();

    services.AddSingleton&lt;IPaymentGateway&gt;(new CardGateway(new HttpAdapter(clock)));

    return services;
}</code></pre>

  <p>This is the shape the ASP0000 analyzer warns about, and the warning is worth reading rather than
  suppressing: a registration method runs while the configuration is still being assembled, so anything
  it resolves is a snapshot of a half-built application.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The rule that keeps the gain and limits the loss: a registration extension method may call other
    registrations, and must do nothing else. No reading files, no opening connections, no
    <code>BuildServiceProvider</code> to look something up. If it does work rather than describing work,
    that work happens in an order nobody chose.</p>
  </div>

  <h3>Settings are not services</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - registers a string"><code>builder.Services.AddSingleton("https://gw.internal:8443");</code></pre>

  <p>Every class asking for a <code>string</code> now receives the gateway's base URL, and the second
  setting registered this way silently replaces the first — the last-registration-wins rule, applied to
  a type you do not own.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs — the same setting, bound"><code>builder.Services.Configure&lt;GatewayOptions&gt;(builder.Configuration.GetSection("Gateway"));

public sealed class ConfiguredGateway(IOptions&lt;GatewayOptions&gt; options)
{
    // Value is the bound object. The class never sees IConfiguration.
    public GatewayOptions Options { get; } = options.Value;
}</code></pre>

  <pre data-lang="console" data-title="03-production.cs output"><code>   base url        https://gw.internal:8443
   timeout         5s
   max attempts    3

     constructed by hand   https://localhost, 1 attempt(s)</code></pre>

  <p><strong>Register types you defined.</strong> Registering <code>string</code>, <code>int</code>,
  <code>TimeSpan</code> or <code>bool</code> puts a value into a namespace shared with the entire
  framework. An options type also keeps the test seam: the last line was constructed with
  <code>Options.Create</code> and no configuration at all.</p>

  <h3>Wrapping an implementation without changing it</h3>

  <p class="define"><span class="define__term">Decorator</span> A class that implements an interface and
  holds another implementation of the same interface, adding behaviour around it. The consumer cannot
  tell the difference.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// The inner implementation, registered as itself rather than as the
// interface, so that asking for the interface cannot reach it directly.
builder.Services.AddSingleton&lt;CardGateway&gt;();

// The interface resolves to the wrapper, which is handed the inner one.
builder.Services.AddSingleton&lt;IPaymentGateway&gt;(provider =&gt;
    new LoggingGateway(
        provider.GetRequiredService&lt;CardGateway&gt;(),
        provider.GetRequiredService&lt;List&lt;string&gt;&gt;()));</code></pre>

  <pre data-lang="console" data-title="03-production.cs output"><code>   what SettlementRun received   LoggingGateway

   log entries:
     capture PAY-1 50000 -&gt; CardGateway
     capture PAY-2 12500 -&gt; CardGateway</code></pre>

  <p>Neither <code>CardGateway</code> nor <code>SettlementRun</code> knows this happened. One depends on
  the interface and one implements it; the composition root put a third object between them. Retries,
  caching, metrics, circuit breaking and audit logging are all this shape, and injection is what makes
  each of them a configuration change rather than an edit.</p>

  <p>The cost is real and worth stating: a stack trace now has a layer in it that appears at no call
  site, and "go to implementation" lands on the wrong class. Two decorators on one interface is usually
  one too many for anybody debugging at 03:00.</p>

  <p class="define"><span class="define__term">Factory registration</span> Registering a lambda that
  builds the service, rather than a type for the container to construct. The general answer to "the
  container cannot work this one out", and the lambda runs inside the container, so what it builds is
  still managed by the container.</p>

  <h3>The whole thing in one file</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    EnvironmentName = "Production"
});

builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

builder.Configuration.AddInMemoryCollection(new Dictionary&lt;string, string?&gt;
{
    ["Gateway:BaseUrl"] = "https://gw.internal:8443",
    ["Gateway:MaxAttempts"] = "2"
});

// ---------------------------------------------------------------------------
// THE COMPOSITION ROOT. The only part of this program that names a concrete
// type, and the only part that would change to swap one.

// Fail at startup rather than on the request that needed the missing service.
// Off by default outside Development, which is the wrong way round.
builder.Host.UseDefaultServiceProvider(options =&gt;
{
    options.ValidateOnBuild = true;
    options.ValidateScopes = true;
});

builder.Services
    .AddLedgerCore()
    .AddPaymentGateway(builder.Configuration)
    .AddSettlement();

var app = builder.Build();

// ---------------------------------------------------------------------------
// The endpoints ask for what they need. Nothing here knows how any of it is
// built, and nothing here mentions IServiceProvider.

app.MapPost("/v1/payments/{id}/capture", (string id, SettlementRun run) =&gt;
    Results.Ok(new { result = run.Settle(id, 50_000) }));

app.MapGet("/v1/config", (IOptions&lt;GatewayOptions&gt; options) =&gt;
    Results.Ok(new { options.Value.BaseUrl, options.Value.MaxAttempts }));</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>2. What the container actually built

   IPaymentGateway resolves to   RetryingGateway
   IClock resolves to            SystemClock
   settlement rules injected     2

3. The same classes, in a test, with no container

   call 1      [amount+currency] captured PAY-1 | recorded PAY-1 at 2026-01-01 09:00:00
   call 2      [amount+currency] captured PAY-1 | recorded PAY-1 at 2026-01-01 09:00:00
   identical   True</code></pre>

  <p>Three arguments and one <code>new</code>: no <code>ServiceCollection</code>, no configuration, no
  network. That is what the design bought. The container only saved typing.</p>
</section>

<section id="validation">
  <h2>Making a missing registration a failed deployment</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs — two lines"><code>builder.Host.UseDefaultServiceProvider(options =&gt;
{
    options.ValidateOnBuild = true;
    options.ValidateScopes = true;
});</code></pre>

  <pre data-lang="console" data-title="03-production.cs output"><code>   every service registered    built
   one registration removed    AggregateException: Error while validating the service
                               descriptor 'ServiceType: SettlementRun Lifetime: Singleton Im...</code></pre>

  <p class="define"><span class="define__term">ValidateOnBuild</span> An option that makes the container
  walk every registration when it is built, constructing each service's dependency graph, and fail
  immediately if any of it cannot be satisfied.</p>

  <p>Without it, a missing registration is discovered when something first asks for that service — which
  for a rarely-called endpoint means in production, on the request that needed it. An unregistered
  service used by one refund path survives every test, every review and every smoke check, and fails
  days after the deployment that broke it.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The same missing registration, inside a real <code>WebApplication</code>, measured in both
    environments:</p>
    <pre data-lang="console" data-title="01-what-the-container-does.cs output"><code>   Development   Build() threw AggregateException
                 first resolve: -
   Production    built without complaint
                 first resolve: InvalidOperationException: Unable to resolve service
                 for type 'IClock' while attempting to activate 'ReceiptWriter'.</code></pre>
    <p><code>WebApplication.CreateBuilder</code> turns validation on in Development and leaves it off in
    Production. <strong>The check that matters most is absent from the environment that matters
    most</strong> unless you ask for it.</p>
    <p>The argument against turning it on is startup cost, and it is measured in milliseconds against a
    process about to run for weeks. A process that will not start is a deployment that rolls back; a 500
    on one endpoint is an incident.</p>
  </div>

  <p>What validation still does not catch, measured by moving the same missing registration inside a
  factory lambda:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>     at build     built without complaint
     at resolve   InvalidOperationException: No service for type 'IHttpAdapter' has been registered.</code></pre>

  <p><strong>Validation reads constructors, not code.</strong> A factory lambda is invoked, never
  inspected, so everything it resolves is invisible to the check — the escape hatch is also a hole. The
  same applies to anything resolved from an <code>IServiceProvider</code> at runtime, and to registering
  the wrong implementation, which is a correct graph with the wrong contents.</p>

</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>A second constructor that quietly becomes the real one</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - two constructors, two behaviours"><code>public sealed class RefundService
{
    private readonly IAuditLog? _audit;

    public RefundService(IClock clock)
    {
        Chosen = "RefundService(IClock)";
    }

    public RefundService(IClock clock, IAuditLog audit)
    {
        _audit = audit;
        Chosen = "RefundService(IClock, IAuditLog)";
    }

    public void Refund(string paymentId, long amountMinor) =&gt;
        _audit?.Record($"refund {paymentId} {amountMinor}");
}</code></pre>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   registrations present         constructor chosen                 audits
   ---------------------         ------------------                 ------
   IClock and IAuditLog          RefundService(IClock, IAuditLog)   1
   IClock only                   RefundService(IClock)              0</code></pre>

  <p>Deleting the <code>IAuditLog</code> registration did not cause a failure. It caused a different
  constructor to be chosen — the one that does not audit. Nothing threw, because both constructors are
  valid, and no test failed, because the tests construct the class directly and pass both arguments.</p>

  <p><strong>A fallback selected silently is not a fallback; it is a second behaviour nobody is
  watching.</strong></p>

  <h3>A library that uses Add where it meant TryAdd</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   order                                        resolves to
   -----                                        -----------
   app first, library second (Add)              LibraryClock
   library first, app second (Add)              AppClock
   app first, library second (TryAdd)           AppClock
   library first, app second (TryAdd)           AppClock</code></pre>

  <p>With <code>Add</code>, which implementation you get depends on the order two files happen to be
  called in. The requirement is not "the library loses" but "the answer does not depend on ordering",
  and only <code>TryAdd</code> gives that in both directions.</p>

  <h3>Two services that need each other</h3>

  <pre data-lang="console" data-title="01-what-the-container-does.cs output"><code>   InvalidOperationException: A circular dependency was detected for the service of type 'Ping'.</code></pre>

  <p>This is a design message rather than a container problem. Two classes that each need the other are
  one class, or they need a third that both depend on. Breaking the cycle with a lazy resolve or a
  property setter hides it rather than fixing it.</p>

  <h3>Injecting something that did not need injecting</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a pure function behind a registration"><code>// No state, no I/O, one implementation, and now: an interface nobody will
// implement twice, a registration, and a parameter in every test.
public sealed class TestableReceipt(
    IClock clock,
    IReferences references,
    IReceiptFormatter formatter)
{
    public string Issue(string paymentId, long amountMinor) =&gt;
        formatter.Format(references.Next(), paymentId, amountMinor, clock.UtcNow);
}</code></pre>

  <p>The clock and the reference generator are genuine dependencies — their answers are outside your
  control. The formatter is a function of its arguments. Making it injectable adds indirection and buys
  a substitution nobody will make; a plain class or a static method is the better answer, and it can
  become injectable the day a second format exists.</p>

  <p><strong><code>new</code> is not the problem.</strong> Constructing a formatter, a
  <code>StringBuilder</code> or a value object inside a method is ordinary code. What is a problem is
  constructing — or statically reaching — something whose behaviour you would ever want to change.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
      <tbody>
        <tr><td><code>Unable to resolve service for type 'X' while attempting to activate 'Y'</code></td>
            <td>X was never registered, or its registration method is not called</td>
            <td>Register it; turn on <code>ValidateOnBuild</code> so the next one fails at startup</td></tr>
        <tr><td>A feature silently stops happening after an unrelated change</td>
            <td>A class with two constructors is now being built with the shorter one</td>
            <td>Reduce it to one constructor</td></tr>
        <tr><td>The wrong implementation is injected</td>
            <td>Two registrations for one interface; the last one won</td>
            <td>Resolve <code>IEnumerable&lt;T&gt;</code> and print the types to see all of them</td></tr>
        <tr><td><code>A circular dependency was detected</code></td>
            <td>Two services each need the other</td>
            <td>Extract the shared part into a third service</td></tr>
        <tr><td>Everything resolves and behaviour is still wrong</td>
            <td>A correct graph with the wrong contents — validation cannot see this</td>
            <td>Print what actually resolved, as below</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>The single most useful thing you can do with a container you do not trust is ask it what it
    built:</p>
    <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>Console.WriteLine(app.Services.GetRequiredService&lt;IPaymentGateway&gt;().GetType().Name);
Console.WriteLine(app.Services.GetServices&lt;ISettlementRule&gt;().Count());</code></pre>
    <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   IPaymentGateway resolves to   RetryingGateway
   settlement rules injected     2</code></pre>
    <p>Two lines, and both classes of silent failure become visible: the wrong implementation shows as an
    unexpected type name, and a missing plug-in registration shows as a count that is one lower than you
    expected.</p>
    <p>For a registration you cannot find, enumerate the descriptors themselves —
    <code>builder.Services</code> is an <code>IEnumerable&lt;ServiceDescriptor&gt;</code>, and each
    descriptor carries the service type, the implementation type and the lifetime. Printing the ones
    whose <code>ServiceType</code> matches what you are chasing answers "who registered this, and how
    many times" in one pass.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Dependency injection means using a container."</strong></p>
    <p>The container does the wiring. The design is that a class states its dependencies as parameters,
    and it works without any container at all — as the test in the composition root section shows, in
    three lines with no framework. Conflating the two is why people end up registering services in order
    to test them.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Everything should be behind an interface."</strong></p>
    <p>An interface with one implementation, no state and no I/O costs a file, a registration and a
    parameter, and buys a substitution nobody will make. Inject what talks to the outside world or what
    you would genuinely swap; construct the rest.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Injecting IServiceProvider is fine, it is the same thing."</strong></p>
    <p>Measured, it is not: constructor injection failed when the object was built, service location
    built successfully and failed later on the path that needed the service. It also hides the class's
    dependencies from readers and from startup validation.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Registering the same interface twice is a mistake the container will catch."</strong></p>
    <p>It is legal and silent. The last registration wins for a single resolve, and both remain available
    as a collection — which is a feature when you meant it and a bug when you did not.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A second constructor for tests is harmless."</strong></p>
    <p>The container picks the greediest constructor it can satisfy, so removing an unrelated
    registration switches which one runs. The constructor that never runs in production is the one
    waiting to.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"If it starts up, the wiring is correct."</strong></p>
    <p>Outside Development, a default ASP.NET Core application starts fine with a missing registration
    and fails on the first request that needs it. And even with validation on, a factory lambda, a
    runtime lookup, or the wrong implementation all pass.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>A payments service with about 60 registered types and one refund endpoint that runs perhaps 200
    times a day, none of them during a smoke test.</p>
    <p>A refactor moves <code>IRefundPolicy</code> into a new registration method and the call to that
    method is not added. Nothing fails: the build passes, every unit test passes because tests construct
    their subjects directly, the deployment succeeds, and the health check is green. The first refund
    request after the deploy returns a 500, and if the exception handling from the previous module is
    not in place, it returns an empty one.</p>
    <p>Two lines in the composition root turn that into a container that refuses to build, which is a
    deployment that rolls back before any traffic reaches it. The cost of those two lines is a few
    milliseconds of startup.</p>
    <p>The second, slower payoff is the one in the exercise: the class that reaches
    <code>DateTime.UtcNow</code> and <code>Random.Shared</code> cannot be asserted on at all. Every test
    written against it is either a test of nothing or a test that will be deleted for flakiness, and the
    logic inside it stays unverified for as long as the class exists.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A library ships an extension method that registers its own default clock. Your application
    registers a different one. Depending on which line runs first, one of them wins.</p>
    <p>Which, and what should the library have written instead?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   order                                        resolves to
   -----                                        -----------
   app first, library second (Add)              LibraryClock
   library first, app second (Add)              AppClock
   app first, library second (TryAdd)           AppClock
   library first, app second (TryAdd)           AppClock</code></pre>
        <p>With <code>Add</code> the last line wins, so the outcome depends on call order. The library
        should use <code>TryAddSingleton</code>, which registers only if nothing is registered for that
        type yet.</p>
        <p>Read the last two rows carefully: <code>TryAdd</code> makes the application win in
        <em>both</em> orders. That is the actual requirement — not "the library loses" but "the answer
        does not depend on ordering".</p>
        <p>The review rule: <code>Add</code> in an application, <code>TryAdd</code> in anything shared. An
        <code>Add</code> inside a library's registration method asserts that no consumer may override it,
        which is almost never what was meant.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A class has two constructors: a full one, and a shorter one added "for tests". A pull request
    deletes an unrelated registration, and an endpoint starts silently skipping its audit logging.
    Nothing threw and no test failed.</p>
    <p>Explain it.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   registrations present         constructor chosen                 audits
   ---------------------         ------------------                 ------
   IClock and IAuditLog          RefundService(IClock, IAuditLog)   1
   IClock only                   RefundService(IClock)              0</code></pre>
        <p>The container picks the greediest constructor it can satisfy. Removing the
        <code>IAuditLog</code> registration did not cause a failure — it caused a different constructor
        to be chosen, the one that does not audit.</p>
        <p>Nothing threw because both constructors are valid. No test failed because the tests construct
        the class directly and pass both arguments, so they exercise a code path production no longer
        uses.</p>
        <p>The fix is one constructor. A test needing fewer arguments passes a no-op implementation,
        which is three lines and cannot silently change what production does.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>Checkout needs the card gateway. Payouts needs the bank gateway. Both are
    <code>IPaymentGateway</code>, both are needed, and neither is a default.</p>
    <p>Give three ways to do it, and say which you would ship.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs — the three shapes"><code>// a. two interfaces that exist to be different types
services.AddSingleton&lt;ICardGateway, CardGateway&gt;();
services.AddSingleton&lt;IBankGateway, BankGateway&gt;();

// b. a factory that picks by name
services.AddSingleton&lt;CardGateway&gt;();
services.AddSingleton&lt;BankGateway&gt;();
services.AddSingleton&lt;IGatewayFactory, GatewayFactory&gt;();

// c. keyed registrations, .NET 8 and later
services.AddKeyedSingleton&lt;IPaymentGateway, CardGateway&gt;("card");
services.AddKeyedSingleton&lt;IPaymentGateway, BankGateway&gt;("bank");</code></pre>
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   a. two interfaces     CardGateway + BankGateway
   b. a factory          CardGateway + BankGateway
   c. keyed services     CardGateway + BankGateway</code></pre>
        <p>All three work; the answer is what each costs.</p>
        <ul>
          <li><strong>Two interfaces.</strong> Every consumer states exactly what it needs and the
          compiler enforces it. The cost is two interfaces that exist only to be different types, and a
          third when a third gateway arrives. Best when they really are different capabilities — if the
          bank gateway can do something the card one cannot, these were never one interface.</li>
          <li><strong>A factory.</strong> One place decides, and the choice can depend on data: a
          currency, a merchant setting, a route value. The cost is a lookup by string that fails at
          runtime. Best when the choice is genuinely dynamic.</li>
          <li><strong>Keyed services.</strong> The least new code, and the key is visible at the point of
          use. The cost is a string checked at resolve time, and keyed registrations do not answer
          unkeyed requests. Best when the set is fixed and known at compile time.</li>
        </ul>
        <p>What I would ship: keyed services for a fixed pair chosen statically, a factory when the
        choice depends on the request, and two interfaces when they turn out to be two different
        things — which, in payments, is more often than it looks.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>Take the receipt class from the opening of this module. Refactor it so a test can assert on its
    output without a container, a network, a clock or a random number generator.</p>
    <p>Then say which of its dependencies should <strong>not</strong> have become constructor
    parameters.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs — the refactor"><code>public sealed class TestableReceipt(IClock clock, IReferences references, ReceiptFormatter formatter)
{
    public string Issue(string paymentId, long amountMinor) =&gt;
        formatter.Format(references.Next(), paymentId, amountMinor, clock.UtcNow);
}</code></pre>
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   before, call 1   REF-257927 PAY-1 500.00 2026-09-03 23:13:38
   before, call 2   REF-287423 PAY-1 500.00 2026-09-03 23:13:38

   after, call 1    REF-000001 PAY-1 500.00 2026-01-01 09:00:00
   after, call 2    REF-000001 PAY-1 500.00 2026-01-01 09:00:00
   identical        True

   wired for real   REF-197862 PAY-1 500.00 2026-09-03 23:13:38</code></pre>
        <p><strong>Part one.</strong> The two things that made it untestable were both sources of
        non-determinism reached through a static: <code>DateTime.UtcNow</code> and
        <code>Random.Shared</code>. Neither appeared in the signature, so neither could be replaced.</p>
        <p>The rule is narrower than "inject everything": inject <em>anything whose answer you do not
        control</em> — the clock, randomness, the file system, the network, the machine name, the current
        user, the environment.</p>
        <p><strong>Part two.</strong> <code>ReceiptFormatter</code> should not have become an injected
        interface. It has no state, no I/O and one implementation, so injecting it adds a registration,
        an interface nobody will implement twice and a parameter to every test, in exchange for a
        substitution nobody will make. Note that in the solution above it is a plain class rather than an
        interface: constructed by the container for convenience, but with no seam pretending to
        exist.</p>
        <p><code>new</code> is not the problem. What is a problem is constructing, or statically reaching,
        something whose behaviour you would ever want to change.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is the difference between inversion of control and a dependency injection container?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Inversion of control is the design: a class states its dependencies
        as constructor parameters instead of choosing them. A container is a tool that supplies those
        arguments. The design works without the container; the container is worth nothing without the
        design.</p></div>
      </details></li>

    <li><p>A class has three constructors. Which does the container use?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The one with the most parameters that it can supply from the
        registrations. Which means adding or removing an unrelated registration can change which
        constructor runs, silently.</p></div>
      </details></li>

    <li><p>You register <code>IClock</code> twice. What does a single resolve return, and what happened
      to the other one?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The last registration wins. The first is still there and both come
        back from <code>GetServices&lt;IClock&gt;()</code> or an <code>IEnumerable&lt;IClock&gt;</code>
        constructor parameter.</p></div>
      </details></li>

    <li><p>When should a registration use <code>TryAdd</code> rather than <code>Add</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>In library or shared code registering a default. It makes the
        consumer's own registration win regardless of which line runs first.</p></div>
      </details></li>

    <li><p>Why is injecting <code>IServiceProvider</code> worse than injecting what you need?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It moves the failure from construction time to the code path that
        needs the service, hides the class's dependencies from anybody reading its signature, and makes
        them invisible to startup validation.</p></div>
      </details></li>

    <li><p>What does <code>ValidateOnBuild</code> catch, and what does it miss?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It catches anything a constructor needs that is not registered, at
        startup instead of at first use. It misses everything resolved inside a factory lambda or from an
        <code>IServiceProvider</code> at runtime, and it cannot tell that a correctly-built graph contains
        the wrong implementation.</p></div>
      </details></li>

    <li><p>Name two things that should not be injected.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Values and configuration — those belong in an options type, not as a
        registered <code>string</code> or <code>int</code> — and pure functions with one implementation,
        which gain an indirection and buy nothing.</p></div>
      </details></li>

    <li><p>What is the quickest check that a class has stated its dependencies honestly?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Try to construct it in a test with <code>new</code> and stand-ins,
        and nothing else. Whatever you cannot supply is a dependency it took without saying so.</p></div>
      </details></li>
  </ol>
</section>
`
});
