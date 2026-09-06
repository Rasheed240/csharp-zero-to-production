// 05-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 05-exercises.cs -c Release

#:property AllowUnsafeBlocks=true

using System.Buffers;
using System.Diagnostics;
using System.Globalization;

Exercise1();
Exercise2();
Exercise3();
Exercise4();
Exercise5();
Exercise6();

// ---------------------------------------------------------------------------
// 1. EASY — Span vs array copy: which of these allocates?
// ---------------------------------------------------------------------------
static void Exercise1()
{
    Console.WriteLine("Exercise 1: which of these allocate?");
    Console.WriteLine();

    var source = new int[1_000];
    const int iterations = 100_000;

    Measure("array[..] via ToArray()   ", () => { _ = source[..100].Length; });
    Measure("AsSpan().Slice()          ", () => { _ = source.AsSpan(0, 100).Length; });
    Measure("AsSpan().ToArray()        ", () => { _ = source.AsSpan(0, 100).ToArray().Length; });
    Measure("string.Substring(0, 10)   ", () => { _ = "0123456789abcdef".Substring(0, 10).Length; });
    Measure("string.AsSpan(0, 10)      ", () => { _ = "0123456789abcdef".AsSpan(0, 10).Length; });

    Console.WriteLine();
    Console.WriteLine("   The trap is the first line. Range syntax on an ARRAY calls");
    Console.WriteLine("   GetSubArray, which COPIES. Range syntax on a SPAN slices, which");
    Console.WriteLine("   does not. They look identical at the call site.");
    Console.WriteLine();
    Console.WriteLine("     array[..100]            copies 100 ints");
    Console.WriteLine("     array.AsSpan()[..100]   copies nothing");
    Console.WriteLine();

    static void Measure(string label, Action body)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < iterations; i++)
        {
            body();
        }

        long total = GC.GetTotalAllocatedBytes(precise: true) - before;
        Console.WriteLine($"   {label} {total,12:N0} B   ({total / (double)iterations,6:F1} B per call)");
    }
}

