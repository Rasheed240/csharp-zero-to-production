// Demo 6 — the same work, the same number of branches, the same data.
// Only the ORDER differs. Run with:
//   dotnet run -c Release 06-branch-prediction.cs
using System.Diagnostics;
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

const int Size = 32_768;
const int Repeats = 2_000;

int[] unsorted = new int[Size];
Random random = new Random(42);
for (int i = 0; i < Size; i++)
{
    unsorted[i] = random.Next(256);
}

int[] sorted = (int[])unsorted.Clone();
Array.Sort(sorted);

// Warm up so the JIT has compiled everything before we time anything.
_ = SumAboveThreshold(unsorted, 10);
_ = SumAboveThreshold(sorted, 10);

long unsortedMs = Time(() => SumAboveThreshold(unsorted, Repeats));
long sortedMs = Time(() => SumAboveThreshold(sorted, Repeats));

Console.WriteLine($"array of {Size:N0} values, summed {Repeats:N0} times");
Console.WriteLine();
Console.WriteLine($"  unsorted data : {unsortedMs,6} ms");
Console.WriteLine($"  sorted data   : {sortedMs,6} ms");
Console.WriteLine($"  ratio         : {(double)unsortedMs / Math.Max(sortedMs, 1),6:F1}x");
Console.WriteLine();

// The branchless version does the same arithmetic with no unpredictable jump.
long branchlessMs = Time(() => SumAboveThresholdBranchless(unsorted, Repeats));
Console.WriteLine($"  unsorted, branchless : {branchlessMs,6} ms");
Console.WriteLine();
Console.WriteLine("Identical inputs, identical output, identical instruction count.");
Console.WriteLine("The difference is whether the processor can guess which way the");
Console.WriteLine("if went last time.");

static long Time(Func<long> work)
{
    Stopwatch sw = Stopwatch.StartNew();
    long result = work();
    sw.Stop();
    // Returned through a discard so the compiler cannot delete the work.
    if (result == long.MinValue)
    {
        Console.WriteLine("unreachable");
    }
    return sw.ElapsedMilliseconds;
}

static long SumAboveThreshold(int[] values, int repeats)
{
    long total = 0;
    for (int r = 0; r < repeats; r++)
    {
        for (int i = 0; i < values.Length; i++)
        {
            if (values[i] >= 128)
            {
                total += values[i];
            }
        }
    }
    return total;
}

static long SumAboveThresholdBranchless(int[] values, int repeats)
{
    long total = 0;
    for (int r = 0; r < repeats; r++)
    {
        for (int i = 0; i < values.Length; i++)
        {
            // (value - 128) >> 31 is 0 when value >= 128 and -1 otherwise.
            // ~mask is then -1 (all bits set) when we want to add, 0 when not.
            int value = values[i];
            int mask = ~((value - 128) >> 31);
            total += value & mask;
        }
    }
    return total;
}
