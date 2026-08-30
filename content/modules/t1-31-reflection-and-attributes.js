CSPREP.module({
  id: "t1-31-reflection-and-attributes",
  minutes: 55,
  updated: "2026-08-30",
  summary: "Reflection is reading the metadata every .NET assembly already carries, and its cost splits cleanly in two: discovery, which you do once and cache, and invocation, which you should replace with a delegate. The trimming and AOT hazards are the modern version of the problem, and one of them fails silently by getting slower rather than by throwing.",
  terms: ["reflection", "metadata", "Type", "MethodInfo", "PropertyInfo", "BindingFlags",
    "attribute", "AttributeUsage", "AttributeTargets", "AllowMultiple", "Inherited",
    "TargetInvocationException", "Activator", "CreateDelegate", "expression tree",
    "trimming", "ahead-of-time compilation", "DynamicallyAccessedMembers",
    "IL2026", "IL2070", "IL3050"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger — the payments and invoicing service these modules keep returning to — needs to validate
  incoming payment instructions. Reference required, amount within a range, currency one of three.
  Writing that once by hand takes a few minutes. Writing it for forty request types, keeping each
  validator in step with its class as fields are added, and producing a consistent error format is
  not.</p>

  <p>The same shape appears everywhere. A JSON serialiser has to know which properties a type has
  without having been compiled against it. A dependency-injection container has to construct a type
  it has never seen. A test runner has to find every method marked as a test in an assembly that did
  not exist when the runner was written.</p>

  <p>None of that is possible if a compiled assembly is only machine code. <strong>It is possible
  because every .NET assembly carries a complete description of itself</strong> — every type, member,
  parameter and attribute — and the runtime will read it back for you.</p>

  <p>That capability has a price, and the price has changed. It has always been the per-call cost;
  since .NET 7 it is also that a trimmed or ahead-of-time-compiled application may not have the
  members you are looking for — <strong>and one of those failures does not throw, it merely gets
  slower</strong>.</p>
</section>

<section id="what-it-is">
  <h2>What reflection reads</h2>

  <p class="define"><span class="define__term">Metadata</span> The description of types and members
  that the compiler writes into every assembly alongside the IL: names, signatures, base types,
  attributes, accessibility. It is what makes a .NET assembly self-describing, and it is why one
  compiler can consume another's output without headers or stub files.</p>

  <p class="define"><span class="define__term">Reflection</span> The API for reading that metadata at
  runtime, and for using it to read values, call methods and create objects.</p>

  <p>The analogy: metadata is the <strong>index at the back of a book</strong> and reflection is
  looking things up in it. <strong>The analogy breaks in the important place</strong> — a book index
  is a separate summary that can fall out of date, whereas metadata is generated from the code and
  cannot disagree with it.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-metadata.cs"><code>// 01-metadata.cs — what the runtime knows about your types, and how to ask it.
// Every line here reads real metadata out of this assembly.
// .NET 10.0.400. Run: dotnet run 01-metadata.cs
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075;IL2072

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Ledger.Invoicing;

[AttributeUsage(AttributeTargets.Property, AllowMultiple = false)]
public sealed class ColumnAttribute : Attribute
{
    public ColumnAttribute(string name) =&gt; Name = name;
    public string Name { get; }
    public bool Indexed { get; init; }
}

public sealed record Invoice
{
    [Column("invoice_number", Indexed = true)]
    public required string Number { get; init; }

    [Column("customer_id", Indexed = true)]
    public required string CustomerId { get; init; }

    [Column("amount_minor")]
    public required long AmountMinor { get; init; }

    // Deliberately unmapped: no attribute.
    public string DisplayName =&gt; $"{Number} ({CustomerId})";

    public bool IsLarge(long threshold) =&gt; AmountMinor &gt; threshold;
    private void Internal() { }
}

class Program
{
    static void Main()
    {
        var type = typeof(Invoice);

        Console.WriteLine("--- a Type object describes a type ---");
        Console.WriteLine($"  Name          : {type.Name}");
        Console.WriteLine($"  FullName      : {type.FullName}");
        Console.WriteLine($"  Assembly      : {type.Assembly.GetName().Name}");
        Console.WriteLine($"  IsSealed      : {type.IsSealed}");
        Console.WriteLine($"  IsValueType   : {type.IsValueType}");
        Console.WriteLine($"  BaseType      : {type.BaseType?.Name}");

        Console.WriteLine();
        Console.WriteLine("--- three ways to get one ---");
        var invoice = new Invoice { Number = "INV-1", CustomerId = "CUST-1", AmountMinor = 120_00 };
        Console.WriteLine($"  typeof(Invoice)      : {typeof(Invoice).Name}");
        Console.WriteLine($"  invoice.GetType()    : {invoice.GetType().Name}");
        Console.WriteLine($"  Type.GetType(string) : " +
                          $"{Type.GetType("Ledger.Invoicing.Invoice")?.Name ?? "(null)"}");
        Console.WriteLine("  typeof is resolved at COMPILE time and costs nothing at runtime.");
        Console.WriteLine("  GetType() reads the object's type pointer. Type.GetType(string)");
        Console.WriteLine("  searches by name and is the one that breaks under trimming.");

        Console.WriteLine();
        Console.WriteLine("--- public properties, with their attributes ---");
        foreach (var p in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var column = p.GetCustomAttribute&lt;ColumnAttribute&gt;();
            var mapping = column is null
                ? "(not mapped)"
                : $"-&gt; {column.Name}{(column.Indexed ? " [indexed]" : "")}";
            Console.WriteLine($"  {p.Name,-12} {p.PropertyType.Name,-8} {mapping}");
        }
        Console.WriteLine("  DisplayName has no [Column], so a mapper skips it. The");
        Console.WriteLine("  attribute is the schema; the code is the source of truth.");

        Console.WriteLine();
        Console.WriteLine("--- private members need BindingFlags.NonPublic ---");
        var publicMethods = type.GetMethods(BindingFlags.Public | BindingFlags.Instance).Length;
        var allMethods = type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic |
                                         BindingFlags.Instance).Length;
        Console.WriteLine($"  public instance methods      : {publicMethods}");
        Console.WriteLine($"  plus non-public              : {allMethods}");
        Console.WriteLine($"  the private one, by name     : " +
                          $"{type.GetMethod("Internal", BindingFlags.NonPublic | BindingFlags.Instance)?.Name ?? "(null)"}");
        Console.WriteLine("  BindingFlags is not a filter you add — it REPLACES the default.");
        Console.WriteLine("  Omitting Instance or Static returns nothing at all.");
        Console.WriteLine($"  GetMethods() with only NonPublic : " +
                          $"{type.GetMethods(BindingFlags.NonPublic).Length} members");

        Console.WriteLine();
        Console.WriteLine("--- reading and writing values ---");
        var numberProp = type.GetProperty(nameof(Invoice.Number))!;
        Console.WriteLine($"  GetValue : {numberProp.GetValue(invoice)}");
        Console.WriteLine($"  CanWrite : {numberProp.CanWrite} (init-only, so writable only during init)");
        try
        {
            numberProp.SetValue(invoice, "CHANGED");
            Console.WriteLine($"  after SetValue : {invoice.Number}");
            Console.WriteLine("  Reflection wrote to an init-only property. The 'init'");
            Console.WriteLine("  restriction is enforced by the COMPILER, not the runtime.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  SetValue threw : {ex.GetType().Name}");
        }

        Console.WriteLine();
        Console.WriteLine("--- invoking a method ---");
        var isLarge = type.GetMethod(nameof(Invoice.IsLarge))!;
        Console.WriteLine($"  parameters : {string.Join(", ",
            isLarge.GetParameters().Select(p =&gt; $"{p.ParameterType.Name} {p.Name}"))}");
        Console.WriteLine($"  ReturnType : {isLarge.ReturnType.Name}");
        Console.WriteLine($"  Invoke(invoice, 100_00) : {isLarge.Invoke(invoice, new object[] { 100_00L })}");
        Console.WriteLine("  Arguments are boxed into an object[]; the result is boxed too.");

        Console.WriteLine();
        Console.WriteLine("--- what an exception from Invoke looks like ---");
        try
        {
            isLarge.Invoke(invoice, new object[] { "not a long" });
        }
        catch (ArgumentException ex)
        {
            Console.WriteLine($"  wrong argument type : {ex.GetType().Name}");
        }
        var thrower = typeof(Program).GetMethod(nameof(Throws),
            BindingFlags.NonPublic | BindingFlags.Static)!;
        try
        {
            thrower.Invoke(null, null);
        }
        catch (TargetInvocationException ex)
        {
            Console.WriteLine($"  a method that throws : {ex.GetType().Name}");
            Console.WriteLine($"    InnerException     : {ex.InnerException?.GetType().Name}: " +
                              $"{ex.InnerException?.Message}");
        }
        Console.WriteLine("  Invoke WRAPS the real exception in TargetInvocationException.");
        Console.WriteLine("  Any catch clause for the real type will miss it.");

        Console.WriteLine();
        Console.WriteLine("--- creating an instance ---");
        var built = Activator.CreateInstance(typeof(Money), new object[] { 12.5m, "GBP" })!;
        Console.WriteLine($"  Activator.CreateInstance(Money, 12.5, GBP) : {built}");
        var bypassed = (Invoice)Activator.CreateInstance(typeof(Invoice))!;
        Console.WriteLine($"  Activator.CreateInstance(Invoice) : Number = " +
                          $"{(bypassed.Number is null ? "(NULL)" : bypassed.Number)}");
        Console.WriteLine("  Every property is 'required', and reflection created one with");
        Console.WriteLine("  all of them unset. 'required' is a COMPILE-time rule (CS9035);");
        Console.WriteLine("  the runtime has no such concept.");
        Console.WriteLine("  This is how a deserialiser produces an object your type system");
        Console.WriteLine("  says cannot exist — the point measured in the nullable module.");

        Console.WriteLine();
        Console.WriteLine("--- a type that genuinely has no parameterless constructor ---");
        try
        {
            Activator.CreateInstance(typeof(Receipt));
        }
        catch (MissingMethodException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}");
        }
    }

    static void Throws() =&gt; throw new InvalidOperationException("from inside");
}

