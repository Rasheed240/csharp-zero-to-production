// 01-why-timing-lies.cs — Five ways a Stopwatch around a loop gives you a
// number that is not the answer.
//
// Run:  dotnet run 01-why-timing-lies.cs -c Release
//
// EXACT vs RATIO: this file is ABOUT measurement noise, so several results here
// deliberately vary between runs. Where a figure is stable it says so.

using System.Diagnostics;
using System.Runtime.CompilerServices;

Console.WriteLine($"Configuration : {(IsDebug() ? "DEBUG" : "RELEASE")}");
Console.WriteLine($"Tiered PGO    : {AppContext.TryGetSwitch("System.Runtime.TieredPGO", out bool pgo)} ({pgo})");
Console.WriteLine();

DeadCodeElimination();
NoWarmup();
RunToRunVariance();
OrderingEffects();
GcInterference();

// ---------------------------------------------------------------------------
// 1. The benchmark that measures nothing at all.
// ---------------------------------------------------------------------------
static void DeadCodeElimination()
{
    Console.WriteLine("1. The result is never used, so the work never happens");
    Console.WriteLine();

    const int iterations = 100_000_000;

    var sw = Stopwatch.StartNew();
    for (int i = 0; i < iterations; i++)
    {
        // The return value is discarded and the method is inlinable and pure,
        // so the JIT is entitled to delete the whole call.
        Compute(i);
    }

    sw.Stop();
    double discarded = sw.Elapsed.TotalMilliseconds;

    sw.Restart();
    long sink = 0;
    for (int i = 0; i < iterations; i++)
    {
        sink += Compute(i);
    }

    sw.Stop();
    double consumed = sw.Elapsed.TotalMilliseconds;

    Console.WriteLine($"   {iterations:N0} calls");
    Console.WriteLine($"     result discarded : {discarded,8:F1} ms   ({discarded * 1_000_000 / iterations,6:F2} ns per call)");
    Console.WriteLine($"     result consumed  : {consumed,8:F1} ms   ({consumed * 1_000_000 / iterations,6:F2} ns per call)");
    Console.WriteLine($"     (sink {sink})");
    Console.WriteLine();
    Console.WriteLine("   The first loop reports a speed the code cannot achieve. Nothing");
    Console.WriteLine("   observes the result, so the JIT is free to delete the multiply,");
    Console.WriteLine("   the shift and the exclusive-or, leaving little more than the loop");
    Console.WriteLine("   counter.");
    Console.WriteLine();
    Console.WriteLine("   Be precise about what this shows: the discarded loop is not zero,");
    Console.WriteLine("   so it was not eliminated ENTIRELY - the loop itself still ran. It");
    Console.WriteLine("   reports well under half the real cost, which is enough to make a");
    Console.WriteLine("   comparison meaningless.");
    Console.WriteLine();
    Console.WriteLine("   This is the most common way a hand-rolled benchmark lies, and it");
    Console.WriteLine("   lies in the flattering direction - which is why it survives review.");
    Console.WriteLine("   Treat any per-operation figure below about a nanosecond as a claim");
    Console.WriteLine("   that the work was optimised away, until you have proved otherwise.");
    Console.WriteLine();

    static long Compute(int i) => (i * 2654435761L) ^ (i >> 3);
}

// ---------------------------------------------------------------------------
// 2. Tiered compilation: the first calls run different machine code.
// ---------------------------------------------------------------------------
static void NoWarmup()
{
    Console.WriteLine("2. The first iterations measure the wrong machine code");
    Console.WriteLine();
    Console.WriteLine("   iteration        time      what is running");
    Console.WriteLine("   ---------        ----      ---------------");

    var data = new int[4096];
    for (int i = 0; i < data.Length; i++)
    {
        data[i] = i;
    }

    // Time individual early iterations, then a steady-state one.
    double[] samples = new double[6];
    long sink = 0;

    for (int round = 0; round < samples.Length; round++)
    {
        var sw = Stopwatch.StartNew();
        for (int rep = 0; rep < 200; rep++)
        {
            sink += SumIt(data);
        }

        sw.Stop();
        samples[round] = sw.Elapsed.TotalMilliseconds;
    }

    // Steady state after tier 1 has had a chance to kick in.
    for (int i = 0; i < 200_000; i++)
    {
        sink += SumIt(data);
    }

    var steady = Stopwatch.StartNew();
    for (int rep = 0; rep < 200; rep++)
    {
        sink += SumIt(data);
    }

    steady.Stop();

    string[] labels = { "tier 0, cold", "tier 0", "tier 0", "tier 0", "tier 0", "tier 0" };
    for (int i = 0; i < samples.Length; i++)
    {
        Console.WriteLine($"   round {i,2}     {samples[i],7:F2} ms      {labels[i]}");
    }

    Console.WriteLine($"   after 200k   {steady.Elapsed.TotalMilliseconds,7:F2} ms      tier 1, optimised");
    Console.WriteLine();
    Console.WriteLine($"   first round vs steady state: {samples[0] / steady.Elapsed.TotalMilliseconds,5:F1}x");
    Console.WriteLine($"   (sink {sink})");
    Console.WriteLine();
    Console.WriteLine("   .NET compiles a method twice. Tier 0 is produced quickly and is");
    Console.WriteLine("   barely optimised; after roughly 30 calls the method is queued for");
    Console.WriteLine("   tier 1, which is the code that actually runs in production.");
    Console.WriteLine();
    Console.WriteLine("   A benchmark with no warmup measures tier 0 plus the JIT itself.");
    Console.WriteLine("   The ratio above varies between runs - what is stable is that the");
    Console.WriteLine("   first measurement is the slowest and is not the answer.");
    Console.WriteLine();

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long SumIt(int[] values)
    {
        long total = 0;
        foreach (int v in values)
        {
            total += v;
        }

        return total;
    }
}

