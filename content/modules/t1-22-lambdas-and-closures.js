/* ============================================================================
   Track 1, Module 22 — Lambdas and Closures
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-22-lambdas-and-closures/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-22-lambdas-and-closures",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "A lambda is an ordinary method on a generated class. Capturing a variable moves that " +
    "variable off the stack and onto an object, which is why two lambdas can share it, why a " +
    "for-loop variable gives every lambda the same value, and why capture costs 88 bytes per " +
    "closure created — and why capturing a field silently keeps the whole object alive.",
  terms: [
    "lambda expression", "closure", "capture", "display class",
    "capture by variable", "static lambda", "this capture", "CS8820"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A loop builds three tasks, one per item, each capturing the item it should process. All three
  process the same item — the last one. The loop is correct, the tasks are correct, and the code
  reads exactly as intended.</p>

  <p>A service allocates 24 MB per request and the memory profiler names a type that appears
  nowhere in the source: <code>&lt;&gt;c__DisplayClass7_0</code>. Searching the codebase for it
  finds nothing.</p>

  <p>And a cache holding 50 KB per entry is never collected. Nothing references it — no field, no
  list, no static. The only thing that outlived it was a small callback registered somewhere else
  entirely, one line long, which mentions a single integer.</p>

  <p>All three are the same mechanism. <a href="#/m/t1-21-delegates">Delegates</a> ended by
  measuring that a capturing lambda allocates 88 bytes while a non-capturing one allocates nothing,
  and deferred the explanation. <strong>This module is that explanation</strong>: what the compiler
  builds when a lambda mentions a variable from outside itself, and what that construction does to
  values, to memory, and to object lifetime.</p>
</section>

<section id="what-a-lambda-is">
  <h2>What a lambda actually compiles to</h2>

  <p class="define"><span class="define__term">Lambda expression</span> An unnamed method written
  inline — <code>x =&gt; x * 2</code>. The compiler turns it into a real method with a generated
  name and takes a delegate to it. It is not a runtime construct; by the time the code runs there
  are only ordinary methods and ordinary objects.</p>

  <p class="define"><span class="define__term">Capture</span> A lambda referring to a variable
  declared outside itself. <span class="define__term">Closure</span> is the result: the lambda
  together with the captured variables it needs, which must now outlive the method they were
  declared in.</p>

  <p>The word "closure" is often used loosely for "a lambda". The distinction that matters here is
  that <strong>a lambda which captures nothing is not a closure</strong>, costs nothing, and is
  created once — while a lambda that captures is a lambda plus an object, created every time
  control passes through it.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-the-closure-class.cs"><code>// 01-the-closure-class.cs — a lambda is an ordinary method on a generated
// class. Capturing a variable means that variable MOVES onto an object.
// .NET 10.0.400. Run: dotnet run 01-the-closure-class.cs

#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Linq;
using System.Reflection;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- three lambdas, three different generated shapes ---");

        Func&lt;int, int&gt; capturesNothing = x =&gt; x * 2;

        int factor = 3;
        Func&lt;int, int&gt; capturesLocal = x =&gt; x * factor;

        var helper = new Helper(4);
        Func&lt;int, int&gt; capturesThis = helper.Multiply;

        foreach (var (name, d) in new (string, Func&lt;int, int&gt;)[]
                 { ("captures nothing", capturesNothing),
                   ("captures a local", capturesLocal),
                   ("instance method", capturesThis) })
        {
            Console.WriteLine($"  {name,-18} Method={d.Method.Name,-22} " +
                              $"Target={d.Target?.GetType().Name ?? "null"}");
        }

        Console.WriteLine();
        Console.WriteLine("--- what the compiler generated in this assembly ---");
        var generated = typeof(Program).Assembly.GetTypes()
            .Where(t =&gt; t.Name.Contains("&lt;&gt;"))
            .OrderBy(t =&gt; t.Name);
        foreach (var t in generated)
        {
            Console.WriteLine($"  {t.Name}");
            foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.NonPublic |
                                          BindingFlags.Instance | BindingFlags.Static))
                Console.WriteLine($"      field  {f.FieldType.Name,-16} {f.Name}");
            foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.NonPublic |
                                           BindingFlags.Instance | BindingFlags.DeclaredOnly))
                Console.WriteLine($"      method {m.ReturnType.Name,-16} {m.Name}");
        }

        Console.WriteLine();
        Console.WriteLine("  The class holding a captured variable is named &lt;&gt;c__DisplayClass...");
        Console.WriteLine("  and has a FIELD for each captured variable. The one for lambdas");
        Console.WriteLine("  that capture nothing is named &lt;&gt;c and its delegate is cached in a");
        Console.WriteLine("  static field, which is why it allocates once and never again.");

        Console.WriteLine();
        Console.WriteLine("--- capture is BY VARIABLE, not by value ---");
        int counter = 0;
        Func&lt;int&gt; read = () =&gt; counter;
        Action bump = () =&gt; counter++;

        Console.WriteLine($"  read() before        : {read()}");
        counter = 10;
        Console.WriteLine($"  after counter = 10   : {read()}");
        bump();
        Console.WriteLine($"  after bump()         : {read()}  and counter is {counter}");
        Console.WriteLine("  Both lambdas and the method body share ONE variable, which now");
        Console.WriteLine("  lives on the display class rather than on the stack.");
    }
}

sealed class Helper
{
    private readonly int _factor;
    public Helper(int factor) =&gt; _factor = factor;
    public int Multiply(int x) =&gt; x * _factor;
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- three lambdas, three different generated shapes ---
  captures nothing   Method=&lt;Main&gt;b__0_0         Target=&lt;&gt;c
  captures a local   Method=&lt;Main&gt;b__1           Target=&lt;&gt;c__DisplayClass0_0
  instance method    Method=Multiply             Target=Helper

--- what the compiler generated in this assembly ---
  &lt;&gt;c
      field  &lt;&gt;c              &lt;&gt;9
      field  Func&amp;#96;2           &lt;&gt;9__0_0
      field  Func&amp;#96;2           &lt;&gt;9__0_2
      field  Func&amp;#96;2           &lt;&gt;9__0_3
      method Int32            &lt;Main&gt;b__0_0
      method Boolean          &lt;Main&gt;b__0_2
      method String           &lt;Main&gt;b__0_3
  &lt;&gt;c__DisplayClass0_0
      field  Int32            factor
      field  Int32            counter
      method Int32            &lt;Main&gt;b__1
      method Int32            &lt;Main&gt;b__4
      method Void             &lt;Main&gt;b__5

--- capture is BY VARIABLE, not by value ---
  read() before        : 0
  after counter = 10   : 10
  after bump()         : 11  and counter is 11</code></pre>

  <p>The two generated classes are the whole mechanism, and they are visibly different things.</p>

  <p class="define"><span class="define__term">Display class</span> The compiler-generated class
  named <code>&lt;&gt;c__DisplayClass…</code> that holds captured variables as fields. One is
  created per <em>scope</em> that has captures, not per lambda and not per captured variable.</p>

  <p><strong><code>&lt;&gt;c</code> is the cache for lambdas that capture nothing.</strong> It has
  a static field <code>&lt;&gt;9</code> holding a single instance of itself, and a static field per
  lambda — <code>&lt;&gt;9__0_0</code> and so on — holding the delegate. The first time such a
  lambda is reached the delegate is created and stored; every later use reads the field. That is
  why the measurement in the previous module showed zero allocation.</p>

  <p><strong><code>&lt;&gt;c__DisplayClass0_0</code> holds the captured variables.</strong> Look at
  its fields: <code>factor</code> and <code>counter</code>, the two locals that lambdas in that
  scope referred to. Those variables are <em>not on the stack any more</em>. The compiler rewrote
  the enclosing method so that every read and write of <code>factor</code>, including in the
  method's own body, goes through a field on this object.</p>

  <p class="define"><span class="define__term">Capture by variable</span> The consequence:
  a lambda captures the <em>variable</em>, not a snapshot of its value. The output shows
  <code>read()</code> returning 0, then 10 after an assignment made outside the lambda, then 11
  after a different lambda incremented it. One variable, three pieces of code, all sharing the
  object it now lives on.</p>

  <p>That is the single most important sentence in this module, and it explains all three incidents
  at the top. It is also, taken on its own, a feature: it is what lets a lambda accumulate state,
  and what makes a callback see the current value rather than a stale one.</p>
</section>

<section id="loop-capture">
  <h2>The loop variable</h2>

  <pre data-lang="csharp" data-net="10" data-title="02-loop-capture.cs"><code>// 02-loop-capture.cs — the most-reported closure bug, and why C# 5 fixed half
// of it and deliberately left the other half alone.
// .NET 10.0.400. Run: dotnet run 02-loop-capture.cs

using System;
using System.Collections.Generic;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- foreach: each iteration gets its OWN variable (since C# 5) ---");
        var fromForeach = new List&lt;Func&lt;string&gt;&gt;();
        foreach (var name in new[] { "alpha", "beta", "gamma" })
            fromForeach.Add(() =&gt; name);
        Console.WriteLine($"  {string.Join(", ", fromForeach.ConvertAll(f =&gt; f()))}");

        Console.WriteLine();
        Console.WriteLine("--- for: ONE variable shared by every iteration ---");
        var fromFor = new List&lt;Func&lt;int&gt;&gt;();
        for (int i = 0; i &lt; 3; i++)
            fromFor.Add(() =&gt; i);
        Console.WriteLine($"  {string.Join(", ", fromFor.ConvertAll(f =&gt; f()))}");
        Console.WriteLine("  All three read the same i, which is 3 by the time they run.");

        Console.WriteLine();
        Console.WriteLine("--- the fix: copy into a variable scoped to the iteration ---");
        var fixedUp = new List&lt;Func&lt;int&gt;&gt;();
        for (int i = 0; i &lt; 3; i++)
        {
            int copy = i;
            fixedUp.Add(() =&gt; copy);
        }
        Console.WriteLine($"  {string.Join(", ", fixedUp.ConvertAll(f =&gt; f()))}");

        Console.WriteLine();
        Console.WriteLine("--- why for was left alone: the loop variable is meant to be shared ---");
        int shared = 0;
        Action increment = () =&gt; shared++;
        for (int i = 0; i &lt; 3; i++) increment();
        Console.WriteLine($"  a lambda mutating an outer variable across iterations: {shared}");
        Console.WriteLine("  Changing 'for' semantics would have broken code like this, so the");
        Console.WriteLine("  language changed only 'foreach', where a per-iteration variable is");
        Console.WriteLine("  what everyone already expected.");

        Console.WriteLine();
        Console.WriteLine("--- the same trap with tasks, which is where it usually bites ---");
        var results = new List&lt;string&gt;();
        var actions = new List&lt;Action&gt;();
        for (int i = 0; i &lt; 3; i++)
            actions.Add(() =&gt; results.Add($"for-{i}"));
        foreach (var a in actions) a();
        Console.WriteLine($"  captured by 'for'     : {string.Join(", ", results)}");

        results.Clear();
        actions.Clear();
        foreach (var i in new[] { 0, 1, 2 })
            actions.Add(() =&gt; results.Add($"foreach-{i}"));
        foreach (var a in actions) a();
        Console.WriteLine($"  captured by 'foreach' : {string.Join(", ", results)}");

        Console.WriteLine();
        Console.WriteLine("--- static lambdas refuse to capture at all ---");
        int outer = 5;
        Func&lt;int, int&gt; nonCapturing = static x =&gt; x * 2;
        Console.WriteLine($"  static lambda works   : {nonCapturing(21)}");
        Console.WriteLine("  'static x =&gt; x * outer' does not compile — CS8820. The keyword");
        Console.WriteLine("  turns an accidental capture into a compile error.");
        Console.WriteLine($"  (outer is {outer}, and the static lambda cannot see it)");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- foreach: each iteration gets its OWN variable (since C# 5) ---
  alpha, beta, gamma

--- for: ONE variable shared by every iteration ---
  3, 3, 3
  All three read the same i, which is 3 by the time they run.

--- the fix: copy into a variable scoped to the iteration ---
  0, 1, 2

--- why for was left alone: the loop variable is meant to be shared ---
  a lambda mutating an outer variable across iterations: 3

--- the same trap with tasks, which is where it usually bites ---
  captured by 'for'     : for-3, for-3, for-3
  captured by 'foreach' : foreach-0, foreach-1, foreach-2

--- static lambdas refuse to capture at all ---
  static lambda works   : 42
  'static x =&gt; x * outer' does not compile — CS8820. The keyword
  turns an accidental capture into a compile error.</code></pre>

  <p><strong><code>for</code> gives <code>3, 3, 3</code>; <code>foreach</code> gives
  <code>0, 1, 2</code>.</strong> This is not an inconsistency — it follows exactly from capture
  being by variable.</p>

  <p>A <code>for</code> loop declares <code>i</code> <em>once</em>, before the loop, and mutates it.
  All three lambdas capture that one variable, which lives on one display class. By the time any of
  them runs, the loop has finished and the shared variable holds 3.</p>

  <p>A <code>foreach</code> loop declares its variable <em>inside</em> the loop body, conceptually
  fresh on each iteration. Each lambda captures a different variable on a different display class,
  so each sees its own value.</p>

  <div class="callout callout--note">
    <p><strong>This is a language change with a history worth knowing.</strong> Before C# 5,
    <code>foreach</code> behaved like <code>for</code> — one shared variable, and
    <code>alpha, beta, gamma</code> would have printed <code>gamma, gamma, gamma</code>. It was
    changed because that behaviour was almost never what anyone wanted from a
    <code>foreach</code>. <code>for</code> was deliberately left alone: its variable is meant to be
    shared and mutated, and the fourth block shows code that depends on it. So the asymmetry is a
    considered decision, not an oversight — and it means the trap survives in exactly one
    construct.</p>
  </div>

  <p><strong>The fix is one line: copy into a variable declared inside the loop.</strong> That gives
  each iteration its own variable, its own display class, and its own captured value. Note this
  costs an allocation per iteration, which is the correct price for wanting per-iteration state.</p>

  <p class="define"><span class="define__term">Static lambda</span> A lambda marked
  <code>static</code>, which the compiler forbids from capturing anything — including
  <code>this</code>. Attempting to capture is <code>CS8820</code>. It is the cheapest available
  guard against accidental capture: on a hot path, writing <code>static</code> turns an invisible
  allocation into a compile error.</p>
</section>

<section id="allocation">
  <h2>What capture costs, and where</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-allocation.cs"><code>// 03-allocation.cs — what capture costs, where the cost lands, and the capture
// that keeps a whole object alive without naming it.
// .NET 10.0.400, Release. Run: dotnet run 03-allocation.cs -c Release

using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;

class Program
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Use(Func&lt;int, int&gt; f) =&gt; f(1);

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Use2(Func&lt;int, int, int&gt; f) =&gt; f(1, 2);

    static void Report(string label, Action body)
    {
        for (int i = 0; i &lt; 200; i++) body();
        long before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i &lt; 1000; i++) body();
        long bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
        Console.WriteLine($"  {label,-46} {bytes,8:N0} bytes / 1,000");
    }

    static void Main()
    {
        Console.WriteLine("--- what each shape allocates ---");
        Report("captures nothing", () =&gt; Use(x =&gt; x &amp; 7));
        Report("static method group", () =&gt; Use(Square));

        int outerFixed = 7;
        Report("captures a local declared outside the loop", () =&gt; Use(x =&gt; x &amp; outerFixed));

        Report("captures a local declared inside the loop", () =&gt;
        {
            int inner = Environment.TickCount;
            Use(x =&gt; x &amp; inner);
        });

        Report("captures two locals", () =&gt;
        {
            int a = Environment.TickCount, b = a + 1;
            Use2((x, y) =&gt; (x &amp; a) + (y &amp; b));
        });

        Console.WriteLine();
        Console.WriteLine("  A closure is ONE object per scope, not one per captured variable:");
        Console.WriteLine("  capturing two locals from the same scope costs one display class");
        Console.WriteLine("  with two fields, plus one delegate.");

        Console.WriteLine();
        Console.WriteLine("--- passing the value instead of capturing it ---");
        Report("captures the value", () =&gt;
        {
            int inner = Environment.TickCount;
            Use(x =&gt; x &amp; inner);
        });
        Report("takes the value as an argument", () =&gt;
        {
            int inner = Environment.TickCount;
            UseWithState(static (x, s) =&gt; x &amp; s, inner);
        });

        Console.WriteLine();
        Console.WriteLine("--- capturing 'this' by accident ---");
        var holder = new Holder(99);
        Func&lt;int, int&gt; viaField = holder.MakeCapturingField();
        Func&lt;int, int&gt; viaLocal = holder.MakeCapturingLocal();

        Console.WriteLine($"  lambda using a FIELD  -&gt; Target is {viaField.Target?.GetType().Name}");
        Console.WriteLine($"  lambda using a LOCAL  -&gt; Target is {viaLocal.Target?.GetType().Name}");
        Console.WriteLine("  The first captured 'this', so the delegate keeps the whole Holder");
        Console.WriteLine("  alive. The second copied the field into a local first, so it keeps");
        Console.WriteLine("  only an int alive.");

        var weak = MakeAndDrop(out Func&lt;int, int&gt; keptAlive);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        Console.WriteLine($"  after a full GC, the captured Holder is still alive : {weak.IsAlive}");
        GC.KeepAlive(keptAlive);

        var weak2 = MakeAndDropLocal(out Func&lt;int, int&gt; keptAlive2);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        Console.WriteLine($"  with only the int captured, the Holder is collected  : {!weak2.IsAlive}");
        GC.KeepAlive(keptAlive2);
    }

    static int Square(int x) =&gt; x &amp; 7;

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int UseWithState(Func&lt;int, int, int&gt; f, int state) =&gt; f(1, state);

    static WeakReference MakeAndDrop(out Func&lt;int, int&gt; kept)
    {
        var h = new Holder(1);
        kept = h.MakeCapturingField();
        return new WeakReference(h);
    }

    static WeakReference MakeAndDropLocal(out Func&lt;int, int&gt; kept)
    {
        var h = new Holder(1);
        kept = h.MakeCapturingLocal();
        return new WeakReference(h);
    }
}

sealed class Holder
{
    private readonly int _value;
    private readonly byte[] _ballast = new byte[10_000];
    public Holder(int value) =&gt; _value = value;

    // Uses a field, so the lambda captures 'this'.
    public Func&lt;int, int&gt; MakeCapturingField() =&gt; x =&gt; x + _value;

    // Copies the field into a local first, so only the int is captured.
    public Func&lt;int, int&gt; MakeCapturingLocal()
    {
        int local = _value;
        return x =&gt; x + local;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- what each shape allocates ---
  captures nothing                                      0 bytes / 1,000
  static method group                                   0 bytes / 1,000
  captures a local declared outside the loop            0 bytes / 1,000
  captures a local declared inside the loop        88,000 bytes / 1,000
  captures two locals                              88,000 bytes / 1,000

--- passing the value instead of capturing it ---
  captures the value                               88,000 bytes / 1,000
  takes the value as an argument                        0 bytes / 1,000

--- capturing 'this' by accident ---
  lambda using a FIELD  -&gt; Target is Holder
  lambda using a LOCAL  -&gt; Target is &lt;&gt;c__DisplayClass4_0
  after a full GC, the captured Holder is still alive : True
  with only the int captured, the Holder is collected  : True</code></pre>

  <p>Four readings, in order of how often they matter.</p>

  <p><strong>Capture costs per <em>creation</em>, not per call.</strong> Capturing a local declared
  <em>outside</em> the measuring loop allocated nothing across a thousand iterations — the closure
  was built once, before the loop, and reused. Capturing one declared <em>inside</em> allocated
  88,000 bytes, because each iteration needed its own. The lambda text is nearly identical in both
  cases; the scope of the captured variable is what decides.</p>

  <p>So the question to ask of any capturing lambda is never "does this capture" but
  <strong>"how often is this closure created"</strong>. Once at startup is free. Once per request
  is almost always fine. Once per element in a loop over a million rows is 120 MB.</p>

  <p><strong>A closure is one object per scope, not per variable.</strong> Capturing two locals cost
  the same 88,000 bytes as capturing one — one display class with two fields, plus one delegate.
  That also means capturing one variable from a scope that has three captured variables drags all
  three along, because they share the object.</p>

  <p><strong>Passing state as an argument removes the allocation entirely.</strong> The same value,
  the same work, and zero bytes — because a <code>static</code> lambda taking the state as a
  parameter captures nothing and is therefore cached. Several base class library APIs exist
  specifically to allow this shape, taking a state argument alongside the callback.</p>

  <p class="define"><span class="define__term">this capture</span> A lambda that mentions an
  instance field or method captures <code>this</code> — the whole enclosing object — rather than
  the field. The output shows it plainly: the lambda using a field has
  <code>Target = Holder</code>, while the one that copied the field into a local first has
  <code>Target = &lt;&gt;c__DisplayClass4_0</code>.</p>

  <p><strong>That difference is a lifetime difference, and the GC proves it.</strong> After a full
  collection, the <code>Holder</code> captured through a field was <em>still alive</em>; the one
  whose lambda captured only a copied <code>int</code> was collected. The delegate is a root, and
  what it roots depends on one word in the lambda body.</p>

  <div class="callout callout--warn">
    <p><strong>This is the third incident from the top of the module.</strong> A one-line callback
    mentioning a single integer — <code>() =&gt; _pageSize</code> — captures <code>this</code>, and
    keeps the entire object alive for as long as the callback lives. If that object holds a 50 KB
    buffer, or a database connection, or a reference to a whole object graph, all of it stays. The
    source gives no hint: the lambda names one <code>int</code>.</p>
  </div>
</section>

<section id="production-example">
  <h2>Closures in a request path</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>// 04-production.cs — closures in a request-handling path: where they help,
// where they allocate, and how to keep the allocation off the hot loop.
// .NET 10.0.400, Release. Run: dotnet run 04-production.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

public readonly record struct Order(string Id, string Region, decimal Amount, int Items);

public sealed class OrderFilters
{
    // Built ONCE per configuration, not per request. The captures happen here.
    private readonly Func&lt;Order, bool&gt; _predicate;
    public string Description { get; }

    private OrderFilters(Func&lt;Order, bool&gt; predicate, string description)
        =&gt; (_predicate, Description) = (predicate, description);

    public static OrderFilters Build(string region, decimal minimum, int maxItems)
    {
        // Three captures, one display class, one delegate — created once.
        Func&lt;Order, bool&gt; p = o =&gt;
            string.Equals(o.Region, region, StringComparison.Ordinal)
            &amp;&amp; o.Amount &gt;= minimum
            &amp;&amp; o.Items &lt;= maxItems;

        return new OrderFilters(p, $"{region}, &gt;= {minimum:0.00}, &lt;= {maxItems} items");
    }

    public bool Matches(Order order) =&gt; _predicate(order);

    public int CountMatching(IReadOnlyList&lt;Order&gt; orders)
    {
        int n = 0;
        for (int i = 0; i &lt; orders.Count; i++) if (_predicate(orders[i])) n++;
        return n;
    }
}

class Program
{
    static void Main()
    {
        var regions = new[] { "eu-west", "us-east", "ap-south" };
        var orders = Enumerable.Range(0, 200_000)
            .Select(i =&gt; new Order($"O-{i}", regions[i % 3], i % 500, i % 20))
            .ToArray();

        var filter = OrderFilters.Build("eu-west", 100m, 10);
        Console.WriteLine($"filter: {filter.Description}");
        Console.WriteLine($"matches: {filter.CountMatching(orders):N0} of {orders.Length:N0}");

        Console.WriteLine();
        Console.WriteLine("--- closure built once, used many times ---");
        Measure("prebuilt filter, 20 passes", () =&gt;
        {
            int n = 0;
            for (int pass = 0; pass &lt; 20; pass++) n += filter.CountMatching(orders);
            return n;
        });

        Console.WriteLine();
        Console.WriteLine("--- the same work, rebuilding the closure every pass ---");
        Measure("filter rebuilt each pass, 20 passes", () =&gt;
        {
            int n = 0;
            for (int pass = 0; pass &lt; 20; pass++)
                n += OrderFilters.Build("eu-west", 100m, 10).CountMatching(orders);
            return n;
        });
        Console.WriteLine("  Almost identical — 20 extra closures is nothing against 4,000,000");
        Console.WriteLine("  predicate calls. Building a closure per REQUEST is fine.");

        Console.WriteLine();
        Console.WriteLine("--- but rebuilding it INSIDE the loop is not ---");
        Measure("closure rebuilt per element, 1 pass", () =&gt;
        {
            int n = 0;
            for (int i = 0; i &lt; orders.Length; i++)
            {
                var o = orders[i];
                Func&lt;Order, bool&gt; perElement = x =&gt; x.Region == o.Region &amp;&amp; x.Amount &gt;= 100m;
                if (perElement(o)) n++;
            }
            return n;
        });
        Console.WriteLine("  One closure per element. This is the shape that shows up in a");
        Console.WriteLine("  memory profile as &lt;&gt;c__DisplayClass at the top of the list.");
    }

    static void Measure(string label, Func&lt;int&gt; body)
    {
        body();
        double best = double.MaxValue;
        long bytes = 0;
        for (int r = 0; r &lt; 3; r++)
        {
            long before = GC.GetTotalAllocatedBytes(precise: true);
            var sw = Stopwatch.StartNew();
            int v = body();
            sw.Stop();
            if (v == 0) throw new Exception("nothing matched");
            bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-40} {best,7:F1} ms   {bytes,12:N0} bytes");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>filter: eu-west, &gt;= 100.00, &lt;= 10 items
matches: 29,333 of 200,000

--- closure built once, used many times ---
  prebuilt filter, 20 passes                  68.1 ms             40 bytes

--- the same work, rebuilding the closure every pass ---
  filter rebuilt each pass, 20 passes         58.0 ms          5,320 bytes
  Almost identical — 20 extra closures is nothing against 4,000,000
  predicate calls. Building a closure per REQUEST is fine.

--- but rebuilding it INSIDE the loop is not ---
  closure rebuilt per element, 1 pass          6.8 ms     24,000,040 bytes
  One closure per element. This is the shape that shows up in a
  memory profile as &lt;&gt;c__DisplayClass at the top of the list.</code></pre>

  <p>The three rows are a decision procedure.</p>

  <p><strong>Twenty closures against four million calls is nothing</strong> — 5,320 bytes, and the
  timings are indistinguishable. A closure built per request, per batch, or per configuration change
  is not worth a moment's thought.</p>

  <p><strong>Two hundred thousand closures is 24 MB from one line.</strong> The lambda inside the
  loop is the same shape as the one outside it; only its position differs. At 120 bytes per element
  it is one of the easiest ways to produce sustained gen0 pressure without writing
  <code>new</code>.</p>

  <p>The design that makes this manageable is visible in <code>OrderFilters</code>: the captures
  happen in a factory method called once, the resulting delegate is stored in a field, and the hot
  loop only invokes it. That is the general shape — <strong>push closure creation up and out of
  loops</strong>, so the allocation happens at configuration time rather than per item.</p>

  <div class="callout callout--gotcha">
    <p><strong>A LINQ query in a loop is this bug wearing different clothes.</strong>
    <code>orders.Where(o =&gt; o.Region == region)</code> written inside a per-element loop creates
    a closure per element exactly as the example does, plus the iterator objects LINQ itself needs.
    <a href="#/m/t1-25-deferred-execution">Deferred Execution and the Cost of LINQ</a> measures the
    whole picture; the closure is the part that belongs to this module.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Capturing a for-loop variable</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: all three tasks see the same value"><code>// WRONG. One variable i, captured by all three lambdas, holding 3 by the time
// any of them runs.
var tasks = new List&lt;Action&gt;();
for (int i = 0; i &lt; 3; i++)
    tasks.Add(() =&gt; Process(items[i]));      // every task processes items[3]

// Right: a variable per iteration.
for (int i = 0; i &lt; 3; i++)
{
    int index = i;
    tasks.Add(() =&gt; Process(items[index]));
}</code></pre>

  <p>Measured: <code>3, 3, 3</code> against <code>0, 1, 2</code>. Worse in the real case, because
  <code>items[3]</code> is out of range and the failure is an
  <code>IndexOutOfRangeException</code> from a loop that plainly runs three times.</p>

  <h3>2. Creating a closure per element</h3>

  <p>24 MB for 200,000 elements, measured. The lambda looks identical to a hoisted one; only its
  position differs. In a profile it appears as <code>&lt;&gt;c__DisplayClass…</code>, a type name
  that cannot be found by searching the source.</p>

  <h3>3. Capturing <code>this</code> without meaning to</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: one int, whole object retained"><code>// WRONG. Mentioning _pageSize captures 'this', so the delegate keeps the
// entire Repository — and its 50 KB buffer — alive for as long as it lives.
public Func&lt;int&gt; GetPageSizeAccessor() =&gt; () =&gt; _pageSize;

// Right: copy to a local first, and capture only that.
public Func&lt;int&gt; GetPageSizeAccessor()
{
    int size = _pageSize;
    return () =&gt; size;
}</code></pre>

  <p>Verified with a weak reference: the field version survived a full GC, the local version did
  not.</p>

  <h3>4. Assuming capture takes a snapshot</h3>

  <p>It does not. A lambda built inside a method and invoked later sees whatever the variable holds
  <em>then</em>, including changes made by the enclosing method after the lambda was created. That
  is deliberate and occasionally exactly what you want; it is a defect whenever the lambda was
  meant to record a value.</p>

  <h3>5. Capturing more than intended from a shared scope</h3>

  <p>One display class per scope means capturing a small variable from a scope that also captures a
  large object keeps the large object alive too. Splitting the work into a smaller method, so the
  captured scope contains only what is needed, is the fix — and it is invisible without knowing the
  mechanism.</p>

  <h3>6. Reaching for a closure where a parameter would do</h3>

  <p>Measured: capturing the value cost 88 bytes per creation; taking it as a parameter to a
  <code>static</code> lambda cost zero. Several base class library methods offer a state-taking
  overload for exactly this reason.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>A type named <code>&lt;&gt;c__DisplayClass…</code> is high in an allocation
    profile.</strong> That is a closure, and the number in the name identifies the method and scope
    it came from — <code>&lt;&gt;c__DisplayClass7_0</code> is the first captured scope of the eighth
    lambda-containing method in that class. Most profilers show the declaring type, which narrows
    it to one file. Then look for a capturing lambda inside a loop or a per-item call.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Several callbacks that should differ all behave identically.</strong> Look for a
    <code>for</code> loop. Print the captured value at creation time and at invocation time — if
    creation shows <code>0, 1, 2</code> and invocation shows <code>3, 3, 3</code>, one variable is
    shared. The fix is a per-iteration copy; the diagnosis is that the two printouts disagree.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>An object is retained and nothing appears to reference it.</strong> Check the
    delegates that outlive it. <code>someDelegate.Target?.GetType().Name</code> tells you what the
    lambda actually captured: the type itself means <code>this</code> was captured;
    <code>&lt;&gt;c__DisplayClass…</code> means only locals were. In a memory dump, the retention
    path runs through the display class or through the object itself as the delegate's target.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Proving a lifetime claim rather than arguing about it.</strong> Create the object in
    a method, take a <code>WeakReference</code> to it, let the method return, force
    <code>GC.Collect()</code> twice with a
    <code>WaitForPendingFinalizers</code> between, and read <code>IsAlive</code>. That is what this
    module does, and it turns "I think this leaks" into a boolean.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Preventing the whole category while writing.</strong> Mark hot-path lambdas
    <code>static</code>. If it compiles, nothing was captured and nothing is allocated per call. If
    it does not (<code>CS8820</code>), the error names exactly what you were capturing — which is
    the information you wanted anyway, delivered at compile time instead of in a profile.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>A concrete case.</strong> A document-processing service held a
    <code>DocumentContext</code> per job: parsed content, a 40 MB rendered page buffer, and a
    handle to the source stream. Jobs completed in a few seconds and the context was expected to be
    collected immediately afterwards.</p>
    <p>A progress-reporting feature was added. The job registered a callback with a long-lived
    progress tracker so a dashboard could poll it:
    <code>tracker.Register(jobId, () =&gt; _pagesDone);</code> — one line, returning one integer.</p>
    <p><code>_pagesDone</code> is a field, so the lambda captured <code>this</code>: the whole
    <code>DocumentContext</code>, including the 40 MB buffer. The tracker kept registrations for 24
    hours for the dashboard's history view. So every job's full context stayed alive for a day.</p>
    <p>At roughly 400 jobs an hour the service went from a steady 300 MB working set to filling
    16 GB in about four hours, then spending most of its CPU in gen2 collections trying to reclaim
    memory that was genuinely reachable. It was diagnosed as a leak in the rendering code, because
    that is what the buffers belonged to, and two weeks were spent there.</p>
    <p>What found it was a memory dump: the retention path for every buffer ran
    <em>context → delegate → tracker</em>. The context was not leaking; it was being held by a
    callback that, read on the page, mentions nothing but an integer.</p>
    <p>The fix was three lines — copy <code>_pagesDone</code> into a local and capture that instead,
    which meant the callback could no longer report live progress, so the design changed to have the
    job push updates to the tracker rather than the tracker pull from the job. Working set returned
    to 300 MB and stayed there.</p>
  </div>

  <p>The general principle: <strong>a lambda's source text does not tell you what it holds
  onto.</strong> <code>() =&gt; _pagesDone</code> looks like it captures an <code>int</code>. It
  captures the object the field lives on, and everything that object references. The only reliable
  signal is the rule — <em>mentioning any instance member captures <code>this</code></em> — and the
  only reliable check is <code>Target</code> at run time.</p>

  <p>The reason this matters more than most allocation questions is the timescale. A closure created
  in a loop produces garbage that dies immediately, which the collector handles cheaply. A closure
  that captures <code>this</code> and is stored somewhere long-lived produces objects that
  <em>survive</em>, get promoted to gen2, and make every subsequent full collection more expensive
  for the whole process. The 88 bytes are rarely the problem; what those 88 bytes are attached to
  can be.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"A lambda captures the value of the variable."</strong> It captures the
    <em>variable</em>. The measurement shows a lambda returning 0, then 10 after an outside
    assignment, then 11 after another lambda incremented it. The variable moves onto a display
    class and everything that referred to it — including the enclosing method — now shares that
    object.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>foreach</code> and <code>for</code> capture the same way."</strong>
    Measured: <code>0, 1, 2</code> against <code>3, 3, 3</code>. <code>foreach</code> declares a
    fresh variable per iteration (since C# 5); <code>for</code> declares one and mutates it. The
    difference was a deliberate language change, applied to <code>foreach</code> only because
    <code>for</code>'s variable is meant to be shared.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Lambdas allocate."</strong> Only capturing ones, and only when created. A
    non-capturing lambda is cached in a static field on <code>&lt;&gt;c</code> and allocates once
    for the life of the process — verified at zero bytes per thousand uses. So does a static method
    group conversion.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Capturing two variables costs twice as much."</strong> It costs the same: one
    display class per <em>scope</em>, with a field per variable, plus one delegate. The corollary is
    less comfortable — capturing one variable from a scope also keeps every other captured variable
    in that scope alive.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Capturing a field captures the field."</strong> It captures <code>this</code>.
    Mentioning any instance member — a field, a property, a method — makes the whole enclosing
    object the delegate's target. Proven here with a weak reference: the object survived a full
    collection.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Closure allocation is a micro-optimisation."</strong> Per request it is. Per
    element it was 24 MB for one pass over 200,000 items. And a captured <code>this</code> stored
    somewhere long-lived is not an allocation problem at all — it is a retention problem, which
    costs far more than the bytes.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>A lambda on a hot path</td><td>Mark it <code>static</code></td>
          <td>If it compiles, nothing is captured and nothing is allocated per call.</td></tr>
      <tr><td>A lambda needs a value from the caller</td><td>Pass it as a parameter, not a
          capture</td>
          <td>88 bytes per creation against zero, measured.</td></tr>
      <tr><td>A closure used many times</td><td>Build it once and store it</td>
          <td>Cost is per creation. A field-held delegate is created once.</td></tr>
      <tr><td>Capturing inside a loop</td><td>Hoist it above the loop if the captured values do not
          change</td>
          <td>24 MB against 40 bytes for 200,000 elements.</td></tr>
      <tr><td>Capturing a <code>for</code> variable</td><td>Copy into a variable declared inside the
          loop</td>
          <td>Otherwise every lambda shares one variable and sees its final value.</td></tr>
      <tr><td>A lambda that mentions a field</td><td>Copy the field to a local first if the delegate
          outlives the object</td>
          <td>Mentioning a field captures <code>this</code> and everything it holds.</td></tr>
      <tr><td>A long-lived callback registry</td><td>Prefer push over pull, or capture only
          values</td>
          <td>A stored callback roots its target for as long as the registry lives.</td></tr>
      <tr><td>The callback needs live state</td><td>Capture deliberately, and document the
          lifetime</td>
          <td>Capture by variable is the feature here. The cost is retention you have chosen.</td></tr>
      <tr><td>A small scope captures a large object</td><td>Split into a smaller method</td>
          <td>One display class per scope — capturing anything keeps everything in that scope
          alive.</td></tr>
      <tr><td>Several related behaviours with state</td><td>A class, not a closure</td>
          <td>A display class is a class with worse names and no way to inspect it.</td></tr>
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
    <p>Predict all three outputs, then explain why two constructs that look equivalent disagree.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>var a = new List&lt;Func&lt;int&gt;&gt;();
for (int i = 0; i &lt; 3; i++) a.Add(() =&gt; i);

var b = new List&lt;Func&lt;int&gt;&gt;();
foreach (var i in new[] { 0, 1, 2 }) b.Add(() =&gt; i);

var c = new List&lt;Func&lt;int&gt;&gt;();
for (int i = 0; i &lt; 3; i++) { int copy = i; c.Add(() =&gt; copy); }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>for      : 3, 3, 3
foreach  : 0, 1, 2
for+copy : 0, 1, 2</code></pre>
        <p><strong>The <code>for</code> loop declares <code>i</code> once.</strong> All three
        lambdas capture that single variable, which the compiler has moved onto one display class.
        Nothing is evaluated until the lambdas are invoked, and by then the loop has finished and
        the shared variable holds 3.</p>
        <p><strong>The <code>foreach</code> loop declares its variable inside the loop.</strong>
        Each iteration has its own <code>i</code>, so each lambda captures a different variable on a
        different display class object.</p>
        <p><strong>The third version makes the <code>for</code> loop behave like the
        <code>foreach</code></strong> by introducing a variable whose scope is one iteration.</p>
        <p>The rule underneath all three: <strong>a lambda captures a variable, and lambdas capture
        the same variable if and only if it is the same variable.</strong> The question is never
        about loop kinds but about where the variable is declared.</p>
        <p>Worth knowing the history: before C# 5, <code>foreach</code> behaved like
        <code>for</code>, and this was among the most-reported C# confusions. It was changed for
        <code>foreach</code> only, because a <code>for</code> variable is meant to be shared and
        mutated across iterations — changing it would have broken working code. So the trap survives
        in exactly one construct, which makes it easier to look for.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Two lambdas and the enclosing method all refer to one local. Predict the three printed
    values, then say where that variable actually lives and what that means for thread safety.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>int counter = 0;
Func&lt;int&gt; read = () =&gt; counter;
Action bump = () =&gt; counter++;

Console.WriteLine(read());     // 1
counter = 10;
Console.WriteLine(read());     // 2
bump();
Console.WriteLine($"{read()}, {counter}");   // 3</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>read() at start      : 0
after counter = 10   : 10
after bump()         : read()=11, counter=11</code></pre>
        <p><strong>All three see the same value at every point</strong>, including the enclosing
        method's own <code>counter</code>. Assigning 10 outside the lambdas changed what
        <code>read()</code> returns; calling <code>bump()</code> changed what the enclosing method
        sees.</p>
        <p><strong>Where the variable lives:</strong> not on the stack. The compiler created a
        display class with a field called <code>counter</code>, allocated one instance, and rewrote
        <em>every</em> reference — in both lambdas and in the method body — to go through that
        object. The reflection output in this module shows the field by name.</p>
        <p>That rewriting is why the method body sees the lambda's increment. There is no copying
        back and forth; there is one field and three pieces of code reading it.</p>
        <p><strong>What it means for thread safety.</strong> A captured local looks like a local and
        is not one. If <code>bump</code> is handed to a background task while the enclosing method
        keeps using <code>counter</code>, two threads are reading and writing one field on a shared
        heap object with no synchronisation — and <code>counter++</code> is not atomic, so updates
        can be lost.</p>
        <p>Locals are normally thread-safe by construction, because each call gets its own. Capture
        removes that guarantee silently: nothing at the declaration says the variable has been
        promoted to shared heap state. This is the same hazard as static mutable state from
        <a href="#/m/t1-14-static-and-lifetime">Static Members, Constructors, and Lifetime</a>,
        arriving without a <code>static</code> keyword to warn you.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Five lambda shapes. Predict the allocation of each per thousand creations, then state the
    rule the results imply.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>Use(x =&gt; x &amp; 7);                                  // a) captures nothing

int outer = 7;
Use(x =&gt; x &amp; outer);                              // b) captures an OUTER-scope local

{ int inner = Now(); Use(x =&gt; x &amp; inner); }        // c) captures an INNER-scope local

{ int p = Now(), q = p + 1; Use(x =&gt; (x &amp; p) + q); }   // d) captures two

{ int s = Now(); UseState(static (x, st) =&gt; x &amp; st, s); }  // e) passes state</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>captures nothing                                    0 bytes / 1,000
captures a local from an outer scope                0 bytes / 1,000
captures a local from the inner scope          88,000 bytes / 1,000
captures two locals from one scope             88,000 bytes / 1,000
static lambda taking state as an argument           0 bytes / 1,000</code></pre>
        <div class="table-wrap">
        <table>
          <thead><tr><th></th><th>Bytes</th><th>Why</th></tr></thead>
          <tbody>
            <tr><td>a) captures nothing</td><td>0</td>
                <td>Cached in a static field on <code>&lt;&gt;c</code>; created once, ever.</td></tr>
            <tr><td>b) outer-scope local</td><td>0</td>
                <td>A closure <em>is</em> created — once, outside the loop, then reused.</td></tr>
            <tr><td>c) inner-scope local</td><td>88,000</td>
                <td>A new variable each iteration means a new display class and delegate.</td></tr>
            <tr><td>d) two locals</td><td>88,000</td>
                <td>One display class with two fields. Same cost as one.</td></tr>
            <tr><td>e) state as an argument</td><td>0</td>
                <td>Captures nothing, so it is cached like (a).</td></tr>
          </tbody>
        </table>
        </div>
        <p><strong>The rule: capture costs per closure creation, and a closure is created once per
        entry into the scope that declares the captured variable.</strong></p>
        <p>Row (b) is the one that catches people out in both directions. It does allocate — a
        display class holding <code>outer</code> exists — but only once, so measuring it in a loop
        shows zero. Someone concluding "capturing an outer local is free" would be wrong about a
        method called a million times, where the closure is created on every call.</p>
        <p>Rows (c) and (d) together give the second rule: <strong>one object per scope, not per
        variable</strong>. That is good news for cost and bad news for retention — capturing a small
        variable from a scope that also captures a large object keeps the large object alive, because
        they share the display class.</p>
        <p>Row (e) is the fix worth remembering. When a callback needs a value, passing it as a
        parameter to a <code>static</code> lambda gets the same behaviour at zero cost. Several base
        class library APIs take a state argument alongside the callback for exactly this reason.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A service holds 40 MB per job and the jobs are never collected. The only thing outliving them
    is a one-line progress callback. Identify the mechanism, predict what a weak-reference test
    shows, give the local fix, and say why the local fix forced a design change.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 4 — as given"><code>sealed class DocumentContext
{
    private int _pagesDone;
    private readonly byte[] _pageBuffer = new byte[40 * 1024 * 1024];

    public void Start(ProgressTracker tracker, string jobId)
    {
        tracker.Register(jobId, () =&gt; _pagesDone);   // kept for 24 hours
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The mechanism.</strong> <code>_pagesDone</code> is an instance field, so the
        lambda cannot capture it on its own — it captures <code>this</code>, the whole
        <code>DocumentContext</code>. The delegate's <code>Target</code> is the context itself, and
        the tracker holds the delegate for 24 hours. Every job's 40 MB buffer is reachable for a
        day.</p>
        <p><strong>The weak-reference test</strong> distinguishes it from the alternative in one
        run:</p>
        <pre data-lang="console" data-title="Measured"><code>lambda using a field : Target=Cache
lambda using a local : Target=&lt;&gt;c__DisplayClass4_0
field version: Cache still alive after GC : True
local version: Cache still alive after GC : False</code></pre>
        <p>The <code>Target</code> line alone is enough to diagnose it without a memory dump: if it
        names your own type, the lambda captured <code>this</code>; if it names a display class, it
        captured only locals.</p>
        <p><strong>The local fix:</strong></p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4 — the local fix"><code>public void Start(ProgressTracker tracker, string jobId)
{
    int snapshot = _pagesDone;
    tracker.Register(jobId, () =&gt; snapshot);
}</code></pre>
        <p>Now the display class holds one <code>int</code> and the context can be collected as soon
        as the job finishes.</p>
        <p><strong>Why that forced a design change.</strong> The fix breaks the feature. The
        callback existed so the dashboard could read <em>live</em> progress by pulling from the job;
        capturing a snapshot means it reports whatever the value was at registration — zero,
        forever.</p>
        <p>That is the honest shape of this problem, and it is worth sitting with:
        <strong>the capture was not an accident, it was the feature</strong>. Live progress requires
        a live reference to something that knows the progress. The options are:</p>
        <ol>
          <li><strong>Push instead of pull.</strong> The job calls
          <code>tracker.Report(jobId, pagesDone)</code> as it goes. The tracker holds an
          <code>int</code>, not a delegate, and nothing roots the context. This is what the real
          service did.</li>
          <li><strong>Capture a small shared object.</strong> Extract the counter into its own tiny
          class and capture that instead of the context. The delegate roots a few bytes rather than
          40 MB, and progress stays live.</li>
          <li><strong>Hold the callback weakly.</strong> The tracker stores a
          <code>WeakReference</code> to the target and drops registrations whose target has been
          collected. This works and is the most complex — it means progress can silently stop being
          available, which the dashboard must then handle.</li>
        </ol>
        <p>Option 2 is usually the best trade: it keeps the feature, is a few lines, and makes the
        retained object small enough that its lifetime stops mattering. The general principle is
        <strong>capture the smallest thing that can answer the question</strong> — and if the
        smallest thing is still your whole object, that is a signal the design has the direction of
        the dependency backwards.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does the compiler generate for a lambda that captures nothing, and for one that
      captures a local?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>For a non-capturing lambda: a method on a shared class named <code>&lt;&gt;c</code>, with
        the delegate <strong>cached in a static field</strong>. For a capturing one: a
        <strong>display class</strong> named <code>&lt;&gt;c__DisplayClass…</code> with a field per
        captured variable, allocated each time the scope is entered.</p>
      </div></details>
    </li>
    <li>
      <p>Does a lambda capture the value or the variable?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The <strong>variable</strong>. It moves off the stack onto the display class, and the
        enclosing method's own references are rewritten to use that field too — which is why a
        lambda's increment is visible to the method that declared the variable.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>for</code> give <code>3, 3, 3</code> and <code>foreach</code> give
      <code>0, 1, 2</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>for</code> declares one variable and mutates it, so all the lambdas share it and
        see its final value. <code>foreach</code> declares a fresh variable per iteration (since
        C# 5), so each lambda captures a different one. The fix for <code>for</code> is a copy
        declared inside the loop.</p>
      </div></details>
    </li>
    <li>
      <p>Is capture cost per call or per creation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Per creation</strong> — about 88 bytes for the display class plus the delegate.
        Capturing a variable declared outside a loop allocated nothing across 1,000 iterations;
        capturing one declared inside allocated 88,000. The question is how often the closure is
        created.</p>
      </div></details>
    </li>
    <li>
      <p>What does capturing two variables from one scope cost, and what is the corollary?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The same as capturing one — <strong>one display class per scope</strong>, with a field
        each. The corollary is about retention: capturing a small variable from a scope that also
        captures a large object keeps the large object alive, because they share the object.</p>
      </div></details>
    </li>
    <li>
      <p>What does a lambda capture when it mentions an instance field?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong><code>this</code></strong> — the whole enclosing object, and everything it
        references. Verified: the delegate's <code>Target</code> was the object itself, and it
        survived a full GC. Copying the field to a local first captures only the local.</p>
      </div></details>
    </li>
    <li>
      <p>What is the zero-allocation alternative to capturing a value?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Pass it as a <strong>parameter</strong> to a <code>static</code> lambda. Measured at
        zero bytes against 88,000 for the capturing version. Several base class library APIs take a
        state argument alongside the callback for exactly this.</p>
      </div></details>
    </li>
    <li>
      <p>What does marking a lambda <code>static</code> do?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Forbids it from capturing anything, including <code>this</code>. An accidental capture
        becomes compile error <strong><code>CS8820</code></strong>, which names what you were
        capturing — the same information a profiler would give you, delivered at compile time.</p>
      </div></details>
    </li>
    <li>
      <p>How do you tell from a running program what a lambda captured?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>someDelegate.Target?.GetType().Name</code>. Your own type means <code>this</code>
        was captured; <code>&lt;&gt;c__DisplayClass…</code> means only locals;
        <code>&lt;&gt;c</code> or <code>null</code> means nothing was.</p>
      </div></details>
    </li>
    <li>
      <p>Why is a captured local not thread-safe the way an ordinary local is?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Because it is no longer a local — it is a field on a shared heap object. Two threads
        reading and writing it are sharing mutable state with no synchronisation, and
        <code>counter++</code> is not atomic. Nothing at the declaration says the variable was
        promoted.</p>
      </div></details>
    </li>
    <li>
      <p>Closure allocation per request versus per element: what were the measured figures?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Twenty closures over four million calls: <strong>5,320 bytes</strong>, and no measurable
        time difference. One closure per element over 200,000 items:
        <strong>24 MB in one pass</strong>. Per request is free; per element is not.</p>
      </div></details>
    </li>
    <li>
      <p>What is the general rule for a callback that must outlive the object that created it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Capture the smallest thing that can answer the question.</strong> If that is
        still the whole object, the dependency is pointing the wrong way — push updates outward
        rather than letting a long-lived registry pull from a short-lived object.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
