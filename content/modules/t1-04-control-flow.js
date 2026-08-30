/* ============================================================================
   Track 1, Module 4 — Control Flow
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64.
   The runnable sources are in verification/t1-04-control-flow/.
   ========================================================================= */

CSPREP.module({
  id: "t1-04-control-flow",
  minutes: 55,
  updated: "2026-08-29",
  summary:
    "Decisions and repetition are the two ways a program stops being a straight line. Both are " +
    "cheap to write and expensive to get wrong: a loop that never ends, a branch the processor " +
    "cannot predict, or a nested loop that turns 20 seconds of work into a timeout.",
  terms: [
    "statement", "block", "condition", "boolean expression", "branch", "control flow",
    "guard clause", "loop", "iteration", "infinite loop", "off-by-one", "break", "continue",
    "fall-through", "exhaustive", "jump table", "short-circuit evaluation", "pipeline",
    "branch prediction", "branch misprediction", "quadratic", "enumerator"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Three incidents, all from the same payments service, all caused by the same category of
  code.</p>

  <p>The first: a single HTTP request never returns. No error is logged. The thread handling it
  never comes back, and after a few dozen such requests the service stops accepting new ones. A
  restart clears it. It comes back the next day.</p>

  <p>The second: a new payment status, <code>disputed</code>, is added upstream. Nothing in the
  service crashes. Nothing is logged. Disputed payments are quietly treated as though they never
  arrived, and the discrepancy is found six weeks later during an audit.</p>

  <p>The third: the nightly reconciliation job, which has run in under a second for two years,
  starts taking twenty seconds. Then it starts timing out. Nobody changed the job. The business
  grew.</p>

  <p>Each of these is a control-flow bug: code that decides <em>whether</em> to do something, or
  <em>how many times</em> to do it. That is two keywords' worth of syntax, learned in an
  afternoon, and it produces failures that take days to find because <strong>none of them
  throws an exception</strong>. The program does exactly what it was told.</p>

  <p>This module covers the syntax quickly and then spends most of its length on what that syntax
  becomes when it runs, because that is what lets you reason about the three incidents above
  rather than recognising them only after meeting each one.</p>
</section>

<section id="what-control-flow-is">
  <h2>What control flow actually is</h2>

  <p>Every term is defined before it is used again.</p>

  <p class="define"><span class="define__term">Statement</span> One complete instruction in your
  source code, usually ending in a semicolon: <code>int total = 0;</code> A program is a list of
  statements.</p>

  <p class="define"><span class="define__term">Control flow</span> The order in which statements
  are executed. By default it is strictly top to bottom, one after another. Control flow
  constructs are the tools for changing that order.</p>

  <p class="define"><span class="define__term">Block</span> A group of statements wrapped in
  braces <code>{ }</code>, treated as a single unit. Blocks are what <code>if</code> and loops
  attach to.</p>

  <p class="define"><span class="define__term">Boolean expression</span> An expression that
  evaluates to either <code>true</code> or <code>false</code> — <code>amount &gt; 100</code>,
  <code>reference is null</code>. Named after George Boole. In C# a condition must be a boolean
  expression and nothing else.</p>

  <p class="define"><span class="define__term">Condition</span> The boolean expression a
  construct tests to decide what to do next.</p>

  <p class="define"><span class="define__term">Branch</span> A point where execution can go one
  of two or more ways. Also used as a verb: the code "branches" on a condition.</p>

  <p class="define"><span class="define__term">Loop</span> A construct that runs the same block
  repeatedly. One pass through the block is an <strong>iteration</strong>.</p>

  <p>There are only two ideas in this module — choose, and repeat — and every construct is a
  variation on one of them.</p>

  <div class="callout callout--note">
    <h4>The analogy, and where it breaks</h4>
    <p>Control flow is the difference between a <strong>shopping list</strong> and a
    <strong>recipe</strong>. A shopping list is executed top to bottom with no decisions. A
    recipe says "if the sauce is too thin, simmer for another five minutes" and "repeat until
    the onions are golden" — it branches and it loops.</p>
    <p>Where the analogy breaks, and it matters: a cook evaluates "until golden" continuously
    and with judgement, and will stop if something has clearly gone wrong. A processor checks the
    condition only at the exact moment the construct says to, and applies no judgement whatever.
    "Repeat until the onions are golden" with no way for <em>golden</em> to ever become true is a
    cook who eventually notices. In code it is a thread that spins for ever, which is precisely
    the first incident above.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>Choosing: the smallest example</h2>

<pre data-lang="csharp" data-net="10" data-title="01-branching.cs"><code>static string Classify(decimal amount)
{
    if (amount &lt; 0m)
    {
        return "refund";
    }
    else if (amount == 0m)
    {
        return "zero";
    }
    else if (amount &lt; 1000m)
    {
        return "standard";
    }
    else
    {
        return "large, needs review";
    }
}</code></pre>

<pre data-lang="console" data-title="Output"><code>      -5 -&gt; refund
       0 -&gt; zero
      25 -&gt; standard
    5000 -&gt; large, needs review</code></pre>

  <p>The conditions are tested in order and <strong>the first one that is true wins</strong>.
  Everything after it is skipped. That ordering is load-bearing: swap the first two tests and
  nothing changes, but move <code>amount &lt; 1000m</code> above <code>amount &lt; 0m</code> and
  every refund becomes "standard", because −5 is indeed less than 1000.</p>

  <p>When a branch produces a <em>value</em> rather than performing an action, the conditional
  operator says the same thing in one expression:</p>

<pre data-lang="csharp" data-net="10" data-title="01-branching.cs"><code>string label = count == 1 ? "1 invoice" : $"{count} invoices";</code></pre>

  <p>Read <code>?</code> as "then" and <code>:</code> as "otherwise". It is an expression, so it
  can appear anywhere a value can — including inside a string, an argument, or a field
  initialiser, where a full <code>if</code> statement cannot.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha: a condition must be a bool, and C# enforces it</h4>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>if (amount = 500)      // one '=' instead of two
{
    Console.WriteLine("never");
}</code></pre>
<pre data-lang="console" data-title="Compiler output"><code>error CS0029: Cannot implicitly convert type 'int' to 'bool'</code></pre>
    <p>In C and C++ this compiles: the assignment produces 500, which is non-zero, which counts
    as true — so the condition is always true and the variable has been silently overwritten. It
    is one of the most famous bug classes in programming history.</p>
    <p>C# closes it by requiring conditions to be <code>bool</code> and nothing else. There is no
    "truthy". Worth knowing because you will read C-family code, and because it explains why C#
    does not let you write <code>if (list.Count)</code> as a shorthand for "not empty".</p>
  </div>
</section>

<section id="guard-clauses">
  <h2>Shaping branches: guard clauses</h2>

  <p>The syntax is the smaller half. The shape you give a set of branches determines whether the next
  person can read it.</p>

  <p>Here is validation written by nesting each rule inside the previous one — the way it comes
  out if you add rules one at a time:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="01-branching.cs — the shape to avoid"><code>static string NestedValidate(string? reference)
{
    if (reference is not null)
    {
        if (reference.Length &gt; 0)
        {
            if (reference.StartsWith("INV-", StringComparison.Ordinal))
            {
                if (reference.Length == 11)
                {
                    return "valid";
                }
                else
                {
                    return "wrong length";
                }
            }
            else
            {
                return "wrong prefix";
            }
        }
        else
        {
            return "empty";
        }
    }
    else
    {
        return "null";
    }
}</code></pre>

  <p class="define"><span class="define__term">Guard clause</span> A check at the top of a method
  that handles a failure case and returns immediately, so the rest of the method can assume the
  failure did not happen.</p>

<pre data-lang="csharp" data-net="10" data-title="01-branching.cs — the same logic"><code>static string GuardedValidate(string? reference)
{
    if (reference is null)
    {
        return "null";
    }

    if (reference.Length == 0)
    {
        return "empty";
    }

    if (!reference.StartsWith("INV-", StringComparison.Ordinal))
    {
        return "wrong prefix";
    }

    if (reference.Length != 11)
    {
        return "wrong length";
    }

    return "valid";
}</code></pre>

<pre data-lang="console" data-title="Both produce identical results"><code>  (null)       nested=null                   guarded=null
               nested=empty                  guarded=empty
  INV-1        nested=wrong length           guarded=wrong length
  INV-0000042  nested=valid                  guarded=valid</code></pre>

  <p>Three concrete differences, not stylistic preferences:</p>

  <ul>
    <li><strong>The success path is findable.</strong> In the guarded version it is the last
    line, at the top level. In the nested version it is four levels deep, and adding a fifth rule
    pushes it deeper.</li>
    <li><strong>Each rule is next to its error.</strong> In the nested version,
    <code>reference is not null</code> and its <code>return "null"</code> are separated by
    twenty lines, so it takes only a moment of inattention to change one and not the other.</li>
    <li><strong>Deleting a rule is a local edit.</strong> Removing a guard clause is deleting
    four lines. Removing a nested condition means re-indenting everything inside it and finding
    its matching <code>else</code>.</li>
  </ul>

  <p>The rule that follows: <strong>handle failures early and return; keep the success path at
  the lowest indentation level.</strong> If you find yourself three <code>if</code>s deep, the
  fix is almost always to invert the outermost condition and return.</p>
</section>

<section id="switch">
  <h2>Choosing between many options: <code>switch</code></h2>

  <p>A chain of <code>else if</code> comparing one value against many constants is common enough
  to have its own construct.</p>

<pre data-lang="csharp" data-net="10" data-title="03-switch.cs"><code>static string DescribeWithStatement(string status)
{
    switch (status)
    {
        // Empty labels stacked together share one body. This is the only
        // form of "fall through" C# allows.
        case "pending":
        case "authorised":
            return "money not moved yet";

        case "captured":
            return "money taken";

        case "refunded":
            return "money returned";

        case "chargeback":
            return "money taken back by the bank";

        default:
            return $"unknown status '{status}'";
    }
}</code></pre>

  <p>Since C# 8 the same thing can be written as an expression, which is usually shorter and
  cannot accidentally fall out of the bottom:</p>

<pre data-lang="csharp" data-net="10" data-title="03-switch.cs"><code>static string DescribeWithExpression(string status) =&gt; status switch
{
    "pending" or "authorised" =&gt; "money not moved yet",
    "captured" =&gt; "money taken",
    "refunded" =&gt; "money returned",
    "chargeback" =&gt; "money taken back by the bank",
    _ =&gt; $"unknown status '{status}'"
};</code></pre>

<pre data-lang="console" data-title="Output — identical for both"><code>  pending      -&gt; money not moved yet
  authorised   -&gt; money not moved yet
  captured     -&gt; money taken
  refunded     -&gt; money returned
  chargeback   -&gt; money taken back by the bank
  banana       -&gt; unknown status 'banana'</code></pre>

  <p>The <code>_</code> is the discard pattern, meaning "anything else" — the expression form's
  equivalent of <code>default</code>.</p>

  <p class="define"><span class="define__term">Fall-through</span> In C and C++, execution
  running on from one <code>case</code> into the next unless stopped by a <code>break</code>.
  Forgetting the <code>break</code> is a classic C bug.</p>

  <p><strong>C# does not permit it.</strong> Every non-empty case must end by leaving the
  switch — <code>break</code>, <code>return</code>, <code>throw</code>, or an explicit
  <code>goto case</code>:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="08-compile-error-probe.cs"><code>switch (amount)
{
    case 500:
        Console.WriteLine("five hundred");
    case 1000:
        Console.WriteLine("one thousand");
        break;
}</code></pre>

<pre data-lang="console" data-title="Compiler output"><code>error CS0163: Control cannot fall through from one case label ('case 500:') to another</code></pre>

  <p>This is a genuine improvement on C, and it is why stacking empty labels
  (<code>case "pending": case "authorised":</code>) is the one permitted form — there is no body
  to fall out of.</p>

  <p class="define"><span class="define__term">Exhaustive</span> A switch is exhaustive when its
  cases cover every possible input. A switch expression that is not exhaustive compiles with a
  warning and throws at run time if an uncovered value arrives.</p>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>string label = amount switch
{
    500 =&gt; "five hundred"
};</code></pre>

<pre data-lang="console" data-title="Compiler output"><code>warning CS8509: The switch expression does not handle all possible values of its input type
(it is not exhaustive). For example, the pattern '0' is not covered.</code></pre>

  <div class="callout callout--warn">
    <h4>Warning: this is the second incident from the opening</h4>
    <p>A <code>switch</code> <em>statement</em> with no <code>default</code> and no matching case
    does nothing at all, silently. That is what happened when <code>disputed</code> was added
    upstream: the switch had cases for the five known statuses, no <code>default</code>, and the
    new value fell through the whole construct without matching anything. No exception, no log
    line, no clue.</p>
    <p>A <code>switch</code> <em>expression</em> fails loudly instead — it throws
    <code>SwitchExpressionException</code> — and warns at compile time via CS8509. That is a
    strong reason to prefer the expression form when producing a value, and to always write a
    <code>default</code> that throws or logs when using the statement form:</p>
<pre data-lang="csharp" data-net="10" data-title="The habit worth forming"><code>default:
    throw new ArgumentOutOfRangeException(
        nameof(status), status, "Unhandled payment status.");</code></pre>
    <p>An exception on an unknown status is far cheaper than six weeks of quiet
    mis-accounting.</p>
  </div>
</section>

<section id="loops">
  <h2>Repeating: the four loops</h2>

<pre data-lang="csharp" data-net="10" data-title="02-loops.cs"><code>string[] references = { "INV-01", "INV-02", "SKIP", "INV-03", "STOP", "INV-04" };

// for - when you need the index
for (int i = 0; i &lt; references.Length; i++)
{
    Console.WriteLine($"  [{i}] {references[i]}");
}

// foreach - when you do not
foreach (string reference in references)
{
    Console.WriteLine($"  {reference}");
}

// while - when the count is not known in advance
int remaining = 3;
while (remaining &gt; 0)
{
    Console.WriteLine($"  {remaining} retries left");
    remaining--;
}

// do/while - when the body must run at least once
int attempt = 0;
do
{
    attempt++;
    Console.WriteLine($"  attempt {attempt}");
}
while (attempt &lt; 1);</code></pre>

  <p>The <code>for</code> header has three parts separated by semicolons: run once at the start;
  test before every iteration; run after every iteration. The <code>i++</code> is the third part,
  and it runs even when the body used <code>continue</code> — a detail that matters shortly.</p>

  <p class="define"><span class="define__term">break</span> Leave the loop entirely, now.</p>

  <p class="define"><span class="define__term">continue</span> Skip the rest of this iteration
  and go to the next one. The loop carries on.</p>

<pre data-lang="csharp" data-net="10" data-title="02-loops.cs"><code>foreach (string reference in references)
{
    if (reference == "SKIP")
    {
        continue;
    }
    if (reference == "STOP")
    {
        break;
    }
    Console.WriteLine($"  processing {reference}");
}</code></pre>

<pre data-lang="console" data-title="Output"><code>  processing INV-01
  processing INV-02
  processing INV-03</code></pre>

  <p>Note what is missing: <code>INV-04</code> comes after <code>STOP</code> in the array and is
  never reached, because <code>break</code> abandons the whole loop rather than one item.</p>

  <div class="callout callout--warn">
    <h4>Warning: this is the first incident from the opening</h4>
    <p><code>continue</code> in a <code>while</code> loop skips <strong>everything</strong>
    remaining in the body — including the line that advances the counter.</p>
<pre data-lang="csharp" data-net="10" data-bad="true" data-title="This never terminates"><code>int index = 0;
while (index &lt; references.Length)
{
    if (references[index] == "SKIP")
    {
        continue;      // index++ never runs; the condition never changes
    }

    Console.WriteLine($"  processed {references[index]}");
    index++;
}</code></pre>
<pre data-lang="console" data-title="Output, with a safety limit added so the demo terminates"><code>  processed INV-01
  processed INV-02
  bailed out after 20 iterations - index is still 2
  in production there is no safety limit and the thread hangs here</code></pre>
    <p>The thread spins at 100% CPU for ever. The request never completes and never errors. In a
    web service, enough of these and the thread pool has nothing left to hand out, which is why
    the whole service stopped accepting requests rather than only the affected ones.</p>
    <p>The same logic as a <code>for</code> loop cannot have this bug, because the increment
    lives in the loop header where <code>continue</code> cannot skip it:</p>
<pre data-lang="csharp" data-net="10" data-title="Safe by construction"><code>for (int i = 0; i &lt; references.Length; i++)
{
    if (references[i] == "SKIP")
    {
        continue;   // the i++ in the for header still runs
    }
    Console.WriteLine($"  processed {references[i]}");
}</code></pre>
    <p><strong>The rule: if a loop body contains <code>continue</code>, prefer
    <code>for</code> or <code>foreach</code> over <code>while</code></strong>, so that advancing
    is structural rather than something you have to remember.</p>
  </div>
</section>

<section id="short-circuit">
  <h2>Combining conditions, and why <code>&amp;&amp;</code> is not <code>&amp;</code></h2>

  <p class="define"><span class="define__term">Short-circuit evaluation</span> Stopping as soon
  as the answer is certain. If the left side of <code>&amp;&amp;</code> is false, the whole
  expression is false whatever the right side says, so the right side is never evaluated.
  <code>||</code> does the same when the left side is true.</p>

  <p>C# has both short-circuiting and non-short-circuiting operators, and they differ by exactly
  one character:</p>

<pre data-lang="csharp" data-net="10" data-title="04-short-circuit.cs"><code>// Safe: if customer is null, the right side is never evaluated.
static bool IsUkCustomerSafe(Customer? customer) =&gt;
    customer is not null &amp;&amp; customer.CountryCode == "GB";

// Unsafe: '&amp;' always evaluates both sides.
static bool IsUkCustomerUnsafe(Customer? customer) =&gt;
    customer is not null &amp; customer!.CountryCode == "GB";</code></pre>

<pre data-lang="console" data-title="Output"><code>&amp;&amp; stops as soon as the answer is known
  missing is a UK customer : False
  present is a UK customer : True

&amp; evaluates both sides, always
  missing is a UK customer : threw NullReferenceException</code></pre>

  <p class="define"><span class="define__term">null</span> A reference that points at nothing.
  Reading a member through one — <code>customer.CountryCode</code> when
  <code>customer</code> is <code>null</code> — has nothing to read, so the runtime stops the
  operation and reports a <strong>NullReferenceException</strong>. That is what the second line
  of output above is. <a href="#/m/t1-28-nullable-reference-types">Nullable Reference Types</a>
  is about getting the compiler to catch this before it runs.</p>

  <p>Counting how many times the right-hand side actually runs makes the mechanism concrete:</p>

<pre data-lang="console" data-title="Output"><code>  false &amp;&amp; f()  -&gt; right side called 0 time(s)
  false &amp;  f()  -&gt; right side called 1 time(s)
  true  || f()  -&gt; right side called 0 time(s)
  true  |  f()  -&gt; right side called 1 time(s)

(results False False True True - identical answers, different work done)</code></pre>

  <p>Identical answers, different work. Two consequences follow.</p>

  <p><strong>Correctness.</strong> Every null check of the form
  <code>x is not null &amp;&amp; x.Something</code> depends on short-circuiting. With
  <code>&amp;</code> it throws.</p>

  <p><strong>Cost.</strong> Order your conditions cheapest-first. Writing
  <code>if (IsInDatabase(id) &amp;&amp; id &gt; 0)</code> performs a database call to reject a
  negative id; reversing it rejects the id for free.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Because the right side may never run, <strong>never put something with a side effect
    there</strong>:</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>if (isValid &amp;&amp; TryReserveStock(order))   // stock is not reserved when isValid is false
{
    Confirm(order);
}</code></pre>
    <p>That may be exactly what you want, but it is invisible to a reader skimming the condition.
    Put actions in the body, not the test.</p>
  </div>
</section>

<section id="how-it-compiles">
  <h2>What a branch becomes when it runs</h2>

  <p>This section is what turns the rest of the module from syntax into something you can reason
  with, so it is worth the two extra definitions.</p>

  <p class="define"><span class="define__term">Instruction</span> One thing the processor knows
  how to do at the smallest scale — add two numbers, compare two numbers, jump to a different
  place in the code.</p>

  <p>An <code>if</code> becomes two instructions: compare, then <em>conditionally jump</em>. That
  is the whole mechanism. A loop is the same thing with the jump pointing backwards.</p>

  <p>A <code>switch</code> is more interesting, because the compiler and JIT choose between two
  strategies:</p>

  <ul>
    <li><strong>A chain of comparisons</strong>, exactly like <code>else if</code>. Used when
    there are few cases or the values are scattered. Cost grows with the number of cases.</li>
    <li><strong>A jump table.</strong> Used when the cases are integers in a reasonably dense
    range. The value is used as an index into a table of addresses, and execution jumps straight
    to the right one.</li>
  </ul>

  <p class="define"><span class="define__term">Jump table</span> An array of code addresses
  indexed by the switch value, so any case is reached in constant time regardless of how many
  cases exist.</p>

  <p>Switching on a <code>string</code>, as in the earlier example, cannot use a jump table
  directly. For more than a handful of cases the compiler computes the string's hash code,
  switches on that using a jump table, and then does one string comparison to confirm. You get
  near-constant-time dispatch without writing anything different — which is the practical reason
  to prefer <code>switch</code> over a long <code>else if</code> chain even when they read the
  same.</p>

  <h3>Branch prediction: why identical work takes different amounts of time</h3>

  <p class="define"><span class="define__term">Pipeline</span> Modern processors do not finish
  one instruction before starting the next. They work on a dozen or more at once, at different
  stages, like a factory line.</p>

  <p>A conditional jump is a problem for a pipeline: the processor cannot know which instructions
  come next until the comparison finishes. Waiting would empty the line. So it
  <strong>guesses</strong>.</p>

  <p class="define"><span class="define__term">Branch prediction</span> The processor guessing
  which way a branch will go, based on what happened at that branch recently, and speculatively
  executing the guessed path.</p>

  <p class="define"><span class="define__term">Branch misprediction</span> A wrong guess. The
  speculative work is discarded and the pipeline refilled — typically 15 to 20 wasted cycles.</p>

  <p>This is measurable from C#, and the effect is larger than most people expect. The following
  sums the values in an array that are at least 128. It runs twice over the <em>same data</em> —
  once shuffled, once sorted.</p>

<pre data-lang="csharp" data-net="10" data-title="06-branch-prediction.cs"><code>const int Size = 32_768;
const int Repeats = 2_000;

int[] unsorted = new int[Size];
Random random = new Random(42);
for (int i = 0; i &lt; Size; i++)
{
    unsorted[i] = random.Next(256);
}

int[] sorted = (int[])unsorted.Clone();
Array.Sort(sorted);

static long SumAboveThreshold(int[] values, int repeats)
{
    long total = 0;
    for (int r = 0; r &lt; repeats; r++)
    {
        for (int i = 0; i &lt; values.Length; i++)
        {
            if (values[i] &gt;= 128)
            {
                total += values[i];
            }
        }
    }
    return total;
}</code></pre>

<pre data-lang="console" data-title="dotnet run -c Release 06-branch-prediction.cs"><code>array of 32,768 values, summed 2,000 times

  unsorted data :    262 ms
  sorted data   :     35 ms
  ratio         :    7.5x

  unsorted, branchless :     53 ms</code></pre>

  <p><strong>The same values, the same total, the same number of comparisons — several times
  the time.</strong> Across three runs on this machine the ratio was 7.5x, 6.5x, and 4.7x. The
  exact multiple moves with machine load and is not worth quoting to one decimal place; that it
  is consistently several-fold, on identical data, is the finding.</p>

  <p>Sorting the data puts all the values below 128 first and all the values above it second, so
  the branch goes the same way thousands of times in a row and the processor's guess is nearly
  always right. Shuffled, the branch is a coin flip and roughly half the guesses are wrong.</p>

  <p>The third line proves the cost is the branch and not the arithmetic. The branchless version
  computes the same sum on the <em>unsorted</em> data using bit manipulation instead of an
  <code>if</code>, and takes 53 ms against 262 ms:</p>

<pre data-lang="csharp" data-net="10" data-title="06-branch-prediction.cs"><code>// (value - 128) &gt;&gt; 31 is 0 when value &gt;= 128 and -1 otherwise.
// ~mask is then -1 (all bits set) when we want to add, 0 when not.
int value = values[i];
int mask = ~((value - 128) &gt;&gt; 31);
total += value &amp; mask;</code></pre>

  <div class="callout callout--note">
    <h4>What to do with this</h4>
    <p><strong>Not</strong> rewrite your <code>if</code> statements as bit manipulation. That
    code is unreadable and the compiler often does it for you.</p>
    <p>What this buys you is an explanation for results that otherwise look impossible: the same
    method being several times slower on one dataset than another, sorting <em>before</em> a loop
    making the whole operation faster despite the sort's own cost, and a benchmark that improves
    when you feed it real data instead of random data. When you see those, unpredictable
    branching is the first thing to suspect.</p>
    <p>It also explains why this effect never appears in a request-handling method that runs
    once. It needs a tight loop over many items to matter at all.</p>
  </div>
</section>

<section id="production-example">
  <h2>The same ideas in a real service</h2>

  <p>Here is a Ledger batch processor using every construct in this module: guard clauses, a
  switch expression, a loop that can be stopped from outside, and short-circuited conditions.</p>

<pre data-lang="csharp" data-net="10" data-title="Ledger — PaymentBatchProcessor.cs"><code>using System.Globalization;

public sealed class PaymentBatchProcessor
{
    private readonly IPaymentGateway _gateway;
    private readonly ILedgerLog _log;

    public PaymentBatchProcessor(IPaymentGateway gateway, ILedgerLog log)
    {
        _gateway = gateway;
        _log = log;
    }

    public BatchResult Process(IReadOnlyList&lt;Payment&gt; payments, CancellationToken cancellationToken)
    {
        // Guard clauses: deal with the impossible inputs and get out.
        ArgumentNullException.ThrowIfNull(payments);

        if (payments.Count == 0)
        {
            return new BatchResult(0, 0, 0);
        }

        int settled = 0;
        int skipped = 0;
        int failed = 0;

        for (int i = 0; i &lt; payments.Count; i++)
        {
            // A long loop must be interruptible, or a shutdown waits for it.
            cancellationToken.ThrowIfCancellationRequested();

            Payment payment = payments[i];

            // Short-circuiting: the second test is only safe because the first ran.
            if (payment.Reference is null || payment.Reference.Length == 0)
            {
                _log.Warn($"payment at index {i} has no reference; skipping");
                skipped++;
                continue;
            }

            if (payment.Amount &lt;= 0m)
            {
                _log.Warn($"{payment.Reference} has a non-positive amount; skipping");
                skipped++;
                continue;
            }

            // A switch EXPRESSION, so an unknown status cannot pass silently.
            PaymentAction action = payment.Status switch
            {
                "authorised" =&gt; PaymentAction.Capture,
                "pending" =&gt; PaymentAction.Wait,
                "captured" or "refunded" =&gt; PaymentAction.Nothing,
                "chargeback" =&gt; PaymentAction.Escalate,
                _ =&gt; PaymentAction.Unknown
            };

            switch (action)
            {
                case PaymentAction.Capture:
                    if (_gateway.TryCapture(payment.Reference, payment.Amount))
                    {
                        settled++;
                    }
                    else
                    {
                        failed++;
                        _log.Error($"{payment.Reference} could not be captured");
                    }
                    break;

                case PaymentAction.Wait:
                case PaymentAction.Nothing:
                    skipped++;
                    break;

                case PaymentAction.Escalate:
                    _log.Error($"{payment.Reference} is a chargeback and needs a human");
                    failed++;
                    break;

                // Never silent. An unrecognised status is a bug, not a no-op.
                case PaymentAction.Unknown:
                default:
                    throw new InvalidOperationException(
                        $"Unhandled payment status '{payment.Status}' on {payment.Reference}.");
            }
        }

        return new BatchResult(settled, skipped, failed);
    }
}

public enum PaymentAction
{
    Unknown = 0,
    Capture,
    Wait,
    Nothing,
    Escalate
}

public sealed record Payment(string? Reference, decimal Amount, string Status);

public sealed record BatchResult(int Settled, int Skipped, int Failed);

public interface IPaymentGateway
{
    bool TryCapture(string reference, decimal amount);
}

public interface ILedgerLog
{
    void Warn(string message);
    void Error(string message);
}</code></pre>

  <p>Five decisions in that code are worth naming, because each is the module's content applied
  rather than demonstrated:</p>

  <ul>
    <li><strong>Guard clauses first.</strong> Empty and null inputs are dismissed before any real
    work, so the main loop never wonders whether the list is valid.</li>
    <li><strong><code>for</code>, not <code>while</code>.</strong> The body uses
    <code>continue</code> in two places; a <code>while</code> loop would need its increment
    remembered in both.</li>
    <li><strong>The index is used in a log message.</strong> That is the honest reason to prefer
    <code>for</code> over <code>foreach</code> here — a payment with no reference cannot be
    identified any other way.</li>
    <li><strong>Cancellation is checked every iteration.</strong> Without it, a shutdown waits
    for the entire batch. With it, the loop stops within one payment.</li>
    <li><strong>The unknown case throws.</strong> This is the fix for the second opening
    incident, and it is deliberately the loudest branch in the method.</li>
  </ul>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Changing a collection while looping over it</h3>

  <p class="define"><span class="define__term">Enumerator</span> The hidden object a
  <code>foreach</code> uses to walk a collection. It records its position, and it checks that the
  collection has not changed underneath it.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="05-modifying-while-iterating.cs"><code>List&lt;string&gt; batch = new List&lt;string&gt; { "INV-1", "BAD-1", "BAD-2", "INV-2", "BAD-3" };

foreach (string reference in batch)
{
    if (reference.StartsWith("BAD", StringComparison.Ordinal))
    {
        batch.Remove(reference);
    }
}</code></pre>

<pre data-lang="console" data-title="Output"><code>threw InvalidOperationException: Collection was modified; enumeration operation may not execute.</code></pre>

  <p>Switching to an indexed loop removes the exception and replaces it with something worse — a
  silent wrong answer:</p>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>for (int i = 0; i &lt; batch.Count; i++)
{
    if (batch[i].StartsWith("BAD", StringComparison.Ordinal))
    {
        batch.RemoveAt(i);
    }
}</code></pre>

<pre data-lang="console" data-title="Output"><code>survived: INV-1, BAD-2, INV-2   &lt;-- BAD-2 is still here</code></pre>

  <p>Removing index 1 shifts everything down, so what was index 2 becomes index 1 — and
  <code>i++</code> then moves past it. Every item immediately after a removed one is skipped.</p>

  <p>Three approaches that work:</p>

<pre data-lang="csharp" data-net="10" data-title="Pick one of these"><code>// 1. Loop backwards: removal only shifts indexes AFTER the one removed.
for (int i = batch.Count - 1; i &gt;= 0; i--)
{
    if (batch[i].StartsWith("BAD", StringComparison.Ordinal))
    {
        batch.RemoveAt(i);
    }
}

// 2. RemoveAll: the same thing, in one line. Prefer this.
batch.RemoveAll(reference =&gt; reference.StartsWith("BAD", StringComparison.Ordinal));

// 3. Build a new list and leave the original alone.
List&lt;string&gt; kept = new List&lt;string&gt;();
foreach (string reference in batch)
{
    if (!reference.StartsWith("BAD", StringComparison.Ordinal))
    {
        kept.Add(reference);
    }
}</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha: the rule is not the same for every collection</h4>
    <p>The usual advice is "never modify a collection while enumerating it". On modern .NET that
    is over-broad, and knowing the real behaviour stops you being surprised in both directions.
    Measured on .NET 10:</p>
<pre data-lang="console" data-title="Output"><code>  List&lt;string&gt;.Remove              throws InvalidOperationException
  Dictionary.Remove                allowed
  Dictionary.Add                   throws InvalidOperationException
  Dictionary update existing key   allowed
  HashSet.Remove                   allowed</code></pre>
    <p><code>Dictionary</code> and <code>HashSet</code> have permitted <code>Remove</code> during
    enumeration since .NET Core 3.0. <code>List</code> never has, and
    <code>Dictionary.Add</code> still throws.</p>
    <p><strong>Do not rely on the permitted cases.</strong> They teach a habit that breaks the
    moment someone changes a <code>Dictionary</code> to a <code>List</code>, and the failure
    surfaces at run time in whichever code path happens to remove something. Use
    <code>RemoveAll</code>, a backwards loop, or a new collection, and the question never
    arises.</p>
  </div>

  <h3>2. The loop that never ends</h3>

  <p class="define"><span class="define__term">Infinite loop</span> A loop whose condition never
  becomes false. The thread runs at full CPU indefinitely, producing no error.</p>

  <p>The three common causes:</p>

  <ul>
    <li><strong><code>continue</code> skipping the increment</strong> in a <code>while</code>
    loop — shown earlier.</li>
    <li><strong>A condition that cannot be reached.</strong>
    <code>while (balance != 0)</code> where <code>balance</code> is a <code>double</code>
    stepping by 0.1 never hits exactly zero, because 0.1 has no exact binary representation.
    Use <code>&lt;=</code> or <code>decimal</code>.</li>
    <li><strong>A retry loop with no attempt limit.</strong> <code>while (!Succeeded())</code>
    against a service that is down spins for ever. Always bound retries by count and by
    time.</li>
  </ul>

  <h3>3. A loop inside a loop, over the same growing data</h3>

  <p class="define"><span class="define__term">Quadratic</span> Work that grows with the square
  of the input. Doubling the input quadruples the time. Written O(n²).</p>

  <p>This is the third opening incident, and the most common serious performance bug in
  ordinary business code:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="07-nested-loops.cs"><code>static int MatchWithNestedLoop(Payment[] payments, Invoice[] invoices)
{
    int matched = 0;
    foreach (Payment payment in payments)
    {
        foreach (Invoice invoice in invoices)
        {
            if (invoice.Reference == payment.Reference)
            {
                matched++;
                break;
            }
        }
    }
    return matched;
}</code></pre>

  <p>It is correct, readable, and passes every test. It is also unusable past a few thousand
  items. The fix is to build a lookup once, then check it:</p>

<pre data-lang="csharp" data-net="10" data-title="07-nested-loops.cs"><code>static int MatchWithLookup(Payment[] payments, Invoice[] invoices)
{
    Dictionary&lt;string, Invoice&gt; byReference = new Dictionary&lt;string, Invoice&gt;(
        invoices.Length, StringComparer.Ordinal);

    foreach (Invoice invoice in invoices)
    {
        byReference[invoice.Reference] = invoice;
    }

    int matched = 0;
    foreach (Payment payment in payments)
    {
        if (byReference.ContainsKey(payment.Reference))
        {
            matched++;
        }
    }
    return matched;
}</code></pre>

  <p>Measured, with matched results proving both versions agree:</p>

<pre data-lang="console" data-title="dotnet run -c Release 07-nested-loops.cs"><code> 1,000 payments x  1,000 invoices =       1,000,000 comparisons  nested       5 ms   lookup    1 ms
 5,000 payments x  5,000 invoices =      25,000,000 comparisons  nested      49 ms   lookup    0 ms
10,000 payments x 10,000 invoices =     100,000,000 comparisons  nested     219 ms   lookup    2 ms
20,000 payments x 20,000 invoices =     400,000,000 comparisons  nested     927 ms   lookup    1 ms</code></pre>

  <p>Read the nested column downwards: 5, 49, 219, 927. Each doubling of the input roughly
  quadruples the time. The lookup column does not move.</p>

  <h3>4. Off-by-one</h3>

  <p class="define"><span class="define__term">Off-by-one</span> A loop that runs one time too
  many or one too few, usually from confusing <code>&lt;</code> with <code>&lt;=</code>.</p>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>for (int i = 0; i &lt;= items.Length; i++)   // IndexOutOfRangeException on the last pass
{
    Process(items[i]);
}</code></pre>

  <p>An array of length 3 has indexes 0, 1, 2. The standard form
  <code>for (int i = 0; i &lt; length; i++)</code> is correct for exactly this reason and is worth
  writing without thinking. When you need <code>&lt;=</code>, it is a signal to check the bounds
  deliberately — for example when looping to <code>Count - 1</code> while comparing each item
  with its neighbour.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>Symptom: a request hangs, or CPU sits at 100% with nothing being produced</h4>
    <ol>
      <li><strong>Confirm it is a spin, not a wait.</strong> Watch the process:
<pre data-lang="bash" data-title="terminal"><code>dotnet-counters monitor --process-id 1234 --counters System.Runtime</code></pre>
      High <code>cpu-usage</code> with a flat <code>alloc-rate</code> is a tight loop doing
      arithmetic. Near-zero CPU is the opposite problem — a deadlock or a blocked I/O call, not
      this module.</li>
      <li><strong>Find the loop by looking at where the threads are:</strong>
<pre data-lang="bash" data-title="terminal"><code>dotnet-dump collect --process-id 1234
dotnet-dump analyze core_20260829_193045
&gt; clrthreads
&gt; clrstack</code></pre>
      Several threads parked at the same method is your answer. Take two dumps a few seconds
      apart: if the stack has not moved, it is not making progress.</li>
      <li><strong>Read the loop for the exit condition.</strong> Ask: what changes the value the
      condition tests, and can <code>continue</code> skip it? That single question finds the
      <code>while</code>/<code>continue</code> bug immediately.</li>
      <li><strong>Fix by making progress structural</strong> — move the increment into a
      <code>for</code> header — and add a bound to any retry loop so a hang becomes a logged
      failure.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: <code>InvalidOperationException: Collection was modified</code></h4>
    <ol>
      <li><strong>Read the message literally.</strong> It names the cause exactly: something
      added to or removed from the collection during a <code>foreach</code>.</li>
      <li><strong>Look for the non-obvious mutation.</strong> The <code>Remove</code> is often
      not in the loop body but inside a method the loop calls, sometimes several frames down.
      The stack trace shows the enumerator's <code>MoveNext</code> at the top; the mutation is
      further down the same stack.</li>
      <li><strong>Check for a shared collection across threads.</strong> If nothing in the stack
      mutates it, another thread did, and you have a concurrency bug wearing this exception's
      clothing. The fix there is a lock or a concurrent collection, not a backwards loop.</li>
      <li><strong>Fix with <code>RemoveAll</code>, a backwards loop, or a new collection.</strong>
      Prefer <code>RemoveAll</code> — it is one line and cannot be got wrong.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: fine in testing, far too slow in production</h4>
    <ol>
      <li><strong>Compare the data sizes,</strong> not the code. Test fixtures typically hold
      tens of rows; production holds tens of thousands. A quadratic loop is invisible at
      100 items (10,000 comparisons) and fatal at 50,000 (2.5 billion).</li>
      <li><strong>Time it at two sizes rather than profiling immediately.</strong> Run the
      operation over n and 2n items. Roughly double the time is linear and fine. Roughly four
      times is quadratic, and you have found it without any tooling.</li>
      <li><strong>Then look for a loop inside a loop</strong> over collections that both grow
      with the data. Watch for the hidden ones: <code>list.Contains(x)</code>,
      <code>list.Any(...)</code>, <code>list.First(...)</code>, and <code>list.Where(...)</code>
      inside a loop are all a second loop written to look like one line.</li>
      <li><strong>Fix by hoisting the inner scan into a <code>Dictionary</code> or
      <code>HashSet</code> built once</strong> before the outer loop.</li>
    </ol>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger runs a reconciliation job at 02:00 that matches the day's payments against open
    invoices. It was written when the company processed a few hundred invoices a day, with the
    nested loop shown above. It ran in a few milliseconds and nobody looked at it again for two
    years.</p>
    <p>The measured cost as the business grew, all from the same unchanged code:</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Invoices</th><th>Comparisons</th><th>Nested loop</th><th>Dictionary lookup</th></tr></thead>
        <tbody>
          <tr><td>1,000</td><td>1 million</td><td>5 ms</td><td>1 ms</td></tr>
          <tr><td>5,000</td><td>25 million</td><td>49 ms</td><td>0 ms</td></tr>
          <tr><td>10,000</td><td>100 million</td><td>219 ms</td><td>2 ms</td></tr>
          <tr><td>20,000</td><td>400 million</td><td>927 ms</td><td>1 ms</td></tr>
          <tr><td>40,000</td><td>1.6 billion</td><td>4,558 ms</td><td>9 ms</td></tr>
          <tr><td>80,000</td><td>6.4 billion</td><td><strong>20,275 ms</strong></td><td><strong>23 ms</strong></td></tr>
        </tbody>
      </table>
    </div>
    <p>At 80,000 invoices the job takes <strong>20.3 seconds</strong> against the lookup
    version's <strong>23 milliseconds</strong> — about <strong>880 times slower</strong>, doing
    identical work and producing identical results.</p>
    <p>What made this expensive was not the twenty seconds. It was the shape of the growth. The
    job stayed comfortably under a second right up to about 20,000 invoices, so every capacity
    review said it was fine. Between 20,000 and 80,000 — a single year of ordinary growth — it
    went from 0.9 seconds to over 20, crossed the job runner's 15-second timeout, and started
    failing every night. The reconciliation gap was then found by an auditor rather than by
    monitoring, because a job that fails to start produces no slow-query alert.</p>
    <p>The fix was eleven lines: build a <code>Dictionary</code> before the loop and check it
    inside. No algorithm was invented. The lesson is not "use dictionaries" — it is that
    <strong>a nested loop over two collections that both grow with your business is a scheduled
    outage</strong>, and the schedule is set by your growth rate rather than by anything in the
    code.</p>
    <p>The cheap diagnostic, worth doing at review time rather than at 02:00: run it over n and
    2n rows. If the time roughly quadruples, it is quadratic.</p>
    <p>The absolute milliseconds above are from one machine and will not reproduce exactly on
    yours — a later run of the same benchmark gave 1,184 ms at 20,000 rather than 927. What does
    reproduce is the <em>shape</em>: roughly four times the work for twice the input, and a
    lookup column that barely moves. That is the part worth acting on.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>foreach</code> is slower than <code>for</code>, so use <code>for</code> in
    hot code."</strong></p>
    <p>For arrays and <code>List&lt;T&gt;</code> the JIT knows the enumerator's shape and the
    difference is usually nil — <code>List&lt;T&gt;</code>'s enumerator is a struct and is
    inlined away. Choose on meaning: <code>foreach</code> when you want each item,
    <code>for</code> when you genuinely need the index or are mutating by position. The real
    performance question in a loop is almost never <code>for</code> versus
    <code>foreach</code>; it is whether there is a second loop hiding inside the first.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"An <code>if</code> is free."</strong></p>
    <p>A predictable one is close to it. An unpredictable one in a tight loop cost
    <strong>4.7x to 7.5x</strong> in the measurement above. The cost is not the comparison, it is the
    processor guessing wrong and discarding work it had already started. This only matters
    inside loops running millions of times — in a method that handles one request, an
    <code>if</code> genuinely is free.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"C# falls through <code>switch</code> cases like C, so I need
    <code>break</code>."</strong></p>
    <p>You need <code>break</code> because the compiler requires each non-empty case to end
    explicitly (CS0163) — not because omitting it would fall through. C# removed the fall-through
    behaviour and kept the keyword. Stacked empty labels are the only permitted grouping, and
    <code>goto case</code> exists for the rare deliberate jump.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A <code>switch</code> without a <code>default</code> is fine if I have covered
    the cases I know about."</strong></p>
    <p>The cases you know about today. A <code>switch</code> statement with no match does nothing
    at all and reports nothing, which is how <code>disputed</code> payments went unprocessed for
    six weeks. Either use a switch <em>expression</em>, which throws on an unmatched value and
    warns at compile time (CS8509), or write a <code>default</code> that throws.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>Deep nesting instead of early returns.</strong></p>
    <p>Four levels of <code>if</code> puts the code that matters at the far right of the screen
    and separates each condition from its consequence. Invert the check and return. The
    occasional objection that a method should have "one exit point" comes from 1970s languages
    with manual resource cleanup; in C#, <code>using</code> and <code>finally</code> handle that,
    and multiple returns are the clearer choice.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>A <code>while (true)</code> loop with the exit buried in the body.</strong></p>
    <p>Sometimes unavoidable — a background service processing a queue is naturally written that
    way. But when a plain condition would express the intent, use one: a reader can see the exit
    condition in the header instead of hunting for a <code>break</code>. When you do write
    <code>while (true)</code>, put the cancellation check on the first line so the way out is the
    first thing anyone sees.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing a construct, in practice</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Situation</th><th>Use</th><th>Because</th></tr></thead>
      <tbody>
        <tr><td>Two or three outcomes on different conditions</td><td><code>if</code> / <code>else</code></td><td>Reads as prose; a switch on unrelated conditions does not.</td></tr>
        <tr><td>Rejecting invalid input at the top of a method</td><td>Guard clauses</td><td>Keeps the success path at the lowest indentation.</td></tr>
        <tr><td>Many outcomes on one value</td><td><code>switch</code> expression</td><td>Exhaustiveness is checked; unmatched values throw rather than vanish.</td></tr>
        <tr><td>Many outcomes, each doing several statements</td><td><code>switch</code> statement with a throwing <code>default</code></td><td>Expression bodies must produce a value; statements can act.</td></tr>
        <tr><td>Producing one value from a condition</td><td><code>?:</code></td><td>An expression fits where a statement cannot.</td></tr>
        <tr><td>Every item in a collection</td><td><code>foreach</code></td><td>No index arithmetic, so no off-by-one.</td></tr>
        <tr><td>You need the index, or you are mutating by position</td><td><code>for</code></td><td>The index is the point.</td></tr>
        <tr><td>Repeating until a condition changes</td><td><code>while</code></td><td>The count is not known in advance. Bound it.</td></tr>
        <tr><td>The body must run at least once</td><td><code>do</code> / <code>while</code></td><td>The test happens after the first pass.</td></tr>
        <tr><td>Removing items from a list</td><td><code>RemoveAll</code></td><td>One line, cannot be got wrong, no enumerator to invalidate.</td></tr>
        <tr><td>Looking something up inside a loop</td><td>A <code>Dictionary</code> built before it</td><td>Turns quadratic into linear.</td></tr>
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
    <p>Predict the exact output of each fragment, then explain the rule that produced it.</p>
<pre data-lang="csharp" data-net="10"><code>// (a)
for (int i = 0; i &lt; 3; i++)
{
    if (i == 1) { continue; }
    Console.WriteLine(i);
}

// (b)
for (int i = 0; i &lt; 3; i++)
{
    if (i == 1) { break; }
    Console.WriteLine(i);
}

// (c)
int n = 5;
do { Console.WriteLine("ran"); } while (n &lt; 0);

// (d)
string status = "disputed";
switch (status)
{
    case "pending": Console.WriteLine("pending"); break;
    case "captured": Console.WriteLine("captured"); break;
}
Console.WriteLine("after switch");</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>(a) prints <code>0</code> then <code>2</code>.</strong>
        <code>continue</code> skips the rest of the body for <code>i == 1</code> only. The
        <code>i++</code> is in the <code>for</code> header, so the loop still advances and
        iteration 2 runs normally.</p>

        <p><strong>(b) prints <code>0</code>.</strong> <code>break</code> abandons the entire
        loop at <code>i == 1</code>, so iteration 2 never happens. This is the difference worth
        holding on to: <code>continue</code> skips one iteration, <code>break</code> ends the
        loop.</p>

        <p><strong>(c) prints <code>ran</code> once.</strong> A <code>do</code>/<code>while</code>
        tests <em>after</em> the body, so the body always runs at least once even though
        <code>5 &lt; 0</code> is false. Written as a plain <code>while</code> it would print
        nothing.</p>

        <p><strong>(d) prints only <code>after switch</code>.</strong> No case matches
        <code>"disputed"</code>, there is no <code>default</code>, so the entire switch does
        nothing and execution continues after it. <strong>No exception, no warning, no log
        line.</strong> This is the failure mode that cost six weeks in the opening scenario, and
        it looks like working code in review.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This method is called once per web request. It contains four distinct control-flow
    problems from this module. Find them all, say what each one causes, and rewrite it.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public decimal TotalOutstanding(List&lt;Invoice&gt; invoices, List&lt;Payment&gt; payments)
{
    decimal total = 0m;
    int i = 0;

    while (i &lt; invoices.Count)
    {
        Invoice invoice = invoices[i];

        if (invoice.IsCancelled)
        {
            invoices.Remove(invoice);
            continue;
        }

        bool paid = false;
        foreach (Payment payment in payments)
        {
            if (payment.Reference == invoice.Reference &amp; payment.Amount &gt;= invoice.Amount)
            {
                paid = true;
            }
        }

        if (!paid)
        {
            total += invoice.Amount;
        }

        i++;
    }

    return total;
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>1. <code>continue</code> skips <code>i++</code> — an infinite loop.</strong>
        When an invoice is cancelled, <code>continue</code> jumps back to the condition without
        advancing <code>i</code>. It does not hang immediately, because <code>Remove</code>
        shrinks the list so a different invoice occupies index <code>i</code> next time. But if
        two cancelled invoices ever sit such that the list stops shrinking at that index — or the
        last item is cancelled — the loop spins for ever at 100% CPU with no error.</p>

        <p><strong>2. Mutating the caller's list.</strong> <code>invoices.Remove(...)</code>
        modifies the list the caller passed in. A method named <code>TotalOutstanding</code> is
        expected to compute a total, not to delete the caller's data. This is a bug in every
        caller that uses the list afterwards, and it is invisible from the method's name and
        signature.</p>

        <p><strong>3. <code>&amp;</code> instead of <code>&amp;&amp;</code>.</strong> Both sides
        are always evaluated. Here it does not throw, but it does unnecessary work on every
        comparison — and the moment either side becomes a null-check or a method call, it
        becomes a crash. There is no reason to use <code>&amp;</code> on booleans.</p>

        <p><strong>4. A nested loop over two growing collections — quadratic.</strong> Every
        invoice scans every payment. With 20,000 of each, that is 400 million comparisons per
        web request. Measured earlier in this module at 927 ms; at 80,000 it is over 20 seconds.
        The inner loop also fails to <code>break</code> once <code>paid</code> is true, so it
        keeps scanning after the answer is known.</p>

        <p>The rewrite fixes all four, and does not touch the caller's data:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>public decimal TotalOutstanding(
    IReadOnlyList&lt;Invoice&gt; invoices,
    IReadOnlyList&lt;Payment&gt; payments)
{
    ArgumentNullException.ThrowIfNull(invoices);
    ArgumentNullException.ThrowIfNull(payments);

    // Build the lookup once: reference -&gt; the largest payment seen for it.
    Dictionary&lt;string, decimal&gt; paidByReference =
        new Dictionary&lt;string, decimal&gt;(payments.Count, StringComparer.Ordinal);

    foreach (Payment payment in payments)
    {
        if (paidByReference.TryGetValue(payment.Reference, out decimal existing))
        {
            if (payment.Amount &gt; existing)
            {
                paidByReference[payment.Reference] = payment.Amount;
            }
        }
        else
        {
            paidByReference[payment.Reference] = payment.Amount;
        }
    }

    decimal total = 0m;

    foreach (Invoice invoice in invoices)
    {
        if (invoice.IsCancelled)
        {
            continue;   // safe: foreach advances on its own
        }

        bool paid = paidByReference.TryGetValue(invoice.Reference, out decimal amountPaid)
            &amp;&amp; amountPaid &gt;= invoice.Amount;

        if (!paid)
        {
            total += invoice.Amount;
        }
    }

    return total;
}</code></pre>
        <p>What changed and why:</p>
        <ul>
          <li><code>IReadOnlyList</code> in the signature makes "I will not modify your data" a
          compile-time promise rather than a convention.</li>
          <li><code>foreach</code> instead of the manual index removes the infinite-loop risk
          entirely — advancing is structural.</li>
          <li>Cancelled invoices are skipped rather than deleted, which was the actual
          requirement.</li>
          <li>The nested loop becomes one dictionary build plus one lookup per invoice: linear
          instead of quadratic.</li>
          <li><code>&amp;&amp;</code> short-circuits, so <code>amountPaid</code> is only compared
          when the lookup succeeded.</li>
        </ul>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A colleague reports that a report endpoint "got slow" after a customer onboarded. It
    returns in 80 ms for most customers and 40 seconds for one. The code has not changed.
    Describe how you would confirm the cause is quadratic control flow <em>without</em> a
    profiler, and what you would look for in the code.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Step 1 — get the two data sizes.</strong> The first question is not about the
        code, it is how much data the slow customer has compared with a fast one. If the fast
        customers have ~2,000 rows and the slow one has ~45,000, that is a 22x difference in
        input against a 500x difference in time. Linear code cannot do that; quadratic code
        can, and 22² ≈ 500 matches almost exactly.</p>

        <p><strong>Step 2 — confirm the shape with two measurements.</strong> Run the operation
        over n rows and 2n rows and compare:</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time at 2n vs n</th><th>Shape</th><th>Verdict</th></tr></thead>
            <tbody>
              <tr><td>~2x</td><td>Linear</td><td>Not this. Look at I/O, or per-row work.</td></tr>
              <tr><td>~4x</td><td>Quadratic</td><td>Confirmed. Find the nested loop.</td></tr>
              <tr><td>~1x</td><td>Constant</td><td>The time is somewhere else entirely.</td></tr>
            </tbody>
          </table>
        </div>
        <p>This needs no tooling — a <code>Stopwatch</code> and two runs. It is also a check you
        can put in a test so the regression cannot come back.</p>

        <p><strong>Step 3 — find the nesting, including the hidden kind.</strong> An explicit
        loop inside a loop is visible at a glance. These are the ones that hide, because each looks like
        a single operation:</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>foreach (Invoice invoice in invoices)
{
    // Each of these scans the whole collection, every time round.
    if (payments.Any(p =&gt; p.Reference == invoice.Reference)) { }
    Payment? match = payments.FirstOrDefault(p =&gt; p.Reference == invoice.Reference);
    if (references.Contains(invoice.Reference)) { }        // List.Contains is a scan
    decimal sum = payments.Where(p =&gt; p.Reference == invoice.Reference).Sum(p =&gt; p.Amount);
}</code></pre>
        <p><code>List&lt;T&gt;.Contains</code>, <code>Any</code>, <code>First</code>,
        <code>Where</code>, and <code>Sum</code> over a list are all loops. Written inside another
        loop they are quadratic while looking like one line each.</p>
        <p>Note that <code>HashSet&lt;T&gt;.Contains</code> is <em>not</em> a scan — it is
        near-constant. Swapping a <code>List</code> for a <code>HashSet</code> can be the whole
        fix, without changing a line of the loop.</p>

        <p><strong>Step 4 — check the database too.</strong> The same shape appears as a query
        inside a loop, where each iteration is a round trip. That is the N+1 problem, and it is
        quadratic in wall-clock terms for the same reason. If the endpoint touches a database,
        count the queries before assuming the loop is in C#.</p>

        <p><strong>Step 5 — fix and prove it.</strong> Hoist the repeated scan into a
        <code>Dictionary</code> or <code>HashSet</code> built once, then re-run the n / 2n
        measurement. It should now roughly double rather than quadruple.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Write <code>FindFirstGap</code>, which takes invoice sequence numbers that should run
    consecutively from a known start and returns the first missing number, or <code>null</code>
    if none are missing. The input may contain duplicates and may be unordered, and may hold
    hundreds of thousands of entries.</p>
    <p>Then explain why the obvious implementation is quadratic, and what the sorting-based
    alternative costs by comparison.</p>
<pre data-lang="csharp" data-net="10"><code>// FindFirstGap(new[] { 3, 1, 2, 5, 4, 7 }, start: 1)  -&gt; 6
// FindFirstGap(new[] { 1, 2, 3 },          start: 1)  -&gt; null
// FindFirstGap(new[] { 2, 2, 3 },          start: 1)  -&gt; 1
public static int? FindFirstGap(IReadOnlyCollection&lt;int&gt; sequenceNumbers, int start)
{
    throw new NotImplementedException();
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The obvious version, and why it fails.</strong> Count upwards from
        <code>start</code> and, for each candidate, scan the collection to see whether it is
        present:</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>for (int candidate = start; ; candidate++)
{
    bool found = false;
    foreach (int number in sequenceNumbers)   // scans everything, every time
    {
        if (number == candidate) { found = true; break; }
    }
    if (!found) { return candidate; }
}</code></pre>
        <p>With no gap in 200,000 entries, the outer loop runs 200,000 times and each pass scans
        an average of half the collection — around <strong>20 billion comparisons</strong>. The
        rate measured earlier in this module was 400 million comparisons in 927 ms, or about
        431 million per second, so this takes roughly <strong>46 seconds</strong> where the
        corrected version takes milliseconds.</p>
        <p>It has a second, worse defect: the <code>for</code> has no upper bound, so if the
        collection is empty — or contains nothing at or above <code>start</code> — it counts
        upwards for ever. A quadratic method is slow; an unbounded one never returns at all.</p>

        <p><strong>The fix: make the membership test constant-time.</strong></p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>public static int? FindFirstGap(IReadOnlyCollection&lt;int&gt; sequenceNumbers, int start)
{
    ArgumentNullException.ThrowIfNull(sequenceNumbers);

    if (sequenceNumbers.Count == 0)
    {
        return start;
    }

    // One pass to build the set, and it de-duplicates for free.
    HashSet&lt;int&gt; present = new HashSet&lt;int&gt;(sequenceNumbers.Count);
    int highest = int.MinValue;

    foreach (int number in sequenceNumbers)
    {
        if (number &gt;= start)
        {
            present.Add(number);
            if (number &gt; highest)
            {
                highest = number;
            }
        }
    }

    // Everything was below start, so the very first expected number is missing.
    if (highest == int.MinValue)
    {
        return start;
    }

    // Bounded by the highest value seen, so this always terminates.
    for (int candidate = start; candidate &lt;= highest; candidate++)
    {
        if (!present.Contains(candidate))
        {
            return candidate;
        }
    }

    return null;   // start..highest are all present, so there is no gap
}</code></pre>

        <p><strong>Cost.</strong> One pass to build the set, then at most
        <code>highest - start + 1</code> lookups, each near-constant. That is linear in the input
        rather than quadratic — the 13 hours becomes a few milliseconds.</p>

        <p><strong>The sorting alternative, and when to prefer it.</strong> Sorting a copy and
        walking it also works:</p>
<pre data-lang="csharp" data-net="10" data-title="The alternative"><code>int[] sorted = sequenceNumbers.Where(n =&gt; n &gt;= start).ToArray();
Array.Sort(sorted);

int expected = start;
foreach (int number in sorted)
{
    if (number &gt; expected) { return expected; }   // the gap
    if (number == expected) { expected++; }        // duplicates are skipped
}
return null;</code></pre>
        <p>Sorting costs O(n log n) against the hash set's O(n), so it is asymptotically worse
        — but it allocates one array rather than a hash set with its buckets, has far better
        memory locality, and does not depend on hash quality. For a few thousand items it is
        often faster in wall-clock terms despite the worse complexity class.</p>
        <p><strong>Which to choose:</strong> the hash set when the range between
        <code>start</code> and <code>highest</code> is large relative to the number of items, or
        when you need the set afterwards. Sorting when the data is nearly sorted already, when
        memory matters, or when you also want the values in order. Both are linear <em>enough</em>
        that either is a correct answer; the quadratic version is the only wrong one.</p>

        <p><strong>The edge cases the tests should cover,</strong> each of which the naive version
        gets wrong or hangs on: an empty collection, all values below <code>start</code>,
        duplicates, unordered input, and no gap at all. Note that the fixed version returns
        <code>start</code> for the first two — an empty run of invoices means the first expected
        number is the one that is missing.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is the difference between <code>break</code> and <code>continue</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>break</code> leaves the loop entirely; no further iterations happen.
        <code>continue</code> abandons the rest of the current iteration and moves to the next
        one, so the loop carries on.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>continue</code> in a <code>while</code> loop more dangerous than in a
      <code>for</code> loop?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>In a <code>while</code> loop the statement that advances the counter is inside the
        body, so <code>continue</code> skips it and the condition never changes — an infinite
        loop at 100% CPU with no exception. In a <code>for</code> loop the increment is in the
        header and always runs. If a loop body uses <code>continue</code>, prefer
        <code>for</code> or <code>foreach</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What happens when a <code>switch</code> statement matches no case and has no
      <code>default</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Nothing at all — execution continues after the switch, silently. No exception, no
        warning. A switch <em>expression</em> instead warns at compile time (CS8509) and throws
        <code>SwitchExpressionException</code> at run time, which is why it is the safer default
        when producing a value.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>x is not null &amp;&amp; x.Name == "a"</code> work while
      <code>x is not null &amp; x.Name == "a"</code> throws?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>&amp;&amp;</code> short-circuits: if the left side is false the right side is
        never evaluated, so the null is never dereferenced. <code>&amp;</code> always evaluates
        both sides, so <code>x.Name</code> runs even when <code>x</code> is null, throwing
        <code>NullReferenceException</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Two arrays of the same values, one sorted and one shuffled, summed with the same
      <code>if</code> in a loop. Why is the sorted one several times faster?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Branch prediction. The processor guesses which way each branch will go and
        speculatively executes that path. On sorted data the branch goes the same way many times
        in a row and the guess is nearly always right; on shuffled data it is close to a coin
        flip, and each wrong guess discards work and refills the pipeline — measured here at
        <strong>4.7x to 7.5x</strong> across three runs.</p>
      </div></details>
    </li>
    <li>
      <p>How do you tell whether slow code is quadratic, without a profiler?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Time it over n items and again over 2n. Roughly double is linear; roughly
        <strong>four times</strong> is quadratic. Then look for a loop inside a loop — including
        the disguised kind, where <code>List.Contains</code>, <code>Any</code>,
        <code>First</code>, or <code>Where</code> inside a loop is a second scan written as one
        line.</p>
      </div></details>
    </li>
    <li>
      <p>Can you remove items from a collection while <code>foreach</code>-ing over it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It depends on the collection, which is why the safe answer is "do not".
        <code>List&lt;T&gt;.Remove</code> throws <code>InvalidOperationException</code>;
        <code>Dictionary.Remove</code> and <code>HashSet.Remove</code> have been permitted since
        .NET Core 3.0; <code>Dictionary.Add</code> still throws. Use <code>RemoveAll</code>, a
        backwards indexed loop, or build a new collection, and the distinction never
        matters.</p>
      </div></details>
    </li>
  </ol>

  <div class="callout callout--note">
    <h4>Where this leads</h4>
    <p><a href="#/m/t1-05-methods-and-parameters">Methods, Arguments, and Parameters</a> covers
    the other way execution moves around a program.
    <a href="#/m/t1-27-pattern-matching">Pattern Matching</a> takes <code>switch</code> far
    beyond matching constants, into types, properties, and shapes.
    <a href="#/m/t1-25-deferred-execution">Deferred Execution and the Cost of LINQ</a> explains
    why <code>Where</code> and <code>Any</code> inside a loop cost what they do, and
    <a href="#/m/t6-01-complexity-from-scratch">Complexity Analysis From Scratch</a> turns the
    n / 2n test used here into something you can derive rather than measure.</p>
  </div>
</section>

`
});
