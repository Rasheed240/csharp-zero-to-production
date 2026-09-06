// 03-memory-and-async.cs — Memory<T>: where Span cannot go, what it costs, and
// the ownership bug it makes possible.
//
// Run:  dotnet run 03-memory-and-async.cs -c Release
//
// EXACT vs RATIO: the ownership demonstration is deterministic - the corrupted
// read reproduces on every run. Allocation counts are exact.

using System.Buffers;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

Console.WriteLine("1. What Memory<T> is, structurally");
Console.WriteLine();

Structure();
await SurvivesAwait();
SpanFromMemory();
UseAfterReturn();
await OwnershipDoneRight();

// ---------------------------------------------------------------------------
static void Structure()
{
    var backing = new byte[100];
    Memory<byte> memory = backing.AsMemory(10, 20);

    Console.WriteLine($"   sizeof(Memory<byte>)     : {System.Runtime.CompilerServices.Unsafe.SizeOf<Memory<byte>>()} bytes");
    Console.WriteLine($"   memory.Length            : {memory.Length}");
    Console.WriteLine();

    // MemoryMarshal can recover the original array, offset and length, which
    // is proof of what the struct actually holds.
    if (MemoryMarshal.TryGetArray<byte>(memory, out ArraySegment<byte> segment))
    {
        Console.WriteLine($"   recovered array length   : {segment.Array!.Length}");
        Console.WriteLine($"   recovered offset         : {segment.Offset}");
        Console.WriteLine($"   recovered count          : {segment.Count}");
        Console.WriteLine($"   same array instance?     : {ReferenceEquals(segment.Array, backing)}");
    }

    Console.WriteLine();
    Console.WriteLine("   Memory<T> is an object reference, an offset and a length. It is an");
    Console.WriteLine("   ORDINARY struct, not a ref struct, so it can be a field, be captured");
    Console.WriteLine("   by a lambda, and live across an await.");
    Console.WriteLine();
    Console.WriteLine("   That flexibility is exactly what makes it more dangerous: nothing");
    Console.WriteLine("   in the type system stops you storing one for longer than the memory");
    Console.WriteLine("   it points at remains yours.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task SurvivesAwait()
{
    Console.WriteLine("2. Crossing an await");
    Console.WriteLine();

    var backing = new byte[16];
    Memory<byte> memory = backing;

    memory.Span[0] = 42;
    await Task.Yield();

    // Legal: memory survived the await. A Span here would be CS4007.
    Console.WriteLine($"   value after await        : {memory.Span[0]}");
    Console.WriteLine();
    Console.WriteLine("   A Span<byte> in the same position gives:");
    Console.WriteLine("     error CS4007: Instance of type 'System.Span<byte>' cannot be");
    Console.WriteLine("     preserved across 'await' or 'yield' boundary.");
    Console.WriteLine();
    Console.WriteLine("   Note the wording: PRESERVED ACROSS. A span created and finished");
    Console.WriteLine("   with entirely before the await compiles fine - verified in");
    Console.WriteLine("   02-compile-errors.cs. The rule is not 'no spans in async methods'.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void SpanFromMemory()
{
    Console.WriteLine("3. The .Span property, and what it costs");
    Console.WriteLine();

    var backing = new byte[1_000];
    Memory<byte> memory = backing;
    const int iterations = 10_000_000;

    long before = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    long sink = 0;
    for (int i = 0; i < iterations; i++)
    {
        Span<byte> span = memory.Span;
        sink += span.Length;
    }

    sw.Stop();

    Console.WriteLine($"   {iterations:N0} calls to .Span");
    Console.WriteLine($"   allocated : {GC.GetTotalAllocatedBytes(precise: true) - before:N0} bytes");
    Console.WriteLine($"   time      : {sw.Elapsed.TotalMilliseconds:F0} ms " +
        $"({sw.Elapsed.TotalMilliseconds * 1_000_000 / iterations:F2} ns each)");
    Console.WriteLine();
    Console.WriteLine("   Cheap, but not free: it re-derives the reference and length each");
    Console.WriteLine("   time. In a hot loop, take .Span ONCE outside the loop rather than");
    Console.WriteLine("   per iteration.");
    Console.WriteLine($"   (sink {sink})");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. The bug Memory<T> makes possible and Span<T> does not.
// ---------------------------------------------------------------------------
static void UseAfterReturn()
{
    Console.WriteLine("4. WRONG - a Memory that outlives the buffer it points at");
    Console.WriteLine();

    // A method rents a buffer, fills it, returns a Memory over it, and
    // returns the buffer to the pool. The Memory is now a view onto memory
    // owned by whoever rents it next.
    Memory<char> escaped = BadlyReadStatement("CUSTOMER-000512 GBP 1234.50");

    Console.WriteLine($"   what the caller was given : \"{escaped}\"");

    // Somebody else rents the same buffer and writes their own data.
    char[] stolen = ArrayPool<char>.Shared.Rent(64);
    stolen.AsSpan().Fill('X');
    "ATTACKER-999 USD 0.01".AsSpan().CopyTo(stolen);

    Console.WriteLine($"   after another tenant rents: \"{escaped}\"");
    Console.WriteLine();
    Console.WriteLine("   The caller's data changed underneath them without anyone touching");
    Console.WriteLine("   their variable. They are reading a different customer's record.");
    Console.WriteLine();
    Console.WriteLine("   This is the failure mode Span<T> cannot have, because the compiler");
    Console.WriteLine("   would not let the span escape the method. Memory<T> gives up that");
    Console.WriteLine("   protection in exchange for surviving an await, and the lifetime");
    Console.WriteLine("   becomes YOUR responsibility with no compiler help at all.");
    Console.WriteLine();

    ArrayPool<char>.Shared.Return(stolen);

    static Memory<char> BadlyReadStatement(string source)
    {
        char[] buffer = ArrayPool<char>.Shared.Rent(64);
        source.AsSpan().CopyTo(buffer);

        // WRONG: returning a view over a buffer we are about to give back.
        Memory<char> result = buffer.AsMemory(0, source.Length);
        ArrayPool<char>.Shared.Return(buffer);
        return result;
    }
}

// ---------------------------------------------------------------------------
// 5. The same job with ownership made explicit.
// ---------------------------------------------------------------------------
static async Task OwnershipDoneRight()
{
    Console.WriteLine("5. RIGHT - IMemoryOwner makes the lifetime a contract");
    Console.WriteLine();

    // The caller receives the OWNER, not a bare Memory. Disposing it is what
    // returns the buffer, so the lifetime is visible in the calling code.
    using (IMemoryOwner<char> owner = ReadStatement("CUSTOMER-000512 GBP 1234.50", out int length))
    {
        Memory<char> statement = owner.Memory[..length];
        Console.WriteLine($"   inside the using          : \"{statement}\"");

        await Task.Yield();
        Console.WriteLine($"   still valid after await   : \"{statement}\"");
    }

    Console.WriteLine();
    Console.WriteLine("   The buffer is returned at the closing brace, and the compiler-");
    Console.WriteLine("   enforced using makes it hard to forget. It does not make it");
    Console.WriteLine("   impossible to use the Memory afterwards - nothing can - but it");
    Console.WriteLine("   moves the lifetime into the type signature where a reviewer sees it.");
    Console.WriteLine();
    Console.WriteLine("   The three options, in order of preference:");
    Console.WriteLine("     1. Return a Span and let the compiler prove it cannot escape.");
    Console.WriteLine("     2. Return an IMemoryOwner and let the caller dispose it.");
    Console.WriteLine("     3. Copy into a caller-supplied buffer and return the count.");
    Console.WriteLine();
    Console.WriteLine("   Returning a bare Memory<T> over a pooled buffer is not on the list.");

    static IMemoryOwner<char> ReadStatement(string source, out int length)
    {
        IMemoryOwner<char> owner = MemoryPool<char>.Shared.Rent(64);
        source.AsSpan().CopyTo(owner.Memory.Span);
        length = source.Length;
        return owner;
    }
}
