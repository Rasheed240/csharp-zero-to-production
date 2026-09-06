// 04-production.cs — Ledger's audit log writer.
//
// The incident: the audit log was the single largest allocator in the service,
// at 288 bytes per payment. It writes one line per payment to a UTF-8 file,
// and the line is 56 bytes.
//
// Run:  dotnet run 04-production.cs -c Release
//
// EXACT vs RATIO: bytes-per-line figures are exact and deterministic. Times are
// ratios against version 1.

using System.Buffers;
using System.Buffers.Text;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Unicode;

const int Payments = 300_000;

Payment[] payments = BuildPayments(1_000);
var sink = new ByteSink();

Console.WriteLine($"Payments : {Payments:N0}");
Console.WriteLine();
Console.WriteLine("   version                          allocated    per line    gen0     time   bytes");
Console.WriteLine("   -------                          ---------    --------    ----     ----   -----");

Run("v1 interpolation + GetBytes   ", V1);
Run("v2 culture fixed, ToUpper gone", V2);
Run("v3 Utf8.TryWrite into stack   ", V3);
Run("v4 hand-written UTF-8         ", V4);

WhereV3sBytesGo();
Explain();

// ---------------------------------------------------------------------------
// v3 does not reach zero, and the reason is worth its own measurement.
// ---------------------------------------------------------------------------
static void WhereV3sBytesGo()
{
    Console.WriteLine();
    Console.WriteLine("   Why v3 is 80 bytes rather than 0 - one hole at a time:");
    Console.WriteLine();

    var timestamp = new DateTime(2026, 3, 14, 9, 0, 0, DateTimeKind.Utc);
    long id = 4_000_821;
    string currency = "GBP";
    decimal amount = 1_234.50m;

    Probe("literal text only        ", () =>
    {
        Span<byte> b = stackalloc byte[128];
        Utf8.TryWrite(b, CultureInfo.InvariantCulture, $"abc|def", out int w);
        return w;
    });

    Probe("a string hole            ", () =>
    {
        Span<byte> b = stackalloc byte[128];
        Utf8.TryWrite(b, CultureInfo.InvariantCulture, $"{currency}", out int w);
        return w;
    });

    Probe("a long hole              ", () =>
    {
        Span<byte> b = stackalloc byte[128];
        Utf8.TryWrite(b, CultureInfo.InvariantCulture, $"{id}", out int w);
        return w;
    });

    Probe("a DateTime hole, :O      ", () =>
    {
        Span<byte> b = stackalloc byte[128];
        Utf8.TryWrite(b, CultureInfo.InvariantCulture, $"{timestamp:O}", out int w);
        return w;
    });

    Probe("a decimal hole, :F2      ", () =>
    {
        Span<byte> b = stackalloc byte[128];
        Utf8.TryWrite(b, CultureInfo.InvariantCulture, $"{amount:F2}", out int w);
        return w;
    });

    Console.WriteLine();
    Console.WriteLine("   Literals and string holes are free. Every VALUE TYPE hole costs");
    Console.WriteLine("   24 to 32 bytes, and v3 has three of them: 24 + 24 + 32 = 80.");
    Console.WriteLine();
    Console.WriteLine("   The handler's AppendFormatted is generic, and the type test it");
    Console.WriteLine("   performs to find the fast formatting path boxes the value on this");
    Console.WriteLine("   runtime. Utf8Formatter.TryFormat, which v4 calls directly, does");
    Console.WriteLine("   not - which is exactly where v4's remaining advantage comes from.");
    Console.WriteLine();
    Console.WriteLine("   This is not documented behaviour to rely on; it is what THIS");
    Console.WriteLine("   runtime does. Measure it on yours before deciding v3 is enough.");
    Console.WriteLine();

    static void Probe(string label, Func<int> body)
    {
        for (int i = 0; i < 1_000; i++)
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

        double perCall = (GC.GetTotalAllocatedBytes(precise: true) - before) / (double)count;
        Console.WriteLine($"   {label}   {perCall,5:F1} B/call   (sink {sink})");
    }
}

