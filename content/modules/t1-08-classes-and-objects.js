/* ============================================================================
   Track 1, Module 8 — Classes and Objects
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64.
   The runnable sources are in verification/t1-08-classes-and-objects/.
   ========================================================================= */

CSPREP.module({
  id: "t1-08-classes-and-objects",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "A class is a blueprint; an object is one thing built from it. The order in which an object " +
    "comes into existence is fixed, surprising, and the source of bugs that only appear when " +
    "someone inherits from your class or when a static constructor fails once and kills a type " +
    "for the life of the process.",
  terms: [
    "class", "object", "instance", "field", "property", "constructor",
    "constructor chaining", "object initialiser", "this", "static", "static constructor",
    "field initialiser", "required member", "init accessor", "reachability",
    "finaliser", "TypeInitializationException", "NullReferenceException"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Three incidents from the same payments service.</p>

  <p>A class that has worked for two years starts throwing
  <code>NullReferenceException</code> from inside its own constructor — but only for one
  subclass, added last week by a different team. The field it complains about is assigned on the
  very next line of that subclass's constructor. The stack trace points at a method that looks
  correct in isolation.</p>

  <p>A service starts up, serves traffic for an hour, and then every request begins failing with
  <code>TypeInitializationException</code>. Restarting fixes it. The error message names a
  configuration class and carries an inner exception about a missing environment variable — which
  is present, and was present the whole time. Adding it again and reloading configuration does
  nothing.</p>

  <p>A report shows one customer's data under another customer's name. It is intermittent, it
  only happens under load, and it cannot be reproduced. The class involved has a single
  <code>static</code> field holding "the current tenant".</p>

  <p>All three come from things a class does that are not written in the source: <strong>the
  order in which an object is built</strong>, <strong>when a type's static setup runs and what
  happens if it fails</strong>, and <strong>who shares what</strong>. This module is about the
  parts of object construction and lifetime that are invisible until they break.</p>
</section>

<section id="what-a-class-is">
  <h2>What a class actually is</h2>

  <p>Every term is defined before it is used again.</p>

  <p class="define"><span class="define__term">Class</span> A description of a kind of thing: the
  data it holds and the operations it supports. It is a blueprint, not a thing — declaring a
  class creates nothing at run time.</p>

  <p class="define"><span class="define__term">Object</span> One actual thing built from a class,
  living in memory. Also called an <strong>instance</strong>. One class, any number of
  objects.</p>

  <p class="define"><span class="define__term">Field</span> A variable that belongs to an object,
  holding part of its state.</p>

  <p class="define"><span class="define__term">Property</span> A member that looks like a field
  from outside but is really a pair of methods — a getter and, optionally, a setter. Covered
  properly in <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a>; used here
  because it is the normal way to expose state.</p>

  <p class="define"><span class="define__term">Constructor</span> A special method that runs when
  an object is created, to put it into a valid starting state. It has the class's name and no
  return type.</p>

  <p class="define"><span class="define__term">this</span> Inside an instance member, a reference
  to the object the member was called on.</p>

  <p class="define"><span class="define__term">static</span> Belonging to the class rather than
  to any object. There is exactly one copy, shared by everything.</p>

  <div class="callout callout--note">
    <h4>The analogy, and where it breaks</h4>
    <p>A class is an <strong>architect's drawing</strong>; an object is a house built from it.
    The drawing says every house has a front door and an address. Each house has its
    <em>own</em> address, and painting one house's door does not touch any other.</p>
    <p>Where the analogy breaks, in two ways that matter. First, <code>static</code> members are
    not on the drawing at all — they are more like the street the houses share, and changing the
    street changes it for everybody. That is the third incident above.</p>
    <p>Second, a house is built bottom-up and nobody moves in until it is finished. An object's
    construction is <em>observable while it is happening</em>: code can run against a
    half-built object, see fields that have not been assigned yet, and behave differently from
    how it behaves a microsecond later. That is the first incident, and it has no equivalent in
    the analogy at all.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>One blueprint, many objects</h2>

<pre data-lang="csharp" data-net="10" data-title="01-classes-and-instances.cs"><code>sealed class Invoice
{
    // Static: one copy for the whole class, shared by every object.
    private static int _created;

    // Instance fields: one copy per object.
    private readonly List&lt;decimal&gt; _lines = new List&lt;decimal&gt;();

    public Invoice(string reference, decimal openingAmount)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reference);

        Reference = reference;
        OpeningAmount = openingAmount;
        _created++;
    }

    // Chains to the constructor above rather than duplicating its logic.
    public Invoice(string reference) : this(reference, 0m)
    {
    }

    public static int Created =&gt; _created;

    public string Reference { get; }
    public decimal OpeningAmount { get; }
    public string? Note { get; set; }

    public decimal Total
    {
        get
        {
            decimal total = OpeningAmount;
            foreach (decimal line in _lines)
            {
                total += line;
            }
            return total;
        }
    }

    public void AddLine(decimal amount) =&gt; _lines.Add(amount);

    public override string ToString() =&gt;
        $"{Reference} total={Total.ToString("0.00", CultureInfo.InvariantCulture)} lines={_lines.Count}";
}</code></pre>

<pre data-lang="console" data-title="Output"><code>1. one blueprint, three independent objects
   a: INV-1 total=125.00 lines=2
   b: INV-2 total=255.00 lines=1
   c: INV-3 total=75.00 lines=0

2. static state belongs to the CLASS, not to any object
   Invoice.Created = 3   (three objects made it 3)

3. two objects with identical contents are still two objects
   a.Reference == d.Reference : True
   a == d                     : False
   ReferenceEquals(a, d)      : False</code></pre>

  <p>Three objects, three independent <code>_lines</code> lists, one shared
  <code>_created</code> counter. And two invoices with the same reference are still two
  invoices — reference types compare by identity, as established in
  <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a>.</p>

  <p class="define"><span class="define__term">Constructor chaining</span> One constructor calling
  another on the same class with <code>: this(...)</code>, so validation and setup live in one
  place. The chained-to constructor runs first, then the body of the one you called.</p>

  <p>Prefer chaining to copy-pasting. A validation rule that exists in two constructors will
  eventually exist in one.</p>

  <p class="define"><span class="define__term">Object initialiser</span> The
  <code>{ Property = value }</code> syntax after <code>new</code>. It is shorthand for assigning
  those properties, and it runs <strong>after</strong> the constructor has finished — a detail
  the next section shows is load-bearing.</p>

  <p class="define"><span class="define__term">required member</span> A property marked
  <code>required</code>, which the compiler forces every caller to set.</p>

<pre data-lang="csharp" data-net="10" data-title="01-classes-and-instances.cs"><code>sealed class Customer
{
    public required string Name { get; init; }
    public required string CountryCode { get; init; }
}

Customer customer = new Customer { Name = "Acme Ltd", CountryCode = "GB" };</code></pre>

<pre data-lang="console" data-title="Omitting one is a compile error"><code>error CS9035: Required member 'Customer.CountryCode' must be set in the object initializer or attribute constructor.</code></pre>

  <p class="define"><span class="define__term">init accessor</span> A setter that may only be
  used during object creation — in an object initialiser or a constructor — and never
  afterwards. <code>required</code> plus <code>init</code> gives you "must be supplied, cannot
  later change" without writing a constructor.</p>
</section>

<section id="initialisation-order">
  <h2>The order an object is built in</h2>

  <p>This is the part that is not written anywhere in your source, and the part that produces the
  first incident. The only reliable way to learn it is to watch it happen.</p>

  <p class="define"><span class="define__term">Field initialiser</span> A value assigned to a
  field at its declaration — <code>private readonly List&lt;decimal&gt; _lines = new();</code>.
  It runs as part of construction, not at declaration time.</p>

  <p>Two more terms are needed, borrowed from
  <a href="#/m/t1-10-inheritance">Inheritance</a>, which owns them properly. A class can be
  built <strong>on top of</strong> another: the one underneath is the <strong>base</strong>
  class, the one on top is the <strong>derived</strong> class, and the derived class inherits
  everything the base has.</p>

<pre data-lang="csharp" data-net="10" data-title="02-initialisation-order.cs"><code>class Base
{
    private readonly string _baseField = Log.Trace("2. base field initialiser");

    public Base()
    {
        Log.Trace("3. base constructor body");
    }
}

class Derived : Base
{
    private readonly string _derivedField = Log.Trace("1. derived field initialiser");

    public Derived(int value)
    {
        Log.Trace("4. derived constructor body");
        Log.Trace($"   (Label is currently: {Label ?? "null"})");
    }

    public string? Label { get; set; }
}

Derived d = new Derived(42) { Label = "set by object initialiser" };</code></pre>

<pre data-lang="console" data-title="Output"><code>1. derived field initialiser
2. base field initialiser
3. base constructor body
   (base can see its own field: True)
4. derived constructor body
   (value parameter = 42)
   (Label is currently: null)

final Label = set by object initialiser</code></pre>

  <p>Read that order carefully, because two things in it are counter-intuitive.</p>

  <p><strong>The derived field initialisers run first — before the base class exists at
  all.</strong> C# runs a class's own field initialisers, then hands control to the base
  constructor. That is the opposite of what "build the foundation first" would suggest, and it is
  why field initialisers cannot use anything from the base class.</p>

  <p><strong>The object initialiser runs last.</strong> Inside the constructor, <code>Label</code>
  is still <code>null</code>. Any validation you write in a constructor cannot see values that
  arrive through an object initialiser.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha: a constructor cannot validate object-initialiser values</h4>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public Invoice(string reference)
{
    Reference = reference;

    // Always throws: Currency has not been set yet, whatever the caller wrote.
    if (string.IsNullOrEmpty(Currency))
    {
        throw new ArgumentException("Currency is required.");
    }
}

public string? Currency { get; set; }

// The caller looks like it supplies one:
Invoice invoice = new Invoice("INV-1") { Currency = "GBP" };</code></pre>
    <p>If a value is genuinely required, make it a constructor parameter or mark it
    <code>required</code>. Both are enforced by the compiler; a constructor check on an
    object-initialiser property is enforced by nothing and fires at the wrong time.</p>
  </div>
</section>

<section id="virtual-in-constructor">
  <h2>The bug that only appears when someone inherits</h2>

  <p>This is the first incident, and it follows directly from the order above.</p>

  <p>A method can be marked <code>virtual</code> or <code>abstract</code>, meaning a derived class
  may replace it. When it does, calling that method always runs the derived version — even from
  inside the base constructor, when the derived object is only half built.
  <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a> covers the mechanism;
  what matters here is the timing.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="03-virtual-call-in-constructor.cs"><code>abstract class BrokenInvoiceBase
{
    protected BrokenInvoiceBase(string reference)
    {
        Reference = reference;

        // DANGEROUS: this runs the DERIVED override, before the derived
        // constructor body and before its fields are assigned.
        Description = Describe();
    }

    public string Reference { get; }
    public string Description { get; }

    protected abstract string Describe();
}

sealed class BrokenAuditedInvoice : BrokenInvoiceBase
{
    private readonly string _auditTag;

    public BrokenAuditedInvoice(string reference, decimal amount)
        : base(reference)
    {
        // Far too late: base(reference) has already called Describe().
        _auditTag = $"audited-{amount}";
    }

    // Called while _auditTag is still null.
    protected override string Describe() =&gt; _auditTag.ToUpperInvariant();
}</code></pre>

<pre data-lang="console" data-title="Output"><code>The broken version:
  base constructor is about to call Describe()
  threw NullReferenceException from inside the constructor</code></pre>

  <p>Trace it against the order established above: the derived field initialisers run (there are
  none with values here), then <code>base(reference)</code> runs, and the base constructor calls
  <code>Describe()</code>. Because <code>Describe</code> is overridden, the derived version
  executes — and <code>_auditTag</code> is not assigned until the derived constructor body, which
  has not started yet.</p>

  <p>Every part of this is correct in isolation. The base class is reasonable, the derived class
  is reasonable, and the bug exists only in their combination. The base author may never see it,
  because it needs somebody else to inherit.</p>

  <p>The fix is not to be careful about ordering. It is to <strong>not call overridable members
  during construction at all</strong>:</p>

<pre data-lang="csharp" data-net="10" data-title="03-virtual-call-in-constructor.cs — the fix"><code>abstract class FixedInvoiceBase
{
    protected FixedInvoiceBase(string reference)
    {
        Reference = reference;
        // No overridable call here. The object is simply built.
    }

    public string Reference { get; }

    // Called on demand, after construction is complete.
    public abstract string Describe();
}</code></pre>

<pre data-lang="console" data-title="Output"><code>The fixed version (no overridable call during construction):
  built: INV-1
  audit: AUDITED-144.00</code></pre>

  <p>Compute the value lazily when it is asked for, or pass it in as a constructor parameter so
  the derived class supplies it before <code>base(...)</code> runs. Analysers flag this pattern
  as CA2214, and it is worth turning that on.</p>
</section>

<section id="static-construction">
  <h2>Static members and the constructor that runs once</h2>

  <p class="define"><span class="define__term">Static constructor</span> A parameterless
  constructor marked <code>static</code>, which the runtime runs <strong>once per process</strong>,
  automatically, immediately before the type is first used.</p>

  <p>You never call it. You cannot control when it happens beyond "before the first use". The
  runtime guarantees it runs exactly once even if a hundred threads race to use the type — with
  no lock written by you:</p>

<pre data-lang="console" data-title="dotnet run 04-static-constructors.cs"><code>1. a static constructor runs LAZILY, on first use
   (nothing has touched Settings yet)
   about to read Settings.Timeout...
   &gt;&gt; Settings static constructor running
   Settings.Timeout = 00:00:30
   reading it again = 00:00:30   (constructor did not run twice)

2. it runs exactly once, even from many threads
   Counter static constructor ran 1 time(s)</code></pre>

  <p>That guarantee is genuinely useful — it is the simplest correct way to initialise something
  expensive exactly once. And it comes with a failure mode that is worse than anything else in
  this module.</p>

  <h3>A static constructor that fails kills the type</h3>

  <p>This is the second incident.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="04-static-constructors.cs"><code>static class BadConfig
{
    static BadConfig()
    {
        string? raw = Environment.GetEnvironmentVariable("LEDGER_CONNECTION_STRING");

        if (string.IsNullOrWhiteSpace(raw))
        {
            throw new InvalidOperationException("LEDGER_CONNECTION_STRING is not set.");
        }

        ConnectionString = raw;
    }

    public static string ConnectionString { get; } = string.Empty;
}</code></pre>

<pre data-lang="console" data-title="Output"><code>3. a static constructor that THROWS poisons the type PERMANENTLY
   (LEDGER_CONNECTION_STRING is deliberately not set)

   first use: TypeInitializationException
      inner -&gt; InvalidOperationException: LEDGER_CONNECTION_STRING is not set.

   now FIXING the cause at run time and trying again:
   after fixing the environment variable: TypeInitializationException
      inner -&gt; InvalidOperationException: LEDGER_CONNECTION_STRING is not set.
   and again: TypeInitializationException
      inner -&gt; InvalidOperationException: LEDGER_CONNECTION_STRING is not set.</code></pre>

  <p>Read the middle section again. The environment variable <strong>was set</strong> before the
  second attempt. The static constructor is <strong>never retried</strong> — the runtime records
  that the type failed to initialise and replays that failure for every subsequent use, for the
  life of the process.</p>

  <p class="define"><span class="define__term">TypeInitializationException</span> The exception
  the runtime throws when a static constructor fails. The real cause is always in its
  <code>InnerException</code>; the outer message tells you only which type died.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>This is why the second incident looked impossible. The service started before the
    configuration was fully available, something touched the config class once, and from that
    moment every request that reached it failed — with an error naming a variable that was, by
    then, present. No amount of reloading configuration helps. Only a restart clears it.</p>
    <p>Three consequences worth carrying:</p>
    <ul>
      <li><strong>Never do anything that can fail in a static constructor.</strong> No file
      reads, no environment lookups that might be missing, no network calls, no parsing of
      external input. Static initialisation should be arithmetic and object creation, nothing
      more.</li>
      <li><strong>Read <code>InnerException</code> first.</strong> A
      <code>TypeInitializationException</code> on its own tells you almost nothing.</li>
      <li><strong>Fail at startup instead.</strong> Validate configuration explicitly during
      start-up, where a failure stops the process immediately and visibly, rather than lazily on
      first use, where it produces a half-alive service. This is what the options pattern in
      <a href="#/m/t3-13-options-pattern">The Options Pattern</a> exists to do.</li>
    </ul>
  </div>

  <div class="callout callout--gotcha">
    <h4>Gotcha: shared mutable static state</h4>
    <p>The third incident. A field like this looks convenient:</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public static class TenantContext
{
    public static string? CurrentTenant { get; set; }
}</code></pre>
    <p>There is <strong>one</strong> of these for the whole process. A web server handles many
    requests concurrently on many threads, so request A sets the tenant, request B overwrites it,
    and request A then reads request B's tenant and renders one customer's data under another's
    name. It is intermittent, load-dependent, and unreproducible on a developer machine serving
    one request at a time.</p>
    <p><code>static</code> is safe for values that never change — a lookup table, a compiled
    regular expression, a configured client. It is dangerous the moment it is
    <em>mutable</em> and per-request. Pass the value as a parameter, or use the dependency
    injection scope covered in
    <a href="#/m/t3-11-di-lifetimes">DI Lifetimes and the Bugs They Cause</a>.</p>
  </div>
</section>

<section id="lifetime">
  <h2>Object lifetime</h2>

  <p>An object is created by <code>new</code>, which reserves memory on the heap, zeroes it, runs
  the initialisers and constructors, and hands back a reference. What ends its life is less
  obvious.</p>

  <p class="define"><span class="define__term">Reachability</span> Whether an object can still be
  reached by following references from somewhere the program is definitely using — a local
  variable, a static field, an active method's parameters. The garbage collector reclaims exactly
  the objects that cannot.</p>

  <p>Scope has nothing to do with it. An object referenced by a static field lives forever; an
  object created and dropped inside a method is eligible for collection the moment nothing points
  at it.</p>

<pre data-lang="console" data-title="dotnet run -c Release 05-object-lifetime.cs"><code>1. what an empty object costs
   new object()          :  24 bytes
   class with one int    :  24 bytes
   class with four longs :  48 bytes

2. an object lives while it is REACHABLE, not while it is 'in scope'
   a fresh object starts in generation 0
   after one collection, a referenced object is in generation 1
   after two, generation 2</code></pre>

  <p>An object with no fields at all costs <strong>24 bytes</strong>: a 16-byte header plus
  padding. A class with one <code>int</code> costs the same, because the header dominates. This
  is the same accounting as boxing in
  <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a>, and it is why
  millions of tiny objects are expensive out of proportion to the data they hold.</p>

  <p>Surviving a collection promotes an object to an older generation. Generation 2 is collected
  rarely and expensively, so an object that lives a long time is cheap to keep and costly to
  collect — the trade explored in
  <a href="#/m/t2-16-gc-fundamentals">Garbage Collection Fundamentals</a>.</p>

  <h3>Finalisers</h3>

  <p class="define"><span class="define__term">Finaliser</span> A method written
  <code>~ClassName()</code> that the runtime calls before reclaiming an object. You do not
  control when, or whether, it runs.</p>

<pre data-lang="console" data-title="Output"><code>3. finalisers run at an unpredictable time, or not at all
   creating 3 objects with finalisers and dropping them...
   finalised so far: 0   (probably 0 - nothing has collected yet)
   after GC.Collect() + WaitForPendingFinalizers: 3</code></pre>

  <p>Note that it took <em>two</em> steps. A finaliser does not run during the collection that
  finds the object unreachable; the object is put on a queue and finalised later, on a separate
  thread. So <strong>a finalisable object survives at least one extra collection</strong> and
  gets promoted a generation in the process. Adding a finaliser makes an object measurably more
  expensive to allocate and collect.</p>

  <p>Finalisers exist for one narrow purpose: releasing unmanaged resources — a file handle, a
  socket, memory allocated outside the runtime — when the programmer forgot to. They are a
  safety net, never a plan. Deterministic cleanup is <code>IDisposable</code> and
  <code>using</code>, covered in
  <a href="#/m/t2-18-finalisers-and-idisposable">IDisposable, IAsyncDisposable, and Finalisers</a>.
  <strong>If your class holds only managed objects, it should have no finaliser.</strong></p>

<pre data-lang="console" data-title="Output"><code>4. an object dies when it becomes UNREACHABLE, not when you drop it
   immediately after the method returned : IsAlive = True
   after GC.Collect()                    : IsAlive = False</code></pre>

  <p>Reachability decides eligibility; the collector decides timing. Setting a variable to
  <code>null</code> does not free anything — it only removes one reference, which may or may not
  have been the last one.</p>

  <p class="define"><span class="define__term">NullReferenceException</span> What you get when
  you use a reference that points at nothing. The message —
  <code>Object reference not set to an instance of an object</code> — names neither the variable
  nor the member, which is why nullable reference types exist to catch it at compile time
  instead. See <a href="#/m/t1-28-nullable-reference-types">Nullable Reference Types</a>.</p>
</section>

<section id="production-example">
  <h2>The same ideas in a real service</h2>

  <p>A Ledger settlement batch, with every construction decision made deliberately.</p>

<pre data-lang="csharp" data-net="10" data-title="Ledger — SettlementBatch.cs"><code>using System.Globalization;

public sealed class SettlementBatch
{
    // Field initialiser: runs before the constructor body, every time.
    private readonly List&lt;SettlementLine&gt; _lines = new List&lt;SettlementLine&gt;();

    // Static and immutable, so sharing it is safe. Compiled once, used by all.
    private static readonly TimeSpan DefaultWindow = TimeSpan.FromHours(24);

    /// &lt;summary&gt;
    /// The only real constructor. Everything else chains to it, so validation
    /// exists in exactly one place.
    /// &lt;/summary&gt;
    public SettlementBatch(string batchId, DateTimeOffset openedAt, TimeSpan window)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(batchId);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(window, TimeSpan.Zero);

        BatchId = batchId;
        OpenedAt = openedAt;
        Window = window;

        // No overridable call here, and the class is sealed so there can
        // never be a derived type to surprise us.
    }

    public SettlementBatch(string batchId, DateTimeOffset openedAt)
        : this(batchId, openedAt, DefaultWindow)
    {
    }

    public string BatchId { get; }
    public DateTimeOffset OpenedAt { get; }
    public TimeSpan Window { get; }

    public DateTimeOffset ClosesAt =&gt; OpenedAt + Window;

    // Read-only to callers: they cannot add lines behind the class's back.
    public IReadOnlyList&lt;SettlementLine&gt; Lines =&gt; _lines;

    public bool IsClosed(DateTimeOffset now) =&gt; now &gt;= ClosesAt;

    public void Add(SettlementLine line, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(line);

        if (IsClosed(now))
        {
            throw new InvalidOperationException(
                $"Batch {BatchId} closed at {ClosesAt:O} and cannot accept new lines.");
        }

        _lines.Add(line);
    }

    public decimal Total()
    {
        decimal total = 0m;
        foreach (SettlementLine line in _lines)
        {
            total += line.Amount;
        }
        return total;
    }

    public override string ToString() =&gt;
        $"{BatchId}: {_lines.Count} lines, {Total().ToString("0.00", CultureInfo.InvariantCulture)}";
}