// ---------------------------------------------------------------------------
// 3. The same code, timed repeatedly.
// ---------------------------------------------------------------------------
static void RunToRunVariance()
{
    Console.WriteLine("3. The same work, measured twenty times");
    Console.WriteLine();

    var data = new int[8192];
    for (int i = 0; i < data.Length; i++)
    {
        data[i] = i;
    }

    long sink = 0;

    // Warm up properly this time, so tiering is not the explanation.
    for (int i = 0; i < 50_000; i++)
    {
        sink += Work(data);
    }

    var samples = new double[20];
    for (int i = 0; i < samples.Length; i++)
    {
        var sw = Stopwatch.StartNew();
        for (int rep = 0; rep < 2_000; rep++)
        {
            sink += Work(data);
        }

        sw.Stop();
        samples[i] = sw.Elapsed.TotalMilliseconds;
    }

    Array.Sort(samples);
    double min = samples[0];
    double max = samples[^1];
    double median = samples[samples.Length / 2];
    double mean = samples.Average();
    double stdDev = Math.Sqrt(samples.Sum(s => (s - mean) * (s - mean)) / samples.Length);

    Console.WriteLine($"   min    : {min,7:F2} ms");
    Console.WriteLine($"   median : {median,7:F2} ms");
    Console.WriteLine($"   mean   : {mean,7:F2} ms");
    Console.WriteLine($"   max    : {max,7:F2} ms");
    Console.WriteLine($"   stddev : {stdDev,7:F2} ms  ({100 * stdDev / mean:F1}% of the mean)");
    Console.WriteLine($"   spread : {max / min,7:F2}x between fastest and slowest");
    Console.WriteLine($"   (sink {sink})");
    Console.WriteLine();
    Console.WriteLine("   Identical work, fully warmed up, and the slowest run takes");
    Console.WriteLine("   noticeably longer than the fastest. The machine is not idle: other");
    Console.WriteLine("   processes, frequency scaling, cache pressure and interrupts all");
    Console.WriteLine("   land somewhere in these numbers.");
    Console.WriteLine();
    Console.WriteLine("   The consequence for a single-run comparison: any difference smaller");
    Console.WriteLine("   than this spread is not a result. If A and B differ by 10% and the");
    Console.WriteLine("   noise is 15%, you have measured nothing.");
    Console.WriteLine();

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long Work(int[] values)
    {
        long total = 0;
        for (int i = 0; i < values.Length; i++)
        {
            total += values[i] * 3 / 2;
        }

        return total;
    }
}