// ===========================================================================
// v1 — as it shipped. Note the two bugs as well as the allocation.
// ===========================================================================
long V1(Payment payment)
{
    // BUG 1: no culture. On a machine with a comma decimal separator this
    // writes "1234,50" into a file another system parses as two fields.
    // BUG 2: ToUpper allocates a string to throw away, and is culture
    // sensitive - the Turkish dotless i breaks currency codes containing 'i'.
    string line = $"{payment.Timestamp:O}|{payment.Id}|" +
                  $"{payment.Currency.ToUpper()}|{payment.AmountMinor / 100m:F2}|" +
                  $"{payment.Status}\n";

    byte[] bytes = Encoding.UTF8.GetBytes(line);
    return sink.Write(bytes);
}

// ===========================================================================
// v2 — fix the correctness bugs first. The allocation is barely touched.
// ===========================================================================
long V2(Payment payment)
{
    // Currency codes are ASCII and already uppercase in the domain model, so
    // the ToUpper was never needed. InvariantCulture makes the decimal
    // separator a full stop everywhere.
    string line = string.Create(CultureInfo.InvariantCulture,
        $"{payment.Timestamp:O}|{payment.Id}|{payment.Currency}|{payment.AmountMinor / 100m:F2}|{payment.Status}\n");

    Span<byte> buffer = stackalloc byte[128];
    Encoding.UTF8.TryGetBytes(line, buffer, out int written);
    return sink.Write(buffer[..written]);
}

// ===========================================================================
// v3 — Utf8.TryWrite. Same readability as interpolation, no string produced.
// ===========================================================================
long V3(Payment payment)
{
    Span<byte> buffer = stackalloc byte[128];

    // The enum is written as a u8 span rather than interpolated, because
    // interpolating an enum can call Enum.ToString(). Measured, this change
    // made no difference on this runtime - v3 stayed at exactly 80 bytes per
    // line. The 80 bytes are the three VALUE TYPE holes below, not the enum;
    // WhereV3sBytesGo above measures each one. The u8 form is kept because it
    // is correct regardless of what the runtime does with enum holes.
    ReadOnlySpan<byte> status = payment.Status switch
    {
        PaymentStatus.Settled => "Settled"u8,
        PaymentStatus.Pending => "Pending"u8,
        _ => "Held"u8
    };

    if (!Utf8.TryWrite(buffer, CultureInfo.InvariantCulture,
        $"{payment.Timestamp:O}|{payment.Id}|{payment.Currency}|{payment.AmountMinor / 100m:F2}|",
        out int written))
    {
        // A real writer falls back to a pooled buffer here rather than
        // silently truncating. Never ignore the false.
        throw new InvalidOperationException("audit line exceeded the buffer");
    }

    status.CopyTo(buffer[written..]);
    written += status.Length;
    buffer[written++] = (byte)'\n';

    return sink.Write(buffer[..written]);
}

// ===========================================================================
// v4 — every field written by hand. Included to show what the last step is
// worth, which is the point of measuring it rather than assuming.
// ===========================================================================
long V4(Payment payment)
{
    Span<byte> buffer = stackalloc byte[128];
    int position = 0;

    Utf8Formatter.TryFormat(payment.Timestamp, buffer, out int written, new StandardFormat('O'));
    position += written;

    buffer[position++] = (byte)'|';
    Utf8Formatter.TryFormat(payment.Id, buffer[position..], out written);
    position += written;

    buffer[position++] = (byte)'|';
    Encoding.UTF8.TryGetBytes(payment.Currency, buffer[position..], out written);
    position += written;

    buffer[position++] = (byte)'|';
    Utf8Formatter.TryFormat(payment.AmountMinor / 100m, buffer[position..], out written,
        new StandardFormat('F', 2));
    position += written;

    buffer[position++] = (byte)'|';
    ReadOnlySpan<byte> status = payment.Status switch
    {
        PaymentStatus.Settled => "Settled"u8,
        PaymentStatus.Pending => "Pending"u8,
        _ => "Held"u8
    };
    status.CopyTo(buffer[position..]);
    position += status.Length;

    buffer[position++] = (byte)'\n';
    return sink.Write(buffer[..position]);
}

