/* ============================================================================
   Track 1, Module 20 — IEnumerable vs ICollection vs IList vs IReadOnly*
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-20-ienumerable-vs-icollection/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-20-ienumerable-vs-icollection",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "The interface you return is a contract about three things: whether the result has been " +
    "computed, whether it has a size, and whether the caller can change it. Returning " +
    "IEnumerable hands back a recipe that reruns on every pass — and measured here, it also " +
    "costs LINQ the shortcuts it would otherwise take.",
  terms: [
    "IEnumerable", "ICollection", "IList", "IReadOnlyCollection", "IReadOnlyList",
    "deferred execution", "materialise", "multiple enumeration",
    "iterator method", "yield return", "lazy sequence", "snapshot", "live view",
    "ReadOnlyCollection", "type test", "short-circuit"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A method returns <code>IEnumerable&lt;Order&gt;</code>. The caller checks
  <code>.Count()</code>, logs the first item, and then loops over it. The database is queried three
  times. Nothing in the calling code suggests it would be.</p>

  <p>A report is built from a filtered sequence and handed to a renderer. Between building it and
  rendering it, another component adds an order — and the report includes it, because the report
  was never a report. It was a description of how to make one.</p>

  <p>And a method returns <code>IReadOnlyList&lt;Order&gt;</code> to make clear that the caller must
  not modify it. The caller casts it to <code>IList&lt;Order&gt;</code> and adds an item, which
  changes the collection inside the service.</p>

  <p>All three are decisions made by a single word in a signature. <strong>The interface you return
  is a contract about three separate things</strong> — whether the work has been done, whether the
  result has a known size, and whether the caller can change it — and the names do not make those
  three obvious. This module is what each one actually promises.</p>
</section>

<section id="the-hierarchy">
  <h2>The hierarchy, from the metadata</h2>

  <pre data-lang="csharp" data-net="10" data-title="01-the-hierarchy.cs"><code>// 01-the-hierarchy.cs — which members exist on which interface, and which
// concrete types implement what. Read off the metadata rather than a diagram.
// .NET 10.0.400. Run: dotnet run 01-the-hierarchy.cs

#:property NoWarn=IL2070;IL2075;IL2090

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

class Program
{
    static readonly Type[] Interfaces =
    {
        typeof(IEnumerable&lt;&gt;), typeof(IReadOnlyCollection&lt;&gt;), typeof(IReadOnlyList&lt;&gt;),
        typeof(ICollection&lt;&gt;), typeof(IList&lt;&gt;)
    };

    static void Main()
    {
        Console.WriteLine("--- members DECLARED on each interface (not inherited) ---");
        foreach (var t in Interfaces)
        {
            var members = t.GetMembers()
                .Where(m =&gt; m.DeclaringType == t)
                .Select(m =&gt; m.Name)
                .Where(n =&gt; !n.StartsWith("get_") &amp;&amp; !n.StartsWith("set_"))
                .OrderBy(n =&gt; n);
            Console.WriteLine($"  {t.Name,-26} {string.Join(", ", members)}");
        }

        Console.WriteLine();
        Console.WriteLine("--- what each interface inherits from ---");
        foreach (var t in Interfaces)
        {
            var bases = t.GetInterfaces()
                .Where(i =&gt; i.IsGenericType)
                .Select(i =&gt; i.Name)
                .OrderBy(n =&gt; n);
            Console.WriteLine($"  {t.Name,-26} {(bases.Any() ? string.Join(", ", bases) : "(nothing generic)")}");
        }

        Console.WriteLine();
        Console.WriteLine("--- which concrete types implement which ---");
        var concrete = new (string Name, object Value)[]
        {
            ("int[]", new int[3]),
            ("List&lt;int&gt;", new List&lt;int&gt;()),
            ("HashSet&lt;int&gt;", new HashSet&lt;int&gt;()),
            ("Queue&lt;int&gt;", new Queue&lt;int&gt;()),
            ("ReadOnlyCollection&lt;int&gt;", new ReadOnlyCollection&lt;int&gt;(new List&lt;int&gt;())),
            ("Dictionary&lt;int,int&gt;", new Dictionary&lt;int, int&gt;()),
            ("IEnumerable from LINQ", Enumerable.Range(0, 3).Where(x =&gt; x &gt; 0))
        };

        Console.WriteLine($"  {"type",-24} {"IEnum",6} {"IROColl",8} {"IROList",8} {"IColl",6} {"IList",6}");
        foreach (var (name, value) in concrete)
        {
            string Mark(Type open)
            {
                var t = value.GetType();
                bool ok = t.GetInterfaces().Any(i =&gt; i.IsGenericType &amp;&amp;
                    i.GetGenericTypeDefinition() == open);
                return ok ? "yes" : "-";
            }
            Console.WriteLine($"  {name,-24} {Mark(typeof(IEnumerable&lt;&gt;)),6} " +
                              $"{Mark(typeof(IReadOnlyCollection&lt;&gt;)),8} {Mark(typeof(IReadOnlyList&lt;&gt;)),8} " +
                              $"{Mark(typeof(ICollection&lt;&gt;)),6} {Mark(typeof(IList&lt;&gt;)),6}");
        }

        Console.WriteLine();
        Console.WriteLine("--- the one that surprises people ---");
        IReadOnlyList&lt;int&gt; readOnly = new List&lt;int&gt; { 1, 2, 3 };
        Console.WriteLine($"  IReadOnlyList&lt;int&gt; holding a List&lt;int&gt;");
        Console.WriteLine($"    is it IList&lt;int&gt;?     {readOnly is IList&lt;int&gt;}");
        Console.WriteLine($"    is it ICollection&lt;int&gt;? {readOnly is ICollection&lt;int&gt;}");
        if (readOnly is IList&lt;int&gt; writable)
        {
            writable.Add(99);
            Console.WriteLine($"    added through the cast: now {readOnly.Count} items");
        }
        Console.WriteLine("  'ReadOnly' in the name describes the INTERFACE, not the object.");

        Console.WriteLine();
        Console.WriteLine("--- and ReadOnlyCollection implements IList&lt;T&gt; too ---");
        IReadOnlyList&lt;int&gt; wrapped = new ReadOnlyCollection&lt;int&gt;(new List&lt;int&gt; { 1, 2, 3 });
        Console.WriteLine($"  is it IList&lt;int&gt;? {wrapped is IList&lt;int&gt;}   (the type test PASSES)");
        try
        {
            ((IList&lt;int&gt;)wrapped).Add(99);
        }
        catch (NotSupportedException)
        {
            Console.WriteLine("  ...and calling Add throws NotSupportedException.");
        }
        Console.WriteLine("  So a type test cannot tell you whether a collection is writable.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- members DECLARED on each interface (not inherited) ---
  IEnumerable&amp;#96;1              GetEnumerator
  IReadOnlyCollection&amp;#96;1      Count
  IReadOnlyList&amp;#96;1            Item
  ICollection&amp;#96;1              Add, Clear, Contains, CopyTo, Count, IsReadOnly, Remove
  IList&amp;#96;1                    IndexOf, Insert, Item, RemoveAt

--- what each interface inherits from ---
  IEnumerable&amp;#96;1              (nothing generic)
  IReadOnlyCollection&amp;#96;1      IEnumerable&amp;#96;1
  IReadOnlyList&amp;#96;1            IEnumerable&amp;#96;1, IReadOnlyCollection&amp;#96;1
  ICollection&amp;#96;1              IEnumerable&amp;#96;1
  IList&amp;#96;1                    ICollection&amp;#96;1, IEnumerable&amp;#96;1

--- which concrete types implement which ---
  type                      IEnum  IROColl  IROList  IColl  IList
  int[]                       yes      yes      yes    yes    yes
  List&lt;int&gt;                   yes      yes      yes    yes    yes
  HashSet&lt;int&gt;                yes      yes        -    yes      -
  Queue&lt;int&gt;                  yes      yes        -      -      -
  ReadOnlyCollection&lt;int&gt;     yes      yes      yes    yes    yes
  Dictionary&lt;int,int&gt;         yes      yes        -    yes      -
  IEnumerable from LINQ       yes        -        -      -      -</code></pre>

  <p>Each interface adds exactly one idea to the one below it.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Interface</th><th>Adds</th><th>Means</th></tr></thead>
    <tbody>
      <tr><td><code>IEnumerable&lt;T&gt;</code></td><td><code>GetEnumerator</code></td>
          <td>You can walk it, forwards, once. Nothing more.</td></tr>
      <tr><td><code>IReadOnlyCollection&lt;T&gt;</code></td><td><code>Count</code></td>
          <td>It has a known size, so it has already been computed.</td></tr>
      <tr><td><code>IReadOnlyList&lt;T&gt;</code></td><td><code>this[int]</code></td>
          <td>It has a stable order and you can index into it.</td></tr>
      <tr><td><code>ICollection&lt;T&gt;</code></td>
          <td><code>Add</code>, <code>Remove</code>, <code>Clear</code>, <code>Contains</code>,
          <code>Count</code></td>
          <td>You can change what is in it.</td></tr>
      <tr><td><code>IList&lt;T&gt;</code></td>
          <td><code>this[int]</code>, <code>Insert</code>, <code>RemoveAt</code>,
          <code>IndexOf</code></td>
          <td>You can change what is in it, at a position.</td></tr>
    </tbody>
  </table>
  </div>

  <p class="define"><span class="define__term">IEnumerable&lt;T&gt;</span> The weakest promise:
  something you can iterate. It says nothing about whether the elements exist yet, how many there
  are, or whether iterating twice gives the same answer.</p>

  <p class="define"><span class="define__term">ICollection&lt;T&gt;</span> Adds mutation:
  <code>Add</code>, <code>Remove</code>, <code>Clear</code>, plus <code>Count</code>,
  <code>Contains</code> and <code>IsReadOnly</code>. Taking one as a parameter says "I may change
  this".</p>

  <p class="define"><span class="define__term">IReadOnlyList&lt;T&gt;</span> Adds an indexer to
  <code>IReadOnlyCollection&lt;T&gt;</code>, so the result has a stable order and a known size. The
  usual return type for something you have already computed.</p>

  <p class="define"><span class="define__term">Materialise</span> To evaluate a deferred sequence
  into a real collection — <code>ToList()</code>, <code>ToArray()</code>. It converts a recipe into
  a result, fixing both the contents and the cost.</p>

  <p><strong>The single most important row of that table is the last one.</strong> A LINQ query
  implements <code>IEnumerable&lt;T&gt;</code> and nothing else — no <code>Count</code>, no
  indexer. That is not an oversight; it is the honest description of a thing that has not been
  computed.</p>

  <div class="callout callout--gotcha">
    <p><strong>The two read-only families are not parallel.</strong>
    <code>IReadOnlyList&lt;T&gt;</code> is <em>not</em> a base of <code>IList&lt;T&gt;</code> —
    they are separate branches that both extend <code>IEnumerable&lt;T&gt;</code>. That is why
    <code>Queue&lt;T&gt;</code> is an <code>IReadOnlyCollection</code> and not an
    <code>ICollection&lt;T&gt;</code>, and it is why a method taking
    <code>IReadOnlyList&lt;T&gt;</code> cannot be handed something typed <code>IList&lt;T&gt;</code>
    without a cast, even though every concrete list is both.</p>
  </div>
</section>

<section id="readonly-is-not">
  <h2>"ReadOnly" describes the interface, not the object</h2>

  <pre data-lang="console" data-title="From the output above"><code>--- the one that surprises people ---
  IReadOnlyList&lt;int&gt; holding a List&lt;int&gt;
    is it IList&lt;int&gt;?     True
    is it ICollection&lt;int&gt;? True
    added through the cast: now 4 items
  'ReadOnly' in the name describes the INTERFACE, not the object.

--- and ReadOnlyCollection implements IList&lt;T&gt; too ---
  is it IList&lt;int&gt;? True   (the type test PASSES)
  ...and calling Add throws NotSupportedException.
  So a type test cannot tell you whether a collection is writable.</code></pre>

  <p><a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a> established that
  returning <code>IReadOnlyList&lt;T&gt;</code> over a <code>List&lt;T&gt;</code> lets a caller cast
  back and mutate it. This is the sharper version of that fact.</p>

  <p><strong>Even a genuine <code>ReadOnlyCollection&lt;T&gt;</code> passes
  <code>is IList&lt;T&gt;</code>.</strong> It implements the interface and throws
  <code>NotSupportedException</code> from every mutating member — that is what
  <code>ICollection&lt;T&gt;.IsReadOnly</code> exists to signal. So:</p>

  <ul>
    <li>A type test tells you the member <em>exists</em>, never that calling it will work.</li>
    <li>The only reliable question is <code>collection is ICollection&lt;T&gt; { IsReadOnly: true }</code>,
    and almost nothing asks it.</li>
    <li>Returning <code>IReadOnlyList&lt;T&gt;</code> is a statement of intent. Returning a
    <code>ReadOnlyCollection&lt;T&gt;</code> is an enforcement, and it is still a live view of the
    underlying list rather than a snapshot.</li>
  </ul>
</section>

<section id="deferred">
  <h2>Deferred execution</h2>

  <p class="define"><span class="define__term">Deferred execution</span> The work described by a
  query happens when something iterates it, not when it is created — and happens again on every
  iteration. Also called lazy evaluation.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-deferred-execution.cs"><code>// 02-deferred-execution.cs — returning IEnumerable&lt;T&gt; returns a RECIPE, not a
// result. The work happens when someone iterates, once per iteration.
// .NET 10.0.400. Run: dotnet run 02-deferred-execution.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static int _calls;

    static IEnumerable&lt;int&gt; Expensive(IEnumerable&lt;int&gt; source) =&gt;
        source.Where(x =&gt; { _calls++; return x % 2 == 0; });

    // A lazy sequence with a side effect and a failure late in the run.
    static IEnumerable&lt;string&gt; ReadLines()
    {
        Console.WriteLine("    [opening the file]");
        yield return "row-1";
        yield return "row-2";
        Console.WriteLine("    [reading past the end]");
        throw new InvalidOperationException("truncated file");
    }

    static void Main()
    {
        var source = Enumerable.Range(0, 10).ToList();

        Console.WriteLine("--- 1. nothing runs until you iterate ---");
        _calls = 0;
        var query = Expensive(source);
        Console.WriteLine($"  after building the query, predicate calls: {_calls}");
        var first = query.ToList();
        Console.WriteLine($"  after one ToList,          predicate calls: {_calls}");

        Console.WriteLine();
        Console.WriteLine("--- 2. iterating twice does the work twice ---");
        _calls = 0;
        var q2 = Expensive(source);
        int count = q2.Count();
        int sum = q2.Sum();
        var list = q2.ToList();
        Console.WriteLine($"  Count() + Sum() + ToList() -&gt; predicate calls: {_calls}");
        Console.WriteLine($"  (count={count}, sum={sum}, list has {list.Count})");
        Console.WriteLine("  Three passes over the same query, three full evaluations.");

        _calls = 0;
        var materialised = Expensive(source).ToList();
        int c2 = materialised.Count;
        int s2 = materialised.Sum();
        Console.WriteLine($"  materialising first        -&gt; predicate calls: {_calls}");

        Console.WriteLine();
        Console.WriteLine("--- 3. the sequence sees changes made after it was built ---");
        var live = new List&lt;int&gt; { 1, 2, 3 };
        var lazy = live.Where(x =&gt; x &gt; 1);
        var eager = live.Where(x =&gt; x &gt; 1).ToList();
        live.Add(99);
        Console.WriteLine($"  lazy  after adding 99: {string.Join(", ", lazy)}");
        Console.WriteLine($"  eager after adding 99: {string.Join(", ", eager)}");

        Console.WriteLine();
        Console.WriteLine("--- 4. side effects and failures happen at iteration ---");
        Console.WriteLine("  calling ReadLines():");
        var lines = ReadLines();
        Console.WriteLine("  ...returned. Nothing has happened yet.");
        Console.WriteLine("  now iterating:");
        try
        {
            foreach (var line in lines) Console.WriteLine($"    got {line}");
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"    threw {ex.GetType().Name}: {ex.Message}");
        }
        Console.WriteLine("  The exception surfaced inside the foreach, not at the call.");

        Console.WriteLine();
        Console.WriteLine("--- 5. modifying while enumerating ---");
        var items = new List&lt;int&gt; { 1, 2, 3 };
        try
        {
            foreach (var i in items) if (i == 2) items.Remove(i);
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  removing during foreach: {ex.GetType().Name}");
            Console.WriteLine($"    {ex.Message}");
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. nothing runs until you iterate ---
  after building the query, predicate calls: 0
  after one ToList,          predicate calls: 10

--- 2. iterating twice does the work twice ---
  Count() + Sum() + ToList() -&gt; predicate calls: 30
  (count=5, sum=20, list has 5)
  Three passes over the same query, three full evaluations.
  materialising first        -&gt; predicate calls: 10

--- 3. the sequence sees changes made after it was built ---
  lazy  after adding 99: 2, 3, 99
  eager after adding 99: 2, 3

--- 4. side effects and failures happen at iteration ---
  calling ReadLines():
  ...returned. Nothing has happened yet.
  now iterating:
    [opening the file]
    got row-1
    got row-2
    [reading past the end]
    threw InvalidOperationException: truncated file
  The exception surfaced inside the foreach, not at the call.

--- 5. modifying while enumerating ---
  removing during foreach: InvalidOperationException
    Collection was modified; enumeration operation may not execute.</code></pre>

  <p class="define"><span class="define__term">Multiple enumeration</span> Iterating the same
  deferred sequence more than once, so the work runs more than once. Three passes over one query
  cost <strong>30 predicate calls where materialising first cost 10</strong>.</p>

  <p>Blocks 3 and 4 are the ones that produce bug reports rather than slow code.</p>

  <p><strong>A lazy sequence is a live view of its source.</strong> Adding 99 to the list after
  building the query changed what the query returned. The eagerly materialised version did not
  change — it is a snapshot. Neither is wrong; the problem is that the two look identical at the
  call site.</p>

  <p><strong>Side effects and failures move.</strong> <code>ReadLines()</code> returned without
  opening anything. The file opened, and the exception was thrown, inside the
  <code>foreach</code> — so a <code>try/catch</code> around the <em>call</em> catches nothing, and
  a stack trace points at the loop rather than at the method that failed.</p>

  <p class="define"><span class="define__term">Iterator method</span> A method containing
  <code>yield return</code>. The compiler turns it into a state machine that runs a piece at a time
  as the caller asks for elements. Nothing in its body executes until the first
  <code>MoveNext</code>.</p>

  <div class="callout callout--warn">
    <p><strong>This is why "return <code>IEnumerable</code> for flexibility" is not free
    advice.</strong> It hands the caller something whose cost, timing, stability and failure
    behaviour all depend on how they use it — and gives them no way to tell from the type. The
    flexibility is real; so is the obligation to know you have it.</p>
  </div>
</section>

<section id="what-the-type-costs">
  <h2>What the declared type costs</h2>

  <p>LINQ inspects what it is handed. The same call on the same data behaves differently depending
  on what the compiler thinks it is.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-what-the-type-costs.cs"><code>// 03-what-the-type-costs.cs — LINQ inspects what it is given. The same call on
// the same data costs different amounts depending on the declared type.
// .NET 10.0.400, Release. Run: dotnet run 03-what-the-type-costs.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Program
{
    const int N = 1_000_000;
    const int Reps = 2_000;

    // A sequence that is genuinely only IEnumerable — LINQ cannot shortcut it.
    static IEnumerable&lt;int&gt; AsPureSequence(IEnumerable&lt;int&gt; source)
    {
        foreach (var item in source) yield return item;
    }

    static void Time(string label, Func&lt;long&gt; body, int reps)
    {
        body();
        double best = double.MaxValue;
        long bytes = 0;
        for (int r = 0; r &lt; 3; r++)
        {
            long before = GC.GetTotalAllocatedBytes(precise: true);
            var sw = Stopwatch.StartNew();
            long v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-40} {best,8:F1} ms   {bytes,10:N0} bytes");
    }

    static void Main()
    {
        var list = Enumerable.Range(0, N).ToList();
        IEnumerable&lt;int&gt; asEnumerable = list;
        IEnumerable&lt;int&gt; pure = AsPureSequence(list);
        ICollection&lt;int&gt; asCollection = list;

        Console.WriteLine($"list of {N:N0} ints, {Reps:N0} repetitions");
        Console.WriteLine();
        Console.WriteLine("--- Count() ---");
        Time("list.Count (the property)", () =&gt;
        { long t = 0; for (int i = 0; i &lt; Reps; i++) t += list.Count; return t; }, Reps);
        Time("Count() on IEnumerable holding a List", () =&gt;
        { long t = 0; for (int i = 0; i &lt; Reps; i++) t += asEnumerable.Count(); return t; }, Reps);
        Time("Count() on ICollection", () =&gt;
        { long t = 0; for (int i = 0; i &lt; Reps; i++) t += asCollection.Count; return t; }, Reps);

        Console.WriteLine();
        Console.WriteLine("--- the same call on a sequence LINQ cannot inspect ---");
        Time("Count() on a pure IEnumerable (x3)", () =&gt;
        { long t = 0; for (int i = 0; i &lt; 3; i++) t += AsPureSequence(list).Count(); return t; }, 3);

        Console.WriteLine();
        Console.WriteLine("--- Contains() ---");
        Time("HashSet.Contains via ICollection (x100k)", () =&gt;
        {
            ICollection&lt;int&gt; set = new HashSet&lt;int&gt;(list);
            long t = 0;
            for (int i = 0; i &lt; 100_000; i++) if (set.Contains(i)) t++;
            return t;
        }, 100_000);
        Time("Enumerable.Contains on the same set (x100k)", () =&gt;
        {
            IEnumerable&lt;int&gt; set = new HashSet&lt;int&gt;(list);
            long t = 0;
            for (int i = 0; i &lt; 100_000; i++) if (set.Contains(i)) t++;
            return t;
        }, 100_000);

        Console.WriteLine();
        Console.WriteLine("--- ToList() on each ---");
        Time("ToList() from a List", () =&gt;
        { long t = 0; for (int i = 0; i &lt; 20; i++) t += asEnumerable.ToList().Count; return t; }, 20);
        Time("ToList() from a pure IEnumerable", () =&gt;
        { long t = 0; for (int i = 0; i &lt; 20; i++) t += AsPureSequence(list).ToList().Count; return t; }, 20);

        Console.WriteLine();
        Console.WriteLine("LINQ type-tests what it receives. Count() checks for ICollection and");
        Console.WriteLine("reads the property; Contains() checks for ICollection and uses its");
        Console.WriteLine("Contains; ToList() checks for a known size and pre-sizes the result.");
        Console.WriteLine("Hand back a plain IEnumerable and every one of those falls back to");
        Console.WriteLine("walking the sequence.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>list of 1,000,000 ints, 2,000 repetitions

--- Count() ---
  list.Count (the property)                     0.0 ms           40 bytes
  Count() on IEnumerable holding a List         0.0 ms           40 bytes
  Count() on ICollection                        0.0 ms           40 bytes

--- the same call on a sequence LINQ cannot inspect ---
  Count() on a pure IEnumerable (x3)           20.2 ms          328 bytes

--- Contains() ---
  HashSet.Contains via ICollection (x100k)     26.1 ms   18,603,192 bytes
  Enumerable.Contains on the same set (x100k)     22.5 ms   18,603,192 bytes

--- ToList() on each ---
  ToList() from a List                         20.6 ms   80,003,656 bytes
  ToList() from a pure IEnumerable            182.5 ms  167,786,680 bytes</code></pre>

  <p><strong>Declaring something <code>IEnumerable</code> does not itself cost anything.</strong>
  <code>Count()</code> on an <code>IEnumerable</code> variable that happens to hold a
  <code>List</code> was as fast as reading <code>.Count</code> — 2,000 calls in under a
  millisecond. LINQ type-tests the object at run time, finds <code>ICollection</code>, and reads
  the property. The <code>Contains</code> pair shows the same thing: no meaningful difference,
  because the optimisation fired in both.</p>

  <p><strong>What costs is the sequence genuinely not being a collection.</strong> Three
  <code>Count()</code> calls on a sequence produced by an iterator method took 20.2 ms, because
  each one walked a million elements. And <code>ToList()</code> was
  <strong>8.9× slower and allocated 2.1× more</strong> — 182.5 ms and 168 MB against 20.6 ms and
  80 MB — because it could not ask how many elements were coming and had to grow its result
  repeatedly, exactly the resizing cost measured in
  <a href="#/m/t1-19-collections-overview">Collections and Their Cost Model</a>.</p>

  <p>So the rule is not "avoid <code>IEnumerable</code>". It is: <strong>if the data is already a
  collection, do not hide that behind an iterator method</strong>. Wrapping a list in a
  <code>yield return</code> loop to "keep it lazy" removes every shortcut LINQ would have
  taken.</p>
</section>

<section id="production-example">
  <h2>Choosing deliberately</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>// 04-production.cs — choosing return types and parameter types deliberately,
// and what each choice tells the caller.
// .NET 10.0.400. Run: dotnet run 04-production.cs

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

public readonly record struct Order(string Id, string Status, decimal Amount);

public sealed class OrderBook
{
    private readonly List&lt;Order&gt; _orders = new();
    private readonly ReadOnlyCollection&lt;Order&gt; _view;

    public OrderBook() =&gt; _view = new ReadOnlyCollection&lt;Order&gt;(_orders);

    public void Add(Order order) =&gt; _orders.Add(order);

    // RETURN TYPE 1: a materialised, counted, indexable snapshot the caller
    // cannot modify. Costs nothing per call — the wrapper is built once.
    public IReadOnlyList&lt;Order&gt; All =&gt; _view;

    // RETURN TYPE 2: deferred, because the caller may only want the first few.
    // Documented as such, because the name cannot say it.
    public IEnumerable&lt;Order&gt; WhereStatus(string status) =&gt;
        _orders.Where(o =&gt; string.Equals(o.Status, status, StringComparison.Ordinal));

    // RETURN TYPE 3: materialised, because the caller almost certainly wants
    // all of it and would otherwise re-run the query per pass.
    public IReadOnlyList&lt;Order&gt; TopBy(Func&lt;Order, decimal&gt; key, int take) =&gt;
        _orders.OrderByDescending(key).Take(take).ToArray();

    // PARAMETER TYPE: IEnumerable, because this only reads forward once.
    public int AddRange(IEnumerable&lt;Order&gt; orders)
    {
        int before = _orders.Count;
        // If the caller handed us something with a known size, use it.
        if (orders is ICollection&lt;Order&gt; collection)
            _orders.Capacity = Math.Max(_orders.Capacity, _orders.Count + collection.Count);
        foreach (var o in orders) _orders.Add(o);
        return _orders.Count - before;
    }
}

class Program
{
    static void Main()
    {
        var book = new OrderBook();
        int added = book.AddRange(new[]
        {
            new Order("O-1", "open", 120.00m),
            new Order("O-2", "shipped", 45.50m),
            new Order("O-3", "open", 800.00m),
            new Order("O-4", "cancelled", 12.00m),
            new Order("O-5", "open", 300.00m)
        });
        Console.WriteLine($"added {added}, book now has {book.All.Count}");

        Console.WriteLine();
        Console.WriteLine("--- All: counted, indexable, and not writable through the interface ---");
        Console.WriteLine($"  Count       : {book.All.Count}");
        Console.WriteLine($"  All[0]      : {book.All[0]}");
        Console.WriteLine($"  is IList?   : {book.All is IList&lt;Order&gt;}  (yes — but Add throws)");
        try { ((IList&lt;Order&gt;)book.All).Add(default); }
        catch (NotSupportedException) { Console.WriteLine("  Add through IList: NotSupportedException"); }

        Console.WriteLine();
        Console.WriteLine("--- WhereStatus: deferred, so it sees later changes ---");
        var open = book.WhereStatus("open");
        Console.WriteLine($"  open now         : {open.Count()}");
        book.Add(new Order("O-6", "open", 5.00m));
        Console.WriteLine($"  after adding one : {open.Count()}   (same query object)");
        Console.WriteLine("  That is useful when intended and a bug when not, which is why the");
        Console.WriteLine("  return type says IEnumerable rather than IReadOnlyList.");

        Console.WriteLine();
        Console.WriteLine("--- TopBy: materialised, so it is a stable answer ---");
        var top = book.TopBy(o =&gt; o.Amount, 3);
        Console.WriteLine($"  top 3 by amount  : {string.Join(", ", top.Select(o =&gt; o.Id))}");
        book.Add(new Order("O-7", "open", 9999.00m));
        Console.WriteLine($"  after adding a bigger one: {string.Join(", ", top.Select(o =&gt; o.Id))}");
        Console.WriteLine("  Unchanged — it is a snapshot, which is what a report wants.");

        Console.WriteLine();
        Console.WriteLine("--- the parameter type let AddRange pre-size ---");
        var book2 = new OrderBook();
        var array = Enumerable.Range(0, 1000).Select(i =&gt; new Order($"X-{i}", "open", i)).ToArray();
        Console.WriteLine($"  AddRange(array)  : added {book2.AddRange(array)}");
        var lazy = Enumerable.Range(0, 1000).Select(i =&gt; new Order($"Y-{i}", "open", i));
        Console.WriteLine($"  AddRange(lazy)   : added {book2.AddRange(lazy)}");
        Console.WriteLine("  Both work. The first could pre-size because an array is an");
        Console.WriteLine("  ICollection; the second could not, and grew as it went.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>added 5, book now has 5

--- All: counted, indexable, and not writable through the interface ---
  Count       : 5
  All[0]      : Order { Id = O-1, Status = open, Amount = 120.00 }
  is IList?   : True  (yes — but Add throws)
  Add through IList: NotSupportedException

--- WhereStatus: deferred, so it sees later changes ---
  open now         : 3
  after adding one : 4   (same query object)
  That is useful when intended and a bug when not, which is why the
  return type says IEnumerable rather than IReadOnlyList.

--- TopBy: materialised, so it is a stable answer ---
  top 3 by amount  : O-3, O-5, O-1
  after adding a bigger one: O-3, O-5, O-1
  Unchanged — it is a snapshot, which is what a report wants.

--- the parameter type let AddRange pre-size ---
  AddRange(array)  : added 1000
  AddRange(lazy)   : added 1000
  Both work. The first could pre-size because an array is an
  ICollection; the second could not, and grew as it went.</code></pre>

  <p>Four decisions, each answering a different question.</p>

  <p><strong><code>All</code> returns <code>IReadOnlyList</code> backed by a stored
  <code>ReadOnlyCollection</code>.</strong> The caller gets a count and an indexer, mutation
  throws, and the wrapper is built once in the constructor so it costs nothing per call. Note it
  is still a live view — that is the trade from
  <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a>, taken knowingly.</p>

  <p><strong><code>WhereStatus</code> returns <code>IEnumerable</code>, deliberately.</strong> The
  caller may want only the first match, so evaluating all of them would be waste. The output shows
  the consequence: the same query object reported 3 and then 4 after an order was added. That is
  correct behaviour for a live filter and wrong for a report, and the return type is the only place
  that distinction is expressed.</p>

  <p><strong><code>TopBy</code> returns <code>IReadOnlyList</code> because it materialises.</strong>
  A "top 3" is a snapshot by nature — it stayed <code>O-3, O-5, O-1</code> even after a larger
  order arrived. Returning <code>IEnumerable</code> here would re-sort the whole book on every
  pass and give different answers each time.</p>

  <p><strong><code>AddRange</code> <em>takes</em> <code>IEnumerable</code>.</strong> Parameters go
  the other way from return types: accept the weakest thing that works, so callers can pass
  anything. Then type-test for what would help —
  <code>if (orders is ICollection&lt;Order&gt; c)</code> lets it pre-size, which is the same
  optimisation LINQ performs internally.</p>

  <div class="callout callout--note">
    <p><strong>The asymmetry is the whole guidance.</strong> Be <em>permissive</em> in what you
    accept — <code>IEnumerable&lt;T&gt;</code> — and <em>specific</em> about what you return.
    A return type is a promise about what the caller gets; a parameter type is a demand on what
    they must have.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Multiple enumeration</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: three passes over one query"><code>// WRONG. Each of these iterates the sequence from the start. If it is backed
// by a database query or a file read, that is three round trips.
IEnumerable&lt;Order&gt; orders = repository.GetPending();

logger.LogInformation("Found {Count} orders", orders.Count());   // pass 1
var first = orders.First();                                      // pass 2
foreach (var o in orders) Process(o);                            // pass 3</code></pre>

  <p>Measured: three passes cost 30 predicate calls where materialising first cost 10. The fix is
  one <code>ToList()</code> at the boundary — and note that IDE analysers do flag this as "possible
  multiple enumeration", which is worth not dismissing.</p>

  <h3>2. Returning a lazy sequence that reads something</h3>

  <p>The <code>ReadLines()</code> demonstration: the method returned without opening the file, and
  both the side effect and the exception happened inside the caller's <code>foreach</code>. A
  <code>try/catch</code> around the call catches nothing. If the method held a database connection
  or a file handle open across the <code>yield</code>, the caller's iteration pattern now controls
  how long the resource is held.</p>

  <h3>3. Wrapping a collection in an iterator to "keep it lazy"</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: hiding a list behind yield"><code>// WRONG. This turns a collection into a pure sequence, so Count() becomes O(n)
// and ToList() can no longer pre-size. Measured: ToList() 8.9x slower and
// 2.1x the allocation.
public IEnumerable&lt;Order&gt; All()
{
    foreach (var order in _orders) yield return order;
}

// Right: hand back the collection, wrapped if it must not be modified.
public IReadOnlyList&lt;Order&gt; All =&gt; _view;</code></pre>

  <h3>4. Trusting a type test to tell you what is writable</h3>

  <p>Every one of <code>List</code>, <code>ReadOnlyCollection</code> and an
  <code>IReadOnlyList</code>-typed variable answered <code>true</code> to
  <code>is IList&lt;T&gt;</code>. One of them throws on <code>Add</code>. The member existing and
  the call working are different questions; <code>IsReadOnly</code> is the one that answers the
  second.</p>

  <h3>5. Returning <code>IEnumerable</code> for a computed result</h3>

  <p>A "top 3" or a total is a snapshot. Returning it lazily means it is recomputed on every pass
  and can give different answers between passes if the source changed — the sort in
  <code>TopBy</code> would run again each time. Materialise anything the caller is likely to read
  more than once.</p>

  <h3>6. Modifying a collection while iterating it</h3>

  <p><code>InvalidOperationException: Collection was modified; enumeration operation may not
  execute.</code> Loop over a copy — <code>foreach (var x in items.ToList())</code> — or collect
  what to remove and apply it afterwards.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>A query runs more times than the code appears to ask for.</strong> Count the passes:
    put a counter in the predicate, as this module's examples do, and print it. Every
    <code>Count()</code>, <code>Any()</code>, <code>First()</code>, <code>ToList()</code> and
    <code>foreach</code> over a deferred sequence is one pass. If the count is a multiple of the
    element count, that multiple is how many times you enumerated.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>An exception's stack trace points at a <code>foreach</code> rather than at the
    method that failed.</strong> The sequence is lazy, and the body of the iterator method ran
    during your loop. Look at what produced the sequence, not at the loop. The same reasoning
    applies to a database connection held open longer than expected — the query executes while the
    caller iterates.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Results changed between two reads of the same variable.</strong> The variable holds a
    query, not a result. Confirm by checking its runtime type:
    <code>seq.GetType().Name</code> on a materialised result says <code>List&#96;1</code> or
    <code>Order[]</code>; on a deferred one it says something like
    <code>WhereListIterator&#96;1</code> or <code>SelectEnumerableIterator&#96;2</code>. That
    single line distinguishes a snapshot from a recipe.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong><code>ToList()</code> is slower or allocates more than expected.</strong> Check
    whether the source is a real collection. If it came through an iterator method,
    <code>ToList()</code> cannot pre-size and grows repeatedly — measured at 8.9× slower and 2.1×
    the allocation. Removing a pointless <code>yield return</code> wrapper restores it.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Deciding a return type.</strong> Answer three questions in order. <em>Has the work
    already been done?</em> If not, <code>IEnumerable&lt;T&gt;</code> is honest. <em>Will the caller
    want a count or an index?</em> If so, <code>IReadOnlyList&lt;T&gt;</code>. <em>Must the caller
    be unable to modify it?</em> Then back that with a <code>ReadOnlyCollection&lt;T&gt;</code>,
    because the interface alone is intent rather than enforcement.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>A concrete case.</strong> An order-processing service had a repository method
    <code>IEnumerable&lt;Order&gt; GetPending()</code> that returned a lazily-evaluated database
    query. The handler logged the count, took the first for a correlation id, and looped over the
    rest — the three-pass pattern above. Each pass reissued the query.</p>
    <p>At about 900 batches an hour that was 2,700 queries an hour instead of 900. The database
    was comfortable with it and nobody noticed for eight months.</p>
    <p>What made it visible was a change of behaviour rather than of speed. A retry was added
    around the handler, and duplicate orders began appearing — roughly one batch in forty. The
    sequence was live, so between the <code>Count()</code> pass and the <code>foreach</code> pass
    another instance could commit new pending orders, and the loop processed rows the count had
    never seen. The logged count and the processed count disagreed, which is what turned it from
    an invisible inefficiency into a data problem.</p>
    <p>The fix was one <code>ToList()</code> at the repository boundary: query once, snapshot,
    process that. Query volume dropped to a third, the duplicates stopped, and the logged count
    became true by construction.</p>
    <p>The deeper fix was the signature. <code>GetPending()</code> now returns
    <code>IReadOnlyList&lt;Order&gt;</code>, which says the work is done and the answer is stable —
    so the next person cannot reintroduce the bug by reading the code reasonably.</p>
  </div>

  <p>The general principle: <strong>a return type is the only place you can say whether a result is
  a fact or an instruction.</strong> <code>IEnumerable&lt;T&gt;</code> means "here is how to get
  the elements", and everything that follows — repeated work, results that change between passes,
  exceptions arriving at the loop rather than the call — follows from that one word being
  accurate.</p>

  <p>Which is why the practical rule is narrow and worth keeping: <strong>be permissive in
  parameters and specific in return types.</strong> Accept <code>IEnumerable&lt;T&gt;</code> so any
  caller can pass anything; return the strongest interface that is honest about what you actually
  produced. Returning something weaker than the truth does not add flexibility — it hides
  information the caller needs.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"Return <code>IEnumerable&lt;T&gt;</code> — it is the most flexible."</strong> It is
    the least informative. It tells the caller nothing about whether the work has been done, how
    much there is, or whether two passes agree. If you have already materialised a list, saying so
    costs nothing and prevents the multiple-enumeration bug entirely.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>IReadOnlyList&lt;T&gt;</code> means the caller cannot modify it."</strong> It
    means the interface has no mutating members. Verified: an
    <code>IReadOnlyList&lt;int&gt;</code> holding a <code>List&lt;int&gt;</code> passed
    <code>is IList&lt;int&gt;</code> and was mutated through the cast. It is a statement of intent;
    <code>ReadOnlyCollection&lt;T&gt;</code> is the enforcement.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"A type test tells me whether a collection is writable."</strong> A genuine
    <code>ReadOnlyCollection&lt;T&gt;</code> also answers <code>true</code> to
    <code>is IList&lt;T&gt;</code>, and throws <code>NotSupportedException</code> on
    <code>Add</code>. The member existing and the call succeeding are different facts;
    <code>ICollection&lt;T&gt;.IsReadOnly</code> is the one that answers the second.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Declaring a variable <code>IEnumerable</code> makes LINQ slower."</strong> Measured:
    <code>Count()</code> on an <code>IEnumerable</code> holding a <code>List</code> was as fast as
    <code>.Count</code>, because LINQ type-tests at run time and finds the
    <code>ICollection</code>. What costs is the sequence genuinely not being a collection —
    typically because someone wrapped one in an iterator method.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Lazy is always better — it avoids work."</strong> It avoids work only if the caller
    stops early. If they enumerate more than once it multiplies the work, and it makes the result
    unstable. For anything the caller will read fully, or read twice, materialising is both faster
    and more predictable.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>IReadOnlyList&lt;T&gt;</code> is the read-only version of
    <code>IList&lt;T&gt;</code>."</strong> They are separate branches, not base and derived. A
    variable typed <code>IList&lt;T&gt;</code> cannot be passed to a parameter typed
    <code>IReadOnlyList&lt;T&gt;</code> without a cast, even though every concrete list implements
    both.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Use</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td><strong>Parameter</strong> you only iterate once</td>
          <td><code>IEnumerable&lt;T&gt;</code></td>
          <td>Accepts anything. Type-test inside for <code>ICollection</code> if a count would
          help.</td></tr>
      <tr><td><strong>Parameter</strong> you need to count or index</td>
          <td><code>IReadOnlyList&lt;T&gt;</code></td>
          <td>Says so in the signature instead of enumerating to find out.</td></tr>
      <tr><td><strong>Parameter</strong> you will add to</td>
          <td><code>ICollection&lt;T&gt;</code> or <code>List&lt;T&gt;</code></td>
          <td>Mutation is part of the contract; make it visible.</td></tr>
      <tr><td><strong>Return</strong> of an already-materialised result</td>
          <td><code>IReadOnlyList&lt;T&gt;</code></td>
          <td>Honest, and prevents the multiple-enumeration bug outright.</td></tr>
      <tr><td><strong>Return</strong> that must not be modified, enforced</td>
          <td><code>IReadOnlyList&lt;T&gt;</code> over a stored
          <code>ReadOnlyCollection&lt;T&gt;</code></td>
          <td>Mutation throws. Build the wrapper once, not per call.</td></tr>
      <tr><td><strong>Return</strong> that is genuinely deferred and may not be fully consumed</td>
          <td><code>IEnumerable&lt;T&gt;</code>, documented</td>
          <td>Accurate — and the caller now needs to know it. Say so in the summary.</td></tr>
      <tr><td><strong>Return</strong> of a computed answer: a total, a top-N, a report</td>
          <td>Materialise it</td>
          <td>A snapshot is what a caller means by an answer; lazy would re-sort per pass.</td></tr>
      <tr><td>A sequence that could be enumerated more than once</td>
          <td><code>ToList()</code> at the boundary</td>
          <td>Three passes cost 3× the work and can give different answers.</td></tr>
      <tr><td>You already hold a collection</td>
          <td>Return it — never wrap it in <code>yield return</code></td>
          <td>Hiding it costs LINQ every shortcut: <code>ToList()</code> 8.9× slower.</td></tr>
      <tr><td>Removing items while looping</td>
          <td>Loop over <code>.ToList()</code>, or collect and apply after</td>
          <td>Otherwise <code>InvalidOperationException</code> mid-loop.</td></tr>
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
    <p>For each type, say which of <code>IReadOnlyCollection</code>, <code>IReadOnlyList</code>,
    <code>ICollection</code> and <code>IList</code> it implements. Two of the rows are surprising —
    identify them and say why.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>int[]
List&lt;int&gt;
HashSet&lt;int&gt;
Queue&lt;int&gt;
ReadOnlyCollection&lt;int&gt;
Enumerable.Range(0, 3).Where(x =&gt; x &gt; 0)</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>type                      IROColl  IROList  IColl  IList
int[]                         yes      yes    yes    yes
List&lt;int&gt;                     yes      yes    yes    yes
HashSet&lt;int&gt;                  yes        -    yes      -
Queue&lt;int&gt;                    yes        -      -      -
ReadOnlyCollection&lt;int&gt;       yes      yes    yes    yes
LINQ Where(...)                 -        -      -      -</code></pre>
        <p><strong>The straightforward rows.</strong> <code>HashSet</code> has no order, so no
        indexer and no <code>IReadOnlyList</code> — but it can be added to, so it is an
        <code>ICollection</code>. <code>Queue</code> is neither indexable nor an
        <code>ICollection</code>, because its whole point is that you add at one end and remove
        from the other rather than anywhere.</p>
        <p><strong>Surprise one: <code>ReadOnlyCollection&lt;int&gt;</code> implements
        <code>IList&lt;int&gt;</code>.</strong> A type with "ReadOnly" in its name implements the
        fully mutable interface. It has to, to be usable where an <code>IList</code> is expected,
        and it satisfies the contract by throwing <code>NotSupportedException</code> from every
        mutating member and reporting <code>IsReadOnly == true</code>. The consequence is that
        <strong>a type test cannot tell you whether a collection is writable</strong> — only
        <code>IsReadOnly</code> can.</p>
        <p><strong>Surprise two: the LINQ query implements none of them.</strong> Not even
        <code>IReadOnlyCollection</code>, which would only require a <code>Count</code>. That is
        correct and important: the elements do not exist yet, so there is no count to report
        without computing them. It is the type system accurately describing a thing that has not
        happened.</p>
        <p>That last row is the practical takeaway. If a method hands you an
        <code>IEnumerable&lt;T&gt;</code>, you cannot tell from the type whether it is a materialised
        list or an unevaluated query — but if it hands you an
        <code>IReadOnlyCollection&lt;T&gt;</code> or stronger, the work is necessarily already
        done.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A query filters twelve numbers. Predict how many times the predicate runs for each line, and
    explain the two that are not twelve.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>var source = Enumerable.Range(0, 12).ToList();
var q = source.Where(x =&gt; { _calls++; return x % 3 == 0; });

// a) immediately after building q
// b) q.Any()
// c) q.Count()
// d) q.Count() then q.First() then q.ToList()
// e) the same three calls, but on Tracked(source).ToList() first</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>after building the query        : 0
q.Any()                         : True, calls now 1
q.Count()                       : 4, calls 12
q.Count() + q.First() + ToList(): 4/0/4, calls 25
materialised first              : 4/0/4, calls 12</code></pre>
        <div class="table-wrap">
        <table>
          <thead><tr><th></th><th>Calls</th><th>Why</th></tr></thead>
          <tbody>
            <tr><td>a) building</td><td><strong>0</strong></td>
                <td>Deferred — nothing has run.</td></tr>
            <tr><td>b) <code>Any()</code></td><td><strong>1</strong></td>
                <td>Short-circuits at the first match, which is element 0.</td></tr>
            <tr><td>c) <code>Count()</code></td><td>12</td>
                <td>Must examine every element to count matches.</td></tr>
            <tr><td>d) three calls</td><td><strong>25</strong></td>
                <td>12 + 1 + 12 — see below.</td></tr>
            <tr><td>e) materialised</td><td>12</td>
                <td>One pass, then three passes over a <code>List</code>.</td></tr>
          </tbody>
        </table>
        </div>
        <p><strong>The two that are not twelve are the interesting ones.</strong></p>
        <p><code>Any()</code> ran the predicate <strong>once</strong>. It stops at the first element
        that matches, and 0 is divisible by 3. This is deferred execution paying off — the reason
        lazy sequences exist. Note it would have run all twelve had there been no match, so
        <code>Any()</code> is cheap on average and not guaranteed cheap.</p>
        <p><code>Count() + First() + ToList()</code> ran it <strong>25</strong> times: twelve to
        count, one for <code>First()</code> (which short-circuits like <code>Any()</code>), and
        twelve more to build the list. <strong>Three separate full evaluations of the same query
        object.</strong> Nothing in the calling code looks like it does the work three times.</p>
        <p>Materialising first brought it back to twelve — one pass over the source, then three
        cheap passes over a <code>List</code>. That single <code>ToList()</code> is the whole fix,
        and it also makes the three answers guaranteed consistent with each other, which the
        deferred version does not.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Two variables hold the same million-element list: one typed <code>IEnumerable&lt;int&gt;</code>,
    one produced by an iterator method that yields each element. Predict how
    <code>Count()</code> and <code>ToList()</code> compare on each, and explain the difference.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>Count() on IEnumerable holding a List (x2000)      0.0 ms            40 bytes
Count() on a pure IEnumerable (x3)                19.0 ms           328 bytes
ToList() from a List (x20)                        15.7 ms    80,003,656 bytes
ToList() from a pure IEnumerable (x20)           136.1 ms   167,786,056 bytes</code></pre>
        <p><strong>Declaring the variable <code>IEnumerable</code> costs nothing.</strong> Two
        thousand <code>Count()</code> calls took under a millisecond — the same as reading
        <code>.Count</code>. LINQ's <code>Count()</code> type-tests its argument at run time, finds
        <code>ICollection&lt;int&gt;</code>, and reads the property. The static type is irrelevant;
        what matters is what the object actually is.</p>
        <p><strong>The iterator method costs a great deal.</strong> Three <code>Count()</code> calls
        took 19 ms, because there is no collection to find — each call walked a million elements.
        And <code>ToList()</code> was <strong>8.7× slower and allocated 2.1× more</strong>.</p>
        <p><strong>Why <code>ToList()</code> allocates twice as much.</strong> From a
        <code>List</code>, LINQ finds the count and allocates one array of exactly the right size:
        20 iterations × 1M ints × 4 bytes ≈ 80 MB. From a sequence with no known size it must grow
        as it goes, doubling capacity and copying — so it allocates every intermediate array too,
        which sums to roughly twice the final size. That is precisely the resizing cost measured in
        <a href="#/m/t1-19-collections-overview">Collections and Their Cost Model</a>, arriving
        through a type decision rather than a missing capacity argument.</p>
        <p><strong>The practical conclusion</strong> is narrower than "avoid
        <code>IEnumerable</code>". Passing a real collection around as
        <code>IEnumerable&lt;T&gt;</code> is free. What is expensive is <em>destroying</em> the
        collection-ness by wrapping it in an iterator method — a
        <code>foreach { yield return x; }</code> that adds nothing but removes every shortcut LINQ
        would have taken.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A repository returns <code>IEnumerable&lt;Order&gt;</code> from a database query. A handler
    logs the count, takes the first for a correlation id, then processes them. After a retry was
    added, duplicate orders began appearing about one batch in forty. Explain both the performance
    problem and the correctness problem, and give the fix at two levels.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 4 — as given"><code>IEnumerable&lt;Order&gt; orders = repository.GetPending();

logger.LogInformation("Found {Count} orders", orders.Count());   // pass 1
var correlation = orders.First().Id;                             // pass 2
foreach (var o in orders) Process(o);                            // pass 3</code></pre>
        <p><strong>The performance problem: three evaluations.</strong> The sequence is deferred, so
        each of <code>Count()</code>, <code>First()</code> and the <code>foreach</code> executes the
        query from the start. At 900 batches an hour that is 2,700 queries instead of 900.
        Measured equivalent: three passes cost 25 predicate calls where one materialisation cost
        12.</p>
        <p>Note this alone is survivable — a database handles three times the queries without
        complaint, which is why it went unnoticed for months.</p>
        <p><strong>The correctness problem: the passes see different data.</strong> The sequence is
        a <em>live query</em>, not a snapshot. Between pass 1 and pass 3, another instance can
        commit new pending orders, so:</p>
        <ul>
          <li>the logged count describes a set that no longer exists;</li>
          <li>the <code>foreach</code> processes rows the count never saw;</li>
          <li>and with a retry wrapped around the handler, a partially-processed batch is
          re-queried and rows already processed are seen again — the duplicates.</li>
        </ul>
        <p>This is the same fact demonstrated by the lazy sequence that returned
        <code>2, 3, 99</code> after 99 was added to its source: <strong>a deferred sequence reflects
        its source at the moment of iteration, not at the moment of creation.</strong></p>
        <p><strong>Fix level one — at the call site:</strong></p>
<pre data-lang="csharp" data-net="10" data-title="Immediate fix"><code>IReadOnlyList&lt;Order&gt; orders = repository.GetPending().ToList();

logger.LogInformation("Found {Count} orders", orders.Count);   // the property
var correlation = orders[0].Id;
foreach (var o in orders) Process(o);</code></pre>
        <p>One query, one snapshot, three consistent reads. The count is now true by construction
        because it describes the exact list being processed.</p>
        <p><strong>Fix level two — at the signature:</strong></p>
<pre data-lang="csharp" data-net="10" data-title="The durable fix"><code>// Was: IEnumerable&lt;Order&gt; GetPending();
public IReadOnlyList&lt;Order&gt; GetPending() =&gt; _db.Orders
    .Where(o =&gt; o.Status == "pending")
    .ToList();</code></pre>
        <p>The call-site fix repairs one caller. The signature fix makes the bug unwritable: the
        return type now says the work is done and the answer is stable, so the next person cannot
        reintroduce it by reading the code reasonably. That is the difference between fixing an
        instance and fixing a category.</p>
        <p><strong>When you would keep <code>IEnumerable</code>:</strong> if the result can be very
        large and callers legitimately stop early — a streaming export, a paged scan. Then the
        laziness is the feature, and the obligations move to the caller: enumerate once, and do not
        assume two passes agree. That should be stated in the method's documentation, because the
        type cannot say it.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does each interface add to the one below it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>IEnumerable&lt;T&gt;</code>: you can walk it. <code>IReadOnlyCollection&lt;T&gt;</code>
        adds <code>Count</code> — so it has been computed. <code>IReadOnlyList&lt;T&gt;</code> adds
        an indexer — so it has a stable order. <code>ICollection&lt;T&gt;</code> adds mutation.
        <code>IList&lt;T&gt;</code> adds mutation at a position.</p>
      </div></details>
    </li>
    <li>
      <p>Is <code>IReadOnlyList&lt;T&gt;</code> a base of <code>IList&lt;T&gt;</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No</strong> — they are separate branches that both extend
        <code>IEnumerable&lt;T&gt;</code>. So a variable typed <code>IList&lt;T&gt;</code> cannot be
        passed where <code>IReadOnlyList&lt;T&gt;</code> is expected without a cast, even though
        every concrete list implements both.</p>
      </div></details>
    </li>
    <li>
      <p>Which interfaces does a LINQ query implement, and why does that matter?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Only <code>IEnumerable&lt;T&gt;</code></strong> — not even
        <code>IReadOnlyCollection</code>, because there is no count to report without computing the
        elements. It is the type system honestly describing something that has not happened
        yet.</p>
      </div></details>
    </li>
    <li>
      <p>Does <code>is IList&lt;T&gt;</code> tell you a collection is writable?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No.</strong> A genuine <code>ReadOnlyCollection&lt;T&gt;</code> answers
        <code>true</code> and throws <code>NotSupportedException</code> on <code>Add</code>. The
        member existing and the call succeeding are different facts;
        <code>ICollection&lt;T&gt;.IsReadOnly</code> answers the second.</p>
      </div></details>
    </li>
    <li>
      <p>How many predicate calls for <code>Any()</code>, for <code>Count()</code>, and for the
      three-call sequence?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Any()</code>: <strong>1</strong> — it short-circuits at the first match.
        <code>Count()</code>: <strong>12</strong> — it must see everything.
        <code>Count() + First() + ToList()</code>: <strong>25</strong>, three separate evaluations.
        Materialising first: <strong>12</strong>.</p>
      </div></details>
    </li>
    <li>
      <p>Where do a lazy sequence's side effects and exceptions happen?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>During iteration</strong>, not at the call. The demonstration's method returned
        without opening the file; both the open and the exception happened inside the caller's
        <code>foreach</code> — so a <code>try/catch</code> around the call catches nothing and the
        stack trace points at the loop.</p>
      </div></details>
    </li>
    <li>
      <p>Does declaring a variable <code>IEnumerable&lt;T&gt;</code> make LINQ slower?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No.</strong> <code>Count()</code> on an <code>IEnumerable</code> holding a
        <code>List</code> matched <code>.Count</code> — LINQ type-tests at run time and finds the
        <code>ICollection</code>. What costs is the object genuinely not being a collection.</p>
      </div></details>
    </li>
    <li>
      <p>What did wrapping a list in an iterator method cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>ToList()</code> went <strong>8.7× slower and allocated 2.1× more</strong> (136 ms
        and 168 MB against 16 ms and 80 MB), because it could no longer pre-size and had to grow
        repeatedly. Three <code>Count()</code> calls went from free to 19 ms.</p>
      </div></details>
    </li>
    <li>
      <p>State the asymmetry between parameter types and return types.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Permissive in what you accept, specific about what you return.</strong> Take
        <code>IEnumerable&lt;T&gt;</code> so any caller can pass anything; return the strongest
        interface that is honest about what you produced. Returning something weaker hides
        information the caller needs.</p>
      </div></details>
    </li>
    <li>
      <p>How do you tell a snapshot from a recipe at run time?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Check the runtime type: <code>seq.GetType().Name</code>. A materialised result reports
        <code>List&#96;1</code> or <code>Order[]</code>; a deferred one reports something like
        <code>WhereListIterator&#96;1</code>. One line, and it settles the question.</p>
      </div></details>
    </li>
    <li>
      <p>Why did a retry turn a long-standing inefficiency into duplicate data?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The sequence was a <strong>live query</strong>, so passes taken at different moments saw
        different rows. The logged count described a set that no longer existed, the loop processed
        rows the count never saw, and a retry re-queried and reprocessed rows already handled.
        Three evaluations was survivable; three <em>inconsistent</em> evaluations was not.</p>
      </div></details>
    </li>
    <li>
      <p>When is returning <code>IEnumerable&lt;T&gt;</code> the right choice?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the result is genuinely deferred and callers may legitimately stop early — a
        streaming export, a paged scan. Then laziness is the feature, and the obligations move to
        the caller: enumerate once, do not assume two passes agree. Say so in the documentation,
        because the type cannot.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
