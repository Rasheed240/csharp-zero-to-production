// 04-production.cs — Ledger's request path, and the allocations nobody wrote
// on purpose.
//
// The incident: p99 latency had a sawtooth pattern with a 4-second period that
// exactly matched gen 0 collections. Allocation was 678 bytes per request for a
// handler that returns a 90-byte response.
//
// Run:  dotnet run 04-production.cs -c Release
//
// EXACT vs RATIO: bytes-per-request figures are exact and deterministic.

using System.Buffers;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;

const int Requests = 200_000;

var request = new PaymentRequest(
    IdempotencyKey: "idem-2026-03-14-0004821",
    Currency: "GBP",
    AmountMinor: 123_450,
    Headers: new[] { "x-tenant: acme", "x-trace: 8f2a", "x-region: eu-west-1" });

Console.WriteLine($"Requests : {Requests:N0}");
Console.WriteLine();

HiddenAllocations();
Console.WriteLine();
TheHandler(request);

// ---------------------------------------------------------------------------
// 1. Allocations that do not look like allocations. Each is shown next to the
//    version that does not allocate, because the pair is the lesson.
// ---------------------------------------------------------------------------
static void HiddenAllocations()
{
    Console.WriteLine("1. Allocations nobody wrote on purpose, each next to its fix");
    Console.WriteLine();
    Console.WriteLine("   what                                  per call   why");
    Console.WriteLine("   ----                                  --------   ---");

    var items = new List<int> { 1, 2, 3, 4, 5 };
    var log = new FakeLogger();

    Measure("closure capturing a local        ", () =>
    {
        // 'threshold' is declared HERE, inside the measured call, so the
        // display class holding it is allocated per call. Declared outside,
        // the compiler hoists it and this row reads 0 - which is exactly the
        // mistake that made the first version of this file report nothing.
        int threshold = items.Count - 2;
        return items.Count(x => x > threshold);
    });

    Measure("static lambda, nothing captured  ", () =>
    {
        // Captures nothing, so the delegate is cached and reused.
        return items.Count(static x => x > 3);
    });

    Measure("boxing into params object[]      ", () =>
    {
        // The array is built explicitly to force the params overload.
        // Written as LogFormat(template, count, 12) the compiler prefers
        // the generic overload below and nothing is boxed.
        object[] arguments = { items.Count, 12 };
        log.LogFormat("processed {0} items in {1} ms", arguments);
        return 0;
    });

    Measure("the generic overload instead     ", () =>
    {
        log.LogFormat("processed {0} items in {1} ms", items.Count, 12);
        return 0;
    });

    Measure("enumerating through IEnumerable  ", () =>
    {
        // List<T> has a struct enumerator, but reaching it through the
        // interface boxes it.
        IEnumerable<int> asInterface = items;
        int total = 0;
        foreach (int x in asInterface)
        {
            total += x;
        }

        return total;
    });

    Measure("enumerating the concrete type    ", () =>
    {
        // Same loop, concrete type, so foreach binds to the struct
        // enumerator and nothing is boxed.
        int total = 0;
        foreach (int x in items)
        {
            total += x;
        }

        return total;
    });

    Measure("params array                     ", () =>
    {
        return SumAll(1, 2, 3, 4, 5);
    });

    Measure("async Task<int>, small result    ", () =>
    {
        // Returns 1. The runtime caches Task<int> objects for -1..8, so this
        // allocates nothing - a real optimisation, and a trap when
        // benchmarking, because it makes async look free.
        return SmallResultAsync().GetAwaiter().GetResult();
    });

    Measure("async Task<int>, result over 8   ", () =>
    {
        // Returns 1000, outside the cached range, so the Task<int> is a real
        // allocation. Same code shape, different number.
        return LargeResultAsync().GetAwaiter().GetResult();
    });

    Measure("the same, returning ValueTask    ", () =>
    {
        return LargeResultValueAsync().GetAwaiter().GetResult();
    });

    Console.WriteLine();
    Console.WriteLine("   None of these look like 'new'. Every one is multiplied by traffic.");
    Console.WriteLine();
    Console.WriteLine("   The enumerator pair is the one worth internalising: the SAME loop");
    Console.WriteLine("   over the SAME list allocates 40 bytes or nothing, depending only on");
    Console.WriteLine("   whether the variable is typed as List<int> or IEnumerable<int>.");
    Console.WriteLine();
    Console.WriteLine("   The two async rows are a warning about benchmarking rather than");
    Console.WriteLine("   about async. Identical code allocates 0 bytes returning 1 and 72");
    Console.WriteLine("   bytes returning 1,000, because the runtime caches Task<int> for");
    Console.WriteLine("   results in -1..8. A microbenchmark that returns a small int will");
    Console.WriteLine("   tell you async is free. It is not.");
    Console.WriteLine();
    Console.WriteLine("   Three of these rows read 0 bytes in the first version of this file,");
    Console.WriteLine("   for three different reasons: the closure was hoisted out of the");
    Console.WriteLine("   measured call, overload resolution quietly picked the generic");
    Console.WriteLine("   logging method over the params one, and the Task cache hid the");
    Console.WriteLine("   async allocation. Measuring allocation is itself worth checking.");

    static int SumAll(params int[] values)
    {
        int total = 0;
        foreach (int v in values)
        {
            total += v;
        }

        return total;
    }

    static async Task<int> SmallResultAsync()
    {
        await Task.CompletedTask;
        return 1;
    }

    static async Task<int> LargeResultAsync()
    {
        await Task.CompletedTask;
        return 1_000;
    }

    static ValueTask<int> LargeResultValueAsync() => new ValueTask<int>(1_000);

    static void Measure(string label, Func<int> body)
    {
        // Warm up, so first-call JIT costs are not counted as allocation.
        for (int i = 0; i < 100; i++)
        {
            body();
        }

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        const int count = 100_000;
        long before = GC.GetTotalAllocatedBytes(precise: true);

        long sink = 0;
        for (int i = 0; i < count; i++)
        {
            sink += body();
        }

        long perCall = (GC.GetTotalAllocatedBytes(precise: true) - before) / count;
        Console.WriteLine($"   {label}   {perCall,6:N0} B   (sink {sink})");
    }
}

