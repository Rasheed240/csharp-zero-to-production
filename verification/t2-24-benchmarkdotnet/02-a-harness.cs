// 02-a-harness.cs — A measurement harness that defends against everything in
// 01-why-timing-lies.cs, written out so each defence is visible.
//
// This is what BenchmarkDotNet does. There is no package reference here because
// this project has no package manager, and writing it by hand is the point:
// every line below exists because of a specific way a naive benchmark lies.
//
// Run:  dotnet run 02-a-harness.cs -c Release
//
// EXACT vs RATIO: the harness reports a mean, a median, a standard deviation
// and an error margin precisely so you can see which differences are real.

using System.Diagnostics;
using System.Runtime.CompilerServices;

Console.WriteLine($"Configuration : {(IsDebug() ? "DEBUG - results are meaningless" : "RELEASE")}");
Console.WriteLine($"Server GC     : {System.Runtime.GCSettings.IsServerGC}");
Console.WriteLine($"Processors    : {Environment.ProcessorCount}");
Console.WriteLine();

var data = new int[4096];
for (int i = 0; i < data.Length; i++)
{
    data[i] = i;
}

var results = new List<Result>
{
    Harness.Run("for loop        ", () => SumForLoop(data)),
    Harness.Run("foreach         ", () => SumForEach(data)),
    Harness.Run("LINQ Sum        ", () => SumLinq(data)),
    Harness.Run("LINQ Where+Sum  ", () => SumLinqWhere(data))
};

Harness.Report(results);
Explain();

// ---------------------------------------------------------------------------
[MethodImpl(MethodImplOptions.NoInlining)]
static long SumForLoop(int[] values)
{
    long total = 0;
    for (int i = 0; i < values.Length; i++)
    {
        total += values[i];
    }

    return total;
}

[MethodImpl(MethodImplOptions.NoInlining)]
static long SumForEach(int[] values)
{
    long total = 0;
    foreach (int v in values)
    {
        total += v;
    }

    return total;
}

[MethodImpl(MethodImplOptions.NoInlining)]
static long SumLinq(int[] values) => values.Sum(v => (long)v);

[MethodImpl(MethodImplOptions.NoInlining)]
static long SumLinqWhere(int[] values) => values.Where(v => v >= 0).Sum(v => (long)v);

// ---------------------------------------------------------------------------
static void Explain()
{
    Console.WriteLine();
    Console.WriteLine("What each part of the harness defends against");
    Console.WriteLine();
    Console.WriteLine("   WARMUP           - tiered compilation. Measured in 01 at 4.5x");
    Console.WriteLine("                      between the first round and steady state.");
    Console.WriteLine();
    Console.WriteLine("   RETURN A VALUE   - dead code elimination. The delegate returns long");
    Console.WriteLine("                      and the harness accumulates it into a field it");
    Console.WriteLine("                      prints, so nothing can be optimised away.");
    Console.WriteLine();
    Console.WriteLine("   PILOT            - picks an iteration count so each measurement runs");
    Console.WriteLine("                      long enough to be timed accurately. A 20 ns");
    Console.WriteLine("                      operation timed once measures the clock.");
    Console.WriteLine();
    Console.WriteLine("   MANY SAMPLES     - run-to-run variance, measured in 01 at 16% of the");
    Console.WriteLine("                      mean. One sample cannot tell you that.");
    Console.WriteLine();
    Console.WriteLine("   MEDIAN AND ERROR - a mean is dragged by one slow sample. The median");
    Console.WriteLine("                      is not, and the error margin says whether two");
    Console.WriteLine("                      results are distinguishable at all.");
    Console.WriteLine();
    Console.WriteLine("   COLLECT BETWEEN  - one benchmark's garbage being collected inside");
    Console.WriteLine("                      the next one's window.");
    Console.WriteLine();
    Console.WriteLine("   ALLOCATION       - reported alongside time, because allocation is");
    Console.WriteLine("                      deterministic where time is not. Where the two");
    Console.WriteLine("                      disagree, the allocation column is the one to");
    Console.WriteLine("                      argue from.");
    Console.WriteLine();
    Console.WriteLine("What this harness still does NOT do, and BenchmarkDotNet does");
    Console.WriteLine();
    Console.WriteLine("   - Run each benchmark in its own PROCESS, which removes ordering");
    Console.WriteLine("     effects and lets it test several runtimes in one session.");
    Console.WriteLine("   - Detect and remove outliers statistically rather than by eye.");
    Console.WriteLine("   - Disassemble the generated code so you can check what was");
    Console.WriteLine("     actually measured.");
    Console.WriteLine("   - Detect an unstable environment and tell you the result is");
    Console.WriteLine("     untrustworthy rather than printing it anyway.");
    Console.WriteLine();
    Console.WriteLine("   Use BenchmarkDotNet for real work. Understand this harness so you");
    Console.WriteLine("   can read its output and know which column to believe.");
}

static bool IsDebug()
{
#if DEBUG
    return true;
#else
    return false;
#endif
}

// ---------------------------------------------------------------------------
readonly record struct Result(
    string Name,
    double MeanNs,
    double MedianNs,
    double StdDevNs,
    double ErrorNs,
    double MinNs,
    double MaxNs,
    long BytesPerOp);

static class Harness
{
    private const int WarmupIterations = 10_000;
    private const int SampleCount = 21;
    private const long TargetSampleMs = 60;

    // Accumulated and printed, so no benchmark result can be discarded as
    // unused and optimised away.
    private static long _sink;