/// &lt;summary&gt;
/// required + init: every caller must supply both, and neither can change
/// afterwards. No constructor needed, and no half-built instance possible.
/// &lt;/summary&gt;
public sealed class SettlementLine
{
    public required string Reference { get; init; }
    public required decimal Amount { get; init; }
    public string? Note { get; init; }
}</code></pre>

  <p>Six decisions, each from a section above:</p>

  <ul>
    <li><strong><code>sealed</code>.</strong> Nobody can inherit, so the virtual-call-in-
    constructor bug cannot arise. Sealing by default and unsealing deliberately is the safer
    order.</li>
    <li><strong>One real constructor, others chain to it.</strong> The validation exists once.</li>
    <li><strong><code>required</code> + <code>init</code> on <code>SettlementLine</code></strong>
    rather than a constructor check, because the compiler enforces it and an object-initialiser
    value is invisible to a constructor.</li>
    <li><strong>Static state is <code>readonly</code> and immutable.</strong>
    <code>DefaultWindow</code> is shared safely because nothing can change it.</li>
    <li><strong>No static constructor at all.</strong> A field initialiser on a
    <code>static readonly</code> field is enough, and it cannot fail in a way that poisons the
    type.</li>
    <li><strong><code>IReadOnlyList</code> for <code>Lines</code>,</strong> so callers cannot add
    lines without going through <code>Add</code> and its closed-batch check.</li>
  </ul>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Calling an overridable member from a constructor</h3>

  <p>Demonstrated above: <code>NullReferenceException</code> from inside a constructor, appearing
  only when someone inherits. The base class author will not see it. Enable CA2214 and seal
  classes you do not intend to be extended.</p>

  <h3>2. Validating object-initialiser values in a constructor</h3>

  <p>The constructor runs first, so the property is still <code>null</code>. The check either
  always fails or is silently useless. Use a constructor parameter or
  <code>required</code>.</p>

  <h3>3. A static constructor that can fail</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>static class Config
{
    static Config()
    {
        Settings = JsonSerializer.Deserialize&lt;Settings&gt;(File.ReadAllText("config.json"))!;
    }

    public static Settings Settings { get; }
}</code></pre>

  <p>A missing or malformed file kills the type for the process lifetime. Every later use throws
  <code>TypeInitializationException</code>, and fixing the file changes nothing until a
  restart.</p>

  <h3>4. Mutable static state in a concurrent application</h3>

  <p>One copy shared by every request on every thread. Produces intermittent, load-dependent
  cross-contamination that does not reproduce locally.</p>

  <h3>5. Exposing internal collections</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>public List&lt;SettlementLine&gt; Lines =&gt; _lines;   // caller can Add, Clear, or Remove</code></pre>

  <p><code>readonly</code> on the field prevents replacing the list, not modifying it — the same
  trap as arrays in <a href="#/m/t1-06-arrays">Arrays</a>. Return
  <code>IReadOnlyList&lt;T&gt;</code>.</p>

  <div class="callout callout--note">
    <h4>Note: <code>IReadOnlyList</code> is a compile-time contract, not a runtime guarantee</h4>
