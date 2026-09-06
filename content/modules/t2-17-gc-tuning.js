CSPREP.module({
  id: "t2-17-gc-tuning",
  minutes: 55,
  updated: "2026-09-01",
  summary: "A buffer of 100,000 bytes and one of 80,000 bytes look like the same decision. Measured: the smaller one caused 500 gen 0 collections and no gen 2 collections; the larger caused 3,240 gen 0, 3,240 gen 1 and 540 gen 2, for 25% more bytes. The line is at 85,000 bytes of total object size, header included, and above it objects are born in gen 2 on a heap that is never compacted by default - which is how a service throws OutOfMemoryException with gigabytes free.",
  terms: ["large object heap", "small object heap", "LOH threshold", "object header",
    "fragmentation", "contiguous allocation", "compaction", "LargeObjectHeapCompactionMode",
    "allocation rate", "survival rate", "allocation pressure", "workstation GC", "server GC",
    "background GC", "DATAS", "GCSettings", "latency mode", "working set", "committed memory",
    "ArrayPool", "pinned object heap"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger exports every invoice for the month as a CSV file. The code had not changed in a year.
  It ran on the first of the month, took about a minute, and nobody thought about it.</p>

  <p>In March it failed with an <code>OutOfMemoryException</code>. The server had 16 GB of memory and
  was using under 3 GB of it. The process had not leaked: restart it and the export ran fine. Run it
  again later the same day and it failed again.</p>

  <p>The obvious readings were all wrong. It was not a leak, because everything was released. It was
  not the machine running out of memory, because the machine had plenty. It was not a slow growth in
  data volume, because February had more invoices than March and February had worked.</p>

  <p>What had happened is that the export asked for <strong>one contiguous 64 MB block</strong>, and
  the region of memory it had to come from was full of holes. The total free space was far more than
  64 MB. There was no single run of 64 MB anywhere in it.</p>

  <p>That region is the large object heap, and it behaves differently from the rest of the managed
  heap in three ways that together produce this failure. Objects go there based on a size threshold
  nobody remembers exactly. They are created in the oldest generation, so only the most expensive kind
  of collection reclaims them. And the runtime does not tidy that region up unless you ask it to.</p>

  <p>The fix was four lines and made the export faster as well as reliable. But the more useful
  outcome was a rule the team could apply everywhere else, because the same threshold had been quietly
  costing them on three other code paths. Here is the measurement that produced the rule:</p>

  <pre data-lang="console" data-title="08-minimal-example.cs"><code>byte[80,000] x 20,000  : gen0   500, gen2     0,     67 ms
byte[100,000] x 20,000 : gen0  3240, gen2   540,    138 ms</code></pre>

  <p>Same loop, same number of buffers, same work done to each one. The second version asks for
  <strong>25% more bytes</strong> and pays <strong>540 gen 2 collections</strong> where the first
  paid none. Nothing in the source code suggests those two lines are different in kind.</p>

  <p>This module is about where that line is, why it exists, what happens on each side of it, and the
  two other knobs — the collector mode and the adaptive heap sizing — that change the answer by more
  than any code you will write.</p>
</section>

<section id="plain-language">
  <h2>Two heaps, and why there are two</h2>

  <p class="define"><span class="define__term">Heap</span> The region of memory where objects live.
  You do not free anything on it by hand; the runtime reclaims what it can prove nothing is using.</p>

  <p class="define"><span class="define__term">Allocate</span> To obtain memory for a new object. In
  .NET this normally costs almost nothing — the runtime keeps a pointer to the next free byte and
  moves it along. The expense comes later, when something has to work out what is still in use.</p>

  <p class="define"><span class="define__term">Generation</span> An age band, not a place you choose.
  New objects start in generation 0. Survive a collection and you are <em>promoted</em> to generation
  1, then to generation 2, which is collected rarely because collecting it means examining everything.</p>

  <p class="define"><span class="define__term">Small object heap (SOH)</span> Where objects under the
  size threshold live. It is divided into the three generations, and it is <strong>compacted</strong>
  — after a collection the survivors are slid together so the free space is one continuous run.</p>

  <p class="define"><span class="define__term">Large object heap (LOH)</span> A separate region for
  objects at or above 85,000 bytes. Objects here are treated as generation 2 from birth, and the
  region is <strong>swept but not compacted</strong> by default: dead objects are marked as free
  space, and the free space stays exactly where it was.</p>

  <p class="define"><span class="define__term">Compaction</span> Moving surviving objects so they sit
  next to each other, eliminating the gaps between them. It is what makes allocation a pointer bump,
  and it is expensive because every reference to a moved object has to be updated.</p>

  <p class="define"><span class="define__term">Fragmentation</span> Free memory that exists but is
  broken into pieces too small to satisfy a request. A heap can be 89% free and unable to hand out a
  single large block.</p>

  <p class="define"><span class="define__term">Contiguous allocation</span> A request for memory that
  must be one unbroken run of bytes. Every .NET array is one: <code>new byte[64_000_000]</code> needs
  64 MB in a row, not 64 MB in total.</p>

  <h3>Why the runtime splits them</h3>

  <p>Compaction means copying. Copying a 40-byte object is a handful of instructions. Copying a 60 MB
  array is a memory-bandwidth operation that happens while every thread in your process is stopped.</p>

  <p>So the runtime makes a bet: objects that big are rare, they are usually long-lived buffers, and
  the cost of moving them exceeds the cost of living with the gaps. That bet is correct for the
  workload it was designed around and wrong for a service that allocates large buffers per request —
  which is the situation almost every failure in this module comes from.</p>

  <p><strong>An analogy, and its limits.</strong> Think of a bookshelf and a floor. Paperbacks go on
  the shelf; when you remove some, you push the rest along and the shelf is tidy again. Furniture goes
  on the floor. When you take a wardrobe out you are left with a wardrobe-shaped gap, and nobody
  reshuffles the room. Eventually the floor is mostly gaps, and a new sofa will not fit anywhere even
  though most of the floor is empty.</p>

  <p><strong>Where the analogy breaks:</strong> you can see the whole room and plan. The allocator
  cannot. It walks a list of gaps looking for the first one big enough, and if none is, it asks the
  operating system for more address space rather than rearranging what it has. It has no concept of
  "this room is getting silly" — which is why the failure arrives suddenly rather than gradually.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>There is a third region, the <strong>pinned object heap (POH)</strong>, added in .NET 5, for
    objects that must never move because unmanaged code holds their address. It shows up as index 4 in
    <code>GCMemoryInfo.GenerationInfo</code>. It is not covered further here beyond knowing what the
    row means when you read that array.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="08-minimal-example.cs"><code>// 08-minimal-example.cs — The whole module in one screen: 25% more bytes moves a
// buffer onto a heap that is never compacted, and the collection profile changes
// completely.
//
// Run:  dotnet run 08-minimal-example.cs -c Release

using System.Diagnostics;

// 24 bytes of header on 64-bit, so the last byte[] that stays on the normal
// heap has 84,975 elements.
Console.WriteLine($"byte[84,975] -&gt; gen {GC.GetGeneration(new byte[84_975])}   (84,999 bytes total)");
Console.WriteLine($"byte[84,976] -&gt; gen {GC.GetGeneration(new byte[84_976])}   (85,000 bytes total)");
Console.WriteLine();

Measure(80_000);
Measure(100_000);

Console.WriteLine();
Console.WriteLine("Same loop, same work, 25% more bytes per buffer.");
Console.WriteLine("Below the threshold the buffers die in gen 0 and cost nothing.");
Console.WriteLine("Above it they are born in gen 2 and only a full collection frees them.");

static void Measure(int size)
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    int gen0 = GC.CollectionCount(0);
    int gen2 = GC.CollectionCount(2);
    var sw = Stopwatch.StartNew();

    long sink = 0;
    for (int i = 0; i &lt; 20_000; i++)
    {
        var buffer = new byte[size];
        buffer[0] = (byte)i;
        sink += buffer[0];
    }

    sw.Stop();
    Console.WriteLine($"byte[{size:N0}] x 20,000 : " +
        $"gen0 {GC.CollectionCount(0) - gen0,5}, gen2 {GC.CollectionCount(2) - gen2,5}, " +
        $"{sw.Elapsed.TotalMilliseconds,6:F0} ms   (sink {sink})");
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>byte[84,975] -&gt; gen 0   (84,999 bytes total)
byte[84,976] -&gt; gen 2   (85,000 bytes total)

byte[80,000] x 20,000  : gen0   500, gen2     0,     67 ms   (sink 2546416)
byte[100,000] x 20,000 : gen0  3240, gen2   540,    138 ms   (sink 2546416)

Same loop, same work, 25% more bytes per buffer.
Below the threshold the buffers die in gen 0 and cost nothing.
Above it they are born in gen 2 and only a full collection frees them.</code></pre>

  <p>Two facts, both worth holding onto.</p>

  <p><strong>The boundary is not where the round number is.</strong> An array of 84,975 bytes stays on
  the normal heap; 84,976 does not. The threshold applies to the <em>total object size</em>, and an
  array on 64-bit carries 24 bytes of overhead before any of your data.</p>

  <p><strong>Crossing it changes the cost by a factor, not a percentage.</strong> Twenty thousand
  buffers of 80,000 bytes produced 500 generation 0 collections and nothing else. The same count at
  100,000 bytes produced 3,240 generation 0 collections and <strong>540 generation 2 collections</strong>,
  each of which examines the entire heap.</p>
</section>

<section id="the-threshold">
  <h2>Exactly where the line is</h2>

  <p class="define"><span class="define__term">Object header</span> Bookkeeping the runtime stores
  with every object, before your fields. On 64-bit .NET it is 16 bytes for any object — 8 for the
  sync block index, 8 for the method table pointer — plus 8 more for an array, which stores its
  length. So an array costs <strong>24 bytes</strong> beyond its elements.</p>

  <p class="define"><span class="define__term">LOH threshold</span> 85,000 bytes of total object size,
  header included. At or above it, the object is allocated on the large object heap. The value is
  configurable through <code>GCLOHThreshold</code>, but changing it is rare and the default is what
  every other piece of advice assumes.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-loh.cs"><code>static void Threshold()
{
    Console.WriteLine("1. The threshold is 85,000 bytes of TOTAL OBJECT SIZE");
    Console.WriteLine("   (not 85,000 elements, and not the payload alone)");
    Console.WriteLine();
    Console.WriteLine("   array            header   total     generation");

    foreach (int n in new[] { 84_974, 84_975, 84_976, 84_977 })
    {
        var a = new byte[n];
        // 24 bytes on 64-bit: 8 sync block + 8 method table pointer + 8 length.
        int total = n + 24;
        Console.WriteLine($"   byte[{n:N0}]     24       {total:N0}    gen {GC.GetGeneration(a)}");
    }

    Console.WriteLine();
    Console.WriteLine("   The last array that stays on the normal heap is byte[84,975],");
    Console.WriteLine("   because 84,975 + 24 = 84,999. One more element crosses the line.");
    Console.WriteLine();

    // The same boundary for a wider element type lands on a different count.
    Console.WriteLine("   Same threshold, different element size:");
    foreach (int n in new[] { 10_621, 10_622 })
    {
        var d = new double[n];
        Console.WriteLine($"   double[{n:N0}]     payload {n * 8:N0}, total {n * 8 + 24:N0}  gen {GC.GetGeneration(d)}");
    }
    Console.WriteLine();
    Console.WriteLine("   A double[] crosses at 10,622 elements. Counting elements instead of");
    Console.WriteLine("   bytes is how a buffer size ends up over the line by accident.");
    Console.WriteLine();
}</code></pre>

  <pre data-lang="console" data-title="01-loh.cs"><code>1. The threshold is 85,000 bytes of TOTAL OBJECT SIZE
   (not 85,000 elements, and not the payload alone)

   array            header   total     generation
   byte[84,974]     24       84,998    gen 0
   byte[84,975]     24       84,999    gen 0
   byte[84,976]     24       85,000    gen 2
   byte[84,977]     24       85,001    gen 2

   The last array that stays on the normal heap is byte[84,975],
   because 84,975 + 24 = 84,999. One more element crosses the line.

   Same threshold, different element size:
   double[10,621]     payload 84,968, total 84,992  gen 0
   double[10,622]     payload 84,976, total 85,000  gen 2</code></pre>

  <p>The element count at which you cross depends on the element type, which is the part that catches
  people. Here are the four common ones, measured:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Element type</th><th>Largest count off the LOH</th><th>Total bytes</th><th>One more</th></tr>
      </thead>
      <tbody>
        <tr><td><code>byte</code></td><td>84,975</td><td>84,999</td><td>gen 2</td></tr>
        <tr><td><code>int</code></td><td>21,243</td><td>84,996</td><td>gen 2</td></tr>
        <tr><td><code>long</code></td><td>10,621</td><td>84,992</td><td>gen 2</td></tr>
        <tr><td><code>double</code></td><td>10,621</td><td>84,992</td><td>gen 2</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>A buffer sized "about 21,000 integers" or "roughly 10,000 doubles" is sitting one rounding
    decision away from the large object heap, and nothing in the code says so. The number
    <code>1024 * 21</code> is 21,504 — over the line. <code>1024 * 20</code> is 20,480 — under it.</p>
    <p>If you take one habit from this module: <strong>size buffers in bytes and check the arithmetic
    against 85,000</strong>, rather than picking a round element count.</p>
  </div>

  <h3>Born in generation 2</h3>

  <p>A large object is not promoted into generation 2. It starts there. Measured across three forced
  collections, the generation never changes:</p>

  <pre data-lang="console" data-title="07-exercises.cs"><code>Exercise 2: does a large object ever get promoted?

   at allocation        : gen 2
   after collection 1   : gen 2
   after collection 2   : gen 2
   after collection 3   : gen 2</code></pre>

  <p>This is the mechanism behind the headline measurement. A short-lived 1 KB buffer is reclaimed by
  a generation 0 collection, which examines a small region and is cheap. A short-lived 100 KB buffer
  can only be reclaimed by a generation 2 collection, which examines everything. <strong>The lifetime
  is identical; the cost is not.</strong></p>
</section>

<section id="fragmentation">
  <h2>Fragmentation, and the failure it produces</h2>

  <p>The large object heap is swept, not compacted. Dead objects become free space in place. If the
  live objects around them stay put, the free space stays broken up.</p>

  <p>Here is that reproduced deliberately — allocate in pairs, keep one of each pair, so every dead
  object leaves a hole between two survivors:</p>

  <pre data-lang="csharp" data-net="10" data-title="01-loh.cs"><code>static void Fragmentation()
{
    Console.WriteLine("3. Fragmentation: the LOH is not compacted by default");
    Console.WriteLine();

    // Allocate in pairs and keep only one of each pair. Every dropped array
    // leaves a ~100 KB hole between two survivors.
    var survivors = new List&lt;byte[]&gt;(400);
    for (int i = 0; i &lt; 400; i++)
    {
        var keep = new byte[100_000];
        var drop = new byte[100_000];
        drop[0] = 1;              // touch it so it cannot be optimised away
        survivors.Add(keep);
    }

    Collect();
    var before = GC.GetGCMemoryInfo().GenerationInfo[3];

    Console.WriteLine("   after alternating allocation");
    Console.WriteLine($"     LOH size          : {before.SizeAfterBytes:N0} bytes");
    Console.WriteLine($"     LOH fragmentation : {before.FragmentationAfterBytes:N0} bytes");
    Console.WriteLine($"     wasted            : {100.0 * before.FragmentationAfterBytes / before.SizeAfterBytes:F1}% of the heap");
    Console.WriteLine();</code></pre>

  <pre data-lang="console" data-title="01-loh.cs"><code>3. Fragmentation: the LOH is not compacted by default

   after alternating allocation
     LOH size          : 53,985,176 bytes
     LOH fragmentation : 13,975,576 bytes
     wasted            : 25.9% of the heap

   after LargeObjectHeapCompactionMode.CompactOnce
     LOH size          : 40,022,400 bytes
     LOH fragmentation : 12,800 bytes

   fragmentation fell 1,092x; heap shrank by 13.3 MB</code></pre>

  <p>A quarter of that heap was free space that could not be handed out. Ledger's real export produced
  a worse ratio, because the abandoned blocks were larger:</p>

  <pre data-lang="console" data-title="06-production.cs"><code>reproduced: LOH 230.3 MB holding 22.9 MB of live data,
            204.4 MB fragmented (89% waste)</code></pre>

  <p><strong>230 MB of address space holding 23 MB of data.</strong> Every byte of the difference is
  free and none of it is usable for a large request.</p>

  <h3>Why a growing buffer is the worst possible shape</h3>

  <p>A <code>MemoryStream</code> or a <code>List&lt;T&gt;</code> grows by doubling: allocate a new
  array twice the size, copy, abandon the old one. On the small object heap that is fine, because
  compaction reclaims the abandoned arrays into usable space. On the large object heap each abandoned
  array leaves a hole of its exact size, and every subsequent request is <em>larger than every hole
  that exists</em>.</p>

  <pre data-lang="console" data-title="06-production.cs"><code>2. The growth pattern that fragments the heap

   capacity      on LOH?   abandoned bytes
        64 KB      no                    -
       128 KB      yes              128 KB
       256 KB      yes              256 KB
       512 KB      yes              512 KB
     1,024 KB      yes            1,024 KB
     2,048 KB      yes            2,048 KB
     4,096 KB      yes            4,096 KB
     8,192 KB      yes            8,192 KB
    16,384 KB      yes           16,384 KB
    32,768 KB      yes           32,768 KB
    65,536 KB      yes                   -

   total abandoned on the LOH to reach 64 MB: 64 MB</code></pre>

  <p>Reaching a 64 MB buffer abandons 64 MB along the way, in nine blocks, none of which can hold the
  next request. This is the precise mechanism behind Ledger's March failure, and it is why the failure
  was intermittent: it depended on what else had been allocated first.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>An export service running four concurrent exports of 64 MB each needs 256 MB of live buffers
    and, on this growth pattern, abandons another 256 MB into holes. Measured at 89% waste, a 512 MB
    container limit is exceeded by a workload whose live data is 23 MB.</p>
    <p>The symptom the on-call engineer sees is <code>OutOfMemoryException</code> — or, in a
    container, the process disappearing with exit code 137 and no exception at all, because the kernel
    killed it. Neither points at the code that caused it.</p>
  </div>

  <h3>Recovering the space</h3>

  <p class="define"><span class="define__term">LargeObjectHeapCompactionMode</span> A property on
  <code>GCSettings</code> that asks the next blocking generation 2 collection to compact the large
  object heap as well. It is a one-shot: it resets to its default after that single collection.</p>

  <p>An ordinary generation 2 collection does not help. Measured directly:</p>

  <pre data-lang="console" data-title="07-exercises.cs"><code>Exercise 5: recovering a fragmented LOH

   fragmented   : size   105.6 MB   fragmentation    79.8 MB
   plain gen 2  : size   105.6 MB   fragmentation    79.8 MB
   compacted    : size    25.8 MB   fragmentation     0.0 MB</code></pre>

  <p><strong>The plain generation 2 collection changed nothing.</strong> Not the size, not the
  fragmentation — the dead objects were already free space, and freeing them again does nothing. Only
  the compacting collection returned the 80 MB.</p>

  <pre data-lang="csharp" data-net="10" data-title="Recovering a fragmented LOH"><code>using System.Runtime;

// Ask the next blocking gen 2 collection to compact the LOH as well.
// This resets itself afterwards; there is no permanent equivalent.
GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce;
GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: true);</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>This is a repair tool, not a configuration setting. It stops every thread and copies the
    surviving large objects one at a time — exactly the work the collector avoids by default.</p>
    <p>Reach for it when you have a known, bounded event that leaves the heap fragmented: after a
    batch import, on a scheduled maintenance tick, when a tenant is unloaded. Calling it on a timer
    "to keep memory tidy" converts a memory problem into a latency problem.</p>
    <p>The real fix is almost always to stop producing the fragmentation, which the rest of this
    module is about.</p>
  </div>
</section>

<section id="allocation-pressure">
  <h2>Allocation pressure: the number that is not the problem</h2>

  <p class="define"><span class="define__term">Allocation rate</span> How many bytes per second your
  process allocates. It determines how <em>often</em> a generation 0 collection happens.</p>

  <p class="define"><span class="define__term">Survival rate</span> The fraction of allocated objects
  still reachable when a collection runs. It determines how <em>much each collection costs</em>.</p>

  <p class="define"><span class="define__term">Allocation pressure</span> The combination of the two.
  Used loosely to mean "the GC is doing too much work", which is why it is worth splitting into its
  two independent causes.</p>

  <p>These are routinely conflated, and the conflation sends people to optimise the wrong thing. Here
  is the same allocation volume — 400,000 objects of 200 bytes — at five different survival rates:</p>

  <pre data-lang="console" data-title="02-allocation-pressure.cs"><code>1. Same bytes allocated, different fractions kept alive

   The COUNTS below are deterministic: they are identical on every run.
   The pause column is not, because the 0% baseline is sub-millisecond.

   survives   gen0   gen1   gen2   pause total
   --------   ----   ----   ----   -----------
        0%     28      0      0        0.4 ms
        1%     28      6      6        3.8 ms
       10%     15      4      2       15.4 ms
       50%     16      6      2       62.5 ms
      100%     17     10      4       64.0 ms</code></pre>

  <p><strong>Identical allocation volume in every row.</strong> Pause time spans from 0.4 ms to 64 ms
  — more than two orders of magnitude — with no change whatsoever in how much was allocated.</p>

  <p>Now read the generation 0 column, which is the counter-intuitive part. It <em>falls</em> as
  survival rises: 28 collections at 0% survival, 15 to 17 at every higher rate. Fewer collections,
  vastly more pause time. The collector grows the generation 0 budget when it sees survivors
  accumulating, so it runs less often and each run has more to do.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>A dashboard showing only "GC collections per minute" would report the 100% row as the
    healthiest of the five. It is the worst. Collection <em>count</em> falling is not evidence of
    improvement; it is equally consistent with a heap that has grown.</p>
    <p>Graph pause time, or the percentage of wall-clock time spent paused. Those cannot mislead you
    in this direction.</p>
  </div>

  <p>The practical consequence is an ordering rule. Given a service with a GC problem, the first
  question is not "how do I allocate less?" but <strong>"what is surviving generation 0, and why?"</strong>
  A service allocating 14 GB an hour where everything dies young is healthy and needs no work at all.</p>

  <h3>Two fixes, measured against each other</h3>

  <pre data-lang="console" data-title="07-exercises.cs"><code>Exercise 4: halve the allocations, or halve what survives?

   variant                        gen0   gen1   gen2   pause
   -------                        ----   ----   ----   -----
   baseline                         21      6      3    61.5 ms
   half the allocations             11      3      2    34.8 ms
   half the survival rate           21      6      3    44.6 ms</code></pre>

  <p>These reach a similar pause reduction by different routes. Halving the allocations halves every
  <em>count</em>. Halving the survival rate leaves the counts <strong>completely unchanged</strong>
  and still cuts the pause, because each collection has less to trace and copy.</p>

  <p>Prefer the survival fix, for a reason that is about your code rather than the collector: halving
  allocations usually means doing less work or writing more awkward code, while halving survival
  usually means holding data for a shorter time — releasing a reference earlier, shrinking a cache
  window, not keeping a parsed request around after you are done with it. That is normally free.</p>

  <h3>Reading the numbers from inside the process</h3>

  <pre data-lang="csharp" data-net="10" data-title="02-allocation-pressure.cs"><code>static void PauseTimeIsObservable()
{
    Console.WriteLine("2. What you can read from inside the process");
    Console.WriteLine();

    Collect();
    TimeSpan pauseBefore = GC.GetTotalPauseDuration();
    var sw = Stopwatch.StartNew();

    // A workload that promotes: a rolling window of live objects.
    var window = new byte[20_000][];
    for (int i = 0; i &lt; 600_000; i++)
    {
        var b = new byte[300];
        b[0] = (byte)i;
        window[i % window.Length] = b;      // evicts the entry 20,000 allocations ago
    }

    sw.Stop();
    TimeSpan pause = GC.GetTotalPauseDuration() - pauseBefore;

    var info = GC.GetGCMemoryInfo();

    Console.WriteLine($"   wall clock                     : {sw.Elapsed.TotalMilliseconds:F1} ms");
    Console.WriteLine($"   GC.GetTotalPauseDuration()     : {pause.TotalMilliseconds:F1} ms");
    Console.WriteLine($"   share of wall clock spent paused: {100.0 * pause.TotalMilliseconds / sw.Elapsed.TotalMilliseconds:F1}%");
    Console.WriteLine();
    Console.WriteLine($"   GC.GetTotalAllocatedBytes()    : {GC.GetTotalAllocatedBytes(precise: true) / 1024.0 / 1024.0:F1} MB");
    Console.WriteLine($"   GC.GetTotalMemory(false)       : {GC.GetTotalMemory(false) / 1024.0 / 1024.0:F1} MB");
    Console.WriteLine();
    Console.WriteLine($"   info.PauseTimePercentage       : {info.PauseTimePercentage:F2}%");
    Console.WriteLine($"   info.Generation (last GC gen)  : {info.Generation}");
    Console.WriteLine($"   info.Compacted                 : {info.Compacted}");
    Console.WriteLine($"   info.Concurrent                : {info.Concurrent}");
    Console.WriteLine();</code></pre>

  <pre data-lang="console" data-title="02-allocation-pressure.cs"><code>2. What you can read from inside the process

   wall clock                     : 107.5 ms
   GC.GetTotalPauseDuration()     : 64.1 ms
   share of wall clock spent paused: 59.6%

   GC.GetTotalAllocatedBytes()    : 620.1 MB
   GC.GetTotalMemory(false)       : 11.7 MB

   info.PauseTimePercentage       : 16.84%
   info.Generation (last GC gen)  : 1
   info.Compacted                 : False
   info.Concurrent                : False

   generation   size after      fragmentation
   gen 0                   0               0
   gen 1           6,291,664          36,720
   gen 2           6,915,032       5,424,176
   LOH               160,056              32
   POH                 8,184               0</code></pre>

  <p class="define"><span class="define__term">Working set</span> The physical memory the operating
  system currently has mapped for your process. This is what a container memory limit is measured
  against and what a monitoring agent usually reports.</p>

  <p class="define"><span class="define__term">Committed memory</span> Address space the runtime has
  claimed from the OS and may write to. Always at least the heap size, usually more, and the number
  that grows when the collector decides to keep headroom.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>GC.GetTotalAllocatedBytes()</code> is <strong>cumulative</strong> and only ever rises.
    <code>GC.GetTotalMemory()</code> is the <strong>current live size</strong>. Above they read
    620.1 MB and 11.7 MB for the same process at the same instant.</p>
    <p>Charting the first one and calling it "memory usage" produces a graph that climbs forever on a
    perfectly healthy service, and it is one of the most common ways a team convinces itself it has a
    leak. A healthy service has a huge allocation total and a flat live size.</p>
  </div>

  <h3>Bytes per request</h3>

  <p>The metric worth putting on a dashboard for a web service is allocation per request, because it
  is comparable across deployments and it projects:</p>

  <pre data-lang="console" data-title="02-allocation-pressure.cs"><code>3. Bytes per request, and what it projects to

   allocated per request : 832 bytes

   requests/sec   allocation rate
            100        0.1 MB/s   (0.3 GB/hour)
          1,000        0.8 MB/s   (2.8 GB/hour)
          5,000        4.0 MB/s   (13.9 GB/hour)</code></pre>

  <p>Measure it with two calls to <code>GC.GetTotalAllocatedBytes</code> around a known number of
  operations. A regression in this number is visible long before it becomes a latency problem, and it
  attributes cleanly to the change that caused it.</p>
</section>

<section id="gc-modes">
  <h2>Workstation, server, and DATAS</h2>

  <p class="define"><span class="define__term">Workstation GC</span> One heap, and collections run on
  the thread that triggered them. The default for console applications and the right choice when the
  process shares a machine with others or is one of many small containers.</p>

  <p class="define"><span class="define__term">Server GC</span> One heap and one dedicated collection
  thread <em>per core</em>. The default for ASP.NET Core. Allocating threads stop competing for a
  single allocation region, and collections happen in parallel.</p>

  <p class="define"><span class="define__term">Background GC</span> Generation 2 collections performed
  mostly concurrently with your threads still running, rather than stopping them for the whole
  collection. On by default in both modes; there are still short pauses at the start and end.</p>

  <p>Every measurement so far in this module was taken under workstation GC. That is the console
  default and it is <em>not</em> what your web service runs. The two files below are byte-identical
  except for two lines at the top, so the comparison is honest:</p>

  <pre data-lang="csharp" data-net="10" data-title="04-server-gc.cs (header)"><code>// A .NET 10 file-based app can set MSBuild properties with #:property lines, so
// the GC mode is switchable without a .csproj.

#:property ServerGarbageCollection=true
#:property ConcurrentGarbageCollection=true</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Measurement</th><th>Workstation</th><th>Server</th><th>Server vs workstation</th></tr>
      </thead>
      <tbody>
        <tr><td>single-threaded, wall clock</td><td>165.0 ms</td><td>89.1 ms</td><td><strong>1.85x faster</strong></td></tr>
        <tr><td>single-threaded, GC pause</td><td>54.1 ms</td><td>37.9 ms</td><td>1.43x less</td></tr>
        <tr><td>single-threaded, collections</td><td>55 / 18 / 11</td><td>21 / 7 / 5</td><td>fewer of each</td></tr>
        <tr><td>8 threads, wall clock</td><td>166.6 ms</td><td>51.8 ms</td><td><strong>3.22x faster</strong></td></tr>
        <tr><td>8 threads, GC pause</td><td>99.2 ms</td><td>21.4 ms</td><td>4.64x less</td></tr>
        <tr><td>8 threads, collections</td><td>50 / 13 / 5</td><td>9 / 3 / 2</td><td>fewer of each</td></tr>
        <tr><td>working set</td><td>37.2 MB</td><td>65.7 MB</td><td><strong>1.77x more memory</strong></td></tr>
        <tr><td>committed</td><td>12.1 MB</td><td>38.6 MB</td><td>3.19x more</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>A prediction that was wrong, recorded rather than quietly deleted.</strong> The comment
  in the source file originally said server GC would lose the single-threaded case, having no thread
  count to exploit. It won that case too, by 1.85x, because its generation 0 budget is much larger —
  21 collections against 55. The file now says so.</p>

  <p>The trade is not throughput against throughput. It is <strong>throughput against memory</strong>:
  server GC was faster on every workload measured and used 1.77x the working set to do it.</p>

  <h3>DATAS</h3>

  <p class="define"><span class="define__term">DATAS</span> Dynamic Adaptation To Application Sizes.
  Server GC with DATAS starts with a single heap and adds heaps only when the workload justifies it,
  and shrinks the heap back when it does not. On by default with server GC from .NET 9.</p>

  <p>This is the setting most likely to explain "we upgraded and memory usage changed" on a .NET 8 to
  9 or 10 migration. Measured, on the same workload, by re-launching the same executable with the
  environment variable set:</p>

  <pre data-lang="console" data-title="05-datas.cs"><code>DATAS   working set   committed    gen0   gen1   gen2
-----   -----------   ---------    ----   ----   ----
   on       98.5 MB     75.7 MB      21      8      6
  off      196.4 MB    174.2 MB       5      3      2

DATAS off uses 2.0x the working set (98 MB more)
DATAS off commits 2.3x the memory</code></pre>

  <p>DATAS halved the memory and quadrupled the collection count. That is the whole trade, and which
  side you want depends entirely on where the process runs:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Situation</th><th>Choice</th><th>Reason</th></tr>
      </thead>
      <tbody>
        <tr><td>Container with a memory limit</td><td>Server GC, DATAS on (the default)</td><td>Being killed at the limit costs more than the extra collections</td></tr>
        <tr><td>Many small services on one host</td><td>Workstation GC</td><td>Server GC reserves per-core structures each service will not use</td></tr>
        <tr><td>Dedicated box, throughput critical</td><td>Server GC, DATAS off</td><td>Memory is not the constraint; collections are</td></tr>
        <tr><td>Desktop or CLI tool</td><td>Workstation GC (the default)</td><td>Startup time and footprint matter more than sustained throughput</td></tr>
        <tr><td>Batch job, short-lived</td><td>Server GC, DATAS off</td><td>Nothing outlives the process; let the heap grow</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>There is <strong>no MSBuild property for DATAS</strong>. Writing
    <code>&lt;GCDynamicAdaptationMode&gt;false&lt;/GCDynamicAdaptationMode&gt;</code> in a project
    file, or the <code>#:property</code> equivalent, is silently ignored — verified, it changed
    nothing at all. The knob is the runtimeconfig entry
    <code>System.GC.DynamicAdaptationMode</code> or the environment variable
    <code>DOTNET_GCDynamicAdaptationMode</code>.</p>
    <p>Worse, it is not exposed as an <code>AppContext</code> switch, so <strong>a process cannot
    report its own DATAS setting</strong>. <code>AppContext.TryGetSwitch</code> returns false for it.
    To find out whether it is on, watch the GC Heap Count counter: with DATAS it starts at 1 and
    changes over time; without it, it equals the core count from the start.</p>
  </div>

  <h3>Setting the mode</h3>

  <pre data-lang="xml" data-title="Ledger.Api.csproj"><code>&lt;PropertyGroup&gt;
  &lt;!-- The default for ASP.NET Core is already true; set it explicitly so
       the decision is visible in review rather than inherited. --&gt;
  &lt;ServerGarbageCollection&gt;true&lt;/ServerGarbageCollection&gt;
  &lt;ConcurrentGarbageCollection&gt;true&lt;/ConcurrentGarbageCollection&gt;
&lt;/PropertyGroup&gt;</code></pre>

  <pre data-lang="json" data-title="runtimeconfig.template.json"><code>{
  "configProperties": {
    "System.GC.Server": true,
    "System.GC.Concurrent": true,
    "System.GC.DynamicAdaptationMode": 1,
    "System.GC.HeapHardLimitPercent": 75
  }
}</code></pre>

  <p class="define"><span class="define__term">GCSettings</span> The runtime type exposing the
  settings that can change while the process runs: <code>IsServerGC</code> (read-only),
  <code>LatencyMode</code>, and <code>LargeObjectHeapCompactionMode</code>. The mode itself cannot be
  changed after startup.</p>

  <p class="define"><span class="define__term">Latency mode</span> A hint about how much the collector
  may interrupt you. <code>Interactive</code> is the default. <code>SustainedLowLatency</code> avoids
  blocking generation 2 collections. <code>LowLatency</code> is stronger and workstation-only.
  <code>NoGCRegion</code> is not a latency mode but a related mechanism: it reserves a budget up front
  and guarantees no collection until you exceed it.</p>

  <pre data-lang="csharp" data-net="10" data-title="A bounded no-GC region"><code>using System.Runtime;

// Ask for 16 MB of allocation budget with no collection during it. Returns
// false if the runtime cannot honour it, which you MUST handle - the call
// does not throw, and ignoring the result means believing a guarantee you
// were never given.
if (GC.TryStartNoGCRegion(16 * 1024 * 1024))
{
    try
    {
        ProcessLatencyCriticalBatch();
    }
    finally
    {
        // Throws if the region already ended because the budget was exceeded,
        // so check before ending it.
        if (GCSettings.LatencyMode == GCLatencyMode.NoGCRegion)
        {
            GC.EndNoGCRegion();
        }
    }
}
else
{
    ProcessLatencyCriticalBatch();   // no guarantee available; proceed anyway
}

static void ProcessLatencyCriticalBatch()
{
    // Whatever must not be interrupted.
}</code></pre>
</section>

<section id="production">
  <h2>The Ledger incident, end to end</h2>

  <p>The export that failed in March. The original implementation builds the whole CSV in memory and
  then writes it:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="The version that failed"><code>static void BufferedExport(List&lt;Invoice&gt; invoices)
{
    Console.WriteLine("1. WRONG - build the whole export in memory first");
    Console.WriteLine();

    Collect();
    long g2Before = GC.CollectionCount(2);
    long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    var builder = new StringBuilder();
    foreach (Invoice invoice in invoices)
    {
        builder.Append(invoice.Number).Append(',')
               .Append(invoice.CustomerName).Append(',')
               .Append(invoice.AmountMinor).Append(',')
               .Append(invoice.Currency).Append('\n');
    }

    // The finished string, then the finished byte array. Both are single
    // objects far over the LOH threshold.
    string csv = builder.ToString();
    byte[] payload = Encoding.UTF8.GetBytes(csv);

    sw.Stop();

    // GetGCMemoryInfo reports the LAST collection, not the current heap. Reading
    // it without collecting first returns figures from before this method ran.
    // Collect while csv and payload are still reachable, so the LOH numbers
    // below describe a heap that genuinely contains them.
    GC.Collect(2, GCCollectionMode.Forced, blocking: true);
    var info = GC.GetGCMemoryInfo();

    Console.WriteLine($"   time                 : {sw.Elapsed.TotalMilliseconds:F0} ms");
    Console.WriteLine($"   final string         : {csv.Length * 2L / 1024 / 1024:N0} MB (UTF-16, 2 bytes per char)");
    Console.WriteLine($"   final byte[]         : {payload.Length / 1024 / 1024:N0} MB");
    Console.WriteLine($"   string generation    : gen {GC.GetGeneration(csv)}");
    Console.WriteLine($"   byte[] generation    : gen {GC.GetGeneration(payload)}");
    Console.WriteLine($"   allocated in total   : {(GC.GetTotalAllocatedBytes(precise: true) - allocBefore) / 1024.0 / 1024.0:N0} MB");
    Console.WriteLine($"   gen 2 collections    : {GC.CollectionCount(2) - g2Before}");
    Console.WriteLine($"   LOH size             : {info.GenerationInfo[3].SizeAfterBytes / 1024.0 / 1024.0:F1} MB");
    Console.WriteLine($"   LOH fragmentation    : {info.GenerationInfo[3].FragmentationAfterBytes / 1024.0 / 1024.0:F1} MB");</code></pre>

  <pre data-lang="console" data-title="06-production.cs"><code>1. WRONG - build the whole export in memory first

   time                 : 101 ms
   final string         : 31 MB (UTF-16, 2 bytes per char)
   final byte[]         : 15 MB
   string generation    : gen 2
   byte[] generation    : gen 2
   allocated in total   : 78 MB
   gen 2 collections    : 2
   LOH size             : 49.6 MB
   LOH fragmentation    : 0.0 MB</code></pre>

  <p>Three copies of the same data exist at the peak: the <code>StringBuilder</code> chunks, the
  finished string, and the byte array. Note the string is <strong>31 MB for 15 MB of text</strong> —
  .NET strings are UTF-16, two bytes per character for this content, and the conversion to UTF-8
  bytes allocates the whole thing again.</p>

  <p>The fix holds nothing. A <code>StreamWriter</code> with a 64 KB buffer — comfortably under the
  threshold — writes each row and forgets it:</p>

  <pre data-lang="csharp" data-net="10" data-title="The version that ships"><code>static void StreamedExport(List&lt;Invoice&gt; invoices)
{
    Console.WriteLine("3. RIGHT - stream it, with a buffer under the threshold");
    Console.WriteLine();

    Collect();
    long g2Before = GC.CollectionCount(2);
    long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    long peakLive = 0;
    var sw = Stopwatch.StartNew();

    // 64 KB: comfortably under 85,000 bytes, so this buffer lives in gen 0 and
    // is collected cheaply. Stream.Null stands in for the response body.
    using var output = Stream.Null;
    using var writer = new StreamWriter(output, Encoding.UTF8, bufferSize: 65_536, leaveOpen: true);

    int written = 0;
    foreach (Invoice invoice in invoices)
    {
        writer.Write(invoice.Number);
        writer.Write(',');
        writer.Write(invoice.CustomerName);
        writer.Write(',');
        writer.Write(invoice.AmountMinor);
        writer.Write(',');
        writer.Write(invoice.Currency);
        writer.Write('\n');

        if (++written % 20_000 == 0)
        {
            peakLive = Math.Max(peakLive, GC.GetTotalMemory(false));
        }
    }

    writer.Flush();
    sw.Stop();
    var info = GC.GetGCMemoryInfo();

    Console.WriteLine($"   time                 : {sw.Elapsed.TotalMilliseconds:F0} ms");
    Console.WriteLine($"   rows written         : {written:N0}");
    Console.WriteLine($"   peak live heap       : {peakLive / 1024.0 / 1024.0:F1} MB");</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Measurement</th><th>Buffered</th><th>Streamed</th><th>Change</th></tr>
      </thead>
      <tbody>
        <tr><td>time</td><td>101 ms</td><td>67 ms</td><td>1.5x faster</td></tr>
        <tr><td>total allocated</td><td>78 MB</td><td>13 MB</td><td><strong>6x less</strong></td></tr>
        <tr><td>gen 2 collections</td><td>2</td><td>0</td><td>none</td></tr>
        <tr><td>LOH size</td><td>49.6 MB</td><td>3.4 MB</td><td>14.6x less</td></tr>
        <tr><td>peak memory scales with export size</td><td>yes</td><td><strong>no</strong></td><td>the property that matters</td></tr>
      </tbody>
    </table>
  </div>

  <p>The last row is the one that closed the incident. The buffered version's memory grows with the
  number of invoices, so it was always going to fail at <em>some</em> month size and the only question
  was which. The streamed version's peak is the invoice list plus one 64 KB buffer, whatever the
  export size. <strong>It cannot fail on a bigger month.</strong></p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The buffered export was not leaking. Every byte was reachable while in use and released
    afterwards. A memory profiler pointed at it would show a correct program.</p>
    <p>It failed because it demanded single contiguous allocations from a region that is never
    compacted. At 5,000 invoices per second of ingest, Ledger crosses the 64 MB buffer size roughly
    every eleven weeks — which is why it ran for a year and then broke, and why "it worked in
    February" was true and irrelevant.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A buffer size chosen as a round number</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Over the line by 4,048 bytes"><code>// 100 KB "feels like" a sensible buffer. It is 102,400 bytes and every
// single one of these is born in gen 2.
private const int BufferSize = 100 * 1024;

public async Task&lt;int&gt; CopyAsync(Stream source, Stream destination, CancellationToken ct)
{
    var buffer = new byte[BufferSize];
    int total = 0;
    int read;
    while ((read = await source.ReadAsync(buffer, ct)) &gt; 0)
    {
        await destination.WriteAsync(buffer.AsMemory(0, read), ct);
        total += read;
    }
    return total;
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Under the line, and it says why"><code>// 64 KB = 65,536 bytes, plus a 24-byte header, is 65,560 - comfortably
// under the 85,000-byte LOH threshold. Do not raise this without checking
// the arithmetic again.
private const int BufferSize = 64 * 1024;</code></pre>

  <h3>2. Reading GCMemoryInfo without collecting first</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Reports the wrong heap"><code>BuildTheExport();

// WRONG: GetGCMemoryInfo describes the LAST collection, which may have
// happened before BuildTheExport ran. These numbers can predate the work
// entirely - this exact bug produced a reading of 0.9 MB for a heap that
// actually held 49.6 MB.
var info = GC.GetGCMemoryInfo();
Console.WriteLine(info.GenerationInfo[3].SizeAfterBytes);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Collect first, while the data is still reachable"><code>string csv = BuildTheExport();

// Force a collection while csv is still referenced, so the figures below
// describe a heap that genuinely contains it.
GC.Collect(2, GCCollectionMode.Forced, blocking: true);
var info = GC.GetGCMemoryInfo();
Console.WriteLine(info.GenerationInfo[3].SizeAfterBytes);

GC.KeepAlive(csv);</code></pre>

  <h3>3. Using the length of a rented array</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Reads another request's data"><code>using System.Buffers;

byte[] buffer = ArrayPool&lt;byte&gt;.Shared.Rent(1_000_000);
try
{
    int read = await source.ReadAsync(buffer, ct);

    // WRONG on two counts. Rent returns an array AT LEAST the requested
    // size - measured, a request for 1,000,000 returns 1,048,576 - and
    // only the first 'read' bytes were filled by this caller. Everything
    // beyond that is whatever the previous tenant left behind.
    await destination.WriteAsync(buffer, ct);
}
finally
{
    ArrayPool&lt;byte&gt;.Shared.Return(buffer);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Track what you actually wrote"><code>using System.Buffers;

byte[] buffer = ArrayPool&lt;byte&gt;.Shared.Rent(1_000_000);
try
{
    int read = await source.ReadAsync(buffer, ct);
    await destination.WriteAsync(buffer.AsMemory(0, read), ct);
}
finally
{
    // clearArray: true costs a memset but guarantees the next tenant
    // cannot read this request's data. Use it whenever the buffer held
    // anything a different user must not see.
    ArrayPool&lt;byte&gt;.Shared.Return(buffer, clearArray: true);
}</code></pre>

  <h3>4. Compacting the LOH on a timer</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Turns a memory problem into a latency problem"><code>// WRONG: this stops every thread and copies every surviving large object,
// every five minutes, whether or not the heap is fragmented.
_timer = new Timer(_ =&gt;
{
    GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce;
    GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: true);
}, null, TimeSpan.Zero, TimeSpan.FromMinutes(5));</code></pre>

  <p>If you genuinely need this, gate it on a measured threshold and a bounded event rather than a
  clock:</p>

  <pre data-lang="csharp" data-net="10" data-title="Gated on the measurement it is meant to fix"><code>public void CompactIfBadlyFragmented()
{
    var loh = GC.GetGCMemoryInfo().GenerationInfo[3];
    if (loh.SizeAfterBytes == 0)
    {
        return;
    }

    double wasted = (double)loh.FragmentationAfterBytes / loh.SizeAfterBytes;

    // Only worth the pause when most of the region is holes AND the region
    // is big enough for the recovery to matter.
    if (wasted &gt; 0.5 &amp;&amp; loh.SizeAfterBytes &gt; 100 * 1024 * 1024)
    {
        _logger.LogWarning(
            "Compacting LOH: {SizeMb} MB with {WastedPercent:P0} fragmentation",
            loh.SizeAfterBytes / 1024 / 1024, wasted);

        GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce;
        GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: true);
    }
}</code></pre>

  <h3>5. Assuming the container limit is the heap limit</h3>

  <p>A 512 MB container limit is measured against the <strong>working set</strong>, which includes the
  runtime itself, JIT-compiled code, thread stacks, and native allocations — not only your heap.
  Measured above, server GC alone accounted for 65.7 MB of working set against a 0.1 MB live heap.</p>

  <pre data-lang="json" data-title="runtimeconfig.template.json"><code>{
  "configProperties": {
    "System.GC.HeapHardLimitPercent": 75
  }
}</code></pre>

  <p>This tells the collector to treat 75% of the container limit as its ceiling and collect harder as
  it approaches, rather than discovering the limit by being killed. .NET detects cgroup limits
  automatically, so this is a refinement rather than a requirement — but the default of 75% applies
  only when a limit is detected, and a limit set through some orchestrators is not.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> <code>OutOfMemoryException</code>, or a container restarting with
    exit code 137, while the reported heap size is far below the limit.</p>
    <p><strong>Tool:</strong> <code>dotnet-counters</code> first, then <code>dotnet-gcdump</code>,
    then <code>dotnet-dump</code> with SOS if you need object identities.</p>
  </div>

  <h3>Step 1: is it fragmentation or genuine growth?</h3>

  <pre data-lang="bash" data-title="Live counters, no restart needed"><code>dotnet-counters monitor --process-id 4821 --counters System.Runtime</code></pre>

  <p>The rows that answer the question:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Counter</th><th>What it tells you</th></tr>
      </thead>
      <tbody>
        <tr><td>GC Heap Size</td><td>Live bytes. If this is flat while the working set climbs, it is fragmentation or native memory, not a managed leak.</td></tr>
        <tr><td>Gen 2 GC Count</td><td>Rising steadily under steady load means large objects or promotion.</td></tr>
        <tr><td>LOH Size</td><td>The large object heap specifically. Compare against GC Heap Size.</td></tr>
        <tr><td>% Time in GC</td><td>The single best health number. Sustained above 10% is a problem; above 20% the service is mostly collecting.</td></tr>
        <tr><td>GC Heap Count</td><td>Whether DATAS is active — starts at 1 and adapts, versus equalling the core count from startup.</td></tr>
        <tr><td>Allocation Rate</td><td>Bytes per second. High with low % Time in GC is fine.</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>The diagnostic pattern for this module's failure is: GC Heap Size flat, LOH Size high,
  working set climbing, Gen 2 GC Count rising.</strong> That combination is fragmentation and nothing
  else.</p>

  <h3>Step 2: find what is on the LOH</h3>

  <pre data-lang="bash" data-title="Capture without stopping the process for long"><code>dotnet-gcdump collect --process-id 4821 --output ledger-export.gcdump</code></pre>

  <p>Open it in Visual Studio or PerfView and sort by size. You are looking for a small number of very
  large arrays or strings. If the top entries are <code>System.Byte[]</code> or
  <code>System.String</code> at tens of megabytes each, you have found the buffers.</p>

  <h3>Step 3: confirm the shape from a dump</h3>

  <pre data-lang="bash" data-title="Full dump and SOS"><code>dotnet-dump collect --process-id 4821 --output ledger.dmp
dotnet-dump analyze ledger.dmp</code></pre>

  <pre data-lang="text" data-title="At the SOS prompt"><code>&gt; dumpheap -stat -min 85000
&gt; dumpheap -stat -type System.Byte[]
&gt; eeheap -gc
&gt; gcroot 00007f2a1c004080</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Command</th><th>What it answers</th></tr>
      </thead>
      <tbody>
        <tr><td><code>dumpheap -stat -min 85000</code></td><td>Every object over the threshold, grouped by type with counts and total bytes. This is the LOH inventory.</td></tr>
        <tr><td><code>eeheap -gc</code></td><td>Per-generation and per-segment layout, including the LOH segments and their free space. Fragmentation is visible here as free blocks between allocated ones.</td></tr>
        <tr><td><code>gcroot &lt;address&gt;</code></td><td>The chain of references keeping one object alive. Use it when the answer to "why is this still here" is not obvious.</td></tr>
        <tr><td><code>dumpheap -stat</code></td><td>The whole heap by type. Run it twice a few minutes apart and diff — the type that grew is the one to chase.</td></tr>
      </tbody>
    </table>
  </div>

  <h3>Step 4: confirm the mode you are actually running</h3>

  <p>Before drawing any conclusion from a benchmark, check the mode, because every number in this
  module would be different under the other one:</p>

  <pre data-lang="csharp" data-net="10" data-title="A startup log line worth having"><code>using System.Runtime;

_logger.LogInformation(
    "GC mode: server={IsServer} latency={Latency} cores={Cores} " +
    "heapLimit={LimitMb}MB totalAvailable={AvailableMb}MB",
    GCSettings.IsServerGC,
    GCSettings.LatencyMode,
    Environment.ProcessorCount,
    GC.GetGCMemoryInfo().HighMemoryLoadThresholdBytes / 1024 / 1024,
    GC.GetGCMemoryInfo().TotalAvailableMemoryBytes / 1024 / 1024);</code></pre>

  <p>This one line has resolved more arguments than any profiler, because "it is fast on my machine"
  and "it is slow in production" are frequently the same code under two different collectors.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The LOH threshold is 85,000 elements."</strong></p>
    <p>It is 85,000 <em>bytes of total object size</em>, header included. For a
    <code>double[]</code> that is 10,622 elements — measured. Off by a factor of eight, and in the
    direction that puts you on the LOH without noticing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Reducing allocations is how you fix a GC problem."</strong></p>
    <p>Measured above: five workloads with identical allocation volume spanned 0.4 ms to 64 ms of
    pause time. What varied was survival. Halving survival cut the pause without changing a single
    collection count.</p>
    <p>Reduce allocations when objects already die in generation 0 and the generation 0 count itself
    is the cost. Otherwise find what is surviving.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Fewer GC collections means better performance."</strong></p>
    <p>In the survival table the generation 0 count <em>fell</em> from 28 to 15 as pause time rose by
    two orders of magnitude. The collector grows its budget when survivors accumulate, so it runs less
    often and each run costs more. Count is not a health metric; pause time is.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"ArrayPool.Shared will not pool arrays above 1 MB, so it is useless for large
    buffers."</strong></p>
    <p>This was true of an older implementation and the advice outlived it. Measured on .NET 10 by
    renting, returning, and renting again to see whether the same instance comes back: pooled at
    1 MB, 2 MB, 16 MB and 128 MB, every time.</p>
    <p>The trap that did <em>not</em> go away is <code>Rent</code> returning an array larger than you
    asked for — 1,048,576 for a request of 1,000,000. Track the length you filled.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Calling GC.Collect() will fix the fragmentation."</strong></p>
    <p>Measured: a forced blocking generation 2 collection on a heap with 79.8 MB of fragmentation
    left it at exactly 79.8 MB. The dead objects were already free space. Only
    <code>LargeObjectHeapCompactionMode.CompactOnce</code> moved anything.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Server GC is faster, so always use server GC."</strong></p>
    <p>Server GC was faster on every workload measured here — and used 1.77x the working set and
    3.19x the committed memory. On a container with a memory limit that is not a performance win, it
    is an outage. The choice is throughput against memory, and it depends on where the process runs.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Memory usage keeps climbing, so we have a leak."</strong></p>
    <p>Three non-leak explanations, all measured in this module: cumulative allocation counters being
    charted as usage (620.1 MB reported against an 11.7 MB live heap); LOH fragmentation (230.3 MB of
    heap holding 22.9 MB of data); and server GC keeping headroom it has not returned to the OS.</p>
    <p>Check whether <em>live</em> size is growing before chasing a leak.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger runs 12 API instances at 5,000 requests per second, in containers with a 512 MB limit.
    At the measured 832 bytes per request that is 4.0 MB/s of allocation per instance, or 13.9 GB per
    hour — a number that sounds alarming and is completely fine, because the objects die in
    generation 0.</p>
    <p>The export service on the same cluster allocates far less and was the one that fell over,
    because its allocations were 64 MB contiguous blocks on a heap that is never compacted. At the
    measured 89% waste, 23 MB of live export data occupied 230 MB of heap — 45% of the container
    limit for data that would fit in a rounding error.</p>
    <p>The two services needed opposite advice. "Allocate less" would have done nothing for either.</p>
  </div>

  <p>The decision this module should let you make without looking anything up:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Observation</th><th>What it means</th><th>First action</th></tr>
      </thead>
      <tbody>
        <tr><td>High allocation rate, low % time in GC</td><td>Healthy. Objects die young.</td><td>Nothing.</td></tr>
        <tr><td>High % time in GC, gen 2 count rising</td><td>Promotion. Something outlives gen 0.</td><td>Find what survives — caches, static collections, long request scopes.</td></tr>
        <tr><td>Flat heap size, climbing working set</td><td>Fragmentation or native memory.</td><td>Check LOH Size against GC Heap Size.</td></tr>
        <tr><td>Gen 2 count rising with no obvious cache</td><td>Buffers over 85,000 bytes.</td><td>Audit buffer sizes; pool or shrink them.</td></tr>
        <tr><td>OOM with free memory on the box</td><td>No contiguous block available.</td><td>Stop the growing-buffer pattern; stream instead.</td></tr>
        <tr><td>Memory changed after a .NET upgrade</td><td>Likely DATAS, from .NET 9.</td><td>Check GC Heap Count; set the runtimeconfig knob deliberately.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Without running anything: is <code>new int[21_244]</code> on the large object heap? What about
    <code>new double[10_000]</code>? Give the total object size for each.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><code>int[21_244]</code>: 21,244 × 4 = 84,976 bytes of elements, plus the 24-byte array
        header = <strong>85,000 bytes exactly</strong>. The threshold is "at or above", so
        <strong>yes, it is on the LOH</strong>.</p>
        <p><code>double[10_000]</code>: 10,000 × 8 = 80,000, plus 24 = 80,024 bytes.
        <strong>No</strong> — it stays on the small object heap, with 4,975 bytes to spare.</p>
        <p>Verified:</p>
        <pre data-lang="console"><code>   type       max elements   total bytes   generation   one more
   byte             84,975        84,999   gen 0        gen 2
   int              21,243        84,996   gen 0        gen 2
   long             10,621        84,992   gen 0        gen 2
   double           10,621        84,992   gen 0        gen 2</code></pre>
        <p>The general formula for the largest array of a type that stays off the LOH:
        <code>(84999 - 24) / sizeof(T)</code>, rounded down.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>A colleague says a large object starts in generation 2 and gets promoted no further, so it must
    be collected as often as anything else in generation 2. Is that right, and what follows from it
    for a 100 KB buffer allocated once per request?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>The first half is right: it is born in generation 2 and never promoted, because there is
        nothing older to be promoted to. Measured across three forced collections it reports gen 2
        every time.</p>
        <p>What follows is the expensive part. Generation 2 collections are <em>rare</em>, so a
        short-lived large buffer is not reclaimed promptly — it sits there until a full collection
        happens, and full collections examine the entire heap.</p>
        <p>For a 100 KB buffer allocated once per request at even 100 requests per second, that is
        10 MB per second accumulating on a region only a full collection frees. The measured result of
        exactly this pattern:</p>
        <pre data-lang="console"><code>   size       gen0   gen1   gen2   time
   80,000      500      0      0      100 ms
   100,000     3240   3240    540      174 ms</code></pre>
        <p>540 generation 2 collections, each walking the whole heap, for a 25% increase in buffer
        size. The fix is either to drop under the threshold or to pool the buffer so it is allocated
        once rather than per request.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>A service reports: allocation rate 800 MB/s, % time in GC 2%, gen 2 collections 1 per minute,
    heap size flat at 400 MB. A second service reports: allocation rate 40 MB/s, % time in GC 22%,
    gen 2 collections 40 per minute, heap size flat at 380 MB. Which one needs work, and what would
    you look at first?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The second one</strong>, despite allocating twenty times less.</p>
        <p>The first service is healthy. A high allocation rate with 2% time in GC means objects are
        dying in generation 0, which is the cheapest possible outcome. There is nothing to fix, and
        "reduce allocations" would be work spent for no gain.</p>
        <p>The second service spends 22% of its wall clock stopped. Forty generation 2 collections a
        minute against a flat heap means objects are consistently surviving generation 0 and reaching
        generation 2, or large objects are being allocated. Two things to check, in order:</p>
        <ol>
          <li><strong>LOH Size against GC Heap Size.</strong> If a large fraction of that 380 MB is
          LOH, the cause is buffers over 85,000 bytes and the fix is to shrink or pool them.</li>
          <li><strong>What survives generation 0.</strong> A cache with a lifetime of seconds is the
          classic cause: long enough to guarantee promotion, short enough that it is all garbage by
          the time generation 2 runs.</li>
        </ol>
        <p>The general rule this exercise encodes: <strong>allocation rate is not a problem
        indicator. Percentage of time in GC is.</strong> The measured table makes the point — five
        workloads, identical allocation, pause time spanning 0.4 ms to 64 ms.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>Your service runs in a container with a 512 MB memory limit and handles moderate traffic on
    4 cores. It currently uses the ASP.NET Core defaults. Memory sits at 430 MB and the container is
    occasionally killed. What are your options, in what order, and what does each cost?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>The defaults mean <strong>server GC with DATAS on</strong> (from .NET 9). Both are relevant.</p>
        <p><strong>First: confirm the mode and check it is not fragmentation.</strong> Log
        <code>GCSettings.IsServerGC</code> at startup and watch GC Heap Size against working set. If
        the heap is flat and the working set climbs, no GC setting will help — find the
        fragmentation or the native allocation.</p>
        <p><strong>Second: set a heap hard limit</strong>, so the collector works harder as it
        approaches the ceiling instead of discovering it by being killed:</p>
        <pre data-lang="json"><code>{ "configProperties": { "System.GC.HeapHardLimitPercent": 75 } }</code></pre>
        <p>Cost: more frequent collections near the limit. Cheap, and it converts a hard kill into
        gradual degradation.</p>
        <p><strong>Third: verify DATAS is actually on.</strong> It cannot be read from inside the
        process — <code>AppContext.TryGetSwitch</code> returns false for it — so check GC Heap Count
        in <code>dotnet-counters</code>. With DATAS it starts at 1 and adapts; without it, it equals 4
        from startup. Measured, turning DATAS off doubled the working set:</p>
        <pre data-lang="console"><code>DATAS   working set   committed    gen0   gen1   gen2
   on       98.5 MB     75.7 MB      21      8      6
  off      196.4 MB    174.2 MB       5      3      2</code></pre>
        <p><strong>Fourth: consider workstation GC.</strong> On 4 cores with moderate traffic, server
        GC's per-core structures may cost more than they return. Measured on 8 cores, workstation used
        37.2 MB of working set against server's 65.7 MB. Cost: measured 3.22x lower throughput on a
        parallel allocating workload — so measure your own before switching.</p>
        <p><strong>What not to do:</strong> call <code>GC.Collect()</code> on a timer. It does not
        address fragmentation at all (measured: 79.8 MB fragmented before and after) and it adds
        pauses.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Write a method that reports whether the large object heap is fragmented enough to be worth
    compacting, and compacts it if so. State the threshold you chose and defend it. Then explain why
    the obvious implementation is wrong.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>The obvious implementation reads <code>GC.GetGCMemoryInfo()</code> and acts on it. That is
        wrong because <strong>the struct describes the last collection, not the current heap</strong>.
        If no collection has happened since the fragmentation was created, the numbers predate it —
        this exact bug reported 0.9 MB for a heap that held 49.6 MB.</p>
        <pre data-lang="csharp" data-net="10"><code>using System.Runtime;

public sealed class LohMaintenance
{
    private readonly ILogger&lt;LohMaintenance&gt; _logger;

    public LohMaintenance(ILogger&lt;LohMaintenance&gt; logger)
    {
        _logger = logger;
    }

    public bool CompactIfFragmented(
        double wastedFraction = 0.5,
        long minimumSizeBytes = 100L * 1024 * 1024)
    {
        // A non-compacting gen 2 collection first, so the figures describe the
        // heap as it is now rather than as it was at the last collection.
        GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: false);

        GCGenerationInfo loh = GC.GetGCMemoryInfo().GenerationInfo[3];
        if (loh.SizeAfterBytes &lt; minimumSizeBytes)
        {
            return false;
        }

        double wasted = (double)loh.FragmentationAfterBytes / loh.SizeAfterBytes;
        if (wasted &lt;= wastedFraction)
        {
            return false;
        }

        _logger.LogWarning(
            "Compacting LOH: {SizeMb} MB, {WastedPercent:P0} fragmented",
            loh.SizeAfterBytes / 1024 / 1024, wasted);

        GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce;
        GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: true);

        GCGenerationInfo after = GC.GetGCMemoryInfo().GenerationInfo[3];
        _logger.LogWarning(
            "LOH compacted: {BeforeMb} MB to {AfterMb} MB",
            loh.SizeAfterBytes / 1024 / 1024, after.SizeAfterBytes / 1024 / 1024);

        return true;
    }
}</code></pre>
        <p><strong>Defending the thresholds.</strong> 50% wasted and 100 MB minimum are both about
        making the pause worth its cost. Below 100 MB the recovery is too small to justify stopping
        every thread. Below 50% waste the heap is behaving acceptably — some fragmentation is normal
        and permanent on a non-compacting region.</p>
        <p><strong>The important caveat.</strong> This is a repair tool for a bounded event — after a
        batch import, when a tenant is unloaded. Calling it on a timer converts a memory problem into
        a latency problem. If it fires repeatedly in production, the answer is not to tune the
        thresholds but to stop producing the fragmentation.</p>
        <p>Measured effect when it does fire:</p>
        <pre data-lang="console"><code>   fragmented   : size   105.6 MB   fragmentation    79.8 MB
   plain gen 2  : size   105.6 MB   fragmentation    79.8 MB
   compacted    : size    25.8 MB   fragmentation     0.0 MB</code></pre>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Ledger's PDF renderer allocates a <code>byte[]</code> sized to the finished document — typically
    200 KB, occasionally 40 MB for a statement run. It runs up to 8 concurrently. Design the
    allocation strategy, and identify the correctness hazard in your own design.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Every one of these is on the LOH</strong> — 200 KB is over the threshold — and the
        sizes vary, which is the shape that fragments a non-compacting heap fastest. Eight concurrent
        40 MB allocations is 320 MB of contiguous requests.</p>
        <p><strong>The strategy, in order of preference:</strong></p>
        <ol>
          <li><strong>Do not materialise the document at all.</strong> Write it to the response stream
          as it is produced. The measured version of exactly this change: 78 MB allocated and 49.6 MB
          of LOH became 13 MB and 3.4 MB, and peak memory stopped scaling with document size. This is
          the only option that cannot fail on a larger statement run.</li>
          <li><strong>If it must be materialised, pool it.</strong> Measured, pooling removed the
          entire LOH cost: 57 GB of allocation and 3,929 gen 2 collections became 2 MB and zero.</li>
          <li><strong>Bound the concurrency</strong> with a <code>SemaphoreSlim</code>, so the worst
          case is a number you chose rather than a number the traffic chose.</li>
        </ol>
        <pre data-lang="csharp" data-net="10"><code>using System.Buffers;

public sealed class PdfRenderer
{
    // Eight concurrent renders is a deliberate ceiling, not an accident of load.
    private readonly SemaphoreSlim _concurrency = new(8, 8);

    public async Task RenderToAsync(Statement statement, Stream destination, CancellationToken ct)
    {
        await _concurrency.WaitAsync(ct);
        try
        {
            int estimated = statement.EstimatedByteCount;
            byte[] buffer = ArrayPool&lt;byte&gt;.Shared.Rent(estimated);
            try
            {
                // Track what was WRITTEN. Rent returns an array at least the
                // requested size - a request for 1,000,000 measured 1,048,576 -
                // so buffer.Length is not the document length.
                int written = RenderInto(statement, buffer);
                await destination.WriteAsync(buffer.AsMemory(0, written), ct);
            }
            finally
            {
                // clearArray: true because this buffer held one customer's
                // statement and the next tenant is a different customer.
                ArrayPool&lt;byte&gt;.Shared.Return(buffer, clearArray: true);
            }
        }
        finally
        {
            _concurrency.Release();
        }
    }

    private static int RenderInto(Statement statement, byte[] destination)
    {
        // Real rendering goes here; it returns the number of bytes written.
        int written = 0;
        foreach (byte b in statement.Content)
        {
            destination[written++] = b;
        }
        return written;
    }
}

public sealed record Statement(int EstimatedByteCount, byte[] Content);</code></pre>
        <p><strong>The correctness hazard in this design</strong>, which is the point of the
        exercise: a pooled buffer carries the <em>previous tenant's data</em> in the region beyond
        what you wrote. Two independent bugs follow, and both are in production code somewhere:</p>
        <ul>
          <li>Writing <code>buffer</code> rather than <code>buffer.AsMemory(0, written)</code> sends
          another customer's statement fragments to this customer. That is a data-disclosure bug, not
          a performance bug.</li>
          <li>If <code>RenderInto</code> throws part-way, the buffer is returned holding real
          customer data. <code>clearArray: true</code> costs a memset and removes that risk entirely
          — which is why it is not optional here.</li>
        </ul>
        <p>The secondary hazard: if <code>EstimatedByteCount</code> underestimates,
        <code>RenderInto</code> throws <code>IndexOutOfRangeException</code>. Production code checks
        the estimate and falls back to a growing strategy, and the estimate should err high because
        renting more than you need is nearly free while overflowing is a crash.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is the LOH threshold, and what exactly is measured against it?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>85,000 bytes of <strong>total object size</strong>, including the
        24-byte array header on 64-bit. Not element count, and not the payload alone. The largest
        <code>byte[]</code> that stays off the LOH has 84,975 elements.</p></div>
      </details></li>

    <li><p>Which generation is a large object allocated into, and what does that cost you?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Generation 2, from birth. It is never promoted because nothing is
        older. The cost is that only a full generation 2 collection can reclaim it, so a short-lived
        large buffer is both expensive to collect and slow to be collected.</p></div>
      </details></li>

    <li><p>Why can a process throw <code>OutOfMemoryException</code> with gigabytes of free memory?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Because arrays need <strong>contiguous</strong> memory and the LOH
        is not compacted by default. Free space accumulates as holes between surviving large objects.
        Measured: 230.3 MB of heap holding 22.9 MB of live data, 89% fragmented — with no single run
        big enough for the next request.</p></div>
      </details></li>

    <li><p>Does <code>GC.Collect()</code> fix fragmentation?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. Measured, a forced blocking gen 2 collection left a heap at
        exactly 105.6 MB with 79.8 MB fragmented — identical before and after. You need
        <code>GCSettings.LargeObjectHeapCompactionMode = CompactOnce</code> followed by a compacting
        collection, which took it to 25.8 MB with 0.0 MB fragmented.</p></div>
      </details></li>

    <li><p>Allocation rate or survival rate — which determines GC pause time?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Survival. Allocation rate determines how <em>often</em> gen 0
        runs; survival determines how much each collection <em>costs</em>. Measured: identical
        allocation volume at five survival rates spanned 0.4 ms to 64 ms of pause.</p></div>
      </details></li>

    <li><p>Why is a falling GC collection count not necessarily good news?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The collector grows the gen 0 budget when survivors accumulate, so
        it runs less often and each run costs more. In the measured table the gen 0 count fell from 28
        to 15 while pause time rose from 0.4 ms to 64 ms.</p></div>
      </details></li>

    <li><p>What is the trade between server GC and workstation GC?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Throughput against memory. Measured: server GC was 3.22x faster on
        a parallel allocating workload and used 1.77x the working set and 3.19x the committed memory.
        On a container with a memory limit that extra memory is the risk.</p></div>
      </details></li>

    <li><p>What is DATAS, and how do you find out whether it is on?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Dynamic Adaptation To Application Sizes: server GC starts with one
        heap and adds heaps only as needed. On by default with server GC from .NET 9. Measured, it
        halved the working set and quadrupled the gen 0 count.</p>
        <p>You cannot read it from inside the process — it is not an <code>AppContext</code> switch.
        Watch GC Heap Count in <code>dotnet-counters</code>: with DATAS it starts at 1, without it, it
        equals the core count.</p></div>
      </details></li>

    <li><p>What are the two bugs waiting in <code>ArrayPool.Shared.Rent</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>First, it returns an array <strong>at least</strong> the requested
        size, rounded up to a power of two — a request for 1,000,000 measured 1,048,576. Using
        <code>.Length</code> instead of the count you filled exposes the previous tenant's data.</p>
        <p>Second, the buffer is not cleared on return unless you pass
        <code>clearArray: true</code>. If it held one user's data and the next tenant is another user,
        that is a disclosure bug rather than a performance one.</p></div>
      </details></li>

    <li><p>Which counters distinguish fragmentation from a genuine leak?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>GC Heap Size against working set. A leak grows the live heap;
        fragmentation leaves it flat while the working set climbs. Confirm with LOH Size compared to
        GC Heap Size, then <code>dumpheap -stat -min 85000</code> and <code>eeheap -gc</code> in a
        dump.</p>
        <p>And check you are not charting <code>GC.GetTotalAllocatedBytes()</code>, which is
        cumulative and climbs forever on a healthy service — it read 620.1 MB against an 11.7 MB live
        heap in the measurement above.</p></div>
      </details></li>
  </ol>
</section>
`
});
