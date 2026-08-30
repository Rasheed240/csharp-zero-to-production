/* ============================================================================
   Track 1, Module 24 — LINQ: Both Syntaxes
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every result in this module was compiled and run on
   .NET 10.0.400 (runtime 10.0.11), Windows 11 x64.
   The runnable sources are in verification/t1-24-linq-fundamentals/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-24-linq-fundamentals",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "Query syntax is rewritten into method calls before anything else happens, so the two forms " +
    "produce the same program and even the same runtime type. What each is good at follows from " +
    "that: query syntax is worth it exactly where the compiler writes anonymous types for you, " +
    "and method syntax everywhere else — including the many operators query syntax cannot say.",
  terms: [
    "LINQ", "query syntax", "method syntax", "query expression", "lowering",
    "range variable", "let clause", "standard query operator", "projection",
    "filtering", "ordering", "grouping", "join", "anonymous type",
    "composite key", "Single", "First", "OrDefault"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A codebase contains two styles for the same operation. One team writes
  <code>from o in orders where o.Amount &gt; 100 select o.Id</code>; another writes
  <code>orders.Where(o =&gt; o.Amount &gt; 100).Select(o =&gt; o.Id)</code>. A style argument
  follows, in which neither side can say what the actual difference is, because there is no
  performance difference and no behavioural difference to appeal to.</p>

  <p>Elsewhere, a report needs a join, an intermediate calculation, a grouping and an ordering.
  Written in method syntax it becomes four anonymous types carrying values forward, each one
  existing only so the next step can reach a value computed two steps earlier. The query is correct
  and nobody can read it.</p>

  <p>And a lookup uses <code>First</code> where the data guarantees one match. Six months later the
  data no longer guarantees it, a second row appears, and the code silently picks whichever came
  first — producing wrong output rather than an error.</p>

  <p>This module is about what LINQ actually is, what the two syntaxes are for, and which operator
  choices are correctness decisions rather than preferences. The <em>cost</em> of LINQ — what a
  query allocates and when it runs — is the next module's subject;
  <a href="#/m/t1-20-ienumerable-vs-icollection">IEnumerable vs ICollection vs IList vs
  IReadOnly*</a> has already covered the part about return types.</p>
</section>

<section id="what-linq-is">
  <h2>What LINQ actually is</h2>

  <p class="define"><span class="define__term">LINQ</span> A set of extension methods on
  <code>IEnumerable&lt;T&gt;</code> — <code>Where</code>, <code>Select</code>,
  <code>OrderBy</code> and about fifty others — plus a query syntax that the compiler rewrites into
  calls to them. Language Integrated Query: the query is written in C# and checked by the C#
  compiler.</p>

  <p class="define"><span class="define__term">Query syntax</span> The <code>from … where …
  select</code> form. <span class="define__term">Method syntax</span> the
  <code>.Where(...).Select(...)</code> form. They are not two libraries or two mechanisms.</p>

  <p class="define"><span class="define__term">Lowering</span> What the compiler does to query
  syntax: rewrites it into method calls before any other stage of compilation. By the time the code
  is checked for types, the query expression no longer exists.</p>

  <p>The analogy: query syntax is shorthand in the same sense that <code>foreach</code> is shorthand
  for calling <code>GetEnumerator</code> and <code>MoveNext</code>. <strong>The analogy is exact
  rather than approximate</strong>, which is unusual — there is genuinely nothing left of the query
  form after compilation, and the two spellings produce identical IL.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-two-syntaxes.cs"><code>// 01-two-syntaxes.cs — query syntax is rewritten into method calls before
// anything else happens. The two forms are the same program.
// .NET 10.0.400. Run: dotnet run 01-two-syntaxes.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct Order(string Id, string Region, decimal Amount, int Year);

class Program
{
    static readonly Order[] Orders =
    {
        new("O-1", "eu-west", 120.00m, 2025),
        new("O-2", "us-east",  45.50m, 2026),
        new("O-3", "eu-west", 800.00m, 2026),
        new("O-4", "ap-south", 12.00m, 2025),
        new("O-5", "eu-west", 300.00m, 2026),
        new("O-6", "us-east", 950.00m, 2026)
    };

    static void Main()
    {
        Console.WriteLine("--- where + orderby + select ---");
        var query =
            from o in Orders
            where o.Amount &gt;= 100m
            orderby o.Amount descending
            select o.Id;

        var method = Orders
            .Where(o =&gt; o.Amount &gt;= 100m)
            .OrderByDescending(o =&gt; o.Amount)
            .Select(o =&gt; o.Id);

        Console.WriteLine($"  query syntax  : {string.Join(", ", query)}");
        Console.WriteLine($"  method syntax : {string.Join(", ", method)}");
        Console.WriteLine($"  identical     : {query.SequenceEqual(method)}");

        Console.WriteLine();
        Console.WriteLine("--- the runtime types are the same too ---");
        Console.WriteLine($"  query  : {query.GetType().Name}");
        Console.WriteLine($"  method : {method.GetType().Name}");

        Console.WriteLine();
        Console.WriteLine("--- 'let' introduces a range variable ---");
        var withLet =
            from o in Orders
            let withVat = o.Amount * 1.20m
            where withVat &gt; 500m
            select $"{o.Id}={withVat:0.00}";

        var withLetAsMethods = Orders
            .Select(o =&gt; new { o, withVat = o.Amount * 1.20m })
            .Where(x =&gt; x.withVat &gt; 500m)
            .Select(x =&gt; $"{x.o.Id}={x.withVat:0.00}");

        Console.WriteLine($"  query  : {string.Join(", ", withLet)}");
        Console.WriteLine($"  method : {string.Join(", ", withLetAsMethods)}");
        Console.WriteLine("  'let' compiles to a Select producing an anonymous type that carries");
        Console.WriteLine("  both the original item and the new value forward.");

        Console.WriteLine();
        Console.WriteLine("--- group by ---");
        var grouped =
            from o in Orders
            group o by o.Region into g
            orderby g.Key
            select $"{g.Key}={g.Count()}";

        var groupedAsMethods = Orders
            .GroupBy(o =&gt; o.Region)
            .OrderBy(g =&gt; g.Key)
            .Select(g =&gt; $"{g.Key}={g.Count()}");

        Console.WriteLine($"  query  : {string.Join(", ", grouped)}");
        Console.WriteLine($"  method : {string.Join(", ", groupedAsMethods)}");

        Console.WriteLine();
        Console.WriteLine("--- join ---");
        var regions = new[]
        {
            ("eu-west", "Europe"), ("us-east", "Americas"), ("ap-south", "Asia")
        };

        var joined =
            from o in Orders
            join r in regions on o.Region equals r.Item1
            where o.Amount &gt; 100m
            select $"{o.Id}:{r.Item2}";

        var joinedAsMethods = Orders
            .Join(regions, o =&gt; o.Region, r =&gt; r.Item1, (o, r) =&gt; new { o, r })
            .Where(x =&gt; x.o.Amount &gt; 100m)
            .Select(x =&gt; $"{x.o.Id}:{x.r.Item2}");

        Console.WriteLine($"  query  : {string.Join(", ", joined)}");
        Console.WriteLine($"  method : {string.Join(", ", joinedAsMethods)}");

        Console.WriteLine();
        Console.WriteLine("--- what query syntax CANNOT express ---");
        Console.WriteLine($"  Count()        : {Orders.Count(o =&gt; o.Amount &gt; 100m)}");
        const string eu = "eu-west";
        Console.WriteLine($"  Any()          : {Orders.Any(o =&gt; o.Region == eu)}");
        Console.WriteLine($"  First()        : {Orders.First(o =&gt; o.Year == 2026).Id}");
        Console.WriteLine($"  Sum()          : {Orders.Sum(o =&gt; o.Amount):0.00}");
        Console.WriteLine($"  Skip/Take      : {string.Join(", ", Orders.Skip(2).Take(2).Select(o =&gt; o.Id))}");
        Console.WriteLine($"  Distinct()     : {string.Join(", ", Orders.Select(o =&gt; o.Region).Distinct())}");
        Console.WriteLine("  None of these have query-syntax keywords. A query expression that");
        Console.WriteLine("  needs one is wrapped in parentheses and a method call is appended.");

        Console.WriteLine();
        var mixed = (from o in Orders where o.Year == 2026 select o.Amount).Sum();
        Console.WriteLine($"  mixing the two : {mixed:0.00}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- where + orderby + select ---
  query syntax  : O-6, O-3, O-5, O-1
  method syntax : O-6, O-3, O-5, O-1
  identical     : True

--- the runtime types are the same too ---
  query  : IEnumerableSelectIterator&amp;#96;2
  method : IEnumerableSelectIterator&amp;#96;2

--- 'let' introduces a range variable ---
  query  : O-3=960.00, O-6=1140.00
  method : O-3=960.00, O-6=1140.00
  'let' compiles to a Select producing an anonymous type that carries
  both the original item and the new value forward.

--- group by ---
  query  : ap-south=1, eu-west=3, us-east=2
  method : ap-south=1, eu-west=3, us-east=2

--- join ---
  query  : O-1:Europe, O-3:Europe, O-5:Europe, O-6:Americas
  method : O-1:Europe, O-3:Europe, O-5:Europe, O-6:Americas

--- what query syntax CANNOT express ---
  Count()        : 4
  Any()          : True
  First()        : O-2
  Sum()          : 2227.50
  Skip/Take      : O-3, O-4
  Distinct()     : eu-west, us-east, ap-south
  None of these have query-syntax keywords. A query expression that
  needs one is wrapped in parentheses and a method call is appended.

  mixing the two : 2095.50</code></pre>

  <p><strong>The runtime types are identical.</strong> Both forms produced an
  <code>IEnumerableSelectIterator</code> — not merely equivalent results but the same object graph,
  because the compiler produced the same calls. That single line settles the style argument on
  facts: there is no performance difference, no behavioural difference, and no difference a
  debugger can see.</p>

  <p class="define"><span class="define__term">Query expression</span> The whole <code>from …
  select</code> form, from the first <code>from</code> to the final <code>select</code> or
  <code>group</code>. A query expression is an expression like any other: it has a type, it can be
  assigned to a variable, and it must end in <code>select</code> or <code>group</code>.</p>

  <p class="define"><span class="define__term">Range variable</span> The identifier introduced by
  <code>from o in orders</code>. It is not a variable in the ordinary sense — it becomes the
  parameter of the lambdas the compiler generates, which is why it is in scope for the whole query
  and why it cannot be assigned to.</p>

  <p>The mapping is mechanical:</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Query clause</th><th>Lowers to</th></tr></thead>
    <tbody>
      <tr><td><code>from o in xs</code></td><td>the source; no call of its own</td></tr>
      <tr><td><code>where p</code></td><td><code>.Where(o =&gt; p)</code></td></tr>
      <tr><td><code>select e</code></td><td><code>.Select(o =&gt; e)</code></td></tr>
      <tr><td><code>orderby a, b descending</code></td>
          <td><code>.OrderBy(o =&gt; a).ThenByDescending(o =&gt; b)</code></td></tr>
      <tr><td><code>let v = e</code></td>
          <td><code>.Select(o =&gt; new { o, v = e })</code> — an anonymous type</td></tr>
      <tr><td><code>join r in ys on a equals b</code></td><td><code>.Join(ys, …)</code></td></tr>
      <tr><td><code>group o by k into g</code></td><td><code>.GroupBy(o =&gt; k)</code></td></tr>
      <tr><td><code>from a in xs from b in ys</code></td><td><code>.SelectMany(…)</code></td></tr>
    </tbody>
  </table>
  </div>

  <p><strong>The <code>let</code> row is the one that explains when query syntax earns its
  place.</strong> Writing <code>let withVat = o.Amount * 1.20m</code> makes the compiler generate an
  anonymous type carrying both the original item and the new value forward, so later clauses can
  reach either. The method-syntax equivalent requires writing that anonymous type by hand — and then
  every subsequent step has to unpack it. The measured output confirms the two are identical; what
  differs is how much bookkeeping you write.</p>
</section>

<section id="operators">
  <h2>The operators, grouped by what they return</h2>

  <p>There are roughly fifty standard query operators, and remembering them individually is not the
  goal. <strong>One distinction predicts most of their behaviour: whether an operator returns a
  sequence or a value.</strong></p>

  <pre data-lang="csharp" data-net="10" data-title="02-operator-families.cs"><code>// 02-operator-families.cs — the standard operators grouped by what they DO,
// and the one distinction that predicts most of their behaviour: whether an
// operator returns a sequence or a value.
// .NET 10.0.400. Run: dotnet run 02-operator-families.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct Sale(string Rep, string Region, decimal Amount);

class Program
{
    static readonly Sale[] Sales =
    {
        new("ada",   "eu", 120m), new("grace", "eu", 300m),
        new("ada",   "us", 450m), new("linus", "eu",  80m),
        new("grace", "us", 900m), new("ada",   "eu", 220m)
    };

    static void Main()
    {
        Console.WriteLine("--- returns a SEQUENCE (deferred) ---");
        Show("Where", Sales.Where(s =&gt; s.Amount &gt; 200m).Select(s =&gt; s.Rep));
        Show("Select", Sales.Select(s =&gt; s.Rep));
        Show("OrderBy", Sales.OrderBy(s =&gt; s.Amount).Select(s =&gt; s.Amount.ToString("0")));
        Show("ThenBy", Sales.OrderBy(s =&gt; s.Region).ThenByDescending(s =&gt; s.Amount)
                            .Select(s =&gt; $"{s.Region}:{s.Amount:0}"));
        Show("Distinct", Sales.Select(s =&gt; s.Rep).Distinct());
        Show("Skip/Take", Sales.Skip(1).Take(3).Select(s =&gt; s.Rep));
        Show("Concat", Sales.Take(1).Concat(Sales.TakeLast(1)).Select(s =&gt; s.Rep));
        Show("SelectMany", Sales.Take(2).SelectMany(s =&gt; s.Rep.ToCharArray()).Select(c =&gt; c.ToString()));
        Show("Reverse", Sales.Select(s =&gt; s.Rep).Reverse());

        Console.WriteLine();
        Console.WriteLine("--- returns a VALUE (executes immediately) ---");
        Console.WriteLine($"  {"Count",-14} {Sales.Count()}");
        Console.WriteLine($"  {"Count(pred)",-14} {Sales.Count(s =&gt; s.Region == "eu")}");
        Console.WriteLine($"  {"Sum",-14} {Sales.Sum(s =&gt; s.Amount):0.00}");
        Console.WriteLine($"  {"Average",-14} {Sales.Average(s =&gt; s.Amount):0.00}");
        Console.WriteLine($"  {"Min / Max",-14} {Sales.Min(s =&gt; s.Amount):0} / {Sales.Max(s =&gt; s.Amount):0}");
        Console.WriteLine($"  {"Any",-14} {Sales.Any(s =&gt; s.Amount &gt; 800m)}");
        Console.WriteLine($"  {"All",-14} {Sales.All(s =&gt; s.Amount &gt; 50m)}");
        Console.WriteLine($"  {"First",-14} {Sales.First(s =&gt; s.Region == "us").Rep}");
        Console.WriteLine($"  {"FirstOrDefault",-14} {Sales.FirstOrDefault(s =&gt; s.Amount &gt; 9999m).Rep ?? "(default)"}");
        Console.WriteLine($"  {"Single",-14} {Sales.Single(s =&gt; s.Amount == 900m).Rep}");
        Console.WriteLine($"  {"Aggregate",-14} {Sales.Aggregate(0m, (acc, s) =&gt; acc + s.Amount):0.00}");
        Console.WriteLine($"  {"Contains",-14} {Sales.Select(s =&gt; s.Rep).Contains("linus")}");

        Console.WriteLine();
        Console.WriteLine("--- returns a COLLECTION (executes immediately) ---");
        Console.WriteLine($"  ToList     : {Sales.Select(s =&gt; s.Rep).ToList().Count} items");
        Console.WriteLine($"  ToArray    : {Sales.Select(s =&gt; s.Rep).ToArray().Length} items");
        Console.WriteLine($"  ToHashSet  : {Sales.Select(s =&gt; s.Rep).ToHashSet().Count} distinct");
        Console.WriteLine($"  ToDictionary: {Sales.GroupBy(s =&gt; s.Rep).ToDictionary(g =&gt; g.Key, g =&gt; g.Sum(x =&gt; x.Amount)).Count} keys");

        Console.WriteLine();
        Console.WriteLine("--- grouping and joining ---");
        foreach (var g in Sales.GroupBy(s =&gt; s.Rep).OrderBy(g =&gt; g.Key))
            Console.WriteLine($"  {g.Key,-6} count={g.Count()} total={g.Sum(s =&gt; s.Amount):0}");

        Console.WriteLine();
        Console.WriteLine("--- the Single/First distinction, which is a correctness choice ---");
        Console.WriteLine($"  First  on 3 eu sales : {Sales.First(s =&gt; s.Region == "eu").Rep}");
        try
        {
            Console.WriteLine($"  Single on 3 eu sales : {Sales.Single(s =&gt; s.Region == "eu").Rep}");
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  Single on 3 eu sales : {ex.GetType().Name} — {ex.Message}");
        }
        Console.WriteLine("  Single ASSERTS there is exactly one. First takes whatever comes.");
        Console.WriteLine("  Choosing First to avoid an exception hides a broken assumption.");
    }

    static void Show(string name, IEnumerable&lt;string&gt; result) =&gt;
        Console.WriteLine($"  {name,-14} {string.Join(", ", result)}");
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- returns a SEQUENCE (deferred) ---
  Where          grace, ada, grace, ada
  Select         ada, grace, ada, linus, grace, ada
  OrderBy        80, 120, 220, 300, 450, 900
  ThenBy         eu:300, eu:220, eu:120, eu:80, us:900, us:450
  Distinct       ada, grace, linus
  Skip/Take      grace, ada, linus
  Concat         ada, ada
  SelectMany     a, d, a, g, r, a, c, e
  Reverse        ada, grace, linus, ada, grace, ada

--- returns a VALUE (executes immediately) ---
  Count          6
  Count(pred)    4
  Sum            2070.00
  Average        345.00
  Min / Max      80 / 900
  Any            True
  All            True
  First          ada
  FirstOrDefault (default)
  Single         grace
  Aggregate      2070.00
  Contains       True

--- returns a COLLECTION (executes immediately) ---
  ToList     : 6 items
  ToArray    : 6 items
  ToHashSet  : 3 distinct
  ToDictionary: 3 keys

--- grouping and joining ---
  ada    count=3 total=790
  grace  count=2 total=1200
  linus  count=1 total=80

--- the Single/First distinction, which is a correctness choice ---
  First  on 3 eu sales : ada
  Single on 3 eu sales : InvalidOperationException — Sequence contains more than one matching element
  Single ASSERTS there is exactly one. First takes whatever comes.
  Choosing First to avoid an exception hides a broken assumption.</code></pre>

  <p class="define"><span class="define__term">Projection</span> Producing a new shape from each
  element — what <code>Select</code> does. <span class="define__term">Filtering</span> keeping only
  elements matching a predicate, which is <code>Where</code>. The two words come up constantly in
  documentation and both name a single operator.</p>

  <p class="define"><span class="define__term">Standard query operator</span> One of the extension
  methods LINQ provides. They fall into three groups by return type, and the group tells you when
  the work happens — which is why this classification matters more than the individual names.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Returns</th><th>Examples</th><th>When it runs</th></tr></thead>
    <tbody>
      <tr><td><code>IEnumerable&lt;T&gt;</code></td>
          <td><code>Where</code>, <code>Select</code>, <code>OrderBy</code>,
          <code>Distinct</code>, <code>Skip</code>, <code>Take</code>,
          <code>SelectMany</code>, <code>GroupBy</code></td>
          <td><strong>Later</strong> — when something iterates it.</td></tr>
      <tr><td>a single value</td>
          <td><code>Count</code>, <code>Sum</code>, <code>Any</code>, <code>First</code>,
          <code>Single</code>, <code>Aggregate</code>, <code>Contains</code></td>
          <td><strong>Immediately</strong> — it has to, to produce the value.</td></tr>
      <tr><td>a collection</td>
          <td><code>ToList</code>, <code>ToArray</code>, <code>ToHashSet</code>,
          <code>ToDictionary</code></td>
          <td><strong>Immediately</strong>, and materialises the whole thing.</td></tr>
    </tbody>
  </table>
  </div>

  <p>That grouping is the same distinction <a href="#/m/t1-20-ienumerable-vs-icollection">IEnumerable
  vs ICollection vs IList vs IReadOnly*</a> drew from the interface side: an operator returning
  <code>IEnumerable&lt;T&gt;</code> is handing back a recipe, and one returning a count or a list has
  had to do the work. <a href="#/m/t1-25-deferred-execution">Deferred Execution and the Cost of
  LINQ</a> measures the consequences.</p>

  <div class="callout callout--gotcha">
    <p><strong><code>Single</code> versus <code>First</code> is a correctness decision, not a
    preference.</strong> <code>First</code> takes whatever comes and is right when several matches
    are expected and any will do. <code>Single</code> <em>asserts</em> that exactly one exists and
    throws if not — which is what you want whenever the data model guarantees uniqueness, because
    the exception tells you the guarantee has broken. Reaching for <code>First</code> to avoid an
    exception converts a loud, findable defect into silently choosing an arbitrary row, which is
    the third incident at the top of this module.</p>
  </div>

  <p>The <code>OrDefault</code> variants add a third case: return the type's default instead of
  throwing when there is no match. For a reference type that is <code>null</code>; for a struct it
  is <code>default(T)</code>, which is a value that no constructor produced — the trap from
  <a href="#/m/t1-15-structs-and-records">Structs, Records, readonly, and init</a>, arriving through
  LINQ. Exercise 3 measures it.</p>
</section>

<section id="production-example">
  <h2>Choosing between them</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// 03-production.cs — a reporting query written in both syntaxes, with the
// choice made on readability rather than habit.
// .NET 10.0.400. Run: dotnet run 03-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct Order(string Id, string CustomerId, string Region,
                                    decimal Amount, DateOnly Placed);
public readonly record struct Customer(string Id, string Name, string Tier);

class Program
{
    static readonly Customer[] Customers =
    {
        new("C-1", "Ada",   "gold"),
        new("C-2", "Grace", "silver"),
        new("C-3", "Linus", "gold"),
        new("C-4", "Edsger","bronze")
    };

    static readonly Order[] Orders =
    {
        new("O-1", "C-1", "eu", 120.00m, new(2026, 1, 15)),
        new("O-2", "C-2", "eu", 450.00m, new(2026, 2, 3)),
        new("O-3", "C-1", "us", 800.00m, new(2026, 2, 20)),
        new("O-4", "C-3", "eu",  95.00m, new(2026, 3, 1)),
        new("O-5", "C-1", "eu", 300.00m, new(2026, 3, 12)),
        new("O-6", "C-2", "us", 950.00m, new(2026, 3, 28)),
        new("O-7", "C-4", "eu",  20.00m, new(2026, 4, 2))
    };

    static void Main()
    {
        Console.WriteLine("--- a multi-source report: query syntax reads better ---");
        var report =
            from o in Orders
            join c in Customers on o.CustomerId equals c.Id
            where o.Amount &gt;= 100m &amp;&amp; c.Tier != "bronze"
            let withVat = o.Amount * 1.20m
            group new { c.Name, withVat } by c.Name into byCustomer
            let total = byCustomer.Sum(x =&gt; x.withVat)
            orderby total descending
            select new { Customer = byCustomer.Key, Orders = byCustomer.Count(), Total = total };

        foreach (var row in report)
            Console.WriteLine($"  {row.Customer,-8} orders={row.Orders} total={row.Total:0.00}");

        Console.WriteLine();
        Console.WriteLine("--- the same thing in method syntax ---");
        var reportMethods = Orders
            .Join(Customers, o =&gt; o.CustomerId, c =&gt; c.Id, (o, c) =&gt; new { o, c })
            .Where(x =&gt; x.o.Amount &gt;= 100m &amp;&amp; x.c.Tier != "bronze")
            .Select(x =&gt; new { x.c.Name, withVat = x.o.Amount * 1.20m })
            .GroupBy(x =&gt; x.Name)
            .Select(g =&gt; new { Customer = g.Key, Orders = g.Count(), Total = g.Sum(x =&gt; x.withVat) })
            .OrderByDescending(x =&gt; x.Total);

        foreach (var row in reportMethods)
            Console.WriteLine($"  {row.Customer,-8} orders={row.Orders} total={row.Total:0.00}");

        Console.WriteLine();
        Console.WriteLine($"  identical: {report.SequenceEqual(reportMethods)}");
        Console.WriteLine("  The join and the two 'let' bindings are what make query syntax");
        Console.WriteLine("  clearer here: the method version needs anonymous types to carry");
        Console.WriteLine("  values forward, which the compiler writes for you in the first.");

        Console.WriteLine();
        Console.WriteLine("--- a single-operation query: method syntax reads better ---");
        Console.WriteLine($"  total for March : " +
            $"{Orders.Where(o =&gt; o.Placed.Month == 3).Sum(o =&gt; o.Amount):0.00}");
        Console.WriteLine($"  as a query      : " +
            $"{(from o in Orders where o.Placed.Month == 3 select o.Amount).Sum():0.00}");
        Console.WriteLine("  The query form needs parentheses and a trailing method call, which");
        Console.WriteLine("  is a signal that the expression wanted to be method syntax.");

        Console.WriteLine();
        Console.WriteLine("--- grouping with a composite key ---");
        var byRegionMonth =
            from o in Orders
            group o by new { o.Region, o.Placed.Month } into g
            orderby g.Key.Region, g.Key.Month
            select $"{g.Key.Region}/{g.Key.Month}: {g.Sum(x =&gt; x.Amount):0}";
        Console.WriteLine($"  {string.Join(" | ", byRegionMonth)}");
        Console.WriteLine("  An anonymous type as a key works because records and anonymous");
        Console.WriteLine("  types have value equality — the rule from the equality module.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- a multi-source report: query syntax reads better ---
  Grace    orders=2 total=1680.00
  Ada      orders=3 total=1464.00

--- the same thing in method syntax ---
  Grace    orders=2 total=1680.00
  Ada      orders=3 total=1464.00

  identical: True
  The join and the two 'let' bindings are what make query syntax
  clearer here: the method version needs anonymous types to carry
  values forward, which the compiler writes for you in the first.

--- a single-operation query: method syntax reads better ---
  total for March : 1345.00
  as a query      : 1345.00
  The query form needs parentheses and a trailing method call, which
  is a signal that the expression wanted to be method syntax.

--- grouping with a composite key ---
  eu/1: 120 | eu/2: 450 | eu/3: 395 | eu/4: 20 | us/2: 800 | us/3: 950
  An anonymous type as a key works because records and anonymous
  types have value equality — the rule from the equality module.</code></pre>

  <p class="define"><span class="define__term">Anonymous type</span> The type the compiler generates
  for <code>new { a, b }</code>. It has no name you can write, read-only properties named after the
  members, and generated value equality over all of them.
  <span class="define__term">Composite key</span> a grouping or dictionary key built from more than
  one value — in LINQ, almost always an anonymous type or a record.</p>

  <p>The two versions produce identical output, so the choice is entirely about which one a reader
  can follow. Three signals decide it reliably.</p>

  <p><strong>A join favours query syntax.</strong> <code>join c in Customers on o.CustomerId equals
  c.Id</code> says what it does. The method form is
  <code>.Join(Customers, o =&gt; o.CustomerId, c =&gt; c.Id, (o, c) =&gt; new { o, c })</code> —
  four arguments, one of which exists only to package the two sides together for the next step.</p>

  <p><strong>An intermediate value favours query syntax.</strong> Each <code>let</code> is one line;
  each equivalent in method syntax is an anonymous type that every subsequent step must unpack.
  With two <code>let</code> bindings the method version carries the bookkeeping through five
  operators.</p>

  <p><strong>One or two operations favour method syntax.</strong> The March total needs a
  <code>Where</code> and a <code>Sum</code>. In query syntax it becomes a parenthesised expression
  with <code>.Sum()</code> appended — and that appended call is the signal: the query wanted to end
  in an operator query syntax cannot say.</p>

  <div class="callout callout--note">
    <p><strong>The composite key works because of value equality.</strong> Grouping by
    <code>new { o.Region, o.Placed.Month }</code> relies on anonymous types having generated
    <code>Equals</code> and <code>GetHashCode</code> over their members — exactly the machinery in
    <a href="#/m/t1-15-structs-and-records">Structs, Records, readonly, and init</a> and
    <a href="#/m/t1-16-equality-and-hashing">Equality, GetHashCode, and Comparers</a>. And it
    inherits the same limitation: a composite key containing a <code>List</code> compares by
    reference and will never group anything together.</p>
  </div>
</section>

<section id="joins">
  <h2>The clauses that only query syntax says well</h2>

  <p>Three constructs account for most of the queries that are painful in method syntax. All three
  come up in the first week of writing reports against real data, and two of them have a trap that
  loses rows silently.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-joins-and-flattening.cs"><code>// 05-joins-and-flattening.cs — the three clauses that have no simple method-syntax
// shorthand: multiple &#96;from&#96; (SelectMany), &#96;join ... into&#96; (group join), and the
// left-outer-join idiom built from a group join plus DefaultIfEmpty.
// .NET 10.0.400. Run: dotnet run 05-joins-and-flattening.cs

using System;
using System.Collections.Generic;
using System.Linq;

record Customer(int Id, string Name);
record Order(string Ref, int CustomerId, decimal Amount);

class Program
{
    static readonly Customer[] Customers =
    {
        new(1, "Ada"), new(2, "Grace"), new(3, "Linus")   // Linus has no orders
    };

    static readonly Order[] Orders =
    {
        new("O-1", 1, 120m), new("O-2", 1, 300m),
        new("O-3", 2, 450m), new("O-4", 9,  80m)          // customer 9 does not exist
    };

    static void Main()
    {
        Console.WriteLine("--- multiple &#96;from&#96; clauses flatten: this is SelectMany ---");

        var pairsQuery = from c in Customers
                         from o in Orders
                         where o.CustomerId == c.Id
                         select $"{c.Name}/{o.Ref}";

        var pairsMethod = Customers
            .SelectMany(c =&gt; Orders, (c, o) =&gt; new { c, o })
            .Where(x =&gt; x.o.CustomerId == x.c.Id)
            .Select(x =&gt; $"{x.c.Name}/{x.o.Ref}");

        Console.WriteLine($"  query  : {string.Join(", ", pairsQuery)}");
        Console.WriteLine($"  method : {string.Join(", ", pairsMethod)}");
        Console.WriteLine($"  equal  : {pairsQuery.SequenceEqual(pairsMethod)}");
        Console.WriteLine("  Two &#96;from&#96; clauses produce every pair, then Where discards");
        Console.WriteLine("  the ones that do not match. That is a cross join filtered");
        Console.WriteLine($"  after the fact: {Customers.Length} x {Orders.Length} = " +
                          $"{Customers.Length * Orders.Length} pairs considered.");

        var joinPairs = from c in Customers
                        join o in Orders on c.Id equals o.CustomerId
                        select $"{c.Name}/{o.Ref}";
        Console.WriteLine($"  join   : {string.Join(", ", joinPairs)}");
        Console.WriteLine("  &#96;join&#96; produces the same rows by building a lookup on the");
        Console.WriteLine("  key first, so it does not consider every pair.");

        Console.WriteLine();
        Console.WriteLine("--- &#96;into&#96; continues a query with a new range variable ---");

        var totals = from o in Orders
                     group o by o.CustomerId into g
                     where g.Count() &gt; 1
                     select $"customer {g.Key}: {g.Count()} orders, {g.Sum(x =&gt; x.Amount):0.00}";
        Console.WriteLine($"  group..into : {string.Join(" | ", totals)}");
        Console.WriteLine("  Without &#96;into&#96;, &#96;group by&#96; must end the query. &#96;into g&#96;");
        Console.WriteLine("  makes g the new range variable so more clauses can follow.");

        Console.WriteLine();
        Console.WriteLine("--- &#96;join ... into&#96; is a GROUP join, not the same as &#96;join&#96; ---");

        var grouped = from c in Customers
                      join o in Orders on c.Id equals o.CustomerId into cOrders
                      select $"{c.Name}={cOrders.Count()}";
        Console.WriteLine($"  group join : {string.Join(", ", grouped)}");
        Console.WriteLine("  Every customer appears exactly once, with a (possibly empty)");
        Console.WriteLine("  sequence of matches. Linus is present with 0.");

        var inner = from c in Customers
                    join o in Orders on c.Id equals o.CustomerId
                    select c.Name;
        Console.WriteLine($"  plain join : {string.Join(", ", inner)}");
        Console.WriteLine("  Linus is absent entirely, and Ada appears twice: one row");
        Console.WriteLine("  per match. That is the difference the &#96;into&#96; makes.");

        Console.WriteLine();
        Console.WriteLine("--- left outer join = group join + DefaultIfEmpty ---");

        var leftOuter = from c in Customers
                        join o in Orders on c.Id equals o.CustomerId into cOrders
                        from o in cOrders.DefaultIfEmpty()
                        select $"{c.Name}/{o?.Ref ?? "(none)"}";
        Console.WriteLine($"  left outer : {string.Join(", ", leftOuter)}");
        Console.WriteLine("  DefaultIfEmpty yields default(T) for an empty group, so a");
        Console.WriteLine("  customer with no orders still produces one row — and o is");
        Console.WriteLine("  null there, which is why the projection must handle it.");

        Console.WriteLine();
        Console.WriteLine("--- what neither join finds ---");
        var orphan = Orders.Where(o =&gt; !Customers.Any(c =&gt; c.Id == o.CustomerId));
        Console.WriteLine($"  orders with no customer : {string.Join(", ", orphan.Select(o =&gt; o.Ref))}");
        Console.WriteLine("  A left join keyed on the customer side cannot show these.");
        Console.WriteLine("  Neither can an inner join. Rows dropped by a join are");
        Console.WriteLine("  invisible unless you look for them deliberately.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- multiple &amp;#96;from&amp;#96; clauses flatten: this is SelectMany ---
  query  : Ada/O-1, Ada/O-2, Grace/O-3
  method : Ada/O-1, Ada/O-2, Grace/O-3
  equal  : True
  Two &amp;#96;from&amp;#96; clauses produce every pair, then Where discards
  the ones that do not match. That is a cross join filtered
  after the fact: 3 x 4 = 12 pairs considered.
  join   : Ada/O-1, Ada/O-2, Grace/O-3
  &amp;#96;join&amp;#96; produces the same rows by building a lookup on the
  key first, so it does not consider every pair.

--- &amp;#96;into&amp;#96; continues a query with a new range variable ---
  group..into : customer 1: 2 orders, 420.00
  Without &amp;#96;into&amp;#96;, &amp;#96;group by&amp;#96; must end the query. &amp;#96;into g&amp;#96;
  makes g the new range variable so more clauses can follow.

--- &amp;#96;join ... into&amp;#96; is a GROUP join, not the same as &amp;#96;join&amp;#96; ---
  group join : Ada=2, Grace=1, Linus=0
  Every customer appears exactly once, with a (possibly empty)
  sequence of matches. Linus is present with 0.
  plain join : Ada, Ada, Grace
  Linus is absent entirely, and Ada appears twice: one row
  per match. That is the difference the &amp;#96;into&amp;#96; makes.

--- left outer join = group join + DefaultIfEmpty ---
  left outer : Ada/O-1, Ada/O-2, Grace/O-3, Linus/(none)
  DefaultIfEmpty yields default(T) for an empty group, so a
  customer with no orders still produces one row — and o is
  null there, which is why the projection must handle it.

--- what neither join finds ---
  orders with no customer : O-4
  A left join keyed on the customer side cannot show these.
  Neither can an inner join. Rows dropped by a join are
  invisible unless you look for them deliberately.</code></pre>

  <h3>Two <code>from</code> clauses are not a join</h3>

  <p class="define"><span class="define__term">SelectMany</span> The operator two consecutive
  <code>from</code> clauses lower to. It takes each element of the first sequence, produces a
  sequence from it, and flattens all of those into one — which is why it is also the operator behind
  <code>from c in customers from ch in c.Name</code> turning objects into characters.</p>

  <p>The measured result is the important part: the two-<code>from</code> version and the
  <code>join</code> version produced <strong>identical rows</strong>, but the first considered
  <strong>3 × 4 = 12 pairs</strong> and discarded nine of them. <code>join</code> builds a lookup
  keyed on <code>c.Id</code> and consults it once per customer.</p>

  <p>On three customers and four orders the difference is invisible. On 10,000 of each it is
  100 million pair evaluations against roughly 20,000 — the difference between a report that returns
  and one that does not. <strong>Two <code>from</code> clauses with a <code>where</code> comparing
  them is a join written the expensive way</strong>, and it is one of the most common shapes in
  hand-written LINQ because it reads naturally.</p>

  <h3><code>into</code> continues a query</h3>

  <p class="define"><span class="define__term"><code>into</code></span> A query continuation: it ends
  the current query, gives the result a new range variable, and starts a fresh set of clauses over
  it. <code>group … by … into g</code> is the common case, because a <code>group</code> clause
  otherwise has to be the last thing in the query.</p>

  <p>Without <code>into</code>, <code>group o by o.CustomerId</code> must end the query, so there is
  nowhere to put the <code>where g.Count() &gt; 1</code> that the report needs. With it, <code>g</code>
  becomes an ordinary range variable — an <code>IGrouping&lt;TKey, TElement&gt;</code>, which is a
  sequence of the group's items that also carries a <code>Key</code>.</p>

  <h3><code>join … into</code> means something different from <code>join</code></h3>

  <p class="define"><span class="define__term">Group join</span> <code>join … into</code>. It
  produces <strong>one row per element of the outer sequence</strong>, each carrying the sequence of
  its matches — possibly empty. A plain <code>join</code> produces <strong>one row per
  match</strong>, so unmatched outer elements vanish and multiply-matched ones repeat.</p>

  <p>The measurement makes the difference concrete on the same data. The group join gave
  <code>Ada=2, Grace=1, Linus=0</code> — three rows for three customers. The plain join gave
  <code>Ada, Ada, Grace</code> — Ada twice, and <strong>Linus not at all</strong>.</p>

  <div class="callout callout--gotcha">
    <p><strong>The word <code>into</code> does two unrelated things.</strong> After
    <code>group … by</code> it is a query continuation. After <code>join … on … equals …</code> it
    changes the join's shape entirely. Reading <code>join x in ys on … into g</code> as "a join, with
    a name for the result" is the wrong reading, and it is the reading most people arrive at — the
    result is a per-outer-element grouping, not the joined rows.</p>
  </div>

  <h3>Left outer join is an idiom, not an operator</h3>

  <p>There is no <code>leftjoin</code> keyword and no <code>LeftJoin</code> method. The idiom is a
  group join followed by <code>from o in cOrders.DefaultIfEmpty()</code>: for a non-empty group that
  flattens the matches as usual, and for an empty one <code>DefaultIfEmpty</code> yields a single
  <code>default(T)</code>, so the outer element survives with a null partner. The measured output
  shows <code>Linus/(none)</code> present alongside the three matched rows.</p>

  <p><strong>The <code>o?.Ref</code> in the projection is not defensive style — it is required.</strong>
  For a class, <code>default(T)</code> is <code>null</code>, so every left-outer-join projection must
  handle a null on the inner side. For a struct it is <code>default(T)</code> instead, which is the
  same trap as <code>FirstOrDefault</code> and does not announce itself at all.</p>

  <div class="callout callout--gotcha">
    <p><strong>Rows dropped by a join are invisible.</strong> Order <code>O-4</code> referenced
    customer 9, which does not exist. It is absent from the inner join and from the left outer join,
    because a left join keyed on the customer side can only preserve customers. Nothing warns you:
    the report is missing a row and the totals are quietly short. Finding those rows is a
    separate deliberate query —
    <code>orders.Where(o =&gt; !customers.Any(c =&gt; c.Id == o.CustomerId))</code> — and it is worth
    running once against any data set before trusting a join over it.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. <code>First</code> where <code>Single</code> was meant</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: silently picking an arbitrary row"><code>// WRONG when the model guarantees one active subscription per customer.
// If a second ever appears, this picks whichever the source yields first —
// no error, wrong answer, and the bad data is never surfaced.
var subscription = subscriptions.First(s =&gt; s.CustomerId == id &amp;&amp; s.IsActive);

// Right: assert the guarantee. If it breaks, you find out.
var subscription = subscriptions.Single(s =&gt; s.CustomerId == id &amp;&amp; s.IsActive);</code></pre>

  <p>Measured: <code>Single</code> on a three-match query threw
  <code>InvalidOperationException: Sequence contains more than one matching element</code>, naming
  the problem precisely. <code>First</code> returned a row.</p>

  <h3>2. <code>FirstOrDefault</code> on a sequence of structs</h3>

  <p>It does not return <code>null</code> — it returns <code>default(T)</code>, an all-zero value
  that no constructor produced. A <code>null</code> check will not catch it, and the value flows on
  looking like real data. For a struct sequence, prefer the nullable-returning pattern or check with
  <code>Any</code> first.</p>

  <h3>3. Grouping by a key without value equality</h3>

  <p>A composite key built from an anonymous type or a record works. One containing a
  <code>List&lt;T&gt;</code> or an array does not: those compare by reference, so every item gets
  its own group and the grouping silently does nothing —
  <a href="#/m/t1-16-equality-and-hashing">Equality, GetHashCode, and Comparers</a> measured exactly
  this failure.</p>

  <h3>4. Arguing about syntax as though it had consequences</h3>

  <p>The runtime types were identical. There is no performance difference to appeal to, and any
  claim that one is faster is measurable and false. The decision is readability, and the signals
  above are the useful form of it.</p>

  <h3>5. Query syntax that ends in a method call</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="A signal, not an error"><code>// Not wrong, but the parentheses are telling you something.
var total = (from o in orders where o.Month == 3 select o.Amount).Sum();

// The whole thing wanted to be method syntax:
var total = orders.Where(o =&gt; o.Month == 3).Sum(o =&gt; o.Amount);</code></pre>

  <h3>6. Two <code>from</code> clauses where a <code>join</code> was meant</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a join written as a filtered cross product"><code>// WRONG at any real size. This considers customers.Count * orders.Count pairs
// and discards almost all of them. Measured on 3 x 4: 12 pairs for 3 results.
var rows = from c in customers
           from o in orders
           where o.CustomerId == c.Id
           select $"{c.Name}/{o.Ref}";

// Right: join builds a lookup keyed on c.Id and consults it once per customer.
var rows = from c in customers
           join o in orders on c.Id equals o.CustomerId
           select $"{c.Name}/{o.Ref}";</code></pre>

  <p>Identical rows either way, which is why this survives review. At 10,000 customers and 10,000
  orders it is 100 million pair evaluations against roughly 20,000.</p>

  <h3>7. Reading <code>join … into</code> as a name for the join result</h3>

  <p>It is a <strong>group join</strong>: one row per outer element carrying its (possibly empty)
  sequence of matches. Measured on the same data, the group join gave three rows for three customers
  and the plain join gave <code>Ada, Ada, Grace</code> — a duplicate and a missing customer.</p>

  <h3>8. Trusting a join not to drop rows</h3>

  <p>An order referencing a customer that does not exist is absent from an inner join and from a left
  outer join keyed on the customer side. No warning, no exception — the report is short and the
  totals are quietly wrong.</p>

  <h3>9. Expecting a query to be a result</h3>

  <p>Every sequence-returning operator is deferred. The query has not run when you assign it, runs
  again on every enumeration, and reflects its source at the moment of iteration.
  <a href="#/m/t1-20-ienumerable-vs-icollection">IEnumerable vs ICollection vs IList vs
  IReadOnly*</a> measured three passes costing three evaluations; the next module measures what each
  pass costs.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>A query returns the wrong row and there is no error.</strong> Suspect
    <code>First</code> or <code>FirstOrDefault</code> where the data was assumed unique. Change it
    to <code>Single</code> temporarily and run against real data: if it throws, the assumption is
    broken and you have found the defect rather than the symptom. This is the cheapest possible
    test for "did I mean exactly one?".</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A <code>GroupBy</code> produces one group per item.</strong> The key type has no
    value equality. Check it the way
    <a href="#/m/t1-16-equality-and-hashing">Equality, GetHashCode, and Comparers</a> prescribes:
    build two keys from identical inputs and compare them. Anonymous types and records pass;
    anything containing a collection fails.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A value that should be absent behaves like real data.</strong>
    <code>FirstOrDefault</code> on a struct sequence returns <code>default(T)</code>, not
    <code>null</code>. Compare against <code>default</code> rather than <code>null</code>, or
    restructure to <code>Any()</code> followed by <code>First()</code> so the absent case is
    explicit.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Reading an unfamiliar query.</strong> Work through the clause-to-method table above
    in order, because that is the order the operators actually run in. Query syntax reads
    top-to-bottom in source order, and so does the pipeline it lowers to — which is why the
    <code>select</code> at the bottom is the last thing to happen even though it is what the query
    is named for.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Deciding whether a query is doing what you think.</strong> Materialise each stage
    into a <code>ToList()</code> temporarily and print the counts. A stage that unexpectedly yields
    zero or yields everything localises the fault in one run, and is faster than stepping through a
    lazy pipeline in a debugger — where stepping itself changes when the work happens.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>A concrete case.</strong> A billing service resolved a customer's active
    subscription with
    <code>subscriptions.First(s =&gt; s.CustomerId == id &amp;&amp; s.IsActive)</code>. The data
    model guaranteed one active subscription per customer, enforced by application logic at the
    point of creation, and the query had been correct for two years.</p>
    <p>A migration ran to move customers between pricing plans. It created the new subscription
    before deactivating the old one, and a failure partway through left about 1,400 customers with
    two active rows.</p>
    <p><code>First</code> did exactly what it says: returned whichever the database yielded first,
    which for an unordered query is whichever the query plan happened to produce. Roughly half those
    customers were billed on the old plan and half on the new, and — because the ordering was not
    stable — some customers switched between the two across billing runs.</p>
    <p>Nothing failed. No exception, no log line, no alert. It surfaced six weeks later through
    customer complaints about inconsistent invoices, and the reconciliation took longer than the fix
    because the billing history had to be recomputed for every affected customer.</p>
    <p>Had the query been <code>Single</code>, the first billing run after the migration would have
    thrown <code>InvalidOperationException: Sequence contains more than one matching element</code>
    for the first affected customer — on the day of the migration, naming the exact problem, before
    a single incorrect invoice was issued.</p>
  </div>

  <p>The general principle: <strong><code>Single</code> and <code>First</code> encode different
  beliefs about the data, and the belief is the valuable part.</strong> <code>Single</code> says
  "exactly one exists, and if that is ever untrue I want to know immediately".
  <code>First</code> says "several may match and any will do". Using <code>First</code> where you
  meant <code>Single</code> discards an assertion you were entitled to make, and converts a class of
  data corruption from loud to silent.</p>

  <p>This generalises past LINQ. Most of the choices in this module are between an operator that
  asserts something and one that copes — <code>Single</code> against <code>First</code>,
  <code>First</code> against <code>FirstOrDefault</code>, <code>Sum</code> against a defaulted
  aggregate. <strong>Coping is the right choice when the situation is genuinely expected and the
  wrong one when it is not</strong>, and the difference between the two is exactly the difference
  between finding a bug on the day it is introduced and finding it in a customer complaint.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"Query syntax is slower than method syntax."</strong> They are the same program. The
    measurement shows both forms producing the same runtime type,
    <code>IEnumerableSelectIterator</code>, because the compiler rewrites one into the other before
    any other stage of compilation. There is nothing left to be slower.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Query syntax can do everything method syntax can."</strong> It has keywords for
    about a dozen operators. <code>Count</code>, <code>Any</code>, <code>Sum</code>,
    <code>First</code>, <code>Skip</code>, <code>Take</code>, <code>Distinct</code> and most of the
    other forty have no keyword — a query needing one is parenthesised with a method call
    appended.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>First</code> is the safe version of <code>Single</code>."</strong> It is the
    version that does not tell you when your assumption is wrong. If the data guarantees one match,
    <code>Single</code> turns a broken guarantee into an immediate exception naming the problem;
    <code>First</code> silently returns an arbitrary row.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>FirstOrDefault</code> returns null when nothing matches."</strong> For a
    reference type, yes. For a struct it returns <code>default(T)</code> — an all-zero value that no
    constructor produced and that a <code>null</code> check will not catch. Verified: the returned
    value compared equal to <code>default</code>.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>let</code> is a variable declaration."</strong> It compiles to a
    <code>Select</code> producing an anonymous type that carries the original item and the new value
    forward together. That is why a <code>let</code> is cheap to write and why the method-syntax
    equivalent needs an anonymous type you write yourself.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>from … from …</code> and <code>join</code> are two ways of writing the same
    thing."</strong> They produce the same rows and do very different amounts of work. Two
    <code>from</code> clauses lower to <code>SelectMany</code> and consider every pair;
    <code>join</code> builds a lookup on the key. Measured: 12 pairs considered against 3 results on
    a three-by-four data set, and the gap is quadratic.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"There is a left join operator."</strong> There is not. A left outer join is an
    idiom — a group join followed by <code>DefaultIfEmpty()</code> — and the null it produces for
    unmatched outer elements is something the projection has to handle.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Grouping by an anonymous type is a trick."</strong> It works for a documented
    reason: anonymous types get generated value equality over their members, so two keys with the
    same contents are equal and hash equally. The same reason explains its limit — a key containing
    a collection compares by reference and groups nothing.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Reach for</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>A join, or two or more sources</td><td>Query syntax</td>
          <td><code>join … on … equals …</code> against a four-argument method call with a
          packaging lambda.</td></tr>
      <tr><td>An intermediate value used by later clauses</td><td>Query syntax and
          <code>let</code></td>
          <td>The compiler writes the anonymous type; otherwise you do, and unpack it at every
          step.</td></tr>
      <tr><td>One or two operations</td><td>Method syntax</td>
          <td>Shorter, and query syntax would need a trailing method call anyway.</td></tr>
      <tr><td>Anything ending in <code>Count</code>, <code>Sum</code>, <code>Any</code>,
          <code>First</code></td><td>Method syntax</td>
          <td>Query syntax has no keyword for these.</td></tr>
      <tr><td>The data guarantees exactly one match</td><td><code>Single</code></td>
          <td>Turns a broken guarantee into an immediate, named exception.</td></tr>
      <tr><td>Several may match and any will do</td><td><code>First</code></td>
          <td>Says what you mean; no assertion to break.</td></tr>
      <tr><td>Absence is expected and normal</td><td><code>FirstOrDefault</code> — checking against
          <code>default</code> for structs</td>
          <td>Avoids exceptions for a case that is not exceptional.</td></tr>
      <tr><td>Relating two sequences on a key</td><td><code>join</code>, never two
          <code>from</code> clauses with a <code>where</code></td>
          <td>A lookup against every pair. Same rows, quadratic difference.</td></tr>
      <tr><td>Every outer element must appear, matched or not</td><td>A group join —
          <code>join … into</code></td>
          <td>One row per outer element, carrying a possibly empty sequence.</td></tr>
      <tr><td>A left outer join</td><td>Group join plus <code>DefaultIfEmpty()</code></td>
          <td>There is no left-join operator; the unmatched side is null.</td></tr>
      <tr><td>More clauses after a <code>group by</code></td><td><code>into</code></td>
          <td><code>group</code> must otherwise end the query.</td></tr>
      <tr><td>Grouping by more than one field</td><td>An anonymous type or a record as the key</td>
          <td>Generated value equality. Never a key containing a collection.</td></tr>
      <tr><td>A query you will read more than once</td><td>Whichever is shorter <em>at the same
          clarity</em></td>
          <td>They compile to the same thing, so the only cost is comprehension.</td></tr>
      <tr><td>A result the caller will use more than once</td><td>Materialise it</td>
          <td>Sequence-returning operators are deferred — see
          <a href="#/m/t1-25-deferred-execution">Deferred Execution and the Cost of LINQ</a>.</td></tr>
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
    <p>Write the method-syntax equivalent of this query, predict whether the results are equal, and
    say what the runtime types will be.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>var q = from s in Sales
        where s.Amount &gt; 100m
        orderby s.Amount
        select s.Rep;</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="The equivalent"><code>var m = Sales.Where(s =&gt; s.Amount &gt; 100m)
             .OrderBy(s =&gt; s.Amount)
             .Select(s =&gt; s.Rep);</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>query  : ada, ada, grace, ada, grace
method : ada, ada, grace, ada, grace
equal  : True
types  : IEnumerableSelectIterator&amp;#96;2 / IEnumerableSelectIterator&amp;#96;2</code></pre>
        <p><strong>The runtime types are identical</strong>, not merely the results. The compiler
        rewrote the query expression into exactly those method calls before any other stage of
        compilation, so the two lines produce the same IL and the same object graph.</p>
        <p>Note the clause order maps directly onto the call order: <code>where</code> becomes the
        first call, <code>orderby</code> the second, <code>select</code> the last. Query syntax reads
        in execution order, which is one of its genuine advantages — the method form reads that way
        too, but only because the calls are chained left to right.</p>
        <p>The practical consequence: <strong>any claim that one syntax is faster is measurable and
        false.</strong> Choose on readability, and this module's production example gives the three
        signals worth using.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Rewrite this query in method syntax without using <code>let</code>. Then say why the
    query-syntax version is shorter, and what the compiler generated.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>var q = from s in Sales
        let vat = s.Amount * 0.20m
        where vat &gt; 50m
        select $"{s.Rep}:{vat:0.00}";</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="The equivalent"><code>var m = Sales
    .Select(s =&gt; new { s, vat = s.Amount * 0.20m })   // carry BOTH forward
    .Where(x =&gt; x.vat &gt; 50m)
    .Select(x =&gt; $"{x.s.Rep}:{x.vat:0.00}");           // unpack both</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>query  : grace:60.00, ada:90.00, grace:180.00
method : grace:60.00, ada:90.00, grace:180.00
equal  : True</code></pre>
        <p><strong>The extra work is the anonymous type.</strong> After computing <code>vat</code>,
        the pipeline still needs <code>s</code> for the final projection — so something has to carry
        both values to the next operator. <code>let</code> makes the compiler write that; without
        it, you write <code>new { s, vat = … }</code> and then unpack it with <code>x.s</code> and
        <code>x.vat</code> in every subsequent clause.</p>
        <p>With one <code>let</code> the difference is small. It compounds: each additional
        <code>let</code> adds another member to the carried type and another level of unpacking to
        every step after it. This module's production example has two, and the method version
        carries the bookkeeping through five operators.</p>
        <p><strong>That is the rule for choosing.</strong> Query syntax is worth it exactly where the
        compiler writes anonymous types for you — which is <code>let</code>, <code>join</code>, and
        multiple <code>from</code> clauses. Everywhere else, method syntax is shorter.</p>
        <p>Worth noticing what it costs: an allocation per element for the anonymous type, in both
        versions equally. <a href="#/m/t1-25-deferred-execution">Deferred Execution and the Cost of
        LINQ</a> measures that.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Predict the result of each of these six calls against a sequence with four "eu" sales, one
    sale of 900, and none above 9999. Then say which one hides a bug, and what
    <code>FirstOrDefault</code> returns for a sequence of structs.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>Sales.First(s =&gt; s.Region == "eu")
Sales.Single(s =&gt; s.Region == "eu")
Sales.First(s =&gt; s.Amount &gt; 9999m)
Sales.FirstOrDefault(s =&gt; s.Amount &gt; 9999m)
Sales.Single(s =&gt; s.Amount == 900m)
Sales.SingleOrDefault(s =&gt; s.Amount &gt; 9999m)</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>First(eu)                ada
Single(eu)               InvalidOperationException: Sequence contains more than one matching element
First(amount&gt;9999)       InvalidOperationException: Sequence contains no matching element
FirstOrDefault(&gt;9999)    (null Rep)
Single(amount==900)      grace
SingleOrDefault(&gt;9999)   (null Rep)
default(Sale) == returned : True</code></pre>
        <div class="table-wrap">
        <table>
          <thead><tr><th></th><th>No match</th><th>One match</th><th>Many matches</th></tr></thead>
          <tbody>
            <tr><td><code>First</code></td><td>throws</td><td>returns it</td><td>returns the
                first</td></tr>
            <tr><td><code>FirstOrDefault</code></td><td><code>default(T)</code></td><td>returns
                it</td><td>returns the first</td></tr>
            <tr><td><code>Single</code></td><td>throws</td><td>returns it</td><td><strong>throws</strong></td></tr>
            <tr><td><code>SingleOrDefault</code></td><td><code>default(T)</code></td><td>returns
                it</td><td><strong>throws</strong></td></tr>
          </tbody>
        </table>
        </div>
        <p><strong>The one that hides a bug is <code>First</code> used where the data is supposed to
        guarantee one match.</strong> It returned <code>ada</code> from three matching rows without
        complaint. <code>Single</code> on the same query threw, naming the problem exactly. If the
        model says one, the assertion is free and the silence is expensive.</p>
        <p><strong><code>FirstOrDefault</code> on a struct sequence does not return
        <code>null</code>.</strong> <code>Sale</code> is a <code>readonly record struct</code>, so
        the result is <code>default(Sale)</code> — every field zeroed, <code>Rep</code> being
        <code>null</code> only because <code>string</code> is a reference type. The value compared
        equal to <code>default</code>, and it is a perfectly ordinary <code>Sale</code> as far as the
        type system is concerned.</p>
        <p>So <code>if (result == null)</code> does not compile for a struct, and
        <code>if (result.Rep == null)</code> works by accident and breaks the moment the struct's
        fields are all value types. The reliable checks are
        <code>result == default</code> for a type with value equality, or restructuring to
        <code>Any()</code> first so the absent case never produces a value at all.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Group sales by rep <em>and</em> region, summing amounts. Explain why the key type works, what
    would break it, and how the failure would present.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>var grouped = Sales
    .GroupBy(s =&gt; new { s.Rep, s.Region })
    .OrderBy(g =&gt; g.Key.Rep).ThenBy(g =&gt; g.Key.Region)
    .Select(g =&gt; $"{g.Key.Rep}/{g.Key.Region}={g.Sum(x =&gt; x.Amount):0}");</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>ada/eu=340 | ada/us=450 | grace/eu=300 | grace/us=900 | linus/eu=80
two identical anonymous keys are equal : True
and hash the same                      : True</code></pre>
        <p><strong>Why it works.</strong> <code>GroupBy</code> puts items in the same group when
        their keys are equal, which it decides with
        <code>EqualityComparer&lt;TKey&gt;.Default</code> — so the key type must have value equality
        <em>and</em> a matching hash code. An anonymous type gets both generated over its members,
        which the last two lines verify directly.</p>
        <p>That is the same requirement <a href="#/m/t1-16-equality-and-hashing">Equality,
        GetHashCode, and Comparers</a> established for dictionary keys, and for the same reason:
        <code>GroupBy</code> is a hash lookup underneath.</p>
        <p><strong>What would break it.</strong> A key whose members do not have value equality.
        The realistic version:</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a key containing a collection"><code>// WRONG. Tags is a List&lt;string&gt;, which compares by reference, so two sales
// with identical tags produce different keys.
var grouped = Sales.GroupBy(s =&gt; new { s.Rep, s.Tags });</code></pre>
        <p><strong>How the failure presents.</strong> Not as an exception — as
        <strong>one group per item</strong>. Every key is unequal to every other, so
        <code>GroupBy</code> creates a group of one for each element. Downstream, sums are per-item,
        counts are all 1, and a report that should have five rows has six hundred.</p>
        <p>That is a quiet failure with a loud signature once you know to look for it: <em>the number
        of groups equals the number of items</em>. Checking
        <code>grouped.Count() == source.Count()</code> is a one-line diagnostic for the whole
        category.</p>
        <p><strong>The fix</strong> follows the earlier module: make the key from value-comparable
        members. Join the tags into a single ordered <code>string</code>, or use a record with a
        hand-written <code>Equals</code> and <code>GetHashCode</code>. Sorting first matters if the
        collection's order is not meaningful, or two logically identical keys will still differ.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is the relationship between query syntax and method syntax?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Query syntax is <strong>rewritten into method calls</strong> before any other stage of
        compilation. The measurement shows both forms producing the same runtime type,
        <code>IEnumerableSelectIterator</code> — the same program, not merely the same result.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>let</code> compile to, and why does that matter?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <code>Select</code> producing an <strong>anonymous type</strong> carrying both the
        original item and the new value forward. It matters because that is exactly the bookkeeping
        you must write by hand in method syntax — and unpack at every subsequent step.</p>
      </div></details>
    </li>
    <li>
      <p>Name the three operator families and when each executes.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Returning <strong>a sequence</strong> (<code>Where</code>, <code>Select</code>,
        <code>OrderBy</code>) — deferred. Returning <strong>a value</strong> (<code>Count</code>,
        <code>Sum</code>, <code>First</code>) — immediately. Returning <strong>a collection</strong>
        (<code>ToList</code>, <code>ToArray</code>) — immediately, materialising everything.</p>
      </div></details>
    </li>
    <li>
      <p>Which operators have no query-syntax keyword?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Most of them — <code>Count</code>, <code>Any</code>, <code>Sum</code>,
        <code>First</code>, <code>Skip</code>, <code>Take</code>, <code>Distinct</code> and around
        forty more. A query needing one is parenthesised with the method call appended, which is a
        signal it wanted to be method syntax.</p>
      </div></details>
    </li>
    <li>
      <p>What is the difference between <code>Single</code> and <code>First</code>, and why is it a
      correctness decision?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Single</code> <strong>asserts</strong> exactly one match and throws otherwise;
        <code>First</code> takes whatever comes. Using <code>First</code> where the model guarantees
        uniqueness discards an assertion you were entitled to make, and turns broken data from a
        loud exception into a silently arbitrary row.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>FirstOrDefault</code> return for a sequence of structs?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>default(T)</code> — an all-zero value no constructor produced, <strong>not
        <code>null</code></strong>. A null check will not catch it. Compare against
        <code>default</code>, or use <code>Any()</code> first so the absent case never produces a
        value.</p>
      </div></details>
    </li>
    <li>
      <p>Why can an anonymous type be used as a <code>GroupBy</code> key?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It gets generated <strong>value equality and a matching hash code</strong> over its
        members. <code>GroupBy</code> is a hash lookup underneath, so it needs exactly what a
        dictionary key needs.</p>
      </div></details>
    </li>
    <li>
      <p>How does a broken <code>GroupBy</code> key present, and what is the one-line diagnostic?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>As <strong>one group per item</strong> — no exception at all, only counts of 1 and a report
        with far too many rows. Diagnostic:
        <code>grouped.Count() == source.Count()</code>. A key containing a
        <code>List&lt;T&gt;</code> or array is the usual cause.</p>
      </div></details>
    </li>
    <li>
      <p>Give the three signals for choosing query syntax.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <strong>join</strong>; an <strong>intermediate value</strong> used by later clauses
        (<code>let</code>); or <strong>multiple sources</strong>. All three are cases where the
        compiler writes anonymous types you would otherwise write and unpack yourself.</p>
      </div></details>
    </li>
    <li>
      <p>Is there a performance difference between the syntaxes?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No.</strong> Verified: identical runtime types, because one is rewritten into the
        other before compilation proceeds. Any claim otherwise is measurable and false, which is what
        makes the style argument settleable.</p>
      </div></details>
    </li>
    <li>
      <p>What is a range variable?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The identifier introduced by <code>from o in xs</code>. It becomes the
        <strong>parameter of the generated lambdas</strong>, which is why it is in scope for the
        whole query and cannot be assigned to.</p>
      </div></details>
    </li>
    <li>
      <p>What is the difference between <code>join</code> and two <code>from</code> clauses?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The same rows, very different work. Two <code>from</code> clauses lower to
        <code>SelectMany</code> and consider <strong>every pair</strong> before
        <code>where</code> discards most; <code>join</code> <strong>builds a lookup</strong> on the
        key. Measured: 12 pairs for 3 results on three customers and four orders.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>join … into</code> produce, and how do you write a left outer join?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <strong>group join</strong>: one row per outer element carrying its possibly empty
        sequence of matches. A left outer join is that followed by
        <code>from o in g.DefaultIfEmpty()</code> — and <code>o</code> is null for unmatched
        elements, so the projection must handle it.</p>
      </div></details>
    </li>
    <li>
      <p>What general principle links <code>Single</code>/<code>First</code> to the rest of the
      operator choices?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Most pairs are <strong>an operator that asserts something against one that copes</strong>.
        Coping is right when the situation is genuinely expected and wrong when it is not — the
        difference between finding a bug on the day it is introduced and finding it in a customer
        complaint.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
