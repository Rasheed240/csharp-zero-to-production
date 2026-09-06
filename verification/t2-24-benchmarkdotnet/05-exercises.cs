// 05-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 05-exercises.cs -c Release

using System.Diagnostics;
using System.Runtime.CompilerServices;

Exercise1();
Exercise2();
Exercise3();
Exercise4();
Exercise5();
Exercise6();

// ---------------------------------------------------------------------------
// 1. EASY — find the four bugs in a naive benchmark.
// ---------------------------------------------------------------------------
static void Exercise1()
{
    Console.WriteLine("Exercise 1: what is wrong with this benchmark?");
    Console.WriteLine();
    Console.WriteLine("     var sw = Stopwatch.StartNew();");
    Console.WriteLine("     for (int i = 0; i < 1000; i++) Parse(line);");
    Console.WriteLine("     sw.Stop();");
    Console.WriteLine("     Console.WriteLine(sw.ElapsedMilliseconds);");
    Console.WriteLine();

    const string line = "INV-2026-0004821,GBP,123450";

    // (a) no warmup: measure the first 1000 calls, cold.
    var cold = Stopwatch.StartNew();
    for (int i = 0; i < 1_000; i++)
    {
        Parse(line);
    }

    cold.Stop();

    // (b) warmed up, result still discarded.
    for (int i = 0; i < 200_000; i++)
    {
        Parse(line);
    }

    var discarded = Stopwatch.StartNew();
    for (int i = 0; i < 1_000; i++)
    {
        Parse(line);
    }

    discarded.Stop();

    // (c) warmed up and consumed.
    long sink = 0;
    var consumed = Stopwatch.StartNew();
    for (int i = 0; i < 1_000; i++)
    {
        sink += Parse(line);
    }

    consumed.Stop();

    Console.WriteLine($"   cold, discarded  : {cold.Elapsed.TotalMilliseconds * 1_000_000 / 1_000,8:F1} ns per call");
    Console.WriteLine($"   warm, discarded  : {discarded.Elapsed.TotalMilliseconds * 1_000_000 / 1_000,8:F1} ns per call");
    Console.WriteLine($"   warm, consumed   : {consumed.Elapsed.TotalMilliseconds * 1_000_000 / 1_000,8:F1} ns per call");
    Console.WriteLine($"   (sink {sink})");
    Console.WriteLine();
    Console.WriteLine("   Four bugs:");
    Console.WriteLine();
    Console.WriteLine("     1. NO WARMUP. The first calls run tier 0 code and include the");
    Console.WriteLine("        JIT itself.");
    Console.WriteLine("     2. RESULT DISCARDED. Nothing observes Parse, so the JIT may");
    Console.WriteLine("        delete some or all of it.");
    Console.WriteLine("     3. ONE SAMPLE. Run-to-run variance on identical work measured");
    Console.WriteLine("        16% of the mean elsewhere in this module. One number cannot");
    Console.WriteLine("        tell you whether a difference is real.");
    Console.WriteLine("     4. MILLISECOND RESOLUTION for an operation measured in");
    Console.WriteLine("        nanoseconds. A thousand calls at 100 ns is 0.1 ms, which");
    Console.WriteLine("        rounds to 0.");
    Console.WriteLine();
    Console.WriteLine("   A fifth, subtler one: no allocation is reported, and for a parsing");
    Console.WriteLine("   change the allocation is frequently the entire point.");
    Console.WriteLine();

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long Parse(string line)
    {
        string[] fields = line.Split(',');
        return long.Parse(fields[2], System.Globalization.CultureInfo.InvariantCulture);
    }
}

