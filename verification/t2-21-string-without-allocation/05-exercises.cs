// 05-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 05-exercises.cs -c Release

using System.Buffers;
using System.Buffers.Text;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Unicode;

Exercise1();
Exercise2();
Exercise3();
Exercise4();
Exercise5();
Exercise6();

// ---------------------------------------------------------------------------
// 1. EASY — how many bytes does a string cost?
// ---------------------------------------------------------------------------
static void Exercise1()
{
    Console.WriteLine("Exercise 1: how much memory does a string of N characters take?");
    Console.WriteLine();
    Console.WriteLine("   text                chars   on the heap   UTF-8 would be");
    Console.WriteLine("   ----                -----   -----------   --------------");

    foreach (string text in new[] { "GBP", "INV-2026-0004821", "OK" })
    {
        long measured = MeasureAllocation(text);
        Console.WriteLine($"   {text,-18}   {text.Length,5}   {measured,11:N0}   " +
            $"{Encoding.UTF8.GetByteCount(text),14:N0}");
    }

    Console.WriteLine();
    Console.WriteLine("   The formula: 22 bytes of overhead plus 2 per character, rounded");
    Console.WriteLine("   up to a multiple of 8.");
    Console.WriteLine();
    Console.WriteLine("   \"GBP\" is 3 characters and costs 32 bytes - a factor of ten. That");
    Console.WriteLine("   is why a currency code held as a string in a hot loop is worth");
    Console.WriteLine("   replacing with an enum or a u8 literal.");
    Console.WriteLine();

    static long MeasureAllocation(string source)
    {
        const int count = 200_000;

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);
        long sink = 0;
        for (int i = 0; i < count; i++)
        {
            sink += new string(source.AsSpan()).Length;
        }

        _ = sink;
        return (GC.GetTotalAllocatedBytes(precise: true) - before) / count;
    }
}

