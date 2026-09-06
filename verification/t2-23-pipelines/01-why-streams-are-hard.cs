// 01-why-streams-are-hard.cs — The message framing problem, which is the reason
// System.IO.Pipelines exists.
//
// Run:  dotnet run 01-why-streams-are-hard.cs -c Release
//
// EXACT vs RATIO: every result is deterministic. The stream below delivers a
// fixed, chosen split of the same bytes, so the failures reproduce identically.

using System.Text;

Console.WriteLine("1. A stream has no concept of a message");
Console.WriteLine();

TheFramingProblem();
NaiveParserFails();
GrowingBufferParser();
WhatItCostsToGetRight();

// ---------------------------------------------------------------------------
static void TheFramingProblem()
{
    Console.WriteLine("   Ledger's partner feed sends newline-delimited records:");
    Console.WriteLine();
    Console.WriteLine("     INV-2026-0000001|GBP|123450\\n");
    Console.WriteLine("     INV-2026-0000002|EUR|998877\\n");
    Console.WriteLine();
    Console.WriteLine("   TCP delivers BYTES. It has no idea where your records begin or");
    Console.WriteLine("   end. One read can return:");
    Console.WriteLine();
    Console.WriteLine("     - half a record");
    Console.WriteLine("     - one record exactly");
    Console.WriteLine("     - two and a half records");
    Console.WriteLine("     - a single byte");
    Console.WriteLine();
    Console.WriteLine("   Turning a byte stream back into messages is called FRAMING, and");
    Console.WriteLine("   the code that does it correctly is where the difficulty lives.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. The parser everybody writes first.
// ---------------------------------------------------------------------------
static void NaiveParserFails()
{
    Console.WriteLine("2. WRONG - parsing each read independently");
    Console.WriteLine();

    // Three records, delivered in chunks that do not align with the newlines.
    byte[] payload = Encoding.UTF8.GetBytes(
        "INV-2026-0000001|GBP|123450\n" +
        "INV-2026-0000002|EUR|998877\n" +
        "INV-2026-0000003|USD|000042\n");

    using var stream = new SplittingStream(payload, chunkSize: 20);

    var buffer = new byte[64];
    var found = new List<string>();
    int read;

    while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
    {
        // The bug: this treats each read as if it contained whole records.
        ReadOnlySpan<byte> chunk = buffer.AsSpan(0, read);

        while (true)
        {
            int newline = chunk.IndexOf((byte)'\n');
            if (newline < 0)
            {
                break;      // the remainder is silently discarded
            }

            found.Add(Encoding.UTF8.GetString(chunk[..newline]));
            chunk = chunk[(newline + 1)..];
        }
    }

    Console.WriteLine($"   records sent  : 3");
    Console.WriteLine($"   records found : {found.Count}");
    foreach (string record in found)
    {
        Console.WriteLine($"     \"{record}\"");
    }

    Console.WriteLine();
    Console.WriteLine("   Every record is corrupt, because each one straddles a read boundary");
    Console.WriteLine("   and the leftover bytes at the end of each chunk are thrown away.");
    Console.WriteLine();
    Console.WriteLine("   Note the COUNT is right: 3 sent, 3 found. A test asserting on the");
    Console.WriteLine("   number of records passes. Only the contents are wrong, which is");
    Console.WriteLine("   the shape of bug that reaches production most reliably.");
    Console.WriteLine();
    Console.WriteLine("   Note this parser works perfectly against a MemoryStream, which");
    Console.WriteLine("   returns everything in one read. It fails only against a real");
    Console.WriteLine("   socket, which is where it will be deployed.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. The fix everybody writes second, and what it costs.
// ---------------------------------------------------------------------------
static void GrowingBufferParser()
{
    Console.WriteLine("3. The usual fix - accumulate into a growing buffer");
    Console.WriteLine();

    byte[] payload = Encoding.UTF8.GetBytes(
        "INV-2026-0000001|GBP|123450\n" +
        "INV-2026-0000002|EUR|998877\n" +
        "INV-2026-0000003|USD|000042\n");

    using var stream = new SplittingStream(payload, chunkSize: 20);

    var accumulator = new byte[64];
    int accumulated = 0;
    int resizes = 0;
    int copies = 0;
    var found = new List<string>();

    var readBuffer = new byte[20];
    int read;

    while ((read = stream.Read(readBuffer, 0, readBuffer.Length)) > 0)
    {
        // Grow if the new data does not fit.
        if (accumulated + read > accumulator.Length)
        {
            Array.Resize(ref accumulator, accumulator.Length * 2);
            resizes++;
        }

        Array.Copy(readBuffer, 0, accumulator, accumulated, read);
        copies++;
        accumulated += read;

        // Consume every complete record currently buffered.
        int start = 0;
        while (true)
        {
            int newline = Array.IndexOf(accumulator, (byte)'\n', start, accumulated - start);
            if (newline < 0)
            {
                break;
            }

            found.Add(Encoding.UTF8.GetString(accumulator, start, newline - start));
            start = newline + 1;
        }

        // Shuffle the unconsumed remainder to the front.
        if (start > 0)
        {
            Array.Copy(accumulator, start, accumulator, 0, accumulated - start);
            copies++;
            accumulated -= start;
        }
    }

    Console.WriteLine($"   records found : {found.Count}");
    foreach (string record in found)
    {
        Console.WriteLine($"     \"{record}\"");
    }

    Console.WriteLine();
    Console.WriteLine($"   buffer resizes: {resizes}");
    Console.WriteLine($"   memory copies : {copies}");
    Console.WriteLine();
    Console.WriteLine("   This is CORRECT. It is also the code that everybody gets wrong at");
    Console.WriteLine("   least once, and it has four separate concerns tangled together:");
    Console.WriteLine();
    Console.WriteLine("     - reading from the stream");
    Console.WriteLine("     - growing a buffer when a message does not fit");
    Console.WriteLine("     - copying the unconsumed remainder back to the front");
    Console.WriteLine("     - finding message boundaries");
    Console.WriteLine();
    Console.WriteLine("   Every byte that straddles a boundary is copied at least twice.");
    Console.WriteLine();
    Console.WriteLine("   And notice the resize count is ZERO. The initial 64-byte buffer");
    Console.WriteLine("   happened to be large enough for this input, so the growth path -");
    Console.WriteLine("   the part most likely to be wrong - never ran at all.");
    Console.WriteLine();
    Console.WriteLine("   That is how this code ships: the hard branch is not exercised by");
    Console.WriteLine("   the data anyone tested with.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. The questions the hand-written version has not answered.
// ---------------------------------------------------------------------------
static void WhatItCostsToGetRight()
{
    Console.WriteLine("4. What the hand-written parser still does not handle");
    Console.WriteLine();
    Console.WriteLine("   The version above is correct for well-behaved input. Production");
    Console.WriteLine("   input is not well behaved, and each of these needs more code:");
    Console.WriteLine();
    Console.WriteLine("   1. A MESSAGE LARGER THAN THE BUFFER. The buffer doubles forever, so");
    Console.WriteLine("      a client that never sends a newline is an unbounded allocation.");
    Console.WriteLine("      That is a denial of service, and the fix is a maximum size that");
    Console.WriteLine("      has to be threaded through the loop.");
    Console.WriteLine();
    Console.WriteLine("   2. BACK PRESSURE. If records arrive faster than they are processed,");
    Console.WriteLine("      the buffer grows without limit. Nothing here tells the reader to");
    Console.WriteLine("      slow down, because a Stream has no way to express that.");
    Console.WriteLine();
    Console.WriteLine("   3. BUFFER REUSE. The array is allocated per connection and resized");
    Console.WriteLine("      by copying. At 10,000 connections that is 10,000 buffers the");
    Console.WriteLine("      collector has to manage.");
    Console.WriteLine();
    Console.WriteLine("   4. THE COPY ITSELF. Shuffling the remainder to the front is pure");
    Console.WriteLine("      overhead - the bytes have not changed, only their address.");
    Console.WriteLine();
    Console.WriteLine("   System.IO.Pipelines exists to answer all four in the library rather");
    Console.WriteLine("   than in every parser. It keeps the buffer, tracks what you consumed");
    Console.WriteLine("   against what you examined, reuses memory from a pool, and gives the");
    Console.WriteLine("   writer a way to be told to wait.");
    Console.WriteLine();
    Console.WriteLine("   The price is a less familiar API, and one concept - consumed versus");
    Console.WriteLine("   examined - that has no equivalent in Stream. That is module 23.");
}

// ---------------------------------------------------------------------------
// A stream that hands back exactly chunkSize bytes per read, chosen so the
// chunks never align with the record boundaries. This is a socket.
// ---------------------------------------------------------------------------
sealed class SplittingStream : Stream
{
    private readonly byte[] _data;
    private readonly int _chunkSize;
    private int _position;

    public SplittingStream(byte[] data, int chunkSize)
    {
        _data = data;
        _chunkSize = chunkSize;
    }

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        int available = _data.Length - _position;
        if (available == 0)
        {
            return 0;
        }

        int toCopy = Math.Min(Math.Min(count, _chunkSize), available);
        Array.Copy(_data, _position, buffer, offset, toCopy);
        _position += toCopy;
        return toCopy;
    }

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
