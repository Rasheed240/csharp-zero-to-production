// 01-counters.cs — The runtime metrics dotnet-counters reads, read from inside
// the process so the output here is real rather than illustrative.
//
// dotnet-counters is a global tool and is not installed in this folder. It
// subscribes to exactly these instruments over a diagnostic socket; a
// MeterListener subscribes to them in-process. The names below are the names
// the tool prints.
//
// Run:  dotnet run 01-counters.cs -c Release
//
// EXACT vs RATIO: the instrument names and the DIRECTION of each change are the
// claims. Absolute values depend on the machine.

using System.Diagnostics.Metrics;

Console.WriteLine("1. What the runtime publishes");
Console.WriteLine();

using var listener = new RuntimeCounters();
listener.Start();

ShowBaseline(listener);
ShowUnderAllocation(listener);
ShowUnderThreadPoolLoad(listener);
ShowUnderLockContention(listener);
Interpretation();

// ---------------------------------------------------------------------------
static void ShowBaseline(RuntimeCounters counters)
{
    counters.Sample();

    Console.WriteLine("   instrument                                      value");
    Console.WriteLine("   ----------                                      -----");

    foreach ((string name, double value) in counters.Snapshot())
    {
        Console.WriteLine($"   {name,-46}  {value,12:N0}");
    }

    Console.WriteLine();
    Console.WriteLine("   Those are the instruments dotnet-counters shows under");
    Console.WriteLine("   'System.Runtime'. On .NET 9 and later they are published through");
    Console.WriteLine("   System.Diagnostics.Metrics rather than the older EventCounters,");
    Console.WriteLine("   which is why a MeterListener can read them here.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void ShowUnderAllocation(RuntimeCounters counters)
{
    Console.WriteLine("2. What allocation pressure looks like");
    Console.WriteLine();

    double allocBefore = counters.Read("dotnet.gc.heap.total_allocated");
    double gcBefore = counters.Read("dotnet.gc.collections");
    double pauseBefore = counters.Read("dotnet.gc.pause.time");

    // Allocate hard, keeping a rolling window alive so objects are promoted.
    var window = new object[50_000];
    for (int i = 0; i < 2_000_000; i++)
    {
        var block = new byte[128];
        block[0] = (byte)i;
        if (i % 40 == 0)
        {
            window[i / 40 % window.Length] = block;
        }
    }

    // last_collection.heap.size only updates AFTER a collection, so force one
    // while the window is still reachable. Sampling without this reports 0 and
    // makes the comparison below meaningless - which the first version did.
    GC.Collect();
    GC.KeepAlive(window);
    counters.Sample();

    double allocated = counters.Read("dotnet.gc.heap.total_allocated") - allocBefore;
    double collections = counters.Read("dotnet.gc.collections") - gcBefore;
    double pause = counters.Read("dotnet.gc.pause.time") - pauseBefore;

    Console.WriteLine($"   allocated during the burst  : {allocated / 1024 / 1024,10:N0} MB");
    Console.WriteLine($"   collections                 : {collections,10:N0}");
    Console.WriteLine($"   GC pause time added         : {pause,10:F3} s");
    Console.WriteLine($"   heap size after             : {counters.Read("dotnet.gc.last_collection.heap.size") / 1024 / 1024,10:N0} MB");
    Console.WriteLine();
    Console.WriteLine("   The two numbers to compare are ALLOCATED and HEAP SIZE. Hundreds");
    Console.WriteLine("   of megabytes allocated with a small heap is healthy - objects are");
    Console.WriteLine("   dying young, which is the cheap case.");
    Console.WriteLine();
    Console.WriteLine("   A heap that grows while allocation is steady is the leak signature.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void ShowUnderThreadPoolLoad(RuntimeCounters counters)
{
    Console.WriteLine("3. What thread-pool starvation looks like");
    Console.WriteLine();

    counters.Sample();
    Console.WriteLine($"   before: threads {counters.Read("dotnet.thread_pool.thread.count"),4:N0}, " +
        $"queue {counters.Read("dotnet.thread_pool.queue.length"),4:N0}");

    // Block pool threads on purpose - the sync-over-async mistake.
    int blocked = Environment.ProcessorCount * 4;
    var started = new CountdownEvent(blocked);
    var release = new ManualResetEventSlim(false);

    for (int i = 0; i < blocked; i++)
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            started.Signal();
            release.Wait();
        });
    }

    // Queue more work behind them, which now cannot run.
    for (int i = 0; i < 200; i++)
    {
        ThreadPool.QueueUserWorkItem(_ => Thread.SpinWait(1_000));
    }

    Thread.Sleep(300);
    counters.Sample();

    double threads = counters.Read("dotnet.thread_pool.thread.count");
    double queue = counters.Read("dotnet.thread_pool.queue.length");

    Console.WriteLine($"   during: threads {threads,4:N0}, queue {queue,4:N0}");

    release.Set();
    Thread.Sleep(300);
    counters.Sample();

    Console.WriteLine($"   after : threads {counters.Read("dotnet.thread_pool.thread.count"),4:N0}, " +
        $"queue {counters.Read("dotnet.thread_pool.queue.length"),4:N0}");
    Console.WriteLine();
    Console.WriteLine("   A QUEUE LENGTH THAT STAYS ABOVE ZERO is the starvation signature.");
    Console.WriteLine("   Work is waiting for a thread, not for the CPU - so CPU usage looks");
    Console.WriteLine("   low and latency climbs, which is the combination that sends people");
    Console.WriteLine("   to profile the wrong thing.");
    Console.WriteLine();
    Console.WriteLine("   Thread count climbing slowly alongside it is the pool injecting");
    Console.WriteLine("   new threads, roughly one or two a second. That injection rate is");
    Console.WriteLine("   why a burst of blocking produces a latency cliff rather than a");
    Console.WriteLine("   gentle degradation.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void ShowUnderLockContention(RuntimeCounters counters)
{
    Console.WriteLine("4. What lock contention looks like");
    Console.WriteLine();

    double before = counters.Read("dotnet.monitor.lock_contentions");

    var gate = new object();
    long counter = 0;

    Parallel.For(0, Environment.ProcessorCount * 2, _ =>
    {
        for (int i = 0; i < 100_000; i++)
        {
            lock (gate)
            {
                counter++;
            }
        }
    });

    counters.Sample();
    double contentions = counters.Read("dotnet.monitor.lock_contentions") - before;

    Console.WriteLine($"   contended lock acquisitions : {contentions,10:N0}");
    Console.WriteLine($"   (counter reached {counter:N0})");
    Console.WriteLine();
    Console.WriteLine("   dotnet.monitor.lock_contentions counts acquisitions that had to");
    Console.WriteLine("   WAIT. An uncontended lock is a few nanoseconds and does not appear");
    Console.WriteLine("   here at all, so a rising count is specifically the expensive kind.");
    Console.WriteLine();
    Console.WriteLine("   High contention with low CPU means threads are waiting rather than");
    Console.WriteLine("   working. It is the third distinct cause of 'latency up, CPU flat',");
    Console.WriteLine("   after thread-pool starvation and GC pauses - and the counters tell");
    Console.WriteLine("   them apart in seconds.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Interpretation()
{
    Console.WriteLine("5. Reading the counters together");
    Console.WriteLine();
    Console.WriteLine("   No single counter diagnoses anything. The COMBINATION does:");
    Console.WriteLine();
    Console.WriteLine("   symptom: latency up, CPU flat");
    Console.WriteLine("     queue length > 0, threads climbing  -> thread-pool starvation");
    Console.WriteLine("     pause time rising                   -> GC");
    Console.WriteLine("     lock contentions rising             -> a hot lock");
    Console.WriteLine("     all three flat                      -> waiting on something");
    Console.WriteLine("                                            external, not on you");
    Console.WriteLine();
    Console.WriteLine("   symptom: memory climbing");
    Console.WriteLine("     heap size climbing                  -> a managed leak");
    Console.WriteLine("     heap flat, working set climbing     -> fragmentation, or native");
    Console.WriteLine("     allocated climbing, heap flat       -> healthy; objects die young");
    Console.WriteLine();
    Console.WriteLine("   symptom: CPU pinned, no throughput");
    Console.WriteLine("     allocation rate near zero           -> a spin loop");
    Console.WriteLine("     allocation rate high                -> genuinely busy");
    Console.WriteLine();
    Console.WriteLine("   The last line of each group is the one worth internalising: a");
    Console.WriteLine("   counter that is FLAT is evidence too, and it is what rules out the");
    Console.WriteLine("   explanations you would otherwise spend a day on.");
}

// ---------------------------------------------------------------------------
// Subscribes to the runtime's own meters. This is what dotnet-counters does
// over a diagnostic socket; doing it in-process makes the output real here.
// ---------------------------------------------------------------------------
sealed class RuntimeCounters : IDisposable
{
    private readonly MeterListener _listener = new();
    private readonly Dictionary<string, double> _values = new();
    private readonly Dictionary<string, double> _staging = new();
    private bool _sampling;

    public RuntimeCounters()
    {
        _listener.InstrumentPublished = (instrument, listener) =>
        {
            if (instrument.Meter.Name.StartsWith("System.Runtime", StringComparison.Ordinal))
            {
                listener.EnableMeasurementEvents(instrument);
            }
        };

        _listener.SetMeasurementEventCallback<long>((instrument, value, _, _) => Record(instrument.Name, value));
        _listener.SetMeasurementEventCallback<double>((instrument, value, _, _) => Record(instrument.Name, value));
        _listener.SetMeasurementEventCallback<int>((instrument, value, _, _) => Record(instrument.Name, value));
    }

    public void Start() => _listener.Start();

    // Observable instruments are pull-based: nothing is published until
    // something asks. dotnet-counters asks on its refresh interval.
    //
    // The staging dictionary matters. Several runtime instruments are TAGGED -
    // heap size reports once per generation, with a gc.heap.generation tag - so
    // one pull produces several measurements for the same instrument name.
    // Overwriting on each callback keeps only the last tag and reported 0 for
    // heap size, which is the bug the first version of this file had. Summing
    // across tags within one pull is the correct reading for a size.
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

    public IEnumerable<(string Name, double Value)> Snapshot()
    {
        lock (_values)
        {
            return _values.OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .Select(kv => (kv.Key, kv.Value))
                .ToList();
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
