// 03-utf8.cs — UTF-8 literals, formatting straight to bytes, and parsing in
// place without ever creating a string.
//
// Run:  dotnet run 03-utf8.cs -c Release
//
// EXACT vs RATIO: byte counts and parsed values are exact and deterministic.
// Times are ratios.

using System.Buffers;
using System.Buffers.Text;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Unicode;

Console.WriteLine("1. UTF-16 in memory, UTF-8 on the wire");
Console.WriteLine();

TheEncodingGap();
Utf8Literals();
FormattingToBytes();
ParsingInPlace();
TheAsciiAssumption();

// ---------------------------------------------------------------------------
static void TheEncodingGap()
{
    const string ascii = "INV-2026-0004821";
    const string accented = "Ledger Zahlungsübersicht";
    const string emoji = "settled";

    Console.WriteLine("   text                       chars   UTF-16 bytes   UTF-8 bytes");
    Console.WriteLine("   ----                       -----   ------------   -----------");

    foreach (string text in new[] { ascii, accented, emoji })
    {
        Console.WriteLine($"   {text,-24}   {text.Length,5}   {text.Length * 2,12}   " +
            $"{Encoding.UTF8.GetByteCount(text),11}");
    }

    Console.WriteLine();
    Console.WriteLine("   For ASCII, UTF-8 is half the size. That is the whole reason this");
    Console.WriteLine("   module exists: HTTP bodies, JSON, log lines and settlement files");
    Console.WriteLine("   are UTF-8, and decoding them into UTF-16 strings doubles the");
    Console.WriteLine("   memory and costs a conversion pass in each direction.");
    Console.WriteLine();
    Console.WriteLine("   Note the accented row: UTF-8 is LARGER per character there, because");
    Console.WriteLine("   a u-umlaut needs two bytes. UTF-8 is not universally smaller - it is");
    Console.WriteLine("   smaller for the ASCII that dominates machine-readable formats.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Utf8Literals()
{
    Console.WriteLine("2. UTF-8 literals");
    Console.WriteLine();

    // A u8 literal is a ReadOnlySpan<byte> baked into the assembly. No
    // allocation, no encoding at runtime.
    ReadOnlySpan<byte> currency = "GBP"u8;
    ReadOnlySpan<byte> prefix = "PAY-"u8;

    Console.WriteLine($"   \"GBP\"u8 length : {currency.Length} bytes");
    Console.WriteLine($"   first byte     : {currency[0]} ('{(char)currency[0]}')");
    Console.WriteLine();

    const int iterations = 2_000_000;

    Console.WriteLine("   approach                             allocated     time");
    Console.WriteLine("   --------                             ---------     ----");

    Compare("Encoding.UTF8.GetBytes(\"GBP\")     ", iterations, () =>
        Encoding.UTF8.GetBytes("GBP").Length);

    Compare("\"GBP\"u8                           ", iterations, () =>
        "GBP"u8.Length);

    Console.WriteLine();
    Console.WriteLine("   GetBytes allocates a new array on every call. The u8 literal is");
    Console.WriteLine("   data in the assembly, and taking a span over it costs nothing.");
    Console.WriteLine();
    Console.WriteLine($"   (prefix is {prefix.Length} bytes, kept so it is not optimised away)");
    Console.WriteLine();

    static void Compare(string label, int iterations, Func<int> body)
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
        Console.WriteLine($"   {label}   {GC.GetTotalAllocatedBytes(precise: true) - before,10:N0} B   " +
            $"{sw.Elapsed.TotalMilliseconds,5:F0} ms   (sink {sink})");
    }
}

// ---------------------------------------------------------------------------
static void FormattingToBytes()
{
    Console.WriteLine("3. Writing a response body without a string");
    Console.WriteLine();

    const int iterations = 500_000;
    long id = 4_000_821;
    long amountMinor = 123_450;

    Console.WriteLine("   approach                             allocated   per call     time");
    Console.WriteLine("   --------                             ---------   --------     ----");

    Build("string, then GetBytes             ", iterations, () =>
    {
        string json = $"{{\"id\":{id},\"amount\":{amountMinor / 100m:F2}}}";
        byte[] bytes = Encoding.UTF8.GetBytes(json);
        return bytes.Length;
    });

    Build("string, then TryGetBytes to buffer ", iterations, () =>
    {
        Span<byte> buffer = stackalloc byte[64];
        string json = $"{{\"id\":{id},\"amount\":{amountMinor / 100m:F2}}}";
        Encoding.UTF8.TryGetBytes(json, buffer, out int written);
        return written;
    });

    Build("straight to UTF-8, no string      ", iterations, () =>
    {
        Span<byte> buffer = stackalloc byte[64];
        int position = 0;

        "{\"id\":"u8.CopyTo(buffer);
        position += 6;

        Utf8Formatter.TryFormat(id, buffer[position..], out int written);
        position += written;

        ",\"amount\":"u8.CopyTo(buffer[position..]);
        position += 10;

        Utf8Formatter.TryFormat(amountMinor / 100m, buffer[position..], out written,
            new StandardFormat('F', 2));
        position += written;

        buffer[position++] = (byte)'}';
        return position;
    });

    Console.WriteLine();
    Console.WriteLine("   The middle row is the one worth noticing. It writes into a stack");
    Console.WriteLine("   buffer and still allocates, because it builds the STRING first.");
    Console.WriteLine("   Removing the array does not help if the string is still created.");
    Console.WriteLine();
    Console.WriteLine("   Utf8.TryWrite is the tidier form of the third row - it takes an");
    Console.WriteLine("   interpolated string and writes UTF-8 directly:");
    Console.WriteLine();

    Span<byte> demo = stackalloc byte[64];
    if (Utf8.TryWrite(demo, CultureInfo.InvariantCulture,
        $"{{\"id\":{id},\"amount\":{amountMinor / 100m:F2}}}", out int demoWritten))
    {
        Console.WriteLine($"     Utf8.TryWrite -> {Encoding.UTF8.GetString(demo[..demoWritten])}");
    }

    Console.WriteLine();
    Console.WriteLine("   That is an interpolated string handler writing UTF-8 into a span.");
    Console.WriteLine("   Same readability as interpolation, no string produced.");
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
static void ParsingInPlace()
{
    Console.WriteLine("4. Parsing a request line without a string");
    Console.WriteLine();

    ReadOnlySpan<byte> line = "POST /v1/payments/4000821 HTTP/1.1"u8;

    // Find the two spaces. No decoding, no allocation.
    int firstSpace = line.IndexOf((byte)' ');
    ReadOnlySpan<byte> method = line[..firstSpace];

    ReadOnlySpan<byte> rest = line[(firstSpace + 1)..];
    int secondSpace = rest.IndexOf((byte)' ');
    ReadOnlySpan<byte> path = rest[..secondSpace];

    Console.WriteLine($"   raw line : {Encoding.UTF8.GetString(line)}");
    Console.WriteLine($"   method   : {Encoding.UTF8.GetString(method)}  (matched with \"POST\"u8: {method.SequenceEqual("POST"u8)})");
    Console.WriteLine($"   path     : {Encoding.UTF8.GetString(path)}");

    // Pull the id out of the path and parse it, still without a string.
    int lastSlash = path.LastIndexOf((byte)'/');
    ReadOnlySpan<byte> idBytes = path[(lastSlash + 1)..];

    if (Utf8Parser.TryParse(idBytes, out long paymentId, out _))
    {
        Console.WriteLine($"   payment id: {paymentId}   (parsed from bytes, no string created)");
    }

    Console.WriteLine();
    Console.WriteLine("   The GetString calls above exist only to PRINT the result. The");
    Console.WriteLine("   matching and the parsing never needed one.");
    Console.WriteLine();
    Console.WriteLine("   This is what Kestrel does with every request line it receives, and");
    Console.WriteLine("   why an ASP.NET Core request does not allocate a string per header");
    Console.WriteLine("   until something asks for one.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TheAsciiAssumption()
{
    Console.WriteLine("5. Where byte-level work goes wrong");
    Console.WriteLine();

    ReadOnlySpan<byte> accented = "Zahlungsübersicht"u8;

    Console.WriteLine($"   \"Zahlungsübersicht\"");
    Console.WriteLine($"     chars in the string : {"Zahlungsübersicht".Length}");
    Console.WriteLine($"     bytes in UTF-8      : {accented.Length}");
    Console.WriteLine();
    Console.WriteLine("   They differ, because the u-umlaut is two bytes. Three consequences:");
    Console.WriteLine();

    // 1. Byte index is not character index.
    int byteIndex = accented.IndexOf((byte)'b');
    Console.WriteLine($"     IndexOf((byte)'b')  : {byteIndex}");
    Console.WriteLine($"     string.IndexOf('b') : {"Zahlungsübersicht".IndexOf('b')}");
    Console.WriteLine("       Byte offsets and character offsets are different numbers.");
    Console.WriteLine();

    // 2. Slicing at an arbitrary byte can split a character.
    ReadOnlySpan<byte> badSlice = accented[..10];
    Console.WriteLine($"     first 10 bytes decoded: \"{Encoding.UTF8.GetString(badSlice)}\"");
    ReadOnlySpan<byte> worseSlice = accented[..9];
    Console.WriteLine($"     first  9 bytes decoded: \"{Encoding.UTF8.GetString(worseSlice)}\"");
    Console.WriteLine("       Nine bytes cuts the u-umlaut in half and produces a");
    Console.WriteLine("       replacement character. Slicing UTF-8 at an arbitrary offset");
    Console.WriteLine("       is only safe if you know the content is ASCII.");
    Console.WriteLine();

    // 3. Case conversion on bytes is wrong outside ASCII.
    Console.WriteLine("     Uppercasing a byte with (byte)(b - 32) works for ASCII and");
    Console.WriteLine("     corrupts everything else. There is no byte-level ToUpper that");
    Console.WriteLine("     is correct for UTF-8.");
    Console.WriteLine();
    Console.WriteLine("   The rule: byte-level parsing is for data whose format GUARANTEES");
    Console.WriteLine("   ASCII - HTTP methods, header names, numeric fields, currency codes,");
    Console.WriteLine("   ISO dates. For anything a human typed, decode it properly.");
}