<pre data-lang="console" data-title="Output"><code>Rows static type  : IReadOnlyList&lt;string&gt;
Rows runtime type : List&#96;1  &lt;-- still the List; the guarantee is compile-time only</code></pre>
    <p>It is the same object. A determined caller can cast back to
    <code>List&lt;string&gt;</code> and modify it. That is fine for its purpose — stopping
    accidental misuse and stating intent — but if you need a real guarantee, return a copy or an
    <code>ImmutableArray&lt;T&gt;</code>.</p>
  </div>

  <h3>6. Adding a finaliser to a class that does not need one</h3>

  <p>Costs an extra collection cycle and a generation promotion for every instance, in exchange
  for nothing. Only unmanaged resources justify one.</p>

  <h3>7. Relying on field initialiser order across classes</h3>

  <p>Derived field initialisers run <em>before</em> the base constructor, so a field initialiser
  cannot use anything the base class sets up. Assign in the constructor body instead, where the
  base has finished.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>Symptom: <code>NullReferenceException</code> on a field that is clearly assigned</h4>
    <ol>
      <li><strong>Check whether the stack trace is inside a constructor.</strong> If the throwing
      frame is a constructor — or a method called from one — the object is half built and the
      field genuinely is null at that moment.</li>
      <li><strong>Look for an overridable member called during construction.</strong> Anything
      <code>virtual</code>, <code>abstract</code>, or an event raised from a constructor runs the
      derived version before the derived constructor body.</li>
      <li><strong>Confirm with the initialisation order:</strong> derived field initialisers,
      base field initialisers, base constructor body, derived constructor body, object
      initialiser. Write the order down against the actual classes; the gap becomes obvious.</li>
      <li><strong>Fix by removing the call from construction</strong> — compute lazily, or take
      the value as a constructor parameter. Then enable CA2214 so it cannot come back.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: <code>TypeInitializationException</code>, and restarting fixes it</h4>
    <ol>
      <li><strong>Read <code>InnerException</code>.</strong> The outer exception names only the
      type that failed. The real cause — a missing file, a bad connection string, a null
      configuration value — is always inside.</li>
      <li><strong>Find the first occurrence in the logs, not the loudest.</strong> Later
      occurrences are replays of a cached failure. The first one is the only one that happened
      at the moment the cause was real, and the timestamp tells you what the environment looked
      like then.</li>
      <li><strong>Look for work in a static constructor or a <code>static readonly</code> field
      initialiser</strong> on the named type: file access, environment variables, deserialisation,
      network calls.</li>
      <li><strong>Fix by moving that work to explicit start-up validation,</strong> where a
      failure stops the process visibly rather than poisoning a type lazily. Prefer configuration
      validated at start-up over a static class that reads its own settings.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: data from one request appearing in another, only under load</h4>
    <ol>
      <li><strong>Search for <code>static</code> fields and properties with setters.</strong> A
      <code>static</code> that is written at run time is shared by every concurrent request.
      <code>static readonly</code> pointing at an immutable value is fine;
      <code>static</code> with a setter is the suspect.</li>
      <li><strong>Check singletons for per-request state.</strong> A service registered as a
      singleton that stores "the current user" has the same problem without the
      <code>static</code> keyword — see
      <a href="#/m/t3-11-di-lifetimes">DI Lifetimes and the Bugs They Cause</a>.</li>
      <li><strong>Reproduce with concurrency, not repetition.</strong> Running the same request a
      thousand times sequentially will never show it. Two concurrent requests with different data
      usually will.</li>
      <li><strong>Fix by passing the value explicitly</strong> through the call chain, or by
      scoping it to the request. Mutable static state has no safe fix other than removing
      it.</li>
    </ol>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's payments API reads its database connection string from a static configuration
    class. It had worked for eighteen months. During one deployment, the platform team changed
    how secrets were injected: instead of being present when the container started, the
    environment variable arrived a few hundred milliseconds later, once a sidecar had fetched it
    from the vault.</p>
    <p>Most instances were unaffected. Roughly <strong>one in six</strong> received a health-check
    probe during that window. The probe touched the configuration class, its static constructor
    ran, found no environment variable, and threw.</p>
    <p>From that moment those instances were <strong>permanently broken</strong>, exactly as
    measured in this module:</p>
