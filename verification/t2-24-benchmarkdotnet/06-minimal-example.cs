// 06-minimal-example.cs — The same code measured three ways, giving three
// different answers. Two of them are wrong.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

using System.Diagnostics;
using System.Runtime.CompilerServices;

const string Line = "INV-2026-0004821,GBP,123450";

Console.WriteLine("Measuring the same method three ways:");
Console.WriteLine();

// 1. WRONG: cold, and the result is discarded.
var cold = Stopwatch.StartNew();
for (int i = 0; i < 1_000; i++)
{
    Parse(Line);
}

cold.Stop();
Console.WriteLine($"  cold, result discarded : {cold.Elapsed.TotalMilliseconds * 1_000_000 / 1_000,7:F1} ns per call");

// 2. WRONG: warmed up, but the result is still discarded.
for (int i = 0; i < 200_000; i++)
{
    Parse(Line);
}

var warm = Stopwatch.StartNew();
for (int i = 0; i < 1_000; i++)
{
    Parse(Line);
}

warm.Stop();
Console.WriteLine($"  warm, result discarded : {warm.Elapsed.TotalMilliseconds * 1_000_000 / 1_000,7:F1} ns per call");

// 3. RIGHT: warmed up, result consumed, many samples, median reported.
long sink = 0;
var samples = new double[11];
for (int s = 0; s < samples.Length; s++)
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    var sw = Stopwatch.StartNew();
    for (int i = 0; i < 100_000; i++)
    {
        sink += Parse(Line);
    }

    sw.Stop();
    samples[s] = sw.Elapsed.TotalMilliseconds * 1_000_000 / 100_000;
}

Array.Sort(samples);
Console.WriteLine($"  warm, consumed, median : {samples[samples.Length / 2],7:F1} ns per call");
Console.WriteLine($"                   range : {samples[0],7:F1} to {samples[^1]:F1} ns");

// And the number that does not move at all.
GC.Collect();
GC.WaitForPendingFinalizers();
GC.Collect();
long before = GC.GetTotalAllocatedBytes(precise: true);
for (int i = 0; i < 100_000; i++)
{
    sink += Parse(Line);
}

long perOp = (GC.GetTotalAllocatedBytes(precise: true) - before) / 100_000;

Console.WriteLine();
Console.WriteLine($"  allocation per call    : {perOp} bytes, on every run, on every machine");
Console.WriteLine($"  (sink {sink})");
Console.WriteLine();
Console.WriteLine("The first number is wrong by more than an order of magnitude: it");
Console.WriteLine("measures tier 0 code plus the JIT compiling the method.");
Console.WriteLine();
Console.WriteLine("The second is close to the third, which is worth understanding rather");
Console.WriteLine("than assuming. Discarding the result did NOT let the JIT delete the");
Console.WriteLine("work here, because Split allocates an array - an observable side effect");
Console.WriteLine("the compiler cannot remove.");
Console.WriteLine();
Console.WriteLine("Dead-code elimination bites on PURE, allocation-free code. On a method");
Console.WriteLine("that allocates you get away with it, and on a method that does");
Console.WriteLine("arithmetic you do not - which is exactly the kind of code people");
Console.WriteLine("microbenchmark. Consume the result anyway; it costs nothing.");
Console.WriteLine();
Console.WriteLine("The third is defensible, and it still moves between runs - which is why");
Console.WriteLine("the range matters as much as the median.");
Console.WriteLine();
Console.WriteLine("The allocation figure is exact and identical every time. When the two");
Console.WriteLine("disagree about whether a change is worth making, that is the column to");
Console.WriteLine("argue from and the one to assert on in a test.");

[MethodImpl(MethodImplOptions.NoInlining)]
static long Parse(string line)
{
    string[] fields = line.Split(',');
    return long.Parse(fields[2], System.Globalization.CultureInfo.InvariantCulture);
}
