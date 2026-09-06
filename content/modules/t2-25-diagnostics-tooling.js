CSPREP.module({
  id: "t2-25-diagnostics-tooling",
  minutes: 55,
  updated: "2026-09-02",
  summary: "Three Ledger incidents with the identical symptom - p99 up, CPU flat - and each one moved exactly one counter: 313 MB allocated with 0.32 s of pause, a thread-pool queue of 424 with CPU/wall at 0.08, and 2,332 lock contentions with CPU/wall at 2.26. CPU-seconds per second of wall clock is the ratio that splits the problem space before you open a profiler. And the fourth case is the one people reach last: every counter flat means the process is waiting on something outside it, which is a real finding and the fastest one available.",
  terms: ["dotnet-counters", "dotnet-trace", "dotnet-dump", "dotnet-gcdump", "MeterListener",
    "EventListener", "EventSource", "ActivitySource", "EventPipe", "provider", "keyword mask",
    "level versus total", "CPU to wall ratio", "working set", "live heap", "gcroot",
    "dumpasync", "SOS", "feature switch", "EventSourceSupport"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>You are paged at 03:00. Ledger's p99 latency is four seconds, up from ninety milliseconds. CPU is
  at 30%. Memory looks normal. Nothing is in the error logs.</p>

  <p>That description fits at least four completely different problems, each with a different fix, and
  guessing between them is how an incident lasts three hours instead of ten minutes.</p>

  <p>Here are three of them, reproduced and measured. Same symptom, same machine:</p>

  <pre data-lang="console" data-title="03-production.cs"><code>   scenario               alloc MB   GC pause s   contentions   peak queue   peak thr   CPU/wall
   --------               --------   ----------   -----------   ----------   --------   --------
   idle baseline                 0        0.000             0            0          0       0.00
   A: allocation               313        0.321             0            0          0       0.87
   B: blocked pool               0        0.000             8          424          8       0.08
   C: lock contention            0        0.000         2,332            1          9       2.26</code></pre>

  <p><strong>Each incident moves a different counter and leaves the others near the baseline.</strong>
  That is what makes the diagnosis fast, and it takes seconds rather than a profiler.</p>

  <p>This module is about those counters — what the runtime publishes, what each one means, which tool
  reads them, and the discipline of working from cheap continuous data toward expensive one-off
  captures rather than the other way round.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><code>dotnet-counters</code> and the other diagnostic tools are global tools and are not
    installed in this folder. Every measurement in this module is taken <strong>in-process</strong>,
    from the same instruments and event sources those tools read over a diagnostic socket.</p>
    <p>The instrument names below are the names the tools print, and the command lines are given in
    full. The output is real rather than illustrative.</p>
  </div>
</section>

<section id="plain-language">
  <h2>The four tools and what each is for</h2>

  <p class="define"><span class="define__term">Counter</span> A number the runtime publishes
  continuously — heap size, queue length, collections so far. Reading them costs almost nothing, so
  they can be on all the time.</p>

  <p class="define"><span class="define__term">Trace</span> A recording of individual events over a
  window of time: every collection, every allocation, every contended lock. Far more detail, and a
  real cost while it runs.</p>

  <p class="define"><span class="define__term">Dump</span> A copy of the process's entire memory at one
  instant. It stops the process to take it, and it is the only thing that shows you a hang, because a
  hang is a state rather than an event.</p>

  <p class="define"><span class="define__term">EventPipe</span> The cross-platform diagnostic channel
  every one of these tools uses to talk to a running .NET process. It is why they work identically on
  Linux and Windows and need no debugger attached.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Tool</th><th>Answers</th><th>Cost</th><th>Reach for it when</th></tr>
      </thead>
      <tbody>
        <tr><td><code>dotnet-counters</code></td><td><strong>Which</strong> problem you have</td><td>Nearly free</td><td>Always. First, every time.</td></tr>
        <tr><td><code>dotnet-trace</code></td><td><strong>Where</strong> the time or allocation went</td><td>Moderate to heavy</td><td>Counters have narrowed it and you need stacks</td></tr>
        <tr><td><code>dotnet-gcdump</code></td><td><strong>What</strong> is on the heap and what roots it</td><td>A pause</td><td>The live heap is growing</td></tr>
        <tr><td><code>dotnet-dump</code></td><td><strong>What state</strong> the process is in now</td><td>Stops the process</td><td>A hang, a deadlock, or nothing else worked</td></tr>
      </tbody>
    </table>
  </div>

  <p class="define"><span class="define__term">Instrument</span> One named measurement published
  by a <code>Meter</code> - a counter, a gauge, or a histogram. <code>dotnet.gc.pause.time</code> is an
  instrument; <code>System.Runtime</code> is the meter that publishes it.</p>

  <p class="define"><span class="define__term">Level</span> A counter reporting the value right now -
  queue length, heap size, thread count. It has no memory, so a spike is invisible unless something was
  sampling while it happened.</p>

  <p class="define"><span class="define__term">Total</span> A counter that only ever rises -
  allocated bytes, collections, pause time. Readable at any moment, because two readings give you the
  rate between them.</p>

  <p class="define"><span class="define__term">Provider</span> A named source of trace events. The
  runtime's is <code>Microsoft-Windows-DotNETRuntime</code>, and your own <code>EventSource</code> types
  become providers under whatever name you give them.</p>

  <p class="define"><span class="define__term">Keyword mask</span> A bitmask selecting which
  categories of event a provider should emit. It is the difference between a useful trace and one that
  writes hundreds of megabytes a minute.</p>

  <p class="define"><span class="define__term">Feature switch</span> An MSBuild property that compiles
  a whole subsystem out of a published build. <code>EventSourceSupport=false</code> is one, and it
  removes your diagnostics without any error.</p>

  <p><strong>An analogy, and its limits.</strong> Counters are the dashboard instruments in a car:
  always visible, cheap, and enough to tell an overheating engine from an empty tank. A trace is a
  diagnostic run with a laptop plugged in. A dump is taking the engine apart on the bench.</p>

  <p><strong>Where the analogy breaks:</strong> you can take a dump of a healthy process and learn
  nothing, and a dump taken before the counters have been read is a very large file that nobody knows
  what to look for in. The order matters more than the tools do.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The three incidents above took Ledger 3 hours, 40 minutes and 20 minutes respectively. The
    difference was not the difficulty of the bugs — the 20-minute one was the hardest. It was whether
    anyone read the counters before forming a theory.</p>
    <p>The first incident was diagnosed as "a database problem" for two hours on the strength of the
    symptom alone. The counters said 313 MB of allocation and 0.32 seconds of pause in a ten-second
    window, which rules the database out in the time it takes to read one line.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — The same symptom, two causes, told apart by one
// counter each.
//
// Run:  dotnet run 05-minimal-example.cs -c Release

using System.Diagnostics.Metrics;

using var counters = new Counters();
counters.Start();

Console.WriteLine("Symptom in both cases: the work takes far longer than it should.");
Console.WriteLine();
Console.WriteLine("   scenario            alloc MB   GC pause s   queue   CPU/wall");
Console.WriteLine("   --------            --------   ----------   -----   --------");

Measure(counters, "allocation pressure", () =&gt;
{
    var window = new byte[40_000][];
    for (int i = 0; i &lt; 1_200_000; i++)
    {
        var block = new byte[192];
        block[0] = (byte)i;
        window[i % window.Length] = block;
    }

    GC.KeepAlive(window);
});

Measure(counters, "blocked thread pool", () =&gt;
{
    var release = new ManualResetEventSlim(false);
    for (int i = 0; i &lt; Environment.ProcessorCount * 4; i++)
    {
        ThreadPool.QueueUserWorkItem(_ =&gt; release.Wait());
    }

    for (int i = 0; i &lt; 400; i++)
    {
        ThreadPool.QueueUserWorkItem(_ =&gt; Thread.SpinWait(500));
    }

    Thread.Sleep(400);
    release.Set();
    Thread.Sleep(100);
});

Console.WriteLine();
Console.WriteLine("Two rows, two completely different fixes.");
Console.WriteLine();
Console.WriteLine("The first allocates heavily and spends real time paused, with an empty");
Console.WriteLine("queue and CPU/wall near 1 - it is working, and the collector is the cost.");
Console.WriteLine();
Console.WriteLine("The second allocates nothing, pauses for nothing, and has a deep queue");
Console.WriteLine("with CPU/wall near zero - it is waiting, not working.");
Console.WriteLine();
Console.WriteLine("CPU/wall is the ratio that splits the problem space: low means waiting,");
Console.WriteLine("high means working. Everything else narrows it from there.");

static void Measure(Counters counters, string label, Action work)
{
    counters.Sample();
    double alloc0 = counters.Read("dotnet.gc.heap.total_allocated");
    double pause0 = counters.Read("dotnet.gc.pause.time");
    double cpu0 = counters.Read("dotnet.process.cpu.time");

    double peakQueue = 0;
    using var stop = new CancellationTokenSource();

    var sampler = new Thread(() =&gt;
    {
        while (!stop.IsCancellationRequested)
        {
            counters.Sample();
            peakQueue = Math.Max(peakQueue, counters.Read("dotnet.thread_pool.queue.length"));
            Thread.Sleep(10);
        }
    })
    {
        IsBackground = true
    };

    var sw = System.Diagnostics.Stopwatch.StartNew();
    sampler.Start();
    work();
    sw.Stop();
    stop.Cancel();
    sampler.Join();

    counters.Sample();

    double allocMb = (counters.Read("dotnet.gc.heap.total_allocated") - alloc0) / 1024 / 1024;
    double pause = counters.Read("dotnet.gc.pause.time") - pause0;
    double cpu = counters.Read("dotnet.process.cpu.time") - cpu0;

    Console.WriteLine($"   {label}  {allocMb,8:N0}   {pause,10:F3}   {peakQueue,5:N0}   " +
        $"{(sw.Elapsed.TotalSeconds &gt; 0 ? cpu / sw.Elapsed.TotalSeconds : 0),8:F2}");
}

// Reads the same instruments dotnet-counters reads, from inside the process.
sealed class Counters : IDisposable
{
    private readonly MeterListener _listener = new();
    private readonly Dictionary&lt;string, double&gt; _values = new();
    private readonly Dictionary&lt;string, double&gt; _staging = new();
    private bool _sampling;

    public Counters()
    {
        _listener.InstrumentPublished = (i, l) =&gt;
        {
            if (i.Meter.Name.StartsWith("System.Runtime", StringComparison.Ordinal))
            {
                l.EnableMeasurementEvents(i);
            }
        };

        _listener.SetMeasurementEventCallback&lt;long&gt;((i, v, _, _) =&gt; Record(i.Name, v));
        _listener.SetMeasurementEventCallback&lt;double&gt;((i, v, _, _) =&gt; Record(i.Name, v));
        _listener.SetMeasurementEventCallback&lt;int&gt;((i, v, _, _) =&gt; Record(i.Name, v));
    }

    public void Start() =&gt; _listener.Start();

    // Some instruments are tagged - heap size reports once per generation - so
    // one pull yields several measurements per name. Sum within a pull.
    public void Sample()
    {
        lock (_values)
        {
            _staging.Clear();
            _sampling = true;
        }

        _listener.RecordObservableInstruments();

        lock (_values)
        {
            _sampling = false;
            foreach ((string name, double value) in _staging)
            {
                _values[name] = value;
            }
        }
    }

    public double Read(string name)
    {
        lock (_values)
        {
            return _values.TryGetValue(name, out double value) ? value : 0;
        }
    }

    private void Record(string name, double value)
    {
        lock (_values)
        {
            if (_sampling)
            {
                _staging[name] = _staging.TryGetValue(name, out double existing) ? existing + value : value;
            }
            else
            {
                _values[name] = value;
            }
        }
    }

    public void Dispose() =&gt; _listener.Dispose();
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Symptom in both cases: the work takes far longer than it should.

   scenario            alloc MB   GC pause s   queue   CPU/wall
   --------            --------   ----------   -----   --------
   allocation pressure       248        0.218       0       0.79
   blocked thread pool         0        0.000     424       0.12</code></pre>

  <p>Two rows, two completely different fixes, told apart by two numbers.</p>

  <p>The first allocates heavily and spends real time paused, with an empty queue and CPU/wall near 1 —
  it is <em>working</em>, and the collector is the cost. The second allocates nothing, pauses for
  nothing, and has a deep queue with CPU/wall near zero — it is <em>waiting</em>.</p>

  <p class="define"><span class="define__term">CPU to wall ratio</span> CPU-seconds consumed per second
  of elapsed time, which is how many cores the process is actually using. <strong>Low means waiting;
  high means working.</strong> That single ratio splits the problem space before you have opened a
  profiler.</p>
</section>

<section id="counters">
  <h2>What the runtime publishes</h2>

  <pre data-lang="console" data-title="01-counters.cs"><code>   instrument                                      value
   ----------                                      -----
   dotnet.assembly.count                                     12
   dotnet.gc.collections                                      0
   dotnet.gc.heap.total_allocated                        68,480
   dotnet.gc.last_collection.heap.fragmentation.size           0
   dotnet.gc.last_collection.heap.size                        0
   dotnet.gc.last_collection.memory.committed_size            0
   dotnet.gc.pause.time                                       0
   dotnet.jit.compilation.time                                0
   dotnet.jit.compiled_il.size                            3,654
   dotnet.jit.compiled_methods                               63
   dotnet.monitor.lock_contentions                            0
   dotnet.process.cpu.count                                   8
   dotnet.process.cpu.time                                    0
   dotnet.process.memory.working_set                 19,292,160
   dotnet.thread_pool.queue.length                            0
   dotnet.thread_pool.thread.count                            0
   dotnet.thread_pool.work_item.count                         0
   dotnet.timer.count                                         0</code></pre>

  <pre data-lang="bash" data-title="The same list, from outside"><code>dotnet-counters monitor --process-id 4821 --counters System.Runtime

# Or write it to a file for later, which is what you want during an incident.
dotnet-counters collect --process-id 4821 --counters System.Runtime --output counters.csv</code></pre>

  <h3>Levels and totals</h3>

  <p>This distinction decides whether attaching a tool <em>after</em> being paged tells you anything.</p>

  <pre data-lang="console" data-title="04-exercises.cs"><code>   queue length DURING the incident :    324
   queue length AFTER               :      0</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Levels — sample continuously or lose them</th><th>Totals — read any time, take differences</th></tr>
      </thead>
      <tbody>
        <tr><td><code>thread_pool.queue.length</code></td><td><code>gc.heap.total_allocated</code></td></tr>
        <tr><td><code>thread_pool.thread.count</code></td><td><code>gc.collections</code></td></tr>
        <tr><td><code>gc.last_collection.heap.size</code></td><td><code>gc.pause.time</code></td></tr>
        <tr><td><code>process.memory.working_set</code></td><td><code>monitor.lock_contentions</code></td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>The queue length spike is gone by the time you have opened a terminal.</strong> That is
  the argument for exporting these continuously to a metrics system rather than attaching a tool when
  something breaks.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Several runtime instruments are <strong>tagged</strong> — heap size reports once per generation,
    with a <code>gc.heap.generation</code> tag — so one pull produces several measurements for the same
    instrument name.</p>
    <p>Code that overwrites on each callback keeps only the last tag and reports a heap size of zero.
    That was a real bug in this module's own verification code before it was found. Sum across tags
    within one pull.</p>
  </div>

  <h3>Allocation rate is not the problem indicator</h3>

  <pre data-lang="console" data-title="04-exercises.cs"><code>   scenario            allocated MB   live heap MB   verdict
   --------            ------------   ------------   -------
   dies young                   214              0   healthy
   retained                     230            230   LEAK</code></pre>

  <p>Near-identical allocation. <strong>The live heap after a collection is the only column that
  distinguishes them.</strong> A service allocating gigabytes an hour with a flat live heap is healthy
  and needs no attention.</p>

  <p>And a third case neither column catches: live heap flat while the working set climbs. That is
  fragmentation or native memory, and it needs the two counters <em>compared</em>.</p>
</section>

<section id="traces">
  <h2>Traces: the event stream</h2>

  <pre data-lang="console" data-title="02-events-and-traces.cs"><code>   total runtime events captured : 1,185

   event                                    count
   -----                                    -----
   ContentionStart                              324
   ContentionStop                               324
   GCMarkWithType                               194
   GCSuspendEEBegin_V1                           28
   GCTriggered                                   28
   GCStart_V2                                    28
   GCEnd_V1                                      28
   GCHeapStats_V2                                28

   the first few collections, decoded:
     gen 0, reason 0, type 0
     gen 1, reason 0, type 0
     gen 0, reason 0, type 0</code></pre>

  <p><code>GCStart_V2</code> and <code>GCEnd_V1</code> bracket every collection, and the
  <code>Depth</code> payload is the generation. Subtracting the timestamps gives the pause, which is
  what a GC profile is built from.</p>

  <p><code>ContentionStart</code> and <code>ContentionStop</code> bracket a lock acquisition that had to
  <em>wait</em>. An uncontended lock produces no events at all, so this stream is specifically the
  expensive case.</p>

  <pre data-lang="bash" data-title="The same providers, from outside"><code># A ready-made profile, which is what you want most of the time.
dotnet-trace collect --process-id 4821 --profile cpu-sampling
dotnet-trace collect --process-id 4821 --profile gc-verbose

# The same thing spelled out, so the mapping is visible.
dotnet-trace collect --process-id 4821 \
  --providers Microsoft-Windows-DotNETRuntime:0x1:4

# Convert for speedscope.app, which needs nothing installed.
dotnet-trace convert --format speedscope trace.nettrace</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Part</th><th>Meaning</th></tr>
      </thead>
      <tbody>
        <tr><td><code>0x1</code></td><td>Keyword bitmask. <code>0x1</code> GC, <code>0x10</code> JIT, <code>0x4000</code> contention.</td></tr>
        <tr><td><code>4</code></td><td>Level. 4 is Informational, 5 is Verbose.</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>The keyword mask is the part that bites. Asking for everything at Verbose on a busy service
    writes hundreds of megabytes a minute and <strong>measurably slows the process you are trying to
    diagnose</strong>.</p>
    <p>Prefer <code>gc-collect</code> over <code>gc-verbose</code> unless you specifically need
    per-allocation detail: it records collections without every allocation, and it is enough to see
    pause frequency and duration.</p>
  </div>
</section>

<section id="dumps">
  <h2>Dumps: the only thing that shows a hang</h2>

  <p>A trace tells you what <em>happened</em> over a window. It cannot tell you what the process looks
  like <em>right now</em> — which is what you need for a hang, a deadlock, or a leak whose cause is a
  live reference.</p>

  <pre data-lang="bash"><code>dotnet-gcdump collect --process-id 4821 --output heap.gcdump

dotnet-dump collect --process-id 4821 --output hang.dmp
dotnet-dump analyze hang.dmp</code></pre>

  <pre data-lang="text" data-title="At the SOS prompt"><code>&gt; dumpasync
&gt; dumpheap -stat
&gt; dumpheap -stat -min 85000
&gt; gcroot 00007f2a1c004080
&gt; threads
&gt; clrstack
&gt; syncblk
&gt; eeheap -gc</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Command</th><th>Answers</th></tr>
      </thead>
      <tbody>
        <tr><td><code>dumpasync</code></td><td>Every async state machine parked at an await. Hundreds at the same await names the dependency you are waiting on.</td></tr>
        <tr><td><code>dumpheap -stat</code></td><td>The heap by type. Run twice, minutes apart, and diff — the type that grew is the leak.</td></tr>
        <tr><td><code>dumpheap -stat -min 85000</code></td><td>Everything on the large object heap.</td></tr>
        <tr><td><code>gcroot &lt;address&gt;</code></td><td>Why one object is still alive. Ending at a static field means an event subscription, a static cache or a static collection.</td></tr>
        <tr><td><code>syncblk</code></td><td>Which threads hold which monitors. A cycle here is a deadlock.</td></tr>
        <tr><td><code>clrstack</code> on the hot thread</td><td>What a pinned core is actually doing.</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>Prefer a gcdump to a full dump for memory questions.</strong> It is far smaller, faster,
  and answers "what is on the heap and what roots it" — which is the whole question for a leak.</p>
</section>

<section id="instrumenting">
  <h2>Making your own code visible to the same tools</h2>

  <pre data-lang="console" data-title="04-exercises.cs"><code>   EventSource events captured : 5
     PaymentSettled: 4000000, GBP, 123450

   Meter counter total         : 5
   Meter histogram total       : 96 ms

   Activities:
     SettlePayment 26 ms [currency=GBP, payment.id=4000000]
     SettlePayment 25 ms [currency=GBP, payment.id=4000001]</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Mechanism</th><th>Read by</th><th>Use for</th></tr>
      </thead>
      <tbody>
        <tr><td><code>EventSource</code></td><td><code>dotnet-trace</code></td><td>High-volume structured events you want off by default</td></tr>
        <tr><td><code>Meter</code></td><td><code>dotnet-counters</code>, any metrics backend</td><td>Rates and distributions you always want</td></tr>
        <tr><td><code>ActivitySource</code></td><td>OpenTelemetry</td><td>Following one request across services</td></tr>
      </tbody>
    </table>
  </div>

  <pre data-lang="csharp" data-net="10" data-title="All three, and none needs a package"><code>using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Diagnostics.Tracing;

[EventSource(Name = "Ledger-Payments")]
public sealed class LedgerEvents : EventSource
{
    public static readonly LedgerEvents Log = new();

    [Event(1, Level = EventLevel.Informational)]
    public void PaymentSettled(long id, string currency, long amountMinor) =&gt;
        WriteEvent(1, id, currency, amountMinor);
}

public sealed class PaymentTelemetry : IDisposable
{
    private static readonly ActivitySource Source = new("Ledger.Payments");
    private readonly Meter _meter = new("Ledger.Payments");
    private readonly Counter&lt;long&gt; _settled;
    private readonly Histogram&lt;double&gt; _duration;

    public PaymentTelemetry()
    {
        _settled = _meter.CreateCounter&lt;long&gt;("ledger.payments.settled");
        _duration = _meter.CreateHistogram&lt;double&gt;("ledger.payments.duration");
    }

    public void Settle(Payment payment)
    {
        // A span, for distributed tracing.
        using Activity? activity = Source.StartActivity("SettlePayment");
        activity?.SetTag("currency", payment.Currency);
        activity?.SetTag("payment.id", payment.Id);

        var stopwatch = Stopwatch.StartNew();
        DoSettle(payment);
        stopwatch.Stop();

        // A high-volume event, off unless somebody is tracing.
        LedgerEvents.Log.PaymentSettled(payment.Id, payment.Currency, payment.AmountMinor);

        // Metrics, always on and nearly free.
        _settled.Add(1);
        _duration.Record(stopwatch.Elapsed.TotalMilliseconds);
    }

    private static void DoSettle(Payment payment)
    {
        // The real work.
    }

    public void Dispose() =&gt; _meter.Dispose();
}

public sealed record Payment(long Id, string Currency, long AmountMinor);</code></pre>

  <p>All three are in the base class library and all three are what the tools already know how to read
  — which is the reason to use them rather than writing log lines that a human has to grep.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong><code>EventSourceSupport</code> is a trimming feature switch, and setting it false
    silently disables all of this.</strong> Your <code>EventSource</code> compiles, runs, and emits
    nothing; <code>dotnet-trace</code> attaches happily and records an empty file.</p>
    <pre data-lang="xml"><code>&lt;PublishTrimmed&gt;true&lt;/PublishTrimmed&gt;
&lt;EventSourceSupport&gt;false&lt;/EventSourceSupport&gt;</code></pre>
    <p>This module's own verification file reported zero events until the switch was set, which is
    exactly how it presents in production.</p>
    <p>The related switches worth auditing on a trimmed image: <code>MetricsSupport</code> disables
    counters, <code>UseSystemResourceKeys</code> strips exception <em>message text</em>, and
    <code>StackTraceSupport</code> strips stack detail. The last two are the cruellest — an exception
    can arrive with a resource key instead of a message and no usable stack.</p>
    <p>Check these before you need them, not during an incident.</p>
  </div>
</section>

<section id="production">
  <h2>Three incidents, one symptom</h2>

  <pre data-lang="console" data-title="03-production.cs"><code>   scenario               alloc MB   GC pause s   contentions   peak queue   peak thr   CPU/wall
   --------               --------   ----------   -----------   ----------   --------   --------
   idle baseline                 0        0.000             0            0          0       0.00
   A: allocation               313        0.321             0            0          0       0.87
   B: blocked pool               0        0.000             8          424          8       0.08
   C: lock contention            0        0.000         2,332            1          9       2.26</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th></th><th>Signature</th><th>Next step</th><th>The Ledger cause</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>A</strong></td><td>Allocation high, pause high, everything else flat</td><td><code>dotnet-gcdump</code>, sort by size</td><td>A 30-second response cache — long enough to guarantee promotion, short enough that it was all garbage by the time gen 2 ran</td></tr>
        <tr><td><strong>B</strong></td><td>Queue high, CPU/wall <em>low</em>, allocation and pauses flat</td><td><code>dotnet-dump</code>, then <code>dumpasync</code></td><td>A <code>.Result</code> on an <code>HttpClient</code> call inside a handler</td></tr>
        <tr><td><strong>C</strong></td><td>Contentions high, CPU/wall <em>high</em>, allocation flat</td><td><code>dotnet-trace</code> with keyword <code>0x4000</code></td><td>A lock held across a remote call</td></tr>
      </tbody>
    </table>
  </div>

  <p>Note that B and C have opposite CPU/wall readings — 0.08 against 2.26 — despite presenting
  identically to a user. <strong>Waiting and working look the same from outside and are opposite from
  inside.</strong></p>

  <h3>The fourth case, which is the most common</h3>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>All four counters flat and latency still up means the process is waiting on something
    <em>outside</em> it — a database, a downstream service, a disk, a DNS lookup. No runtime counter
    will show it, <strong>and that absence is the finding.</strong></p>
    <p>This is the most common real answer and the one people reach last, because there is nothing to
    look at. Reading the counters and confirming they are flat takes thirty seconds and rules out every
    in-process cause at once.</p>
    <p>The trap inside it is connection pool exhaustion, which looks exactly like a slow dependency —
    requests waiting, CPU idle — and is caused by <em>your</em> code holding connections too long.
    Neither the runtime counters nor the database show it; the pool's own metrics do.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Taking a dump first</h3>

  <p>A full dump of a 4 GB process is a 4 GB file, takes minutes, and stops the process while it is
  written. Taken before the counters have been read, it is a very large file nobody knows what to look
  for in.</p>

  <p><strong>Work down the list: counters, trace, dump.</strong> Each step is more expensive and more
  specific, and the previous one tells you what to look for in the next.</p>

  <h3>2. Forcing a collection to measure memory</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="A full collection every ten seconds"><code>app.MapGet("/health", () =&gt; new
{
    // WRONG: the true argument forces a blocking collection. A monitor
    // polling every 10 seconds now adds a full GC every 10 seconds, and
    // the endpoint that reports health is causing the symptom.
    memoryMb = GC.GetTotalMemory(forceFullCollection: true) / 1024 / 1024
});</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Free, and more informative"><code>app.MapGet("/diagnostics", () =&gt;
{
    GCMemoryInfo info = GC.GetGCMemoryInfo();
    using Process current = Process.GetCurrentProcess();

    return new
    {
        // No collection forced: these describe the LAST one.
        heapMb = info.HeapSizeBytes / 1024 / 1024,
        fragmentedMb = info.FragmentationBytes / 1024 / 1024,
        workingSetMb = current.WorkingSet64 / 1024 / 1024,

        // Cumulative. Two samples give a rate, which is what you want.
        allocatedMbTotal = GC.GetTotalAllocatedBytes() / 1024 / 1024,
        pauseSeconds = GC.GetTotalPauseDuration().TotalSeconds,

        // Without these, every number above is uninterpretable.
        serverGc = System.Runtime.GCSettings.IsServerGC,
        processors = Environment.ProcessorCount
    };
});</code></pre>

  <h3>3. Charting cumulative allocation as "memory usage"</h3>

  <p><code>GC.GetTotalAllocatedBytes()</code> only ever rises. Charted as usage it climbs forever on a
  perfectly healthy service, and it is one of the most common ways a team convinces itself it has a
  leak.</p>

  <h3>4. Sampling a level after the incident</h3>

  <p>Queue length read 324 during the incident and 0 afterwards. Attaching <code>dotnet-counters</code>
  once you have been paged tells you about totals since process start and nothing about the levels
  during the spike.</p>

  <h3>5. Tracing at Verbose on a busy process</h3>

  <p>The keyword mask and level decide the volume. <code>gc-verbose</code> records every allocation;
  on a service allocating 4 MB/s that is a trace file growing faster than you can read it, and enough
  overhead to change the behaviour you are measuring.</p>

  <h3>6. Shipping a trimmed image with diagnostics compiled out</h3>

  <pre data-lang="console" data-bad="true"><code>total runtime events captured : 0</code></pre>

  <p>No error, no warning. <code>EventSourceSupport=false</code> is a normal size optimisation and it
  removes your ability to diagnose the build it applies to.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> latency up, or memory up, or CPU up, with no obvious cause.</p>
    <p><strong>Method:</strong> counters to identify which class of problem, then the specific tool for
    that class. Never form the theory first.</p>
  </div>

  <h3>Step 1: read the counters and take the ratio</h3>

  <pre data-lang="bash"><code>dotnet-counters monitor --process-id 4821 --counters System.Runtime</code></pre>

  <p><strong>CPU-seconds per second of wall clock is the first number to compute</strong>, because it
  halves the problem space:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>CPU/wall</th><th>Meaning</th><th>Then check</th></tr>
      </thead>
      <tbody>
        <tr><td>Low</td><td>Waiting</td><td>Queue length, then the dependency, then a dump for <code>dumpasync</code></td></tr>
        <tr><td>High</td><td>Working</td><td>Allocation rate, pause time, contentions</td></tr>
        <tr><td>High, allocation flat</td><td>A spin loop</td><td><code>clrstack</code> on the hot thread</td></tr>
      </tbody>
    </table>
  </div>

  <h3>Step 2: match the signature</h3>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Symptom</th><th>Counter to read first</th></tr>
      </thead>
      <tbody>
        <tr><td>Latency up, CPU low</td><td><code>thread_pool.queue.length</code></td></tr>
        <tr><td>Latency up, CPU high</td><td><code>monitor.lock_contentions</code>, then <code>gc.pause.time</code></td></tr>
        <tr><td>Memory climbing</td><td><code>gc.last_collection.heap.size</code></td></tr>
        <tr><td>Memory climbing, heap flat</td><td><code>process.memory.working_set</code> — fragmentation or native</td></tr>
        <tr><td>Periodic latency spikes</td><td><code>gc.pause.time</code></td></tr>
        <tr><td>CPU pinned, no throughput</td><td><code>gc.heap.total_allocated</code> — flat means a spin loop</td></tr>
        <tr><td>Everything flat</td><td>It is not the runtime. Look outside the process.</td></tr>
      </tbody>
    </table>
  </div>

  <h3>Step 3: the specific tool</h3>

  <pre data-lang="bash"><code># Memory: what is on the heap, and what roots it.
dotnet-gcdump collect --process-id 4821 --output heap.gcdump

# CPU: where the time goes.
dotnet-trace collect --process-id 4821 --profile cpu-sampling

# Contention: the stacks that waited.
dotnet-trace collect --process-id 4821 \
  --providers Microsoft-Windows-DotNETRuntime:0x4000:4

# A hang: the only thing that shows state.
dotnet-dump collect --process-id 4821 --output hang.dmp</code></pre>

  <h3>Step 4: what to have in place beforehand</h3>

  <p>Everything above is reactive, and two of the four counter classes are levels that are gone by the
  time you attach. What actually shortens an incident is having been ready:</p>

  <ul>
    <li><strong>Export the runtime counters continuously</strong> to whatever you already use for
    metrics. This is the single highest-value item, and it is the only way to see a level during a
    spike.</li>
    <li><strong>A diagnostics endpoint</strong> as above — free to call, no forced collection, and it
    reports <code>IsServerGC</code> and processor count so every other number is interpretable.</li>
    <li><strong>The tools installed in the image</strong>, or a sidecar that can attach. Installing
    <code>dotnet-dump</code> during an incident on a locked-down container is its own outage.</li>
    <li><strong>An audit of the trimming feature switches</strong>, so the diagnostics you rely on
    exist in the build you deploy.</li>
  </ul>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"High allocation means a memory problem."</strong></p>
    <p>Measured: 214 MB allocated with a 0 MB live heap is healthy — objects died in generation 0,
    which is the cheap case. 230 MB allocated with a 230 MB live heap is the leak.</p>
    <p>The live heap after a collection is the column that distinguishes them, and allocation rate on
    its own says nothing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Latency up with low CPU means a slow database."</strong></p>
    <p>It means the process is waiting, which has at least four causes: thread-pool starvation, lock
    contention on an async primitive, connection pool exhaustion, and an actually slow dependency.</p>
    <p>Measured, thread-pool starvation showed a queue of 424 with CPU/wall at 0.08 — a signature no
    database would produce.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Take a dump, it has everything in it."</strong></p>
    <p>It has everything and no index. A dump answers "what state is this in", which is the right
    question for a hang and the wrong one for a slow service. It also stops the process to take.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I can attach dotnet-counters when something goes wrong."</strong></p>
    <p>For totals, yes. For levels — queue length, thread count, heap size — the spike is over.
    Measured: 324 during the incident, 0 afterwards.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A health endpoint should report memory, so use GC.GetTotalMemory."</strong></p>
    <p>Its <code>forceFullCollection: true</code> overload forces a blocking collection. Polled every
    ten seconds, the endpoint reporting health is now causing a full GC every ten seconds.</p>
    <p>Use <code>GC.GetGCMemoryInfo()</code>, which describes the last collection and forces nothing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Logging is instrumentation."</strong></p>
    <p>Logs are for humans reading one request. <code>Meter</code>, <code>EventSource</code> and
    <code>ActivitySource</code> are read by the tools directly, aggregate without parsing, and can be
    switched on and off without a deployment.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"If my EventSource compiles, it works."</strong></p>
    <p><code>EventSourceSupport=false</code> — a normal trimming optimisation — compiles it and emits
    nothing, with no error. This module's own verification code reported zero events until the switch
    was set.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Every module in this track ends with "and here is how you would see it in production". This is
    that chapter, and the measurements make the point better than the argument does: three incidents,
    one symptom, and each one moved exactly one counter.</p>
    <p>The value is not the tools. It is the ordering — counters, then trace, then dump — and the
    willingness to read the numbers before forming a theory. Ledger's three-hour incident was three
    hours because the symptom suggested a database and nobody checked the 313 MB of allocation that
    ruled it out.</p>
    <p>And the fourth case is the one to internalise: <strong>every counter flat is a finding</strong>.
    It rules out every in-process cause in thirty seconds, and it is the most common real answer.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Situation</th><th>Reach for</th></tr>
      </thead>
      <tbody>
        <tr><td>Anything, first</td><td><code>dotnet-counters</code>, and compute CPU/wall</td></tr>
        <tr><td>Live heap growing</td><td><code>dotnet-gcdump</code>, then <code>gcroot</code></td></tr>
        <tr><td>High CPU</td><td><code>dotnet-trace --profile cpu-sampling</code></td></tr>
        <tr><td>Latency spikes on a period</td><td><code>dotnet-trace --profile gc-collect</code></td></tr>
        <tr><td>Throughput down, CPU high</td><td>Contention keyword <code>0x4000</code></td></tr>
        <tr><td>A hang or deadlock</td><td><code>dotnet-dump</code>, then <code>dumpasync</code> and <code>syncblk</code></td></tr>
        <tr><td>Every counter flat</td><td>Stop looking at the runtime. It is outside the process.</td></tr>
        <tr><td>Before any of it happens</td><td>Export counters continuously; audit the feature switches</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Memory is climbing steadily. Which counter tells you whether it is a leak, and what are the three
    possible answers?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong><code>dotnet.gc.last_collection.heap.size</code> — the live heap after a
        collection.</strong></p>
        <pre data-lang="console"><code>   scenario            allocated MB   live heap MB   verdict
   dies young                   214              0   healthy
   retained                     230            230   LEAK</code></pre>
        <p>Near-identical allocation, opposite verdicts. The three cases:</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Live heap</th><th>Working set</th><th>Diagnosis</th></tr></thead>
            <tbody>
              <tr><td>Flat</td><td>Flat</td><td>Healthy, whatever the allocation rate</td></tr>
              <tr><td><strong>Climbing</strong></td><td>Climbing</td><td>A managed leak — <code>dotnet-gcdump</code>, then <code>gcroot</code></td></tr>
              <tr><td>Flat</td><td><strong>Climbing</strong></td><td>Fragmentation, or native memory. No managed tool will show it.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>The third row is the one that wastes days</strong>, because a gcdump of it looks
        completely healthy — the managed heap genuinely is fine. Check the LOH fragmentation counter,
        and then look for native allocations: a P/Invoke, an unclosed handle, or a third-party
        library.</p>
        <p>And do not chart <code>gc.heap.total_allocated</code> as "memory". It is cumulative and
        climbs forever on a healthy service.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>p99 is up and CPU is at 20%. Name three possible causes and the counter that distinguishes each.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console"><code>   scenario               alloc MB   GC pause s   contentions   peak queue   CPU/wall
   A: allocation               313        0.321             0            0       0.87
   B: blocked pool               0        0.000             8          424       0.08
   C: lock contention            0        0.000         2,332            1       2.26</code></pre>
        <ol>
          <li><strong>Thread-pool starvation</strong> — <code>thread_pool.queue.length</code> above
          zero, CPU/wall low. Something is blocking a pool thread; a <code>.Result</code> or
          <code>.Wait()</code> on an async call.</li>
          <li><strong>GC pauses</strong> — <code>gc.pause.time</code> rising. Look for promotion: a
          cache with a lifetime of seconds is the classic cause.</li>
          <li><strong>Lock contention</strong> — <code>monitor.lock_contentions</code> rising. Note
          CPU/wall is <em>high</em> here, because waiting threads spin before they block.</li>
        </ol>
        <p><strong>And the fourth, which is the most common:</strong> all of them flat. That rules out
        every in-process cause at once and means the process is waiting on something external. The
        absence is the finding.</p>
        <p>A caveat worth carrying: contention on <code>SemaphoreSlim.WaitAsync</code> does
        <em>not</em> appear in <code>monitor.lock_contentions</code>, because that counter tracks
        monitors only. An async lock held too long looks exactly like case four.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>You attach <code>dotnet-counters</code> after being paged and the queue length reads zero, but
    the incident is ongoing. What happened, and what should have been in place?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console"><code>   queue length DURING the incident :    324
   queue length AFTER               :      0</code></pre>
        <p><strong>Queue length is a level, not a total.</strong> It reads the current depth, so it
        shows the spike only while the spike is happening. If the burst has passed — or if the pool has
        since injected enough threads to drain it — the counter is back to zero while latency is still
        recovering.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Levels (lost if not sampled)</th><th>Totals (readable any time)</th></tr></thead>
            <tbody>
              <tr><td><code>thread_pool.queue.length</code></td><td><code>gc.heap.total_allocated</code></td></tr>
              <tr><td><code>thread_pool.thread.count</code></td><td><code>gc.collections</code></td></tr>
              <tr><td><code>gc.last_collection.heap.size</code></td><td><code>gc.pause.time</code></td></tr>
              <tr><td><code>process.memory.working_set</code></td><td><code>monitor.lock_contentions</code></td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>What should have been in place:</strong> continuous export of these counters to
        whatever you already use for metrics, so the level is recorded when it mattered.</p>
        <pre data-lang="csharp" data-net="10"><code>// The listener the exporter is built on. In production this is
// OpenTelemetry's meter provider rather than hand-written.
var listener = new MeterListener();

listener.InstrumentPublished = (instrument, l) =&gt;
{
    if (instrument.Meter.Name.StartsWith("System.Runtime", StringComparison.Ordinal))
    {
        l.EnableMeasurementEvents(instrument);
    }
};

listener.SetMeasurementEventCallback&lt;long&gt;((instrument, value, tags, _) =&gt;
    Exporter.Record(instrument.Name, value, tags));

listener.Start();

// Observable instruments are PULL-based. Nothing is published until
// something asks, which is what the refresh interval does.
_ = new Timer(_ =&gt; listener.RecordObservableInstruments(), null,
    TimeSpan.Zero, TimeSpan.FromSeconds(5));</code></pre>
        <p><strong>One detail that catches people:</strong> several instruments are tagged — heap size
        reports once per generation — so a single pull produces several measurements per name.
        Overwriting on each callback keeps only the last tag and reports a heap size of zero. That was
        a real bug in this module's own code.</p>
        <p>Failing continuous export, <code>dotnet-counters collect</code> writes to a CSV, so at least
        start it as soon as you are paged and capture the rest of the incident.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>Design a diagnostics endpoint. What goes in it, what must not, and why.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10"><code>app.MapGet("/internal/diagnostics", () =&gt;
{
    GCMemoryInfo info = GC.GetGCMemoryInfo();
    using Process current = Process.GetCurrentProcess();
    ThreadPool.GetAvailableThreads(out int workerAvailable, out _);
    ThreadPool.GetMaxThreads(out int workerMax, out _);

    return Results.Ok(new
    {
        // Memory. The RATIO of the first two is the diagnosis.
        heapMb = info.HeapSizeBytes / 1024 / 1024,
        workingSetMb = current.WorkingSet64 / 1024 / 1024,
        lohFragmentedMb = info.GenerationInfo.Length &gt; 3
            ? info.GenerationInfo[3].FragmentationAfterBytes / 1024 / 1024
            : 0,

        // Cumulative: two samples give a rate.
        allocatedMbTotal = GC.GetTotalAllocatedBytes() / 1024 / 1024,
        gcPauseSeconds = GC.GetTotalPauseDuration().TotalSeconds,
        gen0 = GC.CollectionCount(0),
        gen2 = GC.CollectionCount(2),

        // Levels: the starvation signal.
        threadPoolThreads = ThreadPool.ThreadCount,
        threadPoolQueue = ThreadPool.PendingWorkItemCount,
        threadPoolBusy = workerMax - workerAvailable,

        // Without these, none of the above is interpretable.
        serverGc = System.Runtime.GCSettings.IsServerGC,
        processors = Environment.ProcessorCount,
        uptimeSeconds = (DateTime.UtcNow - current.StartTime.ToUniversalTime()).TotalSeconds
    });
})
.RequireAuthorization();</code></pre>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Field</th><th>Why it earns its place</th></tr></thead>
            <tbody>
              <tr><td><code>heapMb</code> + <code>workingSetMb</code></td><td>The ratio is the diagnosis. A low ratio means memory held outside the managed heap.</td></tr>
              <tr><td><code>allocatedMbTotal</code></td><td>Cumulative, so two polls give a rate — which is the number you actually want.</td></tr>
              <tr><td><code>threadPoolQueue</code></td><td>The starvation signal, and a level, so it must be polled rather than read once.</td></tr>
              <tr><td><code>serverGc</code>, <code>processors</code></td><td>Every performance number is meaningless without them, and nobody can guess them from outside.</td></tr>
              <tr><td><code>uptimeSeconds</code></td><td>Turns every cumulative counter into a rate, and tells you whether the process has recently restarted.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>What must not go in it:</strong></p>
        <ul>
          <li><strong>Anything forcing a collection.</strong> <code>GC.GetTotalMemory(true)</code>
          polled every ten seconds adds a full GC every ten seconds — the endpoint reporting health
          becomes the cause of the symptom.</li>
          <li><strong>Anything that allocates much.</strong> This runs under the load you are trying
          to measure.</li>
          <li><strong>Unauthenticated access.</strong> It is a map of your process for anyone who
          asks — hence <code>RequireAuthorization</code>.</li>
        </ul>
        <p><strong>What it does not replace:</strong> continuous export. An endpoint is pull-based and
        only sampled when something asks, so a spike between polls is invisible.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Instrument Ledger's payment path so the three tools can all see it. Say what goes in each
    mechanism and why it is not all logging.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10"><code>using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Diagnostics.Tracing;

[EventSource(Name = "Ledger-Payments")]
public sealed class LedgerEvents : EventSource
{
    public static readonly LedgerEvents Log = new();

    // Keywords let a tracer ask for one category. Settlement detail is
    // high volume, so it should be requestable on its own.
    public static class Keywords
    {
        public const EventKeywords Settlement = (EventKeywords)0x1;
        public const EventKeywords Reconciliation = (EventKeywords)0x2;
    }

    [Event(1, Level = EventLevel.Informational, Keywords = Keywords.Settlement)]
    public void PaymentSettled(long id, string currency, long amountMinor) =&gt;
        WriteEvent(1, id, currency, amountMinor);

    [Event(2, Level = EventLevel.Warning, Keywords = Keywords.Settlement)]
    public void PaymentRetried(long id, int attempt, string reason) =&gt;
        WriteEvent(2, id, attempt, reason);
}

public sealed class PaymentService : IDisposable
{
    private static readonly ActivitySource Activity = new("Ledger.Payments");

    private readonly Meter _meter = new("Ledger.Payments");
    private readonly Counter&lt;long&gt; _settled;
    private readonly Counter&lt;long&gt; _failed;
    private readonly Histogram&lt;double&gt; _duration;
    private readonly ILogger&lt;PaymentService&gt; _logger;

    public PaymentService(ILogger&lt;PaymentService&gt; logger)
    {
        _logger = logger;
        _settled = _meter.CreateCounter&lt;long&gt;("ledger.payments.settled");
        _failed = _meter.CreateCounter&lt;long&gt;("ledger.payments.failed");
        _duration = _meter.CreateHistogram&lt;double&gt;("ledger.payments.duration",
            unit: "ms", description: "End to end settlement time");
    }

    public async Task SettleAsync(Payment payment, CancellationToken cancellationToken)
    {
        using Activity? activity = Activity.StartActivity("SettlePayment");
        activity?.SetTag("payment.id", payment.Id);
        activity?.SetTag("payment.currency", payment.Currency);

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await SendToGatewayAsync(payment, cancellationToken).ConfigureAwait(false);

            stopwatch.Stop();

            LedgerEvents.Log.PaymentSettled(payment.Id, payment.Currency, payment.AmountMinor);
            _settled.Add(1, new KeyValuePair&lt;string, object?&gt;("currency", payment.Currency));
            _duration.Record(stopwatch.Elapsed.TotalMilliseconds);
        }
        catch (Exception ex)
        {
            stopwatch.Stop();

            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            _failed.Add(1, new KeyValuePair&lt;string, object?&gt;("currency", payment.Currency));

            // A log line, because a HUMAN needs the exception detail.
            _logger.LogError(ex, "Settlement failed for {PaymentId}", payment.Id);
            throw;
        }
    }

    private static Task SendToGatewayAsync(Payment payment, CancellationToken cancellationToken) =&gt;
        Task.Delay(5, cancellationToken);

    public void Dispose() =&gt; _meter.Dispose();
}

public sealed record Payment(long Id, string Currency, long AmountMinor);</code></pre>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Mechanism</th><th>Carries</th><th>Because</th></tr></thead>
            <tbody>
              <tr><td><code>Meter</code></td><td>Counts and durations, tagged by currency</td><td>Always on, nearly free, aggregates without parsing. This is what your dashboard and alerts read.</td></tr>
              <tr><td><code>EventSource</code></td><td>Per-payment detail</td><td>Off unless somebody is tracing. High volume is acceptable because it costs nothing when nobody listens.</td></tr>
              <tr><td><code>ActivitySource</code></td><td>A span with timing, tags and status</td><td>Follows one payment across service boundaries — the only one that answers "where did this request spend its time".</td></tr>
              <tr><td><code>ILogger</code></td><td>The exception</td><td>A human reads this. Logs are for detail about one occurrence.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>Why not do it all with logging:</strong> to get the settlement rate from logs you
        must emit a line per payment, ship it, parse it and aggregate it — expensive at every step, and
        the answer arrives minutes late. A <code>Counter</code> gives the same number for the cost of
        an increment.</p>
        <p><strong>And the thing to check before relying on any of it:</strong>
        <code>EventSourceSupport</code> and <code>MetricsSupport</code> in your published build.
        Trimmed to false, all three mechanisms compile and emit nothing.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>p99 is four seconds. CPU/wall is 0.05. Queue length is zero, GC pause flat, contentions flat,
    heap flat, working set flat. Every counter is normal. What now?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The finding is the absence.</strong> Every runtime counter being flat rules out all
        four in-process causes at once — allocation pressure, GC pauses, thread-pool starvation and
        monitor contention. That is a real result and the fastest one available.</p>
        <p>The process is waiting on something outside itself. Where to look, in order:</p>
        <ol>
          <li><strong>A dump, for what the threads are waiting on.</strong>
          <pre data-lang="text"><code>dotnet-dump collect --process-id 4821
&gt; dumpasync</code></pre>
          Hundreds of state machines parked at the same await names the dependency. This is the single
          highest-value command for this symptom.</li>
          <li><strong>The dependency's own latency.</strong> A database, a downstream service, a disk,
          a DNS lookup. Your runtime counters cannot see any of them.</li>
          <li><strong>Connection pool exhaustion</strong> — the trap here. It looks exactly like a slow
          dependency (requests waiting, CPU idle) and is caused by <em>your</em> code holding
          connections too long. Neither the runtime counters nor the database show it; the pool's own
          metrics do.</li>
          <li><strong>A lock held across an await.</strong> <code>SemaphoreSlim.WaitAsync</code> does
          not register as monitor contention, so <code>monitor.lock_contentions</code> stays flat while
          every request queues behind one semaphore. A dump shows the waiters.</li>
        </ol>
        <p><strong>What NOT to do:</strong> start taking CPU profiles. CPU/wall of 0.05 already says
        the process is not using the CPU, so a sampling profile will show idle stacks and waste the
        next twenty minutes.</p>
        <p><strong>The general lesson:</strong> runtime counters diagnose the runtime. Most production
        latency is not the runtime, and knowing that in thirty seconds instead of three hours is what
        they are worth.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>In what order do you reach for counters, traces and dumps, and why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Counters, then trace, then dump. Each is more expensive and more
        specific, and the previous one tells you what to look for in the next. A dump taken first is a
        very large file nobody knows what to look for in.</p></div>
      </details></li>

    <li><p>What does CPU-seconds per second of wall clock tell you?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>How many cores the process is actually using. <strong>Low means
        waiting, high means working</strong> — measured at 0.08 for thread-pool starvation and 2.26 for
        lock contention, two problems that look identical from outside.</p></div>
      </details></li>

    <li><p>Which counter distinguishes a leak from healthy allocation?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The live heap after a collection. Measured, 214 MB allocated with a
        0 MB heap is healthy and 230 MB with a 230 MB heap is the leak. Allocation rate alone says
        nothing.</p></div>
      </details></li>

    <li><p>What is the difference between a level and a total, and why does it matter?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A level reads the current value — queue length, heap size, thread
        count — so it is gone once the spike passes. Measured: 324 during the incident, 0 afterwards.</p>
        <p>Totals accumulate and can be read at any time by taking differences. Levels must be exported
        continuously or they are lost.</p></div>
      </details></li>

    <li><p>What do the two numbers after a provider name in <code>dotnet-trace</code> mean?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A keyword bitmask and a level. <code>0x1</code> is GC,
        <code>0x10</code> JIT, <code>0x4000</code> contention; level 4 is Informational and 5 is
        Verbose.</p>
        <p>The mask is what stops a trace writing hundreds of megabytes a minute and slowing the
        process you are diagnosing.</p></div>
      </details></li>

    <li><p>Which SOS command shows you what a hung service is waiting on?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>dumpasync</code> — every async state machine parked at its
        await. Hundreds at the same await names the dependency. <code>syncblk</code> covers the
        synchronous case, where a cycle is a deadlock.</p></div>
      </details></li>

    <li><p>Why should a health endpoint never call
      <code>GC.GetTotalMemory(forceFullCollection: true)</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It forces a blocking collection. Polled every ten seconds, the
        endpoint reporting health causes a full GC every ten seconds. Use
        <code>GC.GetGCMemoryInfo()</code>, which describes the last collection and forces nothing.</p></div>
      </details></li>

    <li><p>What are <code>Meter</code>, <code>EventSource</code> and <code>ActivitySource</code> each
      for?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>Meter</code>: counters and histograms, always on, read by
        <code>dotnet-counters</code> and metrics backends. <code>EventSource</code>: high-volume
        structured events, off unless traced, read by <code>dotnet-trace</code>.
        <code>ActivitySource</code>: spans with timing and tags, read by OpenTelemetry for following a
        request across services.</p></div>
      </details></li>

    <li><p>What can silently disable all of your custom diagnostics?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>EventSourceSupport=false</code>, a trimming feature switch.
        The code compiles, runs, and emits nothing; <code>dotnet-trace</code> records an empty file.</p>
        <p>Also audit <code>MetricsSupport</code>, <code>UseSystemResourceKeys</code> (strips exception
        message text) and <code>StackTraceSupport</code>.</p></div>
      </details></li>

    <li><p>Every counter is flat and latency is still up. What have you learned?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>That it is not the runtime — which rules out allocation pressure,
        GC pauses, thread-pool starvation and monitor contention in one step. The process is waiting on
        something external.</p>
        <p>Take a dump and run <code>dumpasync</code> to find which await, and check connection pool
        metrics, which no runtime counter covers.</p></div>
      </details></li>
  </ol>
</section>
`
});
