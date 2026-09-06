// 02-events-and-traces.cs — The runtime event stream that dotnet-trace records,
// subscribed to in-process so the events here are real.
//
// dotnet-trace attaches to the same EventSource providers over a diagnostic
// socket and writes them to a .nettrace file. An EventListener subscribes to
// them from inside. The provider names and keywords below are the ones you
// pass on the dotnet-trace command line.
//
// Run:  dotnet run 02-events-and-traces.cs -c Release
//
// NOTE THE #:property LINE. EventSource support is a TRIMMING FEATURE SWITCH
// and it defaults to FALSE for file-based apps. Without it OnEventSourceCreated
// is never called at all, and this file silently reports zero events - which is
// exactly what happened while writing it. Section 4 covers why that matters in
// production.
//
// EXACT vs RATIO: event names are deterministic. Counts depend on what the
// runtime chose to do.

#:property EventSourceSupport=true

using System.Diagnostics.Tracing;

Console.WriteLine("1. Subscribing to the runtime's own event stream");
Console.WriteLine();

using var listener = new RuntimeEventListener();

CauseSomeWork();
listener.Report();
WhatTheToolsDo();

// ---------------------------------------------------------------------------
static void CauseSomeWork()
{
    // Allocate enough to force collections of several generations.
    var survivors = new List<byte[]>();
    for (int i = 0; i < 300_000; i++)
    {
        var block = new byte[256];
        block[0] = (byte)i;

        if (i % 500 == 0)
        {
            survivors.Add(block);
        }
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    GC.KeepAlive(survivors);

    // Contend a lock, so contention events appear too.
    var gate = new object();
    long counter = 0;
    Parallel.For(0, Environment.ProcessorCount * 2, _ =>
    {
        for (int i = 0; i < 20_000; i++)
        {
            lock (gate)
            {
                counter++;
            }
        }
    });

    GC.KeepAlive(counter);
    Thread.Sleep(200);
}

// ---------------------------------------------------------------------------
static void WhatTheToolsDo()
{
    Console.WriteLine();
    Console.WriteLine("2. The same providers, from outside the process");
    Console.WriteLine();
    Console.WriteLine("   Everything above came from the SAME event sources dotnet-trace");
    Console.WriteLine("   records. The difference is where the subscriber lives.");
    Console.WriteLine();
    Console.WriteLine("   A ready-made profile, which is what you want most of the time:");
    Console.WriteLine();
    Console.WriteLine("     dotnet-trace collect --process-id 4821 --profile gc-verbose");
    Console.WriteLine("     dotnet-trace collect --process-id 4821 --profile cpu-sampling");
    Console.WriteLine();
    Console.WriteLine("   The same thing spelled out, so the mapping is visible:");
    Console.WriteLine();
    Console.WriteLine("     dotnet-trace collect --process-id 4821 \\");
    Console.WriteLine("       --providers Microsoft-Windows-DotNETRuntime:0x1:4");
    Console.WriteLine();
    Console.WriteLine("   The three parts after the provider name are:");
    Console.WriteLine();
    Console.WriteLine("     0x1   keywords - a bitmask selecting event categories.");
    Console.WriteLine("           0x1 is GC, 0x10 is JIT, 0x4000 is contention.");
    Console.WriteLine("     4     level - Informational. Verbose is 5.");
    Console.WriteLine();
    Console.WriteLine("   THE KEYWORD MASK IS THE PART THAT BITES. Ask for everything at");
    Console.WriteLine("   Verbose on a busy service and the trace writes hundreds of");
    Console.WriteLine("   megabytes a minute and measurably slows the process you are");
    Console.WriteLine("   trying to diagnose.");
    Console.WriteLine();
    Console.WriteLine("   Which profile to reach for:");
    Console.WriteLine();
    Console.WriteLine("     cpu-sampling   'where is the CPU going' - stacks, no allocation");
    Console.WriteLine("                    detail. Start here for high CPU.");
    Console.WriteLine("     gc-verbose     every allocation and collection. Start here for");
    Console.WriteLine("                    memory growth or GC pauses. Expensive.");
    Console.WriteLine("     gc-collect     collections only, not allocations. Much cheaper,");
    Console.WriteLine("                    and enough to see pause frequency and duration.");
    Console.WriteLine();
    Console.WriteLine("   Reading the file: PerfView or Visual Studio open .nettrace");
    Console.WriteLine("   directly. dotnet-trace convert --format speedscope produces a file");
    Console.WriteLine("   for speedscope.app, which needs no install.");
    Console.WriteLine();
    Console.WriteLine("3. When a trace is the wrong tool");
    Console.WriteLine();
    Console.WriteLine("   A trace tells you what HAPPENED over a window. It cannot tell you");
    Console.WriteLine("   what the process looks like RIGHT NOW - which is what you need for");
    Console.WriteLine("   a hang, a deadlock, or a leak whose cause is a live reference.");
    Console.WriteLine();
    Console.WriteLine("   For those, take a dump:");
    Console.WriteLine();
    Console.WriteLine("     dotnet-dump collect --process-id 4821 --output hang.dmp");
    Console.WriteLine("     dotnet-dump analyze hang.dmp");
    Console.WriteLine();
    Console.WriteLine("   And for memory specifically, a gcdump is far smaller than a full");
    Console.WriteLine("   dump and enough to answer 'what is on the heap and what roots it':");
    Console.WriteLine();
    Console.WriteLine("     dotnet-gcdump collect --process-id 4821 --output heap.gcdump");
    Console.WriteLine();
    Console.WriteLine("   The choice, stated as a rule:");
    Console.WriteLine();
    Console.WriteLine("     counters  - continuous, nearly free. Always on. Tells you WHICH");
    Console.WriteLine("                 of the standard problems you have.");
    Console.WriteLine("     trace     - a window of time, moderate cost. Tells you WHERE the");
    Console.WriteLine("                 time or the allocation went.");
    Console.WriteLine("     dump      - one instant, stops the process. Tells you WHAT the");
    Console.WriteLine("                 state is, which is the only way to see a hang.");
    Console.WriteLine();
    Console.WriteLine("   Work down that list. A dump taken before the counters have been");
    Console.WriteLine("   read is a large file nobody knows what to look for in.");
    Console.WriteLine();
    Console.WriteLine("4. The switch that silently turns all of this off");
    Console.WriteLine();
    Console.WriteLine("   This file carries #:property EventSourceSupport=true at the top.");
    Console.WriteLine("   Without it, OnEventSourceCreated is never called and the report");
    Console.WriteLine("   above reads zero events - with no error and no warning.");
    Console.WriteLine();
    Console.WriteLine("   EventSourceSupport is a TRIMMING FEATURE SWITCH. It defaults to");
    Console.WriteLine("   false for file-based apps, and it is commonly set to false in");
    Console.WriteLine("   trimmed and AOT-published containers to save size:");
    Console.WriteLine();
    Console.WriteLine("     <PublishTrimmed>true</PublishTrimmed>");
    Console.WriteLine("     <EventSourceSupport>false</EventSourceSupport>");
    Console.WriteLine();
    Console.WriteLine("   The consequence in production: your custom EventSource logging");
    Console.WriteLine("   compiles, runs, and emits nothing. dotnet-trace attaches happily");
    Console.WriteLine("   and records an empty file. Nothing fails - you simply have no");
    Console.WriteLine("   diagnostics on the one build where you need them.");
    Console.WriteLine();
    Console.WriteLine("   The related switches worth checking on a trimmed image:");
    Console.WriteLine();
    Console.WriteLine("     EventSourceSupport      - EventSource and dotnet-trace");
    Console.WriteLine("     MetricsSupport          - System.Diagnostics.Metrics and counters");
    Console.WriteLine("     UseSystemResourceKeys   - strips exception MESSAGE text");
    Console.WriteLine("     StackTraceSupport       - strips stack trace detail");
    Console.WriteLine();
    Console.WriteLine("   The last two are the cruellest: an exception in a trimmed build can");
    Console.WriteLine("   arrive with a resource key instead of a message and no usable");
    Console.WriteLine("   stack. Check these before you need them, not during an incident.");
}

// ---------------------------------------------------------------------------
// Subscribes to the runtime's EventSource providers. This is the same data
// dotnet-trace writes to a .nettrace file.
// ---------------------------------------------------------------------------
sealed class RuntimeEventListener : EventListener
{
    // The keyword bitmask, spelled out. These are the same values you pass to
    // dotnet-trace after the provider name.
    private const EventKeywords GCKeyword = (EventKeywords)0x1;
    private const EventKeywords ContentionKeyword = (EventKeywords)0x4000;

    private readonly Dictionary<string, int> _counts = new();
    private readonly List<string> _firstFewGcStarts = new();
    private int _totalEvents;

    protected override void OnEventSourceCreated(EventSource source)
    {
        if (source.Name == "Microsoft-Windows-DotNETRuntime")
        {
            EnableEvents(source, EventLevel.Informational, GCKeyword | ContentionKeyword);
        }
    }

    protected override void OnEventWritten(EventWrittenEventArgs eventData)
    {
        lock (_counts)
        {
            _totalEvents++;
            string name = eventData.EventName ?? "(unnamed)";
            _counts[name] = _counts.TryGetValue(name, out int existing) ? existing + 1 : 1;

            if (name == "GCStart_V2" && _firstFewGcStarts.Count < 5)
            {
                object? reason = Payload(eventData, "Reason");
                object? depth = Payload(eventData, "Depth");
                object? type = Payload(eventData, "Type");
                _firstFewGcStarts.Add($"gen {depth}, reason {reason}, type {type}");
            }
        }
    }

    public void Report()
    {
        lock (_counts)
        {
            Console.WriteLine($"   total runtime events captured : {_totalEvents:N0}");
            Console.WriteLine();
            Console.WriteLine("   event                                    count");
            Console.WriteLine("   -----                                    -----");

            foreach ((string name, int count) in _counts.OrderByDescending(kv => kv.Value).Take(12))
            {
                Console.WriteLine($"   {name,-38}  {count,8:N0}");
            }

            if (_firstFewGcStarts.Count > 0)
            {
                Console.WriteLine();
                Console.WriteLine("   the first few collections, decoded:");
                foreach (string line in _firstFewGcStarts)
                {
                    Console.WriteLine($"     {line}");
                }
            }

            Console.WriteLine();
            Console.WriteLine("   GCStart_V2 and GCEnd_V1 bracket every collection, and the");
            Console.WriteLine("   Depth payload is the generation. Subtracting the timestamps");
            Console.WriteLine("   gives the pause, which is what a GC profile is built from.");
            Console.WriteLine();
            Console.WriteLine("   ContentionStart and ContentionStop bracket a lock acquisition");
            Console.WriteLine("   that had to WAIT. An uncontended lock produces no events at");
            Console.WriteLine("   all, so this stream is specifically the expensive case.");
        }
    }

    private static object? Payload(EventWrittenEventArgs eventData, string name)
    {
        if (eventData.PayloadNames is null || eventData.Payload is null)
        {
            return null;
        }

        for (int i = 0; i < eventData.PayloadNames.Count; i++)
        {
            if (eventData.PayloadNames[i] == name)
            {
                return eventData.Payload[i];
            }
        }

        return null;
    }
}