public sealed class Receipt
{
    public Receipt(string number) =&gt; Number = number;
    public string Number { get; }
}

public readonly record struct Money(decimal Amount, string Currency)
{
    public override string ToString() =&gt; $"{Amount:0.00} {Currency}";
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- a Type object describes a type ---
  Name          : Invoice
  FullName      : Ledger.Invoicing.Invoice
  Assembly      : 01-metadata
  IsSealed      : True
  IsValueType   : False
  BaseType      : Object

--- three ways to get one ---
  typeof(Invoice)      : Invoice
  invoice.GetType()    : Invoice
  Type.GetType(string) : Invoice
  typeof is resolved at COMPILE time and costs nothing at runtime.
  GetType() reads the object's type pointer. Type.GetType(string)
  searches by name and is the one that breaks under trimming.

--- public properties, with their attributes ---
  Number       String   -&gt; invoice_number [indexed]
  CustomerId   String   -&gt; customer_id [indexed]
  AmountMinor  Int64    -&gt; amount_minor
  DisplayName  String   (not mapped)
  DisplayName has no [Column], so a mapper skips it. The
  attribute is the schema; the code is the source of truth.

--- private members need BindingFlags.NonPublic ---
  public instance methods      : 14
  plus non-public              : 19
  the private one, by name     : Internal
  BindingFlags is not a filter you add — it REPLACES the default.
  Omitting Instance or Static returns nothing at all.
  GetMethods() with only NonPublic : 0 members

--- reading and writing values ---
  GetValue : INV-1
  CanWrite : True (init-only, so writable only during init)
  after SetValue : CHANGED
  Reflection wrote to an init-only property. The 'init'
  restriction is enforced by the COMPILER, not the runtime.

--- invoking a method ---
  parameters : Int64 threshold
  ReturnType : Boolean
  Invoke(invoice, 100_00) : True
  Arguments are boxed into an object[]; the result is boxed too.

--- what an exception from Invoke looks like ---
  wrong argument type : ArgumentException
  a method that throws : TargetInvocationException
    InnerException     : InvalidOperationException: from inside
  Invoke WRAPS the real exception in TargetInvocationException.
  Any catch clause for the real type will miss it.

--- creating an instance ---
  Activator.CreateInstance(Money, 12.5, GBP) : 12.50 GBP
  Activator.CreateInstance(Invoice) : Number = (NULL)
  Every property is 'required', and reflection created one with
  all of them unset. 'required' is a COMPILE-time rule (CS9035);
  the runtime has no such concept.
  This is how a deserialiser produces an object your type system
  says cannot exist — the point measured in the nullable module.

--- a type that genuinely has no parameterless constructor ---
  MissingMethodException: Cannot dynamically create an instance of type 'Ledger.Invoicing.Receipt'. Reason: No parameterless constructor defined.</code></pre>

  <p class="define"><span class="define__term">Type</span> The runtime's object describing a type.
  <span class="define__term">MethodInfo</span>, <span class="define__term">PropertyInfo</span> the
  equivalents for members. Each carries the name, signature and attributes, and can read, write or
  call.</p>

  <p class="define"><span class="define__term">BindingFlags</span> The enum selecting which members
  a lookup returns. <strong>It replaces the default rather than adding to it</strong> — measured:
  <code>GetMethods(BindingFlags.NonPublic)</code> returned <strong>0 members</strong>, because
  neither <code>Instance</code> nor <code>Static</code> was specified.</p>

  <h3>Three things reflection ignores that the compiler enforces</h3>

  <p><strong>It wrote to an <code>init</code>-only property.</strong> <code>init</code> is a
  compile-time rule; the setter exists in the IL and reflection called it.</p>

  <p><strong>It created an object with every <code>required</code> member unset.</strong> Measured:
  <code>Activator.CreateInstance(typeof(Invoice))</code> returned an <code>Invoice</code> whose
  <code>Number</code> was <code>null</code>, despite <code>required</code> on all three properties.
  That is precisely how a deserialiser produces the object
  <a href="#/m/t1-28-nullable-reference-types">Nullable Reference Types</a> measured — a non-nullable
  <code>string</code> holding null, with no warning anywhere.</p>

  <p><strong>It read a private member.</strong> <code>BindingFlags.NonPublic</code> is all it takes.
  Accessibility is a compiler rule, not a runtime one.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong><code>Invoke</code> wraps the exception.</strong> A method that threw
    <code>InvalidOperationException</code> surfaced as
    <code>TargetInvocationException</code> with the real one as
    <code>InnerException</code>. Any <code>catch (InvalidOperationException)</code> around the
    <code>Invoke</code> call misses it entirely — which is a genuinely confusing bug when a framework
    invokes your code and your handler stops firing.</p>
  </div>
</section>

<section id="attributes">
  <h2>Attributes: metadata you write</h2>

  <p class="define"><span class="define__term">Attribute</span> A class deriving from
  <code>Attribute</code>, attached to a type or member in square brackets. The compiler records it in
  metadata; it does nothing on its own. Something has to read it.</p>

  <p class="define"><span class="define__term">AttributeUsage</span> An attribute on your attribute,
  declaring where it may be applied (<span class="define__term">AttributeTargets</span>), whether
  more than one may appear (<span class="define__term">AllowMultiple</span>), and whether derived
  members inherit it (<span class="define__term">Inherited</span>).</p>

  <pre data-lang="csharp" data-net="10" data-title="Declaring one"><code>using System;

[AttributeUsage(AttributeTargets.Property, AllowMultiple = true, Inherited = true)]
public sealed class AllowedValueAttribute : Attribute
{
    // Constructor arguments are POSITIONAL: [AllowedValue("GBP")]
    public AllowedValueAttribute(string value) =&gt; Value = value;
    public string Value { get; }

    // Settable members are NAMED: [AllowedValue("GBP", Note = "domestic")]
    public string? Note { get; init; }
}</code></pre>

  <p>Two rules follow from attributes being baked into metadata at compile time. <strong>Every
  argument must be a compile-time constant</strong> — a literal, a <code>typeof</code>, or an array
  of them. And <strong>the attribute object is constructed when you ask for it</strong>, not when the
  assembly loads, which is why reading attributes costs something.</p>

  <p>Measured in the production example below: <code>AllowMultiple = true</code> permitted three
  <code>[AllowedValue]</code> attributes on one property, and <code>Inherited = true</code> made
  <code>[Required]</code> visible on a derived type's property. Both defaults are the restrictive
  one, and a second attribute without <code>AllowMultiple</code> is a compile error,
  <code>CS0579</code>.</p>
</section>

<section id="cost">
  <h2>What it costs, and the two escape hatches</h2>

  <pre data-lang="csharp" data-net="10" data-title="02-cost.cs"><code>// 02-cost.cs — what reflection costs, separated into discovery (once) and
// invocation (every time), and what each of the four escape hatches buys back.
// .NET 10.0.400. Run: dotnet run 02-cost.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075;IL3050
// File-based apps default to PublishAot=true, which turns OFF runtime code
// generation — Expression.Compile() then falls back to an interpreter and is
// SLOWER than reflection. Turning it off here measures the ordinary JIT case;
// 04-trimming-and-aot.cs measures the other one deliberately.
#:property PublishAot=false

using System;
using System.Diagnostics;
using System.Linq.Expressions;
using System.Reflection;
using System.Runtime.CompilerServices;

public sealed class Invoice
{
    public string Number { get; set; } = "INV-1";
    public long AmountMinor { get; set; } = 120_00;

    [MethodImpl(MethodImplOptions.NoInlining)]
    public long WithVat() =&gt; AmountMinor * 12 / 10;
}

class Program
{
    const int Iterations = 1_000_000;
    static long _sink;

    static void Main()
    {
        var invoice = new Invoice();
        Console.WriteLine($"RuntimeFeature.IsDynamicCodeCompiled : " +
                          $"{System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeCompiled}");
        Console.WriteLine();

        Console.WriteLine("=== DISCOVERY: the one-off cost of finding metadata ===");
        Console.WriteLine();
        var lookup = Time(() =&gt; { _sink += typeof(Invoice).GetProperty("Number") is null ? 0 : 1; }, 200_000);
        var typeofOnly = Time(() =&gt; { _sink += typeof(Invoice).IsSealed ? 1 : 0; }, 200_000);
        var byName = Time(() =&gt; { _sink += Type.GetType("Invoice") is null ? 0 : 1; }, 200_000);
        Console.WriteLine($"  typeof(T).IsSealed          : {Ns(typeofOnly, 200_000):N1} ns/op");
        Console.WriteLine($"  GetProperty(\"Number\")       : {Ns(lookup, 200_000):N1} ns/op");
        Console.WriteLine($"  Type.GetType(\"Invoice\")     : {Ns(byName, 200_000):N1} ns/op");
        Console.WriteLine("  Member lookup is a string comparison against a metadata table.");
        Console.WriteLine("  It is not free, and it is the part you can cache.");

        Console.WriteLine();
        Console.WriteLine("=== INVOCATION: the per-call cost, five ways ===");
        Console.WriteLine();

        var prop = typeof(Invoice).GetProperty(nameof(Invoice.AmountMinor))!;
        var method = typeof(Invoice).GetMethod(nameof(Invoice.WithVat))!;

        // 1. Direct.
        var direct = Time(() =&gt; { _sink += invoice.WithVat(); });

        // 2. MethodInfo.Invoke, with the MethodInfo already cached.
        var invoke = Time(() =&gt; { _sink += (long)method.Invoke(invoice, null)!; }, 200_000);

        // 3. PropertyInfo.GetValue, cached.
        var getValue = Time(() =&gt; { _sink += (long)prop.GetValue(invoice)!; }, 200_000);

        // 4. A delegate created once from the MethodInfo.
        var asDelegate = method.CreateDelegate&lt;Func&lt;Invoice, long&gt;&gt;();
        var viaDelegate = Time(() =&gt; { _sink += asDelegate(invoice); });

        // 5. A compiled expression tree, built once.
        var param = Expression.Parameter(typeof(Invoice), "i");
        var compiled = Expression.Lambda&lt;Func&lt;Invoice, long&gt;&gt;(
            Expression.Property(param, prop), param).Compile();
        var viaExpression = Time(() =&gt; { _sink += compiled(invoice); });

        // 6. The property, read directly, for the getter comparison.
        var directProp = Time(() =&gt; { _sink += invoice.AmountMinor; });

        var d = Ns(direct);
        Console.WriteLine($"  direct method call             : {d,10:N1} ns/op   1.0x");
        Console.WriteLine($"  MethodInfo.Invoke (cached MI)  : {Ns(invoke, 200_000),10:N1} ns/op   " +
                          $"{Ns(invoke, 200_000) / d,6:N0}x");
        Console.WriteLine($"  delegate from CreateDelegate   : {Ns(viaDelegate),10:N1} ns/op   " +
                          $"{Ns(viaDelegate) / d,6:N1}x");
        Console.WriteLine();
        var dp = Ns(directProp);
        Console.WriteLine($"  direct property read           : {dp,10:N1} ns/op   1.0x");
        Console.WriteLine($"  PropertyInfo.GetValue (cached) : {Ns(getValue, 200_000),10:N1} ns/op   " +
                          $"{Ns(getValue, 200_000) / dp,6:N0}x");
        Console.WriteLine($"  compiled expression tree       : {Ns(viaExpression),10:N1} ns/op   " +
                          $"{Ns(viaExpression) / dp,6:N1}x");

        Console.WriteLine();
        Console.WriteLine("=== ALLOCATION per call ===");
        Console.WriteLine();
        Console.WriteLine($"  direct method call             : {AllocOf(() =&gt; _sink += invoice.WithVat()),6} bytes");
        Console.WriteLine($"  MethodInfo.Invoke              : {AllocOf(() =&gt; _sink += (long)method.Invoke(invoice, null)!),6} bytes");
        Console.WriteLine($"  PropertyInfo.GetValue          : {AllocOf(() =&gt; _sink += (long)prop.GetValue(invoice)!),6} bytes");
        Console.WriteLine($"  delegate                       : {AllocOf(() =&gt; _sink += asDelegate(invoice)),6} bytes");
        Console.WriteLine($"  compiled expression            : {AllocOf(() =&gt; _sink += compiled(invoice)),6} bytes");
        Console.WriteLine("  Invoke boxes the return value and, when there are arguments,");
        Console.WriteLine("  allocates the object[] as well. The delegate and the compiled");
        Console.WriteLine("  expression are ordinary typed calls once built.");

        Console.WriteLine();
        Console.WriteLine("=== BUILD COST of the two escape hatches ===");
        Console.WriteLine();
        var makeDelegate = Time(() =&gt; { _sink += method.CreateDelegate&lt;Func&lt;Invoice, long&gt;&gt;() is null ? 0 : 1; }, 20_000);
        var makeExpression = Time(() =&gt;
        {
            var p2 = Expression.Parameter(typeof(Invoice), "i");
            var f = Expression.Lambda&lt;Func&lt;Invoice, long&gt;&gt;(Expression.Property(p2, prop), p2).Compile();
            _sink += f is null ? 0 : 1;
        }, 2_000);
        Console.WriteLine($"  CreateDelegate           : {Ns(makeDelegate, 20_000):N0} ns, once");
        Console.WriteLine($"  Expression .Compile()    : {Ns(makeExpression, 2_000):N0} ns, once");
        Console.WriteLine("  Compiling an expression tree costs microseconds and pays for");
        Console.WriteLine("  itself after a few thousand calls. Building it per call is the");
        Console.WriteLine("  mistake — it is more expensive than Invoke.");

        Console.WriteLine();
        Console.WriteLine($"  break-even for Compile vs GetValue : " +
                          $"~{Ns(makeExpression, 2_000) / Math.Max(Ns(getValue, 200_000) - Ns(viaExpression), 1):N0} calls");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static double Time(Action a, int iterations = Iterations)
    {
        for (var i = 0; i &lt; Math.Min(iterations, 1_000); i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; iterations; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static double Ns(double ms, int iterations = Iterations) =&gt; ms * 1_000_000 / iterations;

    static long AllocOf(Action a)
    {
        a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        a();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>RuntimeFeature.IsDynamicCodeCompiled : True

=== DISCOVERY: the one-off cost of finding metadata ===

  typeof(T).IsSealed          : 7.9 ns/op
  GetProperty("Number")       : 57.8 ns/op
  Type.GetType("Invoice")     : 1,401.5 ns/op
  Member lookup is a string comparison against a metadata table.
  It is not free, and it is the part you can cache.

=== INVOCATION: the per-call cost, five ways ===

  direct method call             :       16.7 ns/op   1.0x
  MethodInfo.Invoke (cached MI)  :       45.2 ns/op        3x
  delegate from CreateDelegate   :       15.2 ns/op      0.9x

  direct property read           :        5.5 ns/op   1.0x
  PropertyInfo.GetValue (cached) :       32.4 ns/op        6x
  compiled expression tree       :        5.5 ns/op      1.0x

=== ALLOCATION per call ===

  direct method call             :      0 bytes
  MethodInfo.Invoke              :     24 bytes
  PropertyInfo.GetValue          :     24 bytes
  delegate                       :      0 bytes
  compiled expression            :      0 bytes
  Invoke boxes the return value and, when there are arguments,
  allocates the object[] as well. The delegate and the compiled
  expression are ordinary typed calls once built.

=== BUILD COST of the two escape hatches ===

  CreateDelegate           : 400 ns, once
  Expression .Compile()    : 120,346 ns, once
  Compiling an expression tree costs microseconds and pays for
  itself after a few thousand calls. Building it per call is the
  mistake — it is more expensive than Invoke.

  break-even for Compile vs GetValue : ~4,470 calls
  (checksum 58159961400)</code></pre>

  <p><strong>The cost splits in two, and they need different treatment.</strong></p>

  <p><strong>Discovery.</strong> <code>GetProperty("Number")</code> cost <strong>57.8 ns</strong> —
  a string comparison against a metadata table. <code>Type.GetType("Invoice")</code> cost
  <strong>1,401.5 ns</strong>, twenty-four times more, because it searches loaded assemblies by
  name. Both are done once per type and cached.</p>

  <p><strong>Invocation.</strong> <code>MethodInfo.Invoke</code> was <strong>3× a direct
  call</strong> and <code>PropertyInfo.GetValue</code> was <strong>6× a direct property
  read</strong>, each allocating <strong>24 bytes</strong> to box the return value.</p>

  <p class="define"><span class="define__term">CreateDelegate</span> Binds a
  <code>MethodInfo</code> to a strongly-typed delegate once, after which calls are ordinary calls.
  Measured: <strong>15.2 ns, 0 bytes</strong> — the same as a direct call — for a one-off build cost
  of <strong>400 ns</strong>.</p>

  <p class="define"><span class="define__term">Expression tree</span> A description of code as data,
  which <code>.Compile()</code> turns into a real delegate. Measured: <strong>5.5 ns and 0
  bytes</strong>, matching a direct property read, for a one-off build cost of <strong>120
  microseconds</strong>.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>The break-even is about 4,470 calls.</strong> That is the arithmetic that decides
    whether the complexity is worth it: below it, a cached <code>PropertyInfo</code> is fine; above
    it — a serialiser, a mapper, a validator running per request — the compiled version pays for
    itself in the first second. <code>CreateDelegate</code> breaks even after about 20 calls and
    should be the default whenever the signature is known.</p>
  </div>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// 03-production.cs — a small attribute-driven validator for Ledger, written the
// way a real one has to be: metadata discovered once per type and cached, and
// per-instance work done through delegates rather than PropertyInfo.
// .NET 10.0.400. Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075;IL2072;IL3050
#:property PublishAot=false

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;

namespace Ledger.Validation;

[AttributeUsage(AttributeTargets.Property, AllowMultiple = false, Inherited = true)]
public sealed class RequiredAttribute : Attribute { }

[AttributeUsage(AttributeTargets.Property, AllowMultiple = false, Inherited = true)]
public sealed class RangeAttribute : Attribute
{
    public RangeAttribute(long min, long max) { Min = min; Max = max; }
    public long Min { get; }
    public long Max { get; }
}

[AttributeUsage(AttributeTargets.Property, AllowMultiple = true, Inherited = true)]
public sealed class AllowedValueAttribute : Attribute
{
    public AllowedValueAttribute(string value) =&gt; Value = value;
    public string Value { get; }
}

public class PaymentInstruction
{
    [Required] public string? Reference { get; set; }
    [Required] public string? CustomerId { get; set; }
    [Range(1, 1_000_000_00)] public long AmountMinor { get; set; }
    [AllowedValue("GBP")]
    [AllowedValue("EUR")]
    [AllowedValue("USD")]
    public string? Currency { get; set; }
    public string? Note { get; set; }       // unvalidated
}

/// &lt;summary&gt;
/// Reflection happens ONCE per type. Everything after that is delegate calls.
/// &lt;/summary&gt;
public static class Validator
{
    private sealed record Rule(string PropertyName, Func&lt;object, object?&gt; Read, Func&lt;object?, string?&gt; Check);

    private static readonly ConcurrentDictionary&lt;Type, Rule[]&gt; Cache = new();

    public static IReadOnlyList&lt;string&gt; Validate(object instance)
    {
        ArgumentNullException.ThrowIfNull(instance);
        var rules = Cache.GetOrAdd(instance.GetType(), BuildRules);

        var errors = new List&lt;string&gt;();
        foreach (var rule in rules)
        {
            var message = rule.Check(rule.Read(instance));
            if (message is not null) errors.Add($"{rule.PropertyName}: {message}");
        }
        return errors;
    }

    public static int CachedTypeCount =&gt; Cache.Count;

    private static Rule[] BuildRules(Type type)
    {
        var rules = new List&lt;Rule&gt;();
        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var read = CompileGetter(type, property);

            if (property.GetCustomAttribute&lt;RequiredAttribute&gt;() is not null)
                rules.Add(new Rule(property.Name, read,
                    v =&gt; v is null || (v is string s &amp;&amp; s.Length == 0) ? "is required" : null));

            if (property.GetCustomAttribute&lt;RangeAttribute&gt;() is { } range)
                rules.Add(new Rule(property.Name, read,
                    v =&gt; v is long l &amp;&amp; (l &lt; range.Min || l &gt; range.Max)
                        ? $"must be between {range.Min} and {range.Max}"
                        : null));

            var allowed = property.GetCustomAttributes&lt;AllowedValueAttribute&gt;()
                                  .Select(a =&gt; a.Value).ToArray();
            if (allowed.Length &gt; 0)
                rules.Add(new Rule(property.Name, read,
                    v =&gt; v is string s &amp;&amp; !allowed.Contains(s, StringComparer.Ordinal)
                        ? $"must be one of {string.Join(", ", allowed)}"
                        : null));
        }
        return rules.ToArray();
    }

    /// &lt;summary&gt;An expression tree compiled once: object -&gt; object?, no boxing per call
    /// beyond what the signature forces.&lt;/summary&gt;
    private static Func&lt;object, object?&gt; CompileGetter(Type type, PropertyInfo property)
    {
        var instance = Expression.Parameter(typeof(object), "instance");
        var body = Expression.Convert(
            Expression.Property(Expression.Convert(instance, type), property),
            typeof(object));
        return Expression.Lambda&lt;Func&lt;object, object?&gt;&gt;(body, instance).Compile();
    }
}

/// &lt;summary&gt;The naive version, for comparison: reflection on every call.&lt;/summary&gt;
public static class NaiveValidator
{
    public static IReadOnlyList&lt;string&gt; Validate(object instance)
    {
        var errors = new List&lt;string&gt;();
        foreach (var property in instance.GetType()
                     .GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var value = property.GetValue(instance);

            if (property.GetCustomAttribute&lt;RequiredAttribute&gt;() is not null &amp;&amp;
                (value is null || (value is string s &amp;&amp; s.Length == 0)))
                errors.Add($"{property.Name}: is required");

            if (property.GetCustomAttribute&lt;RangeAttribute&gt;() is { } range &amp;&amp;
                value is long l &amp;&amp; (l &lt; range.Min || l &gt; range.Max))
                errors.Add($"{property.Name}: must be between {range.Min} and {range.Max}");

            var allowed = property.GetCustomAttributes&lt;AllowedValueAttribute&gt;()
                                  .Select(a =&gt; a.Value).ToArray();
            if (allowed.Length &gt; 0 &amp;&amp; value is string cs &amp;&amp;
                !allowed.Contains(cs, StringComparer.Ordinal))
                errors.Add($"{property.Name}: must be one of {string.Join(", ", allowed)}");
        }
        return errors;
    }
}

class Program
{
    static void Main()
    {
        var bad = new PaymentInstruction
        {
            Reference = null,
            CustomerId = "CUST-1",
            AmountMinor = 0,
            Currency = "XYZ",
            Note = "anything goes here"
        };
        var good = new PaymentInstruction
        {
            Reference = "P-1",
            CustomerId = "CUST-1",
            AmountMinor = 120_00,
            Currency = "GBP"
        };

        Console.WriteLine("--- validating ---");
        foreach (var error in Validator.Validate(bad)) Console.WriteLine($"  {error}");
        Console.WriteLine($"  a valid instance produces : {Validator.Validate(good).Count} errors");
        Console.WriteLine($"  types cached so far       : {Validator.CachedTypeCount}");
        Console.WriteLine("  Note has no attributes, so no rule was built for it. The");
        Console.WriteLine("  attribute is the schema and the class is the single source.");

        Console.WriteLine();
        Console.WriteLine("--- the two validators agree ---");
        var cachedErrors = Validator.Validate(bad).OrderBy(e =&gt; e, StringComparer.Ordinal).ToArray();
        var naiveErrors = NaiveValidator.Validate(bad).OrderBy(e =&gt; e, StringComparer.Ordinal).ToArray();
        Console.WriteLine($"  identical : {cachedErrors.SequenceEqual(naiveErrors, StringComparer.Ordinal)}");

        Console.WriteLine();
        Console.WriteLine("--- and cost very different amounts ---");
        var cached = Time(() =&gt; { _sink += Validator.Validate(bad).Count; });
        var naive = Time(() =&gt; { _sink += NaiveValidator.Validate(bad).Count; });
        Console.WriteLine($"  cached (reflect once, then delegates) : {cached:N0} ns/op");
        Console.WriteLine($"  naive  (reflect every call)           : {naive:N0} ns/op");
        Console.WriteLine($"  ratio                                 : {naive / cached:N1}x");
        Console.WriteLine();
        Console.WriteLine($"  allocation, cached : {AllocOf(() =&gt; _sink += Validator.Validate(bad).Count):N0} bytes/call");
        Console.WriteLine($"  allocation, naive  : {AllocOf(() =&gt; _sink += NaiveValidator.Validate(bad).Count):N0} bytes/call");

        Console.WriteLine();
        Console.WriteLine("--- what the difference means at request rates ---");
        var saved = naive - cached;
        Console.WriteLine($"  saved per validation : {saved:N0} ns");
        Console.WriteLine($"  at 1,000 req/s       : {saved * 1000 / 1_000_000:N2} ms of CPU per second");
        Console.WriteLine($"  at 20 validations/req: {saved * 20_000 / 1_000_000:N1} ms of CPU per second");
        Console.WriteLine("  The caching is one ConcurrentDictionary and it is the whole");
        Console.WriteLine("  difference between a usable framework and a slow one.");

        Console.WriteLine();
        Console.WriteLine("--- attribute inheritance and multiplicity ---");
        var currency = typeof(PaymentInstruction).GetProperty(nameof(PaymentInstruction.Currency))!;
        Console.WriteLine($"  [AllowedValue] count on Currency : " +
                          $"{currency.GetCustomAttributes&lt;AllowedValueAttribute&gt;().Count()}");
        Console.WriteLine("  AllowMultiple = true is what permits three of them. The default");
        Console.WriteLine("  is false, and a second one is then a compile error (CS0579).");
        var derived = typeof(RecurringInstruction).GetProperty(nameof(PaymentInstruction.Reference))!;
        Console.WriteLine($"  [Required] visible on a derived type's property : " +
                          $"{derived.GetCustomAttribute&lt;RequiredAttribute&gt;() is not null}");
        Console.WriteLine("  Inherited = true on the attribute, plus GetCustomAttribute's own");
        Console.WriteLine("  default of inherit: true. Both have to agree.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static long _sink;

    static double Time(Action a)
    {
        for (var i = 0; i &lt; 10_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 200_000; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / 200_000;
    }

    static long AllocOf(Action a)
    {
        a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        a();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }
}

public sealed class RecurringInstruction : PaymentInstruction
{
    public int EveryDays { get; set; }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- validating ---
  Reference: is required
  AmountMinor: must be between 1 and 100000000
  Currency: must be one of GBP, EUR, USD
  a valid instance produces : 0 errors
  types cached so far       : 1
  Note has no attributes, so no rule was built for it. The
  attribute is the schema and the class is the single source.

--- the two validators agree ---
  identical : True

--- and cost very different amounts ---
  cached (reflect once, then delegates) : 847 ns/op
  naive  (reflect every call)           : 12,269 ns/op
  ratio                                 : 14.5x

  allocation, cached : 616 bytes/call
  allocation, naive  : 2,792 bytes/call

--- what the difference means at request rates ---
  saved per validation : 11,422 ns
  at 1,000 req/s       : 11.42 ms of CPU per second
  at 20 validations/req: 228.4 ms of CPU per second
  The caching is one ConcurrentDictionary and it is the whole
  difference between a usable framework and a slow one.

--- attribute inheritance and multiplicity ---
  [AllowedValue] count on Currency : 3
  AllowMultiple = true is what permits three of them. The default
  is false, and a second one is then a compile error (CS0579).
  [Required] visible on a derived type's property : True
  Inherited = true on the attribute, plus GetCustomAttribute's own
  default of inherit: true. Both have to agree.
  (checksum 1260012)</code></pre>

  <p><strong>Identical results, 14.5× apart.</strong> Both validators produce the same three errors
  for the same input. The difference is one <code>ConcurrentDictionary&lt;Type, Rule[]&gt;</code>:
  the cached version reflects once per type and then runs compiled delegates; the naive one calls
  <code>GetProperties</code>, <code>GetCustomAttribute</code> and <code>GetValue</code> on every
  call.</p>

  <p><strong>At 1,000 requests per second that is 11.42 ms of CPU per second</strong> — about 1% of
  one core — and at twenty validations per request it is <strong>228.4 ms per second</strong>, a
  quarter of a core spent reading metadata that has not changed since the process started.</p>

  <p>Three details in the design are what make it work:</p>

  <p><strong>The cache key is <code>instance.GetType()</code>, not the declared type.</strong> A
  <code>RecurringInstruction</code> passed as a <code>PaymentInstruction</code> gets its own rules,
  including its own properties.</p>

  <p><strong>The rules capture their attribute data by value.</strong> <code>range.Min</code> and the
  <code>allowed</code> array are read once at build time and closed over, so the per-call path never
  touches an attribute object again.</p>

  <p><strong>The getter is a compiled expression, not a <code>PropertyInfo</code>.</strong> That is
  the 4,470-call break-even from the previous section, and a validator on a request path crosses it
  in the first few seconds.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>Attribute inheritance needs two things to agree.</strong>
    <code>Inherited = true</code> on the <code>[AttributeUsage]</code>, <em>and</em>
    <code>GetCustomAttribute</code>'s <code>inherit</code> parameter, which defaults to
    <code>true</code>. Set either to false and a derived type's members report no attribute — a
    common cause of "my validation stopped running on the subclass".</p>
  </div>
</section>

<section id="trimming">
  <h2>Trimming and ahead-of-time compilation</h2>

  <p class="define"><span class="define__term">Trimming</span> Removing code an application does not
  use, to shrink the deployed size. The trimmer keeps what it can see referenced.
  <span class="define__term">Ahead-of-time compilation</span> (AOT) compiling to native code at
  publish time, with no JIT compiler in the shipped binary — so <strong>no code can be generated at
  runtime</strong>.</p>

  <p>Reflection breaks both assumptions. <code>GetProperty("AmountMinor")</code> is a string, which
  the trimmer cannot follow, and <code>Expression.Compile()</code> generates code, which an AOT
  binary cannot do.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-trimming-and-aot.cs"><code>// 04-trimming-and-aot.cs — the two ways reflection stops working when the app is
// trimmed or compiled ahead of time, and the annotation that fixes one of them.
// This file runs with the file-based-app DEFAULT (PublishAot=true), which is
// exactly the configuration that exposes the problem.
// .NET 10.0.400. Run: dotnet run 04-trimming-and-aot.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Linq.Expressions;
using System.Reflection;
using System.Runtime.CompilerServices;

public sealed class Invoice
{
    public string Number { get; set; } = "INV-1";
    public long AmountMinor { get; set; } = 120_00;
}

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("--- what this runtime supports ---");
        Console.WriteLine($"  RuntimeFeature.IsDynamicCodeSupported : {RuntimeFeature.IsDynamicCodeSupported}");
        Console.WriteLine($"  RuntimeFeature.IsDynamicCodeCompiled  : {RuntimeFeature.IsDynamicCodeCompiled}");
        Console.WriteLine("  A file-based app defaults to PublishAot=true, so runtime code");
        Console.WriteLine("  generation is off — the same as a published AOT binary.");

        Console.WriteLine();
        Console.WriteLine("--- 1. Expression.Compile() silently becomes an INTERPRETER ---");
        var prop = typeof(Invoice).GetProperty(nameof(Invoice.AmountMinor))!;
        var param = Expression.Parameter(typeof(Invoice), "i");
        var compiled = Expression.Lambda&lt;Func&lt;Invoice, long&gt;&gt;(
            Expression.Property(param, prop), param).Compile();

        var invoice = new Invoice();
        Console.WriteLine($"  it still WORKS  : {compiled(invoice)}");
        var interpreted = Time(() =&gt; { _sink += compiled(invoice); });
        var direct = Time(() =&gt; { _sink += invoice.AmountMinor; });
        var getValue = Time(() =&gt; { _sink += (long)prop.GetValue(invoice)!; }, 200_000);
        Console.WriteLine($"  direct property read     : {Ns(direct),8:N1} ns/op");
        Console.WriteLine($"  PropertyInfo.GetValue    : {Ns(getValue, 200_000),8:N1} ns/op");
        Console.WriteLine($"  \"compiled\" expression    : {Ns(interpreted),8:N1} ns/op");
        Console.WriteLine($"  allocation per call      : {AllocOf(() =&gt; _sink += compiled(invoice))} bytes");
        Console.WriteLine("  No exception, no warning at runtime — it works and it is");
        Console.WriteLine("  SLOWER than the reflection it was supposed to replace, and it");
        Console.WriteLine("  allocates. The same code on a JIT runtime is ~5.5 ns and 0 bytes.");
        Console.WriteLine("  This is the failure mode people miss, because nothing fails.");

        Console.WriteLine();
        Console.WriteLine("--- 2. the analyser warns at BUILD time, and that is the real signal ---");
        Console.WriteLine("  Expression.Compile() carries [RequiresDynamicCode], so building");
        Console.WriteLine("  an AOT-published app reports:");
        Console.WriteLine("    warning IL3050: Using member 'System.Linq.Expressions.Expression");
        Console.WriteLine("    &lt;TDelegate&gt;.Compile()' which has 'RequiresDynamicCodeAttribute'");
        Console.WriteLine("    can break functionality when AOT compiling.");
        Console.WriteLine("  Every file in this project that uses reflection carries a");
        Console.WriteLine("  '#:property NoWarn=...' line for exactly these codes. Suppressing");
        Console.WriteLine("  them is right for a demo and wrong for a shipping AOT app.");

        Console.WriteLine();
        Console.WriteLine("--- 3. trimming removes members nothing references statically ---");
        Console.WriteLine("  A trimmer keeps what it can SEE being used. It cannot see");
        Console.WriteLine("  GetProperty(\"AmountMinor\") — that is a string. So the property");
        Console.WriteLine("  may be removed and the lookup returns null at runtime:");
        Console.WriteLine("    NullReferenceException, in code that worked in Debug.");

        Console.WriteLine();
        Console.WriteLine("--- the annotation that fixes it ---");
        Console.WriteLine($"  Unannotated(typeof(Invoice)) : {Unannotated(typeof(Invoice))}");
        Console.WriteLine($"  Annotated(typeof(Invoice))   : {Annotated(typeof(Invoice))}");
        Console.WriteLine("  Both work here. The difference is what the TRIMMER is told:");
        Console.WriteLine("  [DynamicallyAccessedMembers] on the parameter makes it preserve");
        Console.WriteLine("  the public properties of every type that reaches it. Without it,");
        Console.WriteLine("  the trimmer warns IL2070 and preserves nothing.");

        Console.WriteLine();
        Console.WriteLine("--- what is safe under trimming and AOT ---");
        Console.WriteLine($"  typeof(Invoice).Name                  : {typeof(Invoice).Name}");
        Console.WriteLine($"  invoice.GetType().Name                : {invoice.GetType().Name}");
        Console.WriteLine($"  a cached delegate from CreateDelegate : safe, no codegen");
        var getter = typeof(Invoice).GetProperty(nameof(Invoice.AmountMinor))!
            .GetGetMethod()!.CreateDelegate&lt;Func&lt;Invoice, long&gt;&gt;();
        Console.WriteLine($"    calling it                          : {getter(invoice)}");
        Console.WriteLine($"    per-call cost                       : {Ns(Time(() =&gt; _sink += getter(invoice))):N1} ns/op");
        Console.WriteLine("  CreateDelegate binds to existing IL rather than emitting new");
        Console.WriteLine("  code, so it survives AOT — unlike Expression.Compile().");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // No annotation: the trimmer cannot know which members to keep. IL2070.
    [UnconditionalSuppressMessage("Trimming", "IL2070",
        Justification = "Demonstration of the unannotated case; the type is rooted in this file.")]
    static int Unannotated(Type type) =&gt; type.GetProperties().Length;

    // Annotated: the trimmer preserves public properties of whatever is passed.
    static int Annotated([DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicProperties)]
                         Type type) =&gt; type.GetProperties().Length;

    static double Time(Action a, int iterations = 1_000_000)
    {
        for (var i = 0; i &lt; Math.Min(iterations, 1_000); i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; iterations; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static double Ns(double ms, int iterations = 1_000_000) =&gt; ms * 1_000_000 / iterations;

    static long AllocOf(Action a)
    {
        a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        a();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- what this runtime supports ---
  RuntimeFeature.IsDynamicCodeSupported : False
  RuntimeFeature.IsDynamicCodeCompiled  : False
  A file-based app defaults to PublishAot=true, so runtime code
  generation is off — the same as a published AOT binary.

--- 1. Expression.Compile() silently becomes an INTERPRETER ---
  it still WORKS  : 12000
  direct property read     :      5.4 ns/op
  PropertyInfo.GetValue    :    134.5 ns/op
  "compiled" expression    :    258.0 ns/op
  allocation per call      : 176 bytes
  No exception, no warning at runtime — it works and it is
  SLOWER than the reflection it was supposed to replace, and it
  allocates. The same code on a JIT runtime is ~5.5 ns and 0 bytes.
  This is the failure mode people miss, because nothing fails.

--- 2. the analyser warns at BUILD time, and that is the real signal ---
  Expression.Compile() carries [RequiresDynamicCode], so building
  an AOT-published app reports:
    warning IL3050: Using member 'System.Linq.Expressions.Expression
    &lt;TDelegate&gt;.Compile()' which has 'RequiresDynamicCodeAttribute'
    can break functionality when AOT compiling.
  Every file in this project that uses reflection carries a
  '#:property NoWarn=...' line for exactly these codes. Suppressing
  them is right for a demo and wrong for a shipping AOT app.

--- 3. trimming removes members nothing references statically ---
  A trimmer keeps what it can SEE being used. It cannot see
  GetProperty("AmountMinor") — that is a string. So the property
  may be removed and the lookup returns null at runtime:
    NullReferenceException, in code that worked in Debug.

--- the annotation that fixes it ---
  Unannotated(typeof(Invoice)) : 2
  Annotated(typeof(Invoice))   : 2
  Both work here. The difference is what the TRIMMER is told:
  [DynamicallyAccessedMembers] on the parameter makes it preserve
  the public properties of every type that reaches it. Without it,
  the trimmer warns IL2070 and preserves nothing.

--- what is safe under trimming and AOT ---
  typeof(Invoice).Name                  : Invoice
  invoice.GetType().Name                : Invoice
  a cached delegate from CreateDelegate : safe, no codegen
    calling it                          : 12000
    per-call cost                       : 6.7 ns/op
  CreateDelegate binds to existing IL rather than emitting new
  code, so it survives AOT — unlike Expression.Compile().
  (checksum 38448024000)</code></pre>

  <p><strong>The AOT failure does not throw. It gets slower.</strong> With runtime code generation
  unavailable, <code>Expression.Compile()</code> returns a working delegate backed by an
  <em>interpreter</em>: measured at <strong>258.0 ns and 176 bytes per call</strong> against
  <strong>5.5 ns and 0 bytes</strong> on a JIT runtime — and slower than the
  <code>PropertyInfo.GetValue</code> it was written to replace.</p>

  <p>That is the shape worth remembering. A serialiser tuned with compiled expressions, published
  AOT, silently becomes 47× slower per property read with no error, no warning at runtime, and a
  test suite that passes because it runs on the JIT.</p>

  <p class="define"><span class="define__term">DynamicallyAccessedMembers</span> An annotation on a
  <code>Type</code> parameter, field or property telling the trimmer which members to preserve for
  whatever type flows through it. Without it, a method calling <code>type.GetProperties()</code>
  earns <code>IL2070</code> and the trimmer preserves nothing.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Warning</th><th>Means</th><th>Fix</th></tr></thead>
    <tbody>
      <tr><td><code>IL2026</code></td><td>Calling a member marked
          <code>[RequiresUnreferencedCode]</code></td>
          <td>Use a source-generated alternative, or mark your own method the same way and push the
          decision to the caller.</td></tr>
      <tr><td><code>IL2070</code></td><td>A <code>Type</code> parameter is reflected over without
          annotation</td>
          <td><code>[DynamicallyAccessedMembers(...)]</code> on the parameter.</td></tr>
      <tr><td><code>IL2075</code></td><td>The <code>Type</code> came from
          <code>GetType()</code> and cannot be tracked</td>
          <td>Annotate the field or property it came from.</td></tr>
      <tr><td><code>IL3050</code></td><td>Calling a member marked
          <code>[RequiresDynamicCode]</code></td>
          <td>Replace <code>Expression.Compile()</code> with
          <code>CreateDelegate</code> or a source generator.</td></tr>
    </tbody>
  </table>
  </div>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Suppressing these warnings is how the silent failure ships.</strong> Every
    verification file in this module carries a <code>NoWarn</code> line, which is right for a
    demonstration and wrong for an application. In a project that publishes AOT or trimmed, treat
    <code>IL2xxx</code> and <code>IL3xxx</code> as errors — they are the only warning you will
    get.</p>
  </div>
</section>

<section id="what-replaced-it">
  <h2>What the framework replaced reflection with</h2>

  <p>Every major reflective API in .NET now ships a non-reflective alternative, and the reason is
  the previous section: trimming and AOT. Knowing which is which decides how a modern service is
  built.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Job</th><th>The reflective way</th><th>What replaced it</th></tr></thead>
    <tbody>
      <tr><td>JSON</td><td><code>JsonSerializer.Serialize(obj)</code> reflecting over the
          type</td>
          <td><code>[JsonSerializable]</code> on a
          <code>JsonSerializerContext</code>, generating the code at build time.</td></tr>
      <tr><td>Configuration binding</td><td><code>Configuration.Get&lt;T&gt;()</code></td>
          <td>The configuration-binding source generator, on by default for AOT.</td></tr>
      <tr><td>Logging</td><td><code>LogInformation("{X}", x)</code> boxing and formatting at
          runtime</td>
          <td><code>[LoggerMessage]</code>, generating a strongly-typed method.</td></tr>
      <tr><td>Regular expressions</td><td><code>new Regex(pattern)</code> interpreting or emitting
          IL</td>
          <td><code>[GeneratedRegex]</code>, emitting a matcher as C# at build time.</td></tr>
      <tr><td>Dependency injection</td><td>Scanning assemblies for implementations</td>
          <td>Explicit registration; some containers generate it.</td></tr>
      <tr><td>Object mapping</td><td>Reflecting over both types per call</td>
          <td>Generators such as Mapperly, or hand-written mapping.</td></tr>
    </tbody>
  </table>
  </div>

  <p>The pattern is identical in every row: <strong>move the discovery from runtime to build
  time</strong>. That removes the per-call cost, removes the trimming hazard, and turns
  "the property was not found" from a runtime null into a compile error.</p>

  <pre data-lang="csharp" data-net="10" data-title="The same job, both ways"><code>using System.Text.Json;
using System.Text.Json.Serialization;

// Reflective: works everywhere, warns IL2026 and IL3050 under trimming/AOT.
var json = JsonSerializer.Serialize(invoice);

// Source-generated: the serialiser for Invoice is written at build time.
[JsonSerializable(typeof(Invoice))]
internal partial class LedgerJsonContext : JsonSerializerContext { }

var json = JsonSerializer.Serialize(invoice, LedgerJsonContext.Default.Invoice);</code></pre>

  <p>The second version has no reflection at runtime, no warnings, and the trimmer keeps exactly the
  members the generated code names — because it can see them being used.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>This is not a reason to avoid reflection.</strong> It is a reason to know which of the
    two categories a piece of work is in. <strong>If the set of types is known when you compile, a
    generator is better on every axis.</strong> If it genuinely is not — a plugin system loading
    assemblies chosen by configuration, a debugger, a test runner — reflection is the only tool that
    exists, and the job is then to reflect once and cache.</p>
  </div>

  <p><a href="#/m/t1-32-source-generators">Source Generators</a> is about writing one of these
  yourself, and the argument for doing so is the numbers in this module: the 14.5× the cached
  validator saved is what a generator gives you for free, with no cache, no
  <code>ConcurrentDictionary</code>, and no <code>IL2xxx</code> warnings to suppress.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Reflecting on every call</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: 14.5x slower for identical output"><code>// WRONG. Measured: 12,269 ns/op and 2,792 bytes per call, against 847 ns and
// 616 bytes for the cached version — for exactly the same three error messages.
foreach (var property in instance.GetType().GetProperties())
{
    var value = property.GetValue(instance);
    if (property.GetCustomAttribute&lt;RequiredAttribute&gt;() is not null &amp;&amp; value is null)
        errors.Add($"{property.Name}: is required");
}

// Right: a ConcurrentDictionary&lt;Type, Rule[]&gt; built once per type, holding
// compiled getters and the attribute data already read out.
var rules = Cache.GetOrAdd(instance.GetType(), BuildRules);
foreach (var rule in rules) { /* delegate calls only */ }</code></pre>

  <h3>2. Catching the wrong exception around <code>Invoke</code></h3>

  <p>Measured: a method throwing <code>InvalidOperationException</code> surfaced as
  <code>TargetInvocationException</code>. Catch that and inspect
  <code>InnerException</code> — or use a delegate, which does not wrap.</p>

  <h3>3. <code>Expression.Compile()</code> in an AOT application</h3>

  <p>Measured: <strong>258.0 ns and 176 bytes</strong> against 5.5 ns and 0 bytes on a JIT runtime.
  Nothing throws. The only signal is <code>IL3050</code> at build time.</p>

  <h3>4. Compiling an expression per call</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: 120 microseconds, every time"><code>// WRONG. Compile() measured at 120,346 ns. Doing it per call is roughly
// 2,600x worse than the PropertyInfo.GetValue it replaces.
public static object? Read(object instance, PropertyInfo property)
{
    var p = Expression.Parameter(typeof(object), "i");
    var body = Expression.Convert(
        Expression.Property(Expression.Convert(p, instance.GetType()), property), typeof(object));
    return Expression.Lambda&lt;Func&lt;object, object?&gt;&gt;(body, p).Compile()(instance);
}

// Right: compile once, cache the delegate, call it forever.
private static readonly ConcurrentDictionary&lt;PropertyInfo, Func&lt;object, object?&gt;&gt; Getters = new();
public static object? Read(object instance, PropertyInfo property)
    =&gt; Getters.GetOrAdd(property, p =&gt; CompileGetter(instance.GetType(), p))(instance);</code></pre>

  <h3>5. Assembly scanning in an app that will be trimmed</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: starts with zero plugins and no error"><code>// WRONG in any trimmed or AOT-published app. Assembly.GetTypes() is
// [RequiresUnreferencedCode] (IL2026): nothing references the handler types, so
// the trimmer removes them and this loop finds none. No exception, no log line.
foreach (var type in typeof(Program).Assembly.GetTypes())
{
    if (typeof(IEventHandler).IsAssignableFrom(type) &amp;&amp; !type.IsAbstract)
        Register((IEventHandler)Activator.CreateInstance(type)!);
}

// Right: name the types, which gives the trimmer real references and removes
// the scan entirely.
private static readonly Type[] HandlerTypes =
{
    typeof(AuthorisedHandler), typeof(DeclinedHandler), typeof(SettledHandler)
};

foreach (var type in HandlerTypes)
    Register((IEventHandler)Activator.CreateInstance(type)!);</code></pre>

  <h3>6. Trusting <code>required</code>, <code>init</code> or <code>private</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the guarantee is a compiler rule"><code>// WRONG. Verified: reflection created this with every required member unset and
// Number holding null, and threw nothing.
public sealed record Invoice
{
    public required string Number { get; init; }
}

var fromDeserialiser = (Invoice)Activator.CreateInstance(typeof(Invoice))!;
Use(fromDeserialiser.Number.Length);   // NullReferenceException, no warning anywhere

// Right: if the invariant matters at runtime, check it at runtime.
public sealed record Invoice
{
    public required string Number { get; init; }

    public void Validate() =&gt; ArgumentException.ThrowIfNullOrWhiteSpace(Number, nameof(Number));
}</code></pre>

  <p>All three are compiler rules. Measured: reflection wrote to an <code>init</code>-only property,
  created an object with every <code>required</code> member unset, and read a private one. If an
  invariant matters at runtime, it needs a runtime check.</p>

  <h3>7. <code>Type.GetType(string)</code> for a type you could name</h3>

  <p>Measured at <strong>1,401.5 ns</strong> against 7.9 ns for <code>typeof</code>, and it is the
  first thing to break under trimming because there is no reference for the trimmer to follow.</p>

  <h3>8. <code>BindingFlags</code> that returns nothing</h3>

  <p>Measured: <code>GetMethods(BindingFlags.NonPublic)</code> returned <strong>0</strong>. The flags
  replace the default entirely, so <code>Instance</code> or <code>Static</code> must always be
  present.</p>

  <h3>9. Scanning assemblies per request</h3>

  <p>Measured at 4,268 ns for an assembly with 9 types. A real service assembly is milliseconds and
  scanning every loaded one is tens to hundreds. Startup, once.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A reflective lookup returns null in production and works locally.</strong> Trimming.
    The member was removed because nothing referenced it statically. Publish with
    <code>&lt;TrimmerSingleWarn&gt;false&lt;/TrimmerSingleWarn&gt;</code> to see every
    <code>IL2xxx</code> individually, and annotate the <code>Type</code> parameter with
    <code>[DynamicallyAccessedMembers]</code>.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>An AOT build is inexplicably slower than the JIT build.</strong> Check
    <code>RuntimeFeature.IsDynamicCodeCompiled</code> at startup and log it. If it is
    <code>false</code> and the code path uses <code>Expression.Compile()</code>, that is the answer:
    measured 258.0 ns against 5.5 ns for the same delegate. Replace it with
    <code>CreateDelegate</code> or a source generator.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A profiler shows time in <code>System.Reflection</code>.</strong> Look for lookups
    inside a loop or a per-request path. <code>GetProperty</code> at 57.8 ns and
    <code>GetCustomAttribute</code> are individually cheap and appear thousands of times a second.
    Cache by <code>Type</code>.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>An attribute stops being found on a derived type.</strong> Two switches must both be
    on: <code>Inherited = true</code> on the <code>[AttributeUsage]</code>, and
    <code>GetCustomAttribute</code>'s <code>inherit</code> parameter. Note that
    <code>Inherited</code> applies to class and member inheritance but never to interfaces — an
    attribute on an interface member is not visible on the implementation.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A framework stopped calling your handler.</strong> Print the exception type it caught.
    If it is <code>TargetInvocationException</code>, the framework invoked you reflectively and your
    real exception is one level down — and any <code>catch</code> it wrote for the specific type
    missed it.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Deciding whether reflection belongs here at all.</strong> Ask what varies. If the set
    of types is known at compile time, a switch, a dictionary of delegates, or a source generator
    (<a href="#/m/t1-32-source-generators">Source Generators</a>) is faster, trimmable and
    debuggable. Reflection earns its place when the types genuinely are not known until
    runtime.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A concrete case.</strong> Ledger's payment-instruction API validated incoming requests
    with an attribute-driven validator of the kind above. It handled about 800 requests per second at
    peak, each carrying a batch of up to 20 instructions, so roughly 16,000 validations a
    second.</p>
    <p>The validator was the naive shape: <code>GetProperties()</code> and
    <code>GetCustomAttribute</code> on every property of every instruction, every time. Measured
    here, that is <strong>12,269 ns per validation</strong> against 847 ns cached, so about
    <strong>196 ms of CPU per second</strong> — a fifth of a core — spent reading metadata that had
    not changed since startup.</p>
    <p>That was tolerable and nobody looked at it. The change that made it matter was a deployment
    move to smaller instances, which took the service from 4 vCPUs to 2. Peak CPU went from 55% to
    a little over 90%, and the p99 latency roughly tripled — not from the validator's own time, but
    because 2,792 bytes of allocation per validation at 16,000 a second is
    <strong>44 MB/s of garbage</strong>, and gen-0 collections went from occasional to constant.</p>
    <p>The profiler pointed at <code>System.Reflection</code> and at the GC, which read as two
    separate problems. It took two days to connect them, because the validator had never been changed
    and therefore was not a suspect.</p>
    <p>The fix was the <code>ConcurrentDictionary&lt;Type, Rule[]&gt;</code> — about thirty lines.
    Validation cost dropped <strong>14.5×</strong>, allocation dropped <strong>4.5×</strong>, peak
    CPU returned to around 40% on the smaller instances, and p99 went below its original figure.</p>
  </div>

  <p>The general principle: <strong>reflection's cost is per call, and metadata does not
  change</strong>. Every reflective framework worth using — the JSON serialiser, the DI container,
  the ORM, the model binder — is built on the same two-phase shape: reflect once per type into a
  cached plan, then execute the plan with delegates.</p>

  <p>Which reframes the usual question. "Is reflection slow?" is not useful; a cached
  <code>PropertyInfo</code> read is 32 ns and nobody has ever had an outage from that.
  <strong>"How many times per second am I discovering something I already knew?"</strong> is the
  question that finds the problem.</p>

  <p>And the modern addition to that: <strong>a reflective design is a bet that the runtime will be
  able to do what you asked.</strong> Under trimming it may not find the member; under AOT it may not
  be able to generate the code. Both are decided at publish time by people who may not know what your
  code does at runtime, which is why the <code>IL2xxx</code> and <code>IL3xxx</code> warnings exist
  and why suppressing them is how the silent version ships.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Reflection is slow."</strong> Too blunt. Measured: a cached
    <code>PropertyInfo.GetValue</code> is <strong>32.4 ns</strong>, six times a direct read.
    <code>Type.GetType(string)</code> is <strong>1,401.5 ns</strong>, forty-four times worse than
    that. The two need different responses.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Compiled expressions are always faster."</strong> Only after the break-even, measured
    at about <strong>4,470 calls</strong> — and on an AOT runtime they are <em>slower</em> than
    reflection: <strong>258.0 ns and 176 bytes</strong> per call, because
    <code>Compile()</code> falls back to an interpreter.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>private</code> and <code>init</code> protect data at runtime."</strong> They
    do not. Verified: reflection read a private member with one
    <code>BindingFlags</code> value and wrote to an <code>init</code>-only property.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>required</code> guarantees the object is complete."</strong> At compile time,
    yes — <code>CS9035</code>. Verified: <code>Activator.CreateInstance</code> produced an object
    with every <code>required</code> property unset and threw nothing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>BindingFlags.NonPublic</code> adds private members to the results."</strong> It
    replaces the default. Verified: <code>GetMethods(BindingFlags.NonPublic)</code> returned
    <strong>0</strong> — <code>Instance</code> or <code>Static</code> must also be present.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"An attribute does something."</strong> It is inert data in metadata. Something has to
    read it. <code>[Required]</code> validates nothing until a validator looks for it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"AOT will tell me if reflection breaks."</strong> At build time, through
    <code>IL2xxx</code>/<code>IL3xxx</code> warnings — which are warnings. At runtime it may throw,
    return null, or silently run 47× slower. Verified: the last one produced no diagnostic at
    all.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>The type is known at compile time</td><td>Do not use reflection</td>
          <td>A switch or a dictionary of delegates is faster, trimmable and debuggable.</td></tr>
      <tr><td>Discovering members of a type</td><td>Once, cached by <code>Type</code></td>
          <td>Measured 14.5× and 4.5× allocation for the same output.</td></tr>
      <tr><td>Calling a member whose signature you know</td><td><code>CreateDelegate</code></td>
          <td>15.2 ns and 0 bytes, breaking even after ~20 calls, and AOT-safe.</td></tr>
      <tr><td>Calling a member with a signature only known at runtime, often</td>
          <td>A compiled expression, cached</td>
          <td>Matches a direct call; break-even ~4,470 calls.</td></tr>
      <tr><td>The same, but the app publishes AOT</td><td><code>CreateDelegate</code> or a source
          generator</td>
          <td><code>Compile()</code> becomes an interpreter: 258 ns and 176 bytes.</td></tr>
      <tr><td>Calling something a handful of times</td><td>A cached
          <code>PropertyInfo</code></td><td>32 ns. The complexity is not worth it.</td></tr>
      <tr><td>Naming a type</td><td><code>typeof</code></td>
          <td>7.9 ns against 1,401.5 ns, and it survives trimming.</td></tr>
      <tr><td>Any method taking a <code>Type</code> and reflecting over it</td>
          <td><code>[DynamicallyAccessedMembers]</code></td>
          <td>The only way the trimmer knows what to keep.</td></tr>
      <tr><td>An app that publishes trimmed or AOT</td><td>Treat <code>IL2xxx</code>/<code>IL3xxx</code>
          as errors</td><td>They are the only warning you get before a silent failure.</td></tr>
      <tr><td>Scanning assemblies for plugins</td><td>At startup, once</td>
          <td>Milliseconds per assembly, and it belongs nowhere near a request.</td></tr>
      <tr><td>Catching failures from <code>Invoke</code></td><td>Catch
          <code>TargetInvocationException</code>, inspect <code>InnerException</code></td>
          <td>The real exception is wrapped.</td></tr>
      <tr><td>An invariant that must hold at runtime</td><td>Check it at runtime</td>
          <td><code>required</code>, <code>init</code> and <code>private</code> are compiler
          rules.</td></tr>
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
    <p>Given a class with three public properties, one private property, one public method and one
    private method, say what each of these returns.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>typeof(Payment).GetProperties()
typeof(Payment).GetProperties(BindingFlags.Public | BindingFlags.Instance)
typeof(Payment).GetProperties(BindingFlags.NonPublic | BindingFlags.Instance)
typeof(Payment).GetProperties(BindingFlags.NonPublic)
typeof(Payment).GetMethod("Hidden")
typeof(Payment).GetMethod("Hidden", BindingFlags.NonPublic | BindingFlags.Instance)</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>GetProperties()                       : 3
GetProperties(Public|Instance)        : 3
GetProperties(NonPublic|Instance)     : 1
GetProperties(NonPublic)              : 0
GetMethod("Hidden")                   : (null)
GetMethod("Hidden", NonPublic|Instance): Hidden</code></pre>
        <p><strong>The fourth line is the one worth remembering: <code>0</code>.</strong>
        <code>BindingFlags</code> is not a filter added to a sensible default — it
        <em>is</em> the specification, and a lookup with no <code>Instance</code> and no
        <code>Static</code> matches nothing at all.</p>
        <p>The no-argument overload behaves as
        <code>Public | Instance | Static</code>, which is why the first two lines agree.</p>
        <p><strong>The last two show that accessibility is a compiler concept.</strong>
        <code>GetMethod("Hidden")</code> returns null only because the default flags exclude
        non-public members; add <code>NonPublic | Instance</code> and the private method is right
        there, callable. Nothing at runtime enforces <code>private</code>.</p>
        <p>The practical habit that follows: <strong>always write the flags explicitly</strong> when
        you mean something specific. Relying on the default is how a lookup silently stops finding a
        member after someone changes its accessibility.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Write an attribute that marks properties as audited, with an optional reason, and code that
    lists every public property of a type with its audit status.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="The attribute and the reader"><code>using System;
using System.Reflection;

[AttributeUsage(AttributeTargets.Property)]
public sealed class AuditedAttribute : Attribute
{
    public string? Reason { get; init; }
}

public class Payment
{
    [Audited(Reason = "regulatory")] public string Reference { get; set; } = "P-1";
    [Audited] public long AmountMinor { get; set; } = 5_000;
    public string Note { get; set; } = "internal";
}

foreach (var p in typeof(Payment).GetProperties(BindingFlags.Public | BindingFlags.Instance))
{
    var audited = p.GetCustomAttribute&lt;AuditedAttribute&gt;();
    Console.WriteLine($"{p.Name,-12} audited={audited is not null,-5} " +
                      $"reason={audited?.Reason ?? "(none)"}");
}</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>Reference    audited=True  reason=regulatory
AmountMinor  audited=True  reason=(none)
Note         audited=False reason=(none)</code></pre>
        <p><strong><code>Reason</code> is a settable property, so it is a <em>named</em>
        argument.</strong> Constructor parameters are positional
        (<code>[Audited("regulatory")]</code>); settable members are named
        (<code>[Audited(Reason = "regulatory")]</code>). Which you choose decides whether the value
        is mandatory — a constructor parameter cannot be omitted, a named argument can, as
        <code>AmountMinor</code> shows.</p>
        <p><strong><code>GetCustomAttribute&lt;T&gt;()</code> returns an instance, not a
        boolean.</strong> The attribute object is constructed at the moment you ask for it, from the
        arguments stored in metadata. That is why reading attributes has a cost worth caching, and
        why two calls return two different objects.</p>
        <p><strong>What the attribute does on its own: nothing.</strong>
        <code>[Audited]</code> changes no behaviour anywhere until this loop reads it. That is the
        whole model — attributes are inert data and the reader supplies all the meaning.</p>
        <p>One design note: <code>[AttributeUsage(AttributeTargets.Property)]</code> makes putting it
        on a class or a method a compile error, which is worth doing. Without it the default is
        <code>AttributeTargets.All</code>, and a misplaced attribute is then silently ignored by a
        reader that only looks at properties.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Measure five ways of reading the same property and say when each is the right choice.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>direct                     :      5.0 ns/op   1.0x
GetProperty + GetValue     :     93.7 ns/op      19x
cached PropertyInfo        :     34.6 ns/op       7x
CreateDelegate             :      6.5 ns/op     1.3x
compiled expression        :      5.2 ns/op     1.0x</code></pre>
        <p><strong>The single biggest win is caching the <code>PropertyInfo</code>: 19× down to
        7×</strong>, for one dictionary and no other change. Everything after that is a smaller
        improvement with more machinery.</p>
        <div class="table-wrap">
        <table>
          <thead><tr><th>Approach</th><th>Use when</th></tr></thead>
          <tbody>
            <tr><td>Direct</td><td>The property is known at compile time. Always prefer this.</td></tr>
            <tr><td>Lookup + <code>GetValue</code></td><td>Never in a loop. Fine in a one-off
                diagnostic or a startup path.</td></tr>
            <tr><td>Cached <code>PropertyInfo</code></td><td>Tens to hundreds of calls. Simple, and
                34.6 ns is invisible at that rate.</td></tr>
            <tr><td><code>CreateDelegate</code></td><td>The signature is known and the call is hot.
                Breaks even in ~20 calls and is AOT-safe.</td></tr>
            <tr><td>Compiled expression</td><td>The signature is only known at runtime and the call
                is very hot. Break-even ~4,470 calls, and <strong>not</strong> under AOT.</td></tr>
          </tbody>
        </table>
        </div>
        <p><strong>Why <code>CreateDelegate</code> is 1.3× and the expression is 1.0×.</strong> The
        delegate here is <code>Func&lt;Payment, long&gt;</code>, so calling it is a delegate
        invocation — the ~2.8 ns
        <a href="#/m/t1-21-delegates">Delegates</a> measured. The compiled expression is the same
        shape and the JIT inlined it in this benchmark. On any real workload the two are
        interchangeable, and <code>CreateDelegate</code> wins on build cost (400 ns against 120,346
        ns) and on AOT compatibility.</p>
        <p><strong>The measurement that should change a decision</strong> is the first two lines: if
        a codebase is doing lookup-plus-<code>GetValue</code> in a loop, caching the
        <code>PropertyInfo</code> is a one-line change worth more than any of the rest.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Build a plugin loader: discover every type implementing an interface, instantiate each, and
    expose their methods as delegates. Then say what it costs, where it belongs, and how it breaks
    under trimming.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="The loader"><code>static Dictionary&lt;string, Func&lt;string, string&gt;&gt; DiscoverHandlers()
{
    var result = new Dictionary&lt;string, Func&lt;string, string&gt;&gt;(StringComparer.Ordinal);
    foreach (var type in typeof(Program).Assembly.GetTypes())
    {
        if (type.IsAbstract || type.IsInterface) continue;
        if (!typeof(IEventHandler).IsAssignableFrom(type)) continue;

        var instance = (IEventHandler)Activator.CreateInstance(type)!;
        var handle = type.GetMethod(nameof(IEventHandler.Handle))!;
        result[type.Name] = handle.CreateDelegate&lt;Func&lt;string, string&gt;&gt;(instance);
    }
    return result;
}</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>handlers found : 3
  AuthorisedHandler -&gt; authorised P-9
  DeclinedHandler -&gt; declined P-9
  SettledHandler -&gt; settled P-9

the same discovery, timed:
  per discovery : 4,268 ns
  done once at startup : 0.004 ms
  types scanned : 9
Microseconds — but this assembly has a handful of types. A
real service assembly with a few thousand is milliseconds, and
scanning every LOADED assembly is tens to hundreds. Either way
it belongs at startup, once, not per request.</code></pre>
        <p><strong>The two guard clauses are not optional.</strong>
        <code>IsAssignableFrom</code> is true for the interface itself and for any abstract base, and
        <code>Activator.CreateInstance</code> on either throws. Skipping them is the most common bug
        in a first plugin loader.</p>
        <p><strong>The delegate is bound to the instance.</strong>
        <code>CreateDelegate&lt;Func&lt;string, string&gt;&gt;(instance)</code> produces a closed
        delegate — the receiver is captured, so calls afterwards are ordinary delegate invocations at
        about 15 ns rather than <code>Invoke</code> at 45 ns with 24 bytes of boxing.</p>
        <p><strong>Where it belongs: startup.</strong> 4,268 ns for 9 types here; a real service
        assembly with a few thousand types is milliseconds, and
        <code>AppDomain.CurrentDomain.GetAssemblies()</code> across a loaded ASP.NET Core app is tens
        to hundreds. Once, into a dictionary, is the only acceptable shape.</p>
        <p><strong>How it breaks under trimming</strong> — and it does, in two places at once:</p>
        <ul>
          <li><code>Assembly.GetTypes()</code> is <code>[RequiresUnreferencedCode]</code>
          (<code>IL2026</code>): the trimmer may have removed the handler types entirely, because
          nothing references them. The loop then finds nothing and the application starts with zero
          handlers and no error.</li>
          <li><code>Activator.CreateInstance(type)</code> needs the constructor preserved
          (<code>IL2072</code>), and <code>GetMethod</code> needs the method preserved.</li>
        </ul>
        <p><strong>The fixes, in order of preference.</strong> Register handlers explicitly — a
        <code>static readonly</code> array of <code>typeof(...)</code> entries gives the trimmer real
        references and removes the scan. Or generate the registration at compile time with a source
        generator (<a href="#/m/t1-32-source-generators">Source Generators</a>), which is what the
        modern DI and serialisation libraries do. Annotating with
        <code>[DynamicallyAccessedMembers]</code> works for a <code>Type</code> that flows through a
        parameter, but cannot help with <code>GetTypes()</code>, where the types are never named at
        all.</p>
        <p>That is the honest summary of assembly scanning: <strong>convenient, and the single
        least trimmable pattern in .NET</strong>. Every framework that used to rely on it now ships a
        source-generated alternative.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is reflection reading?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Metadata</strong> — the description of every type, member, parameter and attribute
        that the compiler writes into the assembly alongside the IL. It is generated from the code, so
        it cannot disagree with it.</p>
      </div></details>
    </li>
    <li>
      <p>What are the two halves of reflection's cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Discovery</strong> (<code>GetProperty</code> at 57.8 ns,
        <code>Type.GetType</code> at 1,401.5 ns) — done once and cached. <strong>Invocation</strong>
        (<code>GetValue</code> at 6× a direct read, 24 bytes) — replaced with a delegate.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>CreateDelegate</code> buy, and at what build cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>15.2 ns and 0 bytes</strong> — the same as a direct call — for a one-off
        <strong>400 ns</strong>. It breaks even in about 20 calls and is AOT-safe.</p>
      </div></details>
    </li>
    <li>
      <p>When is <code>Expression.Compile()</code> worth it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Above about <strong>4,470 calls</strong> (120,346 ns to build, then 5.5 ns per call) —
        and <strong>never under AOT</strong>, where it becomes an interpreter at 258.0 ns and 176
        bytes.</p>
      </div></details>
    </li>
    <li>
      <p>What is the AOT failure mode people miss?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>It does not throw — it gets slower.</strong> Measured: 258.0 ns against 5.5 ns for
        the same compiled expression, with no runtime error and no runtime warning. The only signal
        is <code>IL3050</code> at build time.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>BindingFlags.NonPublic</code> alone return?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Nothing</strong> — verified, 0 members. The flags replace the default rather than
        adding to it, so <code>Instance</code> or <code>Static</code> must be present.</p>
      </div></details>
    </li>
    <li>
      <p>Which compile-time guarantees does reflection ignore?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>private</code>, <code>init</code> and <code>required</code> — all verified. It read a
        private member, wrote to an init-only property, and created an object with every
        <code>required</code> member unset.</p>
      </div></details>
    </li>
    <li>
      <p>What exception do you catch around <code>MethodInfo.Invoke</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>TargetInvocationException</code>, and inspect its <code>InnerException</code>. A
        catch for the real exception type misses it entirely.</p>
      </div></details>
    </li>
    <li>
      <p>What does an attribute do?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Nothing. It is inert data in metadata, and the attribute object is constructed only when
        something asks for it. <code>[Required]</code> validates nothing until a validator reads
        it.</p>
      </div></details>
    </li>
    <li>
      <p>What two things must agree for attribute inheritance to work?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Inherited = true</code> on the <code>[AttributeUsage]</code>, and
        <code>GetCustomAttribute</code>'s <code>inherit</code> parameter. Neither applies across
        interfaces.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>[DynamicallyAccessedMembers]</code> do?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Tells the trimmer which members to preserve for any type flowing through that parameter,
        field or property. Without it, a method calling <code>type.GetProperties()</code> warns
        <code>IL2070</code> and the trimmer preserves nothing.</p>
      </div></details>
    </li>
    <li>
      <p>Why is assembly scanning the least trimmable pattern in .NET?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The types are never named, so there is no reference for the trimmer to follow and no
        annotation that can help. <code>GetTypes()</code> is
        <code>[RequiresUnreferencedCode]</code>; the app can start with zero plugins and no error.
        Explicit registration or a source generator is the fix.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
