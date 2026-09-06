CSPREP.module({
  id: "t2-12-locking",
  minutes: 55,
  updated: "2026-08-31",
  summary: "A lock is rarely the cost; what you do while holding it is. Ledger's netting service was measured 8.0x slower than identical code with one remote call moved outside the critical section, with every total correct and every test passing. This module covers what a lock guarantees, how granularity trades contention against deadlock risk, why lock ordering is a proof rather than a mitigation, and the one counter that separates a deadlock from a lock held too long.",
  terms: ["lock", "Monitor", "mutual exclusion", "critical section", "reentrancy", "contention",
    "lock striping", "granularity", "deadlock", "lock ordering", "TryEnter", "livelock",
    "System.Threading.Lock", "syncblk", "CS1996", "CS9216"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger nets settlement positions by counterparty. The netting service is a singleton, its
  <code>Add</code> method is called from every request thread, and it holds shared state — so it takes
  a lock. That is exactly the right instinct, and the code was reviewed twice and shipped:</p>

  <pre data-lang="csharp" data-net="10" data-title="NettingService.cs"><code>lock (_gate)
{
    var rate = _rates.GetRate(p.Counterparty);        // a 20 ms remote call
    _totals[p.Counterparty] = running + p.Amount * rate;
}</code></pre>

  <p>The totals were never wrong. Not once. The lock is correct, the arithmetic is correct, and every
  test passed.</p>

  <p>The endpoint became unusable at eight concurrent requests, and for two days nobody could see
  why. The processor was near zero. Memory was flat. No exception was thrown. The rates service
  reported entirely normal latency, because each individual call to it <em>was</em> fast. Adding a
  second instance did not help, and neither did adding cores.</p>

  <p>The defect is not in the locking. It is in <strong>what the lock spans</strong>. A 20 ms remote
  call sits inside the critical section, so the service has an effective concurrency of one no matter
  how much hardware you give it. Measured here: <strong>8.0× slower than the identical code with the
  call moved one line up</strong>, with the same answer and the same number of remote calls.</p>

  <p>This module is about the three questions that decide whether a lock helps or hurts: what it
  protects, how long it is held, and whether two of them can be taken in conflicting orders. The last
  produces the failure that no amount of correct code inside the lock can save you from.</p>
</section>

<section id="plain-language">
  <h2>What a lock is</h2>

  <p class="define"><span class="define__term">Thread</span> An independent sequence of instructions
  the operating system can run. Two threads in one process share memory, which is what makes
  coordination necessary.</p>

  <p class="define"><span class="define__term">Mutual exclusion</span> The guarantee that at most one
  thread at a time executes a given region of code. It is the simplest way to make a multi-step
  operation behave as though it were one step.</p>

  <p class="define"><span class="define__term">Critical section</span> The region a lock protects —
  the code between acquiring and releasing. Its length is the single most important property of a
  lock, because only that part serialises.</p>

  <p class="define"><span class="define__term">Monitor</span> The .NET mechanism behind the
  <code>lock</code> keyword. Every object can act as one. A monitor has an owning thread and a
  recursion count, which is why it is reentrant and why it cannot be held across an
  <code>await</code>.</p>

  <p class="define"><span class="define__term">Contention</span> A thread arriving at a lock that
  someone else holds, and having to wait. <code>Monitor.LockContentionCount</code> counts these, and
  it is the number to watch — it is a count rather than a duration, so it is stable enough to compare
  between runs.</p>

  <p><strong>An analogy, and its limits.</strong> A lock is a meeting room with one key on a hook.
  You take the key, use the room, put it back. Anyone who arrives while the key is gone waits. If you
  take the key and then spend twenty minutes on the phone in there, everyone waits twenty minutes —
  even though the phone call had nothing to do with the room.</p>

  <p><strong>Where the analogy breaks:</strong> nothing physically stops you entering the room without
  the key. A lock protects data only because every path that touches that data agrees to take it.
  Nothing in the type system connects a gate to the fields it guards, and a single method that
  forgets silently removes the protection for everyone. That is measured later in this module: an
  unlocked read against locked writes threw in <strong>20 of 40 trials</strong>.</p>

  <h3>What the keyword compiles to</h3>

  <pre data-lang="csharp" data-net="10" data-title="lock (gate) { Body(); } becomes"><code>var taken = false;
try
{
    Monitor.Enter(gate, ref taken);
    Body();
}
finally
{
    if (taken) Monitor.Exit(gate);
}</code></pre>

  <p>Three consequences, all of which matter.</p>

  <p><strong>The <code>finally</code> means an exception releases the lock.</strong> A throw cannot
  leave a monitor held, which is the main reason to use the keyword rather than calling
  <code>Monitor</code> directly.</p>

  <p><strong>The <code>taken</code> flag exists because <code>Monitor.Enter</code> can be interrupted
  between acquiring the lock and returning.</strong> Without it a <code>finally</code> could attempt
  to exit a monitor it never entered.</p>

  <p><strong>The lock is on an object, not on the data.</strong> Nothing connects the gate to the
  fields it protects except your discipline.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="06-minimal-example.cs"><code>// 06-minimal-example.cs — the smallest program showing what a lock buys and what
// it costs: the same counter with and without one.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 06-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

class Program
{
    static readonly Lock Gate = new();      // System.Threading.Lock, .NET 9+
    static int _unlocked;
    static int _locked;

    static void Main()
    {
        var t1 = Run(() =&gt; _unlocked++);
        var t2 = Run(() =&gt; { lock (Gate) { _locked++; } });

        Console.WriteLine($"no lock : {_unlocked,9:N0} of 800,000   {(_unlocked == 800_000 ? "correct" : "WRONG")}");
        Console.WriteLine($"lock    : {_locked,9:N0} of 800,000   {(_locked == 800_000 ? "correct" : "WRONG")}");
        Console.WriteLine($"the lock cost {t2 / t1:N1}x the time, and is the difference between");
        Console.WriteLine("an answer and a number.");
    }

    static double Run(Action increment)
    {
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();
        for (var t = 0; t &lt; 8; t++)
        {
            threads[t] = new Thread(() =&gt;
            {
                ready.Wait();
                for (var i = 0; i &lt; 100_000; i++) increment();
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
        return sw.Elapsed.TotalMilliseconds;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>no lock :   182,813 of 800,000   WRONG
lock    :   800,000 of 800,000   correct
the lock cost 8.7x the time, and is the difference between
an answer and a number.</code></pre>

  <p>Eight threads, a hundred thousand increments each. Without the lock, more than three quarters of
  the work vanished — the lost-update mechanism from
  <a href="#/m/t2-11-race-conditions">t2-11</a>, where <code>x++</code> is a load, an add and a store
  that other threads can interleave with.</p>

  <p><strong>The lock costs several times the time and buys correctness.</strong> That trade is
  almost always worth taking, and the ratio is worth keeping in perspective: this benchmark does
  nothing but contend, so it is close to the worst case a lock can produce. Real code does work
  between acquisitions.</p>

  <p>Note the declaration:</p>

  <pre data-lang="csharp" data-net="10" data-title="The .NET 9+ form"><code>static readonly Lock Gate = new();      // System.Threading.Lock</code></pre>

  <p class="define"><span class="define__term">System.Threading.Lock</span> A dedicated lock type
  added in .NET 9. When <code>lock</code>'s target is one of these, the compiler emits
  <code>using (gate.EnterScope())</code> instead of <code>Monitor.Enter</code>. It is faster, it
  cannot be locked by anyone who happens to hold a reference to your object, and it exposes
  <code>TryEnter</code> and <code>IsHeldByCurrentThread</code> directly.</p>
</section>

<section id="what-lock-guarantees">
  <h2>What a lock guarantees, and what it does not</h2>

  <h3>It is reentrant</h3>

  <pre data-lang="console" data-title="01-what-lock-is.cs"><code>  the same thread entered the same lock 3 times, nested
  IsEntered from inside  : True</code></pre>

  <p class="define"><span class="define__term">Reentrancy</span> A thread that already owns a monitor
  may enter it again; the runtime keeps a count and releases on the matching exit. It makes recursion
  and calling one locked method from another work without thought.</p>

  <p>It also hides a design problem. If <code>A</code> locks and calls <code>B</code>, which locks the
  same gate, then <code>B</code> runs while <code>A</code> is midway through mutating the state that
  lock protects. <strong>Reentrancy means that compiles, runs, and produces a torn view rather than a
  deadlock.</strong></p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><code>SemaphoreSlim(1,1)</code>, which <a href="#/m/t2-14-async-coordination">t2-14</a> uses as
    the async equivalent of a lock, is <strong>not</strong> reentrant. The same nested pattern
    deadlocks immediately:</p>
    <pre data-lang="console" data-title="05-exercises.cs"><code>  same thread, same monitor, nested : entered twice, no deadlock
    same pattern with SemaphoreSlim : DEADLOCKED on the second Wait (timed out at 200 ms)</code></pre>
    <p>Neither behaviour is better. They fail differently, and which failure you get depends on a
    choice you probably made for unrelated reasons.</p>
  </div>

  <h3>It cannot be held across an <code>await</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: does not compile, and the workaround is worse"><code>// CS1996: cannot await in the body of a lock statement.
lock (_gate) { var rate = await FetchRateAsync(); }

// Compiles. Far worse. Holds the monitor for the whole I/O operation AND
// blocks a pool thread (t2-07).
lock (_gate) { var rate = FetchRateAsync().Result; }

// Right: SemaphoreSlim is not thread-owned, so it can be held across an await.
await _gate.WaitAsync(ct);
try     { var rate = await FetchRateAsync(ct); }
finally { _gate.Release(); }</code></pre>

  <p>CS1996 is a compiler error rather than a warning, and it is a good one: a monitor is owned by a
  <em>thread</em>, and an <code>await</code> can resume on a different thread
  (<a href="#/m/t2-05-async-state-machine">t2-05</a>), which would try to release a lock it does not
  hold. The error is telling you the design is wrong, not that the syntax is.</p>

  <h3>The four objects you must not lock on</h3>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Do not lock</th><th>Why</th></tr></thead>
    <tbody>
      <tr><td><code>this</code></td><td>Anyone holding a reference to your object can lock it, block you, or deadlock you.</td></tr>
      <tr><td><code>typeof(X)</code></td><td>A <code>Type</code> is shared by the entire process, including code you did not write.</td></tr>
      <tr><td>a string</td><td>Literals are <strong>interned</strong> — the same text anywhere in the process is the same object.</td></tr>
      <tr><td>a value type</td><td>Boxing means every <code>lock</code> takes a different object. Does not compile: CS0185.</td></tr>
    </tbody>
  </table>
  </div>

  <p>The string case is the one people disbelieve, so it is worth verifying:</p>

  <pre data-lang="console" data-title="01-what-lock-is.cs"><code>    ReferenceEquals("ledger-lock", MakeSameLiteral()) : True</code></pre>

  <p>Two independently written classes that both lock on <code>"cache-lock"</code> share one monitor
  across the whole process. Nothing warns you, and the coupling is invisible in both files.</p>

  <p><strong>The rule:</strong> a private readonly field, of type <code>Lock</code> on .NET 9+ or
  <code>object</code> before it, used for one purpose and never exposed.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>The compiler picks between <code>EnterScope</code> and <code>Monitor</code> on the
    <strong>static type of the expression</strong>. These are not the same:</p>
    <pre data-lang="csharp" data-net="10" data-title="One of these is not what you think"><code>private readonly Lock _gate = new();          // EnterScope — the new behaviour
private readonly object _gate = new Lock();   // Monitor — silently the old one</code></pre>
    <pre data-lang="console" data-title="01-what-lock-is.cs"><code>  proof — lock(object holding a Lock) still uses Monitor : True</code></pre>
    <p>The compiler does warn — <strong>CS9216</strong>, "A value of type
    <code>System.Threading.Lock</code> converted to a different type will use likely unintended
    monitor-based locking". Treat it as an error.</p>
    <p><strong>Its limit:</strong> it fires on a conversion it can see. A field already declared as
    <code>object</code> and assigned a <code>Lock</code> somewhere else produces no warning at the
    lock site, because by then there is nothing left to convert.</p>
  </div>
</section>

<section id="granularity">
  <h2>Granularity: how much one lock should protect</h2>

  <p>Eight threads, 4,096 independent counters, identical work. Almost none of the contention is
  required by the data — it is manufactured by the locking scheme:</p>

  <pre data-lang="console" data-title="02-granularity.cs"><code>  scheme                       relative time   contentions   correct?
  one global lock                       1.00x         1,812   yes
  16 striped locks                      0.78x           346   yes
  256 striped locks                     0.71x           185   yes
  one lock per bucket                   0.67x            58   yes
  Interlocked, no lock                  0.15x             5   yes</code></pre>

  <p><strong>Read the contentions column, not the times.</strong> It is a count of how often a thread
  actually had to wait, so it is stable across runs in a way the milliseconds are not. It falls by
  more than thirty-fold from the first row to the fourth.</p>

  <p class="define"><span class="define__term">Lock striping</span> Mapping many keys onto a small
  fixed set of locks by hash, so that unrelated keys rarely collide. It removes most contention for a
  bounded, predictable amount of memory, and it is what <code>ConcurrentDictionary</code> used before
  .NET Core 3.0.</p>

  <pre data-lang="csharp" data-net="10" data-title="Striping, in three lines"><code>private readonly object[] _gates = CreateGates(16);

private void Increment(int key)
{
    // &amp; (length - 1) is a fast modulo because the stripe count is a power of two.
    lock (_gates[key &amp; (_gates.Length - 1)]) { _counts[key]++; }
}</code></pre>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Granularity</th><th>Contention</th><th>Memory</th><th>Risk</th></tr></thead>
    <tbody>
      <tr><td>One lock</td><td>Highest</td><td>One object</td><td>None — cannot deadlock against itself</td></tr>
      <tr><td>Striped</td><td>Low</td><td>Fixed, small</td><td>Two keys can share a lock</td></tr>
      <tr><td>Per key</td><td>Lowest</td><td>One per key</td><td>Unbounded; ordering bugs become possible</td></tr>
    </tbody>
  </table>
  </div>

  <p><strong>Finer is not automatically better.</strong> Every additional lock is another thing that
  can be acquired in the wrong order, which is the deadlock in the next section — and a design with
  one lock cannot deadlock against itself at all. The time column also shows diminishing returns:
  contention fell thirty-fold and time fell by a third, because past a point something other than the
  lock is the bottleneck.</p>

  <p>The order to try things in: <strong>one lock</strong> until a profiler shows contention;
  <strong>stripe it</strong>, which is usually enough; <strong>per-key locks</strong> only with a
  documented ordering rule; <strong>lock-free</strong> (<a href="#/m/t2-13-interlocked-and-lockfree">t2-13</a>)
  only with a benchmark proving it was worth it.</p>

  <h3>The change that costs nothing</h3>

  <pre data-lang="console" data-title="02-granularity.cs"><code>  computed inside the lock  :  8.42x the time of doing it outside</code></pre>

  <p>Identical total work. The only difference is whether a pure computation happens inside the
  critical section or before it:</p>

  <pre data-lang="csharp" data-net="10" data-title="The same work, two critical sections"><code>// Long critical section: everyone waits for the computation too.
lock (_gate) { _map[key] = Compute(key); }

// Short critical section: the computation is parallel, only the write serialises.
var value = Compute(key);
lock (_gate) { _map[key] = value; }</code></pre>

  <p>This is the highest-value lock optimisation available and it costs nothing but attention. The
  one condition: <code>Compute</code> must be <strong>pure</strong>. If it reads the shared state,
  moving it out of the lock creates a check-then-act race
  (<a href="#/m/t2-11-race-conditions">t2-11</a>) — you have traded a contention problem for a
  correctness one.</p>
</section>

<section id="deadlock">
  <h2>Deadlock: the failure fine-grained locking makes possible</h2>

  <p>Two accounts. Two transfers, in opposite directions, at the same moment. Each locks the source
  and then the destination:</p>

  <pre data-lang="console" data-title="The cycle"><code>Transfer(A -&gt; B):  lock(A) ......... wants B
Transfer(B -&gt; A):  lock(B) ......... wants A</code></pre>

  <p class="define"><span class="define__term">Deadlock</span> A cycle of threads each holding a
  resource another needs. It is not a slow operation and not a race — it is permanent, and no timeout
  on the work helps, because nothing is timing out. Both threads are waiting entirely correctly.</p>

  <pre data-lang="console" data-title="03-deadlock.cs"><code>  strategy                          outcome            ms
  naive: source then destination    DEADLOCKED      1,508
  ordered: lowest id first          completed         213  (A=1000, B=1000)
  TryEnter with a timeout           completed          92  (A=1000, B=1000)
  one lock for all accounts         completed           1  (A=1000, B=1000)</code></pre>

  <p>The <code>DEADLOCKED</code> row is a genuine, permanent deadlock; the milliseconds are the
  verification file's watchdog giving up so the program can report and continue.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>That file reproduces the deadlock <em>deterministically</em>, which took some care. Each thread
    signals once it holds its first lock and waits briefly for the other, forcing the overlap that in
    production happens by chance.</p>
    <p>The wait must time out. Under a correct ordering both threads want the <em>same</em> first
    lock, so the second never signals. An earlier version used a <code>Barrier</code>, which blocked
    forever in exactly that case and reported the <strong>ordered</strong> strategy as deadlocked —
    when the deadlock was entirely in the test harness. A harness that can wedge is not a harness.</p>
  </div>

  <h3>1. Ordering — the fix that scales</h3>

  <pre data-lang="csharp" data-net="10" data-title="A total order every caller agrees on"><code>var (first, second) = from.Id &lt; to.Id ? (from, to) : (to, from);
lock (first.Gate)
{
    lock (second.Gate)
    {
        from.Balance -= amount;
        to.Balance += amount;
    }
}</code></pre>

  <p>A cycle requires two threads acquiring in <em>opposite</em> orders. If every thread acquires in
  the same order, no cycle can form. <strong>That is a proof, not a reduction in probability</strong>,
  which is what makes ordering the right default.</p>

  <p>Two conditions. The ordering key must be <strong>stable and total</strong>: a database id works,
  an object's hash code does not — it can collide, and it can change between runs. And every path
  must go through the ordered helper; one method that acquires the same two locks directly reopens
  the cycle, which is an argument for making the gates private and exposing one method.</p>

  <h3>2. <code>TryEnter</code> — the fix that detects</h3>

  <pre data-lang="csharp" data-net="10" data-title="Detect, release, back off, retry"><code>var gotFirst = false;
var gotSecond = false;
try
{
    Monitor.TryEnter(from.Gate, TimeSpan.FromMilliseconds(50), ref gotFirst);
    if (gotFirst)
    {
        Monitor.TryEnter(to.Gate, TimeSpan.FromMilliseconds(50), ref gotSecond);
        if (gotSecond)
        {
            from.Balance -= amount;
            to.Balance += amount;
            return;
        }
    }
}
finally
{
    if (gotSecond) Monitor.Exit(to.Gate);
    if (gotFirst) Monitor.Exit(from.Gate);
}

Thread.Sleep(rng.Next(1, 20));      // randomised, or two threads retry in step
</code></pre>

  <p>This does not prevent the cycle. It notices being stuck, releases what it holds so the other
  thread can proceed, and tries again. Use it when a total order genuinely is not available — locks
  acquired across components you do not control.</p>

  <p>Its costs are real. The work must be safely repeatable. Two threads can <strong>livelock</strong>
  by retrying in lockstep unless the backoff is randomised. And a badly chosen timeout converts a
  deadlock into an intermittent slow path, which is harder to diagnose than the deadlock was.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The verification run needed <strong>zero</strong> retries — the first <code>TryEnter</code>
    succeeded and the backoff path never executed. That is the normal case and worth stating plainly
    rather than hiding: the retry loop is insurance. It costs nothing when no cycle forms, and it is
    the only thing between you and a permanent stall when one does.</p>
  </div>

  <h3>3. One lock — the fix that always works</h3>

  <p>A single lock for all accounts cannot deadlock against itself. It is the right answer more often
  than its reputation suggests: correctness is immediate, and the granularity section showed that the
  entire cost of coarse locking is contention — which you can measure before deciding it matters.</p>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>The netting service from the opening, and the one-line fix:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the shipped version"><code>
/// &lt;summary&gt;
/// THE SHIPPED VERSION. The lock is correct — the totals are never wrong — and
/// it is held across a 20 ms remote call, so every caller is serialised behind
/// the network rather than behind the arithmetic.
/// &lt;/summary&gt;
public sealed class NettingServiceV1
{
    private readonly Dictionary&lt;string, decimal&gt; _totals = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public void Add(Position p)
    {
        lock (_gate)
        {
            var rate = RatesApi.GetRate(p.Counterparty);      // I/O inside the lock
            _totals.TryGetValue(p.Counterparty, out var running);
            _totals[p.Counterparty] = running + p.Amount * rate;
        }
    }

    public decimal Total =&gt; _totals.Values.Sum();
}

/// &lt;summary&gt;</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right: identical locking, shorter critical section"><code>/// call moved OUT of the critical section. The lock now protects only the
/// dictionary mutation, which takes nanoseconds.
/// &lt;/summary&gt;
public sealed class NettingServiceV2
{
    private readonly Dictionary&lt;string, decimal&gt; _totals = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public void Add(Position p)
    {
        var rate = RatesApi.GetRate(p.Counterparty);          // outside
        lock (_gate)
        {
            _totals.TryGetValue(p.Counterparty, out var running);
            _totals[p.Counterparty] = running + p.Amount * rate;
        }
    }

    public decimal Total =&gt; _totals.Values.Sum();
}</code></pre>

  <pre data-lang="console" data-title="04-production.cs"><code>  version                  relative time   contentions   remote calls
  I/O inside the lock                8.0x            95            200
  I/O outside the lock               1.0x             4            200</code></pre>

  <p><strong>Same work, same number of remote calls, same answer.</strong> The only difference is what
  the lock spans — and it is eight times slower and produces twenty-four times the contention.</p>

  <p>With the call inside, the critical section is 20 ms long, so eight threads take turns and total
  time is the sum of everything. <strong>The service has an effective concurrency of one</strong>
  regardless of threads, cores or instances.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>This is why it presented as a mystery for two days. The processor is idle because everyone is
    waiting. The rates service reports normal latency because each individual call really is fast. No
    exception is ever thrown and no test fails, because the answers are all correct.</p>
    <p><strong>The only visible symptom is that throughput does not improve when you add
    capacity</strong> — which reads as a scaling problem rather than a code problem, and sends people
    to the infrastructure team. A second instance doubles the number of independent locks and does
    help; a second thread on the same instance does nothing at all. That asymmetry is the clue, and
    it is a strange one to notice unless you already suspect a lock.</p>
  </div>

  <h3>The signature that identifies it</h3>

  <pre data-lang="console" data-title="Telling the low-CPU stalls apart"><code>lock held too long   contention HIGH and rising, CPU low,  threads steady, queue rising
deadlock             contention FLAT,            CPU zero, threads steady, queue rising
sync-over-async      contention low,             CPU low,  THREADS RISING, queue rising
parallel saturation  contention low,             CPU 100%, threads steady, queue rising</code></pre>

  <p><strong><code>monitor-lock-contention-count</code> is the counter that separates the first two,
  and it is the one nobody watches.</strong> A deadlock produces a <em>flat</em> contention count,
  because the stuck threads have stopped competing for anything — they are parked, not fighting. A
  lock held too long produces a rising one, because threads keep arriving and keep waiting.</p>

  <pre data-lang="console" data-title="Confirming it in a dump"><code>dotnet-dump collect --process-id 4812
dotnet-dump analyze core_20260831.dmp
&gt; clrstack -all      # many threads in Monitor.Enter, sharing a frame
&gt; syncblk            # which thread OWNS each contended monitor</code></pre>

  <p><code>syncblk</code> is what closes it. It prints, per contended monitor, the owning thread and
  the object. <strong>A deadlock shows a cycle</strong> — two owners waiting on each other.
  <strong>A long critical section shows a queue</strong> — one owner, many waiters. Those two
  diagnoses have nothing to do with each other, and the distinction tells you whether to look for an
  ordering bug or for a slow operation inside a lock.</p>

  <h3>The second bug in the same class</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the write is locked, the read is not"><code>public void Add(Position p)
{
    lock (_gate) { _totals[p.Counterparty] = value; }    // locked
}

public int Count =&gt; _totals.Count;                     // NOT locked</code></pre>

  <pre data-lang="console" data-title="04-production.cs"><code>  enumerating without the lock while writers hold it:
    20 of 40 trials threw InvalidOperationException</code></pre>

  <p>Reading looks harmless — the reader modifies nothing. But a lock is a <strong>protocol</strong>,
  and a protocol works only if every participant follows it. A reader that skips the lock can observe
  a <code>Dictionary</code> midway through a resize: a torn read, a missing entry, or the exception
  above in half of all trials.</p>

  <p><strong>The lock protects the data, not the method.</strong> Every path that touches the data
  takes it, reads included. If that feels expensive, the answer is a concurrent collection
  (<a href="#/m/t2-15-concurrent-collections">t2-15</a>) or an immutable snapshot — not skipping the
  lock on the paths that look read-only.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. I/O inside the critical section</h3>

  <p>Measured at 8.0× slower with twenty-four times the contention, for identical work and identical
  results. Anything with unbounded duration — a network call, a file write, a database query, a call
  into code you do not control — belongs outside.</p>

  <h3>2. Locking the writes and not the reads</h3>

  <p>Measured: 20 of 40 trials threw. A partial protocol is no protocol.</p>

  <h3>3. Locking on something public</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: four ways to share a monitor by accident"><code>lock (this) { }                     // any caller holding your object can lock it
lock (typeof(LedgerService)) { }    // process-wide, shared with strangers
lock ("ledger-gate") { }            // interned: the same literal anywhere is this monitor
lock (_publicList) { }              // anyone with the list can lock it

// Right.
private readonly Lock _gate = new();      // .NET 9+
private readonly object _gate = new();    // earlier</code></pre>

  <h3>4. Acquiring two locks in an order that varies</h3>

  <p>The deadlock above. Any code path taking two locks needs a total order, and that order must be
  the same everywhere.</p>

  <h3>5. Blocking inside a lock because you cannot <code>await</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the compiler error was the good outcome"><code>// CS1996 refuses this one.
lock (_gate) { await LoadAsync(); }

// So this gets written instead, combining a long critical section with
// thread-pool starvation (t2-07).
lock (_gate) { var data = LoadAsync().Result; }

// Right: an async-aware primitive (t2-14).
await _semaphore.WaitAsync(ct);
try     { var data = await LoadAsync(ct); }
finally { _semaphore.Release(); }</code></pre>

  <h3>6. Assuming a lock makes the whole object thread-safe</h3>

  <p>A lock makes one <em>region</em> exclusive. Two individually locked methods called in sequence
  are still two operations with a gap between them — the check-then-act shape from
  <a href="#/m/t2-11-race-conditions">t2-11</a>. If callers need both steps to be atomic, the lock has
  to span both, which usually means exposing one method rather than two.</p>

  <h3>7. Declaring a <code>Lock</code> as <code>object</code></h3>

  <p>Silently reverts to <code>Monitor</code>. CS9216 catches the visible conversions; a field typed
  <code>object</code> from the start produces no warning at all.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> throughput does not improve when you add threads, cores or
    instances, and the processor is idle.</p>
    <p><strong>Why:</strong> a critical section long enough that the service is effectively serial.</p>
    <p><strong>Tool:</strong></p>
    <pre data-lang="console" data-title="The contention signature"><code>dotnet-counters monitor --process-id 4812 System.Runtime

    monitor-lock-contention-count   HIGH and climbing
    cpu-usage                       low
    threadpool-queue-length         climbing</code></pre>
    <p><strong>Reading it:</strong> rising contention with idle CPU means threads are waiting on each
    other rather than on work. Compare against a period of known-good load — the absolute number means
    little, the trend against request rate means everything.</p>
    <p><strong>Fix:</strong> shorten the critical section first. Move pure computation and all I/O
    outside it. Only then consider striping.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> requests stop completing entirely. CPU is zero, nothing is logged,
    nothing throws.</p>
    <p><strong>Why:</strong> a deadlock. The distinguishing counter reading is that contention is
    <em>flat</em> rather than rising — the stuck threads have stopped competing.</p>
    <p><strong>Tool:</strong></p>
    <pre data-lang="console" data-title="Finding the cycle"><code>dotnet-dump collect --process-id 4812
dotnet-dump analyze core_20260831.dmp
&gt; clrstack -all
&gt; syncblk</code></pre>
    <p><strong>Reading it:</strong> <code>syncblk</code> lists each contended monitor with its owning
    thread. Two entries whose owners are each other's waiters is a cycle, and there is no other
    explanation for that pattern. <code>clrstack</code> then tells you which two methods, which
    usually identifies the ordering bug immediately.</p>
    <p><strong>Fix:</strong> impose a total order on the two locks, or collapse them into one.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> intermittent <code>InvalidOperationException</code> from inside a
    collection, on a thread that was only reading.</p>
    <p><strong>Why:</strong> a read path that does not take the lock, observing a collection
    mid-mutation. Measured at 20 of 40 trials, so it will look intermittent rather than broken.</p>
    <p><strong>Tool:</strong> grep, not a profiler. Find every reference to the protected field and
    check each one takes the gate. The read paths are where it fails, because they look harmless:</p>
    <pre data-lang="console" data-title="Auditing a lock protocol"><code>grep -n "_totals" src/**/*.cs      # every touch of the guarded state
# then confirm each site is inside lock (_gate)</code></pre>
    <p><strong>Fix:</strong> lock the reads too, or move to a concurrent collection
    (<a href="#/m/t2-15-concurrent-collections">t2-15</a>). Making the field <code>private</code> and
    exposing only methods keeps the audit tractable.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> you want to know whether a lock is worth optimising before you
    change anything.</p>
    <p><strong>Tool:</strong> <code>Monitor.LockContentionCount</code> around the suspect region. It
    is a process-wide counter, but the delta across a workload is meaningful and it needs no
    profiler:</p>
    <pre data-lang="csharp" data-net="10" data-title="Measuring contention directly"><code>var before = Monitor.LockContentionCount;
RunWorkload();
Console.WriteLine($"contentions: {Monitor.LockContentionCount - before}");</code></pre>
    <p><strong>Reading it:</strong> a count near zero means the lock is not your problem, whatever it
    looks like. A count in the thousands for a workload of thousands of operations means threads are
    waiting most of the time. This is a count rather than a duration, which makes it far more stable
    between runs than any timing.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A correct lock can destroy throughput without ever producing a wrong answer.</strong>
    The netting service was 8.0× slower than it needed to be, with every total correct and every test
    passing. There is no test for "this lock is held too long", and the symptom — capacity not helping
    — points at infrastructure rather than at code. The fix was moving one line.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Deadlock is the failure that fine-grained locking buys you.</strong> One lock cannot
    deadlock against itself; two can, and the probability rises with every lock you add. The
    granularity table shows contention falling thirty-fold while time fell by a third — so the second
    and third refinements bought little and each one added a way to construct a cycle. That trade is
    usually made in the wrong direction, because finer locking sounds more sophisticated and its cost
    only appears under production interleavings.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The contention counter turns a two-day mystery into a five-minute diagnosis.</strong>
    Four different failures in this track present as "slow, with low CPU": a long critical section, a
    deadlock, sync-over-async, and parallel saturation. They are distinguished by three numbers —
    contention, thread count and CPU — that are all available from one
    <code>dotnet-counters</code> command against a live process, without a dump and without a restart.
    Knowing which of the four you have is the whole diagnosis; each has a different fix, and applying
    the wrong one makes things worse.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Locks are slow."</strong> An uncontended lock is nanoseconds
    (<a href="#/m/t2-11-race-conditions">t2-11</a> measured 27.78 ns against 2.83 for a bare
    increment). What is slow is a long critical section — measured at 8.0× here, from one remote call
    in the wrong place. The lock is rarely the cost; what you do while holding it is.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Finer-grained locking is better."</strong> Contention fell thirty-fold from one lock
    to per-key locks while time fell by a third — and every added lock is another way to build a
    deadlock cycle. Start with one, measure, and stripe only when the contention counter says so.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Reads do not need the lock."</strong> Measured: 20 of 40 trials threw
    <code>InvalidOperationException</code> enumerating a <code>Dictionary</code> while locked writers
    modified it. A protocol that one participant ignores is not a protocol.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>lock(this)</code> is fine for a private class."</strong> Anything holding a
    reference can lock your object, including framework code and libraries. It costs nothing to use a
    dedicated private gate, and it removes an entire class of coupling you cannot see from inside the
    class.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I switched to <code>System.Threading.Lock</code>, so I have the new behaviour."</strong>
    Only if the <em>field</em> is declared as <code>Lock</code>. Typed as <code>object</code> it
    silently uses <code>Monitor</code> — verified. CS9216 catches the visible conversions and nothing
    catches a field that was always <code>object</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A deadlock will show up in testing."</strong> It requires a specific interleaving. The
    verification file had to force it with an explicit handshake to make it happen every run; left to
    chance it appears under production load and not before. Ordering is the fix precisely because it
    makes the cycle impossible rather than unlikely.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Reentrancy is a safety feature."</strong> It prevents one deadlock and permits a worse
    bug: a nested call observing state midway through the outer call's mutation, with no error. It is
    a convenience, and it is the reason a recursive lock can hide a broken invariant that
    <code>SemaphoreSlim</code> would have surfaced immediately as a hang.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <p>Every answer below is produced by running <code>05-exercises.cs</code>, included in full at the
  end of the module.</p>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Which of these lock targets are safe, and why?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>lock (this) { }                              // (a)
lock (typeof(Ledger)) { }                    // (b)
lock ("ledger-gate") { }                     // (c)
lock (_count) { }                            // (d)  _count is an int
lock (_gate) { }                             // (e)  private readonly object _gate = new()</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  (c) lock ("ledger-gate")  — same literal elsewhere is the SAME object: True</code></pre>
        <p><strong>Only (e).</strong></p>
        <p><strong>(a)</strong> lets anything holding a reference to your object lock it — framework
        code, a library, a caller. You cannot audit who those are.</p>
        <p><strong>(b)</strong> is worse: a <code>Type</code> is shared by the whole process, so two
        unrelated assemblies locking on the same type share one monitor.</p>
        <p><strong>(c)</strong> is the one people disbelieve, and it is verified above. String literals
        are <strong>interned</strong>, so the same text anywhere in the process is the same object. Two
        independently written classes locking on <code>"cache-lock"</code> are locking on each
        other.</p>
        <p><strong>(d)</strong> does not compile — CS0185, lock on a value type. Boxing would make
        every <code>lock</code> take a different object and exclude nothing, so the language rejects it
        outright. That is a rare case of the compiler preventing a concurrency mistake rather than
        leaving it to review.</p>
        <p><strong>On .NET 9+ prefer <code>private readonly Lock _gate = new();</code></strong> It is
        faster, cannot be locked by anyone else, and exposes <code>TryEnter</code> and
        <code>IsHeldByCurrentThread</code>. Declare the <em>field</em> as <code>Lock</code> — typing it
        as <code>object</code> silently reverts to <code>Monitor</code>.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>What is wrong with this, and what does fixing it cost?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>lock (_gate) { var r = Compute(x); _map[x] = r; }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  compute inside the lock  :  6.01x the time of outside</code></pre>
        <p><strong><code>Compute</code> reads no shared state, so it does not need protecting</strong> —
        and while it runs, every other thread waits.</p>
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>var r = Compute(x);
lock (_gate) { _map[x] = r; }</code></pre>
        <p>The critical section is now one dictionary write. Fixing it costs one line and no risk,
        which makes this the highest-value lock change available.</p>
        <p><strong>The condition that makes it valid: <code>Compute</code> must be pure.</strong> If it
        reads the shared state, moving it outside creates a check-then-act race
        (<a href="#/m/t2-11-race-conditions">t2-11</a>) — you would have traded a contention problem
        for a correctness problem, which is a much worse trade.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Does this deadlock? Does the answer change if <code>_g</code> is a
    <code>SemaphoreSlim(1,1)</code>?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>void A() { lock (_g) { B(); } }
void B() { lock (_g) { _total += 1; } }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  same thread, same monitor, nested : entered twice, no deadlock
    same pattern with SemaphoreSlim : DEADLOCKED on the second Wait (timed out at 200 ms)</code></pre>
        <p><strong>No, and yes.</strong> A monitor is <strong>reentrant</strong>: the owning thread may
        enter again, and the runtime keeps a count and releases on the matching exit.
        <code>SemaphoreSlim</code> is not — it counts permits, not owners, so the second
        <code>Wait</code> waits for a permit the same thread is holding.</p>
        <p><strong>Reentrancy is a convenience that hides a design problem.</strong> <code>B</code> now
        runs while <code>A</code> is midway through mutating the state the lock protects, so
        <code>B</code> observes a broken invariant. Nothing reports this: it compiles, it runs, and it
        produces a torn view.</p>
        <p>The semaphore's behaviour is arguably more honest — it fails loudly and immediately rather
        than silently producing a wrong answer. Neither is better in general, and the failure you get
        depends on a choice you probably made for reasons unrelated to reentrancy, which is why it is
        worth knowing which primitive you are holding.</p>
        <p>The real fix in both cases is to restructure so the nested call does not need the lock:
        extract the logic into a private method that assumes the lock is already held, and call that
        from both entry points.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Order these by contention, then say which you would ship.</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>lock (_globalGate) { _counts[k]++; }                        // (a)
lock (_gates[k &amp; 15]) { _counts[k]++; }                     // (b)  16 stripes
lock (_gates[k]) { _counts[k]++; }                          // (c)  one per counter</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  scheme                contentions   relative time
  one global lock            1,516            1.00x
  16 stripes                   464            0.74x
  one lock per counter          38            0.58x</code></pre>
        <p><strong>Contention falls forty-fold; time falls by 42%.</strong> That gap is the lesson.
        Removing contention helps only until something else is the bottleneck — here the atomic
        operation itself and memory traffic.</p>
        <p><strong>Ship (b).</strong> It captures most of the available benefit for a fixed, small
        amount of memory, and it is what <code>ConcurrentDictionary</code> did before .NET Core 3.0.</p>
        <p><strong>(c) is worse than it looks.</strong> One lock object per key is unbounded memory —
        fine at 4,096 counters, not fine at ten million. And every additional lock is another thing
        that can be acquired in the wrong order, which is how you get the deadlock in this module.</p>
        <p><strong>(a) is where you should start.</strong> It is correct by inspection and cannot deadlock
        against itself. Move off it when the contention counter says to, not before — most locks in
        most services are uncontended, and optimising those is pure risk for no gain.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Fix this so it cannot deadlock, and explain why your fix is a guarantee rather than an
    improvement.</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 5"><code>void Transfer(Account a, Account b, decimal amount)
{
    lock (a.Gate)
    {
        lock (b.Gate) { a.Balance -= amount; b.Balance += amount; }
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    naive           : DEADLOCKED
    ordered by id   : completed (A=1000, B=1000)</code></pre>
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>void Transfer(Account a, Account b, decimal amount)
{
    var (first, second) = a.Id &lt; b.Id ? (a, b) : (b, a);
    lock (first.Gate)
    {
        lock (second.Gate) { a.Balance -= amount; b.Balance += amount; }
    }
}</code></pre>
        <p><strong>Why it is a guarantee:</strong> a deadlock cycle requires two threads acquiring the
        same locks in <em>opposite</em> orders. If every thread acquires in the same order, there is no
        pair of threads that can each hold what the other wants. The cycle is not unlikely — it is
        impossible.</p>
        <p><strong>Two conditions the fix depends on.</strong> The ordering key must be <em>stable and
        total</em>: a database id qualifies; an object's hash code does not, because it can collide and
        can differ between runs. And every path that takes both locks must go through this helper — one
        method that acquires them directly reopens the cycle, which argues for private gates and a
        single public entry point.</p>
        <p><strong>The alternatives, and when they win.</strong> <code>Monitor.TryEnter</code> with a
        timeout detects rather than prevents: use it when no total order exists, accept that the work
        must be repeatable, and randomise the backoff or two threads will livelock retrying in step.
        <strong>One lock for all accounts</strong> is correct by inspection and completed in 1 ms here —
        genuinely the right answer unless you have measured contention on it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Four services are slow. All four show low CPU. Name each fault from the counters alone, and say
    what you would do next for each.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  contention   CPU    threads   queue    diagnosis
  HIGH+rising  low    steady    rising   lock held too long
  FLAT         ~zero  steady    rising   deadlock: nobody is competing
  low          low    RISING    rising   sync-over-async (t2-07)
  low          100%   steady    rising   parallel saturation (t2-10)</code></pre>
        <p><strong>The contention counter separates the first two</strong>, and it is the one nobody
        watches. A deadlock produces a <em>flat</em> count because the stuck threads have stopped
        competing for anything — they are parked. A long critical section produces a rising one,
        because threads keep arriving and keep waiting.</p>
        <p><strong>Thread count separates sync-over-async:</strong> the pool keeps injecting
        replacements for threads it believes are merely slow
        (<a href="#/m/t2-07-sync-over-async-deadlocks">t2-07</a>).</p>
        <p><strong>CPU separates parallel saturation</strong>
        (<a href="#/m/t2-10-parallelism">t2-10</a>) from everything else immediately.</p>
        <p><strong>What to do next, per fault.</strong> Lock held too long: dump and
        <code>syncblk</code>, expect a <em>queue</em> — one owner, many waiters — then shorten the
        critical section. Deadlock: dump and <code>syncblk</code>, expect a <em>cycle</em>, then impose
        a lock order. Sync-over-async: <code>clrstack -all</code> and look for
        <code>GetResult</code>; <code>SetMinThreads</code> is the emergency mitigation. Parallel
        saturation: cap <code>MaxDegreeOfParallelism</code> or move the work out of the request path.</p>
        <p><strong>Why this matters more than it looks:</strong> all four present identically on a
        latency dashboard, and each fix makes the other three worse. Raising
        <code>SetMinThreads</code> on a saturated machine adds context switching; capping parallelism
        on a deadlocked one does nothing at all.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 02-granularity.cs -c Release</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-granularity.cs"><code>// 02-granularity.cs — how much a lock protects decides how much it costs. One
// global lock, striped locks, and per-key locks over identical work.
//
// A NOTE ON WHAT IS QUOTED. Absolute milliseconds here vary run to run by 20% or
// more and are not worth memorising. Every claim in this file is stated as a
// RATIO against the single-lock baseline, plus Monitor.LockContentionCount,
// which counts the times a thread actually had to wait rather than how long it
// took. That count is the stable number.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-granularity.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int Threads = 8;
    const int OpsPerThread = 200_000;
    const int Buckets = 4_096;

    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== the workload ===");
        Console.WriteLine();
        Console.WriteLine($"  {Threads} threads x {OpsPerThread:N0} operations against {Buckets:N0}");
        Console.WriteLine("  independent counters. No two threads need the same counter most of");
        Console.WriteLine("  the time, so almost all of the contention is manufactured by the");
        Console.WriteLine("  locking scheme rather than required by the data.");
        Console.WriteLine();
        Console.WriteLine("  scheme                       relative time   contentions   correct?");

        var baseline = Run("one global lock", new GlobalLock());
        Report("one global lock", baseline, baseline);
        Report("16 striped locks", Run("16 striped locks", new StripedLock(16)), baseline);
        Report("256 striped locks", Run("256 striped locks", new StripedLock(256)), baseline);
        Report("one lock per bucket", Run("one lock per bucket", new PerBucketLock(Buckets)), baseline);
        Report("Interlocked, no lock", Run("Interlocked, no lock", new InterlockedCounters()), baseline);

        Console.WriteLine();
        Console.WriteLine("=== reading this ===");
        Console.WriteLine();
        Console.WriteLine("  CONTENTIONS is the column that explains the others. It is");
        Console.WriteLine("  Monitor.LockContentionCount: the number of times a thread arrived at");
        Console.WriteLine("  a held monitor and had to wait. It is a count, not a duration, so it");
        Console.WriteLine("  is stable across runs in a way the timings are not.");
        Console.WriteLine();
        Console.WriteLine("  ONE GLOBAL LOCK serialises everything. Eight threads take turns, so");
        Console.WriteLine("  the parallelism you paid for is spent waiting. This is the shape that");
        Console.WriteLine("  makes people conclude that locks are slow — the lock is not slow, the");
        Console.WriteLine("  design is serial.");
        Console.WriteLine();
        Console.WriteLine("  STRIPING maps many keys onto a small fixed set of locks by hash. It");
        Console.WriteLine("  removes most contention for a bounded, predictable amount of memory,");
        Console.WriteLine("  and it is what ConcurrentDictionary did before .NET Core 3.0.");
        Console.WriteLine();
        Console.WriteLine("  ONE LOCK PER BUCKET removes almost all remaining contention and costs");
        Console.WriteLine("  one object per bucket. At 4,096 buckets that is cheap; at ten million");
        Console.WriteLine("  keys it is not, and striping is the answer.");
        Console.WriteLine();
        Console.WriteLine("  INTERLOCKED needs no lock object at all for a counter. It is the");
        Console.WriteLine("  fastest row and the least general: it works because incrementing an");
        Console.WriteLine("  int is one of the few operations the hardware makes atomic. Anything");
        Console.WriteLine("  needing two fields updated together goes back to a lock (t2-13).");

        Console.WriteLine();
        Console.WriteLine("=== the shape of the trade-off ===");
        Console.WriteLine();
        Console.WriteLine("  granularity      contention   memory        risk");
        Console.WriteLine("  one lock         highest      one object    none - trivially correct");
        Console.WriteLine("  striped          low          fixed, small  two keys can share a lock");
        Console.WriteLine("  per key          lowest       one per key   unbounded; ordering bugs");
        Console.WriteLine();
        Console.WriteLine("  Finer is not automatically better. Every extra lock is another thing");
        Console.WriteLine("  that can be taken in the wrong order, which is the deadlock in");
        Console.WriteLine("  03-deadlock.cs — and a design with ONE lock cannot deadlock against");
        Console.WriteLine("  itself at all.");
        Console.WriteLine();
        Console.WriteLine("  The order to try things in:");
        Console.WriteLine("    1. one lock, until a profiler shows contention");
        Console.WriteLine("    2. stripe it, which is usually enough");
        Console.WriteLine("    3. per-key locks only with a documented ordering rule");
        Console.WriteLine("    4. lock-free only with a benchmark proving it was worth it");

        Console.WriteLine();
        Console.WriteLine("=== holding a lock for longer than you need ===");
        Console.WriteLine();
        Console.WriteLine("  The same total work, with an expensive pure computation done inside");
        Console.WriteLine("  the lock and then outside it:");
        Console.WriteLine();
        var inside = TimeScope(insideLock: true);
        var outside = TimeScope(insideLock: false);
        Console.WriteLine($"  computed inside the lock  : {inside / outside,5:N2}x the time of doing it outside");
        Console.WriteLine();
        Console.WriteLine("  Nothing about the computation needs protecting — it reads no shared");
        Console.WriteLine("  state. Moving it out shortens the critical section, and the critical");
        Console.WriteLine("  section is the only part that serialises.");
        Console.WriteLine();
        Console.WriteLine("  This is the highest-value lock optimisation and it costs nothing:");
        Console.WriteLine("  compute into locals, then take the lock only to publish the result.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    interface ICounters
    {
        void Increment(int key);
        long Total { get; }
    }

    sealed class GlobalLock : ICounters
    {
        private readonly object _gate = new();
        private readonly long[] _counts = new long[Buckets];
        public void Increment(int key) { lock (_gate) { _counts[key]++; } }
        public long Total { get { long t = 0; foreach (var c in _counts) t += c; return t; } }
    }

    sealed class StripedLock : ICounters
    {
        private readonly object[] _gates;
        private readonly long[] _counts = new long[Buckets];
        public StripedLock(int stripes)
        {
            _gates = new object[stripes];
            for (var i = 0; i &lt; stripes; i++) _gates[i] = new object();
        }
        public void Increment(int key)
        {
            // &amp; (length - 1) works because the stripe count is a power of two.
            lock (_gates[key &amp; (_gates.Length - 1)]) { _counts[key]++; }
        }
        public long Total { get { long t = 0; foreach (var c in _counts) t += c; return t; } }
    }

    sealed class PerBucketLock : ICounters
    {
        private readonly object[] _gates;
        private readonly long[] _counts;
        public PerBucketLock(int buckets)
        {
            _gates = new object[buckets];
            _counts = new long[buckets];
            for (var i = 0; i &lt; buckets; i++) _gates[i] = new object();
        }
        public void Increment(int key) { lock (_gates[key]) { _counts[key]++; } }
        public long Total { get { long t = 0; foreach (var c in _counts) t += c; return t; } }
    }

    sealed class InterlockedCounters : ICounters
    {
        private readonly long[] _counts = new long[Buckets];
        public void Increment(int key) =&gt; Interlocked.Increment(ref _counts[key]);
        public long Total { get { long t = 0; foreach (var c in _counts) t += c; return t; } }
    }

    readonly record struct Result(double Ms, long Contentions, bool Correct);

    static Result Run(string _, ICounters counters)
    {
        Thread.Sleep(120);
        var beforeContentions = Monitor.LockContentionCount;
        var sw = Stopwatch.StartNew();

        var threads = new Thread[Threads];
        var ready = new ManualResetEventSlim(false);
        for (var t = 0; t &lt; Threads; t++)
        {
            var seed = t * 7919;
            threads[t] = new Thread(() =&gt;
            {
                ready.Wait();
                var k = seed;
                for (var i = 0; i &lt; OpsPerThread; i++)
                {
                    k = (k * 1103515245 + 12345) &amp; int.MaxValue;   // cheap spread
                    counters.Increment(k % Buckets);
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();

        var expected = (long)Threads * OpsPerThread;
        return new Result(sw.Elapsed.TotalMilliseconds,
                          Monitor.LockContentionCount - beforeContentions,
                          counters.Total == expected);
    }

    static void Report(string label, Result r, Result baseline) =&gt;
        Console.WriteLine($"  {label,-28} {r.Ms / baseline.Ms,13:N2}x   {r.Contentions,11:N0}   " +
                          $"{(r.Correct ? "yes" : "NO")}");

    static double TimeScope(bool insideLock)
    {
        var gate = new object();
        long total = 0;
        var threads = new Thread[Threads];
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();

        for (var t = 0; t &lt; Threads; t++)
        {
            threads[t] = new Thread(() =&gt;
            {
                ready.Wait();
                for (var i = 0; i &lt; 4_000; i++)
                {
                    if (insideLock)
                    {
                        lock (gate) { total += Expensive(i); }
                    }
                    else
                    {
                        var v = Expensive(i);            // no shared state read
                        lock (gate) { total += v; }
                    }
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();
        _sink += total;
        return sw.Elapsed.TotalMilliseconds;
    }

    static long Expensive(int seed)
    {
        var h = seed;
        for (var i = 0; i &lt; 400; i++) h = HashCode.Combine(h, i);
        return h &amp; 0xFF;
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-deadlock.cs"><code>// 03-deadlock.cs — a lock-ordering deadlock, reproduced DETERMINISTICALLY rather
// than hoped for, and the three ways out. Each thread signals once it holds its
// FIRST lock and waits briefly for the other, which forces the interleaving that
// in production happens by chance.
//
// The wait must time out. Under a correct ordering both threads want the same
// first lock, so the second never signals. An earlier version of this file used
// a Barrier, which blocked forever in exactly that case and reported the ORDERED
// strategy as deadlocked when the deadlock was entirely in the harness.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-deadlock.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int WatchdogMs = 1500;

    static void Main()
    {
        Console.WriteLine("=== the classic shape ===");
        Console.WriteLine();
        Console.WriteLine("  Two accounts. Two transfers, in opposite directions, at the same");
        Console.WriteLine("  time. Each locks the source, then the destination.");
        Console.WriteLine();
        Console.WriteLine("      Transfer(A -&gt; B):  lock(A) ... lock(B)");
        Console.WriteLine("      Transfer(B -&gt; A):  lock(B) ... lock(A)");
        Console.WriteLine();
        Console.WriteLine("  Thread 1 holds A and wants B. Thread 2 holds B and wants A. Neither");
        Console.WriteLine("  will release what it has until it gets what it wants. This is a");
        Console.WriteLine("  CYCLE, and it is permanent: no timeout inside the transfer helps,");
        Console.WriteLine("  because nothing is timing out — both threads are waiting correctly.");
        Console.WriteLine();
        Console.WriteLine("  strategy                          outcome            ms");

        Run("naive: source then destination", Naive);
        Run("ordered: lowest id first", Ordered);
        Run("TryEnter with a timeout", TryWithTimeout);
        Run("one lock for all accounts", SingleLock);

        Console.WriteLine();
        Console.WriteLine("  Every DEADLOCKED row above is a real, permanent deadlock. The");
        Console.WriteLine("  milliseconds shown are this file's watchdog giving up so the program");
        Console.WriteLine("  can report and continue; the threads themselves never recover and");
        Console.WriteLine("  are abandoned as background threads.");

        Console.WriteLine();
        Console.WriteLine("=== 1. ORDERING: the fix that scales ===");
        Console.WriteLine();
        Console.WriteLine("  Take locks in a total order that every caller agrees on. Here the");
        Console.WriteLine("  account id supplies it:");
        Console.WriteLine();
        Console.WriteLine("      var (first, second) = from.Id &lt; to.Id ? (from, to) : (to, from);");
        Console.WriteLine("      lock (first.Gate) lock (second.Gate) { ... }");
        Console.WriteLine();
        Console.WriteLine("  A cycle needs two threads acquiring in opposite orders. If every");
        Console.WriteLine("  thread acquires in the SAME order, no cycle can form — this is not a");
        Console.WriteLine("  reduction in probability, it is a proof.");
        Console.WriteLine();
        Console.WriteLine("  The ordering key must be stable and total. An object's hash code is");
        Console.WriteLine("  neither: two accounts can collide, and the order can change between");
        Console.WriteLine("  runs. A database id, a name, or an explicit sequence number works.");
        Console.WriteLine();
        Console.WriteLine("  What breaks it: any code path that acquires the same two locks");
        Console.WriteLine("  WITHOUT going through the ordered helper. The rule protects you only");
        Console.WriteLine("  if it is the sole way in, which is an argument for putting it behind");
        Console.WriteLine("  one method and making the gates private.");

        Console.WriteLine();
        Console.WriteLine("=== 2. TRYENTER: the fix that detects ===");
        Console.WriteLine();
        Console.WriteLine("      if (!Monitor.TryEnter(second.Gate, TimeSpan.FromMilliseconds(50)))");
        Console.WriteLine("          { release everything; back off; retry; }");
        Console.WriteLine();
        Console.WriteLine("  This does not PREVENT the cycle. It notices being stuck, releases");
        Console.WriteLine("  what it holds so the other thread can proceed, and tries again.");
        Console.WriteLine();
        Console.WriteLine($"  retries needed on the run above : {Volatile.Read(ref _retries)}");
        Console.WriteLine();
        Console.WriteLine("  Zero, on this run: the first TryEnter succeeded and the backoff");
        Console.WriteLine("  path never executed. That is worth stating plainly rather than");
        Console.WriteLine("  hiding, because it is the normal case. The retry loop is insurance —");
        Console.WriteLine("  it costs nothing when no cycle forms, and it is the only thing");
        Console.WriteLine("  standing between you and a permanent stall when one does.");
        Console.WriteLine();
        Console.WriteLine("  Use it when a total order genuinely is not available — locks acquired");
        Console.WriteLine("  across components you do not control, for instance. Its costs are");
        Console.WriteLine("  real: the work must be safely repeatable, two threads can livelock");
        Console.WriteLine("  by retrying in step unless the backoff is randomised, and a wrong");
        Console.WriteLine("  timeout turns a deadlock into an intermittent slow path that is");
        Console.WriteLine("  harder to diagnose than the deadlock was.");

        Console.WriteLine();
        Console.WriteLine("=== 3. ONE LOCK: the fix that always works ===");
        Console.WriteLine();
        Console.WriteLine("  A single lock for all accounts cannot deadlock against itself. It is");
        Console.WriteLine("  the right answer far more often than its reputation suggests: it is");
        Console.WriteLine("  trivially correct, and 02-granularity.cs showed the whole cost of");
        Console.WriteLine("  coarse locking is contention, which you can measure before deciding");
        Console.WriteLine("  it matters.");
        Console.WriteLine();
        Console.WriteLine("  Reach for finer locks when a profiler says contention is hurting, not");
        Console.WriteLine("  because fine-grained locking sounds more sophisticated.");

        Console.WriteLine();
        Console.WriteLine("=== what it looks like in a dump ===");
        Console.WriteLine();
        Console.WriteLine("  A deadlocked service uses NO CPU and throws nothing. Requests stop");
        Console.WriteLine("  completing and the process looks idle.");
        Console.WriteLine();
        Console.WriteLine("    dotnet-dump collect --process-id &lt;pid&gt;");
        Console.WriteLine("    dotnet-dump analyze &lt;file&gt;");
        Console.WriteLine("    &gt; clrstack -all        threads sitting in Monitor.Enter");
        Console.WriteLine("    &gt; syncblk              which thread OWNS each contended monitor");
        Console.WriteLine();
        Console.WriteLine("  syncblk is the one that closes it. It prints, per monitor, the owning");
        Console.WriteLine("  thread and the object. Two entries whose owners are each other's");
        Console.WriteLine("  waiters is the cycle, and there is no other explanation for it.");
        Console.WriteLine();
        Console.WriteLine("  Live, without a dump, the counter to watch is:");
        Console.WriteLine("    dotnet-counters monitor --process-id &lt;pid&gt; System.Runtime");
        Console.WriteLine("      monitor-lock-contention-count   flat (nobody is even trying)");
        Console.WriteLine("      cpu-usage                       near zero");
        Console.WriteLine("      threadpool-queue-length         climbing");
        Console.WriteLine();
        Console.WriteLine("  Note how that differs from the other stalls in this track. Blocking");
        Console.WriteLine("  (t2-07) shows threads climbing as the pool injects replacements. A");
        Console.WriteLine("  deadlock on a fixed set of threads shows the queue growing while the");
        Console.WriteLine("  contention count stops moving, because the stuck threads have already");
        Console.WriteLine("  stopped competing for anything.");
    }

    static int _retries;

    sealed class Account
    {
        public Account(int id, decimal balance) { Id = id; Balance = balance; }
        public int Id { get; }
        public decimal Balance { get; set; }
        public object Gate { get; } = new();
    }

    /// &lt;summary&gt;
    /// Forces the interleaving between the two acquisitions. Each thread signals
    /// once it holds its FIRST lock, then waits briefly for the other to do the
    /// same. In production this overlap happens by chance; here it happens every
    /// time, which is what makes the naive result reproducible.
    ///
    /// It must time out. Under a correct ordering both threads want the same
    /// first lock, so the second never signals — an earlier version of this file
    /// used a Barrier, which then blocked forever and reported the ORDERED
    /// strategy as deadlocked when the deadlock was entirely in the harness.
    /// &lt;/summary&gt;
    static CountdownEvent? _bothHoldOne;

    static void HoldingFirstLock() =&gt; Overlap();

    static void Overlap()
    {
        _bothHoldOne!.Signal();
        _bothHoldOne.Wait(200);
    }

    static void Run(string label, Action&lt;Account, Account, decimal&gt; transfer)
    {
        var a = new Account(1, 1000m);
        var b = new Account(2, 1000m);
        _bothHoldOne = new CountdownEvent(2);
        Volatile.Write(ref _retries, 0);

        var done = new CountdownEvent(2);
        var sw = Stopwatch.StartNew();

        Start(() =&gt; { transfer(a, b, 100m); done.Signal(); });
        Start(() =&gt; { transfer(b, a, 100m); done.Signal(); });

        var completed = done.Wait(WatchdogMs);
        sw.Stop();

        var balances = completed ? $"  (A={a.Balance}, B={b.Balance})" : "";
        Console.WriteLine($"  {label,-33} {(completed ? "completed" : "DEADLOCKED"),-15} " +
                          $"{sw.Elapsed.TotalMilliseconds,5:N0}{balances}");
    }

    static void Start(Action body) =&gt;
        new Thread(() =&gt; { try { body(); } catch { } }) { IsBackground = true }.Start();

    /// &lt;summary&gt;WRONG. Acquires in call order, so opposite transfers form a cycle.&lt;/summary&gt;
    static void Naive(Account from, Account to, decimal amount)
    {
        lock (from.Gate)
        {
            Overlap();          // both threads now hold one lock each
            lock (to.Gate)
            {
                from.Balance -= amount;
                to.Balance += amount;
            }
        }
    }

    /// &lt;summary&gt;Right. A total order over the locks makes a cycle impossible.&lt;/summary&gt;
    static void Ordered(Account from, Account to, decimal amount)
    {
        var (first, second) = from.Id &lt; to.Id ? (from, to) : (to, from);
        lock (first.Gate)
        {
            Overlap();
            lock (second.Gate)
            {
                from.Balance -= amount;
                to.Balance += amount;
            }
        }
    }

    /// &lt;summary&gt;
    /// Also right, and weaker: detects the cycle instead of preventing it, then
    /// backs off. The backoff is randomised so two threads do not retry in step.
    /// &lt;/summary&gt;
    static void TryWithTimeout(Account from, Account to, decimal amount)
    {
        var rng = new Random(Environment.CurrentManagedThreadId);
        var signalled = false;

        while (true)
        {
            var gotFirst = false;
            var gotSecond = false;
            try
            {
                Monitor.TryEnter(from.Gate, TimeSpan.FromMilliseconds(50), ref gotFirst);
                if (gotFirst)
                {
                    // Only synchronise on the first pass.
                    if (!signalled) { signalled = true; Overlap(); }

                    Monitor.TryEnter(to.Gate, TimeSpan.FromMilliseconds(50), ref gotSecond);
                    if (gotSecond)
                    {
                        from.Balance -= amount;
                        to.Balance += amount;
                        return;
                    }
                }
            }
            finally
            {
                if (gotSecond) Monitor.Exit(to.Gate);
                if (gotFirst) Monitor.Exit(from.Gate);
            }

            Interlocked.Increment(ref _retries);
            Thread.Sleep(rng.Next(1, 20));       // randomised, to avoid livelock
        }
    }

    static readonly object AllAccounts = new();

    /// &lt;summary&gt;Right, and trivially so: one lock cannot deadlock against itself.&lt;/summary&gt;
    static void SingleLock(Account from, Account to, decimal amount)
    {
        lock (AllAccounts)
        {
            from.Balance -= amount;
            to.Balance += amount;
        }
        Overlap();               // keep the harness symmetric
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>// 04-production.cs — Ledger's settlement netting job. A lock held across a
// remote call, and what that does to a service under load. Then the second bug
// in the same class: a lock that protected the wrong thing.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
//
// Timings here are quoted as RATIOS against the fixed version. Absolute
// milliseconds on a desktop vary by 20% or more between runs.
// Run: dotnet run 04-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Netting;

public sealed record Position(string Counterparty, decimal Amount);

/// &lt;summary&gt;Stands in for the remote rates service. 20 ms per call.&lt;/summary&gt;
public static class RatesApi
{
    private static int _calls;
    public static int Calls =&gt; Volatile.Read(ref _calls);
    public static void Reset() =&gt; Volatile.Write(ref _calls, 0);

    public static decimal GetRate(string counterparty)
    {
        Interlocked.Increment(ref _calls);
        Thread.Sleep(20);                       // a blocking remote call
        return 1.17m;
    }
}

/// &lt;summary&gt;
/// THE SHIPPED VERSION. The lock is correct — the totals are never wrong — and
/// it is held across a 20 ms remote call, so every caller is serialised behind
/// the network rather than behind the arithmetic.
/// &lt;/summary&gt;
public sealed class NettingServiceV1
{
    private readonly Dictionary&lt;string, decimal&gt; _totals = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public void Add(Position p)
    {
        lock (_gate)
        {
            var rate = RatesApi.GetRate(p.Counterparty);      // I/O inside the lock
            _totals.TryGetValue(p.Counterparty, out var running);
            _totals[p.Counterparty] = running + p.Amount * rate;
        }
    }

    public decimal Total =&gt; _totals.Values.Sum();
}

/// &lt;summary&gt;
/// THE FIX. Identical locking discipline, identical correctness — the remote
/// call moved OUT of the critical section. The lock now protects only the
/// dictionary mutation, which takes nanoseconds.
/// &lt;/summary&gt;
public sealed class NettingServiceV2
{
    private readonly Dictionary&lt;string, decimal&gt; _totals = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public void Add(Position p)
    {
        var rate = RatesApi.GetRate(p.Counterparty);          // outside
        lock (_gate)
        {
            _totals.TryGetValue(p.Counterparty, out var running);
            _totals[p.Counterparty] = running + p.Amount * rate;
        }
    }

    public decimal Total =&gt; _totals.Values.Sum();
}

/// &lt;summary&gt;
/// WRONG in a way that looks right: the lock is taken for the WRITE but not for
/// the READ. A reader can observe a Dictionary mid-resize.
/// &lt;/summary&gt;
public sealed class NettingServiceV3
{
    private readonly Dictionary&lt;string, decimal&gt; _totals = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public void Add(Position p)
    {
        lock (_gate) { _totals[p.Counterparty + Guid.NewGuid()] = p.Amount; }
    }

    /// &lt;summary&gt;No lock. This is the bug.&lt;/summary&gt;
    public int CountWithoutLocking() =&gt; _totals.Count;

    public bool TryReadWithoutLocking()
    {
        foreach (var _ in _totals) { }        // enumerating an unlocked Dictionary
        return true;
    }
}

class Program
{
    const int Threads = 8;
    const int PositionsPerThread = 25;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger nets settlement positions by counterparty. The netting");
        Console.WriteLine("  service is a singleton and its Add method is called from every");
        Console.WriteLine("  request thread, so it takes a lock. Correct, reviewed, shipped.");
        Console.WriteLine();
        Console.WriteLine("      lock (_gate)");
        Console.WriteLine("      {");
        Console.WriteLine("          var rate = _rates.GetRate(p.Counterparty);   // 20 ms remote");
        Console.WriteLine("          _totals[p.Counterparty] = running + p.Amount * rate;");
        Console.WriteLine("      }");
        Console.WriteLine();
        Console.WriteLine("  The totals were never wrong. The endpoint became unusable at eight");
        Console.WriteLine("  concurrent requests, and nobody could see why: CPU was near zero,");
        Console.WriteLine("  memory was flat, and the rates service reported normal latency.");
        Console.WriteLine();

        var v1 = Measure("I/O inside the lock", () =&gt; new NettingServiceV1(), (s, p) =&gt; ((NettingServiceV1)s).Add(p));
        var v2 = Measure("I/O outside the lock", () =&gt; new NettingServiceV2(), (s, p) =&gt; ((NettingServiceV2)s).Add(p));

        Console.WriteLine("  version                  relative time   contentions   remote calls");
        Console.WriteLine($"  I/O inside the lock      {v1.Ms / v2.Ms,13:N1}x   {v1.Contentions,11:N0}   {v1.Calls,12:N0}");
        Console.WriteLine($"  I/O outside the lock     {v2.Ms / v2.Ms,13:N1}x   {v2.Contentions,11:N0}   {v2.Calls,12:N0}");
        Console.WriteLine();
        Console.WriteLine("  Same work, same number of remote calls, same answer. The only");
        Console.WriteLine("  difference is what the lock spans.");
        Console.WriteLine();
        Console.WriteLine("  With the call inside, the critical section is 20 ms long, so eight");
        Console.WriteLine("  threads take turns and total time is the sum of everything. The");
        Console.WriteLine("  service has an effective concurrency of ONE regardless of how many");
        Console.WriteLine("  threads, cores or instances you give it.");
        Console.WriteLine();
        Console.WriteLine("  That is why it looked like nothing was wrong. The processor is idle");
        Console.WriteLine("  because everyone is waiting; the rates service sees normal latency");
        Console.WriteLine("  because each individual call IS fast; and no exception is ever");
        Console.WriteLine("  thrown. The only visible symptom is that throughput does not");
        Console.WriteLine("  improve when you add capacity.");

        Console.WriteLine();
        Console.WriteLine("=== the signature that identifies it ===");
        Console.WriteLine();
        Console.WriteLine("    dotnet-counters monitor --process-id &lt;pid&gt; System.Runtime");
        Console.WriteLine("      monitor-lock-contention-count   HIGH and climbing");
        Console.WriteLine("      cpu-usage                       low");
        Console.WriteLine("      threadpool-queue-length         climbing");
        Console.WriteLine();
        Console.WriteLine("  The contention counter is what separates this from every other");
        Console.WriteLine("  low-CPU stall in this track:");
        Console.WriteLine();
        Console.WriteLine("    lock held too long   contention HIGH, CPU low, queue growing");
        Console.WriteLine("    deadlock (03)        contention FLAT, CPU zero, queue growing");
        Console.WriteLine("    sync-over-async      contention low,  CPU low, THREADS growing");
        Console.WriteLine("    parallel saturation  contention low,  CPU 100%");
        Console.WriteLine();
        Console.WriteLine("  Then a dump names the method:");
        Console.WriteLine("    &gt; clrstack -all      many threads in Monitor.Enter, same frame");
        Console.WriteLine("    &gt; syncblk            one monitor, one owner, many waiters");
        Console.WriteLine();
        Console.WriteLine("  A deadlock shows a CYCLE in syncblk — two owners waiting on each");
        Console.WriteLine("  other. This shows a QUEUE: one owner, everyone else waiting. The");
        Console.WriteLine("  distinction tells you whether to look for an ordering bug or a long");
        Console.WriteLine("  critical section, and they have nothing to do with each other.");

        Console.WriteLine();
        Console.WriteLine("=== the second bug: locking the write and not the read ===");
        Console.WriteLine();
        Console.WriteLine("  The same class had a Count property that did not take the lock.");
        Console.WriteLine("  Reading looks harmless — nothing is being modified by the reader.");
        Console.WriteLine();
        var (crashes, trials) = ReadWhileWriting();
        Console.WriteLine($"  enumerating without the lock while writers hold it:");
        Console.WriteLine($"    {crashes} of {trials} trials threw InvalidOperationException");
        Console.WriteLine();
        Console.WriteLine("  A lock is a protocol, and a protocol only works if EVERY participant");
        Console.WriteLine("  follows it. A reader that skips the lock can observe a Dictionary");
        Console.WriteLine("  midway through a resize: a torn read, a missing entry, or the");
        Console.WriteLine("  exception above.");
        Console.WriteLine();
        Console.WriteLine("  The rule: the lock protects the DATA, not the method. Every path that");
        Console.WriteLine("  touches the data takes the lock, reads included. If that feels");
        Console.WriteLine("  expensive, the answer is a concurrent collection (t2-15) or an");
        Console.WriteLine("  immutable snapshot — not skipping the lock on the paths that look");
        Console.WriteLine("  read-only.");
    }

    readonly record struct Result(double Ms, long Contentions, int Calls);

    static Result Measure(string _, Func&lt;object&gt; make, Action&lt;object, Position&gt; add)
    {
        Thread.Sleep(120);
        RatesApi.Reset();
        var service = make();
        var before = Monitor.LockContentionCount;
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();

        var threads = new Thread[Threads];
        for (var t = 0; t &lt; Threads; t++)
        {
            var id = t;
            threads[t] = new Thread(() =&gt;
            {
                ready.Wait();
                for (var i = 0; i &lt; PositionsPerThread; i++)
                    add(service, new Position($"CP-{(id * 31 + i) % 5}", 100m));
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();

        return new Result(sw.Elapsed.TotalMilliseconds,
                          Monitor.LockContentionCount - before,
                          RatesApi.Calls);
    }

    static (int crashes, int trials) ReadWhileWriting()
    {
        const int Trials = 40;
        var crashes = 0;

        for (var trial = 0; trial &lt; Trials; trial++)
        {
            var service = new NettingServiceV3();
            var stop = new CancellationTokenSource();
            var failed = false;

            var writer = new Thread(() =&gt;
            {
                var i = 0;
                while (!stop.IsCancellationRequested)
                    service.Add(new Position($"CP-{i++}", 1m));
            }) { IsBackground = true };

            var reader = new Thread(() =&gt;
            {
                while (!stop.IsCancellationRequested)
                {
                    try { service.TryReadWithoutLocking(); }
                    catch (InvalidOperationException) { failed = true; return; }
                    catch (ArgumentException) { failed = true; return; }
                    catch (IndexOutOfRangeException) { failed = true; return; }
                }
            }) { IsBackground = true };

            writer.Start();
            reader.Start();
            Thread.Sleep(25);
            stop.Cancel();
            writer.Join(500);
            reader.Join(500);
            if (failed) crashes++;
        }
        return (crashes, Trials);
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="05-exercises.cs"><code>// 05-exercises.cs — every answer claimed in this module's exercises, run.
// Timings are quoted as ratios; counts and correctness are exact.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-exercises.cs -c Release
#:property Nullable=enable

using System;
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
        Console.WriteLine("===== Exercise 1: which of these lock objects are safe? =====");
        Console.WriteLine();
        Console.WriteLine("  (a) lock (this)");
        Console.WriteLine("  (b) lock (typeof(Ledger))");
        Console.WriteLine($"  (c) lock (\"ledger-gate\")  — same literal elsewhere is the SAME object: " +
                          $"{ReferenceEquals("ledger-gate", Elsewhere())}");
        Console.WriteLine("  (d) lock (_count)  where _count is an int");
        Console.WriteLine("  (e) private readonly object _gate = new();");
        Console.WriteLine();
        Console.WriteLine("  Only (e). (a) lets any holder of your object block or deadlock you.");
        Console.WriteLine("  (b) is process-wide and shared with code you did not write. (c) is");
        Console.WriteLine("  interned, so the same text anywhere in the process is one monitor —");
        Console.WriteLine("  verified above. (d) does not compile at all: CS0185, lock on a value");
        Console.WriteLine("  type. That last one is the language preventing the mistake outright.");
        Console.WriteLine();
        Console.WriteLine("  On .NET 9+ prefer: private readonly Lock _gate = new();");
        Console.WriteLine("  It is faster, cannot be locked by anyone else, and exposes TryEnter");
        Console.WriteLine("  and IsHeldByCurrentThread. But declare the FIELD as Lock — typing it");
        Console.WriteLine("  as object silently reverts to Monitor.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: how long is the critical section? =====");
        Console.WriteLine();
        Console.WriteLine("      lock (_gate) { var r = Compute(x); _map[x] = r; }");
        Console.WriteLine();
        var inside = Scope(inside: true);
        var outside = Scope(inside: false);
        Console.WriteLine($"  compute inside the lock  : {inside / outside,5:N2}x the time of outside");
        Console.WriteLine();
        Console.WriteLine("  Compute reads no shared state, so it does not need protecting. Move");
        Console.WriteLine("  it out and the lock spans one dictionary write.");
        Console.WriteLine();
        Console.WriteLine("      var r = Compute(x); lock (_gate) { _map[x] = r; }");
        Console.WriteLine();
        Console.WriteLine("  This is the highest-value lock change available and it costs nothing.");
        Console.WriteLine("  The critical section is the only part that serialises, so shortening");
        Console.WriteLine("  it is the whole game.");
        Console.WriteLine();
        Console.WriteLine("  The caveat: this is only valid if Compute is PURE. If it reads the");
        Console.WriteLine("  shared state, moving it out introduces a check-then-act race (t2-11).");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: will this deadlock? =====");
        Console.WriteLine();
        Console.WriteLine("      void A() { lock (_g) { B(); } }");
        Console.WriteLine("      void B() { lock (_g) { ... } }");
        Console.WriteLine();
        Console.WriteLine($"  same thread, same monitor, nested : {Nested()}");
        Console.WriteLine();
        Console.WriteLine("  No. A monitor is REENTRANT: the owning thread may enter again, and");
        Console.WriteLine("  the runtime counts and releases on the matching exit.");
        Console.WriteLine();
        Console.WriteLine("  That is convenient and it hides a design problem. B now runs while");
        Console.WriteLine("  A is midway through mutating the state the lock protects, so B sees");
        Console.WriteLine("  a broken invariant — and no exception says so.");
        Console.WriteLine();
        Console.WriteLine("  Contrast SemaphoreSlim(1,1), which is NOT reentrant:");
        Console.WriteLine($"    same pattern with SemaphoreSlim : {SemaphoreNested()}");
        Console.WriteLine();
        Console.WriteLine("  Neither behaviour is better. They fail differently, and the failure");
        Console.WriteLine("  you get depends on which primitive you picked for reasons that");
        Console.WriteLine("  probably had nothing to do with reentrancy.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: order these by contention =====");
        Console.WriteLine();
        Console.WriteLine("  8 threads, 4,096 counters, identical work:");
        Console.WriteLine();
        Console.WriteLine("  scheme                contentions   relative time");
        var g = Contended(new Global());
        Row("one global lock", g, g);
        Row("16 stripes", Contended(new Striped(16)), g);
        Row("one lock per counter", Contended(new PerKey()), g);
        Console.WriteLine();
        Console.WriteLine("  Contention falls by orders of magnitude; time falls far less. That");
        Console.WriteLine("  gap is the real lesson: removing contention helps only up to the");
        Console.WriteLine("  point where something else is the bottleneck, and here the remaining");
        Console.WriteLine("  cost is the atomic operation itself plus memory traffic.");
        Console.WriteLine();
        Console.WriteLine("  So finer locking has diminishing returns AND rising risk — every");
        Console.WriteLine("  extra lock is another thing that can be taken out of order. Start");
        Console.WriteLine("  with one lock and stripe only when a profiler says to.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: fix this without deadlocking =====");
        Console.WriteLine();
        Console.WriteLine("      void Transfer(Account a, Account b, decimal amt)");
        Console.WriteLine("      { lock (a.Gate) lock (b.Gate) { ... } }");
        Console.WriteLine();
        Console.WriteLine("  Called concurrently as Transfer(A,B) and Transfer(B,A):");
        Console.WriteLine();
        Console.WriteLine($"    naive           : {TransferTrial(ordered: false)}");
        Console.WriteLine($"    ordered by id   : {TransferTrial(ordered: true)}");
        Console.WriteLine();
        Console.WriteLine("  Acquire in a total order every caller agrees on:");
        Console.WriteLine();
        Console.WriteLine("      var (first, second) = a.Id &lt; b.Id ? (a, b) : (b, a);");
        Console.WriteLine("      lock (first.Gate) lock (second.Gate) { ... }");
        Console.WriteLine();
        Console.WriteLine("  A cycle requires two threads acquiring in OPPOSITE orders. If every");
        Console.WriteLine("  thread uses the same order, no cycle can form. That is a proof, not a");
        Console.WriteLine("  reduction in probability.");
        Console.WriteLine();
        Console.WriteLine("  The ordering key must be stable and total: a database id works, an");
        Console.WriteLine("  object hash code does not (it can collide and can change between");
        Console.WriteLine("  runs). And the rule only holds if every path goes through the ordered");
        Console.WriteLine("  helper — one method that forgets reopens the cycle.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: which stall is this? =====");
        Console.WriteLine();
        Console.WriteLine("  Four services, all slow, all with low CPU. Name each from counters:");
        Console.WriteLine();
        Console.WriteLine("  contention   CPU    threads   queue    diagnosis");
        Console.WriteLine("  HIGH+rising  low    steady    rising   lock held too long");
        Console.WriteLine("  FLAT         ~zero  steady    rising   deadlock: nobody is competing");
        Console.WriteLine("  low          low    RISING    rising   sync-over-async (t2-07)");
        Console.WriteLine("  low          100%   steady    rising   parallel saturation (t2-10)");
        Console.WriteLine();
        Console.WriteLine("  The contention counter separates the first two, and it is the one");
        Console.WriteLine("  people never look at. A deadlock produces a FLAT contention count");
        Console.WriteLine("  because the stuck threads have stopped competing for anything — they");
        Console.WriteLine("  are parked, not fighting.");
        Console.WriteLine();
        Console.WriteLine("  Thread count separates sync-over-async: the pool keeps injecting");
        Console.WriteLine("  replacements for threads it believes are merely slow.");
        Console.WriteLine();
        Console.WriteLine("  Then confirm with a dump: syncblk shows a CYCLE for a deadlock and a");
        Console.WriteLine("  QUEUE (one owner, many waiters) for a long critical section.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static string Elsewhere() =&gt; "ledger-gate";

    // --- Exercise 2 -----------------------------------------------------------
    static double Scope(bool inside)
    {
        var gate = new object();
        var map = new Dictionary&lt;int, long&gt;();
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();

        for (var t = 0; t &lt; 8; t++)
        {
            var seed = t;
            threads[t] = new Thread(() =&gt;
            {
                ready.Wait();
                for (var i = 0; i &lt; 3_000; i++)
                {
                    var key = seed * 3_000 + i;
                    if (inside) { lock (gate) { map[key] = Compute(key); } }
                    else { var r = Compute(key); lock (gate) { map[key] = r; } }
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();
        _sink += map.Count;
        return sw.Elapsed.TotalMilliseconds;
    }

    static long Compute(int seed)
    {
        var h = seed;
        for (var i = 0; i &lt; 400; i++) h = HashCode.Combine(h, i);
        return h &amp; 0xFF;
    }

    // --- Exercise 3 -----------------------------------------------------------
    static readonly object NestGate = new();

    static string Nested()
    {
        lock (NestGate)
        {
            lock (NestGate) { return "entered twice, no deadlock"; }
        }
    }

    static string SemaphoreNested()
    {
        var sem = new SemaphoreSlim(1, 1);
        sem.Wait();
        var second = sem.Wait(TimeSpan.FromMilliseconds(200));
        if (second) { sem.Release(); sem.Release(); return "entered twice (unexpected)"; }
        sem.Release();
        return "DEADLOCKED on the second Wait (timed out at 200 ms)";
    }

    // --- Exercise 4 -----------------------------------------------------------
    interface ICounters { void Inc(int k); long Total { get; } }

    sealed class Global : ICounters
    {
        readonly object _g = new(); readonly long[] _c = new long[4096];
        public void Inc(int k) { lock (_g) _c[k]++; }
        public long Total =&gt; _c.Sum();
    }

    sealed class Striped : ICounters
    {
        readonly object[] _g; readonly long[] _c = new long[4096];
        public Striped(int n) { _g = new object[n]; for (var i = 0; i &lt; n; i++) _g[i] = new object(); }
        public void Inc(int k) { lock (_g[k &amp; (_g.Length - 1)]) _c[k]++; }
        public long Total =&gt; _c.Sum();
    }

    sealed class PerKey : ICounters
    {
        readonly object[] _g = new object[4096]; readonly long[] _c = new long[4096];
        public PerKey() { for (var i = 0; i &lt; 4096; i++) _g[i] = new object(); }
        public void Inc(int k) { lock (_g[k]) _c[k]++; }
        public long Total =&gt; _c.Sum();
    }

    readonly record struct Cont(long Contentions, double Ms);

    static Cont Contended(ICounters c)
    {
        Thread.Sleep(100);
        var before = Monitor.LockContentionCount;
        var sw = Stopwatch.StartNew();
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        for (var t = 0; t &lt; 8; t++)
        {
            var seed = t * 7919;
            threads[t] = new Thread(() =&gt;
            {
                ready.Wait();
                var k = seed;
                for (var i = 0; i &lt; 150_000; i++)
                {
                    k = (k * 1103515245 + 12345) &amp; int.MaxValue;
                    c.Inc(k % 4096);
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();
        _sink += c.Total;
        return new Cont(Monitor.LockContentionCount - before, sw.Elapsed.TotalMilliseconds);
    }

    static void Row(string label, Cont r, Cont baseline) =&gt;
        Console.WriteLine($"  {label,-20} {r.Contentions,11:N0}   {r.Ms / baseline.Ms,13:N2}x");

    // --- Exercise 5 -----------------------------------------------------------
    sealed class Account
    {
        public Account(int id) { Id = id; }
        public int Id { get; }
        public decimal Balance = 1000m;
        public object Gate { get; } = new();
    }

    static string TransferTrial(bool ordered)
    {
        var a = new Account(1);
        var b = new Account(2);
        var bothHoldOne = new CountdownEvent(2);
        var done = new CountdownEvent(2);

        void Transfer(Account from, Account to)
        {
            var (first, second) = ordered
                ? (from.Id &lt; to.Id ? from : to, from.Id &lt; to.Id ? to : from)
                : (from, to);
            lock (first.Gate)
            {
                bothHoldOne.Signal();
                bothHoldOne.Wait(200);
                lock (second.Gate) { from.Balance -= 100m; to.Balance += 100m; }
            }
            done.Signal();
        }

        new Thread(() =&gt; { try { Transfer(a, b); } catch { } }) { IsBackground = true }.Start();
        new Thread(() =&gt; { try { Transfer(b, a); } catch { } }) { IsBackground = true }.Start();

        return done.Wait(1500)
            ? $"completed (A={a.Balance}, B={b.Balance})"
            : "DEADLOCKED";
    }
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does <code>lock (gate) { ... }</code> compile to, and why does the shape matter?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Monitor.Enter(gate, ref taken)</code> in a <code>try</code>, with
        <code>Monitor.Exit</code> in a <code>finally</code>. The <code>finally</code> means an
        exception releases the lock; the <code>taken</code> flag prevents exiting a monitor that was
        never entered.</p>
      </div></details>
    </li>
    <li>
      <p>What is the single most important property of a lock?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The <strong>length of the critical section</strong> — only that part serialises. Measured:
        a remote call inside the lock made the service <strong>8.0× slower</strong> with identical
        results and identical remote calls.</p>
      </div></details>
    </li>
    <li>
      <p>Name the four things you must not lock on.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>this</code>, a <code>Type</code>, a string (literals are <strong>interned</strong> —
        verified), and a value type (CS0185, does not compile). Use a private readonly field, typed
        <code>Lock</code> on .NET 9+.</p>
      </div></details>
    </li>
    <li>
      <p>Is a monitor reentrant, and is that good?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Yes — verified, three nested entries on one thread. It is a convenience that hides a design
        problem: the nested call sees state midway through the outer call's mutation.
        <code>SemaphoreSlim</code> is not reentrant and deadlocks instead.</p>
      </div></details>
    </li>
    <li>
      <p>Why can you not <code>await</code> inside a lock?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A monitor is owned by a <strong>thread</strong>, and an <code>await</code> can resume on a
        different one, which would release a lock it does not hold. CS1996 is an error, not a warning.
        Use <code>SemaphoreSlim.WaitAsync</code>, which is not thread-owned.</p>
      </div></details>
    </li>
    <li>
      <p>What does lock striping buy, and what does it cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Most of the contention reduction of per-key locks for a bounded amount of memory —
        measured, 1,812 contentions down to 346 at 16 stripes. It costs the possibility that two
        unrelated keys share a lock, which is a performance cost rather than a correctness one.</p>
      </div></details>
    </li>
    <li>
      <p>What makes lock ordering a guarantee rather than a mitigation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A cycle requires two threads acquiring in opposite orders. A total order every caller
        obeys makes that impossible, not merely unlikely. The key must be stable and total — a
        database id, not a hash code.</p>
      </div></details>
    </li>
    <li>
      <p>Do read paths need the lock?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Yes. Measured: <strong>20 of 40 trials</strong> threw
        <code>InvalidOperationException</code> enumerating a <code>Dictionary</code> without the lock
        while locked writers modified it. A lock protects the data, not the method.</p>
      </div></details>
    </li>
    <li>
      <p>How do you tell a deadlock from a lock held too long, without a dump?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>monitor-lock-contention-count</code>. A deadlock leaves it <strong>flat</strong> —
        the stuck threads have stopped competing. A long critical section makes it <strong>rise</strong>
        as threads keep arriving. In a dump, <code>syncblk</code> shows a cycle against a queue.</p>
      </div></details>
    </li>
    <li>
      <p>You declared <code>private readonly object _gate = new Lock();</code>. What did you get?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Monitor</code>, not <code>EnterScope</code> — verified. The compiler chooses on the
        <strong>static type of the expression</strong>. CS9216 warns on visible conversions; a field
        that was always <code>object</code> produces no warning at all.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