<pre data-lang="console"><code>first use: TypeInitializationException
   inner -&gt; InvalidOperationException: LEDGER_CONNECTION_STRING is not set.

now FIXING the cause at run time and trying again:
after fixing the environment variable: TypeInitializationException
   inner -&gt; InvalidOperationException: LEDGER_CONNECTION_STRING is not set.</code></pre>
    <p>The variable arrived a fraction of a second later. It made no difference: the static
    constructor is never retried.</p>
    <p>What made this expensive was the diagnostic picture. The affected instances
    <strong>passed their liveness probe</strong>, because that endpoint did not touch the
    configuration class — so the orchestrator never restarted them. They failed every real
    request. With <strong>18 instances</strong> behind a load balancer and 3 poisoned, roughly
    <strong>17% of traffic</strong> returned 500s for <strong>four hours</strong>, while the
    dashboard showed 18 healthy instances and the error message named an environment variable
    that was demonstrably present on every one of them.</p>
    <p>Three changes came out of it, in order of value:</p>
    <ul>
      <li><strong>Configuration validated explicitly at start-up</strong>, not lazily in a static
      constructor. A missing value now stops the process before it reports ready, so the
      orchestrator replaces it instead of routing traffic to it.</li>
      <li><strong>The readiness probe exercises a real dependency</strong>, so an instance that
      cannot serve requests stops claiming it can.</li>
      <li><strong>No work that can fail in any static constructor.</strong> Enforced by review,
      because there is no analyser for it.</li>
    </ul>
    <p>The general lesson is about <em>where</em> failure happens. A static constructor turns a
    transient, recoverable condition into a permanent one, at an unpredictable moment, in a way
    that survives every fix short of a restart. That is the worst combination of properties a
    failure can have, and it is the default behaviour of a language feature that looks like a
    convenience.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Field initialisers run when the field is declared, before anything else."</strong></p>
    <p>They run as part of construction, and specifically: <em>derived</em> field initialisers
    run first, then base field initialisers, then the base constructor body, then the derived
    constructor body. A derived field initialiser cannot use anything the base class sets up,
    because the base constructor has not run yet.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"An object initialiser is part of the constructor call."</strong></p>
    <p>It runs afterwards, as a sequence of property assignments. Measured above: inside the
    constructor, a property set by an object initialiser is still <code>null</code>. Validation
    in a constructor cannot see those values, which is what <code>required</code> is for.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A static constructor is a good place to load configuration."</strong></p>
    <p>It is one of the worst. It runs at an unpredictable moment, and if it throws, the type is
    dead for the life of the process — demonstrated above surviving a fix to the underlying
    cause. Validate configuration at start-up where failure is visible and the process can be
    replaced.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Setting a reference to <code>null</code> frees the memory."</strong></p>
    <p>It removes one reference. The object is reclaimed when the collector next runs and finds
    it unreachable — measured above as still alive immediately after the reference was dropped,
    and gone only after a collection. Assigning <code>null</code> to a local before it goes out
    of scope achieves nothing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>Adding a finaliser "to be safe".</strong></p>
    <p>It makes every instance survive an extra collection and get promoted a generation, for no
    benefit unless the class owns an unmanaged resource. If your class holds only managed
    objects, it needs no finaliser and probably no <code>IDisposable</code> either.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>Leaving classes unsealed by default.</strong></p>
    <p>An unsealed class is a promise that inheriting from it works, which means every
    constructor, every virtual member, and every protected field is part of your contract. The
    virtual-call bug above only exists because inheritance was possible. Seal by default and
    unseal deliberately; it also lets the JIT devirtualise calls.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Situation</th><th>Use</th><th>Because</th></tr></thead>
      <tbody>
        <tr><td>A value every caller must supply</td><td>Constructor parameter, or <code>required</code></td><td>Both are enforced by the compiler. A constructor check on an object-initialiser property is not.</td></tr>
        <tr><td>A value set once and never changed</td><td><code>init</code> accessor</td><td>Settable during creation, read-only afterwards, no constructor needed.</td></tr>
        <tr><td>Several constructors</td><td>Chain with <code>: this(...)</code></td><td>Validation lives in one place instead of drifting apart.</td></tr>
        <tr><td>A value shared by all instances that never changes</td><td><code>static readonly</code></td><td>Safe to share, no synchronisation needed.</td></tr>
        <tr><td>Expensive one-time setup that cannot fail</td><td>Static field initialiser</td><td>Runs once, thread-safely, with no lock from you.</td></tr>
        <tr><td>One-time setup that <em>can</em> fail</td><td>Explicit start-up validation</td><td>A static constructor turns a transient failure into a permanent one.</td></tr>
        <tr><td>Per-request state</td><td>A parameter, or a scoped service</td><td>Mutable <code>static</code> is shared across concurrent requests.</td></tr>
        <tr><td>Exposing a collection</td><td><code>IReadOnlyList&lt;T&gt;</code></td><td>Returning the list itself hands out <code>Add</code> and <code>Clear</code>.</td></tr>
        <tr><td>A class you do not intend to be extended</td><td><code>sealed</code></td><td>Removes a whole bug class, and helps the JIT.</td></tr>
        <tr><td>Cleanup of managed objects</td><td>Nothing</td><td>The collector handles it. A finaliser costs an extra collection for no gain.</td></tr>
        <tr><td>Cleanup of an unmanaged resource</td><td><code>IDisposable</code>, plus a finaliser as a net</td><td>See <a href="#/m/t2-18-finalisers-and-idisposable">IDisposable and Finalisers</a>.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Predict the exact order of the printed lines, and the final value of <code>Label</code>.</p>
