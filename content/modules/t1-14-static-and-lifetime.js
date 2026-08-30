/* ============================================================================
   Track 1, Module 14 — Static Members, Constructors, and Lifetime
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every result in this module was compiled and run on
   .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-14-static-and-lifetime/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-14-static-and-lifetime",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "One slot for the whole process, initialised at a moment you do not choose, shared with " +
    "every caller including the ones you did not write. The runtime gives static initialisation " +
    "a thread-safety guarantee for free, and charges for it in three ways: timing you cannot " +
    "predict, a value baked into other people's builds, and state your tests cannot isolate.",
  terms: [
    "static field", "static method", "static class", "instance member",
    "const", "static readonly", "compile-time constant", "beforefieldinit",
    "type initialiser", "exactly-once initialisation", "cyclic static initialisation",
    "Lazy", "LazyThreadSafetyMode", "PublicationOnly", "ExecutionAndPublication",
    "AsyncLocal", "test isolation",
    "DecimalConstantAttribute", "thread-safe"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A pricing service is configured with a maximum retry count of 3. Operations raise it to 5,
  redeploy the shared configuration library, and confirm the new value is in the package. Two of
  the six services pick up the change. Four continue retrying three times. Every service is
  running the same library version. Nothing logs a warning, nothing throws, and the value printed
  by the four stubborn services is the old one.</p>

  <p>Separately, a test suite is flaky. Run individually, every test passes. Run in parallel — the
  default for the test framework — roughly one in twenty runs fails, never the same test twice.
  The failures are assertion mismatches on totals that are correct when the test is run alone.</p>

  <p>And a third: a service starts, serves traffic, and one endpoint returns 500 for every request
  from the first failure onward, with an exception naming a configuration class. Restarting fixes
  it. The configuration it complains about is present and correct.</p>

  <p>All three are the same keyword. <code>static</code> means <strong>one slot for the whole
  process</strong>, and each incident is a different consequence of that: a value copied into
  other people's compiled code, a value shared by tests that were supposed to be independent, and
  a one-time initialisation that failed once and stayed failed.</p>

  <p><a href="#/m/t1-08-classes-and-objects">Classes and Objects</a> introduced static
  constructors and the third incident. This module is about what <code>static</code> costs across
  a whole process and a whole deployment.</p>
</section>

<section id="what-static-means">
  <h2>What static actually means</h2>

  <p class="define"><span class="define__term">Static field</span> A field belonging to the type
  rather than to any instance. There is exactly one of it per type per process, it comes into
  existence before first use, and it is never garbage collected while the process runs.</p>

  <p class="define"><span class="define__term">Instance member</span> The opposite: one per
  object. A thousand objects have a thousand copies.</p>

  <p class="define"><span class="define__term">Static class</span> A class that can have only
  static members. It compiles to a class that is both <code>abstract</code> and
  <code>sealed</code>, so it can be neither instantiated nor inherited from — the two ideas from
  <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and
  Interfaces</a> combined to mean "this is a namespace with a name".</p>

  <p>The analogy usually offered is a noticeboard in an office: one board, everyone reads and
  writes it, and it is not owned by any person. <strong>The analogy is accurate about sharing and
  misleading about scope.</strong> A noticeboard belongs to one office; a static field belongs to
  the whole process, which means every request being served concurrently, every test running in
  parallel, and every library loaded into it. The unit is not your component — it is the
  <code>.exe</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-static-basics.cs"><code>// 01-static-basics.cs — what "static" attaches a member to, and the four
// storage choices for a value that does not change per instance.
// .NET 10.0.400. Run: dotnet run 01-static-basics.cs

using System;
using System.Linq;
using System.Reflection;

class Counter
{
    // One slot for the whole type, created before first use, never collected.
    private static int _created;

    // One slot per object.
    private readonly int _id;

    public Counter() =&gt; _id = ++_created;
    public int Id =&gt; _id;
    public static int Created =&gt; _created;
}

static class Rates
{
    // Compile-time constant: the VALUE is copied into every call site.
    public const decimal Vat = 0.20m;

    // Run-time constant: one evaluation, callers read the field.
    public static readonly decimal Corporation = ComputeCorporationRate();

    // Mutable static: one value shared by everything in the process.
    public static decimal Adjustment = 0m;

    private static decimal ComputeCorporationRate()
    {
        Console.WriteLine("  (ComputeCorporationRate ran)");
        return 0.19m;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- instance state vs static state ---");
        var a = new Counter();
        var b = new Counter();
        var c = new Counter();
        Console.WriteLine($"  ids: {a.Id}, {b.Id}, {c.Id}");
        Console.WriteLine($"  Counter.Created (one slot for the type): {Counter.Created}");

        Console.WriteLine();
        Console.WriteLine("--- const vs static readonly vs static field ---");
        Console.WriteLine($"  const Vat            : {Rates.Vat}");
        Console.WriteLine($"  static readonly Corp : {Rates.Corporation}");
        Console.WriteLine($"  static Adjustment    : {Rates.Adjustment}");

        Rates.Adjustment = 0.05m;
        Console.WriteLine($"  after assignment     : {Rates.Adjustment}");
        Console.WriteLine("  (Vat and Corporation cannot be assigned — CS0131 and CS0198)");

        Console.WriteLine();
        Console.WriteLine("--- what the compiler records ---");
        foreach (var f in typeof(Rates).GetFields(BindingFlags.Public | BindingFlags.Static))
            Console.WriteLine($"  {f.Name,-14} IsLiteral={f.IsLiteral,-6} IsInitOnly={f.IsInitOnly,-6} " +
                              $"IsStatic={f.IsStatic}");
        Console.WriteLine("  IsLiteral=True means a true IL constant: no field is read at run time.");
        Console.WriteLine("  Note Vat is a const decimal and reports IsLiteral=False — the CLR has");
        Console.WriteLine("  no decimal literal, so the compiler emits a static readonly field plus");
        Console.WriteLine("  a DecimalConstantAttribute and inlines the value from that instead.");

        Console.WriteLine();
        Console.WriteLine($"  Rates is a static class: IsAbstract={typeof(Rates).IsAbstract}, " +
                          $"IsSealed={typeof(Rates).IsSealed}");
        Console.WriteLine("  A static class compiles to abstract + sealed, so it can be neither");
        Console.WriteLine("  instantiated nor inherited from.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- instance state vs static state ---
  ids: 1, 2, 3
  Counter.Created (one slot for the type): 3

--- const vs static readonly vs static field ---
  const Vat            : 0.20
  (ComputeCorporationRate ran)
  static readonly Corp : 0.19
  static Adjustment    : 0
  after assignment     : 0.05
  (Vat and Corporation cannot be assigned — CS0131 and CS0198)

--- what the compiler records ---
  Vat            IsLiteral=False  IsInitOnly=True   IsStatic=True
  Corporation    IsLiteral=False  IsInitOnly=True   IsStatic=True
  Adjustment     IsLiteral=False  IsInitOnly=False  IsStatic=True
  IsLiteral=True means a true IL constant: no field is read at run time.
  Note Vat is a const decimal and reports IsLiteral=False — the CLR has
  no decimal literal, so the compiler emits a static readonly field plus
  a DecimalConstantAttribute and inlines the value from that instead.

  Rates is a static class: IsAbstract=True, IsSealed=True
  A static class compiles to abstract + sealed, so it can be neither
  instantiated nor inherited from.</code></pre>

  <p>Three storage choices look interchangeable and are not.</p>

  <p class="define"><span class="define__term">const</span> A <em>compile-time</em> constant. The
  value is substituted into every place that reads it, at the moment that code is compiled. Only
  types the compiler can evaluate qualify — numbers, <code>bool</code>, <code>char</code>,
  <code>string</code>, and enums.</p>

  <p class="define"><span class="define__term">static readonly</span> A <em>run-time</em>
  constant. The field is assigned once during type initialisation and never again; readers load
  the field. Any type and any expression is allowed.</p>

  <p>A mutable <code>static</code> field is the third: one slot anyone can write to at any time.
  It is the subject of most of this module's failure modes.</p>

  <div class="callout callout--gotcha">
    <p><strong><code>const decimal</code> is not a real constant in metadata.</strong> The output
    above shows <code>Vat</code> with <code>IsLiteral=False</code> and
    <code>IsInitOnly=True</code> — the shape of a <code>static readonly</code> field. The CLR has
    no <code>decimal</code> literal form, so the compiler emits a field carrying a
    <code>DecimalConstantAttribute</code> and reads the value from the attribute when inlining.
    The practical behaviour still matches <code>const</code>, as the next section measures, but
    any tool that decides "is this a constant?" by checking <code>IsLiteral</code> will get
    <code>decimal</code> wrong.</p>
  </div>
</section>

<section id="const-versioning">
  <h2>The value that gets copied into other people's builds</h2>

  <p>This is the first incident, and it follows from one word in the definition above:
  <em>substituted</em>.</p>

  <p>A library with four members holding the same two values, expressed both ways:</p>

  <pre data-lang="csharp" data-net="10" data-title="Config.v1"><code>namespace Lib;

public static class Config
{
    public const int MaxRetries = 3;
    public const decimal Vat = 0.20m;
    public static readonly int MaxRetriesField = 3;
    public static readonly decimal VatField = 0.20m;
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Program.cs"><code>using System;
using Lib;

class Program
{
    static void Main()
    {
        Console.WriteLine($"  const int     MaxRetries      = {Config.MaxRetries}");
        Console.WriteLine($"  const decimal Vat             = {Config.Vat}");
        Console.WriteLine($"  static readonly MaxRetriesField = {Config.MaxRetriesField}");
        Console.WriteLine($"  static readonly VatField        = {Config.VatField}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output — built against v1"><code>  const int     MaxRetries      = 3
  const decimal Vat             = 0.20
  static readonly MaxRetriesField = 3
  static readonly VatField        = 0.20</code></pre>

  <p>Every value is changed and the library is rebuilt on its own. The new
  <code>Lib.dll</code> is dropped in beside the same, untouched application:</p>

  <pre data-lang="csharp" data-net="10" data-title="Config.v2"><code>namespace Lib;

// VERSION 2 — every value changed. Nothing else about the surface changed.
public static class Config
{
    public const int MaxRetries = 5;
    public const decimal Vat = 0.25m;
    public static readonly int MaxRetriesField = 5;
    public static readonly decimal VatField = 0.25m;
}</code></pre>

  <pre data-lang="console" data-title="Output — v2 dropped in, app NOT rebuilt"><code>  const int     MaxRetries      = 3
  const decimal Vat             = 0.20
  static readonly MaxRetriesField = 5
  static readonly VatField        = 0.25</code></pre>

  <p><strong>The <code>const</code> values are stale and the <code>static readonly</code> values
  are current.</strong> The application's IL contains the literals <code>3</code> and
  <code>0.20</code>, copied in when it was compiled; the new library is never consulted for them.
  The <code>static readonly</code> fields are read from the assembly that is actually loaded.</p>

  <p>Note that <code>const decimal</code> behaves like <code>const int</code> here despite the
  metadata difference — the compiler inlines it from the attribute, so it is baked in exactly the
  same way.</p>

  <p>Rebuilding the application picks up the new values, with its source unchanged:</p>

  <pre data-lang="console" data-title="Output — app recompiled against v2"><code>  const int     MaxRetries      = 5
  const decimal Vat             = 0.25
  static readonly MaxRetriesField = 5
  static readonly VatField        = 0.25</code></pre>

  <p>That is the whole first incident. The two services that picked up the change were the two
  that happened to be rebuilt; the four that were not kept the values compiled into them months
  earlier.</p>

  <div class="callout callout--warn">
    <p><strong>Where this sits among the failures met so far.</strong> This one is the quietest of
    the family, and worth putting beside the others:</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Change</th><th>Symptom</th><th>Rebuild fixes it</th></tr></thead>
      <tbody>
        <tr><td>Field → property (<a href="#/m/t1-09-encapsulation">t1-09</a>)</td>
            <td><code>MissingFieldException</code>, loudly</td><td>yes</td></tr>
        <tr><td>Interface gains a member (<a href="#/m/t1-12-abstraction-and-interfaces">t1-12</a>)</td>
            <td><code>TypeLoadException</code>, on type load</td><td>no — becomes a compile error</td></tr>
        <tr><td>Base changes internals (<a href="#/m/t1-10-inheritance">t1-10</a>)</td>
            <td>none — silent behaviour change</td><td>no</td></tr>
        <tr><td><strong>A <code>const</code> value changes</strong></td>
            <td><strong>none — silently wrong values</strong></td><td><strong>yes</strong></td></tr>
      </tbody>
    </table>
    </div>
    <p>It is the only one that is both silent and fixed by a rebuild, which is the worst pairing:
    it does not announce itself, and it disappears the moment anyone tries to reproduce it from a
    clean tree.</p>
  </div>

  <p>The rule that follows: <strong>use <code>const</code> only for values that are true by
  definition and can never change</strong> — <code>DaysInWeek = 7</code>, <code>Pi</code>, a
  protocol's magic number. Anything that is a decision — a retry count, a tax rate, a timeout, a
  URL — should be <code>static readonly</code> at minimum, and usually configuration rather than
  either.</p>
</section>

<section id="when-it-runs">
  <h2>When static initialisation actually happens</h2>

  <p class="define"><span class="define__term">Type initialiser</span> The compiler-generated
  method that runs static field initialisers and the body of any static constructor. It runs once
  per type per process, and you never call it.</p>

  <p><a href="#/m/t1-08-classes-and-objects">Classes and Objects</a> said it runs "before first
  use". The precise timing depends on something invisible in the source: whether you wrote an
  explicit static constructor.</p>

  <p class="define"><span class="define__term">beforefieldinit</span> A flag the compiler puts on
  a type that has static field initialisers but <em>no explicit static constructor</em>. It tells
  the runtime it may initialise the type at any convenient moment before the first static field is
  read — possibly much earlier than the first use, possibly not at all if no field is ever read.
  Writing a static constructor, even an empty one, removes the flag and pins the timing.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-beforefieldinit.cs"><code>// 02-beforefieldinit.cs — writing an explicit static constructor changes WHEN
// static initialisation runs, even when the constructor body is empty.
// .NET 10.0.400. Run: dotnet run 02-beforefieldinit.cs -c Release

using System;
using System.Reflection;

static class Trace
{
    public static int Init(string who) { Console.WriteLine($"    [init] {who}"); return 1; }
}

// NO explicit static constructor. The compiler marks the type
// 'beforefieldinit': the runtime may initialise it at any point before the
// first static field is READ, including much earlier than you expect.
class Lazyish
{
    public static readonly int Value = Trace.Init("Lazyish.Value");
    public static void DoesNotTouchFields() =&gt; Console.WriteLine("    Lazyish.DoesNotTouchFields()");
}

// WITH an explicit static constructor, even an empty one. The type is NOT
// beforefieldinit, and the runtime must initialise it exactly at the first
// access to ANY static member — including a method that reads no fields.
class Precise
{
    public static readonly int Value = Trace.Init("Precise.Value");
    static Precise() { }
    public static void DoesNotTouchFields() =&gt; Console.WriteLine("    Precise.DoesNotTouchFields()");
}

class Program
{
    static void Main()
    {
        Console.WriteLine("Type attributes as recorded in metadata:");
        foreach (var t in new[] { typeof(Lazyish), typeof(Precise) })
            Console.WriteLine($"  {t.Name,-10} BeforeFieldInit=" +
                              $"{(t.Attributes &amp; TypeAttributes.BeforeFieldInit) != 0}");

        Console.WriteLine();
        Console.WriteLine("Calling a static method that reads no static fields:");
        Console.WriteLine("  Lazyish:");
        Lazyish.DoesNotTouchFields();
        Console.WriteLine("  Precise:");
        Precise.DoesNotTouchFields();

        Console.WriteLine();
        Console.WriteLine("Now reading a static field from each:");
        Console.WriteLine($"  Lazyish.Value = {Lazyish.Value}");
        Console.WriteLine($"  Precise.Value = {Precise.Value}");

        Console.WriteLine();
        Console.WriteLine("The difference: with beforefieldinit the runtime is FREE to");
        Console.WriteLine("initialise whenever it likes before the first field read, so the");
        Console.WriteLine("ordering above is a permitted behaviour rather than a guarantee.");
        Console.WriteLine("With an explicit static constructor the timing is specified.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Type attributes as recorded in metadata:
  Lazyish    BeforeFieldInit=True
  Precise    BeforeFieldInit=False

Calling a static method that reads no static fields:
  Lazyish:
    Lazyish.DoesNotTouchFields()
  Precise:
    [init] Precise.Value
    Precise.DoesNotTouchFields()

Now reading a static field from each:
    [init] Lazyish.Value
  Lazyish.Value = 1
  Precise.Value = 1

The difference: with beforefieldinit the runtime is FREE to
initialise whenever it likes before the first field read, so the
ordering above is a permitted behaviour rather than a guarantee.
With an explicit static constructor the timing is specified.</code></pre>

  <p>Two identical-looking classes, and calling a static method that touches no fields initialised
  one of them and not the other. The class with the explicit (empty) static constructor
  initialised eagerly; the one without deferred until a field was actually read.</p>

  <p>Three consequences worth carrying:</p>

  <p><strong>Adding an empty static constructor is a real change.</strong> It looks like a no-op
  and it moves when your initialisation runs. If that initialisation reads configuration, opens a
  connection, or logs, the moment it happens has moved.</p>

  <p><strong>Removing one is also a real change.</strong> Code that relied on eager
  initialisation — a self-registering type, a diagnostic that must run at startup — can silently
  stop running.</p>

  <p><strong>With <code>beforefieldinit</code>, the observed ordering is permission, not
  promise.</strong> The output above is one legal behaviour; a different runtime version, tiering
  decision, or inlining choice may produce another. Never write code whose correctness depends on
  it.</p>
</section>

<section id="threading">
  <h2>The guarantee the runtime gives you free</h2>

  <p>Static initialisation is thread-safe, and you did not have to ask.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-static-ctor-threading.cs"><code>// 03-static-ctor-threading.cs — the runtime guarantees a static constructor
// runs exactly once, and makes every other thread wait. That guarantee is
// genuinely useful and is also how you deadlock a process at startup.
// .NET 10.0.400. Run: dotnet run 03-static-ctor-threading.cs -c Release

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

// ---- 1. exactly once, under contention -----------------------------------
class ExpensiveSingleton
{
    public static int TimesInitialised;
    public static readonly ExpensiveSingleton Instance = Build();

    private static ExpensiveSingleton Build()
    {
        Interlocked.Increment(ref TimesInitialised);
        Thread.Sleep(150);                    // pretend this is expensive
        return new ExpensiveSingleton();
    }

    public string Describe() =&gt; "the one instance";
}

// ---- 2. other threads BLOCK until it finishes ----------------------------
class SlowInit
{
    public static readonly DateTime ReadyAt = Initialise();
    static SlowInit() { }

    private static DateTime Initialise()
    {
        Thread.Sleep(300);
        return DateTime.UtcNow;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. sixteen threads racing to touch a static ---");
        var barrier = new Barrier(16);
        var tasks = new Task[16];
        for (int i = 0; i &lt; 16; i++)
        {
            tasks[i] = Task.Run(() =&gt;
            {
                barrier.SignalAndWait();
                _ = ExpensiveSingleton.Instance.Describe();
            });
        }
        Task.WaitAll(tasks);
        Console.WriteLine($"  initialiser ran {ExpensiveSingleton.TimesInitialised} time(s) " +
                          $"across 16 concurrent threads");
        Console.WriteLine("  No lock was written. The runtime supplied one.");

        Console.WriteLine();
        Console.WriteLine("--- 2. what the other threads were doing: waiting ---");
        var sw = Stopwatch.StartNew();
        var waiters = new Task&lt;double&gt;[4];
        for (int i = 0; i &lt; 4; i++)
        {
            waiters[i] = Task.Run(() =&gt;
            {
                var local = Stopwatch.StartNew();
                _ = SlowInit.ReadyAt;
                return local.Elapsed.TotalMilliseconds;
            });
        }
        Task.WaitAll(waiters);
        sw.Stop();
        Console.WriteLine($"  initialiser sleeps 300 ms");
        for (int i = 0; i &lt; waiters.Length; i++)
            Console.WriteLine($"    thread {i} blocked for {waiters[i].Result,6:F0} ms");
        Console.WriteLine($"  total wall clock: {sw.Elapsed.TotalMilliseconds:F0} ms");
        Console.WriteLine("  Every thread that touched the type waited for the one that won.");

        Console.WriteLine();
        Console.WriteLine("--- 3. what a CYCLE actually does ---");
        Console.WriteLine("  Two types whose static initialisers each read the other.");
        Console.WriteLine("  Folklore says this deadlocks. Here is what was measured:");
        Console.WriteLine($"    touching Cyclic1 first -&gt; Cyclic1.Value={Cyclic1.Value}, " +
                          $"Cyclic2.Value={Cyclic2.Value}");
        Console.WriteLine("  No hang, no exception. The runtime broke the cycle by handing");
        Console.WriteLine("  back the DEFAULT value of the field whose initialiser had not");
        Console.WriteLine("  finished — so one of these numbers is built on a zero that was");
        Console.WriteLine("  never assigned. Which one depends on which type is touched first.");
    }
}

class Cyclic1
{
    public static readonly int Value;
    static Cyclic1()
    {
        int seen = Cyclic2.Value;
        Console.WriteLine($"    Cyclic1 initialiser read Cyclic2.Value = {seen}");
        Value = seen + 1;
    }
}

class Cyclic2
{
    public static readonly int Value;
    static Cyclic2()
    {
        int seen = Cyclic1.Value;
        Console.WriteLine($"    Cyclic2 initialiser read Cyclic1.Value = {seen}");
        Value = seen + 1;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. sixteen threads racing to touch a static ---
  initialiser ran 1 time(s) across 16 concurrent threads
  No lock was written. The runtime supplied one.

--- 2. what the other threads were doing: waiting ---
  initialiser sleeps 300 ms
    thread 0 blocked for    307 ms
    thread 1 blocked for    307 ms
    thread 2 blocked for    307 ms
    thread 3 blocked for    307 ms
  total wall clock: 308 ms
  Every thread that touched the type waited for the one that won.

--- 3. what a CYCLE actually does ---
  Two types whose static initialisers each read the other.
  Folklore says this deadlocks. Here is what was measured:
    Cyclic2 initialiser read Cyclic1.Value = 0
    Cyclic1 initialiser read Cyclic2.Value = 1
    touching Cyclic1 first -&gt; Cyclic1.Value=2, Cyclic2.Value=1
  No hang, no exception. The runtime broke the cycle by handing
  back the DEFAULT value of the field whose initialiser had not
  finished — so one of these numbers is built on a zero that was
  never assigned. Which one depends on which type is touched first.</code></pre>

  <p class="define"><span class="define__term">Exactly-once initialisation</span> The runtime's
  guarantee that a type initialiser runs one time, no matter how many threads reach the type
  simultaneously. Threads that arrive while it is running block until it completes.</p>

  <p>Block 1 is the useful half: sixteen threads, one initialisation, no <code>lock</code>
  written. This is why <code>static readonly</code> is the simplest correct way to build something
  once for a whole process.</p>

  <p><strong>Block 2 is the price, and it is easy to miss.</strong> Four threads each blocked for
  307 ms because one of them was running a 300 ms initialiser. A type initialiser that reads a
  file, resolves DNS, or calls a service stops <em>every</em> thread that touches that type for
  its entire duration. At startup, under load, that is a stall affecting requests that have
  nothing to do with the type.</p>

  <div class="callout callout--myth">
    <p><strong>Block 3 corrects a widely repeated claim.</strong> Cyclic static initialisation is
    usually described as deadlocking. Measured on .NET 10, it did not — not single-threaded, and
    not with two threads forced into the initialisers simultaneously with a barrier. The runtime
    broke the cycle by returning the <strong>default value</strong> of the field whose initialiser
    had not yet completed, so <code>Cyclic2</code> read <code>Cyclic1.Value</code> as
    <code>0</code> and built its own value on that.</p>
    <p>That is worse than a deadlock in one specific way: a deadlock is obvious and stops
    everything, whereas this produced plausible-looking numbers with no error at all, and which
    field gets the zero depends on which type is touched first — so it can differ between
    environments running identical code. The specification permits a deadlock here; this runtime
    chose silence instead. Either way, cyclic static initialisation is a defect, and the
    diagnostic to reach for is "is a static field zero when it should not be?"</p>
  </div>
</section>

<section id="static-state">
  <h2>Static mutable state</h2>

  <p>Everything so far concerned initialisation. This section is about the slot itself.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-static-state.cs"><code>// 04-static-state.cs — a static field is one slot for the whole process. That
// is the feature and the failure: everything sharing it includes code you did
// not write, and tests that run at the same time.
// .NET 10.0.400. Run: dotnet run 04-static-state.cs -c Release

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;

// ---- the tempting version -------------------------------------------------
static class CurrentTenant
{
    public static string? Id;          // "the tenant this request is for"
}

static class ReportBuilder
{
    public static string Build(string data) =&gt; $"[{CurrentTenant.Id}] {data}";
}

// ---- shared mutable collection --------------------------------------------
static class Registry
{
    public static readonly Dictionary&lt;string, int&gt; Counts = new();
}

// ---- the version that has no shared slot ----------------------------------
sealed class TenantContext
{
    public string Id { get; }
    public TenantContext(string id) =&gt; Id = id;
    public string Build(string data) =&gt; $"[{Id}] {data}";
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. two concurrent requests, one static slot ---");
        var results = new string[2];
        var b = new Barrier(2);
        Parallel.For(0, 2, i =&gt;
        {
            CurrentTenant.Id = i == 0 ? "acme" : "globex";
            b.SignalAndWait();                 // force the interleaving to be visible
            Thread.Sleep(20);
            results[i] = ReportBuilder.Build($"request {i}");
        });
        foreach (var r in results) Console.WriteLine($"  {r}");
        Console.WriteLine("  Both requests read whichever value was written last.");
        Console.WriteLine("  In production this is one customer's data under another's name.");

        Console.WriteLine();
        Console.WriteLine("--- 2. the same code with no shared slot ---");
        var safe = new string[2];
        Parallel.For(0, 2, i =&gt;
        {
            var ctx = new TenantContext(i == 0 ? "acme" : "globex");
            Thread.Sleep(20);
            safe[i] = ctx.Build($"request {i}");
        });
        foreach (var r in safe) Console.WriteLine($"  {r}");

        Console.WriteLine();
        Console.WriteLine("--- 3. a shared Dictionary is not thread-safe ---");
        Registry.Counts.Clear();
        Exception? caught = null;
        try
        {
            Parallel.For(0, 40_000, i =&gt;
            {
                Registry.Counts[$"k{i % 500}"] = i;
            });
        }
        catch (AggregateException ex)
        {
            caught = ex.InnerException;
        }
        Console.WriteLine($"  exception: {caught?.GetType().Name ?? "(none this run)"}");
        Console.WriteLine($"  entries after the run: {Registry.Counts.Count} (expected 500)");
        Console.WriteLine("  Corruption here is intermittent: a clean run proves nothing.");

        Console.WriteLine();
        Console.WriteLine("--- 4. statics the framework owns are the same problem ---");
        var before = CultureInfo.CurrentCulture.Name;
        Console.WriteLine($"  thread culture before : {before}");
        Console.WriteLine($"  1234.5 formatted      : {1234.5.ToString("N2")}");
        CultureInfo.CurrentCulture = new CultureInfo("de-DE");
        Console.WriteLine($"  after setting de-DE   : {1234.5.ToString("N2")}");
        CultureInfo.CurrentCulture = new CultureInfo(before);
        Console.WriteLine($"  restored              : {1234.5.ToString("N2")}");
        Console.WriteLine("  Any library on this thread now formats differently, and nothing");
        Console.WriteLine("  in its signature said it could be affected.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. two concurrent requests, one static slot ---
  [globex] request 0
  [globex] request 1
  Both requests read whichever value was written last.
  In production this is one customer's data under another's name.

--- 2. the same code with no shared slot ---
  [acme] request 0
  [globex] request 1

--- 3. a shared Dictionary is not thread-safe ---
  exception: InvalidOperationException
  entries after the run: 524 (expected 500)
  Corruption here is intermittent: a clean run proves nothing.

--- 4. statics the framework owns are the same problem ---
  thread culture before : en-NG
  1234.5 formatted      : 1,234.50
  after setting de-DE   : 1.234,50
  restored              : 1,234.50
  Any library on this thread now formats differently, and nothing
  in its signature said it could be affected.</code></pre>

  <p><strong>Block 1 is a data breach in four lines.</strong> Two concurrent requests, one
  <code>CurrentTenant.Id</code> slot, and both reports came out labelled <code>globex</code>. In a
  real service that is one customer's figures under another customer's name — the third incident
  from <a href="#/m/t1-08-classes-and-objects">Classes and Objects</a>, shown here rather than
  described.</p>

  <p><strong>Block 3 is corruption rather than a race on a value.</strong> Writing to a shared
  <code>Dictionary</code> from many threads threw <code>InvalidOperationException</code> and left
  <strong>524 entries where 500 keys were written</strong>. The internal structure is inconsistent,
  not merely out of date, and reads afterwards can return wrong answers or loop forever. Note the
  warning: an intermittent failure means a clean run proves nothing.</p>

  <p><strong>Block 4 is the one people forget.</strong> <code>CultureInfo.CurrentCulture</code> is
  static state you do not own. Setting it changes number and date formatting for every library on
  that thread, and nothing in any signature warns you. It is the same hazard as your own static
  field, with a larger blast radius — and it connects directly to the parsing failures in
  <a href="#/m/t1-02-variables-and-types">Variables, Types, and Type Inference</a>.</p>

  <p>The second incident from the top of the module is block 1 in a test runner. Tests running in
  parallel share the process, so they share every static field. A test that passes alone and fails
  in a suite is nearly always this.</p>

  <p class="define"><span class="define__term">Test isolation</span> The property that a test's
  result does not depend on what other tests did. Static mutable state removes it, because the
  slot outlives the test. The symptom is order-dependent and parallelism-dependent failures,
  which are among the most expensive bugs to chase because reproducing them is itself
  unreliable.</p>
</section>

<section id="production-example">
  <h2>What to use instead</h2>

  <p>Four things people reach for <code>static</code> to do, and what each should be.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-production.cs"><code>// 05-production.cs — the four things people reach for static to do, and what
// each should be instead.
// .NET 10.0.400. Run: dotnet run 05-production.cs -c Release

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

// ---- 1. genuinely immutable shared data: static readonly is correct -------
static class Currencies
{
    // Frozen at initialisation, never mutated, safe to share.
    public static readonly IReadOnlyDictionary&lt;string, int&gt; MinorUnits =
        new Dictionary&lt;string, int&gt;(StringComparer.OrdinalIgnoreCase)
        {
            ["GBP"] = 2, ["USD"] = 2, ["EUR"] = 2, ["JPY"] = 0, ["KWD"] = 3
        };

    public static int DecimalsFor(string code) =&gt;
        MinorUnits.TryGetValue(code, out int d) ? d : 2;
}

// ---- 2. expensive one-time setup: Lazy&lt;T&gt;, not a static constructor -------
sealed class RateTable
{
    public static int BuildCount;

    private static readonly Lazy&lt;RateTable&gt; _instance =
        new(() =&gt; Build(), LazyThreadSafetyMode.ExecutionAndPublication);

    public static RateTable Instance =&gt; _instance.Value;

    private readonly Dictionary&lt;string, decimal&gt; _rates;
    private RateTable(Dictionary&lt;string, decimal&gt; rates) =&gt; _rates = rates;

    private static RateTable Build()
    {
        Interlocked.Increment(ref BuildCount);
        Thread.Sleep(100);
        return new RateTable(new Dictionary&lt;string, decimal&gt;
        {
            ["GBP"] = 1.00m, ["USD"] = 1.27m, ["EUR"] = 1.17m
        });
    }

    public decimal Rate(string code) =&gt; _rates.TryGetValue(code, out var r) ? r : 0m;
}

// ---- 3. shared MUTABLE state: an injected object, not a static field ------
public interface ICallCounter { void Record(string op); IReadOnlyDictionary&lt;string, int&gt; Snapshot(); }

public sealed class CallCounter : ICallCounter
{
    private readonly ConcurrentDictionary&lt;string, int&gt; _counts = new();
    public void Record(string op) =&gt; _counts.AddOrUpdate(op, 1, (_, n) =&gt; n + 1);
    public IReadOnlyDictionary&lt;string, int&gt; Snapshot() =&gt; new Dictionary&lt;string, int&gt;(_counts);
}

public sealed class PricingService
{
    private readonly ICallCounter _counter;
    public PricingService(ICallCounter counter) =&gt; _counter = counter;

    public decimal Price(decimal amount, string currency)
    {
        _counter.Record("price");
        int decimals = Currencies.DecimalsFor(currency);
        return Math.Round(amount * RateTable.Instance.Rate(currency), decimals);
    }
}

// ---- 4. per-operation ambient context: pass it, or use AsyncLocal --------
static class RequestContext
{
    private static readonly AsyncLocal&lt;string?&gt; _tenant = new();
    public static string? Tenant { get =&gt; _tenant.Value; set =&gt; _tenant.Value = value; }
}

class Program
{
    static async Task Main()
    {
        Console.WriteLine("--- 1. static readonly for immutable shared data ---");
        foreach (var c in new[] { "GBP", "JPY", "KWD", "XXX" })
            Console.WriteLine($"  {c}: {Currencies.DecimalsFor(c)} decimal places");

        Console.WriteLine();
        Console.WriteLine("--- 2. Lazy&lt;T&gt; for expensive setup, under 12 concurrent callers ---");
        var tasks = new Task&lt;decimal&gt;[12];
        for (int i = 0; i &lt; 12; i++) tasks[i] = Task.Run(() =&gt; RateTable.Instance.Rate("USD"));
        await Task.WhenAll(tasks);
        Console.WriteLine($"  built {RateTable.BuildCount} time(s); every caller got " +
                          $"{tasks[0].Result}");
        Console.WriteLine("  Same exactly-once guarantee as a static constructor, and the");
        Console.WriteLine("  failure surfaces as an ordinary exception rather than a");
        Console.WriteLine("  TypeInitializationException that poisons every member of the type.");
        Console.WriteLine("  Note this mode still CACHES a failure: see 06-exercises.cs for the");
        Console.WriteLine("  measured difference between the LazyThreadSafetyMode values.");

        Console.WriteLine();
        Console.WriteLine("--- 3. injected shared state: two independent instances ---");
        var counterA = new CallCounter();
        var counterB = new CallCounter();
        var serviceA = new PricingService(counterA);
        var serviceB = new PricingService(counterB);

        Console.WriteLine($"  A: {serviceA.Price(100m, "USD")} USD, {serviceA.Price(100m, "JPY")} JPY");
        Console.WriteLine($"  B: {serviceB.Price(50m, "EUR")} EUR");
        Console.WriteLine($"  counter A: {Describe(counterA.Snapshot())}");
        Console.WriteLine($"  counter B: {Describe(counterB.Snapshot())}");
        Console.WriteLine("  Two tests can run at the same time without sharing a number.");

        Console.WriteLine();
        Console.WriteLine("--- 4. AsyncLocal for per-operation context ---");
        var work = new Task[2];
        var seen = new string?[2];
        for (int i = 0; i &lt; 2; i++)
        {
            int index = i;
            work[i] = Task.Run(async () =&gt;
            {
                RequestContext.Tenant = index == 0 ? "acme" : "globex";
                await Task.Delay(30);
                seen[index] = RequestContext.Tenant;
            });
        }
        await Task.WhenAll(work);
        Console.WriteLine($"  task 0 saw: {seen[0]}");
        Console.WriteLine($"  task 1 saw: {seen[1]}");
        Console.WriteLine("  One name, one value per logical flow, surviving await.");
        Console.WriteLine($"  and on this thread: {RequestContext.Tenant ?? "(null, as it should be)"}");
    }

    static string Describe(IReadOnlyDictionary&lt;string, int&gt; d) =&gt;
        d.Count == 0 ? "(empty)" : string.Join(", ", d.Select(kv =&gt; $"{kv.Key}={kv.Value}"));
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. static readonly for immutable shared data ---
  GBP: 2 decimal places
  JPY: 0 decimal places
  KWD: 3 decimal places
  XXX: 2 decimal places

--- 2. Lazy&lt;T&gt; for expensive setup, under 12 concurrent callers ---
  built 1 time(s); every caller got 1.27
  Same exactly-once guarantee as a static constructor, and the
  failure surfaces as an ordinary exception rather than a
  TypeInitializationException that poisons every member of the type.
  Note this mode still CACHES a failure: see 06-exercises.cs for the
  measured difference between the LazyThreadSafetyMode values.

--- 3. injected shared state: two independent instances ---
  A: 127.00 USD, 0 JPY
  B: 58.50 EUR
  counter A: price=2
  counter B: price=1
  Two tests can run at the same time without sharing a number.

--- 4. AsyncLocal for per-operation context ---
  task 0 saw: acme
  task 1 saw: globex
  One name, one value per logical flow, surviving await.
  and on this thread: (null, as it should be)</code></pre>

  <p><strong>1. Immutable shared data: <code>static readonly</code> is right.</strong> A frozen
  lookup table has no failure mode — nothing writes to it, so nothing races. This is
  <code>static</code> doing exactly what it is for. Note the type is
  <code>IReadOnlyDictionary</code>, so the encapsulation rule from
  <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a> applies: exposing a
  mutable <code>Dictionary</code> here would hand every caller a write handle to process-wide
  state.</p>

  <p><strong>2. Expensive one-time setup: <code>Lazy&lt;T&gt;</code>.</strong></p>

  <p class="define"><span class="define__term">Lazy&lt;T&gt;</span> A wrapper that runs a factory
  the first time <code>Value</code> is read and caches the result. It gives the same
  exactly-once-under-concurrency guarantee as a type initialiser, with two advantages: the failure
  is an ordinary exception rather than a <code>TypeInitializationException</code> that poisons
  every member of the type for the life of the process, and the initialisation happens at the
  first <em>read</em> rather than at a moment the runtime chooses.</p>

  <p><strong>3. Shared mutable state: an injected object.</strong> <code>CallCounter</code> holds
  exactly the state a static field would have held. Because it is a constructor parameter, two
  instances exist independently, two tests can run in parallel, and the dependency is visible in
  the signature. In an ASP.NET Core application this is a singleton registration — one instance
  per application, which is what was wanted, without being one slot per process forever.</p>

  <p><strong>4. Per-operation context: pass it, or use <code>AsyncLocal</code>.</strong></p>

  <p class="define"><span class="define__term">AsyncLocal&lt;T&gt;</span> A value that flows with
  a logical operation rather than being shared process-wide: each asynchronous flow gets its own,
  and it survives <code>await</code>. It is how a tenant id or a correlation id can be ambient
  without being global. The output shows two concurrent tasks each seeing their own value, and the
  calling thread seeing none.</p>

  <p>Passing the value explicitly is still better where it is practical, because it appears in
  signatures. <code>AsyncLocal</code> is for values that would otherwise have to be threaded
  through every method — logging context, correlation ids — where the alternative is worse.
  Track 2 covers how the flow actually works.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A const that was really a setting</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: decisions declared as const"><code>// WRONG in a library other assemblies compile against. Every one of these is
// a decision that will change, and each is copied into every caller's IL at
// the moment that caller is built.
public static class Config
{
    public const int MaxRetries = 3;
    public const int TimeoutSeconds = 30;
    public const string ApiBaseUrl = "https://api.example.com";
    public const decimal Vat = 0.20m;
}

// Right: these are read from the loaded assembly, so updating it updates them.
public static class Config
{
    public static readonly int MaxRetries = 3;
    public static readonly int TimeoutSeconds = 30;
    public static readonly string ApiBaseUrl = "https://api.example.com";
    public static readonly decimal Vat = 0.20m;
}</code></pre>

  <p>The rule: <code>const</code> is for values that are true by definition. If you can imagine a
  meeting at which the value changes, it is not one.</p>

  <h3>2. Work in a type initialiser</h3>

  <p>Anything slow blocks every thread that touches the type, as measured above — 307 ms of
  blocking for a 300 ms initialiser. Anything that can fail poisons the type permanently:
  <code>TypeInitializationException</code> on the first attempt and on every attempt afterwards,
  even once the cause is fixed, as
  <a href="#/m/t1-08-classes-and-objects">Classes and Objects</a> established and exercise 3
  below re-measures. The combination — slow and fallible — is a configuration read, which is the
  single most common thing found in a static constructor.</p>

  <h3>3. Cyclic static initialisation</h3>

  <p>Two types whose initialisers read each other produce a silently zero-valued field, not a
  deadlock and not an exception. It is worth searching for deliberately when a static field holds
  an implausible default: <code>0</code>, <code>null</code>, or an empty collection where the
  source plainly assigns something else.</p>

  <h3>4. Static state and parallel tests</h3>

  <pre data-lang="console" data-title="One static slot, two concurrent tests"><code>one static slot, two concurrent 'tests' adding 30 each -&gt; 40
  each test expects 30; together they neither isolate nor reliably total 60
instance fields -&gt; t1=30, t2=30</code></pre>

  <p>The static version produced 40 on that run — not 30, not 60, and not the same number every
  time. Two failure modes at once: the tests see each other's data, and the unsynchronised
  <code>+=</code> loses updates. The instance version is correct and deterministic.</p>

  <h3>5. Assuming <code>static readonly</code> means immutable</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: readonly freezes the reference, not the object"><code>// WRONG. readonly stops the FIELD being reassigned. It does nothing about the
// list, which any caller can add to, clear, or reorder — from any thread.
public static readonly List&lt;string&gt; AllowedRegions = new() { "eu-west-2", "us-east-1" };

// Right: a type that has no mutating members.
public static readonly IReadOnlyList&lt;string&gt; AllowedRegions =
    new[] { "eu-west-2", "us-east-1" };</code></pre>

  <p>This is the distinction from
  <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a> applied to static
  fields, where the consequences are worst: the collection is shared by the entire process and
  lives forever. The stronger version, and the reason the second form is still not a complete
  guarantee, is in
  <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a>.</p>

  <h3>6. Statics you do not own</h3>

  <p><code>CultureInfo.CurrentCulture</code>, <code>Thread.CurrentPrincipal</code>,
  <code>Console.Out</code>, <code>Environment</code> variables, and any library's own static
  configuration are the same slot with a larger blast radius. Setting one inside a library changes
  behaviour for unrelated code on the same thread, and nothing in your signature says so.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>A configuration value is stale and the deployed library is correct.</strong>
    Suspect a <code>const</code>. Confirm without guessing: run
    <code>ildasm</code> or any IL viewer over the <em>consuming</em> assembly and look for the
    literal in the call site — a <code>const</code> read compiles to
    <code>ldc.i4.3</code> with no reference to the declaring type, while a
    <code>static readonly</code> read compiles to <code>ldsfld</code> naming it. If the value does
    not appear in the caller's IL, the caller is reading it at run time and the problem is
    elsewhere. Rebuilding the consumer makes the symptom vanish, so establish the cause first.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A test passes alone and fails in the suite.</strong> Assume static state until
    proved otherwise. Two quick checks: run the suite with parallelism disabled — if it passes,
    the state is shared across threads; and run the failing test after the one that precedes it in
    the suite, alone, which finds order dependence. Then grep the code under test for
    <code>static</code> fields that are not <code>readonly</code>, plus assignments to
    <code>CultureInfo.CurrentCulture</code>, <code>Thread.CurrentPrincipal</code> and environment
    variables. The fix is nearly always to make the state an injected instance.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A static field holds an implausible default.</strong> Zero, <code>null</code>, or
    an empty collection where the initialiser plainly assigns something else means the field was
    read <em>during</em> initialisation — a cycle. Find it by putting a breakpoint or a
    <code>Console.WriteLine</code> at the top of each suspect initialiser and reading the order
    they run in. The type touched first is the one whose value is built on a zero.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Startup stalls, or a request stalls for no visible reason.</strong> A type
    initialiser doing I/O blocks every thread that touches that type. Capture a dump during the
    stall and look for threads waiting on class initialisation — in WinDbg with SOS,
    <code>!threads</code> and <code>!clrstack</code> show them parked in the runtime's type
    initialisation path rather than in your code. The fix is to move the work into a
    <code>Lazy&lt;T&gt;</code> read at a point you control, or out of initialisation
    entirely.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong><code>TypeInitializationException</code>, repeatedly, after the cause is
    fixed.</strong> The type is poisoned for the life of the process — the runtime records that
    initialisation failed and does not retry. The inner exception is the real error and the only
    useful part of the message. Restarting is the only recovery, which is why anything that can
    fail belongs outside a type initialiser.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Deciding whether a static is safe.</strong> Two questions. <em>Is it ever
    written after initialisation?</em> If yes, it is shared mutable state and needs to become an
    instance or be synchronised. <em>Does <code>readonly</code> actually freeze what matters?</em>
    A <code>static readonly List&lt;T&gt;</code> is a mutable global with a reassuring keyword on
    it.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>A concrete case.</strong> A payments platform raised its gateway retry limit from 3
    to 5 after an incident in which transient gateway failures had caused about 1,200 abandoned
    checkouts in an afternoon. The value lived in a shared <code>Constants</code> class as
    <code>public const int MaxGatewayRetries = 3;</code>. It was changed, the package was published
    as 4.1.0, and six services were told to upgrade.</p>
    <p>Two services were on active release trains and rebuilt within a day; they retried five
    times. The other four upgraded the package reference but were not rebuilt and redeployed for
    another three weeks, because nothing else about them had changed. Those four kept retrying
    three times, with a compiled-in literal, while their dependency manifests said 4.1.0.</p>
    <p>The next gateway incident, eleven days later, produced the same abandoned-checkout pattern
    in exactly four of the six services. The investigation began from the assumption that the fix
    had not worked, because every service reported the correct package version. What settled it
    was decompiling one of the four and finding <code>ldc.i4.3</code> at the call site — the number
    three, in the application's own IL, with no reference to the constants assembly at all.</p>
    <p>The fix was one keyword: <code>const</code> to <code>static readonly</code>. The estimated
    cost of the eleven days was in the region of 3,000 abandoned checkouts. Nothing had failed;
    four services were running a decision that had been revised, and the mechanism that let them
    was a compile-time substitution nobody had thought about since the value was written.</p>
  </div>

  <p>The general principle: <strong><code>static</code> chooses a lifetime, and the lifetime is
  longer than you are thinking about.</strong> A <code>const</code>'s lifetime is the lifetime of
  every build that ever consumed it. A static field's is the process. Static mutable state's is
  every test, every request, and every library sharing that process.</p>

  <p>None of that makes <code>static</code> wrong. Immutable shared data and expensive one-time
  setup are what it is for, and the exactly-once threading guarantee is genuinely valuable. The
  discipline is to be deliberate: choose <code>static</code> when the thing really is one per
  process and never changes, and reach for an injected instance the moment either half of that
  stops being true.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"<code>const</code> and <code>static readonly</code> are the same, one is only
    shorter."</strong> Measured: after a library update, the <code>const</code> values were stale
    and the <code>static readonly</code> values were current, in the same program, in the same
    run. <code>const</code> is copied into every consumer at their compile time;
    <code>static readonly</code> is read from the loaded assembly.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"An empty static constructor does nothing."</strong> It removes the
    <code>beforefieldinit</code> flag, which changes when initialisation happens. In the
    measurement above, the class with the empty static constructor initialised when a static
    <em>method</em> was called; the one without waited until a static <em>field</em> was read.
    Adding or removing it is a behavioural change.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Cyclic static constructors deadlock."</strong> Not on .NET 10, measured both
    single-threaded and with two threads forced in simultaneously. The runtime returned the
    default value of the not-yet-initialised field, producing a plausible wrong number with no
    error. The specification permits a deadlock; this runtime chose silence, which is harder to
    find.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>static readonly</code> means the value cannot change."</strong> It means the
    <em>field</em> cannot be reassigned. A <code>static readonly List&lt;T&gt;</code> can be added
    to, cleared and reordered by anyone, from any thread, for the life of the process — a mutable
    global with a reassuring keyword on it.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>Lazy&lt;T&gt;</code> retries if initialisation fails."</strong> Only in one
    mode. Measured: <code>ExecutionAndPublication</code> (the default when thread safety is on)
    and <code>None</code> both <em>cache the exception</em> and fail identically on every later
    read. Only <code>PublicationOnly</code> retries — and it allows the factory to run on more than
    one thread, publishing the first result, so it is not exactly-once execution. Pick the mode
    against what you need, and do not assume.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"A static class is a design smell."</strong> A static class of pure functions —
    <code>Math</code>, <code>string.Join</code>, your own formatting helpers — has no state, no
    lifetime, and nothing to isolate in a test. The hazard is static <em>state</em>, not static
    <em>methods</em>. If a static class has fields that change, that is the problem, and moving
    the methods onto an instance is not the fix by itself.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Reach for</th><th>Because</th></tr></thead>
    <tbody>
      <tr>
        <td>A value that is true by definition and can never change</td>
        <td><code>const</code></td>
        <td>Substituted at the call site with no run-time cost. Days in a week; a protocol magic
        number.</td>
      </tr>
      <tr>
        <td>Any value that is a decision — timeout, retry count, rate, URL</td>
        <td><code>static readonly</code>, or configuration</td>
        <td>A <code>const</code> is copied into every consumer's build and goes stale silently
        when you change it.</td>
      </tr>
      <tr>
        <td>An immutable lookup shared process-wide</td>
        <td><code>static readonly</code> of a read-only type</td>
        <td>Nothing writes to it, so nothing races. Expose <code>IReadOnlyDictionary</code>, not
        <code>Dictionary</code>.</td>
      </tr>
      <tr>
        <td>Expensive setup needed once</td>
        <td><code>Lazy&lt;T&gt;</code></td>
        <td>Same exactly-once guarantee, initialised at a point you control, and a failure that is
        an ordinary exception rather than a permanently poisoned type.</td>
      </tr>
      <tr>
        <td>Initialisation that can fail and should be retryable</td>
        <td><code>Lazy&lt;T&gt;</code> with <code>PublicationOnly</code></td>
        <td>The only mode that does not cache the exception — measured.</td>
      </tr>
      <tr>
        <td>Shared state that changes</td>
        <td>An injected instance (a DI singleton)</td>
        <td>One instance per application rather than one slot per process, so tests isolate and
        the dependency is visible in the signature.</td>
      </tr>
      <tr>
        <td>A value belonging to one request or operation</td>
        <td>A parameter, or <code>AsyncLocal&lt;T&gt;</code></td>
        <td>A static field is shared by every request in flight — the cross-tenant leak.</td>
      </tr>
      <tr>
        <td>Pure functions with no state</td>
        <td>A <code>static</code> class</td>
        <td>Nothing to isolate and nothing to race. This is what static is for.</td>
      </tr>
      <tr>
        <td>You need eager, predictable initialisation timing</td>
        <td>An explicit static constructor — or better, initialise at startup</td>
        <td>It removes <code>beforefieldinit</code> and pins the timing. Explicit startup code is
        clearer still.</td>
      </tr>
      <tr>
        <td>You are about to set <code>CurrentCulture</code> or similar in a library</td>
        <td>Pass the culture as a parameter instead</td>
        <td>It is static state you do not own, affecting every other library on the thread.</td>
      </tr>
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
    <p>A library declares the four members below. Its values are all changed and the library is
    rebuilt; the consuming application is <em>not</em> rebuilt. Give the four values the
    application prints, and say which one would surprise a reviewer reading only the library's
    source.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1 — the library, v1 then v2"><code>// v1
public static class Config
{
    public const int MaxRetries = 3;
    public const decimal Vat = 0.20m;
    public static readonly int MaxRetriesField = 3;
    public static readonly decimal VatField = 0.20m;
}

// v2 — every value changed
public static class Config
{
    public const int MaxRetries = 5;
    public const decimal Vat = 0.25m;
    public static readonly int MaxRetriesField = 5;
    public static readonly decimal VatField = 0.25m;
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output — v2 dropped in, app not rebuilt"><code>  const int     MaxRetries      = 3
  const decimal Vat             = 0.20
  static readonly MaxRetriesField = 5
  static readonly VatField        = 0.25</code></pre>
        <p>The two <code>const</code> members are <strong>stale</strong>; the two
        <code>static readonly</code> members are current. A <code>const</code> is substituted into
        the consumer's IL when the consumer is compiled, so the application never asks the new
        library for it. A <code>static readonly</code> field is read from whichever assembly is
        actually loaded.</p>
        <p><strong>The surprising one is <code>const decimal</code>.</strong> The CLR has no
        <code>decimal</code> literal, so the compiler cannot emit a true constant — in metadata,
        <code>Vat</code> appears as a <code>static readonly</code> field with
        <code>IsLiteral=False</code> and a <code>DecimalConstantAttribute</code>. A reviewer who
        knows that might reasonably conclude it behaves like <code>static readonly</code> and picks
        up the change. It does not: the compiler reads the value out of the attribute and inlines
        it exactly as it would an <code>int</code>. <strong>The metadata shape differs and the
        behaviour does not.</strong></p>
        <p>Rebuilding the application picks up all four new values with no source change — which is
        precisely what makes this failure hard to investigate, since any attempt to reproduce it
        from a clean tree makes it disappear.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Two classes differ by one empty static constructor. Predict the exact order of the printed
    lines, then say what practical change adding that constructor makes.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>class NoStaticCtor
{
    public static readonly string Field = Probe.Mark("NoStaticCtor.Field");
    public static void Ping() =&gt; Console.WriteLine("    NoStaticCtor.Ping()");
}

class WithStaticCtor
{
    public static readonly string Field = Probe.Mark("WithStaticCtor.Field");
    static WithStaticCtor() { }
    public static void Ping() =&gt; Console.WriteLine("    WithStaticCtor.Ping()");
}

NoStaticCtor.Ping();
WithStaticCtor.Ping();
Console.WriteLine(NoStaticCtor.Field);
Console.WriteLine(WithStaticCtor.Field);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  NoStaticCtor    BeforeFieldInit=True
  WithStaticCtor  BeforeFieldInit=False
  calling Ping() on each (neither reads a static field):
    NoStaticCtor.Ping()
    init WithStaticCtor.Field
    WithStaticCtor.Ping()
  now reading the fields:
    init NoStaticCtor.Field
    NoStaticCtor.Field
    WithStaticCtor.Field</code></pre>
        <p>Calling <code>WithStaticCtor.Ping()</code> ran its field initialiser first; calling
        <code>NoStaticCtor.Ping()</code> did not. The field initialiser for
        <code>NoStaticCtor</code> ran later, when the field was actually read.</p>
        <p><strong>Why.</strong> A type with static field initialisers and no explicit static
        constructor is marked <code>beforefieldinit</code>, which permits the runtime to initialise
        it at any convenient moment before the first static <em>field</em> access — so calling a
        method that reads no fields need not trigger it. Writing a static constructor, even an
        empty one, removes the flag: the runtime must then initialise at the first access to any
        static member.</p>
        <p><strong>The practical change.</strong> Adding the empty constructor makes initialisation
        <em>eager and specified</em>; removing it makes it <em>lazier and unspecified</em>. That
        matters when the initialiser has an observable effect — reading configuration, opening a
        connection, registering a type, writing a log line. A refactor that adds or removes a
        static constructor for tidiness can move when that effect happens, or stop it happening at
        all.</p>
        <p>The deeper point: with <code>beforefieldinit</code> the output above is one
        <em>permitted</em> behaviour, not a guarantee. A different runtime version or inlining
        decision may initialise earlier. Never write code whose correctness depends on the
        observed order.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>An environment variable is missing, so initialisation throws. It is then set correctly and
    the value read again — in the same process. Predict what happens for a static constructor, and
    for <code>Lazy&lt;T&gt;</code> in each of its thread-safety modes. Then say which you would use
    for reading configuration, and why.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>// Attempt 1: CSPREP_MISSING_VAR is not set, so the factory throws.
// Attempt 2: the variable is set, and the value is read again.

static class ByStaticCtor
{
    public static readonly string Value;
    static ByStaticCtor()
    {
        var v = Environment.GetEnvironmentVariable("CSPREP_MISSING_VAR");
        Value = v ?? throw new InvalidOperationException("not set");
    }
}

// The same factory, wrapped in Lazy&lt;string&gt; with each mode in turn:
//   LazyThreadSafetyMode.ExecutionAndPublication
//   LazyThreadSafetyMode.PublicationOnly</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  static constructor           attempt 1: TypeInitializationException (inner InvalidOperationException)
  static constructor           attempt 2: TypeInitializationException (inner InvalidOperationException)
  Lazy ExecutionAndPublication attempt 1: InvalidOperationException
  Lazy ExecutionAndPublication attempt 2: InvalidOperationException
  Lazy PublicationOnly         attempt 1: InvalidOperationException
  Lazy PublicationOnly         attempt 2: now-set</code></pre>
        <p><strong>The static constructor poisons the type.</strong> The runtime records that
        initialisation failed and never retries, so every later access — to <em>any</em> static
        member, not only the one that failed — throws
        <code>TypeInitializationException</code> again. The real error is in
        <code>InnerException</code>. Only restarting the process recovers.</p>
        <p><strong><code>Lazy&lt;T&gt;</code> also caches the failure by default.</strong> This is
        the part that catches people, and it caught the first draft of this module.
        <code>ExecutionAndPublication</code> — the mode you get from
        <code>new Lazy&lt;T&gt;(factory)</code> or <code>isThreadSafe: true</code> — stores the
        exception and rethrows it on every later read. <code>LazyThreadSafetyMode.None</code>
        behaves the same way.</p>
        <p><strong>Only <code>PublicationOnly</code> retries.</strong> It does not cache the
        exception, so attempt 2 ran the factory again and succeeded. The trade-off is in its name:
        it permits the factory to run on several threads at once and publishes whichever result
        arrives first, so it is exactly-once <em>publication</em>, not exactly-once
        <em>execution</em>. If the factory is expensive or has side effects, that matters.</p>
        <div class="table-wrap">
        <table>
          <thead><tr><th>Mechanism</th><th>Runs once</th><th>Caches failure</th><th>Poisons other members</th></tr></thead>
          <tbody>
            <tr><td>static constructor</td><td>yes</td><td>yes</td><td><strong>yes — the whole type</strong></td></tr>
            <tr><td><code>ExecutionAndPublication</code></td><td>yes</td><td>yes</td><td>no</td></tr>
            <tr><td><code>None</code></td><td>yes (not thread-safe)</td><td>yes</td><td>no</td></tr>
            <tr><td><code>PublicationOnly</code></td><td><strong>no</strong></td><td><strong>no</strong></td><td>no</td></tr>
          </tbody>
        </table>
        </div>
        <p><strong>For reading configuration: none of these.</strong> The honest answer is to read
        configuration at startup, explicitly, and fail the process immediately with a clear message
        if it is missing — a service that cannot start is far better than one that starts and
        returns 500s from one endpoint. If it must be deferred, <code>PublicationOnly</code> is
        the only option here that recovers when the underlying problem is fixed, and it needs a
        factory that is safe to run more than once.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A test suite fails intermittently in CI and never locally. The failures are assertion
    mismatches on totals, in a different test each time, and disappear when tests are run one at a
    time. Identify the cause from the code below, explain both defects, and rewrite it. Then say
    what you would change about the <em>process</em> so the next instance is caught before CI.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 4 — as given"><code>public static class Totals
{
    public static decimal Total;
    public static void Add(decimal amount) =&gt; Total += amount;
    public static void Reset() =&gt; Total = 0m;
}

// Each test does:
//   Totals.Reset();
//   new OrderProcessor().Process(order);      // this calls Totals.Add(...)
//   Assert.Equal(expected, Totals.Total);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Two defects, and they compound.</strong></p>
        <p><strong>1. One slot for the whole process.</strong> <code>Totals.Total</code> is static,
        so every test shares it. Test frameworks run test classes in parallel by default, so
        <code>Reset()</code> in one test zeroes the total another test is midway through
        accumulating. This is why it fails only in a suite and only sometimes, and why the failing
        test differs each run — the victim is whichever test was interrupted.</p>
        <p><strong>2. <code>+=</code> is not atomic.</strong> It reads, adds, and writes back.
        Two threads can read the same value and both write their own result, losing one update
        entirely. So even with no <code>Reset()</code> races, the total can be wrong on its own.</p>
        <pre data-lang="console" data-title="Measured: two concurrent 'tests', 30 each"><code>one static slot, two concurrent 'tests' adding 30 each -&gt; 40
  each test expects 30; together they neither isolate nor reliably total 60
instance fields -&gt; t1=30, t2=30</code></pre>
        <p>40 — neither the 30 a test expects in isolation nor the 60 the two together added. And
        it is a different number on different runs, which is what makes the failure unreproducible
        and expensive.</p>
        <p><strong>The rewrite.</strong> Make the state an instance, and inject it:</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4 — rewritten"><code>public sealed class Totals
{
    private decimal _total;
    public void Add(decimal amount) =&gt; _total += amount;
    public decimal Total =&gt; _total;
}

// The code under test takes it as a constructor parameter:
public sealed class OrderProcessor
{
    private readonly Totals _totals;
    public OrderProcessor(Totals totals) =&gt; _totals = totals;

    public void Process(Order order) =&gt; _totals.Add(order.Amount);
}

// Each test creates its own:
//   var totals = new Totals();
//   var processor = new OrderProcessor(totals);
//   processor.Process(order);
//   Assert.Equal(expected, totals.Total);</code></pre>
        <pre data-lang="console" data-title="Result"><code>instance fields -&gt; t1=30, t2=30</code></pre>
        <p>No <code>Reset()</code> is needed — a fresh instance per test <em>is</em> the reset, and
        it cannot be forgotten. Both defects are gone: nothing is shared, so nothing races.</p>
        <p><strong>If the state must genuinely be shared</strong> — a real process-wide metric
        rather than a test artefact — then keep it an injected singleton and make the operation
        atomic. For a running total, <code>Interlocked</code> does not cover <code>decimal</code>,
        so use a <code>lock</code>, or accumulate in <code>long</code> minor units where
        <code>Interlocked.Add</code> applies. The <code>ConcurrentDictionary</code> in this
        module's production example is the same idea for a keyed counter.</p>
        <p><strong>The process change</strong> is the part worth more than the fix. Three things,
        in order of value:</p>
        <ol>
          <li><strong>Run the suite in parallel locally</strong>, in the same configuration as CI.
          The bug was always present; the local configuration hid it.</li>
          <li><strong>Randomise test order</strong> if the framework supports it, so order
          dependence surfaces as a failure rather than as luck.</li>
          <li><strong>Treat any static mutable field as a review blocker</strong> in code the tests
          touch. It is a mechanical check — a grep for <code>static</code> fields that are not
          <code>readonly</code> or <code>const</code> — and it catches the whole category rather
          than this instance.</li>
        </ol>
        <p>A flaky test is usually reported as a test problem. It is nearly always a design
        problem, and this is the most common one.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does <code>static</code> attach a member to, and what is the lifetime of a static
      field?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>To the <strong>type</strong> rather than to any instance: one slot per type per process.
        Its lifetime is the <strong>process</strong> — it is created before first use and never
        collected, so it is shared by every request in flight, every test running in parallel, and
        every library in that process.</p>
      </div></details>
    </li>
    <li>
      <p>What happens to a <code>const</code> when the library declaring it changes the value and
      the consumer is not rebuilt?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The consumer keeps the <strong>old value</strong>, because a <code>const</code> is
        substituted into the consumer's IL at the consumer's compile time. A
        <code>static readonly</code> field in the same class updates, because it is read from the
        loaded assembly. Silent, and fixed by a rebuild — which is why it vanishes whenever anyone
        tries to reproduce it.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>const decimal</code> report <code>IsLiteral=False</code>, and does it
      behave differently?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The CLR has no <code>decimal</code> literal, so the compiler emits a
        <code>static readonly</code> field carrying a <code>DecimalConstantAttribute</code>. The
        behaviour is <strong>the same</strong> — the compiler inlines the value from the attribute,
        so it is baked into consumers exactly like a <code>const int</code>. Only the metadata
        shape differs, which matters to tools that test <code>IsLiteral</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What is <code>beforefieldinit</code>, and what removes it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A flag on a type that has static field initialisers but no explicit static constructor.
        It permits the runtime to initialise at any moment before the first static <em>field</em>
        read, rather than at the first access to any member. Writing a static constructor —
        <strong>even an empty one</strong> — removes it and pins the timing.</p>
      </div></details>
    </li>
    <li>
      <p>Name the guarantee the runtime gives static initialisation, and the cost it carries.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Exactly-once, thread-safe</strong> initialisation with no lock written — 16
        concurrent threads produced 1 initialisation. The cost is that every other thread
        <strong>blocks</strong> until it finishes: four threads each waited 307 ms for a 300 ms
        initialiser. Slow work in a type initialiser stalls every thread that touches the
        type.</p>
      </div></details>
    </li>
    <li>
      <p>What actually happens with cyclic static initialisation on .NET 10?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Not a deadlock.</strong> The runtime returns the <strong>default value</strong>
        of the field whose initialiser has not finished, so one type's value is built on a zero
        that was never assigned. No hang, no exception, and which type gets the zero depends on
        which is touched first. The diagnostic: a static field holding an implausible default.</p>
      </div></details>
    </li>
    <li>
      <p>A test passes alone and fails in the suite. What is the first hypothesis, and the two
      quickest checks?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Static mutable state.</strong> Run the suite with parallelism disabled — if it
        passes, state is shared across threads. Run the failing test immediately after its
        predecessor, alone — if it fails, there is order dependence. Then grep for
        <code>static</code> fields that are not <code>readonly</code>, plus assignments to
        <code>CultureInfo.CurrentCulture</code> and similar.</p>
      </div></details>
    </li>
    <li>
      <p>Does <code>Lazy&lt;T&gt;</code> retry after a failed initialisation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Only with <code>PublicationOnly</code>.</strong>
        <code>ExecutionAndPublication</code> (the default when thread-safe) and <code>None</code>
        both cache the exception and rethrow it forever. <code>PublicationOnly</code> does not
        cache it, but permits the factory to run on several threads at once — exactly-once
        publication, not exactly-once execution.</p>
      </div></details>
    </li>
    <li>
      <p>How does a poisoned type differ from a cached <code>Lazy&lt;T&gt;</code> failure?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A failed type initialiser poisons the <strong>whole type</strong>: every static member
        throws <code>TypeInitializationException</code> for the life of the process. A cached
        <code>Lazy&lt;T&gt;</code> failure affects <strong>only that <code>Lazy</code></strong>,
        and surfaces as the original exception rather than a wrapper. Both need a restart unless
        the mode retries.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>static readonly List&lt;T&gt;</code> misleading?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>readonly</code> freezes the <strong>field</strong>, not the object. The list can be
        added to, cleared and reordered by anyone from any thread, for the life of the process —
        a mutable global with a reassuring keyword on it. Expose
        <code>IReadOnlyList&lt;T&gt;</code>, and remember from
        <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a> that even that
        can be cast back unless it is a genuine read-only wrapper.</p>
      </div></details>
    </li>
    <li>
      <p>Give the four replacements for the four things people use <code>static</code> for.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Immutable shared data → <code>static readonly</code> of a read-only type (correct as
        is). Expensive one-time setup → <code>Lazy&lt;T&gt;</code>. Shared mutable state → an
        injected instance, registered as a singleton. Per-operation context → a parameter, or
        <code>AsyncLocal&lt;T&gt;</code> where threading it through everything is worse.</p>
      </div></details>
    </li>
    <li>
      <p>Is a static class a design smell?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — static <em>state</em> is. A static class of pure functions has no lifetime and
        nothing to isolate in a test. The question to ask is whether it has fields that change.
        Moving stateless methods onto an instance fixes nothing.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