// ---------------------------------------------------------------------------
// 2. EASY — the comparison that allocates and is also wrong.
// ---------------------------------------------------------------------------
static void Exercise2()
{
    Console.WriteLine("Exercise 2: what is wrong with this header check?");
    Console.WriteLine();
    Console.WriteLine("     if (header.ToUpper() == \"X-TENANT\") { }");
    Console.WriteLine();

    const string header = "x-tenant";
    const int iterations = 1_000_000;

    Compare("ToUpper() ==                     ", iterations,
        () => header.ToUpper() == "X-TENANT");

    Compare("string.Equals(OrdinalIgnoreCase) ", iterations,
        () => string.Equals(header, "x-tenant", StringComparison.OrdinalIgnoreCase));

    Console.WriteLine();
    Console.WriteLine("   Two problems, and the second is worse than the allocation.");
    Console.WriteLine();
    Console.WriteLine("   1. It allocates a string per call to throw away.");
    Console.WriteLine();
    Console.WriteLine("   2. ToUpper() uses the CURRENT CULTURE. In Turkish, uppercasing");
    Console.WriteLine("      'i' produces a dotted capital I, not 'I'. A header named");
    Console.WriteLine("      'x-idempotency-key' stops matching on a Turkish machine, and");
    Console.WriteLine("      the bug is invisible in every test run in English.");
    Console.WriteLine();
    Console.WriteLine("   StringComparison.OrdinalIgnoreCase compares code units directly.");
    Console.WriteLine("   No allocation, no culture, correct everywhere.");
    Console.WriteLine();

    static void Compare(string label, int iterations, Func<bool> body)
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

        bool last = false;
        for (int i = 0; i < iterations; i++)
        {
            last = body();
        }

        sw.Stop();
        Console.WriteLine($"   {label}   {GC.GetTotalAllocatedBytes(precise: true) - before,10:N0} B   " +
            $"{sw.Elapsed.TotalMilliseconds,5:F0} ms   result {last}");
    }
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — building a key without allocating twice.
// ---------------------------------------------------------------------------
static void Exercise3()
{
    Console.WriteLine("Exercise 3: build a cache key of the form 'tenant:currency:id'");
    Console.WriteLine();

    const string tenant = "acme";
    const string currency = "GBP";
    long id = 4_000_821;
    const int iterations = 500_000;

    Console.WriteLine("   approach                      allocated   per call     time");
    Console.WriteLine("   --------                      ---------   --------     ----");

    Build("concatenation               ", iterations, () =>
        (tenant + ":" + currency + ":" + id.ToString(CultureInfo.InvariantCulture)).Length);

    Build("interpolation               ", iterations, () =>
        string.Create(CultureInfo.InvariantCulture, $"{tenant}:{currency}:{id}").Length);

    Build("string.Create, exact length ", iterations, () =>
    {
        int length = tenant.Length + 1 + currency.Length + 1 + DigitCount(id);

        return string.Create(length, (tenant, currency, id), static (destination, state) =>
        {
            int position = 0;
            state.tenant.AsSpan().CopyTo(destination);
            position += state.tenant.Length;
            destination[position++] = ':';
            state.currency.AsSpan().CopyTo(destination[position..]);
            position += state.currency.Length;
            destination[position++] = ':';
            state.id.TryFormat(destination[position..], out _, default, CultureInfo.InvariantCulture);
        }).Length;
    });

    Console.WriteLine();
    Console.WriteLine("   All three produce the same 16-character string, and a 16-character");
    Console.WriteLine("   string costs 56 bytes. So 56 is the FLOOR here - the caller wants a");
    Console.WriteLine("   string, and one has to exist.");
    Console.WriteLine();
    Console.WriteLine("   Concatenation is 96 bytes because it formats the id into its own");
    Console.WriteLine("   string first and then builds the result: two allocations for one");
    Console.WriteLine("   answer.");
    Console.WriteLine();
    Console.WriteLine("   Interpolation and string.Create BOTH reach the floor at 56 bytes.");
    Console.WriteLine("   string.Create does not win here, and it is slower and about");
    Console.WriteLine("   fifteen lines longer.");
    Console.WriteLine();
    Console.WriteLine("   That is the answer to the exercise: once interpolation has reached");
    Console.WriteLine("   the minimum possible allocation, string.Create has nothing left to");
    Console.WriteLine("   remove. It only pays when interpolation is NOT at the floor -");
    Console.WriteLine("   typically when the alternative would build an intermediate string.");
    Console.WriteLine();
    Console.WriteLine("   Note DigitCount: computing the length must not itself allocate.");
    Console.WriteLine("   Using id.ToString().Length here would undo the whole exercise.");
    Console.WriteLine();
    Console.WriteLine("   And if the key is only used to LOOK UP a dictionary, the right");
    Console.WriteLine("   answer is not to build it at all - use GetAlternateLookup with a");
    Console.WriteLine("   ReadOnlySpan<char>, from .NET 9.");
    Console.WriteLine();

    static void Build(string label, int iterations, Func<int> body)
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
        Console.WriteLine($"   {label}   {allocated,10:N0} B   {allocated / (double)iterations,6:F0} B   " +
            $"{sw.Elapsed.TotalMilliseconds,5:F0} ms   (sink {sink})");
    }
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — the logging guard, and what replaces it.
// ---------------------------------------------------------------------------
static void Exercise4()
{
    Console.WriteLine("Exercise 4: why does this allocate when logging is off?");
    Console.WriteLine();
    Console.WriteLine("     logger.LogDebug($\"settled {id} for {amount:F2}\");");
    Console.WriteLine();

    const int iterations = 500_000;
    long id = 4_000_821;
    decimal amount = 1_234.50m;
    var sink = new Sink();

    Measure("string parameter, no guard   ", iterations, () =>
    {
        sink.TakeString($"settled {id} for {amount:F2}");
        return 0;
    });

    Measure("string parameter, with guard ", iterations, () =>
    {
        if (sink.Enabled)
        {
            sink.TakeString($"settled {id} for {amount:F2}");
        }

        return 0;
    });

    Console.WriteLine();
    Console.WriteLine("   The parameter type is string, so the string must EXIST before the");
    Console.WriteLine("   call. The method cannot decline work that has already happened.");
    Console.WriteLine();
    Console.WriteLine("   Two fixes:");
    Console.WriteLine();
    Console.WriteLine("   1. The guard. Correct, and three extra lines at every call site,");
    Console.WriteLine("      which is why it is so often missing.");
    Console.WriteLine();
    Console.WriteLine("   2. A custom interpolated string handler as the parameter type.");
    Console.WriteLine("      The compiler then asks the handler whether to append, and skips");
    Console.WriteLine("      evaluating the holes entirely if it says no. Demonstrated in");
    Console.WriteLine("      02-interpolated-handlers.cs, where 500,000 disabled calls");
    Console.WriteLine("      formatted 0 values and allocated 376 bytes in total.");
    Console.WriteLine();
    Console.WriteLine("   Microsoft.Extensions.Logging already does this: the LogDebug");
    Console.WriteLine("   overloads take a message template plus arguments precisely so the");
    Console.WriteLine("   formatting can be deferred. Passing an interpolated string to it");
    Console.WriteLine("   defeats the design.");
    Console.WriteLine();

    static void Measure(string label, int iterations, Func<int> body)
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

        for (int i = 0; i < iterations; i++)
        {
            body();
        }

        sw.Stop();
        Console.WriteLine($"   {label}   {GC.GetTotalAllocatedBytes(precise: true) - before,10:N0} B   " +
            $"{sw.Elapsed.TotalMilliseconds,5:F0} ms");
    }
}

