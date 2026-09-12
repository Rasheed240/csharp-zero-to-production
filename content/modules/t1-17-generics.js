/* ============================================================================
   Track 1, Module 17 — Generics
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-17-generics/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-17-generics",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "A type parameter is a hole the caller fills, checked at compile time and specialised by the " +
    "runtime. The alternative it replaced cost 24 bytes of allocation per integer and moved every " +
    "type error to run time. Closed generic types are genuinely distinct types, which is why they " +
    "do not share static fields — and why variance works only for reference types.",
  terms: [
    "generic type", "type parameter", "type argument", "closed generic type",
    "open generic type", "generic method", "type inference", "boxing",
    "JIT specialisation", "shared code", "variance", "covariance",
    "contravariance", "invariance",
    "array covariance", "ArrayTypeMismatchException"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>You need a list of integers. You write a class that stores <code>object</code>, because it
  has to work for strings and orders too. It compiles. Somebody adds a string to the list of
  integers, and that compiles as well. The failure arrives three days later as an
  <code>InvalidCastException</code> in a nightly report, pointing at a line that reads
  <code>(int)list[i]</code> and is not wrong.</p>

  <p>The same class, holding five million integers, uses 120 MB it did not need, because every
  integer put into it became a small heap object. The list of the same integers written the
  obvious modern way uses none.</p>

  <p>And a third: an array of <code>Dog</code> is assigned to a variable of type
  <code>Animal[]</code>, which compiles, and storing a <code>Cat</code> into it throws at run
  time — from a line that does nothing but assign an element.</p>

  <p>All three are the same question. <strong>How do you write one piece of code that works for
  many types without giving up the checks that make types useful?</strong> The answer is a type
  parameter, and this module is about what the compiler and the runtime each do with it.</p>
</section>

<section id="what-generics-are">
  <h2>What a type parameter actually is</h2>

  <p class="define"><span class="define__term">Generic type</span> A type with one or more
  placeholders in it, written <code>List&lt;T&gt;</code> or <code>Cache&lt;TKey, TValue&gt;</code>.
  The placeholders are filled in by whoever uses it.</p>

  <p class="define"><span class="define__term">Type parameter</span> The placeholder itself —
  <code>T</code>. It is not a type; it is a name that stands for one.</p>

  <p class="define"><span class="define__term">Type argument</span> The real type supplied at the
  use site — the <code>int</code> in <code>List&lt;int&gt;</code>.</p>

  <p class="define"><span class="define__term">Closed generic type</span> The result:
  <code>List&lt;int&gt;</code>. It is a complete, ordinary type with its own metadata and its own
  static fields. <span class="define__term">Open generic type</span> is the unfilled form,
  <code>List&lt;&gt;</code>, which you can name in reflection but not instantiate.</p>

  <p>The analogy: a type parameter is a blank in a form letter. One letter, printed with a
  different name each time. <strong>The analogy's limit is that a form letter does not change
  shape.</strong> The runtime produces genuinely different machine code for
  <code>List&lt;int&gt;</code> and <code>List&lt;double&gt;</code> because integers and doubles are
  different sizes — and that difference, not the syntax, is where the performance comes from.</p>
</section>

<section id="minimal-example">
  <h2>What generics replaced</h2>

  <p>Before generics, a collection that worked for anything held <code>object</code>. Both costs
  of that are measurable.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-why-not-object.cs"><code>// 01-why-not-object.cs — what generics replaced, and what that cost.
// .NET 10.0.400, Release. Run: dotnet run 01-why-not-object.cs -c Release

// CA2013 fires on the ReferenceEquals call in block 3. That call is the
// demonstration — boxing twice produces two different objects — so the rule is
// suppressed here rather than obeyed.
#:property NoWarn=CA2013

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;

class Program
{
    const int N = 5_000_000;

    static long SumArrayList(ArrayList list)
    {
        long total = 0;
        for (int i = 0; i &lt; list.Count; i++) total += (int)list[i]!;   // unbox
        return total;
    }

    static long SumList(List&lt;int&gt; list)
    {
        long total = 0;
        for (int i = 0; i &lt; list.Count; i++) total += list[i];
        return total;
    }

    static void Main()
    {
        Console.WriteLine("--- 1. the type system before generics ---");
        var untyped = new ArrayList { 1, 2, 3 };
        untyped.Add("not a number");            // compiles. Nothing stops it.
        Console.WriteLine($"  ArrayList contents: {string.Join(", ", untyped.ToArray())}");
        try
        {
            long bad = 0;
            foreach (var item in untyped) bad += (int)item;
            Console.WriteLine($"  sum = {bad}");
        }
        catch (InvalidCastException ex)
        {
            Console.WriteLine($"  summing threw {ex.GetType().Name} at run time");
        }

        var typed = new List&lt;int&gt; { 1, 2, 3 };
        Console.WriteLine("  List&lt;int&gt;.Add(\"not a number\") does not compile (CS1503)");

        Console.WriteLine();
        Console.WriteLine("--- 2. what boxing costs ---");
        var al = new ArrayList(N);
        var gl = new List&lt;int&gt;(N);

        long before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i &lt; N; i++) al.Add(i);
        long alBytes = GC.GetTotalAllocatedBytes(precise: true) - before;

        before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i &lt; N; i++) gl.Add(i);
        long glBytes = GC.GetTotalAllocatedBytes(precise: true) - before;

        Console.WriteLine($"  ArrayList  filling {N:N0} ints allocated {alBytes:N0} bytes");
        Console.WriteLine($"  List&lt;int&gt;  filling {N:N0} ints allocated {glBytes:N0} bytes");
        Console.WriteLine($"  difference: {alBytes - glBytes:N0} bytes, or " +
                          $"{(double)alBytes / N:F0} bytes per boxed int");

        Console.WriteLine();
        Time("ArrayList sum (unboxing)", () =&gt; SumArrayList(al));
        Time("List&lt;int&gt; sum", () =&gt; SumList(gl));

        Console.WriteLine();
        Console.WriteLine("--- 3. boxing is visible in the type system ---");
        int value = 42;
        object boxed = value;
        Console.WriteLine($"  boxed.GetType()          : {boxed.GetType().Name}");
        Console.WriteLine($"  ReferenceEquals(boxed, (object)value) : " +
                          $"{ReferenceEquals(boxed, (object)value)}");
        Console.WriteLine("  Each cast to object creates a NEW heap object holding a copy.");
    }

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
        Console.WriteLine($"  {label,-28} {best,7:F1} ms   {best * 1e6 / N,5:F2} ns/element");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. the type system before generics ---
  ArrayList contents: 1, 2, 3, not a number
  summing threw InvalidCastException at run time
  List&lt;int&gt;.Add("not a number") does not compile (CS1503)

--- 2. what boxing costs ---
  ArrayList  filling 5,000,000 ints allocated 120,001,408 bytes
  List&lt;int&gt;  filling 5,000,000 ints allocated 0 bytes
  difference: 120,001,408 bytes, or 24 bytes per boxed int

  ArrayList sum (unboxing)        14.6 ms    2.92 ns/element
  List&lt;int&gt; sum                    4.2 ms    0.83 ns/element

--- 3. boxing is visible in the type system ---
  boxed.GetType()          : Int32
  ReferenceEquals(boxed, (object)value) : False
  Each cast to object creates a NEW heap object holding a copy.</code></pre>

  <p><strong>The type safety half.</strong> <code>ArrayList</code> accepted a string into a list of
  numbers with no complaint, and the failure surfaced later, somewhere else, as an
  <code>InvalidCastException</code> from a correct-looking cast.
  <code>List&lt;int&gt;.Add("x")</code> is <code>CS1503</code> — the same mistake, caught by the
  compiler at the line that made it.</p>

  <p><strong>The allocation half.</strong> <a href="#/m/t1-03-value-vs-reference">Value Types vs
  Reference Types</a> introduced boxing; here is its price at scale. Five million integers cost
  <strong>120 MB</strong> in an <code>ArrayList</code> — 24 bytes each, being a 16-byte object
  header plus the value plus padding — and <strong>zero</strong> in a pre-sized
  <code>List&lt;int&gt;</code>, which stores them directly in an array. Reading them back is 2.92
  ns per element against 0.83, because every read is an unbox.</p>

  <div class="callout callout--gotcha">
    <h4>Generic does not mean unboxed</h4>
    <p>A <code>List&lt;object&gt;</code> is a
    generic type and boxes exactly as much as an <code>ArrayList</code> — exercise 1 measures it at
    48 MB for two million integers, the same as the non-generic version. What removes the boxing is
    the type argument being a value type, not the angle brackets.</p>
  </div>
</section>

<section id="specialisation">
  <h2>What the runtime does with a type argument</h2>

  <p>The compiler checks; the runtime generates. What it generates depends on whether the type
  argument is a value type or a reference type, and a static field makes the difference
  visible.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-specialisation.cs"><code>// 02-specialisation.cs — the runtime creates one copy of a generic type's code
// per VALUE type argument, and shares a single copy across all REFERENCE type
// arguments. A static field makes that observable.
// .NET 10.0.400. Run: dotnet run 02-specialisation.cs

using System;
using System.Collections.Generic;

// Each closed generic type gets its own copy of every static field.
class Counter&lt;T&gt;
{
    public static int Instances;
    public Counter() =&gt; Instances++;
    public static string Describe() =&gt; $"{typeof(Counter&lt;T&gt;).Name} for {typeof(T).Name}";
}

// A generic method whose body is identical for every T.
static class Box
{
    public static string Describe&lt;T&gt;(T value) =&gt;
        $"{typeof(T).Name,-10} value={value}  isValueType={typeof(T).IsValueType}";
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- each closed type has its own statics ---");
        _ = new Counter&lt;int&gt;();
        _ = new Counter&lt;int&gt;();
        _ = new Counter&lt;string&gt;();
        _ = new Counter&lt;double&gt;();
        _ = new Counter&lt;double&gt;();
        _ = new Counter&lt;double&gt;();

        Console.WriteLine($"  Counter&lt;int&gt;.Instances    : {Counter&lt;int&gt;.Instances}");
        Console.WriteLine($"  Counter&lt;string&gt;.Instances : {Counter&lt;string&gt;.Instances}");
        Console.WriteLine($"  Counter&lt;double&gt;.Instances : {Counter&lt;double&gt;.Instances}");
        Console.WriteLine($"  Counter&lt;object&gt;.Instances : {Counter&lt;object&gt;.Instances}");
        Console.WriteLine("  Counter&lt;int&gt; and Counter&lt;string&gt; are DIFFERENT types, so they");
        Console.WriteLine("  do not share the static field. This is the clearest evidence");
        Console.WriteLine("  that a closed generic type is a real, distinct type.");

        Console.WriteLine();
        Console.WriteLine("--- are they the same Type object? ---");
        Console.WriteLine($"  typeof(Counter&lt;int&gt;)  == typeof(Counter&lt;string&gt;) : " +
                          $"{typeof(Counter&lt;int&gt;) == typeof(Counter&lt;string&gt;)}");
        Console.WriteLine($"  typeof(List&lt;string&gt;)  == typeof(List&lt;object&gt;)    : " +
                          $"{typeof(List&lt;string&gt;) == typeof(List&lt;object&gt;)}");
        Console.WriteLine($"  open definition of List&lt;int&gt;                     : " +
                          $"{typeof(List&lt;int&gt;).GetGenericTypeDefinition().Name}");

        Console.WriteLine();
        Console.WriteLine("--- one method body, many instantiations ---");
        Console.WriteLine("  " + Box.Describe(42));
        Console.WriteLine("  " + Box.Describe(4.5));
        Console.WriteLine("  " + Box.Describe("text"));
        Console.WriteLine("  " + Box.Describe(new int[3]));
        Console.WriteLine("  The type argument was inferred from the value in every case.");

        Console.WriteLine();
        Console.WriteLine("--- default(T) differs by kind ---");
        Console.WriteLine($"  default(int)     : {Describe(default(int))}");
        Console.WriteLine($"  default(double)  : {Describe(default(double))}");
        Console.WriteLine($"  default(bool)    : {Describe(default(bool))}");
        Console.WriteLine($"  default(string)  : {Describe(default(string))}");
        Console.WriteLine($"  default(DateTime): {Describe(default(DateTime))}");

        Console.WriteLine();
        Console.WriteLine("--- how the runtime shares code ---");
        Console.WriteLine("  Reference type arguments share ONE native code body, because every");
        Console.WriteLine("  reference is the same size and shape. Each value type argument gets");
        Console.WriteLine("  its OWN body, because int, double and DateTime have different sizes");
        Console.WriteLine("  and layouts. That specialisation is why List&lt;int&gt; stores ints");
        Console.WriteLine("  directly with no boxing, and it is the whole performance argument");
        Console.WriteLine("  for generics over object.");
    }

    static string Describe&lt;T&gt;(T value) =&gt;
        value is null ? "null" : $"{value}";
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- each closed type has its own statics ---
  Counter&lt;int&gt;.Instances    : 2
  Counter&lt;string&gt;.Instances : 1
  Counter&lt;double&gt;.Instances : 3
  Counter&lt;object&gt;.Instances : 0
  Counter&lt;int&gt; and Counter&lt;string&gt; are DIFFERENT types, so they
  do not share the static field. This is the clearest evidence
  that a closed generic type is a real, distinct type.

--- are they the same Type object? ---
  typeof(Counter&lt;int&gt;)  == typeof(Counter&lt;string&gt;) : False
  typeof(List&lt;string&gt;)  == typeof(List&lt;object&gt;)    : False
  open definition of List&lt;int&gt;                     : List&amp;#96;1

--- one method body, many instantiations ---
  Int32      value=42  isValueType=True
  Double     value=4.5  isValueType=True
  String     value=text  isValueType=False
  Int32[]    value=System.Int32[]  isValueType=False
  The type argument was inferred from the value in every case.

--- default(T) differs by kind ---
  default(int)     : 0
  default(double)  : 0
  default(bool)    : False
  default(string)  : null
  default(DateTime): 01/01/0001 00:00:00</code></pre>

  <p><strong>Four separate static counters.</strong> <code>Counter&lt;int&gt;</code>,
  <code>Counter&lt;string&gt;</code>, <code>Counter&lt;double&gt;</code> and
  <code>Counter&lt;object&gt;</code> each have their own <code>Instances</code> field. This is the
  practical proof that a closed generic type is not a template or a macro — it is a type, with
  everything <a href="#/m/t1-14-static-and-lifetime">Static Members, Constructors, and Lifetime</a>
  said about statics applying separately to each one.</p>

  <p class="define"><span class="define__term">JIT specialisation</span> The runtime compiles a
  separate native code body for each <em>value type</em> argument, because <code>int</code>,
  <code>double</code> and <code>DateTime</code> have different sizes and layouts. That is what lets
  <code>List&lt;int&gt;</code> store integers directly.</p>

  <p class="define"><span class="define__term">Shared code</span> All <em>reference type</em>
  arguments share one native body, because every reference is the same size and shape. So
  <code>List&lt;string&gt;</code> and <code>List&lt;object&gt;</code> run the same machine code —
  while remaining different types with different static fields.</p>

  <p>Two consequences worth carrying. A generic type used with many value type arguments produces
  many code bodies, which costs compilation time and instruction cache — rarely a problem, but the
  reason a generic type instantiated over 50 struct types is not free. And <code>default(T)</code>
  means different things depending on what <code>T</code> turned out to be: zero for numbers,
  <code>false</code> for <code>bool</code>, <code>null</code> for a reference type, and an all-zero
  value for other structs — the <code>default</code> from
  <a href="#/m/t1-15-structs-and-records">Structs, Records, readonly, and init</a>.</p>

  <p class="define"><span class="define__term">Type inference</span> The compiler working out a
  generic method's type arguments from the arguments you passed, so you write
  <code>Describe(42)</code> rather than <code>Describe&lt;int&gt;(42)</code>. It works from
  arguments only — a method whose type parameter appears solely in the return type cannot be
  inferred, which is <code>CS0411</code>.</p>
</section>

<section id="variance">
  <h2>Variance: when a Dog collection is an Animal collection</h2>

  <p class="define"><span class="define__term">Variance</span> Whether
  <code>Thing&lt;Derived&gt;</code> can be used where <code>Thing&lt;Base&gt;</code> is expected.
  Three answers: covariance (yes, derived to base), contravariance (yes, base to derived), and
  invariance (no).</p>

  <pre data-lang="csharp" data-net="10" data-title="03-variance.cs"><code>// 03-variance.cs — when a List&lt;Derived&gt; is usable as a List&lt;Base&gt;, and when it
// is not. .NET 10.0.400. Run: dotnet run 03-variance.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Animal { public virtual string Noise =&gt; "..."; public string Name = ""; }
class Dog : Animal { public override string Noise =&gt; "woof"; }
class Cat : Animal { public override string Noise =&gt; "meow"; }

// out T: T only ever comes OUT. Safe to treat IProducer&lt;Dog&gt; as IProducer&lt;Animal&gt;.
interface IProducer&lt;out T&gt; { T Produce(); }

// in T: T only ever goes IN. Safe to treat IConsumer&lt;Animal&gt; as IConsumer&lt;Dog&gt;.
interface IConsumer&lt;in T&gt; { string Consume(T item); }

// No variance annotation: T appears in both positions, so neither direction is safe.
interface IStore&lt;T&gt; { T Get(); void Put(T item); }

sealed class DogKennel : IProducer&lt;Dog&gt; { public Dog Produce() =&gt; new Dog { Name = "Rex" }; }
sealed class AnimalFeeder : IConsumer&lt;Animal&gt;
{
    public string Consume(Animal a) =&gt; $"fed {a.Name} ({a.Noise})";
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- covariance: out T, producer side ---");
        IProducer&lt;Dog&gt; dogs = new DogKennel();
        IProducer&lt;Animal&gt; animals = dogs;             // allowed by 'out'
        Animal a = animals.Produce();
        Console.WriteLine($"  IProducer&lt;Dog&gt; used as IProducer&lt;Animal&gt;: {a.GetType().Name} says {a.Noise}");

        Console.WriteLine();
        Console.WriteLine("--- contravariance: in T, consumer side ---");
        IConsumer&lt;Animal&gt; anyAnimal = new AnimalFeeder();
        IConsumer&lt;Dog&gt; dogOnly = anyAnimal;           // allowed by 'in'
        Console.WriteLine($"  IConsumer&lt;Animal&gt; used as IConsumer&lt;Dog&gt;: {dogOnly.Consume(new Dog { Name = "Rex" })}");

        Console.WriteLine();
        Console.WriteLine("--- IEnumerable&lt;T&gt; is covariant, so this works ---");
        List&lt;Dog&gt; kennel = new() { new Dog { Name = "Rex" }, new Dog { Name = "Bess" } };
        IEnumerable&lt;Animal&gt; asAnimals = kennel;       // List&lt;Dog&gt; -&gt; IEnumerable&lt;Animal&gt;
        Console.WriteLine($"  names via IEnumerable&lt;Animal&gt;: " +
                          $"{string.Join(", ", asAnimals.Select(x =&gt; x.Name))}");

        Console.WriteLine();
        Console.WriteLine("--- but List&lt;T&gt; itself is INVARIANT ---");
        Console.WriteLine("  List&lt;Animal&gt; pets = kennel;   does not compile (CS0029)");
        Console.WriteLine("  because List&lt;T&gt; lets you Add, and adding a Cat to a List&lt;Dog&gt;");
        Console.WriteLine("  through a List&lt;Animal&gt; reference would be a type hole.");

        Console.WriteLine();
        Console.WriteLine("--- arrays ARE covariant, and that is the hole ---");
        Dog[] dogArray = { new Dog { Name = "Rex" } };
        Animal[] animalArray = dogArray;              // allowed, and unsafe
        Console.WriteLine($"  Dog[] assigned to Animal[]: {animalArray.Length} element(s)");
        try
        {
            animalArray[0] = new Cat { Name = "Tibbles" };
            Console.WriteLine("  stored a Cat in a Dog[]");
        }
        catch (ArrayTypeMismatchException ex)
        {
            Console.WriteLine($"  storing a Cat threw {ex.GetType().Name} at RUN TIME");
        }
        Console.WriteLine("  Generics moved this check from run time to compile time.");

        Console.WriteLine();
        Console.WriteLine("--- IStore&lt;T&gt; is invariant in both directions ---");
        Console.WriteLine("  IStore&lt;Animal&gt; s = storeOfDogs;  does not compile");
        Console.WriteLine("  IStore&lt;Dog&gt;    d = storeOfAnimals; does not compile");
        Console.WriteLine("  T appears in a return position AND a parameter position, so");
        Console.WriteLine("  neither 'out' nor 'in' can be applied to it.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- covariance: out T, producer side ---
  IProducer&lt;Dog&gt; used as IProducer&lt;Animal&gt;: Dog says woof

--- contravariance: in T, consumer side ---
  IConsumer&lt;Animal&gt; used as IConsumer&lt;Dog&gt;: fed Rex (woof)

--- IEnumerable&lt;T&gt; is covariant, so this works ---
  names via IEnumerable&lt;Animal&gt;: Rex, Bess

--- but List&lt;T&gt; itself is INVARIANT ---
  List&lt;Animal&gt; pets = kennel;   does not compile (CS0029)
  because List&lt;T&gt; lets you Add, and adding a Cat to a List&lt;Dog&gt;
  through a List&lt;Animal&gt; reference would be a type hole.

--- arrays ARE covariant, and that is the hole ---
  Dog[] assigned to Animal[]: 1 element(s)
  storing a Cat threw ArrayTypeMismatchException at RUN TIME
  Generics moved this check from run time to compile time.

--- IStore&lt;T&gt; is invariant in both directions ---
  IStore&lt;Animal&gt; s = storeOfDogs;  does not compile
  IStore&lt;Dog&gt;    d = storeOfAnimals; does not compile
  T appears in a return position AND a parameter position, so
  neither 'out' nor 'in' can be applied to it.</code></pre>

  <p>The rule is simpler than the vocabulary. <strong>Ask which direction the type flows.</strong></p>

  <p class="define"><span class="define__term">Covariance</span> Marked <code>out T</code>. The
  type parameter appears only in <em>output</em> positions — return values. A thing that only
  produces <code>Dog</code>s can be used as a thing that produces <code>Animal</code>s, because
  every <code>Dog</code> it hands you is an <code>Animal</code>.</p>

  <p class="define"><span class="define__term">Contravariance</span> Marked <code>in T</code>. The
  type parameter appears only in <em>input</em> positions — parameters. A thing that accepts any
  <code>Animal</code> can be used as a thing that accepts <code>Dog</code>s, because it will cope
  with whatever you give it.</p>

  <p class="define"><span class="define__term">Invariance</span> The default. The type parameter
  appears in both positions, so neither conversion is safe. <code>List&lt;T&gt;</code> is invariant
  because it both returns <code>T</code> and accepts <code>T</code> — allowing
  <code>List&lt;Dog&gt;</code> as <code>List&lt;Animal&gt;</code> would let you
  <code>Add</code> a <code>Cat</code>.</p>

  <p>That is exactly the hole arrays still have, and the demonstration shows it: assigning
  <code>Dog[]</code> to <code>Animal[]</code> compiles, and storing a <code>Cat</code> throws
  <code>ArrayTypeMismatchException</code> at run time.
  <a href="#/m/t1-06-arrays">Arrays</a> noted array covariance as a design mistake; this is the
  module where the alternative appears. Generics moved the same check from run time to compile
  time.</p>

  <div class="callout callout--gotcha">
    <h4>Variance works for reference types only</h4>
    <p>An
    <code>IResult&lt;string&gt;</code> converts to <code>IResult&lt;object&gt;</code>; an
    <code>IResult&lt;Money&gt;</code>, where <code>Money</code> is a struct, does not — it is
    <code>CS0266</code>. A variance conversion is a <em>reference</em> conversion: the same pointer
    reinterpreted at a different type, with no work at run time. Boxing a value type is real work,
    so it is not available. <strong>Value type arguments are always invariant</strong>, which
    catches people who have only ever tried variance with classes.</p>
  </div>
</section>

<section id="production-example">
  <h2>Generics in a real service</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-production.cs"><code>// 05-production.cs — a generic result type and a generic cache, written the
// way they appear in a real service.
// .NET 10.0.400. Run: dotnet run 05-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

// A result that carries either a value or an error, without exceptions.
// T is covariant: it only ever comes out.
public interface IResult&lt;out T&gt;
{
    bool Ok { get; }
    T Value { get; }
    string? Error { get; }
}

public sealed class Result&lt;T&gt; : IResult&lt;T&gt;
{
    private readonly T _value;
    public bool Ok { get; }
    public string? Error { get; }

    private Result(bool ok, T value, string? error) =&gt; (Ok, _value, Error) = (ok, value, error);

    public T Value =&gt; Ok ? _value
        : throw new InvalidOperationException($"Result is an error: {Error}");

    public static Result&lt;T&gt; Success(T value) =&gt; new(true, value, null);
    public static Result&lt;T&gt; Failure(string error) =&gt; new(false, default!, error);

    // Map keeps the error and transforms the value. Note the second type
    // parameter is on the METHOD, so callers do not restate T.
    public Result&lt;TOut&gt; Map&lt;TOut&gt;(Func&lt;T, TOut&gt; f) =&gt;
        Ok ? Result&lt;TOut&gt;.Success(f(_value)) : Result&lt;TOut&gt;.Failure(Error!);

    public override string ToString() =&gt; Ok ? $"Ok({_value})" : $"Error({Error})";
}

// A cache that works for any key and value, with the key constrained only to
// be non-null. Constraints get their own module; this is the minimum.
public sealed class Cache&lt;TKey, TValue&gt; where TKey : notnull
{
    private readonly Dictionary&lt;TKey, TValue&gt; _entries;
    private readonly Func&lt;TKey, TValue&gt; _load;
    public int Loads { get; private set; }
    public int Hits { get; private set; }

    public Cache(Func&lt;TKey, TValue&gt; load, IEqualityComparer&lt;TKey&gt;? comparer = null)
    {
        _load = load;
        _entries = new Dictionary&lt;TKey, TValue&gt;(comparer);
    }

    public TValue Get(TKey key)
    {
        if (_entries.TryGetValue(key, out var hit)) { Hits++; return hit; }
        Loads++;
        var value = _load(key);
        _entries[key] = value;
        return value;
    }

    public int Count =&gt; _entries.Count;
}

public readonly record struct Order(string Id, decimal Amount, string Currency);

class Program
{
    static Result&lt;Order&gt; ParseOrder(string line)
    {
        var parts = line.Split(',');
        if (parts.Length != 3) return Result&lt;Order&gt;.Failure($"expected 3 fields, got {parts.Length}");
        if (!decimal.TryParse(parts[1], out var amount))
            return Result&lt;Order&gt;.Failure($"'{parts[1]}' is not a number");
        return Result&lt;Order&gt;.Success(new Order(parts[0], amount, parts[2]));
    }

    static void Main()
    {
        Console.WriteLine("--- a generic result type ---");
        foreach (var line in new[] { "O-1,29.97,GBP", "O-2,oops,GBP", "O-3,10.00" })
        {
            var result = ParseOrder(line);
            Console.WriteLine($"  {line,-18} -&gt; {result}");
        }

        Console.WriteLine();
        Console.WriteLine("--- Map changes the value type and keeps the error ---");
        foreach (var line in new[] { "O-1,29.97,GBP", "O-2,oops,GBP" })
        {
            Result&lt;string&gt; summary = ParseOrder(line).Map(o =&gt; $"{o.Id}: {o.Amount:0.00} {o.Currency}");
            Console.WriteLine($"  {line,-18} -&gt; {summary}");
        }

        Console.WriteLine();
        Console.WriteLine("--- covariance works for REFERENCE types only ---");
        Result&lt;string&gt; textResult = Result&lt;string&gt;.Success("O-1");
        IResult&lt;object&gt; loose = textResult;          // string is a class: allowed
        Console.WriteLine($"  IResult&lt;string&gt; as IResult&lt;object&gt; : Ok={loose.Ok}, Value={loose.Value}");

        Console.WriteLine("  IResult&lt;Order&gt; as IResult&lt;object&gt;  : does not compile (CS0266),");
        Console.WriteLine("  because Order is a struct. A variance conversion is a reference");
        Console.WriteLine("  conversion — it reinterprets a pointer, it does not box. Value");
        Console.WriteLine("  type arguments are therefore always invariant.");

        Console.WriteLine();
        Console.WriteLine("--- one cache, two very different instantiations ---");
        var rates = new Cache&lt;string, decimal&gt;(
            code =&gt; code switch { "GBP" =&gt; 1.00m, "USD" =&gt; 1.27m, _ =&gt; 0m },
            StringComparer.OrdinalIgnoreCase);

        foreach (var c in new[] { "GBP", "gbp", "USD", "GBP" })
            Console.WriteLine($"  rates.Get(\"{c}\") = {rates.Get(c)}");
        Console.WriteLine($"  loads {rates.Loads}, hits {rates.Hits}, entries {rates.Count}");

        var squares = new Cache&lt;int, long&gt;(n =&gt; (long)n * n);
        foreach (var n in new[] { 9, 9, 12 })
            Console.WriteLine($"  squares.Get({n}) = {squares.Get(n)}");
        Console.WriteLine($"  loads {squares.Loads}, hits {squares.Hits}, entries {squares.Count}");

        Console.WriteLine();
        Console.WriteLine("  Cache&lt;int, long&gt; stores its keys and values with no boxing,");
        Console.WriteLine("  because the runtime specialised it for those value types.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- a generic result type ---
  O-1,29.97,GBP      -&gt; Ok(Order { Id = O-1, Amount = 29.97, Currency = GBP })
  O-2,oops,GBP       -&gt; Error('oops' is not a number)
  O-3,10.00          -&gt; Error(expected 3 fields, got 2)

--- Map changes the value type and keeps the error ---
  O-1,29.97,GBP      -&gt; Ok(O-1: 29.97 GBP)
  O-2,oops,GBP       -&gt; Error('oops' is not a number)

--- covariance works for REFERENCE types only ---
  IResult&lt;string&gt; as IResult&lt;object&gt; : Ok=True, Value=O-1
  IResult&lt;Order&gt; as IResult&lt;object&gt;  : does not compile (CS0266),
  because Order is a struct. A variance conversion is a reference
  conversion — it reinterprets a pointer, it does not box. Value
  type arguments are therefore always invariant.

--- one cache, two very different instantiations ---
  rates.Get("GBP") = 1.00
  rates.Get("gbp") = 1.00
  rates.Get("USD") = 1.27
  rates.Get("GBP") = 1.00
  loads 2, hits 2, entries 2
  squares.Get(9) = 81
  squares.Get(9) = 81
  squares.Get(12) = 144
  loads 2, hits 1, entries 2

  Cache&lt;int, long&gt; stores its keys and values with no boxing,
  because the runtime specialised it for those value types.</code></pre>

  <p>Four decisions worth naming.</p>

  <p><strong><code>Result&lt;T&gt;</code> makes failure a value rather than an exception.</strong>
  The type says a call can fail, and the compiler makes the caller acknowledge it. This is a
  generic type earning its place: without it you would write
  <code>OrderResult</code>, <code>StringResult</code>, and one per return type.</p>

  <p><strong><code>Map&lt;TOut&gt;</code> puts a type parameter on the method.</strong> A generic
  method inside a generic type can introduce its own parameters, so
  <code>Result&lt;Order&gt;.Map</code> can return <code>Result&lt;string&gt;</code> and callers
  never restate <code>T</code> — type inference fills it in from the lambda.</p>

  <p><strong><code>IResult&lt;out T&gt;</code> is covariant.</strong> <code>T</code> appears only
  as a return type, so the annotation is legal and callers can treat any result as
  <code>IResult&lt;object&gt;</code> — for reference types.</p>

  <p><strong><code>Cache&lt;TKey, TValue&gt;</code> takes an optional comparer.</strong> That is
  the <code>IEqualityComparer&lt;T&gt;</code> from
  <a href="#/m/t1-16-equality-and-hashing">Equality, GetHashCode, and Comparers</a>, which is why
  <code>"gbp"</code> hit the entry stored under <code>"GBP"</code>. The
  <code>where TKey : notnull</code> is a constraint, the subject of
  <a href="#/m/t1-18-generic-constraints">Generic Constraints</a>.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Reaching for object inside a generic type</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: generic in name only"><code>// WRONG. The angle brackets buy nothing: everything is stored as object, so
// value types box, and reading requires a cast that can fail at run time.
public class Cache&lt;TKey, TValue&gt;
{
    private readonly Dictionary&lt;object, object&gt; _entries = new();

    public void Put(TKey key, TValue value) =&gt; _entries[key!] = value!;
    public TValue Get(TKey key) =&gt; (TValue)_entries[key!];
}</code></pre>

  <p>Measured cost of the pattern: 24 bytes per boxed integer and about 3.5× the read time. Store
  <code>TKey</code> and <code>TValue</code>, and the runtime specialises the whole thing.</p>

  <h3>2. Expecting generics to remove boxing when the argument is a reference type</h3>

  <p><code>List&lt;object&gt;</code> allocated 48 MB for two million integers in exercise 1 —
  identical to <code>ArrayList</code>. The saving comes from the type argument being a value type.
  A generic method with <code>T</code> constrained to nothing, storing values in
  <code>object</code> fields, boxes the same way.</p>

  <h3>3. Assuming type parameters support operators</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: no constraint, no operator"><code>// WRONG. CS0019: Operator '+' cannot be applied to operands of type 'T' and 'T'.
// The compiler knows nothing about T, so it cannot know '+' exists.
static T Add&lt;T&gt;(T a, T b) =&gt; a + b;</code></pre>

  <p>A type parameter with no constraint supports only what <code>object</code> supports. Making
  this work needs <code>where T : INumber&lt;T&gt;</code>, which is
  <a href="#/m/t1-18-generic-constraints">Generic Constraints</a> — and was impossible before C#
  11, which is why the base class library has one overload of <code>Math.Max</code> per numeric
  type.</p>

  <h3>4. Expecting inference to work from the return type</h3>

  <pre data-lang="console" data-title="CS0411"><code>error CS0411: The type arguments for method 'Make&lt;T&gt;()' cannot be inferred
              from the usage. Try specifying the type arguments explicitly.</code></pre>

  <p>Inference works from arguments only. A factory method whose <code>T</code> appears only in the
  return type always needs writing out: <code>Make&lt;Order&gt;()</code>.</p>

  <h3>5. Applying the wrong variance annotation</h3>

  <pre data-lang="console" data-title="CS1961"><code>error CS1961: Invalid variance: The type parameter 'T' must be contravariantly
              valid on 'IBadVariance&lt;T&gt;.Put(T)'. 'T' is covariant.</code></pre>

  <p>Marking <code>out T</code> and then accepting a <code>T</code> parameter is rejected at the
  interface declaration, not at the use site. That is the compiler enforcing the rule that makes
  variance safe, and it is why <code>List&lt;T&gt;</code> can never be covariant.</p>

  <h3>6. Array covariance, still</h3>

  <p>It compiles and throws <code>ArrayTypeMismatchException</code> at run time. Prefer
  <code>List&lt;T&gt;</code> or <code>IReadOnlyList&lt;T&gt;</code> in signatures — the latter is
  covariant and safely so, because it has no <code>Add</code>.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>Unexpected allocation in generic code</h4>
    <p>Check what the type argument is
    before blaming the generic. <code>typeof(T).IsValueType</code> at the top of the method
    answers it in one line; if it is <code>false</code>, or the type stores values in
    <code>object</code> fields, boxing is the explanation. Confirm with
    <code>GC.GetTotalAllocatedBytes(precise: true)</code> around the loop — as this module's
    measurements do — which is more direct than a memory profiler for a question this narrow.</p>
  </div>

  <div class="callout callout--debug">
    <h4>A static field is not shared where you expected</h4>
    <p>Each closed generic type
    has its own copy: <code>Counter&lt;int&gt;.Instances</code> and
    <code>Counter&lt;string&gt;.Instances</code> are different fields. If a registry, cache or
    counter on a generic type is losing entries, print
    <code>typeof(TheType&lt;T&gt;)</code> at each use site and check the type arguments match.
    Moving the field to a non-generic base class or a separate static class is the usual fix.</p>
  </div>

  <div class="callout callout--debug">
    <h4><code>ArrayTypeMismatchException</code> from a plain element assignment</h4>
    <p>The array's runtime type is more derived than its declared type — a <code>Dog[]</code> being
    held as <code>Animal[]</code>. Print <code>arr.GetType().GetElementType()</code> to see what it
    really is. The fix is to stop passing arrays by their base element type; use
    <code>IReadOnlyList&lt;T&gt;</code> if the callee only reads, or <code>List&lt;T&gt;</code> if
    it writes.</p>
  </div>

  <div class="callout callout--debug">
    <h4><code>CS0266</code> converting a generic interface with a struct argument</h4>
    <p>Variance conversions are reference conversions. Check whether the type argument is a value type
    — if it is, no variance annotation will help, and the options are to make the type a class, or
    to convert explicitly at the boundary.</p>
  </div>

  <div class="callout callout--debug">
    <h4>Reading an unfamiliar generic signature</h4>
    <p>Work outside in. Where do the type
    parameters appear — return positions, parameter positions, or both? That tells you whether the
    author could have marked variance and chose not to, or could not. Then check the constraints:
    they are the complete list of everything the body is allowed to assume about
    <code>T</code>.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A concrete case</h4>
    <p>A market-data service kept a rolling window of tick prices
    in a cache written before generics were common in that codebase: a
    <code>Dictionary&lt;string, object&gt;</code> where the values were
    <code>List&lt;object&gt;</code> holding <code>decimal</code> prices. It handled roughly 40,000
    ticks a second across 900 instruments, with a 5,000-tick window each.</p>
    <p>That is 4.5 million <code>decimal</code> values held at any moment, each boxed. A boxed
    <code>decimal</code> is 40 bytes against 16 for the raw value, so the window cost about
    <strong>180 MB instead of 72 MB</strong> — and, more expensively, every one of those 4.5 million
    objects was a separate item for the garbage collector to trace. Gen2 collections ran every 40
    seconds and paused the process for 300–400 ms, which for a market-data feed meant dropped
    ticks.</p>
    <p>The team had been treating it as a GC tuning problem for two months: server GC, concurrent
    settings, larger gen0 budgets. Each helped a little, because each reduced the frequency of a
    collection whose cost was proportional to object count.</p>
    <p>The fix was changing two type arguments —
    <code>Dictionary&lt;string, List&lt;decimal&gt;&gt;</code> — which removed 4.5 million objects
    from the heap entirely, because a <code>List&lt;decimal&gt;</code> holds its values in one
    array. Gen2 collections went from every 40 seconds to roughly every 12 minutes, and the pauses
    from 300–400 ms to under 20 ms. Total change: two lines and the casts that fell out.</p>
  </div>

  <p>The general principle: <strong>a type argument is not only a compile-time convenience — it
  decides the memory layout of everything the type holds.</strong> <code>List&lt;decimal&gt;</code>
  is one array of values. <code>List&lt;object&gt;</code> holding decimals is an array of pointers
  to a million separate objects. Same code, same interface, an entirely different shape in
  memory.</p>

  <p>That is why the boxing measurement at the start of this module matters more than it looks. 24
  bytes per integer is not a micro-optimisation when the collection holds millions of them; it is
  the difference between a heap the collector can walk quickly and one it cannot.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"Generics are C++ templates"</h4>
    <p>Templates are expanded by the compiler into
    source before compilation; generics are a runtime feature, and a closed generic type exists in
    metadata as a real type. That is why <code>typeof(List&lt;int&gt;)</code> works, why each
    closed type has its own static fields, and why a generic type can be instantiated by
    reflection over a type the compiler never saw.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Generics avoid boxing"</h4>
    <p>A value type <em>argument</em> avoids boxing.
    <code>List&lt;object&gt;</code> is generic and allocated 48 MB for two million integers,
    identical to <code>ArrayList</code>. The saving comes from the runtime specialising the code
    for a value type, which it cannot do when the argument is <code>object</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"<code>List&lt;Dog&gt;</code> is a <code>List&lt;Animal&gt;</code>"</h4>
    <p>It is
    not, and the reason is that <code>List&lt;T&gt;</code> has an <code>Add</code>. Allowing it
    would let you add a <code>Cat</code> through the base-typed reference.
    <code>IEnumerable&lt;Dog&gt;</code> <em>is</em> an <code>IEnumerable&lt;Animal&gt;</code>,
    because you can only read from it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Arrays are the safe, simple option"</h4>
    <p>Arrays are covariant, which is a hole
    generics were designed to close. <code>Dog[]</code> assigns to <code>Animal[]</code> and throws
    <code>ArrayTypeMismatchException</code> on store. Every array element assignment in .NET carries
    a type check because of this — although exercise 4 measures that check as too cheap to see in
    a monomorphic loop.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Variance works the same for structs"</h4>
    <p>It does not work at all for structs.
    A variance conversion is a reference conversion, so <code>IResult&lt;Money&gt;</code> to
    <code>IResult&lt;object&gt;</code> is <code>CS0266</code> however the interface is annotated.
    Value type arguments are always invariant.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A type parameter behaves like <code>dynamic</code> — I can call anything on
    it"</h4>
    <p>The opposite: with no constraint, <code>T</code> supports only what
    <code>object</code> supports. No <code>+</code>, no <code>&lt;</code>, no <code>new T()</code>,
    no members of your own. Everything else has to be granted by a constraint.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Reach for</th><th>Because</th></tr></thead>
    <tbody>
      <tr>
        <td>The same logic over several types, known at compile time</td>
        <td>A generic type or method</td>
        <td>Type checked at the call site, and specialised for value types with no boxing.</td>
      </tr>
      <tr>
        <td>A collection of value types</td>
        <td><code>List&lt;T&gt;</code>, never <code>List&lt;object&gt;</code></td>
        <td>24 bytes per element and one traced object per element, versus one array.</td>
      </tr>
      <tr>
        <td>A method parameter that is only read from</td>
        <td><code>IEnumerable&lt;T&gt;</code> or <code>IReadOnlyList&lt;T&gt;</code></td>
        <td>Covariant, so callers can pass a more derived collection safely.</td>
      </tr>
      <tr>
        <td>A method parameter written to</td>
        <td><code>List&lt;T&gt;</code> or <code>ICollection&lt;T&gt;</code></td>
        <td>Invariant, which is correct — writing is what makes covariance unsafe.</td>
      </tr>
      <tr>
        <td>An interface whose <code>T</code> is only returned</td>
        <td><code>out T</code></td>
        <td>Callers get covariance for free. The compiler rejects it if you are wrong
        (<code>CS1961</code>).</td>
      </tr>
      <tr>
        <td>An interface whose <code>T</code> is only accepted</td>
        <td><code>in T</code></td>
        <td>Contravariance: a handler for the base type works wherever one for the derived type is
        wanted.</td>
      </tr>
      <tr>
        <td>A generic method's <code>T</code> appears only in the return type</td>
        <td>Expect to write the type argument</td>
        <td>Inference works from arguments only — <code>CS0411</code> otherwise.</td>
      </tr>
      <tr>
        <td>The body needs to do anything with <code>T</code></td>
        <td>A constraint</td>
        <td>Unconstrained, <code>T</code> supports only what <code>object</code> does. See
        <a href="#/m/t1-18-generic-constraints">Generic Constraints</a>.</td>
      </tr>
      <tr>
        <td>Passing arrays around by a base element type</td>
        <td>Stop; use a read-only interface</td>
        <td>Array covariance is a run-time failure waiting for a store.</td>
      </tr>
      <tr>
        <td>A static counter, cache or registry on a generic type</td>
        <td>Put it on a non-generic type</td>
        <td>Each closed generic type has its own copy, which is almost never what a registry
        wants.</td>
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
    <p>Two million integers are added to each of three collections. Predict the allocation for
    each, and explain why one of the results surprises people.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>var al = new ArrayList(N);        for (int i = 0; i &lt; N; i++) al.Add(i);
var gl = new List&lt;int&gt;(N);        for (int i = 0; i &lt; N; i++) gl.Add(i);
var ol = new List&lt;object&gt;(N);     for (int i = 0; i &lt; N; i++) ol.Add(i);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>ArrayList : 48,000,040 bytes (24 per element)
List&lt;int&gt; : 0 bytes
List&lt;object&gt; : 48,000,904 bytes (generic, and still boxes)</code></pre>
        <p><strong><code>ArrayList</code>: 24 bytes per element.</strong> Each <code>int</code> is
        boxed into a heap object — a 16-byte header plus the 4-byte value, rounded up to the 8-byte
        allocation granularity. The backing array itself was pre-sized, so all 48 MB is boxes.</p>
        <p><strong><code>List&lt;int&gt;</code>: zero.</strong> Pre-sized, and the runtime
        specialised it for <code>int</code>, so the values live directly in one
        <code>int[]</code>. Not "less allocation" — none at all.</p>
        <p><strong><code>List&lt;object&gt;</code>: 48 MB, the same as <code>ArrayList</code>.</strong>
        This is the one that surprises people, because it looks modern. The angle brackets are not
        what removes the boxing; the type argument being a value type is. With
        <code>object</code> as the argument, the runtime uses the shared reference-type code body
        and every <code>int</code> is boxed on the way in, exactly as before generics.</p>
        <p>The practical consequence is that <code>object</code> appearing as a type argument is
        worth treating as a smell. It usually means a type parameter was available and someone
        widened it — often to make one call site compile.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Predict all four outputs. Then say what this proves about closed generic types, and give one
    real bug it causes.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>class Registry&lt;T&gt;
{
    public static readonly List&lt;string&gt; Registered = new();
    public static void Register(string name) =&gt; Registered.Add(name);
}

Registry&lt;int&gt;.Register("a");
Registry&lt;int&gt;.Register("b");
Registry&lt;string&gt;.Register("c");

Console.WriteLine(string.Join(", ", Registry&lt;int&gt;.Registered));
Console.WriteLine(string.Join(", ", Registry&lt;string&gt;.Registered));
Console.WriteLine(string.Join(", ", Registry&lt;object&gt;.Registered));
Console.WriteLine(ReferenceEquals(Registry&lt;int&gt;.Registered, Registry&lt;string&gt;.Registered));</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>Registry&lt;int&gt;.Registered    : [a, b]
Registry&lt;string&gt;.Registered : [c]
Registry&lt;object&gt;.Registered : []
same List instance?         : False</code></pre>
        <p><strong>What it proves.</strong> <code>Registry&lt;int&gt;</code> and
        <code>Registry&lt;string&gt;</code> are <em>different types</em>. They each have their own
        copy of every static field, their own type initialiser, and their own
        <code>Type</code> object. A closed generic type is not a view of a template — it is a type
        in the same sense <code>string</code> is, and everything
        <a href="#/m/t1-14-static-and-lifetime">Static Members, Constructors, and Lifetime</a> said
        about statics applies to each one separately.</p>
        <p>Note <code>Registry&lt;object&gt;</code> is empty and its list still exists — merely
        naming the closed type brought it into being with its own field.</p>
        <p><strong>A real bug it causes.</strong> The plugin-registry pattern:</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a registry that silently splits"><code>// WRONG. Every handler type registers into a DIFFERENT list, so the
// dispatcher that reads Handlers&lt;object&gt;.All finds nothing.
public static class Handlers&lt;T&gt;
{
    public static readonly List&lt;Action&lt;T&gt;&gt; All = new();
    public static void Add(Action&lt;T&gt; h) =&gt; All.Add(h);
}</code></pre>
        <p>Every registration goes into the list belonging to its own closed type, and nothing
        aggregates them. The symptom is a registry that reports zero handlers while the
        registration code demonstrably ran — and it is worse than it looks, because
        <code>Handlers&lt;Dog&gt;.All</code> genuinely does contain the dog handler, so the bug
        appears only when someone tries to enumerate everything.</p>
        <p>The fix is to keep shared state on a <strong>non-generic</strong> type:</p>
<pre data-lang="csharp" data-net="10" data-title="Right: one list, keyed by type"><code>public static class Handlers
{
    private static readonly Dictionary&lt;Type, List&lt;Delegate&gt;&gt; All = new();

    public static void Add&lt;T&gt;(Action&lt;T&gt; handler)
    {
        if (!All.TryGetValue(typeof(T), out var list))
            All[typeof(T)] = list = new List&lt;Delegate&gt;();
        list.Add(handler);
    }

    public static IReadOnlyList&lt;Delegate&gt; For(Type t) =&gt;
        All.TryGetValue(t, out var list) ? list : Array.Empty&lt;Delegate&gt;();

    public static IReadOnlyCollection&lt;Type&gt; RegisteredTypes =&gt; All.Keys;
}</code></pre>
        <p>Worth knowing that the per-instantiation behaviour is occasionally exactly what you
        want — a per-type cache of reflection results is the standard example, because the lookup
        is free and the lifetime is right.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>For each line, say whether it compiles, and why. Then state the rule in one sentence, and say
    what changes if <code>Dog</code> is a struct.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>interface ICovariant&lt;out T&gt;     { T Get(); }
interface IContravariant&lt;in T&gt;  { void Put(T item); }
interface IBoth&lt;T&gt;              { T Get(); void Put(T item); }

ICovariant&lt;Dog&gt;    a = new DogSource();
ICovariant&lt;Animal&gt; b = a;                    // 1

IContravariant&lt;Animal&gt; c = new AnimalSink();
IContravariant&lt;Dog&gt;    d = c;                // 2

List&lt;Dog&gt;    dogs = new();
List&lt;Animal&gt; e = dogs;                       // 3
IEnumerable&lt;Animal&gt; f = dogs;                // 4

IBoth&lt;Dog&gt; g = null!;
IBoth&lt;Animal&gt; h = g;                         // 5</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <div class="table-wrap">
        <table>
          <thead><tr><th>Line</th><th>Compiles</th><th>Why</th></tr></thead>
          <tbody>
            <tr><td>1 <code>ICovariant&lt;Dog&gt; → &lt;Animal&gt;</code></td><td>yes</td>
                <td><code>out T</code>: <code>T</code> only comes out, and every <code>Dog</code>
                produced is an <code>Animal</code>.</td></tr>
            <tr><td>2 <code>IContravariant&lt;Animal&gt; → &lt;Dog&gt;</code></td><td>yes</td>
                <td><code>in T</code>: <code>T</code> only goes in, and something that accepts any
                <code>Animal</code> accepts a <code>Dog</code>.</td></tr>
            <tr><td>3 <code>List&lt;Dog&gt; → List&lt;Animal&gt;</code></td><td><strong>no</strong>,
                CS0029</td>
                <td><code>List&lt;T&gt;</code> is invariant: it has <code>Add</code>, so this would
                allow adding a <code>Cat</code>.</td></tr>
            <tr><td>4 <code>List&lt;Dog&gt; → IEnumerable&lt;Animal&gt;</code></td><td>yes</td>
                <td><code>IEnumerable&lt;out T&gt;</code> is covariant — read-only, so it is
                safe.</td></tr>
            <tr><td>5 <code>IBoth&lt;Dog&gt; → &lt;Animal&gt;</code></td><td><strong>no</strong></td>
                <td><code>T</code> is in both positions, so neither annotation is legal and the
                interface is invariant.</td></tr>
          </tbody>
        </table>
        </div>
        <p>Line 4 is the practically important one: the same <code>List&lt;Dog&gt;</code> object is
        illegal as a <code>List&lt;Animal&gt;</code> and legal as an
        <code>IEnumerable&lt;Animal&gt;</code>. The difference is not the object — it is what the
        target type would let you do with it.</p>
        <p><strong>The rule in one sentence:</strong> a type parameter can be covariant if it only
        ever comes out, contravariant if it only ever goes in, and neither if it does both — because
        variance is safe exactly when the conversion cannot let you put the wrong thing in or take
        the wrong thing out.</p>
        <p><strong>If <code>Dog</code> is a struct, lines 1, 2 and 4 stop compiling</strong> with
        <code>CS0266</code>. A variance conversion is a <em>reference</em> conversion — the same
        pointer viewed at a different type, with no work at run time. A struct would have to be
        boxed, which is real work and a different object, so the conversion is not available at
        all. Value type arguments are always invariant regardless of the annotation.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Array covariance means every array element store carries a type check. Predict what that
    check costs by measuring a store through <code>Dog[]</code>, through the same array typed
    <code>Animal[]</code>, and through <code>List&lt;Dog&gt;</code>. Then say what the result means
    for how you should argue about it.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>Dog[] as Animal[] compiled : True
storing a Cat threw        : ArrayTypeMismatchException

cost of the check every array store pays:
  Dog[] store                       8.5 ms   4.27 ns/store
  Animal[] store (same array)       8.2 ms   4.09 ns/store
  List&lt;Dog&gt; store                   6.6 ms   3.30 ns/store</code></pre>
        <p><strong>The correctness half is exactly as advertised.</strong>
        <code>Dog[]</code> assigns to <code>Animal[]</code> with no complaint from the compiler, and
        storing a <code>Cat</code> throws <code>ArrayTypeMismatchException</code> — a run-time
        failure from a line that only assigns an element, which is the hole generics were designed
        to close.</p>
        <p><strong>The performance half is a null result, and that is the answer.</strong> 4.27,
        4.09 and 3.30 ns per store — the array typed as its base was, if anything, marginally
        faster than the array typed exactly, which cannot be a real effect. The store check is
        either elided or too cheap to separate from the loop at this scale.</p>
        <p>Why: the JIT can often prove the check is unnecessary. In a loop storing a
        <code>Dog</code> into an array it knows holds <code>Dog</code>s, the type check is provably
        redundant and is removed — the same class of optimisation as the devirtualisation in
        <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a>. A loop where the
        stored type genuinely varies would not get that.</p>
        <p><strong>What it means for how you argue.</strong> "Array covariance costs performance" is
        commonly repeated and was not reproducible here. The honest case against array covariance
        is entirely about <em>correctness</em>: it turns a compile-time error into a run-time
        exception, in a language that otherwise catches this class of mistake. That argument does
        not need a benchmark and does not weaken when a benchmark fails to find an effect.</p>
        <p>This is worth generalising. A claim with two justifications — one about correctness and
        one about speed — is weakened, not strengthened, by attaching an unmeasured speed claim to
        it. When the measurement comes back null, as here, the correctness argument is still
        completely intact, and you now know not to repeat the other one.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What two problems does a type parameter solve that <code>object</code> did not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Type safety</strong> — the mistake is caught at the line that made it
        (<code>CS1503</code>) rather than later as an <code>InvalidCastException</code> — and
        <strong>boxing</strong>: 24 bytes per integer and 2.92 ns per read against 0 bytes and 0.83
        ns for <code>List&lt;int&gt;</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Does a generic type always avoid boxing?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. <code>List&lt;object&gt;</code> allocated 48 MB for two million integers — identical
        to <code>ArrayList</code>. What removes boxing is the <strong>type argument being a value
        type</strong>, which lets the runtime specialise the code, not the angle brackets.</p>
      </div></details>
    </li>
    <li>
      <p>How does the runtime compile generic code for value versus reference type arguments?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <strong>separate native body per value type argument</strong>, because sizes and
        layouts differ. <strong>One shared body for all reference type arguments</strong>, because
        every reference is the same size. They remain distinct types either way.</p>
      </div></details>
    </li>
    <li>
      <p>Do <code>Counter&lt;int&gt;</code> and <code>Counter&lt;string&gt;</code> share a static
      field?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No.</strong> Each closed generic type has its own copy of every static field, its
        own type initialiser, and its own <code>Type</code> object. This breaks the
        registry-on-a-generic-type pattern; shared state belongs on a non-generic type.</p>
      </div></details>
    </li>
    <li>
      <p>State the variance rule in one sentence.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A type parameter can be <strong>covariant (<code>out</code>) if it only comes
        out</strong>, <strong>contravariant (<code>in</code>) if it only goes in</strong>, and
        neither if it does both — because the conversion is safe exactly when it cannot let you put
        the wrong thing in or take the wrong thing out.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>List&lt;T&gt;</code> invariant while <code>IEnumerable&lt;T&gt;</code> is
      covariant?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>List&lt;T&gt;</code> has <code>Add</code>, so treating a
        <code>List&lt;Dog&gt;</code> as a <code>List&lt;Animal&gt;</code> would let you add a
        <code>Cat</code>. <code>IEnumerable&lt;T&gt;</code> is read-only, so there is nothing unsafe
        to do — the same <code>List&lt;Dog&gt;</code> object is legal as
        <code>IEnumerable&lt;Animal&gt;</code> and illegal as <code>List&lt;Animal&gt;</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Does variance work for value type arguments?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No</strong> — <code>CS0266</code>. A variance conversion is a <em>reference</em>
        conversion: the same pointer viewed at a different type with no run-time work. A struct
        would have to be boxed, which is real work and a different object. Value type arguments are
        always invariant however the interface is annotated.</p>
      </div></details>
    </li>
    <li>
      <p>What does array covariance let you write, and what does it cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Dog[]</code> assigns to <code>Animal[]</code>, and storing a <code>Cat</code>
        throws <code>ArrayTypeMismatchException</code> at run time. The cost is
        <strong>correctness</strong>, not speed — the store check measured at 4.27 vs 4.09 ns, a
        null result, because the JIT elides it when it can prove the type.</p>
      </div></details>
    </li>
    <li>
      <p>What can an unconstrained <code>T</code> do?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Only what <code>object</code> can. No operators (<code>CS0019</code> for
        <code>a + b</code>), no <code>new T()</code>, no members of your own. Everything else must
        be granted by a constraint — <a href="#/m/t1-18-generic-constraints">Generic
        Constraints</a>.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>var x = Make();</code> fail for <code>static T Make&lt;T&gt;()</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>CS0411</code>: type inference works from <strong>arguments only</strong>, never
        from the return type or the variable being assigned to. Write
        <code>Make&lt;Order&gt;()</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>default(T)</code> produce?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Whatever the zero value of the actual type argument is: <code>0</code> for numbers,
        <code>false</code> for <code>bool</code>, <code>null</code> for reference types, and an
        all-fields-zeroed value for other structs — including one no constructor produced, as
        <a href="#/m/t1-15-structs-and-records">Structs, Records, readonly, and init</a>
        covered.</p>
      </div></details>
    </li>
    <li>
      <p>What is the one-line summary of why the type argument matters to memory?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>The type argument decides the memory layout.</strong>
        <code>List&lt;decimal&gt;</code> is one array of values;
        <code>List&lt;object&gt;</code> holding decimals is an array of pointers to millions of
        separate objects — each one something the garbage collector must trace.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
