/* ============================================================================
   Track 1, Module 13 — Composition Over Inheritance
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-13-composition-over-inheritance/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-13-composition-over-inheritance",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "A hierarchy models one axis of variation. Real systems vary along several at once, and the " +
    "class count for inheritance is 2^n where composition's is n. The advice is sound and it is " +
    "not free: a wrapper is a different object, so type tests, identity, and stack traces all " +
    "change, and the order you stack layers in is a decision nothing checks.",
  terms: [
    "composition", "delegation", "wrapper", "decorator", "strategy",
    "has-a relationship", "combinatorial explosion", "forwarding",
    "axis of variation", "constructor injection",
    "object graph", "layer ordering", "delegate", "Func", "capability interface",
    "God object", "boilerplate"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A notification component has two destinations, email and SMS, and a class for each. A
  requirement arrives to retry failures, so two more classes appear:
  <code>RetryingEmailSender</code> and <code>RetryingSmsSender</code>. Then encryption is
  required, and there are eight. Then compression, and there are sixteen. Nobody decided to build
  sixteen classes; each step added the obvious two.</p>

  <p>Then a customer needs encryption applied <em>after</em> retry rather than before. There is no
  class for that, and there is no way to write one that reuses either existing path — the ordering
  is baked into which class inherits from which.</p>

  <p>Separately, an audit finds that a compliance log has been missing entries for cached
  requests. Every layer involved is correct. The layers were assembled in a different order in one
  environment than another, and in one of those orders the cache short-circuits before the audit
  runs.</p>

  <p>Both are the same subject. The first is what happens when you model variation with a
  hierarchy and there is more than one thing varying. The second is what happens when you fix
  that with composition, and discover that composition has a decision inheritance did not: the
  order the pieces go in.</p>

  <p>This module is the case for composition, made with numbers, and an honest account of what it
  costs — because "prefer composition over inheritance" is repeated far more often than it is
  qualified.</p>
</section>

<section id="what-composition-is">
  <h2>What composition actually is</h2>

  <p class="define"><span class="define__term">Composition</span> Building behaviour by holding
  other objects as fields and calling them, rather than by inheriting from them. The containing
  object decides what to call and when; the contained objects know nothing about the container.</p>

  <p class="define"><span class="define__term">Delegation</span> Forwarding a call to a held
  object. The mechanical act composition is made of: a method that does little except call the
  same method on a field.</p>

  <p class="define"><span class="define__term">Has-a relationship</span> The test for composition,
  as <em>is-a</em> was for inheritance in
  <a href="#/m/t1-10-inheritance">Inheritance</a>. A car <em>has an</em> engine; it is not a kind
  of engine. When the is-a test fails but you still want the behaviour, composition is the
  answer.</p>

  <p>The mental model worth carrying: <strong>inheritance fixes a relationship at compile time;
  composition creates one at run time.</strong> A subclass is bound to its base in the source
  file, permanently, for every instance. A field holding an interface is bound to a specific
  object when the object is constructed, and a different object can be supplied next time.</p>

  <p class="define"><span class="define__term">Axis of variation</span> One dimension along which
  behaviour differs — destination, retry policy, encryption. The central fact of this module:
  <strong>a class hierarchy can model exactly one axis cleanly, because a class has exactly one
  base.</strong></p>

  <p>An analogy: inheritance is a family tree and composition is a recipe. A family tree says what
  something <em>is</em>, descending from one parent, and cannot be revised. A recipe lists
  ingredients and an order, and both can change without redefining anything.
  <strong>The analogy's limit is that recipes have no equivalent of the ordering hazard</strong> —
  stirring before or after adding salt rarely changes the result, whereas caching before or after
  auditing changes what your compliance log contains. That specific failure is in this module
  because the analogy would let you walk past it.</p>
</section>

<section id="the-arithmetic">
  <h2>The arithmetic, which is the whole argument</h2>

  <p>Two destinations and three optional behaviours, modelled both ways. The inheritance version
  needs a class for every combination, because a class has one base and the combination has to be
  encoded in the chain:</p>

  <pre data-lang="csharp" data-net="10" data-title="01-combinatorial-explosion.cs"><code>// 01-combinatorial-explosion.cs — why a hierarchy that models "kinds of thing"
// stops working once things vary along more than one axis.
// .NET 10.0.400. Run: dotnet run 01-combinatorial-explosion.cs

using System;
using System.Collections.Generic;
using System.Linq;

// ---- THE INHERITANCE VERSION ----------------------------------------------
// Three axes: destination (email/sms), retry (yes/no), encryption (yes/no).
// Every combination needs its own class, because a class has one base.
abstract class Sender { public abstract string Send(string msg); }

class EmailSender : Sender { public override string Send(string m) =&gt; $"email({m})"; }
class SmsSender : Sender { public override string Send(string m) =&gt; $"sms({m})"; }

class RetryingEmailSender : EmailSender
{
    public override string Send(string m) =&gt; $"retry[{base.Send(m)}]";
}
class RetryingSmsSender : SmsSender
{
    public override string Send(string m) =&gt; $"retry[{base.Send(m)}]";
}
class EncryptedEmailSender : EmailSender
{
    public override string Send(string m) =&gt; $"enc[{base.Send(m)}]";
}
class EncryptedSmsSender : SmsSender
{
    public override string Send(string m) =&gt; $"enc[{base.Send(m)}]";
}
class RetryingEncryptedEmailSender : EncryptedEmailSender
{
    public override string Send(string m) =&gt; $"retry[{base.Send(m)}]";
}
class RetryingEncryptedSmsSender : EncryptedSmsSender
{
    public override string Send(string m) =&gt; $"retry[{base.Send(m)}]";
}
// Adding "compressed" as a fourth behaviour doubles this list again.

// ---- THE COMPOSITION VERSION ----------------------------------------------
interface ISender { string Send(string message); }

sealed class Email : ISender { public string Send(string m) =&gt; $"email({m})"; }
sealed class Sms : ISender { public string Send(string m) =&gt; $"sms({m})"; }

// Each behaviour is a wrapper that holds another ISender and adds one thing.
sealed class Retrying : ISender
{
    private readonly ISender _inner;
    public Retrying(ISender inner) =&gt; _inner = inner;
    public string Send(string m) =&gt; $"retry[{_inner.Send(m)}]";
}

sealed class Encrypted : ISender
{
    private readonly ISender _inner;
    public Encrypted(ISender inner) =&gt; _inner = inner;
    public string Send(string m) =&gt; $"enc[{_inner.Send(m)}]";
}

sealed class Compressed : ISender
{
    private readonly ISender _inner;
    public Compressed(ISender inner) =&gt; _inner = inner;
    public string Send(string m) =&gt; $"gz[{_inner.Send(m)}]";
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- inheritance: one class per combination ---");
        Sender[] byInheritance =
        {
            new EmailSender(), new SmsSender(),
            new RetryingEmailSender(), new RetryingSmsSender(),
            new EncryptedEmailSender(), new EncryptedSmsSender(),
            new RetryingEncryptedEmailSender(), new RetryingEncryptedSmsSender()
        };
        foreach (var s in byInheritance)
            Console.WriteLine($"  {s.GetType().Name,-32} {s.Send("hi")}");

        int destinations = 2;
        Console.WriteLine();
        Console.WriteLine("  classes needed as behaviours are added:");
        for (int b = 0; b &lt;= 4; b++)
            Console.WriteLine($"    {destinations} destinations x {b} behaviours -&gt; " +
                              $"{destinations * (int)Math.Pow(2, b),3} classes");

        Console.WriteLine();
        Console.WriteLine("--- composition: one class per behaviour, combined at run time ---");
        ISender[] byComposition =
        {
            new Email(),
            new Sms(),
            new Retrying(new Email()),
            new Retrying(new Sms()),
            new Encrypted(new Email()),
            new Encrypted(new Sms()),
            new Retrying(new Encrypted(new Email())),
            new Retrying(new Encrypted(new Sms())),
            // combinations the inheritance version has no class for:
            new Compressed(new Retrying(new Encrypted(new Email()))),
            new Encrypted(new Retrying(new Sms()))
        };
        foreach (var s in byComposition)
            Console.WriteLine($"  {s.Send("hi")}");

        Console.WriteLine();
        Console.WriteLine("  classes needed as behaviours are added:");
        for (int b = 0; b &lt;= 4; b++)
            Console.WriteLine($"    {destinations} destinations + {b} behaviours -&gt; " +
                              $"{destinations + b,3} classes");

        Console.WriteLine();
        Console.WriteLine("  and note the last two: ordering is a run-time choice, so");
        Console.WriteLine("  enc-then-retry and retry-then-enc are both available without");
        Console.WriteLine("  writing a class for either.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- inheritance: one class per combination ---
  EmailSender                      email(hi)
  SmsSender                        sms(hi)
  RetryingEmailSender              retry[email(hi)]
  RetryingSmsSender                retry[sms(hi)]
  EncryptedEmailSender             enc[email(hi)]
  EncryptedSmsSender               enc[sms(hi)]
  RetryingEncryptedEmailSender     retry[enc[email(hi)]]
  RetryingEncryptedSmsSender       retry[enc[sms(hi)]]

  classes needed as behaviours are added:
    2 destinations x 0 behaviours -&gt;   2 classes
    2 destinations x 1 behaviours -&gt;   4 classes
    2 destinations x 2 behaviours -&gt;   8 classes
    2 destinations x 3 behaviours -&gt;  16 classes
    2 destinations x 4 behaviours -&gt;  32 classes

--- composition: one class per behaviour, combined at run time ---
  email(hi)
  sms(hi)
  retry[email(hi)]
  retry[sms(hi)]
  enc[email(hi)]
  enc[sms(hi)]
  retry[enc[email(hi)]]
  retry[enc[sms(hi)]]
  gz[retry[enc[email(hi)]]]
  enc[retry[sms(hi)]]

  classes needed as behaviours are added:
    2 destinations + 0 behaviours -&gt;   2 classes
    2 destinations + 1 behaviours -&gt;   3 classes
    2 destinations + 2 behaviours -&gt;   4 classes
    2 destinations + 3 behaviours -&gt;   5 classes
    2 destinations + 4 behaviours -&gt;   6 classes

  and note the last two: ordering is a run-time choice, so
  enc-then-retry and retry-then-enc are both available without
  writing a class for either.</code></pre>

  <p class="define"><span class="define__term">Combinatorial explosion</span> The growth of
  <em>d</em> × 2<sup>n</sup> classes for <em>d</em> base kinds and <em>n</em> optional behaviours,
  against <em>d</em> + <em>n</em> for composition. At four behaviours: 32 against 6. At six: 128
  against 8.</p>

  <p>The class count is the visible half. Two consequences matter more.</p>

  <p><strong>Every combination has to be anticipated.</strong> The hierarchy has no class for
  compression-over-retry-over-encryption, and adding one means adding a whole parallel chain. The
  composed version wrote it as an expression, using classes that already existed.</p>

  <p><strong>Ordering becomes a run-time choice.</strong> <code>enc[retry[...]]</code> and
  <code>retry[enc[...]]</code> are both expressible with no new types. In the hierarchy each order
  is a separate class, so supporting both doubles the tree again.</p>

  <p class="define"><span class="define__term">Decorator</span> The shape used above: a class that
  implements an interface, holds another instance of that same interface, and adds behaviour
  around the forwarded call. Decorators stack in any order and any number, which is where all the
  flexibility above comes from.</p>
</section>

<section id="minimal-example">
  <h2>A hierarchy rewritten, with the result checked</h2>

  <p>The arithmetic is persuasive in the abstract. Here is a four-level hierarchy of the kind that
  actually accumulates, rewritten as composition, with both versions run and their outputs
  compared — so the refactor is demonstrably behaviour-preserving rather than merely claimed to
  be.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-refactor.cs"><code>// 02-refactor.cs — the same behaviour written twice: once as an inheritance
// tree that has rotted, once as composition. The outputs are compared so the
// refactor is demonstrably behaviour-preserving.
// .NET 10.0.400. Run: dotnet run 02-refactor.cs

using System;
using System.Collections.Generic;
using System.Linq;

// ============ BEFORE: four levels, each adding one concern ==================
abstract class ReportBase
{
    protected readonly List&lt;string&gt; Log = new();

    public string Run(string[] rows)
    {
        Log.Clear();
        var filtered = Filter(rows);
        var formatted = Format(filtered);
        return Decorate(formatted);
    }

    protected virtual string[] Filter(string[] rows) =&gt; rows;
    protected abstract string Format(string[] rows);
    protected virtual string Decorate(string body) =&gt; body;
    public IReadOnlyList&lt;string&gt; Trace =&gt; Log;
}

class CsvReport : ReportBase
{
    protected override string Format(string[] rows)
    {
        Log.Add("format:csv");
        return string.Join(",", rows);
    }
}

class FilteredCsvReport : CsvReport
{
    protected override string[] Filter(string[] rows)
    {
        Log.Add("filter:nonempty");
        return rows.Where(r =&gt; !string.IsNullOrWhiteSpace(r)).ToArray();
    }
}

class TitledFilteredCsvReport : FilteredCsvReport
{
    private readonly string _title;
    public TitledFilteredCsvReport(string title) =&gt; _title = title;

    protected override string Decorate(string body)
    {
        Log.Add("decorate:title");
        return $"# {_title}\n{body}";
    }
}

// Wanted: a titled, filtered, TSV report. There is no path to it without
// duplicating FilteredCsvReport and TitledFilteredCsvReport for TSV.

// ============ AFTER: three small pieces, combined ===========================
interface IRowFilter { string[] Apply(string[] rows, IList&lt;string&gt; log); }
interface IRowFormatter { string Format(string[] rows, IList&lt;string&gt; log); }
interface IDecorator { string Decorate(string body, IList&lt;string&gt; log); }

sealed class NonEmptyFilter : IRowFilter
{
    public string[] Apply(string[] rows, IList&lt;string&gt; log)
    {
        log.Add("filter:nonempty");
        return rows.Where(r =&gt; !string.IsNullOrWhiteSpace(r)).ToArray();
    }
}

sealed class PassThroughFilter : IRowFilter
{
    public string[] Apply(string[] rows, IList&lt;string&gt; log) =&gt; rows;
}

sealed class CsvFormatter : IRowFormatter
{
    public string Format(string[] rows, IList&lt;string&gt; log)
    {
        log.Add("format:csv");
        return string.Join(",", rows);
    }
}

sealed class TsvFormatter : IRowFormatter
{
    public string Format(string[] rows, IList&lt;string&gt; log)
    {
        log.Add("format:tsv");
        return string.Join("\t", rows);
    }
}

sealed class TitleDecorator : IDecorator
{
    private readonly string _title;
    public TitleDecorator(string title) =&gt; _title = title;
    public string Decorate(string body, IList&lt;string&gt; log)
    {
        log.Add("decorate:title");
        return $"# {_title}\n{body}";
    }
}

sealed class NoDecorator : IDecorator
{
    public string Decorate(string body, IList&lt;string&gt; log) =&gt; body;
}

sealed class Report
{
    private readonly IRowFilter _filter;
    private readonly IRowFormatter _formatter;
    private readonly IDecorator _decorator;
    private readonly List&lt;string&gt; _log = new();

    public Report(IRowFilter filter, IRowFormatter formatter, IDecorator decorator)
        =&gt; (_filter, _formatter, _decorator) = (filter, formatter, decorator);

    public IReadOnlyList&lt;string&gt; Trace =&gt; _log;

    public string Run(string[] rows)
    {
        _log.Clear();
        var filtered = _filter.Apply(rows, _log);
        var formatted = _formatter.Format(filtered, _log);
        return _decorator.Decorate(formatted, _log);
    }
}

class Program
{
    static void Main()
    {
        string[] rows = { "id", "", "name", "   ", "amount" };

        var before = new TitledFilteredCsvReport("Sales");
        string beforeOut = before.Run(rows);

        var after = new Report(new NonEmptyFilter(), new CsvFormatter(),
                               new TitleDecorator("Sales"));
        string afterOut = after.Run(rows);

        Console.WriteLine("BEFORE (4-level hierarchy):");
        Console.WriteLine(Indent(beforeOut));
        Console.WriteLine($"  trace: {string.Join(" -&gt; ", before.Trace)}");

        Console.WriteLine();
        Console.WriteLine("AFTER (3 composed parts):");
        Console.WriteLine(Indent(afterOut));
        Console.WriteLine($"  trace: {string.Join(" -&gt; ", after.Trace)}");

        Console.WriteLine();
        Console.WriteLine($"outputs identical : {beforeOut == afterOut}");
        Console.WriteLine($"traces identical  : {before.Trace.SequenceEqual(after.Trace)}");

        Console.WriteLine();
        Console.WriteLine("The combination the hierarchy could not express, at no extra cost:");
        var tsv = new Report(new NonEmptyFilter(), new TsvFormatter(),
                             new TitleDecorator("Sales"));
        Console.WriteLine(Indent(tsv.Run(rows).Replace("\t", "&lt;TAB&gt;")));

        var plain = new Report(new PassThroughFilter(), new TsvFormatter(), new NoDecorator());
        Console.WriteLine(Indent(plain.Run(rows).Replace("\t", "&lt;TAB&gt;")));
    }

    static string Indent(string s) =&gt;
        string.Join("\n", s.Split('\n').Select(l =&gt; "  | " + l));
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>BEFORE (4-level hierarchy):
  | # Sales
  | id,name,amount
  trace: filter:nonempty -&gt; format:csv -&gt; decorate:title

AFTER (3 composed parts):
  | # Sales
  | id,name,amount
  trace: filter:nonempty -&gt; format:csv -&gt; decorate:title

outputs identical : True
traces identical  : True

The combination the hierarchy could not express, at no extra cost:
  | # Sales
  | id&lt;TAB&gt;name&lt;TAB&gt;amount
  | id&lt;TAB&gt;&lt;TAB&gt;name&lt;TAB&gt;   &lt;TAB&gt;amount</code></pre>

  <p>Four things changed, and each is worth naming because they are the moves the refactor is made
  of.</p>

  <p><strong>Each <code>protected virtual</code> hook became an interface.</strong>
  <code>Filter</code>, <code>Format</code> and <code>Decorate</code> were three extension points
  on one class; they are now three small interfaces with independent implementations.</p>

  <p><strong>The shared algorithm stayed in one place.</strong> <code>Report.Run</code> does what
  <code>ReportBase.Run</code> did — filter, format, decorate — and it is still the only thing that
  knows the order. Composition did not remove the template; it moved the varying parts out of the
  inheritance chain.</p>

  <p><strong>The "do nothing" cases became explicit types.</strong>
  <code>PassThroughFilter</code> and <code>NoDecorator</code> replace "the base class's default
  implementation". Naming them is a real cost — two classes that used to be zero lines — and a
  real benefit: the default is now a thing you can see, name in a configuration, and swap.</p>

  <p><strong>The fragile base class problem disappeared.</strong> The behavioural contract from
  <a href="#/m/t1-10-inheritance">Inheritance</a> — "which of my own overridable members does the
  base call, and when" — has nothing to attach to. <code>NonEmptyFilter</code> cannot be affected
  by a change inside <code>CsvFormatter</code>, because it does not inherit from anything and
  cannot be called by it.</p>

  <div class="callout callout--note">
    <h4>The last two output lines are the point of the whole refactor</h4>
    <p>A titled,
    filtered TSV report and a plain TSV report existed the moment the pieces did. In the hierarchy
    they would have required duplicating <code>FilteredCsvReport</code> and
    <code>TitledFilteredCsvReport</code> for TSV — two more classes, containing copies of code that
    already existed, which then have to be kept in step.</p>
  </div>
</section>

<section id="delegates">
  <h2>The lightest form: a delegate</h2>

  <p>When exactly one method varies, an interface with one member and a class per implementation is
  more ceremony than the problem needs.</p>

  <p class="define"><span class="define__term">Delegate</span> A type whose values are methods.
  <code>Func&lt;decimal, decimal&gt;</code> is "a method taking a decimal and returning a decimal".
  A variable of that type can hold a named method or an inline expression, and calling it runs
  whatever it holds. Delegates get a full module later in Track 1.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-delegates.cs"><code>// 05-delegates.cs — when the varying part is a single method, a delegate is
// composition with no type to declare.
// .NET 10.0.400. Run: dotnet run 05-delegates.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

// ---- version A: inheritance ------------------------------------------------
abstract class PricerBase
{
    public decimal Price(decimal list) =&gt; Math.Round(Adjust(list), 2);
    protected abstract decimal Adjust(decimal list);
}
sealed class TenPercentOff : PricerBase { protected override decimal Adjust(decimal l) =&gt; l * 0.9m; }
sealed class FlatFiveOff : PricerBase { protected override decimal Adjust(decimal l) =&gt; l - 5m; }

// ---- version B: an interface -----------------------------------------------
interface IAdjustment { decimal Adjust(decimal list); }
sealed class TenPercent : IAdjustment { public decimal Adjust(decimal l) =&gt; l * 0.9m; }
sealed class FlatFive : IAdjustment { public decimal Adjust(decimal l) =&gt; l - 5m; }

sealed class InterfacePricer
{
    private readonly IAdjustment _adjustment;
    public InterfacePricer(IAdjustment a) =&gt; _adjustment = a;
    public decimal Price(decimal list) =&gt; Math.Round(_adjustment.Adjust(list), 2);
}

// ---- version C: a delegate -------------------------------------------------
sealed class DelegatePricer
{
    private readonly Func&lt;decimal, decimal&gt; _adjust;
    public DelegatePricer(Func&lt;decimal, decimal&gt; adjust) =&gt; _adjust = adjust;
    public decimal Price(decimal list) =&gt; Math.Round(_adjust(list), 2);
}

class Program
{
    const int N = 20_000_000;

    static decimal R1(PricerBase p) { decimal t = 0; for (int i = 0; i &lt; N; i++) t += p.Price(100m); return t; }
    static decimal R2(InterfacePricer p) { decimal t = 0; for (int i = 0; i &lt; N; i++) t += p.Price(100m); return t; }
    static decimal R3(DelegatePricer p) { decimal t = 0; for (int i = 0; i &lt; N; i++) t += p.Price(100m); return t; }

    static void Time(string label, Func&lt;decimal&gt; body)
    {
        body();
        double best = double.MaxValue;
        for (int r = 0; r &lt; 5; r++)
        {
            var sw = Stopwatch.StartNew();
            var v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-28} {best,7:F1} ms   {best * 1e6 / N,5:F2} ns/call");
    }

    static void Main()
    {
        Console.WriteLine("Same result, three ways of varying one step:");
        Console.WriteLine($"  inheritance : {new TenPercentOff().Price(100m)}  {new FlatFiveOff().Price(100m)}");
        Console.WriteLine($"  interface   : {new InterfacePricer(new TenPercent()).Price(100m)}  " +
                          $"{new InterfacePricer(new FlatFive()).Price(100m)}");
        Console.WriteLine($"  delegate    : {new DelegatePricer(l =&gt; l * 0.9m).Price(100m)}  " +
                          $"{new DelegatePricer(l =&gt; l - 5m).Price(100m)}");

        Console.WriteLine();
        Console.WriteLine("Types declared to express two adjustments:");
        Console.WriteLine("  inheritance : 1 abstract base + 2 subclasses = 3");
        Console.WriteLine("  interface   : 1 interface + 2 implementations + 1 host = 4");
        Console.WriteLine("  delegate    : 1 host, and the adjustments are expressions = 1");

        Console.WriteLine();
        Console.WriteLine("Combining them is also an expression:");
        Func&lt;decimal, decimal&gt; tenThenFive = l =&gt; (l * 0.9m) - 5m;
        Console.WriteLine($"  10% then flat 5 off 100 : {new DelegatePricer(tenThenFive).Price(100m)}");
        var pipeline = new List&lt;Func&lt;decimal, decimal&gt;&gt; { l =&gt; l * 0.9m, l =&gt; l - 5m, l =&gt; l * 1.2m };
        Func&lt;decimal, decimal&gt; combined = pipeline.Aggregate&lt;Func&lt;decimal, decimal&gt;,
            Func&lt;decimal, decimal&gt;&gt;(l =&gt; l, (acc, f) =&gt; l =&gt; f(acc(l)));
        Console.WriteLine($"  10% off, 5 off, then 20% VAT : {new DelegatePricer(combined).Price(100m)}");

        Console.WriteLine();
        Console.WriteLine($"Cost, {N:N0} calls, best of 5:");
        Time("inheritance (virtual)", () =&gt; R1(new TenPercentOff()));
        Time("interface (composition)", () =&gt; R2(new InterfacePricer(new TenPercent())));
        Time("delegate", () =&gt; R3(new DelegatePricer(l =&gt; l * 0.9m)));
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Same result, three ways of varying one step:
  inheritance : 90.0  95
  interface   : 90.0  95
  delegate    : 90.0  95

Types declared to express two adjustments:
  inheritance : 1 abstract base + 2 subclasses = 3
  interface   : 1 interface + 2 implementations + 1 host = 4
  delegate    : 1 host, and the adjustments are expressions = 1

Combining them is also an expression:
  10% then flat 5 off 100 : 85.0
  10% off, 5 off, then 20% VAT : 102.00

Cost, 20,000,000 calls, best of 5:
  inheritance (virtual)          515.8 ms   25.79 ns/call
  interface (composition)        517.6 ms   25.88 ns/call
  delegate                       512.2 ms   25.61 ns/call</code></pre>

  <p class="define"><span class="define__term">Strategy</span> Supplying an algorithm as a value —
  an object or a delegate — so the code using it does not name the algorithm. The delegate version
  above is the strategy pattern with no pattern-shaped code in it.</p>

  <p><strong>All three cost the same:</strong> 25.6–25.9 ns per call, indistinguishable. What is
  being measured is the <code>decimal</code> arithmetic and the rounding, not the dispatch — the
  same lesson as the 3% figure in
  <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a>. Once a call does real
  work, how it was dispatched stops being visible.</p>

  <p>Choose a delegate when the varying thing is one operation with no state and no name worth
  having. Choose an interface when there are several related operations, when implementations
  carry state or dependencies, or when the implementations want names that appear in
  configuration and logs.</p>
</section>

<section id="the-cost">
  <h2>What composition costs at run time</h2>

  <p>Every layer is a real method call on a real object. Stacking them is not free, and the price
  is worth knowing rather than guessing.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-cost.cs"><code>// 03-cost.cs — what composition costs at run time: one extra indirection per
// wrapper layer.
//
// METHOD NOTE. Following the lesson from t1-11: each scenario gets its OWN loop
// method so scenarios do not share a dynamic-PGO type profile, and there is a
// control that does the same work with no wrapper at all.
//
// .NET 10.0.400, Release, x64. Run: dotnet run 03-cost.cs -c Release

using System;
using System.Diagnostics;

interface IStep { int Apply(int x); }

sealed class Core : IStep { public int Apply(int x) =&gt; x &amp; 7; }

sealed class Wrapper : IStep
{
    private readonly IStep _inner;
    public Wrapper(IStep inner) =&gt; _inner = inner;
    public int Apply(int x) =&gt; _inner.Apply(x);
}

// The inheritance equivalent: one class, one virtual call.
class BaseStep { public virtual int Apply(int x) =&gt; x &amp; 7; }
sealed class DerivedStep : BaseStep { public override int Apply(int x) =&gt; base.Apply(x); }

class Program
{
    const int N = 50_000_000;

    static long L0(int seed) { long s = 0; for (int i = 0; i &lt; N; i++) s += (i &amp; 7); return s; }
    static long L1(IStep st) { long s = 0; for (int i = 0; i &lt; N; i++) s += st.Apply(i); return s; }
    static long L2(IStep st) { long s = 0; for (int i = 0; i &lt; N; i++) s += st.Apply(i); return s; }
    static long L3(IStep st) { long s = 0; for (int i = 0; i &lt; N; i++) s += st.Apply(i); return s; }
    static long L4(IStep st) { long s = 0; for (int i = 0; i &lt; N; i++) s += st.Apply(i); return s; }
    static long L5(BaseStep st) { long s = 0; for (int i = 0; i &lt; N; i++) s += st.Apply(i); return s; }

    static IStep Nest(int layers)
    {
        IStep s = new Core();
        for (int i = 0; i &lt; layers; i++) s = new Wrapper(s);
        return s;
    }

    static void Time(string label, Func&lt;long&gt; body)
    {
        body();
        double best = double.MaxValue, worst = 0;
        for (int r = 0; r &lt; 5; r++)
        {
            var sw = Stopwatch.StartNew();
            long s = body();
            sw.Stop();
            if (s == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
            worst = Math.Max(worst, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-34} best {best,7:F1} ms   worst {worst,7:F1} ms   " +
                          $"{best * 1e6 / N,5:F2} ns/call");
    }

    static void Main()
    {
        Console.WriteLine($"N = {N:N0} calls per run, best and worst of 5");
        Console.WriteLine();
        Time("no call at all (control)", () =&gt; L0(0));
        Time("inheritance: 1 virtual call", () =&gt; L5(new DerivedStep()));
        Time("composition: 0 wrappers", () =&gt; L1(Nest(0)));
        Time("composition: 1 wrapper", () =&gt; L2(Nest(1)));
        Time("composition: 3 wrappers", () =&gt; L3(Nest(3)));
        Time("composition: 8 wrappers", () =&gt; L4(Nest(8)));
    }
}</code></pre>

  <p>Three independent samples, 50 million calls each:</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Shape</th><th>Sample 1</th><th>Sample 2</th><th>Sample 3</th><th>ns/call</th></tr></thead>
    <tbody>
      <tr><td>no call at all (control)</td><td>58.5 ms</td><td>57.9 ms</td><td>58.1 ms</td><td>1.16</td></tr>
      <tr><td>inheritance: 1 virtual call</td><td>37.6 ms</td><td>37.2 ms</td><td>39.6 ms</td><td>0.75</td></tr>
      <tr><td>composition: 0 wrappers</td><td>39.7 ms</td><td>38.1 ms</td><td>37.7 ms</td><td>0.77</td></tr>
      <tr><td>composition: 1 wrapper</td><td>159.5 ms</td><td>172.3 ms</td><td>159.2 ms</td><td>3.19</td></tr>
      <tr><td>composition: 3 wrappers</td><td>419.1 ms</td><td>415.4 ms</td><td>425.9 ms</td><td>8.38</td></tr>
      <tr><td>composition: 8 wrappers</td><td>1157 ms</td><td>1130 ms</td><td>1209 ms</td><td>23.14</td></tr>
    </tbody>
  </table>
  </div>

  <p><strong>Each delegation layer costs about 2.5 nanoseconds.</strong> The wrapper rows are
  linear: 0.77, 3.19, 8.38, 23.14 ns for 0, 1, 3 and 8 layers — roughly 2.5 to 2.8 ns per layer,
  reproducible across all three samples.</p>

  <p><strong>Zero wrappers costs nothing.</strong> A single interface call with one implementation
  is 0.77 ns against 0.75 for the inheritance version: the JIT devirtualises and inlines both, as
  <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a> measured. Composition
  only starts costing when you actually stack layers, and then it costs per layer.</p>

  <div class="callout callout--note">
    <h4>The control row is anomalous, and reporting it is more useful than hiding it</h4>
    <p>A loop with <em>no call at all</em> measured consistently <em>slower</em> (1.16 ns) than the
    same loop with one inlined virtual call (0.75 ns), across all three samples. That cannot be a
    real cost of not calling a method; it is a codegen difference between two loop bodies at a
    scale where 20 ns per 50 million iterations shows up. The lesson for reading any benchmark
    like this: <strong>only compare rows that share a loop shape.</strong> The four wrapper rows
    do, which is why the 2.5 ns-per-layer figure is trustworthy while "wrappers versus no call at
    all" is not.</p>
  </div>

  <p>Whether 2.5 ns per layer matters follows the rule established in the previous module: multiply
  by the call count and express it as a fraction of the real work. Eight layers on a request
  handled 1,000 times a second costs 23 microseconds a second — invisible. Eight layers inside a
  loop over ten million rows costs 230 milliseconds, and belongs outside the loop.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <p>This is the section the usual advice omits. A wrapper is a <em>different object</em> from the
  thing it wraps, and everything that asks a question about the object gets an answer about the
  wrapper.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-what-wrapping-costs.cs"><code>// 04-what-wrapping-costs.cs — composition is not free of consequences. A
// wrapper is a different object from the thing it wraps, and code that asks
// questions about the object gets answers about the wrapper.
// .NET 10.0.400. Run: dotnet run 04-what-wrapping-costs.cs

using System;
using System.Collections.Generic;
using System.Linq;

interface IHandler
{
    string Name { get; }
    string Handle(string request);
}

sealed class OrderHandler : IHandler
{
    public string Name =&gt; "orders";
    public string Handle(string r) =&gt; $"handled({r})";
}

// A capability only some handlers have.
interface IBatchCapable { string HandleBatch(string[] requests); }

sealed class BatchOrderHandler : IHandler, IBatchCapable
{
    public string Name =&gt; "orders";
    public string Handle(string r) =&gt; $"handled({r})";
    public string HandleBatch(string[] rs) =&gt; $"batch({rs.Length})";
}

sealed class Logging : IHandler
{
    private readonly IHandler _inner;
    public Logging(IHandler inner) =&gt; _inner = inner;
    public string Name =&gt; _inner.Name;              // forwarded on purpose
    public string Handle(string r) =&gt; $"log[{_inner.Handle(r)}]";
}

// The forwarding version: it passes the capability through when the inner one
// has it. Note the amount of code this takes for ONE extra interface.
sealed class LoggingForwarding : IHandler, IBatchCapable
{
    private readonly IHandler _inner;
    public LoggingForwarding(IHandler inner) =&gt; _inner = inner;
    public string Name =&gt; _inner.Name;
    public string Handle(string r) =&gt; $"log[{_inner.Handle(r)}]";

    public string HandleBatch(string[] rs) =&gt;
        _inner is IBatchCapable b
            ? $"log[{b.HandleBatch(rs)}]"
            : throw new NotSupportedException("inner handler is not batch capable");
}

class Program
{
    static void Main()
    {
        IHandler bare = new BatchOrderHandler();
        IHandler wrapped = new Logging(bare);
        IHandler forwarding = new LoggingForwarding(bare);

        Console.WriteLine("--- 1. a type test sees the wrapper, not the inner object ---");
        Console.WriteLine($"  bare       is IBatchCapable : {bare is IBatchCapable}");
        Console.WriteLine($"  wrapped    is IBatchCapable : {wrapped is IBatchCapable}");
        Console.WriteLine($"  forwarding is IBatchCapable : {forwarding is IBatchCapable}");
        Console.WriteLine("  Wrapping silently removed a capability the caller could detect.");

        Console.WriteLine();
        Console.WriteLine("--- 2. GetType() reports the wrapper ---");
        foreach (var h in new[] { bare, wrapped, forwarding })
            Console.WriteLine($"  Name={h.Name,-8} GetType()={h.GetType().Name}");
        Console.WriteLine("  Logging by GetType().Name now logs 'Logging' for every handler.");

        Console.WriteLine();
        Console.WriteLine("--- 3. reference identity is lost ---");
        Console.WriteLine($"  ReferenceEquals(bare, wrapped) : {ReferenceEquals(bare, wrapped)}");
        var registry = new HashSet&lt;IHandler&gt; { bare };
        Console.WriteLine($"  registry.Contains(bare)    : {registry.Contains(bare)}");
        Console.WriteLine($"  registry.Contains(wrapped) : {registry.Contains(wrapped)}");
        Console.WriteLine("  Any bookkeeping keyed on the object misses the wrapped one.");

        Console.WriteLine();
        Console.WriteLine("--- 4. the forwarding version works, and costs ---");
        Console.WriteLine($"  ((IBatchCapable)forwarding).HandleBatch(3 items) : " +
                          $"{((IBatchCapable)forwarding).HandleBatch(new[] { "a", "b", "c" })}");
        var overNonBatch = new LoggingForwarding(new OrderHandler());
        try
        {
            ((IBatchCapable)overNonBatch).HandleBatch(new[] { "a" });
        }
        catch (NotSupportedException ex)
        {
            Console.WriteLine($"  wrapping a non-batch handler: {ex.GetType().Name}");
        }
        Console.WriteLine("  ...and it now CLAIMS IBatchCapable even when the inner one is not,");
        Console.WriteLine("  so the type test lies in the other direction.");

        Console.WriteLine();
        Console.WriteLine("--- 5. the stack trace goes through every layer ---");
        IHandler deep = new Logging(new Logging(new Logging(new ThrowingHandler())));
        try
        {
            deep.Handle("x");
        }
        catch (InvalidOperationException ex)
        {
            var frames = ex.StackTrace!.Split('\n')
                .Select(l =&gt; l.Trim())
                .Where(l =&gt; l.StartsWith("at "))
                .ToArray();
            Console.WriteLine($"  frames in the trace: {frames.Length}");
            foreach (var f in frames.Take(6))
                Console.WriteLine($"    {f.Split(" in ")[0]}");
        }
    }
}

sealed class ThrowingHandler : IHandler
{
    public string Name =&gt; "throwing";
    public string Handle(string r) =&gt; throw new InvalidOperationException("downstream failed");
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. a type test sees the wrapper, not the inner object ---
  bare       is IBatchCapable : True
  wrapped    is IBatchCapable : False
  forwarding is IBatchCapable : True
  Wrapping silently removed a capability the caller could detect.

--- 2. GetType() reports the wrapper ---
  Name=orders   GetType()=BatchOrderHandler
  Name=orders   GetType()=Logging
  Name=orders   GetType()=LoggingForwarding
  Logging by GetType().Name now logs 'Logging' for every handler.

--- 3. reference identity is lost ---
  ReferenceEquals(bare, wrapped) : False
  registry.Contains(bare)    : True
  registry.Contains(wrapped) : False
  Any bookkeeping keyed on the object misses the wrapped one.

--- 4. the forwarding version works, and costs ---
  ((IBatchCapable)forwarding).HandleBatch(3 items) : log[batch(3)]
  wrapping a non-batch handler: NotSupportedException
  ...and it now CLAIMS IBatchCapable even when the inner one is not,
  so the type test lies in the other direction.

--- 5. the stack trace goes through every layer ---
  frames in the trace: 5
    at ThrowingHandler.Handle(String r)
    at Logging.Handle(String r)
    at Logging.Handle(String r)
    at Logging.Handle(String r)
    at Program.Main()</code></pre>

  <h3>1. Wrapping hides capabilities</h3>

  <p class="define"><span class="define__term">Capability interface</span> A second, optional
  interface a type may also implement, which callers detect with a type test — here
  <code>IBatchCapable</code>. Common in framework code, and the thing decorators break most
  reliably.</p>

  <p>The inner handler supports batching. Wrap it in anything, and
  <code>wrapped is IBatchCapable</code> is <code>false</code>: the caller falls back to
  one-at-a-time processing, correctly and silently and much more slowly. Inheritance does not have
  this problem — a subclass keeps everything its base implemented.</p>

  <p>The fix is forwarding, and block 4 shows what it costs. <code>LoggingForwarding</code> must
  declare every optional interface it might pass through and delegate each member, and it then
  <em>claims</em> the capability whether the inner object has it or not — so the type test now
  gives a false positive instead of a false negative. There is no shape that is correct for both;
  this is a genuine limitation, not a coding error.</p>

  <h3>2. Identity and equality</h3>

  <p>The wrapper is not reference-equal to what it wraps, so a <code>HashSet</code>, a
  <code>Dictionary</code> keyed on the object, an event subscription list, or any "have I seen this
  one before" bookkeeping treats them as two different things. Code that registers the bare object
  and later looks up the wrapped one finds nothing.</p>

  <h3>3. Diagnostics change shape</h3>

  <p>Logging <code>GetType().Name</code> now reports the outermost wrapper for every object, so
  logs that identified which handler ran stop doing so. Stack traces gain a frame per layer — five
  frames here for three decorators — which is more informative in principle and, at eight layers,
  mostly noise between you and the line that threw.</p>

  <h3>4. Forwarding boilerplate</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="The cost nobody mentions"><code>// A decorator over an interface with eight members has to write all eight,
// even though seven of them do nothing but forward. C# has no delegation
// keyword, so this is typed out by hand and drifts when the interface grows.
sealed class LoggingRepository : IRepository
{
    private readonly IRepository _inner;
    public LoggingRepository(IRepository inner) =&gt; _inner = inner;

    public Order Get(string id) =&gt; _inner.Get(id);
    public void Save(Order o) =&gt; _inner.Save(o);
    public void Delete(string id) =&gt; _inner.Delete(id);
    public int Count() =&gt; _inner.Count();
    public bool Exists(string id) =&gt; _inner.Exists(id);
    public IReadOnlyList&lt;Order&gt; All() =&gt; _inner.All();
    public void Flush() =&gt; _inner.Flush();

    // the one member this class exists for
    public void Archive(string id)
    {
        Console.WriteLine($"archiving {id}");
        _inner.Archive(id);
    }
}</code></pre>

  <p>This is the strongest practical argument for narrow interfaces, and it connects directly to
  interface segregation from
  <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and Interfaces</a>:
  a wide interface makes every decorator expensive to write and easy to get wrong when the
  interface grows.</p>

  <h3>5. Layer ordering, which nothing checks</h3>

  <p>The second incident from the top of the module. Two correct layers, two possible orders, two
  different behaviours — and no compiler error, no warning, and no test that fails unless someone
  thought to write it.</p>

  <pre data-lang="console" data-title="The same two layers, both orders"><code>Cache(Audit(Work)) — cache OUTSIDE audit:
  call 1 -&gt; x!
  call 2 -&gt; x!
  log: work | audit:x! | cache:hit

Audit(Cache(Work)) — audit OUTSIDE cache:
  call 1 -&gt; x!
  call 2 -&gt; x!
  log: work | audit:x! | cache:hit | audit:x!

audit entries, cache outside : 1
audit entries, audit outside : 2</code></pre>

  <p>Both return the same answer to the caller. One records every request in the audit log and one
  records only the first. If the audit log is a compliance requirement, the first arrangement is a
  reportable failure, and the only artefact distinguishing them is the order of two lines in a
  startup file.</p>

  <h3>6. Over-composition</h3>

  <p class="define"><span class="define__term">God object</span> A class that has accumulated so
  many collaborators or responsibilities that understanding it means understanding all of them. A
  constructor taking twelve dependencies is the usual sign.</p>

  <p>Composition makes adding a dependency cheap, so dependencies accumulate. A class with a
  twelve-parameter constructor is as hard to reason about as a five-level hierarchy, in a different
  way: the hierarchy hides behaviour above you, and the object graph hides it beside you. The
  number of collaborators is itself a design signal.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>A capability stopped being detected</h4>
    <p>Symptom: a fast path silently stopped
    being taken, or a feature quietly turned itself off. Something in the chain is wrapped. Print
    the actual chain rather than guessing — give each decorator a <code>ToString()</code> that
    includes its inner object, or walk the graph with reflection over the private
    <code>_inner</code> field. Then check each optional interface against every layer, not only
    the outermost. The general rule: <em>a type test against a possibly-decorated object asks
    about the outermost layer only.</em></p>
  </div>

  <div class="callout callout--debug">
    <h4>Logs stopped identifying which implementation ran</h4>
    <p>You are logging
    <code>GetType().Name</code> on a decorated object. Give the interface a <code>Name</code>
    property that decorators forward — as <code>Logging</code> does above — and log that instead.
    It is one member of boilerplate and it survives any amount of wrapping.</p>
  </div>

  <div class="callout callout--debug">
    <h4>Behaviour differs between environments and the code is identical</h4>
    <p>Compare
    the composition roots, not the classes. The order layers are stacked in is usually assembled
    from configuration, so two environments can build genuinely different objects from the same
    binary. Log the assembled chain at startup — one line per service naming the layers in order —
    which turns an invisible difference into a diff.</p>
  </div>

  <div class="callout callout--debug">
    <h4>A stack trace is mostly forwarding frames</h4>
    <p>Read it from the top: the first
    frame that is not a one-line forward is where the work happened. If wrappers dominate,
    that is a signal about depth as well as a nuisance — eight layers means eight places a request
    can be modified, and no single file describes the path.</p>
  </div>

  <div class="callout callout--debug">
    <h4>Deciding whether a hierarchy should become composition</h4>
    <p>Count the axes of
    variation. If subclass names contain conjunctions — <code>RetryingEncryptedEmailSender</code>,
    <code>TitledFilteredCsvReport</code> — each conjunction is an axis, and the class count is
    already 2<sup>n</sup>. That naming pattern is the most reliable signal available, and it is
    visible in a file listing without reading any code.</p>
  </div>
</section>

<section id="production-example">
  <h2>Composition as it appears in a real service</h2>

  <p>The pieces are small classes; the interesting part is the <em>assembly</em>, which is data and
  therefore testable in its own right.</p>

  <pre data-lang="csharp" data-net="10" data-title="06-production.cs"><code>// 06-production.cs — composition as it actually appears in a service: small
// pieces, assembled once at startup from configuration, with the assembly
// itself being the thing you can test.
// .NET 10.0.400. Run: dotnet run 06-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct ChargeRequest(string OrderId, decimal Amount, string Currency);
public readonly record struct ChargeResult(bool Ok, string Detail, int Attempts);

public interface ICharger { ChargeResult Charge(ChargeRequest request); }

// ---- the one piece that talks to the outside world ------------------------
public sealed class GatewayCharger : ICharger
{
    private readonly Func&lt;ChargeRequest, bool&gt; _gateway;
    private int _calls;
    public int Calls =&gt; _calls;

    public GatewayCharger(Func&lt;ChargeRequest, bool&gt; gateway) =&gt; _gateway = gateway;

    public ChargeResult Charge(ChargeRequest r)
    {
        _calls++;
        return _gateway(r)
            ? new ChargeResult(true, "gateway accepted", 1)
            : new ChargeResult(false, "gateway declined", 1);
    }
}

// ---- each concern is one small class that holds an ICharger ---------------
public sealed class RetryingCharger : ICharger
{
    private readonly ICharger _inner;
    private readonly int _maxAttempts;

    public RetryingCharger(ICharger inner, int maxAttempts)
    {
        _inner = inner;
        _maxAttempts = maxAttempts &lt; 1
            ? throw new ArgumentOutOfRangeException(nameof(maxAttempts))
            : maxAttempts;
    }

    public ChargeResult Charge(ChargeRequest r)
    {
        ChargeResult last = default;
        for (int attempt = 1; attempt &lt;= _maxAttempts; attempt++)
        {
            last = _inner.Charge(r);
            if (last.Ok) return last with { Attempts = attempt };
        }
        return last with { Attempts = _maxAttempts };
    }
}

public sealed class ValidatingCharger : ICharger
{
    private static readonly HashSet&lt;string&gt; Supported =
        new(StringComparer.OrdinalIgnoreCase) { "GBP", "EUR", "USD" };
    private readonly ICharger _inner;
    public ValidatingCharger(ICharger inner) =&gt; _inner = inner;

    public ChargeResult Charge(ChargeRequest r)
    {
        if (r.Amount &lt;= 0m) return new ChargeResult(false, "amount must be positive", 0);
        if (!Supported.Contains(r.Currency))
            return new ChargeResult(false, $"unsupported currency {r.Currency}", 0);
        return _inner.Charge(r);
    }
}

public sealed class AuditingCharger : ICharger
{
    private readonly ICharger _inner;
    private readonly IList&lt;string&gt; _audit;
    public AuditingCharger(ICharger inner, IList&lt;string&gt; audit) =&gt; (_inner, _audit) = (inner, audit);

    public ChargeResult Charge(ChargeRequest r)
    {
        var result = _inner.Charge(r);
        _audit.Add($"{r.OrderId} {r.Amount:0.00} {r.Currency} -&gt; " +
                   $"{(result.Ok ? "ok" : "failed")} ({result.Detail}) after {result.Attempts}");
        return result;
    }
}

public sealed class IdempotentCharger : ICharger
{
    private readonly ICharger _inner;
    private readonly Dictionary&lt;string, ChargeResult&gt; _seen = new();
    public IdempotentCharger(ICharger inner) =&gt; _inner = inner;

    public ChargeResult Charge(ChargeRequest r)
    {
        if (_seen.TryGetValue(r.OrderId, out var cached))
            return cached with { Detail = cached.Detail + " (replayed)" };
        var result = _inner.Charge(r);
        _seen[r.OrderId] = result;
        return result;
    }
}

// ---- the assembly is data, and is the part worth testing ------------------
public sealed record ChargerOptions(bool Validate, int MaxAttempts, bool Audit, bool Idempotent);

public static class ChargerFactory
{
    // Order matters and is explicit here rather than implied by a class hierarchy.
    public static ICharger Build(
        Func&lt;ChargeRequest, bool&gt; gateway, ChargerOptions options, IList&lt;string&gt; audit)
    {
        ICharger charger = new GatewayCharger(gateway);
        if (options.MaxAttempts &gt; 1) charger = new RetryingCharger(charger, options.MaxAttempts);
        if (options.Validate) charger = new ValidatingCharger(charger);
        if (options.Audit) charger = new AuditingCharger(charger, audit);
        if (options.Idempotent) charger = new IdempotentCharger(charger);
        return charger;
    }
}

class Program
{
    static void Main()
    {
        var audit = new List&lt;string&gt;();
        int calls = 0;

        // A gateway that fails twice then succeeds, per order.
        var failures = new Dictionary&lt;string, int&gt;();
        bool Gateway(ChargeRequest r)
        {
            calls++;
            failures.TryGetValue(r.OrderId, out int n);
            failures[r.OrderId] = n + 1;
            return n &gt;= 2;
        }

        var charger = ChargerFactory.Build(
            Gateway,
            new ChargerOptions(Validate: true, MaxAttempts: 3, Audit: true, Idempotent: true),
            audit);

        Show(charger.Charge(new ChargeRequest("O-1", 25.00m, "GBP")));
        Show(charger.Charge(new ChargeRequest("O-1", 25.00m, "GBP")));   // replayed
        Show(charger.Charge(new ChargeRequest("O-2", -5.00m, "GBP")));
        Show(charger.Charge(new ChargeRequest("O-3", 10.00m, "JPY")));

        Console.WriteLine();
        Console.WriteLine($"gateway calls made: {calls}");
        Console.WriteLine("audit:");
        foreach (var a in audit) Console.WriteLine($"  {a}");

        Console.WriteLine();
        Console.WriteLine("--- the same pieces, a different configuration ---");
        var audit2 = new List&lt;string&gt;();
        var minimal = ChargerFactory.Build(
            _ =&gt; true,
            new ChargerOptions(Validate: false, MaxAttempts: 1, Audit: false, Idempotent: false),
            audit2);
        Show(minimal.Charge(new ChargeRequest("O-9", -1m, "XXX")));
        Console.WriteLine($"  audit entries: {audit2.Count} (auditing was switched off)");
        Console.WriteLine("  and a negative amount in an unsupported currency went through,");
        Console.WriteLine("  because validation is a layer rather than a base-class rule.");
    }

    static void Show(ChargeResult r) =&gt;
        Console.WriteLine($"  ok={r.Ok,-5} attempts={r.Attempts} {r.Detail}");
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>  ok=True  attempts=3 gateway accepted
  ok=True  attempts=3 gateway accepted (replayed)
  ok=False attempts=0 amount must be positive
  ok=False attempts=0 unsupported currency JPY

gateway calls made: 3
audit:
  O-1 25.00 GBP -&gt; ok (gateway accepted) after 3
  O-2 -5.00 GBP -&gt; failed (amount must be positive) after 0
  O-3 10.00 JPY -&gt; failed (unsupported currency JPY) after 0

--- the same pieces, a different configuration ---
  ok=True  attempts=1 gateway accepted
  audit entries: 0 (auditing was switched off)
  and a negative amount in an unsupported currency went through,
  because validation is a layer rather than a base-class rule.</code></pre>

  <p class="define"><span class="define__term">Composition root</span> The one place that decides
  which objects are created and how they are wired together — here <code>ChargerFactory.Build</code>,
  and in an ASP.NET Core application the service registration in <code>Program.cs</code>. Keeping
  it in one place is what makes the object graph reviewable.</p>

  <p class="define"><span class="define__term">Constructor injection</span> Supplying an object's
  collaborators through its constructor rather than having it create or locate them. Every class
  above does this, which is why each can be tested with a stub and why the ordering decision lives
  outside them.</p>

  <p>Four things in that output repay attention.</p>

  <p><strong>Four charges produced three audit entries.</strong> The replayed one is missing. That
  is the ordering hazard, in the module's own production example rather than in a contrived
  demonstration: <code>IdempotentCharger</code> is outside <code>AuditingCharger</code>, so a
  replay returns the cached result before the audit layer is reached. Whether that is correct
  depends on whether your compliance rule counts attempts or charges — and the code does not
  record which was intended.</p>

  <p><strong>The gateway was called three times for four charges.</strong> Retry accounts for the
  three on <code>O-1</code>; validation rejected two before reaching it. Layer order is why:
  <code>ValidatingCharger</code> is outside <code>RetryingCharger</code>, so invalid requests never
  reach the retry loop. Reverse them and a request with a negative amount would be retried three
  times before failing.</p>

  <p><strong>The options record is the design.</strong> <code>ChargerOptions</code> makes the shape
  of the assembled object explicit and comparable between environments. The single most useful
  thing to log at startup is the resulting chain.</p>

  <p><strong>Turning validation off is possible.</strong> With a base class owning validation in a
  non-virtual method, as in
  <a href="#/m/t1-10-inheritance">Inheritance</a>, it cannot be skipped. Here it is a layer, so a
  configuration mistake removes it. Composition moved a guarantee from the compiler to a startup
  file — a real loss, worth making deliberately.</p>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A concrete case</h4>
    <p>A billing service processed roughly 400,000 charge
    requests a day through a hierarchy that had reached five levels:
    <code>ChargeProcessor</code> → <code>RetryingChargeProcessor</code> →
    <code>AuditedRetryingChargeProcessor</code> → <code>IdempotentAuditedRetryingChargeProcessor</code>
    → two provider-specific leaves. Adding a provider meant a new leaf; adding a behaviour meant
    a new level for every leaf.</p>
    <p>The request that broke it: one provider needed retries <em>without</em> idempotency
    caching, because their API already deduplicated and the cache was masking legitimate repeat
    charges. There was no class for that combination, and no way to write one without duplicating
    two levels. The estimate for the change was three weeks.</p>
    <p>The rewrite to composition took four days and produced six small classes replacing eleven.
    The provider variant became one line in a configuration file. What made it four days rather
    than three weeks was that each behaviour became independently testable: the retry logic was
    tested against a stub gateway rather than through five levels of inheritance and a real
    provider.</p>
    <p><strong>And it introduced one bug, which is the part worth carrying.</strong> In the
    original hierarchy, auditing ran inside the idempotency level, so replayed requests were
    audited. In the rewrite the layers were stacked the other way round, and replayed charges
    stopped appearing in the compliance log. Nothing failed. It was found six weeks later during a
    reconciliation, at which point roughly 9,000 replayed requests had gone unrecorded. The fix
    was swapping two lines in the composition root.</p>
    <p>The change that prevented a recurrence was not a code change: it was a startup log line
    printing the assembled chain in order, plus a test asserting that chain. Composition makes the
    structure data, so the structure can be asserted — but only if someone decides to assert
    it.</p>
  </div>

  <p>The general principle: <strong>inheritance encodes structure in code the compiler checks;
  composition encodes it in objects assembled at run time, which nothing checks.</strong> That
  trade buys flexibility and costs a class of error that did not previously exist. Both halves are
  real, and the advice "prefer composition" is usually quoted without the second one.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"Prefer composition over inheritance means never use inheritance"</h4>
    <p>The
    template method in <a href="#/m/t1-10-inheritance">Inheritance</a> — a non-virtual public
    method owning an algorithm with one abstract hook — is inheritance doing something composition
    does more clumsily, and it makes a guarantee composition cannot: the steps cannot be reordered
    or skipped. Inheritance is the right tool for one axis of variation with enforced sequencing.
    It is the wrong tool for several axes.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Composition is slower because of the extra indirection"</h4>
    <p>Measured: 2.5 ns
    per layer, and zero for a single unwrapped implementation because the JIT inlines it. Eight
    layers at a thousand requests a second is 23 microseconds a second. The question is never
    whether indirection costs something; it is how many times per second you pay it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Wrapping is transparent to callers"</h4>
    <p>Three ways it is not, all
    demonstrated above: optional interfaces stop being detected, reference identity changes, and
    <code>GetType()</code> reports the wrapper. Frameworks that check capabilities with type tests
    — which is most of them — see the outermost layer only.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Once it is composed, the design is finished"</h4>
    <p>The order layers are stacked
    in is a design decision with no representation in any type, and it can differ between
    environments assembled from configuration. Log the chain, and assert it in a test, or you have
    moved a compile-time property into an untested one.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Injecting more dependencies makes a class more flexible"</h4>
    <p>Past about four
    it makes the class harder to understand than the hierarchy it replaced. A twelve-parameter
    constructor is a signal that the class has too many responsibilities, and the fix is to split
    the class rather than to keep composing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Composition avoids the fragile base class problem entirely"</h4>
    <p>It removes
    the inheritance form of it. The same shape returns as layer ordering, and as default interface
    methods written in terms of other members — see exercise 4 of
    <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and
    Interfaces</a>. The underlying hazard is <em>a hidden dependency between two pieces of code
    that look independent</em>, and composition relocates it rather than removing it.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Reach for</th><th>Because</th></tr></thead>
    <tbody>
      <tr>
        <td>Behaviour varies along two or more independent axes</td>
        <td>Composition</td>
        <td><em>d</em> + <em>n</em> classes instead of <em>d</em> × 2<sup>n</sup>, and combinations
        you did not anticipate cost nothing.</td>
      </tr>
      <tr>
        <td>One axis, and the sequence around it must be guaranteed</td>
        <td>Template method (inheritance)</td>
        <td>A non-virtual method owning the algorithm cannot be skipped or reordered. A layer
        can be left out of a configuration.</td>
      </tr>
      <tr>
        <td>Exactly one operation varies, with no state</td>
        <td>A delegate</td>
        <td>No interface and no class per variant; combinations are expressions. Same cost.</td>
      </tr>
      <tr>
        <td>Several related operations vary, or the variants carry state</td>
        <td>An interface plus implementations</td>
        <td>Names that appear in configuration and logs, and somewhere for dependencies to
        live.</td>
      </tr>
      <tr>
        <td>Adding a cross-cutting concern to something existing</td>
        <td>A decorator</td>
        <td>Stackable in any order and any number. Check what optional interfaces it hides.</td>
      </tr>
      <tr>
        <td>Subclass names contain conjunctions</td>
        <td>Refactor to composition</td>
        <td>Each conjunction is an axis. The class count is already exponential; it will get
        worse.</td>
      </tr>
      <tr>
        <td>Callers must treat several types interchangeably</td>
        <td>An interface — with or without a base class</td>
        <td>That is polymorphism, and it is orthogonal to whether you reuse code by inheriting or
        by holding.</td>
      </tr>
      <tr>
        <td>You need one class's behaviour and the is-a test fails</td>
        <td>Composition, always</td>
        <td>Inheriting drags the whole public surface onto yours and commits you to
        substitutability you cannot honour.</td>
      </tr>
      <tr>
        <td>A constructor has grown past about four dependencies</td>
        <td>Split the class</td>
        <td>Composition made adding them cheap; that is not the same as free.</td>
      </tr>
      <tr>
        <td>Layers are assembled from configuration</td>
        <td>Log the chain at startup and assert it in a test</td>
        <td>Ordering is a design decision no type records and no compiler checks.</td>
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
    <p>A system has 2 destinations and 6 optional behaviours. Give the class count for each
    approach, and say at what point the difference becomes decisive. Then say which single
    property of C# classes forces the inheritance number.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual counts"><code>behaviours | inheritance (2 x 2^n) | composition (2 + n)
         0 |                     2 |                   2
         1 |                     4 |                   3
         2 |                     8 |                   4
         3 |                    16 |                   5
         4 |                    32 |                   6
         5 |                    64 |                   7
         6 |                   128 |                   8</code></pre>
        <p>At six behaviours: <strong>128 classes against 8.</strong></p>
        <p><strong>Where it becomes decisive</strong> is around two to three behaviours — 8 or 16
        classes. Below that the counts are close enough that other considerations dominate. The
        important point is that the decision is usually made at <em>one</em> behaviour, when the
        counts are 4 and 3 and inheritance looks harmless, and nobody revisits it as the numbers
        grow. Each individual step adds only two classes.</p>
        <p><strong>The property forcing it: single inheritance.</strong> A C# class has exactly one
        base class, so "retrying" and "encrypted" cannot both be expressed as a base. The only way
        to have both is a class that inherits from one and re-implements the other — which is why
        the combinations multiply rather than add. Composition has no such limit because an object
        can hold as many other objects as it likes.</p>
        <p>Worth noting the ordering multiplier as well. The table assumes each combination needs
        one class. If both encrypt-then-retry and retry-then-encrypt are required, the inheritance
        count grows further, while the composed version expresses both with the classes it already
        has.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A monitoring dashboard reads cache hit counts. After a release that added timing, the
    dashboard shows zero hits for every cache, though caching demonstrably still works. Predict the
    two outputs below, explain the cause, and give two fixes with the trade-off of each.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>interface ICache { string? Get(string key); }
interface IStatsReporting { int Hits { get; } }

sealed class MemoryCache : ICache, IStatsReporting { /* counts hits */ }