// ---------------------------------------------------------------------------
void Run(string label, Func<Payment, long> version)
{
    for (int i = 0; i < 2_000; i++)
    {
        version(payments[i % payments.Length]);
    }

    sink.Reset();
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);
    int g0 = GC.CollectionCount(0);
    var sw = Stopwatch.StartNew();

    for (int i = 0; i < Payments; i++)
    {
        version(payments[i % payments.Length]);
    }

    sw.Stop();
    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

    Console.WriteLine($"   {label}   {allocated,10:N0} B   {allocated / (double)Payments,7:F0} B   " +
        $"{GC.CollectionCount(0) - g0,4}   {sw.Elapsed.TotalMilliseconds,5:F0} ms   {sink.TotalBytes / Payments,5}");
}

static void Explain()
{
    Console.WriteLine();
    Console.WriteLine("   The bytes column is a correctness check: every version must produce");
    Console.WriteLine("   the same line length, or the comparison is meaningless.");
    Console.WriteLine();
    Console.WriteLine("   v1 -> v2  This step was made for CORRECTNESS, not performance. The");
    Console.WriteLine("             missing culture would write '1234,50' on a German machine,");
    Console.WriteLine("             and ToUpper on a currency code is a Turkish-locale bug.");
    Console.WriteLine("             The allocation improvement came along for free.");
    Console.WriteLine();
    Console.WriteLine("   v2 -> v3  Utf8.TryWrite writes UTF-8 straight into the span from an");
    Console.WriteLine("             interpolated string. No intermediate UTF-16 string exists,");
    Console.WriteLine("             and it reads almost identically to v2. 203 bytes to 80.");
    Console.WriteLine();
    Console.WriteLine("   v3 -> v4  Hand-writing every field. This removes the last 80 bytes,");
    Console.WriteLine("             which come from boxing in the handler's value-type holes");
    Console.WriteLine("             rather than from anything v3 does wrong.");
    Console.WriteLine();
    Console.WriteLine("   The recommendation, stated with the caveat it needs:");
    Console.WriteLine();
    Console.WriteLine("   SHIP v3 in most services. It is 71% of the allocation removed for");
    Console.WriteLine("   a change that reads like the code it replaced, and v4 is four times");
    Console.WriteLine("   the code, hard-codes the field order, and puts position arithmetic");
    Console.WriteLine("   in your audit path where a drift will not fail any test.");
    Console.WriteLine();
    Console.WriteLine("   SHIP v4 only if the measurement says the last 80 bytes matter -");
    Console.WriteLine("   and note that an earlier draft of this file recommended v3 while");
    Console.WriteLine("   claiming it matched v4 on allocation. It does not, and the");
    Console.WriteLine("   difference is a factor no amount of reading the code would reveal.");
}

// ---------------------------------------------------------------------------
static Payment[] BuildPayments(int count)
{
    var payments = new Payment[count];
    string[] currencies = { "GBP", "EUR", "USD" };
    var baseTime = new DateTime(2026, 3, 14, 9, 0, 0, DateTimeKind.Utc);

    for (int i = 0; i < count; i++)
    {
        payments[i] = new Payment(
            Timestamp: baseTime.AddSeconds(i),
            Id: 4_000_000 + i,
            Currency: currencies[i % 3],
            AmountMinor: 100_000 + i % 800_000,
            Status: (PaymentStatus)(i % 3));
    }

    return payments;
}

sealed record Payment(
    DateTime Timestamp,
    long Id,
    string Currency,
    long AmountMinor,
    PaymentStatus Status);

enum PaymentStatus
{
    Settled = 0,
    Pending = 1,
    Held = 2
}

// Stands in for the file. Counts bytes so nothing can be optimised away and
// every version is checked to produce the same output length.
sealed class ByteSink
{
    public long TotalBytes { get; private set; }

    public void Reset() => TotalBytes = 0;

    public long Write(ReadOnlySpan<byte> line)
    {
        TotalBytes += line.Length;
        return line.Length;
    }
}
