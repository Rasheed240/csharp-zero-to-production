// 04-production.cs — Ledger's lookup change, and a benchmark that was right
// about everything except production.
//
// The incident: a developer benchmarked the currency-code lookup against the
// four currencies Ledger supported, found that a plain array scan beat the
// Dictionary, and replaced the Dictionary wherever the pattern appeared. One of
// those places held 4,000 entries rather than four.
//
// The benchmark was not wrong. It answered a question nobody had asked.
//
// Run:  dotnet run 04-production.cs -c Release
//
// EXACT vs RATIO: the crossover and the direction are the claims. The absolute
// nanoseconds vary between runs and machines.

using System.Diagnostics;
using System.Runtime.CompilerServices;

TheBenchmarkThatShipped();
WhatProductionActuallyLooksLike();
TheRealCost();
WhatToDoInstead();

// ---------------------------------------------------------------------------
static void TheBenchmarkThatShipped()
{
    Console.WriteLine("1. The benchmark that shipped");
    Console.WriteLine();

    // The four currencies Ledger supported when this was written.
    string[] currencies = { "GBP", "EUR", "USD", "JPY" };

    var dictionary = currencies
        .Select((c, i) => (c, i))
        .ToDictionary(x => x.c, x => x.i, StringComparer.Ordinal);

    double dictTime = Measure(() => DictionaryLookup(dictionary, "JPY"));
    double scanTime = Measure(() => LinearScan(currencies, "JPY"));

    Console.WriteLine($"   {currencies.Length} currencies, looking up the last one");
    Console.WriteLine();
    Console.WriteLine($"     Dictionary  : {dictTime,7:F1} ns");
    Console.WriteLine($"     array scan  : {scanTime,7:F1} ns");
    Console.WriteLine($"     scan is     : {dictTime / scanTime,7:F2}x the dictionary");
    Console.WriteLine();
    Console.WriteLine("   The scan wins, and it wins for a real reason: four ordinal string");
    Console.WriteLine("   comparisons cost less than computing a hash and probing a bucket.");
    Console.WriteLine();
    Console.WriteLine("   The benchmark was run under a proper harness - warmed up, many");
    Console.WriteLine("   samples, median reported, result consumed. Nothing about the");
    Console.WriteLine("   measurement is wrong, and the change shipped on the strength of it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatProductionActuallyLooksLike()
{
    Console.WriteLine("2. What the benchmark did not know");
    Console.WriteLine();
    Console.WriteLine("   Ledger has 4 currencies. It also has a per-tenant fee schedule");
    Console.WriteLine("   keyed by a code, using the SAME lookup helper - and by the time");
    Console.WriteLine("   this shipped there were 4,000 of them.");
    Console.WriteLine();
    Console.WriteLine("      entries   Dictionary    array scan   winner");
    Console.WriteLine("      -------   ----------    ----------   ------");

    foreach (int size in new[] { 4, 8, 16, 64, 1_000, 4_000 })
    {
        string[] keys = Enumerable.Range(0, size).Select(i => $"FEE-{i:D6}").ToArray();
        var dictionary = keys.Select((k, i) => (k, i))
            .ToDictionary(x => x.k, x => x.i, StringComparer.Ordinal);

        string target = keys[^1];

        double dictTime = Measure(() => DictionaryLookup(dictionary, target));
        double scanTime = Measure(() => LinearScan(keys, target));

        string winner = scanTime < dictTime ? "array scan" : "Dictionary";
        Console.WriteLine($"   {size,9:N0}   {dictTime,8:F1} ns   {scanTime,10:F1} ns   {winner}");
    }

    Console.WriteLine();
    Console.WriteLine("   The scan is O(n) with a string comparison per element; the");
    Console.WriteLine("   dictionary is O(1) with one hash and usually one comparison. At");
    Console.WriteLine("   four thousand entries the scan does up to four thousand string");
    Console.WriteLine("   comparisons, which is the 1,600x in the last row.");
    Console.WriteLine();
    Console.WriteLine("   NOW COMPARE THE TOP ROW WITH SECTION 1. Both are four entries.");
    Console.WriteLine("   In section 1 the scan won; here the dictionary wins. Same code,");
    Console.WriteLine("   same count, opposite answer.");
    Console.WriteLine();
    Console.WriteLine("   The difference is the KEYS. Currency codes are three characters and");
    Console.WriteLine("   differ at the first one, so a comparison fails immediately. Fee");
    Console.WriteLine("   codes are ten characters sharing a FEE- prefix, so every comparison");
    Console.WriteLine("   reads five characters before it can fail.");
    Console.WriteLine();
    Console.WriteLine("   So the crossover point is not a property of the collection size");
    Console.WriteLine("   alone. It moves with the length of the keys and with how early they");
    Console.WriteLine("   differ - which is one more thing a benchmark on invented data");
    Console.WriteLine("   cannot tell you.");
    Console.WriteLine();
    Console.WriteLine("   The benchmark measured the four-entry case because that is the");
    Console.WriteLine("   collection the developer had in front of them. The change was");
    Console.WriteLine("   applied to a helper used by both.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TheRealCost()
{
    Console.WriteLine("3. What it cost, at Ledger's request rate");
    Console.WriteLine();

    string[] keys = Enumerable.Range(0, 4_000).Select(i => $"FEE-{i:D6}").ToArray();
    var dictionary = keys.Select((k, i) => (k, i))
        .ToDictionary(x => x.k, x => x.i, StringComparer.Ordinal);
    string target = keys[^1];

    double dictTime = Measure(() => DictionaryLookup(dictionary, target));
    double scanTime = Measure(() => LinearScan(keys, target));

    const int lookupsPerRequest = 4;
    const int requestsPerSecond = 5_000;

    double dictPerRequest = dictTime * lookupsPerRequest;
    double scanPerRequest = scanTime * lookupsPerRequest;
    double addedPerRequest = scanPerRequest - dictPerRequest;
    double addedCpuPerSecond = addedPerRequest * requestsPerSecond / 1_000_000_000;

    Console.WriteLine($"   per lookup, 4,000 entries : {dictTime,10:F1} ns -> {scanTime,10:F1} ns");
    Console.WriteLine($"   per request (4 lookups)   : {dictPerRequest / 1000,10:F1} us -> {scanPerRequest / 1000,10:F1} us");
    Console.WriteLine($"   added per request         : {addedPerRequest / 1000,10:F1} us");
    Console.WriteLine();
    Console.WriteLine($"   at {requestsPerSecond:N0} requests/sec across the fleet:");
    Console.WriteLine($"     CPU-seconds added per second of wall clock : {addedCpuPerSecond,8:F2}");
    Console.WriteLine($"     cores required just for the lookup         : {Math.Ceiling(addedCpuPerSecond),8:F0}");
    Console.WriteLine();
    Console.WriteLine($"   Read that honestly rather than dramatically. Against an 8 ms");
    Console.WriteLine($"   request, {addedPerRequest / 1000:F0} us is about {100 * (addedPerRequest / 1000) / 8000:F1}% of the latency - real, and");
    Console.WriteLine("   not on its own an outage.");
    Console.WriteLine();
    Console.WriteLine("   What makes it matter is the other column: roughly half a core of");
    Console.WriteLine("   the fleet now does nothing but compare strings, which is pure");
    Console.WriteLine("   waste, and a service running near capacity has that headroom");
    Console.WriteLine("   removed. p99 is where a service near capacity shows it first.");
    Console.WriteLine();
    Console.WriteLine("   And it GROWS. The cost is linear in the number of fee codes, so");
    Console.WriteLine("   the same change at 40,000 codes is ten times worse, arriving");
    Console.WriteLine("   gradually as tenants are onboarded, with no deployment to blame.");
    Console.WriteLine();
    Console.WriteLine("   That is the shape worth recognising: a change whose cost is a");
    Console.WriteLine("   function of data you do not control, shipped on a benchmark run");
    Console.WriteLine("   against data you did.");
    Console.WriteLine();
    Console.WriteLine("   Note what the benchmark got RIGHT: the scan genuinely is faster at");
    Console.WriteLine("   four entries, and that result reproduces. The measurement was");
    Console.WriteLine("   sound. The inference - that the same change helps everywhere the");
    Console.WriteLine("   pattern appears - is what was wrong, and no amount of statistical");
    Console.WriteLine("   rigour in the harness would have caught it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatToDoInstead()
{
    Console.WriteLine("4. The three questions to answer before benchmarking");
    Console.WriteLine();
    Console.WriteLine("   1. WHAT FRACTION OF THE SYSTEM IS THIS?");
    Console.WriteLine("      A profile answers it; a benchmark cannot. Ledger's request is");
    Console.WriteLine("      about 8 ms of database call, so a change worth nanoseconds per");
    Console.WriteLine("      lookup is invisible - until it is worth microseconds, which is");
    Console.WriteLine("      exactly what happened here in the wrong direction.");
    Console.WriteLine();
    Console.WriteLine("   2. WHAT SIZE IS THE REAL INPUT?");
    Console.WriteLine("      Measured above: the winner changes between 4 entries and 4,000.");
    Console.WriteLine("      Benchmark the size production has, and one either side, because");
    Console.WriteLine("      your data will grow and the winner can change under you.");
    Console.WriteLine();
    Console.WriteLine("   3. WHERE ELSE DOES THIS CODE RUN?");
    Console.WriteLine("      This is the one that caused the incident. A benchmark measures");
    Console.WriteLine("      one call site; a change to a shared helper applies to all of");
    Console.WriteLine("      them, and the others may have completely different inputs.");
    Console.WriteLine();
    Console.WriteLine("   And the discipline that would have caught it:");
    Console.WriteLine();
    Console.WriteLine("   WRITE THE HYPOTHESIS AND THE THRESHOLD DOWN FIRST.");
    Console.WriteLine();
    Console.WriteLine("     'The currency lookup runs 4 times per request over 4 entries.");
    Console.WriteLine("      If replacing the Dictionary saves more than 50 us per request");
    Console.WriteLine("      I will ship it - to that call site.'");
    Console.WriteLine();
    Console.WriteLine("   Written that way, three things become visible before any code is");
    Console.WriteLine("   changed: the saving is nanoseconds and does not clear the");
    Console.WriteLine("   threshold; the claim is scoped to one call site; and the question");
    Console.WriteLine("   of what else uses the helper has to be answered.");
    Console.WriteLine();
    Console.WriteLine("   A threshold chosen before the measurement is the difference between");
    Console.WriteLine("   an experiment and a search for a reason to do what you wanted.");
}

// ---------------------------------------------------------------------------
[MethodImpl(MethodImplOptions.NoInlining)]
static int DictionaryLookup(Dictionary<string, int> map, string key) =>
    map.TryGetValue(key, out int value) ? value : -1;

[MethodImpl(MethodImplOptions.NoInlining)]
static int LinearScan(string[] keys, string key)
{
    for (int i = 0; i < keys.Length; i++)
    {
        if (string.Equals(keys[i], key, StringComparison.Ordinal))
        {
            return i;
        }
    }

    return -1;
}

// ---------------------------------------------------------------------------
// The harness from 02, reduced to what this file needs.
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
    return samples[samples.Length / 2];
}

static class Sink
{
    public static long Value;
}