sealed class TimingCache : ICache
{
    private readonly ICache _inner;
    public TimingCache(ICache inner) =&gt; _inner = inner;
    public string? Get(string k) =&gt; _inner.Get(k);
}

ICache bare = new MemoryCache();
ICache wrapped = new TimingCache(bare);
Console.WriteLine(bare is IStatsReporting);
Console.WriteLine(wrapped is IStatsReporting);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>bare    is IStatsReporting : True
wrapped is IStatsReporting : False
hits recorded on the inner cache : 2</code></pre>
        <p><strong>The cause.</strong> The dashboard finds caches and type-tests them for
        <code>IStatsReporting</code>. Once each cache is wrapped in a <code>TimingCache</code>,
        the object the dashboard holds is the wrapper, which does not implement that interface. The
        test fails, the dashboard skips the cache, and reports zero. The counting still happens —
        the inner cache recorded 2 hits — and there is no longer a path to the number.</p>
        <p>Note how quiet this is. No exception, no log, and the feature that broke is in a
        different component from the one that changed.</p>
        <p><strong>Fix one: forward the capability.</strong></p>
<pre data-lang="csharp" data-net="10" data-title="Fix one"><code>sealed class TimingCache : ICache, IStatsReporting
{
    private readonly ICache _inner;
    public TimingCache(ICache inner) =&gt; _inner = inner;
    public string? Get(string k) =&gt; _inner.Get(k);

    public int Hits =&gt; _inner is IStatsReporting s
        ? s.Hits
        : throw new NotSupportedException("inner cache does not report stats");
}</code></pre>
        <p>Trade-off: the wrapper now <em>claims</em> <code>IStatsReporting</code> unconditionally,
        so wrapping a cache that does not report stats produces a type test that passes and a call
        that throws. The false negative has become a false positive. There is no shape that is
        correct in both directions, which is the honest limitation of decorating over optional
        interfaces.</p>
        <p><strong>Fix two: stop using a capability interface.</strong> Put <code>Hits</code> on
        <code>ICache</code> itself, returning <code>null</code> or zero for caches that do not
        count. Every decorator then forwards it like any other member, and the type test
        disappears. Trade-off: every implementor must now supply a member most of them do not care
        about — which is the interface segregation cost from
        <a href="#/m/t1-12-abstraction-and-interfaces">Abstraction, Abstract Classes, and
        Interfaces</a>, paid deliberately to remove a whole failure mode.</p>
        <p><strong>Which to choose.</strong> Fix two, when you own the interface and the number of
        implementors is manageable — it converts a silent runtime failure into a compile-time
        obligation. Fix one, when the interface is published and you cannot change it, accepting
        that the type test now needs a matching runtime check.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>The same two decorators, stacked both ways. Predict both logs and both audit-entry counts,
    then say which arrangement is correct — and what makes that question answerable at all.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>// Work appends "!" and logs "work".
