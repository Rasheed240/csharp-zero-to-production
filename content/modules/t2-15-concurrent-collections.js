CSPREP.module({
  id: "t2-15-concurrent-collections",
  minutes: 55,
  updated: "2026-08-31",
  summary: "Thread-safe means each METHOD is atomic, not that your sequence of them is. Ledger's rate limiter used a ConcurrentDictionary correctly and still admitted 16 requests against a limit of 10, because read-decide-write is three operations. This module covers the atomic operations and the compositions that are not, why GetOrAdd ran its factory 131 times for one key, and the second defect in the same class: a dictionary with no eviction retaining 41.8 MB across 400,000 keys.",
  terms: ["ConcurrentDictionary", "thread-safe", "composition", "check-then-act", "TryAdd",
    "GetOrAdd", "AddOrUpdate", "Lazy", "ConcurrentQueue", "ConcurrentBag", "thread affinity",
    "BlockingCollection", "moving view", "IsEmpty", "unbounded cache"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger rate-limits each customer to ten concurrent API calls. The limiter uses a
  <code>ConcurrentDictionary</code> — which is thread-safe, so the author reasonably concluded the
  limiter was too:</p>

  <pre data-lang="csharp" data-net="10" data-title="RateLimiter.cs"><code>_counts.TryGetValue(customer, out var current);   // READ
if (current &gt;= limit) return false;               // DECIDE
_counts[customer] = current + 1;                  // WRITE
return true;</code></pre>

  <p>A customer with an aggressive client saturated a downstream service that Ledger shares with
  three other teams. Ledger's own metrics said the limiter was admitting at most ten. The shared
  service disagreed.</p>

  <p>The dictionary was never corrupted and never lost an entry. Every individual call did exactly
  what it promised. Measured: <strong>16 threads racing for a limit of 10 exceeded it in 5 of 30
  trials, admitting as many as 16.</strong></p>

  <p>The limiter is three operations. The guarantee covers one at a time.</p>

  <p>This is the defining mistake with concurrent collections, and it is not a misunderstanding of
  threading — it is a misreading of what the phrase <em>thread-safe</em> claims. It claims the
  <strong>collection</strong> is safe. It says nothing about your operation.</p>

  <p>This module is about the actual guarantee, the operations that are atomic and the compositions
  that are not, why <code>GetOrAdd</code>'s factory can run 200 times, and the second defect in the
  same class that nobody noticed for a year: a dictionary that never forgot a customer.</p>
</section>

<section id="plain-language">
  <h2>What "thread-safe" actually promises</h2>

  <p class="define"><span class="define__term">Thread</span> An independent sequence of instructions
  the operating system can run. Two threads in one process share memory, which is why a collection
  needs to say anything about safety at all.</p>

  <p class="define"><span class="define__term">Thread-safe collection</span> One whose
  <em>individual methods</em> are atomic with respect to each other, and which cannot be corrupted by
  concurrent use. <code>TryAdd</code> either adds or does not; <code>TryRemove</code> either removes
  or does not; no interleaving can produce a broken internal structure.</p>

  <p class="define"><span class="define__term">Composition</span> Two or more calls that together form
  a logical operation. <code>ContainsKey</code> then <code>Add</code> is a composition. Nothing makes
  a composition atomic, and the gap between the calls is where the bugs are.</p>

  <p class="define"><span class="define__term">Atomic operation</span> On
  <code>ConcurrentDictionary</code>, one of a short list: <code>TryAdd</code>,
  <code>TryRemove</code>, <code>TryUpdate</code>, <code>GetOrAdd</code>, <code>AddOrUpdate</code>,
  and the indexer. Anything you need that is not on that list is a composition you have to protect
  yourself.</p>

  <p><strong>An analogy, and its limits.</strong> A thread-safe collection is a shop with a
  well-behaved queue: every individual transaction completes without interference, and the till never
  ends up in an inconsistent state. What the queue does not give you is exclusive use of the shop.
  "Check the shelf, then take the last one" is two visits, and someone else can be served in
  between.</p>

  <p><strong>Where the analogy breaks:</strong> in a shop you would notice the empty shelf. Here you
  read a value that was true when you read it and is not true when you act on it, and nothing
  anywhere reports the discrepancy. The check-then-act race from
  <a href="#/m/t2-11-race-conditions">t2-11</a> is exactly this, and a concurrent collection does not
  close it — it cannot, because the gap is between your calls rather than inside either of them.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Collection</th><th>Use it for</th><th>Note</th></tr></thead>
    <tbody>
      <tr><td><code>ConcurrentDictionary&lt;K,V&gt;</code></td><td>Keyed state</td><td>The one you will actually use</td></tr>
      <tr><td><code>ConcurrentQueue&lt;T&gt;</code></td><td>FIFO handoff</td><td>Order preserved</td></tr>
      <tr><td><code>ConcurrentStack&lt;T&gt;</code></td><td>Object pools, work stealing</td><td>LIFO</td></tr>
      <tr><td><code>ConcurrentBag&lt;T&gt;</code></td><td>Producers that are also consumers</td><td><strong>Thread-affine</strong> — see below</td></tr>
      <tr><td><code>BlockingCollection&lt;T&gt;</code></td><td>Legacy producer/consumer</td><td><code>Take()</code> blocks a thread; use a Channel (<a href="#/m/t2-14-async-coordination">t2-14</a>)</td></tr>
    </tbody>
  </table>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-minimal-example.cs"><code>// 04-minimal-example.cs — the smallest program showing what a concurrent
// collection guarantees and what it does not.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Threading;

class Program
{
    static void Main()
    {
        // What it guarantees: each method is atomic. TryAdd wins exactly once.
        var atomic = new ConcurrentDictionary&lt;string, int&gt;();
        var atomicWins = 0;
        Run(() =&gt; { if (atomic.TryAdd("k", 1)) Interlocked.Increment(ref atomicWins); });
        Console.WriteLine($"TryAdd            : {atomicWins} thread(s) added   {(atomicWins == 1 ? "correct" : "WRONG")}");

        // What it does not: two atomic calls are not one atomic operation.
        var composed = new ConcurrentDictionary&lt;string, int&gt;();
        var composedWins = 0;
        Run(() =&gt;
        {
            if (!composed.ContainsKey("k"))              // CHECK
            {
                composed["k"] = 1;                       // ACT
                Interlocked.Increment(ref composedWins);
            }
        });
        Console.WriteLine($"ContainsKey + set : {composedWins} thread(s) added   {(composedWins == 1 ? "correct this run" : "WRONG")}");
        Console.WriteLine();
        Console.WriteLine("Thread-safe means each METHOD is atomic. Your sequence of methods is");
        Console.WriteLine("a new operation, with a new gap, that nothing protects for you.");
    }

    static void Run(Action body)
    {
        var ready = new ManualResetEventSlim(false);
        var threads = new Thread[16];
        for (var i = 0; i &lt; 16; i++)
        {
            threads[i] = new Thread(() =&gt; { ready.Wait(); body(); });
            threads[i].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>TryAdd            : 1 thread(s) added   correct
ContainsKey + set : 12 thread(s) added   WRONG

Thread-safe means each METHOD is atomic. Your sequence of methods is
a new operation, with a new gap, that nothing protects for you.</code></pre>

  <p>Same dictionary, same sixteen threads, same key. <code>TryAdd</code> is one atomic operation and
  exactly one thread wins. <code>ContainsKey</code> followed by an assignment is two, and
  <strong>twelve threads all believed they were the one that added it</strong>.</p>

  <p>If that assignment had been a database insert, an email, or an increment of a counter that
  matters, twelve of them would have happened.</p>

  <p><strong>The collection behaved correctly in both cases.</strong> It never corrupted, never lost
  an entry, and every call returned the truth as of the instant it ran. The second version is wrong
  because the truth changed between the two calls.</p>
</section>

<section id="guarantees">
  <h2>The atomic operations, and the ones people expect</h2>

  <pre data-lang="console" data-title="01-guarantees.cs"><code>  TryAdd("a", 1)                 -&gt; True   (added)
  TryAdd("a", 2)                 -&gt; False   (already present)
  GetOrAdd("a", 9)               -&gt; 1      (existing value)
  GetOrAdd("b", 5)               -&gt; 5      (added)
  AddOrUpdate("a", 0, (k,v)=&gt;v+10) -&gt; 11
  TryUpdate("a", 99, comparison 11) -&gt; True
  TryRemove("b", out var removed)  -&gt; True, value 5</code></pre>

  <p>That is the complete list. Every one is a single atomic operation, and the naming is a hint:
  <code>Try*</code> returns whether <em>you</em> were the one who did it, which is the same shape as
  <code>CompareExchange</code> in <a href="#/m/t2-13-interlocked-and-lockfree">t2-13</a> and exists
  for the same reason.</p>

  <h3><code>GetOrAdd</code> does not promise the factory runs once</h3>

  <pre data-lang="console" data-title="01-guarantees.cs — 200 threads, one missing key"><code>    factory invocations : 131
    distinct values seen by callers : 1

    with Lazy&lt;T&gt;, factory invocations : 1</code></pre>

  <p><strong>The factory ran 131 times and every caller received the same value.</strong> That is not
  a bug — it is precisely the documented guarantee: one value wins, and the losing factory results
  are discarded.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Harmless when the factory is pure. A disaster when it is not. A factory that opens a
    connection, charges a card, writes a file or registers a callback has done that work 131 times,
    and 130 of those results were thrown away — while their side effects were not.</p>
    <pre data-lang="csharp" data-net="10" data-title="The fix: race on cheap objects"><code>// The dictionary races on Lazy instances, which are cheap to construct and
// throw away. Lazy guarantees the expensive factory runs exactly once.
private readonly ConcurrentDictionary&lt;string, Lazy&lt;Connection&gt;&gt; _map = new();

var connection = _map.GetOrAdd(key, k =&gt; new Lazy&lt;Connection&gt;(
    () =&gt; OpenConnection(k),
    LazyThreadSafetyMode.ExecutionAndPublication)).Value;</code></pre>
    <p>This is the same technique as <code>AsyncLazy</code> in
    <a href="#/m/t2-07-sync-over-async-deadlocks">t2-07</a>. Losing threads construct a
    <code>Lazy</code> that is discarded without ever being evaluated.</p>
  </div>

  <h3>Enumeration is safe, and is not a snapshot</h3>

  <pre data-lang="console" data-title="01-guarantees.cs"><code>  enumerating a ConcurrentDictionary while 4 threads write:
    threw               : no
    items seen          : 17,215
    items added meanwhile: 318,341</code></pre>

  <p>It does not throw — the whole difference from a plain <code>Dictionary</code>, which threw in
  <strong>20 of 40 trials</strong> under the same treatment in
  <a href="#/m/t2-12-locking">t2-12</a>. What you get is a <em>moving view</em>: entries added during
  the walk may or may not appear.</p>

  <p>So enumeration is safe and not consistent. For a stable view — computing a total, serialising the
  contents — use <code>ToArray()</code>, which snapshots under the internal locks.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <pre data-lang="console" data-title="01-guarantees.cs — 200,000 entries"><code>    Count against IsEmpty, same dictionary : 45.38x</code></pre>
    <p><code>Count</code> is not a field. On <code>ConcurrentDictionary</code> it acquires every
    internal lock to produce an exact answer, so it does not belong in a hot path or a per-request
    metric. <code>IsEmpty</code> is the cheap question when you only need to know whether anything is
    there.</p>
  </div>

  <h3><code>ConcurrentBag</code> is thread-affine</h3>

  <pre data-lang="console" data-title="01-guarantees.cs — 200,000 items"><code>    drained by the thread that added them :  1.00x  (baseline)
    drained by a different thread         :  1.72x</code></pre>

  <p>Both drains return every item; a bag is correct either way. What differs is the cost. A bag keeps
  a per-thread list and prefers your own, so taking from another thread's list is a <strong>steal</strong>
  requiring synchronisation the local path avoids.</p>

  <p>A bag is therefore fast when producers are also consumers, and a poor queue when a dedicated
  consumer drains what other threads produced — which is the shape most people reach for it in. Use
  <code>ConcurrentQueue</code> there.</p>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the shipped limiter"><code>/// &lt;summary&gt;
/// THE SHIPPED VERSION. Read the count, add one, write it back. Every call is
/// atomic and the sequence is not, so requests are admitted over the limit.
/// &lt;/summary&gt;
public sealed class LimiterV1
{
    private readonly ConcurrentDictionary&lt;string, int&gt; _counts = new();
    public bool TryAcquire(string customer, int limit)
    {
        _counts.TryGetValue(customer, out var current);   // READ
        if (current &gt;= limit) return false;               // DECIDE
        _counts[customer] = current + 1;                  // WRITE
        return true;
    }
    public int CountFor(string customer) =&gt; _counts.TryGetValue(customer, out var v) ? v : 0;
}</code></pre>

  <pre data-lang="console" data-title="02-production.cs — 16 threads, limit 10, 30 trials"><code>  implementation                 admitted over limit   worst overshoot
  V1: read, decide, write               5 of 30        16 admitted
  V2: AddOrUpdate                       0 of 30                  -
  V3: lock per customer                 0 of 30                  -</code></pre>

  <p><strong>16 admitted against a limit of 10</strong>, in a limiter whose collection never
  misbehaved.</p>

  <h3>The two fixes</h3>

  <pre data-lang="csharp" data-net="10" data-title="One atomic call"><code>/// &lt;summary&gt;
/// THE FIX. AddOrUpdate performs the read, the decision and the write as one
/// atomic operation, so no two threads can both see the same "current".
/// &lt;/summary&gt;
public sealed class LimiterV2
{
    private readonly ConcurrentDictionary&lt;string, int&gt; _counts = new();
    public bool TryAcquire(string customer, int limit)
    {
        var updated = _counts.AddOrUpdate(customer, 1, (_, current) =&gt; current + 1);
        if (updated &lt;= limit) return true;
        _counts.AddOrUpdate(customer, 0, (_, current) =&gt; current - 1);   // give it back
        return false;
    }
    public int CountFor(string customer) =&gt; _counts.TryGetValue(customer, out var v) ? v : 0;
}</code></pre>

  <p>This is the idiomatic answer, and it has a wrinkle worth seeing: the decrement on the rejection
  path means the count briefly exceeds the limit, so a concurrent reader can observe 11. Correct for
  admission control; wrong if the count is displayed anywhere.</p>

  <pre data-lang="csharp" data-net="10" data-title="A small lock, held for nanoseconds"><code>/// &lt;summary&gt;
/// ALSO CORRECT, and simpler to reason about: one lock per customer, held for
/// nanoseconds. Correctness by inspection, at the cost of a lock object per key.
/// &lt;/summary&gt;
public sealed class LimiterV3
{
    private readonly ConcurrentDictionary&lt;string, Counter&gt; _counts = new();
    private sealed class Counter { public int Value; }

    public bool TryAcquire(string customer, int limit)
    {
        var counter = _counts.GetOrAdd(customer, _ =&gt; new Counter());
        lock (counter)
        {
            if (counter.Value &gt;= limit) return false;
            counter.Value++;
            return true;
        }
    }
    public int CountFor(string customer) =&gt;
        _counts.TryGetValue(customer, out var c) ? Volatile.Read(ref c.Value) : 0;
}</code></pre>

  <pre data-lang="console" data-title="02-production.cs"><code>  cost, 16 threads: V2 AddOrUpdate  1.00x   V3 lock-per-key  0.38x</code></pre>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Read the direction: the ratio is below one, so <strong>the lock-per-key version is two to
    three times faster</strong> than <code>AddOrUpdate</code> here. That is the opposite of what most
    people expect.</p>
    <p>The reason is the one from <a href="#/m/t2-13-interlocked-and-lockfree">t2-13</a>: an
    uncontended lock is cheap, while <code>AddOrUpdate</code> on a hot key retries its update loop
    whenever another thread wins the race.</p>
    <p>So the choice is not a performance trade. Prefer whichever states the intent more clearly — and
    for a read-decide-write, that is usually the lock.</p>
  </div>

  <h3>The second bug: it never forgot a customer</h3>

  <pre data-lang="console" data-title="02-production.cs"><code>    400,000 distinct customers seen -&gt; 41.8 MB retained</code></pre>

  <p><code>ConcurrentDictionary</code> has no eviction, no capacity limit and no expiry. It is a
  dictionary. <strong>Used as a cache it is an unbounded one</strong>, which is a memory leak with a
  hit rate.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The shape of this leak is what makes it survive. Memory grows with the number of
    <strong>distinct keys ever seen</strong> — not with concurrency, not with request size, not with
    load. It never falls. It is cleared by a restart.</p>
    <p>So it hides behind your deployment cadence: a service that deploys weekly never accumulates
    enough to notice, until a release is delayed or traffic reaches a new customer segment. The
    triggering event is unrelated to the defect, which is why these are so often attributed to
    whatever shipped that week.</p>
    <p>The rule that falls out: a static dictionary is only safe as a cache when the key space is
    genuinely bounded and small — currency codes, country codes, feature flags. Customer ids, session
    ids, URLs and tenant ids are not bounded, whatever today's data says.</p>
  </div>

  <h3>How each was diagnosed</h3>

  <p>The <strong>over-admission</strong> was found downstream, not here. Ledger's own metrics said the
  limiter was admitting at most ten. The detector is the one from
  <a href="#/m/t2-11-race-conditions">t2-11</a> — assert the invariant where it can actually be
  checked:</p>

  <pre data-lang="csharp" data-net="10" data-title="The only detector that exists"><code>if (inFlight &gt; limit)
    _logger.LogError("limiter admitted {N} over a limit of {L}", inFlight, limit);</code></pre>

  <p>The <strong>leak</strong> was found in a heap dump:</p>

  <pre data-lang="console" data-title="Finding an unbounded dictionary"><code>dotnet-gcdump collect --process-id 4812
    -&gt; ConcurrentDictionary&lt;string, int&gt; with 2.4 million entries, rooted by a singleton</code></pre>

  <p>Distinguishing it from the other memory failures in this track:</p>

  <pre data-lang="console" data-title="Three memory shapes"><code>buffering (t2-09)    tracks request SIZE     spikes and recovers
token leak (t2-08)   tracks total requests   never falls
this                 tracks DISTINCT KEYS    never falls</code></pre>

  <p>The middle two look identical on a graph. What separates them is the <code>gcroot</code>: one is
  a registration list on a long-lived cancellation token, the other is a dictionary keyed by something
  with unbounded cardinality.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Composing two atomic calls</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: every one of these has a gap"><code>// WRONG. Measured: 12 of 16 threads believed they added it.
if (!_map.ContainsKey(k)) _map[k] = Compute(k);

// WRONG. Read, decide, write — measured over the limit in 5 of 30 trials.
_counts.TryGetValue(c, out var n);
if (n &lt; limit) _counts[c] = n + 1;

// WRONG. Two atomic calls, one non-atomic operation.
if (_map.TryGetValue(k, out var v)) _map[k] = v + 1;

// Right: one atomic call each time.
_map.TryAdd(k, Compute(k));
_map.AddOrUpdate(k, 1, (_, v) =&gt; v + 1);</code></pre>

  <h3>2. A factory with side effects in <code>GetOrAdd</code></h3>

  <p>Measured at 131 invocations for one key. Store a <code>Lazy&lt;T&gt;</code> when the factory does
  anything you would not want repeated.</p>

  <h3>3. Using a concurrent collection as an unbounded cache</h3>

  <p>No eviction, no expiry, no capacity. Measured: 400,000 keys retaining 41.8 MB and growing. Use
  <code>MemoryCache</code>, or sweep with <code>TryRemove</code>.</p>

  <h3>4. Trusting enumeration to be a snapshot</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the total is of a moving target"><code>// WRONG. Entries added during the walk may or may not be counted, so this
// total corresponds to no moment in time.
var total = 0m;
foreach (var kvp in _balances) total += kvp.Value;

// Right: snapshot first.
var total = _balances.ToArray().Sum(kvp =&gt; kvp.Value);</code></pre>

  <h3>5. <code>Count</code> in a hot path</h3>

  <p>Measured at 45× the cost of <code>IsEmpty</code>. It locks every bucket to be exact.</p>

  <h3>6. <code>ConcurrentBag</code> as a work queue</h3>

  <p>Measured: draining from a different thread cost 1.72× the local path, because every take is a
  steal. It is designed for producers that are also consumers. Use
  <code>ConcurrentQueue</code> or a Channel.</p>

  <h3>7. Reaching for a concurrent collection when the problem is the operation</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the collection was never the problem"><code>// WRONG. Swapping Dictionary for ConcurrentDictionary stops the corruption
// and leaves the invariant broken — the two updates still are not one operation.
_totals.AddOrUpdate(k, amount, (_, v) =&gt; v + amount);
_counts.AddOrUpdate(k, 1, (_, v) =&gt; v + 1);

// Right: if two pieces of state must agree, one lock or one object (t2-13).
lock (_gate) { _totals[k] += amount; _counts[k]++; }</code></pre>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a limit, a counter or a uniqueness rule is occasionally violated, and
    the collection is demonstrably fine.</p>
    <p><strong>Why:</strong> a composition. The collection's guarantee covers each call, not your
    sequence of them.</p>
    <p><strong>Tool:</strong> read the code and count the calls. There is no counter and no dump for
    this — the question is whether the logical operation is one call or several:</p>
    <pre data-lang="console" data-title="The audit"><code># Every use of the shared collection, then check each site is ONE call.
grep -n "_counts\." src/**/*.cs</code></pre>
    <p><strong>Reading it:</strong> two calls on adjacent lines operating on the same key is a
    composition. So is a <code>TryGetValue</code> whose result is used to decide anything. The atomic
    operations are <code>TryAdd</code>, <code>TryRemove</code>, <code>TryUpdate</code>,
    <code>GetOrAdd</code>, <code>AddOrUpdate</code> — anything else is yours to protect.</p>
    <p><strong>Fix:</strong> collapse into one atomic call, or take a small lock. Measured, the lock
    was faster.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> memory grows steadily over weeks, never falls, and is unrelated to
    load or request size.</p>
    <p><strong>Why:</strong> a dictionary keyed by something with unbounded cardinality, and no
    eviction.</p>
    <p><strong>Tool:</strong></p>
    <pre data-lang="console" data-title="Confirming an unbounded dictionary"><code>dotnet-gcdump collect --process-id 4812
# then, sorted by retained size, look for:
#   ConcurrentDictionary with a very large entry count
#   rooted by a static field or a DI singleton</code></pre>
    <p><strong>Reading it:</strong> the entry count is the diagnosis, and the root tells you it cannot
    be collected. Compare with a token-registration leak
    (<a href="#/m/t2-08-cancellation">t2-08</a>), which looks identical on a graph but roots to a
    <code>CancellationTokenSource</code> rather than a dictionary.</p>
    <p><strong>Fix:</strong> <code>MemoryCache</code> with a size limit, or a periodic sweep using
    <code>TryRemove</code> — which is atomic and safe to call while enumerating.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> an expensive one-time operation happens several times — a connection
    opened twice, a file written twice, a metric registered twice.</p>
    <p><strong>Why:</strong> a side-effecting factory passed to <code>GetOrAdd</code>. Measured at 131
    invocations for a single key.</p>
    <p><strong>Tool:</strong> count the invocations. One <code>Interlocked.Increment</code> inside the
    factory answers it immediately:</p>
    <pre data-lang="csharp" data-net="10" data-title="Proving the factory runs more than once"><code>_map.GetOrAdd(key, k =&gt;
{
    Interlocked.Increment(ref _factoryCalls);   // expose as a metric
    return ExpensiveCreate(k);
});</code></pre>
    <p><strong>Reading it:</strong> a count higher than the number of distinct keys means the factory
    is running on losing threads. That is normal and documented — the bug is having put side effects
    there.</p>
    <p><strong>Fix:</strong> store a <code>Lazy&lt;T&gt;</code>.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a total or report computed from a concurrent collection does not
    reconcile, and re-running gives a different answer.</p>
    <p><strong>Why:</strong> enumeration is a moving view. Measured: 17,215 items seen while 318,341
    were added, with no exception.</p>
    <p><strong>Fix:</strong> <code>ToArray()</code> first — it snapshots under the internal locks —
    then compute from the array. And do not use <code>Count</code> to size anything you then
    enumerate; the two calls are a composition, and the count can be stale by the time you walk it.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The type name reads as a guarantee about your code, and it is a guarantee about
    itself.</strong> Ledger's limiter used a thread-safe collection, was reviewed, and admitted 16
    requests against a limit of 10 in 5 of 30 trials. The failure landed on a service shared with
    three other teams, and Ledger's own metrics reported that the limiter was working — because from
    the limiter's perspective, it was.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A static dictionary is the easiest memory leak to write and the hardest to attribute.</strong>
    400,000 distinct keys retained 41.8 MB with no eviction path. Because growth tracks distinct keys
    rather than load, it does not appear in load testing, does not correlate with traffic, and is
    cleared by every deployment — so it surfaces when a release is delayed or a new customer segment
    arrives, and gets blamed on whatever shipped that week.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The lock you were avoiding was measured faster.</strong> A per-key lock ran two to
    three times faster than <code>AddOrUpdate</code> on a contended key, because an uncontended lock
    is cheap while an update loop retries. Together with
    <a href="#/m/t2-13-interlocked-and-lockfree">t2-13</a>, where a lock beat a CAS loop by a similar
    margin, the pattern is consistent: <strong>lock-free constructs win on single atomic operations and
    lose on anything with a retry.</strong> Reaching past a lock for a concurrent collection is often
    paying for complexity and getting a slowdown.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"It is a concurrent collection, so my code is thread-safe."</strong> Each method is
    atomic; your sequence of them is not. Measured: 12 of 16 threads believed they had added the same
    key using <code>ContainsKey</code> then an assignment.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>GetOrAdd</code> runs the factory once."</strong> It guarantees one
    <em>value</em> wins. Measured at <strong>131 factory invocations</strong> for one key. Store a
    <code>Lazy&lt;T&gt;</code> when the factory has side effects.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Enumerating gives me a snapshot."</strong> It gives a moving view — safe, and not
    consistent. Verified: 17,215 items seen while 318,341 were added. Use <code>ToArray()</code> when
    you need a stable view.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>Count</code> is a field."</strong> On <code>ConcurrentDictionary</code> it locks
    every bucket for an exact answer — measured at 45× the cost of <code>IsEmpty</code>. Do not put it
    in a hot path.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A <code>ConcurrentDictionary</code> is a cache."</strong> It has no eviction, no
    expiry and no capacity. It is a dictionary. Measured: 400,000 keys, 41.8 MB, nothing removed.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>ConcurrentBag</code> is a thread-safe list."</strong> It is thread-affine and
    unordered. Draining from a thread that did not add the items cost 1.72×, because every take is a
    steal. Use <code>ConcurrentQueue</code> for handoff.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Concurrent collections are faster than locking."</strong> A per-key lock measured two
    to three times faster than <code>AddOrUpdate</code> on a contended key. They are safer than an
    unguarded <code>Dictionary</code>, not automatically faster than a guarded one.</p>
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
    <p>The map is a <code>ConcurrentDictionary</code>. Is this correct?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>if (!_map.ContainsKey(k)) _map[k] = Compute(k);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    16 threads, one key : 13 threads believed they added it
    the same with TryAdd: 1 thread believed it added it</code></pre>
        <p><strong>No.</strong> <code>ContainsKey</code> and the indexer are each atomic; the pair is
        not. Every thread arriving between the check and the write sees "absent" and proceeds — so
        <code>Compute</code> ran thirteen times and thirteen writes happened.</p>
        <p>This is the check-then-act shape from <a href="#/m/t2-11-race-conditions">t2-11</a>, and a
        concurrent collection does not close the gap. It cannot: the gap is between two of your calls,
        not inside either of them.</p>
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>_map.TryAdd(k, Compute(k));           // one atomic call
// or, if Compute is expensive and must not repeat:
_map.GetOrAdd(k, key =&gt; new Lazy&lt;T&gt;(() =&gt; Compute(key),
    LazyThreadSafetyMode.ExecutionAndPublication)).Value;</code></pre>
        <p>Note that <code>TryAdd(k, Compute(k))</code> still evaluates <code>Compute</code> on every
        thread — the argument is computed before the call. If that is expensive, the
        <code>Lazy</code> form is the one you want.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>200 threads, one missing key. How many times does the factory run?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>_map.GetOrAdd(k, _ =&gt; ExpensiveCreate());</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    200 threads, one missing key -&gt; factory ran 200 times
    distinct values returned to callers : 1
    with Lazy&lt;T&gt; as the value           : 1 time</code></pre>
        <p><strong>Up to once per thread — here, all 200 — and every caller still received the same
        value.</strong> That is the documented guarantee: one value wins, and the losing factory
        results are discarded.</p>
        <p><strong>Harmless for a pure factory.</strong> If it opens a connection, charges a card,
        writes a file or registers a callback, that work happened 200 times and 199 results were
        thrown away — while their side effects were not.</p>
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>private readonly ConcurrentDictionary&lt;string, Lazy&lt;Connection&gt;&gt; _map = new();

var conn = _map.GetOrAdd(key, k =&gt; new Lazy&lt;Connection&gt;(
    () =&gt; OpenConnection(k),
    LazyThreadSafetyMode.ExecutionAndPublication)).Value;</code></pre>
        <p>The dictionary now races on <code>Lazy</code> instances, which are cheap to construct and
        discard. Losing threads build one that is never evaluated, and
        <code>ExecutionAndPublication</code> guarantees the expensive part runs once.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>You enumerate a <code>ConcurrentDictionary</code> while four threads write to it. What happens,
    and what do you get?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    threw while writers ran : no
    items seen              : 17,215
    items added meanwhile   : 318,341

    Count against IsEmpty on 200,000 entries : 45.4x</code></pre>
        <p><strong>It does not throw</strong> — the whole difference from a plain
        <code>Dictionary</code>, which threw in <strong>20 of 40 trials</strong> under the same
        treatment in <a href="#/m/t2-12-locking">t2-12</a>.</p>
        <p><strong>What you get is a moving view, not a snapshot.</strong> Entries added during the
        walk may or may not appear, so a total computed this way corresponds to no single moment. Use
        <code>ToArray()</code>, which snapshots under the internal locks.</p>
        <p><strong>And <code>Count</code> is not a field.</strong> It acquires every internal lock to
        produce an exact answer — 45 times the cost of <code>IsEmpty</code>. Keep it out of hot paths
        and per-request metrics; use <code>IsEmpty</code> when the question is only whether anything is
        there.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Match each need to a collection, and say why <code>ConcurrentBag</code> is rarely the answer.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    ConcurrentBag drained by its producer   :  1.00x  (baseline)
    ConcurrentBag drained by another thread :  1.72x</code></pre>
        <p><strong><code>ConcurrentDictionary</code></strong> for keyed state — the one you will
        actually use. <strong><code>ConcurrentQueue</code></strong> for FIFO handoff.
        <strong><code>ConcurrentStack</code></strong> for object pools.
        <strong>A Channel</strong> (<a href="#/m/t2-14-async-coordination">t2-14</a>) for async
        producer/consumer with a bound.</p>
        <p><strong><code>ConcurrentBag</code> is thread-affine.</strong> It keeps a per-thread list and
        prefers your own, so taking from another thread's list is a steal requiring synchronisation the
        local path avoids — measured at 1.72×.</p>
        <p>That makes it good for the case it was designed for: producers that are also consumers, such
        as a parallel loop where each worker both generates and consumes items. It is a poor general
        queue, which is the shape most people reach for it in.</p>
        <p><strong>And <code>BlockingCollection</code></strong> is the legacy answer for
        producer/consumer: its <code>Take()</code> blocks a thread. In async code a Channel replaces it
        outright — same job, no blocked threads, and a bound you choose.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Fix the rate limiter, then say which fix you would ship and why.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    read-decide-write : over the limit in 3 of 30 trials
    AddOrUpdate       : over the limit in 0 of 30 trials</code></pre>
        <pre data-lang="csharp" data-net="10" data-title="Fix one: one atomic call"><code>var n = _counts.AddOrUpdate(c, 1, (_, v) =&gt; v + 1);
if (n &lt;= limit) return true;
_counts.AddOrUpdate(c, 0, (_, v) =&gt; v - 1);   // give the slot back
return false;</code></pre>
        <pre data-lang="csharp" data-net="10" data-title="Fix two: a small lock per key"><code>var counter = _counts.GetOrAdd(customer, _ =&gt; new Counter());
lock (counter)
{
    if (counter.Value &gt;= limit) return false;
    counter.Value++;
    return true;
}</code></pre>
        <p><strong>Ship the lock.</strong> Two reasons, and the second is the surprising one.</p>
        <p><strong>It says what it means.</strong> The operation genuinely is read-decide-write, and
        the lock expresses that directly. The <code>AddOrUpdate</code> version has a wrinkle: the
        increment-then-decrement means the stored count briefly exceeds the limit, so a concurrent
        reader can observe 11. That is fine for admission control and wrong if the count is ever
        displayed.</p>
        <p><strong>It measured faster</strong> — two to three times — because an uncontended lock is
        cheap while <code>AddOrUpdate</code> retries its update loop whenever another thread wins
        (<a href="#/m/t2-13-interlocked-and-lockfree">t2-13</a>). There is no performance argument for
        the atomic version here.</p>
        <p>The lock costs one object per key, which is the same unbounded-growth concern as the
        dictionary itself — so both fixes need the eviction from exercise 6.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>What is wrong with this cache, and how would you detect it in production?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 6"><code>private static readonly ConcurrentDictionary&lt;string, Rate&gt; Cache = new();

public Rate GetRate(string key) =&gt; Cache.GetOrAdd(key, Fetch);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    400,000 distinct keys -&gt; 38.7 MB retained, none evicted</code></pre>
        <p><strong>It is not a cache. It is a dictionary that only grows.</strong>
        <code>ConcurrentDictionary</code> has no eviction, no expiry and no capacity limit — nothing
        ever removes an entry.</p>
        <p><strong>There is a second defect:</strong> <code>Fetch</code> is a side-effecting factory
        passed to <code>GetOrAdd</code>, so it can run many times per key (exercise 2 measured 200).</p>
        <p><strong>How to detect it.</strong> The shape is the diagnosis before you capture anything:
        memory grows with the number of <strong>distinct keys ever seen</strong> — not with
        concurrency, not with request size — never falls, and is cleared by a restart.</p>
        <pre data-lang="console" data-title="Confirming it"><code>dotnet-gcdump collect --process-id &lt;pid&gt;
# sort by retained size; look for a ConcurrentDictionary with a huge entry
# count, rooted by a static field or a DI singleton</code></pre>
        <p>Compare with a token-registration leak (<a href="#/m/t2-08-cancellation">t2-08</a>), which
        looks identical on a graph and roots to a <code>CancellationTokenSource</code> instead.</p>
        <p><strong>The fix</strong> is <code>MemoryCache</code> with a size limit and expiry, or a
        periodic sweep using <code>TryRemove</code> — which is atomic and safe to call while
        enumerating.</p>
        <p><strong>When a static dictionary IS acceptable as a cache:</strong> when the key space is
        genuinely bounded and small — currency codes, country codes, feature flags. Customer ids,
        session ids, URLs and tenant ids are not bounded, whatever today's data volume suggests.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 01-guarantees.cs -c Release</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-guarantees.cs"><code>// 01-guarantees.cs — what a concurrent collection actually promises, which is
// narrower than "safe to use from many threads". The composition gap, GetOrAdd
// re-entrancy, and what enumeration gives you.
//
// Counts and correctness are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-guarantees.cs -c Release
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
    static void Main()
    {
        Console.WriteLine("=== 1. what the guarantee actually is ===");
        Console.WriteLine();
        Console.WriteLine("  'Thread-safe' means: EACH METHOD is atomic with respect to the");
        Console.WriteLine("  others. TryAdd either adds or does not. TryRemove either removes or");
        Console.WriteLine("  does not. The collection cannot be corrupted.");
        Console.WriteLine();
        Console.WriteLine("  It does NOT mean any sequence of your calls is atomic. That is a");
        Console.WriteLine("  different property and nothing provides it for you.");
        Console.WriteLine();
        var (composed, trials) = ComposedOperation();
        Console.WriteLine($"  ContainsKey then Add, 8 threads : wrong in {composed} of {trials} trials");
        var (atomic, _) = AtomicOperation();
        Console.WriteLine($"  TryAdd alone                    : wrong in {atomic} of {trials} trials");
        Console.WriteLine();
        Console.WriteLine("  Both use a ConcurrentDictionary. The first composes two atomic calls");
        Console.WriteLine("  and has a gap between them; the second is one call and has none.");
        Console.WriteLine("  The collection is doing its job in both cases.");

        Console.WriteLine();
        Console.WriteLine("=== 2. the atomic operations, and what they return ===");
        Console.WriteLine();
        var d = new ConcurrentDictionary&lt;string, int&gt;();
        Console.WriteLine($"  TryAdd(\"a\", 1)                 -&gt; {d.TryAdd("a", 1)}   (added)");
        Console.WriteLine($"  TryAdd(\"a\", 2)                 -&gt; {d.TryAdd("a", 2)}   (already present)");
        Console.WriteLine($"  GetOrAdd(\"a\", 9)               -&gt; {d.GetOrAdd("a", 9)}      (existing value)");
        Console.WriteLine($"  GetOrAdd(\"b\", 5)               -&gt; {d.GetOrAdd("b", 5)}      (added)");
        Console.WriteLine($"  AddOrUpdate(\"a\", 0, (k,v)=&gt;v+10) -&gt; {d.AddOrUpdate("a", 0, (k, v) =&gt; v + 10)}");
        Console.WriteLine($"  TryUpdate(\"a\", 99, comparison 11) -&gt; {d.TryUpdate("a", 99, 11)}");
        Console.WriteLine($"  TryRemove(\"b\", out var removed)  -&gt; {d.TryRemove("b", out var removed)}, value {removed}");
        Console.WriteLine();
        Console.WriteLine("  Every one of those is a single atomic operation. Anything you need");
        Console.WriteLine("  that is not on this list is a composition, and composition is where");
        Console.WriteLine("  the bugs are.");

        Console.WriteLine();
        Console.WriteLine("=== 3. GetOrAdd does not promise the factory runs once ===");
        Console.WriteLine();
        var (factoryCalls, distinctValues) = GetOrAddFactory();
        Console.WriteLine($"  200 threads, one missing key:");
        Console.WriteLine($"    factory invocations : {factoryCalls}");
        Console.WriteLine($"    distinct values seen by callers : {distinctValues}");
        Console.WriteLine();
        Console.WriteLine("  The factory ran more than once and every caller still got the SAME");
        Console.WriteLine("  value. That is exactly the guarantee: one value wins, and the losing");
        Console.WriteLine("  factory results are discarded.");
        Console.WriteLine();
        Console.WriteLine("  Harmless when the factory is pure. A disaster when it is not — a");
        Console.WriteLine("  factory that opens a connection, charges a card or writes a file has");
        Console.WriteLine("  done that work several times, and only one result is kept.");
        Console.WriteLine();
        Console.WriteLine("  The fix is to store a Lazy&lt;T&gt;, so the dictionary races on cheap");
        Console.WriteLine("  objects and Lazy guarantees single execution of the expensive part:");
        Console.WriteLine();
        var lazyCalls = GetOrAddLazy();
        Console.WriteLine($"    with Lazy&lt;T&gt;, factory invocations : {lazyCalls}");

        Console.WriteLine();
        Console.WriteLine("=== 4. Count and enumeration are snapshots, not locks ===");
        Console.WriteLine();
        var (enumerated, changedDuring) = EnumerateWhileWriting();
        Console.WriteLine($"  enumerating a ConcurrentDictionary while 4 threads write:");
        Console.WriteLine($"    threw               : no");
        Console.WriteLine($"    items seen          : {enumerated:N0}");
        Console.WriteLine($"    items added meanwhile: {changedDuring:N0}");
        Console.WriteLine();
        Console.WriteLine("  It does not throw, which is the whole difference from Dictionary");
        Console.WriteLine("  (t2-12 measured 20 of 40 trials throwing there). What you get is a");
        Console.WriteLine("  MOVING VIEW: entries added during enumeration may or may not appear.");
        Console.WriteLine();
        Console.WriteLine("  So enumeration is safe and not consistent. If you need a stable view");
        Console.WriteLine("  — to compute a total, or to serialise the contents — use ToArray(),");
        Console.WriteLine("  which takes an internal snapshot under the collection locks.");
        Console.WriteLine();
        Console.WriteLine("  Count is a separate trap in the same area:");
        Console.WriteLine();
        Console.WriteLine($"    Count against IsEmpty, same dictionary : {CountCost():N2}x");
        Console.WriteLine();
        Console.WriteLine("  Count is not a cheap field. On ConcurrentDictionary it acquires every");
        Console.WriteLine("  internal lock to get an exact answer, so calling it in a hot loop or");
        Console.WriteLine("  a per-request metric is a genuine cost — and IsEmpty is the cheap");
        Console.WriteLine("  alternative when you only need to know whether anything is there.");

        Console.WriteLine();
        Console.WriteLine("=== 5. the collections, and what each is for ===");
        Console.WriteLine();
        Console.WriteLine("  ConcurrentDictionary&lt;K,V&gt;  keyed state. The one you will actually use.");
        Console.WriteLine("  ConcurrentQueue&lt;T&gt;         FIFO. Producer/consumer where order matters.");
        Console.WriteLine("  ConcurrentStack&lt;T&gt;         LIFO. Object pools, work stealing.");
        Console.WriteLine("  ConcurrentBag&lt;T&gt;           unordered, THREAD-AFFINE. See below.");
        Console.WriteLine("  BlockingCollection&lt;T&gt;      a wrapper adding blocking and bounding.");
        Console.WriteLine();
        var (sameMs, stealMs) = BagAffinity();
        Console.WriteLine("  ConcurrentBag, 200,000 items, drained two ways:");
        Console.WriteLine($"    drained by the thread that added them : {1.0,5:N2}x  (baseline)");
        Console.WriteLine($"    drained by a different thread         : {stealMs / sameMs,5:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Both drains return every item — a bag is correct either way. What");
        Console.WriteLine("  differs is the cost, because a bag keeps a per-thread list and");
        Console.WriteLine("  prefers your own. Taking from another thread's list is a STEAL, and");
        Console.WriteLine("  it needs synchronisation that the local path avoids.");
        Console.WriteLine();
        Console.WriteLine("  So a bag is fast when producers are also consumers, and a poor queue");
        Console.WriteLine("  when a dedicated consumer drains what other threads produced — which");
        Console.WriteLine("  is the shape most people reach for it in. Use ConcurrentQueue there.");
        Console.WriteLine();
        Console.WriteLine("  BlockingCollection deserves one note: it is the OLD answer for");
        Console.WriteLine("  producer/consumer, and its Take() BLOCKS a thread. For async code");
        Console.WriteLine("  Channels (t2-14) replace it entirely — same job, no blocked threads,");
        Console.WriteLine("  and a bound you choose.");
    }

    // --- 1 --------------------------------------------------------------------
    static (int wrong, int trials) ComposedOperation() =&gt; Race(useAtomic: false);
    static (int wrong, int trials) AtomicOperation() =&gt; Race(useAtomic: true);

    static (int wrong, int trials) Race(bool useAtomic)
    {
        const int Trials = 40;
        var wrong = 0;

        for (var t = 0; t &lt; Trials; t++)
        {
            var map = new ConcurrentDictionary&lt;string, int&gt;();
            var adds = 0;
            var ready = new ManualResetEventSlim(false);
            var threads = new Thread[8];

            for (var i = 0; i &lt; 8; i++)
            {
                threads[i] = new Thread(() =&gt;
                {
                    ready.Wait();
                    if (useAtomic)
                    {
                        if (map.TryAdd("key", 1)) Interlocked.Increment(ref adds);
                    }
                    else
                    {
                        if (!map.ContainsKey("key"))          // CHECK
                        {
                            map["key"] = 1;                   // ACT
                            Interlocked.Increment(ref adds);
                        }
                    }
                });
                threads[i].Start();
            }
            ready.Set();
            foreach (var th in threads) th.Join();
            if (adds != 1) wrong++;
        }
        return (wrong, Trials);
    }

    // --- 3 --------------------------------------------------------------------
    static (int calls, int distinct) GetOrAddFactory()
    {
        var map = new ConcurrentDictionary&lt;string, Guid&gt;();
        var calls = 0;
        var seen = new ConcurrentBag&lt;Guid&gt;();
        var ready = new ManualResetEventSlim(false);
        var threads = new Thread[200];

        for (var i = 0; i &lt; 200; i++)
        {
            threads[i] = new Thread(() =&gt;
            {
                ready.Wait();
                var v = map.GetOrAdd("k", _ =&gt;
                {
                    Interlocked.Increment(ref calls);
                    Thread.SpinWait(200);          // widen the window
                    return Guid.NewGuid();
                });
                seen.Add(v);
            });
            threads[i].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
        return (calls, seen.Distinct().Count());
    }

    static int GetOrAddLazy()
    {
        var map = new ConcurrentDictionary&lt;string, Lazy&lt;Guid&gt;&gt;();
        var calls = 0;
        var ready = new ManualResetEventSlim(false);
        var threads = new Thread[200];

        for (var i = 0; i &lt; 200; i++)
        {
            threads[i] = new Thread(() =&gt;
            {
                ready.Wait();
                var lazy = map.GetOrAdd("k", _ =&gt; new Lazy&lt;Guid&gt;(() =&gt;
                {
                    Interlocked.Increment(ref calls);
                    Thread.SpinWait(200);
                    return Guid.NewGuid();
                }, LazyThreadSafetyMode.ExecutionAndPublication));
                _ = lazy.Value;
            });
            threads[i].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
        return calls;
    }

    // --- 4 --------------------------------------------------------------------
    static (int enumerated, int added) EnumerateWhileWriting()
    {
        var map = new ConcurrentDictionary&lt;int, int&gt;();
        for (var i = 0; i &lt; 5_000; i++) map[i] = i;

        var stop = new CancellationTokenSource();
        var added = 0;
        var writers = new Thread[4];
        for (var w = 0; w &lt; 4; w++)
        {
            var seed = 100_000 * (w + 1);
            writers[w] = new Thread(() =&gt;
            {
                var k = seed;
                while (!stop.IsCancellationRequested)
                {
                    map[k++] = 1;
                    Interlocked.Increment(ref added);
                }
            }) { IsBackground = true };
            writers[w].Start();
        }

        var seen = 0;
        foreach (var _ in map) { seen++; Thread.SpinWait(50); }

        stop.Cancel();
        foreach (var w in writers) w.Join(500);
        return (seen, Volatile.Read(ref added));
    }

    static double CountCost()
    {
        var map = new ConcurrentDictionary&lt;int, int&gt;();
        for (var i = 0; i &lt; 200_000; i++) map[i] = i;

        var sw = Stopwatch.StartNew();
        long sink = 0;
        for (var i = 0; i &lt; 2_000; i++) sink += map.Count;
        var countMs = sw.Elapsed.TotalMilliseconds;

        sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 2_000; i++) sink += map.IsEmpty ? 0 : 1;
        var isEmptyMs = sw.Elapsed.TotalMilliseconds;

        GC.KeepAlive(sink);
        return countMs / Math.Max(isEmptyMs, 0.0001);
    }

    // --- 5 --------------------------------------------------------------------
    /// &lt;summary&gt;
    /// Both drains take every item; the difference is what it costs. Draining
    /// from the adding thread reads its own local list. Draining from another
    /// thread steals, which needs synchronisation.
    /// &lt;/summary&gt;
    static (double sameMs, double stealMs) BagAffinity()
    {
        const int Items = 200_000;

        // Same thread adds and drains: the local fast path.
        var sw = Stopwatch.StartNew();
        var localCount = 0;
        var local = new Thread(() =&gt;
        {
            var bag = new ConcurrentBag&lt;int&gt;();
            for (var i = 0; i &lt; Items; i++) bag.Add(i);
            while (bag.TryTake(out _)) localCount++;
        });
        local.Start();
        local.Join();
        var sameMs = sw.Elapsed.TotalMilliseconds;

        // One thread adds, another drains: every take is a steal.
        var shared = new ConcurrentBag&lt;int&gt;();
        var filler = new Thread(() =&gt; { for (var i = 0; i &lt; Items; i++) shared.Add(i); });
        filler.Start();
        filler.Join();

        sw = Stopwatch.StartNew();
        var stolenCount = 0;
        var drainer = new Thread(() =&gt; { while (shared.TryTake(out _)) stolenCount++; });
        drainer.Start();
        drainer.Join();
        var stealMs = sw.Elapsed.TotalMilliseconds;

        if (localCount != Items || stolenCount != Items)
            throw new InvalidOperationException("a drain lost items, which should not happen");

        return (sameMs, stealMs);
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-production.cs"><code>// 02-production.cs — Ledger's per-customer rate limiter. A ConcurrentDictionary
// used correctly for storage and incorrectly for the operation it was asked to
// perform, plus the unbounded growth nobody noticed for a year.
//
// Counts are exact; timings are ratios.
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

namespace Ledger.RateLimiting;

/// &lt;summary&gt;
/// THE SHIPPED VERSION. Read the count, add one, write it back. Every call is
/// atomic and the sequence is not, so requests are admitted over the limit.
/// &lt;/summary&gt;
public sealed class LimiterV1
{
    private readonly ConcurrentDictionary&lt;string, int&gt; _counts = new();
    public bool TryAcquire(string customer, int limit)
    {
        _counts.TryGetValue(customer, out var current);   // READ
        if (current &gt;= limit) return false;               // DECIDE
        _counts[customer] = current + 1;                  // WRITE
        return true;
    }
    public int CountFor(string customer) =&gt; _counts.TryGetValue(customer, out var v) ? v : 0;
}

/// &lt;summary&gt;
/// THE FIX. AddOrUpdate performs the read, the decision and the write as one
/// atomic operation, so no two threads can both see the same "current".
/// &lt;/summary&gt;
public sealed class LimiterV2
{
    private readonly ConcurrentDictionary&lt;string, int&gt; _counts = new();
    public bool TryAcquire(string customer, int limit)
    {
        var updated = _counts.AddOrUpdate(customer, 1, (_, current) =&gt; current + 1);
        if (updated &lt;= limit) return true;
        _counts.AddOrUpdate(customer, 0, (_, current) =&gt; current - 1);   // give it back
        return false;
    }
    public int CountFor(string customer) =&gt; _counts.TryGetValue(customer, out var v) ? v : 0;
}

/// &lt;summary&gt;
/// ALSO CORRECT, and simpler to reason about: one lock per customer, held for
/// nanoseconds. Correctness by inspection, at the cost of a lock object per key.
/// &lt;/summary&gt;
public sealed class LimiterV3
{
    private readonly ConcurrentDictionary&lt;string, Counter&gt; _counts = new();
    private sealed class Counter { public int Value; }

    public bool TryAcquire(string customer, int limit)
    {
        var counter = _counts.GetOrAdd(customer, _ =&gt; new Counter());
        lock (counter)
        {
            if (counter.Value &gt;= limit) return false;
            counter.Value++;
            return true;
        }
    }
    public int CountFor(string customer) =&gt;
        _counts.TryGetValue(customer, out var c) ? Volatile.Read(ref c.Value) : 0;
}

class Program
{
    const int Trials = 30;
    const int Threads = 16;
    const int Limit = 10;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger rate-limits each customer to 10 concurrent API calls. The");
        Console.WriteLine("  limiter uses a ConcurrentDictionary, which is thread-safe, so the");
        Console.WriteLine("  author reasonably concluded the limiter was too:");
        Console.WriteLine();
        Console.WriteLine("      _counts.TryGetValue(customer, out var current);   // READ");
        Console.WriteLine("      if (current &gt;= limit) return false;               // DECIDE");
        Console.WriteLine("      _counts[customer] = current + 1;                  // WRITE");
        Console.WriteLine();
        Console.WriteLine("  A customer with an aggressive client saturated a downstream service");
        Console.WriteLine("  that Ledger shares with three other teams. The limiter reported that");
        Console.WriteLine("  it was working.");
        Console.WriteLine();
        Console.WriteLine($"  {Threads} threads racing for a limit of {Limit}, {Trials} trials:");
        Console.WriteLine();
        Console.WriteLine("  implementation                 admitted over limit   worst overshoot");

        Report("V1: read, decide, write", Race(c =&gt; new Wrapper(new LimiterV1(), c)));
        Report("V2: AddOrUpdate", Race(c =&gt; new Wrapper(new LimiterV2(), c)));
        Report("V3: lock per customer", Race(c =&gt; new Wrapper(new LimiterV3(), c)));

        Console.WriteLine();
        Console.WriteLine("  The dictionary was never corrupted and never lost an entry. Every");
        Console.WriteLine("  individual call did exactly what it promised. The LIMIT was still");
        Console.WriteLine("  wrong, because the limiter is three operations and the guarantee");
        Console.WriteLine("  covers one at a time.");
        Console.WriteLine();
        Console.WriteLine("  This is the defining mistake with concurrent collections, and it is");
        Console.WriteLine("  not a misunderstanding of threading — it is a misreading of what the");
        Console.WriteLine("  word 'thread-safe' claims. It claims the COLLECTION is safe. It says");
        Console.WriteLine("  nothing about your operation.");

        Console.WriteLine();
        Console.WriteLine("=== the two fixes, and when each is right ===");
        Console.WriteLine();
        Console.WriteLine("  V2 collapses read-decide-write into one atomic call. It is the");
        Console.WriteLine("  idiomatic answer and it has a wrinkle worth seeing: the decrement on");
        Console.WriteLine("  the rejection path means the count briefly exceeds the limit, so a");
        Console.WriteLine("  concurrent reader can observe 11. Correct for admission control,");
        Console.WriteLine("  wrong if the count itself is displayed anywhere.");
        Console.WriteLine();
        Console.WriteLine("  V3 puts a lock around the decision. The lock is per customer and is");
        Console.WriteLine("  held for nanoseconds, so contention is negligible (t2-12 measured the");
        Console.WriteLine("  same shape), and the code says what it means. When an operation is");
        Console.WriteLine("  genuinely a read-decide-write, a small lock is usually clearer than");
        Console.WriteLine("  the atomic gymnastics needed to avoid it.");
        Console.WriteLine();
        var costs = CompareCost();
        Console.WriteLine($"  cost, 16 threads: V2 AddOrUpdate {1.0,5:N2}x   V3 lock-per-key {costs,5:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Note the direction: the ratio is BELOW 1, so the lock-per-key version");
        Console.WriteLine("  is two to three times faster than AddOrUpdate here. That is the");
        Console.WriteLine("  opposite of what most expect, and the reason is the same as t2-13: an");
        Console.WriteLine("  uncontended lock is cheap, while AddOrUpdate on a hot key retries its");
        Console.WriteLine("  update loop whenever another thread wins.");
        Console.WriteLine();
        Console.WriteLine("  So the choice is not a performance trade at all. Prefer whichever");
        Console.WriteLine("  states the intent more clearly — and for a read-decide-write, that is");
        Console.WriteLine("  usually the lock.");

        Console.WriteLine();
        Console.WriteLine("=== the second bug: it never forgot a customer ===");
        Console.WriteLine();
        Console.WriteLine("  Nothing removed entries. One key per customer, forever, in a");
        Console.WriteLine("  dictionary that lives as long as the process.");
        Console.WriteLine();
        var (entries, mb) = UnboundedGrowth();
        Console.WriteLine($"    {entries:N0} distinct customers seen -&gt; {mb:N1} MB retained");
        Console.WriteLine();
        Console.WriteLine("  ConcurrentDictionary has no eviction, no capacity limit and no");
        Console.WriteLine("  expiry. It is a dictionary. Used as a cache it is an unbounded one,");
        Console.WriteLine("  and 'unbounded cache' is another way of writing 'memory leak with a");
        Console.WriteLine("  hit rate'.");
        Console.WriteLine();
        Console.WriteLine("  The shape is the giveaway: memory grows with the number of DISTINCT");
        Console.WriteLine("  KEYS ever seen, not with concurrency and not with request size. It");
        Console.WriteLine("  never falls, and a restart clears it — so it survives for as long as");
        Console.WriteLine("  your deployment cadence hides it.");
        Console.WriteLine();
        Console.WriteLine("  What to use instead:");
        Console.WriteLine("    - MemoryCache, which has size limits and expiry");
        Console.WriteLine("    - a periodic sweep removing idle entries, if you keep the");
        Console.WriteLine("      dictionary; TryRemove is atomic and safe during enumeration");
        Console.WriteLine("    - for rate limiting specifically, System.Threading.RateLimiting,");
        Console.WriteLine("      which handles the windowing and the eviction for you");

        Console.WriteLine();
        Console.WriteLine("=== how each was diagnosed ===");
        Console.WriteLine();
        Console.WriteLine("  THE OVER-ADMISSION was found downstream, not here. Ledger's own");
        Console.WriteLine("  metrics said the limiter was admitting at most 10; the shared service");
        Console.WriteLine("  saw more. The detector is the one from t2-11: assert the invariant");
        Console.WriteLine("  where it can actually be checked.");
        Console.WriteLine();
        Console.WriteLine("      if (inFlight &gt; limit)");
        Console.WriteLine("          _logger.LogError(\"limiter admitted {N} over a limit of {L}\", inFlight, limit);");
        Console.WriteLine();
        Console.WriteLine("  THE LEAK was found in a gcdump:");
        Console.WriteLine();
        Console.WriteLine("    dotnet-gcdump collect --process-id &lt;pid&gt;");
        Console.WriteLine("      -&gt; ConcurrentDictionary&lt;string, int&gt; with 2.4 million entries,");
        Console.WriteLine("         rooted by a singleton");
        Console.WriteLine();
        Console.WriteLine("  Distinguishing it from the other memory failures in this track:");
        Console.WriteLine("    buffering (t2-09)   tracks request SIZE, spikes and recovers");
        Console.WriteLine("    token leak (t2-08)  tracks total requests, never falls");
        Console.WriteLine("    this                tracks DISTINCT KEYS, never falls");
        Console.WriteLine();
        Console.WriteLine("  The middle two look identical on a graph. What separates them is the");
        Console.WriteLine("  gcroot: one is a registration list on a long-lived token, the other");
        Console.WriteLine("  is a dictionary keyed by something with unbounded cardinality.");
    }

    sealed class Wrapper
    {
        private readonly object _impl;
        private readonly string _customer;
        public Wrapper(object impl, string customer) { _impl = impl; _customer = customer; }

        public bool TryAcquire(int limit) =&gt; _impl switch
        {
            LimiterV1 a =&gt; a.TryAcquire(_customer, limit),
            LimiterV2 b =&gt; b.TryAcquire(_customer, limit),
            LimiterV3 c =&gt; c.TryAcquire(_customer, limit),
            _ =&gt; false
        };
    }

    readonly record struct Outcome(int TrialsOverLimit, int WorstOvershoot);

    static Outcome Race(Func&lt;string, Wrapper&gt; make)
    {
        var over = 0;
        var worst = 0;

        for (var t = 0; t &lt; Trials; t++)
        {
            var limiter = make($"CUST-{t}");
            var admitted = 0;
            var ready = new ManualResetEventSlim(false);
            var threads = new Thread[Threads];

            for (var i = 0; i &lt; Threads; i++)
            {
                threads[i] = new Thread(() =&gt;
                {
                    ready.Wait();
                    if (limiter.TryAcquire(Limit)) Interlocked.Increment(ref admitted);
                });
                threads[i].Start();
            }
            ready.Set();
            foreach (var th in threads) th.Join();

            if (admitted &gt; Limit)
            {
                over++;
                worst = Math.Max(worst, admitted);
            }
        }
        return new Outcome(over, worst);
    }

    static void Report(string label, Outcome o) =&gt;
        Console.WriteLine($"  {label,-28} {o.TrialsOverLimit,10} of {Trials}   " +
                          $"{(o.WorstOvershoot == 0 ? "-" : o.WorstOvershoot + " admitted"),16}");

    static double CompareCost()
    {
        var v2 = TimeLimiter(customer =&gt; new Wrapper(new LimiterV2(), customer));
        var v3 = TimeLimiter(customer =&gt; new Wrapper(new LimiterV3(), customer));
        return v3 / v2;
    }

    static double TimeLimiter(Func&lt;string, Wrapper&gt; make)
    {
        Thread.Sleep(80);
        var limiter = make("CUST-HOT");
        var sw = Stopwatch.StartNew();
        var ready = new ManualResetEventSlim(false);
        var threads = new Thread[16];
        for (var i = 0; i &lt; 16; i++)
        {
            threads[i] = new Thread(() =&gt;
            {
                ready.Wait();
                for (var j = 0; j &lt; 100_000; j++) limiter.TryAcquire(int.MaxValue);
            });
            threads[i].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
        return sw.Elapsed.TotalMilliseconds;
    }

    static (int entries, double mb) UnboundedGrowth()
    {
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);

        var limiter = new LimiterV2();
        const int Customers = 400_000;
        for (var i = 0; i &lt; Customers; i++)
            limiter.TryAcquire($"CUST-{i:D9}", 10);

        var after = GC.GetTotalMemory(true);
        GC.KeepAlive(limiter);
        return (Customers, (after - before) / 1024.0 / 1024.0);
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-exercises.cs"><code>// 03-exercises.cs — every answer claimed in this module's exercises, run.
// Counts are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1: is this correct? =====");
        Console.WriteLine();
        Console.WriteLine("      if (!_map.ContainsKey(k)) _map[k] = Compute(k);");
        Console.WriteLine();
        Console.WriteLine($"    16 threads, one key : {Composed()} threads believed they added it");
        Console.WriteLine($"    the same with TryAdd: {Atomic()} thread believed it added it");
        Console.WriteLine();
        Console.WriteLine("  No. ContainsKey and the indexer are each atomic; the pair is not.");
        Console.WriteLine("  Every thread that arrives between the check and the write sees");
        Console.WriteLine("  'absent' and proceeds — and Compute runs once per thread.");
        Console.WriteLine();
        Console.WriteLine("  This is the same check-then-act shape as t2-11, and using a");
        Console.WriteLine("  concurrent collection does not close the gap. It cannot: the gap is");
        Console.WriteLine("  between two of your calls, not inside either of them.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: how many times does the factory run? =====");
        Console.WriteLine();
        Console.WriteLine("      _map.GetOrAdd(k, _ =&gt; ExpensiveCreate());");
        Console.WriteLine();
        var (calls, distinct) = FactoryRuns();
        Console.WriteLine($"    200 threads, one missing key -&gt; factory ran {calls} times");
        Console.WriteLine($"    distinct values returned to callers : {distinct}");
        Console.WriteLine($"    with Lazy&lt;T&gt; as the value           : {LazyRuns()} time");
        Console.WriteLine();
        Console.WriteLine("  More than once, and every caller still received the SAME value. That");
        Console.WriteLine("  is precisely the documented guarantee: one value wins and the losing");
        Console.WriteLine("  factory results are thrown away.");
        Console.WriteLine();
        Console.WriteLine("  Harmless for a pure factory. If the factory opens a connection,");
        Console.WriteLine("  charges a card or writes a file, that work happened several times and");
        Console.WriteLine("  only one result was kept.");
        Console.WriteLine();
        Console.WriteLine("  Store a Lazy&lt;T&gt;: the dictionary races on cheap Lazy objects, and Lazy");
        Console.WriteLine("  with ExecutionAndPublication guarantees the expensive part runs once.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: what does enumeration give you? =====");
        Console.WriteLine();
        var (seen, added) = Enumerate();
        Console.WriteLine($"    threw while writers ran : no");
        Console.WriteLine($"    items seen              : {seen:N0}");
        Console.WriteLine($"    items added meanwhile   : {added:N0}");
        Console.WriteLine();
        Console.WriteLine("  Safe, and not consistent. It never throws — the difference from a");
        Console.WriteLine("  plain Dictionary, which threw in 20 of 40 trials in t2-12 — but what");
        Console.WriteLine("  you get is a MOVING VIEW rather than a snapshot.");
        Console.WriteLine();
        Console.WriteLine("  Entries added during the walk may or may not appear. For a stable");
        Console.WriteLine("  view use ToArray(), which snapshots under the internal locks.");
        Console.WriteLine();
        Console.WriteLine($"    Count against IsEmpty on 200,000 entries : {CountCost():N1}x");
        Console.WriteLine();
        Console.WriteLine("  And Count is not a field. On ConcurrentDictionary it takes every");
        Console.WriteLine("  internal lock to produce an exact answer, so it does not belong in a");
        Console.WriteLine("  hot path. IsEmpty is the cheap question.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: which collection? =====");
        Console.WriteLine();
        Console.WriteLine("  need                                        use");
        Console.WriteLine("  keyed state shared by many threads          ConcurrentDictionary");
        Console.WriteLine("  FIFO work handoff, order matters            ConcurrentQueue");
        Console.WriteLine("  an object pool                              ConcurrentStack");
        Console.WriteLine("  producers that are also the consumers       ConcurrentBag");
        Console.WriteLine("  async producer/consumer with a bound        Channel (t2-14)");
        Console.WriteLine("  a snapshot everyone reads and rarely writes  ImmutableDictionary");
        Console.WriteLine();
        var (localMs, stealMs) = BagAffinity();
        Console.WriteLine($"    ConcurrentBag drained by its producer   : {1.0,5:N2}x  (baseline)");
        Console.WriteLine($"    ConcurrentBag drained by another thread : {stealMs / localMs,5:N2}x");
        Console.WriteLine();
        Console.WriteLine("  A bag keeps a per-thread list and prefers your own; taking from");
        Console.WriteLine("  another thread's list is a steal. Both are correct — the difference");
        Console.WriteLine("  is cost, and it argues against using a bag as a general queue.");
        Console.WriteLine();
        Console.WriteLine("  BlockingCollection is the old producer/consumer answer and its Take()");
        Console.WriteLine("  blocks a thread. In async code, Channels replace it outright.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: fix the rate limiter =====");
        Console.WriteLine();
        Console.WriteLine("      _counts.TryGetValue(c, out var n);");
        Console.WriteLine("      if (n &gt;= limit) return false;");
        Console.WriteLine("      _counts[c] = n + 1;");
        Console.WriteLine();
        Console.WriteLine("  16 threads, limit 10, 30 trials:");
        Console.WriteLine($"    read-decide-write : over the limit in {LimiterRace(false)} of 30 trials");
        Console.WriteLine($"    AddOrUpdate       : over the limit in {LimiterRace(true)} of 30 trials");
        Console.WriteLine();
        Console.WriteLine("  Collapse the three steps into one atomic call:");
        Console.WriteLine();
        Console.WriteLine("      var n = _counts.AddOrUpdate(c, 1, (_, v) =&gt; v + 1);");
        Console.WriteLine("      if (n &lt;= limit) return true;");
        Console.WriteLine("      _counts.AddOrUpdate(c, 0, (_, v) =&gt; v - 1);   // give it back");
        Console.WriteLine("      return false;");
        Console.WriteLine();
        Console.WriteLine("  Or put a small lock around the decision, which reads more clearly and");
        Console.WriteLine("  measured FASTER here — an uncontended lock is cheap, while AddOrUpdate");
        Console.WriteLine("  retries its update loop under contention (t2-13).");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: what is wrong with this cache? =====");
        Console.WriteLine();
        Console.WriteLine("      private static readonly ConcurrentDictionary&lt;string, Rate&gt; Cache = new();");
        Console.WriteLine("      Cache.GetOrAdd(key, Fetch);");
        Console.WriteLine();
        var (keys, mb) = Growth();
        Console.WriteLine($"    {keys:N0} distinct keys -&gt; {mb:N1} MB retained, none evicted");
        Console.WriteLine();
        Console.WriteLine("  ConcurrentDictionary has no eviction, no capacity and no expiry. It");
        Console.WriteLine("  is a dictionary. Used as a cache it is an UNBOUNDED one, which is a");
        Console.WriteLine("  memory leak with a hit rate.");
        Console.WriteLine();
        Console.WriteLine("  The signature: memory grows with the number of DISTINCT KEYS ever");
        Console.WriteLine("  seen — not with concurrency, not with request size — never falls, and");
        Console.WriteLine("  is cleared by a restart. It survives for as long as your deployment");
        Console.WriteLine("  cadence hides it.");
        Console.WriteLine();
        Console.WriteLine("  It is only safe when the key space is genuinely bounded and small:");
        Console.WriteLine("  currency codes, country codes, feature flags. Customer ids, session");
        Console.WriteLine("  ids and URLs are not bounded.");
        Console.WriteLine();
        Console.WriteLine("  Use MemoryCache, which has size limits and expiry, or sweep idle");
        Console.WriteLine("  entries periodically with TryRemove, which is atomic and safe to call");
        Console.WriteLine("  during enumeration.");
    }

    // --- 1 --------------------------------------------------------------------
    static int Composed()
    {
        var map = new ConcurrentDictionary&lt;string, int&gt;();
        var wins = 0;
        Run(() =&gt;
        {
            if (!map.ContainsKey("k")) { map["k"] = 1; Interlocked.Increment(ref wins); }
        });
        return wins;
    }

    static int Atomic()
    {
        var map = new ConcurrentDictionary&lt;string, int&gt;();
        var wins = 0;
        Run(() =&gt; { if (map.TryAdd("k", 1)) Interlocked.Increment(ref wins); });
        return wins;
    }

    // --- 2 --------------------------------------------------------------------
    static (int calls, int distinct) FactoryRuns()
    {
        var map = new ConcurrentDictionary&lt;string, Guid&gt;();
        var calls = 0;
        var seen = new ConcurrentBag&lt;Guid&gt;();
        Run(() =&gt;
        {
            var v = map.GetOrAdd("k", _ =&gt;
            {
                Interlocked.Increment(ref calls);
                Thread.SpinWait(200);
                return Guid.NewGuid();
            });
            seen.Add(v);
        }, threads: 200);
        return (calls, seen.Distinct().Count());
    }

    static int LazyRuns()
    {
        var map = new ConcurrentDictionary&lt;string, Lazy&lt;Guid&gt;&gt;();
        var calls = 0;
        Run(() =&gt;
        {
            var lazy = map.GetOrAdd("k", _ =&gt; new Lazy&lt;Guid&gt;(() =&gt;
            {
                Interlocked.Increment(ref calls);
                Thread.SpinWait(200);
                return Guid.NewGuid();
            }, LazyThreadSafetyMode.ExecutionAndPublication));
            _ = lazy.Value;
        }, threads: 200);
        return calls;
    }

    // --- 3 --------------------------------------------------------------------
    static (int seen, int added) Enumerate()
    {
        var map = new ConcurrentDictionary&lt;int, int&gt;();
        for (var i = 0; i &lt; 5_000; i++) map[i] = i;

        var stop = new CancellationTokenSource();
        var added = 0;
        var writers = new Thread[4];
        for (var w = 0; w &lt; 4; w++)
        {
            var seed = 100_000 * (w + 1);
            writers[w] = new Thread(() =&gt;
            {
                var k = seed;
                while (!stop.IsCancellationRequested) { map[k++] = 1; Interlocked.Increment(ref added); }
            }) { IsBackground = true };
            writers[w].Start();
        }

        var seen = 0;
        foreach (var _ in map) { seen++; Thread.SpinWait(50); }

        stop.Cancel();
        foreach (var w in writers) w.Join(500);
        return (seen, Volatile.Read(ref added));
    }

    static double CountCost()
    {
        var map = new ConcurrentDictionary&lt;int, int&gt;();
        for (var i = 0; i &lt; 200_000; i++) map[i] = i;
        long sink = 0;

        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 2_000; i++) sink += map.Count;
        var countMs = sw.Elapsed.TotalMilliseconds;

        sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 2_000; i++) sink += map.IsEmpty ? 0 : 1;
        var emptyMs = sw.Elapsed.TotalMilliseconds;

        GC.KeepAlive(sink);
        return countMs / Math.Max(emptyMs, 0.0001);
    }

    // --- 4 --------------------------------------------------------------------
    static (double localMs, double stealMs) BagAffinity()
    {
        const int Items = 200_000;

        var sw = Stopwatch.StartNew();
        var localTaken = 0;
        var local = new Thread(() =&gt;
        {
            var bag = new ConcurrentBag&lt;int&gt;();
            for (var i = 0; i &lt; Items; i++) bag.Add(i);
            while (bag.TryTake(out _)) localTaken++;
        });
        local.Start(); local.Join();
        var localMs = sw.Elapsed.TotalMilliseconds;

        var shared = new ConcurrentBag&lt;int&gt;();
        var filler = new Thread(() =&gt; { for (var i = 0; i &lt; Items; i++) shared.Add(i); });
        filler.Start(); filler.Join();

        sw = Stopwatch.StartNew();
        var stolen = 0;
        var drainer = new Thread(() =&gt; { while (shared.TryTake(out _)) stolen++; });
        drainer.Start(); drainer.Join();

        if (localTaken != Items || stolen != Items)
            throw new InvalidOperationException("a drain lost items");
        return (localMs, sw.Elapsed.TotalMilliseconds);
    }

    // --- 5 --------------------------------------------------------------------
    static int LimiterRace(bool atomic)
    {
        const int Limit = 10;
        var over = 0;
        for (var t = 0; t &lt; 30; t++)
        {
            var counts = new ConcurrentDictionary&lt;string, int&gt;();
            var admitted = 0;
            Run(() =&gt;
            {
                bool ok;
                if (atomic)
                {
                    var n = counts.AddOrUpdate("c", 1, (_, v) =&gt; v + 1);
                    if (n &lt;= Limit) ok = true;
                    else { counts.AddOrUpdate("c", 0, (_, v) =&gt; v - 1); ok = false; }
                }
                else
                {
                    counts.TryGetValue("c", out var n);
                    if (n &gt;= Limit) ok = false;
                    else { counts["c"] = n + 1; ok = true; }
                }
                if (ok) Interlocked.Increment(ref admitted);
            }, threads: 16);
            if (admitted &gt; Limit) over++;
        }
        return over;
    }

    // --- 6 --------------------------------------------------------------------
    static (int keys, double mb) Growth()
    {
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var cache = new ConcurrentDictionary&lt;string, int&gt;();
        const int Keys = 400_000;
        for (var i = 0; i &lt; Keys; i++) cache.GetOrAdd($"KEY-{i:D9}", 1);
        var after = GC.GetTotalMemory(true);
        GC.KeepAlive(cache);
        return (Keys, (after - before) / 1024.0 / 1024.0);
    }

    static void Run(Action body, int threads = 16)
    {
        var ready = new ManualResetEventSlim(false);
        var all = new Thread[threads];
        for (var i = 0; i &lt; threads; i++)
        {
            all[i] = new Thread(() =&gt; { ready.Wait(); body(); });
            all[i].Start();
        }
        ready.Set();
        foreach (var t in all) t.Join();
    }
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does "thread-safe collection" actually guarantee?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>That <strong>each method</strong> is atomic with respect to the others, and the collection
        cannot be corrupted. It says nothing about a sequence of your calls — measured, 12 of 16
        threads believed they had added the same key using <code>ContainsKey</code> then an
        assignment.</p>
      </div></details>
    </li>
    <li>
      <p>Name the atomic operations on <code>ConcurrentDictionary</code>.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>TryAdd</code>, <code>TryRemove</code>, <code>TryUpdate</code>, <code>GetOrAdd</code>,
        <code>AddOrUpdate</code>, and the indexer. Anything else is a composition you have to protect
        yourself.</p>
      </div></details>
    </li>
    <li>
      <p>How many times can <code>GetOrAdd</code>'s factory run?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Up to once per contending thread — measured at <strong>131 for one key</strong>, with every
        caller receiving the same value. One <em>value</em> wins; the factory is not serialised. Store
        a <code>Lazy&lt;T&gt;</code> if it has side effects.</p>
      </div></details>
    </li>
    <li>
      <p>Is enumeration safe? Is it consistent?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Safe, not consistent.</strong> It never throws (a plain <code>Dictionary</code>
        threw in 20 of 40 trials), but it is a moving view — 17,215 items seen while 318,341 were
        added. Use <code>ToArray()</code> for a snapshot.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>Count</code> cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It acquires every internal lock for an exact answer — measured at <strong>45×</strong> the
        cost of <code>IsEmpty</code> on 200,000 entries. It is not a field.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>ConcurrentBag</code> rarely the right choice?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It is <strong>thread-affine</strong>: it prefers the per-thread list of the calling thread,
        so a dedicated consumer steals from every producer — measured at 1.72× the local path. It suits
        producers that are also consumers; use <code>ConcurrentQueue</code> for handoff.</p>
      </div></details>
    </li>
    <li>
      <p>Is a <code>ConcurrentDictionary</code> a cache?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — no eviction, no expiry, no capacity. Measured: 400,000 keys retaining 41.8 MB with
        nothing removed. Safe only when the key space is genuinely bounded and small.</p>
      </div></details>
    </li>
    <li>
      <p>How do you distinguish this leak from the other memory failures in this track?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It tracks <strong>distinct keys ever seen</strong> and never falls. Buffering
        (<a href="#/m/t2-09-iasyncenumerable">t2-09</a>) tracks request <em>size</em> and recovers; a
        token leak (<a href="#/m/t2-08-cancellation">t2-08</a>) tracks total requests. The last two
        look identical on a graph — the <code>gcroot</code> separates them.</p>
      </div></details>
    </li>
    <li>
      <p>Is a concurrent collection faster than a lock?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Not necessarily. A per-key lock measured <strong>two to three times faster</strong> than
        <code>AddOrUpdate</code> on a contended key, because an uncontended lock is cheap while an
        update loop retries.</p>
      </div></details>
    </li>
    <li>
      <p>Your limiter over-admits. Where do you look first?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>At how many <em>calls</em> the logical operation makes. Read-decide-write is three, so it
        needs one atomic call or a lock. The collection is almost never the problem — measured, it was
        never corrupted while admitting 16 against a limit of 10.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