    public static Result Run(string name, Func<long> body)
    {
        // 1. WARMUP. Gets the method to tier 1 before anything is timed.
        for (int i = 0; i < WarmupIterations; i++)
        {
            _sink += body();
        }

        // 2. PILOT. Find how many iterations take roughly TargetSampleMs, so
        //    every benchmark is measured over a comparable duration rather
        //    than a comparable iteration count.
        int iterations = Pilot(body);

        // 3. MEASURE ALLOCATION separately from time. Allocation is exact and
        //    deterministic; mixing it into the timed loop adds noise to both.
        Collect();
        long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < iterations; i++)
        {
            _sink += body();
        }

        long bytesPerOp = (GC.GetTotalAllocatedBytes(precise: true) - allocBefore) / iterations;

        // 4. SAMPLE repeatedly, collecting between samples so one sample's
        //    garbage is not collected inside the next.
        var samples = new double[SampleCount];
        for (int s = 0; s < SampleCount; s++)
        {
            Collect();

            var sw = Stopwatch.StartNew();
            for (int i = 0; i < iterations; i++)
            {
                _sink += body();
            }

            sw.Stop();
            samples[s] = sw.Elapsed.TotalMilliseconds * 1_000_000 / iterations;
        }

        return Summarise(name, samples, bytesPerOp);
    }

    private static int Pilot(Func<long> body)
    {
        int iterations = 16;

        while (iterations < 100_000_000)
        {
            var sw = Stopwatch.StartNew();
            for (int i = 0; i < iterations; i++)
            {
                _sink += body();
            }

            sw.Stop();

            if (sw.ElapsedMilliseconds >= TargetSampleMs)
            {
                return iterations;
            }

            // Scale toward the target rather than always doubling, so a very
            // fast operation does not need twenty rounds to get there.
            long elapsed = Math.Max(sw.ElapsedMilliseconds, 1);
            long scale = Math.Max(2, TargetSampleMs / elapsed);
            iterations = (int)Math.Min(iterations * scale, 100_000_000);
        }

        return iterations;
    }

    private static Result Summarise(string name, double[] samples, long bytesPerOp)
    {
        var sorted = (double[])samples.Clone();
        Array.Sort(sorted);

        double mean = sorted.Average();
        double median = sorted.Length % 2 == 1
            ? sorted[sorted.Length / 2]
            : (sorted[sorted.Length / 2 - 1] + sorted[sorted.Length / 2]) / 2;

        double variance = sorted.Sum(s => (s - mean) * (s - mean)) / (sorted.Length - 1);
        double stdDev = Math.Sqrt(variance);

        // Standard error of the mean, scaled to roughly a 95% interval. This
        // is the number that says whether two results differ.
        double error = 1.96 * stdDev / Math.Sqrt(sorted.Length);

        return new Result(name, mean, median, stdDev, error, sorted[0], sorted[^1], bytesPerOp);
    }

    public static void Report(List<Result> results)
    {
        Console.WriteLine("   method              mean         error      stddev        median   alloc/op");
        Console.WriteLine("   ------              ----         -----      ------        ------   --------");

        foreach (Result r in results)
        {
            Console.WriteLine($"   {r.Name}  {r.MeanNs,8:F1} ns  +/-{r.ErrorNs,6:F1} ns  {r.StdDevNs,7:F1} ns  " +
                $"{r.MedianNs,8:F1} ns  {r.BytesPerOp,6:N0} B");
        }

        Console.WriteLine();

        // Ratios against the first entry, with an honest statement about
        // whether the difference is larger than the combined error.
        Result baseline = results[0];
        Console.WriteLine($"   Relative to {baseline.Name.Trim()}:");
        Console.WriteLine();

        foreach (Result r in results.Skip(1))
        {
            double ratio = r.MeanNs / baseline.MeanNs;
            double combinedError = baseline.ErrorNs + r.ErrorNs;
            bool distinguishable = Math.Abs(r.MeanNs - baseline.MeanNs) > combinedError;

            Console.WriteLine($"     {r.Name}  {ratio,5:F2}x   " +
                (distinguishable
                    ? "difference exceeds the combined error"
                    : "NOT DISTINGUISHABLE from the baseline"));
        }

        Console.WriteLine();

        // A mean far from the median means one or two samples dominated, which
        // is the signal to distrust the mean rather than the machine.
        var skewed = results.Where(r => Math.Abs(r.MeanNs - r.MedianNs) > r.ErrorNs).ToList();
        if (skewed.Count > 0)
        {
            Console.WriteLine("   OUTLIERS DETECTED - mean is further from median than the error:");
            foreach (Result r in skewed)
            {
                Console.WriteLine($"     {r.Name}  mean {r.MeanNs,8:F1} ns, median {r.MedianNs,8:F1} ns, " +
                    $"max {r.MaxNs,9:F1} ns");
            }

            Console.WriteLine();
            Console.WriteLine("   For these rows the MEDIAN is the better estimate. A single slow");
            Console.WriteLine("   sample - a collection, a context switch, another process waking");
            Console.WriteLine("   up - drags a mean and leaves a median alone.");
            Console.WriteLine();
            Console.WriteLine("   This is why a benchmark that reports only an average is hard to");
            Console.WriteLine("   trust: it cannot tell you whether the number is the typical");
            Console.WriteLine("   cost or one bad sample.");
            Console.WriteLine();
        }

        Console.WriteLine($"   (sink {_sink}, printed so nothing can be optimised away)");
    }

    private static void Collect()
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
    }
}