// ---------------------------------------------------------------------------
// 5. HARD — parse a fixed-width record from UTF-8 bytes, validating.
// ---------------------------------------------------------------------------
static void Exercise5()
{
    Console.WriteLine("Exercise 5: parse a settlement record from bytes");
    Console.WriteLine();

    ReadOnlySpan<byte> good = "INV-2026-0004821GBP00000012345020260314"u8;
    ReadOnlySpan<byte> badCurrency = "INV-2026-0004821XYZ00000012345020260314"u8;
    ReadOnlySpan<byte> badDate = "INV-2026-0004821GBP00000012345020261332"u8;
    ReadOnlySpan<byte> tooShort = "INV-2026-0004821GBP"u8;

    Report("valid record   ", good);
    Report("bad currency   ", badCurrency);
    Report("bad date       ", badDate);
    Report("too short      ", tooShort);

    Console.WriteLine();
    Console.WriteLine("   Every field is read from the bytes. No string is created at any");
    Console.WriteLine("   point, including for the currency, which becomes an enum.");
    Console.WriteLine();
    Console.WriteLine("   The design rule: spans are for the PARSING, not for the RESULT.");
    Console.WriteLine("   Convert to owned values - numbers, enums, dates - at the boundary,");
    Console.WriteLine("   and the span never escapes the method that read it.");
    Console.WriteLine();

    static void Report(string label, ReadOnlySpan<byte> record)
    {
        if (TryReadRecord(record, out long amount, out Currency currency, out DateOnly date))
        {
            Console.WriteLine($"   {label} : OK    amount {amount,8}  currency {currency,-7}  date {date:yyyy-MM-dd}");
        }
        else
        {
            Console.WriteLine($"   {label} : REJECTED");
        }
    }

    static bool TryReadRecord(ReadOnlySpan<byte> record, out long amountMinor,
        out Currency currency, out DateOnly valueDate)
    {
        amountMinor = 0;
        currency = Currency.Unknown;
        valueDate = default;

        // 16 invoice + 3 currency + 12 amount + 8 date
        if (record.Length < 39)
        {
            return false;
        }

        currency = ReadCurrency(record.Slice(16, 3));
        if (currency == Currency.Unknown)
        {
            return false;
        }

        if (!Utf8Parser.TryParse(record.Slice(19, 12), out amountMinor, out int consumed)
            || consumed != 12)
        {
            return false;
        }

        return TryReadCompactDate(record.Slice(31, 8), out valueDate);
    }

    static Currency ReadCurrency(ReadOnlySpan<byte> field)
    {
        if (field.SequenceEqual("GBP"u8))
        {
            return Currency.Gbp;
        }

        if (field.SequenceEqual("EUR"u8))
        {
            return Currency.Eur;
        }

        if (field.SequenceEqual("USD"u8))
        {
            return Currency.Usd;
        }

        return Currency.Unknown;
    }

    static bool TryReadCompactDate(ReadOnlySpan<byte> field, out DateOnly date)
    {
        date = default;

        foreach (byte b in field)
        {
            if (b < (byte)'0' || b > (byte)'9')
            {
                return false;
            }
        }

        int year = (field[0] - '0') * 1000 + (field[1] - '0') * 100
                 + (field[2] - '0') * 10 + (field[3] - '0');
        int month = (field[4] - '0') * 10 + (field[5] - '0');
        int day = (field[6] - '0') * 10 + (field[7] - '0');

        if (month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month))
        {
            return false;
        }

        date = new DateOnly(year, month, day);
        return true;
    }
}

