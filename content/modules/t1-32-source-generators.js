CSPREP.module({
  id: "t1-32-source-generators",
  minutes: 55,
  updated: "2026-08-30",
  summary: "A source generator is code that runs inside the compiler and adds C# to the compilation you are building. It solves the same problem reflection solves — behaviour derived from the shape of your types — with the discovery moved to build time, which removes the per-call cost, the trimming hazard, and the class of failure where a member is not found until production.",
  terms: ["source generator", "incremental generator", "IIncrementalGenerator", "Roslyn",
    "analyzer", "syntax provider", "predicate", "transform", "pipeline", "equatable model",
    "hint name", "partial", "post-initialisation output", "netstandard2.0",
    "EmitCompilerGeneratedFiles", "CS0260", "CS0111"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p><a href="#/m/t1-31-reflection-and-attributes">Reflection and Attributes</a> ended with a
  validator for Ledger — the payments and invoicing service these modules keep returning to — that
  read <code>[Required]</code> and <code>[Range]</code> attributes off a class and checked each
  property. It worked, and making it fast took a <code>ConcurrentDictionary</code>, compiled
  expression trees, and about thirty lines of caching that exist only to avoid doing at runtime what
  was already known at build time.</p>

  <p>It also came with three costs that no amount of caching removes. The trimmer cannot see
  <code>GetProperty("AmountMinor")</code>, so the property may be gone in a trimmed build. An AOT
  binary cannot compile an expression tree, so the optimisation silently becomes an interpreter —
  measured at <strong>258 ns against 5.5 ns</strong>. And a typo in an attribute name is found when
  the code runs, not when it compiles.</p>

  <p>All three exist because the work happens at the wrong time. <strong>The set of properties on
  <code>PaymentInstruction</code> is fixed the moment you compile it</strong>, and everything the
  validator discovers at startup could have been written down then.</p>

  <p>A source generator is how you write it down: code that runs <em>inside the compiler</em>,
  reads the same metadata, and adds ordinary C# to the compilation. This module is about writing
  one, what it costs, and the cases where it is the wrong answer.</p>
</section>

<section id="what-it-is">
  <h2>What a source generator is</h2>

  <p class="define"><span class="define__term">Source generator</span> A component the compiler
  loads and runs during a build. It is given the compilation being built — every syntax tree, every
  symbol — and may add new C# source files to it. It cannot modify or delete existing code.</p>

  <p class="define"><span class="define__term">Roslyn</span> The C# compiler, written in C# and
  usable as a library. A generator is a class implementing one of its interfaces, packaged as an
  <span class="define__term">analyzer</span> — the same delivery mechanism as a code-analysis
  rule.</p>

  <p>The analogy: a generator is a <strong>colleague who writes the boilerplate for you, at the
  moment you press build</strong>, from a specification you gave them. <strong>The analogy breaks in
  one useful place</strong> — a colleague could edit your file, and a generator cannot. It can only
  add, which is why every generated member joins a <code>partial</code> half you wrote.</p>

  <h3>The add-only rule, and what follows from it</h3>

  <p>A generator cannot change a line of your code. That single restriction shapes every design:</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>To add…</th><th>You write…</th><th>The generator writes…</th></tr></thead>
    <tbody>
      <tr><td>a member to a class</td><td><code>partial class Invoice</code></td>
          <td>the other <code>partial class Invoice</code></td></tr>
      <tr><td>a body to a method</td><td><code>partial void Log(string m);</code></td>
          <td>the implementing <code>partial</code> declaration</td></tr>
      <tr><td>an interface implementation</td><td><code>partial class X : IThing</code></td>
          <td>the members <code>IThing</code> requires</td></tr>
      <tr><td>a whole new type</td><td>nothing</td><td>the type</td></tr>
    </tbody>
  </table>
  </div>

  <p>Everything else — changing a method body, adding an attribute to your code, rewriting an
  expression — is not possible, and that is deliberate. <strong>What you read is what
  compiles</strong>, plus files you can open.</p>
</section>

<section id="the-generator">
  <h2>Writing one</h2>

  <p>The generator below does the audit-logging version of the reflective job: for every class marked
  <code>[AuditLog]</code>, it writes a <code>ToAuditLog()</code> method listing the public
  properties.</p>

  <pre data-lang="csharp" data-net="10" data-title="Ledger.Generators/AuditLogGenerator.cs"><code>// AuditLogGenerator.cs — an incremental source generator.
//
// It looks for classes marked [AuditLog] and writes, for each one, a partial
// method that formats every public property. That is the same job the reflective
// validator in t1-31 did at runtime, moved to build time.
//
// Three things make it INCREMENTAL rather than the old ISourceGenerator:
//   1. It registers a PIPELINE of transformations, not a single Execute method.
//   2. The predicate is a cheap syntax-only test, run on every keystroke.
//   3. The transform's output is a small, EQUATABLE value — so when the model
//      does not change, the compiler reuses the cached output and does not run
//      the generation step at all.

using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Text;

namespace Ledger.Generators
{
    /// &lt;summary&gt;
    /// A plain, equatable model. This is the single most important design rule:
    /// never let a Symbol or a SyntaxNode reach the pipeline's cached values, or
    /// caching cannot work and the generator runs on every keystroke.
    /// &lt;/summary&gt;
    internal sealed record AuditModel(
        string Namespace,
        string ClassName,
        string Accessibility,
        EquatableArray&lt;string&gt; PropertyNames);

    /// &lt;summary&gt;An array with value equality, so the record above compares by contents.&lt;/summary&gt;
    internal readonly struct EquatableArray&lt;T&gt; : IEquatable&lt;EquatableArray&lt;T&gt;&gt;
        where T : IEquatable&lt;T&gt;
    {
        private readonly T[] _items;
        public EquatableArray(T[] items) =&gt; _items = items;
        public int Count =&gt; _items?.Length ?? 0;
        public T[] AsArray() =&gt; _items ?? Array.Empty&lt;T&gt;();

        public bool Equals(EquatableArray&lt;T&gt; other)
        {
            var a = AsArray();
            var b = other.AsArray();
            if (a.Length != b.Length) return false;
            for (var i = 0; i &lt; a.Length; i++)
                if (!a[i].Equals(b[i])) return false;
            return true;
        }

        public override bool Equals(object? obj) =&gt; obj is EquatableArray&lt;T&gt; o &amp;&amp; Equals(o);

        public override int GetHashCode()
        {
            var hash = 17;
            foreach (var item in AsArray()) hash = hash * 31 + item.GetHashCode();
            return hash;
        }
    }

    [Generator]
    public sealed class AuditLogGenerator : IIncrementalGenerator
    {
        private const string AttributeSource = @"// &lt;auto-generated/&gt;
#nullable enable

namespace Ledger.App
{
    /// &lt;summary&gt;Marks a partial class for a generated audit-log formatter.&lt;/summary&gt;
    [global::System.AttributeUsage(global::System.AttributeTargets.Class)]
    internal sealed class AuditLogAttribute : global::System.Attribute
    {
    }
}
";

        public void Initialize(IncrementalGeneratorInitializationContext context)
        {
            // STEP 1: contribute the attribute itself, so the consumer does not
            // have to declare it. RegisterPostInitializationOutput runs once and
            // cannot depend on user code.
            context.RegisterPostInitializationOutput(ctx =&gt;
                ctx.AddSource("AuditLogAttribute.g.cs", SourceText.From(AttributeSource, Encoding.UTF8)));

            // STEP 2: find candidates. ForAttributeWithMetadataName is the fast
            // path — the compiler indexes attribute usages, so this does not walk
            // every syntax node.
            var models = context.SyntaxProvider
                .ForAttributeWithMetadataName(
                    "Ledger.App.AuditLogAttribute",
                    predicate: static (node, _) =&gt; node is ClassDeclarationSyntax,
                    transform: static (ctx, _) =&gt; ToModel(ctx))
                .Where(static m =&gt; m is not null)
                .Select(static (m, _) =&gt; m!);

            // STEP 3: generate. Runs only for models that actually changed.
            context.RegisterSourceOutput(models, static (spc, model) =&gt;
            {
                var source = Render(model);
                spc.AddSource($"{model.ClassName}.Audit.g.cs", SourceText.From(source, Encoding.UTF8));
            });
        }

        private static AuditModel? ToModel(GeneratorAttributeSyntaxContext ctx)
        {
            if (ctx.TargetSymbol is not INamedTypeSymbol symbol) return null;

            var names = symbol.GetMembers()
                .OfType&lt;IPropertySymbol&gt;()
                .Where(p =&gt; p.DeclaredAccessibility == Accessibility.Public &amp;&amp;
                            !p.IsStatic &amp;&amp; !p.IsIndexer &amp;&amp; p.GetMethod is not null)
                .Select(p =&gt; p.Name)
                .OrderBy(n =&gt; n, StringComparer.Ordinal)
                .ToArray();

            return new AuditModel(
                symbol.ContainingNamespace.IsGlobalNamespace
                    ? ""
                    : symbol.ContainingNamespace.ToDisplayString(),
                symbol.Name,
                symbol.DeclaredAccessibility == Accessibility.Public ? "public" : "internal",
                new EquatableArray&lt;string&gt;(names));
        }

        private static string Render(AuditModel model)
        {
            var sb = new StringBuilder();
            sb.AppendLine("// &lt;auto-generated/&gt;");
            sb.AppendLine("#nullable enable");
            sb.AppendLine();

            var indent = "";
            if (model.Namespace.Length &gt; 0)
            {
                sb.AppendLine($"namespace {model.Namespace}");
                sb.AppendLine("{");
                indent = "    ";
            }

            sb.AppendLine($"{indent}{model.Accessibility} partial class {model.ClassName}");
            sb.AppendLine($"{indent}{{");
            sb.AppendLine($"{indent}    /// &lt;summary&gt;Generated at build time from {model.PropertyNames.Count} public properties.&lt;/summary&gt;");
            sb.AppendLine($"{indent}    public string ToAuditLog()");
            sb.AppendLine($"{indent}    {{");

            if (model.PropertyNames.Count == 0)
            {
                sb.AppendLine($"{indent}        return \"{model.ClassName} {{ }}\";");
            }
            else
            {
                sb.AppendLine($"{indent}        var sb = new global::System.Text.StringBuilder();");
                sb.AppendLine($"{indent}        sb.Append(\"{model.ClassName} {{ \");");
                var names = model.PropertyNames.AsArray();
                for (var i = 0; i &lt; names.Length; i++)
                {
                    var sep = i == 0 ? "" : ", ";
                    sb.AppendLine($"{indent}        sb.Append(\"{sep}{names[i]}=\").Append(this.{names[i]});");
                }
                sb.AppendLine($"{indent}        sb.Append(\" }}\");");
                sb.AppendLine($"{indent}        return sb.ToString();");
            }

            sb.AppendLine($"{indent}    }}");
            sb.AppendLine($"{indent}}}");

            if (model.Namespace.Length &gt; 0) sb.AppendLine("}");
            return sb.ToString();
        }
    }
}</code></pre>

  <p class="define"><span class="define__term">IIncrementalGenerator</span> The interface a modern
  generator implements. Its single <code>Initialize</code> method registers a
  <span class="define__term">pipeline</span> of transformations rather than doing work directly —
  which is what lets the compiler cache intermediate results and skip stages whose inputs have not
  changed.</p>

  <p>The pipeline here has three stages, and each one is doing a specific job.</p>

  <p class="define"><span class="define__term">Post-initialisation output</span>
  <code>RegisterPostInitializationOutput</code> contributes source that does not depend on user code.
  Here it emits the <code>[AuditLog]</code> attribute itself, so the consumer never has to declare
  it — the pattern every modern generator uses.</p>

  <p class="define"><span class="define__term">Syntax provider</span> The stage that finds
  candidates. <code>ForAttributeWithMetadataName</code> is the fast form: the compiler keeps an index
  of attribute usages, so it does not walk every node in every file.
  <span class="define__term">Predicate</span> a cheap syntax-only test run on every keystroke;
  <span class="define__term">transform</span> the expensive semantic step, run only for nodes the
  predicate accepted.</p>

  <p class="define"><span class="define__term">Equatable model</span> The small value the transform
  produces. <strong>This is the single most important design decision in a generator.</strong> The
  compiler decides whether to re-run the generation stage by comparing this value with the previous
  one, so it must have value equality and must not contain a <code>Symbol</code> or a
  <code>SyntaxNode</code> — those keep an entire compilation alive and never compare equal.</p>

  <p>Hence the <code>EquatableArray&lt;T&gt;</code> in the listing. A <code>record</code> holding a
  plain <code>string[]</code> compares arrays by reference, so every keystroke would produce an
  unequal model and re-run generation for every marked class in the solution — the most common reason
  a generator makes an IDE feel slow.</p>

  <p class="define"><span class="define__term">partial</span> A modifier splitting one type or
  method across several files, which the compiler merges into a single declaration. It is the
  mechanism every generator uses to add members, because a generator can only add files.</p>

  <p class="define"><span class="define__term">Hint name</span> The file name passed to
  <code>AddSource</code>. It must be unique across the whole compilation; two generators or two
  classes colliding on one is a build error. Real generators use the fully-qualified type name, not
  the short one.</p>
</section>

<section id="wiring">
  <h2>Wiring it up</h2>

  <p>Two project files do all of it, and both contain lines that are not optional.</p>

  <pre data-lang="xml" data-title="Ledger.Generators/Ledger.Generators.csproj"><code>&lt;Project Sdk="Microsoft.NET.Sdk"&gt;

  &lt;PropertyGroup&gt;
    &lt;!-- A generator runs INSIDE the compiler, so it targets netstandard2.0 —
         the version the compiler host itself can load. This is not a choice. --&gt;
    &lt;TargetFramework&gt;netstandard2.0&lt;/TargetFramework&gt;
    &lt;LangVersion&gt;latest&lt;/LangVersion&gt;
    &lt;Nullable&gt;enable&lt;/Nullable&gt;
    &lt;ImplicitUsings&gt;disable&lt;/ImplicitUsings&gt;
    &lt;IsRoslynComponent&gt;true&lt;/IsRoslynComponent&gt;
    &lt;EnforceExtendedAnalyzerRules&gt;true&lt;/EnforceExtendedAnalyzerRules&gt;
    &lt;IncludeBuildOutput&gt;false&lt;/IncludeBuildOutput&gt;
  &lt;/PropertyGroup&gt;

  &lt;ItemGroup&gt;
    &lt;PackageReference Include="Microsoft.CodeAnalysis.CSharp" Version="4.8.0" PrivateAssets="all" /&gt;
  &lt;/ItemGroup&gt;

&lt;/Project&gt;</code></pre>

  <pre data-lang="xml" data-title="Ledger.App/Ledger.App.csproj"><code>&lt;Project Sdk="Microsoft.NET.Sdk"&gt;

  &lt;PropertyGroup&gt;
    &lt;OutputType&gt;Exe&lt;/OutputType&gt;
    &lt;TargetFramework&gt;net10.0&lt;/TargetFramework&gt;
    &lt;Nullable&gt;enable&lt;/Nullable&gt;
    &lt;ImplicitUsings&gt;enable&lt;/ImplicitUsings&gt;
    &lt;RootNamespace&gt;Ledger.App&lt;/RootNamespace&gt;
    &lt;!-- Write the generated files to disk so they can be read and shown. --&gt;
    &lt;EmitCompilerGeneratedFiles&gt;true&lt;/EmitCompilerGeneratedFiles&gt;
    &lt;CompilerGeneratedFilesOutputPath&gt;generated&lt;/CompilerGeneratedFilesOutputPath&gt;
  &lt;/PropertyGroup&gt;

  &lt;ItemGroup&gt;
    &lt;!-- EmitCompilerGeneratedFiles writes the generated source INTO the project
         folder, where the SDK's default globbing would then compile it a second
         time (CS0101, CS0111, CS0579). Excluding it is mandatory whenever the
         output path is inside the project. --&gt;
    &lt;Compile Remove="generated/**/*.cs" /&gt;
  &lt;/ItemGroup&gt;

  &lt;ItemGroup&gt;
    &lt;!-- OutputItemType=Analyzer is what makes this a generator rather than a
         normal reference. ReferenceOutputAssembly=false means the app does not
         link against the generator's own assembly. --&gt;
    &lt;ProjectReference Include="..\Ledger.Generators\Ledger.Generators.csproj"
                      OutputItemType="Analyzer"
                      ReferenceOutputAssembly="false" /&gt;
  &lt;/ItemGroup&gt;

&lt;/Project&gt;</code></pre>

  <p class="define"><span class="define__term">netstandard2.0</span> A target framework describing an
  API surface rather than a runtime, supported by both .NET Framework and modern .NET. The compiler
  host loads generators built against it, which is why every generator targets it regardless of what
  the application does.</p>

  <p><strong><code>netstandard2.0</code> is not a choice.</strong> The generator runs inside the
  compiler process, and that is the version the compiler host loads. Targeting
  <code>net10.0</code> produces a generator the compiler silently declines to run — no error, no
  generated code, and a build that fails on missing members.</p>

  <p>That target has real consequences. <code>record</code> and <code>init</code> need a polyfill,
  which was hit while writing this fixture:</p>

  <pre data-lang="csharp" data-net="10" data-title="Ledger.Generators/Polyfills.cs"><code>// Polyfills.cs — netstandard2.0 predates several C# features the compiler will
// still let you USE, provided the marker type exists. This is a real constraint
// of writing generators, not an incidental detail:
//
//   error CS0518: Predefined type 'System.Runtime.CompilerServices.IsExternalInit'
//   is not defined or imported
//
// is what you get from a &#96;record&#96; or an &#96;init&#96; property without this file.

using System.ComponentModel;

namespace System.Runtime.CompilerServices
{
    /// &lt;summary&gt;Required by the compiler for &#96;init&#96; accessors and positional records.&lt;/summary&gt;
    [EditorBrowsable(EditorBrowsableState.Never)]
    internal static class IsExternalInit
    {
    }
}</code></pre>

  <p><strong><code>OutputItemType="Analyzer"</code> is what makes the reference a generator</strong>
  rather than an ordinary dependency, and
  <code>ReferenceOutputAssembly="false"</code> stops the app linking against the generator's own
  assembly — which would drag Roslyn into the shipped output.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong><code>EmitCompilerGeneratedFiles</code> writing inside the project breaks the
    build.</strong> Hit while writing this fixture: the SDK's default globbing compiles the emitted
    files a second time, alongside the copies the generator produces in memory —
    <code>CS0101</code>, <code>CS0579</code> and <code>CS0111</code> at once, all pointing at
    generated files. The fix is one line, <code>&lt;Compile Remove="generated/**/*.cs" /&gt;</code>,
    or an output path outside the project directory.</p>
  </div>
</section>

<section id="production-example">
  <h2>Using it, and what it costs</h2>

  <pre data-lang="csharp" data-net="10" data-title="Ledger.App/Program.cs"><code>// Program.cs — the consumer. Nothing here calls the generator; the compiler runs
// it and the generated members are ordinary members of these classes.

using System.Diagnostics;
using System.Reflection;

namespace Ledger.App;

// [AuditLog] comes from the generator itself, via RegisterPostInitializationOutput.
// 'partial' is what lets the generated half join this one.
[AuditLog]
public partial class Invoice
{
    public string Number { get; set; } = "INV-1";
    public string CustomerId { get; set; } = "CUST-1";
    public long AmountMinor { get; set; } = 120_00;
    private string Secret { get; set; } = "hidden";      // not public: not logged
}

[AuditLog]
public partial class Payment
{
    public string Reference { get; set; } = "P-1";
    public long AmountMinor { get; set; } = 5_000;
}

// No attribute: no generated member. Proof that generation is opt-in.
public partial class Refund
{
    public string Reference { get; set; } = "R-1";
}

public static class Program
{
    public static void Main()
    {
        var invoice = new Invoice();
        var payment = new Payment();

        Console.WriteLine("--- generated members, called like any other ---");
        Console.WriteLine($"  {invoice.ToAuditLog()}");
        Console.WriteLine($"  {payment.ToAuditLog()}");
        Console.WriteLine("  ToAuditLog() was written by the generator at build time.");
        Console.WriteLine("  IntelliSense sees it, Go to Definition opens the generated");
        Console.WriteLine("  file, and a typo in it is a compile error like any other.");

        Console.WriteLine();
        Console.WriteLine("--- the private property is absent, by design ---");
        Console.WriteLine($"  Invoice has a private Secret : " +
                          $"{typeof(Invoice).GetProperty("Secret", BindingFlags.NonPublic | BindingFlags.Instance) is not null}");
        Console.WriteLine($"  it appears in the audit log  : {invoice.ToAuditLog().Contains("Secret")}");

        Console.WriteLine();
        Console.WriteLine("--- Refund has no [AuditLog], so it has no ToAuditLog ---");
        Console.WriteLine($"  method exists : {typeof(Refund).GetMethod("ToAuditLog") is not null}");

        Console.WriteLine();
        Console.WriteLine("--- the generated method is a NORMAL method in metadata ---");
        var method = typeof(Invoice).GetMethod(nameof(Invoice.ToAuditLog))!;
        Console.WriteLine($"  DeclaringType : {method.DeclaringType!.Name}");
        Console.WriteLine($"  IsStatic      : {method.IsStatic}");
        Console.WriteLine($"  ReturnType    : {method.ReturnType.Name}");
        Console.WriteLine("  There is no marker distinguishing it from hand-written code.");
        Console.WriteLine("  The trimmer sees a real method being called and keeps it.");

        Console.WriteLine();
        Console.WriteLine("--- cost, against the reflective equivalent ---");
        var generated = Time(() =&gt; _sink += invoice.ToAuditLog().Length);
        var reflective = Time(() =&gt; _sink += ReflectiveAuditLog(invoice).Length, 200_000);
        Console.WriteLine($"  generated  : {generated,8:N0} ns/op");
        Console.WriteLine($"  reflective : {reflective,8:N0} ns/op");
        Console.WriteLine($"  ratio      : {reflective / generated,8:N1}x");
        Console.WriteLine($"  same text  : {invoice.ToAuditLog() == ReflectiveAuditLog(invoice)}");

        Console.WriteLine();
        Console.WriteLine($"  allocation, generated  : {AllocOf(() =&gt; _sink += invoice.ToAuditLog().Length),5} bytes");
        Console.WriteLine($"  allocation, reflective : {AllocOf(() =&gt; _sink += ReflectiveAuditLog(invoice).Length),5} bytes");
        Console.WriteLine("  No PropertyInfo lookups, no boxing, no cache to maintain.");
        Console.WriteLine("  The generator did the discovery once, at build time, for free.");

        Console.WriteLine();
        Console.WriteLine("--- where the generated source went ---");
        Console.WriteLine("  EmitCompilerGeneratedFiles=true writes it under:");
        Console.WriteLine("    Ledger.App/generated/Ledger.Generators/");
        Console.WriteLine("      Ledger.Generators.AuditLogGenerator/");
        Console.WriteLine("  Those files are build OUTPUT: readable, debuggable, and");
        Console.WriteLine("  regenerated on every build. Editing them achieves nothing.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    private static long _sink;

    /// &lt;summary&gt;The runtime equivalent, for comparison. Uncached, as a first attempt would be.&lt;/summary&gt;
    private static string ReflectiveAuditLog(object instance)
    {
        var sb = new System.Text.StringBuilder();
        var type = instance.GetType();
        sb.Append(type.Name).Append(" { ");
        var first = true;
        foreach (var p in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                              .OrderBy(p =&gt; p.Name, StringComparer.Ordinal))
        {
            if (!first) sb.Append(", ");
            first = false;
            sb.Append(p.Name).Append('=').Append(p.GetValue(instance));
        }
        return sb.Append(" }").ToString();
    }

    private static double Time(Action a, int iterations = 1_000_000)
    {
        for (var i = 0; i &lt; Math.Min(iterations, 1_000); i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; iterations; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / iterations;
    }

    private static long AllocOf(Action a)
    {
        a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        a();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- generated members, called like any other ---
  Invoice { AmountMinor=12000, CustomerId=CUST-1, Number=INV-1 }
  Payment { AmountMinor=5000, Reference=P-1 }
  ToAuditLog() was written by the generator at build time.
  IntelliSense sees it, Go to Definition opens the generated
  file, and a typo in it is a compile error like any other.

--- the private property is absent, by design ---
  Invoice has a private Secret : True
  it appears in the audit log  : False

--- Refund has no [AuditLog], so it has no ToAuditLog ---
  method exists : False

--- the generated method is a NORMAL method in metadata ---
  DeclaringType : Invoice
  IsStatic      : False
  ReturnType    : String
  There is no marker distinguishing it from hand-written code.
  The trimmer sees a real method being called and keeps it.

--- cost, against the reflective equivalent ---
  generated  :      289 ns/op
  reflective :    2,094 ns/op
  ratio      :      7.2x
  same text  : True

  allocation, generated  :   496 bytes
  allocation, reflective :  1000 bytes
  No PropertyInfo lookups, no boxing, no cache to maintain.
  The generator did the discovery once, at build time, for free.

--- where the generated source went ---
  EmitCompilerGeneratedFiles=true writes it under:
    Ledger.App/generated/Ledger.Generators/
      Ledger.Generators.AuditLogGenerator/
  Those files are build OUTPUT: readable, debuggable, and
  regenerated on every build. Editing them achieves nothing.
  (checksum 74524248)</code></pre>

  <p><strong>7.2× faster and half the allocation, for the same text.</strong> The reflective version
  is the uncached shape from
  <a href="#/m/t1-31-reflection-and-attributes">Reflection and Attributes</a>; the generated one has
  no <code>PropertyInfo</code>, no boxing, and no cache to maintain — because the discovery already
  happened, during the build.</p>

  <p>And here is what the compiler actually wrote:</p>

  <pre data-lang="csharp" data-net="10" data-title="Invoice.Audit.g.cs (generated)"><code>// &lt;auto-generated/&gt;
#nullable enable

namespace Ledger.App
{
    public partial class Invoice
    {
        /// &lt;summary&gt;Generated at build time from 3 public properties.&lt;/summary&gt;
        public string ToAuditLog()
        {
            var sb = new global::System.Text.StringBuilder();
            sb.Append("Invoice { ");
            sb.Append("AmountMinor=").Append(this.AmountMinor);
            sb.Append(", CustomerId=").Append(this.CustomerId);
            sb.Append(", Number=").Append(this.Number);
            sb.Append(" }");
            return sb.ToString();
        }
    }
}</code></pre>

  <p><strong>Ordinary C#, readable, and debuggable.</strong> That is the property reflection cannot
  offer: you can open the file, step through it, and see exactly what will run. The private
  <code>Secret</code> property is absent because the generator's transform filtered it out at build
  time, rather than because something checked <code>BindingFlags</code> at runtime.</p>

  <p><strong>The generated method is indistinguishable in metadata.</strong> Measured:
  <code>DeclaringType</code> is <code>Invoice</code>, and there is no marker separating it from
  hand-written code — which is precisely why the trimmer keeps it. It sees a real method being
  called.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>The <code>global::</code> prefixes are not decoration.</strong> Generated code lands
    in a namespace it knows nothing about, where <code>System</code> might be
    <code>Ledger.System</code>. Fully-qualifying every type is how a generator avoids producing code
    that compiles in the test project and fails in a customer's. The same reasoning applies to
    <code>#nullable enable</code>: the consumer's setting is unknown, so the generated file states
    its own.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Forgetting <code>partial</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the two halves cannot join"><code>// WRONG. Verified:
//   Program.cs(12,14): error CS0260: Missing partial modifier on declaration of
//   type 'Invoice'; another partial declaration of this type exists
[AuditLog]
public class Invoice
{
    public string Number { get; set; } = "INV-1";
}

// Right.
[AuditLog]
public partial class Invoice
{
    public string Number { get; set; } = "INV-1";
}</code></pre>

  <p>The most common first mistake, and the message names the fix. A production generator reports its
  own diagnostic here instead, because <code>CS0260</code> does not explain <em>why</em> the type
  needs to be partial.</p>

  <h3>2. A model that contains symbols</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: caching cannot work"><code>// WRONG. INamedTypeSymbol has reference equality and holds the whole
// compilation alive, so every keystroke produces an "unequal" model and
// re-runs generation for every marked class in the solution.
internal sealed record Model(INamedTypeSymbol Symbol);

// Also wrong: string[] compares by reference.
internal sealed record Model(string Name, string[] Properties);

// Right: value equality all the way down.
internal sealed record Model(string Name, EquatableArray&lt;string&gt; Properties);</code></pre>

  <p>This does not break the build. It makes the IDE slow, which is much harder to attribute — the
  usual symptom is a solution where typing in one file feels laggy and nobody knows why.</p>

  <h3>3. Targeting the wrong framework</h3>

  <pre data-lang="xml" data-bad="true" data-title="Wrong: the compiler will not load it"><code>&lt;!-- WRONG. No error is produced. The generator never runs, and the build
     fails on every member it was supposed to create. --&gt;
&lt;PropertyGroup&gt;
  &lt;TargetFramework&gt;net10.0&lt;/TargetFramework&gt;
&lt;/PropertyGroup&gt;

&lt;!-- Right: the version the compiler host itself loads. --&gt;
&lt;PropertyGroup&gt;
  &lt;TargetFramework&gt;netstandard2.0&lt;/TargetFramework&gt;
  &lt;IsRoslynComponent&gt;true&lt;/IsRoslynComponent&gt;
  &lt;IncludeBuildOutput&gt;false&lt;/IncludeBuildOutput&gt;
&lt;/PropertyGroup&gt;</code></pre>

  <p><code>netstandard2.0</code> or the compiler will not load it. There is no error: the generator
  never runs at all, and the build fails on the members it was supposed to produce.</p>

  <h3>4. Colliding hint names</h3>

  <p><code>AddSource("Invoice.g.cs", …)</code> from two generators, or for two
  <code>Invoice</code> classes in different namespaces, is a build failure. Use the fully-qualified
  name.</p>

  <h3>5. Emitting into the project directory without excluding it</h3>

  <p>Verified: <code>CS0101</code>, <code>CS0579</code> and <code>CS0111</code> together, all
  reported in generated files. <code>&lt;Compile Remove="generated/**/*.cs" /&gt;</code>.</p>

  <h3>6. Declaring the generated member yourself</h3>

  <p>Verified: <code>error CS0111: Type 'Payment' already defines a member called 'ToAuditLog'</code>,
  reported <em>in the generated file</em> rather than in yours. The generator has no idea you wrote
  one; a careful one checks and skips.</p>

  <h3>7. Generating code without <code>global::</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: compiles for you, not for your consumer"><code>// WRONG. This is the string a generator emits. It compiles in a test project
// and fails in a consumer who happens to have a namespace called System or Text.
sb.AppendLine("        var sb = new System.Text.StringBuilder();");

// Right: nothing the consumer declares can shadow a global:: name.
sb.AppendLine("        var sb = new global::System.Text.StringBuilder();");</code></pre>

  <p>It compiles in your test project and breaks in a consumer who has a namespace called
  <code>System</code>, <code>Text</code>, or anything else that shadows a name you used unqualified.
  Fully-qualify everything.</p>

  <h3>8. Reaching for a generator when a method would do</h3>

  <p>A generator is a separate project, a separate target framework, its own tests, and a build-time
  dependency for everyone who consumes the library. If the code can be written by hand once, or
  expressed with generics, that is a better answer.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>The generated member does not exist.</strong> First check the generator ran at all: set
    <code>&lt;EmitCompilerGeneratedFiles&gt;true&lt;/EmitCompilerGeneratedFiles&gt;</code> and
    <code>&lt;CompilerGeneratedFilesOutputPath&gt;</code>, rebuild, and look for the files. Nothing
    there means the generator did not run — nearly always the wrong target framework or a missing
    <code>OutputItemType="Analyzer"</code>.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Reading what was generated.</strong> Those emitted files are the ground truth, and
    they are ordinary C#. In Visual Studio and Rider they also appear under Dependencies → Analyzers
    in Solution Explorer, and Go to Definition on a generated member opens them. Breakpoints in them
    work.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Debugging the generator itself.</strong> It runs inside the compiler, so there is no
    process to attach to conveniently. Two options: set
    <code>&lt;IsRoslynComponent&gt;true&lt;/IsRoslynComponent&gt;</code> and use the IDE's Roslyn
    Component launch profile, or — far simpler — write unit tests that drive it with
    <code>CSharpGeneratorDriver</code> over a string of source and assert on the output. The second
    is what every shipped generator does.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>The IDE feels slow after adding a generator.</strong> The model is not equatable.
    Check that nothing in it is a <code>Symbol</code>, a <code>SyntaxNode</code>, a
    <code>Compilation</code>, or a bare array. The
    <code>IncrementalGeneratorRunReasons</code> exposed by
    <code>GeneratorDriverRunResult</code> in a test will tell you whether steps are being
    <code>Cached</code> or re-run as <code>New</code>.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A generator behaves differently in the IDE and on the build server.</strong> Usually a
    stale analyzer assembly: the IDE loads the generator once and holds it. Restart the IDE after
    changing generator code, and check the build server is restoring the same package version.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Deciding whether to write one at all.</strong> Two questions. <em>Is the information
    available at compile time?</em> If not, a generator cannot help. <em>Is the code otherwise
    repetitive enough to be worth a second project, a second target framework, and a build-time
    dependency for every consumer?</em> Below roughly a few dozen call sites, it is not.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A concrete case.</strong> Ledger's public API was moved to native AOT to cut cold-start
    time — the service ran on a scale-to-zero platform, and a 900 ms JIT start was showing up as p99
    latency for the first request after a quiet period.</p>
    <p>The AOT build succeeded. It produced <strong>340 <code>IL2026</code> and
    <code>IL3050</code> warnings</strong>, almost all from
    <code>JsonSerializer.Serialize</code> and from an internal object mapper built on
    <code>Expression.Compile()</code>. With a deadline, the team added
    <code>&lt;NoWarn&gt;IL2026;IL3050&lt;/NoWarn&gt;</code> and shipped, because the smoke tests
    passed.</p>
    <p>They passed because the failures are not exceptions. Two appeared in the first week.
    Serialising one response type returned <code>{}</code> — the trimmer had removed properties
    nothing referenced statically, and the serialiser found none to write. And the object mapper got
    <strong>roughly 47× slower per property</strong>, because <code>Expression.Compile()</code> with
    no runtime code generation falls back to an interpreter: measured at
    <strong>258 ns against 5.5 ns</strong>, allocating 176 bytes where it had allocated none.</p>
    <p>The second one was the expensive investigation. Cold start had improved exactly as hoped, so
    nobody suspected the AOT migration; the mapper had not been touched; and the p99 regression was
    in a service whose CPU graph looked normal because the extra work was spread evenly.</p>
    <p>The fix was two source generators' worth of work, most of it already written by other people:
    <code>[JsonSerializable]</code> on a <code>JsonSerializerContext</code> for the response types,
    and replacing the hand-rolled mapper with a generated one. Warnings went from 340 to
    <strong>zero</strong>, the empty-response bug became impossible — the generated serialiser
    <em>names</em> the properties, so the trimmer keeps them — and mapping returned to its original
    speed.</p>
  </div>

  <p>The general principle: <strong>a source generator turns runtime discovery into a compile-time
  reference, and a compile-time reference is something every other tool can see.</strong> The trimmer
  keeps what generated code names. The AOT compiler needs no runtime codegen. The IDE offers
  completion. A typo is a build error.</p>

  <p>That is why the direction of travel in .NET is one-way. <code>[JsonSerializable]</code>,
  <code>[LoggerMessage]</code>, <code>[GeneratedRegex]</code>, the configuration binder, the options
  validator — each replaced a reflective implementation that still exists and still works, and each
  is the recommended path for anything published trimmed or AOT.</p>

  <p>The honest limit is worth stating as firmly. <strong>A generator can only know what the compiler
  knows.</strong> A plugin system loading assemblies named in configuration, a test runner, a
  debugger, a mapper over types that arrive at runtime — none of those can be generated, and
  reflection remains the only tool. The skill is telling the two apart, and the question that does it
  is: <em>could I have written this by hand when I compiled?</em></p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A source generator can modify my code."</strong> It cannot. It only adds files.
    Every "added member" is a <code>partial</code> half joining one you wrote, which is why
    forgetting <code>partial</code> is <code>CS0260</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Generated code is special somehow."</strong> Verified: the generated method's
    <code>DeclaringType</code> is the ordinary class and nothing in metadata distinguishes it. That
    is exactly why the trimmer keeps it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Incremental generators are incremental automatically."</strong> Only if the model is
    equatable. A record holding an <code>INamedTypeSymbol</code> or a bare <code>string[]</code>
    never compares equal, so every keystroke re-runs everything — and the only symptom is a slow
    IDE.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I can target <code>net10.0</code> since that is what my app uses."</strong> The
    generator runs in the compiler, which loads <code>netstandard2.0</code>. Target anything else and
    it silently does not run.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Generators slow the build down a lot."</strong> This one added a project and a few
    milliseconds. What slows a build — and an IDE much more — is a non-equatable model re-running
    generation for every type on every keystroke.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Generators replace reflection."</strong> They replace the cases where the answer was
    knowable at compile time, which is most of them. They cannot help a plugin loader, a test runner
    or a debugger, where the types are genuinely unknown until runtime.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I should edit the generated file to fix a bug."</strong> It is build output,
    regenerated every build. Verified in the fixture: the files under
    <code>generated/</code> are rewritten on each compile, and the copy the compiler uses is
    in-memory in any case.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>Behaviour derived from the shape of types you compile</td><td>A generator</td>
          <td>7.2× faster here, trimmable, and typos become build errors.</td></tr>
      <tr><td>The types are not known until runtime</td><td>Reflection, cached</td>
          <td>A generator can only know what the compiler knows.</td></tr>
      <tr><td>JSON, logging, regex, configuration binding</td><td>The framework's generator</td>
          <td><code>[JsonSerializable]</code>, <code>[LoggerMessage]</code>,
          <code>[GeneratedRegex]</code> — already written and tested.</td></tr>
      <tr><td>Anything published trimmed or AOT</td><td>Generators, and treat
          <code>IL2xxx</code>/<code>IL3xxx</code> as errors</td>
          <td>The reflective failures are silent: an empty response, or 47× slower.</td></tr>
      <tr><td>Under a few dozen repetitive call sites</td><td>Write it by hand</td>
          <td>A generator is a project, a framework target, and a build dependency for every
          consumer.</td></tr>
      <tr><td>The generator project's target framework</td><td><code>netstandard2.0</code></td>
          <td>Anything else and the compiler silently declines to load it.</td></tr>
      <tr><td>The pipeline's model type</td><td>A record of primitives, with an equatable
          collection</td><td>Value equality is what makes caching work.</td></tr>
      <tr><td>Finding candidates</td><td><code>ForAttributeWithMetadataName</code></td>
          <td>Uses the compiler's attribute index instead of walking every node.</td></tr>
      <tr><td>The attribute the generator looks for</td><td>Emit it from
          <code>RegisterPostInitializationOutput</code></td>
          <td>The consumer then needs no extra package or declaration.</td></tr>
      <tr><td>Naming generated files</td><td>The fully-qualified type name</td>
          <td>Hint names must be unique across the whole compilation.</td></tr>
      <tr><td>Referring to any type in generated code</td><td><code>global::</code>, always</td>
          <td>You do not know what names the consumer's namespaces shadow.</td></tr>
      <tr><td>Testing a generator</td><td><code>CSharpGeneratorDriver</code> in a unit test</td>
          <td>Debugging inside a compiler process is far worse.</td></tr>
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
    <p>The consumer declares <code>[AuditLog] public class Invoice</code>, without
    <code>partial</code>. What happens, and why is that the error rather than "generator failed"?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>Ledger.App\Program.cs(12,14): error CS0260: Missing partial modifier on
declaration of type 'Invoice'; another partial declaration of this type exists</code></pre>
        <p><strong>The generator succeeded.</strong> It ran, produced
        <code>Invoice.Audit.g.cs</code> containing <code>public partial class Invoice</code>, and
        handed it to the compiler. The compiler then found two declarations of the same type where
        only one says <code>partial</code>, and that is an ordinary C# error with an ordinary C#
        message.</p>
        <p><strong>That is the whole model in one diagnostic.</strong> A generator adds source; the
        compiler then compiles the union of your files and its files under the normal rules. There
        is no separate "generator error" category, and the error points at <em>your</em> line 12
        because that is the declaration that needs changing.</p>
        <p>Note where the error is <em>not</em>: it does not say the generator failed, because it did
        not. A generator that genuinely fails — throws during
        <code>Initialize</code> or a transform — produces a different diagnostic,
        <code>CS8785: Generator failed to generate source</code>, naming the generator type and the
        exception.</p>
        <p><strong>What a careful generator does instead:</strong> check in the transform whether the
        declaration is partial, and report its own diagnostic — "AUD001: [AuditLog] requires a
        partial class" — which explains the reason where <code>CS0260</code> only states the rule.
        Every shipped generator does this, and it is the main reason they come with analyser rule
        IDs.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Explain what is wrong with each of these pipeline models, and what the symptom would be.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>// (a)
internal sealed record Model(INamedTypeSymbol Symbol);

// (b)
internal sealed record Model(string Name, string[] PropertyNames);

// (c)
internal sealed record Model(string Name, ImmutableArray&lt;string&gt; PropertyNames);

// (d)
internal sealed record Model(string Name, EquatableArray&lt;string&gt; PropertyNames);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>(a) is the worst.</strong> <code>INamedTypeSymbol</code> has reference equality, so
        two runs never produce equal models even when nothing changed. Worse, a symbol holds a
        reference to the whole <code>Compilation</code> it came from — so the generator's cache pins
        every syntax tree and every symbol table in memory, for every cached entry.</p>
        <p>Symptom: the IDE gets slower and its memory grows the longer it stays open. This is the
        single most-cited generator anti-pattern, and it is invisible in a unit test that runs the
        generator once.</p>
        <p><strong>(b) has correct-looking value equality that is not.</strong>
        A <code>record</code>'s generated <code>Equals</code> calls <code>Equals</code> on each
        member, and <code>string[].Equals</code> is reference equality. Two arrays with identical
        contents compare unequal, so generation re-runs on every keystroke for every marked type —
        without the memory problem, but with the same laggy typing.</p>
        <p><strong>(c) is the same bug in a more convincing costume.</strong>
        <code>ImmutableArray&lt;T&gt;</code> is a struct wrapping an array, and its
        <code>Equals</code> compares the <em>underlying array reference</em>. It is immutable, which
        makes people assume value equality; it does not have it. This one catches experienced people.</p>
        <p><strong>(d) is correct</strong>, provided <code>EquatableArray&lt;T&gt;</code> implements
        <code>Equals</code> element by element — as the listing in this module does. That is why such
        a type appears in essentially every production generator, and why the Roslyn SDK's own
        samples ship one.</p>
        <p><strong>How to verify rather than assume:</strong> a test that runs the driver twice over
        the same source and asserts the second run's steps report
        <code>IncrementalStepRunReason.Cached</code>. Without that test, a model regression is
        invisible until someone complains that the IDE feels slow.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Compare the generated <code>ToAuditLog()</code> with the reflective equivalent. Explain the
    measured difference, and say what else changed besides speed.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>generated  :      289 ns/op
reflective :    2,094 ns/op
ratio      :      7.2x
same text  : True

allocation, generated  :   496 bytes
allocation, reflective :  1000 bytes</code></pre>
        <p><strong>Where the 7.2× goes.</strong> The reflective version does, on every call:
        <code>GetType()</code>, <code>GetProperties()</code> (which builds an array), an
        <code>OrderBy</code>, and one <code>GetValue</code> per property — each boxing its result, at
        the 24 bytes measured in
        <a href="#/m/t1-31-reflection-and-attributes">Reflection and Attributes</a>. The generated
        version does none of it: three <code>StringBuilder.Append</code> calls on properties named
        directly.</p>
        <p>The remaining 496 bytes in the generated version is the
        <code>StringBuilder</code> and the string it produces — real work that both versions must
        do.</p>
        <p><strong>What else changed, which matters more than the ratio:</strong></p>
        <ul>
          <li><strong>The trimmer keeps the properties.</strong> The generated code names
          <code>this.AmountMinor</code>, which is a static reference the trimmer follows. The
          reflective version names it in a string, which it cannot.</li>
          <li><strong>There is no cache to get wrong.</strong> The cached reflective validator in the
          previous module needed a <code>ConcurrentDictionary</code>, an equality decision about the
          key, and a thread-safety argument. None of that exists here.</li>
          <li><strong>A mistake is a build error.</strong> Renaming <code>AmountMinor</code>
          regenerates the method; renaming it in a reflective mapper that used a string produces a
          runtime null.</li>
          <li><strong>It is debuggable.</strong> You can set a breakpoint in
          <code>Invoice.Audit.g.cs</code> and step through it.</li>
        </ul>
        <p><strong>The honest counterweight:</strong> the reflective version is 25 lines in one file
        and works on any type, including ones that do not exist yet. The generator is a second
        project, a <code>netstandard2.0</code> target, a polyfill file, and a build-time dependency
        for every consumer of the library. <strong>At three types the reflective version is the
        right call; at three hundred, or under AOT, the generator is.</strong></p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>You are asked to replace a reflective object mapper with a generated one. Work out what the
    generator would need, what it cannot do, and how you would decide whether to write it.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>What it needs, concretely.</strong> Given
        <code>[MapTo(typeof(InvoiceDto))] public partial class Invoice</code>, the generator
        must:</p>
        <ul>
          <li>Read the attribute's <code>typeof</code> argument — available as an
          <code>ITypeSymbol</code> in the transform.</li>
          <li>List the readable properties of the source and the writable properties of the
          destination, and match them by name.</li>
          <li>Check assignability for each pair, using
          <code>Compilation.ClassifyConversion</code>.</li>
          <li>Emit <code>public InvoiceDto ToInvoiceDto() =&gt; new() { Number = this.Number, … };</code></li>
          <li>Reduce all of that to an <strong>equatable model</strong> — a record of
          <code>(string SourceName, string DestName, EquatableArray&lt;(string, string)&gt; Pairs)</code>
          — before it reaches <code>RegisterSourceOutput</code>. No symbols past the
          transform.</li>
        </ul>
        <p><strong>What it cannot do.</strong> Three things, and each is a design constraint rather
        than an inconvenience:</p>
        <ul>
          <li><strong>Map to a type it cannot see at compile time.</strong> If the destination is
          chosen from configuration, or lives in an assembly loaded at runtime, no generator can
          help.</li>
          <li><strong>Modify the source class.</strong> Everything joins a <code>partial</code>, so
          a mapper for a type from a NuGet package must generate an extension method or a separate
          static class instead of a member.</li>
          <li><strong>See other generators' output.</strong> Generators run against the user's
          source, not against each other's results, so a mapper cannot map a DTO that another
          generator produces.</li>
        </ul>
        <p><strong>What it must do that the reflective version did not:</strong> report good
        diagnostics. A property with no match, or one whose types do not convert, is a build error
        the generator has to describe — "MAP002: Invoice.Amount (decimal) cannot map to
        InvoiceDto.Amount (string)". The reflective mapper silently skipped or threw at runtime, and
        replacing that with a build error is most of the value.</p>
        <p><strong>How to decide.</strong> Two questions in order:</p>
        <ol>
          <li><em>Is the information available at compile time?</em> If any mapping is chosen at
          runtime, stop — reflection, cached, is the answer.</li>
          <li><em>Is the volume worth the machinery?</em> The generator is a project, a
          <code>netstandard2.0</code> target, polyfills, a test suite driving
          <code>CSharpGeneratorDriver</code>, and a build-time dependency for every consumer. Below a
          few dozen mappings, hand-written methods are less total code and no build complexity.</li>
        </ol>
        <p><strong>And the answer that is usually right:</strong> do not write it. Mapperly does
        exactly this, is source-generated, and is tested by more people than will ever read your
        version. The reason to build a generator yourself is a pattern specific to your domain that
        no package covers — which is a much rarer situation than it feels like while you are staring
        at the boilerplate.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What can a source generator do, and what can it not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Add C# files to the compilation. Nothing else.</strong> It cannot modify or delete
        your code, which is why every added member joins a <code>partial</code> half you wrote.</p>
      </div></details>
    </li>
    <li>
      <p>Why must a generator target <code>netstandard2.0</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It runs inside the compiler process, which loads that version. Target anything else and the
        compiler <strong>silently declines to run it</strong> — no error, and a build that fails on
        the missing members.</p>
      </div></details>
    </li>
    <li>
      <p>What makes an incremental generator actually incremental?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>An <strong>equatable model</strong>. The compiler compares the transform's output with the
        previous run's; if they are equal, generation is skipped. A model containing a
        <code>Symbol</code>, a <code>SyntaxNode</code>, an array or an
        <code>ImmutableArray&lt;T&gt;</code> never compares equal.</p>
      </div></details>
    </li>
    <li>
      <p>What happens if you forget <code>partial</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Verified: <code>error CS0260: Missing partial modifier on declaration of type 'Invoice';
        another partial declaration of this type exists</code> — an ordinary C# error, because the
        generator succeeded and the compiler is compiling the union.</p>
      </div></details>
    </li>
    <li>
      <p>How do you see what a generator produced?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>&lt;EmitCompilerGeneratedFiles&gt;true&lt;/EmitCompilerGeneratedFiles&gt;</code>
        with a <code>&lt;CompilerGeneratedFilesOutputPath&gt;</code>. Exclude that folder from
        compilation or the files are compiled twice — verified: <code>CS0101</code>,
        <code>CS0579</code> and <code>CS0111</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What is a hint name and why does it matter?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The file name passed to <code>AddSource</code>. It must be unique across the
        <strong>whole compilation</strong>, so use the fully-qualified type name — two generators or
        two same-named classes colliding is a build failure.</p>
      </div></details>
    </li>
    <li>
      <p>Why does generated code use <code>global::</code> everywhere?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The generator does not know the consumer's namespaces. Without it, a consumer with a
        namespace called <code>System</code> gets code that does not compile — in their project, from
        your library.</p>
      </div></details>
    </li>
    <li>
      <p>What did the generated method cost against the reflective one?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>289 ns against 2,094 ns — 7.2×</strong> — and 496 bytes against 1,000, for
        identical output. Plus no cache, no boxing, and a trimmer that keeps the properties because
        the generated code names them.</p>
      </div></details>
    </li>
    <li>
      <p>Why does the trimmer keep members that generated code uses?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Because there is nothing special about generated code. Verified: the generated method's
        <code>DeclaringType</code> is the ordinary class and no metadata marks it. The trimmer sees a
        real static reference and follows it.</p>
      </div></details>
    </li>
    <li>
      <p>How do you test a generator?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>CSharpGeneratorDriver</code> over a string of source, asserting on the output —
        and running it twice to assert the steps report <code>Cached</code>. Debugging inside a
        compiler process is much worse.</p>
      </div></details>
    </li>
    <li>
      <p>When can a generator not replace reflection?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the types are not known at compile time — a plugin loader reading assemblies from
        configuration, a test runner, a debugger. <strong>A generator can only know what the compiler
        knows.</strong></p>
      </div></details>
    </li>
    <li>
      <p>Which framework generators should you use before writing your own?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>[JsonSerializable]</code>, <code>[LoggerMessage]</code>,
        <code>[GeneratedRegex]</code>, and the configuration binder. Each replaced a reflective
        implementation and is the recommended path for anything published trimmed or AOT.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
