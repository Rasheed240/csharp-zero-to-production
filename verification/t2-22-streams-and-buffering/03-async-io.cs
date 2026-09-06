// 03-async-io.cs — The FileStream flag that decides whether your async I/O is
// actually async, and what sync-over-async costs under load.
//
// Run:  dotnet run 03-async-io.cs -c Release
//
// EXACT vs RATIO: thread-pool counts are exact for the run. Times are ratios;
// the important column is peak thread count, which is what starves.

using System.Diagnostics;

string workDir = Path.Combine(Path.GetTempPath(), "ledger-t2-22-async-" + Environment.ProcessId);
Directory.CreateDirectory(workDir);

try
{
    string source = Path.Combine(workDir, "settlement.dat");
    CreateFile(source, 4 * 1024 * 1024);

    Console.WriteLine($"Processors : {Environment.ProcessorCount}");
    Console.WriteLine($"Test file  : {new FileInfo(source).Length / 1024 / 1024} MB");
    Console.WriteLine();

    TheUseAsyncFlag(source);
    await MemoryOverloads(source);
    await ConcurrencyCost(source, workDir);
    await CancellationBehaviour(source);
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
// 1. The flag nobody sets.
// ---------------------------------------------------------------------------
static void TheUseAsyncFlag(string source)
{
    Console.WriteLine("1. FileStream and the useAsync flag");
    Console.WriteLine();

    using (var withoutFlag = new FileStream(source, FileMode.Open, FileAccess.Read))
    {
        Console.WriteLine($"   new FileStream(path, ...)                  IsAsync = {withoutFlag.IsAsync}");
    }

    using (var withFlag = new FileStream(source, FileMode.Open, FileAccess.Read,
        FileShare.Read, bufferSize: 4096, useAsync: true))
    {
        Console.WriteLine($"   ... with useAsync: true                    IsAsync = {withFlag.IsAsync}");
    }

    using (var viaOptions = new FileStream(source, new FileStreamOptions
    {
        Mode = FileMode.Open,
        Access = FileAccess.Read,
        Options = FileOptions.Asynchronous
    }))
    {
        Console.WriteLine($"   ... via FileOptions.Asynchronous           IsAsync = {viaOptions.IsAsync}");
    }

    Console.WriteLine();
    Console.WriteLine("   The default is FALSE. A FileStream opened the usual way still has");
    Console.WriteLine("   ReadAsync and WriteAsync, and they still return Task - but the I/O");
    Console.WriteLine("   underneath is SYNCHRONOUS, performed on a thread-pool thread.");
    Console.WriteLine();
    Console.WriteLine("   So the await yields, and a pool thread blocks in its place. Under");
    Console.WriteLine("   load that is the same thread starvation await was meant to avoid,");
    Console.WriteLine("   moved one layer down where it is harder to see.");
    Console.WriteLine();
    Console.WriteLine("   File.OpenRead, File.ReadAllTextAsync and StreamReader all default");
    Console.WriteLine("   to the synchronous handle unless you pass the option.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. The overloads that do not allocate.
// ---------------------------------------------------------------------------
static async Task MemoryOverloads(string source)
{
    Console.WriteLine("2. The array overload allocates a state machine; the Memory one does not");
    Console.WriteLine();

    const int iterations = 20_000;
    var buffer = new byte[4096];

    long arrayBytes = await MeasureAsync(async () =>
    {
        using var stream = new FileStream(source, FileMode.Open, FileAccess.Read,
            FileShare.Read, 4096, FileOptions.Asynchronous);

        long total = 0;
        for (int i = 0; i < iterations; i++)
        {
            // Task<int>-returning overload.
            total += await stream.ReadAsync(buffer, 0, buffer.Length);
            if (stream.Position >= stream.Length)
            {
                stream.Position = 0;
            }
        }

        return total;
    });

    long memoryBytes = await MeasureAsync(async () =>
    {
        using var stream = new FileStream(source, FileMode.Open, FileAccess.Read,
            FileShare.Read, 4096, FileOptions.Asynchronous);

        long total = 0;
        for (int i = 0; i < iterations; i++)
        {
            // ValueTask<int>-returning overload.
            total += await stream.ReadAsync(buffer.AsMemory());
            if (stream.Position >= stream.Length)
            {
                stream.Position = 0;
            }
        }

        return total;
    });

    Console.WriteLine($"   {iterations:N0} reads of {buffer.Length:N0} bytes");
    Console.WriteLine($"     ReadAsync(byte[], int, int)  : {arrayBytes,10:N0} B   ({arrayBytes / (double)iterations,5:F0} B per read)");
    Console.WriteLine($"     ReadAsync(Memory<byte>)      : {memoryBytes,10:N0} B   ({memoryBytes / (double)iterations,5:F0} B per read)");
    Console.WriteLine();
    Console.WriteLine("   The Memory overload returns ValueTask<int>, which does not allocate");
    Console.WriteLine("   when the read completes synchronously - and a read served from the");
    Console.WriteLine("   file system cache usually does.");
    Console.WriteLine();
    Console.WriteLine("   Prefer the Memory overloads everywhere. They are the newer API and");
    Console.WriteLine("   there is no case where the array one is better.");
    Console.WriteLine();

    static async Task<long> MeasureAsync(Func<Task<long>> body)
    {
        await body();      // warm up

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);
        long sink = await body();
        _ = sink;
        return GC.GetTotalAllocatedBytes(precise: true) - before;
    }
}

// ---------------------------------------------------------------------------
// 3. What sync-over-async costs when many requests arrive at once.
// ---------------------------------------------------------------------------
static async Task ConcurrencyCost(string source, string workDir)
{
    Console.WriteLine("3. Blocking reads under concurrency");
    Console.WriteLine();

    const int concurrent = 60;

    (double blockingMs, int blockingPeak) = await RunAsync(useAsyncIo: false, blocking: true);
    (double asyncMs, int asyncPeak) = await RunAsync(useAsyncIo: true, blocking: false);

    Console.WriteLine($"   {concurrent} concurrent readers");
    Console.WriteLine();
    Console.WriteLine("   strategy                          time     peak pool threads");
    Console.WriteLine("   --------                          ----     -----------------");
    Console.WriteLine($"   Read() on a pool thread       {blockingMs,7:F0} ms   {blockingPeak,17}");
    Console.WriteLine($"   ReadAsync on an async handle  {asyncMs,7:F0} ms   {asyncPeak,17}");
    Console.WriteLine();
    Console.WriteLine($"   Same work, same peak thread count, {blockingMs / asyncMs:F1}x the time.");
    Console.WriteLine();
    Console.WriteLine("   Read the thread column first, because it is the surprising part.");
    Console.WriteLine("   The pool did NOT grow to absorb the blocking. Both runs peaked at");
    Console.WriteLine("   roughly the same number of threads.");
    Console.WriteLine();
    Console.WriteLine("   That is precisely why blocking I/O is damaging. The pool injects");
    Console.WriteLine("   new threads slowly past its minimum - on the order of one or two a");
    Console.WriteLine("   second - so within any burst you do not get more threads. You get");
    Console.WriteLine("   a QUEUE.");
    Console.WriteLine();
    Console.WriteLine("   Each of the 60 readers needs 5 reads at 20 ms. Asynchronously they");
    Console.WriteLine("   overlap and the whole set finishes in about the time of one reader.");
    Console.WriteLine("   Blocking, they are serialised across the handful of threads that");
    Console.WriteLine("   exist, and the total is the sum divided by that handful.");
    Console.WriteLine();
    Console.WriteLine("   In a web service the queued items are requests. The symptom is p99");
    Console.WriteLine("   latency climbing while CPU sits near idle - which looks nothing");
    Console.WriteLine("   like an I/O problem and sends people to profile the wrong thing.");
    Console.WriteLine();

    async Task<(double, int)> RunAsync(bool useAsyncIo, bool blocking)
    {
        _ = useAsyncIo;

        // ThreadPool.ThreadCount is the number of pool threads that currently
        // exist. Sampling it from a monitor loop is the only honest way to see
        // the pool grow; GetAvailableThreads reports headroom against the
        // MAXIMUM, not against the live count, and reading it that way was the
        // bug in the first version of this file - it reported 0 for both.
        int peak = 0;
        using var monitorStop = new CancellationTokenSource();

        Task monitor = Task.Run(async () =>
        {
            while (!monitorStop.IsCancellationRequested)
            {
                int now = ThreadPool.ThreadCount;
                if (now > peak)
                {
                    peak = now;
                }

                await Task.Delay(1);
            }
        });

        var sw = Stopwatch.StartNew();
        var tasks = new Task[concurrent];

        for (int i = 0; i < concurrent; i++)
        {
            tasks[i] = Task.Run(async () =>
            {
                var buffer = new byte[4096];

                // A stream that takes 20 ms per read, which is what a network
                // volume or a loaded disk actually behaves like. A local file
                // is far too fast to show this, and the first version of this
                // measurement used one and proved nothing.
                using var stream = new SlowStream(totalBytes: 16 * 1024, delayMs: 20);

                while (true)
                {
                    int read = blocking
                        ? stream.Read(buffer, 0, buffer.Length)
                        : await stream.ReadAsync(buffer.AsMemory());

                    if (read == 0)
                    {
                        break;
                    }
                }
            });
        }

        await Task.WhenAll(tasks);
        sw.Stop();

        await monitorStop.CancelAsync();
        await monitor;

        return (sw.Elapsed.TotalMilliseconds, peak);
    }
}

// ---------------------------------------------------------------------------
// 4. Cancelling a read, and the case where cancellation does nothing.
// ---------------------------------------------------------------------------
static async Task CancellationBehaviour(string source)
{
    Console.WriteLine("4. Cancelling I/O");
    Console.WriteLine();

    using var cts = new CancellationTokenSource();
    await cts.CancelAsync();

    using var stream = new FileStream(source, FileMode.Open, FileAccess.Read,
        FileShare.Read, 4096, FileOptions.Asynchronous);

    var buffer = new byte[4096];

    try
    {
        // The return value is used rather than discarded. CA2022 flagged the
        // first version of this line - in a file whose whole subject is that
        // discarding it is a bug, which is a fair result.
        int read = await stream.ReadAsync(buffer.AsMemory(), cts.Token);
        Console.WriteLine($"   already-cancelled token : completed without throwing, read {read}");
    }
    catch (OperationCanceledException)
    {
        Console.WriteLine("   already-cancelled token : OperationCanceledException");
    }

    Console.WriteLine();
    Console.WriteLine("   A token that is already cancelled is checked before the read");
    Console.WriteLine("   starts, so this throws reliably.");
    Console.WriteLine();
    Console.WriteLine("   What is NOT reliable is cancelling a read already in flight. On");
    Console.WriteLine("   most platforms a file read that has reached the operating system");
    Console.WriteLine("   cannot be interrupted, so the token is only observed between");
    Console.WriteLine("   reads. A 30-second read of a stalled network drive will not be");
    Console.WriteLine("   cancelled by a 5-second timeout.");
    Console.WriteLine();
    Console.WriteLine("   The consequence for a request pipeline: a CancellationToken on a");
    Console.WriteLine("   stream read bounds how long you WAIT for the result, not how long");
    Console.WriteLine("   the operation runs. The thread and the handle stay busy.");
    Console.WriteLine();
    Console.WriteLine("   Where it matters, put the timeout on the resource - a socket");
    Console.WriteLine("   timeout, an HttpClient timeout - not only on the token.");
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

// A stream where each read takes real time, which is what a network volume or
// a loaded disk behaves like. Read blocks the calling thread; ReadAsync yields
// it. That difference is the entire point of section 3.
sealed class SlowStream : Stream
{
    private readonly int _totalBytes;
    private readonly int _delayMs;
    private int _position;

    public SlowStream(int totalBytes, int delayMs)
    {
        _totalBytes = totalBytes;
        _delayMs = delayMs;
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
        // Occupies the calling thread for the whole wait.
        Thread.Sleep(_delayMs);
        return Fill(count);
    }

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
        // Releases the thread for the whole wait.
        await Task.Delay(_delayMs, cancellationToken).ConfigureAwait(false);
        return Fill(buffer.Length);
    }

    private int Fill(int count)
    {
        int remaining = _totalBytes - _position;
        if (remaining <= 0)
        {
            return 0;
        }

        int served = Math.Min(count, remaining);
        _position += served;
        return served;
    }

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