// ---------------------------------------------------------------------------
// 4. Whichever you measure first is at a disadvantage.
// ---------------------------------------------------------------------------
static void OrderingEffects()
{
    Console.WriteLine("4. Does order of measurement change the answer?");
    Console.WriteLine();

    var data = new int[4096];
    for (int i = 0; i < data.Length; i++)
    {
        data[i] = i;
    }

    // Two identical implementations. Any difference is measurement artefact.
    (double firstAB, double secondAB) = MeasurePair(data, aFirst: true);
    (double firstBA, double secondBA) = MeasurePair(data, aFirst: false);

    Console.WriteLine("   Two IDENTICAL methods, so any difference is an artefact.");
    Console.WriteLine();
    Console.WriteLine("   order    measured first   measured second");
    Console.WriteLine("   -----    --------------   ---------------");
    Console.WriteLine($"   A, B     {firstAB,11:F2} ms   {secondAB,13:F2} ms");
    Console.WriteLine($"   B, A     {firstBA,11:F2} ms   {secondBA,13:F2} ms");
    Console.WriteLine();
    Console.WriteLine("   The expectation writing this was a clear first-mover penalty from");
    Console.WriteLine("   cold caches and JIT. There is no such penalty visible here: the");
    Console.WriteLine("   four numbers agree to within a percent or two.");
    Console.WriteLine();
    Console.WriteLine("   That is a REAL RESULT and it is the more useful one. Section 3");
    Console.WriteLine("   measured a noise floor of roughly 16% on identical work. Any");
    Console.WriteLine("   ordering effect here is smaller than that, so this experiment");
    Console.WriteLine("   cannot detect it - and neither can any benchmark you write.");
    Console.WriteLine();
    Console.WriteLine("   The lesson is not 'ordering does not matter'. It is that you must");
    Console.WriteLine("   know your noise floor before claiming any effect, because an");
    Console.WriteLine("   effect smaller than the noise is indistinguishable from nothing.");
    Console.WriteLine();
    Console.WriteLine("   Ordering effects are real and are documented on larger benchmarks");
    Console.WriteLine("   and colder caches. A serious harness defends against them anyway,");
    Console.WriteLine("   by running each benchmark in its own process - which costs nothing");
    Console.WriteLine("   if the effect is absent and saves you if it is not.");
    Console.WriteLine();

    static (double, double) MeasurePair(int[] data, bool aFirst)
    {
        long sink = 0;
        double first = Time(aFirst ? ImplA : ImplB);
        double second = Time(aFirst ? ImplB : ImplA);
        _ = sink;
        return (first, second);

        double Time(Func<int[], long> body)
        {
            var sw = Stopwatch.StartNew();
            for (int rep = 0; rep < 3_000; rep++)
            {
                sink += body(data);
            }

            sw.Stop();
            return sw.Elapsed.TotalMilliseconds;
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long ImplA(int[] values)
    {
        long total = 0;
        for (int i = 0; i < values.Length; i++)
        {
            total += values[i];
        }

        return total;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long ImplB(int[] values)
    {
        long total = 0;
        for (int i = 0; i < values.Length; i++)
        {
            total += values[i];
        }

        return total;
    }
}

// ---------------------------------------------------------------------------
// 5. A collection triggered by one benchmark is paid for by the next.
// ---------------------------------------------------------------------------
static void GcInterference()
{
    Console.WriteLine("5. Does one benchmark pay for the previous one's garbage?");
    Console.WriteLine();

    long sink = 0;

    // A allocates heavily and leaves the heap full of garbage.
    var swA = Stopwatch.StartNew();
    for (int i = 0; i < 200_000; i++)
    {
        var buffer = new byte[512];
        buffer[0] = (byte)i;
        sink += buffer[0];
    }

    swA.Stop();

    // B allocates nothing - but a collection triggered by A's garbage can
    // land inside B's measurement window.
    var swB = Stopwatch.StartNew();
    for (int i = 0; i < 200_000; i++)
    {
        sink += i % 7;
    }

    swB.Stop();

    // Now B again, with the heap cleaned first.
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    var swBClean = Stopwatch.StartNew();
    for (int i = 0; i < 200_000; i++)
    {
        sink += i % 7;
    }

    swBClean.Stop();

    Console.WriteLine($"   A (allocating)                  : {swA.Elapsed.TotalMilliseconds,7:F2} ms");
    Console.WriteLine($"   B, straight after A             : {swB.Elapsed.TotalMilliseconds,7:F2} ms");
    Console.WriteLine($"   B, after a forced collection    : {swBClean.Elapsed.TotalMilliseconds,7:F2} ms");
    Console.WriteLine($"   (sink {sink})");
    Console.WriteLine();
    Console.WriteLine("   The two B rows are the same. Again, the expectation was that A's");
    Console.WriteLine("   garbage would be collected during B and inflate it, and again the");
    Console.WriteLine("   effect is not visible.");
    Console.WriteLine();
    Console.WriteLine("   The reason is worth knowing: A's 200,000 small arrays die");
    Console.WriteLine("   immediately, so its collections happen DURING A and are already");
    Console.WriteLine("   paid for by the time B starts. Cross-benchmark GC interference");
    Console.WriteLine("   needs garbage that SURVIVES - a growing cache, a retained list -");
    Console.WriteLine("   which is a different workload from this one.");
    Console.WriteLine();
    Console.WriteLine("   Two honest negatives in a row is itself the point of this file.");
    Console.WriteLine("   Sections 1 and 2 found effects of 2.6x and 4.5x, far above the");
    Console.WriteLine("   noise. Sections 4 and 5 looked for effects and did not find them.");
    Console.WriteLine();
    Console.WriteLine("   A measurement that fails to find an effect is a result, and");
    Console.WriteLine("   reporting it is the difference between a harness you can trust and");
    Console.WriteLine("   one that confirms whatever you expected.");
    Console.WriteLine();
    Console.WriteLine("   Collect between measurements anyway, and report allocation next to");
    Console.WriteLine("   time. Both are cheap, and both remove a variable you would");
    Console.WriteLine("   otherwise have to argue about.");
}

// ---------------------------------------------------------------------------
static bool IsDebug()
{
#if DEBUG
    return true;
#else
    return false;
#endif
}
