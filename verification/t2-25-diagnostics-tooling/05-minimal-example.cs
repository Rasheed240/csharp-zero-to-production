// 05-minimal-example.cs — The same symptom, two causes, told apart by one
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

Measure(counters, "allocation pressure", () =>
{
    var window = new byte[40_000][];
    for (int i = 0; i < 1_200_000; i++)
    {
        var block = new byte[192];
        block[0] = (byte)i;
        window[i % window.Length] = block;
    }

    GC.KeepAlive(window);
});

Measure(counters, "blocked thread pool", () =>
{
    var release = new ManualResetEventSlim(false);
    for (int i = 0; i < Environment.ProcessorCount * 4; i++)
    {
        ThreadPool.QueueUserWorkItem(_ => release.Wait());
    }

    for (int i = 0; i < 400; i++)
    {
        ThreadPool.QueueUserWorkItem(_ => Thread.SpinWait(500));
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

    var sampler = new Thread(() =>
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
        $"{(sw.Elapsed.TotalSeconds > 0 ? cpu / sw.Elapsed.TotalSeconds : 0),8:F2}");
}

// Reads the same instruments dotnet-counters reads, from inside the process.
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

    public void Dispose() => _listener.Dispose();
}
