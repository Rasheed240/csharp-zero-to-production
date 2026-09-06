// 03-production.cs — Three Ledger incidents with the same symptom, diagnosed
// from counters alone.
//
// The symptom every time: "p99 latency is up, CPU is not". Three different
// causes, three different fixes, and the counters tell them apart in seconds.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: the SIGNATURE - which counters move and which stay flat - is
// the claim. Absolute values depend on the machine.

using System.Diagnostics.Metrics;

Console.WriteLine("Three incidents, one symptom: p99 up, CPU flat.");
Console.WriteLine();

using var counters = new RuntimeCounters();
counters.Start();

var baseline = Capture(counters, "idle baseline        ", () => Thread.Sleep(200));
var incidentA = Capture(counters, "A: allocation        ", AllocationPressure);
var incidentB = Capture(counters, "B: blocked pool      ", BlockedThreadPool);
var incidentC = Capture(counters, "C: lock contention   ", LockContention);

Report(baseline, incidentA, incidentB, incidentC);
Diagnose();

// ---------------------------------------------------------------------------
// A. A cache with a 30-second lifetime: everything is promoted, then collected.
// ---------------------------------------------------------------------------
static void AllocationPressure()
{
    var cache = new Dictionary<int, byte[]>();

    for (int i = 0; i < 1_500_000; i++)
    {
        var entry = new byte[192];
        entry[0] = (byte)i;

        // A rolling window: long enough to be promoted, short enough to die.
        cache[i % 60_000] = entry;
    }

    GC.KeepAlive(cache);
}

// ---------------------------------------------------------------------------
// B. Sync-over-async: pool threads blocked, work queued behind them.
// ---------------------------------------------------------------------------
static void BlockedThreadPool()
{
    int blocked = Environment.ProcessorCount * 4;
    var release = new ManualResetEventSlim(false);

    for (int i = 0; i < blocked; i++)
    {
        ThreadPool.QueueUserWorkItem(_ => release.Wait());
    }

    for (int i = 0; i < 400; i++)
    {
        ThreadPool.QueueUserWorkItem(_ => Thread.SpinWait(500));
    }

    Thread.Sleep(250);
    release.Set();
    Thread.Sleep(100);
}

// ---------------------------------------------------------------------------
// C. One lock around a hot path.
// ---------------------------------------------------------------------------
static void LockContention()
{
    var gate = new object();
    long counter = 0;

    Parallel.For(0, Environment.ProcessorCount * 3, _ =>
    {
        for (int i = 0; i < 120_000; i++)
        {
            lock (gate)
            {
                counter++;
            }
        }
    });

    GC.KeepAlive(counter);
}

// ---------------------------------------------------------------------------
static Reading Capture(RuntimeCounters counters, string label, Action work)
{
    counters.Sample();
    double allocBefore = counters.Read("dotnet.gc.heap.total_allocated");
    double pauseBefore = counters.Read("dotnet.gc.pause.time");
    double contentionBefore = counters.Read("dotnet.monitor.lock_contentions");
    double cpuBefore = counters.Read("dotnet.process.cpu.time");

    var sw = System.Diagnostics.Stopwatch.StartNew();

    // Sample the queue while the work runs, because it is a level rather than
    // a total - it is zero again by the time the work finishes.
    double peakQueue = 0;
    double peakThreads = 0;
    using var stop = new CancellationTokenSource();

    var sampler = new Thread(() =>
    {
        while (!stop.IsCancellationRequested)
        {
            counters.Sample();
            peakQueue = Math.Max(peakQueue, counters.Read("dotnet.thread_pool.queue.length"));
            peakThreads = Math.Max(peakThreads, counters.Read("dotnet.thread_pool.thread.count"));
            Thread.Sleep(10);
        }
    })
    {
        IsBackground = true
    };

    sampler.Start();
    work();
    sw.Stop();
    stop.Cancel();
    sampler.Join();

    counters.Sample();

    return new Reading(
        label,
        (counters.Read("dotnet.gc.heap.total_allocated") - allocBefore) / 1024 / 1024,
        counters.Read("dotnet.gc.pause.time") - pauseBefore,
        counters.Read("dotnet.monitor.lock_contentions") - contentionBefore,
        peakQueue,
        peakThreads,
        counters.Read("dotnet.process.cpu.time") - cpuBefore,
        sw.Elapsed.TotalSeconds);
}

