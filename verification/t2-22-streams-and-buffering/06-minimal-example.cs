// 06-minimal-example.cs — Read may return fewer bytes than you asked for, and
// peak memory should not depend on the input size.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

using System.Text;

byte[] payload = Encoding.UTF8.GetBytes("INV-2026-0004821|GBP|123450|SETTLED");

Console.WriteLine("Reading 35 bytes from a stream that serves 8 at a time:");
Console.WriteLine();

using (var stream = new ChunkedStream(payload, maxPerRead: 8))
{
    var buffer = new byte[payload.Length];
    int read = stream.Read(buffer, 0, buffer.Length);

    Console.WriteLine($"  Read(...)     returned {read} bytes");
    Console.WriteLine($"                \"{Encoding.UTF8.GetString(buffer).TrimEnd('\0')}\"");
}

using (var stream = new ChunkedStream(payload, maxPerRead: 8))
{
    var buffer = new byte[payload.Length];
    stream.ReadExactly(buffer);

    Console.WriteLine($"  ReadExactly   filled the buffer");
    Console.WriteLine($"                \"{Encoding.UTF8.GetString(buffer)}\"");
}

Console.WriteLine();
Console.WriteLine("Read returns between 0 and count bytes, and 0 only at the end of the");
Console.WriteLine("stream. Nothing promises it fills the buffer. A local file usually does,");
Console.WriteLine("which is why this bug reaches production and fails on a socket.");
Console.WriteLine();
Console.WriteLine("ReadExactly throws EndOfStreamException on a short stream, so the");
Console.WriteLine("failure is loud instead of being a half-filled buffer.");

// A stream that serves at most maxPerRead bytes per call - which is exactly
// how a socket behaves when data arrives in packets.
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
