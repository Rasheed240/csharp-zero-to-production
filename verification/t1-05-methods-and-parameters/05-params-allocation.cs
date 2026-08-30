// Demo 5 — every params call builds an array. Measured, and then avoided.
//   dotnet run -c Release 05-params-allocation.cs
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

const int Calls = 1_000_000;

// Warm up so JIT compilation is not counted as allocation.
_ = SumParams(1, 2, 3);
_ = SumSpan(1, 2, 3);
_ = SumThree(1, 2, 3);
_ = Describe("a", 1, 2.0);

Console.WriteLine($"{Calls:N0} calls of each shape:");
Console.WriteLine();

Measure("params int[]        ", () =>
{
    long total = 0;
    for (int i = 0; i < Calls; i++) { total += SumParams(1, 2, 3); }
    return total;
});

Measure("params ReadOnlySpan ", () =>
{
    long total = 0;
    for (int i = 0; i < Calls; i++) { total += SumSpan(1, 2, 3); }
    return total;
});

Measure("three fixed args    ", () =>
{
    long total = 0;
    for (int i = 0; i < Calls; i++) { total += SumThree(1, 2, 3); }
    return total;
});

Console.WriteLine();
Console.WriteLine("the same shape with boxing, which is what structured logging does:");
Measure("params object[]     ", () =>
{
    long total = 0;
    for (int i = 0; i < Calls; i++) { total += Describe("a", 1, 2.0).Length; }
    return total;
});

Console.WriteLine();
Console.WriteLine("an empty params call still allocates nothing in modern .NET:");
Measure("params int[], zero  ", () =>
{
    long total = 0;
    for (int i = 0; i < Calls; i++) { total += SumParams(); }
    return total;
});

static void Measure(string label, Func<long> work)
{
    long before = GC.GetAllocatedBytesForCurrentThread();
    long result = work();
    long after = GC.GetAllocatedBytesForCurrentThread();

    double bytesPerCall = (after - before) / (double)Calls;
    Console.WriteLine(
        $"  {label} {(after - before) / 1024.0 / 1024.0,8:F1} MB total  " +
        $"{bytesPerCall,6:F1} bytes/call  (checksum {result})");
}

static long SumParams(params int[] values)
{
    long total = 0;
    foreach (int value in values) { total += value; }
    return total;
}

// C# 13 (.NET 9+) allows params on a span, which the compiler can satisfy from
// the stack instead of the heap.
static long SumSpan(params ReadOnlySpan<int> values)
{
    long total = 0;
    foreach (int value in values) { total += value; }
    return total;
}

static long SumThree(int a, int b, int c) => a + b + c;

static string Describe(params object[] parts) => parts.Length.ToString(CultureInfo.InvariantCulture);
