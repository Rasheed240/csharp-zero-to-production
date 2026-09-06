// 03-benchmarks-that-lie.cs — Benchmarks that are technically correct, run
// under a good harness, and still give you the wrong answer.
//
// Everything in 01 was a measurement error. Everything here is a measurement
// of the wrong thing, which is harder to spot because the number is real.
//
// Run:  dotnet run 03-benchmarks-that-lie.cs -c Release
//
// EXACT vs RATIO: the crossover points are the claim and they are stable. The
// absolute nanoseconds are not.

using System.Diagnostics;
using System.Runtime.CompilerServices;

Console.WriteLine("1. The right answer for a size you do not have");
Console.WriteLine();

WrongSize();
WrongData();
WrongUnit();
WrongScope();

// ---------------------------------------------------------------------------
// 1. A lookup benchmark whose winner changes with N.
// ---------------------------------------------------------------------------
static void WrongSize()
{
    Console.WriteLine("   Two lookup strategies, benchmarked at several collection sizes.");
    Console.WriteLine();
    Console.WriteLine("      size   linear scan   dictionary   winner");
    Console.WriteLine("      ----   -----------   ----------   ------");

    foreach (int size in new[] { 4, 8, 16, 64, 1_000, 50_000 })
    {
        string[] keys = Enumerable.Range(0, size).Select(i => $"INV-2026-{i:D7}").ToArray();
        var dictionary = keys.ToDictionary(k => k, k => k.Length, StringComparer.Ordinal);
        string target = keys[^1];       // worst case for the scan

        double scan = Measure(() => LinearScan(keys, target));
        double dict = Measure(() => DictionaryLookup(dictionary, target));

        string winner = scan < dict ? "linear scan" : "dictionary";
        Console.WriteLine($"   {size,7:N0}   {scan,9:F1} ns   {dict,8:F1} ns   {winner}");
    }

    Console.WriteLine();
    Console.WriteLine("   The linear scan wins at small sizes and loses badly at large ones,");
    Console.WriteLine("   which is what the complexity says: O(n) against O(1) with a bigger");
    Console.WriteLine("   constant. There is a crossover, and it is the only interesting");
    Console.WriteLine("   number in the table.");
    Console.WriteLine();
    Console.WriteLine("   A benchmark run at ONE size does not tell you where the crossover");
    Console.WriteLine("   is. Benchmark at 8 and you conclude the dictionary is pointless");
    Console.WriteLine("   overhead; benchmark at 50,000 and you conclude the scan is absurd.");
    Console.WriteLine("   Both conclusions are correct about the size measured and wrong as");
    Console.WriteLine("   general advice.");
    Console.WriteLine();
    Console.WriteLine("   Benchmark at the size your production data actually is, and at one");
    Console.WriteLine("   size either side of it - because your data will grow.");
    Console.WriteLine();

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int LinearScan(string[] keys, string target)
    {
        for (int i = 0; i < keys.Length; i++)
        {
            if (string.Equals(keys[i], target, StringComparison.Ordinal))
            {
                return keys[i].Length;
            }
        }

        return -1;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int DictionaryLookup(Dictionary<string, int> map, string target) =>
        map.TryGetValue(target, out int value) ? value : -1;
}

// ---------------------------------------------------------------------------
// 2. Realistic shape, unrealistic content.
// ---------------------------------------------------------------------------
static void WrongData()
{
    Console.WriteLine("2. The right size, the wrong data");
    Console.WriteLine();

    const int size = 100_000;

    int[] sorted = Enumerable.Range(0, size).ToArray();
    int[] shuffled = sorted.ToArray();
    var random = new Random(42);
    for (int i = shuffled.Length - 1; i > 0; i--)
    {
        int j = random.Next(i + 1);
        (shuffled[i], shuffled[j]) = (shuffled[j], shuffled[i]);
    }

    int[] allSame = new int[size];
    Array.Fill(allSame, 7);

    Console.WriteLine("   Same method, same array size, three different contents:");
    Console.WriteLine();
    Console.WriteLine("      data            time      why");
    Console.WriteLine("      ----            ----      ---");

    double sortedTime = Measure(() => CountAboveHalf(sorted, size / 2));
    double shuffledTime = Measure(() => CountAboveHalf(shuffled, size / 2));
    double sameTime = Measure(() => CountAboveHalf(allSame, size / 2));

    Console.WriteLine($"      sorted     {sortedTime,9:F0} ns      branch predicts perfectly");
    Console.WriteLine($"      shuffled   {shuffledTime,9:F0} ns      branch mispredicts constantly");
    Console.WriteLine($"      all equal  {sameTime,9:F0} ns      branch always taken");
    Console.WriteLine();
    Console.WriteLine($"   shuffled vs sorted: {shuffledTime / sortedTime,4:F1}x");
    Console.WriteLine();
    Console.WriteLine("   The array is the same size and the method does the same number of");
    Console.WriteLine("   comparisons. The only difference is whether the CPU can predict");
    Console.WriteLine("   the branch, and a mispredicted branch costs on the order of");
    Console.WriteLine("   fifteen cycles.");
    Console.WriteLine();
    Console.WriteLine("   Test data is usually sorted, sequential, or all the same, because");
    Console.WriteLine("   that is what Enumerable.Range gives you. Production data is not,");
    Console.WriteLine("   so a benchmark on generated data can be several times optimistic.");
    Console.WriteLine();
    Console.WriteLine("   The same problem in other forms: cache-friendly access patterns,");
    Console.WriteLine("   strings that all differ in the first character, dictionaries with");
    Console.WriteLine("   no hash collisions, and inputs small enough to fit in L1.");
    Console.WriteLine();

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long CountAboveHalf(int[] values, int threshold)
    {
        long count = 0;
        for (int i = 0; i < values.Length; i++)
        {
            if (values[i] > threshold)
            {
                count++;
            }
        }

        return count;
    }
}

// ---------------------------------------------------------------------------
// 3. Measuring time when the answer is allocation.
// ---------------------------------------------------------------------------
static void WrongUnit()
{
    Console.WriteLine("3. The right measurement, the wrong unit");
    Console.WriteLine();

    const string line = "INV-2026-0004821,GBP,123450,2026-03-14";

    double substringTime = Measure(() => ParseWithSubstring(line));
    double spanTime = Measure(() => ParseWithSpan(line));

    long substringBytes = MeasureAllocation(() => ParseWithSubstring(line));
    long spanBytes = MeasureAllocation(() => ParseWithSpan(line));

    Console.WriteLine("      version      time        alloc/op");
    Console.WriteLine("      -------      ----        --------");
    Console.WriteLine($"      Substring  {substringTime,7:F0} ns   {substringBytes,7:N0} B");
    Console.WriteLine($"      Span       {spanTime,7:F0} ns   {spanBytes,7:N0} B");
    Console.WriteLine();
    Console.WriteLine($"      time ratio       : {substringTime / spanTime,5:F2}x");
    Console.WriteLine($"      allocation ratio : {(spanBytes == 0 ? "all removed" : $"{substringBytes / (double)spanBytes:F0}x")}");
    Console.WriteLine();
    Console.WriteLine("   Both columns favour the span version here, so this is not a case");
    Console.WriteLine("   of the two disagreeing. It is a case of one of them being MUCH");
    Console.WriteLine("   more informative than the other.");
    Console.WriteLine();
    Console.WriteLine("   The time ratio is a few times, measured on an idle machine, and it");
    Console.WriteLine("   moves between runs. The allocation figure is 232 bytes to ZERO and");
    Console.WriteLine("   it is identical on every run, on every machine, forever.");
    Console.WriteLine();
    Console.WriteLine("   One of those is a fact you can put in a test and fail a pull");
    Console.WriteLine("   request on. The other is an observation about this laptop.");
    Console.WriteLine();
    Console.WriteLine("   Those bytes are not paid by this method. They are paid by whatever");
    Console.WriteLine("   request is running when the collection happens, which no");
    Console.WriteLine("   microbenchmark can see - it measures one operation in isolation on");
    Console.WriteLine("   an otherwise idle machine.");
    Console.WriteLine();
    Console.WriteLine("   Always report allocation next to time. It is deterministic where");
    Console.WriteLine("   time is not, and it is frequently the whole answer.");
    Console.WriteLine();

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long ParseWithSubstring(string line)
    {
        string[] fields = line.Split(',');
        return long.Parse(fields[2], System.Globalization.CultureInfo.InvariantCulture);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long ParseWithSpan(string line)
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
// 4. A real 10x on 2% of the work.
// ---------------------------------------------------------------------------
static void WrongScope()
{
    Console.WriteLine("4. A genuine speed-up that changes nothing");
    Console.WriteLine();

    const string line = "INV-2026-0004821,GBP,123450,2026-03-14";

    double parseOld = Measure(() => SlowParse(line));
    double parseNew = Measure(() => FastParse(line));

    // The parse is one step in a request that also does I/O.
    const double ioMicroseconds = 8_000;      // an 8 ms database call
    double requestOld = ioMicroseconds + parseOld / 1_000;
    double requestNew = ioMicroseconds + parseNew / 1_000;

    Console.WriteLine($"      parse, before        : {parseOld,8:F0} ns");
    Console.WriteLine($"      parse, after         : {parseNew,8:F0} ns");
    Console.WriteLine($"      microbenchmark says  : {parseOld / parseNew,8:F1}x faster");
    Console.WriteLine();
    Console.WriteLine($"      whole request before : {requestOld,8:F1} us  (8 ms of I/O plus the parse)");
    Console.WriteLine($"      whole request after  : {requestNew,8:F1} us");
    Console.WriteLine($"      end to end           : {requestOld / requestNew,8:F3}x faster");
    Console.WriteLine();
    Console.WriteLine($"      share of the request the parse represents: " +
        $"{100 * (parseOld / 1_000) / requestOld:F3}%");
    Console.WriteLine();
    Console.WriteLine("   The speed-up is real, reproducible, and worth essentially nothing,");
    Console.WriteLine("   because the parse was a rounding error inside a request dominated");
    Console.WriteLine("   by a database call.");
    Console.WriteLine();
    Console.WriteLine("   This is Amdahl's law stated as a benchmark result: improving a");
    Console.WriteLine("   component by any factor at all cannot improve the whole by more");
    Console.WriteLine("   than that component's share of the total.");
    Console.WriteLine();
    Console.WriteLine("   A microbenchmark cannot tell you the share. It measures one thing");
    Console.WriteLine("   in isolation and reports a ratio, and the ratio is meaningless");
    Console.WriteLine("   without knowing what fraction of the system that thing is.");
    Console.WriteLine();
    Console.WriteLine("   Profile FIRST to find where the time goes. Benchmark SECOND to");
    Console.WriteLine("   compare two ways of doing the part that matters. Doing it the");
    Console.WriteLine("   other way round produces a folder full of true and useless facts.");

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
// A compact version of the harness from 02, so this file stands alone.
// ---------------------------------------------------------------------------
static double Measure(Func<long> body)
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
        if (probe.ElapsedMilliseconds >= 30)
        {
            break;
        }

        iterations *= 4;
    }

    var samples = new double[11];
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
    return samples[samples.Length / 2];      // median, not mean
}

static long MeasureAllocation(Func<long> body)
{
    const int count = 100_000;

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
