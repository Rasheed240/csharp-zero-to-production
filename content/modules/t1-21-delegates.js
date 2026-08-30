/* ============================================================================
   Track 1, Module 21 — Delegates
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-21-delegates/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-21-delegates",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "A delegate is an object holding a method and the instance to call it on — which is why it " +
    "can be passed, stored and returned like any other value. It can also hold a list of them, " +
    "and every surprising thing about delegates comes from that: only the last return value " +
    "survives, one exception silences the rest, and removing a lambda you did not keep a " +
    "reference to removes nothing.",
  terms: [
    "delegate", "delegate type", "invocation list", "multicast delegate",
    "Func", "Action", "Predicate", "method group", "target",
    "delegate equality", "higher-order function",
    "MulticastDelegate", "Invoke", "method group conversion caching"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A notification component gathers subscribers and calls them all when something happens. Three
  subscribers are registered. One of them throws. The other two never run — and the component that
  raised the notification receives the exception as though it had failed, when in fact the work it
  was reporting on succeeded perfectly.</p>

  <p>A different component lets callers unsubscribe. A caller registers a handler, later
  unsubscribes it with what appears to be the same line of code, and the handler keeps firing. The
  unsubscribe call did not throw, did not return false, and did nothing.</p>

  <p>A third: a validation pipeline is built from a list of checks. Each check returns whether the
  input is acceptable. All of them run, and the pipeline reports the answer of whichever one
  happened to be added last — silently discarding the others, which had already been computed.</p>

  <p>Every one of these follows from a single fact that the syntax does not advertise:
  <strong>a delegate can hold more than one method</strong>, and the language gives you no
  syntactic warning when it does. This module is about what a delegate value actually is, what
  happens when it holds a list, and what invoking one costs.</p>

  <p>The wider reason to care is that delegates are how C# passes behaviour around.
  <a href="#/m/t1-13-composition-over-inheritance">Composition Over Inheritance</a> used one as the
  lightest form of composition; <a href="#/m/t1-17-generics">Generics</a> used
  <code>Func&lt;T&gt;</code> as a factory. Both were leaning on this module.</p>
</section>

<section id="what-a-delegate-is">
  <h2>What a delegate value actually is</h2>

  <p class="define"><span class="define__term">Delegate type</span> A type whose values are
  methods of a particular shape. <code>delegate int Transform(int value)</code> declares a type
  whose values are "methods taking an <code>int</code> and returning an <code>int</code>". It is a
  type declaration, like a class, and it produces a real type in metadata.</p>

  <p class="define"><span class="define__term">Delegate</span> A value of such a type. It is an
  object, allocated on the heap, holding two things: which method to call, and — for an instance
  method — which object to call it on.</p>

  <p>That second half is the part worth pausing on. A delegate is not a function pointer; it is a
  function pointer <em>plus a receiver</em>. This is what lets a delegate carry state around
  without the caller knowing there is any.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-what-a-delegate-is.cs"><code>// Enumerating a delegate type's members via reflection touches the
// Delegate.CreateDelegate overloads, which carry trimming annotations. The
// warnings are about publishing trimmed, not about this demonstration.
#:property NoWarn=IL2026;IL2111

// 01-what-a-delegate-is.cs — a delegate value is an object holding a method
// and, for instance methods, the object to call it on.
// .NET 10.0.400. Run: dotnet run 01-what-a-delegate-is.cs

using System;
using System.Linq;

// A delegate TYPE declaration: "a method taking int and returning int".
delegate int Transform(int value);

class Multiplier
{
    private readonly int _factor;
    public Multiplier(int factor) =&gt; _factor = factor;
    public int Apply(int value) =&gt; value * _factor;
}

class Program
{
    static int Double(int value) =&gt; value * 2;

    static void Main()
    {
        Console.WriteLine("--- three ways to make the same shape of value ---");
        Transform fromStaticMethod = Double;
        Transform fromInstanceMethod = new Multiplier(3).Apply;
        Transform fromLambda = v =&gt; v * 4;

        Console.WriteLine($"  fromStaticMethod(10)   : {fromStaticMethod(10)}");
        Console.WriteLine($"  fromInstanceMethod(10) : {fromInstanceMethod(10)}");
        Console.WriteLine($"  fromLambda(10)         : {fromLambda(10)}");

        Console.WriteLine();
        Console.WriteLine("--- what the value actually holds ---");
        foreach (var (name, d) in new (string, Transform)[]
                 { ("static method", fromStaticMethod),
                   ("instance method", fromInstanceMethod),
                   ("lambda", fromLambda) })
        {
            Console.WriteLine($"  {name,-16} Method={d.Method.Name,-12} " +
                              $"Target={(d.Target?.GetType().Name ?? "null")}");
        }
        Console.WriteLine("  Target is the object the method runs on. A static method has none.");

        Console.WriteLine();
        Console.WriteLine("--- the delegate type itself ---");
        Console.WriteLine($"  typeof(Transform).BaseType      : {typeof(Transform).BaseType?.Name}");
        Console.WriteLine($"  its BaseType                    : {typeof(Transform).BaseType?.BaseType?.Name}");
        Console.WriteLine($"  declared methods                : " +
            string.Join(", ", typeof(Transform)
                .GetMethods(System.Reflection.BindingFlags.Public |
                            System.Reflection.BindingFlags.Instance |
                            System.Reflection.BindingFlags.DeclaredOnly)
                .Select(m =&gt; m.Name).OrderBy(n =&gt; n)));

        Console.WriteLine();
        Console.WriteLine("--- the built-in generic delegate types ---");
        Func&lt;int, int&gt; func = Double;
        Action&lt;int&gt; action = v =&gt; Console.WriteLine($"    action saw {v}");
        Predicate&lt;int&gt; predicate = v =&gt; v &gt; 5;
        Func&lt;int&gt; noArgs = () =&gt; 42;
        Action noArgsNoReturn = () =&gt; Console.WriteLine("    action with nothing");

        Console.WriteLine($"  Func&lt;int,int&gt;(10)  : {func(10)}");
        action(7);
        Console.WriteLine($"  Predicate&lt;int&gt;(10) : {predicate(10)}");
        Console.WriteLine($"  Func&lt;int&gt;()        : {noArgs()}");
        noArgsNoReturn();

        Console.WriteLine();
        Console.WriteLine("  Func&lt;...,TResult&gt; returns a value; Action&lt;...&gt; returns void;");
        Console.WriteLine("  Predicate&lt;T&gt; is Func&lt;T,bool&gt; with a name. Func takes up to 16");
        Console.WriteLine("  parameters, with the RETURN type always last in the list.");

        Console.WriteLine();
        Console.WriteLine("--- delegates are values: pass them, store them, return them ---");
        Transform chosen = DateTime.UtcNow.Ticks % 2 == 0 ? fromStaticMethod : fromLambda;
        Console.WriteLine($"  chosen at run time     : {chosen.Method.Name}");
        Console.WriteLine($"  applied to 5           : {chosen(5)}");
        Console.WriteLine($"  a method taking one    : {ApplyTwice(fromStaticMethod, 5)}");
        Console.WriteLine($"  a method returning one : {MakeAdder(100)(5)}");
    }

    static int ApplyTwice(Transform t, int value) =&gt; t(t(value));

    static Func&lt;int, int&gt; MakeAdder(int amount) =&gt; value =&gt; value + amount;
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- three ways to make the same shape of value ---
  fromStaticMethod(10)   : 20
  fromInstanceMethod(10) : 30
  fromLambda(10)         : 40

--- what the value actually holds ---
  static method    Method=Double       Target=null
  instance method  Method=Apply        Target=Multiplier
  lambda           Method=&lt;Main&gt;b__1_0 Target=&lt;&gt;c
  Target is the object the method runs on. A static method has none.

--- the delegate type itself ---
  typeof(Transform).BaseType      : MulticastDelegate
  its BaseType                    : Delegate
  declared methods                : BeginInvoke, EndInvoke, Invoke

--- the built-in generic delegate types ---
  Func&lt;int,int&gt;(10)  : 20
    action saw 7
  Predicate&lt;int&gt;(10) : True
  Func&lt;int&gt;()        : 42
    action with nothing

--- delegates are values: pass them, store them, return them ---
  chosen at run time     : Double
  applied to 5           : 10
  a method taking one    : 20
  a method returning one : 105</code></pre>

  <p class="define"><span class="define__term">Target</span> The object an instance method will be
  called on, stored inside the delegate. <code>null</code> for a static method. When you write
  <code>new Multiplier(3).Apply</code>, the delegate keeps a reference to that
  <code>Multiplier</code> — which means <strong>a delegate keeps its target alive</strong>, a fact
  that becomes a memory leak in <a href="#/m/t1-23-events">Events</a>.</p>

  <p class="define"><span class="define__term">Method group</span> A method's name used without
  calling it — <code>Double</code> rather than <code>Double(5)</code>. Converting one to a
  delegate type is a <em>method group conversion</em>, and it is how a delegate is usually
  created.</p>

  <p>Three details in that output repay attention.</p>

  <p><strong>The lambda's method is called <code>&lt;Main&gt;b__1_0</code> and its target is
  <code>&lt;&gt;c</code>.</strong> A lambda is not a special runtime construct — the compiler
  writes an ordinary method with an unspeakable name, on a generated class, and takes a delegate to
  it. <a href="#/m/t1-22-lambdas-and-closures">Lambdas and Closures</a> takes that machinery
  apart; the point here is that a lambda produces exactly the same kind of value as a method
  group.</p>

  <p><strong>Every delegate type derives from <code>MulticastDelegate</code>.</strong> You did not
  ask for that and cannot opt out. It is why every delegate in C# can hold a list of methods, which
  is the subject of the next section and the source of every failure mode in this module.</p>

  <p><strong>The delegate type declares an <code>Invoke</code> method.</strong> Writing
  <code>fromLambda(10)</code> is shorthand for <code>fromLambda.Invoke(10)</code> — the same call,
  which is why <code>?.Invoke(...)</code> works as a null-safe way to raise one.</p>

  <div class="callout callout--note">
    <p><strong>The three built-in families cover almost everything.</strong>
    <code>Func&lt;…, TResult&gt;</code> returns a value and takes up to 16 parameters, with the
    <em>return</em> type written last. <code>Action&lt;…&gt;</code> returns <code>void</code>.
    <code>Predicate&lt;T&gt;</code> is <code>Func&lt;T, bool&gt;</code> with a more descriptive
    name. Declaring your own <code>delegate</code> type is worth it when the name carries meaning
    the shape does not — <code>Transform</code> says more at a call site than
    <code>Func&lt;int, int&gt;</code> — or when you need <code>ref</code>, <code>out</code> or
    <code>params</code> parameters, which the built-in types cannot express.</p>
  </div>
</section>

<section id="multicast">
  <h2>The list nobody asked for</h2>

  <p class="define"><span class="define__term">Multicast delegate</span> A delegate holding more
  than one method. Built with <code>+=</code>, reduced with <code>-=</code>. Every C# delegate can
  be one, because every delegate type derives from <code>MulticastDelegate</code>.</p>

  <p class="define"><span class="define__term">Invocation list</span> The ordered sequence of
  methods a delegate holds, readable with <code>GetInvocationList()</code>. A delegate holding one
  method has a list of one.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-multicast.cs"><code>// 02-multicast.cs — a delegate can hold a LIST of methods. Almost every
// surprising thing about delegates comes from that.
// .NET 10.0.400. Run: dotnet run 02-multicast.cs

using System;
using System.Linq;

class Holder { public int Twice(int v) =&gt; v * 2; }

class Program
{
    static int First(int v) { Console.WriteLine($"    First({v}) -&gt; {v + 1}"); return v + 1; }
    static int Second(int v) { Console.WriteLine($"    Second({v}) -&gt; {v + 2}"); return v + 2; }
    static int Third(int v) { Console.WriteLine($"    Third({v}) -&gt; {v + 3}"); return v + 3; }
    static int Throws(int v) =&gt; throw new InvalidOperationException("handler failed");

    static void Main()
    {
        Console.WriteLine("--- combining with += ---");
        Func&lt;int, int&gt; chain = First;
        chain += Second;
        chain += Third;

        Console.WriteLine($"  invocation list length : {chain.GetInvocationList().Length}");
        Console.WriteLine("  calling chain(10):");
        int result = chain(10);
        Console.WriteLine($"  the returned value is  : {result}");
        Console.WriteLine("  ALL THREE ran, and only the LAST return value survived.");
        Console.WriteLine("  The first two results were computed and discarded.");

        Console.WriteLine();
        Console.WriteLine("--- to keep every result, walk the list yourself ---");
        var all = chain.GetInvocationList()
                       .Cast&lt;Func&lt;int, int&gt;&gt;()
                       .Select(f =&gt; f(10))
                       .ToArray();
        Console.WriteLine($"  every result: {string.Join(", ", all)}");

        Console.WriteLine();
        Console.WriteLine("--- an exception stops the rest ---");
        Func&lt;int, int&gt; withFailure = First;
        withFailure += Throws;
        withFailure += Third;
        try
        {
            withFailure(10);
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  caught {ex.GetType().Name}: {ex.Message}");
        }
        Console.WriteLine("  Third never ran. One bad subscriber silences everything after it.");

        Console.WriteLine();
        Console.WriteLine("--- removing with -= ---");
        Func&lt;int, int&gt;? removable = First;
        removable += Second;
        Console.WriteLine($"  before removal : {removable!.GetInvocationList().Length} entries");
        removable -= Second;
        Console.WriteLine($"  after -= Second: {removable!.GetInvocationList().Length} entries");
        Console.WriteLine("  Note the compiler types the result of -= as NULLABLE: removing");
        Console.WriteLine("  the last entry yields null rather than an empty delegate.");

        Console.WriteLine();
        Console.WriteLine("--- but -= with a NEW lambda removes nothing ---");
        Func&lt;int, int&gt;? withLambda = First;
        withLambda += v =&gt; v * 10;
        Console.WriteLine($"  after adding a lambda : {withLambda!.GetInvocationList().Length}");
        withLambda -= v =&gt; v * 10;               // a DIFFERENT object
        Console.WriteLine($"  after -= (same text)  : {withLambda!.GetInvocationList().Length}");
        Console.WriteLine("  Two lambdas with identical text are two different delegate values.");

        Func&lt;int, int&gt; keep = v =&gt; v * 10;
        Func&lt;int, int&gt;? withKept = First;
        withKept += keep;
        withKept -= keep;                        // the SAME object
        Console.WriteLine($"  holding a reference and removing that: " +
                          $"{withKept!.GetInvocationList().Length}");

        Console.WriteLine();
        Console.WriteLine("--- delegate equality is not identity ---");
        Func&lt;int, int&gt; s1 = First, s2 = First;
        Console.WriteLine($"  static method group   : == {s1 == s2,-5}  ReferenceEquals {ReferenceEquals(s1, s2)}");

        var holder = new Holder();
        Func&lt;int, int&gt; i1 = holder.Twice, i2 = holder.Twice;
        Console.WriteLine($"  instance, same object : == {i1 == i2,-5}  ReferenceEquals {ReferenceEquals(i1, i2)}");

        Func&lt;int, int&gt; i3 = new Holder().Twice;
        Console.WriteLine($"  instance, other object: == {i1 == i3,-5}  ReferenceEquals {ReferenceEquals(i1, i3)}");

        Func&lt;int, int&gt; l1 = v =&gt; v * 2, l2 = v =&gt; v * 2;
        Console.WriteLine($"  two identical lambdas : == {l1 == l2,-5}  ReferenceEquals {ReferenceEquals(l1, l2)}");

        Console.WriteLine("  Row 2 is the one to remember: equal, and NOT the same object.");
        Console.WriteLine("  Equality compares Method and Target. Row 1 is also reference-equal");
        Console.WriteLine("  only because the compiler caches static method group conversions.");
        Console.WriteLine("  Row 4 is why -= with a fresh lambda removes nothing: each lambda");
        Console.WriteLine("  compiles to its own method, so the Methods differ.");

        Console.WriteLine();
        Console.WriteLine("--- removing everything gives null, not an empty delegate ---");
        Func&lt;int, int&gt;? emptied = First;
        emptied -= First;
        Console.WriteLine($"  emptied is null : {emptied is null}");
        Console.WriteLine("  So invoking a delegate field always needs a null check, or ?.Invoke.");
        int? maybe = emptied?.Invoke(1);
        Console.WriteLine($"  emptied?.Invoke(1) returns : {(maybe.HasValue ? maybe.Value.ToString() : "null")}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- combining with += ---
  invocation list length : 3
  calling chain(10):
    First(10) -&gt; 11
    Second(10) -&gt; 12
    Third(10) -&gt; 13
  the returned value is  : 13
  ALL THREE ran, and only the LAST return value survived.
  The first two results were computed and discarded.

--- to keep every result, walk the list yourself ---
    First(10) -&gt; 11
    Second(10) -&gt; 12
    Third(10) -&gt; 13
  every result: 11, 12, 13

--- an exception stops the rest ---
    First(10) -&gt; 11
  caught InvalidOperationException: handler failed
  Third never ran. One bad subscriber silences everything after it.

--- removing with -= ---
  before removal : 2 entries
  after -= Second: 1 entries
  Note the compiler types the result of -= as NULLABLE: removing
  the last entry yields null rather than an empty delegate.

--- but -= with a NEW lambda removes nothing ---
  after adding a lambda : 2
  after -= (same text)  : 2
  Two lambdas with identical text are two different delegate values.
  holding a reference and removing that: 1

--- delegate equality is not identity ---
  static method group   : == True   ReferenceEquals True
  instance, same object : == True   ReferenceEquals False
  instance, other object: == False  ReferenceEquals False
  two identical lambdas : == False  ReferenceEquals False
  Row 2 is the one to remember: equal, and NOT the same object.
  Equality compares Method and Target. Row 1 is also reference-equal
  only because the compiler caches static method group conversions.
  Row 4 is why -= with a fresh lambda removes nothing: each lambda
  compiles to its own method, so the Methods differ.

--- removing everything gives null, not an empty delegate ---
  emptied is null : True
  So invoking a delegate field always needs a null check, or ?.Invoke.
  emptied?.Invoke(1) returns : null</code></pre>

  <p>Five facts, each of which is one of the incidents at the top of this module.</p>

  <p><strong>All the methods run and only the last return value survives.</strong> The chain
  computed 11, 12 and 13, and <code>chain(10)</code> evaluated to 13. The first two results were
  produced and thrown away. That is the validation pipeline reporting whichever check was added
  last — and it is why a delegate with a return type is a poor fit for multicast. If you need every
  answer, walk <code>GetInvocationList()</code> yourself, as the second block does.</p>

  <p><strong>An exception stops the rest.</strong> The chain ran <code>First</code>, threw in
  <code>Throws</code>, and <code>Third</code> never executed. The exception propagates to whoever
  invoked the delegate, so a component raising a notification is handed a failure caused by one of
  its subscribers. Exercise 3 shows the fix.</p>

  <p><strong><code>-=</code> with a freshly written lambda removes nothing.</strong> The invocation
  list still had two entries afterwards, with no error. Two lambdas with identical text are two
  different methods with two different generated names, so the removal finds nothing to remove.
  This is the failed unsubscribe, and it is entirely silent.</p>

  <p><strong>Equality is not identity, and the difference matters here.</strong> The table's second
  row is the one to carry: two delegates to the same instance method on the same object are
  <em>equal</em> and are <em>not the same object</em>. That is what makes <code>-=</code> work at
  all — it searches the invocation list by equality, comparing <code>Method</code> and
  <code>Target</code>.</p>

  <p class="define"><span class="define__term">Method group conversion caching</span> Row 1 of that
  table shows two separate conversions of the same static method producing the same object. Since
  C# 11 the compiler caches these, so repeated <code>Func&lt;int,int&gt; f = SomeStatic;</code>
  does not allocate a new delegate each time. Useful to know when reading allocation profiles, and
  not something to rely on for identity.</p>

  <p><strong>Removing the last entry gives <code>null</code>, not an empty delegate.</strong> The
  compiler even types the result of <code>-=</code> as nullable. So a delegate field is always
  potentially null, and raising it needs <code>?.Invoke(...)</code> or an explicit check —
  a requirement that becomes a threading hazard in <a href="#/m/t1-23-events">Events</a>.</p>
</section>

<section id="cost">
  <h2>What a delegate call costs</h2>

  <p>A delegate call is an indirect call through an object, so it cannot be inlined unless the JIT
  can prove which method it will reach. The question is how much that costs against the
  alternatives already measured in
  <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a>.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-invocation-cost.cs"><code>// 03-invocation-cost.cs — what calling through a delegate costs, against the
// alternatives, and what a multicast list costs per entry.
//
// METHOD NOTE, following t1-11: each scenario has its OWN loop method so they
// do not share a dynamic-PGO type profile, and there is a direct-call control.
//
// .NET 10.0.400, Release. Run: dotnet run 03-invocation-cost.cs -c Release

using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;

interface IStep { int Apply(int x); }
sealed class Step : IStep
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public int Apply(int x) =&gt; x &amp; 7;
}

class Base
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public virtual int Apply(int x) =&gt; x &amp; 7;
}
sealed class Derived : Base
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public override int Apply(int x) =&gt; x &amp; 7;
}

class Program
{
    const int N = 50_000_000;

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Direct(int x) =&gt; x &amp; 7;

    static long L1() { long s = 0; for (int i = 0; i &lt; N; i++) s += Direct(i); return s; }
    static long L2(Func&lt;int, int&gt; f) { long s = 0; for (int i = 0; i &lt; N; i++) s += f(i); return s; }
    static long L3(Func&lt;int, int&gt; f) { long s = 0; for (int i = 0; i &lt; N; i++) s += f(i); return s; }
    static long L4(IStep st) { long s = 0; for (int i = 0; i &lt; N; i++) s += st.Apply(i); return s; }
    static long L5(Base b) { long s = 0; for (int i = 0; i &lt; N; i++) s += b.Apply(i); return s; }
    static long L6(Func&lt;int, int&gt; f) { long s = 0; for (int i = 0; i &lt; N / 4; i++) s += f(i); return s; }
    static long L7(Func&lt;int, int&gt; f) { long s = 0; for (int i = 0; i &lt; N / 4; i++) s += f(i); return s; }

    static void Time(string label, Func&lt;long&gt; body, int n)
    {
        body();
        double best = double.MaxValue, worst = 0;
        for (int r = 0; r &lt; 5; r++)
        {
            var sw = Stopwatch.StartNew();
            long v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
            worst = Math.Max(worst, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-38} best {best,7:F1} ms   {best * 1e6 / n,5:F2} ns/call");
    }

    static void Main()
    {
        Console.WriteLine($"N = {N:N0} calls, best of 5");
        Console.WriteLine();

        Time("direct static call (not inlined)", L1, N);
        Time("delegate to a static method", () =&gt; L2(Direct), N);
        Time("delegate to a lambda calling the same method", () =&gt; L3(x =&gt; Direct(x)), N);
        Time("interface call", () =&gt; L4(new Step()), N);
        Time("virtual call", () =&gt; L5(new Derived()), N);

        Console.WriteLine();
        Console.WriteLine($"--- multicast, {N / 4:N0} invocations of the whole chain ---");
        Func&lt;int, int&gt; one = Direct;
        Func&lt;int, int&gt; three = Direct;
        three += Direct;
        three += Direct;

        Time("1 entry in the invocation list", () =&gt; L6(one), N / 4);
        Time("3 entries in the invocation list", () =&gt; L7(three), N / 4);
        Console.WriteLine($"  (the 3-entry chain calls the method {3} times per invocation,");
        Console.WriteLine("   so divide by 3 to compare per-call cost)");

        Console.WriteLine();
        Console.WriteLine("--- allocation: does taking a delegate allocate? ---");
        long before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i &lt; 1000; i++) TakeNonCapturing(x =&gt; x &amp; 7);
        long nonCapturing = GC.GetTotalAllocatedBytes(precise: true) - before;

        before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i &lt; 1000; i++)
        {
            int captured = i;                       // DIFFERENT each iteration
            TakeNonCapturing(x =&gt; x &amp; captured);
        }
        long capturing = GC.GetTotalAllocatedBytes(precise: true) - before;

        before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i &lt; 1000; i++) TakeNonCapturing(Direct);
        long methodGroup = GC.GetTotalAllocatedBytes(precise: true) - before;

        Console.WriteLine($"  1000 non-capturing lambdas : {nonCapturing,7:N0} bytes");
        Console.WriteLine($"  1000 capturing lambdas     : {capturing,7:N0} bytes");
        Console.WriteLine($"  1000 static method groups  : {methodGroup,7:N0} bytes");
        Console.WriteLine("  The compiler caches a lambda that captures nothing, and caches a");
        Console.WriteLine("  static method group conversion. Capturing is the case that costs,");
        Console.WriteLine("  and it gets a module of its own next.");
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int TakeNonCapturing(Func&lt;int, int&gt; f) =&gt; f(1);
}</code></pre>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Call shape</th><th>Sample 1</th><th>Sample 2</th></tr></thead>
    <tbody>
      <tr><td>direct static call (inlining prevented)</td><td>1.43 ns</td><td>1.56 ns</td></tr>
      <tr><td>through a delegate to a static method</td><td><strong>2.82 ns</strong></td><td><strong>2.87 ns</strong></td></tr>
      <tr><td>through a delegate to a lambda calling the same method</td><td>1.59 ns</td><td>1.81 ns</td></tr>
      <tr><td>interface call</td><td>2.22 ns</td><td>2.66 ns</td></tr>
      <tr><td>virtual call</td><td>2.06 ns</td><td>1.60 ns</td></tr>
    </tbody>
  </table>
  </div>

  <p><strong>A delegate call costs about 1.3 ns more than a direct call</strong> — 2.8 ns against
  1.5 — putting it in the same range as an interface or virtual call. That is the honest headline:
  delegates are not a special performance category, they are one more form of indirect call.</p>

  <div class="callout callout--note">
    <p><strong>Two things this measurement had to be corrected for, both worth knowing.</strong>
    The first version marked only the target method <code>[MethodImpl(NoInlining)]</code>, so the
    delegate-to-a-lambda row inlined its whole body and measured <em>faster than a direct call</em>
    — a nonsense result caused by comparing an inlinable body against a deliberately
    non-inlinable one. Every target is now equally non-inlinable. Row 3 is still the fastest
    indirect row, because the JIT can see the lambda's target and inline the delegate call around
    the non-inlinable work inside it, which is a real effect rather than an artefact.</p>
  </div>

  <p>The multicast numbers moved considerably between samples — 6.13 and 28.95 ns in one, 2.83 and
  15.10 ns in the other — so the absolutes are not worth quoting. The <strong>ratio</strong> is
  stable: a three-entry chain costs about <strong>five times</strong> a one-entry chain, not three.
  Invoking a multicast delegate walks the invocation list, so there is per-entry overhead beyond
  the calls themselves.</p>

  <p>The allocation figures are exactly reproducible and more interesting than the timings:</p>

  <pre data-lang="console" data-title="Allocation, per 1,000 delegate creations"><code>1000 non-capturing lambdas :      64 bytes
1000 capturing lambdas     :  88,000 bytes
1000 static method groups  :       0 bytes</code></pre>

  <p>A lambda that captures nothing is created once and cached — 64 bytes total, not per call. A
  static method group conversion is also cached, at zero. <strong>A lambda that captures a variable
  that changes allocates 88 bytes every time</strong>: a generated object to hold the captured
  value, plus the delegate pointing at it. That is the whole subject of
  <a href="#/m/t1-22-lambdas-and-closures">Lambdas and Closures</a>, and the reason it gets its own
  module.</p>
</section>

<section id="production-example">
  <h2>Delegates as the seam in a component</h2>

  <p>Three uses in one class: policy passed in, a dependency passed in, and notifications passed
  out.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>// 04-production.cs — delegates as the seam in a component: policy passed in,
// notifications passed out, and a pipeline built from functions.
// .NET 10.0.400. Run: dotnet run 04-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct Payment(string Id, decimal Amount, string Currency);
public readonly record struct Decision(bool Approved, string Reason);

public sealed class PaymentAuthoriser
{
    // POLICY IN: a rule is a function. No interface, no class per rule.
    private readonly IReadOnlyList&lt;(string Name, Func&lt;Payment, Decision&gt; Rule)&gt; _rules;

    // CLOCK IN: the one dependency that would otherwise be static state.
    private readonly Func&lt;DateTimeOffset&gt; _now;

    // NOTIFICATIONS OUT: optional, so the field is nullable and raised safely.
    private Action&lt;string&gt;? _onDecision;

    public PaymentAuthoriser(
        IEnumerable&lt;(string, Func&lt;Payment, Decision&gt;)&gt; rules,
        Func&lt;DateTimeOffset&gt;? now = null)
    {
        _rules = rules.Select(r =&gt; (r.Item1, r.Item2)).ToArray();
        _now = now ?? (() =&gt; DateTimeOffset.UtcNow);
    }

    public void OnDecision(Action&lt;string&gt; handler) =&gt; _onDecision += handler;
    public void StopListening(Action&lt;string&gt; handler) =&gt; _onDecision -= handler;

    public Decision Authorise(Payment payment)
    {
        foreach (var (name, rule) in _rules)
        {
            Decision decision;
            try
            {
                decision = rule(payment);
            }
            catch (Exception ex)
            {
                decision = new Decision(false, $"rule '{name}' threw {ex.GetType().Name}");
            }

            if (!decision.Approved)
            {
                Raise($"{_now():HH:mm:ss} {payment.Id} declined by {name}: {decision.Reason}");
                return decision;
            }
        }

        Raise($"{_now():HH:mm:ss} {payment.Id} approved");
        return new Decision(true, "all rules passed");
    }

    // Raising safely: copy to a local, then null-check. ?.Invoke does both.
    private void Raise(string message) =&gt; _onDecision?.Invoke(message);
}

class Program
{
    static void Main()
    {
        var log = new List&lt;string&gt;();
        var fixedClock = () =&gt; new DateTimeOffset(2026, 8, 30, 9, 0, 0, TimeSpan.Zero);

        decimal floorLimit = 500m;
        var supported = new HashSet&lt;string&gt;(StringComparer.OrdinalIgnoreCase) { "GBP", "EUR" };

        var authoriser = new PaymentAuthoriser(new (string, Func&lt;Payment, Decision&gt;)[]
        {
            ("positive-amount", p =&gt; p.Amount &gt; 0m
                ? new Decision(true, "")
                : new Decision(false, $"amount {p.Amount} is not positive")),

            ("supported-currency", p =&gt; supported.Contains(p.Currency)
                ? new Decision(true, "")
                : new Decision(false, $"{p.Currency} is not supported")),

            ("floor-limit", p =&gt; p.Amount &lt;= floorLimit
                ? new Decision(true, "")
                : new Decision(false, $"{p.Amount} exceeds {floorLimit}"))
        }, fixedClock);

        Action&lt;string&gt; toLog = log.Add;
        authoriser.OnDecision(toLog);
        authoriser.OnDecision(m =&gt; Console.WriteLine($"  [console] {m}"));

        foreach (var p in new[]
        {
            new Payment("P-1", 100m, "GBP"),
            new Payment("P-2", -5m, "GBP"),
            new Payment("P-3", 100m, "JPY"),
            new Payment("P-4", 900m, "GBP")
        })
        {
            var d = authoriser.Authorise(p);
            Console.WriteLine($"  {p.Id}: approved={d.Approved}, {d.Reason}");
        }

        Console.WriteLine();
        Console.WriteLine($"log captured {log.Count} entries");

        Console.WriteLine();
        Console.WriteLine("--- unsubscribing works because we kept the reference ---");
        authoriser.StopListening(toLog);
        int before = log.Count;
        authoriser.Authorise(new Payment("P-5", 50m, "GBP"));
        Console.WriteLine($"  log entries after unsubscribing: {log.Count} (was {before})");
        Console.WriteLine("  The console handler was a lambda we did not keep, so it is still");
        Console.WriteLine("  attached and cannot be removed. That is the leak this module warns");
        Console.WriteLine("  about, and the subject of the events module.");

        Console.WriteLine();
        Console.WriteLine("--- a rule that throws is contained ---");
        var fragile = new PaymentAuthoriser(new (string, Func&lt;Payment, Decision&gt;)[]
        {
            ("always-throws", _ =&gt; throw new InvalidOperationException("upstream down"))
        }, fixedClock);
        var caught = fragile.Authorise(new Payment("P-9", 10m, "GBP"));
        Console.WriteLine($"  P-9: approved={caught.Approved}, {caught.Reason}");
        Console.WriteLine("  The authoriser caught it and turned it into a decision rather");
        Console.WriteLine("  than letting one rule take down the request.");

        Console.WriteLine();
        Console.WriteLine("--- composing functions ---");
        Func&lt;decimal, decimal&gt; vat = a =&gt; a * 1.20m;
        Func&lt;decimal, decimal&gt; voucher = a =&gt; a - 10m;      // a FLAT amount
        Func&lt;decimal, decimal&gt; round = a =&gt; Math.Round(a, 2);

        Console.WriteLine($"  voucher then VAT : {Compose(voucher, vat, round)(100.00m)}");
        Console.WriteLine($"  VAT then voucher : {Compose(vat, voucher, round)(100.00m)}");
        Console.WriteLine("  Different answers. Composing percentages alone would NOT show");
        Console.WriteLine("  this — multiplication commutes — which is worth knowing before");
        Console.WriteLine("  writing a test that proves nothing.");
    }

    static Func&lt;T, T&gt; Compose&lt;T&gt;(params Func&lt;T, T&gt;[] steps) =&gt;
        input =&gt; steps.Aggregate(input, (acc, step) =&gt; step(acc));
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>  [console] 09:00:00 P-1 approved
  P-1: approved=True, all rules passed
  [console] 09:00:00 P-2 declined by positive-amount: amount -5 is not positive
  P-2: approved=False, amount -5 is not positive
  [console] 09:00:00 P-3 declined by supported-currency: JPY is not supported
  P-3: approved=False, JPY is not supported
  [console] 09:00:00 P-4 declined by floor-limit: 900 exceeds 500
  P-4: approved=False, 900 exceeds 500

log captured 4 entries

--- unsubscribing works because we kept the reference ---
  [console] 09:00:00 P-5 approved
  log entries after unsubscribing: 4 (was 4)
  The console handler was a lambda we did not keep, so it is still
  attached and cannot be removed.

--- a rule that throws is contained ---
  P-9: approved=False, rule 'always-throws' threw InvalidOperationException
  The authoriser caught it and turned it into a decision rather
  than letting one rule take down the request.

--- composing functions ---
  voucher then VAT : 108.00
  VAT then voucher : 110.00
  Different answers. Composing percentages alone would NOT show
  this — multiplication commutes — which is worth knowing before
  writing a test that proves nothing.</code></pre>

  <p class="define"><span class="define__term">Higher-order function</span> A method that takes or
  returns a function. <code>Authorise</code> is one by construction — the rules are
  <code>Func&lt;Payment, Decision&gt;</code> values it was handed — and <code>Compose</code> is
  one that returns a function built from others.</p>

  <p>Four decisions, each a rule from this module.</p>

  <p><strong>A rule is a <code>Func</code>, not an interface.</strong> Each rule is one expression
  with no state and no name worth having as a type — the case
  <a href="#/m/t1-13-composition-over-inheritance">Composition Over Inheritance</a> identified for
  delegates over interfaces. The tuple carries a name alongside for diagnostics, which is the one
  thing the delegate cannot supply.</p>

  <p><strong>The clock is a <code>Func&lt;DateTimeOffset&gt;</code> with a default.</strong> That is
  the dependency <a href="#/m/t1-14-static-and-lifetime">Static Members, Constructors, and
  Lifetime</a> warned about, injected in the lightest possible way — the test passes a fixed clock,
  which is why the timestamps above are all <code>09:00:00</code>.</p>

  <p><strong>Notifications go out through <code>Action&lt;string&gt;?</code>, raised with
  <code>?.Invoke</code>.</strong> Null because a delegate field with no subscribers <em>is</em>
  null, not empty. This is very nearly an event, and the difference — which is about who is allowed
  to invoke it and who is allowed to replace it — is the subject of
  <a href="#/m/t1-23-events">Events</a>.</p>

  <p><strong>Each rule is invoked inside a <code>try</code>.</strong> A rule that throws becomes a
  declined decision naming the rule, rather than an exception escaping to the caller. This is the
  fix for "one bad subscriber silences the rest", applied where the invocation happens.</p>

  <div class="callout callout--gotcha">
    <p><strong>The unsubscribe demonstration is the failure, not the success.</strong> The log
    handler was removed because a reference to it was kept in a variable. The console handler was
    written inline as a lambda and can never be removed — it fired again for P-5 after the
    unsubscribe. Nothing reported a problem. If you intend a subscription to be removable, you must
    keep the delegate you subscribed with; there is no other handle on it.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A multicast delegate with a return type</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: only the last answer survives"><code>// WRONG. All three validators run, all three results are computed, and the
// value of the expression is whichever one was added last.
Func&lt;Input, bool&gt; validate = CheckLength;
validate += CheckFormat;
validate += CheckRange;

if (validate(input)) Accept(input);      // ignores the first two answers</code></pre>

  <p>The fix is to stop using multicast for anything that returns a value. Hold a
  <code>List&lt;Func&lt;Input, bool&gt;&gt;</code> and combine the results explicitly — then the
  combining rule (all, any, first failure) is written down instead of being an accident of
  ordering.</p>

  <h3>2. One subscriber taking down the rest</h3>

  <p>Measured above: the chain stopped at the throwing entry and the third never ran. Worse, the
  exception surfaces at the <em>publisher</em>, so a component reporting a successful operation
  appears to have failed. Isolate each entry if the subscribers are not yours to trust — exercise 3
  shows the loop.</p>

  <h3>3. Unsubscribing a lambda you did not keep</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a silent no-op"><code>// WRONG. The second lambda is a different object, so this removes nothing
// and reports nothing.
source.OnChanged += x =&gt; Log(x);
source.OnChanged -= x =&gt; Log(x);

// Right: keep the delegate you subscribed with.
Action&lt;int&gt; handler = x =&gt; Log(x);
source.OnChanged += handler;
source.OnChanged -= handler;</code></pre>

  <h3>4. Forgetting that a delegate field can be null</h3>

  <p>An unsubscribed-to-empty delegate is <code>null</code>, not an empty list — the compiler types
  <code>-=</code> as nullable to say so. Invoking it without a check is a
  <code>NullReferenceException</code> on a line that looks like an ordinary call.
  <code>?.Invoke(...)</code> is the idiom, and it does the null check and the call in one.</p>

  <h3>5. Assuming order</h3>

  <p>The invocation list runs in subscription order, which is documented — and depending on it
  couples every subscriber to the registration order of every other. If order matters, an explicit
  ordered list of functions expresses that; a multicast delegate hides it.</p>

  <h3>6. Holding a delegate longer than its target should live</h3>

  <p>A delegate to an instance method holds a reference to that instance. A long-lived delegate —
  a static field, a cache, a subscription on a long-lived publisher — keeps its target alive for as
  long as it lives. That is the leak <a href="#/m/t1-23-events">Events</a> is largely about, and it
  begins here, with <code>Target</code>.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>A handler runs more or fewer times than expected.</strong> Print
    <code>d?.GetInvocationList().Length ?? 0</code> at the point of invocation. That single number
    settles most questions: zero means nothing subscribed (or everything unsubscribed to null),
    more than expected means a duplicate subscription, and one fewer means an unsubscribe that did
    not match. Follow with
    <code>string.Join(", ", d.GetInvocationList().Select(x =&gt; x.Method.Name))</code> to see
    which methods are actually in it — lambdas show as <code>&lt;Method&gt;b__N_M</code>, which at
    least tells you which method they were written in.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>An unsubscribe did nothing.</strong> Check whether the same delegate value was used
    to subscribe and unsubscribe. Two lambdas with identical text are different values — verified
    above as <code>==</code> returning <code>False</code>. Compare the invocation list length before
    and after; if it is unchanged, the removal found no match.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A publisher is blamed for an exception it did not cause.</strong> Read the stack
    trace from the bottom up: if the frames below the throw belong to a subscriber and the frames
    above belong to the raising code, the exception crossed a delegate boundary. That means one
    subscriber failed and the others after it never ran. Wrapping each invocation-list entry
    individually converts it into a per-subscriber failure you can report.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>An object is not being collected and no reference to it is visible.</strong>
    Look for delegates. <code>someDelegate.Target</code> is a reference the garbage collector
    honours, and it is invisible in the source — the code says
    <code>publisher.OnChanged += Handle;</code>, not "publisher now holds a reference to me". In a
    memory dump, the path to the root will pass through a delegate object.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Deciding whether a delegate is the right tool.</strong> Two questions. Does the
    varying thing have state or several related operations? Then an interface, per
    <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and
    Interfaces</a>. Does it return a value <em>and</em> need multiple subscribers? Then neither —
    use an explicit collection of functions, because multicast will discard every answer but
    one.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>A concrete case.</strong> An order service published a completion notification
    through a delegate field, with four subscribers registered at startup: a metrics recorder, an
    audit writer, a cache invalidator, and an email sender. About 30,000 orders a day.</p>
    <p>A change to the email provider introduced a call that could throw on malformed addresses —
    roughly 1 order in 900. Because subscribers run in registration order and the email sender was
    third, its exception meant the fourth subscriber, the cache invalidator, never ran for those
    orders. And because the exception propagated back to the publisher, the order-completion path
    itself reported a failure for an order that had completed successfully.</p>
    <p>The visible symptoms were three, and none of them pointed at the email sender. Roughly 33
    orders a day were marked failed despite having completed, so a reconciliation job kept finding
    discrepancies. Stale cache entries accumulated for exactly those orders, producing customer
    reports of "old data" that could never be reproduced. And the metrics recorder — first in the
    list — always ran, so the dashboards showed nothing unusual at all.</p>
    <p>What made it hard was that no component was faulty in isolation. The email sender threw on
    bad input, which is defensible. The publisher propagated an exception, which is normal. The
    cache invalidator was never called, which is not something a component can detect about
    itself.</p>
    <p>The fix was ten lines at the raise site: walk <code>GetInvocationList()</code>, invoke each
    entry inside a <code>try</code>, collect failures, and log them against the subscriber's
    <code>Method.Name</code>. The four subscribers became independent, the false failures stopped,
    the cache invalidation resumed, and the email problem — which had been invisible for three
    weeks — appeared in the logs within a minute of deployment as exactly what it was.</p>
  </div>

  <p>The general principle: <strong>a multicast delegate makes independent subscribers into a
  chain, and nothing in the syntax says so.</strong> <code>OnCompleted += Handler;</code> reads
  like registering interest. What it does is append to a list that will be walked in order, where
  any entry can stop the walk and every entry's return value but the last is discarded.</p>

  <p>That is not an argument against delegates — the same mechanism is what lets a component be
  extended without knowing its extenders. It is an argument for <strong>owning the invocation
  site</strong>. The component that raises the notification is the only place that can decide
  whether subscribers are isolated from one another, and it is a decision, whether or not anyone
  makes it deliberately.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"A delegate is a function pointer."</strong> It is a function pointer <em>and</em> a
    target object, and it can hold a list of both. The target is why a delegate keeps an object
    alive, and the list is why <code>+=</code> works at all. A raw function pointer exists in C#
    — <code>delegate*</code> in unsafe code — and is a genuinely different thing.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>+=</code> on a delegate replaces the handler."</strong> It appends. Subscribing
    twice runs the handler twice, which is a common cause of duplicated side effects — doubled
    emails, doubled metrics — and the invocation list length is how you see it.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>-=</code> tells me if it failed."</strong> It returns the new delegate and
    reports nothing. Removing something that is not there is silently a no-op, which is exactly
    what happens when the argument is a freshly written lambda — verified above with the list
    length unchanged at two.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"An empty delegate is safe to invoke."</strong> There is no empty delegate. Removing
    the last entry gives <code>null</code>, and the compiler types <code>-=</code> as nullable
    because of it. Invoking without a check throws <code>NullReferenceException</code>.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Delegates are slow."</strong> Measured at about 2.8 ns against 1.5 ns for a direct
    call — the same range as an interface or virtual call, and inlinable when the JIT can see the
    target. What actually costs is <em>capture</em>: 88 bytes allocated per capturing lambda
    creation, against zero for a method group.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Two delegates to the same method are the same object."</strong> Sometimes, by
    accident. Two conversions of the same <em>static</em> method group are cached to one object
    since C# 11; two delegates to the same instance method on the same object are
    <strong>equal but distinct objects</strong>. Compare with <code>==</code>, never
    <code>ReferenceEquals</code>.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Reach for</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>One operation varies, no state, no name needed</td><td><code>Func</code> /
          <code>Action</code></td>
          <td>No type to declare, and the variants are expressions.</td></tr>
      <tr><td>Several related operations vary, or the variant has state</td><td>An interface</td>
          <td>Somewhere for dependencies to live, and a name in logs and configuration.</td></tr>
      <tr><td>The shape needs a meaningful name at call sites</td><td>A custom
          <code>delegate</code> type</td>
          <td><code>Transform</code> reads better than <code>Func&lt;int,int&gt;</code>.</td></tr>
      <tr><td>The signature needs <code>ref</code>, <code>out</code> or
          <code>params</code></td><td>A custom <code>delegate</code> type</td>
          <td><code>Func</code> and <code>Action</code> cannot express those.</td></tr>
      <tr><td>Several subscribers, nothing returned</td><td>Multicast, or an
          <code>event</code></td>
          <td>What multicast is for. Isolate each entry at the raise site.</td></tr>
      <tr><td>Several subscribers, and you need every answer</td><td>A
          <code>List&lt;Func&lt;…&gt;&gt;</code></td>
          <td>Multicast discards every return value but the last.</td></tr>
      <tr><td>The subscription must be removable</td><td>Keep the delegate in a field</td>
          <td>An inline lambda cannot be removed — there is no handle on it.</td></tr>
      <tr><td>Subscribers are not yours to trust</td><td>Walk
          <code>GetInvocationList()</code> with a <code>try</code> per entry</td>
          <td>Otherwise one failure stops the rest and blames the publisher.</td></tr>
      <tr><td>Raising a delegate field</td><td><code>field?.Invoke(...)</code></td>
          <td>Empty means null. Also takes a copy, which matters under threading.</td></tr>
      <tr><td>Creating a delegate in a hot loop</td><td>Hoist it, or use a method group</td>
          <td>Capturing allocates 88 bytes per creation; a method group allocates
          nothing.</td></tr>
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
    <p>Three methods are combined into one <code>Func&lt;int, int&gt;</code>. Say which of them run,
    what <code>chain(10)</code> evaluates to, and how you would obtain every result.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>static int A(int v) =&gt; v + 1;
static int B(int v) =&gt; v + 2;
static int C(int v) =&gt; v + 3;

Func&lt;int, int&gt; chain = A;
chain += B;
chain += C;

int result = chain(10);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>invocation list length : 3
methods that ran       : A(10), B(10), C(10)
returned value         : 13
every result           : 11, 12, 13</code></pre>
        <p><strong>All three run, and the result is 13</strong> — <code>C</code>'s answer, because
        it was added last. <code>A</code> produced 11 and <code>B</code> produced 12; both were
        computed and discarded.</p>
        <p>Note what did <em>not</em> happen: this is not a pipeline. <code>B</code> did not receive
        <code>A</code>'s output — every method was called with the original argument 10. A multicast
        delegate broadcasts one call to many methods; it does not chain them.</p>
        <p><strong>To obtain every result</strong>, walk the invocation list:</p>
<pre data-lang="csharp" data-net="10" data-title="Getting all the answers"><code>var every = chain.GetInvocationList()
                 .Cast&lt;Func&lt;int, int&gt;&gt;()
                 .Select(f =&gt; f(10))
                 .ToArray();               // 11, 12, 13</code></pre>
        <p><code>GetInvocationList()</code> returns <code>Delegate[]</code>, so the
        <code>Cast</code> is needed to call them with the right signature.</p>
        <p>The practical conclusion: <strong>a multicast delegate with a return type is nearly
        always a mistake.</strong> If you want one answer, hold one delegate. If you want several
        answers, hold a <code>List&lt;Func&lt;…&gt;&gt;</code> and combine them explicitly, so the
        combining rule is written down rather than being "whichever was registered last".</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Predict the six equality results, then explain why one <code>-=</code> works and the other
    does not, and what the last line prints.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>Func&lt;int, int&gt; s1 = A, s2 = A;                       // static method
var h = new Holder();
Func&lt;int, int&gt; i1 = h.Twice, i2 = h.Twice;          // instance method, same object
Func&lt;int, int&gt; l1 = v =&gt; v * 2, l2 = v =&gt; v * 2;    // two identical lambdas

// then:
Func&lt;int, int&gt;? a = A;  a += v =&gt; v * 2;  a -= v =&gt; v * 2;
Func&lt;int, int&gt; kept = v =&gt; v * 2;
Func&lt;int, int&gt;? b = A;  b += kept;        b -= kept;
Func&lt;int, int&gt;? c = A;  c -= A;</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>static group    : == True  ReferenceEquals True
instance, same  : == True  ReferenceEquals False
two lambdas     : == False ReferenceEquals False
-= a fresh lambda -&gt; entries: 2
-= the kept reference -&gt; entries: 1
removing the last entry -&gt; null? True</code></pre>
        <p><strong>Delegate equality compares <code>Method</code> and <code>Target</code>.</strong>
        Two delegates are equal when they would call the same method on the same object.</p>
        <ul>
          <li><strong>Static method group: equal and reference-equal.</strong> Equal because the
          method matches and both targets are null. Reference-equal because since C# 11 the
          compiler caches static method group conversions — an implementation detail, not something
          to rely on.</li>
          <li><strong>Instance, same object: equal, not reference-equal.</strong> This is the row
          that proves equality is not identity, and it is what makes <code>-=</code> work: the
          removal searches the list by equality, so it can find an entry you added earlier even
          though you have built a fresh delegate to look for it.</li>
          <li><strong>Two identical lambdas: not equal.</strong> Each lambda expression compiles to
          its <em>own</em> generated method with its own name, so the <code>Method</code>s differ.
          Identical text is not identical code.</li>
        </ul>
        <p><strong>Why one removal works and the other does not</strong> follows directly. Removing
        with a fresh lambda searches for something equal to it; nothing in the list is, because the
        subscribed lambda is a different method. The list stayed at two entries, and nothing
        reported a failure. Removing with the kept reference finds an exactly equal entry and
        succeeds.</p>
        <p><strong>The last line prints <code>True</code>: <code>c</code> is null.</strong> Removing
        the only entry does not leave an empty delegate — there is no such thing. The compiler types
        the result of <code>-=</code> as nullable for exactly this reason, which is why every raise
        site needs <code>?.Invoke(...)</code> or an explicit check.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A chain of three handlers has a failing one in the middle. Say which handlers run, where the
    exception surfaces, and write the raise site that isolates them. Then say what the isolated
    version costs.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 3 — as given"><code>Func&lt;int, int&gt; fragile = A;
fragile += Boom;          // throws InvalidOperationException
fragile += C;

fragile(10);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>methods that ran : A(10)
C ran?           : False
isolating each   : ran A(10), C(10); failures InvalidOperationException</code></pre>
        <p><strong>Only <code>A</code> ran.</strong> <code>Boom</code> threw, and
        <code>C</code> — which had nothing to do with the failure — never executed. The exception
        propagates out of <code>fragile(10)</code> to whoever invoked it, which is the
        <em>publisher</em>, not the failing subscriber.</p>
        <p>That last point is the damaging one. The component raising the notification is handed an
        exception caused by code it does not own, about work that succeeded. It will typically log
        a failure, roll something back, or return an error for an operation that completed
        correctly.</p>
        <p><strong>The isolated raise site:</strong></p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3 — isolated"><code>static IReadOnlyList&lt;(string Handler, Exception Error)&gt; RaiseIsolated&lt;T&gt;(
    Func&lt;T, int&gt;? chain, T argument)
{
    if (chain is null) return Array.Empty&lt;(string, Exception)&gt;();

    var failures = new List&lt;(string, Exception)&gt;();
    foreach (var entry in chain.GetInvocationList().Cast&lt;Func&lt;T, int&gt;&gt;())
    {
        try
        {
            entry(argument);
        }
        catch (Exception ex)
        {
            failures.Add((entry.Method.Name, ex));
        }
    }
    return failures;
}</code></pre>
        <p>With that, the measured run shows <code>A</code> and <code>C</code> both running and one
        recorded failure. Every subscriber gets its turn, the publisher completes normally, and the
        failure is attributed to a named handler instead of being anonymous.</p>
        <p><strong>What it costs</strong>, and these are worth stating rather than glossing:</p>
        <ol>
          <li><strong>A <code>try</code> per entry.</strong> Negligible when nothing throws —
          entering a try block costs nothing at run time on .NET; only throwing is expensive.</li>
          <li><strong>The return values are discarded</strong> unless you collect them, which for a
          notification is correct and for anything returning a meaningful answer means multicast
          was the wrong tool — exercise 1.</li>
          <li><strong>You must decide what a failure means.</strong> Logging it is the usual answer.
          The one thing not to do is swallow it silently, which converts a loud bug into the
          invisible one described in this module's incident.</li>
          <li><strong>Ordering guarantees weaken.</strong> If a later subscriber depended on an
          earlier one having succeeded, isolating them makes that dependency's failure silent.
          Subscribers that depend on each other are not really independent subscribers, and the
          coupling should be made explicit rather than resting on registration order.</li>
        </ol>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Four ways of producing a <code>Func&lt;int, int&gt;</code>. Predict the allocation of each
    per thousand creations, explain the results, and say what that means for a hot path.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>Take(x =&gt; x &amp; 7);                       // a) non-capturing lambda
Take(Work);                             // b) static method group

int fixedValue = 7;
Take(x =&gt; x &amp; fixedValue);              // c) captures a local declared OUTSIDE the loop

for (int i = 0; i &lt; 1000; i++)
{
    int c = i;
    Take(x =&gt; x &amp; c);                   // d) captures a local declared INSIDE the loop
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output, bytes per 1,000 creations"><code>non-capturing lambda                            0 bytes per 1,000
static method group                             0 bytes per 1,000
lambda capturing an unchanging local            0 bytes per 1,000
lambda capturing a changing local          88,000 bytes per 1,000</code></pre>
        <p><strong>Three of the four allocate nothing, and the reasons differ.</strong></p>
        <p><strong>(a) A non-capturing lambda is cached.</strong> It depends on nothing outside
        itself, so one instance can serve every call. The compiler creates it once, stores it in a
        static field on a generated class, and reuses it forever. This is why the earlier
        measurement showed 64 bytes for 1,000 creations — that 64 was the single cached
        instance.</p>
        <p><strong>(b) A static method group conversion is also cached</strong>, since C# 11 — the
        same delegate object is reused, so repeated conversions cost nothing.</p>
        <p><strong>(c) Capturing an unchanging local allocated nothing here, which is the subtle
        one.</strong> The closure genuinely is allocated — but <em>once</em>, before the measuring
        loop, because <code>fixedValue</code> is declared outside it and never changes. One closure
        object and one delegate serve all thousand calls. The allocation is real and it is
        <strong>per closure creation, not per call</strong>.</p>
        <p><strong>(d) Capturing a variable declared inside the loop allocates 88 bytes every
        iteration.</strong> Each iteration has its own <code>c</code>, so each needs its own object
        to hold it and its own delegate pointing at that object — about 88 bytes for the pair.</p>
        <p><strong>What that means for a hot path.</strong> The question is never "does this lambda
        capture" but <strong>"how often is this closure created"</strong>:</p>
        <ul>
          <li>A capturing lambda created once at startup and reused costs one allocation, ever.
          Perfectly fine.</li>
          <li>The same lambda written inside a per-request method allocates on every request — at
          10,000 requests a second, 880 KB a second of gen0 garbage from one line.</li>
          <li>The fix is usually to hoist: create the delegate once and store it, or capture
          nothing and pass the varying value as an argument instead.</li>
        </ul>
        <p>Worth noting what a profiler shows for this: a generated type named
        <code>&lt;&gt;c__DisplayClass…</code> at the top of the allocation list. That name is the
        signature of a capturing lambda, and
        <a href="#/m/t1-22-lambdas-and-closures">Lambdas and Closures</a> is where it is taken
        apart.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What two things does a delegate value hold?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The <strong>method</strong> to call and the <strong>target</strong> — the object to call
        it on, which is <code>null</code> for a static method. The target is why a delegate keeps
        its object alive, which becomes a memory leak in
        <a href="#/m/t1-23-events">Events</a>.</p>
      </div></details>
    </li>
    <li>
      <p>What does a multicast call return when three methods are in the list?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>The last one's value.</strong> All three run and all three results are computed;
        the first two are discarded. To get every answer, walk
        <code>GetInvocationList()</code> yourself. A multicast delegate with a return type is nearly
        always a mistake.</p>
      </div></details>
    </li>
    <li>
      <p>What happens to the rest of the chain when one entry throws?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Nothing after it runs, and the exception propagates to <strong>the publisher</strong> —
        so a component reporting successful work appears to have failed. Isolate by invoking each
        entry from <code>GetInvocationList()</code> inside its own <code>try</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>-=</code> with a freshly written lambda remove nothing?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Each lambda expression compiles to its <strong>own generated method</strong>, so two
        lambdas with identical text have different <code>Method</code>s and are not equal.
        Removal searches by equality, finds no match, and reports nothing. Keep the delegate you
        subscribed with.</p>
      </div></details>
    </li>
    <li>
      <p>How is delegate equality defined, and where does it differ from identity?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Equal when <code>Method</code> and <code>Target</code> both match. Two delegates to the
        same instance method on the same object are <strong>equal but distinct objects</strong> —
        the case that proves the difference. Static method group conversions happen also to be
        reference-equal because the compiler caches them.</p>
      </div></details>
    </li>
    <li>
      <p>What do you get when you remove the last entry from a delegate?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong><code>null</code></strong>, not an empty delegate — the compiler types
        <code>-=</code> as nullable to say so. Every raise site therefore needs
        <code>?.Invoke(...)</code> or an explicit null check.</p>
      </div></details>
    </li>
    <li>
      <p>What does a delegate call cost against a direct call?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>About <strong>2.8 ns against 1.5 ns</strong> — roughly 1.3 ns of indirection, putting it
        in the same range as an interface or virtual call. It can be inlined when the JIT can see
        the target. Delegates are not a special performance category.</p>
      </div></details>
    </li>
    <li>
      <p>Which of these allocate: a non-capturing lambda, a static method group, a capturing
      lambda?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Only the <strong>capturing</strong> one — about 88 bytes per closure creation, for the
        generated object plus the delegate. Non-capturing lambdas and static method group
        conversions are both cached and effectively free.</p>
      </div></details>
    </li>
    <li>
      <p>Is capture cost per call or per creation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Per creation.</strong> Capturing a variable declared outside a loop allocated
        nothing across 1,000 iterations; capturing one declared inside allocated 88,000 bytes. The
        question is how often the closure is created, not whether it captures.</p>
      </div></details>
    </li>
    <li>
      <p>How do you find out what is actually subscribed?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>d?.GetInvocationList().Length ?? 0</code> for the count, and
        <code>d.GetInvocationList().Select(x =&gt; x.Method.Name)</code> for the names. Zero means
        nothing subscribed; more than expected means a duplicate subscription.</p>
      </div></details>
    </li>
    <li>
      <p>When is an interface the better choice than a delegate?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the varying thing has <strong>state</strong>, several <strong>related
        operations</strong>, or needs a <strong>name</strong> that appears in configuration and
        logs. A delegate wins for a single stateless operation whose variants are
        expressions.</p>
      </div></details>
    </li>
    <li>
      <p>Who is responsible for deciding whether subscribers are isolated from each other?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>The component that raises the delegate</strong> — it is the only place that can
        decide. And it is a decision whether or not anyone makes it deliberately: doing nothing
        chooses "one failure stops the rest and blames the publisher".</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
