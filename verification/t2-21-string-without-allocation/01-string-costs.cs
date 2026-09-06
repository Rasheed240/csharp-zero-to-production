// 01-string-costs.cs — What a string costs, and which ordinary-looking string
// operations allocate a second one.
//
// Run:  dotnet run 01-string-costs.cs -c Release
//
// EXACT vs RATIO: byte counts are exact and deterministic. Times are ratios.

using System.Diagnostics;
using System.Globalization;

Console.WriteLine("1. What a string costs");
Console.WriteLine();

WhatAStringCosts();
OperationsThatAllocate();
ComparisonWithoutAllocating();
BuildingOneString();

// ---------------------------------------------------------------------------
static void WhatAStringCosts()
{
    Console.WriteLine("   length   measured bytes   per char");
    Console.WriteLine("   ------   --------------   --------");

    foreach (int length in new[] { 0, 1, 8, 16, 64, 256 })
    {
        long bytes = MeasureOne(length);
        Console.WriteLine($"   {length,6}   {bytes,14:N0}   {(length == 0 ? 0 : (bytes - 22.0) / length),8:F1}");
    }

    Console.WriteLine();
    Console.WriteLine("   A .NET string is UTF-16: TWO bytes per character, whatever the");
    Console.WriteLine("   content. Plus a 22-byte overhead on 64-bit - 8 sync block, 8 method");
    Console.WriteLine("   table pointer, 4 length field, 2 for the null terminator - rounded");
    Console.WriteLine("   up to an 8-byte boundary.");
    Console.WriteLine();
    Console.WriteLine("   So \"GBP\" costs 32 bytes, not 3. A settlement file that is 16 MB of");
    Console.WriteLine("   ASCII on disk becomes 32 MB the moment it is decoded into strings.");
    Console.WriteLine();

    static long MeasureOne(int length)
    {
        const int count = 100_000;
        var source = new string('x', length);

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);
        long sink = 0;
        for (int i = 0; i < count; i++)
        {
            // new string(char[]) forces a genuine allocation each time,
            // rather than returning an interned literal.
            var copy = new string(source.AsSpan());
            sink += copy.Length;
        }

        _ = sink;
        return (GC.GetTotalAllocatedBytes(precise: true) - before) / count;
    }
}

// ---------------------------------------------------------------------------
static void OperationsThatAllocate()
{
    Console.WriteLine("2. Operations that quietly produce a second string");
    Console.WriteLine();

    const string sample = "  INV-2026-0004821  ";

    Console.WriteLine("   operation                          allocated per call");
    Console.WriteLine("   ---------                          ------------------");

    const string lower = "  inv-2026-0004821  ";

    Measure("Trim()                          ", () => sample.Trim().Length);
    Measure("AsSpan().Trim()                 ", () => sample.AsSpan().Trim().Length);
    Measure("ToUpperInvariant(), has lowercase", () => lower.ToUpperInvariant().Length);
    Measure("ToUpperInvariant(), already upper", () => sample.ToUpperInvariant().Length);
    Measure("Substring(2, 16)                ", () => sample.Substring(2, 16).Length);
    Measure("AsSpan(2, 16)                   ", () => sample.AsSpan(2, 16).Length);
    Measure("Replace(\"-\", \"\")                ", () => sample.Replace("-", "").Length);
    Measure("PadLeft(30)                     ", () => sample.PadLeft(30).Length);
    Measure("string.Concat(a, b)             ", () => string.Concat(sample, sample).Length);
    Measure("ToString() on a string          ", () => sample.ToString().Length);

    Console.WriteLine();
    Console.WriteLine("   Two rows allocate nothing for the same reason: when the result");
    Console.WriteLine("   would be identical to the input, the BCL returns the input.");
    Console.WriteLine("   ToString() on a string always does. ToUpperInvariant does it only");
    Console.WriteLine("   when there was nothing to change - which is why the two");
    Console.WriteLine("   ToUpperInvariant rows differ, on the same method, by their DATA.");
    Console.WriteLine();
    Console.WriteLine("   That is worth knowing when benchmarking: a case-conversion");
    Console.WriteLine("   measured on already-uppercase test data reports zero cost and");
    Console.WriteLine("   tells you nothing about production.");
    Console.WriteLine();
    Console.WriteLine("   Every other line produces a new string, because strings are");
    Console.WriteLine("   immutable. There is no in-place Trim, no in-place ToUpper. The");
    Console.WriteLine("   method names read like mutations and none of them are.");
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
static void ComparisonWithoutAllocating()
{
    Console.WriteLine("3. Case-insensitive comparison without allocating");
    Console.WriteLine();

    const string header = "X-Tenant";
    const string wanted = "x-tenant";
    const int iterations = 2_000_000;

    Console.WriteLine("   approach                                  allocated     time   result");
    Console.WriteLine("   --------                                  ---------     ----   ------");

    Compare("ToUpperInvariant() ==                 ", () =>
        header.ToUpperInvariant() == wanted.ToUpperInvariant());

    Compare("ToLowerInvariant() ==                 ", () =>
        header.ToLowerInvariant() == wanted);

    Compare("string.Equals(OrdinalIgnoreCase)      ", () =>
        string.Equals(header, wanted, StringComparison.OrdinalIgnoreCase));

    Compare("span.Equals(OrdinalIgnoreCase)        ", () =>
        header.AsSpan().Equals(wanted, StringComparison.OrdinalIgnoreCase));

    Console.WriteLine();
    Console.WriteLine("   The ToUpper version allocates two strings to throw both away, and");
    Console.WriteLine("   it is also WRONG in a way that has caused real incidents. In");
    Console.WriteLine("   Turkish, uppercasing 'i' gives a dotted capital I, so a case-");
    Console.WriteLine("   insensitive match on 'id' fails on a Turkish machine.");
    Console.WriteLine();
    Console.WriteLine("   StringComparison.OrdinalIgnoreCase compares code units directly:");
    Console.WriteLine("   no allocation, no culture, and correct everywhere. Use it for");
    Console.WriteLine("   identifiers, header names, file paths and protocol tokens.");
    Console.WriteLine();
    Console.WriteLine("   Use a culture-aware comparison only for text a HUMAN will read as");
    Console.WriteLine("   sorted - names in a list, search results. Never for identifiers.");
    Console.WriteLine();

    static void Compare(string label, Func<bool> body)
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

        bool last = false;
        for (int i = 0; i < iterations; i++)
        {
            last = body();
        }

        sw.Stop();
        long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;
        Console.WriteLine($"   {label}   {allocated,9:N0} B   {sw.Elapsed.TotalMilliseconds,5:F0} ms   {last}");
    }
}

