CSPREP.module({
  id: "t2-24-benchmarkdotnet",
  minutes: 55,
  updated: "2026-09-02",
  summary: "Identical, fully warmed-up work measured twenty times had a standard deviation of 16% of its mean - so any difference smaller than that is not a result. A cold measurement was 16.6x the steady state, and discarding the result made a loop report under half the real cost. Ledger shipped a lookup change on a benchmark that was measured correctly and answered the wrong question: the array scan genuinely beat the Dictionary at 4 entries, and the shared helper it replaced was also called with 4,000. Allocation is the column to argue from, because it is identical on every run.",
  terms: ["benchmark", "microbenchmark", "warmup", "tiered compilation", "dead code elimination",
    "pilot", "sample", "median", "standard deviation", "error margin", "noise floor",
    "outlier", "branch prediction", "crossover point", "Amdahl's law", "allocation budget",
    "regression test", "profile", "hypothesis", "threshold"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A developer at Ledger benchmarked the currency-code lookup. Four currencies, a
  <code>Dictionary</code> against a plain array scan. The scan won, so they replaced the
  <code>Dictionary</code> in the shared lookup helper and shipped it.</p>

  <p>The benchmark was correct. It was warmed up, sampled repeatedly, the median was reported and the
  result was consumed. Re-run it today and you get the same answer:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   4 currencies, looking up the last one

     Dictionary  :    24.6 ns
     array scan  :    19.3 ns
     scan is     :    1.27x the dictionary</code></pre>

  <p>The same helper was also used for the per-tenant fee schedule, which by then held 4,000 codes:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>      entries   Dictionary    array scan   winner
      -------   ----------    ----------   ------
            4       13.5 ns         22.9 ns   Dictionary
           64       13.2 ns        401.1 ns   Dictionary
        4,000       14.3 ns      23407.6 ns   Dictionary</code></pre>

  <p>The change added <strong>90 microseconds per request</strong> and about half a core of the fleet
  doing nothing but comparing strings. p99 rose. It was not the first place anyone looked, because the
  change had a benchmark attached showing it was faster.</p>

  <p>This module is about two separate failures that both produce a number on a screen. The first is
  measuring <em>badly</em> — the benchmark reports something that is not the speed of your code. The
  second is measuring <em>the wrong thing</em> — the number is correct and answers a question nobody
  asked. The second is harder, because there is nothing wrong with the measurement.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>This project runs from a folder with no package manager, so the harness in this module is
    written out by hand rather than using <strong>BenchmarkDotNet</strong>. That is deliberate:
    every defence in it exists because of a specific way a naive benchmark lies, and seeing them
    written down is how you learn to read a real harness's output.</p>
    <p>Use BenchmarkDotNet for real work. The section below shows what it looks like and what it does
    that a hand-rolled harness does not.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What a benchmark is measuring</h2>

  <p class="define"><span class="define__term">Benchmark</span> A repeatable measurement comparing two
  or more implementations of the same operation. It answers "which of these is faster", and nothing
  else.</p>

  <p class="define"><span class="define__term">Profile</span> A recording of where time actually goes
  in a running system. It answers "what should I look at", which is a different question and the one
  that comes first.</p>

  <p class="define"><span class="define__term">Noise floor</span> How much a measurement varies when
  nothing has changed. Any difference smaller than this cannot be detected, no matter how carefully you
  measure.</p>

  <p class="define"><span class="define__term">Warmup</span> Running the code before timing it, so that
  the JIT has produced its optimised version and caches are populated.</p>

  <p class="define"><span class="define__term">Tiered compilation</span> .NET compiles a method twice:
  tier 0 quickly and barely optimised, then tier 1 after roughly thirty calls. Tier 1 is what runs in
  production. A benchmark with no warmup measures tier 0 plus the cost of compiling.</p>

  <p class="define"><span class="define__term">Dead code elimination</span> The compiler
  removing work whose result nothing observes. It is correct, it is desirable in real code, and it is
  how a benchmark reports a speed the code cannot achieve.</p>

  <p class="define"><span class="define__term">Pilot</span> A preliminary run that decides how many
  iterations each measurement needs. Without one, a twenty-nanosecond operation timed once measures the
  resolution of the clock rather than the operation.</p>

  <p class="define"><span class="define__term">Error margin</span> The range within which the true
  mean probably lies, given how much the samples varied. Two results whose margins overlap are not
  distinguishable, however different their means look.</p>

  <p class="define"><span class="define__term">Crossover point</span> The input size at which one
  implementation overtakes another. It is usually the only interesting number in a comparison, and a
  benchmark run at a single size cannot find it.</p>

  <p><strong>An analogy, and its limits.</strong> A benchmark is a stopwatch at a running track. It
  tells you which athlete is faster over 100 metres, accurately and repeatably. What it cannot tell you
  is whether your team loses because the runners are slow — that might be the relay handovers, or the
  fact that the race is 10,000 metres.</p>

  <p><strong>Where the analogy breaks:</strong> a stopwatch does not change what it measures. A
  benchmark does. Timing code alters how the JIT compiles it, whether the result is used, what is in
  cache, and when the collector runs — so a badly built benchmark measures an activity that does not
  exist outside the benchmark.</p>

  <h3>The number that governs everything else</h3>

  <pre data-lang="console" data-title="01-why-timing-lies.cs"><code>3. The same work, measured twenty times

   min    :   16.17 ms
   median :   18.01 ms
   mean   :   19.54 ms
   max    :   26.41 ms
   stddev :    3.18 ms  (16.3% of the mean)
   spread :    1.63x between fastest and slowest</code></pre>

  <p>Identical work, fully warmed up, on an idle machine. The slowest sample took 1.63x the fastest,
  and the standard deviation was <strong>16% of the mean</strong>.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>That single figure decides which conclusions are available to you. A 10% improvement measured
    against a 16% noise floor is not a result — it is a sample. You would get the same "improvement"
    by running the original code twice and picking the faster run.</p>
    <p>It is also why every performance claim in this track is stated as a ratio against a stated
    baseline or as an exact count, and why the modules quote allocation figures in preference to
    milliseconds. Allocation is identical on every run; time is not.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="06-minimal-example.cs"><code>// 06-minimal-example.cs — The same code measured three ways, giving three
// different answers. Two of them are wrong.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

using System.Diagnostics;
using System.Runtime.CompilerServices;

const string Line = "INV-2026-0004821,GBP,123450";

Console.WriteLine("Measuring the same method three ways:");
Console.WriteLine();

// 1. WRONG: cold, and the result is discarded.
var cold = Stopwatch.StartNew();
for (int i = 0; i &lt; 1_000; i++)
{
    Parse(Line);
}

cold.Stop();
Console.WriteLine($"  cold, result discarded : {cold.Elapsed.TotalMilliseconds * 1_000_000 / 1_000,7:F1} ns per call");

// 2. WRONG: warmed up, but the result is still discarded.
for (int i = 0; i &lt; 200_000; i++)
{
    Parse(Line);
}

var warm = Stopwatch.StartNew();
for (int i = 0; i &lt; 1_000; i++)
{
    Parse(Line);
}

warm.Stop();
Console.WriteLine($"  warm, result discarded : {warm.Elapsed.TotalMilliseconds * 1_000_000 / 1_000,7:F1} ns per call");

// 3. RIGHT: warmed up, result consumed, many samples, median reported.
long sink = 0;
var samples = new double[11];
for (int s = 0; s &lt; samples.Length; s++)
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    var sw = Stopwatch.StartNew();
    for (int i = 0; i &lt; 100_000; i++)
    {
        sink += Parse(Line);
    }

    sw.Stop();
    samples[s] = sw.Elapsed.TotalMilliseconds * 1_000_000 / 100_000;
}

Array.Sort(samples);
Console.WriteLine($"  warm, consumed, median : {samples[samples.Length / 2],7:F1} ns per call");
Console.WriteLine($"                   range : {samples[0],7:F1} to {samples[^1]:F1} ns");

// And the number that does not move at all.
GC.Collect();
GC.WaitForPendingFinalizers();
GC.Collect();
long before = GC.GetTotalAllocatedBytes(precise: true);
for (int i = 0; i &lt; 100_000; i++)
{
    sink += Parse(Line);
}

long perOp = (GC.GetTotalAllocatedBytes(precise: true) - before) / 100_000;

Console.WriteLine();
Console.WriteLine($"  allocation per call    : {perOp} bytes, on every run, on every machine");
Console.WriteLine($"  (sink {sink})");
Console.WriteLine();
Console.WriteLine("The first number is wrong by more than an order of magnitude: it");
Console.WriteLine("measures tier 0 code plus the JIT compiling the method.");
Console.WriteLine();
Console.WriteLine("The second is close to the third, which is worth understanding rather");
Console.WriteLine("than assuming. Discarding the result did NOT let the JIT delete the");
Console.WriteLine("work here, because Split allocates an array - an observable side effect");
Console.WriteLine("the compiler cannot remove.");
Console.WriteLine();
Console.WriteLine("Dead-code elimination bites on PURE, allocation-free code. On a method");
Console.WriteLine("that allocates you get away with it, and on a method that does");
Console.WriteLine("arithmetic you do not - which is exactly the kind of code people");
Console.WriteLine("microbenchmark. Consume the result anyway; it costs nothing.");
Console.WriteLine();
Console.WriteLine("The third is defensible, and it still moves between runs - which is why");
Console.WriteLine("the range matters as much as the median.");
Console.WriteLine();
Console.WriteLine("The allocation figure is exact and identical every time. When the two");
Console.WriteLine("disagree about whether a change is worth making, that is the column to");
Console.WriteLine("argue from and the one to assert on in a test.");

[MethodImpl(MethodImplOptions.NoInlining)]
static long Parse(string line)
{
    string[] fields = line.Split(',');
    return long.Parse(fields[2], System.Globalization.CultureInfo.InvariantCulture);
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Measuring the same method three ways:

  cold, result discarded :  2279.2 ns per call
  warm, result discarded :   137.0 ns per call
  warm, consumed, median :   146.4 ns per call
                   range :   137.0 to 318.8 ns

  allocation per call    : 176 bytes, on every run, on every machine</code></pre>

  <p>The cold measurement is <strong>16.6x</strong> the steady state. It is not measuring your code; it
  is measuring tier 0 plus the JIT compiling the method.</p>

  <p>The second and third are close, and that is worth understanding rather than assuming. Discarding
  the result did not let the JIT delete the work here, because <code>Split</code> allocates an array —
  an observable side effect the compiler cannot remove.</p>

  <p><strong>Dead-code elimination bites on pure, allocation-free code</strong>, which is exactly the
  kind of code people microbenchmark. Consume the result anyway; it costs nothing.</p>

  <p>And note the last line. The time moved between runs. The allocation did not.</p>
</section>

<section id="how-timing-lies">
  <h2>Five ways a Stopwatch loop lies</h2>

  <h3>1. The work never happens</h3>

  <pre data-lang="console" data-title="01-why-timing-lies.cs"><code>   100,000,000 calls
     result discarded :     70.8 ms   (  0.71 ns per call)
     result consumed  :    182.1 ms   (  1.82 ns per call)</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Reports a speed the code cannot achieve"><code>for (int i = 0; i &lt; iterations; i++)
{
    // Nothing observes the result, so the JIT may delete the multiply,
    // the shift and the exclusive-or, leaving the loop counter.
    Compute(i);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Consume the result"><code>long sink = 0;
for (int i = 0; i &lt; iterations; i++)
{
    sink += Compute(i);
}

// Printed, so the accumulation itself cannot be removed.
Console.WriteLine(sink);</code></pre>

  <p>Note the discarded loop was not zero — the loop still ran. It reported well under half the real
  cost, which is enough to make a comparison meaningless.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Treat any per-operation figure below about a nanosecond as a claim that the work was optimised
    away, until you have proved otherwise. A modern CPU does a few operations per nanosecond; a method
    call that does real work cannot be faster than that.</p>
  </div>

  <h3>2. The first iterations run different machine code</h3>

  <pre data-lang="console" data-title="01-why-timing-lies.cs"><code>   round  0        2.60 ms      tier 0, cold
   round  1        1.97 ms      tier 0
   round  5        1.76 ms      tier 0
   after 200k      0.57 ms      tier 1, optimised

   first round vs steady state:   4.5x</code></pre>

  <h3>3. Run-to-run variance</h3>

  <p>Covered above: 16% of the mean, 1.63x between fastest and slowest, on identical work. <strong>This
  is the number to establish before any other measurement.</strong></p>

  <h3>4 and 5. Two effects that were looked for and not found</h3>

  <pre data-lang="console" data-title="01-why-timing-lies.cs"><code>   order    measured first   measured second
   -----    --------------   ---------------
   A, B           25.23 ms           24.00 ms
   B, A           23.24 ms           23.07 ms</code></pre>

  <pre data-lang="console" data-title="01-why-timing-lies.cs"><code>   A (allocating)                  :   20.45 ms
   B, straight after A             :    0.37 ms
   B, after a forced collection    :    0.37 ms</code></pre>

  <p>The expectation writing these was a first-mover penalty from cold caches, and a GC bill from A
  landing inside B. <strong>Neither is visible.</strong></p>

  <p>That is a real result and the more useful one. Any such effect here is smaller than the 16% noise
  floor, so this experiment cannot detect it — and neither can any benchmark you write.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The lesson is not "ordering does not matter". It is that <strong>you must know your noise floor
    before claiming any effect</strong>, because an effect smaller than the noise is indistinguishable
    from nothing.</p>
    <p>A serious harness defends against both anyway — by running each benchmark in its own process,
    and collecting between samples — which costs nothing if the effect is absent and saves you if it
    is not.</p>
    <p>For the GC case specifically the reason is identifiable: A's arrays die immediately, so its
    collections happen during A. Cross-benchmark interference needs garbage that <em>survives</em>,
    which is a different workload.</p>
  </div>
</section>

<section id="the-harness">
  <h2>What a harness has to do</h2>

  <pre data-lang="csharp" data-net="10" data-title="02-a-harness.cs"><code>    public static Result Run(string name, Func&lt;long&gt; body)
    {
        // 1. WARMUP. Gets the method to tier 1 before anything is timed.
        for (int i = 0; i &lt; WarmupIterations; i++)
        {
            _sink += body();
        }

        // 2. PILOT. Find how many iterations take roughly TargetSampleMs, so
        //    every benchmark is measured over a comparable duration rather
        //    than a comparable iteration count.
        int iterations = Pilot(body);

        // 3. MEASURE ALLOCATION separately from time. Allocation is exact and
        //    deterministic; mixing it into the timed loop adds noise to both.
        Collect();
        long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i &lt; iterations; i++)
        {
            _sink += body();
        }

        long bytesPerOp = (GC.GetTotalAllocatedBytes(precise: true) - allocBefore) / iterations;

        // 4. SAMPLE repeatedly, collecting between samples so one sample's
        //    garbage is not collected inside the next.
        var samples = new double[SampleCount];
        for (int s = 0; s &lt; SampleCount; s++)
        {
            Collect();

            var sw = Stopwatch.StartNew();
            for (int i = 0; i &lt; iterations; i++)
            {
                _sink += body();
            }

            sw.Stop();
            samples[s] = sw.Elapsed.TotalMilliseconds * 1_000_000 / iterations;
        }

        return Summarise(name, samples, bytesPerOp);
    }</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Step</th><th>Defends against</th></tr>
      </thead>
      <tbody>
        <tr><td>Warmup</td><td>Tiered compilation. Measured at 4.5x between the first round and steady state.</td></tr>
        <tr><td>Return and accumulate a value</td><td>Dead code elimination.</td></tr>
        <tr><td>Pilot for an iteration count</td><td>Clock resolution. A 20 ns operation timed once measures the clock.</td></tr>
        <tr><td>Many samples</td><td>Run-to-run variance, measured at 16% of the mean.</td></tr>
        <tr><td>Report median and error</td><td>A single slow sample dragging the mean.</td></tr>
        <tr><td>Collect between samples</td><td>One sample's garbage being collected inside the next.</td></tr>
        <tr><td>Measure allocation separately</td><td>Mixing a deterministic measurement into a noisy one.</td></tr>
      </tbody>
    </table>
  </div>

  <pre data-lang="console" data-title="02-a-harness.cs"><code>   method              mean         error      stddev        median   alloc/op
   ------              ----         -----      ------        ------   --------
   for loop            2377.8 ns  +/- 635.2 ns   1485.1 ns    1989.6 ns       0 B
   foreach             1844.6 ns  +/-  27.6 ns     64.6 ns    1849.8 ns       0 B
   LINQ Sum            3095.9 ns  +/-  63.0 ns    147.3 ns    3066.8 ns       0 B
   LINQ Where+Sum     45990.8 ns  +/- 568.2 ns   1328.5 ns   45718.8 ns      88 B

   Relative to for loop:

     foreach            0.78x   NOT DISTINGUISHABLE from the baseline
     LINQ Sum           1.30x   difference exceeds the combined error
     LINQ Where+Sum    19.34x   difference exceeds the combined error</code></pre>

  <p><strong>The "NOT DISTINGUISHABLE" line is the most valuable output a harness produces.</strong> A
  0.78x ratio looks like a 22% improvement. The error margins say the two results overlap, so the
  honest report is that this measurement cannot tell them apart.</p>

  <p>Note the <code>for loop</code> row: mean 2377.8 ns against a median of 1989.6 ns. One or two
  samples dominated the mean. That is what a median is for, and it is why a benchmark reporting only an
  average cannot be trusted.</p>

  <h3>What BenchmarkDotNet does that this does not</h3>

  <pre data-lang="csharp" data-net="10" data-title="Benchmarks.cs, with the package reference"><code>// &lt;PackageReference Include="BenchmarkDotNet" Version="0.14.0" /&gt;
using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Running;

[MemoryDiagnoser]                      // the alloc/op column
[SimpleJob(warmupCount: 3, iterationCount: 10)]
public class ParseBenchmarks
{
    private const string Line = "INV-2026-0004821,GBP,123450,2026-03-14";

    [Benchmark(Baseline = true)]
    public long Substring()
    {
        string[] fields = Line.Split(',');
        return long.Parse(fields[2], System.Globalization.CultureInfo.InvariantCulture);
    }

    [Benchmark]
    public long Span()
    {
        ReadOnlySpan&lt;char&gt; span = Line;
        int first = span.IndexOf(',');
        ReadOnlySpan&lt;char&gt; rest = span[(first + 1)..];
        int second = rest.IndexOf(',');
        ReadOnlySpan&lt;char&gt; amount = rest[(second + 1)..];
        int third = amount.IndexOf(',');

        if (third &gt;= 0)
        {
            amount = amount[..third];
        }

        return long.Parse(amount, System.Globalization.CultureInfo.InvariantCulture);
    }
}

public static class Program
{
    public static void Main(string[] args) =&gt;
        BenchmarkRunner.Run&lt;ParseBenchmarks&gt;(args: args);
}</code></pre>

  <ul>
    <li><strong>Runs each benchmark in its own process</strong>, which removes ordering effects and
    lets it compare several runtimes in one session.</li>
    <li><strong>Removes outliers statistically</strong> rather than by eye.</li>
    <li><strong>Disassembles the generated code</strong> (<code>[DisassemblyDiagnoser]</code>) so you
    can check what was actually measured — the direct answer to "was this optimised away".</li>
    <li><strong>Detects an unstable environment</strong> and warns that the result is untrustworthy
    rather than printing it anyway.</li>
    <li><strong>Returns the benchmark's value to a consumer it controls</strong>, so you do not have to
    remember to consume it.</li>
  </ul>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>BenchmarkDotNet refuses to run in a Debug build, and it is right to. Debug disables inlining and
    most optimisation, so a Debug benchmark measures a program that will never ship.</p>
    <p>A hand-rolled harness will happily run in Debug and print a confident, meaningless table — which
    is why the harness in this module prints its configuration first.</p>
  </div>
</section>

<section id="benchmarks-that-lie">
  <h2>Correct measurements of the wrong thing</h2>

  <p>Everything above was a measurement error. Everything here is measured perfectly and still gives
  the wrong answer, which is harder to spot because the number is real.</p>

  <h3>The right answer for a size you do not have</h3>

  <pre data-lang="console" data-title="03-benchmarks-that-lie.cs"><code>      size   linear scan   dictionary   winner
      ----   -----------   ----------   ------
         4        23.3 ns       34.3 ns   linear scan
         8        43.6 ns       16.1 ns   dictionary
        64       376.2 ns       15.8 ns   dictionary
     1,000      5715.2 ns       16.0 ns   dictionary
    50,000    315480.9 ns       16.7 ns   dictionary</code></pre>

  <p>Benchmark at 4 and the dictionary is pointless overhead. Benchmark at 50,000 and the scan is
  absurd. <strong>Both conclusions are correct about the size measured and wrong as general
  advice.</strong> The crossover is the only interesting number in the table.</p>

  <h3>The right size, the wrong data</h3>

  <pre data-lang="console" data-title="03-benchmarks-that-lie.cs"><code>      data            time      why
      ----            ----      ---
      sorted         56992 ns      branch predicts perfectly
      shuffled      543033 ns      branch mispredicts constantly
      all equal      38512 ns      branch always taken

   shuffled vs sorted:  9.5x</code></pre>

  <p>Same method, same array size, same number of comparisons. <strong>9.5x</strong>, decided entirely
  by whether the CPU can predict the branch.</p>

  <p>Test data is usually sorted, sequential or all the same, because that is what
  <code>Enumerable.Range</code> gives you. Production data is not, so a benchmark on generated data can
  be several times optimistic. The same problem appears as cache-friendly access patterns, strings that
  differ in the first character, dictionaries with no collisions, and inputs small enough to fit in
  L1.</p>

  <h3>The right measurement, the wrong unit</h3>

  <pre data-lang="console" data-title="03-benchmarks-that-lie.cs"><code>      version      time        alloc/op
      -------      ----        --------
      Substring      127 ns       232 B
      Span            40 ns         0 B</code></pre>

  <p>Both columns favour the span version, so this is not a case of the two disagreeing. It is a case
  of one being far more informative.</p>

  <p>The time ratio is a few times, measured on an idle machine, and it moves between runs. The
  allocation figure is <strong>232 bytes to zero and identical on every run, on every machine,
  forever</strong>. One of those is a fact you can put in a test; the other is an observation about
  this laptop.</p>

  <h3>A genuine speed-up that changes nothing</h3>

  <pre data-lang="console" data-title="03-benchmarks-that-lie.cs"><code>      parse, before        :      132 ns
      parse, after         :       42 ns
      microbenchmark says  :      3.2x faster

      whole request before :   8000.1 us  (8 ms of I/O plus the parse)
      whole request after  :   8000.0 us
      end to end           :    1.000x faster</code></pre>

  <p class="define"><span class="define__term">Amdahl's law</span> Improving a component by any factor
  cannot improve the whole by more than that component's share of the total. A 3.2x on 0.001% of a
  request is a 1.000x on the request.</p>

  <p><strong>A microbenchmark cannot tell you the share.</strong> It measures one thing in isolation
  and reports a ratio, and the ratio is meaningless without knowing what fraction of the system that
  thing is.</p>

  <p>Profile first to find where the time goes. Benchmark second to compare two ways of doing the part
  that matters. The other order produces a folder full of true and useless facts.</p>
</section>

<section id="production">
  <h2>The Ledger incident</h2>

  <p>The benchmark was sound. The inference was not.</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   per lookup, 4,000 entries :       14.2 ns -&gt;    22648.7 ns
   per request (4 lookups)   :        0.1 us -&gt;       90.6 us
   added per request         :       90.5 us

   at 5,000 requests/sec across the fleet:
     CPU-seconds added per second of wall clock :     0.45</code></pre>

  <p>Read that honestly. Against an 8 ms request, 91 microseconds is about 1.1% of the latency — real,
  and not on its own an outage.</p>

  <p>What makes it matter is the other column: roughly half a core of the fleet now does nothing but
  compare strings. That is pure waste, and a service near capacity has that headroom removed. p99 is
  where a service near capacity shows it first.</p>

  <p><strong>And it grows.</strong> The cost is linear in the number of fee codes, so the same change
  at 40,000 codes is ten times worse — arriving gradually as tenants are onboarded, with no deployment
  to blame.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>There is a second measurement in that file worth more than the incident. At <em>four</em>
    entries, the scan beat the dictionary for currency codes and <em>lost</em> for fee codes.</p>
    <p>Currency codes are three characters differing at the first. Fee codes are ten characters sharing
    a <code>FEE-</code> prefix, so every comparison reads five characters before it can fail.</p>
    <p><strong>The crossover is not a property of collection size alone.</strong> It moves with key
    length and with how early keys differ — one more thing a benchmark on invented data cannot tell
    you.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Three days were spent looking elsewhere, because the change had a benchmark attached showing it
    was faster. A number on a screen is very persuasive about a question it did not answer.</p>
    <p>What the benchmark got right: the scan genuinely is faster at four entries, and that result
    reproduces. The measurement was sound. The inference — that the same change helps everywhere the
    pattern appears — is what was wrong, and <strong>no amount of statistical rigour in the harness
    would have caught it.</strong></p>
  </div>

  <h3>The three questions to answer first</h3>

  <ol>
    <li><strong>What fraction of the system is this?</strong> A profile answers it; a benchmark cannot.</li>
    <li><strong>What size and shape is the real input?</strong> The winner reversed between 4 entries
    and 4,000, and reversed again when the keys changed shape.</li>
    <li><strong>Where else does this code run?</strong> A benchmark measures one call site; a change to
    a shared helper applies to all of them.</li>
  </ol>

  <p>And the discipline that would have caught it — <strong>write the hypothesis and the threshold down
  before measuring</strong>:</p>

  <pre data-lang="text"><code>"The currency lookup runs 4 times per request over 4 entries.
 If replacing the Dictionary saves more than 50 us per request
 I will ship it - to that call site."</code></pre>

  <p>Written that way, three things become visible before any code changes: the saving is nanoseconds
  and does not clear the threshold, the claim is scoped to one call site, and the question of what else
  uses the helper has to be answered.</p>

  <p>A threshold chosen before the measurement is the difference between an experiment and a search for
  a reason to do what you wanted.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Benchmarking in Debug</h3>

  <pre data-lang="bash" data-bad="true"><code>dotnet run</code></pre>

  <pre data-lang="bash"><code>dotnet run -c Release</code></pre>

  <p>Debug disables inlining and most optimisation. The numbers describe a program that will never
  ship. BenchmarkDotNet refuses to run in Debug; a hand-rolled harness will print a confident,
  meaningless table.</p>

  <h3>2. Asserting on time in CI</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Flakes, gets widened, stops catching anything"><code>[Fact]
public void ParseIsFastEnough()
{
    var sw = Stopwatch.StartNew();
    for (int i = 0; i &lt; 10_000; i++)
    {
        Parse(Line);
    }

    sw.Stop();

    // A shared build agent is not an idle machine. This fails randomly,
    // gets marked flaky, gets a wider threshold, and then catches nothing.
    Assert.True(sw.ElapsedMilliseconds &lt; 50);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Deterministic, so it cannot flake"><code>[Fact]
public void ParseAllocationDoesNotRegress()
{
    // Warm up so first-call caches are not counted.
    for (int i = 0; i &lt; 1_000; i++)
    {
        Parse(Line);
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);

    const int iterations = 10_000;
    for (int i = 0; i &lt; iterations; i++)
    {
        Parse(Line);
    }

    long perOperation = (GC.GetTotalAllocatedBytes(precise: true) - before) / iterations;

    // A CEILING, not an exact value: runtime versions change the details
    // and you do not want to update the test for that.
    Assert.True(perOperation &lt;= 256,
        $"allocated {perOperation} bytes per parse, budget is 256");
}</code></pre>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   ten measurements of TIME       : min    125 ns, max    136 ns, spread 1.09x
   ten measurements of ALLOCATION : min    232 B, max    232 B, identical: True</code></pre>

  <h3>3. Reporting a mean with no spread</h3>

  <pre data-lang="text" data-bad="true"><code>| Method    | Mean     | Ratio |
| Original  | 412.3 ns |  1.00 |
| Optimised |  38.1 ns |  0.09 |</code></pre>

  <p>Without an error column this could be two samples on a noisy machine. And 38 ns for anything
  touching a string is a claim that part of it was optimised away.</p>

  <h3>4. Benchmarking one size</h3>

  <p>Covered above: the winner reversed between 4 and 8 entries in one measurement, and between
  currency codes and fee codes at the <em>same</em> count.</p>

  <h3>5. Optimising before profiling</h3>

  <p>A 3.2x on the parse produced a 1.000x on the request. The benchmark was correct, repeatable, and
  answered a question about 0.001% of the system.</p>

  <h3>6. Letting the benchmark set the agenda</h3>

  <p>The Ledger change was made because somebody benchmarked the lookup, not because anything indicated
  the lookup was a problem. A benchmark is a tool for comparing two candidate solutions to a problem
  you have already identified.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a benchmark result you do not believe, or two runs that disagree, or a
    change that was faster in a benchmark and slower in production.</p>
    <p><strong>Tools:</strong> establish the noise floor first, then check what was actually compiled,
    then confirm against the system rather than the microbenchmark.</p>
  </div>

  <h3>Step 1: measure the noise floor</h3>

  <p>Before comparing anything, benchmark the code <strong>against itself</strong>:</p>

  <pre data-lang="csharp" data-net="10" data-title="The first thing to run, every time"><code>// Two entries, both the SAME implementation. Any difference reported is
// pure noise, and it is the smallest effect this machine can detect today.
var results = new List&lt;Result&gt;
{
    Harness.Run("baseline  ", () =&gt; Parse(Line)),
    Harness.Run("identical ", () =&gt; Parse(Line))
};

Harness.Report(results);</code></pre>

  <p>If that reports a 12% difference between a method and itself, then a 12% improvement elsewhere is
  not a result. This takes a minute and saves entire arguments.</p>

  <h3>Step 2: check what was compiled</h3>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Symptom</th><th>Likely cause</th><th>Check</th></tr>
      </thead>
      <tbody>
        <tr><td>Under 1 ns per operation</td><td>Optimised away</td><td>Consume the result; add <code>[DisassemblyDiagnoser]</code></td></tr>
        <tr><td>First run much slower</td><td>Tiered compilation</td><td>Warm up more</td></tr>
        <tr><td>Two runs disagree wildly</td><td>Noise, or another process</td><td>Measure the noise floor</td></tr>
        <tr><td>Debug and Release differ hugely</td><td>Benchmarking Debug</td><td><code>-c Release</code></td></tr>
        <tr><td>Result changes with input size</td><td>A crossover</td><td>Benchmark at several sizes</td></tr>
        <tr><td>Faster in benchmark, slower live</td><td>Wrong size, shape, or call site</td><td>Profile the real system</td></tr>
      </tbody>
    </table>
  </div>

  <h3>Step 3: confirm against the system</h3>

  <pre data-lang="bash" data-title="What the benchmark cannot tell you"><code>dotnet-counters monitor --process-id 4821 --counters System.Runtime
dotnet-trace collect --process-id 4821 --profile cpu-sampling</code></pre>

  <p>A microbenchmark measures one operation on an idle machine. A profile of the running service tells
  you whether that operation is 40% of the time or 0.001% of it — which is the number that decides
  whether the benchmark was worth running.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The order is: <strong>profile, then benchmark, then measure the system again.</strong></p>
    <p>The last step is the one people skip. The Ledger change looked correct in a benchmark and was
    never confirmed against production, which is why it took three days to find.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The benchmark says it is faster, so it is faster."</strong></p>
    <p>It says that implementation was faster for that input size, that data shape, at that call site,
    on that machine. Measured in this module: the winner reversed between 4 and 8 entries, and reversed
    again at the same count when the keys changed shape.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A 10% improvement is worth having."</strong></p>
    <p>Only if your noise floor is well below 10%. Measured on identical, fully warmed-up work: a
    standard deviation of 16% of the mean and a 1.63x spread between fastest and slowest sample.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Warmup is a formality."</strong></p>
    <p>Measured at 4.5x between the first round and steady state, and 16.6x for a genuinely cold
    measurement. .NET compiles a method twice, and tier 0 is not what runs in production.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I do not need to use the result; the method still runs."</strong></p>
    <p>Sometimes. Measured, a discarded result reported under half the real cost. It did <em>not</em>
    matter for a method that allocates, because allocation is an observable side effect — but that is
    the exception, and pure arithmetic is exactly what people microbenchmark.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Benchmarks belong in CI as a performance gate."</strong></p>
    <p>Timing assertions on a shared build agent flake, get widened, and stop catching anything.
    Measured: ten timing measurements spread 1.09x while ten allocation measurements were byte-for-byte
    identical.</p>
    <p>Assert on allocation in CI. Run timing benchmarks locally, on demand, when investigating.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A microbenchmark tells me whether to make the change."</strong></p>
    <p>It tells you which of two implementations is faster in isolation. Measured, a real 3.2x on a
    parse produced a 1.000x on the request that contained it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"BenchmarkDotNet's numbers are authoritative."</strong></p>
    <p>They are trustworthy measurements of what you asked it to measure. It defends against every
    error in the first half of this module and none in the second — it cannot know your production
    input size, your data shape, or where else the code runs.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The Ledger change cost about half a core of the fleet and 1.1% of request latency, and it cost
    three days of investigation because the benchmark attached to it was correct.</p>
    <p>The wider cost is harder to see. A team that trusts microbenchmarks makes a series of changes
    that are each defensible and collectively pointless, while the actual bottleneck — an N+1 query, a
    missing index, a blocking call — goes unexamined because nobody profiled.</p>
    <p><strong>The measurement discipline that matters is not statistical.</strong> It is asking what
    fraction of the system this is, at what input size, with what data, and where else the code runs —
    before writing the benchmark.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Question</th><th>Tool</th></tr>
      </thead>
      <tbody>
        <tr><td>Where does the time go?</td><td>A profiler. <code>dotnet-trace</code>, a CPU-sampling profile.</td></tr>
        <tr><td>Which of these two is faster?</td><td>BenchmarkDotNet, at production input size.</td></tr>
        <tr><td>Did this change allocate more?</td><td><code>GC.GetTotalAllocatedBytes</code>, asserted in CI.</td></tr>
        <tr><td>Is the difference real?</td><td>The error margin. Benchmark the code against itself first.</td></tr>
        <tr><td>Is the difference worth anything?</td><td>Its share of a request, from the profile.</td></tr>
        <tr><td>Did it help in production?</td><td>p99 before and after. Nothing else settles it.</td></tr>
        <tr><td>Was the work optimised away?</td><td><code>[DisassemblyDiagnoser]</code>, or suspicion below 1 ns.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Find at least four things wrong with this benchmark.</p>
    <pre data-lang="csharp" data-net="10"><code>var sw = Stopwatch.StartNew();
for (int i = 0; i &lt; 1000; i++)
{
    Parse(line);
}

sw.Stop();
Console.WriteLine(sw.ElapsedMilliseconds);</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console"><code>   cold, discarded  :  2279.2 ns per call
   warm, discarded  :   137.0 ns per call
   warm, consumed   :   146.4 ns per call</code></pre>
        <ol>
          <li><strong>No warmup.</strong> The first calls run tier 0 code and include the JIT compiling
          the method — measured at 16.6x the steady state.</li>
          <li><strong>Result discarded.</strong> Nothing observes <code>Parse</code>, so the JIT may
          delete some of it. It happens not to matter for this method because <code>Split</code>
          allocates, but that is luck rather than design.</li>
          <li><strong>One sample.</strong> Run-to-run variance measured 16% of the mean on identical
          work. One number cannot tell you whether a difference is real.</li>
          <li><strong>Millisecond resolution</strong> for a nanosecond operation. A thousand calls at
          137 ns is 0.14 ms, which prints as 0.</li>
          <li><strong>No allocation reported</strong> — and for a parsing change the allocation is
          frequently the entire point.</li>
        </ol>
        <p>A sixth, if the file was run with plain <code>dotnet run</code>: <strong>it is a Debug
        build</strong>, which disables inlining and most optimisation.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>A colleague reports that implementation A is 5% faster than B. Is that a result? What do you need
    to know?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>You cannot tell without the error margin.</strong> Measured on twenty samples of
        <em>identical</em> code:</p>
        <pre data-lang="console"><code>   mean   :    5.74 ms
   stddev :    0.97 ms   (16.9% of the mean)
   95% error margin on the mean: +/-7.4%</code></pre>
        <p>The margin is wider than 5%, so on this machine a 5% difference is indistinguishable from no
        difference at all. You would get "5% faster" by running the same code twice and picking the
        better run.</p>
        <p><strong>What to ask for:</strong></p>
        <ul>
          <li>The error or standard deviation, not only the mean.</li>
          <li>The number of samples.</li>
          <li>Whether the code was warmed up and the result consumed.</li>
          <li>The allocation column.</li>
        </ul>
        <p><strong>And what to do:</strong> benchmark the code against itself. Two entries, same
        implementation. Whatever difference that reports is your noise floor, and no smaller effect is
        detectable.</p>
        <p>Even if 5% is real, it is a separate question whether it is worth anything — which needs the
        operation's share of a request, and a benchmark cannot supply that.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>You benchmark <code>List&lt;int&gt;.Contains</code> against <code>HashSet&lt;int&gt;.Contains</code>
    and the List wins. Should the service use a List?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console"><code>      size   List.Contains   HashSet.Contains   winner
      ----   -------------   ----------------   ------
         2           8.6 ns              8.8 ns   List
         4           6.6 ns              9.1 ns   List
         8           6.7 ns              8.5 ns   List
        16           8.3 ns              9.6 ns   List
        64          16.2 ns              9.3 ns   HashSet
     1,000         147.2 ns              8.9 ns   HashSet</code></pre>
        <p><strong>The question has no answer without the size.</strong> The crossover here is between
        16 and 64 items for <code>int</code> keys, and it moves further out for long strings with
        common prefixes because each comparison costs more.</p>
        <p><strong>What I would actually do:</strong></p>
        <ol>
          <li><strong>Check the size in production</strong>, and what it will be in a year. A
          collection that is 8 today and 4,000 after onboarding is a HashSet.</li>
          <li><strong>Prefer the one that degrades gracefully.</strong> A List that is fine at 8 and
          catastrophic at 4,000 is a bug waiting for growth. A HashSet that is marginally slower at 8
          is not.</li>
          <li><strong>Ask whether it matters at all.</strong> Both are single-digit nanoseconds inside
          a request measured in milliseconds. If this is not in a tight loop, the difference is
          unobservable and the readable option wins.</li>
        </ol>
        <p><strong>The trap this exercise is really about:</strong> the Ledger incident in this module
        is exactly this decision, made correctly for a 4-entry collection and applied to a shared
        helper that another call site used with 4,000 entries.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>A change makes a parse 3.2x faster, measured properly. Should you ship it?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>It depends entirely on what contains the parse.</strong> Same measured change, three
        services:</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Service</th><th>Parses per request</th><th>Other work</th><th>End-to-end</th></tr></thead>
            <tbody>
              <tr><td>API endpoint</td><td>1</td><td>8 ms database call</td><td><strong>1.000x</strong> — invisible</td></tr>
              <tr><td>Log ingest</td><td>50</td><td>2 ms of I/O</td><td>~1.002x — still invisible</td></tr>
              <tr><td>Batch import</td><td>200,000</td><td>none</td><td><strong>3.2x</strong> — the whole job</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>The microbenchmark is identical in all three cases.</strong> It reports 3.2x and
        cannot tell you which situation you are in.</p>
        <p><strong>What decides it:</strong></p>
        <ul>
          <li><strong>The profile.</strong> If the parse is not in the top of a CPU profile of the real
          workload, the 3.2x is not available to you.</li>
          <li><strong>The allocation.</strong> Measured, this change also takes 232 bytes per parse to
          zero. At 200,000 parses that is 46 MB of garbage removed per import, which matters
          independently of the time.</li>
          <li><strong>The cost of the change.</strong> If the span version is five lines and equally
          readable, ship it — a free improvement needs no justification. If it is forty lines of
          pointer arithmetic, it needs the profile.</li>
        </ul>
        <p><strong>The honest general answer:</strong> ship it for the batch importer, and for the API
        endpoint ship it only if it costs nothing to read. Do not describe it as a performance
        improvement in either case unless you can show the p99 moved.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Write a performance regression test for CI that will not flake. Say what you assert on and why
    the obvious choice is wrong.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Assert on allocation, not on time.</strong> Measured, ten runs of each:</p>
        <pre data-lang="console"><code>   ten measurements of TIME       : min    125 ns, max    136 ns, spread 1.09x
   ten measurements of ALLOCATION : min    232 B, max    232 B, identical: True</code></pre>
        <p>And that 1.09x spread is on an idle developer machine. A shared CI agent running four jobs
        is far worse — a timing assertion there fails randomly, gets marked flaky, gets a wider
        threshold, and then catches nothing.</p>
        <pre data-lang="csharp" data-net="10"><code>public class ParseAllocationTests
{
    private const string Line = "INV-2026-0004821,GBP,123450,2026-03-14";

    [Fact]
    public void ParseAllocationDoesNotRegress()
    {
        // 1. Warm up, so first-call caches and JIT are not counted.
        for (int i = 0; i &lt; 1_000; i++)
        {
            SettlementParser.Parse(Line);
        }

        // 2. Start from a known heap.
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);

        // 3. Enough iterations that fixed setup is amortised away.
        const int iterations = 10_000;
        for (int i = 0; i &lt; iterations; i++)
        {
            SettlementParser.Parse(Line);
        }

        long perOperation = (GC.GetTotalAllocatedBytes(precise: true) - before) / iterations;

        // 4. A CEILING with headroom, and the budget in the message.
        Assert.True(perOperation &lt;= 256,
            $"Parse allocated {perOperation} bytes per call, budget is 256. " +
            "If this is intentional, raise the budget in this test deliberately.");
    }
}</code></pre>
        <p><strong>The four details that make it robust:</strong></p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Detail</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>Warm up first</td><td>First-call caches, static constructors and JIT allocate once and would inflate a short measurement.</td></tr>
              <tr><td>Collect before measuring</td><td>Starts from a known heap so the figure is this code's allocation.</td></tr>
              <tr><td>A ceiling, not an exact value</td><td>Runtime versions change the details. You want to catch a doubling, not a 8-byte change.</td></tr>
              <tr><td>The budget in the message</td><td>When it fails at 3am the failure should say what was expected and what happened.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>What this does not catch:</strong> an algorithmic regression that allocates the same
        and takes ten times longer. For that, keep timing benchmarks — but run them locally, on demand,
        when investigating. They are a tool for answering a question, not a gate on a pull request.</p>
        <p><strong>If you must gate on time</strong>, gate on a large factor rather than a percentage:
        assert the operation is under ten times a known-good figure, so it catches a catastrophe and
        ignores noise.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>A colleague brings this result and asks to ship the change. What do you ask?</p>
    <pre data-lang="text"><code>| Method    | Mean     | Ratio |
| Original  | 412.3 ns |  1.00 |
| Optimised |  38.1 ns |  0.09 |</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>Six questions, in the order that eliminates the most possibilities fastest.</p>
        <ol>
          <li><strong>Where is the error column?</strong> Without a spread this could be two samples on
          a noisy machine. Identical work in this module varied by 16% of its mean between samples.</li>
          <li><strong>Where is the allocation column?</strong> An 11x on time with <em>more</em>
          allocation per operation can be a net loss in a service, because the collection is paid by
          whichever request is unlucky.</li>
          <li><strong>Is 38 ns even possible for this work?</strong> That is roughly a hundred CPU
          cycles. For anything touching a string it is a claim that part of it was optimised away — ask
          what consumes the result, or add <code>[DisassemblyDiagnoser]</code>.</li>
          <li><strong>What size and shape was the input?</strong> The winner in this module's lookup
          benchmark reversed between 4 entries and 4,000, and reversed <em>again</em> at the same count
          when the keys changed from 3 characters to 10 with a shared prefix.</li>
          <li><strong>What fraction of a request is this?</strong> 374 ns saved inside an 8 ms request
          is 0.005%. Take the change if it is free, but do not call it a performance improvement.</li>
          <li><strong>Where else does this code run?</strong> The Ledger incident: a change correct for
          a 4-entry collection, applied to a shared helper another call site used with 4,000.</li>
        </ol>
        <p><strong>What I would say to them:</strong> none of this is a reason to reject the change.
        These are the questions that turn "it is 11x faster" into a decision, and the answer to several
        is frequently "ship it, it is free, and it is not the reason for anything".</p>
        <p><strong>The one that would stop me:</strong> question 3. If nobody can explain how 38 ns is
        achievable for the work described, the benchmark is measuring something else, and every other
        number in the table is untrustworthy too.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Why must a benchmark warm up?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>.NET compiles a method twice — tier 0 quickly and barely
        optimised, then tier 1 after roughly thirty calls. A cold measurement includes tier 0 code and
        the JIT itself: measured at 4.5x the steady state within a run, and 16.6x for a genuinely cold
        one.</p></div>
      </details></li>

    <li><p>Why must the benchmark consume its result?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>If nothing observes the result the JIT may delete the work.
        Measured, a discarded loop reported under half the real cost.</p>
        <p>It matters less for a method that allocates, because allocation is an observable side effect
        — but pure arithmetic is exactly what people microbenchmark.</p></div>
      </details></li>

    <li><p>What is a noise floor and how do you find yours?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>How much a measurement varies when nothing changed. Find it by
        benchmarking the code <strong>against itself</strong> — two entries, same implementation.</p>
        <p>Measured here: 16% standard deviation and a 1.63x spread on identical, warmed-up work. No
        smaller effect is detectable.</p></div>
      </details></li>

    <li><p>Why report a median as well as a mean?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>One slow sample — a collection, a context switch, another process
        waking up — drags a mean and leaves a median alone. Measured in this module's harness: a mean of
        2377.8 ns against a median of 1989.6 ns for the same samples.</p></div>
      </details></li>

    <li><p>Should performance tests assert on time in CI?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. Assert on allocation, which is deterministic — measured
        byte-for-byte identical across ten runs where timing spread 1.09x on an idle machine, and worse
        on a shared agent.</p>
        <p>Use a ceiling rather than an exact value, and keep timing benchmarks for local
        investigation.</p></div>
      </details></li>

    <li><p>Your benchmark shows 3.2x. Is the change worth making?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Not knowable from the benchmark. Measured: a real 3.2x on a parse
        produced a 1.000x on an 8 ms request containing it, and the same change was the whole job for a
        batch importer.</p>
        <p>The share of the system comes from a profile, not a benchmark.</p></div>
      </details></li>

    <li><p>Why can a benchmark's winner change with input size?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Different complexities cross over. Measured, a linear scan beat a
        dictionary at 4 entries and lost by more than 18,000x at 50,000.</p>
        <p>It also changes with the <em>shape</em> of the data: the same comparison reversed at 4
        entries when keys went from 3 characters to 10 with a shared prefix.</p></div>
      </details></li>

    <li><p>What does test data usually get wrong?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It is sorted, sequential or uniform, because that is what
        <code>Enumerable.Range</code> produces. Measured, the same method over the same-sized array was
        <strong>9.5x</strong> slower on shuffled data than sorted, purely from branch prediction.</p></div>
      </details></li>

    <li><p>Which comes first, profiling or benchmarking?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Profiling. It answers "what should I look at"; a benchmark answers
        "which of these two is faster". Benchmarking first produces true and useless facts about code
        that was never the problem.</p></div>
      </details></li>

    <li><p>What did the Ledger benchmark get right, and what went wrong?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The measurement was sound and reproduces: the array scan genuinely
        is faster than a <code>Dictionary</code> at four entries.</p>
        <p>The <em>inference</em> was wrong — that the same change helps everywhere the pattern appears.
        The shared helper was also called with 4,000 entries, which cost 90 microseconds per request
        and about half a core of the fleet. No amount of statistical rigour in the harness would have
        caught it.</p></div>
      </details></li>
  </ol>
</section>
`
});
