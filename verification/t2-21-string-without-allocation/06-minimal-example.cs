// 06-minimal-example.cs — A string is UTF-16 and immutable. Every operation
// that looks like a mutation produces a second one.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

using System.Globalization;
using System.Text.Unicode;

const string Header = "x-tenant";
const int Iterations = 500_000;

// "GBP" is three characters and costs 32 bytes: 22 of overhead plus 2 per
// character, rounded up to a multiple of 8.
Console.WriteLine($"\"GBP\" as a string : {32} bytes on the heap");
Console.WriteLine($"\"GBP\"u8           : {"GBP"u8.Length} bytes, and no allocation at all");
Console.WriteLine();

Console.WriteLine("Comparing a header name, two ways:");
Console.WriteLine();
Measure("  ToUpper() ==                  ", static () =>
    Header.ToUpper() == "X-TENANT");
Measure("  Equals(OrdinalIgnoreCase)     ", static () =>
    string.Equals(Header, "x-tenant", StringComparison.OrdinalIgnoreCase));

Console.WriteLine();
Console.WriteLine("The first allocates a string per call to throw it away - and is also");
Console.WriteLine("wrong in Turkish, where uppercasing 'i' does not produce 'I'.");
Console.WriteLine();

Console.WriteLine("Writing a response body, two ways:");
Console.WriteLine();
MeasureBytes("  string, then GetBytes         ", static () =>
{
    string json = string.Create(CultureInfo.InvariantCulture, $"{{\"id\":{4000821}}}");
    return System.Text.Encoding.UTF8.GetBytes(json).Length;
});
MeasureBytes("  Utf8.TryWrite into the stack  ", static () =>
{
    Span<byte> buffer = stackalloc byte[32];
    Utf8.TryWrite(buffer, CultureInfo.InvariantCulture, $"{{\"id\":{4000821}}}", out int written);
    return written;
});

Console.WriteLine();
Console.WriteLine("The second never creates a UTF-16 string at all. It does not reach zero,");
Console.WriteLine("because the value-type hole is boxed by the handler on this runtime -");
Console.WriteLine("measured at 24 bytes for a long. Removing that last 24 needs");
Console.WriteLine("Utf8Formatter called directly, and three times the code.");

static void Measure(string label, Func<bool> body)
{
    for (int i = 0; i < 1_000; i++)
    {
        body();
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);

    bool last = false;
    for (int i = 0; i < Iterations; i++)
    {
        last = body();
    }

    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;
    Console.WriteLine($"{label} {allocated,12:N0} B   ({allocated / (double)Iterations,4:F0} B per call, result {last})");
}

static void MeasureBytes(string label, Func<int> body)
{
    for (int i = 0; i < 1_000; i++)
    {
        body();
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);

    long sink = 0;
    for (int i = 0; i < Iterations; i++)
    {
        sink += body();
    }

    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;
    Console.WriteLine($"{label} {allocated,12:N0} B   ({allocated / (double)Iterations,4:F0} B per call, sink {sink})");
}
