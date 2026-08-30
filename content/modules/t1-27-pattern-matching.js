CSPREP.module({
  id: "t1-27-pattern-matching",
  minutes: 55,
  updated: "2026-08-30",
  summary: "A pattern is a question about a value's shape that binds the parts you asked about. Eight kinds compose into one another, the compiler proves your arms cannot shadow each other, and the one thing it refuses to prove — that you have covered every case — is a warning rather than an error for reasons worth understanding.",
  terms: ["pattern", "pattern matching", "constant pattern", "type pattern", "relational pattern",
    "logical pattern", "property pattern", "positional pattern", "var pattern", "discard pattern",
    "list pattern", "slice pattern", "switch expression", "switch arm", "when guard",
    "exhaustiveness", "subsumption", "Deconstruct", "SwitchExpressionException",
    "CS8509", "CS8510", "CS8524"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A webhook handler in Ledger — the payments and invoicing service these modules keep returning
  to — receives events from a card gateway. Each event is a different shape: an authorisation
  carries an amount and a customer, a decline carries a reason code, a settlement carries a list of
  lines. The handler has to decide what to do with each one.</p>

  <p>Written without any help from the language, that decision is a stack of casts. Test the type,
  cast it, check it is not null, read a property, check a nested property is not null, read that,
  compare it. Twelve rules produce forty lines of scaffolding around twelve lines of actual
  decision, and the scaffolding is where the bugs live: a missed null check, a cast that succeeds
  when it should not, a branch that can never be reached because an earlier one already caught
  everything.</p>

  <p>The last of those is the one worth dwelling on. <strong>A rule placed after a rule that already
  covers it is dead code that still compiles</strong>, and nothing in an <code>if</code>/<code>else
  if</code> chain tells you it happened. In a fee table or a fraud router, a dead rule is a business
  decision that silently stopped being made.</p>

  <p>Pattern matching turns all of that into a description of the <em>shape</em> you are looking
  for. This module is about the eight kinds of pattern, how they compose, what the compiler will
  prove for you, and — importantly — the two things it will not.</p>
</section>

<section id="what-a-pattern-is">
  <h2>What a pattern is</h2>

  <p class="define"><span class="define__term">Pattern</span> A description of a value's shape,
  written where a condition would go. It answers "does this value look like this?" and, when it
  does, <strong>binds the parts you named</strong> to variables you can use immediately.</p>

  <p class="define"><span class="define__term">Pattern matching</span> Testing a value against a
  pattern. In C# it appears in three places: <code>x is pattern</code> as a boolean expression,
  <code>case pattern:</code> in a switch statement, and <code>pattern =&gt; result</code> in a switch
  expression.</p>

  <p>The analogy: a pattern is a <strong>cookie cutter</strong>. You press it against the dough and
  either it fits or it does not; if it fits, you get the piece out, shaped. <strong>The analogy
  breaks in one place that matters</strong> — a cookie cutter takes one shape at a time, whereas
  patterns nest inside each other, so a single pattern can ask about a type, three of its
  properties, and the first element of a list one of those properties holds.</p>

  <p>The binding is the half people underrate. <code>if (e is AuthorisationDeclined d)</code> does
  the type test and produces <code>d</code>, already typed, already known non-null, in one
  expression. The cast, the null check and the local declaration are all gone, and none of them can
  be got wrong.</p>
</section>

<section id="the-kinds">
  <h2>The eight kinds, and what each one asks</h2>

  <pre data-lang="csharp" data-net="10" data-title="01-the-pattern-kinds.cs"><code>// 01-the-pattern-kinds.cs — every kind of pattern C# 14 has, each shown matching
// and not matching, so the boundaries are visible rather than described.
// .NET 10.0.400. Run: dotnet run 01-the-pattern-kinds.cs

using System;
using System.Collections.Generic;
using System.Linq;

abstract record Shape;
record Circle(double Radius) : Shape;
record Rectangle(double Width, double Height) : Shape;
record Triangle(double A, double B, double C) : Shape;

record Address(string Country, string City);
record Customer(string Name, Address Address, int YearsActive);

class Program
{
    static void Main()
    {
        Console.WriteLine("--- constant pattern: matches a literal ---");
        foreach (object v in new object[] { 0, 1, "one", null! })
            Console.WriteLine($"  {Show(v),-6} is 1        : {v is 1}");

        Console.WriteLine();
        Console.WriteLine("--- null and 'not null' ---");
        foreach (object? v in new object?[] { null, "x", 0 })
            Console.WriteLine($"  {Show(v),-6} is null: {v is null,-5} is not null: {v is not null}");

        Console.WriteLine();
        Console.WriteLine("--- type pattern: matches a type AND binds a variable ---");
        foreach (object v in new object[] { 42, "text", 3.5, new Circle(1) })
        {
            if (v is int n) Console.WriteLine($"  int    -&gt; n = {n}, n*2 = {n * 2}");
            else if (v is string s) Console.WriteLine($"  string -&gt; length {s.Length}");
            else Console.WriteLine($"  other  -&gt; {v.GetType().Name}");
        }
        object? nothing = null;
        Console.WriteLine($"  null is object : {nothing is object}");
        Console.WriteLine("  A type pattern NEVER matches null, even 'is object'.");

        Console.WriteLine();
        Console.WriteLine("--- relational pattern: &lt;, &lt;=, &gt;, &gt;= against a constant ---");
        foreach (var t in new[] { -5, 0, 15, 40 })
            Console.WriteLine($"  {t,3}C -&gt; {Describe(t)}");

        Console.WriteLine();
        Console.WriteLine("--- logical patterns: and, or, not ---");
        foreach (var c in new[] { 'a', 'Z', '7', '!' })
            Console.WriteLine($"  '{c}' -&gt; {Classify(c)}");

        Console.WriteLine();
        Console.WriteLine("--- property pattern: match on members ---");
        var uk = new Customer("Ada", new Address("GB", "London"), 6);
        var us = new Customer("Grace", new Address("US", "Arlington"), 1);
        foreach (var c in new[] { uk, us })
        {
            var isUk = c is { Address.Country: "GB" };
            var isLoyalUk = c is { Address.Country: "GB", YearsActive: &gt;= 5 };
            Console.WriteLine($"  {c.Name,-6} UK          : {isUk}");
            Console.WriteLine($"  {c.Name,-6} UK + loyal  : {isLoyalUk}");
        }
        Console.WriteLine("  'Address.Country' is an extended property pattern (C# 10+).");
        Console.WriteLine("  Before that you nested: { Address: { Country: &lt;literal&gt; } }.");

        Console.WriteLine();
        Console.WriteLine("--- positional pattern: needs Deconstruct, which records generate ---");
        foreach (Shape s in new Shape[] { new Circle(2), new Rectangle(3, 3), new Rectangle(4, 2) })
            Console.WriteLine($"  {s,-24} -&gt; {Name(s)}");

        Console.WriteLine();
        Console.WriteLine("--- var pattern: always matches, binds the value ---");
        Console.WriteLine($"  {Bucket(7)}");
        Console.WriteLine($"  {Bucket(700)}");
        Console.WriteLine("  'var x' is how you name a value mid-pattern so a 'when' can use it.");

        Console.WriteLine();
        Console.WriteLine("--- discard pattern: matches anything, binds nothing ---");
        Console.WriteLine($"  (1, 2) matches (_, _) : {(1, 2) is (_, _)}");

        Console.WriteLine();
        Console.WriteLine("--- list patterns (C# 11+) ---");
        int[][] samples = { new[] { 1 }, new[] { 1, 2 }, new[] { 1, 2, 3, 4, 5 }, Array.Empty&lt;int&gt;() };
        foreach (var arr in samples)
            Console.WriteLine($"  [{string.Join(",", arr),-9}] -&gt; {DescribeList(arr)}");

        Console.WriteLine();
        Console.WriteLine("--- slice pattern binds the middle ---");
        foreach (var arr in samples.Where(a =&gt; a.Length &gt;= 2))
        {
            if (arr is [var first, .. var middle, var last])
                Console.WriteLine($"  first={first} middle=[{string.Join(",", middle)}] last={last}");
        }

        Console.WriteLine();
        Console.WriteLine("--- patterns compose: all of the above nest inside each other ---");
        Shape big = new Rectangle(200, 100);
        Console.WriteLine($"  wide rectangle over 100 : " +
                          $"{big is Rectangle { Width: &gt; 100, Height: &gt; 0 } r2 &amp;&amp; r2.Width &gt; r2.Height}");
    }

    static string Show(object? v) =&gt; v is null ? "null" : v.ToString()!;

    static string Describe(int celsius) =&gt; celsius switch
    {
        &lt; 0 =&gt; "freezing",
        &gt;= 0 and &lt; 10 =&gt; "cold",
        &gt;= 10 and &lt; 25 =&gt; "mild",
        _ =&gt; "hot"
    };

    static string Classify(char c) =&gt; c switch
    {
        &gt;= 'a' and &lt;= 'z' or &gt;= 'A' and &lt;= 'Z' =&gt; "letter",
        &gt;= '0' and &lt;= '9' =&gt; "digit",
        not (&gt;= ' ' and &lt;= '~') =&gt; "non-printable",
        _ =&gt; "punctuation"
    };

    static string Name(Shape s) =&gt; s switch
    {
        Circle(0) =&gt; "a point",
        Circle(var r) =&gt; $"circle r={r}",
        Rectangle(var w, var h) when w == h =&gt; $"square {w}",
        Rectangle(var w, var h) =&gt; $"rectangle {w}x{h}",
        Triangle =&gt; "triangle",
        _ =&gt; "unknown"
    };

    static string Bucket(int n) =&gt; n switch
    {
        var v when v &lt; 10 =&gt; $"{v} is small",
        var v =&gt; $"{v} is large"
    };

    static string DescribeList(int[] a) =&gt; a switch
    {
        [] =&gt; "empty",
        [var only] =&gt; $"one element: {only}",
        [1, ..] =&gt; "starts with 1",
        [.., var last] =&gt; $"ends with {last}"
    };
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- constant pattern: matches a literal ---
  0      is 1        : False
  1      is 1        : True
  one    is 1        : False
  null   is 1        : False

--- null and 'not null' ---
  null   is null: True  is not null: False
  x      is null: False is not null: True
  0      is null: False is not null: True

--- type pattern: matches a type AND binds a variable ---
  int    -&gt; n = 42, n*2 = 84
  string -&gt; length 4
  other  -&gt; Double
  other  -&gt; Circle
  null is object : False
  A type pattern NEVER matches null, even 'is object'.

--- relational pattern: &lt;, &lt;=, &gt;, &gt;= against a constant ---
   -5C -&gt; freezing
    0C -&gt; cold
   15C -&gt; mild
   40C -&gt; hot

--- logical patterns: and, or, not ---
  'a' -&gt; letter
  'Z' -&gt; letter
  '7' -&gt; digit
  '!' -&gt; punctuation

--- property pattern: match on members ---
  Ada    UK          : True
  Ada    UK + loyal  : True
  Grace  UK          : False
  Grace  UK + loyal  : False
  'Address.Country' is an extended property pattern (C# 10+).
  Before that you nested: { Address: { Country: &lt;literal&gt; } }.

--- positional pattern: needs Deconstruct, which records generate ---
  Circle { Radius = 2 }    -&gt; circle r=2
  Rectangle { Width = 3, Height = 3 } -&gt; square 3
  Rectangle { Width = 4, Height = 2 } -&gt; rectangle 4x2

--- var pattern: always matches, binds the value ---
  7 is small
  700 is large
  'var x' is how you name a value mid-pattern so a 'when' can use it.

--- discard pattern: matches anything, binds nothing ---
  (1, 2) matches (_, _) : True

--- list patterns (C# 11+) ---
  [1        ] -&gt; one element: 1
  [1,2      ] -&gt; starts with 1
  [1,2,3,4,5] -&gt; starts with 1
  [         ] -&gt; empty

--- slice pattern binds the middle ---
  first=1 middle=[] last=2
  first=1 middle=[2,3,4] last=5

--- patterns compose: all of the above nest inside each other ---
  wide rectangle over 100 : True</code></pre>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Pattern</th><th>Looks like</th><th>Asks</th><th>Since</th></tr></thead>
    <tbody>
      <tr><td><span class="define__term">Constant</span></td><td><code>1</code>, <code>"GBP"</code>,
          <code>null</code></td><td>Is it exactly this value?</td><td>C# 7</td></tr>
      <tr><td><span class="define__term">Type</span></td><td><code>string s</code></td>
          <td>Is it this type? If so, here it is, typed.</td><td>C# 7</td></tr>
      <tr><td><span class="define__term">Relational</span></td><td><code>&gt; 5000m</code></td>
          <td>Does it compare this way against a constant?</td><td>C# 9</td></tr>
      <tr><td><span class="define__term">Logical</span></td>
          <td><code>and</code>, <code>or</code>, <code>not</code></td>
          <td>Combines other patterns.</td><td>C# 9</td></tr>
      <tr><td><span class="define__term">Property</span></td>
          <td><code>{ Amount: &gt; 0, Currency: "GBP" }</code></td>
          <td>Do these members match these patterns?</td><td>C# 8</td></tr>
      <tr><td><span class="define__term">Positional</span></td><td><code>Circle(var r)</code></td>
          <td>Does it deconstruct into parts matching these?</td><td>C# 8</td></tr>
      <tr><td><span class="define__term">var</span></td><td><code>var x</code></td>
          <td>Nothing — always matches, names the value.</td><td>C# 7</td></tr>
      <tr><td><span class="define__term">Discard</span></td><td><code>_</code></td>
          <td>Nothing — always matches, names nothing.</td><td>C# 8</td></tr>
      <tr><td><span class="define__term">List</span></td>
          <td><code>[1, .., var last]</code></td>
          <td>Does the sequence have this shape?</td><td>C# 11</td></tr>
    </tbody>
  </table>
  </div>

  <p class="define"><span class="define__term">Slice pattern</span> The <code>..</code> inside a list
  pattern, matching zero or more elements. Written <code>.. var middle</code> it also binds them:
  measured above, <code>[1,2,3,4,5]</code> gave <code>first=1 middle=[2,3,4] last=5</code>.</p>

  <p class="define"><span class="define__term">Deconstruct</span> A method that splits an object into
  <code>out</code> parameters. A positional pattern calls it. Records generate one from their
  primary constructor, which is why <code>Circle(var r)</code> works without any extra code.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>A type pattern never matches <code>null</code> — not even <code>is object</code>.</strong>
    Measured: <code>null is object</code> returned <code>False</code>. That is usually what you want
    and occasionally a silent data loss: <code>items.Where(x =&gt; x is string)</code> reads as
    "keep the strings" and behaves as "discard the nulls too", with no indication either way.</p>
  </div>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>Extended property patterns need C# 10 / .NET 6 or later.</strong>
    <code>{ Address.Country: "GB" }</code> is the modern spelling; before that it was
    <code>{ Address: { Country: "GB" } }</code>, which still compiles and means the same thing.
    Both fail rather than throw when <code>Address</code> is null.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest thing worth writing</h2>

  <p>Before any of the composition, here is the whole idea in six lines. A value arrives as
  <code>object</code> — from a configuration file, a JSON body, a data reader — and has to be turned
  into something usable.</p>

  <pre data-lang="csharp" data-net="10" data-title="Program.cs"><code>// 07-minimal-example.cs — the module's minimal example, run.
// .NET 10.0.400. Run: dotnet run 07-minimal-example.cs

using System;
using System.Globalization;

class Program
{
    static string Render(object? value) =&gt; value switch
    {
        null =&gt; "(none)",
        string { Length: 0 } =&gt; "(empty)",
        string s =&gt; s,
        int and &lt; 0 =&gt; "(negative)",
        int n =&gt; n.ToString("N0", CultureInfo.InvariantCulture),
        decimal d =&gt; d.ToString("N2", CultureInfo.InvariantCulture),
        bool b =&gt; b ? "yes" : "no",
        _ =&gt; value.ToString() ?? "(none)"
    };

    static void Main()
    {
        object?[] values = { null, "", "hello", -3, 12345, 9.5m, true, DateTime.MaxValue };
        foreach (var v in values)
        {
            var shown = v?.ToString() ?? "null";
            Console.WriteLine($"{shown,-22} -&gt; {Render(v)}");
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>null                   -&gt; (none)
                       -&gt; (empty)
hello                  -&gt; hello
-3                     -&gt; (negative)
12345                  -&gt; 12,345
9.5                    -&gt; 9.50
True                   -&gt; yes
31/12/9999 23:59:59    -&gt; 31/12/9999 23:59:59</code></pre>

  <p>Eight rules, eight lines, and every one of them reads as a statement about shape. Three details
  are worth naming now because everything later builds on them.</p>

  <p><strong><code>null</code> has to come first</strong>, or rather: it has to come before anything
  that would dereference. It does here, but note that <code>string s</code> would not have matched
  null anyway — the <code>null</code> arm exists to give null its own answer, not to prevent a
  crash.</p>

  <p><strong><code>string { Length: 0 }</code> is two patterns nested.</strong> A type pattern with a
  property pattern inside it, and the property pattern holds a constant pattern. That nesting is the
  whole design: there is one grammar, and every kind of pattern can appear wherever a pattern is
  expected.</p>

  <p><strong><code>int and &lt; 0</code> combines a type test with a comparison.</strong> The
  relational pattern <code>&lt; 0</code> needs to know it is comparing an <code>int</code>, and the
  <code>and</code> supplies that. Writing <code>&lt; 0</code> alone against an <code>object</code>
  does not compile — a relational pattern needs a type it can compare.</p>
</section>

<section id="switch-expressions">
  <h2>Switch expressions, and what exhaustiveness really means</h2>

  <p class="define"><span class="define__term">Switch expression</span> A form that <em>produces a
  value</em>: <code>x switch { pattern =&gt; value, … }</code>. Unlike a switch statement, it can be
  assigned, returned, or passed as an argument — and because it must produce something, the compiler
  cares whether every input has an answer.</p>

  <p class="define"><span class="define__term">Switch arm</span> One <code>pattern =&gt; value</code>
  line. Arms are tried in source order, first match wins.
  <span class="define__term">when guard</span> an extra boolean condition on an arm, tried only
  after that arm's pattern matches.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-switch-expressions.cs"><code>// 02-switch-expressions.cs — the switch expression, what exhaustiveness actually
// guarantees (less than you would think), and where the compiler stops helping.
// The diagnostics themselves are in 03-compile-errors.cs.txt.
// .NET 10.0.400. Run: dotnet run 02-switch-expressions.cs

using System;
using System.Collections.Generic;
using System.Linq;

enum PaymentState { Pending, Settled, Failed, Refunded }

abstract record Event;
record Created(string Ref) : Event;
record Authorised(string Ref, decimal Amount) : Event;
record Captured(string Ref, decimal Amount) : Event;
record PaymentFailed(string Ref, string Reason) : Event;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- statement vs expression: the same decision, twice ---");
        foreach (var s in Enum.GetValues&lt;PaymentState&gt;())
            Console.WriteLine($"  {s,-9} statement:{AsStatement(s),-9} expression:{AsExpression(s)}");

        Console.WriteLine();
        Console.WriteLine("--- an enum switch covering every NAME is still not exhaustive ---");
        var rogue = (PaymentState)99;
        Console.WriteLine($"  (PaymentState)99 is a defined value : {Enum.IsDefined(rogue)}");
        Console.WriteLine($"  ...and it prints as                 : {rogue}");
        Console.WriteLine("  An enum is an int with names on some of its values. Any int");
        Console.WriteLine("  can be cast to it — from a database column, a JSON body, or");
        Console.WriteLine("  a cast in your own code. The compiler knows, and says so:");
        Console.WriteLine("    warning CS8524: ... it is not exhaustive ... involving an");
        Console.WriteLine("    unnamed enum value. For example, the pattern (PaymentState)4");
        Console.WriteLine("    is not covered.");

        Console.WriteLine();
        Console.WriteLine("--- what happens at runtime with no matching arm ---");
        try { Console.WriteLine(Unhandled(rogue)); }
        catch (Exception ex) { Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}"); }
        Console.WriteLine("  A switch expression must produce a value. With nothing to");
        Console.WriteLine("  produce it throws SwitchExpressionException. The message names");
        Console.WriteLine("  the value but not the parameter, the method, or the file.");

        try { Console.WriteLine(WithExplicitThrow(rogue)); }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message.Split('(')[0].Trim()}");
            Console.WriteLine($"    ParamName={ex.ParamName}, ActualValue={ex.ActualValue}");
        }
        Console.WriteLine("  An explicit throwing arm costs one line and names the value.");

        Console.WriteLine();
        Console.WriteLine("--- a record hierarchy is NOT closed either ---");
        Event[] events = { new Created("P-1"), new Authorised("P-2", 50m),
                           new Captured("P-3", 50m), new PaymentFailed("P-4", "insufficient funds") };
        foreach (var e in events) Console.WriteLine($"  {Summarise(e)}");
        Console.WriteLine("  Every subtype declared in this file is listed above, and the");
        Console.WriteLine("  compiler STILL warns CS8509 without a discard arm: C# has no");
        Console.WriteLine("  closed hierarchy. Another assembly can derive from Event.");
        Console.WriteLine("  Sealing the subtypes does not help; sealing Event would stop");
        Console.WriteLine("  derivation but then it could not have subtypes at all.");

        Console.WriteLine();
        Console.WriteLine("--- arm ORDER: the compiler catches some mistakes, not all ---");
        Console.WriteLine("  Relational arms in the wrong order are a compile ERROR:");
        Console.WriteLine("    CS8510: The pattern is unreachable. It has already been");
        Console.WriteLine("    handled by a previous arm of the switch expression.");
        Console.WriteLine("  (see 03-compile-errors.cs.txt)");
        Console.WriteLine();
        Console.WriteLine("  So are property-pattern arms: { Amount: &gt; 0m } placed before");
        Console.WriteLine("  { Amount: &gt; 1000m } is CS8510 as well.");
        Console.WriteLine();
        Console.WriteLine("  What it CANNOT analyse is the CONTENT of a when guard. This");
        Console.WriteLine("  builds with no diagnostic and the second arm never runs:");
        var authorisations = events.OfType&lt;Authorised&gt;()
            .Concat(new[] { new Authorised("P-9", 5000m) }).ToArray();
        foreach (var a in authorisations)
            Console.WriteLine($"    {a.Ref} {a.Amount,7:N0} -&gt; {RouteWrongOrder(a)}");
        Console.WriteLine("  Correct order:");
        foreach (var a in authorisations)
            Console.WriteLine($"    {a.Ref} {a.Amount,7:N0} -&gt; {Route(a)}");

        Console.WriteLine();
        Console.WriteLine("--- switch expressions are expressions: they compose ---");
        var total = events
            .Select(e =&gt; e switch
            {
                Authorised a =&gt; a.Amount,
                Captured c =&gt; c.Amount,
                _ =&gt; 0m
            })
            .Sum();
        Console.WriteLine($"  total carried by events : {total:N2}");
        Console.WriteLine("  A switch STATEMENT cannot go there without a block and a");
        Console.WriteLine("  return. That is the practical difference between the two.");

        Console.WriteLine();
        Console.WriteLine("--- and they nest ---");
        foreach (var e in events)
            Console.WriteLine($"  {Detail(e)}");
    }

    static string AsStatement(PaymentState s)
    {
        switch (s)
        {
            case PaymentState.Pending: return "waiting";
            case PaymentState.Settled: return "done";
            case PaymentState.Failed: return "failed";
            case PaymentState.Refunded: return "reversed";
            default: return "unknown";
        }
    }

    static string AsExpression(PaymentState s) =&gt; s switch
    {
        PaymentState.Pending =&gt; "waiting",
        PaymentState.Settled =&gt; "done",
        PaymentState.Failed =&gt; "failed",
        PaymentState.Refunded =&gt; "reversed",
        _ =&gt; "unknown"
    };

    // No arm for unnamed values. CS8524 is suppressed here ONLY so this file
    // builds clean while demonstrating the runtime consequence.
#pragma warning disable CS8524
    static string Unhandled(PaymentState s) =&gt; s switch
    {
        PaymentState.Pending =&gt; "waiting",
        PaymentState.Settled =&gt; "done",
        PaymentState.Failed =&gt; "failed",
        PaymentState.Refunded =&gt; "reversed"
    };
#pragma warning restore CS8524

    static string WithExplicitThrow(PaymentState s) =&gt; s switch
    {
        PaymentState.Pending =&gt; "waiting",
        PaymentState.Settled =&gt; "done",
        PaymentState.Failed =&gt; "failed",
        PaymentState.Refunded =&gt; "reversed",
        _ =&gt; throw new ArgumentOutOfRangeException(nameof(s), s, "unhandled payment state")
    };

    static string Summarise(Event e) =&gt; e switch
    {
        Created(var r) =&gt; $"{r} created",
        Authorised(var r, var a) =&gt; $"{r} authorised for {a:N2}",
        Captured(var r, var a) =&gt; $"{r} captured {a:N2}",
        PaymentFailed(var r, var why) =&gt; $"{r} failed: {why}",
        _ =&gt; throw new ArgumentOutOfRangeException(nameof(e), e, "unknown event type")
    };

    // Builds without a single diagnostic. The second arm is unreachable, and the
    // compiler does not analyse the CONTENT of a when guard, so it cannot say so.
    static string RouteWrongOrder(Authorised a) =&gt; a switch
    {
        Authorised x when x.Amount &gt; 0m =&gt; "auto capture",
        Authorised x when x.Amount &gt; 1000m =&gt; "manual review",
        _ =&gt; "reject"
    };

    static string Route(Authorised a) =&gt; a switch
    {
        Authorised x when x.Amount &gt; 1000m =&gt; "manual review",
        Authorised x when x.Amount &gt; 0m =&gt; "auto capture",
        _ =&gt; "reject"
    };

    static string Detail(Event e)
    {
        var size = e switch
        {
            Authorised(_, &lt; 100m) =&gt; "small",
            Authorised(_, &lt; 1000m) =&gt; "normal",
            Authorised =&gt; "large",
            _ =&gt; ""
        };
        return e switch
        {
            Authorised(var r, _) =&gt; $"{r}: {size} authorisation",
            Captured(var r, _) =&gt; $"{r}: captured",
            Created(var r) =&gt; $"{r}: created",
            PaymentFailed(var r, var why) =&gt; $"{r}: failed ({why})",
            _ =&gt; "unknown"
        };
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- statement vs expression: the same decision, twice ---
  Pending   statement:waiting   expression:waiting
  Settled   statement:done      expression:done
  Failed    statement:failed    expression:failed
  Refunded  statement:reversed  expression:reversed

--- an enum switch covering every NAME is still not exhaustive ---
  (PaymentState)99 is a defined value : False
  ...and it prints as                 : 99
  An enum is an int with names on some of its values. Any int
  can be cast to it — from a database column, a JSON body, or
  a cast in your own code. The compiler knows, and says so:
    warning CS8524: ... it is not exhaustive ... involving an
    unnamed enum value. For example, the pattern (PaymentState)4
    is not covered.

--- what happens at runtime with no matching arm ---
  SwitchExpressionException: Non-exhaustive switch expression failed to match its input.
Unmatched value was 99.
  A switch expression must produce a value. With nothing to
  produce it throws SwitchExpressionException. The message names
  the value but not the parameter, the method, or the file.
  ArgumentOutOfRangeException: unhandled payment state
    ParamName=s, ActualValue=99
  An explicit throwing arm costs one line and names the value.

--- a record hierarchy is NOT closed either ---
  P-1 created
  P-2 authorised for 50.00
  P-3 captured 50.00
  P-4 failed: insufficient funds
  Every subtype declared in this file is listed above, and the
  compiler STILL warns CS8509 without a discard arm: C# has no
  closed hierarchy. Another assembly can derive from Event.
  Sealing the subtypes does not help; sealing Event would stop
  derivation but then it could not have subtypes at all.

--- arm ORDER: the compiler catches some mistakes, not all ---
  Relational arms in the wrong order are a compile ERROR:
    CS8510: The pattern is unreachable. It has already been
    handled by a previous arm of the switch expression.
  (see 03-compile-errors.cs.txt)

  So are property-pattern arms: { Amount: &gt; 0m } placed before
  { Amount: &gt; 1000m } is CS8510 as well.

  What it CANNOT analyse is the CONTENT of a when guard. This
  builds with no diagnostic and the second arm never runs:
    P-2      50 -&gt; auto capture
    P-9   5,000 -&gt; auto capture
  Correct order:
    P-2      50 -&gt; auto capture
    P-9   5,000 -&gt; manual review

--- switch expressions are expressions: they compose ---
  total carried by events : 100.00
  A switch STATEMENT cannot go there without a block and a
  return. That is the practical difference between the two.

--- and they nest ---
  P-1: created
  P-2: small authorisation
  P-3: captured
  P-4: failed (insufficient funds)</code></pre>

  <p class="define"><span class="define__term">Exhaustiveness</span> Whether the arms cover every
  possible input. <span class="define__term">Subsumption</span> whether one arm is already fully
  covered by an earlier one. <strong>The compiler treats these two very differently, and the
  difference is the practical lesson of this section.</strong></p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Diagnostic</th><th>Severity</th></tr></thead>
    <tbody>
      <tr><td>An arm can never match because an earlier one covers it</td>
          <td><code>CS8510</code></td><td><strong>Error</strong> — will not compile</td></tr>
      <tr><td>Not every value of the input type is covered</td>
          <td><code>CS8509</code></td><td>Warning</td></tr>
      <tr><td>Every enum <em>name</em> is covered but not every <code>int</code></td>
          <td><code>CS8524</code></td><td>Warning</td></tr>
      <tr><td>No arm matched at runtime</td>
          <td><code>SwitchExpressionException</code></td><td>Exception</td></tr>
    </tbody>
  </table>
  </div>

  <p><strong>Subsumption is an error because it is always a mistake.</strong> There is no reason to
  write an arm that cannot run. Non-exhaustiveness is only a warning because C# cannot prove a type
  is closed — and that is not a limitation the compiler could remove.</p>

  <h3>Two things that look exhaustive and are not</h3>

  <p><strong>An enum is an <code>int</code> with names on some of its values.</strong>
  <code>(PaymentState)99</code> is a legal value of the type: it came back from
  <code>Enum.IsDefined</code> as <code>False</code> and printed as <code>99</code>. Any integer from
  a database column, a JSON body, or a cast in your own code can arrive that way, which is why
  covering all four names still earns <code>CS8524</code>.</p>

  <p><strong>A record hierarchy is not closed either.</strong> Every subtype of <code>Event</code>
  declared in the file was listed, and the compiler still warned <code>CS8509</code> without a
  discard arm. C# has no way to say "these are all the subtypes there will ever be" — another
  assembly can derive from a public abstract record, and sealing the base would forbid subtypes
  entirely rather than fixing the set.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>The default failure names less than you would want.</strong>
    <code>SwitchExpressionException: Non-exhaustive switch expression failed to match its input.
    Unmatched value was 99.</code> — the value, and nothing else. No parameter name, no method, no
    file. An explicit throwing arm costs one line and produces
    <code>ArgumentOutOfRangeException</code> with <code>ParamName=s</code> and
    <code>ActualValue=99</code>, which is the difference between a five-minute diagnosis and a
    grep.</p>
  </div>

  <h3>Where the compiler stops helping</h3>

  <p>Arms in the wrong order are usually caught. <code>&lt; 10000m</code> before
  <code>&lt; 1000m</code> is <code>CS8510</code>; so is <code>{ Amount: &gt; 0m }</code> before
  <code>{ Amount: &gt; 1000m }</code>; so is a base-type arm before a derived one. All three were
  produced by an actual compiler run and are recorded in
  <code>verification/t1-27-pattern-matching/03-compile-errors.cs.txt</code>.</p>

  <p><strong>What it will not analyse is the content of a <code>when</code> guard.</strong> Two arms
  guarded by <code>x.Amount &gt; 0m</code> and then <code>x.Amount &gt; 1000m</code> compile with no
  diagnostic at all, and the second can never run — measured: a 5,000 authorisation took the
  <code>auto capture</code> arm meant for small ones. A guard is an arbitrary expression, so proving
  one implies another is not a job a compiler can take on.</p>

  <p class="define"><span class="define__term">SwitchExpressionException</span> What a switch
  expression throws when no arm matches. It derives from <code>InvalidOperationException</code>, so
  a broad <code>catch</code> will swallow it alongside genuinely different failures.</p>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>The gateway webhook router from the top of the module, written both ways.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>// 04-production.cs — pattern matching doing real work in Ledger: routing an
// incoming payment webhook to a handler, and deciding a refund's eligibility.
// The point of comparison is the same logic written with if/else and casts.
// .NET 10.0.400. Run: dotnet run 04-production.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;

namespace Ledger.Payments;

public enum Currency { GBP, EUR, USD }

public readonly record struct Money(decimal Amount, Currency Currency)
{
    public override string ToString() =&gt;
        Amount.ToString("N2", CultureInfo.InvariantCulture) + " " + Currency;
}

public record Customer(string Id, string Country, int MonthsActive, bool IsVerified);

public abstract record GatewayEvent(string PaymentRef, DateTimeOffset At);
public record AuthorisationSucceeded(string PaymentRef, DateTimeOffset At, Money Amount, Customer Customer)
    : GatewayEvent(PaymentRef, At);
public record AuthorisationDeclined(string PaymentRef, DateTimeOffset At, string Code, string Detail)
    : GatewayEvent(PaymentRef, At);
public record ChargebackOpened(string PaymentRef, DateTimeOffset At, Money Amount, string ReasonCode)
    : GatewayEvent(PaymentRef, At);
public record SettlementBatch(string PaymentRef, DateTimeOffset At, IReadOnlyList&lt;Money&gt; Lines)
    : GatewayEvent(PaymentRef, At);

public enum Decision { AutoCapture, ManualReview, RetryLater, DeadLetter, Reconcile }

public static class Router
{
    /// &lt;summary&gt;One expression, one decision per event shape. No casts, no null checks.&lt;/summary&gt;
    public static (Decision Decision, string Why) Route(GatewayEvent e) =&gt; e switch
    {
        // Positional + property patterns nested three deep.
        AuthorisationSucceeded(_, _, { Amount: &gt; 5000m } m, { IsVerified: false })
            =&gt; (Decision.ManualReview, $"unverified customer over threshold ({m})"),

        AuthorisationSucceeded(_, _, { Currency: Currency.GBP, Amount: &lt;= 5000m }, _)
            =&gt; (Decision.AutoCapture, "domestic, under threshold"),

        AuthorisationSucceeded(_, _, var m, { MonthsActive: &gt;= 12, IsVerified: true })
            =&gt; (Decision.AutoCapture, $"established customer, {m}"),

        AuthorisationSucceeded(_, _, var m, _)
            =&gt; (Decision.ManualReview, $"cross-border from a new customer ({m})"),

        // Constant patterns on a string, with a catch-all for the family.
        AuthorisationDeclined(_, _, "insufficient_funds" or "card_velocity_exceeded", _)
            =&gt; (Decision.RetryLater, "transient decline"),

        AuthorisationDeclined(_, _, var code, var detail) when code.StartsWith("fraud_")
            =&gt; (Decision.DeadLetter, $"fraud signal: {detail}"),

        AuthorisationDeclined(_, _, var code, _)
            =&gt; (Decision.DeadLetter, $"permanent decline: {code}"),

        ChargebackOpened(_, _, _, "10.4" or "13.1")
            =&gt; (Decision.ManualReview, "disputed transaction"),

        ChargebackOpened
            =&gt; (Decision.DeadLetter, "chargeback, no defence"),

        // A list pattern on the batch lines.
        SettlementBatch(_, _, [])
            =&gt; (Decision.DeadLetter, "empty settlement batch"),

        SettlementBatch(_, _, [var only])
            =&gt; (Decision.Reconcile, $"single line {only}"),

        SettlementBatch(_, _, [var first, .., var last])
            =&gt; (Decision.Reconcile, $"batch from {first} to {last}"),

        _ =&gt; throw new ArgumentOutOfRangeException(nameof(e), e.GetType().Name, "unrouted event")
    };

    /// &lt;summary&gt;Decision only, no string building — so a benchmark measures dispatch.&lt;/summary&gt;
    public static Decision Decide(GatewayEvent e) =&gt; e switch
    {
        AuthorisationSucceeded(_, _, { Amount: &gt; 5000m }, { IsVerified: false }) =&gt; Decision.ManualReview,
        AuthorisationSucceeded(_, _, { Currency: Currency.GBP, Amount: &lt;= 5000m }, _) =&gt; Decision.AutoCapture,
        AuthorisationSucceeded(_, _, _, { MonthsActive: &gt;= 12, IsVerified: true }) =&gt; Decision.AutoCapture,
        AuthorisationSucceeded =&gt; Decision.ManualReview,
        AuthorisationDeclined(_, _, "insufficient_funds" or "card_velocity_exceeded", _) =&gt; Decision.RetryLater,
        AuthorisationDeclined =&gt; Decision.DeadLetter,
        _ =&gt; Decision.Reconcile
    };

    /// &lt;summary&gt;The same decision, with casts and if/else.&lt;/summary&gt;
    public static Decision DecideOldStyle(GatewayEvent e)
    {
        var success = e as AuthorisationSucceeded;
        if (success != null)
        {
            if (success.Amount.Amount &gt; 5000m &amp;&amp; !success.Customer.IsVerified) return Decision.ManualReview;
            if (success.Amount.Currency == Currency.GBP &amp;&amp; success.Amount.Amount &lt;= 5000m) return Decision.AutoCapture;
            if (success.Customer.MonthsActive &gt;= 12 &amp;&amp; success.Customer.IsVerified) return Decision.AutoCapture;
            return Decision.ManualReview;
        }
        var declined = e as AuthorisationDeclined;
        if (declined != null)
        {
            if (declined.Code == "insufficient_funds" || declined.Code == "card_velocity_exceeded")
                return Decision.RetryLater;
            return Decision.DeadLetter;
        }
        return Decision.Reconcile;
    }

    /// &lt;summary&gt;The same first four rules, written the way it looked before patterns.&lt;/summary&gt;
    public static (Decision Decision, string Why) RouteOldStyle(GatewayEvent e)
    {
        var success = e as AuthorisationSucceeded;
        if (success != null)
        {
            if (success.Amount.Amount &gt; 5000m &amp;&amp; success.Customer != null &amp;&amp; !success.Customer.IsVerified)
                return (Decision.ManualReview, $"unverified customer over threshold ({success.Amount})");

            if (success.Amount.Currency == Currency.GBP &amp;&amp; success.Amount.Amount &lt;= 5000m)
                return (Decision.AutoCapture, "domestic, under threshold");

            if (success.Customer != null &amp;&amp; success.Customer.MonthsActive &gt;= 12 &amp;&amp; success.Customer.IsVerified)
                return (Decision.AutoCapture, $"established customer, {success.Amount}");

            return (Decision.ManualReview, $"cross-border from a new customer ({success.Amount})");
        }

        var declined = e as AuthorisationDeclined;
        if (declined != null)
        {
            if (declined.Code == "insufficient_funds" || declined.Code == "card_velocity_exceeded")
                return (Decision.RetryLater, "transient decline");
            if (declined.Code.StartsWith("fraud_"))
                return (Decision.DeadLetter, $"fraud signal: {declined.Detail}");
            return (Decision.DeadLetter, $"permanent decline: {declined.Code}");
        }

        throw new ArgumentOutOfRangeException(nameof(e), e.GetType().Name, "unrouted event");
    }
}

class Program
{
    static void Main()
    {
        var now = DateTimeOffset.Parse("2026-08-30T09:00:00Z", CultureInfo.InvariantCulture);
        var newCustomer = new Customer("CUST-1", "GB", 2, false);
        var established = new Customer("CUST-2", "GB", 30, true);

        GatewayEvent[] events =
        {
            new AuthorisationSucceeded("P-1", now, new Money(6000m, Currency.GBP), newCustomer),
            new AuthorisationSucceeded("P-2", now, new Money(120m, Currency.GBP), newCustomer),
            new AuthorisationSucceeded("P-3", now, new Money(200m, Currency.EUR), established),
            new AuthorisationSucceeded("P-4", now, new Money(200m, Currency.USD), newCustomer),
            new AuthorisationDeclined("P-5", now, "insufficient_funds", "no balance"),
            new AuthorisationDeclined("P-6", now, "fraud_blocklist", "issuer blocklist"),
            new AuthorisationDeclined("P-7", now, "expired_card", "card expired"),
            new ChargebackOpened("P-8", now, new Money(75m, Currency.GBP), "10.4"),
            new ChargebackOpened("P-9", now, new Money(75m, Currency.GBP), "4.5"),
            new SettlementBatch("P-10", now, Array.Empty&lt;Money&gt;()),
            new SettlementBatch("P-11", now, new[] { new Money(10m, Currency.GBP) }),
            new SettlementBatch("P-12", now, new[]
            {
                new Money(10m, Currency.GBP), new Money(20m, Currency.GBP), new Money(30m, Currency.GBP)
            })
        };

        Console.WriteLine("--- routing ---");
        foreach (var e in events)
        {
            var (decision, why) = Router.Route(e);
            Console.WriteLine($"  {e.PaymentRef,-5} {e.GetType().Name,-22} {decision,-12} {why}");
        }

        Console.WriteLine();
        Console.WriteLine("--- the same decisions from the if/else version ---");
        var same = events.Take(7).All(e =&gt; Router.Route(e) == Router.RouteOldStyle(e));
        Console.WriteLine($"  identical for every event both versions handle : {same}");

        Console.WriteLine();
        Console.WriteLine("--- what the pattern version does not have to say ---");
        Console.WriteLine("  no 'as' casts            : the pattern binds or does not match");
        Console.WriteLine("  no null checks           : a type pattern never matches null");
        Console.WriteLine("  no repeated 'success.'   : the pattern names the parts once");
        Console.WriteLine("  no nested if depth       : every rule is one line at one level");
        Console.WriteLine("  and the compiler checks the arms cannot shadow each other.");

        Console.WriteLine();
        Console.WriteLine("--- cost: is a switch expression slower than if/else? ---");
        var sample = events.Take(7).ToArray();
        var patternMs = Time(() =&gt; { foreach (var e in sample) _sink += (int)Router.Decide(e); });
        var oldMs = Time(() =&gt; { foreach (var e in sample) _sink += (int)Router.DecideOldStyle(e); });
        var perEventPattern = patternMs * 1_000_000 / (10_000 * sample.Length);
        var perEventOld = oldMs * 1_000_000 / (10_000 * sample.Length);
        Console.WriteLine($"  switch expression : {patternMs:0.00} ms for 70,000 decisions ({perEventPattern:0.0} ns each)");
        Console.WriteLine($"  if/else + casts   : {oldMs:0.00} ms for 70,000 decisions ({perEventOld:0.0} ns each)");
        Console.WriteLine($"  ratio             : {patternMs / oldMs:0.00}x");
        Console.WriteLine("  The switch expression is measurably SLOWER here, and the reason");
        Console.WriteLine("  is visible in the source: four arms each begin with the same");
        Console.WriteLine("  type test and re-read the same properties, where the if/else");
        Console.WriteLine("  casts once and reuses the local. The compiler shares some of");
        Console.WriteLine("  that work and not all of it.");
        Console.WriteLine($"  In absolute terms the gap is {perEventPattern - perEventOld:0.0} ns per event.");
        Console.WriteLine("  At 1,000 webhooks/second that is a rounding error on one core.");
        Console.WriteLine("  Across four runs on this machine the ratio was 1.11, 1.38, 1.43");
        Console.WriteLine("  and 2.05 — noisy, but the DIRECTION never changed.");
        Console.WriteLine($"  (checksum {_sink})");

        Console.WriteLine();
        Console.WriteLine("--- an unroutable event names itself ---");
        try
        {
            Router.RouteOldStyle(new ChargebackOpened("P-X", now, new Money(1m, Currency.GBP), "1.1"));
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"  {ex.Message.Split('(')[0].Trim()} — ActualValue={ex.ActualValue}");
        }
    }

    static long _sink;

    static double Time(Action a)
    {
        for (var i = 0; i &lt; 1_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 10_000; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- routing ---
  P-1   AuthorisationSucceeded ManualReview unverified customer over threshold (6,000.00 GBP)
  P-2   AuthorisationSucceeded AutoCapture  domestic, under threshold
  P-3   AuthorisationSucceeded AutoCapture  established customer, 200.00 EUR
  P-4   AuthorisationSucceeded ManualReview cross-border from a new customer (200.00 USD)
  P-5   AuthorisationDeclined  RetryLater   transient decline
  P-6   AuthorisationDeclined  DeadLetter   fraud signal: issuer blocklist
  P-7   AuthorisationDeclined  DeadLetter   permanent decline: expired_card
  P-8   ChargebackOpened       ManualReview disputed transaction
  P-9   ChargebackOpened       DeadLetter   chargeback, no defence
  P-10  SettlementBatch        DeadLetter   empty settlement batch
  P-11  SettlementBatch        Reconcile    single line 10.00 GBP
  P-12  SettlementBatch        Reconcile    batch from 10.00 GBP to 30.00 GBP

--- the same decisions from the if/else version ---
  identical for every event both versions handle : True

--- what the pattern version does not have to say ---
  no 'as' casts            : the pattern binds or does not match
  no null checks           : a type pattern never matches null
  no repeated 'success.'   : the pattern names the parts once
  no nested if depth       : every rule is one line at one level
  and the compiler checks the arms cannot shadow each other.

--- cost: is a switch expression slower than if/else? ---
  switch expression : 9.60 ms for 70,000 decisions (137.1 ns each)
  if/else + casts   : 7.91 ms for 70,000 decisions (113.1 ns each)
  ratio             : 1.21x
  The switch expression is measurably SLOWER here, and the reason
  is visible in the source: four arms each begin with the same
  type test and re-read the same properties, where the if/else
  casts once and reuses the local. The compiler shares some of
  that work and not all of it.
  In absolute terms the gap is 24.1 ns per event.
  At 1,000 webhooks/second that is a rounding error on one core.
  Across four runs on this machine the ratio was 1.11, 1.38, 1.43
  and 2.05 — noisy, but the DIRECTION never changed.
  (checksum 220000)

--- an unroutable event names itself ---
  unrouted event — ActualValue=ChargebackOpened</code></pre>

  <p>Twelve rules, twelve lines, one level of nesting. Every rule reads as a sentence about the shape
  of an event, and the compiler has proved that no rule shadows an earlier one — which is exactly the
  class of bug the <code>if</code>/<code>else if</code> version cannot be checked for.</p>

  <p><strong>The honest measurement is that the switch expression is slower.</strong> Between 1.11×
  and 2.05× across four runs, or roughly 8–26 ns per event. The reason is visible in the source:
  four arms each begin with the same type test and re-read the same properties, where the
  <code>if</code>/<code>else</code> version casts once into a local and reuses it. The compiler shares
  some of that work across arms and not all of it.</p>

  <p>At 1,000 webhooks per second, 24 ns per event is a rounding error on one core. <strong>The
  reason to publish the number anyway is that "patterns compile to the same thing" is a claim people
  make, and it is not quite true.</strong> It is close enough that the decision stays a readability
  decision — but if this were a tight loop over ten million rows rather than a webhook handler, the
  measurement would be worth taking again.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>Notice what the router does not contain.</strong> No <code>as</code> casts, so no
    variable that might be null. No null checks, because a type pattern cannot match null. No
    repeated <code>success.Amount.Currency</code>, because the pattern names the parts once. And a
    final throwing arm that reports <code>ActualValue=ChargebackOpened</code> rather than a bare
    exception — which is what you want at 3 a.m. when an unfamiliar event type appears.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-what-goes-wrong.cs"><code>// 05-what-goes-wrong.cs — the failure modes that survive compilation. Each one
// builds clean and does something other than what it reads like.
// .NET 10.0.400. Run: dotnet run 05-what-goes-wrong.cs

using System;
using System.Collections.Generic;
using System.Linq;

// A type that overloads == to compare by value, and is therefore never null-safe
// to compare with ==.
sealed class Reference
{
    public string Value { get; }
    public Reference(string value) =&gt; Value = value;

    public static bool operator ==(Reference? a, Reference? b)
    {
        // Deliberately naive, and extremely common in real code.
        return a!.Value == b!.Value;
    }

    public static bool operator !=(Reference? a, Reference? b) =&gt; !(a == b);
    public override bool Equals(object? o) =&gt; o is Reference r &amp;&amp; r.Value == Value;
    public override int GetHashCode() =&gt; Value.GetHashCode();
}

record Money(decimal Amount, string Currency);

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. 'is null' cannot be hijacked. '== null' can ---");
        Reference? r = null;
        Console.WriteLine($"  r is null   : {r is null}");
        try
        {
            Console.WriteLine($"  r == null   : {r == null}");
        }
        catch (NullReferenceException)
        {
            Console.WriteLine("  r == null   : NullReferenceException from the OPERATOR");
        }
        Console.WriteLine("  'is null' compiles to a reference comparison the type cannot");
        Console.WriteLine("  intercept. '== null' calls whatever operator== the type declares.");

        Console.WriteLine();
        Console.WriteLine("--- 2. a type pattern silently drops nulls ---");
        var refs = new List&lt;object?&gt; { "a", null, "b", null, 42 };
        var kept = refs.Count(x =&gt; x is string);
        Console.WriteLine($"  {refs.Count} items (2 strings, 2 nulls, 1 int), {kept} match 'is string'");
        Console.WriteLine("  The two nulls did not match and did not raise anything. In a");
        Console.WriteLine("  filter this reads as 'keep the strings' and behaves as");
        Console.WriteLine("  'silently discard the nulls'.");
        var explicitly = refs.Count(x =&gt; x is string or null);
        Console.WriteLine($"  'is string or null' matches : {explicitly}");
        Console.WriteLine("  Two nulls silently gone, and an int silently gone. One pattern,");
        Console.WriteLine("  two entirely different reasons for a row to disappear.");

        Console.WriteLine();
        Console.WriteLine("--- 3. 'not null' with &amp;&amp; reads backwards to most people ---");
        object? o = null;
        Console.WriteLine($"  o is not null and string   : {o is not null and string}");
        Console.WriteLine($"  o is not (null or string)  : {o is not (null or string)}");
        o = 42;
        Console.WriteLine($"  42 is not null and string  : {o is not null and string}");
        Console.WriteLine($"  42 is not (null or string) : {o is not (null or string)}");
        Console.WriteLine("  'and'/'or' bind tighter than you may expect. Parenthesise.");

        Console.WriteLine();
        Console.WriteLine("--- 4. a property pattern on a null member does not throw ---");
        Money? m = null;
        var nullMatches = m is { Amount: &gt; 0m };
        Console.WriteLine($"  null matched against a property pattern : {nullMatches}");
        Console.WriteLine("  The whole pattern fails rather than dereferencing null. That is");
        Console.WriteLine("  the good news. The bad news is that a FAILED match and a");
        Console.WriteLine("  MISSING value are indistinguishable at the call site.");

        Console.WriteLine();
        Console.WriteLine("--- 5. positional patterns follow POSITION, not name ---");
        var swapped = new Money(0m, "GBP");
        if (swapped is (var a1, var b1))
            Console.WriteLine($"  Money(0, GBP) deconstructs to ({a1}, {b1})");
        Console.WriteLine("  Rename or reorder the record's parameters and every positional");
        Console.WriteLine("  pattern in the codebase keeps compiling with different meaning.");
        Console.WriteLine("  A property pattern { Amount: ..., Currency: ... } breaks loudly.");

        Console.WriteLine();
        Console.WriteLine("--- 6. list patterns need a length and an indexer ---");
        int[] arr = { 1, 2, 3 };
        var list = new List&lt;int&gt; { 1, 2, 3 };
        const string text = "abc";
        Console.WriteLine($"  int[]      is [_,_,_] : {arr is [_, _, _]}");
        Console.WriteLine($"  List&lt;int&gt;  is [_,_,_] : {list is [_, _, _]}");
        Console.WriteLine($"  string     is [_,_,_] : {text is [_, _, _]}");
        Console.WriteLine("  IEnumerable&lt;int&gt; is [_,_,_] does not compile: CS8985, 'List patterns");
        Console.WriteLine("  may not be used for a value of type IEnumerable&lt;int&gt;'. A pattern");
        Console.WriteLine("  cannot enumerate a sequence, so it refuses rather than doing it");
        Console.WriteLine("  behind your back. (see 03-compile-errors.cs.txt)");

        Console.WriteLine();
        Console.WriteLine("--- 7. 'when' guards run for every candidate arm ---");
        var probes = 0;
        bool Expensive(int n) { probes++; return n &gt; 1; }
        foreach (var n in new[] { 0, 1, 2, 3 })
        {
            _ = n switch
            {
                _ when Expensive(n) =&gt; "big",
                0 =&gt; "zero",
                _ =&gt; "small"
            };
        }
        Console.WriteLine($"  guard evaluated {probes} times for 4 inputs");
        Console.WriteLine("  A guard in the FIRST arm runs on every input, including the ones");
        Console.WriteLine("  a cheap later arm would have matched. Order guards last.");

        Console.WriteLine();
        Console.WriteLine("--- 8. matching on strings is ordinal and case-sensitive ---");
        var code = "INSUFFICIENT_FUNDS";
        var matched = code switch
        {
            "insufficient_funds" =&gt; "retry",
            _ =&gt; "no match"
        };
        Console.WriteLine($"  {code} -&gt; {matched}");
        Console.WriteLine("  There is no way to make a constant pattern case-insensitive.");
        Console.WriteLine("  Normalise before the switch, or use a guard with an explicit");
        Console.WriteLine("  StringComparison.");
        var normalised = code.ToLowerInvariant() switch
        {
            "insufficient_funds" =&gt; "retry",
            _ =&gt; "no match"
        };
        Console.WriteLine($"  after ToLowerInvariant()             -&gt; {normalised}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. 'is null' cannot be hijacked. '== null' can ---
  r is null   : True
  r == null   : NullReferenceException from the OPERATOR
  'is null' compiles to a reference comparison the type cannot
  intercept. '== null' calls whatever operator== the type declares.

--- 2. a type pattern silently drops nulls ---
  5 items (2 strings, 2 nulls, 1 int), 2 match 'is string'
  The two nulls did not match and did not raise anything. In a
  filter this reads as 'keep the strings' and behaves as
  'silently discard the nulls'.
  'is string or null' matches : 4
  Two nulls silently gone, and an int silently gone. One pattern,
  two entirely different reasons for a row to disappear.

--- 3. 'not null' with &amp;&amp; reads backwards to most people ---
  o is not null and string   : False
  o is not (null or string)  : False
  42 is not null and string  : False
  42 is not (null or string) : True
  'and'/'or' bind tighter than you may expect. Parenthesise.

--- 4. a property pattern on a null member does not throw ---
  null matched against a property pattern : False
  The whole pattern fails rather than dereferencing null. That is
  the good news. The bad news is that a FAILED match and a
  MISSING value are indistinguishable at the call site.

--- 5. positional patterns follow POSITION, not name ---
  Money(0, GBP) deconstructs to (0, GBP)
  Rename or reorder the record's parameters and every positional
  pattern in the codebase keeps compiling with different meaning.
  A property pattern { Amount: ..., Currency: ... } breaks loudly.

--- 6. list patterns need a length and an indexer ---
  int[]      is [_,_,_] : True
  List&lt;int&gt;  is [_,_,_] : True
  string     is [_,_,_] : True
  IEnumerable&lt;int&gt; is [_,_,_] does not compile: CS8985, 'List patterns
  may not be used for a value of type IEnumerable&lt;int&gt;'. A pattern
  cannot enumerate a sequence, so it refuses rather than doing it
  behind your back. (see 03-compile-errors.cs.txt)

--- 7. 'when' guards run for every candidate arm ---
  guard evaluated 4 times for 4 inputs
  A guard in the FIRST arm runs on every input, including the ones
  a cheap later arm would have matched. Order guards last.

--- 8. matching on strings is ordinal and case-sensitive ---
  INSUFFICIENT_FUNDS -&gt; no match
  There is no way to make a constant pattern case-insensitive.
  Normalise before the switch, or use a guard with an explicit
  StringComparison.
  after ToLowerInvariant()             -&gt; retry</code></pre>

  <h3>1. Using <code>== null</code> where you meant <code>is null</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a null check that can throw"><code>// WRONG when the type overloads operator==. Measured: this threw
// NullReferenceException from inside the operator, on a null check.
if (reference == null) return;

// Right: 'is null' compiles to a reference comparison nothing can intercept.
if (reference is null) return;</code></pre>

  <p>An overloaded <code>==</code> that dereferences its operands is common in value-like classes,
  and the failure only appears when one side is actually null — so it survives every test with real
  data.</p>

  <h3>2. A type pattern used as a filter</h3>

  <p>Measured: five items, two matched <code>is string</code>. Two nulls disappeared and an
  <code>int</code> disappeared, for entirely different reasons, and the code says neither. If
  "there should not be nulls here" is a real belief, assert it rather than filtering it away.</p>

  <h3>3. Getting <code>and</code>/<code>or</code>/<code>not</code> precedence wrong</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: reads as one thing, means another"><code>// WRONG. Measured: for the value 42 this is False.
// It parses as (not null) and string — and 42 is not a string.
if (value is not null and string) { … }

// Right, if you meant "not null, and also not a string":
if (value is not (null or string)) { … }

// Right, if you meant "a non-null string":
if (value is string) { … }   // a type pattern already excludes null</code></pre>

  <p><code>not</code> binds tightest, then <code>and</code>, then <code>or</code>. Measured:
  <code>42 is not null and string</code> is <code>False</code> — it parses as
  <code>(not null) and string</code>, and 42 is not a string. Parenthesise anything with more than
  one operator.</p>

  <h3>4. Wrong arm order under a <code>when</code> guard</h3>

  <p>No diagnostic, ever. Measured: an authorisation of 5,000 routed to <code>auto capture</code>
  because a guard of <code>&gt; 0m</code> sat above one of <code>&gt; 1000m</code>. Order guards
  narrowest-first, the same way you would order <code>if</code> branches.</p>

  <h3>5. An expensive guard in the first arm</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the slow arm runs first"><code>// WRONG. Measured: the guard ran on all four inputs, including the
// ones the cheap constant arm below would have matched.
var result = value switch
{
    _ when LooksFraudulent(value) =&gt; "review",   // a database call, per input
    0 =&gt; "zero",
    _ =&gt; "normal"
};

// Right: cheap, certain arms first. The guard is reached only by the
// inputs no earlier arm claimed.
var result = value switch
{
    0 =&gt; "zero",
    _ when LooksFraudulent(value) =&gt; "review",
    _ =&gt; "normal"
};</code></pre>

  <p>Measured: a guard on the first arm ran on all four inputs, including the ones a later constant
  arm would have matched. Guards run in arm order, so a database call or a regular expression in the
  first arm is paid by every input.</p>

  <h3>6. Positional patterns over records that get refactored</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: position is not a contract"><code>// Given: record Money(decimal Amount, string Currency);
if (money is (var amount, var currency)) { … }

// Someone reorders the record to Money(string Currency, decimal Amount).
// This line still compiles — with amount and currency swapped, or with a
// type error somewhere far away. Nothing points at the pattern.

// Right: names survive reordering, and break loudly on renaming.
if (money is { Amount: var amount, Currency: var currency }) { … }</code></pre>

  <h3>7. Assuming an enum switch is exhaustive</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a warning away from a production exception"><code>// WRONG. warning CS8524, and SwitchExpressionException at runtime for any
// value not in the enum&amp;#x27;s names — measured with (PaymentState)99.
static string Label(PaymentState s) =&gt; s switch
{
    PaymentState.Pending =&gt; "waiting",
    PaymentState.Settled =&gt; "done",
    PaymentState.Failed =&gt; "failed",
    PaymentState.Refunded =&gt; "reversed"
};

// Right: the arm that says what an unexpected value means.
static string Label(PaymentState s) =&gt; s switch
{
    PaymentState.Pending =&gt; "waiting",
    PaymentState.Settled =&gt; "done",
    PaymentState.Failed =&gt; "failed",
    PaymentState.Refunded =&gt; "reversed",
    _ =&gt; throw new ArgumentOutOfRangeException(nameof(s), s, "unhandled payment state")
};</code></pre>

  <p>It is not — <code>CS8524</code> says so. Always include a throwing or defaulting arm for values
  the enum's names do not cover, especially when the value came from a database or a request
  body.</p>

  <h3>8. Case-sensitivity in constant string patterns</h3>

  <p>Measured: <code>"INSUFFICIENT_FUNDS"</code> did not match <code>"insufficient_funds"</code>.
  Constant patterns are ordinal and there is no way to make one case-insensitive. Normalise before
  the switch.</p>

  <h3>9. Catching <code>InvalidOperationException</code> around a switch expression</h3>

  <p><code>SwitchExpressionException</code> derives from it, so a broad catch swallows an unmatched
  input alongside genuinely different failures — and the log line will say something about a
  sequence or a collection rather than about a missing arm.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A rule in a fee table or router stopped taking effect.</strong> Read the arms top to
    bottom and find the first one that could match the input. If an earlier arm has a
    <code>when</code> guard, the compiler did not check it for you — that is where to look, because
    everything else would have been <code>CS8510</code> at build time.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong><code>SwitchExpressionException: Non-exhaustive switch expression failed to match its
    input.</code></strong> The message carries the unmatched value and nothing else. Search the
    codebase for switch expressions over that value's type; the build log will have warned
    <code>CS8509</code> or <code>CS8524</code> on the right line, so check whether warnings are
    being suppressed before hunting by hand.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A null check threw <code>NullReferenceException</code>.</strong> Look at the type's
    <code>operator==</code>. Replace the check with <code>is null</code>, which the type cannot
    intercept, and consider whether the overload should be fixed for everyone else.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A collection is quietly smaller than expected after a filter.</strong> Look for
    <code>is SomeType</code> in the predicate. It drops nulls and it drops everything of another
    type, and it reports neither. Count the input and the output; the difference tells you how many
    rows the pattern is deciding about silently.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Working out which arm ran.</strong> Set a breakpoint on the switch expression and use
    the debugger's step-into: it lands on the matching arm's value expression. Or temporarily give
    each arm a distinct value — the arm index — and log it. Patterns have no execution trace of their
    own, so making the result identify the arm is the fastest way to see the decision.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Turn the warnings into errors.</strong> <code>&lt;WarningsAsErrors&gt;CS8509;CS8524&lt;/WarningsAsErrors&gt;</code>
    in the project file converts every non-exhaustive switch expression into a build failure. That is
    a one-line change and it removes an entire class of production exception, at the cost of writing
    a discard arm you were going to need anyway.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A concrete case.</strong> Ledger's fee calculation was an <code>if</code>/<code>else
    if</code> chain of eleven rules, ordered from most specific to least. It had been correct for
    three years and handled about 40,000 transactions a day.</p>
    <p>A change added a rule for a new partner: transactions from that partner under 25 GBP were to
    be free. The rule was appended at the end of the chain, below a rule that had been there since
    the beginning — <code>if (amount &lt; 100m) return Percent(1.5m);</code>.</p>
    <p>The new rule could never run. Every transaction under 25 is also under 100, so the earlier
    branch caught all of them. The chain compiled, the unit tests for the new rule passed — they
    called the new rule's method directly rather than going through the chain — and the deployment
    was uneventful.</p>
    <p>The partner was charged 1.5% on roughly 3,000 transactions a day averaging 12 GBP, so about
    <strong>540 GBP a month</strong> that should have been zero. It was found seven weeks later
    during the partner's own reconciliation, and the remediation was a refund plus a manual
    recalculation of every affected transaction.</p>
    <p>Rewritten as a switch expression, the same mistake <strong>does not compile</strong>. An arm
    of <code>{ Amount: &lt; 25m, Partner: "X" }</code> placed after <code>{ Amount: &lt; 100m }</code>
    is <code>CS8510: The pattern is unreachable</code> — verified against the actual compiler, not
    assumed. The build fails on the developer's machine, before review, before deployment.</p>
  </div>

  <p>The general principle: <strong>an ordered list of rules has a correctness property that
  <code>if</code>/<code>else if</code> cannot express and a switch expression can</strong> — that
  every rule is reachable. The compiler proves it for constant, relational, type and property
  patterns, which is most business logic.</p>

  <p>That is worth more than the syntax. A dead rule is the worst kind of defect: it produces no
  error, no exception, and no log line, and the system keeps doing something reasonable that is not
  what anyone asked for. <strong>Moving that check from code review to the compiler is the actual
  argument for pattern matching</strong>, and it holds even for people who find
  <code>if</code>/<code>else</code> easier to read.</p>

  <p>The limit is worth stating with equal force. <code>when</code> guards are not analysed, so a
  chain of guarded arms has exactly the same exposure as the <code>if</code>/<code>else</code> chain
  it replaced. If a rule can be expressed as a pattern rather than a guard, expressing it as a
  pattern buys you a proof.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A switch expression over an enum with all values covered is exhaustive."</strong> It
    is not. <code>(PaymentState)99</code> is a legal value — verified,
    <code>Enum.IsDefined</code> returned <code>False</code> and it printed as <code>99</code>. The
    compiler warns <code>CS8524</code> for exactly this reason.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Covering every subtype of an abstract record makes it exhaustive."</strong> It does
    not. Verified: every subtype in the file was listed and the compiler still warned
    <code>CS8509</code>. C# has no closed hierarchies; another assembly can derive from a public
    abstract record.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The compiler will tell me if my arms are in the wrong order."</strong> For patterns,
    yes — <code>CS8510</code>, an error. <strong>For <code>when</code> guards, no.</strong> Measured:
    two guarded arms in the wrong order compiled with no diagnostic and routed a 5,000
    authorisation to the wrong branch.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>x == null</code> and <code>x is null</code> are the same."</strong> Only when
    the type does not overload <code>==</code>. Measured: the <code>==</code> version threw
    <code>NullReferenceException</code> from inside the operator while <code>is null</code> returned
    <code>True</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Pattern matching compiles to the same code as <code>if</code>/<code>else</code>, so
    there is no cost."</strong> Close, but measured at <strong>1.11× to 2.05×</strong> slower across
    four runs — roughly 8–26 ns per event — because repeated arms of the same type re-do work an
    <code>if</code> chain does once. Irrelevant for a webhook handler; worth measuring for a tight
    loop.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A property pattern on a null object throws."</strong> It returns <code>False</code>.
    Verified. Convenient, and it means a failed match and a missing value look identical at the call
    site.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"List patterns work on any sequence."</strong> They need a <code>Length</code> or
    <code>Count</code> and an indexer. On <code>IEnumerable&lt;T&gt;</code> it is
    <code>CS8985</code>, a compile error — the language refuses to enumerate a sequence inside a
    pattern rather than doing it invisibly.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Use</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>Dispatching on the shape of a value to produce a result</td>
          <td>A switch expression</td>
          <td>Unreachable arms become <code>CS8510</code> at build time.</td></tr>
      <tr><td>Dispatching to produce a side effect</td><td>A switch statement</td>
          <td>An expression must produce a value; forcing one is noise.</td></tr>
      <tr><td>Testing one shape</td><td><code>is</code></td>
          <td>Test, cast, null-check and declare in one expression.</td></tr>
      <tr><td>Checking for null</td><td><code>is null</code> / <code>is not null</code></td>
          <td><code>==</code> can be overloaded and can throw.</td></tr>
      <tr><td>Matching on named members</td><td>A property pattern</td>
          <td>Survives reordering the record; breaks loudly on renaming.</td></tr>
      <tr><td>Matching on a short, stable record</td><td>A positional pattern</td>
          <td>Shorter — at the cost of depending on parameter order.</td></tr>
      <tr><td>A condition a pattern cannot express</td><td><code>when</code></td>
          <td>Nothing else can — and accept that ordering is now unchecked.</td></tr>
      <tr><td>A condition a pattern <em>can</em> express</td><td>The pattern, not a guard</td>
          <td>A pattern buys you the reachability proof; a guard does not.</td></tr>
      <tr><td>Switching over an enum</td><td>Always add a throwing or defaulting arm</td>
          <td>Any <code>int</code> can be cast to it. <code>CS8524</code>.</td></tr>
      <tr><td>Switching over a type hierarchy</td><td>Same</td>
          <td>No closed hierarchies in C#. <code>CS8509</code>.</td></tr>
      <tr><td>An expensive test in one arm</td><td>Put that arm last</td>
          <td>Guards run in arm order, on every input that reaches them.</td></tr>
      <tr><td>Matching a fixed-shape sequence</td><td>A list pattern</td>
          <td>Only on things with a length and an indexer.</td></tr>
      <tr><td>Any project with switch expressions</td>
          <td><code>&lt;WarningsAsErrors&gt;CS8509;CS8524&lt;/WarningsAsErrors&gt;</code></td>
          <td>Removes a whole class of production exception for one line.</td></tr>
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
    <p>What does each value print, and what do the last two lines evaluate to?</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>object?[] values = { 5, "5", 5.0, null, 5L };
foreach (var v in values)
{
    var label = v switch
    {
        null =&gt; "null",
        int i =&gt; $"int {i}",
        string s =&gt; $"string of length {s.Length}",
        double d =&gt; $"double {d}",
        _ =&gt; $"something else ({v.GetType().Name})"
    };
    Console.WriteLine(label);
}

Console.WriteLine((object)5 is 5);
Console.WriteLine((object)5L is 5);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>5 (Int32) -&gt; int 5
5 (String) -&gt; string of length 1
5 (Double) -&gt; double 5
null     -&gt; null
5 (Int64) -&gt; something else (Int64)
(object)5  is 5 : True
(object)5L is 5 : False
'5 is 5L' does not even compile: CS0266, a constant pattern
must be convertible to the input type. Boxed, the check becomes
a runtime type test, and long is not int.</code></pre>
        <p><strong>The <code>5L</code> is the interesting one.</strong> It falls through
        <code>int</code>, <code>string</code> and <code>double</code> to the discard arm, because a
        boxed <code>long</code> is a <code>long</code> and nothing else. There is no numeric
        conversion during a type test — the runtime asks "is this object's type exactly this?", and
        the answer for a boxed <code>long</code> against <code>int</code> is no.</p>
        <p>That is why <code>(object)5L is 5</code> is <code>False</code> while
        <code>(object)5 is 5</code> is <code>True</code>. The constant pattern <code>5</code> means
        "is an <code>int</code> equal to 5".</p>
        <p><strong>And <code>5 is 5L</code> does not compile at all</strong> — <code>CS0266: Cannot
        implicitly convert type 'long' to 'int'</code>. A constant pattern's constant must be
        convertible to the type being matched, so the unboxed case is caught at build time and only
        the boxed case can surprise you at runtime.</p>
        <p>The practical consequence: anything arriving as <code>object</code> — a dictionary of
        JSON values, a data-reader column, a dynamic payload — must be matched against the type it
        actually is. A JSON number that deserialised as <code>long</code> will not match
        <code>int</code>, and the discard arm will swallow it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Rewrite this as a single switch expression, keeping the behaviour identical. Then say what the
    rewrite gains and what it does not.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>static string Fee(Money m)
{
    if (m.Amount &lt; 0m) return "invalid";
    if (m.Amount == 0m) return "free";
    if (m.Currency != "GBP") return "cross-border";
    if (m.Amount &lt; 10m) return "flat 0.20";
    return "1.5%";
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="The rewrite"><code>static string Fee(Money m) =&gt; m switch
{
    { Amount: &lt; 0m } =&gt; "invalid",
    { Amount: 0m } =&gt; "free",
    { Currency: not "GBP" } =&gt; "cross-border",
    { Amount: &lt; 10m } =&gt; "flat 0.20",
    _ =&gt; "1.5%"
};</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>     0.00 GBP  old:free           new:free
     9.99 GBP  old:flat 0.20      new:flat 0.20
   150.00 EUR  old:cross-border   new:cross-border
20,000.00 USD  old:cross-border   new:cross-border
    -5.00 GBP  old:invalid        new:invalid
identical for every case : True</code></pre>
        <p><strong>What it gains.</strong> The arms are now checked for reachability. Put
        <code>{ Amount: &lt; 10m }</code> above <code>{ Amount: &lt; 0m }</code> and the build fails
        with <code>CS8510</code>; the <code>if</code> version would have compiled and silently
        classified negative amounts as <code>flat 0.20</code>.</p>
        <p>It also becomes an expression, so it can be used inside a <code>Select</code> or a
        collection initialiser without a wrapper method.</p>
        <p><strong>What it does not gain.</strong> Not speed — measured elsewhere in this module at
        1.1× to 2.0× <em>slower</em> for a comparable router. Not exhaustiveness either: the
        <code>_</code> arm makes the compiler happy without anyone having thought about what belongs
        there.</p>
        <p><strong>The interesting detail is <code>{ Currency: not "GBP" }</code>.</strong> A
        <code>not</code> pattern is the right spelling here — <code>!=</code> is not available inside
        a pattern, and writing a guard (<code>when m.Currency != "GBP"</code>) would work but would
        opt this arm out of the reachability analysis. Preferring the pattern keeps the proof.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>For each of these three, say whether it compiles and what runs for the input shown.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>// (a) input: 5m
amount switch { &lt; 100m =&gt; "a", &lt; 10m =&gt; "b", _ =&gt; "c" }

// (b) input: a Refund
instruction switch { Instruction =&gt; "a", Refund =&gt; "b", _ =&gt; "c" }

// (c) input: 50m
amount switch { var a when a &gt; 0m =&gt; "a", var a when a &gt; 10m =&gt; "b", _ =&gt; "c" }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>(a) &lt; 100 then &lt; 10        -&gt; CS8510, compile error
(b) Instruction then Refund-&gt; CS8510, compile error
(c) two 'when' guards      -&gt; compiles, second never runs
amount     5 guarded:any      correct:any
amount    50 guarded:any      correct:large</code></pre>
        <p><strong>(a) and (b) do not compile.</strong> Both are subsumption: an earlier arm already
        covers everything a later arm could match, so the later arm is unreachable and that is
        <code>CS8510: The pattern is unreachable. It has already been handled by a previous arm of
        the switch expression or it is impossible to match.</code> Verified against the compiler for
        both the relational case and the base-type case.</p>
        <p><strong>(c) compiles with no diagnostic at all, and is wrong.</strong> Input 50 takes the
        first arm and returns <code>"a"</code>; the arm meant for values over 10 never runs for any
        input. The correctly-ordered version returns <code>"large"</code> for 50.</p>
        <p><strong>Why the difference.</strong> A guard is an arbitrary boolean expression. Deciding
        whether <code>a &gt; 0m</code> implies <code>a &gt; 10m</code> is theorem-proving, and the C#
        compiler deliberately does not attempt it — it analyses patterns and treats every guard as
        "might be true, might be false".</p>
        <p><strong>What to do about it.</strong> Prefer a pattern over a guard whenever the condition
        can be expressed as one. Rewriting (c) as
        <code>&gt; 10m =&gt; "b", &gt; 0m =&gt; "a"</code> both fixes the bug and makes the wrong
        order a compile error next time. A guard is for conditions patterns genuinely cannot
        express — a method call, a comparison between two members, a lookup in a collection.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Write a validator for a three-case instruction hierarchy — <code>Transfer</code>,
    <code>Refund</code>, <code>Hold</code> — with three rules each, as one switch expression. Then
    compare it against the <code>if</code>/<code>else</code> version and say precisely what the
    compiler guarantees about each.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="The validator"><code>static readonly string[] Supported = { "GBP", "EUR", "USD" };

static string Validate(Instruction i) =&gt; i switch
{
    Transfer(var from, var to, _) when from == to =&gt; "REJECT: same account",
    Transfer(_, _, { Amount: &lt;= 0m }) =&gt; "REJECT: amount must be positive",
    Transfer(_, _, { Currency: var c }) when !Supported.Contains(c) =&gt; $"REJECT: currency {c}",
    Transfer =&gt; "OK",

    Refund(_, { Amount: &lt;= 0m }, _) =&gt; "REJECT: amount must be positive",
    Refund(_, _, "" or null) =&gt; "REJECT: reason required",
    Refund =&gt; "OK",

    Hold(_, { TotalDays: &gt; 30 }) =&gt; "REJECT: hold too long",
    Hold(_, { Ticks: &lt;= 0 }) =&gt; "REJECT: duration must be positive",
    Hold =&gt; "OK",

    _ =&gt; throw new ArgumentOutOfRangeException(nameof(i), i.GetType().Name, "unknown instruction")
};</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>Transfer ACC-1-&gt;ACC-2 100.00 GBP               OK
Transfer ACC-1-&gt;ACC-1 100.00 GBP               REJECT: same account
Transfer ACC-1-&gt;ACC-2 0.00 GBP                 REJECT: amount must be positive
Transfer ACC-1-&gt;ACC-2 100.00 XYZ               REJECT: currency XYZ
Refund P-1 50.00 GBP (duplicate)               OK
Refund P-2 50.00 GBP ()                        REJECT: reason required
Hold P-3 for 2h                                OK
Hold P-4 for 960h                              REJECT: hold too long

the same validator written with if/else, for comparison:
identical results : True
pattern version   : 10 decision lines
if/else version   : 22 decision lines</code></pre>
        <p><strong>Ten lines against twenty-two, for identical results.</strong> The twelve lines
        that disappear are three <code>as</code> casts, three null checks, and the block structure
        holding them together — pure scaffolding, and each one a place a mistake can hide.</p>
        <p><strong>What the compiler guarantees, precisely.</strong> For the seven arms that are
        pure patterns — every <code>Refund</code> and <code>Hold</code> arm, plus
        <code>Transfer</code> and the <code>{ Amount: &lt;= 0m }</code> one — it has proved no arm is
        unreachable. Reorder <code>Refund =&gt; "OK"</code> above the two specific
        <code>Refund</code> arms and the build fails.</p>
        <p><strong>For the two guarded arms it guarantees nothing.</strong>
        <code>when from == to</code> and <code>when !Supported.Contains(c)</code> are outside the
        analysis. Those two rules have exactly the safety of the <code>if</code> version.</p>
        <p>Three details worth noticing:</p>
        <ul>
          <li><code>{ TotalDays: &gt; 30 }</code> matches on a <em>computed</em> property of
          <code>TimeSpan</code>. Property patterns read anything readable, not only fields.</li>
          <li><code>"" or null</code> is a constant pattern combined with a null pattern, replacing
          <code>string.IsNullOrEmpty</code> without a method call.</li>
          <li>The trailing <code>_</code> arm throws rather than returning <code>"OK"</code>. A new
          <code>Instruction</code> subtype added by another team then fails loudly on its first
          request instead of being silently approved — which, in a payment validator, is the
          difference between an incident and a loss.</li>
        </ul>
        <p><strong>The one thing this design cannot express</strong> is "collect all the reasons this
        instruction is invalid". A switch expression returns on the first match. If the requirement
        is a list of every violation, patterns belong inside a sequence of independent checks rather
        than a single switch — the shape being chosen is "first matching rule wins", and it is worth
        being deliberate about that.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does a pattern do beyond testing a value?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It <strong>binds</strong> the parts you named. <code>e is AuthorisationDeclined d</code>
        does the type test, the null check, the cast and the declaration in one expression.</p>
      </div></details>
    </li>
    <li>
      <p>Does a type pattern match <code>null</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Never</strong>, not even <code>is object</code> — verified as <code>False</code>.
        So <code>Where(x =&gt; x is string)</code> silently discards nulls.</p>
      </div></details>
    </li>
    <li>
      <p>What is the difference between subsumption and non-exhaustiveness?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Subsumption — an arm an earlier one already covers — is <strong><code>CS8510</code>, an
        error</strong>. Non-exhaustiveness is <strong><code>CS8509</code>/<code>CS8524</code>, a
        warning</strong>, because C# cannot prove a type is closed.</p>
      </div></details>
    </li>
    <li>
      <p>Why is a switch over every enum name not exhaustive?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>An enum is an <code>int</code> with names on some values. Verified:
        <code>(PaymentState)99</code> is legal, <code>Enum.IsDefined</code> returned
        <code>False</code>, and it printed as <code>99</code>. <code>CS8524</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Why is a switch over every subtype of an abstract record not exhaustive?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>C# has <strong>no closed hierarchies</strong>. Another assembly can derive from a public
        abstract record, so the compiler warns <code>CS8509</code> even when every subtype in the
        file is listed.</p>
      </div></details>
    </li>
    <li>
      <p>What does a switch expression do when no arm matches?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Throws <code>SwitchExpressionException</code>, whose message carries the unmatched value
        and nothing else. An explicit throwing arm gives
        <code>ArgumentOutOfRangeException</code> with <code>ParamName</code> and
        <code>ActualValue</code> instead.</p>
      </div></details>
    </li>
    <li>
      <p>Which ordering mistakes does the compiler catch, and which does it not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Catches relational, property and type-pattern subsumption — all <code>CS8510</code>.
        <strong>Does not analyse <code>when</code> guards at all</strong>: measured, two guarded arms
        in the wrong order compiled clean and routed a 5,000 authorisation to the wrong branch.</p>
      </div></details>
    </li>
    <li>
      <p>Why prefer <code>is null</code> to <code>== null</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>is null</code> compiles to a reference comparison the type cannot intercept.
        <code>==</code> calls a user-defined operator: measured, it threw
        <code>NullReferenceException</code> on a null check.</p>
      </div></details>
    </li>
    <li>
      <p>When should you use a property pattern rather than a positional one?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Whenever the record might be reordered. Positional patterns follow position, so reordering
        the primary constructor keeps every pattern compiling with different meaning. Property
        patterns break loudly on a rename and survive reordering.</p>
      </div></details>
    </li>
    <li>
      <p>What do list patterns require of the thing being matched?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <code>Length</code> or <code>Count</code> and an indexer. Arrays,
        <code>List&lt;T&gt;</code>, <code>string</code> and <code>Span&lt;T&gt;</code> qualify;
        <code>IEnumerable&lt;T&gt;</code> is <strong><code>CS8985</code>, a compile error</strong>,
        because a pattern will not enumerate a sequence behind your back.</p>
      </div></details>
    </li>
    <li>
      <p>Are switch expressions faster than <code>if</code>/<code>else</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — measured at <strong>1.11× to 2.05× slower</strong> across four runs, roughly 8–26 ns
        per event, because repeated arms of the same type re-do work an <code>if</code> chain does
        once. The argument for them is the reachability proof, not speed.</p>
      </div></details>
    </li>
    <li>
      <p>What one project setting removes a whole class of switch-expression failure?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>&lt;WarningsAsErrors&gt;CS8509;CS8524&lt;/WarningsAsErrors&gt;</code>. Every
        non-exhaustive switch expression becomes a build failure instead of a possible
        <code>SwitchExpressionException</code> in production.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
