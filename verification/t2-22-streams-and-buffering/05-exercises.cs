// 05-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 05-exercises.cs -c Release

using System.Diagnostics;
using System.Text;

string workDir = Path.Combine(Path.GetTempPath(), "ledger-t2-22-ex-" + Environment.ProcessId);
Directory.CreateDirectory(workDir);

try
{
    Exercise1();
    Exercise2(workDir);
    Exercise3(workDir);
    await Exercise4(workDir);
    Exercise5(workDir);
    await Exercise6(workDir);
}
finally
{
    try
    {
        Directory.Delete(workDir, recursive: true);
    }
    catch (IOException)
    {
    }
}

// ---------------------------------------------------------------------------
// 1. EASY — what is wrong with this read.
// ---------------------------------------------------------------------------
static void Exercise1()
{
    Console.WriteLine("Exercise 1: what is wrong with this method?");
    Console.WriteLine();
    Console.WriteLine("     var buffer = new byte[length];");
    Console.WriteLine("     stream.Read(buffer, 0, length);");
    Console.WriteLine("     return Encoding.UTF8.GetString(buffer);");
    Console.WriteLine();

    byte[] payload = Encoding.UTF8.GetBytes("INV-2026-0004821|GBP|123450");

    using (var chunked = new ChunkedStream(payload, maxPerRead: 8))
    {
        var buffer = new byte[payload.Length];
        int read = chunked.Read(buffer, 0, buffer.Length);
        Console.WriteLine($"   discarding the return value : \"{Encoding.UTF8.GetString(buffer).TrimEnd('\0')}\" (read {read})");
    }

    using (var chunked = new ChunkedStream(payload, maxPerRead: 8))
    {
        var buffer = new byte[payload.Length];
        chunked.ReadExactly(buffer);
        Console.WriteLine($"   ReadExactly                 : \"{Encoding.UTF8.GetString(buffer)}\"");
    }

    Console.WriteLine();
    Console.WriteLine("   Read may return fewer bytes than asked for, and returns 0 only at");
    Console.WriteLine("   the end of the stream. Discarding the return value gives a buffer");
    Console.WriteLine("   that is partly filled and partly zeros.");
    Console.WriteLine();
    Console.WriteLine("   It works on a local file, which usually fills the buffer, and");
    Console.WriteLine("   fails on a socket. That is why it reaches production.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. EASY — the flush that makes the data exist.
// ---------------------------------------------------------------------------
static void Exercise2(string workDir)
{
    Console.WriteLine("Exercise 2: why is the file empty?");
    Console.WriteLine();

    string path = Path.Combine(workDir, "unflushed.txt");

    // Deliberately not disposed, to reproduce a process that exits or crashes.
    var leaked = new StreamWriter(path);
    leaked.Write("INV-2026-0004821|GBP|123450");

    Console.WriteLine($"   after Write, file size      : {new FileInfo(path).Length} bytes");

    leaked.Flush();
    Console.WriteLine($"   after Flush, file size      : {new FileInfo(path).Length} bytes");

    leaked.Dispose();
    Console.WriteLine($"   after Dispose, file size    : {new FileInfo(path).Length} bytes");
    Console.WriteLine();
    Console.WriteLine("   Nothing reached the disk until the flush. A StreamWriter holds up");
    Console.WriteLine("   to its buffer size in memory, and Dispose is what flushes it.");
    Console.WriteLine();
    Console.WriteLine("   A process that is killed - OOM, SIGKILL, a container eviction -");
    Console.WriteLine("   never runs Dispose, so whatever is still buffered is lost. For an");
    Console.WriteLine("   audit log that is the difference between a record and no record.");
    Console.WriteLine();
    Console.WriteLine("   Where the write must survive a crash, flush explicitly at the");
    Console.WriteLine("   point it becomes durable, and accept the syscall cost of doing so.");
    Console.WriteLine();

    File.Delete(path);
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — pick the buffer size.
// ---------------------------------------------------------------------------
static void Exercise3(string workDir)
{
    Console.WriteLine("Exercise 3: which buffer size, and why not 128 KB?");
    Console.WriteLine();

    Console.WriteLine("   size        total object   generation   syscalls for 16 MB");
    Console.WriteLine("   ----        ------------   ----------   ------------------");

    foreach (int size in new[] { 4 * 1024, 64 * 1024, 81_920, 128 * 1024, 1024 * 1024 })
    {
        var buffer = new byte[size];
        Console.WriteLine($"   {size,7:N0}   {size + 24,12:N0}   gen {GC.GetGeneration(buffer),-8}   {(16 * 1024 * 1024) / size,18:N0}");
        GC.KeepAlive(buffer);
    }

    Console.WriteLine();
    Console.WriteLine("   Answer: 64 KB or CopyTo's 81,920, and not 128 KB.");
    Console.WriteLine();
    Console.WriteLine("   128 KB crosses the 85,000-byte large object heap threshold, so a");
    Console.WriteLine("   buffer allocated per request is born in gen 2 and is only");
    Console.WriteLine("   reclaimed by a full collection. It buys half the syscalls of");
    Console.WriteLine("   64 KB, which by then is no longer the cost.");
    Console.WriteLine();
    Console.WriteLine("   If you genuinely need a large buffer, allocate it ONCE and reuse");
    Console.WriteLine("   it, or rent it - which is what makes the LOH cost irrelevant.");
    Console.WriteLine();

    _ = workDir;
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — is this async method actually async?
// ---------------------------------------------------------------------------
static async Task Exercise4(string workDir)
{
    Console.WriteLine("Exercise 4: is this doing asynchronous I/O?");
    Console.WriteLine();
    Console.WriteLine("     using var stream = File.OpenRead(path);");
    Console.WriteLine("     await stream.ReadAsync(buffer);");
    Console.WriteLine();

    string path = Path.Combine(workDir, "probe.dat");
    await File.WriteAllBytesAsync(path, new byte[4096]);

    using (var viaOpenRead = File.OpenRead(path))
    {
        Console.WriteLine($"   File.OpenRead(path)                     IsAsync = {viaOpenRead.IsAsync}");
    }

    using (var explicitly = new FileStream(path, FileMode.Open, FileAccess.Read,
        FileShare.Read, 4096, FileOptions.Asynchronous))
    {
        Console.WriteLine($"   FileOptions.Asynchronous                IsAsync = {explicitly.IsAsync}");
    }

    Console.WriteLine();
    Console.WriteLine("   No. File.OpenRead returns a stream with a SYNCHRONOUS handle.");
    Console.WriteLine("   ReadAsync still returns a task and still yields - but the read");
    Console.WriteLine("   underneath runs synchronously on a thread-pool thread.");
    Console.WriteLine();
    Console.WriteLine("   So the await gives the thread back and immediately borrows another");
    Console.WriteLine("   one to do the blocking read. Under load that is the starvation");
    Console.WriteLine("   await exists to prevent, moved one layer down.");
    Console.WriteLine();
    Console.WriteLine("   Measured in 03-async-io.cs: 60 concurrent readers of a 20 ms-per-");
    Console.WriteLine("   read stream took 7x longer blocking than asynchronously, at the");
    Console.WriteLine("   SAME peak thread count - because the pool queues rather than grows.");
    Console.WriteLine();
    Console.WriteLine("   The fix is FileOptions.Asynchronous, or useAsync: true.");
    Console.WriteLine();

    File.Delete(path);
}

// ---------------------------------------------------------------------------
// 5. HARD — a stream wrapper that breaks the contract.
// ---------------------------------------------------------------------------
static void Exercise5(string workDir)
{
    Console.WriteLine("Exercise 5: find the bug in this decorator");
    Console.WriteLine();

    byte[] payload = Encoding.UTF8.GetBytes("INV-2026-0004821|GBP|123450|SETTLED");

    using (var inner = new ChunkedStream(payload, maxPerRead: 8))
    using (var broken = new BrokenCountingStream(inner))
    {
        var buffer = new byte[payload.Length];
        broken.ReadExactly(buffer);
        Console.WriteLine($"   BrokenCountingStream  : bytes counted {broken.BytesRead}, actual {payload.Length}");
    }

    using (var inner = new ChunkedStream(payload, maxPerRead: 8))
    using (var fixedUp = new CountingDecorator(inner))
    {
        var buffer = new byte[payload.Length];
        fixedUp.ReadExactly(buffer);
        Console.WriteLine($"   CountingDecorator     : bytes counted {fixedUp.BytesRead}, actual {payload.Length}");
    }

    Console.WriteLine();
    Console.WriteLine("   The broken version counts the bytes it was ASKED for rather than");
    Console.WriteLine("   the bytes the inner stream RETURNED. Every short read inflates the");
    Console.WriteLine("   count, so a metric built on it over-reports throughput - and it");
    Console.WriteLine("   over-reports most on exactly the slow, packet-fragmented");
    Console.WriteLine("   connections you would be investigating.");
    Console.WriteLine();
    Console.WriteLine("   Two more rules a decorator must follow, both easy to miss:");
    Console.WriteLine();
    Console.WriteLine("     - Override the Memory/Span overloads too. Overriding only the");
    Console.WriteLine("       byte[] one means async and span callers bypass your decorator");
    Console.WriteLine("       entirely, via the base class implementations.");
    Console.WriteLine("     - Decide about Dispose deliberately. Disposing the inner stream");
    Console.WriteLine("       is right when you own it and wrong when you were handed it,");
    Console.WriteLine("       which is why the BCL types take a leaveOpen flag.");
    Console.WriteLine();

    _ = workDir;
}

// ---------------------------------------------------------------------------
// 6. HARD — bound the memory of a copy that must transform as it goes.
// ---------------------------------------------------------------------------
static async Task Exercise6(string workDir)
{
    Console.WriteLine("Exercise 6: transform a file without holding it");
    Console.WriteLine();

    string source = Path.Combine(workDir, "in.csv");
    string destination = Path.Combine(workDir, "out.csv");

    await using (var writer = new StreamWriter(source, false, new UTF8Encoding(false)))
    {
        for (int i = 0; i < 200_000; i++)
        {
            await writer.WriteLineAsync($"INV-2026-{i:D7},gbp,{100_000 + i}");
        }
    }

    long fileSize = new FileInfo(source).Length;

    long bufferedPeak = await MeasurePeakAsync(async () =>
    {
        // WRONG: holds the whole input AND the whole output.
        string[] lines = await File.ReadAllLinesAsync(source);
        var transformed = new string[lines.Length];
        for (int i = 0; i < lines.Length; i++)
        {
            transformed[i] = lines[i].ToUpperInvariant();
        }

        await File.WriteAllLinesAsync(destination, transformed);
    });

    long streamedPeak = await MeasurePeakAsync(async () =>
    {
        // RIGHT: one line in flight at a time.
        await using var input = new FileStream(source, FileMode.Open, FileAccess.Read,
            FileShare.Read, 64 * 1024, FileOptions.Asynchronous);
        await using var output = new FileStream(destination, FileMode.Create, FileAccess.Write,
            FileShare.None, 64 * 1024, FileOptions.Asynchronous);

        using var reader = new StreamReader(input, Encoding.UTF8, false, 64 * 1024);
        await using var writer = new StreamWriter(output, new UTF8Encoding(false), 64 * 1024);

        string? line;
        while ((line = await reader.ReadLineAsync()) is not null)
        {
            await writer.WriteLineAsync(line.ToUpperInvariant());
        }
    });

    Console.WriteLine($"   input file            : {fileSize / 1024 / 1024:N0} MB");
    Console.WriteLine($"   ReadAllLines peak     : {bufferedPeak / 1024.0 / 1024.0,7:F1} MB");
    Console.WriteLine($"   streamed peak         : {streamedPeak / 1024.0 / 1024.0,7:F1} MB");
    Console.WriteLine();
    Console.WriteLine("   The streamed version's peak is two 64 KB buffers plus one line.");
    Console.WriteLine("   It does not depend on the file size, which is the only property");
    Console.WriteLine("   that makes the job safe on a file nobody has sent yet.");
    Console.WriteLine();
    Console.WriteLine("   Three details in that code worth defending:");
    Console.WriteLine();
    Console.WriteLine("     - FileOptions.Asynchronous on BOTH streams, so the awaits are");
    Console.WriteLine("       real rather than a pool thread blocking on your behalf.");
    Console.WriteLine("     - await using, because StreamWriter has DisposeAsync and a plain");
    Console.WriteLine("       using would flush synchronously.");
    Console.WriteLine("     - new UTF8Encoding(false), so no byte-order mark is written into");
    Console.WriteLine("       a CSV whose first column another parser has to match.");
    Console.WriteLine();
    Console.WriteLine("   What this version still does per line is allocate: ReadLineAsync");
    Console.WriteLine("   returns a string and ToUpperInvariant returns another. They die in");
    Console.WriteLine("   gen 0 and never accumulate, so they cost collection time rather");
    Console.WriteLine("   than memory - a real cost, and a different one from the failure");
    Console.WriteLine("   this exercise is about.");

    File.Delete(source);
    File.Delete(destination);

    static async Task<long> MeasurePeakAsync(Func<Task> body)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long baseline = GC.GetTotalMemory(true);
        long peak = baseline;

        using var stop = new CancellationTokenSource();
        var sampler = new Thread(() =>
        {
            while (!stop.IsCancellationRequested)
            {
                long now = GC.GetTotalMemory(false);
                if (now > peak)
                {
                    peak = now;
                }

                Thread.Sleep(1);
            }
        })
        {
            IsBackground = true
        };

        sampler.Start();
        await body();
        stop.Cancel();
        sampler.Join();

        return peak - baseline;
    }
}

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

// WRONG: counts what it was asked for rather than what it got.
sealed class BrokenCountingStream : Stream
{
    private readonly Stream _inner;

    public BrokenCountingStream(Stream inner) => _inner = inner;

    public long BytesRead { get; private set; }

    public override bool CanRead => _inner.CanRead;

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
        BytesRead += count;                 // the bug
        return _inner.Read(buffer, offset, count);
    }

    public override void Flush() => _inner.Flush();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}

// RIGHT: counts what the inner stream returned, and overrides the span and
// async paths so callers cannot bypass the decorator.
sealed class CountingDecorator : Stream
{
    private readonly Stream _inner;

    public CountingDecorator(Stream inner) => _inner = inner;

    public long BytesRead { get; private set; }

    public override bool CanRead => _inner.CanRead;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count) =>
        Read(buffer.AsSpan(offset, count));

    public override int Read(Span<byte> buffer)
    {
        int read = _inner.Read(buffer);
        BytesRead += read;
        return read;
    }

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
        int read = await _inner.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
        BytesRead += read;
        return read;
    }

    public override void Flush() => _inner.Flush();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
