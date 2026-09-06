// 06-minimal-example.cs — A pipe keeps the bytes you did not consume, so a
// message split across two reads arrives whole.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

using System.Buffers;
using System.IO.Pipelines;
using System.Text;

var pipe = new Pipe();

// Half a record arrives.
await WriteAsync(pipe.Writer, "INV-2026-0000001|GBP");

ReadResult result = await pipe.Reader.ReadAsync();
Console.WriteLine($"read 1: {result.Buffer.Length} bytes, no newline yet");

// consumed = nothing (no complete record). examined = everything (we looked
// at all of it and found no delimiter). This pair is the whole API.
pipe.Reader.AdvanceTo(result.Buffer.Start, result.Buffer.End);

// The rest arrives.
await WriteAsync(pipe.Writer, "|123450\n");
await pipe.Writer.CompleteAsync();

result = await pipe.Reader.ReadAsync();
Console.WriteLine($"read 2: {result.Buffer.Length} bytes - the earlier bytes were kept");

SequencePosition? newline = result.Buffer.PositionOf((byte)'\n');
if (newline is not null)
{
    ReadOnlySequence<byte> record = result.Buffer.Slice(0, newline.Value);
    Console.WriteLine($"record: \"{Encoding.UTF8.GetString(record)}\"");
    pipe.Reader.AdvanceTo(result.Buffer.GetPosition(1, newline.Value));
}

await pipe.Reader.CompleteAsync();

Console.WriteLine();
Console.WriteLine("No buffer was allocated, resized, or copied by this code. The pipe held");
Console.WriteLine("the 20 unconsumed bytes and delivered 28 on the next read.");
Console.WriteLine();
Console.WriteLine("The pair passed to AdvanceTo is the part with no Stream equivalent:");
Console.WriteLine("  consumed - finished with; the pipe may discard it");
Console.WriteLine("  examined - looked at; the pipe waits for data PAST this before waking");
Console.WriteLine();
Console.WriteLine("Setting examined too small spins; setting it too far hangs.");

static async Task WriteAsync(PipeWriter writer, string text)
{
    Memory<byte> memory = writer.GetMemory(text.Length);
    int written = Encoding.UTF8.GetBytes(text, memory.Span);
    writer.Advance(written);
    await writer.FlushAsync();
}