// ---------------------------------------------------------------------------
static void Report(params Reading[] readings)
{
    Console.WriteLine("   scenario               alloc MB   GC pause s   contentions   peak queue   peak thr   CPU/wall");
    Console.WriteLine("   --------               --------   ----------   -----------   ----------   --------   --------");

    foreach (Reading r in readings)
    {
        double ratio = r.WallSeconds > 0 ? r.CpuSeconds / r.WallSeconds : 0;
        Console.WriteLine($"   {r.Label}  {r.AllocatedMb,8:N0}   {r.PauseSeconds,10:F3}   {r.Contentions,11:N0}   " +
            $"{r.PeakQueue,10:N0}   {r.PeakThreads,8:N0}   {ratio,8:F2}");
    }

    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Diagnose()
{
    Console.WriteLine("   Each incident moves a DIFFERENT counter, and leaves the others");
    Console.WriteLine("   near the baseline. That is what makes the diagnosis fast.");
    Console.WriteLine();
    Console.WriteLine("   A - ALLOCATION PRESSURE");
    Console.WriteLine("     alloc MB high, GC pause high, everything else flat.");
    Console.WriteLine("     Next step  : dotnet-gcdump, sort by size, find the type.");
    Console.WriteLine("     Ledger fix : the response cache held entries for 30 seconds,");
    Console.WriteLine("                  which guarantees promotion. Shortening the window");
    Console.WriteLine("                  below the gen 0 budget removed the promotion.");
    Console.WriteLine();
    Console.WriteLine("   B - THREAD-POOL STARVATION");
    Console.WriteLine("     queue length high, CPU/wall LOW, allocation and pauses flat.");
    Console.WriteLine("     Next step  : dotnet-dump, then dumpasync, to see what the");
    Console.WriteLine("                  blocked threads are waiting on.");
    Console.WriteLine("     Ledger fix : a .Result on a HttpClient call inside a handler.");
    Console.WriteLine();
    Console.WriteLine("   C - LOCK CONTENTION");
    Console.WriteLine("     contentions high, allocation and pauses flat, CPU/wall high");
    Console.WriteLine("     because the waiting threads spin before they block.");
    Console.WriteLine("     Next step  : dotnet-trace with the contention keyword (0x4000),");
    Console.WriteLine("                  which gives you the stacks doing the waiting.");
    Console.WriteLine("     Ledger fix : a lock held across a remote call. Moving the call");
    Console.WriteLine("                  outside the lock removed the contention entirely.");
    Console.WriteLine();
    Console.WriteLine("   THE ONE THAT IS NOT ON THIS TABLE");
    Console.WriteLine();
    Console.WriteLine("     All four counters flat and latency still up means the process is");
    Console.WriteLine("     waiting on something OUTSIDE it - a database, a downstream");
    Console.WriteLine("     service, a disk. No runtime counter will show it, and that");
    Console.WriteLine("     absence is the finding.");
    Console.WriteLine();
    Console.WriteLine("     This is the most common real answer and the one people reach");
    Console.WriteLine("     last, because there is nothing to look at. Check it FIRST by");
    Console.WriteLine("     confirming the counters are flat, then go and look at the");
    Console.WriteLine("     dependency's own latency.");
    Console.WriteLine();
    Console.WriteLine("   WHY CPU/WALL IS THE MOST USEFUL COLUMN");
    Console.WriteLine();
    Console.WriteLine("     It is CPU seconds consumed per second of wall clock, so it says");
    Console.WriteLine("     how many cores the process is actually using. Latency up with");
    Console.WriteLine("     this LOW means waiting - for threads, for locks, or for");
    Console.WriteLine("     something external. Latency up with this HIGH means working,");
    Console.WriteLine("     and the question becomes what it is working on.");
    Console.WriteLine();
    Console.WriteLine("     That single ratio splits the problem space in half before you");
    Console.WriteLine("     have opened a profiler.");
}

// ---------------------------------------------------------------------------
readonly record struct Reading(
    string Label,
    double AllocatedMb,
    double PauseSeconds,
    double Contentions,
    double PeakQueue,
    double PeakThreads,
    double CpuSeconds,
    double WallSeconds);

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

        _listener.SetMeasurementEventCallback<long>((i, v, _, _) => Record(i.Name, v));
        _listener.SetMeasurementEventCallback<double>((i, v, _, _) => Record(i.Name, v));
        _listener.SetMeasurementEventCallback<int>((i, v, _, _) => Record(i.Name, v));
    }

    public void Start() => _listener.Start();

    // Several instruments are tagged - heap size reports once per generation -
    // so one pull produces several measurements per name. Summing within a
    // pull is the correct reading; overwriting keeps only the last tag.
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
