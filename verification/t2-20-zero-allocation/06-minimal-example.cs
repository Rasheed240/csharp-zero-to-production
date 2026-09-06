// 06-minimal-example.cs — Zero allocation is not the same as fast, and a pool
// applied to the wrong size makes things worse.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

using System.Buffers;
using System.Diagnostics;

const int Iterations = 500_000;

Console.WriteLine("Filling a 64-byte buffer, three ways:");
Console.WriteLine();
Console.WriteLine("   strategy            allocated    per call    time");
Console.WriteLine("   --------            ---------    --------    ----");

Measure("new byte[64]     ", static () =>
{
    var buffer = new byte[64];
    buffer[0] = 1;
    return buffer[0];
});

Measure("ArrayPool rent   ", static () =>
{
    byte[] buffer = ArrayPool<byte>.Shared.Rent(64);
    buffer[0] = 1;
    byte result = buffer[0];
    ArrayPool<byte>.Shared.Return(buffer);
    return result;
});

Measure("stackalloc       ", static () =>
{
    Span<byte> buffer = stackalloc byte[64];
    buffer[0] = 1;
    return buffer[0];
});

Console.WriteLine();
Console.WriteLine("The pool allocates nothing and is the SLOWEST of the three, on every");
Console.WriteLine("run. Rent and Return do more bookkeeping than a 64-byte allocation");
Console.WriteLine("costs, and a gen 0 allocation is close to a pointer bump.");
Console.WriteLine();
Console.WriteLine("stackalloc allocates nothing and matches the plain allocation on time -");
Console.WriteLine("it is not dramatically faster, and this file does not claim it is. What");
Console.WriteLine("it removes is 88 bytes per call of pressure on the collector, which is");
Console.WriteLine("paid by whatever else is running in the process.");
Console.WriteLine();
Console.WriteLine("The lesson is the middle row: zero allocation is not the same as fast.");

static void Measure(string label, Func<byte> body)
{
    for (int i = 0; i < 10_000; i++)
    {
        body();
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    long sink = 0;
    for (int i = 0; i < Iterations; i++)
    {
        sink += body();
    }

    sw.Stop();
    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

    Console.WriteLine($"   {label}   {allocated,10:N0} B   {allocated / (double)Iterations,6:F0} B   " +
        $"{sw.Elapsed.TotalMilliseconds,5:F0} ms   (sink {sink})");
}
