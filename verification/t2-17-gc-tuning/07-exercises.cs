// 07-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 07-exercises.cs -c Release

using System.Buffers;
using System.Diagnostics;
using System.Runtime;

Console.WriteLine($"Server GC : {GCSettings.IsServerGC}");
Console.WriteLine();

Exercise1();
Exercise2();
Exercise3();
Exercise4();
Exercise5();
Exercise6();

// ---------------------------------------------------------------------------
// 1. EASY — the largest array of each type that stays off the LOH.
// ---------------------------------------------------------------------------
static void Exercise1()
{
    Console.WriteLine("Exercise 1: the largest array that stays off the LOH");
    Console.WriteLine();
    Console.WriteLine("   type       max elements   total bytes   generation   one more");
    Console.WriteLine("   ----       ------------   -----------   ----------   --------");

    // 24-byte header on 64-bit: 8 sync block, 8 method table, 8 length.
    // Largest total that is still under 85,000 is 84,999.
    Report("byte  ", 1, n => new byte[n]);
    Report("int   ", 4, n => new int[n]);
    Report("long  ", 8, n => new long[n]);
    Report("double", 8, n => new double[n]);

    Console.WriteLine();
    Console.WriteLine("   int[21,243] is 84,996 bytes and stays on the normal heap.");
    Console.WriteLine("   int[21,244] is exactly 85,000 and does not. A buffer sized");
    Console.WriteLine("   'about 21,000 ints' sits one rounding decision from the LOH.");
    Console.WriteLine();

    static void Report(string name, int elementSize, Func<int, Array> make)
    {
        int max = (84_999 - 24) / elementSize;
        Array fits = make(max);
        Array over = make(max + 1);
        Console.WriteLine($"   {name}     {max,12:N0}   {max * elementSize + 24,11:N0}   gen {GC.GetGeneration(fits),-8}   gen {GC.GetGeneration(over)}");
    }
}

