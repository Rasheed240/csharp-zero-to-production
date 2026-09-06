// 06-minimal-example.cs — A Span is a view, not a copy. That one sentence is
// the whole type.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

const string line = "INV-2026-0004821GBP0000001234502026-03-14";
const int iterations = 200_000;

// A view mutates what it looks at.
int[] numbers = { 10, 20, 30, 40, 50 };
numbers.AsSpan(1, 3)[0] = 999;
Console.WriteLine($"array after writing through a span: [{string.Join(", ", numbers)}]");
Console.WriteLine();

// A copy allocates. A view does not.
Console.WriteLine($"{iterations:N0} lines, four fields each:");
Console.WriteLine($"  Substring : {Measure(UseSubstring),12:N0} bytes");
Console.WriteLine($"  Slice     : {Measure(UseSlice),12:N0} bytes");
Console.WriteLine();
Console.WriteLine("Same fields, same answers, no copies.");

static long Measure(Func<long> body)
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);
    long checksum = body();
    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

    // Returned so the loop cannot be optimised away, then discarded.
    _ = checksum;
    return allocated;
}

static long UseSubstring()
{
    long total = 0;
    for (int i = 0; i < iterations; i++)
    {
        string currency = line.Substring(16, 3);
        string amount = line.Substring(19, 13);
        total += currency.Length + long.Parse(amount);
    }
    return total;
}

static long UseSlice()
{
    long total = 0;
    for (int i = 0; i < iterations; i++)
    {
        ReadOnlySpan<char> currency = line.AsSpan(16, 3);
        ReadOnlySpan<char> amount = line.AsSpan(19, 13);
        total += currency.Length + long.Parse(amount);
    }
    return total;
}
