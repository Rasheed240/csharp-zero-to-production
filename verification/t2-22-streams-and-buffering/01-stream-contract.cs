// 01-stream-contract.cs — The one rule about Stream.Read that everybody breaks,
// and the four APIs that make it impossible to break.
//
// Run:  dotnet run 01-stream-contract.cs -c Release
//
// EXACT vs RATIO: every result here is deterministic. The partial-read stream
// below returns a fixed, chosen number of bytes per call, so the failure
// reproduces identically on every run and on every machine.

using System.Text;

Console.WriteLine("1. Read is allowed to return FEWER bytes than you asked for");
Console.WriteLine();

TheContract();
TheBug();
TheFixes();
CopyToAndDisposal();
PositionAndSeek();

// ---------------------------------------------------------------------------
static void TheContract()
{
    Console.WriteLine("   Stream.Read(buffer, offset, count) promises exactly two things:");
    Console.WriteLine();
    Console.WriteLine("     - it returns between 0 and count bytes");
    Console.WriteLine("     - it returns 0 ONLY at the end of the stream");
    Console.WriteLine();
    Console.WriteLine("   It does NOT promise to fill the buffer. Anything that assumes it");
    Console.WriteLine("   does is a bug that a FileStream on a local disk will usually hide,");
    Console.WriteLine("   because a local file read normally does fill the buffer.");
    Console.WriteLine();
    Console.WriteLine("   A network stream, a compression stream, a pipe, and a file on a");
    Console.WriteLine("   slow or remote volume all return short reads routinely.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. The bug, reproduced deterministically.
// ---------------------------------------------------------------------------
static void TheBug()
{
    Console.WriteLine("2. WRONG - assuming Read fills the buffer");
    Console.WriteLine();

    byte[] payload = Encoding.UTF8.GetBytes("INV-2026-0004821|GBP|123450|SETTLED");

    // A stream that hands back at most 8 bytes per call, which is exactly what
    // a socket does when the data arrives in packets.
    using var source = new ChunkedStream(payload, maxPerRead: 8);

    var buffer = new byte[payload.Length];
    int read = source.Read(buffer, 0, buffer.Length);

    Console.WriteLine($"   asked for      : {buffer.Length} bytes");
    Console.WriteLine($"   Read returned  : {read} bytes");
    Console.WriteLine($"   decoded whole  : \"{Encoding.UTF8.GetString(buffer)}\"");
    Console.WriteLine();
    Console.WriteLine("   The record is truncated and the tail of the buffer is zeros. The");
    Console.WriteLine("   return value was discarded, so nothing in the program knows.");
    Console.WriteLine();
    Console.WriteLine("   Note what this looks like downstream: a parse failure, or worse a");
    Console.WriteLine("   SUCCESSFUL parse of a shorter record. Neither points back here.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. Four correct ways, in the order you should reach for them.
// ---------------------------------------------------------------------------
static void TheFixes()
{
    Console.WriteLine("3. RIGHT - four APIs, in order of preference");
    Console.WriteLine();

    byte[] payload = Encoding.UTF8.GetBytes("INV-2026-0004821|GBP|123450|SETTLED");

    // (a) ReadExactly: .NET 7+. Throws EndOfStreamException if the stream ends
    //     early, which is what you want when the length is known.
    using (var source = new ChunkedStream(payload, maxPerRead: 8))
    {
        var buffer = new byte[payload.Length];
        source.ReadExactly(buffer);
        Console.WriteLine($"   ReadExactly    : \"{Encoding.UTF8.GetString(buffer)}\"");
        Console.WriteLine($"     reads issued : {source.ReadCount}");
    }

    // (b) ReadAtLeast: when you need a minimum but can use more.
    using (var source = new ChunkedStream(payload, maxPerRead: 8))
    {
        var buffer = new byte[payload.Length];
        int got = source.ReadAtLeast(buffer, minimumBytes: 16);
        Console.WriteLine($"   ReadAtLeast(16): got {got} bytes in {source.ReadCount} reads");
    }

    // (c) The hand-written loop, which is what ReadExactly does. Worth being
    //     able to write, because you will meet it in older code.
    using (var source = new ChunkedStream(payload, maxPerRead: 8))
    {
        var buffer = new byte[payload.Length];
        int total = 0;
        while (total < buffer.Length)
        {
            int n = source.Read(buffer, total, buffer.Length - total);
            if (n == 0)
            {
                break;      // genuine end of stream
            }

            total += n;
        }

        Console.WriteLine($"   manual loop    : \"{Encoding.UTF8.GetString(buffer, 0, total)}\"");
    }

    // (d) CopyTo, when you want all of it and do not need it in one buffer.
    using (var source = new ChunkedStream(payload, maxPerRead: 8))
    using (var destination = new MemoryStream())
    {
        source.CopyTo(destination);
        Console.WriteLine($"   CopyTo         : \"{Encoding.UTF8.GetString(destination.ToArray())}\"");
    }

    Console.WriteLine();
    Console.WriteLine("   ReadExactly is the default answer when the length is known. It");
    Console.WriteLine("   throws EndOfStreamException on a short stream rather than");
    Console.WriteLine("   returning a half-filled buffer, so the failure is loud.");
    Console.WriteLine();

    // Prove the throwing behaviour, because it is the reason to prefer it.
    using (var truncated = new ChunkedStream(payload[..10], maxPerRead: 8))
    {
        try
        {
            var buffer = new byte[payload.Length];
            truncated.ReadExactly(buffer);
            Console.WriteLine("   (unreachable)");
        }
        catch (EndOfStreamException)
        {
            Console.WriteLine("   truncated source + ReadExactly -> EndOfStreamException");
        }
    }

    Console.WriteLine();
    Console.WriteLine("   Analyser rule CA2022 flags the discarded return value of Read.");
    Console.WriteLine("   It is not on by default. Turn it on.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. Buffered data is not written until it is flushed, and Dispose flushes.
// ---------------------------------------------------------------------------
static void CopyToAndDisposal()
{
    Console.WriteLine("4. Buffering means written is not the same as visible");
    Console.WriteLine();

    var backing = new MemoryStream();

    // leaveOpen: true so the MemoryStream survives the writer being disposed.
    var writer = new StreamWriter(backing, Encoding.UTF8, bufferSize: 1024, leaveOpen: true);
    writer.Write("INV-2026-0004821|GBP|123450");

    Console.WriteLine($"   after Write, bytes in the stream : {backing.Length}");

    writer.Flush();
    Console.WriteLine($"   after Flush, bytes in the stream : {backing.Length}");

    writer.Dispose();
    Console.WriteLine($"   after Dispose                    : {backing.Length}");
    Console.WriteLine();
    Console.WriteLine("   Zero bytes existed until the flush. A process that writes and then");
    Console.WriteLine("   exits without disposing loses everything still in the buffer - and");
    Console.WriteLine("   a crash, a kill -9, or a container eviction all look like that.");
    Console.WriteLine();
    Console.WriteLine("   This is why the using statement on a writer is not a tidiness");
    Console.WriteLine("   convention. It is the line that makes the data exist.");
    Console.WriteLine();
    Console.WriteLine("   One more thing is visible above: 27 characters produced 30 bytes.");
    Console.WriteLine("   Encoding.UTF8 writes a three-byte byte-order mark first.");
    Console.WriteLine();
    Console.WriteLine("   That BOM is a real interoperability bug. A CSV starting with it");
    Console.WriteLine("   gives the first column a name no parser matches, and a JSON body");
    Console.WriteLine("   starting with it is rejected by strict parsers.");
    Console.WriteLine();
    Console.WriteLine("   Use new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), or");
    Console.WriteLine("   Encoding.Default on a StreamWriter, when writing for a machine.");
    Console.WriteLine();

    // Proof, so the fix is not taken on trust.
    var noBom = new MemoryStream();
    using (var clean = new StreamWriter(noBom, new UTF8Encoding(false), 1024, leaveOpen: true))
    {
        clean.Write("INV-2026-0004821|GBP|123450");
    }

    Console.WriteLine($"   same text with no BOM            : {noBom.Length} bytes");
    Console.WriteLine();
    noBom.Dispose();

    backing.Dispose();
}

// ---------------------------------------------------------------------------
// 5. Not every stream can seek, and Position on a wrapped stream lies.
// ---------------------------------------------------------------------------
static void PositionAndSeek()
{
    Console.WriteLine("5. Capabilities differ, and you must ask");
    Console.WriteLine();

    byte[] payload = Encoding.UTF8.GetBytes("0123456789");

    using var seekable = new MemoryStream(payload);
    using var forwardOnly = new ChunkedStream(payload, maxPerRead: 4);

    Console.WriteLine("   stream            CanRead  CanWrite  CanSeek  Length");
    Console.WriteLine($"   MemoryStream      {seekable.CanRead,-7}  {seekable.CanWrite,-8}  {seekable.CanSeek,-7}  {seekable.Length}");
    Console.WriteLine($"   ChunkedStream     {forwardOnly.CanRead,-7}  {forwardOnly.CanWrite,-8}  {forwardOnly.CanSeek,-7}  (throws)");
    Console.WriteLine();

    try
    {
        _ = forwardOnly.Length;
    }
    catch (NotSupportedException)
    {
        Console.WriteLine("   forwardOnly.Length -> NotSupportedException");
    }

    Console.WriteLine();
    Console.WriteLine("   A network stream, a compression stream and a pipe cannot seek and");
    Console.WriteLine("   have no length. Code that reads Length to size a buffer works on a");
    Console.WriteLine("   file and throws the first time somebody points it at a socket.");
    Console.WriteLine();
    Console.WriteLine("   Check CanSeek before seeking, and never require Length. If you");
    Console.WriteLine("   need the size, either be told it out of band - a Content-Length");
    Console.WriteLine("   header - or stream without needing it.");
}

// ---------------------------------------------------------------------------
// A read-only, forward-only stream that returns at most maxPerRead bytes per
// call. This is not artificial: it is exactly how a socket behaves when data
// arrives in packets.
// ---------------------------------------------------------------------------
sealed class ChunkedStream : Stream
{
    private readonly byte[] _data;
    private readonly int _maxPerRead;
    private int _position;

    public ChunkedStream(byte[] data, int maxPerRead)
    {
        _data = data;
        _maxPerRead = maxPerRead;
    }

    public int ReadCount { get; private set; }

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
        ReadCount++;

        int available = _data.Length - _position;
        if (available == 0)
        {
            return 0;
        }

        int toCopy = Math.Min(Math.Min(count, _maxPerRead), available);
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
