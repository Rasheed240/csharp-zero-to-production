// 01-pooling.cs — ArrayPool: what renting actually gives you, what returning
// costs, and the two bugs that make pooling worse than not pooling.
//
// Run:  dotnet run 01-pooling.cs -c Release
//
// EXACT vs RATIO: rented lengths, the double-return result and the dirty-buffer
// contents are deterministic and reproduce on every run. Times are ratios.

using System.Buffers;
using System.Diagnostics;

Console.WriteLine("1. What Rent gives you is not what you asked for");
Console.WriteLine();

WhatRentReturns();
TheSaving();
DirtyBuffers();
DoubleReturn();
ForgettingToReturn();
CustomPools();

// ---------------------------------------------------------------------------
static void WhatRentReturns()
{
    Console.WriteLine("   requested   Length given   wasted");
    Console.WriteLine("   ---------   ------------   ------");

    foreach (int request in new[] { 1, 10, 100, 1_000, 5_000, 100_000 })
    {
        byte[] rented = ArrayPool<byte>.Shared.Rent(request);
        Console.WriteLine($"   {request,9:N0}   {rented.Length,12:N0}   {rented.Length - request,6:N0}");
        ArrayPool<byte>.Shared.Return(rented);
    }

    Console.WriteLine();
    Console.WriteLine("   Rent returns an array AT LEAST the size requested, rounded up to a");
    Console.WriteLine("   power of two, with a minimum of 16. A request for 100 gives 128.");
    Console.WriteLine();
    Console.WriteLine("   Every use of rented.Length instead of the count you asked for or");
    Console.WriteLine("   the count you wrote is a bug. It is the single most common mistake");
    Console.WriteLine("   with this API and the consequences are in section 3.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TheSaving()
{
    Console.WriteLine("2. What pooling is worth");
    Console.WriteLine();

    const int iterations = 200_000;
    const int size = 4_096;

    (double allocMs, long allocBytes, int allocG0) = Measure(() =>
    {
        var buffer = new byte[size];
        buffer[0] = 1;
        return buffer.Length;
    });

    (double poolMs, long poolBytes, int poolG0) = Measure(() =>
    {
        byte[] buffer = ArrayPool<byte>.Shared.Rent(size);
        try
        {
            buffer[0] = 1;
            return size;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    });

    Console.WriteLine($"   {iterations:N0} buffers of {size:N0} bytes");
    Console.WriteLine();
    Console.WriteLine("   strategy      allocated      gen0    time");
    Console.WriteLine($"   new byte[]   {allocBytes / 1024.0 / 1024.0,8:F0} MB   {allocG0,5}   {allocMs,6:F0} ms");
    Console.WriteLine($"   ArrayPool    {poolBytes / 1024.0 / 1024.0,8:F2} MB   {poolG0,5}   {poolMs,6:F0} ms");
    Console.WriteLine();
    Console.WriteLine($"   {allocG0 - poolG0} fewer gen 0 collections, {allocMs / poolMs:F1}x on time this run");
    Console.WriteLine();
    Console.WriteLine("   The collection count is the reliable figure. The time ratio moves");
    Console.WriteLine("   between runs, for the same reason as everywhere else in this track:");
    Console.WriteLine("   objects that die in gen 0 are cheap, and removing cheap work does");
    Console.WriteLine("   not move a single-threaded loop much.");
    Console.WriteLine();

    static (double, long, int) Measure(Func<int> body)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);
        int g0 = GC.CollectionCount(0);
        var sw = Stopwatch.StartNew();

        long sink = 0;
        for (int i = 0; i < iterations; i++)
        {
            sink += body();
        }

        sw.Stop();
        _ = sink;
        return (sw.Elapsed.TotalMilliseconds,
            GC.GetTotalAllocatedBytes(precise: true) - before,
            GC.CollectionCount(0) - g0);
    }
}

// ---------------------------------------------------------------------------
// 3. A rented buffer arrives dirty. This is the data-disclosure bug.
// ---------------------------------------------------------------------------
static void DirtyBuffers()
{
    Console.WriteLine("3. A rented buffer contains the previous tenant's data");
    Console.WriteLine();

    // Tenant one writes a customer record and returns the buffer WITHOUT
    // clearing it.
    char[] first = ArrayPool<char>.Shared.Rent(64);
    "CUSTOMER-000512 GBP 1234.50".AsSpan().CopyTo(first);
    ArrayPool<char>.Shared.Return(first);

    // Tenant two rents, writes something shorter, and reads the whole array.
    char[] second = ArrayPool<char>.Shared.Rent(64);
    int written = "OK".AsSpan().Length;
    "OK".AsSpan().CopyTo(second);

    Console.WriteLine($"   tenant two wrote  : \"OK\" ({written} chars)");
    string wholeBuffer = new string(second).TrimEnd('\0');
    Console.WriteLine($"   new string(buffer): \"{wholeBuffer}\"");
    Console.WriteLine($"   new string(buf,0,n): \"{new string(second, 0, written)}\"");
    Console.WriteLine();
    Console.WriteLine("   The first line leaks the previous tenant's record. If that string");
    Console.WriteLine("   goes into an HTTP response, one customer has been shown another");
    Console.WriteLine("   customer's data - a disclosure bug, not a performance bug.");
    Console.WriteLine();

    ArrayPool<char>.Shared.Return(second, clearArray: true);

    // Prove clearArray works.
    char[] third = ArrayPool<char>.Shared.Rent(64);
    bool clean = true;
    foreach (char c in third)
    {
        if (c != '\0')
        {
            clean = false;
            break;
        }
    }

    Console.WriteLine($"   after Return(clearArray: true), next rent is all zeros: {clean}");
    Console.WriteLine();
    Console.WriteLine("   Two defences, and you want both:");
    Console.WriteLine("     1. Track what you WROTE and never read past it.");
    Console.WriteLine("     2. Return with clearArray: true whenever the buffer held data");
    Console.WriteLine("        that another user must not see. It costs a memset.");
    Console.WriteLine();

    ArrayPool<char>.Shared.Return(third);
}

// ---------------------------------------------------------------------------
// 4. Returning twice is worse than never returning.
// ---------------------------------------------------------------------------
static void DoubleReturn()
{
    Console.WriteLine("4. Returning the same buffer twice");
    Console.WriteLine();

    int[] buffer = ArrayPool<int>.Shared.Rent(16);
    ArrayPool<int>.Shared.Return(buffer);
    ArrayPool<int>.Shared.Return(buffer);      // the bug

    int[] renterA = ArrayPool<int>.Shared.Rent(16);
    int[] renterB = ArrayPool<int>.Shared.Rent(16);

    Console.WriteLine($"   two independent renters got the SAME array: {ReferenceEquals(renterA, renterB)}");

    renterA[0] = 111;
    renterB[0] = 222;

    Console.WriteLine($"   renter A wrote 111, then renter B wrote 222");
    Console.WriteLine($"   renter A now reads: {renterA[0]}");
    Console.WriteLine();
    Console.WriteLine("   Renter A's data was overwritten by code it has never heard of.");
    Console.WriteLine("   No exception, no warning. This is the worst bug in the module:");
    Console.WriteLine("   two parts of the program silently sharing one buffer.");
    Console.WriteLine();
    Console.WriteLine("   It happens when a finally block returns a buffer that an inner");
    Console.WriteLine("   method has already returned, or when a Dispose runs twice. The");
    Console.WriteLine("   fix is to null the field as you return it, so a second return");
    Console.WriteLine("   has nothing to give back.");
    Console.WriteLine();

    ArrayPool<int>.Shared.Return(renterA);
}

// ---------------------------------------------------------------------------
// 5. Not returning is safe, and it silently removes the benefit.
// ---------------------------------------------------------------------------
static void ForgettingToReturn()
{
    Console.WriteLine("5. Forgetting to return");
    Console.WriteLine();

    const int iterations = 20_000;
    const int size = 8_192;

    long returnedBytes = MeasureAllocation(true);
    long leakedBytes = MeasureAllocation(false);

    Console.WriteLine($"   {iterations:N0} rents of {size:N0} bytes");
    Console.WriteLine($"     returning properly : {returnedBytes / 1024.0 / 1024.0,8:F1} MB allocated");
    Console.WriteLine($"     never returning    : {leakedBytes / 1024.0 / 1024.0,8:F1} MB allocated");
    Console.WriteLine();
    Console.WriteLine("   Not returning is not a memory LEAK - the pool holds no reference to");
    Console.WriteLine("   an array it never got back, so the collector reclaims it normally.");
    Console.WriteLine();
    Console.WriteLine("   It is worse than that in one specific way: the code looks like it");
    Console.WriteLine("   is pooling, the reviewer believes it is pooling, and it is quietly");
    Console.WriteLine("   allocating on every call. A pool with no returns is a slower");
    Console.WriteLine("   'new byte[]' with extra ceremony.");
    Console.WriteLine();

    static long MeasureAllocation(bool doReturn)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);

        for (int i = 0; i < iterations; i++)
        {
            byte[] buffer = ArrayPool<byte>.Shared.Rent(size);
            buffer[0] = (byte)i;

            if (doReturn)
            {
                ArrayPool<byte>.Shared.Return(buffer);
            }
        }

        return GC.GetTotalAllocatedBytes(precise: true) - before;
    }
}