<pre data-lang="csharp" data-net="10"><code>class Base
{
    private readonly string _b = Log.Trace("A");
    public Base() =&gt; Log.Trace("B");
}

class Derived : Base
{
    private readonly string _d = Log.Trace("C");
    public Derived() =&gt; Log.Trace($"D (Label={Label ?? "null"})");
    public string? Label { get; set; }
}

Derived d = new Derived { Label = "E" };
Console.WriteLine($"final Label = {d.Label}");</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>The output is <strong>C, A, B, D (Label=null)</strong>, then
        <code>final Label = E</code>.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Step</th><th>What runs</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>C</td><td>Derived field initialiser</td><td>A class runs its own field initialisers before handing control to the base.</td></tr>
              <tr><td>A</td><td>Base field initialiser</td><td>Then the base's, immediately before its constructor body.</td></tr>
              <tr><td>B</td><td>Base constructor body</td><td>The base is now fully built.</td></tr>
              <tr><td>D</td><td>Derived constructor body</td><td><code>Label</code> is still <code>null</code> — the object initialiser has not run.</td></tr>
              <tr><td>E</td><td>Object initialiser</td><td>Property assignments, after the constructor returns.</td></tr>
            </tbody>
          </table>
        </div>
        <p>The two surprising parts are that <strong>C comes before A</strong> — derived
        initialisers precede the base entirely — and that <strong>D sees
        <code>Label</code> as null</strong> even though the caller wrote
        <code>{ Label = "E" }</code> on the same line as <code>new</code>.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This class is used by a web API handling concurrent requests. It contains five problems
    from this module. Find them, say what each causes, and rewrite it.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public class ReportBuilder
{
    public static string? CurrentTenant { get; set; }

    private static readonly string Template =
        File.ReadAllText("templates/report.html");

    private readonly List&lt;string&gt; _rows = new List&lt;string&gt;();

    public string? Title { get; set; }

    public ReportBuilder()
    {
        if (string.IsNullOrEmpty(Title))
        {
            throw new ArgumentException("Title is required.");
        }

        Header = BuildHeader();
    }

    protected virtual string BuildHeader() =&gt; $"{CurrentTenant}: {Title}";

    public string Header { get; }

    public List&lt;string&gt; Rows =&gt; _rows;

    ~ReportBuilder()
    {
        _rows.Clear();
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>1. <code>static CurrentTenant</code> with a setter.</strong> One copy for the
        whole process. Concurrent requests overwrite each other's tenant, producing one
        customer's data under another's name — intermittent, load-dependent, and not reproducible
        locally. This is the worst bug in the class.</p>

        <p><strong>2. <code>File.ReadAllText</code> in a static field initialiser.</strong> Static
        field initialisers run as part of type initialisation, so a missing or unreadable file
        throws <code>TypeInitializationException</code> and <strong>kills the type for the life of
        the process</strong>. Deploying the template afterwards does not help; only a restart
        does.</p>

        <p><strong>3. The constructor validates <code>Title</code>, which is set by an object
        initialiser.</strong> The constructor runs first, so <code>Title</code> is always
        <code>null</code> there. This check throws for every caller, including correct ones.</p>

        <p><strong>4. <code>BuildHeader()</code> is <code>virtual</code> and called from the
        constructor.</strong> Any derived class's override runs before its own fields are
        assigned — the <code>NullReferenceException</code>-from-a-constructor bug.</p>

        <p><strong>5. A finaliser that clears a managed list.</strong> Pointless: the list is
        managed and will be collected anyway. Worse than pointless — it makes every instance
        survive an extra collection and get promoted a generation.</p>

        <p>Also: <code>Rows</code> returns the mutable <code>List&lt;string&gt;</code>, so callers
        can add and clear rows without going through the class.</p>

        <p>The rewrite:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>public sealed class ReportBuilder
{
    private readonly List&lt;string&gt; _rows = new List&lt;string&gt;();
    private readonly string _template;

    /// &lt;summary&gt;
    /// Everything required arrives through the constructor: the tenant is a
    /// parameter rather than shared state, and the template is injected rather
    /// than read from disk during type initialisation.
    /// &lt;/summary&gt;
    public ReportBuilder(string tenant, string title, string template)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tenant);
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        ArgumentException.ThrowIfNullOrWhiteSpace(template);

        Tenant = tenant;
        Title = title;
        _template = template;

        // Safe: the class is sealed, so this cannot be overridden.
        Header = $"{Tenant}: {Title}";
    }

    public string Tenant { get; }
    public string Title { get; }
    public string Header { get; }

    // Read-only to callers.
    public IReadOnlyList&lt;string&gt; Rows =&gt; _rows;

    public void AddRow(string row)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(row);
        _rows.Add(row);
    }

    public string Render() =&gt; _template.Replace("{header}", Header, StringComparison.Ordinal);

    // No finaliser: this class owns no unmanaged resources.
}</code></pre>
        <p>What changed and why:</p>
        <ul>
          <li><strong>The tenant is a constructor parameter</strong>, so each request gets its
          own builder and nothing is shared.</li>
          <li><strong>The template is supplied by the caller</strong>, so reading the file happens
          somewhere it can fail safely and be retried — typically at start-up, registered in the
          container.</li>
          <li><strong>Everything required is a constructor parameter</strong>, so the compiler
          enforces it and the validation runs at a point where the values exist.</li>
          <li><strong><code>sealed</code> and no <code>virtual</code> member</strong>, so header
          construction cannot be hijacked by a half-built subclass.</li>
          <li><strong>No finaliser</strong>, and <code>IReadOnlyList</code> for the rows.</li>
        </ul>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A service returns 500s from a subset of instances after a deployment. The error is
    <code>TypeInitializationException</code>. The instances pass their health checks. Describe
    how you would diagnose this and what you would change so it cannot recur.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Diagnosing it.</strong></p>
        <ol>
          <li><strong>Read <code>InnerException</code>, not the message.</strong>
          <code>TypeInitializationException</code> only names the type that failed. The cause —
          a missing environment variable, an unreadable file, a null configuration value — is
          always wrapped inside it.</li>
          <li><strong>Find the <em>first</em> occurrence per instance.</strong> Every later one is
          a replay of a cached failure, because the static constructor is never retried. Only the
          first has a timestamp that tells you what the environment looked like when it actually
          happened. If the first occurrence is seconds after start-up and the rest are spread over
          hours, that is the signature of a start-up race.</li>
          <li><strong>Compare healthy and unhealthy instances.</strong> If the environment is
          identical on both — and it will be, by the time you look — the difference is
          <em>timing</em>, not configuration. That points at something that ran before the
          environment was ready.</li>
          <li><strong>Find the work in the named type.</strong> Look for a static constructor or a
          <code>static readonly</code> field initialiser doing anything that can fail: file
          access, environment lookups, deserialisation, network calls.</li>
          <li><strong>Explain why the health check passes.</strong> It does not touch the poisoned
          type. That is the detail that keeps traffic flowing to a dead instance, and it is a
          bug in the health check as much as in the class.</li>
        </ol>

        <p><strong>Changes, in order of value:</strong></p>
        <ol>
          <li><strong>Move the work out of type initialisation.</strong> Configuration should be
          read and validated at start-up, explicitly, where a failure can stop the process:
