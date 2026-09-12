/* ============================================================================
   Track 1, Module 9 — Encapsulation and Access Modifiers
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-09-encapsulation/.

   This file is generated from an authoring template so that the code shown is
   byte-identical to the code that was compiled. Edit it directly if you like;
   nothing downstream regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-09-encapsulation",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "Encapsulation is not politeness about fields. It is the difference between a type whose " +
    "rules are enforced and one whose rules are a comment, and between a public surface you can " +
    "change later and one you are stuck with. Changing a public field into a property is a " +
    "source-compatible change that breaks already-compiled callers at runtime.",
  terms: [
    "encapsulation", "invariant", "backing field", "auto-property", "accessor",
    "computed property", "access modifier", "private", "public", "internal",
    "protected", "protected internal", "private protected", "file-scoped type",
    "InternalsVisibleTo", "public surface", "source compatibility", "reflection",
    "serialisation", "LINQ", "anaemic domain model", "MissingFieldException",
    "FieldAccessException", "NotSupportedException", "TargetInvocationException"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Three incidents, all from code that compiled without a warning.</p>

  <p>An order in the billing database has a total of £29.97 and no line items. Not zero lines
  because it was cancelled — the total was calculated from three lines that are no longer there.
  Every method on the order class is correct in isolation. Nothing in the class ever set the
  total and the lines to disagree.</p>

  <p>A deployment goes out. The service starts, serves one request, and dies with
  <code>MissingFieldException: Field not found</code>, naming a field that is plainly present in
  the source and compiles fine. Reverting one library — not the one that changed — fixes it.
  Nobody edited a single line of the code that threw.</p>

  <p>An API endpoint that has worked for a year starts returning HTTP 500 for roughly one request
  in four thousand. The log says
  <code>TargetInvocationException: Exception has been thrown by the target of an invocation</code>
  and names no property, no field, and no record. The endpoint's own code does not appear in the
  stack trace above the serialiser.</p>

  <p>All three are encapsulation failures, and none of them look like one. The first is a type
  that let an outsider break a rule it was supposed to guarantee. The second is a change to a
  <em>field</em> that was source-compatible and binary-incompatible. The third is a
  <strong>property</strong> that does work, called by something that assumed reading a property
  is free and safe.</p>

  <p>This module is about which decisions in a type's public surface you can reverse later, and
  which ones you are stuck with.</p>
</section>

<section id="what-encapsulation-is">
  <h2>What encapsulation actually is</h2>

  <p>The usual explanation — "hide your fields behind properties" — describes a habit without
  saying what the habit buys. Two things, and they are worth separating because they fail
  differently.</p>

  <p class="define"><span class="define__term">Encapsulation</span> Keeping a type's data and the
  rules about that data together, so that the rules cannot be sidestepped by anyone using the
  type. The data is reachable only through code you wrote, which means every change to it passes
  through a place you control.</p>

  <p class="define"><span class="define__term">Invariant</span> A statement about an object that
  is true for its whole life. "The total equals the sum of the lines." "The quantity is at least
  one." "If the status is <code>Shipped</code>, the dispatch date is not null." An invariant is
  not enforced by writing it in a comment. It is enforced by making the states that violate it
  unreachable. (Unrelated to <em>invariant culture</em> from
  <a href="#/m/t1-02-variables-and-types">Variables, Types, and Type Inference</a>, which
  borrows the same English word for a different idea.)</p>

  <p>So encapsulation buys, first, <strong>enforceable invariants</strong>: an object that cannot
  be put into a state its own rules forbid, no matter what the calling code does.</p>

  <p>And second, <strong>freedom to change your mind</strong>. Everything visible from outside a
  type is a promise. The smaller the set of promises, the more of the type you can rewrite
  without anyone noticing.</p>

  <p class="define"><span class="define__term">Public surface</span> Everything about a type that
  code outside it can see and depend on: the names, types, and shapes of its accessible members.
  Also called the <em>API surface</em>. Everything in it is a commitment; everything outside it
  is yours to change.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>A payments team had a
    <code>Money</code> class with a <code>public decimal Amount</code> field, used by 41 call
    sites across six services. When a rounding bug turned up, the fix needed the amount to be
    stored in minor units (pence) internally while still being read as pounds. With a field, the
    storage <em>is</em> the surface: there is nowhere to put the conversion. The change meant
    editing all 41 call sites in one coordinated release across six deployables. With a property
    it would have been four lines inside one class, and nothing else would have needed
    recompiling — a point this module demonstrates by running it.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest version of the idea</h2>

  <p>Two classes holding identical data. One states its rules in a comment; the other enforces
  them.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-invariants.cs"><code>// 01-invariants.cs — what encapsulation actually buys: an object that cannot
// be put into a state its own rules forbid.
// .NET 10.0.400. Run: dotnet run 01-invariants.cs

using System;

// ---- Version A: public fields. No rules can be enforced. -------------------
class OpenBasketLine
{
    public string Sku = "";
    public int Quantity;
    public decimal UnitPrice;

    public decimal Total =&gt; Quantity * UnitPrice;
}

// ---- Version B: the same data, with the rules attached to it. --------------
class ClosedBasketLine
{
    private int _quantity;

    public string Sku { get; }
    public decimal UnitPrice { get; }

    public int Quantity
    {
        get =&gt; _quantity;
        set
        {
            if (value &lt; 1)
                throw new ArgumentOutOfRangeException(
                    nameof(value), value, "Quantity must be at least 1.");
            if (value &gt; 999)
                throw new ArgumentOutOfRangeException(
                    nameof(value), value, "Quantity must be 999 or fewer.");
            _quantity = value;
        }
    }

    public ClosedBasketLine(string sku, int quantity, decimal unitPrice)
    {
        if (string.IsNullOrWhiteSpace(sku))
            throw new ArgumentException("SKU is required.", nameof(sku));
        if (unitPrice &lt; 0m)
            throw new ArgumentOutOfRangeException(
                nameof(unitPrice), unitPrice, "Unit price cannot be negative.");

        Sku = sku;
        UnitPrice = unitPrice;
        Quantity = quantity;   // goes through the setter, so it is checked too
    }

    public decimal Total =&gt; _quantity * UnitPrice;
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- open version: every rule is optional ---");
        var open = new OpenBasketLine { Sku = "WIDGET-1", Quantity = -3, UnitPrice = 9.99m };
        Console.WriteLine($"quantity {open.Quantity}, total {open.Total}");

        open.Quantity = 0;
        open.UnitPrice = -100m;
        Console.WriteLine($"quantity {open.Quantity}, total {open.Total}");

        Console.WriteLine();
        Console.WriteLine("--- closed version: the rules travel with the data ---");
        var closed = new ClosedBasketLine("WIDGET-1", 3, 9.99m);
        Console.WriteLine($"quantity {closed.Quantity}, total {closed.Total}");

        try
        {
            closed.Quantity = -3;
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"rejected: {ex.GetType().Name}: {ex.Message.Split('(')[0].Trim()}");
        }

        try
        {
            var bad = new ClosedBasketLine("WIDGET-1", 3, -100m);
            Console.WriteLine($"constructed: {bad.Total}");
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"rejected at construction: {ex.ParamName}");
        }

        Console.WriteLine($"still valid: quantity {closed.Quantity}, total {closed.Total}");
    }
}</code></pre>

  <p>Output:</p>

  <pre data-lang="console" data-title="Output"><code>--- open version: every rule is optional ---
quantity -3, total -29.97
quantity 0, total 0

--- closed version: the rules travel with the data ---
quantity 3, total 29.97
rejected: ArgumentOutOfRangeException: Quantity must be at least 1.
rejected at construction: unitPrice
still valid: quantity 3, total 29.97</code></pre>

  <p>Three things in that code are worth naming before going further.</p>

  <p class="define"><span class="define__term">Accessor</span> One of the two blocks of code
  inside a property: the <code>get</code>, which runs when something reads the property, and the
  <code>set</code>, which runs when something assigns to it. A property can have either, both, or
  a <code>get</code> plus the <code>init</code> accessor covered in
  <a href="#/m/t1-08-classes-and-objects">Classes and Objects</a>.</p>

  <p class="define"><span class="define__term">Backing field</span> The field a property stores
  its value in. In <code>ClosedBasketLine</code>, <code>_quantity</code> is the backing field for
  <code>Quantity</code>, written out by hand because the setter needs somewhere to put the value
  after checking it.</p>

  <p class="define"><span class="define__term">Auto-property</span> A property written
  <code>public int Quantity { get; set; }</code>, with no accessor bodies. The compiler writes
  the backing field and both accessor bodies for you. <code>Sku</code> and <code>UnitPrice</code>
  above are auto-properties with only a getter, so they can be assigned in the constructor and
  never again.</p>

  <p>Inside the <code>value</code> keyword is the incoming value — the right-hand side of the
  assignment that triggered the setter. It is a parameter the compiler supplies.</p>

  <p>Notice the constructor of <code>ClosedBasketLine</code> assigns <code>Quantity</code>, not
  <code>_quantity</code>. That is deliberate: routing construction through the setter means the
  check happens once, in one place, and cannot be skipped by a future constructor overload that
  someone adds without reading the rest of the class.</p>

  <div class="callout callout--gotcha">
    <h4>The open version fails before it runs</h4>
    <p>Compile
    <code>OpenBasketLine</code> with <code>public string Sku;</code> and the compiler emits
    warning CS8618: "Non-nullable field 'Sku' must contain a non-null value when exiting
    constructor." The class has no constructor, so there is no point at which the field is
    guaranteed to be set. The version above assigns <code>= ""</code> to silence it. A type with
    public fields and no constructor cannot state which of its fields are required — that is the
    same missing guarantee, showing up as a nullability warning.</p>
  </div>
</section>

<section id="what-a-property-is">
  <h2>What a property actually compiles to</h2>

  <p><a href="#/m/t1-08-classes-and-objects">Classes and Objects</a> described a property as "a
  member that looks like a field". That is how it reads at the call site. It is not what the
  compiler produces, and the difference is the whole of this module's second half.</p>

  <p>A property is <strong>a pair of methods</strong>, plus a hidden field if it needs storage.
  This program asks the compiled type what members it really has.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-what-a-property-is.cs"><code>// 02-what-a-property-is.cs — a property is a pair of methods plus, usually, a
// hidden field. This prints the members the compiler actually generated.
// .NET 10.0.400. Run: dotnet run 02-what-a-property-is.cs

using System;
using System.Linq;
using System.Reflection;

class Sample
{
    public int PlainField = 0;                       // a field, and nothing else

    public int AutoProperty { get; set; }        // compiler writes field + 2 methods

    public int GetOnly { get; }                  // field + 1 method

    private int _celsius;
    public int Fahrenheit                        // no backing field of its own
    {
        get =&gt; (_celsius * 9 / 5) + 32;
        set =&gt; _celsius = (value - 32) * 5 / 9;
    }
}

class Program
{
    const BindingFlags All =
        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;

    static void Main()
    {
        var t = typeof(Sample);

        Console.WriteLine("FIELDS the type really has:");
        foreach (var f in t.GetFields(All).OrderBy(f =&gt; f.Name))
        {
            string vis = f.IsPublic ? "public " : "private";
            Console.WriteLine($"  {vis}  {f.FieldType.Name,-6} {f.Name}");
        }

        Console.WriteLine();
        Console.WriteLine("METHODS the type really has (excluding inherited):");
        foreach (var m in t.GetMethods(All)
                           .Where(m =&gt; m.DeclaringType == t)
                           .OrderBy(m =&gt; m.Name))
        {
            Console.WriteLine($"  {m.ReturnType.Name,-6} {m.Name}(" +
                string.Join(", ", m.GetParameters().Select(p =&gt; p.ParameterType.Name)) + ")");
        }

        Console.WriteLine();
        Console.WriteLine("PROPERTIES as the compiler records them:");
        foreach (var p in t.GetProperties(All).OrderBy(p =&gt; p.Name))
        {
            string getter = p.GetMethod?.Name ?? "(none)";
            string setter = p.SetMethod?.Name ?? "(none)";
            Console.WriteLine($"  {p.Name,-14} get={getter,-18} set={setter}");
        }

        Console.WriteLine();
        Console.WriteLine("A property is not a storage location:");
        Console.WriteLine($"  PlainField is a field?    {t.GetField("PlainField") != null}");
        Console.WriteLine($"  AutoProperty is a field?  {t.GetField("AutoProperty") != null}");
        Console.WriteLine($"  Fahrenheit has a field?   " +
            $"{t.GetFields(All).Any(f =&gt; f.Name.Contains("Fahrenheit"))}");
    }
}</code></pre>

  <p>The technique it uses has a name.</p>

  <p class="define"><span class="define__term">Reflection</span> Reading a type's own metadata at
  runtime — its fields, methods, properties and their names — and optionally calling or assigning
  through what you find. <a href="#/m/t1-01-what-a-program-is">What a Program Is</a> described
  metadata as the description of your types that the compiler writes into the assembly alongside
  the IL. Reflection is the API for reading it back.</p>

  <p>Output:</p>

  <pre data-lang="console" data-title="Output"><code>FIELDS the type really has:
  private  Int32  _celsius
  private  Int32  &lt;AutoProperty&gt;k__BackingField
  private  Int32  &lt;GetOnly&gt;k__BackingField
  public   Int32  PlainField

METHODS the type really has (excluding inherited):
  Int32  get_AutoProperty()
  Int32  get_Fahrenheit()
  Int32  get_GetOnly()
  Void   set_AutoProperty(Int32)
  Void   set_Fahrenheit(Int32)

PROPERTIES as the compiler records them:
  AutoProperty   get=get_AutoProperty   set=set_AutoProperty
  Fahrenheit     get=get_Fahrenheit     set=set_Fahrenheit
  GetOnly        get=get_GetOnly        set=(none)

A property is not a storage location:
  PlainField is a field?    True
  AutoProperty is a field?  False
  Fahrenheit has a field?   False</code></pre>

  <p>Read that carefully, because four separate facts are visible in it.</p>

  <p><strong>Auto-properties generate a field with an unspeakable name.</strong>
  <code>&lt;AutoProperty&gt;k__BackingField</code> contains angle brackets, which C# does not
  allow in an identifier. That is on purpose: the compiler picks a name you cannot type, so no
  source code can bypass the accessors and reach the storage directly.</p>

  <p><strong>Every property read is a method call in the IL.</strong> Not a field load — a call to
  <code>get_Something</code>. Whether that call survives into the machine code is a separate
  question, answered in the next section.</p>

  <p><strong>A get-only property still has a backing field.</strong>
  <code>&lt;GetOnly&gt;k__BackingField</code> exists; there is no <code>set_GetOnly</code> to
  write to it from outside. The constructor writes the field directly.</p>

  <p><strong>A property need not have storage at all.</strong> <code>Fahrenheit</code> has no
  backing field. It computes from <code>_celsius</code> on every read and writes back to
  <code>_celsius</code> on every assignment. From outside it is indistinguishable from stored
  data.</p>

  <p class="define"><span class="define__term">Computed property</span> A property whose getter
  calculates a value rather than returning stored state. Free to write, and the source of the
  third incident at the top of this module.</p>
</section>

<section id="the-cost">
  <h2>What the indirection costs</h2>

  <p>If every property read is a method call, wrapping fields in properties should be slower. The
  claim is testable, so it should be tested rather than assumed.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-property-cost.cs"><code>// 03-property-cost.cs — does wrapping a field in a property cost anything?
// Measured, not asserted. .NET 10.0.400, Release, x64.
// Run: dotnet run -c Release 03-property-cost.cs

using System;
using System.Diagnostics;

class Holder
{
    public int Field;
    public int Auto { get; set; }

    private int _validated;
    public int Validated
    {
        get =&gt; _validated;
        set
        {
            if (value &lt; 0) throw new ArgumentOutOfRangeException(nameof(value));
            _validated = value;
        }
    }

    public virtual int Virtual { get; set; }
}

class Derived : Holder
{
    public override int Virtual { get =&gt; base.Virtual; set =&gt; base.Virtual = value; }
}

class Program
{
    const int N = 200_000_000;

    static long ReadField(Holder h)
    {
        long sum = 0;
        for (int i = 0; i &lt; N; i++) sum += h.Field;
        return sum;
    }

    static long ReadAuto(Holder h)
    {
        long sum = 0;
        for (int i = 0; i &lt; N; i++) sum += h.Auto;
        return sum;
    }

    static long ReadValidated(Holder h)
    {
        long sum = 0;
        for (int i = 0; i &lt; N; i++) sum += h.Validated;
        return sum;
    }

    static long ReadVirtual(Holder h)
    {
        long sum = 0;
        for (int i = 0; i &lt; N; i++) sum += h.Virtual;
        return sum;
    }

    static void Time(string label, Func&lt;Holder, long&gt; body, Holder h, int rounds)
    {
        body(h);                                    // warm up / let the JIT tier up
        for (int r = 0; r &lt; rounds; r++)
        {
            var sw = Stopwatch.StartNew();
            long sum = body(h);
            sw.Stop();
            Console.WriteLine($"  {label,-22} {sw.Elapsed.TotalMilliseconds,7:F1} ms   " +
                              $"(sum {sum}, {N / sw.Elapsed.TotalSeconds / 1e9,4:F2} G reads/s)");
        }
    }

    static void Main()
    {
        Console.WriteLine($"server GC: {System.Runtime.GCSettings.IsServerGC}, " +
                          $"64-bit: {Environment.Is64BitProcess}, N = {N:N0} per run");
        Console.WriteLine();

        var sealedHolder = new Holder { Field = 3, Auto = 3, Validated = 3, Virtual = 3 };
        var derivedHolder = new Derived { Field = 3, Auto = 3, Validated = 3, Virtual = 3 };

        Console.WriteLine("Reading through a reference whose exact type the JIT can see:");
        Time("public field", ReadField, sealedHolder, 3);
        Time("auto-property", ReadAuto, sealedHolder, 3);
        Time("property + validation", ReadValidated, sealedHolder, 3);
        Time("virtual property", ReadVirtual, sealedHolder, 3);

        Console.WriteLine();
        Console.WriteLine("Same virtual property, but two types are in play so it cannot be");
        Console.WriteLine("resolved to one target:");
        Time("virtual (base)", ReadVirtual, sealedHolder, 2);
        Time("virtual (derived)", ReadVirtual, derivedHolder, 2);
    }
}</code></pre>

  <p>Two samples, Release build, .NET 10.0.400 on Windows 11 x64, 200 million reads per run:</p>

  <div class="table-wrap">
  <table>
    <thead>
      <tr><th>Read through</th><th>Sample 1</th><th>Sample 2</th></tr>
    </thead>
    <tbody>
      <tr><td>public field</td><td>190&ndash;200 ms</td><td>150&ndash;170 ms</td></tr>
      <tr><td>auto-property</td><td>190&ndash;219 ms</td><td>148&ndash;155 ms</td></tr>
      <tr><td>property with a validating setter</td><td>145&ndash;182 ms</td><td>147&ndash;161 ms</td></tr>
      <tr><td>virtual property, one type in play</td><td>184&ndash;247 ms</td><td>178&ndash;189 ms</td></tr>
      <tr><td>virtual property, two types in play</td><td>1168&ndash;1258 ms</td><td>1002&ndash;1021 ms</td></tr>
    </tbody>
  </table>
  </div>

  <p>The first three rows are indistinguishable. Their ranges overlap completely, and the
  ordering between them changes from sample to sample — which is what measurement noise looks
  like, and the reason the standing rule in this course is to quote ranges from repeated runs
  rather than a single number. The JIT compiler inlines the accessor, as described in
  <a href="#/m/t1-05-methods-and-parameters">Methods, Arguments, and Parameters</a>: the call
  disappears, and what remains is the same field load the plain field produced.</p>

  <p>The validating property is not slower either, and the reason is worth stating because it is
  a common source of misplaced worry: the validation is in the <em>setter</em>. This loop only
  reads. Validation costs nothing on a path that never runs it.</p>

  <p>The last row is the one real cost, and it is not about properties. When only one type is in
  play, the JIT can prove which method a <code>virtual</code> call will land on and inline it
  anyway. Introduce a second type and it cannot, so every read becomes a genuine indirect call:
  roughly <strong>six times slower</strong>. That cost belongs to <code>virtual</code>, not to
  properties, and <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a> is where
  it is taken apart.</p>

  <div class="callout callout--note">
    <h4>What this does and does not license</h4>
    <p>It says the property
    <em>abstraction</em> is free for simple accessors on a hot path. It says nothing about a
    getter that does work — the section on side effects below measures one that is 138 times
    slower than the stored equivalent. "Properties are as fast as fields" holds only for
    properties that do as little as fields.</p>
  </div>
</section>

<section id="binary-compatibility">
  <h2>The change that compiles and then fails</h2>

  <p>This is the part that turns "use properties" from a style preference into a decision with
  consequences you cannot undo.</p>

  <p><a href="#/m/t1-05-methods-and-parameters">Methods, Arguments, and Parameters</a> introduced
  the distinction this turns on.</p>

  <p class="define"><span class="define__term">Source compatibility</span> Whether code that
  referred to the old version still <em>compiles</em> against the new one.</p>

  <p class="define"><span class="define__term">Binary compatibility</span> Whether code that was
  already <em>compiled</em> against the old version still runs against the new one, without being
  rebuilt.</p>

  <p>Turning a public field into a property is source-compatible. Every call site reads exactly
  the same. It is not binary-compatible, because a field access and a property call are different
  instructions in the IL, and the caller's IL was written before the change.</p>

  <p>Here is that, run. Two assemblies: a library holding the configuration type, and an
  application that reads one value from it.</p>

  <p class="define"><span class="define__term">Assembly</span> Recalling
  <a href="#/m/t1-01-what-a-program-is">What a Program Is</a>: the <code>.dll</code> or
  <code>.exe</code> file the compiler produces, containing IL and metadata. It is the unit that
  gets deployed, versioned, and — as here — replaced independently.</p>

  <p>Version 1 of the library:</p>

  <pre data-lang="csharp" data-net="10" data-title="PricingConfig.v1"><code>namespace Contracts;

// VERSION 1 — Markup is a public FIELD.
public class PricingConfig
{
    public decimal Markup;

    public PricingConfig(decimal markup) =&gt; Markup = markup;
}</code></pre>

  <p>The application, which is never edited again for the rest of this demonstration:</p>

  <pre data-lang="csharp" data-net="10" data-title="Program.cs"><code>using System;
using Contracts;

class Program
{
    static void Main()
    {
        var config = new PricingConfig(1.25m);

        // This one line is what the whole demonstration turns on.
        decimal markup = config.Markup;

        Console.WriteLine($"App read Markup = {markup}");
        Console.WriteLine($"Price of 80.00 becomes {80.00m * markup}");
    }
}</code></pre>

  <p>Built together and run, it behaves as expected:</p>

  <pre data-lang="console" data-title="Output — v1, Markup is a field"><code>App read Markup = 1.25
Price of 80.00 becomes 100.0000</code></pre>

  <p>Now the library author decides <code>Markup</code> should be a property — perhaps because
  they want to add validation next sprint. A one-word change:</p>

  <pre data-lang="csharp" data-net="10" data-title="PricingConfig.v2"><code>namespace Contracts;

// VERSION 2 — identical source-level usage, but Markup is now a PROPERTY.
// Source-compatible. Binary-INcompatible.
public class PricingConfig
{
    public decimal Markup { get; set; }

    public PricingConfig(decimal markup) =&gt; Markup = markup;
}</code></pre>

  <p>The library is rebuilt on its own, and the new <code>Contracts.dll</code> is dropped in
  beside the existing, untouched <code>App.exe</code> — which is what a package upgrade, a
  hotfix, or a shared-folder deployment does:</p>

  <pre data-lang="console" data-title="Output — v2 dropped in, App.exe not rebuilt"><code>Unhandled exception. System.MissingFieldException: Field not found: 'Contracts.PricingConfig.Markup'.
   at Program.Main()

exit code: 127</code></pre>

  <p>Nothing in the application changed. Its source still compiles against the new library
  without a warning. Rebuilding it fixes the problem completely — which is the trap, because it
  means the failure never appears on the machine of whoever made the change. They rebuild
  everything every time. It appears in production, where the library shipped as a package and the
  application was not rebuilt.</p>

  <div class="callout callout--gotcha">
    <h4>The reverse direction breaks too</h4>
    <p>Turning a property back into a field
    produces <code>MissingMethodException</code> instead, naming <code>get_Markup</code>. And this
    is not limited to fields and properties: changing a property into a method, renaming a
    parameter that callers pass by name, or reordering the members of an enum are all
    source-level changes with binary consequences.</p>
  </div>

  <p>Now the payoff. Version 3 keeps <code>Markup</code> a property and adds validation and a side
  effect inside the accessor — a far larger change to the code than version 2 was:</p>

  <pre data-lang="csharp" data-net="10" data-title="PricingConfig.cs"><code>namespace Contracts;

// VERSION 3 — the payoff. The accessor gains validation and a side effect.
// The public surface is unchanged, so App.exe keeps working uncompiled.
public class PricingConfig
{
    private decimal _markup;

    public decimal Markup
    {
        get
        {
            System.Console.WriteLine("   [Contracts v3] Markup getter ran");
            return _markup;
        }
        set
        {
            if (value &lt; 1m)
                throw new System.ArgumentOutOfRangeException(
                    nameof(value), value, "Markup below 1.0 would sell at a loss.");
            _markup = value;
        }
    }

    public PricingConfig(decimal markup) =&gt; Markup = markup;
}</code></pre>

  <p>Dropped in beside the same already-compiled <code>App.exe</code>:</p>

  <pre data-lang="console" data-title="Output — v3 dropped in, App.exe not rebuilt"><code>   [Contracts v3] Markup getter ran
App read Markup = 1.25
Price of 80.00 becomes 100.0000</code></pre>

  <p>It runs, and the new code inside the accessor runs with it. That is the actual argument for
  properties, and it is not about style: <strong>a property is a place to put a decision you have
  not made yet.</strong> A field is not. The cost of choosing a property up front is zero, as the
  previous section measured. The cost of choosing a field and changing your mind is a coordinated
  rebuild of everything that referenced it.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>This is why the .NET base class library
    exposes almost no public fields, and why analyser rule CA1051 ("Do not declare visible
    instance fields") exists. It is also why the exceptions are exceptions: <code>public</code>
    fields are defensible in a type that ships in the same assembly as everything using it, and in
    <code>struct</code> types designed for interop or performance, where the memory layout
    <em>is</em> the contract. The rule is not "fields are bad". It is "a public field publishes
    your storage decision, so only publish one you are willing to keep".</p>
  </div>
</section>

<section id="access-modifiers">
  <h2>The six access levels, and the seventh</h2>

  <p class="define"><span class="define__term">Access modifier</span> A keyword on a type or a
  member that decides which other code is allowed to refer to it by name. It restricts nothing
  else: it is not a security boundary, and it does not affect how fast the code runs.</p>

  <p>Two axes decide everything. Is the calling code <em>inside the same assembly</em>? Is it
  <em>inside a type derived from</em> the one declaring the member? Every modifier is an answer
  to those two questions.</p>

  <div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Modifier</th><th>Same type</th><th>Derived, same assembly</th>
        <th>Unrelated, same assembly</th><th>Derived, other assembly</th>
        <th>Unrelated, other assembly</th>
      </tr>
    </thead>
    <tbody>
      <tr><td><code>private</code></td><td>yes</td><td>no</td><td>no</td><td>no</td><td>no</td></tr>
      <tr><td><code>private protected</code></td><td>yes</td><td>yes</td><td>no</td><td>no</td><td>no</td></tr>
      <tr><td><code>internal</code></td><td>yes</td><td>yes</td><td>yes</td><td>no</td><td>no</td></tr>
      <tr><td><code>protected</code></td><td>yes</td><td>yes</td><td>no</td><td>yes</td><td>no</td></tr>
      <tr><td><code>protected internal</code></td><td>yes</td><td>yes</td><td>yes</td><td>yes</td><td>no</td></tr>
      <tr><td><code>public</code></td><td>yes</td><td>yes</td><td>yes</td><td>yes</td><td>yes</td></tr>
    </tbody>
  </table>
  </div>

  <p>That table assumes the two assemblies are strangers. The <code>InternalsVisibleTo</code>
  attribute, later in this section, changes three of those rows at once.</p>

  <p>The two compound names are the ones people misread, and the mistake is predictable because
  English and C# disagree about what the space means:</p>

  <ul>
    <li><code>protected internal</code> means protected <strong>OR</strong> internal — the
    <em>wider</em> of the two. Anything in this assembly, plus derived types anywhere.</li>
    <li><code>private protected</code> means protected <strong>AND</strong> internal — the
    <em>narrower</em>. Derived types, but only those in this assembly.</li>
  </ul>

  <p>Reading them as "protected, and also internal" gets the first right by accident and the
  second exactly backwards. The reliable reading: the runtime's own names for these levels are
  <code>FamilyOrAssembly</code> and <code>FamilyAndAssembly</code>, where "family" means derived
  types. The program below prints those names off the compiled metadata.</p>

  <pre data-lang="csharp" data-net="10" data-title="07-access-modifiers.cs"><code>// 07-access-modifiers.cs — what each modifier permits, and what you get when
// you write none. .NET 10.0.400. Run: dotnet run 07-access-modifiers.cs

using System;
using System.Linq;
using System.Reflection;

class Base
{
    private int _private = 1;
    protected int Protected = 2;
    internal int Internal = 3;
    protected internal int ProtectedInternal = 4;   // protected OR internal
    private protected int PrivateProtected = 5;     // protected AND internal
    public int Public = 6;

    int _noModifier = 7;                            // members default to private

    public string WhatBaseCanSee() =&gt;
        $"{_private} {Protected} {Internal} {ProtectedInternal} {PrivateProtected} " +
        $"{Public} {_noModifier}";
}

class Derived : Base
{
    public string WhatADerivedTypeCanSee()
    {
        // _private and _noModifier do not compile here.
        return $"Protected={Protected} Internal={Internal} " +
               $"ProtectedInternal={ProtectedInternal} " +
               $"PrivateProtected={PrivateProtected} Public={Public}";
    }
}

class Outside
{
    public string WhatAnUnrelatedTypeCanSee(Base b)
    {
        // Protected, PrivateProtected, _private and _noModifier do not compile here.
        // Internal and ProtectedInternal DO, because this is the same assembly.
        return $"Internal={b.Internal} ProtectedInternal={b.ProtectedInternal} " +
               $"Public={b.Public}";
    }
}

class NoModifierType { }        // top-level types default to internal

public class PublicType { }

class Program
{
    static void Main()
    {
        Console.WriteLine("--- defaults, read back off the compiled metadata ---");
        Report(typeof(NoModifierType));
        Report(typeof(PublicType));
        Console.WriteLine();

        var noMod = typeof(Base).GetField("_noModifier",
            BindingFlags.NonPublic | BindingFlags.Instance)!;
        Console.WriteLine($"member with no modifier '_noModifier': " +
                          $"IsPrivate={noMod.IsPrivate}, IsPublic={noMod.IsPublic}");

        Console.WriteLine();
        Console.WriteLine("--- how the runtime names each level ---");
        foreach (var f in typeof(Base)
                 .GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                 .OrderBy(f =&gt; f.Name))
        {
            Console.WriteLine($"  {f.Name,-20} {Describe(f)}");
        }

        Console.WriteLine();
        Console.WriteLine("--- who can actually read what ---");
        Console.WriteLine($"  the declaring type : {new Base().WhatBaseCanSee()}");
        Console.WriteLine($"  a derived type     : {new Derived().WhatADerivedTypeCanSee()}");
        Console.WriteLine($"  an unrelated type  : {new Outside().WhatAnUnrelatedTypeCanSee(new Base())}");
    }

    static void Report(Type t) =&gt;
        Console.WriteLine($"  {t.Name,-16} IsPublic={t.IsPublic,-6} IsNotPublic={t.IsNotPublic}");

    static string Describe(FieldInfo f) =&gt;
        f.IsPrivate ? "private"
        : f.IsFamily ? "protected (family)"
        : f.IsAssembly ? "internal (assembly)"
        : f.IsFamilyOrAssembly ? "protected internal (family OR assembly)"
        : f.IsFamilyAndAssembly ? "private protected (family AND assembly)"
        : f.IsPublic ? "public"
        : "?";
}</code></pre>

  <p>Output:</p>

  <pre data-lang="console" data-title="Output"><code>--- defaults, read back off the compiled metadata ---
  NoModifierType   IsPublic=False  IsNotPublic=True
  PublicType       IsPublic=True   IsNotPublic=False

member with no modifier '_noModifier': IsPrivate=True, IsPublic=False

--- how the runtime names each level ---
  _noModifier          private
  _private             private
  Internal             internal (assembly)
  PrivateProtected     private protected (family AND assembly)
  Protected            protected (family)
  ProtectedInternal    protected internal (family OR assembly)
  Public               public

--- who can actually read what ---
  the declaring type : 1 2 3 4 5 6 7
  a derived type     : Protected=2 Internal=3 ProtectedInternal=4 PrivateProtected=5 Public=6
  an unrelated type  : Internal=3 ProtectedInternal=4 Public=6</code></pre>

  <p>The defaults are worth memorising, because they differ by nesting level and C# never asks
  you to confirm them:</p>

  <ul>
    <li>A <strong>member</strong> with no modifier is <code>private</code>.</li>
    <li>A <strong>top-level type</strong> with no modifier is <code>internal</code>, not public.
    A class you write and forget to mark <code>public</code> is invisible outside its own
    assembly.</li>
    <li>An <code>interface</code> member is <code>public</code> and cannot be anything else
    without explicit syntax — covered in
    <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and
    Interfaces</a>.</li>
  </ul>

  <h3>Where the levels actually diverge</h3>

  <p>Inside one assembly, <code>internal</code> and <code>public</code> behave identically, so the
  distinction is invisible until a second assembly exists. This library declares one member at
  each level:</p>

  <pre data-lang="csharp" data-net="10" data-title="Widget.cs"><code>using System.Runtime.CompilerServices;

// Comment this line out to watch Consumer stop compiling.
[assembly: InternalsVisibleTo("Consumer")]

namespace Lib;

public class Widget
{
    public int Public = 1;
    internal int Internal = 2;
    protected int Protected = 3;
    protected internal int ProtectedInternal = 4;   // protected OR internal
    private protected int PrivateProtected = 5;     // protected AND internal

    public string All() =&gt;
        $"{Public} {Internal} {Protected} {ProtectedInternal} {PrivateProtected}";
}</code></pre>

  <p>And a separate assembly consumes it:</p>

  <pre data-lang="csharp" data-net="10" data-title="Program.cs"><code>using System;
using Lib;

// A type in ANOTHER assembly that inherits from Widget.
class ForeignDerived : Widget
{
    public string WhatICanSee()
    {
        // PrivateProtected does NOT compile here: "private protected" means
        // derived AND same assembly. This is a different assembly.
        return $"Public={Public} Protected={Protected} " +
               $"ProtectedInternal={ProtectedInternal}";
    }
}

class Program
{
    static void Main()
    {
        var w = new Widget();

        // Internal is visible only because of InternalsVisibleTo("Consumer").
        Console.WriteLine($"Public   = {w.Public}");
        Console.WriteLine($"Internal = {w.Internal}   (only via InternalsVisibleTo)");
        Console.WriteLine($"ProtectedInternal = {w.ProtectedInternal}   (internal half applies)");
        Console.WriteLine($"all, from inside Lib: {w.All()}");
        Console.WriteLine($"from a foreign subclass: {new ForeignDerived().WhatICanSee()}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Public   = 1
Internal = 2   (only via InternalsVisibleTo)
ProtectedInternal = 4   (internal half applies)
all, from inside Lib: 1 2 3 4 5
from a foreign subclass: Public=1 Protected=3 ProtectedInternal=4</code></pre>

  <p class="define"><span class="define__term">InternalsVisibleTo</span> An assembly-level
  attribute naming another assembly that is allowed to see this one's <code>internal</code>
  members. Its usual purpose is letting a test project reach code that should not be part of the
  public surface. It is a one-way grant, and it is checked at compile time <em>and</em> at
  runtime.</p>

  <p>Comment that attribute out, rebuild the consumer, and the two errors that appear are not the
  same error — a distinction that saves time when reading a build log:</p>

  <pre data-lang="console" data-title="Consumer build errors, InternalsVisibleTo removed"><code>error CS1061: 'Widget' does not contain a definition for 'Internal' and no accessible
              extension method 'Internal' accepting a first argument of type 'Widget'
              could be found (are you missing a using directive or an assembly reference?)

error CS0122: 'Widget.ProtectedInternal' is inaccessible due to its protection level</code></pre>

  <p><strong>CS0122 means the member exists and you may not touch it. CS1061 and CS0103 mean the
  compiler cannot see it at all.</strong> An <code>internal</code> member you are not granted is
  erased from view entirely, which is why the error talks about extension methods and missing
  <code>using</code> directives — the compiler has genuinely no idea the name refers to anything.
  Reaching for a <code>protected</code> member from an unrelated type in the same assembly, by
  contrast, gives CS0122, because the member is right there and the rule is what stops you.</p>

  <p>Probing each level from the other assembly, with and without the attribute, produces this.
  Both columns are from clean builds:</p>

  <div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Reached from the consumer assembly</th>
        <th>With <code>InternalsVisibleTo</code></th>
        <th>Without it</th>
      </tr>
    </thead>
    <tbody>
      <tr><td><code>Internal</code>, unrelated type</td><td>compiles</td><td>CS1061</td></tr>
      <tr><td><code>Protected</code>, unrelated type</td><td>CS0122</td><td>CS0122</td></tr>
      <tr><td><code>ProtectedInternal</code>, unrelated type</td><td>compiles</td><td>CS0122</td></tr>
      <tr><td><code>PrivateProtected</code>, derived type</td><td><strong>compiles</strong></td><td>CS0103</td></tr>
    </tbody>
  </table>
  </div>

  <p>The last row is the one that is not obvious, and it is the reason the attribute deserves more
  care than it usually gets. <strong><code>InternalsVisibleTo</code> does not only widen
  <code>internal</code>.</strong> It grants the named assembly "same assembly" identity for the
  purpose of every accessibility rule, so <code>protected internal</code> and
  <code>private protected</code> widen with it. <code>private protected</code> — the narrowest
  level that is not <code>private</code> — becomes reachable from a derived type in the friend
  assembly.</p>

  <p>The <code>Protected</code> row is unchanged by the attribute, which is the check that the
  explanation is right: <code>protected</code> says nothing about assemblies, so granting one
  changes nothing about it.</p>

  <div class="callout callout--warn">
    <h4>What that means when you use it</h4>
    <p><code>InternalsVisibleTo</code> is
    usually added so a test project can reach a helper. The grant is not scoped to the members you
    had in mind: it applies to every <code>internal</code>, <code>protected internal</code> and
    <code>private protected</code> member in the whole assembly, for the life of the attribute.
    Adding a test project is a fine reason to use it. It is a poor way to let one production
    assembly reach into another, because it silently makes three access levels equivalent to
    <code>public</code> for that consumer, and nothing in the consuming code records that a
    boundary was crossed.</p>
  </div>

  <h3>The seventh: file</h3>

  <p class="define"><span class="define__term">File-scoped type</span> A type declared with the
  <code>file</code> modifier, visible only inside the single source file that declares it. Not
  the namespace, not the assembly — the file. Added in C# 11 and available in .NET 10.</p>

  <p>It exists because source generators need to emit helper types without those names colliding
  with anything, but it is useful by hand whenever a helper genuinely belongs to one file:</p>

  <pre data-lang="csharp" data-net="10" data-title="Csv.cs"><code>using System;

// "file" means: visible only inside THIS source file. Not the namespace,
// not the assembly. The file.
file class Formatter
{
    public static string Format(string[] cells) =&gt; string.Join(",", cells);
}

public static class Csv
{
    public static string Write(string[] cells) =&gt; Formatter.Format(cells);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Tsv.cs"><code>using System;

// The SAME type name, in the same namespace, in the same assembly.
// Legal, because each is scoped to its own file.
file class Formatter
{
    public static string Format(string[] cells) =&gt; string.Join("\t", cells);
}

public static class Tsv
{
    public static string Write(string[] cells) =&gt; Formatter.Format(cells);
}</code></pre>

  <p>Two types with the same name, in the same namespace, in the same assembly, and it compiles.
  A third file asks what they are actually called:</p>

  <pre data-lang="console" data-title="Output"><code>Csv.Write : id,name,amount
Tsv.Write : id&lt;TAB&gt;name&lt;TAB&gt;amount
Type.GetType("Formatter") from another file: null

What the two file-scoped types are actually called in metadata:
  &lt;Csv&gt;F1FFAE8ACDA4E57A9EBD80DB5D9A757F9C62AEC7746AA78FF9155DBE1A4E72C07__Formatter
  &lt;Tsv&gt;FAB5E404661FA90D1E211A33899F7B9120F5F1AE062453577B7744B49FC25711F__Formatter</code></pre>

  <p>The compiler renames each one with a hash of its file path, producing another unspeakable
  identifier. That also tells you the limits: the name depends on the file, so moving the
  declaration to a different file changes its metadata name, and anything looking the type up by
  string will stop finding it.</p>
</section>

<section id="leaking-state">
  <h2>Private data reached through a public door</h2>

  <p>A field marked <code>private</code> is not private if you hand out a reference to the object
  it points at. <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a>
  established that a reference-typed variable holds the address of an object rather than the
  object itself; returning one gives the caller the same object you have, not a copy of it.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-leaking-state.cs"><code>// 04-leaking-state.cs — a private field is not private if you hand out a
// reference to the object it points at.
// .NET 10.0.400. Run: dotnet run -c Release 04-leaking-state.cs

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;

class LeakyOrder
{
    private readonly List&lt;string&gt; _lines = new();
    public decimal Total { get; private set; }

    public void AddLine(string sku, decimal price)
    {
        _lines.Add(sku);
        Total += price;
    }

    // Looks like a read-only view. Is not.
    public List&lt;string&gt; Lines =&gt; _lines;
}

class HalfLeakyOrder
{
    private readonly List&lt;string&gt; _lines = new();
    public decimal Total { get; private set; }

    public void AddLine(string sku, decimal price)
    {
        _lines.Add(sku);
        Total += price;
    }

    // The static type blocks Add. The runtime type does not.
    public IReadOnlyList&lt;string&gt; Lines =&gt; _lines;
}

class SealedOrder
{
    private readonly List&lt;string&gt; _lines = new();
    public decimal Total { get; private set; }

    public void AddLine(string sku, decimal price)
    {
        _lines.Add(sku);
        Total += price;
    }

    // A wrapper the caller cannot unwrap into the original list.
    public IReadOnlyList&lt;string&gt; Lines =&gt; new ReadOnlyCollection&lt;string&gt;(_lines);
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. returning the List directly ---");
        var leaky = new LeakyOrder();
        leaky.AddLine("WIDGET-1", 10m);
        leaky.Lines.Add("FREE-PONY");          // no compiler complaint at all
        leaky.Lines.Clear();
        Console.WriteLine($"lines: {leaky.Lines.Count}, Total still: {leaky.Total}");

        Console.WriteLine();
        Console.WriteLine("--- 2. returning IReadOnlyList (the usual advice) ---");
        var half = new HalfLeakyOrder();
        half.AddLine("WIDGET-1", 10m);
        // half.Lines.Add(...) does not compile. But:
        if (half.Lines is List&lt;string&gt; unwrapped)
        {
            unwrapped.Add("FREE-PONY");
            Console.WriteLine("cast back to List&lt;string&gt; and mutated it");
        }
        Console.WriteLine($"lines: {half.Lines.Count}, Total still: {half.Total}");

        Console.WriteLine();
        Console.WriteLine("--- 3. ReadOnlyCollection wrapper ---");
        var safe = new SealedOrder();
        safe.AddLine("WIDGET-1", 10m);
        Console.WriteLine($"is it a List&lt;string&gt;?  {safe.Lines is List&lt;string&gt;}");
        try
        {
            ((IList&lt;string&gt;)safe.Lines).Add("FREE-PONY");
        }
        catch (NotSupportedException ex)
        {
            Console.WriteLine($"forcing it through IList threw {ex.GetType().Name}");
        }
        Console.WriteLine($"lines: {safe.Lines.Count}, Total: {safe.Total}");

        Console.WriteLine();
        Console.WriteLine("--- but a wrapper is a VIEW, not a snapshot ---");
        var view = safe.Lines;
        safe.AddLine("WIDGET-2", 5m);
        Console.WriteLine($"the view taken before the add now reports {view.Count} lines");

        Console.WriteLine();
        Console.WriteLine("--- what each defence costs, 1,000-item list, 200,000 reads ---");
        var source = Enumerable.Range(0, 1000).Select(i =&gt; $"SKU-{i}").ToList();
        Measure("return the list itself", () =&gt; (IReadOnlyList&lt;string&gt;)source);
        Measure("new ReadOnlyCollection", () =&gt; new ReadOnlyCollection&lt;string&gt;(source));
        Measure("ToArray (real copy)", () =&gt; source.ToArray());
    }

    static void Measure(string label, Func&lt;IReadOnlyList&lt;string&gt;&gt; get)
    {
        for (int i = 0; i &lt; 10_000; i++) get();      // warm up and tier up

        double best = double.MaxValue, worst = 0;
        for (int round = 0; round &lt; 5; round++)
        {
            var sw = Stopwatch.StartNew();
            int n = 0;
            for (int i = 0; i &lt; 200_000; i++) n += get().Count;
            sw.Stop();
            if (n != 200_000_000) throw new Exception("wrong count");
            double ms = sw.Elapsed.TotalMilliseconds;
            if (ms &lt; best) best = ms;
            if (ms &gt; worst) worst = ms;
        }
        Console.WriteLine($"  {label,-24} best {best,7:F1} ms   worst {worst,7:F1} ms");
    }
}</code></pre>

  <p>Output:</p>

  <pre data-lang="console" data-title="Output"><code>--- 1. returning the List directly ---
lines: 0, Total still: 10

--- 2. returning IReadOnlyList (the usual advice) ---
cast back to List&lt;string&gt; and mutated it
lines: 2, Total still: 10

--- 3. ReadOnlyCollection wrapper ---
is it a List&lt;string&gt;?  False
forcing it through IList threw NotSupportedException
lines: 1, Total: 10

--- but a wrapper is a VIEW, not a snapshot ---
the view taken before the add now reports 2 lines

--- what each defence costs, 1,000-item list, 200,000 reads ---
  return the list itself   best     0.9 ms   worst     1.7 ms
  new ReadOnlyCollection   best     3.1 ms   worst     4.8 ms
  ToArray (real copy)      best   126.4 ms   worst   219.0 ms</code></pre>

  <p>The first block is the first incident from the top of this module. <code>Total</code> has a
  <code>private set</code> and is untouchable from outside — and an outsider still produced an
  order whose total is 10 and whose line count is 0. They never assigned to <code>Total</code>.
  They emptied the list it was derived from. <strong>Guarding the field that holds the invariant
  is not enough; you have to guard everything the invariant is computed from.</strong></p>

  <p>The second block is the part that catches people who have already learned the first lesson.
  Returning <code>IReadOnlyList&lt;string&gt;</code> removes <code>Add</code> from what the
  compiler will let you write — but <code>List&lt;T&gt;</code> implements that interface, so the
  object handed out is still the list, and a type test converts it straight back. This is not an
  exotic attack. It is what any code doing
  <code>if (x is List&lt;string&gt; l)</code> for a fast path does by accident.</p>

  <p>The third block wraps the list in <code>ReadOnlyCollection&lt;T&gt;</code>, a distinct object
  that implements the mutating methods by throwing <code>NotSupportedException</code>. The type
  test now fails, and forcing a cast through <code>IList&lt;string&gt;</code> throws at
  runtime.</p>

  <div class="callout callout--gotcha">
    <h4>A wrapper is a view, not a snapshot</h4>
    <p>The fourth block is the part that is
    genuinely surprising: a caller who took <code>safe.Lines</code>, saw one item, and held onto
    it will find it reports two items after the owner adds a line. <code>ReadOnlyCollection</code>
    means "you cannot change this through this reference". It does not mean the contents are
    stable. If a caller needs a stable snapshot, they need a copy, and the only way to guarantee
    one is to make it.</p>
  </div>

  <p>Which brings in the costs. Over 200,000 calls returning a 1,000-item collection:</p>

  <ul>
    <li>Handing back the list itself: <strong>0.8–1.7 ms</strong> — no work at all.</li>
    <li>Allocating a <code>ReadOnlyCollection</code> each call: <strong>2.8–4.8 ms</strong>. About
    10 nanoseconds per call, for a small object that dies immediately in generation 0.</li>
    <li><code>ToArray()</code>: <strong>117–219 ms</strong>, roughly a hundred times more, because
    it copies 1,000 elements every time and allocates an array to hold them.</li>
  </ul>

  <p>So the wrapper is close to free and the copy is not. The usual shape in production code is to
  build the <code>ReadOnlyCollection</code> once and store it, rather than allocating one per
  call, which removes even that cost.</p>

  <p class="define"><span class="define__term">Defensive copy</span> A copy made deliberately so
  that handing data out cannot let the recipient change your state. The same phrase appears in
  <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a> for copies the
  <em>compiler</em> makes silently around <code>readonly</code> structs. Same idea, opposite
  problem: there the copies are unwanted and cost performance; here you want them and must pay
  for them on purpose.</p>
</section>

<section id="production-example">
  <h2>All of it applied to one realistic type</h2>

  <p>An order in a commerce system, with four rules that must never be false:</p>

  <ul>
    <li><code>Total</code> equals the sum of the line totals.</li>
    <li>Lines can be added or removed only while the order is a draft.</li>
    <li>An order cannot be placed with no lines.</li>
    <li>If the status is <code>Dispatched</code>, <code>DispatchedOn</code> is not null.</li>
  </ul>

  <p>Each rule is enforced by making the states that break it unreachable, rather than by asking
  callers to behave.</p>

  <pre data-lang="csharp" data-net="10" data-title="09-production-order.cs"><code>// 09-production-order.cs — the same ideas applied to one realistic type.
// Every rule this class states is enforced rather than documented.
// .NET 10.0.400. Run: dotnet run 09-production-order.cs

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

public enum OrderStatus { Draft, Placed, Dispatched, Cancelled }

public sealed class OrderLine
{
    public string Sku { get; }
    public int Quantity { get; }
    public decimal UnitPrice { get; }
    public decimal LineTotal { get; }

    internal OrderLine(string sku, int quantity, decimal unitPrice)
    {
        Sku = sku;
        Quantity = quantity;
        UnitPrice = unitPrice;
        LineTotal = quantity * unitPrice;
    }
}

public sealed class Order
{
    // The storage. Nothing outside this class can reach either one.
    private readonly List&lt;OrderLine&gt; _lines = new();
    private readonly ReadOnlyCollection&lt;OrderLine&gt; _linesView;

    public Guid Id { get; }
    public OrderStatus Status { get; private set; } = OrderStatus.Draft;
    public DateOnly? DispatchedOn { get; private set; }

    // Stored, not computed: reading it cannot fail and cannot be slow.
    public decimal Total { get; private set; }

    // Built once in the constructor, so returning it allocates nothing.
    public IReadOnlyList&lt;OrderLine&gt; Lines =&gt; _linesView;

    // Visible to the test project only, via InternalsVisibleTo.
    internal int MutationCount { get; private set; }

    public Order(Guid id)
    {
        Id = id;
        _linesView = new ReadOnlyCollection&lt;OrderLine&gt;(_lines);
    }

    public void AddLine(string sku, int quantity, decimal unitPrice)
    {
        RequireStatus(OrderStatus.Draft, "add a line to");

        if (string.IsNullOrWhiteSpace(sku))
            throw new ArgumentException("SKU is required.", nameof(sku));
        if (quantity &lt; 1)
            throw new ArgumentOutOfRangeException(nameof(quantity), quantity, "Must be at least 1.");
        if (unitPrice &lt; 0m)
            throw new ArgumentOutOfRangeException(nameof(unitPrice), unitPrice, "Cannot be negative.");

        var line = new OrderLine(sku, quantity, unitPrice);
        _lines.Add(line);
        Total += line.LineTotal;      // Total and _lines change together, always
        MutationCount++;
    }

    public void RemoveLine(string sku)
    {
        RequireStatus(OrderStatus.Draft, "remove a line from");

        var line = _lines.FirstOrDefault(l =&gt; l.Sku == sku)
            ?? throw new InvalidOperationException($"No line with SKU '{sku}'.");

        _lines.Remove(line);
        Total -= line.LineTotal;
        MutationCount++;
    }

    public void Place()
    {
        RequireStatus(OrderStatus.Draft, "place");
        if (_lines.Count == 0)
            throw new InvalidOperationException("Cannot place an order with no lines.");

        Status = OrderStatus.Placed;
        MutationCount++;
    }

    public void Dispatch(DateOnly on)
    {
        RequireStatus(OrderStatus.Placed, "dispatch");
        Status = OrderStatus.Dispatched;
        DispatchedOn = on;            // set together, so the invariant cannot be half-true
        MutationCount++;
    }

    private void RequireStatus(OrderStatus required, string verb)
    {
        if (Status != required)
            throw new InvalidOperationException(
                $"Cannot {verb} an order with status {Status}; it must be {required}.");
    }

    // The invariant, written as code so a test can assert it.
    internal bool InvariantsHold() =&gt;
        Total == _lines.Sum(l =&gt; l.LineTotal)
        &amp;&amp; (Status != OrderStatus.Dispatched || DispatchedOn is not null)
        &amp;&amp; (Status == OrderStatus.Draft || _lines.Count &gt; 0);
}

class Program
{
    static void Main()
    {
        var order = new Order(Guid.Parse("11111111-2222-3333-4444-555555555555"));
        order.AddLine("WIDGET-1", 3, 9.99m);
        order.AddLine("GIZMO-2", 1, 24.50m);

        Console.WriteLine($"status {order.Status}, {order.Lines.Count} lines, total {order.Total}");
        Console.WriteLine($"invariants hold: {order.InvariantsHold()}");

        Show("mutate the returned collection", () =&gt;
            ((IList&lt;OrderLine&gt;)order.Lines).Add(null!));

        Show("dispatch before placing", () =&gt; order.Dispatch(new DateOnly(2026, 8, 30)));

        order.Place();
        Console.WriteLine($"placed: status {order.Status}");

        Show("add a line after placing", () =&gt; order.AddLine("LATE-3", 1, 5m));

        order.Dispatch(new DateOnly(2026, 8, 30));
        Console.WriteLine($"dispatched on {order.DispatchedOn}");
        Console.WriteLine($"invariants hold: {order.InvariantsHold()}");

        Show("remove a line after dispatch", () =&gt; order.RemoveLine("GIZMO-2"));

        Console.WriteLine($"final: {order.Lines.Count} lines, total {order.Total}, " +
                          $"{order.MutationCount} mutations");
    }

    static void Show(string what, Action action)
    {
        try
        {
            action();
            Console.WriteLine($"  {what}: SUCCEEDED (it should not have)");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  {what}: {ex.GetType().Name}");
        }
    }
}</code></pre>

  <p>Output:</p>

  <pre data-lang="console" data-title="Output"><code>status Draft, 2 lines, total 54.47
invariants hold: True
  mutate the returned collection: NotSupportedException
  dispatch before placing: InvalidOperationException
placed: status Placed
  add a line after placing: InvalidOperationException
dispatched on 30/08/2026
invariants hold: True
  remove a line after dispatch: InvalidOperationException
final: 2 lines, total 54.47, 4 mutations</code></pre>

  <p>Six decisions in that class are worth pointing at, because each one is the module's
  content applied to a specific problem.</p>

  <p><strong><code>Total</code> is stored, not computed.</strong> It could have been
  <code>public decimal Total =&gt; _lines.Sum(l =&gt; l.LineTotal);</code>, which is shorter and
  cannot drift. It is stored instead because reading it then costs nothing and cannot throw —
  and because the only two methods that change <code>_lines</code> also change
  <code>Total</code> on the next line. Correctness by locality: the pair is small enough to check
  by eye.</p>

  <p><strong><code>Status</code> has a <code>private set</code>.</strong> Outside code reads the
  status and cannot assign to it. Every change goes through <code>Place</code> or
  <code>Dispatch</code>, which are the only places the transition rules exist.</p>

  <p><strong><code>DispatchedOn</code> is set in the same statement block as the status.</strong>
  The fourth invariant is about two members agreeing. Two public setters would allow a caller to
  set one and not the other; one method sets both.</p>

  <p><strong>The read-only view is built once.</strong>
  <code>_linesView</code> is created in the constructor, so <code>Lines</code> returns an existing
  object. This is the version of the previous section's advice that has no per-call cost.</p>

  <p><strong><code>OrderLine</code>'s constructor is <code>internal</code>.</strong> The type is
  <code>public</code> so callers can read lines, but only this assembly can construct one — which
  means a line can only come into existence through <code>Order.AddLine</code>, where the
  validation lives.</p>

  <p><strong><code>InvariantsHold</code> is <code>internal</code>.</strong> It is not part of the
  public surface; it exists so a test in the same solution can assert, after any sequence of
  operations, that the object is still coherent. Writing the invariant as executable code rather
  than as a comment is what makes it testable.</p>

  <div class="callout callout--note">
    <h4>On <code>sealed</code></h4>
    <p>Both classes are <code>sealed</code>, meaning
    nothing can inherit from them. That is a deliberate part of the encapsulation: a subclass can
    override behaviour and break invariants the base class was guaranteeing.
    <a href="#/m/t1-10-inheritance">Inheritance</a> and
    <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a> cover why, and what
    <code>sealed</code> also does for performance.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A getter that does work, called by something that assumes it does not</h3>

  <p>Reading a field is free, so callers treat reading a property as free. A computed property
  breaks that assumption silently — and the code that punishes it hardest is the code that reads
  properties repeatedly without you writing a loop.</p>

  <p class="define"><span class="define__term">LINQ</span> A set of methods in the .NET libraries
  for querying collections — <code>Where</code> to filter, <code>Select</code> to transform,
  <code>OrderBy</code> to sort, and others. They are covered properly later in Track 1. What
  matters here is that each one calls the code you hand it once per element, and a sort calls it
  more than once per element.</p>

  <pre data-lang="csharp" data-net="10" data-title="06-property-side-effects.cs"><code>// 06-property-side-effects.cs — callers assume reading a property is cheap and
// harmless, because reading a field is. Code that reads like one field access
// can be many.
// .NET 10.0.400. Run: dotnet run -c Release 06-property-side-effects.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Invoice
{
    public static int LineLookups;
    public static int TotalComputations;

    private readonly int _id;
    public Invoice(int id) =&gt; _id = id;

    // Looks like data. Is a query.
    public IReadOnlyList&lt;decimal&gt; Lines
    {
        get
        {
            LineLookups++;
            var lines = new List&lt;decimal&gt;();
            for (int i = 0; i &lt; 50; i++) lines.Add((_id + i) % 97);
            return lines;
        }
    }

    // Looks like a stored number. Recomputed on every read, from the property above.
    public decimal Total
    {
        get
        {
            TotalComputations++;
            decimal sum = 0m;
            foreach (var line in Lines) sum += line;
            return sum;
        }
    }
}

// Same data, honest surface.
class HonestInvoice
{
    public IReadOnlyList&lt;decimal&gt; Lines { get; }
    public decimal Total { get; }

    public HonestInvoice(int id)
    {
        var lines = new List&lt;decimal&gt;();
        for (int i = 0; i &lt; 50; i++) lines.Add((id + i) % 97);
        Lines = lines;
        Total = lines.Sum();
    }
}

class Program
{
    static void Main()
    {
        var invoices = Enumerable.Range(1, 1000).Select(i =&gt; new Invoice(i)).ToList();

        Console.WriteLine("--- one innocuous-looking LINQ chain ---");
        Invoice.LineLookups = 0;
        Invoice.TotalComputations = 0;

        var big = invoices.Where(x =&gt; x.Total &gt; 2000m)
                          .OrderByDescending(x =&gt; x.Total)
                          .Take(5)
                          .Select(x =&gt; x.Total)
                          .ToList();

        Console.WriteLine($"  returned {big.Count} values");
        Console.WriteLine($"  Total getter ran      {Invoice.TotalComputations,8:N0} times");
        Console.WriteLine($"  Lines getter ran      {Invoice.LineLookups,8:N0} times");
        Console.WriteLine($"  lists allocated       {Invoice.LineLookups,8:N0}");

        Console.WriteLine();
        Console.WriteLine("--- the same chain written to read each Total once ---");
        Invoice.LineLookups = 0;
        Invoice.TotalComputations = 0;

        var big2 = invoices.Select(x =&gt; x.Total)
                           .Where(t =&gt; t &gt; 2000m)
                           .OrderByDescending(t =&gt; t)
                           .Take(5)
                           .ToList();

        Console.WriteLine($"  returned {big2.Count} values");
        Console.WriteLine($"  Total getter ran      {Invoice.TotalComputations,8:N0} times");
        Console.WriteLine($"  Lines getter ran      {Invoice.LineLookups,8:N0} times");

        Console.WriteLine();
        Console.WriteLine("--- what that costs in wall-clock time ---");
        var honest = Enumerable.Range(1, 1000).Select(i =&gt; new HonestInvoice(i)).ToList();

        Time("computed property", () =&gt;
            invoices.Where(x =&gt; x.Total &gt; 2000m).OrderByDescending(x =&gt; x.Total).Take(5).Count());
        Time("stored property", () =&gt;
            honest.Where(x =&gt; x.Total &gt; 2000m).OrderByDescending(x =&gt; x.Total).Take(5).Count());

        Console.WriteLine();
        Console.WriteLine("--- and the reason this hides from you in the debugger ---");
        Invoice.TotalComputations = 0;
        Invoice.LineLookups = 0;
        var one = invoices[0];
        // A watch window, a logger, and a serialiser each read every property once.
        _ = one.Total;
        _ = one.Total;
        _ = one.Total;
        Console.WriteLine($"  three inspections = {Invoice.TotalComputations} recomputations, " +
                          $"{Invoice.LineLookups} line rebuilds");
    }

    static void Time(string label, Func&lt;int&gt; body)
    {
        for (int i = 0; i &lt; 20; i++) body();
        double best = double.MaxValue;
        for (int r = 0; r &lt; 5; r++)
        {
            var sw = Stopwatch.StartNew();
            body();
            sw.Stop();
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-20} {best,7:F2} ms per chain (best of 5)");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- one innocuous-looking LINQ chain ---
  returned 5 values
  Total getter ran         1,670 times
  Lines getter ran         1,670 times
  lists allocated          1,670

--- the same chain written to read each Total once ---
  returned 5 values
  Total getter ran         1,000 times
  Lines getter ran         1,000 times

--- what that costs in wall-clock time ---
  computed property       2.76 ms per chain (best of 5)
  stored property         0.02 ms per chain (best of 5)

--- and the reason this hides from you in the debugger ---
  three inspections = 3 recomputations, 3 line rebuilds</code></pre>

  <p>One thousand invoices, and <code>Total</code> ran 1,670 times: once per element in
  <code>Where</code>, then again for elements the sort compares. Each of those rebuilt a
  50-element list. The chain that reads each <code>Total</code> once first does 1,000 — and the
  version storing the value at construction is <strong>138 times faster</strong> (2.76 ms against
  0.02 ms).</p>

  <p>Nothing about the call site suggests any of this. <code>x.Total</code> looks like reading a
  number.</p>

  <div class="callout callout--gotcha">
    <h4>This hides from the debugger, and from itself</h4>
    <p>A watch window evaluates
    every property of the object you are inspecting, so stepping through a method that touches a
    computed property runs that getter repeatedly — meaning any counter, cache, or log inside it
    reports numbers that include your own inspection. A getter with a side effect can be changed
    by the act of looking at it.</p>
  </div>

  <h3>2. A getter that can throw</h3>

  <p>A public getter is not called only by your code.</p>

  <p class="define"><span class="define__term">Serialisation</span> Turning an object into a
  stream of bytes or text — JSON, for instance — so it can be sent over a network or written to
  disk. A serialiser works by reading every public property of the object it is given.</p>

  <pre data-lang="csharp" data-net="10" data-title="08-throwing-property.cs"><code>#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property NoWarn=IL2026;IL3050
// 08-throwing-property.cs — a public getter is not called only by your code.
// Serialisers, loggers, debuggers and data binding all read every public
// property. A getter that can throw makes all of them fail.
// .NET 10.0.400. Run: dotnet run 08-throwing-property.cs

using System;
using System.Text.Json;

class Shipment
{
    public string Reference { get; set; } = "";
    public decimal Weight { get; set; }
    public int BoxCount { get; set; }

    // Reads like a harmless derived value. Divides by a number that can be zero.
    public decimal WeightPerBox =&gt; Weight / BoxCount;
}

class SafeShipment
{
    public string Reference { get; set; } = "";
    public decimal Weight { get; set; }
    public int BoxCount { get; set; }

    // Same information, no way to throw.
    public decimal? WeightPerBox =&gt; BoxCount == 0 ? null : Weight / BoxCount;
}

class Program
{
    static void Main()
    {
        var good = new Shipment { Reference = "SHP-1", Weight = 12m, BoxCount = 3 };
        var bad = new Shipment { Reference = "SHP-2", Weight = 12m, BoxCount = 0 };

        Console.WriteLine("--- the good record serialises ---");
        Console.WriteLine(JsonSerializer.Serialize(good));

        Console.WriteLine();
        Console.WriteLine("--- the bad one takes the whole response with it ---");
        try
        {
            Console.WriteLine(JsonSerializer.Serialize(bad));
        }
        catch (Exception ex)
        {
            Console.WriteLine($"{ex.GetType().Name}: {ex.Message}");
            Console.WriteLine($"  inner: {ex.InnerException?.GetType().Name}: " +
                              $"{ex.InnerException?.Message}");
        }

        Console.WriteLine();
        Console.WriteLine("--- one bad record in a list of good ones ---");
        var batch = new[] { good, good, bad, good };
        try
        {
            Console.WriteLine(JsonSerializer.Serialize(batch));
        }
        catch (Exception ex)
        {
            Console.WriteLine($"the whole batch failed: {ex.GetType().Name}");
            Console.WriteLine($"  path reported: {(ex as JsonException)?.Path ?? "(none)"}");
        }

        Console.WriteLine();
        Console.WriteLine("--- ToString/interpolation hits it too ---");
        try
        {
            Console.WriteLine($"per box: {bad.WeightPerBox}");
        }
        catch (DivideByZeroException)
        {
            Console.WriteLine("logging the object threw DivideByZeroException");
        }

        Console.WriteLine();
        Console.WriteLine("--- the version that cannot throw ---");
        var safe = new SafeShipment { Reference = "SHP-2", Weight = 12m, BoxCount = 0 };
        Console.WriteLine(JsonSerializer.Serialize(safe));
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- the good record serialises ---
{"Reference":"SHP-1","Weight":12,"BoxCount":3,"WeightPerBox":4}

--- the bad one takes the whole response with it ---
TargetInvocationException: Exception has been thrown by the target of an invocation.
  inner: DivideByZeroException: Attempted to divide by zero.

--- one bad record in a list of good ones ---
the whole batch failed: TargetInvocationException
  path reported: (none)

--- ToString/interpolation hits it too ---
logging the object threw DivideByZeroException

--- the version that cannot throw ---
{"Reference":"SHP-2","Weight":12,"BoxCount":0,"WeightPerBox":null}</code></pre>

  <p>This is the third incident from the top of the module, and the diagnostic experience is the
  point. The exception that reaches the log is
  <code>TargetInvocationException: Exception has been thrown by the target of an invocation</code>
  — a message with no property name, no record identifier, and no JSON path. The actual cause is
  one level down in <code>InnerException</code>. One bad record in a batch of four takes the
  entire response with it, so the endpoint returns 500 rather than partial data, and the
  frequency of the failure tracks how often <code>BoxCount</code> happens to be zero.</p>

  <p class="define"><span class="define__term">TargetInvocationException</span> The exception
  thrown when something invoked your code through reflection and your code threw. It wraps the
  real exception in its <code>InnerException</code>. Seeing it means the call came from a
  framework — a serialiser, a data binder, a test runner — rather than from a direct call.</p>

  <p>The fix is to make the getter total: return <code>decimal?</code> and yield
  <code>null</code> for the undefined case. If a property genuinely cannot produce a value for
  every valid state of the object, it should be a method, where the possibility of failure is
  visible at the call site.</p>

  <h3>3. Guarding the field but not what it is derived from</h3>

  <p>The <code>LeakyOrder</code> from the previous section: <code>Total</code> has a
  <code>private set</code>, nothing outside can assign it, and an outsider still produced a total
  of 10 with zero lines. This is the most common shape of the mistake, because the class looks
  encapsulated. Every field is private. Every setter is guarded. And one property hands out a
  live reference to the collection everything is computed from.</p>

  <h3>4. Public setters on everything</h3>

  <p class="define"><span class="define__term">Anaemic domain model</span> A class that is a bag
  of public properties with no behaviour, where all the rules live in other classes that operate
  on it. The name is not a compliment: the type holds data and guarantees nothing, so every
  caller has to remember the rules, and the compiler cannot help when one forgets.</p>

  <p>A type generated with <code>{ get; set; }</code> on every member has the same public surface
  as a type with public fields. It is more work to write and buys only the binary compatibility
  from the earlier section. The invariants are still unenforced.</p>

  <div class="callout callout--warn">
    <h4>Where this is the right answer anyway</h4>
    <p>Types that exist only to carry data
    across a boundary — the shape a JSON request deserialises into, a row read from a database,
    a message off a queue — legitimately have public setters, because something outside your code
    fills them in one property at a time. The mistake is not writing such a type. It is letting it
    <em>be</em> your domain model, so the object the rest of the system works with is the one with
    no rules. The usual arrangement is to validate at the boundary and convert into a type like
    <code>Order</code>, which cannot be invalid, as early as possible.</p>
  </div>

  <h3>5. Assuming private means unreachable</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-private-is-not-security.cs"><code>// 05-private-is-not-security.cs — access modifiers are a compile-time contract
// between programmers, not a runtime protection boundary.
// .NET 10.0.400. Run: dotnet run 05-private-is-not-security.cs

using System;
using System.Reflection;

class ApiClient
{
    private readonly string _apiKey;
    private int _requestsRemaining = 100;

    public ApiClient(string apiKey) =&gt; _apiKey = apiKey;

    public string Describe() =&gt;
        $"key ending {_apiKey[^4..]}, {_requestsRemaining} requests left";

    public void Send()
    {
        if (_requestsRemaining &lt;= 0) throw new InvalidOperationException("Quota exhausted.");
        _requestsRemaining--;
    }
}

class Program
{
    const BindingFlags Hidden = BindingFlags.NonPublic | BindingFlags.Instance;

    static void Main()
    {
        var client = new ApiClient("sk-live-000011112222");
        Console.WriteLine($"before: {client.Describe()}");

        // client._apiKey does not compile. This does.
        var keyField = typeof(ApiClient).GetField("_apiKey", Hidden)!;
        Console.WriteLine($"read through reflection: {keyField.GetValue(client)}");

        // readonly does not stop it either.
        keyField.SetValue(client, "sk-live-999988887777");
        Console.WriteLine($"after writing a readonly field: {client.Describe()}");

        // Neither does the quota.
        var quotaField = typeof(ApiClient).GetField("_requestsRemaining", Hidden)!;
        quotaField.SetValue(client, 0);
        try
        {
            client.Send();
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"quota forced to 0 from outside: {ex.Message}");
        }

        quotaField.SetValue(client, int.MaxValue);
        Console.WriteLine($"and back up again: {client.Describe()}");

        Console.WriteLine();
        Console.WriteLine("Every private member, listed by anything that can load the type:");
        foreach (var f in typeof(ApiClient).GetFields(Hidden))
            Console.WriteLine($"  {f.FieldType.Name,-8} {f.Name}  (readonly: {f.IsInitOnly})");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>before: key ending 2222, 100 requests left
read through reflection: sk-live-000011112222
after writing a readonly field: key ending 7777, 100 requests left
quota forced to 0 from outside: Quota exhausted.
and back up again: key ending 7777, 2147483647 requests left

Every private member, listed by anything that can load the type:
  String   _apiKey  (readonly: True)
  Int32    _requestsRemaining  (readonly: False)</code></pre>

  <p>Reflection read a private field, wrote to a <code>readonly</code> one, and reset a quota to
  <code>int.MaxValue</code>. Access modifiers describe intent to other programmers and let the
  compiler hold you to it. They do not keep a secret from code running in the same process.
  Anything genuinely sensitive is protected by process boundaries, encryption, or by not being in
  memory — never by <code>private</code>.</p>

  <div class="callout callout--myth">
    <h4>The precise version of that claim</h4>
    <p>"Access modifiers are not enforced at
    runtime" is the folklore, and it is wrong. Compiled IL that reaches a member it is not
    entitled to fails at runtime with <code>FieldAccessException</code> or
    <code>MethodAccessException</code> — the CLR checks. Take the cross-assembly example above,
    build the consumer while <code>InternalsVisibleTo</code> is present, then swap in a library
    built without it, and the untouched consumer fails:</p>
    <pre data-lang="console" data-title="Consumer run against a Lib built without InternalsVisibleTo"><code>Public   = 1
Unhandled exception. System.FieldAccessException: Attempt by method 'Program.Main()'
   to access field 'Lib.Widget.Internal' failed.</code></pre>
    <p>Note that <code>Public = 1</code> printed first: the failure lands when execution reaches
    that access, not when the program starts, so it looks like a data problem rather than a
    versioning one. The accurate statement is narrower than the folklore:
    <em>reflection</em> can be granted permission to ignore access modifiers, and by default is.
    Ordinary compiled code cannot.</p>
  </div>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4><code>MissingFieldException</code> or <code>MissingMethodException</code> naming a
    member that exists</h4>
    <p>This is always a version mismatch, never a bug in the code that
    threw. Something was compiled against a different build of the assembly that owns the member.
    If the name in the message starts with <code>get_</code> or <code>set_</code>, a property
    became a field; if it is a bare field name, a field became a property. Find which assembly
    declares the type, and check whether the copy on disk matches what the caller was built
    against — <code>AppDomain.CurrentDomain.GetAssemblies()</code> printed at startup, with each
    assembly's <code>Location</code> and version, settles it in one run. Rebuilding everything
    from a clean tree confirms the diagnosis but hides it again, so establish the cause before
    reaching for a clean build.</p>
  </div>

  <div class="callout callout--debug">
    <h4><code>TargetInvocationException</code> with an unhelpful message</h4>
    <p>The
    message belongs to the wrapper, not the fault. Read <code>InnerException</code> — and in logs,
    make sure the logger is configured to print inner exceptions, because a great many are not.
    That it is a <code>TargetInvocationException</code> at all tells you the call came through
    reflection, which narrows the candidates to serialisers, model binders, data binding, and test
    frameworks. If a serialiser is involved, the culprit is a getter on the type being serialised;
    a breakpoint on every getter of that type finds it in one request.</p>
  </div>

  <div class="callout callout--debug">
    <h4>An invariant is false and nothing assigned to it</h4>
    <p>When a total disagrees
    with its lines, resist auditing the code that writes the total; it is usually correct. Audit
    every member that hands out a reference to something the total is computed from. Search the
    type for members returning <code>List&lt;</code>, <code>Dictionary&lt;</code>,
    <code>[]</code>, or any mutable type, and ask of each: if the caller changes this, does the
    object notice? An <code>internal</code> method like
    <code>InvariantsHold()</code> called from tests after every operation turns "this happened
    somewhere in production last Tuesday" into a failing test.</p>
  </div>

  <div class="callout callout--debug">
    <h4>A method is unexpectedly slow and the profiler blames a property getter</h4>
    <p>Count the calls before optimising the getter. If it is being called far more often than the
    number of objects involved, the fix is at the call site — a sort or a repeated filter reading
    the same property — and hoisting the read into a local, or computing the value once at
    construction, removes it entirely. The counters in the example above are a throwaway
    diagnostic worth writing: a <code>static int</code> incremented in the getter, printed at the
    end, tells you in one run what a profiler takes longer to show.</p>
  </div>

  <div class="callout callout--debug">
    <h4>Trust the compiler error code</h4>
    <p><code>CS0122</code> means the member exists
    and the rule forbids it — check the modifier and where your code sits relative to the
    declaring type. <code>CS1061</code> and <code>CS0103</code> mean the compiler cannot see the
    member at all, which for a member you can see in the source means it is <code>internal</code>
    in another assembly (add <code>InternalsVisibleTo</code>, or reconsider), or
    <code>private protected</code> and you are in the wrong assembly, or <code>file</code>-scoped
    in a different file. The two error codes send you to different places.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A concrete case</h4>
    <p>A team split one large service into two deployables and
    moved a shared <code>PricingConfig</code> type into a NuGet package so both could use it. The
    package was at 1.4.0. A developer noticed <code>Markup</code> was a public field, applied the
    analyser's suggestion to make it a property, and shipped 1.5.0. The build pipeline rebuilt
    both services, and everything passed.</p>
    <p>Three weeks later a hotfix went out for one service only — a one-line log message change —
    built from a branch that had never picked up 1.5.0. The deployment tooling copied the whole
    output folder, which included that branch's <code>Contracts.dll</code> at 1.4.0, over a host
    also running the other service. Whichever service loaded second got the wrong version and died
    with <code>MissingFieldException: Field not found: 'PricingConfig.Markup'</code> on its first
    request. The field is right there in the source of both versions.</p>
    <p>Every instinct that message triggers is wrong. It is not a null, not a configuration
    problem, not a typo, and the code that threw is innocent. The diagnosis is entirely in the
    word <em>Field</em>: something compiled a field access against a build where
    <code>Markup</code> is a property. Knowing that field-to-property is a binary break turns an
    afternoon into two minutes, because the question becomes "which two builds are on this host?"
    rather than "what is wrong with the pricing code?".</p>
  </div>

  <p>The broader point, though, is the one about reversible decisions. A type's public surface is
  the set of things you have promised not to change without coordinating with everyone who uses
  it. Encapsulation is how you keep that set small on purpose, so most of your code stays yours to
  change. Every <code>public</code> you write is a commitment; every <code>private</code> and
  <code>internal</code> is optionality you keep.</p>

  <p>That is why <code>internal</code> is worth more than it looks. In a solution of several
  projects, an <code>internal</code> type can be renamed, restructured, or deleted with the
  compiler proving nothing outside the assembly cared. A <code>public</code> one cannot, even
  when nothing outside actually uses it — because the compiler can no longer tell you that.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"Encapsulation means a getter and setter for every field"</h4>
    <p>A class of
    <code>{ get; set; }</code> auto-properties has the same public surface as a class of public
    fields: anything can set anything, in any order, to any value. It buys the binary
    compatibility from earlier in this module and nothing else. Encapsulation is about which
    <em>states</em> are reachable, not about how many accessor keywords are present. If every
    property has a public setter, ask which invariant each one could break, and then remove the
    setters that have an answer.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Properties are slower than fields, so use fields on hot paths"</h4>
    <p>Measured
    above: for a simple accessor the JIT inlines it and the two are indistinguishable across 200
    million reads. What <em>is</em> slower is a <code>virtual</code> property once more than one
    type is in play (about six times), and a computed property that does real work (138 times, in
    this module's example). Both of those are about what the accessor does, not about it being a
    property.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Returning <code>IReadOnlyList&lt;T&gt;</code> makes a collection safe"</h4>
    <p>It makes it read-only through <em>that reference</em>. If the object handed out is still the
    <code>List&lt;T&gt;</code>, a type test converts it back and mutates your state, as the
    demonstration above does in three lines. It is a statement of intent that the compiler
    partly enforces, not a guarantee. <code>ReadOnlyCollection&lt;T&gt;</code> is the guarantee —
    and even it is a live view, not a snapshot.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"<code>private</code> keeps data safe from other code"</h4>
    <p>Reflection reads
    private fields and writes <code>readonly</code> ones, as demonstrated. What is true — and
    more precise than the usual telling — is that <em>compiled IL</em> is checked by the runtime
    and fails with <code>FieldAccessException</code>. Reflection is the exception, not the rule.
    Either way, <code>private</code> expresses design intent inside one program; it is not a
    defence against code you did not want running in your process.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Make it <code>public</code> — someone might need it later"</h4>
    <p>This reverses
    the cost. Widening access later is a non-breaking change you can make the day someone asks.
    Narrowing it is a breaking change you may never be able to make, because you cannot see who
    depends on it. Start at the narrowest level that compiles and widen on demand.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A property should never do work, so use a method for anything non-trivial"</h4>
    <p>Closer to right than most of these, and still too strong. The workable rule is about what
    callers can assume: a property read should be roughly as cheap as a field read, should not
    throw for any valid state of the object, should return the same value when called twice with
    nothing changed in between, and should have no observable side effects. A getter that
    consults a small cached dictionary is fine. One that opens a database connection is not — not
    because of a rule about properties, but because a debugger watch window will open a database
    connection.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead>
      <tr><th>Situation</th><th>Reach for</th><th>Because</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>Data other code reads, in a type you ship to anyone</td>
        <td>Property</td>
        <td>Costs nothing, and leaves you able to add validation, logging, or a different
        representation later without a coordinated rebuild.</td>
      </tr>
      <tr>
        <td>Data with a rule attached</td>
        <td>Property with a validating setter, or no setter at all and a method that changes it</td>
        <td>A rule that lives anywhere other than the only path to the data is a rule that can be
        skipped.</td>
      </tr>
      <tr>
        <td>Two members that must agree</td>
        <td>One method that sets both; no public setters</td>
        <td>Separate setters allow the half-updated state to exist, which is the state the
        invariant forbids.</td>
      </tr>
      <tr>
        <td>Value fixed at construction</td>
        <td><code>{ get; }</code> or <code>{ get; init; }</code></td>
        <td>Assignable once, then permanently readable. See
        <a href="#/m/t1-08-classes-and-objects">Classes and Objects</a> for <code>init</code>
        and <code>required</code>.</td>
      </tr>
      <tr>
        <td>Exposing a collection</td>
        <td>A <code>ReadOnlyCollection&lt;T&gt;</code> built once and stored</td>
        <td>The interface alone can be cast back to the list. Building the wrapper per call costs
        about 10 ns; building it once costs nothing.</td>
      </tr>
      <tr>
        <td>Caller needs a stable snapshot</td>
        <td>An explicit method returning a copy — <code>ToArray()</code></td>
        <td>A wrapper is a live view. A copy is a hundred times more expensive, so make the caller
        ask for it by name rather than hiding the cost in a property.</td>
      </tr>
      <tr>
        <td>A value that must be computed</td>
        <td>Property if it is cheap and total; a method if it is neither</td>
        <td>Callers assume a property read is free and cannot fail. A method's brackets are the
        only warning they get.</td>
      </tr>
      <tr>
        <td>Helper used across one assembly</td>
        <td><code>internal</code></td>
        <td>Renameable and deletable with the compiler proving nothing outside cared.</td>
      </tr>
      <tr>
        <td>Helper used by one file</td>
        <td><code>file</code></td>
        <td>Cannot collide with anything, and its scope is visible without searching.</td>
      </tr>
      <tr>
        <td>Something only tests need</td>
        <td><code>internal</code> plus <code>InternalsVisibleTo</code></td>
        <td>Keeps it out of the public surface — but remember the grant covers every
        <code>internal</code>, <code>protected internal</code> and <code>private protected</code>
        member in the assembly.</td>
      </tr>
      <tr>
        <td>Data crossing a boundary (JSON, database row, queue message)</td>
        <td>Public setters are fine — then convert into a type that cannot be invalid</td>
        <td>Something outside your code fills these one property at a time. The mistake is letting
        that type be the one the rest of the system reasons about.</td>
      </tr>
      <tr>
        <td>Public mutable field</td>
        <td>Effectively never in a shipped library; acceptable in a <code>struct</code> built for
        layout or interop, and inside a single assembly</td>
        <td>It publishes your storage decision permanently. Analyser rule CA1051 flags it.</td>
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
    <p>The <code>Widget</code> library from earlier declares one member at each access level, and
    the library contains
    <code>[assembly: InternalsVisibleTo("Consumer")]</code>. For each numbered line in the
    <em>Consumer</em> assembly, say whether it compiles. Then say what changes if the attribute is
    removed.</p>
<pre data-lang="csharp" data-net="10" data-title="Probe.cs"><code>using System;
using Lib;

class Unrelated                       // same assembly as Program, not derived
{
    public void Try(Widget w)
    {
        Console.WriteLine(w.Public);              // 1
        Console.WriteLine(w.Internal);            // 2
        Console.WriteLine(w.Protected);           // 3
        Console.WriteLine(w.ProtectedInternal);   // 4
    }
}

class ForeignDerived : Widget         // derived, different assembly from Lib
{
    public void Try()
    {
        Console.WriteLine(Protected);             // 5
        Console.WriteLine(PrivateProtected);      // 6
    }
}

class Program { static void Main() { } }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <div class="table-wrap">
        <table>
          <thead><tr><th>Line</th><th>With the attribute</th><th>Without it</th></tr></thead>
          <tbody>
            <tr><td>1 <code>w.Public</code></td><td>compiles</td><td>compiles</td></tr>
            <tr><td>2 <code>w.Internal</code></td><td>compiles</td><td>CS1061</td></tr>
            <tr><td>3 <code>w.Protected</code></td><td>CS0122</td><td>CS0122</td></tr>
            <tr><td>4 <code>w.ProtectedInternal</code></td><td>compiles</td><td>CS0122</td></tr>
            <tr><td>5 <code>Protected</code> in the subclass</td><td>compiles</td><td>compiles</td></tr>
            <tr><td>6 <code>PrivateProtected</code> in the subclass</td><td>compiles</td><td>CS0103</td></tr>
          </tbody>
        </table>
        </div>
        <p>Line 3 fails in both columns and line 5 succeeds in both, which is the check that you
        have the rule right: <code>protected</code> is about derivation only, so the attribute
        cannot affect it. <code>Unrelated</code> is not derived from <code>Widget</code>, so it
        cannot reach a protected member no matter which assembly it is in; <code>ForeignDerived</code>
        is derived, so it can, even from another assembly.</p>
        <p>Line 6 is the one most people get wrong, and the answer is not the one the access table
        suggests on its own. <code>private protected</code> means derived <strong>and</strong> same
        assembly, and <code>InternalsVisibleTo</code> grants <code>Consumer</code> the "same
        assembly" half. Remove the attribute and it fails — with CS0103, "the name does not exist
        in the current context", rather than CS0122, because a member the compiler is not
        entitled to see is erased from view entirely rather than reported as forbidden.</p>
        <p>That difference between CS0103/CS1061 and CS0122 is worth keeping: the first pair means
        the compiler cannot see the member, the second means it can and the rule stops you.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This class has one invariant: <code>UniqueCount</code> equals the number of tracks, because
    duplicates are rejected on the way in. Every field is <code>private readonly</code>. Break the
    invariant from outside without using reflection, then fix the class.</p>
<pre data-lang="csharp" data-net="10" data-title="Playlist"><code>class Playlist
{
    private readonly List&lt;string&gt; _tracks = new();
    private readonly HashSet&lt;string&gt; _seen = new();

    public IReadOnlyList&lt;string&gt; Tracks =&gt; _tracks;
    public int UniqueCount =&gt; _seen.Count;

    public void Add(string track)
    {
        if (_seen.Add(track)) _tracks.Add(track);
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><code>Tracks</code> returns <code>_tracks</code> itself. The declared type is
        <code>IReadOnlyList&lt;string&gt;</code>, but the object is a
        <code>List&lt;string&gt;</code>, so a type test hands it back with every mutating method
        available:</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Breaking it"><code>var p = new Playlist();
p.Add("one");
p.Add("two");
p.Add("one");                     // rejected as a duplicate

if (p.Tracks is List&lt;string&gt; live)
{
    live.Add("three");
    live.Add("three");            // no duplicate check anywhere
}</code></pre>
        <pre data-lang="console" data-title="Output"><code>start: Tracks=2, UniqueCount=2
after mutating the returned list: Tracks=4, UniqueCount=2</code></pre>
        <p>Four tracks, two of them identical, and <code>UniqueCount</code> reports 2.
        <code>readonly</code> on the field did nothing to prevent it: <code>readonly</code> stops
        the <em>field</em> being reassigned to a different list, not the list being changed.
        That distinction is the one from
        <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a> — the variable
        holds a reference, and <code>readonly</code> freezes the reference, not what it points
        at.</p>
        <p>The fix is a wrapper built once in the constructor, so it costs nothing per call:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>class FixedPlaylist
{
    private readonly List&lt;string&gt; _tracks = new();
    private readonly HashSet&lt;string&gt; _seen = new();
    private readonly ReadOnlyCollection&lt;string&gt; _view;

    public FixedPlaylist() =&gt; _view = new ReadOnlyCollection&lt;string&gt;(_tracks);

    public IReadOnlyList&lt;string&gt; Tracks =&gt; _view;
    public int UniqueCount =&gt; _seen.Count;

    public void Add(string track)
    {
        if (_seen.Add(track)) _tracks.Add(track);
    }
}</code></pre>
        <pre data-lang="console" data-title="Output"><code>fixed version: Tracks=2, UniqueCount=2
  can it be cast back to List&lt;string&gt;?  False
  forcing it through IList threw NotSupportedException</code></pre>
        <p>A second defensible fix is to delete <code>_seen</code> and compute
        <code>UniqueCount</code> from <code>_tracks</code>. There would then be no second piece of
        state to disagree with the first — the strongest kind of fix, because it removes the
        invariant rather than enforcing it. It costs a scan per read, so it is the right choice
        when the collection is small or the property is read rarely.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A service throws on startup:</p>
    <pre data-lang="console" data-title="The exception on startup"><code>System.MissingMethodException: Method not found:
  'System.String Acme.Billing.Customer.get_DisplayName()'.</code></pre>
    <p><code>DisplayName</code> is present in <code>Customer</code>, the solution builds with no
    warnings, and the service runs on the developer's machine. Say what happened, why the local
    machine is fine, and what you would check first. Then say what the message would have looked
    like if the change had gone the other way.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>What happened.</strong> The <code>get_</code> prefix is the giveaway: that is
        the compiler's name for a property getter, so the caller's IL contains a call to a
        <em>property</em>. The <code>Customer</code> assembly actually loaded does not have that
        method, which means in that build <code>DisplayName</code> is a public
        <strong>field</strong>. Someone changed a field into a property — or, more likely here,
        the deployed <code>Acme.Billing.dll</code> predates a change that turned a field into a
        property, and the calling assembly is the newer one.</p>
        <p><strong>Why the developer's machine is fine.</strong> A local build compiles everything
        from one tree at one commit, so caller and callee always agree. The mismatch only exists
        where the two assemblies are versioned and deployed independently — a NuGet package, a
        plugin folder, a partial deployment, or a shared directory holding one service's output
        beside another's.</p>
        <p><strong>What to check first.</strong> Not the source of <code>Customer</code>. Print
        what is actually loaded:</p>
<pre data-lang="csharp" data-net="10" data-title="What to print instead"><code>foreach (var a in AppDomain.CurrentDomain.GetAssemblies()
                           .OrderBy(a =&gt; a.FullName))
{
    Console.WriteLine($"{a.GetName().Name,-30} {a.GetName().Version}");
    Console.WriteLine($"    {a.Location}");
}</code></pre>
        <p>Compare the version and path of <code>Acme.Billing.dll</code> against what the calling
        project was built with. Rebuilding everything from clean makes the symptom vanish, so
        establish which two builds are present <em>before</em> reaching for that, or the same
        deployment will do it again next week.</p>
        <p><strong>The other direction.</strong> If a property had been changed into a field, the
        caller's IL would contain a field access and the message would be
        <code>MissingFieldException: Field not found: 'Acme.Billing.Customer.DisplayName'</code> —
        no <code>get_</code> prefix, and a different exception type. So the exception type and the
        prefix together tell you which way the change went, and therefore which of the two
        assemblies is the stale one.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>This type is used in an endpoint that returns the three highest-reading sensors as JSON.
    The endpoint is slower than it should be, and roughly one request in a few hundred fails with
    an error mentioning JSON rather than sensors. Find both defects, predict the exact numbers,
    and rewrite the type.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Sensor — as written"><code>class Sensor
{
    private readonly double[] _samples;
    public Sensor(double[] samples) =&gt; _samples = samples;

    public string Name { get; set; } = "";
    public double Average =&gt; _samples.Average();
    public double Peak =&gt; _samples.Max() / _samples.Min();
}

// the endpoint, over 100 sensors
var top = sensors.Where(s =&gt; s.Average &gt; 10)
                 .OrderByDescending(s =&gt; s.Average)
                 .Take(3)
                 .Select(s =&gt; s.Name)
                 .ToList();</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Defect 1: <code>Average</code> is recomputed per read, and the chain reads it
        twice per sensor.</strong> With a counter added to the getter and 100 sensors, the
        measured count is <strong>200</strong>: once per element in <code>Where</code>, and once
        more per element as <code>OrderByDescending</code> extracts its sort key. Each call walks
        the whole sample array. Nothing at the call site suggests <code>s.Average</code> is
        anything but a field read.</p>
        <p><strong>Defect 2 is not where it looks.</strong> The tempting answer is that
        <code>Peak</code> throws <code>DivideByZeroException</code> when the smallest sample is
        zero. It does not — and this is worth getting right, because it changes where you would
        look:</p>
        <pre data-lang="console" data-title="What Peak actually returns"><code>bad.Peak = ∞   (no exception thrown)
double.IsInfinity: True
the same division in other types:
  decimal: DivideByZeroException
  int:     DivideByZeroException</code></pre>
        <p>Floating-point division by zero yields <code>Infinity</code>, per the IEEE 754 rules
        from <a href="#/m/t1-02-variables-and-types">Variables, Types, and Type Inference</a>.
        <code>decimal</code> and integer division throw; <code>double</code> does not. So the
        getter succeeds and hands back a number.</p>
        <p>The failure happens later, in the serialiser, because JSON has no way to write
        infinity:</p>
        <pre data-lang="console" data-title="Where it actually fails"><code>ArgumentException: .NET number values such as positive and negative infinity cannot be writ...</code></pre>
        <p>Which is why the error mentions JSON and not sensors, and why it names no property.
        The cause is one bad sample array; the symptom is a serialisation error in an endpoint
        whose own code never appears in the stack trace. (Had the samples been
        <code>decimal</code>, the same defect would have surfaced as
        <code>TargetInvocationException</code> wrapping <code>DivideByZeroException</code> — the
        shape from the earlier section.)</p>
        <p><strong>The rewrite.</strong> Compute once at construction, and make the undefined case
        representable:</p>
<pre data-lang="csharp" data-net="10" data-title="Sensor — rewritten"><code>class Sensor
{
    public string Name { get; }
    public double Average { get; }
    public double? Peak { get; }

    public Sensor(string name, double[] samples)
    {
        Name = name;
        Average = samples.Average();
        double min = samples.Min();
        Peak = min == 0 ? null : samples.Max() / min;
    }
}</code></pre>
        <pre data-lang="console" data-title="Output"><code>AfterSensor.Peak for a zero sample: null
  serialises to: {"Name":"S0","Average":7.666666666666667,"Peak":null}
AfterSensor returned 3 names with 0 recomputations</code></pre>
        <p>Four things changed, and each maps to a rule from this module. The values are computed
        once, so the 200 recomputations become zero. <code>Peak</code> is <code>double?</code>, so
        the undefined case has a representation that JSON can write. <code>Name</code> lost its
        setter, so a sensor cannot be renamed after construction. And the samples are no longer
        held at all after the constructor runs — the type keeps the answers rather than the raw
        data, which also means nothing can hand out a reference to that array.</p>
        <p>Worth noting what this trades away: the values are computed for every sensor, including
        the ones <code>Where</code> would have filtered out. That is the right trade when the
        results are read more than once, as here. If most sensors were never examined,
        <code>Lazy&lt;T&gt;</code> or an explicit cache would fit better — but neither belongs in
        a property that callers assume is free.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <p>Answer these without scrolling up. If one does not come, the section it belongs to is the
  one to reread.</p>

  <ol class="recall">
    <li>
      <p>What are the two distinct things encapsulation buys? Name a failure that comes from
      losing each one.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Enforceable invariants</strong> and <strong>freedom to change your mind.</strong>
        Losing the first gives an order whose total is 10 with zero lines, because something
        outside the class emptied the collection the total was derived from. Losing the second
        gives the <code>MissingFieldException</code> deployment: a public field published a
        storage decision that could not be revised without recompiling every caller.</p>
      </div></details>
    </li>
    <li>
      <p>What does the compiler actually generate for
      <code>public int Count { get; set; }</code>? Name all three members and say why one of them
      has a name you cannot type.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A private field <code>&lt;Count&gt;k__BackingField</code>, plus two methods,
        <code>get_Count()</code> and <code>set_Count(int)</code>. The field's name contains angle
        brackets, which are illegal in a C# identifier, so no source code can reach the storage
        directly and bypass the accessors.</p>
      </div></details>
    </li>
    <li>
      <p>Turning a public field into a property is safe in which sense and unsafe in which? What
      exception does the unsafe case produce, and how does the message differ from the reverse
      change?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Source-compatible, binary-incompatible.</strong> Every call site still compiles
        unchanged, but already-compiled callers hold IL containing a field access, and the field
        no longer exists — <code>MissingFieldException: Field not found</code>. Going the other
        way, property to field, removes <code>get_X</code>, so the message is
        <code>MissingMethodException: Method not found</code> naming <code>get_X</code>. The
        exception type and the <code>get_</code> prefix together tell you which direction the
        change went, and therefore which assembly is stale.</p>
      </div></details>
    </li>
    <li>
      <p>The measurements showed a property that was six times slower than a field. Which property,
      and what was actually responsible?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <code>virtual</code> property, and only once a <em>second</em> type was in play
        (1002–1258 ms against 145–220 ms). With one type the JIT proves which method the call
        lands on and inlines it anyway. The cost belongs to <code>virtual</code> dispatch, not to
        the property: plain, auto- and validating properties were all indistinguishable from a
        field.</p>
      </div></details>
    </li>
    <li>
      <p>Does <code>private protected</code> mean wider or narrower access than
      <code>protected internal</code>? What are the runtime's own names for these two levels?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Narrower.</strong> <code>private protected</code> is derived
        <em>and</em> same assembly; <code>protected internal</code> is derived <em>or</em> same
        assembly. The runtime names say it plainly: <code>FamilyAndAssembly</code> and
        <code>FamilyOrAssembly</code>, where "family" means derived types. Reading the C# pair as
        "protected, and also internal" gets the second one exactly backwards.</p>
      </div></details>
    </li>
    <li>
      <p>Name three access levels that <code>InternalsVisibleTo</code> widens.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>internal</code>, <code>protected internal</code>, and
        <code>private protected</code>. The attribute grants the named assembly "same assembly"
        identity for every accessibility rule, so any level with an assembly component widens.
        <code>protected</code> is unaffected, because it says nothing about assemblies.</p>
      </div></details>
    </li>
    <li>
      <p>A class has only private fields and a <code>private set</code> on its total, and an
      outsider still corrupted its state. How?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A property handed out the live <code>List&lt;T&gt;</code> the total was computed from.
        Nobody assigned to the total; they emptied the collection behind it.
        <strong>Guarding the field that holds an invariant is not enough — you have to guard
        everything the invariant is computed from.</strong> <code>readonly</code> on the field does
        not help either: it freezes the reference, not what it points at.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>ReadOnlyCollection&lt;T&gt;</code> not a snapshot, and what does it cost per
      call compared with <code>ToArray()</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It wraps the original list rather than copying it, so it is a live view: a caller
        holding one sees later additions by the owner. Over 200,000 calls on a 1,000-item list it
        cost 2.8–4.8 ms (about 10 ns per call) against 117–219 ms for <code>ToArray()</code> —
        roughly a hundred times cheaper, because it copies nothing. If a caller needs a stable
        snapshot, only a real copy gives one.</p>
      </div></details>
    </li>
    <li>
      <p>You see <code>TargetInvocationException</code> in a log. What does that tell you about
      where the call came from, and where is the information you actually need?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Something invoked your code <em>through reflection</em> and your code threw — so the
        caller is a framework: a serialiser, a model binder, data binding, or a test runner. The
        wrapper's own message says nothing useful; the real fault is in
        <code>InnerException</code>. Check that your logger is configured to print inner
        exceptions, because many are not.</p>
      </div></details>
    </li>
    <li>
      <p>Which compiler errors mean "the member exists and you may not touch it", and which mean
      "the compiler cannot see it at all"?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>CS0122</code> ("inaccessible due to its protection level") means it exists and the
        rule stops you. <code>CS1061</code> ("does not contain a definition for") and
        <code>CS0103</code> ("the name does not exist in the current context") mean it is erased
        from view — typically an <code>internal</code> member in another assembly, a
        <code>private protected</code> member seen from the wrong assembly, or a
        <code>file</code>-scoped type in a different file. The two groups send you to different
        places.</p>
      </div></details>
    </li>
    <li>
      <p>Give two conditions a property getter should satisfy that a method is not expected to.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Any two of: roughly as cheap as a field read; cannot throw for any valid state of the
        object; returns the same value when called twice with nothing changed in between; has no
        observable side effects. Callers assume all four because reading a field guarantees them.
        A method's brackets are the only warning a caller gets that work may happen, which is why
        anything failing these belongs in a method.</p>
      </div></details>
    </li>
    <li>
      <p>Why is starting at the narrowest access level cheaper than starting at
      <code>public</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Widening later is a non-breaking change you can make the day someone asks. Narrowing
        later is a breaking change you may never be able to make, because once a member is
        <code>public</code> the compiler can no longer tell you who depends on it. The costs are
        asymmetric, so the cheap default is the narrow one.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
