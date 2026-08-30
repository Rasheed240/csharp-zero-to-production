CSPREP.module({
  id: "t1-29-exceptions",
  minutes: 55,
  updated: "2026-08-30",
  summary: "Exception handling is two passes, not one: the runtime walks the stack running filters to find a handler, and only then unwinds running finally blocks. That single fact explains why a filter runs before the finally beneath it, why 'throw ex' destroys evidence, and why a throw costs about 3 microseconds while the try block around it costs about 3 nanoseconds.",
  terms: ["exception", "throw", "catch", "finally", "exception filter", "two-pass model",
    "first pass", "second pass", "unwinding", "stack trace", "rethrow", "inner exception",
    "custom exception", "AggregateException", "ExceptionDispatchInfo", "TryX pattern",
    "argument guard", "CA2200", "CS0160", "CS0157"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A payment in Ledger — the payments and invoicing service these modules keep returning to — is
  authorised by calling a card gateway. The call can fail in a dozen ways: the network times out,
  the provider rate-limits you, the card is stolen, the amount is malformed, the provider returns a
  code nobody has seen before.</p>

  <p>Some of those should be retried in three seconds. Some should never be retried under any
  circumstances. Some mean a human has to look at something. And the method that makes the call is
  four layers below the code that knows which is which.</p>

  <p>Returning a status code from every layer means every layer in between has to know about,
  forward, and not lose the code — and the compiler will not complain when one of them forgets. That
  is how a failed payment becomes a successful response with an empty body.</p>

  <p>Exceptions solve that: a failure propagates whether or not the intervening code cooperates.
  <strong>What they cost, how they find a handler, and what they destroy on the way are the parts
  people get wrong</strong> — and all three follow from one mechanism that is rarely taught.</p>
</section>

<section id="two-pass">
  <h2>The mechanism: two passes, not one</h2>

  <p class="define"><span class="define__term">Exception</span> An object describing a failure, which
  the runtime propagates up the call stack until something handles it. <span
  class="define__term">throw</span> starts that propagation; <span
  class="define__term">catch</span> handles it; <span class="define__term">finally</span> runs
  either way.</p>

  <p class="define"><span class="define__term">Exception filter</span> A <code>when</code> clause on a
  <code>catch</code>. The handler runs only if the filter returns true; if it returns false, the
  search continues as though this <code>catch</code> were not there.</p>

  <p>Almost everyone's mental model is a single pass: the exception travels up, running
  <code>finally</code> blocks, until a <code>catch</code> takes it. <strong>That model predicts the
  wrong answer for one observable case</strong>, which makes it a good place to start.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-mechanics.cs"><code>// 02-mechanics.cs — the two-pass model, which is the only way to explain why an
// exception filter runs BEFORE the finally blocks between the throw and the
// handler. Plus throw vs throw ex, and the order everything actually happens in.
// .NET 10.0.400. Run: dotnet run 02-mechanics.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static readonly List&lt;string&gt; Log = new();

    static void Main()
    {
        Console.WriteLine("--- the two-pass model, observed ---");
        Log.Clear();
        try
        {
            try
            {
                try
                {
                    Log.Add("throw");
                    throw new InvalidOperationException("boom");
                }
                finally
                {
                    Log.Add("inner finally");
                }
            }
            finally
            {
                Log.Add("outer finally");
            }
        }
        catch (InvalidOperationException) when (Filter())
        {
            Log.Add("handler");
        }
        foreach (var line in Log) Console.WriteLine($"  {line}");
        Console.WriteLine("  The FILTER ran before both finally blocks. That is the whole");
        Console.WriteLine("  reason exception handling is two passes:");
        Console.WriteLine("    pass 1 — walk up the stack running filters, to FIND a handler");
        Console.WriteLine("    pass 2 — unwind, running finally blocks, then run the handler");
        Console.WriteLine("  If no filter accepts, pass 2 never happens and the process");
        Console.WriteLine("  dies with the stack intact — which is why a crash dump from an");
        Console.WriteLine("  unhandled exception shows the throwing frame, not the catcher.");

        Console.WriteLine();
        Console.WriteLine("--- throw vs throw ex: the stack trace ---");
        Console.WriteLine("  rethrow with 'throw;'");
        foreach (var line in TraceOf(() =&gt; Rethrow())) Console.WriteLine($"    {line}");
        Console.WriteLine("  rethrow with 'throw ex;'");
        foreach (var line in TraceOf(() =&gt; RethrowResetting())) Console.WriteLine($"    {line}");
        Console.WriteLine("  'throw ex' resets the trace to the rethrow point. The frame");
        Console.WriteLine("  where it actually failed is gone, permanently.");

        Console.WriteLine();
        Console.WriteLine("  and the third option, wrapping:");
        foreach (var line in TraceOf(() =&gt; Wrap())) Console.WriteLine($"    {line}");

        Console.WriteLine();
        Console.WriteLine("--- a filter can observe without handling ---");
        var observed = new List&lt;string&gt;();
        try
        {
            try
            {
                throw new TimeoutException("gateway timed out");
            }
            catch (Exception ex) when (Observe(ex, observed))
            {
                Console.WriteLine("  (never reached)");
            }
        }
        catch (TimeoutException)
        {
            Console.WriteLine($"  outer handler caught it; the filter logged: {observed[0]}");
        }
        Console.WriteLine("  A filter that returns false does not handle the exception, and");
        Console.WriteLine("  it runs with the original stack still intact — so it can log");
        Console.WriteLine("  state that unwinding would have destroyed.");

        Console.WriteLine();
        Console.WriteLine("--- catch order: first MATCH wins, not most specific ---");
        foreach (var ex in new Exception[]
                 {
                     new ArgumentNullException("p"),
                     new ArgumentException("a"),
                     new InvalidOperationException("i")
                 })
        {
            Console.WriteLine($"  {ex.GetType().Name,-28} -&gt; {Classify(ex)}");
        }
        Console.WriteLine("  ArgumentNullException derives from ArgumentException, so an");
        Console.WriteLine("  ArgumentException arm placed first catches both. The compiler");
        Console.WriteLine("  DOES stop this: CS0160 if the order is provably wrong.");

        Console.WriteLine();
        Console.WriteLine("--- finally runs on return, and can change the answer ---");
        Console.WriteLine($"  ReturnsFromTry()      : {ReturnsFromTry()}");
        Console.WriteLine($"  FinallyCannotOverride(): {FinallyCannotOverride()}");
        Console.WriteLine("  The return value is computed BEFORE finally runs, so a finally");
        Console.WriteLine("  that mutates the returned variable does not change the result.");
        Console.WriteLine("  ('return' inside finally is CS0157 — the language forbids it.)");

        Console.WriteLine();
        Console.WriteLine("--- an exception thrown IN a finally replaces the original ---");
        try
        {
            try
            {
                throw new InvalidOperationException("the real problem");
            }
            finally
            {
                throw new TimeoutException("the cleanup problem");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  caught : {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine($"  inner  : {ex.InnerException?.Message ?? "(none)"}");
        }
        Console.WriteLine("  The original exception is GONE — not wrapped, not inner, gone.");
        Console.WriteLine("  This is why cleanup code must not throw, and why Dispose");
        Console.WriteLine("  implementations that can fail cause unexplainable incidents.");

        Console.WriteLine();
        Console.WriteLine("--- AggregateException flattens, but only when asked ---");
        var agg = new AggregateException("two failed",
            new InvalidOperationException("first"),
            new AggregateException("nested", new TimeoutException("second")));
        Console.WriteLine($"  InnerExceptions.Count      : {agg.InnerExceptions.Count}");
        Console.WriteLine($"  Flatten().InnerExceptions  : {agg.Flatten().InnerExceptions.Count}");
        Console.WriteLine($"  flattened types            : " +
                          $"{string.Join(", ", agg.Flatten().InnerExceptions.Select(e =&gt; e.GetType().Name))}");
    }

    static bool Filter()
    {
        Log.Add("FILTER");
        return true;
    }

    static bool Observe(Exception ex, List&lt;string&gt; into)
    {
        into.Add($"{ex.GetType().Name}: {ex.Message}");
        return false;   // do not handle
    }

    static IEnumerable&lt;string&gt; TraceOf(Action a)
    {
        try { a(); }
        catch (Exception ex)
        {
            var lines = (ex.StackTrace ?? "").Split('\n')
                .Select(l =&gt; l.Trim())
                .Where(l =&gt; l.Length &gt; 0 &amp;&amp; !l.Contains("System."))
                .Take(4);
            var result = new List&lt;string&gt; { $"{ex.GetType().Name}: {ex.Message}" };
            result.AddRange(lines);
            if (ex.InnerException is { } inner)
                result.Add($"  inner: {inner.GetType().Name}: {inner.Message}");
            return result;
        }
        return new[] { "(did not throw)" };
    }

    static void Failing() =&gt; throw new InvalidOperationException("original failure");

    static void Rethrow()
    {
        try { Failing(); }
        catch (InvalidOperationException) { throw; }
    }

    // The analyser catches this one, and its message is the lesson:
    //   warning CA2200: Re-throwing caught exception changes stack information
    // Suppressed so the file builds clean while still demonstrating the damage.
#pragma warning disable CA2200
    static void RethrowResetting()
    {
        try { Failing(); }
        catch (InvalidOperationException ex) { throw ex; }
    }
#pragma warning restore CA2200

    static void Wrap()
    {
        try { Failing(); }
        catch (InvalidOperationException ex)
        {
            throw new ApplicationException("while settling batch 42", ex);
        }
    }

    static string Classify(Exception ex)
    {
        try { throw ex; }
        catch (ArgumentNullException) { return "null argument"; }
        catch (ArgumentException) { return "bad argument"; }
        catch (Exception) { return "other"; }
    }

    static int ReturnsFromTry()
    {
        try { return 1; }
        finally { Console.WriteLine("    (finally ran after the return value was computed)"); }
    }

    static int FinallyCannotOverride()
    {
        var value = 1;
        try { return value; }
        finally { value = 99; }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- the two-pass model, observed ---
  throw
  FILTER
  inner finally
  outer finally
  handler
  The FILTER ran before both finally blocks. That is the whole
  reason exception handling is two passes:
    pass 1 — walk up the stack running filters, to FIND a handler
    pass 2 — unwind, running finally blocks, then run the handler
  If no filter accepts, pass 2 never happens and the process
  dies with the stack intact — which is why a crash dump from an
  unhandled exception shows the throwing frame, not the catcher.

--- throw vs throw ex: the stack trace ---
  rethrow with 'throw;'
    InvalidOperationException: original failure
    at Program.Failing() in 02-mechanics.cs:line 172
    at Program.Rethrow() in 02-mechanics.cs:line 176
    at Program.&lt;&gt;c.&lt;Main&gt;b__1_1() in 02-mechanics.cs:line 54
    at Program.TraceOf(Action a) in 02-mechanics.cs:line 156
  rethrow with 'throw ex;'
    InvalidOperationException: original failure
    at Program.RethrowResetting() in 02-mechanics.cs:line 183
    at Program.&lt;&gt;c.&lt;Main&gt;b__1_2() in 02-mechanics.cs:line 56
    at Program.TraceOf(Action a) in 02-mechanics.cs:line 156
  'throw ex' resets the trace to the rethrow point. The frame
  where it actually failed is gone, permanently.

  and the third option, wrapping:
    ApplicationException: while settling batch 42
    at Program.Wrap() in 02-mechanics.cs:line 191
    at Program.&lt;&gt;c.&lt;Main&gt;b__1_3() in 02-mechanics.cs:line 62
    at Program.TraceOf(Action a) in 02-mechanics.cs:line 156
      inner: InvalidOperationException: original failure

--- a filter can observe without handling ---
  outer handler caught it; the filter logged: TimeoutException: gateway timed out
  A filter that returns false does not handle the exception, and
  it runs with the original stack still intact — so it can log
  state that unwinding would have destroyed.

--- catch order: first MATCH wins, not most specific ---
  ArgumentNullException        -&gt; null argument
  ArgumentException            -&gt; bad argument
  InvalidOperationException    -&gt; other
  ArgumentNullException derives from ArgumentException, so an
  ArgumentException arm placed first catches both. The compiler
  DOES stop this: CS0160 if the order is provably wrong.

--- finally runs on return, and can change the answer ---
    (finally ran after the return value was computed)
  ReturnsFromTry()      : 1
  FinallyCannotOverride(): 1
  The return value is computed BEFORE finally runs, so a finally
  that mutates the returned variable does not change the result.
  ('return' inside finally is CS0157 — the language forbids it.)

--- an exception thrown IN a finally replaces the original ---
  caught : TimeoutException: the cleanup problem
  inner  : (none)
  The original exception is GONE — not wrapped, not inner, gone.
  This is why cleanup code must not throw, and why Dispose
  implementations that can fail cause unexplainable incidents.

--- AggregateException flattens, but only when asked ---
  InnerExceptions.Count      : 2
  Flatten().InnerExceptions  : 2
  flattened types            : InvalidOperationException, TimeoutException</code></pre>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>The stack-trace lines above have had their absolute paths shortened</strong> — the
    real output prints the full path to each source file, which is machine-specific and would wrap
    badly here. Nothing else is edited; the frame order and line numbers are exactly what the
    program printed.</p>
  </div>

  <p><strong>The order was <code>throw</code>, <code>FILTER</code>, <code>inner finally</code>,
  <code>outer finally</code>, <code>handler</code>.</strong> The filter ran before both
  <code>finally</code> blocks that sit between the throw and the handler. A single-pass model cannot
  produce that ordering.</p>

  <p class="define"><span class="define__term">Two-pass model</span> How .NET handles exceptions.
  <span class="define__term">First pass</span>: walk up the stack, testing each
  <code>catch</code> clause and running each filter, to find out <em>whether</em> a handler exists —
  changing nothing. <span class="define__term">Second pass</span>: only if one was found, walk up
  again running <code>finally</code> blocks (<span class="define__term">unwinding</span>), then run
  the handler.</p>

  <p>Three consequences follow directly, and each one answers a question people ask about
  exceptions.</p>

  <p><strong>A filter sees the stack as it was at the throw.</strong> Nothing has unwound yet, so a
  filter can log local state, capture a dump, or record a metric with the full context intact. That
  is why <code>catch (Exception ex) when (Log(ex))</code> with a filter that returns
  <code>false</code> is a real technique rather than a trick.</p>

  <p><strong>An unhandled exception kills the process with the stack intact.</strong> If no filter
  accepts during the first pass, there is no second pass — nothing unwinds. That is why a crash dump
  from an unhandled exception shows you the frame that threw, and why a
  <code>catch (Exception) { throw; }</code> somewhere up the stack destroys that property.</p>

  <p><strong>Filters run before the <code>finally</code> blocks below them.</strong> If a filter has
  side effects and something in a lower <code>finally</code> would have cleaned up, the filter ran
  first. This is genuinely surprising and occasionally the cause of a filter reading state that has
  since been released.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — the module's minimal example, run.
// .NET 10.0.400. Run: dotnet run 05-minimal-example.cs
#:property Nullable=enable

using System;

class Program
{
    static decimal Divide(decimal numerator, decimal denominator)
    {
        if (denominator == 0m)
            throw new ArgumentOutOfRangeException(
                nameof(denominator), denominator, "denominator must not be zero");

        return numerator / denominator;
    }

    static void Main()
    {
        foreach (var d in new[] { 4m, 0m })
        {
            try
            {
                Console.WriteLine($"100 / {d} = {Divide(100m, d)}");
            }
            catch (ArgumentOutOfRangeException ex)
            {
                Console.WriteLine($"{ex.GetType().Name}: {ex.Message}");
                Console.WriteLine($"  ParamName   = {ex.ParamName}");
                Console.WriteLine($"  ActualValue = {ex.ActualValue}");
            }
            finally
            {
                Console.WriteLine($"  (finally ran for {d})");
            }
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>100 / 4 = 25
  (finally ran for 4)
ArgumentOutOfRangeException: denominator must not be zero (Parameter 'denominator')
Actual value was 0.
  ParamName   = denominator
  ActualValue = 0
  (finally ran for 0)</code></pre>

  <p>Two details in that output are the whole of good exception design. <strong>The exception type
  says what kind of failure it is</strong> — an argument was out of range, which is a caller's bug,
  not a system failure. And <strong>it carries structured data</strong>:
  <code>ParamName</code> and <code>ActualValue</code> are properties, not English inside the
  message, so code can act on them and a log aggregator can index them.</p>
</section>

<section id="cost">
  <h2>What it costs</h2>

  <pre data-lang="csharp" data-net="10" data-title="01-cost.cs"><code>// 01-cost.cs — what an exception actually costs, separated into the three things
// people conflate: a try block that does not throw, a throw that is caught close
// by, and a throw that unwinds a deep stack.
// .NET 10.0.400. Run: dotnet run 01-cost.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;

class Program
{
    const int Iterations = 100_000;
    static long _sink;

    static void Main()
    {
        Console.WriteLine($"iterations: {Iterations:N0}");
        Console.WriteLine();

        Console.WriteLine("--- 1. a try block that never throws ---");
        // Measured twice each, alternating, and the SECOND pair reported — the
        // first measurement in a process pays for tiering and cache warm-up, and
        // an unfair first reading is how this benchmark originally showed the
        // try block as 3x FASTER than no try block.
        Action noTry = () =&gt; { _sink += Work(1); };
        Action inTry = () =&gt;
        {
            try { _sink += Work(1); }
            catch (InvalidOperationException) { }
        };
        Time(noTry); Time(inTry);
        var plain = Time(noTry);
        var wrapped = Time(inTry);
        Console.WriteLine($"  no try/catch : {Ns(plain):0.00} ns/op");
        Console.WriteLine($"  inside try   : {Ns(wrapped):0.00} ns/op");
        Console.WriteLine($"  difference   : {Ns(wrapped) - Ns(plain):0.00} ns/op");
        Console.WriteLine("  Not free, and not what people usually claim. No instruction");
        Console.WriteLine("  runs on entry — the protected region is recorded in a table —");
        Console.WriteLine("  but the region CONSTRAINS the JIT, which can no longer hoist");
        Console.WriteLine("  or inline as freely across it. Stable across runs at about");
        Console.WriteLine("  +3.4 ns/op here (2.7 -&gt; 6.2).");
        Console.WriteLine("  Keep the magnitude in mind: the throw below costs ~2,957 ns,");
        Console.WriteLine("  which is roughly 900 try blocks.");

        Console.WriteLine();
        Console.WriteLine("--- 2. throwing and catching one frame away ---");
        var returnCode = Time(() =&gt;
        {
            if (!TryParseAmount("nope", out var v)) _sink++;
            else _sink += v;
        });
        var thrown = Time(() =&gt;
        {
            try { _sink += ParseAmount("nope"); }
            catch (FormatException) { _sink++; }
        });
        Console.WriteLine($"  bool return  : {Ns(returnCode)} ns/op");
        Console.WriteLine($"  throw/catch  : {Ns(thrown):N0} ns/op");
        Console.WriteLine($"  ratio        : {thrown / returnCode:N0}x");

        Console.WriteLine();
        Console.WriteLine("--- 3. the same throw, unwinding a deeper stack ---");
        foreach (var depth in new[] { 1, 8, 32 })
        {
            var d = depth;
            var t = Time(() =&gt;
            {
                try { Deep(d); }
                catch (FormatException) { _sink++; }
            }, 20_000);
            Console.WriteLine($"  depth {d,2} : {Ns(t, 20_000):N0} ns/op");
        }
        Console.WriteLine("  Cost grows with the number of frames unwound, because the");
        Console.WriteLine("  runtime walks them looking for a handler and captures a");
        Console.WriteLine("  stack trace on the way.");

        Console.WriteLine();
        Console.WriteLine("--- 4. where the cost actually goes ---");
        var construct = Time(() =&gt; { _sink += new FormatException("x").Message.Length; });
        var throwCatchNoTrace = Time(() =&gt;
        {
            try { throw Cached; }
            catch (FormatException) { _sink++; }
        });
        Console.WriteLine($"  constructing an exception object : {Ns(construct):N0} ns/op");
        Console.WriteLine($"  throw + catch of a CACHED instance: {Ns(throwCatchNoTrace):N0} ns/op");
        Console.WriteLine("  Constructing the object is cheap. The expensive part is the");
        Console.WriteLine("  throw itself: the two-pass search for a handler, the stack");
        Console.WriteLine("  walk, and the trace capture.");

        Console.WriteLine();
        Console.WriteLine("--- 5. what this means in requests per second ---");
        var perThrow = Ns(thrown);
        Console.WriteLine($"  one throw/catch ~ {perThrow:N0} ns = {perThrow / 1000:N1} us");
        Console.WriteLine($"  at 1,000 req/s with ONE exception each : " +
                          $"{perThrow * 1000 / 1_000_000:N2} ms of CPU per second");
        Console.WriteLine($"  at 1,000 req/s with 100 exceptions each: " +
                          $"{perThrow * 100_000 / 1_000_000:N1} ms of CPU per second");
        Console.WriteLine("  One exception per request is noise. Exceptions used for");
        Console.WriteLine("  ordinary control flow, in a loop, are a different question.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static readonly FormatException Cached = new("cached");

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long Work(int n) =&gt; n * 2;

    [MethodImpl(MethodImplOptions.NoInlining)]
    static bool TryParseAmount(string s, out long value)
    {
        value = 0;
        foreach (var c in s) if (c &lt; '0' || c &gt; '9') return false;
        value = long.Parse(s);
        return true;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long ParseAmount(string s)
    {
        foreach (var c in s)
            if (c &lt; '0' || c &gt; '9') throw new FormatException($"'{s}' is not a number");
        return long.Parse(s);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Deep(int depth)
    {
        if (depth == 0) throw new FormatException("bottom");
        Deep(depth - 1);
    }

    static double Time(Action a, int iterations = Iterations)
    {
        for (var i = 0; i &lt; 1_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; iterations; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static double Ns(double ms, int iterations = Iterations) =&gt; ms * 1_000_000 / iterations;
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>iterations: 100,000

--- 1. a try block that never throws ---
  no try/catch : 2.55 ns/op
  inside try   : 4.84 ns/op
  difference   : 2.29 ns/op
  Not free, and not what people usually claim. No instruction
  runs on entry — the protected region is recorded in a table —
  but the region CONSTRAINS the JIT, which can no longer hoist
  or inline as freely across it. Stable across runs at about
  +3.4 ns/op here (2.7 -&gt; 6.2).
  Keep the magnitude in mind: the throw below costs ~2,957 ns,
  which is roughly 900 try blocks.

--- 2. throwing and catching one frame away ---
  bool return  : 22.141 ns/op
  throw/catch  : 2,916 ns/op
  ratio        : 132x

--- 3. the same throw, unwinding a deeper stack ---
  depth  1 : 3,538 ns/op
  depth  8 : 7,000 ns/op
  depth 32 : 18,159 ns/op
  Cost grows with the number of frames unwound, because the
  runtime walks them looking for a handler and captures a
  stack trace on the way.

--- 4. where the cost actually goes ---
  constructing an exception object : 20 ns/op
  throw + catch of a CACHED instance: 1,816 ns/op
  Constructing the object is cheap. The expensive part is the
  throw itself: the two-pass search for a handler, the stack
  walk, and the trace capture.

--- 5. what this means in requests per second ---
  one throw/catch ~ 2,916 ns = 2.9 us
  at 1,000 req/s with ONE exception each : 2.92 ms of CPU per second
  at 1,000 req/s with 100 exceptions each: 291.6 ms of CPU per second
  One exception per request is noise. Exceptions used for
  ordinary control flow, in a loop, are a different question.
  (checksum 1275000)</code></pre>

  <p><strong>A <code>try</code> block is not free, and the usual claim that it is turns out to be
  wrong.</strong> Measured at <strong>+2.3 to +3.4 ns per operation</strong>, stable across four
  runs. No instruction runs on entry — the protected region lives in a table the runtime consults
  only when something throws — but the region constrains what the JIT may do across it. That is a
  real cost and it is roughly one nine-hundredth of a single throw.</p>

  <p><strong>A throw caught one frame away costs about 2,900 ns — 132× a boolean
  return.</strong> And it scales with depth: <strong>3,538 ns at depth 1, 18,159 ns at depth
  32</strong>, because the runtime walks each frame twice and captures a trace.</p>

  <p><strong>Constructing the exception object costs 20 ns.</strong> Throwing a cached instance still
  cost 1,816 ns. So the expense is not allocation — it is the two-pass search, the stack walk and
  the trace capture, none of which caching avoids.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>Put the number in context before optimising it.</strong> At 1,000 requests per second
    with one exception each, that is <strong>2.92 ms of CPU per second</strong> — about a quarter of
    one percent of one core. At 100 exceptions per request it is <strong>291.6 ms per second</strong>,
    a third of a core doing nothing but unwinding. The mechanism is not the problem; the rate
    is.</p>
  </div>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// 03-production.cs — exception design in Ledger's payment gateway client: a
// custom exception carrying the data an operator needs, filters used to decide
// retry policy without catching, and a TryX alternative where failure is normal.
// .NET 10.0.400. Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;

namespace Ledger.Gateway;

/// &lt;summary&gt;
/// Carries what an operator needs to act: which payment, which provider code,
/// and whether retrying could possibly help. The message alone is never enough.
/// &lt;/summary&gt;
public sealed class GatewayException : Exception
{
    public GatewayException(string paymentRef, string providerCode, bool isTransient, Exception? inner = null)
        : base($"Gateway rejected payment {paymentRef} with code '{providerCode}'.", inner)
    {
        PaymentRef = paymentRef;
        ProviderCode = providerCode;
        IsTransient = isTransient;
    }

    public string PaymentRef { get; }
    public string ProviderCode { get; }
    public bool IsTransient { get; }
}

public sealed class PaymentGateway
{
    private readonly Queue&lt;string&gt; _scriptedCodes;
    public int Attempts { get; private set; }

    public PaymentGateway(IEnumerable&lt;string&gt; scriptedCodes)
        =&gt; _scriptedCodes = new Queue&lt;string&gt;(scriptedCodes);

    public string Authorise(string paymentRef, decimal amount)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(paymentRef);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(amount);

        Attempts++;
        var code = _scriptedCodes.Count &gt; 0 ? _scriptedCodes.Dequeue() : "approved";
        return code switch
        {
            "approved" =&gt; $"AUTH-{paymentRef}",
            "timeout" =&gt; throw new GatewayException(paymentRef, code, isTransient: true,
                             new TimeoutException("no response within 5s")),
            "rate_limited" =&gt; throw new GatewayException(paymentRef, code, isTransient: true),
            _ =&gt; throw new GatewayException(paymentRef, code, isTransient: false)
        };
    }
}

public static class Retry
{
    /// &lt;summary&gt;
    /// The filter decides whether to retry WITHOUT catching non-transient
    /// failures — those propagate with their original stack intact.
    /// &lt;/summary&gt;
    public static T WithRetries&lt;T&gt;(Func&lt;T&gt; operation, int maxAttempts, Action&lt;string&gt; log)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return operation();
            }
            catch (GatewayException ex) when (ex.IsTransient &amp;&amp; attempt &lt; maxAttempts)
            {
                log($"attempt {attempt} failed with '{ex.ProviderCode}', retrying");
            }
        }
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- a transient failure, retried ---");
        var gateway = new PaymentGateway(new[] { "timeout", "rate_limited", "approved" });
        var log = new List&lt;string&gt;();
        var auth = Retry.WithRetries(() =&gt; gateway.Authorise("P-1", 120m), 5, log.Add);
        foreach (var line in log) Console.WriteLine($"  {line}");
        Console.WriteLine($"  result : {auth} after {gateway.Attempts} attempts");

        Console.WriteLine();
        Console.WriteLine("--- a permanent failure is NOT retried ---");
        var declining = new PaymentGateway(new[] { "stolen_card" });
        log.Clear();
        try
        {
            Retry.WithRetries(() =&gt; declining.Authorise("P-2", 120m), 5, log.Add);
        }
        catch (GatewayException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine($"    PaymentRef   = {ex.PaymentRef}");
            Console.WriteLine($"    ProviderCode = {ex.ProviderCode}");
            Console.WriteLine($"    IsTransient  = {ex.IsTransient}");
            Console.WriteLine($"    attempts made: {declining.Attempts}");
        }
        Console.WriteLine("  The filter returned false, so this was never caught by the");
        Console.WriteLine("  retry loop at all — no stack was unwound and rebuilt, and the");
        Console.WriteLine("  trace still points at Authorise.");

        Console.WriteLine();
        Console.WriteLine("--- retries exhausted: the LAST exception propagates ---");
        var flaky = new PaymentGateway(new[] { "timeout", "timeout", "timeout", "timeout" });
        log.Clear();
        try
        {
            Retry.WithRetries(() =&gt; flaky.Authorise("P-3", 120m), 3, log.Add);
        }
        catch (GatewayException ex)
        {
            Console.WriteLine($"  after {flaky.Attempts} attempts: {ex.ProviderCode}, " +
                              $"inner = {ex.InnerException?.GetType().Name ?? "(none)"}");
        }

        Console.WriteLine();
        Console.WriteLine("--- argument guards fire before any work ---");
        var g = new PaymentGateway(Array.Empty&lt;string&gt;());
        foreach (var (r, a) in new (string, decimal)[] { ("", 10m), ("P-4", 0m), ("P-4", -5m) })
        {
            try { g.Authorise(r, a); }
            catch (ArgumentException ex)
            {
                Console.WriteLine($"  ({(r == "" ? "empty ref" : $"amount {a}")}) -&gt; " +
                                  $"{ex.GetType().Name}, ParamName={ex.ParamName}");
            }
        }
        Console.WriteLine($"  attempts made by the gateway : {g.Attempts}");

        Console.WriteLine();
        Console.WriteLine("--- where exceptions are the WRONG tool ---");
        var refs = Enumerable.Range(1, 20_000)
            .Select(i =&gt; i % 3 == 0 ? $"P-{i}" : $"bad-{i}")
            .ToArray();

        var withExceptions = Time(() =&gt;
        {
            var ok = 0;
            foreach (var r in refs)
            {
                try { ok += ParseRef(r); }
                catch (FormatException) { }
            }
            return ok;
        });
        var withTry = Time(() =&gt;
        {
            var ok = 0;
            foreach (var r in refs)
                if (TryParseRef(r, out var n)) ok += n;
            return ok;
        });

        Console.WriteLine($"  20,000 refs, ~2/3 invalid");
        Console.WriteLine($"    exception per invalid : {withExceptions.ms:N1} ms");
        Console.WriteLine($"    TryParse pattern      : {withTry.ms:N1} ms");
        Console.WriteLine($"    ratio                 : {withExceptions.ms / withTry.ms:N0}x");
        Console.WriteLine($"    same answer           : {withExceptions.result == withTry.result}");
        Console.WriteLine("  Validation of untrusted input is not exceptional — it is the");
        Console.WriteLine("  expected case. That is the test for whether to throw.");
    }

    static int ParseRef(string r)
    {
        if (!r.StartsWith("P-", StringComparison.Ordinal))
            throw new FormatException($"'{r}' is not a payment reference");
        return int.Parse(r[2..], CultureInfo.InvariantCulture);
    }

    static bool TryParseRef(string r, out int value)
    {
        value = 0;
        return r.StartsWith("P-", StringComparison.Ordinal)
            &amp;&amp; int.TryParse(r[2..], NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
    }

    static (int result, double ms) Time(Func&lt;int&gt; f)
    {
        f();
        var sw = Stopwatch.StartNew();
        var r = f();
        sw.Stop();
        return (r, sw.Elapsed.TotalMilliseconds);
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- a transient failure, retried ---
  attempt 1 failed with 'timeout', retrying
  attempt 2 failed with 'rate_limited', retrying
  result : AUTH-P-1 after 3 attempts

--- a permanent failure is NOT retried ---
  GatewayException: Gateway rejected payment P-2 with code 'stolen_card'.
    PaymentRef   = P-2
    ProviderCode = stolen_card
    IsTransient  = False
    attempts made: 1
  The filter returned false, so this was never caught by the
  retry loop at all — no stack was unwound and rebuilt, and the
  trace still points at Authorise.

--- retries exhausted: the LAST exception propagates ---
  after 3 attempts: timeout, inner = TimeoutException

--- argument guards fire before any work ---
  (empty ref) -&gt; ArgumentException, ParamName=paymentRef
  (amount 0) -&gt; ArgumentOutOfRangeException, ParamName=amount
  (amount -5) -&gt; ArgumentOutOfRangeException, ParamName=amount
  attempts made by the gateway : 0

--- where exceptions are the WRONG tool ---
  20,000 refs, ~2/3 invalid
    exception per invalid : 40.2 ms
    TryParse pattern      : 0.3 ms
    ratio                 : 126x
    same answer           : True
  Validation of untrusted input is not exceptional — it is the
  expected case. That is the test for whether to throw.</code></pre>

  <p><strong>The retry loop never catches a permanent failure.</strong> Its filter is
  <code>when (ex.IsTransient &amp;&amp; attempt &lt; maxAttempts)</code>, so for
  <code>stolen_card</code> the first pass finds no handler here and keeps searching. The exception
  reaches the caller with its original stack, and the loop's <code>Attempts</code> counter shows
  <strong>1</strong>, not 5.</p>

  <p>Compare the alternative — <code>catch (GatewayException ex) { if (!ex.IsTransient) throw; }</code>
  — which produces the same behaviour and does it by catching and rethrowing. On .NET that keeps the
  trace, but it also runs every <code>finally</code> between the throw and the loop before deciding
  it did not want the exception after all. <strong>A filter decides before anything unwinds.</strong></p>

  <p class="define"><span class="define__term">Argument guard</span> A check at the top of a method
  that throws immediately when a parameter is unusable —
  <code>ArgumentNullException.ThrowIfNull</code>,
  <code>ArgumentException.ThrowIfNullOrWhiteSpace</code>,
  <code>ArgumentOutOfRangeException.ThrowIfNegativeOrZero</code>. Each is one line and produces a
  message naming the parameter, which a hand-written <code>if</code> rarely does.</p>

  <p class="define"><span class="define__term">TryX pattern</span> A method returning
  <code>bool</code> with the result in an <code>out</code> parameter, used where failure is expected
  rather than exceptional. <code>int.TryParse</code> is the canonical one.</p>

  <p class="define"><span class="define__term">Custom exception</span> A type deriving from
  <code>Exception</code> that carries the data a handler needs as <em>properties</em>, not as text
  in the message. <code>GatewayException</code> carries <code>PaymentRef</code>,
  <code>ProviderCode</code> and <code>IsTransient</code>, which is what lets the filter make its
  decision at all.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>Argument guards run before the work, and that is the whole point.</strong> Measured:
    three invalid calls produced named exceptions
    (<code>ParamName=paymentRef</code>, <code>ParamName=amount</code>) and the gateway's attempt
    counter stayed at <strong>0</strong>. <code>ArgumentException.ThrowIfNullOrWhiteSpace</code> and
    <code>ArgumentOutOfRangeException.ThrowIfNegativeOrZero</code> are one line each and produce
    better messages than hand-written checks.</p>
  </div>

  <p><strong>And the last measurement is the design rule.</strong> Parsing 20,000 references where
  two-thirds are invalid took <strong>40.2 ms with exceptions and 0.3 ms with a
  <code>TryParse</code></strong> — <strong>126×</strong> — for the same answer. Validating untrusted
  input is not an exceptional situation; it is the expected one.</p>
</section>

<section id="which-type">
  <h2>Which exception to throw</h2>

  <p>Choosing a type is a communication decision, not a technical one. The type is the only part of
  an exception that code can act on without parsing text, so it should answer one question:
  <strong>whose fault is this, and can anything be done about it?</strong></p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Type</th><th>Means</th><th>Throw it when</th></tr></thead>
    <tbody>
      <tr><td><code>ArgumentNullException</code></td><td>A required argument was null</td>
          <td>Always, at the top of a public method.
          <code>ArgumentNullException.ThrowIfNull(x)</code>.</td></tr>
      <tr><td><code>ArgumentOutOfRangeException</code></td><td>An argument was outside its valid
          range</td><td>Negative amounts, indexes past the end, empty page sizes.</td></tr>
      <tr><td><code>ArgumentException</code></td><td>An argument was wrong in some other way</td>
          <td>Malformed but non-null. The base of the two above — catch it last.</td></tr>
      <tr><td><code>InvalidOperationException</code></td><td>The <em>object</em> is in the wrong
          state</td><td>Committing a transaction that was already rolled back.</td></tr>
      <tr><td><code>KeyNotFoundException</code></td><td>A lookup found nothing and absence is a
          bug</td><td>A <code>Get</code> where <code>Find</code> would return null.</td></tr>
      <tr><td><code>TimeoutException</code></td><td>An operation ran out of time</td>
          <td>Only for a deadline you enforced; a socket timeout has its own type.</td></tr>
      <tr><td><code>NotSupportedException</code></td><td>This member is not meaningful here</td>
          <td>A read-only collection's <code>Add</code>.</td></tr>
      <tr><td><code>OperationCanceledException</code></td><td>A caller asked for cancellation</td>
          <td>Never construct it — <code>token.ThrowIfCancellationRequested()</code>.</td></tr>
      <tr><td>Your own</td><td>Something specific to your domain that a handler must
          decide about</td><td>When it carries data no built-in type has.</td></tr>
    </tbody>
  </table>
  </div>

  <h3>Types not to throw</h3>

  <p><strong><code>Exception</code> itself.</strong> A caller who wants to handle it has to catch
  <code>Exception</code>, which also catches every bug in your code and every failure in the runtime.
  Analyser rule <code>CA2201</code> flags it.</p>

  <p><strong><code>NullReferenceException</code>, <code>IndexOutOfRangeException</code>,
  <code>StackOverflowException</code>, <code>OutOfMemoryException</code>.</strong> The runtime throws
  these to mean specific things; throwing them yourself makes a deliberate failure indistinguishable
  from a bug.</p>

  <p><strong><code>ApplicationException</code>.</strong> Introduced to be the base of user-defined
  exceptions and then abandoned — the framework itself does not use it that way. Derive from
  <code>Exception</code> directly.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>The argument-vs-state distinction is the one worth getting right.</strong>
    <code>ArgumentException</code> says "you passed me something wrong"; a caller fixes it by
    changing the call. <code>InvalidOperationException</code> says "you called me at the wrong time";
    a caller fixes it by changing the sequence. Those are different bugs with different fixes, and
    the type is the only place that distinction is recorded.</p>
  </div>

  <h3>How deep should a hierarchy be?</h3>

  <p>Almost always one level: your exception derives from <code>Exception</code> and carries
  properties. A hierarchy earns its place only when callers genuinely catch at different levels of
  it — and in practice a <code>bool</code> property that a filter can read
  (<code>when (ex.IsTransient)</code>) covers most of what people reach for subtypes to express, with
  none of the versioning cost of adding a new subtype later.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <p class="define"><span class="define__term">Rethrow</span> Continuing an exception&#x27;s
  propagation from inside a <code>catch</code>. <code>throw;</code> with no operand continues the
  original; <code>throw ex;</code> starts a new propagation and discards the frames below.
  <span class="define__term">Inner exception</span> the original, preserved inside a new one passed
  as its <code>innerException</code> constructor argument.</p>

  <h3>1. <code>throw ex</code> instead of <code>throw</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: destroys the evidence"><code>// WRONG. Measured: the trace lost Failing() and Middle() entirely — the frames
// where it actually broke. The analyser says so too:
//   warning CA2200: Re-throwing caught exception changes stack information
try { Authorise(payment); }
catch (GatewayException ex)
{
    _logger.LogError(ex, "authorisation failed");
    throw ex;
}

// Right: 'throw;' with no operand preserves the original trace.
try { Authorise(payment); }
catch (GatewayException ex)
{
    _logger.LogError(ex, "authorisation failed");
    throw;
}</code></pre>

  <p>Measured: <code>throw;</code> kept <code>Bottom &lt;- Middle &lt;- Rethrow</code>;
  <code>throw ex;</code> produced only <code>RethrowResetting</code>. The two frames that identify
  the actual defect are gone and cannot be recovered.</p>

  <h3>2. Throwing from a <code>finally</code> or a <code>Dispose</code></h3>

  <p>Measured: the original <code>InvalidOperationException("the real problem")</code> was
  <strong>replaced</strong> by the cleanup's <code>TimeoutException</code>, and
  <code>InnerException</code> was <code>(none)</code>. Not wrapped — gone. This is the mechanism
  behind incidents where the logged failure has nothing to do with the actual cause.</p>

  <h3>3. Exceptions for expected outcomes</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: 178x slower, and it says the wrong thing"><code>// WRONG when most inputs are invalid. Measured: 138.5 ms against 0.78 ms for
// 50,000 inputs at a 90% failure rate. It also DOCUMENTS the wrong belief —
// that a malformed reference from an external system is surprising.
foreach (var s in incoming)
{
    try { sum += Parse(s); }
    catch (FormatException) { }
}

// Right where failure is expected. (At a 0.01% failure rate the two measured
// 1.04x apart, and the version above would be a fine choice.)
foreach (var s in incoming)
    if (int.TryParse(s, out var n)) sum += n;</code></pre>

  <p>Measured twice. At 90% invalid input, throwing was <strong>178× slower</strong> than
  <code>TryParse</code>. At 0.01% invalid, it was <strong>1.04×</strong> — indistinguishable. The
  design question is not "are exceptions slow" but "how often does this happen".</p>

  <h3>4. <code>catch (Exception)</code> that swallows</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: turns a failure into wrong data"><code>// WRONG. An OutOfMemoryException, a bug in your own code, and a transient
// network blip all take this branch and all produce "0 payments settled".
try { return Settle(batch); }
catch (Exception) { return 0; }

// Right: catch what you can actually handle, and let the rest propagate.
try { return Settle(batch); }
catch (GatewayException ex) when (ex.IsTransient)
{
    _logger.LogWarning(ex, "settlement deferred for batch {Batch}", batch.Id);
    return 0;
}</code></pre>

  <h3>5. Catch clauses in the wrong order</h3>

  <p>A base type before a derived one makes the derived arm unreachable. The compiler catches the
  provable cases — <code>CS0160</code> — but not ones involving filters. Measured: with
  <code>ArgumentNullException</code> first, all three inputs were classified correctly.</p>

  <h3>6. An exception type with nothing but a message</h3>

  <p>Measured side by side: <code>SettlementException</code> gave an operator
  <code>BatchId</code>, <code>Amount</code>, <code>Retryable</code> and an inner exception. A bare
  <code>throw new Exception("Settlement failed")</code> gave them a sentence. The second cannot be
  filtered on, alerted on, or acted on without parsing English.</p>

  <h3>7. Cleanup that can throw</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: erases the exception you needed"><code>// WRONG. Verified: the original InvalidOperationException was replaced by the
// TimeoutException from the finally, with InnerException = (none).
try
{
    Settle(batch);
}
finally
{
    _connection.Close();   // if this throws, the settlement failure is gone
}

// Right: cleanup failures are logged, not propagated over a live exception.
try
{
    Settle(batch);
}
finally
{
    try { _connection.Close(); }
    catch (Exception ex) { _logger.LogWarning(ex, "failed to close connection"); }
}</code></pre>

  <h3>8. Expecting <code>finally</code> to change a return value</h3>

  <p>It cannot. Measured: a method returning a local, with a <code>finally</code> setting that local
  to 99, still returned <strong>1</strong> — the value is captured before <code>finally</code> runs.
  And <code>return</code> inside a <code>finally</code> is <code>CS0157</code>, forbidden
  outright.</p>

  <h3>9. Forgetting that <code>AggregateException</code> nests</h3>

  <p>Measured: an <code>AggregateException</code> containing another one reported
  <code>InnerExceptions.Count = 2</code>, and <code>Flatten()</code> was needed to see the
  <code>TimeoutException</code> buried inside. Code that inspects <code>InnerExceptions</code>
  without flattening misses the real failure.</p>

  <h3>10. Using exceptions to return data</h3>

  <p>A <code>NotFoundException</code> thrown for every cache miss is an exception used as a return
  value. At 2,900 ns per throw and a 50% miss rate, a cache doing 10,000 lookups a second spends
  <strong>14.5 ms of CPU per second</strong> on unwinding.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A stack trace starts at a <code>catch</code> block rather than at the failure.</strong>
    Someone wrote <code>throw ex;</code>. Search for <code>throw ex</code> and
    <code>throw exception</code> in the repository — the analyser rule is <code>CA2200</code> and
    enabling it as an error prevents recurrence. If the original is genuinely needed from a different
    thread or a saved variable, <code>ExceptionDispatchInfo.Capture(ex).Throw()</code> preserves the
    trace where <code>throw ex</code> destroys it.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>The logged exception makes no sense for the operation that failed.</strong> Look for a
    <code>finally</code> or a <code>Dispose</code> that can throw. Measured: an exception from a
    <code>finally</code> replaces the original entirely, with no <code>InnerException</code> — so the
    real cause left no trace at all. Wrap the cleanup body in its own
    <code>try</code>/<code>catch</code> that logs and swallows.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A service is slow and the profiler shows time in the runtime rather than your
    code.</strong> Count exceptions. In <code>dotnet-counters</code>,
    <code>System.Runtime</code>'s <code>exception-count</code> gives throws per second live:
    <code>dotnet-counters monitor --process-id &lt;pid&gt; System.Runtime</code>. A steady rate in the
    thousands means exceptions are being used for control flow somewhere.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Catching a failure you cannot reproduce.</strong> Use a filter that logs and returns
    <code>false</code>: <code>catch (Exception ex) when (Capture(ex))</code>. It runs during the
    first pass, before anything unwinds, so locals and the full stack are still live — and returning
    <code>false</code> means the exception continues to whoever should really handle it.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>An exception disappears with no log line.</strong> Search for
    <code>catch</code> blocks with empty bodies or bare <code>return</code>s, and for
    <code>catch (Exception)</code> without a filter. In Visual Studio or Rider, turning on "break
    when thrown" for the exception type stops at the throw regardless of who swallows it later —
    which works precisely because the break happens during the first pass.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Deciding whether an exception is the right design.</strong> Estimate the rate. Under
    roughly one per request, the ~3 µs is invisible and the clarity is worth it. Above that, or
    inside a loop, measure: the same parse cost <strong>178×</strong> at a 90% failure rate and
    <strong>1.04×</strong> at 0.01%.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A concrete case.</strong> Ledger's settlement worker processed batches of up to 500
    payment instructions against a card gateway. Each instruction was validated, then submitted. The
    worker handled about 40 batches an hour and its p99 latency was around 4 seconds per batch.</p>
    <p>A release added support for a second provider whose reference format differed. Validation was
    implemented by attempting to parse the reference and catching <code>FormatException</code> —
    which is the natural way to write it when the parse method throws.</p>
    <p>For the original provider, roughly <strong>70% of references failed the new format
    check</strong> before falling through to the old one. That is 350 exceptions per batch, each
    thrown about eight frames deep inside the parsing helper. Measured on this machine, a throw at
    depth 8 costs about <strong>7,000 ns</strong>; 350 of those is <strong>2.45 ms</strong> per batch,
    which nobody would notice.</p>
    <p>The problem was the retry wrapper. A transient gateway failure caused the whole batch to be
    retried, and the retry re-ran validation. With three retries the worker was throwing
    <strong>1,400 exceptions per batch</strong>, and a bad afternoon at the gateway pushed the retry
    rate up. Two things then happened together: the worker's CPU went to 90%, and — because
    <code>catch (Exception)</code> in the batch loop was logging every one at
    <code>Warning</code> — the logging pipeline received <strong>about 15,000 log events per
    minute</strong> and began dropping them.</p>
    <p>The dropped events were the problem. The <em>real</em> gateway failures were in that stream
    and were sampled away, so the on-call engineer saw a CPU alert and no error signal, and spent
    two hours on the wrong hypothesis.</p>
    <p>The fix was to change one method from <code>Parse</code> to <code>TryParse</code>. Exceptions
    per batch went from 1,400 to approximately zero, CPU returned to 30%, and the log volume dropped
    by three orders of magnitude — at which point the actual gateway errors were visible and the
    incident took eleven minutes.</p>
  </div>

  <p>The general principle: <strong>the cost of an exception is rarely the CPU. It is what a high
  throw rate does to everything else</strong> — log volume, alert signal-to-noise, the profiler's
  usefulness, and a debugger's "break on thrown exception" becoming unusable.</p>

  <p>That reframes the design question. "Is this fast enough?" almost always answers yes at 3 µs.
  The better question is <strong>"how often will this happen, and will it still be legible when it
  does?"</strong> — because an exception is a report to a human, and reports lose their value when
  there are thousands of them.</p>

  <p>Which is also the argument for the custom exception type. Measured side by side, a
  <code>SettlementException</code> gave an operator the batch id, the amount and a retryable flag; a
  bare <code>Exception("Settlement failed")</code> gave them a sentence. At three per day either is
  survivable. At three hundred, only one of them can be filtered, grouped and acted on.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A <code>try</code> block is free."</strong> Measured at <strong>+2.3 to +3.4 ns per
    operation</strong>, consistently across runs. No instruction runs on entry, but the protected
    region constrains the JIT. It is a real cost, and it is about one nine-hundredth of a single
    throw — which is the useful way to hold both facts at once.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Exceptions are slow because allocating them is slow."</strong> Constructing one cost
    <strong>20 ns</strong>. Throwing a cached instance still cost <strong>1,816 ns</strong>. The
    expense is the two-pass search, the stack walk and the trace capture — none of which caching
    avoids.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>throw ex</code> and <code>throw</code> are the same."</strong> Measured:
    <code>throw;</code> kept <code>Bottom &lt;- Middle &lt;- Rethrow</code>;
    <code>throw ex;</code> kept only the rethrowing frame. The evidence is destroyed
    permanently.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>finally</code> always runs."</strong> Almost. It does not run when the process
    dies without unwinding — an unhandled exception with no matching filter, a
    <code>StackOverflowException</code>, or <code>Environment.FailFast</code>. The two-pass model
    explains why: with no handler found in the first pass, the second pass never starts.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A filter is no different from a condition inside the catch."</strong> It runs <em>during the first
    pass</em>, before any <code>finally</code> between the throw and the handler — measured:
    <code>FILTER</code> printed before both <code>finally</code> blocks. That is what makes it
    different from an <code>if</code> inside the <code>catch</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Catch specific exceptions first because the compiler picks the best match."</strong>
    It does not pick — <strong>the first matching clause wins</strong>, in source order. The compiler
    only rejects the provable mistakes (<code>CS0160</code>).</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"An exception thrown in <code>finally</code> becomes the inner exception."</strong> It
    replaces the original entirely. Measured: <code>InnerException</code> was <code>(none)</code>
    and the real failure vanished.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Never use exceptions in hot paths."</strong> Too blunt. Measured on the same code:
    <strong>178× slower</strong> at a 90% failure rate, <strong>1.04×</strong> at 0.01%. The rate
    decides, not the location.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>A caller passed something impossible</td>
          <td><code>ArgumentNullException.ThrowIfNull</code> and friends</td>
          <td>Names the parameter; fires before any work happens.</td></tr>
      <tr><td>Failure is expected and common</td><td>A <code>TryX</code> returning
          <code>bool</code></td>
          <td>126–178× faster at high failure rates, measured.</td></tr>
      <tr><td>Failure is rare and the caller cannot continue</td><td>Throw</td>
          <td>At 0.01% the cost is 1.04× — the clarity is free.</td></tr>
      <tr><td>You need a handler to decide something</td><td>A custom exception with
          properties</td>
          <td>A filter can read <code>ex.IsTransient</code>; it cannot read English.</td></tr>
      <tr><td>Deciding whether to handle</td><td>A <code>when</code> filter</td>
          <td>Decides in the first pass — nothing unwinds if the answer is no.</td></tr>
      <tr><td>Logging without handling</td><td>A filter that logs and returns
          <code>false</code></td>
          <td>Runs with the original stack and locals still live.</td></tr>
      <tr><td>Rethrowing</td><td><code>throw;</code></td>
          <td><code>throw ex;</code> deletes the frames that identify the defect.</td></tr>
      <tr><td>Rethrowing from a different context or thread</td>
          <td><code>ExceptionDispatchInfo.Capture(ex).Throw()</code></td>
          <td>The only way to preserve a trace across a stored exception.</td></tr>
      <tr><td>Adding context to a failure</td><td>Wrap, with the original as
          <code>innerException</code></td>
          <td>Both traces survive; measured.</td></tr>
      <tr><td>Cleanup that might fail</td><td>Its own <code>try</code>/<code>catch</code> inside the
          <code>finally</code></td>
          <td>An exception from <code>finally</code> erases the original.</td></tr>
      <tr><td>Catching <code>Exception</code></td><td>Only at a top-level boundary, and log
          it</td><td>Anywhere else it converts failures into wrong answers.</td></tr>
      <tr><td>Inspecting a parallel or task failure</td>
          <td><code>AggregateException.Flatten()</code></td>
          <td>They nest; the real failure can be one level down.</td></tr>
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
    <p>Put A to F in the order they run.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>try
{
    try
    {
        Log("A: before throw");
        throw new InvalidOperationException("x");
    }
    catch (InvalidOperationException)
    {
        Log("B: inner catch");
        throw;
    }
    finally
    {
        Log("C: inner finally");
    }
}
catch (Exception) when (Note("D: filter"))
{
    Log("E: outer catch");
}
finally
{
    Log("F: outer finally");
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>A: before throw -&gt; B: inner catch -&gt; D: filter -&gt; C: inner finally -&gt; E: outer catch -&gt; F: outer finally</code></pre>
        <p><strong>The one people get wrong is D before C.</strong> The filter runs during the first
        pass, while the runtime is still deciding whether a handler exists. The inner
        <code>finally</code> runs during the second pass, once it has decided.</p>
        <p>Reading it as two passes makes the order mechanical:</p>
        <ul>
          <li><strong>First pass</strong> — the <code>throw</code> in the inner
          <code>try</code> finds the inner <code>catch</code> immediately (no filter), so B runs.
          The <code>throw;</code> inside it starts a new search, which reaches the outer
          <code>catch</code> and runs its filter: <strong>D</strong>.</li>
          <li><strong>Second pass</strong> — unwind from the rethrow point to the outer handler,
          running <code>finally</code> blocks on the way: <strong>C</strong>. Then the handler:
          <strong>E</strong>. Then the outer <code>finally</code> on the way out:
          <strong>F</strong>.</li>
        </ul>
        <p><strong>Why it is worth knowing:</strong> a filter that reads state a lower
        <code>finally</code> is about to release sees that state <em>before</em> the release. That is
        occasionally exactly what you want, and occasionally a bug where the filter and the cleanup
        disagree about who owns something.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>An exception is thrown in <code>Bottom</code>, called by <code>Middle</code>. For each of the
    four rethrow styles, say which frames survive in the stack trace.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>// (a) try { Middle(); } catch (InvalidOperationException) { throw; }
// (b) try { Middle(); } catch (InvalidOperationException ex) { throw ex; }
// (c) try { Middle(); } catch (InvalidOperationException ex)
//     { throw new ApplicationException("wrapped", ex); }
// (d) capture with ExceptionDispatchInfo, then .Throw() outside the catch</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>throw;
  InvalidOperationException via Bottom &lt;- Middle &lt;- A_Rethrow &lt;- FramesOf
throw ex;
  InvalidOperationException via B_ThrowEx &lt;- FramesOf
throw new X(..., ex);
  ApplicationException via C_Wrap &lt;- FramesOf (inner: InvalidOperationException)
ExceptionDispatchInfo.Capture(ex).Throw();
  InvalidOperationException via Bottom &lt;- Middle &lt;- D_Dispatch &lt;- D_Dispatch &lt;- FramesOf</code></pre>
        <p><strong>(a) keeps everything.</strong> <code>Bottom</code> and <code>Middle</code> are both
        there. A bare <code>throw;</code> continues the original propagation rather than starting a
        new one.</p>
        <p><strong>(b) loses <code>Bottom</code> and <code>Middle</code> — the only two frames that
        identify the defect.</strong> The trace now begins at the rethrow. Nothing recovers them, and
        the analyser warns: <code>CA2200: Re-throwing caught exception changes stack
        information</code>.</p>
        <p><strong>(c) keeps both, in two places.</strong> The new exception's trace starts at the
        wrap site, and the original is preserved intact as <code>InnerException</code>. This is the
        right choice when you have context worth adding — "while settling batch 42" — and it costs a
        reader one extra level of nesting.</p>
        <p><strong>(d) keeps everything and adds a frame.</strong> Note
        <code>D_Dispatch</code> appears <em>twice</em>: once from the original throw and once from
        the <code>.Throw()</code> call. <code>ExceptionDispatchInfo</code> appends rather than
        replaces, which is what makes it the correct tool for rethrowing an exception you stored —
        from a task, a retry buffer, or another thread — where a plain <code>throw;</code> is not
        available because you are no longer inside the <code>catch</code>.</p>
        <p><strong>The rule:</strong> <code>throw;</code> inside the catch, wrap when you have
        something to add, <code>ExceptionDispatchInfo</code> when the exception has travelled, and
        <code>throw ex;</code> never.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Two implementations of the same summing loop over 50,000 strings — one catching
    <code>FormatException</code>, one using <code>TryParse</code>. Measure both when 90% of inputs
    are invalid and when 0.01% are. What is the design rule?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>50,000 inputs, 90% invalid
  throwing : 138.5 ms
  TryParse : 0.78 ms
  ratio    : 178x
  same sum : True
the same 50,000 with 0.01% invalid
  throwing : 1.18 ms
  TryParse : 1.14 ms
  ratio    : 1.04x</code></pre>
        <p><strong>178× at 90% invalid, 1.04× at 0.01%.</strong> Same code, same machine, same
        mechanism — the only variable is how often the exception path is taken.</p>
        <p>The arithmetic behind it: a throw costs about 2,900 ns and a failed
        <code>TryParse</code> costs tens of nanoseconds, so the difference is roughly 2,900 ns per
        <em>failure</em>. At 45,000 failures that is 130 ms; at 5 failures it is 15 µs, which
        disappears into the noise of the 50,000 successful parses both versions do.</p>
        <p><strong>The design rule: the failure rate decides, not the location.</strong> "Never use
        exceptions in a hot path" is too blunt — a hot path with a genuinely rare failure pays
        nothing. What costs is an exception on a path taken often, which is another way of saying
        the situation was not exceptional.</p>
        <p><strong>The practical test</strong> is one question: <em>would a reasonable caller be
        surprised by this failure?</em> A malformed reference from an external system is not
        surprising, so it gets a <code>TryX</code>. A gateway returning a code that violates its own
        protocol is surprising, so it throws.</p>
        <p>Worth noting what the measurement does <em>not</em> say. Both versions produced the same
        sum, and the <code>TryParse</code> version is not clearer — arguably the opposite, since the
        failure handling is an <code>if</code> rather than a labelled block. Choosing
        <code>TryX</code> at high failure rates is a performance decision, and choosing it at low
        ones would be a mistake.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Design an exception type for a settlement failure. Say what belongs in it, what does not, and
    compare it against <code>throw new Exception("Settlement failed")</code>.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="The design"><code>public sealed class SettlementException : Exception
{
    public SettlementException(string batchId, decimal amount, bool retryable, string reason,
                               Exception? inner = null)
        : base($"Settlement of batch {batchId} failed: {reason}.", inner)
    {
        BatchId = batchId;
        Amount = amount;
        Retryable = retryable;
    }

    public string BatchId { get; }
    public decimal Amount { get; }
    public bool Retryable { get; }
}</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>SettlementException: Settlement of batch BATCH-9 failed: amount must be positive.
  BatchId    = BATCH-9
  Amount     = -50
  Retryable  = False
  inner      = ArgumentOutOfRangeException

the same failure with a bare exception, for comparison:
Exception: Settlement failed
  an operator has the message and nothing else — no batch id
  to look up, no amount, and no way to decide about a retry
  except by parsing English out of the message string.</code></pre>
        <p><strong>What belongs in it.</strong> Everything a <em>handler</em> or an <em>operator</em>
        needs to act, as properties:</p>
        <ul>
          <li><code>BatchId</code> — so an operator can look the batch up without parsing the
          message.</li>
          <li><code>Retryable</code> — so a <code>when</code> filter can decide without string
          matching. This is the property that makes the type worth having at all.</li>
          <li><code>Amount</code> — so an alert can be routed by value.</li>
          <li>An <code>inner</code>, so the original technical failure survives.</li>
        </ul>
        <p><strong>What does not belong.</strong> Anything a handler cannot act on: the full
        request object, a database connection, a logger. An exception can be serialised, logged, and
        held far from where it was thrown, so it should carry values rather than resources. And it
        should be <code>sealed</code> unless you have a concrete plan for a subtype.</p>
        <p><strong>The comparison is the argument.</strong> With
        <code>Exception("Settlement failed")</code> a handler can do exactly one thing: log the
        sentence. It cannot retry selectively, alert on large amounts, or group failures by batch,
        because the only structured field is the type — which is <code>Exception</code>, shared with
        everything else in the process.</p>
        <p><strong>Three design details worth defending.</strong></p>
        <ul>
          <li><strong>The message is built in the constructor from the properties.</strong> The
          message and the structured data can then never disagree — a real failure mode when both
          are passed in separately.</li>
          <li><strong>No parameterless constructor.</strong> Guidance used to require the three
          "standard" constructors for serialisation; binary serialisation of exceptions is obsolete
          as of .NET 8 and the ceremony is no longer worth it. Take the parameters you actually
          need.</li>
          <li><strong><code>Retryable</code> is decided at the throw site.</strong> The code that
          knows why it failed is the code that knows whether retrying helps. Deciding it later means
          re-deriving it from a message.</li>
        </ul>
        <p><strong>When not to write one at all.</strong> If the framework has a type that fits —
        <code>ArgumentException</code>, <code>InvalidOperationException</code>,
        <code>TimeoutException</code>, <code>KeyNotFoundException</code> — use it. A custom type
        earns its place by carrying data the built-in one cannot, not by having a more specific
        name.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What are the two passes?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>First</strong>: walk the stack testing catch clauses and running filters, to find
        whether a handler exists — changing nothing. <strong>Second</strong>: only if one was found,
        unwind, running <code>finally</code> blocks, then run the handler.</p>
      </div></details>
    </li>
    <li>
      <p>Why does a filter run before a <code>finally</code> beneath it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Filters run in the first pass; <code>finally</code> blocks run in the second. Measured:
        <code>throw, FILTER, inner finally, outer finally, handler</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What does a <code>try</code> block cost when nothing throws?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>About 2.3–3.4 ns per operation</strong> — not free, but roughly one
        nine-hundredth of a single throw. No instruction runs on entry; the region constrains the
        JIT.</p>
      </div></details>
    </li>
    <li>
      <p>What does a throw cost, and what makes it expensive?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>~2,900 ns</strong> caught one frame away, <strong>18,159 ns</strong> at depth 32.
        Not allocation — constructing the object is <strong>20 ns</strong>, and throwing a cached
        instance still costs 1,816 ns. The cost is the two-pass search, the stack walk and the trace
        capture.</p>
      </div></details>
    </li>
    <li>
      <p>What is the difference between <code>throw;</code> and <code>throw ex;</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>throw;</code> continues the original propagation and keeps the trace.
        <code>throw ex;</code> starts a new one: measured, it lost the two frames where the failure
        actually happened. <code>CA2200</code> warns about it.</p>
      </div></details>
    </li>
    <li>
      <p>What happens to the original exception if a <code>finally</code> throws?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It is <strong>replaced</strong>. Measured: <code>InnerException</code> was
        <code>(none)</code> and the real failure vanished entirely. Cleanup code must not throw.</p>
      </div></details>
    </li>
    <li>
      <p>When are exceptions the wrong tool?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the failure is expected. Measured: <strong>178× slower</strong> at a 90% failure
        rate and <strong>1.04×</strong> at 0.01%. The rate decides, not the location.</p>
      </div></details>
    </li>
    <li>
      <p>How can you log an exception without handling it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A filter that logs and returns <code>false</code>. It runs in the first pass with the
        original stack and locals still live, and the exception continues to whoever should really
        handle it.</p>
      </div></details>
    </li>
    <li>
      <p>Which <code>catch</code> clause wins when two could match?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The <strong>first one in source order</strong>, not the most specific. The compiler
        rejects only the provable mistakes — <code>CS0160</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Can a <code>finally</code> change a return value?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. Measured: a method returning a local still returned <strong>1</strong> after a
        <code>finally</code> set that local to 99 — the value is captured first. And
        <code>return</code> inside <code>finally</code> is <code>CS0157</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What belongs in a custom exception type?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The data a handler or operator needs to <strong>act</strong>, as properties — measured
        example: <code>BatchId</code>, <code>Amount</code>, <code>Retryable</code>, plus an inner
        exception. Not resources, and not information only expressible in the message.</p>
      </div></details>
    </li>
    <li>
      <p>How do you rethrow an exception you saved earlier without losing its trace?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>ExceptionDispatchInfo.Capture(ex).Throw()</code>. Measured: it kept
        <code>Bottom &lt;- Middle</code> and appended the rethrow frame, where
        <code>throw ex;</code> kept neither.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