// ---------------------------------------------------------------------------
// 6. HARD — where the last step is and is not worth taking.
// ---------------------------------------------------------------------------
static void Exercise6()
{
    Console.WriteLine("Exercise 6: writing a response body");
    Console.WriteLine();

    const int iterations = 300_000;
    long id = 4_000_821;
    decimal amount = 1_234.50m;
    long total = 0;

    Console.WriteLine("   approach                          allocated   per call     time");
    Console.WriteLine("   --------                          ---------   --------     ----");

    Measure("string then Encoding.GetBytes  ", iterations, () =>
    {
        string json = string.Create(CultureInfo.InvariantCulture,
            $"{{\"id\":{id},\"amount\":{amount:F2}}}");
        byte[] bytes = Encoding.UTF8.GetBytes(json);
        total += bytes.Length;
        return bytes.Length;
    });

    Measure("Utf8.TryWrite into a stack span", iterations, () =>
    {
        Span<byte> buffer = stackalloc byte[64];
        Utf8.TryWrite(buffer, CultureInfo.InvariantCulture,
            $"{{\"id\":{id},\"amount\":{amount:F2}}}", out int written);
        total += written;
        return written;
    });

    Measure("Utf8Formatter, field by field  ", iterations, () =>
    {
        Span<byte> buffer = stackalloc byte[64];
        int position = 0;

        "{\"id\":"u8.CopyTo(buffer);
        position += 6;
        Utf8Formatter.TryFormat(id, buffer[position..], out int written);
        position += written;
        ",\"amount\":"u8.CopyTo(buffer[position..]);
        position += 10;
        Utf8Formatter.TryFormat(amount, buffer[position..], out written, new StandardFormat('F', 2));
        position += written;
        buffer[position++] = (byte)'}';

        total += position;
        return position;
    });

    Console.WriteLine();
    Console.WriteLine("   The middle row is the interesting one. It creates no string and");
    Console.WriteLine("   still allocates, because each VALUE TYPE hole in the interpolation");
    Console.WriteLine("   is boxed by the handler's generic AppendFormatted on this runtime.");
    Console.WriteLine("   Measured separately: 24 bytes for a long, 32 for a decimal, 0 for");
    Console.WriteLine("   a string hole and 0 for literal text.");
    Console.WriteLine();
    Console.WriteLine("   Where to stop:");
    Console.WriteLine();
    Console.WriteLine("     - Row 2 for almost everything. It reads like interpolation and");
    Console.WriteLine("       removes the string entirely.");
    Console.WriteLine("     - Row 3 only where a measurement says those bytes matter. It is");
    Console.WriteLine("       three times the code and the offsets are hand-maintained.");
    Console.WriteLine();
    Console.WriteLine("   The general rule for this whole module: the version that removes");
    Console.WriteLine("   the INTERMEDIATE string is nearly always worth it. The version");
    Console.WriteLine("   that removes the last few bytes usually is not.");
    Console.WriteLine();
    Console.WriteLine($"   (total bytes written {total:N0})");

    static void Measure(string label, int iterations, Func<int> body)
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

        for (int i = 0; i < iterations; i++)
        {
            body();
        }

        sw.Stop();
        long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;
        Console.WriteLine($"   {label}   {allocated,10:N0} B   {allocated / (double)iterations,6:F0} B   " +
            $"{sw.Elapsed.TotalMilliseconds,5:F0} ms");
    }
}

// ---------------------------------------------------------------------------
static int DigitCount(long value)
{
    int digits = 1;
    while (value >= 10)
    {
        value /= 10;
        digits++;
    }

    return digits;
}

enum Currency
{
    Unknown = 0,
    Gbp,
    Eur,
    Usd
}

sealed class Sink
{
    public bool Enabled => false;

    public int Taken { get; private set; }

    public void TakeString(string message)
    {
        if (!Enabled)
        {
            return;
        }

        Taken += message.Length;
    }
}
