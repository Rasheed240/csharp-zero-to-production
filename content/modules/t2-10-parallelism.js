CSPREP.module({
  id: "t2-10-parallelism",
  minutes: 55,
  updated: "2026-08-31",
  summary: "Parallelism is a CPU technique with a fixed overhead, and whether it pays is decided by the work per item: measured at 0.33x for a trivial body and 5.55x for a heavy one on the same machine. This module covers the two failures that follow from getting it wrong - a shared accumulator that lost 85% of a valuation without throwing, and a Parallel.ForEach in a request handler that saturated the machine at a concurrency the load balancer read as idle.",
  terms: ["parallelism", "concurrency", "Parallel.For", "Parallel.ForEach", "PLINQ", "AsParallel",
    "AsOrdered", "MaxDegreeOfParallelism", "partitioning", "Amdahl's law", "race condition",
    "lost update", "localInit", "AggregateException", "ProcessorCount"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger revalues a book of 20,000 positions at month end. The calculation is pure arithmetic —
  no database, no network, nothing to wait for — and it takes about 380 ms. Someone noticed that the
  machine has eight cores and only one was busy, changed one word, and watched it drop to 70 ms:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Revaluation.cs — the change that was merged"><code>decimal total = 0;

// was: foreach (var p in book)
Parallel.ForEach(book, p =&gt; { total += Value(p); });

return total;</code></pre>

  <p>It was merged the same afternoon. It was five times faster, the tests passed, and there was
  nothing visibly wrong with it.</p>

  <p>Two things then went wrong, and only one of them was noticed.</p>

  <p><strong>The total was wrong.</strong> Not by a rounding error — measured here at 85% low, and a
  different figure on every run. No exception was thrown, nothing was logged, and the number looked
  like a number. Whether the error is enormous or invisible depends on timing, so the same defect can
  pass every test on a developer laptop and destroy a month-end close on a busier machine.</p>

  <p><strong>It saturated the server.</strong> Locally it ran one request at a time and used all
  eight cores beautifully. In production several accountants refresh the same screen at once, and
  each request tried to take the whole machine. Measured: p95 went from 13 ms at one concurrent
  request to 203 ms at sixteen — a concurrency a load balancer considers idle.</p>

  <p>This module is about when parallelism actually helps (measured: between 0.33× and 5.55× on the
  same machine, decided by one variable), why a shared accumulator fails so badly, and why the
  default configuration of <code>Parallel.ForEach</code> is wrong inside a server.</p>
</section>

<section id="plain-language">
  <h2>Parallelism, and what it is not</h2>

  <p class="define"><span class="define__term">Thread</span> An independent sequence of instructions
  the operating system can schedule onto a processor core. Two threads can run at the same instant
  only if there are two cores free.</p>

  <p class="define"><span class="define__term">Core</span> A physical execution unit in the
  processor. <code>Environment.ProcessorCount</code> reports how many the runtime can see — 8 on the
  machine every number in this module was measured on. It is the hard ceiling on how much CPU-bound
  work can happen simultaneously.</p>

  <p class="define"><span class="define__term">Concurrency</span> Several operations <em>in
  progress</em> at once. They need not be executing simultaneously — one thread can hold a thousand
  concurrent operations if they are all waiting.</p>

  <p class="define"><span class="define__term">Parallelism</span> Several operations
  <em>executing</em> at once, on different cores. It requires cores, and it is bounded by them.</p>

  <p><strong>That distinction is the whole module.</strong>
  <a href="#/m/t2-03-what-async-really-is">t2-03</a> was about concurrency: a thousand operations
  waiting on one thread. This is about parallelism: eight operations computing on eight cores.
  Using the tool for one on a problem of the other is the most common mistake here, and it is
  measurable — <code>Parallel.For</code> over I/O gave 8.5× while <code>Task.WhenAll</code> gave
  214× on the identical work.</p>

  <p class="define"><span class="define__term">Partitioning</span> Splitting a collection into chunks
  so that each thread gets its own range. This costs time before any of your work runs, and it is why
  parallelising a cheap loop makes it slower.</p>

  <p class="define"><span class="define__term">Amdahl's law</span> The observation that speed-up is
  limited by the fraction of the work that cannot be parallelised. If a tenth of the time is
  partitioning and coordination, no number of cores gets you past ten times — which is why measured
  speed-ups flatten below the core count rather than reaching it.</p>

  <p><strong>An analogy, and its limits.</strong> Eight people can paint a house roughly eight times
  faster than one. They cannot write a novel eight times faster, because the chapters depend on each
  other. And eight people cannot address one envelope faster than one person can — the coordination
  costs more than the task.</p>

  <p><strong>Where the analogy breaks:</strong> painters do not silently produce a wrong house when
  they overlap. Threads writing to the same variable produce a plausible, specific, wrong number, and
  nothing warns you. The interference in software is invisible, which is why the incident above ran
  for a week.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-minimal-example.cs"><code>// 04-minimal-example.cs — the smallest program showing when parallelism helps
// and when it costs, with nothing else in the file.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine($"cores: {Environment.ProcessorCount}");
        Console.WriteLine();
        Console.WriteLine("work per item   sequential   Parallel.For   speed-up");
        Row("none", 0);
        Row("heavy", 2000);
    }

    static void Row(string label, int spin)
    {
        var seq = Time(() =&gt; { for (var i = 0; i &lt; 20_000; i++) Spin(spin); });
        var par = Time(() =&gt; Parallel.For(0, 20_000, _ =&gt; Spin(spin)));
        Console.WriteLine($"{label,-13} {seq,11:N0} ms {par,11:N0} ms {seq / par,9:N2}x");
    }

    static void Spin(int n)
    {
        var h = 0;
        for (var i = 0; i &lt; n; i++) h = HashCode.Combine(h, i);
        if (h == int.MinValue) _sink++;
    }

    static double Time(Action a)
    {
        a();                                  // warm up, so the JIT is not measured
        var sw = Stopwatch.StartNew();
        a();
        return sw.Elapsed.TotalMilliseconds;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>cores: 8

work per item   sequential   Parallel.For   speed-up
none                    0 ms           0 ms      0.29x
heavy                 296 ms          43 ms      6.88x</code></pre>

  <p>The same loop, the same item count, the same machine. One variable changed — how much work each
  iteration does — and parallelism went from <strong>a 3.4× slowdown to a 6.9× speed-up</strong>.</p>

  <p><strong>Read the first row as the more important one.</strong> "Parallel is faster" is not a
  property of <code>Parallel.For</code>; it is a property of the body. With a trivial body, the
  partitioning, the range allocation and one delegate invocation per item cost more than the work
  being distributed, so you pay overhead to gain nothing.</p>

  <p><strong>And note the ceiling.</strong> 6.88× on 8 cores, not 8×. The gap is Amdahl's law made
  visible: some of the elapsed time is coordination rather than work, and no amount of hardware
  removes it.</p>

  <p>The <code>Time</code> helper runs each action once before measuring. That is not a nicety — the
  first call pays just-in-time compilation for the delegate and the loop body, which on a
  short benchmark can be most of the measurement.</p>
</section>

<section id="when-it-helps">
  <h2>When parallelism helps</h2>

  <p>100,000 items, varying only the work per item:</p>

  <pre data-lang="console" data-title="01-when-parallel-helps.cs"><code>  Environment.ProcessorCount = 8

  work per item      sequential   Parallel.For   speed-up
  none                        0              0       0.33x
  1 spin                      1              0       1.07x
  10 spins                    6              1       3.86x
  100 spins                  74             15       4.83x
  1,000 spins               696            126       5.55x</code></pre>

  <p>The shape is the useful thing here, not the individual figures. Parallelism is a
  <strong>fixed overhead paid up front</strong>, and the question is always whether the work per item
  exceeds it. Below the threshold you lose; above it you get several-fold gains that stay below the
  core count.</p>

  <p><strong>Do not read the middle rows as a smooth curve.</strong> Re-running this file produces a
  different set of intermediate values — one run gave 4.79x at ten spins and 1.72x at a hundred,
  which is out of order. Those middle points are noise. The two ends are not: a trivial body is
  reliably slower in parallel, and a heavy body reliably several times faster.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>There is no reliable rule of thumb for "enough work per item", because it depends on your
    processor, the body, and the item count. The only honest guidance is to measure your own
    workload — and to be suspicious of any parallelisation that was not measured, because roughly
    half of them are slower.</p>
  </div>

  <h3>CPU work and I/O work are not the same problem</h3>

  <pre data-lang="console" data-title="01-when-parallel-helps.cs — 200 operations waiting 10 ms each"><code>    sequential blocking   :    3,272 ms
    Parallel.For blocking :      384 ms   (8.5x)
    Task.WhenAll async    :       15 ms   (214.4x)</code></pre>

  <p><code>Parallel.For</code> <em>does</em> speed up I/O — and it is still the wrong tool. It buys
  its 8.5× by occupying one thread per concurrent operation, which is precisely the thread pool
  starvation measured in <a href="#/m/t2-02-thread-pool">t2-02</a>.
  <code>Task.WhenAll</code> is 25 times better again and occupies no threads at all while
  waiting.</p>

  <p><strong>The rule: <code>Parallel</code> and PLINQ for CPU-bound work; <code>async</code> and
  <code>WhenAll</code> for I/O-bound work.</strong> Getting it backwards is not merely slower — it
  consumes a shared resource that the rest of the process needs, so the damage lands somewhere other
  than the code you changed.</p>

  <h3>Degree of parallelism</h3>

  <p class="define"><span class="define__term">MaxDegreeOfParallelism</span> A property on
  <code>ParallelOptions</code> capping how many operations run at once. The default is
  effectively unbounded, meaning the loop will use as much of the machine as it can get.</p>

  <pre data-lang="console" data-title="01-when-parallel-helps.cs"><code>  MaxDegreeOfParallelism     ms   speed-up vs 1
                       1       65         1.00x
                       2       33         1.97x
                       4       17         3.77x
                       8       11         5.75x
                      16       11         5.96x
                      64       11         5.65x</code></pre>

  <p>Scaling tracks the core count and then stops. Setting 64 on an eight-core machine buys nothing
  and adds context switching. <strong>But the reason to set it is the opposite of the reason people
  assume:</strong> not to go faster, but to <em>limit</em> how much of the machine one operation can
  take. That matters enormously inside a server, and the production section returns to it.</p>

  <h3>PLINQ</h3>

  <p class="define"><span class="define__term">PLINQ</span> Parallel LINQ. Adding
  <code>.AsParallel()</code> to a query partitions the source across threads. It is the shortest way
  to parallelise a query and the easiest to apply where it does not belong.</p>

  <pre data-lang="console" data-title="01-when-parallel-helps.cs — 2,000,000 elements"><code>    LINQ                  :      577 ms
    PLINQ                 :      138 ms   (4.18x)
    LINQ, trivial predicate :     13 ms
    PLINQ, trivial predicate:     38 ms   (0.35x)</code></pre>

  <p>The same shape again: 4.18× with an expensive predicate, <strong>0.35× — nearly three times
  slower — with a trivial one</strong>. <code>AsParallel()</code> is not a free optimisation you
  sprinkle onto a slow query.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Ordering.</strong> PLINQ makes no ordering guarantee, and this is a trap because it
    frequently <em>appears</em> to preserve order anyway:</p>
    <pre data-lang="console" data-title="01-when-parallel-helps.cs"><code>    plain AsParallel().ToArray() came back in source order : True
    AsOrdered().ToArray() came back in source order        : True</code></pre>
    <p>Both true. For an indexable source consumed with <code>ToArray</code>, PLINQ reassembles by
    partition index and the output usually is in order. <strong>Relying on that is the mistake</strong>
    — it is an implementation detail of this operator on this source, not a contract, and it changes
    with the query shape.</p>
    <p>What is genuinely unordered is the order elements are <em>processed</em>:</p>
    <pre data-lang="console" data-title="Processing order"><code>    first 10 processed      : 25000,25001,25002,25003,25004,...
    processing was in order : False</code></pre>
    <p>So any side effect inside a PLINQ query happens in an arbitrary order on an arbitrary thread.
    Use <code>AsOrdered()</code> when you need the result ordered — and measure, because on a filtered
    or reshaped query PLINQ must buffer to reassemble, which can remove the benefit entirely.</p>
  </div>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>The revaluation from the opening. The shipped version accumulated into a captured local:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a shared accumulator"><code>
    /// &lt;summary&gt;THE BUG. A shared accumulator with no synchronisation.&lt;/summary&gt;
    static decimal RacyParallel(Position[] book)
    {
        decimal total = 0;
        System.Threading.Tasks.Parallel.ForEach(book, p =&gt; { total += Value(p); });
        return total;
    }</code></pre>

  <pre data-lang="console" data-title="02-production.cs"><code>  correct total (sequential)   :     135,778,664.67

  run   racy parallel total          difference   correct?
    1            21,734,943.40   114,043,721.27   NO
    2            16,242,537.45   119,536,127.21   NO
    3            20,498,893.99   115,279,770.68   NO
    4            19,825,880.04   115,952,784.63   NO
    5            17,771,977.63   118,006,687.04   NO</code></pre>

  <p class="define"><span class="define__term">Lost update</span> What happens when two threads read
  the same value, each add to it, and each write back: one write overwrites the other and one addition
  disappears. <code>total += x</code> is three operations — read, add, write — and nothing keeps them
  together.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>The size of the error defeats intuition in both directions.</strong> People expect
    either a crash or a rounding-sized discrepancy. Under heavy contention you get neither: no
    exception at all, and an answer missing 85% of its value.</p>
    <p>And it is not reliably that large, which is the real hazard. With fewer threads, less
    contention, or a cheaper body, the same bug loses a handful of updates and produces a total that
    looks like a rounding difference — small enough to be reconciled against and believed. The
    severity is set by timing, so the identical defect can be invisible in testing and catastrophic in
    production, or the reverse.</p>
  </div>

  <h3>The three correct shapes</h3>

  <pre data-lang="csharp" data-net="10" data-title="02-production.cs"><code>    /// &lt;summary&gt;Correct, and slow: 20,000 lock acquisitions.&lt;/summary&gt;
    static decimal LockedParallel(Position[] book)
    {
        decimal total = 0;
        var gate = new object();
        System.Threading.Tasks.Parallel.ForEach(book, p =&gt;
        {
            var v = Value(p);
            lock (gate) { total += v; }
        });
        return total;
    }

    /// &lt;summary&gt;Correct and fast: private accumulation, combined once per partition.&lt;/summary&gt;
    static decimal LocalStateParallel(Position[] book)
    {
        decimal total = 0;
        var gate = new object();
        System.Threading.Tasks.Parallel.ForEach(
            book,
            () =&gt; 0m,                                        // localInit
            (p, _, local) =&gt; local + Value(p),               // body
            local =&gt; { lock (gate) { total += local; } });   // localFinally
        return total;
    }

    static decimal PlinqSum(Position[] book) =&gt; book.AsParallel().Sum(Value);</code></pre>

  <pre data-lang="console" data-title="02-production.cs"><code>  approach                          ms     difference from sequential   identical?
  sequential                         36                            0   yes
  Parallel.ForEach + lock            14                       -1E-20   no
  Parallel.ForEach + local state     15                    -1.25E-18   no
  PLINQ .Sum()                       18                    -1.24E-18   no</code></pre>

  <p><strong>All three are correct — no updates are lost — and none is exactly equal to the
  sequential total.</strong> The differences are around 10<sup>-18</sup>: far below a penny, and
  definitively not zero.</p>

  <p>This is not a race. Parallel aggregation adds the numbers in a <em>different order</em>, and
  decimal addition is not associative at the limits of the type's precision:
  <code>(a+b)+c</code> and <code>a+(b+c)</code> can differ in the last digits. The same is true of
  <code>double</code>, more strongly.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>A test asserting <code>parallelTotal == sequentialTotal</code> will <strong>fail on correct
    code</strong>. Assert a tolerance instead, chosen deliberately: tight enough to catch a lost
    update (which is enormous) and loose enough to permit reordering (which is around
    10<sup>-18</sup>). For money, round at a defined point rather than comparing raw accumulations at
    all.</p>
  </div>

  <p><strong>Locking works and is the least good option.</strong> Every item contends on one lock, so
  the parallel section is almost entirely serialised — you have paid for partitioning to gain
  little.</p>

  <p><strong>Local state is the right shape for <code>Parallel.ForEach</code>.</strong> Each partition
  accumulates privately and the per-partition results are combined once at the end, so the lock is
  taken a handful of times rather than 20,000. That is what the <code>localInit</code> and
  <code>localFinally</code> parameters are for, and their existence is the clue that a naive shared
  accumulator was never the intended usage.</p>

  <p><strong>PLINQ's <code>.Sum()</code> does the same and you do not have to write it.</strong> For
  an aggregation this is almost always the right answer.</p>

  <h3>The second failure: it was inside a request handler</h3>

  <pre data-lang="console" data-title="02-production.cs"><code>  concurrent requests   unbounded p95 ms   capped p95 ms
                    1                 13              36
                    4                 51              53
                   16                203             260</code></pre>

  <p>Read the unbounded column first: <strong>p95 rises roughly sixteenfold from 1 to 16 concurrent
  requests</strong>, on work that did not change. Each request tries to use all eight cores, so N
  requests contend for the same eight processors. The machine is saturated at a concurrency a load
  balancer still reads as idle.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>Capping did not improve p95 here.</strong> It was worse at every concurrency, and that
    is a real result worth reporting rather than explaining away.</p>
    <p>The reason is that this workload is short and uniform: oversubscription costs little when every
    task takes a similar time and the whole thing finishes in milliseconds, because the scheduler
    time-slices and the total work is unchanged. Capping only removes contention that is actually
    hurting.</p>
    <p>What capping does buy, and what this benchmark cannot show: a bound on how much of the machine
    one request can take, so a parallel section cannot starve unrelated endpoints; protection when the
    body is longer or more variable, where oversubscription costs real time; and a known ceiling
    rather than one that moves with whatever else the process is doing.</p>
    <p><strong>So the rule is about bounding resource use, not about latency.</strong> Set it in a
    request handler for isolation, and measure your own workload rather than expecting a
    microbenchmark's p95 to thank you.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The two failures in this one change have opposite detection profiles, and that is the lesson
    worth carrying.</p>
    <p><strong>The saturation was visible in ordinary metrics</strong> — CPU pinned at 100%, thread
    pool queue rising, p95 tracking concurrency — and was found within a day.</p>
    <p><strong>The wrong total was visible in nothing.</strong> No exception, no counter, no log line,
    no alert. It was found by a human reconciling a report a week later. There is no monitoring for
    "the answer is wrong", which is why correctness under parallelism has to be established by
    construction and by tests rather than caught in production.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Writing to shared state from a parallel body</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: three versions of the same bug"><code>// WRONG. A captured local. Measured: 85% of the value lost.
decimal total = 0;
Parallel.ForEach(book, p =&gt; { total += Value(p); });

// WRONG. A List&lt;T&gt;. Measured: 4,313 of 10,000 items survived.
var results = new List&lt;int&gt;();
Parallel.For(0, 10_000, i =&gt; results.Add(i));

// WRONG. A Dictionary. Can corrupt its internal buckets and loop forever.
var index = new Dictionary&lt;string, int&gt;();
Parallel.ForEach(items, x =&gt; index[x.Key] = x.Value);

// Right: produce a result rather than mutating shared state.
var total = book.AsParallel().Sum(Value);
var results = Enumerable.Range(0, 10_000).AsParallel().Select(i =&gt; i).ToArray();
var index = items.AsParallel().ToDictionary(x =&gt; x.Key, x =&gt; x.Value);</code></pre>

  <p>The dictionary case deserves a note: a corrupted <code>Dictionary</code> can produce an
  <em>infinite loop</em> inside a subsequent lookup, on a thread that is not the one that corrupted
  it, arbitrarily later. That is among the hardest failures in .NET to trace back to its cause.</p>

  <h3>2. Parallelising I/O</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: uses a thread per operation"><code>// WRONG. Blocks one pool thread per item for the whole call.
Parallel.ForEach(invoices, inv =&gt; _gateway.ChargeAsync(inv).GetAwaiter().GetResult());

// Also wrong: the async lambda becomes async void (t2-05), so ForEach
// returns immediately having done nothing.
Parallel.ForEach(invoices, async inv =&gt; await _gateway.ChargeAsync(inv));

// Right for I/O: concurrency without threads.
await Task.WhenAll(invoices.Select(inv =&gt; _gateway.ChargeAsync(inv, ct)));

// Right when you also need a limit:
await Parallel.ForEachAsync(invoices,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (inv, token) =&gt; await _gateway.ChargeAsync(inv, token));</code></pre>

  <p><code>Parallel.ForEachAsync</code> is the one to remember: it is the async-aware member of the
  family, it takes a token properly, and it bounds concurrency — which
  <code>Task.WhenAll</code> does not.</p>

  <h3>3. Leaving <code>MaxDegreeOfParallelism</code> at the default inside a server</h3>

  <p>The default assumes the process owns the machine. That is true of a console tool and false of a
  web service, where every concurrent request runs its own unbounded loop.</p>

  <h3>4. Assuming <code>AsParallel()</code> is free</h3>

  <p>Measured at 0.35× — nearly three times slower — on a query with a trivial predicate. It is a
  trade, not an improvement.</p>

  <h3>5. Relying on PLINQ's incidental ordering</h3>

  <p>Verified: a plain <code>AsParallel().ToArray()</code> came back in source order. That is not a
  guarantee and it changes with the query shape. Use <code>AsOrdered()</code> and measure whether the
  query is still worth parallelising.</p>

  <h3>6. Expecting one exception</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the type-based catch never matches"><code>// WRONG. The body's exception is wrapped, so this catch does not fire.
try { Parallel.ForEach(items, Process); }
catch (InvalidOperationException ex) { Handle(ex); }

// Right: expect the wrapper, and flatten nested aggregates.
try { Parallel.ForEach(items, Process); }
catch (AggregateException ex)
{
    foreach (var inner in ex.Flatten().InnerExceptions)
        Handle(inner);
}</code></pre>

  <p>Measured: three failing items produced an <code>AggregateException</code> with three inner
  exceptions — but that count is not guaranteed. Once an item throws, the loop stops handing out new
  work, so a failing item that had not yet started never runs and never appears. <strong>The work is
  also partially complete and the exception does not tell you which parts</strong>, so design for
  idempotency or record progress explicitly.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> latency rises with concurrent request count, and the processor is
    pinned at 100%.</p>
    <p><strong>Why:</strong> parallel sections competing for the same cores. This is the opposite
    signature to blocking, and telling them apart is the whole diagnosis:</p>
    <pre data-lang="console" data-title="Three latency problems, three signatures"><code>parallel saturation  : CPU 100%, latency tracks request COUNT     -&gt; cap the parallelism
blocking (t2-07)     : CPU idle, threads climbing, queue rising    -&gt; remove the blocking
buffering (t2-09)    : memory tracks request SIZE, CPU normal      -&gt; stream instead</code></pre>
    <p><strong>Tool:</strong></p>
    <pre data-lang="console" data-title="Confirming saturation"><code>dotnet-counters monitor --process-id 4812 System.Runtime
    cpu-usage                 pinned near 100%
    threadpool-queue-length   rising
    threadpool-thread-count   near or above ProcessorCount</code></pre>
    <p><strong>Fix:</strong> set <code>MaxDegreeOfParallelism</code>, or move the work out of the
    request path entirely into a queue with a bounded worker count.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a computed value is wrong, is different on each run, and nothing
    throws.</p>
    <p><strong>Why:</strong> a lost update on shared state. There is no counter for this and no alert
    will fire, so the diagnosis is by inspection.</p>
    <p><strong>Tool:</strong> read every parallel body and ask one question — <em>does this write to
    anything declared outside it?</em> A captured local, a field, a collection, a dictionary. If yes,
    it is a bug unless it is an <code>Interlocked</code> operation or inside a lock.</p>
    <p><strong>Reading it:</strong> the tell in the numbers is that the result varies run to run and
    is always <em>lower</em> than expected for an accumulator, because lost updates discard additions
    rather than duplicating them.</p>
    <p><strong>Fix:</strong> restructure so the body produces a value instead of mutating —
    <code>AsParallel().Sum()</code>, <code>Select().ToArray()</code>, or the
    <code>localInit</code>/<code>localFinally</code> overload.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> you want to prove a parallel implementation is correct before it
    reaches production.</p>
    <pre data-lang="csharp" data-net="10" data-title="The test that catches a lost update"><code>[Fact]
public void Revalue_MatchesSequential_WithinRoundingTolerance()
{
    var book = GenerateBook(20_000);        // large enough for the race to occur

    var expected = book.Aggregate(0m, (a, p) =&gt; a + Value(p));
    var actual = _service.Revalue(book);

    // NOT Assert.Equal: reordering changes the last digits even when correct.
    Assert.True(Math.Abs(actual - expected) &lt; 0.0001m,
        $"expected ~{expected}, got {actual}, difference {actual - expected}");
}</code></pre>
    <p><strong>Reading it:</strong> two things make this test work. The book must be
    <strong>large</strong> — a race needs contention, and 100 items will pass on the broken code. And
    the tolerance must be a tolerance: exact equality fails on correct code because of reordering,
    measured at around 10<sup>-18</sup>, while a lost update is enormous. Any tolerance between those
    two scales separates them cleanly.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a parallel loop throws and your handler does not catch it.</p>
    <p><strong>Why:</strong> the body's exception is wrapped in <code>AggregateException</code>, so a
    <code>catch (InvalidOperationException)</code> never matches.</p>
    <p><strong>Tool:</strong> catch the wrapper and flatten:</p>
    <pre data-lang="csharp" data-net="10" data-title="Unwrapping"><code>catch (AggregateException ex)
{
    foreach (var inner in ex.Flatten().InnerExceptions)
        _logger.LogError(inner, "item failed");
}</code></pre>
    <p><strong>Reading it:</strong> <code>Flatten()</code> matters when the bodies themselves contain
    parallel work, producing aggregates inside aggregates. And remember the count is not necessarily
    the number of items that <em>would</em> have failed — the loop stops scheduling after the first
    throw.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Half of all parallelisation makes things slower, and nobody checks.</strong> The same
    loop on the same machine measured 0.33× and 5.55× depending only on the work per item. A
    developer who adds <code>.AsParallel()</code> to a query with a cheap predicate has made it nearly
    three times slower and will report the change as an optimisation, because the intuition that more
    cores means more speed is strong and the measurement is rarely taken. Every parallelisation should
    arrive with a before-and-after number attached.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A parallel loop in a request handler is a way to let one request own the
    machine.</strong> Measured: p95 rising from 13 ms to 203 ms as concurrency went from 1 to 16 —
    while the request rate was still low enough that autoscaling would not trigger and the load
    balancer would report the instance as healthy. The service degrades at a concurrency nobody is
    watching for, and adding instances helps only until each one saturates too.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The correctness failure has no detection story at all.</strong> The saturation was
    found in a day from ordinary metrics. The wrong total was found a week later by a person
    reconciling a report, because there is no counter for "this number is wrong" — no exception, no
    log line, no alert. In a payments system that week's figures were used for decisions.</p>
    <p>This is the asymmetry that should drive how you treat parallel code: performance problems
    announce themselves and correctness problems do not. Establish correctness by construction —
    produce values rather than mutating shared state — because you will not be told when you have
    got it wrong.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Parallel is faster."</strong> Measured at 0.33× on a trivial body and 5.55× on a heavy
    one. It is faster when the work per item exceeds the partitioning overhead, and slower when it
    does not. There is no rule of thumb — only measurement.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>Parallel.ForEach</code> is good for calling an API for each item."</strong> That
    is I/O. <code>Parallel.ForEach</code> blocks one pool thread per operation; measured at 8.5×
    against <code>Task.WhenAll</code>'s 214× on identical work. Use <code>WhenAll</code>, or
    <code>Parallel.ForEachAsync</code> if you also need a concurrency limit.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>total += x</code> is one operation."</strong> It is a read, an add and a write.
    Measured: 85% of a valuation lost, with no exception. If the body writes to anything declared
    outside it, it is a bug.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"If it were racy it would crash."</strong> Races on numbers produce a plausible wrong
    number in silence. Races on collections may crash, or may lose items, or may corrupt a dictionary
    such that a later lookup on an unrelated thread loops forever. Which one you get is timing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"My parallel version disagrees with the sequential one, so it has a race."</strong> Not
    necessarily. Correct parallel aggregation differs in the last digits because it adds in a
    different order — measured at around 10<sup>-18</sup>. A lost update is enormous. Compare with a
    tolerance chosen between those scales.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"More degrees of parallelism means more speed."</strong> Scaling stopped at the core
    count: 5.75× at 8, 5.96× at 16, 5.65× at 64. Past the core count you add context switching and
    nothing else.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"PLINQ preserves order."</strong> It happened to here, and that is an implementation
    detail rather than a contract. Processing order is definitively arbitrary. Use
    <code>AsOrdered()</code> if you need it, and re-measure — buffering to reassemble can remove the
    benefit.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <p>Every answer below is produced by running <code>03-exercises.cs</code>, included in full at the
  end of the module.</p>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Three loops over 200,000 items. Which get faster in parallel?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>for (var i = 0; i &lt; 200_000; i++) sum += i;                    // (a)
for (var i = 0; i &lt; 200_000; i++) { Spin(20);   sum += i; }     // (b)
for (var i = 0; i &lt; 200_000; i++) { Spin(2000); sum += i; }     // (c)</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  body                       sequential   parallel   speed-up
  i =&gt; sum += i                       0          0       0.60x
  20 hash combines                   26          5       4.85x
  2,000 hash combines             2,812        550       5.11x</code></pre>
        <p><strong>(a) is slower in parallel</strong> — 0.60×. The per-item delegate invocation and
        the partitioning cost more than an addition.</p>
        <p><strong>(b) and (c) both gain</strong>, and note that (c) is barely better than (b) despite
        100 times more work per item. Once you are past the overhead threshold you are near the
        ceiling, and adding more work per item does not push the ratio much further — the remaining
        gap to 8× is coordination that no amount of work removes.</p>
        <p>The practical reading: the decision is roughly binary. Either the body is substantial
        enough to clear the overhead, in which case you get most of the available benefit, or it is
        not, in which case you lose. Fine-tuning the body size is not where the wins are.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Find the bug, then rank the three fixes.</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 2"><code>var results = new List&lt;int&gt;();
Parallel.For(0, 10_000, i =&gt; results.Add(i));</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    run 1: 4313 of 10,000 items — LOST 5687
    run 2: 2060 of 10,000 items — LOST 7940
    run 3: 5362 of 10,000 items — LOST 4638

    lock around Add           : 10000 items
    ConcurrentBag&lt;T&gt;          : 10000 items
    PLINQ .Select().ToArray() : 10000 items</code></pre>
        <p><strong><code>List&lt;T&gt;</code> is not thread-safe.</strong> <code>Add</code> increments
        a count and writes an array slot non-atomically, so concurrent calls overwrite each other.
        Roughly half the items vanished, and the count differed every run.</p>
        <p><strong>Losing items is only the outcome that happened here.</strong> The same code can
        throw <code>IndexOutOfRangeException</code> from inside the resize, or leave null entries,
        depending on where a thread is interrupted. A test that passes proves nothing about the next
        run — which is the defining characteristic of this whole class of bug.</p>
        <p><strong>Ranking the fixes, worst to best.</strong> <em>Locking</em> works and serialises the
        thing you parallelised, so you have paid partitioning costs for little gain.
        <em>ConcurrentBag</em> is better but still coordinates on every item, and it does not preserve
        order. <em>PLINQ producing an array</em> is best because it does not share mutable state at
        all — each partition builds its own result and they are combined once.</p>
        <p>The general principle: <strong>prefer producing a value over mutating shared state.</strong>
        Locks and concurrent collections manage the problem; producing a result avoids having it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Three parallel sums of the same 100,000 decimals. One is a bug and two are not, yet two of the
    three disagree with the sequential answer. Explain.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    sequential      :     714,292,857.142857
    racy parallel   :     119,579,216.985068   WRONG
    local state     :     714,292,857.142857   differs
    PLINQ Sum()     :     714,292,857.142857   equal
    local  - seq    :                 -1E-20
    PLINQ  - seq    :                      0</code></pre>
        <p><strong>Two entirely different phenomena, and confusing them is the trap.</strong></p>
        <p><strong>The racy version is a bug.</strong> 83% of the value is missing because
        <code>total += v</code> is read-add-write and updates are lost. It could be wrong by any
        amount, including — on a quiet machine — by almost nothing.</p>
        <p><strong>The local-state version is correct and still differs</strong>, by 10<sup>-20</sup>.
        Nothing was lost. It added the numbers in a different order, and decimal addition is not
        associative at the limits of the type's precision. This is arithmetic, not concurrency.</p>
        <p><strong>PLINQ matched exactly on this run</strong> — which is luck, not a guarantee. Its
        partitioning happened to produce a grouping equivalent to sequential order. Change the item
        count or the core count and it will differ too.</p>
        <p><strong>The consequence for testing is the point of the exercise.</strong>
        <code>Assert.Equal(sequential, parallel)</code> is wrong: it fails on correct code and would
        have flagged the local-state version. Assert a tolerance chosen between the two scales — a
        lost update is enormous, reordering is around 10<sup>-18</sup>, and anything between them
        separates the two cleanly. For money, round at a defined point and compare the rounded
        values.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>100 operations that each wait 10 ms. Rank <code>for</code>, <code>Parallel.For</code> and
    <code>Task.WhenAll</code>, and say which you would ship.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    sequential blocking :   1,651 ms
    Parallel.For        :     186 ms   (8.9x)
    Task.WhenAll        :      14 ms   (118.4x)</code></pre>
        <p><strong>Ship <code>Task.WhenAll</code>.</strong> It is 13 times better than
        <code>Parallel.For</code> here, and the speed is not even the main reason.</p>
        <p><code>Parallel.For</code> achieves its 7.4× by <em>occupying one pool thread per concurrent
        operation</em>, every one of them blocked and doing nothing. That is thread pool starvation
        (<a href="#/m/t2-02-thread-pool">t2-02</a>) with extra steps, and its cost lands on the rest of
        the process rather than on this loop — other requests queue behind threads that are asleep.</p>
        <p><code>Task.WhenAll</code> holds no threads while waiting at all
        (<a href="#/m/t2-03-what-async-really-is">t2-03</a>), so the concurrency is free.</p>
        <p><strong>One refinement for real code:</strong> <code>Task.WhenAll</code> starts everything
        at once, which can overwhelm the dependency you are calling. When you need concurrency
        <em>and</em> a limit, use <code>Parallel.ForEachAsync</code> with
        <code>MaxDegreeOfParallelism</code> — it is async-aware, takes a token, and bounds the
        fan-out.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Three of 100 items throw inside a <code>Parallel.For</code>. What does the caller catch, how
    many exceptions, and what is the state of the work?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    Parallel.For, 3 of 100 throw : AggregateException with 3 inner exception(s)
    PLINQ, 3 of 100 throw        : AggregateException with 3 inner exception(s)</code></pre>
        <p><strong>An <code>AggregateException</code></strong>, because several items can fail
        simultaneously and there is no single "the" exception. A
        <code>catch (InvalidOperationException)</code> will not match.</p>
        <p><strong>Three here — but that count is not guaranteed.</strong> All three had already
        started when the first threw. Once an item throws, the loop stops handing out new work, so a
        failing item that had not yet started never runs and never appears. With failures spread
        further apart you would see fewer.</p>
        <p><strong>The state of the work is the part that matters operationally: it is partially
        done.</strong> Some items completed, some did not, some never started, and the exception tells
        you nothing about which. If the body has side effects — writes, charges, messages — you must
        either make them idempotent so the whole loop can be retried, or record progress per item so a
        retry can skip what succeeded.</p>
        <pre data-lang="csharp" data-net="10" data-title="Handling it"><code>try
{
    Parallel.ForEach(items, options, Process);
}
catch (AggregateException ex)
{
    // Flatten() matters if the bodies themselves run parallel work.
    foreach (var inner in ex.Flatten().InnerExceptions)
        _logger.LogError(inner, "item failed");
    throw;
}</code></pre>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A service's p95 is fine at low traffic and terrible at moderate traffic. CPU is at 100%, memory
    is flat, no exceptions. Diagnose it, and say how you would distinguish it from the other two
    latency failures in this track.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  concurrent requests   unbounded p95 ms   capped p95 ms
                    1                 13              36
                    4                 51              53
                   16                203             260</code></pre>
        <p><strong>Parallel saturation.</strong> The signature is CPU pinned at 100% with latency
        tracking request <em>count</em>. Each request runs an unbounded parallel section that tries to
        take every core, so N requests contend for the same cores and all of them slow down.</p>
        <p><strong>Distinguishing it from the other two</strong> is the useful skill, and each has a
        distinct fingerprint:</p>
        <pre data-lang="console" data-title="Three latency failures"><code>parallel saturation  : CPU 100%, latency tracks request COUNT
blocking (t2-07)     : CPU IDLE, threads climbing, queue rising
buffering (t2-09)    : memory tracks request SIZE, CPU normal</code></pre>
        <p><strong>CPU usage separates the first two immediately.</strong> Saturation pins it;
        blocking leaves it idle while threads pile up. Reaching for the wrong fix is expensive — adding
        threads to a saturated machine makes it worse, and capping parallelism on a blocked one does
        nothing.</p>
        <p><strong>The fix is a cap, or moving the work out of the request path</strong> — and note
        from the table that capping did <em>not</em> improve p95 on this short, uniform workload. It
        was worse at every concurrency. What it buys is a bound on how much of the machine one request
        can take, so a parallel section cannot starve unrelated endpoints, and predictability when the
        body is longer or more variable. Measure your own workload rather than assuming a cap is a
        latency win.</p>
        <p><strong>The real fix</strong> for a CPU-heavy operation in a request handler is usually to
        get it out of the request handler: accept, enqueue, return 202, and process on a bounded pool
        of workers where the concurrency is a deliberate configuration rather than an accident of
        traffic.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 01-when-parallel-helps.cs -c Release</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-when-parallel-helps.cs"><code>// 01-when-parallel-helps.cs — parallelism is a CPU technique. This measures the
// three things that decide whether it pays: how much work per item, how many
// items, and whether the work is CPU-bound at all.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-when-parallel-helps.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine($"  Environment.ProcessorCount = {Environment.ProcessorCount}");
        Console.WriteLine("  So the ceiling for CPU-bound parallel work is that number. Nothing");
        Console.WriteLine("  in this file can beat it, and most of it will not come close.");

        Console.WriteLine();
        Console.WriteLine("=== 1. work per item decides everything ===");
        Console.WriteLine();
        Console.WriteLine("  100,000 items. The only thing changing is how much CPU each costs.");
        Console.WriteLine();
        Console.WriteLine("  work per item      sequential   Parallel.For   speed-up");

        foreach (var spin in new[] { 0, 1, 10, 100, 1_000 })
        {
            var seq = Time(() =&gt; Sequential(100_000, spin));
            var par = Time(() =&gt; Parallel(100_000, spin));
            Console.WriteLine($"  {Describe(spin),-16}   {seq,10:N0}   {par,12:N0}   {seq / par,8:N2}x");
        }

        Console.WriteLine();
        Console.WriteLine("  The first row is the one to remember: with no work per item,");
        Console.WriteLine("  Parallel.For is SLOWER than a plain loop. The partitioning, the");
        Console.WriteLine("  delegate invocation per item and the coordination cost more than the");
        Console.WriteLine("  work they are distributing.");
        Console.WriteLine();
        Console.WriteLine("  Speed-up rises with work per item and flattens near the processor");
        Console.WriteLine("  count. It never reaches it, because some of the elapsed time is");
        Console.WriteLine("  partitioning rather than work — that is Amdahl's law in one column.");

        Console.WriteLine();
        Console.WriteLine("=== 2. the same work, but I/O-bound ===");
        Console.WriteLine();
        Console.WriteLine("  200 operations that WAIT rather than compute:");
        Console.WriteLine();

        var seqIo = Time(() =&gt; { for (var i = 0; i &lt; 200; i++) Thread.Sleep(10); });
        var parIo = Time(() =&gt; System.Threading.Tasks.Parallel.For(0, 200, _ =&gt; Thread.Sleep(10)));
        var asyncIo = Time(() =&gt; Task.WhenAll(Enumerable.Range(0, 200)
            .Select(_ =&gt; Task.Delay(10))).GetAwaiter().GetResult());

        Console.WriteLine($"    sequential blocking   : {seqIo,8:N0} ms");
        Console.WriteLine($"    Parallel.For blocking : {parIo,8:N0} ms   ({seqIo / parIo:N1}x)");
        Console.WriteLine($"    Task.WhenAll async    : {asyncIo,8:N0} ms   ({seqIo / asyncIo:N1}x)");
        Console.WriteLine();
        Console.WriteLine("  Parallel.For helps here, and it is still the wrong tool. It gets its");
        Console.WriteLine("  speed-up by occupying one thread per concurrent operation — the exact");
        Console.WriteLine("  thing t2-02 measured as starvation. Task.WhenAll gets a larger");
        Console.WriteLine("  speed-up while occupying no threads at all.");
        Console.WriteLine();
        Console.WriteLine("  The rule: Parallel and PLINQ for CPU work, async and WhenAll for I/O.");
        Console.WriteLine("  Using the wrong one is not merely slower; it consumes a resource the");
        Console.WriteLine("  rest of your process needs.");

        Console.WriteLine();
        Console.WriteLine("=== 3. MaxDegreeOfParallelism ===");
        Console.WriteLine();
        Console.WriteLine("  100,000 items of moderate work, capped at N:");
        Console.WriteLine();
        Console.WriteLine("  MaxDegreeOfParallelism     ms   speed-up vs 1");
        var baseline = 0.0;
        foreach (var dop in new[] { 1, 2, 4, 8, 16, 64 })
        {
            var ms = Time(() =&gt; System.Threading.Tasks.Parallel.For(0, 100_000,
                new ParallelOptions { MaxDegreeOfParallelism = dop },
                i =&gt; { Spin(100); }));
            if (dop == 1) baseline = ms;
            Console.WriteLine($"  {dop,22}   {ms,6:N0}   {baseline / ms,10:N2}x");
        }
        Console.WriteLine();
        Console.WriteLine("  Scaling stops at the processor count and does not improve beyond it.");
        Console.WriteLine("  Setting it to 64 on an 8-core machine buys nothing for CPU work and");
        Console.WriteLine("  adds context switching.");
        Console.WriteLine();
        Console.WriteLine("  It is still worth setting, for the opposite reason: to LIMIT");
        Console.WriteLine("  parallelism. The default is unbounded-ish, and inside a web server");
        Console.WriteLine("  every request that runs a Parallel.For competes for the same pool.");
        Console.WriteLine("  A default-configured Parallel.For in a request handler is a way to");
        Console.WriteLine("  let one request consume the whole machine.");

        Console.WriteLine();
        Console.WriteLine("=== 4. PLINQ, and when it is worth the risk ===");
        Console.WriteLine();
        var data = Enumerable.Range(0, 2_000_000).ToArray();

        var linq = Time(() =&gt; { _sink += data.Where(IsInteresting).Sum(x =&gt; (long)x); });
        var plinq = Time(() =&gt; { _sink += data.AsParallel().Where(IsInteresting).Sum(x =&gt; (long)x); });
        Console.WriteLine($"    LINQ                  : {linq,8:N0} ms");
        Console.WriteLine($"    PLINQ                 : {plinq,8:N0} ms   ({linq / plinq:N2}x)");

        var cheapLinq = Time(() =&gt; { _sink += data.Where(x =&gt; x % 2 == 0).Sum(x =&gt; (long)x); });
        var cheapPlinq = Time(() =&gt; { _sink += data.AsParallel().Where(x =&gt; x % 2 == 0).Sum(x =&gt; (long)x); });
        Console.WriteLine($"    LINQ, trivial predicate : {cheapLinq,6:N0} ms");
        Console.WriteLine($"    PLINQ, trivial predicate: {cheapPlinq,6:N0} ms   ({cheapLinq / cheapPlinq:N2}x)");
        Console.WriteLine();
        Console.WriteLine("  Same shape as section 1: PLINQ pays when the per-element work is");
        Console.WriteLine("  large enough to dominate the partitioning, and costs when it is not.");
        Console.WriteLine("  AsParallel() is not a free optimisation you sprinkle on a query.");

        Console.WriteLine();
        Console.WriteLine("=== 5. ordering: what is and is not guaranteed ===");
        Console.WriteLine();
        var unordered = data.AsParallel().Select(x =&gt; x).ToArray();
        var orderedArr = data.AsParallel().AsOrdered().Select(x =&gt; x).ToArray();

        Console.WriteLine($"    plain AsParallel().ToArray() came back in source order : {InOrder(unordered)}");
        Console.WriteLine($"    AsOrdered().ToArray() came back in source order        : {InOrder(orderedArr)}");
        Console.WriteLine();
        Console.WriteLine("  BOTH true — and the first one is NOT a guarantee, which is the point");
        Console.WriteLine("  of this section. An earlier version of this file asserted that plain");
        Console.WriteLine("  AsParallel scrambles the output and printed two identical rows,");
        Console.WriteLine("  proving nothing. For an indexable source consumed with ToArray, PLINQ");
        Console.WriteLine("  reassembles results by partition index and the output usually IS in");
        Console.WriteLine("  order. Relying on that is the trap: it is an implementation detail of");
        Console.WriteLine("  this operator on this source, not a contract.");
        Console.WriteLine();
        Console.WriteLine("  What IS observably unordered is the order elements are PROCESSED:");
        Console.WriteLine();
        var seen = new ConcurrentQueue&lt;int&gt;();
        data.Take(50_000).AsParallel().ForAll(x =&gt; seen.Enqueue(x));
        var processed = seen.ToArray();
        Console.WriteLine($"    first 10 processed      : {string.Join(",", processed.Take(10))}");
        Console.WriteLine($"    processing was in order : {InOrder(processed)}");
        Console.WriteLine();
        Console.WriteLine("  So: side effects inside a PLINQ query happen in an arbitrary order and");
        Console.WriteLine("  on arbitrary threads. Anything order-dependent, and anything writing");
        Console.WriteLine("  to shared state, is a bug — ForAll makes that especially likely");
        Console.WriteLine("  because it exists to run side effects.");
        Console.WriteLine();
        Console.WriteLine("  Use AsOrdered() when you need the RESULT ordered, and do not rely on");
        Console.WriteLine("  incidental ordering. Measure it: on this source it was not slower,");
        Console.WriteLine("  but on a filtered or reshaped query it can be, because PLINQ then has");
        Console.WriteLine("  to buffer to reassemble.");
        Console.WriteLine();
        Console.WriteLine($"  (checksum {_sink})");
    }

    static bool InOrder(int[] a)
    {
        for (var i = 1; i &lt; a.Length; i++) if (a[i] &lt; a[i - 1]) return false;
        return true;
    }

    static bool IsInteresting(int x)
    {
        // Deliberately expensive per element, so partitioning is not the cost.
        var h = x;
        for (var i = 0; i &lt; 40; i++) h = HashCode.Combine(h, i);
        return (h &amp; 1) == 0;
    }

    static string Describe(int spin) =&gt; spin switch
    {
        0 =&gt; "none",
        1 =&gt; "1 spin",
        _ =&gt; $"{spin:N0} spins"
    };

    static void Sequential(int n, int spin)
    {
        long local = 0;
        for (var i = 0; i &lt; n; i++) { Spin(spin); local += i; }
        _sink += local;
    }

    static void Parallel(int n, int spin)
    {
        long total = 0;
        System.Threading.Tasks.Parallel.For(0, n,
            () =&gt; 0L,
            (i, _, local) =&gt; { Spin(spin); return local + i; },
            local =&gt; Interlocked.Add(ref total, local));
        _sink += total;
    }

    static void Spin(int iterations)
    {
        var h = 0;
        for (var i = 0; i &lt; iterations; i++) h = HashCode.Combine(h, i);
        if (h == int.MinValue) _sink++;          // keep the JIT from removing it
    }

    static double Time(Action a)
    {
        a();                                     // warm up and JIT
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var sw = Stopwatch.StartNew();
        a();
        return sw.Elapsed.TotalMilliseconds;
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-production.cs"><code>// 02-production.cs — Ledger's month-end revaluation: a Parallel.ForEach in a
// request handler, and the two separate failures it caused. One was a wrong
// number that nobody noticed for a week.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Revaluation;

public sealed record Position(string Instrument, decimal Quantity, decimal Price);

class Program
{
    const int Positions = 20_000;
    static long _sink;

    static void Main()
    {
        var book = Enumerable.Range(0, Positions)
            .Select(i =&gt; new Position($"INS-{i:D5}", 100 + i % 50, 10.00m + i % 90))
            .ToArray();

        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger revalues a 20,000-position book at month end. The calculation");
        Console.WriteLine("  is pure CPU, so somebody parallelised it. Locally it went from 380 ms");
        Console.WriteLine("  to 70 ms and the change was merged the same afternoon.");
        Console.WriteLine();
        Console.WriteLine("  Two things then went wrong, and only one of them was noticed.");

        Console.WriteLine();
        Console.WriteLine("=== failure 1: the total was wrong ===");
        Console.WriteLine();
        Console.WriteLine("  The shipped version accumulated into a shared field:");
        Console.WriteLine();
        Console.WriteLine("      decimal total = 0;");
        Console.WriteLine("      Parallel.ForEach(book, p =&gt; { total += p.Quantity * p.Price; });");
        Console.WriteLine();
        var correct = Sequential(book);
        Console.WriteLine($"  correct total (sequential)   : {correct,18:N2}");
        Console.WriteLine();
        Console.WriteLine("  run   racy parallel total          difference   correct?");
        for (var run = 0; run &lt; 5; run++)
        {
            var racy = RacyParallel(book);
            Console.WriteLine($"  {run + 1,3}   {racy,22:N2}   {correct - racy,10:N2}   {(racy == correct ? "yes" : "NO")}");
        }
        Console.WriteLine();
        Console.WriteLine("  Different every run, and enormously too low — roughly 85% of the");
        Console.WriteLine("  value is missing. total += x is a read, an add and a write; two");
        Console.WriteLine("  threads read the same value and one write overwrites the other, so");
        Console.WriteLine("  most updates are lost when eight threads contend on every item.");
        Console.WriteLine();
        Console.WriteLine("  The size of the error is worth dwelling on, because intuition gets it");
        Console.WriteLine("  wrong in BOTH directions. People expect either a crash or a rounding-");
        Console.WriteLine("  sized discrepancy. Under heavy contention you get neither: no");
        Console.WriteLine("  exception at all, and an answer that is wrong by most of its value.");
        Console.WriteLine();
        Console.WriteLine("  It is not reliably that large, either, and that is the real hazard.");
        Console.WriteLine("  With fewer threads, less contention, or a cheaper body, the same bug");
        Console.WriteLine("  loses only a handful of updates and produces a total that looks like");
        Console.WriteLine("  a rounding difference — small enough to be reconciled against and");
        Console.WriteLine("  believed. The severity is set by timing, so the same defect can be");
        Console.WriteLine("  invisible in testing and catastrophic in production, or the reverse.");

        Console.WriteLine();
        Console.WriteLine("=== the three correct shapes ===");
        Console.WriteLine();
        Console.WriteLine("  approach                          ms     difference from sequential   identical?");
        Report("sequential", correct, () =&gt; Sequential(book), correct);
        Report("Parallel.ForEach + lock", correct, () =&gt; LockedParallel(book), correct);
        Report("Parallel.ForEach + local state", correct, () =&gt; LocalStateParallel(book), correct);
        Report("PLINQ .Sum()", correct, () =&gt; PlinqSum(book), correct);
        Console.WriteLine();
        Console.WriteLine("  READ THE LAST COLUMN CAREFULLY. All three parallel versions are");
        Console.WriteLine("  CORRECT — no updates are lost — but none is exactly equal to the");
        Console.WriteLine("  sequential total. The difference column shows by how much: far below");
        Console.WriteLine("  a penny, and far above zero.");
        Console.WriteLine();
        Console.WriteLine("  This is not a race. Parallel aggregation adds the numbers in a");
        Console.WriteLine("  different ORDER, and decimal addition is not associative once values");
        Console.WriteLine("  exceed the type precision: (a+b)+c and a+(b+c) can differ in the last");
        Console.WriteLine("  digits. The same is true of double, more strongly.");
        Console.WriteLine();
        Console.WriteLine("  So a test asserting parallel == sequential will FAIL even on correct");
        Console.WriteLine("  code. Assert a tolerance instead, and choose it deliberately: it must");
        Console.WriteLine("  be tight enough to catch a lost update and loose enough to permit");
        Console.WriteLine("  reordering. For money, round at a defined point rather than comparing");
        Console.WriteLine("  raw accumulations at all.");
        Console.WriteLine();
        Console.WriteLine("  LOCK works and is the slowest of the parallel options: every item");
        Console.WriteLine("  contends on one lock, so the parallel section is almost entirely");
        Console.WriteLine("  serialised and you have paid for partitioning to gain nothing.");
        Console.WriteLine();
        Console.WriteLine("  LOCAL STATE is the right shape for Parallel.ForEach. Each partition");
        Console.WriteLine("  accumulates privately, and the per-partition results are combined");
        Console.WriteLine("  once at the end — so the lock is taken a handful of times rather than");
        Console.WriteLine("  20,000 times. That is the overload with the localInit and localFinally");
        Console.WriteLine("  parameters, and it is the reason those parameters exist.");
        Console.WriteLine();
        Console.WriteLine("  PLINQ .Sum() does the same thing and you do not have to write it.");
        Console.WriteLine("  For an aggregation, this is almost always the right answer.");

        Console.WriteLine();
        Console.WriteLine("=== failure 2: it was inside a request handler ===");
        Console.WriteLine();
        Console.WriteLine("  The revaluation ran per request. Locally, one request at a time, it");
        Console.WriteLine("  used all 8 cores and was fast. In production, several accountants");
        Console.WriteLine("  refresh the month-end screen at once.");
        Console.WriteLine();
        Console.WriteLine("  concurrent requests   unbounded p95 ms   capped p95 ms");
        foreach (var concurrent in new[] { 1, 4, 16 })
        {
            var unbounded = ConcurrentRequests(book, concurrent, dop: -1);
            var capped = ConcurrentRequests(book, concurrent, dop: 2);
            Console.WriteLine($"  {concurrent,19}   {unbounded,16:N0}   {capped,13:N0}");
        }
        Console.WriteLine();
        Console.WriteLine("  Read the unbounded column first: p95 rises roughly 16-fold going from");
        Console.WriteLine("  1 to 16 concurrent requests, on work that did not change. Each request");
        Console.WriteLine("  tries to use all 8 cores, so N requests contend for the same 8");
        Console.WriteLine("  processors. The machine is saturated at a concurrency a load balancer");
        Console.WriteLine("  still considers idle.");
        Console.WriteLine();
        Console.WriteLine("  Now the honest part: CAPPING DID NOT IMPROVE p95 HERE. It was worse at");
        Console.WriteLine("  every concurrency. That is a real result and it is worth reporting");
        Console.WriteLine("  rather than explaining away.");
        Console.WriteLine();
        Console.WriteLine("  The reason is that this workload is short and uniform. Oversubscription");
        Console.WriteLine("  costs little when every task takes a similar time and the whole thing");
        Console.WriteLine("  finishes in milliseconds; the scheduler time-slices and the total work");
        Console.WriteLine("  is unchanged. Capping only removes contention that is actually hurting.");
        Console.WriteLine();
        Console.WriteLine("  What capping DOES buy, and what this benchmark cannot show:");
        Console.WriteLine("    - a bound on how much of the machine ONE request can take, so a");
        Console.WriteLine("      parallel section cannot starve unrelated endpoints");
        Console.WriteLine("    - protection when the body is longer or more variable, where");
        Console.WriteLine("      oversubscription does cost real time");
        Console.WriteLine("    - predictability: a known ceiling rather than one that moves with");
        Console.WriteLine("      whatever else the process is doing");
        Console.WriteLine();
        Console.WriteLine("  So the rule is about BOUNDING RESOURCE USE, not about latency. Set it");
        Console.WriteLine("  in a request handler for isolation, and do not expect the p95 of a");
        Console.WriteLine("  microbenchmark to thank you for it. Measure your own workload.");
        Console.WriteLine();
        Console.WriteLine("  The general rule this incident produced: a Parallel.* call inside a");
        Console.WriteLine("  request handler must always set MaxDegreeOfParallelism, because the");
        Console.WriteLine("  default assumes it owns the machine — which is true for a console");
        Console.WriteLine("  tool and false for a server.");

        Console.WriteLine();
        Console.WriteLine("=== how each was found ===");
        Console.WriteLine();
        Console.WriteLine("  The WRONG TOTAL was found by reconciliation, not by monitoring. There");
        Console.WriteLine("  is no counter for 'the answer is 0.02% low'. What would have caught");
        Console.WriteLine("  it earlier:");
        Console.WriteLine("    - a test asserting the parallel and sequential totals are EQUAL,");
        Console.WriteLine("      run over a few thousand items so the race has room to happen");
        Console.WriteLine("    - a code review rule: no assignment to a captured local inside a");
        Console.WriteLine("      Parallel body, ever");
        Console.WriteLine();
        Console.WriteLine("  The SATURATION was visible in ordinary metrics, but only if you know");
        Console.WriteLine("  the shape:");
        Console.WriteLine("    cpu-usage                 pinned at 100%");
        Console.WriteLine("    threadpool-queue-length   rising");
        Console.WriteLine("    p95 latency               rising with CONCURRENCY, not with data size");
        Console.WriteLine();
        Console.WriteLine("  That last line distinguishes it from every other latency problem in");
        Console.WriteLine("  this track. Blocking (t2-07) shows idle CPU. Buffering (t2-09) tracks");
        Console.WriteLine("  request SIZE. Parallel saturation pins the CPU and tracks request");
        Console.WriteLine("  COUNT — and the fix is a cap, not more machines.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static decimal Sequential(Position[] book)
    {
        decimal total = 0;
        foreach (var p in book) total += Value(p);
        return total;
    }

    /// &lt;summary&gt;THE BUG. A shared accumulator with no synchronisation.&lt;/summary&gt;
    static decimal RacyParallel(Position[] book)
    {
        decimal total = 0;
        System.Threading.Tasks.Parallel.ForEach(book, p =&gt; { total += Value(p); });
        return total;
    }

    /// &lt;summary&gt;Correct, and slow: 20,000 lock acquisitions.&lt;/summary&gt;
    static decimal LockedParallel(Position[] book)
    {
        decimal total = 0;
        var gate = new object();
        System.Threading.Tasks.Parallel.ForEach(book, p =&gt;
        {
            var v = Value(p);
            lock (gate) { total += v; }
        });
        return total;
    }

    /// &lt;summary&gt;Correct and fast: private accumulation, combined once per partition.&lt;/summary&gt;
    static decimal LocalStateParallel(Position[] book)
    {
        decimal total = 0;
        var gate = new object();
        System.Threading.Tasks.Parallel.ForEach(
            book,
            () =&gt; 0m,                                        // localInit
            (p, _, local) =&gt; local + Value(p),               // body
            local =&gt; { lock (gate) { total += local; } });   // localFinally
        return total;
    }

    static decimal PlinqSum(Position[] book) =&gt; book.AsParallel().Sum(Value);

    static decimal Value(Position p)
    {
        // Enough work per item that parallelism is worth considering at all.
        var q = p.Quantity;
        for (var i = 0; i &lt; 60; i++) q = q * 1.0000001m;
        return q * p.Price;
    }

    static void Report(string label, decimal correct, Func&lt;decimal&gt; run, decimal expected)
    {
        run();
        var sw = Stopwatch.StartNew();
        var value = run();
        sw.Stop();
        var diff = value - expected;
        Console.WriteLine($"  {label,-30} {sw.Elapsed.TotalMilliseconds,6:N0}   {diff.ToString("G29"),26}   " +
                          $"{(value == expected ? "yes" : "no")}");
    }

    static double ConcurrentRequests(Position[] book, int concurrent, int dop)
    {
        var options = new ParallelOptions { MaxDegreeOfParallelism = dop };
        var latencies = new double[concurrent];

        var threads = new Thread[concurrent];
        var start = new ManualResetEventSlim(false);
        for (var i = 0; i &lt; concurrent; i++)
        {
            var idx = i;
            threads[i] = new Thread(() =&gt;
            {
                start.Wait();
                var sw = Stopwatch.StartNew();
                decimal total = 0;
                var gate = new object();
                System.Threading.Tasks.Parallel.ForEach(book, options,
                    () =&gt; 0m,
                    (p, _, local) =&gt; local + Value(p),
                    local =&gt; { lock (gate) { total += local; } });
                _sink += (long)total;
                latencies[idx] = sw.Elapsed.TotalMilliseconds;
            }) { IsBackground = true };
            threads[i].Start();
        }

        start.Set();
        foreach (var t in threads) t.Join();

        Array.Sort(latencies);
        return latencies[Math.Max(0, (int)(concurrent * 0.95) - 1)];
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-exercises.cs"><code>// 03-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: will Parallel.For help? =====");
        Console.WriteLine();
        Console.WriteLine("  Three loops over 200,000 items. Predict which get faster.");
        Console.WriteLine();
        Console.WriteLine("  body                       sequential   parallel   speed-up");
        Compare("i =&gt; sum += i", 0);
        Compare("20 hash combines", 20);
        Compare("2,000 hash combines", 2_000);
        Console.WriteLine();
        Console.WriteLine("  Only the third is worth parallelising. The first is SLOWER in");
        Console.WriteLine("  parallel: the per-item delegate call and the partitioning cost more");
        Console.WriteLine("  than an addition. Parallelism has a fixed overhead that the work per");
        Console.WriteLine("  item must exceed before anything is gained.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: find the bug =====");
        Console.WriteLine();
        Console.WriteLine("      var results = new List&lt;int&gt;();");
        Console.WriteLine("      Parallel.For(0, 10_000, i =&gt; results.Add(i));");
        Console.WriteLine();
        for (var run = 0; run &lt; 3; run++)
            Console.WriteLine($"    run {run + 1}: {UnsafeList()}");
        Console.WriteLine();
        Console.WriteLine("  List&lt;T&gt; is not thread-safe. Add() increments a count and writes an");
        Console.WriteLine("  array slot non-atomically, so concurrent calls overwrite each other.");
        Console.WriteLine("  Roughly half the items were lost, and the count differed every run.");
        Console.WriteLine();
        Console.WriteLine("  Losing items is only the outcome that happened HERE. The same code");
        Console.WriteLine("  can also throw IndexOutOfRangeException from inside the resize, or");
        Console.WriteLine("  leave null entries, depending on where a thread is interrupted.");
        Console.WriteLine("  Which one you get depends on timing, so a test that passes proves");
        Console.WriteLine("  nothing about the next run.");
        Console.WriteLine();
        Console.WriteLine("  Three fixes, and they are not equivalent:");
        Console.WriteLine($"    lock around Add           : {LockedList()}");
        Console.WriteLine($"    ConcurrentBag&lt;T&gt;          : {BagList()}");
        Console.WriteLine($"    PLINQ .Select().ToArray() : {PlinqList()}");
        Console.WriteLine();
        Console.WriteLine("  Prefer the third. Locking serialises the very thing you parallelised;");
        Console.WriteLine("  a concurrent collection is better but still coordinates per item.");
        Console.WriteLine("  Producing a result rather than mutating shared state avoids the");
        Console.WriteLine("  problem instead of managing it.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: is the total correct? =====");
        Console.WriteLine();
        var values = Enumerable.Range(1, 100_000).Select(i =&gt; (decimal)i / 7m).ToArray();
        var seq = values.Aggregate(0m, (a, b) =&gt; a + b);
        var racy = RacySum(values);
        var local = LocalSum(values);
        var plinq = values.AsParallel().Sum();
        Console.WriteLine($"    sequential      : {seq,22:N6}");
        Console.WriteLine($"    racy parallel   : {racy,22:N6}   {(racy == seq ? "equal" : "WRONG")}");
        Console.WriteLine($"    local state     : {local,22:N6}   {(local == seq ? "equal" : "differs")}");
        Console.WriteLine($"    PLINQ Sum()     : {plinq,22:N6}   {(plinq == seq ? "equal" : "differs")}");
        Console.WriteLine($"    local  - seq    : {(local - seq).ToString("G29"),22}");
        Console.WriteLine($"    PLINQ  - seq    : {(plinq - seq).ToString("G29"),22}");
        Console.WriteLine();
        Console.WriteLine("  Two different things are happening and they must not be confused.");
        Console.WriteLine();
        Console.WriteLine("  The RACY version is a bug: updates are lost and the answer can be");
        Console.WriteLine("  wrong by any amount.");
        Console.WriteLine();
        Console.WriteLine("  The correct parallel versions may still differ from sequential in the");
        Console.WriteLine("  final digits, because they ADD IN A DIFFERENT ORDER and decimal");
        Console.WriteLine("  addition is not associative at the limits of the type's precision.");
        Console.WriteLine("  That is not a bug; it is arithmetic.");
        Console.WriteLine();
        Console.WriteLine("  Consequence for testing: asserting parallel == sequential is wrong,");
        Console.WriteLine("  because it fails on correct code. Assert a tolerance that is tight");
        Console.WriteLine("  enough to catch a lost update and loose enough to allow reordering.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: CPU or I/O? =====");
        Console.WriteLine();
        Console.WriteLine("  100 operations that wait 10 ms each:");
        var s1 = Time(() =&gt; { for (var i = 0; i &lt; 100; i++) Thread.Sleep(10); });
        var s2 = Time(() =&gt; Parallel.For(0, 100, _ =&gt; Thread.Sleep(10)));
        var s3 = Time(() =&gt; Task.WhenAll(Enumerable.Range(0, 100).Select(_ =&gt; Task.Delay(10)))
                              .GetAwaiter().GetResult());
        Console.WriteLine($"    sequential blocking : {s1,7:N0} ms");
        Console.WriteLine($"    Parallel.For        : {s2,7:N0} ms   ({s1 / s2:N1}x)");
        Console.WriteLine($"    Task.WhenAll        : {s3,7:N0} ms   ({s1 / s3:N1}x)");
        Console.WriteLine();
        Console.WriteLine("  Parallel.For does speed it up, and is still wrong. Its speed-up comes");
        Console.WriteLine("  from occupying one thread per operation, which is thread pool");
        Console.WriteLine("  starvation by another name (t2-02). Task.WhenAll is faster and");
        Console.WriteLine("  occupies no threads while waiting.");
        Console.WriteLine();
        Console.WriteLine("  Parallel and PLINQ for CPU. async and WhenAll for I/O. The failure");
        Console.WriteLine("  mode of getting this backwards is not slowness — it is consuming a");
        Console.WriteLine("  shared resource the rest of the process needs.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: exceptions =====");
        Console.WriteLine();
        Console.WriteLine($"    Parallel.For, 3 of 100 throw : {ParallelExceptions()}");
        Console.WriteLine($"    PLINQ, 3 of 100 throw        : {PlinqExceptions()}");
        Console.WriteLine();
        Console.WriteLine("  Both wrap failures in AggregateException, because several items can");
        Console.WriteLine("  fail at once and there is no single (the) exception. Here all three");
        Console.WriteLine("  failures were collected, because all three had already started by");
        Console.WriteLine("  the time the first one threw.");
        Console.WriteLine();
        Console.WriteLine("  That count is NOT guaranteed. Once an item throws, the loop stops");
        Console.WriteLine("  handing out new work, so a failing item that had not yet started");
        Console.WriteLine("  never runs and never appears. Do not write code that depends on");
        Console.WriteLine("  receiving every failure.");
        Console.WriteLine();
        Console.WriteLine("  Practical consequences:");
        Console.WriteLine("    - catch AggregateException and inspect InnerExceptions, or call");
        Console.WriteLine("      Flatten() first if the bodies themselves aggregate");
        Console.WriteLine("    - the work is PARTIALLY DONE and you cannot tell which parts from");
        Console.WriteLine("      the exception alone; design for idempotency or record progress");
        Console.WriteLine("    - a single catch (Exception) around the loop will not see the");
        Console.WriteLine("      original exception type, which breaks type-based handling");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // --- Exercise 1 -----------------------------------------------------------
    static void Compare(string label, int spin)
    {
        var seq = Time(() =&gt; { long t = 0; for (var i = 0; i &lt; 200_000; i++) { Spin(spin); t += i; } _sink += t; });
        var par = Time(() =&gt;
        {
            long t = 0;
            Parallel.For(0, 200_000, () =&gt; 0L, (i, _, local) =&gt; { Spin(spin); return local + i; },
                         local =&gt; Interlocked.Add(ref t, local));
            _sink += t;
        });
        Console.WriteLine($"  {label,-26} {seq,10:N0}   {par,8:N0}   {seq / par,8:N2}x");
    }

    // --- Exercise 2 -----------------------------------------------------------
    static string UnsafeList()
    {
        try
        {
            var results = new List&lt;int&gt;();
            Parallel.For(0, 10_000, i =&gt; results.Add(i));
            return results.Count == 10_000
                ? $"{results.Count} items (correct this time, by luck)"
                : $"{results.Count} of 10,000 items — LOST {10_000 - results.Count}";
        }
        catch (AggregateException ex)
        {
            return $"threw {ex.InnerExceptions[0].GetType().Name}";
        }
    }

    static string LockedList()
    {
        var results = new List&lt;int&gt;();
        var gate = new object();
        Parallel.For(0, 10_000, i =&gt; { lock (gate) { results.Add(i); } });
        return $"{results.Count} items";
    }

    static string BagList()
    {
        var bag = new ConcurrentBag&lt;int&gt;();
        Parallel.For(0, 10_000, i =&gt; bag.Add(i));
        return $"{bag.Count} items";
    }

    static string PlinqList()
    {
        var arr = Enumerable.Range(0, 10_000).AsParallel().Select(i =&gt; i).ToArray();
        return $"{arr.Length} items";
    }

    // --- Exercise 3 -----------------------------------------------------------
    static decimal RacySum(decimal[] values)
    {
        decimal total = 0;
        Parallel.ForEach(values, v =&gt; { total += v; });
        return total;
    }

    static decimal LocalSum(decimal[] values)
    {
        decimal total = 0;
        var gate = new object();
        Parallel.ForEach(values, () =&gt; 0m, (v, _, local) =&gt; local + v,
                         local =&gt; { lock (gate) { total += local; } });
        return total;
    }

    // --- Exercise 5 -----------------------------------------------------------
    static string ParallelExceptions()
    {
        try
        {
            Parallel.For(0, 100, i =&gt;
            {
                if (i is 10 or 50 or 90) throw new InvalidOperationException($"item {i}");
                Spin(200);
            });
            return "did not throw";
        }
        catch (AggregateException ex)
        {
            return $"AggregateException with {ex.InnerExceptions.Count} inner exception(s)";
        }
    }

    static string PlinqExceptions()
    {
        try
        {
            var _ = Enumerable.Range(0, 100).AsParallel().Select(i =&gt;
            {
                if (i is 10 or 50 or 90) throw new InvalidOperationException($"item {i}");
                Spin(200);
                return i;
            }).ToArray();
            return "did not throw";
        }
        catch (AggregateException ex)
        {
            return $"AggregateException with {ex.InnerExceptions.Count} inner exception(s)";
        }
    }

    // --- helpers --------------------------------------------------------------
    static void Spin(int n)
    {
        var h = 0;
        for (var i = 0; i &lt; n; i++) h = HashCode.Combine(h, i);
        if (h == int.MinValue) _sink++;
    }

    static double Time(Action a)
    {
        a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var sw = Stopwatch.StartNew();
        a();
        return sw.Elapsed.TotalMilliseconds;
    }
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is the difference between concurrency and parallelism?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Concurrency is several operations <strong>in progress</strong>; parallelism is several
        <strong>executing</strong> at once on different cores. Parallelism needs cores and is bounded
        by them; concurrency is not — a thousand waiting operations can share one thread.</p>
      </div></details>
    </li>
    <li>
      <p>What decides whether <code>Parallel.For</code> helps?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The work per item, against a fixed partitioning overhead. Measured on one machine:
        <strong>0.33× for a trivial body, 5.55× for a heavy one</strong>. There is no rule of thumb;
        measure.</p>
      </div></details>
    </li>
    <li>
      <p>Which tool for CPU work, and which for I/O?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Parallel</code>/PLINQ for CPU; <code>async</code>/<code>Task.WhenAll</code> for I/O.
        Measured on identical I/O work: <strong>8.5× against 214×</strong> — and
        <code>Parallel.For</code> bought its gain by blocking one pool thread per operation. Use
        <code>Parallel.ForEachAsync</code> when you need async plus a concurrency limit.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>total += x</code> unsafe in a parallel body?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It is a read, an add and a write. Two threads read the same value and one write overwrites
        the other, so an addition is lost. Measured: <strong>85% of a valuation missing</strong>, with
        no exception and a different figure every run.</p>
      </div></details>
    </li>
    <li>
      <p>What is the correct shape for a parallel aggregation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>AsParallel().Sum()</code>, or the <code>localInit</code>/<code>localFinally</code>
        overload where each partition accumulates privately and results are combined once. A lock
        around every item works but serialises the parallel section.</p>
      </div></details>
    </li>
    <li>
      <p>Your parallel sum differs from the sequential one in the 18th decimal place. Is that a
      race?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. Parallel aggregation adds in a different order, and decimal addition is not associative
        at the type's precision limit — measured at around <strong>10<sup>-18</sup></strong>. A lost
        update is enormous. Test with a tolerance between the two scales, never with exact
        equality.</p>
      </div></details>
    </li>
    <li>
      <p>Why set <code>MaxDegreeOfParallelism</code> in a server?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>To <strong>bound resource use</strong>, not for latency — measured, capping did not improve
        p95 on a short uniform workload. The default assumes the process owns the machine, which is
        false for a server where every concurrent request runs its own loop.</p>
      </div></details>
    </li>
    <li>
      <p>Does PLINQ preserve order?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No guarantee, though it frequently appears to — verified, a plain
        <code>AsParallel().ToArray()</code> came back in source order. Processing order is definitively
        arbitrary. Use <code>AsOrdered()</code> if you need it and re-measure, because reassembly can
        remove the benefit.</p>
      </div></details>
    </li>
    <li>
      <p>What does a parallel loop throw, and what is the state of the work?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>AggregateException</code> — so a type-based catch will not match. The count is not
        necessarily every failure, because the loop stops scheduling after the first throw. The work is
        <strong>partially complete</strong> and the exception says nothing about which parts; design for
        idempotency or record progress.</p>
      </div></details>
    </li>
    <li>
      <p>How do you tell parallel saturation from blocking and from buffering?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Saturation: <strong>CPU 100%</strong>, latency tracks request <em>count</em>. Blocking:
        <strong>CPU idle</strong>, thread count and queue rising. Buffering: memory tracks request
        <em>size</em>, CPU normal. CPU usage separates the first two immediately, and applying the
        wrong fix makes things worse.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
