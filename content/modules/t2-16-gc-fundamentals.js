CSPREP.module({
  id: "t2-16-gc-fundamentals",
  minutes: 55,
  updated: "2026-08-31",
  summary: "The collector charges for what LIVES, not for what you allocate: identical allocation produced zero gen 1 and gen 2 collections when dropped and several of each when kept. Ledger's 30-second response cache cut database load by two thirds and doubled p99 latency, because a seconds-long lifetime guarantees promotion to gen 2 - and making the cache bigger cost 77 MB and 315x the time. Collection cost follows object COUNT rather than bytes, measured at more than an order of magnitude.",
  terms: ["managed heap", "root", "mark and sweep", "compaction", "generation", "promotion",
    "generational hypothesis", "mid-life crisis", "gen 2 collection", "time-in-gc", "gcroot",
    "gcdump", "WeakReference", "server GC", "workstation GC"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger added a response cache with a 30-second lifetime, to take load off the reporting database.
  It worked exactly as intended: database load fell by two thirds.</p>

  <p>Latency got worse. The p99 roughly doubled, in a pattern nobody could correlate with anything —
  spikes every few seconds, and they landed on requests that were cache <em>hits</em> and should have
  been the fastest in the system.</p>

  <p>The cache was not slow. The cache was creating a garbage collection problem, and the spikes were
  pauses.</p>

  <p>A 30-second lifetime guarantees that every cached object survives long enough to be
  <strong>promoted</strong> — copied into an older generation, then copied again — before it expires
  and becomes garbage. You pay to move objects you were always going to throw away, and then pay the
  most expensive kind of collection to reclaim them. Measured: a gen 2 collection cost
  <strong>122× a gen 0 collection</strong> on the same heap.</p>

  <p>Then somebody made the cache bigger, on the theory that more hits means less work. Measured, at
  100,000 entries against 1,000: <strong>77 MB of heap and 315× the time.</strong></p>

  <p>This module is about what the collector actually does — what a generation is, what gets promoted,
  what a collection pauses, and why the cost tracks the number of live <em>objects</em> rather than
  the number of bytes. It is also about the second defect in the same service: 10,000 objects that
  nothing in the code referenced and that could not be collected.</p>
</section>

<section id="plain-language">
  <h2>What the collector does</h2>

  <p class="define"><span class="define__term">Managed heap</span> The region where reference types
  live. You never free anything on it; the runtime reclaims what it can prove is unreachable.</p>

  <p class="define"><span class="define__term">Root</span> A reference the collector starts from:
  static fields, local variables on every thread's stack, CPU registers, GC handles, and the
  finalisation queue. <strong>Anything reachable from a root is alive</strong>, however irrelevant it
  is to your program.</p>

  <p class="define"><span class="define__term">Mark and sweep</span> Walk from every root, marking
  what is reachable; everything unmarked is garbage. Reachability, not reference counting — which is
  why cycles are collected without special handling.</p>

  <p class="define"><span class="define__term">Compaction</span> Moving the survivors together after a
  collection, so free space is contiguous again. It is why object addresses change, why pinning
  exists, and why the cost of a collection scales with the amount that <em>survives</em>.</p>

  <p class="define"><span class="define__term">Generation</span> An <em>age</em>, not a place you
  choose. Everything starts in gen 0. Survive a gen 0 collection and you are promoted to gen 1;
  survive gen 1 and you reach gen 2, which is collected rarely.</p>

  <p class="define"><span class="define__term">Promotion</span> Being copied into an older generation
  because you were still reachable when the younger one was collected. It is the only route to gen 2,
  and it is work proportional to how much survived.</p>

  <p><strong>An analogy, and its limits.</strong> Think of three trays on a desk. New paper goes in
  the first tray. Every so often you sweep it: anything still needed moves to the second tray, the
  rest is binned. Sweep the second tray occasionally and survivors reach the third, which you almost
  never look at. Sweeping the first tray is quick because it is small and nearly everything in it is
  rubbish.</p>

  <p><strong>Where the analogy breaks:</strong> you can see which papers you still need. The collector
  cannot — it must trace every reference from every root to find out, and to do that consistently it
  <strong>suspends your threads</strong> while it walks them. The pause is not the binning; it is the
  looking.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every measurement in this module was taken on <strong>workstation GC</strong>, the console
    default. ASP.NET Core defaults to <strong>server GC</strong>, which has one heap and one
    background collection thread per core.</p>
    <p>Numbers do not transfer between the two, and that is the most common way GC benchmarks
    mislead — a result measured in a console app and applied to a web service. Check
    <code>GCSettings.IsServerGC</code> before believing any figure, including these.</p>
  </div>

  <h3>The generational hypothesis</h3>

  <p>The whole design rests on one empirical claim: <strong>most objects die young.</strong> If that
  holds, collecting gen 0 reclaims most of the garbage while examining a small fraction of the heap.</p>

  <p>When it does not hold — when your objects survive only long enough to be promoted — you pay for
  the promotion and then pay again to collect them somewhere more expensive. That is the failure at
  the centre of this module, and a cache is the most common way to cause it.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-minimal-example.cs"><code>// 04-minimal-example.cs — the smallest program showing promotion, and what it
// costs when objects survive.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;

class Program
{
    static void Main()
    {
        // Everything starts in gen 0. Surviving a collection promotes it.
        var obj = new byte[64];
        Console.WriteLine($"freshly allocated  : gen {GC.GetGeneration(obj)}");
        GC.Collect(0, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"survived one gen 0 : gen {GC.GetGeneration(obj)}");
        GC.Collect(1, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"survived one gen 1 : gen {GC.GetGeneration(obj)}");
        GC.KeepAlive(obj);

        // The same total allocation, dropped versus kept.
        Console.WriteLine();
        Console.WriteLine("300,000 objects, same total bytes:");
        Console.WriteLine($"  dropped : {Counts(keep: false)}");
        Console.WriteLine($"  kept    : {Counts(keep: true)}");
        Console.WriteLine();
        Console.WriteLine("The GC charges for what LIVES, not for what you allocate.");
    }

    static string Counts(bool keep)
    {
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        int g0 = GC.CollectionCount(0), g1 = GC.CollectionCount(1), g2 = GC.CollectionCount(2);

        List&lt;byte[]&gt;? held = keep ? new List&lt;byte[]&gt;(300_000) : null;
        for (var i = 0; i &lt; 300_000; i++)
        {
            var b = new byte[256];
            if (held is not null) held.Add(b); else GC.KeepAlive(b);
        }
        GC.KeepAlive(held);

        return $"gen0 {GC.CollectionCount(0) - g0,3}, gen1 {GC.CollectionCount(1) - g1,3}, " +
               $"gen2 {GC.CollectionCount(2) - g2,3}";
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>freshly allocated  : gen 0
survived one gen 0 : gen 1
survived one gen 1 : gen 2

300,000 objects, same total bytes:
  dropped : gen0  26, gen1   0, gen2   0
  kept    : gen0  14, gen1   7, gen2   2

The GC charges for what LIVES, not for what you allocate.</code></pre>

  <p>The first three lines are promotion, observed. The object never chose a generation; it was moved
  each time because it was still reachable.</p>

  <p><strong>The two workloads allocate identical bytes.</strong> The dropped version triggers 26
  gen 0 collections and never promotes anything — no gen 1 collections, no gen 2. The kept version
  triggers fewer gen 0 collections and 7 gen 1 and 2 gen 2 collections, because everything survives
  and has to be moved.</p>

  <p><strong>That is the whole cost model.</strong> Allocation is a pointer bump and is nearly free;
  the bill arrives for objects that are still alive when a collection happens. A high allocation rate
  with everything dying in gen 0 is a healthy workload that needs no attention at all.</p>
</section>

<section id="generations">
  <h2>What a collection costs</h2>

  <pre data-lang="console" data-title="01-generations.cs"><code>  Server GC          : False
  Latency mode       : Interactive
  Max generation     : 2   (so gen 0, 1, 2)

  a byte[24] costs           : 48 bytes allocated</code></pre>

  <p>Nothing you allocate costs only its payload — 24 bytes of data cost 48, the difference being the
  object header, the method table pointer and alignment. For small objects the overhead is a
  significant fraction, which is one reason a million small objects is a different problem from a
  few large ones.</p>

  <pre data-lang="console" data-title="01-generations.cs — same total bytes, different lifetimes"><code>  workload             gen0   gen1   gen2   relative time
  dies immediately        35      0      0            1.00x
  all survives            20     12      4           18.31x</code></pre>

  <p>Identical allocation; an eighteenfold difference in time, and the generation counts explain it.
  Nothing was collected in gen 1 or gen 2 for the first workload because nothing ever got there.</p>

  <h3>What a pause is</h3>

  <p>Mark, sweep, compact — and to trace roots consistently, the collector <strong>suspends the
  managed threads</strong>:</p>

  <pre data-lang="console" data-title="The sequence"><code>roots    static fields, locals on every thread's stack, registers,
         GC handles, the finalisation queue
mark     walk from every root, marking everything reachable
sweep    everything unmarked is garbage
compact  survivors are moved together, so allocation stays a bump</code></pre>

  <pre data-lang="console" data-title="01-generations.cs — same heap, two collection depths"><code>  forced gen 0 collection :    1.0x  (baseline)
  forced gen 2 collection :  458.8x</code></pre>

  <p>Same heap. The difference is how much of it had to be examined and moved. <strong>A gen 2
  collection is proportional to the live set</strong>, not to the amount of garbage — so reclaiming a
  lot of rubbish is cheap, and having a lot of live data is what costs.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>That ratio is a forced, blocking collection on a deliberately large live set — it is an upper
    bound rather than a typical pause. Real gen 2 collections are usually background and concurrent,
    so the application is not suspended for the whole of it. The ordering is the durable result: gen 0
    is cheap, gen 2 is expensive, and the gap is large.</p>
  </div>

  <h3>The counters that matter</h3>

  <pre data-lang="console" data-title="dotnet-counters monitor --process-id &lt;pid&gt; System.Runtime"><code>gen-0-gc-count      high is NORMAL and cheap
gen-1-gc-count      moderate
gen-2-gc-count      should be RARE. Rising is the alarm.
gc-heap-size        total managed heap
alloc-rate          bytes per second allocated
time-in-gc          percentage of time spent collecting</code></pre>

  <p><strong><code>gen-2-gc-count</code> is the one to watch.</strong> Gen 0 collections are supposed
  to happen constantly. A rising gen 2 count means objects are surviving long enough to be promoted,
  which is either a leak or a design holding things longer than it needs to.</p>

  <p><code>time-in-gc</code> above roughly 10% is worth investigating; above 20% the process is
  spending more time collecting than most services can afford. Read it alongside
  <code>alloc-rate</code>: <strong>high allocation with low time-in-gc is healthy</strong> and needs
  nothing done to it.</p>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>The cache from the opening. Identical allocation, varying only how long each entry is held:</p>

  <pre data-lang="console" data-title="02-production.cs"><code>  lifetime of cached objects       gen0   gen1   gen2   promoted?
  dropped immediately               13      0      0          no
  held briefly (gen 0 only)         13      1      0    to gen 1
  held across collections            7      5      4    to gen 2</code></pre>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>There is no timing column here on purpose. The wall-clock cost of these three runs is dominated
    by allocation and bookkeeping rather than by collection, so a ratio would mislead — an earlier
    version of the verification file printed one and the middle row came out <em>faster</em> than the
    baseline. The collection counts are exact and are the signal.</p>
  </div>

  <p class="define"><span class="define__term">Mid-life crisis</span> The expensive middle case:
  objects that live only long enough to be promoted and then die. Objects that die young are free.
  Objects that live forever are promoted once and then ignored. These are copied into gen 1, copied
  again into gen 2, and then require a gen 2 collection to reclaim — all for data you were going to
  discard.</p>

  <p><strong>A 30-second TTL guarantees this shape.</strong> Nothing survives 30 seconds of
  allocation without being promoted.</p>

  <h3>Why making the cache bigger made it worse</h3>

  <pre data-lang="console" data-title="02-production.cs"><code>  cache size    gen2 collections   heap MB   relative time
  1,000 entries                0       1.3            1.00x
  20,000 entries               1      15.2           81.03x
  100,000 entries              2      77.0          315.51x</code></pre>

  <p>The instinct — more hits means less work — is right about the database and wrong about the
  collector. More entries means more promoted objects, a larger gen 2, and longer pauses.</p>

  <h3>What actually helped</h3>

  <pre data-lang="console" data-title="02-production.cs — comparable live bytes, timing the collections only"><code>  as an object graph (2,540,000 objects) :   1.00x  (baseline)
  as flat arrays     (   20,000 objects) :   0.02x</code></pre>

  <p><strong>Roughly the same live bytes. A hundredfold difference in object count. Collections more
  than an order of magnitude cheaper.</strong></p>

  <p>Marking walks <em>references</em>. A tree of small nodes must be visited node by node on every
  gen 2 collection; a byte array is one object with no outgoing references, so it is marked once and
  skipped. The cost follows the object count, not the bytes.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>That effect needs a real live set to appear. At a tenth of this size the two were
    indistinguishable, because fixed per-collection overhead dominated — the first version of this
    measurement reported <strong>1.03×</strong> and proved nothing.</p>
    <p>Worth knowing before you benchmark your own: a GC micro-benchmark on a small heap mostly
    measures the cost of starting a collection.</p>
  </div>

  <p>So the fixes were about object count rather than duration: cache the rendered bytes rather than
  the object graph that produced them, prefer one array per entry over a tree of small objects, and
  impose a hard size limit so gen 2 has a ceiling.</p>

  <h3>The second bug: the roots nobody could see</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a static event is a GC root"><code>public static class Bus
{
    public static event EventHandler? Published;
}

// Every subscriber is now reachable from a static field, forever.
public sealed class Subscriber
{
    public Subscriber() =&gt; Bus.Published += OnPublished;
    private void OnPublished(object? s, EventArgs e) { }
}</code></pre>

  <pre data-lang="console" data-title="02-production.cs"><code>    subscribers created                    : 10,000
    still alive after a full GC            : 10,000
    collected once the event was cleared   : 10,000</code></pre>

  <p>Nothing in the application code referenced those objects. All 10,000 survived a full blocking
  gen 2 collection, and all 10,000 became collectable the instant the event was cleared.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>The direction is what people get wrong.</strong> Subscribing does not make the
    <em>publisher</em> live longer — it makes the <em>subscriber</em> live as long as the publisher.</p>
    <p>A static or long-lived publisher therefore pins every short-lived object that ever subscribed,
    along with everything each one references. A subscriber holding a 4 MB buffer keeps that buffer
    for the life of the process.</p>
    <p>The rule: <strong>if the publisher outlives the subscriber, unsubscribe.</strong> In practice
    that means a subscriber implementing <code>IDisposable</code> that detaches in
    <code>Dispose</code> — and something that actually disposes it.</p>
  </div>

  <h3>How the two were told apart</h3>

  <p>Both raise <code>gc-heap-size</code>. They are distinguished by whether memory ever comes back:</p>

  <pre data-lang="console" data-title="Two shapes"><code>promotion pressure   heap rises and FALLS, gen2 count high,
                     time-in-gc high, latency spiky

a leak               heap rises and NEVER falls, gen2 count high,
                     and each collection reclaims less than the last</code></pre>

  <pre data-lang="console" data-title="The decisive step"><code>dotnet-gcdump collect --process-id 4812      # twice, minutes apart
dotnet-dump analyze core_20260831.dmp
&gt; dumpheap -stat        # what is on the heap, by type
&gt; gcroot &lt;address&gt;      # what is keeping one alive</code></pre>

  <p><strong><code>gcroot</code> is the command that ends the argument.</strong> It prints the chain
  from a root to the object, so "static event → delegate → your subscriber" appears as evidence
  rather than as a theory.</p>

  <p>Comparing two gcdumps taken minutes apart is the other half: <strong>a type whose count only
  rises is a leak; a type that fluctuates is promotion pressure</strong>, and the two need entirely
  different fixes.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A cache lifetime that guarantees promotion</h3>

  <p>Anything held for seconds will be promoted to gen 2. That is fine if the entry is then kept for
  hours; it is the mid-life crisis if it expires shortly afterwards. Measured: a 100,000-entry cache
  cost 77 MB and 315× the time of a 1,000-entry one.</p>

  <h3>2. Caching an object graph instead of bytes</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: 127 objects per entry to mark, forever"><code>// WRONG. Each cached entry is a tree the collector must walk node by node
// on every gen 2 collection.
_cache[key] = renderedReportObjectGraph;

// Right: one object, no outgoing references.
_cache[key] = Encoding.UTF8.GetBytes(renderedJson);</code></pre>

  <h3>3. A static event, or any static collection, holding short-lived objects</h3>

  <p>Measured: 10,000 subscribers that nothing in the code referenced, none collectable. Statics are
  roots — everything reachable from one is alive for the life of the process.</p>

  <h3>4. Calling <code>GC.Collect()</code> in application code</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: forcing the most expensive collection there is"><code>// WRONG. This forces a full blocking gen 2 collection — measured at 122x a
// gen 0 — and it PROMOTES everything currently alive, making the next one
// worse. It also discards the heuristics the runtime has learned about your
// allocation pattern.
GC.Collect();

// There is no "right" version for application code. The legitimate uses are
// benchmarking and a deliberate trim after a known one-off spike:
GC.Collect(2, GCCollectionMode.Aggressive, blocking: true, compacting: true);</code></pre>

  <h3>5. Reading a memory graph without knowing which GC you are on</h3>

  <p>Server GC has a heap per core and collects differently. A measurement from a console app does not
  describe your web service, and this is the most common way GC advice is misapplied.</p>

  <h3>6. Treating a high allocation rate as a problem</h3>

  <p>It is not, on its own. Allocation is a pointer bump. Measured: 300,000 objects that all died in
  gen 0 produced zero gen 1 and gen 2 collections. The number to look at is
  <code>time-in-gc</code> alongside <code>gen-2-gc-count</code>, not <code>alloc-rate</code>.</p>

  <h3>7. Assuming a finaliser makes cleanup safe</h3>

  <p>An object with a finaliser survives its first collection by definition — it is placed on the
  finalisation queue, which is itself a root, and is only reclaimed on a later pass. So adding a
  finaliser to a short-lived object guarantees promotion. That is the subject of
  <a href="#/m/t2-18-finalisers-and-idisposable">t2-18</a>, and it is worth knowing here because it is
  a promotion cause that looks like good hygiene.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> latency spikes every few seconds with no correlation to any
    dependency, and the slow requests are otherwise the cheapest in the system.</p>
    <p><strong>Why:</strong> collection pauses. A request that happens to be in flight during a gen 2
    collection wears the pause, and which request that is has nothing to do with what it was doing.</p>
    <p><strong>Tool:</strong></p>
    <pre data-lang="console" data-title="Confirming GC pauses"><code>dotnet-counters monitor --process-id 4812 System.Runtime
    gen-2-gc-count    rising
    time-in-gc        above 10%
    gc-heap-size      large, and rising and falling</code></pre>
    <p><strong>Reading it:</strong> a rising gen 2 count is the signal. Gen 0 collections are supposed
    to be frequent — a high <code>gen-0-gc-count</code> alone is not a problem and misleads people
    constantly.</p>
    <p><strong>Fix:</strong> reduce what survives. Shorten object lifetimes, reduce object counts per
    cached entry, or cap the cache.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> memory rises and never falls, and each collection reclaims less than
    the last.</p>
    <p><strong>Why:</strong> something is rooting objects you believe are gone.</p>
    <p><strong>Tool:</strong> two heap dumps a few minutes apart, and <code>gcroot</code>:</p>
    <pre data-lang="console" data-title="Finding what holds it"><code>dotnet-gcdump collect --process-id 4812     # then again, minutes later
dotnet-dump analyze core_20260831.dmp
&gt; dumpheap -stat                            # compare type counts between dumps
&gt; gcroot 00007f9c1a2b3c40                   # the chain from a root</code></pre>
    <p><strong>Reading it:</strong> a type whose count only rises between the two dumps is the leak.
    <code>gcroot</code> then names the holder — and in practice it is almost always one of: a static
    field, an event subscription, a cache with no eviction
    (<a href="#/m/t2-15-concurrent-collections">t2-15</a>), a timer, or a captured variable in a
    long-lived delegate.</p>
    <p><strong>Fix:</strong> break the reference. Unsubscribe, evict, or stop capturing.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> you need to know whether a specific object is being collected, during
    development.</p>
    <p><strong>Tool:</strong> a <code>WeakReference</code> and a forced collection. This is the
    technique the verification files use, and it answers the question directly:</p>
    <pre data-lang="csharp" data-net="10" data-title="Proving an object is or is not collectable"><code>var reference = new WeakReference(subject);
subject = null;                                  // drop OUR reference

GC.Collect(2, GCCollectionMode.Forced, blocking: true);
GC.WaitForPendingFinalizers();
GC.Collect(2, GCCollectionMode.Forced, blocking: true);

Console.WriteLine($"still alive: {reference.IsAlive}");   // true means something roots it</code></pre>
    <p><strong>Reading it:</strong> <code>IsAlive</code> true after a full blocking collection means
    something still references it. The double collection matters — an object with a finaliser survives
    the first pass by design.</p>
    <p><strong>Caveat:</strong> in a Debug build, locals stay rooted to the end of the method for the
    debugger's benefit, so this test can report false positives. Run it in Release.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a benchmark says one design allocates less, and production disagrees.</p>
    <p><strong>Why:</strong> the benchmark almost certainly ran on workstation GC with a small heap,
    where fixed per-collection overhead dominates and differences in live-set size do not show.</p>
    <p><strong>Tool:</strong> check what you are measuring on, and measure the right thing:</p>
    <pre data-lang="csharp" data-net="10" data-title="Before believing any GC number"><code>Console.WriteLine($"server GC : {GCSettings.IsServerGC}");
Console.WriteLine($"gen2 count: {GC.CollectionCount(2)}");
Console.WriteLine($"allocated : {GC.GetAllocatedBytesForCurrentThread():N0} bytes");</code></pre>
    <p><strong>Reading it:</strong> collection <em>counts</em> and allocated <em>bytes</em> are exact
    and reproducible; timings on a small heap are not. In this module the object-graph comparison
    showed no difference at 254,000 objects and a fiftyfold difference at 2.5 million — the same
    experiment, two conclusions, decided by scale.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>An optimisation that succeeds at its stated goal can degrade the system through the
    collector.</strong> Ledger's cache cut database load by two thirds and doubled p99 latency. Nobody
    connected the two, because the slow requests were cache hits — the fastest path in the code — and
    the cost appeared in a subsystem the change did not mention. Anything that extends object
    lifetimes is a GC change whether or not it looks like one.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The intuitive fix makes it worse.</strong> Faced with a cache that is not helping
    enough, the reflex is to make it bigger or hold entries longer. Measured, going from 1,000 to
    100,000 entries cost 77 MB of heap and 315× the time. The lever that works is the object
    <em>count</em> — a hundredfold reduction in objects at comparable bytes made collections more than
    an order of magnitude cheaper — and almost nobody reaches for it, because the bytes look the
    same.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A static event is the easiest permanent leak to write.</strong> 10,000 objects, nothing
    in the application referencing them, none collectable — and the code that caused it is a single
    <code>+=</code> in a constructor that looks like ordinary wiring. Because subscribing pins the
    <em>subscriber</em> rather than the publisher, the leak accumulates in whichever component is
    short-lived, which is rarely the one anybody suspects. <code>gcroot</code> answers it in seconds;
    reasoning about it can take days.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Allocating a lot is the problem."</strong> Allocation is a pointer bump. Measured:
    300,000 objects that all died in gen 0 produced <strong>zero</strong> gen 1 and gen 2 collections.
    The GC charges for what lives, not for what you allocate.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A high gen 0 count means trouble."</strong> Frequent gen 0 collections are normal and
    cheap — that is the design working. The counter that matters is
    <code>gen-2-gc-count</code>, read alongside <code>time-in-gc</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Caching more is always better."</strong> Measured: 100,000 entries against 1,000 cost
    77 MB and 315× the time. More cached objects means more promoted objects and a larger gen 2, so
    a cache can cost more in pauses than it saves in work.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Objects the GC keeps must be referenced somewhere in my code."</strong> They must be
    reachable from a <em>root</em>, which includes static fields and event invocation lists. Verified:
    10,000 objects with no application reference, all alive, all freed the moment the event was
    cleared.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Subscribing to an event keeps the publisher alive."</strong> The opposite. It keeps
    the <strong>subscriber</strong> alive as long as the publisher — which is why a static publisher
    leaks every subscriber that ever attached.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>GC.Collect()</code> will help."</strong> It forces the most expensive collection
    available — measured at 122× a gen 0 — and <em>promotes</em> everything currently alive, making
    the next one worse. It also discards the heuristics the runtime has learned about your allocation
    pattern.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Bytes are what the collector cares about."</strong> Marking walks references, so cost
    follows <strong>object count</strong>. Comparable live bytes held as 2.5 million small objects
    versus 20,000 arrays gave collections more than an order of magnitude apart.</p>
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
    <p>Which generation is this object in at each point, and why?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>var obj = new byte[64];
GC.Collect(0, GCCollectionMode.Forced, blocking: true);
GC.Collect(1, GCCollectionMode.Forced, blocking: true);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    freshly allocated          : gen 0
    after one gen 0 collection : gen 1
    after one gen 1 collection : gen 2</code></pre>
        <p><strong>Gen 0, then 1, then 2.</strong> A generation is an <em>age</em>, not a place you
        choose: everything starts in gen 0, and surviving a collection promotes it one level.
        Promotion is the only route to gen 2.</p>
        <p>The design rests on the <strong>generational hypothesis</strong> — most objects die young.
        When that holds, collecting gen 0 reclaims most of the garbage while examining a small part of
        the heap.</p>
        <p>When it does not hold, you pay twice: once to promote and again to collect in an older
        generation. That is the failure the rest of this module is about.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Two loops allocate exactly the same bytes. One drops each object, one keeps them all. Predict
    the collection counts.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  workload    gen0   gen1   gen2
  dropped       26      0      0
  kept          14      7      2</code></pre>
        <p><strong>The dropped version never promotes anything</strong> — 26 gen 0 collections, and no
        gen 1 or gen 2 collections at all, because nothing ever got there.</p>
        <p><strong>The kept version triggers all three.</strong> Everything survives, so everything is
        copied into gen 1, and enough reaches gen 2 to trigger collections there.</p>
        <p>Note the gen 0 count is <em>lower</em> for the kept version, which surprises people. Once
        objects are being promoted, gen 0 fills more slowly with garbage — the work moved rather than
        disappearing.</p>
        <p><strong>The GC charges for what lives, not for what you allocate.</strong> A high allocation
        rate with everything dying in gen 0 is a healthy workload that needs no attention.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>How much more expensive is a gen 2 collection than a gen 0 one, and what determines that?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    forced gen 0 :     1.0x  (baseline)
    forced gen 2 :   122.1x</code></pre>
        <p><strong>Two orders of magnitude on this heap</strong> — and the multiple is not a constant.
        It is set by <strong>how much survives</strong>, because a gen 2 collection walks everything
        reachable and then compacts the survivors.</p>
        <p>So reclaiming a large amount of garbage is cheap; having a large amount of <em>live</em>
        data is what costs. That inverts the intuition that a full heap is the problem — a full heap of
        garbage collects quickly.</p>
        <p><strong>Two caveats on that number.</strong> It is a forced, blocking collection on a
        deliberately large live set, so it is an upper bound rather than a typical pause — real gen 2
        collections are usually background and concurrent. And it was measured on workstation GC;
        server GC behaves differently.</p>
        <p>The durable result is the ordering and the reason for it, not the figure.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A cache with a 30-second TTL made p99 latency worse while reducing database load. Explain the
    mechanism, and say why making the cache bigger did not help.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  lifetime              gen1   gen2   promoted?
  dropped immediately      0      0   no
  held across GCs          7      1   to gen 2</code></pre>
        <p><strong>The mid-life crisis.</strong> Objects that die young are free; objects that live
        forever are promoted once and then ignored. The expensive case is in between — living only
        long enough to be promoted, then dying.</p>
        <p>You pay to copy them into gen 1, again into gen 2, and then pay a gen 2 collection to
        reclaim them. All for data you were always going to discard. <strong>A 30-second TTL guarantees
        this</strong>: nothing survives 30 seconds of allocation without promotion.</p>
        <p><strong>Why a bigger cache is worse.</strong> More entries means more promoted objects and a
        larger gen 2, so pauses lengthen:</p>
        <pre data-lang="console" data-title="From 02-production.cs"><code>  1,000 entries      gen2 0    1.3 MB     1.00x
  100,000 entries    gen2 2   77.0 MB   315.51x</code></pre>
        <p><strong>What actually helps</strong> is reducing the object count per entry rather than the
        duration: cache rendered bytes instead of an object graph, and impose a hard size limit so
        gen 2 has a ceiling.</p>
        <p>The general lesson: <strong>anything that extends object lifetimes is a GC change</strong>,
        whether or not the change description mentions memory.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Two caches hold comparable live bytes: one as 2.5 million small objects, one as 20,000 byte
    arrays. Which collects faster, and by how much?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    2,540,000 small objects :   1.00x  (baseline)
       20,000 byte arrays   :   0.02x</code></pre>
        <p><strong>The flat version, by more than an order of magnitude</strong>, at comparable live
        bytes.</p>
        <p><strong>Marking walks references.</strong> A tree of small nodes must be visited node by
        node on every gen 2 collection; a byte array is a single object with no outgoing references, so
        it is marked once and skipped. <strong>Cost follows object count, not bytes.</strong></p>
        <p><strong>The measurement caveat matters here.</strong> At a tenth of this size the two were
        indistinguishable — the first version of this experiment reported 1.03× and proved nothing,
        because fixed per-collection overhead dominated on a small heap. A GC micro-benchmark on a
        small heap mostly measures the cost of starting a collection.</p>
        <p>The practical consequence for caching: <strong>what you keep matters less than how many
        objects it is made of.</strong> Serialising to bytes before caching is often a larger win than
        any change to the eviction policy.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Objects that nothing in your code references are not being collected. Find the root, and say how
    you would find it in production.</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 6"><code>public static event EventHandler? Published;
// in the subscriber's constructor:  Bus.Published += OnPublished;</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    10,000 subscribers, all dropped by our code
    still alive after a full GC          : 10,000
    freed once the event was cleared     : 10,000</code></pre>
        <p><strong>A static event's invocation list is a GC root.</strong> It holds a reference to
        every subscriber, so none can be collected however thoroughly your own code forgets them —
        all 10,000 survived a full blocking gen 2 collection, and all 10,000 became collectable the
        instant the event was cleared.</p>
        <p><strong>The direction is what people get wrong.</strong> Subscribing does not extend the
        <em>publisher</em>'s life; it makes the <em>subscriber</em> live as long as the publisher. So a
        static publisher pins every short-lived object that ever subscribed, along with everything each
        one references — a subscriber holding a 4 MB buffer keeps that buffer for the process
        lifetime.</p>
        <p><strong>The fix:</strong> if the publisher outlives the subscriber, unsubscribe. In practice
        the subscriber implements <code>IDisposable</code> and detaches in <code>Dispose</code>, and
        something actually disposes it.</p>
        <pre data-lang="console" data-title="Finding it in production"><code>dotnet-gcdump collect --process-id &lt;pid&gt;      # twice, minutes apart
dotnet-dump analyze &lt;file&gt;
&gt; dumpheap -stat        # a type whose count only RISES between dumps
&gt; gcroot &lt;address&gt;      # the chain from a root to that object</code></pre>
        <p><strong><code>gcroot</code> ends the argument</strong> — it prints "static event → delegate
        → subscriber" explicitly rather than leaving it to be deduced. And comparing two dumps
        separates the two shapes: a count that only rises is a leak, a count that fluctuates is
        promotion pressure, and they need different fixes.</p>
        <p>In practice the root is almost always one of five things: a static field, an event
        subscription, a cache with no eviction (<a href="#/m/t2-15-concurrent-collections">t2-15</a>),
        a timer, or a captured variable in a long-lived delegate.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 01-generations.cs -c Release</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-generations.cs"><code>// 01-generations.cs — what the GC actually does, observed rather than described:
// which generation collects, what survives, and what a collection costs.
//
// Collection counts and byte figures are exact. Timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-generations.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime;
using System.Threading;

class Program
{
    static object? _keepAlive;

    static void Main()
    {
        Console.WriteLine("=== 1. the configuration you are measuring on ===");
        Console.WriteLine();
        Console.WriteLine($"  Server GC          : {GCSettings.IsServerGC}");
        Console.WriteLine($"  Latency mode       : {GCSettings.LatencyMode}");
        Console.WriteLine($"  Max generation     : {GC.MaxGeneration}   (so gen 0, 1, 2)");
        Console.WriteLine($"  ProcessorCount     : {Environment.ProcessorCount}");
        Console.WriteLine();
        Console.WriteLine("  Every number below depends on those. A console app defaults to");
        Console.WriteLine("  workstation GC; ASP.NET Core defaults to SERVER GC, which has one");
        Console.WriteLine("  heap and one background thread per core. Measurements taken on one");
        Console.WriteLine("  do not transfer to the other, which is the single most common way");
        Console.WriteLine("  GC benchmarks mislead.");

        Console.WriteLine();
        Console.WriteLine("=== 2. allocation is a pointer bump ===");
        Console.WriteLine();
        Console.WriteLine("  Objects are allocated at the end of a contiguous region by moving a");
        Console.WriteLine("  pointer. There is no free-list search and no fragmentation on the");
        Console.WriteLine("  allocation path, which is why allocating in .NET is fast and why the");
        Console.WriteLine("  cost shows up later, at collection time.");
        Console.WriteLine();
        var before = GC.GetAllocatedBytesForCurrentThread();
        var small = new byte[24];
        var after = GC.GetAllocatedBytesForCurrentThread();
        Console.WriteLine($"  a byte[24] costs           : {after - before} bytes allocated");
        Console.WriteLine("  (24 for the payload plus the object header and method table pointer,");
        Console.WriteLine("  rounded up to the allocation granularity. Nothing you allocate costs");
        Console.WriteLine("  only its payload.)");
        GC.KeepAlive(small);

        Console.WriteLine();
        Console.WriteLine("=== 3. what a generation is ===");
        Console.WriteLine();
        Console.WriteLine("  A generation is an AGE, not a place you choose. Everything starts in");
        Console.WriteLine("  gen 0. Anything alive when gen 0 is collected is PROMOTED to gen 1;");
        Console.WriteLine("  survive a gen 1 collection and you reach gen 2, where objects are");
        Console.WriteLine("  collected rarely.");
        Console.WriteLine();
        var tracked = new byte[64];
        Console.WriteLine($"  freshly allocated          : gen {GC.GetGeneration(tracked)}");
        GC.Collect(0, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"  after one gen-0 collection : gen {GC.GetGeneration(tracked)}");
        GC.Collect(1, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"  after one gen-1 collection : gen {GC.GetGeneration(tracked)}");
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"  after one gen-2 collection : gen {GC.GetGeneration(tracked)}");
        GC.KeepAlive(tracked);
        Console.WriteLine();
        Console.WriteLine("  The object never moved generation by choice. It was promoted because");
        Console.WriteLine("  it was still reachable each time, and promotion is the ONLY way to");
        Console.WriteLine("  reach gen 2.");
        Console.WriteLine();
        Console.WriteLine("  The generational hypothesis this rests on: most objects die young.");
        Console.WriteLine("  If that holds, collecting gen 0 reclaims most of the garbage while");
        Console.WriteLine("  examining a small fraction of the heap. When it does NOT hold — when");
        Console.WriteLine("  your objects survive long enough to be promoted — you pay for the");
        Console.WriteLine("  promotion and then pay again to collect them in an older generation.");

        Console.WriteLine();
        Console.WriteLine("=== 4. what survival costs ===");
        Console.WriteLine();
        Console.WriteLine("  Two workloads allocating the SAME total bytes. One drops each object");
        Console.WriteLine("  immediately; the other keeps every object alive in a list.");
        Console.WriteLine();
        Console.WriteLine("  workload             gen0   gen1   gen2   relative time");
        Report("dies immediately", Measure(keep: false));
        Report("all survives", Measure(keep: true));
        Console.WriteLine();
        Console.WriteLine("  The collection counts are the story, and they are exact rather than");
        Console.WriteLine("  timings. Short-lived objects are collected in gen 0 and never seen");
        Console.WriteLine("  again. Surviving objects are COPIED into gen 1, then into gen 2, and");
        Console.WriteLine("  each promotion is work proportional to how much survived.");
        Console.WriteLine();
        Console.WriteLine("  So the GC charges you for what LIVES, not for what you allocate. A");
        Console.WriteLine("  million objects that die in gen 0 are close to free; a hundred");
        Console.WriteLine("  thousand that survive are not.");

        Console.WriteLine();
        Console.WriteLine("=== 5. what a collection pauses ===");
        Console.WriteLine();
        Console.WriteLine("  Mark, sweep, compact. To find what is reachable, the GC must have a");
        Console.WriteLine("  consistent view of every root — so it SUSPENDS the managed threads");
        Console.WriteLine("  while it walks them.");
        Console.WriteLine();
        Console.WriteLine("    roots    static fields, local variables on every thread's stack,");
        Console.WriteLine("             CPU registers, GC handles, the finalisation queue");
        Console.WriteLine("    mark     walk from every root, marking everything reachable");
        Console.WriteLine("    sweep    everything unmarked is garbage");
        Console.WriteLine("    compact  survivors are moved together, so allocation stays a bump");
        Console.WriteLine();
        Console.WriteLine("  Compaction is why object addresses change and why 'pinning' exists.");
        Console.WriteLine("  It is also why a gen 2 collection is expensive: moving survivors and");
        Console.WriteLine("  fixing up every reference to them is proportional to the live set.");
        Console.WriteLine();
        var (gen0Ms, gen2Ms) = PauseComparison();
        Console.WriteLine($"  forced gen 0 collection : {1.0,6:N1}x  (baseline)");
        Console.WriteLine($"  forced gen 2 collection : {gen2Ms / gen0Ms,6:N1}x");
        Console.WriteLine();
        Console.WriteLine("  Same heap. The difference is how much of it had to be examined.");

        Console.WriteLine();
        Console.WriteLine("=== 6. the counters that matter in production ===");
        Console.WriteLine();
        Console.WriteLine("    dotnet-counters monitor --process-id &lt;pid&gt; System.Runtime");
        Console.WriteLine();
        Console.WriteLine("      gen-0-gc-count      high is NORMAL and cheap");
        Console.WriteLine("      gen-1-gc-count      moderate");
        Console.WriteLine("      gen-2-gc-count      should be RARE. Rising is the alarm.");
        Console.WriteLine("      gc-heap-size        total managed heap");
        Console.WriteLine("      alloc-rate          bytes per second allocated");
        Console.WriteLine("      time-in-gc          percentage of time spent collecting");
        Console.WriteLine();
        Console.WriteLine("  The one to watch is gen-2-gc-count. Gen 0 collections are supposed to");
        Console.WriteLine("  happen constantly and cost little. A rising gen 2 count means objects");
        Console.WriteLine("  are surviving long enough to be promoted, which is either a leak or a");
        Console.WriteLine("  design that holds things longer than it needs to.");
        Console.WriteLine();
        Console.WriteLine("  time-in-gc above roughly 10% is worth investigating; above 20% the");
        Console.WriteLine("  process is spending more time collecting than most services can");
        Console.WriteLine("  afford. Read it alongside alloc-rate: high allocation with low");
        Console.WriteLine("  time-in-gc is a healthy gen 0 workload and needs no attention.");
        Console.WriteLine($"  (final counts: gen0={GC.CollectionCount(0)}, gen1={GC.CollectionCount(1)}, gen2={GC.CollectionCount(2)})");
    }

    readonly record struct Counts(int Gen0, int Gen1, int Gen2, double Ms);

    static Counts Measure(bool keep)
    {
        _keepAlive = null;
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        GC.WaitForPendingFinalizers();
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        var g0 = GC.CollectionCount(0);
        var g1 = GC.CollectionCount(1);
        var g2 = GC.CollectionCount(2);
        var sw = Stopwatch.StartNew();

        const int Objects = 400_000;
        if (keep)
        {
            var survivors = new List&lt;byte[]&gt;(Objects);
            for (var i = 0; i &lt; Objects; i++) survivors.Add(new byte[256]);
            _keepAlive = survivors;
        }
        else
        {
            byte[]? last = null;
            for (var i = 0; i &lt; Objects; i++) last = new byte[256];
            GC.KeepAlive(last);
        }
        sw.Stop();

        return new Counts(GC.CollectionCount(0) - g0,
                          GC.CollectionCount(1) - g1,
                          GC.CollectionCount(2) - g2,
                          sw.Elapsed.TotalMilliseconds);
    }

    static Counts _baseline;

    static void Report(string label, Counts c)
    {
        if (label == "dies immediately") _baseline = c;
        Console.WriteLine($"  {label,-20} {c.Gen0,5}  {c.Gen1,5}  {c.Gen2,5}   " +
                          $"{c.Ms / _baseline.Ms,13:N2}x");
    }

    static (double gen0Ms, double gen2Ms) PauseComparison()
    {
        // Build a large live set so gen 2 has real work to do.
        var live = new List&lt;byte[]&gt;(200_000);
        for (var i = 0; i &lt; 200_000; i++) live.Add(new byte[256]);
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 20; i++) GC.Collect(0, GCCollectionMode.Forced, blocking: true);
        var gen0 = sw.Elapsed.TotalMilliseconds / 20;

        sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 20; i++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var gen2 = sw.Elapsed.TotalMilliseconds / 20;

        GC.KeepAlive(live);
        return (gen0, gen2);
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-production.cs"><code>// 02-production.cs — Ledger's response cache. A 30-second TTL that guaranteed
// every entry would be promoted to gen 2 before it expired, and the static event
// handler that kept objects alive nobody could find.
//
// Collection counts and byte figures are exact. Timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime;
using System.Threading;

namespace Ledger.Caching;

public sealed record CachedResponse(string Key, byte[] Body, DateTime CachedAt);

class Program
{
    static object? _root;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger caches rendered responses for 30 seconds to take load off the");
        Console.WriteLine("  reporting database. It worked: database load dropped by two thirds.");
        Console.WriteLine();
        Console.WriteLine("  Latency got worse. p99 roughly doubled, in a pattern nobody could");
        Console.WriteLine("  correlate with anything — spikes every few seconds, on requests that");
        Console.WriteLine("  were cache HITS and should have been the fastest in the system.");
        Console.WriteLine();
        Console.WriteLine("  The cache was not slow. The cache was creating a garbage collection");
        Console.WriteLine("  problem, and the spikes were pauses.");
        Console.WriteLine();
        Console.WriteLine("  lifetime of cached objects       gen0   gen1   gen2   promoted?");

        Report("dropped immediately", Lifetime(surviveMs: 0));
        Report("held briefly (gen 0 only)", Lifetime(surviveMs: 1));
        Report("held across collections", Lifetime(surviveMs: 50));

        Console.WriteLine();
        Console.WriteLine("  Read the gen1 and gen2 columns, not a timing. The wall-clock cost of");
        Console.WriteLine("  these three runs is dominated by allocation and bookkeeping rather");
        Console.WriteLine("  than by collection, so a time ratio here would mislead — an earlier");
        Console.WriteLine("  version of this file printed one and the middle row came out FASTER");
        Console.WriteLine("  than the baseline. The collection counts are exact and are the signal.");
        Console.WriteLine();
        Console.WriteLine("  This is the MID-LIFE CRISIS, and it is the most important shape in");
        Console.WriteLine("  this module.");
        Console.WriteLine();
        Console.WriteLine("  An object that dies immediately is collected in gen 0 and costs");
        Console.WriteLine("  almost nothing. An object that lives forever is promoted once and");
        Console.WriteLine("  then ignored. The expensive case is the one in between: objects that");
        Console.WriteLine("  live JUST long enough to be promoted, and then die.");
        Console.WriteLine();
        Console.WriteLine("  You pay to copy them into gen 1, pay again to copy them into gen 2,");
        Console.WriteLine("  and then pay a gen 2 collection to reclaim them — the most expensive");
        Console.WriteLine("  collection there is (01-generations.cs measured it at hundreds of");
        Console.WriteLine("  times a gen 0). All for objects you were going to throw away.");
        Console.WriteLine();
        Console.WriteLine("  A 30-second TTL guarantees this. Nothing survives 30 seconds of");
        Console.WriteLine("  allocation in gen 0.");

        Console.WriteLine();
        Console.WriteLine("=== what actually helped ===");
        Console.WriteLine();
        Console.WriteLine("  The instinct is to make the cache bigger or the TTL longer, on the");
        Console.WriteLine("  theory that more hits means less work. It makes the GC problem worse:");
        Console.WriteLine("  more objects promoted, a larger gen 2, longer pauses.");
        Console.WriteLine();
        Console.WriteLine("  cache size    gen2 collections   heap MB   relative time");
        SizeReport("1,000 entries", CacheSize(1_000));
        SizeReport("20,000 entries", CacheSize(20_000));
        SizeReport("100,000 entries", CacheSize(100_000));
        Console.WriteLine();
        Console.WriteLine("  What helped was reducing what each entry COSTS to keep, not how long");
        Console.WriteLine("  it is kept:");
        Console.WriteLine();
        Console.WriteLine("    - cache the rendered bytes, not the object graph that produced them");
        Console.WriteLine("    - one array per entry rather than a tree of small objects, because");
        Console.WriteLine("      the GC walks references and a flat payload has none");
        Console.WriteLine("    - a hard size limit, so gen 2 has a ceiling");
        Console.WriteLine();
        var (graphMs, flatMs, graphRefs, flatRefs) = GraphVersusFlat();
        Console.WriteLine("  Comparable live BYTES, held two ways. This times the COLLECTIONS");
        Console.WriteLine("  only, with the live set already built:");
        Console.WriteLine();
        Console.WriteLine($"  as an object graph ({graphRefs,7:N0} objects) : {1.0,6:N2}x  (baseline)");
        Console.WriteLine($"  as flat arrays     ({flatRefs,7:N0} objects) : {flatMs / graphMs,6:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Roughly the same live BYTES. A hundredfold difference in OBJECT");
        Console.WriteLine("  COUNT. The collections are more than an order of magnitude cheaper,");
        Console.WriteLine("  so the cost follows the object count and not the bytes.");
        Console.WriteLine();
        Console.WriteLine("  This needs a real live set to show: at a tenth of this size the two");
        Console.WriteLine("  were indistinguishable, because fixed per-collection overhead");
        Console.WriteLine("  dominated. That is worth knowing before you benchmark your own.");
        Console.WriteLine();
        Console.WriteLine("  Marking walks references. A tree of small nodes means the GC visits");
        Console.WriteLine("  every one of them on every gen 2 collection; a byte array is one");
        Console.WriteLine("  object with no outgoing references, so it is marked once and skipped.");
        Console.WriteLine();
        Console.WriteLine("  That is the practical lesson for caching: what you keep matters less");
        Console.WriteLine("  than how many OBJECTS it is made of.");

        Console.WriteLine();
        Console.WriteLine("=== the second bug: the roots nobody could see ===");
        Console.WriteLine();
        Console.WriteLine("  A separate leak in the same service. Objects were unreachable from");
        Console.WriteLine("  any code anyone could find, and were not being collected.");
        Console.WriteLine();
        var (leaked, collected) = EventHandlerLeak();
        Console.WriteLine($"    subscribers created                    : 10,000");
        Console.WriteLine($"    still alive after a full GC            : {leaked:N0}");
        Console.WriteLine($"    collected once the event was cleared   : {collected:N0}");
        Console.WriteLine();
        Console.WriteLine("  A static event holds a reference to every subscriber. The subscriber");
        Console.WriteLine("  is 'gone' as far as your code is concerned and the event's invocation");
        Console.WriteLine("  list is a ROOT, so it and everything it references stays alive for");
        Console.WriteLine("  the life of the process.");
        Console.WriteLine();
        Console.WriteLine("  The direction is the part people get wrong. Subscribing does not make");
        Console.WriteLine("  the PUBLISHER live longer — it makes the SUBSCRIBER live as long as");
        Console.WriteLine("  the publisher. A static or long-lived publisher therefore pins every");
        Console.WriteLine("  short-lived object that ever subscribed.");
        Console.WriteLine();
        Console.WriteLine("  The rule: if the publisher outlives the subscriber, unsubscribe. In");
        Console.WriteLine("  practice that means a subscriber that implements IDisposable and");
        Console.WriteLine("  detaches in Dispose — and something that actually disposes it.");

        Console.WriteLine();
        Console.WriteLine("=== how the two were told apart ===");
        Console.WriteLine();
        Console.WriteLine("  Both raise gc-heap-size. They are distinguished by the gen 2 count and");
        Console.WriteLine("  by whether memory ever comes back:");
        Console.WriteLine();
        Console.WriteLine("    promotion pressure   heap rises and FALLS, gen2 count HIGH,");
        Console.WriteLine("                         time-in-gc high, latency spiky");
        Console.WriteLine("    a leak               heap rises and never falls, gen2 count high,");
        Console.WriteLine("                         and each collection reclaims less than the last");
        Console.WriteLine();
        Console.WriteLine("  The decisive step is a heap dump, because it answers the only question");
        Console.WriteLine("  that matters for a leak: WHAT IS HOLDING IT?");
        Console.WriteLine();
        Console.WriteLine("    dotnet-gcdump collect --process-id &lt;pid&gt;");
        Console.WriteLine("    dotnet-dump analyze &lt;file&gt;");
        Console.WriteLine("    &gt; dumpheap -stat                 what is on the heap, by type");
        Console.WriteLine("    &gt; gcroot &lt;address&gt;               what is keeping one alive");
        Console.WriteLine();
        Console.WriteLine("  gcroot is the command that ends the argument. It prints the chain from");
        Console.WriteLine("  a root to the object, so 'a static event -&gt; a delegate -&gt; your");
        Console.WriteLine("  subscriber' appears explicitly rather than being deduced.");
        Console.WriteLine();
        Console.WriteLine("  Take TWO gcdumps a few minutes apart and compare the type counts. A");
        Console.WriteLine("  type whose count only rises is the leak; a type that fluctuates is");
        Console.WriteLine("  promotion pressure, and needs a different fix.");
    }

    readonly record struct Counts(int Gen0, int Gen1, int Gen2, double Ms, double HeapMb);
    static Counts _baseline;

    /// &lt;summary&gt;
    /// Holds each object for a controlled span so it survives a controlled number
    /// of collections. surviveMs of 0 drops immediately; 50 spans several gen 0
    /// collections and forces promotion.
    /// &lt;/summary&gt;
    static Counts Lifetime(int surviveMs)
    {
        Settle();
        var g0 = GC.CollectionCount(0);
        var g1 = GC.CollectionCount(1);
        var g2 = GC.CollectionCount(2);
        var sw = Stopwatch.StartNew();

        const int Entries = 120_000;
        var window = new Queue&lt;CachedResponse&gt;();
        var holdCount = surviveMs == 0 ? 0 : surviveMs * 400;

        for (var i = 0; i &lt; Entries; i++)
        {
            var entry = new CachedResponse($"K{i}", new byte[256], DateTime.UtcNow);
            if (holdCount == 0) { GC.KeepAlive(entry); continue; }
            window.Enqueue(entry);
            if (window.Count &gt; holdCount) window.Dequeue();
        }
        sw.Stop();
        _root = window;

        return new Counts(GC.CollectionCount(0) - g0, GC.CollectionCount(1) - g1,
                          GC.CollectionCount(2) - g2, sw.Elapsed.TotalMilliseconds,
                          GC.GetTotalMemory(false) / 1024.0 / 1024.0);
    }

    static void Report(string label, Counts c)
    {
        if (label == "dropped immediately") _baseline = c;
        var promoted = c.Gen1 == 0 &amp;&amp; c.Gen2 == 0 ? "no"
                     : c.Gen2 == 0 ? "to gen 1"
                     : "to gen 2";
        Console.WriteLine($"  {label,-30} {c.Gen0,5}  {c.Gen1,5}  {c.Gen2,5}   {promoted,9}");
    }

    static Counts CacheSize(int entries)
    {
        Settle();
        var g2 = GC.CollectionCount(2);
        var sw = Stopwatch.StartNew();

        var cache = new Dictionary&lt;string, CachedResponse&gt;(entries);
        for (var i = 0; i &lt; entries; i++)
            cache[$"K{i}"] = new CachedResponse($"K{i}", new byte[512], DateTime.UtcNow);

        // Churn: replace a tenth of the cache, as expiry would.
        for (var round = 0; round &lt; 10; round++)
            for (var i = 0; i &lt; entries / 10; i++)
                cache[$"K{i}"] = new CachedResponse($"K{i}", new byte[512], DateTime.UtcNow);

        sw.Stop();
        _root = cache;
        return new Counts(0, 0, GC.CollectionCount(2) - g2, sw.Elapsed.TotalMilliseconds,
                          GC.GetTotalMemory(false) / 1024.0 / 1024.0);
    }

    static Counts _sizeBaseline;

    static void SizeReport(string label, Counts c)
    {
        if (label == "1,000 entries") _sizeBaseline = c;
        Console.WriteLine($"  {label,-14} {c.Gen2,16}   {c.HeapMb,7:N1}   " +
                          $"{c.Ms / _sizeBaseline.Ms,13:N2}x");
    }

    sealed record Node(string Name, Node? Left, Node? Right);

    /// &lt;summary&gt;
    /// Times ONLY the collections, with the live set already built. An earlier
    /// version timed construction as well, so it reported the cost of building a
    /// tree rather than the cost of marking one — the flat version came out 100x
    /// faster, which said nothing about the GC.
    /// &lt;/summary&gt;
    static (double graphMs, double flatMs, int graphRefs, int flatRefs) GraphVersusFlat()
    {
        // A live set of roughly equal BYTES, one as a reference graph and one flat.
        Settle();
        var graph = new List&lt;Node&gt;(20_000);
        for (var i = 0; i &lt; 20_000; i++) graph.Add(BuildTree(depth: 6, i));
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        var sw = Stopwatch.StartNew();
        for (var r = 0; r &lt; 10; r++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var graphMs = sw.Elapsed.TotalMilliseconds / 10;
        var graphRefs = 20_000 * 127;                 // nodes in a depth-6 binary tree
        GC.KeepAlive(graph);
        graph = null!;

        Settle();
        var flat = new List&lt;byte[]&gt;(20_000);
        for (var i = 0; i &lt; 20_000; i++) flat.Add(new byte[127 * 40]);
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        sw = Stopwatch.StartNew();
        for (var r = 0; r &lt; 10; r++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var flatMs = sw.Elapsed.TotalMilliseconds / 10;
        GC.KeepAlive(flat);

        return (graphMs, flatMs, graphRefs, 20_000);
    }

    static Node BuildTree(int depth, int seed) =&gt;
        depth == 0
            ? new Node($"leaf{seed}", null, null)
            : new Node($"n{depth}", BuildTree(depth - 1, seed), BuildTree(depth - 1, seed + 1));

    // --- the event handler leak ----------------------------------------------
    static class Bus
    {
        public static event EventHandler? Published;
        public static void Raise() =&gt; Published?.Invoke(null, EventArgs.Empty);
        public static void Clear() =&gt; Published = null;
    }

    sealed class Subscriber
    {
        private readonly byte[] _payload = new byte[1024];
        public Subscriber() =&gt; Bus.Published += OnPublished;
        public void Unsubscribe() =&gt; Bus.Published -= OnPublished;
        private void OnPublished(object? s, EventArgs e) =&gt; GC.KeepAlive(_payload);
    }

    static (int leaked, int collected) EventHandlerLeak()
    {
        Bus.Clear();
        var refs = new List&lt;WeakReference&gt;(10_000);
        var keep = new List&lt;Subscriber&gt;(10_000);

        for (var i = 0; i &lt; 10_000; i++)
        {
            var s = new Subscriber();
            refs.Add(new WeakReference(s));
            keep.Add(s);
        }

        keep.Clear();                       // nothing in OUR code references them now
        FullCollect();
        var leaked = refs.Count(r =&gt; r.IsAlive);

        Bus.Clear();                        // the only remaining reference was the event
        FullCollect();
        var stillAlive = refs.Count(r =&gt; r.IsAlive);

        return (leaked, 10_000 - stillAlive);
    }

    static void FullCollect()
    {
        for (var i = 0; i &lt; 3; i++)
        {
            GC.Collect(2, GCCollectionMode.Forced, blocking: true);
            GC.WaitForPendingFinalizers();
        }
    }

    static void Settle()
    {
        _root = null;
        FullCollect();
        Thread.Sleep(30);
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-exercises.cs"><code>// 03-exercises.cs — every answer claimed in this module's exercises, run.
// Collection counts and byte figures are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime;
using System.Threading;

class Program
{
    static object? _root;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: which generation, and why? =====");
        Console.WriteLine();
        var obj = new byte[64];
        Console.WriteLine($"    freshly allocated          : gen {GC.GetGeneration(obj)}");
        GC.Collect(0, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"    after one gen 0 collection : gen {GC.GetGeneration(obj)}");
        GC.Collect(1, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"    after one gen 1 collection : gen {GC.GetGeneration(obj)}");
        GC.KeepAlive(obj);
        Console.WriteLine();
        Console.WriteLine("  A generation is an AGE, not a place you choose. Everything starts in");
        Console.WriteLine("  gen 0; surviving a collection promotes it one level. Promotion is the");
        Console.WriteLine("  ONLY route to gen 2.");
        Console.WriteLine();
        Console.WriteLine("  The generational hypothesis this rests on is that most objects die");
        Console.WriteLine("  young. When that holds, collecting gen 0 reclaims most garbage while");
        Console.WriteLine("  examining a small part of the heap. When it does not, you pay for");
        Console.WriteLine("  promotion and then pay again to collect in an older generation.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: same bytes, different cost =====");
        Console.WriteLine();
        Console.WriteLine("  300,000 objects of 256 bytes, dropped versus kept:");
        Console.WriteLine();
        Console.WriteLine("  workload    gen0   gen1   gen2");
        var dropped = Alloc(keep: false);
        var kept = Alloc(keep: true);
        Console.WriteLine($"  dropped    {dropped.G0,5}  {dropped.G1,5}  {dropped.G2,5}");
        Console.WriteLine($"  kept       {kept.G0,5}  {kept.G1,5}  {kept.G2,5}");
        Console.WriteLine();
        Console.WriteLine("  Identical allocation. The dropped version never promotes anything and");
        Console.WriteLine("  never triggers a gen 2 collection; the kept version does both.");
        Console.WriteLine();
        Console.WriteLine("  The GC charges you for what LIVES, not for what you allocate. A high");
        Console.WriteLine("  allocation rate with everything dying in gen 0 is a healthy workload");
        Console.WriteLine("  and needs no attention at all.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: what does a gen 2 collection cost? =====");
        Console.WriteLine();
        var (g0, g2) = PauseCost();
        Console.WriteLine($"    forced gen 0 : {1.0,7:N1}x  (baseline)");
        Console.WriteLine($"    forced gen 2 : {g2 / g0,7:N1}x");
        Console.WriteLine();
        Console.WriteLine("  Same heap. The difference is how much of it must be examined: a gen 0");
        Console.WriteLine("  collection looks at the newest objects, a gen 2 collection walks");
        Console.WriteLine("  everything reachable and then compacts the survivors.");
        Console.WriteLine();
        Console.WriteLine("  Compaction is why object addresses change, why pinning exists, and why");
        Console.WriteLine("  a gen 2 pause is proportional to the LIVE SET rather than to the");
        Console.WriteLine("  garbage. Reclaiming a lot of garbage is cheap; having a lot of live");
        Console.WriteLine("  data is what costs.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: why did the cache make latency worse? =====");
        Console.WriteLine();
        Console.WriteLine("  Cached objects held for 30 seconds, versus dropped immediately:");
        Console.WriteLine();
        Console.WriteLine("  lifetime              gen1   gen2   promoted?");
        var quick = Lifetime(hold: 0);
        var mid = Lifetime(hold: 20_000);
        Console.WriteLine($"  dropped immediately  {quick.G1,5}  {quick.G2,5}   {(quick.G2 &gt; 0 ? "to gen 2" : quick.G1 &gt; 0 ? "to gen 1" : "no")}");
        Console.WriteLine($"  held across GCs      {mid.G1,5}  {mid.G2,5}   {(mid.G2 &gt; 0 ? "to gen 2" : mid.G1 &gt; 0 ? "to gen 1" : "no")}");
        Console.WriteLine();
        Console.WriteLine("  This is the MID-LIFE CRISIS. Objects that die young are free. Objects");
        Console.WriteLine("  that live forever are promoted once and then ignored. The expensive");
        Console.WriteLine("  case is in between: living just long enough to be promoted, then");
        Console.WriteLine("  dying — you pay to copy them into gen 1, again into gen 2, and then");
        Console.WriteLine("  pay a gen 2 collection to reclaim them.");
        Console.WriteLine();
        Console.WriteLine("  A 30-second TTL guarantees this shape. Nothing survives 30 seconds of");
        Console.WriteLine("  allocation without being promoted.");
        Console.WriteLine();
        Console.WriteLine("  The counter-intuitive part: making the cache BIGGER makes it worse,");
        Console.WriteLine("  because more objects are promoted and gen 2 grows. What helps is");
        Console.WriteLine("  reducing the object COUNT per entry.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: object graph or flat array? =====");
        Console.WriteLine();
        var (graphMs, flatMs, graphObjects) = GraphVsFlat();
        Console.WriteLine($"    {graphObjects,9:N0} small objects : {1.0,6:N2}x  (baseline)");
        Console.WriteLine($"    {20_000,9:N0} byte arrays   : {flatMs / graphMs,6:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Comparable live bytes; a hundredfold difference in object count; and");
        Console.WriteLine("  the collections are more than an order of magnitude cheaper.");
        Console.WriteLine();
        Console.WriteLine("  Marking walks REFERENCES. A tree of small nodes must be visited node");
        Console.WriteLine("  by node on every gen 2 collection. A byte array is one object with no");
        Console.WriteLine("  outgoing references — marked once and skipped.");
        Console.WriteLine();
        Console.WriteLine("  So when caching, what you keep matters less than how many OBJECTS it");
        Console.WriteLine("  is made of. Cache rendered bytes rather than the graph that made them.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: find the root =====");
        Console.WriteLine();
        Console.WriteLine("      public static event EventHandler? Published;");
        Console.WriteLine("      // subscriber:  Bus.Published += OnPublished;");
        Console.WriteLine();
        var (alive, freed) = EventLeak();
        Console.WriteLine($"    10,000 subscribers, all dropped by our code");
        Console.WriteLine($"    still alive after a full GC          : {alive:N0}");
        Console.WriteLine($"    freed once the event was cleared     : {freed:N0}");
        Console.WriteLine();
        Console.WriteLine("  A static event's invocation list is a GC ROOT. It holds a reference");
        Console.WriteLine("  to every subscriber, so none of them can be collected however");
        Console.WriteLine("  thoroughly your own code forgets them.");
        Console.WriteLine();
        Console.WriteLine("  The direction is what people get wrong. Subscribing does not extend");
        Console.WriteLine("  the PUBLISHER's life — it makes the SUBSCRIBER live as long as the");
        Console.WriteLine("  publisher. A static publisher therefore pins every short-lived object");
        Console.WriteLine("  that ever subscribed, along with everything each one references.");
        Console.WriteLine();
        Console.WriteLine("  The rule: if the publisher outlives the subscriber, unsubscribe —");
        Console.WriteLine("  which in practice means implementing IDisposable and detaching there.");
        Console.WriteLine();
        Console.WriteLine("  How you would find it in production:");
        Console.WriteLine("    dotnet-gcdump collect --process-id &lt;pid&gt;     (twice, minutes apart)");
        Console.WriteLine("    &gt; dumpheap -stat        compare type counts between the two");
        Console.WriteLine("    &gt; gcroot &lt;address&gt;      the chain from a root to the object");
        Console.WriteLine();
        Console.WriteLine("  gcroot is the command that ends the argument: it prints the reference");
        Console.WriteLine("  chain explicitly, so 'static event -&gt; delegate -&gt; subscriber' appears");
        Console.WriteLine("  as evidence rather than as a theory.");
    }

    readonly record struct Gens(int G0, int G1, int G2);

    static Gens Alloc(bool keep)
    {
        Settle();
        int g0 = GC.CollectionCount(0), g1 = GC.CollectionCount(1), g2 = GC.CollectionCount(2);

        List&lt;byte[]&gt;? held = keep ? new List&lt;byte[]&gt;(300_000) : null;
        for (var i = 0; i &lt; 300_000; i++)
        {
            var b = new byte[256];
            if (held is not null) held.Add(b); else GC.KeepAlive(b);
        }
        _root = held;

        return new Gens(GC.CollectionCount(0) - g0, GC.CollectionCount(1) - g1,
                        GC.CollectionCount(2) - g2);
    }

    static Gens Lifetime(int hold)
    {
        Settle();
        int g1 = GC.CollectionCount(1), g2 = GC.CollectionCount(2);

        var window = new Queue&lt;byte[]&gt;();
        for (var i = 0; i &lt; 200_000; i++)
        {
            var b = new byte[256];
            if (hold == 0) { GC.KeepAlive(b); continue; }
            window.Enqueue(b);
            if (window.Count &gt; hold) window.Dequeue();
        }
        _root = window;

        return new Gens(0, GC.CollectionCount(1) - g1, GC.CollectionCount(2) - g2);
    }

    static (double g0, double g2) PauseCost()
    {
        Settle();
        var live = new List&lt;byte[]&gt;(200_000);
        for (var i = 0; i &lt; 200_000; i++) live.Add(new byte[256]);
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 20; i++) GC.Collect(0, GCCollectionMode.Forced, blocking: true);
        var g0 = sw.Elapsed.TotalMilliseconds / 20;

        sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; 20; i++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var g2 = sw.Elapsed.TotalMilliseconds / 20;

        GC.KeepAlive(live);
        _root = live;
        return (g0, g2);
    }

    sealed record Node(string Name, Node? Left, Node? Right);

    static Node BuildTree(int depth, int seed) =&gt;
        depth == 0 ? new Node($"l{seed}", null, null)
                   : new Node($"n{depth}", BuildTree(depth - 1, seed), BuildTree(depth - 1, seed + 1));

    static (double graphMs, double flatMs, int graphObjects) GraphVsFlat()
    {
        Settle();
        var graph = new List&lt;Node&gt;(20_000);
        for (var i = 0; i &lt; 20_000; i++) graph.Add(BuildTree(6, i));
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        var sw = Stopwatch.StartNew();
        for (var r = 0; r &lt; 10; r++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var graphMs = sw.Elapsed.TotalMilliseconds / 10;
        GC.KeepAlive(graph);
        graph = null!;

        Settle();
        var flat = new List&lt;byte[]&gt;(20_000);
        for (var i = 0; i &lt; 20_000; i++) flat.Add(new byte[127 * 40]);
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        sw = Stopwatch.StartNew();
        for (var r = 0; r &lt; 10; r++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var flatMs = sw.Elapsed.TotalMilliseconds / 10;
        GC.KeepAlive(flat);
        _root = flat;

        return (graphMs, flatMs, 20_000 * 127);
    }

    static class Bus
    {
        public static event EventHandler? Published;
        public static void Clear() =&gt; Published = null;
        public static int Count =&gt; Published?.GetInvocationList().Length ?? 0;
    }

    sealed class Subscriber
    {
        private readonly byte[] _payload = new byte[512];
        public Subscriber() =&gt; Bus.Published += OnPublished;
        private void OnPublished(object? s, EventArgs e) =&gt; GC.KeepAlive(_payload);
    }

    static (int alive, int freed) EventLeak()
    {
        Bus.Clear();
        var refs = new List&lt;WeakReference&gt;(10_000);
        var keep = new List&lt;Subscriber&gt;(10_000);
        for (var i = 0; i &lt; 10_000; i++)
        {
            var s = new Subscriber();
            refs.Add(new WeakReference(s));
            keep.Add(s);
        }

        keep.Clear();
        FullCollect();
        var alive = refs.Count(r =&gt; r.IsAlive);

        Bus.Clear();
        FullCollect();
        var stillAlive = refs.Count(r =&gt; r.IsAlive);
        return (alive, 10_000 - stillAlive);
    }

    static void FullCollect()
    {
        for (var i = 0; i &lt; 3; i++)
        {
            GC.Collect(2, GCCollectionMode.Forced, blocking: true);
            GC.WaitForPendingFinalizers();
        }
    }

    static void Settle()
    {
        _root = null;
        FullCollect();
        Thread.Sleep(25);
    }
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is a generation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>An <strong>age</strong>, not a place you choose. Everything starts in gen 0; surviving a
        collection promotes it one level. Promotion is the only route to gen 2 — verified,
        0 → 1 → 2 across three forced collections.</p>
      </div></details>
    </li>
    <li>
      <p>What does the GC charge you for?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>What lives, not what you allocate.</strong> Measured: identical allocation produced
        26/0/0 collections when dropped and 14/7/2 when kept. Allocation is a pointer bump.</p>
      </div></details>
    </li>
    <li>
      <p>What is a root?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A reference the collector starts from: static fields, locals on every thread's stack, CPU
        registers, GC handles, and the finalisation queue. Anything reachable from one is alive,
        however irrelevant to your program.</p>
      </div></details>
    </li>
    <li>
      <p>Why does a collection pause the application?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>To trace roots consistently it must suspend the managed threads while walking their stacks
        and registers. The pause is the <strong>looking</strong>, not the reclaiming — and compaction
        then moves survivors, which is why addresses change.</p>
      </div></details>
    </li>
    <li>
      <p>Roughly how much more expensive is a gen 2 collection, and what sets that?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Measured at <strong>122×</strong> a gen 0 on one heap — but the multiple is set by how much
        <strong>survives</strong>, not by how much garbage there is. A full heap of garbage collects
        quickly.</p>
      </div></details>
    </li>
    <li>
      <p>What is the mid-life crisis?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Objects living only long enough to be <strong>promoted</strong>, then dying. You pay to copy
        them into gen 1, again into gen 2, then pay a gen 2 collection to reclaim them. A seconds-long
        cache TTL guarantees it.</p>
      </div></details>
    </li>
    <li>
      <p>Does the collector care about bytes or objects?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Objects</strong>, because marking walks references. Comparable live bytes as
        2.5 million small objects versus 20,000 arrays differed by more than an order of magnitude in
        collection time.</p>
      </div></details>
    </li>
    <li>
      <p>Which counter is the alarm, and which is a red herring?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Alarm: <code>gen-2-gc-count</code> rising, with <code>time-in-gc</code> above ~10%. Red
        herring: a high <code>gen-0-gc-count</code> or <code>alloc-rate</code> — frequent cheap gen 0
        collections are the design working.</p>
      </div></details>
    </li>
    <li>
      <p>How do you tell promotion pressure from a leak?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Whether memory <strong>comes back</strong>. Pressure: heap rises and falls, gen 2 count high.
        Leak: heap rises and never falls, each collection reclaiming less. Two gcdumps minutes apart
        settle it — a count that only rises is a leak.</p>
      </div></details>
    </li>
    <li>
      <p>Which way does an event subscription extend a lifetime?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It keeps the <strong>subscriber</strong> alive as long as the publisher, not the other way
        round. Verified: 10,000 subscribers with no application reference, none collectable until the
        static event was cleared. <code>gcroot</code> shows the chain.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
