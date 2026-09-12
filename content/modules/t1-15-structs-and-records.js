/* ============================================================================
   Track 1, Module 15 — Structs, Records, readonly, and init
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-15-structs-and-records/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-15-structs-and-records",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "A record is a class or struct with equality, ToString and a copy operation written for you. " +
    "The equality is member-by-member using each member's own Equals, which means a record " +
    "holding a collection is not value-equal to one holding an identical collection — and no " +
    "built-in collection type fixes that, including the immutable ones.",
  terms: [
    "record", "record class", "record struct", "readonly record struct",
    "positional record", "value equality", "reference equality",
    "EqualityContract", "with expression", "shallow copy", "non-destructive mutation",
    "Deconstruct", "readonly struct", "defensive copy", "mutable struct",
    "default value", "HashCode", "value object"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A caching layer stores results keyed by a request object. It works, and its hit rate is zero.
  Every lookup misses, every request recomputes, and the cache is a dictionary that only ever
  grows. The key type is a <code>record</code>, chosen specifically because records compare by
  value. Two keys built from identical inputs are, in fact, not equal.</p>

  <p>Elsewhere, an audit finds an order whose line items differ from the ones that were priced. The
  code that changed them created a copy with <code>with</code> first, edited only the copy, and
  never touched the original. Both objects hold the same list.</p>

  <p>And a third: a loop over a list of counters increments each one. After the loop every counter
  is zero. Changing the <code>List</code> to an array makes the identical line of code start
  working.</p>

  <p>All three come from the same two ideas. <strong>What does it mean for two values to be
  equal</strong>, and <strong>what happens when a value is copied</strong> — questions
  <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a> opened and this module
  finishes, now that records exist to make the answers look simpler than they are.</p>
</section>

<section id="what-a-record-is">
  <h2>What a record actually is</h2>

  <p class="define"><span class="define__term">Record</span> A class or struct for which the
  compiler generates value equality, a <code>ToString</code> that prints the members, and a copy
  operation. Declared <code>record</code> (a class) or <code>record struct</code> (a value type).
  It is not a new kind of type — it is a normal type with members written for you.</p>

  <p class="define"><span class="define__term">Positional record</span> One declared with a
  parameter list — <code>record Customer(string Name, int Age)</code>. The parameters become
  public properties, and a constructor and a <code>Deconstruct</code> method are generated to
  match.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-what-a-record-generates.cs"><code>// 01-what-a-record-generates.cs — a record is a class (or struct) with a set of
// members written for you. This prints exactly which ones.
// .NET 10.0.400. Run: dotnet run 01-what-a-record-generates.cs

#:property NoWarn=IL2070;IL2075

using System;
using System.Linq;
using System.Reflection;

public class PlainCustomer
{
    public string Name { get; init; } = "";
    public int Age { get; init; }
}

public record CustomerRecord(string Name, int Age);

public record struct PointRecord(int X, int Y);

public readonly record struct ReadonlyPoint(int X, int Y);

class Program
{
    const BindingFlags Declared =
        BindingFlags.Public | BindingFlags.NonPublic |
        BindingFlags.Instance | BindingFlags.DeclaredOnly;

    static void Main()
    {
        Console.WriteLine("Members the compiler generated for 'record CustomerRecord(string, int)':");
        Dump(typeof(CustomerRecord));

        Console.WriteLine();
        Console.WriteLine("For comparison, the hand-written class:");
        Dump(typeof(PlainCustomer));

        Console.WriteLine();
        Console.WriteLine("Value equality comes for free with a record:");
        var r1 = new CustomerRecord("Ada", 36);
        var r2 = new CustomerRecord("Ada", 36);
        Console.WriteLine($"  r1 == r2                : {r1 == r2}");
        Console.WriteLine($"  r1.Equals(r2)           : {r1.Equals(r2)}");
        Console.WriteLine($"  ReferenceEquals(r1, r2) : {ReferenceEquals(r1, r2)}");
        Console.WriteLine($"  same hash code          : {r1.GetHashCode() == r2.GetHashCode()}");

        var c1 = new PlainCustomer { Name = "Ada", Age = 36 };
        var c2 = new PlainCustomer { Name = "Ada", Age = 36 };
        Console.WriteLine($"  plain class c1.Equals(c2): {c1.Equals(c2)}");

        Console.WriteLine();
        Console.WriteLine("ToString is generated too:");
        Console.WriteLine($"  record : {r1}");
        Console.WriteLine($"  class  : {c1}");

        Console.WriteLine();
        Console.WriteLine("Deconstruct is generated for positional records:");
        var (name, age) = r1;
        Console.WriteLine($"  var (name, age) = r1  -&gt;  {name}, {age}");

        Console.WriteLine();
        Console.WriteLine("record struct and readonly record struct:");
        Console.WriteLine($"  PointRecord is value type   : {typeof(PointRecord).IsValueType}");
        Console.WriteLine($"  ReadonlyPoint is value type : {typeof(ReadonlyPoint).IsValueType}");
        var p1 = new PointRecord(1, 2);
        var p2 = new PointRecord(1, 2);
        Console.WriteLine($"  p1 == p2                    : {p1 == p2}");
        Console.WriteLine($"  p1                          : {p1}");
    }

    static void Dump(Type t)
    {
        foreach (var m in t.GetMembers(Declared)
                          .Where(m =&gt; m.MemberType is MemberTypes.Method or MemberTypes.Property
                                      or MemberTypes.Constructor)
                          .Select(m =&gt; m.MemberType == MemberTypes.Method
                              ? $"{((MethodInfo)m).ReturnType.Name} {m.Name}"
                              : $"{m.MemberType} {m.Name}")
                          .OrderBy(x =&gt; x))
            Console.WriteLine($"  {m}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Members the compiler generated for 'record CustomerRecord(string, int)':
  Boolean Equals
  Boolean op_Equality
  Boolean op_Inequality
  CustomerRecord &lt;Clone&gt;$
  Boolean PrintMembers
  Constructor .ctor
  Int32 get_Age
  Int32 GetHashCode
  Property Age
  Property EqualityContract
  Property Name
  String get_Name
  String ToString
  Type get_EqualityContract
  Void Deconstruct
  Void set_Age
  Void set_Name

For comparison, the hand-written class:
  Constructor .ctor
  Int32 get_Age
  Property Age
  Property Name
  String get_Name
  Void set_Age
  Void set_Name

Value equality comes for free with a record:
  r1 == r2                : True
  r1.Equals(r2)           : True
  ReferenceEquals(r1, r2) : False
  same hash code          : True
  plain class c1.Equals(c2): False

ToString is generated too:
  record : CustomerRecord { Name = Ada, Age = 36 }
  class  : PlainCustomer

Deconstruct is generated for positional records:
  var (name, age) = r1  -&gt;  Ada, 36

record struct and readonly record struct:
  PointRecord is value type   : True
  ReadonlyPoint is value type : True
  p1 == p2                    : True
  p1                          : PointRecord { X = 1, Y = 2 }</code></pre>

  <p class="define"><span class="define__term">record struct</span> A record that is a value type.
  It gets the same generated equality, <code>ToString</code> and <code>with</code> support, and it
  lives where it is declared rather than on the heap. Its properties are settable unless the
  declaration also says <code>readonly</code>.</p>

  <p class="define"><span class="define__term">readonly record struct</span> The combination that
  means what most people want from an immutable value: a value type, compared by contents, whose
  members the compiler will not let you mutate.</p>

  <p class="define"><span class="define__term">Value equality</span> Two objects are equal when
  their contents are equal. <span class="define__term">Reference equality</span> — the default for
  a class — means two objects are equal only when they are the same object. The plain class above
  said <code>False</code> for two objects with identical contents; the record said
  <code>True</code>.</p>

  <p class="define"><span class="define__term">EqualityContract</span> A generated property
  returning the record's runtime type. Record equality compares it first, which is why a base
  record and a derived record are never equal even when every other member matches — covered in
  the inheritance section below.</p>

  <p>The analogy: a record is a form with named boxes, and two filled-in forms are "the same" when
  every box matches. <strong>The analogy's limit is exactly where this module lives.</strong> If a
  box contains a photograph rather than a word, two forms match only if it is
  <em>literally the same photograph</em>, not an identical one — because "matches" is decided
  separately by whatever is in each box. That is the caching failure at the top of this
  module.</p>

  <div class="callout callout--note">
    <h4>Note the generated setters</h4>
    <p><code>set_Name</code> and <code>set_Age</code>
    appear in the list because positional record properties are <code>init</code>-only, and
    <code>init</code> compiles to a setter the compiler restricts to object initialisation.
    <a href="#/m/t1-08-classes-and-objects">Classes and Objects</a> introduced
    <code>init</code>; the point here is that a record is not automatically immutable in any
    deeper sense, and a <code>record struct</code> without <code>readonly</code> has genuinely
    settable properties.</p>
  </div>
</section>

<section id="equality-traps">
  <h2>Where value equality stops</h2>

  <p>Record equality is member-by-member, and each member is compared using <em>its own</em>
  <code>Equals</code>. For a collection, that is reference equality.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-equality-traps.cs"><code>// 02-equality-traps.cs — record equality is member-by-member, and "member-by-
// member" means each member's OWN Equals. For a collection that is reference
// equality, so two records with identical contents are not equal.
// .NET 10.0.400. Run: dotnet run 02-equality-traps.cs

using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;

public record Order(string Id, List&lt;string&gt; Lines);
public record OrderWithArray(string Id, string[] Lines);
public record OrderImmutable(string Id, ImmutableArray&lt;string&gt; Lines);

// The fix that actually works: compare the collection yourself.
public record OrderFixed(string Id, IReadOnlyList&lt;string&gt; Lines)
{
    // For an unsealed record this must be 'virtual bool Equals(OrderFixed?)'.
    public virtual bool Equals(OrderFixed? other) =&gt;
        other is not null &amp;&amp; Id == other.Id &amp;&amp; Lines.SequenceEqual(other.Lines);

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(Id);
        foreach (var line in Lines) hash.Add(line);
        return hash.ToHashCode();
    }
}

// ---- record inheritance ---------------------------------------------------
public record Person(string Name);
public record Employee(string Name, string Department) : Person(Name);

// ---- a record used as a dictionary key ------------------------------------
public record struct MutableKey(int Id)
{
    public int Id { get; set; } = Id;      // record struct properties are settable
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. a record holding a List ---");
        var a = new Order("O-1", new List&lt;string&gt; { "widget", "gizmo" });
        var b = new Order("O-1", new List&lt;string&gt; { "widget", "gizmo" });
        Console.WriteLine($"  contents identical? {a.Lines.SequenceEqual(b.Lines)}");
        Console.WriteLine($"  a == b              : {a == b}");
        Console.WriteLine("  The Id matched. The List did not, because List&lt;T&gt;.Equals is");
        Console.WriteLine("  reference equality — two different lists are never equal.");

        var shared = new List&lt;string&gt; { "widget" };
        var c = new Order("O-2", shared);
        var d = new Order("O-2", shared);
        Console.WriteLine($"  two records sharing ONE list: c == d  : {c == d}");

        Console.WriteLine();
        Console.WriteLine("--- arrays behave the same way ---");
        var e = new OrderWithArray("O-3", new[] { "x" });
        var f = new OrderWithArray("O-3", new[] { "x" });
        Console.WriteLine($"  e == f : {e == f}");

        Console.WriteLine();
        Console.WriteLine("--- immutable collections do NOT help ---");
        var g = new OrderImmutable("O-4", ImmutableArray.Create("x", "y"));
        var h = new OrderImmutable("O-4", ImmutableArray.Create("x", "y"));
        Console.WriteLine($"  ImmutableArray: g == h            : {g == h}");
        var sameArray = ImmutableArray.Create("x", "y");
        Console.WriteLine($"  ...but sharing ONE instance       : " +
                          $"{new OrderImmutable("O-4", sameArray) == new OrderImmutable("O-4", sameArray)}");
        Console.WriteLine("  ImmutableArray&lt;T&gt; is a struct wrapping an array, and its Equals");
        Console.WriteLine("  compares that array by REFERENCE. Immutable does not mean");
        Console.WriteLine("  value-equal. No built-in collection type gives a record what");
        Console.WriteLine("  people expect here.");

        Console.WriteLine();
        Console.WriteLine("--- what does work: write Equals and GetHashCode yourself ---");
        var i1 = new OrderFixed("O-7", new[] { "x", "y" });
        var i2 = new OrderFixed("O-7", new[] { "x", "y" });
        Console.WriteLine($"  i1 == i2                          : {i1 == i2}");
        Console.WriteLine($"  hash codes match                  : {i1.GetHashCode() == i2.GetHashCode()}");
        Console.WriteLine("  A record lets you replace the generated Equals; you must then");
        Console.WriteLine("  replace GetHashCode too, or dictionary lookups break.");

        Console.WriteLine();
        Console.WriteLine("--- 2. 'with' is a SHALLOW copy ---");
        var original = new Order("O-5", new List&lt;string&gt; { "widget" });
        var copy = original with { Id = "O-6" };
        Console.WriteLine($"  same List instance? {ReferenceEquals(original.Lines, copy.Lines)}");
        copy.Lines.Add("added via the copy");
        Console.WriteLine($"  original.Lines now : {string.Join(", ", original.Lines)}");
        Console.WriteLine("  Changing the copy changed the original.");

        Console.WriteLine();
        Console.WriteLine("--- 3. record inheritance and EqualityContract ---");
        Person p = new Person("Ada");
        Person emp = new Employee("Ada", "Research");
        Console.WriteLine($"  p.Name == emp.Name : {p.Name == emp.Name}");
        Console.WriteLine($"  p == emp           : {p == emp}");
        Console.WriteLine($"  emp.Equals(p)      : {emp.Equals(p)}");
        Console.WriteLine("  A record compares its EqualityContract (its runtime type) first,");
        Console.WriteLine("  so a base and a derived record are never equal — which is what");
        Console.WriteLine("  makes record equality symmetric.");
        Console.WriteLine($"  emp                : {emp}");

        Console.WriteLine();
        Console.WriteLine("--- 4. a mutable record struct as a dictionary key ---");
        var key = new MutableKey(1);
        var map = new Dictionary&lt;MutableKey, string&gt; { [key] = "first" };
        Console.WriteLine($"  lookup before mutation : {map.ContainsKey(key)}");
        key.Id = 99;
        Console.WriteLine($"  after mutating the local copy, lookup with it : {map.ContainsKey(key)}");
        Console.WriteLine($"  entries still in the dictionary : {map.Count}");
        Console.WriteLine($"  the stored key is still : {map.Keys.First()}");
        Console.WriteLine("  A struct key was COPIED into the dictionary, so mutating the");
        Console.WriteLine("  local did not corrupt it — but the lookup now misses.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. a record holding a List ---
  contents identical? True
  a == b              : False
  The Id matched. The List did not, because List&lt;T&gt;.Equals is
  reference equality — two different lists are never equal.
  two records sharing ONE list: c == d  : True

--- arrays behave the same way ---
  e == f : False

--- immutable collections do NOT help ---
  ImmutableArray: g == h            : False
  ...but sharing ONE instance       : True
  ImmutableArray&lt;T&gt; is a struct wrapping an array, and its Equals
  compares that array by REFERENCE. Immutable does not mean
  value-equal. No built-in collection type gives a record what
  people expect here.

--- what does work: write Equals and GetHashCode yourself ---
  i1 == i2                          : True
  hash codes match                  : True
  A record lets you replace the generated Equals; you must then
  replace GetHashCode too, or dictionary lookups break.

--- 2. 'with' is a SHALLOW copy ---
  same List instance? True
  original.Lines now : widget, added via the copy
  Changing the copy changed the original.

--- 3. record inheritance and EqualityContract ---
  p.Name == emp.Name : True
  p == emp           : False
  emp.Equals(p)      : False
  A record compares its EqualityContract (its runtime type) first,
  so a base and a derived record are never equal — which is what
  makes record equality symmetric.
  emp                : Employee { Name = Ada, Department = Research }

--- 4. a mutable record struct as a dictionary key ---
  lookup before mutation : True
  after mutating the local copy, lookup with it : False
  entries still in the dictionary : 1
  the stored key is still : MutableKey { Id = 1 }
  A struct key was COPIED into the dictionary, so mutating the
  local did not corrupt it — but the lookup now misses.</code></pre>

  <p><strong>The first block is the caching failure.</strong> Two records with the same
  <code>Id</code> and lists containing the same strings are <em>not</em> equal, because
  <code>List&lt;T&gt;</code> does not override <code>Equals</code>. Every cache lookup constructs
  a fresh key with a fresh list, so every lookup misses.</p>

  <div class="callout callout--myth">
    <h4>Immutable collections do not fix it, and this is worth getting right</h4>
    <p>The
    natural next move is to reach for <code>ImmutableArray&lt;T&gt;</code>, reasoning that an
    immutable collection ought to compare by value. Measured: <code>g == h</code> is
    <code>False</code>. <code>ImmutableArray&lt;T&gt;</code> is a struct wrapping an array, and its
    <code>Equals</code> compares that array <em>by reference</em>;
    <code>ImmutableList&lt;T&gt;</code> behaves the same way. <strong>Immutable means "cannot be
    changed", not "compared by contents".</strong> No built-in collection type gives a record the
    behaviour people expect.</p>
  </div>

  <p>What does work is writing the comparison yourself. A record permits you to replace the
  generated <code>Equals</code> — and then you must replace <code>GetHashCode</code> too, because
  the two have to agree or dictionary lookups fail in a different way. The exact signature matters:
  for an unsealed record it is <code>public virtual bool Equals(TheRecord? other)</code>; for a
  sealed one, drop <code>virtual</code>.</p>

  <p>The other members that do give a record value equality are worth knowing:
  <code>string</code>, all the numeric types, <code>DateTime</code>, other records, and
  <code>ValueTuple</code> — anything that overrides <code>Equals</code> itself.</p>
</section>

<section id="with-expressions">
  <h2>with, and what it copies</h2>

  <p class="define"><span class="define__term">with expression</span> Creates a copy of a record
  with some members changed: <code>order with { Id = "O-6" }</code>. Also called
  <strong>non-destructive mutation</strong>, because the original is untouched. It calls the
  generated <code>&lt;Clone&gt;$</code> method and then applies the listed initialisers.</p>

  <p class="define"><span class="define__term">Shallow copy</span> A copy in which reference-typed
  members are copied as <em>references</em>, so the copy and the original point at the same
  objects. <code>with</code> does exactly this, and it is the second incident from the top of this
  module.</p>

  <pre data-lang="console" data-title="From the output above"><code>--- 2. 'with' is a SHALLOW copy ---
  same List instance? True
  original.Lines now : widget, added via the copy
  Changing the copy changed the original.</code></pre>

  <p>The copy has its own <code>Id</code> and shares the original's <code>Lines</code>. Adding to
  the copy's list added to the original's list, because there is one list. The word
  "non-destructive" describes what happens to the <em>record</em>, not to anything it points
  at.</p>

  <p>This is the same fact as the equality trap, seen from the other side: a record treats a
  reference-typed member as a reference, both when comparing and when copying. It is consistent,
  and it surprises people in both directions.</p>

  <p>The fix is to copy the collection explicitly when you copy the record — the production example
  below does this in its <code>WithLine</code> method — or to hold a genuinely immutable collection
  so that sharing it is harmless. Note those are different problems with different solutions:
  <code>ImmutableArray</code> makes sharing safe and still does not make the records equal.</p>
</section>

<section id="record-inheritance">
  <h2>Records and inheritance</h2>

  <p>A <code>record</code> class can inherit from another record. Equality then has to answer a
  question ordinary classes duck: is a <code>Circle</code> with colour red equal to a
  <code>Shape</code> with colour red?</p>

  <pre data-lang="console" data-title="From the output above"><code>  p.Name == emp.Name : True
  p == emp           : False
  emp.Equals(p)      : False
  emp                : Employee { Name = Ada, Department = Research }</code></pre>

  <p>The answer is no, and the mechanism is <code>EqualityContract</code>. Every record's generated
  <code>Equals</code> compares the runtime type first, so a base and a derived instance are never
  equal regardless of their members.</p>

  <p><strong>That is a deliberate correctness decision, not a limitation.</strong> If a base
  instance could equal a derived one, equality would stop being symmetric — the base would say
  "equal, our shared members match" and the derived would say "not equal, you lack my extra
  members". Comparing the type first makes <code>a.Equals(b)</code> and <code>b.Equals(a)</code>
  always agree. Two <em>separately constructed but identical</em> <code>Circle</code> values held
  in <code>Shape</code> variables still compare equal, because their runtime types match.</p>

  <p>Note also that <code>ToString</code> printed <code>Employee { Name = Ada, Department =
  Research }</code> — the generated <code>PrintMembers</code> is virtual, so a derived record adds
  its own members to the output.</p>

  <p>Equality gets a module of its own in
  <a href="#/m/t1-16-equality-and-hashing">Equality, GetHashCode, and Comparers</a>, including what
  the hash code contract requires and how breaking it corrupts a dictionary. What matters here is
  that a record makes a specific set of choices for you, and those choices are visible.</p>
</section>

<section id="struct-cost">
  <h2>What a struct actually saves</h2>

  <p><a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a> established that a
  struct lives where it is declared and a class lives on the heap. The usual conclusion — "use
  structs for small data, they avoid allocation" — is half right, and the half that is wrong is
  worth measuring.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-struct-cost.cs"><code>// 03-struct-cost.cs — when a struct is cheaper than a class, and when it is
// not. Measured rather than assumed.
// .NET 10.0.400, Release, x64. Run: dotnet run 03-struct-cost.cs -c Release

using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;

readonly record struct SmallStruct(int X, int Y);              // 8 bytes
sealed record SmallClass(int X, int Y);

readonly record struct BigStruct(
    long A, long B, long C, long D, long E, long F, long G, long H);   // 64 bytes
sealed record BigClass(long A, long B, long C, long D, long E, long F, long G, long H);

class Program
{
    const int N = 20_000_000;

    static long SumSmallStruct() { long t = 0; for (int i = 0; i &lt; N; i++) { var v = new SmallStruct(i, i); t += Use(v); } return t; }
    static long SumSmallClass() { long t = 0; for (int i = 0; i &lt; N; i++) { var v = new SmallClass(i, i); t += Use(v); } return t; }
    static long SumBigStruct() { long t = 0; for (int i = 0; i &lt; N; i++) { var v = new BigStruct(i, i, i, i, i, i, i, i); t += Use(v); } return t; }
    static long SumBigClass() { long t = 0; for (int i = 0; i &lt; N; i++) { var v = new BigClass(i, i, i, i, i, i, i, i); t += Use(v); } return t; }

    [MethodImpl(MethodImplOptions.NoInlining)] static long Use(SmallStruct v) =&gt; v.X + v.Y;
    [MethodImpl(MethodImplOptions.NoInlining)] static long Use(SmallClass v) =&gt; v.X + v.Y;
    [MethodImpl(MethodImplOptions.NoInlining)] static long Use(BigStruct v) =&gt; v.A + v.H;
    [MethodImpl(MethodImplOptions.NoInlining)] static long Use(BigClass v) =&gt; v.A + v.H;

    static void Time(string label, Func&lt;long&gt; body)
    {
        body();
        long before = GC.GetTotalAllocatedBytes(precise: false);
        double best = double.MaxValue;
        for (int r = 0; r &lt; 5; r++)
        {
            var sw = Stopwatch.StartNew();
            long v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        long allocated = GC.GetTotalAllocatedBytes(precise: false) - before;
        Console.WriteLine($"  {label,-28} {best,7:F1} ms   ~{allocated / (5.0 * N),5:F1} bytes/iteration");
    }

    static void Main()
    {
        Console.WriteLine($"sizes: SmallStruct={Unsafe.SizeOf&lt;SmallStruct&gt;()} bytes, " +
                          $"BigStruct={Unsafe.SizeOf&lt;BigStruct&gt;()} bytes");
        Console.WriteLine($"a class instance also carries a 16-byte header on x64");
        Console.WriteLine($"N = {N:N0} per run, best of 5, gen0 collections counted below");
        Console.WriteLine();

        int gc0 = GC.CollectionCount(0);
        Time("small struct (8 B)", SumSmallStruct);
        Console.WriteLine($"    gen0 collections during that: {GC.CollectionCount(0) - gc0}");

        gc0 = GC.CollectionCount(0);
        Time("small class  (8 B + header)", SumSmallClass);
        Console.WriteLine($"    gen0 collections during that: {GC.CollectionCount(0) - gc0}");

        gc0 = GC.CollectionCount(0);
        Time("big struct   (64 B)", SumBigStruct);
        Console.WriteLine($"    gen0 collections during that: {GC.CollectionCount(0) - gc0}");

        gc0 = GC.CollectionCount(0);
        Time("big class    (64 B + header)", SumBigClass);
        Console.WriteLine($"    gen0 collections during that: {GC.CollectionCount(0) - gc0}");
    }
}</code></pre>

  <p>Three independent samples, 20 million iterations each:</p>

  <div class="table-wrap">
  <table>
    <thead>
      <tr><th>Type</th><th>Sample 1</th><th>Sample 2</th><th>Sample 3</th>
          <th>Bytes/iteration</th><th>gen0 collections</th></tr>
    </thead>
    <tbody>
      <tr><td>small struct (8 B)</td><td>144.2 ms</td><td>131.8 ms</td><td>142.9 ms</td>
          <td><strong>0</strong></td><td><strong>0</strong></td></tr>
      <tr><td>small class (8 B + header)</td><td>97.0 ms</td><td>122.4 ms</td><td>108.8 ms</td>
          <td>24</td><td>918</td></tr>
      <tr><td>big struct (64 B)</td><td>167.6 ms</td><td>169.2 ms</td><td>197.7 ms</td>
          <td><strong>0</strong></td><td><strong>0</strong></td></tr>
      <tr><td>big class (64 B + header)</td><td>185.2 ms</td><td>196.4 ms</td><td>214.9 ms</td>
          <td>80</td><td>3,060</td></tr>
    </tbody>
  </table>
  </div>

  <p><strong>The allocation claim is completely true.</strong> Both struct rows allocated nothing
  and triggered zero garbage collections. The class rows allocated 24 and 80 bytes per iteration
  and caused 918 and 3,060 gen0 collections. Those numbers are exactly reproducible.</p>

  <p><strong>The speed claim is not.</strong> The small <em>class</em> was faster than the small
  struct in all three samples, despite allocating on every iteration. Gen0 allocation in .NET is a
  pointer bump, and collecting short-lived objects is close to free, so 918 collections cost less
  than copying an 8-byte struct through a non-inlined call 20 million times.</p>

  <p>The big case does favour the struct — 167–198 ms against 185–215 — plus the zero GC pressure.
  So the honest summary is:</p>

  <ul>
    <li><strong>Structs reliably eliminate allocation and GC pressure.</strong> That is the real
    benefit, and it is what matters in a hot loop or a high-throughput service where GC pauses are
    the problem.</li>
    <li><strong>Structs do not reliably run faster.</strong> Passing them around copies them, and
    for small types that copy can cost more than the allocation it avoided.</li>
  </ul>

  <p>Which means the decision is not about size in isolation but about how often the value is
  allocated versus how often it is copied. The Microsoft guidance — under 16 bytes, immutable,
  short-lived — is a reasonable default precisely because it optimises the allocation side without
  paying much on the copying side.</p>
</section>

<section id="readonly-struct">
  <h2>readonly struct and the copies you cannot see</h2>

  <p><a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a> defined the
  defensive copy: a hidden copy the compiler makes when a struct is reached through something it
  cannot prove will be left unmodified. <code>readonly</code> on the struct removes the need for
  it.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-readonly-and-mutation.cs"><code>// 04-readonly-and-mutation.cs — a non-readonly struct in a readonly field
// forces the compiler to copy it before every member access. And a mutable
// struct in a collection is edited in a copy you then throw away.
// .NET 10.0.400, Release. Run: dotnet run 04-readonly-and-mutation.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.CompilerServices;

// Not marked readonly. The compiler cannot know Total() leaves it unchanged.
struct MutableCounter
{
    private long _a, _b, _c, _d;
    public MutableCounter(long seed) { _a = seed; _b = seed; _c = seed; _d = seed; }
    public long Total() =&gt; _a + _b + _c + _d;
    public void Bump() =&gt; _a++;
}

// Marked readonly. The compiler knows no member can change it, so no copy.
readonly struct ReadonlyCounter
{
    private readonly long _a, _b, _c, _d;
    public ReadonlyCounter(long seed) { _a = seed; _b = seed; _c = seed; _d = seed; }
    public long Total() =&gt; _a + _b + _c + _d;
}

// The same pair at 64 bytes, with inlining prevented so the copy cannot be
// optimised away. This is what a defensive copy actually costs.
struct MutableBig
{
    private long _a, _b, _c, _d, _e, _f, _g, _h;
    public MutableBig(long s) { _a = _b = _c = _d = _e = _f = _g = _h = s; }
    [MethodImpl(MethodImplOptions.NoInlining)]
    public long Total() =&gt; _a + _b + _c + _d + _e + _f + _g + _h;
}

readonly struct ReadonlyBig
{
    private readonly long _a, _b, _c, _d, _e, _f, _g, _h;
    public ReadonlyBig(long s) { _a = _b = _c = _d = _e = _f = _g = _h = s; }
    [MethodImpl(MethodImplOptions.NoInlining)]
    public long Total() =&gt; _a + _b + _c + _d + _e + _f + _g + _h;
}

sealed class Holder
{
    public readonly MutableCounter Mutable = new(1);
    public readonly ReadonlyCounter Readonly = new(1);
    public readonly MutableBig MutableBig = new(1);
    public readonly ReadonlyBig ReadonlyBig = new(1);
}

// A mutable struct that people expect to behave like an object.
struct Tally
{
    public int Count;
    public void Increment() =&gt; Count++;
}

class Program
{
    const int N = 100_000_000;
    const int M = 50_000_000;

    static long ReadMutable(Holder h) { long t = 0; for (int i = 0; i &lt; N; i++) t += h.Mutable.Total(); return t; }
    static long ReadReadonly(Holder h) { long t = 0; for (int i = 0; i &lt; N; i++) t += h.Readonly.Total(); return t; }
    static long ReadMutableBig(Holder h) { long t = 0; for (int i = 0; i &lt; M; i++) t += h.MutableBig.Total(); return t; }
    static long ReadReadonlyBig(Holder h) { long t = 0; for (int i = 0; i &lt; M; i++) t += h.ReadonlyBig.Total(); return t; }

    static void Time(string label, Func&lt;long&gt; body)
    {
        body();
        double best = double.MaxValue;
        for (int r = 0; r &lt; 5; r++)
        {
            var sw = Stopwatch.StartNew();
            long v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-40} {best,7:F1} ms");
    }

    static void Main()
    {
        Console.WriteLine("--- 1. defensive copies, reading through a readonly field ---");
        var holder = new Holder();
        Time("struct NOT marked readonly", () =&gt; ReadMutable(holder));
        Time("readonly struct", () =&gt; ReadReadonly(holder));
        Console.WriteLine("  No measurable difference: the JIT inlined Total() and the copy");
        Console.WriteLine("  disappeared with it.");

        Console.WriteLine();
        Console.WriteLine("  Now 64 bytes, with inlining prevented so the copy must happen:");
        Time("64-byte struct, NOT readonly", () =&gt; ReadMutableBig(holder));
        Time("64-byte readonly struct", () =&gt; ReadReadonlyBig(holder));
        Console.WriteLine("  Same fields, same arithmetic. The first is copied to the stack");
        Console.WriteLine("  before every call, because the compiler cannot prove Total()");
        Console.WriteLine("  leaves the readonly field unchanged.");

        Console.WriteLine();
        Console.WriteLine("--- 2. a mutable struct inside a List ---");
        var list = new List&lt;Tally&gt; { new Tally() };
        list[0].Increment();
        Console.WriteLine($"  after list[0].Increment()  : Count = {list[0].Count}");
        Console.WriteLine("  (does not compile for a List indexer returning a copy? it does —");
        Console.WriteLine("   the indexer returns a COPY, which is incremented and discarded)");

        var arr = new Tally[1];
        arr[0].Increment();
        Console.WriteLine($"  after arr[0].Increment()   : Count = {arr[0].Count}");
        Console.WriteLine("  An ARRAY indexer gives direct access, so this one works — the");
        Console.WriteLine("  same line of code behaves differently for List and for array.");

        Console.WriteLine();
        Console.WriteLine("--- 3. the same thing in a foreach ---");
        var tallies = new List&lt;Tally&gt; { new Tally(), new Tally() };
        foreach (var t in tallies) { var copy = t; copy.Increment(); }
        Console.WriteLine($"  counts after foreach: {string.Join(", ", tallies.ConvertAll(x =&gt; x.Count))}");
        Console.WriteLine("  The loop variable is a copy; mutating it changes nothing.");

        Console.WriteLine();
        Console.WriteLine("--- 4. what fixes it: do not have mutable structs ---");
        var immutable = new List&lt;int&gt; { 0, 0 };
        for (int i = 0; i &lt; immutable.Count; i++) immutable[i] = immutable[i] + 1;
        Console.WriteLine($"  replacing the value instead: {string.Join(", ", immutable)}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. defensive copies, reading through a readonly field ---
  struct NOT marked readonly                 140.4 ms
  readonly struct                            135.2 ms
  No measurable difference: the JIT inlined Total() and the copy
  disappeared with it.

  Now 64 bytes, with inlining prevented so the copy must happen:
  64-byte struct, NOT readonly               155.5 ms
  64-byte readonly struct                    104.9 ms
  Same fields, same arithmetic. The first is copied to the stack
  before every call, because the compiler cannot prove Total()
  leaves the readonly field unchanged.

--- 2. a mutable struct inside a List ---
  after list[0].Increment()  : Count = 0
  after arr[0].Increment()   : Count = 1
  An ARRAY indexer gives direct access, so this one works — the
  same line of code behaves differently for List and for array.

--- 3. the same thing in a foreach ---
  counts after foreach: 0, 0
  The loop variable is a copy; mutating it changes nothing.

--- 4. what fixes it: do not have mutable structs ---
  replacing the value instead: 1, 1</code></pre>

  <p><strong>Block 1 needed two measurements to say anything true.</strong> With a 32-byte struct
  and an inlinable method, there was no measurable difference — the JIT inlined the call and the
  copy went with it. With 64 bytes and inlining prevented, the non-<code>readonly</code> version
  cost about 50% more. Both numbers are real, and quoting only one of them would mislead:
  <code>readonly struct</code> is free to add and its benefit appears when the copy cannot be
  optimised away, which you cannot predict from the source.</p>

  <p><strong>Blocks 2 and 3 are the third incident from the top of the module, and they are worse
  than a performance issue.</strong> <code>list[0].Increment()</code> left the count at zero;
  <code>arr[0].Increment()</code> set it to one. The <em>same line of code</em> behaves differently
  depending on the collection type, because a <code>List&lt;T&gt;</code> indexer returns a copy
  while an array indexer gives direct access to the element. The <code>foreach</code> case is the
  same thing again: the loop variable is a copy.</p>

  <p class="define"><span class="define__term">Mutable struct</span> A struct with a member that
  changes its own state. Widely described as an anti-pattern, and this is why: every copy is
  silent, and the language makes copies in places that do not look like copies. Marking a struct
  <code>readonly</code> makes the compiler reject mutating members, which is the reliable fix.</p>

  <p>The rule that follows: <strong>make every struct <code>readonly</code> unless you have a
  measured reason not to.</strong> It costs nothing, it prevents the entire class of bug in blocks
  2 and 3 at compile time, and it removes defensive copies wherever they would have occurred.</p>
</section>

<section id="production-example">
  <h2>The pieces used for what each is good at</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-production.cs"><code>// 05-production.cs — records and structs used for what each is good at, in one
// small domain.
// .NET 10.0.400. Run: dotnet run 05-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

// A small, immutable value with meaningful equality: readonly record struct.
// 16 bytes, never allocated on the heap, compared by value.
public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money Zero(string currency) =&gt; new(0m, currency);

    public Money Add(Money other) =&gt; other.Currency == Currency
        ? this with { Amount = Amount + other.Amount }
        : throw new InvalidOperationException($"cannot add {other.Currency} to {Currency}");

    public override string ToString() =&gt; $"{Amount:0.00} {Currency}";
}

public readonly record struct Sku(string Value)
{
    // Validation on a positional record goes in the property initialiser.
    // There is no 'primary constructor body' syntax for records.
    public string Value { get; } = string.IsNullOrWhiteSpace(Value)
        ? throw new ArgumentException("SKU is required.", nameof(Value))
        : Value;
}

// A larger immutable value: record class. Reference type, but value equality
// and a 'with' expression for updates.
public sealed record OrderLine(Sku Sku, int Quantity, Money UnitPrice)
{
    public Money LineTotal =&gt; UnitPrice with { Amount = UnitPrice.Amount * Quantity };
}

// A record holding a collection needs its own equality, as demonstrated in
// 02-equality-traps.cs. This one is sealed, so Equals need not be virtual.
public sealed record Order(string Id, IReadOnlyList&lt;OrderLine&gt; Lines)
{
    public Money Total =&gt; Lines.Count == 0
        ? Money.Zero("GBP")
        : Lines.Select(l =&gt; l.LineTotal).Aggregate((a, b) =&gt; a.Add(b));

    public bool Equals(Order? other) =&gt;
        other is not null &amp;&amp; Id == other.Id &amp;&amp; Lines.SequenceEqual(other.Lines);

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(Id);
        foreach (var line in Lines) hash.Add(line);
        return hash.ToHashCode();
    }

    public Order WithLine(OrderLine line) =&gt;
        this with { Lines = Lines.Append(line).ToArray() };
}

class Program
{
    static void Main()
    {
        var order = new Order("O-1", new[]
        {
            new OrderLine(new Sku("WIDGET-1"), 3, new Money(9.99m, "GBP")),
            new OrderLine(new Sku("GIZMO-2"), 1, new Money(24.50m, "GBP"))
        });

        Console.WriteLine($"order {order.Id}, total {order.Total}");
        foreach (var l in order.Lines)
            Console.WriteLine($"  {l.Sku.Value,-10} x{l.Quantity} @ {l.UnitPrice} = {l.LineTotal}");

        Console.WriteLine();
        Console.WriteLine("--- value equality, including the collection ---");
        var same = new Order("O-1", new[]
        {
            new OrderLine(new Sku("WIDGET-1"), 3, new Money(9.99m, "GBP")),
            new OrderLine(new Sku("GIZMO-2"), 1, new Money(24.50m, "GBP"))
        });
        Console.WriteLine($"  order == same          : {order == same}");
        Console.WriteLine($"  hash codes match       : {order.GetHashCode() == same.GetHashCode()}");
        Console.WriteLine("  (only because Order supplies its own Equals and GetHashCode)");

        Console.WriteLine();
        Console.WriteLine("--- 'with' produces a new order, leaving the original alone ---");
        var bigger = order.WithLine(new OrderLine(new Sku("BOLT-3"), 10, new Money(0.45m, "GBP")));
        Console.WriteLine($"  original: {order.Lines.Count} lines, {order.Total}");
        Console.WriteLine($"  bigger  : {bigger.Lines.Count} lines, {bigger.Total}");
        Console.WriteLine($"  original unchanged? {order.Lines.Count == 2}");
        Console.WriteLine("  WithLine copies the array rather than appending in place, so the");
        Console.WriteLine("  shallow-copy trap from 02-equality-traps.cs does not apply here.");

        Console.WriteLine();
        Console.WriteLine("--- validation in a positional record struct ---");
        try
        {
            _ = new Sku("  ");
        }
        catch (ArgumentException ex)
        {
            Console.WriteLine($"  new Sku(\"  \") -&gt; {ex.GetType().Name}: {ex.Message.Split('(')[0].Trim()}");
        }
        Console.WriteLine($"  but default(Sku) bypasses it entirely: Value = " +
                          $"{(default(Sku).Value is null ? "null" : "\"" + default(Sku).Value + "\"")}");
        Console.WriteLine("  Every struct has a zero value that no constructor produced.");

        Console.WriteLine();
        Console.WriteLine("--- currency mismatch is caught ---");
        try
        {
            _ = new Money(1m, "GBP").Add(new Money(1m, "USD"));
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  {ex.Message}");
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>order O-1, total 54.47 GBP
  WIDGET-1   x3 @ 9.99 GBP = 29.97 GBP
  GIZMO-2    x1 @ 24.50 GBP = 24.50 GBP

--- value equality, including the collection ---
  order == same          : True
  hash codes match       : True
  (only because Order supplies its own Equals and GetHashCode)

--- 'with' produces a new order, leaving the original alone ---
  original: 2 lines, 54.47 GBP
  bigger  : 3 lines, 58.97 GBP
  original unchanged? True
  WithLine copies the array rather than appending in place, so the
  shallow-copy trap from 02-equality-traps.cs does not apply here.

--- validation in a positional record struct ---
  new Sku("  ") -&gt; ArgumentException: SKU is required.
  but default(Sku) bypasses it entirely: Value = null
  Every struct has a zero value that no constructor produced.

--- currency mismatch is caught ---
  cannot add USD to GBP</code></pre>

  <p class="define"><span class="define__term">Value object</span> A type with no identity of its
  own, defined entirely by its contents — money, a SKU, a date range. Two with the same contents
  are interchangeable. This is the category records exist for.</p>

  <p>Five decisions worth naming.</p>

  <p><strong><code>Money</code> and <code>Sku</code> are <code>readonly record struct</code>.</strong>
  Small, immutable, value-compared, and allocated nowhere. This is the case where every property
  of a struct is what you want.</p>

  <p><strong><code>OrderLine</code> is a <code>record</code> class.</strong> It holds three members
  and is passed around in collections; there is no reason to pay copying costs for it, and value
  equality is still what is wanted.</p>

  <p><strong><code>Order</code> writes its own <code>Equals</code> and <code>GetHashCode</code>.</strong>
  It holds a collection, so the generated equality would have been reference equality on the list —
  the caching failure. Because <code>Order</code> is <code>sealed</code>, <code>Equals</code> need
  not be <code>virtual</code>.</p>

  <p><strong><code>WithLine</code> copies the array.</strong> <code>this with { Lines = ... }</code>
  builds a new array rather than appending to the shared one, so the shallow-copy trap does not
  apply. The output confirms the original still has two lines.</p>

  <p class="define"><span class="define__term">Default value</span> The value a struct has when
  nothing constructed it: every field zeroed and every reference <code>null</code>, written
  <code>default(T)</code>. It arrives from uninitialised array elements, unassigned fields, and
  deserialisation — and no constructor ran to produce it.</p>

  <div class="callout callout--gotcha">
    <h4><code>default(Sku)</code> bypasses validation entirely</h4>
    <p>Every struct has a
    zero value that no constructor produced — all fields zeroed, all references
    <code>null</code>. <code>Sku</code> validates in its property initialiser, and
    <code>default(Sku).Value</code> is still <code>null</code>. A struct cannot make itself
    impossible to construct invalidly, which is a real argument for a <code>sealed record</code>
    class when validity matters more than allocation. Guarding against it means checking for the
    zero value wherever it can arrive: an uninitialised array element, a field never assigned, a
    deserialised object.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A record key that never matches</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a cache key holding a collection"><code>// WRONG. Two keys built from identical inputs are not equal, because
// List&lt;string&gt;.Equals is reference equality. Every lookup misses and the
// dictionary grows without bound.
public record CacheKey(string Endpoint, List&lt;string&gt; Parameters);

var cache = new Dictionary&lt;CacheKey, string&gt;();
cache[new CacheKey("/orders", new List&lt;string&gt; { "page=1" })] = result;

// This misses, every time:
cache.TryGetValue(new CacheKey("/orders", new List&lt;string&gt; { "page=1" }), out var hit);</code></pre>

  <p>The symptom is a cache with a zero hit rate and unbounded growth, which reads like a
  performance problem rather than an equality problem. Substituting
  <code>ImmutableArray&lt;string&gt;</code> does not help. The fixes are a custom
  <code>Equals</code>/<code>GetHashCode</code> pair, or a key made only of value-comparable members
  — often a single joined <code>string</code>, which is both simpler and faster to hash.</p>

  <h3>2. Expecting <code>with</code> to be deep</h3>

  <p>A copy shares every reference-typed member with its original. Editing "only the copy" edits
  both. The audit finding at the top of this module is one team's version of this.</p>

  <h3>3. Mutable structs</h3>

  <p><code>list[0].Increment()</code> silently does nothing while <code>arr[0].Increment()</code>
  works. There is no warning, and the two lines look identical. Marking the struct
  <code>readonly</code> turns this into a compile error at the point the mutating member is
  declared.</p>

  <h3>4. Assuming a record is immutable</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a record struct that is not readonly"><code>// WRONG if you wanted immutability. A record struct without 'readonly' has
// settable properties, so this compiles and mutates:
public record struct Position(int X, int Y);

var p = new Position(1, 2);
p.X = 99;                       // legal

// Right:
public readonly record struct Position(int X, int Y);
// p.X = 99;  -&gt;  CS8852, init-only property cannot be assigned here</code></pre>

  <p>And even a <code>record</code> class is only as immutable as its members: an
  <code>init</code>-only property holding a <code>List&lt;T&gt;</code> gives every holder a
  writable list, which is the encapsulation point from
  <a href="#/m/t1-09-encapsulation">Encapsulation and Access Modifiers</a>.</p>

  <h3>5. Mutating a key after it is stored</h3>

  <p>The dictionary stored a copy of the struct key, so mutating the local did not corrupt the
  dictionary — but the lookup missed. With a <em>class</em> key the same mistake is worse: the
  dictionary holds the same object, so mutating it changes the key's hash code while it sits in a
  bucket chosen by the old one, and the entry becomes unreachable.
  <a href="#/m/t1-16-equality-and-hashing">Equality, GetHashCode, and Comparers</a> takes that
  apart.</p>

  <h3>6. Reaching for a struct because "it is faster"</h3>

  <p>Measured above: the small class was faster than the small struct in all three samples. What
  the struct reliably bought was zero allocation and zero GC pressure. Those are the terms the
  decision should be made in.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>A dictionary or cache keyed on a record always misses</h4>
    <p>Test the key type in
    isolation before looking at the cache: construct two keys from identical inputs and print
    <code>k1 == k2</code> and <code>k1.GetHashCode() == k2.GetHashCode()</code>. If equality is
    false, look at each member and ask whether that member's type overrides <code>Equals</code> —
    collections and arrays do not, and neither do the immutable collections. If equality is true
    but the hash codes differ, someone has overridden one without the other.</p>
  </div>

  <div class="callout callout--debug">
    <h4>Two objects that should be independent change together</h4>
    <p>Look for a
    <code>with</code> expression, or any copy, between them. Confirm with
    <code>ReferenceEquals(a.Member, b.Member)</code> on each reference-typed member — a
    <code>True</code> is the shared object. The fix is to copy that member explicitly in whatever
    produced the copy.</p>
  </div>

  <div class="callout callout--debug">
    <h4>A mutation appears to do nothing</h4>
    <p>Check whether the type is a struct
    (<code>typeof(T).IsValueType</code>), then check what produced the value you mutated. A
    <code>List&lt;T&gt;</code> indexer, a <code>foreach</code> variable, a property getter and a
    method return all give you a copy; an array indexer, a local variable and a
    <code>ref</code> return do not. The reliable fix is to make the struct <code>readonly</code>
    so the compiler rejects the mutating member outright.</p>
  </div>

  <div class="callout callout--debug">
    <h4>A struct-heavy hot path is slower than expected</h4>
    <p>Suspect copying before
    allocation. Check the size with <code>Unsafe.SizeOf&lt;T&gt;()</code>; anything past about 16
    bytes being passed around frequently is worth comparing against a class. Check for missing
    <code>readonly</code> on the struct, which forces defensive copies where it is read through a
    <code>readonly</code> field or an <code>in</code> parameter — worth about 50% in this module's
    64-byte measurement.</p>
  </div>

  <div class="callout callout--debug">
    <h4>A value has all-default members and nothing constructed it</h4>
    <p>That is
    <code>default(T)</code> for a struct: an unassigned field, an uninitialised array element, or
    a deserialised value. No constructor ran, so no validation ran. Search for places the value can
    arrive without a constructor, and consider whether a sealed record class — which cannot be
    created without running a constructor — is the better choice for that type.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A concrete case</h4>
    <p>A pricing API cached quote results in an in-memory
    dictionary keyed by a request record: <code>record QuoteKey(string Product, string Currency,
    List&lt;string&gt; Options)</code>. The cache was added to relieve a downstream pricing engine
    that took about 180 ms per call and was the service's bottleneck. Expected hit rate, from the
    traffic pattern, was around 85%.</p>
    <p>The measured hit rate after deployment was <strong>zero</strong>. Every request built a
    fresh <code>QuoteKey</code> with a fresh <code>List</code>, so no two keys were ever equal.
    Every call went to the pricing engine exactly as before, and the dictionary grew by one entry
    per request — about 40,000 entries an hour, none of which was ever read.</p>
    <p>The symptom was reported as a memory leak, because that is what the graphs showed: steadily
    climbing gen2 heap, restarts every few days. Latency had not improved, but nobody had expected
    the cache to help immediately, so that was not treated as a signal. It took two weeks to
    connect the two.</p>
    <p>The fix was to change <code>Options</code> from <code>List&lt;string&gt;</code> to a joined
    <code>string</code> — one line, and the key became value-comparable because
    <code>string</code> overrides <code>Equals</code>. Hit rate went to 87%, p99 latency fell from
    about 210 ms to about 40 ms, and the memory growth stopped. Writing a custom
    <code>Equals</code> and <code>GetHashCode</code> would have worked equally well and been more
    code.</p>
    <p>What would have caught it in minutes: a single test asserting that two keys built from
    identical inputs are equal. That test is three lines and would have failed on the day the type
    was written.</p>
  </div>

  <p>The general principle: <strong><code>record</code> gives you equality, and equality is only
  as good as the equality of the members you put in it.</strong> The keyword makes value semantics
  look like a property of the record, when it is a property of the whole tree of types underneath
  it. A record of numbers and strings is genuinely value-comparable. A record containing anything
  that does not override <code>Equals</code> is not, and nothing warns you.</p>

  <p>The practical habit is small: <strong>for any type used as a dictionary key or compared for
  equality, write the two-line test</strong> — construct two from identical inputs, assert equal,
  assert matching hash codes. It costs nothing and catches the entire category, including the ones
  introduced later when someone adds a member.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"Records are immutable"</h4>
    <p>A <code>record</code> class has
    <code>init</code>-only properties, which prevents reassignment after construction and nothing
    else — an <code>init</code>-only <code>List&lt;T&gt;</code> is fully writable by anyone holding
    it. A <code>record struct</code> without <code>readonly</code> has genuinely settable
    properties. <code>readonly record struct</code> is the one that means what people expect.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Records compare by value, so a record of anything compares by value"</h4>
    <p>Member-by-member, using each member's own <code>Equals</code>. Put a
    <code>List&lt;T&gt;</code>, an array, an <code>ImmutableArray&lt;T&gt;</code> or any class that
    does not override <code>Equals</code> in a record, and that member compares by reference —
    measured, for all four.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Use an immutable collection and record equality will work"</h4>
    <p>Verified
    false: <code>ImmutableArray&lt;T&gt;</code> and <code>ImmutableList&lt;T&gt;</code> both
    compare the underlying storage by reference. Immutable means "cannot be changed", not
    "compared by contents". You have to write <code>Equals</code> and <code>GetHashCode</code>, or
    use a member type that already has value equality.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"<code>with</code> gives you a safe independent copy"</h4>
    <p>It is shallow. The
    copy shares every reference-typed member with the original, so editing "only the copy" edits
    both. Non-destructive refers to the record, not to what it points at.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Structs are faster because they avoid allocation"</h4>
    <p>The allocation half is
    exactly right — zero bytes and zero gen0 collections, against 918 and 3,060 for the class
    versions. The speed half is not: the small class was faster in all three samples. Gen0
    allocation is a pointer bump; copying a struct on every call is not free. Choose structs to
    remove GC pressure, and measure if you are choosing them for speed.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A record base and a derived record with the same values should be equal"</h4>
    <p>They are not, deliberately. Records compare <code>EqualityContract</code> — the runtime type —
    first, because allowing it would make equality asymmetric: the base would say equal and the
    derived would not. Two separately constructed identical <em>derived</em> values are still
    equal.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Reach for</th><th>Because</th></tr></thead>
    <tbody>
      <tr>
        <td>A small immutable value with meaningful equality — money, a SKU, a coordinate</td>
        <td><code>readonly record struct</code></td>
        <td>Value equality, no allocation, no GC pressure, and the compiler rejects mutating
        members.</td>
      </tr>
      <tr>
        <td>A larger immutable value, or one held in collections and passed around</td>
        <td><code>sealed record</code></td>
        <td>Value equality without paying a copy on every pass. Sealing also means
        <code>Equals</code> need not be virtual if you replace it.</td>
      </tr>
      <tr>
        <td>The type will be a dictionary key or compared for equality</td>
        <td>A record — and a test asserting two identical instances are equal</td>
        <td>Equality is only as good as the members'. The test is three lines and catches the whole
        category.</td>
      </tr>
      <tr>
        <td>A record that must hold a collection</td>
        <td>Write <code>Equals</code> and <code>GetHashCode</code>, or use a joined
        <code>string</code></td>
        <td>No built-in collection type gives value equality, immutable ones included.</td>
      </tr>
      <tr>
        <td>An object with identity — an entity with an id, something with a lifecycle</td>
        <td>A plain <code>class</code></td>
        <td>Two customers with the same name are not the same customer. Value equality would be
        wrong.</td>
      </tr>
      <tr>
        <td>Copying a record that holds a collection</td>
        <td>Copy the collection explicitly in the copy method</td>
        <td><code>with</code> is shallow, so the copy and original share it.</td>
      </tr>
      <tr>
        <td>Any struct at all</td>
        <td>Mark it <code>readonly</code></td>
        <td>Free, removes defensive copies where they would occur, and turns the silent
        mutable-struct bug into a compile error.</td>
      </tr>
      <tr>
        <td>Validity must be guaranteed for every instance</td>
        <td>A <code>sealed record</code> class, not a struct</td>
        <td>Every struct has a <code>default</code> value no constructor produced, so no validation
        ran.</td>
      </tr>
      <tr>
        <td>A hot path allocating many short-lived values</td>
        <td>A struct, and measure</td>
        <td>Zero allocation and zero GC pressure are the reliable wins; wall-clock is not.</td>
      </tr>
      <tr>
        <td>You want a base record and derived records to compare as equal</td>
        <td>Reconsider the model</td>
        <td>Records compare runtime type first, and changing that would break symmetry. Composition
        over a shared base is usually the answer.</td>
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
    <p>Give all six outputs, and explain why the last pair disagrees.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>record Point(int X, int Y);
record Tagged(string Name, List&lt;string&gt; Tags);
class PlainPoint { public int X { get; init; } public int Y { get; init; } }

var p1 = new Point(1, 2);
var p2 = new Point(1, 2);
Console.WriteLine(p1 == p2);
Console.WriteLine(ReferenceEquals(p1, p2));
Console.WriteLine(p1.ToString());

var q1 = new PlainPoint { X = 1, Y = 2 };
var q2 = new PlainPoint { X = 1, Y = 2 };
Console.WriteLine(q1.Equals(q2));

var t1 = new Tagged("a", new List&lt;string&gt; { "x" });
var t2 = new Tagged("a", new List&lt;string&gt; { "x" });
Console.WriteLine(t1 == t2);
Console.WriteLine(t1.Tags.SequenceEqual(t2.Tags));</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>record: p1 == p2                 : True
record: ReferenceEquals(p1, p2)  : False
record: p1.ToString()            : Point { X = 1, Y = 2 }
class : q1.Equals(q2)            : False
record with a List: t1 == t2     : False
same contents?                   : True</code></pre>
        <p>The first three are the point of records: value equality, two distinct objects, and a
        generated <code>ToString</code> naming the members. The plain class says <code>False</code>
        because <code>object.Equals</code> is reference equality and nothing overrode it.</p>
        <p><strong>The last pair is the one that matters.</strong> The two records have equal
        contents by any reasonable reading — same <code>Name</code>, and lists holding the same
        strings — and <code>SequenceEqual</code> confirms it. Yet <code>t1 == t2</code> is
        <code>False</code>.</p>
        <p>Record equality is generated as: compare <code>EqualityContract</code>, then compare
        each member with <em>that member's own</em> <code>Equals</code>. <code>Name</code> is a
        <code>string</code>, which has value equality, so it matches. <code>Tags</code> is a
        <code>List&lt;string&gt;</code>, which does <strong>not</strong> override
        <code>Equals</code>, so it uses reference equality — and these are two different lists.</p>
        <p>The word "record" does not make anything inside it value-comparable. It generates a
        comparison that delegates to the members, and the members decide.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Predict the three outputs, then say what "non-destructive mutation" actually promises and
    give two ways to get an independent copy.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>record Tagged(string Name, List&lt;string&gt; Tags);

var original = new Tagged("first", new List&lt;string&gt; { "x" });
var copy = original with { Name = "second" };

Console.WriteLine(copy.Name);
Console.WriteLine(ReferenceEquals(original.Tags, copy.Tags));
copy.Tags.Add("added-to-copy");
Console.WriteLine(string.Join(", ", original.Tags));</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>copy.Name                        : second
same Tags instance?              : True
original.Tags after copy.Add     : x, added-to-copy</code></pre>
        <p><code>with</code> produced a new record with a different <code>Name</code> and the
        <em>same list</em>. Adding to the copy's list added to the original's, because there is one
        list.</p>
        <p><strong>What "non-destructive mutation" promises</strong> is narrower than it sounds:
        the <em>record</em> is not modified. A new record is created and the original's members are
        copied into it — and for a reference-typed member, copying the member means copying the
        reference. It is a <strong>shallow copy</strong>, and the promise says nothing about
        anything the record points at.</p>
        <p><strong>Two ways to get independence:</strong></p>
        <ol>
          <li><strong>Copy the collection when you copy the record.</strong> Give the record a
          method that does it: <code>public Tagged WithName(string name) =&gt; this with { Name =
          name, Tags = Tags.ToList() };</code> — the copy now owns its list. This is the approach
          in this module's production example.</li>
          <li><strong>Hold a collection that cannot be changed at all.</strong> An
          <code>ImmutableArray&lt;string&gt;</code> makes sharing harmless, because neither holder
          can modify it — adding produces a new array. Note this fixes the <em>copying</em> problem
          and not the <em>equality</em> problem from exercise 1: two records holding separately
          created <code>ImmutableArray</code>s are still not equal.</li>
        </ol>
        <p>Which to choose depends on which problem you have. If the record is a key or is compared,
        you need custom equality regardless. If it is passed around and copied, immutability of the
        member is the stronger guarantee.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Predict all six outputs. Then explain why the designers chose this behaviour, and what would
    break if they had chosen the other way.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>record Shape(string Colour);
record Circle(string Colour, int Radius) : Shape(Colour);

Shape s  = new Shape("red");
Shape c  = new Circle("red", 5);
Shape c2 = new Circle("red", 5);

Console.WriteLine(s.Colour == c.Colour);
Console.WriteLine(s == c);
Console.WriteLine(c.Equals(s));
Console.WriteLine(s.Equals(c));
Console.WriteLine(c.ToString());
Console.WriteLine(c == c2);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>s.Colour == c.Colour             : True
s == c                           : False
c.Equals(s)                      : False
s.Equals(c)                      : False
c.ToString()                     : Circle { Colour = red, Radius = 5 }
two identical Circles as Shape   : True</code></pre>
        <p>Both objects have colour red, and they are not equal. Every record's generated
        <code>Equals</code> compares <code>EqualityContract</code> — a property returning the
        runtime type — before comparing any member. <code>Shape</code> and <code>Circle</code>
        differ, so the comparison stops there.</p>
        <p>The last line is the check that this is type-based rather than declaration-based: two
        separately constructed <code>Circle</code> values held in <code>Shape</code>-typed
        variables <em>are</em> equal, because their runtime types match and all their members
        match.</p>
        <p><strong>Why this was chosen: symmetry.</strong> Equality must satisfy
        <code>a.Equals(b) == b.Equals(a)</code>. Suppose a base and derived instance could be equal
        when their shared members match. Then <code>s.Equals(c)</code> would be <code>True</code> —
        <code>Shape</code> only knows about <code>Colour</code>, which matches — while
        <code>c.Equals(s)</code> would be <code>False</code>, because <code>Circle</code> also
        checks <code>Radius</code> and <code>s</code> has none. The two directions disagree.</p>
        <p><strong>What would break.</strong> Asymmetric equality breaks the contract that
        collections depend on. <code>HashSet</code> and <code>Dictionary</code> would behave
        differently depending on insertion order; <code>Contains</code> could return different
        answers for the same pair depending on which was the argument; <code>Distinct</code> would
        produce order-dependent results. Comparing the type first is the only rule that keeps
        equality symmetric while still comparing members.</p>
        <p>Note also that <code>ToString</code> included <code>Radius</code>. The generated
        <code>PrintMembers</code> method is virtual, so each level of the hierarchy adds its own
        members.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Predict the three counter outputs. Then explain why two lines that look identical behave
    differently, rewrite the type so the bug is impossible, and say what the rewrite costs.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 4 — as given"><code>struct BadCounter
{
    public int Hits;
    public void Hit() =&gt; Hits++;
}

var list = new List&lt;BadCounter&gt; { new BadCounter() };
list[0].Hit();
Console.WriteLine(list[0].Hits);

var arr = new BadCounter[1];
arr[0].Hit();
Console.WriteLine(arr[0].Hits);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>List&lt;BadCounter&gt;: after list[0].Hit()  -&gt; 0
BadCounter[]   : after arr[0].Hit()   -&gt; 1
GoodCounter    : after goods[0] = goods[0].Hit() -&gt; 1</code></pre>
        <p><strong>Why the two lines differ.</strong> It is what each indexer returns.</p>
        <ul>
          <li><code>List&lt;T&gt;</code>'s indexer is a <em>property</em>. Reading it returns a
          <strong>copy</strong> of the struct. <code>Hit()</code> increments that copy, which is
          then discarded — the list is untouched. The compiler does not complain, because
          incrementing a temporary is legal.</li>
          <li>An <strong>array</strong> indexer is not a property. It yields a direct reference to
          the element's storage, so <code>Hit()</code> mutates the element in place.</li>
        </ul>
        <p>The same reasoning explains <code>foreach</code>: the loop variable is a copy, so
        mutating it changes nothing, which the module's demonstration shows leaving both counters
        at zero.</p>
        <p><strong>The rewrite.</strong> Make mutation impossible and return a new value instead:</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4 — rewritten"><code>readonly record struct GoodCounter(int Hits)
{
    public GoodCounter Hit() =&gt; this with { Hits = Hits + 1 };
}

var goods = new List&lt;GoodCounter&gt; { new GoodCounter(0) };
goods[0] = goods[0].Hit();          // the assignment is now required
Console.WriteLine(goods[0].Hits);   // 1</code></pre>
        <p><code>readonly</code> makes the compiler reject any member that assigns a field, so
        <code>Hits++</code> would not compile. <code>Hit()</code> must return a new value, and the
        caller must store it — which makes the copy visible at the call site instead of silent.
        The bug is now impossible to write rather than merely absent.</p>
        <p>As a bonus, <code>readonly record struct</code> gives value equality, so
        <code>new GoodCounter(1)</code> can be used as a dictionary key and found again — verified
        in the run.</p>
        <p><strong>What the rewrite costs.</strong> Three things worth stating:</p>
        <ol>
          <li><strong>Every update allocates a new value and must be assigned back.</strong>
          <code>goods[0] = goods[0].Hit()</code> is wordier than <code>goods[0].Hit()</code>, and
          forgetting the assignment now loses the update visibly rather than invisibly — better,
          but still a thing to remember.</li>
          <li><strong>It is a copy per operation.</strong> For a 4-byte counter that is nothing.
          For a large struct updated in a tight loop it is real, and the measurements in this module
          show copying is where struct costs live.</li>
          <li><strong>It does not fix <code>default</code>.</strong>
          <code>default(GoodCounter)</code> still exists with <code>Hits = 0</code> and no
          constructor ran. Here that is harmless; for a type with validity rules it is not, and a
          sealed record class would be the safer choice.</li>
        </ol>
        <p>The alternative worth knowing: for a collection of structs that genuinely must be
        mutated in place, <code>CollectionsMarshal.AsSpan(list)</code> gives a
        <code>Span&lt;T&gt;</code> whose indexer returns a reference rather than a copy, so
        <code>span[0].Hit()</code> works. That is a deliberate, local escape hatch rather than a
        reason to keep the mutable struct.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>Name the members the compiler generates for a positional record.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A constructor; public properties for each parameter; <code>Equals</code>,
        <code>GetHashCode</code>, <code>op_Equality</code> and <code>op_Inequality</code> for value
        equality; <code>ToString</code> and a virtual <code>PrintMembers</code>; a
        <code>&lt;Clone&gt;$</code> method used by <code>with</code>; the
        <code>EqualityContract</code> property; and <code>Deconstruct</code>.</p>
      </div></details>
    </li>
    <li>
      <p>How is record equality actually computed, and what follows for a record holding a
      <code>List&lt;T&gt;</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>EqualityContract</code> first, then each member using <strong>that member's own
        <code>Equals</code></strong>. <code>List&lt;T&gt;</code> does not override
        <code>Equals</code>, so it compares by reference — two records holding identical-but-separate
        lists are <strong>not</strong> equal.</p>
      </div></details>
    </li>
    <li>
      <p>Does <code>ImmutableArray&lt;T&gt;</code> fix that?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No</strong> — verified. It is a struct wrapping an array and its
        <code>Equals</code> compares that array by reference; <code>ImmutableList&lt;T&gt;</code>
        behaves the same. Immutable means "cannot be changed", not "compared by contents". The fix
        is a custom <code>Equals</code>/<code>GetHashCode</code> pair, or a member type with real
        value equality such as <code>string</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What exactly does <code>with</code> copy?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The record's members, <strong>shallowly</strong>. Reference-typed members are copied as
        references, so the copy and the original share the same objects. "Non-destructive" refers
        to the record, not to anything it points at.</p>
      </div></details>
    </li>
    <li>
      <p>Why is a base record never equal to a derived record, and what would break otherwise?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>EqualityContract</code> — the runtime type — is compared first. Otherwise equality
        would be <strong>asymmetric</strong>: the base would say equal on shared members while the
        derived checked extra ones and said no. That breaks <code>HashSet</code>,
        <code>Dictionary</code>, <code>Contains</code> and <code>Distinct</code>, whose results
        would depend on argument or insertion order.</p>
      </div></details>
    </li>
    <li>
      <p>What did structs reliably save in the measurements, and what did they not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Reliably: <strong>allocation and GC pressure</strong> — 0 bytes and 0 gen0 collections,
        against 24 and 80 bytes and 918 and 3,060 collections for the class versions. Not reliably:
        <strong>speed</strong> — the small class was faster in all three samples, because gen0
        allocation is a pointer bump and copying is not free.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>readonly</code> on a struct buy, and when is it measurable?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It lets the compiler skip <strong>defensive copies</strong> when the struct is reached
        through a <code>readonly</code> field or an <code>in</code> parameter, and it makes
        mutating members a compile error. Measurable when the copy cannot be optimised away — no
        difference for a small inlinable case, about 50% for a 64-byte struct with inlining
        prevented.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>list[0].Increment()</code> do nothing while <code>arr[0].Increment()</code>
      works?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>List&lt;T&gt;</code>'s indexer is a <strong>property</strong>, so it returns a
        copy; the mutation happens on the copy and is discarded. An <strong>array</strong> indexer
        yields direct access to the element's storage. Same line of code, different behaviour, no
        warning.</p>
      </div></details>
    </li>
    <li>
      <p>Is a <code>record struct</code> immutable?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Not unless it is <code>readonly record struct</code>. A plain <code>record struct</code>
        has genuinely settable properties. And even a <code>record</code> class is only as
        immutable as its members — an <code>init</code>-only property holding a
        <code>List&lt;T&gt;</code> gives every holder a writable list.</p>
      </div></details>
    </li>
    <li>
      <p>What is <code>default(SomeStruct)</code> and why does it matter for validation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The all-zero value every struct has: all fields zeroed, all references
        <code>null</code>. <strong>No constructor ran, so no validation ran.</strong> It arrives
        from uninitialised array elements, unassigned fields and deserialisation. A type whose
        validity must be guaranteed is better as a sealed record class, which cannot exist without
        a constructor running.</p>
      </div></details>
    </li>
    <li>
      <p>What is the three-line test that catches the whole category of equality bugs?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Construct two instances from identical inputs; assert they are equal; assert their hash
        codes match. It costs nothing, would have caught the zero-hit-rate cache on the day the type
        was written, and keeps catching it when someone later adds a member whose type does not have
        value equality.</p>
      </div></details>
    </li>
    <li>
      <p>When is a plain class the right choice over a record?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the type has <strong>identity</strong> — an entity with an id, or anything with a
        lifecycle. Two customers with the same name are not the same customer, so value equality
        would be actively wrong. Records are for <strong>value objects</strong>, which are defined
        entirely by their contents.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
