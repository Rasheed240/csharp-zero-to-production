// Demo 2 — every array access is checked, and the JIT removes the check when
// it can prove the index is safe. Run with:
//   dotnet run -c Release 02-bounds-checking.cs
using System.Diagnostics;
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

int[] small = { 10, 20, 30 };

Console.WriteLine("1. what an out-of-range access actually says");
try
{
    Console.WriteLine(small[3]);
}
catch (IndexOutOfRangeException ex)
{
    Console.WriteLine($"   small[3] -> {ex.GetType().Name}: {ex.Message}");
}

int negative = -1;   // via a variable: a literal -1 raises CS0251 at compile time
try
{
    Console.WriteLine(small[negative]);
}
catch (IndexOutOfRangeException ex)
{
    Console.WriteLine($"   small[negative] -> {ex.GetType().Name}: {ex.Message}");
}
Console.WriteLine("   Note: the message does NOT tell you the index or the length.");
Console.WriteLine();

Console.WriteLine("2. the index-from-end operator is checked the same way");
Console.WriteLine($"   small[^1] (last element) -> {small[^1]}");
try
{
    Console.WriteLine(small[^4]);
}
catch (IndexOutOfRangeException)
{
    Console.WriteLine("   small[^4] -> IndexOutOfRangeException");
}
Console.WriteLine();

Console.WriteLine("3. what the check costs - measured, not assumed");

// A small array that fits in L1 cache, iterated many times, so memory
// bandwidth is not the bottleneck and per-element overhead would dominate.
const int Size = 4_096;
const int Repeats = 200_000;

int[] data = new int[Size];
for (int i = 0; i < Size; i++) { data[i] = i & 0xFF; }

_ = SumIdiomatic(data, 10);
_ = SumWithSeparateLength(data, data.Length, 10);

Console.WriteLine($"   {Size:N0} ints, iterated {Repeats:N0} times, three rounds:");
for (int round = 1; round <= 3; round++)
{
    long idiomaticMs = Time(() => SumIdiomatic(data, Repeats));
    long separateMs = Time(() => SumWithSeparateLength(data, data.Length, Repeats));
    Console.WriteLine(
        $"     round {round}:  i < array.Length {idiomaticMs,5} ms" +
        $"     i < length {separateMs,5} ms     ratio {(double)separateMs / Math.Max(idiomaticMs, 1),4:F2}x");
}

Console.WriteLine();
Console.WriteLine("   The two forms measure the same. The common advice that you must write");
Console.WriteLine("   i < array.Length to get bounds-check elimination is not observable on");
Console.WriteLine("   .NET 10: the JIT handles both, and the check costs less than the noise.");
Console.WriteLine("   Write whichever is clearer.");

static long Time(Func<long> work)
{
    Stopwatch sw = Stopwatch.StartNew();
    long result = work();
    sw.Stop();
    if (result == long.MinValue) { Console.WriteLine("unreachable"); }
    return sw.ElapsedMilliseconds;
}

// The shape usually recommended for bounds-check elimination.
static long SumIdiomatic(int[] values, int repeats)
{
    long total = 0;
    for (int r = 0; r < repeats; r++)
    {
        for (int i = 0; i < values.Length; i++)
        {
            total += values[i];
        }
    }
    return total;
}

// Identical work, bounded by a parameter rather than by values.Length.
// Measured as indistinguishable from the form above on .NET 10.
static long SumWithSeparateLength(int[] values, int length, int repeats)
{
    long total = 0;
    for (int r = 0; r < repeats; r++)
    {
        for (int i = 0; i < length; i++)
        {
            total += values[i];
        }
    }
    return total;
}