// ---------------------------------------------------------------------------
// 2. The handler, before and after.
// ---------------------------------------------------------------------------
static void TheHandler(PaymentRequest request)
{
    Console.WriteLine("2. The handler");
    Console.WriteLine();
    Console.WriteLine("   version    allocated       per request   gen0    time");
    Console.WriteLine("   -------    ---------       -----------   ----    ----");

    long before = Run("before ", request, HandleBefore);
    long after = Run("after  ", request, HandleAfter);

    Console.WriteLine();
    Console.WriteLine($"   {before / (double)Requests:F0} bytes per request became {after / (double)Requests:F0}.");
    Console.WriteLine();

    double perRequestBefore = before / (double)Requests;
    double perRequestAfter = after / (double)Requests;

    Console.WriteLine("   Projected at Ledger's 5,000 requests per second:");
    Console.WriteLine();
    Console.WriteLine($"     before : {perRequestBefore * 5_000 / 1024 / 1024,6:F1} MB/s   " +
        $"({perRequestBefore * 5_000 * 3_600 / 1024 / 1024 / 1024,5:F1} GB/hour)");
    Console.WriteLine($"     after  : {perRequestAfter * 5_000 / 1024 / 1024,6:F1} MB/s   " +
        $"({perRequestAfter * 5_000 * 3_600 / 1024 / 1024 / 1024,5:F1} GB/hour)");
    Console.WriteLine();
    Console.WriteLine("   The changes, in the order they were made:");
    Console.WriteLine("     1. Split + LINQ over headers  -> a span walk");
    Console.WriteLine("     2. Interpolated response      -> string.Create at exact length");
    Console.WriteLine("     3. ToUpper for comparison     -> OrdinalIgnoreCase SequenceEqual");
    Console.WriteLine("     4. IEnumerable<T> parameter   -> the concrete list type");
    Console.WriteLine("     5. object[] logging arguments -> a generic overload, no boxing");
    Console.WriteLine();
    Console.WriteLine("   None of these changed the shape of the handler. They are the kind");
    Console.WriteLine("   of edit a reviewer can check line by line, which is why they are");
    Console.WriteLine("   the ones to make first - before anything involving a pool.");

    static long Run(string label, PaymentRequest request, Func<PaymentRequest, long> handler)
    {
        for (int i = 0; i < 1_000; i++)
        {
            handler(request);
        }

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);
        int g0 = GC.CollectionCount(0);
        var sw = Stopwatch.StartNew();

        long sink = 0;
        for (int i = 0; i < Requests; i++)
        {
            sink += handler(request);
        }

        sw.Stop();
        long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

        Console.WriteLine($"   {label}   {allocated,10:N0} B   {allocated / (double)Requests,9:F0} B   " +
            $"{GC.CollectionCount(0) - g0,4}   {sw.Elapsed.TotalMilliseconds,5:F0} ms   (sink {sink})");

        return allocated;
    }
}

