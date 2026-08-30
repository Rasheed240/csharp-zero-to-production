/* ============================================================================
   Track 1, Module 18 — Generic Constraints
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-18-generic-constraints/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-18-generic-constraints",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "An unconstrained type parameter can do only what object can. A constraint is the complete " +
    "list of everything a generic body is allowed to assume, checked once at the declaration " +
    "rather than at every call. Two of them have costs worth knowing: new() is not free, and a " +
    "struct constraint's real win is removing an allocation rather than saving time.",
  terms: [
    "constraint", "where clause", "struct constraint",
    "notnull", "unmanaged", "interface constraint",
    "static abstract member", "INumber",
    "constraint order", "Activator.CreateInstance", "constrained call",
    "boxing", "CS0304", "CS0310", "CS0315", "CS8714"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>You write a generic method to add two values and it does not compile. The error says the
  <code>+</code> operator cannot be applied to <code>T</code> and <code>T</code>, which is
  surprising, because every type you intend to use it with supports <code>+</code>.</p>

  <p>You write a generic repository that needs to read <code>entity.Id</code>. The compiler says
  <code>T</code> has no member called <code>Id</code>. Every type you plan to pass has one.</p>

  <p>You write a factory that returns <code>new T()</code>. That does not compile either.</p>

  <p>In each case the compiler is refusing something that would work for every type you have in
  mind — and it is right to, because it is compiling the method <em>once</em>, for every type
  anyone will ever supply, including ones that do not exist yet.
  <a href="#/m/t1-17-generics">Generics</a> ended by saying an unconstrained <code>T</code> can do
  only what <code>object</code> can. This module is about how you grant it more, and what each
  grant costs.</p>
</section>

<section id="what-a-constraint-is">
  <h2>What a constraint actually is</h2>

  <p class="define"><span class="define__term">Constraint</span> A promise about a type parameter,
  written after the signature with <code>where</code>. It is checked in two places: the compiler
  refuses a call whose type argument does not satisfy it, and the compiler allows the body to use
  whatever the constraint guarantees.</p>

  <p class="define"><span class="define__term">where clause</span> The syntax that attaches a
  constraint: <code>where T : IEntity</code>, written after the parameter list and before the
  method body. One clause per type parameter, and a parameter may carry several constraints
  separated by commas.</p>

  <p>The important word is <em>both</em>. A constraint is not a restriction you accept in order to
  be safe; it is a trade. Every capability the body gains is a capability callers must now
  provide.</p>

  <p>The analogy: a constraint is the requirements line in a job advert. It narrows who can apply
  and it is exactly what the role is allowed to assume about whoever arrives.
  <strong>The analogy's limit is that a job advert can be worked around and a constraint cannot
  be.</strong> There is no equivalent of "we will train you" — if the constraint does not grant a
  capability, the body cannot use it at all, however obvious it is that every real caller would
  have it.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-what-each-unlocks.cs"><code>// 01-what-each-unlocks.cs — every constraint, and the exact capability each one
// grants inside the method body.
// .NET 10.0.400. Run: dotnet run 01-what-each-unlocks.cs

using System;
using System.Collections.Generic;
using System.Numerics;
using System.Runtime.InteropServices;

interface IEntity { string Id { get; } }
sealed class Customer : IEntity { public string Id =&gt; "C-1"; public override string ToString() =&gt; "Customer"; }
sealed class Widget { public override string ToString() =&gt; "Widget"; }

static class Demos
{
    // No constraint: T can do only what object can.
    public static string Unconstrained&lt;T&gt;(T value) =&gt; value?.ToString() ?? "null";

    // class: T is a reference type. Enables null comparison and null literal.
    public static string RequiresClass&lt;T&gt;(T? value) where T : class =&gt;
        value is null ? "was null" : value.ToString()!;

    // struct: T is a non-nullable value type. Enables T? meaning Nullable&lt;T&gt;.
    public static string RequiresStruct&lt;T&gt;(T? value) where T : struct =&gt;
        value.HasValue ? $"has {value.Value}" : "no value";

    // notnull: T is not a nullable type. Required by Dictionary's TKey.
    public static Dictionary&lt;T, int&gt; RequiresNotNull&lt;T&gt;() where T : notnull =&gt; new();

    // new(): T has a public parameterless constructor. Enables new T().
    public static T RequiresNew&lt;T&gt;() where T : new() =&gt; new T();

    // an interface constraint: T has that interface's members.
    public static string RequiresInterface&lt;T&gt;(T value) where T : IEntity =&gt; value.Id;

    // a base class constraint: T has that class's members.
    public static string RequiresBase&lt;T&gt;(T value) where T : Exception =&gt; value.Message;

    // unmanaged: T contains no references, so it can be used with sizeof and Span.
    public static int SizeOf&lt;T&gt;() where T : unmanaged =&gt; Marshal.SizeOf&lt;T&gt;();

    // Multiple constraints, in the required order: class/struct, base, interfaces, new().
    public static T Build&lt;T&gt;(string _) where T : class, IEntity, new() =&gt; new T();

    // static abstract members: a requirement on the TYPE, not the instance.
    public static T Sum&lt;T&gt;(params T[] values) where T : INumber&lt;T&gt;
    {
        T total = T.Zero;
        foreach (var v in values) total += v;
        return total;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- what each constraint grants ---");
        Console.WriteLine($"  Unconstrained(42)          : {Demos.Unconstrained(42)}");
        Console.WriteLine($"  RequiresClass&lt;string&gt;(null): {Demos.RequiresClass&lt;string&gt;(null)}");
        Console.WriteLine($"  RequiresStruct&lt;int&gt;(null)  : {Demos.RequiresStruct&lt;int&gt;(null)}");
        Console.WriteLine($"  RequiresStruct&lt;int&gt;(7)     : {Demos.RequiresStruct&lt;int&gt;(7)}");
        Console.WriteLine($"  RequiresNew&lt;Widget&gt;()      : {Demos.RequiresNew&lt;Widget&gt;()}");
        Console.WriteLine($"  RequiresInterface(Customer): {Demos.RequiresInterface(new Customer())}");
        Console.WriteLine($"  RequiresBase(exception)    : " +
                          $"{Demos.RequiresBase(new InvalidOperationException("boom"))}");
        Console.WriteLine($"  SizeOf&lt;int&gt;()              : {Demos.SizeOf&lt;int&gt;()} bytes");
        Console.WriteLine($"  SizeOf&lt;Guid&gt;()             : {Demos.SizeOf&lt;Guid&gt;()} bytes");
        Console.WriteLine($"  Build&lt;Customer&gt;()          : {Demos.Build&lt;Customer&gt;("x")}");

        Console.WriteLine();
        Console.WriteLine("--- static abstract members via INumber&lt;T&gt; ---");
        Console.WriteLine($"  Sum(1, 2, 3)               : {Demos.Sum(1, 2, 3)}");
        Console.WriteLine($"  Sum(1.5, 2.25)             : {Demos.Sum(1.5, 2.25)}");
        Console.WriteLine($"  Sum(10.00m, 5.50m)         : {Demos.Sum(10.00m, 5.50m)}");

        Console.WriteLine();
        Console.WriteLine("--- what T? means depends on the constraint ---");
        Console.WriteLine("  where T : class   -&gt;  T? is a nullable REFERENCE (a warning-level idea)");
        Console.WriteLine("  where T : struct  -&gt;  T? is Nullable&lt;T&gt; (a real, different type)");
        Console.WriteLine($"  typeof(int?)   : {typeof(int?).Name}");
        Console.WriteLine("  typeof(string?) does not even compile — CS8639 — because there is");
        Console.WriteLine("  no such runtime type. Nullable reference types are annotations.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- what each constraint grants ---
  Unconstrained(42)          : 42
  RequiresClass&lt;string&gt;(null): was null
  RequiresStruct&lt;int&gt;(null)  : no value
  RequiresStruct&lt;int&gt;(7)     : has 7
  RequiresNew&lt;Widget&gt;()      : Widget
  RequiresInterface(Customer): C-1
  RequiresBase(exception)    : boom
  SizeOf&lt;int&gt;()              : 4 bytes
  SizeOf&lt;Guid&gt;()             : 16 bytes
  Build&lt;Customer&gt;()          : Customer

--- static abstract members via INumber&lt;T&gt; ---
  Sum(1, 2, 3)               : 6
  Sum(1.5, 2.25)             : 3.75
  Sum(10.00m, 5.50m)         : 15.50

--- what T? means depends on the constraint ---
  where T : class   -&gt;  T? is a nullable REFERENCE (a warning-level idea)
  where T : struct  -&gt;  T? is Nullable&lt;T&gt; (a real, different type)
  typeof(int?)   : Nullable&amp;#96;1
  typeof(string?) does not even compile — CS8639 — because there is
  no such runtime type. Nullable reference types are annotations.</code></pre>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Constraint</th><th>Means</th><th>Grants the body</th></tr></thead>
    <tbody>
      <tr><td>none</td><td>anything</td>
          <td>Only <code>object</code>'s members: <code>ToString</code>, <code>Equals</code>,
          <code>GetHashCode</code>, <code>GetType</code>.</td></tr>
      <tr><td><code>class</code></td><td>a reference type</td>
          <td>Comparison with <code>null</code>, assignment of <code>null</code>, and
          <code>T?</code> meaning a nullable reference.</td></tr>
      <tr><td><code>struct</code></td><td>a non-nullable value type</td>
          <td><code>T?</code> meaning <code>Nullable&lt;T&gt;</code>, and calls that do not
          box.</td></tr>
      <tr><td><code>notnull</code></td><td>not a nullable type</td>
          <td>Use as a <code>Dictionary</code> key. Enforced at <em>warning</em> level.</td></tr>
      <tr><td><code>unmanaged</code></td><td>a value type containing no references</td>
          <td><code>sizeof</code>, pointers, <code>Span&lt;T&gt;</code> over raw memory,
          interop.</td></tr>
      <tr><td><code>new()</code></td><td>has a public parameterless constructor</td>
          <td><code>new T()</code>.</td></tr>
      <tr><td><code>SomeInterface</code></td><td>implements it</td>
          <td>That interface's members — including <code>static abstract</code> ones.</td></tr>
      <tr><td><code>SomeBaseClass</code></td><td>derives from it</td>
          <td>That class's accessible members.</td></tr>
      <tr><td><code>U</code> (another parameter)</td><td>convertible to <code>U</code></td>
          <td>Whatever <code>U</code> guarantees.</td></tr>
    </tbody>
  </table>
  </div>

  <p class="define"><span class="define__term">Constraint order</span> When several are combined
  the order is fixed: <code>class</code> or <code>struct</code> first, then a base class, then
  interfaces, then <code>new()</code> last. Getting it wrong is <code>CS0401</code> or
  <code>CS0449</code> — a syntax rule rather than a semantic one, and worth knowing so the error
  is recognisable.</p>

  <div class="callout callout--gotcha">
    <p><strong><code>T?</code> means two different things.</strong> Under
    <code>where T : struct</code> it is <code>Nullable&lt;T&gt;</code> — a real, distinct runtime
    type, as <code>typeof(int?)</code> printing <code>Nullable&#96;1</code> shows. Under
    <code>where T : class</code> it is a nullable <em>annotation</em> on the same type;
    <code>typeof(string?)</code> does not compile at all (<code>CS8639</code>) because no such
    runtime type exists. The nullable value types from
    <a href="#/m/t1-02-variables-and-types">Variables, Types, and Type Inference</a> and nullable
    reference types are different mechanisms sharing one piece of syntax.</p>
  </div>
</section>

<section id="static-abstract">
  <h2>The constraint that made operators possible</h2>

  <p>The first failure at the top of this module — <code>a + b</code> not compiling for
  <code>T</code> — had no good answer for twenty years. The base class library's response was one
  overload of <code>Math.Max</code> per numeric type, because there was no way to say "T supports
  <code>+</code>".</p>

  <p class="define"><span class="define__term">Static abstract member</span> An interface
  requirement on the <em>type</em> rather than on instances, introduced in
  <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and
  Interfaces</a>. Operators are static members, so an interface can require them — and a constraint
  can therefore grant them.</p>

  <p class="define"><span class="define__term">INumber&lt;T&gt;</span> The interface in
  <code>System.Numerics</code> that every numeric type implements, requiring the arithmetic
  operators, <code>Zero</code>, <code>One</code>, comparison, and parsing. Constraining to it makes
  a single generic method work over <code>int</code>, <code>double</code>,
  <code>decimal</code>, <code>long</code>, <code>byte</code> and any numeric type someone defines
  later.</p>

  <p>The output above shows one <code>Sum&lt;T&gt;</code> handling <code>int</code>,
  <code>double</code> and <code>decimal</code>, each with that type's own arithmetic — and each
  specialised by the JIT, so there is no boxing and no indirection.</p>
</section>

<section id="what-it-costs">
  <h2>What two of the constraints cost</h2>

  <p>Most constraints are free: they are compile-time promises that produce no code. Two have a
  runtime story, and in both cases it is not the one people expect.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-what-constraints-cost.cs"><code>// 02-what-constraints-cost.cs — the new() constraint and the interface
// constraint both have a performance story, and only one of them is the one
// people expect.
// .NET 10.0.400, Release. Run: dotnet run 02-what-constraints-cost.cs -c Release

// IL2087 is about trimming analysis of Activator.CreateInstance, which is the
// comparison being made here rather than a defect.
#:property NoWarn=IL2087

using System;
using System.Diagnostics;

sealed class Item { public int Value = 1; }

interface IShape { double Area(); }

// A struct implementing an interface. Calling through the interface without a
// constraint boxes; with a struct constraint the JIT can call directly.
readonly struct Square : IShape
{
    private readonly double _side;
    public Square(double side) =&gt; _side = side;
    public double Area() =&gt; _side * _side;
}

class Program
{
    const int N = 10_000_000;

    // Three ways to create a T.
    static T ViaConstraint&lt;T&gt;() where T : new() =&gt; new T();
    static T ViaActivator&lt;T&gt;() =&gt; (T)Activator.CreateInstance(typeof(T))!;
    static T ViaFactory&lt;T&gt;(Func&lt;T&gt; make) =&gt; make();

    // Calling an interface member: unconstrained (boxes) vs struct-constrained.
    static double SumBoxed(IShape shape)
    {
        double total = 0;
        for (int i = 0; i &lt; N; i++) total += shape.Area();
        return total;
    }

    static double SumConstrained&lt;T&gt;(T shape) where T : struct, IShape
    {
        double total = 0;
        for (int i = 0; i &lt; N; i++) total += shape.Area();
        return total;
    }

    static void Time(string label, Func&lt;double&gt; body, int n)
    {
        body();
        double best = double.MaxValue;
        for (int r = 0; r &lt; 5; r++)
        {
            var sw = Stopwatch.StartNew();
            double v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-34} {best,7:F1} ms   {best * 1e6 / n,5:F2} ns/op");
    }

    static void Main()
    {
        const int Creations = 2_000_000;

        Console.WriteLine($"--- creating {Creations:N0} objects three ways ---");
        Time("new T() via new() constraint", () =&gt;
        {
            double n = 0;
            for (int i = 0; i &lt; Creations; i++) n += ViaConstraint&lt;Item&gt;().Value + 1;
            return n;
        }, Creations);

        Time("Activator.CreateInstance", () =&gt;
        {
            double n = 0;
            for (int i = 0; i &lt; Creations; i++) n += ViaActivator&lt;Item&gt;().Value + 1;
            return n;
        }, Creations);

        Time("Func&lt;T&gt; factory parameter", () =&gt;
        {
            double n = 0;
            for (int i = 0; i &lt; Creations; i++) n += ViaFactory(() =&gt; new Item()).Value + 1;
            return n;
        }, Creations);

        Console.WriteLine();
        Console.WriteLine($"--- calling an interface member {N:N0} times on a struct ---");
        var square = new Square(3);
        Time("through IShape (boxed)", () =&gt; SumBoxed(square), N);
        Time("where T : struct, IShape", () =&gt; SumConstrained(square), N);

        Console.WriteLine();
        Console.WriteLine("--- allocation ---");
        long before = GC.GetTotalAllocatedBytes(true);
        SumBoxedOnce(square);
        Console.WriteLine($"  one boxed call allocated      : {GC.GetTotalAllocatedBytes(true) - before} bytes");
        before = GC.GetTotalAllocatedBytes(true);
        SumConstrainedOnce(square);
        Console.WriteLine($"  one constrained call allocated: {GC.GetTotalAllocatedBytes(true) - before} bytes");
    }

    static double SumBoxedOnce(IShape s) =&gt; s.Area();
    static double SumConstrainedOnce&lt;T&gt;(T s) where T : struct, IShape =&gt; s.Area();
}</code></pre>

  <p>Two samples:</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Operation</th><th>Sample 1</th><th>Sample 2</th><th>Allocation</th></tr></thead>
    <tbody>
      <tr><td><code>new T()</code> via <code>new()</code> constraint</td>
          <td>24.80 ns</td><td>23.61 ns</td><td>—</td></tr>
      <tr><td><code>Activator.CreateInstance</code></td>
          <td>23.01 ns</td><td>22.35 ns</td><td>—</td></tr>
      <tr><td><code>Func&lt;T&gt;</code> factory parameter</td>
          <td><strong>14.14 ns</strong></td><td><strong>13.97 ns</strong></td><td>—</td></tr>
      <tr><td>interface call on a struct, boxed</td>
          <td>2.67 ns</td><td>2.67 ns</td><td><strong>24 bytes</strong></td></tr>
      <tr><td><code>where T : struct, IShape</code></td>
          <td>2.49 ns</td><td>2.26 ns</td><td><strong>0 bytes</strong></td></tr>
    </tbody>
  </table>
  </div>

  <p><strong><code>new()</code> is not free, and is not faster than reflection.</strong> Creating
  two million objects through the <code>new()</code> constraint took about the same time as
  <code>Activator.CreateInstance</code> — because for a reference type argument that is
  essentially what it compiles to. A <code>Func&lt;T&gt;</code> factory passed as a parameter was
  <strong>about 40% faster</strong> than either, because it is a direct delegate call to a real
  <code>new Item()</code>.</p>

  <p>So the <code>new()</code> constraint is a convenience, not an optimisation. On a path that
  creates objects in bulk, taking a factory delegate is both faster and more flexible — it can
  supply constructor arguments, which <code>new()</code> cannot.</p>

  <p><strong>The struct constraint's real win is allocation, not time.</strong> The two timings are
  close and their ordering is not stable across runs — 2.67 against 2.49 and 2.26 ns. The
  allocation figures are exact and reproducible: <strong>24 bytes per call boxed, zero
  constrained</strong>.</p>

  <p class="define"><span class="define__term">Constrained call</span> What the compiler emits when
  a struct-constrained type parameter's interface member is called: an instruction telling the
  runtime to call the value type's own implementation directly, with no box. Without the
  constraint, the struct must be boxed to be seen as the interface at all.</p>

  <p>In a loop over ten million shapes that is 240 MB of garbage against none — the same shape of
  finding as the boxing measurement in <a href="#/m/t1-17-generics">Generics</a>. Quote the
  allocation, not the nanoseconds.</p>
</section>

<section id="production-example">
  <h2>Constraints doing real work</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>// 04-production.cs — constraints doing real work: a repository that can build
// and identify its entities, and a generic aggregator over any number type.
// .NET 10.0.400. Run: dotnet run 04-production.cs

using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;

public interface IEntity&lt;TId&gt; where TId : notnull
{
    TId Id { get; }
}

public interface IValidatable
{
    IReadOnlyList&lt;string&gt; Validate();
}

public sealed class Customer : IEntity&lt;string&gt;, IValidatable
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public int Age { get; init; }

    public IReadOnlyList&lt;string&gt; Validate()
    {
        var errors = new List&lt;string&gt;();
        if (string.IsNullOrWhiteSpace(Id)) errors.Add("Id is required");
        if (string.IsNullOrWhiteSpace(Name)) errors.Add("Name is required");
        if (Age is &lt; 0 or &gt; 130) errors.Add($"Age {Age} is out of range");
        return errors;
    }

    public override string ToString() =&gt; $"{Id}:{Name}({Age})";
}

// TEntity must be an entity, must be validatable, and must be constructible —
// three constraints, each unlocking one line of the body.
public sealed class Repository&lt;TEntity, TId&gt;
    where TEntity : class, IEntity&lt;TId&gt;, IValidatable, new()
    where TId : notnull
{
    private readonly Dictionary&lt;TId, TEntity&gt; _byId = new();

    public IReadOnlyCollection&lt;TEntity&gt; All =&gt; _byId.Values;

    public IReadOnlyList&lt;string&gt; Save(TEntity entity)
    {
        var errors = entity.Validate();              // IValidatable
        if (errors.Count == 0) _byId[entity.Id] = entity;   // IEntity&lt;TId&gt;, notnull
        return errors;
    }

    public TEntity? Find(TId id) =&gt; _byId.GetValueOrDefault(id);

    // new() lets the repository produce a blank instance for callers that
    // want a template to fill in.
    public TEntity Blank() =&gt; new TEntity();
}

// A statistics helper over any numeric type, via static abstract members.
public static class Stats
{
    public static T Sum&lt;T&gt;(IEnumerable&lt;T&gt; values) where T : INumber&lt;T&gt;
    {
        T total = T.Zero;
        foreach (var v in values) total += v;
        return total;
    }

    public static T Mean&lt;T&gt;(IReadOnlyCollection&lt;T&gt; values) where T : INumber&lt;T&gt; =&gt;
        values.Count == 0 ? T.Zero : Sum(values) / T.CreateChecked(values.Count);

    public static T Max&lt;T&gt;(IEnumerable&lt;T&gt; values) where T : INumber&lt;T&gt;, IMinMaxValue&lt;T&gt;
    {
        T best = T.MinValue;
        foreach (var v in values) if (v &gt; best) best = v;
        return best;
    }
}

class Program
{
    static void Main()
    {
        var repo = new Repository&lt;Customer, string&gt;();

        Console.WriteLine("--- constrained repository ---");
        foreach (var c in new[]
        {
            new Customer { Id = "C-1", Name = "Ada", Age = 36 },
            new Customer { Id = "C-2", Name = "", Age = 200 },
            new Customer { Id = "C-3", Name = "Grace", Age = 45 }
        })
        {
            var errors = repo.Save(c);
            Console.WriteLine(errors.Count == 0
                ? $"  saved   {c}"
                : $"  refused {c}: {string.Join("; ", errors)}");
        }

        Console.WriteLine($"  stored : {string.Join(", ", repo.All)}");
        Console.WriteLine($"  Find(\"C-1\") : {repo.Find("C-1")}");
        Console.WriteLine($"  Find(\"C-9\") : {repo.Find("C-9")?.ToString() ?? "null"}");
        Console.WriteLine($"  Blank()     : '{repo.Blank()}'");

        Console.WriteLine();
        Console.WriteLine("--- one statistics helper, four numeric types ---");
        Console.WriteLine($"  Sum(int)      : {Stats.Sum(new[] { 1, 2, 3, 4 })}");
        Console.WriteLine($"  Sum(double)   : {Stats.Sum(new[] { 1.5, 2.25 })}");
        Console.WriteLine($"  Sum(decimal)  : {Stats.Sum(new[] { 10.00m, 5.50m })}");
        Console.WriteLine($"  Sum(long)     : {Stats.Sum(new[] { 5_000_000_000L, 1L })}");
        Console.WriteLine($"  Mean(int)     : {Stats.Mean(new[] { 2, 4, 6, 9 })}   (integer division)");
        Console.WriteLine($"  Mean(double)  : {Stats.Mean(new[] { 2.0, 4.0, 6.0, 9.0 })}");
        Console.WriteLine($"  Max(int)      : {Stats.Max(new[] { 3, 17, 8 })}");
        Console.WriteLine($"  Max(byte)     : {Stats.Max(new byte[] { 3, 17, 8 })}");

        Console.WriteLine();
        Console.WriteLine("  Before C# 11 this needed one overload per numeric type. The");
        Console.WriteLine("  operators come from the INumber&lt;T&gt; constraint, and the JIT still");
        Console.WriteLine("  specialises the method for each value type.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- constrained repository ---
  saved   C-1:Ada(36)
  refused C-2:(200): Name is required; Age 200 is out of range
  saved   C-3:Grace(45)
  stored : C-1:Ada(36), C-3:Grace(45)
  Find("C-1") : C-1:Ada(36)
  Find("C-9") : null
  Blank()     : ':(0)'

--- one statistics helper, four numeric types ---
  Sum(int)      : 10
  Sum(double)   : 3.75
  Sum(decimal)  : 15.50
  Sum(long)     : 5000000001
  Mean(int)     : 5   (integer division)
  Mean(double)  : 5.25
  Max(int)      : 17
  Max(byte)     : 17

  Before C# 11 this needed one overload per numeric type. The
  operators come from the INumber&lt;T&gt; constraint, and the JIT still
  specialises the method for each value type.</code></pre>

  <p>Read the repository's constraints as a specification: <code>where TEntity : class,
  IEntity&lt;TId&gt;, IValidatable, new()</code>. Each clause is used exactly once in the body.</p>

  <ul>
    <li><code>IValidatable</code> lets <code>Save</code> call <code>entity.Validate()</code>.</li>
    <li><code>IEntity&lt;TId&gt;</code> lets it read <code>entity.Id</code>.</li>
    <li><code>where TId : notnull</code> lets <code>TId</code> be a
    <code>Dictionary</code> key.</li>
    <li><code>new()</code> lets <code>Blank()</code> exist.</li>
    <li><code>class</code> lets <code>Find</code> return <code>TEntity?</code> meaning "possibly
    absent".</li>
  </ul>

  <p><strong>That list is also the documentation.</strong> A reader who never opens the body knows
  what this repository requires and, by implication, what it does with what it is given.</p>

  <p>Note <code>Max&lt;T&gt;</code> needs <em>two</em> interface constraints —
  <code>INumber&lt;T&gt;</code> for comparison and <code>IMinMaxValue&lt;T&gt;</code> for
  <code>T.MinValue</code>. Needing a second constraint for one line of the body is normal, and is
  the mechanism working: the seed value has to come from somewhere, and the compiler will not let
  you assume it exists.</p>

  <div class="callout callout--gotcha">
    <p><strong><code>Blank()</code> returned <code>':(0)'</code>.</strong> A <code>new()</code>
    constraint gives you a default-constructed instance, which for this type means empty strings
    and a zero age — an object that <code>Validate</code> would reject. That is the same warning as
    <code>default(T)</code> in
    <a href="#/m/t1-15-structs-and-records">Structs, Records, readonly, and init</a>:
    <code>new()</code> guarantees a constructor exists, never that what it produces is valid.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <p>The diagnostics, verified. Four of these appear only when isolated, because an earlier error
  suppresses later analysis.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Mistake</th><th>Diagnostic</th></tr></thead>
    <tbody>
      <tr><td>Using a member on an unconstrained <code>T</code></td>
          <td><code>CS1061</code>: 'T' does not contain a definition for 'Id'</td></tr>
      <tr><td><code>new T()</code> without <code>new()</code></td>
          <td><code>CS0304</code>: cannot create an instance of the variable type 'T'</td></tr>
      <tr><td>Passing a type with no parameterless constructor</td>
          <td><code>CS0310</code>: must be a non-abstract type with a public parameterless
          constructor</td></tr>
      <tr><td>Passing a type that does not implement the interface</td>
          <td><code>CS0315</code>: there is no boxing conversion from 'int' to 'IEntity'</td></tr>
      <tr><td><code>new()</code> not last</td>
          <td><code>CS0401</code>: the new() constraint must be the last restrictive
          constraint</td></tr>
      <tr><td>Combining <code>struct</code> and <code>class</code></td>
          <td><code>CS0449</code>: these constraints cannot be combined or duplicated</td></tr>
      <tr><td>Unconstrained <code>T</code> as a <code>Dictionary</code> key</td>
          <td><code>CS8714</code> — a <strong>warning</strong>, and only with nullable
          enabled</td></tr>
    </tbody>
  </table>
  </div>

  <h3>1. Constraining more than the body needs</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: constraints the body never uses"><code>// WRONG. The body only reads Id, so the other three constraints exclude
// callers for no benefit — a struct entity, one without a parameterless
// constructor, or one that validates elsewhere are all now unusable.
public static string Describe&lt;T&gt;(T entity)
    where T : class, IEntity, IValidatable, new()
    =&gt; entity.Id;

// Right: ask for exactly what the body uses.
public static string Describe&lt;T&gt;(T entity) where T : IEntity =&gt; entity.Id;</code></pre>

  <p>A constraint is a requirement on every present and future caller. Adding one that the body
  does not use is a breaking change with no compensation, and narrowing a published constraint
  later is the same kind of problem as adding an interface member in
  <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and
  Interfaces</a>.</p>

  <h3>2. Reaching for <code>new()</code> when a factory is wanted</h3>

  <p>Measured 40% slower than a <code>Func&lt;T&gt;</code> parameter, and it cannot pass
  constructor arguments, so the first type that needs one forces a redesign. It also silently
  requires every implementer to keep a parameterless constructor forever.</p>

  <h3>3. Forgetting the struct constraint on a hot path</h3>

  <p>A struct passed as an interface is boxed — 24 bytes per call, measured. Adding
  <code>where T : struct, IShape</code> and taking <code>T</code> rather than the interface removes
  the allocation entirely. The timings barely move; the garbage does.</p>

  <h3>4. Expecting <code>notnull</code> to be enforced</h3>

  <p><code>CS8714</code> is a <strong>warning</strong>, and appears only when the nullable context
  is enabled. It is not a guarantee that a null key cannot arrive — it is an annotation, in the
  same family as nullable reference types generally.</p>

  <h3>5. Assuming <code>new()</code> means valid</h3>

  <p><code>Blank()</code> above produced an object <code>Validate</code> would reject. The
  constraint guarantees a constructor exists, not that its result is meaningful.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>The body will not compile and every real caller would work.</strong> That is the
    correct behaviour: the method is compiled once for all possible <code>T</code>. Read the error
    to find the missing capability — <code>CS1061</code> means a member, <code>CS0304</code> means
    construction, <code>CS0019</code> means an operator — and add the narrowest constraint that
    grants it. If no interface exists for the capability, that is a signal the design wants a
    delegate parameter instead.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A caller cannot satisfy your constraint.</strong> <code>CS0310</code> and
    <code>CS0315</code> name the type argument and the constraint it failed. Before adding a
    parameterless constructor or an interface to their type, check whether the body actually needs
    that constraint — over-constraining is the more common cause. Delete each constraint in turn and
    see which ones the body still compiles without.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Unexplained allocation in a generic method taking an interface.</strong> If the
    argument is a struct it is being boxed on every call — 24 bytes, invisible in the source.
    Confirm with <code>GC.GetTotalAllocatedBytes(precise: true)</code> around a single call, as
    this module does. The fix is to take <code>T</code> with
    <code>where T : struct, IThatInterface</code> rather than taking the interface.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Object creation is slower than expected in a generic factory.</strong>
    <code>new T()</code> under a <code>new()</code> constraint is not a plain constructor call —
    measured at about the same cost as <code>Activator.CreateInstance</code>, and 40% slower than a
    <code>Func&lt;T&gt;</code>. If the profile shows time in
    <code>Activator</code> or <code>RuntimeType.CreateInstance</code> for code that never mentions
    reflection, this is why.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Reading an unfamiliar generic signature.</strong> The <code>where</code> clauses are
    the complete list of what the body may assume, so they are the fastest summary of what the
    method does. Match each constraint to the line that uses it; any constraint you cannot match is
    either dead weight or a clue that the body does something you have not spotted.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>A concrete case.</strong> A geometry service processed roughly 1.2 million shape
    records per batch, computing areas through a generic pipeline. The shapes were
    <code>readonly struct</code> types — deliberately, to avoid allocation — and the pipeline stage
    was declared <code>double Total(IEnumerable&lt;IShape&gt; shapes)</code>.</p>
    <p>Every shape was boxed to be seen as <code>IShape</code>: 24 bytes each, 1.2 million times per
    batch, about <strong>29 MB of garbage per batch</strong> and a batch every few seconds. Gen0
    collections ran constantly and gen1 promotion pushed a steady trickle into gen2. The team had
    chosen structs precisely to avoid this and were getting the allocation anyway.</p>
    <p>What made it hard to see is that the source contains no cast and no <code>new</code>. The
    boxing happens at the point a struct is assigned to an interface-typed variable, which here was
    the <code>IEnumerable&lt;IShape&gt;</code> parameter — one word in a signature, in a different
    file from the loop that pays for it.</p>
    <p>The change was to make the stage generic and constrain it:
    <code>double Total&lt;T&gt;(IEnumerable&lt;T&gt; shapes) where T : struct, IShape</code>. The
    JIT then specialises the method per shape type and emits a constrained call, so the interface
    member runs directly on the value. Allocation per batch went from about 29 MB to zero, gen0
    collections dropped by roughly 90%, and batch wall-clock improved about 15% — almost all of it
    from not collecting.</p>
    <p>The timing measurement in this module explains why the improvement was 15% rather than
    dramatic: the call itself was only 2.67 ns against 2.49. The gain was the garbage that stopped
    being produced, not the calls getting faster.</p>
  </div>

  <p>The general principle: <strong>a constraint is where the compiler's knowledge and the JIT's
  knowledge meet.</strong> Telling the compiler <code>T</code> is a struct does not only permit
  more syntax — it lets the runtime generate code specialised to that type, which is what removes
  the boxing. The same declaration that makes the code compile makes it allocate nothing.</p>

  <p>That is why the practical advice is narrower than "add constraints for safety". Constrain to
  exactly what the body uses, and reach for <code>where T : struct</code> specifically when a value
  type would otherwise be seen through an interface — because that is the one constraint whose
  absence costs memory rather than expressiveness.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"More constraints means safer code."</strong> A constraint is a requirement on every
    caller, present and future. One the body does not use excludes valid callers for nothing, and
    tightening a published constraint later breaks them. Constrain to exactly what the body
    uses.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>new()</code> is the fast way to create a <code>T</code>."</strong> Measured at
    about the same cost as <code>Activator.CreateInstance</code> — roughly what it compiles to for
    a reference type argument — and about 40% slower than a <code>Func&lt;T&gt;</code> factory
    parameter, which can also pass constructor arguments.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"The struct constraint is a performance optimisation."</strong> It is an
    <em>allocation</em> optimisation. The measured timings were 2.67 ns boxed against 2.49
    constrained, an unstable difference; the allocation was 24 bytes against zero, exactly
    reproducible. Quote the bytes.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>where T : notnull</code> prevents nulls."</strong> It produces
    <code>CS8714</code>, a <strong>warning</strong>, and only when the nullable context is enabled.
    It documents intent and helps analysis; it is not a runtime guarantee.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>T?</code> means the same thing everywhere."</strong> Under
    <code>where T : struct</code> it is <code>Nullable&lt;T&gt;</code>, a real distinct type you can
    write <code>typeof</code> for. Under <code>where T : class</code> it is an annotation on the
    same type, and <code>typeof(string?)</code> does not compile. One piece of syntax, two
    mechanisms.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"You cannot write generic arithmetic in C#."</strong> True until C# 11, and the
    reason the base class library has an overload per numeric type.
    <code>where T : INumber&lt;T&gt;</code> now grants the operators through
    <code>static abstract</code> members, and the JIT still specialises per value type — so it is
    generic and has no dispatch cost.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>The body needs to…</th><th>Constrain with</th><th>Note</th></tr></thead>
    <tbody>
      <tr><td>call a member of your own</td><td>that interface or base class</td>
          <td>The narrowest thing that has the member.</td></tr>
      <tr><td>use arithmetic or comparison operators</td><td><code>INumber&lt;T&gt;</code></td>
          <td>Add <code>IMinMaxValue&lt;T&gt;</code> if you need a seed value.</td></tr>
      <tr><td>compare with <code>null</code></td><td><code>class</code></td>
          <td>Or use <code>is null</code>, which works unconstrained.</td></tr>
      <tr><td>use <code>T?</code> as "value or nothing"</td><td><code>struct</code></td>
          <td>Gives real <code>Nullable&lt;T&gt;</code> semantics.</td></tr>
      <tr><td>use <code>T</code> as a dictionary key</td><td><code>notnull</code></td>
          <td>Warning-level only. Also see
          <a href="#/m/t1-16-equality-and-hashing">Equality, GetHashCode, and Comparers</a>.</td></tr>
      <tr><td>call an interface member on a value type without boxing</td>
          <td><code>struct, IThatInterface</code></td>
          <td>The one constraint whose absence costs 24 bytes per call.</td></tr>
      <tr><td>create instances</td><td>a <code>Func&lt;T&gt;</code> parameter, not
          <code>new()</code></td>
          <td>Faster, and can pass constructor arguments.</td></tr>
      <tr><td>create instances with genuinely no arguments, rarely</td><td><code>new()</code></td>
          <td>Convenient. Must be the last constraint listed.</td></tr>
      <tr><td>work with raw memory, spans or interop</td><td><code>unmanaged</code></td>
          <td>Guarantees no references inside, so <code>sizeof</code> is meaningful.</td></tr>
      <tr><td>nothing in particular</td><td>no constraint</td>
          <td>An unconstrained <code>T</code> is the most reusable thing you can write.</td></tr>
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
    <p>For each method, say whether it compiles and, if not, which constraint would fix it with the
    least restriction on callers.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>interface IEntity { string Id { get; } }

static string A&lt;T&gt;(T v) =&gt; v.ToString()!;          // 1
static string B&lt;T&gt;(T v) =&gt; v.Id;                   // 2
static T      C&lt;T&gt;()    =&gt; new T();                // 3
static T      D&lt;T&gt;(T a, T b) =&gt; a + b;             // 4
static bool   E&lt;T&gt;(T v) =&gt; v is null;              // 5
static Dictionary&lt;T, int&gt; F&lt;T&gt;() =&gt; new();         // 6</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <div class="table-wrap">
        <table>
          <thead><tr><th></th><th>Compiles</th><th>Diagnostic</th><th>Narrowest fix</th></tr></thead>
          <tbody>
            <tr><td>1 <code>ToString()</code></td><td><strong>yes</strong></td><td>—</td>
                <td>none — <code>ToString</code> is on <code>object</code></td></tr>
            <tr><td>2 <code>v.Id</code></td><td>no</td><td><code>CS1061</code></td>
                <td><code>where T : IEntity</code></td></tr>
            <tr><td>3 <code>new T()</code></td><td>no</td><td><code>CS0304</code></td>
                <td><code>where T : new()</code></td></tr>
            <tr><td>4 <code>a + b</code></td><td>no</td><td><code>CS0019</code></td>
                <td><code>where T : INumber&lt;T&gt;</code></td></tr>
            <tr><td>5 <code>v is null</code></td><td><strong>yes</strong></td><td>—</td>
                <td>none — see below</td></tr>
            <tr><td>6 dictionary key</td><td>yes, with a warning</td><td><code>CS8714</code></td>
                <td><code>where T : notnull</code></td></tr>
          </tbody>
        </table>
        </div>
        <p><strong>Lines 1 and 5 are the interesting ones.</strong> An unconstrained <code>T</code>
        is not useless — it has everything <code>object</code> has, so
        <code>ToString</code>, <code>Equals</code>, <code>GetHashCode</code> and
        <code>GetType</code> are all available.</p>
        <p>Line 5 compiles because <code>is null</code> is a pattern, not the <code>==</code>
        operator, and patterns work on any type — for a value type the answer is always
        <code>false</code>. Writing <code>v == null</code> instead would <em>not</em> compile
        without <code>where T : class</code>, because <code>==</code> needs an operator and an
        unconstrained <code>T</code> has none. That is a genuinely useful distinction: prefer
        <code>is null</code> in generic code and you need one constraint fewer.</p>
        <p>Line 6 is the reminder that <code>notnull</code> is enforced at <strong>warning</strong>
        level, and only when the nullable context is enabled.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Three ways to construct a <code>T</code> in generic code. Predict their relative cost, then
    explain the result and say when each is the right choice.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>static T ViaNew&lt;T&gt;() where T : new() =&gt; new T();
static T ViaActivator&lt;T&gt;() =&gt; (T)Activator.CreateInstance(typeof(T))!;
static T ViaFactory&lt;T&gt;(Func&lt;T&gt; f) =&gt; f();</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>new() constraint                35.9 ms   17.96 ns/op
Activator.CreateInstance        22.4 ms   11.21 ns/op
Func&lt;T&gt; factory                 17.4 ms    8.69 ns/op</code></pre>
        <p><strong>The <code>Func&lt;T&gt;</code> factory is fastest, and <code>new()</code> is
        not faster than reflection.</strong> The main measurement in this module gave 24.80,
        23.01 and 14.14 ns for the same three; this run gave 17.96, 11.21 and 8.69. The absolute
        numbers differ between the two workloads, and the ordering is consistent in one respect
        that matters: <strong>the factory wins and <code>new()</code> never does</strong>. The
        relative position of <code>new()</code> and <code>Activator</code> is not stable, which is
        itself the point — they are the same mechanism.</p>
        <p><strong>Why.</strong> For a reference type argument, the runtime shares one code body
        across all reference types (from <a href="#/m/t1-17-generics">Generics</a>), so
        <code>new T()</code> cannot be compiled to a direct call to a specific constructor — the
        specific type is not known when that body is generated. It resolves the constructor at run
        time, which is what <code>Activator.CreateInstance</code> does. A
        <code>Func&lt;T&gt;</code> holds a delegate to a real <code>new Item()</code> compiled at
        the point the lambda was written, where the type <em>is</em> known.</p>
        <p><strong>When each is right:</strong></p>
        <ul>
          <li><strong><code>Func&lt;T&gt;</code></strong> — the default for anything creating
          objects in bulk, or where the constructor takes arguments. It is faster and strictly more
          flexible.</li>
          <li><strong><code>new()</code></strong> — when creation is rare and the call site would be
          cluttered by passing a factory. A repository's <code>Blank()</code> is a fair use;
          a loop over a million rows is not.</li>
          <li><strong><code>Activator</code></strong> — when the type is genuinely not known until
          run time, from configuration or a plugin scan. Then there is no alternative, and the cost
          is unavoidable.</li>
        </ul>
        <p>The wider lesson: the <code>new()</code> constraint reads like a compile-time guarantee
        that turns into a direct call. It is a compile-time guarantee that turns into a run-time
        lookup, and it also obliges every implementer to keep a parameterless constructor
        forever.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A geometry pipeline uses <code>readonly struct</code> shapes for efficiency and still
    allocates heavily. Find the cause, predict what the two measurements below show, and give the
    fix.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 3 — as given"><code>interface IArea { double Area(); }
readonly struct Circle : IArea
{
    private readonly double _r;
    public Circle(double r) =&gt; _r = r;
    public double Area() =&gt; 3.14159 * _r * _r;
}

static double Total(IEnumerable&lt;IArea&gt; shapes)
{
    double total = 0;
    foreach (var s in shapes) total += s.Area();
    return total;
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>through IArea (boxed)           11.6 ms    1.16 ns/op
where T : struct, IArea         11.9 ms    1.19 ns/op
one boxed call allocated       : 24 bytes
one constrained call allocated : 0 bytes</code></pre>
        <p><strong>The timings are identical and the allocations are not.</strong> That is the whole
        answer, and it is the opposite of what people expect from a constraint described as a
        performance feature.</p>
        <p><strong>The cause.</strong> A struct assigned to an interface-typed variable must be
        boxed — the interface reference has to point at something on the heap. Here the boxing
        happens at the parameter: every element of <code>IEnumerable&lt;IArea&gt;</code> is a boxed
        copy. There is no cast and no <code>new</code> anywhere in the source, which is why it is
        hard to spot: the allocation is caused by a type in a signature, in a different file from
        the loop that pays for it.</p>
        <p><strong>The fix</strong> is to make the method generic and constrain the parameter:</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3 — fixed"><code>static double Total&lt;T&gt;(IEnumerable&lt;T&gt; shapes) where T : struct, IArea
{
    double total = 0;
    foreach (var s in shapes) total += s.Area();
    return total;
}</code></pre>
        <p><code>T</code> is now a specific value type, so the JIT specialises the method for it and
        emits a <strong>constrained call</strong> — the interface member invoked directly on the
        value, with no box. Allocation goes to zero.</p>
        <p><strong>What to quote when arguing for this change.</strong> Not the nanoseconds — 1.16
        against 1.19 is noise, and claiming a speed-up would be wrong. The number is
        <strong>24 bytes per call</strong>. Over 1.2 million shapes per batch that is 29 MB of
        garbage per batch, which is a gen0 collection every few batches and a steady trickle of
        promotion into gen2.</p>
        <p>Note the trade: the fix means the collection must be homogeneous —
        <code>IEnumerable&lt;Circle&gt;</code>, not a mixed list of shapes. If genuinely mixed
        shapes must flow through one call, boxing is unavoidable and the honest answer is to accept
        it or to use a discriminated shape struct instead of an interface.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Write one method that, for any collection of audited items, returns the oldest item and the
    total of some numeric property — where the caller chooses both the item type and the numeric
    type. State every constraint you need and justify each one. Then say what you would have had to
    write before C# 11.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="Exercise 4 — the method"><code>public interface IAudited { DateOnly Created { get; } }

public static (T Oldest, TAmount Total) Summarise&lt;T, TAmount&gt;(
    IReadOnlyList&lt;T&gt; items, Func&lt;T, TAmount&gt; amount)
    where T : class, IAudited
    where TAmount : INumber&lt;TAmount&gt;
{
    if (items.Count == 0) throw new ArgumentException("no items", nameof(items));

    T oldest = items[0];
    TAmount total = TAmount.Zero;
    foreach (var item in items)
    {
        if (item.Created &lt; oldest.Created) oldest = item;
        total += amount(item);
    }
    return (oldest, total);
}</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>oldest : 15/01/2026
total  : 149.75
same call with int amounts: oldest 15/01/2026, count 3</code></pre>
        <p><strong>Every constraint, and the line that needs it:</strong></p>
        <div class="table-wrap">
        <table>
          <thead><tr><th>Constraint</th><th>Needed for</th></tr></thead>
          <tbody>
            <tr><td><code>T : IAudited</code></td><td><code>item.Created</code> — without it,
                <code>CS1061</code>.</td></tr>
            <tr><td><code>T : class</code></td><td>Assigning <code>oldest</code> without copying a
                struct on every comparison. Strictly optional; it is a design decision, and worth
                being able to say so.</td></tr>
            <tr><td><code>TAmount : INumber&lt;TAmount&gt;</code></td><td><code>TAmount.Zero</code>
                for the seed and <code>+=</code> for the accumulation — two separate capabilities
                from one constraint.</td></tr>
          </tbody>
        </table>
        </div>
        <p><strong>Two type parameters rather than one</strong> is the key decision. The item type
        and the amount type vary independently: the same call summarises <code>decimal</code>
        amounts and, with <code>_ =&gt; 1</code>, produces an <code>int</code> count. Forcing one
        parameter would mean a method per amount type.</p>
        <p><strong>The <code>Func&lt;T, TAmount&gt;</code> is deliberate</strong> rather than a
        second interface constraint like <code>IHasAmount&lt;TAmount&gt;</code>. A delegate lets a
        caller summarise any property — or a computed one — without the item type having to
        implement anything. Constraining to what the body uses, and taking a delegate for what
        varies, is the general shape.</p>
        <p><strong>Before C# 11</strong> there were no <code>static abstract</code> members, so
        <code>INumber&lt;T&gt;</code> could not exist and a type parameter could not have operators.
        The options were:</p>
        <ol>
          <li><strong>One overload per numeric type</strong> — <code>Summarise</code> for
          <code>int</code>, <code>long</code>, <code>decimal</code>, <code>double</code> and so on,
          with identical bodies. This is why <code>System.Math</code> looks the way it does.</li>
          <li><strong>Pass in the arithmetic</strong> — an extra
          <code>Func&lt;TAmount, TAmount, TAmount&gt; add</code> parameter and a
          <code>TAmount zero</code>, supplied by every caller. Generic, and it moves the burden
          onto the call site and costs a delegate call per element.</li>
          <li><strong>Accumulate in <code>decimal</code> or <code>double</code></strong> and convert
          — which loses precision for <code>long</code> and changes the answer, so it is a
          correctness compromise rather than a design one.</li>
        </ol>
        <p>The measurement worth remembering is that option 1 was not merely tedious — it was the
        <em>fast</em> option, because each overload is real typed arithmetic. What
        <code>INumber&lt;T&gt;</code> added is that the generic version is now fast too: the JIT
        specialises the method per value type, so the operators compile down to the same
        instructions the hand-written overload would have used.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What can an unconstrained <code>T</code> do, and what are the two things a constraint
      changes?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Only what <code>object</code> can: <code>ToString</code>, <code>Equals</code>,
        <code>GetHashCode</code>, <code>GetType</code>. A constraint <strong>narrows who may
        call</strong> and <strong>widens what the body may assume</strong> — the same clause does
        both, which is why it is a trade rather than a safety measure.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>where T : struct</code> grant that <code>where T : class</code> does
      not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>T?</code> meaning <code>Nullable&lt;T&gt;</code> — a real distinct runtime type —
        and <strong>constrained calls</strong>, so an interface member runs on the value with no
        boxing. Under <code>class</code>, <code>T?</code> is only an annotation and
        <code>typeof(string?)</code> does not compile.</p>
      </div></details>
    </li>
    <li>
      <p>What did the <code>new()</code> constraint measure at, against the alternatives?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>About the same as <code>Activator.CreateInstance</code> (24.8 vs 23.0 ns in one sample),
        and roughly <strong>40% slower than a <code>Func&lt;T&gt;</code> factory</strong> (14.1 ns).
        For a reference type argument the shared code body cannot know the constructor, so it is
        resolved at run time.</p>
      </div></details>
    </li>
    <li>
      <p>What is the struct constraint's real benefit, and what should you quote for it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Allocation, not time.</strong> Timings were 2.67 ns boxed against 2.49
        constrained — unstable. Allocation was <strong>24 bytes against zero</strong>, exactly
        reproducible. Quote the bytes; claiming a speed-up would be wrong.</p>
      </div></details>
    </li>
    <li>
      <p>Why is boxing hard to spot in code like <code>Total(IEnumerable&lt;IShape&gt;)</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>There is no cast and no <code>new</code> in the source. The boxing is caused by a struct
        being assigned to an interface-typed parameter — <strong>one word in a signature</strong>,
        usually in a different file from the loop that pays 24 bytes per element for it.</p>
      </div></details>
    </li>
    <li>
      <p>What made generic arithmetic possible, and what did the alternative look like?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong><code>static abstract</code> interface members</strong> (C# 11), which let
        <code>INumber&lt;T&gt;</code> require the operators, so <code>where T : INumber&lt;T&gt;</code>
        grants them. Before that: one overload per numeric type, which is why
        <code>System.Math</code> looks the way it does.</p>
      </div></details>
    </li>
    <li>
      <p>Why is over-constraining a real cost rather than harmless caution?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A constraint is a requirement on every present and future caller. One the body never uses
        excludes valid callers for no benefit, and tightening a published constraint later is a
        breaking change — the same versioning shape as adding an interface member.</p>
      </div></details>
    </li>
    <li>
      <p>Is <code>where T : notnull</code> enforced?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>At <strong>warning</strong> level (<code>CS8714</code>), and only when the nullable
        context is enabled. It documents intent and drives analysis; it is not a runtime
        guarantee.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>new()</code> guarantee about the object it produces?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>That a public parameterless constructor <strong>exists</strong> — nothing about the
        result being valid. The module's <code>Blank()</code> returned an object its own
        <code>Validate</code> would reject, the same warning as <code>default(T)</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>v is null</code> compile on an unconstrained <code>T</code> when
      <code>v == null</code> does not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>is null</code> is a <strong>pattern</strong>, which works on any type — always
        <code>false</code> for a value type. <code>==</code> needs an operator, and an unconstrained
        <code>T</code> has none. Preferring <code>is null</code> in generic code needs one
        constraint fewer.</p>
      </div></details>
    </li>
    <li>
      <p>What is the required order when combining constraints?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>class</code> or <code>struct</code> first, then a base class, then interfaces, then
        <code>new()</code> <strong>last</strong>. Out of order is <code>CS0401</code>;
        <code>struct</code> with <code>class</code> is <code>CS0449</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Where do a constraint's compile-time and run-time effects meet?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>In JIT specialisation. Telling the compiler <code>T</code> is a struct both permits more
        syntax and lets the runtime generate code specialised to that type, emitting a constrained
        call instead of boxing. <strong>The same declaration that makes it compile makes it allocate
        nothing.</strong></p>
      </div></details>
    </li>
  </ol>
</section>

`
});
