/* ============================================================================
   Track 1, Module 19 — Collections and Their Cost Model
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-19-collections-overview/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-19-collections-overview",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "Choosing a collection is choosing a cost model, and the choice is invisible at the call " +
    "site — Contains reads the same whether it scans a million items or hashes one key. " +
    "Measured here: the same catalogue feature is 321 times faster and allocates a gigabyte " +
    "less, with identical calling code and different field types.",
  terms: [
    "cost model", "amortised", "capacity", "resize", "scan", "hash lookup",
    "binary search", "List", "Dictionary", "HashSet", "SortedDictionary",
    "SortedList", "Queue", "Stack", "LinkedList", "enumeration order",
    "insertion order", "pre-sizing", "index", "bucket"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A product catalogue endpoint takes 900 ms. It looks up a product by SKU, checks whether the
  SKU is blocked, and returns everything in a category. Each of those is one line of readable
  code. None of them looks expensive, and the catalogue is only 50,000
  products — small enough to hold in memory, which is why it is held in memory.</p>

  <p>The same endpoint allocates about a gigabyte per thousand requests, which nothing in the
  source suggests. There is no <code>new</code> in the hot path.</p>

  <p>Elsewhere, a queue of pending jobs is a <code>List</code>, and items are taken from the front
  with <code>Insert</code> and <code>RemoveAt(0)</code>. It was fine with a hundred jobs. At forty
  thousand it takes two minutes to fill.</p>

  <p>Every one of these is the same mistake: a collection chosen for what it stores rather than
  for how it is used. <strong>The call site cannot tell you which mistake you made</strong> —
  <code>Contains</code> reads identically whether it hashes one key or scans a million items. This
  module is the cost model that <code>Contains</code> hides, measured rather than recited.</p>
</section>

<section id="what-a-cost-model-is">
  <h2>Two questions decide everything</h2>

  <p class="define"><span class="define__term">Cost model</span> How an operation's cost changes
  as the collection grows. Not "is it fast" but "what happens when there is ten times more".</p>

  <p>Every collection in the base class library is a trade between two questions:</p>

  <ul>
    <li><strong>How do you find an item?</strong> By position, by scanning, by hashing, or by
    walking a tree.</li>
    <li><strong>What happens when you add or remove one?</strong> Nothing, a copy, a reallocation,
    or a rebalance.</li>
  </ul>

  <p>The analogy: a <code>List</code> is a numbered shelf, a <code>Dictionary</code> is a filing
  cabinet with labelled drawers, and a <code>SortedDictionary</code> is a library catalogue in
  alphabetical order. Finding a book by shelf number is instant; finding one by title on a
  numbered shelf means reading every spine.</p>

  <p><strong>The analogy's limit is insertion.</strong> Adding a book to the middle of a numbered
  shelf means shifting every book after it along one place — a cost with no equivalent in the
  filing-cabinet picture, and the one that turned a working queue into a two-minute stall.</p>
</section>

<section id="lookup">
  <h2>Finding things</h2>

  <p>The same question — "is this value present?" — asked of five collections at five sizes.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-lookup-cost.cs"><code>// 01-lookup-cost.cs — the difference between scanning and hashing, measured at
// several sizes so the SHAPE of the growth is visible rather than asserted.
// .NET 10.0.400, Release. Run: dotnet run 01-lookup-cost.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Program
{
    static double Measure(Func&lt;int, bool&gt; contains, int lookups, int max)
    {
        for (int i = 0; i &lt; 1000; i++) contains(i % max);
        double best = double.MaxValue;
        for (int r = 0; r &lt; 3; r++)
        {
            var sw = Stopwatch.StartNew();
            int found = 0;
            for (int i = 0; i &lt; lookups; i++) if (contains(i % max)) found++;
            sw.Stop();
            if (found == 0) throw new Exception("nothing found");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        return best;
    }

    static void Main()
    {
        Console.WriteLine("Lookup cost by collection size. 100,000 lookups each,");
        Console.WriteLine("best of 3, times in milliseconds.");
        Console.WriteLine();
        Console.WriteLine($"  {"n",8} {"List",12} {"HashSet",12} {"Dictionary",12} " +
                          $"{"SortedSet",12} {"array scan",12}");

        const int Lookups = 100_000;
        foreach (int n in new[] { 10, 100, 1_000, 10_000, 100_000 })
        {
            var list = Enumerable.Range(0, n).ToList();
            var set = new HashSet&lt;int&gt;(list);
            var dict = list.ToDictionary(x =&gt; x, x =&gt; x);
            var sorted = new SortedSet&lt;int&gt;(list);
            var array = list.ToArray();

            double l = Measure(v =&gt; list.Contains(v), Lookups, n);
            double h = Measure(v =&gt; set.Contains(v), Lookups, n);
            double d = Measure(v =&gt; dict.ContainsKey(v), Lookups, n);
            double s = Measure(v =&gt; sorted.Contains(v), Lookups, n);
            double a = Measure(v =&gt; Array.IndexOf(array, v) &gt;= 0, Lookups, n);

            Console.WriteLine($"  {n,8:N0} {l,12:F1} {h,12:F1} {d,12:F1} {s,12:F1} {a,12:F1}");
        }

        Console.WriteLine();
        Console.WriteLine("Read the ROWS, not the cells. List and array scan roughly ten times");
        Console.WriteLine("slower for every ten times more data. HashSet and Dictionary barely");
        Console.WriteLine("move. SortedSet grows slowly — it is a tree, so log n comparisons.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Lookup cost by collection size. 100,000 lookups each,
best of 3, times in milliseconds.

         n         List      HashSet   Dictionary    SortedSet   array scan
        10          1.2          2.1          2.7         15.5          1.7
       100          3.7          1.7          1.4         15.1          2.3
     1,000         12.7          1.2          1.3          6.5          7.6
    10,000         50.9          1.2          1.2          5.2         39.4
   100,000        595.3          1.1          1.0          6.5       1396.9</code></pre>

  <p><strong>Read down the columns, not across the rows.</strong> The absolute numbers matter less
  than how each one changes.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Collection</th><th>10 → 100,000</th><th>Shape</th><th>How it finds things</th></tr></thead>
    <tbody>
      <tr><td><code>List.Contains</code></td><td>1.2 → 595.3 ms</td><td><strong>linear</strong></td>
          <td>Compares every element until it matches.</td></tr>
      <tr><td><code>Array.IndexOf</code></td><td>1.7 → 1396.9 ms</td><td><strong>linear</strong></td>
          <td>The same, without <code>List</code>'s specialised comparer path.</td></tr>
      <tr><td><code>HashSet.Contains</code></td><td>2.1 → 1.1 ms</td><td><strong>flat</strong></td>
          <td>Hashes once, checks one bucket.</td></tr>
      <tr><td><code>Dictionary.ContainsKey</code></td><td>2.7 → 1.0 ms</td><td><strong>flat</strong></td>
          <td>The same mechanism, carrying a value too.</td></tr>
      <tr><td><code>SortedSet.Contains</code></td><td>15.5 → 6.5 ms</td><td>logarithmic</td>
          <td>Walks a balanced tree — about 17 comparisons at 100,000.</td></tr>
    </tbody>
  </table>
  </div>

  <p><strong>At 100,000 items, <code>List</code> is 540 times slower than <code>HashSet</code>
  for the same question.</strong> At 10 items it is faster. That crossover is the whole decision,
  and it happens somewhere in the low tens.</p>

  <div class="callout callout--note">
    <h4>Two honest readings of that table</h4>
    <p>The hash columns getting slightly
    <em>faster</em> as n grows is measurement noise, not a real effect — they are flat, and at
    1–3 ms for 100,000 lookups the timer is near its limit. And <code>SortedSet</code>'s first two
    rows (15.5, 15.1 ms) are higher than its later ones because the delegate and comparer paths are
    still warming up; the meaningful <code>SortedSet</code> numbers start at n=1,000.</p>
  </div>

  <p class="define"><span class="define__term">Scan</span> Checking elements one at a time until a
  match. Cost grows in proportion to the number of elements. <code>List.Contains</code>,
  <code>Array.IndexOf</code>, and any LINQ <code>Where</code> or <code>FirstOrDefault</code> over a
  list all do this.</p>

  <p class="define"><span class="define__term">Hash lookup</span> Computing a hash code to pick a
  bucket, then comparing against only that bucket's contents. Cost is roughly constant regardless
  of size — provided the hash codes spread out, which is the subject of
  <a href="#/m/t1-16-equality-and-hashing">Equality, GetHashCode, and Comparers</a>. A bad
  <code>GetHashCode</code> turns this column back into the <code>List</code> column.</p>
</section>

<section id="insert">
  <h2>Adding and removing</h2>

  <pre data-lang="csharp" data-net="10" data-title="02-insert-and-grow.cs"><code>// 02-insert-and-grow.cs — where you add matters more than what you add to, and
// pre-sizing removes a cost most code pays silently.
// .NET 10.0.400, Release. Run: dotnet run 02-insert-and-grow.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;

class Program
{
    static (double ms, long bytes) Measure(Action body)
    {
        body();
        double best = double.MaxValue;
        long bytes = 0;
        for (int r = 0; r &lt; 3; r++)
        {
            long before = GC.GetTotalAllocatedBytes(precise: true);
            var sw = Stopwatch.StartNew();
            body();
            sw.Stop();
            bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        return (best, bytes);
    }

    static void Show(string label, (double ms, long bytes) r) =&gt;
        Console.WriteLine($"  {label,-34} {r.ms,8:F1} ms   {r.bytes,12:N0} bytes");

    static void Main()
    {
        const int N = 100_000;

        Console.WriteLine($"--- adding {N:N0} items ---");
        Show("List.Add (no capacity)", Measure(() =&gt;
        {
            var l = new List&lt;int&gt;();
            for (int i = 0; i &lt; N; i++) l.Add(i);
        }));
        Show("List.Add (pre-sized)", Measure(() =&gt;
        {
            var l = new List&lt;int&gt;(N);
            for (int i = 0; i &lt; N; i++) l.Add(i);
        }));
        Show("List.Insert(0, ...)", Measure(() =&gt;
        {
            var l = new List&lt;int&gt;(N);
            for (int i = 0; i &lt; N; i++) l.Insert(0, i);
        }));
        Show("Queue.Enqueue", Measure(() =&gt;
        {
            var q = new Queue&lt;int&gt;();
            for (int i = 0; i &lt; N; i++) q.Enqueue(i);
        }));
        Show("LinkedList.AddFirst", Measure(() =&gt;
        {
            var ll = new LinkedList&lt;int&gt;();
            for (int i = 0; i &lt; N; i++) ll.AddFirst(i);
        }));

        Console.WriteLine();
        Console.WriteLine($"--- adding {N:N0} keys ---");
        Show("Dictionary (no capacity)", Measure(() =&gt;
        {
            var d = new Dictionary&lt;int, int&gt;();
            for (int i = 0; i &lt; N; i++) d[i] = i;
        }));
        Show("Dictionary (pre-sized)", Measure(() =&gt;
        {
            var d = new Dictionary&lt;int, int&gt;(N);
            for (int i = 0; i &lt; N; i++) d[i] = i;
        }));
        Show("SortedDictionary", Measure(() =&gt;
        {
            var d = new SortedDictionary&lt;int, int&gt;();
            for (int i = 0; i &lt; N; i++) d[i] = i;
        }));
        Show("SortedList", Measure(() =&gt;
        {
            var d = new SortedList&lt;int, int&gt;();
            for (int i = 0; i &lt; N; i++) d[i] = i;
        }));

        Console.WriteLine();
        Console.WriteLine("--- how a List grows ---");
        var probe = new List&lt;int&gt;();
        int lastCapacity = -1;
        int reallocations = 0;
        var capacities = new List&lt;int&gt;();
        for (int i = 0; i &lt; 5000; i++)
        {
            probe.Add(i);
            if (probe.Capacity != lastCapacity)
            {
                lastCapacity = probe.Capacity;
                reallocations++;
                if (capacities.Count &lt; 14) capacities.Add(lastCapacity);
            }
        }
        Console.WriteLine($"  capacities seen : {string.Join(", ", capacities)} ...");
        Console.WriteLine($"  reallocations for 5,000 adds : {reallocations}");
        Console.WriteLine("  Each one allocates a new array and copies everything across.");
        Console.WriteLine("  Total copying is about 2n element moves — amortised O(1) per add,");
        Console.WriteLine("  and entirely avoidable when the size is known in advance.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- adding 100,000 items ---
  List.Add (no capacity)                  1.1 ms      1,049,168 bytes
  List.Add (pre-sized)                    0.4 ms        400,096 bytes
  List.Insert(0, ...)                   606.3 ms        400,432 bytes
  Queue.Enqueue                           1.6 ms      1,049,360 bytes
  LinkedList.AddFirst                     8.1 ms      4,800,080 bytes

--- adding 100,000 keys ---
  Dictionary (no capacity)                3.7 ms      6,037,680 bytes
  Dictionary (pre-sized)                  1.8 ms      2,172,792 bytes
  SortedDictionary                       35.7 ms      4,800,152 bytes
  SortedList                              6.7 ms      2,097,992 bytes

--- how a List grows ---
  capacities seen : 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192 ...
  reallocations for 5,000 adds : 12
  Each one allocates a new array and copies everything across.
  Total copying is about 2n element moves — amortised O(1) per add,
  and entirely avoidable when the size is known in advance.</code></pre>

  <p><strong><code>Insert(0, ...)</code> is 550 times slower than <code>Add</code>.</strong> That
  is the queue-in-a-<code>List</code> incident. A list stores its elements contiguously, so
  inserting at the front moves every existing element along one place — <em>n</em> moves per
  insert, and <em>n</em>² over the whole fill. The same is true of <code>RemoveAt(0)</code>.</p>

  <p><strong>Pre-sizing halves the time and more than halves the allocation.</strong> A
  <code>List</code> starts at capacity 4 and doubles, allocating a new array and copying
  everything each time — 12 reallocations for 5,000 items. Passing the expected size to the
  constructor skips all of them: 400 KB instead of 1,049 KB, because the intermediate arrays are
  never created. The <code>Dictionary</code> figures are the same story at a larger scale: 2.17 MB
  pre-sized against 6.04 MB.</p>

  <p class="define"><span class="define__term">Pre-sizing</span> Passing the expected element count
  to a collection's constructor, so it allocates once instead of growing repeatedly. Measured below
  at half the time and 60% less allocation for a 100,000-item list.</p>

  <p class="define"><span class="define__term">Capacity</span> How many elements a collection can
  hold before it must grow. Distinct from <code>Count</code>, which is how many it holds now.</p>

  <p class="define"><span class="define__term">Amortised</span> Averaged over many operations. A
  single <code>Add</code> that triggers a resize copies everything, but because capacity doubles,
  resizes become rarer as the collection grows, and the average cost per <code>Add</code> stays
  constant. <a href="#/m/t1-06-arrays">Arrays</a> introduced this; here is the allocation it
  costs.</p>

  <div class="callout callout--gotcha">
    <h4><code>LinkedList</code> is almost never the answer</h4>
    <p>It has the property
    people reach for it for — inserting at the front is cheap — and it cost 48 bytes per element
    against <code>List</code>'s 4, and was 8× slower to fill than <code>List.Add</code>. Every
    element is a separate heap object holding two references, so iterating it chases pointers
    across memory rather than reading a contiguous array. For a front-insertion queue, use
    <code>Queue&lt;T&gt;</code>; for a stack, <code>Stack&lt;T&gt;</code>. Both are backed by
    arrays.</p>
  </div>

  <p><strong><code>SortedDictionary</code> costs about 10× <code>Dictionary</code> to fill</strong>
  (35.7 ms against 3.7) because every insertion rebalances a tree.
  <code>SortedList</code> is different again: it keeps a sorted array, so lookups are a binary
  search and it is the most compact of the three, but inserting in the middle shifts elements.</p>
</section>

<section id="iteration-and-order">
  <h2>Iterating, and what order you get</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-iteration-and-order.cs"><code>// 03-iteration-and-order.cs — what each collection guarantees about order, and
// what iterating one costs.
// .NET 10.0.400, Release. Run: dotnet run 03-iteration-and-order.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Program
{
    const int N = 200_000;

    static (double ms, long bytes) Measure(Func&lt;long&gt; body)
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
        return (best, bytes);
    }

    static void Show(string label, (double ms, long bytes) r) =&gt;
        Console.WriteLine($"  {label,-32} {r.ms,7:F1} ms   {r.bytes,8:N0} bytes/pass");

    static void Main()
    {
        var source = Enumerable.Range(0, N).ToArray();
        var list = source.ToList();
        var set = new HashSet&lt;int&gt;(source);
        var dict = source.ToDictionary(x =&gt; x, x =&gt; x);
        var sortedDict = new SortedDictionary&lt;int, int&gt;(dict);
        var linked = new LinkedList&lt;int&gt;(source);

        Console.WriteLine($"--- iterating {N:N0} elements ---");
        Show("array (for loop)", Measure(() =&gt;
        { long t = 0; for (int i = 0; i &lt; source.Length; i++) t += source[i]; return t; }));
        Show("List (for loop)", Measure(() =&gt;
        { long t = 0; for (int i = 0; i &lt; list.Count; i++) t += list[i]; return t; }));
        Show("List (foreach)", Measure(() =&gt;
        { long t = 0; foreach (var v in list) t += v; return t; }));
        Show("HashSet (foreach)", Measure(() =&gt;
        { long t = 0; foreach (var v in set) t += v; return t; }));
        Show("Dictionary (foreach)", Measure(() =&gt;
        { long t = 0; foreach (var kv in dict) t += kv.Value; return t; }));
        Show("SortedDictionary (foreach)", Measure(() =&gt;
        { long t = 0; foreach (var kv in sortedDict) t += kv.Value; return t; }));
        Show("LinkedList (foreach)", Measure(() =&gt;
        { long t = 0; foreach (var v in linked) t += v; return t; }));

        Console.WriteLine();
        Console.WriteLine("--- what each guarantees about ORDER ---");
        var words = new[] { "pear", "fig", "banana", "apple", "kiwi" };

        Console.WriteLine($"  List            : {string.Join(", ", new List&lt;string&gt;(words))}");
        Console.WriteLine($"  Queue (FIFO)    : {string.Join(", ", new Queue&lt;string&gt;(words))}");
        Console.WriteLine($"  Stack (LIFO)    : {string.Join(", ", new Stack&lt;string&gt;(words))}");
        Console.WriteLine($"  SortedSet       : {string.Join(", ", new SortedSet&lt;string&gt;(words))}");
        Console.WriteLine($"  HashSet         : {string.Join(", ", new HashSet&lt;string&gt;(words))}");
        Console.WriteLine("  HashSet order is an accident of hashing and capacity. It is stable");
        Console.WriteLine("  within one run and must never be relied on.");

        Console.WriteLine();
        Console.WriteLine("--- Dictionary order is also not a guarantee ---");
        var d = new Dictionary&lt;string, int&gt;();
        foreach (var w in words) d[w] = w.Length;
        Console.WriteLine($"  insertion order : {string.Join(", ", words)}");
        Console.WriteLine($"  enumerated      : {string.Join(", ", d.Keys)}");
        d.Remove("banana");
        d["cherry"] = 6;
        Console.WriteLine($"  after remove+add: {string.Join(", ", d.Keys)}");
        Console.WriteLine("  The new key reused the removed key's slot. Enumeration order");
        Console.WriteLine("  reflects internal layout, not insertion, and changes as you edit.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- iterating 200,000 elements ---
  array (for loop)                     0.1 ms         40 bytes/pass
  List (for loop)                      0.1 ms         40 bytes/pass
  List (foreach)                       0.3 ms         40 bytes/pass
  HashSet (foreach)                    0.4 ms         40 bytes/pass
  Dictionary (foreach)                 0.3 ms         40 bytes/pass
  SortedDictionary (foreach)           3.2 ms        368 bytes/pass
  LinkedList (foreach)                 1.1 ms         40 bytes/pass

--- what each guarantees about ORDER ---
  List            : pear, fig, banana, apple, kiwi
  Queue (FIFO)    : pear, fig, banana, apple, kiwi
  Stack (LIFO)    : kiwi, apple, banana, fig, pear
  SortedSet       : apple, banana, fig, kiwi, pear
  HashSet         : pear, fig, banana, apple, kiwi
  HashSet order is an accident of hashing and capacity. It is stable
  within one run and must never be relied on.

--- Dictionary order is also not a guarantee ---
  insertion order : pear, fig, banana, apple, kiwi
  enumerated      : pear, fig, banana, apple, kiwi
  after remove+add: pear, fig, cherry, apple, kiwi
  The new key reused the removed key's slot. Enumeration order
  reflects internal layout, not insertion, and changes as you edit.</code></pre>

  <p><strong>Iteration is cheap for everything except trees.</strong> Array, list, hash set and
  dictionary all iterate 200,000 elements in well under a millisecond, allocating essentially
  nothing. <code>SortedDictionary</code> is 10× slower and is the only one that allocates per pass,
  because walking a tree needs a stack of nodes.</p>

  <p><strong>The last block is the trap worth remembering.</strong> A <code>Dictionary</code>
  enumerated in insertion order for the first five inserts — which is exactly why people come to
  rely on it. Then one key was removed and a new one added, and
  <code>cherry</code> appeared <em>in the middle</em>, where <code>banana</code> had been. The new
  entry reused the freed slot.</p>

  <p class="define"><span class="define__term">Enumeration order</span> The order a collection
  yields its elements. <code>List</code>, <code>Queue</code>, <code>Stack</code> and
  <code>SortedSet</code> guarantee one. <code>HashSet</code> and <code>Dictionary</code> guarantee
  <em>nothing</em> — their order reflects internal layout, is stable only while the collection is
  unmodified, and can change between runtime versions.</p>

  <p>Code that depends on dictionary order works until the first removal, which may be months
  later and in a different component. If you need order, say so with the type: a
  <code>List&lt;KeyValuePair&lt;K,V&gt;&gt;</code>, a <code>SortedDictionary</code>, or an explicit
  <code>OrderBy</code> at the point of use.</p>
</section>

<section id="production-example">
  <h2>The same feature, twice</h2>

  <p>The catalogue from the top of this module. Both classes have identical public surfaces and
  return identical answers; only the field types differ.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>// 04-production.cs — the same feature written twice: once with the collection
// that came to mind, once with the one the access pattern wanted.
// .NET 10.0.400, Release. Run: dotnet run 04-production.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

public readonly record struct Product(string Sku, string Category, decimal Price);

// ---- the version that grew one requirement at a time ---------------------
public sealed class SlowCatalogue
{
    private readonly List&lt;Product&gt; _products = new();
    private readonly List&lt;string&gt; _blockedSkus = new();

    public void Add(Product p) =&gt; _products.Add(p);
    public void Block(string sku) =&gt; _blockedSkus.Add(sku);

    public Product? Find(string sku) =&gt;
        _products.FirstOrDefault(p =&gt; p.Sku == sku) is { Sku: not null } hit ? hit : null;

    public bool IsBlocked(string sku) =&gt; _blockedSkus.Contains(sku);

    public IReadOnlyList&lt;Product&gt; InCategory(string category) =&gt;
        _products.Where(p =&gt; p.Category == category).ToList();
}

// ---- the version matched to how it is actually used ----------------------
public sealed class FastCatalogue
{
    private readonly Dictionary&lt;string, Product&gt; _bySku;
    private readonly HashSet&lt;string&gt; _blockedSkus;
    private readonly Dictionary&lt;string, List&lt;Product&gt;&gt; _byCategory;

    public FastCatalogue(IEnumerable&lt;Product&gt; products)
    {
        var all = products.ToArray();
        _bySku = new Dictionary&lt;string, Product&gt;(all.Length, StringComparer.Ordinal);
        _byCategory = new Dictionary&lt;string, List&lt;Product&gt;&gt;(StringComparer.Ordinal);
        _blockedSkus = new HashSet&lt;string&gt;(StringComparer.Ordinal);

        foreach (var p in all)
        {
            _bySku[p.Sku] = p;
            if (!_byCategory.TryGetValue(p.Category, out var bucket))
                _byCategory[p.Category] = bucket = new List&lt;Product&gt;();
            bucket.Add(p);
        }
    }

    public void Block(string sku) =&gt; _blockedSkus.Add(sku);

    public Product? Find(string sku) =&gt;
        _bySku.TryGetValue(sku, out var p) ? p : null;

    public bool IsBlocked(string sku) =&gt; _blockedSkus.Contains(sku);

    public IReadOnlyList&lt;Product&gt; InCategory(string category) =&gt;
        _byCategory.TryGetValue(category, out var bucket)
            ? bucket
            : Array.Empty&lt;Product&gt;();
}

class Program
{
    const int Catalogue = 50_000;
    const int Lookups = 20_000;

    static void Main()
    {
        var categories = new[] { "tools", "garden", "kitchen", "office", "sport" };
        var products = Enumerable.Range(0, Catalogue)
            .Select(i =&gt; new Product($"SKU-{i}", categories[i % 5], 1m + i % 90))
            .ToArray();

        var slow = new SlowCatalogue();
        foreach (var p in products) slow.Add(p);
        for (int i = 0; i &lt; 500; i++) slow.Block($"SKU-{i * 7}");

        var fast = new FastCatalogue(products);
        for (int i = 0; i &lt; 500; i++) fast.Block($"SKU-{i * 7}");

        Console.WriteLine($"catalogue of {Catalogue:N0} products, {Lookups:N0} operations each");
        Console.WriteLine();

        Time("SlowCatalogue.Find", () =&gt;
        { int n = 0; for (int i = 0; i &lt; Lookups; i++) if (slow.Find($"SKU-{i}") is not null) n++; return n; });
        Time("FastCatalogue.Find", () =&gt;
        { int n = 0; for (int i = 0; i &lt; Lookups; i++) if (fast.Find($"SKU-{i}") is not null) n++; return n; });

        Console.WriteLine();
        Time("SlowCatalogue.IsBlocked", () =&gt;
        { int n = 0; for (int i = 0; i &lt; Lookups; i++) if (slow.IsBlocked($"SKU-{i}")) n++; return n; });
        Time("FastCatalogue.IsBlocked", () =&gt;
        { int n = 0; for (int i = 0; i &lt; Lookups; i++) if (fast.IsBlocked($"SKU-{i}")) n++; return n; });

        Console.WriteLine();
        Time("SlowCatalogue.InCategory x1000", () =&gt;
        { int n = 0; for (int i = 0; i &lt; 1000; i++) n += slow.InCategory(categories[i % 5]).Count; return n; });
        Time("FastCatalogue.InCategory x1000", () =&gt;
        { int n = 0; for (int i = 0; i &lt; 1000; i++) n += fast.InCategory(categories[i % 5]).Count; return n; });

        Console.WriteLine();
        Console.WriteLine("Same answers, same code shape at the call site. The difference is");
        Console.WriteLine("entirely which collection each field is, chosen from how it is read.");
    }

    static void Time(string label, Func&lt;int&gt; body)
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
            if (v == 0) throw new Exception("nothing found");
            bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-34} {best,8:F1} ms   {bytes,12:N0} bytes");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>catalogue of 50,000 products, 20,000 operations each

  SlowCatalogue.Find                    996.5 ms      2,496,024 bytes
  FastCatalogue.Find                      3.1 ms        799,960 bytes

  SlowCatalogue.IsBlocked                33.9 ms        799,960 bytes
  FastCatalogue.IsBlocked                 1.1 ms        799,960 bytes

  SlowCatalogue.InCategory x1000       1577.9 ms   1,049,645,816 bytes
  FastCatalogue.InCategory x1000          0.1 ms             40 bytes

Same answers, same code shape at the call site. The difference is
entirely which collection each field is, chosen from how it is read.</code></pre>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Operation</th><th>Slow</th><th>Fast</th><th>Factor</th><th>What changed</th></tr></thead>
    <tbody>
      <tr><td><code>Find</code></td><td>996.5 ms</td><td>3.1 ms</td><td><strong>321×</strong></td>
          <td><code>List</code> + <code>FirstOrDefault</code> → <code>Dictionary</code></td></tr>
      <tr><td><code>IsBlocked</code></td><td>33.9 ms</td><td>1.1 ms</td><td><strong>31×</strong></td>
          <td><code>List.Contains</code> → <code>HashSet.Contains</code></td></tr>
      <tr><td><code>InCategory</code></td><td>1577.9 ms</td><td>0.1 ms</td><td><strong>15,000×</strong></td>
          <td><code>Where().ToList()</code> → a pre-grouped <code>Dictionary</code></td></tr>
    </tbody>
  </table>
  </div>

  <p><strong>The allocation figure is the one to notice.</strong>
  <code>InCategory</code> allocated <strong>1.05 GB</strong> across a thousand calls — because
  <code>Where(...).ToList()</code> builds a brand-new list of ten thousand products every time it
  is called. The fast version returns the existing bucket and allocates 40 bytes in total. That is
  the gigabyte from the top of the module, and there is no <code>new</code> anywhere near the call
  site that produces it.</p>

  <p>Three decisions produced all of it:</p>

  <p><strong>Index by what you look up by.</strong> Products are found by SKU, so the field is
  keyed by SKU. Storing a <code>List</code> and searching it is choosing to re-derive that index on
  every request.</p>

  <p><strong>Use a set for membership.</strong> <code>_blockedSkus</code> answers exactly one
  question — "is this one in here?" — which is what a <code>HashSet</code> is.</p>

  <p><strong>Pre-group what you group by.</strong> Building
  <code>Dictionary&lt;string, List&lt;Product&gt;&gt;</code> once at construction turns a repeated
  scan-and-copy into a single lookup returning an existing list.</p>

  <div class="callout callout--note">
    <h4>The trade being made</h4>
    <p><code>FastCatalogue</code> holds three structures
    over the same products instead of one, so it uses more memory and must be rebuilt when the
    catalogue changes. That is the right trade for data read thousands of times and written rarely,
    and the wrong one for data that changes constantly. The question is never "which collection is
    fastest" but "which access pattern dominates".</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A List used as a lookup table</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: linear search on every request"><code>// WRONG. Each call scans the list. At 50,000 products this measured 996 ms
// for 20,000 lookups — 321x slower than the dictionary version.
private readonly List&lt;Product&gt; _products = new();

public Product? Find(string sku) =&gt; _products.FirstOrDefault(p =&gt; p.Sku == sku);</code></pre>

  <p>Reads well, and is the single most common performance defect in code that holds reference
  data in memory. The tell is a <code>FirstOrDefault</code>, <code>Single</code>, <code>Any</code>
  or <code>Contains</code> with a predicate over a field, inside anything called per request.</p>

  <h3>2. A List used as a queue</h3>

  <p><code>Insert(0, ...)</code> and <code>RemoveAt(0)</code> both move every element. Measured at
  606 ms for 100,000 items against 0.4 ms for <code>Add</code>. Use <code>Queue&lt;T&gt;</code>,
  which is backed by a circular array and does neither.</p>

  <h3>3. LINQ that rebuilds a collection per call</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a new list on every call"><code>// WRONG. Where(...).ToList() allocates a fresh list of every match, every
// time. Measured at 1.05 GB across a thousand calls.
public IReadOnlyList&lt;Product&gt; InCategory(string category) =&gt;
    _products.Where(p =&gt; p.Category == category).ToList();</code></pre>

  <p>The allocation is invisible at the call site — there is no <code>new</code> — which is why it
  shows up as a mysterious GC problem rather than as a slow method.</p>

  <h3>4. Not pre-sizing when the size is known</h3>

  <p>Filling a 100,000-item <code>List</code> without capacity allocated 1,049 KB against 400 KB,
  and a <code>Dictionary</code> 6.04 MB against 2.17 MB. Every intermediate array is garbage. When
  you know the size — from a <code>Count</code>, a row count, a page size — pass it.</p>

  <h3>5. Relying on dictionary enumeration order</h3>

  <p>It matched insertion order for five inserts and then did not, after one removal. There is no
  guarantee and never has been. Code that depends on it works in testing and reorders itself in
  production once entries start being removed.</p>

  <h3>6. Reaching for LinkedList</h3>

  <p>48 bytes per element against <code>List</code>'s 4, 8× slower to fill, and slower to iterate
  because it chases pointers. Its one advantage — cheap insertion given a node reference — is
  needed far less often than it is invoked.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>An endpoint is slow and the profiler blames a collection method</h4>
    <p>Do not
    optimise the method — check the shape. Run the same operation at two sizes an order of
    magnitude apart, as this module's tables do. Time that grows with the collection means a scan
    where a lookup belongs. Time that stays flat means the collection is not the problem.</p>
  </div>

  <div class="callout callout--debug">
    <h4>Unexplained allocation with no <code>new</code> in the hot path</h4>
    <p>Look for
    LINQ that materialises: <code>ToList</code>, <code>ToArray</code>, <code>ToDictionary</code>,
    <code>GroupBy</code>, <code>OrderBy</code>. Each allocates a whole new collection per call.
    <code>GC.GetTotalAllocatedBytes(precise: true)</code> around the suspect block gives an exact
    figure in one run — more direct than a memory profiler for a question this specific.</p>
  </div>

  <div class="callout callout--debug">
    <h4>Filling a collection is slower than expected</h4>
    <p>Check for a capacity
    argument, and check where you are inserting. <code>Insert(0, ...)</code> and
    <code>RemoveAt(0)</code> are the two calls that turn a linear fill into a quadratic one, and
    they look no more expensive than <code>Add</code>. Search the file for
    <code>Insert(0</code> and <code>RemoveAt(0)</code> before profiling anything.</p>
  </div>

  <div class="callout callout--debug">
    <h4>Output order changed and no ordering code did</h4>
    <p>Something is enumerating a
    <code>Dictionary</code> or <code>HashSet</code>. The change usually coincides with a removal
    being introduced, or a runtime upgrade. Make the ordering explicit with
    <code>OrderBy</code> at the point of use, or change the type to one that guarantees order — do
    not try to restore the old accident.</p>
  </div>

  <div class="callout callout--debug">
    <h4>Choosing a collection for code you are writing</h4>
    <p>Answer three questions
    before picking a type: how will this be looked up, will it be enumerated in a particular order,
    and roughly how large will it get. If the answer to the first is "by a key", the type is a
    dictionary or a set, whatever the data looks like. Getting this right when writing costs
    nothing; changing it later means touching every use.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A concrete case</h4>
    <p>A pricing API held reference data in memory: about 50,000
    products, refreshed nightly, read on every request. It served roughly 1,200 requests a second
    at peak across eight instances. Each request looked up a product by SKU, checked a blocked-SKU
    list, and fetched the products in a category for an upsell panel — the three operations
    measured in this module's production example.</p>
    <p>All three were backed by a <code>List&lt;Product&gt;</code>. At launch the catalogue held
    about 400 products and the endpoint responded in 4 ms. Over two years the catalogue grew to
    50,000 and the endpoint reached about 900 ms, having crossed 100 ms so gradually that no
    single release ever looked responsible.</p>
    <p>The scaling response had been to add instances — from three to eight — which helped, because
    each instance handled fewer concurrent requests. It also multiplied the memory: the upsell
    panel's <code>Where(...).ToList()</code> allocated roughly a megabyte per call, so at peak the
    fleet was producing over a gigabyte per second of garbage and spending a substantial fraction
    of its CPU collecting it.</p>
    <p>The fix was the <code>FastCatalogue</code> shape: a dictionary keyed by SKU, a hash set of
    blocked SKUs, and categories pre-grouped at load. About 40 lines, no change to any caller.
    Endpoint p99 went from 900 ms to 6 ms, allocation dropped by roughly three orders of magnitude,
    and the fleet went back to three instances.</p>
    <p>The catalogue had been growing 4% a month for two years. The cost of a linear scan grows
    with it; the cost of a hash lookup does not. That is the entire story, and it was decided by a
    field declaration written when the catalogue had 400 products in it.</p>
  </div>

  <p>The general principle: <strong>collection choice is a decision about growth, made before you
  know how much growth there will be.</strong> A scan over a hundred items is genuinely faster than
  a hash lookup — the measurements show <code>List</code> beating <code>HashSet</code> at n=10.
  The difference is that one of those costs stays where it is and the other tracks your data.</p>

  <p>That asymmetry is why the default should be the one that does not grow. Choosing a
  <code>Dictionary</code> for a lookup that will only ever hold twenty items costs almost nothing.
  Choosing a <code>List</code> for one that reaches fifty thousand costs 321×, and by then the
  decision is spread across every method that touches the field.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"A Dictionary is always faster than a List"</h4>
    <p>At ten items the list won —
    1.2 ms against 2.1. Hashing has a fixed cost that scanning a handful of elements does not
    reach. The dictionary's advantage is that its cost does not change; the list's is that its
    fixed cost is nearly zero. The crossover is in the low tens.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"LINQ is slow"</h4>
    <p>LINQ is a thin layer; what costs is what it is asked to do
    over what. <code>Where(...).FirstOrDefault(...)</code> over a list is a scan and would be a
    scan written by hand. The measured 1.05 GB came from <code>ToList()</code> materialising a new
    collection per call, not from LINQ being LINQ.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"LinkedList is good for frequent insertions"</h4>
    <p>Measured at 48 bytes per
    element against 4, 8× slower to fill than <code>List.Add</code>, and slower to iterate. Its
    advantage needs a node reference you already hold; if you are searching for the position first,
    you have paid a scan and gained nothing. <code>Queue&lt;T&gt;</code> and
    <code>Stack&lt;T&gt;</code> cover almost every case people reach for it for.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Dictionary preserves insertion order"</h4>
    <p>It appeared to for five inserts and
    then did not: after one removal, a new key took the freed slot in the middle. There is no
    guarantee, it varies with edit history, and it can change between runtime versions.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Pre-sizing is a micro-optimisation"</h4>
    <p>It halved the fill time and removed
    60% of the allocation for a 100,000-item list, and two thirds for a dictionary. It costs one
    constructor argument when the size is already known, which it usually is.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"SortedDictionary is a Dictionary that keeps order"</h4>
    <p>It is a different data
    structure — a balanced tree, not a hash table. Lookups are logarithmic rather than constant,
    insertion is about 10× slower, and iteration allocates. Use it when you need range queries or
    sorted traversal, not when you want a dictionary that enumerates tidily.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>You need to…</th><th>Use</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>look up by key</td><td><code>Dictionary&lt;K,V&gt;</code></td>
          <td>Flat cost as it grows. The single most valuable substitution in this module.</td></tr>
      <tr><td>ask "is this present?"</td><td><code>HashSet&lt;T&gt;</code></td>
          <td>Same mechanism, no value to carry. 31× faster than <code>List.Contains</code> at
          50,000.</td></tr>
      <tr><td>keep an ordered sequence, access by position</td><td><code>List&lt;T&gt;</code></td>
          <td>Contiguous, 4 bytes per <code>int</code>, fastest iteration.</td></tr>
      <tr><td>fixed size, known at creation</td><td><code>T[]</code></td>
          <td>Slightly leaner than <code>List</code>; no growth machinery.</td></tr>
      <tr><td>first in, first out</td><td><code>Queue&lt;T&gt;</code></td>
          <td>Backed by a circular array. <code>List.RemoveAt(0)</code> is 550× worse.</td></tr>
      <tr><td>last in, first out</td><td><code>Stack&lt;T&gt;</code></td>
          <td>Array-backed; <code>Push</code> and <code>Pop</code> touch one end.</td></tr>
      <tr><td>iterate in sorted order, or query ranges</td><td><code>SortedDictionary&lt;K,V&gt;</code></td>
          <td>A tree: logarithmic lookup, sorted traversal. About 10× the insert cost.</td></tr>
      <tr><td>sorted, mostly read, memory matters</td><td><code>SortedList&lt;K,V&gt;</code></td>
          <td>Sorted array with binary search — the most compact of the sorted options.</td></tr>
      <tr><td>look up by two different keys</td><td>two dictionaries over the same values</td>
          <td>Cheaper than scanning by the second key. The production example does this.</td></tr>
      <tr><td>group by a key and read repeatedly</td>
          <td><code>Dictionary&lt;K, List&lt;V&gt;&gt;</code> built once</td>
          <td>Turns a repeated <code>Where().ToList()</code> into one lookup — 15,000× here.</td></tr>
      <tr><td>know the size in advance</td><td>pass it to the constructor</td>
          <td>Removes every intermediate array. Halves the time, cuts allocation by 60%.</td></tr>
      <tr><td>insert cheaply at both ends of a large sequence</td><td><code>LinkedList&lt;T&gt;</code>, reluctantly</td>
          <td>Only when you already hold node references. 48 bytes per element otherwise.</td></tr>
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
    <p>Predict how <code>List.Contains</code> and <code>HashSet.Contains</code> each change as the
    collection grows tenfold, twice. Then explain why the ratio grows but the list's own time does
    not grow by exactly ten each step.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>       n    List.Contains   HashSet.Contains      ratio
   1,000              4.4                0.2        25x
  10,000             29.5                0.2       166x
 100,000            158.3                0.5       291x</code></pre>
        <p><strong>The list grows and the set does not.</strong> That is the shape to carry: 4.4 →
        29.5 → 158.3 against 0.2 → 0.2 → 0.5, and a ratio going 25× → 166× → 291×.</p>
        <p><strong>Why the list's time does not multiply by exactly ten.</strong> The comparison
        count does. With 20,000 lookups and an average scan depth of n/2, the work is 10 million,
        100 million and 1,000 million comparisons — exactly ten times more each step. The time went
        up 6.7× and then 5.4×.</p>
        <p>So the <em>per-comparison</em> cost fell: about 0.44, 0.30 and 0.16 nanoseconds. Scanning
        a longer contiguous run is more efficient per element, because the hardware prefetches
        sequential memory and the loop's fixed overhead is spread over more work. A short scan
        pays setup costs that a long one amortises.</p>
        <p><strong>The lesson for reading benchmarks:</strong> "linear" describes the number of
        operations, not the wall-clock, and the two differ because hardware is not uniform. The
        conclusion is unaffected — the list's cost tracks the data and the set's does not — but a
        prediction of "exactly 10× slower" would have been wrong, and noticing that is what tells
        you the measurement is real rather than assumed.</p>
        <p>Note also the benchmark had to be designed for this. Probing with <code>i % n</code>
        would only touch the first 20,000 values once n exceeds that, so the scan would find them
        early and the growth would be hidden. The measurement uses a prime stride to spread lookups
        across the whole collection at every size.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A pending-jobs queue is a <code>List</code>, filled with <code>Insert(0, job)</code>.
    Predict how the fill time changes as the count doubles, identify the shape, and give the fix
    with the reason it works.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>n=10,000   Add     0.0 ms   Insert(0)      6.0 ms   Push     0.1 ms
n=20,000   Add     0.1 ms   Insert(0)     27.5 ms   Push     0.1 ms
n=40,000   Add     0.1 ms   Insert(0)    117.0 ms   Push     0.1 ms</code></pre>
        <p><strong>Doubling the count roughly quadruples the time</strong> — 6.0 → 27.5 → 117.0,
        which is ×4.6 then ×4.3. That is the signature of <strong>quadratic</strong> growth, and it
        is the one shape that turns a working feature into an outage without any single change
        causing it.</p>
        <p><strong>Why.</strong> A <code>List</code> stores elements contiguously in an array.
        Inserting at index 0 has to move every existing element one place along to make room — so
        the <em>i</em>-th insert moves <em>i</em> elements, and the total over <em>n</em> inserts is
        about n²/2 element moves. <code>Add</code> writes at the end and moves nothing.</p>
        <p><strong>The fix</strong> is <code>Queue&lt;T&gt;</code> for FIFO or
        <code>Stack&lt;T&gt;</code> for LIFO — <code>Push</code> stayed at 0.1 ms at every size.
        Both are backed by an array with an index at each end, so adding and removing touch one
        slot and move nothing.</p>
        <p><strong>If the order must stay as written</strong> and items are consumed from the
        front, note that <code>RemoveAt(0)</code> has exactly the same problem in reverse.
        <code>Queue&lt;T&gt;</code> handles both ends because it wraps around the array rather than
        shifting. If you genuinely need indexed access <em>and</em> cheap front removal, the answer
        is usually to reverse the logic — append with <code>Add</code> and consume from the end with
        <code>RemoveAt(Count - 1)</code>, which moves nothing.</p>
        <p>The practical detection: <code>Insert(0</code> and <code>RemoveAt(0)</code> are worth
        grepping for. They look no more expensive than their alternatives and they are the two
        calls in the collection API that cost <em>n</em> each time.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Predict the bytes per element for a <code>List&lt;int&gt;</code>,
    <code>HashSet&lt;int&gt;</code>, <code>Dictionary&lt;int,int&gt;</code>,
    <code>SortedDictionary&lt;int,int&gt;</code> and <code>LinkedList&lt;int&gt;</code> holding
    100,000 integers. Explain the two largest, and say what that means for a cache.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>List&lt;int&gt;                         400,392 bytes      4.0 per element
HashSet&lt;int&gt;                    1,738,552 bytes     17.4 per element
Dictionary&lt;int,int&gt;             2,173,088 bytes     21.7 per element
SortedDictionary&lt;int,int&gt;       4,800,448 bytes     48.0 per element
LinkedList&lt;int&gt;                 4,800,040 bytes     48.0 per element</code></pre>
        <p><strong><code>List&lt;int&gt;</code> is 4.0 bytes per element</strong> — exactly the size
        of an <code>int</code>, because it is one array and nothing else. This is the floor.</p>
        <p><strong><code>Dictionary</code> is 5.4× that.</strong> Each entry stores the hash code,
        a next-entry index for its bucket chain, the key and the value — four fields, plus the
        bucket array, plus slack from the prime-sized capacity. <code>HashSet</code> is the same
        machinery without a separate value, which is why it lands lower at 17.4.</p>
        <p><strong>The two largest are 48 bytes per element, and for different reasons.</strong></p>
        <ul>
          <li><strong><code>LinkedList</code></strong>: each element is a separate heap object —
          a 16-byte header, a next reference, a previous reference, a list reference, and the value.
          The value is 4 of the 48 bytes; the rest is bookkeeping.</li>
          <li><strong><code>SortedDictionary</code></strong>: each element is a tree node object
          with a header, left and right child references, the colour flag, key and value.</li>
        </ul>
        <p><strong>What this means for a cache.</strong> Memory per element is a first-class
        concern when the collection is large and long-lived, and the difference is not marginal:
        a million-entry cache costs 4 MB as a <code>List</code>, 22 MB as a
        <code>Dictionary</code>, and 48 MB as a <code>LinkedList</code>.</p>
        <p>The second-order effect matters more. <code>List</code>'s million elements are
        <strong>one object</strong> the garbage collector traces; <code>LinkedList</code>'s are
        <strong>a million objects</strong>, each traced on every collection that reaches them, and
        each promoted individually into gen2 — which is precisely the shape of the
        <code>List&lt;object&gt;</code> problem in <a href="#/m/t1-17-generics">Generics</a>. A
        long-lived cache built from per-element objects makes every full collection more expensive
        for the whole process, not only for the code that reads the cache.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A catalogue class supports three operations. Predict which is worst, rewrite the class, and
    for each of the three say what you changed and what the change costs. Then state the condition
    under which the rewrite would be wrong.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 4 — as given"><code>public sealed class SlowCatalogue
{
    private readonly List&lt;Product&gt; _products = new();
    private readonly List&lt;string&gt; _blockedSkus = new();

    public Product? Find(string sku) =&gt;
        _products.FirstOrDefault(p =&gt; p.Sku == sku);

    public bool IsBlocked(string sku) =&gt; _blockedSkus.Contains(sku);

    public IReadOnlyList&lt;Product&gt; InCategory(string category) =&gt;
        _products.Where(p =&gt; p.Category == category).ToList();
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output — 50,000 products"><code>SlowCatalogue.Find                    996.5 ms      2,496,024 bytes
FastCatalogue.Find                      3.1 ms        799,960 bytes

SlowCatalogue.IsBlocked                33.9 ms        799,960 bytes
FastCatalogue.IsBlocked                 1.1 ms        799,960 bytes

SlowCatalogue.InCategory x1000       1577.9 ms   1,049,645,816 bytes
FastCatalogue.InCategory x1000          0.1 ms             40 bytes</code></pre>
        <p><strong><code>InCategory</code> is by far the worst</strong>, and not for the reason the
        other two are slow. It is 15,000× slower <em>and</em> allocates <strong>1.05 GB</strong>
        across a thousand calls, because <code>Where(...).ToList()</code> builds a fresh list of
        ten thousand products every single time. The other two are slow; this one is slow and
        produces garbage on a scale that affects the whole process.</p>
        <p><strong>The rewrite, change by change:</strong></p>
        <div class="table-wrap">
        <table>
          <thead><tr><th>Operation</th><th>Change</th><th>Gain</th><th>Cost</th></tr></thead>
          <tbody>
            <tr><td><code>Find</code></td>
                <td><code>List</code> → <code>Dictionary&lt;string, Product&gt;</code></td>
                <td>321×</td>
                <td>One extra index in memory; must be maintained on write.</td></tr>
            <tr><td><code>IsBlocked</code></td>
                <td><code>List</code> → <code>HashSet&lt;string&gt;</code></td>
                <td>31×</td>
                <td>None worth naming — a set is strictly better for membership.</td></tr>
            <tr><td><code>InCategory</code></td>
                <td>Pre-group into <code>Dictionary&lt;string, List&lt;Product&gt;&gt;</code></td>
                <td>15,000× and 1.05 GB</td>
                <td>Stores every product twice by reference; returns a live list, so it must not be
                handed out mutable.</td></tr>
          </tbody>
        </table>
        </div>
        <p>Note the last cost carefully: returning the internal bucket rather than a copy is exactly
        what made it fast, and exactly the leak
        <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a> warns about. The
        return type is <code>IReadOnlyList&lt;Product&gt;</code>, which as that module measured is a
        statement of intent rather than a guarantee — a caller can cast it back. If the catalogue is
        internal to one component that is an acceptable trade; if it is a public API, wrap the
        buckets in <code>ReadOnlyCollection</code> once at construction, which costs nothing per
        call.</p>
        <p><strong>When the rewrite would be wrong.</strong> When writes dominate reads. Every
        index has to be maintained: adding one product now touches three structures instead of one,
        and <code>_byCategory</code> has to be rebuilt or carefully updated. For data written
        constantly and read rarely — an event log, a request buffer — the extra indexes are pure
        cost, and the <code>List</code> is genuinely the right structure.</p>
        <p>The catalogue here is refreshed nightly and read thousands of times a second, so the
        trade is not close. <strong>The general form is: index what you read by, as long as you read
        far more than you write</strong> — which is the same reasoning a database uses to decide
        whether an index earns its place.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What two questions determine a collection's cost model?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>How do you find an item</strong> — by position, by scanning, by hashing, or by
        walking a tree — and <strong>what happens when you add or remove one</strong> — nothing, a
        copy, a reallocation, or a rebalance. Everything else follows.</p>
      </div></details>
    </li>
    <li>
      <p>At what size does <code>Dictionary</code> beat <code>List</code> for lookup, and what
      happens below it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Somewhere in the <strong>low tens</strong>. At n=10 the list was faster (1.2 vs 2.1 ms)
        because hashing has a fixed cost a short scan never reaches. At n=100,000 the list was
        <strong>540× slower</strong>. The dictionary's advantage is that its cost does not
        change.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>List.Insert(0, ...)</code> quadratic, and what should replace it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A list is contiguous, so inserting at the front moves every existing element along —
        <em>i</em> moves for the <em>i</em>-th insert, about n²/2 in total. Measured at 606 ms for
        100,000 against 0.4 ms for <code>Add</code>. Use <code>Queue&lt;T&gt;</code> or
        <code>Stack&lt;T&gt;</code>; both are array-backed and move nothing.
        <code>RemoveAt(0)</code> has the same problem.</p>
      </div></details>
    </li>
    <li>
      <p>What does pre-sizing save, and by how much?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Every intermediate array from doubling. A 100,000-item <code>List</code> went from
        1,049 KB to 400 KB and 1.1 ms to 0.4 ms; a <code>Dictionary</code> from 6.04 MB to 2.17 MB.
        It costs one constructor argument.</p>
      </div></details>
    </li>
    <li>
      <p>Which collections guarantee enumeration order, and which do not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Guarantee it:</strong> <code>List</code>, <code>Queue</code> (FIFO),
        <code>Stack</code> (LIFO), <code>SortedSet</code> and <code>SortedDictionary</code>
        (sorted). <strong>Do not:</strong> <code>HashSet</code> and <code>Dictionary</code> — their
        order reflects internal layout and changes as entries are removed and added.</p>
      </div></details>
    </li>
    <li>
      <p>What happened when a dictionary key was removed and a new one added?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The new key <strong>reused the freed slot</strong>, so <code>cherry</code> appeared in
        the middle where <code>banana</code> had been, not at the end. Enumeration had matched
        insertion order for the first five inserts — which is exactly why people come to rely on
        it.</p>
      </div></details>
    </li>
    <li>
      <p>Where did 1.05 GB of allocation come from with no <code>new</code> in the hot path?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Where(...).ToList()</code> — materialising a fresh list of every match on every
        call, a thousand times. LINQ operators that materialise (<code>ToList</code>,
        <code>ToArray</code>, <code>ToDictionary</code>, <code>GroupBy</code>,
        <code>OrderBy</code>) allocate a whole collection each time.</p>
      </div></details>
    </li>
    <li>
      <p>Give the bytes per element for <code>List&lt;int&gt;</code> and
      <code>LinkedList&lt;int&gt;</code>, and the second-order cost of the difference.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>4.0 against 48.0</strong> — twelve times. The second-order cost is worse: a
        million-element <code>List</code> is <strong>one object</strong> for the garbage collector
        to trace, while a <code>LinkedList</code> is <strong>a million</strong>, each traced and
        promoted individually.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>SortedDictionary</code> not merely "a Dictionary that keeps order"?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It is a balanced tree, not a hash table: lookups are logarithmic rather than flat,
        insertion measured about 10× slower (35.7 vs 3.7 ms), and iteration is the only one that
        allocates per pass. Use it for range queries and sorted traversal, not for tidy
        enumeration.</p>
      </div></details>
    </li>
    <li>
      <p>What single substitution gave the largest measured gain, and why so large?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Pre-grouping by category into <code>Dictionary&lt;string, List&lt;Product&gt;&gt;</code>
        — <strong>15,000×</strong> and 1.05 GB less allocation. It removed two costs at once: the
        repeated scan <em>and</em> the new list built on every call.</p>
      </div></details>
    </li>
    <li>
      <p>When is indexing by what you read by the wrong choice?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When <strong>writes dominate reads</strong>. Every index must be maintained, so adding
        an item touches several structures instead of one. For an event log or a request buffer the
        indexes are pure cost. The rule is the one a database uses: index what you read by, if you
        read far more than you write.</p>
      </div></details>
    </li>
    <li>
      <p>What is the first diagnostic step when a collection-heavy method is slow?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Measure the <strong>shape</strong>, not the time: run the same operation at two sizes an
        order of magnitude apart. Growing with the collection means a scan where a lookup belongs.
        Staying flat means the collection is not the problem and optimising it will achieve
        nothing.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