// Audit calls inner, then logs "audit:&lt;result&gt;".
// Cache returns a remembered result and logs "cache:hit", otherwise calls inner.

IStep cacheOutside = new Cache(new Audit(new Work()));
cacheOutside.Run("x", log1);
cacheOutside.Run("x", log1);

IStep auditOutside = new Audit(new Cache(new Work()));
auditOutside.Run("x", log2);
auditOutside.Run("x", log2);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>Cache(Audit(Work)) — cache OUTSIDE audit:
  call 1 -&gt; x!
  call 2 -&gt; x!
  log: work | audit:x! | cache:hit

Audit(Cache(Work)) — audit OUTSIDE cache:
  call 1 -&gt; x!
  call 2 -&gt; x!
  log: work | audit:x! | cache:hit | audit:x!

audit entries, cache outside : 1
audit entries, audit outside : 2</code></pre>
        <p><strong>What happened.</strong> With the cache outermost, the second call is answered
        from the cache and never reaches the audit layer: one audit entry for two requests. With
        the audit outermost, every request passes through it regardless of whether the cache
        answered: two entries. Both return the identical value to the caller, and both classes are
        correct in isolation.</p>
        <p><strong>Which is correct depends on what the audit is for</strong>, and that is the real
        answer:</p>
        <ul>
          <li>If the audit answers "what did we compute?" — a record of real work, for cost or
          capacity — then <strong>cache outside</strong> is right, and auditing cache hits would
          overstate the work done.</li>
          <li>If it answers "what did we tell each caller?" — a compliance or access log — then
          <strong>audit outside</strong> is right, and the other arrangement loses records of
          requests that were genuinely served.</li>
        </ul>
        <p>The compliance case is the one that bites, because the failure is an absence: no
        exception, no wrong answer, only fewer rows than there should be, discovered during a
        reconciliation months later.</p>
        <p><strong>What makes the question answerable</strong> is having written down what the
        audit log means. Neither class states it, the interface cannot express it, and the compiler
        cannot check it. The practical defences are a comment at the composition root saying why
        the order is what it is, a startup log line naming the layers in order, and a test that
        asserts the assembled chain. That test is the only mechanism here that would fail if
        someone reordered the layers.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Refactor this four-level hierarchy to composition. Your version must produce identical
    output <em>and</em> an identical trace, and must additionally support a combination the
    hierarchy cannot express: a titled, filtered TSV report. Then say what the refactor gave up.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 4 — as given"><code>abstract class ReportBase
{
    protected readonly List&lt;string&gt; Log = new();
    public string Run(string[] rows)
    {
        Log.Clear();
        return Decorate(Format(Filter(rows)));
    }
    protected virtual string[] Filter(string[] rows) =&gt; rows;
    protected abstract string Format(string[] rows);
    protected virtual string Decorate(string body) =&gt; body;
}

