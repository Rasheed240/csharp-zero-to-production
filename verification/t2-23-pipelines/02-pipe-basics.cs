// 02-pipe-basics.cs — The Pipe, and the one concept with no equivalent in
// Stream: consumed versus examined.
//
// Run:  dotnet run 02-pipe-basics.cs -c Release
//
// EXACT vs RATIO: every result is deterministic. The deadlock in section 4 is
// reproduced with a timeout rather than by hanging the file.

using System.Buffers;
using System.IO.Pipelines;
using System.Text;

Console.WriteLine("1. What a Pipe is");
Console.WriteLine();

Anatomy();
await BasicRoundTrip();
await ConsumedVersusExamined();
await TheDeadlock();
await BackPressure();

// ---------------------------------------------------------------------------
static void Anatomy()
{
    Console.WriteLine("   A Pipe is a buffer with two ends and a shared memory pool:");
    Console.WriteLine();
    Console.WriteLine("     PipeWriter  - GetMemory / Advance / FlushAsync");
    Console.WriteLine("     PipeReader  - ReadAsync / AdvanceTo");
    Console.WriteLine();
    Console.WriteLine("   The writer asks the pipe for memory rather than supplying its own,");
    Console.WriteLine("   so the buffer belongs to the pipe and is pooled and reused.");
    Console.WriteLine();
    Console.WriteLine("   The reader is handed a ReadOnlySequence<byte>, which may be one");
    Console.WriteLine("   contiguous block or several - it does not copy to make the data");
    Console.WriteLine("   contiguous, because that copy is exactly what a pipe exists to");
    Console.WriteLine("   avoid.");
    Console.WriteLine();
    Console.WriteLine("   The reader keeps unconsumed data across reads. That is the whole");
    Console.WriteLine("   framing problem, solved once in the library.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task BasicRoundTrip()
{
    Console.WriteLine("2. Writing and reading");
    Console.WriteLine();

    var pipe = new Pipe();

    // --- the writer side ---------------------------------------------------
    Memory<byte> memory = pipe.Writer.GetMemory(64);
    int written = Encoding.UTF8.GetBytes("INV-2026-0000001|GBP|123450\n", memory.Span);

    // Advance tells the pipe how much of that memory you actually filled.
    // Getting this wrong publishes uninitialised bytes.
    pipe.Writer.Advance(written);
    await pipe.Writer.FlushAsync();
    await pipe.Writer.CompleteAsync();

    // --- the reader side ---------------------------------------------------
    ReadResult result = await pipe.Reader.ReadAsync();
    ReadOnlySequence<byte> buffer = result.Buffer;

    Console.WriteLine($"   bytes written      : {written}");
    Console.WriteLine($"   sequence length    : {buffer.Length}");
    Console.WriteLine($"   IsSingleSegment    : {buffer.IsSingleSegment}");
    Console.WriteLine($"   IsCompleted        : {result.IsCompleted}");
    Console.WriteLine($"   content            : \"{Encoding.UTF8.GetString(buffer).TrimEnd('\n')}\"");

    pipe.Reader.AdvanceTo(buffer.End);
    await pipe.Reader.CompleteAsync();

    Console.WriteLine();
    Console.WriteLine("   GetMemory(64) asks for AT LEAST 64 bytes. It usually returns more,");
    Console.WriteLine("   so never assume the returned span is the size you asked for - the");
    Console.WriteLine("   same rule as ArrayPool.Rent.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. The concept Stream does not have.
// ---------------------------------------------------------------------------
static async Task ConsumedVersusExamined()
{
    Console.WriteLine("3. consumed vs examined");
    Console.WriteLine();
    Console.WriteLine("   AdvanceTo takes TWO positions:");
    Console.WriteLine();
    Console.WriteLine("     consumed - data you are finished with. The pipe may discard it.");
    Console.WriteLine("     examined - data you have LOOKED at. The pipe will not wake you");
    Console.WriteLine("                again until there is something past this point.");
    Console.WriteLine();

    var pipe = new Pipe();

    // Write a partial record - no newline yet.
    await WriteAsync(pipe.Writer, "INV-2026-0000001|GBP");

    ReadResult result = await pipe.Reader.ReadAsync();
    Console.WriteLine($"   read 1: {result.Buffer.Length} bytes, no newline yet");

    // Correct: consumed nothing, but examined everything. The pipe now knows
    // it must wait for MORE data before waking us.
    pipe.Reader.AdvanceTo(result.Buffer.Start, result.Buffer.End);

    // The rest of the record arrives.
    await WriteAsync(pipe.Writer, "|123450\n");
    await pipe.Writer.CompleteAsync();

    result = await pipe.Reader.ReadAsync();
    Console.WriteLine($"   read 2: {result.Buffer.Length} bytes - the earlier bytes are still here");

    SequencePosition? newline = result.Buffer.PositionOf((byte)'\n');
    if (newline is not null)
    {
        ReadOnlySequence<byte> line = result.Buffer.Slice(0, newline.Value);
        Console.WriteLine($"   record : \"{Encoding.UTF8.GetString(line)}\"");

        // Consume through the newline. The pipe can now reclaim that memory.
        pipe.Reader.AdvanceTo(result.Buffer.GetPosition(1, newline.Value));
    }

    await pipe.Reader.CompleteAsync();

    Console.WriteLine();
    Console.WriteLine("   The pipe kept the 20 bytes from read 1 and delivered 28 in read 2,");
    Console.WriteLine("   with no copying and no buffer management in this code. That is the");
    Console.WriteLine("   whole of section 3 of the previous file, done by the library.");
    Console.WriteLine();
    Console.WriteLine("   The single-argument AdvanceTo(consumed) means examined == consumed.");
    Console.WriteLine("   Use it only when you consumed everything you looked at.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. Getting examined wrong hangs the connection.
// ---------------------------------------------------------------------------
static async Task TheDeadlock()
{
    Console.WriteLine("4. WRONG - examined set to consumed when a message is incomplete");
    Console.WriteLine();

    var pipe = new Pipe();
    await WriteAsync(pipe.Writer, "INV-2026-0000001|GBP");   // no newline

    ReadResult result = await pipe.Reader.ReadAsync();
    Console.WriteLine($"   read 1: {result.Buffer.Length} bytes, still no newline");

    // THE BUG: we looked at all 20 bytes but tell the pipe we examined none.
    // The pipe concludes there is already unexamined data, so the next
    // ReadAsync can return immediately with the SAME buffer - forever.
    pipe.Reader.AdvanceTo(result.Buffer.Start, result.Buffer.Start);

    int spins = 0;
    var deadline = DateTime.UtcNow.AddMilliseconds(200);

    while (DateTime.UtcNow < deadline)
    {
        ReadResult again = await pipe.Reader.ReadAsync();
        spins++;

        if (again.Buffer.PositionOf((byte)'\n') is not null)
        {
            break;
        }

        pipe.Reader.AdvanceTo(again.Buffer.Start, again.Buffer.Start);
    }

    Console.WriteLine($"   spins in 200 ms : {spins:N0}");
    Console.WriteLine();
    Console.WriteLine("   ReadAsync returned immediately every time, with the same 20 bytes");
    Console.WriteLine("   and no newline. This is a hot loop burning a core, on a connection");
    Console.WriteLine("   that is making no progress.");
    Console.WriteLine();
    Console.WriteLine("   The opposite mistake - examined too far - is worse: the pipe waits");
    Console.WriteLine("   for data past what has arrived, ReadAsync never completes, and the");
    Console.WriteLine("   connection hangs until it times out.");
    Console.WriteLine();
    Console.WriteLine("   THE RULE: examined is where you STOPPED LOOKING. If you scanned the");
    Console.WriteLine("   whole buffer for a delimiter and did not find one, examined is");
    Console.WriteLine("   buffer.End. That is the single most important line in a pipe reader.");
    Console.WriteLine();

    await pipe.Reader.CompleteAsync();
    await pipe.Writer.CompleteAsync();
}

// ---------------------------------------------------------------------------
// 5. Back pressure, which a Stream cannot express.
// ---------------------------------------------------------------------------
static async Task BackPressure()
{
    Console.WriteLine("5. Back pressure");
    Console.WriteLine();

    // A pipe with a small threshold, so the writer is made to wait.
    var pipe = new Pipe(new PipeOptions(
        pauseWriterThreshold: 1024,
        resumeWriterThreshold: 512));

    int flushesCompleted = 0;
    bool writerBlocked = false;

    // Fill past the pause threshold without reading.
    for (int i = 0; i < 8; i++)
    {
        Memory<byte> memory = pipe.Writer.GetMemory(256);
        memory.Span[..256].Fill((byte)'x');
        pipe.Writer.Advance(256);

        ValueTask<FlushResult> flush = pipe.Writer.FlushAsync();

        if (flush.IsCompleted)
        {
            await flush;
            flushesCompleted++;
        }
        else
        {
            // The pipe is full. This flush will not complete until the
            // reader drains below resumeWriterThreshold.
            writerBlocked = true;

            Console.WriteLine($"   after {(i + 1) * 256} bytes: FlushAsync did NOT complete");
            Console.WriteLine("   the writer is now waiting for the reader");
            Console.WriteLine();

            // Drain, which releases the writer.
            ReadResult result = await pipe.Reader.ReadAsync();
            long drained = result.Buffer.Length;
            pipe.Reader.AdvanceTo(result.Buffer.End);

            await flush;
            flushesCompleted++;

            Console.WriteLine($"   reader drained {drained} bytes, flush completed");
            break;
        }
    }

    Console.WriteLine();
    Console.WriteLine($"   flushes completed immediately : {flushesCompleted - (writerBlocked ? 1 : 0)}");
    Console.WriteLine($"   writer was blocked            : {writerBlocked}");
    Console.WriteLine();
    Console.WriteLine("   FlushAsync is the back-pressure signal. When the pipe holds more");
    Console.WriteLine("   than pauseWriterThreshold, it does not complete until the reader");
    Console.WriteLine("   has drained below resumeWriterThreshold.");
    Console.WriteLine();
    Console.WriteLine("   A Stream has nothing equivalent. Stream.WriteAsync completes when");
    Console.WriteLine("   the bytes are accepted, so a fast producer and a slow consumer grow");
    Console.WriteLine("   a buffer until the process dies. Awaiting FlushAsync is what makes");
    Console.WriteLine("   the producer inherit the consumer's rate.");
    Console.WriteLine();
    Console.WriteLine("   The two thresholds differ on purpose. One value would make the");
    Console.WriteLine("   writer stop and start on every single byte at the boundary; the gap");
    Console.WriteLine("   between them is hysteresis.");
    Console.WriteLine();
    Console.WriteLine("   IGNORING the FlushAsync result defeats all of it - the write is");
    Console.WriteLine("   still buffered and the pipe still grows. Always await it.");

    await pipe.Reader.CompleteAsync();
    await pipe.Writer.CompleteAsync();
}

// ---------------------------------------------------------------------------
static async Task WriteAsync(PipeWriter writer, string text)
{
    Memory<byte> memory = writer.GetMemory(text.Length);
    int written = Encoding.UTF8.GetBytes(text, memory.Span);
    writer.Advance(written);
    await writer.FlushAsync();
}