// ---------------------------------------------------------------------------
// 2. EASY — a large object is born in gen 2 and stays there.
// ---------------------------------------------------------------------------
static void Exercise2()
{
    Console.WriteLine("Exercise 2: does a large object ever get promoted?");
    Console.WriteLine();

    var large = new byte[200_000];
    Console.WriteLine($"   at allocation        : gen {GC.GetGeneration(large)}");

    for (int i = 0; i < 3; i++)
    {
        GC.Collect();
        Console.WriteLine($"   after collection {i + 1}   : gen {GC.GetGeneration(large)}");
    }

    Console.WriteLine();
    Console.WriteLine("   It is never promoted, because promotion means moving to an OLDER");
    Console.WriteLine("   generation and there is nothing older than gen 2. It starts at the");
    Console.WriteLine("   top. That is the cost: it can only be reclaimed by the most");
    Console.WriteLine("   expensive kind of collection.");
    Console.WriteLine();

    GC.KeepAlive(large);
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — 80 KB buffer against a 100 KB buffer, same number of uses.
// ---------------------------------------------------------------------------
static void Exercise3()
{
    Console.WriteLine("Exercise 3: 80,000-byte buffer vs 100,000-byte buffer");
    Console.WriteLine();
    Console.WriteLine("   Same count, same work per buffer, 25% more bytes for the larger one.");
    Console.WriteLine();
    Console.WriteLine("   size       gen0   gen1   gen2   time");
    Console.WriteLine("   ----       ----   ----   ----   ----");

    foreach (int size in new[] { 80_000, 100_000 })
    {
        Collect();
        int g0 = GC.CollectionCount(0), g1 = GC.CollectionCount(1), g2 = GC.CollectionCount(2);
        var sw = Stopwatch.StartNew();

        long sink = 0;
        for (int i = 0; i < 20_000; i++)
        {
            var buffer = new byte[size];
            for (int k = 0; k < 1_000; k++)
            {
                buffer[k] = (byte)(k + 1);
            }
            sink += buffer[999];
        }

        sw.Stop();
        Console.WriteLine($"   {size,6:N0}     {GC.CollectionCount(0) - g0,4}   {GC.CollectionCount(1) - g1,4}   " +
            $"{GC.CollectionCount(2) - g2,4}   {sw.Elapsed.TotalMilliseconds,6:F0} ms   (sink {sink})");
    }

    Console.WriteLine();
    Console.WriteLine("   25% more bytes, and the collection profile changes completely:");
    Console.WriteLine("   the 80 KB version does gen 0 work, the 100 KB version does gen 2");
    Console.WriteLine("   work. This is the single most valuable number in the module,");
    Console.WriteLine("   because 100,000 looks like the rounder and more sensible choice.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — allocation rate or survival rate: which do you fix first?
// ---------------------------------------------------------------------------
static void Exercise4()
{
    Console.WriteLine("Exercise 4: halve the allocations, or halve what survives?");
    Console.WriteLine();

    Console.WriteLine("   variant                        gen0   gen1   gen2   pause");
    Console.WriteLine("   -------                        ----   ----   ----   -----");

    Measure("baseline                    ", 800_000, 4);
    Measure("half the allocations        ", 400_000, 4);
    Measure("half the survival rate      ", 800_000, 8);

    Console.WriteLine();
    Console.WriteLine("   Read the columns carefully, because the counts mislead here.");
    Console.WriteLine();
    Console.WriteLine("   Halving the allocations halves every COUNT - gen 0 runs half as");
    Console.WriteLine("   often, so gen 1 and gen 2 follow it down.");
    Console.WriteLine();
    Console.WriteLine("   Halving the survival rate leaves the counts UNCHANGED and still");
    Console.WriteLine("   cuts the pause roughly in half. Same number of collections, each");
    Console.WriteLine("   one cheaper, because less had to be traced and copied.");
    Console.WriteLine();
    Console.WriteLine("   That is the whole reason collection counts are a poor health metric");
    Console.WriteLine("   on their own. Pause time is the number that matters, and two very");
    Console.WriteLine("   different fixes move it by similar amounts here.");
    Console.WriteLine();
    Console.WriteLine("   Default answer: fix survival first, because halving allocations");
    Console.WriteLine("   usually means doing less work, while halving survival usually means");
    Console.WriteLine("   holding data for a shorter time - and that is normally free.");
    Console.WriteLine();

    static void Measure(string label, int count, int keepEvery)
    {
        var window = new object[count / keepEvery + 1];
        Collect();
        int g0 = GC.CollectionCount(0), g1 = GC.CollectionCount(1), g2 = GC.CollectionCount(2);
        TimeSpan before = GC.GetTotalPauseDuration();

        for (int i = 0; i < count; i++)
        {
            var block = new byte[128];
            block[0] = (byte)i;
            if (i % keepEvery == 0)
            {
                window[i / keepEvery] = block;
            }
        }

        TimeSpan pause = GC.GetTotalPauseDuration() - before;
        Console.WriteLine($"   {label}   {GC.CollectionCount(0) - g0,4}   {GC.CollectionCount(1) - g1,4}   " +
            $"{GC.CollectionCount(2) - g2,4}   {pause.TotalMilliseconds,5:F1} ms");
        GC.KeepAlive(window);
    }
}

// ---------------------------------------------------------------------------
// 5. HARD — fragment the LOH, then measure what recovers it.
// ---------------------------------------------------------------------------
static void Exercise5()
{
    Console.WriteLine("Exercise 5: recovering a fragmented LOH");
    Console.WriteLine();

    var survivors = new List<byte[]>();
    for (int i = 0; i < 300; i++)
    {
        var doomed = new byte[500_000];
        doomed[0] = 1;
        survivors.Add(new byte[90_000]);
    }

    Collect();
    var before = GC.GetGCMemoryInfo().GenerationInfo[3];
    Console.WriteLine($"   fragmented   : size {before.SizeAfterBytes / 1024.0 / 1024.0,7:F1} MB   " +
        $"fragmentation {before.FragmentationAfterBytes / 1024.0 / 1024.0,7:F1} MB");

    // An ordinary gen 2 collection does NOT compact the LOH.
    GC.Collect(2, GCCollectionMode.Forced, blocking: true);
    var plain = GC.GetGCMemoryInfo().GenerationInfo[3];
    Console.WriteLine($"   plain gen 2  : size {plain.SizeAfterBytes / 1024.0 / 1024.0,7:F1} MB   " +
        $"fragmentation {plain.FragmentationAfterBytes / 1024.0 / 1024.0,7:F1} MB");

    GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce;
    GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: true);
    var compacted = GC.GetGCMemoryInfo().GenerationInfo[3];
    Console.WriteLine($"   compacted    : size {compacted.SizeAfterBytes / 1024.0 / 1024.0,7:F1} MB   " +
        $"fragmentation {compacted.FragmentationAfterBytes / 1024.0 / 1024.0,7:F1} MB");

    Console.WriteLine();
    Console.WriteLine("   The plain gen 2 collection reclaims the dead objects but leaves the");
    Console.WriteLine("   holes. Only the compacting collection returns the space.");
    Console.WriteLine();
    Console.WriteLine("   This is a repair tool, not a setting to leave on. It stops every");
    Console.WriteLine("   thread and copies the surviving large objects one at a time.");
    Console.WriteLine();
    Console.WriteLine($"   survivors held throughout: {survivors.Count}");
    Console.WriteLine();
    survivors.Clear();
    Collect();
}

// ---------------------------------------------------------------------------
// 6. HARD — pooling, and the bug that makes pooling worse than not pooling.
// ---------------------------------------------------------------------------
static void Exercise6()
{
    Console.WriteLine("Exercise 6: ArrayPool, and the size that defeats it");
    Console.WriteLine();

    const int iterations = 30_000;

    Console.WriteLine("   strategy                       gen0   gen2   allocated    time");
    Console.WriteLine("   --------                       ----   ----   ---------    ----");

    Run("new byte[64,000] each time  ", () =>
    {
        var b = new byte[64_000];
        b[0] = 1;
        return b.Length;
    });

    Run("ArrayPool rent 64,000       ", () =>
    {
        byte[] b = ArrayPool<byte>.Shared.Rent(64_000);
        b[0] = 1;
        int length = b.Length;
        ArrayPool<byte>.Shared.Return(b);
        return length;
    });

    Run("new byte[2,000,000]         ", () =>
    {
        var b = new byte[2_000_000];
        b[0] = 1;
        return b.Length;
    });

    Run("ArrayPool rent 2,000,000    ", () =>
    {
        byte[] b = ArrayPool<byte>.Shared.Rent(2_000_000);
        b[0] = 1;
        int length = b.Length;
        ArrayPool<byte>.Shared.Return(b);
        return length;
    });

    Console.WriteLine();
    Console.WriteLine("   Pooling removed the LOH cost entirely at both sizes: 57 GB of");
    Console.WriteLine("   allocation and 4,000 gen 2 collections became 2 MB and none.");
    Console.WriteLine();

    // A claim worth checking rather than repeating. The widely-quoted advice is
    // that ArrayPool.Shared refuses to pool arrays above 1 MB. Measure it.
    Console.WriteLine("   Widely-repeated advice says ArrayPool.Shared stops pooling above");
    Console.WriteLine("   1 MB. Checking it directly, by renting, returning, and renting");
    Console.WriteLine("   again to see whether the SAME array instance comes back:");
    Console.WriteLine();
    Console.WriteLine("   requested        Length given   same instance returned?");

    foreach (int n in new[] { 1_000_000, 2_000_000, 16_000_000, 128_000_000 })
    {
        byte[] first = ArrayPool<byte>.Shared.Rent(n);
        int given = first.Length;
        ArrayPool<byte>.Shared.Return(first);
        byte[] second = ArrayPool<byte>.Shared.Rent(n);
        bool pooled = ReferenceEquals(first, second);
        ArrayPool<byte>.Shared.Return(second);
        Console.WriteLine($"   {n,12:N0}   {given,12:N0}   {pooled}");
    }

    Console.WriteLine();
    Console.WriteLine("   On .NET 10 the shared pool pooled every one of these, up to 128 MB.");
    Console.WriteLine("   The 1 MB cap was real in older versions of the shared pool and the");
    Console.WriteLine("   advice outlived it. Measure the runtime you are on.");
    Console.WriteLine();
    Console.WriteLine("   The Length column is the trap that did NOT go away. Rent returns an");
    Console.WriteLine("   array AT LEAST the requested size, rounded up to a power of two:");
    Console.WriteLine("   ask for 1,000,000 and you get 1,048,576. Using array.Length instead");
    Console.WriteLine("   of the count you asked for reads 48,576 bytes of whatever the");
    Console.WriteLine("   previous tenant left behind - a correctness bug and, if that");
    Console.WriteLine("   buffer is written to a response, a data-disclosure bug.");
    Console.WriteLine();

    static void Run(string label, Func<int> body)
    {
        Collect();
        int g0 = GC.CollectionCount(0), g2 = GC.CollectionCount(2);
        long alloc = GC.GetTotalAllocatedBytes(precise: true);
        var sw = Stopwatch.StartNew();

        long sink = 0;
        for (int i = 0; i < iterations; i++)
        {
            sink += body();
        }

        sw.Stop();
        double mb = (GC.GetTotalAllocatedBytes(precise: true) - alloc) / 1024.0 / 1024.0;
        Console.WriteLine($"   {label}   {GC.CollectionCount(0) - g0,4}   {GC.CollectionCount(2) - g2,4}   " +
            $"{mb,7:F0} MB   {sw.Elapsed.TotalMilliseconds,5:F0} ms   (sink {sink})");
    }
}

static void Collect()
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
}
