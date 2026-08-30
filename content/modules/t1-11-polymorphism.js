/* ============================================================================
   Track 1, Module 11 — Polymorphism and Virtual Dispatch
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-11-polymorphism/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-11-polymorphism",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "One reference, several possible methods, and a decision made at run time by reading a " +
    "pointer at the front of the object. Dispatch is cheap until more than one type reaches " +
    "the same call site — and the difference between override and new is the difference " +
    "between participating in that mechanism and quietly opting out of it.",
  terms: [
    "polymorphism", "virtual dispatch", "static type", "runtime type",
    "method table", "vtable", "slot", "override", "new modifier",
    "sealed override", "devirtualisation", "dynamic PGO",
    "guarded devirtualisation", "monomorphic", "polymorphic",
    "covariant return type", "interface dispatch", "overload resolution",
    "open-closed", "IsFinal", "TypeHandle"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>An order validation service runs four checks on every order. A fifth is needed. The code that
  runs the checks is a chain of <code>if</code> statements naming each one, so adding a check means
  editing that method, and every check added since has meant editing it again. It is now the file
  with the most merge conflicts in the repository, and the one place where a mistake affects all
  five checks at once.</p>

  <p>Meanwhile a bug report: a truck is being described as having four wheels. The
  <code>Truck</code> class plainly declares six. Reading the object in a debugger confirms it is a
  <code>Truck</code>. The method returning four is on a base class the truck derives from, and
  nothing in either file looks wrong.</p>

  <p>And a third: a service that processes ten million messages an hour gets 8% slower after a
  release that added a second implementation of an interface. No code on the hot path changed. The
  new implementation is not used by that path at all — it merely exists.</p>

  <p>These are one topic. Each is about <strong>which method actually runs when you call one</strong>
  — a question with two possible answers, decided in two different places, at two different times.
  The first case wants the decision made late, so new checks slot in without editing anything. The
  second is a decision made early when the author expected late. The third is what the runtime does
  when it can no longer predict the answer.</p>
</section>

<section id="what-polymorphism-is">
  <h2>Two types, and which one wins</h2>

  <p class="define"><span class="define__term">Polymorphism</span> One piece of code operating on
  values of several different types, where each type supplies its own behaviour. Literally "many
  shapes". In practice: you write <code>shape.Draw()</code> once and every shape draws itself
  correctly, without the calling code naming any of them.</p>

  <p>Everything in this module follows from one distinction.</p>

  <p class="define"><span class="define__term">Static type</span> The type written in the
  declaration — the compiler's view. In <code>Animal a = new Dog();</code> the static type of
  <code>a</code> is <code>Animal</code>. Fixed at compile time and visible in the source.</p>

  <p class="define"><span class="define__term">Runtime type</span> The actual type of the object
  the reference points at — <code>Dog</code>. Available at run time via <code>GetType()</code>, and
  not generally knowable by the compiler.</p>

  <p><strong>Every member access is resolved using one or the other, and which one is decided by
  how the member was declared.</strong> Fields, non-virtual methods, and overload selection use the
  static type. Virtual methods use the runtime type. That single sentence explains the truck.</p>

  <p class="define"><span class="define__term">Virtual dispatch</span> Choosing which
  implementation to run based on the object's runtime type rather than the reference's static type.
  Also called <em>late binding</em>, because the choice is made when the call happens rather than
  when it is compiled.</p>

  <p>The analogy usually offered is a job title: you ask "the on-call engineer" to respond, without
  knowing who that is this week; whoever holds the role responds. <strong>The analogy is worth
  exactly one thing</strong> — it conveys that the caller names a role, not a person. It misleads
  about cost, because looking up the on-call engineer is the expensive part of that story while
  here it is nearly free; and it misleads about timing, because the C# equivalent of "who is on
  call" is fixed the moment the object is created and never changes for that object's life.</p>
</section>

<section id="minimal-example">
  <h2>The smallest version</h2>

  <pre data-lang="csharp" data-net="10" data-title="01-dispatch-basics.cs"><code>// 01-dispatch-basics.cs — who decides which method runs, and when that decision
// is made. .NET 10.0.400. Run: dotnet run 01-dispatch-basics.cs

using System;

class Notification
{
    public virtual string Channel() =&gt; "generic";
    public string Send() =&gt; $"sending via {Channel()}";      // not virtual
    public virtual string Format() =&gt; $"[{Channel()}] message";
}

class EmailNotification : Notification
{
    public override string Channel() =&gt; "email";
}

class SmsNotification : Notification
{
    // 'new', not 'override'. A separate member, not a replacement.
    public new string Channel() =&gt; "sms";
}

class PushNotification : Notification
{
    public override string Channel() =&gt; "push";
    public override string Format() =&gt; $"PUSH! {base.Channel()} -&gt; {Channel()}";
}

class Program
{
    static void Main()
    {
        Notification[] all =
        {
            new Notification(), new EmailNotification(),
            new SmsNotification(), new PushNotification()
        };

        Console.WriteLine("Through a Notification-typed reference:");
        foreach (var n in all)
            Console.WriteLine($"  {n.GetType().Name,-20} Channel()={n.Channel(),-8} Send()={n.Send()}");

        Console.WriteLine();
        Console.WriteLine("Through each object's own declared type:");
        Console.WriteLine($"  EmailNotification : {new EmailNotification().Channel()}");
        Console.WriteLine($"  SmsNotification   : {new SmsNotification().Channel()}");
        Console.WriteLine($"  PushNotification  : {new PushNotification().Channel()}");

        Console.WriteLine();
        Console.WriteLine("Format() calls Channel() from inside the base class:");
        foreach (var n in all)
            Console.WriteLine($"  {n.GetType().Name,-20} {n.Format()}");

        Console.WriteLine();
        var sms = new SmsNotification();
        Notification asBase = sms;
        Console.WriteLine("One SmsNotification object, two references:");
        Console.WriteLine($"  sms.Channel()     = {sms.Channel()}");
        Console.WriteLine($"  asBase.Channel()  = {asBase.Channel()}");
        Console.WriteLine($"  same object?      = {ReferenceEquals(sms, asBase)}");
        Console.WriteLine($"  runtime type      = {asBase.GetType().Name}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Through a Notification-typed reference:
  Notification         Channel()=generic  Send()=sending via generic
  EmailNotification    Channel()=email    Send()=sending via email
  SmsNotification      Channel()=generic  Send()=sending via generic
  PushNotification     Channel()=push     Send()=sending via push

Through each object's own declared type:
  EmailNotification : email
  SmsNotification   : sms
  PushNotification  : push

Format() calls Channel() from inside the base class:
  Notification         [generic] message
  EmailNotification    [email] message
  SmsNotification      [generic] message
  PushNotification     PUSH! generic -&gt; push

One SmsNotification object, two references:
  sms.Channel()     = sms
  asBase.Channel()  = generic
  same object?      = True
  runtime type      = SmsNotification</code></pre>

  <p>Three readings of that output, in order of importance.</p>

  <p><strong><code>Send()</code> is not virtual and still reached the overrides.</strong> It lives
  on <code>Notification</code> and calls <code>Channel()</code>, which is virtual. A non-virtual
  method calling a virtual one is the normal way polymorphism is used: the fixed part of the
  algorithm is written once, and the varying part is a virtual call inside it. This is the template
  method shape from <a href="#/m/t1-10-inheritance">Inheritance</a>, seen from the dispatch side.</p>

  <p><strong><code>SmsNotification</code> gave two different answers for the same object.</strong>
  Through its own type it said <code>sms</code>; through a <code>Notification</code> reference it
  said <code>generic</code>. It used <code>new</code> rather than <code>override</code>, so it
  never joined the mechanism.</p>

  <p><strong>The last block is the diagnostic signature.</strong> <code>GetType()</code> reports
  <code>SmsNotification</code> while the call produces the base class's answer. Whenever you see
  the runtime type and the behaviour disagree like that, you are looking at hiding, not
  overriding — and you can confirm it in one line without reading either class.</p>
</section>

<section id="the-method-table">
  <h2>How the runtime actually decides</h2>

  <p>The mechanism is smaller than it sounds, and it is worth seeing concretely, because every
  performance claim later in this module follows from it.</p>

  <p class="define"><span class="define__term">Method table</span> A per-type structure the runtime
  builds, holding a fixed-size array of code addresses — one entry per virtual member. Commonly
  called the <strong>vtable</strong> (virtual method table). Every type in a hierarchy has its own,
  and the entry at a given position means the same member in all of them.</p>

  <p class="define"><span class="define__term">Slot</span> A position in that array.
  <code>Channel()</code> might be slot 4. <code>Notification</code>'s table holds
  <code>Notification.Channel</code> at slot 4; <code>EmailNotification</code>'s table holds
  <code>EmailNotification.Channel</code> at the same slot 4. <code>override</code> means
  <em>put my code in the slot the base member already occupies</em>.</p>

  <p>Every object on the heap begins with a pointer to its type's method table. That is not a
  metaphor — you can read it:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-the-method-table.cs"><code>// 03-the-method-table.cs — dispatch is not magic. Every object begins with a
// pointer to its type's method table, and that pointer is how the runtime finds
// the right override. This reads it directly.
// .NET 10.0.400, x64. Run: dotnet run 03-the-method-table.cs -c Release

#:property AllowUnsafeBlocks=true

using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

class Animal
{
    public virtual string Speak() =&gt; "...";
}

class Dog : Animal
{
    public override string Speak() =&gt; "woof";
}

class Cat : Animal
{
    public override string Speak() =&gt; "meow";
}

class Program
{
    // The first pointer-sized field of any reference type instance is its
    // method table pointer. This is an implementation detail of CoreCLR, shown
    // here to make dispatch concrete — never rely on it in real code.
    static unsafe nint MethodTableOf(object o)
    {
        // TypedReference gives us the address of the reference itself.
        var handle = GCHandle.Alloc(o, GCHandleType.Normal);
        nint objAddress = GCHandle.ToIntPtr(handle);
        // Dereference the handle to reach the object, then read its first word.
        nint objPtr = *(nint*)objAddress;
        nint mt = *(nint*)objPtr;
        handle.Free();
        return mt;
    }

    static void Main()
    {
        var d1 = new Dog();
        var d2 = new Dog();
        var c1 = new Cat();
        var a1 = new Animal();

        Console.WriteLine("Each object's first word, and its type's method table handle:");
        foreach (var (name, o) in new (string, object)[]
                 { ("d1 (Dog)", d1), ("d2 (Dog)", d2), ("c1 (Cat)", c1), ("a1 (Animal)", a1) })
        {
            nint fromObject = MethodTableOf(o);
            nint fromType = o.GetType().TypeHandle.Value;
            Console.WriteLine($"  {name,-12} object word = 0x{fromObject:X}   " +
                              $"TypeHandle = 0x{fromType:X}   same = {fromObject == fromType}");
        }

        Console.WriteLine();
        Console.WriteLine("Two Dogs share one method table; a Cat has a different one:");
        Console.WriteLine($"  d1 and d2 share : {MethodTableOf(d1) == MethodTableOf(d2)}");
        Console.WriteLine($"  d1 and c1 share : {MethodTableOf(d1) == MethodTableOf(c1)}");

        Console.WriteLine();
        Console.WriteLine("That word is the entire mechanism. A virtual call reads it,");
        Console.WriteLine("looks up a fixed slot, and jumps:");
        Animal[] zoo = { d1, c1, a1 };
        foreach (var a in zoo)
            Console.WriteLine($"  static type Animal, object is {a.GetType().Name,-7} -&gt; {a.Speak()}");

        Console.WriteLine();
        Console.WriteLine($"size of a reference on this platform: {IntPtr.Size} bytes");
        Console.WriteLine($"object header + method table pointer: {2 * IntPtr.Size} bytes per object");
        Console.WriteLine($"Unsafe.SizeOf&lt;Animal reference&gt;()   : {Unsafe.SizeOf&lt;Animal&gt;()} bytes (the reference, not the object)");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Each object's first word, and its type's method table handle:
  d1 (Dog)     object word = 0x7FFA3095AFA8   TypeHandle = 0x7FFA3095AFA8   same = True
  d2 (Dog)     object word = 0x7FFA3095AFA8   TypeHandle = 0x7FFA3095AFA8   same = True
  c1 (Cat)     object word = 0x7FFA3095B090   TypeHandle = 0x7FFA3095B090   same = True
  a1 (Animal)  object word = 0x7FFA3095AED0   TypeHandle = 0x7FFA3095AED0   same = True

Two Dogs share one method table; a Cat has a different one:
  d1 and d2 share : True
  d1 and c1 share : False

That word is the entire mechanism. A virtual call reads it,
looks up a fixed slot, and jumps:
  static type Animal, object is Dog     -&gt; woof
  static type Animal, object is Cat     -&gt; meow
  static type Animal, object is Animal  -&gt; ...

size of a reference on this platform: 8 bytes
object header + method table pointer: 16 bytes per object
Unsafe.SizeOf&lt;Animal reference&gt;()   : 8 bytes (the reference, not the object)</code></pre>

  <p>The word at the front of every <code>Dog</code> is identical, equals
  <code>typeof(Dog).TypeHandle.Value</code>, and differs from a <code>Cat</code>'s. So a virtual
  call is, in principle, three steps: read the pointer at the object's address, read a fixed offset
  into the table it points at, jump there. Two memory reads and an indirect jump.</p>

  <div class="callout callout--warn">
    <p><strong>That code is a demonstration, not a technique.</strong> The layout of an object
    header is an internal detail of CoreCLR, undocumented as a contract, and free to change between
    releases and across runtimes. It is shown here so "the vtable" is a thing you have seen rather
    than a word. Never read it in code you ship.</p>
  </div>

  <p>Two consequences fall out of the layout, and both matter later. Every object pays 16 bytes of
  header before its own fields — relevant when
  <a href="#/m/t1-15-structs-and-records">Structs, Records, readonly, and init</a> asks why a struct
  is sometimes the better choice. And a virtual call's cost is dominated not by the arithmetic but
  by whether those reads hit cache and whether the processor can predict the jump target — which is
  the subject of the next section.</p>
</section>

<section id="the-cost">
  <h2>What dispatch costs</h2>

  <p>The received wisdom is that virtual calls are slow and interfaces slower. The measurement is
  more interesting than that, and getting it right requires knowing what the runtime does.</p>

  <p class="define"><span class="define__term">Devirtualisation</span> The JIT compiler proving
  that a virtual call can only land on one implementation, and replacing the indirect jump with a
  direct call — which then usually lets it inline the method entirely, removing the call
  altogether.</p>

  <p class="define"><span class="define__term">Dynamic PGO</span> Profile-guided optimisation
  performed at run time. The runtime instruments a call site, observes which type actually arrives,
  and recompiles the method with a fast path for that type. On by default since .NET 8.</p>

  <p class="define"><span class="define__term">Guarded devirtualisation</span> The shape that
  produces: a type check, then an inlined fast path for the common type, then a fallback to a real
  virtual call. Cheap when the guess is right, and an extra branch when it is wrong.</p>

  <p class="define"><span class="define__term">Monomorphic</span> A call site that only ever sees
  one runtime type. <span class="define__term">Polymorphic</span> — one that sees several. This
  distinction, not the <code>virtual</code> keyword, is what determines the cost.</p>

  <div class="callout callout--note">
    <p><strong>A measurement note that changed this section's design.</strong> The first version of
    this benchmark reported that a <code>sealed</code> class was <em>four times slower</em> than an
    ordinary one — an absurd result. The cause: two scenarios shared one loop method, so they
    shared one call site and therefore one type profile. The first scenario taught the JIT to
    expect type <code>A</code>; the second then failed that guard on every iteration, and what was
    labelled "sealed" was really "guard misprediction". Every scenario below has its own loop
    method for that reason, and the polymorphic cases run in a separate process so nothing has
    warmed them. Sharing a call site between benchmarks silently measures the wrong thing.</p>
  </div>

  <pre data-lang="csharp" data-net="10" data-title="02-dispatch-cost.cs"><code>// 02-dispatch-cost.cs — what each kind of call costs.
//
// METHOD NOTE. .NET uses dynamic profile-guided optimisation: the JIT watches
// which type actually arrives at a call site and emits a fast path guarded by a
// type check. That makes measurement delicate — two scenarios sharing one loop
// method share one call site and therefore one profile, and the second scenario
// then measures guard failures rather than itself. Every scenario below has its
// own loop method for that reason, and the polymorphic case is run in a
// separate process (pass "poly") so no earlier measurement has warmed it.
//
// .NET 10.0.400, Release, x64.
//   dotnet run 02-dispatch-cost.cs -c Release
//   dotnet run 02-dispatch-cost.cs -c Release -- poly

using System;
using System.Diagnostics;

interface IScorer { int Score(int x); }

class Base : IScorer
{
    public int Direct(int x) =&gt; x &amp; 7;
    public virtual int Virtual(int x) =&gt; x &amp; 7;
    public virtual int Score(int x) =&gt; x &amp; 7;
}

class A : Base { public override int Virtual(int x) =&gt; x &amp; 7; public override int Score(int x) =&gt; x &amp; 7; }
class B : Base { public override int Virtual(int x) =&gt; x &amp; 7; public override int Score(int x) =&gt; x &amp; 7; }
class C : Base { public override int Virtual(int x) =&gt; x &amp; 7; public override int Score(int x) =&gt; x &amp; 7; }
class D : Base { public override int Virtual(int x) =&gt; x &amp; 7; public override int Score(int x) =&gt; x &amp; 7; }

sealed class SealedLeaf : Base
{
    public override int Virtual(int x) =&gt; x &amp; 7;
    public override int Score(int x) =&gt; x &amp; 7;
}

abstract class Shape { public abstract int Area(int x); }
sealed class Sq : Shape { public override int Area(int x) =&gt; x &amp; 7; }

class Program
{
    const int N = 100_000_000;

    // Each of these is a separate call site with its own type profile.
    static long L1(Base b) { long s = 0; for (int i = 0; i &lt; N; i++) s += b.Direct(i); return s; }
    static long L2(Base b) { long s = 0; for (int i = 0; i &lt; N; i++) s += b.Virtual(i); return s; }
    static long L3(SealedLeaf b) { long s = 0; for (int i = 0; i &lt; N; i++) s += b.Virtual(i); return s; }
    static long L4(IScorer b) { long s = 0; for (int i = 0; i &lt; N; i++) s += b.Score(i); return s; }
    static long L5(Shape b) { long s = 0; for (int i = 0; i &lt; N; i++) s += b.Area(i); return s; }
    static long L6(Base[] bs) { long s = 0; for (int i = 0; i &lt; N; i++) s += bs[i &amp; 3].Virtual(i); return s; }
    static long L7(Base[] bs) { long s = 0; for (int i = 0; i &lt; N; i++) s += bs[0].Virtual(i); return s; }
    static long L8(IScorer[] bs) { long s = 0; for (int i = 0; i &lt; N; i++) s += bs[i &amp; 3].Score(i); return s; }

    static void Time(string label, Func&lt;long&gt; body)
    {
        body();
        double best = double.MaxValue, worst = 0;
        for (int r = 0; r &lt; 5; r++)
        {
            var sw = Stopwatch.StartNew();
            long s = body();
            sw.Stop();
            if (s == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
            worst = Math.Max(worst, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-40} best {best,7:F1} ms   worst {worst,7:F1} ms");
    }

    static void Main(string[] args)
    {
        bool poly = args.Length &gt; 0 &amp;&amp; args[0] == "poly";
        Console.WriteLine($"N = {N:N0} calls per run, best and worst of 5, mode = {(poly ? "polymorphic" : "monomorphic")}");
        Console.WriteLine();

        if (!poly)
        {
            Console.WriteLine("One implementing type reaches each call site:");
            Time("non-virtual call", () =&gt; L1(new A()));
            Time("virtual", () =&gt; L2(new A()));
            Time("virtual, receiver typed as sealed class", () =&gt; L3(new SealedLeaf()));
            Time("interface call", () =&gt; L4(new A()));
            Time("abstract call, sealed implementation", () =&gt; L5(new Sq()));
            Console.WriteLine();
            Console.WriteLine("Run again with \"poly\" for the multi-type case.");
        }
        else
        {
            Base[] four = { new A(), new B(), new C(), new D() };
            IScorer[] fourI = { new A(), new B(), new C(), new D() };
            Base[] one = { new A(), new A(), new A(), new A() };

            Console.WriteLine("Four different types reach the same call site:");
            Time("virtual, 4 types alternating", () =&gt; L6(four));
            Time("interface, 4 types alternating", () =&gt; L8(fourI));
            Console.WriteLine();
            Console.WriteLine("Same loop shape, but every element is the same type:");
            Time("virtual, array of one type", () =&gt; L7(one));
        }
    }
}</code></pre>

  <p>100 million calls per run, best of 5, two independent samples:</p>

  <div class="table-wrap">
  <table>
    <thead>
      <tr><th>Call site sees</th><th>Shape</th><th>Sample 1</th><th>Sample 2</th></tr>
    </thead>
    <tbody>
      <tr><td rowspan="5">one type</td><td>non-virtual call</td><td>105 ms</td><td>103 ms</td></tr>
      <tr><td>virtual</td><td>103 ms</td><td>101 ms</td></tr>
      <tr><td>virtual, receiver typed as a sealed class</td><td>117 ms</td><td>97 ms</td></tr>
      <tr><td>interface call</td><td>100 ms</td><td>96 ms</td></tr>
      <tr><td>abstract call, sealed implementation</td><td>131 ms</td><td>94 ms</td></tr>
      <tr><td rowspan="3">four types</td><td>virtual</td><td>387 ms</td><td>336 ms</td></tr>
      <tr><td>interface</td><td>500 ms</td><td>621 ms</td></tr>
      <tr><td>same loop, array of one type (control)</td><td>102 ms</td><td>134 ms</td></tr>
    </tbody>
  </table>
  </div>

  <p><strong>With one type at the call site, every shape is the same.</strong> Non-virtual,
  virtual, interface and abstract all land between 94 and 131 ms, with the ordering changing
  between samples — the signature of measurement noise rather than a real difference. The JIT
  devirtualised and inlined all of them, so what is being timed is the loop.</p>

  <p><strong>With four types, virtual costs about 3.5 times as much</strong> (336–387 ms against
  ~103), and <strong>interface dispatch costs about 5 to 6 times</strong> (500–621 ms). Interface
  calls are genuinely more expensive than virtual ones, because a virtual call reads a fixed slot
  while an interface call has to find where that interface's methods live for this particular
  type.</p>

  <p><strong>The control row is what makes those numbers trustworthy.</strong> It runs the identical
  loop — same array, same indexing, same everything — with every element the same type, and comes
  back at 102–134 ms. So the difference is dispatch, not the loop.</p>

  <p>In absolute terms: a monomorphic call is about <strong>1 nanosecond</strong> and a polymorphic
  virtual call about <strong>3.5 nanoseconds</strong>. The overhead is roughly 2.5 ns per call. Whether
  that matters is not a question about dispatch; it is a question about how many calls you make and
  what else each one does, and the production section puts a number on it.</p>

  <div class="callout callout--myth">
    <p><strong>What this did not show.</strong> Marking the class <code>sealed</code> produced no
    measurable improvement — 117 and 97 ms against 103 and 101 for the unsealed equivalent, which
    is noise. That is not because <code>sealed</code> does nothing; it is because dynamic PGO had
    already devirtualised the monomorphic call site, so there was nothing left for
    <code>sealed</code> to remove. <code>sealed</code> still helps: it lets the JIT devirtualise
    <em>statically</em>, without needing to observe the call site first, which matters for
    code that runs a few thousand times rather than a hundred million, and for Native AOT where
    there is no profiling step at all. The honest summary is that on a hot path under a modern JIT,
    <code>sealed</code> is a correctness and design tool whose performance benefit you should
    measure rather than assume.</p>
  </div>
</section>

<section id="override-new-sealed">
  <h2>override, new, and sealed override</h2>

  <p>Four things a derived class can do with an inherited virtual member, and what each does to the
  slot.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-override-new-sealed.cs"><code>#:property NoWarn=IL2075

// 04-override-new-sealed.cs — the four things you can do to an inherited
// virtual member, and what each does to the method table slot.
// .NET 10.0.400. Run: dotnet run 04-override-new-sealed.cs

using System;
using System.Linq;
using System.Reflection;

class Renderer
{
    public virtual string Render() =&gt; "base";
    public virtual string Header() =&gt; "base header";
}

// 1. override — takes over the existing slot
class HtmlRenderer : Renderer
{
    public override string Render() =&gt; "html";

    // 2. sealed override — takes the slot and closes it to further overriding
    public sealed override string Header() =&gt; "html header";
}

// 3. no member at all — inherits whatever the slot points at
class PlainHtmlRenderer : HtmlRenderer { }

// 4. new — a separate member; the slot is untouched
class BrokenRenderer : Renderer
{
    public new string Render() =&gt; "broken";
}

// ---- covariant return types (C# 9 and later) ------------------------------
class Document { public virtual string Kind =&gt; "document"; }
class Invoice : Document { public override string Kind =&gt; "invoice"; }

class DocumentFactory
{
    public virtual Document Create() =&gt; new Document();
}

class InvoiceFactory : DocumentFactory
{
    // The override may return a MORE DERIVED type than the base declared.
    public override Invoice Create() =&gt; new Invoice();
}

class Program
{
    static void Main()
    {
        Renderer[] all = { new Renderer(), new HtmlRenderer(),
                           new PlainHtmlRenderer(), new BrokenRenderer() };

        Console.WriteLine("Called through a Renderer reference:");
        foreach (var r in all)
            Console.WriteLine($"  {r.GetType().Name,-20} Render()={r.Render(),-8} Header()={r.Header()}");

        Console.WriteLine();
        Console.WriteLine("Called through each object's own type:");
        Console.WriteLine($"  BrokenRenderer.Render()      : {new BrokenRenderer().Render()}");
        Console.WriteLine($"  PlainHtmlRenderer.Render()   : {new PlainHtmlRenderer().Render()}");

        Console.WriteLine();
        Console.WriteLine("Which declaration owns the slot, per runtime type:");
        foreach (var r in all)
        {
            var mi = r.GetType().GetMethod("Render")!;
            Console.WriteLine($"  {r.GetType().Name,-20} Render resolves to {mi.DeclaringType!.Name}.Render " +
                              $"(IsVirtual={mi.IsVirtual}, IsFinal={mi.IsFinal})");
        }

        Console.WriteLine();
        var hdr = typeof(HtmlRenderer).GetMethod("Header")!;
        Console.WriteLine($"HtmlRenderer.Header IsVirtual={hdr.IsVirtual}, IsFinal={hdr.IsFinal}");
        Console.WriteLine("  IsFinal=True is what 'sealed override' produces: still in the slot,");
        Console.WriteLine("  but no further class may replace it.");

        Console.WriteLine();
        Console.WriteLine("Covariant return types:");
        DocumentFactory f = new InvoiceFactory();
        Document viaBase = f.Create();
        Invoice viaDerived = new InvoiceFactory().Create();   // no cast needed
        Console.WriteLine($"  through DocumentFactory : {viaBase.GetType().Name} ({viaBase.Kind})");
        Console.WriteLine($"  through InvoiceFactory  : {viaDerived.GetType().Name} ({viaDerived.Kind})");
        Console.WriteLine($"  base declares return    : {typeof(DocumentFactory).GetMethod("Create")!.ReturnType.Name}");
        Console.WriteLine($"  override declares return: {typeof(InvoiceFactory).GetMethod("Create")!.ReturnType.Name}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Called through a Renderer reference:
  Renderer             Render()=base     Header()=base header
  HtmlRenderer         Render()=html     Header()=html header
  PlainHtmlRenderer    Render()=html     Header()=html header
  BrokenRenderer       Render()=base     Header()=base header

Called through each object's own type:
  BrokenRenderer.Render()      : broken
  PlainHtmlRenderer.Render()   : html

Which declaration owns the slot, per runtime type:
  Renderer             Render resolves to Renderer.Render (IsVirtual=True, IsFinal=False)
  HtmlRenderer         Render resolves to HtmlRenderer.Render (IsVirtual=True, IsFinal=False)
  PlainHtmlRenderer    Render resolves to HtmlRenderer.Render (IsVirtual=True, IsFinal=False)
  BrokenRenderer       Render resolves to BrokenRenderer.Render (IsVirtual=False, IsFinal=False)

HtmlRenderer.Header IsVirtual=True, IsFinal=True
  IsFinal=True is what 'sealed override' produces: still in the slot,
  but no further class may replace it.

Covariant return types:
  through DocumentFactory : Invoice (invoice)
  through InvoiceFactory  : Invoice (invoice)
  base declares return    : Document
  override declares return: Invoice</code></pre>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Declaration</th><th>Effect on the slot</th><th>Reflection shows</th></tr></thead>
    <tbody>
      <tr><td><code>override</code></td><td>Replaces the base's entry</td>
          <td><code>IsVirtual=True, IsFinal=False</code></td></tr>
      <tr><td><code>sealed override</code></td><td>Replaces it and closes it</td>
          <td><code>IsVirtual=True, IsFinal=True</code></td></tr>
      <tr><td>nothing declared</td><td>Inherits whatever the slot holds</td>
          <td>Resolves to the nearest ancestor that overrode it</td></tr>
      <tr><td><code>new</code></td><td>Untouched — a separate, non-virtual member</td>
          <td><code>IsVirtual=False</code></td></tr>
    </tbody>
  </table>
  </div>

  <p>The reflection line for <code>BrokenRenderer</code> is the proof:
  <code>IsVirtual=False</code>. A member declared <code>new</code> is not part of the dispatch
  mechanism at all. It is a different method that happens to share a name.</p>

  <p class="define"><span class="define__term">Sealed override</span> An override that no further
  derived class may replace. It is how you close one member without sealing the whole class — the
  narrower version of the same decision, useful when a base wants to guarantee that one specific
  behaviour is now fixed while leaving the rest extensible.</p>

  <p class="define"><span class="define__term">Covariant return type</span> An override may return
  a more derived type than the base declared. <code>InvoiceFactory.Create()</code> returns
  <code>Invoice</code> where <code>DocumentFactory.Create()</code> returns <code>Document</code>.
  Available since C# 9. It removes a cast that used to be unavoidable: callers who know they hold
  an <code>InvoiceFactory</code> get an <code>Invoice</code> without asking.</p>
</section>

<section id="production-example">
  <h2>Where polymorphism earns its place</h2>

  <p>Back to the first incident: the chain of <code>if</code> statements that everyone has to
  edit.</p>

  <p class="define"><span class="define__term">Open-closed</span> The property that you can add
  behaviour without editing existing code. A list of rule objects has it: a new rule is a new file
  and one registration line. A chain of <code>if</code> statements does not: a new rule means
  editing the method every other rule also lives in.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-production-rules.cs"><code>// 05-production-rules.cs — polymorphism where it earns its place, and the
// dispatch cost put in proportion to the work the calls actually do.
// .NET 10.0.400, Release. Run: dotnet run 05-production-rules.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

public sealed record Order(string Id, decimal Total, string Country, int ItemCount, bool IsFirstOrder);

public sealed record RuleResult(string Rule, bool Passed, string? Reason = null);

public abstract class OrderRule
{
    public abstract string Name { get; }
    protected abstract bool Check(Order order, out string? reason);

    // Non-virtual: every rule is evaluated the same way and cannot skip the
    // bookkeeping. The template-method shape from the previous module.
    public RuleResult Evaluate(Order order)
    {
        try
        {
            bool ok = Check(order, out var reason);
            return new RuleResult(Name, ok, ok ? null : reason);
        }
        catch (Exception ex)
        {
            return new RuleResult(Name, false, $"rule threw {ex.GetType().Name}");
        }
    }
}

public sealed class MinimumTotalRule : OrderRule
{
    private readonly decimal _minimum;
    public MinimumTotalRule(decimal minimum) =&gt; _minimum = minimum;
    public override string Name =&gt; "minimum-total";
    protected override bool Check(Order o, out string? reason)
    {
        reason = o.Total &lt; _minimum ? $"total {o.Total:0.00} below {_minimum:0.00}" : null;
        return reason is null;
    }
}

public sealed class ShippableCountryRule : OrderRule
{
    private static readonly HashSet&lt;string&gt; Allowed = new(StringComparer.OrdinalIgnoreCase)
        { "GB", "IE", "FR", "DE" };
    public override string Name =&gt; "shippable-country";
    protected override bool Check(Order o, out string? reason)
    {
        reason = Allowed.Contains(o.Country) ? null : $"cannot ship to {o.Country}";
        return reason is null;
    }
}

public sealed class FirstOrderLimitRule : OrderRule
{
    public override string Name =&gt; "first-order-limit";
    protected override bool Check(Order o, out string? reason)
    {
        reason = o.IsFirstOrder &amp;&amp; o.Total &gt; 500m ? "first order over 500.00" : null;
        return reason is null;
    }
}

public sealed class ItemCountRule : OrderRule
{
    public override string Name =&gt; "item-count";
    protected override bool Check(Order o, out string? reason)
    {
        reason = o.ItemCount is &lt; 1 or &gt; 100 ? $"item count {o.ItemCount} out of range" : null;
        return reason is null;
    }
}

public sealed class OrderValidator
{
    private readonly IReadOnlyList&lt;OrderRule&gt; _rules;
    public OrderValidator(IEnumerable&lt;OrderRule&gt; rules) =&gt; _rules = rules.ToArray();

    public IReadOnlyList&lt;RuleResult&gt; Validate(Order order)
        =&gt; _rules.Select(r =&gt; r.Evaluate(order)).ToArray();
}

class Program
{
    static void Main()
    {
        var validator = new OrderValidator(new OrderRule[]
        {
            new MinimumTotalRule(10m),
            new ShippableCountryRule(),
            new FirstOrderLimitRule(),
            new ItemCountRule()
        });

        var orders = new[]
        {
            new Order("A-1", 250m, "GB", 3, false),
            new Order("A-2", 5m, "GB", 1, false),
            new Order("A-3", 900m, "US", 2, true)
        };

        foreach (var o in orders)
        {
            var results = validator.Validate(o);
            var failed = results.Where(r =&gt; !r.Passed).ToArray();
            Console.WriteLine($"{o.Id}: {(failed.Length == 0 ? "accepted" : "rejected")}");
            foreach (var f in failed) Console.WriteLine($"    {f.Rule}: {f.Reason}");
        }

        Console.WriteLine();
        Console.WriteLine("--- what the dispatch actually costs here ---");
        var order = orders[0];
        const int Iterations = 1_000_000;

        validator.Validate(order);
        double best = double.MaxValue;
        for (int r = 0; r &lt; 5; r++)
        {
            var sw = Stopwatch.StartNew();
            for (int i = 0; i &lt; Iterations; i++) validator.Validate(order);
            sw.Stop();
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }

        double perValidation = best * 1_000_000 / Iterations;   // nanoseconds
        Console.WriteLine($"  {Iterations:N0} validations, 4 rules each = {Iterations * 4L:N0} virtual calls");
        Console.WriteLine($"  best total   : {best:F1} ms");
        Console.WriteLine($"  per order    : {perValidation:F0} ns");
        Console.WriteLine($"  per rule     : {perValidation / 4:F0} ns");
        Console.WriteLine();
        Console.WriteLine("  Measured dispatch overhead from 02-dispatch-cost.cs is about");
        Console.WriteLine("  3 ns per polymorphic virtual call on this machine, so roughly");
        Console.WriteLine($"  {4 * 3.0 / perValidation:P1} of the time above is dispatch. The rest is the");
        Console.WriteLine("  allocation, the LINQ, and the work the rules actually do.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>A-1: accepted
A-2: rejected
    minimum-total: total 5.00 below 10.00
A-3: rejected
    shippable-country: cannot ship to US
    first-order-limit: first order over 500.00

--- what the dispatch actually costs here ---
  1,000,000 validations, 4 rules each = 4,000,000 virtual calls
  best total   : 365.8 ms
  per order    : 366 ns
  per rule     : 91 ns

  Measured dispatch overhead from 02-dispatch-cost.cs is about
  3 ns per polymorphic virtual call on this machine, so roughly
  3.3% of the time above is dispatch. The rest is the
  allocation, the LINQ, and the work the rules actually do.</code></pre>

  <p>That last block is the point of measuring anything. Dispatch here is genuinely polymorphic —
  four different rule types through one <code>OrderRule</code> reference, exactly the case that
  measured 3.5× slower in isolation. And it accounts for <strong>about 3% of the time</strong>.
  The other 97% is the allocation of result records, the LINQ, the <code>HashSet</code> lookup, and
  the string formatting.</p>

  <p>A 3.5× multiplier on 3% of the work is not a performance problem; it is a rounding error. The
  same multiplier on a call inside a tight loop over ten million items is the entire budget. Both
  statements come from the same measurement, which is why "virtual calls are slow" is not a usable
  claim in either direction without knowing the call count.</p>

  <p>Note also the design choices carried over from
  <a href="#/m/t1-10-inheritance">Inheritance</a>: <code>Evaluate</code> is non-virtual and owns
  the error handling, so a rule that throws produces a failed result rather than taking down the
  request; <code>Check</code> is <code>abstract</code>, so there is no base implementation for a
  subclass to depend on; and every rule is <code>sealed</code>, so the hierarchy is two levels and
  stops.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. new where override was meant</h3>

  <p>This is the truck. The derived class declares the member, the object is the derived type, and
  base-class code still gets the base answer — because <code>new</code> never entered the slot. It
  is worse than a plain bug because it is <em>intermittently</em> correct: direct calls on a
  derived-typed variable give the right answer, so it works everywhere you are likely to test it
  and fails wherever the object is held as its base type.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: hiding a virtual member"><code>class Vehicle
{
    public virtual string Wheels() =&gt; "4";
    public string Describe() =&gt; $"{GetType().Name} with {Wheels()} wheels";
}

// WRONG. 'new' hides rather than overrides, so Describe() — which lives on
// Vehicle — keeps calling Vehicle.Wheels().
class Truck : Vehicle
{
    public new string Wheels() =&gt; "6";
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>new Truck().Wheels()      = 6
new Truck().Describe()    = Truck with 4 wheels</code></pre>

  <p>One line reporting the runtime type correctly as <code>Truck</code> and the wheel count
  incorrectly as 4. Written without either keyword it compiles with warning
  <code>CS0108</code> and behaves identically, which is covered in
  <a href="#/m/t1-10-inheritance">Inheritance</a>.</p>

  <h3>2. Overloads are chosen by static type, overrides by runtime type</h3>

  <p>The subtler cousin, and the one that survives code review. Overload resolution — which of
  several same-named methods to call — happens entirely at compile time, from the static types of
  the receiver and the arguments. Only <em>after</em> that choice is made does virtual dispatch
  pick an implementation of the chosen member.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="An overload that shadows an override"><code>class Serialiser
{
    public virtual string Write(object o) =&gt; $"object:{o}";
}

class JsonSerialiser : Serialiser
{
    public override string Write(object o) =&gt; $"json:{o}";
    public string Write(string s) =&gt; $"json-string:{s}";   // an OVERLOAD, not an override
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>s.Write(raw)                    = json:text
((JsonSerialiser)s).Write(raw)  = json-string:text
((JsonSerialiser)s).Write(boxed)= json:text
new JsonSerialiser().Write(raw) = json-string:text</code></pre>

  <p>Same object, same string argument, two different methods — chosen by the declared type of the
  variable. Through a <code>Serialiser</code> reference the compiler can only see
  <code>Write(object)</code>, so that is the member called, and dispatch then finds the override.
  Through a <code>JsonSerialiser</code> reference the compiler sees a better match,
  <code>Write(string)</code>, and picks it before dispatch is involved at all.</p>

  <h3>3. Adding a second implementation slows down code that does not use it</h3>

  <p>The third incident from the top of the module. A call site that had only ever seen one type
  was devirtualised and inlined. Once a second implementation exists and reaches that site, the
  guard starts failing and the call becomes a real indirect jump. Nothing on the hot path was
  edited; its inputs became more varied.</p>

  <p>This is why the honest form of a dispatch measurement always states how many types reached the
  call site, and why a micro-benchmark with one implementation systematically flatters virtual
  calls. It is also why the effect can appear in a release that "changed nothing relevant".</p>

  <h3>4. Calling a virtual member from a constructor</h3>

  <p>Covered in <a href="#/m/t1-08-classes-and-objects">Classes and Objects</a> and sharpened in
  <a href="#/m/t1-10-inheritance">Inheritance</a>. From the dispatch side the reason is now
  precise: the method table pointer is written when the object is allocated, <em>before</em> any
  constructor runs. So virtual dispatch is fully operational throughout construction and lands in
  the most-derived override while that class's constructor body has not yet run.</p>

  <h3>5. Reaching for a type test instead of a virtual member</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: dispatching by hand"><code>// WRONG. Every new shape means editing this method, and forgetting one is a
// runtime failure rather than a compile error.
static decimal Area(Shape s)
{
    if (s is Circle c) return 3.14159m * c.Radius * c.Radius;
    if (s is Square q) return q.Side * q.Side;
    throw new NotSupportedException($"Unknown shape {s.GetType().Name}");
}</code></pre>

  <p>The virtual version moves each case next to the data it needs and makes the compiler enforce
  completeness: an <code>abstract</code> member cannot be left unimplemented. The exception in the
  last line is the tell — it exists because the author knows the method can be wrong and has no way
  to have the compiler check.</p>

  <p>This is not an absolute rule. Where the set of types is fixed and the operations vary — the
  opposite shape — a <code>switch</code> over types with a sealed hierarchy can be the better
  design, and C#'s pattern matching supports it deliberately. The question is which axis changes
  more often: new types favour virtual members, new operations favour switches.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>The wrong implementation is running.</strong> First, print
    <code>obj.GetType().Name</code> next to the result. If the runtime type is the derived one and
    the behaviour is the base one, it is hiding — the member is <code>new</code>, or has no
    modifier and produced a <code>CS0108</code> warning you have not seen. Confirm without reading
    the source:
    <code>obj.GetType().GetMethod("Name")</code> and check <code>IsVirtual</code>. False means it
    was never in the slot. <code>DeclaringType</code> on the same <code>MethodInfo</code> tells you
    which class the runtime will actually use.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>The right implementation runs from one call site and not another.</strong> Compare
    the <em>declared</em> types of the two references, not the objects. If they differ, you are
    almost certainly looking at overload resolution rather than dispatch: the compiler chose
    different members at the two sites. Hovering the call in an IDE shows the resolved signature;
    from the command line, temporarily changing the parameter types so one overload no longer
    matches will produce a compile error naming what was being chosen.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A hot path got slower and nothing on it changed.</strong> Ask what new types were
    introduced anywhere in the release, and whether any of them reach a call site on that path.
    Confirm before optimising: set <code>DOTNET_TieredPGO=0</code> in the environment and re-run.
    If the regression disappears — because the whole process is now uniformly slower and the
    difference vanishes — the cause was a devirtualisation that stopped applying. That is a
    diagnostic setting, not a fix; the fix is to make the call site monomorphic again, or to accept
    the cost once you know its size.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Establishing what dispatch actually costs you.</strong> Do not benchmark the call in
    isolation and extrapolate — the measurement in this module shows an isolated virtual call at
    about 3.5 ns, which tells you nothing about whether it matters. Instead time the real operation
    (here, 366 ns per validation), multiply the call count by the measured per-call overhead, and
    express it as a percentage. If it is 3%, stop. If it is 40%, you have a design question worth
    answering.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Benchmarking dispatch without fooling yourself.</strong> Give every scenario its own
    loop method, and run scenarios that differ in how many types they see in separate processes.
    Sharing a call site between two scenarios shares its type profile, so the second one measures
    guard failures — which is how this module's first benchmark "proved" that
    <code>sealed</code> was four times slower than unsealed. Always include a control that runs the
    same loop shape with a single type, so you can tell dispatch cost from loop cost.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>A concrete case.</strong> A message-processing service handled roughly 10 million
    messages an hour — about 2,800 per second — through a pipeline whose innermost loop called an
    <code>IMessageHandler.Handle</code> per message, plus four <code>IEnrichment.Apply</code> calls
    per message. Five interface calls per message, 14,000 per second, all through interfaces with
    exactly one implementation each.</p>
    <p>A release added a second implementation of <code>IEnrichment</code> for a new customer
    segment, resolved by configuration. The new implementation ran for about 2% of traffic. Median
    latency on the pipeline rose from 41 µs to 44 µs — 8% — and CPU rose enough to need one extra
    instance per region.</p>
    <p>Nothing on the hot path had changed. What changed is that four call sites went from
    monomorphic to polymorphic. With one implementation, the JIT had devirtualised and inlined all
    four; with two, the guard failed on 2% of calls and, more importantly, the inlining that the
    devirtualisation had enabled was gone for all of them. The lost inlining, not the indirect
    jump, was most of the cost — which is why the effect was far larger than the ~2.5 ns per call
    this module measures for dispatch alone.</p>
    <p>The fix was not to remove the abstraction. It was to hoist the enrichment selection out of
    the per-message loop: choose the enrichment set once per batch rather than per message, so the
    inner loop ran over a concrete array. Latency returned to 41 µs, the second implementation
    stayed, and the extra instances were released. Total change: about 20 lines.</p>
  </div>

  <p>The general lesson is not "avoid interfaces". It is that <strong>the unit of cost is the call
  site, not the keyword</strong>. An interface used once per request costs nothing measurable. The
  same interface called five times per message at 2,800 messages a second is on a hot path, and
  whether it is cheap depends on a property — how many types reach it — that no one writes down and
  that a later release can change without touching the code.</p>

  <p>The practical consequence: when you profile, look at call counts before you look at
  implementations. A 3.5× multiplier is decisive at ten million calls and invisible at ten
  thousand, and the same code can be both, six months apart.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"Virtual calls are slow."</strong> Measured here: with one type reaching the call
    site, a virtual call is indistinguishable from a non-virtual one, because the JIT devirtualises
    and inlines it. The cost appears only when the site is polymorphic, and then it is about 2.5 ns
    per call. Whether 2.5 ns matters depends entirely on the call count — 3% of a validation, 100%
    of a tight loop.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Sealing everything makes it faster."</strong> This module measured no improvement
    from <code>sealed</code>, because dynamic PGO had already devirtualised the monomorphic case.
    <code>sealed</code> lets the JIT devirtualise <em>without</em> profiling, which matters for
    code that runs thousands rather than millions of times and for Native AOT. Seal for the design
    reasons from <a href="#/m/t1-10-inheritance">Inheritance</a>; treat any performance benefit as
    a hypothesis to measure.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>new</code> is a way to override when the base member is not
    virtual."</strong> It is a way to declare a different method with the same name. It does not
    participate in dispatch, so base-class code and base-typed references keep getting the base
    implementation. If the base member is not <code>virtual</code> and you need polymorphic
    behaviour, the honest options are to change the base, or to stop inheriting and use
    composition.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Polymorphism means inheritance."</strong> Inheritance is one way to get it.
    Interfaces are another, and are usually the better one — covered next in
    <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and
    Interfaces</a>. Generics give a third form, resolved at compile time with no dispatch cost at
    all for value types, in <a href="#/m/t1-17-generics">Generics</a>. And a delegate is a
    single-method version of the same idea.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>GetType()</code> tells me which method will run."</strong> It tells you the
    runtime type, which decides <em>virtual</em> dispatch only. It does not account for hiding,
    where a non-virtual member is chosen by the reference's static type, and it does not account
    for overload resolution, which happens before dispatch. The truck example has
    <code>GetType()</code> reporting <code>Truck</code> while the base method runs.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"A virtual call is a dictionary lookup by name."</strong> It is an array index into
    a fixed table, decided at compile time. The name is gone by then. Interface dispatch is more
    involved because a type's interface methods are not at a fixed offset in its own table, which
    is why interface calls measured 5–6× rather than 3.5× — but even that is a small number of
    memory reads, not a search.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Reach for</th><th>Because</th></tr></thead>
    <tbody>
      <tr>
        <td>New behaviours get added regularly; callers should not change</td>
        <td>A virtual or abstract member</td>
        <td>Open-closed: a new type is a new file plus a registration, not an edit to shared
        code.</td>
      </tr>
      <tr>
        <td>The set of types is fixed; new <em>operations</em> keep appearing</td>
        <td>A sealed hierarchy plus <code>switch</code> patterns</td>
        <td>The opposite axis of change. Adding an operation touches one method instead of every
        type.</td>
      </tr>
      <tr>
        <td>A base member should be replaceable but has a sensible default</td>
        <td><code>virtual</code></td>
        <td>Subclasses opt in. Remember the behavioural contract obligation from
        <a href="#/m/t1-10-inheritance">Inheritance</a>.</td>
      </tr>
      <tr>
        <td>There is no sensible default and every subclass must supply one</td>
        <td><code>abstract</code></td>
        <td>The compiler enforces completeness, and there is no base implementation to depend
        on.</td>
      </tr>
      <tr>
        <td>One member's behaviour must now be fixed, the rest stay open</td>
        <td><code>sealed override</code></td>
        <td>Closes one slot rather than the whole class.</td>
      </tr>
      <tr>
        <td>You want the derived type's callers to skip a cast</td>
        <td>Covariant return type</td>
        <td>The override may return a more derived type; base callers are unaffected.</td>
      </tr>
      <tr>
        <td>A hot loop calls a polymorphic member millions of times</td>
        <td>Hoist the choice out of the loop</td>
        <td>Select once, then loop over a concrete type. This is what fixed the incident above.</td>
      </tr>
      <tr>
        <td>You are tempted by <code>new</code></td>
        <td>Almost certainly something else</td>
        <td>It produces one object with two answers. Legitimate uses are rare and nearly always
        involve a base class you do not control.</td>
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
    <p>Give all five outputs, and explain why the last one contains both a correct and an incorrect
    piece of information.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>class Vehicle
{
    public virtual string Wheels() =&gt; "4";
    public string Describe() =&gt; $"{GetType().Name} with {Wheels()} wheels";
}
class Motorbike : Vehicle { public override string Wheels() =&gt; "2"; }
class Truck     : Vehicle { public new      string Wheels() =&gt; "6"; }

Vehicle[] vs = { new Vehicle(), new Motorbike(), new Truck() };
foreach (var v in vs) Console.WriteLine(v.Describe());
Console.WriteLine(new Truck().Wheels());
Console.WriteLine(new Truck().Describe());</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>Vehicle with 4 wheels
Motorbike with 2 wheels
Truck with 4 wheels
6
Truck with 4 wheels</code></pre>
        <p><code>Motorbike</code> used <code>override</code>, so its method took over the slot and
        <code>Describe</code> — which lives on <code>Vehicle</code> — reaches it.</p>
        <p><code>Truck</code> used <code>new</code>, so <code>Vehicle.Wheels</code> is still in the
        slot. <code>Describe</code> is compiled against <code>Vehicle</code> and calls the slot, so
        it gets 4. Calling <code>Wheels()</code> directly on a <code>Truck</code>-typed variable
        selects the hiding member and gets 6.</p>
        <p><strong>The last line is the interesting one:</strong> <code>Truck with 4 wheels</code>
        contains one fact resolved by <em>runtime</em> type and one by <em>static</em> type, in the
        same string. <code>GetType().Name</code> asks the object and correctly says
        <code>Truck</code>. <code>Wheels()</code> goes through the slot and says 4. A single line of
        output disagreeing with itself is the clearest possible symptom of hiding, and it is worth
        recognising because a bug report will phrase it as "it knows it's a truck but gets the
        wheels wrong".</p>
        <p>The fix is <code>override</code> instead of <code>new</code>. Note that omitting both
        keywords compiles with warning <code>CS0108</code> and behaves exactly as
        <code>new</code> does.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This is a middleware chain: each stage transforms the request and passes it on. Predict the
    output, then say which single design decision stops a stage from skipping the chain, and what
    would break if <code>Handle</code> were <code>virtual</code>.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>abstract class Middleware
{
    private Middleware? _next;
    public Middleware Then(Middleware next) { _next = next; return next; }
    public string Handle(string request)
    {
        var handled = Process(request);
        return _next is null ? handled : _next.Handle(handled);
    }
    protected abstract string Process(string request);
}

sealed class Upper : Middleware { protected override string Process(string r) =&gt; r.ToUpperInvariant(); }
sealed class Tag   : Middleware { protected override string Process(string r) =&gt; $"[{r}]"; }
sealed class Trim  : Middleware { protected override string Process(string r) =&gt; r.Trim(); }

var head = new Trim();
head.Then(new Upper()).Then(new Tag());
Console.WriteLine(head.Handle("  hello  "));</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>[HELLO]</code></pre>
        <p><code>Then</code> returns the stage it was given, so the chain builds as
        Trim → Upper → Tag rather than all three hanging off <code>Trim</code>. The request runs
        <code>"  hello  "</code> → trim → <code>"hello"</code> → upper → <code>"HELLO"</code> →
        tag → <code>"[HELLO]"</code>.</p>
        <p><strong>The decision that keeps the chain intact:</strong> <code>Handle</code> is
        <em>not</em> virtual. It owns the sequencing — call my stage, then pass the result to the
        next — and no subclass can change it. <code>Process</code> is <code>abstract</code>, so a
        stage supplies its transformation and nothing else. This is the template method shape
        again, and it is why a stage cannot accidentally return early, call the next stage twice,
        or pass the original request instead of the transformed one.</p>
        <p><strong>If <code>Handle</code> were virtual:</strong> a stage could override it and skip
        <code>_next</code> entirely, silently truncating the chain for every stage after it. Since
        <code>_next</code> is private, the base class could not detect it. That failure would look
        exactly like the fragile base class problem from
        <a href="#/m/t1-10-inheritance">Inheritance</a>: no exception, no error, and a stage that
        stops running with nothing reporting it.</p>
        <p>Worth noticing what this costs. Each stage is one polymorphic virtual call, so a chain
        of three costs roughly 7 ns more than three direct calls would. Against any real middleware
        stage — parsing, logging, an authorisation check — that is invisible. The measurement in
        this module is what tells you it is invisible rather than assuming it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A benchmark reports that a <code>sealed</code> class dispatches four times slower than an
    unsealed one. Explain why that result is almost certainly an artefact, name the mechanism, and
    describe the benchmark change that fixes it. Then say what a correct benchmark would actually
    show about <code>sealed</code>, and why.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Why it is an artefact.</strong> <code>sealed</code> can only ever remove work
        from dispatch — it gives the JIT strictly more information, and there is no mechanism by
        which knowing a type has no subclasses could make a call more expensive. A result showing
        it four times slower is measuring something other than what it claims.</p>
        <p><strong>The mechanism.</strong> Dynamic PGO. The runtime instruments each call site,
        observes which type arrives, and recompiles with a guarded fast path for that type — a type
        check, then inlined code for the expected type, then a fallback. The profile belongs to the
        <em>call site</em>, not to the type. If two scenarios share a loop method, they share a call
        site and therefore a profile. Whichever ran first trains the guard; the second then fails
        that check on every single iteration and pays the check plus the fallback. The label says
        "sealed" and the measurement says "guard misprediction".</p>
        <p><strong>The fix.</strong> Give every scenario its own loop method, so each has its own
        call site and its own profile. For comparisons that differ in <em>how many</em> types reach
        a site, go further and run them in separate processes, because a type that has been loaded
        and called anywhere can affect what the runtime is willing to assume. Add a control that
        runs the identical loop shape with a single type, so loop cost can be separated from
        dispatch cost. This module's benchmark does all three, and its first version did not —
        which is how the four-times-slower figure arose in the first place.</p>
        <p><strong>What a correct benchmark shows.</strong> On a hot monomorphic call site,
        <strong>no measurable difference</strong>: 117 and 97 ms sealed against 103 and 101 unsealed
        across two samples, which is noise. That is not because <code>sealed</code> does nothing,
        but because dynamic PGO had already devirtualised the call — there was nothing left to
        remove.</p>
        <p><code>sealed</code> still earns its place, for reasons a hot-loop benchmark is the wrong
        instrument to see. It lets the JIT devirtualise <em>statically</em>, with no profiling
        needed, so it helps code that runs thousands of times rather than millions — which is most
        code — and it helps under Native AOT, where there is no profiling step at all. The
        conclusion to carry: seal for the design reasons, and if you seal for performance, measure
        the actual workload rather than a micro-benchmark.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Predict all four outputs. Two of them are the same call with the same argument on the same
    object and produce different results. Explain the rule that decides, and say why adding the
    second method was a breaking change for existing callers even though nothing was removed.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>class Serialiser
{
    public virtual string Write(object o) =&gt; $"object:{o}";
}

class JsonSerialiser : Serialiser
{
    public override string Write(object o) =&gt; $"json:{o}";
    public string Write(string s) =&gt; $"json-string:{s}";
}

Serialiser s = new JsonSerialiser();
object boxed = "text";
string raw  = "text";

Console.WriteLine(s.Write(raw));
Console.WriteLine(((JsonSerialiser)s).Write(raw));
Console.WriteLine(((JsonSerialiser)s).Write(boxed));
Console.WriteLine(new JsonSerialiser().Write(raw));</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>json:text
json-string:text
json:text
json-string:text</code></pre>
        <p><strong>The rule.</strong> Two separate decisions happen, in this order:</p>
        <ol>
          <li><strong>Overload resolution</strong>, at compile time, using the <em>static</em> type
          of the receiver and of every argument. It picks <em>which member</em> is being
          called.</li>
          <li><strong>Virtual dispatch</strong>, at run time, using the <em>runtime</em> type of the
          receiver. It picks <em>which implementation</em> of that member runs.</li>
        </ol>
        <p>Line by line:</p>
        <div class="table-wrap">
        <table>
          <thead><tr><th>Call</th><th>Member chosen (compile time)</th><th>Implementation (run time)</th></tr></thead>
          <tbody>
            <tr><td><code>s.Write(raw)</code></td>
                <td><code>Serialiser.Write(object)</code> — the only one visible through a
                <code>Serialiser</code> reference</td>
                <td><code>JsonSerialiser.Write(object)</code> via the slot →
                <code>json:text</code></td></tr>
            <tr><td><code>((JsonSerialiser)s).Write(raw)</code></td>
                <td><code>Write(string)</code> — a better match than <code>Write(object)</code></td>
                <td>Not virtual; called directly → <code>json-string:text</code></td></tr>
            <tr><td><code>((JsonSerialiser)s).Write(boxed)</code></td>
                <td><code>Write(object)</code> — <code>boxed</code> is declared
                <code>object</code></td>
                <td>The override → <code>json:text</code></td></tr>
            <tr><td><code>new JsonSerialiser().Write(raw)</code></td>
                <td><code>Write(string)</code></td>
                <td>Direct → <code>json-string:text</code></td></tr>
          </tbody>
        </table>
        </div>
        <p>The third line is the one that pins the rule down: <code>boxed</code> and
        <code>raw</code> refer to the <em>same string object</em>, and the results differ. Nothing
        about the object decided it — only the declared type of the variable holding it.</p>
        <p><strong>Why adding <code>Write(string)</code> was a breaking change.</strong> Nothing was
        removed and no signature changed, so it is source- and binary-compatible in the sense of
        <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a>. But every
        existing call site holding a <code>JsonSerialiser</code> and passing a <code>string</code>
        was compiled against a version where <code>Write(object)</code> was the only candidate.
        Recompile and those call sites silently bind to the new method and produce different output
        — a <strong>behavioural</strong> break of the kind
        <a href="#/m/t1-10-inheritance">Inheritance</a> describes, triggered by a rebuild rather
        than prevented by one.</p>
        <p>Worse, it is inconsistent: callers holding a <code>Serialiser</code> reference keep the
        old behaviour, so the two halves of a codebase disagree depending on how each happened to
        declare its variable.</p>
        <p><strong>The fix</strong> is to not overload across an inheritance boundary on types
        related by conversion. Give it a different name — <code>WriteString</code> — so the choice
        is explicit at every call site, or make the specialised behaviour part of the virtual
        member by type-testing inside the override, so one member handles both and dispatch alone
        decides.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>Define static type and runtime type, and say which one decides each of: field access,
      virtual method call, overload resolution.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Static type</strong> is the type written in the declaration, known at compile
        time. <strong>Runtime type</strong> is the actual type of the object, available via
        <code>GetType()</code>. Field access: static. Overload resolution: static. Virtual method
        call: runtime. Everything in this module follows from that split.</p>
      </div></details>
    </li>
    <li>
      <p>What is physically at the start of every reference-type object, and how does a virtual
      call use it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A pointer to the type's <strong>method table</strong>, equal to
        <code>GetType().TypeHandle.Value</code>. A virtual call reads that pointer, indexes a fixed
        slot in the table, and jumps to the address there. Two reads and an indirect jump — the
        name is gone at compile time, so nothing is searched.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>override</code> do to the slot, and what does <code>new</code> do?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>override</code> replaces the base's entry in the existing slot, so all dispatch
        reaches it. <code>new</code> leaves the slot untouched and declares a separate,
        non-virtual member — reflection reports <code>IsVirtual=False</code>. Base-class code and
        base-typed references keep getting the base implementation.</p>
      </div></details>
    </li>
    <li>
      <p>Under what condition is a virtual call as fast as a non-virtual one, and what breaks
      it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the call site is <strong>monomorphic</strong> — only one runtime type ever reaches
        it — the JIT devirtualises and usually inlines, making it indistinguishable from a direct
        call. A second type reaching that site breaks it: the guard starts failing and, more
        expensively, the inlining that devirtualisation enabled is lost.</p>
      </div></details>
    </li>
    <li>
      <p>Roughly what did a polymorphic virtual call and a polymorphic interface call cost here,
      relative to the monomorphic case?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Monomorphic ≈ 1 ns per call. Polymorphic virtual ≈ 3.5 ns (about 3.5×). Polymorphic
        interface ≈ 5–6 ns (about 5–6×), because an interface call must locate where that
        interface's methods live for the specific type rather than reading a fixed slot.</p>
      </div></details>
    </li>
    <li>
      <p>In the rules-engine example, what fraction of the time was dispatch, and what does that
      tell you?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>About <strong>3%</strong> — 4 polymorphic calls at ~3 ns against 366 ns per validation.
        The same 3.5× multiplier is a rounding error there and the whole budget in a tight loop over
        ten million items. "Virtual calls are slow" is not usable in either direction without the
        call count.</p>
      </div></details>
    </li>
    <li>
      <p>Why did adding an unused second implementation of an interface slow down a hot path?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The call sites went from monomorphic to polymorphic, so the runtime could no longer
        assume a single target. The guarded fast path started failing, and the inlining that
        devirtualisation had enabled was lost for all calls, not only the 2% using the new type.
        The lost inlining was most of the cost.</p>
      </div></details>
    </li>
    <li>
      <p>How can you tell hiding from overriding without reading the source?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Print <code>GetType().Name</code> beside the result: if the runtime type is derived and
        the behaviour is the base's, it is hiding. Confirm with
        <code>GetType().GetMethod("Name").IsVirtual</code> — <code>False</code> means it never
        entered the slot — and <code>DeclaringType</code> to see which class the runtime will
        use.</p>
      </div></details>
    </li>
    <li>
      <p>Why does calling a virtual member from a constructor reach the derived override?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The method table pointer is written when the object is <em>allocated</em>, before any
        constructor runs. Dispatch is therefore fully operational throughout construction and lands
        in the most-derived override — while that class's constructor body has not executed yet.</p>
      </div></details>
    </li>
    <li>
      <p>What did the sealed measurement show, and what is the correct conclusion?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No measurable difference on a hot monomorphic call site, because dynamic PGO had already
        devirtualised it. <code>sealed</code> still lets the JIT devirtualise <em>statically</em>,
        without profiling, which helps code that runs thousands rather than millions of times and
        helps under Native AOT. Seal for design reasons; measure before claiming a speedup.</p>
      </div></details>
    </li>
    <li>
      <p>Two identical calls with the same argument on the same object gave different answers. What
      is the rule?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Overload resolution runs first, at compile time, from the <em>static</em> types of the
        receiver and arguments — it chooses <em>which member</em>. Virtual dispatch runs second, at
        run time, and chooses <em>which implementation</em> of that member. Different declared types
        at the two call sites selected different members before dispatch was ever involved.</p>
      </div></details>
    </li>
    <li>
      <p>Which axis of change favours virtual members, and which favours a <code>switch</code> over
      types?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>New <strong>types</strong> arriving regularly favours virtual or abstract members: each
        new type is a new file, and existing code is untouched. New <strong>operations</strong> over
        a fixed set of types favours a sealed hierarchy with <code>switch</code> patterns: each new
        operation is one method instead of an edit to every type.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
