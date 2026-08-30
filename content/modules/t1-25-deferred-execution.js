CSPREP.module({
  id: "t1-25-deferred-execution",
  minutes: 55,
  updated: "2026-08-30",
  summary: "A LINQ query is a recipe, not a result: nothing happens until something enumerates it, and everything happens again on the next enumeration. That single fact explains the multiple-enumeration bug, the query that reads a variable changed after it was written, the query that outlives the connection it reads from, and the 2.7x a pipeline costs against a loop.",
  terms: ["deferred execution", "lazy evaluation", "eager evaluation", "materialise",
    "multiple enumeration", "streaming operator", "buffering operator", "pipeline",
    "iterator object", "short-circuit", "closure capture", "query variable",
    "ObjectDisposedException", "side effect", "operator order"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A method takes a sequence of records and prints a summary — a count, a sum, a maximum. It has
  worked for a year. A caller changes from passing a list to passing the result of a filter, and the
  endpoint's response time triples. Nothing in the method changed. Nothing in the filter is slow.</p>

  <p>Elsewhere, a repository method opens a connection, reads rows, and returns the projected
  results. Its unit test passes. In production it throws
  <code>ObjectDisposedException</code> — from a line that ran successfully, inside a
  <code>using</code> block that had already closed cleanly.</p>

  <p>And a query defined at the top of a method gives a different answer at the bottom of the same
  method, without being reassigned, because a variable it mentions was changed in between.</p>

  <p>All three have one cause. <strong>A LINQ query is not a result. It is a recipe, and it is
  executed by whoever reads it, whenever they read it, however many times they read it.</strong>
  <a href="#/m/t1-20-ienumerable-vs-icollection">IEnumerable vs ICollection vs IList vs
  IReadOnly*</a> introduced that from the interface side — what a return type promises.
  <a href="#/m/t1-24-linq-fundamentals">LINQ: Both Syntaxes</a> grouped the operators by whether
  they defer. This module is about what it costs and how it fails.</p>
</section>

<section id="when-it-runs">
  <h2>When the work actually happens</h2>

  <p class="define"><span class="define__term">Deferred execution</span> The work described by a
  query does not happen when the query is written. It happens when something enumerates the
  query — a <code>foreach</code>, a <code>ToList</code>, a <code>Count</code>, or anything else that
  asks for elements. Also called <span class="define__term">lazy evaluation</span>. The opposite,
  <span class="define__term">eager evaluation</span>, does the work immediately.</p>

  <p class="define"><span class="define__term">Query variable</span> A variable holding a query
  rather than its results. <code>var q = xs.Where(…)</code> makes <code>q</code> a query variable:
  it names the recipe, and <code>q</code> is a different thing from
  <code>xs.Where(…).ToList()</code> even though both look like "the filtered items".</p>

  <p class="define"><span class="define__term">Materialise</span> To run a query and keep the
  results — <code>ToList</code>, <code>ToArray</code>, <code>ToDictionary</code>. After
  materialising you hold data; before, you hold instructions.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-when-it-runs.cs"><code>// 01-when-it-runs.cs — when the work in a LINQ query actually happens, and in
// what order the operators run. Every claim printed here is observed, not asserted:
// the lambdas log each time they are called.
// .NET 10.0.400. Run: dotnet run 01-when-it-runs.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- defining a query runs nothing ---");
        var log = new List&lt;string&gt;();
        var source = new[] { 1, 2, 3, 4 };

        var q = source
            .Where(n =&gt; { log.Add($"where({n})"); return n % 2 == 0; })
            .Select(n =&gt; { log.Add($"select({n})"); return n * 10; });

        Console.WriteLine($"  after defining the query, lambdas called: {log.Count}");

        var results = q.ToList();
        Console.WriteLine($"  after ToList(), lambdas called       : {log.Count}");
        Console.WriteLine($"  results                              : {string.Join(", ", results)}");

        Console.WriteLine();
        Console.WriteLine("--- the order shows the pipeline pulls ONE element at a time ---");
        Console.WriteLine($"  {string.Join(" ", log)}");
        Console.WriteLine("  Not 'all the wheres, then all the selects'. Each element is");
        Console.WriteLine("  pulled through the whole chain before the next one starts.");

        Console.WriteLine();
        Console.WriteLine("--- a query reads its source at ENUMERATION time ---");
        var list = new List&lt;int&gt; { 1, 2, 3 };
        var live = list.Select(n =&gt; n * 100);
        Console.WriteLine($"  before adding : {string.Join(", ", live)}");
        list.Add(4);
        Console.WriteLine($"  after adding  : {string.Join(", ", live)}");
        Console.WriteLine("  The query was defined before 4 existed and still saw it.");

        var snapshot = list.Select(n =&gt; n * 100).ToList();
        list.Add(5);
        Console.WriteLine($"  ToList snapshot after another Add : {string.Join(", ", snapshot)}");
        Console.WriteLine("  ToList ran once and kept the answer. It cannot see the 5.");

        Console.WriteLine();
        Console.WriteLine("--- mutating the source DURING enumeration throws ---");
        try
        {
            foreach (var n in list.Where(n =&gt; n &gt; 0))
            {
                if (n == 1) list.Add(99);
            }
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  InvalidOperationException: {ex.Message}");
        }
        Console.WriteLine("  The deferred query holds an enumerator over the live list,");
        Console.WriteLine("  so the collection-modified check fires the same as in foreach.");

        Console.WriteLine();
        Console.WriteLine("--- Take stops the source early: the pipeline is pull-driven ---");
        var pulled = 0;
        IEnumerable&lt;int&gt; Counting()
        {
            for (var i = 1; i &lt;= 1_000_000; i++) { pulled++; yield return i; }
        }
        var firstThree = Counting().Where(n =&gt; n % 2 == 0).Take(3).ToList();
        Console.WriteLine($"  results        : {string.Join(", ", firstThree)}");
        Console.WriteLine($"  source elements pulled : {pulled} (of 1,000,000 available)");
        Console.WriteLine("  Nothing asked for the rest, so nothing produced them.");

        Console.WriteLine();
        Console.WriteLine("--- but OrderBy has to see everything before it yields anything ---");
        pulled = 0;
        var sortedFirst = Counting().OrderBy(n =&gt; -n).Take(3).ToList();
        Console.WriteLine($"  results        : {string.Join(", ", sortedFirst)}");
        Console.WriteLine($"  source elements pulled : {pulled}");
        Console.WriteLine("  OrderBy is deferred but not streaming: it buffers the entire");
        Console.WriteLine("  source into an array before it can produce a first element.");
        Console.WriteLine("  Same for GroupBy, Distinct's dedup set, Reverse and ToLookup.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- defining a query runs nothing ---
  after defining the query, lambdas called: 0
  after ToList(), lambdas called       : 6
  results                              : 20, 40

--- the order shows the pipeline pulls ONE element at a time ---
  where(1) where(2) select(2) where(3) where(4) select(4)
  Not 'all the wheres, then all the selects'. Each element is
  pulled through the whole chain before the next one starts.

--- a query reads its source at ENUMERATION time ---
  before adding : 100, 200, 300
  after adding  : 100, 200, 300, 400
  The query was defined before 4 existed and still saw it.
  ToList snapshot after another Add : 100, 200, 300, 400
  ToList ran once and kept the answer. It cannot see the 5.

--- mutating the source DURING enumeration throws ---
  InvalidOperationException: Collection was modified; enumeration operation may not execute.
  The deferred query holds an enumerator over the live list,
  so the collection-modified check fires the same as in foreach.

--- Take stops the source early: the pipeline is pull-driven ---
  results        : 2, 4, 6
  source elements pulled : 6 (of 1,000,000 available)
  Nothing asked for the rest, so nothing produced them.

--- but OrderBy has to see everything before it yields anything ---
  results        : 1000000, 999999, 999998
  source elements pulled : 1000000
  OrderBy is deferred but not streaming: it buffers the entire
  source into an array before it can produce a first element.
  Same for GroupBy, Distinct's dedup set, Reverse and ToLookup.</code></pre>

  <p><strong>Zero lambda calls after defining the query.</strong> That is the whole idea in one
  number. The <code>Where</code> and <code>Select</code> calls built three small objects and
  returned; the predicate had not been asked a question yet.</p>

  <h3>The pipeline runs element by element, not stage by stage</h3>

  <p>The call log is <code>where(1) where(2) select(2) where(3) where(4) select(4)</code>. It is not
  four <code>where</code> calls followed by two <code>select</code> calls. Each element is pulled all
  the way through the chain before the next one starts.</p>

  <p class="define"><span class="define__term">Pipeline</span> The chain of operators a query builds.
  Each operator holds a reference to the one before it and asks that one for elements as needed. The
  <em>last</em> operator is driven by whoever enumerates, and the demand propagates backwards to the
  source.</p>

  <p>That "pull" direction explains everything else in this module. <code>Take(3)</code> stopped a
  million-element source after <strong>6 elements</strong>, because nothing asked for a seventh.
  Nobody wrote that optimisation — it falls out of the source only producing what it is asked
  for.</p>

  <h3>Not every operator can stream</h3>

  <p class="define"><span class="define__term">Streaming operator</span> One that can produce its
  first result after reading one element: <code>Where</code>, <code>Select</code>,
  <code>Take</code>, <code>Skip</code>, <code>Concat</code>, <code>SelectMany</code>.
  <span class="define__term">Buffering operator</span> one that must read the entire source before it
  can produce anything: <code>OrderBy</code>, <code>GroupBy</code>, <code>Reverse</code>,
  <code>ToLookup</code>, and <code>Distinct</code>'s duplicate set.</p>

  <p>Both kinds are deferred — neither does anything until enumerated. The difference shows the
  moment enumeration starts. <code>Take(3)</code> after a <code>Where</code> pulled 6 elements;
  <code>Take(3)</code> after an <code>OrderBy</code> pulled <strong>all 1,000,000</strong>, because
  the third-largest element cannot be known without seeing every element.</p>

  <div class="callout callout--note">
    <p><strong>"Deferred" and "streaming" are different properties.</strong> Deferred means
    <em>nothing happens until you enumerate</em>. Streaming means <em>once you enumerate, results
    come out before the source is exhausted</em>. <code>OrderBy</code> is deferred and not
    streaming, which is exactly the combination that surprises people: it looks free until it is
    enumerated, and then it costs everything at once.</p>
  </div>
</section>

<section id="multiple-enumeration">
  <h2>Multiple enumeration</h2>

  <p class="define"><span class="define__term">Multiple enumeration</span> Enumerating the same
  deferred query more than once. Each enumeration re-runs the entire pipeline from the source. The
  results are usually identical, so nothing looks wrong; the cost is paid every time.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-multiple-enumeration.cs"><code>// 02-multiple-enumeration.cs — the cost of enumerating a deferred query more than
// once, measured by counting how many times the work actually happens.
// .NET 10.0.400. Run: dotnet run 02-multiple-enumeration.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Program
{
    static int _calls;

    // Stands in for anything the query cannot see the cost of: a database round
    // trip, a file read, a decode. Here it just burns time so it is measurable.
    static bool ExpensivePredicate(int n)
    {
        _calls++;
        var acc = 0;
        for (var i = 0; i &lt; 2_000; i++) acc += i % 7;
        return acc &gt;= 0 &amp;&amp; n % 3 == 0;
    }

    static void Main()
    {
        var source = Enumerable.Range(1, 3_000).ToArray();

        Console.WriteLine("--- one query, three uses: the work happens three times ---");
        _calls = 0;
        var q = source.Where(ExpensivePredicate);

        var sw = Stopwatch.StartNew();
        var count = q.Count();
        var first = q.First();
        var total = q.Sum();
        sw.Stop();

        Console.WriteLine($"  Count={count} First={first} Sum={total}");
        Console.WriteLine($"  predicate calls : {_calls}");
        Console.WriteLine($"  elapsed         : {sw.Elapsed.TotalMilliseconds:0.0} ms");
        Console.WriteLine("  Three uses of one variable. First() stopped early, which is");
        Console.WriteLine("  why the total is not exactly 3 x 3000.");

        Console.WriteLine();
        Console.WriteLine("--- materialise once, use three times ---");
        _calls = 0;
        sw.Restart();
        var materialised = source.Where(ExpensivePredicate).ToList();
        count = materialised.Count;
        first = materialised[0];
        total = materialised.Sum();
        sw.Stop();

        Console.WriteLine($"  Count={count} First={first} Sum={total}");
        Console.WriteLine($"  predicate calls : {_calls}");
        Console.WriteLine($"  elapsed         : {sw.Elapsed.TotalMilliseconds:0.0} ms");
        Console.WriteLine("  Same three answers. One pass over the data.");

        Console.WriteLine();
        Console.WriteLine("--- the same trap hidden behind a method boundary ---");
        _calls = 0;
        Report(source.Where(ExpensivePredicate));
        Console.WriteLine($"  predicate calls : {_calls}");
        Console.WriteLine("  Report() looks like it takes a collection. It takes a recipe,");
        Console.WriteLine("  and it runs that recipe once per parameter use.");

        Console.WriteLine();
        Console.WriteLine("--- Any() vs Count() &gt; 0 on a deferred query ---");
        _calls = 0;
        var anyResult = source.Where(ExpensivePredicate).Any();
        var anyCalls = _calls;
        _calls = 0;
        var countResult = source.Where(ExpensivePredicate).Count() &gt; 0;
        Console.WriteLine($"  Any()       : {anyResult,-5} predicate calls: {anyCalls}");
        Console.WriteLine($"  Count() &gt; 0 : {countResult,-5} predicate calls: {_calls}");
        Console.WriteLine("  Any() stops at the first match. Count() has to see everything.");

        Console.WriteLine();
        Console.WriteLine("--- Count() is not always a full pass ---");
        var asList = source.ToList();
        IEnumerable&lt;int&gt; asSequence = asList;
        sw.Restart();
        for (var i = 0; i &lt; 100_000; i++) _ = asSequence.Count();
        sw.Stop();
        Console.WriteLine($"  Count() on a List&lt;int&gt; seen as IEnumerable&lt;int&gt;, 100k times:");
        Console.WriteLine($"    {sw.Elapsed.TotalMilliseconds:0.0} ms");
        var filtered = asList.Where(n =&gt; n &gt; 0);
        sw.Restart();
        for (var i = 0; i &lt; 100_000; i++) _ = filtered.Count();
        sw.Stop();
        Console.WriteLine($"  Count() on the same list with a Where in front, 100k times:");
        Console.WriteLine($"    {sw.Elapsed.TotalMilliseconds:0.0} ms");
        Console.WriteLine("  Count() checks for ICollection&lt;T&gt; and reads .Count in O(1).");
        Console.WriteLine("  One Where in front removes that fast path: it is O(n) again.");
    }

    static void Report(IEnumerable&lt;int&gt; items)
    {
        Console.WriteLine($"  count : {items.Count()}");
        Console.WriteLine($"  sum   : {items.Sum()}");
        Console.WriteLine($"  max   : {items.Max()}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- one query, three uses: the work happens three times ---
  Count=1000 First=3 Sum=1501500
  predicate calls : 6003
  elapsed         : 105.9 ms
  Three uses of one variable. First() stopped early, which is
  why the total is not exactly 3 x 3000.

--- materialise once, use three times ---
  Count=1000 First=3 Sum=1501500
  predicate calls : 3000
  elapsed         : 58.0 ms
  Same three answers. One pass over the data.

--- the same trap hidden behind a method boundary ---
  count : 1000
  sum   : 1501500
  max   : 3000
  predicate calls : 9000
  Report() looks like it takes a collection. It takes a recipe,
  and it runs that recipe once per parameter use.

--- Any() vs Count() &gt; 0 on a deferred query ---
  Any()       : True  predicate calls: 3
  Count() &gt; 0 : True  predicate calls: 3000
  Any() stops at the first match. Count() has to see everything.

--- Count() is not always a full pass ---
  Count() on a List&lt;int&gt; seen as IEnumerable&lt;int&gt;, 100k times:
    34.0 ms
  Count() on the same list with a Where in front, 100k times:
    1765.7 ms
  Count() checks for ICollection&lt;T&gt; and reads .Count in O(1).
  One Where in front removes that fast path: it is O(n) again.</code></pre>

  <p><strong>6,003 predicate calls for 3,000 elements.</strong> <code>Count()</code> ran the filter
  over everything, <code>First()</code> ran it three times and stopped, <code>Sum()</code> ran it
  over everything again. Identical answers, and the results were identical to the materialised
  version — which is precisely why this survives code review.</p>

  <p><strong>The method-boundary version is worse: 9,000 calls.</strong>
  <code>Report(IEnumerable&lt;int&gt; items)</code> uses its parameter three times and has no way to
  know whether it was handed a list or a recipe. The caller sees a method taking a sequence; the
  method sees a sequence. Neither sees the triple cost.</p>

  <p>This is the first incident at the top of the module. Nothing in the method changed and nothing
  in the filter is slow — <strong>the caller changed from passing data to passing
  instructions</strong>, and a method that reads its parameter three times started doing the work
  three times.</p>

  <h3>Short-circuiting is the other side of the same coin</h3>

  <p class="define"><span class="define__term">Short-circuit</span> Stopping as soon as the answer is
  known. <code>Any</code>, <code>First</code>, <code>FirstOrDefault</code>, <code>Take</code> and
  <code>All</code> (on the first failure) all do it, because the pull model lets them stop asking.</p>

  <p>Measured: <code>Any()</code> cost <strong>3 predicate calls</strong>;
  <code>Count() &gt; 0</code> cost <strong>3,000</strong>. Same boolean, a thousandfold difference in
  work, and it is entirely mechanical — <code>Count</code> cannot know it is being compared to
  zero.</p>

  <h3><code>Count()</code> is sometimes free and sometimes not</h3>

  <p><code>Enumerable.Count</code> checks whether its source implements
  <code>ICollection&lt;T&gt;</code> and, if so, reads the <code>Count</code> property. Measured over
  100,000 calls: <strong>34 ms</strong> on a <code>List&lt;int&gt;</code> viewed as
  <code>IEnumerable&lt;int&gt;</code>, against <strong>1,765.7 ms</strong> with a single
  <code>Where</code> in front — <strong>52× slower</strong>, because <code>Where</code>'s result is
  not an <code>ICollection&lt;T&gt;</code> and there is nothing to read but the elements.</p>

  <div class="callout callout--gotcha">
    <p><strong>The fast path is invisible at the call site.</strong> <code>items.Count()</code> is
    the same source text whether it is an O(1) property read or an O(n) walk of a filter chain. That
    is the trap in
    <a href="#/m/t1-20-ienumerable-vs-icollection">IEnumerable vs ICollection vs IList vs
    IReadOnly*</a> stated in time rather than in types: an <code>IEnumerable&lt;T&gt;</code>
    parameter tells you nothing about what any operation on it will cost.</p>
  </div>
</section>

<section id="capture">
  <h2>What a query captures</h2>

  <p>A query holds its lambdas, and its lambdas hold their closures. Since the lambdas run at
  enumeration time, they read the closure's state <em>then</em> — not when the query was written.
  <a href="#/m/t1-22-lambdas-and-closures">Lambdas and Closures</a> established that a closure
  captures the variable rather than its value; deferral is what makes that observable.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-capture-in-queries.cs"><code>// 04-capture-in-queries.cs — what a deferred query captures, and the three ways
// that combination bites: a variable changed after the query is built, a query
// built in a loop, and a query outliving the resource it reads from.
// .NET 10.0.400. Run: dotnet run 04-capture-in-queries.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static void Main()
    {
        var source = new[] { 1, 2, 3, 4, 5, 6 };

        Console.WriteLine("--- a query captures the VARIABLE, not its value ---");
        var threshold = 3;
        var q = source.Where(n =&gt; n &gt; threshold);
        Console.WriteLine($"  threshold = 3 : {string.Join(", ", q)}");
        threshold = 5;
        Console.WriteLine($"  threshold = 5 : {string.Join(", ", q)}");
        Console.WriteLine("  Same query variable, different answers. The lambda holds a");
        Console.WriteLine("  reference to the closure field, and it is read at enumeration.");

        Console.WriteLine();
        Console.WriteLine("--- the same thing, materialised ---");
        threshold = 3;
        var fixedResult = source.Where(n =&gt; n &gt; threshold).ToList();
        threshold = 5;
        Console.WriteLine($"  after ToList and threshold = 5 : {string.Join(", ", fixedResult)}");
        Console.WriteLine("  ToList ran the predicate while threshold was still 3.");

        Console.WriteLine();
        Console.WriteLine("--- queries built in a loop: the foreach variable is per-iteration ---");
        var perIteration = new List&lt;IEnumerable&lt;int&gt;&gt;();
        foreach (var limit in new[] { 2, 4, 6 })
            perIteration.Add(source.Where(n =&gt; n &lt; limit));
        Console.WriteLine("  built with foreach:");
        foreach (var built in perIteration)
            Console.WriteLine($"    {string.Join(", ", built)}");
        Console.WriteLine("  Three different answers: since C# 5 each foreach iteration");
        Console.WriteLine("  gets a fresh variable, so each query captured its own.");

        Console.WriteLine();
        Console.WriteLine("--- a for loop shares ONE variable across all iterations ---");
        var shared = new List&lt;IEnumerable&lt;int&gt;&gt;();
        for (var limit = 2; limit &lt;= 6; limit += 2)
            shared.Add(source.Where(n =&gt; n &lt; limit));
        Console.WriteLine("  built with for:");
        foreach (var built in shared)
            Console.WriteLine($"    {string.Join(", ", built)}");
        Console.WriteLine("  All three identical, and all three use the value the loop");
        Console.WriteLine("  variable ended on (8), because there is one variable.");

        Console.WriteLine();
        Console.WriteLine("  the fix is a per-iteration copy:");
        var copied = new List&lt;IEnumerable&lt;int&gt;&gt;();
        for (var limit = 2; limit &lt;= 6; limit += 2)
        {
            var local = limit;
            copied.Add(source.Where(n =&gt; n &lt; local));
        }
        foreach (var built in copied)
            Console.WriteLine($"    {string.Join(", ", built)}");

        Console.WriteLine();
        Console.WriteLine("--- a deferred query that outlives its source ---");
        IEnumerable&lt;string&gt; leaked;
        using (var reader = new FakeReader())
        {
            leaked = reader.Lines().Select(l =&gt; l.ToUpperInvariant());
            Console.WriteLine($"  inside the using : {string.Join(", ", leaked)}");
        }
        try
        {
            Console.WriteLine($"  after the using  : {string.Join(", ", leaked)}");
        }
        catch (ObjectDisposedException ex)
        {
            Console.WriteLine($"  after the using  : ObjectDisposedException ({ex.ObjectName})");
        }
        Console.WriteLine("  Returning a deferred query from a method that owns a resource");
        Console.WriteLine("  hands the caller something that cannot work. ToList() before");
        Console.WriteLine("  the using block closes is the fix.");

        Console.WriteLine();
        Console.WriteLine("--- the query does not have to be enumerated at all ---");
        var ran = false;
        var never = source.Select(n =&gt; { ran = true; return n; });
        Console.WriteLine($"  query built, ran = {ran}");
        Console.WriteLine("  A query nobody enumerates does nothing. That is the same");
        Console.WriteLine("  reason a Select used purely for its side effects is a bug:");
        Console.WriteLine("  it looks like a loop and executes like a definition.");
    }
}

sealed class FakeReader : IDisposable
{
    private bool _disposed;
    public void Dispose() =&gt; _disposed = true;

    public IEnumerable&lt;string&gt; Lines()
    {
        foreach (var line in new[] { "alpha", "beta" })
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            yield return line;
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- a query captures the VARIABLE, not its value ---
  threshold = 3 : 4, 5, 6
  threshold = 5 : 6
  Same query variable, different answers. The lambda holds a
  reference to the closure field, and it is read at enumeration.

--- the same thing, materialised ---
  after ToList and threshold = 5 : 4, 5, 6
  ToList ran the predicate while threshold was still 3.

--- queries built in a loop: the foreach variable is per-iteration ---
  built with foreach:
    1
    1, 2, 3
    1, 2, 3, 4, 5
  Three different answers: since C# 5 each foreach iteration
  gets a fresh variable, so each query captured its own.

--- a for loop shares ONE variable across all iterations ---
  built with for:
    1, 2, 3, 4, 5, 6
    1, 2, 3, 4, 5, 6
    1, 2, 3, 4, 5, 6
  All three identical, and all three use the value the loop
  variable ended on (8), because there is one variable.

  the fix is a per-iteration copy:
    1
    1, 2, 3
    1, 2, 3, 4, 5

--- a deferred query that outlives its source ---
  inside the using : ALPHA, BETA
  after the using  : ObjectDisposedException (FakeReader)
  Returning a deferred query from a method that owns a resource
  hands the caller something that cannot work. ToList() before
  the using block closes is the fix.

--- the query does not have to be enumerated at all ---
  query built, ran = False
  A query nobody enumerates does nothing. That is the same
  reason a Select used purely for its side effects is a bug:
  it looks like a loop and executes like a definition.</code></pre>

  <p><strong>One query variable, two different answers.</strong> <code>q</code> was never
  reassigned; <code>threshold</code> was. The materialised version kept <code>4, 5, 6</code> because
  <code>ToList</code> ran the predicate while <code>threshold</code> was still 3. That is the third
  incident at the top of the module, and it is not a LINQ quirk — it is a closure being read late.</p>

  <h3>The loop-variable difference is still there, and deferral makes it worse</h3>

  <p><code>foreach</code> gives each iteration a fresh variable, so three queries built in a
  <code>foreach</code> captured three different limits and gave three different answers. A
  <code>for</code> loop has <strong>one</strong> variable for all iterations, so all three queries
  gave the same answer using the value the loop ended on.</p>

  <p>Without deferral this would be harmless: the query would have run during the iteration that
  built it, while the variable still held the right value. Deferral moves every execution to after
  the loop, where the shared variable holds only its final value.</p>

  <h3>A query outliving the thing it reads from</h3>

  <p>The <code>using</code> block enumerated the query successfully and printed
  <code>ALPHA, BETA</code>. After the block closed, the same query threw
  <code>ObjectDisposedException</code>. Nothing about the query changed — the resource it pulls from
  was disposed, and the query only pulls when enumerated.</p>

  <p>That is the second incident at the top of the module, and it explains why the unit test passed:
  a test that enumerates inside the method's lifetime never reaches the failing case. The signature
  is what makes it dangerous:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: returning a query over a disposed resource"><code>// WRONG. The using block closes before the caller enumerates anything.
public IEnumerable&lt;string&gt; GetNames()
{
    using var store = new FakeStore();
    return store.Names().Select(n =&gt; n.ToUpperInvariant());
}

// Right: run it while the resource is alive.
public IReadOnlyList&lt;string&gt; GetNames()
{
    using var store = new FakeStore();
    return store.Names().Select(n =&gt; n.ToUpperInvariant()).ToList();
}</code></pre>

  <p>The <code>IReadOnlyList&lt;string&gt;</code> return type in the fixed version is doing real
  work, in the sense
  <a href="#/m/t1-20-ienumerable-vs-icollection">IEnumerable vs ICollection vs IList vs
  IReadOnly*</a> established: it promises the caller that the work is already done. An
  <code>IEnumerable&lt;T&gt;</code> return from a method that owns a resource is a promise the method
  cannot keep.</p>
</section>

<section id="cost">
  <h2>What a pipeline costs</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-allocation-and-cost.cs"><code>// 03-allocation-and-cost.cs — what a LINQ pipeline allocates and what it costs
// against the equivalent loop. Allocation from GC.GetAllocatedBytesForCurrentThread,
// time from Stopwatch with a warm-up pass. Release build.
// .NET 10.0.400. Run: dotnet run 03-allocation-and-cost.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

record Reading(int SensorId, double Value);

class Program
{
    const int N = 200_000;
    const int Reps = 200;

    static Reading[] _data = Array.Empty&lt;Reading&gt;();
    static double _sink;   // a double field, so storing a result never boxes

    static void Main()
    {
        var rng = new Random(20260830);
        _data = Enumerable.Range(0, N)
            .Select(i =&gt; new Reading(i % 50, rng.NextDouble() * 100))
            .ToArray();

        Console.WriteLine($"data: {N:N0} readings, {Reps} repetitions per measurement");
        Console.WriteLine();

        Console.WriteLine("--- allocation for ONE pass ---");
        Console.WriteLine($"  linq pipeline (Where+Select+Sum) : {AllocOnce(LinqSum),6} bytes");
        Console.WriteLine($"  foreach loop, same result        : {AllocOnce(LoopSum),6} bytes");
        Console.WriteLine($"  linq over an array via IEnumerable: {AllocOnce(LinqSumBoxed),6} bytes");
        Console.WriteLine("  The pipeline allocates a small fixed number of iterator objects,");
        Console.WriteLine("  not one per element. It does not scale with N.");

        Console.WriteLine();
        Console.WriteLine("--- allocation that DOES scale with N ---");
        Console.WriteLine($"  Select to an anonymous type, then Sum : {AllocOnce(LinqProjectSum):N0} bytes");
        Console.WriteLine($"  ToList() of {N:N0} readings           : {AllocOnce(LinqToList):N0} bytes");
        Console.WriteLine("  A projection to a reference type allocates per element, and");
        Console.WriteLine("  ToList allocates the backing array plus its growth doublings.");

        Console.WriteLine();
        Console.WriteLine("--- time for the same answer ---");
        var linqBoxed = Time(LinqSumBoxed);
        var linq = Time(LinqSum);
        var loop = Time(LoopSum);
        Console.WriteLine($"  foreach loop                     : {loop,7:0.00} ms/pass");
        Console.WriteLine($"  linq on the array                : {linq,7:0.00} ms/pass  ({linq / loop:0.0}x)");
        Console.WriteLine($"  linq through IEnumerable&lt;Reading&gt; : {linqBoxed,7:0.00} ms/pass  ({linqBoxed / loop:0.0}x)");
        Console.WriteLine($"  per element: loop {loop * 1e6 / N:0.0} ns, linq {linq * 1e6 / N:0.0} ns");

        Console.WriteLine();
        Console.WriteLine("--- where the difference comes from ---");
        Console.WriteLine("  Every element crosses two delegate calls (the Where predicate");
        Console.WriteLine("  and the Select projection) plus two interface MoveNext calls.");
        Console.WriteLine("  The loop has none of those: the JIT inlines the body and");
        Console.WriteLine("  iterates the array with a bounds-checked index.");

        Console.WriteLine();
        Console.WriteLine("--- and where it does NOT matter ---");
        var small = _data.Take(100).ToArray();
        var swS = Stopwatch.StartNew();
        double acc = 0;
        for (var r = 0; r &lt; Reps; r++)
            acc += small.Where(x =&gt; x.SensorId == 7).Select(x =&gt; x.Value).Sum();
        swS.Stop();
        Console.WriteLine($"  the same pipeline over 100 elements: " +
                          $"{swS.Elapsed.TotalMilliseconds / Reps * 1000:0.0} us/pass");
        Console.WriteLine("  On a hundred elements the whole pipeline is under a few");
        Console.WriteLine("  microseconds. The cost is real and it is also usually irrelevant.");
        Console.WriteLine($"  (checksum {acc:0}, printed so the loop cannot be optimised away)");
    }

    static double LinqSum() =&gt;
        _data.Where(x =&gt; x.SensorId == 7).Select(x =&gt; x.Value).Sum();

    static double LinqSumBoxed()
    {
        IEnumerable&lt;Reading&gt; seq = _data;
        return seq.Where(x =&gt; x.SensorId == 7).Select(x =&gt; x.Value).Sum();
    }

    static double LoopSum()
    {
        double total = 0;
        foreach (var x in _data)
            if (x.SensorId == 7) total += x.Value;
        return total;
    }

    static double LinqProjectSum() =&gt;
        _data.Select(x =&gt; new { x.SensorId, Doubled = x.Value * 2 }).Sum(x =&gt; x.Doubled);

    static double LinqToList() =&gt; _data.Where(x =&gt; x.Value &gt; 0).ToList().Count;

    static long AllocOnce(Func&lt;double&gt; f)
    {
        f();                                   // warm up: JIT, and any first-call caches
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        var r = f();
        var after = GC.GetAllocatedBytesForCurrentThread();
        _sink = r;
        return after - before;
    }

    static double Time(Func&lt;double&gt; f)
    {
        for (var i = 0; i &lt; 20; i++) f();       // warm up
        var sw = Stopwatch.StartNew();
        double acc = 0;
        for (var r = 0; r &lt; Reps; r++) acc += f();
        sw.Stop();
        _sink = acc;
        return sw.Elapsed.TotalMilliseconds / Reps;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>data: 200,000 readings, 200 repetitions per measurement

--- allocation for ONE pass ---
  linq pipeline (Where+Select+Sum) :    144 bytes
  foreach loop, same result        :      0 bytes
  linq over an array via IEnumerable:    144 bytes
  The pipeline allocates a small fixed number of iterator objects,
  not one per element. It does not scale with N.

--- allocation that DOES scale with N ---
  Select to an anonymous type, then Sum : 6,400,088 bytes
  ToList() of 200,000 readings           : 4,194,800 bytes
  A projection to a reference type allocates per element, and
  ToList allocates the backing array plus its growth doublings.

--- time for the same answer ---
  foreach loop                     :    0.95 ms/pass
  linq on the array                :    2.58 ms/pass  (2.7x)
  linq through IEnumerable&lt;Reading&gt; :    2.82 ms/pass  (3.0x)
  per element: loop 4.8 ns, linq 12.9 ns

--- where the difference comes from ---
  Every element crosses two delegate calls (the Where predicate
  and the Select projection) plus two interface MoveNext calls.
  The loop has none of those: the JIT inlines the body and
  iterates the array with a bounds-checked index.

--- and where it does NOT matter ---
  the same pipeline over 100 elements: 4.6 us/pass
  On a hundred elements the whole pipeline is under a few
  microseconds. The cost is real and it is also usually irrelevant.
  (checksum 19031, printed so the loop cannot be optimised away)</code></pre>

  <p class="define"><span class="define__term">Iterator object</span> The small class each deferred
  operator allocates to hold its source, its lambda, and its position. A three-operator pipeline
  allocates three of them, once, regardless of how many elements pass through.</p>

  <p><strong>144 bytes for a 200,000-element pipeline.</strong> That is the number that corrects the
  most common belief about LINQ: the pipeline itself does not allocate per element. Three iterator
  objects and a delegate or two, and then 200,000 elements stream through the same objects.</p>

  <p><strong>The allocations that matter are the ones you write.</strong> Projecting to an anonymous
  type cost <strong>6,400,088 bytes</strong> — 32 bytes per element, because each element got its own
  object. <code>ToList()</code> cost <strong>4,194,800 bytes</strong> for 200,000 references: the
  final array is about 1.6 MB, and the rest is the discarded arrays from doubling as the list grew.
  Neither is LINQ overhead; both are the cost of the shape you asked for.</p>

  <div class="callout callout--note">
    <p><strong><code>ToList</code> on a known size is cheaper written by hand.</strong> The doubling
    waste disappears with <code>new List&lt;T&gt;(capacity)</code>, and
    <code>ToArray()</code> on a source whose count is known allocates exactly once. That is worth
    doing in a hot path and not worth doing anywhere else.</p>
  </div>

  <h3>Time</h3>

  <p><strong>2.7× against the loop, or 12.9 ns per element against 4.8 ns.</strong> The gap is two
  delegate calls plus two interface <code>MoveNext</code> calls per element — the delegate cost
  <a href="#/m/t1-21-delegates">Delegates</a> measured at roughly twice a direct call, paid twice,
  plus interface dispatch the JIT cannot always devirtualise.</p>

  <p>Both LINQ variants cost the same here. Run-to-run variation on this machine was roughly
  2.1–2.8 ms per pass, so treat "about 2.5×" as the finding and not the third decimal place.</p>

  <p><strong>And 4.6 microseconds over 100 elements.</strong> That is the other half of the honest
  answer: the same pipeline on a realistic collection size costs less than a log line. A 2.7×
  multiplier on a number that small is not a performance problem.</p>
</section>

<section id="queryable">
  <h2>The second kind of deferral</h2>

  <p>Everything so far has been LINQ to Objects: the lambdas become compiled methods, the pipeline
  calls them, and the work happens in this process. There is a second kind, and it defers something
  different.</p>

  <p class="define"><span class="define__term">IQueryable&lt;T&gt;</span> An interface extending
  <code>IEnumerable&lt;T&gt;</code> that carries an <em>expression tree</em> instead of a chain of
  delegates. Operators on it build a description of the query rather than a thing that runs it. A
  provider — a database driver, most often — reads that description and translates it.</p>

  <p class="define"><span class="define__term">Expression tree</span> A data structure describing
  code: <code>Expression&lt;Func&lt;Order, bool&gt;&gt;</code> is not a callable predicate but an
  object graph saying "compare the <code>Region</code> property to the string eu". It can be read,
  inspected and rewritten, which a compiled delegate cannot.</p>

  <pre data-lang="csharp" data-net="10" data-title="06-queryable-vs-enumerable.cs"><code>// 06-queryable-vs-enumerable.cs — the second kind of deferral. IEnumerable&lt;T&gt;
// defers a chain of delegates; IQueryable&lt;T&gt; defers a data structure describing
// the query, which a provider translates. Losing the IQueryable type mid-chain
// silently changes where the work happens.
// AsQueryable over an array warns about trimming and AOT (IL2026/IL3050); that
// is true and irrelevant here, so it is suppressed rather than left to noise.
// .NET 10.0.400. Run: dotnet run 06-queryable-vs-enumerable.cs

#:property NoWarn=IL2026;IL3050

using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;

record Order(string Ref, string Region, decimal Amount);

class Program
{
    static readonly Order[] Data =
    {
        new("O-1", "eu", 120m), new("O-2", "us", 300m),
        new("O-3", "eu", 450m), new("O-4", "eu",  80m)
    };

    static void Main()
    {
        Console.WriteLine("--- the lambda becomes a DELEGATE for IEnumerable ---");
        IEnumerable&lt;Order&gt; asEnumerable = Data;
        var eq = asEnumerable.Where(o =&gt; o.Region == "eu");
        Console.WriteLine($"  runtime type : {eq.GetType().Name}");
        Console.WriteLine("  The predicate was compiled to a method and wrapped in a");
        Console.WriteLine("  Func&lt;Order,bool&gt;. Nothing can read it back; it can only be called.");

        Console.WriteLine();
        Console.WriteLine("--- and an EXPRESSION TREE for IQueryable ---");
        IQueryable&lt;Order&gt; asQueryable = Data.AsQueryable();
        var qq = asQueryable.Where(o =&gt; o.Region == "eu");
        Console.WriteLine($"  runtime type : {qq.GetType().Name}");
        Console.WriteLine($"  expression   : {qq.Expression}");
        Console.WriteLine("  The same source text became a data structure describing the");
        Console.WriteLine("  query. A provider can read it and emit SQL, or anything else.");

        Console.WriteLine();
        Console.WriteLine("--- the two overloads that make this happen ---");
        Expression&lt;Func&lt;Order, bool&gt;&gt; tree = o =&gt; o.Region == "eu";
        Func&lt;Order, bool&gt; del = o =&gt; o.Region == "eu";
        Console.WriteLine($"  Expression&lt;Func&lt;Order,bool&gt;&gt; : {tree.Body} (NodeType {tree.Body.NodeType})");
        Console.WriteLine($"  Func&lt;Order,bool&gt;             : {del.Method.Name} — a compiled method");
        Console.WriteLine("  Queryable.Where takes the first. Enumerable.Where takes the");
        Console.WriteLine("  second. Which one you get is decided by the STATIC type of the");
        Console.WriteLine("  source, not by anything visible in the query itself.");

        Console.WriteLine();
        Console.WriteLine("--- losing IQueryable mid-chain: the silent switch ---");
        var stillQueryable = asQueryable.Where(o =&gt; o.Region == "eu").Where(o =&gt; o.Amount &gt; 100m);
        Console.WriteLine($"  both Where clauses in the tree : {stillQueryable.Expression}");

        IEnumerable&lt;Order&gt; dropped = asQueryable.Where(o =&gt; o.Region == "eu");
        var afterDrop = dropped.Where(o =&gt; o.Amount &gt; 100m);
        Console.WriteLine($"  after the IEnumerable variable : {afterDrop.GetType().Name}");
        Console.WriteLine("  The second Where is now Enumerable.Where. Against a database");
        Console.WriteLine("  the first clause would run as SQL and the second would run in");
        Console.WriteLine("  memory over everything the first returned.");

        Console.WriteLine();
        Console.WriteLine("--- results are identical, which is the whole problem ---");
        Console.WriteLine($"  fully queryable : {string.Join(", ", stillQueryable.Select(o =&gt; o.Ref))}");
        Console.WriteLine($"  split chain     : {string.Join(", ", afterDrop.Select(o =&gt; o.Ref))}");
        Console.WriteLine("  Same rows. No warning, no exception, no difference in output.");

        Console.WriteLine();
        Console.WriteLine("--- what CANNOT be translated shows up as an exception, or worse ---");
        var withMethodCall = asQueryable.Where(o =&gt; Normalise(o.Region) == "EU");
        Console.WriteLine($"  expression : {withMethodCall.Expression}");
        Console.WriteLine("  The LINQ-to-Objects provider compiles this and runs it.");
        Console.WriteLine("  A SQL provider cannot translate Normalise and will either throw");
        Console.WriteLine("  or fetch every row and filter in memory, depending on version.");
        Console.WriteLine($"  it runs fine here : {string.Join(", ", withMethodCall.Select(o =&gt; o.Ref))}");
    }

    static string Normalise(string s) =&gt; s.ToUpperInvariant();
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- the lambda becomes a DELEGATE for IEnumerable ---
  runtime type : SizeOptIListWhereIterator&#96;1
  The predicate was compiled to a method and wrapped in a
  Func&lt;Order,bool&gt;. Nothing can read it back; it can only be called.

--- and an EXPRESSION TREE for IQueryable ---
  runtime type : EnumerableQuery&#96;1
  expression   : Order[].Where(o =&gt; (o.Region == "eu"))
  The same source text became a data structure describing the
  query. A provider can read it and emit SQL, or anything else.

--- the two overloads that make this happen ---
  Expression&lt;Func&lt;Order,bool&gt;&gt; : (o.Region == "eu") (NodeType Equal)
  Func&lt;Order,bool&gt;             : &lt;Main&gt;b__1_3 — a compiled method
  Queryable.Where takes the first. Enumerable.Where takes the
  second. Which one you get is decided by the STATIC type of the
  source, not by anything visible in the query itself.

--- losing IQueryable mid-chain: the silent switch ---
  both Where clauses in the tree : Order[].Where(o =&gt; (o.Region == "eu")).Where(o =&gt; (o.Amount &gt; 100))
  after the IEnumerable variable : IEnumerableWhereIterator&#96;1
  The second Where is now Enumerable.Where. Against a database
  the first clause would run as SQL and the second would run in
  memory over everything the first returned.

--- results are identical, which is the whole problem ---
  fully queryable : O-1, O-3
  split chain     : O-1, O-3
  Same rows. No warning, no exception, no difference in output.

--- what CANNOT be translated shows up as an exception, or worse ---
  expression : Order[].Where(o =&gt; (Normalise(o.Region) == "EU"))
  The LINQ-to-Objects provider compiles this and runs it.
  A SQL provider cannot translate Normalise and will either throw
  or fetch every row and filter in memory, depending on version.
  it runs fine here : O-1, O-3, O-4</code></pre>

  <p><strong>The same source text produced two different things.</strong> Over an
  <code>IEnumerable&lt;Order&gt;</code>, <code>o =&gt; o.Region == "eu"</code> compiled to a method
  and became a <code>Func&lt;Order, bool&gt;</code>. Over an <code>IQueryable&lt;Order&gt;</code> the
  identical text became the printable tree
  <code>Order[].Where(o =&gt; (o.Region == "eu"))</code>.</p>

  <p>Nothing in the query decided that. <code>Enumerable.Where</code> takes a
  <code>Func&lt;T, bool&gt;</code> and <code>Queryable.Where</code> takes an
  <code>Expression&lt;Func&lt;T, bool&gt;&gt;</code>, and <strong>overload resolution picks between
  them using the static type of the source</strong>. The behaviour of the query is decided by a type
  you may never have written down.</p>

  <h3>The silent switch</h3>

  <p>That is why one variable declaration can change where the work happens:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: dropping to IEnumerable mid-chain"><code>// WRONG against a database. The declared type of &#96;first&#96; is IEnumerable&lt;Order&gt;,
// so the second Where binds to Enumerable.Where and runs in memory over every
// row the first clause returned.
IEnumerable&lt;Order&gt; first = db.Orders.Where(o =&gt; o.Region == region);
var result = first.Where(o =&gt; o.Amount &gt; 100m).ToList();

// Right: keep the static type, and the whole chain is translated.
IQueryable&lt;Order&gt; first = db.Orders.Where(o =&gt; o.Region == region);
var result = first.Where(o =&gt; o.Amount &gt; 100m).ToList();</code></pre>

  <p>Measured: keeping <code>IQueryable</code> put both clauses in the tree —
  <code>Where(o =&gt; (o.Region == "eu")).Where(o =&gt; (o.Amount &gt; 100))</code>. Assigning to an
  <code>IEnumerable&lt;Order&gt;</code> variable first produced an
  <code>IEnumerableWhereIterator</code> for the second clause. <strong>Both returned
  <code>O-1, O-3</code>.</strong></p>

  <p>Identical results, no warning and no exception — the same signature as every other failure in
  this module. Against an in-memory array it makes no difference at all. Against a table of ten
  million rows, the first version filters in the database and the second fetches every row in the
  region and filters them in your process.</p>

  <div class="callout callout--gotcha">
    <p><strong><code>var</code> protects you here and an explicit type does not.</strong>
    <code>var</code> keeps whatever static type the expression had, so a chain written with
    <code>var</code> stays <code>IQueryable&lt;T&gt;</code> all the way down. Writing
    <code>IEnumerable&lt;T&gt;</code> — the usual advice about accepting the least specific
    type — is exactly what drops the translation. This is the one place where naming the interface
    is worse than not naming it.</p>
  </div>

  <h3>What a provider cannot translate</h3>

  <p>The last measurement puts a call to an ordinary method inside the predicate. The expression tree
  records it faithfully — <code>Where(o =&gt; (Normalise(o.Region) == "EU"))</code> — and the
  in-memory provider compiles and runs it without complaint.</p>

  <p>A SQL provider cannot. There is no <code>Normalise</code> in the database, so it either throws
  a translation error or falls back to fetching rows and filtering them in memory. <strong>Which of
  those it does has changed between versions of EF Core</strong>, and the silent-fallback behaviour
  was removed precisely because it turned a small query into a full table scan without saying so.</p>

  <div class="callout callout--note">
    <p><strong>This is a preview, not the full story.</strong> Expression trees, providers, and the
    rules for what EF Core can translate are a subject of their own. What matters at this point is
    the shape: <strong><code>IEnumerable&lt;T&gt;</code> defers <em>calling delegates</em>;
    <code>IQueryable&lt;T&gt;</code> defers <em>describing a query</em></strong> — and the difference
    is invisible in the query text, invisible in the results, and decided by a static type.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A parameter enumerated more than once</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: three passes over an unknown source"><code>// WRONG. If the caller passes a deferred query, this runs it three times.
// Measured: 9,000 predicate calls for a 3,000-element source.
void Report(IEnumerable&lt;Order&gt; orders)
{
    Console.WriteLine(orders.Count());
    Console.WriteLine(orders.Sum(o =&gt; o.Amount));
    Console.WriteLine(orders.Max(o =&gt; o.Amount));
}

// Right: decide once, at the top, that you need the data.
void Report(IEnumerable&lt;Order&gt; orders)
{
    var list = orders as IReadOnlyList&lt;Order&gt; ?? orders.ToList();
    Console.WriteLine(list.Count);
    Console.WriteLine(list.Sum(o =&gt; o.Amount));
    Console.WriteLine(list.Max(o =&gt; o.Amount));
}</code></pre>

  <h3>2. <code>Count() &gt; 0</code> instead of <code>Any()</code></h3>

  <p>Measured: 3,000 predicate calls against 3. Use <code>Any()</code> whenever the question is
  "is there at least one", and note the same applies to <code>Count() == 0</code> versus
  <code>!Any()</code>.</p>

  <h3>3. Returning a deferred query from a method that owns a resource</h3>

  <p><code>ObjectDisposedException</code> at the caller, from a method that returned successfully.
  Materialise before the <code>using</code> closes, and return a type that says so.</p>

  <h3>4. A query built in a <code>for</code> loop</h3>

  <p>All the queries capture the one loop variable and all give the same answer, using the value the
  loop ended on. Copy into a per-iteration local. <code>foreach</code> does not have this problem;
  <code>for</code> does.</p>

  <h3>5. A query whose meaning depends on a variable that changes</h3>

  <p>The query does not hold the value 3 — it holds the variable <code>threshold</code>. If anything
  can change it between definition and enumeration, materialise at the point where the value is
  correct, or pass the value into a method so it is captured as a parameter.</p>

  <h3>6. <code>Select</code> used for side effects</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a loop that never runs"><code>// WRONG. Nothing enumerates this, so Save is never called.
// Verified: a Select whose lambda sets a flag left the flag false.
orders.Select(o =&gt; { Save(o); return o; });

// Right: a loop, which is what this was.
foreach (var o in orders) Save(o);</code></pre>

  <h3>7. Operator order that does work the query throws away</h3>

  <p>Filtering before projecting means the projection only runs on survivors. Measured in exercise 4:
  100 projections against 100,000 for the same result.</p>

  <h3>8. Declaring a database query as <code>IEnumerable&lt;T&gt;</code></h3>

  <p>Every operator after that variable binds to <code>Enumerable</code> instead of
  <code>Queryable</code> and runs in your process over whatever the translated part returned. Same
  rows, no warning. Use <code>var</code>, or <code>IQueryable&lt;T&gt;</code>, until the point where
  you deliberately want the rest to run locally.</p>

  <h3>9. <code>OrderBy</code> in front of <code>First</code></h3>

  <p><code>OrderBy</code> buffers and sorts the whole source before yielding anything, so
  <code>xs.OrderBy(k).First()</code> is an O(n log n) sort to find one element that
  <code>MinBy</code> finds in one pass. Measured: <code>Take(3)</code> after an <code>OrderBy</code>
  pulled all 1,000,000 source elements.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>Something is unexpectedly slow and the profiler blames a predicate.</strong> Count the
    calls before optimising the predicate. Add a counter to the lambda, or set a breakpoint with a
    hit count, and compare it to the source size. A multiple of the source size means multiple
    enumeration, and materialising once fixes it without touching the predicate at all.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong><code>ObjectDisposedException</code> from a line that already succeeded.</strong> Look
    for a method returning <code>IEnumerable&lt;T&gt;</code> whose body has a <code>using</code>.
    The exception's <code>ObjectName</code> names the disposed type, which usually names the method
    to fix. Adding <code>.ToList()</code> inside the <code>using</code> is the whole repair.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A query gives a different answer than it did five lines earlier.</strong> List the
    variables its lambdas mention and check whether any is assigned between the two points.
    Everything a lambda mentions is read at enumeration, not at definition.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Deciding whether a variable holds data or a recipe.</strong> Print
    <code>x.GetType().Name</code>. <code>List&#96;1</code> or <code>Reading[]</code> is data;
    anything containing <code>Iterator</code>, <code>WhereSelect</code>,
    <code>OrderedEnumerable</code> or <code>GroupedEnumerable</code> is a recipe that has not
    run.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Watch out for the debugger changing the answer.</strong> Hovering over a query
    variable enumerates it to show you the elements. On a query with side effects, or one over a
    network source, the act of inspecting it does the work — and the results pane can show values
    that the running program never produced. Inspect a materialised copy instead.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Before rewriting a pipeline as a loop, measure it.</strong> A 2.7× multiplier on a
    4.6-microsecond operation is not worth the readability. Time the pipeline over the real data
    size; if the whole thing is microseconds, the answer is to leave it alone.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>A concrete case.</strong> An internal reporting endpoint built a candidate set of
    records and passed it to a summariser that printed a count, a total and a maximum — the shape in
    "what goes wrong" above. For two years the caller passed a <code>List&lt;Order&gt;</code> and the
    endpoint responded in about 200 ms.</p>
    <p>A change added a filter. The caller went from
    <code>repository.GetOrders()</code> to
    <code>repository.GetOrders().Where(o =&gt; o.Region == region)</code> — a one-line diff, reviewed
    and approved, and correct. Response time went from 200 ms to roughly 600 ms.</p>
    <p>The filter was not slow; it was a comparison on a string field. The summariser had always
    read its parameter three times, and for two years that had been three cheap reads of a
    materialised list — <code>Count</code> was an O(1) property, and the two aggregates walked an
    array. After the change the parameter was a recipe, so each of the three reads re-ran the
    repository call and the filter.</p>
    <p>Two things made it hard to find. The profiler attributed the time to the repository, which
    was doing exactly what it always had, three times instead of once. And the reviewers had compared
    the filter's cost against the endpoint's budget, which was the right question about the wrong
    line: the expensive change was not the <code>Where</code>, it was the loss of the
    <code>ToList</code> that used to be there implicitly.</p>
    <p>The fix was one line in the summariser — materialise the parameter at the top. Response time
    returned to about 200 ms, and the same fix made the endpoint immune to every future caller who
    passes a query.</p>
  </div>

  <p>The general principle: <strong>a method that reads an <code>IEnumerable&lt;T&gt;</code>
  parameter more than once has a cost its caller controls and neither can see.</strong> The signature
  promises only that the sequence can be enumerated. It says nothing about whether enumeration is
  free, expensive, repeatable, or safe after the caller's <code>using</code> block closes — and a
  caller who changes what they pass can multiply the method's cost without changing a line of it.</p>

  <p>That is why the small habits pay disproportionately. Materialise a parameter you will read more
  than once. Return a materialised type from anything that owns a resource. Use <code>Any</code>
  when the question is "is there one". Each is cheap to do and each closes a failure mode that is
  expensive to find, because none of them produce a wrong answer — only a slow one, or one that
  fails somewhere else.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"LINQ allocates an object per element."</strong> The pipeline does not. Measured:
    <strong>144 bytes total</strong> for a three-operator pipeline over 200,000 elements. What
    allocates per element is a projection to a reference type — 6.4 MB for 200,000 anonymous
    types — and that is the shape you asked for, not overhead.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Deferred means it runs once, later."</strong> It means it runs <em>every time</em>,
    later. Measured: 9,000 predicate calls for a 3,000-element source read three times.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>Count()</code> is O(1) on a list."</strong> On something the runtime can see as
    <code>ICollection&lt;T&gt;</code>, yes. Put one <code>Where</code> in front and it is O(n):
    measured at 34 ms against 1,765.7 ms over 100,000 calls, a 52× difference from adding a filter
    that matched everything.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>OrderBy</code> is lazy, so <code>OrderBy(…).First()</code> is cheap."</strong>
    It is deferred but it buffers. Measured: <code>Take(3)</code> after an <code>OrderBy</code>
    pulled all 1,000,000 source elements. Use <code>MinBy</code> or <code>MaxBy</code>, which are one
    pass.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"A query captures the values it was written with."</strong> It captures the variables.
    Measured: one query variable, never reassigned, gave <code>4, 5, 6</code> and then
    <code>6</code> after a variable it mentions was changed.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Rewrite the LINQ as loops for performance."</strong> Sometimes right, usually not.
    The multiplier is about 2.5× and the base is nanoseconds: the same pipeline over 100 elements
    took 4.6 microseconds. Measure the real data size before trading readability for it.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Deferred execution works the same everywhere."</strong> Two different mechanisms
    share the word. <code>IEnumerable&lt;T&gt;</code> defers calling delegates;
    <code>IQueryable&lt;T&gt;</code> defers an expression tree a provider translates. Measured: the
    same lambda text became a <code>Func&lt;Order,bool&gt;</code> in one and the readable tree
    <code>Order[].Where(o =&gt; (o.Region == "eu"))</code> in the other.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Adding <code>ToList()</code> everywhere is the safe default."</strong> It costs an
    allocation proportional to the data and throws away streaming — a filter over a million rows that
    fed a <code>Take(10)</code> now materialises a million. Materialise where a query is read more
    than once, crosses a resource boundary, or must snapshot a value. Not by reflex.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>A parameter or local read more than once</td><td>Materialise it once, at the top</td>
          <td>Measured 9,000 predicate calls against 3,000 for three reads.</td></tr>
      <tr><td>Returning from a method that owns a connection, file or
          <code>using</code></td><td><code>ToList()</code> inside the block; return
          <code>IReadOnlyList&lt;T&gt;</code></td>
          <td>Otherwise the caller enumerates a disposed resource.</td></tr>
      <tr><td>"Is there at least one?"</td><td><code>Any()</code></td>
          <td>3 predicate calls against 3,000 for <code>Count() &gt; 0</code>.</td></tr>
      <tr><td>"What is the smallest / largest?"</td><td><code>MinBy</code> /
          <code>MaxBy</code></td>
          <td>One pass, against a full sort for <code>OrderBy(…).First()</code>.</td></tr>
      <tr><td>A filter and a projection in the same query</td><td><code>Where</code> first</td>
          <td>The projection then runs only on survivors: 100 calls against 100,000.</td></tr>
      <tr><td>Only the first few results are needed</td><td>Leave it deferred; use
          <code>Take</code></td>
          <td>Streaming stops the source early — 6 elements pulled from a million.</td></tr>
      <tr><td>The answer must reflect the data as it is now</td><td>Materialise now</td>
          <td>A deferred query reads its source at enumeration time.</td></tr>
      <tr><td>The source is mutated while the query is live</td><td>Materialise before
          mutating</td>
          <td>Otherwise <code>InvalidOperationException: Collection was modified</code>.</td></tr>
      <tr><td>A hot path over tens of thousands of elements, measured</td><td>Consider a
          loop</td>
          <td>About 2.5×, or 12.9 ns against 4.8 ns per element.</td></tr>
      <tr><td>Anything smaller or not measured</td><td>Leave the LINQ alone</td>
          <td>4.6 microseconds over 100 elements. Readability wins.</td></tr>
      <tr><td>A chain over a database query</td><td><code>var</code>, or
          <code>IQueryable&lt;T&gt;</code> — never <code>IEnumerable&lt;T&gt;</code></td>
          <td>An <code>IEnumerable&lt;T&gt;</code> variable binds the rest of the chain to
          in-memory operators, silently.</td></tr>
      <tr><td>A side effect per element</td><td><code>foreach</code></td>
          <td>A <code>Select</code> nobody enumerates never runs.</td></tr>
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
    <p>Predict all four printed lines.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>var numbers = new List&lt;int&gt; { 1, 2, 3 };
var doubled  = numbers.Select(n =&gt; n * 2);
var snapshot = numbers.Select(n =&gt; n * 2).ToList();
numbers.Add(4);
Console.WriteLine(string.Join(", ", doubled));    // ?
Console.WriteLine(string.Join(", ", snapshot));   // ?
numbers.Clear();
Console.WriteLine(string.Join(", ", doubled));    // ?
Console.WriteLine(string.Join(", ", snapshot));   // ?</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>doubled  : 2, 4, 6, 8
snapshot : 2, 4, 6
doubled after Clear()  : []
snapshot after Clear() : 2, 4, 6</code></pre>
        <p><code>doubled</code> is a recipe. It was written when the list had three elements and
        printed four, because it read the list at the moment
        <code>string.Join</code> enumerated it. After <code>Clear()</code> the same recipe printed
        nothing at all.</p>
        <p><code>snapshot</code> ran once, during <code>ToList()</code>, while the list had three
        elements. It has held <code>2, 4, 6</code> ever since and nothing done to
        <code>numbers</code> can change it.</p>
        <p><strong>The two variables look interchangeable and are not.</strong> Both are "the doubled
        numbers"; one is data and one is instructions. The type is the tell —
        <code>List&lt;int&gt;</code> against an iterator class — which is why
        <code>x.GetType().Name</code> is the fastest way to answer "has this run yet?".</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>How many times does <code>Even</code> run, for a source of 100 numbers? Then say what the
    count becomes with <code>.ToList()</code> added at the call site, and why the change belongs in
    <code>Summarise</code> rather than at the call site.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>static bool Even(int n) { _calls++; return n % 2 == 0; }

static void Summarise(IEnumerable&lt;int&gt; items)
{
    Console.WriteLine($"count={items.Count()} sum={items.Sum()} first={items.First()}");
}

Summarise(source.Where(Even));</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>count=50 sum=2550 first=2
predicate calls : 202
with ToList()   : 100</code></pre>
        <p><strong>202.</strong> <code>Count()</code> walked all 100. <code>Sum()</code> walked all
        100 again. <code>First()</code> walked 2 and stopped, because the second number is the first
        even one. 100 + 100 + 2.</p>
        <p>With <code>.ToList()</code> at the call site it is <strong>100</strong> — one pass, then
        three reads of a list, two of which now hit fast paths
        (<code>Count</code> is a property; <code>First</code> is an index).</p>
        <p><strong>Why the fix belongs in <code>Summarise</code>.</strong> Fixing it at the call site
        fixes one caller. <code>Summarise</code> reads its parameter three times, so
        <em>every</em> caller who passes a deferred query pays triple, and the signature invites
        exactly that. The method cannot see what it was handed, so it should decide for itself:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix, in the method"><code>static void Summarise(IEnumerable&lt;int&gt; items)
{
    var list = items as IReadOnlyList&lt;int&gt; ?? items.ToList();
    Console.WriteLine($"count={list.Count} sum={list.Sum()} first={list[0]}");
}</code></pre>
        <p>The <code>as</code> check avoids copying when the caller already passed a materialised
        list, which is the common case. This is the shape of the incident in "why this matters": the
        method had always read its parameter three times, and it only became expensive when a caller
        changed what they passed.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This method compiles, and its test passes. Say what it does at runtime, why the test passed,
    and fix it.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>static IEnumerable&lt;string&gt; GetNames()
{
    using var store = new FakeStore();
    return store.Names().Select(n =&gt; n.ToUpperInvariant());
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>ObjectDisposedException on the first MoveNext
fixed version:
  ADA
  GRACE</code></pre>
        <p><strong>It throws at the caller, on the first <code>MoveNext</code>.</strong>
        <code>using var</code> disposes <code>store</code> when <code>GetNames</code> returns — which
        happens before anything enumerates the query. The caller then pulls the first element, the
        iterator reaches into a disposed <code>FakeStore</code>, and
        <code>ObjectDisposedException</code> surfaces in the caller's <code>foreach</code>, naming a
        type the caller has never heard of.</p>
        <p><strong>Why a test can pass.</strong> Any test that enumerates the result while something
        keeps the resource alive — a fake store with no real disposal, a mock returning a
        <code>List</code>, or a test double whose <code>Dispose</code> does nothing — never reaches
        the failing path. The defect lives in the interaction between deferral and resource
        lifetime, and a test that stubs out the resource stubs out the defect.</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>static IReadOnlyList&lt;string&gt; GetNames()
{
    using var store = new FakeStore();
    return store.Names().Select(n =&gt; n.ToUpperInvariant()).ToList();
}</code></pre>
        <p>Two changes and both matter. <code>ToList()</code> runs the query while the store is
        alive. The <code>IReadOnlyList&lt;string&gt;</code> return type stops the next person
        reintroducing the bug, because you cannot return a lazy query from it — the compiler enforces
        what the comment would only have asked for.</p>
        <p><strong>Streaming from a resource is still possible</strong>, but the method has to own
        the whole enumeration: make it an iterator with <code>yield return</code> inside the
        <code>using</code>, so the resource is disposed when enumeration finishes rather than when
        the method returns. <a href="#/m/t1-26-iterators-and-yield">Iterators and yield</a> covers
        the mechanics and the ways that goes wrong.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Two parts. (a) These two queries return the same number. Say which is cheaper and by how much.
    (b) Then decide, with a measurement, whether rewriting a pipeline as a loop is worth doing.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>// (a)
readings.Where(n =&gt; n % 1000 == 0).Select(n =&gt; (double)n).Sum();
readings.Select(n =&gt; (double)n).Where(n =&gt; n % 1000 == 0).Sum();

// (b) 500,000 doubles, filter and project, against the equivalent foreach.</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>Where then Select : predicate 100,000, projection 100
Select then Where : predicate 100,000, projection 100,000
Same answer, 100x more projections in the second.

linq : 5.63 ms/pass
loop : 1.48 ms/pass  (3.8x faster)
saved per pass : 4.15 ms
at 10 calls/second that is 41.5 ms/second of CPU;
at 10 calls/day it is 41.5 ms/day.</code></pre>
        <p><strong>(a) Filter first.</strong> Both run the predicate 100,000 times — every element
        has to be tested either way. The difference is the projection: <strong>100 calls against
        100,000</strong>, because after a <code>Where</code> the projection only sees survivors.</p>
        <p>The rule generalises: <strong>put the cheapest, most selective operator first</strong>.
        Each operator's cost is multiplied by however many elements reach it, so reducing the count
        early reduces everything downstream. It matters most when the projection allocates — a
        <code>Select</code> to a new object after a filter that keeps 0.1% is 1,000× less garbage.</p>
        <p><strong>(b) The loop is 3.8× faster and saves 4.15 ms per pass.</strong> Whether that is
        worth writing depends entirely on the call rate, which the measurement cannot tell you:</p>
        <ul>
          <li><strong>10 calls per second</strong> — 41.5 ms of CPU per second, over 4% of one core
          for a single operation. Write the loop.</li>
          <li><strong>10 calls per day</strong> — 41.5 ms per day. Do not write the loop.</li>
        </ul>
        <p>The identical measurement supports both answers, which is the point. <strong>"LINQ is
        slow" is not a finding; "this pipeline costs 4.15 ms and runs ten times a second"
        is</strong>, and only the second one can be argued with.</p>
        <p>Worth checking before the loop: whether the pipeline is being run more times than
        necessary at all. Removing a multiple enumeration takes one line and saved 47% in this
        module's second measurement — more than the 3.8× is worth on most call rates, and it costs no
        readability.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What happens when you write <code>var q = xs.Where(p)</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A small iterator object is built holding <code>xs</code> and <code>p</code>. Measured:
        <strong>zero</strong> predicate calls. The work happens when something enumerates
        <code>q</code>.</p>
      </div></details>
    </li>
    <li>
      <p>In what order does <code>Where(…).Select(…)</code> call its lambdas?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Element by element:
        <code>where(1) where(2) select(2) where(3) where(4) select(4)</code>. Each element is pulled
        through the whole chain before the next starts — not all the filters, then all the
        projections.</p>
      </div></details>
    </li>
    <li>
      <p>What is the difference between deferred and streaming?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Deferred: nothing runs until enumeration. Streaming: once enumeration starts, results come
        out before the source is exhausted. <code>OrderBy</code>, <code>GroupBy</code> and
        <code>Reverse</code> are deferred but <strong>buffering</strong> — measured pulling all
        1,000,000 elements to satisfy a <code>Take(3)</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What does enumerating a query three times cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Three full runs of the pipeline. Measured: <strong>9,000 predicate calls</strong> for a
        3,000-element source read three times, with identical results each time — which is why it is
        invisible in review.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>Any()</code> preferred over <code>Count() &gt; 0</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Any</code> stops at the first match; <code>Count</code> must see everything.
        Measured: <strong>3 predicate calls against 3,000</strong>.</p>
      </div></details>
    </li>
    <li>
      <p>When is <code>Count()</code> O(1)?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the source implements <code>ICollection&lt;T&gt;</code>, so it can read the
        <code>Count</code> property. One <code>Where</code> in front removes that: measured
        <strong>34 ms against 1,765.7 ms</strong> over 100,000 calls, a 52× difference.</p>
      </div></details>
    </li>
    <li>
      <p>Why can a query give two different answers without being reassigned?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Its lambdas capture <strong>variables, not values</strong>, and they run at enumeration
        time. Measured: the same query gave <code>4, 5, 6</code> and then <code>6</code> after a
        captured <code>threshold</code> changed from 3 to 5.</p>
      </div></details>
    </li>
    <li>
      <p>What is wrong with returning <code>IEnumerable&lt;T&gt;</code> from a method containing a
      <code>using</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The resource is disposed when the method returns, before the caller enumerates. Result:
        <code>ObjectDisposedException</code> at the caller from a method that returned successfully.
        Fix with <code>ToList()</code> inside the block and an
        <code>IReadOnlyList&lt;T&gt;</code> return type.</p>
      </div></details>
    </li>
    <li>
      <p>Does a LINQ pipeline allocate per element?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. Measured: <strong>144 bytes</strong> total for a three-operator pipeline over 200,000
        elements. Per-element allocation comes from projecting to a reference type — 6.4 MB for
        200,000 anonymous types — which is the shape you asked for, not overhead.</p>
      </div></details>
    </li>
    <li>
      <p>What does a pipeline cost against the equivalent loop, and where does the cost come
      from?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>About <strong>2.5×</strong> — 12.9 ns per element against 4.8 ns. Two delegate calls and
        two interface <code>MoveNext</code> calls per element, none of which the loop has. Over 100
        elements the whole pipeline was <strong>4.6 microseconds</strong>.</p>
      </div></details>
    </li>
    <li>
      <p>Why put <code>Where</code> before <code>Select</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The projection then runs only on survivors. Measured: <strong>100 projections against
        100,000</strong> for the same answer. Generally: put the cheapest, most selective operator
        first, because every later operator's cost is multiplied by the elements that reach it.</p>
      </div></details>
    </li>
    <li>
      <p>What is the difference between deferring an <code>IEnumerable&lt;T&gt;</code> and an
      <code>IQueryable&lt;T&gt;</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>IEnumerable&lt;T&gt;</code> defers <strong>calling delegates</strong>;
        <code>IQueryable&lt;T&gt;</code> defers an <strong>expression tree</strong> a provider
        translates. The choice is made by overload resolution on the source's static type, so
        declaring a database query as <code>IEnumerable&lt;T&gt;</code> moves every later operator
        into your process — with identical results and no warning.</p>
      </div></details>
    </li>
    <li>
      <p>When is rewriting LINQ as a loop worth it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the measurement <em>and the call rate</em> justify it. The same 4.15 ms saving is
        41.5 ms per second at ten calls a second and 41.5 ms per day at ten calls a day. Check for a
        multiple enumeration first — removing one saved 47% here for one line and no readability
        cost.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