// ---------------------------------------------------------------------------
// 2. EASY — is a 5% difference a result?
// ---------------------------------------------------------------------------
static void Exercise2()
{
    Console.WriteLine("Exercise 2: A is 5% faster than B. Is that a result?");
    Console.WriteLine();

    var data = new int[4096];
    for (int i = 0; i < data.Length; i++)
    {
        data[i] = i;
    }

    long sink = 0;
    for (int i = 0; i < 100_000; i++)
    {
        sink += Sum(data);
    }

    // Twenty samples of IDENTICAL work.
    var samples = new double[20];
    for (int s = 0; s < samples.Length; s++)
    {
        var sw = Stopwatch.StartNew();
        for (int i = 0; i < 3_000; i++)
        {
            sink += Sum(data);
        }

        sw.Stop();
        samples[s] = sw.Elapsed.TotalMilliseconds;
    }

    double mean = samples.Average();
    double stdDev = Math.Sqrt(samples.Sum(x => (x - mean) * (x - mean)) / (samples.Length - 1));
    double error = 1.96 * stdDev / Math.Sqrt(samples.Length);

    Console.WriteLine($"   twenty samples of the SAME code");
    Console.WriteLine($"     mean   : {mean,7:F2} ms");
    Console.WriteLine($"     stddev : {stdDev,7:F2} ms   ({100 * stdDev / mean:F1}% of the mean)");
    Console.WriteLine($"     95% error margin on the mean: +/-{100 * error / mean:F1}%");
    Console.WriteLine($"   (sink {sink})");
    Console.WriteLine();
    Console.WriteLine("   The answer: it depends entirely on the error margin, and you");
    Console.WriteLine("   cannot know without measuring the noise.");
    Console.WriteLine();
    Console.WriteLine("   If the margin above is wider than 5%, a 5% difference is");
    Console.WriteLine("   indistinguishable from no difference. If it is much narrower, 5%");
    Console.WriteLine("   is real - and may still not be worth anything, which is a");
    Console.WriteLine("   separate question.");
    Console.WriteLine();
    Console.WriteLine("   This is why a benchmark that reports only a mean is not usable.");
    Console.WriteLine("   Without a spread you cannot tell a result from noise, and the");
    Console.WriteLine("   temptation is always to believe the number that agrees with you.");
    Console.WriteLine();

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long Sum(int[] values)
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
// 3. MEDIUM — the benchmark whose winner depends on N.
// ---------------------------------------------------------------------------
static void Exercise3()
{
    Console.WriteLine("Exercise 3: which collection should the service use?");
    Console.WriteLine();
    Console.WriteLine("      size   List.Contains   HashSet.Contains   winner");
    Console.WriteLine("      ----   -------------   ----------------   ------");

    foreach (int size in new[] { 2, 4, 8, 16, 64, 1_000 })
    {
        int[] values = Enumerable.Range(0, size).ToArray();
        var list = new List<int>(values);
        var set = new HashSet<int>(values);
        int target = values[^1];

        double listTime = Measure(() => list.Contains(target) ? 1 : 0);
        double setTime = Measure(() => set.Contains(target) ? 1 : 0);

        string winner = listTime < setTime ? "List" : "HashSet";
        Console.WriteLine($"   {size,7:N0}   {listTime,11:F1} ns   {setTime,14:F1} ns   {winner}");
    }

    Console.WriteLine();
    Console.WriteLine("   There is no single answer, and that is the answer. The crossover");
    Console.WriteLine("   is the number worth knowing, and it is small - a handful of items");
    Console.WriteLine("   for int keys, and further out for long strings with common");
    Console.WriteLine("   prefixes, because each comparison costs more.");
    Console.WriteLine();
    Console.WriteLine("   What to do with this:");
    Console.WriteLine();
    Console.WriteLine("     - Benchmark at the size production has, and at one either side.");
    Console.WriteLine("     - Prefer the one that degrades gracefully. A List that is fine");
    Console.WriteLine("       at 8 and catastrophic at 4,000 is a bug waiting for growth;");
    Console.WriteLine("       a HashSet that is marginally slower at 8 is not.");
    Console.WriteLine("     - Ask whether the difference is worth anything at all. At these");
    Console.WriteLine("       sizes both are nanoseconds inside a request measured in");
    Console.WriteLine("       milliseconds.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — the effect that vanishes at system level.
// ---------------------------------------------------------------------------
static void Exercise4()
{
    Console.WriteLine("Exercise 4: worth shipping?");
    Console.WriteLine();

    const string line = "INV-2026-0004821,GBP,123450,2026-03-14";

    double before = Measure(() => (int)SlowParse(line));
    double after = Measure(() => (int)FastParse(line));

    Console.WriteLine($"   parse before : {before,7:F0} ns");
    Console.WriteLine($"   parse after  : {after,7:F0} ns");
    Console.WriteLine($"   ratio        : {before / after,7:F2}x");
    Console.WriteLine();
    Console.WriteLine("   Now put it in context. Three different services:");
    Console.WriteLine();
    Console.WriteLine("      service                        calls/request   request time   improvement");
    Console.WriteLine("      -------                        -------------   ------------   -----------");

    ShowContext("API endpoint (1 parse, 8 ms db) ", 1, 8_000_000);
    ShowContext("batch import (200k parses)      ", 200_000, 0);
    ShowContext("log ingest (50 parses, 2 ms io) ", 50, 2_000_000);

    Console.WriteLine();
    Console.WriteLine("   Same change, three different answers.");
    Console.WriteLine();
    Console.WriteLine("   For the API endpoint it is invisible - the request is dominated by");
    Console.WriteLine("   a database call, and no improvement to a nanosecond-scale operation");
    Console.WriteLine("   can move it.");
    Console.WriteLine();
    Console.WriteLine("   For the batch import it is the whole job, because there is nothing");
    Console.WriteLine("   else in the loop.");
    Console.WriteLine();
    Console.WriteLine("   The microbenchmark is IDENTICAL in all three cases. It cannot tell");
    Console.WriteLine("   you which situation you are in, and the ratio it reports is the");
    Console.WriteLine("   same misleading number every time.");
    Console.WriteLine();

    void ShowContext(string label, long callsPerRequest, double otherNanoseconds)
    {
        double totalBefore = before * callsPerRequest + otherNanoseconds;
        double totalAfter = after * callsPerRequest + otherNanoseconds;
        Console.WriteLine($"      {label}  {callsPerRequest,13:N0}   {totalBefore / 1_000_000,10:F1} ms   " +
            $"{totalBefore / totalAfter,9:F3}x");
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long SlowParse(string line)
    {
        string[] fields = line.Split(',');
        return long.Parse(fields[2], System.Globalization.CultureInfo.InvariantCulture);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long FastParse(string line)
    {
        ReadOnlySpan<char> span = line;
        int first = span.IndexOf(',');
        ReadOnlySpan<char> rest = span[(first + 1)..];
        int second = rest.IndexOf(',');
        ReadOnlySpan<char> amount = rest[(second + 1)..];
        int third = amount.IndexOf(',');
        if (third >= 0)
        {
            amount = amount[..third];
        }

        return long.Parse(amount, System.Globalization.CultureInfo.InvariantCulture);
    }
}

// ---------------------------------------------------------------------------
// 5. HARD — a regression test that cannot flake.
// ---------------------------------------------------------------------------
static void Exercise5()
{
    Console.WriteLine("Exercise 5: a performance test that will not flake in CI");
    Console.WriteLine();

    const string line = "INV-2026-0004821,GBP,123450,2026-03-14";

    // Timing, ten runs of the same measurement.
    var timings = new double[10];
    for (int i = 0; i < timings.Length; i++)
    {
        timings[i] = Measure(() => (int)Parse(line));
    }

    // Allocation, ten runs of the same measurement.
    var allocations = new long[10];
    for (int i = 0; i < allocations.Length; i++)
    {
        allocations[i] = MeasureAllocation(() => Parse(line));
    }

    Console.WriteLine($"   ten measurements of TIME       : min {timings.Min(),6:F0} ns, max {timings.Max(),6:F0} ns, " +
        $"spread {timings.Max() / timings.Min(),4:F2}x");
    Console.WriteLine($"   ten measurements of ALLOCATION : min {allocations.Min(),6} B, max {allocations.Max(),6} B, " +
        $"identical: {allocations.Distinct().Count() == 1}");
    Console.WriteLine();
    Console.WriteLine("   That is the answer. Allocation is DETERMINISTIC and time is not.");
    Console.WriteLine();
    Console.WriteLine("   A CI assertion on nanoseconds fails on a noisy build agent, gets");
    Console.WriteLine("   marked flaky, gets a wider threshold, and then no longer catches");
    Console.WriteLine("   anything. A CI assertion on bytes per operation is exact.");
    Console.WriteLine();
    Console.WriteLine("     [Fact]");
    Console.WriteLine("     public void ParseDoesNotAllocate()");
    Console.WriteLine("     {");
    Console.WriteLine("         Warmup();");
    Console.WriteLine("         GC.Collect();");
    Console.WriteLine("         long before = GC.GetTotalAllocatedBytes(precise: true);");
    Console.WriteLine("         for (int i = 0; i < 10_000; i++) Parse(Line);");
    Console.WriteLine("         long perOp = (GC.GetTotalAllocatedBytes(true) - before) / 10_000;");
    Console.WriteLine("         Assert.True(perOp <= 8, $\"allocated {perOp} bytes, budget 8\");");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   Three details that make it robust:");
    Console.WriteLine();
    Console.WriteLine("     - Assert a CEILING, not an exact value. Runtime versions change");
    Console.WriteLine("       the details and you do not want to update the test for that.");
    Console.WriteLine("     - Warm up first, so first-call caches are not counted.");
    Console.WriteLine("     - Put the budget in the message. When it fails at 3am the");
    Console.WriteLine("       failure should say what was expected and what happened.");
    Console.WriteLine();
    Console.WriteLine("   Keep timing benchmarks too - run them locally, on demand, when you");
    Console.WriteLine("   are investigating something. They are a tool for answering a");
    Console.WriteLine("   question, not a gate for a pull request.");
    Console.WriteLine();

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long Parse(string line)
    {
        string[] fields = line.Split(',');
        return long.Parse(fields[2], System.Globalization.CultureInfo.InvariantCulture);
    }
}

// ---------------------------------------------------------------------------
// 6. HARD — reviewing somebody else's benchmark.
// ---------------------------------------------------------------------------
static void Exercise6()
{
    Console.WriteLine("Exercise 6: reviewing a benchmark result");
    Console.WriteLine();
    Console.WriteLine("   A colleague brings this and asks to ship the change:");
    Console.WriteLine();
    Console.WriteLine("     | Method    | Mean     | Ratio |");
    Console.WriteLine("     | Original  | 412.3 ns |  1.00 |");
    Console.WriteLine("     | Optimised |  38.1 ns |  0.09 |");
    Console.WriteLine();
    Console.WriteLine("   Eleven times faster. What do you ask?");
    Console.WriteLine();
    Console.WriteLine("   1. WHERE IS THE ERROR COLUMN?");
    Console.WriteLine("      Without a spread, 412 against 38 could be two samples on a");
    Console.WriteLine("      noisy machine. Measured in this module, identical work varied");
    Console.WriteLine("      by 16% of its mean between samples.");
    Console.WriteLine();
    Console.WriteLine("   2. WHERE IS THE ALLOCATION COLUMN?");
    Console.WriteLine("      An 11x on time with more allocation per operation can be a net");
    Console.WriteLine("      loss in a service, because the collection is paid by whichever");
    Console.WriteLine("      request is unlucky.");
    Console.WriteLine();
    Console.WriteLine("   3. IS 38 ns EVEN POSSIBLE FOR THIS WORK?");
    Console.WriteLine("      A figure that low for anything touching a string is a claim");
    Console.WriteLine("      that part of it was optimised away. Ask what consumes the");
    Console.WriteLine("      result.");
    Console.WriteLine();
    Console.WriteLine("   4. WHAT SIZE AND SHAPE WAS THE INPUT?");
    Console.WriteLine("      Measured in this module: a lookup benchmark's winner reversed");
    Console.WriteLine("      between 4 entries and 4,000, and reversed AGAIN when the keys");
    Console.WriteLine("      changed from 3 characters to 10 with a shared prefix.");
    Console.WriteLine();
    Console.WriteLine("   5. WHAT FRACTION OF A REQUEST IS THIS?");
    Console.WriteLine("      374 ns saved inside an 8 ms request is 0.005%. The change may");
    Console.WriteLine("      be free, in which case take it - but it is not a performance");
    Console.WriteLine("      improvement anybody will observe.");
    Console.WriteLine();
    Console.WriteLine("   6. WHERE ELSE DOES THIS CODE RUN?");
    Console.WriteLine("      The Ledger incident in this module: a change correct for a");
    Console.WriteLine("      4-entry collection was applied to a shared helper that another");
    Console.WriteLine("      call site used with 4,000 entries.");
    Console.WriteLine();
    Console.WriteLine("   None of these is a reason to reject the change. They are the");
    Console.WriteLine("   questions that turn 'it is 11x faster' into a decision, and the");
    Console.WriteLine("   answer to several of them is frequently 'ship it, it is free and");
    Console.WriteLine("   it is not the reason'.");
}

// ---------------------------------------------------------------------------
static double Measure(Func<int> body)
{
    for (int i = 0; i < 10_000; i++)
    {
        Sink.Value += body();
    }

    int iterations = 16;
    while (iterations < 50_000_000)
    {
        var probe = Stopwatch.StartNew();
        for (int i = 0; i < iterations; i++)
        {
            Sink.Value += body();
        }

        probe.Stop();
        if (probe.ElapsedMilliseconds >= 25)
        {
            break;
        }

        iterations *= 4;
    }

    var samples = new double[9];
    for (int s = 0; s < samples.Length; s++)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        var sw = Stopwatch.StartNew();
        for (int i = 0; i < iterations; i++)
        {
            Sink.Value += body();
        }

        sw.Stop();
        samples[s] = sw.Elapsed.TotalMilliseconds * 1_000_000 / iterations;
    }

    Array.Sort(samples);
    return samples[samples.Length / 2];
}

static long MeasureAllocation(Func<long> body)
{
    const int count = 20_000;

    for (int i = 0; i < 1_000; i++)
    {
        Sink.Value += body();
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);
    for (int i = 0; i < count; i++)
    {
        Sink.Value += body();
    }

    return (GC.GetTotalAllocatedBytes(precise: true) - before) / count;
}

static class Sink
{
    public static long Value;
}
