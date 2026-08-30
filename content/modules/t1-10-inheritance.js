/* ============================================================================
   Track 1, Module 10 — Inheritance
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every result in this module was compiled and run on
   .NET 10.0.400 (runtime 10.0.11), Windows 11 x64.
   The runnable sources are in verification/t1-10-inheritance/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-10-inheritance",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "Inheritance is the tightest coupling C# offers: a derived class depends not only on what " +
    "its base does but on how it does it. The fragile base class problem is what happens when " +
    "that hidden dependency changes — silently, with no error, and without a rebuild being " +
    "able to fix it.",
  terms: [
    "inheritance", "base class", "derived class", "subclass", "superclass",
    "is-a relationship", "System.Object", "constructor chaining", "base keyword",
    "this constructor initialiser", "member hiding", "virtual", "override",
    "abstract", "sealed", "protected", "fragile base class problem",
    "template method", "single inheritance", "upcast", "downcast",
    "behavioural contract", "CS0108", "CS7036", "CS0506"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A compliance audit at a payments company finds that transfers made in the last eleven weeks
  have no audit records. The money moved correctly. The balances are right. The audit trail — a
  regulatory requirement — is empty for those weeks, and full before and after.</p>

  <p>The class that writes the audit records has not been edited in two years. Its code is
  correct: it records every payment as it is added. The team pulls up the git history of every
  file in the service and finds nothing relevant. There is no exception in any log, no failed
  health check, no alert. The system did not break. It stopped doing something, and nothing
  anywhere reported that.</p>

  <p>What changed was a shared library, three releases ago, in a class nobody on the payments
  team has ever opened. The library author made a small performance improvement to a method
  they own, in a way that changed nothing about what that method does. No public behaviour
  changed. No signature changed. Their own tests pass.</p>

  <p>Rebuilding the payments service does not fix it. Pinning the library back to the old version
  does.</p>

  <p>This module is about the relationship that makes that possible. Inheritance is the tightest
  coupling C# offers: it lets one class depend not only on <em>what</em> another class does, but
  on <em>how</em> it does it — including details neither class states anywhere. That dependency
  is invisible in both files. It is the reason the failure above has no author, no error, and no
  stack trace.</p>
</section>

<section id="what-inheritance-is">
  <h2>What inheritance actually is</h2>

  <p class="define"><span class="define__term">Inheritance</span> Declaring that one class is a
  more specific kind of another, so that it starts with everything that class has — fields,
  methods, properties — and adds to or changes part of it. Written
  <code>class Savings : Account</code>, read "Savings derives from Account".</p>

  <p class="define"><span class="define__term">Base class</span> The general one being derived
  from (<code>Account</code>). Also called the <em>superclass</em> or <em>parent</em>.</p>

  <p class="define"><span class="define__term">Derived class</span> The specific one doing the
  deriving (<code>Savings</code>). Also called the <em>subclass</em> or <em>child</em>.</p>

  <p>The analogy usually offered is biological: a savings account "is a kind of" account, the way
  a spaniel is a kind of dog. <strong>Treat that as an analogy and notice where it stops.</strong>
  Biological classification describes things that already exist and cannot be changed by
  classifying them. Here, the base class is running code that the derived class's behaviour
  depends on, and either author can change their half next week. The taxonomy analogy describes
  the shape of the relationship and says nothing about the thing that actually goes wrong with
  it, which is time.</p>

  <p>A more useful mental model: <strong>inheriting from a class is signing up to a contract
  whose terms are partly unwritten</strong>. You agree to whatever the base class does now, plus
  whatever it does in every future version, including the parts nobody documented.</p>

  <p class="define"><span class="define__term">Is-a relationship</span> The test for whether
  inheritance is the right tool: every derived instance must be usable anywhere a base instance
  is expected, without the calling code needing to know the difference. If a
  <code>Square</code> cannot be used wherever a <code>Rectangle</code> is expected, they should
  not be related by inheritance however similar they look.</p>

  <p class="define"><span class="define__term">Single inheritance</span> A C# class has exactly
  one direct base class. Deriving from two is a compile error, <code>CS1721</code>. Interfaces,
  covered in <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and
  Interfaces</a>, are how a type takes on several roles at once.</p>

  <p class="define"><span class="define__term">System.Object</span> The root of every type
  hierarchy. A class with no explicit base derives from <code>object</code>, which is where
  <code>ToString</code>, <code>Equals</code> and <code>GetHashCode</code> come from. Every chain
  ends there.</p>

  <p>Four keywords appear throughout this module. Each gets a full treatment later; these are
  working definitions, enough to read on with.</p>

  <p class="define"><span class="define__term">virtual</span> Marks a base member as replaceable
  by a derived class. Without it, a derived class cannot override the member at all.</p>

  <p class="define"><span class="define__term">override</span> Marks a derived member as the
  replacement for a <code>virtual</code> one. Both keywords, and what the runtime does with
  them, are the subject of <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual
  Dispatch</a>.</p>

  <p class="define"><span class="define__term">abstract</span> On a member, declares it with no
  body: derived classes must supply one. On a class, means the class cannot be instantiated on
  its own. Covered fully in
  <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and
  Interfaces</a>.</p>

  <p class="define"><span class="define__term">sealed</span> On a class, forbids deriving from
  it. Attempting to is <code>CS0509</code>. It is the tool for saying "this relationship ends
  here", and the cheapest defence against most of this module.</p>
</section>

<section id="minimal-example">
  <h2>What a derived class actually gets</h2>

  <p>The rule stated compactly: <strong>a derived class inherits every member of its base except
  constructors and finalisers.</strong> Private members are inherited too — the object carries
  the storage — but the derived class cannot reach them by name.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-what-you-inherit.cs"><code>// Trimming analysis cannot follow reflection over BaseType; these warnings are
// about publishing trimmed, not about the demonstration.
#:property NoWarn=IL2070;IL2075

// 01-what-you-inherit.cs — a derived type gets every member of its base except
// constructors and finalisers. Private members are inherited but unreachable.
// .NET 10.0.400. Run: dotnet run 01-what-you-inherit.cs

using System;
using System.Linq;
using System.Reflection;

class Account
{
    private decimal _auditOnly = 99m;      // inherited, but not reachable by name

    // Only Account can read it. SavingsAccount carries the field and cannot see it.
    public string AuditLine() =&gt; "audit " + _auditOnly;
    protected decimal Balance;
    public string Id { get; }

    public Account(string id) =&gt; Id = id;

    public void Deposit(decimal amount) =&gt; Balance += amount;
    public virtual string Describe() =&gt; $"Account {Id}: {Balance:0.00}";
}

class SavingsAccount : Account
{
    private readonly decimal _rate;

    // Constructors are NOT inherited. This one must exist and must chain.
    public SavingsAccount(string id, decimal rate) : base(id) =&gt; _rate = rate;

    public void ApplyInterest() =&gt; Balance += Balance * _rate;   // Balance is protected

    public override string Describe() =&gt; $"Savings {Id}: {Balance:0.00} @ {_rate:P0}";
}

class Program
{
    const BindingFlags All = BindingFlags.Public | BindingFlags.NonPublic
                           | BindingFlags.Instance | BindingFlags.DeclaredOnly;

    static void Main()
    {
        var s = new SavingsAccount("SV-1", 0.05m);
        s.Deposit(1000m);          // inherited method, not redeclared
        s.ApplyInterest();
        Console.WriteLine(s.Describe());
        Console.WriteLine($"Id came from the base: {s.Id}");

        Console.WriteLine();
        Console.WriteLine("Declared ON SavingsAccount itself:");
        Dump(typeof(SavingsAccount));

        Console.WriteLine();
        Console.WriteLine("Declared on Account:");
        Dump(typeof(Account));

        Console.WriteLine();
        Console.WriteLine("Every instance field an object of this type carries:");
        var t = typeof(SavingsAccount);
        for (Type? cur = t; cur != null &amp;&amp; cur != typeof(object); cur = cur.BaseType)
            foreach (var f in cur.GetFields(All))
                Console.WriteLine($"  from {cur.Name,-16} {f.Name}");

        Console.WriteLine();
        Console.WriteLine($"chain: {string.Join(" -&gt; ", Chain(t))}");
        Console.WriteLine($"is a SavingsAccount an Account? {s is Account}");
        Console.WriteLine($"is an Account a SavingsAccount? {new Account("A") is SavingsAccount}");
    }

    static void Dump(Type t)
    {
        foreach (var m in t.GetMembers(All)
                           .Where(m =&gt; m.MemberType is MemberTypes.Method or MemberTypes.Field
                                       or MemberTypes.Property or MemberTypes.Constructor)
                           .OrderBy(m =&gt; m.MemberType.ToString()).ThenBy(m =&gt; m.Name))
            Console.WriteLine($"  {m.MemberType,-11} {m.Name}");
    }

    static string[] Chain(Type t)
    {
        var names = new System.Collections.Generic.List&lt;string&gt;();
        for (Type? cur = t; cur != null; cur = cur.BaseType) names.Add(cur.Name);
        return names.ToArray();
    }
}</code></pre>


  <pre data-lang="console" data-title="Output"><code>Savings SV-1: 1050.00 @ 5%
Id came from the base: SV-1

Declared ON SavingsAccount itself:
  Constructor .ctor
  Field       _rate
  Method      ApplyInterest
  Method      Describe

Declared on Account:
  Constructor .ctor
  Field       _auditOnly
  Field       &lt;Id&gt;k__BackingField
  Field       Balance
  Method      AuditLine
  Method      Deposit
  Method      Describe
  Method      get_Id
  Property    Id

Every instance field an object of this type carries:
  from SavingsAccount   _rate
  from Account          _auditOnly
  from Account          Balance
  from Account          &lt;Id&gt;k__BackingField

chain: SavingsAccount -&gt; Account -&gt; Object
is a SavingsAccount an Account? True
is an Account a SavingsAccount? False</code></pre>

  <p>Three things in that output are worth reading carefully.</p>

  <p><strong>The object carries fields it cannot see.</strong> Every
  <code>SavingsAccount</code> instance contains <code>_auditOnly</code>, a private field of
  <code>Account</code>. It occupies memory in every instance. <code>SavingsAccount</code> cannot
  name it — writing <code>_auditOnly</code> inside <code>SavingsAccount</code> is
  <code>CS0122</code>. Inheritance of state and access to state are different things.</p>

  <p><strong><code>Deposit</code> is not declared on <code>SavingsAccount</code>, and calling it
  works.</strong> That is the whole practical appeal of inheritance in one line: shared behaviour
  written once.</p>

  <p><strong>The relationship is one-directional.</strong> A <code>SavingsAccount</code>
  <em>is an</em> <code>Account</code>; an <code>Account</code> is not a
  <code>SavingsAccount</code>.</p>

  <p class="define"><span class="define__term">Upcast</span> Treating a derived instance as its
  base type — <code>Account a = new SavingsAccount(...)</code>. Always safe, never needs a cast
  written out, and always allowed by the compiler.</p>

  <p class="define"><span class="define__term">Downcast</span> Treating a base-typed reference as
  the derived type. Needs an explicit cast or a type test, because it can fail at runtime with
  <code>InvalidCastException</code>. Use <code>is</code> or <code>as</code> rather than a bare
  cast when it might not hold.</p>
</section>

<section id="construction">
  <h2>Constructor chaining, and the order nobody guesses</h2>

  <p>Constructors are not inherited. A derived class must declare its own, and every derived
  constructor must reach a base constructor — explicitly with <code>base(...)</code>, or
  implicitly, in which case the compiler inserts a call to the base's parameterless constructor.
  If there is no parameterless base constructor and you did not write <code>base(...)</code>,
  that is <code>CS7036</code>.</p>

  <p class="define"><span class="define__term">Constructor chaining</span> The sequence of
  constructor calls that runs when an object is created: each level's constructor calls one in
  its base, up to <code>object</code>, before any constructor body runs.</p>

  <p class="define"><span class="define__term">this constructor initialiser</span> Written
  <code>: this(...)</code> instead of <code>: base(...)</code>. Delegates to a different
  constructor <em>on the same class</em>, which then chains to the base. The way to keep
  validation in one place across several constructors.</p>

  <p><a href="#/m/t1-08-classes-and-objects">Classes and Objects</a> established the order for
  two levels. Three levels, plus the question of when <code>base(...)</code> arguments are
  evaluated, is where it stops being guessable:</p>

  <pre data-lang="csharp" data-net="10" data-title="02-constructor-chaining.cs"><code>// 02-constructor-chaining.cs — the exact order an object is built in, across
// three levels, and where base(...) arguments are evaluated.
// .NET 10.0.400. Run: dotnet run 02-constructor-chaining.cs

using System;

static class Log
{
    public static string Trace(string what)
    {
        Console.WriteLine($"  {what}");
        return what;
    }
}

class Top
{
    private readonly string _f = Log.Trace("Top     field initialiser");

    public Top(string tag)
    {
        Log.Trace($"Top     constructor body");
    }
}

class Middle : Top
{
    private readonly string _f = Log.Trace("Middle  field initialiser");

    // The argument to base(...) is evaluated BEFORE the base constructor runs,
    // and before this constructor's body.
    public Middle(int n) : base(Log.Trace($"Middle  base(...) argument evaluated"))
    {
        Log.Trace("Middle  constructor body");
    }
}

class Bottom : Middle
{
    private readonly string _f = Log.Trace("Bottom  field initialiser");

    public Bottom() : base(Log.Trace("Bottom  base(...) argument evaluated").Length)
    {
        Log.Trace("Bottom  constructor body");
    }
}

// ---- constructor chaining within one class, via this(...) ------------------
class Money
{
    public decimal Amount { get; }
    public string Currency { get; }

    public Money(decimal amount) : this(amount, "GBP")
    {
        Log.Trace("  Money(decimal) body");
    }

    public Money(decimal amount, string currency)
    {
        Log.Trace("  Money(decimal, string) body");
        if (amount &lt; 0) throw new ArgumentOutOfRangeException(nameof(amount));
        Amount = amount;
        Currency = currency;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("Building a Bottom:");
        _ = new Bottom();

        Console.WriteLine();
        Console.WriteLine("this(...) delegates to the other constructor FIRST:");
        var m = new Money(5m);
        Console.WriteLine($"  result: {m.Amount} {m.Currency}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Building a Bottom:
  Bottom  field initialiser
  Bottom  base(...) argument evaluated
  Middle  field initialiser
  Middle  base(...) argument evaluated
  Top     field initialiser
  Top     constructor body
  Middle  constructor body
  Bottom  constructor body

this(...) delegates to the other constructor FIRST:
    Money(decimal, string) body
    Money(decimal) body
  result: 5 GBP</code></pre>

  <p>The pattern, stated once:</p>

  <ul>
    <li><strong>Going down the chain</strong> (most derived first), each level runs its own field
    initialisers, then evaluates its <code>base(...)</code> arguments.</li>
    <li><strong>Coming back up</strong> (base first), each level runs its constructor body.</li>
  </ul>

  <p>So field initialisers run in <em>derived-to-base</em> order and constructor bodies run in
  <em>base-to-derived</em> order. The two halves of building an object run in opposite
  directions, and the turn happens at <code>object</code>.</p>

  <div class="callout callout--gotcha">
    <p><strong>The consequence that catches people.</strong> A base constructor that calls a
    <code>virtual</code> method reaches the derived override — and at that moment the derived
    class's <em>field initialisers have run</em> but its <em>constructor body has not</em>. So
    some of the derived object is initialised and some is not, and which is which depends on
    where the author happened to assign each field.
    <a href="#/m/t1-08-classes-and-objects">Classes and Objects</a> covered why this throws
    <code>NullReferenceException</code>; exercise 1 below shows the half-and-half state
    directly.</p>
  </div>

  <p>Note also that <code>: this(...)</code> runs the <em>other</em> constructor's body first,
  then its own. That is why putting validation in the most-parameterised constructor and having
  the rest delegate to it works: whichever one a caller picks, the validating one runs.</p>
</section>

<section id="base-keyword">
  <h2>base, and what happens when a name collides</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-base-and-hiding.cs"><code>// 04-base-and-hiding.cs — what base. actually does, and what happens when a
// base class grows a member whose name a derived class was already using.
// .NET 10.0.400. Run: dotnet run 04-base-and-hiding.cs

using System;

class Report
{
    public virtual string Render() =&gt; "base render";

    // Calls the VIRTUAL method, so it reaches the derived override.
    public string RenderTwice() =&gt; Render() + " | " + Render();
}

class PdfReport : Report
{
    public override string Render() =&gt; "PDF render";

    // base.Render() is NON-virtual: it calls Report.Render directly, even
    // though this object's Render is overridden.
    public string ShowBoth() =&gt; $"this.Render()={Render()}, base.Render()={base.Render()}";
}

// ---- what happens when the base grows a member you already had -------------
class OldBase
{
    public string Describe() =&gt; "old base";
}

class Derived : OldBase
{
    // Version 1 of the base had no Describe. This compiled cleanly.
    // Once the base added one, this became an accidental hide: warning CS0108,
    // "hides inherited member. Use the new keyword if hiding was intended."
    public new string Describe() =&gt; "derived";
}

class Program
{
    static void Main()
    {
        var pdf = new PdfReport();

        Console.WriteLine("--- virtual dispatch reaches the override ---");
        Console.WriteLine($"  Render()      : {pdf.Render()}");
        Console.WriteLine($"  RenderTwice() : {pdf.RenderTwice()}");
        Console.WriteLine("  (RenderTwice lives on Report and still reached PdfReport.Render)");

        Console.WriteLine();
        Console.WriteLine("--- base. is not virtual ---");
        Console.WriteLine($"  {pdf.ShowBoth()}");

        Console.WriteLine();
        Console.WriteLine("--- hiding: the STATIC type of the variable decides ---");
        Derived d = new Derived();
        OldBase asBase = d;
        Console.WriteLine($"  through Derived : {d.Describe()}");
        Console.WriteLine($"  through OldBase : {asBase.Describe()}");
        Console.WriteLine($"  same object?    : {ReferenceEquals(d, asBase)}");
        Console.WriteLine("  One object, two answers, decided at compile time by the");
        Console.WriteLine("  declared type of the variable rather than by the object.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- virtual dispatch reaches the override ---
  Render()      : PDF render
  RenderTwice() : PDF render | PDF render
  (RenderTwice lives on Report and still reached PdfReport.Render)

--- base. is not virtual ---
  this.Render()=PDF render, base.Render()=base render

--- hiding: the STATIC type of the variable decides ---
  through Derived : derived
  through OldBase : old base
  same object?    : True
  One object, two answers, decided at compile time by the
  declared type of the variable rather than by the object.</code></pre>

  <p><strong><code>base.Render()</code> is a non-virtual call.</strong> It goes to
  <code>Report.Render</code> specifically, not to whatever the object's actual type overrides. It
  is the only way to reach a base implementation you have overridden, which is why the common
  shape inside an override is "do my part, then <code>base.DoIt()</code>" — or the reverse.</p>

  <p><strong><code>RenderTwice</code> lives on the base and still reached the override.</strong>
  A base class calling its own virtual method is calling the derived class. This is the single
  most important sentence in this module, and the next section is about what it costs.</p>

  <p class="define"><span class="define__term">Member hiding</span> Declaring a member in a
  derived class with the same name as an inherited one, without overriding it. The derived member
  <em>hides</em> the base one rather than replacing it, so which one runs is decided at compile
  time by the declared type of the variable, not at runtime by the object. Written with the
  <code>new</code> keyword to say it was deliberate.</p>

  <p>The output above shows one object giving two different answers depending on which variable
  it was read through. That is almost never what anyone wants, and it is why hiding is worth
  understanding mainly so you can recognise it when it happens by accident — which is the next
  section's subject.</p>
</section>

<section id="fragile-base-class">
  <h2>The fragile base class problem</h2>

  <p>This is the reason inheritance has a reputation, and the reason the incident at the top of
  this module had no author.</p>

  <p class="define"><span class="define__term">Fragile base class problem</span> A change to a
  base class that is correct in isolation, changes no public behaviour, and breaks a derived
  class anyway — because the derived class depended on <em>how</em> the base was implemented, not
  only on what it did.</p>

  <h3>Half one: the base calls its own virtual method</h3>

  <p>A collection whose <code>AddRange</code> happens to be written as a loop calling
  <code>Add</code>. Nothing in the public surface says so.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-fragile-base-class.cs"><code>// 03-fragile-base-class.cs — the derived class is correct, the base class is
// correct, and together they are wrong. Nothing here is a bug in isolation.
// .NET 10.0.400. Run: dotnet run 03-fragile-base-class.cs

using System;
using System.Collections.Generic;

// ---- the base class, as its author wrote it -------------------------------
class ItemBag
{
    private readonly List&lt;string&gt; _items = new();

    public int Count =&gt; _items.Count;

    public virtual void Add(string item) =&gt; _items.Add(item);

    // An implementation detail: AddRange happens to be written in terms of Add.
    // Nothing in the public documentation says so.
    public virtual void AddRange(IEnumerable&lt;string&gt; items)
    {
        foreach (var item in items) Add(item);
    }
}

// ---- a derived class, written by someone who never saw the base source -----
class CountingBag : ItemBag
{
    public int Added { get; private set; }

    public override void Add(string item)
    {
        Added++;
        base.Add(item);
    }

    public override void AddRange(IEnumerable&lt;string&gt; items)
    {
        foreach (var item in items) Added++;
        base.AddRange(items);
    }
}

// ---- the same intent, written so the base cannot betray it -----------------
class SafeCountingBag : ItemBag
{
    public int Added { get; private set; }

    public override void Add(string item)
    {
        Added++;
        base.Add(item);
    }
    // No AddRange override. The base's AddRange routes through Add, and if a
    // future version stops doing that, Count and Added still agree because
    // both come from the same place.
}

class Program
{
    static void Main()
    {
        var items = new[] { "a", "b", "c" };

        var bad = new CountingBag();
        bad.AddRange(items);
        Console.WriteLine("CountingBag overrides both Add and AddRange:");
        Console.WriteLine($"  items actually stored : {bad.Count}");
        Console.WriteLine($"  Added reports         : {bad.Added}");
        Console.WriteLine($"  agree?                : {bad.Count == bad.Added}");

        Console.WriteLine();
        var ok = new SafeCountingBag();
        ok.AddRange(items);
        Console.WriteLine("SafeCountingBag overrides only Add:");
        Console.WriteLine($"  items actually stored : {ok.Count}");
        Console.WriteLine($"  Added reports         : {ok.Added}");
        Console.WriteLine($"  agree?                : {ok.Count == ok.Added}");

        Console.WriteLine();
        Console.WriteLine("Each class read on its own looks correct. The defect is in");
        Console.WriteLine("the relationship: AddRange calling Add is invisible from outside.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>CountingBag overrides both Add and AddRange:
  items actually stored : 3
  Added reports         : 6
  agree?                : False

SafeCountingBag overrides only Add:
  items actually stored : 3
  Added reports         : 3
  agree?                : True

Each class read on its own looks correct. The defect is in
the relationship: AddRange calling Add is invisible from outside.</code></pre>

  <p>The derived author overrode both methods, which is what you do when you do not know how the
  base is written — and the count came out double, because
  <code>AddRange</code> routes through <code>Add</code>, so their counter ran twice per item. To
  write <code>CountingBag</code> correctly you must know a fact that appears in neither the
  documentation nor the public surface.</p>

  <p>The obvious lesson is "override only <code>Add</code>". The next half is why that is not a
  fix either.</p>

  <h3>Half two: the base changes its mind, and nothing reports it</h3>

  <p>Two assemblies now. A library owns the collection; an application derives from it and
  overrides only <code>Add</code> — the careful choice.</p>

  <pre data-lang="csharp" data-net="10" data-title="ItemBag.v1"><code>using System.Collections.Generic;

namespace BagLib;

// VERSION 1. AddRange is implemented in terms of Add. This is an internal
// detail; nothing in the public surface reveals it.
public class ItemBag
{
    private readonly List&lt;string&gt; _items = new();

    public int Count =&gt; _items.Count;

    public virtual void Add(string item) =&gt; _items.Add(item);

    public virtual void AddRange(IEnumerable&lt;string&gt; items)
    {
        foreach (var item in items) Add(item);
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Program.cs"><code>using System;
using BagLib;

// The careful derived class. It overrides ONLY Add, which is the advice given
// to avoid the double-counting problem. It is never edited again.
class AuditedBag : ItemBag
{
    public int Audited { get; private set; }

    public override void Add(string item)
    {
        Audited++;                 // an audit trail the compliance team relies on
        base.Add(item);
    }
}

class Program
{
    static void Main()
    {
        var bag = new AuditedBag();
        bag.AddRange(new[] { "a", "b", "c" });

        Console.WriteLine($"items stored   : {bag.Count}");
        Console.WriteLine($"audit recorded : {bag.Audited}");
        Console.WriteLine($"agree?         : {bag.Count == bag.Audited}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output — against BagLib v1"><code>items stored   : 3
audit recorded : 3
agree?         : True</code></pre>

  <p>Now the library author makes a performance improvement. Same public surface, same documented
  behaviour, same test results on their side:</p>

  <pre data-lang="csharp" data-net="10" data-title="ItemBag.v2"><code>using System.Collections.Generic;

namespace BagLib;

// VERSION 2. Same public surface, same documented behaviour, and one
// performance fix: AddRange no longer routes through Add, so it can pre-size
// the list in one go. A reasonable, well-intentioned change.
public class ItemBag
{
    private readonly List&lt;string&gt; _items = new();

    public int Count =&gt; _items.Count;

    public virtual void Add(string item) =&gt; _items.Add(item);

    public virtual void AddRange(IEnumerable&lt;string&gt; items)
    {
        if (items is ICollection&lt;string&gt; c) _items.Capacity += c.Count;
        _items.AddRange(items);
    }
}</code></pre>

  <p>The new <code>BagLib.dll</code> is dropped in beside the same, untouched application:</p>

  <pre data-lang="console" data-title="Output — same App.exe, BagLib v2"><code>items stored   : 3
audit recorded : 0
agree?         : False</code></pre>

  <p>The audit trail is empty. There is no exception, no warning, no failed build, and no log
  line. The application's code is unchanged and still correct by every reading of it. The
  library's code is unchanged in behaviour and correct by every reading of it.</p>

  <div class="callout callout--warn">
    <p><strong>And recompiling does not fix it.</strong> A full clean rebuild of the application
    against v2 produces exactly the same result: <code>audit recorded : 0</code>. This is the
    difference between this failure and the one in
    <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a>, where turning a
    field into a property produced a loud <code>MissingFieldException</code> that a rebuild
    resolved. That was a <em>binary</em> mismatch: two builds disagreeing about the shape of a
    member. This is a <strong>behavioural</strong> mismatch, and a compiler has nothing to check
    it against. The build is not wrong. The assumption is.</p>
  </div>

  <p class="define"><span class="define__term">Behavioural contract</span> The promises a class
  makes about what it does that are not expressible in its signatures — which methods call which,
  in what order, how many times. C# has no syntax for stating one and no way to check one. When a
  derived class overrides a <code>virtual</code> member, it depends on the base's behavioural
  contract whether anyone wrote it down or not.</p>

  <p>This is why the failure at the top of the module had no author. The library author changed
  an implementation detail, which is the one category of change everyone agrees is safe. It was
  safe for every caller. It was not safe for every <em>subclass</em>, and subclasses are the one
  group whose dependency on you is invisible from your own code.</p>

  <div class="callout callout--why">
    <p><strong>Why this matters in a real system.</strong> This is not a hypothetical taxonomy of
    risk; it is the reason a specific, famous design choice exists. Java's
    <code>HashSet.addAll</code> was implemented as a loop over <code>add</code>, and a widely
    circulated example showed a counting subclass reporting double. Every later collection
    library, .NET's included, took the lesson: look at
    <code>List&lt;T&gt;</code>, <code>Dictionary&lt;K,V&gt;</code>,
    <code>string</code>, <code>StringBuilder</code>. None of them are designed to be derived
    from, and several are <code>sealed</code> outright. When the .NET team wanted an extensible
    collection they shipped a separate type, <code>Collection&lt;T&gt;</code>, whose whole design
    is a written-down behavioural contract: the protected <code>InsertItem</code>,
    <code>RemoveItem</code>, <code>SetItem</code> and <code>ClearItem</code> methods are
    documented as the single funnel every mutation passes through, so a subclass overriding
    <code>InsertItem</code> is guaranteed to see every insert, from any method, in any future
    version. That guarantee is the product. Everything else in that class is scaffolding for
    it.</p>
  </div>
</section>

<section id="protected-state">
  <h2>protected is not encapsulation</h2>

  <p>The other half of what a derived class can reach is state.
  <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a> put
  <code>protected</code> in the access table without saying what it costs. Here is the cost.</p>

  <pre data-lang="csharp" data-net="10" data-title="07-protected-state.cs"><code>// 07-protected-state.cs — protected is not encapsulation. Every subclass, now
// and forever, becomes part of the code that can break your invariants.
// .NET 10.0.400. Run: dotnet run 07-protected-state.cs

using System;
using System.Collections.Generic;

// ---- the tempting version -------------------------------------------------
class LeakyLedger
{
    protected readonly List&lt;decimal&gt; Entries = new();
    protected decimal RunningTotal;

    public decimal Total =&gt; RunningTotal;
    public int Count =&gt; Entries.Count;

    public void Post(decimal amount)
    {
        Entries.Add(amount);
        RunningTotal += amount;
    }
}

class DiscountLedger : LeakyLedger
{
    // Written by someone who wanted "post without affecting the total".
    // Reasonable-looking, and it silently breaks the class invariant.
    public void PostMemo(decimal amount) =&gt; Entries.Add(amount);

    public void ApplyCorrection(decimal delta) =&gt; RunningTotal += delta;
}

// ---- the version a subclass cannot break ----------------------------------
class SealedLedger
{
    private readonly List&lt;decimal&gt; _entries = new();
    private decimal _runningTotal;

    public decimal Total =&gt; _runningTotal;
    public int Count =&gt; _entries.Count;

    public void Post(decimal amount)
    {
        _entries.Add(amount);
        _runningTotal += amount;
    }

    // The extension point is a decision, not the storage.
    protected virtual bool ShouldPost(decimal amount) =&gt; true;

    public bool TryPost(decimal amount)
    {
        if (!ShouldPost(amount)) return false;
        Post(amount);
        return true;
    }

    public bool InvariantHolds()
    {
        decimal sum = 0m;
        foreach (var e in _entries) sum += e;
        return sum == _runningTotal;
    }
}

class SmallOnlyLedger : SealedLedger
{
    protected override bool ShouldPost(decimal amount) =&gt; amount &lt;= 100m;
}

class Program
{
    static void Main()
    {
        var leaky = new DiscountLedger();
        leaky.Post(100m);
        leaky.PostMemo(50m);
        leaky.ApplyCorrection(-25m);

        Console.WriteLine("protected state, subclass free to touch it:");
        Console.WriteLine($"  entries: {leaky.Count}, total: {leaky.Total}");
        Console.WriteLine($"  invariant (sum of entries == total)? {leaky.Total == 125m}");
        Console.WriteLine("  the base class has no way to notice, and no way to prevent it");

        Console.WriteLine();
        var safe = new SmallOnlyLedger();
        Console.WriteLine("private state, subclass gets a decision instead:");
        Console.WriteLine($"  TryPost(50)  -&gt; {safe.TryPost(50m)}");
        Console.WriteLine($"  TryPost(500) -&gt; {safe.TryPost(500m)}");
        Console.WriteLine($"  entries: {safe.Count}, total: {safe.Total}");
        Console.WriteLine($"  invariant holds? {safe.InvariantHolds()}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>protected state, subclass free to touch it:
  entries: 2, total: 75
  invariant (sum of entries == total)? False
  the base class has no way to notice, and no way to prevent it

private state, subclass gets a decision instead:
  TryPost(50)  -&gt; True
  TryPost(500) -&gt; False
  entries: 1, total: 50
  invariant holds? True</code></pre>

  <p>Two entries totalling 150, and a <code>RunningTotal</code> of 75. Both subclass methods are
  reasonable in isolation; neither is reachable by the base class's own validation, because
  neither calls it.</p>

  <p><strong>A <code>protected</code> field makes every subclass — including ones that do not
  exist yet, written by people you will never meet — part of the code responsible for your
  invariants.</strong> It is <code>public</code> with a longer approval process. The rule that
  follows from the earlier module holds here unchanged: guard everything an invariant is computed
  from, and a subclass counts as outside.</p>

  <p>The second class shows the alternative that keeps inheritance useful.
  <strong>Expose a decision, not the storage.</strong> <code>ShouldPost</code> is
  <code>protected virtual</code>, so a subclass can change policy; the list and the total stay
  <code>private</code>, so no subclass can make them disagree. That shape — private state, one
  narrow overridable hook, a non-virtual public method that owns the sequence — is the one
  inheritance design that survives other people.</p>

  <p class="define"><span class="define__term">Template method</span> A base class method that
  owns an algorithm's fixed steps and calls overridable members for the parts that vary. The
  public method is deliberately <em>not</em> virtual, so subclasses can change the steps but not
  the order, the validation, or the bookkeeping around them.</p>
</section>

<section id="production-example">
  <h2>A hierarchy built to survive other people</h2>

  <p>Payment processing across two providers. The rules that must hold for every provider, now
  and for every provider added later:</p>

  <ul>
    <li>Every attempt is recorded in the audit trail, including failures.</li>
    <li>The audit trail cannot be edited, cleared, or skipped by a provider.</li>
    <li>Amount and reference are validated identically for every provider.</li>
    <li>A provider that throws does not take down the audit trail or the caller.</li>
  </ul>

  <pre data-lang="csharp" data-net="10" data-title="06-production-hierarchy.cs"><code>// 06-production-hierarchy.cs — inheritance used the way it survives contact
// with other people: the base owns the algorithm and the invariants, and the
// derived class fills in exactly one step.
// .NET 10.0.400. Run: dotnet run 06-production-hierarchy.cs

using System;
using System.Collections.Generic;

public abstract class PaymentProcessor
{
    // PRIVATE, not protected. A subclass cannot corrupt the audit trail.
    private readonly List&lt;string&gt; _audit = new();
    private int _attempts;

    public string MerchantId { get; }
    public IReadOnlyList&lt;string&gt; Audit =&gt; _audit;
    public int Attempts =&gt; _attempts;

    protected PaymentProcessor(string merchantId)
    {
        if (string.IsNullOrWhiteSpace(merchantId))
            throw new ArgumentException("Merchant id is required.", nameof(merchantId));
        MerchantId = merchantId;
    }

    // The algorithm. NOT virtual: subclasses cannot reorder or skip the steps,
    // so the invariants below hold for every subclass that will ever exist.
    public PaymentResult Process(decimal amount, string reference)
    {
        if (amount &lt;= 0m)
            return Fail(reference, "Amount must be positive.");
        if (string.IsNullOrWhiteSpace(reference))
            return Fail(reference, "Reference is required.");

        _attempts++;
        _audit.Add($"attempt {_attempts}: {Name} {amount:0.00} ref={reference}");

        try
        {
            var outcome = Authorise(amount, reference);   // the one open step
            _audit.Add($"  -&gt; {(outcome.Approved ? "approved" : "declined")}: {outcome.Detail}");
            return outcome.Approved
                ? PaymentResult.Ok(reference, outcome.Detail)
                : PaymentResult.Declined(reference, outcome.Detail);
        }
        catch (Exception ex)
        {
            // A subclass that throws cannot take the audit trail down with it.
            _audit.Add($"  -&gt; error: {ex.GetType().Name}");
            return PaymentResult.Error(reference, ex.GetType().Name);
        }
    }

    private PaymentResult Fail(string reference, string why)
    {
        _audit.Add($"rejected before attempt: {why}");
        return PaymentResult.Declined(reference, why);
    }

    // What a subclass must supply, and the only thing it may supply.
    protected abstract string Name { get; }
    protected abstract Authorisation Authorise(decimal amount, string reference);

    protected readonly record struct Authorisation(bool Approved, string Detail);
}

public readonly record struct PaymentResult(string Reference, string Status, string Detail)
{
    public static PaymentResult Ok(string r, string d) =&gt; new(r, "approved", d);
    public static PaymentResult Declined(string r, string d) =&gt; new(r, "declined", d);
    public static PaymentResult Error(string r, string d) =&gt; new(r, "error", d);
}

public sealed class CardProcessor : PaymentProcessor
{
    private readonly decimal _floorLimit;

    public CardProcessor(string merchantId, decimal floorLimit) : base(merchantId)
        =&gt; _floorLimit = floorLimit;

    protected override string Name =&gt; "card";

    protected override Authorisation Authorise(decimal amount, string reference) =&gt;
        amount &lt;= _floorLimit
            ? new Authorisation(true, "under floor limit")
            : new Authorisation(false, $"over floor limit of {_floorLimit:0.00}");
}

public sealed class BankTransferProcessor : PaymentProcessor
{
    public BankTransferProcessor(string merchantId) : base(merchantId) { }

    protected override string Name =&gt; "transfer";

    protected override Authorisation Authorise(decimal amount, string reference)
    {
        if (reference.StartsWith("BAD", StringComparison.Ordinal))
            throw new InvalidOperationException("Upstream bank rejected the reference.");
        return new Authorisation(true, "same-day clearing");
    }
}

class Program
{
    static void Main()
    {
        var card = new CardProcessor("M-1", floorLimit: 100m);
        Show(card.Process(50m, "REF-1"));
        Show(card.Process(500m, "REF-2"));
        Show(card.Process(-5m, "REF-3"));

        Console.WriteLine();
        Console.WriteLine($"card attempts recorded: {card.Attempts}");
        foreach (var line in card.Audit) Console.WriteLine($"  {line}");

        Console.WriteLine();
        var bank = new BankTransferProcessor("M-1");
        Show(bank.Process(250m, "REF-4"));
        Show(bank.Process(250m, "BAD-REF"));

        Console.WriteLine();
        Console.WriteLine($"transfer attempts recorded: {bank.Attempts}");
        foreach (var line in bank.Audit) Console.WriteLine($"  {line}");

        Console.WriteLine();
        Console.WriteLine("A subclass that throws still leaves a complete audit trail,");
        Console.WriteLine("because the trail is written by the base and is not reachable");
        Console.WriteLine("from the subclass at all.");
    }

    static void Show(PaymentResult r) =&gt;
        Console.WriteLine($"{r.Reference,-8} {r.Status,-9} {r.Detail}");
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>REF-1    approved  under floor limit
REF-2    declined  over floor limit of 100.00
REF-3    declined  Amount must be positive.

card attempts recorded: 2
  attempt 1: card 50.00 ref=REF-1
    -&gt; approved: under floor limit
  attempt 2: card 500.00 ref=REF-2
    -&gt; declined: over floor limit of 100.00
  rejected before attempt: Amount must be positive.

REF-4    approved  same-day clearing
BAD-REF  error     InvalidOperationException

transfer attempts recorded: 2
  attempt 1: transfer 250.00 ref=REF-4
    -&gt; approved: same-day clearing
  attempt 2: transfer 250.00 ref=BAD-REF
    -&gt; error: InvalidOperationException

A subclass that throws still leaves a complete audit trail,
because the trail is written by the base and is not reachable
from the subclass at all.</code></pre>

  <p>Five decisions, each one this module applied to a specific risk.</p>

  <p><strong><code>Process</code> is not virtual.</strong> A subclass cannot reorder the steps,
  skip validation, or avoid the audit write. The behavioural contract is enforced by the compiler
  rather than by documentation, which is the only enforcement that survives a new team.</p>

  <p><strong>The audit list is <code>private</code>, not <code>protected</code>.</strong> A
  subclass cannot append to it, clear it, or read it out of order — exactly the failure the
  previous section demonstrated.</p>

  <p><strong>One <code>abstract</code> method is the whole extension surface.</strong>
  <code>Authorise</code> is what varies between providers. Making it <code>abstract</code> rather
  than <code>virtual</code> means a subclass must supply it, and there is no base implementation
  to depend on — so there is no behavioural contract to break later.</p>

  <p><strong>The base catches subclass exceptions.</strong> A provider that throws produces an
  <code>error</code> result and a complete audit trail. Without that, the audit write for the
  failed attempt would be lost precisely when it matters most.</p>

  <p><strong>Both leaf classes are <code>sealed</code>.</strong> The hierarchy is two levels and
  stops. Nobody can derive from <code>CardProcessor</code> and discover that its
  <code>Authorise</code> is called from somewhere they did not expect.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. The base grows a member you were already using</h3>

  <p>A base class in another assembly adds <code>Describe()</code>. Your derived class has had a
  <code>Describe()</code> for years. Your code did not change and now the compiler says:</p>

  <pre data-lang="console" data-title="Warning, not an error"><code>warning CS0108: 'AlreadyHadOne.Describe()' hides inherited member
                'GrewAMember.Describe()'. Use the new keyword if hiding was intended.</code></pre>

  <p>It is a <strong>warning</strong>, so the build succeeds by default. Your method now hides the
  base's, which means callers holding a base-typed reference get the base version and callers
  holding a derived-typed reference get yours — the split-brain behaviour demonstrated earlier.
  If the base member is <code>virtual</code> and you meant to participate, you need
  <code>override</code>, not the <code>new</code> the warning suggests. The warning text names the
  fix that silences it, which is not always the fix that is correct.</p>

  <h3>2. Deep hierarchies</h3>

  <p>Each level multiplies the problem, because every level's behavioural contract is now part of
  every lower level's dependencies. At four or five levels, answering "what runs when I call
  this?" means reading five files, and changing any of them safely means reading all of them.
  <a href="#/m/t1-13-composition-over-inheritance">Composition Over Inheritance</a> is about the
  way out.</p>

  <h3>3. Inheriting for reuse rather than substitutability</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: inheriting to get access to a member"><code>// WRONG. A ReportGenerator is not a kind of database connection.
class ReportGenerator : DatabaseConnection
{
    public string Generate() =&gt; Query("select * from sales");   // Query is protected
}</code></pre>

  <p>This compiles and works. It is wrong because it fails the is-a test: nothing that expects a
  <code>DatabaseConnection</code> would sensibly accept a <code>ReportGenerator</code>, and
  <code>ReportGenerator</code> now has every public member of a connection — <code>Open</code>,
  <code>Close</code>, <code>BeginTransaction</code> — on its own public surface, whether that
  makes sense or not. The correct version holds a connection as a field and calls it. That is
  composition, and it is the subject of a later module.</p>

  <h3>4. Calling a virtual method from a constructor</h3>

  <p>Covered in <a href="#/m/t1-08-classes-and-objects">Classes and Objects</a>, and worth
  repeating with the sharper version this module's ordering makes available: the override runs
  when the derived class's field initialisers have completed but its constructor body has not.
  The object is half-built in a way that depends on which of the two places each field was
  assigned. Exercise 1 shows both halves in one run.</p>

  <h3>5. Assuming the compiler checks what you meant</h3>

  <p>Verified diagnostics for the mistakes that are compile-time, so you can recognise them by
  code:</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Mistake</th><th>Diagnostic</th></tr></thead>
    <tbody>
      <tr><td>Base has no parameterless constructor, and you omitted <code>base(...)</code></td>
          <td><code>CS7036</code>: no argument given for required parameter</td></tr>
      <tr><td>Deriving from a <code>sealed</code> class</td>
          <td><code>CS0509</code>: cannot derive from sealed type</td></tr>
      <tr><td>Reaching a <code>private</code> base member</td>
          <td><code>CS0122</code>: inaccessible due to its protection level</td></tr>
      <tr><td>Redeclaring a base member without <code>new</code></td>
          <td><code>CS0108</code> <strong>(warning only)</strong>: hides inherited member</td></tr>
      <tr><td><code>override</code> on something not <code>virtual</code></td>
          <td><code>CS0506</code>: cannot override, not marked virtual</td></tr>
      <tr><td>Two base classes</td>
          <td><code>CS1721</code>: cannot have multiple base classes</td></tr>
    </tbody>
  </table>
  </div>

  <p>Note that exactly one of those is a warning, and it is the one that silently changes runtime
  behaviour. Everything the compiler can prove wrong, it refuses. The dangerous cases are the
  ones it cannot see.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>Behaviour changed and no code in your repository did.</strong> Suspect a base class
    in a dependency before you suspect your own logic. Diff the dependency's version between the
    last known-good deployment and now, and read the base class of every type you derive from —
    specifically, look for methods that used to call an overridable member and no longer do, or
    vice versa. This is the failure that a rebuild does not fix and a test suite usually misses,
    because your tests exercise your subclass against the base you had when you wrote them.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>An override is not being called.</strong> Three candidates, in order of how often
    they are the answer. First, the member is hidden rather than overridden — check for
    <code>CS0108</code> in the build log, and check whether your method actually says
    <code>override</code>. Second, the base is not calling it: put a breakpoint in the base method
    you expected to route through yours, or call it directly to confirm it works at all. Third,
    the call is going through a base-typed reference to a hidden (not overridden) member, in which
    case <code>GetType()</code> on the object will show the derived type while the wrong method
    runs — that mismatch is the signature of hiding.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A method is called more or fewer times than expected.</strong> Add a counter to the
    override and print it, as this module's examples do. The count tells you the shape of the
    problem immediately: double the expected number means the base is routing another method
    through yours as well; zero means the base stopped routing through it. Both are behavioural
    contract changes, and neither shows up in a stack trace you would think to capture.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>An invariant on a base class is false.</strong> List every <code>protected</code>
    member. Each one is a way a subclass can change state without the base class's methods
    running. Then search the solution for types deriving from it — in Visual Studio, "View Class
    Diagram" or Find All References on the type name; from the command line, a grep for
    <code>: TypeName</code> finds declarations. Every one of them is a suspect, and the fix is
    usually to make the field <code>private</code> and give subclasses a narrower hook.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Reading an unfamiliar hierarchy.</strong> Start at the leaf and walk up, listing
    for each level: what it overrides, what state it adds, and what it calls on
    <code>base</code>. Then walk down again asking one question per level — <em>does this class
    call any of its own virtual members?</em> Every "yes" is a behavioural contract that the
    levels below it depend on, and those are the places a change will hurt.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>The incident from the top of this module, in full.</strong> A payments service
    derived a class from a shared internal library's <code>ItemBag</code>-style collection,
    overriding only the single method the library's own guidance named. The override incremented
    a counter and wrote a compliance record. This ran correctly for two years.</p>
    <p>The library was on version 4.2.0. A developer profiling an unrelated hot path found that
    bulk inserts spent time in per-item bookkeeping, changed the bulk method to write to the
    backing list directly, measured a solid improvement, and shipped 4.3.0. Every test in the
    library passed, because the library has no subclasses of its own to test with. Every test in
    the payments service passed too, because its tests construct the subclass and call the
    single-item method directly — which still works perfectly.</p>
    <p>Eleven weeks later, an auditor asked for transfer records. The gap was every bulk import:
    roughly 40,000 payments, all correctly processed, none recorded. The regulatory exposure was
    a reportable control failure. The technical fix was four lines. Finding it took a week,
    because every instinct — check the logs, check the recent commits, rebuild, check the
    database — is useless against a failure whose signature is the <em>absence</em> of an
    operation nobody instruments.</p>
    <p>What would have prevented it: the base method not being written in terms of an overridable
    member in the first place, or being documented as a guaranteed funnel and therefore never
    changed, or the subclass asserting its own invariant — <em>records written equals payments
    processed</em> — as a check that runs in production rather than only in tests. The third is
    the cheapest, and it is the one that catches the whole category rather than this instance.</p>
  </div>

  <p>The general principle: <strong>inheritance moves a dependency from a place the compiler
  checks to a place nothing checks.</strong> A method call between two classes is verified on
  every build. A subclass's dependence on when its base calls an overridable member is verified
  by nothing, ever, and can be broken by someone acting entirely reasonably.</p>

  <p>That is why the practical guidance in modern C# is stricter than the textbook version.
  Design for inheritance deliberately and document the contract, or forbid it with
  <code>sealed</code>. Leaving it open by default is choosing an unbounded, unverifiable
  obligation to everyone who ever derives from your class.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"Inheritance is for code reuse."</strong> It is a way to get reuse, and the most
    expensive one available, because it also creates substitutability obligations and a
    behavioural contract. If reuse is all you want, hold an instance as a field and call it —
    that couples you to the other class's public surface only, which is the part it has actually
    promised not to break. Use inheritance when callers genuinely need to treat the two types
    interchangeably.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"A subclass can only make things better, so inheritance is safe."</strong> A
    subclass can break an invariant its base guarantees, as the ledger example does in three
    lines; can be called by base code at a moment when it is half-constructed; and can be
    silently disconnected by an implementation change in the base. Deriving is not a read-only
    operation on the base class — it enrols you in its behaviour and enrols it in yours.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>protected</code> is the safe middle ground between private and
    public."</strong> For <em>methods</em> that is roughly fair. For <em>fields</em> it is not:
    a protected field is public to an unbounded set of authors, and the base class loses the
    ability to enforce anything about it. Prefer a private field with a protected method, so
    there is still a line of code you control between a subclass and your state.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"If it compiles, the override is wired up."</strong> <code>CS0108</code> is a
    warning. A derived method that hides rather than overrides compiles, runs, and produces
    different answers through different references to the same object. Turn warnings into errors
    for this one if you can — treating <code>CS0108</code> as an error costs nothing and removes
    a whole failure mode.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Sealing classes is premature restriction — leave them open in case."</strong>
    This is the same asymmetry as the access modifiers in
    <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a>. Unsealing later is
    free and breaks nobody. Sealing later breaks every subclass that already exists, so in
    practice it never happens. The .NET libraries seal aggressively for exactly this reason, and
    <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a> shows that
    <code>sealed</code> also lets the JIT remove dispatch cost.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"The base class and the derived class can be reviewed independently."</strong> The
    fragile base class demonstration is two files, each of which passes review on its own. The
    defect exists only in the relationship. When a base class calls its own overridable members,
    the unit that has to be reviewed as a whole is the hierarchy, not the file.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr>
        <td>You want another class's behaviour</td>
        <td>Hold it as a field and call it</td>
        <td>Couples you to its public surface only, which is the part it promised to keep.</td>
      </tr>
      <tr>
        <td>Callers must treat several types interchangeably</td>
        <td>A common base class or interface</td>
        <td>This is what inheritance is actually for. The is-a test has to pass.</td>
      </tr>
      <tr>
        <td>A fixed algorithm with one varying step</td>
        <td>Template method: non-virtual public method, one <code>abstract</code> hook</td>
        <td>Subclasses change the step and cannot change the order, validation, or bookkeeping.</td>
      </tr>
      <tr>
        <td>Shared state a subclass needs</td>
        <td><code>private</code> field plus a <code>protected</code> method</td>
        <td>Keeps a line of code you control between the subclass and the invariant.</td>
      </tr>
      <tr>
        <td>A base method that must always run for every path</td>
        <td>Non-virtual, and route the varying part through one overridable member</td>
        <td>A documented single funnel is the only behavioural contract that survives a version
        change.</td>
      </tr>
      <tr>
        <td>Any class you are not deliberately designing for inheritance</td>
        <td><code>sealed</code></td>
        <td>Unsealing is free later; sealing is not. It also removes dispatch cost.</td>
      </tr>
      <tr>
        <td>You need the base's behaviour but the is-a test fails</td>
        <td>Composition</td>
        <td>Inheriting drags the base's whole public surface onto yours whether it makes sense or
        not.</td>
      </tr>
      <tr>
        <td>Deep hierarchy already exists</td>
        <td>Flatten toward composition, leaf-first</td>
        <td>Each level you remove removes a behavioural contract nothing was checking. See
        <a href="#/m/t1-13-composition-over-inheritance">Composition Over Inheritance</a>.</td>
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
    <p>Predict every line of output, in order, and the two values printed by
    <code>Setup</code>.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>class E1Base
{
    private readonly string _f = T.L("E1Base field initialiser");
    public E1Base() { T.L("E1Base ctor"); Setup(); }
    protected virtual void Setup() =&gt; T.L("E1Base.Setup");
}

class E1Derived : E1Base
{
    private readonly string _fromInitialiser = T.L("E1Derived field initialiser");
    private string? _fromCtorBody;

    public E1Derived()
    {
        T.L("E1Derived ctor body");
        _fromCtorBody = "set in ctor body";
    }

    protected override void Setup() =&gt;
        T.L($"E1Derived.Setup sees _fromInitialiser={_fromInitialiser ?? "null"}, " +
            $"_fromCtorBody={_fromCtorBody ?? "null"}");
}

_ = new E1Derived();</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>E1Derived field initialiser
E1Base field initialiser
E1Base ctor
E1Derived.Setup sees _fromInitialiser=E1Derived field initialiser, _fromCtorBody=null
E1Derived ctor body</code></pre>
        <p>The order follows the rule from the construction section: field initialisers run
        derived-to-base, then constructor bodies run base-to-derived. So the derived field
        initialiser is the very first thing that happens, and the derived constructor body is the
        very last.</p>
        <p>The interesting line is the fourth. <code>E1Base</code>'s constructor calls
        <code>Setup()</code>, which is virtual, so it lands in <code>E1Derived</code> — and at
        that moment the derived object is <strong>half initialised</strong>.
        <code>_fromInitialiser</code> has a value, because field initialisers already ran.
        <code>_fromCtorBody</code> is <code>null</code>, because the derived constructor body has
        not started.</p>
        <p>This is the refinement worth carrying: the usual telling of this bug is "derived fields
        are null". That is only true of fields assigned in the constructor body. Whether a given
        field is populated depends on where its author happened to assign it, which means the same
        method can work for one field and fail for the next, and moving an assignment from a field
        initialiser into a constructor for unrelated reasons can introduce the bug months later.
        The fix is not ordering discipline — it is not calling overridable members from
        constructors at all.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p><code>Circle</code> uses <code>override</code>; <code>Square</code> uses <code>new</code>.
    Give all six outputs, and say what <code>Label()</code> reveals that the direct calls do
    not.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>class Shape
{
    public virtual string Draw() =&gt; "shape";
    public string Label() =&gt; "label:" + Draw();
}

class Circle : Shape { public override string Draw() =&gt; "circle"; }
class Square : Shape { public new      string Draw() =&gt; "square"; }

Shape[] asShape = { new Circle(), new Square() };
Console.WriteLine(asShape[0].Draw());
Console.WriteLine(asShape[1].Draw());
Console.WriteLine(new Circle().Draw());
Console.WriteLine(new Square().Draw());
Console.WriteLine(new Circle().Label());
Console.WriteLine(new Square().Label());</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <div class="table-wrap">
        <table>
          <thead><tr><th>Call</th><th>Output</th><th>Why</th></tr></thead>
          <tbody>
            <tr><td><code>asShape[0].Draw()</code></td><td><code>circle</code></td>
                <td>Overridden, so the runtime picks by the object's type.</td></tr>
            <tr><td><code>asShape[1].Draw()</code></td><td><code>shape</code></td>
                <td>Hidden, not overridden. The variable is <code>Shape</code>, so
                <code>Shape.Draw</code> runs.</td></tr>
            <tr><td><code>new Circle().Draw()</code></td><td><code>circle</code></td>
                <td>Same method either way.</td></tr>
            <tr><td><code>new Square().Draw()</code></td><td><code>square</code></td>
                <td>The variable is <code>Square</code>, so the hiding member is chosen.</td></tr>
            <tr><td><code>new Circle().Label()</code></td><td><code>label:circle</code></td>
                <td><code>Label</code> calls the virtual <code>Draw</code>, which reaches the
                override.</td></tr>
            <tr><td><code>new Square().Label()</code></td><td><code>label:shape</code></td>
                <td>The key line — see below.</td></tr>
          </tbody>
        </table>
        </div>
        <p>The last row is what the direct calls hide. <code>Label()</code> is declared on
        <code>Shape</code>, so the <code>Draw()</code> inside it is compiled against
        <code>Shape</code> and uses the virtual slot. <code>Square.Draw</code> never entered that
        slot, because <code>new</code> creates a separate member rather than replacing one. So
        <code>Square</code> gets <code>square</code> when called directly and <code>shape</code>
        when called through any base class code — including code in the base class you did not
        write and cannot see.</p>
        <p>That is the practical danger of hiding. The wrong answer does not appear where you
        test it; it appears wherever base-class code, or any caller holding a base-typed
        reference, invokes the member. A collection of <code>Shape</code>, a LINQ query over
        <code>Shape</code>, a serialiser, or a base method like <code>Label</code> all take the
        base version.</p>
        <p><code>Square</code> should have said <code>override</code>. Written without either
        keyword it would have compiled with warning <code>CS0108</code>, behaved exactly as it
        does here, and the warning is the only signal you would get.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A service derives from a library class and overrides only <code>Add</code>, incrementing a
    counter. After a library upgrade the counter reports zero, though items are still stored
    correctly. The service's source has not changed and rebuilding it changes nothing. Explain
    what happened, say why a rebuild cannot help, contrast it with the
    <code>MissingFieldException</code> failure from the previous module, and give two fixes — one
    for the library author and one for the service author.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>What happened.</strong> In the old version, the library's bulk method was
        implemented as a loop calling <code>Add</code>, so every item passed through the override.
        The new version writes to the backing store directly. Both versions have identical public
        surfaces and identical documented behaviour; what changed is which internal path a bulk
        insert takes. The override is still called for single-item adds — which is why unit tests
        that call <code>Add</code> directly still pass.</p>
        <p><strong>Why a rebuild cannot help.</strong> Nothing is mismatched. Both assemblies
        agree on every signature, so there is nothing for the compiler or the runtime loader to
        reconcile. The dependency that broke — "the bulk method routes through
        <code>Add</code>" — has no representation in metadata, so no tool can check it. Recompiling
        against the new library produces a program that is correct by every mechanical standard
        and still does not record the audits.</p>
        <p><strong>Contrast with the previous module.</strong> Turning a public field into a
        property produced <code>MissingFieldException</code> immediately, on the first call, and a
        rebuild fixed it completely. That was a <em>binary</em> break: two builds disagreeing about
        the shape of a member, which the runtime detects and reports.</p>
        <div class="table-wrap">
        <table>
          <thead><tr><th></th><th>Field to property</th><th>Fragile base class</th></tr></thead>
          <tbody>
            <tr><td>Fails</td><td>Loudly, first call</td><td>Silently, possibly for months</td></tr>
            <tr><td>Detected by</td><td>The runtime</td><td>Nothing</td></tr>
            <tr><td>Rebuild fixes it</td><td>Yes</td><td>No</td></tr>
            <tr><td>Nature</td><td>Binary mismatch</td><td>Behavioural mismatch</td></tr>
          </tbody>
        </table>
        </div>
        <p>The loud failure is the safer one. A break that announces itself costs an afternoon;
        one that does not costs eleven weeks of missing audit records.</p>
        <p><strong>Fix for the library author.</strong> Decide, and write it down, whether the
        overridable member is a guaranteed funnel. If it is, that is part of the public contract
        and the bulk method must keep routing through it — the optimisation is then not
        available, which is the price of having offered the extension point.
        <code>Collection&lt;T&gt;</code> in the .NET libraries is the worked example: its
        protected <code>InsertItem</code> is documented as the single path every insertion takes,
        precisely so subclasses can rely on it. If it is not a guaranteed funnel, the member
        should not be <code>virtual</code>, or the class should be <code>sealed</code>.</p>
        <p><strong>Fix for the service author.</strong> Stop depending on the base's internal
        routing. Either wrap rather than derive — hold the collection as a private field and
        expose your own <code>Add</code> and <code>AddRange</code>, which makes the audit write
        unconditional and the compiler check the whole dependency — or, if deriving is required,
        assert the invariant in production rather than in a test:
        <code>records written == items stored</code>, checked on a timer or at the end of each
        batch, alerting when it fails. That check would have found this in minutes and catches
        every future instance of the same category, not only this one.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>This cache is designed to be extended. Find every way a subclass can break it, then
    rewrite it so none of them is possible while keeping the ability to customise how keys are
    treated.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 4 — as given"><code>class BadCache
{
    protected readonly Dictionary&lt;string, string&gt; Store = new();
    protected int Hits;

    public int HitCount =&gt; Hits;

    public string? Get(string k)
    {
        if (Store.TryGetValue(k, out var v)) { Hits++; return v; }
        return null;
    }

    public void Put(string k, string v) =&gt; Store[k] = v;
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The ways a subclass can break it.</strong></p>
        <ol>
          <li><code>Store</code> is <code>protected</code>, so a subclass can add, remove or clear
          entries without <code>Put</code> or <code>Get</code> ever running. Any invariant tying
          the dictionary to anything else is gone.</li>
          <li><code>Hits</code> is <code>protected</code>, so a subclass can zero or inflate the
          metric. A monitoring dashboard reading <code>HitCount</code> is reporting a number any
          subclass may have edited.</li>
          <li>Neither <code>Get</code> nor <code>Put</code> is virtual, so a subclass wanting to
          change key handling has no hook and will reach for the field instead — the design pushes
          people toward the first two problems.</li>
          <li>The class is not <code>sealed</code> and has no documented contract, so every one of
          these is available to authors who have never read it.</li>
          <li>Keys are used raw, so <code>"A"</code> and <code>"a"</code> are separate entries.
          Not an inheritance defect, but it is the reason someone would subclass this in the first
          place.</li>
        </ol>
        <p>Running the subclass that does the obvious things:</p>
        <pre data-lang="console" data-title="Output"><code>before reset, hits: 2
after  reset, hits: 0  (metric silently zeroed)</code></pre>
        <p><strong>The rewrite.</strong> The variation people actually want is key handling, so
        make <em>that</em> the extension point and close everything else. Here it is supplied as a
        function rather than by inheritance at all:</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4 — rewritten"><code>sealed class GoodCache
{
    private readonly Dictionary&lt;string, string&gt; _store = new();
    private int _hits;
    private readonly Func&lt;string, string&gt; _normalise;

    public GoodCache(Func&lt;string, string&gt;? normalise = null)
        =&gt; _normalise = normalise ?? (k =&gt; k);

    public int HitCount =&gt; _hits;
    public int Count =&gt; _store.Count;

    public string? Get(string key)
    {
        if (_store.TryGetValue(_normalise(key), out var v)) { _hits++; return v; }
        return null;
    }

    public void Put(string key, string value) =&gt; _store[_normalise(key)] = value;
}</code></pre>
        <pre data-lang="console" data-title="Output"><code>GoodCache normalises: Count=1, Get("A")=2
GoodCache hits: 1</code></pre>
        <p><code>Put("A", "1")</code> then <code>Put("a", "2")</code> produced one entry holding
        <code>"2"</code>, and reading <code>"A"</code> found it.</p>
        <p><strong>Why this shape.</strong> Every field is private, so no subclass can reach the
        state — and the class is <code>sealed</code>, so there are no subclasses at all. The one
        thing callers wanted to vary is a constructor parameter, which means it is checked by the
        compiler, visible at the call site, testable without building a type, and impossible to
        use to reach anything else.</p>
        <p><strong>If inheritance is genuinely required</strong> — because callers must be able to
        hold a base-typed reference and treat implementations interchangeably — keep the fields
        private and expose exactly one hook:</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4 — the inheritance version"><code>class CacheBase
{
    private readonly Dictionary&lt;string, string&gt; _store = new();
    private int _hits;

    public int HitCount =&gt; _hits;
    public int Count =&gt; _store.Count;

    // The single point of variation. Everything else is closed.
    protected virtual string Normalise(string key) =&gt; key;

    public string? Get(string key)
    {
        if (_store.TryGetValue(Normalise(key), out var v)) { _hits++; return v; }
        return null;
    }

    public void Put(string key, string value) =&gt; _store[Normalise(key)] = value;
}

sealed class CaseInsensitiveCache : CacheBase
{
    protected override string Normalise(string key) =&gt; key.ToLowerInvariant();
}</code></pre>
        <p>Note what this version still owes its subclasses, and say it out loud in a comment if
        you ship it: <em>every key passes through <code>Normalise</code> exactly once, on both
        read and write.</em> That sentence is the behavioural contract. Having written it down,
        you are not allowed to add a bulk method later that skips it — which is exactly the
        obligation the library author in exercise 3 did not know they had taken on.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>Which members does a derived class <em>not</em> inherit? And what is true of private base
      fields in a derived instance?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Constructors and finalisers are not inherited. Private base fields <strong>are</strong>
        inherited in the sense that every derived instance carries them and they occupy memory —
        the derived class cannot refer to them by name (<code>CS0122</code>). Inheritance
        of state and access to state are separate things.</p>
      </div></details>
    </li>
    <li>
      <p>In what order do field initialisers and constructor bodies run across a three-level
      hierarchy?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Field initialisers run <strong>derived to base</strong>; constructor bodies run
        <strong>base to derived</strong>. Each level runs its own field initialisers and then
        evaluates its <code>base(...)</code> arguments on the way down; bodies execute on the way
        back up. The two halves run in opposite directions.</p>
      </div></details>
    </li>
    <li>
      <p>A base constructor calls a virtual method. What exactly is initialised in the derived
      object at that moment?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The derived class's <strong>field initialisers have run</strong>; its
        <strong>constructor body has not</strong>. So fields assigned by an initialiser have
        values and fields assigned in the constructor are still at their defaults. Which fields
        fall into which group is an authoring accident, so the same override can work for one
        field and fail for the next.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>base.Method()</code> do that a plain <code>Method()</code> call does
      not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>base.Method()</code> is a <strong>non-virtual</strong> call: it invokes the base
        class's implementation specifically, bypassing the virtual slot even though the object's
        own override exists. A plain <code>Method()</code> call goes through the slot and reaches
        the most-derived override.</p>
      </div></details>
    </li>
    <li>
      <p>Define the fragile base class problem in one sentence, and give the two shapes it
      takes.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A change to a base class that is correct in isolation and changes no public behaviour
        breaks a derived class, because the derived class depended on <em>how</em> the base was
        implemented. Shape one: the base calls its own overridable member, so a subclass
        overriding two related methods double-counts. Shape two: the base stops calling that
        member, so a subclass that overrode only it silently stops being invoked.</p>
      </div></details>
    </li>
    <li>
      <p>Why does rebuilding fix the <code>MissingFieldException</code> from the previous module
      but not the fragile base class failure?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The first is a <strong>binary</strong> mismatch — two builds disagreeing about the shape
        of a member — which the runtime detects and a rebuild reconciles. The second is a
        <strong>behavioural</strong> mismatch: every signature still agrees, so there is nothing to
        reconcile. The broken assumption has no representation in metadata, so no tool can see it
        and recompiling changes nothing.</p>
      </div></details>
    </li>
    <li>
      <p>Which of the inheritance mistakes produces only a warning, and why is that the dangerous
      one?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>CS0108</code>, accidental member hiding. It is dangerous because the build
        succeeds and the program then gives different answers for the same object depending on
        the declared type of the reference used — including inside base-class code you did not
        write. Everything the compiler can prove wrong it refuses outright; this one it lets
        through.</p>
      </div></details>
    </li>
    <li>
      <p>Why is a <code>protected</code> field worse than a <code>protected</code> method?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A protected field lets any subclass change state without any of the base class's code
        running, so the base loses the ability to enforce anything about it — it is
        <code>public</code> to an unbounded set of future authors. A protected method keeps a line
        of code you control between the subclass and your state.</p>
      </div></details>
    </li>
    <li>
      <p>What is the template method shape, and which member is deliberately <em>not</em>
      virtual?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A non-virtual public method owns the algorithm — validation, ordering, bookkeeping,
        error handling — and calls one overridable member for the part that varies.
        <strong>The public method is the non-virtual one.</strong> Subclasses change the step and
        cannot change the sequence around it.</p>
      </div></details>
    </li>
    <li>
      <p>Give the asymmetry that makes <code>sealed</code> the cheap default.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Unsealing later is free and breaks nobody. Sealing later breaks every subclass that
        already exists, so in practice it never happens. The same shape as narrow-by-default
        access modifiers — and <code>sealed</code> additionally lets the JIT remove dispatch
        cost.</p>
      </div></details>
    </li>
    <li>
      <p>You derive from a class in a shared library. What single question should you ask about
      every method on it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><em>Does this method call any of the class's own overridable members?</em> Every "yes"
        is a behavioural contract you are about to depend on, which nothing will check and which
        the library author can change without knowing you exist.</p>
      </div></details>
    </li>
    <li>
      <p>What is the cheapest production guard against this whole category of failure?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Assert the invariant at runtime, not only in tests — for the audit example,
        <em>records written equals items processed</em>, checked per batch or on a timer, alerting
        on mismatch. Tests exercise your subclass against the base you had when you wrote them; a
        production check catches the version where the base changed, and catches the whole
        category rather than one instance.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