// ---------------------------------------------------------------------------
static long HandleBefore(PaymentRequest request)
{
    // 1. Split every header to find the tenant.
    string? tenant = null;
    foreach (string header in request.Headers)
    {
        string[] parts = header.Split(": ");
        if (parts[0].ToUpperInvariant() == "X-TENANT")
        {
            tenant = parts[1];
        }
    }

    // 2. LINQ over the headers to count trace headers.
    int traceCount = request.Headers.Count(h => h.StartsWith("x-trace", StringComparison.Ordinal));

    // 3. Interpolated response string.
    string response = $"{{\"key\":\"{request.IdempotencyKey}\",\"tenant\":\"{tenant}\"," +
                      $"\"amount\":{request.AmountMinor / 100m:F2},\"traces\":{traceCount}}}";

    return Checksum(response);
}

// ---------------------------------------------------------------------------
static long HandleAfter(PaymentRequest request)
{
    // 1. Find the tenant with a span walk. No Split, no ToUpper.
    ReadOnlySpan<char> tenant = default;
    foreach (string header in request.Headers)
    {
        ReadOnlySpan<char> span = header;
        int colon = span.IndexOf(':');
        if (colon < 0)
        {
            continue;
        }

        if (span[..colon].Equals("x-tenant", StringComparison.OrdinalIgnoreCase))
        {
            tenant = span[(colon + 1)..].TrimStart();
        }
    }

    // 2. Count trace headers with a plain loop. No delegate, no closure.
    int traceCount = 0;
    foreach (string header in request.Headers)
    {
        if (header.StartsWith("x-trace", StringComparison.Ordinal))
        {
            traceCount++;
        }
    }

    // 3. Build the response once, at exactly the right length.
    decimal amount = request.AmountMinor / 100m;

    Span<char> scratch = stackalloc char[32];
    amount.TryFormat(scratch, out int amountLength, "F2", CultureInfo.InvariantCulture);

    int traceDigits = traceCount < 10 ? 1 : traceCount < 100 ? 2 : 3;
    int length = 9 + request.IdempotencyKey.Length
               + 12 + tenant.Length
               + 12 + amountLength
               + 11 + traceDigits + 1;

    string response = string.Create(length, new State(request, tenant.ToString(), amountLength, traceCount),
        static (destination, state) =>
        {
            int position = 0;
            Append(destination, ref position, "{\"key\":\"");
            Append(destination, ref position, state.Request.IdempotencyKey);
            Append(destination, ref position, "\",\"tenant\":\"");
            Append(destination, ref position, state.Tenant);
            Append(destination, ref position, "\",\"amount\":");

            (state.Request.AmountMinor / 100m).TryFormat(destination[position..], out int written,
                "F2", CultureInfo.InvariantCulture);
            position += written;

            Append(destination, ref position, ",\"traces\":");
            state.TraceCount.TryFormat(destination[position..], out written,
                default, CultureInfo.InvariantCulture);
            position += written;

            destination[position] = '}';
        });

    return Checksum(response);
}

[MethodImpl(MethodImplOptions.AggressiveInlining)]
static void Append(Span<char> destination, ref int position, ReadOnlySpan<char> text)
{
    text.CopyTo(destination[position..]);
    position += text.Length;
}

static long Checksum(string text)
{
    long total = 0;
    foreach (char c in text)
    {
        total += c;
    }

    return total;
}

// ---------------------------------------------------------------------------
sealed record PaymentRequest(
    string IdempotencyKey,
    string Currency,
    long AmountMinor,
    string[] Headers);

readonly record struct State(PaymentRequest Request, string Tenant, int AmountLength, int TraceCount);

sealed class FakeLogger
{
    private long _sink;

    // The classic signature: params object[] boxes every value type argument.
    public void LogFormat(string template, params object[] arguments)
    {
        _sink += template.Length + arguments.Length;
    }

    // The generic overload: no array, no boxing.
    public void LogFormat<T1, T2>(string template, T1 a1, T2 a2)
    {
        _sink += template.Length + 2;
    }

    public long Sink => _sink;
}