// ---------------------------------------------------------------------------
// 6. Shared is not the only pool.
// ---------------------------------------------------------------------------
static void CustomPools()
{
    Console.WriteLine("6. ArrayPool.Shared vs a private pool");
    Console.WriteLine();

    // A private pool with a bounded number of arrays per bucket. Useful when
    // one component churns large buffers and should not evict everyone else's
    // from the shared pool.
    ArrayPool<byte> pool = ArrayPool<byte>.Create(maxArrayLength: 1024 * 1024, maxArraysPerBucket: 4);

    byte[] a = pool.Rent(100_000);
    Console.WriteLine($"   private pool Rent(100,000) -> Length {a.Length:N0}");
    pool.Return(a);

    // Above maxArrayLength the pool allocates and does not keep the return.
    byte[] tooBig = pool.Rent(4_000_000);
    Console.WriteLine($"   private pool Rent(4,000,000) -> Length {tooBig.Length:N0} (above the max, so not pooled)");
    pool.Return(tooBig);

    byte[] again = pool.Rent(4_000_000);
    Console.WriteLine($"   renting it again gives the same instance: {ReferenceEquals(tooBig, again)}");
    pool.Return(again);

    Console.WriteLine();
    Console.WriteLine("   Use ArrayPool<T>.Shared by default. Reach for Create when:");
    Console.WriteLine("     - one component churns buffers far larger than everyone else's,");
    Console.WriteLine("       and would evict their arrays from the shared buckets;");
    Console.WriteLine("     - you need a hard ceiling on how much the pool retains;");
    Console.WriteLine("     - you are writing a library and do not want to affect the host.");
    Console.WriteLine();
    Console.WriteLine("   Note the shared pool is per-process and mostly thread-local, so");
    Console.WriteLine("   contention is rarely the reason to create your own.");
}