// ---------------------------------------------------------------------------
static void BuildingOneString()
{
    Console.WriteLine("4. Four ways to build the same string");
    Console.WriteLine();

    const int iterations = 500_000;
    long id = 4_000_821;
    const string currency = "GBP";
    long amountMinor = 123_450;

    Console.WriteLine("   approach                     allocated   per call     time");
    Console.WriteLine("   --------                     ---------   --------     ----");

    Build("concatenation with +      ", () =>
        ("PAY-" + id.ToString(CultureInfo.InvariantCulture) + " " + currency + " "
         + (amountMinor / 100m).ToString("F2", CultureInfo.InvariantCulture)).Length);

    Build("string.Format             ", () =>
        string.Format(CultureInfo.InvariantCulture, "PAY-{0} {1} {2:F2}",
            id, currency, amountMinor / 100m).Length);

    Build("interpolation             ", () =>
    {
        string line = string.Create(CultureInfo.InvariantCulture,
            $"PAY-{id} {currency} {amountMinor / 100m:F2}");
        return line.Length;
    });

    Build("string.Create, exact size ", () =>
    {
        Span<char> scratch = stackalloc char[24];
        (amountMinor / 100m).TryFormat(scratch, out int amountLength, "F2", CultureInfo.InvariantCulture);

        // Count the digits WITHOUT calling ToString. The first version of this
        // measurement used id.ToString().Length to get the length, which
        // allocates - and made string.Create allocate MORE than the
        // interpolation it was supposed to beat: 112 bytes against 104.
        int idLength = DigitCount(id);
        int length = 4 + idLength + 1 + currency.Length + 1 + amountLength;

        string line = string.Create(length, (id, currency, amountMinor),
            static (destination, state) =>
            {
                int position = 0;
                "PAY-".AsSpan().CopyTo(destination);
                position += 4;
                state.id.TryFormat(destination[position..], out int written,
                    default, CultureInfo.InvariantCulture);
                position += written;
                destination[position++] = ' ';
                state.currency.AsSpan().CopyTo(destination[position..]);
                position += state.currency.Length;
                destination[position++] = ' ';
                (state.amountMinor / 100m).TryFormat(destination[position..], out written,
                    "F2", CultureInfo.InvariantCulture);
            });

        return line.Length;
    });

    Console.WriteLine();
    Console.WriteLine("   Note the third row. Interpolation in modern C# does NOT compile to");
    Console.WriteLine("   string.Format - it compiles to DefaultInterpolatedStringHandler,");
    Console.WriteLine("   which writes into a pooled buffer and produces one string at the");
    Console.WriteLine("   end. That is why it beats both + and string.Format.");
    Console.WriteLine();
    Console.WriteLine("   The last row wins on allocation - 72 bytes against 104 - because");
    Console.WriteLine("   it allocates the final string at exactly the right length with no");
    Console.WriteLine("   intermediate buffer at all.");
    Console.WriteLine();
    Console.WriteLine("   It is also SLOWER than interpolation on the clock, and it is about");
    Console.WriteLine("   twenty lines against one. Both of those are the real cost, and");
    Console.WriteLine("   neither shows up in the allocation column.");
    Console.WriteLine();
    Console.WriteLine("   Getting the exact length is the hard part, and it is where this");
    Console.WriteLine("   technique goes wrong. The first version of this file computed the");
    Console.WriteLine("   id length with id.ToString().Length - which allocates, and made");
    Console.WriteLine("   string.Create allocate MORE than the interpolation it replaced:");
    Console.WriteLine("   112 bytes against 104. It now counts digits arithmetically.");
    Console.WriteLine();
    Console.WriteLine("   If you cannot compute the length without allocating, use");
    Console.WriteLine("   interpolation. It is close, it is one line, and it is correct.");
    Console.WriteLine();

    static void Build(string label, Func<int> body)
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

// Digits in a non-negative long, without allocating a string to count them.
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
