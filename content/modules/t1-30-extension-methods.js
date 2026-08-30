CSPREP.module({
  id: "t1-30-extension-methods",
  minutes: 55,
  updated: "2026-08-30",
  summary: "An extension method is a static method the compiler lets you call with instance syntax, and every surprising thing about it follows from that: it works on null, it cannot see private state, it is resolved from the declared type rather than the runtime one, and it is invisible without the right using directive. C# 14 adds extension properties and static extension members, which the older 'this' syntax could never express.",
  terms: ["extension method", "this parameter", "ExtensionAttribute", "extension member",
    "extension block", "extension property", "static extension member", "shadowing",
    "using directive", "candidate set", "overload resolution", "static type",
    "CS1061", "CS0121", "CS1106", "CS1109"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger — the payments and invoicing service these modules keep returning to — needs a way to
  ask any collection of invoices which ones are outstanding. Any collection: a
  <code>List&lt;Invoice&gt;</code>, an array, the result of a database query, whatever the next
  version uses.</p>

  <p>Putting the method on <code>List&lt;Invoice&gt;</code> is impossible, because that type belongs
  to Microsoft. Putting it on an interface is impossible for the same reason — and even for
  interfaces you own, adding a member breaks every existing implementation. So the only conventional
  option is a static helper class, and the call site becomes
  <code>InvoiceQueries.Outstanding(InvoiceQueries.OverdueOn(invoices, today))</code> — read
  inside-out, in the reverse of the order the operations happen.</p>

  <p>That is the shape LINQ would have had. <code>Enumerable.Select(Enumerable.Where(orders,
  p), s)</code>, nested four deep for a real query.</p>

  <p><strong>Extension methods exist to make a static method read like an instance
  method</strong>, so those calls chain left to right in execution order. The cost of that
  convenience is a set of resolution rules that surprise people, and a maintenance hazard that has
  no diagnostic at all.</p>
</section>

<section id="what-it-is">
  <h2>What one actually is</h2>

  <p class="define"><span class="define__term">Extension method</span> A static method whose first
  parameter carries the <code>this</code> modifier. The compiler allows it to be called as though it
  were an instance method on that parameter's type, and rewrites the call into an ordinary static
  call.</p>

  <p class="define"><span class="define__term">this parameter</span> The first parameter, marked
  <code>this</code>. It becomes the receiver at the call site: <code>value.Method(arg)</code>
  compiles to <code>Class.Method(value, arg)</code>.</p>

  <p>The analogy: an extension method is a <strong>nickname</strong>. It lets you refer to something
  in a shorter, more natural way, and it changes nothing about the thing itself.
  <strong>The analogy holds unusually well</strong> — a nickname only works with people who know it
  (a <code>using</code> directive), two groups can have conflicting nicknames for the same person
  (an ambiguity error), and a nickname never grants you access the person has not already given
  you.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-what-they-are.cs"><code>// 01-what-they-are.cs — an extension method is a static method with syntactic
// sugar at the call site, and every surprising thing about them follows from
// that. Read out of metadata rather than asserted.
// .NET 10.0.400. Run: dotnet run 01-what-they-are.cs
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;

public static class StringExtensions
{
    /// &lt;summary&gt;The 'this' modifier on the first parameter is the whole feature.&lt;/summary&gt;
    public static string OrDefault(this string? value, string fallback)
        =&gt; string.IsNullOrWhiteSpace(value) ? fallback : value;

    public static int WordCount(this string value)
        =&gt; value.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- the two spellings are the same call ---");
        var s = "  ";
        Console.WriteLine($"  s.OrDefault(\"none\")                  : {s.OrDefault("none")}");
        Console.WriteLine($"  StringExtensions.OrDefault(s, \"none\") : {StringExtensions.OrDefault(s, "none")}");
        Console.WriteLine("  Identical. The compiler rewrites the first into the second.");

        Console.WriteLine();
        Console.WriteLine("--- it works on a NULL receiver ---");
        string? nothing = null;
        Console.WriteLine($"  nothing.OrDefault(\"fallback\") : {nothing.OrDefault("fallback")}");
        Console.WriteLine("  No NullReferenceException. There is no instance to dereference:");
        Console.WriteLine("  null is passed as an ordinary argument to a static method.");
        try
        {
            Console.WriteLine(nothing!.WordCount());
        }
        catch (NullReferenceException)
        {
            Console.WriteLine("  ...but WordCount() throws, because ITS BODY dereferences the");
            Console.WriteLine("  parameter. The extension is null-safe only if it is written to be.");
        }

        Console.WriteLine();
        Console.WriteLine("--- what the compiler emitted ---");
        var method = typeof(StringExtensions).GetMethod(nameof(StringExtensions.OrDefault))!;
        Console.WriteLine($"  IsStatic                        : {method.IsStatic}");
        Console.WriteLine($"  declaring type is static+sealed : " +
                          $"{typeof(StringExtensions).IsAbstract &amp;&amp; typeof(StringExtensions).IsSealed}");
        Console.WriteLine($"  has [Extension] attribute       : " +
                          $"{method.IsDefined(typeof(ExtensionAttribute), false)}");
        Console.WriteLine($"  first parameter                 : " +
                          $"{method.GetParameters()[0].ParameterType.Name} {method.GetParameters()[0].Name}");
        Console.WriteLine("  A static method, in a static class, marked [Extension]. That");
        Console.WriteLine("  attribute is the only thing telling the compiler it may be");
        Console.WriteLine("  called with instance syntax.");

        Console.WriteLine();
        Console.WriteLine("--- it cannot see private state ---");
        var account = new Account("ACC-1", 250m);
        Console.WriteLine($"  account.Describe() : {account.Describe()}");
        Console.WriteLine("  Describe() reads only the PUBLIC surface. An extension has");
        Console.WriteLine("  exactly the access an ordinary caller has — no more.");

        Console.WriteLine();
        Console.WriteLine("--- C# 14 extension members: properties and static members ---");
        Console.WriteLine($"  \"  \".IsBlank        : {"  ".IsBlank}");
        Console.WriteLine($"  \"text\".IsBlank      : {"text".IsBlank}");
        Console.WriteLine($"  new List&lt;int&gt;().IsEmpty : {new List&lt;int&gt;().IsEmpty}");
        Console.WriteLine($"  Money.Zero (static)     : {Money.Zero}");
        Console.WriteLine("  An 'extension(T x) { ... }' block can declare properties and");
        Console.WriteLine("  static members, which the old 'this' syntax never could.");
        Console.WriteLine("  New in C# 14 / .NET 10. On .NET 8 and 9 only extension METHODS");
        Console.WriteLine("  exist, and IsBlank would have to be IsBlank().");

        Console.WriteLine();
        Console.WriteLine("--- the old and new syntaxes coexist ---");
        var words = "the quick brown fox";
        Console.WriteLine($"  words.WordCount()  (old syntax) : {words.WordCount()}");
        Console.WriteLine($"  words.IsBlank      (new syntax) : {words.IsBlank}");
        Console.WriteLine("  Both compile to static methods on a static class. The new form");
        Console.WriteLine("  is a different way to declare them, not a different mechanism.");
    }
}

public sealed class Account
{
    private readonly decimal _balance;      // private: invisible to any extension
    public Account(string id, decimal balance) { Id = id; _balance = balance; }
    public string Id { get; }
    public decimal Balance =&gt; _balance;
}

public readonly record struct Money(decimal Amount, string Currency)
{
    public override string ToString() =&gt; $"{Amount:0.00} {Currency}";
}

public static class NewStyleExtensions
{
    extension(string s)
    {
        public bool IsBlank =&gt; string.IsNullOrWhiteSpace(s);
    }

    extension&lt;T&gt;(IEnumerable&lt;T&gt; source)
    {
        public bool IsEmpty =&gt; !source.Any();
    }

    extension(Money)
    {
        // A STATIC extension member: Money.Zero, on a type you do not own.
        public static Money Zero =&gt; new(0m, "GBP");
    }

    extension(Account account)
    {
        public string Describe() =&gt; $"{account.Id} holds {account.Balance:0.00}";
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- the two spellings are the same call ---
  s.OrDefault("none")                  : none
  StringExtensions.OrDefault(s, "none") : none
  Identical. The compiler rewrites the first into the second.

--- it works on a NULL receiver ---
  nothing.OrDefault("fallback") : fallback
  No NullReferenceException. There is no instance to dereference:
  null is passed as an ordinary argument to a static method.
  ...but WordCount() throws, because ITS BODY dereferences the
  parameter. The extension is null-safe only if it is written to be.

--- what the compiler emitted ---
  IsStatic                        : True
  declaring type is static+sealed : True
  has [Extension] attribute       : True
  first parameter                 : String value
  A static method, in a static class, marked [Extension]. That
  attribute is the only thing telling the compiler it may be
  called with instance syntax.

--- it cannot see private state ---
  account.Describe() : ACC-1 holds 250.00
  Describe() reads only the PUBLIC surface. An extension has
  exactly the access an ordinary caller has — no more.

--- C# 14 extension members: properties and static members ---
  "  ".IsBlank        : True
  "text".IsBlank      : False
  new List&lt;int&gt;().IsEmpty : True
  Money.Zero (static)     : 0.00 GBP
  An 'extension(T x) { ... }' block can declare properties and
  static members, which the old 'this' syntax never could.
  New in C# 14 / .NET 10. On .NET 8 and 9 only extension METHODS
  exist, and IsBlank would have to be IsBlank().

--- the old and new syntaxes coexist ---
  words.WordCount()  (old syntax) : 4
  words.IsBlank      (new syntax) : False
  Both compile to static methods on a static class. The new form
  is a different way to declare them, not a different mechanism.</code></pre>

  <p><strong>It works on a null receiver.</strong> <code>nothing.OrDefault("fallback")</code>
  returned <code>fallback</code> rather than throwing, because there is no instance to dereference —
  <code>null</code> was passed as an ordinary argument. That is the single most useful consequence of
  the rewrite, and it is also a trap: <code>WordCount()</code> on the same null <em>did</em> throw,
  because its body dereferences the parameter. <strong>An extension is null-safe only if it was
  written to be.</strong></p>

  <p class="define"><span class="define__term">ExtensionAttribute</span> The attribute the compiler
  stamps on the method and its containing class. It is what tells any compiler reading the assembly
  that instance-call syntax is permitted — verified above at
  <code>has [Extension] attribute : True</code>.</p>

  <p><strong>It cannot see private state.</strong> An extension has exactly the access an ordinary
  caller has, which means it can never be a substitute for a real method that needs the type's
  internals. It also means the extension is <em>coupled to the public surface</em>: make a property
  private and every extension reading it stops compiling.</p>
</section>

<section id="new-syntax">
  <h2>Extension members: what .NET 10 adds</h2>

  <p class="define"><span class="define__term">Extension block</span> The C# 14 form:
  <code>extension(SomeType x) { … }</code> inside a static class. Members declared in it become
  extensions on <code>SomeType</code>, and unlike the <code>this</code> syntax they may be
  <strong>properties</strong> and <strong>static members</strong>.</p>

  <pre data-lang="csharp" data-net="10" data-title="The two syntaxes side by side"><code>public static class Extensions
{
    // C# 3 through C# 13: methods only.
    public static bool IsBlankMethod(this string s) =&gt; string.IsNullOrWhiteSpace(s);

    // C# 14 / .NET 10: an extension block.
    extension(string s)
    {
        public bool IsBlank =&gt; string.IsNullOrWhiteSpace(s);   // a PROPERTY
        public string Collapsed =&gt; string.Join(" ", s.Split(' ',
            StringSplitOptions.RemoveEmptyEntries));
    }

    // Generic, with the type parameter on the block.
    extension&lt;T&gt;(IEnumerable&lt;T&gt; source)
    {
        public bool IsEmpty =&gt; !source.Any();
    }

    // No receiver name: STATIC members, on a type you do not own.
    extension(Money)
    {
        public static Money Zero =&gt; new(0m, "GBP");
        public static Money Parse(string text)
        {
            var parts = text.Split(&amp;#x27; &amp;#x27;);
            return new Money(decimal.Parse(parts[0], CultureInfo.InvariantCulture), parts[1]);
        }
    }
}</code></pre>

  <p>Verified above: <code>"  ".IsBlank</code> returned <code>True</code>,
  <code>new List&lt;int&gt;().IsEmpty</code> returned <code>True</code>, and
  <code>Money.Zero</code> — a static member on a type declared elsewhere — returned
  <code>0.00 GBP</code>.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>This is .NET 10 only.</strong> On .NET 8 and .NET 9 the <code>extension</code> block
    does not compile; only extension methods exist, and <code>IsBlank</code> would have to be
    <code>IsBlank()</code>. If a library targets multiple frameworks, the old syntax is the one that
    works everywhere — and the two produce the same static methods, so mixing them costs
    nothing.</p>
  </div>

  <p>The mechanism is unchanged. Both forms compile to static methods on a static class, and
  everything in the rest of this module — resolution order, the <code>using</code> requirement,
  shadowing — applies identically to both.</p>
</section>

<section id="resolution">
  <h2>How the compiler decides what you called</h2>

  <pre data-lang="csharp" data-net="10" data-title="02-resolution.cs"><code>// 02-resolution.cs — the rules that decide which method a call actually reaches.
// These are where extension methods stop being obvious, and where the
// maintenance problems come from.
// .NET 10.0.400. Run: dotnet run 02-resolution.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Linq;
using Alpha;                 // both namespaces define Describe(this Widget)
// using Beta;               // uncommenting this makes the call ambiguous: CS0121

namespace Domain
{
    public class Widget
    {
        public string Name { get; init; } = "";
        public string Describe() =&gt; $"[instance] {Name}";
    }

    public class Gadget
    {
        public string Name { get; init; } = "";
    }
}

namespace Alpha
{
    using Domain;

    public static class WidgetExtensions
    {
        public static string Describe(this Widget w) =&gt; $"[Alpha extension] {w.Name}";
        public static string Tag(this Widget w) =&gt; $"alpha:{w.Name}";
        public static string Tag(this Gadget g) =&gt; $"alpha:{g.Name}";
    }
}

namespace Beta
{
    using Domain;

    public static class WidgetExtensions
    {
        public static string Describe(this Widget w) =&gt; $"[Beta extension] {w.Name}";
    }
}

class Program
{
    static void Main()
    {
        var widget = new Domain.Widget { Name = "W-1" };
        var gadget = new Domain.Gadget { Name = "G-1" };

        Console.WriteLine("--- 1. an instance method ALWAYS wins ---");
        Console.WriteLine($"  widget.Describe() : {widget.Describe()}");
        Console.WriteLine("  Widget has an instance Describe(), so the Alpha extension is");
        Console.WriteLine("  never even considered. Extensions are searched only when no");
        Console.WriteLine("  applicable instance method exists.");
        Console.WriteLine($"  the extension, called explicitly : " +
                          $"{Alpha.WidgetExtensions.Describe(widget)}");

        Console.WriteLine();
        Console.WriteLine("--- and it wins even when it is a WORSE match ---");
        var box = new Box();
        Console.WriteLine($"  box.Store(42)     : {box.Store(42)}");
        Console.WriteLine("  Box.Store(object) is an instance method; Store(this Box, int)");
        Console.WriteLine("  is an extension that matches int exactly. The instance method");
        Console.WriteLine("  still wins — the two are not compared at all.");

        Console.WriteLine();
        Console.WriteLine("--- 2. extensions are only visible via a using directive ---");
        Console.WriteLine($"  gadget.Tag() : {gadget.Tag()}");
        Console.WriteLine("  'using Alpha;' at the top of this file is what makes Tag()");
        Console.WriteLine("  callable. Delete it and this is CS1061, 'Gadget does not");
        Console.WriteLine("  contain a definition for Tag'. The type says nothing about");
        Console.WriteLine("  which extensions exist; the FILE does.");

        Console.WriteLine();
        Console.WriteLine("--- 3. two namespaces, same signature, both imported = ambiguous ---");
        Console.WriteLine("  Adding 'using Beta;' makes widget-typed calls to Describe()");
        Console.WriteLine("  ambiguous where no instance method exists:");
        Console.WriteLine("    error CS0121: The call is ambiguous between the following");
        Console.WriteLine("    methods or properties: 'Alpha.WidgetExtensions.Describe(Widget)'");
        Console.WriteLine("    and 'Beta.WidgetExtensions.Describe(Widget)'");
        Console.WriteLine("  (see 04-compile-errors.cs.txt)");

        Console.WriteLine();
        Console.WriteLine("--- 4. the STATIC type decides, not the runtime type ---");
        Domain.Widget asWidget = new Special { Name = "S-1" };
        Special asSpecial = (Special)asWidget;
        Console.WriteLine($"  declared Widget  : {asWidget.Label()}");
        Console.WriteLine($"  declared Special : {asSpecial.Label()}");
        Console.WriteLine("  Same object, two answers. Extension resolution happens at");
        Console.WriteLine("  COMPILE time from the declared type — there is no virtual");
        Console.WriteLine("  dispatch, because there is no instance method to override.");

        Console.WriteLine();
        Console.WriteLine("--- 5. extending an interface reaches every implementation ---");
        IEnumerable&lt;int&gt; asSequence = new List&lt;int&gt; { 1, 2, 3 };
        int[] asArray = { 1, 2, 3 };
        Console.WriteLine($"  List&lt;int&gt;  via IEnumerable&lt;int&gt; : {asSequence.SecondOrDefault()}");
        Console.WriteLine($"  int[]      via IEnumerable&lt;int&gt; : {asArray.SecondOrDefault()}");
        Console.WriteLine("  This is why LINQ is extension methods: one implementation");
        Console.WriteLine("  covering every type that implements the interface, including");
        Console.WriteLine("  types written after LINQ shipped.");

        Console.WriteLine();
        Console.WriteLine("--- 6. a more specific extension wins over a less specific one ---");
        Console.WriteLine($"  int[]        .Kind() : {asArray.Kind()}");
        Console.WriteLine($"  List&lt;int&gt;    .Kind() : {new List&lt;int&gt;().Kind()}");
        Console.WriteLine($"  HashSet&lt;int&gt; .Kind() : {new HashSet&lt;int&gt;().Kind()}");
        Console.WriteLine("  Overload resolution runs normally once the candidate set is");
        Console.WriteLine("  built, so List&lt;T&gt; beats IEnumerable&lt;T&gt; for a List.");

        Console.WriteLine();
        Console.WriteLine("--- 7. it cannot access private members, so it cannot be a real method ---");
        var counter = new Counter();
        counter.Bump(); counter.Bump();
        Console.WriteLine($"  counter.Count      : {counter.Count}");
        Console.WriteLine($"  counter.Doubled()  : {counter.Doubled()}");
        Console.WriteLine("  Doubled() is an extension reading the public Count. If Count");
        Console.WriteLine("  were made private tomorrow, the extension stops compiling —");
        Console.WriteLine("  which is a real coupling that a method on the type would not");
        Console.WriteLine("  have had.");
    }
}

class Box
{
    public string Store(object value) =&gt; $"[instance, object] {value}";
}

class Special : Domain.Widget { }

class Counter
{
    public int Count { get; private set; }
    public void Bump() =&gt; Count++;
}

static class MoreExtensions
{
    public static string Store(this Box box, int value) =&gt; $"[extension, int] {value}";
    public static string Label(this Domain.Widget w) =&gt; $"[Widget] {w.Name}";
    public static string Label(this Special s) =&gt; $"[Special] {s.Name}";
    public static int SecondOrDefault(this IEnumerable&lt;int&gt; source) =&gt; source.Skip(1).FirstOrDefault();
    public static string Kind&lt;T&gt;(this IEnumerable&lt;T&gt; source) =&gt; "IEnumerable";
    public static string Kind&lt;T&gt;(this List&lt;T&gt; source) =&gt; "List";
    public static int Doubled(this Counter c) =&gt; c.Count * 2;
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. an instance method ALWAYS wins ---
  widget.Describe() : [instance] W-1
  Widget has an instance Describe(), so the Alpha extension is
  never even considered. Extensions are searched only when no
  applicable instance method exists.
  the extension, called explicitly : [Alpha extension] W-1

--- and it wins even when it is a WORSE match ---
  box.Store(42)     : [instance, object] 42
  Box.Store(object) is an instance method; Store(this Box, int)
  is an extension that matches int exactly. The instance method
  still wins — the two are not compared at all.

--- 2. extensions are only visible via a using directive ---
  gadget.Tag() : alpha:G-1
  'using Alpha;' at the top of this file is what makes Tag()
  callable. Delete it and this is CS1061, 'Gadget does not
  contain a definition for Tag'. The type says nothing about
  which extensions exist; the FILE does.

--- 3. two namespaces, same signature, both imported = ambiguous ---
  Adding 'using Beta;' makes widget-typed calls to Describe()
  ambiguous where no instance method exists:
    error CS0121: The call is ambiguous between the following
    methods or properties: 'Alpha.WidgetExtensions.Describe(Widget)'
    and 'Beta.WidgetExtensions.Describe(Widget)'
  (see 04-compile-errors.cs.txt)

--- 4. the STATIC type decides, not the runtime type ---
  declared Widget  : [Widget] S-1
  declared Special : [Special] S-1
  Same object, two answers. Extension resolution happens at
  COMPILE time from the declared type — there is no virtual
  dispatch, because there is no instance method to override.

--- 5. extending an interface reaches every implementation ---
  List&lt;int&gt;  via IEnumerable&lt;int&gt; : 2
  int[]      via IEnumerable&lt;int&gt; : 2
  This is why LINQ is extension methods: one implementation
  covering every type that implements the interface, including
  types written after LINQ shipped.

--- 6. a more specific extension wins over a less specific one ---
  int[]        .Kind() : IEnumerable
  List&lt;int&gt;    .Kind() : List
  HashSet&lt;int&gt; .Kind() : IEnumerable
  Overload resolution runs normally once the candidate set is
  built, so List&lt;T&gt; beats IEnumerable&lt;T&gt; for a List.

--- 7. it cannot access private members, so it cannot be a real method ---
  counter.Count      : 2
  counter.Doubled()  : 4
  Doubled() is an extension reading the public Count. If Count
  were made private tomorrow, the extension stops compiling —
  which is a real coupling that a method on the type would not
  have had.</code></pre>

  <p class="define"><span class="define__term">Overload resolution</span> The compiler&#x27;s process
  for choosing among methods with the same name: it builds a set of applicable candidates, then picks
  the one whose parameters best match the arguments. Extensions take part in this normally — the
  surprise is only in <em>which</em> candidates make it into the set.</p>

  <p class="define"><span class="define__term">Static type</span> The type a variable is
  <em>declared</em> as, which the compiler can see. Distinct from the runtime type, which is the type
  of the object the variable actually holds. Extension resolution uses the static type; virtual
  dispatch uses the runtime type.</p>

  <p class="define"><span class="define__term">Candidate set</span> The methods the compiler
  considers for a call. For <code>x.M(args)</code> it first builds the set from instance methods on
  <code>x</code>'s type and its bases. <strong>Only if that set produces no applicable
  method</strong> does it build a second set from extension methods, and only from static classes in
  namespaces the file has imported.</p>

  <p>Two rules follow, and both are surprising the first time.</p>

  <p><strong>An instance method wins even when it is a worse match.</strong> Measured:
  <code>Box.Store(object)</code> as an instance method beat <code>Store(this Box, int)</code> for the
  argument <code>42</code>, which the extension matched exactly. The two were never compared — the
  extension set is not built at all when an instance method is applicable.</p>

  <p><strong>Resolution uses the declared type, not the runtime type.</strong> Measured: one object
  gave <code>[Widget] S-1</code> through a <code>Widget</code>-typed variable and
  <code>[Special] S-1</code> through a <code>Special</code>-typed one. There is no virtual dispatch
  because there is no virtual method — the decision is made and burned in at compile time.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>Which extensions exist is a property of the file, not of the type.</strong>
    <code>gadget.Tag()</code> compiles only because <code>using Alpha;</code> is at the top of that
    file. Move the call to a file without it and the error is
    <code>CS1061: 'Gadget' does not contain a definition for 'Tag' … (are you missing a using
    directive or an assembly reference?)</code>. That parenthetical exists in the compiler's message
    because this is the confusion the feature reliably produces.</p>
  </div>

  <h3>The four compile errors</h3>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Error</th><th>Means</th></tr></thead>
    <tbody>
      <tr><td><code>CS1106</code></td>
          <td>Extension method must be defined in a non-generic static class.</td></tr>
      <tr><td><code>CS1109</code></td>
          <td>Extension methods must be defined in a top level static class — a nested one does not
          qualify.</td></tr>
      <tr><td><code>CS0121</code></td>
          <td>The call is ambiguous — two imported namespaces define the same extension.</td></tr>
      <tr><td><code>CS1061</code></td>
          <td>No such member and no accessible extension. Usually a missing
          <code>using</code>.</td></tr>
    </tbody>
  </table>
  </div>

  <p>All four were produced by an actual compiler run and are recorded in
  <code>verification/t1-30-extension-methods/04-compile-errors.cs.txt</code>. Worth knowing: the two
  declaration errors suppress the two call-site ones on a first build, because the compiler stops
  before binding calls.</p>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// 03-production.cs — extension methods that earn their place in Ledger, and the
// two shapes that do not. The distinction is testable, not stylistic.
// .NET 10.0.400. Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;

namespace Ledger.Invoicing;

public readonly record struct Money(decimal Amount, string Currency)
{
    public override string ToString() =&gt;
        Amount.ToString("N2", CultureInfo.InvariantCulture) + " " + Currency;
}

public sealed record Invoice(string Number, string CustomerId, Money Amount, DateOnly Issued,
                             DateOnly? SettledOn);

/// &lt;summary&gt;
/// GOOD: extends an interface we do not own, with an operation that belongs to
/// the caller's domain rather than to IEnumerable. One implementation covers
/// every sequence type, present and future.
/// &lt;/summary&gt;
public static class InvoiceQueries
{
    public static IEnumerable&lt;Invoice&gt; Outstanding(this IEnumerable&lt;Invoice&gt; invoices)
        =&gt; invoices.Where(i =&gt; i.SettledOn is null);

    public static IEnumerable&lt;Invoice&gt; OverdueOn(this IEnumerable&lt;Invoice&gt; invoices,
                                                DateOnly asOf, int termDays = 30)
        =&gt; invoices.Outstanding().Where(i =&gt; i.Issued.AddDays(termDays) &lt; asOf);

    public static Money TotalIn(this IEnumerable&lt;Invoice&gt; invoices, string currency)
    {
        ArgumentNullException.ThrowIfNull(invoices);
        var total = invoices.Where(i =&gt; i.Amount.Currency == currency).Sum(i =&gt; i.Amount.Amount);
        return new Money(total, currency);
    }
}

/// &lt;summary&gt;
/// GOOD: a C# 14 extension block adding a static factory and a property to a
/// type declared elsewhere. Neither was expressible with the 'this' syntax.
/// &lt;/summary&gt;
public static class MoneyExtensions
{
    extension(Money money)
    {
        public bool IsZero =&gt; money.Amount == 0m;
        public Money Negated =&gt; money with { Amount = -money.Amount };
    }

    extension(Money)
    {
        public static Money ZeroGbp =&gt; new(0m, "GBP");
        public static Money Parse(string text)
        {
            var parts = text.Split(' ');
            return new Money(decimal.Parse(parts[0], CultureInfo.InvariantCulture), parts[1]);
        }
    }
}

/// &lt;summary&gt;
/// BAD: this belongs on Invoice. It uses only the type's own data, the type is
/// ours to change, and putting it here means callers must find the right using.
/// &lt;/summary&gt;
public static class BadExtensions
{
    public static bool IsSettled(this Invoice invoice) =&gt; invoice.SettledOn is not null;
}

class Program
{
    static void Main()
    {
        var asOf = new DateOnly(2026, 8, 30);
        var invoices = new[]
        {
            new Invoice("INV-1", "CUST-1", new Money(1200m, "GBP"), new DateOnly(2026, 6, 1), null),
            new Invoice("INV-2", "CUST-1", new Money(300m, "GBP"), new DateOnly(2026, 8, 20), null),
            new Invoice("INV-3", "CUST-2", new Money(450m, "EUR"), new DateOnly(2026, 5, 1), null),
            new Invoice("INV-4", "CUST-2", new Money(90m, "GBP"), new DateOnly(2026, 7, 1),
                        new DateOnly(2026, 7, 15))
        };

        Console.WriteLine("--- extensions composing with LINQ, because they return sequences ---");
        var overdue = invoices.OverdueOn(asOf).OrderBy(i =&gt; i.Issued).ToList();
        foreach (var i in overdue)
            Console.WriteLine($"  {i.Number} {i.Amount} issued {i.Issued:yyyy-MM-dd}");
        Console.WriteLine($"  outstanding GBP total : {invoices.Outstanding().TotalIn("GBP")}");
        Console.WriteLine("  OverdueOn calls Outstanding, which is itself an extension.");
        Console.WriteLine("  They chain because each returns IEnumerable&lt;Invoice&gt; — the same");
        Console.WriteLine("  reason LINQ operators chain.");

        Console.WriteLine();
        Console.WriteLine("--- they work on any sequence, including one that does not exist yet ---");
        IEnumerable&lt;Invoice&gt; asQuery = invoices.Where(i =&gt; i.CustomerId == "CUST-1");
        var asList = invoices.ToList();
        var asHashSet = invoices.ToHashSet();
        Console.WriteLine($"  from a LINQ query : {asQuery.Outstanding().Count()}");
        Console.WriteLine($"  from a List       : {asList.Outstanding().Count()}");
        Console.WriteLine($"  from a HashSet    : {asHashSet.Outstanding().Count()}");
        Console.WriteLine("  One implementation. Adding a new collection type to the");
        Console.WriteLine("  codebase requires no change here.");

        Console.WriteLine();
        Console.WriteLine("--- C# 14 extension members on a type declared elsewhere ---");
        var amount = new Money(75m, "GBP");
        Console.WriteLine($"  amount             : {amount}");
        Console.WriteLine($"  amount.IsZero      : {amount.IsZero}");
        Console.WriteLine($"  amount.Negated     : {amount.Negated}");
        Console.WriteLine($"  Money.ZeroGbp      : {Money.ZeroGbp}");
        Console.WriteLine($"  Money.Parse(\"12.50 EUR\") : {Money.Parse("12.50 EUR")}");
        Console.WriteLine("  A static member and two properties, on a record we could have");
        Console.WriteLine("  edited — which is the case where this is a design choice rather");
        Console.WriteLine("  than the only option.");

        Console.WriteLine();
        Console.WriteLine("--- the shape that should NOT be an extension ---");
        Console.WriteLine($"  invoices[3].IsSettled() : {invoices[3].IsSettled()}");
        Console.WriteLine("  IsSettled reads only Invoice's own data, and Invoice is ours.");
        Console.WriteLine("  As an extension it is:");
        Console.WriteLine("    - invisible unless the caller imports Ledger.Invoicing");
        Console.WriteLine("    - absent from IntelliSense on Invoice in any other namespace");
        Console.WriteLine("    - unable to be virtual, overridden, or part of an interface");
        Console.WriteLine("    - silently shadowed the day someone adds Invoice.IsSettled()");
        Console.WriteLine("  As a property on the record it is one line and none of that.");

        Console.WriteLine();
        Console.WriteLine("--- shadowing, demonstrated ---");
        var shadowed = new Shadowed();
        Console.WriteLine($"  before an instance method existed : {ShadowDemo.Label(shadowed)}");
        Console.WriteLine($"  now that one does                 : {shadowed.Label()}");
        Console.WriteLine("  Adding Label() to the class silently changed every call site.");
        Console.WriteLine("  No error, no warning, and the extension is still compiled in.");

        Console.WriteLine();
        Console.WriteLine("--- cost: is an extension call slower than an instance call? ---");
        var settled = invoices[3];
        var viaExtension = Time(() =&gt; { _sink += settled.IsSettled() ? 1 : 0; });
        var viaProperty = Time(() =&gt; { _sink += settled.SettledOn is not null ? 1 : 0; });
        Console.WriteLine($"  extension method : {viaExtension:0.00} ns/op");
        Console.WriteLine($"  direct property  : {viaProperty:0.00} ns/op");
        Console.WriteLine("  A couple of nanoseconds, and both are dominated by the");
        Console.WriteLine("  delegate call this harness uses to measure them. There is no");
        Console.WriteLine("  DISPATCH cost — an extension is a static call, so there is no");
        Console.WriteLine("  virtual lookup — but it is a call, and the extra argument and");
        Console.WriteLine("  the extra frame are not literally free.");
        Console.WriteLine("  Nothing here is a reason to choose one over the other.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static long _sink;

    static double Time(Action a)
    {
        for (var i = 0; i &lt; 10_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 1_000_000; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / 1_000_000;   // ms -&gt; ns/op
    }
}

public class Shadowed
{
    // Added in a later release. Every extension call site silently moved here.
    public string Label() =&gt; "[instance]";
}

public static class ShadowDemo
{
    public static string Label(this Shadowed s) =&gt; "[extension]";
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- extensions composing with LINQ, because they return sequences ---
  INV-3 450.00 EUR issued 2026-05-01
  INV-1 1,200.00 GBP issued 2026-06-01
  outstanding GBP total : 1,500.00 GBP
  OverdueOn calls Outstanding, which is itself an extension.
  They chain because each returns IEnumerable&lt;Invoice&gt; — the same
  reason LINQ operators chain.

--- they work on any sequence, including one that does not exist yet ---
  from a LINQ query : 2
  from a List       : 3
  from a HashSet    : 3
  One implementation. Adding a new collection type to the
  codebase requires no change here.

--- C# 14 extension members on a type declared elsewhere ---
  amount             : 75.00 GBP
  amount.IsZero      : False
  amount.Negated     : -75.00 GBP
  Money.ZeroGbp      : 0.00 GBP
  Money.Parse("12.50 EUR") : 12.50 EUR
  A static member and two properties, on a record we could have
  edited — which is the case where this is a design choice rather
  than the only option.

--- the shape that should NOT be an extension ---
  invoices[3].IsSettled() : True
  IsSettled reads only Invoice's own data, and Invoice is ours.
  As an extension it is:
    - invisible unless the caller imports Ledger.Invoicing
    - absent from IntelliSense on Invoice in any other namespace
    - unable to be virtual, overridden, or part of an interface
    - silently shadowed the day someone adds Invoice.IsSettled()
  As a property on the record it is one line and none of that.

--- shadowing, demonstrated ---
  before an instance method existed : [extension]
  now that one does                 : [instance]
  Adding Label() to the class silently changed every call site.
  No error, no warning, and the extension is still compiled in.

--- cost: is an extension call slower than an instance call? ---
  extension method : 9.56 ns/op
  direct property  : 7.06 ns/op
  A couple of nanoseconds, and both are dominated by the
  delegate call this harness uses to measure them. There is no
  DISPATCH cost — an extension is a static call, so there is no
  virtual lookup — but it is a call, and the extra argument and
  the extra frame are not literally free.
  Nothing here is a reason to choose one over the other.</code></pre>

  <p><strong>The good case and the bad case are in the same file, and the difference is
  testable.</strong> <code>Outstanding()</code> extends <code>IEnumerable&lt;Invoice&gt;</code>, a
  type nobody in this codebase can change, and one implementation served a LINQ query, a
  <code>List</code> and a <code>HashSet</code>. <code>IsSettled()</code> extends
  <code>Invoice</code>, which is declared four lines above it.</p>

  <p class="define"><span class="define__term">using directive</span> A <code>using Namespace;</code>
  line. For extensions it does more than shorten type names: it is the <em>only</em> thing that makes
  an extension callable with instance syntax, and it applies per file.</p>

  <p class="define"><span class="define__term">Shadowing</span> An instance method added later to a
  type, with a signature matching an existing extension, silently taking over every call site.
  Measured: the same <code>shadowed.Label()</code> expression printed <code>[extension]</code>
  before and <code>[instance]</code> after — with no error, no warning, and the extension still
  compiled into the assembly.</p>

  <p>Shadowing is why "is this type mine?" is the whole decision. If you own the type, adding a
  member is available to you and is strictly better. If you do not, someone else can add one at any
  time — and when they do, your call sites change meaning on the next package upgrade.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>The cost is not a factor.</strong> Measured at 9.56 ns against 7.06 ns for a direct
    property read, and both figures are dominated by the delegate the benchmark harness uses. An
    extension is a static call, so there is no virtual lookup; there is a call and an extra argument,
    and neither is literally free. Nothing in those numbers should influence a design decision.</p>
  </div>
</section>

<section id="in-the-wild">
  <h2>Where the framework uses them, and why</h2>

  <p>Extension methods are not a niche feature. Three of the most-used APIs in .NET are built
  entirely from them, and each one is a different reason to reach for the mechanism.</p>

  <h3>LINQ: one implementation for every sequence</h3>

  <p>Every operator in <a href="#/m/t1-24-linq-fundamentals">LINQ: Both Syntaxes</a> —
  <code>Where</code>, <code>Select</code>, <code>OrderBy</code>, all fifty of them — is an extension
  on <code>IEnumerable&lt;T&gt;</code> in <code>System.Linq.Enumerable</code>. That is why
  <code>using System.Linq;</code> is the line that makes queries compile, and why forgetting it
  produces <code>CS1061</code> rather than a missing-type error.</p>

  <p>The alternative would have been adding fifty members to <code>IEnumerable&lt;T&gt;</code>, which
  would have broken every implementation of it ever written. <strong>Extensions were the only way to
  add LINQ to a nine-year-old interface without a breaking change</strong>, and the measurement
  earlier in this module shows the payoff: one implementation served a query, a
  <code>List</code>, an array and a <code>HashSet</code>.</p>

  <h3>ASP.NET Core: a registration surface that packages can extend</h3>

  <pre data-lang="csharp" data-net="10" data-title="Program.cs — every call here is an extension method"><code>var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();                      // Microsoft.Extensions.DependencyInjection
builder.Services.AddDbContext&lt;LedgerDbContext&gt;(o =&gt;     // Microsoft.EntityFrameworkCore
    o.UseNpgsql(builder.Configuration.GetConnectionString("Ledger")));
builder.Services.AddHttpClient&lt;IPaymentGateway, StripeGateway&gt;();

var app = builder.Build();
app.UseHttpsRedirection();                              // Microsoft.AspNetCore.Builder
app.UseAuthorization();
app.MapControllers();
app.Run();</code></pre>

  <p><code>IServiceCollection</code> declares one member — it is a
  <code>IList&lt;ServiceDescriptor&gt;</code>. Everything above is an extension method contributed by
  a different package. <strong>That is the pattern: a tiny interface plus extensions, so any package
  can add configuration verbs without the interface ever changing.</strong></p>

  <p>It is also why the compiler's advice about a missing <code>using</code> matters so much here.
  <code>AddDbContext</code> not compiling almost always means the package is referenced but
  <code>Microsoft.EntityFrameworkCore</code> is not imported — the type exists, the method does
  not.</p>

  <h3>Task and ConfigureAwait: adding to a sealed framework type</h3>

  <p><code>ConfigureAwait</code> is an instance method, but the surrounding ecosystem —
  <code>WithCancellation</code>, <code>AsTask</code> on <code>ValueTask</code>, the whole of
  <code>TaskAsyncEnumerableExtensions</code> — is extensions. The type is sealed and Microsoft's, so
  there was no other option.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>Notice what all three have in common: the receiver's type could not be changed by the
    person adding the method.</strong> LINQ could not change <code>IEnumerable&lt;T&gt;</code>; EF
    Core cannot change <code>IServiceCollection</code>; nobody outside Microsoft can change
    <code>Task</code>. That is the test from the previous section, applied by the people who designed
    the feature.</p>
  </div>

  <h3>What none of them do</h3>

  <p>None of these extend a type the same team owns. <code>Enumerable</code> does not extend
  <code>List&lt;T&gt;</code>; it extends the interface. EF Core does not extend
  <code>DbContext</code> with extension methods — <code>DbContext</code> has real virtual members,
  because EF Core owns it.</p>

  <p>That is a stronger signal than any style guide: <strong>the framework teams use extensions
  exactly where they cannot use a member, and members everywhere else.</strong></p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Extending a type you own</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a member in the wrong place"><code>// WRONG. Invoice is declared in this solution and reads only its own data.
public static class InvoiceExtensions
{
    public static bool IsSettled(this Invoice invoice) =&gt; invoice.SettledOn is not null;
}

// Right: it is a property on the type, visible everywhere, with no using needed.
public sealed record Invoice(string Number, Money Amount, DateOnly? SettledOn)
{
    public bool IsSettled =&gt; SettledOn is not null;
}</code></pre>

  <h3>2. Assuming an extension is null-safe</h3>

  <p>Measured: <code>OrDefault</code> handled a null receiver and <code>WordCount</code> threw
  <code>NullReferenceException</code> on the same value. The call syntax gives no indication which
  kind you are calling.</p>

  <h3>3. Expecting virtual behaviour</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: this is not polymorphism"><code>// WRONG. Measured: the same object gave [extension: Base] through a Base-typed
// variable and [extension: Derived] through a Derived-typed one, while a real
// virtual method gave [virtual: Derived] for both.
public static string Name(this Base b) =&gt; "[Base]";
public static string Name(this Derived d) =&gt; "[Derived]";

// Right: if behaviour must vary by runtime type, it needs a virtual member.
public class Base { public virtual string Name() =&gt; "[Base]"; }
public class Derived : Base { public override string Name() =&gt; "[Derived]"; }</code></pre>

  <h3>4. An extension in a globally-imported namespace</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: claims a name on every string in the codebase"><code>// WRONG. In a namespace reached by a global using, this appears on every
// string everywhere — and the day the base library adds string.IsEmpty, all
// 340 call sites move to it with no error and no warning.
namespace Ledger.Common;

public static class StringHelpers
{
    public static bool IsEmpty(this string? s) =&gt; string.IsNullOrWhiteSpace(s);
}

// Right: a name the owner will not take, in a namespace callers opt into.
namespace Ledger.Text;

public static class StringHelpers
{
    public static bool IsBlank(this string? s) =&gt; string.IsNullOrWhiteSpace(s);
}</code></pre>

  <h3>5. Two libraries with the same extension</h3>

  <p><code>CS0121</code>, and there is no good fix at the call site — you either drop a
  <code>using</code>, add an alias, or call one of them by its full static name. Namespacing
  extensions narrowly (<code>Ledger.Invoicing.Queries</code>, not <code>Ledger</code>) reduces the
  chance that a caller imports both.</p>

  <h3>6. A "helpers" namespace imported everywhere</h3>

  <p>Extensions on <code>object</code>, <code>string</code> or <code>IEnumerable&lt;T&gt;</code> in a
  globally-imported namespace appear on every value in the codebase. IntelliSense on
  <code>string</code> becomes unusable, and every future name collision with the base library is
  yours to resolve.</p>

  <h3>7. Extension methods that mutate</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: silently discards the result"><code>// WRONG for a struct. The receiver is passed BY VALUE, so this mutates a copy.
public static void Zero(this Money money) =&gt; money = money with { Amount = 0m };

// Right: return the new value, the way the framework's own struct helpers do.
public static Money Zeroed(this Money money) =&gt; money with { Amount = 0m };</code></pre>

  <p>For a struct receiver the compiler will not even let you write <code>this ref</code> unless the
  method is in a static class and the parameter is <code>ref</code> — and at that point the call site
  no longer accepts a temporary. Returning a new value is nearly always the right design.</p>

  <h3>8. Using an extension to fake an interface</h3>

  <p>An extension cannot be part of an interface, cannot be overridden, and cannot be mocked. Code
  that depends on one is depending on a static call it cannot substitute in a test.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong><code>CS1061: 'X' does not contain a definition for 'Y'</code> when you can see the
    method.</strong> Read the rest of that message — it names a missing <code>using</code> as a
    candidate cause. Find the static class declaring the extension and check its namespace against
    the <code>using</code> block of the failing file. In an IDE, "Add using" on the red squiggle
    finds it directly.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A call started behaving differently after a package upgrade.</strong> Suspect
    shadowing: the library added an instance method matching your extension. Go to Definition on the
    call — if it lands on the library's type rather than your static class, that is the answer.
    Measured behaviour: the change is silent, with no warning of any kind.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Working out which method a call reaches.</strong> Rewrite it temporarily in static
    form — <code>MyExtensions.Method(value, arg)</code>. If that compiles and behaves differently
    from <code>value.Method(arg)</code>, an instance method is winning. This is a two-second check
    and it is definitive.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong><code>CS0121</code>, ambiguous between two extensions.</strong> Three fixes, in order
    of preference: drop the <code>using</code> you do not need; move the call to a file that imports
    only one; or call the one you want by its full static name. An <code>extern alias</code> works
    but is heavy for this.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A <code>NullReferenceException</code> from inside an extension.</strong> The receiver
    was null and the body dereferenced it. Note that the caller's null check may have been skipped
    <em>because</em> the call looked like an instance call and appeared safe — a
    <code>?.</code> on an extension call does not help, since the null never reaches a dereference at
    the call site.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Auditing whether an extension should exist.</strong> One question: <em>can I edit the
    receiver's type?</em> If yes, the member belongs on the type — the exceptions are vanishingly
    rare. If no, an extension is correct and the remaining question is only which namespace to put
    it in.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A concrete case.</strong> Ledger had a shared utilities package with an extension
    <code>public static bool IsEmpty(this string? s)</code> — true for null, empty, or whitespace.
    It was imported through a global using and was called in roughly 340 places across eleven
    services.</p>
    <p>A framework upgrade brought a new base-library method with the same name and shape on the same
    type. Every one of those 340 call sites silently moved from the utility to the new method — and
    the two disagreed on exactly one input: a string of spaces. The utility returned
    <code>true</code>; the new method returned <code>false</code>.</p>
    <p>Nothing failed to compile. No warning was produced. Measured behaviour in this module's
    verification code confirms why: adding an instance method that matches an extension changes every
    call site with <strong>no error, no warning, and the extension still compiled into the
    assembly</strong>.</p>
    <p>The consequence surfaced in the customer-onboarding service, where
    <code>if (address.Line2.IsEmpty()) …</code> decided whether to include a line in a printed
    remittance advice. Roughly <strong>2% of records</strong> had a whitespace-only second line, and
    those began printing a blank line — which pushed the address block down and, on the
    window-envelope layout, moved the postcode out of the window. About <strong>4,000 letters</strong>
    were returned undelivered over three weeks before anyone connected the two.</p>
    <p>The fix took ten minutes: rename the extension to <code>IsBlank</code>. Finding it took nine
    days, because the search space was "something changed in the framework upgrade" and the symptom
    was in the post room.</p>
  </div>

  <p>The general principle: <strong>an extension method is a claim on a name in a type you do not
  control, and the owner of that type can take the name back at any time without telling
  you.</strong> The language provides no mechanism to detect it — not an error, not a warning, not
  an analyser rule — because from the compiler's point of view nothing went wrong.</p>

  <p>That is not an argument against extension methods; LINQ is the best-loved API in .NET and it is
  entirely built from them. It is an argument about <em>where</em> the risk sits. Two things reduce
  it to near zero:</p>

  <p><strong>Pick names the type's owner would not.</strong> <code>Outstanding()</code> on
  <code>IEnumerable&lt;Invoice&gt;</code> is safe because Microsoft will never add it.
  <code>IsEmpty()</code> on <code>string</code> was not.</p>

  <p><strong>Do not extend types you own.</strong> The member belongs on the type, where it is
  visible without a <code>using</code>, can be virtual, can be part of an interface, and cannot be
  shadowed by anyone.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Extension methods add members to a type."</strong> They add nothing. The type is
    unchanged; the compiler rewrites the call site. Verified:
    <code>s.OrDefault(x)</code> and <code>StringExtensions.OrDefault(s, x)</code> produced identical
    results because they are the same call.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Calling one on null throws."</strong> Measured: it returned normally. There is no
    instance to dereference — null is an ordinary argument. Whether it throws depends entirely on
    what the body does.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The compiler picks the best match between instance and extension methods."</strong>
    It does not compare them. Measured: an instance <code>Store(object)</code> beat an extension
    <code>Store(int)</code> for an <code>int</code> argument, because the extension set is never
    built when an instance method is applicable.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Extensions can be polymorphic."</strong> Measured: the same object gave two different
    answers through two differently-typed variables, while a real virtual method gave the same answer
    for both. Resolution is by declared type, at compile time.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"An extension can access private state if it is in the same assembly."</strong> It
    cannot. It has exactly the access an ordinary caller in that position has — verified, it read
    only the public surface.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Extension calls are slower."</strong> Measured at 9.56 ns against 7.06 ns for a
    direct property read, both dominated by the harness. There is no virtual dispatch, because there
    is nothing to dispatch on.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Extension properties are new behaviour."</strong> They are new <em>syntax</em>. An
    <code>extension</code> block compiles to the same static methods with the same
    <code>[Extension]</code> marking; C# 14 lets you declare shapes the <code>this</code> parameter
    could not express.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>You can edit the receiver's type</td><td>Put the member on the type</td>
          <td>Visible without a <code>using</code>, can be virtual, cannot be shadowed.</td></tr>
      <tr><td>The type belongs to the framework or a package</td><td>An extension</td>
          <td>The only option, and the one LINQ is built from.</td></tr>
      <tr><td>The operation applies to an interface</td><td>An extension on the interface</td>
          <td>One implementation covers every implementer, including future ones.</td></tr>
      <tr><td>The operation must vary by runtime type</td><td>A virtual method</td>
          <td>Extensions resolve from the declared type — measured, two answers for one
          object.</td></tr>
      <tr><td>You need a property or a static member on someone else's type</td>
          <td>A C# 14 <code>extension</code> block</td>
          <td>The <code>this</code> syntax cannot express either. .NET 10 only.</td></tr>
      <tr><td>The library multi-targets .NET 8 or 9</td><td>The <code>this</code> syntax</td>
          <td><code>extension</code> blocks do not compile there.</td></tr>
      <tr><td>Naming an extension on a common framework type</td><td>Pick a name the owner would
          not</td><td><code>IsBlank</code>, not <code>IsEmpty</code>. Shadowing is silent.</td></tr>
      <tr><td>Choosing a namespace</td><td>Narrow and specific</td>
          <td>Reduces the chance a caller imports two conflicting sets — <code>CS0121</code> has no
          good call-site fix.</td></tr>
      <tr><td>The receiver may be null</td><td>Handle it in the body, and say so in the
          name</td><td>The call site cannot tell; only the body decides.</td></tr>
      <tr><td>The code must be substitutable in a test</td><td>An interface, not an extension</td>
          <td>A static call cannot be mocked.</td></tr>
      <tr><td>The receiver is a struct you want to change</td><td>Return a new value</td>
          <td>The receiver is passed by value; mutating it mutates a copy.</td></tr>
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
    <p>Given a class with instance methods <code>Show()</code> and <code>Show(int)</code>, and
    extensions <code>Show(this Thing)</code> and <code>Show(this Thing, string)</code>, say what each
    call produces. Then say what happens for a null receiver.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>thing.Show()        : [instance, no args]
thing.Show(1)       : [instance, int 1]
ThingExt.Show(a)    : [extension, no args]
null.SafeLength()   : 0
null.UnsafeLength() : NullReferenceException from the BODY</code></pre>
        <p><strong>The instance methods win both calls.</strong> The extension
        <code>Show(this Thing)</code> is never considered for <code>thing.Show()</code>, because the
        compiler found an applicable instance method and stopped. Calling it explicitly as
        <code>ThingExt.Show(a)</code> still works — the method exists; it is only unreachable
        through instance syntax.</p>
        <p>Note what this means for <code>Show(this Thing, string)</code>: it is reachable, because
        no instance overload takes a <code>string</code>. <strong>The rule is per-call, not
        per-name</strong> — an instance method blocks only the calls it is applicable to.</p>
        <p><strong>The null receiver is the interesting half.</strong>
        <code>SafeLength()</code> returned <code>0</code>: there was no dereference at the call site,
        because the call compiles to <code>Extensions.SafeLength(null)</code> and the body uses
        <code>?.</code>. <code>UnsafeLength()</code> threw, because its body writes
        <code>s.Length</code>.</p>
        <p>The practical consequence: <strong>a reader cannot tell from the call site which one they
        are looking at</strong>. <code>value.Foo()</code> is safe or unsafe depending on code in
        another file. That is an argument for putting the guarantee in the name —
        <code>SafeLength</code>, <code>OrDefault</code>, <code>IsBlank</code> — whenever an extension
        deliberately handles null.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>One object, two variables of different declared types, one extension per type and one virtual
    method. Predict all four results and explain the difference.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>Base asBase = new Derived();
Derived asDerived = (Derived)asBase;

asBase.Name();      // extension on Base, extension on Derived
asDerived.Name();
asBase.Virtual();   // a real virtual method
asDerived.Virtual();</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>declared Base    : [extension: Base]
declared Derived : [extension: Derived]
same object      : True
runtime type     : Derived
Compare a VIRTUAL method on the same objects:
  declared Base    : [virtual: Derived]
  declared Derived : [virtual: Derived]</code></pre>
        <p><strong>The extension gives two answers; the virtual method gives one.</strong> Same
        object — <code>ReferenceEquals</code> is <code>True</code> and the runtime type is
        <code>Derived</code> in both cases.</p>
        <p><strong>Why.</strong> Extension resolution is <em>compile-time overload resolution</em>.
        The compiler sees a variable declared <code>Base</code>, finds
        <code>Name(this Base)</code> applicable, and emits a direct call to it. That call is burned
        into the IL; the runtime never reconsiders. Virtual dispatch is the opposite: the compiler
        emits <code>callvirt</code> and the runtime picks the override from the object's actual
        type.</p>
        <p><strong>Why it matters.</strong> This is the failure mode when someone reaches for
        extension methods to add "polymorphic" behaviour to a hierarchy they do not own. It works in
        the test — where variables are usually declared with the concrete type — and behaves
        differently in production, where the same objects flow through a
        <code>List&lt;Base&gt;</code> or an <code>IEnumerable&lt;Base&gt;</code> and every element is
        statically <code>Base</code>.</p>
        <p><strong>What to do instead.</strong> If the hierarchy is yours, use a virtual method. If it
        is not, a <code>switch</code> on the runtime type — which
        <a href="#/m/t1-27-pattern-matching">Pattern Matching</a> covers — is honest about what is
        happening, and the compiler will tell you when an arm is unreachable. An extension per
        subtype looks like polymorphism and is not.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Write an extension that sums a projected value over a sequence, tolerating both a null
    sequence and null elements. Say why each part of the signature is as it is.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="The extension"><code>public static decimal SumOf&lt;T&gt;(this IEnumerable&lt;T?&gt;? source, Func&lt;T, decimal&gt; selector)
    where T : class
    =&gt; source is null ? 0m : source.OfType&lt;T&gt;().Sum(selector);</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>total of non-null : 420
on a null list    : 0
on an empty list  : 0</code></pre>
        <p><strong><code>this IEnumerable&lt;T?&gt;? source</code> — two question marks, two
        different meanings.</strong> The inner one says the <em>elements</em> may be null; the outer
        one says the <em>sequence</em> may be null. Both are needed, and getting one wrong produces a
        warning at a call site rather than here.</p>
        <p><strong><code>source is null ? 0m : …</code> is what makes the null receiver safe.</strong>
        The call itself never dereferences — that is the extension rewrite — but
        <code>.OfType&lt;T&gt;()</code> would. Handling it explicitly is the only thing that makes
        the method live up to what the call site implies.</p>
        <p><strong><code>OfType&lt;T&gt;()</code> rather than
        <code>Where(x =&gt; x is not null)</code>.</strong> The <code>Where</code> version leaves the
        element type <code>T?</code> and the compiler still warns inside <code>Sum</code> —
        the point measured in
        <a href="#/m/t1-28-nullable-reference-types">Nullable Reference Types</a>.
        <code>OfType&lt;T&gt;()</code> returns <code>IEnumerable&lt;T&gt;</code> and both problems go
        away.</p>
        <p><strong><code>where T : class</code>.</strong> Without it, <code>T?</code> on an
        unconstrained parameter means something different for value types, and
        <code>OfType&lt;T&gt;()</code> would filter nothing. The constraint makes the signature say
        what it means.</p>
        <p><strong>Should this exist at all?</strong> It extends
        <code>IEnumerable&lt;T&gt;</code>, which is not ours, so the mechanism is right. The name is
        the risk: <code>SumOf</code> is close enough to something the base library might one day add
        that a narrow namespace is worth the effort.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>For each of these four, decide whether it should be an extension, and justify it. Then
    demonstrate the failure mode of the wrong choice.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>// (a) bool IsLarge(this Invoice invoice)          — Invoice is declared in this solution
// (b) IEnumerable&lt;Invoice&gt; WithAmountOver(this IEnumerable&lt;Invoice&gt;, decimal)
// (c) string Collapse(this string s)               — collapses runs of whitespace
// (d) extension(Invoice) { public static Invoice Empty =&gt; …; }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>(a) invoice.IsLarge()          : True
(b) invoices.WithAmountOver(200): 1
(c) "  x ".Collapse()          : 'x'
(d) Invoice.Empty (C# 14 static): Invoice { Number = , Amount = 0 }

(a) NO  — Invoice is ours; make it a property.
(b) YES — extends IEnumerable&lt;T&gt;, which we do not own.
(c) YES — extends string, which we cannot change.
(d) MAYBE — a static factory on our own type is better as a
    real static member; the extension form exists for types
    we do not own.

and the shadowing risk for (a), demonstrated:
  before Invoice had IsLarge()  : True
  a version where it does       : False
  Same call syntax, different method, no diagnostic.</code></pre>
        <p><strong>(a) No.</strong> <code>Invoice</code> is declared in this solution, and
        <code>IsLarge</code> reads only its own data. As a property on the record it is one line,
        available everywhere without a <code>using</code>, and cannot be shadowed. As an extension it
        is none of those things.</p>
        <p>The demonstration is the argument: the extension returned <code>True</code> for a 500
        invoice (its threshold was 100). A later version of the record with its own
        <code>IsLarge()</code> — threshold 1000 — returned <code>False</code> for the same data,
        through <strong>identical call syntax and with no diagnostic</strong>. Nobody reviewing
        either change would see the interaction.</p>
        <p><strong>(b) Yes.</strong> <code>IEnumerable&lt;T&gt;</code> cannot be modified, the
        operation is domain-specific rather than general, and returning
        <code>IEnumerable&lt;Invoice&gt;</code> lets it chain with LINQ and with other extensions.
        This is exactly the shape LINQ itself uses.</p>
        <p><strong>(c) Yes, with care about the name.</strong> <code>string</code> is sealed and
        Microsoft's. The risk is not the mechanism but the namespace: an extension on
        <code>string</code> in a widely-imported namespace appears on every string in the codebase,
        and <code>Collapse</code> is generic enough that a future base-library method could take the
        name. Put it in something narrow.</p>
        <p><strong>(d) Probably not, as written.</strong> <code>Invoice.Empty</code> as a C# 14 static
        extension member works — the output proves it — but <code>Invoice</code> is ours, so a real
        <code>public static Invoice Empty { get; }</code> on the record is simpler and always
        visible. The static extension form earns its place on types you cannot edit:
        <code>Money.Zero</code> where <code>Money</code> comes from a package, or a
        <code>TimeSpan.OneBusinessDay</code>.</p>
        <p><strong>The rule that decides all four in one question:</strong> <em>can I edit the
        receiver's type?</em> If yes, put the member on it. If no, an extension is correct and the
        remaining work is choosing a name and a namespace that will not collide.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is an extension method, mechanically?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A static method in a static class, with <code>this</code> on its first parameter, marked
        <code>[Extension]</code>. Verified in metadata. The compiler rewrites
        <code>x.M(a)</code> into <code>C.M(x, a)</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What happens when the receiver is null?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Nothing, at the call site — null is passed as an ordinary argument. Measured: one
        extension returned a fallback, another threw <code>NullReferenceException</code> from its
        <strong>body</strong>. The call syntax cannot tell you which.</p>
      </div></details>
    </li>
    <li>
      <p>Instance method or extension — which wins?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The instance method, <strong>always</strong>, even when it is a worse match. Measured: an
        instance <code>Store(object)</code> beat an extension <code>Store(int)</code> for an
        <code>int</code>. The extension set is not built when an instance method is applicable.</p>
      </div></details>
    </li>
    <li>
      <p>What makes an extension visible?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <code>using</code> directive for its namespace, in the <strong>calling file</strong>.
        Without one it is <code>CS1061</code> — whose message explicitly names a missing
        <code>using</code> as a candidate cause.</p>
      </div></details>
    </li>
    <li>
      <p>Is extension resolution polymorphic?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. It uses the <strong>declared</strong> type at compile time. Measured: one object gave
        <code>[extension: Base]</code> and <code>[extension: Derived]</code> through two variables,
        while a virtual method gave <code>[virtual: Derived]</code> for both.</p>
      </div></details>
    </li>
    <li>
      <p>Can an extension see private state?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — it has exactly the access an ordinary caller has. Which also means making a member
        private breaks every extension that read it.</p>
      </div></details>
    </li>
    <li>
      <p>What is shadowing and how do you detect it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A later instance method with a matching signature silently taking over every call site.
        Measured: <code>[extension]</code> became <code>[instance]</code> with no error and no
        warning. There is no automatic detection — Go to Definition on the call is the check.</p>
      </div></details>
    </li>
    <li>
      <p>What do C# 14 extension blocks add?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Properties and static members</strong> on types you do not own —
        <code>"  ".IsBlank</code> and <code>Money.Zero</code>, both verified. Same mechanism
        underneath; .NET 10 only.</p>
      </div></details>
    </li>
    <li>
      <p>When should you <em>not</em> write an extension?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When you can edit the receiver's type. The member belongs on the type: visible without a
        <code>using</code>, can be virtual, can be part of an interface, cannot be shadowed.</p>
      </div></details>
    </li>
    <li>
      <p>Why is naming an extension on <code>string</code> or <code>object</code> risky?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The owner can add a member with that name at any time and silently take over every call
        site. Pick a name they would not — <code>IsBlank</code>, not <code>IsEmpty</code> — and a
        narrow namespace.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>CS0121</code> on an extension call mean?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Two imported namespaces define the same extension for that type. Drop a
        <code>using</code>, move the call, or use the full static name — there is no elegant
        call-site fix, which is why narrow namespaces matter.</p>
      </div></details>
    </li>
    <li>
      <p>Are extension calls slower than instance calls?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Measured at 9.56 ns against 7.06 ns, both dominated by the benchmark harness. There is no
        virtual dispatch — it is a static call. Nothing in those numbers should drive a design
        decision.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
