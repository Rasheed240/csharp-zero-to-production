CSPREP.module({
  id: "t2-11-race-conditions",
  minutes: 55,
  updated: "2026-08-31",
  summary: "Two different defects share the name race condition - operations that are not indivisible, and writes that are never seen - and the popular fix for the second does nothing for the first: a volatile counter lost 1,228,515 of 1,600,000 increments, more than the plain one. The module's central measurement is that identical racy code was correct in 19 of 20 runs at low contention and 0 of 20 at high, which is why this class of bug ships and why a passing test proves almost nothing.",
  terms: ["race condition", "interleaving", "atomic", "atomicity", "visibility", "lost update",
    "check-then-act", "volatile", "Interlocked", "lock", "memory model", "ConcurrentDictionary",
    "GetOrAdd", "idempotency key", "distributed lock"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger deduplicates payments by idempotency key. A client that retries a request must not be
  charged twice, so the service checks whether it has seen the key before. The code is six lines and
  reads correctly from top to bottom:</p>

  <pre data-lang="csharp" data-net="10" data-title="PaymentService.cs"><code>public void Pay(PaymentRequest request)
{
    if (_seen.Contains(request.IdempotencyKey)) return;   // CHECK
    _gateway.Charge(request.Amount);                      // ACT
    _seen.Add(request.IdempotencyKey);
}</code></pre>

  <p>It passed every test. It ran for nine months. Then a client with an aggressive retry policy sent
  the same request eight times in about forty milliseconds, a load balancer spread them across
  threads, and <strong>all eight passed the check before any of them reached the <code>Add</code>.</strong>
  A supplier was paid eight times.</p>

  <p>Nothing failed. No exception was thrown, no latency changed, no counter moved. Every metric the
  service emitted was healthy, because from the service's point of view eight payments were requested
  and eight payments were made. The bug was found by the supplier.</p>

  <p>What makes this class of defect different from every other bug in this track is that
  <strong>there is no input that reproduces it</strong>. The same binary, the same request, the same
  machine will usually behave correctly. Measured here: at low contention, 19 of 20 runs of a racy
  counter produced exactly the right answer. At high contention, 0 of 20 did — with no change to the
  code.</p>

  <p>This module is about the two separate mechanisms that people both call "race conditions" — one
  about operations that are not indivisible, one about writes that are never seen — why the popular
  fix for the second does nothing for the first, and how to establish correctness when testing
  cannot.</p>
</section>

<section id="plain-language">
  <h2>Two different problems with one name</h2>

  <p class="define"><span class="define__term">Thread</span> An independent sequence of instructions
  the operating system can run. Two threads in one process share the same memory, which is what makes
  everything in this module possible and everything in it dangerous.</p>

  <p class="define"><span class="define__term">Interleaving</span> One particular ordering of the
  instructions of several threads. Every run picks a different one, chosen by the scheduler, the
  hardware and the load on the machine. The number of possible interleavings is astronomically
  large.</p>

  <p class="define"><span class="define__term">Atomic</span> Indivisible: an operation no other thread
  can observe partway through. Very few things are atomic by default —
  <code>x++</code> is not.</p>

  <p class="define"><span class="define__term">Race condition</span> A defect whose occurrence
  depends on the interleaving. The code is correct for some orderings and wrong for others, so
  whether it fails is decided by timing rather than by input.</p>

  <p><strong>The two mechanisms.</strong></p>

  <p class="define"><span class="define__term">Atomicity failure</span> An operation that looks like
  one step in source but is several in execution, so another thread can act in the middle.
  <code>x++</code> is read, add, write; check-then-act is two steps with a gap.</p>

  <p class="define"><span class="define__term">Visibility failure</span> A write that one thread
  performs and another never observes, because the compiler, the just-in-time compiler or the
  processor is permitted to cache values in registers and reorder memory operations.</p>

  <p><strong>These are not the same problem and they do not have the same fix.</strong> Confusing them
  is the single most common error in this area, and it has a specific symptom: reaching for
  <code>volatile</code> to fix a counter, which does nothing at all.</p>

  <p><strong>An analogy, and its limits.</strong> Two people update a shared paper tally. Atomicity
  failure: both read "40", both write "41", and one increment is gone. Visibility failure: one writes
  "41" on the sheet but the other is working from a photocopy taken earlier and never looks at the
  original again.</p>

  <p><strong>Where the analogy breaks:</strong> a person would eventually glance at the sheet. A
  thread reading a cached value may <em>never</em> re-read it, because caching it forever is a legal
  optimisation rather than an oversight. And a person notices a discrepancy; the tally in software
  is wrong and nothing says so.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Problem</th><th>Cause</th><th>Example</th><th>Fixed by</th></tr></thead>
    <tbody>
      <tr><td>Atomicity</td><td>Read-modify-write is split</td><td><code>x++</code>, check-then-act</td><td><code>Interlocked</code>, <code>lock</code></td></tr>
      <tr><td>Visibility</td><td>Caching and reordering</td><td>A flag polled in a loop</td><td><code>volatile</code>, <code>lock</code>, <code>Interlocked</code></td></tr>
    </tbody>
  </table>
  </div>

  <p><strong><code>lock</code> fixes both</strong>, which is why it is the right default. It excludes
  other threads (atomicity) and issues memory barriers on entry and exit (visibility).
  <strong><code>volatile</code> fixes only visibility.</strong></p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-minimal-example.cs"><code>// 04-minimal-example.cs — the smallest program that loses updates, and the two
// one-word changes that do and do not fix it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Threading;

class Program
{
    static int _plain;
    static volatile int _volatile;
    static int _atomic;

    static void Main()
    {
        Run("plain int  ++", () =&gt; _plain++, () =&gt; _plain);
        Run("volatile int ++", () =&gt; _volatile++, () =&gt; _volatile);
        Run("Interlocked.Increment", () =&gt; Interlocked.Increment(ref _atomic), () =&gt; _atomic);
    }

    static void Run(string label, Action increment, Func&lt;int&gt; read)
    {
        var threads = new Thread[4];
        for (var t = 0; t &lt; 4; t++)
        {
            threads[t] = new Thread(() =&gt; { for (var i = 0; i &lt; 250_000; i++) increment(); });
            threads[t].Start();
        }
        foreach (var t in threads) t.Join();

        var actual = read();
        Console.WriteLine($"{label,-24} expected 1,000,000, got {actual,9:N0}" +
                          $"   {(actual == 1_000_000 ? "correct" : "LOST " + (1_000_000 - actual))}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>plain int  ++            expected 1,000,000, got   329,925   LOST 670075
volatile int ++          expected 1,000,000, got   318,520   LOST 681480
Interlocked.Increment    expected 1,000,000, got 1,000,000   correct</code></pre>

  <p><strong>Two thirds of a million increments vanished.</strong> Not a rounding error, not an
  off-by-one: most of the work did not survive.</p>

  <p><code>x++</code> compiles to three operations — load the value, add one, store it back. Two
  threads that load "40" at the same moment both store "41", and one increment is gone. With eight
  threads doing this continuously, most increments are lost.</p>

  <p><strong>Now read the second row, which is the useful one.</strong> The <code>volatile</code>
  version lost as much as the plain one. On this run slightly more; on a re-run, slightly less.
  The difference between those two rows is noise. What is not noise is that both are catastrophically
  wrong, and this is the fact worth carrying out of the whole module:</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong><code>volatile</code> does not make an operation atomic.</strong> It changes how a
    field is read and written — forbidding cached reads and constraining reordering — and it does
    nothing whatever to keep read-add-write together. Two threads still read the same value and one
    still overwrites the other.</p>
    <p>Marking a counter <code>volatile</code> to fix a lost-update bug is the most common mistake in
    concurrent .NET. It compiles, it looks deliberate, it survives review, and the measurement above
    is what it achieves.</p>
  </div>

  <p><code>Interlocked.Increment</code> is correct because it is a single processor instruction that
  cannot be interrupted between its read and its write.</p>
</section>

<section id="atomicity">
  <h2>Atomicity: what is and is not one step</h2>

  <pre data-lang="console" data-title="01-interleaving.cs — 8 threads x 200,000 increments"><code>  counter type            result        lost   correct?      ms
  plain int  ++             575,135   1,024,865   NO            3
  volatile int ++           371,485   1,228,515   NO           10
  Interlocked.Increment   1,600,000           0   yes          32
  lock { ++ }             1,600,000           0   yes          52</code></pre>

  <p>Note the timing column alongside the correctness one. The wrong answers are the fast ones,
  because losing an update is cheaper than coordinating. Speed is not evidence of correctness
  here — if anything it is a hint that no coordination is happening.</p>

  <h3>What the mechanisms cost</h3>

  <p>Ten million increments on a single thread, so there is no contention and the numbers are each
  mechanism's own overhead:</p>

  <pre data-lang="console" data-title="01-interleaving.cs"><code>  mechanism                  ns/op   relative
  plain int ++                2.83        1.0x
  volatile int ++             2.86        1.0x
  Interlocked.Increment       9.97        3.5x
  lock { ++ }                27.78        9.8x</code></pre>

  <p>All of these are nanoseconds. <strong>The reason to prefer one over another is almost never this
  table</strong> — it is correctness and clarity. Reach for a <code>lock</code> first, because it
  protects an arbitrary region rather than a single variable and is far harder to get subtly wrong.
  Move to <code>Interlocked</code> when a profiler shows the lock is contended, not before.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>These are <em>uncontended</em> costs. Under contention a lock is dramatically more expensive,
    because a thread that cannot acquire it may be descheduled and rescheduled — microseconds, not
    nanoseconds. That is the real reason to reduce lock scope, and it is why the
    <code>localInit</code>/<code>localFinally</code> pattern from
    <a href="#/m/t2-10-parallelism">t2-10</a> exists: take the lock once per partition rather than
    once per item.</p>
  </div>

  <h3>Check-then-act</h3>

  <p><code>x++</code> is the textbook case; check-then-act is the one you will actually ship. Any
  sequence of the form "if it is not there, put it there" has a gap:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: every one of these has a window"><code>// WRONG. Two threads can both pass the check.
if (!_seen.Contains(key)) { Charge(); _seen.Add(key); }

// WRONG. Same shape, different words.
if (!_cache.ContainsKey(k)) _cache[k] = Compute(k);

// WRONG. Still the same shape.
if (_instance == null) _instance = new Service();

// WRONG. And this one, which people believe is safe because the file
// system is involved.
if (!File.Exists(path)) File.WriteAllText(path, contents);</code></pre>

  <p>The last is worth noticing: making the <em>collection</em> thread-safe does not close the gap,
  because the gap is between two operations rather than inside one.</p>
</section>

<section id="visibility">
  <h2>Visibility: the write nobody sees</h2>

  <p>An entirely different failure. One thread sets a flag; another loops until it sees it. Nothing
  is incremented, nothing is shared except one <code>bool</code>, so atomicity is not the issue:</p>

  <pre data-lang="csharp" data-net="10" data-title="The loop"><code>// Thread A
while (!_stop) { }

// Thread B, 100 ms later
_stop = true;</code></pre>

  <pre data-lang="console" data-title="01-interleaving.cs"><code>  field type      loop exited?      after ms
  plain bool      NO - still spinning  2,115
  volatile bool   yes                  102</code></pre>

  <p><strong>The plain version never exited.</strong> It was still spinning when the two-second
  timeout expired, and it would have spun until the process ended.</p>

  <p>The loop body does not write <code>_stop</code>, so the just-in-time compiler is permitted to
  read it once into a register and spin on that copy. Thread B's write goes to memory and is never
  re-read. <strong>This is a legal optimisation, not a defect in the JIT</strong> — the language's
  memory model allows it precisely because forbidding it everywhere would make all code slower.</p>

  <p><code>volatile</code> forbids it for that field: every read must come from memory.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Do not over-read that measurement. It is not a guarantee that the plain version always hangs —
    whether the read is hoisted depends on the JIT, the platform, the build configuration and the
    exact shape of the loop, and adding almost anything to the body can stop it happening.</p>
    <p><strong>That variability is the danger.</strong> The behaviour is a permitted optimisation, so
    the bug appears when the optimiser improves, when the hardware changes, or when an unrelated edit
    removes whatever was accidentally preventing it. <em>Works in Debug, hangs in Release</em> is the
    classic presentation, because the debug build disables the optimisation that exposes it.</p>
  </div>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>In real code, prefer a <code>CancellationToken</code> to a <code>volatile bool</code>
    (<a href="#/m/t2-08-cancellation">t2-08</a>). It is the same signal with correct memory semantics
    already handled, plus callbacks, linking and timeouts — and every .NET API that can stop early
    already accepts one. A hand-rolled volatile flag is a reimplementation of something better that
    you already have.</p>
  </div>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>The duplicate-payment bug from the opening, and three attempts to fix it. 200 trials, eight
  threads racing on the same idempotency key each time; a correct service charges exactly once per
  trial:</p>

  <pre data-lang="csharp" data-net="10" data-title="02-production.cs"><code>
/// &lt;summary&gt;
/// THE BUG. Check, then act. Between the two, another thread can do the same.
/// &lt;/summary&gt;
public sealed class PaymentServiceV1
{
    private readonly HashSet&lt;string&gt; _seen = new(StringComparer.Ordinal);
    private readonly Gateway _gateway;
    public PaymentServiceV1(Gateway gateway) =&gt; _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        if (_seen.Contains(request.IdempotencyKey)) return;   // CHECK
        _gateway.Charge(request.Amount);                      // ACT
        _seen.Add(request.IdempotencyKey);                    // and record
    }
}

/// &lt;summary&gt;A lock makes check-and-act one indivisible step.&lt;/summary&gt;
public sealed class PaymentServiceV2
{
    private readonly HashSet&lt;string&gt; _seen = new(StringComparer.Ordinal);
    private readonly object _gate = new();
    private readonly Gateway _gateway;
    public PaymentServiceV2(Gateway gateway) =&gt; _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        lock (_gate)
        {
            if (!_seen.Add(request.IdempotencyKey)) return;    // Add returns false if present
            _gateway.Charge(request.Amount);
        }
    }
}

/// &lt;summary&gt;
/// Lock-free, using the atomic test-and-set that ConcurrentDictionary provides.
/// TryAdd is a single atomic operation: there is no gap to race in.
/// &lt;/summary&gt;
public sealed class PaymentServiceV3
{
    private readonly ConcurrentDictionary&lt;string, byte&gt; _seen = new(StringComparer.Ordinal);
    private readonly Gateway _gateway;
    public PaymentServiceV3(Gateway gateway) =&gt; _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        if (!_seen.TryAdd(request.IdempotencyKey, 0)) return;
        _gateway.Charge(request.Amount);</code></pre>

  <pre data-lang="console" data-title="02-production.cs"><code>  implementation                     charges   expected   double-charged
  V1: check, then act                    216        200          3 of 200
  V2: lock around both                   200        200          0 of 200
  V3: ConcurrentDictionary.TryAdd        200        200          0 of 200
  V4: GetOrAdd with a side effect        207        200          1 of 200</code></pre>

  <p><strong>V1 is the shipped bug</strong>, failing 3 times in 200 — about 1.5%. That rate is the
  whole story of why it survived nine months: a defect that fires 1.5% of the time under deliberate
  contention fires far less often under normal traffic, and never in a test suite.</p>

  <p>V1 also has a second defect the charge count does not reveal: <code>HashSet&lt;T&gt;</code> is
  not thread-safe, so concurrent <code>Add</code> calls can corrupt its internal buckets. The
  observable result is a later <code>Contains</code> returning <code>false</code> for a key that was
  added, or an infinite loop inside a lookup on an unrelated thread. The duplicate charge is the
  symptom people noticed; the corrupted set would have been far harder to explain.</p>

  <h3>V4 is the interesting one</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: looks lock-free and correct"><code>// WRONG. GetOrAdd does not promise the factory runs once — it promises
// that one VALUE wins. Under contention the factory can run several times,
// and here the factory charges the card.
_seen.GetOrAdd(request.IdempotencyKey, _ =&gt;
{
    _gateway.Charge(request.Amount);
    return (byte)0;
});</code></pre>

  <p>It uses a thread-safe collection, it has no lock, and it fails — measured at 1 trial in 200.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>A thread-safe collection does not make your operation atomic. It makes each of its own
    methods atomic.</strong> Anything you compose from two of its methods, or any side effect you put
    inside one of them, is a new operation with a new gap.</p>
    <p>If the factory is expensive or has effects, store a <code>Lazy&lt;T&gt;</code> as the value:
    the dictionary then races on cheap <code>Lazy</code> objects, and <code>Lazy</code> itself
    guarantees the factory runs once. This is the same technique as the
    <code>AsyncLazy</code> in <a href="#/m/t2-07-sync-over-async-deadlocks">t2-07</a>.</p>
  </div>

  <h3>Why the tests passed</h3>

  <pre data-lang="console" data-title="02-production.cs"><code>  V1 called 8 times SEQUENTIALLY : 1 charge(s)</code></pre>

  <p>Correct. Every unit test in the suite looked like that, and every one of them passed.</p>

  <p>A race needs two things an ordinary test does not provide: <strong>genuine concurrency</strong>,
  and <strong>enough repetitions</strong> for an unlikely interleaving to occur. A single concurrent
  trial frequently passes too — which is why the table above runs 200 and reports how many failed,
  rather than asserting on one.</p>

  <pre data-lang="csharp" data-net="10" data-title="The test that would have caught it"><code>[Fact]
public void Pay_ChargesOnce_WhenRetriedConcurrently()
{
    for (var trial = 0; trial &lt; 200; trial++)
    {
        var gateway = new Gateway();
        var service = new PaymentService(gateway);
        var key = Guid.NewGuid().ToString();

        Parallel.For(0, 8, _ =&gt; service.Pay(new PaymentRequest(key, 100m)));

        Assert.Equal(1, gateway.Charges);
    }
}</code></pre>

  <p><strong>The loop count is not decoration.</strong> A race that fires 1.5% of the time passes a
  single-trial test 49 times out of 50, and will be marked flaky and retried rather than
  investigated.</p>

  <h3>How it was diagnosed</h3>

  <p>There is no counter for "this happened twice". What surfaced it was a supplier's complaint,
  followed by a query:</p>

  <pre data-lang="sql" data-title="The query that found it"><code>SELECT idempotency_key, COUNT(*)
FROM   charges
GROUP  BY idempotency_key
HAVING COUNT(*) &gt; 1;</code></pre>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A race on a business invariant is invisible to every runtime metric you have.</strong>
    No exception, no latency change, no memory signature, no error rate. It is visible only in the
    data. If an invariant matters — one charge per key, one row per order, one email per event —
    assert it in the data continuously, because that is the only place this class of defect leaves a
    trace.</p>
    <p>Better still, make the database enforce it. A unique index on <code>idempotency_key</code>
    turns a silent duplicate into a constraint violation you can catch and handle.</p>
    <p><strong>And note what that implies about V2 and V3 above:</strong> both are correct within a
    process, and neither is sufficient across a horizontally scaled deployment. The lock is
    per-instance. Two pods have two locks and no shared state, so both will charge. In-process
    synchronisation protects one process; only a shared authority — the database, or a distributed
    lock — can arbitrate between replicas.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Using <code>volatile</code> where you need atomicity</h3>

  <p>Measured: a <code>volatile</code> counter lost 1,228,515 of 1,600,000 increments, against the
  plain one at 1,024,865 — the same order of loss, with which is worse varying between runs.
  <code>volatile</code> is for visibility only.</p>

  <h3>2. Check-then-act on any shared state</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the gap is between the two lines"><code>// WRONG
if (!_dict.ContainsKey(k)) _dict[k] = Compute(k);

// Right: one atomic operation.
_dict.TryAdd(k, Compute(k));

// Right, when the computation is expensive and must not repeat.
_dict.GetOrAdd(k, key =&gt; new Lazy&lt;Result&gt;(() =&gt; Compute(key))).Value;</code></pre>

  <h3>3. Assuming a thread-safe collection makes your code thread-safe</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: two atomic calls are not one atomic operation"><code>// WRONG. Both calls are individually atomic; the pair is not.
if (_concurrent.TryGetValue(k, out var v))
    _concurrent[k] = v + 1;                 // another thread may have written between

// Right: the collection has an atomic update for exactly this.
_concurrent.AddOrUpdate(k, 1, (_, existing) =&gt; existing + 1);</code></pre>

  <h3>4. Locking on the wrong object</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: three ways to have no mutual exclusion"><code>// WRONG. Each caller creates its own lock object, so nothing is excluded.
public void Add(int x) { var gate = new object(); lock (gate) { _total += x; } }

// WRONG. Boxing means each lock() takes a different object.
private int _lockCounter;
lock (_lockCounter) { }                     // does not even compile in modern C#

// WRONG. A public object, or a type, can be locked by anyone — including
// code you do not control, which can deadlock you.
lock (this) { }
lock (typeof(PaymentService)) { }
lock ("payment-lock") { }                   // interned: shared process-wide

// Right: a private, readonly, dedicated object.
private readonly object _gate = new();
lock (_gate) { _total += x; }</code></pre>

  <p>The string case is the nastiest, because string literals are interned: every part of the process
  using the same literal takes the same lock, including libraries you did not write.</p>

  <h3>5. Treating a flaky concurrent test as noise</h3>

  <p>A test that fails one run in fifty is reporting a defect that occurs one run in fifty. Retrying
  it discards the only evidence you are going to get.</p>

  <h3>6. Assuming in-process locking is enough</h3>

  <p>A <code>lock</code> protects one process. The moment you run two replicas there are two locks and
  no coordination between them. Correctness across instances requires a shared authority — a unique
  constraint, an atomic database operation, or a distributed lock with a lease.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a business invariant is violated in the data — a duplicate charge, a
    lost update, a counter that does not reconcile — with no error anywhere.</p>
    <p><strong>Why:</strong> a race. There is no runtime signal, because from the code's point of view
    nothing went wrong.</p>
    <p><strong>Tool:</strong> the database, not the profiler:</p>
    <pre data-lang="sql" data-title="Assert invariants in the data"><code>SELECT idempotency_key, COUNT(*)
FROM   charges
GROUP  BY idempotency_key
HAVING COUNT(*) &gt; 1;</code></pre>
    <p><strong>Reading it:</strong> any row is a race, and the timestamps will be within milliseconds
    of each other. That closeness is itself the diagnosis: duplicates seconds apart are a retry
    problem; duplicates milliseconds apart are a concurrency problem.</p>
    <p><strong>Fix:</strong> a unique constraint so the database enforces the invariant, plus an
    atomic operation in the code. Run this query on a schedule, not once — it is the only detector you
    have.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a test fails occasionally and passes on retry.</p>
    <p><strong>Why:</strong> almost certainly a real race. Concurrency defects present exactly like
    this, and "flaky" is how they get filed and ignored.</p>
    <p><strong>Tool:</strong> raise the contention and the repetition count until it becomes
    reliable:</p>
    <pre data-lang="csharp" data-net="10" data-title="Turning a flaky failure into a reproducible one"><code>[Fact]
public void Invariant_HoldsUnderContention()
{
    var failures = 0;
    for (var trial = 0; trial &lt; 500; trial++)
    {
        var subject = new Subject();
        var ready = new ManualResetEventSlim(false);
        var threads = Enumerable.Range(0, Environment.ProcessorCount)
            .Select(_ =&gt; new Thread(() =&gt; { ready.Wait(); subject.Act(); }))
            .ToArray();

        foreach (var t in threads) t.Start();
        ready.Set();                       // release them together
        foreach (var t in threads) t.Join();

        if (!subject.IsCorrect) failures++;
    }
    Assert.Equal(0, failures);
}</code></pre>
    <p><strong>Reading it:</strong> the <code>ManualResetEventSlim</code> is the important part — it
    releases every thread at the same instant, which widens the window enormously compared with
    starting them in a loop. Measured, this turned a defect that never appeared in normal testing into
    one that fires reliably.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a loop never terminates, or a thread appears stuck with no lock
    involved. Works in Debug, hangs in Release.</p>
    <p><strong>Why:</strong> a visibility failure. A field read has been hoisted out of the loop.</p>
    <p><strong>Tool:</strong> a dump, and look at what the thread is doing:</p>
    <pre data-lang="console" data-title="Confirming a spin"><code>dotnet-dump collect --process-id 4812
dotnet-dump analyze core_20260831.dmp
&gt; clrstack -all</code></pre>
    <p><strong>Reading it:</strong> a thread sitting in your own method with high CPU and no blocking
    frame — no <code>Monitor.Wait</code>, no <code>GetResult</code> — is spinning. Contrast with
    <a href="#/m/t2-07-sync-over-async-deadlocks">t2-07</a>, where a blocked thread shows a wait frame
    and consumes no CPU. <strong>Spinning burns a core; blocking does not.</strong></p>
    <p><strong>Fix:</strong> <code>volatile</code>, <code>Volatile.Read</code>, or better, a
    <code>CancellationToken</code>.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> you want to find races by inspection rather than by incident.</p>
    <p><strong>Tool:</strong> a review question applied to every field, which is more effective here
    than any analyser: <em>is this written by more than one thread, or written by one and read by
    another?</em> If yes, it needs a lock, an <code>Interlocked</code> operation, or
    <code>volatile</code> — and which one depends on whether the problem is atomicity or
    visibility.</p>
    <p><strong>The highest-yield places to look:</strong> <code>static</code> mutable fields; fields
    of any type registered as a dependency-injection singleton; anything captured by a lambda passed
    to <code>Parallel.*</code> or <code>Task.Run</code>; and any <code>List&lt;T&gt;</code> or
    <code>Dictionary&lt;K,V&gt;</code> reachable from more than one request.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The severity is decided by load, so testing systematically underestimates it.</strong>
    The identical racy counter produced the correct answer in 19 of 20 runs at low contention and in
    0 of 20 at high contention. Development machines are quiet, test suites are small and sequential,
    and production is neither. A defect that is invisible everywhere you look before release can be
    certain in production — and the first time you see it is under the traffic that made it
    certain.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>There is no monitoring for wrongness.</strong> The duplicate-payment bug produced no
    exception, no latency change, no memory signature and no error-rate movement. Every one of the
    other failures in this track announces itself somewhere — blocking shows idle CPU with rising
    queues, buffering shows memory tracking request size, saturation pins the processor. A race
    announces nothing. It was found by a supplier reading their bank statement.</p>
    <p>This is the argument for asserting invariants in the data on a schedule, and for making the
    database enforce the ones that matter with a constraint. Those are the only detectors that
    exist.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The fix that works on one instance stops working the day you scale out.</strong> Both
    correct in-process versions — the lock and the <code>TryAdd</code> — charge exactly once in 200
    trials, and both charge twice the moment you run two replicas, because each process has its own
    lock and its own dictionary. Horizontal scaling is usually treated as a deployment change rather
    than a correctness change, so this defect is typically introduced by someone who never opened the
    file. Anything that must be unique across a system needs an authority outside the process.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>volatile</code> makes it thread-safe."</strong> It addresses visibility only.
    Measured: a <code>volatile</code> counter lost <strong>1,228,515 of 1,600,000</strong>
    increments — no better than the plain version, and which of the two loses more varies between
    runs. If the operation is read-modify-write, you need <code>Interlocked</code> or a lock.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>x++</code> is one operation."</strong> It is three: load, add, store. Two
    threads that load the same value both store the same result and one increment disappears.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I used a <code>ConcurrentDictionary</code>, so it is safe."</strong> Its own methods
    are atomic; your composition of them is not. Measured: <code>GetOrAdd</code> with a side effect in
    the factory double-charged in 1 trial of 200, because the factory is not guaranteed to run
    once.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The test passes, so there is no race."</strong> The same racy code was correct in 19
    of 20 runs at low contention. A passing test is weak evidence; run hundreds of trials, release the
    threads simultaneously, and assert on the failure count.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"It works on my machine."</strong> That is a claim about one interleaving out of an
    enormous number, on a quiet machine, not a claim about correctness. Nothing about the code changed
    between 19-of-20 correct and 0-of-20 correct.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A flaky concurrent test is a test problem."</strong> It is a defect that occurs at the
    rate the test fails. Retrying it discards the only evidence you will get, and the failure rate is
    load-dependent — it will be higher in production than in CI.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>lock</code> is slow, so I should use <code>Interlocked</code>."</strong>
    Measured uncontended at 27.78 ns against 9.97 ns — both nanoseconds. Prefer the lock for clarity
    and because it protects a region rather than a variable; optimise when a profiler shows
    contention, not before.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"My locking makes this correct."</strong> Within one process. Two replicas have two
    locks and will both proceed. Uniqueness across a system needs a database constraint or a
    distributed lock.</p>
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
    <p>Four threads, 250,000 increments each. Which of these produce 1,000,000?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>static int _counter;                    // (a)  _counter++
static volatile int _volatileCounter;   // (b)  _volatileCounter++
static int _atomic;                     // (c)  Interlocked.Increment(ref _atomic)</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  variant                     result   correct?
  x++                         357,229   NO
  volatile x++                299,071   NO
  Interlocked.Increment     1,000,000   yes</code></pre>
        <p><strong>Only (c).</strong> And the row that teaches something is (b): the
        <code>volatile</code> version was <em>worse</em> than the plain one.</p>
        <p><code>volatile</code> constrains how a field is read and written — no cached reads, limited
        reordering. It does nothing to keep read-add-write together, so two threads still load the
        same value and one overwrites the other. Marking a counter <code>volatile</code> to fix lost
        updates is the most common mistake in concurrent .NET, and it makes the code look
        deliberately synchronised while changing nothing about the defect.</p>
        <p>Do not read anything into (b) scoring worse than (a) here. Re-running reverses that
        ordering; the two are equally broken and the gap between them is scheduling noise.</p>
        <p><code>Interlocked.Increment</code> works because it is a single processor instruction that
        cannot be interrupted between its read and its write. A <code>lock</code> also works, by
        excluding other threads for the duration.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Where exactly is the window, and how wide is it?</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 2"><code>if (!_seen.Contains(key)) { Charge(); _seen.Add(key); }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  implementation                 trials wrong
    check-then-act                  5 of 200
    lock around both                0 of 200
    ConcurrentDictionary.TryAdd     0 of 200</code></pre>
        <p><strong>The window is between the <code>Contains</code> and the <code>Add</code></strong>,
        and it spans the <code>Charge()</code> call. Every thread that arrives inside it sees "not
        present" and proceeds to charge.</p>
        <p>It is nanoseconds wide, and it failed 5 times in 200 — about 2.5% — with eight threads
        released simultaneously. Under ordinary traffic that rate is far lower, which is exactly why
        this survives testing and then fires during a client's retry storm.</p>
        <p><strong>Both fixes work, and they are not equivalent.</strong> The lock makes check-and-act
        one indivisible region, which generalises to any number of steps.
        <code>ConcurrentDictionary.TryAdd</code> is a single atomic test-and-set — there is no gap to
        race in — and it is lock-free, but it only works because the whole decision fits in one
        operation. When it does, prefer it; when it does not, use the lock.</p>
        <p>Note the shape rather than the API. <code>if (!File.Exists(p)) File.Write(p)</code> and
        <code>if (_instance == null) _instance = new()</code> are the same bug.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>This uses a thread-safe collection and no lock. Is it correct?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>_seen.GetOrAdd(key, _ =&gt; { Charge(); return (byte)0; });</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    GetOrAdd with a side effect     1 of 200 trials wrong</code></pre>
        <p><strong>No.</strong> <code>ConcurrentDictionary</code> guarantees that one <em>value</em>
        wins, not that the factory runs once. Under contention several threads can invoke the factory
        concurrently; one result is stored and the others are discarded — but the side effects of the
        discarded calls already happened.</p>
        <p>Here the discarded call charged a card. The dictionary ends up perfectly consistent with
        one entry, and the customer has been charged twice.</p>
        <p><strong>The general rule this teaches</strong> is worth more than the specific API: a
        thread-safe collection makes <em>its own methods</em> atomic. Anything you compose from two
        calls, or any side effect you place inside one, is a new operation with a new gap.</p>
        <p><strong>Two correct approaches.</strong> If the decision fits in one atomic operation, use
        it — <code>TryAdd</code> returns <code>false</code> when the key was already present, so the
        charge can happen only on the winning path. If the factory is expensive or must not repeat,
        store a <code>Lazy&lt;T&gt;</code>:</p>
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>// The dictionary races on cheap Lazy objects; Lazy guarantees single execution.
_seen.GetOrAdd(key, k =&gt; new Lazy&lt;byte&gt;(() =&gt;
{
    Charge();
    return 0;
}, LazyThreadSafetyMode.ExecutionAndPublication)).Value;</code></pre>
        <p>The losing threads construct a <code>Lazy</code> that is thrown away without ever being
        evaluated, so the expensive work happens exactly once. This is the same technique as the
        <code>AsyncLazy</code> in <a href="#/m/t2-07-sync-over-async-deadlocks">t2-07</a>.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Why does this loop never end, and why is <code>volatile</code> the right fix here when it was
    the wrong one in exercise 1?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>// Thread A
while (!_stop) { }

// Thread B, 100 ms later
_stop = true;</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    plain bool     : STILL SPINNING after 2,128 ms
    volatile bool  : exited after 103 ms</code></pre>
        <p><strong>The loop body does not write <code>_stop</code></strong>, so the just-in-time
        compiler may read it once into a register and spin on that copy forever. Thread B's write
        reaches memory and is never re-read. This is a permitted optimisation, not a defect in the
        JIT — forbidding it everywhere would slow down all code.</p>
        <p><strong>Why <code>volatile</code> is right here and wrong in exercise 1:</strong> these are
        two different problems. Exercise 1 is an <em>atomicity</em> failure — three operations that
        must stay together. This is a <em>visibility</em> failure — one operation whose result must be
        seen. <code>volatile</code> addresses visibility and nothing else, so it fixes this and does
        nothing for that.</p>
        <p><strong>In real code, do not write this at all.</strong> Use a
        <code>CancellationToken</code> (<a href="#/m/t2-08-cancellation">t2-08</a>): it is the same
        signal with the memory semantics already correct, plus callbacks, linking and timeouts — and
        every .NET API that can stop early already accepts one. A hand-rolled volatile flag
        reimplements something better that you already have, and gets the reimplementation wrong more
        often than not.</p>
        <p><strong>One diagnostic note:</strong> a spinning thread burns a whole core, whereas a
        blocked thread consumes none. In a dump, a thread in your own method with high CPU and no wait
        frame is spinning — which distinguishes this immediately from the blocking failures in
        <a href="#/m/t2-07-sync-over-async-deadlocks">t2-07</a>.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>The same racy counter is run 20 times at two contention levels. Predict the results, then say
    what it implies about testing concurrent code.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  increments/thread   distinct results   correct runs   lowest
             50,000                  2             19       94,270
            500,000                 20              0      755,437</code></pre>
        <p><strong>At low contention the bug is nearly invisible — 19 of 20 runs were exactly
        right.</strong> At ten times the contention, the identical code was wrong every single
        time.</p>
        <p><strong>Nothing about the code changed between those rows.</strong> What changed is how
        much opportunity the threads had to interleave. That is why this class of defect ships:
        development machines are quiet, test suites are small and mostly sequential, and production is
        neither.</p>
        <p><strong>What it implies about testing:</strong></p>
        <p><em>A passing test is weak evidence.</em> A single trial of the low-contention case passes
        95% of the time. To get signal you need many trials, high contention, and an assertion on the
        failure <em>count</em> rather than on one run.</p>
        <p><em>A flaky test in concurrent code is a bug report.</em> The failure rate is the defect
        rate at that contention level, and production contention is higher than CI contention.
        Retrying discards the only evidence you will get.</p>
        <p><em>Testing cannot establish the absence of a race.</em> You can raise your confidence but
        never demonstrate that no bad interleaving exists. Correctness has to come from construction
        and reasoning — make the operation atomic, or make the state unshared — with tests as a check
        on your reasoning rather than as the source of the guarantee.</p>
        <p>The practical technique for raising contention deliberately: create the threads, have them
        all wait on one <code>ManualResetEventSlim</code>, and release them together. Starting threads
        in a loop lets the first finish before the last begins.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Your fix for the duplicate-payment bug works, and passes 200 concurrent trials. The service is
    then scaled from one replica to three. What happens, and what do you do?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The bug returns, in full.</strong> Both in-process fixes — the lock and the
        <code>ConcurrentDictionary</code> — protect state that lives inside one process. Three
        replicas have three locks, three dictionaries, and no knowledge of each other. Eight retries
        spread across three pods will charge up to three times.</p>
        <p><strong>Worse, the change that reintroduced it was a deployment change.</strong> Nobody
        opened the file. The correctness of the code now depends on a replica count configured
        elsewhere by someone with no reason to know.</p>
        <p><strong>What to do, in order of preference.</strong></p>
        <p><em>Make the database enforce it.</em> A unique index on <code>idempotency_key</code> turns
        a duplicate into a constraint violation you catch and treat as "already processed". This is
        the only option that is correct by construction, survives any replica count, and needs no
        coordination protocol:</p>
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>try
{
    await _db.Charges.AddAsync(new Charge(key, amount), ct);
    await _db.SaveChangesAsync(ct);              // unique index on key
    await _gateway.ChargeAsync(amount, ct);
}
catch (DbUpdateException ex) when (IsUniqueViolation(ex))
{
    return;                                      // another instance got there first
}</code></pre>
        <p><em>Or use an atomic operation in a shared store</em> — a conditional write, or
        <code>SET key value NX</code> in Redis — which is the same idea without a relational
        database.</p>
        <p><em>A distributed lock is the last resort</em>, because it introduces failure modes the
        others do not have: lease expiry while you still hold it, clock skew, and what to do when the
        lock service is unavailable. It is occasionally necessary and should not be the first
        reach.</p>
        <p><strong>Note the ordering problem in the code above</strong>, which the exercise is really
        about: the row is written before the gateway is called. If the charge then fails, the key is
        recorded and the retry will be rejected as a duplicate — a payment silently lost. The other
        order double-charges instead. Neither is correct on its own, and this is why real payment
        systems record an <em>intent</em> first, call the gateway, then record the outcome — so a
        crash between the two leaves a row that reconciliation can find and resolve.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 02-production.cs -c Release</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-interleaving.cs"><code>// 01-interleaving.cs — the two independent problems people call "race
// conditions": operations that are not atomic, and writes that are not visible.
// They have different causes and different fixes, and confusing them is why
// volatile gets used where it does not help.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-interleaving.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int Threads = 8;
    const int PerThread = 200_000;

    static int _plain;
    static int _interlocked;
    static volatile int _volatile;
    static int _locked;
    static readonly object Gate = new();

    static void Main()
    {
        Console.WriteLine("=== problem one: ++ is not atomic ===");
        Console.WriteLine();
        Console.WriteLine($"  {Threads} threads each increment a counter {PerThread:N0} times.");
        Console.WriteLine($"  The correct answer is {Threads * PerThread:N0} in every case.");
        Console.WriteLine();
        Console.WriteLine("  counter type            result        lost   correct?      ms");

        Run("plain int  ++", () =&gt; _plain++, () =&gt; _plain, v =&gt; _plain = v);
        Run("volatile int ++", () =&gt; _volatile++, () =&gt; _volatile, v =&gt; _volatile = v);
        Run("Interlocked.Increment", () =&gt; Interlocked.Increment(ref _interlocked),
            () =&gt; _interlocked, v =&gt; _interlocked = v);
        Run("lock { ++ }", () =&gt; { lock (Gate) _locked++; }, () =&gt; _locked, v =&gt; _locked = v);

        Console.WriteLine();
        Console.WriteLine("  READ THE VOLATILE ROW. It lost MORE updates than the plain int, not");
        Console.WriteLine("  fewer. This is the single most useful thing in this file:");
        Console.WriteLine();
        Console.WriteLine("      volatile does NOT make an operation atomic.");
        Console.WriteLine();
        Console.WriteLine("  x++ is three machine operations — read, add, write. volatile changes");
        Console.WriteLine("  how the READ and the WRITE are ordered and cached. It does nothing");
        Console.WriteLine("  whatever to keep the three together, so two threads still read the");
        Console.WriteLine("  same value and one overwrites the other.");
        Console.WriteLine();
        Console.WriteLine("  Interlocked and lock both fix it, by different means: Interlocked");
        Console.WriteLine("  uses a single processor instruction that cannot be interrupted, and");
        Console.WriteLine("  lock excludes other threads for the duration.");

        Console.WriteLine();
        Console.WriteLine("=== problem two: a write that is never seen ===");
        Console.WriteLine();
        Console.WriteLine("  A different failure entirely. One thread sets a flag; another loops");
        Console.WriteLine("  until it sees it. Nothing is being incremented and nothing is shared");
        Console.WriteLine("  except one bool, so atomicity is not the issue.");
        Console.WriteLine();
        Console.WriteLine("  field type      loop exited?      after ms");
        Visibility(useVolatile: false);
        Visibility(useVolatile: true);
        Console.WriteLine();
        Console.WriteLine("  This is the problem volatile actually solves. The JIT is allowed to");
        Console.WriteLine("  hoist a non-volatile field read out of a loop — it can see that the");
        Console.WriteLine("  loop body does not write the field, so it reads once into a register");
        Console.WriteLine("  and spins on that. The other thread's write lands in memory and is");
        Console.WriteLine("  never re-read.");
        Console.WriteLine();
        Console.WriteLine("  On this machine — x64, Release, .NET 10 — the plain version NEVER");
        Console.WriteLine("  exited. It was still spinning when the two-second timeout expired,");
        Console.WriteLine("  and it would have spun until the process ended.");
        Console.WriteLine();
        Console.WriteLine("  It is important not to over-read that. This is not a guarantee that");
        Console.WriteLine("  the plain version always hangs: whether the read is hoisted depends");
        Console.WriteLine("  on the JIT, the platform and the exact shape of the loop, and adding");
        Console.WriteLine("  almost anything to the loop body can stop it happening.");
        Console.WriteLine();
        Console.WriteLine("  That variability IS the danger. The behaviour is a legal optimisation");
        Console.WriteLine("  rather than a mistake, so the bug appears when the optimiser improves,");
        Console.WriteLine("  when the hardware changes, or when an unrelated edit removes whatever");
        Console.WriteLine("  was accidentally preventing it. Code that works in Debug and hangs in");
        Console.WriteLine("  Release is the classic presentation.");

        Console.WriteLine();
        Console.WriteLine("=== the two problems, side by side ===");
        Console.WriteLine();
        Console.WriteLine("  problem        cause                        fixed by");
        Console.WriteLine("  atomicity      read-modify-write split      Interlocked, lock");
        Console.WriteLine("  visibility     caching and reordering       volatile, lock, Interlocked");
        Console.WriteLine();
        Console.WriteLine("  Note that lock fixes BOTH, which is why it is the right default. It");
        Console.WriteLine("  excludes other threads (atomicity) and issues memory barriers on");
        Console.WriteLine("  entry and exit (visibility).");
        Console.WriteLine();
        Console.WriteLine("  volatile fixes ONLY visibility. Reaching for it to fix a counter is");
        Console.WriteLine("  the most common mistake in this area, and the measurement above is");
        Console.WriteLine("  what happens when you do.");

        Console.WriteLine();
        Console.WriteLine("=== the cost of each ===");
        Console.WriteLine();
        Console.WriteLine("  10,000,000 increments on ONE thread, so there is no contention and");
        Console.WriteLine("  the numbers are the mechanism's own overhead:");
        Console.WriteLine();
        Console.WriteLine("  mechanism                  ns/op   relative");
        var plainNs = Bench(() =&gt; _plain++);
        Console.WriteLine($"  plain int ++             {plainNs,7:N2}   {1.0,8:N1}x");
        var volNs = Bench(() =&gt; _volatile++);
        Console.WriteLine($"  volatile int ++          {volNs,7:N2}   {volNs / plainNs,8:N1}x");
        var intNs = Bench(() =&gt; Interlocked.Increment(ref _interlocked));
        Console.WriteLine($"  Interlocked.Increment    {intNs,7:N2}   {intNs / plainNs,8:N1}x");
        var lockNs = Bench(() =&gt; { lock (Gate) _locked++; });
        Console.WriteLine($"  lock {{ ++ }}              {lockNs,7:N2}   {lockNs / plainNs,8:N1}x");
        Console.WriteLine();
        Console.WriteLine("  All of them are nanoseconds. The reason to prefer one over another is");
        Console.WriteLine("  almost never this table — it is correctness and clarity. Reach for a");
        Console.WriteLine("  lock first; move to Interlocked when a profiler tells you the lock is");
        Console.WriteLine("  contended, not before.");
    }

    static void Run(string label, Action increment, Func&lt;int&gt; read, Action&lt;int&gt; reset)
    {
        reset(0);
        var sw = Stopwatch.StartNew();
        var threads = new Thread[Threads];
        for (var t = 0; t &lt; Threads; t++)
        {
            threads[t] = new Thread(() =&gt;
            {
                for (var i = 0; i &lt; PerThread; i++) increment();
            });
            threads[t].Start();
        }
        foreach (var th in threads) th.Join();
        sw.Stop();

        var expected = Threads * PerThread;
        var actual = read();
        Console.WriteLine($"  {label,-22} {actual,10:N0}  {expected - actual,10:N0}   " +
                          $"{(actual == expected ? "yes" : "NO"),-8} {sw.Elapsed.TotalMilliseconds,6:N0}");
    }

    static void Visibility(bool useVolatile)
    {
        var box = new Flag();
        var sw = Stopwatch.StartNew();
        var exited = false;

        var spinner = new Thread(() =&gt;
        {
            if (useVolatile) { while (!box.VolatileStop) { } }
            else { while (!box.PlainStop) { } }
            exited = true;
        }) { IsBackground = true };

        spinner.Start();
        Thread.Sleep(100);
        box.PlainStop = true;
        box.VolatileStop = true;
        var joined = spinner.Join(TimeSpan.FromSeconds(2));
        sw.Stop();

        Console.WriteLine($"  {(useVolatile ? "volatile bool" : "plain bool"),-15} " +
                          $"{(joined ? "yes" : "NO - still spinning"),-17} " +
                          $"{sw.Elapsed.TotalMilliseconds,6:N0}");
        Volatile.Write(ref box.VolatileStopBacking, true);
        GC.KeepAlive(exited);
    }

    sealed class Flag
    {
        public bool PlainStop;
        public bool VolatileStopBacking;
        public volatile bool VolatileStopField;

        public bool VolatileStop
        {
            get =&gt; VolatileStopField;
            set =&gt; VolatileStopField = value;
        }
    }

    static double Bench(Action a)
    {
        const int Reps = 10_000_000;
        for (var i = 0; i &lt; 100_000; i++) a();     // warm up and JIT
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; Reps; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / Reps;
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-production.cs"><code>// 02-production.cs — Ledger's duplicate-payment bug. A check-then-act race that
// passed every test, survived nine months, and paid one supplier twice.
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

namespace Ledger.Payments;

public sealed record PaymentRequest(string IdempotencyKey, decimal Amount);

/// &lt;summary&gt;Stands in for the payment gateway. Counts how many times it charged.&lt;/summary&gt;
public sealed class Gateway
{
    private int _charges;
    public int Charges =&gt; Volatile.Read(ref _charges);
    public void Reset() =&gt; Volatile.Write(ref _charges, 0);

    public void Charge(decimal amount) =&gt; Interlocked.Increment(ref _charges);
}

/// &lt;summary&gt;
/// THE BUG. Check, then act. Between the two, another thread can do the same.
/// &lt;/summary&gt;
public sealed class PaymentServiceV1
{
    private readonly HashSet&lt;string&gt; _seen = new(StringComparer.Ordinal);
    private readonly Gateway _gateway;
    public PaymentServiceV1(Gateway gateway) =&gt; _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        if (_seen.Contains(request.IdempotencyKey)) return;   // CHECK
        _gateway.Charge(request.Amount);                      // ACT
        _seen.Add(request.IdempotencyKey);                    // and record
    }
}

/// &lt;summary&gt;A lock makes check-and-act one indivisible step.&lt;/summary&gt;
public sealed class PaymentServiceV2
{
    private readonly HashSet&lt;string&gt; _seen = new(StringComparer.Ordinal);
    private readonly object _gate = new();
    private readonly Gateway _gateway;
    public PaymentServiceV2(Gateway gateway) =&gt; _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        lock (_gate)
        {
            if (!_seen.Add(request.IdempotencyKey)) return;    // Add returns false if present
            _gateway.Charge(request.Amount);
        }
    }
}

/// &lt;summary&gt;
/// Lock-free, using the atomic test-and-set that ConcurrentDictionary provides.
/// TryAdd is a single atomic operation: there is no gap to race in.
/// &lt;/summary&gt;
public sealed class PaymentServiceV3
{
    private readonly ConcurrentDictionary&lt;string, byte&gt; _seen = new(StringComparer.Ordinal);
    private readonly Gateway _gateway;
    public PaymentServiceV3(Gateway gateway) =&gt; _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        if (!_seen.TryAdd(request.IdempotencyKey, 0)) return;
        _gateway.Charge(request.Amount);
    }
}

/// &lt;summary&gt;
/// WRONG in a subtle way: GetOrAdd's factory is NOT atomic. It can run more than
/// once for the same key under contention, so the charge can happen twice even
/// though only one entry ends up in the dictionary.
/// &lt;/summary&gt;
public sealed class PaymentServiceV4
{
    private readonly ConcurrentDictionary&lt;string, byte&gt; _seen = new(StringComparer.Ordinal);
    private readonly Gateway _gateway;
    public PaymentServiceV4(Gateway gateway) =&gt; _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        _seen.GetOrAdd(request.IdempotencyKey, _ =&gt;
        {
            _gateway.Charge(request.Amount);      // side effect inside the factory
            return 0;
        });
    }
}

class Program
{
    const int Attempts = 8;
    const int Trials = 200;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger deduplicates payments by idempotency key. A client that");
        Console.WriteLine("  retries a request must not be charged twice, so the service checks");
        Console.WriteLine("  whether it has seen the key before:");
        Console.WriteLine();
        Console.WriteLine("      if (_seen.Contains(key)) return;   // CHECK");
        Console.WriteLine("      _gateway.Charge(amount);           // ACT");
        Console.WriteLine("      _seen.Add(key);");
        Console.WriteLine();
        Console.WriteLine("  It is correct when read top to bottom, and it passed every test,");
        Console.WriteLine("  because every test called it one thread at a time.");
        Console.WriteLine();
        Console.WriteLine("  In production a client with an aggressive retry policy sent the same");
        Console.WriteLine("  request eight times in about 40 ms. A load balancer spread them");
        Console.WriteLine("  across threads. All eight passed the check before any of them");
        Console.WriteLine("  reached the Add.");
        Console.WriteLine();
        Console.WriteLine($"  {Trials} trials, {Attempts} simultaneous retries of the SAME key.");
        Console.WriteLine("  A correct service charges exactly once per trial.");
        Console.WriteLine();
        Console.WriteLine("  implementation                     charges   expected   double-charged");

        Trial("V1: check, then act", g =&gt; new PaymentServiceV1(g));
        Trial("V2: lock around both", g =&gt; new PaymentServiceV2(g));
        Trial("V3: ConcurrentDictionary.TryAdd", g =&gt; new PaymentServiceV3(g));
        Trial("V4: GetOrAdd with a side effect", g =&gt; new PaymentServiceV4(g));

        Console.WriteLine();
        Console.WriteLine("  V1 is the shipped bug. The window between the check and the record is");
        Console.WriteLine("  a few nanoseconds wide, which is why nine months of traffic passed");
        Console.WriteLine("  through it without incident — and why one client's retry storm went");
        Console.WriteLine("  straight through it.");
        Console.WriteLine();
        Console.WriteLine("  V1 has a SECOND defect the charge count does not show: HashSet&lt;T&gt; is");
        Console.WriteLine("  not thread-safe, so concurrent Add calls can corrupt its buckets.");
        Console.WriteLine("  The observable result of that is a later Contains returning false for");
        Console.WriteLine("  a key that was added, or an infinite loop inside the lookup. The");
        Console.WriteLine("  duplicate charge is the symptom people noticed; the corrupted set is");
        Console.WriteLine("  the one that would have been harder to explain.");
        Console.WriteLine();
        Console.WriteLine("  V4 is the interesting failure. It LOOKS lock-free and correct, and it");
        Console.WriteLine("  uses a thread-safe collection. But ConcurrentDictionary.GetOrAdd does");
        Console.WriteLine("  not promise the factory runs once — it promises one VALUE wins. Under");
        Console.WriteLine("  contention the factory can run several times, and here the factory");
        Console.WriteLine("  charges the card.");
        Console.WriteLine();
        Console.WriteLine("  That is the general rule worth carrying: a thread-safe COLLECTION does");
        Console.WriteLine("  not make your OPERATION atomic. It makes each of its own methods");
        Console.WriteLine("  atomic. Anything you compose from two of them is a new operation with");
        Console.WriteLine("  a new gap.");

        Console.WriteLine();
        Console.WriteLine("=== why the tests passed ===");
        Console.WriteLine();
        var single = SingleThreaded();
        Console.WriteLine($"  V1 called 8 times SEQUENTIALLY : {single} charge(s)");
        Console.WriteLine("  Correct. Every unit test in the suite looked like this.");
        Console.WriteLine();
        Console.WriteLine("  A race needs two things a normal test does not provide: genuine");
        Console.WriteLine("  concurrency, and enough repetitions for an unlikely interleaving to");
        Console.WriteLine("  occur. A single concurrent trial frequently passes too — which is why");
        Console.WriteLine("  the table above runs 200 of them and reports how many failed rather");
        Console.WriteLine("  than asserting on one.");
        Console.WriteLine();
        Console.WriteLine("  The test that would have caught it:");
        Console.WriteLine();
        Console.WriteLine("      for (var trial = 0; trial &lt; 200; trial++)");
        Console.WriteLine("      {");
        Console.WriteLine("          var gateway = new Gateway();");
        Console.WriteLine("          var service = new PaymentService(gateway);");
        Console.WriteLine("          var key = Guid.NewGuid().ToString();");
        Console.WriteLine();
        Console.WriteLine("          Parallel.For(0, 8, _ =&gt; service.Pay(new(key, 100m)));");
        Console.WriteLine();
        Console.WriteLine("          Assert.Equal(1, gateway.Charges);");
        Console.WriteLine("      }");
        Console.WriteLine();
        Console.WriteLine("  The loop count is not decoration. A race that fires 5% of the time");
        Console.WriteLine("  passes a single-trial test 19 times out of 20 and will be marked");
        Console.WriteLine("  flaky and retried rather than investigated.");

        Console.WriteLine();
        Console.WriteLine("=== how it was diagnosed ===");
        Console.WriteLine();
        Console.WriteLine("  There is no counter for 'this happened twice'. What surfaced it was a");
        Console.WriteLine("  supplier's complaint, then a query:");
        Console.WriteLine();
        Console.WriteLine("      SELECT idempotency_key, COUNT(*)");
        Console.WriteLine("      FROM charges GROUP BY idempotency_key HAVING COUNT(*) &gt; 1;");
        Console.WriteLine();
        Console.WriteLine("  That query is the real lesson. A race on a business invariant is");
        Console.WriteLine("  invisible to every runtime metric you have — no exception, no latency");
        Console.WriteLine("  change, no memory signature — and visible in the DATA. If an");
        Console.WriteLine("  invariant matters, assert it in the data continuously, because that");
        Console.WriteLine("  is the only place a race of this kind leaves a trace.");
        Console.WriteLine();
        Console.WriteLine("  Better still, make the database enforce it: a unique index on");
        Console.WriteLine("  idempotency_key turns a silent duplicate into a constraint violation");
        Console.WriteLine("  you can catch and handle. In-process locking protects one instance;");
        Console.WriteLine("  the moment you run two replicas, only the database can arbitrate.");
        Console.WriteLine();
        Console.WriteLine("  Note what that means for V2 and V3 above: both are correct WITHIN a");
        Console.WriteLine("  process and neither is sufficient across a horizontally scaled");
        Console.WriteLine("  deployment. The lock is per-instance. Two pods have two locks.");
    }

    static void Trial(string label, Func&lt;Gateway, object&gt; make)
    {
        var doubleCharged = 0;
        var totalCharges = 0;

        for (var trial = 0; trial &lt; Trials; trial++)
        {
            var gateway = new Gateway();
            var service = make(gateway);
            var key = $"KEY-{trial}";
            var request = new PaymentRequest(key, 100m);

            var ready = new ManualResetEventSlim(false);
            var threads = new Thread[Attempts];
            for (var i = 0; i &lt; Attempts; i++)
            {
                threads[i] = new Thread(() =&gt;
                {
                    ready.Wait();                     // start together, to widen the window
                    try { Invoke(service, request); }
                    catch { /* a corrupted HashSet can throw; counted as a failure below */ }
                });
                threads[i].Start();
            }
            ready.Set();
            foreach (var t in threads) t.Join();

            totalCharges += gateway.Charges;
            if (gateway.Charges != 1) doubleCharged++;
        }

        Console.WriteLine($"  {label,-33} {totalCharges,8:N0}   {Trials,8:N0}   " +
                          $"{doubleCharged,8:N0} of {Trials}");
    }

    static void Invoke(object service, PaymentRequest r)
    {
        switch (service)
        {
            case PaymentServiceV1 v1: v1.Pay(r); break;
            case PaymentServiceV2 v2: v2.Pay(r); break;
            case PaymentServiceV3 v3: v3.Pay(r); break;
            case PaymentServiceV4 v4: v4.Pay(r); break;
        }
    }

    static int SingleThreaded()
    {
        var gateway = new Gateway();
        var service = new PaymentServiceV1(gateway);
        var request = new PaymentRequest("KEY-SEQ", 100m);
        for (var i = 0; i &lt; 8; i++) service.Pay(request);
        return gateway.Charges;
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
    static int _counter;
    static volatile int _volatileCounter;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: which of these are correct? =====");
        Console.WriteLine();
        Console.WriteLine("  4 threads x 250,000 increments. Correct answer is 1,000,000.");
        Console.WriteLine();
        Console.WriteLine("  variant                     result   correct?");
        Counter("x++", () =&gt; _counter++, () =&gt; _counter, () =&gt; _counter = 0);
        Counter("volatile x++", () =&gt; _volatileCounter++, () =&gt; _volatileCounter,
                () =&gt; _volatileCounter = 0);
        Counter("Interlocked.Increment", () =&gt; Interlocked.Increment(ref _counter),
                () =&gt; _counter, () =&gt; _counter = 0);
        Console.WriteLine();
        Console.WriteLine("  volatile does NOT fix a counter. It affects how a field is read and");
        Console.WriteLine("  written, not whether read-modify-write stays together. Only");
        Console.WriteLine("  Interlocked (a single uninterruptible instruction) or a lock");
        Console.WriteLine("  (exclusion) makes ++ atomic.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: find the window =====");
        Console.WriteLine();
        Console.WriteLine("      if (!_seen.Contains(key)) { Charge(); _seen.Add(key); }");
        Console.WriteLine();
        Console.WriteLine("  200 trials, 8 threads racing on the same key each time:");
        Console.WriteLine();
        Console.WriteLine("  implementation                 trials wrong");
        Console.WriteLine($"    check-then-act               {CheckThenAct(),4} of 200");
        Console.WriteLine($"    lock around both             {Locked(),4} of 200");
        Console.WriteLine($"    ConcurrentDictionary.TryAdd  {TryAdd(),4} of 200");
        Console.WriteLine();
        Console.WriteLine("  The window is between the check and the record. Every thread that");
        Console.WriteLine("  arrives inside it sees 'not present' and proceeds. It is nanoseconds");
        Console.WriteLine("  wide, which is why it survives testing and fires under a retry storm.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: is a thread-safe collection enough? =====");
        Console.WriteLine();
        Console.WriteLine("      _seen.GetOrAdd(key, _ =&gt; { Charge(); return 0; });");
        Console.WriteLine();
        Console.WriteLine($"    GetOrAdd with a side effect  {GetOrAddSideEffect(),4} of 200 trials wrong");
        Console.WriteLine();
        Console.WriteLine("  No. ConcurrentDictionary guarantees that one VALUE wins, not that the");
        Console.WriteLine("  factory runs once. Under contention it can run several times, so a");
        Console.WriteLine("  side effect inside it happens several times.");
        Console.WriteLine();
        Console.WriteLine("  The general rule: a thread-safe collection makes ITS OWN methods");
        Console.WriteLine("  atomic. Anything you compose from two calls, or any side effect you");
        Console.WriteLine("  put inside one, is a new operation with a new gap.");
        Console.WriteLine();
        Console.WriteLine("  If the factory is expensive or has effects, store a Lazy&lt;T&gt; as the");
        Console.WriteLine("  value: the dictionary races on cheap Lazy objects, and Lazy itself");
        Console.WriteLine("  guarantees single execution.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: why does this loop never end? =====");
        Console.WriteLine();
        Console.WriteLine("      while (!_stop) { }        // on thread A");
        Console.WriteLine("      _stop = true;             // on thread B, 100 ms later");
        Console.WriteLine();
        Console.WriteLine($"    plain bool     : {Spin(useVolatile: false)}");
        Console.WriteLine($"    volatile bool  : {Spin(useVolatile: true)}");
        Console.WriteLine();
        Console.WriteLine("  The loop body does not write _stop, so the JIT may read it once into");
        Console.WriteLine("  a register and spin on that copy. Thread B's write goes to memory and");
        Console.WriteLine("  is never re-read. This is a legal optimisation, not a bug in the JIT.");
        Console.WriteLine();
        Console.WriteLine("  volatile forbids that: every read must come from memory. So this is");
        Console.WriteLine("  the case volatile is FOR — and note it is the opposite of exercise 1,");
        Console.WriteLine("  where volatile was useless. Visibility and atomicity are different");
        Console.WriteLine("  problems with different fixes.");
        Console.WriteLine();
        Console.WriteLine("  In real code prefer a CancellationToken to a volatile bool: it is the");
        Console.WriteLine("  same signal with correct memory semantics, plus callbacks, linking");
        Console.WriteLine("  and timeouts (t2-08).");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: what does 'it works on my machine' mean here? =====");
        Console.WriteLine();
        Console.WriteLine("  The SAME racy counter, 20 runs at two different contention levels.");
        Console.WriteLine();
        Console.WriteLine("  increments/thread   distinct results   correct runs   lowest");
        RaceSpread(50_000);
        RaceSpread(500_000);
        Console.WriteLine();
        Console.WriteLine("  Read those two rows together, because the contrast IS the lesson.");
        Console.WriteLine();
        Console.WriteLine("  At low contention the bug is nearly invisible: most runs produce the");
        Console.WriteLine("  right answer, and a test suite would pass again and again. At high");
        Console.WriteLine("  contention the same code is wrong every single time.");
        Console.WriteLine();
        Console.WriteLine("  Nothing about the CODE changed between those rows. What changed is how");
        Console.WriteLine("  much opportunity the threads had to interleave. That is why this class");
        Console.WriteLine("  of bug ships: development machines are quiet, test suites are small,");
        Console.WriteLine("  and production is neither.");
        Console.WriteLine();
        Console.WriteLine("  So 'it works on my machine' is not a claim about the machine. It is a");
        Console.WriteLine("  claim about one interleaving out of an enormous number — and at low");
        Console.WriteLine("  contention the harmless interleavings are the overwhelming majority.");
        Console.WriteLine();
        Console.WriteLine("  Consequences for how you work:");
        Console.WriteLine("    - a passing test is weak evidence; run the concurrent case hundreds");
        Console.WriteLine("      of times and assert on the failure COUNT");
        Console.WriteLine("    - a flaky test in concurrent code is a bug report, not a nuisance;");
        Console.WriteLine("      retrying it discards the only evidence you will get");
        Console.WriteLine("    - correctness has to come from construction and reasoning, because");
        Console.WriteLine("      testing cannot establish the absence of an interleaving");
    }

    static void RaceSpread(int perThread)
    {
        var results = new List&lt;int&gt;();
        for (var i = 0; i &lt; 20; i++)
        {
            _counter = 0;
            var threads = new Thread[4];
            for (var t = 0; t &lt; 4; t++)
            {
                threads[t] = new Thread(() =&gt; { for (var j = 0; j &lt; perThread; j++) _counter++; });
                threads[t].Start();
            }
            foreach (var th in threads) th.Join();
            results.Add(_counter);
        }
        var expected = perThread * 4;
        Console.WriteLine($"  {perThread,17:N0}   {results.Distinct().Count(),16} " +
                          $"  {results.Count(r =&gt; r == expected),12}   {results.Min(),10:N0}");
    }

    static void Counter(string label, Action inc, Func&lt;int&gt; read, Action reset)
    {
        reset();
        var threads = new Thread[4];
        for (var t = 0; t &lt; 4; t++)
        {
            threads[t] = new Thread(() =&gt; { for (var i = 0; i &lt; 250_000; i++) inc(); });
            threads[t].Start();
        }
        foreach (var th in threads) th.Join();
        var v = read();
        Console.WriteLine($"  {label,-24} {v,10:N0}   {(v == 1_000_000 ? "yes" : "NO")}");
    }

    // --- Exercises 2 and 3 ----------------------------------------------------
    static int CheckThenAct() =&gt; RaceTrial((seen, charges, key) =&gt;
    {
        // No synchronisation at all: this is the shipped shape.
        var set = (HashSet&lt;string&gt;)seen;
        if (set.Contains(key)) return;                  // CHECK
        Interlocked.Increment(ref charges.Value);       // ACT
        set.Add(key);
    }, () =&gt; new HashSet&lt;string&gt;(StringComparer.Ordinal));

    static int Locked() =&gt; RaceTrial((seen, charges, key) =&gt;
    {
        var set = (HashSet&lt;string&gt;)seen;
        lock (set)
        {
            if (!set.Add(key)) return;
            Interlocked.Increment(ref charges.Value);
        }
    }, () =&gt; new HashSet&lt;string&gt;(StringComparer.Ordinal));

    static int TryAdd() =&gt; RaceTrial((seen, charges, key) =&gt;
    {
        var dict = (ConcurrentDictionary&lt;string, byte&gt;)seen;
        if (!dict.TryAdd(key, 0)) return;
        Interlocked.Increment(ref charges.Value);
    }, () =&gt; new ConcurrentDictionary&lt;string, byte&gt;(StringComparer.Ordinal));

    static int GetOrAddSideEffect() =&gt; RaceTrial((seen, charges, key) =&gt;
    {
        var dict = (ConcurrentDictionary&lt;string, byte&gt;)seen;
        dict.GetOrAdd(key, _ =&gt; { Interlocked.Increment(ref charges.Value); return (byte)0; });
    }, () =&gt; new ConcurrentDictionary&lt;string, byte&gt;(StringComparer.Ordinal));

    sealed class Counter32 { public int Value; }

    static int RaceTrial(Action&lt;object, Counter32, string&gt; pay, Func&lt;object&gt; makeStore)
    {
        var wrong = 0;
        for (var trial = 0; trial &lt; 200; trial++)
        {
            var store = makeStore();
            var charges = new Counter32();
            var key = $"KEY-{trial}";
            var ready = new ManualResetEventSlim(false);

            var threads = new Thread[8];
            for (var i = 0; i &lt; 8; i++)
            {
                threads[i] = new Thread(() =&gt;
                {
                    ready.Wait();
                    try { pay(store, charges, key); } catch { }
                });
                threads[i].Start();
            }
            ready.Set();
            foreach (var t in threads) t.Join();

            if (Volatile.Read(ref charges.Value) != 1) wrong++;
        }
        return wrong;
    }

    // --- Exercise 4 -----------------------------------------------------------
    sealed class Flag
    {
        public bool Plain;
        public volatile bool Vol;
    }

    static string Spin(bool useVolatile)
    {
        var flag = new Flag();
        var sw = Stopwatch.StartNew();
        var spinner = new Thread(() =&gt;
        {
            if (useVolatile) { while (!flag.Vol) { } }
            else { while (!flag.Plain) { } }
        }) { IsBackground = true };

        spinner.Start();
        Thread.Sleep(100);
        flag.Plain = true;
        flag.Vol = true;
        var joined = spinner.Join(TimeSpan.FromSeconds(2));
        return joined
            ? $"exited after {sw.Elapsed.TotalMilliseconds:N0} ms"
            : $"STILL SPINNING after {sw.Elapsed.TotalMilliseconds:N0} ms";
    }
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What are the two different problems people call race conditions?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Atomicity</strong> — an operation that is several steps in execution, so another
        thread can act in the middle. <strong>Visibility</strong> — a write one thread makes that
        another never observes, because caching and reordering are permitted. Different causes,
        different fixes.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>volatile</code> not fix a counter?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It addresses visibility only. <code>x++</code> is load-add-store, and
        <code>volatile</code> does nothing to keep the three together. Measured: a volatile counter
        lost <strong>1,228,515 of 1,600,000</strong> increments, against 1,024,865 for the plain
        version on the same run — no better, and no worse in any reliable way.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>lock</code> give you that <code>volatile</code> does not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Both. Exclusion (atomicity) plus memory barriers on entry and exit (visibility) — and it
        protects an arbitrary <em>region</em> rather than a single field. That is why it is the right
        default.</p>
      </div></details>
    </li>
    <li>
      <p>Where is the window in <code>if (!seen.Contains(k)) { Act(); seen.Add(k); }</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Between the check and the record, spanning the action. Measured at <strong>5 failures in
        200 trials</strong> with eight threads released together. The same shape appears as
        <code>if (File.Exists)</code>, <code>if (_instance == null)</code> and
        <code>if (!dict.ContainsKey)</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Is a <code>ConcurrentDictionary</code> enough to make your code thread-safe?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. Its own methods are atomic; your composition of them is not. Measured:
        <code>GetOrAdd</code> with a side effect in the factory failed <strong>1 trial in 200</strong>,
        because the factory is not guaranteed to run once — only one value is guaranteed to win.</p>
      </div></details>
    </li>
    <li>
      <p>Why might a loop polling a plain <code>bool</code> never terminate?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The loop body does not write it, so the JIT may hoist the read into a register and spin on
        that copy. Verified: still spinning after 2,128 ms; the volatile version exited in 103 ms. It
        is a legal optimisation, so it appears as "works in Debug, hangs in Release".</p>
      </div></details>
    </li>
    <li>
      <p>Roughly what do the mechanisms cost, and should that drive your choice?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Uncontended: plain 2.83 ns, volatile 2.86, <code>Interlocked</code> 9.97, <code>lock</code>
        27.78. <strong>No</strong> — all nanoseconds. Choose for correctness and clarity; optimise when
        a profiler shows contention.</p>
      </div></details>
    </li>
    <li>
      <p>What does a passing concurrent test prove?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Very little. The same racy code was correct in <strong>19 of 20</strong> runs at low
        contention and <strong>0 of 20</strong> at high contention, unchanged. Run hundreds of trials,
        release threads simultaneously, and assert on the failure count.</p>
      </div></details>
    </li>
    <li>
      <p>How do you detect a race on a business invariant in production?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>In the <strong>data</strong>, not the metrics — a scheduled query for duplicate keys.
        There is no exception, no latency change and no error-rate movement. Better: a unique
        constraint so the database rejects it outright.</p>
      </div></details>
    </li>
    <li>
      <p>Your lock fixes the bug. What happens at three replicas?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It returns. Three processes have three locks and no shared state. Uniqueness across a
        system needs an authority outside the process — a unique index, an atomic conditional write,
        or a distributed lock — and the change that reintroduces the bug is a deployment change nobody
        reviewed as code.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
