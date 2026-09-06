CSPREP.module({
  id: "t2-14-async-coordination",
  minutes: 55,
  updated: "2026-08-31",
  summary: "Task.WhenAll is not a throttle and an unbounded channel is not a safe default. Ledger's webhook dispatcher fanned out 3,000 concurrent requests at a partner that had merely slowed down, then filled memory until the pod was killed and the queue lost. SemaphoreSlim and Parallel.ForEachAsync fix the first, bounded channels the second - and the choice of BoundedChannelFullMode is a business decision wearing an API's clothes.",
  terms: ["SemaphoreSlim", "WaitAsync", "throttling", "Parallel.ForEachAsync", "Channel",
    "bounded channel", "back pressure", "BoundedChannelFullMode", "producer/consumer",
    "Writer.Complete", "ReadAllAsync", "permit leak", "SemaphoreFullException", "CanCount"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger posts a webhook to a partner for every settled payment. The dispatcher was written the
  obvious way — a queue, and a background loop that sends everything in it:</p>

  <pre data-lang="csharp" data-net="10" data-title="WebhookDispatcher.cs"><code>_queue = Channel.CreateUnbounded&lt;WebhookEvent&gt;();

// In the background loop:
await Task.WhenAll(batch.Select(e =&gt; _http.PostAsync(e)));</code></pre>

  <p>It ran for eighteen months. Then a partner's endpoint went from 5 ms to 400 ms. Not down, only
  slow. Ledger fell over instead of them.</p>

  <p>Two things happened, and they are independent defects that happen to compound.</p>

  <p><strong><code>Task.WhenAll</code> is not a throttle.</strong> It starts every request at once and
  waits for them all, so a slow partner received the entire backlog simultaneously. Measured:
  <strong>3,000 concurrent requests</strong> against a service that was already struggling.</p>

  <p><strong>An unbounded queue never applies back pressure.</strong> Payments kept settling and kept
  enqueueing while delivery slowed, so the backlog grew until the pod was killed — losing every queued
  webhook. A durability failure caused by a memory bug.</p>

  <p>This module is about the primitives that fix each: <code>SemaphoreSlim</code> and
  <code>Parallel.ForEachAsync</code> for limiting concurrency across an <code>await</code>, and
  <code>System.Threading.Channels</code> for handing work between producers and consumers with a
  bound you choose deliberately. The measured fix took peak concurrency from 3,000 to <strong>8</strong>
  and peak memory from 12.0 MB to 5.0 MB, delivering every event either way.</p>
</section>

<section id="plain-language">
  <h2>Coordinating without blocking</h2>

  <p class="define"><span class="define__term">Thread</span> An independent sequence of instructions
  the operating system can run. A blocked thread does no work and cannot be reused, which is the cost
  every primitive in this module exists to avoid.</p>

  <p class="define"><span class="define__term">Throttling</span> Limiting how many operations run at
  once. Distinct from <em>waiting for</em> operations: <code>Task.WhenAll</code> waits, it does not
  limit.</p>

  <p class="define"><span class="define__term">SemaphoreSlim</span> A counter of permits with an
  asynchronous wait. <code>WaitAsync</code> takes a permit or suspends until one is free;
  <code>Release</code> returns one. It has <strong>no owner</strong>, which is precisely why it works
  across an <code>await</code>.</p>

  <p class="define"><span class="define__term">Back pressure</span> A slow consumer causing a fast
  producer to slow down, rather than the difference accumulating somewhere. It is the mechanism that
  stops a speed mismatch becoming a memory problem.</p>

  <p class="define"><span class="define__term">Channel</span> A queue with an asynchronous reader and
  writer, in <code>System.Threading.Channels</code>. The producer awaits when it is full and the
  consumer awaits when it is empty, and neither occupies a thread while waiting.</p>

  <p><strong>An analogy, and its limits.</strong> A semaphore is a rack of ten visitor badges. You
  take one, do your business, put it back. When the rack is empty you wait. A channel is the in-tray
  between two desks: one person puts work in, the other takes it out, and neither has to stand there
  watching the other.</p>

  <p><strong>Where the analogy breaks:</strong> a badge you forget to return is gone forever, and
  nothing notices. Measured — three operations that threw without returning their permits left a
  semaphore of three with <strong>zero</strong> permits, so every later caller waits indefinitely on a
  limit that has silently become zero. And the in-tray, if nobody bounded it, will accept paper until
  the building collapses.</p>

  <h3>Why a lock cannot do this</h3>

  <p>A monitor is owned by a <em>thread</em>, so it cannot be held across an <code>await</code> —
  CS1996, from <a href="#/m/t2-12-locking">t2-12</a>. A semaphore counts permits and has no owner, so a
  permit taken before an <code>await</code> can be released after it, on whichever thread the
  continuation resumed on:</p>

  <pre data-lang="csharp" data-net="10" data-title="The async equivalent of lock"><code>await _gate.WaitAsync(ct);
try
{
    return await CallApiAsync(ct);
}
finally
{
    _gate.Release();          // not optional — see below
}</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><code>SemaphoreSlim(1,1)</code> is the closest thing C# has to an async lock, and it is
    <strong>not a drop-in replacement</strong>. A monitor is reentrant; a semaphore is not, because it
    counts permits rather than owners:</p>
    <pre data-lang="console" data-title="01-throttling.cs"><code>  nested Wait on the same SemaphoreSlim(1,1) : DEADLOCKED on the second Wait (timed out at 200 ms)</code></pre>
    <p>A thread waiting for a permit it already holds waits forever. This usually arrives by
    refactoring — a guarded method starts calling another guarded method, and neither author sees the
    other.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — the smallest program showing a concurrency limit that
// works, and a producer/consumer channel that shuts down cleanly.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

class Program
{
    static int _inFlight, _peak;

    static async Task Main()
    {
        // 1. A limit that actually limits.
        using var gate = new SemaphoreSlim(3, 3);          // note the maximum
        await Task.WhenAll(Enumerable.Range(0, 50).Select(async _ =&gt;
        {
            await gate.WaitAsync();
            try { await WorkAsync(); }
            finally { gate.Release(); }                    // the finally is not optional
        }));
        Console.WriteLine($"50 operations, limit 3, peak concurrent = {_peak}");

        // 2. A producer and a consumer that both finish.
        var channel = Channel.CreateBounded&lt;int&gt;(8);       // bounded: back pressure
        var consumer = Task.Run(async () =&gt;
        {
            var n = 0;
            await foreach (var _ in channel.Reader.ReadAllAsync()) n++;
            return n;
        });

        try
        {
            for (var i = 0; i &lt; 100; i++) await channel.Writer.WriteAsync(i);
        }
        finally
        {
            channel.Writer.Complete();                     // or the consumer waits forever
        }

        Console.WriteLine($"consumer read {await consumer} items, then the loop ended");
    }

    static async Task WorkAsync()
    {
        var now = Interlocked.Increment(ref _inFlight);
        var peak = Volatile.Read(ref _peak);
        while (now &gt; peak &amp;&amp; Interlocked.CompareExchange(ref _peak, now, peak) != peak)
            peak = Volatile.Read(ref _peak);
        try { await Task.Delay(20); }
        finally { Interlocked.Decrement(ref _inFlight); }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>50 operations, limit 3, peak concurrent = 3
consumer read 100 items, then the loop ended</code></pre>

  <p>Two primitives, and the two lines most often omitted from each.</p>

  <p><strong><code>new SemaphoreSlim(3, 3)</code> — note the second argument.</strong> The one-argument
  form has no maximum, so a stray <code>Release</code> silently raises the limit above what you
  intended. With a maximum it throws instead.</p>

  <p><strong>The <code>finally</code> around <code>Release</code>.</strong> An exception that skips it
  destroys a permit permanently.</p>

  <p><strong><code>Channel.CreateBounded(8)</code> rather than <code>CreateUnbounded()</code>.</strong>
  The producer now awaits when the queue is full, which is the entire back-pressure mechanism.</p>

  <p><strong><code>Writer.Complete()</code> in a <code>finally</code>.</strong>
  <code>ReadAllAsync</code> ends when the writer is completed, not when the queue empties — an empty
  channel is one waiting for more.</p>
</section>

<section id="throttling">
  <h2>Limiting concurrency</h2>

  <p>200 operations against a dependency, measured by peak simultaneous calls. That column is exact
  rather than a timing — it counts how many operations were inside the dependency at once:</p>

  <pre data-lang="console" data-title="01-throttling.cs"><code>  approach                            peak in flight   completed
  Task.WhenAll, unbounded                       200         200
  SemaphoreSlim(10)                              10         200
  Parallel.ForEachAsync(dop: 10)                 10         200</code></pre>

  <p><strong><code>Task.WhenAll</code> does not limit anything.</strong> It starts everything and
  waits. For five calls that is what you want; for two hundred against a partner that allows ten, it
  is a denial of service you wrote yourself.</p>

  <p><code>Parallel.ForEachAsync</code> is usually the better of the two fixes when you are fanning
  out over a collection: it takes the limit and a <code>CancellationToken</code> directly, and there
  is no permit to leak. Reach for <code>SemaphoreSlim</code> when the concurrency limit has to span
  something other than one loop — a shared client, several call sites, a whole service.</p>

  <h3>The three mistakes</h3>

  <p><strong>1. No <code>try/finally</code>.</strong></p>

  <pre data-lang="console" data-title="01-throttling.cs"><code>    started with 3 permits, 3 operations threw -&gt; 0 permits left
    the next caller waits forever on a semaphore nobody will release</code></pre>

  <p>This failure is worse than a deadlock because it is <em>delayed</em>. The service keeps working
  at a quietly reduced limit until enough failures accumulate, so the outage arrives long after the
  deployment that caused it and correlates with nothing.</p>

  <p><strong>2. <code>Wait()</code> instead of <code>WaitAsync()</code>.</strong></p>

  <pre data-lang="console" data-title="01-throttling.cs — same limit, same work"><code>    WaitAsync :  1.00x   (baseline)
    Wait      : 78.47x</code></pre>

  <p>It compiles, and it enforces the same limit. It also blocks a pool thread for every
  <em>waiter</em> rather than every worker, so a limit of four with two hundred callers holds nearly
  two hundred threads doing nothing — the starvation from
  <a href="#/m/t2-07-sync-over-async-deadlocks">t2-07</a>, with a limit bolted on top.</p>

  <p><strong>3. Releasing more than you took.</strong></p>

  <pre data-lang="console" data-title="01-throttling.cs"><code>    SemaphoreSlim(2) after two stray Releases: CurrentCount = 4
    SemaphoreSlim(2, 2) threw SemaphoreFullException on the stray Release</code></pre>

  <p><code>new SemaphoreSlim(10)</code> has no maximum; <code>new SemaphoreSlim(10, 10)</code> does.
  The second form turns a silent limit failure — your throttle quietly becoming a wider throttle —
  into an exception at the point of the bug. Worth the extra argument every time.</p>
</section>

<section id="channels">
  <h2>Channels, and the choice on the first line</h2>

  <pre data-lang="csharp" data-net="10" data-title="The whole API, for the common case"><code>var channel = Channel.CreateBounded&lt;Work&gt;(100);

// producer
await channel.Writer.WriteAsync(item, ct);

// consumer
await foreach (var item in channel.Reader.ReadAllAsync(ct))
    await ProcessAsync(item, ct);</code></pre>

  <p>40,000 items, produced faster than they are consumed:</p>

  <pre data-lang="console" data-title="02-channels.cs"><code>  channel                  peak queued   peak MB held   all items?
  Unbounded                        n/a            7.9   40,000 of 40,000
  Bounded(100), Wait               100            2.2   40,000 of 40,000
  Bounded(100), DropWrite           45            0.1   21,430 of 40,000
  Bounded(100), DropOldest          65            0.1   15,467 of 40,000</code></pre>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The unbounded row reports <code>n/a</code> for depth because an unbounded channel does not
    support <code>Count</code> at all — <code>CanCount</code> is false.</p>
    <p>That is worth knowing in its own right: <strong>the queue you cannot bound is also the one you
    cannot measure</strong>, so it will not appear on a dashboard before it kills you. Choosing a
    bounded channel is partly choosing to be able to see the problem.</p>
  </div>

  <p class="define"><span class="define__term">BoundedChannelFullMode</span> What a bounded channel
  does when it is full. <code>Wait</code> suspends the producer (back pressure);
  <code>DropWrite</code> discards the incoming item; <code>DropOldest</code> discards the oldest
  queued one. All three are silent about the choice at runtime.</p>

  <p><strong>"Bounded" sounds like a limit on memory. It is really a decision about <em>where</em> a
  speed mismatch shows up:</strong></p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Choice</th><th>Where the mismatch surfaces</th><th>Right for</th></tr></thead>
    <tbody>
      <tr><td>Unbounded</td><td>In memory, until the process is killed</td><td>Nothing, in a long-running service</td></tr>
      <tr><td><code>Wait</code></td><td>In the producer, which slows down</td><td>Anything that matters</td></tr>
      <tr><td><code>DropWrite</code> / <code>DropOldest</code></td><td>In the data, silently</td><td>Telemetry, metrics, traces</td></tr>
    </tbody>
  </table>
  </div>

  <p>Every system with a producer and a consumer makes this choice. The only question is whether it
  was made deliberately — and the API is equally happy to lose your payments as your metrics.</p>

  <p>If the producer is an HTTP handler, <code>Wait</code> gives you the behaviour you want for free:
  the request slows, the client sees latency, and their timeout performs the load shedding at the
  layer that can afford it.</p>

  <h3>Completion, and the hang that follows from forgetting it</h3>

  <pre data-lang="console" data-title="02-channels.cs"><code>  consumer with Complete() called   : finished, read 100 items
  consumer without Complete()       : HUNG - all 100 read, still awaiting more</code></pre>

  <p><code>ReadAllAsync</code> ends when the writer is <strong>completed</strong>, not when the queue
  is empty. Forget <code>Writer.Complete()</code> and the consumer awaits forever having processed
  every item — which looks like a hang with no cause, because the work is all done.</p>

  <pre data-lang="csharp" data-net="10" data-title="Completion that survives a failing producer"><code>try
{
    await ProduceAsync(channel.Writer, ct);
}
catch (Exception ex)
{
    channel.Writer.Complete(ex);      // ends the loop AND rethrows on the consumer
    throw;
}
finally
{
    channel.Writer.Complete();        // harmless if already completed
}</code></pre>

  <p><code>Complete(exception)</code> is better than a bare <code>Complete()</code> because a producer
  failure then <em>surfaces</em> on the consumer rather than looking like a clean end of stream:</p>

  <pre data-lang="console" data-title="02-channels.cs"><code>  consumer sees a faulted producer   : threw the producer failed</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>SingleReader</code> and <code>SingleWriter</code> measured at <strong>1.00×</strong> on a
    one-producer, one-consumer benchmark — no measurable gain at all.</p>
    <p>Set them because they are <em>true</em>, not because they are faster. They are promises rather
    than requests: set <code>SingleReader</code> and then read from two places and the behaviour is
    undefined, with nothing to check it. The realistic risk is a future edit adding a second consumer
    to a channel whose options nobody re-reads.</p>
  </div>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>The webhook dispatcher, in three designs, against a partner that has slowed to 40 ms:</p>

  <pre data-lang="console" data-title="03-production.cs"><code>  design                              peak concurrent   peak MB   delivered
  unbounded queue + WhenAll                    3,000      12.0   3,000 of 3,000
  unbounded queue + semaphore(8)                   8       9.1   3,000 of 3,000
  bounded(500) + semaphore(8)                      8       5.0   3,000 of 3,000</code></pre>

  <p><strong>Two separate defects, and fixing either alone leaves the other.</strong> Row two fixes
  the fan-out and still holds a growing backlog in memory. Row three fixes both.</p>

  <pre data-lang="csharp" data-net="10" data-title="The fix: two lines and one decision"><code>_queue = Channel.CreateBounded&lt;WebhookEvent&gt;(new BoundedChannelOptions(500)
{
    FullMode = BoundedChannelFullMode.Wait,
});

await Parallel.ForEachAsync(batch,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    (e, token) =&gt; _http.PostAsync(e, token));</code></pre>

  <p>The decision is <code>FullMode</code>, and it is a business decision wearing an API's clothes.
  For webhooks about money the answer is <code>Wait</code> — and if the queue stays full, that is a
  signal to alert on rather than a reason to widen the queue.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Without back pressure, a service becomes more aggressive precisely as its dependency
    gets slower.</strong> The fan-out width was set by the backlog rather than by capacity, so
    slowness produced a larger burst, which produced more slowness. Ledger was a load generator
    pointed at a partner that was already struggling.</p>
    <p>That is the loop back pressure breaks. A throttled sender holds its rate steady while latency
    rises; an unthrottled one raises its rate, and the two systems take each other down together.</p>
  </div>

  <h3>What back pressure does to the producer</h3>

  <pre data-lang="console" data-title="03-production.cs"><code>  producer with a fast consumer :  1.00x  (baseline)
  producer with a slow consumer :  1.32x</code></pre>

  <p><strong>That slowdown is the feature.</strong> The producer is being told, through the only
  channel available to it, that the downstream cannot keep up.</p>

  <p>It is also the objection people raise: <em>we cannot slow down the settlement path</em>. The
  honest answer is that you are already slowing it down — the unbounded version does not avoid the
  cost, it defers it into memory and then pays it all at once, as an outage that also loses the
  queue.</p>

  <h3>The shutdown bug the same design had</h3>

  <pre data-lang="console" data-title="03-production.cs"><code>  drained on shutdown, with Complete()     : shut down cleanly after 50 events
  drained on shutdown, without Complete()  : HUNG with 50 events read and the queue empty</code></pre>

  <p>A shutdown path that stops enqueueing and waits for the consumer waits forever, because the
  writer was never completed. In a hosted service that means <code>StopAsync</code> hangs, the host
  waits out its shutdown timeout, and the orchestrator sends <code>SIGKILL</code> — losing exactly the
  queued work that graceful shutdown existed to protect.</p>

  <pre data-lang="csharp" data-net="10" data-title="Draining a channel on shutdown"><code>public async Task StopAsync(CancellationToken ct)
{
    _queue.Writer.Complete();              // let the consumer see the end
    await _consumerTask.WaitAsync(ct);     // then wait for it to drain
}</code></pre>

  <h3>How it was diagnosed</h3>

  <pre data-lang="console" data-title="The signature"><code>gc-heap-size              climbing steadily, never falling
cpu-usage                 low
monitor-lock-contention   flat
outbound request rate     HIGH, and RISING as the dependency slows</code></pre>

  <p><strong>That last line is what identifies it, and it is counter-intuitive.</strong> A service
  under back pressure sends <em>fewer</em> requests as its dependency slows. A service without back
  pressure sends <em>more</em>. If your outbound rate rises while your dependency's latency rises, you
  have no back pressure anywhere in that path.</p>

  <p>The queue depth would have caught this months earlier — and an unbounded channel cannot report
  one.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. <code>Task.WhenAll</code> used as a throttle</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: starts all 200 at once"><code>// WRONG. WhenAll waits for completion; it does not schedule.
await Task.WhenAll(events.Select(e =&gt; _http.PostAsync(e, ct)));

// Right, when fanning out over a collection.
await Parallel.ForEachAsync(events,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    (e, token) =&gt; _http.PostAsync(e, token));</code></pre>

  <h3>2. A permit released outside a <code>finally</code></h3>

  <p>Measured: three failures reduced a semaphore of three to zero permits, permanently. Delayed,
  silent, and correlates with no deployment.</p>

  <h3>3. <code>Wait()</code> where <code>WaitAsync()</code> was meant</h3>

  <p>Measured at 78× slower for the same limit and the same work, because it blocks a thread per
  waiter.</p>

  <h3>4. <code>CreateUnbounded</code> by default</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: no back pressure, and no visibility"><code>// WRONG in a long-running service. The writer always succeeds, so a slow
// consumer becomes a memory leak — and CanCount is false, so no dashboard
// can show you the backlog before it kills the process.
var queue = Channel.CreateUnbounded&lt;WebhookEvent&gt;();

// Right: choose the bound and the behaviour deliberately.
var queue = Channel.CreateBounded&lt;WebhookEvent&gt;(new BoundedChannelOptions(500)
{
    FullMode = BoundedChannelFullMode.Wait,
    SingleReader = true,
});</code></pre>

  <h3>5. Forgetting <code>Writer.Complete()</code></h3>

  <p>Measured: the consumer hung with every item read. It presents as a hang with no cause, because
  all the work is finished.</p>

  <h3>6. Treating <code>SemaphoreSlim(1,1)</code> as a reentrant lock</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: deadlocks on the nested call"><code>// WRONG. A semaphore counts permits, not owners, so this waits for a permit
// the same execution already holds.
async Task OuterAsync()
{
    await _gate.WaitAsync();
    try     { await InnerAsync(); }        // InnerAsync also waits on _gate
    finally { _gate.Release(); }
}

// Right: separate the guarded core from the entry point.
async Task OuterAsync()
{
    await _gate.WaitAsync();
    try     { await CoreAsync(); }         // assumes the permit is already held
    finally { _gate.Release(); }
}</code></pre>

  <h3>7. <code>new SemaphoreSlim(n)</code> without a maximum</h3>

  <p>A stray <code>Release</code> silently widens the limit — measured, a semaphore of 2 reporting a
  count of 4. The two-argument form throws instead.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> memory climbs steadily and never falls, CPU is low, and your outbound
    request rate <em>rises</em> as a dependency slows down.</p>
    <p><strong>Why:</strong> an unbounded queue with an unthrottled consumer. The backlog sets the
    fan-out width, so slowness makes the sender more aggressive.</p>
    <p><strong>Tool:</strong> a queue-depth metric — which requires having chosen a bounded channel:</p>
    <pre data-lang="csharp" data-net="10" data-title="Exposing the number that matters"><code>// CanCount is false for unbounded channels, so this only works if you bounded it.
if (_queue.Reader.CanCount)
    _metrics.RecordQueueDepth(_queue.Reader.Count);</code></pre>
    <p><strong>Reading it:</strong> a depth that reaches capacity and stays there means the consumer
    is the bottleneck and back pressure is engaged — which is working as designed, and is the signal
    to scale the consumer. A depth that is always zero means the queue is not your problem.</p>
    <p><strong>Fix:</strong> bound the channel, throttle the fan-out, and alert on sustained depth.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> throughput degrades gradually over days and recovers on restart, with
    no leak and no growth in memory.</p>
    <p><strong>Why:</strong> leaked semaphore permits. Each failure that skipped a
    <code>Release</code> permanently lowers your concurrency limit, so the service throttles itself
    tighter and tighter.</p>
    <p><strong>Tool:</strong> expose <code>CurrentCount</code>. It is one line and it turns an
    invisible failure into a graph:</p>
    <pre data-lang="csharp" data-net="10" data-title="The one metric that finds a leaked permit"><code>_metrics.RecordGauge("dispatcher.permits_available", _gate.CurrentCount);</code></pre>
    <p><strong>Reading it:</strong> a ceiling that decreases over time and never recovers is a leak.
    It should fluctuate between zero and the maximum; a maximum observed value that keeps dropping is
    conclusive.</p>
    <p><strong>Fix:</strong> <code>try/finally</code>, and construct with the two-argument form so
    over-release throws rather than masking it.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a background service hangs on shutdown, and the orchestrator kills
    it after the grace period.</p>
    <p><strong>Why:</strong> <code>ReadAllAsync</code> is waiting for a writer that was never
    completed. The queue is empty and the consumer is still awaiting more.</p>
    <p><strong>Tool:</strong> a dump, and <code>dumpasync</code>
    (<a href="#/m/t2-05-async-state-machine">t2-05</a>) rather than <code>clrstack</code> — the
    consumer is <em>suspended</em>, not blocked, so it appears on no thread's stack:</p>
    <pre data-lang="console" data-title="Finding a consumer waiting on an incomplete writer"><code>dotnet-dump collect --process-id 4812
&gt; dumpasync --stats        # a state machine parked in ReadAllAsync</code></pre>
    <p><strong>Fix:</strong> <code>Writer.Complete()</code> in <code>StopAsync</code>, before awaiting
    the consumer task. And in a <code>finally</code> around the producer, so a failing producer does
    not strand the consumer.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a partner complains about request bursts, and your average rate looks
    reasonable.</p>
    <p><strong>Why:</strong> averages hide fan-out. A batch of 3,000 sent simultaneously and then
    nothing has the same average as a steady trickle.</p>
    <p><strong>Tool:</strong> measure peak concurrency directly rather than inferring it from a rate.
    An <code>Interlocked</code> counter around the call is enough:</p>
    <pre data-lang="csharp" data-net="10" data-title="Peak concurrency, which a rate cannot show you"><code>var now = Interlocked.Increment(ref _inFlight);
try     { await _http.PostAsync(e, ct); }
finally { Interlocked.Decrement(ref _inFlight); }
// track the maximum of 'now' with a CAS loop (t2-13) and expose it as a gauge</code></pre>
    <p><strong>Reading it:</strong> a peak far above your intended limit means the limit is not
    applied on that path. Measured here, 3,000 against an intended 8.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Without back pressure a system gets louder as it gets sicker.</strong> Ledger's fan-out
    width was set by its backlog, so a partner slowing from 5 ms to 400 ms produced a burst of 3,000
    concurrent requests at a service already in trouble. Back pressure inverts that: the sender slows
    as the receiver slows, which is the behaviour every layer of a healthy system needs and which no
    amount of retry logic can substitute for.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>An unbounded queue converts a latency problem into a durability problem.</strong> The
    backlog grew until the pod was OOM-killed, and everything queued was lost — webhooks about settled
    payments. The original defect was a slow partner, which is survivable; the outcome was permanent
    data loss, which is not. And because <code>CanCount</code> is false on an unbounded channel, no
    dashboard could have shown the backlog growing beforehand.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A leaked permit is a self-inflicted throttle that tightens over time.</strong> Three
    exceptions took a limit of three to zero. In production this presents as gradual degradation that
    recovers on restart and correlates with no deployment — the hardest shape of failure to attribute,
    and it is prevented by a <code>finally</code> and diagnosed by exposing one gauge.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>Task.WhenAll</code> limits concurrency."</strong> It waits for completion; it
    does not schedule. Measured: 200 operations, peak 200 in flight. Use
    <code>Parallel.ForEachAsync</code> or a <code>SemaphoreSlim</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>SemaphoreSlim(1,1)</code> is an async <code>lock</code>."</strong> It is the
    closest available thing and it is <strong>not reentrant</strong> — verified, a nested wait
    deadlocks. A monitor counts recursion for its owning thread; a semaphore counts permits and does
    not know who holds them.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>Wait()</code> and <code>WaitAsync()</code> differ only in style."</strong>
    Measured at 78× on the same work with the same limit. <code>Wait</code> blocks a pool thread for
    every waiter, not every worker.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Unbounded is the safe default — I can bound it later."</strong> Unbounded <em>is</em> a
    choice: absorb any speed mismatch in memory until the process dies. It also cannot be measured, so
    you will not see it coming.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Back pressure slows down my service, so I do not want it."</strong> You are already
    slowed down. Without back pressure the cost is deferred into memory and paid all at once as an
    outage that also loses the queue. Measured: a 1.32× producer slowdown, against an OOM kill.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The consumer stops when the queue is empty."</strong> It stops when the
    <strong>writer is completed</strong>. Verified: every item read, consumer still hung. An empty
    channel is a channel waiting for more.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>SingleReader</code> makes it faster, so set it."</strong> Measured at 1.00× — no
    difference on a one-producer, one-consumer benchmark. Set it because it is true; it is a promise
    the channel relies on, and a future second consumer makes the behaviour undefined with nothing to
    catch it.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <p>Every answer below is produced by running <code>04-exercises.cs</code>, included in full at the
  end of the module.</p>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Does this limit how many calls hit the API at once?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>await Task.WhenAll(items.Select(i =&gt; CallApiAsync(i)));</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  approach                         peak concurrent
    Task.WhenAll                               100
    SemaphoreSlim(5)                             5
    Parallel.ForEachAsync(dop 5)                 5</code></pre>
        <p><strong>No.</strong> <code>WhenAll</code> waits for completion; it does not schedule. Every
        task is started by <code>Select</code> before <code>WhenAll</code> is even called — a
        <code>Task</code> is hot (<a href="#/m/t2-04-task-and-valuetask">t2-04</a>), so the work begins
        at construction.</p>
        <p><strong>Prefer <code>Parallel.ForEachAsync</code></strong> when fanning out over a
        collection: it takes the limit and a <code>CancellationToken</code> directly, and there is no
        permit to leak.</p>
        <p><strong>Reach for <code>SemaphoreSlim</code></strong> when the limit must span more than one
        loop — a shared HTTP client used from several call sites, or a limit that belongs to the
        service rather than to one operation.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Find the bug, and say when it will be noticed.</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 2"><code>await _gate.WaitAsync(ct);
var result = await CallApiAsync(ct);   // this can throw
_gate.Release();
return result;</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    3 permits, 3 failed operations -&gt; 0 permits remain</code></pre>
        <p><strong>A throw skips the <code>Release</code>, and the permit is gone permanently.</strong>
        Three failures exhaust a semaphore of three, and every later caller waits forever on a limit
        that has silently become zero.</p>
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>await _gate.WaitAsync(ct);
try     { return await CallApiAsync(ct); }
finally { _gate.Release(); }</code></pre>
        <p><strong>When it is noticed is the interesting part.</strong> Not at the failure — the
        service keeps working, at a quietly reduced limit. It degrades as failures accumulate, and the
        outage arrives days after the deployment that caused it, correlating with nothing.</p>
        <p>That shape — gradual degradation that recovers on restart — is worth memorising, because it
        is the same signature as several other resource leaks and it is the reason
        <code>CurrentCount</code> is worth exposing as a gauge.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Both enforce the same limit. What is the difference?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>_gate.Wait();              // (a)
await _gate.WaitAsync();   // (b)</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    WaitAsync :   1.00x  (baseline)
    Wait      :  70.61x</code></pre>
        <p><strong><code>Wait</code> blocks a pool thread for every waiter</strong>, not every worker.
        A limit of 4 with 120 callers holds 116 threads doing nothing — the starvation from
        <a href="#/m/t2-07-sync-over-async-deadlocks">t2-07</a>, with a throttle bolted on top.</p>
        <p><code>WaitAsync</code> suspends without a thread, so the 116 waiting operations occupy
        nothing at all.</p>
        <p>This is also why <code>SemaphoreSlim</code> exists as the async lock. A monitor is owned by
        a thread and cannot be held across an <code>await</code> (CS1996,
        <a href="#/m/t2-12-locking">t2-12</a>). A semaphore counts permits and has no owner, so a
        permit taken before an <code>await</code> can be released after it, on a different thread.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A producer is faster than its consumer. Choose the channel, and justify it.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  channel                 peak MB   delivered
    Unbounded                 1.9   20,000
    Bounded(100) Wait         1.4   20,000
    Bounded(100) DropWrite    1.8   12,068</code></pre>
        <p><strong>Unbounded is not a choice to postpone — it is a choice</strong>, and it says
        "absorb any speed mismatch in memory until the process dies". Over a short run with a fixed
        item count the memory difference is modest; with a continuous producer it is unbounded, and
        the larger 40,000-item run in this module measured 7.9 MB against 2.2 MB.</p>
        <p><strong>Bounded makes you decide where the mismatch surfaces.</strong> <code>Wait</code>
        puts it in the producer, which slows down. <code>DropWrite</code> puts it in the data —
        note the delivered column, which lost 40% of the items silently.</p>
        <p><strong>Choose <code>Wait</code> for anything that matters</strong> and <code>Drop</code>
        for telemetry you would rather lose than have slow the system down. The API is equally happy
        to lose payments as metrics, so the decision has to be conscious.</p>
        <p>One more reason to bound it: <code>CanCount</code> is false on an unbounded channel, so you
        cannot expose queue depth as a metric. The queue you cannot bound is the one you cannot
        see.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Why does the consumer never finish?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 5"><code>for (var i = 0; i &lt; 100; i++)
    await channel.Writer.WriteAsync(i);

await consumerTask;      // never returns</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    without Complete() : HUNG with all 100 items read
    with Complete()    : finished after 100 items</code></pre>
        <p><strong><code>ReadAllAsync</code> ends when the writer is completed, not when the queue is
        empty.</strong> An empty channel is not a finished one — it is a channel waiting for the next
        item, which is exactly the behaviour you want from a long-running consumer.</p>
        <p>It presents as a hang with no cause, because every item has already been processed.</p>
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>try
{
    for (var i = 0; i &lt; 100; i++)
        await channel.Writer.WriteAsync(i, ct);
}
catch (Exception ex)
{
    channel.Writer.Complete(ex);     // the consumer rethrows this
    throw;
}
finally
{
    channel.Writer.Complete();       // harmless if already completed
}</code></pre>
        <p><strong>Prefer <code>Complete(exception)</code> on the failure path.</strong> Verified: the
        consumer rethrows, so a producer failure surfaces instead of looking like a clean end of
        stream — which would otherwise be indistinguishable from success.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Match each need to a primitive, and name the two that are most often confused.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  need                                        use
  limit concurrent calls to a dependency      SemaphoreSlim / ForEachAsync
  mutual exclusion across an await            SemaphoreSlim(1,1)
  mutual exclusion, no await inside           lock (cheaper, reentrant)
  hand work to a background processor         Channel
  fan out CPU work over cores                 Parallel.For (t2-10)
  wait for N things to finish                 Task.WhenAll
  first of N, cancel the rest                 Task.WhenAny + linked CTS</code></pre>
        <p><strong>The two most often confused.</strong> <code>Task.WhenAll</code> is not a throttle —
        measured, 200 operations at a peak of 200. And <code>Parallel.For</code> is not for I/O:
        <a href="#/m/t2-10-parallelism">t2-10</a> measured 8.5× against <code>Task.WhenAll</code>'s
        214× on identical I/O work, and it bought that by occupying a thread per operation.</p>
        <p><strong>A third worth adding.</strong> <code>SemaphoreSlim(1,1)</code> is not a drop-in for
        <code>lock</code>:</p>
        <pre data-lang="console" data-title="Actual output"><code>  deadlocks: DEADLOCKED on the nested Wait</code></pre>
        <p>A monitor is reentrant; a semaphore is not. Use <code>lock</code> when there is no
        <code>await</code> inside the critical section — it is cheaper and it forgives nesting. Use
        <code>SemaphoreSlim</code> only when you genuinely must hold the guard across an
        <code>await</code>, and structure the code so no guarded method calls another.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 01-throttling.cs -c Release</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-throttling.cs"><code>// 01-throttling.cs — the async-safe way to limit concurrency, and the three
// mistakes that make a limiter not limit.
//
// Concurrency observations are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-throttling.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static int _inFlight;
    static int _peak;

    static void Main()
    {
        Console.WriteLine("=== the problem WhenAll does not solve ===");
        Console.WriteLine();
        Console.WriteLine("  Task.WhenAll starts everything at once. For 5 calls that is what you");
        Console.WriteLine("  want; for 500 against a service that allows 10, it is a denial of");
        Console.WriteLine("  service you wrote yourself.");
        Console.WriteLine();
        Console.WriteLine("  200 operations against a dependency, measured by peak concurrency:");
        Console.WriteLine();
        Console.WriteLine("  approach                            peak in flight   completed");

        Report("Task.WhenAll, unbounded", RunUnbounded());
        Report("SemaphoreSlim(10)", RunSemaphore(10));
        Report("Parallel.ForEachAsync(dop: 10)", RunParallelForEachAsync(10));

        Console.WriteLine();
        Console.WriteLine("  The peak column is the whole point, and it is exact rather than a");
        Console.WriteLine("  timing: it counts how many operations were simultaneously inside the");
        Console.WriteLine("  dependency. Unbounded means every one of them at once.");

        Console.WriteLine();
        Console.WriteLine("=== why a lock cannot do this ===");
        Console.WriteLine();
        Console.WriteLine("  A monitor is owned by a THREAD, so it cannot be held across an await");
        Console.WriteLine("  (t2-12, CS1996). SemaphoreSlim counts PERMITS and has no owner, so a");
        Console.WriteLine("  permit taken on one thread can be released on another — which is");
        Console.WriteLine("  exactly what happens when a continuation resumes elsewhere.");
        Console.WriteLine();
        Console.WriteLine("      await _gate.WaitAsync(ct);");
        Console.WriteLine("      try     { await DoWorkAsync(ct); }");
        Console.WriteLine("      finally { _gate.Release(); }");
        Console.WriteLine();
        Console.WriteLine("  That is the async equivalent of lock, and the try/finally is not");
        Console.WriteLine("  optional — see mistake 1 below.");

        Console.WriteLine();
        Console.WriteLine("=== the three mistakes ===");
        Console.WriteLine();
        Console.WriteLine("  MISTAKE 1: no try/finally. One exception and the permit is gone");
        Console.WriteLine("  forever. Permits do not come back on their own.");
        Console.WriteLine();
        var leaked = PermitLeak();
        Console.WriteLine($"    started with 3 permits, 3 operations threw -&gt; {leaked} permits left");
        Console.WriteLine("    the next caller waits forever on a semaphore nobody will release");

        Console.WriteLine();
        Console.WriteLine("  MISTAKE 2: Wait() instead of WaitAsync(). It compiles. It blocks a");
        Console.WriteLine("  pool thread for the whole queue (t2-07).");
        Console.WriteLine();
        var (asyncMs, blockingMs) = WaitVsWaitAsync();
        Console.WriteLine($"    WaitAsync : {1.0,5:N2}x   (baseline)");
        Console.WriteLine($"    Wait      : {blockingMs / asyncMs,5:N2}x");
        Console.WriteLine("    Same limit, same work. The blocking version holds one pool thread");
        Console.WriteLine("    per WAITER, not per worker — so 200 queued callers occupy 200");
        Console.WriteLine("    threads doing nothing.");

        Console.WriteLine();
        Console.WriteLine("  MISTAKE 3: releasing more than you took. SemaphoreSlim will let you");
        Console.WriteLine("  raise the count above the initial value, silently widening the limit");
        Console.WriteLine("  you thought you had set:");
        Console.WriteLine();
        Console.WriteLine($"    {OverRelease()}");
        Console.WriteLine();
        Console.WriteLine("  Pass maxCount to the constructor and it throws instead:");
        Console.WriteLine($"    {OverReleaseGuarded()}");
        Console.WriteLine();
        Console.WriteLine("  new SemaphoreSlim(10) has NO maximum. new SemaphoreSlim(10, 10) does.");
        Console.WriteLine("  The second form turns a silent limit failure into an exception at the");
        Console.WriteLine("  point of the bug, which is worth the extra argument every time.");

        Console.WriteLine();
        Console.WriteLine("=== it is not reentrant, and lock is ===");
        Console.WriteLine();
        Console.WriteLine($"  nested Wait on the same SemaphoreSlim(1,1) : {NestedSemaphore()}");
        Console.WriteLine();
        Console.WriteLine("  A monitor counts recursion for the owning thread, so nesting works");
        Console.WriteLine("  (t2-12). A semaphore counts permits and has no idea who holds them,");
        Console.WriteLine("  so a thread waiting for a permit it already holds waits forever.");
        Console.WriteLine();
        Console.WriteLine("  This is the most common way a SemaphoreSlim deadlocks, and it usually");
        Console.WriteLine("  arrives by refactoring: a guarded method starts calling another");
        Console.WriteLine("  guarded method, and neither author sees the other.");
    }

    static async Task&lt;string&gt; WorkAsync(CancellationToken ct = default)
    {
        var now = Interlocked.Increment(ref _inFlight);
        var peak = Volatile.Read(ref _peak);
        while (now &gt; peak &amp;&amp; Interlocked.CompareExchange(ref _peak, now, peak) != peak)
            peak = Volatile.Read(ref _peak);
        try
        {
            await Task.Delay(20, ct).ConfigureAwait(false);
            return "ok";
        }
        finally { Interlocked.Decrement(ref _inFlight); }
    }

    readonly record struct Result(int Peak, int Completed);

    static Result RunUnbounded()
    {
        Reset();
        var done = Task.WhenAll(Enumerable.Range(0, 200).Select(_ =&gt; WorkAsync()));
        done.GetAwaiter().GetResult();
        return new Result(Volatile.Read(ref _peak), done.Result.Length);
    }

    static Result RunSemaphore(int limit)
    {
        Reset();
        using var gate = new SemaphoreSlim(limit, limit);
        var completed = 0;

        Task.WhenAll(Enumerable.Range(0, 200).Select(async _ =&gt;
        {
            await gate.WaitAsync().ConfigureAwait(false);
            try
            {
                await WorkAsync().ConfigureAwait(false);
                Interlocked.Increment(ref completed);
            }
            finally { gate.Release(); }
        })).GetAwaiter().GetResult();

        return new Result(Volatile.Read(ref _peak), completed);
    }

    static Result RunParallelForEachAsync(int dop)
    {
        Reset();
        var completed = 0;
        Parallel.ForEachAsync(
            Enumerable.Range(0, 200),
            new ParallelOptions { MaxDegreeOfParallelism = dop },
            async (i, ct) =&gt;
            {
                await WorkAsync(ct).ConfigureAwait(false);
                Interlocked.Increment(ref completed);
            }).GetAwaiter().GetResult();
        return new Result(Volatile.Read(ref _peak), completed);
    }

    static void Reset()
    {
        Thread.Sleep(80);
        Volatile.Write(ref _inFlight, 0);
        Volatile.Write(ref _peak, 0);
    }

    static void Report(string label, Result r) =&gt;
        Console.WriteLine($"  {label,-34} {r.Peak,14}   {r.Completed,9}");

    // --- mistake 1 ------------------------------------------------------------
    static int PermitLeak()
    {
        var gate = new SemaphoreSlim(3, 3);
        for (var i = 0; i &lt; 3; i++)
        {
            try
            {
                gate.Wait();
                throw new InvalidOperationException("the operation failed");
                // no finally: the permit is never returned
            }
            catch (InvalidOperationException) { }
        }
        return gate.CurrentCount;
    }

    // --- mistake 2 ------------------------------------------------------------
    static (double asyncMs, double blockingMs) WaitVsWaitAsync()
    {
        var a = TimeQueue(useAsync: true);
        var b = TimeQueue(useAsync: false);
        return (a, b);
    }

    static double TimeQueue(bool useAsync)
    {
        Thread.Sleep(120);
        using var gate = new SemaphoreSlim(4, 4);
        var sw = Stopwatch.StartNew();

        Task.WhenAll(Enumerable.Range(0, 120).Select(_ =&gt; Task.Run(async () =&gt;
        {
            if (useAsync) await gate.WaitAsync().ConfigureAwait(false);
            else gate.Wait();
            try { await Task.Delay(15).ConfigureAwait(false); }
            finally { gate.Release(); }
        }))).GetAwaiter().GetResult();

        return sw.Elapsed.TotalMilliseconds;
    }

    // --- mistake 3 ------------------------------------------------------------
    static string OverRelease()
    {
        var gate = new SemaphoreSlim(2);           // no maximum
        gate.Release();
        gate.Release();
        return $"SemaphoreSlim(2) after two stray Releases: CurrentCount = {gate.CurrentCount}";
    }

    static string OverReleaseGuarded()
    {
        var gate = new SemaphoreSlim(2, 2);        // maximum of 2
        try
        {
            gate.Release();
            return "no exception (unexpected)";
        }
        catch (SemaphoreFullException)
        {
            return "SemaphoreSlim(2, 2) threw SemaphoreFullException on the stray Release";
        }
    }

    // --- reentrancy -----------------------------------------------------------
    static string NestedSemaphore()
    {
        var gate = new SemaphoreSlim(1, 1);
        gate.Wait();
        var second = gate.Wait(TimeSpan.FromMilliseconds(200));
        if (second) { gate.Release(); gate.Release(); return "entered twice (unexpected)"; }
        gate.Release();
        return "DEADLOCKED on the second Wait (timed out at 200 ms)";
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-channels.cs"><code>// 02-channels.cs — producer/consumer with System.Threading.Channels, and the
// thing that actually matters about them: what happens when the consumer cannot
// keep up.
//
// Memory and item counts are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-channels.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

class Program
{
    const int Items = 40_000;
    const int PayloadBytes = 1024;

    static void Main()
    {
        Console.WriteLine("=== the shape ===");
        Console.WriteLine();
        Console.WriteLine("  A channel is a queue with an async reader and an async writer. The");
        Console.WriteLine("  producer awaits when it is full; the consumer awaits when it is");
        Console.WriteLine("  empty. Neither blocks a thread while waiting.");
        Console.WriteLine();
        Console.WriteLine("      var channel = Channel.CreateBounded&lt;Work&gt;(100);");
        Console.WriteLine("      await channel.Writer.WriteAsync(item, ct);      // producer");
        Console.WriteLine("      await foreach (var i in channel.Reader.ReadAllAsync(ct))  // consumer");
        Console.WriteLine();
        Console.WriteLine("  That is the whole API for the common case. What matters is the");
        Console.WriteLine("  choice on the first line.");

        Console.WriteLine();
        Console.WriteLine("=== bounded against unbounded, when the consumer is slower ===");
        Console.WriteLine();
        Console.WriteLine($"  {Items:N0} items of {PayloadBytes:N0} bytes, produced faster than consumed:");
        Console.WriteLine();
        Console.WriteLine("  channel                  peak queued   peak MB held   all items?");

        Report("Unbounded", RunUnbounded());
        Report("Bounded(100), Wait", RunBounded(100, BoundedChannelFullMode.Wait));
        Report("Bounded(100), DropWrite", RunBounded(100, BoundedChannelFullMode.DropWrite));
        Report("Bounded(100), DropOldest", RunBounded(100, BoundedChannelFullMode.DropOldest));

        Console.WriteLine();
        Console.WriteLine("  An unbounded channel reports n/a for depth because it does not");
        Console.WriteLine("  support Count at all — CanCount is false. That is itself worth");
        Console.WriteLine("  knowing: the queue you cannot bound is also the one you cannot");
        Console.WriteLine("  measure, so it will not appear on a dashboard before it kills you.");
        Console.WriteLine("  Read the MEMORY column for it instead.");
        Console.WriteLine();
        Console.WriteLine("  UNBOUNDED is the default people reach for and it is a memory leak");
        Console.WriteLine("  with extra steps. It held several times the memory of the bounded");
        Console.WriteLine("  version here, over a short run with a fixed number of items. With a");
        Console.WriteLine("  continuous producer the queue grows until the process dies, and there");
        Console.WriteLine("  is no back pressure and no error — the writer always succeeds.");
        Console.WriteLine();
        Console.WriteLine("  BOUNDED + WAIT is back pressure. The producer awaits when the queue");
        Console.WriteLine("  is full, so it slows to the consumer's pace. Memory is bounded by the");
        Console.WriteLine("  capacity you chose rather than by the speed difference.");
        Console.WriteLine();
        Console.WriteLine("  BOUNDED + DROP is load shedding: it keeps up by losing data. Note the");
        Console.WriteLine("  last column. That is the right trade for telemetry and metrics, and");
        Console.WriteLine("  the wrong one for payments — and the API will not stop you choosing");
        Console.WriteLine("  it for either.");

        Console.WriteLine();
        Console.WriteLine("=== back pressure is the point ===");
        Console.WriteLine();
        Console.WriteLine("  'Bounded' sounds like a limit on memory. It is really a decision");
        Console.WriteLine("  about WHERE a speed mismatch shows up:");
        Console.WriteLine();
        Console.WriteLine("    unbounded   -&gt; in memory, until the process is killed");
        Console.WriteLine("    Wait        -&gt; in the producer, which slows down");
        Console.WriteLine("    DropWrite   -&gt; in the data, silently");
        Console.WriteLine();
        Console.WriteLine("  Every system with a producer and a consumer makes this choice. The");
        Console.WriteLine("  only question is whether it was made deliberately.");
        Console.WriteLine();
        Console.WriteLine("  If the producer is an HTTP handler, Wait gives you the behaviour you");
        Console.WriteLine("  want for free: the request slows down, the client sees latency, and");
        Console.WriteLine("  their timeout does the load shedding for you at the right layer.");

        Console.WriteLine();
        Console.WriteLine("=== completion, and the deadlock that follows from getting it wrong ===");
        Console.WriteLine();
        Console.WriteLine($"  consumer with Complete() called   : {WithCompletion()}");
        Console.WriteLine($"  consumer without Complete()       : {WithoutCompletion()}");
        Console.WriteLine();
        Console.WriteLine("  ReadAllAsync ends when the writer is COMPLETED, not when the queue is");
        Console.WriteLine("  empty — an empty channel is not a finished one, it is a channel");
        Console.WriteLine("  waiting for more. Forget Writer.Complete() and the consumer awaits");
        Console.WriteLine("  forever, having processed everything.");
        Console.WriteLine();
        Console.WriteLine("  Put it in a finally, because a producer that throws must still");
        Console.WriteLine("  complete the channel or it takes the consumer down with it:");
        Console.WriteLine();
        Console.WriteLine("      try     { await ProduceAsync(writer, ct); }");
        Console.WriteLine("      finally { writer.Complete(); }");
        Console.WriteLine();
        Console.WriteLine("  Complete(exception) is better still: it ends the loop AND rethrows on");
        Console.WriteLine("  the consumer, so a producer failure surfaces rather than looking like");
        Console.WriteLine("  a clean end of stream.");
        Console.WriteLine($"  consumer sees a faulted producer   : {FaultedProducer()}");

        Console.WriteLine();
        Console.WriteLine("=== the single-reader and single-writer options ===");
        Console.WriteLine();
        var (general, specialised) = ReaderWriterOptions();
        Console.WriteLine($"  default options                    : {1.0,5:N2}x  (baseline)");
        Console.WriteLine($"  SingleReader + SingleWriter        : {specialised / general,5:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Effectively no difference on this workload, and that is the honest");
        Console.WriteLine("  result. These options let the channel skip synchronisation it would");
        Console.WriteLine("  otherwise need, but the saving is small next to the cost of moving");
        Console.WriteLine("  400,000 items, and a microbenchmark with one producer and one");
        Console.WriteLine("  consumer is close to the best case for the default path anyway.");
        Console.WriteLine();
        Console.WriteLine("  Set them because they are TRUE, not because they are faster. They are");
        Console.WriteLine("  promises rather than requests: if you set SingleReader and then read");
        Console.WriteLine("  from two places, the behaviour is undefined and nothing checks. The");
        Console.WriteLine("  risk is a future edit adding a second consumer to a channel whose");
        Console.WriteLine("  options nobody re-reads.");
    }

    readonly record struct Result(int PeakQueued, bool CanCount, double PeakMb, int Consumed);

    static Result RunUnbounded() =&gt;
        Run(Channel.CreateUnbounded&lt;byte[]&gt;(new UnboundedChannelOptions { SingleWriter = true, SingleReader = true }));

    static Result RunBounded(int capacity, BoundedChannelFullMode mode) =&gt;
        Run(Channel.CreateBounded&lt;byte[]&gt;(new BoundedChannelOptions(capacity)
        {
            FullMode = mode,
            SingleWriter = true,
            SingleReader = true
        }));

    static Result Run(Channel&lt;byte[]&gt; channel)
    {
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var peakQueued = 0;
        var peakBytes = 0L;
        var consumed = 0;

        var producer = Task.Run(async () =&gt;
        {
            try
            {
                for (var i = 0; i &lt; Items; i++)
                    await channel.Writer.WriteAsync(new byte[PayloadBytes]).ConfigureAwait(false);
            }
            finally { channel.Writer.Complete(); }
        });

        var sampler = Task.Run(async () =&gt;
        {
            while (!producer.IsCompleted)
            {
                if (channel.Reader.CanCount)
                {
                    var q = channel.Reader.Count;
                    if (q &gt; peakQueued) peakQueued = q;
                }
                var mem = GC.GetTotalMemory(false) - before;
                if (mem &gt; peakBytes) peakBytes = mem;
                await Task.Delay(1).ConfigureAwait(false);
            }
        });

        var consumer = Task.Run(async () =&gt;
        {
            await foreach (var item in channel.Reader.ReadAllAsync().ConfigureAwait(false))
            {
                consumed++;
                if ((consumed &amp; 0x3F) == 0) await Task.Yield();     // deliberately slower
            }
        });

        Task.WhenAll(producer, sampler, consumer).GetAwaiter().GetResult();
        return new Result(peakQueued, channel.Reader.CanCount,
                          Math.Max(peakBytes, 0) / 1024.0 / 1024.0, consumed);
    }

    static void Report(string label, Result r) =&gt;
        Console.WriteLine($"  {label,-24} {(r.CanCount ? r.PeakQueued.ToString("N0") : "n/a"),11}   " +
                          $"{r.PeakMb,12:N1}   {r.Consumed:N0} of {Items:N0}");

    // --- completion -----------------------------------------------------------
    static string WithCompletion()
    {
        var channel = Channel.CreateUnbounded&lt;int&gt;();
        var consumer = Task.Run(async () =&gt;
        {
            var n = 0;
            await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false)) n++;
            return n;
        });
        for (var i = 0; i &lt; 100; i++) channel.Writer.TryWrite(i);
        channel.Writer.Complete();
        return consumer.Wait(1500) ? $"finished, read {consumer.Result} items" : "HUNG";
    }

    static string WithoutCompletion()
    {
        var channel = Channel.CreateUnbounded&lt;int&gt;();
        var consumer = Task.Run(async () =&gt;
        {
            var n = 0;
            await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false)) n++;
            return n;
        });
        for (var i = 0; i &lt; 100; i++) channel.Writer.TryWrite(i);
        // deliberately no Complete()
        return consumer.Wait(1000) ? $"finished, read {consumer.Result} items" : "HUNG - all 100 read, still awaiting more";
    }

    static string FaultedProducer()
    {
        var channel = Channel.CreateUnbounded&lt;int&gt;();
        var consumer = Task.Run(async () =&gt;
        {
            try
            {
                await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false)) { }
                return "completed cleanly";
            }
            catch (InvalidOperationException ex) { return $"threw {ex.Message}"; }
        });
        channel.Writer.TryWrite(1);
        channel.Writer.Complete(new InvalidOperationException("the producer failed"));
        return consumer.Wait(1500) ? consumer.Result : "HUNG";
    }

    // --- options --------------------------------------------------------------
    static (double general, double specialised) ReaderWriterOptions()
    {
        var a = TimeThroughput(new BoundedChannelOptions(1024));
        var b = TimeThroughput(new BoundedChannelOptions(1024) { SingleReader = true, SingleWriter = true });
        return (a, b);
    }

    static double TimeThroughput(BoundedChannelOptions options)
    {
        Thread.Sleep(80);
        var channel = Channel.CreateBounded&lt;int&gt;(options);
        var sw = Stopwatch.StartNew();

        var producer = Task.Run(async () =&gt;
        {
            try
            {
                for (var i = 0; i &lt; 400_000; i++)
                    await channel.Writer.WriteAsync(i).ConfigureAwait(false);
            }
            finally { channel.Writer.Complete(); }
        });

        var consumer = Task.Run(async () =&gt;
        {
            var sum = 0L;
            await foreach (var i in channel.Reader.ReadAllAsync().ConfigureAwait(false)) sum += i;
            return sum;
        });

        Task.WhenAll(producer, consumer).GetAwaiter().GetResult();
        return sw.Elapsed.TotalMilliseconds;
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// 03-production.cs — Ledger's webhook dispatcher. An unbounded queue and an
// unthrottled fan-out, and what each did on the day a partner got slow.
//
// Peaks and counts are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace Ledger.Webhooks;

public sealed record WebhookEvent(long Id, string Url, byte[] Payload);

/// &lt;summary&gt;Stands in for a partner endpoint. Latency is configurable.&lt;/summary&gt;
public sealed class PartnerEndpoint
{
    private int _inFlight;
    private int _peak;
    public int Peak =&gt; Volatile.Read(ref _peak);
    public int DelayMs { get; set; } = 5;

    public async Task PostAsync(WebhookEvent e, CancellationToken ct = default)
    {
        var now = Interlocked.Increment(ref _inFlight);
        var peak = Volatile.Read(ref _peak);
        while (now &gt; peak &amp;&amp; Interlocked.CompareExchange(ref _peak, now, peak) != peak)
            peak = Volatile.Read(ref _peak);
        try { await Task.Delay(DelayMs, ct).ConfigureAwait(false); }
        finally { Interlocked.Decrement(ref _inFlight); }
    }
}

class Program
{
    const int Events = 3_000;
    const int PayloadBytes = 4 * 1024;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger posts a webhook to a partner for every settled payment. The");
        Console.WriteLine("  dispatcher was written the obvious way: an unbounded queue, and a");
        Console.WriteLine("  background loop that fans everything out with Task.WhenAll.");
        Console.WriteLine();
        Console.WriteLine("      _queue = Channel.CreateUnbounded&lt;WebhookEvent&gt;();");
        Console.WriteLine("      await Task.WhenAll(batch.Select(e =&gt; _http.PostAsync(e)));");
        Console.WriteLine();
        Console.WriteLine("  It ran for eighteen months. Then a partner's endpoint went from 5 ms");
        Console.WriteLine("  to 400 ms — not down, just slow — and Ledger fell over instead.");
        Console.WriteLine();
        Console.WriteLine("  design                              peak concurrent   peak MB   delivered");

        var slow = new PartnerEndpoint { DelayMs = 40 };
        Report("unbounded queue + WhenAll", RunUnboundedFanout(slow));
        Report("unbounded queue + semaphore(8)", RunUnboundedThrottled(slow));
        Report("bounded(500) + semaphore(8)", RunBoundedThrottled(slow));

        Console.WriteLine();
        Console.WriteLine("  Two separate defects, and fixing either alone leaves the other.");
        Console.WriteLine();
        Console.WriteLine("  THE FAN-OUT. Task.WhenAll starts every request at once, so a slow");
        Console.WriteLine("  partner is hit with the entire batch simultaneously. Ledger became a");
        Console.WriteLine("  load generator pointed at a service that was already struggling, and");
        Console.WriteLine("  the connection pool, the sockets and the memory for those requests");
        Console.WriteLine("  were all consumed at once.");
        Console.WriteLine();
        Console.WriteLine("  THE QUEUE. Unbounded means the producer never waits. Payments kept");
        Console.WriteLine("  settling and kept enqueueing while delivery slowed, so the backlog");
        Console.WriteLine("  grew without limit. The pod was eventually OOM-killed, which lost");
        Console.WriteLine("  every queued webhook — a durability failure caused by a memory bug.");

        Console.WriteLine();
        Console.WriteLine("=== the fix is two lines, and one decision ===");
        Console.WriteLine();
        Console.WriteLine("      _queue = Channel.CreateBounded&lt;WebhookEvent&gt;(new BoundedChannelOptions(500)");
        Console.WriteLine("      {");
        Console.WriteLine("          FullMode = BoundedChannelFullMode.Wait,");
        Console.WriteLine("      });");
        Console.WriteLine();
        Console.WriteLine("      await Parallel.ForEachAsync(batch,");
        Console.WriteLine("          new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },");
        Console.WriteLine("          (e, token) =&gt; _http.PostAsync(e, token));");
        Console.WriteLine();
        Console.WriteLine("  The decision is FullMode, and it is a business decision wearing an");
        Console.WriteLine("  API's clothes:");
        Console.WriteLine();
        Console.WriteLine("    Wait        the settlement path slows down. Back pressure reaches");
        Console.WriteLine("                the caller, which is usually where it belongs.");
        Console.WriteLine("    DropWrite   webhooks are silently lost, and settlement stays fast.");
        Console.WriteLine("    DropOldest  the same, preferring recent events.");
        Console.WriteLine();
        Console.WriteLine("  For webhooks about money, Wait — and if the queue stays full, that is");
        Console.WriteLine("  a signal to alert on rather than a reason to widen the queue.");

        Console.WriteLine();
        Console.WriteLine("=== what back pressure does to the producer ===");
        Console.WriteLine();
        var (fast, slowed) = ProducerPressure();
        Console.WriteLine($"  producer with a fast consumer : {1.0,5:N2}x  (baseline)");
        Console.WriteLine($"  producer with a slow consumer : {slowed / fast,5:N2}x");
        Console.WriteLine();
        Console.WriteLine("  That slowdown IS the feature. The producer is being told, through the");
        Console.WriteLine("  only channel available to it, that the downstream cannot keep up.");
        Console.WriteLine();
        Console.WriteLine("  It is also the objection people raise: 'we cannot slow down the");
        Console.WriteLine("  settlement path'. The honest answer is that you are already slowing");
        Console.WriteLine("  it down — the unbounded version does not avoid the cost, it defers");
        Console.WriteLine("  it into memory and then pays it all at once as an outage.");

        Console.WriteLine();
        Console.WriteLine("=== the shutdown bug this design also had ===");
        Console.WriteLine();
        Console.WriteLine($"  drained on shutdown, with Complete()     : {DrainWithComplete()}");
        Console.WriteLine($"  drained on shutdown, without Complete()  : {DrainWithoutComplete()}");
        Console.WriteLine();
        Console.WriteLine("  ReadAllAsync ends when the WRITER completes, not when the queue");
        Console.WriteLine("  empties. A shutdown path that stops enqueueing and waits for the");
        Console.WriteLine("  consumer will wait forever unless it also calls Complete().");
        Console.WriteLine();
        Console.WriteLine("  In a hosted service that means StopAsync hangs, the host waits out");
        Console.WriteLine("  its shutdown timeout, and the orchestrator sends SIGKILL — losing");
        Console.WriteLine("  exactly the queued work the graceful shutdown existed to protect.");
        Console.WriteLine();
        Console.WriteLine("      public async Task StopAsync(CancellationToken ct)");
        Console.WriteLine("      {");
        Console.WriteLine("          _queue.Writer.Complete();       // let the consumer finish");
        Console.WriteLine("          await _consumerTask.WaitAsync(ct);");
        Console.WriteLine("      }");

        Console.WriteLine();
        Console.WriteLine("=== how it was diagnosed ===");
        Console.WriteLine();
        Console.WriteLine("  The signature is distinctive once you know it, and it is unlike every");
        Console.WriteLine("  other stall in this track:");
        Console.WriteLine();
        Console.WriteLine("    gc-heap-size            climbing steadily, never falling");
        Console.WriteLine("    cpu-usage               low");
        Console.WriteLine("    monitor-lock-contention flat");
        Console.WriteLine("    outbound request rate   HIGH, and rising as latency rises");
        Console.WriteLine();
        Console.WriteLine("  That last line is what identifies it. A service under back pressure");
        Console.WriteLine("  sends FEWER requests as its dependency slows. A service without back");
        Console.WriteLine("  pressure sends MORE, because the fan-out width is set by the backlog");
        Console.WriteLine("  rather than by capacity — so slowness makes it more aggressive.");
        Console.WriteLine();
        Console.WriteLine("  The queue depth is the metric that would have caught it months");
        Console.WriteLine("  earlier, and an unbounded channel cannot report one: CanCount is");
        Console.WriteLine("  false. Choosing a bounded channel is partly choosing to be able to");
        Console.WriteLine("  see the problem.");
    }

    readonly record struct Result(int PeakConcurrent, double PeakMb, int Delivered);

    static IEnumerable&lt;WebhookEvent&gt; MakeEvents() =&gt;
        Enumerable.Range(0, Events).Select(i =&gt;
            new WebhookEvent(i, "https://partner.example/hook", new byte[PayloadBytes]));

    static Result RunUnboundedFanout(PartnerEndpoint partner) =&gt;
        Run(partner, Channel.CreateUnbounded&lt;WebhookEvent&gt;(), throttle: 0);

    static Result RunUnboundedThrottled(PartnerEndpoint partner) =&gt;
        Run(partner, Channel.CreateUnbounded&lt;WebhookEvent&gt;(), throttle: 8);

    static Result RunBoundedThrottled(PartnerEndpoint partner) =&gt;
        Run(partner, Channel.CreateBounded&lt;WebhookEvent&gt;(
            new BoundedChannelOptions(500) { FullMode = BoundedChannelFullMode.Wait }), throttle: 8);

    static Result Run(PartnerEndpoint partner, Channel&lt;WebhookEvent&gt; queue, int throttle)
    {
        Thread.Sleep(100);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var peakBytes = 0L;
        var delivered = 0;
        var reset = new PartnerEndpoint { DelayMs = partner.DelayMs };

        var producer = Task.Run(async () =&gt;
        {
            try
            {
                foreach (var e in MakeEvents())
                    await queue.Writer.WriteAsync(e).ConfigureAwait(false);
            }
            finally { queue.Writer.Complete(); }
        });

        var sampler = Task.Run(async () =&gt;
        {
            while (!producer.IsCompleted)
            {
                var mem = GC.GetTotalMemory(false) - before;
                if (mem &gt; peakBytes) peakBytes = mem;
                await Task.Delay(2).ConfigureAwait(false);
            }
        });

        var consumer = Task.Run(async () =&gt;
        {
            if (throttle == 0)
            {
                // The shipped shape: read everything, then fan out with no limit.
                var all = new List&lt;WebhookEvent&gt;();
                await foreach (var e in queue.Reader.ReadAllAsync().ConfigureAwait(false)) all.Add(e);
                await Task.WhenAll(all.Select(async e =&gt;
                {
                    await reset.PostAsync(e).ConfigureAwait(false);
                    Interlocked.Increment(ref delivered);
                })).ConfigureAwait(false);
            }
            else
            {
                using var gate = new SemaphoreSlim(throttle, throttle);
                var pending = new List&lt;Task&gt;();
                await foreach (var e in queue.Reader.ReadAllAsync().ConfigureAwait(false))
                {
                    await gate.WaitAsync().ConfigureAwait(false);
                    pending.Add(Task.Run(async () =&gt;
                    {
                        try
                        {
                            await reset.PostAsync(e).ConfigureAwait(false);
                            Interlocked.Increment(ref delivered);
                        }
                        finally { gate.Release(); }
                    }));
                }
                await Task.WhenAll(pending).ConfigureAwait(false);
            }
        });

        Task.WhenAll(producer, sampler, consumer).GetAwaiter().GetResult();
        return new Result(reset.Peak, Math.Max(peakBytes, 0) / 1024.0 / 1024.0, delivered);
    }

    static void Report(string label, Result r) =&gt;
        Console.WriteLine($"  {label,-34} {r.PeakConcurrent,15:N0}   {r.PeakMb,7:N1}   " +
                          $"{r.Delivered:N0} of {Events:N0}");

    static (double fast, double slowed) ProducerPressure()
    {
        return (Produce(consumerDelayUs: 0), Produce(consumerDelayUs: 200));
    }

    static double Produce(int consumerDelayUs)
    {
        Thread.Sleep(80);
        var queue = Channel.CreateBounded&lt;int&gt;(new BoundedChannelOptions(64)
        {
            FullMode = BoundedChannelFullMode.Wait
        });

        var consumer = Task.Run(async () =&gt;
        {
            await foreach (var _ in queue.Reader.ReadAllAsync().ConfigureAwait(false))
                if (consumerDelayUs &gt; 0) await Task.Yield();
        });

        var sw = Stopwatch.StartNew();
        var producer = Task.Run(async () =&gt;
        {
            try
            {
                for (var i = 0; i &lt; 20_000; i++)
                    await queue.Writer.WriteAsync(i).ConfigureAwait(false);
            }
            finally { queue.Writer.Complete(); }
        });

        Task.WhenAll(producer, consumer).GetAwaiter().GetResult();
        return sw.Elapsed.TotalMilliseconds;
    }

    static string DrainWithComplete() =&gt; Drain(complete: true);
    static string DrainWithoutComplete() =&gt; Drain(complete: false);

    static string Drain(bool complete)
    {
        var queue = Channel.CreateUnbounded&lt;int&gt;();
        var read = 0;
        var consumer = Task.Run(async () =&gt;
        {
            await foreach (var _ in queue.Reader.ReadAllAsync().ConfigureAwait(false))
                Interlocked.Increment(ref read);
        });

        for (var i = 0; i &lt; 50; i++) queue.Writer.TryWrite(i);
        if (complete) queue.Writer.Complete();

        return consumer.Wait(1000)
            ? $"shut down cleanly after {Volatile.Read(ref read)} events"
            : $"HUNG with {Volatile.Read(ref read)} events read and the queue empty";
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs"><code>// 04-exercises.cs — every answer claimed in this module's exercises, run.
// Peaks and counts are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

class Program
{
    static int _inFlight, _peak;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: does this limit anything? =====");
        Console.WriteLine();
        Console.WriteLine("      await Task.WhenAll(items.Select(i =&gt; CallApiAsync(i)));");
        Console.WriteLine();
        Console.WriteLine("  approach                         peak concurrent");
        Console.WriteLine($"    Task.WhenAll                   {PeakOf(WhenAllAll),15}");
        Console.WriteLine($"    SemaphoreSlim(5)               {PeakOf(() =&gt; Throttled(5)),15}");
        Console.WriteLine($"    Parallel.ForEachAsync(dop 5)   {PeakOf(() =&gt; ForEachAsync(5)),15}");
        Console.WriteLine();
        Console.WriteLine("  No. WhenAll starts everything at once — it waits for completion, it");
        Console.WriteLine("  does not schedule. For 5 calls that is fine; for 200 against a");
        Console.WriteLine("  partner that allows 10, you have written a denial of service.");
        Console.WriteLine();
        Console.WriteLine("  Prefer Parallel.ForEachAsync when you are fanning out over a");
        Console.WriteLine("  collection: it takes the limit and a CancellationToken directly, and");
        Console.WriteLine("  there is no permit to leak.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: find the bug =====");
        Console.WriteLine();
        Console.WriteLine("      await _gate.WaitAsync(ct);");
        Console.WriteLine("      var result = await CallApiAsync(ct);   // this can throw");
        Console.WriteLine("      _gate.Release();");
        Console.WriteLine();
        Console.WriteLine($"    3 permits, 3 failed operations -&gt; {LeakedPermits()} permits remain");
        Console.WriteLine();
        Console.WriteLine("  A throw skips the Release, and the permit is gone permanently. Three");
        Console.WriteLine("  failures exhaust a semaphore of three, and every later caller waits");
        Console.WriteLine("  forever on a permit nobody will return.");
        Console.WriteLine();
        Console.WriteLine("  The fix is try/finally, and it is the same shape as a lock:");
        Console.WriteLine();
        Console.WriteLine("      await _gate.WaitAsync(ct);");
        Console.WriteLine("      try     { return await CallApiAsync(ct); }");
        Console.WriteLine("      finally { _gate.Release(); }");
        Console.WriteLine();
        Console.WriteLine("  This failure is worse than a deadlock because it is DELAYED. The");
        Console.WriteLine("  service keeps working at a reduced limit until enough failures");
        Console.WriteLine("  accumulate, so the outage arrives long after the deployment that");
        Console.WriteLine("  caused it.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: Wait or WaitAsync? =====");
        Console.WriteLine();
        var (a, b) = WaitComparison();
        Console.WriteLine($"    WaitAsync : {1.0,6:N2}x  (baseline)");
        Console.WriteLine($"    Wait      : {b / a,6:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Both enforce the limit. Wait blocks a pool thread for every WAITER,");
        Console.WriteLine("  not just for every worker — so a limit of 4 with 120 callers holds");
        Console.WriteLine("  116 threads doing nothing (t2-07).");
        Console.WriteLine();
        Console.WriteLine("  There is no async lock keyword in C#. SemaphoreSlim(1,1) with");
        Console.WriteLine("  WaitAsync is the idiom, and it works because a semaphore counts");
        Console.WriteLine("  permits rather than owning threads — so a permit taken before an");
        Console.WriteLine("  await can be released after it, on a different thread.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: bounded or unbounded? =====");
        Console.WriteLine();
        Console.WriteLine("  A producer faster than its consumer, 20,000 items:");
        Console.WriteLine();
        Console.WriteLine("  channel                 peak MB   delivered");
        Console.WriteLine($"    Unbounded             {QueueRun(0, BoundedChannelFullMode.Wait),7:N1}   {LastDelivered:N0}");
        Console.WriteLine($"    Bounded(100) Wait     {QueueRun(100, BoundedChannelFullMode.Wait),7:N1}   {LastDelivered:N0}");
        Console.WriteLine($"    Bounded(100) DropWrite{QueueRun(100, BoundedChannelFullMode.DropWrite),7:N1}   {LastDelivered:N0}");
        Console.WriteLine();
        Console.WriteLine("  Unbounded is not a choice to postpone — it IS a choice, and it says");
        Console.WriteLine("  'absorb any speed mismatch in memory until the process dies'.");
        Console.WriteLine();
        Console.WriteLine("  Bounded makes you decide where the mismatch surfaces:");
        Console.WriteLine("    Wait       in the producer, which slows down (back pressure)");
        Console.WriteLine("    DropWrite  in the data, silently — note the delivered column");
        Console.WriteLine();
        Console.WriteLine("  Wait for anything that matters; Drop for telemetry you would rather");
        Console.WriteLine("  lose than have slow the system down. Choose deliberately, because the");
        Console.WriteLine("  API is equally happy to lose your payments.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: why does the consumer never finish? =====");
        Console.WriteLine();
        Console.WriteLine("      for (var i = 0; i &lt; 100; i++) await writer.WriteAsync(i);");
        Console.WriteLine("      await consumerTask;      // never returns");
        Console.WriteLine();
        Console.WriteLine($"    without Complete() : {Drain(false)}");
        Console.WriteLine($"    with Complete()    : {Drain(true)}");
        Console.WriteLine();
        Console.WriteLine("  ReadAllAsync ends when the WRITER is completed, not when the queue is");
        Console.WriteLine("  empty. An empty channel is not a finished one — it is a channel");
        Console.WriteLine("  waiting for the next item.");
        Console.WriteLine();
        Console.WriteLine("  Put Complete() in a finally, so a producer that throws still releases");
        Console.WriteLine("  the consumer, and prefer Complete(exception) so the failure surfaces");
        Console.WriteLine("  on the consumer instead of looking like a clean end of stream:");
        Console.WriteLine();
        Console.WriteLine($"    Complete(exception) -&gt; consumer {FaultedProducer()}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: which primitive? =====");
        Console.WriteLine();
        Console.WriteLine("  need                                        use");
        Console.WriteLine("  limit concurrent calls to a dependency      SemaphoreSlim / ForEachAsync");
        Console.WriteLine("  mutual exclusion across an await            SemaphoreSlim(1,1)");
        Console.WriteLine("  mutual exclusion, no await inside           lock (cheaper, reentrant)");
        Console.WriteLine("  hand work to a background processor         Channel");
        Console.WriteLine("  fan out CPU work over cores                 Parallel.For (t2-10)");
        Console.WriteLine("  wait for N things to finish                 Task.WhenAll");
        Console.WriteLine("  first of N, cancel the rest                 Task.WhenAny + linked CTS");
        Console.WriteLine();
        Console.WriteLine("  The two that get confused: Task.WhenAll is not a throttle, and");
        Console.WriteLine("  Parallel.For is not for I/O (t2-10 measured 8.5x against 214x).");
        Console.WriteLine();
        Console.WriteLine("  And SemaphoreSlim(1,1) is NOT a drop-in for lock. It is not");
        Console.WriteLine("  reentrant, so a guarded method calling another guarded method");
        Console.WriteLine($"  deadlocks: {NestedSemaphore()}");
    }

    // --- Exercise 1 -----------------------------------------------------------
    static int PeakOf(Action run)
    {
        Thread.Sleep(60);
        Volatile.Write(ref _inFlight, 0);
        Volatile.Write(ref _peak, 0);
        run();
        return Volatile.Read(ref _peak);
    }

    static void WhenAllAll() =&gt;
        Task.WhenAll(Enumerable.Range(0, 100).Select(_ =&gt; WorkAsync())).GetAwaiter().GetResult();

    static void Throttled(int limit)
    {
        using var gate = new SemaphoreSlim(limit, limit);
        Task.WhenAll(Enumerable.Range(0, 100).Select(async _ =&gt;
        {
            await gate.WaitAsync().ConfigureAwait(false);
            try { await WorkAsync().ConfigureAwait(false); }
            finally { gate.Release(); }
        })).GetAwaiter().GetResult();
    }

    static void ForEachAsync(int dop) =&gt;
        Parallel.ForEachAsync(Enumerable.Range(0, 100),
            new ParallelOptions { MaxDegreeOfParallelism = dop },
            async (_, ct) =&gt; await WorkAsync(ct).ConfigureAwait(false)).GetAwaiter().GetResult();

    static async Task WorkAsync(CancellationToken ct = default)
    {
        var now = Interlocked.Increment(ref _inFlight);
        var peak = Volatile.Read(ref _peak);
        while (now &gt; peak &amp;&amp; Interlocked.CompareExchange(ref _peak, now, peak) != peak)
            peak = Volatile.Read(ref _peak);
        try { await Task.Delay(15, ct).ConfigureAwait(false); }
        finally { Interlocked.Decrement(ref _inFlight); }
    }

    // --- Exercise 2 -----------------------------------------------------------
    static int LeakedPermits()
    {
        var gate = new SemaphoreSlim(3, 3);
        for (var i = 0; i &lt; 3; i++)
        {
            try
            {
                gate.Wait();
                throw new InvalidOperationException("failed");
            }
            catch (InvalidOperationException) { }
        }
        return gate.CurrentCount;
    }

    // --- Exercise 3 -----------------------------------------------------------
    static (double, double) WaitComparison() =&gt; (Queue(true), Queue(false));

    static double Queue(bool useAsync)
    {
        Thread.Sleep(100);
        using var gate = new SemaphoreSlim(4, 4);
        var sw = Stopwatch.StartNew();
        Task.WhenAll(Enumerable.Range(0, 120).Select(_ =&gt; Task.Run(async () =&gt;
        {
            if (useAsync) await gate.WaitAsync().ConfigureAwait(false);
            else gate.Wait();
            try { await Task.Delay(15).ConfigureAwait(false); }
            finally { gate.Release(); }
        }))).GetAwaiter().GetResult();
        return sw.Elapsed.TotalMilliseconds;
    }

    // --- Exercise 4 -----------------------------------------------------------
    static int LastDelivered;

    static double QueueRun(int capacity, BoundedChannelFullMode mode)
    {
        Thread.Sleep(80);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var peak = 0L;
        var delivered = 0;

        var channel = capacity == 0
            ? Channel.CreateUnbounded&lt;byte[]&gt;()
            : Channel.CreateBounded&lt;byte[]&gt;(new BoundedChannelOptions(capacity) { FullMode = mode });

        var producer = Task.Run(async () =&gt;
        {
            try
            {
                for (var i = 0; i &lt; 20_000; i++)
                    await channel.Writer.WriteAsync(new byte[1024]).ConfigureAwait(false);
            }
            finally { channel.Writer.Complete(); }
        });

        var sampler = Task.Run(async () =&gt;
        {
            while (!producer.IsCompleted)
            {
                var m = GC.GetTotalMemory(false) - before;
                if (m &gt; peak) peak = m;
                await Task.Delay(2).ConfigureAwait(false);
            }
        });

        var consumer = Task.Run(async () =&gt;
        {
            await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false))
            {
                delivered++;
                if ((delivered &amp; 0x1F) == 0) await Task.Yield();
            }
        });

        Task.WhenAll(producer, sampler, consumer).GetAwaiter().GetResult();
        LastDelivered = delivered;
        return Math.Max(peak, 0) / 1024.0 / 1024.0;
    }

    // --- Exercise 5 -----------------------------------------------------------
    static string Drain(bool complete)
    {
        var channel = Channel.CreateUnbounded&lt;int&gt;();
        var read = 0;
        var consumer = Task.Run(async () =&gt;
        {
            await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false))
                Interlocked.Increment(ref read);
        });
        for (var i = 0; i &lt; 100; i++) channel.Writer.TryWrite(i);
        if (complete) channel.Writer.Complete();
        return consumer.Wait(800)
            ? $"finished after {Volatile.Read(ref read)} items"
            : $"HUNG with all {Volatile.Read(ref read)} items read";
    }

    static string FaultedProducer()
    {
        var channel = Channel.CreateUnbounded&lt;int&gt;();
        var consumer = Task.Run(async () =&gt;
        {
            try
            {
                await foreach (var _ in channel.Reader.ReadAllAsync().ConfigureAwait(false)) { }
                return "completed cleanly";
            }
            catch (InvalidOperationException ex) { return $"threw: {ex.Message}"; }
        });
        channel.Writer.TryWrite(1);
        channel.Writer.Complete(new InvalidOperationException("producer failed"));
        return consumer.Wait(800) ? consumer.Result : "HUNG";
    }

    // --- Exercise 6 -----------------------------------------------------------
    static string NestedSemaphore()
    {
        var gate = new SemaphoreSlim(1, 1);
        gate.Wait();
        var second = gate.Wait(TimeSpan.FromMilliseconds(150));
        if (second) { gate.Release(); gate.Release(); return "entered twice (unexpected)"; }
        gate.Release();
        return "DEADLOCKED on the nested Wait";
    }
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>Does <code>Task.WhenAll</code> limit concurrency?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — measured, 200 operations at a peak of <strong>200 in flight</strong>. It waits for
        completion; it does not schedule. Use <code>Parallel.ForEachAsync</code> or a
        <code>SemaphoreSlim</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Why can a <code>SemaphoreSlim</code> be held across an <code>await</code> when a
      <code>lock</code> cannot?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A monitor is owned by a <strong>thread</strong>; a semaphore counts <strong>permits</strong>
        and has no owner. So a permit taken before an await can be released after it, on whichever
        thread the continuation resumed on.</p>
      </div></details>
    </li>
    <li>
      <p>What happens if an exception skips <code>Release()</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The permit is gone permanently. Measured: three failures took a semaphore of three to
        <strong>zero</strong>. It presents as gradual degradation that recovers on restart — always use
        <code>try/finally</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What is the difference between <code>Wait()</code> and <code>WaitAsync()</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Both enforce the limit; <code>Wait</code> blocks a pool thread for every <strong>waiter</strong>.
        Measured at <strong>78×</strong> slower for the same work.</p>
      </div></details>
    </li>
    <li>
      <p>Why pass a maximum to the <code>SemaphoreSlim</code> constructor?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Without one, a stray <code>Release</code> silently raises the limit — verified, a
        <code>SemaphoreSlim(2)</code> reporting a count of <strong>4</strong>.
        <code>SemaphoreSlim(2, 2)</code> throws <code>SemaphoreFullException</code> instead.</p>
      </div></details>
    </li>
    <li>
      <p>What does bounding a channel actually decide?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Where a speed mismatch surfaces</strong>: in memory (unbounded), in the producer
        (<code>Wait</code>), or in the data (<code>Drop</code>). Measured, <code>DropWrite</code> lost
        18,570 of 40,000 items silently.</p>
      </div></details>
    </li>
    <li>
      <p>When does <code>ReadAllAsync</code> end?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the <strong>writer is completed</strong> — not when the queue is empty. Verified: every
        item read and the consumer still hung. Call <code>Writer.Complete()</code> in a
        <code>finally</code>, and <code>Complete(ex)</code> on failure so the consumer rethrows.</p>
      </div></details>
    </li>
    <li>
      <p>What is the counter-intuitive production signature of missing back pressure?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Your <strong>outbound request rate rises as the dependency slows down</strong>, because the
        fan-out width is set by the backlog rather than by capacity. A system with back pressure sends
        fewer requests as its dependency slows.</p>
      </div></details>
    </li>
    <li>
      <p>Why can you not put an unbounded queue's depth on a dashboard?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>CanCount</code> is <strong>false</strong> for unbounded channels — <code>Count</code>
        is not supported. The queue you cannot bound is the one you cannot measure, so it will not
        appear on a graph before it kills the process.</p>
      </div></details>
    </li>
    <li>
      <p>Is <code>SemaphoreSlim(1,1)</code> a drop-in replacement for <code>lock</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — it is <strong>not reentrant</strong>, verified to deadlock on a nested wait. Use
        <code>lock</code> when nothing inside needs awaiting; it is cheaper and forgives nesting.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
