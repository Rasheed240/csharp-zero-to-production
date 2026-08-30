/* ============================================================================
   Track 1, Module 16 — Equality, GetHashCode, and Comparers
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-16-equality-and-hashing/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-16-equality-and-hashing",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "The hash code contract is one sentence long and breaking it corrupts a dictionary silently. " +
    "A key that is equal to a stored key but hashes differently can never be found; a key mutated " +
    "after insertion makes its own entry unreachable; and a struct without IEquatable compares " +
    "through reflection, measured here at over a hundred times slower.",
  terms: [
    "value equality", "hash code", "hash code contract",
    "bucket", "collision", "IEquatable", "IEqualityComparer", "IComparer",
    "HashCode.Combine", "StringComparer",
    "total order", "immutable key", "boxing", "ObjectEqualityComparer",
    "GenericEqualityComparer", "CS0659", "hash distribution"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A dictionary reports a count of one. Enumerating it yields the entry. Looking it up by the
  very object that was used to store it returns false. Removing it returns false. Storing an equal
  key again produces a second entry, and printing both keys shows the same text twice.</p>

  <p>Elsewhere, a lookup service degrades over a week from 3 ms to 4 seconds. No code changed, no
  traffic pattern changed, and the dictionary it uses has the same number of entries it always had.
  The profiler says the time is inside <code>Dictionary.TryGetValue</code>.</p>

  <p>And a third: a batch job comparing sensor readings runs for 40 minutes when the same logic
  over the same data in a colleague's prototype took 20 seconds. Both use a struct. Both compare
  with <code>==</code> through a generic method. The struct has three fields.</p>

  <p>All three come from one sentence that most C# code never has to think about, and that breaks
  loudly the moment you write a type used as a dictionary key. This module is that sentence, what
  enforces it, and what each way of breaking it costs.</p>
</section>

<section id="the-contract">
  <h2>The contract</h2>

  <p><a href="#/m/t1-15-structs-and-records">Structs, Records, readonly, and init</a> established
  that a record generates value equality and a plain class does not. This module is about what the
  runtime <em>requires</em> of whatever equality you end up with.</p>

  <p class="define"><span class="define__term">Hash code</span> An <code>int</code> derived from an
  object's contents, used to decide roughly where it is stored. It is not an identifier and not a
  checksum — its only job is to sort values into groups quickly.</p>

  <p class="define"><span class="define__term">Bucket</span> One of those groups. A
  <code>Dictionary</code> uses the hash code to pick a bucket, then compares with
  <code>Equals</code> against only the keys in that bucket. That is the whole reason a dictionary
  lookup is fast: it compares against a handful of keys instead of all of them.</p>

  <p class="define"><span class="define__term">Hash code contract</span> Two rules:
  <strong>(1) if two objects are equal, their hash codes must be equal</strong>; (2) if two hash
  codes are equal, the objects may or may not be. Rule 1 is a correctness requirement. Rule 2 is
  what makes rule 1 sufficient — the dictionary still calls <code>Equals</code> to be sure.</p>

  <p>The analogy: a hash code is the first letter of a surname in a filing cabinet. You go to the
  <em>H</em> drawer and read only the H folders. <strong>The analogy's limit is what happens when
  the rule is broken.</strong> If two people with the same surname were filed under different
  letters, the cabinet would not report an error — it would never find one of them, and it
  would look exactly like a cabinet that never had the file. That silence is the whole difficulty
  of this module.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-the-contract.cs"><code>// The compiler warns about HalfDone: "CS0659: overrides Object.Equals(object o)
// but does not override Object.GetHashCode()". That warning is the point of
// this file, so it is suppressed here rather than fixed.
#:property NoWarn=CS0659

// 01-the-contract.cs — the hash code contract, and what breaking each half of
// it does to a Dictionary.
// .NET 10.0.400. Run: dotnet run 01-the-contract.cs

using System;
using System.Collections.Generic;

// ---- BROKEN: Equals overridden, GetHashCode not --------------------------
sealed class HalfDone
{
    public string Name { get; }
    public HalfDone(string name) =&gt; Name = name;

    public override bool Equals(object? obj) =&gt; obj is HalfDone o &amp;&amp; o.Name == Name;
    // No GetHashCode override. Inherits object's, which is per-instance.
    public override string ToString() =&gt; $"HalfDone({Name})";
}

// ---- BROKEN the other way: constant hash code ----------------------------
sealed class AlwaysSameHash
{
    public string Name { get; }
    public AlwaysSameHash(string name) =&gt; Name = name;
    public override bool Equals(object? obj) =&gt; obj is AlwaysSameHash o &amp;&amp; o.Name == Name;
    public override int GetHashCode() =&gt; 1;          // legal, and ruinous
}

// ---- CORRECT -------------------------------------------------------------
sealed class Correct
{
    public string Name { get; }
    public Correct(string name) =&gt; Name = name;
    public override bool Equals(object? obj) =&gt; obj is Correct o &amp;&amp; o.Name == Name;
    public override int GetHashCode() =&gt; Name.GetHashCode();
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- Equals says equal, hash codes differ ---");
        var a = new HalfDone("ada");
        var b = new HalfDone("ada");
        Console.WriteLine($"  a.Equals(b)                 : {a.Equals(b)}");
        Console.WriteLine($"  a.GetHashCode() == b's      : {a.GetHashCode() == b.GetHashCode()}");

        var dict = new Dictionary&lt;HalfDone, string&gt; { [a] = "stored under a" };
        Console.WriteLine($"  dict.ContainsKey(a)         : {dict.ContainsKey(a)}");
        Console.WriteLine($"  dict.ContainsKey(b)         : {dict.ContainsKey(b)}");
        Console.WriteLine("  b is equal to a and cannot find a's entry: the lookup goes to a");
        Console.WriteLine("  different bucket and never compares anything.");

        var set = new HashSet&lt;HalfDone&gt; { a, b };
        Console.WriteLine($"  HashSet of two 'equal' items: Count = {set.Count}");

        Console.WriteLine();
        Console.WriteLine("--- the correct version ---");
        var c1 = new Correct("ada");
        var c2 = new Correct("ada");
        var ok = new Dictionary&lt;Correct, string&gt; { [c1] = "stored" };
        Console.WriteLine($"  ContainsKey(c2)             : {ok.ContainsKey(c2)}");
        Console.WriteLine($"  HashSet count for two equal : {new HashSet&lt;Correct&gt; { c1, c2 }.Count}");

        Console.WriteLine();
        Console.WriteLine("--- a constant hash code is legal and turns O(1) into O(n) ---");
        var same = new Dictionary&lt;AlwaysSameHash, int&gt;();
        for (int i = 0; i &lt; 5; i++) same[new AlwaysSameHash($"k{i}")] = i;
        Console.WriteLine($"  entries stored              : {same.Count}");
        Console.WriteLine($"  lookup still correct        : {same.ContainsKey(new AlwaysSameHash("k3"))}");
        Console.WriteLine("  Correct, and every key lands in one bucket, so every lookup");
        Console.WriteLine("  compares against every key. The cost of this is measured in");
        Console.WriteLine("  03-hash-quality.cs.");

        Console.WriteLine();
        Console.WriteLine("The contract, in two lines:");
        Console.WriteLine("  1. If two objects are equal, their hash codes MUST be equal.");
        Console.WriteLine("  2. If two hash codes are equal, the objects MAY or may not be.");
        Console.WriteLine("Rule 1 is a correctness requirement. Rule 2 is why rule 1 is enough.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- Equals says equal, hash codes differ ---
  a.Equals(b)                 : True
  a.GetHashCode() == b's      : False
  dict.ContainsKey(a)         : True
  dict.ContainsKey(b)         : False
  b is equal to a and cannot find a's entry: the lookup goes to a
  different bucket and never compares anything.
  HashSet of two 'equal' items: Count = 2

--- the correct version ---
  ContainsKey(c2)             : True
  HashSet count for two equal : 1

--- a constant hash code is legal and turns O(1) into O(n) ---
  entries stored              : 5
  lookup still correct        : True
  Correct, and every key lands in one bucket, so every lookup
  compares against every key. The cost of this is measured in
  03-hash-quality.cs.

The contract, in two lines:
  1. If two objects are equal, their hash codes MUST be equal.
  2. If two hash codes are equal, the objects MAY or may not be.
Rule 1 is a correctness requirement. Rule 2 is why rule 1 is enough.</code></pre>

  <p><code>a.Equals(b)</code> is <code>True</code> and <code>dict.ContainsKey(b)</code> is
  <code>False</code>. The lookup hashed <code>b</code>, went to a bucket <code>a</code> is not in,
  found nothing there, and returned — <strong>without ever calling <code>Equals</code></strong>.
  The <code>HashSet</code> holding "two equal items" has a count of two for the same reason.</p>

  <div class="callout callout--gotcha">
    <p><strong>The compiler warns about exactly this.</strong> Overriding <code>Equals</code>
    without <code>GetHashCode</code> produces:</p>
    <pre data-lang="console" data-title="CS0659"><code>warning CS0659: 'HalfDone' overrides Object.Equals(object o) but does not
                override Object.GetHashCode()</code></pre>
    <p>It is a warning, so the build succeeds. This is the same shape as <code>CS0108</code> in
    <a href="#/m/t1-10-inheritance">Inheritance</a>: the one diagnostic that silently changes
    runtime behaviour is the one that does not stop the build. Promoting it to an error costs
    nothing.</p>
  </div>
</section>

<section id="mutable-keys">
  <h2>The key that changed after you filed it</h2>

  <p>The first incident. A dictionary decides which bucket an entry goes in <em>when you insert
  it</em>, using the hash code at that moment. Nothing re-checks it afterwards.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-mutable-keys.cs"><code>// 02-mutable-keys.cs — a dictionary decides which bucket an entry lives in
// when you insert it. Change the key afterwards and the entry is still there,
// in a bucket nothing will look in again.
// .NET 10.0.400. Run: dotnet run 02-mutable-keys.cs

using System;
using System.Collections.Generic;
using System.Linq;

sealed class MutableKey
{
    public string Region { get; set; }
    public MutableKey(string region) =&gt; Region = region;

    public override bool Equals(object? obj) =&gt; obj is MutableKey o &amp;&amp; o.Region == Region;
    public override int GetHashCode() =&gt; Region.GetHashCode();
    public override string ToString() =&gt; $"Key({Region})";
}

sealed record ImmutableKey(string Region);

class Program
{
    static void Main()
    {
        Console.WriteLine("--- a class key, mutated after insertion ---");
        var key = new MutableKey("eu-west-2");
        var map = new Dictionary&lt;MutableKey, string&gt; { [key] = "london" };

        Console.WriteLine($"  before: ContainsKey(key)        : {map.ContainsKey(key)}");
        Console.WriteLine($"  before: Count                   : {map.Count}");

        key.Region = "us-east-1";          // the object in the dictionary changed

        Console.WriteLine($"  after : ContainsKey(key)        : {map.ContainsKey(key)}");
        Console.WriteLine($"  after : ContainsKey(new equal)  : " +
                          $"{map.ContainsKey(new MutableKey("us-east-1"))}");
        Console.WriteLine($"  after : ContainsKey(old value)  : " +
                          $"{map.ContainsKey(new MutableKey("eu-west-2"))}");
        Console.WriteLine($"  after : Count                   : {map.Count}");
        Console.WriteLine($"  after : enumerating finds it    : " +
                          $"{map.Keys.First()} -&gt; {map.Values.First()}");

        Console.WriteLine();
        Console.WriteLine("  The entry is present, enumerable, and unreachable by lookup.");
        Console.WriteLine("  Remove() cannot find it either:");
        Console.WriteLine($"    map.Remove(key)               : {map.Remove(key)}");
        Console.WriteLine($"    Count after Remove            : {map.Count}");

        Console.WriteLine();
        Console.WriteLine("  Inserting the 'same' key again adds a SECOND entry:");
        map[new MutableKey("us-east-1")] = "virginia";
        Console.WriteLine($"    Count                         : {map.Count}");
        foreach (var kv in map) Console.WriteLine($"    {kv.Key} -&gt; {kv.Value}");

        Console.WriteLine();
        Console.WriteLine("--- the same shape with an immutable key ---");
        var safe = new Dictionary&lt;ImmutableKey, string&gt;
        {
            [new ImmutableKey("eu-west-2")] = "london"
        };
        Console.WriteLine($"  ContainsKey(equal key)          : " +
                          $"{safe.ContainsKey(new ImmutableKey("eu-west-2"))}");
        Console.WriteLine("  There is no setter, so the situation above cannot arise.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- a class key, mutated after insertion ---
  before: ContainsKey(key)        : True
  before: Count                   : 1
  after : ContainsKey(key)        : False
  after : ContainsKey(new equal)  : False
  after : ContainsKey(old value)  : False
  after : Count                   : 1
  after : enumerating finds it    : Key(us-east-1) -&gt; london

  The entry is present, enumerable, and unreachable by lookup.
  Remove() cannot find it either:
    map.Remove(key)               : False
    Count after Remove            : 1

  Inserting the 'same' key again adds a SECOND entry:
    Count                         : 2
    Key(us-east-1) -&gt; london
    Key(us-east-1) -&gt; virginia

--- the same shape with an immutable key ---
  ContainsKey(equal key)          : True
  There is no setter, so the situation above cannot arise.</code></pre>

  <p>Read the middle of that output carefully. After one property assignment:</p>

  <ul>
    <li>The entry cannot be found by the key object <em>that is stored in it</em>.</li>
    <li>It cannot be found by its old value or its new value.</li>
    <li><code>Count</code> still says 1 and enumeration still yields it.</li>
    <li><code>Remove</code> returns <code>false</code>, so it cannot be cleaned up.</li>
    <li>Inserting an equal key adds a <strong>second</strong> entry, and both print identically.</li>
  </ul>

  <p>The dictionary is not broken; it is doing exactly what it was told. The hash code it filed the
  entry under is no longer the hash code the key produces, so every lookup goes to the wrong
  bucket. The entry is a leak that <code>Count</code> insists is fine.</p>

  <p class="define"><span class="define__term">Immutable key</span> A key type whose contents
  cannot change after construction. The only reliable defence: if nothing can change, the hash
  code cannot go stale. A <code>readonly record struct</code> or a <code>sealed record</code> with
  no setters gives this for free.</p>

  <div class="callout callout--warn">
    <p><strong>The mutation does not have to be near the dictionary.</strong> In the example the
    two lines are adjacent. In a real system the object was put in a cache in one component and
    mutated by a completely different one that had no idea a dictionary was involved — which is
    also the argument from
    <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a> for not handing out
    references to things you depend on.</p>
  </div>
</section>

<section id="hash-quality">
  <h2>What a legal but poor hash code costs</h2>

  <p>The second incident. A hash code that satisfies the contract can still be terrible, and the
  failure is a performance cliff rather than a wrong answer.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-hash-quality.cs"><code>// 03-hash-quality.cs — a legal but poor GetHashCode is a correctness-preserving
// way to turn a hash table into a linked list.
// .NET 10.0.400, Release. Run: dotnet run 03-hash-quality.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;

readonly struct GoodKey : IEquatable&lt;GoodKey&gt;
{
    public readonly int A, B;
    public GoodKey(int a, int b) { A = a; B = b; }
    public bool Equals(GoodKey other) =&gt; A == other.A &amp;&amp; B == other.B;
    public override bool Equals(object? o) =&gt; o is GoodKey k &amp;&amp; Equals(k);
    public override int GetHashCode() =&gt; HashCode.Combine(A, B);
}

readonly struct ConstantKey : IEquatable&lt;ConstantKey&gt;
{
    public readonly int A, B;
    public ConstantKey(int a, int b) { A = a; B = b; }
    public bool Equals(ConstantKey other) =&gt; A == other.A &amp;&amp; B == other.B;
    public override bool Equals(object? o) =&gt; o is ConstantKey k &amp;&amp; Equals(k);
    public override int GetHashCode() =&gt; 1;                 // legal. Ruinous.
}

readonly struct XorKey : IEquatable&lt;XorKey&gt;
{
    public readonly int A, B;
    public XorKey(int a, int b) { A = a; B = b; }
    public bool Equals(XorKey other) =&gt; A == other.A &amp;&amp; B == other.B;
    public override bool Equals(object? o) =&gt; o is XorKey k &amp;&amp; Equals(k);
    // A common hand-rolled version. Fine here, but A^B collides for every
    // pair that swaps: (1,2) and (2,1) share a hash.
    public override int GetHashCode() =&gt; A ^ B;
}

class Program
{
    static void Run&lt;T&gt;(string label, Func&lt;int, int, T&gt; make, int n) where T : notnull
    {
        var dict = new Dictionary&lt;T, int&gt;(n);
        var sw = Stopwatch.StartNew();
        for (int i = 0; i &lt; n; i++) dict[make(i, i * 7)] = i;
        sw.Stop();
        double insertMs = sw.Elapsed.TotalMilliseconds;

        sw.Restart();
        int found = 0;
        for (int i = 0; i &lt; n; i++) if (dict.ContainsKey(make(i, i * 7))) found++;
        sw.Stop();

        Console.WriteLine($"  {label,-22} n={n,6:N0}  insert {insertMs,8:F1} ms   " +
                          $"lookup {sw.Elapsed.TotalMilliseconds,8:F1} ms   found {found:N0}");
    }

    static void Main()
    {
        // Warm up so the first measured row is not paying for JIT compilation.
        for (int w = 0; w &lt; 3; w++)
        {
            var warm = new Dictionary&lt;GoodKey, int&gt;();
            for (int i = 0; i &lt; 2000; i++) warm[new GoodKey(i, i * 7)] = i;
            var warm2 = new Dictionary&lt;XorKey, int&gt;();
            for (int i = 0; i &lt; 2000; i++) warm2[new XorKey(i, i * 7)] = i;
            var warm3 = new Dictionary&lt;ConstantKey, int&gt;();
            for (int i = 0; i &lt; 200; i++) warm3[new ConstantKey(i, i * 7)] = i;
        }

        Console.WriteLine("Same keys, same equality, different GetHashCode:");
        Console.WriteLine();
        foreach (int n in new[] { 1_000, 10_000, 40_000 })
        {
            Run("HashCode.Combine", (a, b) =&gt; new GoodKey(a, b), n);
            Run("A ^ B", (a, b) =&gt; new XorKey(a, b), n);
            Run("constant 1", (a, b) =&gt; new ConstantKey(a, b), n);
            Console.WriteLine();
        }

        Console.WriteLine("Collision behaviour of A ^ B for swapped pairs:");
        Console.WriteLine($"  new XorKey(1, 2).GetHashCode() : {new XorKey(1, 2).GetHashCode()}");
        Console.WriteLine($"  new XorKey(2, 1).GetHashCode() : {new XorKey(2, 1).GetHashCode()}");
        Console.WriteLine($"  are they equal?                : {new XorKey(1, 2).Equals(new XorKey(2, 1))}");
        Console.WriteLine("  Legal — rule 2 allows it — but every swapped pair shares a bucket.");
        Console.WriteLine($"  HashCode.Combine(1,2) vs (2,1)  : " +
                          $"{HashCode.Combine(1, 2)} vs {HashCode.Combine(2, 1)}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Same keys, same equality, different GetHashCode:

  HashCode.Combine       n= 1,000  insert      0.3 ms   lookup      1.8 ms   found 1,000
  A ^ B                  n= 1,000  insert      0.3 ms   lookup      1.5 ms   found 1,000
  constant 1             n= 1,000  insert     27.5 ms   lookup     25.5 ms   found 1,000

  HashCode.Combine       n=10,000  insert     18.4 ms   lookup      0.3 ms   found 10,000
  A ^ B                  n=10,000  insert     12.3 ms   lookup      0.2 ms   found 10,000
  constant 1             n=10,000  insert    199.9 ms   lookup    171.6 ms   found 10,000

  HashCode.Combine       n=40,000  insert      1.5 ms   lookup      1.0 ms   found 40,000
  A ^ B                  n=40,000  insert      1.4 ms   lookup      0.8 ms   found 40,000
  constant 1             n=40,000  insert   1984.3 ms   lookup   6075.3 ms   found 40,000

Collision behaviour of A ^ B for swapped pairs:
  new XorKey(1, 2).GetHashCode() : 3
  new XorKey(2, 1).GetHashCode() : 3
  are they equal?                : False
  Legal — rule 2 allows it — but every swapped pair shares a bucket.
  HashCode.Combine(1,2) vs (2,1)  : 1392660852 vs -560045483</code></pre>

  <p><strong>At 40,000 keys the constant hash code is about 1,300 times slower to insert and 6,000
  times slower to look up</strong> — 1,984 ms against 1.5 ms, and 6,075 ms against 1.0 ms. Every
  answer it gives is correct.</p>

  <p>The scaling is the diagnosis. Look at the constant-hash lookup column: 25.5 ms, 171.6 ms,
  6,075 ms for 1,000, 10,000 and 40,000 keys. Quadrupling the size multiplied the time by about 35,
  which is roughly 4² — <strong>quadratic</strong>. Every key is in one bucket, so every lookup
  compares against every key, and doing that <em>n</em> times is <em>n</em>² comparisons. That is
  the shape of the "3 ms to 4 seconds over a week" incident: entry count grew and the cost grew as
  its square.</p>

  <div class="callout callout--note">
    <p><strong>Reading the good rows honestly.</strong> The three good-hash rows are all between
    0.2 ms and 1.8 ms except one 18.4 ms outlier at n=10,000, which is a garbage collection or a
    tiering event rather than a property of the hash code. At this speed the measurement is
    dominated by noise, which is itself the finding: with a reasonable hash code, 40,000 insertions
    and 40,000 lookups are too fast to time reliably. The comparison that matters is against the
    constant-hash column, and that one is not subtle.</p>
  </div>

  <p class="define"><span class="define__term">Collision</span> Two unequal objects sharing a hash
  code. Permitted by rule 2, and unavoidable — there are more possible objects than
  <code>int</code> values. The goal is not zero collisions but an even spread.</p>

  <p><code>A ^ B</code> is fine for the keys tested here and has a specific weakness the output
  shows: <code>XorKey(1, 2)</code> and <code>XorKey(2, 1)</code> both hash to 3 while being
  unequal. Any pair of coordinates that swaps collides. Exercise 2 measures how bad that gets.</p>

  <p class="define"><span class="define__term">HashCode.Combine</span> The built-in way to combine
  several members into a hash code. It mixes the inputs so that order matters and small changes
  spread widely — the output shows it giving completely different values for
  <code>(1,2)</code> and <code>(2,1)</code>. Use it rather than hand-rolling arithmetic.</p>
</section>

<section id="struct-equality">
  <h2>The third incident: equality through reflection</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-struct-equality.cs"><code>// 04-struct-equality.cs — a struct that does not implement IEquatable&lt;T&gt; gets
// equality from ValueType, which falls back to reflection over its fields when
// it cannot compare the bytes directly.
// .NET 10.0.400, Release. Run: dotnet run 04-struct-equality.cs -c Release

#:property NoWarn=IL2075;IL3050

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

// No IEquatable. Contains a reference field, so byte comparison is impossible.
struct SlowPoint
{
    public int X, Y;
    public string Label;
    public SlowPoint(int x, int y, string label) { X = x; Y = y; Label = label; }
}

// Same data, with IEquatable&lt;T&gt; implemented.
struct FastPoint : IEquatable&lt;FastPoint&gt;
{
    public int X, Y;
    public string Label;
    public FastPoint(int x, int y, string label) { X = x; Y = y; Label = label; }

    public bool Equals(FastPoint other) =&gt; X == other.X &amp;&amp; Y == other.Y &amp;&amp; Label == other.Label;
    public override bool Equals(object? o) =&gt; o is FastPoint p &amp;&amp; Equals(p);
    public override int GetHashCode() =&gt; HashCode.Combine(X, Y, Label);
}

// The compiler writes both for a record struct.
readonly record struct RecordPoint(int X, int Y, string Label);

class Program
{
    const int N = 2_000_000;

    static void Time&lt;T&gt;(string label, T a, T b)
    {
        var cmp = EqualityComparer&lt;T&gt;.Default;
        for (int i = 0; i &lt; 10_000; i++) cmp.Equals(a, b);

        double best = double.MaxValue;
        for (int r = 0; r &lt; 5; r++)
        {
            var sw = Stopwatch.StartNew();
            int n = 0;
            for (int i = 0; i &lt; N; i++) if (cmp.Equals(a, b)) n++;
            sw.Stop();
            if (n != N) throw new Exception("not equal");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-34} {best,7:F1} ms   {best * 1e6 / N,6:F1} ns/compare");
    }

    static void Main()
    {
        Console.WriteLine($"{N:N0} comparisons, best of 5");
        Console.WriteLine();

        Time("struct, no IEquatable", new SlowPoint(1, 2, "a"), new SlowPoint(1, 2, "a"));
        Time("struct with IEquatable&lt;T&gt;", new FastPoint(1, 2, "a"), new FastPoint(1, 2, "a"));
        Time("readonly record struct", new RecordPoint(1, 2, "a"), new RecordPoint(1, 2, "a"));

        Console.WriteLine();
        Console.WriteLine("Which Equals each one actually uses:");
        foreach (var t in new[] { typeof(SlowPoint), typeof(FastPoint), typeof(RecordPoint) })
        {
            bool implementsIt = t.GetInterfaces().Any(i =&gt; i.IsGenericType &amp;&amp;
                i.GetGenericTypeDefinition() == typeof(IEquatable&lt;&gt;));
            Console.WriteLine($"  {t.Name,-16} IEquatable&lt;T&gt;: {implementsIt,-6} " +
                              $"comparer: {GetComparerName(t)}");
        }

        Console.WriteLine();
        Console.WriteLine("Boxing: calling the object-based Equals allocates for a struct.");
        long before = GC.GetTotalAllocatedBytes(precise: true);
        var s1 = new SlowPoint(1, 2, "a");
        object boxed = s1;
        for (int i = 0; i &lt; 1000; i++) _ = s1.Equals(boxed);
        long after = GC.GetTotalAllocatedBytes(precise: true);
        Console.WriteLine($"  1000 calls to Equals(object) allocated {after - before:N0} bytes");
    }

    static string GetComparerName(Type t)
    {
        var comparerType = typeof(EqualityComparer&lt;&gt;).MakeGenericType(t);
        var prop = comparerType.GetProperty("Default")!;
        return prop.GetValue(null)!.GetType().Name;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>2,000,000 comparisons, best of 5

  struct, no IEquatable                267.8 ms    133.9 ns/compare
  struct with IEquatable&lt;T&gt;              3.2 ms      1.6 ns/compare
  readonly record struct                 3.6 ms      1.8 ns/compare

Which Equals each one actually uses:
  SlowPoint        IEquatable&lt;T&gt;: False  comparer: ObjectEqualityComparer&#96;1
  FastPoint        IEquatable&lt;T&gt;: True   comparer: GenericEqualityComparer&#96;1
  RecordPoint      IEquatable&lt;T&gt;: True   comparer: GenericEqualityComparer&#96;1

Boxing: calling the object-based Equals allocates for a struct.
  1000 calls to Equals(object) allocated 176,032 bytes</code></pre>

  <p><strong>134 nanoseconds against 1.6 — about 84 times slower</strong>, for the same three
  fields and the same logical comparison. A second sample gave 162 against 1.7, so the range is
  roughly 80–95×.</p>

  <p class="define"><span class="define__term">IEquatable&lt;T&gt;</span> An interface with one
  member, <code>bool Equals(T other)</code>, taking the type itself rather than
  <code>object</code>. Implementing it lets generic code compare without boxing and without
  reflection.</p>

  <p>The mechanism is in the third block. <code>EqualityComparer&lt;T&gt;.Default</code> inspects
  the type once and picks an implementation:</p>

  <ul>
    <li><code>GenericEqualityComparer</code> when the type implements
    <code>IEquatable&lt;T&gt;</code> — a direct call to your <code>Equals(T)</code>.</li>
    <li><code>ObjectEqualityComparer</code> otherwise — which for a struct calls
    <code>ValueType.Equals(object)</code>, boxing the argument and then walking the fields
    <em>by reflection</em> when it cannot compare the raw bytes. It cannot here, because the struct
    contains a <code>string</code> reference.</li>
  </ul>

  <p>The last block puts a number on the boxing: 1,000 calls to the <code>object</code>-taking
  <code>Equals</code> allocated 176,032 bytes — 176 bytes per call, for a comparison that should
  allocate nothing.</p>

  <p class="define"><span class="define__term">EqualityComparer&lt;T&gt;.Default</span> The
  comparer every generic collection uses when you do not supply one. Knowing it chooses by
  inspecting the type is what makes the fix obvious: implement
  <code>IEquatable&lt;T&gt;</code>, and everything downstream gets faster without changing.</p>

  <p>Note the third row: a <code>readonly record struct</code> matched the hand-written version at
  1.8 ns, because the compiler generates <code>IEquatable&lt;T&gt;</code> for you. <strong>For most
  value types, declaring it a record is the whole fix.</strong></p>
</section>

<section id="comparers">
  <h2>== is not Equals, and comparers are the third option</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-comparers.cs"><code>// 05-comparers.cs — == is not Equals, and when neither is the equality you
// want, you supply a comparer instead of changing the type.
// .NET 10.0.400. Run: dotnet run 05-comparers.cs

using System;
using System.Collections.Generic;
using System.Linq;

sealed class Box { public int V; public Box(int v) =&gt; V = v; }

sealed record Tag(string Name);

sealed class IgnoreCase : IEqualityComparer&lt;string&gt;
{
    public bool Equals(string? a, string? b) =&gt;
        string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    public int GetHashCode(string s) =&gt; s.ToLowerInvariant().GetHashCode();
}

// An INCONSISTENT comparer: it does not define a total order.
sealed class BrokenComparer : IComparer&lt;int&gt;
{
    public int Compare(int a, int b) =&gt; (a % 3).CompareTo(b % 3) == 0 ? 1 : (a % 3).CompareTo(b % 3);
}

sealed class ByLength : IComparer&lt;string&gt;
{
    public int Compare(string? a, string? b) =&gt;
        (a?.Length ?? 0).CompareTo(b?.Length ?? 0) is var byLen &amp;&amp; byLen != 0
            ? byLen
            : string.CompareOrdinal(a, b);
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- == and Equals do not always agree ---");
        object s1 = new string("hello".ToCharArray());
        object s2 = new string("hello".ToCharArray());
        Console.WriteLine($"  two separately built strings, as object:");
        Console.WriteLine($"    s1 == s2                 : {s1 == s2}    (reference comparison)");
        Console.WriteLine($"    s1.Equals(s2)            : {s1.Equals(s2)}     (string's Equals)");
        Console.WriteLine($"    ReferenceEquals(s1, s2)  : {ReferenceEquals(s1, s2)}");

        string t1 = (string)s1, t2 = (string)s2;
        Console.WriteLine($"  the same two, typed as string:");
        Console.WriteLine($"    t1 == t2                 : {t1 == t2}     (string's == operator)");

        Console.WriteLine();
        Console.WriteLine("  == on a class with no operator is reference comparison:");
        var b1 = new Box(5);
        var b2 = new Box(5);
        Console.WriteLine($"    b1 == b2                 : {b1 == b2}");
        Console.WriteLine($"    b1.Equals(b2)            : {b1.Equals(b2)}");

        Console.WriteLine("  == on a record IS value comparison, because one is generated:");
        Console.WriteLine($"    new Tag(\"x\") == new Tag(\"x\") : {new Tag("x") == new Tag("x")}");

        Console.WriteLine();
        Console.WriteLine("--- a comparer changes equality without changing the type ---");
        var plain = new Dictionary&lt;string, int&gt; { ["Region"] = 1 };
        Console.WriteLine($"  default dictionary, lookup \"region\" : {plain.ContainsKey("region")}");

        var insensitive = new Dictionary&lt;string, int&gt;(new IgnoreCase()) { ["Region"] = 1 };
        Console.WriteLine($"  IgnoreCase comparer, lookup \"region\": {insensitive.ContainsKey("region")}");

        var builtIn = new Dictionary&lt;string, int&gt;(StringComparer.OrdinalIgnoreCase) { ["Region"] = 1 };
        Console.WriteLine($"  StringComparer.OrdinalIgnoreCase   : {builtIn.ContainsKey("region")}");
        Console.WriteLine("  The built-in one is the right choice: it hashes without allocating");
        Console.WriteLine("  a lowercase copy of every key, which the hand-written one does.");

        Console.WriteLine();
        Console.WriteLine("--- IComparer defines ORDER, not equality ---");
        var words = new[] { "pear", "fig", "banana", "kiwi", "date" };
        var byLength = words.OrderBy(w =&gt; w, new ByLength()).ToArray();
        Console.WriteLine($"  sorted by length then ordinal: {string.Join(", ", byLength)}");

        Console.WriteLine();
        Console.WriteLine("--- an inconsistent comparer is detected, sometimes ---");
        var numbers = Enumerable.Range(0, 40).ToArray();
        try
        {
            Array.Sort(numbers, new BrokenComparer());
            Console.WriteLine($"  sort completed: {string.Join(",", numbers.Take(12))} ...");
            Console.WriteLine("  No exception this run — an invalid comparer is not always caught.");
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine($"  inner: {ex.InnerException?.GetType().Name}: {ex.InnerException?.Message}");
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- == and Equals do not always agree ---
  two separately built strings, as object:
    s1 == s2                 : False    (reference comparison)
    s1.Equals(s2)            : True     (string's Equals)
    ReferenceEquals(s1, s2)  : False
  the same two, typed as string:
    t1 == t2                 : True     (string's == operator)

  == on a class with no operator is reference comparison:
    b1 == b2                 : False
    b1.Equals(b2)            : False
  == on a record IS value comparison, because one is generated:
    new Tag("x") == new Tag("x") : True

--- a comparer changes equality without changing the type ---
  default dictionary, lookup "region" : False
  IgnoreCase comparer, lookup "region": True
  StringComparer.OrdinalIgnoreCase   : True
  The built-in one is the right choice: it hashes without allocating
  a lowercase copy of every key, which the hand-written one does.

--- IComparer defines ORDER, not equality ---
  sorted by length then ordinal: fig, date, kiwi, pear, banana

--- an inconsistent comparer is detected, sometimes ---
  sort completed: 39,36,33,30,27,24,21,18,15,12,0,9 ...
  No exception this run — an invalid comparer is not always caught.</code></pre>

  <p><strong>The first block is the one to memorise.</strong> The same two strings compared
  <code>False</code> through <code>object</code> variables and <code>True</code> through
  <code>string</code> variables. <code>==</code> is resolved at compile time from the
  <em>static</em> type — the same rule as overload resolution in
  <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a>. Declared as
  <code>object</code>, there is no <code>string</code> operator in scope, so it compares
  references. <code>Equals</code> is virtual and reaches <code>string</code>'s override either
  way.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Expression</th><th>Decided by</th><th>What it does</th></tr></thead>
    <tbody>
      <tr><td><code>a == b</code></td><td>compile-time type</td>
          <td>An operator if one is in scope; otherwise reference comparison.</td></tr>
      <tr><td><code>a.Equals(b)</code></td><td>runtime type</td>
          <td>The most-derived <code>Equals</code> override.</td></tr>
      <tr><td><code>ReferenceEquals(a, b)</code></td><td>neither</td>
          <td>Always "are these the same object".</td></tr>
      <tr><td><code>EqualityComparer&lt;T&gt;.Default.Equals(a, b)</code></td><td>the type, once</td>
          <td><code>IEquatable&lt;T&gt;</code> if present, else <code>object.Equals</code>. What
          collections use.</td></tr>
    </tbody>
  </table>
  </div>

  <p class="define"><span class="define__term">IEqualityComparer&lt;T&gt;</span> An object holding
  an <code>Equals</code> and a <code>GetHashCode</code> for some type, passed to a collection so
  that <em>this</em> collection uses different equality. The way to get case-insensitive keys
  without making <code>string</code> case-insensitive everywhere.</p>

  <p>Prefer the built-in <code>StringComparer</code> members. The hand-written
  <code>IgnoreCase</code> above works and allocates a lowercase copy of every key on every hash —
  which is a per-lookup allocation on a hot path.</p>

  <p class="define"><span class="define__term">IComparer&lt;T&gt;</span> Defines <em>order</em>
  rather than equality: <code>Compare</code> returns negative, zero or positive. Used by sorting
  and by <code>SortedDictionary</code>. It answers a different question from
  <code>IEqualityComparer</code>, and a type can need both.</p>

  <p class="define"><span class="define__term">Total order</span> What a comparer must define for
  sorting to work: if <em>a</em> &lt; <em>b</em> and <em>b</em> &lt; <em>c</em> then <em>a</em>
  &lt; <em>c</em>, and exactly one of &lt;, =, &gt; holds for every pair. The
  <code>BrokenComparer</code> above never returns 0 for equal values, which breaks it.</p>

  <div class="callout callout--warn">
    <p><strong>An invalid comparer is not reliably detected.</strong> <code>Array.Sort</code> can
    throw <code>InvalidOperationException</code> with "IComparer.Compare() method returns
    inconsistent results", and in this run it did not — it returned an array that is not
    sorted, with no error. A comparer that is not a total order is a silent wrong-answer bug, and
    the usual cause is a <code>Compare</code> that forgets to return 0, or one written as
    <code>a.Value - b.Value</code> which overflows for large values.</p>
  </div>
</section>

<section id="production-example">
  <h2>A key type built to the contract</h2>

  <pre data-lang="csharp" data-net="10" data-title="06-production.cs"><code>// 06-production.cs — a key type built to the contract, and the test that
// proves it. .NET 10.0.400. Run: dotnet run 06-production.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

// A cache key. Every decision here is one rule from this module.
public readonly record struct QuoteKey : IEquatable&lt;QuoteKey&gt;
{
    public string Product { get; }
    public string Currency { get; }
    public int Quantity { get; }
    private readonly string _options;      // pre-joined: value-comparable

    public QuoteKey(string product, string currency, int quantity, IEnumerable&lt;string&gt; options)
    {
        Product = product ?? throw new ArgumentNullException(nameof(product));
        Currency = currency ?? throw new ArgumentNullException(nameof(currency));
        Quantity = quantity;
        // Sorted so that option order does not change the key.
        _options = string.Join('|', options.OrderBy(o =&gt; o, StringComparer.Ordinal));
    }

    public IReadOnlyList&lt;string&gt; Options =&gt;
        _options.Length == 0 ? Array.Empty&lt;string&gt;() : _options.Split('|');

    public bool Equals(QuoteKey other) =&gt;
        Quantity == other.Quantity
        &amp;&amp; string.Equals(Product, other.Product, StringComparison.Ordinal)
        &amp;&amp; string.Equals(Currency, other.Currency, StringComparison.OrdinalIgnoreCase)
        &amp;&amp; string.Equals(_options, other._options, StringComparison.Ordinal);

    // Must agree with Equals: Currency is compared case-insensitively, so it
    // must be HASHED case-insensitively too.
    public override int GetHashCode() =&gt; HashCode.Combine(
        Product.GetHashCode(StringComparison.Ordinal),
        Currency.GetHashCode(StringComparison.OrdinalIgnoreCase),
        Quantity,
        _options.GetHashCode(StringComparison.Ordinal));

    public override string ToString() =&gt;
        $"{Product}/{Currency}/{Quantity}[{_options}]";
}

public sealed class QuoteCache
{
    private readonly Dictionary&lt;QuoteKey, decimal&gt; _entries = new();
    private readonly Func&lt;QuoteKey, decimal&gt; _compute;
    public int Computations { get; private set; }
    public int Hits { get; private set; }

    public QuoteCache(Func&lt;QuoteKey, decimal&gt; compute) =&gt; _compute = compute;

    public decimal Get(QuoteKey key)
    {
        if (_entries.TryGetValue(key, out var cached)) { Hits++; return cached; }
        Computations++;
        var value = _compute(key);
        _entries[key] = value;
        return value;
    }

    public int Count =&gt; _entries.Count;
}

class Program
{
    static void Main()
    {
        var cache = new QuoteCache(k =&gt; k.Quantity * 9.99m);

        var k1 = new QuoteKey("WIDGET", "GBP", 3, new[] { "express", "gift" });
        var k2 = new QuoteKey("WIDGET", "GBP", 3, new[] { "gift", "express" });   // reordered
        var k3 = new QuoteKey("WIDGET", "gbp", 3, new[] { "express", "gift" });   // lower case
        var k4 = new QuoteKey("WIDGET", "USD", 3, new[] { "express", "gift" });

        Console.WriteLine("--- the equality test every key type should have ---");
        Console.WriteLine($"  k1 == k2 (options reordered)  : {k1 == k2}");
        Console.WriteLine($"  hash codes match              : {k1.GetHashCode() == k2.GetHashCode()}");
        Console.WriteLine($"  k1 == k3 (currency case)      : {k1 == k3}");
        Console.WriteLine($"  hash codes match              : {k1.GetHashCode() == k3.GetHashCode()}");
        Console.WriteLine($"  k1 == k4 (different currency) : {k1 == k4}");

        Console.WriteLine();
        Console.WriteLine("--- the cache actually caches ---");
        foreach (var k in new[] { k1, k2, k3, k1, k4 })
            Console.WriteLine($"  Get({k}) = {cache.Get(k)}");
        Console.WriteLine($"  computations {cache.Computations}, hits {cache.Hits}, " +
                          $"entries {cache.Count}");

        Console.WriteLine();
        Console.WriteLine("--- hash distribution over 50,000 realistic keys ---");
        var buckets = new Dictionary&lt;int, int&gt;();
        var distinct = new HashSet&lt;QuoteKey&gt;();
        var products = new[] { "WIDGET", "GIZMO", "BOLT", "NUT", "WASHER" };
        var currencies = new[] { "GBP", "USD", "EUR" };
        for (int i = 0; i &lt; 50_000; i++)
        {
            var key = new QuoteKey(products[i % 5], currencies[i % 3], i % 100,
                                   new[] { $"opt{i % 7}" });
            distinct.Add(key);
            int bucket = key.GetHashCode() &amp; 1023;
            buckets[bucket] = buckets.GetValueOrDefault(bucket) + 1;
        }
        Console.WriteLine($"  distinct keys generated : {distinct.Count:N0}");
        Console.WriteLine($"  buckets used (of 1024)  : {buckets.Count}");
        Console.WriteLine($"  largest bucket          : {buckets.Values.Max()}");
        Console.WriteLine($"  mean per used bucket    : {buckets.Values.Average():F1}");
        Console.WriteLine("  Even spread means lookups stay O(1). One huge bucket would be the");
        Console.WriteLine("  signature of a poor GetHashCode.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- the equality test every key type should have ---
  k1 == k2 (options reordered)  : True
  hash codes match              : True
  k1 == k3 (currency case)      : True
  hash codes match              : True
  k1 == k4 (different currency) : False

--- the cache actually caches ---
  Get(WIDGET/GBP/3[express|gift]) = 29.97
  Get(WIDGET/GBP/3[express|gift]) = 29.97
  Get(WIDGET/gbp/3[express|gift]) = 29.97
  Get(WIDGET/GBP/3[express|gift]) = 29.97
  Get(WIDGET/USD/3[express|gift]) = 29.97
  computations 2, hits 3, entries 2

--- hash distribution over 50,000 realistic keys ---
  distinct keys generated : 2,100
  buckets used (of 1024)  : 892
  largest bucket          : 191
  mean per used bucket    : 56.1
  Even spread means lookups stay O(1). One huge bucket would be the
  signature of a poor GetHashCode.</code></pre>

  <p>Six decisions, each one a rule from this module.</p>

  <p><strong>It is a <code>readonly record struct</code>.</strong> Immutable, so the stale-hash
  failure cannot occur, and a value type so keys are not allocated.</p>

  <p><strong>The options are joined into a string at construction.</strong> This is the fix from
  <a href="#/m/t1-15-structs-and-records">Structs, Records, readonly, and init</a>: a collection
  member would compare by reference. Sorting them first means option order does not change the key
  — <code>k1 == k2</code> confirms it.</p>

  <p><strong><code>Equals</code> and <code>GetHashCode</code> agree, member for member.</strong>
  <code>Currency</code> is compared with <code>OrdinalIgnoreCase</code>, so it is <em>hashed</em>
  with <code>OrdinalIgnoreCase</code>. Getting this pair out of step is the most common way to
  break rule 1 in code that otherwise looks careful — the comparison would say equal and the hash
  would disagree.</p>

  <p><strong>It implements <code>IEquatable&lt;QuoteKey&gt;</code>.</strong> Measured above at
  80–95× faster than the reflection fallback.</p>

  <p><strong>The distribution is checked.</strong> 2,100 distinct keys spread across 892 of 1,024
  buckets with a largest bucket of 191. A broken hash code shows up here immediately as one bucket
  holding everything.</p>

  <p><strong>The equality test is in the code.</strong> Three assertions — reordered options, a
  case difference, and a genuine difference — plus matching hash codes. That is the test named in
  the previous module, written out.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Overriding one and not the other</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: Equals without GetHashCode"><code>// WRONG. Compiles with warning CS0659. Every dictionary and HashSet using
// this type will fail to find keys that are equal to ones it holds.
sealed class RegionKey
{
    public string Region { get; }
    public RegionKey(string region) =&gt; Region = region;

    public override bool Equals(object? obj) =&gt; obj is RegionKey o &amp;&amp; o.Region == Region;
}</code></pre>

  <p>Note that a <code>List&lt;T&gt;</code> holding this type works perfectly —
  <code>List.Contains</code> compares linearly with <code>Equals</code> and never hashes. So the
  type passes every test written against a list and fails against a dictionary, which is exactly
  how it reaches production.</p>

  <h3>2. Mutating a key while it is in a collection</h3>

  <p>Demonstrated above: the entry becomes unreachable, un-removable, and duplicable. It also
  applies to <code>HashSet</code>, and to any cache keyed on an object. The defence is an immutable
  key type, not discipline.</p>

  <h3>3. A hash code that discards information</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: hashing only part of the key"><code>// WRONG. Equals uses three members and GetHashCode uses one, so every order
// for the same customer lands in one bucket. Legal, and quadratic.
public override bool Equals(object? o) =&gt;
    o is OrderKey k &amp;&amp; k.CustomerId == CustomerId &amp;&amp; k.Date == Date &amp;&amp; k.Total == Total;

public override int GetHashCode() =&gt; CustomerId.GetHashCode();</code></pre>

  <p>This satisfies rule 1 — equal objects do produce equal hash codes — and is the most common
  real-world version of the constant-hash measurement. Include every member that
  <code>Equals</code> uses.</p>

  <h3>4. Hashing on something <code>Equals</code> does not use</h3>

  <p>The reverse, and it breaks rule 1 outright: two objects that <code>Equals</code> calls equal
  produce different hash codes because the hash included a member the comparison ignored. Case
  sensitivity is the usual culprit — comparing case-insensitively while hashing case-sensitively.
  <strong>Whenever <code>Equals</code> normalises something, <code>GetHashCode</code> must
  normalise it identically.</strong></p>

  <h3>5. A struct without <code>IEquatable&lt;T&gt;</code></h3>

  <p>Measured at 80–95× slower, through reflection, allocating 176 bytes per comparison in the
  boxing case. It is invisible in review because the type looks fine and the call site is
  <code>==</code> or a dictionary lookup. Declaring it a <code>record struct</code> fixes it.</p>

  <h3>6. A comparer that is not a total order</h3>

  <p><code>Array.Sort</code> may throw <code>InvalidOperationException</code>, and may instead
  return an unsorted array with no error at all — this module's run did the second. The classic
  cause is subtraction: <code>a.Value - b.Value</code> overflows and flips sign for large values,
  producing a comparer that is correct for small inputs and wrong for large ones. Use
  <code>CompareTo</code>.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>A dictionary or cache never finds anything.</strong> Test the key type on its own,
    away from the collection. Construct two keys from identical inputs and print
    <code>k1.Equals(k2)</code> and <code>k1.GetHashCode() == k2.GetHashCode()</code>. Equal with
    different hashes is rule 1 broken — find the member <code>Equals</code> uses that
    <code>GetHashCode</code> omits, or the normalisation applied in one and not the other. Not
    equal at all is a different bug, usually a collection member as in
    <a href="#/m/t1-15-structs-and-records">Structs, Records, readonly, and init</a>.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>An entry is in the dictionary and cannot be found.</strong> Confirm it with
    <code>Count</code> and enumeration, then compare the key's <em>current</em> hash code with what
    it must have been at insertion. If the key type has any settable property, that is the answer.
    A one-line diagnostic that catches it in production: iterate the dictionary and check
    <code>dict.ContainsKey(kvp.Key)</code> for every entry — any <code>false</code> is an entry
    whose key has been mutated since insertion.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Lookups got slower as the collection grew.</strong> Measure the shape rather than
    the absolute time: run the same operation at 1,000, 10,000 and 40,000 entries. Linear growth in
    per-lookup cost means a hash distribution problem. Confirm by grouping the keys' hash codes —
    <code>keys.GroupBy(k =&gt; k.GetHashCode()).Max(g =&gt; g.Count())</code> should be a small
    number; if it is a large fraction of the total, the hash code is discarding information.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Comparisons are unexpectedly slow and the profiler blames
    <code>ValueType.Equals</code> or <code>RuntimeHelpers</code>.</strong> That is the reflection
    fallback. Check whether the type implements <code>IEquatable&lt;T&gt;</code>:
    <code>typeof(T).GetInterfaces()</code>, or print
    <code>EqualityComparer&lt;T&gt;.Default.GetType().Name</code> —
    <code>ObjectEqualityComparer</code> is the slow path,
    <code>GenericEqualityComparer</code> is the fast one.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A sort produces wrong output or throws intermittently.</strong> The comparer is not
    a total order. Check three things: does <code>Compare</code> ever return 0 for values it
    considers equal; is it consistent with itself when arguments are swapped; and is it implemented
    with subtraction, which overflows. Test it directly over every pair in a small sample and
    assert antisymmetry and transitivity — cheaper than debugging a sort.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>A concrete case.</strong> A rate-limiting service kept per-client counters in a
    <code>Dictionary&lt;ClientKey, Counter&gt;</code>, where <code>ClientKey</code> combined an API
    key, an endpoint, and a time window. It was written as a class with <code>Equals</code>
    comparing all three and <code>GetHashCode</code> returning
    <code>ApiKey.GetHashCode()</code> — every member used for equality, one member used for
    hashing. Rule 1 was satisfied, so nothing was ever wrong.</p>
    <p>With a few hundred clients it was invisible. As the service grew to about 9,000 active API
    keys across 12 endpoints and a rolling 60-window, the dictionary held roughly 200,000 entries
    across about 9,000 buckets — every entry for one client in a single bucket, around 22 entries
    each, each lookup comparing about 22 keys instead of one or two.</p>
    <p>The visible symptom was p99 latency on every endpoint rising from 8 ms to 240 ms over about
    six weeks, with CPU climbing steadily. Because the growth tracked customer growth exactly, it
    was read as a capacity problem, and the service was scaled from 6 instances to 20 — which
    helped, because it split the dictionary across more processes and shrank each one. That
    reinforced the wrong diagnosis.</p>
    <p>What found it was a CPU profile showing 60% of time inside
    <code>ClientKey.Equals</code>, which makes no sense for a dictionary lookup unless the buckets
    are deep. The fix was
    <code>HashCode.Combine(ApiKey, Endpoint, Window)</code> — one line. p99 returned to 9 ms and
    the fleet went back to 6 instances.</p>
    <p>The cost of the one-line defect: about six weeks of degradation, 14 unnecessary instances,
    and an incorrect capacity model that had been used to plan the next quarter.</p>
  </div>

  <p>The general principle: <strong>the hash code contract is a correctness rule with a performance
  failure mode, and both halves are silent.</strong> Break rule 1 and lookups miss — no exception,
  only a cache that never hits or an entry that cannot be found. Satisfy rule 1 with a poor hash
  and everything is correct while the cost per lookup grows with the collection, which looks
  exactly like organic growth.</p>

  <p>That is why the habit matters more than the theory. Any type used as a key gets: immutability,
  <code>IEquatable&lt;T&gt;</code>, <code>HashCode.Combine</code> over exactly the members
  <code>Equals</code> uses, and a test asserting that two instances built from identical inputs are
  equal and hash equally. Four lines of discipline against a failure that is invisible until it is
  a capacity plan.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"A hash code identifies an object."</strong> It groups objects. Two unequal objects
    sharing a hash code is normal and permitted — there are more possible values than there are
    <code>int</code>s. A hash code is never an identifier, never a checksum, and must never be
    persisted or sent between processes:
    <a href="#/m/t1-07-strings-and-interning">Strings, Immutability, and Interning</a> showed
    <code>string.GetHashCode()</code> differs between runs of the same program by design.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"My type works fine — the tests pass."</strong> Check whether the tests use a
    <code>List</code>. <code>List.Contains</code> compares linearly with <code>Equals</code> and
    never hashes, so a type with a broken <code>GetHashCode</code> passes every list-based test and
    fails against a dictionary. Verified above: the same pair gave
    <code>List.Contains → True</code> and <code>Dictionary.ContainsKey → False</code>.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>==</code> and <code>Equals</code> do the same thing."</strong> Measured: two
    identical strings held in <code>object</code> variables compared <code>False</code> with
    <code>==</code> and <code>True</code> with <code>Equals</code>. <code>==</code> is chosen at
    compile time from the static type; <code>Equals</code> is virtual. For a class with no operator,
    <code>==</code> is reference comparison whatever <code>Equals</code> says.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"A simple hash code is fine, it only needs to be legal."</strong> Legal and
    catastrophic are compatible: a constant hash code measured 1,300× slower to insert and 6,000×
    slower to look up at 40,000 keys, with every answer correct. Legality is rule 1; usefulness is
    an even spread.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Structs get value equality for free, so they are fine as keys."</strong> They get
    <em>correct</em> equality for free and, without <code>IEquatable&lt;T&gt;</code>, it runs
    through reflection at 80–95× the cost and allocates when boxed. Declare the type a
    <code>readonly record struct</code> and the compiler writes the fast version.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"If the comparer is wrong, sorting will throw."</strong> It may. This module's run
    produced an unsorted array with no exception at all. An inconsistent comparer is a silent
    wrong-answer bug, and the common cause — implementing <code>Compare</code> as subtraction —
    is correct for small values and wrong once they overflow.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Reach for</th><th>Because</th></tr></thead>
    <tbody>
      <tr>
        <td>Any type used as a dictionary or set key</td>
        <td><code>readonly record struct</code> or <code>sealed record</code></td>
        <td>Immutable, value-equal, and <code>IEquatable&lt;T&gt;</code> generated. Three rules
        satisfied by one keyword.</td>
      </tr>
      <tr>
        <td>Writing <code>GetHashCode</code> by hand</td>
        <td><code>HashCode.Combine(...)</code> over exactly the members <code>Equals</code> uses</td>
        <td>Mixes properly and makes order matter. Hand-rolled <code>^</code> collides for swapped
        pairs.</td>
      </tr>
      <tr>
        <td><code>Equals</code> normalises something (case, trimming, ordering)</td>
        <td>Normalise identically in <code>GetHashCode</code></td>
        <td>Otherwise equal objects hash differently — rule 1 broken, lookups miss.</td>
      </tr>
      <tr>
        <td>A struct compared often or used as a key</td>
        <td>Implement <code>IEquatable&lt;T&gt;</code>, or make it a record struct</td>
        <td>80–95× faster than the reflection fallback, and no boxing.</td>
      </tr>
      <tr>
        <td>You need different equality for one collection only</td>
        <td><code>IEqualityComparer&lt;T&gt;</code> passed to the constructor</td>
        <td>Changes this collection without changing the type for everyone.</td>
      </tr>
      <tr>
        <td>Case-insensitive string keys</td>
        <td><code>StringComparer.OrdinalIgnoreCase</code></td>
        <td>Built in, and hashes without allocating a lowercase copy per lookup.</td>
      </tr>
      <tr>
        <td>You need order rather than equality</td>
        <td><code>IComparer&lt;T&gt;</code>, implemented with <code>CompareTo</code></td>
        <td>Subtraction overflows and produces a comparer that fails only on large values.</td>
      </tr>
      <tr>
        <td>The key has a natural single-value form</td>
        <td>Use that value as the key</td>
        <td>A joined string or an id is value-comparable already and needs none of the above.</td>
      </tr>
      <tr>
        <td>An entity with identity rather than contents</td>
        <td>Do not override equality; key on the id</td>
        <td>Two customers with the same name are not the same customer.</td>
      </tr>
      <tr>
        <td>Any of the above</td>
        <td>A test: two instances from identical inputs are equal and hash equally</td>
        <td>Three lines, catches the entire category, keeps catching it when a member is added
        later.</td>
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
    <p>Give all five outputs. Then explain why one of them is <code>True</code> while the
    conceptually identical question two lines above it is <code>False</code>, and say what that
    means for testing.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>sealed class Exercise1Key
{
    public string Region { get; }
    public Exercise1Key(string region) =&gt; Region = region;
    public override bool Equals(object? o) =&gt; o is Exercise1Key k &amp;&amp; k.Region == Region;
    // GetHashCode deliberately absent.
}

var a = new Exercise1Key("eu-west-2");
var b = new Exercise1Key("eu-west-2");
var d = new Dictionary&lt;Exercise1Key, string&gt; { [a] = "london" };

Console.WriteLine(a.Equals(b));
Console.WriteLine(d.ContainsKey(a));
Console.WriteLine(d.ContainsKey(b));
Console.WriteLine(new HashSet&lt;Exercise1Key&gt; { a, b }.Count);
Console.WriteLine(new List&lt;Exercise1Key&gt; { a }.Contains(b));</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>a.Equals(b)          : True
ContainsKey(a)       : True
ContainsKey(b)       : False
HashSet{a, b}.Count : 2
List.Contains(b)     : True</code></pre>
        <p><code>Equals</code> was overridden and <code>GetHashCode</code> was not, so
        <code>a</code> and <code>b</code> are equal and hash differently — rule 1 broken. The
        dictionary hashes <code>b</code>, goes to a bucket <code>a</code> is not in, and returns
        without comparing anything. The <code>HashSet</code> puts them in different buckets and
        therefore holds both.</p>
        <p><strong>The last line is the important one.</strong>
        <code>List.Contains(b)</code> is <code>True</code> while
        <code>Dictionary.ContainsKey(b)</code> is <code>False</code>, for the same pair of objects
        and the same notion of equality.</p>
        <p><code>List&lt;T&gt;</code> has no buckets. <code>Contains</code> walks the list calling
        <code>Equals</code> on every element, so it never asks for a hash code and the broken
        <code>GetHashCode</code> cannot affect it. A dictionary hashes first and compares second, so
        the hash decides whether a comparison ever happens.</p>
        <p><strong>What that means for testing:</strong> a type with a broken
        <code>GetHashCode</code> passes every test written against a <code>List</code> and fails in
        production against a <code>Dictionary</code>. Testing equality means testing it the way it
        will be used — or better, testing the contract directly: assert that equal instances have
        equal hash codes, which is one line and does not depend on which collection you thought
        of.</p>
        <p>The compiler did warn: <code>CS0659</code>. It is a warning, so the build succeeded.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A coordinate type hashes with <code>X ^ Y</code>. It satisfies the contract. Over a
    100×100 grid, predict roughly how many distinct hash codes the 10,000 keys produce, then
    explain the pattern and give the fix.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>sealed class Coord
{
    public int X { get; }
    public int Y { get; }
    public Coord(int x, int y) { X = x; Y = y; }
    public override bool Equals(object? o) =&gt; o is Coord c &amp;&amp; c.X == X &amp;&amp; c.Y == Y;
    public override int GetHashCode() =&gt; X ^ Y;
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>X^Y over 100x100 grid: 10000 keys -&gt; 128 distinct hashes
colliding keys       : 9872
largest group        : 100
HashCode.Combine     : 10000 keys -&gt; 10000 distinct hashes
colliding keys       : 0</code></pre>
        <p><strong>128 distinct hash codes for 10,000 keys.</strong> 9,872 of them collide, and the
        largest group holds 100 keys — so a lookup in the worst bucket compares against 100 keys
        instead of one.</p>
        <p><strong>Why 128.</strong> <code>X</code> and <code>Y</code> both run from 0 to 99, which
        needs 7 bits. XOR of two 7-bit numbers is at most 7 bits, so the entire output is confined
        to 0–127 — 128 possible values, and the measurement finds all of them.
        <strong>XOR does not mix; it discards.</strong> Every bit of the result depends on the same
        bit position in both inputs, so information never moves between positions and the output
        can never be wider than the wider input.</p>
        <p>The symmetry is the second problem: <code>X ^ Y == Y ^ X</code> always, so
        <code>(1,2)</code> and <code>(2,1)</code> always collide however large the grid — verified
        in the module's output, both hashing to 3 while comparing unequal.</p>
        <p>And a third, worse case: <code>X ^ X == 0</code>, so every point on the diagonal hashes
        to zero. For a grid of coordinates that is a common and heavily used set of keys.</p>
        <p><strong>The fix</strong> is <code>HashCode.Combine(X, Y)</code>, which gave 10,000
        distinct hashes for 10,000 keys — no collisions at all on this input. It mixes the inputs so
        that bits move between positions and order matters, which is exactly what XOR does not
        do.</p>
        <p>Note the contract was never broken here. Equal coordinates always produced equal hash
        codes. This is entirely a rule-2 problem, and rule 2 is where the performance lives.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A cache entry cannot be found by the key object stored in it. <code>Count</code> says 1 and
    enumeration yields it. Explain what happened, why <code>Remove</code> also fails, what happens
    if the caller inserts an equal key, and give two fixes — one that prevents it and one that
    detects it in production.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>What happened.</strong> The key was mutated after insertion. A dictionary
        computes the hash code once, when the entry is added, and uses it to choose a bucket.
        Changing a member the hash code depends on changes what the key hashes to <em>now</em>, but
        the entry is still sitting in the bucket chosen by the old value. Every lookup hashes the
        key, goes to the new bucket, finds nothing, and returns false.</p>
        <pre data-lang="console" data-title="Measured"><code>after : ContainsKey(key)        : False
after : ContainsKey(new equal)  : False
after : ContainsKey(old value)  : False
after : Count                   : 1
after : enumerating finds it    : Key(us-east-1) -&gt; london</code></pre>
        <p>Note that even the <em>old</em> value cannot find it: the stored key object has changed,
        so a probe hashing to the old bucket finds that bucket and then compares against a key which
        no longer equals the probe.</p>
        <p><strong>Why <code>Remove</code> fails.</strong> <code>Remove</code> is a lookup followed
        by an unlink. It uses the same hash-then-compare path, so it cannot find the entry either
        and returns <code>false</code>. The entry cannot be deleted through the dictionary's API at
        all — it is a leak that survives every attempt to clean it up, short of rebuilding the
        dictionary from its enumeration.</p>
        <p><strong>Inserting an equal key adds a second entry:</strong></p>
        <pre data-lang="console" data-title="Measured"><code>Count                         : 2
Key(us-east-1) -&gt; london
Key(us-east-1) -&gt; virginia</code></pre>
        <p>Two entries whose keys print identically and compare equal to each other. Any code that
        assumed keys are unique — a report, a sum, a reconciliation — is now wrong in a way that is
        very hard to believe when you read it.</p>
        <p><strong>Fix that prevents it:</strong> make the key immutable. A
        <code>readonly record struct</code> or a <code>sealed record</code> with no setters cannot
        be mutated, so the hash cannot go stale. This is the only fix that does not depend on
        everyone remembering a rule — and note the mutation is usually in a different component
        from the dictionary, so "remember not to mutate keys" is advice given to people who do not
        know a dictionary exists.</p>
        <p><strong>Fix that detects it:</strong> a consistency check that walks the dictionary and
        looks up each key it finds:</p>
<pre data-lang="csharp" data-net="10" data-title="A production check"><code>static IReadOnlyList&lt;TKey&gt; FindStaleKeys&lt;TKey, TValue&gt;(Dictionary&lt;TKey, TValue&gt; map)
    where TKey : notnull
{
    var stale = new List&lt;TKey&gt;();
    foreach (var key in map.Keys)
        if (!map.ContainsKey(key))
            stale.Add(key);
    return stale;
}</code></pre>
        <p>Every key that the dictionary contains should be findable in the dictionary. Any that is
        not has been mutated since insertion. Run it on a timer or behind a diagnostic endpoint; it
        is O(n) and turns an unfalsifiable "the cache is behaving strangely" into a list of exact
        keys.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A batch job comparing sensor readings takes 40 minutes; a prototype doing the same work takes
    20 seconds. Both use this struct, compared through a generic method. Find the cause, predict the
    per-comparison cost of each version, and give the one-line fix. Then say why the profiler points
    somewhere confusing.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 4 — as given"><code>struct Reading
{
    public int Sensor;
    public double Value;
    public string Unit;
}

// used as:  EqualityComparer&lt;Reading&gt;.Default.Equals(a, b)
// and as:   readings.Distinct().Count()
// and as:   new HashSet&lt;Reading&gt;(readings)</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code> 127.0 ns/compare  (no IEquatable)
   0.5 ns/compare  (IEquatable)</code></pre>
        <p><strong>About 254 times slower</strong> — 127 ns against 0.5 ns per comparison. Over the
        hundreds of millions of comparisons a <code>Distinct</code> or <code>HashSet</code> build
        performs on a large batch, that is the difference between 20 seconds and 40 minutes.</p>
        <p><strong>The cause.</strong> <code>Reading</code> does not implement
        <code>IEquatable&lt;Reading&gt;</code>, so
        <code>EqualityComparer&lt;Reading&gt;.Default</code> resolves to
        <code>ObjectEqualityComparer</code> rather than <code>GenericEqualityComparer</code>. That
        calls <code>ValueType.Equals(object)</code>, which:</p>
        <ol>
          <li><strong>boxes</strong> the argument — measured at 176 bytes per call in this module's
          demonstration — putting pressure on gen0 for every comparison;</li>
          <li>tries to compare the raw bytes, and <strong>cannot</strong>, because the struct
          contains a <code>string</code> reference (two equal strings can be different objects, so
          a byte comparison would be wrong);</li>
          <li>falls back to <strong>walking the fields by reflection</strong>, comparing each one
          through <code>object.Equals</code>.</li>
        </ol>
        <p>The <code>double</code> makes it worse: a struct with any floating-point field can never
        use the byte-comparison fast path, because <code>-0.0</code> and <code>+0.0</code> have
        different bytes and compare equal, while <code>NaN</code> has identical bytes and compares
        unequal.</p>
        <p><strong>The one-line fix:</strong></p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4 — fixed"><code>readonly record struct Reading(int Sensor, double Value, string Unit);</code></pre>
        <p>The compiler generates <code>IEquatable&lt;Reading&gt;</code>, a direct
        <code>Equals(Reading)</code>, and a matching <code>GetHashCode</code>. Measured at 1.8
        ns/compare in this module's benchmark — indistinguishable from the hand-written version. If
        the type must stay a plain struct, implementing <code>IEquatable&lt;Reading&gt;</code> by
        hand achieves the same thing.</p>
        <p><strong>Why the profiler is confusing.</strong> The time does not appear in
        <code>Reading.Equals</code>, because <code>Reading</code> has no <code>Equals</code> — the
        code being executed belongs to the runtime. A profile shows time in
        <code>System.ValueType.Equals</code>, <code>RuntimeHelpers</code>, or a reflection helper,
        none of which appear anywhere in the source, and the batch job's own methods look cheap. The
        symptom reads as "the framework is slow".</p>
        <p>The one-line confirmation, which is faster than reading a profile:</p>
<pre data-lang="csharp" data-net="10" data-title="The diagnostic"><code>Console.WriteLine(EqualityComparer&lt;Reading&gt;.Default.GetType().Name);
// ObjectEqualityComparer&#96;1  -&gt; slow path, no IEquatable
// GenericEqualityComparer&#96;1 -&gt; fast path</code></pre>
        <p>Worth applying to every struct on a hot path, and worth knowing that the same fix
        improves <code>HashSet</code>, <code>Distinct</code>, <code>GroupBy</code>,
        <code>Dictionary</code> and <code>Contains</code> at once, because all of them go through
        <code>EqualityComparer&lt;T&gt;.Default</code>.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>State the hash code contract in two rules, and say which one is about correctness.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>(1) Equal objects must have equal hash codes.</strong> (2) Equal hash codes do
        not imply equal objects. Rule 1 is the correctness requirement — breaking it makes lookups
        miss. Rule 2 is what makes rule 1 sufficient, because the collection still calls
        <code>Equals</code> within the bucket.</p>
      </div></details>
    </li>
    <li>
      <p>Why does a dictionary lookup fail for a key that <code>Equals</code> says is present?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The lookup hashes first. A different hash code sends it to a different <strong>bucket</strong>,
        where it finds nothing and returns — <strong>without ever calling <code>Equals</code></strong>.
        The comparison that would have succeeded never happens.</p>
      </div></details>
    </li>
    <li>
      <p>What happens to a dictionary entry whose key is mutated after insertion?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It becomes unreachable by any lookup — including by the stored key object itself — while
        <code>Count</code> still counts it and enumeration still yields it. <code>Remove</code> also
        fails, so it cannot be cleaned up, and inserting an equal key adds a <strong>second</strong>
        entry that prints identically.</p>
      </div></details>
    </li>
    <li>
      <p>What did a constant hash code cost at 40,000 keys, and what is the shape of the growth?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>1,984 ms to insert and 6,075 ms to look up, against about 1.5 ms and 1.0 ms — roughly
        1,300× and 6,000×. The growth is <strong>quadratic</strong>: all keys share one bucket, so
        each of <em>n</em> lookups compares against <em>n</em> keys. Every answer is still
        correct.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>X ^ Y</code> a poor hash for a coordinate?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>XOR <strong>discards rather than mixes</strong>: the result is never wider than its
        inputs, so a 100×100 grid produced only <strong>128 distinct hashes for 10,000 keys</strong>.
        It is also symmetric, so <code>(1,2)</code> and <code>(2,1)</code> always collide, and
        <code>X ^ X == 0</code> puts the whole diagonal in one bucket.
        <code>HashCode.Combine</code> gave 10,000 distinct hashes on the same input.</p>
      </div></details>
    </li>
    <li>
      <p>Why did the same pair give <code>List.Contains → True</code> and
      <code>Dictionary.ContainsKey → False</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>List</code> has no buckets: <code>Contains</code> walks it calling
        <code>Equals</code>, so a broken <code>GetHashCode</code> cannot affect it. A dictionary
        hashes first. This is why a type with a broken hash code passes list-based tests and fails
        in production.</p>
      </div></details>
    </li>
    <li>
      <p>How do <code>==</code> and <code>Equals</code> differ, and what decides each?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>==</code> is resolved at compile time from the <strong>static</strong> type — an
        operator if one is in scope, otherwise reference comparison. <code>Equals</code> is virtual
        and dispatches on the <strong>runtime</strong> type. Two identical strings held as
        <code>object</code> compared <code>False</code> with <code>==</code> and <code>True</code>
        with <code>Equals</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>EqualityComparer&lt;T&gt;.Default</code> choose, and how do you see which
      it picked?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>GenericEqualityComparer</code> when the type implements
        <code>IEquatable&lt;T&gt;</code>, otherwise <code>ObjectEqualityComparer</code>, which boxes
        and falls back to reflection. Print
        <code>EqualityComparer&lt;T&gt;.Default.GetType().Name</code> — a one-line diagnostic that
        is faster than reading a profile.</p>
      </div></details>
    </li>
    <li>
      <p>What did implementing <code>IEquatable&lt;T&gt;</code> on a struct measure at?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>About <strong>80–95× faster</strong> — 134 ns down to 1.6 ns in one sample, 127 ns down
        to 0.5 ns in the exercise. The boxing path also allocated about 176 bytes per comparison.
        A <code>readonly record struct</code> gets the fast version generated for free.</p>
      </div></details>
    </li>
    <li>
      <p>When <code>Equals</code> compares case-insensitively, what must <code>GetHashCode</code>
      do?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Hash case-insensitively too. <strong>Any normalisation applied in <code>Equals</code> —
        case, trimming, sorting — must be applied identically in <code>GetHashCode</code></strong>,
        or two objects that compare equal will hash differently and rule 1 is broken.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>IComparer&lt;T&gt;</code> define, and what happens when it is not a total
      order?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Order, not equality. Without a total order, <code>Array.Sort</code> <em>may</em> throw
        <code>InvalidOperationException</code> — and in this module's run it instead returned an
        unsorted array with no error at all. The usual cause is implementing <code>Compare</code>
        as subtraction, which overflows for large values.</p>
      </div></details>
    </li>
    <li>
      <p>Give the four-part habit for any type used as a key.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Make it <strong>immutable</strong>; implement <strong><code>IEquatable&lt;T&gt;</code></strong>
        (or declare it a record); use <strong><code>HashCode.Combine</code> over exactly the members
        <code>Equals</code> uses</strong>; and write the <strong>test</strong> asserting two
        instances built from identical inputs are equal and hash equally.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
