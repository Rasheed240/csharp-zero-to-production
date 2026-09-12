/* ============================================================================
   Track 1, Module 12 — Abstraction, Abstract Classes, and Interfaces
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every diagnostic in this module was compiled and run on
   .NET 10.0.400 (runtime 10.0.11), Windows 11 x64.
   The runnable sources are in verification/t1-12-abstraction-and-interfaces/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-12-abstraction-and-interfaces",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "An abstract class shares mechanism; an interface states a role. The choice between them " +
    "is mostly a versioning decision — adding a member to a published interface breaks every " +
    "implementor at run time, which is the problem default interface methods exist to solve " +
    "and the reason they behave unlike anything else in C#.",
  terms: [
    "abstraction", "abstract class", "abstract member", "concrete class",
    "interface", "contract", "role", "implicit implementation",
    "explicit implementation", "default interface method", "diamond problem",
    "most specific implementation", "static abstract member", "generic math",
    "TypeLoadException", "CS0535", "CS0534", "CS0144", "CS8705", "CS1061",
    "interface segregation", "test double"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A platform team ships an internal library with a notification contract that eleven services
  implement. A new requirement arrives: urgent notifications. They add one member to the contract,
  bump the version, and publish.</p>

  <p>Nine of the eleven services fail to compile on their next build, with an error naming a method
  none of them has ever heard of. The two that do not fail are worse: they were deployed without a
  rebuild, and they crash on startup — not on the first urgent notification, but on the first
  attempt to <em>load the type at all</em>, with an exception that names a method that does not
  exist in their source.</p>

  <p>Elsewhere, a different team has the opposite complaint. Their base class works, and a new
  subclass needs to be both a report generator and a scheduled task. It can only have one base
  class, and both candidates carry code it needs.</p>

  <p>And a third: a class that implements two libraries' interfaces, each of which requires a
  method called <code>Write</code>, meaning different things. One method cannot be both.</p>

  <p>These are the three questions this module answers. <strong>What can I state as a requirement
  without supplying an implementation? How do I add to that requirement later without breaking
  everyone? And what happens when two requirements collide?</strong> The tools are abstract
  classes and interfaces, and the interesting part is not their syntax — it is which one you can
  still change after other people depend on it.</p>
</section>

<section id="what-abstraction-is">
  <h2>Two ways to say "something goes here"</h2>

  <p class="define"><span class="define__term">Abstraction</span> Describing what something must
  do without saying how. In C# that means declaring members with no body, so that the declaration
  is a requirement on whoever implements it rather than working code.</p>

  <p class="define"><span class="define__term">Abstract member</span> A member declared with the
  <code>abstract</code> keyword and no body. Every concrete class that inherits it must supply
  one. Leaving it out is compile error <code>CS0534</code>.</p>

  <p class="define"><span class="define__term">Abstract class</span> A class containing abstract
  members, or marked <code>abstract</code>. It cannot be instantiated —
  <code>new Exporter()</code> is <code>CS0144</code> — because parts of it are missing. It exists
  to be inherited from.</p>

  <p class="define"><span class="define__term">Concrete class</span> The opposite: a class with no
  unimplemented members, which can be instantiated. Every abstract class needs concrete
  descendants to be of any use.</p>

  <p class="define"><span class="define__term">Interface</span> A named set of members with no
  state and, traditionally, no implementations. A type declares that it implements one, and
  thereby promises those members. A type may implement any number of interfaces while having only
  one base class.</p>

  <p>The distinction that matters is not the keyword list. It is this: <strong>an abstract class
  shares mechanism; an interface states a role.</strong></p>

  <p>An abstract class says "you are one of these, and here is the machinery you get". It brings
  fields, constructors, state, and working code. It costs you your single inheritance slot.</p>

  <p>An interface says "you can be used as one of these". It brings no state and no slot cost. A
  class can be an <code>IDisposable</code>, an <code>IComparable</code>, and an
  <code>IValidator</code> at once, because those are three roles, not three identities.</p>

  <p>The analogy: an abstract class is a job you were hired into — it comes with an office, a
  laptop and a manager, and you can only hold one. An interface is a qualification you list on
  your profile: it certifies you can do something and you can list as many as are true.
  <strong>The analogy's limit is state.</strong> It suggests interfaces are the lighter option
  in every respect, and one thing they are not lighter about is versioning: an employer can change
  your equipment without consulting you, but adding a requirement to a qualification other people
  already claim to hold breaks all of them at once. That asymmetry is most of this module.</p>
</section>

<section id="abstract-classes">
  <h2>abstract, virtual, and neither</h2>

  <p><a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a> covered
  <code>virtual</code>. <code>abstract</code> is the same slot mechanism with the default
  removed.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-abstract-vs-virtual.cs"><code>// 01-abstract-vs-virtual.cs — what abstract adds over virtual, and what the
// compiler enforces in each case.
// .NET 10.0.400. Run: dotnet run 01-abstract-vs-virtual.cs

#:property NoWarn=IL2075

using System;
using System.Linq;
using System.Reflection;

abstract class Exporter
{
    // ABSTRACT: no body. Every concrete subclass MUST supply one.
    public abstract string Extension { get; }
    public abstract string Serialise(string[] rows);

    // VIRTUAL: has a body. Subclasses MAY replace it.
    public virtual string Describe() =&gt; $"exporter producing .{Extension} files";

    // Neither: subclasses get this and cannot change it.
    public string Export(string[] rows) =&gt; $"{Serialise(rows)}  [.{Extension}]";
}

sealed class CsvExporter : Exporter
{
    public override string Extension =&gt; "csv";
    public override string Serialise(string[] rows) =&gt; string.Join(",", rows);
}

sealed class TsvExporter : Exporter
{
    public override string Extension =&gt; "tsv";
    public override string Serialise(string[] rows) =&gt; string.Join("\t", rows);
    public override string Describe() =&gt; "tab-separated exporter";
}

// An abstract class may derive from another and stay abstract.
abstract class BufferedExporter : Exporter
{
    public override string Describe() =&gt; $"buffered {base.Describe()}";
    // Serialise and Extension are still unimplemented. That is legal here.
}

sealed class JsonExporter : BufferedExporter
{
    public override string Extension =&gt; "json";
    public override string Serialise(string[] rows) =&gt;
        "[" + string.Join(",", rows.Select(r =&gt; $"\"{r}\"")) + "]";
}

class Program
{
    static void Main()
    {
        string[] rows = { "id", "name", "amount" };

        Exporter[] all = { new CsvExporter(), new TsvExporter(), new JsonExporter() };
        foreach (var e in all)
        {
            Console.WriteLine($"{e.GetType().Name,-14} {e.Describe()}");
            Console.WriteLine($"               {e.Export(rows).Replace("\t", "&lt;TAB&gt;")}");
        }

        Console.WriteLine();
        Console.WriteLine("What the compiler records:");
        foreach (var t in new[] { typeof(Exporter), typeof(BufferedExporter), typeof(CsvExporter) })
            Console.WriteLine($"  {t.Name,-18} IsAbstract={t.IsAbstract,-6} IsSealed={t.IsSealed}");

        Console.WriteLine();
        Console.WriteLine("Members of Exporter, and which kind each is:");
        foreach (var m in typeof(Exporter)
                 .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                 .OrderBy(m =&gt; m.Name))
        {
            string kind = m.IsAbstract ? "abstract" : m.IsVirtual ? "virtual" : "non-virtual";
            Console.WriteLine($"  {m.Name,-16} {kind}");
        }

        Console.WriteLine();
        Console.WriteLine("An abstract class cannot be instantiated:");
        try
        {
            var made = Activator.CreateInstance(typeof(Exporter));
            Console.WriteLine($"  created {made}");
        }
        catch (MissingMethodException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}");
        }
        Console.WriteLine("  (in source, 'new Exporter()' is compile error CS0144)");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>CsvExporter    exporter producing .csv files
               id,name,amount  [.csv]
TsvExporter    tab-separated exporter
               id&lt;TAB&gt;name&lt;TAB&gt;amount  [.tsv]
JsonExporter   buffered exporter producing .json files
               ["id","name","amount"]  [.json]

What the compiler records:
  Exporter           IsAbstract=True   IsSealed=False
  BufferedExporter   IsAbstract=True   IsSealed=False
  CsvExporter        IsAbstract=False  IsSealed=True

Members of Exporter, and which kind each is:
  Describe         virtual
  Export           non-virtual
  get_Extension    abstract
  Serialise        abstract

An abstract class cannot be instantiated:
  MissingMethodException: Cannot dynamically create an instance of type 'Exporter'. Reason: Cannot create an abstract class.
  (in source, 'new Exporter()' is compile error CS0144)</code></pre>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Declaration</th><th>Has a body</th><th>Subclass must implement</th><th>Subclass may override</th></tr></thead>
    <tbody>
      <tr><td><code>abstract</code></td><td>no</td><td><strong>yes</strong></td><td>—</td></tr>
      <tr><td><code>virtual</code></td><td>yes</td><td>no</td><td>yes</td></tr>
      <tr><td>neither</td><td>yes</td><td>no</td><td><strong>no</strong></td></tr>
      <tr><td><code>sealed override</code></td><td>yes</td><td>no</td><td>no, from here down</td></tr>
    </tbody>
  </table>
  </div>

  <p>Two things in the example are worth stopping on.</p>

  <p><strong><code>BufferedExporter</code> is abstract and leaves abstract members
  unimplemented.</strong> That is legal: an abstract class inheriting from another need not
  complete it. Only a <em>concrete</em> class must, which is what <code>CS0534</code> enforces.
  This lets a hierarchy add mechanism at an intermediate level without pretending to have answers
  it does not have.</p>

  <p><strong>Prefer <code>abstract</code> to <code>virtual</code> when there is no sensible
  default.</strong> This is the direct consequence of the fragile base class problem from
  <a href="#/m/t1-10-inheritance">Inheritance</a>: a <code>virtual</code> member with a body is a
  behavioural contract that subclasses may come to depend on, and that you may change later. An
  <code>abstract</code> member has no body, so there is nothing to depend on and nothing to break.
  It also converts a runtime mistake into a compile error — forgetting to override a
  <code>virtual</code> member silently uses the base version; forgetting an <code>abstract</code>
  one does not build.</p>
</section>

<section id="interfaces">
  <h2>Interfaces, and what implementing one costs</h2>

  <p>An interface is implemented in one of two ways, and the difference is visible from outside.</p>

  <p class="define"><span class="define__term">Implicit implementation</span> An ordinary public
  member that happens to match the interface. It is on the class's public surface and callable
  through either the class or the interface. This is the default and usually what you want.</p>

  <p class="define"><span class="define__term">Explicit implementation</span> A member written
  <code>string IJsonWriter.Write(object value)</code>, with no access modifier. It is reachable
  <em>only</em> through that interface. Giving it one is <code>CS0106</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-explicit-implementation.cs"><code>// 02-explicit-implementation.cs — implementing an interface member so that it
// is reachable ONLY through the interface, and why that is sometimes the only
// legal option.
// .NET 10.0.400. Run: dotnet run 02-explicit-implementation.cs

using System;
using System.Collections.Generic;
using System.Linq;

interface IJsonWriter { string Write(object value); }
interface IXmlWriter { string Write(object value); }     // same signature, different meaning

// Implementing both implicitly is impossible: one method cannot be both.
// Explicit implementation gives each interface its own member.
sealed class DualWriter : IJsonWriter, IXmlWriter
{
    string IJsonWriter.Write(object value) =&gt; $"{{\"value\":\"{value}\"}}";
    string IXmlWriter.Write(object value) =&gt; $"&lt;value&gt;{value}&lt;/value&gt;";

    // The class's own, ordinary member. Unrelated to either interface.
    public string Write(object value) =&gt; $"default:{value}";
}

// Hiding a member that would clutter the public surface.
interface ILifecycle
{
    void Start();
    void Stop();
}

sealed class BackgroundWorker : ILifecycle
{
    private bool _running;

    // Explicit: callers holding a BackgroundWorker cannot call these by accident.
    // Only the host, which holds an ILifecycle, can.
    void ILifecycle.Start() { _running = true; Console.WriteLine("  worker started"); }
    void ILifecycle.Stop() { _running = false; Console.WriteLine("  worker stopped"); }

    public bool IsRunning =&gt; _running;
    public int Process(int items) =&gt; _running ? items : 0;
}

class Program
{
    static void Main()
    {
        var w = new DualWriter();

        Console.WriteLine("Same object, three different Write methods:");
        Console.WriteLine($"  w.Write(42)                : {w.Write(42)}");
        Console.WriteLine($"  ((IJsonWriter)w).Write(42) : {((IJsonWriter)w).Write(42)}");
        Console.WriteLine($"  ((IXmlWriter)w).Write(42)  : {((IXmlWriter)w).Write(42)}");

        Console.WriteLine();
        Console.WriteLine("Explicit members are not on the class's public surface:");
        var publicNames = typeof(BackgroundWorker)
            .GetMethods(System.Reflection.BindingFlags.Public
                      | System.Reflection.BindingFlags.Instance
                      | System.Reflection.BindingFlags.DeclaredOnly)
            .Select(m =&gt; m.Name).OrderBy(n =&gt; n);
        Console.WriteLine($"  public methods on BackgroundWorker: {string.Join(", ", publicNames)}");
        Console.WriteLine("  Start and Stop are absent — 'worker.Start()' is a compile error.");

        var bw = new BackgroundWorker();
        Console.WriteLine($"  before: IsRunning={bw.IsRunning}, Process(10)={bw.Process(10)}");

        ILifecycle host = bw;
        host.Start();
        Console.WriteLine($"  after : IsRunning={bw.IsRunning}, Process(10)={bw.Process(10)}");
        host.Stop();

        Console.WriteLine();
        Console.WriteLine("The members do exist, marked private and final in metadata:");
        foreach (var m in typeof(BackgroundWorker)
                 .GetMethods(System.Reflection.BindingFlags.NonPublic
                           | System.Reflection.BindingFlags.Instance
                           | System.Reflection.BindingFlags.DeclaredOnly)
                 .Where(m =&gt; m.Name.Contains("ILifecycle"))
                 .OrderBy(m =&gt; m.Name))
            Console.WriteLine($"  {m.Name}  IsPrivate={m.IsPrivate}, IsFinal={m.IsFinal}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Same object, three different Write methods:
  w.Write(42)                : default:42
  ((IJsonWriter)w).Write(42) : {"value":"42"}
  ((IXmlWriter)w).Write(42)  : &lt;value&gt;42&lt;/value&gt;

Explicit members are not on the class's public surface:
  public methods on BackgroundWorker: get_IsRunning, Process
  Start and Stop are absent — 'worker.Start()' is a compile error.
  before: IsRunning=False, Process(10)=0
  worker started
  after : IsRunning=True, Process(10)=10
  worker stopped

The members do exist, marked private and final in metadata:
  ILifecycle.Start  IsPrivate=True, IsFinal=True
  ILifecycle.Stop  IsPrivate=True, IsFinal=True</code></pre>

  <p>Explicit implementation has exactly two good uses.</p>

  <p><strong>Resolving a collision.</strong> <code>IJsonWriter</code> and <code>IXmlWriter</code>
  both require <code>string Write(object)</code>. One method cannot produce both JSON and XML, and
  an implicit implementation would have to. Explicit implementation gives each interface its own
  member — the same object answers differently depending on which role you address it in, which
  is correct here rather than the pathology it was in
  <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a>, because the two callers
  genuinely want different things.</p>

  <p><strong>Keeping infrastructure off the public surface.</strong> <code>BackgroundWorker</code>
  must expose <code>Start</code> and <code>Stop</code> to its host, and nobody else should call
  them. Implementing <code>ILifecycle</code> explicitly means the host — which holds an
  <code>ILifecycle</code> — can, and application code holding a <code>BackgroundWorker</code>
  cannot, with the compiler enforcing it. This is the access-modifier reasoning from
  <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a> applied to roles rather
  than to members.</p>

  <div class="callout callout--gotcha">
    <h4>Explicit implementations are invisible to a debugger's member list and to
    anything reflecting over public members</h4>
    <p>The metadata shows them as private and
    final, with names like <code>ILifecycle.Start</code> that are not legal C# identifiers. A
    serialiser walking public members will not see them; a mapping library configured by
    convention will not find them. That is usually the point, and it is occasionally an afternoon
    of confusion.</p>
  </div>
</section>

<section id="versioning">
  <h2>The versioning difference, which is the real decision</h2>

  <p>Everything above is textbook. This section is the reason the choice matters.</p>

  <p>An interface with eleven implementors across eleven repositories. Version 1:</p>

  <pre data-lang="csharp" data-net="10" data-title="INotifier.v1"><code>namespace Lib;

// VERSION 1 — one member.
public interface INotifier
{
    string Send(string message);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Program.cs"><code>using System;
using Lib;

// An implementation written against version 1. Never edited again.
public class EmailNotifier : INotifier
{
    public string Send(string message) =&gt; "email: " + message;
}

class Program
{
    static void Main()
    {
        INotifier n = new EmailNotifier();
        Console.WriteLine(n.Send("deploy finished"));
        Console.WriteLine("EmailNotifier still loads and runs.");
        Probe.Run(n);
    }
}</code></pre>

  <pre data-lang="console" data-title="Output — against v1"><code>email: deploy finished
EmailNotifier still loads and runs.</code></pre>

  <p>Now one member is added, the way you would add a method to a class:</p>

  <pre data-lang="csharp" data-net="10" data-title="INotifier.v2"><code>namespace Lib;

// VERSION 2 — a second member added, with NO default implementation.
public interface INotifier
{
    string Send(string message);
    string SendUrgent(string message);
}</code></pre>

  <p>Drop the new <code>Lib.dll</code> beside the untouched application:</p>

  <pre data-lang="console" data-title="Output — v2 dropped in, app not rebuilt"><code>Unhandled exception. System.TypeLoadException: Method 'SendUrgent' in type 'EmailNotifier'
   from assembly 'App, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null'
   does not have an implementation.
   at Program.Main()

exit code: 127</code></pre>

  <p>And rebuilding does not rescue it — it converts the runtime failure into a compile failure:</p>

  <pre data-lang="console" data-title="Recompiling the app against v2"><code>error CS0535: 'EmailNotifier' does not implement interface member 'INotifier.SendUrgent(string)'</code></pre>

  <p class="define"><span class="define__term">TypeLoadException</span> Thrown when the runtime
  tries to prepare a type and finds it incoherent — here, a type claiming to implement an
  interface without supplying every member. It happens when the <em>type</em> is first used, not
  when the missing member is called, so a service can die on startup over a method no request
  would ever have reached.</p>

  <p><strong>Adding a member to a published interface is both a source break and a binary
  break.</strong> Compare that with the two failures already met in this course:</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th></th><th>Field → property<br><small>(t1-09)</small></th><th>Base changes internals<br><small>(t1-10)</small></th><th>Interface gains a member</th></tr></thead>
    <tbody>
      <tr><td>Fails</td><td>Loudly, first call</td><td>Silently, maybe never</td><td>Loudly, on type load</td></tr>
      <tr><td>Symptom</td><td><code>MissingFieldException</code></td><td>none</td><td><code>TypeLoadException</code></td></tr>
      <tr><td>Rebuild fixes it</td><td>yes</td><td>no</td><td>no — becomes <code>CS0535</code></td></tr>
      <tr><td>Who must act</td><td>whoever deploys</td><td>nobody knows</td><td>every implementor</td></tr>
    </tbody>
  </table>
  </div>

  <p>This is why an abstract class is the easier thing to version: adding a member with a body
  breaks nobody, because subclasses inherit it. An interface had no such option — until C# 8.</p>
</section>

<section id="default-interface-methods">
  <h2>Default interface methods</h2>

  <p class="define"><span class="define__term">Default interface method</span> An interface member
  with a body. Implementors that do not supply the member get this implementation; implementors
  that do supply one override it. Added in C# 8 specifically so that an interface can gain a
  member without breaking existing implementors.</p>

  <p>The same addition, this time with a body:</p>

  <pre data-lang="csharp" data-net="10" data-title="INotifier.v3"><code>namespace Lib;

// VERSION 3 — the same new member, but with a DEFAULT IMPLEMENTATION.
// A default interface method (C# 8+). Existing implementors need no change.
public interface INotifier
{
    string Send(string message);

    string SendUrgent(string message) =&gt; "URGENT: " + Send(message);
}</code></pre>

  <pre data-lang="console" data-title="Output — v3 dropped in, app still not rebuilt"><code>email: deploy finished
EmailNotifier still loads and runs.
URGENT: email: disk almost full</code></pre>

  <p>The untouched <code>EmailNotifier</code> loads, runs, and now has a working
  <code>SendUrgent</code> it never wrote — one that calls its own <code>Send</code>. That is the
  whole feature, and it is why <code>IEnumerable</code>-shaped interfaces in the base class
  library could finally grow.</p>

  <p>Two things about default interface methods surprise everyone, and both are visible here:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-default-interface-methods.cs"><code>// 03-default-interface-methods.cs — an interface member with a body. What it
// buys, and the two things about it that surprise people.
// .NET 10.0.400. Run: dotnet run 03-default-interface-methods.cs

using System;

interface IAuditable
{
    string Id { get; }

    // A default interface method: a body, in an interface.
    string AuditLine() =&gt; $"audit:{Id}";

    // Defaults can call other members, including ones with no default.
    string AuditLineWithReason(string reason) =&gt; $"{AuditLine()} reason={reason}";
}

// Implements only what has no default.
sealed class Payment : IAuditable
{
    public string Id =&gt; "PMT-1";
}

// Supplies its own version, which wins.
sealed class Refund : IAuditable
{
    public string Id =&gt; "RFD-1";
    public string AuditLine() =&gt; $"REFUND-AUDIT:{Id}";
}

// ---- two interfaces with the same member NAME is NOT a diamond -------------
// ILeft.Name and IRight.Name are different members that happen to share a name.
// A class may implement both with no ambiguity at all.
interface ILeft { string Name() =&gt; "left"; }
interface IRight { string Name() =&gt; "right"; }

sealed class Quiet : ILeft, IRight { }        // compiles; no member of its own

sealed class Both : ILeft, IRight
{
    public string Name() =&gt; "the class's own Name";
}

// ---- the REAL diamond: one base member, two competing implementations -----
interface IBase { string Describe(); }
interface IUpper : IBase { string IBase.Describe() =&gt; "UPPER"; }
interface ILower : IBase { string IBase.Describe() =&gt; "lower"; }

// 'sealed class Ambiguous : IUpper, ILower { }' is CS8705.
// Naming a winner resolves it.
sealed class Resolved : IUpper, ILower
{
    public string Describe() =&gt; "resolved explicitly by the class";
}

class Program
{
    static void Main()
    {
        var payment = new Payment();
        var refund = new Refund();

        Console.WriteLine("Through the INTERFACE:");
        Console.WriteLine($"  Payment : {((IAuditable)payment).AuditLine()}");
        Console.WriteLine($"  Refund  : {((IAuditable)refund).AuditLine()}");
        Console.WriteLine($"  Payment : {((IAuditable)payment).AuditLineWithReason("chargeback")}");

        Console.WriteLine();
        Console.WriteLine("Through the CLASS:");
        Console.WriteLine($"  refund.AuditLine()  : {refund.AuditLine()}");
        Console.WriteLine("  payment.AuditLine() : does not compile — CS1061.");
        Console.WriteLine("  A default implementation is a member of the INTERFACE, not of the");
        Console.WriteLine("  class. The class does not inherit it onto its own surface.");

        Console.WriteLine();
        Console.WriteLine("Reflection confirms it:");
        Console.WriteLine($"  typeof(Payment).GetMethod(\"AuditLine\") is null : " +
                          $"{typeof(Payment).GetMethod("AuditLine") is null}");
        Console.WriteLine($"  typeof(IAuditable).GetMethod(\"AuditLine\") is null : " +
                          $"{typeof(IAuditable).GetMethod("AuditLine") is null}");
        var m = typeof(IAuditable).GetMethod("AuditLine")!;
        Console.WriteLine($"  IAuditable.AuditLine IsAbstract={m.IsAbstract} (false = it has a body)");

        Console.WriteLine();
        Console.WriteLine("Two interfaces sharing a member NAME — not a diamond:");
        var quiet = new Quiet();
        Console.WriteLine($"  ((ILeft)quiet).Name()   : {((ILeft)quiet).Name()}");
        Console.WriteLine($"  ((IRight)quiet).Name()  : {((IRight)quiet).Name()}");
        Console.WriteLine("  Quiet declares no Name at all and compiles. The two defaults are");
        Console.WriteLine("  different members; each interface keeps its own. Only");
        Console.WriteLine("  'quiet.Name()' fails, with CS1061 — defaults are not on the class.");

        var both = new Both();
        Console.WriteLine($"  both.Name()            : {both.Name()}");
        Console.WriteLine($"  ((ILeft)both).Name()   : {((ILeft)both).Name()}");
        Console.WriteLine($"  ((IRight)both).Name()  : {((IRight)both).Name()}");

        Console.WriteLine();
        Console.WriteLine("The real diamond — one base member, two implementations:");
        IBase r = new Resolved();
        Console.WriteLine($"  ((IBase)resolved).Describe() : {r.Describe()}");
        Console.WriteLine("  Without the class's own Describe(), this is CS8705:");
        Console.WriteLine("  'Interface member IBase.Describe() does not have a most specific");
        Console.WriteLine("   implementation. Neither IUpper.IBase.Describe(), nor");
        Console.WriteLine("   ILower.IBase.Describe() are most specific.'");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Through the INTERFACE:
  Payment : audit:PMT-1
  Refund  : REFUND-AUDIT:RFD-1
  Payment : audit:PMT-1 reason=chargeback

Through the CLASS:
  refund.AuditLine()  : REFUND-AUDIT:RFD-1
  payment.AuditLine() : does not compile — CS1061.
  A default implementation is a member of the INTERFACE, not of the
  class. The class does not inherit it onto its own surface.

Reflection confirms it:
  typeof(Payment).GetMethod("AuditLine") is null : True
  typeof(IAuditable).GetMethod("AuditLine") is null : False
  IAuditable.AuditLine IsAbstract=False (false = it has a body)

Two interfaces sharing a member NAME — not a diamond:
  ((ILeft)quiet).Name()   : left
  ((IRight)quiet).Name()  : right
  Quiet declares no Name at all and compiles. The two defaults are
  different members; each interface keeps its own. Only
  'quiet.Name()' fails, with CS1061 — defaults are not on the class.
  both.Name()            : the class's own Name
  ((ILeft)both).Name()   : the class's own Name
  ((IRight)both).Name()  : the class's own Name

The real diamond — one base member, two implementations:
  ((IBase)resolved).Describe() : resolved explicitly by the class
  Without the class's own Describe(), this is CS8705:
  'Interface member IBase.Describe() does not have a most specific
   implementation. Neither IUpper.IBase.Describe(), nor
   ILower.IBase.Describe() are most specific.'</code></pre>

  <h3>Surprise one: the default is not on the class</h3>

  <p><code>payment.AuditLine()</code> does not compile, and
  <code>typeof(Payment).GetMethod("AuditLine")</code> returns <code>null</code>. The default
  belongs to the interface. A class implementing the interface can be <em>used as</em> something
  with that member, but does not <em>have</em> it — you must hold an <code>IAuditable</code>
  reference to call it.</p>

  <p>This is unlike every other inheritance in C#, and it is deliberate: a class inheriting
  members from several interfaces would reintroduce multiple inheritance of implementation with
  all its ambiguity. The practical consequence is that a default interface method is an
  extensibility mechanism for the interface's <em>callers</em>, not a way to share code with
  implementing classes. If you want the class to have it, the class must declare it.</p>

  <h3>Surprise two: a shared name is not a diamond</h3>

  <p class="define"><span class="define__term">Diamond problem</span> A type inheriting the same
  member along two paths, with no rule for which wins. The classic argument against multiple
  inheritance of implementation.</p>

  <p>The intuition is that two interfaces both declaring <code>Name()</code> must be a conflict.
  <strong>They are not.</strong> <code>ILeft.Name</code> and <code>IRight.Name</code> are
  different members that happen to share a spelling; <code>Quiet</code> implements both, declares
  nothing, and compiles — each interface keeps its own default.</p>

  <p>A real diamond needs <em>one</em> member with two competing implementations: a base interface
  whose member two derived interfaces each implement. Then the compiler cannot pick and says so:</p>

  <pre data-lang="console" data-title="CS8705, verified"><code>error CS8705: Interface member 'IBase.Describe()' does not have a most specific
              implementation. Neither 'IUpper.IBase.Describe()', nor
              'ILower.IBase.Describe()' are most specific.</code></pre>

  <p class="define"><span class="define__term">Most specific implementation</span> The rule C#
  uses to resolve a member reachable along several interface paths: an implementation in a more
  derived interface wins over one in a less derived interface. When neither candidate is more
  derived than the other, there is no most specific implementation and the class must supply
  one.</p>

  <div class="callout callout--note">
    <h4>This distinction is worth having got wrong once</h4>
    <p>The first draft of this
    section asserted that two interfaces sharing a method name produced <code>CS8705</code>. It
    does not — the probe compiled cleanly, which is how the error was caught. The intuition
    "same name, therefore conflict" is exactly the wrong model; C# resolves members by their
    declaring interface, so a name collision across unrelated interfaces is not a collision at
    all. It is the same fact that makes explicit implementation work.</p>
  </div>
</section>

<section id="static-abstract">
  <h2>Static abstract members</h2>

  <p class="define"><span class="define__term">Static abstract member</span> A member an interface
  requires of the <em>type itself</em> rather than of its instances. Available since C# 11. It
  lets generic code call a static method, a constructor-like factory, or an operator on a type
  parameter, with no instance and no reflection.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-static-abstract.cs"><code>// 05-static-abstract.cs — interfaces can require STATIC members, which lets a
// generic method call a constructor-like or operator member on a type
// parameter. C# 11 and later; the basis of the generic-math interfaces.
// .NET 10.0.400. Run: dotnet run 05-static-abstract.cs

using System;
using System.Globalization;
using System.Numerics;

// A contract on the TYPE, not on an instance.
interface IParsable2&lt;TSelf&gt; where TSelf : IParsable2&lt;TSelf&gt;
{
    static abstract TSelf Parse(string text);
    static abstract string Label { get; }
}

readonly record struct Celsius(double Degrees) : IParsable2&lt;Celsius&gt;
{
    public static Celsius Parse(string text) =&gt;
        new(double.Parse(text, CultureInfo.InvariantCulture));
    public static string Label =&gt; "°C";
    public override string ToString() =&gt; $"{Degrees}{Label}";
}

readonly record struct Money(decimal Amount) : IParsable2&lt;Money&gt;
{
    public static Money Parse(string text) =&gt;
        new(decimal.Parse(text, CultureInfo.InvariantCulture));
    public static string Label =&gt; "GBP";
    public override string ToString() =&gt; $"{Amount:0.00} {Label}";
}

class Program
{
    // One method that can parse ANY type satisfying the contract, with no
    // instance to call through and no reflection.
    static T[] ParseAll&lt;T&gt;(params string[] inputs) where T : IParsable2&lt;T&gt;
    {
        var result = new T[inputs.Length];
        for (int i = 0; i &lt; inputs.Length; i++) result[i] = T.Parse(inputs[i]);
        return result;
    }

    static string Describe&lt;T&gt;() where T : IParsable2&lt;T&gt; =&gt; $"{typeof(T).Name} measured in {T.Label}";

    // Generic math: the same idea in the base class library.
    static T Sum&lt;T&gt;(params T[] values) where T : INumber&lt;T&gt;
    {
        T total = T.Zero;
        foreach (var v in values) total += v;
        return total;
    }

    static T Mean&lt;T&gt;(params T[] values) where T : INumber&lt;T&gt;
        =&gt; Sum(values) / T.CreateChecked(values.Length);

    static void Main()
    {
        Console.WriteLine("A generic method calling a static member on its type parameter:");
        foreach (var c in ParseAll&lt;Celsius&gt;("21.5", "-3", "100")) Console.WriteLine($"  {c}");
        foreach (var m in ParseAll&lt;Money&gt;("19.99", "4.50")) Console.WriteLine($"  {m}");

        Console.WriteLine();
        Console.WriteLine($"  {Describe&lt;Celsius&gt;()}");
        Console.WriteLine($"  {Describe&lt;Money&gt;()}");

        Console.WriteLine();
        Console.WriteLine("The same mechanism, in the standard library (INumber&lt;T&gt;):");
        Console.WriteLine($"  Sum(1, 2, 3, 4)            = {Sum(1, 2, 3, 4)}");
        Console.WriteLine($"  Sum(1.5, 2.25)             = {Sum(1.5, 2.25)}");
        Console.WriteLine($"  Sum(10.00m, 5.50m)         = {Sum(10.00m, 5.50m)}");
        Console.WriteLine($"  Mean(2, 4, 6, 9)           = {Mean(2, 4, 6, 9)}   (int division)");
        Console.WriteLine($"  Mean(2.0, 4.0, 6.0, 9.0)   = {Mean(2.0, 4.0, 6.0, 9.0)}");

        Console.WriteLine();
        Console.WriteLine("Before C# 11 this needed one overload per numeric type, or boxing");
        Console.WriteLine("through a non-generic interface. The operator now comes from the");
        Console.WriteLine("constraint, and the JIT specialises the method per value type.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>A generic method calling a static member on its type parameter:
  21.5°C
  -3°C
  100°C
  19.99 GBP
  4.50 GBP

  Celsius measured in °C
  Money measured in GBP

The same mechanism, in the standard library (INumber&lt;T&gt;):
  Sum(1, 2, 3, 4)            = 10
  Sum(1.5, 2.25)             = 3.75
  Sum(10.00m, 5.50m)         = 15.50
  Mean(2, 4, 6, 9)           = 5   (int division)
  Mean(2.0, 4.0, 6.0, 9.0)   = 5.25

Before C# 11 this needed one overload per numeric type, or boxing
through a non-generic interface. The operator now comes from the
constraint, and the JIT specialises the method per value type.</code></pre>

  <p class="define"><span class="define__term">Generic math</span> The set of interfaces in
  <code>System.Numerics</code> — <code>INumber&lt;T&gt;</code> and relatives — built on static
  abstract members, letting one generic method work over every numeric type with real operators
  rather than one overload each.</p>

  <p>Note <code>Mean(2, 4, 6, 9)</code> returning <code>5</code> rather than <code>5.25</code>.
  <code>T</code> is <code>int</code>, so <code>/</code> is integer division. The generic code is
  correct and the arithmetic follows the type's own rules — the truncation from
  <a href="#/m/t1-02-variables-and-types">Variables, Types, and Type Inference</a>, arriving
  through a constraint. Generic math does not paper over type behaviour; it gives you exactly
  what the concrete type would have done.</p>

  <p>Full treatment of constraints is in
  <a href="#/m/t1-18-generic-constraints">Generic Constraints</a>. What matters here is that it
  removes the last thing interfaces could not express — a requirement on the type rather than the
  instance — which is why the "interface or abstract class" question now has fewer cases where
  only an abstract class will do.</p>
</section>

<section id="production-example">
  <h2>Both, in one component, for different reasons</h2>

  <p>A notification component. Interfaces are used for the boundaries; an abstract class is used
  for the shared mechanism. Each choice has a reason.</p>

  <pre data-lang="csharp" data-net="10" data-title="06-production.cs"><code>// 06-production.cs — interfaces and an abstract class doing different jobs in
// one component, chosen for different reasons.
// .NET 10.0.400. Run: dotnet run 06-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

// ---- INTERFACES: what the outside world depends on ------------------------
// Narrow, role-shaped, and easy to substitute in a test.
public interface IClock { DateTimeOffset UtcNow { get; } }

public interface IDeliveryLog { void Record(string line); }

public interface IChannel
{
    string Name { get; }
    bool CanHandle(Recipient recipient);
    DeliveryOutcome Deliver(Recipient recipient, string body);
}

public readonly record struct Recipient(string Id, string? Email, string? Phone, bool PushEnabled);
public readonly record struct DeliveryOutcome(bool Delivered, string Detail);

// ---- ABSTRACT CLASS: shared mechanism the channels inherit ----------------
// Chosen because every channel needs the same retry, timing and logging, and
// none of them should be able to skip it.
public abstract class ChannelBase : IChannel
{
    private readonly IClock _clock;
    private readonly IDeliveryLog _log;
    private readonly int _maxAttempts;

    protected ChannelBase(IClock clock, IDeliveryLog log, int maxAttempts = 3)
    {
        _clock = clock;
        _log = log;
        _maxAttempts = maxAttempts &lt; 1
            ? throw new ArgumentOutOfRangeException(nameof(maxAttempts))
            : maxAttempts;
    }

    public abstract string Name { get; }
    public abstract bool CanHandle(Recipient recipient);

    // The varying step. No default, so nothing to depend on.
    protected abstract DeliveryOutcome Attempt(Recipient recipient, string body);

    // Non-virtual: retry policy and logging are identical for every channel.
    public DeliveryOutcome Deliver(Recipient recipient, string body)
    {
        for (int attempt = 1; attempt &lt;= _maxAttempts; attempt++)
        {
            DeliveryOutcome outcome;
            try
            {
                outcome = Attempt(recipient, body);
            }
            catch (Exception ex)
            {
                outcome = new DeliveryOutcome(false, $"threw {ex.GetType().Name}");
            }

            _log.Record($"{_clock.UtcNow:HH:mm:ss} {Name} attempt {attempt}/{_maxAttempts} " +
                        $"-&gt; {(outcome.Delivered ? "ok" : "failed")}: {outcome.Detail}");

            if (outcome.Delivered) return outcome;
        }
        return new DeliveryOutcome(false, $"gave up after {_maxAttempts} attempts");
    }
}

public sealed class EmailChannel : ChannelBase
{
    private int _calls;
    public EmailChannel(IClock clock, IDeliveryLog log) : base(clock, log) { }
    public override string Name =&gt; "email";
    public override bool CanHandle(Recipient r) =&gt; !string.IsNullOrWhiteSpace(r.Email);
    protected override DeliveryOutcome Attempt(Recipient r, string body)
    {
        _calls++;
        return _calls &lt; 2
            ? new DeliveryOutcome(false, "smtp timeout")
            : new DeliveryOutcome(true, $"sent to {r.Email}");
    }
}

public sealed class SmsChannel : ChannelBase
{
    public SmsChannel(IClock clock, IDeliveryLog log) : base(clock, log) { }
    public override string Name =&gt; "sms";
    public override bool CanHandle(Recipient r) =&gt; !string.IsNullOrWhiteSpace(r.Phone);
    protected override DeliveryOutcome Attempt(Recipient r, string body)
        =&gt; throw new InvalidOperationException("gateway unreachable");
}

public sealed class PushChannel : ChannelBase
{
    public PushChannel(IClock clock, IDeliveryLog log) : base(clock, log) { }
    public override string Name =&gt; "push";
    public override bool CanHandle(Recipient r) =&gt; r.PushEnabled;
    protected override DeliveryOutcome Attempt(Recipient r, string body)
        =&gt; new DeliveryOutcome(true, $"pushed to device of {r.Id}");
}

public sealed class Notifier
{
    private readonly IReadOnlyList&lt;IChannel&gt; _channels;
    private readonly IDeliveryLog _log;

    public Notifier(IEnumerable&lt;IChannel&gt; channels, IDeliveryLog log)
        =&gt; (_channels, _log) = (channels.ToArray(), log);

    public DeliveryOutcome Notify(Recipient recipient, string body)
    {
        foreach (var channel in _channels.Where(c =&gt; c.CanHandle(recipient)))
        {
            var outcome = channel.Deliver(recipient, body);
            if (outcome.Delivered) return outcome;
            _log.Record($"  falling back from {channel.Name}");
        }
        return new DeliveryOutcome(false, "no channel could deliver");
    }
}

// ---- test doubles, which is why those interfaces exist --------------------
sealed class FixedClock : IClock
{
    public DateTimeOffset UtcNow { get; private set; } =
        new(2026, 8, 30, 9, 0, 0, TimeSpan.Zero);
    public void Advance(int seconds) =&gt; UtcNow = UtcNow.AddSeconds(seconds);
}

sealed class ListLog : IDeliveryLog
{
    public List&lt;string&gt; Lines { get; } = new();
    public void Record(string line) =&gt; Lines.Add(line);
}

class Program
{
    static void Main()
    {
        var clock = new FixedClock();
        var log = new ListLog();

        var notifier = new Notifier(
            new IChannel[]
            {
                new SmsChannel(clock, log),
                new EmailChannel(clock, log),
                new PushChannel(clock, log)
            },
            log);

        var recipient = new Recipient("U-1", "a@example.com", "+441234567890", PushEnabled: true);

        var result = notifier.Notify(recipient, "Your order has shipped");
        Console.WriteLine($"result: delivered={result.Delivered}, detail={result.Detail}");
        Console.WriteLine();
        Console.WriteLine("delivery log:");
        foreach (var line in log.Lines) Console.WriteLine($"  {line}");

        Console.WriteLine();
        var noContact = new Recipient("U-2", null, null, PushEnabled: false);
        var none = notifier.Notify(noContact, "Your order has shipped");
        Console.WriteLine($"recipient with no contact details: {none.Detail}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>result: delivered=True, detail=sent to a@example.com

delivery log:
  09:00:00 sms attempt 1/3 -&gt; failed: threw InvalidOperationException
  09:00:00 sms attempt 2/3 -&gt; failed: threw InvalidOperationException
  09:00:00 sms attempt 3/3 -&gt; failed: threw InvalidOperationException
    falling back from sms
  09:00:00 email attempt 1/3 -&gt; failed: smtp timeout
  09:00:00 email attempt 2/3 -&gt; ok: sent to a@example.com

recipient with no contact details: no channel could deliver</code></pre>

  <p><strong><code>IClock</code> and <code>IDeliveryLog</code> are interfaces because they are
  boundaries.</strong> They exist so the component does not reach for <code>DateTime.UtcNow</code>
  or a file. In the test above, <code>FixedClock</code> makes the timestamps deterministic and
  <code>ListLog</code> makes the retry behaviour assertable. Neither has any mechanism to share,
  so an abstract class would be all cost.</p>

  <p class="define"><span class="define__term">Test double</span> A stand-in supplied in place of
  a real dependency so a test can control it — a fixed clock, an in-memory log. The main practical
  reason to depend on an interface rather than a concrete type.</p>

  <p><strong><code>IChannel</code> is an interface because it is a role.</strong>
  <code>Notifier</code> needs to hold a list of things it can ask to deliver. It does not care
  whether they share an ancestor, and a channel implemented by an existing class with its own base
  class must still be usable.</p>

  <p><strong><code>ChannelBase</code> is an abstract class because it shares mechanism.</strong>
  Retry counting, exception handling, timing and log formatting are identical for every channel
  and involve state — the clock, the log, the attempt limit — which an interface cannot hold. It
  is also the template method shape from <a href="#/m/t1-10-inheritance">Inheritance</a>:
  <code>Deliver</code> is non-virtual so a channel cannot skip the retry or the logging, and
  <code>Attempt</code> is <code>abstract</code> so there is no base behaviour to depend on.</p>

  <p><strong>The two are stacked deliberately.</strong> <code>ChannelBase</code> implements
  <code>IChannel</code>, so a channel that cannot use the base class can implement the interface
  directly and still work with <code>Notifier</code>. The mechanism is available and not
  mandatory. That combination — interface for the contract, optional abstract base for the shared
  work — is the standard shape in the .NET libraries themselves.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Adding a member to a published interface</h3>

  <p>The failure at the top of this module. Nine services fail to build with
  <code>CS0535</code>; two that were not rebuilt die on startup with
  <code>TypeLoadException</code>. The second is the dangerous one: the exception names a method
  that does not appear anywhere in that service's source, and it fires on type load rather than
  on use, so it can take out a service that would never have called the new member.</p>

  <p>The fix, when you control the interface, is a default implementation. When you do not, it is
  a new interface — <code>INotifier2</code>, or a separate <code>IUrgentNotifier</code> that
  implementors opt into — which is why the base class library is full of numbered and
  narrowly-scoped interfaces rather than large ones that grew.</p>

  <h3>2. Expecting a default implementation on the class</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: calling a default through the class"><code>interface IAuditable
{
    string Id { get; }
    string AuditLine() =&gt; $"audit:{Id}";
}

sealed class Payment : IAuditable
{
    public string Id =&gt; "PMT-1";
}

// WRONG. CS1061: 'Payment' does not contain a definition for 'AuditLine'.
var line = new Payment().AuditLine();

// Right: hold the interface.
var ok = ((IAuditable)new Payment()).AuditLine();</code></pre>

  <p>The error message is the one you get for a method that does not exist, because from the
  class's point of view it does not. This is the single most common surprise with the feature, and
  it is easy to introduce by accident when refactoring a member from a base class into an
  interface default.</p>

  <h3>3. Interfaces that are one class's public surface copied out</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: an interface with one implementation and no boundary"><code>// WRONG, in most cases. Every member of OrderService, restated, so that the
// only implementation is OrderService and the only other implementation ever
// written will be a mock in a test.
public interface IOrderService
{
    Order Get(string id);
    void Place(Order order);
    void Cancel(string id);
    void Refund(string id, decimal amount);
    IReadOnlyList&lt;Order&gt; Search(string customerId, DateOnly from, DateOnly to);
}</code></pre>

  <p>This costs the versioning problem above — every addition is now a breaking change — and buys
  the ability to write a mock. It is worth it when the interface is a genuine boundary: a
  dependency you want to substitute, a seam between assemblies, or a contract several types really
  implement. It is not worth it as a reflex applied to every service class.</p>

  <p class="define"><span class="define__term">Interface segregation</span> The principle that
  callers should not be forced to depend on members they do not use. Practically: prefer several
  narrow role-shaped interfaces to one broad one. Narrow interfaces are also far easier to version,
  because there is less to add to them.</p>

  <h3>4. Putting state in the abstraction</h3>

  <p>An interface cannot declare fields, and a default interface method cannot touch instance
  state, because there is none to touch. Attempting to share state through an interface leads to
  properties that every implementor must implement identically — which is the signal that an
  abstract class was the right tool, or that the state belongs in a separate object the
  implementors hold.</p>

  <h3>5. Explicit implementation used to hide a member from yourself</h3>

  <p>Explicit implementation removes a member from the class's public surface, which also removes
  it from IntelliSense, from convention-based serialisers and mappers, and from anything reflecting
  over public members. Used deliberately, as with <code>ILifecycle</code> above, that is the
  feature. Used to avoid a naming argument, it produces a class whose members cannot be found by
  the tools people use to find members.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4><code>TypeLoadException</code> naming a method that is not in your source</h4>
    <p>An interface your type implements gained a member, and the assembly you are running against is
    newer than the one you compiled against. Read the message carefully: it names both the missing
    method and the assembly containing the type that is missing it, which tells you which side is
    stale. Confirm by printing assembly versions and locations at startup, as in
    <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a>. Note that it fires on
    type load, so the stack trace points at whatever first touched the type, which is usually
    unrelated to the new member.</p>
  </div>

  <div class="callout callout--debug">
    <h4><code>CS1061</code> for a method you can see in the interface</h4>
    <p>It is a
    default interface method, and defaults live on the interface, not on the class. Cast to the
    interface, or declare the member on the class. Confirm in one line:
    <code>typeof(TheClass).GetMethod("TheMember")</code> returns <code>null</code> while
    <code>typeof(TheInterface).GetMethod("TheMember")</code> does not.</p>
  </div>

  <div class="callout callout--debug">
    <h4>A member you implemented is not being found by a framework</h4>
    <p>Check whether
    it is implemented explicitly. Explicit implementations are private and final in metadata with
    names like <code>ILifecycle.Start</code>, so anything enumerating public members — a
    serialiser, an object mapper, model binding — will not see it. Enumerate with
    <code>BindingFlags.NonPublic | BindingFlags.Instance</code> to confirm it is there, then make
    it implicit if the framework needs it.</p>
  </div>

  <div class="callout callout--debug">
    <h4><code>CS8705</code>, no most specific implementation</h4>
    <p>You have a genuine
    diamond: one interface member with two competing implementations in interfaces that are not
    related to each other. Do not go looking for two interfaces with the same method name — that
    is not a diamond and compiles fine. Look for a <em>base</em> interface whose member is
    implemented by two different derived interfaces. Resolve it by implementing the member on the
    class, which is unambiguously most specific.</p>
  </div>

  <div class="callout callout--debug">
    <h4>Deciding whether an interface is worth its cost</h4>
    <p>Count the implementations
    that are not test doubles. Zero means it is a mock-enabling wrapper and the versioning cost is
    buying little; one means it is a boundary, which may be enough; several means it is a genuine
    role. Then ask whether it is likely to gain members — if yes, a narrower interface, or an
    abstract class if the implementors are all yours.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A concrete case</h4>
    <p>A platform team owned <code>IPaymentProvider</code>, a
    six-member interface implemented by 14 provider adapters across nine repositories, plus about
    40 test doubles. A regulatory change required every provider to expose a settlement reference.
    They added <code>string GetSettlementReference(string transactionId);</code> and published
    2.0.0.</p>
    <p>The consequences were the same shape everywhere and different in scale. Nine repositories
    needed changes to adapters — expected, and the point of the change. What was not budgeted for
    was the 40 test doubles: every hand-written fake failed to compile with <code>CS0535</code>,
    each needing a stub method that returned something plausible. Two services were mid-freeze and
    were deployed with only the library updated; both failed on startup with
    <code>TypeLoadException</code> naming a method their code had never referenced, because the
    adapter type was constructed during dependency-injection registration, before any request.</p>
    <p>Total: roughly 60 files changed across nine repositories, four coordinated releases, and two
    production incidents, for one member that only three of the 14 providers could meaningfully
    implement.</p>
    <p>What would have avoided it: a default implementation throwing
    <code>NotSupportedException</code>, which keeps every existing implementor compiling and
    loading and fails only where the member is actually used and unsupported — turning 60 file
    changes into three. Or a separate <code>ISettlementReporting</code> interface that the three
    capable providers implement, tested with a type check at the call site. The second is better
    design: it makes "this provider cannot report settlements" a fact the type system carries
    rather than a runtime exception.</p>
  </div>

  <p>The general principle: <strong>an interface is a promise to everyone who implements it, and
  the number of those people is usually much larger than you think.</strong> Implementations you
  do not own, in repositories you cannot see, plus every test double — and test doubles outnumber
  real implementations in most codebases.</p>

  <p>That is what makes the interface-or-abstract-class question a versioning question first. An
  abstract class you own can grow a member with a body and break nobody. A published interface
  cannot, unless you use a default implementation — and even then, the default has to be sensible
  for implementors you have never met.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"Interfaces are for contracts, abstract classes for shared code — that is the whole
    difference"</h4>
    <p>True as far as it goes, and it omits the part that actually decides
    designs. Since C# 8 an interface can carry implementation, and since C# 11 it can require
    static members, so the capability gap has narrowed considerably. What has not changed is
    versioning: adding to an abstract class is safe, adding to a published interface breaks every
    implementor unless you supply a default.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Default interface methods make interfaces work like abstract classes"</h4>
    <p>They do not, in the one respect people expect. A default is a member of the interface, not of
    the class: <code>payment.AuditLine()</code> does not compile and
    <code>typeof(Payment).GetMethod("AuditLine")</code> is <code>null</code>. Defaults are a
    versioning tool for the interface's callers, not a code-sharing tool for its implementors.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Two interfaces with the same method name cause the diamond problem"</h4>
    <p>Verified false: they are different members that share a spelling, and a class may implement
    both while declaring nothing. A real diamond needs one base member with two competing
    implementations in unrelated derived interfaces, which is <code>CS8705</code>. The wrong
    intuition matters because it sends you looking for the conflict in the wrong place.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Every service class should have an interface"</h4>
    <p>The cost is real — every
    future addition becomes a breaking change — and the benefit is often only mockability. An
    interface earns its place at a genuine boundary, where there are several implementations, or
    where you want a seam between assemblies. Where the only other implementation will ever be a
    test double, consider whether a virtual member, a delegate parameter, or testing the real thing
    would serve better.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"An abstract class with no abstract members is pointless"</h4>
    <p>It is a fine way
    to say "this type is not useful on its own" — a base carrying only shared mechanism, where
    every subclass differs by configuration rather than behaviour. Marking it <code>abstract</code>
    is a compile-time statement that instantiating it is a mistake, which is cheaper than a comment
    saying so.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Explicit implementation is only a naming trick"</h4>
    <p>It changes the type's
    public surface, which changes what serialisers, mappers, model binders and IntelliSense can
    see. That is a design decision with consequences well beyond the name, and it is the right one
    when a member exists for one caller — a host, a framework — rather than for everyone holding
    the object.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Reach for</th><th>Because</th></tr></thead>
    <tbody>
      <tr>
        <td>A boundary you want to substitute in a test</td>
        <td>A narrow interface</td>
        <td>No state to share, and narrow interfaces are the ones you can version.</td>
      </tr>
      <tr>
        <td>Several unrelated types must be usable interchangeably</td>
        <td>Interface</td>
        <td>They may already have base classes; a type has only one of those.</td>
      </tr>
      <tr>
        <td>Implementations share state and mechanism</td>
        <td>Abstract class</td>
        <td>Interfaces cannot hold fields, and a default method cannot reach instance state.</td>
      </tr>
      <tr>
        <td>Both: a contract plus optional shared machinery</td>
        <td>Interface, plus an abstract base implementing it</td>
        <td>The mechanism is available and not mandatory. The shape used in this module's
        production example and throughout the .NET libraries.</td>
      </tr>
      <tr>
        <td>A member every subclass must supply, with no sensible default</td>
        <td><code>abstract</code>, not <code>virtual</code></td>
        <td>Turns a silent runtime mistake into <code>CS0534</code>, and leaves no base behaviour
        to depend on.</td>
      </tr>
      <tr>
        <td>Adding to an interface other people implement</td>
        <td>A default implementation, or a new interface</td>
        <td>Otherwise <code>CS0535</code> for everyone who rebuilds and
        <code>TypeLoadException</code> for everyone who does not.</td>
      </tr>
      <tr>
        <td>Only some implementors can support a new capability</td>
        <td>A separate interface they opt into</td>
        <td>Makes the limitation a fact of the type system rather than a runtime exception.</td>
      </tr>
      <tr>
        <td>Two interfaces demand the same signature, different meanings</td>
        <td>Explicit implementation</td>
        <td>The only legal option; one method cannot satisfy both.</td>
      </tr>
      <tr>
        <td>A member exists for a host or framework, not for callers</td>
        <td>Explicit implementation</td>
        <td>Keeps the class's public surface honest, with the compiler enforcing it.</td>
      </tr>
      <tr>
        <td>Generic code needs a factory, parse, or operator on <code>T</code></td>
        <td><code>static abstract</code> members</td>
        <td>Removes the last thing only an abstract class could express.</td>
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
    <p>Give the output of each line, and say which one does not compile and why.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>interface IGreeter
{
    string Name { get; }
    string Greet() =&gt; $"Hello, {Name}";
}

sealed class Quiet : IGreeter { public string Name =&gt; "Quiet"; }

sealed class Loud : IGreeter
{
    public string Name =&gt; "Loud";
    public string Greet() =&gt; $"HELLO, {Name.ToUpperInvariant()}!";
}

IGreeter[] gs = { new Quiet(), new Loud() };
foreach (var g in gs) Console.WriteLine(g.Greet());
Console.WriteLine(new Loud().Greet());
Console.WriteLine(new Quiet().Greet());</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>Hello, Quiet
HELLO, LOUD!
HELLO, LOUD!</code></pre>
        <p>The last line, <code>new Quiet().Greet()</code>, <strong>does not compile</strong>:</p>
        <pre data-lang="console" data-title="The error"><code>error CS1061: 'Quiet' does not contain a definition for 'Greet' and no accessible
              extension method 'Greet' accepting a first argument of type 'Quiet'
              could be found</code></pre>
        <p><code>Quiet</code> does not declare <code>Greet</code>; it relies on the interface's
        default. A default interface method is a member of the <em>interface</em>, so it is
        reachable only through an <code>IGreeter</code> reference. <code>Loud</code> declares its
        own <code>Greet</code>, which is an ordinary public member of the class, so it is callable
        both ways.</p>
        <p>Reflection makes the asymmetry plain:</p>
        <pre data-lang="console" data-title="Reflection"><code>typeof(Quiet).GetMethod("Greet") is null : True
typeof(Loud).GetMethod("Greet")  is null : False</code></pre>
        <p>Note the practical trap: <code>Quiet</code> and <code>Loud</code> both satisfy
        <code>IGreeter</code> and both work correctly through it, but they have different public
        surfaces. Code written against <code>Loud</code> the class will not port to
        <code>Quiet</code> the class, even though both are <code>IGreeter</code>s.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Predict the three outputs. Then say why this class could not have been written with implicit
    implementations, and what would happen if the <code>public double Value</code> member were
    removed.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>interface IMetres { double Value { get; } }
interface IFeet   { double Value { get; } }

sealed class Distance : IMetres, IFeet
{
    private readonly double _metres;
    public Distance(double metres) =&gt; _metres = metres;

    double IMetres.Value =&gt; _metres;
    double IFeet.Value   =&gt; _metres * 3.28084;

    public double Value =&gt; _metres;
}

var d = new Distance(100);
Console.WriteLine(d.Value);
Console.WriteLine(((IMetres)d).Value);
Console.WriteLine(((IFeet)d).Value);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>100
100
328.08</code></pre>
        <p><strong>Why implicit implementation is impossible here.</strong> Both interfaces require
        a member with the identical signature, <code>double Value { get; }</code>, and they need
        different values — metres and feet. An implicit implementation is a single public member
        that satisfies every interface requiring that signature, so one implicit
        <code>Value</code> would have to return both numbers at once. Explicit implementation gives
        each interface its own member, and the object answers according to the role it is addressed
        in.</p>
        <p><strong>If <code>public double Value</code> were removed:</strong> the class would still
        compile, and both interface members would still work. What would break is
        <code>d.Value</code> — with only explicit implementations, the class has no public
        <code>Value</code> at all, and that line becomes <code>CS1061</code>. The same shape as
        exercise 1: satisfying an interface and having a member on your own surface are separate
        things.</p>
        <p>Keeping a public <code>Value</code> alongside the explicit ones is a deliberate choice
        here: it gives callers who hold a <code>Distance</code> an obvious default without forcing
        a cast, while callers who care about units say so. The risk is that the public member and
        one of the explicit members agree today — both return metres — and could silently diverge
        later if someone edits one and not the other. If that worries you, the honest alternative
        is to have no public <code>Value</code> and make every caller pick a unit.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>You own <code>IPaymentProvider</code>, implemented by 14 adapters across nine repositories
    plus about 40 test doubles. You must add
    <code>string GetSettlementReference(string transactionId)</code>, which only three of the 14
    providers can meaningfully implement. Describe what happens if you add it plainly, give two
    workable alternatives, and say which you would choose and why.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Adding it plainly.</strong> Two failures, both of which happen:</p>
        <ul>
          <li>Anything that <strong>rebuilds</strong> fails to compile:
          <code>CS0535: 'X' does not implement interface member
          'IPaymentProvider.GetSettlementReference(string)'</code>. That is all 14 adapters and all
          40 test doubles — and the test doubles are the surprise, because they are usually not on
          anyone's list of implementations.</li>
          <li>Anything <strong>deployed without rebuilding</strong> dies with
          <code>TypeLoadException: Method 'GetSettlementReference' in type 'X' ... does not have an
          implementation</code>. Critically this fires when the <em>type is loaded</em>, not when
          the member is called — so a service that never handles settlements still crashes, usually
          during dependency-injection registration at startup.</li>
        </ul>
        <p><strong>Alternative one: a default implementation.</strong></p>
<pre data-lang="csharp" data-net="10" data-title="Alternative one"><code>public interface IPaymentProvider
{
    string Authorise(string cardToken, decimal amount);
    string Capture(string transactionId);
    string Refund(string transactionId, decimal amount);

    // Added in 2.0.0, with a default so no existing implementor breaks.
    string GetSettlementReference(string transactionId)
        =&gt; throw new NotSupportedException(
               $"{GetType().Name} does not report settlement references.");
}</code></pre>
        <p>Every existing implementor keeps compiling and loading; the three capable providers
        override it. Nothing breaks at startup, and failure is confined to actually calling it on a
        provider that cannot do it. Cost: the limitation is invisible to the compiler, so a caller
        finds out at run time.</p>
        <p><strong>Alternative two: a separate interface.</strong></p>
<pre data-lang="csharp" data-net="10" data-title="Alternative two"><code>public interface ISettlementReporting
{
    string GetSettlementReference(string transactionId);
}

// Only the providers that can, implement it. At the call site:
if (provider is ISettlementReporting reporting)
    reference = reporting.GetSettlementReference(id);
else
    reference = null;   // or take a documented alternative path</code></pre>
        <p>Nothing existing changes at all — not one adapter, not one test double. The three
        capable providers add an interface.</p>
        <p><strong>Which to choose: the second.</strong> The deciding argument is not effort — both
        are small — but where the limitation lives. "This provider cannot report settlements" is a
        real fact about the domain, and the second alternative makes the type system carry it, so a
        caller cannot forget to handle the case: the type test is the only way to reach the member.
        The first alternative turns the same fact into a runtime exception that will be discovered
        by a customer.</p>
        <p>It also versions better. <code>ISettlementReporting</code> is narrow, so future
        settlement-related members go there and affect only the three providers, rather than
        widening a contract 14 adapters and 40 doubles must satisfy. That is
        <strong>interface segregation</strong> arrived at from the versioning side rather than as a
        principle recited in advance.</p>
        <p>The default implementation is the right choice when the member genuinely applies to
        everyone and there is a sensible fallback behaviour — not merely a place to put a throw.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Version 2 of this repository interface adds a bulk lookup with a default implementation.
    Predict the output. Then say what the default costs, why one implementor overrides it, and
    identify the behavioural trap a default implementation like this one creates for implementors
    who do not.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>public interface IRepository&lt;T&gt;
{
    T? Find(string id);
    void Save(T item);

    // Added in v2, with a default so existing implementors keep compiling.
    IReadOnlyList&lt;T&gt; FindMany(IEnumerable&lt;string&gt; ids)
        =&gt; ids.Select(Find).OfType&lt;T&gt;().ToArray();
}

public sealed record Customer(string Id, string Name);

public sealed class InMemoryCustomers : IRepository&lt;Customer&gt;
{
    private readonly Dictionary&lt;string, Customer&gt; _byId = new();
    public Customer? Find(string id) =&gt; _byId.GetValueOrDefault(id);
    public void Save(Customer item) =&gt; _byId[item.Id] = item;
}

public sealed class CountingCustomers : IRepository&lt;Customer&gt;
{
    private readonly Dictionary&lt;string, Customer&gt; _byId = new();
    public int FindManyCalls { get; private set; }

    public Customer? Find(string id) =&gt; _byId.GetValueOrDefault(id);
    public void Save(Customer item) =&gt; _byId[item.Id] = item;

    public IReadOnlyList&lt;Customer&gt; FindMany(IEnumerable&lt;string&gt; ids)
    {
        FindManyCalls++;
        return ids.Where(_byId.ContainsKey).Select(id =&gt; _byId[id]).ToArray();
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>InMemoryCustomers (uses the default): 2 found -&gt; Ada, Grace
CountingCustomers (own version)     : 2 found, FindManyCalls=1
through the class directly          : 1 found, FindManyCalls=2</code></pre>
        <p>Both find two of the three requested ids, because <code>C-3</code> was never saved. The
        default's <code>.OfType&lt;T&gt;()</code> is what drops the <code>null</code> that
        <code>Find("C-3")</code> returns.</p>
        <p><strong>What the default costs.</strong> It is <em>N</em> separate calls to
        <code>Find</code>. For an in-memory dictionary that is free. For a repository backed by a
        database it is N round trips where one query would do — the N+1 problem, arriving through
        an interface default rather than through an ORM. A default implementation is written by
        someone who cannot know what any implementor's <code>Find</code> costs, which is exactly
        why <code>CountingCustomers</code> overrides it with a single pass.</p>
        <p><strong>The behavioural trap.</strong> This is the fragile base class problem from
        <a href="#/m/t1-10-inheritance">Inheritance</a> in a new place. The default is written in
        terms of another interface member, <code>Find</code>, and that dependency is invisible to
        implementors. Three consequences follow, none of them stated anywhere in the interface:</p>
        <ul>
          <li>An implementor whose <code>Find</code> has a side effect — a cache write, an access
          log, a metric — gets it N times per <code>FindMany</code>, and will never see that from
          reading their own class.</li>
          <li>If a later version changes the default to stop calling <code>Find</code>, every
          implementor relying on that routing silently changes behaviour — with no rebuild able to
          detect it, exactly as in the previous module.</li>
          <li>An implementor who overrides <code>FindMany</code> and one who does not now have
          different observable behaviour for the same call, and nothing in the type system records
          which is which.</li>
        </ul>
        <p><strong>What to do about it.</strong> Say it in the interface's documentation — "the
        default implementation calls <code>Find</code> once per id; override for stores where a
        batch lookup is cheaper" — which turns the hidden dependency into a stated contract you are
        then obliged to keep. And prefer defaults that are plainly correct and visibly slow
        over ones that are clever: the purpose of this default is to let old code compile, not to
        be a good implementation. A default that throws
        <code>NotSupportedException</code> is sometimes the more honest choice, because it forces
        every implementor to make a decision rather than silently inheriting an N+1.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>State the difference between an abstract class and an interface in one sentence each, and
      then give the difference that actually decides most designs.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>An abstract class <strong>shares mechanism</strong> — state, constructors, working code
        — and costs the single inheritance slot. An interface <strong>states a role</strong>, holds
        no state, and a type may have many. The deciding difference is <strong>versioning</strong>:
        adding a member to an abstract class you own breaks nobody; adding one to a published
        interface breaks every implementor unless it has a default.</p>
      </div></details>
    </li>
    <li>
      <p>What are the two failures produced by adding a member to a published interface, and which
      is more dangerous?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>CS0535</code> for anything that rebuilds, and <code>TypeLoadException</code> for
        anything deployed without rebuilding. The second is more dangerous: it fires when the
        <em>type is loaded</em> rather than when the member is called, so a service that would never
        use the new member still dies — usually at startup, during DI registration, naming a method
        absent from its source.</p>
      </div></details>
    </li>
    <li>
      <p>Where does a default interface method live, and what is the practical consequence?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>On the <strong>interface</strong>, not the class. <code>payment.AuditLine()</code> is
        <code>CS1061</code> and <code>typeof(Payment).GetMethod("AuditLine")</code> is
        <code>null</code>; you must hold an interface reference. So defaults are a versioning tool
        for the interface's callers, not a code-sharing mechanism for implementors.</p>
      </div></details>
    </li>
    <li>
      <p>Do two interfaces declaring a method with the same name create a diamond? What does?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No</strong> — they are different members that share a spelling, and a class may
        implement both while declaring nothing. A real diamond is <em>one</em> base interface member
        with two competing implementations in unrelated derived interfaces, which is
        <code>CS8705</code>, "does not have a most specific implementation". Resolve it by
        implementing the member on the class.</p>
      </div></details>
    </li>
    <li>
      <p>Name the two good reasons to implement an interface explicitly.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Resolving a collision — two interfaces requiring the same signature with different
        meanings, where one method cannot satisfy both. And keeping infrastructure off the public
        surface — a member that exists for a host or framework, so that the compiler stops ordinary
        callers using it.</p>
      </div></details>
    </li>
    <li>
      <p>Why prefer <code>abstract</code> over <code>virtual</code> when there is no sensible
      default?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It converts a silent runtime mistake into a compile error — forgetting to override a
        <code>virtual</code> member quietly uses the base version, while omitting an
        <code>abstract</code> one is <code>CS0534</code>. And it leaves no base implementation for
        subclasses to depend on, so there is no behavioural contract to break later.</p>
      </div></details>
    </li>
    <li>
      <p>What can a <code>static abstract</code> interface member express that nothing else
      could?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A requirement on the <strong>type itself</strong> rather than on its instances — a
        factory, a parse method, an operator — callable from generic code on a type parameter with
        no instance and no reflection. It is the basis of the generic-math interfaces such as
        <code>INumber&lt;T&gt;</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Why did <code>Mean(2, 4, 6, 9)</code> return 5?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>T</code> was <code>int</code>, so <code>/</code> was integer division and 21/4
        truncated to 5. Generic math gives exactly what the concrete type would have done; it does
        not paper over the type's own arithmetic rules.</p>
      </div></details>
    </li>
    <li>
      <p>In the production example, why is <code>IClock</code> an interface while
      <code>ChannelBase</code> is an abstract class?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>IClock</code> is a boundary with no mechanism to share, existing so a test can
        substitute a fixed clock — an abstract class would be pure cost.
        <code>ChannelBase</code> shares real mechanism <em>with state</em> (the clock, the log, the
        attempt limit) plus retry and error handling that must be identical and unskippable, and an
        interface cannot hold fields.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>ChannelBase</code> implement <code>IChannel</code> rather than
      <code>Notifier</code> depending on <code>ChannelBase</code> directly?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>So the shared mechanism is <strong>available but not mandatory</strong>. A channel whose
        class already has a base class can implement <code>IChannel</code> directly and still work
        with <code>Notifier</code>. Interface for the contract, optional abstract base for the
        shared work, is the standard shape in the .NET libraries.</p>
      </div></details>
    </li>
    <li>
      <p>How do you judge whether an interface is worth its versioning cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Count the implementations that are <em>not</em> test doubles. Zero means it is a
        mock-enabling wrapper buying little; one means it is a boundary, which may be enough;
        several means it is a genuine role. Then ask whether it is likely to gain members — if so,
        prefer a narrower interface, or an abstract class if every implementor is yours.</p>
      </div></details>
    </li>
    <li>
      <p>A default implementation written in terms of another interface member repeats which
      earlier problem?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The <strong>fragile base class problem</strong> from
        <a href="#/m/t1-10-inheritance">Inheritance</a>. The default's dependence on
        <code>Find</code> is invisible to implementors, so side effects in <code>Find</code> run N
        times unexpectedly, and a later version that stops routing through it changes behaviour
        silently with no rebuild able to detect it. State the routing in the documentation, and
        keep defaults plainly correct rather than clever.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
