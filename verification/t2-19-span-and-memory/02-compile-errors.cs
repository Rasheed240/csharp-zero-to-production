// 02-compile-errors.cs — The ref struct rules, as the compiler states them.
//
// THIS FILE IS NOT MEANT TO BUILD. It is a catalogue of every restriction on
// Span<T>, each with the exact error the compiler produces. sweep.sh skips it
// by name.
//
// To see them:  dotnet build 02-compile-errors.cs -c Release
//
// Every error code and message below was captured by compiling each rule as a
// separate file on .NET 10, because the compiler stops at the first
// declaration-level error and will not report the rest from one file. Two of
// the codes commonly quoted for these rules are wrong on .NET 10:
//   - the async/iterator rule is CS4007, not CS4013
//   - the generic-argument rule is CS9244, not CS0306
//
// The legal cases at the bottom are the more useful half of the file.

// ---------------------------------------------------------------------------
// RULE 1: a ref struct cannot be a field of a class.
//
//   error CS8345: Field or auto-implemented property cannot be of type
//   'Span<byte>' unless it is an instance member of a ref struct.
//
// WHY: the class lives on the heap and can outlive whatever the span points
// at. The span would become a reference to freed or moved memory.
// ---------------------------------------------------------------------------
class CannotHoldASpan
{
    private Span<byte> _buffer;          // CS8345
}

// ---------------------------------------------------------------------------
// RULE 2: a ref struct cannot be PRESERVED ACROSS an await.
//
//   error CS4007: Instance of type 'System.Span<byte>' cannot be preserved
//   across 'await' or 'yield' boundary.
//
// Read the message carefully. It is not "no spans in async methods", which is
// how this rule is usually taught and is wrong. See LegalInAsync below.
//
// WHY: the compiler lifts every local that survives an await into a field on
// the heap-allocated state machine. Rule 1 then forbids it.
// ---------------------------------------------------------------------------
class CannotAwaitAcrossASpan
{
    public async Task ProcessAsync(Stream source)
    {
        Span<byte> buffer = stackalloc byte[256];
        await source.ReadAsync(new byte[256]);
        buffer[0] = 1;                   // CS4007: buffer had to survive the await
    }
}

// ---------------------------------------------------------------------------
// RULE 3: a ref struct cannot be captured by a lambda or local function.
//
//   error CS8175: Cannot use ref local 'buffer' inside an anonymous method,
//   lambda expression, or query expression
//
// WHY: the capture becomes a field on a compiler-generated class. Rule 1 again.
// ---------------------------------------------------------------------------
class CannotCaptureASpan
{
    public void Run()
    {
        Span<byte> buffer = stackalloc byte[16];
        Action print = () => Console.WriteLine(buffer.Length);   // CS8175
        print();
    }
}

// ---------------------------------------------------------------------------
// RULE 4: a ref struct cannot be boxed, so it cannot become object, be a
// generic type argument, or be an array element. Three different errors.
//
//   error CS0029: Cannot implicitly convert type 'System.Span<int>' to 'object'
//
//   error CS9244: The type 'Span<int>' may not be a ref struct or a type
//   parameter allowing ref structs in order to use it as parameter 'T' in the
//   generic type or method 'List<T>'
//
//   error CS0611: Array elements cannot be of type 'Span<int>'
//
// WHY: all three would copy the value to the heap, which is what rules 1-3
// exist to prevent.
// ---------------------------------------------------------------------------
class CannotBoxASpan
{
    public void Run()
    {
        Span<int> numbers = stackalloc int[4];

        object boxed = numbers;                       // CS0029
        var list = new List<Span<int>>();             // CS9244
        var array = new Span<int>[4];                 // CS0611
    }
}

// ---------------------------------------------------------------------------
// RULE 5: same as rule 2, for iterators. The boundary is the yield.
//
//   error CS4007: Instance of type 'System.ReadOnlySpan<char>' cannot be
//   preserved across 'await' or 'yield' boundary.
//
// Note it takes TWO yields to trigger this. With one, the span is dead before
// the boundary and the method compiles - verified.
// ---------------------------------------------------------------------------
class CannotYieldAcrossASpan
{
    public IEnumerable<int> Lengths(string text)
    {
        ReadOnlySpan<char> span = text.AsSpan();
        yield return span.Length;
        yield return span.Length;                     // CS4007
    }
}

// ---------------------------------------------------------------------------
// RULE 6: you cannot return a span pointing at your own stack frame.
//
//   error CS8352: Cannot use variable 'buffer' in this context because it may
//   expose referenced variables outside of their declaration scope
//
// WHY: the stack frame is gone the moment the method returns. This rule is
// what makes stackalloc safe to use at all - the compiler proves the span
// cannot escape, so there is no way to write the dangling-pointer bug.
// ---------------------------------------------------------------------------
class CannotReturnAStackSpan
{
    public Span<byte> MakeBuffer()
    {
        Span<byte> buffer = stackalloc byte[64];
        return buffer;                                // CS8352
    }
}

// ===========================================================================
// WHAT IS ACTUALLY LEGAL. Everything below this line compiles. These cases
// matter more than the errors above, because the rules are usually taught in
// a stricter form than the compiler enforces.
// ===========================================================================

class LegalInAsync
{
    // LEGAL: a Span inside an async method. The rule is about crossing an
    // await, not about the method being async. Here the span is created and
    // finished with BEFORE the await, so nothing has to be preserved.
    public async Task ProcessAsync(Stream source, CancellationToken ct)
    {
        Span<byte> header = stackalloc byte[8];
        header[0] = 1;
        int checksum = header[0];

        await source.ReadAsync(new byte[8], ct);

        // A second span AFTER the await is equally fine.
        Span<byte> footer = stackalloc byte[8];
        footer[0] = (byte)checksum;
    }

    // LEGAL: one yield, because the span does not survive it.
    public IEnumerable<int> OneYield(string text)
    {
        ReadOnlySpan<char> span = text.AsSpan();
        yield return span.Length;
    }

    // LEGAL: returning a span that points at the HEAP. The array outlives the
    // method, so there is nothing dangling. Only stack memory is restricted.
    public Span<byte> MakeHeapBuffer()
    {
        byte[] buffer = new byte[64];
        return buffer;
    }
}

// Memory<T> is NOT a ref struct, so none of rules 1-6 apply to it. This is the
// answer to every error above, and the reason both types exist.
class MemoryHasNoneOfTheseProblems
{
    private Memory<byte> _buffer;                     // rule 1 does not apply

    public MemoryHasNoneOfTheseProblems(byte[] backing) => _buffer = backing;

    public async Task ProcessAsync(Stream source, CancellationToken ct)
    {
        // Memory survives an await, because it is an ordinary struct holding
        // an object reference, an offset and a length.
        int read = await source.ReadAsync(_buffer, ct);

        // Convert to a Span only inside the synchronous stretch that uses it.
        // The span is created after the await and dies before the next one.
        Span<byte> span = _buffer.Span[..read];
        span.Reverse();
    }

    public IEnumerable<int> Lengths()
    {
        yield return _buffer.Length;
    }
}
