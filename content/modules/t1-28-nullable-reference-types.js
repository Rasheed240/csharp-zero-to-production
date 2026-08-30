CSPREP.module({
  id: "t1-28-nullable-reference-types",
  minutes: 55,
  updated: "2026-08-30",
  summary: "The ? on a reference type is metadata the compiler reads and the runtime ignores completely. Everything useful and everything dangerous about the feature follows from that: warnings rather than errors, a flow analysis that is deliberately unsound in three named places, and a null-forgiving operator that emits no code at all.",
  terms: ["nullable reference types", "nullable annotation", "nullable context", "flow analysis",
    "null state", "null-forgiving operator", "oblivious", "NotNullWhen", "MaybeNullWhen",
    "NotNullIfNotNull", "MemberNotNull", "required", "NullabilityInfoContext",
    "CS8600", "CS8602", "CS8603", "CS8604", "CS8618", "CS8625", "CS9035"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>An invoice lookup in Ledger — the payments and invoicing service these modules keep returning
  to — returns an <code>Invoice</code>. Sometimes there is no such invoice, so sometimes it returns
  nothing. In C# before 2019, "nothing" and "an invoice" had the same type, and the signature could
  not tell you which one a given call would produce.</p>

  <p>So every caller had a choice: check for null and look defensive, or not check and be right most
  of the time. Both choices were guesses, because the only place the answer was written down was the
  documentation, if there was any.</p>

  <p class="define"><span class="define__term">NullReferenceException</span> The exception thrown
  when a member is accessed on a reference that holds nothing. Its message names no variable, no
  parameter and no member — which is why it is the hardest common exception to diagnose from a log
  line alone.</p>

  <p>The consequence is the most common exception in .NET.
  <code>NullReferenceException: Object reference not set to an instance of an object.</code> No
  parameter name, no variable name, no indication of which of the four dereferences on the line was
  the problem — a message that has been the single largest category of production failure in the
  ecosystem for two decades.</p>

  <p><strong>Nullable reference types are an attempt to move that information into the type
  system.</strong> This module is about what they actually do, which is less than the name suggests
  and more useful than the sceptics allow — and about the three places the analysis is deliberately
  unsound, because those are where the remaining exceptions come from.</p>
</section>

<section id="what-it-is">
  <h2>What the annotation actually is</h2>

  <p class="define"><span class="define__term">Nullable reference types</span> A compile-time
  analysis in which <code>string</code> means "will not be null" and <code>string?</code> means "may
  be null". The compiler tracks which is which and warns when the two are mixed.
  <strong>There is no runtime component whatsoever.</strong></p>

  <p class="define"><span class="define__term">Nullable annotation</span> The <code>?</code>. On a
  value type (<code>int?</code>) it produces a genuinely different type,
  <code>Nullable&lt;int&gt;</code>, with its own storage. On a reference type it produces
  <strong>no type at all</strong> — it is an attribute the compiler emits and reads.</p>

  <p class="define"><span class="define__term">Nullable context</span> Whether the analysis is on for
  a given piece of code. Set per project with
  <code>&lt;Nullable&gt;enable&lt;/Nullable&gt;</code>, or per file with
  <code>#nullable enable</code>. Off by default in a project created before .NET 6; on by default in
  the templates since.</p>

  <p>The analogy: an annotation is a <strong>label on a box saying "may be empty"</strong>. It
  changes what people do when they pick the box up, and it does not change what is in the box.
  <strong>The analogy is unusually exact</strong> — a mislabelled box still holds whatever it holds,
  and nothing in the warehouse checks.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-flow-analysis.cs"><code>// 01-flow-analysis.cs — what the compiler tracks, how it narrows, and the exact
// points where it gives up. Every claim here is a compiler diagnostic or a
// printed runtime value, not an assertion.
// .NET 10.0.400. Run: dotnet run 01-flow-analysis.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static string? _cache;
    static int _reads;

    // A property whose backing store can change between two reads.
    static string? Volatile
    {
        get { _reads++; return _reads % 2 == 1 ? "first" : null; }
    }

    static void Main()
    {
        Console.WriteLine("--- the annotation is the whole difference ---");
        string notNull = "value";
        string? maybeNull = null;
        Console.WriteLine($"  string  declared, holds : {notNull}");
        Console.WriteLine($"  string? declared, holds : {maybeNull ?? "(null)"}");
        Console.WriteLine("  Both are System.String at runtime. The ? is metadata the");
        Console.WriteLine("  compiler reads and the runtime ignores entirely.");
        Console.WriteLine($"  both locals report the same runtime type : " +
                          $"{notNull.GetType() == (maybeNull?.GetType() ?? typeof(string))}");
        Console.WriteLine("  typeof(string?) does not even compile: CS8639, 'The typeof");
        Console.WriteLine("  operator cannot be used on a nullable reference type' — there");
        Console.WriteLine("  is no such type for it to name.");

        Console.WriteLine();
        Console.WriteLine("--- narrowing: the compiler follows the control flow ---");
        string? input = Environment.TickCount &gt; 0 ? "present" : null;

        if (input is not null)
        {
            // No warning here: inside this branch the compiler knows it is not null.
            Console.WriteLine($"  inside 'is not null' : length {input.Length}");
        }

        if (input == null) return;
        // After an early return on null, it is non-null for the rest of the method.
        Console.WriteLine($"  after an early return : length {input.Length}");

        Console.WriteLine();
        Console.WriteLine("--- dereferencing is itself an assertion ---");
        string? probably = "x";
        Console.WriteLine($"  probably.Length : {probably.Length}");
        string stillFine = probably;   // no CS8600: line above proved it non-null
        Console.WriteLine($"  assigned to a non-nullable local afterwards, no warning");
        Console.WriteLine("  If it HAD been null, the line above would have thrown, so");
        Console.WriteLine("  reaching the next line proves it was not. That is why");
        Console.WriteLine("  'x.Foo(); string y = x;' produces exactly one warning.");
        Console.WriteLine($"  (value carried forward: {stillFine})");

        Console.WriteLine();
        Console.WriteLine("--- where it is UNSOUND: a property read twice ---");
        _reads = 0;
        if (Volatile is not null)
        {
            // No warning on this line. The compiler narrowed the property after
            // the check — and this second read is a second call to the getter.
            try
            {
                Console.WriteLine($"  compiler says non-null; actual length : {Volatile.Length}");
            }
            catch (NullReferenceException)
            {
                Console.WriteLine("  NullReferenceException — on a line the compiler approved.");
            }
        }
        _reads = 0;
        if (Volatile is not null)
        {
            var second = Volatile;
            Console.WriteLine($"  first read non-null, second read actually : {second ?? "(null)"}");
        }
        Console.WriteLine("  Two reads of a property are two CALLS to its getter, and the");
        Console.WriteLine("  compiler narrows across them anyway — no warning on the second");
        Console.WriteLine("  dereference. That is unsound, and it is how a property backed");
        Console.WriteLine("  by a cache, a lazy field or a request context produces a");
        Console.WriteLine("  NullReferenceException on a line the compiler approved.");
        Console.WriteLine("  The fix: read once into a local. 'var v = Volatile; if (v is");
        Console.WriteLine("  not null) ...' — then there is only one value to reason about.");

        Console.WriteLine();
        Console.WriteLine("--- where it stops: across a method call ---");
        _cache = "set";
        if (_cache is not null)
        {
            Clear();
            Console.WriteLine($"  after Clear(), the field is : {_cache ?? "(null)"}");
        }
        Console.WriteLine("  The compiler DID keep treating _cache as non-null after the");
        Console.WriteLine("  call — it does not model what a method does to a field. That");
        Console.WriteLine("  is unsound, and deliberately so: modelling it would require");
        Console.WriteLine("  whole-program analysis.");

        Console.WriteLine();
        Console.WriteLine("--- where it stops: collections and indexers ---");
        var byId = new Dictionary&lt;string, string?&gt; { ["a"] = "A", ["b"] = null };
        foreach (var key in new[] { "a", "b" })
        {
            var value = byId[key];
            Console.WriteLine($"  byId[{key}] = {value ?? "(null)"}");
        }
        var list = new List&lt;string?&gt; { "x", null };
        var nonNulls = list.Where(x =&gt; x is not null).ToList();
        Console.WriteLine($"  after Where(x =&gt; x is not null), element type is still string?");
        Console.WriteLine($"    count {nonNulls.Count}, and the compiler still warns on .Length");
        Console.WriteLine("    unless you use OfType&lt;string&gt;() or a null-forgiving operator.");
        Console.WriteLine($"  OfType&lt;string&gt;() count : {list.OfType&lt;string&gt;().Count()}");

        Console.WriteLine();
        Console.WriteLine("--- the runtime does not enforce any of it ---");
        var sneaked = MakeNull&lt;string&gt;();
        Console.WriteLine($"  a 'string' local holding null : {sneaked is null}");
        Console.WriteLine("  Nothing threw. Nullable reference types are a compile-time");
        Console.WriteLine("  analysis; there is no runtime check anywhere.");
    }

    static void Clear() =&gt; _cache = null;

    // Generic code without a class constraint can produce null for a reference T
    // without any warning, because T might legitimately be a nullable type.
    static T MakeNull&lt;T&gt;() =&gt; default!;
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- the annotation is the whole difference ---
  string  declared, holds : value
  string? declared, holds : (null)
  Both are System.String at runtime. The ? is metadata the
  compiler reads and the runtime ignores entirely.
  both locals report the same runtime type : True
  typeof(string?) does not even compile: CS8639, 'The typeof
  operator cannot be used on a nullable reference type' — there
  is no such type for it to name.

--- narrowing: the compiler follows the control flow ---
  inside 'is not null' : length 7
  after an early return : length 7

--- dereferencing is itself an assertion ---
  probably.Length : 1
  assigned to a non-nullable local afterwards, no warning
  If it HAD been null, the line above would have thrown, so
  reaching the next line proves it was not. That is why
  'x.Foo(); string y = x;' produces exactly one warning.
  (value carried forward: x)

--- where it is UNSOUND: a property read twice ---
  NullReferenceException — on a line the compiler approved.
  first read non-null, second read actually : (null)
  Two reads of a property are two CALLS to its getter, and the
  compiler narrows across them anyway — no warning on the second
  dereference. That is unsound, and it is how a property backed
  by a cache, a lazy field or a request context produces a
  NullReferenceException on a line the compiler approved.
  The fix: read once into a local. 'var v = Volatile; if (v is
  not null) ...' — then there is only one value to reason about.

--- where it stops: across a method call ---
  after Clear(), the field is : (null)
  The compiler DID keep treating _cache as non-null after the
  call — it does not model what a method does to a field. That
  is unsound, and deliberately so: modelling it would require
  whole-program analysis.

--- where it stops: collections and indexers ---
  byId[a] = A
  byId[b] = (null)
  after Where(x =&gt; x is not null), element type is still string?
    count 1, and the compiler still warns on .Length
    unless you use OfType&lt;string&gt;() or a null-forgiving operator.
  OfType&lt;string&gt;() count : 1

--- the runtime does not enforce any of it ---
  a 'string' local holding null : True
  Nothing threw. Nullable reference types are a compile-time
  analysis; there is no runtime check anywhere.</code></pre>

  <p><strong><code>typeof(string?)</code> does not compile.</strong> <code>CS8639: The typeof
  operator cannot be used on a nullable reference type.</code> That single diagnostic is the clearest
  statement of what the feature is: there is no such type for <code>typeof</code> to name. A
  <code>string?</code> and a <code>string</code> are the same runtime type, and the measurement
  confirms it.</p>

  <p class="define"><span class="define__term">Flow analysis</span> The compiler tracking, at each
  point in a method, whether each variable is currently known to be null, known not to be null, or
  unknown. <span class="define__term">Null state</span> that per-point knowledge — which is separate
  from the declared annotation and can differ from it.</p>

  <p>Two things follow from state being separate from annotation. First, <strong>a
  <code>string?</code> can be safely dereferenced</strong> after a check, because its state is
  not-null even though its annotation is nullable. Second, <strong>a dereference is itself a
  proof</strong>: after <code>probably.Length</code> succeeded, assigning <code>probably</code> to a
  non-nullable local produced no warning, because reaching that line means the previous one did not
  throw.</p>
</section>

<section id="unsound">
  <h2>The three places the analysis is wrong on purpose</h2>

  <p>The most important thing to know about this feature is where it lies to you. All three cases
  are deliberate design decisions, and all three produce
  <code>NullReferenceException</code> on lines the compiler approved.</p>

  <h3>1. A property read twice</h3>

  <p>Measured, and this is the one worth remembering: <code>if (Volatile is not null) { … Volatile.Length … }</code>
  produced <strong>no warning and a <code>NullReferenceException</code></strong>. Two reads of a
  property are two calls to its getter, and the compiler narrows across them as though they were one
  value.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: two getter calls, one assumption"><code>// WRONG. Verified: no warning, and NullReferenceException at runtime when the
// getter returns something different the second time.
if (context.CurrentUser is not null)
    Log($"user {context.CurrentUser.Name}");

// Right: one read, one value, one thing to reason about.
var user = context.CurrentUser;
if (user is not null)
    Log($"user {user.Name}");</code></pre>

  <p>This matters because the shape is everywhere: a lazily-refreshed token, an
  <code>HttpContext</code> property, a cache lookup, an EF Core navigation property. Anything where
  the getter does work rather than returning a field.</p>

  <h3>2. Across a method call</h3>

  <p>Measured: after <code>if (_cache is not null) { Clear(); … }</code>, the compiler continued to
  treat <code>_cache</code> as non-null while the field was actually null. It does not model what a
  method does to fields, because doing so would require whole-program analysis.</p>

  <h3>3. Anything the compiler did not compile</h3>

  <pre data-lang="csharp" data-net="10" data-title="02-the-runtime-does-not-care.cs"><code>// 02-the-runtime-does-not-care.cs — the four routes by which a non-nullable
// reference ends up holding null in a running process, none of which the
// compiler warned about. This is the gap between "no warnings" and "no nulls".
// .NET 10.0.400. Run: dotnet run 02-the-runtime-does-not-care.cs
#:property Nullable=enable
#:property NoWarn=IL2026;IL3050
// File-based apps default to the trimming-friendly JSON configuration, which
// disables reflection-based serialisation. A normal ASP.NET Core project has it
// on; here the resolver is supplied explicitly so the demo works either way.

using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

class InvoiceDto
{
    // Declared non-nullable. Nothing in the type system enforces that.
    public string Number { get; set; } = "";
    public string CustomerId { get; set; } = "";
    public decimal Amount { get; set; }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. JSON deserialisation ignores the annotation ---");
        const string json = """{ "Number": "INV-1", "Amount": 120.00 }""";
        var options = new JsonSerializerOptions { TypeInfoResolver = new DefaultJsonTypeInfoResolver() };
        var dto = JsonSerializer.Deserialize&lt;InvoiceDto&gt;(json, options)!;
        Console.WriteLine($"  Number     : {dto.Number}");
        Console.WriteLine($"  CustomerId : {dto.CustomerId ?? "(NULL)"}  &lt;- declared 'string'");
        Console.WriteLine($"  is null    : {dto.CustomerId is null}");
        Console.WriteLine("  The property initialiser ran, so this one held \"\" instead.");
        Console.WriteLine("  Remove the '= \"\"' and it is null, with no warning at the");
        Console.WriteLine("  point of use, because the compiler trusts the declaration.");

        Console.WriteLine();
        Console.WriteLine("--- the same DTO without initialisers ---");
        var bare = JsonSerializer.Deserialize&lt;BareDto&gt;(json, options)!;
        Console.WriteLine($"  Number     : {bare.Number ?? "(NULL)"}");
        Console.WriteLine($"  CustomerId : {bare.CustomerId ?? "(NULL)"}  &lt;- declared 'string'");
        Console.WriteLine($"  is null    : {bare.CustomerId is null}");
        Console.WriteLine("  A missing JSON property leaves a non-nullable string null.");
        Console.WriteLine("  Every later 'bare.CustomerId.Length' is warning-free and wrong.");

        Console.WriteLine();
        Console.WriteLine("--- 2. reflection writes whatever it is given ---");
        var viaReflection = new InvoiceDto();
        typeof(InvoiceDto).GetProperty(nameof(InvoiceDto.Number))!
            .SetValue(viaReflection, null);
        Console.WriteLine($"  Number after SetValue(null) : {viaReflection.Number ?? "(NULL)"}");
        Console.WriteLine("  No exception. Reflection sets fields, not contracts.");

        Console.WriteLine();
        Console.WriteLine("--- 3. default(T) in generic code ---");
        Console.WriteLine($"  Default&lt;string&gt;() is null : {Default&lt;string&gt;() is null}");
        Console.WriteLine("  An unconstrained T can be a reference type, so 'default'");
        Console.WriteLine("  is null and the signature still says it returns T.");

        Console.WriteLine();
        Console.WriteLine("--- 4. a library compiled WITHOUT nullable enabled ---");
        Console.WriteLine("  Types from such an assembly are 'oblivious': neither nullable");
        Console.WriteLine("  nor non-nullable. The compiler issues no warnings about them");
        Console.WriteLine("  in either direction, so their nulls arrive silently.");
        Console.WriteLine($"  This is why enabling nullable on one project does not");
        Console.WriteLine($"  protect it from its dependencies.");

        Console.WriteLine();
        Console.WriteLine("--- the null-forgiving operator is an assertion, not a check ---");
        string? unknown = null;
        string forgiven = unknown!;
        Console.WriteLine($"  after 'unknown!', is the value null? : {forgiven is null}");
        Console.WriteLine("  '!' emits NO code. It removes a warning and changes nothing");
        Console.WriteLine("  else. The IL for 'x!' and 'x' is identical.");
        Console.WriteLine();
        Console.WriteLine("  The next line dereferences it, and the compiler warns:");
        Console.WriteLine("    warning CS8602: Dereference of a possibly null reference.");
        Console.WriteLine("  Even though the value came through a '!'. The reason is the");
        Console.WriteLine("  'forgiven is null' test above: ASKING whether something is");
        Console.WriteLine("  null re-introduces the maybe-null state, because one branch of");
        Console.WriteLine("  that question has it null. The '!' asserted a state, and a");
        Console.WriteLine("  later test replaced it. Suppressed below so this file builds");
        Console.WriteLine("  clean; the warning is the lesson.");
#pragma warning disable CS8602
        try
        {
            Console.WriteLine(forgiven.Length);
        }
        catch (NullReferenceException)
        {
            Console.WriteLine("  ...and dereferencing it threw NullReferenceException.");
        }
#pragma warning restore CS8602
        Console.WriteLine();
        Console.WriteLine("  Worth knowing what does NOT warn: 'var x = unknown!; x.Length;'");
        Console.WriteLine("  is clean. 'var' keeps the flow state the '!' established, so");
        Console.WriteLine("  the assertion survives to the next line. It is the null TEST,");
        Console.WriteLine("  not the 'var', that undoes it.");

        Console.WriteLine();
        Console.WriteLine("--- what an actual runtime check looks like ---");
        try
        {
            Checked(null!);
        }
        catch (ArgumentNullException ex)
        {
            Console.WriteLine($"  ArgumentNullException, ParamName={ex.ParamName}");
        }
        Console.WriteLine("  ArgumentNullException.ThrowIfNull is one line and produces a");
        Console.WriteLine("  named, catchable failure at the boundary — which is what the");
        Console.WriteLine("  annotation alone cannot do.");

        Console.WriteLine();
        Console.WriteLine("--- the annotations ARE visible at runtime, as metadata ---");
        var prop = typeof(NullableProbe).GetProperty(nameof(NullableProbe.Maybe))!;
        var info = new NullabilityInfoContext().Create(prop);
        var prop2 = typeof(NullableProbe).GetProperty(nameof(NullableProbe.Definitely))!;
        var info2 = new NullabilityInfoContext().Create(prop2);
        Console.WriteLine($"  Maybe      : ReadState={info.ReadState}");
        Console.WriteLine($"  Definitely : ReadState={info2.ReadState}");
        Console.WriteLine("  NullabilityInfoContext reads the [Nullable] attributes the");
        Console.WriteLine("  compiler emitted. That is how serialisers and validators can");
        Console.WriteLine("  enforce what the runtime itself does not.");
    }

    static T Default&lt;T&gt;() =&gt; default!;

    static void Checked(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        Console.WriteLine(value.Length);
    }
}

// The compiler warns about exactly this shape, twice:
//   warning CS8618: Non-nullable property 'Number' must contain a non-null value
//   when exiting constructor. Consider adding the 'required' modifier or declaring
//   the property as nullable.
// Suppressed so the file builds clean; the warning IS the lesson.
#pragma warning disable CS8618
class BareDto
{
    public string Number { get; set; }
    public string CustomerId { get; set; }
    public decimal Amount { get; set; }
}
#pragma warning restore CS8618

class NullableProbe
{
    public string? Maybe { get; set; }
    public string Definitely { get; set; } = "";
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. JSON deserialisation ignores the annotation ---
  Number     : INV-1
  CustomerId :   &lt;- declared 'string'
  is null    : False
  The property initialiser ran, so this one held "" instead.
  Remove the '= ""' and it is null, with no warning at the
  point of use, because the compiler trusts the declaration.

--- the same DTO without initialisers ---
  Number     : INV-1
  CustomerId : (NULL)  &lt;- declared 'string'
  is null    : True
  A missing JSON property leaves a non-nullable string null.
  Every later 'bare.CustomerId.Length' is warning-free and wrong.

--- 2. reflection writes whatever it is given ---
  Number after SetValue(null) : (NULL)
  No exception. Reflection sets fields, not contracts.

--- 3. default(T) in generic code ---
  Default&lt;string&gt;() is null : True
  An unconstrained T can be a reference type, so 'default'
  is null and the signature still says it returns T.

--- 4. a library compiled WITHOUT nullable enabled ---
  Types from such an assembly are 'oblivious': neither nullable
  nor non-nullable. The compiler issues no warnings about them
  in either direction, so their nulls arrive silently.
  This is why enabling nullable on one project does not
  protect it from its dependencies.

--- the null-forgiving operator is an assertion, not a check ---
  after 'unknown!', is the value null? : True
  '!' emits NO code. It removes a warning and changes nothing
  else. The IL for 'x!' and 'x' is identical.

  The next line dereferences it, and the compiler warns:
    warning CS8602: Dereference of a possibly null reference.
  Even though the value came through a '!'. The reason is the
  'forgiven is null' test above: ASKING whether something is
  null re-introduces the maybe-null state, because one branch of
  that question has it null. The '!' asserted a state, and a
  later test replaced it. Suppressed below so this file builds
  clean; the warning is the lesson.
  ...and dereferencing it threw NullReferenceException.

  Worth knowing what does NOT warn: 'var x = unknown!; x.Length;'
  is clean. 'var' keeps the flow state the '!' established, so
  the assertion survives to the next line. It is the null TEST,
  not the 'var', that undoes it.

--- what an actual runtime check looks like ---
  ArgumentNullException, ParamName=value
  ArgumentNullException.ThrowIfNull is one line and produces a
  named, catchable failure at the boundary — which is what the
  annotation alone cannot do.

--- the annotations ARE visible at runtime, as metadata ---
  Maybe      : ReadState=Nullable
  Definitely : ReadState=NotNull
  NullabilityInfoContext reads the [Nullable] attributes the
  compiler emitted. That is how serialisers and validators can
  enforce what the runtime itself does not.</code></pre>

  <p><strong>A missing JSON property left a non-nullable <code>string</code> holding null</strong>,
  with no warning at the declaration and no warning at any later use. That is the single most common
  real-world violation, because every web API deserialises untrusted input into a DTO with
  non-nullable properties.</p>

  <p class="define"><span class="define__term">NullabilityInfoContext</span> A runtime API that
  reads the <code>[Nullable]</code> attributes the compiler emitted, reporting a member&#x27;s
  <code>ReadState</code> and <code>WriteState</code> as <code>Nullable</code>, <code>NotNull</code>
  or <code>Unknown</code>. It is how a serialiser or validator can enforce at runtime what the
  runtime itself does not.</p>

  <p class="define"><span class="define__term">Oblivious</span> The nullability of a type from an
  assembly compiled without the feature enabled: neither nullable nor non-nullable. The compiler
  warns about it in <em>neither</em> direction, so a dependency's nulls arrive silently and passing
  null to it is not flagged either.</p>

  <p class="define"><span class="define__term">Null-forgiving operator</span> The postfix
  <code>!</code>. It asserts "I know this is not null" and <strong>emits no code</strong> — the IL
  for <code>x!</code> and <code>x</code> is identical. It suppresses a warning; it does not check
  anything.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>A null test undoes a <code>!</code>.</strong> Measured:
    <code>string forgiven = unknown!;</code> then <code>forgiven is null</code> then
    <code>forgiven.Length</code> warns <code>CS8602</code> — because asking whether something is
    null re-introduces the maybe-null state. Meanwhile
    <code>var x = unknown!; x.Length;</code> is clean: <code>var</code> keeps the flow state the
    <code>!</code> established. The surprising half is that <code>var</code> is <em>not</em> the
    problem people assume it is.</p>
  </div>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>The annotations do exist at runtime — as metadata.</strong>
    <code>NullabilityInfoContext</code> reads the <code>[Nullable]</code> attributes the compiler
    emitted: measured, it reported <code>ReadState=Nullable</code> and
    <code>ReadState=NotNull</code> for the two properties. That is how a serialiser or validator can
    enforce what the runtime does not — <code>System.Text.Json</code> has had
    <code>RespectNullableAnnotations</code> since .NET 9, off by default for compatibility.</p>
  </div>
</section>

<section id="the-warnings">
  <h2>The warnings, and the one error</h2>

  <p>Eight diagnostics do almost all the work. They were produced by an actual compiler run and are
  stored in <code>verification/t1-28-nullable-reference-types/04-warnings.cs.txt</code> — as
  <code>.txt</code>, because a file whose purpose is to warn has no business in a clean build.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Code</th><th>Means</th><th>Typical cause</th></tr></thead>
    <tbody>
      <tr><td><code>CS8602</code></td><td>Dereference of a possibly null reference</td>
          <td>Calling a member on a <code>T?</code> without checking.</td></tr>
      <tr><td><code>CS8600</code></td><td>Converting null literal or possible null value to
          non-nullable type</td><td><code>string s = maybeNull;</code></td></tr>
      <tr><td><code>CS8603</code></td><td>Possible null reference return</td>
          <td>Returning a <code>T?</code> from a method declared <code>T</code>.</td></tr>
      <tr><td><code>CS8604</code></td><td>Possible null reference argument</td>
          <td>Passing a <code>T?</code> to a <code>T</code> parameter.</td></tr>
      <tr><td><code>CS8618</code></td><td>Non-nullable member must contain a non-null value when
          exiting constructor</td><td>A DTO with no initialiser and no
          <code>required</code>.</td></tr>
      <tr><td><code>CS8625</code></td><td>Cannot convert null literal to non-nullable reference
          type</td><td>Assigning a literal <code>null</code>.</td></tr>
      <tr><td><code>CS8639</code></td><td><code>typeof</code> cannot be used on a nullable reference
          type</td><td>Writing <code>typeof(string?)</code>.</td></tr>
      <tr><td><code>CS9035</code></td><td>Required member must be set in the object
          initializer</td><td>Omitting a <code>required</code> property. <strong>An
          error.</strong></td></tr>
    </tbody>
  </table>
  </div>

  <p><strong>Every one of those is a warning except the last.</strong> A project that does not treat
  warnings as errors compiles and ships all of them, which is why the feature's reputation depends
  almost entirely on one line in a <code>.csproj</code>:</p>

  <pre data-lang="xml" data-title="Directory.Build.props"><code>&lt;Project&gt;
  &lt;PropertyGroup&gt;
    &lt;Nullable&gt;enable&lt;/Nullable&gt;
    &lt;WarningsAsErrors&gt;Nullable&lt;/WarningsAsErrors&gt;
  &lt;/PropertyGroup&gt;
&lt;/Project&gt;</code></pre>

  <p class="define"><span class="define__term">required</span> A modifier saying a property must be
  set in the object initialiser. Unlike everything else in this module it produces an
  <strong>error</strong>, <code>CS9035</code> — verified. It is the only part of the nullable story
  the compiler will refuse to build.</p>
</section>

<section id="attributes">
  <h2>The attributes: describing what the annotation cannot</h2>

  <p>An annotation says one thing about a type. Some contracts are conditional — "not null when this
  returns true", "null only if the argument was". The attributes in
  <code>System.Diagnostics.CodeAnalysis</code> express those.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-attributes.cs"><code>// 03-attributes.cs — the attributes that describe nullability the annotation
// alone cannot: conditional on a return value, conditional on an argument, and
// promises a method makes about fields. Each is shown with and without.
// .NET 10.0.400. Run: dotnet run 03-attributes.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

class Parser
{
    // WITHOUT the attribute: the caller gets no benefit from checking the bool.
    public static bool TryParseNaive(string? text, out string? result)
    {
        result = string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        return result is not null;
    }

    // WITH it: "when this returns true, result is not null".
    public static bool TryParse(string? text, [NotNullWhen(true)] out string? result)
    {
        result = string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        return result is not null;
    }

    // "when this returns false, value is not null" — the shape of IsNullOrEmpty.
    public static bool IsBlank([NotNullWhen(false)] string? value)
        =&gt; string.IsNullOrWhiteSpace(value);

    // "the result is null only if the argument was" — the shape of Path.GetDirectoryName.
    [return: NotNullIfNotNull(nameof(input))]
    public static string? Normalise(string? input) =&gt; input?.Trim().ToUpperInvariant();

    // "when this returns false, the OUT parameter may be null" — for TryGet shapes
    // that hand back a value type or an unconstrained T.
    public static bool TryFirst&lt;T&gt;(IReadOnlyList&lt;T&gt; items, [MaybeNullWhen(false)] out T first)
    {
        if (items.Count == 0) { first = default!; return false; }
        first = items[0];
        return true;
    }
}

class Connection
{
    private string? _endpoint;

    // "after this returns, _endpoint is not null" — so Send() needs no check.
    [MemberNotNull(nameof(_endpoint))]
    private void EnsureOpen()
    {
        _endpoint ??= "https://gateway.ledger.internal";
    }

    public string Send(string body)
    {
        EnsureOpen();
        // No CS8602 here: the attribute told the compiler _endpoint is set.
        return $"POST {_endpoint.ToLowerInvariant()} ({body.Length} bytes)";
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- [NotNullWhen(true)] on an out parameter ---");
        foreach (var input in new[] { "  INV-1  ", "   ", null })
        {
            if (Parser.TryParse(input, out var parsed))
            {
                // No warning: the attribute proved parsed is not null in this branch.
                Console.WriteLine($"  parsed \"{input ?? "null"}\" -&gt; \"{parsed}\" (length {parsed.Length})");
            }
            else
            {
                Console.WriteLine($"  parsed \"{input ?? "null"}\" -&gt; no value");
            }
        }
        Console.WriteLine("  Without the attribute the same code warns CS8602 on");
        Console.WriteLine("  parsed.Length, because 'out string?' means 'maybe null'");
        Console.WriteLine("  regardless of what the bool says.");

        Console.WriteLine();
        Console.WriteLine("--- [NotNullWhen(false)] on an argument ---");
        string? candidate = Environment.TickCount &gt; 0 ? "value" : null;
        if (!Parser.IsBlank(candidate))
        {
            // No warning: IsBlank returning false proved candidate is not null.
            Console.WriteLine($"  not blank, length {candidate.Length}");
        }
        Console.WriteLine("  This is exactly how string.IsNullOrEmpty is annotated in the");
        Console.WriteLine("  base library, which is why 'if (!string.IsNullOrEmpty(s))'");
        Console.WriteLine("  narrows s and a hand-rolled equivalent usually does not.");

        Console.WriteLine();
        Console.WriteLine("--- [NotNullIfNotNull] ties output nullability to input ---");
        string? given = "  inv-1  ";
        var normalised = Parser.Normalise(given);
        Console.WriteLine($"  Normalise(\"{given}\") -&gt; \"{normalised}\" (length {normalised.Length})");
        Console.WriteLine($"  Normalise(null)          -&gt; {Parser.Normalise(null) ?? "(null)"}");
        Console.WriteLine("  One method, two contracts, no overloads. The compiler picks");
        Console.WriteLine("  the right one from the argument's nullability at each call.");

        Console.WriteLine();
        Console.WriteLine("--- [MaybeNullWhen(false)] for TryGet over an unconstrained T ---");
        var names = new List&lt;string&gt; { "ada", "grace" };
        var empty = new List&lt;string&gt;();
        if (Parser.TryFirst(names, out var firstName))
            Console.WriteLine($"  first of 2 : {firstName.ToUpperInvariant()}");
        if (!Parser.TryFirst(empty, out var none))
            Console.WriteLine($"  first of 0 : no value (out is {none ?? "(null)"})");

        Console.WriteLine();
        Console.WriteLine("--- [MemberNotNull] lets an initialiser satisfy the compiler ---");
        var connection = new Connection();
        Console.WriteLine($"  {connection.Send("{}")}");
        Console.WriteLine("  Without [MemberNotNull], Send() warns CS8602 on _endpoint");
        Console.WriteLine("  even though EnsureOpen() has just assigned it: the compiler");
        Console.WriteLine("  does not look inside the call. The attribute is how you tell");
        Console.WriteLine("  it what the call guarantees.");

        Console.WriteLine();
        Console.WriteLine("--- what the attributes are and are not ---");
        Console.WriteLine("  They are compile-time claims. Nothing verifies that TryParse");
        Console.WriteLine("  actually sets result when it returns true — the attribute is");
        Console.WriteLine("  believed. A wrong attribute is a lie the compiler propagates");
        Console.WriteLine("  to every caller, which is worse than no attribute at all.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- [NotNullWhen(true)] on an out parameter ---
  parsed "  INV-1  " -&gt; "INV-1" (length 5)
  parsed "   " -&gt; no value
  parsed "null" -&gt; no value
  Without the attribute the same code warns CS8602 on
  parsed.Length, because 'out string?' means 'maybe null'
  regardless of what the bool says.

--- [NotNullWhen(false)] on an argument ---
  not blank, length 5
  This is exactly how string.IsNullOrEmpty is annotated in the
  base library, which is why 'if (!string.IsNullOrEmpty(s))'
  narrows s and a hand-rolled equivalent usually does not.

--- [NotNullIfNotNull] ties output nullability to input ---
  Normalise("  inv-1  ") -&gt; "INV-1" (length 5)
  Normalise(null)          -&gt; (null)
  One method, two contracts, no overloads. The compiler picks
  the right one from the argument's nullability at each call.

--- [MaybeNullWhen(false)] for TryGet over an unconstrained T ---
  first of 2 : ADA
  first of 0 : no value (out is (null))

--- [MemberNotNull] lets an initialiser satisfy the compiler ---
  POST https://gateway.ledger.internal (2 bytes)
  Without [MemberNotNull], Send() warns CS8602 on _endpoint
  even though EnsureOpen() has just assigned it: the compiler
  does not look inside the call. The attribute is how you tell
  it what the call guarantees.

--- what the attributes are and are not ---
  They are compile-time claims. Nothing verifies that TryParse
  actually sets result when it returns true — the attribute is
  believed. A wrong attribute is a lie the compiler propagates
  to every caller, which is worse than no attribute at all.</code></pre>

  <p class="define"><span class="define__term">Nullability attribute</span> An attribute from
  <code>System.Diagnostics.CodeAnalysis</code> that states a conditional nullability contract the
  <code>?</code> cannot express. The compiler reads it at every call site and reasons as though it
  were true — it does not check that the method honours it.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Attribute</th><th>Says</th><th>Use on</th></tr></thead>
    <tbody>
      <tr><td><code>[NotNullWhen(true)]</code></td>
          <td>Not null when the method returns true</td>
          <td>The <code>out</code> of a <code>TryX</code>.</td></tr>
      <tr><td><code>[NotNullWhen(false)]</code></td>
          <td>Not null when the method returns false</td>
          <td>An argument to an <code>IsNullOrX</code>.</td></tr>
      <tr><td><code>[MaybeNullWhen(false)]</code></td>
          <td>May be null when the method returns false</td>
          <td>An <code>out T</code> where <code>T</code> is unconstrained.</td></tr>
      <tr><td><code>[return: NotNullIfNotNull("arg")]</code></td>
          <td>Result is null only if that argument was</td>
          <td>Pass-through transforms.</td></tr>
      <tr><td><code>[MemberNotNull(nameof(f))]</code></td>
          <td>That field is set once this returns</td>
          <td>An <code>Initialise</code> or <code>EnsureX</code> method.</td></tr>
    </tbody>
  </table>
  </div>

  <p><strong><code>[NotNullWhen(false)]</code> is why <code>string.IsNullOrEmpty</code> works and
  your own equivalent does not.</strong> The base library annotates it; a hand-rolled
  <code>IsBlank(string? s)</code> without the attribute leaves every caller warning after a check
  that logically proved the value.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Nothing verifies an attribute.</strong> The compiler does not check that
    <code>TryParse</code> actually assigns <code>result</code> when it returns <code>true</code> — it
    believes the attribute and propagates the belief to every caller. <strong>A wrong attribute is
    worse than no attribute</strong>, because it converts a warning at one call site into silent
    confidence at all of them.</p>
  </div>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-production.cs"><code>// 05-production.cs — a Ledger invoice lookup written the way a service should be:
// nullability expressed in the signatures, checked at the boundary, and never
// asserted with '!' where the compiler could have been told the truth instead.
// .NET 10.0.400. Run: dotnet run 05-production.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Linq;

namespace Ledger.Invoicing;

public readonly record struct Money(decimal Amount, string Currency)
{
    public override string ToString() =&gt;
        Amount.ToString("N2", CultureInfo.InvariantCulture) + " " + Currency;
}

/// &lt;summary&gt;
/// Every property says what it means. Number and Amount are always present;
/// PurchaseOrder genuinely may be absent, and the type says so once, here,
/// instead of at every call site.
/// &lt;/summary&gt;
public sealed class Invoice
{
    public required string Number { get; init; }
    public required string CustomerId { get; init; }
    public required Money Amount { get; init; }
    public string? PurchaseOrder { get; init; }
    public DateOnly? SettledOn { get; init; }
}

public interface IInvoiceStore
{
    /// &lt;summary&gt;Null means "no invoice with that number", which is not an error.&lt;/summary&gt;
    Invoice? Find(string number);

    /// &lt;summary&gt;Throws when absent. Use where absence is a bug.&lt;/summary&gt;
    Invoice Get(string number);

    bool TryFind(string number, [NotNullWhen(true)] out Invoice? invoice);
}

public sealed class InMemoryInvoiceStore : IInvoiceStore
{
    private readonly Dictionary&lt;string, Invoice&gt; _byNumber;

    public InMemoryInvoiceStore(IEnumerable&lt;Invoice&gt; invoices)
    {
        ArgumentNullException.ThrowIfNull(invoices);
        _byNumber = invoices.ToDictionary(i =&gt; i.Number, StringComparer.Ordinal);
    }

    public Invoice? Find(string number)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(number);
        return _byNumber.TryGetValue(number, out var invoice) ? invoice : null;
    }

    public Invoice Get(string number)
        =&gt; Find(number) ?? throw new KeyNotFoundException($"No invoice numbered '{number}'.");

    public bool TryFind(string number, [NotNullWhen(true)] out Invoice? invoice)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(number);
        return _byNumber.TryGetValue(number, out invoice);
    }
}

public sealed class InvoiceFormatter
{
    private readonly IInvoiceStore _store;

    public InvoiceFormatter(IInvoiceStore store)
    {
        ArgumentNullException.ThrowIfNull(store);
        _store = store;
    }

    /// &lt;summary&gt;The null flows through, and the signature says so.&lt;/summary&gt;
    [return: NotNullIfNotNull(nameof(number))]
    public string? Describe(string? number)
    {
        if (number is null) return null;

        if (!_store.TryFind(number, out var invoice))
            return $"{number}: not found";

        // No '!' and no null check: [NotNullWhen(true)] proved invoice is not null.
        var po = invoice.PurchaseOrder is { Length: &gt; 0 } p ? $" PO {p}" : "";
        var settled = invoice.SettledOn is { } d ? $" settled {d:yyyy-MM-dd}" : " unsettled";
        return $"{invoice.Number}: {invoice.Amount}{po}{settled}";
    }
}

class Program
{
    static void Main()
    {
        var store = new InMemoryInvoiceStore(new[]
        {
            new Invoice
            {
                Number = "INV-1", CustomerId = "CUST-1",
                Amount = new Money(1200m, "GBP"), PurchaseOrder = "PO-88",
                SettledOn = new DateOnly(2026, 8, 1)
            },
            new Invoice
            {
                Number = "INV-2", CustomerId = "CUST-2",
                Amount = new Money(340.50m, "EUR")
            }
        });

        var formatter = new InvoiceFormatter(store);

        Console.WriteLine("--- describing invoices ---");
        foreach (var number in new[] { "INV-1", "INV-2", "INV-404" })
            Console.WriteLine($"  {formatter.Describe(number)}");

        Console.WriteLine();
        Console.WriteLine("--- null in, null out, and the compiler knows ---");
        Console.WriteLine($"  Describe(null) : {formatter.Describe(null) ?? "(null)"}");
        var described = formatter.Describe("INV-1");
        // No warning on .Length: [NotNullIfNotNull] proved it from a non-null argument.
        Console.WriteLine($"  Describe(\"INV-1\").Length : {described.Length}");

        Console.WriteLine();
        Console.WriteLine("--- Find vs Get: absence as a value, or as an error ---");
        var maybe = store.Find("INV-404");
        Console.WriteLine($"  Find(\"INV-404\")  : {maybe?.Number ?? "(null)"}");
        try
        {
            store.Get("INV-404");
        }
        catch (KeyNotFoundException ex)
        {
            Console.WriteLine($"  Get(\"INV-404\")   : {ex.GetType().Name} — {ex.Message}");
        }
        Console.WriteLine("  Two methods, two beliefs about the data. Neither is a default.");

        Console.WriteLine();
        Console.WriteLine("--- 'required' makes the constructor-time hole a compile error ---");
        Console.WriteLine("  Omitting Number from an object initialiser is CS9035:");
        Console.WriteLine("    'Required member Invoice.Number must be set in the object");
        Console.WriteLine("    initializer or attribute constructor.'");
        Console.WriteLine("  That is an ERROR, not a warning — the only part of nullable");
        Console.WriteLine("  reference types that the compiler will refuse to build.");

        Console.WriteLine();
        Console.WriteLine("--- the boundary check is what actually protects the invariant ---");
        try
        {
            store.Find("   ");
        }
        catch (ArgumentException ex)
        {
            Console.WriteLine($"  Find(\"   \") : {ex.GetType().Name}, ParamName={ex.ParamName}");
        }
        try
        {
            _ = new InvoiceFormatter(null!);
        }
        catch (ArgumentNullException ex)
        {
            Console.WriteLine($"  new InvoiceFormatter(null!) : ArgumentNullException, ParamName={ex.ParamName}");
        }
        Console.WriteLine("  A caller compiled without nullable enabled, or one using '!',");
        Console.WriteLine("  gets a named exception here rather than a NullReferenceException");
        Console.WriteLine("  three frames deeper.");

        Console.WriteLine();
        Console.WriteLine("--- how many '!' operators are in this file? ---");
        Console.WriteLine("  Two, both in the demo code above, both deliberately passing");
        Console.WriteLine("  null to prove a guard fires. None in the production types.");
        Console.WriteLine("  That is the target: '!' appears in tests and at boundaries you");
        Console.WriteLine("  are deliberately violating, and nowhere else.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- describing invoices ---
  INV-1: 1,200.00 GBP PO PO-88 settled 2026-08-01
  INV-2: 340.50 EUR unsettled
  INV-404: not found

--- null in, null out, and the compiler knows ---
  Describe(null) : (null)
  Describe("INV-1").Length : 47

--- Find vs Get: absence as a value, or as an error ---
  Find("INV-404")  : (null)
  Get("INV-404")   : KeyNotFoundException — No invoice numbered 'INV-404'.
  Two methods, two beliefs about the data. Neither is a default.

--- 'required' makes the constructor-time hole a compile error ---
  Omitting Number from an object initialiser is CS9035:
    'Required member Invoice.Number must be set in the object
    initializer or attribute constructor.'
  That is an ERROR, not a warning — the only part of nullable
  reference types that the compiler will refuse to build.

--- the boundary check is what actually protects the invariant ---
  Find("   ") : ArgumentException, ParamName=number
  new InvoiceFormatter(null!) : ArgumentNullException, ParamName=store
  A caller compiled without nullable enabled, or one using '!',
  gets a named exception here rather than a NullReferenceException
  three frames deeper.

--- how many '!' operators are in this file? ---
  Two, both in the demo code above, both deliberately passing
  null to prove a guard fires. None in the production types.
  That is the target: '!' appears in tests and at boundaries you
  are deliberately violating, and nowhere else.</code></pre>

  <p>Four decisions in that code are the whole practice.</p>

  <p><strong>The model says what is optional, once.</strong> <code>Number</code> and
  <code>CustomerId</code> are <code>required string</code>; <code>PurchaseOrder</code> is
  <code>string?</code> because an invoice genuinely may not have one. Every call site inherits both
  facts without repeating either.</p>

  <p><strong>Two lookup methods, two beliefs.</strong> <code>Find</code> returns
  <code>Invoice?</code> because absence is normal; <code>Get</code> returns <code>Invoice</code> and
  throws <code>KeyNotFoundException</code> because absence is a bug. That is the
  <code>Single</code>/<code>First</code> distinction from
  <a href="#/m/t1-24-linq-fundamentals">LINQ: Both Syntaxes</a>, expressed in nullability.</p>

  <p><strong>The attributes remove the need for <code>!</code>.</strong>
  <code>TryFind</code>'s <code>[NotNullWhen(true)]</code> and <code>Describe</code>'s
  <code>[NotNullIfNotNull]</code> mean the calling code dereferences with no operator and no check.
  Measured: <code>Describe("INV-1").Length</code> is <code>47</code>, warning-free.</p>

  <p class="define"><span class="define__term">Boundary check</span> A runtime guard —
  <code>ArgumentNullException.ThrowIfNull</code> or
  <code>ArgumentException.ThrowIfNullOrWhiteSpace</code> — at the edge of code you control. It
  produces a named, catchable failure where the annotation produces nothing at all, and it works
  against callers the compiler never saw.</p>

  <p><strong>The boundary still checks at runtime.</strong> <code>ArgumentNullException.ThrowIfNull</code>
  and <code>ArgumentException.ThrowIfNullOrWhiteSpace</code> produce named, catchable failures — the
  measurement shows <code>ParamName=number</code> and <code>ParamName=store</code>. That is what
  protects the type from a caller compiled without nullable enabled, and it is the part the
  annotation cannot do.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>The <code>!</code> count is the health metric.</strong> This file has two, both in
    demonstration code deliberately violating a contract to prove a guard fires. A production type
    with <code>!</code> scattered through it has an annotation that does not match reality, and the
    fix is nearly always to change the annotation rather than to keep asserting past it.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Enabling it and suppressing the warnings</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the annotation now lies"><code>// WRONG. Every '!' here is a claim nobody checked, and the type says
// something the code does not do.
public string Name =&gt; _customer!.Name!;
public string Email =&gt; _cache[_key]!;
var invoice = store.Find(number)!;</code></pre>

  <p>The result is worse than not enabling the feature: readers now trust signatures that are false.
  Fix the annotation instead — if <code>Find</code> can return null, the caller's variable is
  <code>Invoice?</code>.</p>

  <h3>2. Believing the compiler checked</h3>

  <p>It checked what it compiled. Measured: JSON deserialisation left a non-nullable
  <code>string</code> null; reflection wrote null into one; <code>default(T)</code> produced one.
  None warned.</p>

  <h3>3. Reading a property twice after checking it</h3>

  <p>Measured: no warning, <code>NullReferenceException</code>. Read into a local.</p>

  <h3>4. A DTO with non-nullable properties and no <code>required</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: CS8618, then a null at runtime"><code>// WRONG. warning CS8618 on both properties, and a missing JSON field
// leaves them null with no warning at any use site.
public class InvoiceDto
{
    public string Number { get; set; }
    public string CustomerId { get; set; }
}

// Right: the compiler refuses to build a caller that omits either.
public class InvoiceDto
{
    public required string Number { get; init; }
    public required string CustomerId { get; init; }
}</code></pre>

  <p>For a type populated by a deserialiser rather than by C# code, <code>required</code> is not
  enough on its own — the serialiser must also be told to honour it. In
  <code>System.Text.Json</code> that is automatic for <code>required</code> members, and
  <code>RespectNullableAnnotations</code> (.NET 9+) extends it to plain non-nullable ones.</p>

  <h3>5. Silencing <code>CS8618</code> with <code>= null!</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the warning is gone and the null is not"><code>// WRONG. This is the single most common way a nullable-enabled codebase
// ends up with annotations that describe intentions rather than behaviour.
public class Customer
{
    public string Id { get; set; } = null!;
    public string Email { get; set; } = null!;
}

// Right: say what is actually true.
public class Customer
{
    public required string Id { get; init; }
    public required string Email { get; init; }
}</code></pre>

  <h3>6. Writing your own <code>IsNullOrEmpty</code> without the attribute</h3>

  <p>Every caller warns after a check that logically proved the value.
  <code>[NotNullWhen(false)]</code> on the parameter is the fix, and it is one line.</p>

  <h3>7. Trusting a dependency's signatures</h3>

  <p>A package compiled without nullable enabled is <em>oblivious</em>: no warnings in either
  direction. Enabling the feature in your project does nothing about what its types return.</p>

  <h3>8. Using <code>!</code> and then testing for null anyway</h3>

  <p>Measured: the test re-introduces the maybe-null state and the next dereference warns
  <code>CS8602</code> despite the <code>!</code>. If you are testing it, the value was nullable and
  the <code>!</code> was wrong.</p>

  <h3>9. Expecting <code>Where(x =&gt; x is not null)</code> to change the element type</h3>

  <p>It does not — the result is still <code>IEnumerable&lt;string?&gt;</code> and the compiler still
  warns. Measured. Use <code>OfType&lt;string&gt;()</code>, which returns
  <code>IEnumerable&lt;string&gt;</code>.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A <code>NullReferenceException</code> in code with no nullable warnings.</strong>
    Work through the three unsound cases in order. Is a property read twice after a check? Does a
    method call sit between the check and the use? Did the value come from JSON, reflection,
    <code>default(T)</code>, or a dependency compiled without nullable? One of those four is nearly
    always the answer.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Finding where an unexpected null entered.</strong> Add
    <code>ArgumentNullException.ThrowIfNull</code> at the top of the method that received it. The
    exception then names the parameter and points at the caller, which
    <code>NullReferenceException</code> never does. Move the check outward until the caller is
    something you did not write.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>"But I checked it one line ago" — and the compiler still warns.</strong> The check was on a
    property or an indexer, or a method call intervened. Read into a local immediately before the
    check and use the local. If the value is genuinely proven by something the compiler cannot see, an
    attribute on the proving method is the right fix; <code>!</code> is the wrong one, because it
    fixes one call site and leaves the rest.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Auditing how much the annotations can be trusted.</strong> Count the
    <code>!</code> operators: <code>grep -rc '!\.' --include='*.cs' .</code> is crude but tells you
    the order of magnitude. A codebase with hundreds has annotations that describe intentions rather
    than behaviour.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Checking what a dependency actually promises.</strong>
    <code>new NullabilityInfoContext().Create(propertyInfo)</code> reports
    <code>ReadState</code> and <code>WriteState</code> — measured as <code>Nullable</code> and
    <code>NotNull</code> for two properties. A third value, <code>Unknown</code>, means the assembly
    was compiled without the feature and its signatures promise nothing.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Migrating a project without drowning.</strong> Set
    <code>&lt;Nullable&gt;enable&lt;/Nullable&gt;</code> and then
    <code>#nullable disable</code> at the top of every existing file — a one-line-per-file change a
    script can make. New files are then checked from the start, and old files are converted one at a
    time by deleting one line. Turning it on everywhere at once produces thousands of warnings and
    a team that turns it off again.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A concrete case.</strong> Ledger's settlement service exposed an endpoint that
    accepted a batch of payment instructions as JSON. The DTO had six non-nullable
    <code>string</code> properties, nullable reference types were enabled, and the build was
    clean.</p>
    <p>A partner's integration was updated and began omitting <code>customerReference</code> for
    instructions where it was not applicable. Their reading of the API documentation was reasonable;
    the field had never been marked required anywhere a client could see.</p>
    <p>The deserialiser left that property null. Nothing warned at deserialisation, and nothing
    warned at the eleven places downstream that read it — the compiler had been told it was
    <code>string</code>, and it believed the declaration. The first dereference threw
    <code>NullReferenceException: Object reference not set to an instance of an object.</code></p>
    <p>Three things made it expensive. The exception carried no parameter name, so the log line named
    a method forty lines long with four dereferences on the failing line. The batch endpoint
    processed instructions in a loop with no per-item error handling, so <strong>one malformed
    instruction failed the whole batch of up to 500</strong>. And the partner retried on failure,
    so the same batch failed roughly every ninety seconds for the six hours it took to diagnose.</p>
    <p>The fix was three lines: <code>required</code> on the six properties, which made
    <code>System.Text.Json</code> throw <code>JsonException</code> naming the missing property, and
    a <code>try</code>/<code>catch</code> around the per-item loop. The endpoint then returned
    <strong>400 with "customerReference is required"</strong> in under a millisecond, and the
    partner fixed their side the same afternoon.</p>
  </div>

  <p>The general principle: <strong>nullable reference types move information from documentation
  into the compiler, and they are worth exactly as much as the boundary checks that back them
  up.</strong> Inside your own compiled code the analysis is genuinely strong. At every edge — JSON,
  a database, reflection, a dependency, a caller in another language — it is a comment.</p>

  <p>That is not an argument against the feature. It is an argument for putting the strongest
  available check at each layer: <code>required</code> where the compiler can refuse to build,
  <code>ThrowIfNull</code> where a runtime check can name the parameter, and annotations everywhere
  in between so the type says what the code means. <strong>The incident above was six hours of
  outage that three lines would have turned into a 400 response.</strong></p>

  <p>The honest counter-argument is worth stating too. A codebase that enables the feature and
  suppresses its way to a clean build is <em>worse</em> off than one that never enabled it, because
  the signatures now assert things nobody verified. The feature only pays when the warnings are
  errors.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>string?</code> is a different type from <code>string</code>."</strong> It is
    not. Verified: both locals report the same runtime type, and
    <code>typeof(string?)</code> does not compile — <code>CS8639</code>. Contrast
    <code>int?</code>, which genuinely is <code>Nullable&lt;int&gt;</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A clean build means no <code>NullReferenceException</code>."</strong> Measured, four
    ways to get one with no warning: JSON, reflection, <code>default(T)</code>, and an oblivious
    dependency — plus the property-read-twice case, which threw on a line the compiler
    approved.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>!</code> checks the value."</strong> It emits no code at all. The IL for
    <code>x!</code> and <code>x</code> is identical; it removes a warning and changes nothing
    else.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The flow analysis is sound."</strong> It is deliberately not, in three places: a
    property read twice, a method call between check and use, and anything the compiler did not
    compile. All three were measured producing a null the compiler considered impossible.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Enabling nullable on my project protects it."</strong> Only from your own code. A
    dependency compiled without it is <em>oblivious</em> — no warnings in either direction.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>var</code> loses the null-forgiving assertion."</strong> It does not — verified,
    <code>var x = unknown!; x.Length;</code> is warning-free. What loses the assertion is a
    subsequent null <em>test</em>, which re-introduces the maybe-null state.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Nullable warnings are advisory."</strong> They are, by default, and that is the whole
    problem. <code>&lt;WarningsAsErrors&gt;Nullable&lt;/WarningsAsErrors&gt;</code> is the line that
    turns the feature from documentation into a guarantee about your own code.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>Any new project</td>
          <td><code>&lt;Nullable&gt;enable&lt;/Nullable&gt;</code> plus
          <code>&lt;WarningsAsErrors&gt;Nullable&lt;/WarningsAsErrors&gt;</code></td>
          <td>Without the second line the warnings ship.</td></tr>
      <tr><td>Migrating an existing project</td>
          <td>Enable it, then <code>#nullable disable</code> per existing file</td>
          <td>New code is checked immediately; old files convert one at a time.</td></tr>
      <tr><td>A value that is genuinely optional</td><td><code>T?</code></td>
          <td>Say it once in the type instead of at every call site.</td></tr>
      <tr><td>A property that must always be set</td><td><code>required</code></td>
          <td>The only nullable-related diagnostic that is an <em>error</em>.</td></tr>
      <tr><td>A DTO fed by a deserialiser</td><td><code>required</code> and validate at the
          boundary</td><td>The compiler never sees the deserialiser's writes.</td></tr>
      <tr><td>A public method's parameters</td><td><code>ArgumentNullException.ThrowIfNull</code></td>
          <td>Names the parameter; works against callers you did not compile.</td></tr>
      <tr><td>A <code>TryX</code> method</td><td><code>[NotNullWhen(true)]</code> on the
          <code>out</code></td><td>Otherwise every caller needs a <code>!</code>.</td></tr>
      <tr><td>An <code>IsNullOrX</code> helper</td><td><code>[NotNullWhen(false)]</code> on the
          argument</td><td>How <code>string.IsNullOrEmpty</code> narrows its caller.</td></tr>
      <tr><td>A transform that passes null through</td>
          <td><code>[return: NotNullIfNotNull(nameof(arg))]</code></td>
          <td>One method, two contracts, no overloads.</td></tr>
      <tr><td>An <code>EnsureX</code> that assigns a field</td>
          <td><code>[MemberNotNull(nameof(field))]</code></td>
          <td>The compiler does not look inside the call.</td></tr>
      <tr><td>Checking a property for null</td><td>Read it into a local first</td>
          <td>Two reads are two getter calls; the compiler narrows anyway.</td></tr>
      <tr><td>Filtering nulls out of a sequence</td><td><code>OfType&lt;T&gt;()</code></td>
          <td><code>Where(x =&gt; x is not null)</code> does not change the element type.</td></tr>
      <tr><td>You want to write <code>!</code></td><td>Change the annotation instead</td>
          <td>A <code>!</code> fixes one call site; the annotation fixes all of them.</td></tr>
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
    <p>Which of these three lines warn, with which code, and why does the third differ?</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>static string? Maybe() =&gt; …;

string? a = Maybe();
Console.WriteLine(a.Length);   // (1)
string b = a;                  // (2)

string? c = Maybe();
if (c is null) return;
Console.WriteLine(c.Length);   // (3)</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>(1) a.Length                       -&gt; CS8602
(2) string b = a;                  -&gt; CS8600
(3) same lines after a null guard  -&gt; no warning
after the guard, a.Length = 5 with no warning</code></pre>
        <p><strong>(1) is <code>CS8602: Dereference of a possibly null reference.</code></strong>
        <code>a</code>'s declared annotation is nullable and nothing has narrowed it.</p>
        <p><strong>(2) is <code>CS8600: Converting null literal or possible null value to
        non-nullable type.</code></strong> A different diagnostic for a different mistake: this one
        does not dereference anything, it stores a maybe-null value where the type says there will
        not be one — so the next reader of <code>b</code> is misled.</p>
        <p><strong>(3) does not warn.</strong> The <code>return</code> means the only way to reach
        the third line is with <code>c</code> not null, and the compiler follows that. This is null
        <em>state</em> diverging from the declared <em>annotation</em>: <code>c</code> is still
        declared <code>string?</code>, and at that point its state is not-null.</p>
        <p>A detail worth noticing: had line (1) come first and not thrown, line (2) would
        <em>not</em> warn — because reaching it proves <code>a</code> was not null. A dereference is
        itself an assertion, which is why <code>x.Foo(); string y = x;</code> produces exactly one
        warning rather than two.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This code produces no warnings and throws <code>NullReferenceException</code> in production.
    Explain exactly why, and fix it.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>if (context.Token is not null)
    Log($"token length {context.Token.Length}");</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>the tempting version:
  NullReferenceException — no warning was issued
the correct version:
  token length 6 (read once into a local)</code></pre>
        <p><strong>There are two reads of <code>Token</code>, and each one calls the
        getter.</strong> The check calls it once; the interpolation calls it again. If the getter
        can return different values — a token that expires, a cache that is invalidated, a request
        context that changes — the second call can return null after the first returned a
        value.</p>
        <p><strong>The compiler narrows across the two reads anyway.</strong> That is the part worth
        internalising: it is not that the analysis is confused, it is that C# deliberately treats
        <code>context.Token</code> as one value for flow purposes. Doing otherwise would make
        property checks nearly useless, so the language accepts unsoundness here.</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>var token = context.Token;
if (token is not null)
    Log($"token length {token.Length}");</code></pre>
        <p>One read, one value, and now the compiler's belief and the runtime's behaviour agree.</p>
        <p><strong>How to spot the shape in review:</strong> a member-access expression appearing
        both in a null check and in the body it guards. <code>a.B.C</code> checked and then used is
        the same hazard as <code>context.Token</code>, and so is <code>dict[key]</code>. If the
        expression is not a plain local, read it into one.</p>
        <p>The same reasoning covers the second unsound case. <code>if (_field is not null) { DoWork(); _field.Use(); }</code>
        also warns about nothing, because the compiler does not model what <code>DoWork</code> does
        to fields — measured: after a method that set the field to null, the compiler still treated
        it as non-null.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Callers of this method need a <code>!</code> to use the <code>out</code> value. Fix it so they
    do not, without changing the behaviour.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>public bool TryGet(string key, out string? value)
    =&gt; _values.TryGetValue(key, out value) &amp;&amp; value is not null;</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>without [NotNullWhen(true)]:
  got a value of length 31   &lt;- needed a '!'
with [NotNullWhen(true)]:
  got a value of length 31   &lt;- no '!' needed
missing key      : False
key with a null  : False</code></pre>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>using System.Diagnostics.CodeAnalysis;

public bool TryGet(string key, [NotNullWhen(true)] out string? value)
{
    value = _values.TryGetValue(key, out var v) ? v : null;
    return value is not null;
}</code></pre>
        <p><strong>The problem is that <code>out string?</code> says "maybe null" unconditionally.</strong>
        The <code>bool</code> return carries the real information, and without an attribute the
        compiler has no way to connect the two — so every caller writes
        <code>value!.Length</code> inside a block where the value is provably present.</p>
        <p><code>[NotNullWhen(true)]</code> makes that connection: <em>when this method returns true,
        this parameter is not null.</em> The compiler then narrows <code>value</code> inside the
        <code>if</code> and warns outside it, which is exactly right.</p>
        <p><strong>The attribute is believed, not verified.</strong> Nothing checks that the method
        really does assign a non-null value on every <code>true</code> path. If it does not, the
        compiler propagates the lie to every caller — so the attribute belongs on methods whose body
        you can see and reason about.</p>
        <p><strong>Two related cases worth knowing.</strong> For an unconstrained
        <code>out T</code>, use <code>[MaybeNullWhen(false)]</code> instead — <code>T</code> might be
        a value type, where <code>T?</code> would mean something different. And for a predicate,
        <code>[NotNullWhen(false)]</code> on the <em>argument</em> is what makes
        <code>if (!IsBlank(s))</code> narrow <code>s</code>; it is how
        <code>string.IsNullOrEmpty</code> is annotated in the base library, and the reason a
        hand-rolled equivalent usually leaves its callers warning.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Migrate this class to a nullable-enabled world. Say what each decision commits you to, and
    what still is not guaranteed.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>public class Customer
{
    public string Id { get; set; }
    public string Email { get; set; }
    public string Nickname { get; set; }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>legacy  : Id=CUST-1 Email=(null) Nickname=(null)
migrated: Id=CUST-1 Email=ada@example.com Nickname=(none)
Nickname is string?, so this compiles : True
Omitting Id or Email is CS9035, an ERROR:
  'Required member MigratedCustomer.Id must be set in the
  object initializer or attribute constructor.'

counting the difference:
  legacy   : 3 properties, 0 say anything about null
  migrated : 3 properties, 2 required non-null, 1 explicitly optional
  call sites that must null-check Nickname : all of them
  call sites that must null-check Id       : none</code></pre>
<pre data-lang="csharp" data-net="10" data-title="The migration"><code>public class Customer
{
    public required string Id { get; init; }
    public required string Email { get; init; }
    public string? Nickname { get; init; }
}</code></pre>
        <p><strong>The original produces <code>CS8618</code> three times</strong> — "Non-nullable
        property must contain a non-null value when exiting constructor" — and the tempting fix is
        <code>= null!</code> on each, which silences the warning and changes nothing. That is the
        anti-pattern: three properties that now claim to be non-null and are not.</p>
        <p><strong>What each decision commits you to.</strong></p>
        <ul>
          <li><code>required</code> on <code>Id</code> and <code>Email</code>: every construction
          site must set them, enforced as <strong><code>CS9035</code>, an error</strong>. Verified.
          This is the strongest guarantee available, and it is available only here.</li>
          <li><code>init</code> rather than <code>set</code>: the values cannot be nulled after
          construction, so "required at construction" also means "non-null for the object's
          lifetime". With <code>set</code>, <code>c.Email = null!</code> is a warning away.</li>
          <li><code>string?</code> on <code>Nickname</code>: every read site must now handle
          absence. That is more work at the call sites and it is the correct amount of work —
          previously they were all guessing.</li>
        </ul>
        <p><strong>What is still not guaranteed.</strong> If this type is deserialised,
        <code>required</code> is honoured by <code>System.Text.Json</code> — but a different
        serialiser, an ORM materialising rows, or reflection will all write whatever they have.
        Measured elsewhere in this module: reflection set a non-nullable property to null with no
        exception, and a missing JSON field left one null.</p>
        <p>So the migration is complete only with a boundary check on the path that populates the
        object from outside — <code>ThrowIfNull</code>, a validation attribute, or a mapping step
        that fails loudly. <strong>The type system states the invariant; something at the edge has to
        enforce it.</strong></p>
        <p><strong>One migration decision this exercise hides:</strong> whether
        <code>Email</code> is really required. If some customers genuinely have none, making it
        <code>required</code> forces every construction site to invent a value, and the usual
        invention is <code>""</code> — which is null with extra steps and no annotation to warn
        anyone. When you cannot answer "is this ever legitimately absent?", the honest annotation is
        <code>string?</code> until you can.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is <code>string?</code> at runtime?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>string</code>. There is no separate type — verified, both report the same runtime
        type, and <code>typeof(string?)</code> is <code>CS8639</code>. Contrast <code>int?</code>,
        which genuinely is <code>Nullable&lt;int&gt;</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What is the difference between null state and the annotation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The annotation is what the declaration says; the state is what the compiler currently
        knows at that point. A <code>string?</code> can be dereferenced with no warning once its
        state is not-null.</p>
      </div></details>
    </li>
    <li>
      <p>Name the three places the flow analysis is unsound.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>A property read twice</strong> (two getter calls, narrowed as one — measured
        throwing on an approved line); <strong>across a method call</strong> (fields are not
        modelled); <strong>anything the compiler did not compile</strong> (JSON, reflection,
        <code>default(T)</code>, oblivious dependencies).</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>!</code> do?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Suppresses a warning. <strong>It emits no code</strong> — the IL for <code>x!</code> and
        <code>x</code> is identical. It is an assertion, not a check.</p>
      </div></details>
    </li>
    <li>
      <p>Which nullable diagnostic is an error rather than a warning?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>CS9035</code>, for omitting a <code>required</code> member. Verified. Everything
        else — <code>CS8602</code>, <code>CS8600</code>, <code>CS8618</code> and the rest — is a
        warning that ships unless the project says otherwise.</p>
      </div></details>
    </li>
    <li>
      <p>What single project setting makes the feature a guarantee?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>&lt;WarningsAsErrors&gt;Nullable&lt;/WarningsAsErrors&gt;</code>, alongside
        <code>&lt;Nullable&gt;enable&lt;/Nullable&gt;</code>. Without it the warnings are
        advisory.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>if (!string.IsNullOrEmpty(s))</code> narrow <code>s</code> when your own
      helper does not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The base library annotates the parameter <code>[NotNullWhen(false)]</code>. One attribute,
        and every caller stops needing a <code>!</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What does "oblivious" mean?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The nullability of a type from an assembly compiled without the feature: neither nullable
        nor non-nullable. The compiler warns in <strong>neither direction</strong>, so its nulls
        arrive silently and passing null to it is not flagged.</p>
      </div></details>
    </li>
    <li>
      <p>You check a property for null and then dereference it. What is wrong and what is the
      fix?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Two getter calls, narrowed as one — measured: no warning, then
        <code>NullReferenceException</code>. Read it into a local once and use the local.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>required</code> better than <code>= null!</code> on a DTO property?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>= null!</code> silences <code>CS8618</code> and leaves the property null — the
        annotation now lies. <code>required</code> makes every construction site set it, as
        <code>CS9035</code>, an error.</p>
      </div></details>
    </li>
    <li>
      <p>How do you filter nulls out of a sequence and get a non-nullable element type?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>OfType&lt;T&gt;()</code>. <code>Where(x =&gt; x is not null)</code> leaves the
        element type <code>T?</code> and the compiler still warns — measured.</p>
      </div></details>
    </li>
    <li>
      <p>How would you enable this on a large existing codebase?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Turn it on project-wide, then put <code>#nullable disable</code> at the top of every
        existing file. New code is checked from day one; old files convert one at a time by deleting
        one line. Enabling it everywhere at once produces thousands of warnings and a team that turns
        it back off.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
