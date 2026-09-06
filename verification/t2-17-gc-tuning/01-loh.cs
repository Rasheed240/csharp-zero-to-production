// 01-loh.cs — The Large Object Heap: the threshold, where large objects are born,
// and what fragmentation costs.
//
// Run:  dotnet run 01-loh.cs -c Release
//
// EXACT vs RATIO: the threshold boundary and the generation numbers are exact and
// reproducible on any 64-bit runtime. Byte counts for fragmentation are exact for
// this run; the RATIO between fragmented and compacted is the stable claim.

using System.Runtime;

Console.WriteLine($"Server GC : {GCSettings.IsServerGC}");
Console.WriteLine($"64-bit    : {Environment.Is64BitProcess}");
Console.WriteLine();

Threshold();
BornInGen2();
Fragmentation();
CostOfChurn();

// ---------------------------------------------------------------------------
// 1. Where exactly the line is.
// ---------------------------------------------------------------------------
static void Threshold()
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
}

// ---------------------------------------------------------------------------
// 2. Large objects are BORN in gen 2. They are never promoted, because they
//    start at the top.
// ---------------------------------------------------------------------------
static void BornInGen2()
{
    Console.WriteLine("2. Large objects are allocated directly into gen 2");
    Console.WriteLine();

    var small = new byte[1_000];
    var large = new byte[100_000];

    Console.WriteLine($"   fresh byte[1,000]   : gen {GC.GetGeneration(small)}");
    Console.WriteLine($"   fresh byte[100,000] : gen {GC.GetGeneration(large)}");
    Console.WriteLine();
    Console.WriteLine("   Consequence: a large object is only ever reclaimed by a gen 2");
    Console.WriteLine("   collection, the most expensive kind. A short-lived 100 KB buffer");
    Console.WriteLine("   does not get the cheap gen 0 treatment a 1 KB buffer gets.");
    Console.WriteLine();

    GC.KeepAlive(small);
    GC.KeepAlive(large);
}

// ---------------------------------------------------------------------------
// 3. The LOH is swept but not compacted by default. Holes stay holes.
// ---------------------------------------------------------------------------
static void Fragmentation()
{
    Console.WriteLine("3. Fragmentation: the LOH is not compacted by default");
    Console.WriteLine();

    // Allocate in pairs and keep only one of each pair. Every dropped array
    // leaves a ~100 KB hole between two survivors.
    var survivors = new List<byte[]>(400);
    for (int i = 0; i < 400; i++)
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
    Console.WriteLine();

    // Opt in to a single compacting collection.
    GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce;
    GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: true);

    var after = GC.GetGCMemoryInfo().GenerationInfo[3];
    Console.WriteLine("   after LargeObjectHeapCompactionMode.CompactOnce");
    Console.WriteLine($"     LOH size          : {after.SizeAfterBytes:N0} bytes");
    Console.WriteLine($"     LOH fragmentation : {after.FragmentationAfterBytes:N0} bytes");
    Console.WriteLine();

    double ratio = before.FragmentationAfterBytes / (double)Math.Max(after.FragmentationAfterBytes, 1);
    Console.WriteLine($"   fragmentation fell {ratio:N0}x; heap shrank by " +
        $"{(before.SizeAfterBytes - after.SizeAfterBytes) / 1024.0 / 1024.0:F1} MB");
    Console.WriteLine();
    Console.WriteLine("   Note the setting is CompactOnce. It resets itself after one");
    Console.WriteLine("   collection. There is no permanent compact-the-LOH mode, because");
    Console.WriteLine("   compacting the LOH means copying megabytes while threads are stopped.");
    Console.WriteLine();

    Console.WriteLine($"   survivors still alive: {survivors.Count}");
    Console.WriteLine();
    survivors.Clear();
    Collect();
}

// ---------------------------------------------------------------------------
// 4. What repeated large allocation costs, and what reuse saves.
// ---------------------------------------------------------------------------
static void CostOfChurn()
{
    Console.WriteLine("4. Churning large buffers vs reusing one");
    Console.WriteLine();

    const int iterations = 4_000;
    const int size = 200_000;

    Collect();
    long g2Before = GC.CollectionCount(2);
    long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    var sw = System.Diagnostics.Stopwatch.StartNew();

    long sink = 0;
    for (int i = 0; i < iterations; i++)
    {
        var buffer = new byte[size];
        Touch(buffer, i);
        sink += buffer[0];
    }

    sw.Stop();
    double churnMs = sw.Elapsed.TotalMilliseconds;
    long churnG2 = GC.CollectionCount(2) - g2Before;
    long churnAlloc = GC.GetTotalAllocatedBytes(precise: true) - allocBefore;

    Collect();
    g2Before = GC.CollectionCount(2);
    allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    sw.Restart();

    var reused = new byte[size];
    for (int i = 0; i < iterations; i++)
    {
        Touch(reused, i);
        sink += reused[0];
    }

    sw.Stop();
    double reuseMs = sw.Elapsed.TotalMilliseconds;
    long reuseG2 = GC.CollectionCount(2) - g2Before;
    long reuseAlloc = GC.GetTotalAllocatedBytes(precise: true) - allocBefore;

    Console.WriteLine($"   {iterations:N0} iterations of a {size:N0}-byte buffer");
    Console.WriteLine();
    Console.WriteLine("   strategy        time      gen2 collections   allocated");
    Console.WriteLine($"   new each time   {churnMs,7:F1} ms   {churnG2,10}         {churnAlloc / 1024.0 / 1024.0,8:F1} MB");
    Console.WriteLine($"   reuse one       {reuseMs,7:F1} ms   {reuseG2,10}         {reuseAlloc / 1024.0 / 1024.0,8:F1} MB");
    Console.WriteLine();
    Console.WriteLine($"   reuse is {churnMs / reuseMs:F1}x faster and caused " +
        $"{churnG2 - reuseG2} fewer gen 2 collections");
    Console.WriteLine();
    Console.WriteLine("   Every one of those gen 2 collections walked the ENTIRE heap,");
    Console.WriteLine("   because that is the only kind of collection that reclaims the LOH.");
    Console.WriteLine();
    Console.WriteLine($"   (sink {sink}, printed so the loops cannot be optimised away)");
}

static void Touch(byte[] buffer, int i)
{
    // Identical work in both loops, so the measured difference is allocation
    // and collection rather than an empty loop against a full one.
    for (int k = 0; k < 1_000; k++)
    {
        buffer[k] = (byte)(i + k);
    }
}

static void Collect()
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
}
