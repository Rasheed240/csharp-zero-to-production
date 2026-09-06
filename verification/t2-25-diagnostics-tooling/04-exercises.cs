// 04-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 04-exercises.cs -c Release

#:property EventSourceSupport=true

using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Diagnostics.Tracing;

using var counters = new Counters();
counters.Start();

Exercise1(counters);
Exercise2(counters);
Exercise3(counters);
Exercise4();
Exercise5(counters);
Exercise6();

// ---------------------------------------------------------------------------
// 1. EASY — leak or fragmentation?
// ---------------------------------------------------------------------------
static void Exercise1(Counters counters)
{
    Console.WriteLine("Exercise 1: memory is climbing. Leak, or not?");
    Console.WriteLine();

    Console.WriteLine("   scenario            allocated MB   live heap MB   verdict");
    Console.WriteLine("   --------            ------------   ------------   -------");

    // (a) High allocation, nothing retained.
    counters.Sample();
    double a0 = counters.Read("dotnet.gc.heap.total_allocated");
    for (int i = 0; i < 800_000; i++)
    {
        var block = new byte[256];
        block[0] = (byte)i;
    }

    GC.Collect();
    counters.Sample();
    double aAlloc = (counters.Read("dotnet.gc.heap.total_allocated") - a0) / 1024 / 1024;
    double aHeap = counters.Read("dotnet.gc.last_collection.heap.size") / 1024 / 1024;
    Console.WriteLine($"   dies young          {aAlloc,12:N0}   {aHeap,12:N0}   healthy");

    // (b) Same allocation, everything retained.
    var retained = new List<byte[]>();
    counters.Sample();
    double b0 = counters.Read("dotnet.gc.heap.total_allocated");
    for (int i = 0; i < 800_000; i++)
    {
        var block = new byte[256];
        block[0] = (byte)i;
        retained.Add(block);
    }

    GC.Collect();
    counters.Sample();
    double bAlloc = (counters.Read("dotnet.gc.heap.total_allocated") - b0) / 1024 / 1024;
    double bHeap = counters.Read("dotnet.gc.last_collection.heap.size") / 1024 / 1024;
    Console.WriteLine($"   retained            {bAlloc,12:N0}   {bHeap,12:N0}   LEAK");

    GC.KeepAlive(retained);
    retained.Clear();

    Console.WriteLine();
    Console.WriteLine("   IDENTICAL allocation. The difference is the live heap after a");
    Console.WriteLine("   collection, and that is the only column that distinguishes them.");
    Console.WriteLine();
    Console.WriteLine("   The rule: allocation rate is not a problem indicator. A service");
    Console.WriteLine("   allocating gigabytes an hour with a flat live heap is healthy.");
    Console.WriteLine();
    Console.WriteLine("   And a third case neither column catches: live heap FLAT while the");
    Console.WriteLine("   process working set climbs. That is fragmentation or native memory,");
    Console.WriteLine("   and it needs the working-set counter compared to the heap counter.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. EASY — which counter for which symptom.
// ---------------------------------------------------------------------------
static void Exercise2(Counters counters)
{
    Console.WriteLine("Exercise 2: name the counter for each symptom");
    Console.WriteLine();

    counters.Sample();

    Console.WriteLine("   symptom                          counter to read first");
    Console.WriteLine("   -------                          ---------------------");
    Console.WriteLine("   latency up, CPU low              dotnet.thread_pool.queue.length");
    Console.WriteLine("   latency up, CPU high             dotnet.process.cpu.time (ratio to wall)");
    Console.WriteLine("   memory climbing                  dotnet.gc.last_collection.heap.size");
    Console.WriteLine("   memory climbing, heap flat       dotnet.process.memory.working_set");
    Console.WriteLine("   periodic latency spikes          dotnet.gc.pause.time");
    Console.WriteLine("   throughput down, CPU high        dotnet.monitor.lock_contentions");
    Console.WriteLine("   CPU pinned, no work done         dotnet.gc.heap.total_allocated (flat)");
    Console.WriteLine();
    Console.WriteLine("   Current values on this process:");
    Console.WriteLine();
    Console.WriteLine($"     queue length      : {counters.Read("dotnet.thread_pool.queue.length"),10:N0}");
    Console.WriteLine($"     thread count      : {counters.Read("dotnet.thread_pool.thread.count"),10:N0}");
    Console.WriteLine($"     live heap         : {counters.Read("dotnet.gc.last_collection.heap.size") / 1024 / 1024,10:N0} MB");
    Console.WriteLine($"     working set       : {counters.Read("dotnet.process.memory.working_set") / 1024 / 1024,10:N0} MB");
    Console.WriteLine($"     lock contentions  : {counters.Read("dotnet.monitor.lock_contentions"),10:N0}");
    Console.WriteLine();
    Console.WriteLine("   The last line of the table is the one people miss. A spin loop");
    Console.WriteLine("   burns a core and allocates NOTHING, so high CPU with a flat");
    Console.WriteLine("   allocation rate is the signature - a genuinely busy service");
    Console.WriteLine("   allocates as it works.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — the counter that is a level, not a total.
// ---------------------------------------------------------------------------
static void Exercise3(Counters counters)
{
    Console.WriteLine("Exercise 3: why does queue length read zero afterwards?");
    Console.WriteLine();

    var release = new ManualResetEventSlim(false);
    for (int i = 0; i < Environment.ProcessorCount * 4; i++)
    {
        ThreadPool.QueueUserWorkItem(_ => release.Wait());
    }

    for (int i = 0; i < 300; i++)
    {
        ThreadPool.QueueUserWorkItem(_ => Thread.SpinWait(200));
    }

    Thread.Sleep(150);
    counters.Sample();
    double during = counters.Read("dotnet.thread_pool.queue.length");

    release.Set();
    Thread.Sleep(300);
    counters.Sample();
    double after = counters.Read("dotnet.thread_pool.queue.length");

    Console.WriteLine($"   queue length DURING the incident : {during,6:N0}");
    Console.WriteLine($"   queue length AFTER               : {after,6:N0}");
    Console.WriteLine();
    Console.WriteLine("   Queue length is a LEVEL, not a total. It reads the current depth,");
    Console.WriteLine("   so by the time you have been paged, opened a terminal and attached");
    Console.WriteLine("   dotnet-counters, the spike is gone.");
    Console.WriteLine();
    Console.WriteLine("   Which counters are levels and which accumulate:");
    Console.WriteLine();
    Console.WriteLine("     LEVELS (sample continuously, or you lose them)");
    Console.WriteLine("       thread_pool.queue.length, thread_pool.thread.count,");
    Console.WriteLine("       gc.last_collection.heap.size, process.memory.working_set");
    Console.WriteLine();
    Console.WriteLine("     TOTALS (read any time; take differences)");
    Console.WriteLine("       gc.heap.total_allocated, gc.collections, gc.pause.time,");
    Console.WriteLine("       monitor.lock_contentions, process.cpu.time");
    Console.WriteLine();
    Console.WriteLine("   The consequence: attaching dotnet-counters AFTER the incident");
    Console.WriteLine("   tells you about the totals since process start and nothing about");
    Console.WriteLine("   the levels during the spike.");
    Console.WriteLine();
    Console.WriteLine("   That is the argument for exporting these continuously to a");
    Console.WriteLine("   metrics system rather than attaching a tool when something breaks.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — instrumenting your own code.
// ---------------------------------------------------------------------------
static void Exercise4()
{
    Console.WriteLine("Exercise 4: making your own code visible to the same tools");
    Console.WriteLine();

    // Touch the EventSource before the listener is constructed, so the
    // listener's OnEventSourceCreated sees it.
    _ = LedgerEvents.Log;
    using var listener = new LedgerListener();

    // A Meter, which dotnet-counters can read by name.
    using var meter = new Meter("Ledger.Payments");
    Counter<long> settled = meter.CreateCounter<long>("ledger.payments.settled");
    Histogram<double> duration = meter.CreateHistogram<double>("ledger.payments.duration");

    long observed = 0;
    double totalMs = 0;
    using var meterListener = new MeterListener();
    meterListener.InstrumentPublished = (i, l) =>
    {
        if (i.Meter.Name == "Ledger.Payments")
        {
            l.EnableMeasurementEvents(i);
        }
    };

    meterListener.SetMeasurementEventCallback<long>((i, v, _, _) => Interlocked.Add(ref observed, v));
    meterListener.SetMeasurementEventCallback<double>((i, v, _, _) => totalMs += v);
    meterListener.Start();

    // An ActivitySource, which is what distributed tracing reads.
    using var activitySource = new ActivitySource("Ledger.Payments");
    var activities = new List<string>();
    ActivitySource.AddActivityListener(new ActivityListener
    {
        ShouldListenTo = s => s.Name == "Ledger.Payments",
        Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
        // TagObjects, not Tags: Tags exposes only the string-valued tags, so
        // a numeric tag set with SetTag is silently missing from it.
        ActivityStopped = a => activities.Add($"{a.OperationName} {a.Duration.TotalMilliseconds:F0} ms " +
            $"[{string.Join(", ", a.TagObjects.Select(t => $"{t.Key}={t.Value}"))}]")
    });

    for (int i = 0; i < 5; i++)
    {
        using Activity? activity = activitySource.StartActivity("SettlePayment");
        activity?.SetTag("currency", "GBP");
        activity?.SetTag("payment.id", 4_000_000 + i);

        var sw = Stopwatch.StartNew();
        Thread.Sleep(10);
        sw.Stop();

        LedgerEvents.Log.PaymentSettled(4_000_000 + i, "GBP", 123_450 + i);
        settled.Add(1);
        duration.Record(sw.Elapsed.TotalMilliseconds);
    }

    Thread.Sleep(100);

    Console.WriteLine($"   EventSource events captured : {listener.Count}");
    foreach (string line in listener.First(3))
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine($"   Meter counter total         : {Interlocked.Read(ref observed)}");
    Console.WriteLine($"   Meter histogram total       : {totalMs:F0} ms");
    Console.WriteLine();
    Console.WriteLine("   Activities:");
    foreach (string line in activities.Take(3))
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   Three mechanisms, three jobs:");
    Console.WriteLine();
    Console.WriteLine("     EventSource     structured events, read by dotnet-trace.");
    Console.WriteLine("                     Use for high-volume detail you want off by default.");
    Console.WriteLine("     Meter           counters and histograms, read by dotnet-counters");
    Console.WriteLine("                     and every metrics backend. Use for rates and");
    Console.WriteLine("                     distributions you always want.");
    Console.WriteLine("     ActivitySource  spans with timing and tags, read by OpenTelemetry.");
    Console.WriteLine("                     Use for following one request across services.");
    Console.WriteLine();
    Console.WriteLine("   All three are in the base class library. None needs a package, and");
    Console.WriteLine("   all three are what the tools already know how to read - which is");
    Console.WriteLine("   the reason to use them rather than logging.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 5. HARD — a health endpoint that answers the question.
// ---------------------------------------------------------------------------
static void Exercise5(Counters counters)
{
    Console.WriteLine("Exercise 5: what should a diagnostics endpoint report?");
    Console.WriteLine();

    counters.Sample();

    double heapMb = counters.Read("dotnet.gc.last_collection.heap.size") / 1024 / 1024;
    double workingSetMb = counters.Read("dotnet.process.memory.working_set") / 1024 / 1024;
    double queue = counters.Read("dotnet.thread_pool.queue.length");
    double threads = counters.Read("dotnet.thread_pool.thread.count");
    double pause = counters.Read("dotnet.gc.pause.time");
    double contentions = counters.Read("dotnet.monitor.lock_contentions");
    double allocatedMb = counters.Read("dotnet.gc.heap.total_allocated") / 1024 / 1024;

    Console.WriteLine("   {");
    Console.WriteLine($"     \"heapMb\":            {heapMb:F0},");
    Console.WriteLine($"     \"workingSetMb\":      {workingSetMb:F0},");
    Console.WriteLine($"     \"heapToWorkingSet\":  {(workingSetMb > 0 ? heapMb / workingSetMb : 0):F2},");
    Console.WriteLine($"     \"allocatedMbTotal\":  {allocatedMb:F0},");
    Console.WriteLine($"     \"gcPauseSeconds\":    {pause:F3},");
    Console.WriteLine($"     \"threadPoolQueue\":   {queue:F0},");
    Console.WriteLine($"     \"threadPoolThreads\": {threads:F0},");
    Console.WriteLine($"     \"lockContentions\":   {contentions:F0},");
    Console.WriteLine($"     \"serverGc\":          {System.Runtime.GCSettings.IsServerGC.ToString().ToLowerInvariant()},");
    Console.WriteLine($"     \"processors\":        {Environment.ProcessorCount}");
    Console.WriteLine("   }");
    Console.WriteLine();
    Console.WriteLine("   Why each field earns its place:");
    Console.WriteLine();
    Console.WriteLine("     heapMb + workingSetMb   The RATIO is the diagnosis. A low ratio");
    Console.WriteLine("                             means memory is held outside the managed");
    Console.WriteLine("                             heap: fragmentation, or native.");
    Console.WriteLine("     allocatedMbTotal        Cumulative. Two samples give a RATE, which");
    Console.WriteLine("                             is what you actually want.");
    Console.WriteLine("     threadPoolQueue         The starvation signal, and a LEVEL - which");
    Console.WriteLine("                             is why it must be exported continuously.");
    Console.WriteLine("     serverGc + processors   Every performance number is meaningless");
    Console.WriteLine("                             without them, and they are the two things");
    Console.WriteLine("                             nobody can guess from outside.");
    Console.WriteLine();
    Console.WriteLine("   What NOT to put here:");
    Console.WriteLine();
    Console.WriteLine("     - Anything requiring a collection. GC.GetTotalMemory(true) forces");
    Console.WriteLine("       one, so a monitor polling every 10 seconds would add a full");
    Console.WriteLine("       collection every 10 seconds. Use the counters, which are free.");
    Console.WriteLine("     - Anything that allocates much, since this runs under the load");
    Console.WriteLine("       you are trying to measure.");
    Console.WriteLine("     - Authentication-free access to it. This is a map of your");
    Console.WriteLine("       process for anyone who asks.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 6. HARD — the diagnosis when everything is flat.
// ---------------------------------------------------------------------------
static void Exercise6()
{
    Console.WriteLine("Exercise 6: p99 is 4 seconds and every counter is flat");
    Console.WriteLine();
    Console.WriteLine("   Given:");
    Console.WriteLine("     CPU/wall              0.05    (idle)");
    Console.WriteLine("     thread pool queue     0");
    Console.WriteLine("     GC pause              flat");
    Console.WriteLine("     lock contentions      flat");
    Console.WriteLine("     heap size             flat");
    Console.WriteLine("     working set           flat");
    Console.WriteLine();
    Console.WriteLine("   The finding IS the absence. Every runtime counter being flat rules");
    Console.WriteLine("   out all four in-process causes at once, which is a real result and");
    Console.WriteLine("   the fastest one available.");
    Console.WriteLine();
    Console.WriteLine("   The process is WAITING on something outside itself. Where to look,");
    Console.WriteLine("   in order:");
    Console.WriteLine();
    Console.WriteLine("   1. A DUMP, for what the threads are waiting on.");
    Console.WriteLine("        dotnet-dump collect --process-id 4821");
    Console.WriteLine("        > dumpasync");
    Console.WriteLine("      Hundreds of state machines parked at the same await is the");
    Console.WriteLine("      answer, and the await tells you which dependency.");
    Console.WriteLine();
    Console.WriteLine("   2. THE DEPENDENCY'S OWN LATENCY. A database, a downstream service,");
    Console.WriteLine("      a disk, a DNS lookup. Your counters cannot see any of them.");
    Console.WriteLine();
    Console.WriteLine("   3. CONNECTION POOL EXHAUSTION, which is the trap here. It looks");
    Console.WriteLine("      exactly like a slow dependency - requests waiting, CPU idle -");
    Console.WriteLine("      and it is caused by YOUR code holding connections too long.");
    Console.WriteLine("      Neither the runtime counters nor the database show it; the");
    Console.WriteLine("      connection pool's own metrics do.");
    Console.WriteLine();
    Console.WriteLine("   4. A LOCK HELD ACROSS AN AWAIT. Contentions stay flat because");
    Console.WriteLine("      SemaphoreSlim.WaitAsync does not register as monitor contention.");
    Console.WriteLine("      A dump shows the waiters.");
    Console.WriteLine();
    Console.WriteLine("   The general lesson: runtime counters diagnose the runtime. Most");
    Console.WriteLine("   production latency is not the runtime, and knowing that in thirty");
    Console.WriteLine("   seconds instead of three hours is what they are worth.");
}

// ---------------------------------------------------------------------------
[EventSource(Name = "Ledger-Payments")]
sealed class LedgerEvents : EventSource
{
    public static readonly LedgerEvents Log = new();

    [Event(1, Level = EventLevel.Informational)]
    public void PaymentSettled(long id, string currency, long amountMinor) =>
        WriteEvent(1, id, currency, amountMinor);
}

sealed class LedgerListener : EventListener
{
    private List<string>? _lines;
    private int _count;

    public int Count => _count;

    public IEnumerable<string> First(int n) => (_lines ?? new List<string>()).Take(n);

    protected override void OnEventSourceCreated(EventSource source)
    {
        if (source.Name == "Ledger-Payments")
        {
            EnableEvents(source, EventLevel.Verbose, EventKeywords.All);
        }
    }

    protected override void OnEventWritten(EventWrittenEventArgs eventData)
    {
        Interlocked.Increment(ref _count);
        _lines ??= new List<string>();

        lock (_lines)
        {
            if (_lines.Count < 5 && eventData.Payload is not null)
            {
                _lines.Add($"{eventData.EventName}: {string.Join(", ", eventData.Payload)}");
            }
        }
    }
}

sealed class Counters : IDisposable
{
    private readonly MeterListener _listener = new();
    private readonly Dictionary<string, double> _values = new();
    private readonly Dictionary<string, double> _staging = new();
    private bool _sampling;

    public Counters()
    {
        _listener.InstrumentPublished = (i, l) =>
        {
            if (i.Meter.Name.StartsWith("System.Runtime", StringComparison.Ordinal))
            {
                l.EnableMeasurementEvents(i);
            }
        };

        _listener.SetMeasurementEventCallback<long>((i, v, _, _) => Record(i.Name, v));
        _listener.SetMeasurementEventCallback<double>((i, v, _, _) => Record(i.Name, v));
        _listener.SetMeasurementEventCallback<int>((i, v, _, _) => Record(i.Name, v));
    }

    public void Start() => _listener.Start();

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

    public void Dispose() => _listener.Dispose();
}
