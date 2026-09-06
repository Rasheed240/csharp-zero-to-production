// 01-span-basics.cs — What a Span actually is: a view, not a copy. Slicing,
// mutation through a view, the three memory kinds it can point at, and what
// each one costs.
//
// Run:  dotnet run 01-span-basics.cs -c Release
//
// EXACT vs RATIO: allocation byte counts are exact and reproducible. Times are
// ratios against the stated baseline.

#:property AllowUnsafeBlocks=true

using System.Diagnostics;

Console.WriteLine("1. A Span is a VIEW over memory somebody else owns");
Console.WriteLine();

ViewNotCopy();
ThreeKindsOfMemory();
SlicingCostsNothing();
SubstringVersusSlice();
BoundsAreStillChecked();

// ---------------------------------------------------------------------------
static void ViewNotCopy()
{
    int[] numbers = { 10, 20, 30, 40, 50 };

    // A span over the middle three. No copy is made.
    Span<int> middle = numbers.AsSpan(1, 3);

    Console.WriteLine($"   array  : [{string.Join(", ", numbers)}]");
    Console.WriteLine($"   span   : [{string.Join(", ", middle.ToArray())}]  (numbers.AsSpan(1, 3))");
    Console.WriteLine();

    // Writing through the span writes to the array.
    middle[0] = 999;

    Console.WriteLine($"   after span[0] = 999:");
    Console.WriteLine($"   array  : [{string.Join(", ", numbers)}]");
    Console.WriteLine();
    Console.WriteLine("   The array changed. The span did not hold a copy of element 1;");
    Console.WriteLine("   it held the ADDRESS of element 1. That is the whole idea, and it");
    Console.WriteLine("   is also the whole danger: a span is only valid while the thing it");
    Console.WriteLine("   points at is alive and unchanged.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void ThreeKindsOfMemory()
{
    Console.WriteLine("2. The three places a Span can point at");
    Console.WriteLine();

    // (a) The managed heap: an array.
    int[] heapArray = new int[4];
    Span<int> fromHeap = heapArray;
    fromHeap[0] = 1;

    // (b) The stack: stackalloc. No heap allocation at all.
    Span<int> fromStack = stackalloc int[4];
    fromStack[0] = 2;

    // (c) Unmanaged memory, allocated and freed by hand. This is the only
    //     part of the file that needs unsafe, and it is why the file carries
    //     the AllowUnsafeBlocks property at the top.
    unsafe
    {
        void* native = System.Runtime.InteropServices.NativeMemory.Alloc(4, sizeof(int));
        try
        {
            Span<int> fromNative = new Span<int>(native, 4);
            fromNative[0] = 3;

            Console.WriteLine($"   heap span[0]      : {fromHeap[0]}");
            Console.WriteLine($"   stack span[0]     : {fromStack[0]}");
            Console.WriteLine($"   unmanaged span[0] : {fromNative[0]}");
        }
        finally
        {
            System.Runtime.InteropServices.NativeMemory.Free(native);
        }
    }

    Console.WriteLine();
    Console.WriteLine("   One type, three completely different kinds of memory. A method");
    Console.WriteLine("   taking Span<int> works with all three and does not know or care");
    Console.WriteLine("   which it was given. That is why span-based APIs compose so well.");
    Console.WriteLine();

    // A ReadOnlySpan over a string: the most common case in real code.
    string text = "INV-2026-0004821";
    ReadOnlySpan<char> id = text.AsSpan(4);
    Console.WriteLine($"   string           : {text}");
    Console.WriteLine($"   AsSpan(4)        : {id.ToString()}   (no new string was created)");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void SlicingCostsNothing()
{
    Console.WriteLine("3. Slicing allocates nothing, at any depth");
    Console.WriteLine();

    var data = new byte[10_000];
    const int iterations = 1_000_000;

    long before = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    long sink = 0;
    for (int i = 0; i < iterations; i++)
    {
        ReadOnlySpan<byte> whole = data;
        ReadOnlySpan<byte> half = whole.Slice(0, 5_000);
        ReadOnlySpan<byte> quarter = half.Slice(1_000, 2_500);
        ReadOnlySpan<byte> tiny = quarter[100..110];
        sink += tiny.Length;
    }

    sw.Stop();
    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

    Console.WriteLine($"   {iterations:N0} iterations, four nested slices each");
    Console.WriteLine($"   bytes allocated : {allocated:N0}");
    Console.WriteLine($"   time            : {sw.Elapsed.TotalMilliseconds:F0} ms");
    Console.WriteLine();
    Console.WriteLine("   Four million slices, and the figure above is a few dozen bytes of");
    Console.WriteLine("   fixed setup - not zero, but not proportional to the work either.");
    Console.WriteLine("   Slicing itself allocates nothing.");
    Console.WriteLine();
    Console.WriteLine("   A Span is two fields - a reference and a length - and it lives on");
    Console.WriteLine("   the stack. Slicing constructs a new one from the old one with");
    Console.WriteLine("   adjusted values. Nothing touches the heap.");
    Console.WriteLine($"   (sink {sink})");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void SubstringVersusSlice()
{
    Console.WriteLine("4. Substring vs Slice, on a realistic parsing job");
    Console.WriteLine();

    // A fixed-width settlement line, the shape Ledger actually receives.
    const string line = "INV-2026-0004821GBP0000001234502026-03-14CUSTOMER-000512      ";
    const int iterations = 200_000;

    // --- the string version -------------------------------------------------
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    long before = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    long stringTotal = 0;
    for (int i = 0; i < iterations; i++)
    {
        string invoice = line.Substring(0, 16);
        string currency = line.Substring(16, 3);
        string amount = line.Substring(19, 13);
        string date = line.Substring(32, 10);
        stringTotal += invoice.Length + currency.Length + long.Parse(amount) + date.Length;
    }

    sw.Stop();
    double stringMs = sw.Elapsed.TotalMilliseconds;
    long stringBytes = GC.GetTotalAllocatedBytes(precise: true) - before;

    // --- the span version ---------------------------------------------------
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    before = GC.GetTotalAllocatedBytes(precise: true);
    sw.Restart();

    long spanTotal = 0;
    for (int i = 0; i < iterations; i++)
    {
        ReadOnlySpan<char> span = line.AsSpan();
        ReadOnlySpan<char> invoice = span[..16];
        ReadOnlySpan<char> currency = span.Slice(16, 3);
        ReadOnlySpan<char> amount = span.Slice(19, 13);
        ReadOnlySpan<char> date = span.Slice(32, 10);
        spanTotal += invoice.Length + currency.Length + long.Parse(amount) + date.Length;
    }

    sw.Stop();
    double spanMs = sw.Elapsed.TotalMilliseconds;
    long spanBytes = GC.GetTotalAllocatedBytes(precise: true) - before;

    Console.WriteLine($"   {iterations:N0} lines, four fields each");
    Console.WriteLine();
    Console.WriteLine("   version      allocated        per line     time");
    Console.WriteLine($"   Substring   {stringBytes,10:N0} B   {stringBytes / (double)iterations,8:F0} B   {stringMs,6:F0} ms");
    Console.WriteLine($"   Slice       {spanBytes,10:N0} B   {spanBytes / (double)iterations,8:F0} B   {spanMs,6:F0} ms");
    Console.WriteLine();
    Console.WriteLine($"   allocation ratio : {(spanBytes == 0 ? "all of it removed" : $"{stringBytes / (double)spanBytes:F0}x less")}");
    Console.WriteLine($"   time ratio       : {stringMs / spanMs:F2}x");
    Console.WriteLine();
    Console.WriteLine($"   (checksums {stringTotal} and {spanTotal} - equal: {stringTotal == spanTotal})");
    Console.WriteLine();
    Console.WriteLine("   Note long.Parse accepts a ReadOnlySpan<char> directly. Every");
    Console.WriteLine("   numeric type in .NET does. If a parse method only took string,");
    Console.WriteLine("   the span version would have to allocate one and the saving");
    Console.WriteLine("   would vanish - which is the first thing to check before");
    Console.WriteLine("   rewriting a parser.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void BoundsAreStillChecked()
{
    Console.WriteLine("5. A Span is not unsafe: bounds are still checked");
    Console.WriteLine();

    var data = new byte[10];
    Span<byte> span = data.AsSpan(2, 4);

    Console.WriteLine($"   array length : {data.Length}");
    Console.WriteLine($"   span length  : {span.Length}   (a window onto elements 2..5)");

    try
    {
        _ = span[4];
    }
    catch (IndexOutOfRangeException)
    {
        Console.WriteLine("   span[4]      : IndexOutOfRangeException");
    }

    Console.WriteLine();
    Console.WriteLine("   Element 6 of the array exists and is perfectly valid memory.");
    Console.WriteLine("   The span refuses anyway, because its length is 4. A span cannot");
    Console.WriteLine("   be used to read outside the window it was given, which is what");
    Console.WriteLine("   separates it from a raw pointer.");
    Console.WriteLine();
    Console.WriteLine("   The bounds check costs the same as an array bounds check, and the");
    Console.WriteLine("   JIT eliminates it in the same situations - most usefully when you");
    Console.WriteLine("   loop to span.Length rather than to a separately held count.");
}
