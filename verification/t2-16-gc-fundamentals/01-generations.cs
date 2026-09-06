// 01-generations.cs — what the GC actually does, observed rather than described:
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
        Console.WriteLine("    dotnet-counters monitor --process-id <pid> System.Runtime");
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
            var survivors = new List<byte[]>(Objects);
            for (var i = 0; i < Objects; i++) survivors.Add(new byte[256]);
            _keepAlive = survivors;
        }
        else
        {
            byte[]? last = null;
            for (var i = 0; i < Objects; i++) last = new byte[256];
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
        var live = new List<byte[]>(200_000);
        for (var i = 0; i < 200_000; i++) live.Add(new byte[256]);
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        var sw = Stopwatch.StartNew();
        for (var i = 0; i < 20; i++) GC.Collect(0, GCCollectionMode.Forced, blocking: true);
        var gen0 = sw.Elapsed.TotalMilliseconds / 20;

        sw = Stopwatch.StartNew();
        for (var i = 0; i < 20; i++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var gen2 = sw.Elapsed.TotalMilliseconds / 20;

        GC.KeepAlive(live);
        return (gen0, gen2);
    }
}
