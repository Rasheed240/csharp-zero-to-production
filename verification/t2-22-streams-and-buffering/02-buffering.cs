// 02-buffering.cs — What a buffer is for, what size to make it, and the two
// case where adding one buys nothing at all.
//
// Run:  dotnet run 02-buffering.cs -c Release
//
// EXACT vs RATIO: syscall counts are exact and deterministic. Times are ratios
// against the stated baseline and vary between runs.

using System.Diagnostics;

string workDir = Path.Combine(Path.GetTempPath(), "ledger-t2-22-" + Environment.ProcessId);
Directory.CreateDirectory(workDir);

try
{
    string source = Path.Combine(workDir, "settlement.dat");
    CreateFile(source, 16 * 1024 * 1024);

    Console.WriteLine($"Test file : {new FileInfo(source).Length / 1024 / 1024} MB");
    Console.WriteLine();

    WhyBuffersExist();
    BufferSizeSweep(source, workDir);
    TheDefault(source, workDir);
    DoubleBuffering(source);
    TheLohBoundary();
}
finally
{
    try
    {
        Directory.Delete(workDir, recursive: true);
    }
    catch (IOException)
    {
        Console.WriteLine($"(could not delete {workDir})");
    }
}

// ---------------------------------------------------------------------------
static void WhyBuffersExist()
{
    Console.WriteLine("1. What a buffer is actually for");
    Console.WriteLine();

    byte[] data = new byte[64 * 1024];
    Random.Shared.NextBytes(data);

    // Unbuffered: one call to the underlying stream per byte.
    var counter1 = new CountingStream();
    for (int i = 0; i < data.Length; i++)
    {
        counter1.WriteByte(data[i]);
    }

    // Buffered: the BufferedStream batches them.
    var counter2 = new CountingStream();
    using (var buffered = new BufferedStream(counter2, bufferSize: 4096))
    {
        for (int i = 0; i < data.Length; i++)
        {
            buffered.WriteByte(data[i]);
        }
    }

    Console.WriteLine($"   {data.Length:N0} single-byte writes");
    Console.WriteLine($"     straight to the stream : {counter1.WriteCalls,7:N0} calls to the underlying stream");
    Console.WriteLine($"     through a 4 KB buffer  : {counter2.WriteCalls,7:N0} calls");
    Console.WriteLine($"     reduction              : {counter1.WriteCalls / (double)counter2.WriteCalls,7:N0}x");
    Console.WriteLine();
    Console.WriteLine("   A buffer trades memory for CALL COUNT. Each call to the operating");
    Console.WriteLine("   system costs a transition into the kernel, which is the expensive");
    Console.WriteLine("   part - not the bytes.");
    Console.WriteLine();
    Console.WriteLine("   That is the whole model, and it tells you when a buffer helps:");
    Console.WriteLine("   when your writes or reads are SMALLER than the buffer. It also");
    Console.WriteLine("   tells you when it does not, which is section 4.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void BufferSizeSweep(string source, string workDir)
{
    Console.WriteLine("2. Buffer size against copy time");
    Console.WriteLine();
    Console.WriteLine("   buffer      reads   allocated       time    vs 4 KB");
    Console.WriteLine("   ------      -----   ---------       ----    -------");

    double baseline = 0;

    foreach (int bufferSize in new[] { 4 * 1024, 16 * 1024, 64 * 1024, 81_920, 256 * 1024, 1024 * 1024 })
    {
        string destination = Path.Combine(workDir, $"copy-{bufferSize}.dat");

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
        var sw = Stopwatch.StartNew();
        int reads = CopyWithBuffer(source, destination, bufferSize);
        sw.Stop();

        long allocated = GC.GetTotalAllocatedBytes(precise: true) - allocBefore;
        double ms = sw.Elapsed.TotalMilliseconds;

        if (bufferSize == 4 * 1024)
        {
            baseline = ms;
        }

        Console.WriteLine($"   {bufferSize,7:N0}   {reads,6:N0}   {allocated,9:N0} B   {ms,6:F0} ms    {baseline / ms,5:F2}x");

        File.Delete(destination);
    }

    Console.WriteLine();
    Console.WriteLine("   The read count is exact and halves as the buffer doubles. The time");
    Console.WriteLine("   column flattens out well before the buffer stops growing.");
    Console.WriteLine();
    Console.WriteLine("   Past roughly 64 KB you are paying memory for nothing: the syscall");
    Console.WriteLine("   count is already low enough that it has stopped being the cost.");
    Console.WriteLine();

    static int CopyWithBuffer(string source, string destination, int bufferSize)
    {
        var buffer = new byte[bufferSize];
        int reads = 0;

        using var input = new FileStream(source, FileMode.Open, FileAccess.Read);
        using var output = new FileStream(destination, FileMode.Create, FileAccess.Write);

        int read;
        while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
        {
            reads++;
            output.Write(buffer, 0, read);
        }

        return reads;
    }
}

// ---------------------------------------------------------------------------
static void TheDefault(string source, string workDir)
{
    Console.WriteLine("3. What CopyTo already does for you");
    Console.WriteLine();

    string destination = Path.Combine(workDir, "copyto.dat");

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    using (var input = new FileStream(source, FileMode.Open, FileAccess.Read))
    using (var output = new FileStream(destination, FileMode.Create, FileAccess.Write))
    {
        input.CopyTo(output);
    }

    sw.Stop();
    long allocated = GC.GetTotalAllocatedBytes(precise: true) - allocBefore;

    Console.WriteLine($"   Stream.CopyTo  : {sw.Elapsed.TotalMilliseconds,6:F0} ms, {allocated:N0} bytes allocated");
    Console.WriteLine();
    Console.WriteLine("   CopyTo's default buffer is 81,920 bytes - 80 KB. That number is");
    Console.WriteLine("   chosen to sit just under the 85,000-byte large object heap");
    Console.WriteLine("   threshold, so the buffer is collected cheaply in gen 0.");
    Console.WriteLine();
    Console.WriteLine("   It is a good default and it is already written. Hand-rolling a");
    Console.WriteLine("   copy loop to 'tune the buffer' usually reproduces this number");
    Console.WriteLine("   badly, and picking a rounder 128 KB puts every buffer on the LOH.");
    Console.WriteLine();

    File.Delete(destination);
}

// ---------------------------------------------------------------------------
static void DoubleBuffering(string source)
{
    Console.WriteLine("4. Where a buffer helps, and where it does nothing");
    Console.WriteLine();

    const int iterations = 3;

    // (a) The case BufferedStream is FOR: many small reads.
    double smallPlain = TimeReads(source, 512, wrapInBufferedStream: false, iterations);
    double smallWrapped = TimeReads(source, 512, wrapInBufferedStream: true, iterations);

    // (b) The case people reach for it anyway: reads that are already large.
    double largePlain = TimeReads(source, 64 * 1024, wrapInBufferedStream: false, iterations);
    double largeWrapped = TimeReads(source, 64 * 1024, wrapInBufferedStream: true, iterations);

    Console.WriteLine("   read size   FileStream   + BufferedStream   effect");
    Console.WriteLine("   ---------   ----------   ---------------   ------");
    Console.WriteLine($"   {512,7:N0} B   {smallPlain,7:F0} ms   {smallWrapped,13:F0} ms   {smallPlain / smallWrapped,5:F2}x");
    Console.WriteLine($"   {64 * 1024,7:N0} B   {largePlain,7:F0} ms   {largeWrapped,13:F0} ms   {largePlain / largeWrapped,5:F2}x");
    Console.WriteLine();
    Console.WriteLine("   Read the second row carefully, because it is an honest negative.");
    Console.WriteLine("   Wrapping a FileStream that is already read in 64 KB blocks costs");
    Console.WriteLine("   essentially NOTHING - measured at about 1.0x, not a penalty.");
    Console.WriteLine();
    Console.WriteLine("   The expectation writing this was that the extra copy would show up");
    Console.WriteLine("   as a measurable cost. It does not, because FileStream detects that");
    Console.WriteLine("   the read is at least as large as its own buffer and bypasses it.");
    Console.WriteLine();
    Console.WriteLine("   So the argument against the wrap is not performance. It is that it");
    Console.WriteLine("   is a layer doing nothing, and a reader has to work out why it is");
    Console.WriteLine("   there. The first row is where BufferedStream earns its place.");
    Console.WriteLine();
    Console.WriteLine("   BufferedStream is for a stream accessed in pieces SMALLER than the");
    Console.WriteLine("   buffer - a NetworkStream read a few bytes at a time, or a");
    Console.WriteLine("   DeflateStream. Adding one around large reads is neither a win nor");
    Console.WriteLine("   a measurable loss.");
    Console.WriteLine();

    static double TimeReads(string source, int bufferSize, bool wrapInBufferedStream, int iterations)
    {
        var buffer = new byte[bufferSize];
        var sw = Stopwatch.StartNew();

        for (int i = 0; i < iterations; i++)
        {
            Stream stream = new FileStream(source, FileMode.Open, FileAccess.Read);
            if (wrapInBufferedStream)
            {
                stream = new BufferedStream(stream, bufferSize);
            }

            using (stream)
            {
                while (stream.Read(buffer, 0, buffer.Length) > 0)
                {
                }
            }
        }

        sw.Stop();
        return sw.Elapsed.TotalMilliseconds / iterations;
    }
}

// ---------------------------------------------------------------------------
static void TheLohBoundary()
{
    Console.WriteLine("5. The buffer size that quietly changes the cost model");
    Console.WriteLine();
    Console.WriteLine("   buffer size   total object size   generation");
    Console.WriteLine("   -----------   -----------------   ----------");

    foreach (int size in new[] { 64 * 1024, 81_920, 84_975, 84_976, 128 * 1024 })
    {
        var buffer = new byte[size];
        Console.WriteLine($"   {size,11:N0}   {size + 24,17:N0}   gen {GC.GetGeneration(buffer)}");
        GC.KeepAlive(buffer);
    }

    Console.WriteLine();
    Console.WriteLine("   A buffer allocated per request at 128 KB is born in gen 2 and can");
    Console.WriteLine("   only be reclaimed by a full collection. At 80 KB it dies in gen 0.");
    Console.WriteLine();
    Console.WriteLine("   That is why CopyTo uses 81,920 and not a rounder 131,072, and it");
    Console.WriteLine("   is the single most useful number to remember when sizing a buffer.");
}

// ---------------------------------------------------------------------------
static void CreateFile(string path, int bytes)
{
    var block = new byte[64 * 1024];
    Random.Shared.NextBytes(block);

    using var file = new FileStream(path, FileMode.Create, FileAccess.Write);
    for (int written = 0; written < bytes; written += block.Length)
    {
        file.Write(block, 0, Math.Min(block.Length, bytes - written));
    }
}

// A stream that counts how many times the underlying Write is called, which
// is the thing a buffer is there to reduce.
sealed class CountingStream : Stream
{
    public long WriteCalls { get; private set; }

    public override bool CanRead => false;

    public override bool CanSeek => false;

    public override bool CanWrite => true;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    public override void Write(byte[] buffer, int offset, int count) => WriteCalls++;

    public override void WriteByte(byte value) => WriteCalls++;

    public override void Flush()
    {
    }

    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();
}
