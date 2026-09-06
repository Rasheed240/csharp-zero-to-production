// 03-sequencereader.cs — ReadOnlySequence is not contiguous, and SequenceReader
// is how you parse it without pretending it is.
//
// Run:  dotnet run 03-sequencereader.cs -c Release
//
// EXACT vs RATIO: segment counts and parsed values are deterministic. Allocation
// figures are exact.

using System.Buffers;
using System.Diagnostics;
using System.Text;

Console.WriteLine("1. A sequence can be several disjoint blocks");
Console.WriteLine();

MultiSegment();
TheNaiveMistake();
UsingSequenceReader();
TheFastPath();
DelimiterAcrossASegment();

// ---------------------------------------------------------------------------
static void MultiSegment()
{
    ReadOnlySequence<byte> single = new(Encoding.UTF8.GetBytes("INV-2026-0000001|GBP|123450"));
    ReadOnlySequence<byte> split = BuildSplit("INV-2026-0000001|GBP|123450", 8);

    Console.WriteLine($"   one block   : length {single.Length,3}, IsSingleSegment {single.IsSingleSegment}");
    Console.WriteLine($"   four blocks : length {split.Length,3}, IsSingleSegment {split.IsSingleSegment}");
    Console.WriteLine();

    Console.WriteLine("   the second one, block by block:");
    foreach (ReadOnlyMemory<byte> segment in split)
    {
        Console.WriteLine($"     [{Encoding.UTF8.GetString(segment.Span)}]");
    }

    Console.WriteLine();
    Console.WriteLine("   A pipe hands you memory it owns, taken from a pool in blocks. A");
    Console.WriteLine("   message that spans two blocks arrives as two segments, and the pipe");
    Console.WriteLine("   deliberately does NOT copy them together - that copy is what it");
    Console.WriteLine("   exists to avoid.");
    Console.WriteLine();
    Console.WriteLine("   So every pipe parser must handle data that is not contiguous. That");
    Console.WriteLine("   is the cost of the design, and SequenceReader is the compensation.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. The mistake: assuming FirstSpan is the whole thing.
// ---------------------------------------------------------------------------
static void TheNaiveMistake()
{
    Console.WriteLine("2. WRONG - parsing only the first segment");
    Console.WriteLine();

    ReadOnlySequence<byte> split = BuildSplit("INV-2026-0000001|GBP|123450", 8);

    // FirstSpan is the first block only. On a single-segment sequence it is
    // everything, which is exactly why this passes its tests.
    ReadOnlySpan<byte> first = split.FirstSpan;
    int pipe = first.IndexOf((byte)'|');

    Console.WriteLine($"   sequence length : {split.Length}");
    Console.WriteLine($"   FirstSpan length: {first.Length}");
    Console.WriteLine($"   IndexOf('|')    : {pipe}  (not found)");
    Console.WriteLine();
    Console.WriteLine("   The delimiter is at offset 16, in the third block. Searching only");
    Console.WriteLine("   the first span finds nothing and the parser concludes the message");
    Console.WriteLine("   is incomplete - forever.");
    Console.WriteLine();
    Console.WriteLine("   Against a MemoryStream or a small payload the sequence is a single");
    Console.WriteLine("   segment and this code is correct. It breaks under load, when");
    Console.WriteLine("   messages start spanning pooled blocks.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. SequenceReader does the walking.
// ---------------------------------------------------------------------------
static void UsingSequenceReader()
{
    Console.WriteLine("3. RIGHT - SequenceReader");
    Console.WriteLine();

    ReadOnlySequence<byte> split = BuildSplit("INV-2026-0000001|GBP|123450\n", 8);
    var reader = new SequenceReader<byte>(split);

    if (reader.TryReadTo(out ReadOnlySequence<byte> invoice, (byte)'|') &&
        reader.TryReadTo(out ReadOnlySequence<byte> currency, (byte)'|') &&
        reader.TryReadTo(out ReadOnlySequence<byte> amount, (byte)'\n'))
    {
        Console.WriteLine($"   invoice  : \"{Encoding.UTF8.GetString(invoice)}\"");
        Console.WriteLine($"   currency : \"{Encoding.UTF8.GetString(currency)}\"");
        Console.WriteLine($"   amount   : \"{Encoding.UTF8.GetString(amount)}\"");
        Console.WriteLine($"   consumed : {reader.Consumed} of {split.Length}");
    }

    Console.WriteLine();
    Console.WriteLine("   TryReadTo advances past the delimiter and hands back everything");
    Console.WriteLine("   before it, crossing segment boundaries without you noticing.");
    Console.WriteLine();
    Console.WriteLine("   It returns FALSE when the delimiter is not present, which is the");
    Console.WriteLine("   signal to wait for more data - and is exactly the case the naive");
    Console.WriteLine("   version above could not distinguish from a parse failure.");
    Console.WriteLine();

    // The other members worth knowing.
    var counted = new SequenceReader<byte>(BuildSplit("ABCD1234", 3));

    counted.TryRead(out byte firstByte);
    counted.TryReadExact(3, out ReadOnlySequence<byte> next3);

    Console.WriteLine($"   TryRead        -> '{(char)firstByte}'");
    Console.WriteLine($"   TryReadExact(3)-> \"{Encoding.UTF8.GetString(next3)}\"");
    Console.WriteLine($"   Remaining      : {counted.Remaining} bytes");
    Console.WriteLine($"   UnreadSpan     : {counted.UnreadSpan.Length} bytes (the current block only)");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. The single-segment fast path, which is worth writing and worth measuring.
// ---------------------------------------------------------------------------
static void TheFastPath()
{
    Console.WriteLine("4. The fast path for the common case");
    Console.WriteLine();

    byte[] payload = Encoding.UTF8.GetBytes("INV-2026-0000001|GBP|123450\n");
    ReadOnlySequence<byte> contiguous = new(payload);
    ReadOnlySequence<byte> fragmented = BuildSplit("INV-2026-0000001|GBP|123450\n", 8);

    const int iterations = 500_000;

    double spanTime = Time(() => FindNewlineFast(contiguous), iterations);
    double readerTime = Time(() => FindNewlineGeneral(contiguous), iterations);
    double fragmentedTime = Time(() => FindNewlineGeneral(fragmented), iterations);

    Console.WriteLine("   approach                              sequence      time");
    Console.WriteLine("   --------                              --------      ----");
    Console.WriteLine($"   FirstSpan.IndexOf (fast path)         one block  {spanTime,6:F0} ms");
    Console.WriteLine($"   SequenceReader.TryReadTo              one block  {readerTime,6:F0} ms");
    Console.WriteLine($"   SequenceReader.TryReadTo            four blocks  {fragmentedTime,6:F0} ms");
    Console.WriteLine();
    Console.WriteLine("   Most reads ARE a single segment, because a message usually fits in");
    Console.WriteLine("   one pooled block. Checking IsSingleSegment and using the vectorised");
    Console.WriteLine("   span search when it is true is the standard shape:");
    Console.WriteLine();
    Console.WriteLine("     if (buffer.IsSingleSegment)  ->  buffer.FirstSpan.IndexOf(delimiter)");
    Console.WriteLine("     else                         ->  SequenceReader");
    Console.WriteLine();
    Console.WriteLine("   Write the general path FIRST and test it with a fragmented");
    Console.WriteLine("   sequence. A fast path added to a correct parser is an optimisation;");
    Console.WriteLine("   a fast path that is the only path is the bug in section 2.");
    Console.WriteLine();

    static long FindNewlineFast(ReadOnlySequence<byte> buffer)
    {
        if (buffer.IsSingleSegment)
        {
            return buffer.FirstSpan.IndexOf((byte)'\n');
        }

        return FindNewlineGeneral(buffer);
    }

    static long FindNewlineGeneral(ReadOnlySequence<byte> buffer)
    {
        var reader = new SequenceReader<byte>(buffer);
        return reader.TryReadTo(out ReadOnlySequence<byte> line, (byte)'\n') ? line.Length : -1;
    }

    static double Time(Func<long> body, int iterations)
    {
        for (int i = 0; i < 1_000; i++)
        {
            body();
        }

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
// 5. A multi-byte delimiter split across a segment boundary.
// ---------------------------------------------------------------------------
static void DelimiterAcrossASegment()
{
    Console.WriteLine("5. When the delimiter itself straddles two blocks");
    Console.WriteLine();

    // "\r\n" with the \r ending one block and the \n starting the next.
    var first = new Segment(Encoding.UTF8.GetBytes("INV-2026\r"));
    Segment second = first.Append(Encoding.UTF8.GetBytes("\nGBP"));
    var sequence = new ReadOnlySequence<byte>(first, 0, second, second.Memory.Length);

    Console.WriteLine($"   blocks       : [INV-2026\\r] [\\nGBP]");
    Console.WriteLine($"   IsSingleSegment: {sequence.IsSingleSegment}");
    Console.WriteLine();

    // Searching for the two-byte delimiter with a per-segment span search
    // cannot find it - it is in neither block.
    bool foundBySpanSearch = false;
    foreach (ReadOnlyMemory<byte> segment in sequence)
    {
        if (segment.Span.IndexOf("\r\n"u8) >= 0)
        {
            foundBySpanSearch = true;
        }
    }

    var reader = new SequenceReader<byte>(sequence);
    bool foundByReader = reader.TryReadTo(out ReadOnlySequence<byte> line, "\r\n"u8);

    Console.WriteLine($"   per-segment span search found it : {foundBySpanSearch}");
    Console.WriteLine($"   SequenceReader found it          : {foundByReader}");

    if (foundByReader)
    {
        Console.WriteLine($"   line                             : \"{Encoding.UTF8.GetString(line)}\"");
    }

    Console.WriteLine();
    Console.WriteLine("   A multi-byte delimiter can be split across a block boundary, so a");
    Console.WriteLine("   parser that searches each segment separately misses it entirely -");
    Console.WriteLine("   and then waits forever for a message that has already arrived.");
    Console.WriteLine();
    Console.WriteLine("   This is why HTTP parsers look for the header terminator with a");
    Console.WriteLine("   reader rather than a loop over segments. It is also the hardest");
    Console.WriteLine("   version of this bug to reproduce, because it needs the split to");
    Console.WriteLine("   land on exactly the wrong byte.");
}

// ---------------------------------------------------------------------------
static ReadOnlySequence<byte> BuildSplit(string text, int blockSize)
{
    byte[] bytes = Encoding.UTF8.GetBytes(text);

    var first = new Segment(bytes.AsMemory(0, Math.Min(blockSize, bytes.Length)));
    Segment last = first;

    for (int offset = blockSize; offset < bytes.Length; offset += blockSize)
    {
        int length = Math.Min(blockSize, bytes.Length - offset);
        last = last.Append(bytes.AsMemory(offset, length));
    }

    return new ReadOnlySequence<byte>(first, 0, last, last.Memory.Length);
}

// The minimum implementation of a linked sequence segment. A pipe builds these
// from pooled blocks; this one builds them from slices of one array so the
// fragmentation can be chosen exactly.
sealed class Segment : ReadOnlySequenceSegment<byte>
{
    public Segment(ReadOnlyMemory<byte> memory) => Memory = memory;

    public Segment Append(ReadOnlyMemory<byte> memory)
    {
        var next = new Segment(memory)
        {
            RunningIndex = RunningIndex + Memory.Length
        };

        Next = next;
        return next;
    }
}