// ---------------------------------------------------------------------------
// 2. EASY — stackalloc, and the loop that overflows the stack.
// ---------------------------------------------------------------------------
static void Exercise2()
{
    Console.WriteLine("Exercise 2: stackalloc, and where it goes wrong");
    Console.WriteLine();

    // Safe: fixed, small, outside a loop.
    Span<byte> small = stackalloc byte[256];
    small[0] = 1;
    Console.WriteLine($"   stackalloc byte[256]     : fine, {small.Length} bytes on the stack");
    Console.WriteLine();

    Console.WriteLine("   The two rules, and why:");
    Console.WriteLine();
    Console.WriteLine("   RULE 1: never stackalloc a size that comes from input.");
    Console.WriteLine("     var buffer = stackalloc byte[request.Length];");
    Console.WriteLine("     A 2 MB request overflows the 1 MB default thread stack, and a");
    Console.WriteLine("     stack overflow CANNOT BE CAUGHT. The process dies immediately,");
    Console.WriteLine("     with no exception, no finally blocks and no logging.");
    Console.WriteLine();
    Console.WriteLine("   RULE 2: never stackalloc inside a loop.");
    Console.WriteLine("     The allocation is not released at the end of the iteration - it");
    Console.WriteLine("     is released when the METHOD returns. A loop of 10,000 iterations");
    Console.WriteLine("     each taking 256 bytes needs 2.5 MB of stack.");
    Console.WriteLine();
    Console.WriteLine("   The safe pattern is a size threshold with a pooled fallback:");
    Console.WriteLine();

    foreach (int length in new[] { 64, 200, 5_000 })
    {
        Console.WriteLine($"     length {length,5} -> {DescribeStrategy(length)}");
    }

    Console.WriteLine();
    Console.WriteLine($"   checksum of the hybrid path: {ProcessHybrid(5_000)}");
    Console.WriteLine();

    static string DescribeStrategy(int length) =>
        length <= 256 ? "stackalloc (fixed ceiling)" : "ArrayPool rent";

    static long ProcessHybrid(int length)
    {
        // The standard shape. The constant is a ceiling on the STACK cost, so
        // it does not matter how large the input is.
        const int StackLimit = 256;

        byte[]? rented = null;
        Span<byte> buffer = length <= StackLimit
            ? stackalloc byte[StackLimit]
            : (rented = ArrayPool<byte>.Shared.Rent(length));

        try
        {
            buffer = buffer[..length];
            for (int i = 0; i < buffer.Length; i++)
            {
                buffer[i] = (byte)i;
            }

            long sum = 0;
            foreach (byte b in buffer)
            {
                sum += b;
            }

            return sum;
        }
        finally
        {
            if (rented is not null)
            {
                ArrayPool<byte>.Shared.Return(rented);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — splitting without allocating.
// ---------------------------------------------------------------------------
static void Exercise3()
{
    Console.WriteLine("Exercise 3: splitting a CSV line without allocating");
    Console.WriteLine();

    const string line = "INV-2026-0004821,GBP,123450,2026-03-14,CUSTOMER-000512";
    const int iterations = 200_000;

    // --- string.Split -------------------------------------------------------
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    long before = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    long splitTotal = 0;
    for (int i = 0; i < iterations; i++)
    {
        string[] fields = line.Split(',');
        splitTotal += long.Parse(fields[2], CultureInfo.InvariantCulture);
    }

    sw.Stop();
    double splitMs = sw.Elapsed.TotalMilliseconds;
    long splitBytes = GC.GetTotalAllocatedBytes(precise: true) - before;

    // --- span enumeration ---------------------------------------------------
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    before = GC.GetTotalAllocatedBytes(precise: true);
    sw.Restart();

    long spanTotal = 0;
    for (int i = 0; i < iterations; i++)
    {
        spanTotal += ThirdField(line);
    }

    sw.Stop();
    double spanMs = sw.Elapsed.TotalMilliseconds;
    long spanBytes = GC.GetTotalAllocatedBytes(precise: true) - before;

    Console.WriteLine($"   {iterations:N0} lines");
    Console.WriteLine();
    Console.WriteLine("   version           allocated      per line     time");
    Console.WriteLine($"   string.Split    {splitBytes,10:N0} B  {splitBytes / (double)iterations,8:F0} B   {splitMs,6:F0} ms");
    Console.WriteLine($"   span walk       {spanBytes,10:N0} B  {spanBytes / (double)iterations,8:F0} B   {spanMs,6:F0} ms");
    Console.WriteLine();
    Console.WriteLine($"   totals equal: {splitTotal == spanTotal}");
    Console.WriteLine();
    Console.WriteLine("   string.Split allocates the array AND every element. For a five");
    Console.WriteLine("   field line that is six objects to read one number.");
    Console.WriteLine();

    // Walk to the third comma-separated field without allocating anything.
    static long ThirdField(ReadOnlySpan<char> line)
    {
        int field = 0;
        while (true)
        {
            int comma = line.IndexOf(',');
            ReadOnlySpan<char> current = comma < 0 ? line : line[..comma];

            if (field == 2)
            {
                return long.Parse(current, CultureInfo.InvariantCulture);
            }

            if (comma < 0)
            {
                return 0;
            }

            line = line[(comma + 1)..];
            field++;
        }
    }
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — the aliasing bug: a span is a live view, not a snapshot.
// ---------------------------------------------------------------------------
static void Exercise4()
{
    Console.WriteLine("Exercise 4: a span is a live view, and that can surprise you");
    Console.WriteLine();

    var data = new[] { 1, 2, 3, 4, 5, 6 };
    Span<int> span = data;

    Console.WriteLine($"   before        : [{string.Join(", ", data)}]");

    // Overlapping copy. CopyTo handles overlap correctly (like memmove);
    // a hand-written forward loop would not.
    span[..3].CopyTo(span[1..4]);
    Console.WriteLine($"   after CopyTo  : [{string.Join(", ", data)}]");

    var data2 = new[] { 1, 2, 3, 4, 5, 6 };
    Span<int> span2 = data2;
    for (int i = 0; i < 3; i++)
    {
        span2[i + 1] = span2[i];
    }
    Console.WriteLine($"   after loop    : [{string.Join(", ", data2)}]");

    Console.WriteLine();
    Console.WriteLine("   Different answers from the same intent. The hand-written forward");
    Console.WriteLine("   loop reads values it has already overwritten; CopyTo detects the");
    Console.WriteLine("   overlap and copies in the safe direction.");
    Console.WriteLine();
    Console.WriteLine("   With arrays you would have written the copy loop over two separate");
    Console.WriteLine("   arrays and never noticed. Slices of one buffer can overlap, so");
    Console.WriteLine("   this becomes a real bug class. Use CopyTo, not a loop.");
    Console.WriteLine();

    // A second aliasing surprise: resizing the backing array detaches the span.
    var list = new List<int>(4) { 1, 2, 3 };
    Span<int> listSpan = System.Runtime.InteropServices.CollectionsMarshal.AsSpan(list);

    listSpan[0] = 100;
    Console.WriteLine($"   list capacity {list.Capacity}, after write through span : [{string.Join(", ", list)}]");

    // Adding within the existing capacity does NOT reallocate, so the span is
    // still a view over the live array. This is the case that lulls you.
    list.Add(4);
    listSpan[1] = 200;
    Console.WriteLine($"   after Add within capacity ({list.Capacity})      : [{string.Join(", ", list)}]   span still valid");

    // Now exceed the capacity. The list allocates a NEW array and copies into
    // it. The span still points at the old one.
    list.Add(5);
    listSpan[2] = 300;
    Console.WriteLine($"   after Add that resized to {list.Capacity}        : [{string.Join(", ", list)}]   span now stale");

    Console.WriteLine();
    Console.WriteLine("   Read those last two lines together, because the pair is the lesson.");
    Console.WriteLine("   The write of 200 landed on the list. The write of 300 did not - it");
    Console.WriteLine("   went to the array the list abandoned when it grew.");
    Console.WriteLine();
    Console.WriteLine("   Same code, same span variable, opposite outcomes, decided entirely");
    Console.WriteLine("   by whether an Add happened to cross the capacity boundary. There is");
    Console.WriteLine("   no error and no warning. Take the span AFTER all mutation, and do");
    Console.WriteLine("   not hold it across anything that can add to the list.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 5. HARD — writing a span-based API that cannot be misused.
// ---------------------------------------------------------------------------
static void Exercise5()
{
    Console.WriteLine("Exercise 5: three signatures for the same job");
    Console.WriteLine();

    var destination = new char[64];

    int written = FormatReference(1_234_567, destination);
    Console.WriteLine($"   TryFormat style : \"{new string(destination, 0, written)}\" ({written} chars)");

    if (TryFormatReference(1_234_567, destination, out int written2))
    {
        Console.WriteLine($"   Try... style    : \"{new string(destination, 0, written2)}\"");
    }

    Span<char> tooSmall = stackalloc char[4];
    bool ok = TryFormatReference(1_234_567, tooSmall, out _);
    Console.WriteLine($"   into a 4-char buffer: {ok} (no exception, no allocation)");

    Console.WriteLine();
    Console.WriteLine("   The BCL convention, and why it is worth copying:");
    Console.WriteLine();
    Console.WriteLine("     bool TryFormat(Span<char> destination, out int charsWritten)");
    Console.WriteLine();
    Console.WriteLine("   The caller owns the buffer, so the method cannot leak a view of");
    Console.WriteLine("   memory it does not own. The out parameter reports how much was");
    Console.WriteLine("   used, so the caller never has to trust destination.Length. And");
    Console.WriteLine("   too-small is a false return rather than an exception, because a");
    Console.WriteLine("   caller sizing a buffer will hit it routinely.");
    Console.WriteLine();
    Console.WriteLine("   What NOT to write: Span<char> Format(int value) - returning a span");
    Console.WriteLine("   forces the method to allocate something for it to point at, which");
    Console.WriteLine("   defeats the purpose, or to return a view of a pooled buffer, which");
    Console.WriteLine("   is the use-after-return bug from 03-memory-and-async.cs.");
    Console.WriteLine();

    static int FormatReference(long value, Span<char> destination)
    {
        "REF-".AsSpan().CopyTo(destination);
        value.TryFormat(destination[4..], out int digits, "D10", CultureInfo.InvariantCulture);
        return 4 + digits;
    }

    static bool TryFormatReference(long value, Span<char> destination, out int charsWritten)
    {
        charsWritten = 0;

        // Check BEFORE writing anything, so a failed call leaves the caller's
        // buffer untouched rather than half-written.
        if (destination.Length < 14)
        {
            return false;
        }

        "REF-".AsSpan().CopyTo(destination);
        if (!value.TryFormat(destination[4..], out int digits, "D10", CultureInfo.InvariantCulture))
        {
            return false;
        }

        charsWritten = 4 + digits;
        return true;
    }
}

// ---------------------------------------------------------------------------
// 6. HARD — when the span rewrite is NOT worth it.
// ---------------------------------------------------------------------------
static void Exercise6()
{
    Console.WriteLine("Exercise 6: when NOT to reach for a span");
    Console.WriteLine();

    const string line = "INV-2026-0004821,GBP,123450";
    const int iterations = 200_000;

    // Case A: the result must be a string anyway (it goes into a dictionary).
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    long before = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    var byInvoiceA = new Dictionary<string, long>(4);
    for (int i = 0; i < iterations; i++)
    {
        string invoice = line[..16];
        byInvoiceA[invoice] = i;
    }

    sw.Stop();
    double directMs = sw.Elapsed.TotalMilliseconds;
    long directBytes = GC.GetTotalAllocatedBytes(precise: true) - before;

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    before = GC.GetTotalAllocatedBytes(precise: true);
    sw.Restart();

    var byInvoiceB = new Dictionary<string, long>(4);
    for (int i = 0; i < iterations; i++)
    {
        ReadOnlySpan<char> invoice = line.AsSpan(0, 16);
        byInvoiceB[invoice.ToString()] = i;      // has to become a string anyway
    }

    sw.Stop();
    double viaSpanMs = sw.Elapsed.TotalMilliseconds;
    long viaSpanBytes = GC.GetTotalAllocatedBytes(precise: true) - before;

    Console.WriteLine("   The result has to be a string (it is a dictionary key):");
    Console.WriteLine();
    Console.WriteLine($"     direct Substring : {directBytes,10:N0} B   {directMs,6:F0} ms");
    Console.WriteLine($"     via span         : {viaSpanBytes,10:N0} B   {viaSpanMs,6:F0} ms");
    Console.WriteLine();
    Console.WriteLine("   Identical allocation, because ToString() allocates exactly what");
    Console.WriteLine("   Substring did. The span added a step and bought nothing.");
    Console.WriteLine();
    Console.WriteLine("   The three cases where a span rewrite does not pay:");
    Console.WriteLine();
    Console.WriteLine("     1. The value must become a string anyway - stored, returned in a");
    Console.WriteLine("        DTO, used as a dictionary key. Measured above: no saving.");
    Console.WriteLine("     2. The API you need has no span overload. Converting back to a");
    Console.WriteLine("        string to call it reintroduces the allocation you removed.");
    Console.WriteLine("     3. The code is not hot. A span rewrite is harder to read, cannot");
    Console.WriteLine("        be used in async or LINQ, and buys nothing off the hot path.");
    Console.WriteLine();
    Console.WriteLine("   For case 1 specifically, the alternative worth knowing is a lookup");
    Console.WriteLine("   that takes a span: dictionary.GetAlternateLookup<ReadOnlySpan<char>>()");
    Console.WriteLine("   in .NET 9+ lets you PROBE a Dictionary<string, T> with a span and");
    Console.WriteLine("   only allocate the string when you actually insert.");
    Console.WriteLine();

    var lookupDictionary = new Dictionary<string, long>(StringComparer.Ordinal);
    var lookup = lookupDictionary.GetAlternateLookup<ReadOnlySpan<char>>();

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    before = GC.GetTotalAllocatedBytes(precise: true);

    long hits = 0;
    lookupDictionary["INV-2026-0004821"] = 1;
    for (int i = 0; i < iterations; i++)
    {
        if (lookup.TryGetValue(line.AsSpan(0, 16), out long value))
        {
            hits += value;
        }
    }

    long lookupBytes = GC.GetTotalAllocatedBytes(precise: true) - before;
    Console.WriteLine($"     {iterations:N0} span probes into a Dictionary<string, long>:");
    Console.WriteLine($"     allocated : {lookupBytes:N0} B   (hits {hits:N0})");
    Console.WriteLine();
    Console.WriteLine($"   (dictionary sizes {byInvoiceA.Count} and {byInvoiceB.Count})");
}