<pre data-lang="csharp" data-net="10" data-title="Validated at start-up"><code>builder.Services
    .AddOptions&lt;LedgerOptions&gt;()
    .Bind(builder.Configuration.GetSection("Ledger"))
    .ValidateDataAnnotations()
    .ValidateOnStart();   // fails during start-up, not lazily on first use</code></pre>
          A process that cannot configure itself should refuse to start, not start and then fail
          every request.</li>
          <li><strong>Make the readiness probe exercise a real dependency.</strong> A probe that
          only returns 200 proves the process is running, not that it can work. It should touch
          the configuration and the database, so a poisoned instance stops claiming it is
          ready and the orchestrator replaces it.</li>
          <li><strong>Ban failure-prone work in static constructors.</strong> There is no analyser
          for this, so it is a review rule. The tell is any static constructor or
          <code>static readonly</code> initialiser containing I/O.</li>
        </ol>

        <p><strong>Why the fix is not "add a retry".</strong> You cannot retry type
        initialisation. Once a static constructor has thrown, the runtime caches the failure and
        replays it for every subsequent use, as measured in this module — even after the
        underlying cause is fixed. A retry loop around the call site would spin, throwing the
        same cached exception every time. The only recovery is a new process, which is exactly
        why failing at start-up is the right design.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Write a class that loads an expensive resource exactly once, on first use, shared across
    all threads, where <strong>a failed load can be retried</strong> rather than poisoning the
    type. Explain why the three obvious approaches fail, and what your solution costs.</p>
