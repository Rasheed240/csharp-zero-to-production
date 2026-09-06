CSPREP.module({
  id: "t2-13-interlocked-and-lockfree",
  minutes: 55,
  updated: "2026-08-31",
  summary: "Interlocked makes one memory location indivisible, and almost every misuse comes from assuming it does more. Ledger removed a lock on a profiler's advice, kept every total exactly correct, and produced impossible means on a dashboard in 30 of 30 trials. The measured answer to whether lock-free is faster is yes for a single counter and no for nearly everything else - the lock-free fix here ran several times slower than the lock it replaced, with 3.4 million CAS retries.",
  terms: ["Interlocked", "atomic", "compare-and-swap", "CompareExchange", "CAS loop", "lock-free",
    "torn read", "immutable snapshot", "ABA problem", "Volatile.Read", "spin", "retry count"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger records a latency figure for every request and shows the mean on a dashboard. The
  original used a lock. A profiler ran, that lock appeared at the top of a contention report, and
  somebody removed it:</p>

  <pre data-lang="csharp" data-net="10" data-title="Stats.cs — the change that was merged"><code>public void Record(long micros)
{
    Interlocked.Increment(ref _count);
    Interlocked.Add(ref _totalMicros, micros);
}</code></pre>

  <p>Every operation is now atomic. There is no lost update — measured, the count and the total are
  both exactly right at the end of every run. No test failed. The profiler confirmed the contention
  had gone.</p>

  <p>The dashboard began showing means below the fastest request the service had ever served.
  Impossible values, appearing for a few seconds and then correcting themselves.</p>

  <p>The defect is not in <code>Record</code>. It is in the reader, which takes the count and then
  the total — and a writer can complete <em>both</em> of its updates in between, so the reader
  divides a newer total by an older count. Measured: <strong>a reader saw an impossible mean in 30 of
  30 trials.</strong></p>

  <p>This module is about the one guarantee <code>Interlocked</code> provides, the much larger set of
  things people assume it provides, and the measured answer to "is lock-free faster" — which is
  <strong>yes for a single counter and no for almost everything else</strong>: the lock-free version
  of the fix above measured several times <em>slower</em> than a plain lock.</p>
</section>

<section id="plain-language">
  <h2>What atomic means</h2>

  <p class="define"><span class="define__term">Thread</span> An independent sequence of instructions
  the operating system can run. Two threads in one process share memory, which is why any of this is
  necessary.</p>

  <p class="define"><span class="define__term">Atomic</span> Indivisible — an operation that no other
  thread can observe partway through. It either has not happened or has fully happened, with no
  visible middle.</p>

  <p class="define"><span class="define__term">Interlocked</span> A class of operations the
  <em>processor</em> makes atomic, on a single memory location. Not a lock: there is no waiting, no
  owner, and nothing to release.</p>

  <p class="define"><span class="define__term">Compare-and-swap</span> Usually written CAS. The
  operation "if this location still holds the value I expect, replace it; either way tell me what it
  held". The comparison and the replacement are one indivisible instruction, and every lock-free
  algorithm is built from it.</p>

  <p class="define"><span class="define__term">Lock-free</span> A design where threads coordinate
  through atomic operations rather than exclusion, so no thread can block another indefinitely. It
  does not mean "faster", and it does not mean "no waiting" — losers in a CAS loop retry, which is
  its own kind of waiting.</p>

  <p><strong>An analogy, and its limits.</strong> A lock is a key to a room: you take it, others
  queue. A CAS is a bet on a shared noticeboard: you read what is pinned there, write a replacement,
  and pin it <em>only if nobody has changed it since you looked</em>. If someone has, you tear up
  your note and start again from what is now pinned.</p>

  <p><strong>Where the analogy breaks:</strong> tearing up the note is not free. Under heavy
  contention most people are tearing up notes most of the time, doing the work repeatedly and
  discarding it. A queue for a key is often the cheaper arrangement — which is exactly what the
  measurements in this module show.</p>

  <h3>The operations, and what each returns</h3>

  <pre data-lang="console" data-title="01-atomics.cs"><code>  start                       v = 10
  Increment returns the NEW   : 11   (v = 11)
  Decrement returns the NEW   : 10   (v = 10)
  Add(5) returns the NEW      : 15   (v = 15)
  Exchange(99) returns the OLD: 15   (v = 99)</code></pre>

  <p><strong>Note the asymmetry, because it is deliberate.</strong> <code>Increment</code>,
  <code>Decrement</code> and <code>Add</code> return the value <em>after</em>;
  <code>Exchange</code> and <code>CompareExchange</code> return the value <em>before</em>. The
  before-value is the only thing that tells you whether <em>you</em> were the thread that made the
  change — and that question is the foundation of everything lock-free.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-minimal-example.cs"><code>// 04-minimal-example.cs — the smallest program showing what Interlocked fixes
// and what it does not.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Threading;

class Program
{
    static int _plain;
    static int _atomic;
    static long _count, _total;

    static void Main()
    {
        // What Interlocked fixes: one location, one operation.
        Run(() =&gt; { _plain++; Interlocked.Increment(ref _atomic); });
        Console.WriteLine($"plain  ++ : {_plain,7:N0} of 800,000   {(_plain == 800_000 ? "correct" : "WRONG")}");
        Console.WriteLine($"atomic ++ : {_atomic,7:N0} of 800,000   {(_atomic == 800_000 ? "correct" : "WRONG")}");

        // What it does not fix: two locations that must agree.
        var torn = false;
        var stop = new CancellationTokenSource();
        var writer = new Thread(() =&gt;
        {
            while (!stop.IsCancellationRequested)
            {
                Interlocked.Increment(ref _count);          // atomic
                Interlocked.Add(ref _total, 1_000);         // atomic
            }
        }) { IsBackground = true };
        var reader = new Thread(() =&gt;
        {
            while (!stop.IsCancellationRequested)
            {
                var c = Volatile.Read(ref _count);
                var t = Volatile.Read(ref _total);
                if (c &gt; 0 &amp;&amp; t / c != 1_000) { torn = true; return; }   // impossible mean
            }
        }) { IsBackground = true };

        writer.Start(); reader.Start();
        Thread.Sleep(50);
        stop.Cancel();
        writer.Join(500); reader.Join(500);

        Console.WriteLine($"both atomic, reader saw an impossible mean : {torn}");
        Console.WriteLine("Atomic is not transactional: two atomic writes are still two writes.");
    }

    static void Run(Action body)
    {
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        for (var t = 0; t &lt; 8; t++)
        {
            threads[t] = new Thread(() =&gt; { ready.Wait(); for (var i = 0; i &lt; 100_000; i++) body(); });
            threads[t].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>plain  ++ : 275,673 of 800,000   WRONG
atomic ++ : 800,000 of 800,000   correct
both atomic, reader saw an impossible mean : True
Atomic is not transactional: two atomic writes are still two writes.</code></pre>

  <p>The first two lines are what <code>Interlocked</code> is for. <code>x++</code> is a load, an add
  and a store, so eight threads lose most of the increments
  (<a href="#/m/t2-11-race-conditions">t2-11</a>). <code>Interlocked.Increment</code> is a single
  processor instruction that cannot be interrupted between its read and its write, so nothing is
  lost.</p>

  <p><strong>The third line is the one worth carrying.</strong> Two <em>atomic</em> operations, and a
  reader still observed a value that cannot exist. Both writes are individually indivisible; the pair
  is not.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Atomic is not transactional.</strong> <code>Interlocked</code> makes <em>one memory
    location</em> indivisible. "These two fields always agree with each other" is a different
    property, and no sequence of <code>Interlocked</code> calls provides it.</p>
    <p>This is the most common misuse of the whole API: reaching for <code>Interlocked</code> to
    avoid a lock, on state that needed the lock.</p>
  </div>
</section>

<section id="cas">
  <h2><code>CompareExchange</code>, and the loop built on it</h2>

  <pre data-lang="csharp" data-net="10" data-title="The signature that matters"><code>// "If location currently equals comparand, store newValue.
//  Either way, return what location held before."
int CompareExchange(ref int location, int newValue, int comparand);</code></pre>

  <pre data-lang="console" data-title="01-atomics.cs"><code>  CAS(slot, 42, expecting 5)  returned 5, slot = 42   -&gt; we won
  CAS(slot, 99, expecting 5)  returned 42, slot = 42   -&gt; we lost</code></pre>

  <p><strong>You detect success by comparing the return value to your comparand</strong>, not by
  reading the location afterwards. Reading afterwards is a second operation, and another thread may
  have moved it again in between:</p>

  <pre data-lang="csharp" data-net="10" data-title="The idiom"><code>if (Interlocked.CompareExchange(ref x, next, expected) == expected)
{
    // This thread performed the update. Nobody else did it for us.
}</code></pre>

  <p><code>Interlocked</code> has no <code>Multiply</code>, no <code>Max</code>, and no "update via a
  function". You build those from a retry loop:</p>

  <pre data-lang="csharp" data-net="10" data-title="The CAS loop, which is the whole technique"><code>long current, next;
do
{
    current = Volatile.Read(ref location);     // re-read EVERY time
    next = Compute(current);
}
while (Interlocked.CompareExchange(ref location, next, current) != current);</code></pre>

  <p><strong>The read must be inside the loop.</strong> A failed CAS means somebody changed the
  value, so retrying with the stale <code>current</code> would either fail forever or clobber their
  update. Re-reading is what makes the loop converge rather than spin.</p>

  <h3>What a CAS loop costs</h3>

  <pre data-lang="console" data-title="01-atomics.cs — 8 threads, 20,000 iterations each"><code>  workload                       result        CAS retries
  lock-free Max, 8 threads        999,999              0
  lock-free Sum, 8 threads        160,000        183,628</code></pre>

  <p><strong>The contrast between those two rows is the cost model</strong>, and it is not what most
  people expect.</p>

  <p><strong>Max retried zero times.</strong> After a few hundred iterations the running maximum is
  close to its final value, so nearly every thread reads it, sees its own candidate is smaller, and
  never attempts a swap at all. A CAS loop over a value that <em>converges</em> is close to free.</p>

  <p><strong>Sum retried more times than there were operations.</strong> Every thread must swap on
  every iteration, so eight threads collide continuously and the losers recompute and try again. Each
  retry is wasted work that a lock would not have done — under a lock, a loser waits once and then
  proceeds.</p>

  <p>So the question to ask before writing a CAS loop is not "is this faster than a lock". It is
  <strong>"how often will two threads actually collide on this location?"</strong> Rarely, and it is
  excellent. Constantly, and it is worse than the lock you were avoiding.</p>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>The statistics class from the opening, in three versions:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the shipped version"><code>/// &lt;summary&gt;
/// THE SHIPPED VERSION. Both updates are atomic, so it "has no race" — and the
/// pair of them is not atomic, so a reader can divide a new sum by an old count.
/// &lt;/summary&gt;
public sealed class StatsV1
{
    private long _count;
    private long _totalMicros;

    public void Record(long micros)
    {
        Interlocked.Increment(ref _count);
        Interlocked.Add(ref _totalMicros, micros);
    }

    public double MeanMicros()
    {
        var count = Volatile.Read(ref _count);
        var total = Volatile.Read(ref _totalMicros);
        return count == 0 ? 0 : (double)total / count;
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right, and obvious: one lock covering both fields"><code>/// &lt;summary&gt;THE OBVIOUS FIX. One lock around both fields, for readers and writers.&lt;/summary&gt;
public sealed class StatsV2
{
    private readonly Lock _gate = new();
    private long _count;
    private long _totalMicros;

    public void Record(long micros)
    {
        lock (_gate) { _count++; _totalMicros += micros; }
    }

    public double MeanMicros()
    {
        lock (_gate) { return _count == 0 ? 0 : (double)_totalMicros / _count; }
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Also right, and lock-free: one immutable object, one swap"><code>/// &lt;summary&gt;
/// THE LOCK-FREE FIX. Both fields live in one immutable object, and the whole
/// object is swapped with a single CompareExchange. A reader sees one snapshot
/// or another, never a mixture.
/// &lt;/summary&gt;
public sealed class StatsV3
{
    private sealed record Snapshot(long Count, long TotalMicros);

    private Snapshot _current = new(0, 0);
    private int _retries;

    public int Retries =&gt; Volatile.Read(ref _retries);

    public void Record(long micros)
    {
        while (true)
        {
            var observed = Volatile.Read(ref _current);
            var next = new Snapshot(observed.Count + 1, observed.TotalMicros + micros);
            if (Interlocked.CompareExchange(ref _current, next, observed) == observed) return;
            Interlocked.Increment(ref _retries);
        }
    }

    public double MeanMicros()
    {
        var s = Volatile.Read(ref _current);          // one read, one consistent pair
        return s.Count == 0 ? 0 : (double)s.TotalMicros / s.Count;
    }
}</code></pre>

  <p>Every recorded value in the test is exactly 1,000 microseconds, so a correct mean is always
  1,000. Any other value a reader observes is a torn read that no rounding argument can explain:</p>

  <pre data-lang="console" data-title="02-production.cs"><code>  implementation        final totals   reader saw a torn mean
  Interlocked pair (V1)  correct        30 of 30
  lock (V2)              correct        0 of 30
  CAS on a snapshot (V3) correct        0 of 30</code></pre>

  <p><strong>V1's totals are always correct and its reads never are.</strong> That combination is what
  made it survive: every test asserting on the final count and sum passes.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Four separate things conspired to hide this, and each of them is common.</p>
    <p><strong>Nothing throws and no total is wrong.</strong> There is no exception, no counter, and
    no failing assertion anywhere.</p>
    <p><strong>It is a read bug in code whose writes were the suspicious part.</strong> Review
    attention went to <code>Record</code>, which is correct. The defect is in
    <code>MeanMicros</code>, which looks like it does nothing.</p>
    <p><strong>It self-corrects.</strong> The next read is almost always right, so the graph shows a
    spike that has already gone by the time anyone opens it.</p>
    <p><strong>The change was justified by a profiler.</strong> Removing the lock genuinely did remove
    the contention. The profiler was not wrong — it was answering a different question from the one
    that mattered, and its authority carried the change through review.</p>
  </div>

  <h3>Which fix to ship</h3>

  <pre data-lang="console" data-title="02-production.cs"><code>  time for the LOCK, relative to the lock-free version :  0.29x
  CAS retries incurred by the lock-free version        :  3,397,692</code></pre>

  <p><strong>That ratio is below one: the lock is several times faster than the lock-free
  version.</strong> The exact multiple moves between runs — it has measured from twice to three and a
  half times — but the direction does not move.</p>

  <p>Millions of retries is why. Every writer that loses the race allocates a new snapshot,
  recomputes and tries again, and with eight threads contending on one reference most of them lose
  most of the time. The lock has no retries at all.</p>

  <p><strong>Ship the lock unless you have a measurement saying otherwise.</strong> The lock-free
  version is correct, and being correct without a lock cost an allocation per recorded value, a retry
  loop, and a reviewer who has to understand why the snapshot must be immutable.</p>

  <p>The snapshot version earns its place in one situation: <strong>when reads massively outnumber
  writes</strong>. Its readers take no lock at all — a single volatile read of a reference — so a
  dashboard scraping thousands of times a second never contends with recording. That is a real
  scenario, and it is narrower than the people who reach for it believe.</p>

  <h3>The pattern worth remembering</h3>

  <p><code>Interlocked</code> protects one location. So <strong>make the thing you need to update
  atomically into one location</strong>:</p>

  <pre data-lang="csharp" data-net="10" data-title="Move the invariant inside one object"><code>private sealed record Snapshot(long Count, long Total);   // immutable
private Snapshot _current = new(0, 0);                    // one reference

var observed = Volatile.Read(ref _current);
var next = new Snapshot(observed.Count + 1, observed.Total + value);
if (Interlocked.CompareExchange(ref _current, next, observed) == observed) return;
// otherwise: re-read and try again</code></pre>

  <p>The snapshot <strong>must be immutable</strong>. If a reader could mutate what it read, or if the
  record held a mutable array, the guarantee evaporates — you would be publishing a reference to
  state that can still change underneath you.</p>

  <p>This is the same shape as an immutable configuration object swapped on reload, and as a
  copy-on-write collection. In each case the trick is identical: move the invariant inside a single
  object so that one atomic reference swap publishes all of it at once.</p>

  <h3>How it was diagnosed</h3>

  <p>No exception, no counter, no dump. What found it was the technique from
  <a href="#/m/t2-11-race-conditions">t2-11</a> — assert the invariant continuously, where the value
  actually is:</p>

  <pre data-lang="csharp" data-net="10" data-title="The only detector that exists"><code>var mean = _stats.MeanMicros();
if (mean &gt; 0 &amp;&amp; mean &lt; FastestObservedRequestMicros)
    _logger.LogError("impossible mean {Mean} over {Count} samples", mean, count);</code></pre>

  <p>A race on a <em>derived</em> value leaves no runtime trace at all. The only detector is a check
  that knows what the value is allowed to be — which means someone has to state the invariant
  explicitly, in code, before the incident rather than during it.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Two atomic operations treated as one</h3>

  <p>The module's central bug. Measured at 30 of 30 trials producing a torn read. If two fields must
  agree, use a lock or put both in one immutable object.</p>

  <h3>2. Reading the location instead of the return value</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a second read is a second operation"><code>// WRONG. Between the CAS and the read, another thread may have changed x again,
// so this can report failure when we succeeded, or success when we did not.
Interlocked.CompareExchange(ref x, next, expected);
if (x == next) { /* we won */ }

// Right: the return value is the before-value, captured atomically.
if (Interlocked.CompareExchange(ref x, next, expected) == expected) { /* we won */ }</code></pre>

  <h3>3. Hoisting the read out of the CAS loop</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: retries with a stale value"><code>// WRONG. On a failed CAS this retries with the same stale 'current', so it
// either spins forever or overwrites the other thread's update.
var current = Volatile.Read(ref total);
long next;
do { next = current + 1; }
while (Interlocked.CompareExchange(ref total, next, current) != current);

// Right: re-read inside the loop.
long current, next;
do
{
    current = Volatile.Read(ref total);
    next = current + 1;
}
while (Interlocked.CompareExchange(ref total, next, current) != current);</code></pre>

  <h3>4. A CAS loop over a mutable object</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: publishing a reference to changing state"><code>// WRONG. The swap is atomic and the object is not. Another thread holding the
// same reference can mutate Items after the swap, so readers see a snapshot
// that changes underneath them.
sealed class Stats { public long Count; public List&lt;long&gt; Items = new(); }

// Right: the swapped object must be immutable all the way down.
sealed record Stats(long Count, ImmutableArray&lt;long&gt; Items);</code></pre>

  <h3>5. Assuming lock-free is faster</h3>

  <p>Measured: the lock-free statistics writer was <em>several times slower</em> than a lock, with
  3.4 million retries. Lock-free wins for a single location updated by a single instruction and
  frequently loses everywhere else.</p>

  <h3>6. Using <code>Interlocked</code> on <code>double</code> or a struct without checking</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: no atomic Add for double before .NET 9"><code>// WRONG on older targets: Interlocked.Add has no double overload, so people
// write a CAS loop by hand and get the bit-conversion wrong.
// Right: use the CAS loop with CompareExchange(ref double, ...), which does
// exist — or accumulate in long fixed-point and divide once at the end.
double current, next;
do
{
    current = Volatile.Read(ref _total);
    next = current + value;
}
while (Interlocked.CompareExchange(ref _total, next, current) != current);</code></pre>

  <p>And note that a <code>long</code> or <code>double</code> field is not even guaranteed to be read
  atomically on a 32-bit runtime without <code>Interlocked</code> or
  <code>Volatile</code> — a torn read can return half of one value and half of another.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a derived value — a mean, a ratio, a percentage — is occasionally
    impossible, and corrects itself before anyone can look.</p>
    <p><strong>Why:</strong> two atomic reads of two locations that must agree. The individual values
    are always right, which is what makes it invisible.</p>
    <p><strong>Tool:</strong> an invariant assertion where the value is produced. There is no counter
    for this and no dump will show it:</p>
    <pre data-lang="csharp" data-net="10" data-title="Assert what the value is allowed to be"><code>if (mean &gt; 0 &amp;&amp; mean &lt; _fastestEverObserved)
    _logger.LogError("impossible mean {Mean} from count {Count}", mean, count);</code></pre>
    <p><strong>Reading it:</strong> any hit is a torn read. The give-away is that the log entry is
    isolated and the next sample is fine — a persistent wrong value is a different bug.</p>
    <p><strong>Fix:</strong> a lock over both fields, or one immutable snapshot swapped by a single
    CAS.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a lock-free structure is slower than the lock it replaced, or burns
    CPU with no throughput.</p>
    <p><strong>Why:</strong> CAS retries. Every loser recomputes and tries again, so contention costs
    real work rather than a wait.</p>
    <p><strong>Tool:</strong> count the retries. It is three lines and it is the number that decides
    whether the design was right:</p>
    <pre data-lang="csharp" data-net="10" data-title="Instrumenting a CAS loop"><code>while (true)
{
    var observed = Volatile.Read(ref _current);
    var next = Compute(observed);
    if (Interlocked.CompareExchange(ref _current, next, observed) == observed) break;
    Interlocked.Increment(ref _casRetries);      // expose this as a metric
}</code></pre>
    <p><strong>Reading it:</strong> retries approaching or exceeding the operation count means threads
    are colliding constantly — measured at 3.4 million retries for 1.6 million operations. That is the
    signal to go back to a lock. Retries near zero means the value converges and the loop is a good
    fit.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> high CPU with no progress, in code with no locks.</p>
    <p><strong>Why:</strong> a spinning CAS loop, or a livelock where threads keep invalidating each
    other. This looks nothing like the low-CPU stalls in
    <a href="#/m/t2-12-locking">t2-12</a> — it presents as saturation.</p>
    <p><strong>Tool:</strong></p>
    <pre data-lang="console" data-title="Distinguishing a spin from real work"><code>dotnet-counters monitor --process-id 4812 System.Runtime
    cpu-usage                       high
    monitor-lock-contention-count   near zero (there are no locks)

dotnet-dump collect --process-id 4812
&gt; clrstack -all       # threads inside your own CAS loop, no wait frame</code></pre>
    <p><strong>Reading it:</strong> high CPU, no lock contention, and threads parked in your own
    method with no blocking frame is a spin. Contrast a blocked thread
    (<a href="#/m/t2-07-sync-over-async-deadlocks">t2-07</a>), which shows a wait frame and consumes
    no CPU.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> you want to know whether replacing a lock with atomics would help,
    before writing any of it.</p>
    <p><strong>Tool:</strong> measure the lock first. <code>Monitor.LockContentionCount</code>
    (<a href="#/m/t2-12-locking">t2-12</a>) around the workload tells you whether the lock is
    contended at all:</p>
    <pre data-lang="csharp" data-net="10" data-title="The question to answer first"><code>var before = Monitor.LockContentionCount;
RunRepresentativeWorkload();
Console.WriteLine($"contentions: {Monitor.LockContentionCount - before}");</code></pre>
    <p><strong>Reading it:</strong> a count near zero means the lock is not your problem and replacing
    it can only add risk. A high count means it might be — and the next question is whether the
    operation is a single location (where atomics win) or several (where a CAS loop will retry and
    probably lose).</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The optimisation that removed the contention also removed the correctness, and the
    profiler endorsed it.</strong> Removing the lock genuinely did what the profiler suggested. The
    tool was right about its own question and silent about the one that mattered, and its authority
    carried a change that produced impossible numbers on a dashboard finance teams read. A profiler
    tells you where time goes; it cannot tell you what a lock was protecting.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Lock-free is usually a performance loss dressed as a performance win.</strong> The
    correct lock-free version measured several times slower than a plain lock, with 3.4 million CAS
    retries — because every losing thread allocates, recomputes and retries, and under contention most
    threads lose most of the time. Meanwhile it is harder to read, harder to review, and has a
    correctness condition (the snapshot must be immutable all the way down) that a future edit can
    quietly break.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>There is exactly one shape where atomics reliably win, and knowing it saves
    arguments.</strong> A single location, updated by a single hardware instruction: a counter, a
    flag, a reference swap. Measured, a lock cost 1.8× an <code>Interlocked.Increment</code> under
    contention on one counter — and 0.4× a CAS loop on a snapshot object. Same machine, same threads,
    opposite conclusions, decided entirely by whether a losing thread has to redo work.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Both operations are atomic, so the code is thread-safe."</strong> Measured: 30 of 30
    trials produced an impossible mean. Atomic means one location is indivisible. Two locations
    agreeing is a different property entirely.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Lock-free is faster than locking."</strong> For a single counter, yes — a lock cost
    1.8× an atomic increment. For a two-field update via CAS, the <em>lock was several times
    faster</em>, with millions of retries on the lock-free side. The shape decides, not the label.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Lock-free means no waiting."</strong> It means no thread blocks another indefinitely.
    Losers in a CAS loop retry, which is waiting that burns CPU instead of yielding it — and it shows
    up as saturation rather than as a stall.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I can check whether my CAS succeeded by reading the value afterwards."</strong> That
    is a second operation. Compare the <em>return value</em> to your comparand — it is the
    before-value, captured in the same instruction as the swap.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>Interlocked</code> has an operation for what I need."</strong> It has
    increment, decrement, add, exchange and compare-exchange. No multiply, no max, no
    update-via-function. Everything else is a CAS loop you write, and whose retry cost you own.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Swapping an object reference atomically makes the object thread-safe."</strong> Only
    if the object is immutable. A CAS that publishes a reference to something another thread can still
    mutate has published a moving target — the swap was atomic and the guarantee is worthless.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A profiler said the lock was hot, so removing it was right."</strong> The profiler
    was right about time and silent about invariants. Contention is evidence that a lock is used, not
    evidence that it is unnecessary. The first question is whether the operation is a single location;
    the second is whether the read path outnumbers the write path.</p>
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
    <p>What does each call return, and why is the pattern not uniform?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>var v = 10;
Interlocked.Increment(ref v);
Interlocked.Add(ref v, 5);
Interlocked.Exchange(ref v, 99);
Interlocked.CompareExchange(ref v, 7, 99);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  v = 10
  Interlocked.Increment(ref v)         -&gt;  11   v = 11
  Interlocked.Add(ref v, 5)            -&gt;  16   v = 16
  Interlocked.Exchange(ref v, 99)      -&gt;  16   v = 99
  CompareExchange(ref v, 7, 99)        -&gt;  99   v = 7</code></pre>
        <p><strong><code>Increment</code>, <code>Decrement</code> and <code>Add</code> return the value
        after; <code>Exchange</code> and <code>CompareExchange</code> return the value before.</strong></p>
        <p>The asymmetry is deliberate rather than historical. For a counter you want the new total —
        that is what you were computing. For a swap you want to know <em>what you replaced</em>,
        because the before-value is the only way to tell whether you were the thread that made the
        change.</p>
        <p>That question — "was it me?" — is the foundation of every lock-free algorithm, which is why
        the primitive is shaped to answer it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p><code>Interlocked</code> has no <code>Max</code>. Write one, and identify the two details that
    carry the correctness.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>long current;
do
{
    current = Volatile.Read(ref max);
    if (candidate &lt;= current) break;                 // nothing to do
}
while (Interlocked.CompareExchange(ref max, candidate, current) != current);</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>    result 999,999, CAS retries 0</code></pre>
        <p><strong>Detail one: the read is inside the loop.</strong> A failed CAS means another thread
        moved the value, so retrying with the stale <code>current</code> would either fail forever or
        overwrite their update. Re-reading is what makes the loop converge.</p>
        <p><strong>Detail two: the early break.</strong> If the candidate is not larger there is
        nothing to write, so no CAS is attempted at all. That single line is why the retry count is
        zero — and it is a property of <em>this</em> operation, not of CAS loops generally.</p>
        <p>Note the ABA consideration this shape sidesteps. A CAS only checks that the value is
        unchanged, not that nothing happened — a value could go from A to B and back to A, and the CAS
        would succeed. For a monotonically rising maximum that is harmless. For a pointer into a
        recycled structure it is a classic and serious bug.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Two CAS loops, same thread count, same iteration count. Predict which retries more, and by how
    much.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  workload                     retries
  Max  (value converges)             0
  Sum  (every op swaps)        263,083   (result 160,000)</code></pre>
        <p><strong>Sum retried more times than there were operations.</strong> 160,000 successful
        updates cost 263,083 failed attempts on top.</p>
        <p><strong>Max converges</strong>, so after a short warm-up almost every thread reads the
        running maximum, finds its candidate smaller, and exits before attempting a swap. Zero
        retries.</p>
        <p><strong>Sum cannot converge.</strong> Every thread must swap on every iteration, so eight
        threads collide continuously and most of them lose.</p>
        <p>The general rule this gives you: <strong>a CAS loop is cheap when most iterations do not
        need to write</strong>, and expensive when every iteration must. Before writing one, ask how
        often two threads will genuinely collide on that location — not whether atomics are faster
        than locks in the abstract.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Is this thread-safe? Every operation in it is atomic.</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>// writer
Interlocked.Increment(ref _count);
Interlocked.Add(ref _total, value);

// reader
var mean = Volatile.Read(ref _total) / Volatile.Read(ref _count);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    reader observed an impossible value in 20 of 20 trials</code></pre>
        <p><strong>No — and it fails in every trial.</strong> Both writes are atomic; the pair is not.
        The reader takes the count, then the total, and a writer can complete both of its updates in
        between — so the reader divides a newer total by an older count.</p>
        <p><strong>Atomic is not transactional.</strong> <code>Interlocked</code> makes one memory
        location indivisible. "These two fields always agree with each other" is a different property,
        and no sequence of <code>Interlocked</code> calls provides it.</p>
        <p>Note that the reader is equally at fault. Even a perfect writer cannot help a reader that
        performs two separate reads of two separate locations.</p>
        <p><strong>Two fixes.</strong> A lock around both, for readers and writers — simple, obvious,
        and measured faster. Or put both fields in one immutable object and swap the whole thing with
        a single CAS, which lets readers take no lock at all.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Which is faster, a lock or atomics? Answer for both of these and explain the difference.</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 5"><code>// (a) one counter
Interlocked.Increment(ref _counter);        vs   lock (_gate) { _counter++; }

// (b) two fields that must agree
CompareExchange(ref _snapshot, next, observed);   vs   lock (_gate) { _count++; _total += x; }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    Interlocked.Increment    1.00x  (baseline)
    lock { ++ }              1.80x

    lock                     1.00x  (baseline)
    CAS on a snapshot        2.46x</code></pre>
        <p><strong>Atomics win (a) and lose (b), on the same machine with the same threads.</strong></p>
        <p><strong>The difference is what a loser does.</strong> On a single
        <code>Increment</code> there is no loser — the hardware serialises the instruction and every
        thread succeeds on its first attempt. In a CAS loop the loser allocates a new snapshot,
        recomputes, and tries again; under contention most threads lose most of the time, so the total
        work done far exceeds the work required.</p>
        <p>A lock has no retries at all. A thread that cannot acquire it waits once and then proceeds,
        and modern .NET locks spin briefly before yielding, so an uncontended or lightly contended lock
        never reaches the operating system.</p>
        <p><strong>The rule this gives you:</strong> lock-free reliably wins for a single location
        updated by a single hardware instruction — a counter, a flag, a reference swap. Everywhere
        else, measure, and expect the lock to win.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Make exercise 4 correct without a lock, and list the conditions your solution depends on.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>private sealed record Snapshot(long Count, long Total);
private Snapshot _current = new(0, 0);

public void Record(long value)
{
    while (true)
    {
        var observed = Volatile.Read(ref _current);
        var next = new Snapshot(observed.Count + 1, observed.Total + value);
        if (Interlocked.CompareExchange(ref _current, next, observed) == observed) return;
    }
}

public double Mean()
{
    var s = Volatile.Read(ref _current);       // ONE read, one consistent pair
    return s.Count == 0 ? 0 : (double)s.Total / s.Count;
}</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>    reader observed an impossible value in 0 of 20 trials</code></pre>
        <p><strong>The invariant moves inside one object</strong>, so a single atomic reference swap
        publishes both fields together. A reader performs one volatile read and sees a consistent pair,
        with no lock on the read path at all.</p>
        <p><strong>Three conditions, all load-bearing.</strong></p>
        <p><em>The snapshot must be immutable.</em> Publishing a reference to something another thread
        can still mutate makes the atomic swap worthless.</p>
        <p><em>It must hold no mutable field, including arrays.</em> A <code>record</code> containing a
        <code>List&lt;T&gt;</code> is not immutable — use <code>ImmutableArray&lt;T&gt;</code> or copy.</p>
        <p><em>The writer must re-read inside the retry loop.</em> Reusing the stale
        <code>observed</code> value after a failed CAS either spins forever or clobbers the update that
        beat you.</p>
        <p><strong>And it is slower than the lock for writes</strong> — measured at 2.46× with millions
        of retries. Ship it when reads massively outnumber writes, because readers pay nothing at all;
        ship the lock otherwise.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 01-atomics.cs -c Release</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-atomics.cs"><code>// 01-atomics.cs — what Interlocked actually provides, what it cannot provide,
// and the compare-and-swap loop that everything lock-free is built from.
//
// Timings are quoted as RATIOS. Counts and correctness are exact and stable.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-atomics.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

class Program
{
    static int _counter;
    static long _total;
    static readonly object Gate = new();

    static void Main()
    {
        Console.WriteLine("=== 1. the operations, and what each returns ===");
        Console.WriteLine();
        var v = 10;
        Console.WriteLine($"  start                       v = {v}");
        Console.WriteLine($"  Increment returns the NEW   : {Interlocked.Increment(ref v)}   (v = {v})");
        Console.WriteLine($"  Decrement returns the NEW   : {Interlocked.Decrement(ref v)}   (v = {v})");
        Console.WriteLine($"  Add(5) returns the NEW      : {Interlocked.Add(ref v, 5)}   (v = {v})");
        Console.WriteLine($"  Exchange(99) returns the OLD: {Interlocked.Exchange(ref v, 99)}   (v = {v})");
        Console.WriteLine($"  Read is a no-op for int     : {Interlocked.CompareExchange(ref v, 0, int.MinValue)}");
        Console.WriteLine();
        Console.WriteLine("  Note the asymmetry. Increment, Decrement and Add return the value");
        Console.WriteLine("  AFTER the operation; Exchange and CompareExchange return the value");
        Console.WriteLine("  BEFORE it. That is not arbitrary: the before-value is what tells you");
        Console.WriteLine("  whether YOU were the thread that made the change.");

        Console.WriteLine();
        Console.WriteLine("=== 2. CompareExchange is the primitive ===");
        Console.WriteLine();
        Console.WriteLine("      CompareExchange(ref location, newValue, comparand)");
        Console.WriteLine();
        Console.WriteLine("  'If location currently equals comparand, store newValue. Either way,");
        Console.WriteLine("  return what location held before.' The comparison and the store are");
        Console.WriteLine("  ONE instruction that no other thread can interleave with.");
        Console.WriteLine();
        var slot = 5;
        var before = Interlocked.CompareExchange(ref slot, 42, 5);
        Console.WriteLine($"  CAS(slot, 42, expecting 5)  returned {before}, slot = {slot}   -&gt; we won");
        before = Interlocked.CompareExchange(ref slot, 99, 5);
        Console.WriteLine($"  CAS(slot, 99, expecting 5)  returned {before}, slot = {slot}   -&gt; we lost");
        Console.WriteLine();
        Console.WriteLine("  You detect success by comparing the RETURN to your comparand, not by");
        Console.WriteLine("  reading the location afterwards. Reading afterwards is a second");
        Console.WriteLine("  operation and another thread may have moved it again.");
        Console.WriteLine();
        Console.WriteLine("      if (Interlocked.CompareExchange(ref x, next, expected) == expected)");
        Console.WriteLine("          // this thread performed the update");

        Console.WriteLine();
        Console.WriteLine("=== 3. everything else is a CAS loop ===");
        Console.WriteLine();
        Console.WriteLine("  Interlocked has no Multiply, no Max, no 'update via a function'. You");
        Console.WriteLine("  build them by reading, computing, and swapping only if nothing moved:");
        Console.WriteLine();
        Console.WriteLine("      long current, next;");
        Console.WriteLine("      do");
        Console.WriteLine("      {");
        Console.WriteLine("          current = Volatile.Read(ref location);");
        Console.WriteLine("          next    = Compute(current);");
        Console.WriteLine("      }");
        Console.WriteLine("      while (Interlocked.CompareExchange(ref location, next, current) != current);");
        Console.WriteLine();
        Console.WriteLine("  The loop is the retry. If another thread changed the value between");
        Console.WriteLine("  the read and the swap, the CAS fails, and you recompute from the new");
        Console.WriteLine("  value rather than clobbering it.");
        Console.WriteLine();

        _total = 0;
        var (maxResult, maxRetries) = MaxWithCas();
        var (sumResult, sumRetries) = SumWithCas();
        Console.WriteLine("  workload                       result        CAS retries");
        Console.WriteLine($"  lock-free Max, 8 threads   {maxResult,12:N0}   {maxRetries,12:N0}");
        Console.WriteLine($"  lock-free Sum, 8 threads   {sumResult,12:N0}   {sumRetries,12:N0}");
        Console.WriteLine();
        Console.WriteLine("  The contrast between those two rows IS the cost model, and it is not");
        Console.WriteLine("  what people expect.");
        Console.WriteLine();
        Console.WriteLine("  MAX retried almost never. After a few hundred iterations the running");
        Console.WriteLine("  maximum is close to final, so nearly every thread reads it, sees its");
        Console.WriteLine("  own candidate is smaller, and never attempts a swap at all. A CAS loop");
        Console.WriteLine("  over a value that CONVERGES is close to free.");
        Console.WriteLine();
        Console.WriteLine("  SUM retried constantly. Every thread must swap on every iteration, so");
        Console.WriteLine("  eight threads collide continuously and the losers recompute and try");
        Console.WriteLine("  again. Each retry is wasted work that a lock would not have done: the");
        Console.WriteLine("  loser under a lock waits once, whereas the loser under CAS spins.");
        Console.WriteLine();
        Console.WriteLine("  So the question to ask before writing a CAS loop is not 'is this");
        Console.WriteLine("  faster than a lock' but 'how often will two threads actually collide");
        Console.WriteLine("  here'. Rarely, and it is excellent. Constantly, and it is worse than");
        Console.WriteLine("  the lock you were avoiding.");

        Console.WriteLine();
        Console.WriteLine("=== 4. what Interlocked cannot do ===");
        Console.WriteLine();
        Console.WriteLine("  It makes ONE memory location atomic. Two locations are not covered,");
        Console.WriteLine("  and no combination of Interlocked calls fixes that:");
        Console.WriteLine();
        Console.WriteLine("      Interlocked.Decrement(ref _fromBalance);   // atomic");
        Console.WriteLine("      Interlocked.Increment(ref _toBalance);     // atomic");
        Console.WriteLine("      // between them, money does not exist");
        Console.WriteLine();
        var (torn, trials) = TornInvariant();
        Console.WriteLine($"  a reader observed a broken invariant in {torn} of {trials} trials");
        Console.WriteLine();
        Console.WriteLine("  Both operations are atomic and the invariant still breaks, because");
        Console.WriteLine("  ATOMICITY IS NOT THE SAME AS TRANSACTIONALITY. If two fields must");
        Console.WriteLine("  agree, you need a lock, or a single object swapped by one CAS.");
        Console.WriteLine();
        Console.WriteLine("  This is the most common misuse: reaching for Interlocked to avoid a");
        Console.WriteLine("  lock, on state that needs a lock.");

        Console.WriteLine();
        Console.WriteLine("=== 5. the cost, uncontended and contended ===");
        Console.WriteLine();
        Console.WriteLine("  one thread, no contention:");
        var plain = Bench(() =&gt; _counter++);
        var atomic = Bench(() =&gt; Interlocked.Increment(ref _counter));
        var locked = Bench(() =&gt; { lock (Gate) { _counter++; } });
        Console.WriteLine($"    plain ++                 {1.0,6:N1}x  (baseline)");
        Console.WriteLine($"    Interlocked.Increment    {atomic / plain,6:N1}x");
        Console.WriteLine($"    lock {{ ++ }}              {locked / plain,6:N1}x");
        Console.WriteLine();
        Console.WriteLine("  eight threads, maximum contention on ONE location:");
        var atomicC = Contended(useLock: false);
        var lockedC = Contended(useLock: true);
        Console.WriteLine($"    Interlocked.Increment    {1.0,6:N1}x  (baseline)");
        Console.WriteLine($"    lock {{ ++ }}              {lockedC / atomicC,6:N1}x");
        Console.WriteLine();
        Console.WriteLine("  Interlocked wins in both, and note HOW MUCH it wins by under");
        Console.WriteLine("  contention: far less than the uncontended numbers suggest. A modern");
        Console.WriteLine("  lock is not the disaster its reputation implies, and the gap narrows");
        Console.WriteLine("  precisely when people reach for Interlocked to close it.");
        Console.WriteLine();
        Console.WriteLine("  This is the case Interlocked was designed for — one location, one");
        Console.WriteLine("  operation — and it is a narrow case.");
        Console.WriteLine();
        Console.WriteLine("  Note what is NOT shown: any scenario needing two fields, a collection,");
        Console.WriteLine("  or a computation. There Interlocked either does not apply or turns");
        Console.WriteLine("  into a CAS loop whose retries cost more than a lock would.");
    }

    /// &lt;summary&gt;
    /// A CAS loop where every thread MUST swap on every iteration, so collisions
    /// are continuous. Contrast MaxWithCas, where the value converges and most
    /// iterations exit before attempting a swap.
    /// &lt;/summary&gt;
    static (long result, int retries) SumWithCas()
    {
        long total = 0;
        var retries = 0;
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);

        for (var t = 0; t &lt; 8; t++)
        {
            threads[t] = new Thread(() =&gt;
            {
                ready.Wait();
                for (var i = 0; i &lt; 20_000; i++)
                {
                    long current, next;
                    do
                    {
                        current = Volatile.Read(ref total);
                        next = current + 1;
                        if (Interlocked.CompareExchange(ref total, next, current) == current) break;
                        Interlocked.Increment(ref retries);
                    }
                    while (true);
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        return (total, retries);
    }

    static (long result, int retries) MaxWithCas()
    {
        long max = 0;
        var retries = 0;
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);

        for (var t = 0; t &lt; 8; t++)
        {
            var seed = t * 7919;
            threads[t] = new Thread(() =&gt;
            {
                ready.Wait();
                var k = seed;
                for (var i = 0; i &lt; 20_000; i++)
                {
                    k = (k * 1103515245 + 12345) &amp; int.MaxValue;
                    var candidate = k % 1_000_000;

                    long current;
                    do
                    {
                        current = Volatile.Read(ref max);
                        if (candidate &lt;= current) break;          // nothing to do
                    }
                    while (Interlocked.CompareExchange(ref max, candidate, current) != current
                           &amp;&amp; Interlocked.Increment(ref retries) &gt; 0);
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        return (max, retries);
    }

    /// &lt;summary&gt;
    /// Two atomic operations, one broken invariant. A reader that sums both
    /// balances can see a moment where the money is in neither.
    /// &lt;/summary&gt;
    static (int torn, int trials) TornInvariant()
    {
        const int Trials = 20;
        var torn = 0;

        for (var trial = 0; trial &lt; Trials; trial++)
        {
            long from = 1_000_000, to = 0;
            var stop = new CancellationTokenSource();
            var sawTear = false;

            var mover = new Thread(() =&gt;
            {
                while (!stop.IsCancellationRequested)
                {
                    Interlocked.Decrement(ref from);
                    Interlocked.Increment(ref to);
                    Interlocked.Increment(ref from);
                    Interlocked.Decrement(ref to);
                }
            }) { IsBackground = true };

            var auditor = new Thread(() =&gt;
            {
                while (!stop.IsCancellationRequested)
                {
                    var sum = Volatile.Read(ref from) + Volatile.Read(ref to);
                    if (sum != 1_000_000) { sawTear = true; return; }
                }
            }) { IsBackground = true };

            mover.Start();
            auditor.Start();
            Thread.Sleep(20);
            stop.Cancel();
            mover.Join(500);
            auditor.Join(500);
            if (sawTear) torn++;
        }
        return (torn, Trials);
    }

    static double Bench(Action a)
    {
        for (var i = 0; i &lt; 200_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 5_000_000; i++) a();
        return sw.Elapsed.TotalMilliseconds;
    }

    static double Contended(bool useLock)
    {
        Thread.Sleep(100);
        _total = 0;
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();

        for (var t = 0; t &lt; 8; t++)
        {
            threads[t] = new Thread(() =&gt;
            {
                ready.Wait();
                for (var i = 0; i &lt; 300_000; i++)
                {
                    if (useLock) { lock (Gate) { _total++; } }
                    else Interlocked.Increment(ref _total);
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-production.cs"><code>// 02-production.cs — Ledger's latency statistics. Someone removed a lock to
// stop it showing up in a profiler, and the dashboard started lying.
//
// Timings are ratios. Correctness counts are exact.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-production.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

namespace Ledger.Telemetry;

/// &lt;summary&gt;
/// THE SHIPPED VERSION. Both updates are atomic, so it "has no race" — and the
/// pair of them is not atomic, so a reader can divide a new sum by an old count.
/// &lt;/summary&gt;
public sealed class StatsV1
{
    private long _count;
    private long _totalMicros;

    public void Record(long micros)
    {
        Interlocked.Increment(ref _count);
        Interlocked.Add(ref _totalMicros, micros);
    }

    public double MeanMicros()
    {
        var count = Volatile.Read(ref _count);
        var total = Volatile.Read(ref _totalMicros);
        return count == 0 ? 0 : (double)total / count;
    }
}

/// &lt;summary&gt;THE OBVIOUS FIX. One lock around both fields, for readers and writers.&lt;/summary&gt;
public sealed class StatsV2
{
    private readonly Lock _gate = new();
    private long _count;
    private long _totalMicros;

    public void Record(long micros)
    {
        lock (_gate) { _count++; _totalMicros += micros; }
    }

    public double MeanMicros()
    {
        lock (_gate) { return _count == 0 ? 0 : (double)_totalMicros / _count; }
    }
}

/// &lt;summary&gt;
/// THE LOCK-FREE FIX. Both fields live in one immutable object, and the whole
/// object is swapped with a single CompareExchange. A reader sees one snapshot
/// or another, never a mixture.
/// &lt;/summary&gt;
public sealed class StatsV3
{
    private sealed record Snapshot(long Count, long TotalMicros);

    private Snapshot _current = new(0, 0);
    private int _retries;

    public int Retries =&gt; Volatile.Read(ref _retries);

    public void Record(long micros)
    {
        while (true)
        {
            var observed = Volatile.Read(ref _current);
            var next = new Snapshot(observed.Count + 1, observed.TotalMicros + micros);
            if (Interlocked.CompareExchange(ref _current, next, observed) == observed) return;
            Interlocked.Increment(ref _retries);
        }
    }

    public double MeanMicros()
    {
        var s = Volatile.Read(ref _current);          // one read, one consistent pair
        return s.Count == 0 ? 0 : (double)s.TotalMicros / s.Count;
    }
}

class Program
{
    const int Trials = 30;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger records a latency figure per request and exposes the mean on a");
        Console.WriteLine("  dashboard. The original used a lock. A profiler showed that lock at");
        Console.WriteLine("  the top of a contention report, so it was removed:");
        Console.WriteLine();
        Console.WriteLine("      Interlocked.Increment(ref _count);");
        Console.WriteLine("      Interlocked.Add(ref _totalMicros, micros);");
        Console.WriteLine();
        Console.WriteLine("  Every operation is atomic. There is no lost update — the count and");
        Console.WriteLine("  the total are both exactly right at the end of any run.");
        Console.WriteLine();
        Console.WriteLine("  The dashboard began showing impossible means: values far below the");
        Console.WriteLine("  fastest request ever served, appearing for a few seconds and then");
        Console.WriteLine("  correcting themselves.");
        Console.WriteLine();
        Console.WriteLine("  implementation        final totals   reader saw a torn mean");

        Report("Interlocked pair (V1)", TornReads(() =&gt; new Wrapper(new StatsV1())));
        Report("lock (V2)", TornReads(() =&gt; new Wrapper(new StatsV2())));
        Report("CAS on a snapshot (V3)", TornReads(() =&gt; new Wrapper(new StatsV3())));

        Console.WriteLine();
        Console.WriteLine("  V1's totals are always correct and its READS are not. The reader");
        Console.WriteLine("  takes the count, then the total; a writer can complete both of its");
        Console.WriteLine("  updates in between, so the reader divides a newer total by an older");
        Console.WriteLine("  count. The mean is wrong in a way that no amount of atomicity on the");
        Console.WriteLine("  individual fields can prevent.");
        Console.WriteLine();
        Console.WriteLine("  ATOMIC IS NOT TRANSACTIONAL. Interlocked makes one location");
        Console.WriteLine("  indivisible. If two locations must agree with each other, that is a");
        Console.WriteLine("  different property and Interlocked does not provide it.");

        Console.WriteLine();
        Console.WriteLine("=== why it was so hard to see ===");
        Console.WriteLine();
        Console.WriteLine("  1. Nothing throws, and no total is ever wrong. Every unit test that");
        Console.WriteLine("     asserts on the final count and sum passes.");
        Console.WriteLine();
        Console.WriteLine("  2. It is a READ bug in code whose writes were the suspicious part.");
        Console.WriteLine("     Review attention went to Record; the defect is in MeanMicros.");
        Console.WriteLine();
        Console.WriteLine("  3. It self-corrects. The next read is usually right, so the graph");
        Console.WriteLine("     shows a spike that has already gone by the time anyone looks.");
        Console.WriteLine();
        Console.WriteLine("  4. The change was justified by a profiler. Removing the lock DID");
        Console.WriteLine("     remove the contention; the profiler was not wrong, it was");
        Console.WriteLine("     answering a different question from the one that mattered.");

        Console.WriteLine();
        Console.WriteLine("=== the two fixes, and which to ship ===");
        Console.WriteLine();
        var ratio = CompareCost();
        Console.WriteLine($"  time for the LOCK, relative to the lock-free version : {ratio,5:N2}x");
        Console.WriteLine($"  CAS retries incurred by the lock-free version        : {LastRetries,10:N0}");
        Console.WriteLine();
        Console.WriteLine("  Read that ratio carefully, because it is below 1: THE LOCK IS");
        Console.WriteLine("  SEVERAL TIMES FASTER than the lock-free version, on the same work.");
        Console.WriteLine("  (The exact multiple moves between runs — it has measured anywhere");
        Console.WriteLine("  from twice to three and a half times. The direction does not move.)");
        Console.WriteLine();
        Console.WriteLine("  Millions of CAS retries is why. Every writer that loses the race");
        Console.WriteLine("  allocates a new snapshot, recomputes, and tries again — and with eight");
        Console.WriteLine("  threads hammering one reference, most of them lose most of the time.");
        Console.WriteLine("  The lock has no retries: a loser waits once and then proceeds.");
        Console.WriteLine();
        Console.WriteLine("  SHIP THE LOCK unless you have a measurement saying otherwise.");
        Console.WriteLine();
        Console.WriteLine("  V3 is correct, and look at what it costs to be correct without a");
        Console.WriteLine("  lock: an allocation per recorded value, a retry loop whose losers");
        Console.WriteLine("  redo their work, and a reviewer who must understand why the snapshot");
        Console.WriteLine("  has to be immutable. V2 is four lines and obvious.");
        Console.WriteLine();
        Console.WriteLine("  V3 earns its place in one situation: when the read path massively");
        Console.WriteLine("  outnumbers the write path. Readers of V3 take no lock at all — a");
        Console.WriteLine("  single volatile read of a reference — so a dashboard scraping this");
        Console.WriteLine("  thousands of times a second never contends with recording.");

        Console.WriteLine();
        Console.WriteLine("=== the pattern worth remembering ===");
        Console.WriteLine();
        Console.WriteLine("  Interlocked protects ONE location. So make the thing you need to");
        Console.WriteLine("  update atomically into ONE location:");
        Console.WriteLine();
        Console.WriteLine("      record Snapshot(long Count, long Total);       // immutable");
        Console.WriteLine("      private Snapshot _current;                     // one reference");
        Console.WriteLine();
        Console.WriteLine("      var observed = Volatile.Read(ref _current);");
        Console.WriteLine("      var next = new Snapshot(observed.Count + 1, observed.Total + x);");
        Console.WriteLine("      CompareExchange(ref _current, next, observed);");
        Console.WriteLine();
        Console.WriteLine("  The snapshot MUST be immutable. If a reader could mutate what it");
        Console.WriteLine("  read, or if the record held a mutable array, the guarantee evaporates");
        Console.WriteLine("  — you would be back to publishing a reference to changing state.");
        Console.WriteLine();
        Console.WriteLine("  This is the same shape as an immutable configuration object swapped");
        Console.WriteLine("  on reload, and a copy-on-write collection. In every case the trick is");
        Console.WriteLine("  the same: move the invariant inside a single object so that one");
        Console.WriteLine("  atomic reference swap publishes all of it at once.");

        Console.WriteLine();
        Console.WriteLine("=== how it was diagnosed ===");
        Console.WriteLine();
        Console.WriteLine("  No exception, no counter, no dump. What found it was the same trick");
        Console.WriteLine("  as t2-11: assert the invariant continuously, in the data.");
        Console.WriteLine();
        Console.WriteLine("      if (mean &lt; FastestObservedRequestMicros)");
        Console.WriteLine("          _logger.LogError(\"impossible mean {Mean} from {Count}\", mean, count);");
        Console.WriteLine();
        Console.WriteLine("  A race on a derived value leaves no runtime trace. The only detector");
        Console.WriteLine("  is a check that knows what the value is allowed to be — which means");
        Console.WriteLine("  someone has to state the invariant explicitly, in code, before the");
        Console.WriteLine("  incident rather than during it.");
    }

    static int LastRetries;

    /// &lt;summary&gt;Uniform access to the three implementations without an interface on the hot path.&lt;/summary&gt;
    sealed class Wrapper
    {
        private readonly object _impl;
        public Wrapper(object impl) =&gt; _impl = impl;

        public void Record(long micros)
        {
            switch (_impl)
            {
                case StatsV1 a: a.Record(micros); break;
                case StatsV2 b: b.Record(micros); break;
                case StatsV3 c: c.Record(micros); break;
            }
        }

        public double Mean() =&gt; _impl switch
        {
            StatsV1 a =&gt; a.MeanMicros(),
            StatsV2 b =&gt; b.MeanMicros(),
            StatsV3 c =&gt; c.MeanMicros(),
            _ =&gt; 0
        };
    }

    readonly record struct Outcome(bool TotalsCorrect, int TornTrials);

    /// &lt;summary&gt;
    /// Every recorded value is exactly 1,000 microseconds, so a correct mean is
    /// always 1,000. Any other value a reader observes is a torn read, and no
    /// tolerance or rounding argument can explain it away.
    /// &lt;/summary&gt;
    static Outcome TornReads(Func&lt;Wrapper&gt; make)
    {
        var torn = 0;
        var totalsOk = true;

        for (var trial = 0; trial &lt; Trials; trial++)
        {
            var stats = make();
            var stop = new CancellationTokenSource();
            var sawTorn = false;

            var writers = new Thread[4];
            for (var w = 0; w &lt; 4; w++)
            {
                writers[w] = new Thread(() =&gt;
                {
                    while (!stop.IsCancellationRequested) stats.Record(1_000);
                }) { IsBackground = true };
                writers[w].Start();
            }

            var reader = new Thread(() =&gt;
            {
                while (!stop.IsCancellationRequested)
                {
                    var mean = stats.Mean();
                    if (mean != 0 &amp;&amp; Math.Abs(mean - 1_000) &gt; 0.0001) { sawTorn = true; return; }
                }
            }) { IsBackground = true };
            reader.Start();

            Thread.Sleep(20);
            stop.Cancel();
            foreach (var w in writers) w.Join(500);
            reader.Join(500);

            if (sawTorn) torn++;
            if (Math.Abs(stats.Mean() - 1_000) &gt; 0.0001 &amp;&amp; stats.Mean() != 0) totalsOk = false;
        }
        return new Outcome(totalsOk, torn);
    }

    static void Report(string label, Outcome o) =&gt;
        Console.WriteLine($"  {label,-22} {(o.TotalsCorrect ? "correct" : "WRONG"),-14} " +
                          $"{o.TornTrials} of {Trials}");

    static double CompareCost()
    {
        var withLock = TimeRecording(new Wrapper(new StatsV2()));
        var v3 = new StatsV3();
        var withCas = TimeRecording(new Wrapper(v3));
        LastRetries = v3.Retries;
        return withLock / withCas;
    }

    static double TimeRecording(Wrapper stats)
    {
        Thread.Sleep(100);
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();
        for (var t = 0; t &lt; 8; t++)
        {
            threads[t] = new Thread(() =&gt;
            {
                ready.Wait();
                for (var i = 0; i &lt; 200_000; i++) stats.Record(1_000);
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-exercises.cs"><code>// 03-exercises.cs — every answer claimed in this module's exercises, run.
// Timings are ratios; counts and correctness are exact.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

class Program
{
    static int _counter;
    static long _a, _b;
    static readonly object Gate = new();

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: what does each call return? =====");
        Console.WriteLine();
        var v = 10;
        Console.WriteLine($"  v = {v}");
        Console.WriteLine($"  Interlocked.Increment(ref v)         -&gt; {Interlocked.Increment(ref v),3}   v = {v}");
        Console.WriteLine($"  Interlocked.Add(ref v, 5)            -&gt; {Interlocked.Add(ref v, 5),3}   v = {v}");
        Console.WriteLine($"  Interlocked.Exchange(ref v, 99)      -&gt; {Interlocked.Exchange(ref v, 99),3}   v = {v}");
        var cas = Interlocked.CompareExchange(ref v, 7, 99);
        Console.WriteLine($"  CompareExchange(ref v, 7, 99)        -&gt; {cas,3}   v = {v}");
        Console.WriteLine();
        Console.WriteLine("  Increment, Decrement and Add return the value AFTER. Exchange and");
        Console.WriteLine("  CompareExchange return the value BEFORE.");
        Console.WriteLine();
        Console.WriteLine("  That asymmetry is deliberate. The before-value is the only thing that");
        Console.WriteLine("  tells you whether YOU were the thread that made the change — which is");
        Console.WriteLine("  the entire basis of every lock-free algorithm.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: write Max without a lock =====");
        Console.WriteLine();
        Console.WriteLine("  Interlocked has no Max. Build one.");
        Console.WriteLine();
        var (max, retries) = LockFreeMax();
        Console.WriteLine($"    result {max:N0}, CAS retries {retries:N0}");
        Console.WriteLine();
        Console.WriteLine("      long current;");
        Console.WriteLine("      do");
        Console.WriteLine("      {");
        Console.WriteLine("          current = Volatile.Read(ref max);");
        Console.WriteLine("          if (candidate &lt;= current) break;      // nothing to do");
        Console.WriteLine("      }");
        Console.WriteLine("      while (CompareExchange(ref max, candidate, current) != current);");
        Console.WriteLine();
        Console.WriteLine("  Two details carry the correctness. The read must be INSIDE the loop —");
        Console.WriteLine("  a retry means someone changed it, so you must re-read rather than");
        Console.WriteLine("  retry with a stale value. And the early break matters as much as the");
        Console.WriteLine("  CAS: it is why the retry count above is what it is.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: predict the retry counts =====");
        Console.WriteLine();
        Console.WriteLine("  Two CAS loops, 8 threads, 20,000 iterations each.");
        Console.WriteLine();
        Console.WriteLine("  workload                     retries");
        Console.WriteLine($"  Max  (value converges)  {retries,12:N0}");
        var (sum, sumRetries) = LockFreeSum();
        Console.WriteLine($"  Sum  (every op swaps)   {sumRetries,12:N0}   (result {sum:N0})");
        Console.WriteLine();
        Console.WriteLine("  Max barely retries: once the running maximum is near its final value,");
        Console.WriteLine("  almost every thread reads it, finds its candidate smaller, and never");
        Console.WriteLine("  attempts a swap.");
        Console.WriteLine();
        Console.WriteLine("  Sum retries more times than there are operations. Every thread must");
        Console.WriteLine("  swap every time, so eight threads collide continuously.");
        Console.WriteLine();
        Console.WriteLine("  The question before writing a CAS loop is therefore not 'is this");
        Console.WriteLine("  faster than a lock' — it is 'how often will two threads collide on");
        Console.WriteLine("  this location'. Rarely: excellent. Constantly: worse than the lock.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: is this thread-safe? =====");
        Console.WriteLine();
        Console.WriteLine("      Interlocked.Increment(ref _count);");
        Console.WriteLine("      Interlocked.Add(ref _total, value);");
        Console.WriteLine("      // reader: _total / _count");
        Console.WriteLine();
        var (torn, trials) = TornPair();
        Console.WriteLine($"    reader observed an impossible value in {torn} of {trials} trials");
        Console.WriteLine();
        Console.WriteLine("  No. Both writes are atomic; the PAIR is not. A reader can take the");
        Console.WriteLine("  count, then the total, with a writer completing both updates in");
        Console.WriteLine("  between — dividing a newer total by an older count.");
        Console.WriteLine();
        Console.WriteLine("  ATOMIC IS NOT TRANSACTIONAL. Interlocked makes one location");
        Console.WriteLine("  indivisible. Two locations agreeing with each other is a different");
        Console.WriteLine("  property that no sequence of Interlocked calls provides.");
        Console.WriteLine();
        Console.WriteLine("  Two fixes: a lock around both, or put both fields in one immutable");
        Console.WriteLine("  object and swap the whole thing with a single CompareExchange.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: which is faster? =====");
        Console.WriteLine();
        Console.WriteLine("  A counter, 8 threads, one shared location:");
        var casMs = Contended(useLock: false);
        var lockMs = Contended(useLock: true);
        Console.WriteLine($"    Interlocked.Increment  {1.0,6:N2}x  (baseline)");
        Console.WriteLine($"    lock {{ ++ }}            {lockMs / casMs,6:N2}x");
        Console.WriteLine();
        Console.WriteLine("  A snapshot object, 8 threads, CAS loop against a lock:");
        var (snapLock, snapCas) = SnapshotCost();
        Console.WriteLine($"    lock                   {1.0,6:N2}x  (baseline)");
        Console.WriteLine($"    CAS on a snapshot      {snapCas / snapLock,6:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Interlocked wins the first and LOSES the second, decisively. The");
        Console.WriteLine("  difference is what a loser does. On a single Increment there is no");
        Console.WriteLine("  loser — the hardware serialises and everyone succeeds. In a CAS loop");
        Console.WriteLine("  the loser allocates, recomputes and tries again, and under contention");
        Console.WriteLine("  most threads lose most of the time.");
        Console.WriteLine();
        Console.WriteLine("  So 'lock-free is faster' is true for exactly one shape: a single");
        Console.WriteLine("  location updated by a single hardware instruction.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: make this correct without a lock =====");
        Console.WriteLine();
        Console.WriteLine("  Two fields that must agree, updated by many threads, read by many:");
        Console.WriteLine();
        Console.WriteLine("      record Snapshot(long Count, long Total);");
        Console.WriteLine("      private Snapshot _current = new(0, 0);");
        Console.WriteLine();
        Console.WriteLine("      var observed = Volatile.Read(ref _current);");
        Console.WriteLine("      var next = new Snapshot(observed.Count + 1, observed.Total + x);");
        Console.WriteLine("      CompareExchange(ref _current, next, observed);   // retry on failure");
        Console.WriteLine();
        var (snapTorn, snapTrials) = SnapshotTorn();
        Console.WriteLine($"    reader observed an impossible value in {snapTorn} of {snapTrials} trials");
        Console.WriteLine();
        Console.WriteLine("  The invariant moves INSIDE one object, so one atomic reference swap");
        Console.WriteLine("  publishes both fields together. A reader takes one volatile read and");
        Console.WriteLine("  sees a consistent pair, with no lock on the read path at all.");
        Console.WriteLine();
        Console.WriteLine("  Three conditions, and all three are load-bearing:");
        Console.WriteLine("    - the snapshot must be IMMUTABLE, or you have published a reference");
        Console.WriteLine("      to state that can still change");
        Console.WriteLine("    - it must hold no mutable field, including arrays");
        Console.WriteLine("    - the writer must re-read inside the retry loop, never reuse the");
        Console.WriteLine("      stale observed value");
        Console.WriteLine();
        Console.WriteLine("  And it is SLOWER than a lock for writes, measured above. Use it when");
        Console.WriteLine("  reads massively outnumber writes, because readers pay nothing.");
    }

    // --- Exercises 2 and 3 ----------------------------------------------------
    static (long, int) LockFreeMax()
    {
        long max = 0;
        var retries = 0;
        Parallel8(seed =&gt;
        {
            var k = seed;
            for (var i = 0; i &lt; 20_000; i++)
            {
                k = (k * 1103515245 + 12345) &amp; int.MaxValue;
                long candidate = k % 1_000_000;
                long current;
                do
                {
                    current = Volatile.Read(ref max);
                    if (candidate &lt;= current) break;
                    if (Interlocked.CompareExchange(ref max, candidate, current) == current) break;
                    Interlocked.Increment(ref retries);
                }
                while (true);
            }
        });
        return (max, retries);
    }

    static (long, int) LockFreeSum()
    {
        long total = 0;
        var retries = 0;
        Parallel8(_ =&gt;
        {
            for (var i = 0; i &lt; 20_000; i++)
            {
                while (true)
                {
                    var current = Volatile.Read(ref total);
                    if (Interlocked.CompareExchange(ref total, current + 1, current) == current) break;
                    Interlocked.Increment(ref retries);
                }
            }
        });
        return (total, retries);
    }

    // --- Exercise 4 -----------------------------------------------------------
    static (int, int) TornPair()
    {
        const int Trials = 20;
        var torn = 0;
        for (var t = 0; t &lt; Trials; t++)
        {
            Volatile.Write(ref _a, 0);
            Volatile.Write(ref _b, 0);
            var stop = new CancellationTokenSource();
            var saw = false;

            var writer = new Thread(() =&gt;
            {
                while (!stop.IsCancellationRequested)
                {
                    Interlocked.Increment(ref _a);
                    Interlocked.Add(ref _b, 1_000);
                }
            }) { IsBackground = true };

            var reader = new Thread(() =&gt;
            {
                while (!stop.IsCancellationRequested)
                {
                    var count = Volatile.Read(ref _a);
                    var total = Volatile.Read(ref _b);
                    if (count &gt; 0 &amp;&amp; total / count != 1_000) { saw = true; return; }
                }
            }) { IsBackground = true };

            writer.Start(); reader.Start();
            Thread.Sleep(20);
            stop.Cancel();
            writer.Join(500); reader.Join(500);
            if (saw) torn++;
        }
        return (torn, Trials);
    }

    // --- Exercise 6 -----------------------------------------------------------
    sealed record Snapshot(long Count, long Total);

    static (int, int) SnapshotTorn()
    {
        const int Trials = 20;
        var torn = 0;
        for (var t = 0; t &lt; Trials; t++)
        {
            var current = new Snapshot(0, 0);
            var stop = new CancellationTokenSource();
            var saw = false;

            var writer = new Thread(() =&gt;
            {
                while (!stop.IsCancellationRequested)
                {
                    while (true)
                    {
                        var observed = Volatile.Read(ref current);
                        var next = new Snapshot(observed.Count + 1, observed.Total + 1_000);
                        if (Interlocked.CompareExchange(ref current, next, observed) == observed) break;
                    }
                }
            }) { IsBackground = true };

            var reader = new Thread(() =&gt;
            {
                while (!stop.IsCancellationRequested)
                {
                    var s = Volatile.Read(ref current);
                    if (s.Count &gt; 0 &amp;&amp; s.Total / s.Count != 1_000) { saw = true; return; }
                }
            }) { IsBackground = true };

            writer.Start(); reader.Start();
            Thread.Sleep(20);
            stop.Cancel();
            writer.Join(500); reader.Join(500);
            if (saw) torn++;
        }
        return (torn, Trials);
    }

    // --- Exercise 5 -----------------------------------------------------------
    static double Contended(bool useLock)
    {
        Thread.Sleep(80);
        _counter = 0;
        var sw = Stopwatch.StartNew();
        Parallel8(_ =&gt;
        {
            for (var i = 0; i &lt; 300_000; i++)
            {
                if (useLock) { lock (Gate) { _counter++; } }
                else Interlocked.Increment(ref _counter);
            }
        });
        return sw.Elapsed.TotalMilliseconds;
    }

    static (double lockMs, double casMs) SnapshotCost()
    {
        Thread.Sleep(80);
        var gate = new object();
        var count = 0L; var total = 0L;
        var sw = Stopwatch.StartNew();
        Parallel8(_ =&gt;
        {
            for (var i = 0; i &lt; 100_000; i++)
                lock (gate) { count++; total += 1_000; }
        });
        var lockMs = sw.Elapsed.TotalMilliseconds;

        Thread.Sleep(80);
        var current = new Snapshot(0, 0);
        sw = Stopwatch.StartNew();
        Parallel8(_ =&gt;
        {
            for (var i = 0; i &lt; 100_000; i++)
            {
                while (true)
                {
                    var observed = Volatile.Read(ref current);
                    var next = new Snapshot(observed.Count + 1, observed.Total + 1_000);
                    if (Interlocked.CompareExchange(ref current, next, observed) == observed) break;
                }
            }
        });
        return (lockMs, sw.Elapsed.TotalMilliseconds);
    }

    static void Parallel8(Action&lt;int&gt; body)
    {
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        for (var t = 0; t &lt; 8; t++)
        {
            var seed = t * 7919 + 1;
            threads[t] = new Thread(() =&gt; { ready.Wait(); body(seed); });
            threads[t].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
    }
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does <code>Interlocked</code> guarantee?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>That an operation on <strong>one memory location</strong> is indivisible — no other thread
        can observe it partway through. Not a lock: no owner, no waiting, nothing to release.</p>
      </div></details>
    </li>
    <li>
      <p>Which operations return the value before, and which after?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Increment</code>, <code>Decrement</code>, <code>Add</code> return the value
        <strong>after</strong>. <code>Exchange</code> and <code>CompareExchange</code> return the value
        <strong>before</strong> — which is what tells you whether you were the thread that made the
        change.</p>
      </div></details>
    </li>
    <li>
      <p>What is the shape of a CAS loop, and which line is easiest to get wrong?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Read, compute, swap-if-unchanged, retry on failure. The <strong>read must be inside the
        loop</strong> — retrying with a stale value either spins forever or clobbers the update that
        beat you.</p>
      </div></details>
    </li>
    <li>
      <p>What decides whether a CAS loop is cheap?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>How often threads actually collide. Measured: a converging <code>Max</code> retried
        <strong>0</strong> times; a <code>Sum</code> where every iteration must swap retried
        <strong>263,083</strong> times for 160,000 operations.</p>
      </div></details>
    </li>
    <li>
      <p>Two fields, both updated with <code>Interlocked</code>. Is a reader safe?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — measured, an impossible value in <strong>30 of 30</strong> trials. Atomic is not
        transactional. Two atomic writes are still two writes, and two reads are still two reads.</p>
      </div></details>
    </li>
    <li>
      <p>Is lock-free faster than locking?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>For one counter, yes — a lock cost <strong>1.8×</strong> an atomic increment. For a
        two-field snapshot, no — the <strong>lock was several times faster</strong>, with 3.4 million
        CAS retries against it. The shape decides.</p>
      </div></details>
    </li>
    <li>
      <p>How do you make two fields updatable atomically without a lock?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Put both in one <strong>immutable</strong> object and swap the reference with a single
        <code>CompareExchange</code>. Conditions: immutable all the way down, no mutable arrays, and
        re-read inside the retry loop.</p>
      </div></details>
    </li>
    <li>
      <p>What does a spinning CAS loop look like in production, and how does it differ from a lock
      problem?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>High CPU with no progress and near-zero lock contention</strong> — it presents as
        saturation, not as a stall. A blocked thread (<a href="#/m/t2-07-sync-over-async-deadlocks">t2-07</a>)
        shows a wait frame and uses no CPU; a spinning one shows your own method and burns a core.</p>
      </div></details>
    </li>
    <li>
      <p>A profiler says a lock is hot. What are the two questions before removing it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>What is it protecting</strong> — one location or an invariant across several? And
        <strong>do reads outnumber writes</strong>? Contention is evidence a lock is used, not evidence
        it is unnecessary.</p>
      </div></details>
    </li>
    <li>
      <p>How would you detect a torn read on a derived value in production?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Assert the invariant where the value is produced — a mean below the fastest observed sample
        is impossible. There is <strong>no counter and no dump</strong> for this; the only detector is
        a check that knows what the value is allowed to be.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