class CsvReport : ReportBase { /* Format -&gt; joins with commas, logs "format:csv" */ }
class FilteredCsvReport : CsvReport { /* Filter -&gt; drops blanks, logs "filter:nonempty" */ }
class TitledFilteredCsvReport : FilteredCsvReport { /* Decorate -&gt; adds "# title" */ }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The move.</strong> Each <code>protected virtual</code> hook becomes an interface
        with independent implementations, and the algorithm stays where it was:</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4 — the refactor"><code>interface IRowFilter { string[] Apply(string[] rows, IList&lt;string&gt; log); }
interface IRowFormatter { string Format(string[] rows, IList&lt;string&gt; log); }
interface IDecorator { string Decorate(string body, IList&lt;string&gt; log); }

sealed class Report
{
    private readonly IRowFilter _filter;
    private readonly IRowFormatter _formatter;
    private readonly IDecorator _decorator;
    private readonly List&lt;string&gt; _log = new();

    public Report(IRowFilter filter, IRowFormatter formatter, IDecorator decorator)
        =&gt; (_filter, _formatter, _decorator) = (filter, formatter, decorator);

    public IReadOnlyList&lt;string&gt; Trace =&gt; _log;

    public string Run(string[] rows)
    {
        _log.Clear();
        var filtered = _filter.Apply(rows, _log);
        var formatted = _formatter.Format(filtered, _log);
        return _decorator.Decorate(formatted, _log);
    }
}</code></pre>
        <p>Plus five small implementations: <code>NonEmptyFilter</code>,
        <code>PassThroughFilter</code>, <code>CsvFormatter</code>, <code>TsvFormatter</code>,
        <code>TitleDecorator</code>, <code>NoDecorator</code>.</p>
        <pre data-lang="console" data-title="Verified equivalence"><code>outputs identical : True