<pre data-lang="csharp" data-net="10"><code>public sealed class ExchangeRateTable
{
    // Loading is slow and may fail (network, file, database).
    private static ExchangeRateTable Load() =&gt; throw new NotImplementedException();

    public static ExchangeRateTable Current =&gt; throw new NotImplementedException();
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Why the three obvious approaches fail.</strong></p>

        <p><strong>(a) A static constructor or static field initialiser.</strong> Thread-safe and
        exactly-once, which is why it is tempting. But a failure is permanent — measured in this
        module surviving a fix to the underlying cause. For something that can fail transiently,
        such as a network call, this converts a five-second outage into a
        restart-required outage.</p>

        <p><strong>(b) <code>Lazy&lt;T&gt;</code> with the default settings.</strong> Better, and
        genuinely thread-safe, but <code>Lazy&lt;T&gt;</code> <em>also caches exceptions</em> by
        default: once the factory throws, every subsequent <code>Value</code> access rethrows the
        same exception forever. It has the same failure mode as (a), which surprises people who
        adopt it specifically to avoid (a).</p>

        <p><strong>(c) A plain null check.</strong> Not thread-safe. Two threads can both see
        <code>null</code> and both load, which is wasteful at best and, if loading has side
        effects, wrong:</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>if (_current is null)      // two threads can both reach here
{
    _current = Load();
}
return _current;</code></pre>

        <p>Measured, to confirm (b) rather than assume it — three accesses to a factory that
        always throws:</p>
<pre data-lang="console" data-title="Output"><code>default Lazy&lt;T&gt;          : factory ran 1 time(s) over 3 accesses
Lazy&lt;T&gt; PublicationOnly  : factory ran 3 time(s) over 3 accesses</code></pre>
        <p>So <code>LazyThreadSafetyMode.PublicationOnly</code> <em>would</em> fix the retry
        problem. It introduces a different one: it allows several threads to run the factory
        concurrently and keeps whichever finishes first, so an expensive load can happen many
        times over. For a slow network call that is usually worse than waiting.</p>

        <p><strong>The solution</strong> is therefore an explicit double-checked lock, which
        retries on failure <em>and</em> loads exactly once on success.</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>public sealed class ExchangeRateTable
{
    private static readonly Lock Gate = new Lock();
    private static ExchangeRateTable? _current;

    private ExchangeRateTable(IReadOnlyDictionary&lt;string, decimal&gt; rates) =&gt; Rates = rates;

    public IReadOnlyDictionary&lt;string, decimal&gt; Rates { get; }

    public static ExchangeRateTable Current
    {
        get
        {
            // Fast path: already loaded, no lock taken.
            ExchangeRateTable? existing = Volatile.Read(ref _current);
            if (existing is not null)
            {
                return existing;
            }

            lock (Gate)
            {
                // Re-check inside the lock: another thread may have loaded it
                // while we were waiting.
                if (_current is not null)
                {
                    return _current;
                }

                // If this throws, _current stays null and the NEXT caller
                // tries again. Nothing is poisoned.
                ExchangeRateTable loaded = Load();
                Volatile.Write(ref _current, loaded);
                return loaded;
            }
        }
    }

    /// &lt;summary&gt;Forces the next access to reload. Useful for a refresh endpoint.&lt;/summary&gt;
    public static void Invalidate()
    {
        lock (Gate)
        {
            _current = null;
        }
    }

    private static ExchangeRateTable Load()
    {
        Dictionary&lt;string, decimal&gt; rates = new Dictionary&lt;string, decimal&gt;(StringComparer.Ordinal)
        {
            ["GBP"] = 1.00m,
            ["USD"] = 1.27m,
            ["EUR"] = 1.17m
        };

        return new ExchangeRateTable(rates);
    }
}</code></pre>

        <p><strong>What it costs, honestly:</strong></p>
        <ul>
          <li><strong>A volatile read on every access.</strong> On the fast path that is one
          read and one null check — cheaper than a lock, more than a plain field read. For
          something consulted per request this is nothing.</li>
          <li><strong>Concurrent first-callers block.</strong> While one thread loads, others wait
          at the lock rather than each starting their own load. That is usually what you want, but
          it means a slow load blocks every caller. If that is unacceptable, serve a stale value
          instead and refresh in the background — a different design.</li>
          <li><strong>A failed load is retried by the next caller.</strong> That is the point, but
          it also means a persistently failing dependency is retried on every request. In
          production this needs a circuit breaker in front of it —
          <a href="#/m/t5-17-circuit-breaker">Circuit Breakers, Bulkheads, Timeouts,
          Fallbacks</a>.</li>
          <li><strong>It is still mutable static state.</strong> Safe here only because the loaded
          object is immutable and the mutation is guarded. Adding a mutable field to
          <code>ExchangeRateTable</code> would reintroduce the cross-request bug from Exercise
          2.</li>
        </ul>

        <p><strong>The honest recommendation:</strong> in an application using dependency
        injection, do not write this at all. Register the table as a singleton and let the
        container handle lifetime, where a failing dependency is visible at start-up and testable
        by substitution. This pattern is for the cases where you have no container — a library,
        a static helper, a console tool — and it is worth knowing precisely because
        <code>Lazy&lt;T&gt;</code>'s default exception caching makes the obvious answer wrong.</p>

        <p><strong>Version note:</strong> <code>System.Threading.Lock</code> is .NET 9+. On .NET 8
        use a <code>private static readonly object</code> as the lock target; the behaviour is
        the same.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>In what order do derived field initialisers, base field initialisers, the base
      constructor, and the derived constructor run?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Derived field initialisers, base field initialisers, base constructor body,
        derived constructor body.</strong> A class runs its own field initialisers before handing
        control to the base, which is why a derived field initialiser cannot use anything the
        base sets up.</p>
      </div></details>
    </li>
    <li>
      <p>When does an object initialiser run?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>After the constructor has finished. Inside the constructor, a property set by an object
        initialiser is still at its default. Use a constructor parameter or <code>required</code>
        for anything that must be validated.</p>
      </div></details>
    </li>
    <li>
      <p>Why can calling a <code>virtual</code> method from a constructor throw
      <code>NullReferenceException</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The call runs the <em>derived</em> override, but the derived constructor body has not
        executed yet, so its fields are still null. The base author cannot see the bug; it needs
        somebody to inherit. Do not call overridable members during construction, and seal classes
        not designed for inheritance.</p>
      </div></details>
    </li>
    <li>
      <p>What happens if a static constructor throws?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The type is unusable for the rest of the process. Every later use throws
        <code>TypeInitializationException</code> wrapping the original error, and the static
        constructor is <strong>never retried</strong> — measured in this module still failing
        after the underlying cause was fixed. Only a restart clears it.</p>
      </div></details>
    </li>
    <li>
      <p>What decides when an object can be collected?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Reachability, not scope. An object is eligible once nothing the program is using can
        reach it by following references. The collector then reclaims it whenever it next runs —
        setting a variable to <code>null</code> changes eligibility, not timing.</p>
      </div></details>
    </li>
    <li>
      <p>What does adding a finaliser cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The object is not reclaimed by the collection that finds it unreachable. It is queued,
        finalised later on another thread, and so survives at least one extra collection and gets
        promoted a generation. Only add one for an unmanaged resource.</p>
      </div></details>
    </li>
    <li>
      <p>Why is a <code>static</code> property with a setter dangerous in a web service?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>There is one copy for the whole process, shared by every concurrent request. One
        request overwrites another's value, producing intermittent cross-contamination that does
        not reproduce with sequential testing. <code>static readonly</code> pointing at an
        immutable value is safe; mutable static state is not.</p>
      </div></details>
    </li>
  </ol>

  <div class="callout callout--note">
    <h4>Where this leads</h4>
    <p><a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a> covers what to
    expose and what to hide, and properties properly.
    <a href="#/m/t1-10-inheritance">Inheritance</a> takes the base/derived relationship sketched
    here and makes it the subject, including why the fragile base class problem is real.
    <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a> explains the mechanism
    behind the constructor bug, and
    <a href="#/m/t3-11-di-lifetimes">DI Lifetimes and the Bugs They Cause</a> is where shared
    mutable state becomes a production incident with a framework's help.</p>
  </div>
</section>

`
});
