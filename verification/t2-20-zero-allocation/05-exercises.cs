// 05-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 05-exercises.cs -c Release

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
// 1. EASY — find the allocation in each line.
// ---------------------------------------------------------------------------
static void Exercise1()
{
    Console.WriteLine("Exercise 1: which of these allocate, and how much?");
    Console.WriteLine();

    var list = new List<int> { 1, 2, 3, 4, 5 };
    string text = "a,b,c";

    Console.WriteLine("   expression                              per call");
    Console.WriteLine("   ----------                              --------");

    Measure("list.Count                          ", () => list.Count);
    Measure("list.Count()  (LINQ)                ", () => list.Count());
    Measure("list.Where(static x => x > 2).Count()", () => list.Where(static x => x > 2).Count());
    Measure("text.Split(',')                     ", () => text.Split(',').Length);
    Measure("text.AsSpan().Count(',') + 1        ", () => text.AsSpan().Count(',') + 1);
    Measure("$\"id-{42}\"                          ", () => ("id-" + 42.ToString(CultureInfo.InvariantCulture)).Length);
    Measure("string.Empty                        ", () => string.Empty.Length);

    Console.WriteLine();
    Console.WriteLine("   list.Count is a property and free. list.Count() is the LINQ");
    Console.WriteLine("   extension, which on a List<T> takes a fast path and also reads 0 -");
    Console.WriteLine("   but that is an optimisation inside LINQ, not a guarantee. On a");
    Console.WriteLine("   type without the fast path it enumerates.");
    Console.WriteLine();
    Console.WriteLine("   The Where(...).Count() line is the one to notice: an iterator");
    Console.WriteLine("   object per call, even with a static lambda and no closure.");
    Console.WriteLine();

    static void Measure(string label, Func<int> body)
    {
        for (int i = 0; i < 100; i++)
        {
            body();
        }

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        const int count = 200_000;
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
// 2. EASY — the rented-length bug, and what it exposes.
// ---------------------------------------------------------------------------
static void Exercise2()
{
    Console.WriteLine("Exercise 2: what is wrong with this method?");
    Console.WriteLine();
    Console.WriteLine("     byte[] buffer = ArrayPool<byte>.Shared.Rent(length);");
    Console.WriteLine("     stream.Read(buffer);");
    Console.WriteLine("     return Encoding.UTF8.GetString(buffer);");
    Console.WriteLine();

    // Tenant one leaves data behind.
    // Both tenants must land in the SAME bucket for the reuse to happen.
    // Rent(50) and Rent(10) round to 64 and 16 - different buckets, and the
    // first version of this demonstration quietly proved nothing.
    byte[] first = ArrayPool<byte>.Shared.Rent(50);
    "CUSTOMER-000512 BALANCE 998877"u8.CopyTo(first);
    ArrayPool<byte>.Shared.Return(first);

    // Tenant two writes two bytes and reads the whole array.
    byte[] second = ArrayPool<byte>.Shared.Rent(50);
    "OK"u8.CopyTo(second);

    Console.WriteLine($"   requested 50 bytes, got Length {second.Length}");
    Console.WriteLine($"   GetString(buffer)        : \"{System.Text.Encoding.UTF8.GetString(second).TrimEnd('\0')}\"");
    Console.WriteLine($"   GetString(buffer, 0, 2)  : \"{System.Text.Encoding.UTF8.GetString(second, 0, 2)}\"");
    Console.WriteLine();
    Console.WriteLine("   Two bugs, both in one line:");
    Console.WriteLine("     1. Rent returns an array AT LEAST the size asked for, so");
    Console.WriteLine("        buffer.Length is not the length you wanted.");
    Console.WriteLine("     2. Read returns how many bytes it actually read, which may be");
    Console.WriteLine("        fewer than requested. Ignoring it reads stale bytes.");
    Console.WriteLine();
    Console.WriteLine("   The result is another tenant's data in this caller's string.");
    Console.WriteLine();

    ArrayPool<byte>.Shared.Return(second, clearArray: true);
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — a struct enumerator, and what it saves.
// ---------------------------------------------------------------------------
static void Exercise3()
{
    Console.WriteLine("Exercise 3: returning IEnumerable<T> from a hot method");
    Console.WriteLine();

    const string csv = "INV-001,INV-002,INV-003,INV-004,INV-005";
    const int iterations = 300_000;

    Measure("yield return (iterator)     ", () =>
    {
        int total = 0;
        foreach (ReadOnlyMemory<char> field in SplitIterator(csv))
        {
            total += field.Length;
        }

        return total;
    });

    Measure("custom struct enumerator    ", () =>
    {
        int total = 0;
        foreach (ReadOnlySpan<char> field in new SpanSplitter(csv, ','))
        {
            total += field.Length;
        }

        return total;
    });

    Console.WriteLine();
    Console.WriteLine("   The iterator allocates its state machine object per call. The");
    Console.WriteLine("   struct enumerator allocates nothing, because foreach binds to its");
    Console.WriteLine("   concrete GetEnumerator rather than to IEnumerable<T>.");
    Console.WriteLine();
    Console.WriteLine("   This is exactly what List<T>.Enumerator does, and it is why");
    Console.WriteLine("   foreach over a List<T> is free while foreach over the same list");
    Console.WriteLine("   typed as IEnumerable<int> is not.");
    Console.WriteLine();
    Console.WriteLine("   Cost of the technique: the struct enumerator cannot be used with");
    Console.WriteLine("   LINQ, cannot be returned as IEnumerable without boxing, and is");
    Console.WriteLine("   about 40 lines instead of 5.");
    Console.WriteLine();

    static IEnumerable<ReadOnlyMemory<char>> SplitIterator(string text)
    {
        int start = 0;
        for (int i = 0; i <= text.Length; i++)
        {
            if (i == text.Length || text[i] == ',')
            {
                yield return text.AsMemory(start, i - start);
                start = i + 1;
            }
        }
    }

    static void Measure(string label, Func<int> body)
    {
        for (int i = 0; i < 100; i++)
        {
            body();
        }

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);
        var sw = Stopwatch.StartNew();

        long sink = 0;
        for (int i = 0; i < iterations; i++)
        {
            sink += body();
        }

        sw.Stop();
        long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;
        Console.WriteLine($"   {label}   {allocated,10:N0} B   {allocated / (double)iterations,5:F0} B/call   " +
            $"{sw.Elapsed.TotalMilliseconds,5:F0} ms   (sink {sink})");
    }
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — when pooling makes it worse.
// ---------------------------------------------------------------------------
static void Exercise4()
{
    Console.WriteLine("Exercise 4: at what size does pooling start to pay?");
    Console.WriteLine();
    Console.WriteLine("   size        new byte[]    ArrayPool    pool wins?");
    Console.WriteLine("   ----        ----------    ---------    ----------");

    foreach (int size in new[] { 32, 128, 1_024, 8_192, 65_536, 1_000_000 })
    {
        double direct = Time(() =>
        {
            var buffer = new byte[size];
            buffer[0] = 1;
            return buffer[0];
        });

        double pooled = Time(() =>
        {
            byte[] buffer = ArrayPool<byte>.Shared.Rent(size);
            buffer[0] = 1;
            byte result = buffer[0];
            ArrayPool<byte>.Shared.Return(buffer);
            return result;
        });

        Console.WriteLine($"   {size,9:N0}   {direct,8:F0} ms   {pooled,8:F0} ms    " +
            $"{(pooled < direct ? $"yes ({direct / pooled:F1}x)" : $"NO ({direct / pooled:F2}x)")}");
    }

    Console.WriteLine();
    Console.WriteLine("   Pooling is not free. Rent and Return do real bookkeeping, and for");
    Console.WriteLine("   a small buffer that costs more than the allocation it replaces -");
    Console.WriteLine("   a gen 0 allocation is a pointer bump.");
    Console.WriteLine();
    Console.WriteLine("   The rule that follows: below about a kilobyte, use stackalloc if");
    Console.WriteLine("   the size is constant, and a plain array otherwise. Pool the sizes");
    Console.WriteLine("   where the array would land on the large object heap, or where the");
    Console.WriteLine("   measurement above says so on YOUR hardware.");
    Console.WriteLine();

    static double Time(Func<byte> body)
    {
        const int iterations = 100_000;

        for (int i = 0; i < 1_000; i++)
        {
            body();
        }

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        var sw = Stopwatch.StartNew();
        long sink = 0;
        for (int i = 0; i < iterations; i++)
        {
            sink += body();
        }

        sw.Stop();
        _ = sink;
        return sw.Elapsed.TotalMilliseconds;
    }
}

// ---------------------------------------------------------------------------
// 5. HARD — a pooled object with a correct reset.
// ---------------------------------------------------------------------------
static void Exercise5()
{
    Console.WriteLine("Exercise 5: pooling an object rather than an array");
    Console.WriteLine();

    var pool = new SimplePool<System.Text.StringBuilder>(
        create: static () => new System.Text.StringBuilder(256),
        reset: static b => b.Clear(),
        maxRetained: 8);

    const int iterations = 200_000;

    long unpooled = MeasureAllocation(() =>
    {
        var builder = new System.Text.StringBuilder(256);
        builder.Append("INV-").Append(1234);
        return builder.Length;
    });

    long pooled = MeasureAllocation(() =>
    {
        System.Text.StringBuilder builder = pool.Rent();
        try
        {
            builder.Append("INV-").Append(1234);
            return builder.Length;
        }
        finally
        {
            pool.Return(builder);
        }
    });

    Console.WriteLine($"   {iterations:N0} iterations");
    Console.WriteLine($"     new StringBuilder(256) : {unpooled / 1024.0 / 1024.0,7:F1} MB");
    Console.WriteLine($"     pooled                 : {pooled / 1024.0 / 1024.0,7:F1} MB");
    Console.WriteLine();

    // The bug this design prevents.
    System.Text.StringBuilder leaked = pool.Rent();
    leaked.Append("SECRET-000512");
    pool.Return(leaked);
    System.Text.StringBuilder next = pool.Rent();

    Console.WriteLine($"   next tenant sees        : \"{next}\" (length {next.Length})");
    Console.WriteLine();
    Console.WriteLine("   The reset runs on RETURN, not on rent. Both work, but resetting on");
    Console.WriteLine("   return means the pool never holds a live reference to somebody's");
    Console.WriteLine("   data while it sits idle - which matters if a dump is taken.");
    Console.WriteLine();
    Console.WriteLine("   Three things this pool gets right and a naive one does not:");
    Console.WriteLine("     1. It is BOUNDED. An unbounded pool is a memory leak with a");
    Console.WriteLine("        respectable name - it retains every object ever returned.");
    Console.WriteLine("     2. Rent always succeeds. If the pool is empty it creates one,");
    Console.WriteLine("        rather than blocking or failing.");
    Console.WriteLine("     3. Return of a foreign or duplicate object cannot corrupt it,");
    Console.WriteLine("        because it holds no ownership state to corrupt.");
    Console.WriteLine();
    Console.WriteLine("   In a real service use Microsoft.Extensions.ObjectPool rather than");
    Console.WriteLine("   this. The point of writing it out is that the interesting part is");
    Console.WriteLine("   the RESET policy, which no library can choose for you.");
    Console.WriteLine();

    pool.Return(next);

    static long MeasureAllocation(Func<int> body)
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
        for (int i = 0; i < iterations; i++)
        {
            sink += body();
        }

        _ = sink;
        return GC.GetTotalAllocatedBytes(precise: true) - before;
    }
}

// ---------------------------------------------------------------------------
// 6. HARD — knowing when to stop.
// ---------------------------------------------------------------------------
static void Exercise6()
{
    Console.WriteLine("Exercise 6: the cost of the last step");
    Console.WriteLine();

    const int iterations = 300_000;
    var payment = new PaymentRow(4_000_821, "GBP", 123_450);

    Measure("interpolated string         ", () =>
    {
        string line = $"PAY-{payment.Id:D10} {payment.Currency} {payment.AmountMinor / 100m:F2}";
        return line.Length;
    });

    Measure("string.Create               ", () =>
    {
        // The length must be EXACT. Padding to a guessed size and calling
        // TrimEnd allocates a second string and makes this version worse
        // than the interpolation it replaced - measured, 168 B against 112 B.
        Span<char> amountScratch = stackalloc char[24];
        (payment.AmountMinor / 100m).TryFormat(amountScratch, out int amountLength,
            "F2", CultureInfo.InvariantCulture);

        int length = 4 + 10 + 1 + payment.Currency.Length + 1 + amountLength;

        string line = string.Create(length, payment, static (destination, p) =>
        {
            int position = 0;
            "PAY-".AsSpan().CopyTo(destination);
            position += 4;
            p.Id.TryFormat(destination[position..], out int written, "D10", CultureInfo.InvariantCulture);
            position += written;
            destination[position++] = ' ';
            p.Currency.AsSpan().CopyTo(destination[position..]);
            position += p.Currency.Length;
            destination[position++] = ' ';
            (p.AmountMinor / 100m).TryFormat(destination[position..], out written, "F2", CultureInfo.InvariantCulture);
        });

        return line.Length;
    });

    Measure("stackalloc, no string at all", () =>
    {
        Span<char> buffer = stackalloc char[64];
        int position = 0;
        "PAY-".AsSpan().CopyTo(buffer);
        position += 4;
        payment.Id.TryFormat(buffer[position..], out int written, "D10", CultureInfo.InvariantCulture);
        position += written;
        buffer[position++] = ' ';
        payment.Currency.AsSpan().CopyTo(buffer[position..]);
        position += payment.Currency.Length;
        buffer[position++] = ' ';
        (payment.AmountMinor / 100m).TryFormat(buffer[position..], out written, "F2", CultureInfo.InvariantCulture);
        position += written;
        return position;
    });

    Console.WriteLine();
    Console.WriteLine("   The third version allocates nothing and is the hardest to read.");
    Console.WriteLine("   It is also the only one that cannot hand a string to a caller,");
    Console.WriteLine("   so every consumer has to be rewritten to take a span.");
    Console.WriteLine();
    Console.WriteLine("   When to take that last step:");
    Console.WriteLine("     - a profile shows this path dominating allocation, AND");
    Console.WriteLine("     - the consumer can take a span without spreading further, AND");
    Console.WriteLine("     - the code is not on an async path, because a span cannot");
    Console.WriteLine("       cross an await.");
    Console.WriteLine();
    Console.WriteLine("   If any of those is false, stop at string.Create. It removes most");
    Console.WriteLine("   of the allocation and stays readable and returnable.");

    static void Measure(string label, Func<int> body)
    {
        for (int i = 0; i < 1_000; i++)
        {
            body();
        }

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);
        var sw = Stopwatch.StartNew();

        long sink = 0;
        for (int i = 0; i < iterations; i++)
        {
            sink += body();
        }

        sw.Stop();
        long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;
        Console.WriteLine($"   {label}   {allocated / (double)iterations,5:F0} B/call   " +
            $"{sw.Elapsed.TotalMilliseconds,5:F0} ms   (sink {sink})");
    }
}

// ---------------------------------------------------------------------------
sealed record PaymentRow(long Id, string Currency, long AmountMinor);

// A struct enumerator over comma-separated fields. No allocation, because
// foreach binds to these members by name rather than through an interface.
readonly ref struct SpanSplitter
{
    private readonly ReadOnlySpan<char> _text;
    private readonly char _separator;

    public SpanSplitter(ReadOnlySpan<char> text, char separator)
    {
        _text = text;
        _separator = separator;
    }

    public Enumerator GetEnumerator() => new Enumerator(_text, _separator);

    public ref struct Enumerator
    {
        private ReadOnlySpan<char> _remaining;
        private readonly char _separator;
        private bool _finished;

        public Enumerator(ReadOnlySpan<char> text, char separator)
        {
            _remaining = text;
            _separator = separator;
            _finished = false;
            Current = default;
        }

        public ReadOnlySpan<char> Current { get; private set; }

        public bool MoveNext()
        {
            if (_finished)
            {
                return false;
            }

            int index = _remaining.IndexOf(_separator);
            if (index < 0)
            {
                Current = _remaining;
                _finished = true;
                return true;
            }

            Current = _remaining[..index];
            _remaining = _remaining[(index + 1)..];
            return true;
        }
    }
}

// A bounded object pool. Deliberately small enough to read in full.
sealed class SimplePool<T> where T : class
{
    private readonly Func<T> _create;
    private readonly Action<T> _reset;
    private readonly T?[] _items;

    public SimplePool(Func<T> create, Action<T> reset, int maxRetained)
    {
        _create = create;
        _reset = reset;
        _items = new T?[maxRetained];
    }

    public T Rent()
    {
        for (int i = 0; i < _items.Length; i++)
        {
            T? item = Interlocked.Exchange(ref _items[i], null);
            if (item is not null)
            {
                return item;
            }
        }

        // Empty pool: create rather than block. Renting must always succeed.
        return _create();
    }

    public void Return(T item)
    {
        // Reset on return, so the pool never holds live data while idle.
        _reset(item);

        for (int i = 0; i < _items.Length; i++)
        {
            if (Interlocked.CompareExchange(ref _items[i], item, null) is null)
            {
                return;
            }
        }

        // Pool full: drop it. This is what makes the pool BOUNDED, and it is
        // the line a naive implementation leaves out.
    }
}