traces identical  : True</code></pre>
        <p>And the combination the hierarchy had no class for:</p>
        <pre data-lang="console" data-title="The new combination"><code>| # Sales
| id&lt;TAB&gt;name&lt;TAB&gt;amount</code></pre>
        <p><strong>Count what changed.</strong> Before: 4 classes covering 1 combination. After: 1
        host + 6 pieces = 7 classes covering 2 filters × 2 formatters × 2 decorators = 8
        combinations. More classes for this example, and the curve is the opposite way round —
        adding a formatter now adds one class and four combinations.</p>
        <p><strong>What the refactor gave up.</strong> Four things, and being able to name them is
        the point of the exercise:</p>
        <ol>
          <li><strong>The "do nothing" defaults became explicit classes.</strong>
          <code>PassThroughFilter</code> and <code>NoDecorator</code> replace what was a
          <code>protected virtual</code> method body — two classes that used to be zero lines. The
          compensation is that the default is now nameable in configuration.</li>
          <li><strong>Illegal combinations became expressible.</strong> The hierarchy could not
          produce a titled report with no formatter, because the type system prevented it. Now any
          three pieces can be passed to the constructor, and validating the combination is your
          job.</li>
          <li><strong>The log had to become a parameter.</strong> It was <code>protected</code>
          state shared down the hierarchy; the pieces do not inherit from anything, so it is passed
          in. That is more honest — the dependency is now visible in every signature — and it is
          more typing.</li>
          <li><strong>Construction got wordier.</strong> <code>new TitledFilteredCsvReport("Sales")</code>
          became a three-argument constructor call. In a real service this moves to a composition
          root or a DI container, which is a better place for it, and it is a step further from the
          call site.</li>
        </ol>
        <p><strong>What it gained</strong> beyond the combinations: each piece is testable without
        constructing a report, no piece can be broken by a change in another, and the fragile base
        class problem from <a href="#/m/t1-10-inheritance">Inheritance</a> has nothing to attach
        to — there is no base calling its own overridable members.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>Give the class-count formula for each approach, and the property of C# that forces the
      inheritance one.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Inheritance: <em>d</em> × 2<sup>n</sup>. Composition: <em>d</em> + <em>n</em>. At 2
        destinations and 6 behaviours that is 128 against 8. The forcing property is
        <strong>single inheritance</strong> — a class has one base, so two independent behaviours
        cannot both be expressed as a base and each combination needs its own class.</p>
      </div></details>
    </li>
    <li>
      <p>What is the naming signal that a hierarchy has more than one axis of variation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Conjunctions in subclass names</strong> —
        <code>RetryingEncryptedEmailSender</code>, <code>TitledFilteredCsvReport</code>. Each
        conjunction is an axis, so the class count is already exponential. It is visible in a file
        listing without reading any code.</p>
      </div></details>
    </li>
    <li>
      <p>What did a delegation layer measure at, and what is the cost of a single unwrapped
      implementation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>About <strong>2.5 ns per layer</strong> (0.77, 3.19, 8.38, 23.14 ns for 0, 1, 3, 8
        layers). A single unwrapped implementation costs <strong>nothing</strong> — 0.77 ns against
        0.75 for the inheritance equivalent, because the JIT devirtualises and inlines both.</p>
      </div></details>
    </li>
    <li>
      <p>Why should you only compare benchmark rows that share a loop shape?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Because codegen differs between loop bodies at a scale that swamps the effect being
        measured. In this module the no-call control measured consistently <em>slower</em>
        (1.16 ns) than a loop with one inlined virtual call (0.75 ns) — impossible as a real cost.
        The four wrapper rows share a shape, which is why the per-layer figure is trustworthy.</p>
      </div></details>
    </li>
    <li>
      <p>Name three things a caller can observe that change when an object is wrapped.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Optional interfaces stop being detected (<code>wrapped is IBatchCapable</code> is
        false); reference identity changes, so dictionary and set lookups keyed on the object miss;
        and <code>GetType()</code> reports the wrapper, so logs identifying the implementation stop
        doing so. Stack traces also gain a frame per layer.</p>
      </div></details>
    </li>
    <li>
      <p>Why is forwarding a capability interface not a complete fix?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The wrapper must declare the interface unconditionally, so it claims the capability even
        when the object it wraps lacks it — turning a false negative into a false positive that
        throws at run time. No decorator shape is correct in both directions; it is a genuine
        limitation, not a coding error.</p>
      </div></details>
    </li>
    <li>
      <p>Two correct layers, two orders, two behaviours. Which arrangement audits every request,
      and which loses records?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Audit outside cache</strong> records every request. <strong>Cache outside
        audit</strong> short-circuits on a hit, so repeat requests are never audited — one entry
        for two requests. Both return the same value to the caller, and nothing reports the
        difference.</p>
      </div></details>
    </li>
    <li>
      <p>Which is correct, and what makes that question answerable?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It depends what the audit means: "what did we compute?" wants cache outside; "what did
        we tell each caller?" wants audit outside. It is answerable only if someone wrote down what
        the log is for. No type expresses it and no compiler checks it — the defences are a comment
        at the composition root, a startup log of the chain, and a test asserting it.</p>
      </div></details>
    </li>
    <li>
      <p>What guarantee does the template method make that composition cannot?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>That the steps <strong>cannot be skipped or reordered</strong>. A non-virtual public
        method owning the sequence is enforced by the compiler; a layer can be left out of a
        configuration or stacked in the wrong order. The production example shows this — turning
        validation off is a one-line configuration change.</p>
      </div></details>
    </li>
    <li>
      <p>When is a delegate the right form of composition, and when is an interface?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <strong>delegate</strong> when exactly one operation varies, with no state and no name
        worth having — combinations become expressions. An <strong>interface</strong> when several
        related operations vary, when implementations carry state or dependencies, or when the
        variants need names that appear in configuration and logs. Both cost the same at run
        time.</p>
      </div></details>
    </li>
    <li>
      <p>What is a composition root, and what should it emit at startup?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The single place deciding which objects are created and how they are wired — a factory
        method, or service registration in <code>Program.cs</code>. It should <strong>log the
        assembled chain in order</strong>, because the ordering is a design decision no type
        records, and two environments can build different objects from the same binary.</p>
      </div></details>
    </li>
    <li>
      <p>Composition removes the fragile base class problem. What replaces it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Layer ordering, and defaults written in terms of other members. The underlying hazard is
        <strong>a hidden dependency between two pieces of code that look independent</strong>;
        composition relocates it from the inheritance chain to the assembly, where nothing checks
        it either. Composition trades a compile-checked structure for a run-time one.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
